from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from statistics import mean
from urllib.parse import urlparse

import requests
from pydantic import BaseModel

from .models import SourceEvidence
from .serp import search_serp
from .settings import ProviderSettings


GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com"
GOOGLE_TRENDS_API = "https://trends.google.com/trends/api"
GOOGLE_TRENDS_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

LANGUAGE_CONSTANT_BY_CODE = {
    "en": "1000",
    "de": "1001",
    "fr": "1002",
    "es": "1003",
    "ar": "1019",
}

GEO_TARGET_BY_MARKET = {
    "US": "2840",
    "SA": "2682",
    "AE": "2784",
    "GB": "2826",
    "DE": "2276",
    "FR": "2250",
    "ES": "2724",
    "CA": "2124",
    "AU": "2036",
}

HL_BY_LANGUAGE = {
    "en": "en-US",
    "ar": "ar",
    "fr": "fr",
    "es": "es",
    "de": "de",
}


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def normalize_keyword(value: str) -> str:
    return " ".join(str(value or "").lower().strip().split())


def _dedupe_keep_order(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = normalize_keyword(value)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _trend_direction(values: list[int]) -> str:
    if len(values) < 6:
        return "stable"
    window = max(3, len(values) // 4)
    recent = values[-window:]
    previous = values[-(2 * window) : -window] or values[:window]
    recent_mean = mean(recent) if recent else 0.0
    previous_mean = mean(previous) if previous else 0.0
    denominator = max(1.0, previous_mean)
    delta = ((recent_mean - previous_mean) / denominator) * 100
    if delta > 8:
        return "growing"
    if delta < -8:
        return "declining"
    return "stable"


def _safe_mean(values: list[float]) -> float | None:
    filtered = [value for value in values if value is not None]
    if not filtered:
        return None
    return float(mean(filtered))


class ProviderContext(BaseModel):
    language: str
    market: str
    store_url: str
    store_domain: str


class BaseProvider:
    source = "base"

    def __init__(self, settings: ProviderSettings) -> None:
        self.settings = settings
        self.last_status = "idle"

    def fetch(
        self, keywords: list[str], context: ProviderContext
    ) -> dict[str, SourceEvidence]:
        raise NotImplementedError


class GoogleKeywordPlannerProvider(BaseProvider):
    source = "keyword-planner"

    def __init__(self, settings: ProviderSettings) -> None:
        super().__init__(settings)
        self._access_token = ""
        self._access_token_expiry = 0.0

    def _language_resource(self, language: str) -> str:
        code = LANGUAGE_CONSTANT_BY_CODE.get(language, LANGUAGE_CONSTANT_BY_CODE["en"])
        return f"languageConstants/{code}"

    def _geo_resource(self, market: str) -> str | None:
        code = GEO_TARGET_BY_MARKET.get(market.upper())
        if not code:
            return None
        return f"geoTargetConstants/{code}"

    def _get_access_token(self) -> str:
        now = time.time()
        if self._access_token and now < (self._access_token_expiry - 60):
            return self._access_token

        body = {
            "client_id": self.settings.google_ads_client_id,
            "client_secret": self.settings.google_ads_client_secret,
            "refresh_token": self.settings.google_ads_refresh_token,
            "grant_type": "refresh_token",
        }
        response = requests.post(
            GOOGLE_OAUTH_TOKEN_URL,
            data=body,
            timeout=self.settings.http_timeout_sec,
        )
        payload = response.json() if response.content else {}
        if not response.ok or "access_token" not in payload:
            message = payload.get("error_description") or payload.get("error") or response.text
            raise RuntimeError(f"oauth_exchange_failed:{message}")

        self._access_token = str(payload["access_token"])
        expires_in = int(payload.get("expires_in", 3600))
        self._access_token_expiry = now + expires_in
        return self._access_token

    def _to_evidence(self, entry: dict) -> SourceEvidence:
        metrics = entry.get("keywordMetrics") or {}
        avg_monthly = metrics.get("avgMonthlySearches")
        competition_index = metrics.get("competitionIndex")
        if competition_index is None:
            competition_raw = str(metrics.get("competition", "")).upper()
            fallback_map = {"LOW": 0.25, "MEDIUM": 0.55, "HIGH": 0.85}
            competition_index = fallback_map.get(competition_raw)

        cpc_micros = metrics.get("averageCpcMicros")
        if cpc_micros is None:
            low = metrics.get("lowTopOfPageBidMicros")
            high = metrics.get("highTopOfPageBidMicros")
            cpc_micros = _safe_mean(
                [float(low) if low is not None else None, float(high) if high is not None else None]
            )

        cpc = None
        if cpc_micros is not None:
            cpc = round(float(cpc_micros) / 1_000_000, 2)

        confidence_signal = 0.92 if avg_monthly is not None else 0.7
        return SourceEvidence(
            source=self.source,
            observed_at=_utc_now_iso(),
            volume=int(avg_monthly) if avg_monthly is not None else None,
            cpc=cpc,
            competition_index=(
                round(float(competition_index), 3)
                if competition_index is not None
                else None
            ),
            confidence_signal=confidence_signal,
            raw={"close_variants": entry.get("closeVariants") or []},
        )

    def fetch(
        self, keywords: list[str], context: ProviderContext
    ) -> dict[str, SourceEvidence]:
        if not self.settings.google_ads_ready:
            self.last_status = "not_configured"
            return {}

        requested = _dedupe_keep_order(keywords)
        if not requested:
            self.last_status = "skipped_empty"
            return {}

        language = self._language_resource(context.language)
        geo_resource = self._geo_resource(context.market)

        try:
            access_token = self._get_access_token()
        except Exception as exc:
            self.last_status = f"oauth_error:{exc}"
            return {}

        endpoint = (
            f"{GOOGLE_ADS_API_BASE}/{self.settings.google_ads_api_version}/customers/"
            f"{self.settings.google_ads_customer_id}:generateKeywordHistoricalMetrics"
        )

        headers = {
            "Authorization": f"Bearer {access_token}",
            "developer-token": self.settings.google_ads_developer_token,
            "Content-Type": "application/json",
        }
        if self.settings.google_ads_login_customer_id:
            headers["login-customer-id"] = self.settings.google_ads_login_customer_id

        results: dict[str, SourceEvidence] = {}
        had_error = False
        chunk_size = 700
        for start in range(0, len(requested), chunk_size):
            chunk = requested[start : start + chunk_size]
            payload = {
                "keywords": chunk,
                "language": language,
                "keywordPlanNetwork": "GOOGLE_SEARCH_AND_PARTNERS",
            }
            if geo_resource:
                payload["geoTargetConstants"] = [geo_resource]

            response = requests.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=self.settings.http_timeout_sec,
            )
            if not response.ok:
                had_error = True
                if response.status_code in {401, 403}:
                    break
                continue

            body = response.json() if response.content else {}
            for entry in body.get("results", []):
                keyword = normalize_keyword(entry.get("text", ""))
                if not keyword:
                    continue
                evidence = self._to_evidence(entry)
                variants = [keyword] + [
                    normalize_keyword(item) for item in (entry.get("closeVariants") or [])
                ]
                for variant in variants:
                    if variant in chunk:
                        results[variant] = evidence

        if results and had_error:
            self.last_status = "partial_error"
        elif results:
            self.last_status = "ok"
        elif had_error:
            self.last_status = "error"
        else:
            self.last_status = "empty"
        return results


class GoogleAutocompleteProvider(BaseProvider):
    source = "autocomplete"

    def _fetch_one(self, keyword: str, hl: str) -> SourceEvidence | None:
        url = "https://suggestqueries.google.com/complete/search"
        response = requests.get(
            url,
            params={"client": "firefox", "hl": hl, "q": keyword},
            headers={"User-Agent": GOOGLE_TRENDS_UA},
            timeout=self.settings.http_timeout_sec,
        )
        if not response.ok:
            return None
        data = response.json()
        suggestions = data[1] if isinstance(data, list) and len(data) > 1 else []
        normalized = _dedupe_keep_order([str(item) for item in suggestions])
        signal = min(0.9, 0.35 + (len(normalized) / 12))
        return SourceEvidence(
            source=self.source,
            observed_at=_utc_now_iso(),
            autocomplete_suggestions=normalized,
            related_searches=normalized[:8],
            confidence_signal=round(signal, 3),
        )

    def fetch(
        self, keywords: list[str], context: ProviderContext
    ) -> dict[str, SourceEvidence]:
        requested = _dedupe_keep_order(keywords)
        if not requested:
            self.last_status = "skipped_empty"
            return {}

        hl = HL_BY_LANGUAGE.get(context.language, "en-US")
        results: dict[str, SourceEvidence] = {}
        errors = 0
        max_workers = min(self.settings.provider_max_workers, len(requested))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(self._fetch_one, keyword, hl): keyword
                for keyword in requested
            }
            for future in as_completed(futures):
                keyword = futures[future]
                try:
                    evidence = future.result()
                except Exception:
                    errors += 1
                    continue
                if evidence:
                    results[keyword] = evidence
                else:
                    errors += 1

        if results and errors:
            self.last_status = "partial_error"
        elif results:
            self.last_status = "ok"
        elif errors:
            self.last_status = "error"
        else:
            self.last_status = "empty"
        return results


