from __future__ import annotations

from typing import Any
from typing import Literal

from pydantic import BaseModel, Field


class Product(BaseModel):
    name: str
    description: str = ""
    category: str = ""
    price: float | None = None
    tags: list[str] = Field(default_factory=list)
    image_alt: str = ""


class StoreProfile(BaseModel):
    url: str
    platform: str
    language: str
    market: str
    positioning: str
    products: list[Product] = Field(default_factory=list)


class SourceEvidence(BaseModel):
    source: str
    observed_at: str
    available: bool = True
    error: str = ""
    volume: int | None = None
    cpc: float | None = None
    competition_index: float | None = None
    trend_direction: Literal["growing", "stable", "declining"] | None = None
    trend_score: float | None = None
    autocomplete_suggestions: list[str] = Field(default_factory=list)
    related_searches: list[str] = Field(default_factory=list)
    people_also_ask: list[str] = Field(default_factory=list)
    ads_count: int | None = None
    competitor_domains: list[str] = Field(default_factory=list)
    competitor_landing_pages: list[str] = Field(default_factory=list)
    ad_copies: list[dict[str, str]] = Field(default_factory=list)
    geo_breakdown: dict[str, int] = Field(default_factory=dict)
    confidence_signal: float = 0.5
    raw: dict[str, Any] = Field(default_factory=dict)


class KeywordMetric(BaseModel):
    keyword: str
    volume: int
    cpc: float
    competition_index: float
    trend_direction: Literal["growing", "stable", "declining"]
    competitor_density: float
    buying_intent: Literal[
        "transactional", "commercial", "informational", "navigational"
    ]
    relevance: float
    score: float
    hidden_gem: bool = False
    sources: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    confidence_components: dict[str, float] = Field(default_factory=dict)
    evidence: dict[str, SourceEvidence] = Field(default_factory=dict)


class AdGroup(BaseModel):
    name: str
    theme: str
    keywords: list[str]
    keyword_match_types: dict[str, str] = Field(default_factory=dict)
    negatives: list[str]
    headlines: list[str]
    descriptions: list[str]
    callouts: list[str]
    budget_usd_daily: float


class CompetitorRecord(BaseModel):
    domain: str
    organic_keywords: list[str] = Field(default_factory=list)
    paid_keywords: list[str] = Field(default_factory=list)
    ad_copy_examples: list[str] = Field(default_factory=list)
    landing_pages: list[str] = Field(default_factory=list)
    estimated_monthly_spend_usd: float = 0.0


class KeywordGap(BaseModel):
    keyword: str
    competitor_domains: list[str] = Field(default_factory=list)
    estimated_volume: int = 0
    estimated_cpc: float = 0.0
    opportunity_score: float = 0.0


class AdCopyGap(BaseModel):
    angle: str
    competitor_domains: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)


class CompetitorIntelligence(BaseModel):
    provider_status: dict[str, str] = Field(default_factory=dict)
    discovered_competitors: list[CompetitorRecord] = Field(default_factory=list)
    keyword_gaps: list[KeywordGap] = Field(default_factory=list)
    ad_copy_gaps: list[AdCopyGap] = Field(default_factory=list)


class RisingKeyword(BaseModel):
    keyword: str
    current_score: float
    previous_score: float
    delta_score: float
    current_confidence: float


class SeasonalForecast(BaseModel):
    keyword: str
    next_peak_month: int
    confidence: float


class MonitoringSnapshot(BaseModel):
    run_id: int | None = None
    previous_run_id: int | None = None
    new_keywords: list[str] = Field(default_factory=list)
    lost_keywords: list[str] = Field(default_factory=list)
    rising_keywords: list[RisingKeyword] = Field(default_factory=list)
    alerts: list[str] = Field(default_factory=list)
    seasonal_forecast: list[SeasonalForecast] = Field(default_factory=list)


class PipelineOutput(BaseModel):
    profile: StoreProfile
    keywords: list[KeywordMetric]
    ad_groups: list[AdGroup]
    source_status: dict[str, str] = Field(default_factory=dict)
    competitor_intelligence: CompetitorIntelligence | None = None
    monitoring: MonitoringSnapshot | None = None


class CreativeDNAPaletteColor(BaseModel):
    id: str
    name: str
    hex: str
    role: Literal["primary", "secondary", "accent", "neutral", "support"]


class CreativeDNALook(BaseModel):
    id: str
    name: str
    description: str
    background_prompt: str = ""
    shadow_style: Literal["soft", "studio", "dramatic"] = "soft"
    tone_tags: list[str] = Field(default_factory=list)


class CreativeDNAExportPreset(BaseModel):
    id: str
    name: str
    width_px: int
    height_px: int
    use_case: str


class CreativeDNAMark(BaseModel):
    id: str
    name: str
    kind: Literal["logo", "badge", "patch", "mark", "vector_art"] = "mark"
    file_format: Literal["svg"] = "svg"
    source_name: str = ""
    svg: str
    created_at: str


