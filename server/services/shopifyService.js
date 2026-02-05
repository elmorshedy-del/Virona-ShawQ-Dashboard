import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { createOrderNotifications } from './notificationService.js';
import {
  getLatestShopifyAccessToken,
  getShopifyAccessToken,
  getShopifyTokenRecord,
  listShopifyAccessTokens
} from './shopifyAuthService.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import {
  classifyNonRevenueLineItem,
  classifyNonRevenueOrder,
  resolveNonRevenueKeywords
} from './orderExclusionService.js';

function normalizeShopDomain(shop) {
  if (!shop || typeof shop !== 'string') return null;
  const trimmed = shop.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function sanitizeStoreKey(value, fallback = 'shawq') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function parseStoreAliasMap() {
  const raw = process.env.SHOPIFY_STORE_ALIAS_MAP;
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed)
      .map(([shop, store]) => [normalizeShopDomain(shop), sanitizeStoreKey(store, '')])
      .filter(([shop, store]) => shop && store);
    return Object.fromEntries(entries);
  } catch (error) {
    return {};
  }
}

function resolveStoreKeyForShop(shopifyStore, aliasMap = {}) {
  const normalizedShop = normalizeShopDomain(shopifyStore);
  if (!normalizedShop) {
    return sanitizeStoreKey(process.env.SHOPIFY_DEFAULT_STORE_KEY || process.env.SHAWQ_STORE_KEY || 'shawq');
  }

  if (aliasMap[normalizedShop]) {
    return sanitizeStoreKey(aliasMap[normalizedShop]);
  }

  const envStore = normalizeShopDomain(process.env.SHAWQ_SHOPIFY_STORE);
  if (envStore && envStore === normalizedShop) {
    return sanitizeStoreKey(process.env.SHAWQ_STORE_KEY || 'shawq');
  }

  const defaultKey = normalizedShop.replace(/\.myshopify\.com$/i, '');
  return sanitizeStoreKey(defaultKey, 'shopify_store');
}

function getAllShopifyCredentials() {
  const envStore = normalizeShopDomain(process.env.SHAWQ_SHOPIFY_STORE);
  const envToken = process.env.SHAWQ_SHOPIFY_ACCESS_TOKEN;
  const aliasMap = parseStoreAliasMap();
  const credentialsByShop = new Map();

  const upsertCredential = ({ shopifyStore, accessToken, source }) => {
    const normalizedShop = normalizeShopDomain(shopifyStore);
    if (!normalizedShop || !accessToken) return;

    const next = {
      shopifyStore: normalizedShop,
      accessToken,
      source,
      analyticsStore: resolveStoreKeyForShop(normalizedShop, aliasMap)
    };

    const current = credentialsByShop.get(normalizedShop);
    if (!current || current.source !== 'env') {
      credentialsByShop.set(normalizedShop, next);
    }
  };

  if (envStore && envToken) {
    upsertCredential({ shopifyStore: envStore, accessToken: envToken, source: 'env' });
  }

  if (envStore && !envToken) {
    const oauthToken = getShopifyAccessToken(envStore);
    if (oauthToken) {
      upsertCredential({ shopifyStore: envStore, accessToken: oauthToken, source: 'oauth' });
    }
  }

  listShopifyAccessTokens().forEach((row) => {
    upsertCredential({ shopifyStore: row.shop, accessToken: row.token, source: 'oauth' });
  });

  if (credentialsByShop.size === 0) {
    const latest = getLatestShopifyAccessToken();
    if (latest?.shop && latest?.token) {
      upsertCredential({ shopifyStore: latest.shop, accessToken: latest.token, source: 'oauth' });
    }
  }

  return Array.from(credentialsByShop.values()).sort((a, b) => {
    if (a.source === b.source) return a.shopifyStore.localeCompare(b.shopifyStore);
    return a.source === 'env' ? -1 : 1;
  });
}

