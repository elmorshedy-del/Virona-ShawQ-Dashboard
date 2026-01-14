import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { getShopifyConnectionStatus } from './shopifyService.js';

const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';
const MAX_PRODUCTS = 4;

function normalizeUrl(input) {
  if (!input) return null;
  if (input.startsWith('http://') || input.startsWith('https://')) return input;
  return `https://${input}`;
}

function toAbsoluteUrl(baseUrl, maybeRelative) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch (error) {
    return null;
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaContent(html, name) {
  const regex = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  return html.match(regex)?.[1] || null;
}

function extractTitle(html) {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;
}

function extractJsonLd(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const items = [];
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        items.push(...parsed);
      } else {
        items.push(parsed);
      }
    } catch (error) {
      continue;
    }
  }
  return items;
}

function collectProductsFromJsonLd(items) {
  const products = [];
  const urls = new Set();

  const addProduct = (product) => {
    if (!product) return;
    const url = product.url || product.offers?.url || product.offers?.[0]?.url;
    if (url && urls.has(url)) return;
    if (url) urls.add(url);
    products.push({
      name: product.name || null,
      description: product.description || null,
      image: Array.isArray(product.image) ? product.image[0] : product.image || null,
      url: url || null,
      brand: typeof product.brand === 'string' ? product.brand : product.brand?.name || null
    });
  };

  const walk = (item) => {
    if (!item) return;
    if (item['@type'] === 'Product') {
      addProduct(item);
      return;
    }
    if (item['@type'] === 'ItemList' && Array.isArray(item.itemListElement)) {
      item.itemListElement.forEach(entry => {
        const content = entry.item || entry;
        if (content?.['@type'] === 'Product') {
          addProduct(content);
        }
      });
    }
    if (Array.isArray(item['@graph'])) {
      item['@graph'].forEach(node => walk(node));
    }
  };

  items.forEach(item => walk(item));

  return { products, urls };
}

function extractLinks(html, baseUrl, pattern) {
  const links = [];
  const regex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (!href) continue;
    if (pattern && !pattern.test(href)) continue;
    const absolute = toAbsoluteUrl(baseUrl, href);
    if (absolute) links.push(absolute);
  }
  return Array.from(new Set(links));
}

