import { getDb } from '../db/database.js';
import { getAllCountries, getCountryInfo } from '../utils/countryData.js';

const DEFAULT_NOTIFICATION_LIMIT = 50;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

function getOrderDateKey(order) {
  if (typeof order?.date === 'string' && ISO_DATE_REGEX.test(order.date)) {
    return order.date;
  }

  const rawTimestamp = order?.order_created_at || order?.created_at || order?.createdAt || order?.timestamp;
  if (!rawTimestamp) {
    return null;
  }

  const parsed = new Date(rawTimestamp);
  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeCountryCode(order) {
  const rawCountryCode = (order?.country_code || order?.country || '').toString().trim();
  if (!rawCountryCode) {
    return null;
  }

  const upper = rawCountryCode.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    return upper;
  }

  const info = getCountryInfo(rawCountryCode);
  if (info?.code && /^[A-Z]{2}$/.test(info.code)) {
    return info.code;
  }

  const normalized = rawCountryCode.toLowerCase();
  const nameMatch = getAllCountries().find(country => country.name?.toLowerCase() === normalized);
  if (nameMatch?.code) {
    return nameMatch.code;
  }

  return null;
}

function buildMetaCampaignIndex(db, store, orders) {
  const cache = new Map();

  if (store !== 'shawq') {
    return cache;
  }

  const uniqueKeys = new Set();
  for (const order of orders) {
    const dateKey = getOrderDateKey(order);
    const countryCode = normalizeCountryCode(order);
    if (!dateKey || !countryCode) {
      continue;
    }
    uniqueKeys.add(`${dateKey}|${countryCode}`);
  }

  if (uniqueKeys.size === 0) {
    return cache;
  }

  const stmt = db.prepare(`
    SELECT campaign_name, SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
    FROM meta_daily_metrics
    WHERE store = ? AND date = ? AND country = ?
    GROUP BY campaign_name
  `);

  const fallbackStmt = db.prepare(`
    SELECT campaign_name, SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
    FROM meta_daily_metrics
    WHERE store = ? AND date = ? AND country = 'ALL'
    GROUP BY campaign_name
  `);

  for (const key of uniqueKeys) {
    const [dateKey, countryCode] = key.split('|');
    let rows = [];

    try {
      rows = stmt.all(store, dateKey, countryCode);
      if ((!rows || rows.length === 0) && countryCode !== 'ALL') {
        rows = fallbackStmt.all(store, dateKey);
      }
    } catch (error) {
      console.warn('[Notification] Failed to load Meta campaign matches:', error.message);
      rows = [];
    }

    const campaigns = (rows || [])
      .filter(row => (row.conversions || 0) > 0 && (row.conversion_value || 0) > 0)
      .map(row => ({
        campaign_name: row.campaign_name,
        conversions: row.conversions || 0,
        conversion_value: row.conversion_value || 0,
        aov: row.conversions ? row.conversion_value / row.conversions : 0
      }))
      .filter(row => row.campaign_name && row.aov > 0);

    cache.set(key, campaigns);
  }

  return cache;
}

function findBestCampaignMatch(campaigns, orderTotal) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return null;
  }

  const orderValue = typeof orderTotal === 'number' ? orderTotal : parseFloat(orderTotal || 0);
  if (!orderValue || Number.isNaN(orderValue)) {
    return null;
  }

  let best = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const campaign of campaigns) {
    const diff = Math.abs(orderValue - campaign.aov);
    if (diff < bestDiff) {
      best = campaign;
      bestDiff = diff;
      continue;
    }

    if (diff === bestDiff && best && (campaign.conversions || 0) > (best.conversions || 0)) {
      best = campaign;
    }
  }

  return best?.campaign_name || null;
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
    if (store === 'vironax' && source === 'meta' && isSallaActive()) {
      console.log('[Notification] Skipping VironaX Meta notifications because Salla is active (VIRONAX_SALLA_ACCESS_TOKEN set)');
    } else {
      console.log(`[Notification] Skipping ${source} notifications for ${store}`);
    }
    return 0;
  }
  
  const db = getDb();
  const metaCampaignIndex = (store === 'shawq' && source === 'shopify')
    ? buildMetaCampaignIndex(db, store, orders)
    : new Map();
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
    const dateKey = getOrderDateKey(order);
    const countryCode = normalizeCountryCode(order) || country.code;
    const campaignKey = (dateKey && countryCode) ? `${dateKey}|${countryCode}` : null;
    const matchedCampaign = (store === 'shawq' && source === 'shopify' && campaignKey)
      ? findBestCampaignMatch(metaCampaignIndex.get(campaignKey), value)
      : null;

    const countryKey = country.code || country.label || 'Unknown';

    // Include campaign_name in the key for Meta orders to track per-campaign
    const campaignName = order.campaign_name || matchedCampaign || null;
    const groupKey = campaignName ? `${countryKey}|${campaignName}` : countryKey;

    if (!ordersByCountry[groupKey]) {
      ordersByCountry[groupKey] = {
        code: country.code,
        label: country.label,
        count: 0,
        total: 0,
        latest: orderDate,
        currency,
        campaign_name: campaignName
      };
    }

    ordersByCountry[groupKey].count += 1;
    ordersByCountry[groupKey].total += value;
    if (orderDate > ordersByCountry[groupKey].latest) {
      ordersByCountry[groupKey].latest = orderDate;
    }
    // Always prefer a real currency from the order, but keep existing value when absent
    if (order.currency) {
      ordersByCountry[groupKey].currency = order.currency;
    }
  }

  // Create notifications for each country
  for (const data of Object.values(ordersByCountry)) {
    const currency = data.currency || fallbackCurrency;
    const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);
    const displayCountry = data.label || data.code || 'Unknown';
    const campaignLabel = (store === 'vironax' && source === 'meta' && data.campaign_name)
      ? `${data.campaign_name} • `
      : '';

    // Format: Country • Amount • Source (clean format)
    const message = `${campaignLabel}${displayCountry} • ${currency} ${(data.total || 0).toFixed(2)} • ${sourceLabel}`;

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
        timestamp: data.latest.toISOString(),
        campaign_name: data.campaign_name || null
      }
    });
    
    created++;
  }
  
  return created;
}

// Get recent notifications
export function getNotifications(store = null, limit = DEFAULT_NOTIFICATION_LIMIT) {
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

// Delete a single notification
export function deleteNotification(notificationId) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM notifications WHERE id = ?');
  const result = stmt.run(notificationId);
  console.log(`[Notification] Deleted notification ${notificationId}`);
  return result.changes;
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
