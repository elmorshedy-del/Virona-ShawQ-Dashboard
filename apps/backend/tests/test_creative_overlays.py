from pathlib import Path

import pytest

from keyword_intel import creative_overlays


def test_build_timing_windows_stay_in_bounds() -> None:
    windows = creative_overlays.build_timing_windows(12.0, max_overlays=6)
    assert 3 <= len(windows) <= 6
    assert all(window.start_sec < window.end_sec for window in windows)
    assert windows[0].start_sec >= 0.0
    assert windows[-1].end_sec <= 12.0


def test_build_brand_intelligence_merges_website_and_audience(monkeypatch) -> None:
    class DummyResponse:
        text = (
            "<html><head><title>Shawq</title>"
            "<meta name='description' content='Premium modest fashion for daily wear'/>"
            "</head><body><h1>Tatreez storytelling pieces</h1><h2>Cart</h2>"
            "<p>Customers mention comfort and beautiful details.</p></body></html>"
        )

        def raise_for_status(self) -> None:
            return None

    monkeypatch.setattr(creative_overlays.requests, "get", lambda *args, **kwargs: DummyResponse())

    intelligence = creative_overlays.build_brand_intelligence(
        brand_website_url="https://shawq.co",
        audience_responses=[
            "love the fit",
            "LOVE THE FIT",
            "compliments in comments",
        ],
        brand_notes="Keep language elegant and confident.",
    )

    assert intelligence.source_url == "https://shawq.co"
    assert intelligence.site_title == "Shawq"
    assert intelligence.site_description.startswith("Premium modest fashion")
    assert "Tatreez storytelling pieces" in intelligence.key_messages
    assert "Cart" not in intelligence.key_messages
    assert intelligence.audience_responses == ["love the fit", "compliments in comments"]
    assert intelligence.brand_notes.startswith("Keep language elegant")


def test_generate_overlay_plan_uses_brand_inputs_in_template(monkeypatch, tmp_path: Path) -> None:
    reel_path = tmp_path / "sample.mp4"
    reel_path.write_bytes(b"")

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        creative_overlays,
        "probe_video_metadata",
        lambda _path: creative_overlays.VideoMetadata(duration_sec=10.0, width=1080, height=1920),
    )
    monkeypatch.setattr(
        creative_overlays,
        "build_brand_intelligence",
        lambda **kwargs: creative_overlays.BrandIntelligence(
            source_url="https://shawq.co",
            key_messages=["Hand-finished tatreez detail"],
            audience_responses=["love the fit"],
            brand_notes="Keep it minimal and premium",
        ),
    )

    plan = creative_overlays.generate_reel_overlay_plan(
        reel_path=reel_path,
        brand_name="Shawq",
        product_name="Tatreez Hoodie",
        tone="premium",
        audience="women in US",
        objective="conversion",
        max_overlays=5,
        brand_website_url="https://shawq.co",
        audience_responses=["love the fit"],
        brand_notes="Keep it minimal and premium",
    )

    assert plan.provider == "template"
    assert plan.brand_intelligence.source_url == "https://shawq.co"
    assert plan.brand_intelligence.audience_responses == ["love the fit"]
    assert 1 <= len(plan.overlays) <= 5
    assert any("Crowd response" in overlay.text for overlay in plan.overlays)
    assert not any("Keep it minimal and premium" in overlay.text for overlay in plan.overlays)


def test_openai_only_mode_errors_without_openai_result(monkeypatch, tmp_path: Path) -> None:
    reel_path = tmp_path / "sample.mp4"
    reel_path.write_bytes(b"")

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(
        creative_overlays,
        "probe_video_metadata",
        lambda _path: creative_overlays.VideoMetadata(duration_sec=10.0),
    )

    with pytest.raises(RuntimeError):
        creative_overlays.generate_reel_overlay_plan(
            reel_path=reel_path,
            provider_mode="openai-only",
        )
