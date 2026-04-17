import { createHash } from 'crypto';
import { getDb } from '../db/database.js';
import { buildPuppeteerLaunchOptions } from '../utils/puppeteerLaunchOptions.js';

export const ISSUE_LIFECYCLE_STATES = Object.freeze({
  OBSERVED: 'observed',
  INVESTIGATING: 'investigating',
  CONFIRMED: 'confirmed',
  FALSE_ALERT: 'false_alert'
});

const ISSUE_TYPES = Object.freeze([
  'rage_clicks',
  'dead_clicks',
  'js_errors',
  'form_invalid',
  'scroll_dropoff'
]);

const AUTO_VERIFIABLE_ISSUE_TYPES = Object.freeze([
  'rage_clicks',
  'dead_clicks',
  'js_errors'
]);

const LIFECYCLE_LOCKED_STATES = new Set([
  ISSUE_LIFECYCLE_STATES.CONFIRMED,
  ISSUE_LIFECYCLE_STATES.FALSE_ALERT
]);

const MAX_SIGNATURE_LENGTH = 220;
const MAX_NORMALIZED_PAGE_LENGTH = 180;
const MAX_SAMPLE_SESSION_ROWS = 8;
const DEFAULT_STORE_KEY = 'default_store';
const DEFAULT_ISSUE_MODE = 'high_intent_no_purchase';

const INVESTIGATION_QUEUE_LIMIT_DEFAULT = clampInteger(
  process.env.SI_INVESTIGATION_QUEUE_LIMIT,
  24,
  1,
  200
);
const INVESTIGATION_JOB_RUN_LIMIT_DEFAULT = clampInteger(
  process.env.SI_INVESTIGATION_JOB_RUN_LIMIT,
  8,
  1,
  200
);

const INVESTIGATION_CONFIRM_RULES = Object.freeze({
  minSessions: clampInteger(process.env.SI_INVESTIGATION_CONFIRM_MIN_SESSIONS, 3, 1, 2000),
  minEvents: clampInteger(process.env.SI_INVESTIGATION_CONFIRM_MIN_EVENTS, 6, 1, 20000),
  minPresenceDays: clampInteger(process.env.SI_INVESTIGATION_CONFIRM_MIN_PRESENCE_DAYS, 2, 1, 30),
  minCumulativeSessions: clampInteger(process.env.SI_INVESTIGATION_CONFIRM_MIN_CUMULATIVE_SESSIONS, 5, 1, 5000)
});

const INVESTIGATION_FALSE_ALERT_RULES = Object.freeze({
  maxPresenceDays: clampInteger(process.env.SI_INVESTIGATION_FALSE_MAX_PRESENCE_DAYS, 1, 1, 30),
  maxSessions: clampInteger(process.env.SI_INVESTIGATION_FALSE_MAX_SESSIONS, 2, 0, 2000),
  maxEvents: clampInteger(process.env.SI_INVESTIGATION_FALSE_MAX_EVENTS, 3, 0, 20000)
});

const BROWSER_PROBE_CONFIG = Object.freeze({
  enabled: safeString(process.env.SI_INVESTIGATION_BROWSER_PROBE_ENABLED).trim().toLowerCase() === 'true',
  navigationTimeoutMs: clampInteger(process.env.SI_INVESTIGATION_BROWSER_NAV_TIMEOUT_MS, 20000, 3000, 120000),
  navigationAttempts: clampInteger(process.env.SI_INVESTIGATION_BROWSER_NAV_ATTEMPTS, 2, 1, 5),
  postLoadWaitMs: clampInteger(process.env.SI_INVESTIGATION_BROWSER_POST_LOAD_WAIT_MS, 1200, 0, 10000),
  clickSettleWaitMs: clampInteger(process.env.SI_INVESTIGATION_BROWSER_CLICK_SETTLE_MS, 1500, 250, 10000),
  clickAttempts: clampInteger(process.env.SI_INVESTIGATION_BROWSER_CLICK_ATTEMPTS, 3, 1, 10),
  deadClickConfirmRatio: clampFloat(process.env.SI_INVESTIGATION_BROWSER_DEAD_CLICK_CONFIRM_RATIO, 0.67, 0.34, 1),
  mutationThreshold: clampInteger(process.env.SI_INVESTIGATION_BROWSER_MUTATION_THRESHOLD, 1, 0, 100),
  allowNoSandbox: safeString(process.env.SI_INVESTIGATION_BROWSER_ALLOW_NO_SANDBOX).trim().toLowerCase() === 'true',
  allowPrivateNetworkTargets: safeString(process.env.SI_INVESTIGATION_BROWSER_ALLOW_PRIVATE_NETWORK_TARGETS).trim().toLowerCase() === 'true'
});

const BROWSER_PROBE_STORE_BASE_URLS_ENV = 'SI_INVESTIGATION_BROWSER_STORE_BASE_URLS';
const BROWSER_PROBE_DEFAULT_BASE_URL_ENV = 'SI_INVESTIGATION_BROWSER_DEFAULT_BASE_URL';
const BROWSER_PROBE_METHOD = 'browser_probe_v1';
const SIGNAL_HISTORY_METHOD = 'signal_history_v1';

let parsedBrowserProbeStoreBaseUrls = null;

const LIFECYCLE_POLICY = Object.freeze({
  minSessionsForInvestigating: clampInteger(process.env.SI_INVESTIGATION_MIN_SESSIONS, 3, 1, 500),
  minEventsForInvestigating: clampInteger(process.env.SI_INVESTIGATION_MIN_EVENTS, 5, 1, 10000),
  lookbackDays: clampInteger(process.env.SI_INVESTIGATION_LOOKBACK_DAYS, 3, 1, 60),
  minPresenceDaysForInvestigating: clampInteger(process.env.SI_INVESTIGATION_MIN_PRESENCE_DAYS, 2, 1, 30)
});

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampFloat(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizeStore(store) {
  const normalized = safeString(store).trim();
  return normalized || DEFAULT_STORE_KEY;
}

function normalizeMode(mode) {
  const normalized = safeString(mode).trim();
  return normalized || DEFAULT_ISSUE_MODE;
}

function isPrivateOrLocalHostname(hostname) {
  const host = safeString(hostname).toLowerCase().trim();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '[::1]' || host === '0.0.0.0') return true;

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((part) => Number(part));
    if (octets.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) return true;
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  const ipv6 = host.replace(/^\[/, '').replace(/\]$/, '');
  if (ipv6.includes(':')) {
    if (ipv6 === '::1' || ipv6.startsWith('fe80:') || ipv6.startsWith('fc') || ipv6.startsWith('fd')) return true;
  }

  return false;
}

function normalizeBaseUrl(value) {
  const raw = safeString(value).trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (!BROWSER_PROBE_CONFIG.allowPrivateNetworkTargets && isPrivateOrLocalHostname(parsed.hostname)) return '';
    return `${parsed.origin}/`;
  } catch (_error) {
    return '';
  }
}

function parseBrowserProbeStoreBaseUrlMap() {
  if (parsedBrowserProbeStoreBaseUrls) return parsedBrowserProbeStoreBaseUrls;

  const parsed = safeJsonParse(process.env[BROWSER_PROBE_STORE_BASE_URLS_ENV]);
  const map = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [storeKey, baseUrl] of Object.entries(parsed)) {
      const normalizedStore = normalizeStore(storeKey).toLowerCase();
      const normalizedBase = normalizeBaseUrl(baseUrl);
      if (!normalizedStore || !normalizedBase) continue;
      map[normalizedStore] = normalizedBase;
    }
  }
  parsedBrowserProbeStoreBaseUrls = map;
  return parsedBrowserProbeStoreBaseUrls;
}

