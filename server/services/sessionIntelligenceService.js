import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';

const RAW_RETENTION_HOURS = parseInt(process.env.SESSION_INTELLIGENCE_RAW_RETENTION_HOURS || '72', 10);
const ABANDON_AFTER_HOURS = parseInt(process.env.SESSION_INTELLIGENCE_ABANDON_AFTER_HOURS || '24', 10);

const CHECKOUT_STEP_LABELS = {
  contact: 'Contact',
  shipping: 'Shipping',
  payment: 'Payment',
  review: 'Review',
  thank_you: 'Thank you'
};

function normalizeSqliteDateTime(value) {
  const date = value ? new Date(value) : new Date();
  const ts = Number.isFinite(date.getTime()) ? date : new Date();
  return ts.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function getEventEnvelope(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.event && typeof payload.event === 'object') return payload.event;
  return payload;
}

function normalizeEventName(payload) {
  const envelope = getEventEnvelope(payload);
  const candidates = [
    envelope?.name,
    payload?.name,
    payload?.event?.name,
    payload?.event_name,
    payload?.eventType,
    payload?.type
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'unknown';
}

function normalizeEventTimestamp(payload) {
  const envelope = getEventEnvelope(payload);
  const candidates = [
    payload?.timestamp,
    payload?.event?.timestamp,
    envelope?.timestamp,
    payload?.ts,
    payload?.time
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return normalizeSqliteDateTime(value.trim());
  }
  return normalizeSqliteDateTime();
}

function getEventData(payload) {
  const envelope = getEventEnvelope(payload);
  return envelope?.data ?? payload?.data ?? null;
}

function tryParseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    return new URL(rawUrl);
  } catch (error) {
    try {
      return new URL(rawUrl, 'https://example.invalid');
    } catch (innerError) {
      return null;
    }
  }
}

function normalizeCheckoutStep(raw) {
  const step = safeString(raw).toLowerCase().trim();
  if (!step) return null;

  if (step.includes('contact')) return 'contact';
  if (step.includes('shipping')) return 'shipping';
  if (step.includes('payment')) return 'payment';
  if (step.includes('review')) return 'review';
  if (step.includes('thank')) return 'thank_you';

  // Some Shopify checkouts use these names
  if (step === 'contact_information') return 'contact';
  if (step === 'shipping_method') return 'shipping';
  if (step === 'payment_method') return 'payment';

  return step.slice(0, 48);
}

function extractCheckoutTokenFromPath(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  const match = pathname.match(/\/checkouts\/([^/?#]+)/i);
  if (!match) return null;
  const first = match[1];
  const after = pathname.slice((match.index || 0) + match[0].length);
  const next = after.match(/^\/([^/?#]+)/);
  // If the first segment looks like a country code (e.g. /checkouts/cn/<token>/..)
  if (first && /^[a-z]{2}$/i.test(first) && next && next[1]) {
    return next[1].slice(0, 64);
  }
  return first ? first.slice(0, 64) : null;
}

function extractLocation(payload) {
  const candidates = [
    payload?.context?.document?.location?.href,
    payload?.context?.document?.location?.url,
    payload?.context?.document?.location?.pathname,
    payload?.page_url,
    payload?.pageUrl,
    payload?.url
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      const url = tryParseUrl(value.trim());
      if (url) {
        const stepParam = url.searchParams.get('step');
        const inferredStep =
          normalizeCheckoutStep(stepParam) ||
          (url.pathname.includes('/checkouts/')
            ? (url.pathname.includes('thank_you') ? 'thank_you' : 'contact')
            : null);

        const checkoutToken = extractCheckoutTokenFromPath(url.pathname);
        const safeUrl = inferredStep ? `${url.pathname}?step=${encodeURIComponent(inferredStep)}` : url.pathname;
        return {
          pageUrl: safeUrl,
          pagePath: url.pathname,
          checkoutToken,
          checkoutStep: inferredStep
        };
      }

      // Fallback for raw path strings
      if (value.startsWith('/')) {
        const checkoutToken = extractCheckoutTokenFromPath(value);
        const inferredStep = value.includes('/checkouts/')
          ? (value.includes('thank_you') ? 'thank_you' : 'contact')
          : null;
        return { pageUrl: value, pagePath: value, checkoutToken, checkoutStep: inferredStep };
      }
    }
  }

  return { pageUrl: null, pagePath: null, checkoutToken: null, checkoutStep: null };
}

function extractSessionIdentifiers(payload) {
  const candidates = [
    payload?.context?.sessionId,
    payload?.context?.session_id,
    payload?.sessionId,
    payload?.session_id,
    payload?.context?.clientId,
    payload?.context?.client_id,
    payload?.clientId,
    payload?.client_id
  ];

  let clientId = null;
  let sessionId = null;

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      if (!sessionId) sessionId = value.trim();
      if (!clientId && value.trim().length >= 8) clientId = value.trim();
    }
  }

  return { sessionId, clientId };
}

function isAddToCart(eventName) {
  const name = safeString(eventName).toLowerCase();
  return (
    name === 'product_added_to_cart' ||
    name === 'add_to_cart' ||
    name === 'added_to_cart' ||
    name === 'cart_add' ||
    name === 'atc'
  );
}

function isCheckoutStarted(eventName) {
  const name = safeString(eventName).toLowerCase();
  return name === 'checkout_started' || name === 'checkout_initiated' || name === 'begin_checkout';
}

function isPurchase(eventName) {
  const name = safeString(eventName).toLowerCase();
  return (
    name === 'checkout_completed' ||
    name === 'purchase' ||
    name === 'order_completed' ||
    name === 'order_placed'
  );
}

function extractCartSnapshot(eventData) {
  if (!eventData || typeof eventData !== 'object') return null;
  const candidates = [
    eventData.cart,
    eventData.checkout,
    eventData?.checkout?.cart,
    eventData?.cartLine,
    eventData?.lineItem,
    eventData?.line_item
  ];

  for (const value of candidates) {
    if (value && typeof value === 'object') return value;
  }
  return null;
}

const SENSITIVE_KEY_RE =
  /(email|phone|first[_-]?name|last[_-]?name|address|zip|postal|postcode|city|province|state|company|card|payment|authorization|token)/i;

function scrubSensitive(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const arr = [];
    seen.set(value, arr);
    for (const item of value) {
      arr.push(scrubSensitive(item, seen));
    }
    return arr;
  }

  const obj = {};
  seen.set(value, obj);
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      obj[k] = v === null || v === undefined ? v : '[redacted]';
      continue;
    }
    obj[k] = scrubSensitive(v, seen);
  }
  return obj;
}

