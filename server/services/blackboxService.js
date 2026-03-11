import { createHash } from 'crypto';
import { getDb } from '../db/database.js';

const DEFAULT_STORE = 'shawq';
const DEFAULT_LOOKBACK_DAYS = 3;
const MAX_LOOKBACK_DAYS = 31;
const DEFAULT_EVENT_LIMIT = 200;
const MAX_EVENT_LIMIT = 1000;
const DEFAULT_EXPORT_LIMIT = 5000;
const MAX_EXPORT_LIMIT = 10000;
const DEFAULT_ANALYSIS_LIMIT = 5000;
const MAX_ANALYSIS_LIMIT = 12000;
const DEFAULT_DUPLICATE_WINDOW_SECONDS = 45;
const MAX_DUPLICATE_WINDOW_SECONDS = 300;
const DEFAULT_GHOST_SESSION_LIMIT = 50;
const DEFAULT_GHOST_ORDER_LIMIT = 50;
const MAX_GHOST_LIMIT = 300;
const DEFAULT_ATTRIBUTION_GRACE_HOURS = 2;
const MAX_ATTRIBUTION_GRACE_HOURS = 24;
const DEFAULT_ATTRIBUTION_UPSTREAM_WINDOW_HOURS = 6;
const DEFAULT_ATTRIBUTION_RECOVERY_WINDOW_HOURS = 12;
const DEFAULT_BUTTON_CONTEXT_WINDOW_HOURS = 12;
const DEFAULT_APPROX_LOOKBACK_HOURS = 6;
const MAX_APPROX_LOOKBACK_HOURS = 24;
const MAX_RAW_JSON_CHARS = 20000;
const MAX_STRING_LENGTH = 800;
const MAX_STORE_LENGTH = 64;
const IP_HASH_PREFIX_LENGTH = 16;
const DUPLICATE_BUTTON_MAX_LENGTH = 160;
const TOP_DUPLICATE_BUTTON_LIMIT = 10;
const MIN_ORDER_ID_DIGITS = 6;
const DEFAULT_PIXEL_BACKFILL_DAYS = 14;
const DEFAULT_PIXEL_BACKFILL_MAX_ROWS = 20000;
const MAX_PIXEL_BACKFILL_MAX_ROWS = 200000;

const PURCHASE_SOURCE_WEBHOOK_KEYWORDS = [
  'webhook',
  'captain-hook',
  'captain hook',
  'orders/paid',
  'shopify_webhook'
];

const PURCHASE_SOURCE_PIXEL_KEYWORDS = [
  'custom_pixel',
  'shopify_custom_pixel',
  'shopify pixel',
  'web pixel',
  'web-pixel',
  'web-pixels',
  'browser'
];

const PURCHASE_SOURCE_GTM_KEYWORDS = [
  'gtm',
  'sgtm',
  'server gtm',
  'stape_data',
  'theme_snippet',
  'theme snippet',
  'data_layer',
  'datalayer',
  'data client'
];

const EVENT_NAME_ALIASES = new Map([
  ['checkout_started', 'begin_checkout'],
  ['checkout_start', 'begin_checkout'],
  ['checkout_initiated', 'begin_checkout'],
  ['begin_checkout_stape', 'begin_checkout'],
  ['begin_checkout_emitted', 'begin_checkout'],
  ['add_to_cart_stape', 'add_to_cart'],
  ['view_item_stape', 'view_item'],
  ['purchase_stape', 'purchase'],
  ['checkout_completed', 'purchase'],
  ['order_paid', 'purchase']
]);

const BEGIN_CHECKOUT_EVENT_NAMES = new Set(['begin_checkout']);
const PURCHASE_EVENT_NAMES = new Set(['purchase']);

const COUNTRY_HEADER_KEYS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'x-country',
  'x-geo-country',
  'x-gclb-country'
];

const REGION_HEADER_KEYS = [
  'x-vercel-ip-country-region',
  'x-region',
  'x-geo-region',
  'x-gclb-region'
];

const IP_HEADER_KEYS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'x-client-ip',
  'fastly-client-ip'
];

const EVENT_NAME_PATHS = [
  'event.name',
  'event_name',
  'event',
  'name',
  'type'
];

const EVENT_ID_PATHS = [
  'event_id',
  'checkout_attempt_id',
  'case_id',
  'event.event_id',
  'event.id',
  'id'
];

const ORDER_ID_PATHS = [
  'order_id',
  'event.order_id',
  'event.data.order_id',
  'checkout.order.id',
  'data.checkout.order.id',
  'transaction_id'
];

const SESSION_ID_PATHS = [
  'session.id',
  'session.session_id',
  'session_id',
  'context.session_id',
  'context.sessionId'
];

const CLIENT_ID_PATHS = [
  'client_id',
  'external_id',
  'journey_id',
  'session.client_id',
  'context.client_id',
  'context.clientId',
  'user_data.external_id',
  'payload.external_id',
  'payload.identity.external_id'
];

const CHECKOUT_TOKEN_PATHS = [
  'checkout_token',
  'event.checkout_token',
  'event.data.checkout_token',
  'checkout.token',
  'data.checkout.token'
];

const CART_TOKEN_PATHS = [
  'cart_token',
  'event.cart_token',
  'event.data.cart_token',
  'cart.token',
  'data.cart.token'
];

const CHECKOUT_BUTTON_PATHS = [
  'checkout_button',
  'event.checkout_button',
  'event.data.checkout_button',
  'event.data.button',
  'checkout.button',
  'meta.checkout_button'
];

const CHECKOUT_SOURCE_PATHS = [
  'checkout_source',
  'event.checkout_source',
  'event.data.checkout_source',
  'meta.checkout_source'
];

const PAGE_URL_PATHS = [
  'page_url',
  'page_location',
  'context.page_url',
  'context.pageUrl',
  'context.document.location.href',
  'context.document.locationHref',
  'document.location.href',
  'document.locationHref'
];

const PAGE_PATH_PATHS = [
  'page_path',
  'payload.page_path',
  'context.page_path',
  'context.pagePath',
  'meta.page_path'
];

const REFERRER_PATHS = [
  'referrer',
  'context.referrer',
  'context.document.referrer',
  'document.referrer'
];

const LANDING_PAGE_PATHS = [
  'landing_page',
  'payload.landing_page',
  'attribution.landing_page',
  'attribution.landing_page_last',
  'meta.landing_page'
];

const EVENT_SOURCE_URL_PATHS = [
  'event_source_url',
  'payload.event_source_url',
  'context.event_source_url',
  'meta.event_source_url'
];

const FBC_PATHS = [
  'fbc',
  'payload.fbc',
  'attribution.fbc',
  'meta.fbc'
];

const FBP_PATHS = [
  'fbp',
  'payload.fbp',
  'attribution.fbp',
  'meta.fbp'
];

const FBCLID_PATHS = [
  'fbclid',
  'payload.fbclid',
  'attribution.fbclid',
  'meta.fbclid'
];

const COUNTRY_PATHS = [
  'country_code',
  'country',
  'geo.country',
  'context.country_code',
  'context.country'
];

const REGION_PATHS = [
  'region_code',
  'region',
  'geo.region',
  'context.region_code',
  'context.region'
];

const USER_AGENT_PATHS = [
  'user_agent',
  'context.user_agent',
  'context.navigator.userAgent',
  'navigator.userAgent'
];

const SOURCE_PATHS = [
  'source_system',
  'source',
  'context.source',
  'meta.source'
];

const CHANNEL_PATHS = [
  'payload.channel',
  'channel',
  'meta.channel'
];

const UTM_SOURCE_PATHS = [
  'utm_source',
  'payload.utm_source',
  'attribution.utm_source',
  'context.utm_source'
];

const UTM_MEDIUM_PATHS = [
  'utm_medium',
  'payload.utm_medium',
  'attribution.utm_medium',
  'context.utm_medium'
];

const UTM_CAMPAIGN_PATHS = [
  'utm_campaign',
  'payload.utm_campaign',
  'attribution.utm_campaign',
  'context.utm_campaign'
];

const TIMESTAMP_PATHS = [
  'observed_at',
  'timestamp',
  'event_ts',
  'event.timestamp',
  'event.ts',
  'time',
  'event_time'
];

function safeString(value, maxLength = MAX_STRING_LENGTH) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getByPath(obj, path) {
  if (!obj || typeof obj !== 'object' || !path) return undefined;
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function pickFirstString(payload, paths, maxLength = MAX_STRING_LENGTH) {
  for (const path of paths) {
    const value = getByPath(payload, path);
    const normalized = safeString(value, maxLength);
    if (normalized) return normalized;
  }
  return '';
}

function pickFirstValue(payload, paths) {
  for (const path of paths) {
    const value = getByPath(payload, path);
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function normalizeStore(store) {
  const raw = safeString(store || DEFAULT_STORE, MAX_STORE_LENGTH).toLowerCase();
  const sanitized = raw.replace(/[^a-z0-9_-]/g, '');
  return sanitized || DEFAULT_STORE;
}

function normalizeEventName(value) {
  const raw = safeString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!raw) return 'unknown';
  return EVENT_NAME_ALIASES.get(raw) || raw;
}

function isBeginCheckoutEvent(eventName) {
  return BEGIN_CHECKOUT_EVENT_NAMES.has(normalizeEventName(eventName));
}

function isPurchaseEvent(eventName) {
  return PURCHASE_EVENT_NAMES.has(normalizeEventName(eventName));
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return new Date(value);
    if (value > 1e9) return new Date(value * 1000);
  }

  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    const numeric = Number.parseFloat(value.trim());
    if (Number.isFinite(numeric)) {
      if (numeric > 1e12) return new Date(numeric);
      if (numeric > 1e9) return new Date(numeric * 1000);
    }
  }

  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) return parsed;
  return null;
}

function toSqliteDateTime(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function parseSqliteDateTimeToMs(value) {
  if (!value || typeof value !== 'string') return NaN;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return Date.parse(normalized);
}

function toIsoDateString(date) {
  return date.toISOString().slice(0, 10);
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return toIsoDateString(date);
}

function normalizeDateInput(value) {
  const raw = safeString(value, 20);
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return '';
  return raw;
}

function resolveDateRange({ startDate, endDate, lookbackDays } = {}) {
  const fallbackDays = clampInt(lookbackDays, DEFAULT_LOOKBACK_DAYS, 1, MAX_LOOKBACK_DAYS);
  const resolvedEnd = normalizeDateInput(endDate) || toIsoDateString(new Date());
  const resolvedStart = normalizeDateInput(startDate) || getDateDaysAgo(fallbackDays - 1);
  return {
    startDate: resolvedStart <= resolvedEnd ? resolvedStart : resolvedEnd,
    endDate: resolvedEnd >= resolvedStart ? resolvedEnd : resolvedStart
  };
}

function normalizePath(path) {
  const raw = safeString(path, 1200);
  if (!raw) return '';
  const noHash = raw.split('#')[0];
  const noQuery = noHash.split('?')[0];
  if (!noQuery) return '';
  if (noQuery.startsWith('/')) return noQuery.slice(0, 500);
  return `/${noQuery}`.slice(0, 500);
}

function resolvePagePath(pageUrl, pagePath) {
  const explicit = normalizePath(pagePath);
  if (explicit) return explicit;

  const rawUrl = safeString(pageUrl, 1600);
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    return normalizePath(parsed.pathname);
  } catch (_error) {
    return '';
  }
}

