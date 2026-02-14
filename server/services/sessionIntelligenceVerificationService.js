import { getDb } from '../db/database.js';

const VERIFIABLE_SIGNAL_TYPES = new Set(['js_errors', 'dead_clicks', 'rage_clicks']);

const VERIFIER_CACHE_TTL_MINUTES = clampInt(
  process.env.SESSION_INTELLIGENCE_VERIFIER_CACHE_TTL_MINUTES,
  180,
  5,
  24 * 60
);
const VERIFIER_MAX_TOTAL_ISSUES = clampInt(
  process.env.SESSION_INTELLIGENCE_VERIFIER_MAX_TOTAL_ISSUES,
  6,
  1,
  30
);
const VERIFIER_MAX_ISSUES_PER_TYPE = clampInt(
  process.env.SESSION_INTELLIGENCE_VERIFIER_MAX_ISSUES_PER_TYPE,
  3,
  1,
  12
);
const VERIFIER_NAVIGATION_TIMEOUT_MS = clampInt(
  process.env.SESSION_INTELLIGENCE_VERIFIER_NAVIGATION_TIMEOUT_MS,
  20000,
  3000,
  120000
);
const VERIFIER_POST_LOAD_WAIT_MS = clampInt(
  process.env.SESSION_INTELLIGENCE_VERIFIER_POST_LOAD_WAIT_MS,
  1200,
  0,
  10000
);
const VERIFIER_CLICK_SETTLE_MS = clampInt(
  process.env.SESSION_INTELLIGENCE_VERIFIER_CLICK_SETTLE_MS,
  1500,
  250,
  10000
);
const VERIFIER_DEAD_CLICK_ATTEMPTS = clampInt(
  process.env.SESSION_INTELLIGENCE_VERIFIER_DEAD_CLICK_ATTEMPTS,
  3,
  1,
  10
);
const VERIFIER_DEAD_CLICK_CONFIRM_RATIO = clampFloat(
  process.env.SESSION_INTELLIGENCE_VERIFIER_DEAD_CLICK_CONFIRM_RATIO,
  0.67,
  0.34,
  1
);
const VERIFIER_MUTATION_THRESHOLD = clampInt(
  process.env.SESSION_INTELLIGENCE_VERIFIER_MUTATION_THRESHOLD,
  1,
  0,
  100
);
const VERIFIER_ALLOW_NO_SANDBOX = safeString(process.env.SESSION_INTELLIGENCE_VERIFIER_ALLOW_NO_SANDBOX)
  .toLowerCase()
  .trim() === 'true';
const VERIFIER_ALLOW_PRIVATE_NETWORK_TARGETS = safeString(process.env.SESSION_INTELLIGENCE_VERIFIER_ALLOW_PRIVATE_NETWORK_TARGETS)
  .toLowerCase()
  .trim() === 'true';

let parsedStoreBaseUrls = null;
const verificationJobByScope = new Map();

function sleep(ms) {
  const waitMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, waitMs));
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

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function clampFloat(value, fallback, min, max) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function toSqliteDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isFinite(date.getTime()) ? date : new Date();
  return safe.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function parseSqliteDateTimeToMs(value) {
  if (!value || typeof value !== 'string') return NaN;
  if (value.includes('T')) return Date.parse(value);
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}