function extractLogo(html, baseUrl) {
  const candidates = [
    html.match(/<link[^>]+rel=["'](?:shortcut icon|icon)["'][^>]*href=["']([^"']+)["']/i)?.[1],
    html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
  ].filter(Boolean);

  if (candidates.length > 0) {
    return toAbsoluteUrl(baseUrl, candidates[0]);
  }

  const logoMatch = html.match(/<img[^>]+(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (logoMatch?.[1]) {
    return toAbsoluteUrl(baseUrl, logoMatch[1]);
  }

  return null;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'VironaCreativeStudioBot/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function callGemini(payload, model = GEMINI_MODEL) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || 'Gemini request failed');
  }
  return data;
}

export function resolveStoreUrl(store) {
  const envKey = `${(store || '').toUpperCase()}_STORE_URL`;
  const envUrl = normalizeUrl(process.env[envKey]);
  if (envUrl) return envUrl;

  if (store === 'shawq') {
    const status = getShopifyConnectionStatus();
    if (status?.storeDomain) {
      return normalizeUrl(status.storeDomain);
    }
  }

  return null;
}

export async function buildStoreProfile(store, storeUrl) {
  const normalizedUrl = normalizeUrl(storeUrl);
  if (!normalizedUrl) {
    throw new Error('Store URL is required.');
  }

  const homepageHtml = await fetchPage(normalizedUrl);
  const title = extractTitle(homepageHtml);
  const description = extractMetaContent(homepageHtml, 'description')
    || extractMetaContent(homepageHtml, 'og:description');
  const logoUrl = extractLogo(homepageHtml, normalizedUrl);
  const jsonLd = extractJsonLd(homepageHtml);
  const { products: homepageProducts, urls: productUrlsFromJsonLd } = collectProductsFromJsonLd(jsonLd);

  const aboutLinks = extractLinks(homepageHtml, normalizedUrl, /about|our-story|brand|mission|story|who-we-are/i);
  let aboutText = null;
  if (aboutLinks.length > 0) {
    try {
      const aboutHtml = await fetchPage(aboutLinks[0]);
      aboutText = stripHtml(aboutHtml).slice(0, 5000);
    } catch (error) {
      aboutText = null;
    }
  }

  const productLinks = Array.from(new Set([
    ...productUrlsFromJsonLd,
    ...extractLinks(homepageHtml, normalizedUrl, /product|products/i)
  ])).slice(0, MAX_PRODUCTS);

  const productDetails = [...homepageProducts];

  for (const link of productLinks) {
    try {
      const productHtml = await fetchPage(link);
      const productJsonLd = extractJsonLd(productHtml);
      const { products } = collectProductsFromJsonLd(productJsonLd);
      products.forEach(product => productDetails.push(product));
    } catch (error) {
      continue;
    }
  }

  const trimmedProducts = productDetails.slice(0, MAX_PRODUCTS).map(product => ({
    name: product.name,
    description: product.description,
    image: product.image,
    url: product.url,
    brand: product.brand
  }));

  const prompt = `You are an expert brand strategist. Summarize the store based on the provided context.
Return JSON with keys:
- summary (1-2 sentences)
- tone (short descriptors)
- languageStyle (e.g. modern, minimal, playful)
- productTypes (array)
- targetAudience (short sentence)
- pricePositioning (e.g. premium, accessible luxury)
- keywords (array of 5-8 phrases)
- keyProducts (array of 3 products with name + short descriptor)

STORE INPUT
Store URL: ${normalizedUrl}
Store title: ${title || ''}
Meta description: ${description || ''}
About text: ${aboutText || ''}
Products: ${JSON.stringify(trimmedProducts)}
`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING' },
          tone: { type: 'STRING' },
          languageStyle: { type: 'STRING' },
          productTypes: { type: 'ARRAY', items: { type: 'STRING' } },
          targetAudience: { type: 'STRING' },
          pricePositioning: { type: 'STRING' },
          keywords: { type: 'ARRAY', items: { type: 'STRING' } },
          keyProducts: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                descriptor: { type: 'STRING' }
              }
            }
          }
        }
      }
    }
  };

  const data = await callGemini(payload);
  const summary = JSON.parse(data.candidates[0].content.parts[0].text);

  return {
    storeUrl: normalizedUrl,
    logoUrl,
    summary,
    source: {
      title,
      description,
      aboutText,
      products: trimmedProducts
    }
  };
}

export async function getOrCreateStoreProfile(store, options = {}) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM store_profiles WHERE store = ?').get(store);
  if (existing?.summary_json) {
    return {
      store: existing.store,
      storeUrl: existing.store_url,
      logoUrl: existing.logo_url,
      summary: JSON.parse(existing.summary_json),
      source: existing.source_json ? JSON.parse(existing.source_json) : null,
      generated: false
    };
  }

  const resolvedUrl = options.storeUrl || existing?.store_url || resolveStoreUrl(store);
  if (!resolvedUrl) {
    return { error: 'Store URL not configured' };
  }

  if (!existing) {
    db.prepare(`
      INSERT INTO store_profiles (store, store_url, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `).run(store, resolvedUrl);
  } else if (!existing.store_url) {
    db.prepare(`UPDATE store_profiles SET store_url = ?, updated_at = datetime('now') WHERE store = ?`).run(resolvedUrl, store);
  }

  const profile = await buildStoreProfile(store, resolvedUrl);

  db.prepare(`
    UPDATE store_profiles
    SET store_url = ?, logo_url = ?, summary_json = ?, source_json = ?, updated_at = datetime('now')
    WHERE store = ?
  `).run(
    profile.storeUrl,
    profile.logoUrl,
    JSON.stringify(profile.summary || {}),
    JSON.stringify(profile.source || {}),
    store
  );

  return {
    store,
    storeUrl: profile.storeUrl,
    logoUrl: profile.logoUrl,
    summary: profile.summary,
    source: profile.source,
    generated: true
  };
}
