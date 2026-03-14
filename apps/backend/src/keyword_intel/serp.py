from __future__ import annotations
import random
import re
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import parse_qs, unquote, urlparse

import requests
from bs4 import BeautifulSoup

from .settings import ProviderSettings, load_settings


DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

SPONSORED_TOKENS = (
    "sponsored",
    "annonce",
    "anzeige",
    "patrocinado",
    "إعلان",
)

QUESTION_MARKS = ("?", "؟")

GOOGLE_HOST_BLOCKLIST = {
    "google.com",
    "www.google.com",
    "webcache.googleusercontent.com",
}


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _normalize_text(value: str) -> str:
    return " ".join(str(value or "").strip().split())


def _normalize_domain(url: str) -> str:
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    domain = (parsed.hostname or "").strip().lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def _looks_like_question(text: str) -> bool:
    cleaned = _normalize_text(text)
    if len(cleaned) < 12 or len(cleaned) > 130:
        return False
    return any(mark in cleaned for mark in QUESTION_MARKS)


def _decode_google_redirect(url: str) -> str:
    if not url.startswith("/url?"):
        return url
    query = parse_qs(urlparse(url).query)
    target = query.get("q", [""])[0]
    return unquote(target) if target else ""


def _dedupe_keep_order(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = _normalize_text(value)
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        output.append(normalized)
    return output


def parse_google_serp_html(
    *,
    html: str,
    query: str,
    fetched_url: str,
    gl: str,
    hl: str,
) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    organic_results: list[dict] = []
    seen_links: set[str] = set()

    primary_candidates = []
    primary_candidates.extend(soup.select("div.yuRUbf > a[href]"))
    primary_candidates.extend(soup.select("a[href]"))
    for anchor in primary_candidates:
        href = str(anchor.get("href", "")).strip()
        if not href:
            continue

        decoded = _decode_google_redirect(href)
        if not decoded.startswith("http"):
            continue

        domain = _normalize_domain(decoded)
        if not domain or domain in GOOGLE_HOST_BLOCKLIST:
            continue
        if decoded in seen_links:
            continue
        seen_links.add(decoded)

        title_node = anchor.find("h3")
        if title_node is None:
            parent = anchor.parent
            if parent is not None:
                title_node = parent.find("h3")
        title = _normalize_text(title_node.get_text(" ", strip=True) if title_node else "")
        if not title:
            continue

        snippet = ""
        parent = anchor.parent
        if parent is not None:
            snippet_candidates = parent.find_all("span")
            for candidate in snippet_candidates:
                text = _normalize_text(candidate.get_text(" ", strip=True))
                if len(text) >= 30 and text != title:
                    snippet = text
                    break

        organic_results.append(
            {
                "title": title,
                "link": decoded,
                "domain": domain,
                "snippet": snippet,
            }
        )
        if len(organic_results) >= 10:
            break

    if not organic_results:
        for anchor in soup.select("a[href^='http']"):
            href = str(anchor.get("href", "")).strip()
            domain = _normalize_domain(href)
            if not domain or domain in GOOGLE_HOST_BLOCKLIST:
                continue
            if href in seen_links:
                continue
            title = _normalize_text(anchor.get_text(" ", strip=True))
            if len(title) < 10:
                continue
            seen_links.add(href)
            organic_results.append(
                {
                    "title": title[:140],
                    "link": href,
                    "domain": domain,
                    "snippet": "",
                }
            )
            if len(organic_results) >= 10:
                break

    related_candidates: list[str] = []
    for anchor in soup.select("a[href*='/search?']"):
        text = _normalize_text(anchor.get_text(" ", strip=True))
        if len(text) < 4 or len(text) > 90:
            continue
        lower = text.lower()
        if lower in {"images", "videos", "maps", "shopping", "news"}:
            continue
        related_candidates.append(text)

    paa_candidates: list[str] = []
    for tag in soup.find_all(["div", "span", "h3", "button"]):
        text = _normalize_text(tag.get_text(" ", strip=True))
        if _looks_like_question(text):
            paa_candidates.append(text)

    text_blob = _normalize_text(soup.get_text(" ", strip=True)).lower()
    ads_count = 0
    for token in SPONSORED_TOKENS:
        ads_count += len(re.findall(rf"\b{re.escape(token)}\b", text_blob))
    ads_count = min(20, ads_count) if ads_count > 0 else 0

    people_also_ask = _dedupe_keep_order(paa_candidates)[:12]
    related_searches = _dedupe_keep_order(related_candidates)[:12]
    competitor_domains = _dedupe_keep_order(
        [result["domain"] for result in organic_results]
    )[:12]

    return {
        "query": query,
        "source": "google-html",
        "fetched_at": _utc_now_iso(),
        "fetched_url": fetched_url,
        "gl": gl,
        "hl": hl,
        "people_also_ask": people_also_ask,
        "related_searches": related_searches,
        "ads_count": ads_count,
        "organic_results": organic_results,
        "competitor_domains": competitor_domains,
        "status": "ok",
    }


def _from_serpapi_payload(payload: dict, query: str, gl: str, hl: str) -> dict:
    people_also_ask = [
        _normalize_text(item.get("question", ""))
        for item in payload.get("related_questions", [])
        if isinstance(item, dict)
    ]
    related_searches = [
        _normalize_text(item.get("query", ""))
        for item in payload.get("related_searches", [])
        if isinstance(item, dict)
    ]
    organic_results = []
    for item in payload.get("organic_results", []):
        if not isinstance(item, dict):
            continue
        link = str(item.get("link") or "").strip()
        domain = _normalize_domain(link)
        if not link or not domain:
            continue
        organic_results.append(
            {
                "title": _normalize_text(item.get("title", "")),
                "link": link,
                "domain": domain,
                "snippet": _normalize_text(item.get("snippet", "")),
            }
        )
    ads_count = 0
    for key in ("ads", "top_ads", "bottom_ads"):
        value = payload.get(key)
        if isinstance(value, list):
            ads_count += len(value)
    return {
        "query": query,
        "source": "serpapi-fallback",
        "fetched_at": _utc_now_iso(),
        "fetched_url": "",
        "gl": gl,
        "hl": hl,
        "people_also_ask": _dedupe_keep_order(people_also_ask)[:12],
        "related_searches": _dedupe_keep_order(related_searches)[:12],
        "ads_count": ads_count,
        "organic_results": organic_results[:10],
        "competitor_domains": _dedupe_keep_order(
            [item["domain"] for item in organic_results]
        )[:12],
        "status": "ok",
    }


def _from_searxng_payload(payload: dict, query: str, gl: str, hl: str) -> dict:
    organic_results = []
    for item in payload.get("results", []):
        if not isinstance(item, dict):
            continue
        link = str(item.get("url") or "").strip()
        if not link:
            continue
        domain = _normalize_domain(link)
        if not domain:
            continue
        organic_results.append(
            {
                "title": _normalize_text(item.get("title", "")),
                "link": link,
                "domain": domain,
                "snippet": _normalize_text(item.get("content", "")),
            }
        )
        if len(organic_results) >= 10:
            break

    related_searches = [
        _normalize_text(item)
        for item in payload.get("suggestions", [])
        if isinstance(item, str)
    ]
    return {
        "query": query,
        "source": "searxng-fallback",
        "fetched_at": _utc_now_iso(),
        "fetched_url": "",
        "gl": gl,
        "hl": hl,
        "people_also_ask": [],
        "related_searches": _dedupe_keep_order(related_searches)[:12],
        "ads_count": 0,
        "organic_results": organic_results,
        "competitor_domains": _dedupe_keep_order(
            [item["domain"] for item in organic_results]
        )[:12],
        "status": "ok",
    }


def _is_result_useful(payload: dict) -> bool:
    if payload.get("people_also_ask"):
        return True
    if payload.get("related_searches"):
        return True
    if payload.get("organic_results"):
        return True
    return False


def _from_duckduckgo_html(html: str, query: str, gl: str, hl: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    organic_results: list[dict] = []
    seen_links: set[str] = set()
    for anchor in soup.select("a.result__a[href], a[data-testid='result-title-a'][href]"):
        link = str(anchor.get("href", "")).strip()
        if not link:
            continue
        domain = _normalize_domain(link)
        if not domain or link in seen_links:
            continue
        seen_links.add(link)
        title = _normalize_text(anchor.get_text(" ", strip=True))
        if len(title) < 3:
            continue
        snippet = ""
        parent = anchor.find_parent("div")
        if parent is not None:
            snippet_node = parent.find("a", class_="result__snippet")
            if snippet_node is None:
                snippet_node = parent.find("div", class_="result__snippet")
            if snippet_node is not None:
                snippet = _normalize_text(snippet_node.get_text(" ", strip=True))
        organic_results.append(
            {
                "title": title,
                "link": link,
                "domain": domain,
                "snippet": snippet,
            }
        )
        if len(organic_results) >= 10:
            break

    related = []
    for anchor in soup.select("a[href*='duckduckgo.com/?q=']"):
        text = _normalize_text(anchor.get_text(" ", strip=True))
        if 4 <= len(text) <= 90:
            related.append(text)
    return {
        "query": query,
        "source": "duckduckgo-fallback",
        "fetched_at": _utc_now_iso(),
        "fetched_url": "",
        "gl": gl,
        "hl": hl,
        "people_also_ask": [],
        "related_searches": _dedupe_keep_order(related)[:12],
        "ads_count": 0,
        "organic_results": organic_results,
        "competitor_domains": _dedupe_keep_order(
            [item["domain"] for item in organic_results]
        )[:12],
        "status": "ok",
    }


def _from_bing_html(html: str, query: str, gl: str, hl: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    organic_results: list[dict] = []
    seen_links: set[str] = set()
    for node in soup.select("li.b_algo h2 a[href], .b_algo h2 a[href]"):
        link = str(node.get("href", "")).strip()
        if not link.startswith("http"):
            continue
        domain = _normalize_domain(link)
        if not domain or domain in GOOGLE_HOST_BLOCKLIST or link in seen_links:
            continue
        seen_links.add(link)
        title = _normalize_text(node.get_text(" ", strip=True))
        snippet = ""
        container = node.find_parent("li")
        if container is not None:
            snippet_node = container.select_one(".b_caption p")
            if snippet_node:
                snippet = _normalize_text(snippet_node.get_text(" ", strip=True))
        organic_results.append(
            {
                "title": title[:180],
                "link": link,
                "domain": domain,
                "snippet": snippet[:260],
            }
        )
        if len(organic_results) >= 10:
            break

    related: list[str] = []
    for node in soup.select("a[href*='?q='], .b_rs a, .b_ans a"):
        text = _normalize_text(node.get_text(" ", strip=True))
        if 4 <= len(text) <= 90:
            related.append(text)

    text_blob = _normalize_text(soup.get_text(" ", strip=True)).lower()
    ads_count = 0
    for token in ("ad", "ads", *SPONSORED_TOKENS):
        ads_count += len(re.findall(rf"\b{re.escape(token)}\b", text_blob))
    ads_count = min(20, ads_count) if ads_count > 0 else 0

    return {
        "query": query,
        "source": "bing-fallback",
        "fetched_at": _utc_now_iso(),
        "fetched_url": "",
        "gl": gl,
        "hl": hl,
        "people_also_ask": [],
        "related_searches": _dedupe_keep_order(related)[:12],
        "ads_count": ads_count,
        "organic_results": organic_results,
        "competitor_domains": _dedupe_keep_order(
            [item["domain"] for item in organic_results]
        )[:12],
        "status": "ok",
    }


def _from_jina_duckduckgo_markdown(markdown: str, query: str, gl: str, hl: str) -> dict:
    organic_results: list[dict] = []
    related_searches: list[str] = []
    seen_links: set[str] = set()
    nav_labels = {
        "all",
        "images",
        "shopping",
        "videos",
        "news",
        "maps",
        "duck.ai",
        "more",
    }
    pattern = re.compile(r"\[([^\]]+)\]\((https?://[^\)]+)\)")
    for title, link in pattern.findall(markdown):
        cleaned_title = _normalize_text(title)
        cleaned_link = link.strip()
        if not cleaned_title or not cleaned_link:
            continue
        domain = _normalize_domain(cleaned_link)
        if not domain:
            continue
        lower_title = cleaned_title.lower()
        if domain.endswith("duckduckgo.com"):
            if (
                "q=" in cleaned_link
                and lower_title not in nav_labels
                and 4 <= len(cleaned_title) <= 90
            ):
                related_searches.append(cleaned_title)
            continue
        if cleaned_link in seen_links:
            continue
        seen_links.add(cleaned_link)
        organic_results.append(
            {
                "title": cleaned_title[:180],
                "link": cleaned_link,
                "domain": domain,
                "snippet": "",
            }
        )
        if len(organic_results) >= 10:
            break

    return {
        "query": query,
        "source": "jina-ddg-fallback",
        "fetched_at": _utc_now_iso(),
        "fetched_url": "",
        "gl": gl,
        "hl": hl,
        "people_also_ask": [],
        "related_searches": _dedupe_keep_order(related_searches)[:12],
        "ads_count": 0,
        "organic_results": organic_results,
        "competitor_domains": _dedupe_keep_order(
            [item["domain"] for item in organic_results]
        )[:12],
        "status": "ok",
    }


@dataclass
class _CacheEntry:
    expires_at: float
    payload: dict


class InternalSerpEngine:
    def __init__(self, settings: ProviderSettings) -> None:
        self.settings = settings
        self.session = requests.Session()
        self.cache: dict[str, _CacheEntry] = {}
        self.cache_lock = threading.Lock()
        self.rate_lock = threading.Lock()
        self.last_request_at = 0.0
        self.searxng_backoff: dict[str, float] = {}

    def _rate_limit(self) -> None:
        if self.settings.serp_min_interval_ms <= 0:
            return
        min_interval = self.settings.serp_min_interval_ms / 1000.0
        with self.rate_lock:
            now = time.monotonic()
            wait = min_interval - (now - self.last_request_at)
            if wait > 0:
                time.sleep(wait)
            self.last_request_at = time.monotonic()

    def _cache_get(self, key: str) -> dict | None:
        now = time.time()
        with self.cache_lock:
            entry = self.cache.get(key)
            if entry and entry.expires_at > now:
                return entry.payload
            if entry:
                self.cache.pop(key, None)
        return None

    def _cache_set(self, key: str, payload: dict) -> None:
        with self.cache_lock:
            self.cache[key] = _CacheEntry(
                expires_at=time.time() + self.settings.serp_cache_ttl_sec,
                payload=payload,
            )
            if len(self.cache) > 2000:
                oldest_key = min(
                    self.cache.keys(),
                    key=lambda current: self.cache[current].expires_at,
                )
                self.cache.pop(oldest_key, None)

    def _pick_proxy(self) -> dict | None:
        if not self.settings.serp_proxy_urls:
            return None
        proxy_url = random.choice(self.settings.serp_proxy_urls)
        return {"http": proxy_url, "https": proxy_url}

    def _google_html_search(self, query: str, gl: str, hl: str, num: int) -> dict:
        self._rate_limit()
        response = self.session.get(
            self.settings.serp_google_endpoint,
            params={
                "q": query,
                "hl": hl,
                "gl": gl,
                "num": max(1, min(num, 10)),
                "pws": 0,
                "gbv": 1,
            },
            headers={
                "User-Agent": DEFAULT_UA,
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=self.settings.http_timeout_sec,
            proxies=self._pick_proxy(),
        )
        if not response.ok:
            raise RuntimeError(f"google_http_{response.status_code}")
        text = response.text or ""
        lower_text = text.lower()
        if "unusual traffic" in lower_text or "consent.google.com" in str(response.url).lower():
            raise RuntimeError("google_blocked")
        return parse_google_serp_html(
            html=text,
            query=query,
            fetched_url=str(response.url),
            gl=gl,
            hl=hl,
        )

    def _brightdata_google_search(self, query: str, gl: str, hl: str, num: int) -> dict:
        if not self.settings.brightdata_ready:
            raise RuntimeError("brightdata_not_configured")

        google_url = f"{self.settings.serp_google_endpoint}?q={requests.utils.quote(query)}"
        google_url += (
            f"&hl={requests.utils.quote(hl)}"
            f"&gl={requests.utils.quote(gl)}"
            f"&num={max(1, min(num, 10))}"
            "&pws=0"
        )

        self._rate_limit()
        response = self.session.post(
            self.settings.brightdata_request_url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.settings.brightdata_api_key}",
                "User-Agent": DEFAULT_UA,
            },
            json={
                "zone": self.settings.brightdata_zone,
                "url": google_url,
                "format": "raw",
            },
            timeout=max(30.0, self.settings.http_timeout_sec),
        )
        if not response.ok:
            raise RuntimeError(f"brightdata_http_{response.status_code}")

        content_type = (response.headers.get("content-type") or "").lower()
        if "json" not in content_type:
            html = response.text or ""
            if not html:
                raise RuntimeError("brightdata_empty_response")
            parsed = parse_google_serp_html(
                html=html,
                query=query,
                fetched_url=google_url,
                gl=gl,
                hl=hl,
            )
            parsed["source"] = "brightdata-google"
            return parsed

        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("brightdata_invalid_json_payload")

        organic_results: list[dict] = []
        for entry in payload.get("organic", []) if isinstance(payload.get("organic"), list) else []:
            if not isinstance(entry, dict):
                continue
            link = str(entry.get("link") or "").strip()
            if not link:
                continue
            domain = _normalize_domain(link)
            if not domain:
                display = str(entry.get("display_link") or "").strip()
                domain = _normalize_domain(display)
            if not domain:
                continue
            organic_results.append(
                {
                    "title": _normalize_text(entry.get("title", ""))[:180],
                    "link": link,
                    "domain": domain,
                    "snippet": _normalize_text(
                        entry.get("description") or entry.get("source") or ""
                    )[:260],
                }
            )
            if len(organic_results) >= 10:
                break

        related_searches: list[str] = []
        for item in payload.get("related", []) if isinstance(payload.get("related"), list) else []:
            if isinstance(item, dict):
                text = _normalize_text(item.get("text") or "")
            elif isinstance(item, str):
                text = _normalize_text(item)
            else:
                text = ""
            if 4 <= len(text) <= 90:
                related_searches.append(text)

        people_also_ask: list[str] = []
        paa = payload.get("people_also_ask")
        if isinstance(paa, list):
            for item in paa:
                if isinstance(item, dict):
                    text = _normalize_text(item.get("question") or item.get("text") or "")
                elif isinstance(item, str):
                    text = _normalize_text(item)
                else:
                    text = ""
                if 6 <= len(text) <= 130:
                    people_also_ask.append(text)

        ads_count = 0
        for key in ("ads", "top_ads", "bottom_ads", "paid_results", "shopping_results"):
            value = payload.get(key)
            if isinstance(value, list):
                ads_count += len(value)

        competitor_domains = _dedupe_keep_order([item["domain"] for item in organic_results])[:12]

        return {
            "query": query,
            "source": "brightdata-google",
            "fetched_at": _utc_now_iso(),
            "fetched_url": google_url,
            "gl": gl,
            "hl": hl,
            "people_also_ask": _dedupe_keep_order(people_also_ask)[:12],
            "related_searches": _dedupe_keep_order(related_searches)[:12],
            "ads_count": ads_count if ads_count > 0 else 0,
            "organic_results": organic_results,
            "competitor_domains": competitor_domains,
            "status": "ok",
            "raw_meta": {
                "general": payload.get("general", {}) if isinstance(payload.get("general"), dict) else {},
            },
        }

    def _searxng_search(self, query: str, gl: str, hl: str, num: int) -> dict:
        configured = list(self.settings.searxng_base_urls)
        if self.settings.searxng_base_url and self.settings.searxng_base_url not in configured:
            configured.insert(0, self.settings.searxng_base_url)
        if not configured:
            raise RuntimeError("searxng_not_configured")

        now = time.time()
        endpoints = [
            base.rstrip("/")
            for base in configured
            if base and self.searxng_backoff.get(base.rstrip("/"), 0.0) <= now
        ]
        if not endpoints:
            # if all are in backoff, retry the first configured endpoint
            endpoints = [configured[0].rstrip("/")]

        errors: list[str] = []
        for base in endpoints:
            self._rate_limit()
            try:
                response = self.session.get(
                    f"{base}/search",
                    params={
                        "q": query,
                        "format": "json",
                        "language": hl,
                        "safesearch": 0,
                        "categories": "general",
                    },
                    timeout=self.settings.http_timeout_sec,
                    headers={
                        "User-Agent": DEFAULT_UA,
                        "Accept": "application/json",
                    },
                )
            except Exception as exc:
                errors.append(f"{base}:{exc.__class__.__name__}")
                self.searxng_backoff[base] = time.time() + 300
                continue

            if not response.ok:
                errors.append(f"{base}:http_{response.status_code}")
                if response.status_code in {401, 403, 429, 503}:
                    self.searxng_backoff[base] = time.time() + 900
                else:
                    self.searxng_backoff[base] = time.time() + 300
                continue

            try:
                payload = response.json()
            except Exception:
                errors.append(f"{base}:non_json_response")
                self.searxng_backoff[base] = time.time() + 300
                continue

            if not isinstance(payload, dict):
                errors.append(f"{base}:invalid_json_payload")
                self.searxng_backoff[base] = time.time() + 300
                continue
            result = _from_searxng_payload(payload, query=query, gl=gl, hl=hl)
            if _is_result_useful(result):
                return result
            errors.append(f"{base}:empty_results")
            self.searxng_backoff[base] = time.time() + 120

        raise RuntimeError("searxng_unavailable:" + ",".join(errors[:4]))

    def _duckduckgo_search(self, query: str, gl: str, hl: str, num: int) -> dict:
        self._rate_limit()
        response = self.session.get(
            "https://duckduckgo.com/html/",
            params={"q": query},
            headers={
                "User-Agent": DEFAULT_UA,
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=self.settings.http_timeout_sec,
            proxies=self._pick_proxy(),
        )
        if not response.ok:
            raise RuntimeError(f"duckduckgo_http_{response.status_code}")
        return _from_duckduckgo_html(response.text, query=query, gl=gl, hl=hl)

    def _jina_duckduckgo_search(self, query: str, gl: str, hl: str, num: int) -> dict:
        self._rate_limit()
        response = self.session.get(
            "https://r.jina.ai/http://duckduckgo.com/",
            params={"q": query},
            headers={
                "User-Agent": DEFAULT_UA,
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=max(15.0, self.settings.http_timeout_sec),
        )
        if not response.ok:
            raise RuntimeError(f"jina_ddg_http_{response.status_code}")
        return _from_jina_duckduckgo_markdown(
            response.text,
            query=query,
            gl=gl,
            hl=hl,
        )

    def _bing_search(self, query: str, gl: str, hl: str, num: int) -> dict:
        self._rate_limit()
        response = self.session.get(
            "https://www.bing.com/search",
            params={"q": query, "count": max(1, min(num, 10))},
            headers={
                "User-Agent": DEFAULT_UA,
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=self.settings.http_timeout_sec,
            proxies=self._pick_proxy(),
        )
        if not response.ok:
            raise RuntimeError(f"bing_http_{response.status_code}")
        return _from_bing_html(response.text, query=query, gl=gl, hl=hl)

    def _serpapi_search(self, query: str, gl: str, hl: str, num: int) -> dict:
        if not self.settings.serpapi_api_key:
            raise RuntimeError("serpapi_not_configured")
        self._rate_limit()
        response = self.session.get(
            "https://serpapi.com/search.json",
            params={
                "engine": "google",
                "q": query,
                "hl": hl,
                "gl": gl,
                "num": max(1, min(num, 10)),
                "api_key": self.settings.serpapi_api_key,
            },
            timeout=self.settings.http_timeout_sec,
        )
        if not response.ok:
            raise RuntimeError(f"serpapi_http_{response.status_code}")
        payload = response.json()
        return _from_serpapi_payload(payload, query=query, gl=gl, hl=hl)

    def search(self, query: str, gl: str = "us", hl: str = "en-US", num: int = 10) -> dict:
        normalized_query = _normalize_text(query)
        normalized_gl = (gl or "us").lower()
        normalized_hl = _normalize_text(hl) or "en-US"
        normalized_num = max(1, min(int(num), 10))
        cache_key = (
            f"q={normalized_query}|gl={normalized_gl}|hl={normalized_hl}|n={normalized_num}"
        )
        cached = self._cache_get(cache_key)
        if cached:
            cached_payload = dict(cached)
            cached_payload["cache_hit"] = True
            return cached_payload

        providers = [
            self._brightdata_google_search,
            self._google_html_search,
            self._bing_search,
            self._duckduckgo_search,
            self._jina_duckduckgo_search,
            self._searxng_search,
            self._serpapi_search,
        ]
        errors: list[str] = []
        payload: dict | None = None
        for provider in providers:
            try:
                candidate = provider(
                    normalized_query, normalized_gl, normalized_hl, normalized_num
                )
            except Exception as exc:
                errors.append(str(exc))
                continue
            if _is_result_useful(candidate):
                payload = candidate
                break
            payload = candidate

        if payload is None:
            payload = {
                "query": normalized_query,
                "source": "unavailable",
                "fetched_at": _utc_now_iso(),
                "fetched_url": "",
                "gl": normalized_gl,
                "hl": normalized_hl,
                "people_also_ask": [],
                "related_searches": [],
                "ads_count": 0,
                "organic_results": [],
                "competitor_domains": [],
                "status": "error",
            }

        if errors:
            payload["errors"] = errors[-5:]

        payload["cache_hit"] = False
        self._cache_set(cache_key, payload)
        return payload


_engine_lock = threading.Lock()
_engine: InternalSerpEngine | None = None
_engine_key = ""


def _settings_signature(settings: ProviderSettings) -> str:
    return "|".join(
        [
            settings.serp_google_endpoint,
            settings.searxng_base_url,
            str(bool(settings.serpapi_api_key)),
            str(settings.serp_cache_ttl_sec),
            str(settings.serp_min_interval_ms),
            str(len(settings.serp_proxy_urls)),
        ]
    )


def get_internal_serp_engine(settings: ProviderSettings | None = None) -> InternalSerpEngine:
    global _engine
    global _engine_key
    resolved = settings or load_settings()
    key = _settings_signature(resolved)
    with _engine_lock:
        if _engine is None or _engine_key != key:
            _engine = InternalSerpEngine(resolved)
            _engine_key = key
        return _engine


def search_serp(
    *,
    query: str,
    gl: str = "us",
    hl: str = "en-US",
    num: int = 10,
    settings: ProviderSettings | None = None,
) -> dict:
    engine = get_internal_serp_engine(settings=settings)
    return engine.search(query=query, gl=gl, hl=hl, num=num)
