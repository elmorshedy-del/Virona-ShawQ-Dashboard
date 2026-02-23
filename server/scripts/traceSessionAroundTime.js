import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_STORE = 'shawq';
const DEFAULT_CHECKOUT_LOOKBACK_MINUTES = 20;
const DEFAULT_ATC_LOOKBACK_MINUTES = 10;
const DEFAULT_FOLLOW_UP_MINUTES = 30;
const DEFAULT_SESSION_CONTEXT_LOOKBACK_MINUTES = 120;
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_API_FETCH_LIMIT = 10000;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const SQLITE_DATE_TIME_SLICE = 19;
const SQLITE_DATE_TIME_SEPARATOR_RE = /T/;

const CHECKOUT_EVENT_NAMES = [
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed',
  'purchase'
];

const ATC_EVENT_NAMES = [
  'product_added_to_cart',
  'add_to_cart',
  'added_to_cart',
  'cart_add',
  'atc',
  'si_atc_success'
];

const CHECKOUT_EVENT_PRIORITY = {
  checkout_completed: 70,
  purchase: 70,
  payment_info_submitted: 60,
  checkout_shipping_info_submitted: 50,
  checkout_address_info_submitted: 45,
  checkout_contact_info_submitted: 40,
  checkout_started: 30
};

const ATC_EVENT_PRIORITY = {
  product_added_to_cart: 25,
  add_to_cart: 25,
  added_to_cart: 25,
  cart_add: 25,
  atc: 25,
  si_atc_success: 25
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATABASE_PATH = path.join(__dirname, '../../data/dashboard.db');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function printUsageAndExit(code = 0) {
  console.log(`
Trace Session Around Shopify Order Moment

Usage:
  node server/scripts/traceSessionAroundTime.js \\
    --store shawq \\
    --local-date 2026-02-23 \\
    --local-time 18:20 \\
    --utc-offset +03:00 \\
    [--api-base https://virona-shawq-dashboard-production-7573.up.railway.app] \\
    [--country FR] \\
    [--order-id 7270224167210] \\
    [--checkout-lookback-min 20] \\
    [--atc-lookback-min 10] \\
    [--follow-up-min 30] \\
    [--max-results 8] \\
    [--api-limit 10000] \\
    [--database /absolute/path/dashboard.db] \\
    [--json]

Notes:
- Time input is interpreted as local time at --utc-offset and normalized to UTC.
- Script checks checkout events right before target time. If none found, it checks ATC events in the prior window.
- Optional --order-id enriches with shopify_orders/shopify_order_items context (country, amount, products) when available.
- If --api-base is provided, the script fetches day events from the Session Intelligence API instead of local SQLite.
`);
  process.exit(code);
}

function parseInteger(value, fallback, minValue = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (minValue != null && parsed < minValue) return fallback;
  return parsed;
}

function parseUtcOffset(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid --utc-offset "${raw}". Expected format like +03:00 or -0500.`);
  }
  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3], 10);
  if (hours > 14 || minutes > 59) {
    throw new Error(`Invalid --utc-offset "${raw}". Hour/minute out of range.`);
  }
  return sign * (hours * 60 + minutes);
}

function parseLocalMomentToUtcMs(localDate, localTime, utcOffset) {
  const date = String(localDate || '').trim();
  const time = String(localTime || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --local-date "${date}". Expected YYYY-MM-DD.`);
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
    throw new Error(`Invalid --local-time "${time}". Expected HH:MM or HH:MM:SS.`);
  }
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  const iso = `${date}T${normalizedTime}${utcOffset}`;
  const utcMs = Date.parse(iso);
  if (!Number.isFinite(utcMs)) {
    throw new Error(`Failed to parse local datetime "${iso}".`);
  }
  return utcMs;
}

function toSqliteUtcDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, SQLITE_DATE_TIME_SLICE).replace(SQLITE_DATE_TIME_SEPARATOR_RE, ' ');
}

