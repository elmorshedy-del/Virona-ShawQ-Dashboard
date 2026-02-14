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

function inferDeviceInfo(payload) {
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
  if (!agent) return { deviceType: null, deviceOs: null };

  const lower = agent.toLowerCase();
  const isIos = /iphone|ipad|ipod|cpu (iphone )?os|ios/i.test(agent);
  const isAndroid = /android/i.test(agent);
  const isTablet = /ipad|tablet|silk/i.test(agent);
  const isMobile = /mobi|iphone|android/i.test(agent);

  let deviceType = 'desktop';
  if (isTablet) deviceType = 'tablet';
  else if (isMobile) deviceType = 'mobile';

  let deviceOs = null;
  if (isIos) deviceOs = 'iOS';
  else if (isAndroid) deviceOs = 'Android';
  else if (lower.includes('windows')) deviceOs = 'Windows';
  else if (lower.includes('mac os') || lower.includes('macintosh')) deviceOs = 'macOS';
  else if (lower.includes('cros')) deviceOs = 'ChromeOS';
  else if (lower.includes('linux')) deviceOs = 'Linux';

  return { deviceType, deviceOs };
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

function formatDeviceLabel(deviceTypeRaw, deviceOsRaw) {
  const deviceType = safeString(deviceTypeRaw).trim().toLowerCase();
  const deviceOs = safeString(deviceOsRaw).trim().toLowerCase();

  if (deviceType === 'mobile') {
    if (deviceOs === 'ios') return 'iOS';
    if (deviceOs === 'android') return 'Android';
    return 'Mobile';
  }

  if (deviceType === 'tablet') {
    if (deviceOs === 'ios') return 'iPadOS';
    if (deviceOs === 'android') return 'Android Tablet';
    return 'Tablet';
  }

  if (deviceType === 'desktop') return 'Desktop';

  const fallback = safeString(deviceTypeRaw).trim();
  return fallback || '—';
}

function normalizeGeoLabel(value, { uppercase = false, maxLength = 64 } = {}) {
  const raw = safeString(value).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const normalized = uppercase ? raw.toUpperCase() : raw;
  const lowered = normalized.toLowerCase();

  const JUNK_VALUES = new Set([
    '[redacted]',
    'redacted',
    'unknown',
    'n/a',
    'na',
    'null'
  ]);

  if (JUNK_VALUES.has(lowered)) {
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

const CAMPAIGN_ATTR_KEYS = [
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

const SESSION_CAMPAIGN_FALLBACK_LOOKBACK_DAYS = Math.min(
  Math.max(parseInt(process.env.SESSION_INTELLIGENCE_CAMPAIGN_FALLBACK_LOOKBACK_DAYS || '14', 10) || 14, 1),
  90
);

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
  const out = {};
  for (const key of CAMPAIGN_ATTR_KEYS) {
    const value = url.searchParams.get(key);
    if (value) out[key] = value.slice(0, 240);
  }
  return Object.keys(out).length ? out : null;
}

function hasCampaignAttribution(campaign) {
  if (!campaign || typeof campaign !== 'object') return false;
  return CAMPAIGN_ATTR_KEYS.some((key) => safeString(campaign[key]).trim() !== '');
}

function mergeCampaignData(primaryCampaign, fallbackCampaign) {
  if (!hasCampaignAttribution(primaryCampaign) && !hasCampaignAttribution(fallbackCampaign)) return null;
  const merged = {};
  for (const key of CAMPAIGN_ATTR_KEYS) {
    const primary = safeString(primaryCampaign?.[key]).trim();
    const fallback = safeString(fallbackCampaign?.[key]).trim();
    if (primary) merged[key] = primary.slice(0, 240);
    else if (fallback) merged[key] = fallback.slice(0, 240);
  }
  return Object.keys(merged).length ? merged : null;
}

function findRecentSessionCampaign(db, store, sessionId) {
  if (!sessionId) return null;
  const row = db.prepare(`
    SELECT last_campaign_json
    FROM si_sessions
    WHERE store = ? AND session_id = ?
    LIMIT 1
  `).get(store, sessionId);
  return safeJsonParse(row?.last_campaign_json);
}

function findRecentClientCampaign(db, store, clientId) {
  if (!clientId) return null;
  const row = db.prepare(`
    SELECT last_campaign_json
    FROM si_sessions
    WHERE store = ?
      AND client_id = ?
      AND COALESCE(last_campaign_json, '') <> ''
      AND COALESCE(updated_at, created_at) >= datetime('now', ?)
    ORDER BY COALESCE(last_event_at, updated_at, created_at) DESC
    LIMIT 1
  `).get(store, clientId, `-${SESSION_CAMPAIGN_FALLBACK_LOOKBACK_DAYS} days`);
  return safeJsonParse(row?.last_campaign_json);
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
    payload?.event?.context?.sessionId,
    payload?.event?.context?.session_id,
    payload?.event?.sessionId,
    payload?.event?.session_id,
    payload?.event?.id,
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
    payload?.event?.context?.clientId,
    payload?.event?.context?.client_id,
    payload?.event?.clientId,
    payload?.event?.client_id,
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

function shouldUseSchemaFallback(error) {
  const message = safeString(error?.message).toLowerCase();
  return (
    message.includes('no such column') ||
    message.includes('has no column named') ||
    message.includes('no such table')
  );
}

function getTableColumnSet(db, tableName) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return new Set(rows.map((row) => safeString(row?.name)));
  } catch (_error) {
    return new Set();
  }
}

function buildDynamicInsertSql(tableName, row, allowedColumns) {
  const entries = Object.entries(row).filter(([key, value]) => (
    allowedColumns.has(key) && value !== undefined
  ));
  if (!entries.length) return null;
  const columns = entries.map(([key]) => key);
  const placeholders = columns.map(() => '?').join(', ');
  return {
    sql: `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
    values: entries.map(([, value]) => value)
  };
}

function buildDynamicUpdateSql(tableName, row, allowedColumns, where) {
  const whereKeys = Object.keys(where);
  const entries = Object.entries(row).filter(([key, value]) => (
    allowedColumns.has(key) &&
    value !== undefined &&
    !whereKeys.includes(key)
  ));
  if (!entries.length) return null;
  const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
  const whereClause = whereKeys.map((key) => `${key} = ?`).join(' AND ');
  return {
    sql: `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`,
    values: [
      ...entries.map(([, value]) => value),
      ...whereKeys.map((key) => where[key])
    ]
  };
}

function tryRecordSessionIntelligenceEventFallback({
  db,
  normalizedStore,
  sessionId,
  clientId,
  shopperNumber,
  source,
  eventName,
  eventTs,
  location,
  checkoutToken,
  checkoutStep,
  deviceType,
  deviceOs,
  countryCode,
  product,
  attribution,
  dataToStore,
  cartJson,
  lastCampaignJson,
  atcAt,
  checkoutStartedAt,
  purchaseAt,
  status,
  now
}) {
  const eventColumns = getTableColumnSet(db, 'si_events');
  const sessionColumns = getTableColumnSet(db, 'si_sessions');
  if (!eventColumns.size || !sessionColumns.size) {
    return { ok: false, reason: 'missing_si_tables' };
  }

  const eventRow = {
    store: normalizedStore,
    session_id: sessionId,
    client_id: clientId,
    shopper_number: shopperNumber,
    source,
    event_name: eventName,
    event_ts: eventTs,
    page_url: location.pageUrl,
    page_path: location.pagePath,
    checkout_token: checkoutToken,
    checkout_step: checkoutStep,
    device_type: deviceType,
    device_os: deviceOs,
    country_code: countryCode,
    product_id: product?.productId || null,
    variant_id: product?.variantId || null,
    utm_source: attribution.utm_source,
    utm_medium: attribution.utm_medium,
    utm_campaign: attribution.utm_campaign,
    utm_content: attribution.utm_content,
    utm_term: attribution.utm_term,
    fbclid: attribution.fbclid,
    gclid: attribution.gclid,
    ttclid: attribution.ttclid,
    msclkid: attribution.msclkid,
    wbraid: attribution.wbraid,
    gbraid: attribution.gbraid,
    irclickid: attribution.irclickid,
    data_json: dataToStore ? JSON.stringify(dataToStore) : null,
    created_at: now
  };

  const baseSessionRow = {
    store: normalizedStore,
    session_id: sessionId,
    client_id: clientId,
    started_at: eventTs,
    last_event_at: eventTs,
    atc_at: atcAt,
    checkout_started_at: checkoutStartedAt,
    purchase_at: purchaseAt,
    last_checkout_token: checkoutToken,
    last_checkout_step: checkoutStep,
    last_cart_json: cartJson,
    shopper_number: shopperNumber,
    last_device_type: deviceType,
    last_device_os: deviceOs,
    last_country_code: countryCode,
    last_product_id: product?.productId || null,
    last_variant_id: product?.variantId || null,
    last_campaign_json: lastCampaignJson,
    status,
    updated_at: now
  };

  const fallbackTx = db.transaction(() => {
    const eventInsert = buildDynamicInsertSql('si_events', eventRow, eventColumns);
    if (eventInsert) db.prepare(eventInsert.sql).run(...eventInsert.values);

    const where = { store: normalizedStore, session_id: sessionId };
    const existing = db.prepare(`
      SELECT 1
      FROM si_sessions
      WHERE store = ? AND session_id = ?
      LIMIT 1
    `).get(normalizedStore, sessionId);

    if (existing) {
      const updatePayload = {
        client_id: clientId || undefined,
        last_event_at: eventTs,
        atc_at: atcAt || undefined,
        checkout_started_at: checkoutStartedAt || undefined,
        purchase_at: purchaseAt || undefined,
        last_checkout_token: checkoutToken || undefined,
        last_checkout_step: checkoutStep || undefined,
        last_cart_json: cartJson || undefined,
        shopper_number: shopperNumber || undefined,
        last_device_type: deviceType || undefined,
        last_device_os: deviceOs || undefined,
        last_country_code: countryCode || undefined,
        last_product_id: product?.productId || undefined,
        last_variant_id: product?.variantId || undefined,
        last_campaign_json: lastCampaignJson || undefined,
        status,
        updated_at: now
      };
      const updateSql = buildDynamicUpdateSql('si_sessions', updatePayload, sessionColumns, where);
      if (updateSql) db.prepare(updateSql.sql).run(...updateSql.values);
    } else {
      const insertSql = buildDynamicInsertSql('si_sessions', baseSessionRow, sessionColumns);
      if (insertSql) db.prepare(insertSql.sql).run(...insertSql.values);
    }
  });

  fallbackTx.immediate();
  return { ok: true };
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
  const { deviceType, deviceOs } = inferDeviceInfo(payload);
  const countryCode = extractCountryCode(payload);
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
  let shopperNumber = null;
  if (clientId) {
    try {
      shopperNumber = getOrCreateShopperNumber(normalizedStore, clientId, eventTs);
    } catch (error) {
      // Continue ingestion even if shopper table/index is unhealthy.
      console.warn('[SessionIntelligence] shopper_number resolution failed:', error?.message || error);
    }
  }

  let resolvedSessionId = identifiers.sessionId || null;
  if (!resolvedSessionId && clientId) {
    try {
      resolvedSessionId = getOrCreateSessionId(normalizedStore, clientId, eventTs);
    } catch (error) {
      // Continue ingestion with a deterministic fallback if session mapping table is unhealthy.
      console.warn('[SessionIntelligence] session_id resolution failed:', error?.message || error);
    }
  }

  const sessionId =
    resolvedSessionId ||
    (checkoutToken ? `checkout:${checkoutToken}` : null) ||
    `anon:${randomUUID()}`;

  const sessionCampaign = findRecentSessionCampaign(db, normalizedStore, sessionId);
  const clientCampaign = findRecentClientCampaign(db, normalizedStore, clientId);
  const resolvedCampaign = mergeCampaignData(
    location?.campaign,
    mergeCampaignData(sessionCampaign, clientCampaign)
  );
  const attribution = extractAttributionFields(resolvedCampaign);

  const cartSnapshot = extractCartSnapshot(eventDataRaw);
  const cartJson = cartSnapshot ? JSON.stringify(scrubSensitive(cartSnapshot)) : null;

  const siMeta = {};
  if (deviceType) siMeta.device_type = deviceType;
  if (deviceOs) siMeta.device_os = deviceOs;
  if (countryCode) siMeta.country_code = countryCode;
  if (resolvedCampaign) siMeta.campaign = resolvedCampaign;
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
      device_os,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = normalizeSqliteDateTime();
  const lastCampaignJson = resolvedCampaign ? JSON.stringify(resolvedCampaign) : null;

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
      last_device_os,
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
      last_device_os = COALESCE(excluded.last_device_os, si_sessions.last_device_os),
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
      deviceOs,
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
      deviceOs,
      countryCode,
      product?.productId || null,
      product?.variantId || null,
      lastCampaignJson,
      status,
      now
    );
  });

  try {
    tx.immediate();
  } catch (writeError) {
    if (!shouldUseSchemaFallback(writeError)) throw writeError;

    const fallbackResult = tryRecordSessionIntelligenceEventFallback({
      db,
      normalizedStore,
      sessionId,
      clientId,
      shopperNumber,
      source,
      eventName,
      eventTs,
      location,
      checkoutToken,
      checkoutStep,
      deviceType,
      deviceOs,
      countryCode,
      product,
      attribution,
      dataToStore,
      cartJson,
      lastCampaignJson,
      atcAt,
      checkoutStartedAt,
      purchaseAt,
      status,
      now
    });

    if (!fallbackResult?.ok) throw writeError;

    return {
      ok: true,
      store: normalizedStore,
      sessionId,
      sessionNumber: null,
      eventName,
      eventTs,
      checkoutToken,
      checkoutStep,
      degradedWrite: true
    };
  }

  return {
    ok: true,
    store: normalizedStore,
    sessionId,
    sessionNumber,
    eventName,
    eventTs,
    checkoutToken,
    checkoutStep,
    degradedWrite: false
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

function toTitleCaseWords(value) {
  const raw = safeString(value).trim().toLowerCase();
  if (!raw) return '';
  const words = raw.split(' ').filter(Boolean);
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

function normalizeTrafficSourceLabel(rawSource) {
  const raw = safeString(rawSource).trim();
  if (!raw) return 'Direct';

  const lower = raw.toLowerCase().trim();
  const host = lower
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  const key = host || lower;

  if (key === 'direct' || key === '(direct)' || key === '(none)' || key === 'none') return 'Direct';
  if (key === '(not set)' || key === 'not set' || key === '(not_set)' || key === 'not_set') return 'Not set';

  if (key === 'ig' || key.includes('instagram')) return 'Instagram';
  if (key === 'fb' || key.includes('facebook') || key.includes('meta')) return 'Facebook';
  if (key === 'tt' || key.includes('tiktok')) return 'TikTok';
  if (key.includes('snapchat') || key === 'snap') return 'Snapchat';
  if (key.includes('google') || key.includes('adwords') || key.includes('gads')) return 'Google';
  if (key.includes('bing') || key.includes('microsoft') || key.includes('msn')) return 'Microsoft Ads';

  const cleaned = lower
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return toTitleCaseWords(cleaned) || raw;
}

function inferSourceFromCampaign(campaign) {
  if (!campaign || typeof campaign !== 'object') return '';
  const explicit = safeString(campaign.utm_source).trim();
  if (explicit) return explicit;

  if (campaign.fbclid) return 'facebook';
  if (campaign.ttclid) return 'tiktok';
  if (campaign.gclid || campaign.wbraid || campaign.gbraid) return 'google';
  if (campaign.msclkid) return 'microsoft';
  if (campaign.irclickid) return 'affiliate';

  return '';
}

function inferSourceFromRowAttribution(row) {
  const directSource = safeString(row?.utm_source).trim();
  if (directSource) return directSource;
  if (safeString(row?.fbclid).trim()) return 'facebook';
  if (safeString(row?.ttclid).trim()) return 'tiktok';
  if (safeString(row?.gclid).trim() || safeString(row?.wbraid).trim() || safeString(row?.gbraid).trim()) return 'google';
  if (safeString(row?.msclkid).trim()) return 'microsoft';
  if (safeString(row?.irclickid).trim()) return 'affiliate';
  return '';
}

function buildRealtimeCampaignFallbackMaps(db, store) {
  const lookbackExpr = `-${SESSION_CAMPAIGN_FALLBACK_LOOKBACK_DAYS} days`;
  const rows = db.prepare(`
    SELECT
      client_id,
      shopper_number,
      last_campaign_json,
      COALESCE(last_event_at, updated_at, created_at) AS rank_ts
    FROM si_sessions
    WHERE store = ?
      AND COALESCE(last_campaign_json, '') <> ''
      AND COALESCE(last_event_at, updated_at, created_at) >= datetime('now', ?)
    ORDER BY rank_ts DESC
    LIMIT 5000
  `).all(store, lookbackExpr);

  const byClient = new Map();
  const byShopper = new Map();

  for (const row of rows) {
    const campaign = safeJsonParse(row?.last_campaign_json);
    if (!hasCampaignAttribution(campaign)) continue;

    const clientId = safeString(row?.client_id).trim();
    if (clientId && !byClient.has(clientId)) {
      byClient.set(clientId, campaign);
    }

    const shopperNumber = Number(row?.shopper_number);
    if (Number.isFinite(shopperNumber) && shopperNumber > 0 && !byShopper.has(shopperNumber)) {
      byShopper.set(shopperNumber, campaign);
    }
  }

  return { byClient, byShopper };
}

function resolveRealtimeSource(row, fallbackCampaign = null) {
  const inferredFromRow = inferSourceFromRowAttribution(row);
  if (inferredFromRow) return normalizeTrafficSourceLabel(inferredFromRow);

  const fromEvent = safeString(row?.utm_source).trim();
  if (fromEvent) return normalizeTrafficSourceLabel(fromEvent);

  const sessionCampaign = safeJsonParse(row?.session_campaign_json);
  const inferred = inferSourceFromCampaign(sessionCampaign);
  if (inferred) return normalizeTrafficSourceLabel(inferred);

  const inferredFromFallback = inferSourceFromCampaign(fallbackCampaign);
  if (inferredFromFallback) return normalizeTrafficSourceLabel(inferredFromFallback);

  return 'Direct';
}

function resolveRealtimeCampaign(row, sourceLabel, fallbackCampaign = null) {
  const fromEvent = safeString(row?.utm_campaign).trim();
  if (fromEvent) return fromEvent;

  const sessionCampaign = safeJsonParse(row?.session_campaign_json);
  const fromSession = safeString(sessionCampaign?.utm_campaign).trim();
  if (fromSession) return fromSession;

  const fromFallback = safeString(fallbackCampaign?.utm_campaign).trim();
  if (fromFallback) return fromFallback;

  return sourceLabel === 'Direct' ? 'Direct' : '(not set)';
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
      e.device_os,
      e.country_code,
      e.data_json,
      e.utm_source,
      e.utm_campaign,
      e.fbclid,
      e.gclid,
      e.ttclid,
      e.msclkid,
      e.wbraid,
      e.gbraid,
      e.irclickid,
      s.last_campaign_json AS session_campaign_json
    FROM si_events e
    JOIN recent r ON r.last_id = e.id
    LEFT JOIN si_sessions s
      ON s.store = e.store
      AND s.session_id = e.session_id
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
  const campaignFallbackMaps = buildRealtimeCampaignFallbackMaps(db, normalizedStore);
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

    const fallbackCampaign = campaignFallbackMaps.byClient.get(safeString(row?.client_id).trim())
      || (Number.isFinite(shopperNumber) && shopperNumber > 0
        ? campaignFallbackMaps.byShopper.get(shopperNumber)
        : null)
      || null;

    const source = resolveRealtimeSource(row, fallbackCampaign);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);

    const campaign = resolveRealtimeCampaign(row, source, fallbackCampaign);
    campaignCounts.set(campaign, (campaignCounts.get(campaign) || 0) + 1);

    const device = formatDeviceLabel(row?.device_type, row?.device_os);
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
      e.device_os,
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
    device_type: formatDeviceLabel(row.device_type, row.device_os),
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
      last_device_os,
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
    device_type: formatDeviceLabel(row.last_device_type, row.last_device_os),
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
        MAX(COALESCE(device_os, '')) AS device_os,
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
      NULLIF(d.device_os, '') AS device_os,
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
    device_type: formatDeviceLabel(row.device_type, row.device_os),
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
  const selectedSessions = scope === 'high_intent_no_purchase'
    ? sessions.filter((s) => ((s.atc_events || 0) > 0 || (s.checkout_started_events || 0) > 0) && (s.purchase_events || 0) === 0)
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
        totals: { sessions: 0 },
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
      totals: { sessions: selectedSessions.length },
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
  const selectedSessions = scope === 'high_intent_no_purchase'
    ? sessions.filter((s) => ((s.atc_events || 0) > 0 || (s.checkout_started_events || 0) > 0) && (s.purchase_events || 0) === 0)
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
          source_sessions: sessions.length
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
        source_sessions: sessions.length
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
        e.device_os,
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
      device_type: formatDeviceLabel(row.device_type, row.device_os),
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
      e.device_os,
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
    device_type: formatDeviceLabel(row.device_type, row.device_os),
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
