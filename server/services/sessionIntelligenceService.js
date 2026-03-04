import { createHash, randomUUID } from 'crypto';
import { getDb } from '../db/database.js';
import { askOpenAIChat } from './openaiService.js';
import { askDeepSeekChat, normalizeTemperature } from './deepseekService.js';

const RAW_RETENTION_HOURS = parseInt(process.env.SESSION_INTELLIGENCE_RAW_RETENTION_HOURS || '72', 10);
const ABANDON_AFTER_HOURS = parseInt(process.env.SESSION_INTELLIGENCE_ABANDON_AFTER_HOURS || '24', 10);
const SESSION_IDLE_MINUTES = parseInt(process.env.SESSION_INTELLIGENCE_SESSION_IDLE_MINUTES || '30', 10);
const CHECKOUT_DROP_MINUTES = parseInt(process.env.SESSION_INTELLIGENCE_CHECKOUT_DROP_MINUTES || '30', 10);
const MIN_SESSIONS_FOR_SCROLL_DROPOFF = Math.min(
  Math.max(parseInt(process.env.SESSION_INTELLIGENCE_SCROLL_DROPOFF_MIN_SESSIONS || '8', 10) || 8, 1),
  500
);
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

const CLARITY_SIGNAL_EVENT_NAMES = [
  'rage_click',
  'dead_click',
  'js_error',
  'unhandled_rejection',
  'form_invalid',
  'scroll_depth',
  'scroll_max'
];

const THEME_SIGNAL_SOURCES = ['theme_pixel', 'virona-pixel-v1'];

const SHOPPER_BACKFILL_COOLDOWN_MS = 5 * 60 * 1000;
const REALTIME_FOCUS_GEO_LIMIT = 12;
const REALTIME_GEO_FALLBACK_SAMPLE_LIMIT = 1500;
const REALTIME_GEO_CACHE_TTL_MS = 15 * 1000;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const MILLISECONDS_PER_WEEK = 7 * MILLISECONDS_PER_DAY;
const DAY_PULSE_FIRST_WINDOW_HOURS = Math.min(
  Math.max(parseInt(process.env.SESSION_INTELLIGENCE_DAY_PULSE_FIRST_WINDOW_HOURS || '4', 10) || 4, 1),
  12
);
const DAY_PULSE_MIN_PACE_ELAPSED_MINUTES = Math.min(
  Math.max(parseInt(process.env.SESSION_INTELLIGENCE_DAY_PULSE_MIN_PACE_ELAPSED_MINUTES || '30', 10) || 30, 5),
  180
);
const DAY_PULSE_HISTORY_LOOKBACK_DAYS = Math.min(
  Math.max(parseInt(process.env.SESSION_INTELLIGENCE_DAY_PULSE_HISTORY_LOOKBACK_DAYS || '28', 10) || 28, 7),
  120
);
const DAY_PULSE_LIGHT_PERCENTILE = 0.35;
const DAY_PULSE_HEAVY_PERCENTILE = 0.65;
const DAY_PULSE_MIN_HISTORY_DAYS = 7;
const DAY_PULSE_FALLBACK_HEAVY_RATIO = 1.15;
const DAY_PULSE_FALLBACK_LIGHT_RATIO = 0.85;
const JOURNEY_DEFAULT_DAYS = Math.min(
  Math.max(parseInt(process.env.SESSION_INTELLIGENCE_JOURNEY_DEFAULT_DAYS || '7', 10) || 7, 1),
  90
);
const JOURNEY_TABLE_MAX_LIMIT = 200;
const JOURNEY_TABLE_DEFAULT_LIMIT = 25;
const JOURNEY_SESSION_QUERY_CHUNK = 250;
const JOURNEY_SESSION_QUERY_LIMIT = 5000;
const JOURNEY_PRODUCT_ID_PREVIEW_CHARS = 14;
const JOURNEY_COUNTRY_UNKNOWN_KEY = 'UNKNOWN';
const JOURNEY_EXCLUDED_PATH_SEGMENTS = new Set([
  'policies',
  'policy',
  'privacy',
  'terms'
]);
const JOURNEY_EXCLUDED_PATH_SUBSTRINGS = [
  'care-guide',
  'guide-care',
  '/pages/care',
  '/pages/privacy',
  '/pages/terms'
];
const lastShopperBackfillByStore = new Map();
const realtimeFocusGeoFallbackCache = new Map();

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

function safeDecodeUriComponent(value) {
  const raw = safeString(value);
  if (!raw) return raw;
  try {
    return decodeURIComponent(raw);
  } catch (_error) {
    return raw;
  }
}

function normalizePathFromAny(value) {
  const raw = safeString(value).trim();
  if (!raw) return null;

  if (raw.startsWith('/')) {
    const pathOnly = raw.split('?')[0].split('#')[0];
    return pathOnly || '/';
  }

  try {
    const parsed = new URL(raw);
    const pathOnly = safeString(parsed.pathname).split('?')[0].split('#')[0];
    return pathOnly || '/';
  } catch (_error) {
    return null;
  }
}

function isLocalePathSegment(segment) {
  const raw = safeString(segment).trim().toLowerCase();
  if (!raw) return false;
  return /^[a-z]{2}([-_][a-z]{2})?$/.test(raw);
}

function stripLocalePrefixFromPath(pathname) {
  const rawPath = normalizePathFromAny(pathname);
  if (!rawPath || !rawPath.startsWith('/')) return rawPath;

  const parts = rawPath.split('/').filter(Boolean);
  if (!parts.length) return '/';
  if (isLocalePathSegment(parts[0])) {
    const rest = parts.slice(1).join('/');
    return rest ? `/${rest}` : '/';
  }
  return `/${parts.join('/')}`;
}