function getPrimaryShopifyCredential() {
  const all = getAllShopifyCredentials();
  if (all.length) return all[0];

  const fallbackStore = normalizeShopDomain(process.env.SHAWQ_SHOPIFY_STORE);
  return {
    shopifyStore: fallbackStore || null,
    accessToken: process.env.SHAWQ_SHOPIFY_ACCESS_TOKEN || null,
    source: 'missing',
    analyticsStore: resolveStoreKeyForShop(fallbackStore)
  };
}

function getShopifyCredentials() {
  return getPrimaryShopifyCredential();
}

export function isShopifyConfigured() {
  return getAllShopifyCredentials().length > 0;
}

function getShopifyHeaders(accessToken) {
  return {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json'
  };
}

function extractProductImageUrl(product) {
  if (!product) return null;
  if (product.image?.src) return product.image.src;
  if (product.image?.url) return product.image.url;
  if (Array.isArray(product.images) && product.images.length > 0) {
    return product.images[0]?.src || product.images[0]?.url || null;
  }
  return null;
}

async function fetchShopifyProductSnapshot(productId, credentials) {
  const { shopifyStore, accessToken } = credentials || {};
  if (!shopifyStore || !accessToken || !productId) return null;

  const url = `https://${shopifyStore}/admin/api/2024-01/products/${productId}.json?fields=id,title,image,images`;
  const response = await fetch(url, { headers: getShopifyHeaders(accessToken) });

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  const product = json?.product;
  if (!product?.id) return null;

  return {
    product_id: String(product.id),
    title: product.title || null,
    image_url: extractProductImageUrl(product)
  };
}

function getProductCacheRows(db, store, productIds = []) {
  if (!productIds.length) return [];
  const placeholders = productIds.map(() => '?').join(', ');
  return db
    .prepare(`
      SELECT product_id, title, image_url, updated_at
      FROM shopify_products_cache
      WHERE store = ? AND product_id IN (${placeholders})
    `)
    .all(store, ...productIds);
}

function upsertProductCacheRows(db, store, rows = []) {
  if (!rows.length) return;

  const stmt = db.prepare(`
    INSERT INTO shopify_products_cache (store, product_id, title, image_url, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(store, product_id) DO UPDATE SET
      title = COALESCE(excluded.title, shopify_products_cache.title),
      image_url = COALESCE(excluded.image_url, shopify_products_cache.image_url),
      updated_at = excluded.updated_at
  `);

  const tx = db.transaction((items) => {
    items.forEach((item) => {
      stmt.run(store, item.product_id, item.title || null, item.image_url || null);
    });
  });

  tx(rows);
}

export function getShopifyProductCacheMap(store = 'shawq', productIds = []) {
  const ids = Array.from(new Set((productIds || []).map((id) => (id != null ? String(id) : null)).filter(Boolean)));
  if (!ids.length) return new Map();

  const db = getDb();
  const rows = getProductCacheRows(db, store, ids);
  return new Map(rows.map((row) => [String(row.product_id), { title: row.title || null, image_url: row.image_url || null }]));
}

export async function ensureShopifyProductsCached(store = 'shawq', productIds = []) {
  const ids = Array.from(new Set((productIds || []).map((id) => (id != null ? String(id) : null)).filter(Boolean)));
  if (!ids.length) return new Map();

  const db = getDb();
  const existingRows = getProductCacheRows(db, store, ids);
  const existingMap = new Map(existingRows.map((row) => [String(row.product_id), row]));

  const staleHours = parseInt(process.env.SHOPIFY_PRODUCT_CACHE_STALE_HOURS || '168', 10);
  const staleCutoffMs = Date.now() - Math.max(staleHours, 1) * 60 * 60 * 1000;

  const missingOrStale = ids.filter((id) => {
    const row = existingMap.get(id);
    if (!row) return true;
    const updatedAtMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const stale = !updatedAtMs || Number.isNaN(updatedAtMs) || updatedAtMs < staleCutoffMs;
    const empty = !row.title && !row.image_url;
    return stale || empty;
  });

  if (missingOrStale.length) {
    const credentials = getShopifyCredentials();
    if (credentials.shopifyStore && credentials.accessToken) {
      const fetchLimit = parseInt(process.env.SHOPIFY_PRODUCT_CACHE_FETCH_LIMIT || '60', 10);
      const toFetch = missingOrStale.slice(0, Math.max(fetchLimit, 1));
      const fetchedRows = [];

      for (const productId of toFetch) {
        try {
          const snapshot = await fetchShopifyProductSnapshot(productId, credentials);
          if (snapshot) fetchedRows.push(snapshot);
        } catch (error) {
          console.warn(`[Shopify] Product cache fetch failed for ${productId}: ${error.message}`);
        }
      }

      if (fetchedRows.length) {
        upsertProductCacheRows(db, store, fetchedRows);
      }
    }
  }

  return getShopifyProductCacheMap(store, ids);
}

