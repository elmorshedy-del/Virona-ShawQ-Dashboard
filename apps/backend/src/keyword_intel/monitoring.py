from __future__ import annotations

from datetime import UTC, datetime
from statistics import mean

from .models import (
    KeywordMetric,
    MonitoringSnapshot,
    RisingKeyword,
    SeasonalForecast,
    SourceEvidence,
)


def _extract_timeseries(
    evidence: dict[str, dict[str, SourceEvidence]], keyword: str
) -> list[int]:
    trends = evidence.get(keyword, {}).get("trends-unofficial")
    if not trends:
        return []
    raw = trends.raw if isinstance(trends.raw, dict) else {}
    values = raw.get("timeseries")
    if not isinstance(values, list):
        return []
    cleaned: list[int] = []
    for item in values:
        if isinstance(item, (int, float)):
            cleaned.append(int(item))
        elif str(item).isdigit():
            cleaned.append(int(item))
    return cleaned


def _forecast_peak_month(values: list[int]) -> tuple[int, float] | None:
    if len(values) < 12:
        return None
    trailing = values[-12:]
    peak_value = max(trailing)
    if peak_value <= 0:
        return None
    peak_index = trailing.index(peak_value)
    current_month = datetime.now(UTC).month
    months_ago = 11 - peak_index
    peak_month = ((current_month - months_ago - 1) % 12) + 1
    prominence = max(0.0, min(1.0, (peak_value - mean(trailing)) / peak_value))
    confidence = round(40.0 + (prominence * 60.0), 2)
    return peak_month, confidence


def build_monitoring_snapshot(
    *,
    current_keywords: list[KeywordMetric],
    previous_keywords: dict[str, KeywordMetric],
    evidence_map: dict[str, dict[str, SourceEvidence]],
    run_id: int | None,
    previous_run_id: int | None,
    rising_threshold: float,
    alert_min_confidence: float,
) -> MonitoringSnapshot:
    current_index = {metric.keyword: metric for metric in current_keywords}
    previous_index = previous_keywords

    current_top = set(current_index.keys())
    previous_top = set(previous_index.keys())

    new_keywords = sorted(current_top - previous_top)
    lost_keywords = sorted(previous_top - current_top)

    rising_keywords: list[RisingKeyword] = []
    for keyword, current in current_index.items():
        previous = previous_index.get(keyword)
        if not previous:
            continue
        delta = round(current.score - previous.score, 2)
        if delta < rising_threshold:
            continue
        rising_keywords.append(
            RisingKeyword(
                keyword=keyword,
                current_score=current.score,
                previous_score=previous.score,
                delta_score=delta,
                current_confidence=current.confidence,
            )
        )
    rising_keywords = sorted(
        rising_keywords,
        key=lambda item: (-item.delta_score, -item.current_score, item.keyword),
    )[:20]

    alerts: list[str] = []
    for keyword in new_keywords:
        metric = current_index[keyword]
        if (
            metric.score >= 72
            and metric.confidence >= alert_min_confidence
            and metric.trend_direction == "growing"
        ):
            alerts.append(f"High-value emerging keyword: {keyword}")
    for rising in rising_keywords[:8]:
        if rising.current_confidence >= alert_min_confidence:
            alerts.append(
                f"Rising keyword momentum: {rising.keyword} (+{rising.delta_score:.2f})"
            )
    alerts = alerts[:20]

    seasonal_forecast: list[SeasonalForecast] = []
    for metric in current_keywords[:40]:
        timeseries = _extract_timeseries(evidence_map, metric.keyword)
        forecast = _forecast_peak_month(timeseries)
        if not forecast:
            continue
        month, confidence = forecast
        seasonal_forecast.append(
            SeasonalForecast(
                keyword=metric.keyword,
                next_peak_month=month,
                confidence=confidence,
            )
        )
        if len(seasonal_forecast) >= 12:
            break

    return MonitoringSnapshot(
        run_id=run_id,
        previous_run_id=previous_run_id,
        new_keywords=new_keywords[:80],
        lost_keywords=lost_keywords[:80],
        rising_keywords=rising_keywords,
        alerts=alerts,
        seasonal_forecast=seasonal_forecast,
    )