function normalizeJourneyPath(pathname) {
  const normalized = stripLocalePrefixFromPath(pathname);
  if (!normalized) return null;
  if (normalized === '/') return '/';
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function isJourneyCheckoutPath(pathname) {
  const normalized = normalizeJourneyPath(pathname);
  return Boolean(normalized && normalized.startsWith('/checkouts/'));
}

function isJourneyExcludedPath(pathname) {
  const normalized = normalizeJourneyPath(pathname);
  if (!normalized) return false;

  const lowered = normalized.toLowerCase();
  const parts = lowered.split('/').filter(Boolean);
  if (parts.some((part) => JOURNEY_EXCLUDED_PATH_SEGMENTS.has(part))) return true;
  return JOURNEY_EXCLUDED_PATH_SUBSTRINGS.some((needle) => lowered.includes(needle));
}

function isJourneyLandingPath(pathname) {
  const normalized = normalizeJourneyPath(pathname);
  if (!normalized) return false;
  if (isJourneyCheckoutPath(normalized)) return false;
  if (isJourneyExcludedPath(normalized)) return false;
  return true;
}

function titleCaseFromHandle(handle) {
  const decoded = safeDecodeUriComponent(handle).replace(/[-_]+/g, ' ').trim();
  if (!decoded) return null;
  return decoded
    .split(/\s+/)
    .slice(0, 12)
    .map((word) => (/^[a-z]/.test(word) ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
    .join(' ');
}

function classifyJourneyLandingLabel(pathname) {
  const normalized = normalizeJourneyPath(pathname);
  if (!normalized) return null;

  if (normalized === '/') return 'Home';
  if (normalized === '/cart') return 'Cart';
  if (normalized.startsWith('/search')) return 'Search';

  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return 'Home';

  if (segments[0] === 'products' && segments[1]) {
    const title = titleCaseFromHandle(segments[1]);
    return title ? `Product: ${title}` : 'Product';
  }
  if (segments[0] === 'collections' && segments[1]) {
    const title = titleCaseFromHandle(segments[1]);
    return title ? `Collection: ${title}` : 'Collection';
  }
  if (segments[0] === 'pages' && segments[1]) {
    const title = titleCaseFromHandle(segments[1]);
    return title ? `Page: ${title}` : 'Page';
  }

  const title = titleCaseFromHandle(segments[0]);
  return title || normalized;
}

function extractJourneyProductLabelFromPath(pathname) {
  const normalized = normalizeJourneyPath(pathname);
  if (!normalized) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments[0] !== 'products' || !segments[1]) return null;
  return titleCaseFromHandle(segments[1]);
}

function formatJourneyProductLabel({ title, productId }) {
  const titleLabel = safeString(title).trim();
  if (titleLabel) return safeTruncate(titleLabel, 180);

  const rawId = safeString(productId).trim();
  if (!rawId) return 'Unknown product';

  const preview = rawId.length > JOURNEY_PRODUCT_ID_PREVIEW_CHARS
    ? rawId.slice(-JOURNEY_PRODUCT_ID_PREVIEW_CHARS)
    : rawId;
  return `Product ${preview}`;
}

function normalizeJourneyDeviceSegment(deviceTypeRaw) {
  const raw = safeString(deviceTypeRaw).trim().toLowerCase();
  if (!raw) return 'unknown';
  if (raw.includes('desktop')) return 'desktop';
  if (raw.includes('ipad') || raw.includes('tablet')) return 'tablet';
  if (raw.includes('ios') || raw.includes('iphone')) return 'ios';
  if (raw.includes('android')) return 'android';
  if (raw.includes('mobile')) return 'mobile';
  return 'unknown';
}

function normalizeJourneyCountrySegment(countryCodeRaw) {
  const code = safeString(countryCodeRaw).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code;
  return JOURNEY_COUNTRY_UNKNOWN_KEY;
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

function stripCodeFences(text) {
  return safeString(text)
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();
}

function findFirstJsonObjectSubstring(text) {
  const raw = safeString(text);
  if (!raw) return null;

  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth += 1;
        continue;
      }

      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return raw.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

function removeTrailingCommas(jsonText) {
  // Best-effort cleanup for common model mistakes. This is not a full JSON5 parser.
  return safeString(jsonText).replace(/,\s*([}\]])/g, '$1');
}

function extractJsonObjectFromText(text) {
  const raw = safeString(text).trim();
  if (!raw) return null;
  const direct = safeJsonParse(raw);
  if (direct && typeof direct === 'object') return direct;

  const cleaned = stripCodeFences(raw);
  const cleanedDirect = safeJsonParse(cleaned);
  if (cleanedDirect && typeof cleanedDirect === 'object') return cleanedDirect;

  const candidate = findFirstJsonObjectSubstring(cleaned) || findFirstJsonObjectSubstring(raw);
  if (!candidate) return null;

  const parsed = safeJsonParse(candidate);
  if (parsed && typeof parsed === 'object') return parsed;

  const repaired = removeTrailingCommas(candidate);
  const repairedParsed = safeJsonParse(repaired);
  if (repairedParsed && typeof repairedParsed === 'object') return repairedParsed;

  return null;
}

function makeSessionCodename(sessionId) {
  const raw = safeString(sessionId).trim();
  if (!raw) return 'SUNKNOWN';
  const hex = createHash('sha256').update(raw).digest('hex').slice(0, 10);
  const code = BigInt(`0x${hex}`).toString(36).toUpperCase().padStart(8, '0');
  // Human-friendly, compact session code used across the UI.
  return `S${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

function formatSessionNumberCode(sessionNumber, width = 6) {
  const n = Number(sessionNumber);
  if (!Number.isFinite(n) || n <= 0) return null;
  const safeWidth = Math.min(Math.max(Math.trunc(width) || 6, 4), 12);
  return `S-${String(Math.trunc(n)).padStart(safeWidth, '0')}`;
}

function makeSessionDisplayCode({ sessionNumber, sessionId }) {
  return formatSessionNumberCode(sessionNumber) || makeSessionCodename(sessionId);
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

  if (isCheckoutStarted(name)) return 'contact';
  if (name.includes('contact') && name.includes('submitted')) return 'contact';
  if (name.includes('shipping') && name.includes('submitted')) return 'shipping';
  if (name.includes('payment') && name.includes('submitted')) return 'payment';
  if (isPurchase(name)) return 'thank_you';

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
  const eventData = getEventData(payload);
  const candidates = [
    payload?.geoipCountryCode,
    payload?.countryCode,
    payload?.country_code,
    payload?.data?.checkout?.shippingAddress?.countryCode,
    payload?.data?.checkout?.billingAddress?.countryCode,
    payload?.checkout?.shippingAddress?.countryCode,
    payload?.checkout?.billingAddress?.countryCode,
    envelope?.geoipCountryCode,
    envelope?.countryCode,
    envelope?.country_code,
    envelope?.data?.checkout?.shippingAddress?.countryCode,
    envelope?.data?.checkout?.billingAddress?.countryCode,
    envelope?.checkout?.shippingAddress?.countryCode,
    envelope?.checkout?.billingAddress?.countryCode,
    eventData?.checkout?.shippingAddress?.countryCode,
    eventData?.checkout?.billingAddress?.countryCode
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim())) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

function normalizeGeoLabel(value, { uppercase = false, maxLength = 64 } = {}) {
  const raw = safeString(value).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const normalized = uppercase ? raw.toUpperCase() : raw;
  const lowered = normalized.toLowerCase();

  if (
    lowered === '[redacted]' ||
    lowered === 'redacted' ||
    lowered === 'unknown' ||
    lowered === 'n/a' ||
    lowered === 'na' ||
    lowered === 'null'
  ) {
    return null;
  }

  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function extractRegionLabel(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const envelope = getEventEnvelope(payload);
  const eventData = getEventData(payload);

  const candidates = [
    payload?.regionCode,
    payload?.region_code,
    payload?.region,
    payload?.stateCode,
    payload?.state_code,
    payload?.state,
    payload?.provinceCode,
    payload?.province_code,
    payload?.province,
    payload?.geoipRegionCode,
    payload?.geoipRegion,
    payload?.context?.location?.regionCode,
    payload?.context?.location?.region,
    payload?.checkout?.shippingAddress?.provinceCode,
    payload?.checkout?.shippingAddress?.province,
    payload?.checkout?.shippingAddress?.state,
    payload?.checkout?.billingAddress?.provinceCode,
    payload?.checkout?.billingAddress?.province,
    payload?.checkout?.billingAddress?.state,
    payload?.data?.checkout?.shippingAddress?.provinceCode,
    payload?.data?.checkout?.shippingAddress?.province,
    payload?.data?.checkout?.shippingAddress?.state,
    payload?.data?.checkout?.billingAddress?.provinceCode,
    payload?.data?.checkout?.billingAddress?.province,
    payload?.data?.checkout?.billingAddress?.state,
    envelope?.regionCode,
    envelope?.region_code,
    envelope?.region,
    envelope?.stateCode,
    envelope?.state_code,
    envelope?.state,
    envelope?.provinceCode,
    envelope?.province_code,
    envelope?.province,
    envelope?.geoipRegionCode,
    envelope?.geoipRegion,
    envelope?.context?.location?.regionCode,
    envelope?.context?.location?.region,
    envelope?.checkout?.shippingAddress?.provinceCode,
    envelope?.checkout?.shippingAddress?.province,
    envelope?.checkout?.shippingAddress?.state,
    envelope?.checkout?.billingAddress?.provinceCode,
    envelope?.checkout?.billingAddress?.province,
    envelope?.checkout?.billingAddress?.state,
    envelope?.data?.checkout?.shippingAddress?.provinceCode,
    envelope?.data?.checkout?.shippingAddress?.province,
    envelope?.data?.checkout?.shippingAddress?.state,
    envelope?.data?.checkout?.billingAddress?.provinceCode,
    envelope?.data?.checkout?.billingAddress?.province,
    envelope?.data?.checkout?.billingAddress?.state,
    eventData?.checkout?.shippingAddress?.provinceCode,
    eventData?.checkout?.shippingAddress?.province,
    eventData?.checkout?.shippingAddress?.state,
    eventData?.checkout?.billingAddress?.provinceCode,
    eventData?.checkout?.billingAddress?.province,
    eventData?.checkout?.billingAddress?.state
  ];

  for (const value of candidates) {
    const label = normalizeGeoLabel(value, { maxLength: 48 });
    if (!label) continue;

    // Keep short region/state codes normalized to uppercase.
    if (/^[A-Za-z0-9_-]{2,12}$/.test(label)) {
      return label.toUpperCase();
    }
    return label;
  }

  return null;
}

function extractCityLabel(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const envelope = getEventEnvelope(payload);
  const eventData = getEventData(payload);

  const candidates = [
    payload?.city,
    payload?.town,
    payload?.locality,
    payload?.geoipCity,
    payload?.context?.location?.city,
    payload?.checkout?.shippingAddress?.city,
    payload?.checkout?.billingAddress?.city,
    payload?.data?.checkout?.shippingAddress?.city,
    payload?.data?.checkout?.billingAddress?.city,
    envelope?.city,
    envelope?.town,
    envelope?.locality,
    envelope?.geoipCity,
    envelope?.context?.location?.city,
    envelope?.checkout?.shippingAddress?.city,
    envelope?.checkout?.billingAddress?.city,
    envelope?.data?.checkout?.shippingAddress?.city,
    envelope?.data?.checkout?.billingAddress?.city,
    eventData?.checkout?.shippingAddress?.city,
    eventData?.checkout?.billingAddress?.city
  ];

  for (const value of candidates) {
    const label = normalizeGeoLabel(value, { maxLength: 80 });
    if (!label) continue;
    return label;
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
  const { key, tokens, compact } = normalizeEventNameKey(eventName);
  if (!key) return false;
  if (tokens.includes('atc')) return true;
  if (compact.includes('addtocart') || compact.includes('addedtocart')) return true;

  const hasContainer = tokens.some((t) => ADD_TO_CART_CONTAINER_TOKENS.has(t));
  const hasAddAction = tokens.some((t) => ADD_TO_CART_ACTION_TOKENS.has(t) || t.startsWith('add'));
  if (hasContainer && hasAddAction) return true;

  // Common compact variants: cartadd, bagadd, basketadd.
  if (
    compact.includes('cartadd') ||
    compact.includes('bagadd') ||
    compact.includes('basketadd')
  ) {
    return true;
  }

  return false;
}

function isCheckoutStarted(eventName) {
  const { key, tokens, compact } = normalizeEventNameKey(eventName);
  if (!key) return false;

  const hasCheckout = tokens.includes('checkout') || compact.includes('checkout');
  if (!hasCheckout) return false;

  if (tokens.some((t) => CHECKOUT_COMPLETE_GUARD_TOKENS.has(t))) return false;

  const hasStart = tokens.some((t) => CHECKOUT_START_TOKENS.has(t));
  if (hasStart) return true;

  return (
    compact.includes('begincheckout') ||
    compact.includes('checkoutstart') ||
    compact.includes('startcheckout') ||
    compact.includes('checkoutinitiated') ||
    compact.includes('initiatecheckout')
  );
}

function isPurchase(eventName) {
  const { key, tokens, compact } = normalizeEventNameKey(eventName);
  if (!key) return false;
  if (tokens.includes('purchase') || tokens.includes('purchased')) return true;

  const hasOrder = tokens.includes('order') || compact.includes('order');
  const hasOrderTerminal = tokens.some((t) => ORDER_TERMINAL_TOKENS.has(t)) || compact.includes('orderplaced') || compact.includes('ordercompleted');
  if (hasOrder && hasOrderTerminal) return true;

  const hasCheckout = tokens.includes('checkout') || compact.includes('checkout');
  const hasCheckoutComplete =
    tokens.includes('completed') ||
    tokens.includes('complete') ||
    compact.includes('checkoutcompleted') ||
    compact.includes('checkoutcomplete');
  if (hasCheckout && hasCheckoutComplete) return true;

  return false;
}

function normalizeEventNameKey(value) {
  const raw = safeString(value).trim();
  if (!raw) return { key: '', tokens: [], compact: '' };

  // Support `addToCart`-style and other separators by normalizing to snake_case-ish keys.
  const expanded = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  const key = expanded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  const tokens = key ? key.split('_').filter(Boolean) : [];
  const compact = key ? key.replace(/_/g, '') : '';
  return { key, tokens, compact };
}

const ADD_TO_CART_CONTAINER_TOKENS = new Set(['cart', 'bag', 'basket']);
const ADD_TO_CART_ACTION_TOKENS = new Set(['add', 'added', 'adding']);

const CHECKOUT_START_TOKENS = new Set(['start', 'started', 'begin', 'began', 'initiated', 'initiate', 'open', 'opened', 'enter', 'entered']);
const CHECKOUT_COMPLETE_GUARD_TOKENS = new Set(['complete', 'completed', 'completion', 'purchase', 'purchased', 'paid', 'placed', 'thank', 'you']);
const ORDER_TERMINAL_TOKENS = new Set(['placed', 'complete', 'completed', 'paid', 'success']);

function isProductViewedEvent(eventName, pagePath) {
  const path = safeString(pagePath).toLowerCase().trim();
  if (path.startsWith('/products/')) return true;

  const { tokens, compact } = normalizeEventNameKey(eventName);
  if (!tokens.length) return false;

  const hasViewToken = tokens.includes('view') || tokens.includes('viewed') || tokens.includes('seen');
  const hasProductToken = tokens.includes('product') || tokens.includes('item') || tokens.includes('sku');
  const hasDetailToken = tokens.includes('detail') || tokens.includes('details');

  if (hasViewToken && hasProductToken) return true;
  if (hasDetailToken && hasProductToken) return true;
  if (compact.includes('viewitem') || compact.includes('productview')) return true;

  return false;
}

function isCartViewedEvent(eventName, pagePath) {
  if (isAddToCart(eventName)) return false;

  const path = safeString(pagePath).toLowerCase().trim();
  if (path === '/cart' || path === '/cart/') return true;

  const { tokens, compact } = normalizeEventNameKey(eventName);
  if (!tokens.length) return false;

  const hasContainer = tokens.some((t) => ADD_TO_CART_CONTAINER_TOKENS.has(t)) || compact.includes('cart');
  if (!hasContainer) return false;

  const hasView =
    tokens.includes('view') ||
    tokens.includes('viewed') ||
    tokens.includes('open') ||
    tokens.includes('opened') ||
    compact.includes('viewcart') ||
    compact.includes('cartview') ||
    compact.includes('opencart');
  return hasView;
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
  const normalizedStore = safeString(store).trim() || 'shawq';

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
  const shopperNumber = clientId ? getOrCreateShopperNumber(normalizedStore, clientId, eventTs) : null;
  const sessionId =
    identifiers.sessionId ||
    (clientId ? getOrCreateSessionId(normalizedStore, clientId, eventTs) : null) ||
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
      session_number,
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
      ?,
      ?
    )
    ON CONFLICT(store, session_id) DO UPDATE SET
      session_number = COALESCE(si_sessions.session_number, excluded.session_number),
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

  let sessionNumber = null;

  const tx = db.transaction(() => {
    // Allocate a stable, per-store sequential session_number (S-000123).
    try {
      const existing = db.prepare(`
        SELECT session_number
        FROM si_sessions
        WHERE store = ? AND session_id = ?
      `).get(normalizedStore, sessionId);

      sessionNumber = existing?.session_number ? Number(existing.session_number) : null;

      if (!sessionNumber) {
        db.prepare(`
          INSERT OR IGNORE INTO si_store_counters (store, next_session_number)
          VALUES (?, 1)
        `).run(normalizedStore);

        db.prepare(`
          UPDATE si_store_counters
          SET next_session_number = next_session_number + 1,
              updated_at = datetime('now')
          WHERE store = ?
        `).run(normalizedStore);

        const assigned = db.prepare(`
          SELECT next_session_number - 1 AS assigned
          FROM si_store_counters
          WHERE store = ?
        `).get(normalizedStore)?.assigned;

        sessionNumber = Number(assigned) || null;
      }
    } catch (_e) {
      // If the counters table/column is missing (early boot), fall back to hashed code.
      sessionNumber = null;
    }

    insertEvent.run(
      normalizedStore,
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
      normalizedStore,
      sessionId,
      sessionNumber,
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
  });

  tx.immediate();

  return {
    ok: true,
    store: normalizedStore,
    sessionId,
    sessionNumber,
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

function startOfUtcDayMs(valueMs = Date.now()) {
  const safeMs = Number.isFinite(valueMs) ? valueMs : Date.now();
  const d = new Date(safeMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

function toIsoDayUtc(valueMs = Date.now()) {
  return new Date(startOfUtcDayMs(valueMs)).toISOString().slice(0, 10);
}

function toSqliteUtcDateTime(value) {
  return normalizeSqliteDateTime(value);
}

function dayPulseSafeFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dayPulsePercentageDelta(current, baseline) {
  const currentValue = dayPulseSafeFiniteNumber(current, 0);
  const baselineValue = dayPulseSafeFiniteNumber(baseline, 0);
  if (baselineValue <= 0) {
    if (currentValue <= 0) return 0;
    return null;
  }
  return (currentValue - baselineValue) / baselineValue;
}

function dayPulseDirectionFromDelta(delta) {
  if (!Number.isFinite(delta)) return 'na';
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function dayPulseClassifyProjectionBand({ projectedSessions, historicalDailySessions, referenceSessions }) {
  const projected = dayPulseSafeFiniteNumber(projectedSessions, 0);
  const history = (Array.isArray(historicalDailySessions) ? historicalDailySessions : [])
    .map((value) => dayPulseSafeFiniteNumber(value, NaN))
    .filter((value) => Number.isFinite(value));

  if (history.length >= DAY_PULSE_MIN_HISTORY_DAYS) {
    const lightCutoff = computePercentile(history, DAY_PULSE_LIGHT_PERCENTILE);
    const heavyCutoff = computePercentile(history, DAY_PULSE_HEAVY_PERCENTILE);
    if (Number.isFinite(lightCutoff) && Number.isFinite(heavyCutoff)) {
      if (projected <= lightCutoff) return 'Light';
      if (projected >= heavyCutoff) return 'Heavy';
      return 'Mid';
    }
  }

  const baseline = dayPulseSafeFiniteNumber(referenceSessions, 0);
  if (baseline <= 0) {
    if (projected <= 0) return 'Mid';
    return 'Heavy';
  }
  if (projected >= baseline * DAY_PULSE_FALLBACK_HEAVY_RATIO) return 'Heavy';
  if (projected <= baseline * DAY_PULSE_FALLBACK_LIGHT_RATIO) return 'Light';
  return 'Mid';
}

function dayPulseScalePartialDaySessionsToDailyEstimate(partialSessions, elapsedMs) {
  const sessions = dayPulseSafeFiniteNumber(partialSessions, 0);
  const elapsed = dayPulseSafeFiniteNumber(elapsedMs, 0);
  if (sessions <= 0 || elapsed <= 0) return 0;
  return sessions * (MILLISECONDS_PER_DAY / elapsed);
}

export function getSessionIntelligenceDayPulse(store) {
  const db = getDb();
  const normalizedStore = safeString(store).trim() || 'shawq';
  ensureRecentShopperNumbers(normalizedStore);

  const nowMs = Date.now();
  const dayStartMs = startOfUtcDayMs(nowMs);
  const elapsedMs = Math.max(0, nowMs - dayStartMs);
  const firstWindowMs = DAY_PULSE_FIRST_WINDOW_HOURS * MILLISECONDS_PER_HOUR;
  const firstWindowEndMs = Math.min(dayStartMs + firstWindowMs, nowMs);
  const minPaceElapsedMs = DAY_PULSE_MIN_PACE_ELAPSED_MINUTES * MILLISECONDS_PER_MINUTE;
  const yesterdayStartMs = dayStartMs - MILLISECONDS_PER_DAY;
  const lastWeekStartMs = dayStartMs - MILLISECONDS_PER_WEEK;

  const currentWindowStart = toSqliteUtcDateTime(dayStartMs);
  const currentWindowEnd = toSqliteUtcDateTime(nowMs);
  const firstWindowEnd = toSqliteUtcDateTime(firstWindowEndMs);
  const yesterdayWindowStart = toSqliteUtcDateTime(yesterdayStartMs);
  const yesterdayWindowEnd = toSqliteUtcDateTime(yesterdayStartMs + elapsedMs);
  const lastWeekWindowStart = toSqliteUtcDateTime(lastWeekStartMs);
  const lastWeekWindowEnd = toSqliteUtcDateTime(lastWeekStartMs + elapsedMs);
  const historyStartMs = dayStartMs - (DAY_PULSE_HISTORY_LOOKBACK_DAYS * MILLISECONDS_PER_DAY);
  const historyStart = toSqliteUtcDateTime(historyStartMs);

  const windowsRow = db.prepare(`
    SELECT
      SUM(CASE WHEN started_at >= ? AND started_at < ? THEN 1 ELSE 0 END) AS today_sessions_so_far,
      SUM(CASE WHEN started_at >= ? AND started_at < ? THEN 1 ELSE 0 END) AS today_first_window_sessions,
      SUM(CASE WHEN started_at >= ? AND started_at < ? THEN 1 ELSE 0 END) AS yesterday_same_time_sessions,
      SUM(CASE WHEN started_at >= ? AND started_at < ? THEN 1 ELSE 0 END) AS last_week_same_time_sessions
    FROM si_sessions
    WHERE store = ?
      AND started_at >= ?
      AND started_at < ?
  `).get(
    currentWindowStart,
    currentWindowEnd,
    currentWindowStart,
    firstWindowEnd,
    yesterdayWindowStart,
    yesterdayWindowEnd,
    lastWeekWindowStart,
    lastWeekWindowEnd,
    normalizedStore,
    lastWeekWindowStart,
    currentWindowEnd
  );

  const todaySessionsSoFar = dayPulseSafeFiniteNumber(windowsRow?.today_sessions_so_far, 0);
  const firstWindowSessions = dayPulseSafeFiniteNumber(windowsRow?.today_first_window_sessions, 0);
  const yesterdaySameTimeSessions = dayPulseSafeFiniteNumber(windowsRow?.yesterday_same_time_sessions, 0);
  const lastWeekSameTimeSessions = dayPulseSafeFiniteNumber(windowsRow?.last_week_same_time_sessions, 0);

  const paceDurationMs = firstWindowEndMs - dayStartMs;
  const projectedSessions = paceDurationMs >= minPaceElapsedMs
    ? Math.max(0, Math.round((firstWindowSessions / paceDurationMs) * MILLISECONDS_PER_DAY))
    : 0;

  const historyRows = db.prepare(`
    SELECT
      date(started_at) AS session_day,
      COUNT(*) AS sessions
    FROM si_sessions
    WHERE store = ?
      AND started_at >= ?
      AND started_at < ?
    GROUP BY session_day
    ORDER BY session_day DESC
  `).all(normalizedStore, historyStart, currentWindowStart);

  const historicalDailySessions = historyRows
    .map((row) => dayPulseSafeFiniteNumber(row?.sessions, NaN))
    .filter((value) => Number.isFinite(value));

  const fallbackReferenceCandidates = [yesterdaySameTimeSessions, lastWeekSameTimeSessions]
    .filter((value) => Number.isFinite(value) && value > 0);
  const scaledFallbackReferenceCandidates = fallbackReferenceCandidates
    .map((value) => dayPulseScalePartialDaySessionsToDailyEstimate(value, elapsedMs))
    .filter((value) => Number.isFinite(value) && value > 0);
  const fallbackReferenceSessions = scaledFallbackReferenceCandidates.length > 0
    ? (scaledFallbackReferenceCandidates.reduce((sum, value) => sum + value, 0) / scaledFallbackReferenceCandidates.length)
    : dayPulseSafeFiniteNumber(computePercentile(historicalDailySessions, 0.5), 0);

  const projectionLabel = dayPulseClassifyProjectionBand({
    projectedSessions,
    historicalDailySessions,
    referenceSessions: fallbackReferenceSessions
  });

  const deltaVsYesterday = dayPulsePercentageDelta(todaySessionsSoFar, yesterdaySameTimeSessions);
  const deltaVsLastWeek = dayPulsePercentageDelta(todaySessionsSoFar, lastWeekSameTimeSessions);

  return {
    store: normalizedStore,
    date: toIsoDayUtc(nowMs),
    timezone: 'UTC',
    firstWindowHours: DAY_PULSE_FIRST_WINDOW_HOURS,
    sessionsSoFar: todaySessionsSoFar,
    projectedSessions,
    projectionLabel,
    updatedAt: normalizeSqliteDateTime(new Date(nowMs)),
    comparisons: {
      yesterday: {
        label: 'vs yesterday',
        sessions: yesterdaySameTimeSessions,
        delta: deltaVsYesterday,
        direction: dayPulseDirectionFromDelta(deltaVsYesterday)
      },
      lastWeek: {
        label: 'vs same day last week',
        sessions: lastWeekSameTimeSessions,
        delta: deltaVsLastWeek,
        direction: dayPulseDirectionFromDelta(deltaVsLastWeek)
      }
    }
  };
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
    GROUP BY lower(event_name)
  `).all(store);

  const sumWhere = (predicate) => eventCounts.reduce((sum, row) => (
    predicate(row?.name) ? sum + (Number(row.count) || 0) : sum
  ), 0);

  const atcEvents24h = sumWhere(isAddToCart);
  const checkoutStartedEvents24h = sumWhere(isCheckoutStarted);
  const purchasesEvents24h = sumWhere(isPurchase);

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
    SELECT session_id, product_id, lower(event_name) AS event_name
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', ?)
      AND product_id IS NOT NULL
  `).all(store, retentionWindow);

  for (const row of purchaseEventRows) {
    if (!row?.session_id || !row?.product_id) continue;
    if (!isPurchase(row.event_name)) continue;
    const set = purchasedProductsBySession.get(row.session_id) || new Set();
    set.add(row.product_id);
    purchasedProductsBySession.set(row.session_id, set);
    purchasedSessionIds.add(row.session_id);
  }

  const viewEventRows = db.prepare(`
    SELECT session_id, product_id, page_path, lower(event_name) AS event_name
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', ?)
      AND product_id IS NOT NULL
  `).all(store, retentionWindow);

  const viewedNotBought = new Map();
  for (const row of viewEventRows) {
    if (!row?.session_id || !row?.product_id) continue;
    if (!isProductViewedEvent(row.event_name, row.page_path)) continue;
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

function topCountsFromMap(map, limit = 10) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  return Array.from(map.entries())
    .filter(([key]) => key != null && String(key).trim() !== '')
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .slice(0, max)
    .map(([value, count]) => ({ value, count }));
}

function incrementMapCount(map, key, amount = 1) {
  if (!map || key == null) return;
  const label = safeString(key).trim();
  if (!label) return;
  map.set(label, (map.get(label) || 0) + amount);
}

function incrementNestedMapCount(outerMap, parentKey, childKey, amount = 1) {
  if (!outerMap || parentKey == null || childKey == null) return;
  const parent = safeString(parentKey).trim();
  const child = safeString(childKey).trim();
  if (!parent || !child) return;

  let innerMap = outerMap.get(parent);
  if (!innerMap) {
    innerMap = new Map();
    outerMap.set(parent, innerMap);
  }

  incrementMapCount(innerMap, child, amount);
}

function getRealtimeFocusGeoFallback(db, normalizedStore, windowExpr, focusCountry) {
  if (!focusCountry) return { regions: [], cities: [] };

  const cacheKey = `${normalizedStore}|${windowExpr}|${focusCountry}`;
  const nowMs = Date.now();
  const cached = realtimeFocusGeoFallbackCache.get(cacheKey);
  if (cached && cached.expiresAtMs > nowMs) {
    return {
      regions: Array.isArray(cached.regions) ? cached.regions : [],
      cities: Array.isArray(cached.cities) ? cached.cities : []
    };
  }

  try {
    const rows = db.prepare(`
      SELECT payload_json
      FROM shopify_pixel_events
      WHERE store = ?
        AND created_at >= datetime('now', ?)
      ORDER BY id DESC
      LIMIT ?
    `).all(normalizedStore, windowExpr, REALTIME_GEO_FALLBACK_SAMPLE_LIMIT);

    const regionCounts = new Map();
    const cityCounts = new Map();
    const countryCode = safeString(focusCountry).trim().toUpperCase();

    for (const row of rows) {
      const payload = safeJsonParse(row?.payload_json);
      if (!payload || typeof payload !== 'object') continue;

      const rowCountry = extractCountryCode(payload);
      if (!rowCountry || rowCountry !== countryCode) continue;

      const region = extractRegionLabel(payload);
      const city = extractCityLabel(payload);

      if (region) incrementMapCount(regionCounts, region);
      if (city) incrementMapCount(cityCounts, city);
    }

    const result = {
      regions: topCountsFromMap(regionCounts, REALTIME_FOCUS_GEO_LIMIT),
      cities: topCountsFromMap(cityCounts, REALTIME_FOCUS_GEO_LIMIT)
    };
    realtimeFocusGeoFallbackCache.set(cacheKey, {
      ...result,
      expiresAtMs: nowMs + REALTIME_GEO_CACHE_TTL_MS
    });
    return result;
  } catch (error) {
    console.warn(
      `[SessionIntelligence] realtime focus geo fallback failed for store=${normalizedStore}, country=${focusCountry}:`,
      error?.message || error
    );
    return { regions: [], cities: [] };
  }
}

export function getSessionIntelligenceRealtimeOverview(store, { windowMinutes = 30, limit = 10 } = {}) {
  const db = getDb();
  const normalizedStore = safeString(store).trim() || 'shawq';

  const window = Math.min(Math.max(parseInt(windowMinutes, 10) || 30, 1), 180);
  const max = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  const windowExpr = `-${window} minutes`;
  const clarityPlaceholders = CLARITY_SIGNAL_EVENT_NAMES.map(() => '?').join(',');
  const themeSourcePlaceholders = THEME_SIGNAL_SOURCES.map(() => '?').join(',');

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS events,
      COUNT(DISTINCT session_id) AS sessions,
      MAX(created_at) AS last_event_at
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', ?)
      AND lower(event_name) NOT IN (${clarityPlaceholders})
      AND COALESCE(lower(source), '') NOT IN (${themeSourcePlaceholders})
  `).get(
    normalizedStore,
    windowExpr,
    ...CLARITY_SIGNAL_EVENT_NAMES,
    ...THEME_SIGNAL_SOURCES
  );

  const latest = db.prepare(`
    WITH recent AS (
      SELECT session_id, MAX(id) AS last_id
      FROM si_events
      WHERE store = ?
        AND created_at >= datetime('now', ?)
        AND lower(event_name) NOT IN (${clarityPlaceholders})
        AND COALESCE(lower(source), '') NOT IN (${themeSourcePlaceholders})
      GROUP BY session_id
    )
    SELECT
      e.session_id,
      e.client_id,
      e.shopper_number,
      e.event_name,
      e.event_ts,
      e.created_at,
      e.page_path,
      e.checkout_step,
      e.device_type,
      e.country_code,
      e.data_json,
      e.utm_source,
      e.utm_campaign
    FROM si_events e
    JOIN recent r ON r.last_id = e.id
    WHERE e.store = ?
    ORDER BY e.id DESC
  `).all(
    normalizedStore,
    windowExpr,
    ...CLARITY_SIGNAL_EVENT_NAMES,
    ...THEME_SIGNAL_SOURCES,
    normalizedStore
  );

  const visitors = new Set();
  const stageCounts = new Map();
  const pageCounts = new Map();
  const sourceCounts = new Map();
  const campaignCounts = new Map();
  const deviceCounts = new Map();
  const countryCounts = new Map();
  const regionCountsByCountry = new Map();
  const cityCountsByCountry = new Map();

  for (const row of latest) {
    const shopperNumber = Number(row?.shopper_number);
    const shopperKey = Number.isFinite(shopperNumber) && shopperNumber > 0
      ? `shopper:${shopperNumber}`
      : row?.client_id
        ? `client:${row.client_id}`
        : row?.session_id
          ? `session:${row.session_id}`
          : null;
    if (shopperKey) visitors.add(shopperKey);

    const stage = stageFromEvent({
      eventName: row?.event_name,
      pagePath: row?.page_path,
      checkoutStep: row?.checkout_step
    }) || 'landing';
    stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);

    const page = safeString(row?.page_path).trim();
    if (page) pageCounts.set(page, (pageCounts.get(page) || 0) + 1);

    const source = safeString(row?.utm_source).trim() || 'Direct';
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);

    const campaign = safeString(row?.utm_campaign).trim() || (source === 'Direct' ? 'Direct' : '(not set)');
    campaignCounts.set(campaign, (campaignCounts.get(campaign) || 0) + 1);

    const device = safeString(row?.device_type).trim() || '—';
    deviceCounts.set(device, (deviceCounts.get(device) || 0) + 1);

    const country = safeString(row?.country_code).trim().toUpperCase();
    if (country) countryCounts.set(country, (countryCounts.get(country) || 0) + 1);

    const eventData = safeJsonParse(row?.data_json);
    if (country && eventData && typeof eventData === 'object') {
      const region = extractRegionLabel(eventData);
      const city = extractCityLabel(eventData);
      if (region) incrementNestedMapCount(regionCountsByCountry, country, region);
      if (city) incrementNestedMapCount(cityCountsByCountry, country, city);
    }
  }

  const eventCounts = db.prepare(`
    SELECT lower(event_name) AS name, COUNT(*) AS count
    FROM si_events
    WHERE store = ?
      AND created_at >= datetime('now', ?)
      AND lower(event_name) NOT IN (${clarityPlaceholders})
      AND COALESCE(lower(source), '') NOT IN (${themeSourcePlaceholders})
    GROUP BY lower(event_name)
    ORDER BY count DESC
  `).all(
    normalizedStore,
    windowExpr,
    ...CLARITY_SIGNAL_EVENT_NAMES,
    ...THEME_SIGNAL_SOURCES
  );

  const topEvents = eventCounts.slice(0, max);

  const sumWhere = (predicate) => eventCounts.reduce((sum, row) => (
    predicate(row?.name) ? sum + (Number(row.count) || 0) : sum
  ), 0);

  const keyEvents = {
    atc: sumWhere(isAddToCart),
    checkout_started: sumWhere(isCheckoutStarted),
    purchase: sumWhere(isPurchase)
  };

  const countries = topCountsFromMap(countryCounts, 30);
  const focusCountry = countries[0]?.value || null;
  let focusRegions = focusCountry
    ? topCountsFromMap(regionCountsByCountry.get(focusCountry) || new Map(), REALTIME_FOCUS_GEO_LIMIT)
    : [];
  let focusCities = focusCountry
    ? topCountsFromMap(cityCountsByCountry.get(focusCountry) || new Map(), REALTIME_FOCUS_GEO_LIMIT)
    : [];

  if (focusCountry && focusRegions.length === 0 && focusCities.length === 0) {
    const fallback = getRealtimeFocusGeoFallback(db, normalizedStore, windowExpr, focusCountry);
    focusRegions = fallback.regions;
    focusCities = fallback.cities;
  }

  return {
    store: normalizedStore,
    windowMinutes: window,
    updatedAt: new Date().toISOString(),
    lastEventAt: totals?.last_event_at || null,
    activeSessions: latest.length,
    activeShoppers: visitors.size,
    events: Number(totals?.events) || 0,
    breakdowns: {
      stages: topCountsFromMap(stageCounts, 20).map((row) => ({ stage: row.value, count: row.count })),
      pages: topCountsFromMap(pageCounts, max),
      sources: topCountsFromMap(sourceCounts, max),
      campaigns: topCountsFromMap(campaignCounts, max),
      devices: topCountsFromMap(deviceCounts, max),
      countries,
      focus: {
        country: focusCountry,
        regions: focusRegions,
        cities: focusCities
      }
    },
    topEvents,
    keyEvents
  };
}