export function recordSessionIntelligenceEvent({ store, payload, source = 'shopify' }) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'invalid_payload' };
  const db = getDb();

  const eventName = normalizeEventName(payload);
  const eventTs = normalizeEventTimestamp(payload);
  const eventDataRaw = getEventData(payload);
  const eventData = scrubSensitive(eventDataRaw);

  const location = extractLocation(payload);
  const identifiers = extractSessionIdentifiers(payload);
  const checkoutTokenFromData =
    safeString(eventDataRaw?.checkout?.token || eventDataRaw?.checkout?.id || eventDataRaw?.checkoutToken).trim() ||
    null;
  const checkoutToken = location.checkoutToken || checkoutTokenFromData;

  const sessionId = identifiers.sessionId || (checkoutToken ? `checkout:${checkoutToken}` : null) || `anon:${randomUUID()}`;
  const clientId = identifiers.clientId || null;

  const cartSnapshot = extractCartSnapshot(eventDataRaw);
  const cartJson = cartSnapshot ? JSON.stringify(scrubSensitive(cartSnapshot)) : null;

  const insertEvent = db.prepare(`
    INSERT INTO si_events (
      store,
      session_id,
      client_id,
      source,
      event_name,
      event_ts,
      page_url,
      page_path,
      checkout_token,
      checkout_step,
      data_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = normalizeSqliteDateTime();

  const upsertSession = db.prepare(`
    INSERT INTO si_sessions (
      store,
      session_id,
      client_id,
      started_at,
      last_event_at,
      atc_at,
      checkout_started_at,
      purchase_at,
      last_checkout_token,
      last_checkout_step,
      last_cart_json,
      status,
      updated_at
    )
    VALUES (
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?,
      ?
    )
    ON CONFLICT(store, session_id) DO UPDATE SET
      client_id = COALESCE(excluded.client_id, si_sessions.client_id),
      started_at = COALESCE(si_sessions.started_at, excluded.started_at),
      last_event_at = CASE
        WHEN si_sessions.last_event_at IS NULL THEN excluded.last_event_at
        WHEN excluded.last_event_at IS NULL THEN si_sessions.last_event_at
        WHEN excluded.last_event_at > si_sessions.last_event_at THEN excluded.last_event_at
        ELSE si_sessions.last_event_at
      END,
      atc_at = COALESCE(si_sessions.atc_at, excluded.atc_at),
      checkout_started_at = COALESCE(si_sessions.checkout_started_at, excluded.checkout_started_at),
      purchase_at = COALESCE(si_sessions.purchase_at, excluded.purchase_at),
      last_checkout_token = COALESCE(excluded.last_checkout_token, si_sessions.last_checkout_token),
      last_checkout_step = COALESCE(excluded.last_checkout_step, si_sessions.last_checkout_step),
      last_cart_json = COALESCE(excluded.last_cart_json, si_sessions.last_cart_json),
      status = CASE
        WHEN COALESCE(si_sessions.purchase_at, excluded.purchase_at) IS NOT NULL THEN 'purchased'
        WHEN COALESCE(si_sessions.checkout_started_at, excluded.checkout_started_at) IS NOT NULL THEN 'checkout'
        WHEN COALESCE(si_sessions.atc_at, excluded.atc_at) IS NOT NULL THEN 'atc'
        ELSE 'active'
      END,
      updated_at = excluded.updated_at
  `);

  const atcAt = isAddToCart(eventName) ? eventTs : null;
  const checkoutStartedAt = isCheckoutStarted(eventName) ? eventTs : null;
  const purchaseAt = isPurchase(eventName) ? eventTs : null;

  const status =
    purchaseAt ? 'purchased' : checkoutStartedAt ? 'checkout' : atcAt ? 'atc' : 'active';

  db.transaction(() => {
    insertEvent.run(
      store,
      sessionId,
      clientId,
      source,
      eventName,
      eventTs,
      location.pageUrl,
      location.pagePath,
      checkoutToken,
      location.checkoutStep,
      eventData ? JSON.stringify(eventData) : null
    );

    upsertSession.run(
      store,
      sessionId,
      clientId,
      eventTs,
      eventTs,
      atcAt,
      checkoutStartedAt,
      purchaseAt,
      checkoutToken,
      location.checkoutStep,
      cartJson,
      status,
      now
    );
  })();

  return {
    ok: true,
    store,
    sessionId,
    eventName,
    eventTs,
    checkoutToken,
    checkoutStep: location.checkoutStep || null
  };
}

export function cleanupSessionIntelligenceRaw({ retentionHours = RAW_RETENTION_HOURS } = {}) {
  const db = getDb();
  const hours = Number.isFinite(retentionHours) && retentionHours > 0 ? retentionHours : RAW_RETENTION_HOURS;
  const cutoff = `-${hours} hours`;
  const result = db.prepare(`
    DELETE FROM si_events
    WHERE created_at < datetime('now', ?)
  `).run(cutoff);

  // Optional: keep sessions longer than raw events, but don't let the table grow forever.
  try {
    db.prepare(`
      DELETE FROM si_sessions
      WHERE last_event_at IS NOT NULL AND last_event_at < datetime('now', '-60 days')
    `).run();
  } catch (e) {
    // Ignore; table might not exist yet on very early boot.
  }

  return { deletedEvents: result.changes || 0, retentionHours: hours };
}

export function getSessionIntelligenceOverview(store) {
  const db = getDb();

  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND started_at >= datetime('now', '-24 hours')) AS sessions_24h,
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND atc_at >= datetime('now', '-24 hours')) AS atc_24h,
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND checkout_started_at >= datetime('now', '-24 hours')) AS checkout_24h,
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND purchase_at >= datetime('now', '-24 hours')) AS purchases_24h,
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND atc_at IS NOT NULL AND purchase_at IS NULL AND atc_at <= datetime('now', ?)) AS atc_abandoned
  `).get(store, store, store, store, store, `-${ABANDON_AFTER_HOURS} hours`);

  const dropoffs = db.prepare(`
    SELECT
      COALESCE(last_checkout_step, 'unknown') AS step,
      COUNT(*) AS count
    FROM si_sessions
    WHERE store = ?
      AND checkout_started_at IS NOT NULL
      AND purchase_at IS NULL
      AND checkout_started_at <= datetime('now', ?)
    GROUP BY step
    ORDER BY count DESC
  `).all(store, `-${ABANDON_AFTER_HOURS} hours`);

  const dropoffsByStep = {};
  for (const entry of dropoffs) {
    const step = safeString(entry.step || 'unknown');
    dropoffsByStep[step] = Number(entry.count) || 0;
  }

  return {
    store,
    retentionHours: RAW_RETENTION_HOURS,
    abandonAfterHours: ABANDON_AFTER_HOURS,
    kpis: {
      sessions24h: row?.sessions_24h || 0,
      atc24h: row?.atc_24h || 0,
      checkoutStarted24h: row?.checkout_24h || 0,
      purchases24h: row?.purchases_24h || 0,
      atcAbandoned: row?.atc_abandoned || 0
    },
    checkoutDropoffsByStep: dropoffsByStep
  };
}

