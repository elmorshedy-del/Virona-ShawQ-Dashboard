from __future__ import annotations

import re
from collections import defaultdict
from urllib.parse import urlparse

from .external_competitors import ExternalCompetitorData
from .models import (
    AdCopyGap,
    CompetitorIntelligence,
    CompetitorRecord,
    KeywordGap,
    KeywordMetric,
    SourceEvidence,
)


STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "buy",
    "for",
    "from",
    "in",
    "is",
    "it",
    "now",
    "of",
    "on",
    "or",
    "our",
    "shop",
    "the",
    "to",
    "with",
    "your",
}

NON_COMPETITOR_DOMAINS = {
    "apps.apple.com",
    "duck.ai",
    "duckduckgo.com",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "pinterest.com",
    "play.google.com",
    "reddit.com",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "youtube.com",
}

NON_COMPETITOR_SUFFIXES = (
    ".substack.com",
    ".wikipedia.org",
    ".medium.com",
    ".linkedin.com",
    ".facebook.com",
    ".instagram.com",
    ".youtube.com",
)


def canonicalize_domain(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        parsed = urlparse(raw)
    except ValueError:
        return ""
    domain = (parsed.hostname or "").strip().lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def _is_competitor_domain(domain: str) -> bool:
    cleaned = canonicalize_domain(domain)
    if not cleaned:
        return False
    if cleaned in NON_COMPETITOR_DOMAINS:
        return False
    if cleaned.endswith(NON_COMPETITOR_SUFFIXES):
        return False
    if cleaned.endswith(".google.com"):
        return False
    if cleaned.endswith(".duckduckgo.com"):
        return False
    return True


def _dedupe_keep_order(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for item in values:
        cleaned = " ".join(str(item or "").split()).strip()
        key = cleaned.lower()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        output.append(cleaned)
    return output


def _keyword_score(keyword: str, metrics_by_keyword: dict[str, KeywordMetric]) -> float:
    metric = metrics_by_keyword.get(keyword)
    if not metric:
        return 0.0
    return float(metric.score)


def _extract_landing_pages(evidence: SourceEvidence) -> list[str]:
    return _dedupe_keep_order(evidence.competitor_landing_pages)[:20]


def _extract_ad_entries(evidence: SourceEvidence) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    for entry in evidence.ad_copies:
        if not isinstance(entry, dict):
            continue
        headline = " ".join(str(entry.get("headline", "")).split()).strip()
        description = " ".join(str(entry.get("description", "")).split()).strip()
        domain = canonicalize_domain(str(entry.get("domain", "")))
        landing_page = str(entry.get("landing_page", "")).strip()
        if not headline and not description:
            continue
        cleaned.append(
            {
                "headline": headline,
                "description": description,
                "domain": domain,
                "landing_page": landing_page,
            }
        )
    return cleaned


def _sort_keywords(
    keywords: set[str], metrics_by_keyword: dict[str, KeywordMetric]
) -> list[str]:
    return sorted(
        keywords,
        key=lambda keyword: (-_keyword_score(keyword, metrics_by_keyword), keyword),
    )


def _estimate_spend_usd(
    paid_keywords: list[str],
    organic_keywords: list[str],
    metrics_by_keyword: dict[str, KeywordMetric],
) -> float:
    spend = 0.0
    if paid_keywords:
        for keyword in paid_keywords:
            metric = metrics_by_keyword.get(keyword)
            if not metric:
                continue
            spend += float(metric.volume) * float(metric.cpc) * 0.045
    else:
        for keyword in organic_keywords[:8]:
            metric = metrics_by_keyword.get(keyword)
            if not metric:
                continue
            spend += float(metric.volume) * float(metric.cpc) * 0.015
    return round(max(0.0, spend), 2)


def _angle_tokens(text: str) -> list[str]:
    normalized = re.sub(r"[^a-z0-9\s]", " ", text.lower())
    tokens = [token for token in normalized.split() if len(token) >= 3 and token not in STOPWORDS]
    angles: list[str] = []
    for idx in range(len(tokens)):
        if idx + 1 < len(tokens):
            angles.append(f"{tokens[idx]} {tokens[idx + 1]}")
        if idx + 2 < len(tokens):
            angles.append(f"{tokens[idx]} {tokens[idx + 1]} {tokens[idx + 2]}")
    return angles


def build_competitor_intelligence(
    *,
    ranked_keywords: list[KeywordMetric],
    evidence_map: dict[str, dict[str, SourceEvidence]],
    store_domain: str,
    brand_positioning: str,
    manual_competitors: list[str] | None = None,
    max_competitors: int = 10,
    external_data: ExternalCompetitorData | None = None,
) -> CompetitorIntelligence:
    normalized_store_domain = canonicalize_domain(store_domain)
    metrics_by_keyword = {metric.keyword: metric for metric in ranked_keywords}

    organic_by_domain: dict[str, set[str]] = defaultdict(set)
    paid_by_domain: dict[str, set[str]] = defaultdict(set)
    landing_by_domain: dict[str, list[str]] = defaultdict(list)
    ad_copy_by_domain: dict[str, list[str]] = defaultdict(list)
    domain_weight: dict[str, float] = defaultdict(float)

    gap_domains: dict[str, set[str]] = defaultdict(set)
    gap_volume: dict[str, float] = defaultdict(float)
    gap_cpc_sum: dict[str, float] = defaultdict(float)
    gap_score_sum: dict[str, float] = defaultdict(float)
    gap_count: dict[str, int] = defaultdict(int)
    provider_status: dict[str, str] = {}

    for metric in ranked_keywords:
        by_source = evidence_map.get(metric.keyword, {})
        serp = by_source.get("custom-serp")
        if not serp:
            continue

        domains = [
            domain
            for domain in (canonicalize_domain(item) for item in serp.competitor_domains)
            if domain and domain != normalized_store_domain and _is_competitor_domain(domain)
        ]
        if not domains:
            continue

        for domain in domains:
            organic_by_domain[domain].add(metric.keyword)
            domain_weight[domain] += float(metric.score)

        for page in _extract_landing_pages(serp):
            domain = canonicalize_domain(page)
            if domain and domain in domains:
                landing_by_domain[domain].append(page)

        for ad in _extract_ad_entries(serp):
            domain = ad.get("domain", "")
            if not domain or domain == normalized_store_domain:
                continue
            text = " ".join([ad.get("headline", ""), ad.get("description", "")]).strip()
            if text:
                ad_copy_by_domain[domain].append(text)
            paid_by_domain[domain].add(metric.keyword)
            if ad.get("landing_page"):
                landing_by_domain[domain].append(ad["landing_page"])

        related_terms = _dedupe_keep_order(
            [*serp.related_searches, *serp.people_also_ask]
        )[:20]
        for term in related_terms:
            if term.lower() == metric.keyword.lower():
                continue
            for domain in domains:
                gap_domains[term].add(domain)
            gap_volume[term] += float(metric.volume) * 0.35
            gap_cpc_sum[term] += float(metric.cpc)
            gap_score_sum[term] += float(metric.score)
            gap_count[term] += 1

    for domain in manual_competitors or []:
        cleaned = canonicalize_domain(domain)
        if (
            cleaned
            and cleaned != normalized_store_domain
            and _is_competitor_domain(cleaned)
        ):
            domain_weight.setdefault(cleaned, 0.0)
            organic_by_domain.setdefault(cleaned, set())
            paid_by_domain.setdefault(cleaned, set())
            landing_by_domain.setdefault(cleaned, [])
            ad_copy_by_domain.setdefault(cleaned, [])

    if external_data:
        provider_status.update(external_data.source_status)
        for domain in external_data.competitor_domains:
            cleaned = canonicalize_domain(domain)
            if (
                not cleaned
                or cleaned == normalized_store_domain
                or not _is_competitor_domain(cleaned)
            ):
                continue
            domain_weight[cleaned] += 24.0
            organic_by_domain.setdefault(cleaned, set())
            paid_by_domain.setdefault(cleaned, set())
            landing_by_domain.setdefault(cleaned, [])
            ad_copy_by_domain.setdefault(cleaned, [])

        for domain, keywords in external_data.paid_keywords.items():
            cleaned = canonicalize_domain(domain)
            if (
                not cleaned
                or cleaned == normalized_store_domain
                or not _is_competitor_domain(cleaned)
            ):
                continue
            for keyword in keywords:
                normalized_keyword = " ".join(str(keyword).split()).strip().lower()
                if not normalized_keyword:
                    continue
                paid_by_domain[cleaned].add(normalized_keyword)
                metric = metrics_by_keyword.get(normalized_keyword)
                domain_weight[cleaned] += metric.score if metric else 12.0
                if normalized_keyword not in {
                    item.keyword.lower() for item in ranked_keywords[:120]
                }:
                    gap_domains[normalized_keyword].add(cleaned)
                    if metric:
                        gap_volume[normalized_keyword] += float(metric.volume)
                        gap_cpc_sum[normalized_keyword] += float(metric.cpc)
                        gap_score_sum[normalized_keyword] += float(metric.score)
                    else:
                        gap_volume[normalized_keyword] += 600.0
                        gap_cpc_sum[normalized_keyword] += 1.2
                        gap_score_sum[normalized_keyword] += 65.0
                    gap_count[normalized_keyword] += 1

        for domain, keywords in external_data.organic_keywords.items():
            cleaned = canonicalize_domain(domain)
            if (
                not cleaned
                or cleaned == normalized_store_domain
                or not _is_competitor_domain(cleaned)
            ):
                continue
            for keyword in keywords:
                normalized_keyword = " ".join(str(keyword).split()).strip().lower()
                if not normalized_keyword:
                    continue
                organic_by_domain[cleaned].add(normalized_keyword)
                metric = metrics_by_keyword.get(normalized_keyword)
                domain_weight[cleaned] += metric.score if metric else 6.0

    top_domains = sorted(
        domain_weight.keys(),
        key=lambda domain: (
            -domain_weight[domain],
            -(len(paid_by_domain[domain]) + len(organic_by_domain[domain])),
            domain,
        ),
    )[: max(1, max_competitors)]

    competitors: list[CompetitorRecord] = []
    for domain in top_domains:
        organic_keywords = _sort_keywords(organic_by_domain[domain], metrics_by_keyword)[:40]
        paid_keywords = _sort_keywords(paid_by_domain[domain], metrics_by_keyword)[:40]
        ad_copy_examples = _dedupe_keep_order(ad_copy_by_domain[domain])[:8]
        landing_pages = _dedupe_keep_order(landing_by_domain[domain])[:10]
        competitors.append(
            CompetitorRecord(
                domain=domain,
                organic_keywords=organic_keywords,
                paid_keywords=paid_keywords,
                ad_copy_examples=ad_copy_examples,
                landing_pages=landing_pages,
                estimated_monthly_spend_usd=_estimate_spend_usd(
                    paid_keywords=paid_keywords,
                    organic_keywords=organic_keywords,
                    metrics_by_keyword=metrics_by_keyword,
                ),
            )
        )

    user_targeted = {metric.keyword.lower() for metric in ranked_keywords[:120]}
    keyword_gaps: list[KeywordGap] = []
    for keyword, domains in gap_domains.items():
        if keyword.lower() in user_targeted:
            continue
        count = max(1, gap_count[keyword])
        est_volume = int(max(20.0, gap_volume[keyword] / count))
        est_cpc = round(max(0.2, gap_cpc_sum[keyword] / count), 2)
        base_score = gap_score_sum[keyword] / count
        domain_factor = min(len(domains) / 6.0, 1.0)
        volume_factor = min(est_volume / 8000.0, 1.0)
        opportunity = round(
            max(5.0, min(100.0, (base_score * 0.58) + (domain_factor * 24) + (volume_factor * 18))),
            2,
        )
        keyword_gaps.append(
            KeywordGap(
                keyword=keyword,
                competitor_domains=sorted(domains),
                estimated_volume=est_volume,
                estimated_cpc=est_cpc,
                opportunity_score=opportunity,
            )
        )
    keyword_gaps = sorted(
        keyword_gaps,
        key=lambda gap: (-gap.opportunity_score, -gap.estimated_volume, gap.keyword),
    )[:25]

    brand_text = re.sub(r"\s+", " ", (brand_positioning or "").lower()).strip()
    angle_domains: dict[str, set[str]] = defaultdict(set)
    angle_examples: dict[str, list[str]] = defaultdict(list)
    for domain, copies in ad_copy_by_domain.items():
        for text in copies:
            for angle in _angle_tokens(text):
                if angle in brand_text:
                    continue
                angle_domains[angle].add(domain)
                angle_examples[angle].append(text)

    ad_copy_gaps: list[AdCopyGap] = []
    ranked_angles = sorted(
        angle_domains.keys(),
        key=lambda angle: (
            -len(angle_domains[angle]),
            -len(angle_examples[angle]),
            angle,
        ),
    )
    for angle in ranked_angles[:20]:
        ad_copy_gaps.append(
            AdCopyGap(
                angle=angle,
                competitor_domains=sorted(angle_domains[angle]),
                examples=_dedupe_keep_order(angle_examples[angle])[:3],
            )
        )

    return CompetitorIntelligence(
        provider_status=provider_status,
        discovered_competitors=competitors,
        keyword_gaps=keyword_gaps,
        ad_copy_gaps=ad_copy_gaps,
    )