export function getSessionIntelligenceRecentEvents(store, limit = 80) {
  const db = getDb();
  ensureRecentShopperNumbers(store);
  const max = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 500);
  return db.prepare(`
    SELECT
      e.id,
      e.store,
      e.session_id,
      s.session_number,
      e.client_id,
      e.shopper_number,
      e.source,
      e.event_name,
      e.event_ts,
      e.page_url,
      e.page_path,
      e.checkout_token,
      e.checkout_step,
      e.device_type,
      e.country_code,
      e.product_id,
      e.variant_id,
      e.utm_source,
      e.utm_medium,
      e.utm_campaign,
      e.utm_content,
      e.utm_term,
      e.fbclid,
      e.gclid,
      e.ttclid,
      e.msclkid,
      e.wbraid,
      e.gbraid,
      e.irclickid,
      e.created_at
    FROM si_events e
      LEFT JOIN si_sessions s
      ON s.store = e.store AND s.session_id = e.session_id
    WHERE e.store = ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(store, max).map((row) => ({
    ...row,
    codename: makeSessionDisplayCode({ sessionNumber: row.session_number, sessionId: row.session_id })
  }));
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
      session_number,
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
  `).all(store, max).map((row) => ({
    ...row,
    codename: makeSessionDisplayCode({ sessionNumber: row.session_number, sessionId: row.session_id })
  }));
}

