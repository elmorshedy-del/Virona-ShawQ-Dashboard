import express from 'express';
import { getDb } from '../db/database.js';

const router = express.Router();

const DEFAULT_WINDOW_SECONDS = 180;
const MAX_WINDOW_SECONDS = 1800;
const LIVE_STATE_GC_MULTIPLIER = 6; // keep some buffer beyond the visible window

// In-memory live state (fast + works even if DB is read-only / unavailable).
// Structure: store -> sessionKey -> { type, tsMs }
const liveSessionsByStore = new Map();

function getStoreLiveMap(store) {
  const key = store || 'shawq';
  let map = liveSessionsByStore.get(key);
  if (!map) {
    map = new Map();
    liveSessionsByStore.set(key, map);
  }
  return map;
}

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

function updateLiveState(store, eventType, payload, timestampIso) {
  if (!isCheckoutRelated(eventType)) return false;
  const key = extractCheckoutKey(payload);
  if (!key) return false;
  const tsMs = Date.parse(timestampIso) || Date.now();
  const sessions = getStoreLiveMap(store);
  const sessionKey = String(key);

  if (isCheckoutCompleted(eventType)) {
    sessions.delete(sessionKey);
    return true;
  }

  const existing = sessions.get(sessionKey);
  if (!existing || tsMs >= existing.tsMs) {
    sessions.set(sessionKey, { type: eventType, tsMs });
  }
  return true;
}

function computeLiveFromMemory(store, windowSeconds) {
  const sessions = getStoreLiveMap(store);
  const cutoffMs = Date.now() - windowSeconds * 1000;
  const gcCutoffMs = Date.now() - windowSeconds * 1000 * LIVE_STATE_GC_MULTIPLIER;

  let active = 0;
  let lastEventAt = null;

  for (const [key, entry] of sessions.entries()) {
    if (!entry || !Number.isFinite(entry.tsMs)) {
      sessions.delete(key);
      continue;
    }

    if (entry.tsMs < gcCutoffMs) {
      sessions.delete(key);
      continue;
    }

    if (!lastEventAt || entry.tsMs > lastEventAt) lastEventAt = entry.tsMs;

    if (entry.tsMs < cutoffMs) continue;
    if (isCheckoutCompleted(entry.type)) continue;
    active += 1;
  }

  return {
    count: active,
    lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null
  };
}

router.post('/shopify', (req, res) => {
  try {
    const payload = req.body || {};
    const store = resolveStore(payload);
    const type = normalizeEventType(payload);
    const ts = normalizeEventTimestamp(payload);

    // Always update the live in-memory counter (even if DB writes fail).
    updateLiveState(store, type, payload, ts);

    // Best-effort DB write (optional; useful for later analysis).
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO shopify_pixel_events (store, event_type, event_ts, payload_json)
        VALUES (?, ?, ?, ?)
      `).run(store, type, ts, JSON.stringify(payload));
    } catch (dbError) {
      // Don't break live tracking if DB is unavailable/read-only.
      console.warn('[Pixels] Shopify DB insert failed:', dbError?.message || dbError);
    }

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
    const mem = computeLiveFromMemory(store, windowSeconds);
    const wantsDebug = req.query.debug === '1' || process.env.PIXELS_DEBUG === '1';
    let dbDegraded = false;

    // Optional DB-backed reconciliation: if memory has nothing yet (fresh deploy),
    // try to bootstrap the counter from the last window of DB events.
    if (mem.count === 0 && wantsDebug) {
      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT event_type, event_ts, created_at, payload_json
          FROM shopify_pixel_events
          WHERE store = ? AND created_at >= datetime('now', ?)
        `).all(store, `-${windowSeconds} seconds`);

        for (const row of rows) {
          const eventType = row.event_type || 'unknown';
          const payload = safeJsonParse(row.payload_json) || {};
          const tsIso = row.event_ts || row.created_at || payload?.timestamp || new Date().toISOString();
          updateLiveState(store, eventType, payload, tsIso);
        }
      } catch (dbError) {
        dbDegraded = true;
        console.warn('[Pixels] Shopify DB read failed:', dbError?.message || dbError);
      }
    }

    const finalMem = computeLiveFromMemory(store, windowSeconds);

    res.json({
      success: true,
      store,
      count: finalMem.count,
      windowSeconds,
      updatedAt: new Date().toISOString(),
      lastEventAt: finalMem.lastEventAt,
      ...(wantsDebug ? { degraded: dbDegraded, memorySize: getStoreLiveMap(store).size } : {})
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