class GoogleTrendsUnofficialProvider(BaseProvider):
    source = "trends-unofficial"

    def __init__(self, settings: ProviderSettings) -> None:
        super().__init__(settings)
        self._cache: dict[str, tuple[float, dict]] = {}
        self._last_request_at = 0.0
        self._blocked_until = 0.0

    def _strip_xssi(self, text: str) -> str:
        return str(text or "").replace(")]}',", "", 1).strip()

    def _request_trends(self, path: str, params: dict) -> dict:
        now = time.time()
        cache_key = f"{path}:{json.dumps(params, sort_keys=True)}"
        cached = self._cache.get(cache_key)
        if cached and cached[0] > now:
            return cached[1]

        if now < self._blocked_until:
            raise RuntimeError("rate_limited")

        min_interval = 0.5
        wait = max(0.0, min_interval - (now - self._last_request_at))
        if wait:
            time.sleep(wait)
        self._last_request_at = time.time()

        response = requests.get(
            f"{GOOGLE_TRENDS_API}/{path}",
            params=params,
            headers={
                "User-Agent": GOOGLE_TRENDS_UA,
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=self.settings.http_timeout_sec,
        )
        if response.status_code == 429:
            self._blocked_until = time.time() + 600
            raise RuntimeError("rate_limited")
        if not response.ok:
            raise RuntimeError(f"http_{response.status_code}")

        payload = json.loads(self._strip_xssi(response.text))
        self._cache[cache_key] = (time.time() + 2 * 60 * 60, payload)
        return payload

    def _pick_widget(self, explore: dict, widget_type: str) -> dict | None:
        for widget in explore.get("widgets", []):
            if widget.get("type") == widget_type:
                return widget
        return None

    def _extract_related_queries(self, payload: dict) -> list[str]:
        candidates: list[str] = []
        for ranked in payload.get("default", {}).get("rankedList", []):
            for item in ranked.get("rankedKeyword", []):
                value = normalize_keyword(item.get("query", ""))
                if value:
                    candidates.append(value)
        return _dedupe_keep_order(candidates)[:10]

    def _extract_geo_breakdown(self, payload: dict) -> dict[str, int]:
        items = payload.get("default", {}).get("geoMapData", [])
        results: dict[str, int] = {}
        for item in items:
            name = str(item.get("geoName", "")).strip()
            values = item.get("value") or []
            if not name or not values:
                continue
            number = int(values[0]) if str(values[0]).isdigit() else int(float(values[0]))
            if number > 0:
                results[name] = number
            if len(results) >= 8:
                break
        return results

    def _fetch_keyword(
        self, keyword: str, hl: str, geo: str
    ) -> SourceEvidence | None:
        request_obj = {
            "comparisonItem": [{"keyword": keyword, "geo": geo, "time": "today 12-m"}],
            "category": 0,
            "property": "",
        }
        explore = self._request_trends(
            "explore", {"hl": hl, "tz": 0, "req": json.dumps(request_obj)}
        )
        timeseries_widget = self._pick_widget(explore, "TIMESERIES")
        if not timeseries_widget:
            return None

        timeseries = self._request_trends(
            "widgetdata/multiline",
            {
                "hl": hl,
                "tz": 0,
                "req": json.dumps(timeseries_widget.get("request", {})),
                "token": timeseries_widget.get("token", ""),
            },
        )
        values: list[int] = []
        for item in timeseries.get("default", {}).get("timelineData", []):
            raw_values = item.get("value") or []
            if not raw_values:
                continue
            value = raw_values[0]
            if isinstance(value, (int, float)):
                values.append(int(value))
            elif str(value).isdigit():
                values.append(int(value))

        if not values:
            return None

        trend_score = max(0.0, min(1.0, mean(values) / 100))
        direction = _trend_direction(values)
        coverage = len([value for value in values if value > 0]) / max(len(values), 1)
        confidence_signal = round(min(0.9, 0.45 + coverage * 0.45), 3)

        related_queries: list[str] = []
        related_widget = self._pick_widget(explore, "RELATED_QUERIES")
        if related_widget:
            try:
                related_payload = self._request_trends(
                    "widgetdata/relatedsearches",
                    {
                        "hl": hl,
                        "tz": 0,
                        "req": json.dumps(related_widget.get("request", {})),
                        "token": related_widget.get("token", ""),
                    },
                )
                related_queries = self._extract_related_queries(related_payload)
            except Exception:
                related_queries = []

        geo_breakdown: dict[str, int] = {}
        geo_widget = self._pick_widget(explore, "GEO_MAP")
        if geo_widget:
            try:
                geo_payload = self._request_trends(
                    "widgetdata/comparedgeo",
                    {
                        "hl": hl,
                        "tz": 0,
                        "req": json.dumps(geo_widget.get("request", {})),
                        "token": geo_widget.get("token", ""),
                    },
                )
                geo_breakdown = self._extract_geo_breakdown(geo_payload)
            except Exception:
                geo_breakdown = {}

        return SourceEvidence(
            source=self.source,
            observed_at=_utc_now_iso(),
            trend_direction=direction,
            trend_score=round(trend_score, 3),
            related_searches=related_queries,
            geo_breakdown=geo_breakdown,
            confidence_signal=confidence_signal,
            raw={"timeseries": values},
        )

    def fetch(
        self, keywords: list[str], context: ProviderContext
    ) -> dict[str, SourceEvidence]:
        requested = _dedupe_keep_order(keywords)
        if not requested:
            self.last_status = "skipped_empty"
            return {}

        hl = HL_BY_LANGUAGE.get(context.language, "en-US")
        geo = context.market.upper()
        results: dict[str, SourceEvidence] = {}
        errors = 0
        rate_limited = False
        for keyword in requested:
            try:
                evidence = self._fetch_keyword(keyword, hl=hl, geo=geo)
            except RuntimeError as exc:
                if "rate_limited" in str(exc):
                    rate_limited = True
                    break
                errors += 1
                continue
            except Exception:
                errors += 1
                continue
            if evidence:
                results[keyword] = evidence
            else:
                errors += 1

        if rate_limited and results:
            self.last_status = "partial_rate_limited"
        elif rate_limited:
            self.last_status = "rate_limited"
        elif results and errors:
            self.last_status = "partial_error"
        elif results:
            self.last_status = "ok"
        elif errors:
            self.last_status = "error"
        else:
            self.last_status = "empty"
        return results


class CustomSerpProvider(BaseProvider):
    source = "custom-serp"

    def _auth_header(self) -> dict[str, str]:
        header_name = self.settings.serp_auth_header or "Authorization"
        if header_name.lower() == "authorization":
            if self.settings.serp_auth_scheme:
                value = f"{self.settings.serp_auth_scheme} {self.settings.serp_api_key}".strip()
            else:
                value = self.settings.serp_api_key
        else:
            value = self.settings.serp_api_key
        return {header_name: value}

    def _extract_domains(self, payload: dict) -> list[str]:
        candidates: list[str] = []
        for key in ("organic_results", "organic", "results"):
            entries = payload.get(key)
            if isinstance(entries, list):
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    domain = str(entry.get("domain", "")).strip().lower()
                    if not domain:
                        link = entry.get("link") or entry.get("url")
                        if isinstance(link, str):
                            domain = (urlparse(link).hostname or "").lower()
                    if domain:
                        candidates.append(domain)
        return _dedupe_keep_order(candidates)[:10]

    def _extract_landing_pages(self, payload: dict) -> list[str]:
        pages: list[str] = []
        for key in ("organic_results", "organic", "results"):
            entries = payload.get(key)
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                link = entry.get("link") or entry.get("url")
                if isinstance(link, str):
                    cleaned = link.strip()
                    if cleaned.startswith("http"):
                        pages.append(cleaned)
        return _dedupe_keep_order(pages)[:20]

    def _extract_ad_copies(self, payload: dict) -> list[dict[str, str]]:
        entries: list[dict[str, str]] = []
        for key in ("ads", "top_ads", "bottom_ads", "paid_results"):
            value = payload.get(key)
            if not isinstance(value, list):
                continue
            for item in value:
                if not isinstance(item, dict):
                    continue
                headline = str(
                    item.get("headline")
                    or item.get("title")
                    or item.get("name")
                    or ""
                ).strip()
                description = str(
                    item.get("description")
                    or item.get("snippet")
                    or item.get("text")
                    or ""
                ).strip()
                landing_page = str(item.get("link") or item.get("url") or "").strip()
                domain = str(item.get("domain") or "").strip().lower()
                if not domain and landing_page:
                    domain = (urlparse(landing_page).hostname or "").lower()
                if not headline and not description:
                    continue
                entries.append(
                    {
                        "headline": headline,
                        "description": description,
                        "landing_page": landing_page,
                        "domain": domain,
                    }
                )
        return entries[:25]

    def _extract_text_list(self, payload: dict, keys: tuple[str, ...]) -> list[str]:
        out: list[str] = []
        for key in keys:
            value = payload.get(key)
            if not value:
                continue
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        candidate = normalize_keyword(item)
                    elif isinstance(item, dict):
                        candidate = normalize_keyword(
                            item.get("question")
                            or item.get("query")
                            or item.get("title")
                            or item.get("text")
                            or ""
                        )
                    else:
                        candidate = ""
                    if candidate:
                        out.append(candidate)
        return _dedupe_keep_order(out)

    def _extract_ads_count(self, payload: dict) -> int | None:
        if isinstance(payload.get("ads_count"), int):
            return int(payload["ads_count"])
        count = 0
        for key in ("ads", "top_ads", "bottom_ads", "paid_results"):
            value = payload.get(key)
            if isinstance(value, list):
                count += len(value)
        return count if count > 0 else None

    def _fetch_one(
        self, keyword: str, context: ProviderContext
    ) -> SourceEvidence | None:
        payload: dict | None = None

        if self.settings.serp_ready:
            path = self.settings.serp_search_path
            if not path.startswith("/"):
                path = f"/{path}"
            url = f"{self.settings.serp_base_url}{path}"
            headers = {"Accept": "application/json", **self._auth_header()}
            response = requests.get(
                url,
                params={
                    "q": keyword,
                    "hl": HL_BY_LANGUAGE.get(context.language, "en-US"),
                    "gl": context.market.lower(),
                    "num": 10,
                },
                headers=headers,
                timeout=self.settings.http_timeout_sec,
            )
            if not response.ok:
                return None
            payload = response.json()
        elif self.settings.serp_internal_enabled:
            payload = search_serp(
                query=keyword,
                hl=HL_BY_LANGUAGE.get(context.language, "en-US"),
                gl=context.market.lower(),
                num=10,
                settings=self.settings,
            )
        else:
            return None

        paa = self._extract_text_list(payload, ("people_also_ask", "peopleAlsoAsk", "related_questions"))
        related = self._extract_text_list(payload, ("related_searches", "relatedSearches"))
        ads_count = self._extract_ads_count(payload)
        domains = self._extract_domains(payload)
        landing_pages = self._extract_landing_pages(payload)
        ad_copies = self._extract_ad_copies(payload)

        is_usable = bool(
            paa
            or related
            or domains
            or ad_copies
            or (ads_count is not None and ads_count > 0)
        )
        if not is_usable:
            return None

        signal = 0.2
        if paa:
            signal += 0.15
        if related:
            signal += 0.15
        if ads_count is not None:
            signal += 0.15
        if domains:
            signal += 0.15
        if ad_copies:
            signal += 0.1
        signal = round(min(0.9, signal), 3)

        return SourceEvidence(
            source=self.source,
            observed_at=_utc_now_iso(),
            people_also_ask=paa,
            related_searches=related,
            ads_count=ads_count,
            competitor_domains=domains,
            competitor_landing_pages=landing_pages,
            ad_copies=ad_copies,
            confidence_signal=signal,
            raw={"source": payload.get("source", "")},
        )

    def fetch(
        self, keywords: list[str], context: ProviderContext
    ) -> dict[str, SourceEvidence]:
        if not self.settings.serp_available:
            self.last_status = "not_configured"
            return {}

        requested = _dedupe_keep_order(keywords)
        if not requested:
            self.last_status = "skipped_empty"
            return {}

        results: dict[str, SourceEvidence] = {}
        errors = 0
        max_workers = min(self.settings.provider_max_workers, len(requested))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(self._fetch_one, keyword, context): keyword
                for keyword in requested
            }
            for future in as_completed(futures):
                keyword = futures[future]
                try:
                    evidence = future.result()
                except Exception:
                    errors += 1
                    continue
                if evidence:
                    results[keyword] = evidence
                else:
                    errors += 1

        if results and errors:
            self.last_status = "partial_error"
        elif results:
            self.last_status = "ok"
        elif errors:
            self.last_status = "error"
        else:
            self.last_status = "empty"
        return results


