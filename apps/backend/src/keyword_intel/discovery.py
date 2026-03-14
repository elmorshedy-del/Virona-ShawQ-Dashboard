from __future__ import annotations

import json
import re
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from .models import Product, StoreProfile


PRODUCT_PATH_HINTS = ("/product", "/products", "/shop", "/collections")
ABOUT_PATH_HINTS = ("/about", "/about-us", "/pages/about")
MAX_PRODUCT_PAGE_CRAWLS = 24
PRODUCT_PAGE_TIMEOUT_SEC = 7
GENERIC_PRODUCT_NAMES = {
    "accessories",
    "bottoms",
    "collection",
    "collections",
    "products",
    "shop",
    "tops",
}


def _safe_get(url: str, timeout: int = 12) -> str:
    response = requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": "keyword-intel-bot/0.2"},
    )
    response.raise_for_status()
    return response.text


def _try_get(url: str, timeout: int = PRODUCT_PAGE_TIMEOUT_SEC) -> str:
    try:
        return _safe_get(url, timeout=timeout)
    except Exception:
        return ""


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9\u0600-\u06ff]+", " ", _normalize_text(value).lower()).strip()


def _detect_platform(html: str) -> str:
    lower = html.lower()
    if "cdn.shopify.com" in lower or "shopify" in lower:
        return "shopify"
    if "woocommerce" in lower or "wp-content" in lower:
        return "woocommerce"
    if "salla" in lower:
        return "salla"
    if "wix" in lower:
        return "wix"
    return "custom"


def _detect_market(url: str) -> str:
    hostname = urlparse(url).hostname or ""
    tld = hostname.split(".")[-1].lower() if hostname else "com"
    mapping = {
        "sa": "SA",
        "ae": "AE",
        "uk": "GB",
        "de": "DE",
        "fr": "FR",
        "es": "ES",
    }
    return mapping.get(tld, "US")


def _extract_language(soup: BeautifulSoup) -> str:
    html_tag = soup.find("html")
    if html_tag and html_tag.get("lang"):
        return html_tag.get("lang", "en").split("-")[0].lower()
    text = soup.get_text(" ", strip=True)
    arabic_chars = len(re.findall(r"[\u0600-\u06FF]", text))
    if arabic_chars > 40:
        return "ar"
    lower = text.lower()
    if any(token in lower for token in (" acheter ", " meilleur ", " livraison ")):
        return "fr"
    if any(token in lower for token in (" comprar ", " mejor ", " envio ")):
        return "es"
    if any(token in lower for token in (" kaufen ", " beste ", " versand ")):
        return "de"
    return "en"


def _extract_price(value: str) -> float | None:
    text = str(value or "")
    match = re.search(r"(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?)", text)
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", "").replace(" ", ""))
    except ValueError:
        return None


def _iter_jsonld_items(data: object) -> list[dict]:
    if isinstance(data, dict):
        graph = data.get("@graph")
        if isinstance(graph, list):
            return [item for item in graph if isinstance(item, dict)]
        return [data]
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def _extract_products_from_jsonld(soup: BeautifulSoup) -> list[Product]:
    products: list[Product] = []
    scripts = soup.find_all("script", attrs={"type": "application/ld+json"})
    for script in scripts:
        raw = script.string or script.get_text() or ""
        if not raw.strip():
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            continue
        for item in _iter_jsonld_items(payload):
            item_type = str(item.get("@type", "")).lower()
            if "product" not in item_type:
                continue
            offers = item.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers and isinstance(offers[0], dict) else {}
            price = None
            if isinstance(offers, dict):
                price = _extract_price(str(offers.get("price", "")))
            tags = []
            keywords = item.get("keywords")
            if isinstance(keywords, str):
                tags = [part.strip() for part in keywords.split(",") if part.strip()]
            products.append(
                Product(
                    name=_normalize_text(item.get("name") or "Unnamed Product"),
                    description=_normalize_text(item.get("description") or ""),
                    category=_normalize_text(item.get("category") or ""),
                    price=price,
                    tags=tags[:10],
                    image_alt="",
                )
            )
    return products