class CreativeDNASavedWork(BaseModel):
    id: str
    title: str
    work_type: Literal["profile_refresh", "vectorization"] = "profile_refresh"
    description: str = ""
    linked_mark_id: str | None = None
    created_at: str


class CreativeDNAProfile(BaseModel):
    tenant_key: str = "default"
    store_key: str
    store_url: str
    brand_name: str
    summary: str = ""
    tone_keywords: list[str] = Field(default_factory=list)
    photography_direction: str = ""
    palette: list[CreativeDNAPaletteColor] = Field(default_factory=list)
    looks: list[CreativeDNALook] = Field(default_factory=list)
    export_presets: list[CreativeDNAExportPreset] = Field(default_factory=list)
    marks: list[CreativeDNAMark] = Field(default_factory=list)
    saved_works: list[CreativeDNASavedWork] = Field(default_factory=list)
    source_profile: StoreProfile | None = None
    updated_at: str


class CreativeDNAVectorizationResult(BaseModel):
    profile: CreativeDNAProfile
    mark: CreativeDNAMark


class CreativeLibraryAsset(BaseModel):
    tenant_key: str = "default"
    store_key: str
    asset_id: str
    creative_family_id: str
    platform: str = "meta"
    source_creative_id: str = ""
    source_asset_id: str = ""
    asset_type: Literal["image", "video", "carousel", "collection", "unknown"] = "unknown"
    asset_name: str = ""
    asset_url: str = ""
    thumbnail_url: str = ""
    preview_url: str = ""
    asset_signature: str
    asset_fingerprint: str = ""
    image_hash: str = ""
    perceptual_hash: str = ""
    first_seen_at: str
    last_seen_at: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw: dict[str, Any] = Field(default_factory=dict)


class CreativeLibraryVariant(BaseModel):
    tenant_key: str = "default"
    store_key: str
    variant_id: str
    asset_id: str
    platform: str = "meta"
    source_creative_id: str = ""
    creative_name: str = ""
    body_text: str = ""
    headline: str = ""
    link_description: str = ""
    cta_text: str = ""
    destination_url: str = ""
    aspect_ratio: str = ""
    ad_format: str = ""
    language: str = ""
    variant_signature: str
    first_seen_at: str
    last_seen_at: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw: dict[str, Any] = Field(default_factory=dict)


class CreativeLibraryUsage(BaseModel):
    tenant_key: str = "default"
    store_key: str
    usage_id: str
    variant_id: str
    platform: str = "meta"
    account_id: str = ""
    account_name: str = ""
    campaign_id: str = ""
    campaign_name: str = ""
    adset_id: str = ""
    adset_name: str = ""
    ad_id: str = ""
    ad_name: str = ""
    country: str = ""
    region: str = ""
    geo_bucket: str = ""
    publisher_platform: str = ""
    platform_position: str = ""
    placement: str = ""
    device_platform: str = ""
    objective: str = ""
    buying_type: str = ""
    status: str = ""
    effective_status: str = ""
    started_at: str = ""
    ended_at: str = ""
    first_seen_at: str
    last_seen_at: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw: dict[str, Any] = Field(default_factory=dict)


class CreativeLibrarySnapshot(BaseModel):
    tenant_key: str = "default"
    store_key: str
    snapshot_id: str
    usage_id: str
    variant_id: str
    asset_id: str
    sync_run_id: int | None = None
    observed_at: str
    date_start: str
    date_stop: str
    spend: float | None = None
    impressions: int | None = None
    clicks: int | None = None
    link_clicks: int | None = None
    ctr: float | None = None
    cpc: float | None = None
    cpm: float | None = None
    frequency: float | None = None
    conversions: float | None = None
    purchases: float | None = None
    revenue: float | None = None
    roas: float | None = None
    hook_hold_rate: float | None = None
    thumb_stop_rate: float | None = None
    video_3s_views: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw: dict[str, Any] = Field(default_factory=dict)


class CreativeLibraryVariantRecord(BaseModel):
    asset: CreativeLibraryAsset
    variant: CreativeLibraryVariant
    latest_snapshot: CreativeLibrarySnapshot | None = None
    usages: list[CreativeLibraryUsage] = Field(default_factory=list)
    history: list[CreativeLibrarySnapshot] = Field(default_factory=list)
    usage_count: int = 0
    snapshot_count: int = 0


class CreativeLibraryIngestResult(BaseModel):
    sync_run_id: int | None = None
    processed_rows: int = 0
    asset_count: int = 0
    variant_count: int = 0
    usage_count: int = 0
    snapshot_count: int = 0
    historical_rows: int = 0


class MetaCreativePullResult(BaseModel):
    ad_account_id: str
    fetched_ads: int = 0
    fetched_insights: int = 0
    normalized_rows: int = 0
    breakdowns: list[str] = Field(default_factory=list)
    ingest: CreativeLibraryIngestResult
