from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import urlparse
from uuid import uuid4

from .creative_dna_storage import load_creative_dna_profile, save_creative_dna_profile
from .discovery import discover_store
from .models import (
    CreativeDNAMark,
    CreativeDNAExportPreset,
    CreativeDNALook,
    CreativeDNAPaletteColor,
    CreativeDNAProfile,
    CreativeDNASavedWork,
    CreativeDNAVectorizationResult,
    StoreProfile,
)


MAX_SAVED_WORK_ITEMS = 24
DEFAULT_TENANT_KEY = "default"
CREATIVE_DNA_DISCOVERY_PRODUCT_LIMIT = 10


@dataclass(frozen=True)
class BrandSignals:
    premium: bool
    streetwear: bool
    artisanal: bool
    jewelry: bool
    minimal: bool
    gifting: bool


def _utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _store_key_from_url(store_url: str) -> str:
    parsed = urlparse(store_url)
    hostname = (parsed.hostname or "").lower().strip()
    return hostname or "default-store"


def _make_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def _brand_name(profile: StoreProfile) -> str:
    hostname = (urlparse(profile.url).hostname or "").strip()
    if hostname:
        first = hostname.split(".")[0].replace("-", " ").replace("_", " ").strip()
        if first:
            return " ".join(part.capitalize() for part in first.split())
    if profile.products:
        return profile.products[0].name[:60]
    return "Brand"


def _signal_text(profile: StoreProfile) -> str:
    parts = [profile.positioning]
    for product in profile.products[:20]:
        parts.extend([product.name, product.description, product.category, product.image_alt])
        parts.extend(product.tags)
    return " ".join(part for part in parts if part).lower()


def _detect_signals(profile: StoreProfile) -> BrandSignals:
    text = _signal_text(profile)
    return BrandSignals(
        premium=any(token in text for token in ("premium", "luxury", "elegant", "editorial", "heritage")),
        streetwear=any(token in text for token in ("streetwear", "oversized", "hoodie", "cargo", "sneaker")),
        artisanal=any(token in text for token in ("embroider", "tatreez", "handmade", "woven", "craft")),
        jewelry=any(token in text for token in ("jewelry", "necklace", "ring", "bracelet", "pendant")),
        minimal=any(token in text for token in ("minimal", "clean", "neutral", "simple", "essential")),
        gifting=any(token in text for token in ("gift", "holiday", "occasion", "ramadan", "eid")),
    )


def _tone_keywords(signals: BrandSignals) -> list[str]:
    tokens: list[str] = ["commerce-ready", "brand-safe"]
    if signals.premium:
        tokens.extend(["premium", "editorial"])
    if signals.streetwear:
        tokens.extend(["streetwear", "confident"])
    if signals.artisanal:
        tokens.extend(["crafted", "heritage"])
    if signals.jewelry:
        tokens.extend(["refined", "detail-led"])
    if signals.minimal:
        tokens.extend(["minimal", "calm"])
    if signals.gifting:
        tokens.extend(["giftable", "seasonal"])

    seen: set[str] = set()
    ordered: list[str] = []
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        ordered.append(token)
    return ordered[:8]


