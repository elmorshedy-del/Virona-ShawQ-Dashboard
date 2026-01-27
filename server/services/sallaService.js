import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

export async function fetchSallaOrders(dateStart, dateEnd) {
  const accessToken = process.env.VIRONAX_SALLA_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('Salla credentials not configured - returning empty (no demo data)');
    return []; // Return empty array instead of demo data
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
            const lineItems = Array.isArray(order.items) ? order.items.map((item) => ({
              product_id: item.product_id != null ? item.product_id.toString() : null,
              variant_id: item.variant_id != null ? item.variant_id.toString() : null,
              sku: item.sku || item.product_sku || null,
              name: item.name || item.product_name || item.title || null,
              quantity: item.quantity || 1,
              price: parseFloat(item.price || item.amount?.amount || item.total?.amount || 0) || 0,
              currency: order.currency || 'SAR'
            })) : [];

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
              currency: order.currency || 'SAR',
              line_items: lineItems
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
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  try {
    const orders = await fetchSallaOrders(startDate, endDate);

    // If no orders (API not configured), skip sync silently
    if (orders.length === 0) {
      console.log('Salla: No orders to sync (API not configured or no orders in date range)');
      return { success: true, records: 0, message: 'Salla not configured' };
    }

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO salla_orders
      (store, order_id, date, country, country_code, city, order_total, subtotal, shipping, tax, discount, items_count, status, payment_method, currency)
      VALUES ('vironax', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const itemInsertStmt = db.prepare(`
      INSERT INTO salla_order_items
      (store, order_id, order_date, product_id, variant_id, sku, name, quantity, price, currency)
      VALUES ('vironax', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const itemDeleteStmt = db.prepare(`
      DELETE FROM salla_order_items WHERE store = 'vironax' AND order_id = ?
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

      itemDeleteStmt.run(order.order_id);
      if (Array.isArray(order.line_items)) {
        for (const item of order.line_items) {
          itemInsertStmt.run(
            order.order_id,
            order.date,
            item.product_id,
            item.variant_id,
            item.sku,
            item.name,
            item.quantity,
            item.price,
            item.currency || order.currency
          );
        }
      }

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

// Clear any existing demo data from salla_orders table
export function clearSallaDemoData() {
  const db = getDb();
  try {
    const result = db.prepare(`DELETE FROM salla_orders WHERE store = 'vironax'`).run();
    console.log(`Cleared ${result.changes} Salla orders from database`);
    return { success: true, deleted: result.changes };
  } catch (error) {
    console.error('Failed to clear Salla data:', error);
    return { success: false, error: error.message };
  }
}
