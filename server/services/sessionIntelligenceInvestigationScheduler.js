import { getDb } from '../db/database.js';
import { getSessionIntelligenceClaritySignalsForDay } from './sessionIntelligenceService.js';
import { queueInvestigationJobs } from './sessionIntelligenceInvestigationService.js';

const DEFAULT_ISSUE_MODE = 'high_intent_no_purchase';
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * MILLISECONDS_PER_MINUTE;
const AUTO_QUEUE_CONFIG = Object.freeze({
  mode: DEFAULT_ISSUE_MODE,
  maxStores: clampInteger(process.env.SI_INVESTIGATION_AUTO_QUEUE_MAX_STORES, 50, 1, 500),
  queueLimit: clampInteger(process.env.SI_INVESTIGATION_AUTO_QUEUE_LIMIT, 12, 1, 200),
  queuePriority: clampInteger(process.env.SI_INVESTIGATION_AUTO_QUEUE_PRIORITY, 100, 1, 1000),
  limitSessions: clampInteger(process.env.SI_INVESTIGATION_AUTO_QUEUE_LIMIT_SESSIONS, 5000, 100, 20000),
  activeStoreLookbackDays: clampInteger(process.env.SI_INVESTIGATION_AUTO_QUEUE_ACTIVE_STORE_LOOKBACK_DAYS, 2, 1, 30),
  includeObserved: normalizeBooleanEnv(process.env.SI_INVESTIGATION_AUTO_QUEUE_INCLUDE_OBSERVED, false),
  includeUnverifiable: normalizeBooleanEnv(process.env.SI_INVESTIGATION_AUTO_QUEUE_INCLUDE_UNVERIFIABLE, true)
});

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeBooleanEnv(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function requireIsoDate(value) {
  const raw = safeString(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function toSqliteUtcDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  return safe.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function startOfUtcDayMs(value = Date.now()) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isoDateFromUtcMs(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function dayRangeUtc(isoDate) {
  const normalized = requireIsoDate(isoDate);
  if (!normalized) return null;
  const startMs = Date.parse(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(startMs)) return null;
  return {
    startMs,
    endMs: startMs + MILLISECONDS_PER_DAY,
    start: toSqliteUtcDateTime(startMs),
    end: toSqliteUtcDateTime(startMs + MILLISECONDS_PER_DAY)
  };
}

function listAutoQueueStores(db, date) {
  const range = dayRangeUtc(date);
  if (!range) return [];

  const lookbackStartMs = range.startMs - ((AUTO_QUEUE_CONFIG.activeStoreLookbackDays - 1) * MILLISECONDS_PER_DAY);
  const lookbackStart = toSqliteUtcDateTime(lookbackStartMs);
  const rows = db.prepare(`
    SELECT DISTINCT store
    FROM si_sessions
    WHERE store IS NOT NULL
      AND store != ''
      AND started_at >= ?
      AND started_at < ?
    ORDER BY store
    LIMIT ?
  `).all(lookbackStart, range.end, AUTO_QUEUE_CONFIG.maxStores);

  return rows
    .map((row) => safeString(row?.store).trim())
    .filter(Boolean);
}

function summarizeStoreCycle({ store, clarityResult, queueResult }) {
  return {
    store,
    source_sessions: Number(clarityResult?.data?.totals?.source_sessions) || 0,
    scoped_sessions: Number(clarityResult?.data?.totals?.sessions) || 0,
    snapshot_summary: clarityResult?.data?.investigation?.summary || null,
    queued: Number(queueResult?.data?.queued) || 0,
    skipped: Number(queueResult?.data?.skipped) || 0
  };
}

export async function runSessionIntelligenceInvestigationAutoQueueCycle({
  store = '',
  date = isoDateFromUtcMs(startOfUtcDayMs()),
  requestedBy = 'scheduler'
} = {}) {
  const normalizedDate = requireIsoDate(date);
  if (!normalizedDate) {
    return { success: false, error: 'Invalid date. Expected YYYY-MM-DD.' };
  }

  const db = getDb();
  const scopedStore = safeString(store).trim();
  const stores = scopedStore ? [scopedStore] : listAutoQueueStores(db, normalizedDate);

  if (!stores.length) {
    return {
      success: true,
      data: {
        date: normalizedDate,
        mode: AUTO_QUEUE_CONFIG.mode,
        stores: [],
        queued: 0,
        skipped: 0,
        reason: 'No active stores found for auto-queue.'
      }
    };
  }

  const results = [];
  let queued = 0;
  let skipped = 0;

  for (const storeKey of stores) {
    const clarityResult = getSessionIntelligenceClaritySignalsForDay(storeKey, normalizedDate, {
      mode: AUTO_QUEUE_CONFIG.mode,
      limitSessions: AUTO_QUEUE_CONFIG.limitSessions
    });

    if (!clarityResult?.success) {
      results.push({
        store: storeKey,
        queued: 0,
        skipped: 0,
        error: clarityResult?.error || 'Failed to refresh investigation snapshots.'
      });
      continue;
    }

    const queueResult = queueInvestigationJobs({
      store: storeKey,
      date: normalizedDate,
      mode: AUTO_QUEUE_CONFIG.mode,
      limit: AUTO_QUEUE_CONFIG.queueLimit,
      priority: AUTO_QUEUE_CONFIG.queuePriority,
      requestedBy,
      includeObserved: AUTO_QUEUE_CONFIG.includeObserved,
      includeUnverifiable: AUTO_QUEUE_CONFIG.includeUnverifiable,
      force: false
    });

    if (!queueResult?.success) {
      results.push({
        store: storeKey,
        queued: 0,
        skipped: 0,
        error: queueResult?.error || 'Failed to queue investigation jobs.'
      });
      continue;
    }

    queued += Number(queueResult?.data?.queued) || 0;
    skipped += Number(queueResult?.data?.skipped) || 0;
    results.push(summarizeStoreCycle({
      store: storeKey,
      clarityResult,
      queueResult
    }));
  }

  return {
    success: true,
    data: {
      date: normalizedDate,
      mode: AUTO_QUEUE_CONFIG.mode,
      stores: results,
      queued,
      skipped
    }
  };
}