def _palette_for_signals(signals: BrandSignals) -> list[CreativeDNAPaletteColor]:
    if signals.jewelry:
        return [
            CreativeDNAPaletteColor(id="palette_ink", name="Ink", hex="#1B1A1F", role="primary"),
            CreativeDNAPaletteColor(id="palette_champagne", name="Champagne", hex="#E7D6B6", role="secondary"),
            CreativeDNAPaletteColor(id="palette_gold", name="Antique Gold", hex="#B4853E", role="accent"),
            CreativeDNAPaletteColor(id="palette_cream", name="Cream", hex="#F8F3E8", role="neutral"),
        ]
    if signals.streetwear:
        return [
            CreativeDNAPaletteColor(id="palette_ink", name="Midnight", hex="#151820", role="primary"),
            CreativeDNAPaletteColor(id="palette_bone", name="Bone", hex="#EEE7D8", role="secondary"),
            CreativeDNAPaletteColor(id="palette_steel", name="Steel", hex="#59616E", role="support"),
            CreativeDNAPaletteColor(id="palette_signal", name="Signal Sand", hex="#C8A06A", role="accent"),
        ]
    if signals.artisanal:
        return [
            CreativeDNAPaletteColor(id="palette_clove", name="Clove", hex="#49342B", role="primary"),
            CreativeDNAPaletteColor(id="palette_sand", name="Sand", hex="#D9C7A8", role="secondary"),
            CreativeDNAPaletteColor(id="palette_clay", name="Clay", hex="#B27354", role="accent"),
            CreativeDNAPaletteColor(id="palette_cream", name="Warm Cream", hex="#F6F0E5", role="neutral"),
        ]
    return [
        CreativeDNAPaletteColor(id="palette_forest", name="Forest Ink", hex="#223128", role="primary"),
        CreativeDNAPaletteColor(id="palette_ivory", name="Ivory", hex="#F6F2E7", role="secondary"),
        CreativeDNAPaletteColor(id="palette_sage", name="Sage", hex="#98A88D", role="support"),
        CreativeDNAPaletteColor(id="palette_amber", name="Soft Amber", hex="#C79354", role="accent"),
    ]


def _looks_for_signals(signals: BrandSignals) -> list[CreativeDNALook]:
    looks = [
        CreativeDNALook(
            id="look_marketplace_clean",
            name="Marketplace Clean",
            description="Center the product, keep the frame calm, and favor clean commercial lighting.",
            background_prompt="clean studio background, quiet commercial lighting, realistic contact shadow, product centered",
            shadow_style="soft",
            tone_tags=["clean", "catalog", "conversion"],
        ),
        CreativeDNALook(
            id="look_soft_editorial",
            name="Soft Editorial",
            description="Warm directional light with premium restraint for paid social and landing pages.",
            background_prompt="soft editorial studio, warm neutrals, directional light, premium retail styling",
            shadow_style="studio",
            tone_tags=["editorial", "warm", "premium"],
        ),
    ]

    if signals.streetwear:
        looks.append(
            CreativeDNALook(
                id="look_confident_street",
                name="Confident Street",
                description="Sharper contrast and grounded framing for apparel launches and streetwear drops.",
                background_prompt="minimal urban studio, soft concrete tones, confident fashion lighting, grounded subject",
                shadow_style="dramatic",
                tone_tags=["streetwear", "sharp", "launch-ready"],
            )
        )
    elif signals.artisanal or signals.gifting:
        looks.append(
            CreativeDNALook(
                id="look_heritage_warmth",
                name="Heritage Warmth",
                description="Craft-led textures and gentle warmth for giftable product photography.",
                background_prompt="warm handcrafted editorial set, tactile neutrals, premium detail focus, soft grounded shadows",
                shadow_style="studio",
                tone_tags=["crafted", "giftable", "heritage"],
            )
        )
    else:
        looks.append(
            CreativeDNALook(
                id="look_quiet_luxury",
                name="Quiet Luxury",
                description="Restrained premium framing for higher-ticket catalog and ad creative work.",
                background_prompt="quiet luxury studio, subtle beige gradients, refined product styling, natural grounded shadows",
                shadow_style="soft",
                tone_tags=["luxury", "calm", "refined"],
            )
        )
    return looks


def _export_presets() -> list[CreativeDNAExportPreset]:
    return [
        CreativeDNAExportPreset(
            id="export_pdp_square",
            name="PDP Square",
            width_px=2000,
            height_px=2000,
            use_case="Shopify product detail page and marketplace listings",
        ),
        CreativeDNAExportPreset(
            id="export_social_portrait",
            name="Social Portrait",
            width_px=1080,
            height_px=1350,
            use_case="Meta feed ads and organic social posts",
        ),
        CreativeDNAExportPreset(
            id="export_story",
            name="Story Vertical",
            width_px=1080,
            height_px=1920,
            use_case="Stories, Reels covers, and vertical launch creative",
        ),
    ]


