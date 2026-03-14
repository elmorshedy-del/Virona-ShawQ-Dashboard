from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from urllib.parse import urlparse

import requests

from .settings import ProviderSettings


def _domain(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        parsed = urlparse(raw)
    except ValueError:
        return ""
    domain = (parsed.hostname or "").lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def _extract_domains(node: object) -> list[str]:
    out: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            lowered = str(key).lower()
            if lowered in {"domain", "site", "competitor", "competitordomain"}:
                parsed = _domain(str(value))
                if parsed:
                    out.append(parsed)
            out.extend(_extract_domains(value))
    elif isinstance(node, list):
        for item in node:
            out.extend(_extract_domains(item))
    return out


def _extract_keywords(node: object) -> list[str]:
    out: list[str] = []
    if isinstance(node, dict):
        for key, value in node.items():
            lowered = str(key).lower()
            if lowered in {"keyword", "keywords", "kw", "term", "query"}:
                if isinstance(value, str):
                    cleaned = " ".join(value.split()).strip().lower()
                    if cleaned:
                        out.append(cleaned)
                elif isinstance(value, list):
                    for item in value:
                        if isinstance(item, str):
                            cleaned = " ".join(item.split()).strip().lower()
                            if cleaned:
                                out.append(cleaned)
            out.extend(_extract_keywords(value))
    elif isinstance(node, list):
        for item in node:
            out.extend(_extract_keywords(item))
    return out


def _dedupe_keep_order(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = " ".join(str(value or "").split()).strip().lower()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        output.append(cleaned)
    return output


def _parse_semrush_rows(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or ";" not in stripped:
            continue
        rows.append([part.strip() for part in stripped.split(";")])
    return rows


@dataclass
class ExternalCompetitorData:
    source_status: dict[str, str] = field(default_factory=dict)
    competitor_domains: set[str] = field(default_factory=set)
    paid_keywords: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    organic_keywords: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    ad_copy_examples: dict[str, list[str]] = field(default_factory=lambda: defaultdict(list))


def _spyfu_fetch(
    store_domain: str,
    settings: ProviderSettings,
    data: ExternalCompetitorData,
    max_competitors: int,
) -> None:
    if not settings.spyfu_ready:
        data.source_status["spyfu"] = "not_configured"
        return
    auth = (settings.spyfu_username, settings.spyfu_password)
    base = settings.spyfu_api_base_url.rstrip("/")
    try:
        top_response = requests.get(
            f"{base}/competitors_api/v2/ppc/getTopCompetitors",
            params={
                "domain": store_domain,
                "countryCode": settings.spyfu_country_code,
            },
            auth=auth,
            timeout=settings.http_timeout_sec,
        )
        if not top_response.ok:
            data.source_status["spyfu"] = f"http_{top_response.status_code}"
            return
        payload = top_response.json()
        competitors = _dedupe_keep_order(_extract_domains(payload))[:max_competitors]
        if not competitors:
            data.source_status["spyfu"] = "empty"
            return
        for competitor in competitors:
            if competitor == store_domain:
                continue
            data.competitor_domains.add(competitor)
            kw_response = requests.get(
                f"{base}/keyword_api/v2/ppc/getMostSuccessful",
                params={
                    "domain": competitor,
                    "countryCode": settings.spyfu_country_code,
                },
                auth=auth,
                timeout=settings.http_timeout_sec,
            )
            if not kw_response.ok:
                continue
            keywords = _dedupe_keep_order(_extract_keywords(kw_response.json()))[:60]
            for keyword in keywords:
                data.paid_keywords[competitor].add(keyword)
        data.source_status["spyfu"] = "ok"
    except Exception as exc:
        data.source_status["spyfu"] = f"error:{exc.__class__.__name__}"


def _semrush_fetch(
    store_domain: str,
    settings: ProviderSettings,
    data: ExternalCompetitorData,
    max_competitors: int,
) -> None:
    if not settings.semrush_ready:
        data.source_status["semrush"] = "not_configured"
        return
    endpoint = "https://api.semrush.com/"
    competitor_domains: list[str] = []
    try:
        for competitor_type in (
            "domain_adwords_unique",
            "domain_adwords_organic",
            "domain_organic_organic",
        ):
            response = requests.get(
                endpoint,
                params={
                    "type": competitor_type,
                    "key": settings.semrush_api_key,
                    "domain": store_domain,
                    "database": settings.semrush_database,
                    "display_limit": max_competitors,
                    "display_sort": "tr_desc",
                },
                timeout=settings.http_timeout_sec,
            )
            if not response.ok or not response.text.strip():
                continue
            rows = _parse_semrush_rows(response.text)
            for row in rows[1:]:
                if not row:
                    continue
                parsed = _domain(row[0])
                if parsed and parsed != store_domain:
                    competitor_domains.append(parsed)
            if competitor_domains:
                break

        competitors = _dedupe_keep_order(competitor_domains)[:max_competitors]
        if not competitors:
            data.source_status["semrush"] = "empty"
            return

        for competitor in competitors:
            data.competitor_domains.add(competitor)
            keyword_rows: list[list[str]] = []
            for keyword_type in ("domain_adwords", "domain_adwords_adwords"):
                response = requests.get(
                    endpoint,
                    params={
                        "type": keyword_type,
                        "key": settings.semrush_api_key,
                        "domain": competitor,
                        "database": settings.semrush_database,
                        "display_limit": 80,
                        "display_sort": "tr_desc",
                    },
                    timeout=settings.http_timeout_sec,
                )
                if response.ok and response.text.strip():
                    keyword_rows = _parse_semrush_rows(response.text)
                if keyword_rows:
                    break
            for row in keyword_rows[1:]:
                if not row:
                    continue
                keyword = " ".join(row[0].split()).strip().lower()
                if keyword:
                    data.paid_keywords[competitor].add(keyword)
        data.source_status["semrush"] = "ok"
    except Exception as exc:
        data.source_status["semrush"] = f"error:{exc.__class__.__name__}"


def _ahrefs_fetch(
    store_domain: str,
    settings: ProviderSettings,
    data: ExternalCompetitorData,
    max_competitors: int,
) -> None:
    if not settings.ahrefs_ready:
        data.source_status["ahrefs"] = "not_configured"
        return
    headers = {"Authorization": f"Bearer {settings.ahrefs_api_key}"}
    base = settings.ahrefs_api_base_url.rstrip("/")
    try:
        paid_url = f"{base}{settings.ahrefs_paid_keywords_path}"
        response = requests.get(
            paid_url,
            params={"domain": store_domain, "limit": max_competitors},
            headers=headers,
            timeout=settings.http_timeout_sec,
        )
        if not response.ok:
            data.source_status["ahrefs"] = f"http_{response.status_code}"
            return
        payload = response.json()
        for competitor in _dedupe_keep_order(_extract_domains(payload))[:max_competitors]:
            if competitor and competitor != store_domain:
                data.competitor_domains.add(competitor)
        for keyword in _dedupe_keep_order(_extract_keywords(payload))[:120]:
            for domain in data.competitor_domains:
                data.paid_keywords[domain].add(keyword)

        organic_url = f"{base}{settings.ahrefs_organic_keywords_path}"
        response_org = requests.get(
            organic_url,
            params={"domain": store_domain, "limit": 80},
            headers=headers,
            timeout=settings.http_timeout_sec,
        )
        if response_org.ok:
            org_keywords = _dedupe_keep_order(_extract_keywords(response_org.json()))[:80]
            for domain in data.competitor_domains:
                for keyword in org_keywords:
                    data.organic_keywords[domain].add(keyword)
        data.source_status["ahrefs"] = "ok"
    except Exception as exc:
        data.source_status["ahrefs"] = f"error:{exc.__class__.__name__}"


def fetch_external_competitor_data(
    *,
    store_domain: str,
    market: str,
    settings: ProviderSettings,
    max_competitors: int = 10,
) -> ExternalCompetitorData:
    del market
    data = ExternalCompetitorData()
    normalized_store = _domain(store_domain)
    _spyfu_fetch(
        store_domain=normalized_store,
        settings=settings,
        data=data,
        max_competitors=max_competitors,
    )
    _semrush_fetch(
        store_domain=normalized_store,
        settings=settings,
        data=data,
        max_competitors=max_competitors,
    )
    _ahrefs_fetch(
        store_domain=normalized_store,
        settings=settings,
        data=data,
        max_competitors=max_competitors,
    )
    return data