function normalizeCountryCode(value) {
  const raw = safeString(value, 8).toUpperCase();
  if (!raw) return '';
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return raw.slice(0, 8);
}

function normalizeRegionCode(value) {
  const raw = safeString(value, 32).toUpperCase();
  return raw || '';
}

function getHeaderValue(req, keys) {
  if (!req || !req.headers) return '';
  for (const key of keys) {
    const value = req.headers[key];
    if (typeof value === 'string') {
      const normalized = safeString(value, 160);
      if (normalized) return normalized;
    }
  }
  return '';
}

function resolveCountryCode(payload, req) {
  const payloadCountry = normalizeCountryCode(pickFirstString(payload, COUNTRY_PATHS, 16));
  if (payloadCountry) return payloadCountry;
  const headerCountry = normalizeCountryCode(getHeaderValue(req, COUNTRY_HEADER_KEYS));
  return headerCountry || '';
}

function resolveRegionCode(payload, req) {
  const payloadRegion = normalizeRegionCode(pickFirstString(payload, REGION_PATHS, 32));
  if (payloadRegion) return payloadRegion;
  const headerRegion = normalizeRegionCode(getHeaderValue(req, REGION_HEADER_KEYS));
  return headerRegion || '';
}

function resolveClientIp(req) {
  if (!req) return '';
  for (const headerKey of IP_HEADER_KEYS) {
    const raw = req.headers?.[headerKey];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const first = raw.split(',')[0]?.trim();
    if (first) return first;
  }
  const reqIp = safeString(req.ip, 120);
  return reqIp || '';
}

function resolveIpHash(payload, req) {
  const payloadHash = safeString(
    pickFirstString(payload, ['ip_hash', 'context.ip_hash'], IP_HASH_PREFIX_LENGTH),
    IP_HASH_PREFIX_LENGTH
  );
  if (payloadHash) return payloadHash;

  const ip = resolveClientIp(req);
  if (!ip) return '';

  const salt = safeString(process.env.BLACKBOX_IP_HASH_SALT, 120) || 'virona-blackbox';
  return createHash('sha256')
    .update(`${salt}|${ip}`)
    .digest('hex')
    .slice(0, IP_HASH_PREFIX_LENGTH);
}

function safePayloadJson(payload) {
  try {
    const raw = JSON.stringify(payload);
    if (!raw) return '';
    if (raw.length <= MAX_RAW_JSON_CHARS) return raw;
    return `${raw.slice(0, MAX_RAW_JSON_CHARS)}...[truncated]`;
  } catch (_error) {
    return '';
  }
}

function parsePayloadJsonObject(rawJson) {
  const raw = safeString(rawJson, MAX_RAW_JSON_CHARS + 64);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function firstNonEmptyString(values, maxLength = MAX_STRING_LENGTH) {
  if (!Array.isArray(values)) return '';
  for (const value of values) {
    const normalized = safeString(value, maxLength);
    if (normalized) return normalized;
  }
  return '';
}

function resolveEventTimestamp(payload) {
  const value = pickFirstValue(payload, TIMESTAMP_PATHS);
  const parsed = normalizeTimestamp(value) || new Date();
  return toSqliteDateTime(parsed);
}

function resolveEventRecord({ store, payload, req }) {
  const eventName = normalizeEventName(pickFirstString(payload, EVENT_NAME_PATHS, 160));
  const pageUrl = pickFirstString(payload, PAGE_URL_PATHS, 1600);
  const pagePath = resolvePagePath(pageUrl, pickFirstString(payload, PAGE_PATH_PATHS, 600));

  const userAgentFromPayload = pickFirstString(payload, USER_AGENT_PATHS, 600);
  const userAgentFromHeader = safeString(req?.headers?.['user-agent'], 600);

  return {
    store: normalizeStore(store || payload?.store),
    event_name: eventName,
    event_ts: resolveEventTimestamp(payload),
    source: pickFirstString(payload, SOURCE_PATHS, 120),
    channel: pickFirstString(payload, CHANNEL_PATHS, 120),
    session_id: pickFirstString(payload, SESSION_ID_PATHS, 120),
    client_id: pickFirstString(payload, CLIENT_ID_PATHS, 120),
    event_id: pickFirstString(payload, EVENT_ID_PATHS, 160),
    order_id: pickFirstString(payload, ORDER_ID_PATHS, 120),
    cart_token: pickFirstString(payload, CART_TOKEN_PATHS, 160),
    checkout_token: pickFirstString(payload, CHECKOUT_TOKEN_PATHS, 160),
    checkout_button: pickFirstString(payload, CHECKOUT_BUTTON_PATHS, 160),
    checkout_source: pickFirstString(payload, CHECKOUT_SOURCE_PATHS, 160),
    page_url: pageUrl,
    page_path: pagePath,
    referrer: pickFirstString(payload, REFERRER_PATHS, 1200),
    landing_page: pickFirstString(payload, LANDING_PAGE_PATHS, 1200),
    event_source_url: pickFirstString(payload, EVENT_SOURCE_URL_PATHS, 1200),
    country_code: resolveCountryCode(payload, req),
    region_code: resolveRegionCode(payload, req),
    ip_hash: resolveIpHash(payload, req),
    user_agent: userAgentFromPayload || userAgentFromHeader,
    utm_source: pickFirstString(payload, UTM_SOURCE_PATHS, 240),
    utm_medium: pickFirstString(payload, UTM_MEDIUM_PATHS, 240),
    utm_campaign: pickFirstString(payload, UTM_CAMPAIGN_PATHS, 240),
    payload_json: safePayloadJson(payload)
  };
}

function buildEventsWhereClause(store, filters = {}) {
  const range = resolveDateRange(filters);
  const where = ['store = ?', 'date(event_ts) BETWEEN ? AND ?'];
  const params = [normalizeStore(store), range.startDate, range.endDate];

  const rawEventName = safeString(filters.eventName, 120).toLowerCase();
  if (rawEventName && rawEventName !== 'all') {
    const eventName = normalizeEventName(rawEventName);
    where.push('event_name = ?');
    params.push(eventName);
  }

  const source = safeString(filters.source, 120).toLowerCase();
  if (source && source !== 'all') {
    where.push('LOWER(source) = ?');
    params.push(source);
  }

  const sessionHint = safeString(filters.sessionHint, 160);
  if (sessionHint) {
    where.push('(session_id = ? OR client_id = ? OR ip_hash = ?)');
    params.push(sessionHint, sessionHint, sessionHint);
  }

  return { range, whereSql: where.join(' AND '), params };
}

function identityKeyFromEvent(event) {
  return (
    safeString(event.session_id, 120) ||
    safeString(event.client_id, 120) ||
    safeString(event.ip_hash, 120) ||
    ''
  );
}

function flowKeyFromEvent(event) {
  return (
    safeString(event.cart_token, 160) ||
    safeString(event.checkout_token, 160) ||
    safeString(event.event_id, 160) ||
    safeString(event.page_path, 300) ||
    'unknown-flow'
  );
}

function safeLower(value, maxLength = MAX_STRING_LENGTH) {
  return safeString(value, maxLength).toLowerCase();
}

function containsAnyKeyword(rawValue, keywords) {
  if (!rawValue) return false;
  return keywords.some((keyword) => rawValue.includes(keyword));
}

function resolveOrderIdFromPurchaseEvent(event) {
  const directOrderId = safeString(event.order_id, 120);
  if (directOrderId) return directOrderId;

  const eventId = safeString(event.event_id, 160);
  if (!eventId) return '';

  const pattern = new RegExp(`(\\d{${MIN_ORDER_ID_DIGITS},})_purchase$`, 'i');
  const match = eventId.match(pattern);
  return match?.[1] || '';
}

function classifyPurchaseSource(event) {
  const fingerprint = [
    safeLower(event.source, 160),
    safeLower(event.channel, 160),
    safeLower(event.checkout_source, 160),
    safeLower(event.checkout_button, 160),
    safeLower(event.user_agent, 300)
  ]
    .filter(Boolean)
    .join(' ');

  if (!fingerprint) return 'unknown';
  if (containsAnyKeyword(fingerprint, PURCHASE_SOURCE_WEBHOOK_KEYWORDS)) return 'webhook';
  if (containsAnyKeyword(fingerprint, PURCHASE_SOURCE_PIXEL_KEYWORDS)) return 'pixel';
  if (containsAnyKeyword(fingerprint, PURCHASE_SOURCE_GTM_KEYWORDS)) return 'gtm';
  return 'unknown';
}

function summarizeCoverage(coverage) {
  if (!coverage) return 'none';
  const paths = [];
  if (coverage.hasPixelPurchase) paths.push('pixel');
  if (coverage.hasGtmPurchase) paths.push('gtm');
  if (coverage.hasWebhookPurchase) paths.push('webhook');
  if (coverage.hasUnknownPurchase) paths.push('unknown');
  return paths.length ? paths.join(', ') : 'none';
}

function classifyCoverageStatus(coverage) {
  if (!coverage) return 'no_purchase_signal';
  const hasPixel = Boolean(coverage.hasPixelPurchase);
  const hasGtm = Boolean(coverage.hasGtmPurchase);
  const hasWebhook = Boolean(coverage.hasWebhookPurchase);
  const hasUnknown = Boolean(coverage.hasUnknownPurchase);

  if (hasPixel && hasGtm) return 'full';
  if (!hasPixel && !hasGtm && hasWebhook) return 'webhook_only';
  if (!hasPixel && !hasGtm && hasUnknown) return 'unknown_only';
  if (!hasPixel && !hasGtm) return 'no_purchase_signal';
  return 'partial';
}

function makeOrderCandidate(order, approxEvent, coverage, status) {
  const attributionDiagnostics = approxEvent ? resolveAttributionDiagnostics(approxEvent) : null;
  return {
    order_id: safeString(order.order_id, 120),
    date: order.date || null,
    order_created_at: order.order_created_at || null,
    country_code: order.country_code || null,
    city: order.city || null,
    state: order.state || null,
    order_total: order.order_total || 0,
    currency: order.currency || null,
    customer_email: order.customer_email || null,
    approx_last_begin_checkout_at: approxEvent?.event_ts || null,
    approx_last_checkout_button: approxEvent?.checkout_button || approxEvent?.checkout_source || null,
    approx_last_identity_key: approxEvent ? (identityKeyFromEvent(approxEvent) || null) : null,
    approx_attribution_status: attributionDiagnostics?.attribution_status || null,
    approx_attribution_signal_count: attributionDiagnostics?.attribution_signal_count || 0,
    approx_attribution_missing_core_fields: attributionDiagnostics?.attribution_missing_core_fields || [],
    approx_attribution_missing_core_summary: attributionDiagnostics?.attribution_missing_core_summary || '',
    delivery_status: status,
    coverage_status: classifyCoverageStatus(coverage),
    has_pixel_purchase: Boolean(coverage?.hasPixelPurchase),
    has_gtm_purchase: Boolean(coverage?.hasGtmPurchase),
    has_webhook_purchase: Boolean(coverage?.hasWebhookPurchase),
    has_unknown_purchase: Boolean(coverage?.hasUnknownPurchase),
    purchase_path_summary: summarizeCoverage(coverage),
    purchase_events: Number(coverage?.eventCount || 0),
    last_purchase_event_ts: coverage?.lastPurchaseAt || null
  };
}

function buildCheckoutAttributionOverview(beginEvents, maxItems = DEFAULT_GHOST_SESSION_LIMIT) {
  const missingCoreCounts = new Map();
  const weakRows = [];

  let attributedCount = 0;
  let partialCount = 0;
  let missingCount = 0;

  for (const event of beginEvents) {
    const normalized = mapRowForApi(event);
    switch (normalized.attribution_status) {
      case 'attributed':
        attributedCount += 1;
        break;
      case 'partial':
        partialCount += 1;
        break;
      case 'missing':
        missingCount += 1;
        break;
    }

    normalized.attribution_missing_core_fields.forEach((field) => {
      missingCoreCounts.set(field, (missingCoreCounts.get(field) || 0) + 1);
    });

    if (normalized.attribution_status !== 'attributed') {
      weakRows.push(normalized);
    }
  }

  weakRows.sort((a, b) => parseSqliteDateTimeToMs(b.event_ts) - parseSqliteDateTimeToMs(a.event_ts));

  const topMissingCore = [...missingCoreCounts.entries()]
    .map(([field, count]) => ({ field, count }))
    .sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));

  return {
    total: beginEvents.length,
    attributed_count: attributedCount,
    partial_count: partialCount,
    missing_count: missingCount,
    top_missing_core: topMissingCore,
    weak_rows: weakRows.slice(0, maxItems)
  };
}

