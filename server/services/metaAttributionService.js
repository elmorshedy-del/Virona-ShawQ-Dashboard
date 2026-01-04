import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { createNotification } from './notificationService.js';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

function getAttributionCredentials(store) {
  const accessToken = store === 'shawq'
    ? process.env.SHAWQ_META_ACCESS_TOKEN
    : process.env.META_ACCESS_TOKEN;
  const pixelId = store === 'shawq'
    ? process.env.SHAWQ_META_PIXEL_ID
    : process.env.META_PIXEL_ID;

  return { accessToken, pixelId };
}

function extractOrderId(customData = {}, fallbackId = null) {
  if (!customData || typeof customData !== 'object') {
    return fallbackId;
  }

  const direct = customData.order_id || customData.orderId || customData.orderID;
  if (direct) {
    return direct.toString();
  }

  const contentIds = customData.content_ids || customData.contentIds;
  if (Array.isArray(contentIds) && contentIds.length > 0) {
    return contentIds[0]?.toString() || fallbackId;
  }

  if (typeof contentIds === 'string') {
    return contentIds;
  }

  return fallbackId;
}

function normalizeEventTime(eventTime) {
  if (!eventTime) return null;
  if (typeof eventTime === 'number') {
    return new Date(eventTime * 1000).toISOString();
  }
  const parsed = new Date(eventTime);
  return isNaN(parsed) ? null : parsed.toISOString();
}

