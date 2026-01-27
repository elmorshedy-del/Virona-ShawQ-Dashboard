import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';

const RAW_RETENTION_HOURS = parseInt(process.env.SESSION_INTELLIGENCE_RAW_RETENTION_HOURS || '72', 10);
const ABANDON_AFTER_HOURS = parseInt(process.env.SESSION_INTELLIGENCE_ABANDON_AFTER_HOURS || '24', 10);
const SESSION_IDLE_MINUTES = parseInt(process.env.SESSION_INTELLIGENCE_SESSION_IDLE_MINUTES || '30', 10);
const CHECKOUT_DROP_MINUTES = parseInt(process.env.SESSION_INTELLIGENCE_CHECKOUT_DROP_MINUTES || '30', 10);

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

function parseSqliteDateTimeToMs(value) {
  if (!value || typeof value !== 'string') return NaN;
  if (value.includes('T')) return Date.parse(value);
  return Date.parse(`${value.replace(' ', 'T')}Z`);
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

function inferDeviceType(payload) {
  const ua =
    payload?.context?.navigator?.userAgent ||
    payload?.context?.navigator?.user_agent ||
    payload?.context?.userAgent ||
    payload?.context?.user_agent ||
    payload?.userAgent ||
    payload?.user_agent ||
    '';

  const agent = safeString(ua);
  if (!agent) return null;
  if (/ipad|tablet|silk/i.test(agent)) return 'tablet';
  if (/mobi|iphone|android/i.test(agent)) return 'mobile';
  return 'desktop';
}

function extractCountryCode(payload) {
  const candidates = [
    payload?.geoipCountryCode,
    payload?.countryCode,
    payload?.country_code,
    payload?.data?.checkout?.shippingAddress?.countryCode,
    payload?.data?.checkout?.billingAddress?.countryCode
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim())) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

const ALLOWED_QUERY_KEYS = new Set([
  'step',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'ttclid',
  'msclkid',
  'wbraid',
  'gbraid',
  'irclickid'
]);

function buildSafeQuery(url, forcedStep) {
  const params = new URLSearchParams();
  for (const key of ALLOWED_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    params.set(key, value.slice(0, 240));
  }
  if (forcedStep) {
    params.set('step', forcedStep);
  }
  return params.toString();
}

function extractCampaign(url) {
  const keys = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'gclid',
    'ttclid',
    'msclkid',
    'wbraid',
    'gbraid',
    'irclickid'
  ];
  const out = {};
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value) out[key] = value.slice(0, 240);
  }
  return Object.keys(out).length ? out : null;
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
        const safeQuery = buildSafeQuery(url, inferredStep);
        const safeUrl = safeQuery ? `${url.pathname}?${safeQuery}` : url.pathname;
        const campaign = extractCampaign(url);
        return {
          pageUrl: safeUrl,
          pagePath: url.pathname,
          checkoutToken,
          checkoutStep: inferredStep,
          campaign
        };
      }

      // Fallback for raw path strings
      if (value.startsWith('/')) {
        const checkoutToken = extractCheckoutTokenFromPath(value);
        const inferredStep = value.includes('/checkouts/')
          ? (value.includes('thank_you') ? 'thank_you' : 'contact')
          : null;
        return { pageUrl: value, pagePath: value, checkoutToken, checkoutStep: inferredStep, campaign: null };
      }
    }
  }

  return { pageUrl: null, pagePath: null, checkoutToken: null, checkoutStep: null, campaign: null };
}

