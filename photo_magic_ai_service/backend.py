"""
Photo Magic AI Service (CPU)
===========================

Implements:
- RMBG 2.0 auto background removal (mask + cutout PNG)
- SAM2 precision refinement via point prompts
- LaMa inpainting (standard Magic Eraser)

All images are passed as base64 (data: prefix optional).
"""

from __future__ import annotations

import base64
import io
import os
import traceback
from typing import Any

import cv2
import numpy as np
import torch
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image

app = Flask(__name__)
CORS(app)

STRICT_MODE = os.environ.get("PHOTO_MAGIC_STRICT", "true").lower() in ("1", "true", "yes")
DEFAULT_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DEVICE = os.environ.get("PHOTO_MAGIC_DEVICE", DEFAULT_DEVICE)

os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def strip_data_prefix(b64: str) -> str:
    text = str(b64 or "").strip()
    if "," in text and text.lstrip().lower().startswith("data:"):
        return text.split(",", 1)[1]
    return text


def decode_b64_to_pil(b64: str) -> Image.Image:
    raw = base64.b64decode(strip_data_prefix(b64))
    return Image.open(io.BytesIO(raw)).convert("RGB")


def decode_b64_to_cv2_bgr(b64: str) -> np.ndarray:
    raw = base64.b64decode(strip_data_prefix(b64))
    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Invalid image")
    return frame


def pil_to_png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def clamp_int(value: Any, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except Exception:
        n = lo
    return max(lo, min(hi, n))


def resize_to_max_side(image: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    h, w = image.shape[:2]
    if max_side <= 0 or max(h, w) <= max_side:
        return image, 1.0
    scale = max_side / float(max(h, w))
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    resized = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return resized, scale


def dilate_mask(mask_u8: np.ndarray, dilate_px: int) -> np.ndarray:
    px = max(0, int(dilate_px or 0))
    if px <= 0:
        return mask_u8
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px * 2 + 1, px * 2 + 1))
    return cv2.dilate(mask_u8, kernel, iterations=1)


def feather_mask(mask_u8: np.ndarray, feather_px: int) -> np.ndarray:
    px = max(0, int(feather_px or 0))
    if px <= 0:
        return mask_u8
    k = px * 2 + 1
    blurred = cv2.GaussianBlur(mask_u8, (k, k), 0)
    return blurred