export function getSessionIntelligenceLatestBrief(store) {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, store, date, content, top_reasons_json, model, generated_at, created_at
    FROM si_daily_briefs
    WHERE store = ?
    ORDER BY date DESC
    LIMIT 1
  `).get(store);
  return hydrateBriefRow(row);
}

export function getSessionIntelligenceBriefForDay(store, date) {
  const db = getDb();
  const iso = requireIsoDay(date);
  if (!iso) return null;
  const row = db.prepare(`
    SELECT id, store, date, content, top_reasons_json, model, generated_at, created_at
    FROM si_daily_briefs
    WHERE store = ? AND date = ?
    LIMIT 1
  `).get(store, iso);
  return hydrateBriefRow(row);
}

function hydrateBriefRow(row) {
  if (!row || typeof row !== 'object') return null;
  const raw = safeString(row.top_reasons_json);
  let topReasons = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) topReasons = parsed;
    } catch (_error) {
      topReasons = [];
    }
  }

  return {
    ...row,
    top_reasons: topReasons
  };
}

function chunkArray(list, size) {
  const chunks = [];
  const chunkSize = Math.max(1, Math.floor(size));
  for (let i = 0; i < list.length; i += chunkSize) {
    chunks.push(list.slice(i, i + chunkSize));
  }
  return chunks;
}

function buildTopCounts(list, key, limit = 8) {
  const map = new Map();
  (list || []).forEach((row) => {
    const value = row?.[key] || '—';
    map.set(value, (map.get(value) || 0) + 1);
  });
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function buildSessionRollup(session) {
  if (!session || typeof session !== 'object') return null;
  return {
    codename: session.codename,
    session_id: session.session_id,
    first_seen: session.first_seen,
    last_seen: session.last_seen,
    device_type: session.device_type || null,
    country_code: session.country_code || null,
    utm_source: session.utm_source || null,
    utm_campaign: session.utm_campaign || null,
    atc_events: session.atc_events || 0,
    checkout_started_events: session.checkout_started_events || 0,
    purchase_events: session.purchase_events || 0,
    last_checkout_step: session.last_checkout_step || null,
    analysis: session.summary
      ? {
          primary_reason: session.primary_reason || null,
          confidence: session.confidence ?? null,
          summary: session.summary || null
        }
      : null
  };
}

async function generateDailyBriefWithModel({
  model,
  temperature,
  systemPrompt,
  userPayload
}) {
  if (typeof model === 'string' && model.startsWith('deepseek-')) {
    const resp = await askDeepSeekChat({
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPayload }],
      maxOutputTokens: 1200,
      temperature: normalizeTemperature(temperature, 1.0)
    });
    return { text: resp.text, model: resp.model };
  }

  const text = await askOpenAIChat({
    model,
    systemPrompt,
    messages: [{ role: 'user', content: userPayload }],
    maxOutputTokens: 1200,
    verbosity: 'low'
  });
  return { text, model };
}

export async function generateSessionIntelligenceDailyBrief({
  store,
  date,
  model = process.env.SESSION_INTELLIGENCE_BRIEF_MODEL || process.env.SESSION_INTELLIGENCE_AI_MODEL || 'deepseek-reasoner',
  temperature = 1.0,
  limitSessions = 2500,
  sampleSessions = 40
}) {
  const db = getDb();
  const iso = requireIsoDay(date);
  if (!iso) {
    return { success: false, error: 'Invalid date. Expected YYYY-MM-DD.' };
  }

  const sessions = getSessionIntelligenceSessionsForDay(store, iso, limitSessions);

  const highIntent = sessions.filter(
    (s) => ((s.atc_events || 0) > 0 || (s.checkout_started_events || 0) > 0) && (s.purchase_events || 0) === 0
  );
  const checkoutNoPurchase = highIntent.filter((s) => (s.checkout_started_events || 0) > 0);
  const atcNoPurchase = highIntent.filter((s) => (s.atc_events || 0) > 0);

  // Pull event-name counts for high-intent sessions on that day (Clarity-style friction signals).
  const range = dayRangeUtc(iso);
  const sessionIds = highIntent.map((s) => s.session_id).filter(Boolean);
  const eventCounts = new Map();
  if (range && sessionIds.length) {
    const chunks = chunkArray(sessionIds, 500);
    for (const chunk of chunks) {
      const placeholders = chunk.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT lower(event_name) AS event_name, COUNT(*) AS count
        FROM si_events
        WHERE store = ?
          AND created_at >= ?
          AND created_at < ?
          AND session_id IN (${placeholders})
        GROUP BY lower(event_name)
      `).all(store, range.start, range.end, ...chunk);

      rows.forEach((row) => {
        const name = row?.event_name || '';
        if (!name) return;
        eventCounts.set(name, (eventCounts.get(name) || 0) + (Number(row.count) || 0));
      });
    }
  }

  const topEvents = Array.from(eventCounts.entries())
    .map(([event_name, count]) => ({ event_name, count }))
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 14);

  const context = {
    store,
    date: iso,
    totals: {
      sessions: sessions.length,
      high_intent_no_purchase: highIntent.length,
      checkout_no_purchase: checkoutNoPurchase.length,
      atc_no_purchase: atcNoPurchase.length
    },
    breakdowns: {
      last_checkout_step: buildTopCounts(highIntent, 'last_checkout_step', 8),
      device_type: buildTopCounts(highIntent, 'device_type', 6),
      country_code: buildTopCounts(highIntent, 'country_code', 8),
      utm_source: buildTopCounts(highIntent, 'utm_source', 6),
      utm_campaign: buildTopCounts(highIntent, 'utm_campaign', 8)
    },
    top_events: topEvents,
    sample_sessions: highIntent.slice(0, Math.max(1, sampleSessions)).map(buildSessionRollup).filter(Boolean)
  };

  const systemPrompt = [
    'You are a Microsoft Clarity-style e-commerce UX analyst.',
    'You will be given a DAY-level summary of high-intent sessions (ATC and/or checkout started, but no purchase).',
    'Your job is to produce a short, client-ready daily brief: what happened, the top friction clusters, and the fixes that move revenue.',
    '',
    'Output STRICT JSON only (no markdown), with this schema:',
    '{',
    '  "content": string,',
    '  "top_reasons": [ { "reason": string, "confidence": number, "evidence": string[], "fixes": string[] } ]',
    '}',
    '',
    'Rules:',
    '- Be actionable and specific. Prefer "Change X on checkout shipping step" over vague advice.',
    '- Reference evidence from the provided aggregates (drop-off step, device mix, top events, etc.).',
    '- If sample is too small, say so clearly and keep confidence low.',
    '- Do not invent errors; only infer likely causes supported by evidence.',
    '- Keep content to ~10-18 lines with clear sections.',
    '- Confidence must be 0..1.'
  ].join('\n');

  const userPayload = JSON.stringify(context, null, 2);

  const repairSystemPrompt = [
    'You are a JSON repair tool.',
    'Convert the input into STRICT valid JSON only (no markdown, no prose).',
    'The output must match this schema exactly:',
    '{',
    '  "content": string,',
    '  "top_reasons": [ { "reason": string, "confidence": number, "evidence": string[], "fixes": string[] } ]',
    '}'
  ].join('\n');

  const candidates = [];
  if (model) candidates.push(model);
  if (model === 'deepseek-reasoner') candidates.push('deepseek-chat');
  if (model !== 'gpt-4o-mini') candidates.push('gpt-4o-mini');

  let completion = null;
  let parsed = null;
  let usedModel = model;
  let lastError = null;

  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      completion = await generateDailyBriefWithModel({
        model: candidate,
        temperature,
        systemPrompt,
        userPayload
      });

      usedModel = completion.model || candidate;
      parsed = extractJsonObjectFromText(completion.text);
      if (parsed && typeof parsed === 'object') break;

      // One repair attempt, deterministic (helps DeepSeek Reasoner return strict JSON).
      // eslint-disable-next-line no-await-in-loop
      const repairCompletion = await generateDailyBriefWithModel({
        model: candidate,
        temperature: 0.0,
        systemPrompt: repairSystemPrompt,
        userPayload: `Fix the following output into valid JSON only:\n\n${completion.text}`
      });

      usedModel = repairCompletion.model || candidate;
      parsed = extractJsonObjectFromText(repairCompletion.text);
      if (parsed && typeof parsed === 'object') {
        completion = repairCompletion;
        break;
      }

      console.warn('[SessionIntelligence] daily brief invalid JSON', {
        store,
        date: iso,
        model: usedModel,
        preview: String(completion.text || '').slice(0, 400)
      });
      lastError = new Error('AI response was not valid JSON.');
    } catch (error) {
      lastError = error;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      success: false,
      error: `${lastError?.message || 'AI request failed.'} Try DeepSeek Chat or set temperature to 0.0 for strict JSON.`
    };
  }

  const content = safeTruncate(parsed.content, 4000);
  const topReasons = Array.isArray(parsed.top_reasons) ? parsed.top_reasons.slice(0, 6) : [];

  const generatedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO si_daily_briefs (store, date, content, top_reasons_json, model, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, date) DO UPDATE SET
      content = excluded.content,
      top_reasons_json = excluded.top_reasons_json,
      model = excluded.model,
      generated_at = excluded.generated_at,
      created_at = datetime('now')
  `).run(
    store,
    iso,
    content || '',
    JSON.stringify(topReasons),
    completion?.model || usedModel || model,
    generatedAt
  );

  const brief = getSessionIntelligenceBriefForDay(store, iso) || null;
  return { success: true, store, date: iso, brief };
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

function normalizeJourneyLimit(limit, fallback = JOURNEY_TABLE_DEFAULT_LIMIT) {
  const base = Number.isFinite(Number(limit)) ? Number(limit) : fallback;
  return Math.min(Math.max(parseInt(base, 10) || fallback, 1), JOURNEY_TABLE_MAX_LIMIT);
}

function defaultJourneyRangeUtc(days = JOURNEY_DEFAULT_DAYS) {
  const normalizedDays = Math.max(1, parseInt(days, 10) || JOURNEY_DEFAULT_DAYS);
  const end = new Date();
  const endIso = end.toISOString().slice(0, 10);
  const startMs = Date.parse(`${endIso}T00:00:00Z`) - ((normalizedDays - 1) * 24 * 60 * 60 * 1000);
  const startIso = new Date(startMs).toISOString().slice(0, 10);
  return rangeUtcFromStartEnd(startIso, endIso);
}

function resolveJourneyRange(startDate, endDate) {
  const explicit = startDate && endDate ? rangeUtcFromStartEnd(startDate, endDate) : null;
  if (explicit) return explicit;
  return defaultJourneyRangeUtc(JOURNEY_DEFAULT_DAYS);
}

function summarizeJourneyUnattributedReason({ entryPagePath, checkoutToken }) {
  const entryPath = safeString(entryPagePath).trim();
  if (!entryPath && safeString(checkoutToken).trim()) return 'checkout_only_capture';
  if (!entryPath) return 'missing_entry_context';
  if (isJourneyCheckoutPath(entryPath)) return 'checkout_only_capture';
  if (isJourneyExcludedPath(entryPath)) return 'excluded_content_page';
  return 'unclassified_path';
}

function collectJourneySessionContextById(db, store, sessions, range) {
  const contextBySession = new Map();
  const sessionIds = Array.from(new Set(
    (sessions || [])
      .map((row) => safeString(row?.session_id).trim())
      .filter(Boolean)
  )).slice(0, JOURNEY_SESSION_QUERY_LIMIT);

  if (!sessionIds.length) return contextBySession;

  for (const chunk of chunkArray(sessionIds, JOURNEY_SESSION_QUERY_CHUNK)) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT
        id,
        session_id,
        event_ts,
        created_at,
        event_name,
        page_url,
        page_path,
        product_id,
        utm_source,
        utm_campaign
      FROM si_events
      WHERE store = ?
        AND session_id IN (${placeholders})
        AND created_at >= ?
        AND created_at < ?
      ORDER BY session_id ASC, COALESCE(event_ts, created_at) ASC, id ASC
    `).all(store, ...chunk, range.start, range.end);

    for (const row of rows) {
      const sessionId = safeString(row?.session_id).trim();
      if (!sessionId) continue;

      const entry = contextBySession.get(sessionId) || {
        entryPath: null,
        entrySource: null,
        entryCampaign: null,
        latestProductLabel: null
      };

      if (!entry.entryPath) {
        const pathCandidate = normalizeJourneyPath(row?.page_path || row?.page_url);
        if (pathCandidate && isJourneyLandingPath(pathCandidate)) {
          entry.entryPath = pathCandidate;
        }
      }

      if (!entry.entrySource) {
        const source = safeString(row?.utm_source).trim();
        if (source) entry.entrySource = safeTruncate(source, 240);
      }

      if (!entry.entryCampaign) {
        const campaign = safeString(row?.utm_campaign).trim();
        if (campaign) entry.entryCampaign = safeTruncate(campaign, 240);
      }

      const productLabel = extractJourneyProductLabelFromPath(row?.page_path || row?.page_url);
      if (productLabel) {
        entry.latestProductLabel = safeTruncate(productLabel, 180);
      } else if (!entry.latestProductLabel && row?.product_id) {
        entry.latestProductLabel = formatJourneyProductLabel({
          title: null,
          productId: row.product_id
        });
      }

      contextBySession.set(sessionId, entry);
    }
  }

  return contextBySession;
}