const ATTRIBUTION_KEY_PREFIXES = ['utm_', 'fb', 'landing_page', 'referrer', 'consent'];

function isAttributionKey(key) {
  if (!key) return false;
  const normalized = key.toLowerCase();
  if (normalized === 'consent') return true;
  return ATTRIBUTION_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function extractAttributionAttributes(noteAttributes = []) {
  const attributes = {};
  if (!Array.isArray(noteAttributes)) return attributes;

  noteAttributes.forEach((entry) => {
    if (!entry) return;
    const name = typeof entry.name === 'string' ? entry.name : (typeof entry.key === 'string' ? entry.key : null);
    const value = entry.value != null ? entry.value : (entry.val != null ? entry.val : (Array.isArray(entry) ? entry[1] : null));
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || !isAttributionKey(trimmed)) return;
    if (value == null || value == '') return;
    attributes[trimmed.toLowerCase()] = String(value);
  });

  return attributes;
}

export async function fetchShopifyOrders(dateStart, dateEnd) {
  const { shopifyStore, accessToken } = getShopifyCredentials();
  const exclusionKeywords = resolveNonRevenueKeywords({ account: shopifyStore, store: shopifyStore });
  const exclusionOptions = { keywords: exclusionKeywords };

  if (!shopifyStore || !accessToken) {
    console.log('Shopify credentials not configured for Shawq - returning empty array (no demo data)');
    return [];
  }

  try {
    const orders = [];
    let url = `https://${shopifyStore}/admin/api/2024-01/orders.json?status=any&created_at_min=${dateStart}T00:00:00Z&created_at_max=${dateEnd}T23:59:59Z&limit=250`;

    while (url) {
      const response = await fetch(url, {
        headers: getShopifyHeaders(accessToken)
      });

      const data = await response.json();

      if (data.orders) {
        for (const order of data.orders) {
          const countryCode =
            order.shipping_address?.country_code ||
            order.billing_address?.country_code ||
            'US';

          const createdAtIso =
            typeof order.created_at === 'string' ? order.created_at : null;
          const createdAtDate = createdAtIso ? new Date(createdAtIso) : null;

          const createdAtUtc =
            createdAtDate && !isNaN(createdAtDate.getTime())
              ? createdAtDate.toISOString()
              : null;

          const dateGmt3 =
            createdAtDate && !isNaN(createdAtDate.getTime())
              ? formatDateAsGmt3(createdAtDate)
              : (createdAtIso?.split('T')[0] || null);

          const attribution = extractAttributionAttributes(order.note_attributes);
          const attributionJson = Object.keys(attribution).length ? JSON.stringify(attribution) : null;
          const customerId = order.customer?.id ? order.customer.id.toString() : null;
          const customerEmail = order.customer?.email || order.email || null;
          const lineItems = Array.isArray(order.line_items)
            ? order.line_items.map((item) => ({
                line_item_id: item.id ? item.id.toString() : null,
                product_id: item.product_id ? item.product_id.toString() : null,
                variant_id: item.variant_id ? item.variant_id.toString() : null,
                sku: item.sku || null,
                title: item.title || item.name || null,
                quantity: item.quantity || 1,
                price: parseFloat(item.price) || 0,
                discount: parseFloat(item.total_discount) || 0
              }))
            : [];

          const lineClassifications = lineItems.map((item) => classifyNonRevenueLineItem(item, exclusionOptions));
          const orderClassification = classifyNonRevenueOrder(
            {
              order_total: parseFloat(order.total_price) || 0,
              subtotal: parseFloat(order.subtotal_price) || 0,
              tags: order.tags || '',
              note: order.note || ''
            },
            lineClassifications,
            exclusionOptions
          );

          orders.push({
            order_id: order.id.toString(),
            date: dateGmt3,
            country: getCountryName(countryCode),
            country_code: countryCode,
            city: order.shipping_address?.city || order.billing_address?.city || null,
            state: order.shipping_address?.province || order.billing_address?.province || null,
            order_total: parseFloat(order.total_price) || 0,
            subtotal: parseFloat(order.subtotal_price) || 0,
            shipping: parseFloat(order.total_shipping_price_set?.shop_money?.amount) || 0,
            tax: parseFloat(order.total_tax) || 0,
            discount: parseFloat(order.total_discounts) || 0,
            items_count: order.line_items?.length || 1,
            status: order.fulfillment_status || 'unfulfilled',
            financial_status: order.financial_status || 'pending',
            fulfillment_status: order.fulfillment_status || null,
            payment_method: order.payment_gateway_names?.[0] || 'unknown',
            currency: order.currency || 'USD',
            order_created_at: createdAtUtc,
            attribution_json: attributionJson,
            customer_id: customerId,
            customer_email: customerEmail,
            line_items: lineItems,
            is_excluded: orderClassification.exclude,
            exclusion_reason: orderClassification.reason,
            createdAtUtcMs: createdAtUtc ? createdAtDate.getTime() : null
          });
        }
      }

      // Handle pagination via Link header
      const linkHeader = response.headers.get('Link');
      url = null;

      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (nextMatch) {
          url = nextMatch[1];
        }
      }
    }

    return orders;
  } catch (error) {
    console.error('Shopify API error:', error);
    throw error;
  }
}

