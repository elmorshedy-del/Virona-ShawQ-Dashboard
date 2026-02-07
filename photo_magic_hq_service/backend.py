"""
Photo Magic HQ Service (GPU)
===========================

Implements:
- SDXL inpainting (High Quality Magic Eraser)

Input/Output:
- Images are passed as base64 (data: prefix optional).
- Returns base64 PNG for results.

Strict mode:
- If PHOTO_MAGIC_HQ_STRICT=true (default), /health returns 503 until SDXL is ready.
- By default, this service requires a GPU; set PHOTO_MAGIC_HQ_ALLOW_CPU=true for dev.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import warnings
from typing import Any

import cv2
import numpy as np
import torch
from diffusers import AutoPipelineForInpainting
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("photo_magic_hq_service")

app = Flask(__name__)

CORS_ORIGINS = [o.strip() for o in os.environ.get("PHOTO_MAGIC_HQ_CORS_ORIGINS", "").split(",") if o.strip()]
if CORS_ORIGINS:
    CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}})

SERVICE_TOKEN = os.environ.get("PHOTO_MAGIC_HQ_TOKEN", "").strip()

MAX_IMAGE_BYTES = int(os.environ.get("PHOTO_MAGIC_MAX_IMAGE_BYTES", str(25 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.environ.get("PHOTO_MAGIC_MAX_IMAGE_PIXELS", "60000000"))

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
warnings.simplefilter("error", Image.DecompressionBombWarning)

STRICT_MODE = os.environ.get("PHOTO_MAGIC_HQ_STRICT", "true").lower() in ("1", "true", "yes")
ALLOW_CPU = os.environ.get("PHOTO_MAGIC_HQ_ALLOW_CPU", "false").lower() in ("1", "true", "yes")

DEFAULT_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DEVICE = os.environ.get("PHOTO_MAGIC_HQ_DEVICE", DEFAULT_DEVICE)

MODEL_ID = os.environ.get("SDXL_INPAINT_MODEL_ID", "diffusers/stable-diffusion-xl-1.0-inpainting-0.1")

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


def decode_b64_to_pil_rgb(b64: str) -> Image.Image:
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
    return cv2.GaussianBlur(mask_u8, (k, k), 0)


def mask_bbox(mask_u8: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(mask_u8 > 0)
    if ys.size == 0 or xs.size == 0:
        return None
    x1 = int(xs.min())
    x2 = int(xs.max())
    y1 = int(ys.min())
    y2 = int(ys.max())
    return x1, y1, x2 + 1, y2 + 1


def to_multiple_of(value: int, multiple: int, minimum: int = 8) -> int:
    n = max(minimum, int(value))
    return max(minimum, (n // multiple) * multiple)


def resize_to_longest_side(img: Image.Image, target: int = 1024, resample=Image.LANCZOS) -> tuple[Image.Image, tuple[int, int]]:
    w, h = img.size
    if w <= 0 or h <= 0:
        raise ValueError("Invalid image size")
    scale = float(target) / float(max(w, h))
    new_w = int(round(w * scale))
    new_h = int(round(h * scale))
    new_w = to_multiple_of(new_w, 8, minimum=64)
    new_h = to_multiple_of(new_h, 8, minimum=64)
    if new_w == w and new_h == h:
        return img, (w, h)
    return img.resize((new_w, new_h), resample=resample), (w, h)


def composite_with_alpha(base_rgb: np.ndarray, overlay_rgb: np.ndarray, alpha_u8: np.ndarray) -> np.ndarray:
    alpha = (alpha_u8.astype(np.float32) / 255.0)[..., None]
    return (overlay_rgb.astype(np.float32) * alpha + base_rgb.astype(np.float32) * (1.0 - alpha)).clip(0, 255).astype(
        np.uint8
    )


SDXL_AVAILABLE = False
SDXL_ERROR = None
pipe = None


def load_pipeline() -> None:
    global SDXL_AVAILABLE, SDXL_ERROR, pipe

    if DEVICE == "cpu" and not ALLOW_CPU:
        SDXL_AVAILABLE = False
        SDXL_ERROR = "GPU is required for SDXL HQ. Set PHOTO_MAGIC_HQ_ALLOW_CPU=true to allow CPU (very slow)."
        return

    dtype = torch.float16 if DEVICE != "cpu" else torch.float32

    try:
        pipe = AutoPipelineForInpainting.from_pretrained(
            MODEL_ID,
            torch_dtype=dtype,
            variant="fp16" if dtype == torch.float16 else None,
        )
    except TypeError:
        pipe = AutoPipelineForInpainting.from_pretrained(MODEL_ID, torch_dtype=dtype)
    except Exception:
        pipe = AutoPipelineForInpainting.from_pretrained(MODEL_ID, torch_dtype=dtype)

    pipe = pipe.to(DEVICE)
    try:
        pipe.enable_attention_slicing()
    except Exception:
        pass

    SDXL_AVAILABLE = True
    SDXL_ERROR = None


logger.info("Loading SDXL inpainting pipeline...")
try:
    load_pipeline()
    if SDXL_AVAILABLE:
        logger.info("✓ SDXL loaded")
    else:
        logger.warning("✗ SDXL not ready: %s", SDXL_ERROR)
except Exception as e:
    SDXL_AVAILABLE = False
    SDXL_ERROR = str(e)
    logger.warning("✗ SDXL load failed: %s", e)


@app.route("/health", methods=["GET"])
def health():
    ok = bool(SDXL_AVAILABLE and pipe is not None)
    payload = {
        "status": "ok" if ok else "not_ready",
        "strict": STRICT_MODE,
        "device": DEVICE,
        "cuda_available": bool(torch.cuda.is_available()),
        "models": {"sdxl_inpaint": ok},
        "errors": {"sdxl_inpaint": SDXL_ERROR},
        "config": {"model_id": MODEL_ID, "allow_cpu": ALLOW_CPU},
    }
    if STRICT_MODE and not ok:
        return jsonify(payload), 503
    return jsonify(payload)


@app.route("/erase/sdxl", methods=["POST"])
def erase_sdxl():
    try:
        if STRICT_MODE and not SDXL_AVAILABLE:
            return jsonify({"error": "SDXL not ready (strict mode)", "details": SDXL_ERROR}), 503

        data = request.json or {}
        image_b64 = data.get("image") or ""
        mask_b64 = data.get("mask") or ""
        if not image_b64 or not mask_b64:
            return jsonify({"error": "image and mask are required"}), 400

        prompt = str(data.get("prompt") or "").strip()
        negative_prompt = str(data.get("negative_prompt") or "").strip()

        num_inference_steps = clamp_int(data.get("num_inference_steps", 20), 5, 80)
        guidance_scale = clamp_float(data.get("guidance_scale", 8.0), 0.0, 20.0, 8.0)
        strength = clamp_float(data.get("strength", 0.99), 0.0, 1.0, 0.99)
        seed = clamp_int(data.get("seed", 0), 0, 2**63 - 1)

        dilate_px = clamp_int(data.get("mask_dilate_px", 8), 0, 64)
        feather_px = clamp_int(data.get("mask_feather_px", 8), 0, 64)
        crop_to_mask = bool(data.get("crop_to_mask", True))
        crop_margin_px = clamp_int(data.get("crop_margin_px", 128), 0, 2048)

        pil = decode_b64_to_pil_rgb(image_b64)
        mask_pil = decode_b64_to_pil_l(mask_b64)

        if pil.size != mask_pil.size:
            mask_pil = mask_pil.resize(pil.size, resample=Image.NEAREST)

        img_np = np.array(pil)
        mask_np = np.array(mask_pil)
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
        else:
            x1, y1, x2, y2 = 0, 0, img_np.shape[1], img_np.shape[0]
            img_crop = pil
            mask_crop = Image.fromarray(mask_bin)
            alpha_crop = mask_alpha

        img_crop_resized, (orig_w, orig_h) = resize_to_longest_side(img_crop, 1024)
        mask_crop_resized = mask_crop.resize(img_crop_resized.size, resample=Image.NEAREST)
        alpha_crop_resized = cv2.resize(alpha_crop, img_crop_resized.size, interpolation=cv2.INTER_LINEAR)

        generator = torch.Generator(device=DEVICE).manual_seed(int(seed))

        with torch.inference_mode():
            result = pipe(
                prompt=prompt,
                negative_prompt=negative_prompt,
                image=img_crop_resized,
                mask_image=mask_crop_resized,
                guidance_scale=float(guidance_scale),
                num_inference_steps=int(num_inference_steps),
                strength=float(strength),
                generator=generator,
            ).images[0]

        result_back = result.resize((orig_w, orig_h), resample=Image.LANCZOS) if result.size != (orig_w, orig_h) else result

        base_crop = np.array(img_crop)
        over_crop = np.array(result_back.convert("RGB"))
        alpha_back = cv2.resize(alpha_crop_resized, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
        blended_crop = composite_with_alpha(base_crop, over_crop, alpha_back)

        out_np = img_np.copy()
        out_np[y1:y2, x1:x2] = blended_crop
        out_pil = Image.fromarray(out_np)

        return jsonify({"result_png": pil_to_png_b64(out_pil), "width": pil.size[0], "height": pil.size[1]})
    except Exception as e:
        logger.exception("erase/sdxl failed")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    logger.info("Starting on 0.0.0.0:%s (device=%s)", port, DEVICE)
    app.run(host="0.0.0.0", port=port, debug=debug)
