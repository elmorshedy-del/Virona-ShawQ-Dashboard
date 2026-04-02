from types import SimpleNamespace

import requests

from keyword_intel import claude_subjective


def test_score_usa_rollup_with_claude_caches_results(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "claude-subjective-cache.db"
    detail_payload = {
        "rollup_id": "variant_1",
        "variant_id": "variant_1",
        "resolved_store_key": "shawq",
        "creative_name": "Ramadan Tatreez",
        "headline": "Wear home with pride",
        "body_text": "A soft heritage-led product story",
        "asset_type": "video",
        "usage_count": 3,
        "thumbnail_url": "",
        "preview_url": "",
    }

    monkeypatch.setattr(
        claude_subjective,
        "get_usa_creative_rollup_detail",
        lambda **kwargs: detail_payload,
    )

    calls = {"post": 0}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": """
                        {
                          "emotional_angle": "pride",
                          "heritage_vibe": "strong",
                          "premium_vs_casual": "balanced",
                          "ugc_vs_polished": "hybrid",
                          "hook_type": "direct_statement",
                          "opening_style": "direct_statement",
                          "cta_style": "identity_extension",
                          "cause_vs_product": "balanced",
                          "text_density": "low",
                          "face_presence": "some",
                          "evidence": {
                            "emotional_angle": "copy emphasizes pride",
                            "heritage_vibe": "heritage language is explicit",
                            "premium_vs_casual": "styling signals are mixed",
                            "ugc_vs_polished": "execution feels mixed",
                            "hook_type": "opens with a direct line",
                            "opening_style": "starts immediately with the main line",
                            "cta_style": "invites identity expression",
                            "cause_vs_product": "balances brand meaning and product",
                            "text_density": "copy is light",
                            "face_presence": "human subject visible"
                          }
                        }
                        """,
                    }
                ]
            }

    def fake_post(*args, **kwargs):
        calls["post"] += 1
        return FakeResponse()

    monkeypatch.setattr(requests, "post", fake_post)

    first = claude_subjective.score_usa_rollup_with_claude(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        rollup_id="variant_1",
        anthropic_api_key="test-key",
        anthropic_model="claude-sonnet-4-6",
        anthropic_base_url="https://api.anthropic.com/v1/messages",
        timeout_sec=30.0,
    )
    second = claude_subjective.score_usa_rollup_with_claude(
        db_path=str(db_path),
        tenant_key="default",
        store_key="shawq.co",
        rollup_id="variant_1",
        anthropic_api_key="test-key",
        anthropic_model="claude-sonnet-4-6",
        anthropic_base_url="https://api.anthropic.com/v1/messages",
        timeout_sec=30.0,
    )

    assert calls["post"] == 1
    assert first.cache_hit is False
    assert second.cache_hit is True
    assert second.score.heritage_vibe == "strong"