def _same_domain(base_url: str, candidate_url: str) -> bool:
    base_host = (urlparse(base_url).hostname or "").lower()
    candidate_host = (urlparse(candidate_url).hostname or "").lower()
    return bool(base_host and candidate_host and base_host == candidate_host)


def _collect_product_links(base_url: str, soup: BeautifulSoup, limit: int) -> list[str]:
    links: list[str] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href", "")).strip()
        if not href:
            continue
        absolute = urljoin(base_url, href)
        lowered = absolute.lower()
        if not any(hint in lowered for hint in PRODUCT_PATH_HINTS):
            continue
        if "?" in lowered and ("variant=" in lowered or "utm_" in lowered):
            continue
        if not _same_domain(base_url, absolute):
            continue
        links.append(absolute)
    deduped: list[str] = []
    seen: set[str] = set()
    for link in links:
        if link in seen:
            continue
        seen.add(link)
        deduped.append(link)
        if len(deduped) >= limit:
            break
    return deduped


def _extract_primary_text(soup: BeautifulSoup) -> str:
    for selector in (
        "meta[property='og:title']",
        "h1",
        "title",
        "meta[name='description']",
        "meta[property='og:description']",
    ):
        node = soup.select_one(selector)
        if not node:
            continue
        if node.name == "meta":
            text = _normalize_text(node.get("content", ""))
        else:
            text = _normalize_text(node.get_text(" ", strip=True))
        if text:
            if "|" in text:
                text = text.split("|")[0].strip()
            if " - " in text and len(text) > 90:
                text = text.split(" - ")[0].strip()
            if len(text) > 120:
                continue
            return text[:120]
    return ""


def _extract_category(soup: BeautifulSoup) -> str:
    for selector in (
        "nav[aria-label*='breadcrumb' i] a",
        ".breadcrumb a",
        "ul.breadcrumb a",
    ):
        nodes = soup.select(selector)
        if nodes:
            labels = [_normalize_text(node.get_text(" ", strip=True)) for node in nodes]
            labels = [label for label in labels if label]
            if len(labels) >= 2:
                return labels[-2]
    return ""


def _extract_image_alt(soup: BeautifulSoup) -> str:
    alts: list[str] = []
    for image in soup.find_all("img", alt=True):
        alt = _normalize_text(image.get("alt", ""))
        if len(alt) < 3:
            continue
        alts.append(alt)
        if len(alts) >= 3:
            break
    return " | ".join(alts)[:220]


def _extract_tags(soup: BeautifulSoup) -> list[str]:
    tags: list[str] = []
    meta_keywords = soup.select_one("meta[name='keywords']")
    if meta_keywords and meta_keywords.get("content"):
        tags.extend(
            [
                part.strip()
                for part in str(meta_keywords.get("content", "")).split(",")
                if part.strip()
            ]
        )
    for node in soup.select("[class*='tag'], [data-tag], .product-tag"):
        text = _normalize_text(node.get_text(" ", strip=True))
        if text and len(text) <= 32:
            tags.append(text)
        if len(tags) >= 12:
            break
    deduped: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(tag)
    return deduped[:12]


def _extract_price_from_page(soup: BeautifulSoup) -> float | None:
    selectors = (
        "meta[property='product:price:amount']",
        "meta[itemprop='price']",
        "[itemprop='price']",
        ".price",
        "[class*='price']",
    )
    for selector in selectors:
        for node in soup.select(selector):
            if node.name == "meta":
                value = str(node.get("content", ""))
            else:
                value = node.get("content") or node.get_text(" ", strip=True)
            price = _extract_price(str(value))
            if price is not None:
                return price
    return None