function parseSqliteUtcToMs(value) {
  if (!value) return Number.NaN;
  const raw = String(value).trim();
  if (!raw) return Number.NaN;
  const hasTimezone = raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw);
  const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}${hasTimezone ? '' : 'Z'}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function toIsoUtc(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function tableExists(db, tableName) {
  const row = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `)
    .get(tableName);
  return Boolean(row?.name);
}

function getTableColumnSet(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(rows.map((row) => row?.name).filter(Boolean));
}

function buildSafeColumnSelect(columnSet, columns) {
  return columns
    .map((column) => (columnSet.has(column) ? column : `NULL AS ${column}`))
    .join(',\n      ');
}

function buildInClause(count) {
  return new Array(Math.max(0, count)).fill('?').join(', ');
}

function queryEventsFromDb({
  db,
  store,
  eventNames,
  startUtc,
  endUtc,
  countryCode = null,
  maxRows = 1000
}) {
  const safeMaxRows = Math.max(1, parseInteger(maxRows, 1000, 1));
  const names = Array.isArray(eventNames) ? eventNames.filter(Boolean) : [];
  if (!names.length) return [];
  const eventColumns = getTableColumnSet(db, 'si_events');
  const selectColumns = [
    'id',
    'store',
    'session_id',
    'session_number',
    'source',
    'event_name',
    'event_ts',
    'page_url',
    'page_path',
    'checkout_token',
    'checkout_step',
    'device_type',
    'device_os',
    'country_code',
    'product_id',
    'variant_id',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'created_at',
    'codename'
  ];

  const where = [
    'store = ?',
    'event_ts >= ?',
    'event_ts <= ?',
    `event_name IN (${buildInClause(names.length)})`
  ];
  const params = [store, startUtc, endUtc, ...names];

  if (countryCode) {
    where.push('country_code = ?');
    params.push(countryCode);
  }

  const sql = `
    SELECT
      ${buildSafeColumnSelect(eventColumns, selectColumns)}
    FROM si_events
    WHERE ${where.join('\n      AND ')}
    ORDER BY event_ts DESC
    LIMIT ${safeMaxRows}
  `;

  return db.prepare(sql).all(...params);
}

function queryEventsFromRows({
  events,
  store,
  eventNames,
  startUtc,
  endUtc,
  countryCode = null,
  maxRows = 1000
}) {
  const safeMaxRows = Math.max(1, parseInteger(maxRows, 1000, 1));
  const names = new Set((Array.isArray(eventNames) ? eventNames : []).filter(Boolean));
  if (!names.size) return [];

  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      if (!event || event.store !== store) return false;
      if (!names.has(event.event_name)) return false;
      if (!event.event_ts || event.event_ts < startUtc || event.event_ts > endUtc) return false;
      if (countryCode && event.country_code !== countryCode) return false;
      return true;
    })
    .sort((a, b) => String(b.event_ts || '').localeCompare(String(a.event_ts || '')))
    .slice(0, safeMaxRows);
}

function ensureTrailingSlashlessBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function fetchJson(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} from ${url}: ${body.slice(0, 160)}`);
  }
  const payload = await response.json();
  if (!payload?.success) {
    throw new Error(payload?.error || `API call failed: ${url}`);
  }
  return payload;
}

async function loadEventsFromApiDay({ apiBase, store, date, limit }) {
  const safeBase = ensureTrailingSlashlessBase(apiBase);
  const safeLimit = Math.max(1, parseInteger(limit, DEFAULT_API_FETCH_LIMIT, 1));
  const params = new URLSearchParams({
    store,
    date,
    limit: String(safeLimit)
  });
  const url = `${safeBase}/api/session-intelligence/events-by-day?${params.toString()}`;
  const payload = await fetchJson(url);
  return Array.isArray(payload?.events) ? payload.events : [];
}

