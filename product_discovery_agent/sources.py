"""External data source adapters and payload parsers."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import html
import http.cookiejar
import json
import re
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote_plus, urlencode, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener
import xml.etree.ElementTree as ET

from .constants import ALLOWED_SOURCE_HOSTS, DEFAULT_TARGET_API_KEY_FALLBACK

Fetcher = Callable[[str, dict[str, str] | None], str]

_GOOGLE_SUGGEST_URL = "https://suggestqueries.google.com/complete/search"
_AMAZON_SUGGEST_URL = "https://completion.amazon.com/api/2017/suggestions"
_GOOGLE_TRENDS_RSS_URL = "https://trends.google.com/trending/rss"
_GOOGLE_TRENDS_EXPLORE_PAGE_URL = "https://trends.google.com/trends/explore"
_GOOGLE_TRENDS_EXPLORE_API_URL = "https://trends.google.com/trends/api/explore"
_GOOGLE_TRENDS_MULTILINE_API_URL = "https://trends.google.com/trends/api/widgetdata/multiline"
_AMAZON_SEARCH_URL = "https://www.amazon.com/s"
_WALMART_SEARCH_URL = "https://www.walmart.com/search"
_TARGET_SEARCH_URL = "https://www.target.com/s"
_TARGET_REDSKY_SEARCH_URL = "https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2"

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
_COMPACT_TRAFFIC_RE = re.compile(r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMB]?)", re.IGNORECASE)
_COUNT_PATTERNS = (
    re.compile(r"of (?:over )?([0-9,]+) results for", re.IGNORECASE),
    re.compile(r"over\s+([0-9,]+)\s+results", re.IGNORECASE),
    re.compile(r"([0-9,]+)\s+results for", re.IGNORECASE),
)
_AMAZON_TITLE_PATTERNS = (
    re.compile(r'data-cy="title-recipe"[^>]*>(.*?)</span>', re.IGNORECASE | re.DOTALL),
    re.compile(r'<h2[^>]*>\s*<a[^>]*>\s*<span[^>]*>(.*?)</span>', re.IGNORECASE | re.DOTALL),
)
_TARGET_API_KEY_RE = re.compile(r'"apiKey":"([a-f0-9]{40})"')
_TITLE_BLOCKLIST = {
    "sponsored",
    "shop now",
    "ad",
}


@dataclass(slots=True)
class TrendRecord:
    query: str
    rank: int
    approx_traffic: str
    approx_traffic_estimate: int


@dataclass(slots=True)
class MarketplaceScanResult:
    source_url: str
    total_results_estimate: int | None
    sample_products: list[str]


def build_fetcher(timeout_seconds: int, user_agent: str) -> Fetcher:
    """Build a reusable HTTP fetcher configured with timeout and user agent."""
    cookie_jar = http.cookiejar.CookieJar()
    opener = build_opener(HTTPCookieProcessor(cookie_jar))

    def _fetch(url: str, headers: dict[str, str] | None = None) -> str:
        _assert_allowed_host(url)
        request_headers = {
            "User-Agent": user_agent,
            "Accept-Language": "en-US,en;q=0.8",
        }
        if headers:
            request_headers.update(headers)
        request = Request(url, headers=request_headers)
        try:
            with opener.open(request, timeout=timeout_seconds) as response:
                return response.read().decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError) as exc:
            raise RuntimeError(f"Failed to fetch URL: {url}") from exc

    return _fetch


def fetch_google_suggestions(
    *,
    keyword: str,
    language: str,
    max_items: int,
    fetcher: Fetcher,
) -> list[str]:
    encoded_keyword = quote_plus(keyword)
    encoded_language = quote_plus(language)
    url = f"{_GOOGLE_SUGGEST_URL}?client=firefox&q={encoded_keyword}&hl={encoded_language}"
    payload = fetcher(url, {"Accept": "application/json"})
    return parse_google_suggest_payload(payload=payload, max_items=max_items)


def fetch_amazon_suggestions(
    *,
    keyword: str,
    max_items: int,
    fetcher: Fetcher,
) -> list[str]:
    encoded_keyword = quote_plus(keyword)
    url = (
        f"{_AMAZON_SUGGEST_URL}"
        f"?limit={max_items}&prefix={encoded_keyword}"
        "&alias=aps&mid=ATVPDKIKX0DER&plain-mid=1&client-info=search-ui"
    )
    payload = fetcher(url, {"Accept": "application/json"})
    return parse_amazon_suggest_payload(payload=payload, max_items=max_items)


def fetch_google_trends_rss(
    *,
    geo: str,
    max_items: int,
    fetcher: Fetcher,
) -> list[TrendRecord]:
    encoded_geo = quote_plus(geo)
    url = f"{_GOOGLE_TRENDS_RSS_URL}?geo={encoded_geo}"
    payload = fetcher(url, {"Accept": "application/rss+xml, application/xml"})
    return parse_google_trends_rss(payload=payload, max_items=max_items)


def fetch_google_trends_timeseries(
    *,
    keyword: str,
    geo: str,
    language: str,
    time_window: str,
    fetcher: Fetcher,
) -> list[int]:
    encoded_geo = quote_plus(geo)
    encoded_language = quote_plus(language)
    explore_page_url = f"{_GOOGLE_TRENDS_EXPLORE_PAGE_URL}?geo={encoded_geo}"

    # Prime session cookies before API calls to reduce 429 responses.
    fetcher(explore_page_url, {"Accept": "text/html"})

    request_payload = {
        "comparisonItem": [
            {"keyword": keyword, "geo": geo, "time": time_window}
        ],
        "category": 0,
        "property": "",
    }
    encoded_request = quote_plus(json.dumps(request_payload, separators=(",", ":")))
    explore_api_url = (
        f"{_GOOGLE_TRENDS_EXPLORE_API_URL}"
        f"?hl={encoded_language}&tz=0&req={encoded_request}"
    )
    explore_raw = fetcher(
        explore_api_url,
        {
            "Accept": "application/json,text/plain,*/*",
            "Referer": explore_page_url,
        },
    )
    token, widget_request = parse_google_trends_explore_payload(explore_raw)

    encoded_widget_request = quote_plus(json.dumps(widget_request, separators=(",", ":")))
    encoded_token = quote_plus(token)
    multiline_url = (
        f"{_GOOGLE_TRENDS_MULTILINE_API_URL}"
        f"?hl={encoded_language}&tz=0&token={encoded_token}&req={encoded_widget_request}"
    )
    multiline_raw = fetcher(
        multiline_url,
        {
            "Accept": "application/json,text/plain,*/*",
            "Referer": explore_page_url,
        },
    )
    return parse_google_trends_multiline_payload(multiline_raw)


def scan_amazon_marketplace(
    *,
    keyword: str,
    max_sample_products: int,
    fetcher: Fetcher,
) -> MarketplaceScanResult:
    encoded_keyword = quote_plus(keyword)
    url = f"{_AMAZON_SEARCH_URL}?k={encoded_keyword}"
    payload = fetcher(url, {"Accept": "text/html"})
    total_results, sample_products = parse_amazon_search_html(
        payload=payload,
        max_sample_products=max_sample_products,
    )
    return MarketplaceScanResult(
        source_url=url,
        total_results_estimate=total_results,
        sample_products=sample_products,
    )


def scan_walmart_marketplace(
    *,
    keyword: str,
    max_sample_products: int,
    fetcher: Fetcher,
) -> MarketplaceScanResult:
    encoded_keyword = quote_plus(keyword)
    url = f"{_WALMART_SEARCH_URL}?q={encoded_keyword}"
    payload = fetcher(url, {"Accept": "text/html"})
    total_results, sample_products = parse_walmart_search_html(
        payload=payload,
        max_sample_products=max_sample_products,
    )
    return MarketplaceScanResult(
        source_url=url,
        total_results_estimate=total_results,
        sample_products=sample_products,
    )


def scan_target_marketplace(
    *,
    keyword: str,
    max_sample_products: int,
    pricing_store_id: str,
    fetcher: Fetcher,
) -> MarketplaceScanResult:
    encoded_keyword = quote_plus(keyword)
    search_url = f"{_TARGET_SEARCH_URL}?searchTerm={encoded_keyword}"
    page_payload = fetcher(search_url, {"Accept": "text/html"})
    api_key = parse_target_api_key_from_html(page_payload)
    visitor_id = _build_target_visitor_id(keyword)
    page_path = f"/s/{encoded_keyword}"

    query_params = {
        "key": api_key,
        "keyword": keyword,
        "channel": "WEB",
        "count": "24",
        "offset": "0",
        "page": page_path,
        "pricing_store_id": pricing_store_id,
        "visitor_id": visitor_id,
    }
    api_url = f"{_TARGET_REDSKY_SEARCH_URL}?{urlencode(query_params)}"
    api_payload = fetcher(
        api_url,
        {
            "Accept": "application/json",
            "Referer": search_url,
        },
    )
    total_results, sample_products = parse_target_search_json(
        payload=api_payload,
        max_sample_products=max_sample_products,
    )
    return MarketplaceScanResult(
        source_url=api_url,
        total_results_estimate=total_results,
        sample_products=sample_products,
    )


def parse_google_suggest_payload(*, payload: str, max_items: int) -> list[str]:
    data = json.loads(payload)
    if not isinstance(data, list) or len(data) < 2 or not isinstance(data[1], list):
        return []
    suggestions = [str(item) for item in data[1] if isinstance(item, str)]
    return _dedupe_phrases(suggestions, max_items=max_items)


def parse_amazon_suggest_payload(*, payload: str, max_items: int) -> list[str]:
    data = json.loads(payload)
    raw_items = data.get("suggestions", []) if isinstance(data, dict) else []
    suggestions: list[str] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        value = item.get("value")
        if isinstance(value, str):
            suggestions.append(value)
    return _dedupe_phrases(suggestions, max_items=max_items)


def parse_google_trends_rss(*, payload: str, max_items: int) -> list[TrendRecord]:
    if not payload.strip():
        return []

    namespace = {"ht": "https://trends.google.com/trends/hottrends"}
    root = ET.fromstring(payload)
    items = root.findall("./channel/item")

    trend_records: list[TrendRecord] = []
    for rank, item in enumerate(items, start=1):
        raw_query = item.findtext("title", default="").strip()
        query = _normalize_phrase(raw_query)
        if not query:
            continue
        approx_traffic = item.findtext("ht:approx_traffic", default="", namespaces=namespace).strip()
        trend_records.append(
            TrendRecord(
                query=query,
                rank=rank,
                approx_traffic=approx_traffic,
                approx_traffic_estimate=parse_compact_traffic(approx_traffic),
            )
        )
        if len(trend_records) >= max_items:
            break

    return trend_records


def parse_google_trends_explore_payload(payload: str) -> tuple[str, dict[str, object]]:
    parsed = json.loads(_strip_google_json_prefix(payload))
    widgets = parsed.get("widgets", []) if isinstance(parsed, dict) else []
    for widget in widgets:
        if not isinstance(widget, dict):
            continue
        if widget.get("id") != "TIMESERIES":
            continue
        token = widget.get("token")
        request_payload = widget.get("request")
        if isinstance(token, str) and isinstance(request_payload, dict):
            return token, request_payload
    raise ValueError("Google Trends explore payload missing TIMESERIES widget.")


def parse_google_trends_multiline_payload(payload: str) -> list[int]:
    parsed = json.loads(_strip_google_json_prefix(payload))
    default = parsed.get("default", {}) if isinstance(parsed, dict) else {}
    timeline_data = default.get("timelineData", []) if isinstance(default, dict) else []

    values: list[int] = []
    for item in timeline_data:
        if not isinstance(item, dict):
            continue
        raw_values = item.get("value")
        if not isinstance(raw_values, list) or not raw_values:
            continue
        first = raw_values[0]
        coerced = _coerce_int(first)
        if coerced is not None:
            values.append(coerced)
    return values


def parse_amazon_search_html(
    *,
    payload: str,
    max_sample_products: int,
) -> tuple[int | None, list[str]]:
    total_results = _extract_count(payload)
    titles: list[str] = []
    for pattern in _AMAZON_TITLE_PATTERNS:
        for raw_title in pattern.findall(payload):
            title = _normalize_phrase(_strip_html(raw_title))
            if title and _is_valid_product_title(title) and title not in titles:
                titles.append(title)
            if len(titles) >= max_sample_products:
                return total_results, titles
    return total_results, titles


def parse_walmart_search_html(
    *,
    payload: str,
    max_sample_products: int,
) -> tuple[int | None, list[str]]:
    script_start = payload.find('<script id="__NEXT_DATA__"')
    if script_start < 0:
        raise ValueError("Walmart search payload missing __NEXT_DATA__ script.")

    data_start = payload.find(">", script_start)
    if data_start < 0:
        raise ValueError("Walmart __NEXT_DATA__ script opening tag is malformed.")

    data_end = payload.find("</script>", data_start + 1)
    if data_end < 0:
        raise ValueError("Walmart __NEXT_DATA__ script closing tag is missing.")

    raw_json = payload[data_start + 1 : data_end]
    parsed = json.loads(raw_json)
    search_result = (
        parsed.get("props", {})
        .get("pageProps", {})
        .get("initialData", {})
        .get("searchResult", {})
    )
    if not isinstance(search_result, dict):
        raise ValueError("Walmart search payload missing structured searchResult data.")

    total_results = _coerce_int(search_result.get("aggregatedCount"))
    if total_results is None:
        total_results = _coerce_int(search_result.get("count"))

    titles: list[str] = []
    stacks = search_result.get("itemStacks", [])
    if isinstance(stacks, list):
        for stack in stacks:
            if not isinstance(stack, dict):
                continue
            for item in stack.get("items", []):
                if not isinstance(item, dict):
                    continue
                raw_title = item.get("title") or item.get("name")
                if not isinstance(raw_title, str):
                    continue
                title = _normalize_phrase(raw_title)
                if title and _is_valid_product_title(title) and title not in titles:
                    titles.append(title)
                if len(titles) >= max_sample_products:
                    return total_results, titles

    return total_results, titles


def parse_target_api_key_from_html(
    payload: str,
    *,
    fallback_api_key: str = DEFAULT_TARGET_API_KEY_FALLBACK,
) -> str:
    match = _TARGET_API_KEY_RE.search(payload)
    if not match:
        if fallback_api_key:
            return fallback_api_key
        raise ValueError("Target page payload missing API key.")
    return match.group(1)


def parse_target_search_json(
    *,
    payload: str,
    max_sample_products: int,
) -> tuple[int | None, list[str]]:
    parsed = json.loads(payload)
    errors = parsed.get("errors", []) if isinstance(parsed, dict) else []
    if errors:
        first_error = errors[0] if isinstance(errors[0], dict) else {"message": str(errors[0])}
        raise ValueError(f"Target API error: {first_error.get('message', 'unknown')}")

    search = parsed.get("data", {}).get("search", {})
    metadata = search.get("search_response", {}).get("metadata", {})
    total_results = _coerce_int(metadata.get("total_results"))

    titles: list[str] = []
    products = search.get("products", [])
    if isinstance(products, list):
        for item in products:
            if not isinstance(item, dict):
                continue
            raw_title = (
                item.get("item", {})
                .get("product_description", {})
                .get("title")
            )
            if not isinstance(raw_title, str):
                continue
            title = _normalize_phrase(raw_title)
            if title and _is_valid_product_title(title) and title not in titles:
                titles.append(title)
            if len(titles) >= max_sample_products:
                break

    return total_results, titles


def parse_compact_traffic(value: str) -> int:
    match = _COMPACT_TRAFFIC_RE.search(value.strip())
    if not match:
        return 0
    amount_raw, suffix_raw = match.groups()
    amount = float(amount_raw.replace(",", ""))
    suffix = suffix_raw.upper()
    multiplier = 1
    if suffix == "K":
        multiplier = 1_000
    elif suffix == "M":
        multiplier = 1_000_000
    elif suffix == "B":
        multiplier = 1_000_000_000
    return int(amount * multiplier)


def _assert_allowed_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Only https URLs are allowed: {url}")
    host = parsed.hostname or ""
    if host not in ALLOWED_SOURCE_HOSTS:
        raise ValueError(f"Host not allowed for product discovery fetches: {host}")


def _build_target_visitor_id(keyword: str) -> str:
    digest = hashlib.md5(keyword.lower().encode("utf-8")).hexdigest()
    return digest.upper()


def _strip_google_json_prefix(payload: str) -> str:
    if payload.startswith(")]}'"):
        parts = payload.split("\n", 1)
        if len(parts) == 2:
            return parts[1]
    return payload


def _extract_count(payload: str) -> int | None:
    for pattern in _COUNT_PATTERNS:
        match = pattern.search(payload)
        if match:
            return _coerce_int(match.group(1))
    return None


def _coerce_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        digits = re.sub(r"[^0-9]", "", value)
        if digits:
            return int(digits)
    return None


def _strip_html(value: str) -> str:
    return _HTML_TAG_RE.sub(" ", value)


def _dedupe_phrases(phrases: list[str], *, max_items: int) -> list[str]:
    deduped: list[str] = []
    for phrase in phrases:
        normalized = _normalize_phrase(phrase)
        if not normalized or normalized in deduped:
            continue
        deduped.append(normalized)
        if len(deduped) >= max_items:
            break
    return deduped


def _normalize_phrase(value: str) -> str:
    unescaped = html.unescape(value)
    collapsed = _WHITESPACE_RE.sub(" ", unescaped)
    return collapsed.strip()


def _is_valid_product_title(value: str) -> bool:
    normalized = value.strip().lower()
    if not normalized:
        return False
    if normalized in _TITLE_BLOCKLIST:
        return False
    if normalized.startswith("sponsored"):
        return False
    if "results for" in normalized:
        return False
    return len(normalized) >= 8
