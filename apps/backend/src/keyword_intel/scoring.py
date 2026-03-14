from __future__ import annotations

from datetime import UTC, datetime

from .models import KeywordMetric, SourceEvidence


WEIGHTS = {
    "volume": 25,
    "intent": 25,
    "competition_opportunity": 15,
    "relevance": 15,
    "trend": 10,
    "competitor_density": 10,
}

GENERIC_KEYWORD_TOKENS = {
    "accessories",
    "bottoms",
    "collection",
    "item",
    "items",
    "product",
    "products",
    "ready",
    "ship",
    "shipping",
    "tops",
}


def classify_intent(keyword: str) -> str:
    k = keyword.lower()
    if any(t in k for t in ["buy", "shop", "for sale", "شراء", "acheter", "comprar", "kaufen"]):
        return "transactional"
    if any(t in k for t in ["best", "review", "vs", "alternative"]):
        return "commercial"
    if any(t in k for t in ["how", "what", "guide"]):
        return "informational"
    return "navigational"


def _intent_score(intent: str) -> float:
    return {
        "transactional": 1.0,
        "commercial": 0.8,
        "informational": 0.45,
        "navigational": 0.55,
    }[intent]


def _trend_score(direction: str) -> float:
    return {"growing": 1.0, "stable": 0.65, "declining": 0.25}[direction]


def _keyword_quality_multiplier(keyword: str, intent: str) -> float:
    tokens = keyword.lower().split()
    if not tokens:
        return 0.6
    generic_hits = sum(1 for token in tokens if token in GENERIC_KEYWORD_TOKENS)
    if len(tokens) == 1 and generic_hits == 1:
        return 0.7
    if len(tokens) <= 2 and generic_hits >= 1 and intent == "navigational":
        return 0.78
    if "ready to ship item" in keyword.lower():
        return 0.74
    if len(tokens) == 1:
        return 0.86
    return 1.0


def _demand_multiplier(
    *,
    keyword: str,
    volume: int,
    confidence: float,
) -> float:
    tokens = keyword.split()
    factor = 1.0
    if volume <= 20:
        factor *= 0.62
    elif volume <= 50:
        factor *= 0.74
    elif volume <= 100:
        factor *= 0.84

    if confidence < 40:
        factor *= 0.78
    elif confidence < 55:
        factor *= 0.9

    if len(tokens) >= 5 and volume <= 100:
        factor *= 0.78
    elif len(tokens) >= 4 and volume <= 80:
        factor *= 0.86

    return max(0.45, min(1.0, factor))


def _weighted_average(pairs: list[tuple[float, float]]) -> float | None:
    clean = [(value, weight) for value, weight in pairs if value is not None and weight > 0]
    if not clean:
        return None
    numerator = sum(value * weight for value, weight in clean)
    denominator = sum(weight for _, weight in clean)
    if denominator <= 0:
        return None
    return numerator / denominator


def _evidence_has_data(evidence: SourceEvidence) -> bool:
    if evidence.error:
        return False
    if evidence.volume is not None:
        return True
    if evidence.cpc is not None:
        return True
    if evidence.competition_index is not None:
        return True
    if evidence.trend_score is not None:
        return True
    if evidence.ads_count is not None:
        return True
    if evidence.autocomplete_suggestions:
        return True
    if evidence.related_searches:
        return True
    if evidence.people_also_ask:
        return True
    if evidence.competitor_domains:
        return True
    return evidence.available


def _source_freshness(evidence: SourceEvidence) -> float:
    try:
        observed = datetime.fromisoformat(evidence.observed_at)
    except ValueError:
        return 0.3
    age_hours = (datetime.now(UTC) - observed.astimezone(UTC)).total_seconds() / 3600
    if age_hours <= 6:
        return 1.0
    if age_hours <= 24:
        return 0.85
    if age_hours <= 72:
        return 0.65
    return 0.4