function attributionScore(status) {
  switch (status) {
    case 'attributed':
      return 2;
    case 'partial':
      return 1;
    default:
      return 0;
  }
}

function purchaseEventPriority(event) {
  const sourceClass = classifyPurchaseSource(event);
  switch (sourceClass) {
    case 'pixel':
      return 3;
    case 'gtm':
      return 2;
    case 'webhook':
      return 1;
    default:
      return 0;
  }
}

function pickBestPurchaseEvent(events) {
  if (!Array.isArray(events) || !events.length) return null;

  let best = null;
  let bestScore = -1;
  let bestPriority = -1;
  let bestTs = -1;

  for (const event of events) {
    const score = attributionScore(event?.attribution_status);
    const priority = purchaseEventPriority(event);
    const ts = eventTimeMs(event);

    if (
      score > bestScore
      || (score === bestScore && priority > bestPriority)
      || (score === bestScore && priority === bestPriority && ts > bestTs)
    ) {
      best = event;
      bestScore = score;
      bestPriority = priority;
      bestTs = ts;
    }
  }

  return best;
}

function buildMisattributedPurchaseDiagnostics(store, range, options = {}) {
  const db = getDb();
  const graceHours = clampInt(
    options.attributionGraceHours,
    DEFAULT_ATTRIBUTION_GRACE_HOURS,
    1,
    MAX_ATTRIBUTION_GRACE_HOURS
  );
  const maxItems = clampInt(options.maxItems, DEFAULT_GHOST_SESSION_LIMIT, 1, MAX_GHOST_LIMIT);
  const lookbackHours = clampInt(options.approxLookbackHours, DEFAULT_APPROX_LOOKBACK_HOURS, 1, MAX_APPROX_LOOKBACK_HOURS);
  const upstreamWindowMs = DEFAULT_ATTRIBUTION_UPSTREAM_WINDOW_HOURS * 60 * 60 * 1000;
  const graceCutoffMs = Date.now() - (graceHours * 60 * 60 * 1000);

  const orderRows = db.prepare(`
    SELECT
      order_id,
      date,
      order_created_at,
      country_code,
      city,
      state,
      order_total,
      currency,
      customer_email
    FROM shopify_orders
    WHERE store = ?
      AND date BETWEEN ? AND ?
      AND COALESCE(is_excluded, 0) = 0
    ORDER BY COALESCE(order_created_at, date) DESC
  `).all(store, range.startDate, range.endDate);

  const purchaseRows = db.prepare(`
    SELECT
      id,
      event_name,
      event_ts,
      source,
      channel,
      session_id,
      client_id,
      event_id,
      order_id,
      cart_token,
      checkout_token,
      checkout_button,
      checkout_source,
      page_url,
      page_path,
      landing_page,
      event_source_url,
      utm_source,
      utm_medium,
      utm_campaign,
      country_code,
      region_code,
      ip_hash,
      user_agent,
      payload_json
    FROM blackbox_events
    WHERE store = ?
      AND event_ts >= ? AND event_ts < date(?, '+1 day')
      AND event_name = 'purchase'
    ORDER BY event_ts DESC, id DESC
  `).all(store, range.startDate, range.endDate).map(mapRowForApi);

  const beginRows = attachResolvedCheckoutContext(db.prepare(`
    SELECT
      id,
      event_name,
      event_ts,
      source,
      channel,
      session_id,
      client_id,
      event_id,
      order_id,
      cart_token,
      checkout_token,
      checkout_button,
      checkout_source,
      page_url,
      page_path,
      landing_page,
      event_source_url,
      utm_source,
      utm_medium,
      utm_campaign,
      country_code,
      region_code,
      ip_hash,
      payload_json
    FROM blackbox_events
    WHERE store = ?
      AND date(event_ts) BETWEEN ? AND ?
      AND event_name = 'begin_checkout'
    ORDER BY event_ts DESC, id DESC
  `).all(store, range.startDate, range.endDate));

  const addToCartRows = db.prepare(`
    SELECT
      id,
      event_name,
      event_ts,
      source,
      channel,
      session_id,
      client_id,
      event_id,
      order_id,
      cart_token,
      checkout_token,
      checkout_button,
      checkout_source,
      page_url,
      page_path,
      landing_page,
      event_source_url,
      utm_source,
      utm_medium,
      utm_campaign,
      country_code,
      region_code,
      ip_hash,
      payload_json
    FROM blackbox_events
    WHERE store = ?
      AND date(event_ts) BETWEEN ? AND ?
      AND event_name = 'add_to_cart'
    ORDER BY event_ts DESC, id DESC
  `).all(store, range.startDate, range.endDate).map(mapRowForApi);

  const purchasesByOrder = new Map();
  for (const event of purchaseRows) {
    const orderId = resolveOrderIdFromPurchaseEvent(event);
    if (!orderId) continue;
    const existing = purchasesByOrder.get(orderId) || [];
    existing.push(event);
    purchasesByOrder.set(orderId, existing);
  }

  const rows = [];
  let eligibleOrders = 0;
  let attributedPurchases = 0;
  let unresolvedCount = 0;
  let droppedAfterCheckoutCount = 0;
  let droppedAtCheckoutCount = 0;
  let weakUpstreamCount = 0;
  let noCheckoutContextCount = 0;

  for (const order of orderRows) {
    const orderTs = parseSqliteDateTimeToMs(order.order_created_at || order.date);
    if (!Number.isFinite(orderTs) || orderTs > graceCutoffMs) continue;

    const orderId = safeString(order.order_id, 120);
    if (!orderId) continue;
    eligibleOrders += 1;

    const purchaseEvents = purchasesByOrder.get(orderId) || [];
    const bestPurchase = pickBestPurchaseEvent(purchaseEvents);
    if (!bestPurchase) continue;

    const purchaseScore = attributionScore(bestPurchase.attribution_status);
    if (purchaseScore >= 2) {
      attributedPurchases += 1;
      continue;
    }

    unresolvedCount += 1;

    const relatedCheckout = findBestRelatedPreviousEvent(bestPurchase, beginRows, lookbackHours * 60 * 60 * 1000);
    const relatedAtc = relatedCheckout
      ? findBestRelatedPreviousEvent(relatedCheckout, addToCartRows, upstreamWindowMs)
      : null;

    const checkoutScore = relatedCheckout ? attributionScore(relatedCheckout.attribution_status) : -1;
    const upstreamScore = relatedAtc ? attributionScore(relatedAtc.attribution_status) : -1;

    let diagnosis = 'no_checkout_context';
    if (relatedCheckout) {
      if (checkoutScore > purchaseScore) diagnosis = 'dropped_after_checkout';
      else if (upstreamScore > checkoutScore) diagnosis = 'dropped_at_checkout';
      else diagnosis = 'weak_upstream';
    }

    if (diagnosis === 'dropped_after_checkout') droppedAfterCheckoutCount += 1;
    else if (diagnosis === 'dropped_at_checkout') droppedAtCheckoutCount += 1;
    else if (diagnosis === 'weak_upstream') weakUpstreamCount += 1;
    else noCheckoutContextCount += 1;

    rows.push({
      order_id: orderId,
      order_created_at: order.order_created_at || order.date || null,
      order_total: order.order_total || 0,
      currency: order.currency || null,
      customer_email: order.customer_email || null,
      country_code: order.country_code || bestPurchase.country_code || null,
      city: order.city || null,
      state: order.state || null,
      purchase_event_id: bestPurchase.event_id || null,
      purchase_event_ts: bestPurchase.event_ts || null,
      purchase_source: bestPurchase.source || null,
      purchase_channel: bestPurchase.channel || null,
      purchase_attribution_status: bestPurchase.attribution_status,
      purchase_signal_count: bestPurchase.attribution_id_signal_count || 0,
      purchase_has_fbc: Boolean(bestPurchase.has_fbc || bestPurchase.has_fbclid),
      purchase_has_fbp: Boolean(bestPurchase.has_fbp),
      purchase_has_click_id: Boolean(bestPurchase.has_click_id),
      purchase_has_event_source_url: Boolean(bestPurchase.has_event_source_url),
      purchase_has_landing_context: Boolean(bestPurchase.has_landing_context),
      purchase_page_path: bestPurchase.page_path || null,
      purchase_page_url: bestPurchase.page_url || null,
      purchase_event_source_url: bestPurchase.event_source_url_resolved || bestPurchase.event_source_url || null,
      purchase_identity: identityKeyFromEvent(bestPurchase) || null,
      checkout_event_name: relatedCheckout?.event_name || null,
      checkout_event_ts: relatedCheckout?.event_ts || null,
      checkout_button: relatedCheckout?.resolved_checkout_button || relatedCheckout?.checkout_button || null,
      checkout_source: relatedCheckout?.resolved_checkout_source || relatedCheckout?.checkout_source || null,
      checkout_attribution_status: relatedCheckout?.attribution_status || 'none',
      checkout_signal_count: relatedCheckout?.attribution_id_signal_count || 0,
      checkout_has_fbc: Boolean(relatedCheckout?.has_fbc || relatedCheckout?.has_fbclid),
      checkout_has_fbp: Boolean(relatedCheckout?.has_fbp),
      checkout_has_click_id: Boolean(relatedCheckout?.has_click_id),
      checkout_has_event_source_url: Boolean(relatedCheckout?.has_event_source_url),
      checkout_has_landing_context: Boolean(relatedCheckout?.has_landing_context),
      checkout_page_path: relatedCheckout?.page_path || null,
      checkout_page_url: relatedCheckout?.page_url || null,
      upstream_event_name: relatedAtc?.event_name || null,
      upstream_event_ts: relatedAtc?.event_ts || null,
      upstream_attribution_status: relatedAtc?.attribution_status || 'none',
      upstream_signal_count: relatedAtc?.attribution_id_signal_count || 0,
      upstream_has_fbc: Boolean(relatedAtc?.has_fbc || relatedAtc?.has_fbclid),
      upstream_has_fbp: Boolean(relatedAtc?.has_fbp),
      upstream_has_click_id: Boolean(relatedAtc?.has_click_id),
      upstream_has_event_source_url: Boolean(relatedAtc?.has_event_source_url),
      upstream_has_landing_context: Boolean(relatedAtc?.has_landing_context),
      upstream_page_path: relatedAtc?.page_path || null,
      diagnosis
    });
  }

  rows.sort((a, b) => parseSqliteDateTimeToMs(b.order_created_at) - parseSqliteDateTimeToMs(a.order_created_at));

  return {
    grace_hours: graceHours,
    eligible_orders: eligibleOrders,
    attributed_purchase_count: attributedPurchases,
    unresolved_count: rows.length,
    dropped_after_checkout_count: droppedAfterCheckoutCount,
    dropped_at_checkout_count: droppedAtCheckoutCount,
    weak_upstream_count: weakUpstreamCount,
    no_checkout_context_count: noCheckoutContextCount,
    rows: rows.slice(0, maxItems)
  };
}

