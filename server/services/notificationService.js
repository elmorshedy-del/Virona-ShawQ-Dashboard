import { getDb } from '../db/database.js';
import { getCountryInfo } from '../utils/countryData.js';

const DEFAULT_NOTIFICATION_LIMIT = 50;

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
export function createNotification({ store, type, message, metadata = {}, timestamp = null, eventKey = null }) {
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
      metadata TEXT,
      event_key TEXT
    )
  `);
  
  // Check if we should create this notification
  if (type === 'order' && metadata.source) {
    if (!shouldCreateOrderNotification(store, metadata.source)) {
      console.log(`[Notification] Skipping ${metadata.source} order notification for ${store} (not primary source)`);
      return null;
    }
  }
  
  const metadataJson = JSON.stringify(metadata);
  let result;

  if (timestamp) {
    const stmt = db.prepare(`
      INSERT INTO notifications (store, type, message, source, country, value, order_count, timestamp, metadata, event_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    result = stmt.run(
      store,
      type,
      message,
      metadata.source || null,
      metadata.country || null,
      metadata.value || null,
      metadata.order_count || 1,
      timestamp,
      metadataJson,
      eventKey
    );
  } else {
    const stmt = db.prepare(`
      INSERT INTO notifications (store, type, message, source, country, value, order_count, metadata, event_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    result = stmt.run(
      store,
      type,
      message,
      metadata.source || null,
      metadata.country || null,
      metadata.value || null,
      metadata.order_count || 1,
      metadataJson,
      eventKey
    );
  }
  
  console.log(`[Notification] Created: ${message}`);
  return result.lastInsertRowid;
}

// Create order notification(s) from synced data
export function createOrderNotifications(store, source, orders, options = {}) {
  if (!Array.isArray(orders) || orders.length === 0) {
    return 0;
  }

  const fallbackCurrency = store === 'shawq' ? 'USD' : 'SAR';
  const isVironaMeta = store === 'vironax' && source === 'meta';
  const isShopify = store === 'shawq' && source === 'shopify';

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
  let created = 0;
  
  // Get the latest notification timestamp to avoid duplicates
  const lastNotification = db.prepare(`
    SELECT timestamp, metadata FROM notifications
    WHERE store = ? AND source = ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(store, source);

  let lastTimestamp = new Date(0);

  if (lastNotification) {
    if (store === 'vironax' && source === 'meta') {
      lastTimestamp = new Date(lastNotification.timestamp);
    } else {
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

  if (isNaN(lastTimestamp.getTime())) {
    lastTimestamp = new Date(0);
  }

  for (const order of orders) {
    // Shawq/Shopify uses order_created_at and order_total, others use created_at and total_price
    const orderDate = new Date(order.order_created_at || order.created_at || order.date || order.timestamp);

    if (isNaN(orderDate)) {
      continue;
    }

    // Only notify for orders newer than last notification
    if (!isVironaMeta && orderDate <= lastTimestamp) {
      continue;
    }

    const country = normalizeCountry(order);
    const value = parseFloat(order.order_total || order.total_price || order.revenue || order.value || 0);
    const currency = order.currency || fallbackCurrency;

    const countryKey = country.code || country.label || 'Unknown';

    // Include campaign_name in the key for Meta orders to track per-campaign
    const campaignName = order.campaign_name || null;
    const groupKey = campaignName ? `${countryKey}|${campaignName}` : countryKey;

    if (!ordersByCountry[groupKey]) {
      ordersByCountry[groupKey] = {
        code: country.code,
        label: country.label,
        count: 0,
        total: 0,
        latest: orderDate,
        currency,
        campaign_name: campaignName,
        campaign_id: order.campaign_id || null,
        event_date: order.date || null
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

    if (order.date && !ordersByCountry[groupKey].event_date) {
      ordersByCountry[groupKey].event_date = order.date;
    }

    if (order.campaign_id && !ordersByCountry[groupKey].campaign_id) {
      ordersByCountry[groupKey].campaign_id = order.campaign_id;
    }
  }

  const ingestionTimestamp = isVironaMeta
    ? (options.ingestionTimestamp || new Date().toISOString())
    : null;

  // Create notifications for each country
  for (const data of Object.values(ordersByCountry)) {
    const currency = data.currency || fallbackCurrency;
    const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);
    const displayCountry = data.label || data.code || 'Unknown';
    const campaignLabel = (isVironaMeta && data.campaign_name)
      ? `${data.campaign_name} • `
      : '';

    const totalAmount = data.total || 0;
    const amountLabel = isVironaMeta
      ? `${Math.round(totalAmount).toLocaleString()} SAR`
      : `${currency} ${totalAmount.toFixed(2)}`;

    // Format: Country • Amount • Source (clean format)
    const message = `${campaignLabel}${displayCountry} • ${amountLabel} • ${sourceLabel}`;
    let eventKey = null;

    if (isVironaMeta) {
      const eventDate = data.event_date || (data.latest ? data.latest.toISOString().slice(0, 10) : 'unknown-date');
      const eventCampaign = data.campaign_id || data.campaign_name || 'unknown-campaign';
      const eventCountry = data.code || data.label || displayCountry;
      eventKey = `meta|${store}|${eventDate}|${eventCountry}|${eventCampaign}`;
      const exists = db.prepare(`
        SELECT 1 FROM notifications WHERE store = ? AND source = ? AND event_key = ? LIMIT 1
      `).get(store, source, eventKey);
      if (exists) {
        continue;
      }
    }

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
        campaign_name: null
      },
      timestamp: ingestionTimestamp,
      eventKey
    });
    
    created++;
  }
  
  return created;
}

function findShopifyCampaignMatch(db, { store, date, countryLabel, countryCode, amount, orderCount }) {
  if (!date) {
    return null;
  }

  const candidateCountries = [countryLabel, countryCode].filter(Boolean);
  const utmQuery = `
    SELECT utm_campaign, COUNT(*) as matches
    FROM shopify_orders
    WHERE store = ? AND date = ? AND (country = ? OR country_code = ?)
      AND utm_campaign IS NOT NULL AND utm_campaign != ''
    GROUP BY utm_campaign
    ORDER BY matches DESC
    LIMIT 1
  `;

  for (const country of candidateCountries) {
    const row = db.prepare(utmQuery).get(store, date, country, country);
    if (row?.utm_campaign) {
      return { campaignName: row.utm_campaign, method: 'utm' };
    }
  }

  const orderAov = amount && orderCount ? amount / Math.max(orderCount, 1) : null;
  if (!orderAov) {
    return null;
  }

  const metaQuery = `
    SELECT campaign_name, conversions, conversion_value
    FROM meta_daily_metrics
    WHERE store = ? AND date = ? AND country = ? AND conversions > 0 AND conversion_value > 0
  `;

  let bestMatch = null;

  for (const country of candidateCountries) {
    const rows = db.prepare(metaQuery).all(store, date, country);
    for (const row of rows) {
      const conversions = row.conversions || 0;
      const conversionValue = row.conversion_value || 0;
      if (!conversions || !conversionValue) {
        continue;
      }
      const campaignAov = conversionValue / conversions;
      const diff = Math.abs(campaignAov - orderAov);

      if (!bestMatch || diff < bestMatch.diff) {
        bestMatch = {
          campaignName: row.campaign_name,
          diff
        };
      }
    }
  }

  if (bestMatch?.campaignName) {
    return { campaignName: bestMatch.campaignName, method: 'aov' };
  }

  return null;
}

function createCampaignMatchNotification({ store, country, countryCode, dateKey, amount, orderCount, currency, match }) {
  if (!match?.campaignName) {
    return null;
  }

  const db = getDb();
  const safeCountry = countryCode || country || 'Unknown';
  const eventKey = `campaign_match|${store}|${dateKey || 'unknown-date'}|${safeCountry}|${match.campaignName}`;

  const exists = db.prepare(`
    SELECT 1 FROM notifications WHERE store = ? AND type = ? AND event_key = ? LIMIT 1
  `).get(store, 'campaign_match', eventKey);

  if (exists) {
    return null;
  }

  const amountLabel = amount ? `${currency || 'USD'} ${amount.toFixed(2)}` : 'Unknown amount';
  const methodLabel = match.method === 'utm' ? 'UTM match' : 'AOV match';
  const message = `Matched order to ${match.campaignName} • ${country || safeCountry} • ${amountLabel} • ${methodLabel}`;

  return createNotification({
    store,
    type: 'campaign_match',
    message,
    metadata: {
      source: 'shopify',
      country: country || safeCountry,
      country_code: countryCode || null,
      currency: currency || null,
      value: amount || 0,
      order_count: orderCount || 1,
      campaign_name: match.campaignName,
      match_method: match.method
    },
    eventKey
  });
}

export function backfillShopifyCampaignMatches(store = 'shawq') {
  const db = getDb();
  const notifications = db.prepare(`
    SELECT id, metadata, country, value, order_count, timestamp
    FROM notifications
    WHERE store = ? AND source = 'shopify' AND type = 'order'
  `).all(store);

  let created = 0;

  for (const notification of notifications) {
    let metadata;
    try {
      metadata = notification.metadata ? JSON.parse(notification.metadata) : {};
    } catch (e) {
      console.warn('[Notification] Failed to parse metadata for Shopify match backfill:', e.message);
      continue;
    }

    const timestamp = metadata?.timestamp || notification.timestamp;
    const date = timestamp ? new Date(timestamp) : null;
    if (!date || isNaN(date)) {
      continue;
    }

    const dateKey = date.toISOString().slice(0, 10);
    const amount = metadata?.value ?? notification.value ?? 0;
    const orderCount = metadata?.order_count ?? notification.order_count ?? 1;
    const currency = metadata?.currency || null;
    const countryLabel = metadata?.country || notification.country || null;
    const countryCode = metadata?.country_code || null;

    const match = findShopifyCampaignMatch(db, {
      store,
      date: dateKey,
      countryLabel,
      countryCode,
      amount,
      orderCount
    });

    if (!match) {
      continue;
    }

    const createdId = createCampaignMatchNotification({
      store,
      country: countryLabel,
      countryCode,
      dateKey,
      amount,
      orderCount,
      currency,
      match
    });

    if (createdId) {
      created++;
    }
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
