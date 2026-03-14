from keyword_intel.models import KeywordMetric, SourceEvidence
from keyword_intel.monitoring import build_monitoring_snapshot


def _metric(keyword: str, score: float, confidence: float, trend: str = "growing") -> KeywordMetric:
    return KeywordMetric(
        keyword=keyword,
        volume=2200,
        cpc=1.5,
        competition_index=0.4,
        trend_direction=trend,
        competitor_density=0.4,
        buying_intent="transactional",
        relevance=0.88,
        score=score,
        confidence=confidence,
    )


def test_monitoring_detects_new_lost_and_rising_keywords() -> None:
    current = [
        _metric("buy palestine hoodie", 82.0, 75.0),
        _metric("keffiyeh hoodie gift", 76.0, 70.0),
    ]
    previous = {
        "buy palestine hoodie": _metric("buy palestine hoodie", 65.0, 68.0, trend="stable"),
        "old keyword": _metric("old keyword", 58.0, 50.0, trend="declining"),
    }
    evidence_map = {
        "buy palestine hoodie": {
            "trends-unofficial": SourceEvidence(
                source="trends-unofficial",
                observed_at="2026-02-19T00:00:00+00:00",
                raw={"timeseries": [20, 18, 30, 40, 45, 50, 55, 65, 72, 80, 96, 90]},
            )
        }
    }

    snapshot = build_monitoring_snapshot(
        current_keywords=current,
        previous_keywords=previous,
        evidence_map=evidence_map,
        run_id=3,
        previous_run_id=2,
        rising_threshold=10.0,
        alert_min_confidence=60.0,
    )
    assert "keffiyeh hoodie gift" in snapshot.new_keywords
    assert "old keyword" in snapshot.lost_keywords
    assert any(item.keyword == "buy palestine hoodie" for item in snapshot.rising_keywords)
    assert snapshot.alerts
    assert snapshot.seasonal_forecast
