"""Report writing helpers for product discovery runs."""

from __future__ import annotations

import json
from pathlib import Path
import re

from .models import ProductDiscoveryReport

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def write_reports(
    *,
    report: ProductDiscoveryReport,
    output_dir: str,
    file_stem: str,
) -> tuple[Path, Path]:
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    json_path = output_path / f"{file_stem}.json"
    md_path = output_path / f"{file_stem}.md"

    json_path.write_text(json.dumps(report.to_dict(), indent=2), encoding="utf-8")
    md_path.write_text(_build_markdown_report(report), encoding="utf-8")

    return json_path, md_path


def _build_markdown_report(report: ProductDiscoveryReport) -> str:
    lines = [
        "# Product Discovery Opportunity Report",
        "",
        f"- Generated: {report.generated_at}",
        f"- Store: {report.profile.store_name}",
        f"- Tenant ID: {report.profile.tenant_id or 'n/a'}",
        f"- Account ID: {report.profile.account_id or 'n/a'}",
        f"- Shop ID: {report.profile.shop_id or 'n/a'}",
        f"- Positioning Mode: {report.profile.positioning_mode}",
        f"- Geo: {report.config.geo}",
        f"- Seed Keywords: {', '.join(report.profile.seed_keywords) if report.profile.seed_keywords else 'n/a'}",
        f"- Marketplaces Scanned: {', '.join(report.config.marketplaces)}",
        f"- Trend Window: {report.config.trend_time_window}",
        "",
        "## Top Opportunities",
        "",
        "| Keyword | Recommendation | Total | Search | Trend | Sustained | Marketplace | Quality Fit | Sources |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]

    if report.opportunities:
        for item in report.opportunities:
            lines.append(
                "| "
                f"{_sanitize_cell(item.keyword)} | "
                f"{_sanitize_cell(item.inventory_recommendation)} | "
                f"{item.score_total:.2f} | "
                f"{item.search_score:.2f} | "
                f"{item.trend_score:.2f} | "
                f"{item.sustained_trend_score:.2f} | "
                f"{item.marketplace_score:.2f} | "
                f"{item.quality_fit_score:.2f} | "
                f"{_sanitize_cell(', '.join(item.sources))} |"
            )
    else:
        lines.append("| No opportunities detected | reject | 0 | 0 | 0 | 0 | 0 | 0 | n/a |")

    _append_copyworthy_targets(lines, report)

    lines.extend(["", "## Opportunity Detail", ""])
    for item in report.opportunities:
        lines.extend(
            [
                f"### {item.keyword}",
                "",
                f"- Total Score: {item.score_total:.2f}",
                f"- Search Score: {item.search_score:.2f}",
                f"- Trend Score: {item.trend_score:.2f}",
                f"- Sustained Trend Score: {item.sustained_trend_score:.2f}",
                f"- Marketplace Score: {item.marketplace_score:.2f}",
                f"- Quality Fit Score: {item.quality_fit_score:.2f}",
                f"- Recommendation: {item.inventory_recommendation}",
                f"- Signals: {', '.join(item.sources)}",
                "",
                "Marketplace coverage:",
                "",
                "| Marketplace | Status | Estimated Results | Sample Products | Source |",
                "| --- | --- | ---: | --- | --- |",
            ]
        )
        for snapshot in item.marketplace_snapshots:
            sample_products = "<br>".join(_sanitize_cell(value) for value in snapshot.sample_products)
            lines.append(
                "| "
                f"{snapshot.marketplace} | "
                f"{snapshot.status} | "
                f"{snapshot.total_results_estimate or 0} | "
                f"{sample_products or 'n/a'} | "
                f"{_sanitize_cell(snapshot.source_url)} |"
            )

        lines.extend(["", "Why this appears:", ""])
        for reason in item.rationale:
            lines.append(f"- {reason}")
        lines.append("")

    lines.extend(["## Most Searched Expansions", ""])
    if report.search_expansions:
        lines.extend(
            [
                "| Seed Keyword | Source | Suggestions |",
                "| --- | --- | --- |",
            ]
        )
        for expansion in report.search_expansions:
            suggestions = ", ".join(_sanitize_cell(value) for value in expansion.suggestions)
            lines.append(
                "| "
                f"{_sanitize_cell(expansion.seed_keyword)} | "
                f"{_sanitize_cell(expansion.source)} | "
                f"{suggestions or 'n/a'} |"
            )
    else:
        lines.append("No suggestion data available.")

    lines.extend(["", "## Relevant Trend Signals", ""])
    if report.trend_signals:
        lines.extend(
            [
                "| Query | Rank | Approx Traffic | Relevance |",
                "| --- | ---: | --- | ---: |",
            ]
        )
        for trend in report.trend_signals:
            lines.append(
                "| "
                f"{_sanitize_cell(trend.query)} | "
                f"{trend.rank} | "
                f"{_sanitize_cell(trend.approx_traffic or 'n/a')} | "
                f"{trend.relevance_score:.2f} |"
            )
    else:
        lines.append("No relevant trends matched the current seed keywords.")

    lines.extend(["", "## Sustained Trend Evidence", ""])
    if report.sustained_trend_signals:
        lines.extend(
            [
                "| Query | Direction | Sustained Score | Relevance | Recent Avg | Baseline Avg | Growth | Slope | Consistency | Points |",
                "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            ]
        )
        for signal in report.sustained_trend_signals:
            lines.append(
                "| "
                f"{_sanitize_cell(signal.query)} | "
                f"{_sanitize_cell(signal.direction)} | "
                f"{signal.sustained_score:.2f} | "
                f"{signal.store_relevance:.2f} | "
                f"{signal.recent_average:.2f} | "
                f"{signal.baseline_average:.2f} | "
                f"{signal.growth_rate:.4f} | "
                f"{signal.slope_per_point:.4f} | "
                f"{signal.consistency_ratio:.4f} | "
                f"{signal.points_count} |"
            )
    else:
        lines.append("No sustained trend evidence available for this run.")

    lines.extend(["", "## Collection Warnings", ""])
    if report.warnings:
        for warning in report.warnings:
            lines.append(f"- {warning}")
    else:
        lines.append("- None.")

    return "\n".join(lines).strip() + "\n"


def _sanitize_cell(value: str) -> str:
    return value.replace("|", "\\|").strip()


def _append_copyworthy_targets(lines: list[str], report: ProductDiscoveryReport) -> None:
    lines.extend(
        [
            "",
            "## Copyworthy Piece Targets",
            "",
            "These are concept references to model directionally, not direct 1:1 copying.",
            "",
        ]
    )

    candidates = _rank_copyworthy_candidates(report.opportunities)
    if not candidates:
        lines.append("No copyworthy targets available from this run.")
        return

    lines.extend(
        [
            "| Piece Concept To Model | Opportunity | Recommendation | Hype Level | Demand Evidence | Trend Evidence | Source Marketplace |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for candidate in candidates:
        lines.append(
            "| "
            f"{_sanitize_cell(candidate['piece'])} | "
            f"{_sanitize_cell(candidate['keyword'])} | "
            f"{_sanitize_cell(candidate['recommendation'])} | "
            f"{_sanitize_cell(candidate['hype'])} | "
            f"{_sanitize_cell(candidate['demand'])} | "
            f"{_sanitize_cell(candidate['trend'])} | "
            f"{_sanitize_cell(candidate['marketplace'])} |"
        )


def _rank_copyworthy_candidates(opportunities: list[object]) -> list[dict[str, str]]:
    ranked_rows: list[tuple[float, dict[str, str]]] = []
    for item in opportunities:
        if item.inventory_recommendation == "reject":
            continue

        best_snapshot, best_piece = _best_snapshot_for_keyword(
            snapshots=item.marketplace_snapshots,
            keyword=item.keyword,
        )
        if best_snapshot is None:
            continue
        if not best_piece:
            continue

        piece = best_piece
        demand_estimate = best_snapshot.total_results_estimate or 0
        trend_points = item.sustained_trend_score
        total_points = item.score_total
        hype_level = _hype_level(
            total_score=total_points,
            sustained_score=trend_points,
            search_score=item.search_score,
        )

        demand_text = (
            f"{demand_estimate:,} listings on {best_snapshot.marketplace}"
            if demand_estimate > 0
            else f"listed on {best_snapshot.marketplace}"
        )
        trend_text = (
            f"Sustained score {trend_points:.1f} / 100"
            if trend_points > 0
            else f"Search score {item.search_score:.1f} / 100"
        )
        row = {
            "piece": piece,
            "keyword": item.keyword,
            "recommendation": item.inventory_recommendation,
            "hype": hype_level,
            "demand": demand_text,
            "trend": trend_text,
            "marketplace": best_snapshot.marketplace,
        }
        rank_score = total_points + (trend_points * 0.35)
        ranked_rows.append((rank_score, row))

    ranked_rows.sort(key=lambda value: value[0], reverse=True)
    return [row for _score, row in ranked_rows[:5]]


def _best_snapshot_for_keyword(
    *,
    snapshots: list[object],
    keyword: str,
) -> tuple[object | None, str]:
    valid = []
    for snapshot in snapshots:
        if snapshot.status != "ok":
            continue
        valid.append(snapshot)
    if not valid:
        return None, ""

    keyword_tokens = set(_TOKEN_RE.findall(keyword.lower()))
    best_snapshot = None
    best_piece = ""
    best_relevance = -1.0
    best_demand = -1

    for snapshot in valid:
        demand = snapshot.total_results_estimate or 0
        for piece in snapshot.sample_products:
            relevance = _piece_relevance(piece=piece, keyword_tokens=keyword_tokens)
            if relevance > best_relevance:
                best_relevance = relevance
                best_demand = demand
                best_snapshot = snapshot
                best_piece = piece
                continue
            if relevance == best_relevance and demand > best_demand:
                best_demand = demand
                best_snapshot = snapshot
                best_piece = piece

    if best_snapshot is not None and best_piece:
        return best_snapshot, best_piece

    valid.sort(key=lambda value: value.total_results_estimate or 0, reverse=True)
    fallback = valid[0]
    fallback_piece = fallback.sample_products[0] if fallback.sample_products else ""
    return fallback, fallback_piece


def _piece_relevance(*, piece: str, keyword_tokens: set[str]) -> float:
    if not piece:
        return 0.0
    piece_tokens = set(_TOKEN_RE.findall(piece.lower()))
    if not piece_tokens:
        return 0.0
    if not keyword_tokens:
        return 0.0
    overlap = len(piece_tokens.intersection(keyword_tokens))
    return overlap / len(keyword_tokens)


def _hype_level(*, total_score: float, sustained_score: float, search_score: float) -> str:
    if sustained_score >= 75 and total_score >= 70:
        return "Very High"
    if sustained_score >= 55 or (total_score >= 60 and search_score >= 70):
        return "High"
    if total_score >= 45:
        return "Medium"
    return "Low"
