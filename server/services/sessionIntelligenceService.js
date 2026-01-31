import { createHash, randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { askOpenAIChat } from './openaiService.js';

const RAW_RETENTION_HOURS = parseInt(process.env.SESSION_INTELLIGENCE_RAW_RETENTION_HOURS || '72', 10);
const ABANDON_AFTER_HOURS = parseInt(process.env.SESSION_INTELLIGENCE_ABANDON_AFTER_HOURS || '24', 10);
const SESSION_IDLE_MINUTES = parseInt(process.env.SESSION_INTELLIGENCE_SESSION_IDLE_MINUTES || '30', 10);
const CHECKOUT_DROP_MINUTES = parseInt(process.env.SESSION_INTELLIGENCE_CHECKOUT_DROP_MINUTES || '30', 10);
const RAW_CLEANUP_ENABLED = safeString(process.env.SESSION_INTELLIGENCE_RAW_CLEANUP_ENABLED)
  .toLowerCase()
  .trim() === 'true';

const CHECKOUT_STEP_LABELS = {
  contact: 'Contact',
  shipping: 'Shipping',
  payment: 'Payment',
  review: 'Review',
  thank_you: 'Thank you'
};

const SHOPPER_BACKFILL_COOLDOWN_MS = 5 * 60 * 1000;
const lastShopperBackfillByStore = new Map();

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

function safeTruncate(value, max = 240) {
  const str = safeString(value);
  if (!str) return null;
  return str.length > max ? str.slice(0, max) : str;
}

function getOrCreateShopperNumber(store, clientId, eventTs) {
  if (!store || !clientId) return null;
  const db = getDb();

  const normalizedStore = safeString(store).trim() || 'shawq';
  const normalizedClientId = safeString(clientId).trim();
  if (!normalizedClientId) return null;

  const now = normalizeSqliteDateTime();
  const seenAt = eventTs || now;

  const tx = db.transaction(() => {
    const existing = db.prepare(`
      SELECT shopper_number
      FROM si_shoppers
      WHERE store = ? AND client_id = ?
    `).get(normalizedStore, normalizedClientId);

    if (existing?.shopper_number) {
      db.prepare(`
        UPDATE si_shoppers
        SET last_seen_at = CASE
          WHEN last_seen_at IS NULL THEN ?
          WHEN ? > last_seen_at THEN ?
          ELSE last_seen_at
        END
        WHERE store = ? AND client_id = ?
      `).run(seenAt, seenAt, seenAt, normalizedStore, normalizedClientId);

      return Number(existing.shopper_number) || null;
    }

    const next = db.prepare(`
      SELECT COALESCE(MAX(shopper_number), 0) + 1 AS next
      FROM si_shoppers
      WHERE store = ?
    `).get(normalizedStore)?.next;

    const shopperNumber = Number(next) || 1;

    db.prepare(`
      INSERT INTO si_shoppers (store, client_id, shopper_number, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(normalizedStore, normalizedClientId, shopperNumber, seenAt, seenAt);

    return shopperNumber;
  });

  try {
    return tx.immediate();
  } catch (e) {
    // If we raced on unique(store, client_id), read it back.
    const row = db.prepare(`
      SELECT shopper_number
      FROM si_shoppers
      WHERE store = ? AND client_id = ?
    `).get(normalizedStore, normalizedClientId);
    return row?.shopper_number ? Number(row.shopper_number) : null;
  }
}

function ensureRecentShopperNumbers(store) {
  const normalizedStore = safeString(store).trim() || 'shawq';
  const now = Date.now();
  const last = lastShopperBackfillByStore.get(normalizedStore) || 0;
  if (now - last < SHOPPER_BACKFILL_COOLDOWN_MS) return;
  lastShopperBackfillByStore.set(normalizedStore, now);

  const db = getDb();
  const retentionWindow = `-${RAW_RETENTION_HOURS} hours`;

  const clients = db.prepare(`
    SELECT client_id, MIN(created_at) AS first_seen
    FROM si_events
    WHERE store = ?
      AND client_id IS NOT NULL
      AND client_id != ''
      AND created_at >= datetime('now', ?)
    GROUP BY client_id
    ORDER BY first_seen ASC
  `).all(normalizedStore, retentionWindow);

  for (const row of clients) {
    getOrCreateShopperNumber(normalizedStore, row.client_id, row.first_seen);
  }

  db.prepare(`
    UPDATE si_events
    SET shopper_number = (
      SELECT shopper_number
      FROM si_shoppers s
      WHERE s.store = si_events.store
        AND s.client_id = si_events.client_id
    )
    WHERE store = ?
      AND shopper_number IS NULL
      AND client_id IS NOT NULL
      AND client_id != ''
      AND created_at >= datetime('now', ?)
  `).run(normalizedStore, retentionWindow);

  db.prepare(`
    UPDATE si_sessions
    SET shopper_number = (
      SELECT shopper_number
      FROM si_shoppers s
      WHERE s.store = si_sessions.store
        AND s.client_id = si_sessions.client_id
    )
    WHERE store = ?
      AND shopper_number IS NULL
      AND client_id IS NOT NULL
      AND client_id != ''
  `).run(normalizedStore);
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function extractJsonObjectFromText(text) {
  const raw = safeString(text).trim();
  if (!raw) return null;
  const direct = safeJsonParse(raw);
  if (direct && typeof direct === 'object') return direct;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return safeJsonParse(match[0]);
}

function makeSessionCodename(sessionId) {
  const raw = safeString(sessionId).trim();
  if (!raw) return 'S-UNKNOWN';
  const hex = createHash('sha256').update(raw).digest('hex').slice(0, 10);
  const code = BigInt(`0x${hex}`).toString(36).toUpperCase().padStart(8, '0');
  return `S-${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

function extractProductIdsFromCart(cartJson) {
  if (!cartJson || typeof cartJson !== 'string') return new Set();
  const parsed = safeJsonParse(cartJson);
  if (!parsed || typeof parsed !== 'object') return new Set();

  const items =
    parsed?.lines ||
    parsed?.lineItems ||
    parsed?.items ||
    parsed?.cartLines ||
    parsed?.cart_lines ||
    null;

  const list = Array.isArray(items) ? items : [];
  const ids = new Set();
  for (const line of list) {
    const productId =
      normalizeShopifyId(line?.merchandise?.product?.id) ||
      normalizeShopifyId(line?.product?.id) ||
      normalizeShopifyId(line?.productId) ||
      normalizeShopifyId(line?.product_id) ||
      null;
    if (productId) ids.add(productId);
  }
  return ids;
}

function extractSizeLabelFromDataJson(dataJson) {
  if (!dataJson || typeof dataJson !== 'string') return null;
  const parsed = safeJsonParse(dataJson);
  if (!parsed || typeof parsed !== 'object') return null;

  const candidate =
    parsed?.size ||
    parsed?.selectedSize ||
    parsed?.selected_size ||
    parsed?.variantTitle ||
    parsed?.variant_title ||
    parsed?.option1 ||
    parsed?.option2 ||
    parsed?.option3 ||
    (Array.isArray(parsed?.options) ? parsed.options.join(' / ') : null) ||
    null;

  if (!candidate) return null;
  const str = safeString(candidate).trim();
  if (!str) return null;
  return str.length > 80 ? str.slice(0, 80) : str;
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

function inferCheckoutStepFromEvent(eventName, eventDataRaw) {
  const name = safeString(eventName).toLowerCase().trim();
  const fromData =
    normalizeCheckoutStep(eventDataRaw?.checkout?.step) ||
    normalizeCheckoutStep(eventDataRaw?.checkout?.checkoutStep) ||
    normalizeCheckoutStep(eventDataRaw?.checkoutStep) ||
    null;
  if (fromData) return fromData;

  if (name === 'checkout_started' || name === 'checkout_initiated' || name === 'begin_checkout') return 'contact';
  if (name.includes('contact') && name.includes('submitted')) return 'contact';
  if (name.includes('shipping') && name.includes('submitted')) return 'shipping';
  if (name.includes('payment') && name.includes('submitted')) return 'payment';
  if (name === 'checkout_completed' || name === 'purchase' || name === 'order_completed' || name === 'order_placed') {
    return 'thank_you';
  }

  return null;
}

function inferDeviceType(payload) {
  const envelope = getEventEnvelope(payload);
  const ua =
    payload?.context?.navigator?.userAgent ||
    payload?.context?.navigator?.user_agent ||
    payload?.context?.userAgent ||
    payload?.context?.user_agent ||
    envelope?.context?.navigator?.userAgent ||
    envelope?.context?.navigator?.user_agent ||
    envelope?.context?.userAgent ||
    envelope?.context?.user_agent ||
    payload?.userAgent ||
    payload?.user_agent ||
    envelope?.userAgent ||
    envelope?.user_agent ||
    '';

  const agent = safeString(ua);
  if (!agent) return null;
  if (/ipad|tablet|silk/i.test(agent)) return 'tablet';
  if (/mobi|iphone|android/i.test(agent)) return 'mobile';
  return 'desktop';
}

function extractCountryCode(payload) {
  const envelope = getEventEnvelope(payload);
  const candidates = [
    payload?.geoipCountryCode,
    payload?.countryCode,
    payload?.country_code,
    payload?.data?.checkout?.shippingAddress?.countryCode,
    payload?.data?.checkout?.billingAddress?.countryCode,
    envelope?.geoipCountryCode,
    envelope?.countryCode,
    envelope?.country_code,
    envelope?.data?.checkout?.shippingAddress?.countryCode,
    envelope?.data?.checkout?.billingAddress?.countryCode
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

function extractAttributionFields(campaign) {
  if (!campaign || typeof campaign !== 'object') {
    return {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      fbclid: null,
      gclid: null,
      ttclid: null,
      msclkid: null,
      wbraid: null,
      gbraid: null,
      irclickid: null
    };
  }

  return {
    utm_source: safeTruncate(campaign.utm_source),
    utm_medium: safeTruncate(campaign.utm_medium),
    utm_campaign: safeTruncate(campaign.utm_campaign),
    utm_content: safeTruncate(campaign.utm_content),
    utm_term: safeTruncate(campaign.utm_term),
    fbclid: safeTruncate(campaign.fbclid),
    gclid: safeTruncate(campaign.gclid),
    ttclid: safeTruncate(campaign.ttclid),
    msclkid: safeTruncate(campaign.msclkid),
    wbraid: safeTruncate(campaign.wbraid),
    gbraid: safeTruncate(campaign.gbraid),
    irclickid: safeTruncate(campaign.irclickid)
  };
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
  const envelope = getEventEnvelope(payload);
  const candidates = [
    payload?.context?.document?.location?.href,
    payload?.context?.document?.location?.url,
    payload?.context?.document?.location?.pathname,
    envelope?.context?.document?.location?.href,
    envelope?.context?.document?.location?.url,
    envelope?.context?.document?.location?.pathname,
    payload?.page_url,
    payload?.pageUrl,
    payload?.url,
    envelope?.page_url,
    envelope?.pageUrl,
    envelope?.url
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
  const envelope = getEventEnvelope(payload);
  const sessionCandidates = [
    payload?.context?.sessionId,
    payload?.context?.session_id,
    payload?.sessionId,
    payload?.session_id,
    envelope?.context?.sessionId,
    envelope?.context?.session_id,
    envelope?.sessionId,
    envelope?.session_id
  ];

  const clientCandidates = [
    payload?.context?.clientId,
    payload?.context?.client_id,
    payload?.clientId,
    payload?.client_id,
    envelope?.context?.clientId,
    envelope?.context?.client_id,
    envelope?.clientId,
    envelope?.client_id
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

function normalizeShopifyId(id) {
  const raw = safeString(id).trim();
  if (!raw) return null;
  if (raw.startsWith('gid://')) return raw.slice(0, 120);
  return raw.slice(0, 64);
}

function extractProductIdentifiers(eventDataRaw) {
  if (!eventDataRaw || typeof eventDataRaw !== 'object') return { productId: null, variantId: null };

  const pv = eventDataRaw.productVariant || eventDataRaw.product_variant || null;
  const productFromPv = pv?.product || null;

  const productId =
    normalizeShopifyId(productFromPv?.id) ||
    normalizeShopifyId(eventDataRaw?.product?.id) ||
    normalizeShopifyId(eventDataRaw?.productId) ||
    normalizeShopifyId(eventDataRaw?.product_id) ||
    null;

  const variantId =
    normalizeShopifyId(pv?.id) ||
    normalizeShopifyId(eventDataRaw?.variant?.id) ||
    normalizeShopifyId(eventDataRaw?.variantId) ||
    normalizeShopifyId(eventDataRaw?.variant_id) ||
    null;

  if (productId || variantId) return { productId, variantId };

  const line =
    eventDataRaw?.cartLine ||
    eventDataRaw?.lineItem ||
    eventDataRaw?.line_item ||
    eventDataRaw?.cart_line ||
    null;

  const merch = line?.merchandise || line?.variant || null;
  const productFromMerch = merch?.product || null;

  return {
    productId: normalizeShopifyId(productFromMerch?.id) || null,
    variantId: normalizeShopifyId(merch?.id) || null
  };
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
  const attribution = extractAttributionFields(location?.campaign);
  const product = extractProductIdentifiers(eventDataRaw);
  const checkoutTokenFromData =
    safeString(eventDataRaw?.checkout?.token || eventDataRaw?.checkout?.id || eventDataRaw?.checkoutToken).trim() ||
    null;
  const checkoutToken = location.checkoutToken || checkoutTokenFromData;
  const checkoutStep =
    location.checkoutStep ||
    inferCheckoutStepFromEvent(eventName, eventDataRaw) ||
    null;

  const clientId = identifiers.clientId || null;
  const shopperNumber = clientId ? getOrCreateShopperNumber(store, clientId, eventTs) : null;
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
  if (product?.productId) siMeta.product_id = product.productId;
  if (product?.variantId) siMeta.variant_id = product.variantId;

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
      shopper_number,
      source,
      event_name,
      event_ts,
      page_url,
      page_path,
      checkout_token,
      checkout_step,
      device_type,
      country_code,
      product_id,
      variant_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      fbclid,
      gclid,
      ttclid,
      msclkid,
      wbraid,
      gbraid,
      irclickid,
      data_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = normalizeSqliteDateTime();
  const lastCampaignJson = location?.campaign ? JSON.stringify(location.campaign) : null;

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
      shopper_number,
      last_device_type,
      last_country_code,
      last_product_id,
      last_variant_id,
      last_campaign_json,
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
      shopper_number = COALESCE(excluded.shopper_number, si_sessions.shopper_number),
      last_device_type = COALESCE(excluded.last_device_type, si_sessions.last_device_type),
      last_country_code = COALESCE(excluded.last_country_code, si_sessions.last_country_code),
      last_product_id = COALESCE(excluded.last_product_id, si_sessions.last_product_id),
      last_variant_id = COALESCE(excluded.last_variant_id, si_sessions.last_variant_id),
      last_campaign_json = COALESCE(excluded.last_campaign_json, si_sessions.last_campaign_json),
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
      shopperNumber,
      source,
      eventName,
      eventTs,
      location.pageUrl,
      location.pagePath,
      checkoutToken,
      checkoutStep,
      deviceType,
      countryCode,
      product?.productId || null,
      product?.variantId || null,
      attribution.utm_source,
      attribution.utm_medium,
      attribution.utm_campaign,
      attribution.utm_content,
      attribution.utm_term,
      attribution.fbclid,
      attribution.gclid,
      attribution.ttclid,
      attribution.msclkid,
      attribution.wbraid,
      attribution.gbraid,
      attribution.irclickid,
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
      checkoutStep,
      cartJson,
      shopperNumber,
      deviceType,
      countryCode,
      product?.productId || null,
      product?.variantId || null,
      lastCampaignJson,
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
    checkoutStep
  };
}

export function cleanupSessionIntelligenceRaw({ retentionHours = RAW_RETENTION_HOURS } = {}) {
  if (!RAW_CLEANUP_ENABLED) {
    return { deletedEvents: 0, retentionHours: null, cleanupEnabled: false };
  }

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

  return { deletedEvents: result.changes || 0, retentionHours: hours, cleanupEnabled: true };
}

export function getSessionIntelligenceOverview(store) {
  const db = getDb();
  ensureRecentShopperNumbers(store);

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

  const retentionWindow = `-${RAW_RETENTION_HOURS} hours`;

  const purchaseRows = db.prepare(`
    SELECT session_id, last_cart_json
    FROM si_sessions
    WHERE store = ?
      AND purchase_at IS NOT NULL
      AND purchase_at >= datetime('now', ?)
  `).all(store, retentionWindow);

  const purchasedSessionIds = new Set();
  const purchasedProductsBySession = new Map();
  for (const row of purchaseRows) {
    if (!row?.session_id) continue;
    purchasedSessionIds.add(row.session_id);
    const ids = extractProductIdsFromCart(row.last_cart_json);
    if (ids.size > 0) {
      purchasedProductsBySession.set(row.session_id, ids);
    }
  }

  const purchaseEventRows = db.prepare(`
    SELECT session_id, product_id
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', ?)
      AND product_id IS NOT NULL
      AND lower(event_name) IN ('checkout_completed','purchase','order_completed','order_placed')
  `).all(store, retentionWindow);

  for (const row of purchaseEventRows) {
    if (!row?.session_id || !row?.product_id) continue;
    const set = purchasedProductsBySession.get(row.session_id) || new Set();
    set.add(row.product_id);
    purchasedProductsBySession.set(row.session_id, set);
    purchasedSessionIds.add(row.session_id);
  }

  const viewEventRows = db.prepare(`
    SELECT session_id, product_id, page_path
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', ?)
      AND product_id IS NOT NULL
      AND lower(event_name) IN ('product_viewed','product_view','view_item','product_detail_viewed')
  `).all(store, retentionWindow);

  const viewedNotBought = new Map();
  for (const row of viewEventRows) {
    if (!row?.session_id || !row?.product_id) continue;
    if (!purchasedSessionIds.has(row.session_id)) continue;
    const purchasedSet = purchasedProductsBySession.get(row.session_id);
    if (!purchasedSet || purchasedSet.size === 0) continue;
    if (purchasedSet.has(row.product_id)) continue;

    const entry = viewedNotBought.get(row.product_id) || {
      product_id: row.product_id,
      product_path: row.page_path || null,
      views: 0,
      sessions: new Set()
    };
    entry.views += 1;
    entry.sessions.add(row.session_id);
    if (!entry.product_path && row.page_path) entry.product_path = row.page_path;
    viewedNotBought.set(row.product_id, entry);
  }

  const mostViewedNotBought = Array.from(viewedNotBought.values())
    .map((entry) => ({
      product_id: entry.product_id,
      product_path: entry.product_path,
      views: entry.views,
      sessions: entry.sessions.size
    }))
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 6);

  const oosEvents = db.prepare(`
    SELECT product_id, variant_id, data_json
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', ?)
      AND lower(event_name) IN (
        'out_of_stock_size_clicked',
        'oos_size_clicked',
        'size_out_of_stock_clicked',
        'variant_out_of_stock_clicked',
        'variant_unavailable_clicked',
        'out_of_stock_click',
        'oos_clicked'
      )
    LIMIT 5000
  `).all(store, retentionWindow);

  const oosCounts = new Map();
  for (const row of oosEvents) {
    const sizeLabel = extractSizeLabelFromDataJson(row?.data_json);
    const key = [
      sizeLabel || '',
      row?.variant_id || '',
      row?.product_id || ''
    ].join('|');
    if (key === '||') continue;
    const entry = oosCounts.get(key) || {
      size_label: sizeLabel || null,
      variant_id: row?.variant_id || null,
      product_id: row?.product_id || null,
      clicks: 0
    };
    entry.clicks += 1;
    oosCounts.set(key, entry);
  }

  const outOfStockSizesClicked = Array.from(oosCounts.values())
    .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
    .slice(0, 6);

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
    checkoutDropoffsByStep: dropoffsByStep,
    insights: {
      mostViewedNotBought,
      outOfStockSizesClicked
    }
  };
}

export function getSessionIntelligenceRecentEvents(store, limit = 80) {
  const db = getDb();
  ensureRecentShopperNumbers(store);
  const max = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 500);
  return db.prepare(`
    SELECT
      id,
      store,
      session_id,
      client_id,
      shopper_number,
      source,
      event_name,
      event_ts,
      page_url,
      page_path,
      checkout_token,
      checkout_step,
      device_type,
      country_code,
      product_id,
      variant_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      fbclid,
      gclid,
      ttclid,
      msclkid,
      wbraid,
      gbraid,
      irclickid,
      created_at
    FROM si_events
    WHERE store = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(store, max);
}

export function getSessionIntelligenceSessions(store, limit = 60) {
  const db = getDb();
  ensureRecentShopperNumbers(store);
  const max = Math.min(Math.max(parseInt(limit, 10) || 60, 1), 500);
  return db.prepare(`
    SELECT
      id,
      store,
      session_id,
      client_id,
      shopper_number,
      started_at,
      last_event_at,
      atc_at,
      checkout_started_at,
      purchase_at,
      last_checkout_token,
      last_checkout_step,
      last_cart_json,
      last_device_type,
      last_country_code,
      last_product_id,
      last_variant_id,
      last_campaign_json,
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

function requireIsoDay(dateStr) {
  const raw = safeString(dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function dayRangeUtc(dateStr) {
  const iso = requireIsoDay(dateStr);
  if (!iso) return null;
  const start = `${iso} 00:00:00`;
  const end = normalizeSqliteDateTime(new Date(Date.parse(`${iso}T00:00:00Z`) + 24 * 60 * 60 * 1000));
  return { start, end };
}

function rangeUtcFromStartEnd(startDay, endDay) {
  const startIso = requireIsoDay(startDay);
  const endIso = requireIsoDay(endDay);
  if (!startIso || !endIso) return null;

  const start = `${startIso} 00:00:00`;
  const endMs = Date.parse(`${endIso}T00:00:00Z`) + 24 * 60 * 60 * 1000;
  const end = normalizeSqliteDateTime(new Date(endMs));
  return { start, end, startIso, endIso };
}

function safeParseJson(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

function campaignLabelFromJson(json) {
  const obj = safeParseJson(json);
  if (!obj || typeof obj !== 'object') return null;
  const utmCampaign = safeString(obj.utm_campaign).trim();
  if (utmCampaign) return safeTruncate(utmCampaign, 160);
  const utmSource = safeString(obj.utm_source).trim();
  if (utmSource) return safeTruncate(utmSource, 160);
  return null;
}

export function getSessionIntelligencePurchasesByCampaign(store, { startDate, endDate, limit = 250 } = {}) {
  const db = getDb();
  ensureRecentShopperNumbers(store);

  const range = rangeUtcFromStartEnd(startDate, endDate);
  if (!range) return { store, period: null, rows: [], totalPurchases: 0 };

  const max = Math.min(Math.max(parseInt(limit, 10) || 250, 1), 2000);

  const sessions = db.prepare(`
    SELECT
      session_id,
      purchase_at,
      COALESCE(last_country_code, '') AS country_code,
      last_campaign_json
    FROM si_sessions
    WHERE store = ?
      AND purchase_at IS NOT NULL
      AND purchase_at >= ?
      AND purchase_at < ?
    ORDER BY purchase_at DESC
  `).all(store, range.start, range.end);

  const totals = new Map();
  for (const row of sessions) {
    const campaign = campaignLabelFromJson(row.last_campaign_json) || '—';
    const country = safeString(row.country_code).trim() || '—';
    const key = `${campaign}||${country}`;
    const entry = totals.get(key) || { campaign, country, purchases: 0 };
    entry.purchases += 1;
    totals.set(key, entry);
  }

  const rows = Array.from(totals.values())
    .sort((a, b) => (b.purchases || 0) - (a.purchases || 0))
    .slice(0, max);

  return {
    store,
    period: { start: range.startIso, end: range.endIso },
    totalPurchases: sessions.length,
    rows
  };
}

export function listSessionIntelligenceDays(store, limit = 10) {
  const db = getDb();
  ensureRecentShopperNumbers(store);
  const max = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 30);
  return db.prepare(`
    SELECT
      substr(created_at, 1, 10) AS day,
      COUNT(*) AS events,
      COUNT(DISTINCT session_id) AS sessions
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', ?)
    GROUP BY substr(created_at, 1, 10)
    ORDER BY day DESC
    LIMIT ?
  `).all(store, `-${RAW_RETENTION_HOURS} hours`, max);
}

export function getSessionIntelligenceSessionsForDay(store, dateStr, limit = 200) {
  const db = getDb();
  ensureRecentShopperNumbers(store);
  const max = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const range = dayRangeUtc(dateStr);
  if (!range) return [];

  return db.prepare(`
    WITH day_events AS (
      SELECT
        session_id,
        MAX(shopper_number) AS shopper_number,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen,
        SUM(CASE WHEN lower(event_name) IN ('product_added_to_cart','add_to_cart','added_to_cart','cart_add','atc') THEN 1 ELSE 0 END) AS atc_events,
        SUM(CASE WHEN lower(event_name) IN ('checkout_started','checkout_initiated','begin_checkout') THEN 1 ELSE 0 END) AS checkout_started_events,
        SUM(CASE WHEN lower(event_name) IN ('checkout_completed','purchase','order_completed','order_placed') THEN 1 ELSE 0 END) AS purchase_events,
        MAX(COALESCE(checkout_step, '')) AS last_checkout_step,
        MAX(COALESCE(device_type, '')) AS device_type,
        MAX(COALESCE(country_code, '')) AS country_code,
        MAX(COALESCE(product_id, '')) AS product_id,
        MAX(COALESCE(variant_id, '')) AS variant_id,
        MAX(COALESCE(utm_campaign, '')) AS utm_campaign,
        MAX(COALESCE(utm_source, '')) AS utm_source
      FROM si_events
      WHERE store = ?
        AND created_at >= ?
        AND created_at < ?
      GROUP BY session_id
    )
    SELECT
      d.session_id,
      d.shopper_number,
      d.first_seen,
      d.last_seen,
      d.atc_events,
      d.checkout_started_events,
      d.purchase_events,
      NULLIF(d.last_checkout_step, '') AS last_checkout_step,
      NULLIF(d.device_type, '') AS device_type,
      NULLIF(d.country_code, '') AS country_code,
      NULLIF(d.product_id, '') AS product_id,
      NULLIF(d.variant_id, '') AS variant_id,
      NULLIF(d.utm_campaign, '') AS utm_campaign,
      NULLIF(d.utm_source, '') AS utm_source,
      s.status,
      s.analyzed_at,
      s.primary_reason,
      s.confidence,
      s.summary
    FROM day_events d
    LEFT JOIN si_sessions s
      ON s.store = ? AND s.session_id = d.session_id
    ORDER BY d.last_seen DESC
    LIMIT ?
  `).all(store, range.start, range.end, store, max).map((row) => ({
    ...row,
    codename: makeSessionCodename(row.session_id)
  }));
}

export function getSessionIntelligenceEventsForDay(store, dateStr, { sessionId = null, limit = 800 } = {}) {
  const db = getDb();
  ensureRecentShopperNumbers(store);
  const max = Math.min(Math.max(parseInt(limit, 10) || 800, 1), 5000);
  const range = dayRangeUtc(dateStr);
  if (!range) return [];

  if (sessionId) {
    return db.prepare(`
      SELECT
        id,
        store,
        session_id,
        event_name,
        event_ts,
        page_path,
        checkout_step,
        device_type,
        country_code,
        product_id,
        variant_id,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        fbclid,
        gclid,
        ttclid,
        msclkid,
        wbraid,
        gbraid,
        irclickid,
        created_at
      FROM si_events
      WHERE store = ?
        AND session_id = ?
        AND created_at >= ?
        AND created_at < ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(store, sessionId, range.start, range.end, max);
  }

  return db.prepare(`
    SELECT
      id,
      store,
      session_id,
      event_name,
      event_ts,
      page_path,
      checkout_step,
      device_type,
      country_code,
      product_id,
      variant_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      fbclid,
      gclid,
      ttclid,
      msclkid,
      wbraid,
      gbraid,
      irclickid,
      created_at
    FROM si_events
    WHERE store = ?
      AND created_at >= ?
      AND created_at < ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(store, range.start, range.end, max);
}

export function getSessionIntelligenceEventsForSession(store, sessionId, limit = 1200) {
  const db = getDb();
  const max = Math.min(Math.max(parseInt(limit, 10) || 1200, 1), 5000);
  return db.prepare(`
    SELECT
      id,
      store,
      session_id,
      event_name,
      event_ts,
      page_path,
      checkout_step,
      device_type,
      country_code,
      product_id,
      variant_id,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      fbclid,
      gclid,
      ttclid,
      msclkid,
      wbraid,
      gbraid,
      irclickid,
      created_at
    FROM si_events
    WHERE store = ?
      AND session_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(store, sessionId, max);
}

function buildAiTimeline(events) {
  return events.map((e) => ({
    t: e.created_at || e.event_ts,
    event: e.event_name,
    path: e.page_path || null,
    checkout_step: e.checkout_step || null,
    product_id: e.product_id || null,
    variant_id: e.variant_id || null,
    device: e.device_type || null,
    country: e.country_code || null,
    utm_campaign: e.utm_campaign || null,
    utm_source: e.utm_source || null
  }));
}

export async function analyzeSessionIntelligenceSession({
  store,
  sessionId,
  model = process.env.SESSION_INTELLIGENCE_AI_MODEL || 'gpt-4o-mini'
}) {
  const db = getDb();
  const events = getSessionIntelligenceEventsForSession(store, sessionId, 1200);
  if (!events.length) {
    return { success: false, error: 'No events found for this session.' };
  }

  db.prepare(`
    UPDATE si_sessions
    SET analysis_state = 'running', updated_at = datetime('now')
    WHERE store = ? AND session_id = ?
  `).run(store, sessionId);

  const codename = makeSessionCodename(sessionId);
  const timeline = buildAiTimeline(events);

  const systemPrompt = [
    'You are an e-commerce UX analyst.',
    'You will be given a single shopper session timeline (privacy-safe: no PII, no typed input values).',
    'Infer likely drop-off reasons (if any), and suggest concrete fixes that move revenue.',
    '',
    'Output STRICT JSON only (no markdown), with this schema:',
    '{',
    '  \"primary_reason\": string,',
    '  \"confidence\": number,',
    '  \"summary\": string,',
    '  \"reasons\": [ { \"reason\": string, \"confidence\": number, \"evidence\": string[], \"fixes\": string[] } ]',
    '}',
    '',
    'Rules:',
    '- If the data is insufficient, say so in \"summary\" and keep confidence low.',
    '- Never invent products, prices, or user intent beyond what events show.',
    '- Evidence must reference concrete events/steps (e.g. \"checkout_started then no further checkout step\").'
  ].join('\n');

  let text = '';
  let usedModel = model;
  try {
    text = await askOpenAIChat({
      model,
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ store, session_codename: codename, session_id: sessionId, timeline })
        }
      ],
      maxOutputTokens: 900,
      verbosity: 'low'
    });
  } catch (error) {
    if (model !== 'gpt-4o-mini') {
      try {
        usedModel = 'gpt-4o-mini';
        text = await askOpenAIChat({
          model: usedModel,
          systemPrompt,
          messages: [
            {
              role: 'user',
              content: JSON.stringify({ store, session_codename: codename, session_id: sessionId, timeline })
            }
          ],
          maxOutputTokens: 900,
          verbosity: 'low'
        });
      } catch (fallbackError) {
        db.prepare(`
          UPDATE si_sessions
          SET analysis_state = 'error', updated_at = datetime('now')
          WHERE store = ? AND session_id = ?
        `).run(store, sessionId);
        return { success: false, error: fallbackError?.message || error?.message || 'AI request failed.' };
      }
    } else {
      db.prepare(`
        UPDATE si_sessions
        SET analysis_state = 'error', updated_at = datetime('now')
        WHERE store = ? AND session_id = ?
      `).run(store, sessionId);
      return { success: false, error: error?.message || 'AI request failed.' };
    }
  }

  const parsed = extractJsonObjectFromText(text);
  if (!parsed) {
    db.prepare(`
      UPDATE si_sessions
      SET analysis_state = 'error', updated_at = datetime('now')
      WHERE store = ? AND session_id = ?
    `).run(store, sessionId);
    return { success: false, error: 'AI response was not valid JSON.' };
  }

  const primaryReason = safeTruncate(parsed.primary_reason, 160);
  const confidence = Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : null;
  const summary = safeTruncate(parsed.summary, 900);
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 6) : [];

  db.prepare(`
    UPDATE si_sessions
    SET
      analysis_state = 'done',
      analyzed_at = datetime('now'),
      primary_reason = ?,
      confidence = ?,
      summary = ?,
      reasons_json = ?,
      model = ?,
      updated_at = datetime('now')
    WHERE store = ? AND session_id = ?
  `).run(
    primaryReason,
    confidence,
    summary,
    JSON.stringify(reasons),
    usedModel,
    store,
    sessionId
  );

  return {
    success: true,
    store,
    sessionId,
    codename,
    analysis: { primaryReason, confidence, summary, reasons, model: usedModel }
  };
}

export async function analyzeSessionIntelligenceDay({
  store,
  date,
  mode = 'high_intent',
  limit = 20,
  model = process.env.SESSION_INTELLIGENCE_AI_MODEL || 'gpt-4o-mini'
}) {
  const sessions = getSessionIntelligenceSessionsForDay(store, date, 1000);
  const max = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const concurrency = Math.min(
    Math.max(parseInt(process.env.SESSION_INTELLIGENCE_AI_CONCURRENCY || '3', 10) || 3, 1),
    10
  );

  const selected = (() => {
    if (mode === 'all') return sessions;
    if (mode === 'checkout_no_purchase') {
      return sessions.filter((s) => (s.checkout_started_events || 0) > 0 && (s.purchase_events || 0) === 0);
    }
    return sessions.filter((s) => (s.atc_events || 0) > 0 && (s.purchase_events || 0) === 0);
  })().slice(0, max);

  const results = new Array(selected.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= selected.length) return;

      const session = selected[idx];
      // eslint-disable-next-line no-await-in-loop
      const result = await analyzeSessionIntelligenceSession({ store, sessionId: session.session_id, model });
      results[idx] = {
        session_id: session.session_id,
        codename: session.codename,
        success: result.success,
        error: result.error || null,
        analysis: result.analysis || null
      };
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, () => worker()));

  return { success: true, store, date, mode, limit: max, analyzed: results.length, results };
}