function buildSessionCandidates(events, targetUtcMs, priorityMap, preferredCountryCode = null) {
  const buckets = new Map();

  for (const event of events) {
    const sessionId = String(event?.session_id || '').trim();
    if (!sessionId) continue;

    const eventMs = parseSqliteUtcToMs(event.event_ts);
    if (!Number.isFinite(eventMs)) continue;

    const bucket = buckets.get(sessionId) || {
      sessionId,
      codename: event.codename || null,
      sessionNumber: event.session_number ?? null,
      countryCode: event.country_code || null,
      deviceType: event.device_type || null,
      deviceOs: event.device_os || null,
      source: event.source || null,
      checkoutToken: event.checkout_token || null,
      checkoutStep: event.checkout_step || null,
      utmSource: event.utm_source || null,
      utmMedium: event.utm_medium || null,
      utmCampaign: event.utm_campaign || null,
      firstEventAt: event.event_ts,
      latestEventAt: event.event_ts,
      latestEventName: event.event_name,
      latestPagePath: event.page_path || null,
      eventNames: new Set(),
      count: 0,
      closestDeltaSeconds: Number.POSITIVE_INFINITY,
      score: 0
    };

    bucket.count += 1;
    bucket.eventNames.add(event.event_name);

    const priority = priorityMap[event.event_name] || 0;
    bucket.score += priority;

    if (event.event_ts < bucket.firstEventAt) bucket.firstEventAt = event.event_ts;
    if (event.event_ts > bucket.latestEventAt) {
      bucket.latestEventAt = event.event_ts;
      bucket.latestEventName = event.event_name;
      bucket.latestPagePath = event.page_path || bucket.latestPagePath;
    }

    const deltaSeconds = Math.max(0, Math.round((targetUtcMs - eventMs) / 1000));
    if (deltaSeconds < bucket.closestDeltaSeconds) bucket.closestDeltaSeconds = deltaSeconds;
    if (preferredCountryCode && event.country_code === preferredCountryCode) bucket.score += 12;

    buckets.set(sessionId, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      eventNames: [...bucket.eventNames].sort()
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.closestDeltaSeconds !== b.closestDeltaSeconds) return a.closestDeltaSeconds - b.closestDeltaSeconds;
      if (b.count !== a.count) return b.count - a.count;
      return String(a.sessionId).localeCompare(String(b.sessionId));
    });
}

function loadSessionTimelineFromDb({
  db,
  store,
  sessionId,
  windowStartUtc,
  windowEndUtc
}) {
  const eventColumns = getTableColumnSet(db, 'si_events');
  const selectColumns = [
    'event_name',
    'event_ts',
    'page_path',
    'checkout_step',
    'source',
    'country_code',
    'product_id',
    'variant_id'
  ];
  const rows = db.prepare(`
    SELECT
      ${buildSafeColumnSelect(eventColumns, selectColumns)}
    FROM si_events
    WHERE store = ?
      AND session_id = ?
      AND event_ts >= ?
      AND event_ts <= ?
    ORDER BY event_ts ASC
  `).all(store, sessionId, windowStartUtc, windowEndUtc);

  return rows;
}

function loadSessionTimelineFromRows({
  events,
  store,
  sessionId,
  windowStartUtc,
  windowEndUtc
}) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => (
      event &&
      event.store === store &&
      event.session_id === sessionId &&
      event.event_ts &&
      event.event_ts >= windowStartUtc &&
      event.event_ts <= windowEndUtc
    ))
    .map((event) => ({
      event_name: event.event_name,
      event_ts: event.event_ts,
      page_path: event.page_path || null,
      checkout_step: event.checkout_step || null,
      source: event.source || null,
      country_code: event.country_code || null,
      product_id: event.product_id || null,
      variant_id: event.variant_id || null
    }))
    .sort((a, b) => String(a.event_ts || '').localeCompare(String(b.event_ts || '')));
}

function summarizeTimeline(rows, targetUtcMs) {
  if (!rows.length) {
    return {
      lastBeforeTarget: null,
      firstAfterTarget: null,
      disappearPoint: null
    };
  }

  let lastBeforeTarget = null;
  let firstAfterTarget = null;

  for (const row of rows) {
    const eventMs = parseSqliteUtcToMs(row.event_ts);
    if (!Number.isFinite(eventMs)) continue;
    if (eventMs <= targetUtcMs) {
      lastBeforeTarget = row;
      continue;
    }
    if (!firstAfterTarget) firstAfterTarget = row;
  }

  const disappearPoint = lastBeforeTarget
    ? {
      eventName: lastBeforeTarget.event_name,
      eventTs: lastBeforeTarget.event_ts,
      pagePath: lastBeforeTarget.page_path || null,
      checkoutStep: lastBeforeTarget.checkout_step || null
    }
    : null;

  return { lastBeforeTarget, firstAfterTarget, disappearPoint };
}

