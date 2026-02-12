"""CLI entrypoint for product discovery agent."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from .constants import (
    DEFAULT_MARKETPLACES,
    DEFAULT_MAX_MARKETPLACE_TERMS,
    DEFAULT_MAX_SAMPLE_PRODUCTS,
    DEFAULT_MAX_SUSTAINED_TREND_TERMS,
    DEFAULT_MAX_SUGGESTIONS_PER_SOURCE,
    DEFAULT_MAX_TREND_ITEMS,
    DEFAULT_POSITIONING_MODE,
    DEFAULT_TARGET_PRICING_STORE_ID,
    DEFAULT_TREND_TIME_WINDOW,
    SUPPORTED_MARKETPLACES,
    SUPPORTED_POSITIONING_MODES,
)
from .engine import run_product_discovery
from .models import DiscoveryConfig, StoreScope
from .reporter import write_reports


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Find product opportunities relevant to a store profile using "
            "search trends, marketplace signals, and demand expansions."
        )
    )
    parser.add_argument(
        "--store-name",
        required=True,
        help="Human-readable store name used in report metadata.",
    )
    parser.add_argument(
        "--seed-keyword",
        action="append",
        required=True,
        help="Seed keyword for relevance (repeat this flag for multiple keywords).",
    )
    parser.add_argument(
        "--exclude-keyword",
        action="append",
        default=[],
        help="Optional keyword to exclude from opportunities (repeatable).",
    )
    parser.add_argument(
        "--positioning-mode",
        default=DEFAULT_POSITIONING_MODE,
        choices=sorted(SUPPORTED_POSITIONING_MODES),
        help=(
            "Store positioning strategy. "
            "Use 'quality' to bias recommendations toward high-quality market fit."
        ),
    )
    parser.add_argument(
        "--tenant-id",
        default=None,
        help="Optional tenant identifier for multi-tenant attribution.",
    )
    parser.add_argument(
        "--account-id",
        default=None,
        help="Optional account identifier for attribution.",
    )
    parser.add_argument(
        "--shop-id",
        default=None,
        help="Optional shop identifier for attribution.",
    )
    parser.add_argument(
        "--geo",
        default="US",
        help="Geo code for trend collection, e.g. US, AE, GB.",
    )
    parser.add_argument(
        "--language",
        default="en-US",
        help="Language tag for search suggestion APIs.",
    )
    parser.add_argument(
        "--marketplace",
        action="append",
        default=[],
        help=(
            "Marketplace adapter to scan. "
            f"Supported: {', '.join(sorted(SUPPORTED_MARKETPLACES))}. "
            "Repeat for multiple marketplaces."
        ),
    )
    parser.add_argument(
        "--max-suggestions-per-source",
        type=int,
        default=DEFAULT_MAX_SUGGESTIONS_PER_SOURCE,
        help="Maximum suggestions to keep per source and seed keyword.",
    )
    parser.add_argument(
        "--max-trend-items",
        type=int,
        default=DEFAULT_MAX_TREND_ITEMS,
        help="Maximum global trend RSS entries to inspect before relevance filtering.",
    )
    parser.add_argument(
        "--max-sustained-trend-terms",
        type=int,
        default=DEFAULT_MAX_SUSTAINED_TREND_TERMS,
        help="Maximum candidate keywords to evaluate for sustained trend direction.",
    )
    parser.add_argument(
        "--max-marketplace-terms",
        type=int,
        default=DEFAULT_MAX_MARKETPLACE_TERMS,
        help="Maximum keywords to send to marketplace scanners.",
    )
    parser.add_argument(
        "--max-sample-products",
        type=int,
        default=DEFAULT_MAX_SAMPLE_PRODUCTS,
        help="Maximum sample product titles to capture per marketplace query.",
    )
    parser.add_argument(
        "--trend-time-window",
        default=DEFAULT_TREND_TIME_WINDOW,
        help='Google Trends time window for sustained analysis, e.g. "today 12-m".',
    )
    parser.add_argument(
        "--target-pricing-store-id",
        default=DEFAULT_TARGET_PRICING_STORE_ID,
        help="Target pricing store ID for marketplace lookups.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=int,
        default=15,
        help="HTTP timeout in seconds for each upstream request.",
    )
    parser.add_argument(
        "--output-dir",
        default="reports",
        help="Directory for generated report files.",
    )
    parser.add_argument(
        "--file-stem",
        default=None,
        help="Optional output filename stem.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.max_suggestions_per_source <= 0:
        parser.error("--max-suggestions-per-source must be greater than 0")
    if args.max_trend_items <= 0:
        parser.error("--max-trend-items must be greater than 0")
    if args.max_sustained_trend_terms <= 0:
        parser.error("--max-sustained-trend-terms must be greater than 0")
    if args.max_marketplace_terms <= 0:
        parser.error("--max-marketplace-terms must be greater than 0")
    if args.max_sample_products <= 0:
        parser.error("--max-sample-products must be greater than 0")
    if args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be greater than 0")
    if not args.trend_time_window or not args.trend_time_window.strip():
        parser.error("--trend-time-window cannot be empty")
    if not args.target_pricing_store_id or not args.target_pricing_store_id.strip():
        parser.error("--target-pricing-store-id cannot be empty")

    marketplaces = _resolve_marketplaces(args.marketplace)
    seed_keywords = [value for value in args.seed_keyword if value and value.strip()]
    if not seed_keywords:
        parser.error("At least one non-empty --seed-keyword is required")

    scope = StoreScope(
        store_name=args.store_name.strip(),
        seed_keywords=seed_keywords,
        tenant_id=args.tenant_id,
        account_id=args.account_id,
        shop_id=args.shop_id,
        positioning_mode=args.positioning_mode,
        excluded_keywords=[value for value in args.exclude_keyword if value and value.strip()],
    )
    config = DiscoveryConfig(
        geo=args.geo.strip().upper(),
        language=args.language.strip(),
        marketplaces=marketplaces,
        max_suggestions_per_source=args.max_suggestions_per_source,
        max_trend_items=args.max_trend_items,
        max_sustained_trend_terms=args.max_sustained_trend_terms,
        max_marketplace_terms=args.max_marketplace_terms,
        max_sample_products=args.max_sample_products,
        trend_time_window=args.trend_time_window.strip(),
        target_pricing_store_id=args.target_pricing_store_id.strip(),
        timeout_seconds=args.timeout_seconds,
    )

    report = run_product_discovery(scope=scope, config=config)
    file_stem = args.file_stem or _default_file_stem(store_name=scope.store_name)
    json_path, md_path = write_reports(
        report=report,
        output_dir=args.output_dir,
        file_stem=file_stem,
    )

    print(f"Product discovery complete for store: {scope.store_name}")
    print(f"Opportunities identified: {len(report.opportunities)}")
    print(f"Trend matches retained: {len(report.trend_signals)}")
    print(f"Sustained trend signals: {len(report.sustained_trend_signals)}")
    print(f"Warnings: {len(report.warnings)}")
    print(f"JSON report: {Path(json_path).resolve()}")
    print(f"Markdown report: {Path(md_path).resolve()}")

    return 0


def _resolve_marketplaces(raw_values: list[str]) -> tuple[str, ...]:
    if not raw_values:
        return tuple(DEFAULT_MARKETPLACES)

    flattened: list[str] = []
    for value in raw_values:
        flattened.extend(part.strip().lower() for part in value.split(","))
    normalized = [value for value in flattened if value]
    deduped: list[str] = []
    for value in normalized:
        if value not in deduped:
            deduped.append(value)

    unsupported = [value for value in deduped if value not in SUPPORTED_MARKETPLACES]
    if unsupported:
        unsupported_str = ", ".join(unsupported)
        supported_str = ", ".join(sorted(SUPPORTED_MARKETPLACES))
        raise SystemExit(
            f"Unsupported marketplaces: {unsupported_str}. Supported values: {supported_str}."
        )
    return tuple(deduped)


def _default_file_stem(*, store_name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", store_name.lower()).strip("-")
    return f"product-discovery-{normalized or 'store'}"


if __name__ == "__main__":
    raise SystemExit(main())
