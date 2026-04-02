from keyword_intel import creative_labels
from keyword_intel.creative_library_storage import _connect
from keyword_intel.models import (
    CreativeLabelExtractedTextFrame,
    CreativeStageAVisualLabels,
    CreativeStageBTextLabels,
    CreativeStageCAudioLabels,
    CreativeStageDStrategicLabels,
    FireRedAudioSourceResult,
)


def _seed_creative(conn) -> None:
    creative_labels._ensure_label_schema(conn)
    conn.execute(
        """
        INSERT INTO creative_assets (
            tenant_key, store_key, asset_id, creative_family_id, platform,
            source_creative_id, source_asset_id, asset_type, asset_name,
            asset_url, thumbnail_url, preview_url, asset_signature,
            asset_fingerprint, image_hash, perceptual_hash,
            first_seen_at, last_seen_at, metadata_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "default",
            "shawq",
            "asset_1",
            "family_1",
            "meta",
            "",
            "",
            "video",
            "Tatreez Reel",
            "https://cdn.example.test/video.mp4",
            "https://cdn.example.test/thumb.jpg",
            "https://cdn.example.test/video.mp4",
            "asset_sig",
            "asset_fp",
            "",
            "",
            "2026-03-01T00:00:00+00:00",
            "2026-03-10T00:00:00+00:00",
            "{}",
            "{}",
        ),
    )
    conn.execute(
        """
        INSERT INTO creative_variants (
            tenant_key, store_key, variant_id, asset_id, platform, source_creative_id,
            creative_name, body_text, headline, link_description, cta_text, destination_url,
            aspect_ratio, ad_format, language, variant_signature, first_seen_at, last_seen_at,
            metadata_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "default",
            "shawq",
            "variant_1",
            "asset_1",
            "meta",
            "",
            "Tatreez Reel Variant",
            "Wear your roots",
            "Palestinian Inspired",
            "",
            "",
            "",
            "9:16",
            "video",
            "en",
            "variant_sig",
            "2026-03-01T00:00:00+00:00",
            "2026-03-10T00:00:00+00:00",
            "{}",
            "{}",
        ),
    )
    conn.commit()


