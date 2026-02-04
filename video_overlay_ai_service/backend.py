"""
VIDEO TEXT OVERLAY DETECTION BACKEND
=====================================
Full pipeline: DINO → SAM 2 → Color/Font Detection

Features:
- Grounding DINO: Find text overlay boxes
- SAM 2: Get pixel-perfect masks (handles rounded corners)
- Color Detection: Exact background + text colors from mask
- Font Detection: Size, weight, style estimation

Install:
    pip install -r requirements.txt
    # Optional models:
    pip install segment-anything-2
    pip install groundingdino-py

Weights:
    mkdir weights
    # SAM 2
    wget https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_large.pt -O weights/sam2_hiera_large.pt
    # DINO
    wget https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth -O weights/groundingdino_swint_ogc.pth

Run:
    python backend.py
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import numpy as np
import base64
import easyocr
from PIL import Image
from sklearn.cluster import KMeans
import os
import torch

app = Flask(__name__)
CORS(app)

# Strict mode: do not allow OCR-only or rectangular-mask fallbacks.
STRICT_MODE = os.environ.get('VIDEO_OVERLAY_STRICT', 'true').lower() in ('1', 'true', 'yes')
DEFAULT_DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
DEVICE = os.environ.get('VIDEO_OVERLAY_DEVICE', DEFAULT_DEVICE)

# ============================================================================
# MODEL LOADING
# ============================================================================

print("Loading models...")

# EasyOCR - always available
reader = easyocr.Reader(['en'], gpu=False)
print("✓ EasyOCR loaded")

# Grounding DINO
DINO_AVAILABLE = False
dino_model = None
DINO_ERROR = None
DINO_CONFIG_PATH = None
DINO_WEIGHTS_PATH = None
try:
    from groundingdino.util.inference import load_model as load_dino, predict as dino_predict, Model as DinoInferenceModel
    from torchvision.ops import box_convert

    def resolve_dino_config_path():
        # Prefer local relative path (matches the original project), otherwise try package location.
        direct = os.environ.get('DINO_CONFIG_PATH') or "groundingdino/config/GroundingDINO_SwinT_OGC.py"
        if os.path.exists(direct):
            return direct
        try:
            import groundingdino  # type: ignore
            from pathlib import Path
            pkg_dir = Path(groundingdino.__file__).resolve().parent
            candidate = pkg_dir / "config" / "GroundingDINO_SwinT_OGC.py"
            if candidate.exists():
                return str(candidate)
        except Exception:
            return direct
        return direct

    config_path = resolve_dino_config_path()
    weights_path = "weights/groundingdino_swint_ogc.pth"
    DINO_CONFIG_PATH = config_path
    DINO_WEIGHTS_PATH = weights_path

    if os.path.exists(weights_path):
        dino_model = load_dino(config_path, weights_path, device=DEVICE)
        DINO_AVAILABLE = True
        print("✓ Grounding DINO loaded")
    else:
        DINO_ERROR = f"DINO weights not found at {weights_path}"
        print(f"✗ {DINO_ERROR}")
except Exception as e:
    DINO_ERROR = str(e)
    print(f"✗ Grounding DINO not available: {e}")

# SAM 2
SAM_AVAILABLE = False
sam_predictor = None
SAM_ERROR = None
SAM2_CONFIG_NAME = None
SAM2_WEIGHTS_PATH = None
try:
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    
    sam_weights = "weights/sam2_hiera_large.pt"
    SAM2_WEIGHTS_PATH = sam_weights

    def resolve_sam2_config_name():
        """
        SAM 2 uses Hydra configs packaged under the `sam2` module.
        Passing the real config name avoids reliance on symlinks (some packaging setups
        can turn symlinks like `sam2_hiera_l.yaml` into a 1-line pointer file).
        """
        return (
            os.environ.get('SAM2_CONFIG_NAME')
            or os.environ.get('SAM2_CONFIG_PATH')  # backwards-compatible env var name
            or "configs/sam2/sam2_hiera_l.yaml"
        )

    sam_config = resolve_sam2_config_name()
    SAM2_CONFIG_NAME = sam_config

    def init_sam2_hydra_with_vendored_configs():
        """
        Some container installs of SAM2 omit the `configs/` YAMLs from the built wheel.
        We vendor the needed configs under the local `sam2_configs` module and
        re-initialize Hydra to point at that module.
        """
        from hydra.core.global_hydra import GlobalHydra
        from hydra import initialize_config_module

        # Ensure the module is importable before clearing Hydra.
        import sam2_configs  # noqa: F401

        GlobalHydra.instance().clear()
        initialize_config_module("sam2_configs", version_base="1.2")

    if os.path.exists(sam_weights):
        try:
            sam_model = build_sam2(config_file=sam_config, ckpt_path=sam_weights, device=DEVICE)
        except Exception as e:
            # Retry once with vendored configs if Hydra can't find the requested YAML.
            try:
                init_sam2_hydra_with_vendored_configs()
                sam_model = build_sam2(config_file=sam_config, ckpt_path=sam_weights, device=DEVICE)
            except Exception as e2:
                raise RuntimeError(f"SAM 2 build failed: {e} (after vendored config init: {e2})") from e2
        sam_predictor = SAM2ImagePredictor(sam_model)
        SAM_AVAILABLE = True
        print("✓ SAM 2 loaded")
    else:
        SAM_ERROR = f"SAM 2 weights not found at {sam_weights}"
        print(f"✗ {SAM_ERROR}")
except Exception as e:
    SAM_ERROR = str(e)
    print(f"✗ SAM 2 not available: {e}")

print("Models ready.\n")


# ============================================================================
# COLOR DETECTION (using SAM mask)
# ============================================================================

def extract_colors_from_mask(frame, mask, text_bbox=None):
    """
    Extract exact background and text colors using SAM mask.

    Args:
        frame: BGR image
        mask: Binary mask from SAM (1=overlay, 0=background)
        text_bbox: Optional text bounding box [x1,y1,x2,y2]

    Returns:
        {
            'background': {'rgb': [r,g,b], 'hex': '#rrggbb'},
            'text': {'rgb': [r,g,b], 'hex': '#rrggbb'},
            'is_gradient': bool,
            'gradient': {'from': rgb, 'to': rgb, 'direction': 'vertical'|'horizontal'}
        }
    """
    mask_bool = mask.astype(bool)
    overlay_pixels = frame[mask_bool]

    if len(overlay_pixels) < 50:
        return {
            'background': {'rgb': [50, 50, 50], 'hex': '#323232'},
            'text': {'rgb': [255, 255, 255], 'hex': '#ffffff'},
            'is_gradient': False
        }

    overlay_pixels_rgb = overlay_pixels[:, ::-1]

    try:
        kmeans = KMeans(n_clusters=2, random_state=42, n_init=10)
        kmeans.fit(overlay_pixels_rgb)

        labels, counts = np.unique(kmeans.labels_, return_counts=True)
        bg_idx = labels[np.argmax(counts)]
        text_idx = labels[np.argmin(counts)]

        bg_color = kmeans.cluster_centers_[bg_idx].astype(int)
        text_color = kmeans.cluster_centers_[text_idx].astype(int)
    except Exception:
        bg_color = np.median(overlay_pixels_rgb, axis=0).astype(int)
        brightness = 0.299 * bg_color[0] + 0.587 * bg_color[1] + 0.114 * bg_color[2]
        text_color = np.array([255, 255, 255] if brightness < 128 else [0, 0, 0])

    is_gradient, gradient_info = detect_gradient(frame, mask)

    result = {
        'background': {'rgb': bg_color.tolist(), 'hex': rgb_to_hex(bg_color)},
        'text': {'rgb': text_color.tolist(), 'hex': rgb_to_hex(text_color)},
        'is_gradient': is_gradient
    }

    if is_gradient:
        result['gradient'] = gradient_info

    return result


def detect_gradient(frame, mask):
    """Detect if overlay has gradient background."""
    mask_bool = mask.astype(bool)

    rows = np.any(mask_bool, axis=1)
    cols = np.any(mask_bool, axis=0)

    if not np.any(rows) or not np.any(cols):
        return False, None

    y1, y2 = np.where(rows)[0][[0, -1]]
    x1, x2 = np.where(cols)[0][[0, -1]]

    strip_height = max(3, (y2 - y1) // 10)

    top_region = frame[y1:y1 + strip_height, x1:x2]
    bottom_region = frame[y2 - strip_height:y2, x1:x2]

    top_color = np.median(top_region.reshape(-1, 3), axis=0)[::-1]
    bottom_color = np.median(bottom_region.reshape(-1, 3), axis=0)[::-1]

    v_diff = np.linalg.norm(top_color - bottom_color)

    strip_width = max(3, (x2 - x1) // 10)
    left_region = frame[y1:y2, x1:x1 + strip_width]
    right_region = frame[y1:y2, x2 - strip_width:x2]

    left_color = np.median(left_region.reshape(-1, 3), axis=0)[::-1]
    right_color = np.median(right_region.reshape(-1, 3), axis=0)[::-1]

    h_diff = np.linalg.norm(left_color - right_color)

    threshold = 30

    if v_diff > threshold and v_diff > h_diff:
        return True, {
            'direction': 'vertical',
            'from': {'rgb': top_color.astype(int).tolist(), 'hex': rgb_to_hex(top_color)},
            'to': {'rgb': bottom_color.astype(int).tolist(), 'hex': rgb_to_hex(bottom_color)}
        }
    elif h_diff > threshold:
        return True, {
            'direction': 'horizontal',
            'from': {'rgb': left_color.astype(int).tolist(), 'hex': rgb_to_hex(left_color)},
            'to': {'rgb': right_color.astype(int).tolist(), 'hex': rgb_to_hex(right_color)}
        }

    return False, None


# ============================================================================
# FONT DETECTION
# ============================================================================

def detect_font_properties(frame, mask, text_bbox, detected_text):
    """
    Estimate font properties from the text region.
    """
    x1, y1, x2, y2 = text_bbox
    text_height = y2 - y1
    text_width = x2 - x1

    font_size = int(text_height * 0.85)

    text_roi = frame[int(y1):int(y2), int(x1):int(x2)]

    if text_roi.size == 0:
        return {
            'size': font_size,
            'weight': 'normal',
            'style': 'normal',
            'family': 'sans-serif',
            'suggested_fonts': ['Arial', 'Helvetica', 'Open Sans']
        }

    gray = cv2.cvtColor(text_roi, cv2.COLOR_BGR2GRAY)

    weight = detect_font_weight(gray)
    style = detect_font_style(gray)
    family = detect_font_family(gray)
    suggested = suggest_fonts(family, weight)

    return {
        'size': font_size,
        'weight': weight,
        'style': style,
        'family': family,
        'suggested_fonts': suggested,
        'line_height': int(text_height),
        'letter_spacing': estimate_letter_spacing(text_width, detected_text)
    }


def detect_font_weight(gray_roi):
    _, binary = cv2.threshold(gray_roi, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return 'normal'

    dist = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    stroke_pixels = dist[dist > 0]
    if len(stroke_pixels) == 0:
        return 'normal'

    avg_stroke = np.mean(stroke_pixels)
    height = gray_roi.shape[0]
    stroke_ratio = avg_stroke / height
    return 'bold' if stroke_ratio > 0.08 else 'normal'


def detect_font_style(gray_roi):
    edges = cv2.Canny(gray_roi, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 20, minLineLength=10, maxLineGap=5)
    if lines is None or len(lines) < 3:
        return 'normal'

    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        if abs(y2 - y1) > abs(x2 - x1):
            angle = np.arctan2(x2 - x1, y2 - y1) * 180 / np.pi
            angles.append(angle)

    if not angles:
        return 'normal'

    avg_angle = np.median(angles)
    return 'italic' if abs(avg_angle) > 8 else 'normal'


def detect_font_family(gray_roi):
    _, binary = cv2.threshold(gray_roi, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    edges = cv2.Canny(binary, 50, 150)
    edge_density = np.sum(edges > 0) / edges.size
    if edge_density > 0.15:
        return 'serif'
    return 'sans-serif'


def suggest_fonts(family, weight):
    fonts = {
        'sans-serif': {
            'normal': ['Arial', 'Helvetica', 'Open Sans', 'Roboto', 'Segoe UI'],
            'bold': ['Arial Bold', 'Helvetica Bold', 'Open Sans Bold', 'Roboto Bold']
        },
        'serif': {
            'normal': ['Times New Roman', 'Georgia', 'Garamond', 'Palatino'],
            'bold': ['Times New Roman Bold', 'Georgia Bold']
        },
        'monospace': {
            'normal': ['Courier New', 'Consolas', 'Monaco', 'Roboto Mono'],
            'bold': ['Courier New Bold', 'Consolas Bold']
        }
    }
    return fonts.get(family, fonts['sans-serif']).get(weight, fonts['sans-serif']['normal'])


def estimate_letter_spacing(text_width, text):
    if not text or len(text) < 2:
        return 0
    return 0


# ============================================================================
# MAIN DETECTION PIPELINE
# ============================================================================

def detect_overlays(frame):
    h, w = frame.shape[:2]
    results = []

    if STRICT_MODE and not DINO_AVAILABLE:
        raise RuntimeError("Grounding DINO is required (strict mode) but is not available.")
    if STRICT_MODE and not SAM_AVAILABLE:
        raise RuntimeError("SAM 2 is required (strict mode) but is not available.")

    boxes = find_boxes_with_dino(frame) if DINO_AVAILABLE else []

    for box_info in boxes:
        x1, y1, x2, y2 = box_info['box']

        if not SAM_AVAILABLE:
            if STRICT_MODE:
                raise RuntimeError("SAM 2 is required (strict mode) but is not available.")
            mask = create_rect_mask(frame.shape[:2], [x1, y1, x2, y2])
        else:
            mask = get_sam_mask(frame, [x1, y1, x2, y2])

            if mask is None:
                raise RuntimeError("SAM 2 mask generation failed.")

            if np.any(mask):
                rows = np.any(mask, axis=1)
                cols = np.any(mask, axis=0)
                y1_new, y2_new = np.where(rows)[0][[0, -1]]
                x1_new, x2_new = np.where(cols)[0][[0, -1]]
                x1, y1, x2, y2 = x1_new, y1_new, x2_new, y2_new

        colors = extract_colors_from_mask(frame, mask)

        roi = frame[int(y1):int(y2), int(x1):int(x2)]
        text = ""
        text_bbox = None

        if roi.size > 0:
            ocr_results = reader.readtext(roi)
            if ocr_results:
                text = " ".join([r[1] for r in ocr_results])
                tx1 = min(r[0][0][0] for r in ocr_results) + x1
                ty1 = min(r[0][0][1] for r in ocr_results) + y1
                tx2 = max(r[0][2][0] for r in ocr_results) + x1
                ty2 = max(r[0][2][1] for r in ocr_results) + y1
                text_bbox = [tx1, ty1, tx2, ty2]

        if text_bbox:
            font_info = detect_font_properties(frame, mask, text_bbox, text)
        else:
            font_info = {
                'size': int((y2 - y1) * 0.6),
                'weight': 'normal',
                'style': 'normal',
                'family': 'sans-serif',
                'suggested_fonts': ['Arial', 'Helvetica']
            }

        results.append({
            'x': int(x1),
            'y': int(y1),
            'width': int(x2 - x1),
            'height': int(y2 - y1),
            'text': text or "Detected",
            'colors': colors,
            'font': font_info,
            'confidence': box_info.get('confidence', 0.9)
        })

    return results


def find_boxes_with_dino(frame):
    h, w = frame.shape[:2]
    TEXT_PROMPT = "text box. subtitle. caption. text overlay. lower third. label."

    # GroundingDINO expects a normalized torch.Tensor image (C,H,W).
    processed_image = DinoInferenceModel.preprocess_image(image_bgr=frame)

    boxes, logits, phrases = dino_predict(
        model=dino_model,
        image=processed_image,
        caption=TEXT_PROMPT,
        box_threshold=0.30,
        text_threshold=0.25,
        device=DEVICE
    )

    # Convert normalized cxcywh -> xyxy pixels
    boxes_xyxy = box_convert(boxes=boxes, in_fmt="cxcywh", out_fmt="xyxy")
    boxes_xyxy = boxes_xyxy * torch.tensor([w, h, w, h])

    results = []
    for box, score in zip(boxes_xyxy, logits):
        x1, y1, x2, y2 = [float(v) for v in box.tolist()]

        if (x2 - x1) < 20 or (y2 - y1) < 10:
            continue

        results.append({
            'box': [int(x1), int(y1), int(x2), int(y2)],
            'confidence': float(score)
        })

    return results


def find_boxes_with_ocr(frame):
    results = reader.readtext(frame)
    if not results:
        return []

    lines = group_into_lines(results)
    boxes = []

    for line in lines:
        x1 = min(r[0][0][0] for r in line)
        y1 = min(r[0][0][1] for r in line)
        x2 = max(r[0][2][0] for r in line)
        y2 = max(r[0][2][1] for r in line)

        expanded = expand_to_edges(frame, int(x1), int(y1), int(x2), int(y2))

        boxes.append({
            'box': [expanded['x'], expanded['y'],
                    expanded['x'] + expanded['width'],
                    expanded['y'] + expanded['height']],
            'confidence': sum(r[2] for r in line) / len(line)
        })

    return boxes


def group_into_lines(ocr_results):
    if not ocr_results:
        return []

    sorted_results = sorted(ocr_results, key=lambda r: r[0][0][1])

    lines = []
    current_line = [sorted_results[0]]

    for r in sorted_results[1:]:
        last_y = current_line[-1][0][0][1]
        curr_y = r[0][0][1]
        line_height = current_line[-1][0][2][1] - current_line[-1][0][0][1]

        if abs(curr_y - last_y) < line_height * 0.6:
            current_line.append(r)
        else:
            current_line.sort(key=lambda x: x[0][0][0])
            lines.append(current_line)
            current_line = [r]

    current_line.sort(key=lambda x: x[0][0][0])
    lines.append(current_line)

    return lines


def expand_to_edges(frame, x1, y1, x2, y2):
    h, w = frame.shape[:2]
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2

    sample_points = [
        (cx, max(0, y1 - 3)),
        (cx, min(h - 1, y2 + 3)),
        (max(0, x1 - 3), cy),
        (min(w - 1, x2 + 3), cy),
    ]

    colors = [frame[py, px].astype(float) for px, py in sample_points if 0 <= px < w and 0 <= py < h]

    if not colors:
        pad = 12
        return {'x': max(0, x1 - pad), 'y': max(0, y1 - pad),
                'width': min(w, x2 + pad) - max(0, x1 - pad),
                'height': min(h, y2 + pad) - max(0, y1 - pad)}

    bg_color = np.median(colors, axis=0)

    threshold = 40
    max_search = 50

    top = y1
    for y in range(y1, max(0, y1 - max_search), -1):
        if np.linalg.norm(frame[y, cx].astype(float) - bg_color) > threshold:
            top = y + 1
            break

    bottom = y2
    for y in range(y2, min(h, y2 + max_search)):
        if np.linalg.norm(frame[y, cx].astype(float) - bg_color) > threshold:
            bottom = y - 1
            break

    left = x1
    for x in range(x1, max(0, x1 - max_search), -1):
        if np.linalg.norm(frame[cy, x].astype(float) - bg_color) > threshold:
            left = x + 1
            break

    right = x2
    for x in range(x2, min(w, x2 + max_search)):
        if np.linalg.norm(frame[cy, x].astype(float) - bg_color) > threshold:
            right = x - 1
            break

    return {'x': left, 'y': top, 'width': right - left, 'height': bottom - top}


def get_sam_mask(frame, box):
    try:
        sam_predictor.set_image(frame)
        masks, scores, _ = sam_predictor.predict(
            box=np.array(box),
            multimask_output=False
        )
        return masks[0].astype(np.uint8)
    except Exception as e:
        print(f"SAM error: {e}")
        return None


def create_rect_mask(shape, box):
    mask = np.zeros(shape, dtype=np.uint8)
    x1, y1, x2, y2 = [int(v) for v in box]
    mask[y1:y2, x1:x2] = 1
    return mask


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def rgb_to_hex(rgb):
    r, g, b = [int(max(0, min(255, v))) for v in rgb]
    return f'#{r:02x}{g:02x}{b:02x}'


# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.route('/detect', methods=['POST'])
def detect():
    try:
        data = request.json
        image_b64 = data.get('image', '') if data else ''

        if STRICT_MODE and (not DINO_AVAILABLE or not SAM_AVAILABLE):
            return jsonify({
                'error': 'Models not ready (strict mode)',
                'models': {'dino': DINO_AVAILABLE, 'sam2': SAM_AVAILABLE, 'ocr': True}
            }), 503

        if not image_b64:
            return jsonify({'error': 'image is required'}), 400

        img_bytes = base64.b64decode(image_b64)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        frame = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({'error': 'Invalid image'}), 400

        results = detect_overlays(frame)
        return jsonify(results)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/health', methods=['GET'])
def health():
    payload = {
        'status': 'ok' if (DINO_AVAILABLE and SAM_AVAILABLE) else 'not_ready',
        'strict': STRICT_MODE,
        'device': DEVICE,
        'models': {
            'dino': DINO_AVAILABLE,
            'sam2': SAM_AVAILABLE,
            'ocr': True
        },
        'paths': {
            'dino_config': DINO_CONFIG_PATH,
            'dino_weights': DINO_WEIGHTS_PATH,
            'sam2_config': SAM2_CONFIG_NAME,
            'sam2_weights': SAM2_WEIGHTS_PATH
        },
        'errors': {
            'dino': DINO_ERROR,
            'sam2': SAM_ERROR
        }
    }

    if STRICT_MODE and (not DINO_AVAILABLE or not SAM_AVAILABLE):
        return jsonify(payload), 503

    return jsonify(payload)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("  VIDEO TEXT OVERLAY DETECTION BACKEND")
    print("=" * 60)
    print(f"  DINO:  {'✓ Ready' if DINO_AVAILABLE else '✗ Not available'}")
    print(f"  SAM 2: {'✓ Ready' if SAM_AVAILABLE else '✗ Not available'}")
    print(f"  OCR:   ✓ Ready")
    print("=" * 60)

    port = int(os.environ.get('PORT', '5000'))
    debug = os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes')
    print(f"  Starting server on http://localhost:{port}")
    print("=" * 60 + "\n")

    app.run(host='0.0.0.0', port=port, debug=debug)