def mask_bbox(mask_u8: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(mask_u8 > 0)
    if ys.size == 0 or xs.size == 0:
        return None
    x1 = int(xs.min())
    x2 = int(xs.max())
    y1 = int(ys.min())
    y2 = int(ys.max())
    return x1, y1, x2 + 1, y2 + 1


def composite_with_alpha(base_rgb: np.ndarray, overlay_rgb: np.ndarray, alpha_u8: np.ndarray) -> np.ndarray:
    alpha = (alpha_u8.astype(np.float32) / 255.0)[..., None]
    return (overlay_rgb.astype(np.float32) * alpha + base_rgb.astype(np.float32) * (1.0 - alpha)).clip(0, 255).astype(
        np.uint8
    )


# =============================================================================
# Model Loading
# =============================================================================

print("[photo_magic_ai_service] Loading models...")

# RMBG 2.0
RMBG2_AVAILABLE = False
RMBG2_ERROR = None
rmbg2_model = None
rmbg2_transform = None
RMBG2_MODEL_ID = os.environ.get("RMBG2_MODEL_ID", "briaai/RMBG-2.0")

try:
    from transformers import AutoModelForImageSegmentation
    from torchvision import transforms

    rmbg2_model = AutoModelForImageSegmentation.from_pretrained(RMBG2_MODEL_ID, trust_remote_code=True)
    rmbg2_model.to(DEVICE)
    rmbg2_model.eval()

    rmbg2_transform = transforms.Compose(
        [
            transforms.Resize((1024, 1024)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )

    RMBG2_AVAILABLE = True
    print("[photo_magic_ai_service] ✓ RMBG2 loaded")
except Exception as e:
    RMBG2_ERROR = str(e)
    print(f"[photo_magic_ai_service] ✗ RMBG2 not available: {e}")

# SAM2
SAM2_AVAILABLE = False
SAM2_ERROR = None
sam2_predictor = None
SAM2_CONFIG_NAME = None
SAM2_WEIGHTS_PATH = None
try:
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    SAM2_WEIGHTS_PATH = os.environ.get("SAM2_WEIGHTS_PATH", "weights/sam2_hiera_large.pt")

    def resolve_sam2_config_name() -> str:
        return os.environ.get("SAM2_CONFIG_NAME") or os.environ.get("SAM2_CONFIG_PATH") or "configs/sam2/sam2_hiera_l.yaml"

    SAM2_CONFIG_NAME = resolve_sam2_config_name()

    def init_sam2_hydra_with_vendored_configs() -> None:
        from hydra.core.global_hydra import GlobalHydra
        from hydra import initialize_config_module

        import sam2_configs  # noqa: F401

        GlobalHydra.instance().clear()
        initialize_config_module("sam2_configs", version_base="1.2")

    if os.path.exists(SAM2_WEIGHTS_PATH):
        try:
            sam2_model = build_sam2(config_file=SAM2_CONFIG_NAME, ckpt_path=SAM2_WEIGHTS_PATH, device=DEVICE)
        except Exception as e:
            try:
                init_sam2_hydra_with_vendored_configs()
                sam2_model = build_sam2(config_file=SAM2_CONFIG_NAME, ckpt_path=SAM2_WEIGHTS_PATH, device=DEVICE)
            except Exception as e2:
                raise RuntimeError(f"SAM2 build failed: {e} (after vendored config init: {e2})") from e2

        sam2_predictor = SAM2ImagePredictor(sam2_model)
        SAM2_AVAILABLE = True
        print("[photo_magic_ai_service] ✓ SAM2 loaded")
    else:
        SAM2_ERROR = f"SAM2 weights not found at {SAM2_WEIGHTS_PATH}"
        print(f"[photo_magic_ai_service] ✗ {SAM2_ERROR}")
except Exception as e:
    SAM2_ERROR = str(e)
    print(f"[photo_magic_ai_service] ✗ SAM2 not available: {e}")

# LaMa
LAMA_AVAILABLE = False
LAMA_ERROR = None
lama_model = None
try:
    from simple_lama_inpainting import SimpleLama

    lama_model = SimpleLama(device=torch.device(DEVICE))
    LAMA_AVAILABLE = True
    print("[photo_magic_ai_service] ✓ LaMa loaded")
except Exception as e:
    LAMA_ERROR = str(e)
    print(f"[photo_magic_ai_service] ✗ LaMa not available: {e}")

print("[photo_magic_ai_service] Models ready.\n")


def require_ready(models: dict[str, bool]) -> tuple[bool, Any]:
    if not STRICT_MODE:
        return True, None
    if all(models.values()):
        return True, None
    return False, jsonify(
        {
            "error": "Models not ready (strict mode)",
            "models": models,
            "errors": {"rmbg2": RMBG2_ERROR, "sam2": SAM2_ERROR, "lama": LAMA_ERROR},
        }
    )


def rmbg2_predict_mask(pil_image: Image.Image) -> Image.Image:
    if not RMBG2_AVAILABLE or rmbg2_model is None or rmbg2_transform is None:
        raise RuntimeError("RMBG2 not available")

    orig_w, orig_h = pil_image.size
    image_tensor = rmbg2_transform(pil_image).unsqueeze(0).to(DEVICE)

    with torch.inference_mode():
        out = rmbg2_model(image_tensor)
        pred = out[-1] if isinstance(out, (list, tuple)) else out
        pred = torch.sigmoid(pred)
        pred = pred.squeeze().detach().float().cpu().numpy()

    pred_u8 = np.clip(pred * 255.0, 0, 255).astype(np.uint8)
    mask = Image.fromarray(pred_u8, mode="L").resize((orig_w, orig_h), resample=Image.BILINEAR)
    return mask


def make_cutout_rgba(pil_rgb: Image.Image, mask_l: Image.Image) -> Image.Image:
    rgba = pil_rgb.convert("RGBA")
    rgba.putalpha(mask_l)
    return rgba


def sam2_predict_mask_from_points(
    bgr_image: np.ndarray,
    points: list[dict[str, Any]],
    box_xyxy: list[float] | None = None,
) -> np.ndarray:
    if not SAM2_AVAILABLE or sam2_predictor is None:
        raise RuntimeError("SAM2 not available")

    h, w = bgr_image.shape[:2]
    rgb = cv2.cvtColor(bgr_image, cv2.COLOR_BGR2RGB)

    coords = []
    labels = []
    for p in points or []:
        x = float(p.get("x_norm"))
        y = float(p.get("y_norm"))
        label = int(p.get("label", 1))
        x_px = int(round(max(0.0, min(1.0, x)) * (w - 1)))
        y_px = int(round(max(0.0, min(1.0, y)) * (h - 1)))
        coords.append([x_px, y_px])
        labels.append(1 if label else 0)

    if not coords:
        raise ValueError("At least one point is required")

    sam2_predictor.set_image(rgb)

    kwargs = {
        "point_coords": np.array(coords, dtype=np.float32),
        "point_labels": np.array(labels, dtype=np.int32),
        "multimask_output": False,
    }
    if box_xyxy and len(box_xyxy) == 4:
        kwargs["box"] = np.array(box_xyxy, dtype=np.float32)

    masks, scores, _ = sam2_predictor.predict(**kwargs)
    mask = masks[0].astype(np.uint8) * 255
    return mask


@app.route("/health", methods=["GET"])
def health():
    payload = {
        "status": "ok" if (RMBG2_AVAILABLE and SAM2_AVAILABLE and LAMA_AVAILABLE) else "not_ready",
        "strict": STRICT_MODE,
        "device": DEVICE,
        "models": {"rmbg2": RMBG2_AVAILABLE, "sam2": SAM2_AVAILABLE, "lama": LAMA_AVAILABLE},
        "errors": {"rmbg2": RMBG2_ERROR, "sam2": SAM2_ERROR, "lama": LAMA_ERROR},
        "config": {"rmbg2_model_id": RMBG2_MODEL_ID, "sam2_config": SAM2_CONFIG_NAME, "sam2_weights": SAM2_WEIGHTS_PATH},
    }
    if STRICT_MODE and not (RMBG2_AVAILABLE and SAM2_AVAILABLE and LAMA_AVAILABLE):
        return jsonify(payload), 503
    return jsonify(payload)


@app.route("/remove-bg/rmbg2", methods=["POST"])
def remove_bg_rmbg2():
    try:
        ok, err = require_ready({"rmbg2": RMBG2_AVAILABLE, "sam2": True, "lama": True})
        if not ok:
            return err, 503

        data = request.json or {}
        image_b64 = data.get("image") or ""
        if not image_b64:
            return jsonify({"error": "image is required"}), 400

        max_side = clamp_int(data.get("max_side", 2048), 256, 8192)
        return_mask = bool(data.get("return_mask", True))

        pil = decode_b64_to_pil(image_b64)

        w0, h0 = pil.size
        scale = 1.0
        if max(w0, h0) > max_side:
            scale = max_side / float(max(w0, h0))
            pil_small = pil.resize((int(round(w0 * scale)), int(round(h0 * scale))), resample=Image.LANCZOS)
        else:
            pil_small = pil

        mask_small = rmbg2_predict_mask(pil_small)
        mask = mask_small.resize((w0, h0), resample=Image.BILINEAR) if scale != 1.0 else mask_small
        cutout = make_cutout_rgba(pil, mask)

        resp = {"cutout_png": pil_to_png_b64(cutout), "width": w0, "height": h0}
        if return_mask:
            resp["mask_png"] = pil_to_png_b64(mask)
        return jsonify(resp)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/remove-bg/sam2-refine", methods=["POST"])
def remove_bg_sam2_refine():
    try:
        ok, err = require_ready({"sam2": SAM2_AVAILABLE})
        if not ok:
            return err, 503

        data = request.json or {}
        image_b64 = data.get("image") or ""
        points = data.get("points") or []
        box = data.get("box_xyxy") or None
        max_side = clamp_int(data.get("max_side", 2048), 256, 8192)
        dilate_px = clamp_int(data.get("mask_dilate_px", 0), 0, 64)
        feather_px = clamp_int(data.get("mask_feather_px", 0), 0, 64)

        if not image_b64:
            return jsonify({"error": "image is required"}), 400

        bgr = decode_b64_to_cv2_bgr(image_b64)
        orig_h, orig_w = bgr.shape[:2]

        bgr_small, scale = resize_to_max_side(bgr, max_side)
        if scale != 1.0 and box and len(box) == 4:
            box = [float(v) * scale for v in box]

        mask_u8 = sam2_predict_mask_from_points(bgr_small, points, box_xyxy=box)

        if dilate_px:
            mask_u8 = dilate_mask(mask_u8, dilate_px)

        mask_u8_soft = feather_mask(mask_u8, feather_px) if feather_px else mask_u8

        if scale != 1.0:
            mask_u8 = cv2.resize(mask_u8, (orig_w, orig_h), interpolation=cv2.INTER_NEAREST)
            mask_u8_soft = cv2.resize(mask_u8_soft, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)

        mask_soft_pil = Image.fromarray(mask_u8_soft, mode="L")
        pil = decode_b64_to_pil(image_b64)
        cutout = make_cutout_rgba(pil, mask_soft_pil)

        return jsonify(
            {
                "mask_png": pil_to_png_b64(mask_soft_pil),
                "cutout_png": pil_to_png_b64(cutout),
                "width": orig_w,
                "height": orig_h,
            }
        )
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/erase/lama", methods=["POST"])
def erase_lama():
    try:
        ok, err = require_ready({"lama": LAMA_AVAILABLE})
        if not ok:
            return err, 503

        data = request.json or {}
        image_b64 = data.get("image") or ""
        mask_b64 = data.get("mask") or ""
        max_side = clamp_int(data.get("max_side", 2048), 256, 8192)
        dilate_px = clamp_int(data.get("mask_dilate_px", 8), 0, 64)
        feather_px = clamp_int(data.get("mask_feather_px", 8), 0, 64)
        crop_to_mask = bool(data.get("crop_to_mask", True))
        crop_margin_px = clamp_int(data.get("crop_margin_px", 128), 0, 2048)

        if not image_b64 or not mask_b64:
            return jsonify({"error": "image and mask are required"}), 400

        pil = decode_b64_to_pil(image_b64)
        mask_pil = Image.open(io.BytesIO(base64.b64decode(strip_data_prefix(mask_b64)))).convert("L")

        w0, h0 = pil.size

        scale = 1.0
        if max(w0, h0) > max_side:
            scale = max_side / float(max(w0, h0))
            pil_small = pil.resize((int(round(w0 * scale)), int(round(h0 * scale))), resample=Image.LANCZOS)
            mask_small = mask_pil.resize((int(round(w0 * scale)), int(round(h0 * scale))), resample=Image.NEAREST)
        else:
            pil_small = pil
            mask_small = mask_pil

        img_np = np.array(pil_small)
        mask_np = np.array(mask_small)
        mask_bin = (mask_np > 0).astype(np.uint8) * 255

        if dilate_px:
            mask_bin = dilate_mask(mask_bin, dilate_px)

        mask_alpha = feather_mask(mask_bin, feather_px) if feather_px else mask_bin

        bbox = mask_bbox(mask_bin) if crop_to_mask else None
        if crop_to_mask and not bbox:
            return jsonify({"error": "Mask is empty"}), 400

        if bbox:
            x1, y1, x2, y2 = bbox
            x1 = max(0, x1 - crop_margin_px)
            y1 = max(0, y1 - crop_margin_px)
            x2 = min(img_np.shape[1], x2 + crop_margin_px)
            y2 = min(img_np.shape[0], y2 + crop_margin_px)

            img_crop = Image.fromarray(img_np[y1:y2, x1:x2])
            mask_crop = Image.fromarray(mask_bin[y1:y2, x1:x2])
            alpha_crop = mask_alpha[y1:y2, x1:x2]

            inpainted_crop = lama_model(img_crop, mask_crop)

            base_crop = np.array(img_crop)
            over_crop = np.array(inpainted_crop.convert("RGB"))
            blended_crop = composite_with_alpha(base_crop, over_crop, alpha_crop)

            out_small = img_np.copy()
            out_small[y1:y2, x1:x2] = blended_crop
        else:
            inpainted = lama_model(pil_small, Image.fromarray(mask_bin))
            base = img_np
            over = np.array(inpainted.convert("RGB"))
            out_small = composite_with_alpha(base, over, mask_alpha)

        out_pil_small = Image.fromarray(out_small)
        out_pil = out_pil_small.resize((w0, h0), resample=Image.LANCZOS) if scale != 1.0 else out_pil_small

        return jsonify({"result_png": pil_to_png_b64(out_pil), "width": w0, "height": h0})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    print(f"[photo_magic_ai_service] Starting on 0.0.0.0:{port} (device={DEVICE})")
    app.run(host="0.0.0.0", port=port, debug=debug)