function eventTimeMs(event) {
  return parseSqliteDateTimeToMs(event?.event_ts);
}

function shareNonEmptyValue(a, b, field) {
  const left = safeString(a?.[field], 200);
  const right = safeString(b?.[field], 200);
  return Boolean(left && right && left === right);
}

function eventsAreRelated(baseEvent, candidateEvent) {
  if (!baseEvent || !candidateEvent) return false;
  if (shareNonEmptyValue(baseEvent, candidateEvent, 'checkout_token')) return true;
  if (shareNonEmptyValue(baseEvent, candidateEvent, 'cart_token')) return true;
  if (shareNonEmptyValue(baseEvent, candidateEvent, 'event_id')) return true;

  const baseIdentity = identityKeyFromEvent(baseEvent);
  const candidateIdentity = identityKeyFromEvent(candidateEvent);
  return Boolean(baseIdentity && candidateIdentity && baseIdentity === candidateIdentity);
}

function relationStrength(baseEvent, candidateEvent) {
  let score = 0;
  if (shareNonEmptyValue(baseEvent, candidateEvent, 'checkout_token')) score += 100;
  if (shareNonEmptyValue(baseEvent, candidateEvent, 'cart_token')) score += 80;
  if (shareNonEmptyValue(baseEvent, candidateEvent, 'event_id')) score += 60;

  const baseIdentity = identityKeyFromEvent(baseEvent);
  const candidateIdentity = identityKeyFromEvent(candidateEvent);
  if (baseIdentity && candidateIdentity && baseIdentity === candidateIdentity) score += 40;
  if (shareNonEmptyValue(baseEvent, candidateEvent, 'page_path')) score += 10;

  return score;
}

function findBestRelatedPreviousEvent(baseEvent, candidates, windowMs) {
  const baseTs = eventTimeMs(baseEvent);
  if (!Number.isFinite(baseTs) || !Array.isArray(candidates) || !candidates.length) return null;

  let best = null;
  let bestScore = -1;
  let bestTs = -1;

  for (const candidate of candidates) {
    const candidateTs = eventTimeMs(candidate);
    if (!Number.isFinite(candidateTs) || candidateTs > baseTs || candidateTs < (baseTs - windowMs)) continue;
    if (!eventsAreRelated(baseEvent, candidate)) continue;

    const score = relationStrength(baseEvent, candidate);
    if (score > bestScore || (score === bestScore && candidateTs > bestTs)) {
      best = candidate;
      bestScore = score;
      bestTs = candidateTs;
    }
  }

  return best;
}

function findBestRelatedLaterEvent(baseEvent, candidates, windowMs) {
  const baseTs = eventTimeMs(baseEvent);
  if (!Number.isFinite(baseTs) || !Array.isArray(candidates) || !candidates.length) return null;

  let best = null;
  let bestScore = -1;
  let bestTs = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const candidateTs = eventTimeMs(candidate);
    if (!Number.isFinite(candidateTs) || candidateTs < baseTs || candidateTs > (baseTs + windowMs)) continue;
    if (!eventsAreRelated(baseEvent, candidate)) continue;

    const score = relationStrength(baseEvent, candidate);
    if (score > bestScore || (score === bestScore && candidateTs < bestTs)) {
      best = candidate;
      bestScore = score;
      bestTs = candidateTs;
    }
  }

  return best;
}

function buildCheckoutContextLookupKeys(row) {
  const keys = new Set();
  const pagePath = safeString(row?.page_path, 300);

  const addKeys = (prefix, rawValue, maxLength = 200) => {
    const value = safeString(rawValue, maxLength);
    if (!value) return;
    keys.add(`${prefix}:${value}`);
    if (pagePath) keys.add(`${prefix}:${value}|page:${pagePath}`);
  };

  addKeys('checkout', row?.checkout_token, 160);
  addKeys('cart', row?.cart_token, 160);
  addKeys('event', row?.event_id, 160);

  const identity = identityKeyFromEvent(row);
  if (identity) {
    keys.add(`identity:${identity}`);
    if (pagePath) keys.add(`identity:${identity}|page:${pagePath}`);
  }

  return [...keys];
}

function resolveBestIndexedCheckoutContext(baseEvent, candidateIndex, windowMs) {
  if (!baseEvent || !(candidateIndex instanceof Map) || !candidateIndex.size) return null;

  const baseTs = eventTimeMs(baseEvent);
  if (!Number.isFinite(baseTs)) return null;

  let best = null;
  let bestScore = -1;
  let bestTs = -1;

  const seenIds = new Set();
  for (const key of buildCheckoutContextLookupKeys(baseEvent)) {
    const candidate = candidateIndex.get(key);
    if (!candidate || seenIds.has(candidate.id)) continue;
    seenIds.add(candidate.id);

    const candidateTs = eventTimeMs(candidate);
    if (!Number.isFinite(candidateTs) || candidateTs > baseTs || candidateTs < (baseTs - windowMs)) continue;

    const score = relationStrength(baseEvent, candidate);
    if (score > bestScore || (score === bestScore && candidateTs > bestTs)) {
      best = candidate;
      bestScore = score;
      bestTs = candidateTs;
    }
  }

  return best;
}

function attachResolvedCheckoutContext(rows, windowMs = DEFAULT_BUTTON_CONTEXT_WINDOW_HOURS * 60 * 60 * 1000) {
  if (!Array.isArray(rows) || !rows.length) return [];

  const normalizedRows = rows.map((row) => mapRowForApi(row));
  const ascending = [...normalizedRows].sort((a, b) => {
    const aTs = eventTimeMs(a);
    const bTs = eventTimeMs(b);
    return aTs - bTs;
  });
  const resolvedById = new Map();
  const candidateIndex = new Map();

  for (const row of ascending) {
    let resolvedButton = row.checkout_button || null;
    let resolvedSource = row.checkout_source || null;
    let resolvedFrom = 'self';
    let resolvedEventName = row.event_name || null;
    let resolvedEventTs = row.event_ts || null;

    if (!resolvedButton && !resolvedSource) {
      const candidate = resolveBestIndexedCheckoutContext(row, candidateIndex, windowMs);
      if (candidate) {
        resolvedButton = candidate.checkout_button || null;
        resolvedSource = candidate.checkout_source || null;
        resolvedFrom = 'related_previous';
        resolvedEventName = candidate.event_name || null;
        resolvedEventTs = candidate.event_ts || null;
      }
    }

    resolvedById.set(row.id, {
      ...row,
      resolved_checkout_button: resolvedButton,
      resolved_checkout_source: resolvedSource,
      resolved_checkout_context_from: resolvedFrom,
      resolved_checkout_context_event_name: resolvedEventName,
      resolved_checkout_context_event_ts: resolvedEventTs
    });

    if (row.checkout_button || row.checkout_source) {
      for (const key of buildCheckoutContextLookupKeys(row)) {
        candidateIndex.set(key, row);
      }
    }
  }

  return normalizedRows.map((row) => resolvedById.get(row.id) || row);
}

function buildMisattributedCheckoutDiagnostics(events, options = {}) {
  const graceHours = clampInt(
    options.attributionGraceHours,
    DEFAULT_ATTRIBUTION_GRACE_HOURS,
    1,
    MAX_ATTRIBUTION_GRACE_HOURS
  );
  const maxItems = clampInt(options.maxItems, DEFAULT_GHOST_SESSION_LIMIT, 1, MAX_GHOST_LIMIT);
  const upstreamWindowMs = DEFAULT_ATTRIBUTION_UPSTREAM_WINDOW_HOURS * 60 * 60 * 1000;
  const recoveryWindowMs = DEFAULT_ATTRIBUTION_RECOVERY_WINDOW_HOURS * 60 * 60 * 1000;
  const graceCutoffMs = Date.now() - (graceHours * 60 * 60 * 1000);

  const normalizedEvents = events.map(mapRowForApi);
  const beginEvents = normalizedEvents.filter((event) => isBeginCheckoutEvent(event.event_name));
  const addToCartEvents = normalizedEvents.filter((event) => normalizeEventName(event.event_name) === 'add_to_cart');
  const laterAttributedCandidates = normalizedEvents.filter((event) => {
    if (attributionScore(event.attribution_status) < 2) return false;
    const normalizedName = normalizeEventName(event.event_name);
    return normalizedName === 'add_to_cart' || normalizedName === 'begin_checkout' || normalizedName === 'purchase';
  });

  const unresolvedRows = [];
  let droppedAtCheckoutCount = 0;
  let weakUpstreamCount = 0;
  let noUpstreamSignalCount = 0;
  let recoveredLaterCount = 0;

  for (const beginEvent of beginEvents) {
    const beginTs = eventTimeMs(beginEvent);
    if (!Number.isFinite(beginTs) || beginTs > graceCutoffMs) continue;

    const beginScore = attributionScore(beginEvent.attribution_status);
    if (beginScore >= 2) continue;

    const previousAtc = findBestRelatedPreviousEvent(beginEvent, addToCartEvents, upstreamWindowMs);
    const laterAttributed = findBestRelatedLaterEvent(beginEvent, laterAttributedCandidates, recoveryWindowMs);

    if (laterAttributed && eventTimeMs(laterAttributed) > beginTs) {
      recoveredLaterCount += 1;
      continue;
    }

    const upstreamStatus = previousAtc?.attribution_status || 'none';
    const upstreamScore = previousAtc ? attributionScore(previousAtc.attribution_status) : -1;

    let transition = 'no_upstream_signal';
    if (previousAtc) {
      if (upstreamScore > beginScore) transition = 'dropped_at_checkout';
      else transition = 'weak_upstream';
    }

    if (transition === 'dropped_at_checkout') droppedAtCheckoutCount += 1;
    else if (transition === 'weak_upstream') weakUpstreamCount += 1;
    else noUpstreamSignalCount += 1;

    unresolvedRows.push({
      ...beginEvent,
      upstream_event_name: previousAtc?.event_name || null,
      upstream_event_ts: previousAtc?.event_ts || null,
      upstream_attribution_status: upstreamStatus,
      upstream_signal_count: previousAtc?.attribution_signal_count || 0,
      upstream_has_fbc: Boolean(previousAtc?.has_fbc),
      upstream_has_fbp: Boolean(previousAtc?.has_fbp),
      upstream_has_click_id: Boolean(previousAtc?.has_click_id),
      upstream_has_event_source_url: Boolean(previousAtc?.has_event_source_url),
      upstream_has_landing_context: Boolean(previousAtc?.has_landing_context),
      upstream_page_path: previousAtc?.page_path || null,
      attribution_transition: transition,
      resolved_later: false,
      late_recovery_event_name: null,
      late_recovery_event_ts: null
    });
  }

  unresolvedRows.sort((a, b) => eventTimeMs(b) - eventTimeMs(a));

  return {
    grace_hours: graceHours,
    unresolved_count: unresolvedRows.length,
    recovered_later_count: recoveredLaterCount,
    dropped_at_checkout_count: droppedAtCheckoutCount,
    weak_upstream_count: weakUpstreamCount,
    no_upstream_signal_count: noUpstreamSignalCount,
    rows: unresolvedRows.slice(0, maxItems)
  };
}

