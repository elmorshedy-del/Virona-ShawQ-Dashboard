from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import requests


SEARX_SPACE_INSTANCES_URL = "https://searx.space/data/instances.json"
DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


@dataclass
class SearxProbeResult:
    base_url: str
    ok: bool
    latency_sec: float
    results_count: int
    error: str = ""


def _normalize_url(value: str) -> str:
    url = str(value or "").strip().rstrip("/")
    if not url.startswith("http"):
        return ""
    return url


def fetch_candidate_instances(limit: int = 60) -> list[str]:
    response = requests.get(
        SEARX_SPACE_INSTANCES_URL,
        headers={"User-Agent": DEFAULT_UA},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    instances = payload.get("instances", {})
    scored: list[tuple[float, str]] = []
    for base_url, meta in instances.items():
        if not isinstance(meta, dict):
            continue
        if meta.get("network_type") != "normal":
            continue
        http_meta = meta.get("http") or {}
        if int(http_meta.get("status_code", 0) or 0) != 200:
            continue
        search_timing = ((meta.get("timing") or {}).get("search") or {}).get("all") or {}
        median = float(search_timing.get("median", 9.9) or 9.9)
        normalized = _normalize_url(base_url)
        if not normalized:
            continue
        scored.append((median, normalized))
    scored.sort(key=lambda item: item[0])
    deduped: list[str] = []
    seen: set[str] = set()
    for _, url in scored:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
        if len(deduped) >= limit:
            break
    return deduped


def probe_instance(
    base_url: str,
    *,
    query: str,
    language: str = "en-US",
    timeout_sec: float = 8.0,
) -> SearxProbeResult:
    endpoint = f"{base_url.rstrip('/')}/search"
    started = time.perf_counter()
    try:
        response = requests.get(
            endpoint,
            params={
                "q": query,
                "format": "json",
                "language": language,
                "safesearch": 0,
                "categories": "general",
            },
            headers={"User-Agent": DEFAULT_UA},
            timeout=timeout_sec,
        )
        latency = max(0.001, time.perf_counter() - started)
        if response.status_code != 200:
            return SearxProbeResult(
                base_url=base_url,
                ok=False,
                latency_sec=latency,
                results_count=0,
                error=f"http_{response.status_code}",
            )
        try:
            payload = response.json()
        except Exception:
            return SearxProbeResult(
                base_url=base_url,
                ok=False,
                latency_sec=latency,
                results_count=0,
                error="non_json_response",
            )
        if not isinstance(payload, dict):
            return SearxProbeResult(
                base_url=base_url,
                ok=False,
                latency_sec=latency,
                results_count=0,
                error="invalid_json_payload",
            )
        results = payload.get("results") or []
        if not isinstance(results, list):
            results = []
        return SearxProbeResult(
            base_url=base_url,
            ok=True,
            latency_sec=latency,
            results_count=len(results),
        )
    except Exception as exc:
        latency = max(0.001, time.perf_counter() - started)
        return SearxProbeResult(
            base_url=base_url,
            ok=False,
            latency_sec=latency,
            results_count=0,
            error=exc.__class__.__name__,
        )


def discover_working_instances(
    *,
    query: str = "palestine hoodie",
    target_count: int = 5,
    candidate_limit: int = 60,
    max_workers: int = 12,
) -> list[SearxProbeResult]:
    candidates = fetch_candidate_instances(limit=candidate_limit)
    if not candidates:
        return []

    results: list[SearxProbeResult] = []
    workers = max(1, min(max_workers, len(candidates)))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(probe_instance, candidate, query=query): candidate
            for candidate in candidates
        }
        for future in as_completed(futures):
            result = future.result()
            if result.ok:
                results.append(result)
            if len(results) >= max(1, target_count):
                break

    return sorted(results, key=lambda item: (item.latency_sec, -item.results_count))
