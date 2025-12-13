import { getDb } from '../db/database.js';
import { getCountryInfo } from '../utils/countryData.js';

// Check if Salla is active for VironaX
function isSallaActive() {
  return !!process.env.VIRONAX_SALLA_ACCESS_TOKEN;
}

// Determine if we should create a notification for this order
function shouldCreateOrderNotification(store, source) {
  // For Shawq: Only Shopify and Manual orders
  if (store === 'shawq') {
    return source === 'shopify' || source === 'manual';
  }
  
  // For VironaX: Smart source selection
  if (store === 'vironax') {
    const sallaIsActive = isSallaActive();
    
    if (sallaIsActive) {
      // Salla is active → only Salla and Manual create notifications
      return source === 'salla' || source === 'manual';
    } else {
      // Salla not active → Meta and Manual create notifications (fallback)
      return source === 'meta' || source === 'manual';
    }
  }
  
  return false;
}

// Create a notification
export function createNotification({ store, type, message, metadata = {} }) {
  const db = getDb();
  
  // Ensure notifications table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      country TEXT,
      value REAL,
      order_count INTEGER DEFAULT 1,
      is_read INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now')),
      metadata TEXT
    )
  `);
  
  // Check if we should create this notification
  if (type === 'order' && metadata.source) {
    if (!shouldCreateOrderNotification(store, metadata.source)) {
      console.log(`[Notification] Skipping ${metadata.source} order notification for ${store} (not primary source)`);
      return null;
    }
  }
  
  const stmt = db.prepare(`
    INSERT INTO notifications (store, type, message, source, country, value, order_count, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    store,
    type,
    message,
    metadata.source || null,
    metadata.country || null,
    metadata.value || null,
    metadata.order_count || 1,
    JSON.stringify(metadata)
  );
  
  console.log(`[Notification] Created: ${message}`);
  return result.lastInsertRowid;
}

