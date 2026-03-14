from __future__ import annotations

import base64
import io
import shutil
import subprocess
import sys
from dataclasses import dataclass
from multiprocessing import get_context
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterable
from xml.etree import ElementTree as ET

from PIL import Image


VECTORIZE_MAX_INPUT_BYTES = 8 * 1024 * 1024
VECTORIZE_DEFAULT_EXTENSION = ".png"
VECTORIZE_TIMEOUT_SEC = 8
POTRACE_TIMEOUT_SEC = 8
POTRACE_COLOR_LIMIT = 6
ALPHA_THRESHOLD = 8
BACKGROUND_SAMPLE_RATIO = 0.65
BACKGROUND_DISTANCE_THRESHOLD = 36
WHITE_CUTOFF = 244
SVG_NAMESPACE = "http://www.w3.org/2000/svg"


ET.register_namespace("", SVG_NAMESPACE)


@dataclass(frozen=True)
class VectorPreset:
    colormode: str
    hierarchical: str
    mode: str
    filter_speckle: int
    color_precision: int
    layer_difference: int
    corner_threshold: int
    length_threshold: float
    max_iterations: int
    splice_threshold: int
    path_precision: int


VECTOR_PRESETS: dict[str, VectorPreset] = {
    "color": VectorPreset(
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=4,
        color_precision=6,
        layer_difference=16,
        corner_threshold=60,
        length_threshold=4.0,
        max_iterations=10,
        splice_threshold=45,
        path_precision=2,
    ),
    "monochrome": VectorPreset(
        colormode="binary",
        hierarchical="cutout",
        mode="spline",
        filter_speckle=6,
        color_precision=6,
        layer_difference=16,
        corner_threshold=55,
        length_threshold=3.5,
        max_iterations=10,
        splice_threshold=45,
        path_precision=2,
    ),
}


class VectorizationUnavailableError(RuntimeError):
    """Raised when the vectorization engine is not installed."""


class VectorizationTimeoutError(RuntimeError):
    """Raised when the vectorizer stalls."""


def _safe_suffix(filename: str) -> str:
    suffix = Path(str(filename or "")).suffix.lower().strip()
    if suffix in {".png", ".jpg", ".jpeg", ".bmp", ".webp"}:
        return suffix
    return VECTORIZE_DEFAULT_EXTENSION


def decode_base64_image(raw_value: str) -> bytes:
    value = str(raw_value or "").strip()
    if not value:
        raise ValueError("image_base64 is required")
    if "," in value and value.startswith("data:"):
        value = value.split(",", 1)[1].strip()
    try:
        payload = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise ValueError("image_base64 must be valid base64 image data") from exc
    if not payload:
        raise ValueError("image_base64 is empty")
    if len(payload) > VECTORIZE_MAX_INPUT_BYTES:
        raise ValueError("image is too large for vectorization")
    return payload


def vectorize_image_bytes(
    image_bytes: bytes,
    *,
    filename: str = "upload.png",
    preset_name: str = "color",
) -> str:
    primary_error: Exception | None = None
    if _supports_vtracer_spawn():
        try:
            return _vectorize_with_vtracer(image_bytes, filename=filename, preset_name=preset_name)
        except (VectorizationUnavailableError, VectorizationTimeoutError, RuntimeError) as exc:
            primary_error = exc

    try:
        return _vectorize_with_potrace(image_bytes, preset_name=preset_name)
    except (VectorizationUnavailableError, RuntimeError) as fallback_exc:
        if primary_error is not None:
            raise type(primary_error)(str(primary_error)) from fallback_exc
        raise fallback_exc


def _supports_vtracer_spawn() -> bool:
    main_module = sys.modules.get("__main__")
    main_file = str(getattr(main_module, "__file__", "") or "").strip()
    return bool(main_file and Path(main_file).exists())


def _vectorize_with_vtracer(
    image_bytes: bytes,
    *,
    filename: str = "upload.png",
    preset_name: str = "color",
) -> str:
    preset = VECTOR_PRESETS.get(preset_name, VECTOR_PRESETS["color"])
    queue_ctx = get_context("spawn")
    result_queue = queue_ctx.Queue()
    process = queue_ctx.Process(
        target=_vectorize_worker,
        args=(image_bytes, filename, preset, result_queue),
        daemon=True,
    )
    process.start()
    process.join(VECTORIZE_TIMEOUT_SEC)

    if process.is_alive():  # pragma: no cover - depends on runtime behavior
        process.terminate()
        process.join(timeout=1)
        raise VectorizationTimeoutError(
            "vectorization timed out; this runtime may not support stable SVG tracing yet"
        )

    if result_queue.empty():
        raise RuntimeError("vectorization failed without a result")

    status, payload = result_queue.get()
    if status == "ok":
        return str(payload)
    if status == "missing":
        raise VectorizationUnavailableError(str(payload))
    raise RuntimeError(str(payload))


