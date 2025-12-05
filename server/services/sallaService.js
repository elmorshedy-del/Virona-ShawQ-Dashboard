import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { formatLocalDate } from '../utils/dateUtils.js';

export async function fetchSallaOrders(dateStart, dateEnd) {
  const accessToken = process.env.VIRONAX_SALLA_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('Salla credentials not configured - using demo data');
    return getDemoSallaOrders(dateStart, dateEnd);
  }

  try {
    const orders = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(`https://api.salla.dev/admin/v2/orders?page=${page}&per_page=50`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (data.data && data.data.length > 0) {
        for (const order of data.data) {
          const orderDate = order.date?.date?.split(' ')[0] || order.created_at?.split('T')[0];
          
          if (orderDate >= dateStart && orderDate <= dateEnd) {
            orders.push({
              order_id: order.id.toString(),
              date: orderDate,
              country: order.shipping?.country?.name || 'Saudi Arabia',
              country_code: order.shipping?.country?.code || 'SA',
              city: order.shipping?.city?.name || order.shipping?.address?.city || null,
              order_total: parseFloat(order.amounts?.total?.amount) || 0,
              subtotal: parseFloat(order.amounts?.sub_total?.amount) || 0,
              shipping: parseFloat(order.amounts?.shipping_cost?.amount) || 0,
              tax: parseFloat(order.amounts?.tax?.amount) || 0,
              discount: parseFloat(order.amounts?.discount?.amount) || 0,
              items_count: order.items?.length || 1,
              status: order.status?.name || 'completed',
              payment_method: order.payment_method || 'unknown',
              currency: order.currency || 'SAR'
            });
          }
        }

        hasMore = data.pagination?.current_page < data.pagination?.total_pages;
        page++;
      } else {
        hasMore = false;
      }
    }

    return orders;
  } catch (error) {
    console.error('Salla API error:', error);
    throw error;
  }
}

export async function syncSallaOrders() {
  const db = getDb();
  const endDate = formatLocalDate(new Date());
  const startDate = formatLocalDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  try {
    const orders = await fetchSallaOrders(startDate, endDate);

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO salla_orders
      (store, order_id, date, country, country_code, city, order_total, subtotal, shipping, tax, discount, items_count, status, payment_method, currency)
      VALUES ('vironax', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let recordsInserted = 0;
    for (const order of orders) {
      insertStmt.run(
        order.order_id,
        order.date,
        order.country,
        order.country_code,
        order.city,
        order.order_total,
        order.subtotal,
        order.shipping,
        order.tax,
        order.discount,
        order.items_count,
        order.status,
        order.payment_method,
        order.currency
      );
      recordsInserted++;
    }

    db.prepare(`
      INSERT INTO sync_log (store, source, status, records_synced)
      VALUES ('vironax', 'salla', 'success', ?)
    `).run(recordsInserted);

    return { success: true, records: recordsInserted };
  } catch (error) {
    db.prepare(`
      INSERT INTO sync_log (store, source, status, error_message)
      VALUES ('vironax', 'salla', 'error', ?)
    `).run(error.message);

    throw error;
  }
}

// Demo data for Salla (GCC markets)
function getDemoSallaOrders(dateStart, dateEnd) {
  const countries = [
    { name: 'Saudi Arabia', code: 'SA', share: 0.50, avgOrder: 320 },
    { name: 'United Arab Emirates', code: 'AE', share: 0.25, avgOrder: 380 },
    { name: 'Kuwait', code: 'KW', share: 0.12, avgOrder: 350 },
    { name: 'Qatar', code: 'QA', share: 0.08, avgOrder: 400 },
    { name: 'Oman', code: 'OM', share: 0.05, avgOrder: 290 }
  ];

  const orders = [];
  const start = new Date(dateStart);
  const end = new Date(dateEnd);
  let orderId = 100000;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = formatLocalDate(d);
    const dayOfWeek = d.getDay();
    const baseOrders = dayOfWeek === 5 || dayOfWeek === 6 ? 28 : 22; // More on weekends
    const dailyOrders = Math.floor(baseOrders * (0.85 + Math.random() * 0.3));

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

      const variance = 0.7 + Math.random() * 0.6;
      const orderTotal = selectedCountry.avgOrder * variance;
      const shipping = Math.random() > 0.7 ? 25 : 0;

      orders.push({
        order_id: (orderId++).toString(),
        date: dateStr,
        country: selectedCountry.name,
        country_code: selectedCountry.code,
        city: null,
        order_total: orderTotal,
        subtotal: orderTotal - shipping,
        shipping: shipping,
        tax: orderTotal * 0.15,
        discount: Math.random() > 0.8 ? orderTotal * 0.1 : 0,
        items_count: Math.floor(1 + Math.random() * 2),
        status: 'completed',
        payment_method: Math.random() > 0.3 ? 'credit_card' : 'cod',
        currency: 'SAR'
      });
    }
  }

  return orders;
}