def _extract_product_from_page(url: str, html: str) -> Product | None:
    soup = BeautifulSoup(html, "html.parser")
    name = _extract_primary_text(soup)
    if not name:
        return None
    description = ""
    for selector in (
        "meta[name='description']",
        "[class*='description']",
        "[id*='description']",
    ):
        node = soup.select_one(selector)
        if not node:
            continue
        if node.name == "meta":
            description = _normalize_text(node.get("content", ""))
        else:
            description = _normalize_text(node.get_text(" ", strip=True))
        if description:
            break
    category = _extract_category(soup)
    price = _extract_price_from_page(soup)
    tags = _extract_tags(soup)
    image_alt = _extract_image_alt(soup)
    return Product(
        name=name[:180],
        description=description[:800],
        category=category[:120],
        price=price,
        tags=tags,
        image_alt=image_alt,
    )


def _find_about_page(base_url: str, soup: BeautifulSoup) -> str:
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href", "")).strip()
        if not href:
            continue
        absolute = urljoin(base_url, href)
        lowered = absolute.lower()
        if any(path in lowered for path in ABOUT_PATH_HINTS) and _same_domain(base_url, absolute):
            return absolute
    return ""


def _extract_social_proof(soup: BeautifulSoup) -> str:
    text = soup.get_text(" ", strip=True).lower()
    phrases = []
    for marker in (
        "trusted by",
        "reviews",
        "rating",
        "customers",
        "testimonials",
    ):
        index = text.find(marker)
        if index == -1:
            continue
        snippet = text[max(0, index - 30) : index + 90]
        phrases.append(_normalize_text(snippet))
    return " | ".join(phrases)[:220]


def _extract_positioning(home_soup: BeautifulSoup, about_html: str) -> str:
    title = _normalize_text(home_soup.title.text if home_soup.title and home_soup.title.text else "")
    h1 = _normalize_text(home_soup.h1.get_text(" ", strip=True) if home_soup.h1 else "")
    meta = home_soup.find("meta", attrs={"name": "description"})
    meta_description = _normalize_text(meta.get("content", "")) if meta else ""
    social_proof = _extract_social_proof(home_soup)

    about_excerpt = ""
    if about_html:
        about_soup = BeautifulSoup(about_html, "html.parser")
        paragraphs = about_soup.find_all("p")
        chunks = [
            _normalize_text(item.get_text(" ", strip=True))
            for item in paragraphs[:4]
            if _normalize_text(item.get_text(" ", strip=True))
        ]
        about_excerpt = " ".join(chunks)[:280]

    parts = [part for part in [title, h1, meta_description, about_excerpt, social_proof] if part]
    return " | ".join(parts)[:420]


def discover_store(url: str, max_products: int = 50) -> StoreProfile:
    home_html = _safe_get(url)
    home_soup = BeautifulSoup(home_html, "html.parser")

    platform = _detect_platform(home_html)
    language = _extract_language(home_soup)
    market = _detect_market(url)

    about_url = _find_about_page(url, home_soup)
    about_html = _try_get(about_url) if about_url else ""
    positioning = _extract_positioning(home_soup, about_html)

    products: list[Product] = []
    seen_names: set[str] = set()

    for item in _extract_products_from_jsonld(home_soup):
        key = item.name.lower()
        if key in seen_names:
            continue
        seen_names.add(key)
        products.append(item)
        if len(products) >= max_products:
            break

    if len(products) < max_products:
        product_links = _collect_product_links(
            url,
            home_soup,
            limit=min(max_products * 2, MAX_PRODUCT_PAGE_CRAWLS),
        )
        for link in product_links:
            if len(products) >= max_products:
                break
            page_html = _try_get(link)
            if not page_html:
                continue
            item = _extract_product_from_page(link, page_html)
            if not item:
                continue
            key = item.name.lower()
            if key in seen_names:
                continue
            seen_names.add(key)
            products.append(item)

    if not products:
        fallback_title = (
            home_soup.title.get_text(strip=True)
            if home_soup.title
            else "Store Product"
        )
        products = [
            Product(
                name=fallback_title,
                description="Auto-generated fallback product from homepage title.",
                category="general",
            )
        ]
    else:
        filtered = [
            item
            for item in products
            if _normalize_key(item.name) not in GENERIC_PRODUCT_NAMES
        ]
        if filtered:
            products = filtered

    return StoreProfile(
        url=url,
        platform=platform,
        language=language,
        market=market,
        positioning=positioning,
        products=products[:max_products],
    )