function detectDuplicateBeginCheckout(beginEvents, duplicateWindowSeconds) {
  const grouped = new Map();
  for (const event of beginEvents) {
    const identity = identityKeyFromEvent(event) || 'unknown-identity';
    const flow = flowKeyFromEvent(event);
    const key = `${identity}::${flow}`;
    const bucket = grouped.get(key) || [];
    bucket.push(event);
    grouped.set(key, bucket);
  }

  const duplicateGroups = [];
  const duplicateByButton = new Map();
  let duplicateEventCount = 0;
  const recordDuplicateCluster = (cluster) => {
    if (!Array.isArray(cluster) || cluster.length <= 1) return;

    duplicateEventCount += cluster.length - 1;
    const representative = cluster[0];
    const button = safeString(
      representative.checkout_button || representative.checkout_source,
      DUPLICATE_BUTTON_MAX_LENGTH
    ) || 'unknown';
    duplicateByButton.set(button, (duplicateByButton.get(button) || 0) + (cluster.length - 1));
    duplicateGroups.push({
      identity_key: identityKeyFromEvent(representative) || 'unknown-identity',
      flow_key: flowKeyFromEvent(representative),
      checkout_button: representative.checkout_button || null,
      checkout_source: representative.checkout_source || null,
      country_code: representative.country_code || null,
      region_code: representative.region_code || null,
      page_path: representative.page_path || null,
      count: cluster.length,
      first_event_ts: cluster[0].event_ts,
      last_event_ts: cluster[cluster.length - 1].event_ts
    });
  };

  for (const events of grouped.values()) {
    if (events.length < 2) continue;
    const sorted = [...events].sort((a, b) => {
      const aTs = parseSqliteDateTimeToMs(a.event_ts);
      const bTs = parseSqliteDateTimeToMs(b.event_ts);
      return aTs - bTs;
    });

    let cluster = [sorted[0]];
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      const previousTs = parseSqliteDateTimeToMs(previous.event_ts);
      const currentTs = parseSqliteDateTimeToMs(current.event_ts);
      const diffSeconds = Number.isFinite(previousTs) && Number.isFinite(currentTs)
        ? Math.max(0, (currentTs - previousTs) / 1000)
        : Number.POSITIVE_INFINITY;

      if (diffSeconds <= duplicateWindowSeconds) {
        cluster.push(current);
      } else {
        recordDuplicateCluster(cluster);
        cluster = [current];
      }
    }

    recordDuplicateCluster(cluster);
  }

  duplicateGroups.sort((a, b) => {
    const aTs = parseSqliteDateTimeToMs(a.last_event_ts);
    const bTs = parseSqliteDateTimeToMs(b.last_event_ts);
    return bTs - aTs;
  });

  const topButtons = [...duplicateByButton.entries()]
    .map(([checkout_button, count]) => ({ checkout_button, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_DUPLICATE_BUTTON_LIMIT);

  return {
    duplicateEventCount,
    duplicateGroups,
    topButtons
  };
}

function detectGhostSessions(allEvents, maxItems = DEFAULT_GHOST_SESSION_LIMIT) {
  const grouped = new Map();
  for (const event of allEvents) {
    const identity = identityKeyFromEvent(event);
    if (!identity) continue;
    const bucket = grouped.get(identity) || [];
    bucket.push(event);
    grouped.set(identity, bucket);
  }

  const ghosts = [];
  for (const [identity, events] of grouped.entries()) {
    const beginEvents = events.filter((event) => isBeginCheckoutEvent(event.event_name));
    if (!beginEvents.length) continue;
    const hasPurchase = events.some((event) => isPurchaseEvent(event.event_name));
    if (hasPurchase) continue;

    const sorted = [...events].sort((a, b) => parseSqliteDateTimeToMs(a.event_ts) - parseSqliteDateTimeToMs(b.event_ts));
    const last = sorted[sorted.length - 1];
    const firstBegin = beginEvents
      .slice()
      .sort((a, b) => parseSqliteDateTimeToMs(a.event_ts) - parseSqliteDateTimeToMs(b.event_ts))[0];

    ghosts.push({
      identity_key: identity,
      session_id: last.session_id || null,
      client_id: last.client_id || null,
      ip_hash: last.ip_hash || null,
      begin_checkout_events: beginEvents.length,
      first_begin_checkout_at: firstBegin?.event_ts || null,
      last_event_name: last?.event_name || null,
      last_event_ts: last?.event_ts || null,
      last_checkout_button: last?.checkout_button || last?.checkout_source || null,
      country_code: last?.country_code || null,
      region_code: last?.region_code || null,
      page_path: last?.page_path || null
    });
  }

  ghosts.sort((a, b) => parseSqliteDateTimeToMs(b.last_event_ts) - parseSqliteDateTimeToMs(a.last_event_ts));
  return ghosts.slice(0, maxItems);
}

function findApproxLastActivityForOrder(order, beginEvents, lookbackHours) {
  const orderTs = parseSqliteDateTimeToMs(order.order_created_at || order.date);
  if (!Number.isFinite(orderTs)) return null;
  const lookbackMs = lookbackHours * 60 * 60 * 1000;

  let best = null;
  for (const event of beginEvents) {
    const eventTs = parseSqliteDateTimeToMs(event.event_ts);
    if (!Number.isFinite(eventTs)) continue;
    if (eventTs > orderTs || eventTs < (orderTs - lookbackMs)) continue;
    if (order.country_code && event.country_code && order.country_code !== event.country_code) continue;
    if (!best || eventTs > parseSqliteDateTimeToMs(best.event_ts)) {
      best = event;
    }
  }
  return best;
}

function getGhostOrders(store, range, options = {}) {
  const db = getDb();
  const maxItems = clampInt(options.ghostOrderLimit, DEFAULT_GHOST_ORDER_LIMIT, 1, MAX_GHOST_LIMIT);
  const lookbackHours = clampInt(options.approxLookbackHours, DEFAULT_APPROX_LOOKBACK_HOURS, 1, MAX_APPROX_LOOKBACK_HOURS);

  const orderRows = db.prepare(`
    SELECT
      order_id,
      date,
      order_created_at,
      country_code,
      city,
      state,
      order_total,
      currency,
      customer_email
    FROM shopify_orders
    WHERE store = ?
      AND date BETWEEN ? AND ?
      AND COALESCE(is_excluded, 0) = 0
    ORDER BY COALESCE(order_created_at, date) DESC
  `).all(store, range.startDate, range.endDate);

  const purchaseRows = db.prepare(`
    SELECT
      order_id,
      event_id,
      event_ts,
      source,
      channel,
      checkout_source,
      checkout_button,
      user_agent
    FROM blackbox_events
    WHERE store = ?
      AND date(event_ts) BETWEEN ? AND ?
      AND event_name = 'purchase'
    ORDER BY event_ts DESC, id DESC
  `).all(store, range.startDate, range.endDate);

  const beginRows = db.prepare(`
    SELECT
      event_ts,
      checkout_button,
      checkout_source,
      page_url,
      country_code,
      region_code,
      page_path,
      landing_page,
      event_source_url,
      utm_source,
      utm_medium,
      utm_campaign,
      session_id,
      client_id,
      ip_hash,
      cart_token,
      checkout_token,
      event_id,
      payload_json
    FROM blackbox_events
    WHERE store = ?
      AND date(event_ts) BETWEEN ? AND ?
      AND event_name = 'begin_checkout'
    ORDER BY event_ts DESC, id DESC
  `).all(store, range.startDate, range.endDate);

  const purchaseCoverageByOrder = new Map();
  for (const purchaseEvent of purchaseRows) {
    const orderId = resolveOrderIdFromPurchaseEvent(purchaseEvent);
    if (!orderId) continue;

    const sourceClass = classifyPurchaseSource(purchaseEvent);
    const existing = purchaseCoverageByOrder.get(orderId) || {
      hasPixelPurchase: false,
      hasGtmPurchase: false,
      hasWebhookPurchase: false,
      hasUnknownPurchase: false,
      eventCount: 0,
      lastPurchaseAt: null
    };

    existing.eventCount += 1;
    if (!existing.lastPurchaseAt) {
      existing.lastPurchaseAt = purchaseEvent.event_ts || null;
    }

    if (sourceClass === 'pixel') existing.hasPixelPurchase = true;
    if (sourceClass === 'gtm') existing.hasGtmPurchase = true;
    if (sourceClass === 'webhook') existing.hasWebhookPurchase = true;
    if (sourceClass === 'unknown') existing.hasUnknownPurchase = true;

    purchaseCoverageByOrder.set(orderId, existing);
  }

  const hasPurchaseTelemetry = purchaseRows.length > 0;
  const hardGhostOrders = [];
  const recoveredWebhookOnlyOrders = [];
  const partialMissOrders = [];
  const noTelemetryOrders = [];
  const unknownSourceOrders = [];
  const purchaseGapOrders = [];

  let ordersWithAnyPurchase = 0;
  let ordersWithPixelPurchase = 0;
  let ordersWithGtmPurchase = 0;
  let ordersWithWebhookPurchase = 0;
  let ordersWithFullPurchaseCoverage = 0;

  for (const order of orderRows) {
    const orderId = safeString(order.order_id, 120);
    if (!orderId) continue;

    const coverage = purchaseCoverageByOrder.get(orderId) || null;
    const approxEvent = findApproxLastActivityForOrder(order, beginRows, lookbackHours);

    if (!coverage) {
      if (!hasPurchaseTelemetry) {
        noTelemetryOrders.push(makeOrderCandidate(order, approxEvent, null, 'no_telemetry'));
      } else {
        const candidate = makeOrderCandidate(order, approxEvent, null, 'hard_ghost');
        hardGhostOrders.push(candidate);
        purchaseGapOrders.push(candidate);
      }
      continue;
    }

    ordersWithAnyPurchase += 1;
    if (coverage.hasPixelPurchase) ordersWithPixelPurchase += 1;
    if (coverage.hasGtmPurchase) ordersWithGtmPurchase += 1;
    if (coverage.hasWebhookPurchase) ordersWithWebhookPurchase += 1;

    const hasPixel = coverage.hasPixelPurchase;
    const hasGtm = coverage.hasGtmPurchase;
    const hasWebhook = coverage.hasWebhookPurchase;

    if (hasPixel && hasGtm) {
      ordersWithFullPurchaseCoverage += 1;
      continue;
    }

    if (!hasPixel && !hasGtm && hasWebhook) {
      const candidate = makeOrderCandidate(order, approxEvent, coverage, 'recovered_webhook_only');
      recoveredWebhookOnlyOrders.push(candidate);
      purchaseGapOrders.push(candidate);
      continue;
    }

    if (hasPixel !== hasGtm) {
      const candidate = makeOrderCandidate(order, approxEvent, coverage, 'partial_miss');
      partialMissOrders.push(candidate);
      purchaseGapOrders.push(candidate);
      continue;
    }

    if (!hasPixel && !hasGtm && coverage.hasUnknownPurchase) {
      const candidate = makeOrderCandidate(order, approxEvent, coverage, 'unknown_purchase_source');
      unknownSourceOrders.push(candidate);
      purchaseGapOrders.push(candidate);
    }
  }

  return {
    totalOrders: orderRows.length,
    purchaseTelemetryEvents: purchaseRows.length,
    hasPurchaseTelemetry,
    ordersWithAnyPurchase,
    ordersWithPixelPurchase,
    ordersWithGtmPurchase,
    ordersWithWebhookPurchase,
    ordersWithFullPurchaseCoverage,
    hardGhostOrdersTotal: hardGhostOrders.length,
    recoveredWebhookOnlyTotal: recoveredWebhookOnlyOrders.length,
    partialMissTotal: partialMissOrders.length,
    noTelemetryTotal: noTelemetryOrders.length,
    unknownSourceTotal: unknownSourceOrders.length,
    purchaseGapOrdersTotal: purchaseGapOrders.length,
    hardGhostOrders: hardGhostOrders.slice(0, maxItems),
    recoveredWebhookOnlyOrders: recoveredWebhookOnlyOrders.slice(0, maxItems),
    partialMissOrders: partialMissOrders.slice(0, maxItems),
    noTelemetryOrders: noTelemetryOrders.slice(0, maxItems),
    unknownSourceOrders: unknownSourceOrders.slice(0, maxItems),
    purchaseGapOrders: purchaseGapOrders.slice(0, maxItems)
  };
}

function mapRowForApi(row) {
  const mapped = { ...row };
  const payload = parsePayloadJsonObject(row?.payload_json);

  if (!mapped.source) mapped.source = pickFirstString(payload, SOURCE_PATHS, 120) || null;
  if (!mapped.channel) mapped.channel = pickFirstString(payload, CHANNEL_PATHS, 120) || null;
  if (!mapped.session_id) mapped.session_id = pickFirstString(payload, SESSION_ID_PATHS, 120) || null;
  if (!mapped.client_id) mapped.client_id = pickFirstString(payload, CLIENT_ID_PATHS, 120) || null;
  if (!mapped.event_id) mapped.event_id = pickFirstString(payload, EVENT_ID_PATHS, 160) || null;
  if (!mapped.order_id) mapped.order_id = pickFirstString(payload, ORDER_ID_PATHS, 120) || null;
  if (!mapped.cart_token) mapped.cart_token = pickFirstString(payload, CART_TOKEN_PATHS, 160) || null;
  if (!mapped.checkout_token) mapped.checkout_token = pickFirstString(payload, CHECKOUT_TOKEN_PATHS, 160) || null;
  if (!mapped.checkout_button) mapped.checkout_button = pickFirstString(payload, CHECKOUT_BUTTON_PATHS, 160) || null;
  if (!mapped.checkout_source) mapped.checkout_source = pickFirstString(payload, CHECKOUT_SOURCE_PATHS, 160) || null;
  if (!mapped.page_url) mapped.page_url = pickFirstString(payload, PAGE_URL_PATHS, 1600) || null;
  if (!mapped.page_path) mapped.page_path = resolvePagePath(mapped.page_url, pickFirstString(payload, PAGE_PATH_PATHS, 600)) || null;
  if (!mapped.referrer) mapped.referrer = pickFirstString(payload, REFERRER_PATHS, 1200) || null;
  if (!mapped.landing_page) mapped.landing_page = pickFirstString(payload, LANDING_PAGE_PATHS, 1200) || null;
  if (!mapped.event_source_url) mapped.event_source_url = pickFirstString(payload, EVENT_SOURCE_URL_PATHS, 1200) || null;
  if (!mapped.country_code) mapped.country_code = pickFirstString(payload, COUNTRY_PATHS, 16) || null;
  if (!mapped.region_code) mapped.region_code = pickFirstString(payload, REGION_PATHS, 32) || null;
  if (!mapped.utm_source) mapped.utm_source = pickFirstString(payload, UTM_SOURCE_PATHS, 240) || null;
  if (!mapped.utm_medium) mapped.utm_medium = pickFirstString(payload, UTM_MEDIUM_PATHS, 240) || null;
  if (!mapped.utm_campaign) mapped.utm_campaign = pickFirstString(payload, UTM_CAMPAIGN_PATHS, 240) || null;

  const attributionDiagnostics = resolveAttributionDiagnostics(row);
  mapped.is_begin_checkout = isBeginCheckoutEvent(row.event_name);
  mapped.is_purchase = isPurchaseEvent(row.event_name);
  Object.assign(mapped, attributionDiagnostics);
  delete mapped.payload_json;
  return mapped;
}

function normalizeShopifyNumericId(value) {
  const raw = safeString(value, 200);
  if (!raw) return '';
  const match = raw.match(/(\d{6,})/);
  return match ? match[1] : raw;
}

function parseQueryParamsFromUrl(rawUrl) {
  const url = safeString(rawUrl, 1800);
  if (!url) return null;
  try {
    const parsed = url.startsWith('/') || url.startsWith('?')
      ? new URL(url, 'https://blackbox.local')
      : new URL(url);
    return parsed.searchParams;
  } catch (_error) {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return null;
    try {
      return new URLSearchParams(url.slice(queryIndex + 1));
    } catch (_error2) {
      return null;
    }
  }
}

function resolveAttributionDiagnostics(row) {
  const payload = parsePayloadJsonObject(row?.payload_json);

  const pageUrl = firstNonEmptyString([
    row?.page_url,
    pickFirstString(payload, PAGE_URL_PATHS, 1600)
  ], 1600);

  const landingPage = firstNonEmptyString([
    row?.landing_page,
    pickFirstString(payload, LANDING_PAGE_PATHS, 1200)
  ], 1200);

  const eventSourceUrl = firstNonEmptyString([
    row?.event_source_url,
    pickFirstString(payload, EVENT_SOURCE_URL_PATHS, 1200)
  ], 1200);

  const fbc = pickFirstString(payload, FBC_PATHS, 800);
  const fbp = pickFirstString(payload, FBP_PATHS, 800);
  const fbclidFromPayload = pickFirstString(payload, FBCLID_PATHS, 800);

  const urlParams = [
    parseQueryParamsFromUrl(eventSourceUrl),
    parseQueryParamsFromUrl(landingPage),
    parseQueryParamsFromUrl(pageUrl)
  ].filter(Boolean);

  const pickQueryParam = (key) => {
    for (const params of urlParams) {
      const value = safeString(params.get(key), 800);
      if (value) return value;
    }
    return '';
  };

  const fbclid = firstNonEmptyString([fbclidFromPayload, pickQueryParam('fbclid')], 800);
  const utmSource = firstNonEmptyString([
    row?.utm_source,
    pickFirstString(payload, UTM_SOURCE_PATHS, 240),
    pickQueryParam('utm_source')
  ], 240);
  const utmMedium = firstNonEmptyString([
    row?.utm_medium,
    pickFirstString(payload, UTM_MEDIUM_PATHS, 240),
    pickQueryParam('utm_medium')
  ], 240);
  const utmCampaign = firstNonEmptyString([
    row?.utm_campaign,
    pickFirstString(payload, UTM_CAMPAIGN_PATHS, 240),
    pickQueryParam('utm_campaign')
  ], 240);

  const hasEventSourceUrl = Boolean(eventSourceUrl);
  const hasLandingContext = Boolean(landingPage || utmSource || utmMedium || utmCampaign);
  const hasClickId = Boolean(fbc || fbclid);
  const hasBrowserId = Boolean(fbp);
  const hasAttributionIds = Boolean(hasClickId || hasBrowserId);

  let status = 'missing';
  if (hasAttributionIds) {
    status = 'attributed';
  } else if (hasEventSourceUrl || hasLandingContext) {
    status = 'partial';
  }

  const missingCoreFields = [];
  if (!hasEventSourceUrl) missingCoreFields.push('event_source_url');
  if (!hasLandingContext) missingCoreFields.push('landing_context');
  if (!hasClickId) missingCoreFields.push('click_id');
  if (!hasBrowserId) missingCoreFields.push('fbp');

  const signalCount = [hasEventSourceUrl, hasLandingContext, hasClickId, hasBrowserId].filter(Boolean).length;
  const idSignalCount = [hasClickId, hasBrowserId].filter(Boolean).length;

  return {
    attribution_status: status,
    attribution_signal_count: signalCount,
    attribution_id_signal_count: idSignalCount,
    attribution_missing_core_fields: missingCoreFields,
    attribution_missing_core_summary: missingCoreFields.join(', '),
    has_event_source_url: hasEventSourceUrl,
    has_landing_context: hasLandingContext,
    has_click_id: hasClickId,
    has_browser_id: hasBrowserId,
    has_attribution_ids: hasAttributionIds,
    has_fbc: Boolean(fbc),
    has_fbclid: Boolean(fbclid),
    has_fbp: Boolean(fbp),
    has_utm_source: Boolean(utmSource),
    has_utm_medium: Boolean(utmMedium),
    has_utm_campaign: Boolean(utmCampaign),
    fbc: fbc || null,
    fbclid: fbclid || null,
    fbp: fbp || null,
    landing_page_resolved: landingPage || null,
    event_source_url_resolved: eventSourceUrl || null,
    utm_source_resolved: utmSource || null,
    utm_medium_resolved: utmMedium || null,
    utm_campaign_resolved: utmCampaign || null
  };
}

function extractUtmParams(payload, pageUrl) {
  const utmSource = safeString(pickFirstString(payload, UTM_SOURCE_PATHS, 240), 240);
  const utmMedium = safeString(pickFirstString(payload, UTM_MEDIUM_PATHS, 240), 240);
  const utmCampaign = safeString(pickFirstString(payload, UTM_CAMPAIGN_PATHS, 240), 240);

  if (utmSource || utmMedium || utmCampaign) {
    return {
      utm_source: utmSource || '',
      utm_medium: utmMedium || '',
      utm_campaign: utmCampaign || ''
    };
  }

  const params = parseQueryParamsFromUrl(pageUrl);
  if (!params) return { utm_source: '', utm_medium: '', utm_campaign: '' };

  return {
    utm_source: safeString(params.get('utm_source') || '', 240),
    utm_medium: safeString(params.get('utm_medium') || '', 240),
    utm_campaign: safeString(params.get('utm_campaign') || '', 240)
  };
}

function extractCountryRegionFromShopifyPixel(payload) {
  const countryCandidates = [
    payload?.country_code,
    payload?.countryCode,
    payload?.geoipCountryCode,
    payload?.data?.checkout?.shippingAddress?.countryCode,
    payload?.data?.checkout?.billingAddress?.countryCode,
    payload?.event?.data?.checkout?.shippingAddress?.countryCode,
    payload?.event?.data?.checkout?.billingAddress?.countryCode,
    payload?.checkout?.shippingAddress?.countryCode,
    payload?.checkout?.billingAddress?.countryCode
  ];

  let country = '';
  for (const value of countryCandidates) {
    const normalized = normalizeCountryCode(value);
    if (normalized) {
      country = normalized;
      break;
    }
  }

  const regionCandidates = [
    payload?.region_code,
    payload?.regionCode,
    payload?.data?.checkout?.shippingAddress?.provinceCode,
    payload?.data?.checkout?.billingAddress?.provinceCode,
    payload?.event?.data?.checkout?.shippingAddress?.provinceCode,
    payload?.event?.data?.checkout?.billingAddress?.provinceCode,
    payload?.checkout?.shippingAddress?.provinceCode,
    payload?.checkout?.billingAddress?.provinceCode
  ];

  let region = '';
  for (const value of regionCandidates) {
    const normalized = normalizeRegionCode(value);
    if (normalized) {
      region = normalized;
      break;
    }
  }

  return { country_code: country, region_code: region };
}

function extractCheckoutTokens(payload) {
  const checkoutToken = safeString(
    payload?.checkout_token ||
      payload?.checkoutToken ||
      payload?.checkout_id ||
      payload?.checkoutId ||
      payload?.data?.checkout?.token ||
      payload?.data?.checkout?.id ||
      payload?.event?.data?.checkout?.token ||
      payload?.event?.data?.checkout?.id ||
      payload?.checkout?.token ||
      payload?.checkout?.id ||
      '',
    200
  );

  const cartToken = safeString(
    payload?.cart_token ||
      payload?.cartToken ||
      payload?.data?.cart?.token ||
      payload?.event?.data?.cart?.token ||
      payload?.cart?.token ||
      '',
    200
  );

  return { checkout_token: checkoutToken, cart_token: cartToken };
}

function extractOrderId(payload) {
  const candidates = [
    payload?.order_id,
    payload?.orderId,
    payload?.transaction_id,
    payload?.data?.order_id,
    payload?.data?.order?.id,
    payload?.data?.checkout?.order?.id,
    payload?.data?.checkout?.orderId,
    payload?.event?.data?.order_id,
    payload?.event?.data?.order?.id,
    payload?.event?.data?.checkout?.order?.id,
    payload?.event?.data?.checkout?.orderId,
    payload?.checkout?.order?.id,
    payload?.checkout?.orderId
  ];

  for (const value of candidates) {
    const normalized = normalizeShopifyNumericId(value);
    if (normalized) return normalized;
  }
  return '';
}

// Takes any Shopify pixel payload and returns a minimal Blackbox-safe payload.
// IMPORTANT: This intentionally drops `event.data` / `checkout` objects to avoid storing PII.
export function sanitizeShopifyPixelPayloadForBlackbox(payload, options = {}) {
  const store = normalizeStore(options.store || payload?.store || DEFAULT_STORE);
  const eventType = safeString(options.eventType || pickFirstString(payload, EVENT_NAME_PATHS, 160), 160);
  const timestamp = safeString(options.timestamp || pickFirstString(payload, TIMESTAMP_PATHS, 80), 80) || new Date().toISOString();

  const context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
  const doc = context?.document && typeof context.document === 'object' ? context.document : {};

  const pageUrl = safeString(
    doc?.location?.href ||
      doc?.locationHref ||
      payload?.page_url ||
      payload?.page_location ||
      '',
    1600
  );

  const referrer = safeString(
    doc?.referrer ||
      payload?.referrer ||
      '',
    1200
  );

  const sessionId = safeString(
    payload?.session_id ||
      payload?.sessionId ||
      context?.session_id ||
      context?.sessionId ||
      '',
    120
  );

  const clientId = safeString(
    payload?.client_id ||
      payload?.clientId ||
      context?.client_id ||
      context?.clientId ||
      '',
    120
  );

  const { checkout_token: checkoutToken, cart_token: cartToken } = extractCheckoutTokens(payload);
  const orderId = extractOrderId(payload);

  const normalizedEventName = normalizeEventName(eventType);
  const isPurchase = normalizedEventName === 'purchase';
  const eventIdFromPayload = safeString(pickFirstString(payload, EVENT_ID_PATHS, 160), 160);

  let eventId = eventIdFromPayload;
  if (!eventId) {
    if (isPurchase && orderId) eventId = `${orderId}_purchase`;
    else if (checkoutToken) eventId = `${checkoutToken}_${normalizedEventName}`;
    else if (cartToken) eventId = `${cartToken}_${normalizedEventName}`;
  }

  const checkoutButton = safeString(pickFirstString(payload, CHECKOUT_BUTTON_PATHS, 160), 160);
  const checkoutSource = safeString(pickFirstString(payload, CHECKOUT_SOURCE_PATHS, 160), 160);

  const { utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign } = extractUtmParams(payload, pageUrl);
  const { country_code: countryCode, region_code: regionCode } = extractCountryRegionFromShopifyPixel(payload);

  const landingPage = safeString(pickFirstString(payload, LANDING_PAGE_PATHS, 1200), 1200);
  const eventSourceUrl = safeString(pickFirstString(payload, EVENT_SOURCE_URL_PATHS, 1200), 1200) || pageUrl;

  const source = safeString(options.source || pickFirstString(payload, SOURCE_PATHS, 120), 120) || 'shopify_custom_pixel';
  const channel = safeString(options.channel || pickFirstString(payload, CHANNEL_PATHS, 120), 120) || 'shopify_pixel';

  const sanitized = {
    store,
    source,
    channel,
    timestamp,
    event: eventType,
    session_id: sessionId,
    client_id: clientId,
    event_id: eventId,
    order_id: orderId,
    cart_token: cartToken,
    checkout_token: checkoutToken,
    checkout_button: checkoutButton,
    checkout_source: checkoutSource,
    page_url: pageUrl,
    referrer,
    landing_page: landingPage,
    event_source_url: eventSourceUrl,
    country_code: countryCode,
    region_code: regionCode,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign
  };

  // Drop empty keys to keep payload_json small and reduce noise.
  Object.keys(sanitized).forEach((key) => {
    const value = sanitized[key];
    if (value === null || value === undefined) {
      delete sanitized[key];
      return;
    }
    if (typeof value === 'string' && !value.trim()) delete sanitized[key];
  });

  return sanitized;
}

export function backfillBlackboxFromShopifyPixelEvents(store, options = {}) {
  const db = getDb();
  const normalizedStore = normalizeStore(store);
  const lookbackDays = clampInt(options.lookbackDays, DEFAULT_PIXEL_BACKFILL_DAYS, 1, MAX_LOOKBACK_DAYS);
  const maxRows = clampInt(options.maxRows, DEFAULT_PIXEL_BACKFILL_MAX_ROWS, 100, MAX_PIXEL_BACKFILL_MAX_ROWS);
  const range = resolveDateRange({ lookbackDays });

  const existingRows = db.prepare(`
    SELECT event_name, event_id, order_id, checkout_token, cart_token, session_id, client_id
    FROM blackbox_events
    WHERE store = ?
      AND date(event_ts) BETWEEN ? AND ?
      AND (event_name LIKE '%checkout%' OR event_name = 'purchase' OR event_name = 'payment_info_submitted')
  `).all(normalizedStore, range.startDate, range.endDate);

  const makeKey = (row) => {
    const eventName = safeString(row?.event_name, 120);
    const orderId = safeString(row?.order_id, 120);
    const checkoutToken = safeString(row?.checkout_token, 160);
    const cartToken = safeString(row?.cart_token, 160);
    const sessionId = safeString(row?.session_id, 120);
    const clientId = safeString(row?.client_id, 120);

    let eventId = safeString(row?.event_id, 160);
    // Normalize missing event_id into the deterministic forms we use for backfill/mirror.
    if (!eventId) {
      if (eventName === 'purchase' && orderId) {
        eventId = `${orderId}_purchase`;
      } else if (checkoutToken) {
        eventId = `${checkoutToken}_${eventName}`;
      } else if (cartToken) {
        eventId = `${cartToken}_${eventName}`;
      }
    }
    return `${eventName}|${eventId}|${orderId}|${checkoutToken}|${cartToken}|${sessionId}|${clientId}`;
  };

  const existingKeys = new Set(existingRows.map(makeKey));

  const pixelRows = db.prepare(`
    SELECT id, event_type, event_ts, created_at, payload_json
    FROM shopify_pixel_events
    WHERE store = ?
      AND date(created_at) BETWEEN ? AND ?
      AND (
        LOWER(event_type) LIKE '%checkout%'
        OR LOWER(event_type) = 'payment_info_submitted'
      )
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(normalizedStore, range.startDate, range.endDate, maxRows);

  let inserted = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;
  const errors = [];

  for (const row of pixelRows) {
    let payload = null;
    try {
      payload = row.payload_json ? JSON.parse(row.payload_json) : null;
    } catch (_error) {
      payload = null;
    }
    if (!payload) {
      skippedInvalid += 1;
      continue;
    }

    const sanitized = sanitizeShopifyPixelPayloadForBlackbox(payload, {
      store: normalizedStore,
      eventType: row.event_type,
      timestamp: row.event_ts || row.created_at,
      source: 'shopify_custom_pixel',
      channel: 'shopify_pixel_backfill'
    });

    const key = makeKey({
      event_name: normalizeEventName(sanitized.event || row.event_type),
      event_id: sanitized.event_id || '',
      order_id: sanitized.order_id || '',
      checkout_token: sanitized.checkout_token || '',
      cart_token: sanitized.cart_token || '',
      session_id: sanitized.session_id || '',
      client_id: sanitized.client_id || ''
    });

    if (existingKeys.has(key)) {
      skippedExisting += 1;
      continue;
    }

    try {
      recordBlackboxEvent({ store: normalizedStore, payload: sanitized, req: undefined });
      existingKeys.add(key);
      inserted += 1;
    } catch (error) {
      errors.push({
        id: row.id,
        event_type: row.event_type,
        error: error?.message || String(error)
      });
    }
  }

  return {
    store: normalizedStore,
    range,
    lookbackDays,
    scanned: pixelRows.length,
    inserted,
    skippedExisting,
    skippedInvalid,
    errors: errors.slice(0, 20)
  };
}

export function recordBlackboxEvent({ store, payload, req }) {
  const db = getDb();
  const eventRecord = resolveEventRecord({ store, payload, req });

  const result = db.prepare(`
    INSERT INTO blackbox_events (
      store,
      event_name,
      event_ts,
      source,
      channel,
      session_id,
      client_id,
      event_id,
      order_id,
      cart_token,
      checkout_token,
      checkout_button,
      checkout_source,
      page_url,
      page_path,
      referrer,
      landing_page,
      event_source_url,
      country_code,
      region_code,
      ip_hash,
      user_agent,
      utm_source,
      utm_medium,
      utm_campaign,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventRecord.store,
    eventRecord.event_name,
    eventRecord.event_ts,
    eventRecord.source || null,
    eventRecord.channel || null,
    eventRecord.session_id || null,
    eventRecord.client_id || null,
    eventRecord.event_id || null,
    eventRecord.order_id || null,
    eventRecord.cart_token || null,
    eventRecord.checkout_token || null,
    eventRecord.checkout_button || null,
    eventRecord.checkout_source || null,
    eventRecord.page_url || null,
    eventRecord.page_path || null,
    eventRecord.referrer || null,
    eventRecord.landing_page || null,
    eventRecord.event_source_url || null,
    eventRecord.country_code || null,
    eventRecord.region_code || null,
    eventRecord.ip_hash || null,
    eventRecord.user_agent || null,
    eventRecord.utm_source || null,
    eventRecord.utm_medium || null,
    eventRecord.utm_campaign || null,
    eventRecord.payload_json || null
  );

  return {
    id: result.lastInsertRowid,
    store: eventRecord.store,
    event_name: eventRecord.event_name,
    event_ts: eventRecord.event_ts,
    session_id: eventRecord.session_id || null,
    order_id: eventRecord.order_id || null
  };
}

export function listBlackboxEvents(store, filters = {}) {
  const db = getDb();
  const limit = clampInt(filters.limit, DEFAULT_EVENT_LIMIT, 1, MAX_EVENT_LIMIT);
  const offset = clampInt(filters.offset, 0, 0, 50000);
  const { range, whereSql, params } = buildEventsWhereClause(store, filters);

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM blackbox_events
    WHERE ${whereSql}
  `).get(...params);

  const rows = db.prepare(`
    SELECT
      id,
      store,
      event_name,
      event_ts,
      source,
      channel,
      session_id,
      client_id,
      event_id,
      order_id,
      cart_token,
      checkout_token,
      checkout_button,
      checkout_source,
      page_url,
      page_path,
      referrer,
      landing_page,
      event_source_url,
      country_code,
      region_code,
      ip_hash,
      utm_source,
      utm_medium,
      utm_campaign,
      payload_json,
      created_at
    FROM blackbox_events
    WHERE ${whereSql}
    ORDER BY event_ts DESC, id DESC
    LIMIT ?
    OFFSET ?
  `).all(...params, limit, offset);

  const resolvedRows = attachResolvedCheckoutContext(rows);

  const eventNames = db.prepare(`
    SELECT event_name, COUNT(*) AS count
    FROM blackbox_events
    WHERE store = ?
      AND date(event_ts) BETWEEN ? AND ?
    GROUP BY event_name
    ORDER BY count DESC, event_name ASC
    LIMIT 100
  `).all(normalizeStore(store), range.startDate, range.endDate);

  const sources = db.prepare(`
    SELECT source, COUNT(*) AS count
    FROM blackbox_events
    WHERE store = ?
      AND date(event_ts) BETWEEN ? AND ?
      AND source IS NOT NULL
      AND source != ''
    GROUP BY source
    ORDER BY count DESC, source ASC
    LIMIT 100
  `).all(normalizeStore(store), range.startDate, range.endDate);

  return {
    store: normalizeStore(store),
    range,
    total: Number(totalRow?.total || 0),
    limit,
    offset,
    rows: resolvedRows,
    options: {
      eventNames,
      sources
    }
  };
}

export function getBlackboxOverview(store, options = {}) {
  const db = getDb();
  const normalizedStore = normalizeStore(store);
  const { range, whereSql, params } = buildEventsWhereClause(normalizedStore, options);
  const analysisLimit = clampInt(options.analysisLimit, DEFAULT_ANALYSIS_LIMIT, 100, MAX_ANALYSIS_LIMIT);
  const duplicateWindowSeconds = clampInt(
    options.duplicateWindowSeconds,
    DEFAULT_DUPLICATE_WINDOW_SECONDS,
    3,
    MAX_DUPLICATE_WINDOW_SECONDS
  );
  const ghostSessionLimit = clampInt(options.ghostSessionLimit, DEFAULT_GHOST_SESSION_LIMIT, 1, MAX_GHOST_LIMIT);

  const rows = db.prepare(`
    SELECT
      id,
      event_name,
      event_ts,
      source,
      channel,
      session_id,
      client_id,
      event_id,
      order_id,
      cart_token,
      checkout_token,
      checkout_button,
      checkout_source,
      page_url,
      page_path,
      landing_page,
      event_source_url,
      utm_source,
      utm_medium,
      utm_campaign,
      country_code,
      region_code,
      ip_hash,
      payload_json
    FROM blackbox_events
    WHERE ${whereSql}
    ORDER BY event_ts ASC, id ASC
    LIMIT ?
  `).all(...params, analysisLimit);

  const beginEvents = rows.filter((event) => isBeginCheckoutEvent(event.event_name));
  const purchaseEvents = rows.filter((event) => isPurchaseEvent(event.event_name));
  const identitySet = new Set(rows.map(identityKeyFromEvent).filter(Boolean));

  const duplicateDiagnostics = detectDuplicateBeginCheckout(beginEvents, duplicateWindowSeconds);
  const checkoutAttribution = buildCheckoutAttributionOverview(beginEvents, ghostSessionLimit);
  const misattribution = buildMisattributedPurchaseDiagnostics(normalizedStore, range, {
    attributionGraceHours: options.attributionGraceHours,
    approxLookbackHours: options.approxLookbackHours,
    maxItems: ghostSessionLimit
  });
  const ghostSessions = detectGhostSessions(rows, ghostSessionLimit);
  const ghostOrderData = getGhostOrders(normalizedStore, range, options);

  return {
    store: normalizedStore,
    range,
    summary: {
      sampled_events: rows.length,
      sampled_sessions: identitySet.size,
      eligible_orders_older_than_grace: misattribution.eligible_orders,
      attributed_purchases_older_than_grace: misattribution.attributed_purchase_count,
      unresolved_misattributed_purchases: misattribution.unresolved_count,
      dropped_after_checkout_count: misattribution.dropped_after_checkout_count,
      dropped_at_checkout_count: misattribution.dropped_at_checkout_count,
      weak_upstream_count: misattribution.weak_upstream_count,
      no_checkout_context_count: misattribution.no_checkout_context_count,
      duplicate_begin_checkout_events: duplicateDiagnostics.duplicateEventCount,
      duplicate_begin_checkout_rate: beginEvents.length
        ? duplicateDiagnostics.duplicateEventCount / beginEvents.length
        : 0,
      purchase_events: purchaseEvents.length,
      ghost_sessions_without_purchase: ghostSessions.length,
      shopify_orders_in_range: ghostOrderData.totalOrders,
      orders_with_blackbox_purchase: ghostOrderData.ordersWithAnyPurchase,
      orders_with_full_purchase_coverage: ghostOrderData.ordersWithFullPurchaseCoverage,
      orders_with_pixel_purchase: ghostOrderData.ordersWithPixelPurchase,
      orders_with_gtm_purchase: ghostOrderData.ordersWithGtmPurchase,
      orders_with_webhook_purchase: ghostOrderData.ordersWithWebhookPurchase,
      orders_with_purchase_gap: ghostOrderData.purchaseGapOrdersTotal,
      blackbox_purchase_events_in_range: ghostOrderData.purchaseTelemetryEvents,
      blackbox_purchase_stream_active: ghostOrderData.hasPurchaseTelemetry,
      hard_ghost_orders: ghostOrderData.hardGhostOrdersTotal,
      recovered_webhook_only_orders: ghostOrderData.recoveredWebhookOnlyTotal,
      partial_miss_orders: ghostOrderData.partialMissTotal,
      no_telemetry_orders: ghostOrderData.noTelemetryTotal,
      unknown_source_orders: ghostOrderData.unknownSourceTotal,
      ghost_orders_without_blackbox_purchase: ghostOrderData.hardGhostOrdersTotal
    },
    misattribution,
    duplicates: {
      window_seconds: duplicateWindowSeconds,
      top_buttons: duplicateDiagnostics.topButtons,
      groups: duplicateDiagnostics.duplicateGroups.slice(0, 50)
    },
    checkout_attribution: checkoutAttribution,
    ghost_sessions: ghostSessions,
    ghost_orders: ghostOrderData.hardGhostOrders,
    hard_ghost_orders: ghostOrderData.hardGhostOrders,
    recovered_webhook_only_orders: ghostOrderData.recoveredWebhookOnlyOrders,
    partial_miss_orders: ghostOrderData.partialMissOrders,
    no_telemetry_orders: ghostOrderData.noTelemetryOrders,
    unknown_source_orders: ghostOrderData.unknownSourceOrders,
    purchase_gap_orders: ghostOrderData.purchaseGapOrders
  };
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const escaped = raw.replace(/"/g, '""');
  if (/[",\n]/.test(escaped)) return `"${escaped}"`;
  return escaped;
}

export function exportBlackboxEventsCsv(store, filters = {}) {
  const data = listBlackboxEvents(store, {
    ...filters,
    limit: clampInt(filters.limit, DEFAULT_EXPORT_LIMIT, 1, MAX_EXPORT_LIMIT),
    offset: 0
  });

  const headers = [
    'id',
    'store',
    'event_name',
    'event_ts',
    'source',
    'session_id',
    'client_id',
    'event_id',
    'order_id',
    'cart_token',
    'checkout_token',
    'checkout_button',
    'checkout_source',
    'page_url',
    'page_path',
    'country_code',
    'region_code',
    'ip_hash',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'attribution_status',
    'attribution_signal_count',
    'attribution_missing_core_summary',
    'has_event_source_url',
    'has_landing_context',
    'has_click_id',
    'has_browser_id',
    'created_at'
  ];

  const lines = [headers.join(',')];
  for (const row of data.rows) {
    lines.push(headers.map((header) => escapeCsvValue(row[header])).join(','));
  }

  return {
    ...data,
    csv: lines.join('\n')
  };
}
