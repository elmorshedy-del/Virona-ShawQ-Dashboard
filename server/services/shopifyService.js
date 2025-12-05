import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { formatLocalDate } from '../utils/dateUtils.js';

export async function fetchShopifyOrders(dateStart, dateEnd) {
  const shopifyStore = process.env.SHAWQ_SHOPIFY_STORE;
  const accessToken = process.env.SHAWQ_SHOPIFY_ACCESS_TOKEN;

  if (!shopifyStore || !accessToken) {
    console.log('Shopify credentials not configured for Shawq - using demo data');
    return getDemoShopifyOrders(dateStart, dateEnd);
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
          const countryCode = order.shipping_address?.country_code || 
                             order.billing_address?.country_code || 'US';
          
          const createdAtIso = typeof order.created_at === 'string' ? order.created_at : null;
          const createdAtDate = createdAtIso ? new Date(createdAtIso) : null;
          const createdAtUtc = createdAtDate && !isNaN(createdAtDate.getTime())
            ? createdAtDate.toISOString()
            : null;

          orders.push({
            order_id: order.id.toString(),
            date: createdAtUtc ? createdAtUtc.split('T')[0] : (createdAtIso?.split('T')[0] || null),
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
  const endDate = formatLocalDate(new Date());
  const startDate = formatLocalDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  try {
    const orders = await fetchShopifyOrders(startDate, endDate);

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO shopify_orders
      (store, order_id, date, country, country_code, city, state, order_total, subtotal, shipping, tax, discount,
       items_count, status, financial_status, fulfillment_status, payment_method, currency, order_created_at)
      VALUES ('shawq', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        order.order_created_at
      );
      recordsInserted++;
    }

    db.prepare(`
      INSERT INTO sync_log (store, source, status, records_synced)
      VALUES ('shawq', 'shopify', 'success', ?)
    `).run(recordsInserted);

    return { success: true, records: recordsInserted };
  } catch (error) {
    db.prepare(`
      INSERT INTO sync_log (store, source, status, error_message)
      VALUES ('shawq', 'shopify', 'error', ?)
    `).run(error.message);

    throw error;
  }
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

// Demo data for Shopify (Western markets)
function getDemoShopifyOrders(dateStart, dateEnd) {
  const countries = [
    { name: 'United States', code: 'US', share: 0.40, avgOrder: 85 },
    { name: 'United Kingdom', code: 'GB', share: 0.20, avgOrder: 75 },
    { name: 'Canada', code: 'CA', share: 0.15, avgOrder: 80 },
    { name: 'Germany', code: 'DE', share: 0.10, avgOrder: 70 },
    { name: 'Netherlands', code: 'NL', share: 0.05, avgOrder: 65 },
    { name: 'France', code: 'FR', share: 0.05, avgOrder: 72 },
    { name: 'Australia', code: 'AU', share: 0.05, avgOrder: 78 }
  ];

  const orders = [];
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  let orderId = 500000;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = formatLocalDate(d);
    const dayOfWeek = d.getDay();
    const baseOrders = dayOfWeek === 0 || dayOfWeek === 6 ? 22 : 18;
    const dailyOrders = Math.floor(baseOrders * (0.8 + Math.random() * 0.4));

    for (let i = 0; i < dailyOrders; i++) {
      const rand = Math.random();
      let cumShare = 0;
      let selectedCountry = countries[0];

      for (const country of countries) {
        cumShare += country.share;
        if (rand < cumShare) {
          selectedCountry = country;
          break;
        }
      }

      const variance = 0.6 + Math.random() * 0.8;
      const orderTotal = selectedCountry.avgOrder * variance;
      // US gets free shipping over $75
      const shipping = selectedCountry.code === 'US' && orderTotal > 75 ? 0 :
                      selectedCountry.code === 'US' ? 8 : 15;
      const hour = Math.floor(Math.random() * 24).toString().padStart(2, '0');
      const minute = Math.floor(Math.random() * 60).toString().padStart(2, '0');
      const orderCreatedAt = `${dateStr}T${hour}:${minute}:00Z`;

      orders.push({
        order_id: (orderId++).toString(),
        date: dateStr,
        country: selectedCountry.name,
        country_code: selectedCountry.code,
        city: null,
        state: null,
        order_total: orderTotal + shipping,
        subtotal: orderTotal,
        shipping: shipping,
        tax: selectedCountry.code === 'US' ? 0 : orderTotal * 0.2,
        discount: Math.random() > 0.85 ? orderTotal * 0.15 : 0,
        items_count: Math.floor(1 + Math.random() * 3),
        status: Math.random() > 0.1 ? 'fulfilled' : 'unfulfilled',
        financial_status: 'paid',
        fulfillment_status: Math.random() > 0.1 ? 'fulfilled' : null,
        payment_method: Math.random() > 0.4 ? 'shopify_payments' : 'paypal',
        currency: 'USD',
        order_created_at: orderCreatedAt
      });
    }
  }

  return orders;
}
