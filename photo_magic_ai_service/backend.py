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
import logging
import os
import urllib.request
import warnings
from typing import Any

import cv2
import numpy as np
import torch
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("photo_magic_ai_service")

app = Flask(__name__)

CORS_ORIGINS = [o.strip() for o in os.environ.get("PHOTO_MAGIC_CORS_ORIGINS", "").split(",") if o.strip()]
if CORS_ORIGINS:
    CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}})

SERVICE_TOKEN = os.environ.get("PHOTO_MAGIC_AI_TOKEN", "").strip()

MAX_IMAGE_BYTES = int(os.environ.get("PHOTO_MAGIC_MAX_IMAGE_BYTES", str(25 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.environ.get("PHOTO_MAGIC_MAX_IMAGE_PIXELS", "60000000"))

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
warnings.simplefilter("error", Image.DecompressionBombWarning)

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


@app.before_request
def _auth_guard():
    if not SERVICE_TOKEN:
        return None
    auth = str(request.headers.get("authorization") or "")
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
    else:
        token = str(request.headers.get("x-photo-magic-token") or "").strip()
    if token and token == SERVICE_TOKEN:
        return None
    return jsonify({"error": "Unauthorized"}), 401


def decode_b64_to_bytes(b64: str, *, max_bytes: int) -> bytes:
    text = strip_data_prefix(b64)
    if not text:
        raise ValueError("Empty input")
    compact = "".join(text.split())
    approx_size = (len(compact) * 3) // 4
    if approx_size > max_bytes + 16:
        raise ValueError("Input too large")
    try:
        raw = base64.b64decode(compact, validate=True)
    except Exception as e:
        raise ValueError("Invalid base64") from e
    if len(raw) > max_bytes:
        raise ValueError("Input too large")
    return raw


def decode_b64_to_pil(b64: str) -> Image.Image:
    raw = decode_b64_to_bytes(b64, max_bytes=MAX_IMAGE_BYTES)
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        raise ValueError("Invalid image") from e
    w, h = img.size
    if w <= 0 or h <= 0:
        raise ValueError("Invalid image size")
    if w * h > MAX_IMAGE_PIXELS:
        raise ValueError("Image too large")
    return img.convert("RGB")


def decode_b64_to_pil_l(b64: str) -> Image.Image:
    raw = decode_b64_to_bytes(b64, max_bytes=MAX_IMAGE_BYTES)
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        raise ValueError("Invalid mask image") from e
    w, h = img.size
    if w <= 0 or h <= 0:
        raise ValueError("Invalid mask size")
    if w * h > MAX_IMAGE_PIXELS:
        raise ValueError("Mask too large")
    return img.convert("L")


def decode_b64_to_cv2_bgr(b64: str) -> np.ndarray:
    raw = decode_b64_to_bytes(b64, max_bytes=MAX_IMAGE_BYTES)
    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Invalid image")
    h, w = frame.shape[:2]
    if h <= 0 or w <= 0:
        raise ValueError("Invalid image size")
    if h * w > MAX_IMAGE_PIXELS:
        raise ValueError("Image too large")
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


def clamp_float(value: Any, lo: float, hi: float, default: float) -> float:
    try:
        n = float(value)
    except Exception:
        n = float(default)
    if not np.isfinite(n):
        n = float(default)
    return float(max(lo, min(hi, n)))


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


def resize_pil_to_max_side(img: Image.Image, max_side: int) -> tuple[Image.Image, float]:
    w, h = img.size
    if max_side <= 0 or max(w, h) <= max_side:
        return img, 1.0
    scale = max_side / float(max(w, h))
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    return img.resize((new_w, new_h), resample=Image.LANCZOS), scale


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

logger.info("Loading models...")

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
    logger.info("✓ RMBG2 loaded")
except Exception as e:
    RMBG2_ERROR = str(e)
    logger.warning("✗ RMBG2 not available: %s", e)

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
        logger.info("✓ SAM2 loaded")
    else:
        SAM2_ERROR = f"SAM2 weights not found at {SAM2_WEIGHTS_PATH}"
        logger.warning("✗ %s", SAM2_ERROR)
except Exception as e:
    SAM2_ERROR = str(e)
    logger.warning("✗ SAM2 not available: %s", e)

# LaMa
LAMA_AVAILABLE = False
LAMA_ERROR = None
lama_model = None
try:
    from simple_lama_inpainting import SimpleLama

    lama_model = SimpleLama(device=torch.device(DEVICE))
    LAMA_AVAILABLE = True
    logger.info("✓ LaMa loaded")
except Exception as e:
    LAMA_ERROR = str(e)
    logger.warning("✗ LaMa not available: %s", e)

# Real-ESRGAN (upscale)
REALESRGAN_AVAILABLE = False
REALESRGAN_ERROR = None
realesrgan_upsampler = None
REALESRGAN_ENABLED = os.environ.get("PHOTO_MAGIC_ENABLE_REALESRGAN", "true").lower() in ("1", "true", "yes")
REALESRGAN_WEIGHTS_PATH = os.environ.get("REALESRGAN_WEIGHTS_PATH", "weights/RealESRGAN_x4plus.pth")
REALESRGAN_WEIGHTS_URL = os.environ.get(
    "REALESRGAN_WEIGHTS_URL",
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
)
REALESRGAN_AUTO_DOWNLOAD = os.environ.get("REALESRGAN_AUTO_DOWNLOAD", "true").lower() in ("1", "true", "yes")
REALESRGAN_TILE = clamp_int(os.environ.get("REALESRGAN_TILE", "0"), 0, 2048)
REALESRGAN_TILE_PAD = clamp_int(os.environ.get("REALESRGAN_TILE_PAD", "10"), 0, 512)
REALESRGAN_PRE_PAD = clamp_int(os.environ.get("REALESRGAN_PRE_PAD", "0"), 0, 512)

if REALESRGAN_ENABLED:
    try:
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer

        weights_dir = os.path.dirname(REALESRGAN_WEIGHTS_PATH)
        if weights_dir:
            os.makedirs(weights_dir, exist_ok=True)

        if not os.path.exists(REALESRGAN_WEIGHTS_PATH) and REALESRGAN_AUTO_DOWNLOAD and REALESRGAN_WEIGHTS_URL:
            logger.info("Downloading Real-ESRGAN weights from %s", REALESRGAN_WEIGHTS_URL)
            urllib.request.urlretrieve(REALESRGAN_WEIGHTS_URL, REALESRGAN_WEIGHTS_PATH)

        if not os.path.exists(REALESRGAN_WEIGHTS_PATH):
            raise FileNotFoundError(f"Real-ESRGAN weights not found: {REALESRGAN_WEIGHTS_PATH}")

        rrdb_model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
        realesrgan_upsampler = RealESRGANer(
            scale=4,
            model_path=REALESRGAN_WEIGHTS_PATH,
            model=rrdb_model,
            tile=REALESRGAN_TILE,
            tile_pad=REALESRGAN_TILE_PAD,
            pre_pad=REALESRGAN_PRE_PAD,
            half=(DEVICE != "cpu"),
            gpu_id=0 if DEVICE != "cpu" else None,
        )
        REALESRGAN_AVAILABLE = True
        logger.info("✓ Real-ESRGAN loaded")
    except Exception as e:
        REALESRGAN_ERROR = str(e)
        logger.warning("✗ Real-ESRGAN not available: %s", e)
else:
    REALESRGAN_ERROR = "Real-ESRGAN disabled by PHOTO_MAGIC_ENABLE_REALESRGAN=false"

logger.info("Models ready.")


def require_ready(models: dict[str, bool]) -> tuple[bool, Any]:
    if not STRICT_MODE:
        return True, None
    if all(models.values()):
        return True, None
    return False, jsonify(
        {
            "error": "Models not ready (strict mode)",
            "models": models,
            "errors": {
                "rmbg2": RMBG2_ERROR,
                "sam2": SAM2_ERROR,
                "lama": LAMA_ERROR,
                "realesrgan": REALESRGAN_ERROR,
            },
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


def enhance_upscale_realesrgan(pil_rgb: Image.Image, outscale: float) -> Image.Image:
    if not REALESRGAN_AVAILABLE or realesrgan_upsampler is None:
        raise RuntimeError("Real-ESRGAN not available")

    np_rgb = np.array(pil_rgb.convert("RGB"))
    np_bgr = cv2.cvtColor(np_rgb, cv2.COLOR_RGB2BGR)
    out_bgr, _ = realesrgan_upsampler.enhance(np_bgr, outscale=float(outscale))
    out_rgb = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(out_rgb)


def _enhance_unsharp(np_bgr: np.ndarray, amount: float, sigma: float) -> np.ndarray:
    blurred = cv2.GaussianBlur(np_bgr, (0, 0), sigmaX=max(0.1, sigma))
    sharpened = cv2.addWeighted(np_bgr, 1.0 + amount, blurred, -amount, 0)
    return np.clip(sharpened, 0, 255).astype(np.uint8)


def enhance_with_opencv(pil_rgb: Image.Image, mode: str, strength: float) -> Image.Image:
    np_rgb = np.array(pil_rgb.convert("RGB"))
    np_bgr = cv2.cvtColor(np_rgb, cv2.COLOR_RGB2BGR)
    s = float(np.clip(strength, 0.0, 1.0))

    if mode == "denoise":
        h_luma = int(round(3 + 12 * s))
        h_color = int(round(3 + 12 * s))
        np_bgr = cv2.fastNlMeansDenoisingColored(np_bgr, None, h_luma, h_color, 7, 21)
    elif mode == "deblur":
        sigma = 0.8 + (2.6 * s)
        amount = 1.1 + (1.8 * s)
        np_bgr = _enhance_unsharp(np_bgr, amount=amount, sigma=sigma)
    elif mode == "sharpen":
        sigma = 0.7 + (2.0 * s)
        amount = 0.8 + (2.6 * s)
        np_bgr = _enhance_unsharp(np_bgr, amount=amount, sigma=sigma)
    elif mode == "low_light":
        lab = cv2.cvtColor(np_bgr, cv2.COLOR_BGR2LAB)
        l_channel, a_channel, b_channel = cv2.split(lab)
        mean_l = float(np.mean(l_channel) / 255.0)
        if mean_l <= 0:
            gamma = 0.85
        else:
            target = 0.58 + (0.12 * s)
            gamma = float(np.clip(np.log(target) / np.log(max(mean_l, 1e-3)), 0.45, 1.35))
        lut = np.array([((i / 255.0) ** gamma) * 255 for i in range(256)], dtype=np.float32).clip(0, 255).astype(np.uint8)
        l_gamma = cv2.LUT(l_channel, lut)
        clahe = cv2.createCLAHE(clipLimit=(2.0 + 4.0 * s), tileGridSize=(8, 8))
        l_enhanced = clahe.apply(l_gamma)
        lab_enhanced = cv2.merge((l_enhanced, a_channel, b_channel))
        np_bgr = cv2.cvtColor(lab_enhanced, cv2.COLOR_LAB2BGR)
        np_bgr = cv2.fastNlMeansDenoisingColored(np_bgr, None, int(round(3 + 8 * s)), int(round(3 + 8 * s)), 7, 21)
    else:
        raise ValueError(f"Unsupported enhance mode: {mode}")

    out_rgb = cv2.cvtColor(np_bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(out_rgb)


@app.route("/health", methods=["GET"])
def health():
    payload = {
        "status": "ok" if (RMBG2_AVAILABLE and SAM2_AVAILABLE and LAMA_AVAILABLE) else "not_ready",
        "strict": STRICT_MODE,
        "device": DEVICE,
        "models": {
            "rmbg2": RMBG2_AVAILABLE,
            "sam2": SAM2_AVAILABLE,
            "lama": LAMA_AVAILABLE,
            "realesrgan": REALESRGAN_AVAILABLE,
        },
        "errors": {
            "rmbg2": RMBG2_ERROR,
            "sam2": SAM2_ERROR,
            "lama": LAMA_ERROR,
            "realesrgan": REALESRGAN_ERROR,
        },
        "config": {
            "rmbg2_model_id": RMBG2_MODEL_ID,
            "sam2_config": SAM2_CONFIG_NAME,
            "sam2_weights": SAM2_WEIGHTS_PATH,
            "realesrgan_weights_path": REALESRGAN_WEIGHTS_PATH,
            "realesrgan_enabled": REALESRGAN_ENABLED,
        },
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
        logger.exception("remove-bg/rmbg2 failed")
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
        logger.exception("remove-bg/sam2-refine failed")
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
        mask_pil = decode_b64_to_pil_l(mask_b64)

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
        logger.exception("erase/lama failed")
        return jsonify({"error": str(e)}), 500


@app.route("/enhance", methods=["POST"])
def enhance():
    try:
        data = request.json or {}
        image_b64 = data.get("image") or ""
        if not image_b64:
            return jsonify({"error": "image is required"}), 400

        mode = str(data.get("mode", "upscale")).strip().lower()
        supported_modes = {"upscale", "denoise", "deblur", "sharpen", "low_light"}
        if mode not in supported_modes:
            return jsonify({"error": f"Unsupported mode: {mode}"}), 400

        source_max_side = clamp_int(data.get("source_max_side", 2048), 256, 8192)
        strength = clamp_float(data.get("strength", 0.5), 0.0, 1.0, 0.5)
        upscale_factor = clamp_float(data.get("upscale_factor", 2.0), 1.0, 4.0, 2.0)

        pil = decode_b64_to_pil(image_b64)
        source_w, source_h = pil.size
        model_input, scale = resize_pil_to_max_side(pil, source_max_side)

        if mode == "upscale":
            ok, err = require_ready({"realesrgan": REALESRGAN_AVAILABLE})
            if not ok:
                return err, 503
            outscale = 4.0 if upscale_factor >= 3.0 else 2.0
            out_pil = enhance_upscale_realesrgan(model_input, outscale=outscale)
            engine = "realesrgan"
        else:
            out_pil = enhance_with_opencv(model_input, mode=mode, strength=strength)
            if scale != 1.0:
                out_pil = out_pil.resize((source_w, source_h), resample=Image.LANCZOS)
            engine = "opencv"

        return jsonify(
            {
                "mode": mode,
                "engine": engine,
                "source_width": source_w,
                "source_height": source_h,
                "width": out_pil.size[0],
                "height": out_pil.size[1],
                "result_png": pil_to_png_b64(out_pil),
            }
        )
    except Exception as e:
        logger.exception("enhance failed")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    logger.info("Starting on 0.0.0.0:%s (device=%s)", port, DEVICE)
    app.run(host="0.0.0.0", port=port, debug=debug)
