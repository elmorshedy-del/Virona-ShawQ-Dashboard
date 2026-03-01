import { createHash } from 'crypto';
import { getDb } from '../db/database.js';

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

const LIFECYCLE_LOCKED_STATES = new Set([
  ISSUE_LIFECYCLE_STATES.CONFIRMED,
  ISSUE_LIFECYCLE_STATES.FALSE_ALERT
]);

const MAX_SIGNATURE_LENGTH = 220;
const MAX_NORMALIZED_PAGE_LENGTH = 180;
const MAX_SAMPLE_SESSION_ROWS = 8;
const DEFAULT_STORE_KEY = 'default_store';

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

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeStore(store) {
  const normalized = safeString(store).trim();
  return normalized || DEFAULT_STORE_KEY;
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