def test_materialize_creative_labels_caches_new_stage_results(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "creative-labels.db"
    (tmp_path / "audio.wav").write_bytes(b"fake-wav")
    (tmp_path / "video.mp4").write_bytes(b"fake-video")
    conn = _connect(str(db_path))
    try:
        _seed_creative(conn)
    finally:
        conn.close()

    monkeypatch.setattr(
        creative_labels,
        "_prepare_media",
        lambda context, directory: creative_labels._PreparedMedia(
            scope_media_hash="media_hash_1",
            canonical_creative_id="asset_1",
            variant_id="variant_1",
            creative_name="Tatreez Reel Variant",
            body_text="Wear your roots",
            headline="Palestinian Inspired",
            media_type="video",
            source_media_url="https://cdn.example.test/video.mp4",
            thumbnail_url="https://cdn.example.test/thumb.jpg",
            preview_url="https://cdn.example.test/video.mp4",
            duration_seconds=10.0,
            frames_stage_ab=[
                creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a"),
                creative_labels._FramePayload(label="1s", seconds=1.0, image_bytes=b"b"),
                creative_labels._FramePayload(label="2s", seconds=2.0, image_bytes=b"c"),
                creative_labels._FramePayload(label="3s", seconds=3.0, image_bytes=b"d"),
                creative_labels._FramePayload(label="5s", seconds=5.0, image_bytes=b"e"),
                creative_labels._FramePayload(label="7s", seconds=7.0, image_bytes=b"f"),
                creative_labels._FramePayload(label="mid", seconds=5.0, image_bytes=b"g"),
                creative_labels._FramePayload(label="end", seconds=9.0, image_bytes=b"h"),
            ],
            frames_stage_d=[
                creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a"),
                creative_labels._FramePayload(label="3s", seconds=3.0, image_bytes=b"d"),
                creative_labels._FramePayload(label="7s", seconds=7.0, image_bytes=b"f"),
                creative_labels._FramePayload(label="end", seconds=9.0, image_bytes=b"h"),
            ],
            audio_path=str(tmp_path / "audio.wav"),
            local_media_path=str(tmp_path / "video.mp4"),
        ),
    )

    calls = {"qwen": 0, "gemini": 0, "audio": 0, "claude": 0}

    monkeypatch.setattr(
        creative_labels,
        "_run_qwen_stage",
        lambda **kwargs: (
            calls.__setitem__("qwen", calls["qwen"] + 1)
            or CreativeStageAVisualLabels(
                production_feel="native",
                delivery_format="on_body_showcase",
                face_presence="minor",
                body_presence="major",
                hands_presence="minor",
                face_role="supporting",
                body_role="primary",
                hands_role="supporting",
                on_body_prominence="dominant",
                detail_intensity="moderate",
                texture_emphasis="moderate",
                product_prominence="dominant",
                motion_style="handheld_reveal",
                opening_focus="product",
                styling_count="single",
            )
        ),
    )
    monkeypatch.setattr(
        creative_labels,
        "_run_gemini_stage",
        lambda **kwargs: (
            calls.__setitem__("gemini", calls["gemini"] + 1)
            or CreativeStageBTextLabels(
                extracted_text_sequence=[
                    CreativeLabelExtractedTextFrame(timestamp="0s", text="Ramadan Sale"),
                    CreativeLabelExtractedTextFrame(timestamp="1s", text=""),
                ],
                text_density="low",
                text_role="selling",
                opening_text_focus="clear",
            )
        ),
    )
    monkeypatch.setattr(
        creative_labels,
        "_run_audio_stage",
        lambda **kwargs: (
            calls.__setitem__("audio", calls["audio"] + 1)
            or CreativeStageCAudioLabels(
                audio_source_type="singing",
                voiceover_present="no",
                music_energy="upbeat",
                evidence={"music_ratio": 0.9},
                model_id="firered-test",
            )
        ),
    )
    monkeypatch.setattr(
        creative_labels,
        "_run_claude_stage",
        lambda **kwargs: (
            calls.__setitem__("claude", calls["claude"] + 1)
            or CreativeStageDStrategicLabels(
                opening_mechanism="offer_open",
                opening_energy="punchy",
                emotional_angle="pride_identity",
                heritage_emphasis_level="strong",
                cause_product_balance="balanced",
                craft_emphasis="moderate",
                surprise_detail="subtle",
                occasion_framing="religious",
                evidence={
                    "opening": "Offer-led opening with punchy pacing.",
                    "emotional": "Pride is the primary emotional trigger.",
                    "heritage": "Heritage cues are explicit and balanced with product selling.",
                    "craft": "Craft cues are present but not dominant.",
                    "surprise": "A subtle reveal moment is present.",
                    "occasion": "Religious framing is explicit.",
                },
            )
        ),
    )

    first = creative_labels.materialize_creative_labels(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        canonical_creative_id="asset_1",
        dashscope_api_key="dashscope-key",
        dashscope_base_url="https://dashscope.example.test/v1",
        dashscope_model="qwen-vl-max",
        dashscope_timeout_sec=30.0,
        google_ai_api_key="gemini-key",
        gemini_base_url="https://gemini.example.test/v1beta",
        gemini_model="gemini-2.5-flash",
        gemini_timeout_sec=30.0,
        firered_endpoint_url="https://firered.example.test",
        firered_api_token="firered-token",
        firered_timeout_sec=30.0,
        anthropic_api_key="anthropic-key",
        anthropic_model="claude-sonnet-4-6",
        anthropic_base_url="https://api.anthropic.com/v1/messages",
        anthropic_timeout_sec=30.0,
    )
    second = creative_labels.materialize_creative_labels(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        canonical_creative_id="asset_1",
        dashscope_api_key="dashscope-key",
        dashscope_base_url="https://dashscope.example.test/v1",
        dashscope_model="qwen-vl-max",
        dashscope_timeout_sec=30.0,
        google_ai_api_key="gemini-key",
        gemini_base_url="https://gemini.example.test/v1beta",
        gemini_model="gemini-2.5-flash",
        gemini_timeout_sec=30.0,
        firered_endpoint_url="https://firered.example.test",
        firered_api_token="firered-token",
        firered_timeout_sec=30.0,
        anthropic_api_key="anthropic-key",
        anthropic_model="claude-sonnet-4-6",
        anthropic_base_url="https://api.anthropic.com/v1/messages",
        anthropic_timeout_sec=30.0,
    )

    assert calls == {"qwen": 1, "gemini": 1, "audio": 1, "claude": 1}
    assert first.cache_hits == {
        "stage_a_qwen": False,
        "stage_b_gemini": False,
        "stage_c_audio": False,
        "stage_d_claude": False,
    }
    assert second.cache_hits == {
        "stage_a_qwen": True,
        "stage_b_gemini": True,
        "stage_c_audio": True,
        "stage_d_claude": True,
    }
    assert second.labels.heritage_emphasis_level == "strong"
    stored = creative_labels.get_creative_label_record(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        canonical_creative_id="asset_1",
        variant_id="variant_1",
    )
    assert stored is not None
    assert stored.opening_mechanism == "offer_open"
    assert stored.music_energy == "upbeat"
    assert stored.evidence.production_feel.startswith("Production feel is native")
    assert "Heritage cues are explicit" in stored.evidence.creative_angle


def test_prepare_media_promotes_raw_meta_video_over_stored_image(monkeypatch, tmp_path) -> None:
    media_file = tmp_path / "resolved.mp4"
    media_file.write_bytes(b"fake-video")
    audio_file = tmp_path / "audio.wav"
    audio_file.write_bytes(b"fake-audio")

    monkeypatch.setenv("META_ACCESS_TOKEN", "meta-token")
    monkeypatch.setattr(
        creative_labels,
        "_resolve_meta_video_payload",
        lambda **kwargs: {"source": str(media_file)},
    )
    monkeypatch.setattr(
        creative_labels,
        "_download_to_path",
        lambda url, directory, filename_prefix: (media_file, "video/mp4"),
    )
    monkeypatch.setattr(
        creative_labels,
        "_extract_video_frames",
        lambda path: (
            [creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a")] * 8,
            [creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a")] * 4,
            9.5,
        ),
    )
    monkeypatch.setattr(
        creative_labels,
        "_extract_audio_wav",
        lambda video_path, directory: audio_file,
    )

    prepared = creative_labels._prepare_media(
        {
            "media_hash": "media_hash_1",
            "canonical_creative_id": "asset_1",
            "variant_id": "variant_1",
            "creative_name": "Dynamic Video",
            "body_text": "",
            "headline": "",
            "media_type": "image",
            "media_url": "https://scontent.example.test/p64x64.jpg",
            "source_asset_id": "legacy_image_hash",
            "source_creative_id": "cr_1",
            "asset_url": "https://scontent.example.test/p64x64.jpg",
            "preview_url": "https://scontent.example.test/p64x64.jpg",
            "thumbnail_url": "https://scontent.example.test/p64x64.jpg",
            "raw_meta_creative": {
                "id": "cr_1",
                "asset_feed_spec": {"videos": [{"video_id": "vid_123"}]},
            },
            "raw_candidate_urls": [],
            "raw_video_id": "vid_123",
        },
        directory=tmp_path,
    )

    assert prepared.media_type == "video"
    assert prepared.source_media_url == str(media_file)
    assert prepared.audio_path == str(audio_file)


def test_prepare_media_uses_embed_html_ytdlp_when_meta_source_missing(monkeypatch, tmp_path) -> None:
    media_file = tmp_path / "resolved.mp4"
    media_file.write_bytes(b"fake-video")
    audio_file = tmp_path / "audio.wav"
    audio_file.write_bytes(b"fake-audio")

    monkeypatch.setenv("META_ACCESS_TOKEN", "meta-token")
    monkeypatch.setattr(
        creative_labels,
        "_resolve_meta_video_payload",
        lambda **kwargs: {
            "embed_html": '<iframe src="https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fshare%2Fv%2Fabc123%2F"></iframe>',
            "permalink_url": "https://www.facebook.com/share/v/abc123/",
            "picture": "https://cdn.example.test/thumb.jpg",
        },
    )
    monkeypatch.setattr(
        creative_labels,
        "_extract_with_ytdlp_url",
        lambda url, retry_count=0: str(media_file),
    )
    monkeypatch.setattr(
        creative_labels,
        "_extract_with_ytdlp_embed",
        lambda embed_html: str(media_file),
    )
    monkeypatch.setattr(
        creative_labels,
        "_download_to_path",
        lambda url, directory, filename_prefix: (media_file, "video/mp4"),
    )
    monkeypatch.setattr(
        creative_labels,
        "_extract_video_frames",
        lambda path: (
            [creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a")] * 8,
            [creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a")] * 4,
            9.5,
        ),
    )
    monkeypatch.setattr(
        creative_labels,
        "_extract_audio_wav",
        lambda video_path, directory: audio_file,
    )

    prepared = creative_labels._prepare_media(
        {
            "media_hash": "media_hash_2",
            "canonical_creative_id": "asset_2",
            "variant_id": "variant_2",
            "creative_name": "Embed Video",
            "body_text": "",
            "headline": "",
            "media_type": "video",
            "media_url": "https://scontent.example.test/p64x64.jpg",
            "source_asset_id": "vid_123",
            "source_creative_id": "cr_2",
            "asset_url": "https://scontent.example.test/p64x64.jpg",
            "preview_url": "https://scontent.example.test/p64x64.jpg",
            "thumbnail_url": "https://scontent.example.test/p64x64.jpg",
            "raw_meta_creative": {},
            "raw_candidate_urls": [],
            "raw_video_id": "vid_123",
        },
        directory=tmp_path,
    )

    assert prepared.media_type == "video"
    assert prepared.source_media_url == str(media_file)
    assert prepared.audio_path == str(audio_file)


def test_prepare_media_uses_store_specific_meta_token(monkeypatch, tmp_path) -> None:
    media_file = tmp_path / "resolved.mp4"
    media_file.write_bytes(b"fake-video")
    audio_file = tmp_path / "audio.wav"
    audio_file.write_bytes(b"fake-audio")

    monkeypatch.delenv("META_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("SHAWQ_META_ACCESS_TOKEN", "shawq-store-token")

    captured: dict[str, str] = {}

    def _fake_video_payload(**kwargs):
        captured["access_token"] = str(kwargs.get("access_token") or "")
        return {"source": str(media_file)}

    monkeypatch.setattr(creative_labels, "_resolve_meta_video_payload", _fake_video_payload)
    monkeypatch.setattr(
        creative_labels,
        "_download_to_path",
        lambda url, directory, filename_prefix: (media_file, "video/mp4"),
    )
    monkeypatch.setattr(
        creative_labels,
        "_extract_video_frames",
        lambda path: (
            [creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a")] * 8,
            [creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a")] * 4,
            9.5,
        ),
    )
    monkeypatch.setattr(
        creative_labels,
        "_extract_audio_wav",
        lambda video_path, directory: audio_file,
    )

    prepared = creative_labels._prepare_media(
        {
            "store_key": "shawq.co",
            "media_hash": "media_hash_1",
            "canonical_creative_id": "asset_1",
            "variant_id": "variant_1",
            "creative_name": "Dynamic Video",
            "body_text": "",
            "headline": "",
            "media_type": "video",
            "media_url": "",
            "source_asset_id": "vid_123",
            "source_creative_id": "cr_1",
            "asset_url": "",
            "preview_url": "",
            "thumbnail_url": "",
            "raw_meta_creative": {"id": "cr_1"},
            "raw_candidate_urls": [],
            "raw_video_id": "vid_123",
        },
        directory=tmp_path,
    )

    assert captured["access_token"] == "shawq-store-token"
    assert prepared.media_type == "video"
    assert prepared.source_media_url == str(media_file)


def test_extract_url_from_embed_html_decodes_facebook_reel_url() -> None:
    embed_html = (
        '<iframe src="https://www.facebook.com/plugins/video.php?'
        'href=https%3A%2F%2Fwww.facebook.com%2Freel%2F962697899443456%2F&width=2160"></iframe>'
    )

    extracted = creative_labels._extract_url_from_embed_html(embed_html)

    assert extracted == "https://www.facebook.com/reel/962697899443456/"


def test_extract_with_ytdlp_url_normalizes_relative_facebook_permalink(monkeypatch) -> None:
    monkeypatch.setattr(creative_labels, "_yt_dlp_prefix", lambda: ["yt-dlp"])
    captured: dict[str, list[str]] = {}

    def _fake_check_output(command, stderr, text, timeout):
        captured["command"] = list(command)
        return "https://video.example.test/resolved.mp4\n"

    monkeypatch.setattr(creative_labels.subprocess, "check_output", _fake_check_output)

    resolved = creative_labels._extract_with_ytdlp_url("/reel/962697899443456/")

    assert resolved == "https://video.example.test/resolved.mp4"
    assert captured["command"][-1] == "https://www.facebook.com/reel/962697899443456/"


def test_normalize_gemini_text_output_collapses_static_image_repeats() -> None:
    frames = [
        creative_labels._FramePayload(label=label, seconds=0.0, image_bytes=b"same-frame")
        for label in ("0s", "1s", "2s", "3s", "5s", "7s", "mid", "end")
    ]
    parsed = {
        "extracted_text_sequence": [
            {"timestamp": "0s", "text": "Buffalo London"},
            {"timestamp": "1s", "text": "Buffalo London"},
            {"timestamp": "2s", "text": "Buffalo London"},
            {"timestamp": "3s", "text": "Buffalo London"},
            {"timestamp": "5s", "text": "Buffalo London"},
            {"timestamp": "7s", "text": "Buffalo London"},
            {"timestamp": "mid", "text": "Buffalo London"},
            {"timestamp": "end", "text": "Buffalo London"},
        ],
        "text_density": "high",
        "text_role": "support",
        "opening_text_focus": "clear",
    }

    normalized = creative_labels._normalize_gemini_text_output(parsed, frames=frames)

    assert normalized["text_density"] == "low"
    assert normalized["opening_text_focus"] == "clear"
    assert normalized["extracted_text_sequence"] == [{"timestamp": "0s", "text": "Buffalo London"}]


def test_normalize_gemini_text_output_keeps_real_video_sequences() -> None:
    frames = [
        creative_labels._FramePayload(label="0s", seconds=0.0, image_bytes=b"a"),
        creative_labels._FramePayload(label="1s", seconds=1.0, image_bytes=b"b"),
        creative_labels._FramePayload(label="2s", seconds=2.0, image_bytes=b"c"),
    ]
    parsed = {
        "extracted_text_sequence": [
            {"timestamp": "0s", "text": "One"},
            {"timestamp": "1s", "text": "Two"},
            {"timestamp": "2s", "text": "Three"},
        ],
        "text_density": "medium",
        "text_role": "story_led",
        "opening_text_focus": "clear",
    }

    normalized = creative_labels._normalize_gemini_text_output(parsed, frames=frames)

    assert normalized["text_density"] == "medium"
    assert normalized["opening_text_focus"] == "clear"
    assert normalized["extracted_text_sequence"] == parsed["extracted_text_sequence"]


def test_run_audio_stage_falls_back_to_voice_music_ratio(monkeypatch, tmp_path) -> None:
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"fake-wav")

    monkeypatch.setattr(
        creative_labels,
        "analyze_firered_audio_source",
        lambda **kwargs: FireRedAudioSourceResult(
            voice_music_ratio="music_dominant",
            evidence={"voice_share": 0.0},
            model_id="voicemix-test",
        ),
    )
    monkeypatch.setattr(
        creative_labels,
        "_compute_music_energy",
        lambda *_args, **_kwargs: "upbeat",
    )

    result = creative_labels._run_audio_stage(
        audio_path=str(audio_path),
        endpoint_url="https://firered.example.test",
        api_token="token",
        timeout_sec=30.0,
    )

    assert result.audio_source_type == "music"
    assert result.voiceover_present == "no"
    assert result.music_energy == "upbeat"
    assert result.evidence["voice_music_ratio"] == "music_dominant"