function classifyJourneyAbandonAreaFromSession(row, productLabelFallback = null, entryPath = null) {
  const step = normalizeCheckoutStep(row?.last_checkout_step);
  if (step === 'payment') return { area: 'Checkout Payment', product: productLabelFallback || '—' };
  if (step === 'thank_you') return { area: 'Checkout Payment', product: productLabelFallback || '—' };
  if (step) return { area: 'Checkout', product: productLabelFallback || '—' };

  if (safeString(row?.checkout_started_at).trim()) return { area: 'Checkout', product: productLabelFallback || '—' };
  if (safeString(row?.atc_at).trim()) return { area: 'Cart', product: productLabelFallback || '—' };

  const normalizedEntryPath = safeString(entryPath).trim();
  if (normalizedEntryPath && isJourneyLandingPath(normalizedEntryPath)) {
    const landingLabel = classifyJourneyLandingLabel(normalizedEntryPath) || 'Other';
    const product = extractJourneyProductLabelFromPath(normalizedEntryPath) || productLabelFallback || '—';

    if (landingLabel.startsWith('Product:')) return { area: 'Product Page', product };
    if (landingLabel.startsWith('Collection:')) return { area: 'Collection', product: '—' };
    if (landingLabel === 'Search') return { area: 'Search', product: '—' };
    if (landingLabel === 'Cart') return { area: 'Cart', product };
    if (landingLabel === 'Home') return { area: 'Home', product: '—' };
    if (landingLabel.startsWith('Page:')) return { area: 'Content Page', product: '—' };
    return { area: 'Other', product: '—' };
  }

  return null;
}

function sessionHasJourneyAbandonSignal(row, entryPath = null) {
  if (!row || typeof row !== 'object') return false;
  if (safeString(row.checkout_started_at).trim()) return true;
  if (safeString(row.atc_at).trim()) return true;
  if (safeString(entryPath).trim()) return true;
  if (safeString(row.last_checkout_token).trim()) return true;
  if (safeString(row.last_product_id).trim()) return true;
  return false;
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

export function getSessionIntelligenceLandingToPurchase(store, {
  startDate,
  endDate,
  limit = JOURNEY_TABLE_DEFAULT_LIMIT
} = {}) {
  const db = getDb();
  const normalizedStore = safeString(store).trim() || 'shawq';
  ensureRecentShopperNumbers(normalizedStore);

  const range = resolveJourneyRange(startDate, endDate);
  if (!range) {
    return {
      store: normalizedStore,
      period: null,
      totalPurchases: 0,
      attributedPurchases: 0,
      unattributedPurchases: 0,
      unattributedBreakdown: {},
      rows: []
    };
  }

  const max = normalizeJourneyLimit(limit);
  const sessions = db.prepare(`
    SELECT
      session_id,
      session_number,
      purchase_at,
      last_country_code,
      last_product_id,
      last_checkout_token,
      last_campaign_json
    FROM si_sessions
    WHERE store = ?
      AND purchase_at IS NOT NULL
      AND purchase_at >= ?
      AND purchase_at < ?
    ORDER BY purchase_at DESC
  `).all(normalizedStore, range.start, range.end);

  const contextBySession = collectJourneySessionContextById(db, normalizedStore, sessions, range);
  const landingMap = new Map();
  const unattributedBreakdown = new Map();
  let attributedPurchases = 0;

  for (const row of sessions) {
    const sessionId = safeString(row?.session_id).trim();
    if (!sessionId) continue;

    const context = contextBySession.get(sessionId) || {};
    const entryPath = safeString(context.entryPath).trim();
    const landingPathValid = Boolean(entryPath && isJourneyLandingPath(entryPath));
    if (!landingPathValid) {
      const reason = summarizeJourneyUnattributedReason({
        entryPagePath: entryPath || null,
        checkoutToken: row?.last_checkout_token
      });
      unattributedBreakdown.set(reason, (unattributedBreakdown.get(reason) || 0) + 1);
      continue;
    }

    const landingLabel = classifyJourneyLandingLabel(entryPath) || 'Other';
    const key = landingLabel;
    const entry = landingMap.get(key) || {
      landing: landingLabel,
      purchases: 0,
      sessions: new Set(),
      countries: new Map(),
      sources: new Map(),
      campaigns: new Map(),
      products: new Map(),
      sample_sessions: []
    };

    entry.purchases += 1;
    entry.sessions.add(sessionId);
    if (entry.sample_sessions.length < 5) {
      entry.sample_sessions.push({
        session_id: sessionId,
        session_number: row?.session_number || null,
        purchase_at: row?.purchase_at || null
      });
    }

    const country = safeString(row?.last_country_code).trim().toUpperCase();
    if (country) entry.countries.set(country, (entry.countries.get(country) || 0) + 1);

    const source = safeString(context.entrySource).trim();
    if (source) entry.sources.set(source, (entry.sources.get(source) || 0) + 1);

    const campaign = safeString(context.entryCampaign).trim() || campaignLabelFromJson(row?.last_campaign_json) || '';
    if (campaign) entry.campaigns.set(campaign, (entry.campaigns.get(campaign) || 0) + 1);

    const productLabel = formatJourneyProductLabel({
      title: context.latestProductLabel || null,
      productId: row?.last_product_id
    });
    entry.products.set(productLabel, (entry.products.get(productLabel) || 0) + 1);

    landingMap.set(key, entry);
    attributedPurchases += 1;
  }

  const rows = Array.from(landingMap.values())
    .sort((a, b) => (b.purchases || 0) - (a.purchases || 0))
    .slice(0, max)
    .map((entry, index) => ({
      rank: index + 1,
      landing: entry.landing,
      purchases: entry.purchases,
      sessions: entry.sessions.size,
      share: sessions.length > 0 ? entry.purchases / sessions.length : 0,
      top_countries: Array.from(entry.countries.entries())
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 3)
        .map(([code, count]) => ({ code, count })),
      top_sources: Array.from(entry.sources.entries())
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 3)
        .map(([value, count]) => ({ value, count })),
      top_campaigns: Array.from(entry.campaigns.entries())
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 3)
        .map(([value, count]) => ({ value, count })),
      top_products: Array.from(entry.products.entries())
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 3)
        .map(([value, count]) => ({ value, count })),
      sample_sessions: entry.sample_sessions
    }));

  return {
    store: normalizedStore,
    period: { start: range.startIso, end: range.endIso },
    totalPurchases: sessions.length,
    attributedPurchases,
    unattributedPurchases: Math.max(0, sessions.length - attributedPurchases),
    unattributedBreakdown: Object.fromEntries(unattributedBreakdown.entries()),
    rows
  };
}

