import express from 'express';
import { getDb } from '../db/database.js';

const router = express.Router();

const DEFAULT_WINDOW_SECONDS = 180;
const MAX_WINDOW_SECONDS = 1800;

function resolveStore(payload) {
  const host = payload?.context?.document?.location?.host || payload?.context?.document?.location?.hostname;
  if (host && host.includes('shawqq')) return 'shawq';
  if (host && host.includes('virona')) return 'vironax';
  return payload?.store || 'shawq';
}

function normalizeEventType(payload) {
  const raw =
    payload?.event?.name ||
    payload?.name ||
    payload?.event ||
    payload?.type ||
    payload?.eventType ||
    payload?.event_name;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'unknown';
}

function normalizeEventTimestamp(payload) {
  const raw =
    payload?.timestamp ||
    payload?.event?.timestamp ||
    payload?.ts ||
    payload?.time;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : new Date().toISOString();
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function parseSqliteTimestamp(value) {
  if (!value || typeof value !== 'string') return NaN;
  if (value.includes('T')) {
    return Date.parse(value);
  }
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}

function extractCheckoutKey(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return (
    payload.checkoutToken ||
    payload.checkoutId ||
    payload.checkout_id ||
    payload?.data?.checkout?.token ||
    payload?.data?.checkout?.id ||
    payload?.checkout?.token ||
    payload?.checkout?.id ||
    payload.clientId ||
    payload.client_id ||
    payload?.context?.clientId ||
    payload?.context?.sessionId ||
    payload?.sessionId ||
    null
  );
}

function isCheckoutRelated(eventType = '') {
  const normalized = String(eventType).toLowerCase();
  if (!normalized || normalized === 'unknown') return false;
  return normalized.includes('checkout') || normalized === 'payment_info_submitted';
}

function isCheckoutCompleted(eventType = '') {
  return String(eventType).toLowerCase() === 'checkout_completed';
}

router.post('/shopify', (req, res) => {
  try {
    const payload = req.body || {};
    const db = getDb();
    const store = resolveStore(payload);
    const type = normalizeEventType(payload);
    const ts = normalizeEventTimestamp(payload);

    db.prepare(`
      INSERT INTO shopify_pixel_events (store, event_type, event_ts, payload_json)
      VALUES (?, ?, ?, ?)
    `).run(store, type, ts, JSON.stringify(payload));

    res.json({ success: true });
  } catch (error) {
    const wantsDebug = req.query.debug === '1' || process.env.PIXELS_DEBUG === '1';
    console.error('[Pixels] Shopify error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record event',
      ...(wantsDebug ? { details: error?.message || String(error) } : {})
    });
  }
});

router.get('/shopify/live', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const requestedWindow = parseInt(req.query.windowSeconds, 10);
    const baseWindow = Number.isFinite(requestedWindow) ? requestedWindow : DEFAULT_WINDOW_SECONDS;
    const windowSeconds = Math.min(Math.max(baseWindow, 30), MAX_WINDOW_SECONDS);
    const db = getDb();
    const rows = db.prepare(`
      SELECT event_type, event_ts, created_at, payload_json
      FROM shopify_pixel_events
      WHERE store = ? AND created_at >= datetime('now', ?)
    `).all(store, `-${windowSeconds} seconds`);

    const sessions = new Map();
    let lastEventAt = null;
    const cutoffMs = Date.now() - windowSeconds * 1000;

    for (const row of rows) {
      const eventType = row.event_type || 'unknown';
      if (!isCheckoutRelated(eventType)) continue;
      const payload = safeJsonParse(row.payload_json) || {};
      const key = extractCheckoutKey(payload);
      if (!key) continue;
      const tsMs =
        parseSqliteTimestamp(row.created_at) ||
        parseSqliteTimestamp(row.event_ts) ||
        parseSqliteTimestamp(payload?.timestamp);
      if (!Number.isFinite(tsMs)) continue;

      const existing = sessions.get(key);
      if (!existing || tsMs >= existing.tsMs) {
        sessions.set(key, { type: eventType, tsMs });
      }

      if (!lastEventAt || tsMs > lastEventAt) lastEventAt = tsMs;
    }

    let active = 0;
    for (const entry of sessions.values()) {
      if (entry.tsMs < cutoffMs) continue;
      if (isCheckoutCompleted(entry.type)) continue;
      active += 1;
    }

    res.json({
      success: true,
      store,
      count: active,
      windowSeconds,
      updatedAt: new Date().toISOString(),
      lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null
    });
  } catch (error) {
    const wantsDebug = req.query.debug === '1' || process.env.PIXELS_DEBUG === '1';
    console.error('[Pixels] Shopify live error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to compute live checkouts',
      ...(wantsDebug ? { details: error?.message || String(error) } : {})
    });
  }
});

export default router;
