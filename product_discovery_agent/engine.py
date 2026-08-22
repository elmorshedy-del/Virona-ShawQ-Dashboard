"""Core product discovery orchestration and ranking."""

from __future__ import annotations

from dataclasses import dataclass, field
from math import log10
import re

from .constants import (
    COMPONENT_SCORE_CAP,
    INVENTORY_RECOMMENDATION_THRESHOLDS,
    MARKETPLACE_COVERAGE_WEIGHT,
    MARKETPLACE_RESULT_CAP,
    MARKETPLACE_RESULTS_WEIGHT,
    MARKETPLACE_SAMPLE_TITLES_WEIGHT,
    MAX_SUSTAINED_TREND_FETCH_FAILURES,
    MAX_KEYWORD_LENGTH,
    MAX_SEED_KEYWORDS,
    MIN_KEYWORD_LENGTH,
    MIN_RELEVANCE_FOR_SUSTAINED_TRENDS,
    MIN_RELEVANCE_FOR_TRENDS,
    QUALITY_NEGATIVE_TOKEN_PENALTY,
    QUALITY_NEGATIVE_TOKENS,
    QUALITY_POSITIVE_TOKEN_BOOST,
    QUALITY_POSITIVE_TOKENS,
    QUALITY_SCORE_BASELINE,
    QUALITY_SCORE_MAX,
    QUALITY_SCORE_MIN,
    SEARCH_RANK_MULTIPLIER,
    SEARCH_SOURCE_WEIGHTS,
    SUPPORTED_MARKETPLACES,
    SUPPORTED_POSITIONING_MODES,
    SUSTAINED_TREND_BASELINE_POINTS,
    SUSTAINED_TREND_MIN_POINTS,
    SUSTAINED_TREND_RECENT_POINTS,
    TREND_RELEVANCE_MULTIPLIER,
    TREND_TRAFFIC_MULTIPLIER,
    WEIGHTED_SCORE_WEIGHTS,
)
from .models import (
    DiscoveryConfig,
    MarketplaceSnapshot,
    ProductDiscoveryReport,
    ProductOpportunity,
    SearchExpansion,
    StoreScope,
    SustainedTrendSignal,
    TrendSignal,
    now_utc_iso,
)
from .sources import (
    Fetcher,
    build_fetcher,
    fetch_amazon_suggestions,
    fetch_google_suggestions,
    fetch_google_trends_rss,
    fetch_google_trends_timeseries,
    scan_amazon_marketplace,
    scan_target_marketplace,
    scan_walmart_marketplace,
)
from .sustained import compute_sustained_trend_metrics

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(slots=True)
class _CandidateAccumulator:
    keyword: str
    search_points: float = 0.0
    trend_points: float = 0.0
    sustained_points: float = 0.0
    sources: set[str] = field(default_factory=set)
    trend_hits: int = 0
    max_trend_traffic_estimate: int = 0
    sustained_direction: str | None = None


