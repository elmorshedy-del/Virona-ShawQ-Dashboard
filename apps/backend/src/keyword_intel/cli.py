from __future__ import annotations

import csv
import json
from pathlib import Path

import typer

from .creative_overlays import generate_reel_overlay_plan
from .google_ads_push import GoogleAdsCampaignPusher
from .pipeline import run_pipeline
from .searx_discovery import discover_working_instances
from .settings import load_settings

app = typer.Typer(help="Google Ads keyword intelligence CLI")


def _write_campaign_csv(path: Path, result: dict) -> None:
    headers = [
        "ad_group",
        "keyword",
        "match_type",
        "score",
        "confidence",
        "intent",
        "volume",
        "cpc",
        "competition_index",
        "trend_direction",
        "hidden_gem",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        metrics = {k["keyword"]: k for k in result["keywords"]}
        for group in result["ad_groups"]:
            for keyword in group["keywords"]:
                metric = metrics.get(keyword, {})
                writer.writerow(
                    {
                        "ad_group": group["name"],
                        "keyword": keyword,
                        "match_type": group.get("keyword_match_types", {}).get(keyword, "PHRASE"),
                        "score": metric.get("score"),
                        "confidence": metric.get("confidence"),
                        "intent": metric.get("buying_intent"),
                        "volume": metric.get("volume"),
                        "cpc": metric.get("cpc"),
                        "competition_index": metric.get("competition_index"),
                        "trend_direction": metric.get("trend_direction"),
                        "hidden_gem": metric.get("hidden_gem"),
                    }
                )


@app.command("run")
def run(
    store_url: str = typer.Option(..., help="Store URL to analyze"),
    market: str | None = typer.Option(
        None,
        help="Override market (e.g. US, CA, SA). Affects SERP/Keyword Planner geo.",
    ),
    language: str | None = typer.Option(
        None,
        help="Override language (e.g. en, ar, fr). Affects keyword generation + providers.",
    ),
    output_json: Path | None = typer.Option(None, help="Write full pipeline JSON"),
    output_csv: Path | None = typer.Option(None, help="Write campaign keyword CSV"),
    max_keywords: int = typer.Option(300, min=50, max=2000),
) -> None:
    pipeline = run_pipeline(
        store_url=store_url,
        max_keywords=max_keywords,
        market=market,
        language=language,
    )
    payload = pipeline.model_dump()

    if output_json:
        output_json.parent.mkdir(parents=True, exist_ok=True)
        output_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    if output_csv:
        output_csv.parent.mkdir(parents=True, exist_ok=True)
        _write_campaign_csv(output_csv, payload)

    typer.echo(
        f"Analyzed {store_url} | products={len(payload['profile']['products'])} "
        f"keywords={len(payload['keywords'])} ad_groups={len(payload['ad_groups'])}"
    )
    if output_json:
        typer.echo(f"JSON: {output_json}")
    if output_csv:
        typer.echo(f"CSV: {output_csv}")


@app.command("discover")
def discover(store_url: str = typer.Option(..., help="Store URL to inspect")) -> None:
    pipeline = run_pipeline(store_url=store_url, max_keywords=50)
    profile = pipeline.profile.model_dump()
    typer.echo(json.dumps(profile, indent=2, ensure_ascii=False))


@app.command("setup-serp")
def setup_serp(
    output_env: Path = typer.Option(
        Path("../../.env.serp.local"),
        help="Path to write SERP environment file",
    ),
    query: str = typer.Option(
        "palestine hoodie",
        help="Probe query for instance health checks",
    ),
    target_instances: int = typer.Option(3, min=1, max=10),
) -> None:
    results = discover_working_instances(
        query=query,
        target_count=target_instances,
    )
    if not results:
        typer.echo(
            "No working public SearXNG instances were discovered from this network.",
            err=True,
        )
        raise typer.Exit(
            code=2,
        )

    selected = [item.base_url for item in results[:target_instances]]
    output_env.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "export SERP_INTERNAL_ENABLED=1",
        f"export SEARXNG_BASE_URL={selected[0]}",
        f"export SEARXNG_BASE_URLS={','.join(selected)}",
        "export SERP_MIN_INTERVAL_MS=650",
        "export SERP_CACHE_TTL_SEC=3600",
    ]
    output_env.write_text("\n".join(lines) + "\n", encoding="utf-8")

    typer.echo(f"Wrote SERP env file: {output_env.resolve()}")
    for item in results[:target_instances]:
        typer.echo(
            f"- {item.base_url} (latency={item.latency_sec:.2f}s, results={item.results_count})"
        )
    typer.echo(f"Use with: source {output_env.resolve()}")