def _aggregate_volume(evidence: dict[str, SourceEvidence]) -> int:
    planner = evidence.get("keyword-planner")
    autocomplete = evidence.get("autocomplete")
    trends = evidence.get("trends-unofficial")
    serp = evidence.get("custom-serp")

    planner_volume = float(planner.volume) if planner and planner.volume is not None else None
    autocomplete_proxy = (
        float(len(autocomplete.autocomplete_suggestions) * 140)
        if autocomplete
        else None
    )
    trends_proxy = (
        float(max(50, (trends.trend_score or 0.0) * 18_000))
        if trends and trends.trend_score is not None
        else None
    )
    serp_proxy = (
        float((len(serp.related_searches) + len(serp.people_also_ask)) * 180)
        if serp
        else None
    )
    estimated = _weighted_average(
        [
            (planner_volume, 0.65),
            (autocomplete_proxy, 0.1),
            (trends_proxy, 0.15),
            (serp_proxy, 0.1),
        ]
    )
    if estimated is None:
        return 20
    return int(max(20, round(estimated)))


def _aggregate_cpc(evidence: dict[str, SourceEvidence], volume: int, competition_index: float) -> float:
    planner = evidence.get("keyword-planner")
    planner_cpc = float(planner.cpc) if planner and planner.cpc is not None else None
    if planner_cpc is not None and planner_cpc > 0:
        return round(planner_cpc, 2)
    inferred = max(0.2, (competition_index * 2.8) + min(volume / 40_000, 1.0) * 1.2)
    return round(inferred, 2)


def _aggregate_competition_index(evidence: dict[str, SourceEvidence]) -> float:
    planner = evidence.get("keyword-planner")
    serp = evidence.get("custom-serp")
    planner_comp = (
        float(planner.competition_index)
        if planner and planner.competition_index is not None
        else None
    )
    serp_comp = (
        min(float(serp.ads_count) / 8.0, 1.0)
        if serp and serp.ads_count is not None
        else None
    )
    estimated = _weighted_average([(planner_comp, 0.75), (serp_comp, 0.25)])
    if estimated is None:
        return 0.5
    return max(0.01, min(1.0, round(estimated, 3)))


def _aggregate_trend_direction(evidence: dict[str, SourceEvidence]) -> str:
    trends = evidence.get("trends-unofficial")
    if trends and trends.trend_direction:
        return trends.trend_direction
    return "stable"


def _aggregate_competitor_density(evidence: dict[str, SourceEvidence]) -> float:
    serp = evidence.get("custom-serp")
    if not serp:
        return 0.5
    domains_component = min(len(serp.competitor_domains) / 12.0, 1.0)
    ads_component = (
        min(float(serp.ads_count) / 10.0, 1.0) if serp.ads_count is not None else 0.0
    )
    estimated = _weighted_average([(domains_component, 0.65), (ads_component, 0.35)])
    if estimated is None:
        return 0.5
    return max(0.01, min(1.0, round(estimated, 3)))