def run_product_discovery(
    *,
    scope: StoreScope,
    config: DiscoveryConfig,
    fetcher: Fetcher | None = None,
) -> ProductDiscoveryReport:
    started_at = now_utc_iso()

    seed_keywords = _normalize_seed_keywords(scope.seed_keywords)
    if not seed_keywords:
        raise ValueError("At least one valid --seed-keyword is required.")
    if len(seed_keywords) > MAX_SEED_KEYWORDS:
        raise ValueError(f"A maximum of {MAX_SEED_KEYWORDS} seed keywords is supported.")

    excluded_keywords = _normalize_exclusions(scope.excluded_keywords)
    _validate_marketplaces(config.marketplaces)
    _validate_positioning_mode(scope.positioning_mode)

    resolved_fetcher = fetcher or build_fetcher(
        timeout_seconds=config.timeout_seconds,
        user_agent=config.user_agent,
    )

    warnings: list[str] = []
    search_expansions: list[SearchExpansion] = []
    trend_signals: list[TrendSignal] = []
    sustained_trend_signals: list[SustainedTrendSignal] = []
    candidate_map: dict[str, _CandidateAccumulator] = {}

    for seed_keyword in seed_keywords:
        _add_candidate(
            candidate_map=candidate_map,
            keyword=seed_keyword,
            search_points=SEARCH_SOURCE_WEIGHTS["seed_keyword"],
            trend_points=0.0,
            source="seed_keyword",
            trend_traffic_estimate=0,
        )

    _collect_search_expansions(
        seed_keywords=seed_keywords,
        config=config,
        fetcher=resolved_fetcher,
        search_expansions=search_expansions,
        candidate_map=candidate_map,
        warnings=warnings,
    )

    _collect_trend_signals(
        seed_keywords=seed_keywords,
        config=config,
        fetcher=resolved_fetcher,
        trend_signals=trend_signals,
        candidate_map=candidate_map,
        warnings=warnings,
    )

    filtered_candidates = _filter_candidates(candidate_map, excluded_keywords=excluded_keywords)
    _collect_sustained_trend_signals(
        seed_keywords=seed_keywords,
        filtered_candidates=filtered_candidates,
        config=config,
        fetcher=resolved_fetcher,
        sustained_trend_signals=sustained_trend_signals,
        warnings=warnings,
    )
    shortlisted_candidates = _shortlist_candidates(
        filtered_candidates=filtered_candidates,
        max_candidates=config.max_marketplace_terms,
    )

    opportunities: list[ProductOpportunity] = []
    marketplace_unavailable: dict[str, str] = {}
    for candidate in shortlisted_candidates:
        snapshots = _scan_marketplaces_for_keyword(
            keyword=candidate.keyword,
            marketplaces=config.marketplaces,
            max_sample_products=config.max_sample_products,
            target_pricing_store_id=config.target_pricing_store_id,
            fetcher=resolved_fetcher,
            warnings=warnings,
            marketplace_unavailable=marketplace_unavailable,
        )
        marketplace_score = _score_marketplace_snapshots(snapshots)
        search_score = min(COMPONENT_SCORE_CAP, candidate.search_points * SEARCH_RANK_MULTIPLIER)
        trend_score = min(COMPONENT_SCORE_CAP, candidate.trend_points)
        sustained_score = min(COMPONENT_SCORE_CAP, candidate.sustained_points)
        quality_fit_score = _score_quality_fit(
            keyword=candidate.keyword,
            positioning_mode=scope.positioning_mode,
        )
        total_score = (
            search_score * WEIGHTED_SCORE_WEIGHTS["search"]
            + trend_score * WEIGHTED_SCORE_WEIGHTS["trend"]
            + sustained_score * WEIGHTED_SCORE_WEIGHTS["sustained"]
            + marketplace_score * WEIGHTED_SCORE_WEIGHTS["marketplace"]
        )
        recommendation = _inventory_recommendation(
            total_score=total_score,
            sustained_score=sustained_score,
            marketplace_score=marketplace_score,
            quality_fit_score=quality_fit_score,
            positioning_mode=scope.positioning_mode,
        )
        opportunities.append(
            ProductOpportunity(
                keyword=candidate.keyword,
                score_total=round(total_score, 2),
                search_score=round(search_score, 2),
                trend_score=round(trend_score, 2),
                sustained_trend_score=round(sustained_score, 2),
                marketplace_score=round(marketplace_score, 2),
                quality_fit_score=round(quality_fit_score, 2),
                inventory_recommendation=recommendation,
                sources=sorted(candidate.sources),
                rationale=_build_rationale(
                    candidate=candidate,
                    snapshots=snapshots,
                    recommendation=recommendation,
                    quality_fit_score=quality_fit_score,
                ),
                marketplace_snapshots=snapshots,
            )
        )

    opportunities.sort(key=lambda item: (-item.score_total, item.keyword.lower()))

    finished_at = now_utc_iso()
    report = ProductDiscoveryReport(
        generated_at=finished_at,
        started_at=started_at,
        finished_at=finished_at,
        profile=StoreScope(
            store_name=scope.store_name.strip(),
            seed_keywords=seed_keywords,
            tenant_id=scope.tenant_id,
            account_id=scope.account_id,
            shop_id=scope.shop_id,
            positioning_mode=scope.positioning_mode,
            excluded_keywords=sorted(excluded_keywords),
        ),
        config=config,
        opportunities=opportunities,
        search_expansions=search_expansions,
        trend_signals=trend_signals,
        sustained_trend_signals=sustained_trend_signals,
        warnings=warnings,
    )
    return report


