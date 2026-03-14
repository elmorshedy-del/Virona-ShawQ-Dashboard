from __future__ import annotations

from urllib.parse import urlparse

from .campaigns import build_ad_groups
from .competitors import build_competitor_intelligence
from .discovery import discover_store
from .external_competitors import fetch_external_competitor_data
from .keywords import generate_candidates
from .monitoring import build_monitoring_snapshot
from .models import PipelineOutput
from .providers import ProviderContext, collect_keyword_evidence, normalize_keyword
from .scoring import classify_intent, score_keyword
from .settings import load_settings
from .storage import load_run_keywords, persist_run


def _keyword_relevance(keyword: str, product_names: list[str]) -> float:
    k_tokens = set(keyword.split())
    if not k_tokens:
        return 0.0
    best = 0.0
    for name in product_names:
        p_tokens = set(name.lower().split())
        overlap = len(k_tokens & p_tokens)
        candidate = overlap / max(len(k_tokens), 1)
        if candidate > best:
            best = candidate
    return max(0.2, min(best, 1.0))


def _intent_priority(intent: str) -> int:
    return {
        "transactional": 4,
        "commercial": 3,
        "navigational": 2,
        "informational": 1,
    }.get(intent, 0)


def _prioritize_keywords(
    keywords: list[str], relevance_map: dict[str, float]
) -> list[str]:
    return sorted(
        keywords,
        key=lambda keyword: (
            -relevance_map.get(keyword, 0.0),
            -_intent_priority(classify_intent(keyword)),
            len(keyword),
            keyword,
        ),
    )


def run_pipeline(
    store_url: str,
    max_keywords: int = 400,
    *,
    market: str | None = None,
    language: str | None = None,
) -> PipelineOutput:
    profile = discover_store(store_url)
    if market or language:
        updates: dict[str, str] = {}
        if market:
            updates["market"] = str(market).strip().upper()
        if language:
            updates["language"] = str(language).strip().lower()
        profile = profile.model_copy(update=updates)
    candidates = []
    seen: set[str] = set()
    for candidate in generate_candidates(profile):
        normalized = normalize_keyword(candidate)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(normalized)

    product_names = [p.name for p in profile.products]
    relevance_map = {
        keyword: _keyword_relevance(keyword, product_names) for keyword in candidates
    }
    prioritized = _prioritize_keywords(candidates, relevance_map)

    settings = load_settings()
    context = ProviderContext(
        language=profile.language,
        market=profile.market,
        store_url=profile.url,
        store_domain=(urlparse(profile.url).hostname or "").lower(),
    )
    evidence_map, source_status = collect_keyword_evidence(
        all_keywords=candidates,
        prioritized_keywords=prioritized,
        context=context,
        settings=settings,
    )

    scored = [
        score_keyword(
            keyword,
            relevance=relevance_map.get(keyword, 0.2),
            evidence=evidence_map.get(keyword, {}),
        )
        for keyword in candidates
    ]
    ranked = sorted(scored, key=lambda k: k.score, reverse=True)[:max_keywords]
    external_competitor_data = fetch_external_competitor_data(
        store_domain=context.store_domain,
        market=context.market,
        settings=settings,
        max_competitors=10,
    )
    competitor_intelligence = build_competitor_intelligence(
        ranked_keywords=ranked,
        evidence_map=evidence_map,
        store_domain=context.store_domain,
        brand_positioning=profile.positioning,
        external_data=external_competitor_data,
    )
    ad_groups = build_ad_groups(profile, ranked)

    run_id: int | None = None
    previous_run_id: int | None = None
    previous_keywords = {}
    if settings.persist_runs:
        run_id, previous_run_id = persist_run(
            db_path=settings.db_path,
            profile=profile,
            keywords=ranked,
            source_status=source_status,
            competitor_intelligence=competitor_intelligence,
        )
        if previous_run_id:
            previous_keywords = load_run_keywords(settings.db_path, previous_run_id)

    monitoring = build_monitoring_snapshot(
        current_keywords=ranked,
        previous_keywords=previous_keywords,
        evidence_map=evidence_map,
        run_id=run_id,
        previous_run_id=previous_run_id,
        rising_threshold=settings.monitor_rising_threshold,
        alert_min_confidence=settings.monitor_alert_min_confidence,
    )

    return PipelineOutput(
        profile=profile,
        keywords=ranked,
        ad_groups=ad_groups,
        source_status=source_status,
        competitor_intelligence=competitor_intelligence,
        monitoring=monitoring,
    )
