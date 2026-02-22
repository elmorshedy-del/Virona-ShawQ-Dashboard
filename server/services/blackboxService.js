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
const DEFAULT_APPROX_LOOKBACK_HOURS = 6;
const MAX_APPROX_LOOKBACK_HOURS = 24;
const MAX_RAW_JSON_CHARS = 20000;
const MAX_STRING_LENGTH = 800;
const MAX_STORE_LENGTH = 64;
const IP_HASH_PREFIX_LENGTH = 16;

const EVENT_NAME_ALIASES = new Map([
  ['checkout_started', 'begin_checkout'],
  ['checkout_start', 'begin_checkout'],
  ['checkout_initiated', 'begin_checkout'],
  ['begin_checkout_stape', 'begin_checkout'],
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
  'session.client_id',
  'context.client_id',
  'context.clientId',
  'user_data.external_id'
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
  'attribution.landing_page',
  'attribution.landing_page_last',
  'meta.landing_page'
];

const EVENT_SOURCE_URL_PATHS = [
  'event_source_url',
  'context.event_source_url',
  'meta.event_source_url'
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
  'source',
  'context.source',
  'meta.source'
];

const CHANNEL_PATHS = [
  'channel',
  'meta.channel'
];

const UTM_SOURCE_PATHS = [
  'utm_source',
  'attribution.utm_source',
  'context.utm_source'
];

const UTM_MEDIUM_PATHS = [
  'utm_medium',
  'attribution.utm_medium',
  'context.utm_medium'
];

const UTM_CAMPAIGN_PATHS = [
  'utm_campaign',
  'attribution.utm_campaign',
  'context.utm_campaign'
];

const TIMESTAMP_PATHS = [
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
        if (cluster.length > 1) {
          duplicateEventCount += cluster.length - 1;
          const representative = cluster[0];
          const button = safeString(representative.checkout_button || representative.checkout_source, 160) || 'unknown';
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
        }
        cluster = [current];
      }
    }

    if (cluster.length > 1) {
      duplicateEventCount += cluster.length - 1;
      const representative = cluster[0];
      const button = safeString(representative.checkout_button || representative.checkout_source, 160) || 'unknown';
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
    }
  }

  duplicateGroups.sort((a, b) => {
    const aTs = parseSqliteDateTimeToMs(a.last_event_ts);
    const bTs = parseSqliteDateTimeToMs(b.last_event_ts);
    return bTs - aTs;
  });

  const topButtons = [...duplicateByButton.entries()]
    .map(([checkout_button, count]) => ({ checkout_button, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

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

function getGhostOrders(store, range, purchaseEvents, beginEvents, options = {}) {
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
    LIMIT ?
  `).all(store, range.startDate, range.endDate, maxItems * 5);

  const purchaseOrderIds = new Set(
    purchaseEvents
      .map((event) => safeString(event.order_id, 120))
      .filter(Boolean)
  );

  const ghostOrders = [];
  for (const order of orderRows) {
    const orderId = safeString(order.order_id, 120);
    if (!orderId) continue;
    if (purchaseOrderIds.has(orderId)) continue;

    const approxEvent = findApproxLastActivityForOrder(order, beginEvents, lookbackHours);
    ghostOrders.push({
      order_id: orderId,
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
      approx_last_identity_key: approxEvent ? (identityKeyFromEvent(approxEvent) || null) : null
    });
  }

  return {
    totalOrders: orderRows.length,
    ghostOrders: ghostOrders.slice(0, maxItems)
  };
}

function mapRowForApi(row) {
  const mapped = { ...row };
  mapped.is_begin_checkout = isBeginCheckoutEvent(row.event_name);
  mapped.is_purchase = isPurchaseEvent(row.event_name);
  return mapped;
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
      created_at
    FROM blackbox_events
    WHERE ${whereSql}
    ORDER BY event_ts DESC, id DESC
    LIMIT ?
    OFFSET ?
  `).all(...params, limit, offset).map(mapRowForApi);

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
    rows,
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
      session_id,
      client_id,
      order_id,
      cart_token,
      checkout_token,
      checkout_button,
      checkout_source,
      page_path,
      country_code,
      region_code,
      ip_hash
    FROM blackbox_events
    WHERE ${whereSql}
    ORDER BY event_ts ASC, id ASC
    LIMIT ?
  `).all(...params, analysisLimit);

  const beginEvents = rows.filter((event) => isBeginCheckoutEvent(event.event_name));
  const purchaseEvents = rows.filter((event) => isPurchaseEvent(event.event_name));
  const identitySet = new Set(rows.map(identityKeyFromEvent).filter(Boolean));

  const duplicateDiagnostics = detectDuplicateBeginCheckout(beginEvents, duplicateWindowSeconds);
  const ghostSessions = detectGhostSessions(rows, ghostSessionLimit);
  const ghostOrderData = getGhostOrders(normalizedStore, range, purchaseEvents, beginEvents, options);
  const ordersMatched = Math.max(0, ghostOrderData.totalOrders - ghostOrderData.ghostOrders.length);

  return {
    store: normalizedStore,
    range,
    summary: {
      sampled_events: rows.length,
      sampled_sessions: identitySet.size,
      begin_checkout_events: beginEvents.length,
      purchase_events: purchaseEvents.length,
      duplicate_begin_checkout_events: duplicateDiagnostics.duplicateEventCount,
      duplicate_begin_checkout_rate: beginEvents.length
        ? duplicateDiagnostics.duplicateEventCount / beginEvents.length
        : 0,
      ghost_sessions_without_purchase: ghostSessions.length,
      shopify_orders_in_range: ghostOrderData.totalOrders,
      orders_with_blackbox_purchase: ordersMatched,
      ghost_orders_without_blackbox_purchase: ghostOrderData.ghostOrders.length
    },
    duplicates: {
      window_seconds: duplicateWindowSeconds,
      top_buttons: duplicateDiagnostics.topButtons,
      groups: duplicateDiagnostics.duplicateGroups.slice(0, 50)
    },
    ghost_sessions: ghostSessions,
    ghost_orders: ghostOrderData.ghostOrders
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