export function getSessionIntelligenceAbandonmentByLocation(store, {
  startDate,
  endDate,
  limit = JOURNEY_TABLE_DEFAULT_LIMIT
} = {}) {
  const db = getDb();
  const normalizedStore = safeString(store).trim() || 'shawq';
  ensureRecentShopperNumbers(normalizedStore);

  const range = resolveJourneyRange(startDate, endDate);
  if (!range) {
    return {
      store: normalizedStore,
      period: null,
      totalAbandonSessions: 0,
      classifiedAbandonSessions: 0,
      unclassifiedSessions: 0,
      coverageRatio: 0,
      reconciliation: { deviceMinusRoot: 0 },
      unclassifiedBreakdown: {},
      rows: [],
      deviceSegments: {
        totalSessions: 0,
        totalHighIntentSessions: 0,
        totalAbandonSessions: 0,
        baselineAbandonRate: 0,
        rows: []
      },
      countrySegments: {
        totalSessions: 0,
        totalHighIntentSessions: 0,
        totalAbandonSessions: 0,
        baselineAbandonRate: 0,
        rows: []
      }
    };
  }

  const max = normalizeJourneyLimit(limit);
  const sessions = db.prepare(`
    SELECT
      session_id,
      session_number,
      started_at,
      last_event_at,
      atc_at,
      checkout_started_at,
      purchase_at,
      last_checkout_token,
      last_checkout_step,
      last_country_code,
      last_product_id,
      last_device_type
    FROM si_sessions
    WHERE store = ?
      AND started_at IS NOT NULL
      AND started_at >= ?
      AND started_at < ?
      AND purchase_at IS NULL
      AND (
        NULLIF(atc_at, '') IS NOT NULL
        OR NULLIF(checkout_started_at, '') IS NOT NULL
        OR NULLIF(last_checkout_step, '') IS NOT NULL
      )
    ORDER BY started_at DESC
  `).all(normalizedStore, range.start, range.end);

  const contextBySession = collectJourneySessionContextById(db, normalizedStore, sessions, range);
  const grouped = new Map();
  const unclassifiedBreakdown = new Map();
  const abandonAreaBySession = new Map();
  let totalAbandonSessions = 0;
  let classifiedAbandonSessions = 0;

  for (const row of sessions) {
    const sessionId = safeString(row?.session_id).trim();
    if (!sessionId) continue;

    totalAbandonSessions += 1;

    const context = contextBySession.get(sessionId) || {};
    const entryPath = safeString(context.entryPath).trim();

    const productLabel = formatJourneyProductLabel({
      title: context.latestProductLabel || null,
      productId: row?.last_product_id
    });
    const classification = classifyJourneyAbandonAreaFromSession(row, productLabel, entryPath);
    if (!classification) {
      const reason = summarizeJourneyUnattributedReason({
        entryPagePath: entryPath || null,
        checkoutToken: row?.last_checkout_token
      });
      unclassifiedBreakdown.set(reason, (unclassifiedBreakdown.get(reason) || 0) + 1);
      continue;
    }

    classifiedAbandonSessions += 1;
    abandonAreaBySession.set(sessionId, classification.area);

    const areaKey = `${classification.area}||${classification.product || '—'}`;
    const entry = grouped.get(areaKey) || {
      abandoned_part: classification.area,
      product: classification.product || '—',
      sessions: 0,
      countries: new Map(),
      sample_sessions: []
    };
    entry.sessions += 1;
    if (entry.sample_sessions.length < 5) {
      entry.sample_sessions.push({
        session_id: sessionId,
        session_number: row?.session_number || null,
        last_event_at: row?.last_event_at || null
      });
    }
    const country = safeString(row?.last_country_code).trim().toUpperCase();
    if (country) entry.countries.set(country, (entry.countries.get(country) || 0) + 1);
    grouped.set(areaKey, entry);
  }

  const rows = Array.from(grouped.values())
    .sort((a, b) => (b.sessions || 0) - (a.sessions || 0))
    .slice(0, max)
    .map((entry, index) => ({
      rank: index + 1,
      abandoned_part: entry.abandoned_part,
      product: entry.product,
      sessions: entry.sessions,
      share: totalAbandonSessions > 0 ? entry.sessions / totalAbandonSessions : 0,
      top_countries: Array.from(entry.countries.entries())
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .slice(0, 3)
        .map(([code, count]) => ({ code, count })),
      sample_sessions: entry.sample_sessions
    }));

  const deviceLabelByKey = {
    desktop: 'Desktop',
    mobile: 'Mobile',
    ios: 'iOS',
    android: 'Android',
    tablet: 'Tablet',
    unknown: 'Unknown'
  };
  const deviceBuckets = new Map(Object.keys(deviceLabelByKey).map((key) => ([
    key,
    {
      key,
      label: deviceLabelByKey[key],
      totalSessions: 0,
      highIntentSessions: 0,
      abandonSessions: 0,
      purchaseSessions: 0,
      sectionCounts: new Map()
    }
  ])));
  const countryBuckets = new Map();

  const allSessions = db.prepare(`
    SELECT
      session_id,
      atc_at,
      checkout_started_at,
      purchase_at,
      last_checkout_step,
      last_device_type,
      last_country_code
    FROM si_sessions
    WHERE store = ?
      AND started_at IS NOT NULL
      AND started_at >= ?
      AND started_at < ?
  `).all(normalizedStore, range.start, range.end);

  for (const session of allSessions) {
    const countrySegment = normalizeJourneyCountrySegment(session?.last_country_code);
    if (!countryBuckets.has(countrySegment)) {
      countryBuckets.set(countrySegment, {
        key: countrySegment,
        label: countrySegment === JOURNEY_COUNTRY_UNKNOWN_KEY ? 'Unknown' : countrySegment,
        totalSessions: 0,
        highIntentSessions: 0,
        abandonSessions: 0,
        purchaseSessions: 0,
        sectionCounts: new Map()
      });
    }

    const segmentKey = normalizeJourneyDeviceSegment(session?.last_device_type);
    const bucket = deviceBuckets.get(segmentKey) || deviceBuckets.get('unknown');
    const countryBucket = countryBuckets.get(countrySegment);
    if (!bucket) continue;

    bucket.totalSessions += 1;
    if (countryBucket) countryBucket.totalSessions += 1;
    const checkoutStep = normalizeCheckoutStep(session?.last_checkout_step);
    const hasPurchase = Boolean(safeString(session?.purchase_at).trim());
    const isHighIntent = Boolean(
      hasPurchase
      || safeString(session?.atc_at).trim()
      || safeString(session?.checkout_started_at).trim()
      || checkoutStep
    );
    if (!isHighIntent) continue;

    bucket.highIntentSessions += 1;
    if (countryBucket) countryBucket.highIntentSessions += 1;
    if (hasPurchase) {
      bucket.purchaseSessions += 1;
      if (countryBucket) countryBucket.purchaseSessions += 1;
      continue;
    }

    bucket.abandonSessions += 1;
    if (countryBucket) countryBucket.abandonSessions += 1;
    const sessionId = safeString(session?.session_id).trim();
    const fallbackSection = checkoutStep === 'payment'
      ? 'Checkout Payment'
      : (checkoutStep === 'shipping' || checkoutStep === 'contact' || safeString(session?.checkout_started_at).trim())
        ? 'Checkout'
        : safeString(session?.atc_at).trim()
          ? 'Cart'
          : 'Landing';
    const section = abandonAreaBySession.get(sessionId) || fallbackSection;
    bucket.sectionCounts.set(section, (bucket.sectionCounts.get(section) || 0) + 1);
    if (countryBucket) {
      countryBucket.sectionCounts.set(section, (countryBucket.sectionCounts.get(section) || 0) + 1);
    }
  }

  const bucketRows = Array.from(deviceBuckets.values()).filter((bucket) => bucket.totalSessions > 0);
  const totalClassifiedSessions = bucketRows.reduce((sum, bucket) => sum + bucket.totalSessions, 0);
  const totalHighIntentSessions = bucketRows.reduce((sum, bucket) => sum + bucket.highIntentSessions, 0);
  const totalSegmentAbandonSessions = bucketRows.reduce((sum, bucket) => sum + bucket.abandonSessions, 0);
  const baselineAbandonRate = totalHighIntentSessions > 0
    ? totalSegmentAbandonSessions / totalHighIntentSessions
    : 0;
  const unclassifiedSessions = Array.from(unclassifiedBreakdown.values()).reduce((sum, count) => sum + (Number(count) || 0), 0);
  const coverageRatio = totalAbandonSessions > 0 ? classifiedAbandonSessions / totalAbandonSessions : 0;

  const deviceRows = bucketRows
    .map((bucket) => {
      const topSectionEntry = Array.from(bucket.sectionCounts.entries())
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))[0] || null;
      const topSectionLabel = topSectionEntry ? topSectionEntry[0] : '—';
      const topSectionCount = topSectionEntry ? Number(topSectionEntry[1]) || 0 : 0;
      const topSectionShare = bucket.abandonSessions > 0 ? topSectionCount / bucket.abandonSessions : 0;
      const abandonRate = bucket.highIntentSessions > 0 ? bucket.abandonSessions / bucket.highIntentSessions : null;
      const purchaseRate = bucket.highIntentSessions > 0 ? bucket.purchaseSessions / bucket.highIntentSessions : null;
      const expectedAbandon = bucket.highIntentSessions * baselineAbandonRate;
      const excessAbandon = bucket.abandonSessions - expectedAbandon;
      return {
        key: bucket.key,
        label: bucket.label,
        totalSessions: bucket.totalSessions,
        highIntentSessions: bucket.highIntentSessions,
        abandonSessions: bucket.abandonSessions,
        purchaseSessions: bucket.purchaseSessions,
        trafficShare: totalClassifiedSessions > 0 ? bucket.totalSessions / totalClassifiedSessions : 0,
        abandonShare: totalSegmentAbandonSessions > 0 ? bucket.abandonSessions / totalSegmentAbandonSessions : 0,
        abandonRate,
        purchaseRate,
        expectedAbandon,
        excessAbandon,
        overIndex: baselineAbandonRate > 0 && abandonRate != null ? abandonRate / baselineAbandonRate : null,
        topSectionLabel,
        topSectionShare,
        sectionCounts: Object.fromEntries(bucket.sectionCounts.entries())
      };
    })
    .sort((a, b) => {
      if ((b.excessAbandon || 0) !== (a.excessAbandon || 0)) return (b.excessAbandon || 0) - (a.excessAbandon || 0);
      return (b.abandonRate || 0) - (a.abandonRate || 0);
    });
  const countryBucketRows = Array.from(countryBuckets.values()).filter((bucket) => bucket.totalSessions > 0);
  const totalCountrySessions = countryBucketRows.reduce((sum, bucket) => sum + bucket.totalSessions, 0);
  const totalCountryHighIntentSessions = countryBucketRows.reduce((sum, bucket) => sum + bucket.highIntentSessions, 0);
  const totalCountryAbandonSessions = countryBucketRows.reduce((sum, bucket) => sum + bucket.abandonSessions, 0);
  const countryBaselineAbandonRate = totalCountryHighIntentSessions > 0
    ? totalCountryAbandonSessions / totalCountryHighIntentSessions
    : 0;

  const countryRows = countryBucketRows
    .map((bucket) => {
      const topSectionEntry = Array.from(bucket.sectionCounts.entries())
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))[0] || null;
      const topSectionLabel = topSectionEntry ? topSectionEntry[0] : '—';
      const topSectionCount = topSectionEntry ? Number(topSectionEntry[1]) || 0 : 0;
      const topSectionShare = bucket.abandonSessions > 0 ? topSectionCount / bucket.abandonSessions : 0;
      const abandonRate = bucket.highIntentSessions > 0 ? bucket.abandonSessions / bucket.highIntentSessions : null;
      const purchaseRate = bucket.highIntentSessions > 0 ? bucket.purchaseSessions / bucket.highIntentSessions : null;
      const expectedAbandon = bucket.highIntentSessions * countryBaselineAbandonRate;
      const excessAbandon = bucket.abandonSessions - expectedAbandon;
      return {
        key: bucket.key,
        label: bucket.label,
        totalSessions: bucket.totalSessions,
        highIntentSessions: bucket.highIntentSessions,
        abandonSessions: bucket.abandonSessions,
        purchaseSessions: bucket.purchaseSessions,
        trafficShare: totalCountrySessions > 0 ? bucket.totalSessions / totalCountrySessions : 0,
        abandonShare: totalCountryAbandonSessions > 0 ? bucket.abandonSessions / totalCountryAbandonSessions : 0,
        abandonRate,
        purchaseRate,
        expectedAbandon,
        excessAbandon,
        overIndex: countryBaselineAbandonRate > 0 && abandonRate != null ? abandonRate / countryBaselineAbandonRate : null,
        topSectionLabel,
        topSectionShare,
        sectionCounts: Object.fromEntries(bucket.sectionCounts.entries())
      };
    })
    .sort((a, b) => {
      if ((b.excessAbandon || 0) !== (a.excessAbandon || 0)) return (b.excessAbandon || 0) - (a.excessAbandon || 0);
      return (b.abandonRate || 0) - (a.abandonRate || 0);
    });

  return {
    store: normalizedStore,
    period: { start: range.startIso, end: range.endIso },
    totalAbandonSessions,
    classifiedAbandonSessions,
    attributedAbandonSessions: classifiedAbandonSessions,
    unclassifiedSessions,
    coverageRatio,
    reconciliation: {
      deviceMinusRoot: totalSegmentAbandonSessions - totalAbandonSessions,
      deviceSegmentTotal: totalSegmentAbandonSessions,
      rootQueryTotal: totalAbandonSessions
    },
    unclassifiedBreakdown: Object.fromEntries(unclassifiedBreakdown.entries()),
    rows,
    deviceSegments: {
      totalSessions: totalClassifiedSessions,
      totalHighIntentSessions,
      totalAbandonSessions: totalSegmentAbandonSessions,
      baselineAbandonRate,
      rows: deviceRows
    },
    countrySegments: {
      totalSessions: totalCountrySessions,
      totalHighIntentSessions: totalCountryHighIntentSessions,
      totalAbandonSessions: totalCountryAbandonSessions,
      baselineAbandonRate: countryBaselineAbandonRate,
      rows: countryRows
    }
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
  const max = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 5000);
  const range = dayRangeUtc(dateStr);
  if (!range) return [];

  const distinctEventNames = db.prepare(`
    SELECT DISTINCT lower(event_name) AS name
    FROM si_events
    WHERE store = ?
      AND created_at >= ?
      AND created_at < ?
  `).all(store, range.start, range.end)
    .map((row) => row?.name)
    .filter(Boolean);

  const productViewNames = distinctEventNames.filter((name) => isProductViewedEvent(name, ''));
  const atcNames = distinctEventNames.filter(isAddToCart);
  const cartNames = distinctEventNames.filter((name) => isCartViewedEvent(name, ''));
  const checkoutNames = distinctEventNames.filter(isCheckoutStarted);
  const purchaseNames = distinctEventNames.filter(isPurchase);

  const toInClause = (values) => {
    const unique = Array.from(new Set(values)).filter(Boolean);
    if (!unique.length) return { clause: 'NULL', params: [] };
    return { clause: unique.map(() => '?').join(','), params: unique };
  };

  const productViewIn = toInClause(productViewNames);
  const atcIn = toInClause(atcNames);
  const cartIn = toInClause(cartNames);
  const checkoutIn = toInClause(checkoutNames);
  const purchaseIn = toInClause(purchaseNames);

  const query = `
    WITH day_events AS (
      SELECT
        session_id,
        MAX(shopper_number) AS shopper_number,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen,
        SUM(CASE WHEN lower(event_name) IN (${productViewIn.clause}) OR (page_path LIKE '/products/%') THEN 1 ELSE 0 END) AS product_views,
        SUM(CASE WHEN lower(event_name) IN (${atcIn.clause}) THEN 1 ELSE 0 END) AS atc_events,
        SUM(CASE WHEN lower(event_name) IN (${cartIn.clause}) OR (page_path = '/cart' OR page_path = '/cart/') THEN 1 ELSE 0 END) AS cart_events,
        SUM(CASE WHEN lower(event_name) IN (${checkoutIn.clause}) THEN 1 ELSE 0 END) AS checkout_started_events,
        SUM(CASE WHEN lower(event_name) IN (${purchaseIn.clause}) THEN 1 ELSE 0 END) AS purchase_events,
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
      d.product_views,
      d.atc_events,
      d.cart_events,
      d.checkout_started_events,
      d.purchase_events,
      NULLIF(d.last_checkout_step, '') AS last_checkout_step,
      NULLIF(d.device_type, '') AS device_type,
      NULLIF(d.country_code, '') AS country_code,
      NULLIF(d.product_id, '') AS product_id,
      NULLIF(d.variant_id, '') AS variant_id,
      NULLIF(d.utm_campaign, '') AS utm_campaign,
      NULLIF(d.utm_source, '') AS utm_source,
      s.session_number,
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
  `;

  const params = [
    ...productViewIn.params,
    ...atcIn.params,
    ...cartIn.params,
    ...checkoutIn.params,
    ...purchaseIn.params,
    store,
    range.start,
    range.end,
    store,
    max
  ];

  return db.prepare(query).all(...params).map((row) => ({
    ...row,
    codename: makeSessionDisplayCode({ sessionNumber: row.session_number, sessionId: row.session_id })
  }));
}