async function fetchPixelEvents({ pixelId, accessToken, since, until }) {
  const fields = [
    'event_name',
    'event_time',
    'event_id',
    'custom_data',
    'ad_id',
    'adset_id',
    'campaign_id',
    'ad_name',
    'adset_name',
    'campaign_name'
  ].join(',');

  let url = new URL(`${META_BASE_URL}/${pixelId}/events`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('since', String(since));
  url.searchParams.set('until', String(until));
  url.searchParams.set('limit', '500');

  const events = [];

  while (url) {
    const response = await fetch(url.toString());
    const json = await response.json();

    if (json?.error) {
      throw new Error(json.error.message || 'Meta events API error');
    }

    if (Array.isArray(json?.data)) {
      events.push(...json.data);
    }

    url = json?.paging?.next ? new URL(json.paging.next) : null;
  }

  return events;
}

function chunkArray(items, size = 900) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function getOrderLookup(db, store, orderIds) {
  if (!orderIds.length) return new Map();
  const orderMap = new Map();

  const chunks = chunkArray(orderIds, 900);
  for (const chunk of chunks) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT order_id, country, order_total, currency, order_created_at
      FROM shopify_orders
      WHERE store = ? AND order_id IN (${placeholders})
    `).all(store, ...chunk);

    rows.forEach(row => {
      orderMap.set(row.order_id, row);
    });
  }

  return orderMap;
}

function createAttributionNotifications(db, store) {
  const pending = db.prepare(`
    SELECT order_id, campaign_id, campaign_name
    FROM shopify_meta_attribution
    WHERE store = ? AND notified_at IS NULL
  `).all(store);

  if (!pending.length) {
    return 0;
  }

  let created = 0;

  for (const row of pending) {
    const order = db.prepare(`
      SELECT order_id, country, order_total, currency, order_created_at
      FROM shopify_orders
      WHERE store = ? AND order_id = ?
      LIMIT 1
    `).get(store, row.order_id);

    if (!order) {
      continue;
    }

    const currency = order.currency || 'USD';
    const message = `${order.country || 'Unknown'} • ${currency} ${Number(order.order_total || 0).toFixed(2)} • Shopify`;
    const eventKey = `shopify|${store}|${order.order_id}|${row.campaign_id || row.campaign_name || 'unknown-campaign'}`;

    const exists = db.prepare(`
      SELECT 1 FROM notifications WHERE store = ? AND source = 'shopify' AND event_key = ? LIMIT 1
    `).get(store, eventKey);

    if (exists) {
      db.prepare(`
        UPDATE shopify_meta_attribution
        SET notified_at = datetime('now')
        WHERE store = ? AND order_id = ?
      `).run(store, order.order_id);
      continue;
    }

    createNotification({
      store,
      type: 'order',
      message,
      metadata: {
        source: 'shopify',
        country: order.country || 'Unknown',
        currency,
        value: Number(order.order_total || 0),
        order_count: 1,
        timestamp: order.order_created_at || new Date().toISOString(),
        campaign_name: row.campaign_name || null,
        campaign_id: row.campaign_id || null,
        order_id: order.order_id
      },
      eventKey
    });

    db.prepare(`
      UPDATE shopify_meta_attribution
      SET notified_at = datetime('now')
      WHERE store = ? AND order_id = ?
    `).run(store, order.order_id);
    created++;
  }

  return created;
}

export async function syncShopifyMetaAttribution(store = 'shawq', options = {}) {
  const db = getDb();
  const { accessToken, pixelId } = getAttributionCredentials(store);

  if (!accessToken || !pixelId) {
    console.log(`[Meta Attribution] Missing credentials for ${store} (META_ACCESS_TOKEN/META_PIXEL_ID).`);
    return { success: false, message: 'Missing Meta attribution credentials' };
  }

  const lookbackHours = Number(options.lookbackHours || 24);
  const untilDate = new Date();
  const sinceDate = new Date(untilDate.getTime() - lookbackHours * 60 * 60 * 1000);
  const since = Math.floor(sinceDate.getTime() / 1000);
  const until = Math.floor(untilDate.getTime() / 1000);

  try {
    const events = await fetchPixelEvents({ pixelId, accessToken, since, until });
    const purchases = events.filter(event => (event.event_name || '').toLowerCase() === 'purchase');

    const orderIds = purchases
      .map(event => extractOrderId(event.custom_data, event.event_id))
      .filter(Boolean)
      .map(id => id.toString());

    const orderMap = getOrderLookup(db, store, orderIds);
    const upsert = db.prepare(`
      INSERT INTO shopify_meta_attribution (
        store, order_id, campaign_id, campaign_name, adset_id, ad_id,
        event_time, currency, value, source, raw_payload, updated_at
      ) VALUES (
        @store, @order_id, @campaign_id, @campaign_name, @adset_id, @ad_id,
        @event_time, @currency, @value, @source, @raw_payload, datetime('now')
      )
      ON CONFLICT(store, order_id) DO UPDATE SET
        campaign_id = excluded.campaign_id,
        campaign_name = excluded.campaign_name,
        adset_id = excluded.adset_id,
        ad_id = excluded.ad_id,
        event_time = excluded.event_time,
        currency = excluded.currency,
        value = excluded.value,
        source = excluded.source,
        raw_payload = excluded.raw_payload,
        updated_at = datetime('now')
    `);

    let inserted = 0;
    for (const event of purchases) {
      const orderId = extractOrderId(event.custom_data, event.event_id);
      if (!orderId) continue;

      const order = orderMap.get(orderId.toString());
      if (!order) continue;

      const eventTime = normalizeEventTime(event.event_time);
      const rawPayload = JSON.stringify(event);
      const orderValue = Number(event?.custom_data?.value || order.order_total || 0);

      upsert.run({
        store,
        order_id: orderId.toString(),
        campaign_id: event.campaign_id || null,
        campaign_name: event.campaign_name || null,
        adset_id: event.adset_id || null,
        ad_id: event.ad_id || null,
        event_time: eventTime,
        currency: order.currency || 'USD',
        value: orderValue,
        source: 'meta',
        raw_payload: rawPayload
      });
      inserted++;
    }

    db.prepare(`
      INSERT INTO sync_log (store, source, status, records_synced)
      VALUES (?, 'meta_attribution', 'success', ?)
    `).run(store, inserted);

    const notified = createAttributionNotifications(db, store);

    return {
      success: true,
      records: inserted,
      notifications: notified
    };
  } catch (error) {
    db.prepare(`
      INSERT INTO sync_log (store, source, status, error_message)
      VALUES (?, 'meta_attribution', 'error', ?)
    `).run(store, error.message);

    console.error('[Meta Attribution] Sync error:', error);
    return { success: false, message: error.message };
  }
}