def _confidence_components(
    evidence: dict[str, SourceEvidence],
) -> tuple[float, dict[str, float]]:
    core_sources = [
        "keyword-planner",
        "autocomplete",
        "trends-unofficial",
        "custom-serp",
    ]
    usable_sources = [
        source
        for source in core_sources
        if source in evidence and _evidence_has_data(evidence[source])
    ]
    coverage = len(usable_sources) / len(core_sources)

    quality_signals = [
        max(0.0, min(1.0, evidence[source].confidence_signal))
        for source in usable_sources
    ]
    quality = sum(quality_signals) / len(quality_signals) if quality_signals else 0.0

    agreement_signals: list[float] = []
    planner = evidence.get("keyword-planner")
    trends = evidence.get("trends-unofficial")
    serp = evidence.get("custom-serp")

    if (
        planner
        and planner.volume is not None
        and trends
        and trends.trend_score is not None
    ):
        planner_scaled = min(planner.volume / 25_000, 1.0)
        trends_scaled = max(0.0, min(1.0, trends.trend_score))
        agreement_signals.append(1.0 - abs(planner_scaled - trends_scaled))

    if (
        planner
        and planner.competition_index is not None
        and serp
        and serp.ads_count is not None
    ):
        serp_scaled = min(serp.ads_count / 8.0, 1.0)
        planner_scaled = max(0.0, min(1.0, planner.competition_index))
        agreement_signals.append(1.0 - abs(planner_scaled - serp_scaled))

    agreement = (
        sum(agreement_signals) / len(agreement_signals)
        if agreement_signals
        else (0.55 if coverage > 0 else 0.0)
    )

    freshness_signals = [_source_freshness(evidence[source]) for source in usable_sources]
    freshness = (
        sum(freshness_signals) / len(freshness_signals) if freshness_signals else 0.0
    )

    components = {
        "coverage": round(coverage * 100, 2),
        "quality": round(quality * 100, 2),
        "agreement": round(agreement * 100, 2),
        "freshness": round(freshness * 100, 2),
    }
    confidence = (
        (coverage * 0.45)
        + (quality * 0.3)
        + (agreement * 0.2)
        + (freshness * 0.05)
    )
    return round(max(0.0, min(100.0, confidence * 100)), 2), components


def score_keyword(
    keyword: str,
    relevance: float,
    evidence: dict[str, SourceEvidence] | None = None,
) -> KeywordMetric:
    evidence_by_source = evidence or {}
    volume = _aggregate_volume(evidence_by_source)
    competition_index = _aggregate_competition_index(evidence_by_source)
    trend = _aggregate_trend_direction(evidence_by_source)
    competitor_density = _aggregate_competitor_density(evidence_by_source)
    cpc = _aggregate_cpc(evidence_by_source, volume=volume, competition_index=competition_index)
    intent = classify_intent(keyword)
    confidence, components = _confidence_components(evidence_by_source)

    volume_component = min(volume / 30_000, 1.0)
    intent_component = _intent_score(intent)
    competition_component = max(1.0 - competition_index, 0.0)
    relevance_component = max(0.0, min(relevance, 1.0))
    trend_component = _trend_score(trend)
    competitor_component = max(1.0 - competitor_density, 0.0)
    base_score = (
        (volume_component * WEIGHTS["volume"])
        + (intent_component * WEIGHTS["intent"])
        + (competition_component * WEIGHTS["competition_opportunity"])
        + (relevance_component * WEIGHTS["relevance"])
        + (trend_component * WEIGHTS["trend"])
        + (competitor_component * WEIGHTS["competitor_density"])
    )
    quality_multiplier = _keyword_quality_multiplier(keyword, intent)
    demand_multiplier = _demand_multiplier(
        keyword=keyword,
        volume=volume,
        confidence=confidence,
    )
    confidence_multiplier = 0.65 + 0.35 * (confidence / 100)
    score = round(
        max(
            0.0,
            min(
                100.0,
                base_score * quality_multiplier * demand_multiplier * confidence_multiplier,
            ),
        ),
        2,
    )

    hidden_gem = (
        volume > 1500
        and competition_index < 0.35
        and intent in {"transactional", "commercial"}
        and trend == "growing"
        and confidence >= 60
    )

    return KeywordMetric(
        keyword=keyword,
        volume=volume,
        cpc=cpc,
        competition_index=competition_index,
        trend_direction=trend,
        competitor_density=competitor_density,
        buying_intent=intent,
        relevance=round(relevance_component, 3),
        score=score,
        hidden_gem=hidden_gem,
        sources=sorted(
            [
                source
                for source, source_evidence in evidence_by_source.items()
                if _evidence_has_data(source_evidence)
            ]
        ),
        confidence=confidence,
        confidence_components=components,
        evidence=evidence_by_source,
    )
