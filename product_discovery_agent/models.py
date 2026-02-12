"""Typed data models for product discovery workflows."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from .constants import (
    DEFAULT_GEO,
    DEFAULT_LANGUAGE,
    DEFAULT_MARKETPLACES,
    DEFAULT_MAX_MARKETPLACE_TERMS,
    DEFAULT_MAX_SAMPLE_PRODUCTS,
    DEFAULT_MAX_SUSTAINED_TREND_TERMS,
    DEFAULT_MAX_SUGGESTIONS_PER_SOURCE,
    DEFAULT_MAX_TREND_ITEMS,
    DEFAULT_POSITIONING_MODE,
    DEFAULT_REQUEST_TIMEOUT_SECONDS,
    DEFAULT_TARGET_PRICING_STORE_ID,
    DEFAULT_TREND_TIME_WINDOW,
    DEFAULT_USER_AGENT,
)


@dataclass(slots=True)
class StoreScope:
    store_name: str
    seed_keywords: list[str]
    tenant_id: str | None = None
    account_id: str | None = None
    shop_id: str | None = None
    positioning_mode: str = DEFAULT_POSITIONING_MODE
    excluded_keywords: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class DiscoveryConfig:
    geo: str = DEFAULT_GEO
    language: str = DEFAULT_LANGUAGE
    marketplaces: tuple[str, ...] = DEFAULT_MARKETPLACES
    max_suggestions_per_source: int = DEFAULT_MAX_SUGGESTIONS_PER_SOURCE
    max_trend_items: int = DEFAULT_MAX_TREND_ITEMS
    max_sustained_trend_terms: int = DEFAULT_MAX_SUSTAINED_TREND_TERMS
    max_marketplace_terms: int = DEFAULT_MAX_MARKETPLACE_TERMS
    max_sample_products: int = DEFAULT_MAX_SAMPLE_PRODUCTS
    trend_time_window: str = DEFAULT_TREND_TIME_WINDOW
    target_pricing_store_id: str = DEFAULT_TARGET_PRICING_STORE_ID
    timeout_seconds: int = DEFAULT_REQUEST_TIMEOUT_SECONDS
    user_agent: str = DEFAULT_USER_AGENT

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SearchExpansion:
    seed_keyword: str
    source: str
    suggestions: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class TrendSignal:
    query: str
    source: str
    rank: int
    approx_traffic: str
    approx_traffic_estimate: int
    relevance_score: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SustainedTrendSignal:
    query: str
    source: str
    time_window: str
    points_count: int
    recent_average: float
    baseline_average: float
    growth_rate: float
    slope_per_point: float
    consistency_ratio: float
    sustained_score: float
    direction: str
    store_relevance: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class MarketplaceSnapshot:
    marketplace: str
    query: str
    source_url: str
    status: str
    total_results_estimate: int | None
    sample_products: list[str]
    warning: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ProductOpportunity:
    keyword: str
    score_total: float
    search_score: float
    trend_score: float
    sustained_trend_score: float
    marketplace_score: float
    quality_fit_score: float
    inventory_recommendation: str
    sources: list[str]
    rationale: list[str]
    marketplace_snapshots: list[MarketplaceSnapshot] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "keyword": self.keyword,
            "score_total": self.score_total,
            "search_score": self.search_score,
            "trend_score": self.trend_score,
            "sustained_trend_score": self.sustained_trend_score,
            "marketplace_score": self.marketplace_score,
            "quality_fit_score": self.quality_fit_score,
            "inventory_recommendation": self.inventory_recommendation,
            "sources": self.sources,
            "rationale": self.rationale,
            "marketplace_snapshots": [item.to_dict() for item in self.marketplace_snapshots],
        }


@dataclass(slots=True)
class ProductDiscoveryReport:
    generated_at: str
    started_at: str
    finished_at: str
    profile: StoreScope
    config: DiscoveryConfig
    opportunities: list[ProductOpportunity]
    search_expansions: list[SearchExpansion]
    trend_signals: list[TrendSignal]
    sustained_trend_signals: list[SustainedTrendSignal]
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "profile": self.profile.to_dict(),
            "config": self.config.to_dict(),
            "opportunities": [item.to_dict() for item in self.opportunities],
            "search_expansions": [item.to_dict() for item in self.search_expansions],
            "trend_signals": [item.to_dict() for item in self.trend_signals],
            "sustained_trend_signals": [
                item.to_dict() for item in self.sustained_trend_signals
            ],
            "warnings": list(self.warnings),
        }


def now_utc_iso() -> str:
    """Return an ISO-8601 timestamp in UTC with second precision."""
    return datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()
