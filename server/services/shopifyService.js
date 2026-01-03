import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { createOrderNotifications } from './notificationService.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

function getShopifyCredentials() {
  return {
    shopifyStore: process.env.SHAWQ_SHOPIFY_STORE,
    accessToken: process.env.SHAWQ_SHOPIFY_ACCESS_TOKEN
  };
}

export function isShopifyConfigured() {
  const { shopifyStore, accessToken } = getShopifyCredentials();
  return Boolean(shopifyStore && accessToken);
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

          const landingSite = order.landing_site || null;
          const referringSite = order.referring_site || null;
          const utmParams = extractUtmParams({
            landingSite,
            referringSite,
            noteAttributes: order.note_attributes || []
          });

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
            createdAtUtcMs: createdAtUtc ? createdAtDate.getTime() : null,
            landing_site: landingSite,
            referring_site: referringSite,
            utm_source: utmParams.utm_source,
            utm_medium: utmParams.utm_medium,
            utm_campaign: utmParams.utm_campaign,
            utm_content: utmParams.utm_content,
            utm_term: utmParams.utm_term
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
       items_count, status, financial_status, fulfillment_status, payment_method, currency, order_created_at,
       landing_site, referring_site, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
      VALUES ('shawq', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let recordsInserted = 0;

    for (const order of orders) {
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
        order.landing_site,
        order.referring_site,
        order.utm_source,
        order.utm_medium,
        order.utm_campaign,
        order.utm_content,
        order.utm_term
      );
      recordsInserted++;
    }

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
  const { shopifyStore, accessToken } = getShopifyCredentials();
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

  return {
    configured,
    storeDomain: shopifyStore || null,
    lastSync: lastSync || null,
    latestOrder: latestOrder || null,
    totalOrders
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

function extractUtmParams({ landingSite, referringSite, noteAttributes }) {
  const params = {
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null
  };

  const mergeParams = (values) => {
    if (!values) return;
    Object.keys(params).forEach((key) => {
      if (!params[key] && values[key]) {
        params[key] = values[key];
      }
    });
  };

  const parseFromUrl = (urlValue) => {
    if (!urlValue || typeof urlValue !== 'string') {
      return null;
    }

    try {
      const parsed = new URL(urlValue, 'https://shopify.local');
      return {
        utm_source: parsed.searchParams.get('utm_source'),
        utm_medium: parsed.searchParams.get('utm_medium'),
        utm_campaign: parsed.searchParams.get('utm_campaign'),
        utm_content: parsed.searchParams.get('utm_content'),
        utm_term: parsed.searchParams.get('utm_term')
      };
    } catch (error) {
      return null;
    }
  };

  mergeParams(parseFromUrl(landingSite));
  mergeParams(parseFromUrl(referringSite));

  if (Array.isArray(noteAttributes) && noteAttributes.length > 0) {
    const noteParams = {};
    noteAttributes.forEach((attr) => {
      if (!attr || typeof attr.name !== 'string') {
        return;
      }
      const key = attr.name.toLowerCase().trim();
      if (key.startsWith('utm_')) {
        noteParams[key] = attr.value;
      }
    });
    mergeParams(noteParams);
  }

  return params;
}

// Demo data removed - only real Shopify API data is used