def _collect_search_expansions(
    *,
    seed_keywords: list[str],
    config: DiscoveryConfig,
    fetcher: Fetcher,
    search_expansions: list[SearchExpansion],
    candidate_map: dict[str, _CandidateAccumulator],
    warnings: list[str],
) -> None:
    for seed_keyword in seed_keywords:
        google_suggestions: list[str] = []
        try:
            google_suggestions = fetch_google_suggestions(
                keyword=seed_keyword,
                language=config.language,
                max_items=config.max_suggestions_per_source,
                fetcher=fetcher,
            )
        except Exception as exc:  # noqa: BLE001 - surfaced in warnings for ops visibility
            warnings.append(f"Google Suggest failed for '{seed_keyword}': {exc}")
        if google_suggestions:
            search_expansions.append(
                SearchExpansion(
                    seed_keyword=seed_keyword,
                    source="google_suggest",
                    suggestions=google_suggestions,
                )
            )
            _apply_ranked_suggestions(
                candidate_map=candidate_map,
                suggestions=google_suggestions,
                source="google_suggest",
            )

        amazon_suggestions: list[str] = []
        try:
            amazon_suggestions = fetch_amazon_suggestions(
                keyword=seed_keyword,
                max_items=config.max_suggestions_per_source,
                fetcher=fetcher,
            )
        except Exception as exc:  # noqa: BLE001 - surfaced in warnings for ops visibility
            warnings.append(f"Amazon Suggest failed for '{seed_keyword}': {exc}")
        if amazon_suggestions:
            search_expansions.append(
                SearchExpansion(
                    seed_keyword=seed_keyword,
                    source="amazon_suggest",
                    suggestions=amazon_suggestions,
                )
            )
            _apply_ranked_suggestions(
                candidate_map=candidate_map,
                suggestions=amazon_suggestions,
                source="amazon_suggest",
            )


