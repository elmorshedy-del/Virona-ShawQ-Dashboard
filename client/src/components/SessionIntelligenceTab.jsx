import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, RefreshCw } from 'lucide-react';
import GeoHotspotsMap from './GeoHotspotsMap';
import './SessionIntelligenceTab.css';

const POLL_EVENTS_MS = 1000;
const POLL_REALTIME_MS = 5000;
const POLL_OVERVIEW_MS = 20000;
const REALTIME_WINDOW_MINUTES = 30;
const REQUEST_TIMEOUT_MS = 15000;
const REALTIME_GEO_ROWS_LIMIT = 8;

const SESSION_INTELLIGENCE_LLM_KEY = 'virona.sessionIntelligence.llm.v1';

function loadSessionIntelligenceLlmSettings() {
  try {
    const raw = window.localStorage.getItem(SESSION_INTELLIGENCE_LLM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function persistSessionIntelligenceLlmSettings(value) {
  try {
    window.localStorage.setItem(SESSION_INTELLIGENCE_LLM_KEY, JSON.stringify(value));
  } catch (_error) {
    // ignore
  }
}

const STEP_LABELS = {
  contact: 'Contact',
  shipping: 'Shipping',
  payment: 'Payment',
  review: 'Review',
  thank_you: 'Thank you',
  unknown: 'Unknown'
};

const FLOW_STAGE_LABELS = {
  landing: 'Landing',
  product: 'Product',
  atc: 'Add to cart',
  cart: 'Cart',
  checkout_contact: 'Checkout (Contact)',
  checkout_shipping: 'Checkout (Shipping)',
  checkout_payment: 'Checkout (Payment)',
  purchase: 'Purchase'
};

function parseSqliteTimestamp(ts) {
  if (!ts || typeof ts !== 'string') return null;
  if (ts.includes('T')) {
    const date = new Date(ts);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(`${ts.replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function timeAgo(ts) {
  const date = parseSqliteTimestamp(ts);
  if (!date) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function isoDayUtc(date) {
  if (!(date instanceof Date)) return '';
  return date.toISOString().slice(0, 10);
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat().format(n);
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

async function fetchJson(url, options = {}) {
  const { timeoutMs, ...fetchOptions } = options || {};
  const effectiveTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : REQUEST_TIMEOUT_MS;

  const requestOptions = { cache: 'no-store', ...fetchOptions };
  let timeoutId = null;
  let controller = null;
  if (!requestOptions.signal && effectiveTimeoutMs > 0) {
    controller = new AbortController();
    requestOptions.signal = controller.signal;
    timeoutId = setTimeout(() => {
      controller.abort();
    }, effectiveTimeoutMs);
  }

  let res;
  let raw;
  try {
    res = await fetch(url, requestOptions);
    raw = await res.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(effectiveTimeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const contentType = res.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    const snippet = raw.slice(0, 200);
    throw new Error(`Expected JSON but got ${contentType || 'unknown'}: ${snippet}`);
  }

  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  }
  if (!data?.success) {
    throw new Error(data?.error || 'Invalid response');
  }
  return data;
}

function normalizeStepLabel(step) {
  const key = (step || '').toString().toLowerCase().trim();
  if (!key) return '—';
  return STEP_LABELS[key] || key;
}

function normalizeCheckoutStepKey(step) {
  const key = (step || '').toString().toLowerCase().trim();
  if (!key) return null;
  if (key === 'contact' || key === 'shipping' || key === 'payment' || key === 'review' || key === 'thank_you') return key;
  return null;
}

function inferDropoffStageFromSummary(session) {
  if (!session || typeof session !== 'object') return 'landing';
  if (Number(session.purchase_events || 0) > 0) return 'purchase';

  if (Number(session.checkout_started_events || 0) > 0) {
    const step = normalizeCheckoutStepKey(session.last_checkout_step);
    if (step === 'payment') return 'checkout_payment';
    if (step === 'shipping') return 'checkout_shipping';
    return 'checkout_contact';
  }

  if (Number(session.cart_events || 0) > 0) return 'cart';
  if (Number(session.atc_events || 0) > 0) return 'atc';
  if (Number(session.product_views || 0) > 0) return 'product';
  return 'landing';
}

function formatPercent(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function formatDurationSeconds(value) {
  const sec = Number(value);
  if (!Number.isFinite(sec)) return '—';
  const rounded = Math.max(0, Math.round(sec));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

let regionDisplayNames = null;
function countryNameFromCode(value) {
  const code = (value || '').toString().trim().toUpperCase();
  if (!code) return '—';
  if (!/^[A-Z]{2}$/.test(code)) return code;

  try {
    if (!regionDisplayNames && typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      regionDisplayNames = new Intl.DisplayNames(undefined, { type: 'region' });
    }
    const resolved = regionDisplayNames?.of(code);
    return resolved || code;
  } catch (_error) {
    return code;
  }
}

const EVENT_LABEL_OVERRIDES = {
  page_viewed: 'Page Viewed',
  page_view: 'Page Viewed',
  view_item: 'Product Viewed',
  product_viewed: 'Product Viewed',
  cart_viewed: 'Cart Viewed',
  view_cart: 'Cart Viewed',
  product_added_to_cart: 'Add to Cart',
  add_to_cart: 'Add to Cart',
  added_to_cart: 'Add to Cart',
  cart_add: 'Add to Cart',
  atc: 'Add to Cart',
  si_atc_success: 'Add to Cart',
  si_variant_changed: 'Variant Changed',
  checkout_started: 'Checkout Started',
  checkout_initiated: 'Checkout Started',
  begin_checkout: 'Checkout Started',
  payment_info_submitted: 'Payment Info Submitted',
  checkout_completed: 'Purchase',
  purchase: 'Purchase',
  order_completed: 'Purchase',
  order_placed: 'Purchase'
};

function normalizeEventLabel(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return '—';
  const key = raw.toLowerCase();
  if (EVENT_LABEL_OVERRIDES[key]) return EVENT_LABEL_OVERRIDES[key];

  // Fallback: "some_event-name" -> "Some event name"
  const cleaned = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return raw;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalizeTrafficSourceLabel(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return '—';

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
  if (key === 'snap' || key.includes('snapchat')) return 'Snapchat';
  if (key.includes('google') || key.includes('adwords') || key.includes('gads')) return 'Google';

  const cleaned = lower
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return raw;

  const ACRONYMS = new Set(['sms', 'seo', 'ppc', 'cpc', 'ga', 'api', 'ai']);
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      if (word === 'ads') return 'Ads';
      if (word === 'ad') return 'Ad';
      return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    })
    .join(' ');
}

function normalizeTrafficSourceTitle(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return '';
  const label = normalizeTrafficSourceLabel(raw);
  if (!label || label === raw) return label || raw;
  return `${label} (${raw})`;
}

function normalizeDeviceLabel(value) {
  const raw = (value || '').toString().trim();
  if (!raw) return '—';
  const key = raw.toLowerCase().trim();
  if (key === 'ios') return 'iOS';
  if (key === 'android') return 'Android';
  if (key === 'ipados') return 'iPadOS';
  if (key === 'mobile') return 'Mobile';
  if (key === 'desktop') return 'Desktop';
  if (key === 'tablet') return 'Tablet';
  if (key === 'android tablet') return 'Android Tablet';
  return raw;
}

function normalizeLooseKey(value) {
  return (value || '').toString().toLowerCase().trim();
}

function normalizeVerificationStatus(status, issueType) {
  if (!VERIFIABLE_ISSUE_TYPES.has(issueType)) return 'not_applicable';
  const normalized = normalizeLooseKey(status);
  if (normalized === 'confirmed') return 'confirmed';
  if (normalized === 'false_positive') return 'false_positive';
  return 'unverified';
}

function verificationUi(status) {
  if (status === 'confirmed') return { label: 'Confirmed', className: 'si-verify-confirmed' };
  if (status === 'false_positive') return { label: 'False alert', className: 'si-verify-false-positive' };
  if (status === 'not_applicable') return { label: 'N/A', className: 'si-verify-na' };
  return { label: 'Pending', className: 'si-verify-pending' };
}

function pluralize(value, singular, plural) {
  const count = Number(value) || 0;
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function quantile(values, q) {
  const list = (Array.isArray(values) ? values : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (list.length === 0) return 0;
  const position = clamp01(q) * (list.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return list[lower];
  const weight = position - lower;
  return list[lower] * (1 - weight) + list[upper] * weight;
}

const ISSUE_META = {
  js_errors: {
    label: 'JS error cluster',
    severityWeight: 1.0,
    countLabel: 'errors',
    action: 'Identify and remove the failing script or runtime hook; redeploy and confirm errors drop to zero.'
  },
  dead_clicks: {
    label: 'Dead click cluster',
    severityWeight: 0.85,
    countLabel: 'dead clicks',
    action: 'Make the element produce a visible state change or navigation; remove non-interactive click targets.'
  },
  rage_clicks: {
    label: 'Rage click cluster',
    severityWeight: 0.92,
    countLabel: 'rage clicks',
    action: 'Reduce interaction delay and make the clicked target respond immediately.'
  },
  form_invalid: {
    label: 'Form validation friction',
    severityWeight: 0.9,
    countLabel: 'invalid submits',
    action: 'Relax strict validation and surface inline field guidance before submit.'
  },
  scroll_dropoff: {
    label: 'Scroll drop-off',
    severityWeight: 0.72,
    countLabel: 'sessions',
    action: 'Move primary CTA and trust signals higher on page to reduce early drop-off.'
  }
};

const VERIFIABLE_ISSUE_TYPES = new Set(['js_errors', 'dead_clicks', 'rage_clicks']);

const ISSUE_VERIFICATION_VIEW = {
  CONFIRMED_FIRST: 'confirmed_first',
  ALL: 'all'
};

const TARGET_KEY_RULES = [
  { key: 'summary.accordion__summary', label: 'Accordion toggle' },
  { key: 'product-card__media', label: 'Product card image' },
  { key: 'scroll-marker', label: 'Scroll indicator' },
  { key: 'wizz-checkout-button', label: 'Checkout button' },
  { key: 'tap-area', label: 'Tap action button' }
];

const ERROR_SIGNATURE_RULES = [
  {
    keywords: ['mutationobserver', 'observe'],
    label: 'Script conflict on page',
    match: 'all'
  },
  {
    keywords: ['_autofillcallbackhandler'],
    label: 'Autofill script conflict',
    match: 'any'
  },
  {
    keywords: ['load failed'],
    label: 'External script failed to load',
    match: 'any'
  },
  {
    keywords: ['failed to fetch', 'networkerror'],
    label: 'Network request failed',
    match: 'any'
  },
  {
    keywords: ['unexpected end of json'],
    label: 'JSON response truncated',
    match: 'any'
  }
];

const DEVELOPER_FIX_PLAYBOOK = {
  js_errors: {
    default: [
      'Open the affected page in browser devtools and reproduce the issue in Console + Network.',
      'Identify the failing app/script, then disable or patch that integration in theme code.',
      'Redeploy and verify the same page shows zero repeated JS errors for 24 hours.'
    ],
    bySignature: {
      'Script conflict on page': [
        'Find duplicated DOM observers or scripts attaching to removed elements.',
        'Guard observer setup with element existence checks before calling observe().',
        'Deploy and confirm this error group stops growing on the affected page.'
      ],
      'Autofill script conflict': [
        'Search installed apps/theme scripts for `_AutofillCallbackHandler` references.',
        'Load the required script earlier or remove the stale callback dependency.',
        'Retest checkout and product pages in Safari and Chrome.'
      ],
      'External script failed to load': [
        'Open Network tab and locate the failing third-party script URL and status.',
        'Fix CSP, domain allowlist, or script URL/version mismatch in theme/app settings.',
        'Verify retries are not flooding errors after deployment.'
      ],
      'Network request failed': [
        'Inspect failing endpoint calls and confirm CORS/auth headers are valid.',
        'Add retry/backoff only for transient failures; avoid infinite retry loops.',
        'Verify affected action succeeds for both mobile and desktop sessions.'
      ],
      'JSON response truncated': [
        'Inspect endpoint payloads and ensure they return valid JSON on all branches.',
        'Handle empty/partial payloads defensively before `response.json()` parsing.',
        'Deploy and verify parsing errors no longer occur in recent sessions.'
      ]
    }
  },
  dead_clicks: {
    default: [
      'Confirm the clicked element is truly interactive (button/link) and has a bound action.',
      'If it is decorative only, remove pointer cursor/click handlers to avoid false affordance.',
      'Retest the element and confirm clicks lead to visible UI change or navigation.'
    ]
  },
  rage_clicks: {
    default: [
      'Measure interaction latency on the target and identify slow script/network paths.',
      'Provide immediate visual feedback on click and prevent duplicate blocked clicks.',
      'Retest under mobile throttling to confirm frustration pattern disappears.'
    ]
  },
  form_invalid: {
    default: [
      'Log invalid field names/types and identify the highest-frequency failing inputs.',
      'Add inline validation hints before submit, not only after submit failure.',
      'Relax strict rules where possible and confirm conversion improves next day.'
    ]
  },
  scroll_dropoff: {
    default: [
      'Move key product value, trust, and CTA blocks above the first major fold break.',
      'Reduce heavy media before CTA and improve mobile rendering speed.',
      'Compare 75% reach rate day-over-day after layout update.'
    ]
  }
};

function normalizeTargetKey(rawValue) {
  const raw = (rawValue || '').toString().trim();
  if (!raw) return 'Unknown target';
  const lower = raw.toLowerCase();

  for (const rule of TARGET_KEY_RULES) {
    if (lower.includes(rule.key)) return rule.label;
  }

  const normalized = raw
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[.#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'Interactive element';
  const short = normalized
    .split(' ')
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function normalizeErrorSignature(rawValue) {
  const raw = (rawValue || '').toString().trim();
  if (!raw) return 'Unknown runtime error';
  const lower = raw.toLowerCase();
  for (const rule of ERROR_SIGNATURE_RULES) {
    const matches = rule.match === 'all'
      ? rule.keywords.every((keyword) => lower.includes(keyword))
      : rule.keywords.some((keyword) => lower.includes(keyword));
    if (matches) return rule.label;
  }
  return raw.length > 90 ? `${raw.slice(0, 90)}...` : raw;
}

function buildIssueWhereLabel(type, issue) {
  const page = formatPathLabel(issue?.page || '');
  if (type === 'dead_clicks' || type === 'rage_clicks') {
    return `${page} • ${normalizeTargetKey(issue?.target_key)}`;
  }
  if (type === 'js_errors') {
    return `${page} • ${normalizeErrorSignature(issue?.message)}`;
  }
  if (type === 'form_invalid') {
    const field = [issue?.field_type, issue?.field_name].filter(Boolean).join(' ');
    return field ? `${page} • ${field}` : `${page} • Form validation`;
  }
  if (type === 'scroll_dropoff') {
    const reached75 = Number(issue?.reached_75) || 0;
    const total = Number(issue?.total_sessions) || 0;
    const ratio = total > 0 ? reached75 / total : 0;
    return `${page} • 75% reach ${formatPercent(ratio, 0)}`;
  }
  return page;
}

function buildDeveloperFixSteps(row) {
  const entry = DEVELOPER_FIX_PLAYBOOK[row?.type];
  if (!entry) return [];
  if (row?.type === 'js_errors') {
    const signature = row?.errorLabel || '';
    if (signature && entry.bySignature?.[signature]) {
      return entry.bySignature[signature];
    }
  }
  return entry.default || [];
}

function buildClarityIssueRows({ claritySignals, librarySessions, selectedDay }) {
  const sessions = Array.isArray(librarySessions) ? librarySessions : [];
  const claritySelectedSessions = Math.max(0, Number(claritySignals?.totals?.sessions) || 0);
  const claritySourceSessions = Math.max(0, Number(claritySignals?.totals?.source_sessions) || 0);
  const totalSessionUniverse = Math.max(sessions.length, claritySourceSessions, claritySelectedSessions);
  const highIntentNoPurchaseSessions = sessions.filter((s) => {
    const atc = Number(s?.atc_events) || 0;
    const checkout = Number(s?.checkout_started_events) || 0;
    const purchase = Number(s?.purchase_events) || 0;
    return (atc > 0 || checkout > 0) && purchase === 0;
  });

  const highIntentFromLibrary = highIntentNoPurchaseSessions.length;
  const highIntentFromClarity = claritySignals?.mode === 'high_intent_no_purchase'
    ? claritySelectedSessions
    : 0;
  const eligibleHighIntent = Math.min(
    totalSessionUniverse,
    Math.max(highIntentFromLibrary, highIntentFromClarity)
  );

  const dayRecencyWeight = (() => {
    if (!selectedDay) return 1;
    const timestamp = Date.parse(`${selectedDay}T23:59:59Z`);
    if (!Number.isFinite(timestamp)) return 1;
    const dayDiff = Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
    return 1 / (1 + dayDiff);
  })();

  const collected = [];
  const signalMap = claritySignals?.signals || {};
  const issueTypes = Object.keys(ISSUE_META);

  issueTypes.forEach((type) => {
    const list = Array.isArray(signalMap[type]) ? signalMap[type] : [];
    const meta = ISSUE_META[type];
    list.forEach((issue, index) => {
      const sessionsAffected = Math.max(0, Number(issue?.sessions) || 0);
      const observations = Math.max(sessionsAffected, Number(issue?.count || issue?.total_sessions) || 0);
      const affectedHighIntent = eligibleHighIntent > 0
        ? Math.min(sessionsAffected, eligibleHighIntent)
        : sessionsAffected;
      const verificationStatus = normalizeVerificationStatus(issue?.verification?.status, type);
      const verificationReason = (issue?.verification?.reason || '').toString().trim() || null;
      const isVerifiable = VERIFIABLE_ISSUE_TYPES.has(type);

      const priorAlpha = 1;
      const priorBeta = 1;
      const posteriorMean = eligibleHighIntent > 0
        ? (affectedHighIntent + priorAlpha) / (eligibleHighIntent + priorAlpha + priorBeta)
        : 0;
      const evidenceStrength = Math.log1p(observations);

      collected.push({
        id: `${type}-${index}`,
        type,
        issueLabel: meta.label,
        pageLabel: formatPathLabel(issue?.page || ''),
        targetLabel: type === 'dead_clicks' || type === 'rage_clicks' ? normalizeTargetKey(issue?.target_key) : '',
        errorLabel: type === 'js_errors' ? normalizeErrorSignature(issue?.message) : '',
        whereLabel: buildIssueWhereLabel(type, issue),
        action: meta.action,
        severityWeight: meta.severityWeight,
        countLabel: meta.countLabel,
        sessionsAffected,
        affectedHighIntent,
        highIntentRate: eligibleHighIntent > 0 ? affectedHighIntent / eligibleHighIntent : 0,
        observations,
        confidenceRaw: posteriorMean * evidenceStrength,
        recencyWeight: dayRecencyWeight,
        rawErrorMessage: type === 'js_errors' ? (issue?.message || '') : '',
        sampleSessions: Array.isArray(issue?.sample_sessions) ? issue.sample_sessions : [],
        isVerifiable,
        verificationStatus,
        verificationReason
      });
    });
  });

  if (collected.length === 0) {
    return {
      rows: [],
      eligibleHighIntent,
      highIntentSessions: eligibleHighIntent,
      totalSessions: totalSessionUniverse,
      purchases: sessions.filter((s) => (Number(s?.purchase_events) || 0) > 0).length
    };
  }

  const maxConfidence = Math.max(...collected.map((row) => row.confidenceRaw), 1);
  const withScores = collected.map((row) => {
    const confidenceScore = clamp01(row.confidenceRaw / maxConfidence);
    const impactScore = row.affectedHighIntent * row.severityWeight * row.recencyWeight;
    const score = impactScore * (0.4 + confidenceScore * 0.6);
    return { ...row, confidenceScore, impactScore, score };
  });

  const confidenceValues = withScores.map((row) => row.confidenceScore);
  const medCut = quantile(confidenceValues, 0.34);
  const highCut = quantile(confidenceValues, 0.67);

  const rows = withScores
    .sort((a, b) => b.score - a.score)
    .map((row, idx) => ({
      ...row,
      rank: idx + 1,
      confidenceLabel: row.confidenceScore >= highCut
        ? 'High'
        : row.confidenceScore >= medCut
          ? 'Med'
          : 'Low'
    }));

  const purchases = sessions.filter((s) => (Number(s?.purchase_events) || 0) > 0).length;
  return {
    rows,
    eligibleHighIntent,
    highIntentSessions: eligibleHighIntent,
    totalSessions: totalSessionUniverse,
    purchases
  };
}

function inferDropoffStageFromBriefText(text) {
  const raw = (text || '').toString().toLowerCase();
  if (!raw) return null;
  if (raw.includes('payment')) return 'checkout_payment';
  if (raw.includes('shipping')) return 'checkout_shipping';
  if (raw.includes('contact')) return 'checkout_contact';
  if (raw.includes('checkout')) return 'checkout_contact';
  if (raw.includes('cart')) return 'cart';
  if (raw.includes('add to cart') || raw.includes('added to cart') || raw.includes('atc')) return 'atc';
  if (raw.includes('product')) return 'product';
  return null;
}

function campaignCellProps(utmSource, utmCampaign) {
  const sourceRaw = (utmSource || '').toString().trim();
  const campaignRaw = (utmCampaign || '').toString().trim();

  const sourceLabel = sourceRaw ? normalizeTrafficSourceLabel(sourceRaw) : '';
  const titleParts = [];
  if (sourceRaw) titleParts.push(normalizeTrafficSourceTitle(sourceRaw));
  if (campaignRaw) titleParts.push(campaignRaw);

  return {
    display: campaignRaw || sourceLabel || '—',
    title: titleParts.join(' / ')
  };
}

function safeDecodePath(value) {
  const raw = (value || '').toString();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

function stripLocalePrefix(path) {
  const p = (path || '').toString();
  if (!p.startsWith('/')) return p;
  const parts = p.split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  const first = parts[0];
  if (/^[a-z]{2}$/i.test(first)) {
    const rest = parts.slice(1).join('/');
    return `/${rest}`;
  }
  return `/${parts.join('/')}`;
}

function titleFromHandle(handle) {
  const decoded = safeDecodePath(handle).replace(/[-_]+/g, ' ').trim();
  if (!decoded) return null;
  const words = decoded.split(/\s+/);
  const capped = words
    .slice(0, 10)
    .map((w) => (/^[A-Za-z]/.test(w) ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : w))
    .join(' ');
  return capped;
}

function formatPathLabel(path, checkoutStep) {
  const raw = (path || '').toString();
  if (!raw) return '—';

  const cleaned = stripLocalePrefix(raw);
  const withoutQuery = cleaned.split('?')[0].split('#')[0];
  if (withoutQuery === '/' || withoutQuery === '') return 'Home';

  if (withoutQuery.startsWith('/checkouts/')) {
    const step = checkoutStep ? ` • ${normalizeStepLabel(checkoutStep)}` : '';
    return `Checkout${step}`;
  }

  if (withoutQuery === '/cart' || withoutQuery.startsWith('/cart/')) return 'Cart';
  if (withoutQuery === '/search' || withoutQuery.startsWith('/search')) return 'Search';

  const parts = withoutQuery.split('/').filter(Boolean);
  if (parts[0] === 'products' && parts[1]) {
    const title = titleFromHandle(parts[1]);
    return title ? `Product • ${title}` : 'Product';
  }
  if (parts[0] === 'collections' && parts[1]) {
    const title = titleFromHandle(parts[1]);
    return title ? `Collection • ${title}` : 'Collection';
  }
  if (parts[0] === 'pages' && parts[1]) {
    const title = titleFromHandle(parts[1]);
    return title ? `Page • ${title}` : 'Page';
  }

  const title = titleFromHandle(parts[0]);
  return title ? title : withoutQuery;
}

function fnv1a32(input) {
  const str = (input || '').toString();
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

function toCode(prefix, raw, width = 6) {
  if (!raw) return '—';
  const code = fnv1a32(raw).toString(36).toUpperCase();
  const padded = code.padStart(width, '0');
  return `${prefix}-${padded.slice(-width)}`;
}

function formatShopperNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `Shopper-${String(Math.trunc(n)).padStart(4, '0')}`;
}

function userLabel(row) {
  if (!row || typeof row !== 'object') return '—';
  const shopper = formatShopperNumber(row.shopper_number ?? row.shopperNumber);
  if (shopper) return shopper;
  const clientId = row.client_id || row.clientId || null;
  if (clientId) return toCode('Visitor', clientId, 6);
  const sessionId = row.session_id || row.sessionId || null;
  return sessionId ? toCode('Session', sessionId, 6) : '—';
}

export default function SessionIntelligenceTab({ store }) {
  const storeId = store?.id || 'shawq';

  const [overview, setOverview] = useState(null);
  const [brief, setBrief] = useState(null);
  const [realtime, setRealtime] = useState(null);
  const [realtimeLoading, setRealtimeLoading] = useState(false);
  const [realtimeError, setRealtimeError] = useState('');
  const [realtimeMapMode, setRealtimeMapMode] = useState('world');
  const [flowMode, setFlowMode] = useState('high_intent_no_purchase');
  const [flowData, setFlowData] = useState(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowError, setFlowError] = useState('');
  const [dropoffStageFilter, setDropoffStageFilter] = useState('');
  const [dropoffDeviceFilter, setDropoffDeviceFilter] = useState('');
  const [dropoffCountryFilter, setDropoffCountryFilter] = useState('');
  const [dropoffCampaignFilter, setDropoffCampaignFilter] = useState('');
  const [claritySignals, setClaritySignals] = useState(null);
  const [clarityLoading, setClarityLoading] = useState(false);
  const [clarityError, setClarityError] = useState('');

  const [storyOpen, setStoryOpen] = useState(false);
  const [storySession, setStorySession] = useState(null);
  const [storyEvents, setStoryEvents] = useState([]);
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState('');
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsStatus, setEventsStatus] = useState('idle');
  const [sanityOpen, setSanityOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [issueVerificationView, setIssueVerificationView] = useState(ISSUE_VERIFICATION_VIEW.CONFIRMED_FIRST);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const [libraryDays, setLibraryDays] = useState([]);
  const [libraryDay, setLibraryDay] = useState('');
  const [librarySessions, setLibrarySessions] = useState([]);
  const [librarySessionId, setLibrarySessionId] = useState('');
  const [libraryEvents, setLibraryEvents] = useState([]);
  const [libraryError, setLibraryError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeLimit, setAnalyzeLimit] = useState(20);
  const [highIntentOnly, setHighIntentOnly] = useState(false);
  const [analysisLlm, setAnalysisLlm] = useState(() => (
    loadSessionIntelligenceLlmSettings() || { model: 'deepseek-reasoner', temperature: 1.0 }
  ));
  const [briefGenerating, setBriefGenerating] = useState(false);
  const [briefGenerateError, setBriefGenerateError] = useState('');

  const latestEventIdRef = useRef(null);
  const libraryTimelineRef = useRef(null);

  useEffect(() => {
    persistSessionIntelligenceLlmSettings(analysisLlm);
  }, [analysisLlm]);

  const openStory = useCallback(async (sessionId, stub = null) => {
    if (!libraryDay || !sessionId) return;
    setStoryOpen(true);
    setStorySession(stub);
    setStoryEvents([]);
    setStoryError('');
    setStoryLoading(true);

    try {
      const params = new URLSearchParams({
        store: storeId,
        date: libraryDay,
        sessionId: String(sessionId),
        limit: '1200'
      });
      const payload = await fetchJson(`/api/session-intelligence/events-by-day?${params.toString()}`);
      setStoryEvents(Array.isArray(payload.events) ? payload.events : []);

      if (!stub) {
        const found = librarySessions.find((s) => s.session_id === sessionId) || null;
        setStorySession(found);
      }
    } catch (error) {
      console.error('[SessionIntelligenceTab] story load failed:', error);
      setStoryError(error?.message || 'Failed to load session story');
      setStoryEvents([]);
    } finally {
      setStoryLoading(false);
    }
  }, [libraryDay, librarySessions, storeId]);

  const closeStory = useCallback(() => {
    setStoryOpen(false);
    setStorySession(null);
    setStoryEvents([]);
    setStoryError('');
  }, []);

  const loadRealtime = useCallback(async () => {
    setRealtimeLoading(true);
    setRealtimeError('');
    try {
      const params = new URLSearchParams({
        store: storeId,
        windowMinutes: String(REALTIME_WINDOW_MINUTES),
        limit: '10'
      });
      const payload = await fetchJson(`/api/session-intelligence/realtime?${params.toString()}`);
      setRealtime(payload?.data || null);
    } catch (error) {
      console.error('[SessionIntelligenceTab] realtime load failed:', error);
      setRealtimeError(error?.message || 'Failed to load realtime overview');
      setRealtime(null);
    } finally {
      setRealtimeLoading(false);
    }
  }, [storeId]);

  const loadFlow = useCallback(async (day, mode) => {
    if (!day) return;
    setFlowLoading(true);
    setFlowError('');
    try {
      const params = new URLSearchParams({
        store: storeId,
        date: day,
        mode: mode || 'all',
        limitSessions: '5000'
      });
      const payload = await fetchJson(`/api/session-intelligence/flow?${params.toString()}`);
      setFlowData(payload?.data || null);
    } catch (error) {
      console.error('[SessionIntelligenceTab] flow load failed:', error);
      setFlowError(error?.message || 'Failed to load shop walk flow');
      setFlowData(null);
    } finally {
      setFlowLoading(false);
    }
  }, [storeId]);

  const loadClarity = useCallback(async (day, mode) => {
    if (!day) return;
    setClarityLoading(true);
    setClarityError('');
    try {
      const params = new URLSearchParams({
        store: storeId,
        date: day,
        mode: mode || 'high_intent_no_purchase',
        limitSessions: '5000'
      });
      const payload = await fetchJson(`/api/session-intelligence/clarity?${params.toString()}`);
      setClaritySignals(payload?.data || null);
    } catch (error) {
      console.error('[SessionIntelligenceTab] clarity load failed:', error);
      setClarityError(error?.message || 'Failed to load clarity signals');
      setClaritySignals(null);
    } finally {
      setClarityLoading(false);
    }
  }, [storeId]);

  const loadOverview = useCallback(async () => {
    const url = `/api/session-intelligence/overview?store=${encodeURIComponent(storeId)}`;
    const data = await fetchJson(url);
    setOverview(data.data);
  }, [storeId]);

  const loadBrief = useCallback(async (day = null) => {
    const params = new URLSearchParams({ store: storeId });
    if (day) params.set('date', day);
    const url = `/api/session-intelligence/brief?${params.toString()}`;
    const data = await fetchJson(url);
    setBrief(data.brief || null);
  }, [storeId]);

  const loadEvents = useCallback(async () => {
    const url = `/api/session-intelligence/events?store=${encodeURIComponent(storeId)}&limit=80`;
    const data = await fetchJson(url);
    const list = Array.isArray(data.events) ? data.events : [];
    setEvents(list);
    setLastUpdatedAt(new Date().toISOString());
    setEventsStatus('ok');

    if (list.length) {
      const latestId = list[0]?.id || null;
      if (latestId && latestEventIdRef.current && latestId !== latestEventIdRef.current) {
        // We can add a subtle pulse here later if needed.
      }
      latestEventIdRef.current = latestId;
    }
  }, [storeId]);

  const loadSessions = useCallback(async () => {
    const url = `/api/session-intelligence/sessions?store=${encodeURIComponent(storeId)}&limit=80`;
    const data = await fetchJson(url);
    const list = Array.isArray(data.sessions) ? data.sessions : [];
    setSessions(list);
  }, [storeId]);

  const loadLibraryDays = useCallback(async () => {
    const url = `/api/session-intelligence/days?store=${encodeURIComponent(storeId)}&limit=10`;
    const data = await fetchJson(url);
    const days = Array.isArray(data.days) ? data.days : [];
    setLibraryDays(days);
    if (days.length > 0) {
      setLibraryDay((current) => current || days[0].day);
    }
  }, [storeId]);

  useEffect(() => {
    if (!libraryDay) return;
    loadBrief(libraryDay).catch((error) => {
      console.error('[SessionIntelligenceTab] brief load failed:', error);
    });
  }, [libraryDay, loadBrief]);

  useEffect(() => {
    if (!libraryDay) return;
    loadFlow(libraryDay, flowMode);
  }, [libraryDay, flowMode, loadFlow]);

  useEffect(() => {
    if (!libraryDay) return;
    loadClarity(libraryDay, flowMode);
  }, [libraryDay, flowMode, loadClarity]);

  const filteredLibrarySessions = useMemo(() => {
    let list = librarySessions;

    if (highIntentOnly) {
      list = list.filter((s) =>
        Number(s.atc_events) > 0 ||
        Number(s.checkout_started_events) > 0 ||
        Number(s.purchase_events) > 0
      );
    }

    if (dropoffStageFilter) {
      list = list.filter((s) => inferDropoffStageFromSummary(s) === dropoffStageFilter);
    }

    if (dropoffDeviceFilter) {
      const target = normalizeLooseKey(dropoffDeviceFilter);
      if (target === '—') {
        list = list.filter((s) => !normalizeLooseKey(s.device_type));
      } else {
        list = list.filter((s) => normalizeLooseKey(s.device_type) === target);
      }
    }

    if (dropoffCountryFilter) {
      const target = normalizeLooseKey(dropoffCountryFilter);
      if (target === '—') {
        list = list.filter((s) => !normalizeLooseKey(s.country_code));
      } else {
        list = list.filter((s) => normalizeLooseKey(s.country_code) === target);
      }
    }

    if (dropoffCampaignFilter) {
      const target = dropoffCampaignFilter;
      if (target === '—') {
        list = list.filter((s) => !(s.utm_campaign || '').toString().trim());
      } else {
        list = list.filter((s) => (s.utm_campaign || '') === target);
      }
    }

    return list;
  }, [dropoffCampaignFilter, dropoffCountryFilter, dropoffDeviceFilter, dropoffStageFilter, highIntentOnly, librarySessions]);

  const loadLibrarySessions = useCallback(async (day) => {
    if (!day) return;
    const url = `/api/session-intelligence/sessions-by-day?store=${encodeURIComponent(storeId)}&date=${encodeURIComponent(day)}&limit=200`;
    const data = await fetchJson(url);
    setLibrarySessions(Array.isArray(data.sessions) ? data.sessions : []);
  }, [storeId]);

  const loadLibraryEvents = useCallback(async (day, sessionId) => {
    if (!day || !sessionId) return;
    const url = `/api/session-intelligence/events-by-day?store=${encodeURIComponent(storeId)}&date=${encodeURIComponent(day)}&sessionId=${encodeURIComponent(sessionId)}&limit=1200`;
    const data = await fetchJson(url);
    setLibraryEvents(Array.isArray(data.events) ? data.events : []);
  }, [storeId]);

  const manualRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadRealtime(),
        loadOverview(),
        loadBrief(),
        loadFlow(libraryDay, flowMode),
        loadClarity(libraryDay, flowMode),
        loadSessions(),
        loadEvents(),
        loadLibraryDays()
      ]);
    } finally {
      setLoading(false);
    }
  }, [flowMode, libraryDay, loadBrief, loadClarity, loadEvents, loadFlow, loadLibraryDays, loadOverview, loadRealtime, loadSessions]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEventsStatus('loading');

    Promise.all([loadRealtime(), loadOverview(), loadBrief(), loadSessions(), loadEvents(), loadLibraryDays()])
      .catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] initial load failed:', error);
        setEventsStatus('error');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    const realtimeTimer = setInterval(() => {
      loadRealtime().catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] realtime poll failed:', error);
      });
    }, POLL_REALTIME_MS);

    const eventsTimer = setInterval(() => {
      loadEvents().catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] events poll failed:', error);
        setEventsStatus('error');
      });
    }, POLL_EVENTS_MS);

    const overviewTimer = setInterval(() => {
      loadOverview().catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] overview poll failed:', error);
      });
      loadSessions().catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] sessions poll failed:', error);
      });
    }, POLL_OVERVIEW_MS);

    return () => {
      active = false;
      clearInterval(realtimeTimer);
      clearInterval(eventsTimer);
      clearInterval(overviewTimer);
    };
  }, [loadBrief, loadEvents, loadLibraryDays, loadOverview, loadRealtime, loadSessions]);

  useEffect(() => {
    setLibraryError('');
    setLibrarySessions([]);
    setLibraryEvents([]);
    setLibrarySessionId('');

    if (!libraryDay) return;

    loadLibrarySessions(libraryDay).catch((error) => {
      console.error('[SessionIntelligenceTab] library sessions load failed:', error);
      setLibraryError(error?.message || 'Failed to load day sessions');
    });
  }, [libraryDay, loadLibrarySessions]);

  useEffect(() => {
    setLibraryError('');
    setLibraryEvents([]);
    if (!libraryDay || !librarySessionId) return;

    loadLibraryEvents(libraryDay, librarySessionId).catch((error) => {
      console.error('[SessionIntelligenceTab] library events load failed:', error);
      setLibraryError(error?.message || 'Failed to load session events');
    });
  }, [libraryDay, librarySessionId, loadLibraryEvents]);

  useEffect(() => {
    if (!librarySessionId) return;
    // Make "View" feel instant even if the timeline is below the fold.
    libraryTimelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [librarySessionId]);

  const dropoffChips = useMemo(() => {
    const byStep = overview?.checkoutDropoffsByStep || {};
    const entries = Object.entries(byStep)
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0));
    return entries.slice(0, 8);
  }, [overview]);

  const latestEventAt = events?.[0]?.created_at || null;

  const abandonAfterHours = overview?.abandonAfterHours ?? 24;
  const checkoutDropMinutes = overview?.checkoutDropMinutes ?? 30;
  const abandonCutoffMs = Date.now() - abandonAfterHours * 60 * 60 * 1000;

  const selectedLibrarySession = useMemo(() => {
    if (!librarySessionId) return null;
    return librarySessions.find((s) => s.session_id === librarySessionId) || null;
  }, [librarySessionId, librarySessions]);

  const timelineLabel = useMemo(() => {
    if (!librarySessionId) return '—';
    const shopper = formatShopperNumber(selectedLibrarySession?.shopper_number ?? selectedLibrarySession?.shopperNumber);
    const sessionCode = toCode('Session', selectedLibrarySession?.session_id || librarySessionId, 6);
    if (shopper) return `${shopper} • ${sessionCode}`;
    return userLabel(selectedLibrarySession || { session_id: librarySessionId });
  }, [librarySessionId, selectedLibrarySession]);

  const mostViewedNotBought = overview?.insights?.mostViewedNotBought || [];
  const outOfStockSizesClicked = overview?.insights?.outOfStockSizesClicked || [];

  const abandonedSessions = useMemo(() => {
    if (!Array.isArray(sessions) || sessions.length === 0) return [];
    return sessions
      .filter((s) => s?.atc_at && !s?.purchase_at)
      .filter((s) => {
        const atcDate = parseSqliteTimestamp(s.atc_at);
        if (!atcDate) return false;
        return atcDate.getTime() <= abandonCutoffMs;
      })
      .sort((a, b) => {
        const aDate = parseSqliteTimestamp(a.atc_at)?.getTime() || 0;
        const bDate = parseSqliteTimestamp(b.atc_at)?.getTime() || 0;
        return bDate - aDate;
      })
      .slice(0, 20);
  }, [abandonCutoffMs, sessions]);

  const getCartSummary = useCallback((lastCartJson) => {
    if (!lastCartJson || typeof lastCartJson !== 'string') return '—';
    try {
      const cart = JSON.parse(lastCartJson);
      const items =
        cart?.lines ||
        cart?.lineItems ||
        cart?.items ||
        cart?.cartLines ||
        cart?.cart_lines ||
        null;
      if (!Array.isArray(items) || items.length === 0) return '—';

      const first = items[0];
      const title =
        first?.merchandise?.product?.title ||
        first?.merchandise?.title ||
        first?.product?.title ||
        first?.title ||
        first?.name ||
        'Item';
      const qty = first?.quantity || first?.qty || null;
      return qty ? `${title} ×${qty}` : title;
    } catch (e) {
      return '—';
    }
  }, []);

  const formatShort = useCallback((ts) => {
    const date = parseSqliteTimestamp(ts);
    if (!date) return '—';
    return date.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }, []);

  const analyzeSession = useCallback(async (sessionId) => {
    if (!sessionId) return;
    setAnalyzing(true);
    setLibraryError('');
    try {
      await fetchJson('/api/session-intelligence/analyze-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store: storeId, sessionId, model: analysisLlm.model, temperature: analysisLlm.temperature })
      });
      await loadLibrarySessions(libraryDay);
    } catch (error) {
      setLibraryError(error?.message || 'Failed to analyze session');
    } finally {
      setAnalyzing(false);
    }
  }, [analysisLlm.model, analysisLlm.temperature, libraryDay, loadLibrarySessions, storeId]);

  const analyzeDay = useCallback(async (mode) => {
    if (!libraryDay) return;
    setAnalyzing(true);
    setLibraryError('');
    try {
      await fetchJson('/api/session-intelligence/analyze-day', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          store: storeId,
          date: libraryDay,
          mode,
          limit: analyzeLimit,
          model: analysisLlm.model,
          temperature: analysisLlm.temperature
        })
      });
      await loadLibrarySessions(libraryDay);
    } catch (error) {
      setLibraryError(error?.message || 'Failed to analyze day');
    } finally {
      setAnalyzing(false);
    }
  }, [analysisLlm.model, analysisLlm.temperature, analyzeLimit, libraryDay, loadLibrarySessions, storeId]);

  const generateBrief = useCallback(async () => {
    if (!libraryDay) return;
    setBriefGenerateError('');
    setBriefGenerating(true);
    try {
      const payload = await fetchJson('/api/session-intelligence/brief/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          store: storeId,
          date: libraryDay,
          model: analysisLlm.model,
          temperature: analysisLlm.temperature,
          limitSessions: 2500
        })
      });
      setBrief(payload.brief || null);
    } catch (error) {
      setBriefGenerateError(error?.message || 'Failed to generate brief');
    } finally {
      setBriefGenerating(false);
    }
  }, [analysisLlm.model, analysisLlm.temperature, libraryDay, storeId]);

  const flowTotals = flowData?.totals?.sessions ?? 0;
  const flowStages = Array.isArray(flowData?.stages) ? flowData.stages : [];
  const flowClusters = Array.isArray(flowData?.clusters) ? flowData.clusters : [];
  const briefReasons = Array.isArray(brief?.top_reasons) ? brief.top_reasons : [];

  const realtimeCountries = realtime?.breakdowns?.countries || [];
  const realtimeFocusCountry = realtime?.breakdowns?.focus?.country || realtimeCountries?.[0]?.value || null;
  const realtimeFocusCountryName = realtimeFocusCountry ? countryNameFromCode(realtimeFocusCountry) : null;
  const realtimeMapRegion = realtimeMapMode === 'focus' && realtimeFocusCountry ? realtimeFocusCountry : 'WORLD';
  const realtimeFocusRegions = Array.isArray(realtime?.breakdowns?.focus?.regions)
    ? realtime.breakdowns.focus.regions
    : [];
  const realtimeFocusCities = Array.isArray(realtime?.breakdowns?.focus?.cities)
    ? realtime.breakdowns.focus.cities
    : [];
  const hasRealtimeFocusGeo = realtimeFocusRegions.length > 0 || realtimeFocusCities.length > 0;
  const realtimeFocusRows = realtimeFocusCities.length > 0 ? realtimeFocusCities : realtimeFocusRegions;
  const realtimeFocusRowsLabel = realtimeFocusCities.length > 0 ? 'cities' : 'regions';
  const realtimeMiniRows = realtimeMapMode === 'focus' ? realtimeFocusRows : realtimeCountries;
  const realtimeMapTitle = realtimeMapMode === 'focus' && realtimeFocusCountryName
    ? `Focused: ${realtimeFocusCountryName}`
    : 'Active sessions by country';
  const realtimeMapSubtitle = realtimeMapMode === 'focus' && hasRealtimeFocusGeo
    ? `Top ${realtimeFocusRowsLabel}`
    : realtimeMapMode === 'focus'
      ? 'Cities / regions'
      : 'Hotspots';
  const realtimeGeoEmptyMessage = realtimeMapMode === 'focus'
    ? realtimeFocusCountryName
      ? `No city/region detail yet for ${realtimeFocusCountryName}.`
      : 'No geo data yet.'
    : 'No geo data yet.';
  const hasDayFilters = Boolean(dropoffStageFilter || dropoffDeviceFilter || dropoffCountryFilter || dropoffCampaignFilter);

  const clearDayFilters = useCallback(() => {
    setDropoffStageFilter('');
    setDropoffDeviceFilter('');
    setDropoffCountryFilter('');
    setDropoffCampaignFilter('');
  }, []);

  const issueModel = useMemo(() => (
    buildClarityIssueRows({
      claritySignals,
      librarySessions,
      selectedDay: libraryDay
    })
  ), [claritySignals, libraryDay, librarySessions]);

  const issueRows = issueModel.rows || [];
  const verificationSummary = claritySignals?.verification || null;
  const hasConfirmedVerifiableIssues = issueRows.some((row) => (
    row.isVerifiable && row.verificationStatus === 'confirmed'
  ));
  const filteredIssueRows = useMemo(() => {
    if (issueVerificationView !== ISSUE_VERIFICATION_VIEW.CONFIRMED_FIRST) return issueRows;
    if (!hasConfirmedVerifiableIssues) return issueRows;
    return issueRows.filter((row) => !row.isVerifiable || row.verificationStatus === 'confirmed');
  }, [hasConfirmedVerifiableIssues, issueRows, issueVerificationView]);
  const visibleIssueRows = showAllIssues ? filteredIssueRows : filteredIssueRows.slice(0, 8);
  const topIssue = filteredIssueRows[0] || issueRows[0] || null;
  const developerGuideRows = filteredIssueRows.slice(0, 3);

  useEffect(() => {
    if (hasConfirmedVerifiableIssues) return;
    if (issueVerificationView !== ISSUE_VERIFICATION_VIEW.CONFIRMED_FIRST) return;
    setIssueVerificationView(ISSUE_VERIFICATION_VIEW.ALL);
  }, [hasConfirmedVerifiableIssues, issueVerificationView]);

  const summaryTotals = useMemo(() => {
    const sessionsCandidate = Number(issueModel.totalSessions) || 0;
    const highIntentRaw = Number(issueModel.highIntentSessions ?? issueModel.eligibleHighIntent) || 0;
    const sessionsTotal = Math.max(sessionsCandidate, highIntentRaw);
    const highIntent = Math.min(highIntentRaw, sessionsTotal);
    const purchases = Number(issueModel.purchases) || 0;
    const estimatedAtRisk = Math.min(
      highIntent,
      filteredIssueRows.reduce((sum, row) => sum + (Number(row.affectedHighIntent) || 0), 0)
    );
    return { sessionsTotal, highIntent, purchases, estimatedAtRisk };
  }, [filteredIssueRows, issueModel.eligibleHighIntent, issueModel.highIntentSessions, issueModel.purchases, issueModel.totalSessions]);

  const summaryLine = topIssue
    ? `Today: ${formatNumber(summaryTotals.sessionsTotal)} sessions, ${formatNumber(summaryTotals.highIntent)} high-intent, ${formatNumber(summaryTotals.purchases)} purchases, biggest leak = ${topIssue.issueLabel} (${pluralize(topIssue.affectedHighIntent, 'session', 'sessions')}).`
    : `Today: ${formatNumber(summaryTotals.sessionsTotal)} sessions, ${formatNumber(summaryTotals.highIntent)} high-intent, ${formatNumber(summaryTotals.purchases)} purchases. No major issue surfaced yet.`;

  return (
	    <div className="si-root">
	      <div className="si-header">
	        <div className="si-title">
	          <h2>Session Intelligence</h2>
	          <p>
	            Live shopper journeys, checkout drop-offs, and AI-ready insights.
	          </p>
	        </div>

        <div className="si-actions">
          <div className="si-pill" title="Polling Shopify events">
            <span className="si-pill-dot" />
            {eventsStatus === 'ok' ? 'Connected' : eventsStatus === 'error' ? 'Degraded' : 'Loading'}
          </div>
          <button className="si-button" type="button" onClick={manualRefresh} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw className={loading ? 'animate-spin' : ''} size={14} />
              Refresh
            </span>
          </button>
        </div>
	      </div>

      <div className="si-card si-realtime-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Realtime overview</h3>
          <span className="si-muted">
            Last {REALTIME_WINDOW_MINUTES}m • {realtime?.lastEventAt ? `Last event ${timeAgo(realtime.lastEventAt)}` : '—'}
          </span>
        </div>

        <div className="si-row si-realtime-controls">
          <button className="si-button si-button-small" type="button" onClick={loadRealtime} disabled={realtimeLoading}>
            {realtimeLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          {realtime?.updatedAt ? (
            <span className="si-muted">Last refreshed {timeAgo(realtime.updatedAt)}</span>
          ) : null}
          <span className="si-spacer" />
          <span className="si-muted">Map</span>
          <button
            className={`si-button si-button-small ${realtimeMapMode === 'world' ? 'si-button-active' : ''}`}
            type="button"
            onClick={() => setRealtimeMapMode('world')}
          >
            World
          </button>
          <button
            className={`si-button si-button-small ${realtimeMapMode === 'focus' ? 'si-button-active' : ''}`}
            type="button"
            onClick={() => setRealtimeMapMode('focus')}
            disabled={!realtimeFocusCountry}
            title={realtimeFocusCountryName ? `Focus on ${realtimeFocusCountryName}` : 'No geo data yet'}
          >
            Focus
          </button>
        </div>

        {realtimeError ? (
          <div className="si-empty" style={{ paddingTop: 10, color: '#b42318' }}>
            {realtimeError}
          </div>
        ) : null}

        <div className="si-realtime-kpis">
          <div className="si-realtime-kpi">
            <div className="si-realtime-kpi-label">Active sessions</div>
            <div className="si-realtime-kpi-value">{formatNumber(realtime?.activeSessions)}</div>
          </div>
          <div className="si-realtime-kpi">
            <div className="si-realtime-kpi-label">Active shoppers</div>
            <div className="si-realtime-kpi-value">{formatNumber(realtime?.activeShoppers)}</div>
          </div>
          <div className="si-realtime-kpi">
            <div className="si-realtime-kpi-label">Events</div>
            <div className="si-realtime-kpi-value">{formatNumber(realtime?.events)}</div>
          </div>
          <div className="si-realtime-kpi">
            <div className="si-realtime-kpi-label">ATC</div>
            <div className="si-realtime-kpi-value">{formatNumber(realtime?.keyEvents?.atc)}</div>
          </div>
          <div className="si-realtime-kpi">
            <div className="si-realtime-kpi-label">Checkout</div>
            <div className="si-realtime-kpi-value">{formatNumber(realtime?.keyEvents?.checkout_started)}</div>
          </div>
          <div className="si-realtime-kpi">
            <div className="si-realtime-kpi-label">Purchase</div>
            <div className="si-realtime-kpi-value">{formatNumber(realtime?.keyEvents?.purchase)}</div>
          </div>
        </div>

        <div className="si-realtime-grid">
          <div className="si-realtime-panel si-realtime-panel-map">
            <div className="si-realtime-panel-title">
              <span>{realtimeMapTitle}</span>
              <span className="si-muted">{realtimeMapSubtitle}</span>
            </div>
            <GeoHotspotsMap countries={realtimeCountries} focusRegion={realtimeMapRegion} height={260} />
            <div className="si-realtime-mini-list">
              {(realtimeMiniRows || []).slice(0, REALTIME_GEO_ROWS_LIMIT).map((row, idx) => {
                const raw = (row?.value || '').toString().trim();
                const code = raw.toUpperCase();
                const isFocusedGeoRow = realtimeMapMode === 'focus' && hasRealtimeFocusGeo;
                const label = isFocusedGeoRow ? (raw || '—') : countryNameFromCode(raw);
                const title = isFocusedGeoRow
                  ? label
                  : code && label
                    ? `${label} (${code})`
                    : label || code || '—';
                return (
                  <div key={`${code || '—'}-${idx}`} className="si-realtime-mini-row" title={title}>
                    <span>{label}</span>
                    <span className="si-muted">{formatNumber(row.count)}</span>
                  </div>
                );
              })}
              {(realtimeMiniRows || []).length === 0 ? (
                <div className="si-empty" style={{ padding: 10 }}>{realtimeGeoEmptyMessage}</div>
              ) : null}
            </div>
          </div>

          <div className="si-realtime-panel si-realtime-panel-source">
            <div className="si-realtime-panel-title">
              <span>Active sessions by source</span>
              <span className="si-muted">Last touch</span>
            </div>
            <div className="si-realtime-bars">
              {(realtime?.breakdowns?.sources || []).slice(0, 8).map((row, idx, list) => {
                const max = Math.max(...list.map((r) => Number(r.count) || 0), 1);
                const width = Math.round(((Number(row.count) || 0) / max) * 100);
                const label = normalizeTrafficSourceLabel(row.value);
                const title = normalizeTrafficSourceTitle(row.value);
                return (
                  <div key={row.value || idx} className="si-realtime-bar-row" title={title || ''}>
                    <div className="si-realtime-bar-label">{label}</div>
                    <div className="si-realtime-bar-track">
                      <div className="si-realtime-bar-fill" style={{ width: `${width}%` }} />
                    </div>
                    <div className="si-realtime-bar-value">{formatNumber(row.count)}</div>
                  </div>
                );
              })}
              {(realtime?.breakdowns?.sources || []).length === 0 ? (
                <div className="si-empty" style={{ padding: 10 }}>No source data yet.</div>
              ) : null}
            </div>
          </div>

          <div className="si-realtime-panel si-realtime-panel-pages">
            <div className="si-realtime-panel-title">
              <span>Current pages</span>
              <span className="si-muted">Where users are</span>
            </div>
            <div className="si-realtime-bars">
              {(realtime?.breakdowns?.pages || []).slice(0, 8).map((row, idx, list) => {
                const max = Math.max(...list.map((r) => Number(r.count) || 0), 1);
                const width = Math.round(((Number(row.count) || 0) / max) * 100);
                return (
                  <div key={row.value || idx} className="si-realtime-bar-row" title={row.value || ''}>
                    <div className="si-realtime-bar-label">{formatPathLabel(row.value || '')}</div>
                    <div className="si-realtime-bar-track">
                      <div className="si-realtime-bar-fill" style={{ width: `${width}%` }} />
                    </div>
                    <div className="si-realtime-bar-value">{formatNumber(row.count)}</div>
                  </div>
                );
              })}
              {(realtime?.breakdowns?.pages || []).length === 0 ? (
                <div className="si-empty" style={{ padding: 10 }}>No page data yet.</div>
              ) : null}
            </div>
          </div>

          <div className="si-realtime-panel si-realtime-panel-events">
            <div className="si-realtime-panel-title">
              <span>Events (last {REALTIME_WINDOW_MINUTES}m)</span>
              <span className="si-muted">By event name</span>
            </div>
            <div className="si-realtime-bars">
              {(realtime?.topEvents || []).slice(0, 8).map((row, idx, list) => {
                const max = Math.max(...list.map((r) => Number(r.count) || 0), 1);
                const width = Math.round(((Number(row.count) || 0) / max) * 100);
                const label = normalizeEventLabel(row.name);
                return (
                  <div key={`${row.name || '—'}-${idx}`} className="si-realtime-bar-row" title={row.name || ''}>
                    <div className="si-realtime-bar-label">{label}</div>
                    <div className="si-realtime-bar-track">
                      <div className="si-realtime-bar-fill" style={{ width: `${width}%` }} />
                    </div>
                    <div className="si-realtime-bar-value">{formatNumber(row.count)}</div>
                  </div>
                );
              })}
              {(realtime?.topEvents || []).length === 0 ? (
                <div className="si-empty" style={{ padding: 10 }}>No events yet.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="si-card si-summary-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Summary</h3>
          <span className="si-muted">{libraryDay || 'Today'} • Ranked by impact</span>
        </div>
        <div className="si-summary-line">{summaryLine}</div>
        {topIssue?.sampleSessions?.[0]?.session_id ? (
          <div className="si-row" style={{ marginTop: 10 }}>
            <button
              className="si-button si-button-small"
              type="button"
              onClick={() => openStory(topIssue.sampleSessions[0].session_id, topIssue.sampleSessions[0])}
            >
              Fix biggest issue
            </button>
          </div>
        ) : null}
        <div className="si-summary-kpis">
          <div className="si-summary-kpi">
            <div className="si-summary-kpi-label">Sessions</div>
            <div className="si-summary-kpi-value">{formatNumber(summaryTotals.sessionsTotal)}</div>
          </div>
          <div className="si-summary-kpi">
            <div className="si-summary-kpi-label">High-intent sessions</div>
            <div className="si-summary-kpi-value">{formatNumber(summaryTotals.highIntent)}</div>
          </div>
          <div className="si-summary-kpi">
            <div className="si-summary-kpi-label">Purchases</div>
            <div className="si-summary-kpi-value">{formatNumber(summaryTotals.purchases)}</div>
          </div>
          <div className="si-summary-kpi">
            <div className="si-summary-kpi-label">Estimated sessions at risk</div>
            <div className="si-summary-kpi-value">{formatNumber(summaryTotals.estimatedAtRisk)}</div>
          </div>
        </div>
      </div>

      <div className="si-card si-issues-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Top issues</h3>
          <span className="si-muted">
            Top {formatNumber(visibleIssueRows.length)} visible • {issueVerificationView === ISSUE_VERIFICATION_VIEW.CONFIRMED_FIRST ? 'Confirmed first' : 'All issues'}
          </span>
        </div>

        <div className="si-row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button
            className={`si-chip si-chip-button ${issueVerificationView === ISSUE_VERIFICATION_VIEW.CONFIRMED_FIRST ? 'si-chip-active' : ''}`}
            type="button"
            onClick={() => setIssueVerificationView(ISSUE_VERIFICATION_VIEW.CONFIRMED_FIRST)}
            disabled={!hasConfirmedVerifiableIssues}
            title={hasConfirmedVerifiableIssues ? 'Show only confirmed verifier issues (+ non-verifiable issues).' : 'No confirmed verifier issues yet.'}
          >
            Confirmed first
          </button>
          <button
            className={`si-chip si-chip-button ${issueVerificationView === ISSUE_VERIFICATION_VIEW.ALL ? 'si-chip-active' : ''}`}
            type="button"
            onClick={() => setIssueVerificationView(ISSUE_VERIFICATION_VIEW.ALL)}
          >
            All issues
          </button>
          {verificationSummary?.total > 0 ? (
            <span className="si-muted">
              Verifier: {formatNumber(verificationSummary.confirmed)} confirmed, {formatNumber(verificationSummary.false_positive)} false alerts, {formatNumber(verificationSummary.unverified)} pending
            </span>
          ) : null}
        </div>

        {clarityLoading ? (
          <div className="si-empty">Loading ranked issues…</div>
        ) : null}

        {!clarityLoading && clarityError ? (
          <div className="si-empty" style={{ color: '#b42318' }}>{clarityError}</div>
        ) : null}

        {!clarityLoading && !clarityError && issueRows.length === 0 ? (
          <div className="si-empty">
            No issue rows yet. Once the storefront script captures interactions, ranked issues will appear here.
          </div>
        ) : null}

        {!clarityLoading && !clarityError && issueRows.length > 0 && filteredIssueRows.length === 0 ? (
          <div className="si-empty">
            No rows match the current verification filter. Switch to <strong>All issues</strong> to inspect pending/false alerts.
          </div>
        ) : null}

        {!clarityLoading && !clarityError && filteredIssueRows.length > 0 ? (
          <>
            <table className="si-event-table si-issues-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Issue</th>
                  <th>Where</th>
                  <th>Sessions affected</th>
                  <th>% high-intent affected</th>
                  <th>Confidence</th>
                  <th>Verification</th>
                  <th>Action</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {visibleIssueRows.map((row, rowIndex) => {
                  const confidenceClass = row.confidenceLabel === 'High'
                    ? 'si-confidence-high'
                    : row.confidenceLabel === 'Med'
                      ? 'si-confidence-med'
                      : 'si-confidence-low';
                  const verificationState = verificationUi(row.verificationStatus);
                  const sampleList = Array.isArray(row.sampleSessions) ? row.sampleSessions : [];
                  const proofSession = sampleList[0];
                  const proofCount = Math.min(sampleList.length, 5);
                  return (
                    <tr key={row.id} className={`si-issue-row si-issue-${row.type}`}>
                      <td><strong>{rowIndex + 1}</strong></td>
                      <td>{row.issueLabel}</td>
                      <td title={row.whereLabel}>{row.whereLabel}</td>
                      <td>{pluralize(row.sessionsAffected, 'session', 'sessions')}</td>
                      <td>{formatPercent(row.highIntentRate, 0)}</td>
                      <td>
                        <span className={`si-chip ${confidenceClass}`}>{row.confidenceLabel}</span>
                      </td>
                      <td title={row.verificationReason || ''}>
                        <span className={`si-chip ${verificationState.className}`}>{verificationState.label}</span>
                      </td>
                      <td title={row.action}>{row.action}</td>
                      <td>
                        {proofSession?.session_id ? (
                          <button
                            className="si-button si-button-small"
                            type="button"
                            onClick={() => openStory(proofSession.session_id, proofSession)}
                          >
                            View {proofCount || 1} sessions
                          </button>
                        ) : (
                          <span className="si-muted">No sample</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredIssueRows.length > 8 ? (
              <div className="si-row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <span className="si-muted">
                  Showing {visibleIssueRows.length} of {filteredIssueRows.length} issue rows
                </span>
                <button
                  className="si-button si-button-small"
                  type="button"
                  onClick={() => setShowAllIssues((prev) => !prev)}
                >
                  {showAllIssues ? 'Show top 8' : 'Show more'}
                </button>
              </div>
            ) : null}

            {developerGuideRows.length > 0 ? (
              <div className="si-dev-guide">
                <div className="si-card-title" style={{ marginTop: 14 }}>
                  <h3>Developer fix instructions</h3>
                  <span className="si-muted">How to resolve each top issue</span>
                </div>
                <div className="si-fix-grid">
                  {developerGuideRows.map((row) => {
                    const steps = buildDeveloperFixSteps(row);
                    const technical = row.rawErrorMessage
                      ? (row.rawErrorMessage.length > 140 ? `${row.rawErrorMessage.slice(0, 140)}...` : row.rawErrorMessage)
                      : '';
                    return (
                      <div key={`fix-${row.id}`} className="si-fix-card">
                        <div className="si-fix-title">{row.issueLabel}</div>
                        <div className="si-fix-where">{row.whereLabel}</div>
                        <ol className="si-fix-list">
                          {steps.map((step, idx) => (
                            <li key={`${row.id}-step-${idx}`}>{step}</li>
                          ))}
                        </ol>
                        {technical ? (
                          <div className="si-fix-tech">
                            <span className="si-muted">Technical signature</span>
                            <code className="si-code">{technical}</code>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="si-row" style={{ marginBottom: 12, justifyContent: 'space-between', gap: 10 }}>
        <div className="si-muted">Evidence + Advanced</div>
        <button
          className={`si-button si-button-small ${advancedOpen ? 'si-button-active' : ''}`}
          type="button"
          onClick={() => setAdvancedOpen((prev) => !prev)}
        >
          {advancedOpen ? 'Hide advanced' : 'Show advanced'}
        </button>
      </div>

      {advancedOpen ? (
        <>
	      <div className="si-card si-intro-card">
	        <div className="si-card-title">
	          <h3>What this page is</h3>
	          <span className="si-muted">Live • Team-friendly</span>
	        </div>
	        <div className="si-muted">
	          This page is your live “truth layer” for Shawq — basically Microsoft Clarity, but without the numerous, endless recordings.
	        </div>
	        <ul className="si-list">
	          <li>
	            <strong>Live feed:</strong> it receives behavior signals from our Shopify Custom Pixel, so you’re not guessing — you’re watching real intent form in real time.
	          </li>
	          <li>
	            <strong>Full journey per shopper:</strong> each shopper gets a private <em>Shopper‑0001</em> style ID, and we track their path step‑by‑step across the entire session (page → product → add to cart → checkout steps → purchase or drop‑off).
	          </li>
	          <li>
	            <strong>Checkout clarity:</strong> we pinpoint exactly where checkout stalls (Contact / Shipping / Payment) so you know what to fix first.
	          </li>
	          <li>
	            <strong>AI insights (next phase):</strong> AI will review the highest‑impact sessions (like ATC with no purchase) and send a short brief: what likely happened, what’s broken/confusing, and the fixes that move revenue.
	          </li>
	          <li>
	            <strong>Audience power:</strong> we can turn “high intent” shoppers into retargeting audiences automatically.
	          </li>
	        </ul>
	      </div>

	      <div className="si-grid">
	        <div className="si-card">
	          <div className="si-metric-label">
	            <div className="si-icon" />
	            Sessions (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.sessions24h ?? '—'}</div>
          <div className="si-metric-sub">Store: {store?.name || storeId}</div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            Add to cart (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.atc24h ?? '—'}</div>
          <div className="si-metric-sub">
            Sessions • Events: {overview?.kpis?.atcEvents24h ?? '—'}
          </div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            Checkout started (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.checkoutStarted24h ?? '—'}</div>
          <div className="si-metric-sub">
            Sessions • Events: {overview?.kpis?.checkoutStartedEvents24h ?? '—'}
          </div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            Purchases (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.purchases24h ?? '—'}</div>
          <div className="si-metric-sub">
            Sessions • Events: {overview?.kpis?.purchasesEvents24h ?? '—'}
          </div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            ATC abandoned
          </div>
          <div className="si-metric-value">{overview?.kpis?.atcAbandoned ?? '—'}</div>
          <div className="si-metric-sub">{overview?.abandonAfterHours ?? 24}h since ATC, no purchase</div>
        </div>
      </div>

      <div className="si-panels">
        <div className="si-card">
          <div className="si-card-title">
            <h3>Checkout drop‑offs (no purchase)</h3>
            <span className="si-muted">
              Dropped: {overview?.kpis?.checkoutDropped24h ?? 0} • In progress: {overview?.kpis?.checkoutInProgress ?? 0}
            </span>
          </div>

          {dropoffChips.length === 0 ? (
            <div className="si-empty">
              No dropped checkouts yet (based on {checkoutDropMinutes}m inactivity).
            </div>
          ) : (
            <div className="si-steps">
              {dropoffChips.map(([step, count]) => (
                <div key={step} className="si-step-chip">
                  <strong>{count}</strong>
                  <span>{normalizeStepLabel(step)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="si-card">
          <div className="si-card-title">
            <h3>Daily brief</h3>
            <span className="si-muted">{libraryDay || brief?.date || '—'}</span>
          </div>
          <div className="si-row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button
              className="si-button"
              type="button"
              onClick={generateBrief}
              disabled={briefGenerating || !libraryDay}
            >
              {briefGenerating ? 'Generating…' : 'Generate brief'}
            </button>
            <span className="si-muted">
              Uses {analysisLlm.model.startsWith('deepseek-') ? `DeepSeek ${analysisLlm.model}` : analysisLlm.model}.
            </span>
          </div>
          {briefGenerateError ? (
            <div className="si-empty" style={{ marginTop: 10, color: '#b42318' }}>
              {briefGenerateError}
            </div>
          ) : null}
          <div className="si-muted si-preline">
            {brief?.content
              ? brief.content
              : 'Generate a daily brief to turn today’s high-intent sessions into friction clusters + fixes.'}
          </div>

          {briefReasons.length > 0 ? (
            <div className="si-brief-reasons">
              {briefReasons.slice(0, 6).map((reason, idx) => {
                const conf = Number(reason?.confidence);
                const confidence = Number.isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : null;
                const evidence = Array.isArray(reason?.evidence) ? reason.evidence.filter(Boolean).slice(0, 4) : [];
                const fixes = Array.isArray(reason?.fixes) ? reason.fixes.filter(Boolean).slice(0, 4) : [];
                const stageHint = inferDropoffStageFromBriefText([reason?.reason, ...evidence].filter(Boolean).join('\n'));

                return (
                  <div key={`${reason?.reason || 'reason'}-${idx}`} className="si-brief-reason">
                    <div className="si-brief-reason-header">
                      <div className="si-brief-reason-title">{reason?.reason || 'Insight'}</div>
                      <div className="si-brief-reason-confidence">
                        {confidence == null ? '—' : `${Math.round(confidence * 100)}%`}
                      </div>
                    </div>
                    <div className="si-brief-reason-bar" aria-hidden="true">
                      <div
                        className="si-brief-reason-bar-fill"
                        style={{ width: `${Math.round((confidence ?? 0) * 100)}%` }}
                      />
                    </div>

                    {evidence.length > 0 ? (
                      <div className="si-brief-reason-block">
                        <div className="si-brief-reason-block-title">Evidence</div>
                        <ul className="si-brief-reason-list">
                          {evidence.map((line, lineIdx) => (
                            <li key={`ev-${idx}-${lineIdx}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {fixes.length > 0 ? (
                      <div className="si-brief-reason-block">
                        <div className="si-brief-reason-block-title">Fix</div>
                        <ul className="si-brief-reason-list">
                          {fixes.map((line, lineIdx) => (
                            <li key={`fx-${idx}-${lineIdx}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {stageHint ? (
                      <div className="si-row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                        <button
                          className="si-button si-button-small"
                          type="button"
                          onClick={() => {
                            setFlowMode('high_intent_no_purchase');
                            setHighIntentOnly(true);
                            setDropoffStageFilter(stageHint);
                          }}
                          title="Filter the day sessions list to the most likely drop-off stage."
                        >
                          Filter sessions
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="si-card si-flow-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Shop walk</h3>
          <span className="si-muted">
            {libraryDay || flowData?.date || '—'}
            {flowTotals ? ` • ${flowTotals} sessions` : ''}
          </span>
        </div>

        <div className="si-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className={`si-button ${flowMode === 'all' ? 'si-button-active' : ''}`}
            type="button"
            aria-pressed={flowMode === 'all'}
            onClick={() => setFlowMode('all')}
            disabled={!libraryDay}
            title="Flow across all sessions for the selected day."
          >
            All sessions
          </button>
          <button
            className={`si-button ${flowMode === 'high_intent_no_purchase' ? 'si-button-active' : ''}`}
            type="button"
            aria-pressed={flowMode === 'high_intent_no_purchase'}
            onClick={() => setFlowMode('high_intent_no_purchase')}
            disabled={!libraryDay}
            title="Focus on sessions that added to cart / started checkout, but did not purchase."
          >
            High intent (no purchase)
          </button>
          <button
            className="si-button"
            type="button"
            onClick={() => loadFlow(libraryDay, flowMode)}
            disabled={!libraryDay || flowLoading}
          >
            {flowLoading ? 'Loading…' : 'Reload'}
          </button>
          {hasDayFilters ? (
            <span className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              Filtering day sessions:
              {dropoffStageFilter ? (
                <span className="si-badge" title="Drop-off stage">
                  Stage: {FLOW_STAGE_LABELS[dropoffStageFilter] || dropoffStageFilter}
                </span>
              ) : null}
              {dropoffDeviceFilter ? (
                <span className="si-badge" title="Device filter">
                  Device: {normalizeDeviceLabel(dropoffDeviceFilter)}
                </span>
              ) : null}
              {dropoffCountryFilter ? (
                <span className="si-badge" title="Country filter">
                  Country: {countryNameFromCode(dropoffCountryFilter)}
                </span>
              ) : null}
              {dropoffCampaignFilter ? (
                <span className="si-badge" title="Campaign filter">
                  Campaign: {dropoffCampaignFilter}
                </span>
              ) : null}
              <button className="si-button si-button-small" type="button" onClick={clearDayFilters}>
                Clear
              </button>
            </span>
          ) : null}
        </div>

        {flowError ? (
          <div className="si-empty" style={{ marginTop: 10, color: '#b42318' }}>
            {flowError}
          </div>
        ) : null}

        {!flowError && flowStages.length === 0 ? (
          <div className="si-empty" style={{ marginTop: 10 }}>
            {flowLoading ? 'Loading shop walk…' : 'No flow data for this day yet.'}
          </div>
        ) : null}

        {flowStages.length > 0 ? (
          <div className="si-flow">
            <div className="si-flow-track" aria-hidden="true" />
            <div className="si-flow-stations">
              {flowStages.map((stage, idx) => {
                const reached = Number(stage.reached || 0);
                const dropoffs = Number(stage.dropoffs || 0);
                const isLast = idx === flowStages.length - 1;
                const share = flowTotals > 0 ? reached / flowTotals : 0;
                const toNext = !isLast && reached > 0 ? Number(stage.advanceToNext || 0) / reached : null;
                const dwell = stage.p50_dwell_sec ?? stage.avg_dwell_sec ?? null;
                return (
                  <div
                    key={stage.stage || idx}
                    className={`si-flow-stage ${dropoffStageFilter === stage.stage ? 'si-flow-stage-selected' : ''}`}
                    title={`${stage.label || stage.stage}\nReached: ${reached}\nDrop-offs: ${dropoffs}\nMedian dwell: ${formatDurationSeconds(stage.p50_dwell_sec)}`}
                  >
                    <div className="si-flow-stage-top">
                      <div className="si-flow-label">{stage.label || FLOW_STAGE_LABELS[stage.stage] || stage.stage}</div>
                      <div className="si-flow-reached">{reached}</div>
                    </div>
                    <div className="si-flow-bar" aria-hidden="true">
                      <div className="si-flow-bar-fill" style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} />
                    </div>
                    <div className="si-flow-metrics">
                      <div className="si-flow-metric">
                        <span className="si-flow-metric-label">To next</span>
                        <span className="si-flow-metric-value">{toNext === null ? '—' : formatPercent(toNext)}</span>
                      </div>
                      <div className="si-flow-metric">
                        <span className="si-flow-metric-label">Dwell p50</span>
                        <span className="si-flow-metric-value">{formatDurationSeconds(dwell)}</span>
                      </div>
                    </div>
                    <div className={`si-flow-dropoff ${dropoffs > 0 ? '' : 'si-flow-dropoff-none'}`}>
                      Drop-offs: {dropoffs}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="si-flow-clusters">
              <div className="si-card-title" style={{ marginTop: 14 }}>
                <h3>Drop-off clusters</h3>
                <span className="si-muted">Click a cluster to filter day sessions</span>
              </div>

              {flowClusters.length === 0 ? (
                <div className="si-empty">No drop-off clusters yet.</div>
              ) : (
                <div className="si-cluster-grid">
                  {flowClusters.map((cluster) => (
                    <div key={cluster.stage} className="si-cluster-card">
                      <div className="si-cluster-header">
                        <div>
                          <div className="si-cluster-title">{cluster.label || FLOW_STAGE_LABELS[cluster.stage] || cluster.stage}</div>
                          <div className="si-muted" style={{ marginTop: 2 }}>
                            Dropped <strong>{cluster.dropped}</strong>
                            {cluster.drop_rate != null ? ` • ${formatPercent(cluster.drop_rate)}` : ''}
                            {cluster.p50_dwell_sec != null ? ` • Dwell p50 ${formatDurationSeconds(cluster.p50_dwell_sec)}` : ''}
                          </div>
                        </div>
                        <button
                          className="si-button si-button-small"
                          type="button"
                          onClick={() => setDropoffStageFilter(cluster.stage)}
                        >
                          Filter
                        </button>
                      </div>

                      <div className="si-cluster-chips">
                        {(cluster.top_devices || []).slice(0, 3).map((item, idx) => {
                          const value = item.value || '—';
                          const active = normalizeLooseKey(dropoffDeviceFilter) === normalizeLooseKey(value);
                          return (
                            <button
                              key={`dev-${value}-${idx}`}
                              className={`si-chip si-chip-button ${active ? 'si-chip-active' : ''}`}
                              type="button"
                              aria-pressed={active}
                              title="Filter by device"
                              onClick={() => {
                                setDropoffStageFilter(cluster.stage);
                                setDropoffDeviceFilter(active ? '' : value);
                              }}
                            >
                              {normalizeDeviceLabel(value)} <strong>{item.count}</strong>
                            </button>
                          );
                        })}
                        {(cluster.top_countries || []).slice(0, 3).map((item, idx) => {
                          const value = item.value || '—';
                          const active = normalizeLooseKey(dropoffCountryFilter) === normalizeLooseKey(value);
                          return (
                            <button
                              key={`cty-${value}-${idx}`}
                              className={`si-chip si-chip-button ${active ? 'si-chip-active' : ''}`}
                              type="button"
                              aria-pressed={active}
                              title="Filter by country"
                              onClick={() => {
                                setDropoffStageFilter(cluster.stage);
                                setDropoffCountryFilter(active ? '' : value);
                              }}
                            >
                              {countryNameFromCode(value)} <strong>{item.count}</strong>
                            </button>
                          );
                        })}
                        {(cluster.top_campaigns || []).slice(0, 2).map((item, idx) => {
                          const value = item.value || '—';
                          const active = dropoffCampaignFilter === value;
                          return (
                            <button
                              key={`cmp-${value}-${idx}`}
                              className={`si-chip si-chip-button ${active ? 'si-chip-active' : ''}`}
                              type="button"
                              aria-pressed={active}
                              title="Filter by campaign"
                              onClick={() => {
                                setDropoffStageFilter(cluster.stage);
                                setDropoffCampaignFilter(active ? '' : value);
                              }}
                            >
                              {value} <strong>{item.count}</strong>
                            </button>
                          );
                        })}
                      </div>

                      {(cluster.sample_sessions || []).length > 0 ? (
                        <div className="si-cluster-samples">
                          {(cluster.sample_sessions || []).slice(0, 6).map((s) => (
                            <button
                              key={s.session_id || s.codename}
                              type="button"
                              className="si-sample"
                              onClick={() => {
                                if (!s.session_id) return;
                                openStory(s.session_id, s);
                              }}
                              title={s.session_id || ''}
                            >
                              {s.codename || toCode('Session', s.session_id, 6)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="si-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Clarity signals</h3>
          <span className="si-muted">
            {libraryDay || claritySignals?.date || '—'}
            {' • '}
            {flowMode === 'high_intent_no_purchase' ? 'High intent (no purchase)' : 'All sessions'}
          </span>
        </div>

        <div className="si-muted">
          Rage clicks, dead clicks, scroll depth, JS errors, and form validation friction (from the storefront script).
        </div>

        {clarityError ? (
          <div className="si-empty" style={{ marginTop: 10, color: '#b42318' }}>
            {clarityError}
          </div>
        ) : null}

        {!clarityError && clarityLoading ? (
          <div className="si-empty" style={{ marginTop: 10 }}>
            Loading clarity signals…
          </div>
        ) : null}

        {!clarityLoading && !clarityError && !claritySignals ? (
          <div className="si-empty" style={{ marginTop: 10 }}>
            No clarity signals yet. Install the storefront script: <span className="si-code">/pixel.js?store={storeId}</span>
          </div>
        ) : null}

        {!clarityError && claritySignals ? (
          <div className="si-insights-grid" style={{ marginTop: 12 }}>
            <div className="si-insight-block">
              <div className="si-insight-title">Rage clicks</div>
              {(claritySignals?.signals?.rage_clicks || []).length === 0 ? (
                <div className="si-empty">No rage clicks detected.</div>
              ) : (
                <ul className="si-insight-list">
                  {(claritySignals?.signals?.rage_clicks || []).slice(0, 8).map((item, idx) => (
                    <li key={`rage-${item.page}-${idx}`} className="si-insight-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span title={item.target_key || ''}>
                          {formatPathLabel(item.page)}{' '}
                          <span className="si-muted" style={{ fontSize: 11 }}>
                            {item.target_key ? `• ${String(item.target_key).slice(0, 60)}` : ''}
                          </span>
                        </span>
                        <span className="si-muted">
                          {formatNumber(item.sessions)} sessions • {formatNumber(item.count)} clicks
                        </span>
                      </div>
                      {(item.sample_sessions || []).length ? (
                        <div className="si-cluster-samples">
                          {(item.sample_sessions || []).slice(0, 5).map((s) => (
                            <button
                              key={s.session_id}
                              type="button"
                              className="si-sample"
                              onClick={() => openStory(s.session_id, s)}
                            >
                              {s.codename || toCode('Session', s.session_id, 6)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="si-insight-block">
              <div className="si-insight-title">Dead clicks</div>
              {(claritySignals?.signals?.dead_clicks || []).length === 0 ? (
                <div className="si-empty">No dead clicks detected.</div>
              ) : (
                <ul className="si-insight-list">
                  {(claritySignals?.signals?.dead_clicks || []).slice(0, 8).map((item, idx) => (
                    <li key={`dead-${item.page}-${idx}`} className="si-insight-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span title={item.target_key || ''}>
                          {formatPathLabel(item.page)}{' '}
                          <span className="si-muted" style={{ fontSize: 11 }}>
                            {item.target_key ? `• ${String(item.target_key).slice(0, 60)}` : ''}
                          </span>
                        </span>
                        <span className="si-muted">
                          {formatNumber(item.sessions)} sessions • {formatNumber(item.count)} clicks
                        </span>
                      </div>
                      {(item.sample_sessions || []).length ? (
                        <div className="si-cluster-samples">
                          {(item.sample_sessions || []).slice(0, 5).map((s) => (
                            <button
                              key={s.session_id}
                              type="button"
                              className="si-sample"
                              onClick={() => openStory(s.session_id, s)}
                            >
                              {s.codename || toCode('Session', s.session_id, 6)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="si-insight-block">
              <div className="si-insight-title">JS errors</div>
              {(claritySignals?.signals?.js_errors || []).length === 0 ? (
                <div className="si-empty">No JS errors detected.</div>
              ) : (
                <ul className="si-insight-list">
                  {(claritySignals?.signals?.js_errors || []).slice(0, 8).map((item, idx) => (
                    <li key={`js-${item.page}-${idx}`} className="si-insight-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span title={item.message}>
                          {formatPathLabel(item.page)}{' '}
                          <span className="si-muted" style={{ fontSize: 11 }}>
                            {item.message ? `• ${String(item.message).slice(0, 80)}` : ''}
                          </span>
                        </span>
                        <span className="si-muted">
                          {formatNumber(item.sessions)} sessions • {formatNumber(item.count)} errors
                        </span>
                      </div>
                      {(item.sample_sessions || []).length ? (
                        <div className="si-cluster-samples">
                          {(item.sample_sessions || []).slice(0, 5).map((s) => (
                            <button
                              key={s.session_id}
                              type="button"
                              className="si-sample"
                              onClick={() => openStory(s.session_id, s)}
                            >
                              {s.codename || toCode('Session', s.session_id, 6)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="si-insight-block">
              <div className="si-insight-title">Form validation</div>
              {(claritySignals?.signals?.form_invalid || []).length === 0 ? (
                <div className="si-empty">No form validation friction detected.</div>
              ) : (
                <ul className="si-insight-list">
                  {(claritySignals?.signals?.form_invalid || []).slice(0, 8).map((item, idx) => (
                    <li key={`form-${item.page}-${idx}`} className="si-insight-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span title={[item.field_type, item.field_name].filter(Boolean).join(' ')}>
                          {formatPathLabel(item.page)}{' '}
                          <span className="si-muted" style={{ fontSize: 11 }}>
                            {(item.field_type || item.field_name) ? `• ${(item.field_type || 'field')}${item.field_name ? ` (${item.field_name})` : ''}` : ''}
                          </span>
                        </span>
                        <span className="si-muted">
                          {formatNumber(item.sessions)} sessions • {formatNumber(item.count)} invalid submits
                        </span>
                      </div>
                      {(item.sample_sessions || []).length ? (
                        <div className="si-cluster-samples">
                          {(item.sample_sessions || []).slice(0, 5).map((s) => (
                            <button
                              key={s.session_id}
                              type="button"
                              className="si-sample"
                              onClick={() => openStory(s.session_id, s)}
                            >
                              {s.codename || toCode('Session', s.session_id, 6)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="si-insight-block">
              <div className="si-insight-title">Scroll reach (top pages)</div>
              {(claritySignals?.signals?.scroll_dropoff || []).length === 0 ? (
                <div className="si-empty">No scroll data yet.</div>
              ) : (
                <ul className="si-insight-list">
                  {(claritySignals?.signals?.scroll_dropoff || []).slice(0, 8).map((item, idx) => (
                    <li key={`scroll-${item.page}-${idx}`} className="si-insight-item">
                      <span>{formatPathLabel(item.page)}</span>
                      <span className="si-muted" title={`Total: ${item.total_sessions}`}>
                        50%: {formatPercent(item.total_sessions ? item.reached_50 / item.total_sessions : 0)} •
                        75%: {formatPercent(item.total_sessions ? item.reached_75 / item.total_sessions : 0)} •
                        90%: {formatPercent(item.total_sessions ? item.reached_90 / item.total_sessions : 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="si-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Product signals (last {overview?.retentionHours ?? 72}h)</h3>
          <span className="si-muted">Only sessions with a purchase</span>
        </div>

        <div className="si-insights-grid">
          <div className="si-insight-block">
            <div className="si-insight-title">Most viewed, not bought</div>
            {mostViewedNotBought.length === 0 ? (
              <div className="si-empty">No qualified sessions yet.</div>
            ) : (
              <ul className="si-insight-list">
                {mostViewedNotBought.map((item) => (
                  <li key={item.product_id} className="si-insight-item">
                    <span title={item.product_path || item.product_id}>
                      {item.product_path ? formatPathLabel(item.product_path) : item.product_id}
                    </span>
                    <span className="si-muted">{item.views} views • {item.sessions} buyers</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="si-insight-block">
            <div className="si-insight-title">Out‑of‑stock sizes clicked</div>
            {outOfStockSizesClicked.length === 0 ? (
              <div className="si-empty">No OOS clicks captured yet.</div>
            ) : (
              <ul className="si-insight-list">
                {outOfStockSizesClicked.map((item, idx) => (
                  <li key={[item.size_label, item.variant_id, item.product_id].filter(Boolean).join('-') || idx} className="si-insight-item">
                    <span title={[item.size_label, item.variant_id, item.product_id].filter(Boolean).join(' • ')}>
                      {item.size_label || item.variant_id || item.product_id || 'Unknown size'}
                    </span>
                    <span className="si-muted">{item.clicks} clicks</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="si-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Abandoned sessions (ATC → no purchase)</h3>
          <span className="si-muted">Older than {abandonAfterHours}h</span>
        </div>

        {abandonedSessions.length === 0 ? (
          <div className="si-empty">None yet. Once users add to cart and don’t purchase for {abandonAfterHours}h, they appear here.</div>
        ) : (
	          <table className="si-event-table">
	            <thead>
	              <tr>
	                <th>Last seen</th>
	                <th>Cart (last)</th>
	                <th>Drop‑off step</th>
	                <th>ATC</th>
	                <th>User</th>
	              </tr>
	            </thead>
	            <tbody>
	              {abandonedSessions.map((s) => (
	                <tr key={s.session_id}>
	                  <td>{timeAgo(s.last_event_at || s.updated_at || s.created_at)}</td>
	                  <td title={getCartSummary(s.last_cart_json)}>{getCartSummary(s.last_cart_json)}</td>
                  <td>
                    {s.last_checkout_step ? (
                      <span className="si-badge">{normalizeStepLabel(s.last_checkout_step)}</span>
                    ) : (
                      <span className="si-muted">Pre‑checkout</span>
                    )}
	                  </td>
	                  <td>{timeAgo(s.atc_at)}</td>
	                  <td
	                    title={[
	                      s.client_id ? `client_id: ${s.client_id}` : null,
	                      s.session_id ? `session_id: ${s.session_id}` : null
	                    ].filter(Boolean).join('\n')}
	                  >
	                    {userLabel(s)}
	                  </td>
	                </tr>
	              ))}
	            </tbody>
	          </table>
	        )}
      </div>

      <div className="si-card" style={{ marginTop: 14 }}>
        <div className="si-card-title">
          <h3>Events library (last {overview?.retentionHours ?? 72}h)</h3>
          <span className="si-muted">Browse by day • Pick a session • Run AI</span>
        </div>

        <div className="si-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Day (UTC)
            <select
              className="si-select"
              value={libraryDay}
              onChange={(e) => setLibraryDay(e.target.value)}
              disabled={libraryDays.length === 0}
            >
              {libraryDays.length === 0 ? (
                <option value="">No days yet</option>
              ) : (
                libraryDays.map((d) => (
                  <option key={d.day} value={d.day}>
                    {d.day} • {d.sessions} sessions • {d.events} events
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="si-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              AI Model
              <select
                className="si-select"
                value={analysisLlm.model}
                onChange={(e) => setAnalysisLlm((prev) => ({ ...prev, model: e.target.value }))}
              >
                <option value="gpt-4o-mini">OpenAI gpt-4o-mini</option>
                <option value="deepseek-chat">DeepSeek Chat (Non-thinking)</option>
                <option value="deepseek-reasoner">DeepSeek Reasoner (Thinking)</option>
              </select>
            </label>

            {analysisLlm.model.startsWith('deepseek-') && (
              <label className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                Temperature
                <select
                  className="si-select"
                  value={String(analysisLlm.temperature ?? 0)}
                  onChange={(e) => setAnalysisLlm((prev) => ({ ...prev, temperature: Number(e.target.value) }))}
                >
                  <option value="0">0.0</option>
                  <option value="1">1.0</option>
                  <option value="1.3">1.3</option>
                  <option value="1.5">1.5</option>
                </select>
              </label>
            )}

            <label className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Limit
              <input
                className="si-input"
                type="number"
                min={1}
                max={100}
                value={analyzeLimit}
                onChange={(e) => setAnalyzeLimit(parseInt(e.target.value, 10) || 20)}
                style={{ width: 90 }}
              />
            </label>
            <button
              className={`si-button ${highIntentOnly ? 'si-button-active' : ''}`}
              type="button"
              aria-pressed={highIntentOnly}
              onClick={() => setHighIntentOnly((v) => !v)}
              disabled={librarySessions.length === 0}
            >
              High intent
            </button>
            <button className="si-button" type="button" onClick={() => analyzeDay('high_intent')} disabled={analyzing || !libraryDay}>
              Analyze high intent
            </button>
            <button className="si-button" type="button" onClick={() => analyzeDay('all')} disabled={analyzing || !libraryDay}>
              Analyze all
            </button>
          </div>
        </div>

        {libraryError ? (
          <div className="si-empty" style={{ color: '#b42318' }}>{libraryError}</div>
        ) : null}

        {filteredLibrarySessions.length === 0 ? (
          <div className="si-empty" style={{ marginTop: 10 }}>
            No sessions for this day yet.
          </div>
        ) : (
          <table className="si-event-table" style={{ marginTop: 10 }}>
            <thead>
                  <tr>
                    <th>Shopper</th>
                    <th>Last seen</th>
                    <th>Flow</th>
                    <th>Signals</th>
                    <th>Checkout</th>
                    <th>Device</th>
                    <th>Country</th>
                    <th>Campaign</th>
                    <th>AI</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredLibrarySessions.map((s) => {
                const selected = librarySessionId === s.session_id;
                const signals = [
                  s.product_views ? `Product×${s.product_views}` : null,
                  s.cart_events ? `Cart×${s.cart_events}` : null,
                  s.atc_events ? `ATC×${s.atc_events}` : null,
                  s.checkout_started_events ? `Checkout×${s.checkout_started_events}` : null,
                  s.purchase_events ? `Purchase×${s.purchase_events}` : null
                ].filter(Boolean).join(' • ') || '—';
                const inferredStage = inferDropoffStageFromSummary(s);
                const ai = s.summary ? `${s.primary_reason || 'Insight'} (${Math.round((s.confidence || 0) * 100)}%)` : '—';
                const campaignCell = campaignCellProps(s.utm_source, s.utm_campaign);
                return (
                  <tr key={s.session_id} className={selected ? 'si-row-selected' : ''}>
                    <td title={s.session_id}>{userLabel(s)}</td>
                    <td>{timeAgo(s.last_seen)}</td>
                    <td>
                      <span className={`si-badge ${inferredStage === 'purchase' ? 'si-badge-success' : ''}`}>
                        {FLOW_STAGE_LABELS[inferredStage] || inferredStage}
                      </span>
                    </td>
                    <td>{signals}</td>
                    <td>{s.last_checkout_step ? <span className="si-badge">{normalizeStepLabel(s.last_checkout_step)}</span> : '—'}</td>
                    <td>{s.device_type || '—'}</td>
                    <td>{s.country_code || '—'}</td>
                    <td title={campaignCell.title}>
                      {campaignCell.display}
                    </td>
                    <td title={s.summary || ''}>{ai}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="si-button si-button-small"
                        type="button"
                        onClick={() => {
                          setLibrarySessionId(s.session_id);
                        }}
                        disabled={!libraryDay}
                      >
                        View
                      </button>{' '}
                      <button
                        className="si-button si-button-small"
                        type="button"
                        onClick={() => analyzeSession(s.session_id)}
                        disabled={analyzing}
                      >
                        Analyze
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {librarySessionId && (
            <div style={{ marginTop: 14 }} ref={libraryTimelineRef}>
            <div className="si-card-title" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Session timeline</h3>
              <span className="si-muted">{timelineLabel}</span>
            </div>

            {libraryEvents.length === 0 ? (
              <div className="si-empty">No events loaded for this session.</div>
            ) : (
              <table className="si-event-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Path</th>
                    <th>Step</th>
                    <th>Product</th>
                    <th>Campaign</th>
                    <th>Device</th>
                    <th>Country</th>
                  </tr>
                </thead>
                <tbody>
                  {libraryEvents.slice(0, 200).map((e) => {
                    const campaignCell = campaignCellProps(e.utm_source, e.utm_campaign);
                    return (
                      <tr key={e.id}>
                        <td title={e.created_at || e.event_ts}>{formatShort(e.created_at || e.event_ts)}</td>
                        <td>{e.event_name}</td>
                        <td title={e.page_path || ''}>
                          <span className="si-path-label">{formatPathLabel(e.page_path, e.checkout_step)}</span>
                        </td>
                        <td>{e.checkout_step ? <span className="si-badge">{normalizeStepLabel(e.checkout_step)}</span> : '—'}</td>
                        <td title={[e.product_id, e.variant_id].filter(Boolean).join('\n')}>
                          {e.variant_id ? 'variant' : e.product_id ? 'product' : '—'}
                        </td>
                        <td title={campaignCell.title}>
                          {campaignCell.display}
                        </td>
                        <td>{e.device_type || '—'}</td>
                        <td>{e.country_code || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {selectedLibrarySession?.summary && (
              <div className="si-card si-ai-card" style={{ marginTop: 12 }}>
                <div className="si-card-title">
                  <h3>AI summary</h3>
                  <span className="si-muted">
                    {selectedLibrarySession.primary_reason || '—'} •{' '}
                    {selectedLibrarySession.confidence != null ? `${Math.round(selectedLibrarySession.confidence * 100)}%` : '—'}
                  </span>
                </div>
                <div className="si-muted">{selectedLibrarySession.summary}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="si-row" style={{ marginTop: 14, justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="si-muted" style={{ fontSize: 12 }}>
          {eventsStatus === 'ok'
            ? `Live events: last ${latestEventAt ? timeAgo(latestEventAt) : '—'} • updated ${lastUpdatedAt ? timeAgo(lastUpdatedAt) : '—'}`
            : 'Live events: waiting for events…'}
        </div>

        <button
          type="button"
          className={`si-chip si-chip-button ${sanityOpen ? 'si-chip-active' : ''}`}
          aria-pressed={sanityOpen}
          onClick={() => setSanityOpen((v) => !v)}
          title="Live Shopify events (debug feed)"
        >
          <Activity size={14} />
          Live events
          <ChevronDown
            size={14}
            style={{
              transition: 'transform 150ms ease',
              transform: sanityOpen ? 'rotate(180deg)' : 'rotate(0deg)'
            }}
          />
        </button>
      </div>

      {sanityOpen ? (
        <div className="si-card" style={{ marginTop: 10 }}>
          {events.length === 0 ? (
            <div className="si-empty">
              No events yet. Open Shopify and trigger <span className="si-badge">page_viewed</span> or{' '}
              <span className="si-badge">checkout_started</span>.
            </div>
          ) : (
            <table className="si-event-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Path</th>
                  <th>Checkout step</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 30).map((event) => (
                  <tr key={event.id}>
                    <td>{timeAgo(event.created_at || event.event_ts)}</td>
                    <td>
                      <span className="si-event-name">
                        <Activity size={14} />
                        {event.event_name}
                      </span>
                    </td>
                    <td title={event.page_url || event.page_path || ''}>
                      {event.page_path || event.page_url || '—'}
                    </td>
                    <td>
                      {event.checkout_step ? (
                        <span className="si-badge">{normalizeStepLabel(event.checkout_step)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      title={[
                        event.client_id ? `client_id: ${event.client_id}` : null,
                        event.session_id ? `session_id: ${event.session_id}` : null
                      ].filter(Boolean).join('\n')}
                    >
                      {userLabel(event)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
        </>
      ) : null}

      {storyOpen ? (
        <div className="si-drawer-backdrop" role="dialog" aria-modal="true" onClick={closeStory}>
          <div className="si-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="si-drawer-header">
              <div style={{ minWidth: 0 }}>
                <div className="si-drawer-title">
                  {storySession ? userLabel(storySession) : 'Session story'}
                </div>
                <div className="si-muted" style={{ marginTop: 2 }}>
                  {libraryDay ? `Day ${libraryDay}` : '—'}
                  {storySession?.device_type ? ` • ${normalizeDeviceLabel(storySession.device_type)}` : ''}
                  {storySession?.country_code ? ` • ${countryNameFromCode(storySession.country_code)}` : ''}
                  {storySession?.utm_source ? ` • ${normalizeTrafficSourceLabel(storySession.utm_source)}` : ''}
                  {storySession?.utm_campaign ? ` • ${storySession.utm_campaign}` : ''}
                </div>
              </div>
              <button className="si-button si-button-small" type="button" onClick={closeStory}>
                Close
              </button>
            </div>

            {storyError ? (
              <div className="si-empty" style={{ color: '#b42318', marginTop: 10 }}>
                {storyError}
              </div>
            ) : null}

            {storyLoading ? (
              <div className="si-empty" style={{ marginTop: 10 }}>
                Loading events…
              </div>
            ) : null}

            {!storyLoading && !storyError ? (
              <>
                <div className="si-story-metrics">
                  {(() => {
                    const counts = {
                      rage: 0,
                      dead: 0,
                      errors: 0,
                      invalid: 0,
                      maxScroll: 0
                    };
                    (storyEvents || []).forEach((ev) => {
                      const name = String(ev?.event_name || '').toLowerCase();
                      if (name === 'rage_click') counts.rage += 1;
                      if (name === 'dead_click') counts.dead += 1;
                      if (name === 'js_error' || name === 'unhandled_rejection') counts.errors += 1;
                      if (name === 'form_invalid') counts.invalid += 1;
                      if (name === 'scroll_depth' || name === 'scroll_max') {
                        const data = safeJsonParse(ev?.data_json) || {};
                        const percent = Number(data.max_percent ?? data.percent);
                        if (Number.isFinite(percent) && percent > counts.maxScroll) counts.maxScroll = percent;
                      }
                    });

                    const items = [
                      { label: 'Rage clicks', value: counts.rage },
                      { label: 'Dead clicks', value: counts.dead },
                      { label: 'Errors', value: counts.errors },
                      { label: 'Invalid submits', value: counts.invalid },
                      { label: 'Max scroll', value: counts.maxScroll ? `${Math.round(counts.maxScroll)}%` : '—' }
                    ];

                    return items.map((item) => (
                      <div key={item.label} className="si-story-metric">
                        <div className="si-story-metric-label">{item.label}</div>
                        <div className="si-story-metric-value">{item.value}</div>
                      </div>
                    ));
                  })()}
                </div>

                <div className="si-story-events">
                  <div className="si-card-title" style={{ marginBottom: 8 }}>
                    <h3 style={{ fontSize: 13, margin: 0 }}>Event stream</h3>
                    <span className="si-muted">{storyEvents.length ? `${storyEvents.length} events` : '—'}</span>
                  </div>

                  {storyEvents.length === 0 ? (
                    <div className="si-empty">No events for this session on {libraryDay}.</div>
                  ) : (
                    <div className="si-story-list">
                      {storyEvents.slice(-120).map((ev) => {
                        const nameKey = String(ev?.event_name || '').toLowerCase();
                        const isSignal = (
                          nameKey === 'rage_click' ||
                          nameKey === 'dead_click' ||
                          nameKey === 'js_error' ||
                          nameKey === 'unhandled_rejection' ||
                          nameKey === 'form_invalid'
                        );
                        return (
                          <div key={ev.id} className={`si-story-row ${isSignal ? 'si-story-row-signal' : ''}`}>
                            <div className="si-story-time">{formatShort(ev.created_at || ev.event_ts)}</div>
                            <div className="si-story-name">{normalizeEventLabel(ev.event_name)}</div>
                            <div className="si-story-path" title={ev.page_path || ''}>{formatPathLabel(ev.page_path, ev.checkout_step)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