function extractSessionIdentifiers(payload) {
  const sessionCandidates = [
    payload?.context?.sessionId,
    payload?.context?.session_id,
    payload?.sessionId,
    payload?.session_id
  ];

  const clientCandidates = [
    payload?.context?.clientId,
    payload?.context?.client_id,
    payload?.clientId,
    payload?.client_id
  ];

  let sessionId = null;
  for (const value of sessionCandidates) {
    if (typeof value === 'string' && value.trim()) {
      sessionId = value.trim();
      break;
    }
  }

  let clientId = null;
  for (const value of clientCandidates) {
    if (typeof value === 'string' && value.trim()) {
      clientId = value.trim();
      break;
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
  if (eventData.cart && typeof eventData.cart === 'object') return eventData.cart;
  if (eventData.checkout && typeof eventData.checkout === 'object') return eventData.checkout;
  if (eventData?.checkout?.cart && typeof eventData.checkout.cart === 'object') return eventData.checkout.cart;

  const singleLine = eventData?.cartLine || eventData?.lineItem || eventData?.line_item;
  if (singleLine && typeof singleLine === 'object') {
    return { lines: [singleLine] };
  }

  return null;
}

function getOrCreateSessionId(store, clientId, eventTs) {
  if (!store || !clientId) return null;
  const db = getDb();

  const idleMinutes = Number.isFinite(SESSION_IDLE_MINUTES) && SESSION_IDLE_MINUTES > 0 ? SESSION_IDLE_MINUTES : 30;
  const idleMs = idleMinutes * 60 * 1000;
  const eventMs = parseSqliteDateTimeToMs(eventTs) || Date.now();

  const row = db.prepare(`
    SELECT session_id, last_seen_at
    FROM si_client_sessions
    WHERE store = ? AND client_id = ?
  `).get(store, clientId);

  const lastSeenMs = row?.last_seen_at ? (parseSqliteDateTimeToMs(row.last_seen_at) || NaN) : NaN;
  const withinIdle = Number.isFinite(lastSeenMs) && eventMs >= lastSeenMs && (eventMs - lastSeenMs) <= idleMs;

  const sessionId = withinIdle && row?.session_id
    ? row.session_id
    : `si:${clientId.slice(0, 12)}:${randomUUID().slice(0, 8)}`;

  db.prepare(`
    INSERT INTO si_client_sessions (store, client_id, session_id, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(store, client_id) DO UPDATE SET
      session_id = excluded.session_id,
      last_seen_at = CASE
        WHEN si_client_sessions.last_seen_at IS NULL THEN excluded.last_seen_at
        WHEN excluded.last_seen_at IS NULL THEN si_client_sessions.last_seen_at
        WHEN excluded.last_seen_at > si_client_sessions.last_seen_at THEN excluded.last_seen_at
        ELSE si_client_sessions.last_seen_at
      END
  `).run(store, clientId, sessionId, eventTs);

  return sessionId;
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
  const deviceType = inferDeviceType(payload);
  const countryCode = extractCountryCode(payload);
  const checkoutTokenFromData =
    safeString(eventDataRaw?.checkout?.token || eventDataRaw?.checkout?.id || eventDataRaw?.checkoutToken).trim() ||
    null;
  const checkoutToken = location.checkoutToken || checkoutTokenFromData;

  const clientId = identifiers.clientId || null;
  const sessionId =
    identifiers.sessionId ||
    (clientId ? getOrCreateSessionId(store, clientId, eventTs) : null) ||
    (checkoutToken ? `checkout:${checkoutToken}` : null) ||
    `anon:${randomUUID()}`;

  const cartSnapshot = extractCartSnapshot(eventDataRaw);
  const cartJson = cartSnapshot ? JSON.stringify(scrubSensitive(cartSnapshot)) : null;

  const siMeta = {};
  if (deviceType) siMeta.device_type = deviceType;
  if (countryCode) siMeta.country_code = countryCode;
  if (location?.campaign) siMeta.campaign = location.campaign;

  const dataToStore = (() => {
    if (eventData && typeof eventData === 'object' && !Array.isArray(eventData)) {
      return Object.keys(siMeta).length ? { ...eventData, _si: siMeta } : eventData;
    }
    if (!eventData && Object.keys(siMeta).length === 0) return null;
    return { data: eventData, _si: siMeta };
  })();

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
      started_at = CASE
        WHEN si_sessions.started_at IS NULL THEN excluded.started_at
        WHEN excluded.started_at IS NULL THEN si_sessions.started_at
        WHEN excluded.started_at < si_sessions.started_at THEN excluded.started_at
        ELSE si_sessions.started_at
      END,
      last_event_at = CASE
        WHEN si_sessions.last_event_at IS NULL THEN excluded.last_event_at
        WHEN excluded.last_event_at IS NULL THEN si_sessions.last_event_at
        WHEN excluded.last_event_at > si_sessions.last_event_at THEN excluded.last_event_at
        ELSE si_sessions.last_event_at
      END,
      atc_at = CASE
        WHEN excluded.atc_at IS NULL THEN si_sessions.atc_at
        WHEN si_sessions.atc_at IS NULL THEN excluded.atc_at
        WHEN excluded.atc_at > si_sessions.atc_at THEN excluded.atc_at
        ELSE si_sessions.atc_at
      END,
      checkout_started_at = CASE
        WHEN excluded.checkout_started_at IS NULL THEN si_sessions.checkout_started_at
        WHEN si_sessions.checkout_started_at IS NULL THEN excluded.checkout_started_at
        WHEN excluded.checkout_started_at > si_sessions.checkout_started_at THEN excluded.checkout_started_at
        ELSE si_sessions.checkout_started_at
      END,
      purchase_at = CASE
        WHEN excluded.purchase_at IS NULL THEN si_sessions.purchase_at
        WHEN si_sessions.purchase_at IS NULL THEN excluded.purchase_at
        WHEN excluded.purchase_at > si_sessions.purchase_at THEN excluded.purchase_at
        ELSE si_sessions.purchase_at
      END,
      last_checkout_token = COALESCE(excluded.last_checkout_token, si_sessions.last_checkout_token),
      last_checkout_step = COALESCE(excluded.last_checkout_step, si_sessions.last_checkout_step),
      last_cart_json = COALESCE(excluded.last_cart_json, si_sessions.last_cart_json),
      status = CASE
        WHEN (
          CASE
            WHEN excluded.purchase_at IS NULL THEN si_sessions.purchase_at
            WHEN si_sessions.purchase_at IS NULL THEN excluded.purchase_at
            WHEN excluded.purchase_at > si_sessions.purchase_at THEN excluded.purchase_at
            ELSE si_sessions.purchase_at
          END
        ) IS NOT NULL THEN 'purchased'
        WHEN (
          CASE
            WHEN excluded.checkout_started_at IS NULL THEN si_sessions.checkout_started_at
            WHEN si_sessions.checkout_started_at IS NULL THEN excluded.checkout_started_at
            WHEN excluded.checkout_started_at > si_sessions.checkout_started_at THEN excluded.checkout_started_at
            ELSE si_sessions.checkout_started_at
          END
        ) IS NOT NULL THEN 'checkout'
        WHEN (
          CASE
            WHEN excluded.atc_at IS NULL THEN si_sessions.atc_at
            WHEN si_sessions.atc_at IS NULL THEN excluded.atc_at
            WHEN excluded.atc_at > si_sessions.atc_at THEN excluded.atc_at
            ELSE si_sessions.atc_at
          END
        ) IS NOT NULL THEN 'atc'
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
      dataToStore ? JSON.stringify(dataToStore) : null
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

  const checkoutDropMinutes = Number.isFinite(CHECKOUT_DROP_MINUTES) && CHECKOUT_DROP_MINUTES > 0
    ? CHECKOUT_DROP_MINUTES
    : 30;

  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND started_at >= datetime('now', '-24 hours')) AS sessions_24h,
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND atc_at >= datetime('now', '-24 hours')) AS atc_sessions_24h,
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND checkout_started_at >= datetime('now', '-24 hours')) AS checkout_sessions_24h,
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND purchase_at >= datetime('now', '-24 hours')) AS purchases_sessions_24h,
      (SELECT COUNT(*) FROM si_sessions WHERE store = ? AND atc_at IS NOT NULL AND purchase_at IS NULL AND atc_at <= datetime('now', ?)) AS atc_abandoned,
      (SELECT COUNT(*) FROM si_sessions
        WHERE store = ?
          AND checkout_started_at IS NOT NULL
          AND purchase_at IS NULL
          AND checkout_started_at >= datetime('now', '-24 hours')
          AND last_event_at <= datetime('now', ?)
      ) AS checkout_dropped_24h,
      (SELECT COUNT(*) FROM si_sessions
        WHERE store = ?
          AND checkout_started_at IS NOT NULL
          AND purchase_at IS NULL
          AND checkout_started_at >= datetime('now', '-24 hours')
          AND last_event_at > datetime('now', ?)
      ) AS checkout_in_progress
  `).get(
    store,
    store,
    store,
    store,
    store,
    `-${ABANDON_AFTER_HOURS} hours`,
    store,
    `-${checkoutDropMinutes} minutes`,
    store,
    `-${checkoutDropMinutes} minutes`
  );

  const eventCounts = db.prepare(`
    SELECT lower(event_name) AS name, COUNT(*) AS count
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', '-24 hours')
      AND lower(event_name) IN (
        'product_added_to_cart','add_to_cart','added_to_cart','cart_add','atc',
        'checkout_started','checkout_initiated','begin_checkout',
        'checkout_completed','purchase','order_completed','order_placed'
      )
    GROUP BY lower(event_name)
  `).all(store);

  const sumNamed = (names) => {
    const set = new Set(names.map((n) => String(n).toLowerCase()));
    return eventCounts.reduce((sum, row) => (set.has(row.name) ? sum + (Number(row.count) || 0) : sum), 0);
  };

  const atcEvents24h = sumNamed(['product_added_to_cart', 'add_to_cart', 'added_to_cart', 'cart_add', 'atc']);
  const checkoutStartedEvents24h = sumNamed(['checkout_started', 'checkout_initiated', 'begin_checkout']);
  const purchasesEvents24h = sumNamed(['checkout_completed', 'purchase', 'order_completed', 'order_placed']);

  const dropoffs = db.prepare(`
    SELECT
      COALESCE(last_checkout_step, 'unknown') AS step,
      COUNT(*) AS count
    FROM si_sessions
    WHERE store = ?
      AND checkout_started_at IS NOT NULL
      AND purchase_at IS NULL
      AND checkout_started_at >= datetime('now', '-24 hours')
      AND last_event_at <= datetime('now', ?)
    GROUP BY step
    ORDER BY count DESC
  `).all(store, `-${checkoutDropMinutes} minutes`);

  const dropoffsByStep = {};
  for (const entry of dropoffs) {
    const step = safeString(entry.step || 'unknown');
    dropoffsByStep[step] = Number(entry.count) || 0;
  }

  return {
    store,
    retentionHours: RAW_RETENTION_HOURS,
    abandonAfterHours: ABANDON_AFTER_HOURS,
    checkoutDropMinutes,
    kpis: {
      sessions24h: row?.sessions_24h || 0,
      atc24h: row?.atc_sessions_24h || 0,
      atcEvents24h,
      checkoutStarted24h: row?.checkout_sessions_24h || 0,
      checkoutStartedEvents24h,
      purchases24h: row?.purchases_sessions_24h || 0,
      purchasesEvents24h,
      checkoutDropped24h: row?.checkout_dropped_24h || 0,
      checkoutInProgress: row?.checkout_in_progress || 0,
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