const SESSION_FLOW_STAGE_ORDER = [
  'landing',
  'product',
  'atc',
  'cart',
  'checkout_contact',
  'checkout_shipping',
  'checkout_payment',
  'purchase'
];

const SESSION_FLOW_STAGE_LABELS = {
  landing: 'Landing',
  product: 'Product',
  atc: 'Add to cart',
  cart: 'Cart',
  checkout_contact: 'Checkout (Contact)',
  checkout_shipping: 'Checkout (Shipping)',
  checkout_payment: 'Checkout (Payment)',
  purchase: 'Purchase'
};

function resolveSessionFlowMode(raw) {
  const mode = safeString(raw).toLowerCase().trim();
  if (mode === 'high_intent_no_purchase' || mode === 'high-intent-no-purchase' || mode === 'high_intent') return 'high_intent_no_purchase';
  return 'all';
}

function isProductStageEvent(eventName, pagePath) {
  return isProductViewedEvent(eventName, pagePath);
}

function isCartStageEvent(eventName, pagePath) {
  return isCartViewedEvent(eventName, pagePath);
}

function stageFromEvent({ eventName, pagePath, checkoutStep }) {
  const name = safeString(eventName).toLowerCase().trim();
  const step = normalizeCheckoutStep(checkoutStep);

  if (isPurchase(name) || step === 'thank_you') return 'purchase';
  if (step === 'payment') return 'checkout_payment';
  if (step === 'shipping') return 'checkout_shipping';
  if (step === 'contact' || isCheckoutStarted(name)) return 'checkout_contact';

  if (isAddToCart(name)) return 'atc';
  if (isCartStageEvent(name, pagePath)) return 'cart';
  if (isProductStageEvent(name, pagePath)) return 'product';

  return null;
}

function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const p = Number(percentile);
  if (!Number.isFinite(p) || p < 0 || p > 1) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  const value = sorted[index];
  return Number.isFinite(value) ? value : null;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
  return sum / values.length;
}

function inferDropoffStageFromSessionSummary(session) {
  if (!session || typeof session !== 'object') return 'landing';
  if ((session.purchase_events || 0) > 0) return 'purchase';

  if ((session.checkout_started_events || 0) > 0) {
    const step = normalizeCheckoutStep(session.last_checkout_step);
    if (step === 'payment') return 'checkout_payment';
    if (step === 'shipping') return 'checkout_shipping';
    return 'checkout_contact';
  }

  if ((session.cart_events || 0) > 0) return 'cart';
  if ((session.atc_events || 0) > 0) return 'atc';
  if ((session.product_views || 0) > 0) return 'product';
  return 'landing';
}

function isHighIntentNoPurchaseSession(session) {
  if (!session || typeof session !== 'object') return false;
  const atcEvents = Number(session.atc_events) || 0;
  const checkoutStartedEvents = Number(session.checkout_started_events) || 0;
  const purchaseEvents = Number(session.purchase_events) || 0;
  return (atcEvents > 0 || checkoutStartedEvents > 0) && purchaseEvents === 0;
}

