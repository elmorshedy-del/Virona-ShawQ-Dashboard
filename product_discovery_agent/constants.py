"""Configurable constants for product discovery analysis."""

from __future__ import annotations

DEFAULT_REQUEST_TIMEOUT_SECONDS = 15
DEFAULT_USER_AGENT = (
    "VironaProductDiscoveryAgent/1.0 "
    "(+https://virona.local/product-discovery)"
)

DEFAULT_GEO = "US"
DEFAULT_LANGUAGE = "en-US"
DEFAULT_POSITIONING_MODE = "balanced"
SUPPORTED_POSITIONING_MODES = frozenset({"balanced", "quality"})

DEFAULT_MAX_SUGGESTIONS_PER_SOURCE = 12
DEFAULT_MAX_TREND_ITEMS = 80
DEFAULT_MAX_MARKETPLACE_TERMS = 12
DEFAULT_MAX_SAMPLE_PRODUCTS = 5
DEFAULT_MAX_SUSTAINED_TREND_TERMS = 8
DEFAULT_TREND_TIME_WINDOW = "today 12-m"
DEFAULT_TARGET_PRICING_STORE_ID = "3991"
DEFAULT_TARGET_API_KEY_FALLBACK = "9f36aeafbe60771e321a7cc95a78140772ab3e96"
MAX_SUSTAINED_TREND_FETCH_FAILURES = 2

DEFAULT_MARKETPLACES = ("amazon", "walmart", "target")
SUPPORTED_MARKETPLACES = frozenset(DEFAULT_MARKETPLACES)

ALLOWED_SOURCE_HOSTS = frozenset(
    {
        "suggestqueries.google.com",
        "completion.amazon.com",
        "trends.google.com",
        "www.amazon.com",
        "www.walmart.com",
        "www.target.com",
        "redsky.target.com",
    }
)

MIN_KEYWORD_LENGTH = 2
MAX_KEYWORD_LENGTH = 80
MAX_SEED_KEYWORDS = 30
MIN_RELEVANCE_FOR_TRENDS = 0.25
MIN_RELEVANCE_FOR_SUSTAINED_TRENDS = 0.2

SEARCH_SOURCE_WEIGHTS = {
    "seed_keyword": 6.0,
    "google_suggest": 5.0,
    "amazon_suggest": 4.0,
    "google_trends": 3.0,
}
SEARCH_RANK_MULTIPLIER = 8.0

TREND_TRAFFIC_MULTIPLIER = 12.0
TREND_RELEVANCE_MULTIPLIER = 16.0

SUSTAINED_TREND_RECENT_POINTS = 8
SUSTAINED_TREND_BASELINE_POINTS = 8
SUSTAINED_TREND_MIN_POINTS = 16
SUSTAINED_BASELINE_DENOMINATOR_FLOOR = 10.0
SUSTAINED_GROWTH_STRONG = 0.35
SUSTAINED_SLOPE_STRONG = 0.35
SUSTAINED_SCORE_COMPONENT_WEIGHTS = {
    "growth": 0.5,
    "slope": 0.3,
    "consistency": 0.2,
}
SUSTAINED_DIRECTION_THRESHOLDS = {
    "accelerating_growth_min": 0.20,
    "accelerating_slope_min": 0.10,
    "accelerating_consistency_min": 0.60,
    "steady_growth_min": 0.05,
    "steady_slope_min": 0.03,
    "declining_growth_max": -0.10,
    "declining_slope_max": -0.05,
}

MARKETPLACE_COVERAGE_WEIGHT = 16.0
MARKETPLACE_RESULTS_WEIGHT = 14.0
MARKETPLACE_SAMPLE_TITLES_WEIGHT = 2.0
MARKETPLACE_RESULT_CAP = 1_000_000

QUALITY_SCORE_BASELINE = 50.0
QUALITY_POSITIVE_TOKEN_BOOST = 8.0
QUALITY_NEGATIVE_TOKEN_PENALTY = 14.0
QUALITY_SCORE_MIN = 0.0
QUALITY_SCORE_MAX = 100.0
QUALITY_NEGATIVE_TOKENS = frozenset(
    {
        "cheap",
        "clearance",
        "bulk",
        "wholesale",
        "dupe",
        "replica",
        "knockoff",
        "low cost",
    }
)
QUALITY_POSITIVE_TOKENS = frozenset(
    {
        "premium",
        "organic",
        "authentic",
        "official",
        "luxury",
        "designer",
        "artisan",
        "high quality",
    }
)

COMPONENT_SCORE_CAP = 100.0
WEIGHTED_SCORE_WEIGHTS = {
    "search": 0.22,
    "trend": 0.14,
    "sustained": 0.34,
    "marketplace": 0.30,
}

INVENTORY_RECOMMENDATION_THRESHOLDS = {
    "add_now_total_min": 70.0,
    "add_now_sustained_min": 60.0,
    "add_now_marketplace_min": 45.0,
    "add_now_quality_min": 55.0,
    "test_batch_total_min": 55.0,
    "test_batch_sustained_min": 45.0,
    "test_batch_quality_min": 45.0,
    "watchlist_total_min": 40.0,
}
