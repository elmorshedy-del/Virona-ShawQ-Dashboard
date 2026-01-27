import express from 'express';
import { getDb } from '../db/database.js';

const router = express.Router();

const DEFAULT_WINDOW_SECONDS = 180;
const MAX_WINDOW_SECONDS = 1800;
const LIVE_STATE_GC_MULTIPLIER = 6; // keep some buffer beyond the visible window

// In-memory live state (fast + works even if DB is read-only / unavailable).
// Structure: store -> sessionKey -> { type, tsMs }
const liveSessionsByStore = new Map();

// Best-effort GeoIP cache (keeps us from calling a GeoIP provider for every event).
// Keyed by raw IP string, but we only ever persist country codes in DB/memory state.
const geoIpCache = new Map(); // ip -> { countryCode, expiresAtMs }
const GEOIP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GEOIP_TIMEOUT_MS = parseInt(process.env.PIXELS_GEOIP_TIMEOUT_MS || '1000', 10);

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

function updateLiveState(store, eventType, payload, timestampIso, countryCode) {
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
    sessions.set(sessionKey, {
      type: eventType,
      tsMs,
      countryCode: (typeof countryCode === 'string' && countryCode.trim()) ? countryCode.trim().toUpperCase() : null
    });
  }
  return true;
}

function computeLiveFromMemory(store, windowSeconds) {
  const sessions = getStoreLiveMap(store);
  const cutoffMs = Date.now() - windowSeconds * 1000;
  const gcCutoffMs = Date.now() - windowSeconds * 1000 * LIVE_STATE_GC_MULTIPLIER;

  let active = 0;
  let lastEventAt = null;
  const byCountry = {};

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
    if (entry.countryCode) {
      byCountry[entry.countryCode] = (byCountry[entry.countryCode] || 0) + 1;
    }
  }

  return {
    count: active,
    lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
    byCountry
  };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  const ip = req.socket?.remoteAddress || null;
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function getCountryFromHeaders(req) {
  const headerKeys = [
    'cf-ipcountry',
    'x-vercel-ip-country',
    'x-geo-country',
    'x-country-code'
  ];
  for (const key of headerKeys) {
    const value = req.headers[key];
    if (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim())) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

function extractCountryCodeFromPayload(payload) {
  const candidates = [
    payload?.countryCode,
    payload?.country_code,
    payload?.data?.checkout?.shippingAddress?.countryCode,
    payload?.data?.checkout?.billingAddress?.countryCode,
    payload?.checkout?.shippingAddress?.countryCode,
    payload?.checkout?.billingAddress?.countryCode,
    payload?.geoipCountryCode
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim())) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

async function lookupCountryCode(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const now = Date.now();
  const cached = geoIpCache.get(ip);
  if (cached && cached.expiresAtMs > now) return cached.countryCode;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEOIP_TIMEOUT_MS);

  try {
    // ipapi.co returns plain text country code at /country/
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/country/`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'virona-dashboard/geoip' }
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(text)) return null;
    geoIpCache.set(ip, { countryCode: text, expiresAtMs: now + GEOIP_CACHE_TTL_MS });
    return text;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

router.post('/shopify', async (req, res) => {
  try {
    const payload = req.body || {};
    const store = resolveStore(payload);
    const type = normalizeEventType(payload);
    const ts = normalizeEventTimestamp(payload);

    // Best-effort GeoIP enrichment: prefer explicit checkout address country (when available),
    // then edge-provided headers, then IP-based lookup.
    const explicitCountry = extractCountryCodeFromPayload(payload);
    const headerCountry = explicitCountry ? null : getCountryFromHeaders(req);
    const ip = (explicitCountry || headerCountry) ? null : getClientIp(req);

    // NOTE: We don't persist raw IP. Only the derived country code (if found).
    // We keep the live state update synchronous; GeoIP happens in a microtask below.
    const countryCode = explicitCountry || headerCountry || (ip ? await lookupCountryCode(ip) : null);

    // Always update the live in-memory counter (even if DB writes fail).
    updateLiveState(store, type, payload, ts, countryCode);

    // Best-effort DB write (optional; useful for later analysis).
    try {
      const db = getDb();
      if (countryCode && !payload.geoipCountryCode) {
        payload.geoipCountryCode = countryCode;
      }
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
      byCountry: finalMem.byCountry,
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