function normalizeRelativeProbePath(value) {
  const normalized = normalizePath(value);
  if (!normalized || normalized === '/') return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function resolveIssueProbeUrl(store, normalizedPage) {
  const storeMap = parseBrowserProbeStoreBaseUrlMap();
  const storeKey = normalizeStore(store).toLowerCase();
  const configuredBaseUrl = storeMap[storeKey] || normalizeBaseUrl(process.env[BROWSER_PROBE_DEFAULT_BASE_URL_ENV]);
  if (!configuredBaseUrl) return null;

  try {
    const base = new URL(configuredBaseUrl);
    const resolved = new URL(normalizeRelativeProbePath(normalizedPage), base);
    if (resolved.origin !== base.origin) return null;
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    if (!BROWSER_PROBE_CONFIG.allowPrivateNetworkTargets && isPrivateOrLocalHostname(resolved.hostname)) return null;
    return resolved.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeBrowserProbeErrorSignature(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[0-9]+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

async function loadPuppeteer() {
  try {
    const mod = await import('puppeteer');
    return mod?.default || mod;
  } catch (_error) {
    return null;
  }
}

async function launchBrowserProbe(puppeteer) {
  try {
    return await puppeteer.launch(buildPuppeteerLaunchOptions());
  } catch (launchError) {
    if (!BROWSER_PROBE_CONFIG.allowNoSandbox) throw launchError;
    return puppeteer.launch(buildPuppeteerLaunchOptions({
      includeNoSandboxArgs: true
    }));
  }
}

function sleep(ms) {
  const waitMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function normalizeSqliteDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  return safe.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function requireIsoDate(value) {
  const raw = safeString(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function shiftIsoDate(isoDate, deltaDays) {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return isoDate;
  const next = new Date(parsed + deltaDays * 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10);
}

function normalizePath(rawPath) {
  const path = safeString(rawPath).trim();
  if (!path) return '/';
  const noQuery = path.split('?')[0].split('#')[0].trim();
  if (!noQuery || noQuery === '/') return '/';
  const normalized = noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
  return normalized.slice(0, MAX_NORMALIZED_PAGE_LENGTH);
}

function normalizeErrorSignature(rawMessage) {
  const text = safeString(rawMessage).toLowerCase();
  if (!text) return 'unknown_runtime_error';
  return text
    .replace(/https?:\/\/\S+/g, '{url}')
    .replace(/\b\d{2,}\b/g, '{n}')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SIGNATURE_LENGTH);
}

function normalizeTargetSignature(rawTarget) {
  const text = safeString(rawTarget).toLowerCase();
  if (!text) return 'unknown_target';
  return text
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SIGNATURE_LENGTH);
}

function normalizeFormSignature(fieldType, fieldName) {
  const typePart = safeString(fieldType).toLowerCase().trim();
  const namePart = safeString(fieldName).toLowerCase().trim();
  const merged = [typePart, namePart].filter(Boolean).join(':');
  return (merged || 'generic_form_validation').slice(0, MAX_SIGNATURE_LENGTH);
}

function normalizeScrollSignature(entry) {
  const page = normalizePath(entry?.page);
  const totalSessions = Math.max(0, Number(entry?.total_sessions) || 0);
  const reached75 = Math.max(0, Number(entry?.reached_75) || 0);
  const missed75 = Math.max(0, totalSessions - reached75);
  return `scroll_depth_under_75:${page}:${missed75}`.slice(0, MAX_SIGNATURE_LENGTH);
}

function stableIssueKey(issueType, normalizedPage, normalizedSignature) {
  const seed = `${issueType}||${normalizedPage}||${normalizedSignature}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 32);
}

function normalizeSampleSessions(rawSample) {
  if (!Array.isArray(rawSample)) return '[]';
  const trimmed = rawSample
    .filter(Boolean)
    .slice(0, MAX_SAMPLE_SESSION_ROWS)
    .map((row) => ({
      session_id: safeString(row?.session_id).trim() || null,
      codename: safeString(row?.codename).trim() || null,
      last_seen: safeString(row?.last_seen).trim() || null
    }));
  return JSON.stringify(trimmed);
}

function toClusterRowsFromSignals(signals) {
  const rows = [];
  const signalMap = signals && typeof signals === 'object' ? signals : {};

  for (const issueType of ISSUE_TYPES) {
    const list = Array.isArray(signalMap[issueType]) ? signalMap[issueType] : [];
    list.forEach((entry) => {
      const page = normalizePath(entry?.page);

      let normalizedSignature = 'unknown_signature';
      let sessionsAffected = Math.max(0, Number(entry?.sessions) || 0);
      let eventsCount = Math.max(0, Number(entry?.count) || 0);

      if (issueType === 'js_errors') {
        normalizedSignature = normalizeErrorSignature(entry?.message);
      } else if (issueType === 'form_invalid') {
        normalizedSignature = normalizeFormSignature(entry?.field_type, entry?.field_name);
      } else if (issueType === 'scroll_dropoff') {
        normalizedSignature = normalizeScrollSignature(entry);
        const totalSessions = Math.max(0, Number(entry?.total_sessions) || 0);
        const reached75 = Math.max(0, Number(entry?.reached_75) || 0);
        sessionsAffected = Math.max(0, totalSessions - reached75);
        eventsCount = sessionsAffected;
      } else {
        normalizedSignature = normalizeTargetSignature(entry?.target_key);
      }

      const issueKey = stableIssueKey(issueType, page, normalizedSignature);
      rows.push({
        issueKey,
        issueType,
        normalizedPage: page,
        normalizedSignature,
        sessionsAffected,
        eventsCount,
        highIntentRate: Number.isFinite(Number(entry?.high_intent_rate))
          ? Number(entry.high_intent_rate)
          : null,
        impactScore: Number.isFinite(Number(entry?.impact_score))
          ? Number(entry.impact_score)
          : null,
        sampleSessionsJson: normalizeSampleSessions(entry?.sample_sessions)
      });
    });
  }

  const deduped = new Map();
  for (const row of rows) {
    const existing = deduped.get(row.issueKey);
    if (!existing) {
      deduped.set(row.issueKey, row);
      continue;
    }
    existing.sessionsAffected = Math.max(existing.sessionsAffected, row.sessionsAffected);
    existing.eventsCount += row.eventsCount;
  }

  return Array.from(deduped.values());
}

function fetchExistingClustersByKey(db, store, issueKeys) {
  if (!issueKeys.length) return new Map();
  const placeholders = issueKeys.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT issue_key, lifecycle_state
    FROM si_issue_clusters
    WHERE store = ?
      AND issue_key IN (${placeholders})
  `).all(store, ...issueKeys);

  return new Map(rows.map((row) => [row.issue_key, row.lifecycle_state]));
}

function fetchLatestVerificationStatusByKey(db, store, issueKeys) {
  if (!issueKeys.length) return new Map();

  const placeholders = issueKeys.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT v.issue_key, v.status
    FROM si_issue_verifications v
    INNER JOIN (
      SELECT issue_key, MAX(COALESCE(verified_at, created_at)) AS latest_time
      FROM si_issue_verifications
      WHERE store = ?
        AND issue_key IN (${placeholders})
      GROUP BY issue_key
    ) latest
      ON latest.issue_key = v.issue_key
     AND COALESCE(v.verified_at, v.created_at) = latest.latest_time
    WHERE v.store = ?
      AND v.issue_key IN (${placeholders})
  `).all(store, ...issueKeys, store, ...issueKeys);

  return new Map(rows.map((row) => [row.issue_key, safeString(row.status).trim().toLowerCase()]));
}

function fetchRecentPresenceDaysByKey(db, store, mode, date, issueKeys) {
  if (!issueKeys.length) return new Map();

  const startDate = shiftIsoDate(date, -(LIFECYCLE_POLICY.lookbackDays - 1));
  const placeholders = issueKeys.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT issue_key, COUNT(DISTINCT date) AS day_count
    FROM si_issue_daily_stats
    WHERE store = ?
      AND mode = ?
      AND date >= ?
      AND date <= ?
      AND issue_key IN (${placeholders})
    GROUP BY issue_key
  `).all(store, mode, startDate, date, ...issueKeys);

  return new Map(rows.map((row) => [row.issue_key, Number(row.day_count) || 0]));
}

function shouldEscalateToInvestigating({ sessionsAffected, eventsCount, recentPresenceDays }) {
  return (
    sessionsAffected >= LIFECYCLE_POLICY.minSessionsForInvestigating
    || eventsCount >= LIFECYCLE_POLICY.minEventsForInvestigating
    || recentPresenceDays >= LIFECYCLE_POLICY.minPresenceDaysForInvestigating
  );
}

function resolveLifecycleState({ verificationStatus, previousState, sessionsAffected, eventsCount, recentPresenceDays }) {
  if (verificationStatus === ISSUE_LIFECYCLE_STATES.CONFIRMED) return ISSUE_LIFECYCLE_STATES.CONFIRMED;
  if (verificationStatus === ISSUE_LIFECYCLE_STATES.FALSE_ALERT) return ISSUE_LIFECYCLE_STATES.FALSE_ALERT;

  if (LIFECYCLE_LOCKED_STATES.has(previousState)) return previousState;

  if (shouldEscalateToInvestigating({ sessionsAffected, eventsCount, recentPresenceDays })) {
    return ISSUE_LIFECYCLE_STATES.INVESTIGATING;
  }

  return ISSUE_LIFECYCLE_STATES.OBSERVED;
}

function upsertClusterRow(db, row, context) {
  const now = context.now;
  const existingState = context.existingStateByKey.get(row.issueKey) || null;
  const verificationStatus = context.verificationStatusByKey.get(row.issueKey) || null;
  const recentPresenceDays = context.recentPresenceByKey.get(row.issueKey) || 0;

  const lifecycleState = resolveLifecycleState({
    verificationStatus,
    previousState: existingState,
    sessionsAffected: row.sessionsAffected,
    eventsCount: row.eventsCount,
    recentPresenceDays
  });

  db.prepare(`
    INSERT INTO si_issue_clusters (
      store,
      issue_key,
      issue_type,
      normalized_page,
      normalized_signature,
      first_seen_date,
      last_seen_date,
      first_seen_at,
      last_seen_at,
      lifecycle_state,
      lifecycle_updated_at,
      last_mode,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, issue_key) DO UPDATE SET
      issue_type = excluded.issue_type,
      normalized_page = excluded.normalized_page,
      normalized_signature = excluded.normalized_signature,
      last_seen_date = excluded.last_seen_date,
      last_seen_at = excluded.last_seen_at,
      lifecycle_state = excluded.lifecycle_state,
      lifecycle_updated_at = excluded.lifecycle_updated_at,
      last_mode = excluded.last_mode,
      updated_at = excluded.updated_at
  `).run(
    context.store,
    row.issueKey,
    row.issueType,
    row.normalizedPage,
    row.normalizedSignature,
    context.date,
    context.date,
    now,
    now,
    lifecycleState,
    now,
    context.mode,
    now
  );

  db.prepare(`
    INSERT INTO si_issue_daily_stats (
      store,
      date,
      mode,
      issue_key,
      issue_type,
      normalized_page,
      normalized_signature,
      sessions_affected,
      events_count,
      high_intent_rate,
      impact_score,
      status_at_snapshot,
      sample_sessions_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, date, mode, issue_key) DO UPDATE SET
      issue_type = excluded.issue_type,
      normalized_page = excluded.normalized_page,
      normalized_signature = excluded.normalized_signature,
      sessions_affected = excluded.sessions_affected,
      events_count = excluded.events_count,
      high_intent_rate = excluded.high_intent_rate,
      impact_score = excluded.impact_score,
      status_at_snapshot = excluded.status_at_snapshot,
      sample_sessions_json = excluded.sample_sessions_json,
      updated_at = excluded.updated_at
  `).run(
    context.store,
    context.date,
    context.mode,
    row.issueKey,
    row.issueType,
    row.normalizedPage,
    row.normalizedSignature,
    row.sessionsAffected,
    row.eventsCount,
    row.highIntentRate,
    row.impactScore,
    lifecycleState,
    row.sampleSessionsJson,
    now
  );

  return {
    issue_key: row.issueKey,
    issue_type: row.issueType,
    normalized_page: row.normalizedPage,
    normalized_signature: row.normalizedSignature,
    lifecycle_state: lifecycleState,
    sessions_affected: row.sessionsAffected,
    events_count: row.eventsCount,
    recent_presence_days: recentPresenceDays
  };
}

export function persistInvestigationIssueSnapshots({ store, date, mode, signals }) {
  const normalizedStore = normalizeStore(store);
  const normalizedDate = requireIsoDate(date);
  if (!normalizedDate) {
    return {
      success: false,
      error: 'Invalid date. Expected YYYY-MM-DD.'
    };
  }

  const normalizedMode = safeString(mode).trim() || 'high_intent_no_purchase';
  const issueRows = toClusterRowsFromSignals(signals);

  if (!issueRows.length) {
    return {
      success: true,
      data: {
        store: normalizedStore,
        date: normalizedDate,
        mode: normalizedMode,
        policy: LIFECYCLE_POLICY,
        summary: {
          total: 0,
          observed: 0,
          investigating: 0,
          confirmed: 0,
          false_alert: 0
        },
        clusters: []
      }
    };
  }

  const db = getDb();
  const issueKeys = issueRows.map((row) => row.issueKey);
  const existingStateByKey = fetchExistingClustersByKey(db, normalizedStore, issueKeys);
  const verificationStatusByKey = fetchLatestVerificationStatusByKey(db, normalizedStore, issueKeys);
  const recentPresenceByKey = fetchRecentPresenceDaysByKey(db, normalizedStore, normalizedMode, normalizedDate, issueKeys);

  const now = normalizeSqliteDateTime();
  const tx = db.transaction(() => {
    const context = {
      store: normalizedStore,
      date: normalizedDate,
      mode: normalizedMode,
      now,
      existingStateByKey,
      verificationStatusByKey,
      recentPresenceByKey
    };

    return issueRows.map((row) => upsertClusterRow(db, row, context));
  });

  const persistedRows = tx.immediate();

  const summary = persistedRows.reduce((acc, row) => {
    acc.total += 1;
    if (row.lifecycle_state === ISSUE_LIFECYCLE_STATES.CONFIRMED) acc.confirmed += 1;
    else if (row.lifecycle_state === ISSUE_LIFECYCLE_STATES.FALSE_ALERT) acc.false_alert += 1;
    else if (row.lifecycle_state === ISSUE_LIFECYCLE_STATES.INVESTIGATING) acc.investigating += 1;
    else acc.observed += 1;
    return acc;
  }, {
    total: 0,
    observed: 0,
    investigating: 0,
    confirmed: 0,
    false_alert: 0
  });

  return {
    success: true,
    data: {
      store: normalizedStore,
      date: normalizedDate,
      mode: normalizedMode,
      policy: LIFECYCLE_POLICY,
      summary,
      clusters: persistedRows
    }
  };
}

function makePlaceholders(length) {
  if (!Number.isFinite(length) || length <= 0) return '';
  return new Array(length).fill('?').join(',');
}

function normalizeIssueKeyList(issueKeys) {
  if (!Array.isArray(issueKeys)) return [];
  const deduped = new Set();
  for (const value of issueKeys) {
    const key = safeString(value).trim().toLowerCase();
    if (!key) continue;
    deduped.add(key);
  }
  return Array.from(deduped);
}

function fetchQueuedOrRunningIssueKeySet(db, store, issueKeys) {
  if (!issueKeys.length) return new Set();
  const placeholders = makePlaceholders(issueKeys.length);
  const rows = db.prepare(`
    SELECT DISTINCT issue_key
    FROM si_investigation_jobs
    WHERE store = ?
      AND status IN ('queued', 'running')
      AND issue_key IN (${placeholders})
  `).all(store, ...issueKeys);
  return new Set(rows.map((row) => safeString(row.issue_key).trim().toLowerCase()).filter(Boolean));
}

function queueableIssueTypes(includeUnverifiable = false) {
  if (includeUnverifiable) return ISSUE_TYPES;
  return AUTO_VERIFIABLE_ISSUE_TYPES;
}

function buildQueueCandidatesQuery({ issueTypeCount, issueKeyCount, includeObserved }) {
  const lifecycleFilters = includeObserved
    ? `AND COALESCE(c.lifecycle_state, '${ISSUE_LIFECYCLE_STATES.OBSERVED}') IN ('${ISSUE_LIFECYCLE_STATES.OBSERVED}', '${ISSUE_LIFECYCLE_STATES.INVESTIGATING}')`
    : `AND COALESCE(c.lifecycle_state, '${ISSUE_LIFECYCLE_STATES.OBSERVED}') = '${ISSUE_LIFECYCLE_STATES.INVESTIGATING}'`;
  const issueKeyFilter = issueKeyCount > 0
    ? `AND d.issue_key IN (${makePlaceholders(issueKeyCount)})`
    : '';

  return `
    SELECT
      d.issue_key,
      d.issue_type,
      d.normalized_page,
      d.normalized_signature,
      d.sessions_affected,
      d.events_count,
      d.high_intent_rate,
      d.impact_score,
      d.sample_sessions_json,
      COALESCE(c.lifecycle_state, '${ISSUE_LIFECYCLE_STATES.OBSERVED}') AS lifecycle_state
    FROM si_issue_daily_stats d
    LEFT JOIN si_issue_clusters c
      ON c.store = d.store
     AND c.issue_key = d.issue_key
    WHERE d.store = ?
      AND d.date = ?
      AND d.mode = ?
      AND d.issue_type IN (${makePlaceholders(issueTypeCount)})
      ${lifecycleFilters}
      ${issueKeyFilter}
    ORDER BY COALESCE(d.impact_score, 0) DESC, d.sessions_affected DESC, d.events_count DESC
    LIMIT ?
  `;
}

function normalizeIssueState(value) {
  const normalized = safeString(value).trim().toLowerCase();
  if (normalized === ISSUE_LIFECYCLE_STATES.CONFIRMED) return ISSUE_LIFECYCLE_STATES.CONFIRMED;
  if (normalized === ISSUE_LIFECYCLE_STATES.FALSE_ALERT) return ISSUE_LIFECYCLE_STATES.FALSE_ALERT;
  if (normalized === ISSUE_LIFECYCLE_STATES.INVESTIGATING) return ISSUE_LIFECYCLE_STATES.INVESTIGATING;
  return ISSUE_LIFECYCLE_STATES.OBSERVED;
}

function normalizeJobStatus(value) {
  const normalized = safeString(value).trim().toLowerCase();
  if (normalized === 'queued' || normalized === 'running' || normalized === 'completed' || normalized === 'failed') {
    return normalized;
  }
  return '';
}

function toInvestigationJobPublic(row) {
  return {
    id: row.id,
    store: row.store,
    issue_key: row.issue_key,
    job_type: row.job_type,
    status: row.status,
    priority: row.priority,
    attempt_count: row.attempt_count,
    requested_by: row.requested_by,
    payload: safeJsonParse(row.payload_json) || null,
    result: safeJsonParse(row.result_json) || null,
    error_text: row.error_text || null,
    requested_at: row.requested_at || null,
    started_at: row.started_at || null,
    finished_at: row.finished_at || null
  };
}

function evaluateIssueVerification({ snapshot, history }) {
  const sessionsAffected = Math.max(0, Number(snapshot?.sessions_affected) || 0);
  const eventsCount = Math.max(0, Number(snapshot?.events_count) || 0);
  const presenceDays = Math.max(0, Number(history?.presence_days) || 0);
  const cumulativeSessions = Math.max(0, Number(history?.cumulative_sessions) || 0);
  const cumulativeEvents = Math.max(0, Number(history?.cumulative_events) || 0);

  const passesVolume = sessionsAffected >= INVESTIGATION_CONFIRM_RULES.minSessions
    || eventsCount >= INVESTIGATION_CONFIRM_RULES.minEvents;
  const passesConsistency = presenceDays >= INVESTIGATION_CONFIRM_RULES.minPresenceDays
    || cumulativeSessions >= INVESTIGATION_CONFIRM_RULES.minCumulativeSessions;

  if (passesVolume && passesConsistency) {
    return {
      status: ISSUE_LIFECYCLE_STATES.CONFIRMED,
      reason: 'Issue has recurring session impact and consistent signal volume across recent days.',
      confidence: Math.min(1, 0.72 + Math.min(0.24, cumulativeSessions / 200))
    };
  }

  const weakNoise = presenceDays <= INVESTIGATION_FALSE_ALERT_RULES.maxPresenceDays
    && cumulativeSessions <= INVESTIGATION_FALSE_ALERT_RULES.maxSessions
    && cumulativeEvents <= INVESTIGATION_FALSE_ALERT_RULES.maxEvents;

  if (weakNoise) {
    return {
      status: ISSUE_LIFECYCLE_STATES.FALSE_ALERT,
      reason: 'Signal stayed low-volume and did not recur enough to qualify as a durable issue.',
      confidence: 0.74
    };
  }

  return {
    status: ISSUE_LIFECYCLE_STATES.FALSE_ALERT,
    reason: 'Signal did not meet confirmation thresholds after investigation run.',
    confidence: 0.58
  };
}

function browserProbeEnabledForIssueType(issueType) {
  if (!BROWSER_PROBE_CONFIG.enabled) return false;
  const normalizedType = safeString(issueType).trim().toLowerCase();
  return AUTO_VERIFIABLE_ISSUE_TYPES.includes(normalizedType);
}

function escapeCssIdentifier(identifier) {
  const raw = safeString(identifier);
  if (!raw) return '';
  return raw
    .split('')
    .map((char) => {
      if (/^[a-zA-Z0-9_-]$/.test(char)) return char;
      return `\\${char}`;
    })
    .join('');
}

function normalizeSelectorForProbe(rawSelector) {
  const raw = safeString(rawSelector).trim();
  if (!raw) return '';

  let normalized = '';
  let cursor = 0;

  while (cursor < raw.length) {
    const marker = raw[cursor];
    if (marker !== '.' && marker !== '#') {
      normalized += marker;
      cursor += 1;
      continue;
    }

    cursor += 1;
    let token = '';
    while (cursor < raw.length) {
      const char = raw[cursor];
      if (char === '.' || char === '#' || char === '[') break;
      token += char;
      cursor += 1;
    }

    const escapedToken = escapeCssIdentifier(token);
    if (!escapedToken) return '';
    normalized += `${marker}${escapedToken}`;
  }

  return normalized;
}

function resolveBrowserProbeSelector(signature) {
  const raw = safeString(signature).trim();
  if (!raw || raw === 'unknown_target' || raw.length > MAX_SIGNATURE_LENGTH) return '';
  // Avoid selectors with characters that are risky or not expected in target keys.
  // This is a security precaution against selector injection.
  if (/[{};"']/.test(raw)) return '';
  if (/\s/.test(raw)) return '';
  return normalizeSelectorForProbe(raw);
}

function shouldRetryProbeNavigation(error) {
  const message = safeString(error?.message || error).toLowerCase();
  if (!message) return false;
  return message.includes('timeout')
    || message.includes('net::err_')
    || message.includes('navigation failed');
}

async function navigateForProbe(page, issueUrl, waitUntil = 'domcontentloaded') {
  const maxAttempts = Math.max(1, Number(BROWSER_PROBE_CONFIG.navigationAttempts) || 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(issueUrl, {
        waitUntil,
        timeout: BROWSER_PROBE_CONFIG.navigationTimeoutMs
      });
      await sleep(BROWSER_PROBE_CONFIG.postLoadWaitMs);
      return {
        ok: true,
        attempt,
        waitUntil
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryProbeNavigation(error)) break;
      await sleep(Math.min(1200, attempt * 250));
    }
  }

  return {
    ok: false,
    reason: safeString(lastError?.message || lastError).trim().slice(0, 260) || 'Navigation failed.',
    attempts: maxAttempts,
    waitUntil
  };
}

async function verifyIssueWithBrowserProbe(snapshot, issueUrl) {
  const issueType = safeString(snapshot?.issue_type).trim().toLowerCase();
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    return {
      ok: false,
      reason: 'Puppeteer is not available in this runtime.',
      method: BROWSER_PROBE_METHOD
    };
  }

  let browser = null;
  try {
    browser = await launchBrowserProbe(puppeteer);
  } catch (error) {
    return {
      ok: false,
      reason: safeString(error?.message || error).trim().slice(0, 300) || 'Browser launch failed.',
      method: BROWSER_PROBE_METHOD
    };
  }

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(BROWSER_PROBE_CONFIG.navigationTimeoutMs);

    if (issueType === 'js_errors') {
      const observedErrors = [];
      const onPageError = (error) => {
        observedErrors.push(safeString(error?.message || error).trim());
      };
      const onConsole = (msg) => {
        const msgType = safeString(msg?.type?.()).trim().toLowerCase();
        if (msgType !== 'error') return;
        observedErrors.push(safeString(msg?.text?.() || '').trim());
      };

      page.on('pageerror', onPageError);
      page.on('console', onConsole);

      try {
        const navigationResult = await navigateForProbe(page, issueUrl, 'domcontentloaded');
        if (!navigationResult.ok) {
          return {
            ok: false,
            reason: navigationResult.reason,
            method: BROWSER_PROBE_METHOD
          };
        }
      } finally {
        page.off('pageerror', onPageError);
        page.off('console', onConsole);
      }

      const normalizedObserved = observedErrors.map(normalizeBrowserProbeErrorSignature).filter(Boolean);
      const normalizedExpected = normalizeBrowserProbeErrorSignature(snapshot?.normalized_signature);
      const matched = normalizedExpected
        ? normalizedObserved.some((item) => item.includes(normalizedExpected) || normalizedExpected.includes(item))
        : normalizedObserved.length > 0;

      if (matched) {
        return {
          ok: true,
          status: ISSUE_LIFECYCLE_STATES.CONFIRMED,
          reason: 'Browser probe reproduced a matching runtime error.',
          confidence: 0.9,
          method: BROWSER_PROBE_METHOD,
          evidence: {
            url: issueUrl,
            observed_error_count: normalizedObserved.length,
            observed_errors: normalizedObserved.slice(0, 8)
          }
        };
      }

      return {
        ok: true,
        status: ISSUE_LIFECYCLE_STATES.FALSE_ALERT,
        reason: normalizedObserved.length
          ? 'Browser probe observed errors, but not this issue signature.'
          : 'Browser probe observed no runtime errors on this page.',
        confidence: normalizedObserved.length ? 0.62 : 0.74,
        method: BROWSER_PROBE_METHOD,
        evidence: {
          url: issueUrl,
          observed_error_count: normalizedObserved.length,
          observed_errors: normalizedObserved.slice(0, 8)
        }
      };
    }

    const selector = resolveBrowserProbeSelector(snapshot?.normalized_signature);
    if (!selector) {
      return {
        ok: false,
        reason: 'Issue signature is not a safe CSS selector for browser probe.',
        method: BROWSER_PROBE_METHOD
      };
    }

    try {
      const navigationResult = await navigateForProbe(page, issueUrl, 'domcontentloaded');
      if (!navigationResult.ok) {
        return {
          ok: false,
          reason: navigationResult.reason,
          method: BROWSER_PROBE_METHOD
        };
      }
    } catch (navigationError) {
      return {
        ok: false,
        reason: safeString(navigationError?.message || navigationError).trim().slice(0, 260) || 'Navigation failed.',
        method: BROWSER_PROBE_METHOD
      };
    }

    let exists = false;
    try {
      exists = Boolean(await page.$(selector));
    } catch (selectorError) {
      return {
        ok: false,
        reason: `Invalid selector syntax for probe: ${safeString(selectorError?.message || selectorError).slice(0, 220)}`,
        method: BROWSER_PROBE_METHOD
      };
    }

    if (!exists) {
      return {
        ok: true,
        status: ISSUE_LIFECYCLE_STATES.FALSE_ALERT,
        reason: 'Browser probe could not find this click target on the page.',
        confidence: 0.72,
        method: BROWSER_PROBE_METHOD,
        evidence: {
          url: issueUrl,
          selector
        }
      };
    }

    await page.evaluate(() => {
      try {
        if (window.__siProbeMutObserver) window.__siProbeMutObserver.disconnect();
      } catch (_error) {}
      window.__siProbeMutCount = 0;
      const target = document.documentElement || document.body;
      if (!target) return;
      const observer = new MutationObserver((mutations) => {
        window.__siProbeMutCount += mutations.length;
      });
      observer.observe(target, { childList: true, subtree: true, attributes: true });
      window.__siProbeMutObserver = observer;
    });

    const requiredDeadAttempts = Math.max(
      1,
      Math.ceil(BROWSER_PROBE_CONFIG.clickAttempts * BROWSER_PROBE_CONFIG.deadClickConfirmRatio)
    );
    let deadAttempts = 0;
    let responsiveAttempts = 0;
    const attempts = [];

    for (let attempt = 1; attempt <= BROWSER_PROBE_CONFIG.clickAttempts; attempt += 1) {
      const beforeUrl = page.url();
      const beforeMut = await page.evaluate(() => Number(window.__siProbeMutCount || 0));
      let requestCount = 0;
      const onRequest = () => { requestCount += 1; };
      page.on('request', onRequest);

      let clickError = null;
      try {
        await page.$eval(selector, (el) => {
          el.scrollIntoView({ block: 'center', inline: 'center' });
        });
        await page.click(selector, { delay: 30 });
      } catch (error) {
        clickError = safeString(error?.message || error).trim().slice(0, 220);
      }

      await sleep(BROWSER_PROBE_CONFIG.clickSettleWaitMs);
      page.off('request', onRequest);
      const afterUrl = page.url();
      const afterMut = await page.evaluate(() => Number(window.__siProbeMutCount || 0));
      const mutationDelta = Math.max(0, (Number(afterMut) || 0) - (Number(beforeMut) || 0));
      const urlChanged = afterUrl !== beforeUrl;
      const responsive = !clickError && (urlChanged || requestCount > 0 || mutationDelta >= BROWSER_PROBE_CONFIG.mutationThreshold);

      if (responsive) responsiveAttempts += 1;
      else deadAttempts += 1;

      attempts.push({
        attempt,
        click_error: clickError,
        request_count: requestCount,
        mutation_delta: mutationDelta,
        url_changed: urlChanged,
        responsive
      });
    }

    if (deadAttempts >= requiredDeadAttempts) {
      return {
        ok: true,
        status: ISSUE_LIFECYCLE_STATES.CONFIRMED,
        reason: 'Browser probe reproduced repeated dead-click behavior on this target.',
        confidence: 0.88,
        method: BROWSER_PROBE_METHOD,
        evidence: {
          url: issueUrl,
          selector,
          dead_attempts: deadAttempts,
          responsive_attempts: responsiveAttempts,
          attempts
        }
      };
    }

    return {
      ok: true,
      status: ISSUE_LIFECYCLE_STATES.FALSE_ALERT,
      reason: 'Browser probe showed this target responds to interaction.',
      confidence: 0.7,
      method: BROWSER_PROBE_METHOD,
      evidence: {
        url: issueUrl,
        selector,
        dead_attempts: deadAttempts,
        responsive_attempts: responsiveAttempts,
        attempts
      }
    };
  } catch (error) {
    return {
      ok: false,
      reason: safeString(error?.message || error).trim().slice(0, 300) || 'Probe execution failed.',
      method: BROWSER_PROBE_METHOD
    };
  } finally {
    await browser?.close().catch(() => {});
  }
}

function fetchLatestVerificationByIssueKeys(db, store, issueKeys) {
  if (!issueKeys.length) return new Map();
  const placeholders = makePlaceholders(issueKeys.length);
  const rows = db.prepare(`
    SELECT v.issue_key, v.status, v.method, v.reason, v.evidence_json, v.verified_by, v.verified_at, v.expires_at
    FROM si_issue_verifications v
    INNER JOIN (
      SELECT issue_key, MAX(COALESCE(verified_at, created_at)) AS latest_time
      FROM si_issue_verifications
      WHERE store = ?
        AND issue_key IN (${placeholders})
      GROUP BY issue_key
    ) latest
      ON latest.issue_key = v.issue_key
     AND COALESCE(v.verified_at, v.created_at) = latest.latest_time
    WHERE v.store = ?
      AND v.issue_key IN (${placeholders})
  `).all(store, ...issueKeys, store, ...issueKeys);

  return new Map(rows.map((row) => [safeString(row.issue_key).trim().toLowerCase(), {
    status: normalizeIssueState(row.status),
    method: safeString(row.method).trim() || null,
    reason: safeString(row.reason).trim() || null,
    evidence: safeJsonParse(row.evidence_json) || null,
    verified_by: safeString(row.verified_by).trim() || null,
    verified_at: row.verified_at || null,
    expires_at: row.expires_at || null
  }]));
}

function fetchIssueSnapshotForJob(db, { store, issueKey, date, mode }) {
  const exact = db.prepare(`
    SELECT
      d.store,
      d.date,
      d.mode,
      d.issue_key,
      d.issue_type,
      d.normalized_page,
      d.normalized_signature,
      d.sessions_affected,
      d.events_count,
      d.high_intent_rate,
      d.impact_score,
      d.sample_sessions_json,
      COALESCE(c.lifecycle_state, '${ISSUE_LIFECYCLE_STATES.OBSERVED}') AS lifecycle_state
    FROM si_issue_daily_stats d
    LEFT JOIN si_issue_clusters c
      ON c.store = d.store
     AND c.issue_key = d.issue_key
    WHERE d.store = ?
      AND d.issue_key = ?
      AND d.date = ?
      AND d.mode = ?
    LIMIT 1
  `).get(store, issueKey, date, mode);
  if (exact) return exact;

  return db.prepare(`
    SELECT
      d.store,
      d.date,
      d.mode,
      d.issue_key,
      d.issue_type,
      d.normalized_page,
      d.normalized_signature,
      d.sessions_affected,
      d.events_count,
      d.high_intent_rate,
      d.impact_score,
      d.sample_sessions_json,
      COALESCE(c.lifecycle_state, '${ISSUE_LIFECYCLE_STATES.OBSERVED}') AS lifecycle_state
    FROM si_issue_daily_stats d
    LEFT JOIN si_issue_clusters c
      ON c.store = d.store
     AND c.issue_key = d.issue_key
    WHERE d.store = ?
      AND d.issue_key = ?
    ORDER BY d.date DESC
    LIMIT 1
  `).get(store, issueKey);
}

function fetchIssueHistoryStats(db, { store, issueKey, mode, anchorDate }) {
  const startDate = shiftIsoDate(anchorDate, -(LIFECYCLE_POLICY.lookbackDays - 1));
  return db.prepare(`
    SELECT
      COUNT(DISTINCT date) AS presence_days,
      COALESCE(SUM(sessions_affected), 0) AS cumulative_sessions,
      COALESCE(SUM(events_count), 0) AS cumulative_events,
      COALESCE(MAX(sessions_affected), 0) AS peak_sessions,
      COALESCE(MAX(events_count), 0) AS peak_events
    FROM si_issue_daily_stats
    WHERE store = ?
      AND issue_key = ?
      AND mode = ?
      AND date >= ?
      AND date <= ?
  `).get(store, issueKey, mode, startDate, anchorDate);
}

function writeVerificationRecord(db, {
  store,
  issueKey,
  status,
  reason,
  confidence,
  method,
  evidence,
  verifiedBy,
  expiresAt
}) {
  const now = normalizeSqliteDateTime();
  db.prepare(`
    INSERT INTO si_issue_verifications (
      store,
      issue_key,
      status,
      method,
      reason,
      evidence_json,
      verified_by,
      verified_at,
      expires_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    store,
    issueKey,
    status,
    method,
    reason,
    JSON.stringify({
      confidence,
      ...(evidence || {})
    }),
    verifiedBy || null,
    now,
    expiresAt || null,
    now
  );
}

function applyLifecycleResult(db, { store, issueKey, status, date, mode }) {
  const normalized = normalizeIssueState(status);
  const now = normalizeSqliteDateTime();
  db.prepare(`
    UPDATE si_issue_clusters
    SET lifecycle_state = ?, lifecycle_updated_at = ?, updated_at = ?
    WHERE store = ?
      AND issue_key = ?
  `).run(normalized, now, now, store, issueKey);

  if (date && mode) {
    db.prepare(`
      UPDATE si_issue_daily_stats
      SET status_at_snapshot = ?, updated_at = ?
      WHERE store = ?
        AND issue_key = ?
        AND date = ?
        AND mode = ?
    `).run(normalized, now, store, issueKey, date, mode);
  }
}

function buildVerificationEvidence({ snapshot, history, heuristicVerdict, method, browserProbe }) {
  return {
    verification_method: method,
    heuristic_version: SIGNAL_HISTORY_METHOD,
    snapshot: {
      date: snapshot.date,
      mode: snapshot.mode,
      issue_type: snapshot.issue_type,
      normalized_page: snapshot.normalized_page,
      normalized_signature: snapshot.normalized_signature,
      sessions_affected: snapshot.sessions_affected,
      events_count: snapshot.events_count,
      high_intent_rate: snapshot.high_intent_rate,
      impact_score: snapshot.impact_score,
      sample_sessions: safeJsonParse(snapshot.sample_sessions_json) || []
    },
    history: {
      lookback_days: LIFECYCLE_POLICY.lookbackDays,
      presence_days: Number(history?.presence_days) || 0,
      cumulative_sessions: Number(history?.cumulative_sessions) || 0,
      cumulative_events: Number(history?.cumulative_events) || 0,
      peak_sessions: Number(history?.peak_sessions) || 0,
      peak_events: Number(history?.peak_events) || 0
    },
    thresholds: {
      confirm: INVESTIGATION_CONFIRM_RULES,
      false_alert: INVESTIGATION_FALSE_ALERT_RULES
    },
    heuristic_verdict: heuristicVerdict,
    browser_probe: browserProbe || null
  };
}

async function executeVerificationJob(db, jobRow) {
  const store = normalizeStore(jobRow.store);
  const issueKey = safeString(jobRow.issue_key).trim().toLowerCase();
  const payload = safeJsonParse(jobRow.payload_json) || {};
  const date = requireIsoDate(payload?.date);
  const mode = normalizeMode(payload?.mode);
  const requestedBy = safeString(payload?.requested_by || jobRow.requested_by).trim() || 'system';

  if (!issueKey) {
    return {
      ok: false,
      status: ISSUE_LIFECYCLE_STATES.FALSE_ALERT,
      reason: 'Missing issue key in investigation job payload.'
    };
  }

  const snapshot = fetchIssueSnapshotForJob(db, { store, issueKey, date, mode });
  if (!snapshot) {
    return {
      ok: false,
      status: ISSUE_LIFECYCLE_STATES.FALSE_ALERT,
      reason: 'No issue snapshot was found for this issue key.'
    };
  }

  const issueType = safeString(snapshot.issue_type).trim().toLowerCase();
  if (!AUTO_VERIFIABLE_ISSUE_TYPES.includes(issueType)) {
    return {
      ok: true,
      status: normalizeIssueState(snapshot.lifecycle_state),
      reason: 'Issue type is not auto-verifiable in this runner version.',
      skipped: true
    };
  }

  const history = fetchIssueHistoryStats(db, {
    store,
    issueKey,
    mode: normalizeMode(snapshot.mode),
    anchorDate: requireIsoDate(snapshot.date) || date || normalizeSqliteDateTime().slice(0, 10)
  });

  const heuristicVerdict = evaluateIssueVerification({ snapshot, history });
  let verdict = {
    ...heuristicVerdict,
    method: SIGNAL_HISTORY_METHOD
  };
  let browserProbe = null;

  if (browserProbeEnabledForIssueType(issueType)) {
    const issueUrl = resolveIssueProbeUrl(store, snapshot.normalized_page);
    if (!issueUrl) {
      browserProbe = {
        ok: false,
        method: BROWSER_PROBE_METHOD,
        reason: `Browser probe skipped: missing store base URL config (${BROWSER_PROBE_STORE_BASE_URLS_ENV} or ${BROWSER_PROBE_DEFAULT_BASE_URL_ENV}).`
      };
    } else {
      browserProbe = await verifyIssueWithBrowserProbe(snapshot, issueUrl);
      if (browserProbe?.ok) {
        verdict = {
          status: normalizeIssueState(browserProbe.status),
          reason: browserProbe.reason,
          confidence: Number(browserProbe.confidence) || heuristicVerdict.confidence,
          method: browserProbe.method || BROWSER_PROBE_METHOD
        };
      }
    }
  }

  const evidence = buildVerificationEvidence({
    snapshot,
    history,
    heuristicVerdict,
    method: verdict.method,
    browserProbe
  });

  writeVerificationRecord(db, {
    store,
    issueKey,
    status: verdict.status,
    reason: verdict.reason,
    confidence: verdict.confidence,
    method: verdict.method,
    evidence,
    verifiedBy: requestedBy,
    expiresAt: null
  });

  applyLifecycleResult(db, {
    store,
    issueKey,
    status: verdict.status,
    date: requireIsoDate(snapshot.date),
    mode: normalizeMode(snapshot.mode)
  });

  return {
    ok: true,
    status: verdict.status,
    reason: verdict.reason,
    issue_key: issueKey
  };
}

export function queueInvestigationJobs({
  store,
  date,
  mode,
  issueKeys,
  limit = INVESTIGATION_QUEUE_LIMIT_DEFAULT,
  priority = 100,
  requestedBy = 'api',
  includeObserved = false,
  includeUnverifiable = false,
  force = false
}) {
  const normalizedStore = normalizeStore(store);
  const normalizedDate = requireIsoDate(date);
  if (!normalizedDate) {
    return { success: false, error: 'Invalid date. Expected YYYY-MM-DD.' };
  }

  const normalizedMode = normalizeMode(mode);
  const normalizedIssueKeys = normalizeIssueKeyList(issueKeys);
  const maxRows = clampInteger(limit, INVESTIGATION_QUEUE_LIMIT_DEFAULT, 1, 200);
  const normalizedPriority = clampInteger(priority, 100, 1, 1000);
  const candidateTypes = queueableIssueTypes(includeUnverifiable);
  const db = getDb();

  const sql = buildQueueCandidatesQuery({
    issueTypeCount: candidateTypes.length,
    issueKeyCount: normalizedIssueKeys.length,
    includeObserved
  });
  const queryParams = [
    normalizedStore,
    normalizedDate,
    normalizedMode,
    ...candidateTypes,
    ...normalizedIssueKeys,
    maxRows
  ];
  const candidates = db.prepare(sql).all(...queryParams);
  if (!candidates.length) {
    return {
      success: true,
      data: {
        store: normalizedStore,
        date: normalizedDate,
        mode: normalizedMode,
        queued: 0,
        skipped: 0,
        reason: 'No eligible issues found for investigation.'
      }
    };
  }

  const candidateIssueKeys = candidates.map((row) => safeString(row.issue_key).trim().toLowerCase()).filter(Boolean);
  const blockedIssueKeys = force ? new Set() : fetchQueuedOrRunningIssueKeySet(db, normalizedStore, candidateIssueKeys);
  const now = normalizeSqliteDateTime();
  const queuedRows = [];
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const row of candidates) {
      const issueKey = safeString(row.issue_key).trim().toLowerCase();
      if (!issueKey) {
        skipped += 1;
        continue;
      }
      if (blockedIssueKeys.has(issueKey)) {
        skipped += 1;
        continue;
      }

      const payload = {
        date: normalizedDate,
        mode: normalizedMode,
        issue_type: row.issue_type,
        normalized_page: row.normalized_page,
        normalized_signature: row.normalized_signature,
        sessions_affected: Number(row.sessions_affected) || 0,
        events_count: Number(row.events_count) || 0,
        requested_by: safeString(requestedBy).trim() || 'api'
      };

      const insert = db.prepare(`
        INSERT INTO si_investigation_jobs (
          store,
          issue_key,
          job_type,
          status,
          priority,
          attempt_count,
          requested_by,
          payload_json,
          requested_at,
          updated_at
        )
        VALUES (?, ?, 'verify_issue', 'queued', ?, 0, ?, ?, ?, ?)
      `).run(
        normalizedStore,
        issueKey,
        normalizedPriority,
        payload.requested_by,
        JSON.stringify(payload),
        now,
        now
      );

      db.prepare(`
        UPDATE si_issue_clusters
        SET lifecycle_state = CASE
          WHEN lifecycle_state IN ('${ISSUE_LIFECYCLE_STATES.CONFIRMED}', '${ISSUE_LIFECYCLE_STATES.FALSE_ALERT}') THEN lifecycle_state
          ELSE '${ISSUE_LIFECYCLE_STATES.INVESTIGATING}'
        END,
        lifecycle_updated_at = ?,
        updated_at = ?
        WHERE store = ?
          AND issue_key = ?
      `).run(now, now, normalizedStore, issueKey);

      db.prepare(`
        UPDATE si_issue_daily_stats
        SET status_at_snapshot = CASE
          WHEN status_at_snapshot IN ('${ISSUE_LIFECYCLE_STATES.CONFIRMED}', '${ISSUE_LIFECYCLE_STATES.FALSE_ALERT}') THEN status_at_snapshot
          ELSE '${ISSUE_LIFECYCLE_STATES.INVESTIGATING}'
        END,
        updated_at = ?
        WHERE store = ?
          AND date = ?
          AND mode = ?
          AND issue_key = ?
      `).run(now, normalizedStore, normalizedDate, normalizedMode, issueKey);

      queuedRows.push({
        id: insert.lastInsertRowid,
        issue_key: issueKey,
        issue_type: row.issue_type,
        normalized_page: row.normalized_page,
        sessions_affected: Number(row.sessions_affected) || 0
      });
    }
  });

  tx.immediate();

  return {
    success: true,
    data: {
      store: normalizedStore,
      date: normalizedDate,
      mode: normalizedMode,
      queued: queuedRows.length,
      skipped,
      jobs: queuedRows
    }
  };
}

export function listInvestigationJobs({ store, status = '', limit = 50 } = {}) {
  const normalizedStore = normalizeStore(store);
  const normalizedStatus = normalizeJobStatus(status);
  const maxRows = clampInteger(limit, 50, 1, 200);
  const db = getDb();

  const rows = normalizedStatus
    ? db.prepare(`
        SELECT
          id,
          store,
          issue_key,
          job_type,
          status,
          priority,
          attempt_count,
          requested_by,
          payload_json,
          result_json,
          error_text,
          requested_at,
          started_at,
          finished_at
        FROM si_investigation_jobs
        WHERE store = ?
          AND status = ?
        ORDER BY requested_at DESC, id DESC
        LIMIT ?
      `).all(normalizedStore, normalizedStatus, maxRows)
    : db.prepare(`
        SELECT
          id,
          store,
          issue_key,
          job_type,
          status,
          priority,
          attempt_count,
          requested_by,
          payload_json,
          result_json,
          error_text,
          requested_at,
          started_at,
          finished_at
        FROM si_investigation_jobs
        WHERE store = ?
        ORDER BY requested_at DESC, id DESC
        LIMIT ?
      `).all(normalizedStore, maxRows);

  return {
    success: true,
    data: {
      store: normalizedStore,
      status: normalizedStatus || null,
      jobs: rows.map(toInvestigationJobPublic)
    }
  };
}

export async function runQueuedInvestigationJobs({
  store,
  maxJobs = INVESTIGATION_JOB_RUN_LIMIT_DEFAULT
} = {}) {
  const scopedStore = safeString(store).trim();
  const limit = clampInteger(maxJobs, INVESTIGATION_JOB_RUN_LIMIT_DEFAULT, 1, 200);
  const db = getDb();

  const queuedRows = scopedStore
    ? db.prepare(`
        SELECT
          id,
          store,
          issue_key,
          job_type,
          status,
          priority,
          attempt_count,
          requested_by,
          payload_json,
          requested_at
        FROM si_investigation_jobs
        WHERE store = ?
          AND status = 'queued'
          AND job_type = 'verify_issue'
        ORDER BY priority ASC, requested_at ASC, id ASC
        LIMIT ?
      `).all(scopedStore, limit)
    : db.prepare(`
        SELECT
          id,
          store,
          issue_key,
          job_type,
          status,
          priority,
          attempt_count,
          requested_by,
          payload_json,
          requested_at
        FROM si_investigation_jobs
        WHERE status = 'queued'
          AND job_type = 'verify_issue'
        ORDER BY priority ASC, requested_at ASC, id ASC
        LIMIT ?
      `).all(limit);

  if (!queuedRows.length) {
    return {
      success: true,
      data: {
        store: scopedStore || 'all',
        attempted: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        jobs: []
      }
    };
  }

  const results = [];
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of queuedRows) {
    const startedAt = normalizeSqliteDateTime();
    const claim = db.prepare(`
      UPDATE si_investigation_jobs
      SET
        status = 'running',
        attempt_count = attempt_count + 1,
        started_at = ?,
        updated_at = ?
      WHERE id = ?
        AND status = 'queued'
    `).run(startedAt, startedAt, row.id);

    if ((claim?.changes || 0) < 1) {
      skipped += 1;
      continue;
    }

    try {
      const execution = await executeVerificationJob(db, row);
      const finishedAt = normalizeSqliteDateTime();
      const nextStatus = execution.ok ? 'completed' : 'failed';
      db.prepare(`
        UPDATE si_investigation_jobs
        SET
          status = ?,
          result_json = ?,
          error_text = ?,
          finished_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        nextStatus,
        JSON.stringify(execution),
        execution.ok ? null : safeString(execution.reason).trim().slice(0, 500),
        finishedAt,
        finishedAt,
        row.id
      );
      results.push({ id: row.id, ...execution });
      if (execution.ok) completed += 1;
      else failed += 1;
    } catch (error) {
      const finishedAt = normalizeSqliteDateTime();
      const reason = safeString(error?.message || error).trim().slice(0, 500) || 'Unknown execution failure';
      db.prepare(`
        UPDATE si_investigation_jobs
        SET
          status = 'failed',
          error_text = ?,
          finished_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(reason, finishedAt, finishedAt, row.id);
      failed += 1;
      results.push({
        id: row.id,
        ok: false,
        status: ISSUE_LIFECYCLE_STATES.FALSE_ALERT,
        reason
      });
    }
  }

  return {
    success: true,
    data: {
      store: scopedStore || 'all',
      attempted: queuedRows.length,
      completed,
      failed,
      skipped,
      jobs: results
    }
  };
}

export function listInvestigationIssuesForDate({
  store,
  date,
  mode,
  limit = 100
} = {}) {
  const normalizedStore = normalizeStore(store);
  const normalizedDate = requireIsoDate(date);
  if (!normalizedDate) {
    return { success: false, error: 'Invalid date. Expected YYYY-MM-DD.' };
  }
  const normalizedMode = normalizeMode(mode);
  const maxRows = clampInteger(limit, 100, 1, 500);
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      d.issue_key,
      d.issue_type,
      d.normalized_page,
      d.normalized_signature,
      d.sessions_affected,
      d.events_count,
      d.high_intent_rate,
      d.impact_score,
      d.status_at_snapshot,
      d.sample_sessions_json,
      COALESCE(c.lifecycle_state, '${ISSUE_LIFECYCLE_STATES.OBSERVED}') AS lifecycle_state
    FROM si_issue_daily_stats d
    LEFT JOIN si_issue_clusters c
      ON c.store = d.store
     AND c.issue_key = d.issue_key
    WHERE d.store = ?
      AND d.date = ?
      AND d.mode = ?
    ORDER BY COALESCE(d.impact_score, 0) DESC, d.sessions_affected DESC, d.events_count DESC
    LIMIT ?
  `).all(normalizedStore, normalizedDate, normalizedMode, maxRows);

  const issueKeys = rows.map((row) => safeString(row.issue_key).trim().toLowerCase()).filter(Boolean);
  const verificationByKey = fetchLatestVerificationByIssueKeys(db, normalizedStore, issueKeys);

  const issues = rows.map((row) => {
    const issueKey = safeString(row.issue_key).trim().toLowerCase();
    const verification = verificationByKey.get(issueKey) || null;
    return {
      issue_key: issueKey,
      issue_type: row.issue_type,
      normalized_page: row.normalized_page,
      normalized_signature: row.normalized_signature,
      sessions_affected: Number(row.sessions_affected) || 0,
      events_count: Number(row.events_count) || 0,
      high_intent_rate: Number.isFinite(Number(row.high_intent_rate)) ? Number(row.high_intent_rate) : null,
      impact_score: Number.isFinite(Number(row.impact_score)) ? Number(row.impact_score) : null,
      lifecycle_state: normalizeIssueState(row.lifecycle_state),
      status_at_snapshot: normalizeIssueState(row.status_at_snapshot),
      sample_sessions: safeJsonParse(row.sample_sessions_json) || [],
      verification
    };
  });

  const summary = issues.reduce((acc, issue) => {
    acc.total += 1;
    if (issue.lifecycle_state === ISSUE_LIFECYCLE_STATES.CONFIRMED) acc.confirmed += 1;
    else if (issue.lifecycle_state === ISSUE_LIFECYCLE_STATES.FALSE_ALERT) acc.false_alert += 1;
    else if (issue.lifecycle_state === ISSUE_LIFECYCLE_STATES.INVESTIGATING) acc.investigating += 1;
    else acc.observed += 1;
    return acc;
  }, {
    total: 0,
    observed: 0,
    investigating: 0,
    confirmed: 0,
    false_alert: 0
  });

  return {
    success: true,
    data: {
      store: normalizedStore,
      date: normalizedDate,
      mode: normalizedMode,
      summary,
      issues
    }
  };
}