def _collect_trend_signals(
    *,
    seed_keywords: list[str],
    config: DiscoveryConfig,
    fetcher: Fetcher,
    trend_signals: list[TrendSignal],
    candidate_map: dict[str, _CandidateAccumulator],
    warnings: list[str],
) -> None:
    try:
        trend_records = fetch_google_trends_rss(
            geo=config.geo,
            max_items=config.max_trend_items,
            fetcher=fetcher,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced in warnings for ops visibility
        warnings.append(f"Google Trends RSS failed: {exc}")
        return

    for record in trend_records:
        relevance = _keyword_relevance(record.query, seed_keywords)
        if relevance < MIN_RELEVANCE_FOR_TRENDS:
            continue
        trend_signals.append(
            TrendSignal(
                query=record.query,
                source="google_trends_rss",
                rank=record.rank,
                approx_traffic=record.approx_traffic,
                approx_traffic_estimate=record.approx_traffic_estimate,
                relevance_score=round(relevance, 4),
            )
        )
        trend_points = (
            relevance * TREND_RELEVANCE_MULTIPLIER
            + _log_scaled(record.approx_traffic_estimate) * TREND_TRAFFIC_MULTIPLIER
        )
        _add_candidate(
            candidate_map=candidate_map,
            keyword=record.query,
            search_points=SEARCH_SOURCE_WEIGHTS["google_trends"] * relevance,
            trend_points=trend_points,
            source="google_trends_rss",
            trend_traffic_estimate=record.approx_traffic_estimate,
        )


def _collect_sustained_trend_signals(
    *,
    seed_keywords: list[str],
    filtered_candidates: list[_CandidateAccumulator],
    config: DiscoveryConfig,
    fetcher: Fetcher,
    sustained_trend_signals: list[SustainedTrendSignal],
    warnings: list[str],
) -> None:
    ranked = sorted(
        filtered_candidates,
        key=lambda item: (-(item.search_points + item.trend_points), item.keyword.lower()),
    )
    selected: list[_CandidateAccumulator] = []
    for candidate in ranked:
        relevance = _keyword_relevance(candidate.keyword, seed_keywords)
        if relevance < MIN_RELEVANCE_FOR_SUSTAINED_TRENDS:
            continue
        selected.append(candidate)
        if len(selected) >= config.max_sustained_trend_terms:
            break

    failure_count = 0
    for candidate in selected:
        relevance = _keyword_relevance(candidate.keyword, seed_keywords)
        try:
            values = fetch_google_trends_timeseries(
                keyword=candidate.keyword,
                geo=config.geo,
                language=config.language,
                time_window=config.trend_time_window,
                fetcher=fetcher,
            )
        except Exception as exc:  # noqa: BLE001 - surfaced in warnings for ops visibility
            warnings.append(
                f"Google Trends timeseries failed for '{candidate.keyword}': {exc}"
            )
            failure_count += 1
            if failure_count >= MAX_SUSTAINED_TREND_FETCH_FAILURES:
                warnings.append(
                    "Google Trends timeseries disabled for remaining candidates after repeated failures."
                )
                break
            continue
        if len(values) < SUSTAINED_TREND_MIN_POINTS:
            continue

        metrics = compute_sustained_trend_metrics(
            values=values,
            recent_points=SUSTAINED_TREND_RECENT_POINTS,
            baseline_points=SUSTAINED_TREND_BASELINE_POINTS,
        )
        if not metrics:
            continue

        candidate.sustained_points += metrics.sustained_score * relevance
        candidate.sustained_direction = metrics.direction
        candidate.sources.add("google_trends_timeseries")
        sustained_trend_signals.append(
            SustainedTrendSignal(
                query=candidate.keyword,
                source="google_trends_timeseries",
                time_window=config.trend_time_window,
                points_count=metrics.points_count,
                recent_average=round(metrics.recent_average, 2),
                baseline_average=round(metrics.baseline_average, 2),
                growth_rate=round(metrics.growth_rate, 4),
                slope_per_point=round(metrics.slope_per_point, 4),
                consistency_ratio=round(metrics.consistency_ratio, 4),
                sustained_score=round(metrics.sustained_score * relevance, 2),
                direction=metrics.direction,
                store_relevance=round(relevance, 4),
            )
        )


def _apply_ranked_suggestions(
    *,
    candidate_map: dict[str, _CandidateAccumulator],
    suggestions: list[str],
    source: str,
) -> None:
    source_weight = SEARCH_SOURCE_WEIGHTS[source]
    total = max(1, len(suggestions))
    for rank, suggestion in enumerate(suggestions, start=1):
        rank_boost = (total - rank + 1) / total
        search_points = source_weight * rank_boost
        _add_candidate(
            candidate_map=candidate_map,
            keyword=suggestion,
            search_points=search_points,
            trend_points=0.0,
            source=source,
            trend_traffic_estimate=0,
        )


def _filter_candidates(
    candidate_map: dict[str, _CandidateAccumulator],
    *,
    excluded_keywords: set[str],
) -> list[_CandidateAccumulator]:
    filtered: list[_CandidateAccumulator] = []
    for accumulator in candidate_map.values():
        normalized = _normalize_keyword(accumulator.keyword)
        if not normalized:
            continue
        if _is_excluded(normalized, excluded_keywords):
            continue
        filtered.append(accumulator)
    return filtered


def _shortlist_candidates(
    *,
    filtered_candidates: list[_CandidateAccumulator],
    max_candidates: int,
) -> list[_CandidateAccumulator]:
    ranked = sorted(
        filtered_candidates,
        key=lambda item: (
            -(item.search_points + item.trend_points + item.sustained_points),
            item.keyword.lower(),
        ),
    )
    return ranked[:max_candidates]


def _scan_marketplaces_for_keyword(
    *,
    keyword: str,
    marketplaces: tuple[str, ...],
    max_sample_products: int,
    target_pricing_store_id: str,
    fetcher: Fetcher,
    warnings: list[str],
    marketplace_unavailable: dict[str, str],
) -> list[MarketplaceSnapshot]:
    snapshots: list[MarketplaceSnapshot] = []
    for marketplace in marketplaces:
        if marketplace in marketplace_unavailable:
            snapshots.append(
                MarketplaceSnapshot(
                    marketplace=marketplace,
                    query=keyword,
                    source_url="",
                    status="skipped",
                    total_results_estimate=None,
                    sample_products=[],
                    warning=marketplace_unavailable[marketplace],
                )
            )
            continue
        try:
            if marketplace == "amazon":
                result = scan_amazon_marketplace(
                    keyword=keyword,
                    max_sample_products=max_sample_products,
                    fetcher=fetcher,
                )
            elif marketplace == "walmart":
                result = scan_walmart_marketplace(
                    keyword=keyword,
                    max_sample_products=max_sample_products,
                    fetcher=fetcher,
                )
            elif marketplace == "target":
                result = scan_target_marketplace(
                    keyword=keyword,
                    max_sample_products=max_sample_products,
                    pricing_store_id=target_pricing_store_id,
                    fetcher=fetcher,
                )
            else:
                warnings.append(f"Marketplace adapter not implemented for '{marketplace}'.")
                snapshots.append(
                    MarketplaceSnapshot(
                        marketplace=marketplace,
                        query=keyword,
                        source_url="",
                        status="error",
                        total_results_estimate=None,
                        sample_products=[],
                        warning="Adapter not implemented.",
                    )
                )
                continue
            snapshots.append(
                MarketplaceSnapshot(
                    marketplace=marketplace,
                    query=keyword,
                    source_url=result.source_url,
                    status="ok",
                    total_results_estimate=result.total_results_estimate,
                    sample_products=result.sample_products,
                    warning=None,
                )
            )
        except Exception as exc:  # noqa: BLE001 - surfaced in warnings for ops visibility
            warning = f"Marketplace scan failed for '{keyword}' on {marketplace}: {exc}"
            warnings.append(warning)
            if _should_disable_marketplace(str(exc)):
                marketplace_unavailable[marketplace] = str(exc)
                warnings.append(
                    f"Marketplace '{marketplace}' disabled for remaining keywords due to repeated-structure failure."
                )
            snapshots.append(
                MarketplaceSnapshot(
                    marketplace=marketplace,
                    query=keyword,
                    source_url="",
                    status="error",
                    total_results_estimate=None,
                    sample_products=[],
                    warning=str(exc),
                )
            )
    return snapshots


def _score_marketplace_snapshots(snapshots: list[MarketplaceSnapshot]) -> float:
    coverage_count = 0
    result_signal = 0.0
    sample_count = 0

    for snapshot in snapshots:
        if snapshot.status != "ok":
            continue
        if snapshot.total_results_estimate and snapshot.total_results_estimate > 0:
            coverage_count += 1
            capped = min(snapshot.total_results_estimate, MARKETPLACE_RESULT_CAP)
            result_signal += _log_scaled(capped)
        sample_count += len(snapshot.sample_products)

    score = (
        coverage_count * MARKETPLACE_COVERAGE_WEIGHT
        + result_signal * MARKETPLACE_RESULTS_WEIGHT
        + sample_count * MARKETPLACE_SAMPLE_TITLES_WEIGHT
    )
    return min(COMPONENT_SCORE_CAP, score)


def _build_rationale(
    *,
    candidate: _CandidateAccumulator,
    snapshots: list[MarketplaceSnapshot],
    recommendation: str,
    quality_fit_score: float,
) -> list[str]:
    rationale: list[str] = []
    source_text = ", ".join(sorted(candidate.sources))
    rationale.append(f"Signal sources: {source_text}.")

    if candidate.trend_hits > 0:
        rationale.append("Detected in Google Trends RSS with relevance to your store profile.")

    if candidate.sustained_direction:
        rationale.append(
            f"Sustained trend direction over time-series data: {candidate.sustained_direction}."
        )

    available_marketplaces = [
        snapshot.marketplace
        for snapshot in snapshots
        if snapshot.status == "ok" and (snapshot.total_results_estimate or 0) > 0
    ]
    if available_marketplaces:
        joined_marketplaces = ", ".join(sorted(available_marketplaces))
        rationale.append(f"Active marketplace coverage: {joined_marketplaces}.")

    strongest_snapshot = _best_marketplace_snapshot(snapshots)
    if strongest_snapshot:
        if strongest_snapshot.total_results_estimate is not None:
            rationale.append(
                f"Highest marketplace inventory signal on {strongest_snapshot.marketplace}: "
                f"{strongest_snapshot.total_results_estimate:,} estimated results."
            )
        if strongest_snapshot.sample_products:
            rationale.append(f"Sample listing signal: {strongest_snapshot.sample_products[0]}.")

    rationale.append(f"Quality fit score: {quality_fit_score:.1f}/100.")
    rationale.append(f"Inventory recommendation: {recommendation}.")
    return rationale


def _best_marketplace_snapshot(snapshots: list[MarketplaceSnapshot]) -> MarketplaceSnapshot | None:
    valid = [
        snapshot
        for snapshot in snapshots
        if snapshot.status == "ok" and snapshot.total_results_estimate is not None
    ]
    if not valid:
        return None
    return max(valid, key=lambda item: item.total_results_estimate or 0)


def _add_candidate(
    *,
    candidate_map: dict[str, _CandidateAccumulator],
    keyword: str,
    search_points: float,
    trend_points: float,
    source: str,
    trend_traffic_estimate: int,
) -> None:
    normalized = _normalize_keyword(keyword)
    if not normalized:
        return
    key = normalized.lower()
    if key not in candidate_map:
        candidate_map[key] = _CandidateAccumulator(keyword=normalized)
    candidate = candidate_map[key]
    candidate.search_points += search_points
    candidate.trend_points += trend_points
    candidate.sources.add(source)
    if trend_points > 0:
        candidate.trend_hits += 1
        candidate.max_trend_traffic_estimate = max(
            candidate.max_trend_traffic_estimate,
            trend_traffic_estimate,
        )


def _normalize_seed_keywords(seed_keywords: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for keyword in seed_keywords:
        normalized = _normalize_keyword(keyword)
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(normalized)
    return deduped


def _normalize_exclusions(excluded_keywords: list[str]) -> set[str]:
    normalized: set[str] = set()
    for keyword in excluded_keywords:
        value = _normalize_keyword(keyword).lower()
        if value:
            normalized.add(value)
    return normalized


def _is_excluded(keyword: str, excluded_keywords: set[str]) -> bool:
    if not excluded_keywords:
        return False
    lower_keyword = keyword.lower()
    if lower_keyword in excluded_keywords:
        return True
    keyword_tokens = set(_TOKEN_RE.findall(lower_keyword))
    for excluded in excluded_keywords:
        if excluded in lower_keyword:
            return True
        excluded_tokens = set(_TOKEN_RE.findall(excluded))
        if excluded_tokens and excluded_tokens.issubset(keyword_tokens):
            return True
    return False


def _keyword_relevance(candidate_keyword: str, seed_keywords: list[str]) -> float:
    candidate_tokens = set(_TOKEN_RE.findall(candidate_keyword.lower()))
    if not candidate_tokens:
        return 0.0

    best_score = 0.0
    candidate_lower = candidate_keyword.lower()
    for seed_keyword in seed_keywords:
        seed_lower = seed_keyword.lower()
        seed_tokens = set(_TOKEN_RE.findall(seed_lower))
        if not seed_tokens:
            continue

        overlap = len(candidate_tokens.intersection(seed_tokens))
        if overlap > 0:
            token_ratio = overlap / len(seed_tokens)
            best_score = max(best_score, token_ratio)
        elif seed_lower in candidate_lower or candidate_lower in seed_lower:
            best_score = max(best_score, 0.35)

    return min(1.0, best_score)


def _score_quality_fit(*, keyword: str, positioning_mode: str) -> float:
    keyword_lower = keyword.lower()
    score = QUALITY_SCORE_BASELINE
    for positive_token in QUALITY_POSITIVE_TOKENS:
        if positive_token in keyword_lower:
            score += QUALITY_POSITIVE_TOKEN_BOOST
    for negative_token in QUALITY_NEGATIVE_TOKENS:
        if negative_token in keyword_lower:
            score -= QUALITY_NEGATIVE_TOKEN_PENALTY

    if positioning_mode == "quality":
        # Require stronger curation standards for quality-focused stores.
        for negative_token in QUALITY_NEGATIVE_TOKENS:
            if negative_token in keyword_lower:
                score -= QUALITY_NEGATIVE_TOKEN_PENALTY
    return _clamp(score, lower=QUALITY_SCORE_MIN, upper=QUALITY_SCORE_MAX)


def _inventory_recommendation(
    *,
    total_score: float,
    sustained_score: float,
    marketplace_score: float,
    quality_fit_score: float,
    positioning_mode: str,
) -> str:
    quality_required = positioning_mode == "quality"

    add_now_quality_ok = (
        quality_fit_score >= INVENTORY_RECOMMENDATION_THRESHOLDS["add_now_quality_min"]
    ) if quality_required else True
    if (
        total_score >= INVENTORY_RECOMMENDATION_THRESHOLDS["add_now_total_min"]
        and sustained_score >= INVENTORY_RECOMMENDATION_THRESHOLDS["add_now_sustained_min"]
        and marketplace_score >= INVENTORY_RECOMMENDATION_THRESHOLDS["add_now_marketplace_min"]
        and add_now_quality_ok
    ):
        return "add_now"

    test_quality_ok = (
        quality_fit_score >= INVENTORY_RECOMMENDATION_THRESHOLDS["test_batch_quality_min"]
    ) if quality_required else True
    if (
        total_score >= INVENTORY_RECOMMENDATION_THRESHOLDS["test_batch_total_min"]
        and sustained_score >= INVENTORY_RECOMMENDATION_THRESHOLDS["test_batch_sustained_min"]
        and test_quality_ok
    ):
        return "test_small_batch"

    if total_score >= INVENTORY_RECOMMENDATION_THRESHOLDS["watchlist_total_min"]:
        return "watchlist"
    return "reject"


def _normalize_keyword(keyword: str) -> str:
    collapsed = _WHITESPACE_RE.sub(" ", keyword.strip())
    if not collapsed:
        return ""
    if len(collapsed) < MIN_KEYWORD_LENGTH:
        return ""
    if len(collapsed) > MAX_KEYWORD_LENGTH:
        return collapsed[:MAX_KEYWORD_LENGTH].rstrip()
    return collapsed


def _log_scaled(value: int) -> float:
    if value <= 0:
        return 0.0
    return min(1.0, log10(value + 1) / 6.0)


def _clamp(value: float, *, lower: float, upper: float) -> float:
    if value < lower:
        return lower
    if value > upper:
        return upper
    return value


def _validate_marketplaces(marketplaces: tuple[str, ...]) -> None:
    unsupported = [item for item in marketplaces if item not in SUPPORTED_MARKETPLACES]
    if unsupported:
        supported_str = ", ".join(sorted(SUPPORTED_MARKETPLACES))
        unsupported_str = ", ".join(sorted(unsupported))
        raise ValueError(
            f"Unsupported marketplaces: {unsupported_str}. Supported: {supported_str}."
        )


def _validate_positioning_mode(positioning_mode: str) -> None:
    if positioning_mode not in SUPPORTED_POSITIONING_MODES:
        supported = ", ".join(sorted(SUPPORTED_POSITIONING_MODES))
        raise ValueError(
            f"Unsupported positioning mode '{positioning_mode}'. Supported: {supported}."
        )


def _should_disable_marketplace(error_text: str) -> bool:
    normalized = error_text.lower()
    disable_markers = (
        "missing __next_data__ script",
        "missing api key",
        "http error 403",
        "http error 429",
        "precondition failed",
        "access denied",
        "pardon our interruption",
    )
    return any(marker in normalized for marker in disable_markers)
