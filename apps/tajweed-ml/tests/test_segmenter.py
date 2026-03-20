from __future__ import annotations

from tajweed_ml.segmenter import RecitationSegmenter


def test_segmenter_report_reflects_cache_status(monkeypatch, tmp_path) -> None:
    from tajweed_ml import segmenter as segmenter_module

    config = segmenter_module.load_config(storage_root=tmp_path)
    monkeypatch.setattr(segmenter_module, "load_config", lambda: config)

    segmenter = RecitationSegmenter(device="cpu")
    report = segmenter.report()

    assert report["cached"] is False
    assert report["loaded"] is False
    assert report["cache_dir"] == str(config.segmenter_model_dir)


def test_segment_audio_parses_word_timestamp_chunks(monkeypatch, tmp_path) -> None:
    from tajweed_ml import segmenter as segmenter_module

    config = segmenter_module.load_config(storage_root=tmp_path)
    monkeypatch.setattr(segmenter_module, "load_config", lambda: config)

    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"fake")

    segmenter = RecitationSegmenter(device="cpu")
    monkeypatch.setattr(
        segmenter_module,
        "load_audio",
        lambda _path: (_FakeWaveform(16_000), 16_000),
    )
    monkeypatch.setattr(
        segmenter,
        "_extract_segments",
        lambda _path: ([(0.0, 0.42), (0.42, 1.0)], True),
    )

    payload = segmenter.segment_audio(audio_path, transcript_words=["بِسْمِ", "ٱللَّهِ"])

    assert payload["segments_available"] is True
    assert payload["segment_count"] == 2
    assert payload["segments"][0]["text"] == "بسم"
    assert payload["segments"][1]["start_sec"] == 0.42
    assert payload["expected_word_count"] == 2
    assert payload["exact_word_alignment"] is True


class _FakeWaveform:
    def __init__(self, sample_count: int):
        self.shape = (1, sample_count)
