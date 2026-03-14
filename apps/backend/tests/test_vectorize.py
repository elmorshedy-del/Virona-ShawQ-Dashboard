from __future__ import annotations

import io
import subprocess

import pytest
from PIL import Image, ImageDraw

from keyword_intel import vectorize
from keyword_intel.vectorize import (
    VectorizationTimeoutError,
    VectorizationUnavailableError,
    decode_base64_image,
    vectorize_image_bytes,
)


def _sample_png_bytes() -> bytes:
    image = Image.new("RGBA", (160, 80), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((10, 14, 150, 66), radius=12, fill=(18, 22, 29, 255))
    draw.text((42, 30), "DNA", fill=(255, 255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_decode_base64_image_rejects_invalid_data() -> None:
    with pytest.raises(ValueError) as exc_info:
        decode_base64_image("not-base64")

    assert "valid base64" in str(exc_info.value)


def test_vectorize_image_bytes_falls_back_to_potrace(monkeypatch) -> None:
    monkeypatch.setattr(
        vectorize,
        "_vectorize_with_vtracer",
        lambda *args, **kwargs: (_ for _ in ()).throw(VectorizationTimeoutError("timed out")),
    )
    monkeypatch.setattr(vectorize, "_vectorize_with_potrace", lambda *args, **kwargs: "<svg>fallback</svg>")

    svg = vectorize_image_bytes(_sample_png_bytes(), filename="logo.png", preset_name="color")

    assert svg == "<svg>fallback</svg>"


def test_vectorize_image_bytes_raises_primary_error_when_all_tracers_fail(monkeypatch) -> None:
    monkeypatch.setattr(
        vectorize,
        "_vectorize_with_vtracer",
        lambda *args, **kwargs: (_ for _ in ()).throw(VectorizationTimeoutError("timed out")),
    )
    monkeypatch.setattr(
        vectorize,
        "_vectorize_with_potrace",
        lambda *args, **kwargs: (_ for _ in ()).throw(VectorizationUnavailableError("missing potrace")),
    )

    with pytest.raises(VectorizationTimeoutError) as exc_info:
        vectorize_image_bytes(_sample_png_bytes(), filename="logo.png", preset_name="color")

    assert str(exc_info.value) == "timed out"


def test_run_potrace_svg_recolors_output(monkeypatch, tmp_path) -> None:
    def fake_run(cmd, check, capture_output, text, timeout):
        output_path = cmd[-1]
        with open(output_path, "w", encoding="utf-8") as handle:
            handle.write(
                """<?xml version="1.0" standalone="no"?>
<svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="10pt" height="10pt" viewBox="0 0 10 10">
  <g transform="translate(0,10) scale(0.1,-0.1)">
    <path d="M0 0 L10 0 L10 10 Z" />
  </g>
</svg>"""
            )

    monkeypatch.setattr(vectorize.subprocess, "run", fake_run)

    mask = Image.new("1", (10, 10), 255)
    svg = vectorize._run_potrace_svg(mask, potrace_bin="potrace", fill="#c79354")

    assert "#c79354" in svg
    assert "stroke=\"none\"" in svg