def _photography_direction(signals: BrandSignals) -> str:
    if signals.jewelry:
        return "Tight detail framing, refined highlights, and premium negative space."
    if signals.streetwear:
        return "Grounded apparel framing with confident contrast and modern negative space."
    if signals.artisanal:
        return "Texture-first closeups with crafted warmth and tactile backgrounds."
    return "Calm storefront framing that balances clarity, polish, and brand restraint."


def _summary(profile: StoreProfile, signals: BrandSignals) -> str:
    direction = _photography_direction(signals)
    return (
        f"{_brand_name(profile)} leans {', '.join(_tone_keywords(signals)[:3])}. "
        f"Recommended direction: {direction}"
    )


def refresh_creative_dna_profile(
    *,
    db_path: str,
    store_url: str,
    tenant_key: str = DEFAULT_TENANT_KEY,
    store_key: str | None = None,
) -> CreativeDNAProfile:
    discovered = discover_store(store_url, max_products=CREATIVE_DNA_DISCOVERY_PRODUCT_LIMIT)
    resolved_store_key = (store_key or _store_key_from_url(store_url)).strip().lower() or "default-store"
    existing = load_creative_dna_profile(db_path, tenant_key=tenant_key, store_key=resolved_store_key)
    signals = _detect_signals(discovered)

    saved_works = list(existing.saved_works if existing else [])
    saved_works.insert(
        0,
        CreativeDNASavedWork(
            id=_make_id("work"),
            title="Creative DNA refreshed",
            work_type="profile_refresh",
            description=f"Updated from {discovered.url}",
            created_at=_utc_now_iso(),
        ),
    )
    saved_works = saved_works[:MAX_SAVED_WORK_ITEMS]

    profile = CreativeDNAProfile(
        tenant_key=tenant_key or DEFAULT_TENANT_KEY,
        store_key=resolved_store_key,
        store_url=discovered.url,
        brand_name=_brand_name(discovered),
        summary=_summary(discovered, signals),
        tone_keywords=_tone_keywords(signals),
        photography_direction=_photography_direction(signals),
        palette=_palette_for_signals(signals),
        looks=_looks_for_signals(signals),
        export_presets=_export_presets(),
        marks=list(existing.marks if existing else []),
        saved_works=saved_works,
        source_profile=discovered,
        updated_at=_utc_now_iso(),
    )
    return save_creative_dna_profile(db_path, profile)


def append_vector_mark(
    *,
    db_path: str,
    tenant_key: str,
    store_key: str,
    mark_name: str,
    source_name: str,
    svg: str,
    store_url: str | None = None,
) -> CreativeDNAVectorizationResult:
    profile = load_creative_dna_profile(db_path, tenant_key=tenant_key, store_key=store_key)
    if profile is None:
        if not store_url:
            raise ValueError("store_url is required before saving a new Creative DNA mark")
        profile = refresh_creative_dna_profile(
            db_path=db_path,
            store_url=store_url,
            tenant_key=tenant_key,
            store_key=store_key,
        )

    mark = CreativeDNAMark(
        id=_make_id("mark"),
        name=mark_name.strip() or "Vector Mark",
        kind="vector_art",
        source_name=source_name.strip(),
        svg=svg,
        created_at=_utc_now_iso(),
    )
    saved_work = CreativeDNASavedWork(
        id=_make_id("work"),
        title=f"Vectorized {mark.name}",
        work_type="vectorization",
        description="Converted raster artwork into a production-ready SVG mark.",
        linked_mark_id=mark.id,
        created_at=_utc_now_iso(),
    )
    next_profile = profile.model_copy(
        update={
            "marks": [mark, *profile.marks],
            "saved_works": [saved_work, *profile.saved_works][:MAX_SAVED_WORK_ITEMS],
        }
    )
    stored_profile = save_creative_dna_profile(db_path, next_profile)
    return CreativeDNAVectorizationResult(profile=stored_profile, mark=mark)