@app.command("push-google-ads")
def push_google_ads(
    store_url: str = typer.Option(..., help="Store URL to analyze"),
    customer_id: str | None = typer.Option(
        None,
        help="Google Ads customer ID (digits only or dashed format)",
    ),
    campaign_name: str | None = typer.Option(
        None,
        help="Override campaign name",
    ),
    max_keywords: int = typer.Option(300, min=50, max=2000),
    dry_run: bool = typer.Option(
        True,
        help="If true, output mutate operations without applying changes",
    ),
    output_json: Path | None = typer.Option(
        None,
        help="Optional path to write push response JSON",
    ),
) -> None:
    settings = load_settings()
    resolved_customer_id = customer_id or settings.google_ads_customer_id
    if not resolved_customer_id:
        raise typer.BadParameter(
            "Missing customer ID. Provide --customer-id or set GOOGLE_ADS_CUSTOMER_ID."
        )

    pipeline = run_pipeline(store_url=store_url, max_keywords=max_keywords)
    pusher = GoogleAdsCampaignPusher(settings=settings)
    payload = pusher.push_campaign(
        profile=pipeline.profile,
        ad_groups=pipeline.ad_groups,
        customer_id=resolved_customer_id,
        campaign_name=campaign_name,
        dry_run=dry_run,
    )

    if output_json:
        output_json.parent.mkdir(parents=True, exist_ok=True)
        output_json.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    typer.echo(
        f"Google Ads push status={payload['status']} "
        f"operations={payload['operation_count']} customer={payload['customer_id']}"
    )
    if output_json:
        typer.echo(f"JSON: {output_json}")


@app.command("reel-overlays")
def reel_overlays(
    reel_path: Path = typer.Option(..., exists=True, file_okay=True, dir_okay=False),
    brand_name: str = typer.Option("", help="Brand name"),
    product_name: str = typer.Option("", help="Product name in this reel"),
    tone: str = typer.Option("", help="Tone style (example: premium, playful, bold)"),
    audience: str = typer.Option("", help="Target audience descriptor"),
    objective: str = typer.Option(
        "conversion",
        help="Creative objective: conversion, traffic, awareness",
    ),
    language: str = typer.Option("en", help="Language hint"),
    max_overlays: int = typer.Option(8, min=1, max=50),
    provider_mode: str = typer.Option(
        "auto",
        help="Generation mode: auto, openai-only, template-only",
    ),
    overlay_blind: bool = typer.Option(
        True,
        help="Ignore text already present on the reel (captions/stickers/overlays).",
    ),
    brand_website_url: str = typer.Option(
        "",
        help="Brand URL to fetch positioning cues",
    ),
    audience_response: list[str] | None = typer.Option(
        None,
        help=(
            "Repeatable audience response cues. Example: --audience-response "
            "'love the fit' --audience-response 'compliments in comments'"
        ),
    ),
    brand_notes: str = typer.Option(
        "",
        help="Extra brand guidance to enforce in overlays",
    ),
    output_json: Path | None = typer.Option(
        None,
        help="Optional path to write overlay JSON",
    ),
) -> None:
    try:
        result = generate_reel_overlay_plan(
            reel_path=reel_path,
            brand_name=brand_name,
            product_name=product_name,
            tone=tone,
            audience=audience,
            objective=objective,
            language=language,
            max_overlays=max_overlays,
            brand_website_url=brand_website_url,
            audience_responses=list(audience_response or []),
            brand_notes=brand_notes,
            provider_mode=provider_mode,
            overlay_blind=overlay_blind,
        )
    except RuntimeError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc

    payload = result.model_dump()

    if output_json:
        output_json.parent.mkdir(parents=True, exist_ok=True)
        output_json.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    typer.echo(
        f"Generated overlays provider={payload['provider']} count={len(payload['overlays'])}"
    )
    if payload["brand_intelligence"]["source_url"]:
        typer.echo(f"Brand context URL: {payload['brand_intelligence']['source_url']}")
    if payload["brand_intelligence"]["audience_responses"]:
        typer.echo(
            "Audience cues: "
            + ", ".join(payload["brand_intelligence"]["audience_responses"][:3])
        )
    for item in payload["overlays"]:
        typer.echo(
            f"{item['start_sec']:.2f}-{item['end_sec']:.2f}s | {item['text']}"
        )
    if output_json:
        typer.echo(f"JSON: {output_json}")


if __name__ == "__main__":
    app()
