import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { createOrderNotifications } from './notificationService.js';
import { getLatestShopifyAccessToken, getShopifyAccessToken, getShopifyTokenRecord } from './shopifyAuthService.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

function getShopifyCredentials() {
  const envStore = process.env.SHAWQ_SHOPIFY_STORE;
  const envToken = process.env.SHAWQ_SHOPIFY_ACCESS_TOKEN;

  if (envStore && envToken) {
    return { shopifyStore: envStore, accessToken: envToken, source: 'env' };
  }

  if (envStore) {
    const oauthToken = getShopifyAccessToken(envStore);
    if (oauthToken) {
      return { shopifyStore: envStore, accessToken: oauthToken, source: 'oauth' };
    }
  }

  const latest = getLatestShopifyAccessToken();
  if (latest?.token) {
    return { shopifyStore: latest.shop, accessToken: latest.token, source: 'oauth' };
  }

  return { shopifyStore: envStore || null, accessToken: envToken || null, source: 'missing' };
}

export function isShopifyConfigured() {
  const { shopifyStore, accessToken } = getShopifyCredentials();
  return Boolean(shopifyStore && accessToken);
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

  if (!shopifyStore || !accessToken) {
    console.log('Shopify credentials not configured for Shawq - returning empty array (no demo data)');
    return [];
  }

  try {
    const orders = [];
    let url = `https://${shopifyStore}/admin/api/2024-01/orders.json?status=any&created_at_min=${dateStart}T00:00:00Z&created_at_max=${dateEnd}T23:59:59Z&limit=250`;

    while (url) {
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
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

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO shopify_orders
      (store, order_id, date, country, country_code, city, state, order_total, subtotal, shipping, tax, discount,
       items_count, status, financial_status, fulfillment_status, payment_method, currency, order_created_at, attribution_json, customer_id, customer_email)
      VALUES ('shawq', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteItemsStmt = db.prepare(`
      DELETE FROM shopify_order_items
      WHERE store = 'shawq' AND order_id = ?
    `);

    const insertItemStmt = db.prepare(`
      INSERT OR REPLACE INTO shopify_order_items
      (store, order_id, line_item_id, product_id, variant_id, sku, title, quantity, price, discount)
      VALUES ('shawq', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

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
          order.customer_email
        );

        deleteItemsStmt.run(order.order_id);

        if (Array.isArray(order.line_items)) {
          for (const item of order.line_items) {
            insertItemStmt.run(
              order.order_id,
              item.line_item_id,
              item.product_id,
              item.variant_id,
              item.sku,
              item.title,
              item.quantity,
              item.price,
              item.discount
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