export function getSessionIntelligenceFlowForDay(store, dateStr, { mode = 'all', limitSessions = 5000 } = {}) {
  const db = getDb();
  ensureRecentShopperNumbers(store);

  const iso = requireIsoDay(dateStr);
  if (!iso) {
    return { success: false, error: 'Invalid date. Expected YYYY-MM-DD.' };
  }

  const scope = resolveSessionFlowMode(mode);
  const range = dayRangeUtc(iso);
  if (!range) {
    return { success: false, error: 'Invalid date. Expected YYYY-MM-DD.' };
  }

  const sessions = getSessionIntelligenceSessionsForDay(store, iso, limitSessions);
  const highIntentNoPurchaseSessions = sessions.filter(isHighIntentNoPurchaseSession);
  const selectedSessions = scope === 'high_intent_no_purchase'
    ? highIntentNoPurchaseSessions
    : sessions;

  const sessionMap = new Map(selectedSessions.map((s) => [s.session_id, s]));
  const sessionIds = Array.from(sessionMap.keys()).filter(Boolean);

  const stageStats = new Map(
    SESSION_FLOW_STAGE_ORDER.map((stage) => [stage, { stage, reached: 0, dropoffs: 0, dwellSecs: [], advanceToNext: 0 }])
  );

  if (sessionIds.length === 0) {
    const stages = SESSION_FLOW_STAGE_ORDER.map((stage) => ({
      stage,
      label: SESSION_FLOW_STAGE_LABELS[stage] || stage,
      reached: 0,
      dropoffs: 0,
      advanceToNext: 0,
      avg_dwell_sec: null,
      p50_dwell_sec: null,
      p90_dwell_sec: null
    }));

    return {
      success: true,
      data: {
        store,
        date: iso,
        mode: scope,
        totals: {
          sessions: 0,
          all_sessions: sessions.length,
          high_intent_no_purchase_sessions: highIntentNoPurchaseSessions.length
        },
        stages,
        clusters: []
      }
    };
  }

  const stageTimesBySession = new Map();

  const sessionChunks = chunkArray(sessionIds, 450);
  for (const chunk of sessionChunks) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT
        id,
        session_id,
        event_name,
        event_ts,
        created_at,
        page_path,
        checkout_step
      FROM si_events
      WHERE store = ?
        AND created_at >= ?
        AND created_at < ?
        AND session_id IN (${placeholders})
      ORDER BY session_id, event_ts, id
    `).all(store, range.start, range.end, ...chunk);

    for (const row of rows) {
      const sessionId = row.session_id;
      if (!sessionId) continue;
      let entry = stageTimesBySession.get(sessionId);
      if (!entry) {
        entry = { startMs: Number.POSITIVE_INFINITY, endMs: Number.NEGATIVE_INFINITY, stages: {} };
        stageTimesBySession.set(sessionId, entry);
      }

      const ms = Number.isFinite(parseSqliteDateTimeToMs(row.event_ts))
        ? parseSqliteDateTimeToMs(row.event_ts)
        : parseSqliteDateTimeToMs(row.created_at);
      if (!Number.isFinite(ms)) continue;

      if (ms < entry.startMs) entry.startMs = ms;
      if (ms > entry.endMs) entry.endMs = ms;

      const stage = stageFromEvent({
        eventName: row.event_name,
        pagePath: row.page_path,
        checkoutStep: row.checkout_step
      });
      if (!stage) continue;
      if (!entry.stages[stage] || ms < entry.stages[stage]) {
        entry.stages[stage] = ms;
      }
    }
  }

  const dropBuckets = new Map();

  for (const sessionId of sessionIds) {
    const entry = stageTimesBySession.get(sessionId);
    if (!entry || !Number.isFinite(entry.startMs) || !Number.isFinite(entry.endMs)) continue;

    // Ensure landing exists so the flow always starts.
    const stageTimes = { ...entry.stages, landing: entry.startMs };

    // Reached + dwell.
    for (let idx = 0; idx < SESSION_FLOW_STAGE_ORDER.length; idx += 1) {
      const stage = SESSION_FLOW_STAGE_ORDER[idx];
      const t0 = stageTimes[stage];
      if (!Number.isFinite(t0)) continue;

      const stat = stageStats.get(stage);
      if (!stat) continue;
      stat.reached += 1;

      // Find the next later stage time (not necessarily the next funnel stage).
      let nextMs = Number.POSITIVE_INFINITY;
      for (let j = idx + 1; j < SESSION_FLOW_STAGE_ORDER.length; j += 1) {
        const candidate = stageTimes[SESSION_FLOW_STAGE_ORDER[j]];
        if (!Number.isFinite(candidate)) continue;
        if (candidate <= t0) continue;
        if (candidate < nextMs) nextMs = candidate;
      }
      const exitMs = Number.isFinite(nextMs) && nextMs !== Number.POSITIVE_INFINITY ? nextMs : entry.endMs;
      const dwellSec = Math.max(0, (exitMs - t0) / 1000);
      // Ignore obviously broken dwell times.
      if (Number.isFinite(dwellSec) && dwellSec <= 6 * 60 * 60) {
        stat.dwellSecs.push(dwellSec);
      }

      // Advance to the next funnel stage specifically (helps compute conversion).
      const nextStage = SESSION_FLOW_STAGE_ORDER[idx + 1] || null;
      const nextStageMs = nextStage ? stageTimes[nextStage] : null;
      if (nextStage && Number.isFinite(nextStageMs) && nextStageMs > t0) {
        stat.advanceToNext += 1;
      }
    }

    // Drop-off stage = last reached stage by timestamp (purchase = success).
    let lastStage = null;
    let lastTime = Number.NEGATIVE_INFINITY;
    for (const stage of SESSION_FLOW_STAGE_ORDER) {
      const t = stageTimes[stage];
      if (!Number.isFinite(t)) continue;
      if (t > lastTime) {
        lastTime = t;
        lastStage = stage;
      }
    }

    if (lastStage && lastStage !== 'purchase') {
      const stat = stageStats.get(lastStage);
      if (stat) stat.dropoffs += 1;
      if (!dropBuckets.has(lastStage)) dropBuckets.set(lastStage, []);
      dropBuckets.get(lastStage).push(sessionMap.get(sessionId));
    }
  }

  const stages = SESSION_FLOW_STAGE_ORDER.map((stage) => {
    const stat = stageStats.get(stage);
    const dwell = stat?.dwellSecs || [];
    return {
      stage,
      label: SESSION_FLOW_STAGE_LABELS[stage] || stage,
      reached: stat?.reached || 0,
      dropoffs: stat?.dropoffs || 0,
      advanceToNext: stat?.advanceToNext || 0,
      avg_dwell_sec: dwell.length ? average(dwell) : null,
      p50_dwell_sec: dwell.length ? computePercentile(dwell, 0.5) : null,
      p90_dwell_sec: dwell.length ? computePercentile(dwell, 0.9) : null
    };
  });

  const clusters = Array.from(dropBuckets.entries())
    .map(([stage, list]) => {
      const reached = stageStats.get(stage)?.reached || 0;
      const dropped = list.length;
      const label = SESSION_FLOW_STAGE_LABELS[stage] || stage;
      const dwell = stageStats.get(stage)?.dwellSecs || [];
      return {
        stage,
        label,
        dropped,
        reached,
        drop_rate: reached > 0 ? dropped / reached : null,
        avg_dwell_sec: dwell.length ? average(dwell) : null,
        p50_dwell_sec: dwell.length ? computePercentile(dwell, 0.5) : null,
        top_devices: buildTopCounts(list, 'device_type', 3),
        top_countries: buildTopCounts(list, 'country_code', 3),
        top_campaigns: buildTopCounts(list, 'utm_campaign', 3),
        sample_sessions: (list || []).slice(0, 6).map((s) => ({
          codename: s?.codename,
          session_id: s?.session_id,
          last_seen: s?.last_seen,
          device_type: s?.device_type || null,
          country_code: s?.country_code || null,
          utm_campaign: s?.utm_campaign || null,
          inferred_drop_stage: inferDropoffStageFromSessionSummary(s)
        }))
      };
    })
    .sort((a, b) => (b.dropped || 0) - (a.dropped || 0))
    .slice(0, 12);

  return {
    success: true,
    data: {
      store,
      date: iso,
      mode: scope,
      totals: {
        sessions: selectedSessions.length,
        all_sessions: sessions.length,
        high_intent_no_purchase_sessions: highIntentNoPurchaseSessions.length
      },
      stages,
      clusters
    }
  };
}

export function getSessionIntelligenceClaritySignalsForDay(store, dateStr, { mode = 'high_intent_no_purchase', limitSessions = 5000 } = {}) {
  const db = getDb();
  ensureRecentShopperNumbers(store);

  const iso = requireIsoDay(dateStr);
  if (!iso) {
    return { success: false, error: 'Invalid date. Expected YYYY-MM-DD.' };
  }

  const scope = resolveSessionFlowMode(mode);
  const range = dayRangeUtc(iso);
  if (!range) {
    return { success: false, error: 'Invalid date. Expected YYYY-MM-DD.' };
  }

  const sessions = getSessionIntelligenceSessionsForDay(store, iso, limitSessions);
  const highIntentNoPurchaseSessions = sessions.filter(isHighIntentNoPurchaseSession);
  const selectedSessions = scope === 'high_intent_no_purchase'
    ? highIntentNoPurchaseSessions
    : sessions;

  const sessionMap = new Map(selectedSessions.map((s) => [s.session_id, s]));
  const sessionIds = Array.from(sessionMap.keys()).filter(Boolean);

  if (sessionIds.length === 0) {
    return {
      success: true,
      data: {
        store,
        date: iso,
        mode: scope,
        totals: {
          sessions: 0,
          all_sessions: sessions.length,
          high_intent_no_purchase_sessions: highIntentNoPurchaseSessions.length
        },
        signals: {
          rage_clicks: [],
          dead_clicks: [],
          js_errors: [],
          form_invalid: [],
          scroll_dropoff: []
        }
      }
    };
  }

  const SIGNAL_EVENTS = new Set([
    'rage_click',
    'dead_click',
    'js_error',
    'unhandled_rejection',
    'form_invalid',
    'scroll_depth',
    'scroll_max'
  ]);

  const rageCounts = new Map(); // key => { count, sessions:Set, page, targetKey, sample:[] }
  const deadCounts = new Map();
  const errorCounts = new Map(); // key => { count, sessions:Set, message, page, sample:[] }
  const formCounts = new Map(); // key => { count, sessions:Set, field_type, field_name, sample:[] }
  const scrollMaxBySessionPage = new Map(); // `${sessionId}|${page}` => maxPercent

  const pageKey = (raw) => {
    const p = safeString(raw).trim();
    if (!p) return '/';
    return p.split('?')[0].split('#')[0] || '/';
  };

  const addSample = (entry, sessionId) => {
    if (!entry || !sessionId) return;
    if (!entry.sample) entry.sample = [];
    if (entry.sample.length >= 6) return;
    if (entry.sample.includes(sessionId)) return;
    entry.sample.push(sessionId);
  };

  const chunks = chunkArray(sessionIds, 450);
  for (const chunk of chunks) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT
        session_id,
        lower(event_name) AS event_name,
        page_path,
        data_json
      FROM si_events
      WHERE store = ?
        AND created_at >= ?
        AND created_at < ?
        AND session_id IN (${placeholders})
        AND lower(event_name) IN (
          'rage_click','dead_click','js_error','unhandled_rejection','form_invalid','scroll_depth','scroll_max'
        )
      ORDER BY created_at DESC
      LIMIT 25000
    `).all(store, range.start, range.end, ...chunk);

    for (const row of rows) {
      const sessionId = row.session_id;
      const name = row.event_name;
      if (!sessionId || !SIGNAL_EVENTS.has(name)) continue;

      const page = pageKey(row.page_path);
      const data = safeJsonParse(row.data_json) || {};

      if (name === 'rage_click') {
        const targetKey = safeString(data.target_key || data?.target?.key || '').trim() || 'unknown';
        const key = `${page}||${targetKey}`;
        const entry = rageCounts.get(key) || { page, target_key: targetKey, count: 0, sessions: new Set(), sample: [] };
        entry.count += 1;
        entry.sessions.add(sessionId);
        addSample(entry, sessionId);
        rageCounts.set(key, entry);
        continue;
      }

      if (name === 'dead_click') {
        const targetKey = safeString(data.target_key || data?.target?.key || '').trim() || 'unknown';
        const key = `${page}||${targetKey}`;
        const entry = deadCounts.get(key) || { page, target_key: targetKey, count: 0, sessions: new Set(), sample: [] };
        entry.count += 1;
        entry.sessions.add(sessionId);
        addSample(entry, sessionId);
        deadCounts.set(key, entry);
        continue;
      }

      if (name === 'js_error' || name === 'unhandled_rejection') {
        const message = safeString(data.message || data.reason || '').trim() || 'Unknown error';
        const key = `${page}||${message.slice(0, 180)}`;
        const entry = errorCounts.get(key) || { page, message: message.slice(0, 220), count: 0, sessions: new Set(), sample: [] };
        entry.count += 1;
        entry.sessions.add(sessionId);
        addSample(entry, sessionId);
        errorCounts.set(key, entry);
        continue;
      }

      if (name === 'form_invalid') {
        const fieldType = safeString(data.field_type || '').trim() || null;
        const fieldName = safeString(data.field_name || '').trim() || null;
        const key = `${page}||${fieldType || ''}||${fieldName || ''}`;
        const entry = formCounts.get(key) || { page, field_type: fieldType, field_name: fieldName, count: 0, sessions: new Set(), sample: [] };
        entry.count += 1;
        entry.sessions.add(sessionId);
        addSample(entry, sessionId);
        formCounts.set(key, entry);
        continue;
      }

      if (name === 'scroll_depth' || name === 'scroll_max') {
        const percent = Number(data.max_percent ?? data.percent);
        const maxPercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
        if (maxPercent == null) continue;
        const key = `${sessionId}||${page}`;
        const existing = scrollMaxBySessionPage.get(key) || 0;
        if (maxPercent > existing) scrollMaxBySessionPage.set(key, maxPercent);
      }
    }
  }

  const asTopList = (map, toItem, limit = 10) => (
    Array.from(map.values())
      .map(toItem)
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, limit)
  );

  const sessionStub = (sessionId) => {
    const s = sessionMap.get(sessionId) || null;
    if (!s) return { session_id: sessionId };
    return {
      session_id: s.session_id,
      codename: s.codename,
      shopper_number: s.shopper_number || null,
      last_seen: s.last_seen || null,
      device_type: s.device_type || null,
      country_code: s.country_code || null,
      utm_source: s.utm_source || null,
      utm_campaign: s.utm_campaign || null,
      atc_events: s.atc_events || 0,
      checkout_started_events: s.checkout_started_events || 0,
      purchase_events: s.purchase_events || 0,
      last_checkout_step: s.last_checkout_step || null
    };
  };

  const rage_clicks = asTopList(
    rageCounts,
    (entry) => ({
      page: entry.page,
      target_key: entry.target_key,
      count: entry.count,
      sessions: entry.sessions.size,
      sample_sessions: (entry.sample || []).map(sessionStub)
    })
  );

  const dead_clicks = asTopList(
    deadCounts,
    (entry) => ({
      page: entry.page,
      target_key: entry.target_key,
      count: entry.count,
      sessions: entry.sessions.size,
      sample_sessions: (entry.sample || []).map(sessionStub)
    })
  );

  const js_errors = asTopList(
    errorCounts,
    (entry) => ({
      page: entry.page,
      message: entry.message,
      count: entry.count,
      sessions: entry.sessions.size,
      sample_sessions: (entry.sample || []).map(sessionStub)
    })
  );

  const form_invalid = asTopList(
    formCounts,
    (entry) => ({
      page: entry.page,
      field_type: entry.field_type,
      field_name: entry.field_name,
      count: entry.count,
      sessions: entry.sessions.size,
      sample_sessions: (entry.sample || []).map(sessionStub)
    })
  );

  // Scroll drop-off buckets by page (how many sessions never reached the bucket).
  const scrollBuckets = [25, 50, 75, 90];
  const scrollByPage = new Map(); // page => { totalSessions:Set, maxBySession:Map(sessionId=>max) }
  for (const key of scrollMaxBySessionPage.keys()) {
    const parts = key.split('||');
    if (parts.length < 2) continue;
    const sessionId = parts[0];
    const page = parts.slice(1).join('||');
    if (!sessionId || !page) continue;
    let entry = scrollByPage.get(page);
    if (!entry) {
      entry = { maxBySession: new Map() };
      scrollByPage.set(page, entry);
    }
    entry.maxBySession.set(sessionId, scrollMaxBySessionPage.get(key) || 0);
  }

  const scroll_dropoff = Array.from(scrollByPage.entries())
    .map(([page, entry]) => {
      const maxValues = Array.from(entry.maxBySession.values());
      if (maxValues.length < MIN_SESSIONS_FOR_SCROLL_DROPOFF) return null; // keep signal high
      const total = maxValues.length;
      const reached = {};
      scrollBuckets.forEach((b) => {
        reached[b] = maxValues.filter((v) => v >= b).length;
      });
      return {
        page,
        total_sessions: total,
        reached_25: reached[25],
        reached_50: reached[50],
        reached_75: reached[75],
        reached_90: reached[90]
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.total_sessions || 0) - (a.total_sessions || 0))
    .slice(0, 10);

  return {
    success: true,
    data: {
      store,
      date: iso,
      mode: scope,
      totals: {
        sessions: selectedSessions.length,
        all_sessions: sessions.length,
        high_intent_no_purchase_sessions: highIntentNoPurchaseSessions.length
      },
      signals: {
        rage_clicks,
        dead_clicks,
        js_errors,
        form_invalid,
        scroll_dropoff
      }
    }
  };
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
        e.id,
        e.store,
        e.session_id,
        s.session_number,
        e.event_name,
        e.event_ts,
        e.page_path,
        e.checkout_step,
        e.device_type,
        e.country_code,
        e.product_id,
        e.variant_id,
        e.utm_source,
        e.utm_medium,
        e.utm_campaign,
        e.utm_content,
        e.utm_term,
        e.fbclid,
        e.gclid,
        e.ttclid,
        e.msclkid,
        e.wbraid,
        e.gbraid,
        e.irclickid,
        e.data_json,
        e.created_at
      FROM si_events e
        LEFT JOIN si_sessions s
        ON s.store = e.store AND s.session_id = e.session_id
      WHERE e.store = ?
        AND e.session_id = ?
        AND e.created_at >= ?
        AND e.created_at < ?
      ORDER BY e.created_at ASC
      LIMIT ?
    `).all(store, sessionId, range.start, range.end, max).map((row) => ({
      ...row,
      codename: makeSessionDisplayCode({ sessionNumber: row.session_number, sessionId: row.session_id })
    }));
  }

  return db.prepare(`
    SELECT
      e.id,
      e.store,
      e.session_id,
      s.session_number,
      e.event_name,
      e.event_ts,
      e.page_path,
      e.checkout_step,
      e.device_type,
      e.country_code,
      e.product_id,
      e.variant_id,
      e.utm_source,
      e.utm_medium,
      e.utm_campaign,
      e.utm_content,
      e.utm_term,
      e.fbclid,
      e.gclid,
      e.ttclid,
      e.msclkid,
      e.wbraid,
      e.gbraid,
      e.irclickid,
      e.created_at
    FROM si_events e
      LEFT JOIN si_sessions s
      ON s.store = e.store AND s.session_id = e.session_id
    WHERE e.store = ?
      AND e.created_at >= ?
      AND e.created_at < ?
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(store, range.start, range.end, max).map((row) => ({
    ...row,
    codename: makeSessionDisplayCode({ sessionNumber: row.session_number, sessionId: row.session_id })
  }));
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
  model = process.env.SESSION_INTELLIGENCE_AI_MODEL || (process.env.DEEPSEEK_API_KEY ? 'deepseek-reasoner' : 'gpt-4o-mini'),
  temperature = null
}) {
  const db = getDb();
  const events = getSessionIntelligenceEventsForSession(store, sessionId, 1200);
  if (!events.length) {
    return { success: false, error: 'No events found for this session.' };
  }

  console.log('[SessionIntelligence] analyze-session start', {
    store,
    sessionId,
    model,
    temperature
  });

  db.prepare(`
    UPDATE si_sessions
    SET analysis_state = 'running', updated_at = datetime('now')
    WHERE store = ? AND session_id = ?
  `).run(store, sessionId);

  const sessionRow = db.prepare(`
    SELECT session_number
    FROM si_sessions
    WHERE store = ? AND session_id = ?
  `).get(store, sessionId);

  const codename = makeSessionDisplayCode({ sessionNumber: sessionRow?.session_number, sessionId });
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

  const userPayload = JSON.stringify({ store, session_codename: codename, session_id: sessionId, timeline });

  const askWithModel = async (modelToUse) => {
    if (typeof modelToUse === 'string' && modelToUse.startsWith('deepseek-')) {
      const safeTemp = normalizeTemperature(temperature, 0.0);
      const resp = await askDeepSeekChat({
        model: modelToUse,
        systemPrompt,
        messages: [{ role: 'user', content: userPayload }],
        maxOutputTokens: 900,
        temperature: safeTemp
      });
      return resp.text;
    }

    return await askOpenAIChat({
      model: modelToUse,
      systemPrompt,
      messages: [{ role: 'user', content: userPayload }],
      maxOutputTokens: 900,
      verbosity: 'low'
    });
  };

  const candidates = [];
  if (model) candidates.push(model);
  if (model === 'deepseek-reasoner') candidates.push('deepseek-chat');
  if (model !== 'gpt-4o-mini') candidates.push('gpt-4o-mini');

  let text = '';
  let usedModel = model;
  let lastError = null;

  for (const candidate of candidates) {
    try {
      usedModel = candidate;
      // eslint-disable-next-line no-await-in-loop
      text = await askWithModel(candidate);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!text) {
    db.prepare(`
      UPDATE si_sessions
      SET analysis_state = 'error', updated_at = datetime('now')
      WHERE store = ? AND session_id = ?
    `).run(store, sessionId);
    return { success: false, error: lastError?.message || 'AI request failed.' };
  }

  const parsed = extractJsonObjectFromText(text);
  if (!parsed) {
    console.warn('[SessionIntelligence] analyze-session invalid JSON', {
      store,
      sessionId,
      model: usedModel,
      preview: String(text || '').slice(0, 400)
    });
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
  model = process.env.SESSION_INTELLIGENCE_AI_MODEL || (process.env.DEEPSEEK_API_KEY ? 'deepseek-reasoner' : 'gpt-4o-mini'),
  temperature = null
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
      const result = await analyzeSessionIntelligenceSession({ store, sessionId: session.session_id, model, temperature });
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