// Create order notification(s) from synced data
export function createOrderNotifications(store, source, orders) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return 0;
  }

  const fallbackCurrency = store === 'shawq' ? 'USD' : 'SAR';

  // Check if we should create notifications for this source
  if (!shouldCreateOrderNotification(store, source)) {
    console.log(`[Notification] Skipping ${source} notifications for ${store}`);
    return 0;
  }
  
  const db = getDb();
  let created = 0;
  
  // Get the latest notification timestamp to avoid duplicates
  const lastNotification = db.prepare(`
    SELECT timestamp, metadata FROM notifications
    WHERE store = ? AND source = ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(store, source);

  let lastTimestamp = new Date(0);

  if (lastNotification) {
    try {
      const storedMetadata = lastNotification.metadata ? JSON.parse(lastNotification.metadata) : null;
      if (storedMetadata?.timestamp) {
        const eventTime = new Date(storedMetadata.timestamp);
        if (!isNaN(eventTime.getTime())) {
          lastTimestamp = eventTime;
        }
      }
    } catch (e) {
      console.warn('[Notification] Failed to parse metadata timestamp:', e.message);
    }

    // Fallback to notification row timestamp if metadata is missing/invalid
    if (isNaN(lastTimestamp.getTime())) {
      lastTimestamp = new Date(lastNotification.timestamp);
    }
  }

  if (isNaN(lastTimestamp.getTime())) {
    lastTimestamp = new Date(0);
  }
  
  // Group orders by country for cleaner notifications
  const ordersByCountry = {};

  const normalizeCountry = (order, fallback = 'Unknown') => {
    const rawCountry = (order.country || order.shipping_country || order.country_code || '').toString().trim();
    if (!rawCountry) {
      return { code: fallback, label: fallback };
    }

    const upper = rawCountry.toUpperCase();

    if (upper === 'ALL' || upper === 'UNKNOWN') {
      return { code: 'ALL', label: 'All Countries' };
    }

    if (/^[A-Z]{2}$/.test(upper)) {
      const info = getCountryInfo(upper);
      return {
        code: info.code || upper,
        label: info.name || upper
      };
    }

    return { code: rawCountry, label: rawCountry };
  };

  for (const order of orders) {
    // Shawq/Shopify uses order_created_at and order_total, others use created_at and total_price
    const orderDate = new Date(order.order_created_at || order.created_at || order.date || order.timestamp);

    if (isNaN(orderDate)) {
      continue;
    }

    // Only notify for orders newer than last notification
    if (orderDate <= lastTimestamp) {
      continue;
    }

    const country = normalizeCountry(order);
    const value = parseFloat(order.order_total || order.total_price || order.revenue || order.value || 0);
    const currency = order.currency || fallbackCurrency;

    const countryKey = country.code || country.label || 'Unknown';

    if (!ordersByCountry[countryKey]) {
      ordersByCountry[countryKey] = {
        code: country.code,
        label: country.label,
        count: 0,
        total: 0,
        latest: orderDate,
        currency
      };
    }

    ordersByCountry[countryKey].count += 1;
    ordersByCountry[countryKey].total += value;
    if (orderDate > ordersByCountry[countryKey].latest) {
      ordersByCountry[countryKey].latest = orderDate;
    }
    // Always prefer a real currency from the order, but keep existing value when absent
    if (order.currency) {
      ordersByCountry[countryKey].currency = order.currency;
    }
  }

  // Create notifications for each country
  for (const data of Object.values(ordersByCountry)) {
    const currency = data.currency || fallbackCurrency;
    const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);
    const displayCountry = data.label || data.code || 'Unknown';

    // Format: Country • Amount • Source (clean format)
    const message = `${displayCountry} • ${currency} ${(data.total || 0).toFixed(2)} • ${sourceLabel}`;

    createNotification({
      store,
      type: 'order',
      message,
      metadata: {
        source,
        country: displayCountry,
        country_code: data.code,
        currency,
        value: data.total,
        order_count: data.count,
        timestamp: data.latest.toISOString()
      }
    });
    
    created++;
  }
  
  return created;
}

// Get recent notifications
export function getNotifications(store = null, limit = 50) {
  const db = getDb();
  
  let query = `
    SELECT * FROM notifications 
    ${store ? 'WHERE store = ?' : ''}
    ORDER BY timestamp DESC 
    LIMIT ?
  `;
  
  const params = store ? [store, limit] : [limit];
  const notifications = db.prepare(query).all(...params);
  
  return notifications.map(n => ({
    ...n,
    metadata: n.metadata ? JSON.parse(n.metadata) : {},
    is_read: Boolean(n.is_read)
  }));
}

// Get unread count
export function getUnreadCount(store = null) {
  const db = getDb();
  
  let query = `
    SELECT COUNT(*) as count FROM notifications 
    WHERE is_read = 0 ${store ? 'AND store = ?' : ''}
  `;
  
  const result = store 
    ? db.prepare(query).get(store)
    : db.prepare(query).get();
  
  return result.count;
}

// Mark notification as read
export function markAsRead(notificationId) {
  const db = getDb();
  const stmt = db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?');
  stmt.run(notificationId);
}

// Mark all as read
export function markAllAsRead(store = null) {
  const db = getDb();
  
  let query = `UPDATE notifications SET is_read = 1 ${store ? 'WHERE store = ?' : ''}`;
  const stmt = db.prepare(query);
  
  if (store) {
    stmt.run(store);
  } else {
    stmt.run();
  }
}

// Delete old notifications (older than 7 days)
export function cleanupOldNotifications() {
  const db = getDb();
  const stmt = db.prepare(`
    DELETE FROM notifications 
    WHERE timestamp < datetime('now', '-7 days')
  `);
  const result = stmt.run();
  console.log(`[Notification] Cleaned up ${result.changes} old notifications`);
  return result.changes;
}