function normalizePagePath(value) {
  const raw = safeString(value).trim();
  if (!raw || raw.startsWith('//')) return '/';
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).pathname || '/';
    } catch (_error) {
      return '/';
    }
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeIssueToken(value) {
  return safeString(value).toLowerCase().trim().replace(/\s+/g, ' ');
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

function normalizeErrorSignature(value) {
  return normalizeIssueToken(value)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[0-9]+/g, '#')
    .replace(/['"`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function buildIssueKey({ issueType, page, targetKey, errorSignature }) {
  const parts = [
    normalizeIssueToken(issueType),
    normalizePagePath(page).toLowerCase(),
    normalizeIssueToken(targetKey),
    normalizeErrorSignature(errorSignature)
  ];
  return parts.join('||');
}

function buildIssueFromSignal(issueType, signal) {
  return {
    issueType,
    page: normalizePagePath(signal?.page),
    targetKey: safeString(signal?.target_key).trim() || '',
    errorSignature: safeString(signal?.message).trim() || '',
    count: Number(signal?.count) || 0,
    sessions: Number(signal?.sessions) || 0
  };
}

function buildVerificationCandidates(signals) {
  const byType = ['js_errors', 'dead_clicks', 'rage_clicks'];
  const out = [];

  for (const type of byType) {
    const list = Array.isArray(signals?.[type]) ? signals[type] : [];
    const candidates = list
      .map((signal) => buildIssueFromSignal(type, signal))
      .sort((a, b) => (b.sessions || 0) - (a.sessions || 0))
      .slice(0, VERIFIER_MAX_ISSUES_PER_TYPE);
    out.push(...candidates);
  }

  return out
    .sort((a, b) => (b.sessions || 0) - (a.sessions || 0))
    .slice(0, VERIFIER_MAX_TOTAL_ISSUES);
}

function parseStoreBaseUrlMap() {
  if (parsedStoreBaseUrls) return parsedStoreBaseUrls;

  const parsed = safeJsonParse(process.env.SESSION_INTELLIGENCE_VERIFIER_STORE_BASE_URLS);
  const map = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [storeKey, baseUrl] of Object.entries(parsed)) {
      const normalizedStore = normalizeIssueToken(storeKey);
      const normalizedUrl = normalizeBaseUrl(baseUrl);
      if (normalizedStore && normalizedUrl) {
        map[normalizedStore] = normalizedUrl;
      }
    }
  }

  parsedStoreBaseUrls = map;
  return parsedStoreBaseUrls;
}

function normalizeBaseUrl(value) {
  const raw = safeString(value).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (!VERIFIER_ALLOW_PRIVATE_NETWORK_TARGETS && isPrivateOrLocalHostname(url.hostname)) return '';
    return `${url.origin}/`;
  } catch (_error) {
    return '';
  }
}

function normalizeRelativeVerifierPath(value) {
  const asPath = normalizePagePath(value);
  let normalized = safeString(asPath).trim();
  if (!normalized) return '/';
  normalized = normalized.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized.startsWith('//')) {
    normalized = `/${normalized.replace(/^\/+/, '')}`;
  }
  return normalized;
}

function resolveIssueUrl(store, page) {
  const pagePath = normalizeRelativeVerifierPath(page);

  const storeMap = parseStoreBaseUrlMap();
  const storeKey = normalizeIssueToken(store);
  const configuredBase = storeMap[storeKey] || normalizeBaseUrl(process.env.SESSION_INTELLIGENCE_VERIFIER_DEFAULT_BASE_URL);
  if (!configuredBase) return null;

  try {
    const base = new URL(configuredBase);
    const resolved = new URL(pagePath, base);
    if (resolved.origin !== base.origin) return null;
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    return resolved.toString();
  } catch (_error) {
    return null;
  }
}

function deserializeVerificationRow(row) {
  return {
    status: safeString(row?.status).trim() || 'unverified',
    confidence: Number(row?.confidence) || 0,
    reason: safeString(row?.reason).trim() || null,
    last_verified_at: row?.last_verified_at || null,
    expires_at: row?.expires_at || null,
    evidence: safeJsonParse(row?.evidence_json) || null
  };
}

function defaultVerificationForIssue(issueType) {
  if (!VERIFIABLE_SIGNAL_TYPES.has(issueType)) {
    return {
      status: 'unverified',
      confidence: 0,
      reason: 'Auto verification not yet enabled for this issue type.',
      last_verified_at: null,
      expires_at: null,
      evidence: null
    };
  }

  return {
    status: 'unverified',
    confidence: 0,
    reason: 'Verification pending.',
    last_verified_at: null,
    expires_at: null,
    evidence: null
  };
}

function ensureVerificationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS si_clarity_issue_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      date TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      page TEXT,
      target_key TEXT,
      error_signature TEXT,
      status TEXT NOT NULL DEFAULT 'unverified',
      confidence REAL DEFAULT 0,
      reason TEXT,
      evidence_json TEXT,
      last_verified_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, date, issue_key)
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_clarity_issue_verifications_scope
    ON si_clarity_issue_verifications(store, date, status, expires_at)
  `);
}

export function attachCachedClarityVerifications({ store, date, signals }) {
  const db = getDb();
  const normalizedStore = safeString(store).trim() || 'shawq';
  const normalizedDate = safeString(date).trim();
  const baseSignals = signals && typeof signals === 'object' ? signals : {};

  let rows = [];
  try {
    ensureVerificationTable(db);
    rows = db.prepare(`
      SELECT issue_key, status, confidence, reason, evidence_json, last_verified_at, expires_at
      FROM si_clarity_issue_verifications
      WHERE store = ? AND date = ?
    `).all(normalizedStore, normalizedDate);
  } catch (error) {
    rows = [];
    console.warn('[SessionIntelligence] attachCachedClarityVerifications failed:', error?.message || error);
  }

  const verificationByKey = new Map();
  rows.forEach((row) => {
    verificationByKey.set(safeString(row.issue_key), deserializeVerificationRow(row));
  });

  const attachList = (issueType) => {
    const list = Array.isArray(baseSignals?.[issueType]) ? baseSignals[issueType] : [];
    return list.map((item) => {
      const issueKey = buildIssueKey({
        issueType,
        page: item?.page,
        targetKey: item?.target_key,
        errorSignature: item?.message
      });
      return {
        ...item,
        verification: verificationByKey.get(issueKey) || defaultVerificationForIssue(issueType)
      };
    });
  };

  const attached = {
    rage_clicks: attachList('rage_clicks'),
    dead_clicks: attachList('dead_clicks'),
    js_errors: attachList('js_errors'),
    form_invalid: attachList('form_invalid'),
    scroll_dropoff: attachList('scroll_dropoff')
  };

  const summary = {
    total: 0,
    confirmed: 0,
    false_positive: 0,
    unverified: 0
  };

  Object.entries(attached).forEach(([issueType, list]) => {
    list.forEach((item) => {
      if (!VERIFIABLE_SIGNAL_TYPES.has(issueType)) return;
      summary.total += 1;
      const status = normalizeIssueToken(item?.verification?.status);
      if (status === 'confirmed') summary.confirmed += 1;
      else if (status === 'false_positive') summary.false_positive += 1;
      else summary.unverified += 1;
    });
  });

  return { signals: attached, summary };
}

function readExistingVerificationRow(db, store, date, issueKey) {
  return db.prepare(`
    SELECT issue_key, status, confidence, reason, evidence_json, last_verified_at, expires_at
    FROM si_clarity_issue_verifications
    WHERE store = ? AND date = ? AND issue_key = ?
  `).get(store, date, issueKey);
}

function isVerificationFresh(row, nowMs) {
  if (!row) return false;
  const expiryMs = parseSqliteDateTimeToMs(row.expires_at);
  return Number.isFinite(expiryMs) && expiryMs > nowMs;
}

function upsertVerificationRow(db, {
  store,
  date,
  issue,
  status,
  confidence,
  reason,
  evidence
}) {
  const now = toSqliteDateTime();
  const expiresAt = toSqliteDateTime(new Date(Date.now() + VERIFIER_CACHE_TTL_MINUTES * 60 * 1000));
  const issueKey = buildIssueKey({
    issueType: issue.issueType,
    page: issue.page,
    targetKey: issue.targetKey,
    errorSignature: issue.errorSignature
  });
  const normalizedStatus = normalizeIssueToken(status) || 'unverified';

  db.prepare(`
    INSERT INTO si_clarity_issue_verifications (
      store,
      date,
      issue_key,
      issue_type,
      page,
      target_key,
      error_signature,
      status,
      confidence,
      reason,
      evidence_json,
      last_verified_at,
      expires_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, date, issue_key) DO UPDATE SET
      issue_type = excluded.issue_type,
      page = excluded.page,
      target_key = excluded.target_key,
      error_signature = excluded.error_signature,
      status = excluded.status,
      confidence = excluded.confidence,
      reason = excluded.reason,
      evidence_json = excluded.evidence_json,
      last_verified_at = excluded.last_verified_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(
    store,
    date,
    issueKey,
    issue.issueType,
    issue.page,
    issue.targetKey || null,
    normalizeErrorSignature(issue.errorSignature) || null,
    normalizedStatus,
    Math.min(Math.max(Number(confidence) || 0, 0), 1),
    safeString(reason).trim() || null,
    evidence ? JSON.stringify(evidence) : null,
    now,
    expiresAt,
    now,
    now
  );
}

