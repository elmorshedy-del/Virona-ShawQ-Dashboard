from __future__ import annotations

import re

from .models import StoreProfile


INTENT_MODIFIERS = {
    "en": [
        "buy",
        "shop",
        "best",
        "cheap",
        "premium",
        "review",
        "vs",
        "alternative",
        "near me",
        "online",
        "for sale",
    ],
    "ar": ["شراء", "تسوق", "افضل", "رخيص", "فاخر", "مراجعة", "بديل", "اونلاين"],
    "fr": ["acheter", "boutique", "meilleur", "pas cher", "premium", "avis", "alternative"],
    "es": ["comprar", "tienda", "mejor", "barato", "premium", "resena", "alternativa"],
    "de": ["kaufen", "shop", "beste", "gunstig", "premium", "bewertung", "alternative"],
}

OCCASION_MODIFIERS = {
    "en": ["gift for", "birthday", "holiday", "wedding", "anniversary"],
    "ar": ["هدية", "عيد ميلاد", "موسم العيد", "زفاف"],
    "fr": ["cadeau pour", "anniversaire", "fetes", "mariage"],
    "es": ["regalo para", "cumpleanos", "navidad", "boda"],
    "de": ["geschenk fur", "geburtstag", "feiertag", "hochzeit"],
}

AUDIENCE_MODIFIERS = {
    "en": ["for men", "for women", "for kids", "unisex", "plus size"],
    "ar": ["للرجال", "للنساء", "للاطفال", "للجنسين"],
    "fr": ["pour homme", "pour femme", "pour enfant", "unisexe"],
    "es": ["para hombre", "para mujer", "para ninos", "unisex"],
    "de": ["fur herren", "fur damen", "fur kinder", "unisex"],
}

PROBLEM_MODIFIERS = {
    "en": ["for pain relief", "for comfort", "for daily use", "for travel", "durable"],
    "ar": ["للراحة", "للاستخدام اليومي", "للسفر", "متين"],
    "fr": ["pour le confort", "usage quotidien", "pour voyage", "durable"],
    "es": ["para comodidad", "uso diario", "para viaje", "duradero"],
    "de": ["fur komfort", "tagliche nutzung", "fur reisen", "langlebig"],
}

GENERIC_TOKENS = {
    "and",
    "best",
    "buy",
    "collection",
    "for",
    "from",
    "gift",
    "item",
    "items",
    "new",
    "online",
    "product",
    "products",
    "ready",
    "sale",
    "ship",
    "shipping",
    "shop",
    "store",
    "the",
    "today",
    "with",
}


def _norm(text: str) -> str:
    lowered = text.lower().strip()
    lowered = re.sub(r"[^a-z0-9\u0600-\u06FF\s]+", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered)
    return lowered.strip()


def _compact_phrase(text: str) -> str:
    tokens = _norm(text).split()
    out: list[str] = []
    for token in tokens:
        if out and token == out[-1]:
            continue
        if token in out and token in GENERIC_TOKENS:
            continue
        out.append(token)
    return " ".join(out)


def _dedupe_keep_order(values: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = _compact_phrase(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        output.append(normalized)
    return output


def _extract_attributes(text: str, blocked_tokens: set[str]) -> list[str]:
    candidates = _norm(text).split()
    attributes = [
        token
        for token in candidates
        if (
            len(token) >= 4
            and token not in {"with", "from", "this", "that", "your"}
            and token not in GENERIC_TOKENS
            and token not in blocked_tokens
        )
    ]
    return _dedupe_keep_order(attributes)[:6]


def _is_quality_candidate(keyword: str) -> bool:
    tokens = keyword.split()
    if not tokens:
        return False
    if len(tokens) == 1 and tokens[0] in GENERIC_TOKENS:
        return False
    unique_non_generic = [token for token in tokens if token not in GENERIC_TOKENS]
    if not unique_non_generic:
        return False
    if len(tokens) >= 4 and len(set(tokens)) <= 2:
        return False
    return True


def generate_candidates(profile: StoreProfile) -> list[str]:
    lang = profile.language if profile.language in INTENT_MODIFIERS else "en"
    intents = INTENT_MODIFIERS[lang]
    occasions = OCCASION_MODIFIERS.get(lang, OCCASION_MODIFIERS["en"])
    audiences = AUDIENCE_MODIFIERS.get(lang, AUDIENCE_MODIFIERS["en"])
    problems = PROBLEM_MODIFIERS.get(lang, PROBLEM_MODIFIERS["en"])

    candidates: list[str] = []
    categories: set[str] = set()

    for product in profile.products:
        name = _norm(product.name)
        if not name:
            continue
        category = _norm(product.category) if product.category else ""
        if category:
            categories.add(category)

        blocked = set(name.split())
        blocked.update(category.split())
        attributes = _extract_attributes(
            " ".join([product.description, " ".join(product.tags), product.image_alt]),
            blocked_tokens=blocked,
        )

        direct_terms = [name]
        if category:
            direct_terms.extend([category, f"{name} {category}"])
        candidates.extend(direct_terms)

        for base in direct_terms:
            for intent in intents:
                candidates.append(f"{intent} {base}")
                if intent in {"review", "vs", "alternative", "مراجعة", "بديل", "avis", "resena", "bewertung"}:
                    candidates.append(f"{base} {intent}")
            for audience in audiences:
                candidates.append(f"{base} {audience}")
            for occasion in occasions:
                candidates.append(f"{base} {occasion}")
            for problem in problems:
                candidates.append(f"{base} {problem}")

            for attribute in attributes[:4]:
                candidates.append(f"{base} {attribute}")
                for intent in intents[:5]:
                    candidates.append(f"{intent} {base} {attribute}")
                for audience in audiences[:3]:
                    candidates.append(f"{base} {attribute} {audience}")

    for category in sorted(categories):
        candidates.append(category)
        for intent in intents:
            candidates.append(f"{intent} {category}")
        for occasion in occasions[:3]:
            candidates.append(f"{category} {occasion}")

    deduped = _dedupe_keep_order(candidates)
    filtered = [keyword for keyword in deduped if _is_quality_candidate(keyword)]
    return filtered[:2500]
