from __future__ import annotations

from collections import defaultdict

from .models import AdGroup, KeywordMetric, StoreProfile


NEGATIVE_KEYWORDS = [
    "free",
    "job",
    "manual",
    "used",
    "wholesale",
    "template",
    "pdf",
    "download",
]


def _clamp(text: str, max_len: int) -> str:
    cleaned = " ".join(text.split()).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1].rstrip() + "..."


def _theme_from_keyword(keyword: str) -> str:
    tokens = keyword.split()
    if not tokens:
        return "General"
    if len(tokens) == 1:
        return tokens[0].title()
    return f"{tokens[0].title()} {tokens[1].title()}"


def _intent_bucket(intent: str) -> str:
    return intent if intent in {"transactional", "commercial"} else "explore"


def _recommend_match_type(metric: KeywordMetric) -> str:
    if metric.volume < 300 or metric.competition_index > 0.72:
        return "EXACT"
    if metric.volume <= 2400 or metric.competition_index > 0.45:
        return "PHRASE"
    return "BROAD"


def _headline_pool(theme: str, brand: str, top_keyword: str) -> list[str]:
    templates = [
        f"Buy {theme} Online",
        f"{theme} Deals Today",
        f"Shop {theme} Fast",
        f"{brand} {theme}",
        f"{brand} Official Store",
        f"Best {theme} Picks",
        f"Premium {theme} Styles",
        f"{theme} Limited Drop",
        f"Top Rated {theme}",
        f"Order {theme} Now",
        f"{theme} For Every Style",
        f"Trusted {theme} Quality",
        f"New {theme} Arrivals",
        f"{top_keyword.title()} Sale",
        f"{theme} Quick Checkout",
        f"{theme} Ships Fast",
        f"{brand} {top_keyword.title()}",
    ]
    return [_clamp(item, 30) for item in templates]


def _description_pool(theme: str, brand: str) -> list[str]:
    templates = [
        f"Shop {theme.lower()} from {brand} with secure checkout and fast shipping.",
        f"Find premium quality, sharp pricing, and trusted support in one place.",
        f"Discover bestselling {theme.lower()} options tailored to your style and budget.",
        f"Limited offers available now. Order today before top picks run out.",
        f"Built for comfort, value, and confidence. Browse and buy in minutes.",
    ]
    return [_clamp(item, 90) for item in templates]


def _pick_unique(values: list[str], limit: int) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.lower()
        if not value or key in seen:
            continue
        seen.add(key)
        output.append(value)
        if len(output) >= limit:
            break
    return output


def build_ad_groups(
    profile: StoreProfile,
    ranked: list[KeywordMetric],
    target_groups: int = 8,
) -> list[AdGroup]:
    grouped: dict[str, list[KeywordMetric]] = defaultdict(list)
    for metric in ranked:
        theme = _theme_from_keyword(metric.keyword)
        intent = _intent_bucket(metric.buying_intent)
        grouped[f"{theme}|{intent}"].append(metric)

    brand = (profile.positioning.split("|")[0].strip() or "Your Brand")[:22]
    ordered_group_keys = sorted(
        grouped.keys(),
        key=lambda key: (
            -len(grouped[key]),
            -sum(metric.score for metric in grouped[key]) / max(len(grouped[key]), 1),
            key,
        ),
    )

    groups: list[AdGroup] = []
    for group_key in ordered_group_keys[: max(1, target_groups)]:
        theme, intent = group_key.split("|", 1)
        items = sorted(grouped[group_key], key=lambda item: item.score, reverse=True)
        top = items[:15]
        if len(top) < 5 and len(items) >= 5:
            top = items[:5]
        keywords = [item.keyword for item in top]
        if not keywords:
            continue
        match_types = {item.keyword: _recommend_match_type(item) for item in top}

        avg_cpc = sum(item.cpc for item in top) / max(len(top), 1)
        volume_factor = min(sum(item.volume for item in top) / 40_000, 1.0)
        budget = max(12.0, round(avg_cpc * len(top) * (1.35 + volume_factor), 2))

        top_keyword = top[0].keyword
        headlines = _pick_unique(_headline_pool(theme, brand, top_keyword), limit=15)
        descriptions = _pick_unique(_description_pool(theme, brand), limit=4)
        callouts = _pick_unique(
            [
                _clamp("Fast shipping", 25),
                _clamp("Secure checkout", 25),
                _clamp("Easy returns", 25),
                _clamp("Top rated quality", 25),
                _clamp("Limited offers", 25),
                _clamp("Trusted by shoppers", 25),
            ],
            limit=6,
        )

        groups.append(
            AdGroup(
                name=_clamp(f"{theme} {intent.title()}".strip(), 64),
                theme=theme,
                keywords=keywords,
                keyword_match_types=match_types,
                negatives=NEGATIVE_KEYWORDS,
                headlines=headlines,
                descriptions=descriptions,
                callouts=callouts,
                budget_usd_daily=budget,
            )
        )

    return groups