def collect_keyword_evidence(
    *,
    all_keywords: list[str],
    prioritized_keywords: list[str],
    context: ProviderContext,
    settings: ProviderSettings,
) -> tuple[dict[str, dict[str, SourceEvidence]], dict[str, str]]:
    normalized_all = _dedupe_keep_order(all_keywords)
    normalized_priority = _dedupe_keep_order(prioritized_keywords)
    scope_keywords = normalized_priority[: settings.provider_scope_limit]
    serp_scope = scope_keywords[: settings.serp_keyword_limit]
    trend_scope = scope_keywords[: settings.trends_keyword_limit]

    evidence_map: dict[str, dict[str, SourceEvidence]] = {
        keyword: {} for keyword in normalized_all
    }
    source_status: dict[str, str] = {}

    providers: list[tuple[BaseProvider, list[str]]] = [
        (GoogleKeywordPlannerProvider(settings), normalized_all),
        (GoogleAutocompleteProvider(settings), scope_keywords),
        (GoogleTrendsUnofficialProvider(settings), trend_scope),
        (CustomSerpProvider(settings), serp_scope),
    ]

    for provider, provider_keywords in providers:
        if not provider_keywords:
            source_status[provider.source] = "skipped_empty"
            continue
        provider_results = provider.fetch(provider_keywords, context)
        source_status[provider.source] = f"{provider.last_status}:{len(provider_results)}"
        for keyword, evidence in provider_results.items():
            key = normalize_keyword(keyword)
            if key in evidence_map:
                evidence_map[key][provider.source] = evidence

    return evidence_map, source_status