export function getSessionIntelligenceRecentEvents(store, limit = 80) {
  const db = getDb();
  const max = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 500);
  return db.prepare(`
    SELECT
      id,
      store,
      session_id,
      client_id,
      source,
      event_name,
      event_ts,
      page_url,
      page_path,
      checkout_token,
      checkout_step,
      created_at
    FROM si_events
    WHERE store = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(store, max);
}

export function getSessionIntelligenceSessions(store, limit = 60) {
  const db = getDb();
  const max = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 500);
  return db.prepare(`
    SELECT
      id,
      store,
      session_id,
      client_id,
      started_at,
      last_event_at,
      atc_at,
      checkout_started_at,
      purchase_at,
      last_checkout_token,
      last_checkout_step,
      last_cart_json,
      status,
      analyzed_at,
      primary_reason,
      confidence,
      summary,
      created_at,
      updated_at
    FROM si_sessions
    WHERE store = ?
    ORDER BY COALESCE(last_event_at, updated_at, created_at) DESC
    LIMIT ?
  `).all(store, max);
}

export function getSessionIntelligenceLatestBrief(store) {
  const db = getDb();
  return db.prepare(`
    SELECT id, store, date, content, top_reasons_json, model, generated_at, created_at
    FROM si_daily_briefs
    WHERE store = ?
    ORDER BY date DESC
    LIMIT 1
  `).get(store);
}

export function formatCheckoutStepLabel(step) {
  const key = normalizeCheckoutStep(step);
  if (!key) return '—';
  return CHECKOUT_STEP_LABELS[key] || key;
}