function loadOrderContext(db, store, orderId) {
  if (!orderId) return null;
  if (!tableExists(db, 'shopify_orders')) return null;
  const orderColumns = getTableColumnSet(db, 'shopify_orders');
  const orderSelectColumns = [
    'order_id',
    'order_created_at',
    'date',
    'country',
    'country_code',
    'order_total',
    'subtotal',
    'shipping',
    'tax',
    'discount',
    'currency',
    'customer_email'
  ];

  const order = db.prepare(`
    SELECT
      ${buildSafeColumnSelect(orderColumns, orderSelectColumns)}
    FROM shopify_orders
    WHERE store = ?
      AND order_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(store, String(orderId));

  if (!order) return null;

  const context = {
    ...order,
    items: []
  };

  if (tableExists(db, 'shopify_order_items')) {
    const orderItemColumns = getTableColumnSet(db, 'shopify_order_items');
    const orderItemSelectColumns = [
      'title',
      'sku',
      'quantity',
      'price',
      'discount',
      'net_price'
    ];
    context.items = db.prepare(`
      SELECT
        ${buildSafeColumnSelect(orderItemColumns, orderItemSelectColumns)}
      FROM shopify_order_items
      WHERE store = ?
        AND order_id = ?
      ORDER BY id ASC
    `).all(store, String(orderId));
  }

  return context;
}

function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  return raw;
}

function buildOutputLine(label, value) {
  return `${label.padEnd(24, ' ')} ${value}`;
}

function printCandidateBlock(rank, candidate, timelineSummary) {
  console.log(`\n#${rank}  ${candidate.codename || candidate.sessionId}`);
  console.log(buildOutputLine('Session ID', candidate.sessionId));
  console.log(buildOutputLine('Session number', candidate.sessionNumber ?? '—'));
  console.log(buildOutputLine('Country', candidate.countryCode || '—'));
  console.log(buildOutputLine('Device', `${candidate.deviceType || '—'} / ${candidate.deviceOs || '—'}`));
  console.log(buildOutputLine('Source', candidate.source || '—'));
  console.log(buildOutputLine('UTM', `${candidate.utmSource || '—'} / ${candidate.utmMedium || '—'} / ${candidate.utmCampaign || '—'}`));
  console.log(buildOutputLine('Closest delta', `${candidate.closestDeltaSeconds}s before target`));
  console.log(buildOutputLine('Latest event', `${candidate.latestEventName} @ ${candidate.latestEventAt}`));
  console.log(buildOutputLine('Latest path', candidate.latestPagePath || '—'));
  console.log(buildOutputLine('Event set', candidate.eventNames.join(', ')));

  if (timelineSummary.disappearPoint) {
    console.log(buildOutputLine(
      'Disappear point',
      `${timelineSummary.disappearPoint.eventName} @ ${timelineSummary.disappearPoint.eventTs}`
    ));
  } else {
    console.log(buildOutputLine('Disappear point', 'No event before target in context window'));
  }

  if (timelineSummary.firstAfterTarget) {
    console.log(buildOutputLine(
      'First event after target',
      `${timelineSummary.firstAfterTarget.event_name} @ ${timelineSummary.firstAfterTarget.event_ts}`
    ));
  } else {
    console.log(buildOutputLine('First event after target', 'None in follow-up window'));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) printUsageAndExit(0);

  const store = String(args.store || DEFAULT_STORE).trim();
  const apiBase = args['api-base'] ? ensureTrailingSlashlessBase(args['api-base']) : null;
  const apiLimit = parseInteger(args['api-limit'], DEFAULT_API_FETCH_LIMIT, 1);
  const localDate = args['local-date'];
  const localTime = args['local-time'];
  const utcOffset = args['utc-offset'];
  const checkoutLookbackMin = parseInteger(args['checkout-lookback-min'], DEFAULT_CHECKOUT_LOOKBACK_MINUTES, 1);
  const atcLookbackMin = parseInteger(args['atc-lookback-min'], DEFAULT_ATC_LOOKBACK_MINUTES, 1);
  const followUpMin = parseInteger(args['follow-up-min'], DEFAULT_FOLLOW_UP_MINUTES, 1);
  const maxResults = parseInteger(args['max-results'], DEFAULT_MAX_RESULTS, 1);
  const sessionContextLookbackMin = parseInteger(
    args['session-context-lookback-min'],
    DEFAULT_SESSION_CONTEXT_LOOKBACK_MINUTES,
    1
  );
  const orderId = args['order-id'] ? String(args['order-id']).trim() : null;
  const countryCodeFilter = normalizeCountryCode(args.country || null);

  if (!localDate || !localTime || !utcOffset) {
    console.error('Missing required args. You must pass --local-date, --local-time, and --utc-offset.');
    printUsageAndExit(1);
  }

  const utcOffsetMinutes = parseUtcOffset(utcOffset);
  const targetUtcMs = parseLocalMomentToUtcMs(localDate, localTime, utcOffset);

  const checkoutWindowStartUtcMs = targetUtcMs - (checkoutLookbackMin * MILLISECONDS_PER_MINUTE);
  const atcWindowStartUtcMs = targetUtcMs - (atcLookbackMin * MILLISECONDS_PER_MINUTE);
  const sessionContextStartUtcMs = targetUtcMs - (sessionContextLookbackMin * MILLISECONDS_PER_MINUTE);
  const sessionContextEndUtcMs = targetUtcMs + (followUpMin * MILLISECONDS_PER_MINUTE);

  const checkoutWindowStartUtc = toSqliteUtcDateTime(checkoutWindowStartUtcMs);
  const atcWindowStartUtc = toSqliteUtcDateTime(atcWindowStartUtcMs);
  const targetUtc = toSqliteUtcDateTime(targetUtcMs);
  const sessionContextStartUtc = toSqliteUtcDateTime(sessionContextStartUtcMs);
  const sessionContextEndUtc = toSqliteUtcDateTime(sessionContextEndUtcMs);

  let db = null;
  let databasePath = null;
  let apiEvents = [];

  if (apiBase) {
    apiEvents = await loadEventsFromApiDay({
      apiBase,
      store,
      date: localDate,
      limit: apiLimit
    });
  } else {
    databasePath = path.resolve(String(args.database || process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH));
    if (!fs.existsSync(databasePath)) {
      throw new Error(`Database file not found: ${databasePath}`);
    }
    const sqliteModule = await import('better-sqlite3');
    const BetterSqlite = sqliteModule.default;
    db = new BetterSqlite(databasePath, { readonly: true });
    if (!tableExists(db, 'si_events')) {
      throw new Error('si_events table not found in the selected database.');
    }
  }

  try {
    const orderContext = db ? loadOrderContext(db, store, orderId) : null;
    const effectiveCountryCode = orderContext?.country_code || countryCodeFilter || null;

    const checkoutEvents = db ? queryEventsFromDb({
      db,
      store,
      eventNames: CHECKOUT_EVENT_NAMES,
      startUtc: checkoutWindowStartUtc,
      endUtc: targetUtc,
      countryCode: effectiveCountryCode,
      maxRows: Math.max(maxResults * 30, 300)
    }) : queryEventsFromRows({
      events: apiEvents,
      store,
      eventNames: CHECKOUT_EVENT_NAMES,
      startUtc: checkoutWindowStartUtc,
      endUtc: targetUtc,
      countryCode: effectiveCountryCode,
      maxRows: Math.max(maxResults * 30, 300)
    });

    let searchPhase = 'checkout';
    let rawCandidateEvents = checkoutEvents;
    let candidates = buildSessionCandidates(
      checkoutEvents,
      targetUtcMs,
      CHECKOUT_EVENT_PRIORITY,
      effectiveCountryCode
    );

    if (!candidates.length) {
      const atcEvents = db ? queryEventsFromDb({
        db,
        store,
        eventNames: ATC_EVENT_NAMES,
        startUtc: atcWindowStartUtc,
        endUtc: targetUtc,
        countryCode: effectiveCountryCode,
        maxRows: Math.max(maxResults * 20, 200)
      }) : queryEventsFromRows({
        events: apiEvents,
        store,
        eventNames: ATC_EVENT_NAMES,
        startUtc: atcWindowStartUtc,
        endUtc: targetUtc,
        countryCode: effectiveCountryCode,
        maxRows: Math.max(maxResults * 20, 200)
      });
      searchPhase = 'atc_fallback';
      rawCandidateEvents = atcEvents;
      candidates = buildSessionCandidates(atcEvents, targetUtcMs, ATC_EVENT_PRIORITY, effectiveCountryCode);
    }

    const topCandidates = candidates.slice(0, maxResults);
    const enrichedCandidates = topCandidates.map((candidate) => {
      const timelineRows = db ? loadSessionTimelineFromDb({
        db,
        store,
        sessionId: candidate.sessionId,
        windowStartUtc: sessionContextStartUtc,
        windowEndUtc: sessionContextEndUtc
      }) : loadSessionTimelineFromRows({
        events: apiEvents,
        store,
        sessionId: candidate.sessionId,
        windowStartUtc: sessionContextStartUtc,
        windowEndUtc: sessionContextEndUtc
      });
      const timelineSummary = summarizeTimeline(timelineRows, targetUtcMs);
      return {
        ...candidate,
        timelineSummary
      };
    });

    const output = {
      store,
      dataSource: apiBase ? 'api' : 'sqlite',
      apiBase: apiBase || null,
      databasePath,
      localInput: {
        date: localDate,
        time: localTime,
        utcOffset,
        utcOffsetMinutes
      },
      normalizedUtc: toIsoUtc(targetUtcMs),
      windows: {
        checkoutLookbackMinutes: checkoutLookbackMin,
        atcLookbackMinutes: atcLookbackMin,
        followUpMinutes: followUpMin,
        checkoutStartUtc: toIsoUtc(checkoutWindowStartUtcMs),
        atcStartUtc: toIsoUtc(atcWindowStartUtcMs),
        targetUtc: toIsoUtc(targetUtcMs),
        contextStartUtc: toIsoUtc(sessionContextStartUtcMs),
        contextEndUtc: toIsoUtc(sessionContextEndUtcMs)
      },
      orderContext: orderContext || null,
      filter: {
        countryCode: effectiveCountryCode
      },
      searchPhase,
      rawCandidateEventCount: rawCandidateEvents.length,
      candidateCount: candidates.length,
      candidates: enrichedCandidates.map((candidate) => ({
        sessionId: candidate.sessionId,
        codename: candidate.codename,
        sessionNumber: candidate.sessionNumber,
        countryCode: candidate.countryCode,
        deviceType: candidate.deviceType,
        deviceOs: candidate.deviceOs,
        source: candidate.source,
        utmSource: candidate.utmSource,
        utmMedium: candidate.utmMedium,
        utmCampaign: candidate.utmCampaign,
        latestEventName: candidate.latestEventName,
        latestEventAt: candidate.latestEventAt,
        latestPagePath: candidate.latestPagePath,
        closestDeltaSeconds: candidate.closestDeltaSeconds,
        count: candidate.count,
        score: candidate.score,
        eventNames: candidate.eventNames,
        timelineSummary: candidate.timelineSummary
      }))
    };

    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log('\n=== Session Trace Around Order Moment ===');
    console.log(buildOutputLine('Store', store));
    console.log(buildOutputLine('Data source', apiBase ? `API ${apiBase}` : `SQLite ${databasePath}`));
    console.log(buildOutputLine('Local input', `${localDate} ${localTime} (${utcOffset})`));
    console.log(buildOutputLine('Normalized UTC', toIsoUtc(targetUtcMs)));
    console.log(buildOutputLine('Checkout window start', toIsoUtc(checkoutWindowStartUtcMs)));
    console.log(buildOutputLine('ATC window start', toIsoUtc(atcWindowStartUtcMs)));
    console.log(buildOutputLine('Country filter', effectiveCountryCode || 'none'));
    console.log(buildOutputLine('Search phase', searchPhase === 'checkout' ? 'Checkout events' : 'ATC fallback'));
    console.log(buildOutputLine('Raw candidate events', String(rawCandidateEvents.length)));
    console.log(buildOutputLine('Session candidates', String(candidates.length)));

    if (orderContext) {
      console.log('\nOrder context (matched):');
      console.log(buildOutputLine('Order ID', orderContext.order_id || '—'));
      console.log(buildOutputLine('Order created at', orderContext.order_created_at || orderContext.date || '—'));
      console.log(buildOutputLine('Order country', orderContext.country_code || orderContext.country || '—'));
      console.log(buildOutputLine('Order total', `${orderContext.order_total ?? '—'} ${orderContext.currency || ''}`.trim()));
      console.log(buildOutputLine('Customer email', orderContext.customer_email || '—'));
      if (orderContext.items?.length) {
        console.log(buildOutputLine('Items', String(orderContext.items.length)));
        for (const item of orderContext.items) {
          const label = `${item.title || 'Unknown item'} x${item.quantity ?? 1}`;
          const value = `${item.net_price ?? item.price ?? '—'} ${orderContext.currency || ''}`.trim();
          console.log(`  - ${label} (${value})`);
        }
      }
    } else if (orderId && db) {
      console.log(`\nOrder context: order_id ${orderId} not found in shopify_orders.`);
    } else if (orderId && !db) {
      console.log('\nOrder context: unavailable in API mode (pass --database for local order enrichment).');
    }

    if (!enrichedCandidates.length) {
      console.log('\nNo matching sessions found in the requested windows.');
      return;
    }

    console.log('\nTop candidate sessions:');
    enrichedCandidates.forEach((candidate, index) => {
      printCandidateBlock(index + 1, candidate, candidate.timelineSummary);
    });
  } finally {
    if (db) db.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`ERROR: ${error?.message || error}`);
  process.exit(1);
}
