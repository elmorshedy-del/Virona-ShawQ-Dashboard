from keyword_intel.models import SourceEvidence
from keyword_intel.scoring import score_keyword


def test_scoring_is_bounded() -> None:
    metric = score_keyword("buy running shoes", relevance=0.9)
    assert 0 <= metric.score <= 100
    assert metric.volume >= 20
    assert metric.cpc > 0
    assert 0 <= metric.confidence <= 100


def test_multi_source_confidence_beats_sparse_source() -> None:
    observed_at = "2026-02-18T10:00:00+00:00"
    rich = score_keyword(
        "buy running shoes",
        relevance=0.9,
        evidence={
            "keyword-planner": SourceEvidence(
                source="keyword-planner",
                observed_at=observed_at,
                volume=4200,
                cpc=1.8,
                competition_index=0.42,
                confidence_signal=0.92,
            ),
            "autocomplete": SourceEvidence(
                source="autocomplete",
                observed_at=observed_at,
                autocomplete_suggestions=[
                    "buy running shoes online",
                    "best running shoes for men",
                    "running shoes sale",
                ],
                confidence_signal=0.6,
            ),
            "trends-unofficial": SourceEvidence(
                source="trends-unofficial",
                observed_at=observed_at,
                trend_direction="growing",
                trend_score=0.71,
                confidence_signal=0.75,
            ),
            "custom-serp": SourceEvidence(
                source="custom-serp",
                observed_at=observed_at,
                ads_count=5,
                related_searches=["running shoes deals", "trail running shoes"],
                people_also_ask=["what are best running shoes"],
                competitor_domains=["example.com", "competitor.com"],
                confidence_signal=0.7,
            ),
        },
    )
    sparse = score_keyword(
        "buy running shoes",
        relevance=0.9,
        evidence={
            "autocomplete": SourceEvidence(
                source="autocomplete",
                observed_at=observed_at,
                autocomplete_suggestions=["buy running shoes"],
                confidence_signal=0.45,
            )
        },
    )
    assert rich.confidence > sparse.confidence
    assert rich.score >= sparse.score