function normalizeObservedError(value) {
  const text = normalizeErrorSignature(value);
  return text || '';
}

async function verifyJsIssue(page, issue, issueUrl) {
  const observedErrors = [];

  const onPageError = (error) => {
    observedErrors.push(safeString(error?.message || error).trim());
  };
  const onConsole = (msg) => {
    if (safeString(msg?.type?.()).toLowerCase() !== 'error') return;
    observedErrors.push(safeString(msg?.text?.() || '').trim());
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  try {
    await page.goto(issueUrl, {
      waitUntil: 'networkidle2',
      timeout: VERIFIER_NAVIGATION_TIMEOUT_MS
    });
    await sleep(VERIFIER_POST_LOAD_WAIT_MS);

    const observedNormalized = observedErrors
      .map(normalizeObservedError)
      .filter(Boolean);
    const expected = normalizeObservedError(issue.errorSignature);
    const matched = expected
      ? observedNormalized.some((value) => value.includes(expected) || expected.includes(value))
      : observedNormalized.length > 0;

    if (matched) {
      return {
        status: 'confirmed',
        confidence: 0.9,
        reason: 'Matching JS error reproduced by verifier.',
        evidence: {
          url: issueUrl,
          observed_error_count: observedNormalized.length,
          observed_errors: observedNormalized.slice(0, 5)
        }
      };
    }

    if (observedNormalized.length === 0) {
      return {
        status: 'false_positive',
        confidence: 0.72,
        reason: 'No JS errors observed during automated verification.',
        evidence: {
          url: issueUrl,
          observed_error_count: 0
        }
      };
    }

    return {
      status: 'unverified',
      confidence: 0.45,
      reason: 'JS errors observed, but not the same signature as the cluster.',
      evidence: {
        url: issueUrl,
        observed_error_count: observedNormalized.length,
        observed_errors: observedNormalized.slice(0, 5)
      }
    };
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

async function installMutationProbe(page) {
  await page.evaluate(() => {
    try {
      if (window.__siMutObserver) {
        window.__siMutObserver.disconnect();
      }
      window.__siMutCount = 0;
      const target = document.documentElement || document.body;
      if (!target) return;
      const observer = new MutationObserver((mutations) => {
        window.__siMutCount += mutations.length;
      });
      observer.observe(target, { childList: true, subtree: true, attributes: true });
      window.__siMutObserver = observer;
    } catch (_error) {
      window.__siMutCount = Number(window.__siMutCount || 0);
    }
  });
}

async function getMutationCount(page) {
  return page.evaluate(() => Number(window.__siMutCount || 0));
}

async function verifyDeadLikeIssue(page, issue, issueUrl) {
  const selector = safeString(issue.targetKey).trim();
  if (!selector) {
    return {
      status: 'unverified',
      confidence: 0,
      reason: 'Missing selector in signal payload.',
      evidence: { url: issueUrl }
    };
  }

  await page.goto(issueUrl, {
    waitUntil: 'domcontentloaded',
    timeout: VERIFIER_NAVIGATION_TIMEOUT_MS
  });
  await sleep(VERIFIER_POST_LOAD_WAIT_MS);

  let handle = null;
  try {
    handle = await page.$(selector);
  } catch (error) {
    return {
      status: 'unverified',
      confidence: 0,
      reason: `Invalid selector syntax: ${safeString(error?.message || error).slice(0, 140)}`,
      evidence: { url: issueUrl, selector }
    };
  }

  if (!handle) {
    return {
      status: 'false_positive',
      confidence: 0.62,
      reason: 'Selector not found on page during verification.',
      evidence: { url: issueUrl, selector }
    };
  }

  await installMutationProbe(page);

  const requiredDeadAttempts = Math.max(
    1,
    Math.ceil(VERIFIER_DEAD_CLICK_ATTEMPTS * VERIFIER_DEAD_CLICK_CONFIRM_RATIO)
  );
  let deadAttempts = 0;
  let responsiveAttempts = 0;
  const attemptEvidence = [];

  for (let attempt = 1; attempt <= VERIFIER_DEAD_CLICK_ATTEMPTS; attempt += 1) {
    const beforeUrl = page.url();
    const beforeMut = await getMutationCount(page);
    let requestCount = 0;
    const onRequest = () => {
      requestCount += 1;
    };
    page.on('request', onRequest);

    let clickError = null;
    try {
      await page.$eval(selector, (el) => {
        el.scrollIntoView({ block: 'center', inline: 'center' });
      });
      await page.click(selector, { delay: 25 });
    } catch (error) {
      clickError = safeString(error?.message || error).slice(0, 140);
    }

    await sleep(VERIFIER_CLICK_SETTLE_MS);
    page.off('request', onRequest);

    const afterUrl = page.url();
    const afterMut = await getMutationCount(page);
    const mutationDelta = Math.max(0, (Number(afterMut) || 0) - (Number(beforeMut) || 0));
    const urlChanged = afterUrl !== beforeUrl;
    const isResponsive = !clickError && (urlChanged || requestCount > 0 || mutationDelta >= VERIFIER_MUTATION_THRESHOLD);

    if (isResponsive) responsiveAttempts += 1;
    else deadAttempts += 1;

    attemptEvidence.push({
      attempt,
      click_error: clickError,
      url_changed: urlChanged,
      request_count: requestCount,
      mutation_delta: mutationDelta,
      responsive: isResponsive
    });
  }

  if (deadAttempts >= requiredDeadAttempts) {
    return {
      status: 'confirmed',
      confidence: 0.88,
      reason: 'Repeated clicks produced no navigation, network, or DOM response.',
      evidence: {
        url: issueUrl,
        selector,
        dead_attempts: deadAttempts,
        responsive_attempts: responsiveAttempts,
        attempts: attemptEvidence
      }
    };
  }

  return {
    status: 'false_positive',
    confidence: 0.7,
    reason: 'Target responded to click during verification.',
    evidence: {
      url: issueUrl,
      selector,
      dead_attempts: deadAttempts,
      responsive_attempts: responsiveAttempts,
      attempts: attemptEvidence
    }
  };
}

async function verifyCandidate(page, store, issue) {
  if (!VERIFIABLE_SIGNAL_TYPES.has(issue.issueType)) {
    return {
      status: 'unverified',
      confidence: 0,
      reason: 'Auto verification not enabled for this issue type.',
      evidence: null
    };
  }

  const issueUrl = resolveIssueUrl(store, issue.page);
  if (!issueUrl) {
    return {
      status: 'unverified',
      confidence: 0,
      reason: 'Missing verifier base URL configuration for this store.',
      evidence: {
        page: issue.page,
        env: 'SESSION_INTELLIGENCE_VERIFIER_STORE_BASE_URLS'
      }
    };
  }

  if (issue.issueType === 'js_errors') {
    return verifyJsIssue(page, issue, issueUrl);
  }
  return verifyDeadLikeIssue(page, issue, issueUrl);
}

async function loadPuppeteer() {
  try {
    const mod = await import('puppeteer');
    return mod?.default || mod;
  } catch (error) {
    return null;
  }
}

async function launchVerifierBrowser(puppeteer) {
  try {
    return await puppeteer.launch({
      headless: 'new'
    });
  } catch (launchError) {
    if (!VERIFIER_ALLOW_NO_SANDBOX) throw launchError;
    return puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
}

async function runVerificationJob({ store, date, signals, force = false }) {
  const db = getDb();
  const normalizedStore = safeString(store).trim() || 'shawq';
  const normalizedDate = safeString(date).trim();
  ensureVerificationTable(db);
  const candidates = buildVerificationCandidates(signals);
  const nowMs = Date.now();

  const candidatesToVerify = candidates.filter((issue) => {
    const issueKey = buildIssueKey({
      issueType: issue.issueType,
      page: issue.page,
      targetKey: issue.targetKey,
      errorSignature: issue.errorSignature
    });
    if (force) return true;

    const existing = readExistingVerificationRow(db, normalizedStore, normalizedDate, issueKey);
    return !isVerificationFresh(existing, nowMs);
  });

  if (!candidatesToVerify.length) {
    return { success: true, verified: 0, skipped: candidates.length };
  }

  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    const reason = 'Puppeteer is not available in this runtime.';
    candidatesToVerify.forEach((issue) => {
      upsertVerificationRow(db, {
        store: normalizedStore,
        date: normalizedDate,
        issue,
        status: 'unverified',
        confidence: 0,
        reason,
        evidence: null
      });
    });
    return { success: false, verified: 0, skipped: candidates.length - candidatesToVerify.length, reason };
  }

  let browser = null;
  try {
    browser = await launchVerifierBrowser(puppeteer);
  } catch (launchError) {
    const reason = `Verifier launch failed: ${safeString(launchError?.message || launchError).slice(0, 180)}`;
    candidatesToVerify.forEach((issue) => {
      upsertVerificationRow(db, {
        store: normalizedStore,
        date: normalizedDate,
        issue,
        status: 'unverified',
        confidence: 0,
        reason,
        evidence: null
      });
    });
    return { success: false, verified: 0, skipped: candidates.length - candidatesToVerify.length, reason };
  }

  let verifiedCount = 0;
  try {
    for (const issue of candidatesToVerify) {
      const page = await browser.newPage();
      try {
        page.setDefaultNavigationTimeout(VERIFIER_NAVIGATION_TIMEOUT_MS);
        const verification = await verifyCandidate(page, normalizedStore, issue);
        upsertVerificationRow(db, {
          store: normalizedStore,
          date: normalizedDate,
          issue,
          ...verification
        });
        verifiedCount += 1;
      } catch (error) {
        upsertVerificationRow(db, {
          store: normalizedStore,
          date: normalizedDate,
          issue,
          status: 'unverified',
          confidence: 0,
          reason: safeString(error?.message || error).slice(0, 180),
          evidence: null
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser?.close().catch(() => {});
  }

  return {
    success: true,
    verified: verifiedCount,
    skipped: candidates.length - candidatesToVerify.length
  };
}

export function triggerClarityVerificationForSignals({ store, date, signals, force = false } = {}) {
  const normalizedStore = safeString(store).trim() || 'shawq';
  const normalizedDate = safeString(date).trim();
  const scopeKey = `${normalizedStore}::${normalizedDate}`;

  if (!force && verificationJobByScope.has(scopeKey)) {
    return verificationJobByScope.get(scopeKey);
  }

  const job = runVerificationJob({
    store: normalizedStore,
    date: normalizedDate,
    signals: signals && typeof signals === 'object' ? signals : {},
    force
  }).finally(() => {
    if (verificationJobByScope.get(scopeKey) === job) {
      verificationJobByScope.delete(scopeKey);
    }
  });

  verificationJobByScope.set(scopeKey, job);
  return job;
}
