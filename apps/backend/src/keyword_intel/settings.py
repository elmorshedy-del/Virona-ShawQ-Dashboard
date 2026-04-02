from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    lowered = str(value).strip().lower()
    return lowered in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed


def _normalize_customer_id(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def _env_list(name: str) -> tuple[str, ...]:
    value = os.getenv(name, "")
    if not value.strip():
        return tuple()
    return tuple(part.strip() for part in value.split(",") if part.strip())


@dataclass(frozen=True)
class ProviderSettings:
    google_ads_api_version: str
    google_ads_customer_id: str
    google_ads_login_customer_id: str
    google_ads_developer_token: str
    google_ads_client_id: str
    google_ads_client_secret: str
    google_ads_refresh_token: str
    serp_base_url: str
    serp_search_path: str
    serp_api_key: str
    serp_auth_header: str
    serp_auth_scheme: str
    provider_scope_limit: int
    serp_keyword_limit: int
    trends_keyword_limit: int
    provider_max_workers: int
    http_timeout_sec: float
    serp_internal_enabled: bool
    serp_cache_ttl_sec: int
    serp_min_interval_ms: int
    serp_google_endpoint: str
    serp_proxy_urls: tuple[str, ...]
    searxng_base_url: str
    searxng_base_urls: tuple[str, ...]
    serpapi_api_key: str
    brightdata_request_url: str
    brightdata_api_key: str
    brightdata_zone: str
    spyfu_api_base_url: str
    spyfu_username: str
    spyfu_password: str
    spyfu_country_code: str
    semrush_api_key: str
    semrush_database: str
    ahrefs_api_base_url: str
    ahrefs_api_key: str
    ahrefs_paid_keywords_path: str
    ahrefs_organic_keywords_path: str
    persist_runs: bool
    db_path: str
    monitor_rising_threshold: float
    monitor_alert_min_confidence: float
    meta_graph_api_version: str = "v22.0"
    meta_access_token: str = ""
    meta_ad_account_id: str = ""
    beats_endpoint_url: str = ""
    beats_api_token: str = ""
    beats_timeout_sec: float = 120.0
    firered_endpoint_url: str = ""
    firered_api_token: str = ""
    firered_timeout_sec: float = 120.0
    siglip_endpoint_url: str = ""
    siglip_api_token: str = ""
    siglip_timeout_sec: float = 120.0
    dashscope_api_key: str = ""
    dashscope_base_url: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    dashscope_model: str = "qwen-vl-max"
    dashscope_timeout_sec: float = 120.0
    google_ai_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout_sec: float = 120.0
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    anthropic_base_url: str = "https://api.anthropic.com/v1/messages"
    anthropic_timeout_sec: float = 120.0

    @property
    def google_ads_ready(self) -> bool:
        required = [
            self.google_ads_customer_id,
            self.google_ads_developer_token,
            self.google_ads_client_id,
            self.google_ads_client_secret,
            self.google_ads_refresh_token,
        ]
        return all(bool(item) for item in required)

    @property
    def meta_ready(self) -> bool:
        return bool(self.meta_graph_api_version and self.meta_access_token and self.meta_ad_account_id)

    @property
    def beats_ready(self) -> bool:
        return bool(self.beats_endpoint_url)

    @property
    def firered_ready(self) -> bool:
        return bool(self.firered_endpoint_url)

    @property
    def siglip_ready(self) -> bool:
        return bool(self.siglip_endpoint_url)

    @property
    def qwen_ready(self) -> bool:
        return bool(self.dashscope_api_key and self.dashscope_model)

    @property
    def gemini_ready(self) -> bool:
        return bool(self.google_ai_api_key and self.gemini_model)

    @property
    def anthropic_ready(self) -> bool:
        return bool(self.anthropic_api_key and self.anthropic_model)

    @property
    def serp_ready(self) -> bool:
        return bool(self.serp_base_url and self.serp_api_key)

    @property
    def serp_available(self) -> bool:
        return self.serp_ready or self.serp_internal_enabled

    @property
    def brightdata_ready(self) -> bool:
        return bool(self.brightdata_request_url and self.brightdata_api_key and self.brightdata_zone)

    @property
    def spyfu_ready(self) -> bool:
        return bool(
            self.spyfu_api_base_url and self.spyfu_username and self.spyfu_password
        )

    @property
    def semrush_ready(self) -> bool:
        return bool(self.semrush_api_key)

    @property
    def ahrefs_ready(self) -> bool:
        return bool(
            self.ahrefs_api_base_url
            and self.ahrefs_api_key
            and self.ahrefs_paid_keywords_path
        )


def load_settings() -> ProviderSettings:
    google_ads_customer_id = _normalize_customer_id(
        os.getenv("GOOGLE_ADS_CUSTOMER_ID", "")
    )
    google_ads_login_customer_id = _normalize_customer_id(
        os.getenv("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "")
    )
    return ProviderSettings(
        meta_graph_api_version=os.getenv("META_GRAPH_API_VERSION", "v22.0").strip() or "v22.0",
        meta_access_token=os.getenv("META_ACCESS_TOKEN", "").strip(),
        meta_ad_account_id=os.getenv("META_AD_ACCOUNT_ID", "").strip(),
        beats_endpoint_url=os.getenv("BEATS_ENDPOINT_URL", "").strip(),
        beats_api_token=os.getenv("BEATS_API_TOKEN", os.getenv("HF_TOKEN", "")).strip(),
        beats_timeout_sec=max(10.0, _env_float("BEATS_TIMEOUT_SEC", 120.0)),
        firered_endpoint_url=(
            os.getenv("FIRERED_ENDPOINT_URL", os.getenv("VOICEMIX_ENDPOINT_URL", "")).strip()
        ),
        firered_api_token=os.getenv("FIRERED_API_TOKEN", os.getenv("HF_TOKEN", "")).strip(),
        firered_timeout_sec=max(10.0, _env_float("FIRERED_TIMEOUT_SEC", 120.0)),
        siglip_endpoint_url=os.getenv("SIGLIP_ENDPOINT_URL", "").strip(),
        siglip_api_token=os.getenv("SIGLIP_API_TOKEN", os.getenv("HF_TOKEN", "")).strip(),
        siglip_timeout_sec=max(10.0, _env_float("SIGLIP_TIMEOUT_SEC", 120.0)),
        dashscope_api_key=os.getenv("DASHSCOPE_API_KEY", "").strip(),
        dashscope_base_url=(
            os.getenv("DASHSCOPE_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
            .strip()
            .rstrip("/")
            or "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
        ),
        dashscope_model=os.getenv("DASHSCOPE_MODEL", "qwen-vl-max").strip() or "qwen-vl-max",
        dashscope_timeout_sec=max(10.0, _env_float("DASHSCOPE_TIMEOUT_SEC", 120.0)),
        google_ai_api_key=os.getenv("GOOGLE_AI_API_KEY", os.getenv("GEMINI_API_KEY", "")).strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash",
        gemini_base_url=(
            os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
            .strip()
            .rstrip("/")
            or "https://generativelanguage.googleapis.com/v1beta"
        ),
        gemini_timeout_sec=max(10.0, _env_float("GEMINI_TIMEOUT_SEC", 120.0)),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
        anthropic_model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6",
        anthropic_base_url=(
            os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1/messages").strip()
            or "https://api.anthropic.com/v1/messages"
        ),
        anthropic_timeout_sec=max(10.0, _env_float("ANTHROPIC_TIMEOUT_SEC", 120.0)),
        google_ads_api_version=os.getenv("GOOGLE_ADS_API_VERSION", "v22"),
        google_ads_customer_id=google_ads_customer_id,
        google_ads_login_customer_id=google_ads_login_customer_id,
        google_ads_developer_token=os.getenv("GOOGLE_ADS_DEVELOPER_TOKEN", "").strip(),
        google_ads_client_id=os.getenv("GOOGLE_ADS_CLIENT_ID", "").strip(),
        google_ads_client_secret=os.getenv("GOOGLE_ADS_CLIENT_SECRET", "").strip(),
        google_ads_refresh_token=os.getenv("GOOGLE_ADS_REFRESH_TOKEN", "").strip(),
        serp_base_url=os.getenv("SERP_BASE_URL", "").strip().rstrip("/"),
        serp_search_path=os.getenv("SERP_SEARCH_PATH", "/search").strip() or "/search",
        serp_api_key=os.getenv("SERP_API_KEY", "").strip(),
        serp_auth_header=os.getenv("SERP_AUTH_HEADER", "Authorization").strip(),
        serp_auth_scheme=os.getenv("SERP_AUTH_SCHEME", "Bearer").strip(),
        provider_scope_limit=max(20, _env_int("KEYWORD_INTEL_PROVIDER_SCOPE_LIMIT", 250)),
        serp_keyword_limit=max(10, _env_int("KEYWORD_INTEL_SERP_KEYWORD_LIMIT", 40)),
        trends_keyword_limit=max(10, _env_int("KEYWORD_INTEL_TRENDS_KEYWORD_LIMIT", 20)),
        provider_max_workers=max(1, _env_int("KEYWORD_INTEL_PROVIDER_MAX_WORKERS", 8)),
        http_timeout_sec=max(3.0, _env_float("KEYWORD_INTEL_HTTP_TIMEOUT_SEC", 12.0)),
        serp_internal_enabled=_env_bool("SERP_INTERNAL_ENABLED", True),
        serp_cache_ttl_sec=max(60, _env_int("SERP_CACHE_TTL_SEC", 1800)),
        serp_min_interval_ms=max(0, _env_int("SERP_MIN_INTERVAL_MS", 450)),
        serp_google_endpoint=(
            os.getenv("SERP_GOOGLE_ENDPOINT", "https://www.google.com/search")
            .strip()
            .rstrip("/")
        ),
        serp_proxy_urls=_env_list("SERP_PROXY_URLS"),
        searxng_base_url=os.getenv("SEARXNG_BASE_URL", "").strip().rstrip("/"),
        searxng_base_urls=_env_list("SEARXNG_BASE_URLS"),
        serpapi_api_key=os.getenv("SERPAPI_API_KEY", "").strip(),
        brightdata_request_url=(
            os.getenv("BRIGHTDATA_REQUEST_URL", "https://api.brightdata.com/request")
            .strip()
            .rstrip("/")
        ),
        brightdata_api_key=os.getenv("BRIGHTDATA_API_KEY", "").strip(),
        brightdata_zone=os.getenv("BRIGHTDATA_ZONE", "").strip(),
        spyfu_api_base_url=(
            os.getenv("SPYFU_API_BASE_URL", "https://api.spyfu.com/apis")
            .strip()
            .rstrip("/")
        ),
        spyfu_username=os.getenv("SPYFU_USERNAME", "").strip(),
        spyfu_password=os.getenv("SPYFU_PASSWORD", "").strip(),
        spyfu_country_code=os.getenv("SPYFU_COUNTRY_CODE", "US").strip().upper() or "US",
        semrush_api_key=os.getenv("SEMRUSH_API_KEY", "").strip(),
        semrush_database=os.getenv("SEMRUSH_DATABASE", "us").strip().lower() or "us",
        ahrefs_api_base_url=os.getenv("AHREFS_API_BASE_URL", "").strip().rstrip("/"),
        ahrefs_api_key=os.getenv("AHREFS_API_KEY", "").strip(),
        ahrefs_paid_keywords_path=(
            os.getenv("AHREFS_PAID_KEYWORDS_PATH", "").strip() or "/paid_keywords"
        ),
        ahrefs_organic_keywords_path=(
            os.getenv("AHREFS_ORGANIC_KEYWORDS_PATH", "").strip()
            or "/organic_keywords"
        ),
        persist_runs=_env_bool("KEYWORD_INTEL_PERSIST_RUNS", True),
        db_path=os.getenv("KEYWORD_INTEL_DB_PATH", ".keyword_intel.db").strip()
        or ".keyword_intel.db",
        monitor_rising_threshold=max(1.0, _env_float("KEYWORD_INTEL_RISING_THRESHOLD", 10.0)),
        monitor_alert_min_confidence=max(
            0.0,
            min(100.0, _env_float("KEYWORD_INTEL_ALERT_MIN_CONFIDENCE", 60.0)),
        ),
    )