def _vectorize_with_potrace(image_bytes: bytes, *, preset_name: str) -> str:
    potrace_bin = shutil.which("potrace")
    if not potrace_bin:
        raise VectorizationUnavailableError(
            "potrace is not installed; install it or provide a compatible SVG tracer runtime"
        )

    image = _prepare_image(image_bytes)
    if preset_name == "monochrome":
        return _trace_monochrome_svg(image, potrace_bin=potrace_bin)
    return _trace_color_svg(image, potrace_bin=potrace_bin)


def _prepare_image(image_bytes: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    except Exception as exc:
        raise RuntimeError("uploaded artwork could not be decoded into an image") from exc
    return _make_flat_background_transparent(image)


def _make_flat_background_transparent(image: Image.Image) -> Image.Image:
    width, height = image.size
    corners = [
        image.getpixel((0, 0)),
        image.getpixel((max(width - 1, 0), 0)),
        image.getpixel((0, max(height - 1, 0))),
        image.getpixel((max(width - 1, 0), max(height - 1, 0))),
    ]
    opaque_corners = [pixel for pixel in corners if pixel[3] >= ALPHA_THRESHOLD]
    if len(opaque_corners) < 3:
        return image

    base = opaque_corners[0]
    if any(_rgba_distance(base, pixel) > BACKGROUND_DISTANCE_THRESHOLD for pixel in opaque_corners[1:]):
        return image

    pixels = image.load()
    border_positions = list(_iter_border_positions(width, height))
    if not border_positions:
        return image

    similar_border = 0
    for x, y in border_positions:
        pixel = pixels[x, y]
        if pixel[3] < ALPHA_THRESHOLD:
            continue
        if _rgba_distance(base, pixel) <= BACKGROUND_DISTANCE_THRESHOLD:
            similar_border += 1
    if similar_border / max(len(border_positions), 1) < BACKGROUND_SAMPLE_RATIO:
        return image

    cleaned = image.copy()
    cleaned_pixels = cleaned.load()
    for y in range(height):
        for x in range(width):
            pixel = cleaned_pixels[x, y]
            if pixel[3] < ALPHA_THRESHOLD:
                cleaned_pixels[x, y] = (255, 255, 255, 0)
                continue
            if _rgba_distance(base, pixel) <= BACKGROUND_DISTANCE_THRESHOLD:
                cleaned_pixels[x, y] = (pixel[0], pixel[1], pixel[2], 0)
    return cleaned


def _trace_monochrome_svg(image: Image.Image, *, potrace_bin: str) -> str:
    grayscale = image.convert("L")
    alpha = image.getchannel("A")
    mask = Image.new("1", image.size, 0)
    gray_pixels = grayscale.load()
    alpha_pixels = alpha.load()
    mask_pixels = mask.load()
    width, height = image.size

    for y in range(height):
        for x in range(width):
            if alpha_pixels[x, y] < ALPHA_THRESHOLD:
                continue
            mask_pixels[x, y] = 255 if gray_pixels[x, y] < WHITE_CUTOFF else 0

    return _run_potrace_svg(mask, potrace_bin=potrace_bin, fill="#111111")


def _trace_color_svg(image: Image.Image, *, potrace_bin: str) -> str:
    flattened = Image.new("RGBA", image.size, (255, 255, 255, 0))
    flattened.alpha_composite(image)
    quantized = flattened.convert("RGB").quantize(colors=POTRACE_COLOR_LIMIT, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette() or []
    indexed = quantized.load()
    alpha = image.getchannel("A").load()
    width, height = image.size

    layer_counts: dict[int, int] = {}
    for y in range(height):
        for x in range(width):
            if alpha[x, y] < ALPHA_THRESHOLD:
                continue
            index = indexed[x, y]
            layer_counts[index] = layer_counts.get(index, 0) + 1

    if not layer_counts:
        raise RuntimeError("no visible artwork found to convert")

    background_index = _detect_background_index(layer_counts, palette, width, height)
    layer_svgs: list[tuple[int, str, str]] = []
    for index, pixel_count in sorted(layer_counts.items(), key=lambda item: item[1], reverse=True):
        if index == background_index:
            continue
        fill = _palette_hex(palette, index)
        mask = Image.new("1", image.size, 0)
        mask_pixels = mask.load()
        for y in range(height):
            for x in range(width):
                if alpha[x, y] < ALPHA_THRESHOLD:
                    continue
                if indexed[x, y] == index:
                    mask_pixels[x, y] = 255
        if mask.getbbox() is None:
            continue
        svg = _run_potrace_svg(mask, potrace_bin=potrace_bin, fill=fill)
        layer_svgs.append((pixel_count, fill, svg))

    if not layer_svgs:
        return _trace_monochrome_svg(image, potrace_bin=potrace_bin)
    return _merge_svg_layers([svg for _, _, svg in layer_svgs])


def _detect_background_index(
    layer_counts: dict[int, int],
    palette: list[int],
    width: int,
    height: int,
) -> int | None:
    total_pixels = max(width * height, 1)
    candidate_index, candidate_pixels = max(layer_counts.items(), key=lambda item: item[1])
    if candidate_pixels / total_pixels < 0.35:
        return None
    red, green, blue = _palette_rgb(palette, candidate_index)
    if min(red, green, blue) < 245:
        return None
    return candidate_index


def _run_potrace_svg(mask: Image.Image, *, potrace_bin: str, fill: str) -> str:
    with TemporaryDirectory(prefix="creative-dna-potrace-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        input_path = tmp_path / "mask.pbm"
        output_path = tmp_path / "mask.svg"
        mask.save(input_path)
        try:
            subprocess.run(
                [potrace_bin, str(input_path), "--svg", "--output", str(output_path)],
                check=True,
                capture_output=True,
                text=True,
                timeout=POTRACE_TIMEOUT_SEC,
            )
        except FileNotFoundError as exc:
            raise VectorizationUnavailableError(
                "potrace is not installed; install it or provide a compatible SVG tracer runtime"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise VectorizationTimeoutError("vectorization timed out while tracing SVG output") from exc
        except subprocess.CalledProcessError as exc:
            stderr = " ".join(str(exc.stderr or "").split())
            raise RuntimeError(stderr or "potrace could not convert the uploaded artwork") from exc
        return _recolor_svg(output_path.read_text(encoding="utf-8"), fill=fill)


def _recolor_svg(svg_text: str, *, fill: str) -> str:
    root = ET.fromstring(svg_text)
    namespace = {"svg": SVG_NAMESPACE}
    for group in root.findall(".//svg:g", namespace):
        group.set("fill", fill)
        group.set("stroke", "none")
    for path in root.findall(".//svg:path", namespace):
        path.set("fill", fill)
        path.set("stroke", "none")
    return ET.tostring(root, encoding="unicode")


def _merge_svg_layers(layers: Iterable[str]) -> str:
    parsed_layers = [ET.fromstring(layer) for layer in layers]
    if not parsed_layers:
        raise RuntimeError("no SVG layers were generated")

    root_template = parsed_layers[0]
    merged_root = ET.Element(
        f"{{{SVG_NAMESPACE}}}svg",
        {
            "version": root_template.attrib.get("version", "1.0"),
            "width": root_template.attrib.get("width", "100%"),
            "height": root_template.attrib.get("height", "100%"),
            "viewBox": root_template.attrib.get("viewBox", ""),
            "preserveAspectRatio": root_template.attrib.get("preserveAspectRatio", "xMidYMid meet"),
        },
    )
    for layer_root in parsed_layers:
        for child in list(layer_root):
            merged_root.append(child)
    return ET.tostring(merged_root, encoding="unicode")


def _iter_border_positions(width: int, height: int) -> Iterable[tuple[int, int]]:
    if width <= 0 or height <= 0:
        return []
    positions: list[tuple[int, int]] = []
    for x in range(width):
        positions.append((x, 0))
        if height > 1:
            positions.append((x, height - 1))
    for y in range(1, max(height - 1, 1)):
        positions.append((0, y))
        if width > 1:
            positions.append((width - 1, y))
    return positions


def _rgba_distance(left: tuple[int, int, int, int], right: tuple[int, int, int, int]) -> int:
    return max(abs(left[idx] - right[idx]) for idx in range(4))


def _palette_rgb(palette: list[int], index: int) -> tuple[int, int, int]:
    offset = index * 3
    return (
        int(palette[offset] if offset < len(palette) else 0),
        int(palette[offset + 1] if offset + 1 < len(palette) else 0),
        int(palette[offset + 2] if offset + 2 < len(palette) else 0),
    )


def _palette_hex(palette: list[int], index: int) -> str:
    red, green, blue = _palette_rgb(palette, index)
    return f"#{red:02x}{green:02x}{blue:02x}"


def _vectorize_worker(image_bytes: bytes, filename: str, preset: VectorPreset, result_queue) -> None:
    try:
        import vtracer
    except Exception as exc:  # pragma: no cover - depends on runtime install
        result_queue.put(
            (
                "missing",
                "vtracer is not installed; add the dependency before using Convert to SVG",
            )
        )
        return

    try:
        with TemporaryDirectory(prefix="creative-dna-vectorize-") as tmp_dir:
            tmp_path = Path(tmp_dir)
            input_path = tmp_path / f"input{_safe_suffix(filename)}"
            output_path = tmp_path / "output.svg"
            input_path.write_bytes(image_bytes)
            vtracer.convert_image_to_svg_py(
                str(input_path),
                str(output_path),
                colormode=preset.colormode,
                hierarchical=preset.hierarchical,
                mode=preset.mode,
                filter_speckle=preset.filter_speckle,
                color_precision=preset.color_precision,
                layer_difference=preset.layer_difference,
                corner_threshold=preset.corner_threshold,
                length_threshold=preset.length_threshold,
                max_iterations=preset.max_iterations,
                splice_threshold=preset.splice_threshold,
                path_precision=preset.path_precision,
            )
            result_queue.put(("ok", output_path.read_text(encoding="utf-8")))
    except Exception as exc:  # pragma: no cover - depends on runtime behavior
        result_queue.put(("error", str(exc)))