export async function syncShopifyOrders() {
  const db = getDb();
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );

  if (!isShopifyConfigured()) {
    db.prepare(`
      INSERT INTO sync_log (store, source, status, error_message)
      VALUES ('shawq', 'shopify', 'error', 'Missing Shopify credentials for Shawq')
    `).run();

    return {
      success: false,
      records: 0,
      message: 'Missing Shopify credentials for Shawq'
    };
  }

  try {
    const orders = await fetchShopifyOrders(startDate, endDate);
    const { shopifyStore } = getShopifyCredentials();
    const exclusionKeywords = resolveNonRevenueKeywords({ account: shopifyStore, store: shopifyStore });
    const exclusionOptions = { keywords: exclusionKeywords };

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO shopify_orders
      (store, order_id, date, country, country_code, city, state, order_total, subtotal, shipping, tax, discount,
       items_count, status, financial_status, fulfillment_status, payment_method, currency, order_created_at, attribution_json, customer_id, customer_email,
       is_excluded, exclusion_reason)
      VALUES ('shawq', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteItemsStmt = db.prepare(`
      DELETE FROM shopify_order_items
      WHERE store = 'shawq' AND order_id = ?
    `);

    const insertItemStmt = db.prepare(`
      INSERT OR REPLACE INTO shopify_order_items
      (store, order_id, line_item_id, product_id, variant_id, sku, title, image_url, quantity, price, discount, net_price, is_excluded, exclusion_reason)
      VALUES ('shawq', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const productIds = Array.from(new Set(orders
      .flatMap((order) => (Array.isArray(order.line_items) ? order.line_items : []))
      .map((item) => item.product_id)
      .filter(Boolean)
      .map((id) => String(id))
    ));

    const productCacheMap = await ensureShopifyProductsCached('shawq', productIds);

    let recordsInserted = 0;

    const insertOrders = db.transaction((ordersToInsert) => {
      for (const order of ordersToInsert) {
        insertStmt.run(
          order.order_id,
          order.date,
          order.country,
          order.country_code,
          order.city,
          order.state,
          order.order_total,
          order.subtotal,
          order.shipping,
          order.tax,
          order.discount,
          order.items_count,
          order.status,
          order.financial_status,
          order.fulfillment_status,
          order.payment_method,
          order.currency,
          order.order_created_at,
          order.attribution_json,
          order.customer_id,
          order.customer_email,
          order.is_excluded ? 1 : 0,
          order.exclusion_reason || null
        );

        deleteItemsStmt.run(order.order_id);

        if (Array.isArray(order.line_items)) {
          for (const item of order.line_items) {
            const productCache = item.product_id ? productCacheMap.get(String(item.product_id)) : null;
            const itemTitle = item.title || productCache?.title || null;
            const itemImageUrl = productCache?.image_url || null;
            const classification = classifyNonRevenueLineItem({
              ...item,
              title: itemTitle
            }, exclusionOptions);

            insertItemStmt.run(
              order.order_id,
              item.line_item_id,
              item.product_id,
              item.variant_id,
              item.sku,
              itemTitle,
              itemImageUrl,
              item.quantity,
              item.price,
              item.discount,
              classification.net,
              classification.exclude ? 1 : 0,
              classification.reason
            );
          }
        }

        recordsInserted++;
      }
    });

    insertOrders(orders);

    db.prepare(`
      INSERT INTO sync_log (store, source, status, records_synced)
      VALUES ('shawq', 'shopify', 'success', ?)
    `).run(recordsInserted);

    const notificationCount = createOrderNotifications('shawq', 'shopify', orders);
    console.log(`[Shopify] Created ${notificationCount} notifications`);

    return { success: true, records: recordsInserted };
  } catch (error) {
    db.prepare(`
      INSERT INTO sync_log (store, source, status, error_message)
      VALUES ('shawq', 'shopify', 'error', ?)
    `).run(error.message);

    throw error;
  }
}

export function getShopifyConnectionStatus() {
  const db = getDb();
  const { shopifyStore, accessToken, source } = getShopifyCredentials();
  const configured = Boolean(shopifyStore && accessToken);

  const lastSync = db
    .prepare(
      `SELECT status, records_synced, error_message, created_at
       FROM sync_log
       WHERE store = 'shawq' AND source = 'shopify'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get();

  const latestOrder = db
    .prepare(
      `SELECT order_id, order_created_at, date, created_at
       FROM shopify_orders
       WHERE store = 'shawq'
       ORDER BY (order_created_at IS NULL), order_created_at DESC, created_at DESC
       LIMIT 1`
    )
    .get();

  const totalOrders = db
    .prepare(`SELECT COUNT(*) as count FROM shopify_orders WHERE store = 'shawq'`)
    .get()?.count || 0;

  const oauthRecord = shopifyStore ? getShopifyTokenRecord(shopifyStore) : null;

  return {
    configured,
    storeDomain: shopifyStore || oauthRecord?.shop || null,
    authSource: source || (accessToken ? 'oauth' : 'missing'),
    lastSync: lastSync || null,
    latestOrder: latestOrder || null,
    totalOrders,
    lastSyncStatus: lastSync?.status || null,
    lastSyncError: lastSync?.error_message || null,
    lastSyncRecords: lastSync?.records_synced || 0
  };
}

function getCountryName(code) {
  const countries = {
    'US': 'United States',
    'GB': 'United Kingdom',
    'CA': 'Canada',
    'DE': 'Germany',
    'NL': 'Netherlands',
    'FR': 'France',
    'AU': 'Australia',
    'IT': 'Italy',
    'ES': 'Spain',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'BE': 'Belgium',
    'CH': 'Switzerland',
    'AT': 'Austria',
    'IE': 'Ireland',
    'NZ': 'New Zealand'
  };

  return countries[code] || code;
}

// Demo data removed - only real Shopify API data is used
