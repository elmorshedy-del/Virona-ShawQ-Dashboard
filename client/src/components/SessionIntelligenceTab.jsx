import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, RefreshCw } from 'lucide-react';
import GeoHotspotsMap from './GeoHotspotsMap';
import './SessionIntelligenceTab.css';

const POLL_EVENTS_MS = 1000;
const POLL_REALTIME_MS = 5000;
const POLL_OVERVIEW_MS = 20000;
const REALTIME_WINDOW_MINUTES = 30;
const REALTIME_GEO_ROWS_LIMIT = 8;
const CLARITY_PRIOR_ALPHA = 1;
const CLARITY_PRIOR_BETA = 3;
const CLARITY_EVIDENCE_HALF_SATURATION = 8;
const CLARITY_CONFIDENCE_POSTERIOR_WEIGHT = 0.7;
const CLARITY_CONFIDENCE_EVIDENCE_WEIGHT = 0.3;
const CLARITY_IMPACT_RATE_WEIGHT = 0.65;
const CLARITY_IMPACT_VOLUME_WEIGHT = 0.35;
const CLARITY_FINAL_SCORE_CONFIDENCE_WEIGHT = 0.55;
const CLARITY_FINAL_SCORE_IMPACT_WEIGHT = 0.45;
const CLARITY_MED_MIN_OBSERVATIONS = 4;
const CLARITY_HIGH_MIN_OBSERVATIONS = 10;
const CLARITY_MED_CONFIDENCE_THRESHOLD = 0.25;
const CLARITY_HIGH_CONFIDENCE_THRESHOLD = 0.5;
const JOURNEY_REPORT_LIMIT = 25;

const JOURNEY_UI_THRESHOLDS = {
  HERO_MIN_ATTRIBUTED_ABANDON_SESSIONS: 20
};
const TRAFFIC_RATIO_MIN_SHARE = 0.0001;

const INTEGRITY_THRESHOLDS = {
  RECONCILIATION_TOLERANCE_ABS: 5,
  UNCLASSIFIED_WARN_RATIO: 0.10,
  UNCLASSIFIED_DANGER_RATIO: 0.25,
  COVERAGE_WARN_THRESHOLD: 0.90,
  COVERAGE_DANGER_THRESHOLD: 0.70
};

const SESSION_INTELLIGENCE_LLM_KEY = 'virona.sessionIntelligence.llm.v1';

const SI_COPY = {
  en: {
    'integrity.status.success': 'Data aligned',
    'integrity.status.warn': 'Partial match',
    'integrity.status.danger': 'Check data',
    'integrity.status.neutral': 'No data',
    'integrity.healthySummary': '{{count}} abandons tracked',
    'integrity.neutralSummary': 'No abandons in range',
    'integrity.issueSummary': 'Coverage {{coverage}} — review details',
    'integrity.scopeNote': 'Abandon = intent without purchase',
    'integrity.totalAbandons': 'Total abandons',
    'integrity.coverageRatio': 'Attribution coverage',
    'integrity.deviceReconciliation': 'Segment drift',
    'integrity.unclassified': 'Needs review',
    'scope.all': 'All journeys',
    'scope.cart': 'Cart',
    'scope.checkout': 'Checkout',
    'scope.payment': 'Payment'
  }
};

function scopeLabel(scopeKey) {
  if (scopeKey === 'Cart') return t('scope.cart');
  if (scopeKey === 'Checkout') return t('scope.checkout');
  if (scopeKey === 'Checkout Payment') return t('scope.payment');
  if (scopeKey === 'all') return t('scope.all');
  return scopeKey || '—';
}

function formatCopyTemplate(raw, params) {
  if (!raw) return '';
  const map = params && typeof params === 'object' ? params : {};
  return raw.replace(/\{\{(\w+)\}\}/g, (_match, key) => (
    map[key] == null ? '' : String(map[key])
  ));
}

function t(key, params = null) {
  const raw = SI_COPY.en[key] || key;
  return formatCopyTemplate(raw, params);
}

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

function safeString(value) {
  if (value == null) return '';
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

async function fetchJson(url, options) {
  const res = await fetch(url, { cache: 'no-store', ...options });
  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();

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

function formatSignedNumber(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const fixed = n.toFixed(digits);
  return n > 0 ? `+${fixed}` : fixed;
}

function formatTimes(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}x`;
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
  if (key === 'mobile') return 'Mobile';
  if (key === 'desktop') return 'Desktop';
  if (key === 'tablet') return 'Tablet';
  return raw;
}

function normalizeLooseKey(value) {
  return (value || '').toString().toLowerCase().trim();
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

function normalizeClarityMode(value) {
  const key = (value || '').toString().toLowerCase().trim();
  if (key === 'all') return 'all';
  return 'high_intent_no_purchase';
}

function isHighIntentNoPurchaseSession(session) {
  const atc = Number(session?.atc_events) || 0;
  const checkout = Number(session?.checkout_started_events) || 0;
  const purchase = Number(session?.purchase_events) || 0;
  return (atc > 0 || checkout > 0) && purchase === 0;
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
    label: 'MutationObserver target invalid',
    match: 'all'
  },
  {
    keywords: ['_autofillcallbackhandler'],
    label: 'Autofill callback missing',
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

function buildClarityIssueRows({ claritySignals, librarySessions, selectedDay }) {
  const sessions = Array.isArray(librarySessions) ? librarySessions : [];
  const highIntentSessions = sessions.filter(isHighIntentNoPurchaseSession).length;
  const analysisMode = normalizeClarityMode(claritySignals?.mode);
  const serverAnalyzedSessions = Number(claritySignals?.totals?.sessions);
  const hasServerAnalyzedSessions = Number.isFinite(serverAnalyzedSessions) && serverAnalyzedSessions >= 0;
  const analyzedSessions = hasServerAnalyzedSessions
    ? serverAnalyzedSessions
    : analysisMode === 'all'
      ? sessions.length
      : highIntentSessions;
  const safeAnalyzedSessions = Math.max(0, analyzedSessions);

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
      const sessionsAffectedRaw = Math.max(0, Number(issue?.sessions) || 0);
      const sessionsAffected = safeAnalyzedSessions > 0
        ? Math.min(sessionsAffectedRaw, safeAnalyzedSessions)
        : sessionsAffectedRaw;
      const observations = Math.max(
        sessionsAffected,
        Number(issue?.count) || 0,
        Number(issue?.total_sessions) || 0
      );
      const posteriorMean = safeAnalyzedSessions > 0
        ? (sessionsAffected + CLARITY_PRIOR_ALPHA)
        / (safeAnalyzedSessions + CLARITY_PRIOR_ALPHA + CLARITY_PRIOR_BETA)
        : 0;
      const evidenceWeight = safeAnalyzedSessions > 0 && observations > 0
        ? observations / (observations + CLARITY_EVIDENCE_HALF_SATURATION)
        : 0;
      const confidenceScore = clamp01(
        (posteriorMean * CLARITY_CONFIDENCE_POSTERIOR_WEIGHT)
        + (evidenceWeight * CLARITY_CONFIDENCE_EVIDENCE_WEIGHT)
      );
      const issueRate = safeAnalyzedSessions > 0 ? sessionsAffected / safeAnalyzedSessions : 0;
      const volumeScore = safeAnalyzedSessions > 0
        ? Math.log1p(sessionsAffected) / Math.log1p(safeAnalyzedSessions)
        : 0;
      const impactBase = clamp01(
        (issueRate * CLARITY_IMPACT_RATE_WEIGHT)
        + (volumeScore * CLARITY_IMPACT_VOLUME_WEIGHT)
      );
      const impactScore = impactBase * meta.severityWeight * dayRecencyWeight;
      const score = (
        confidenceScore * CLARITY_FINAL_SCORE_CONFIDENCE_WEIGHT
      ) + (
        impactScore * CLARITY_FINAL_SCORE_IMPACT_WEIGHT
      );
      const confidenceLabel = observations >= CLARITY_HIGH_MIN_OBSERVATIONS
        && confidenceScore >= CLARITY_HIGH_CONFIDENCE_THRESHOLD
        ? 'High'
        : observations >= CLARITY_MED_MIN_OBSERVATIONS
          && confidenceScore >= CLARITY_MED_CONFIDENCE_THRESHOLD
          ? 'Med'
          : 'Low';

      collected.push({
        id: `${type}-${index}`,
        type,
        issueLabel: meta.label,
        whereLabel: buildIssueWhereLabel(type, issue),
        action: meta.action,
        severityWeight: meta.severityWeight,
        countLabel: meta.countLabel,
        sessionsAffected,
        issueRate,
        observations,
        posteriorMean,
        evidenceWeight,
        confidenceScore,
        impactScore,
        score,
        confidenceLabel,
        recencyWeight: dayRecencyWeight,
        sampleSessions: Array.isArray(issue?.sample_sessions) ? issue.sample_sessions : []
      });
    });
  });

  if (collected.length === 0) {
    return {
      rows: [],
      analyzedSessions: safeAnalyzedSessions,
      highIntentSessions,
      analysisMode,
      totalSessions: sessions.length,
      purchases: sessions.filter((s) => (Number(s?.purchase_events) || 0) > 0).length
    };
  }

  const rows = collected
    .sort((a, b) => b.score - a.score)
    .map((row, idx) => ({
      ...row,
      rank: idx + 1
    }));

  const purchases = sessions.filter((s) => (Number(s?.purchase_events) || 0) > 0).length;
  return {
    rows,
    analyzedSessions: safeAnalyzedSessions,
    highIntentSessions,
    analysisMode,
    totalSessions: sessions.length,
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
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyError, setJourneyError] = useState('');
  const [landingJourneyReport, setLandingJourneyReport] = useState(null);
  const [abandonmentJourneyReport, setAbandonmentJourneyReport] = useState(null);
  const [journeyScope, setJourneyScope] = useState('all');
  const [showIntegrityDetails, setShowIntegrityDetails] = useState(false);
  const [expandedAbandonmentKey, setExpandedAbandonmentKey] = useState('');

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
  const journeyDeviceTableRef = useRef(null);

  const scrollToDeviceTable = useCallback(() => {
    journeyDeviceTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    persistSessionIntelligenceLlmSettings(analysisLlm);
  }, [analysisLlm]);

  useEffect(() => {
    setShowIntegrityDetails(false);
  }, [libraryDay]);

  useEffect(() => {
    setExpandedAbandonmentKey('');
  }, [libraryDay, journeyScope]);

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

  const loadJourneyReports = useCallback(async (day) => {
    if (!day) return;
    setJourneyLoading(true);
    setJourneyError('');
    try {
      const baseParams = new URLSearchParams({
        store: storeId,
        startDate: day,
        endDate: day,
        limit: String(JOURNEY_REPORT_LIMIT)
      });
      const [landingPayload, abandonmentPayload] = await Promise.all([
        fetchJson(`/api/session-intelligence/journey/landing-purchases?${baseParams.toString()}`),
        fetchJson(`/api/session-intelligence/journey/abandonment?${baseParams.toString()}`)
      ]);
      setLandingJourneyReport(landingPayload || null);
      setAbandonmentJourneyReport(abandonmentPayload || null);
    } catch (error) {
      console.error('[SessionIntelligenceTab] journey reports load failed:', error);
      setJourneyError(error?.message || 'Failed to load journey directional reports');
      setLandingJourneyReport(null);
      setAbandonmentJourneyReport(null);
    } finally {
      setJourneyLoading(false);
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

  useEffect(() => {
    if (!libraryDay) return;
    loadJourneyReports(libraryDay);
  }, [libraryDay, loadJourneyReports]);

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
        loadJourneyReports(libraryDay),
        loadSessions(),
        loadEvents(),
        loadLibraryDays()
      ]);
    } finally {
      setLoading(false);
    }
  }, [flowMode, libraryDay, loadBrief, loadClarity, loadEvents, loadFlow, loadJourneyReports, loadLibraryDays, loadOverview, loadRealtime, loadSessions]);

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
  const visibleIssueRows = showAllIssues ? issueRows : issueRows.slice(0, 8);
  const topIssue = issueRows[0] || null;

  const summaryTotals = useMemo(() => {
    const sessionsTotal = Number(issueModel.totalSessions) || 0;
    const analyzedSessions = Number(issueModel.analyzedSessions) || 0;
    const highIntentSessions = Number(issueModel.highIntentSessions) || 0;
    const purchases = Number(issueModel.purchases) || 0;
    const estimatedAtRisk = Math.min(
      analyzedSessions,
      issueRows.reduce((sum, row) => sum + (Number(row.sessionsAffected) || 0), 0)
    );
    return { sessionsTotal, analyzedSessions, highIntentSessions, purchases, estimatedAtRisk };
  }, [issueModel.analyzedSessions, issueModel.highIntentSessions, issueModel.purchases, issueModel.totalSessions, issueRows]);

  const analyzedScopeLabel = issueModel.analysisMode === 'all'
    ? 'analyzed (all sessions)'
    : 'analyzed (intent without purchase)';
  const summaryLine = topIssue
    ? `Today: ${formatNumber(summaryTotals.sessionsTotal)} sessions, ${formatNumber(summaryTotals.analyzedSessions)} ${analyzedScopeLabel}, ${formatNumber(summaryTotals.highIntentSessions)} high-intent, ${formatNumber(summaryTotals.purchases)} purchases, largest drop-off = ${topIssue.issueLabel} (${pluralize(topIssue.sessionsAffected, 'session', 'sessions')}).`
    : `Today: ${formatNumber(summaryTotals.sessionsTotal)} sessions, ${formatNumber(summaryTotals.analyzedSessions)} ${analyzedScopeLabel}, ${formatNumber(summaryTotals.highIntentSessions)} high-intent, ${formatNumber(summaryTotals.purchases)} purchases. No major issue surfaced yet.`;

  const landingJourneyRows = Array.isArray(landingJourneyReport?.rows) ? landingJourneyReport.rows : [];
  const abandonmentJourneyRows = Array.isArray(abandonmentJourneyReport?.rows) ? abandonmentJourneyReport.rows : [];
  const deviceJourneyRows = Array.isArray(abandonmentJourneyReport?.deviceSegments?.rows)
    ? abandonmentJourneyReport.deviceSegments.rows
    : [];
  const countryJourneyRows = Array.isArray(abandonmentJourneyReport?.countrySegments?.rows)
    ? abandonmentJourneyReport.countrySegments.rows
    : [];
  const deviceBaselineAbandonRate = Number(abandonmentJourneyReport?.deviceSegments?.baselineAbandonRate) || 0;
  const journeyTotalAbandonSessions = Number(abandonmentJourneyReport?.totalAbandonSessions) || 0;
  const journeyClassifiedAbandonSessions = Number(abandonmentJourneyReport?.classifiedAbandonSessions) || 0;
  const journeyUnclassifiedAbandonSessions = Number(abandonmentJourneyReport?.unclassifiedSessions) || 0;
  const journeyCoverageRatio = Number.isFinite(Number(abandonmentJourneyReport?.coverageRatio))
    ? Number(abandonmentJourneyReport?.coverageRatio)
    : journeyTotalAbandonSessions > 0
      ? journeyClassifiedAbandonSessions / journeyTotalAbandonSessions
      : 0;
  const journeyDeviceMinusRoot = Number(abandonmentJourneyReport?.reconciliation?.deviceMinusRoot) || 0;
  const journeyIntegrity = useMemo(() => {
    const total = journeyTotalAbandonSessions;
    const unclassifiedRatio = total > 0 ? journeyUnclassifiedAbandonSessions / total : 0;
    const reconciliationAbs = Math.abs(journeyDeviceMinusRoot);
    const reconciliationSignificant = reconciliationAbs > INTEGRITY_THRESHOLDS.RECONCILIATION_TOLERANCE_ABS;

    if (journeyError) {
      return { tone: 'danger', unclassifiedRatio, reconciliationAbs, reconciliationSignificant };
    }

    if (journeyLoading || total === 0) {
      return { tone: 'neutral', unclassifiedRatio, reconciliationAbs, reconciliationSignificant };
    }

    const coverageTone = journeyCoverageRatio < INTEGRITY_THRESHOLDS.COVERAGE_DANGER_THRESHOLD
      ? 'danger'
      : journeyCoverageRatio < INTEGRITY_THRESHOLDS.COVERAGE_WARN_THRESHOLD
        ? 'warn'
        : null;
    const unclassifiedTone = unclassifiedRatio > INTEGRITY_THRESHOLDS.UNCLASSIFIED_DANGER_RATIO
      ? 'danger'
      : unclassifiedRatio > INTEGRITY_THRESHOLDS.UNCLASSIFIED_WARN_RATIO
        ? 'warn'
        : null;

    if (coverageTone === 'danger' || unclassifiedTone === 'danger' || reconciliationSignificant) {
      return { tone: 'danger', unclassifiedRatio, reconciliationAbs, reconciliationSignificant };
    }

    if (coverageTone === 'warn' || unclassifiedTone === 'warn') {
      return { tone: 'warn', unclassifiedRatio, reconciliationAbs, reconciliationSignificant };
    }

    return { tone: 'success', unclassifiedRatio, reconciliationAbs, reconciliationSignificant };
  }, [
    journeyCoverageRatio,
    journeyDeviceMinusRoot,
    journeyError,
    journeyLoading,
    journeyTotalAbandonSessions,
    journeyUnclassifiedAbandonSessions
  ]);
  const journeyIntegrityTone = journeyIntegrity.tone;

  const journeyScopeOptions = useMemo(() => ([
    { key: 'all', label: t('scope.all') },
    { key: 'Cart', label: t('scope.cart') },
    { key: 'Checkout', label: t('scope.checkout') },
    { key: 'Checkout Payment', label: t('scope.payment') }
  ]), []);
  const countryTrafficShareByCode = useMemo(() => {
    const map = new Map();
    for (const row of countryJourneyRows) {
      const key = safeString(row?.key || row?.label).trim().toUpperCase();
      if (!key) continue;
      map.set(key, Number(row?.trafficShare) || 0);
    }
    return map;
  }, [countryJourneyRows]);

  const journeyHero = useMemo(() => {
    if (journeyScope !== 'all') return null;
    if (journeyError || journeyLoading) return null;
    if (journeyClassifiedAbandonSessions < JOURNEY_UI_THRESHOLDS.HERO_MIN_ATTRIBUTED_ABANDON_SESSIONS) return null;

    const stageKeys = ['Cart', 'Checkout', 'Checkout Payment'];
    const counts = { Cart: 0, Checkout: 0, 'Checkout Payment': 0, Other: 0 };
    for (const row of abandonmentJourneyRows) {
      const key = safeString(row?.abandoned_part).trim();
      const sessions = Number(row?.sessions) || 0;
      if (!key || sessions <= 0) continue;
      if (stageKeys.includes(key)) counts[key] += sessions;
      else counts.Other += sessions;
    }

    const stageEntries = stageKeys
      .map((key) => ({ key, sessions: counts[key] }))
      .filter((entry) => entry.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions);
    const topStage = stageEntries[0] || null;
    if (!topStage) return null;

    const topProductRow = abandonmentJourneyRows
      .filter((row) => safeString(row?.abandoned_part).trim() === topStage.key)
      .sort((a, b) => (Number(b?.sessions) || 0) - (Number(a?.sessions) || 0))[0] || null;
    const topProduct = safeString(topProductRow?.product).trim();
    const topSampleSession = Array.isArray(topProductRow?.sample_sessions)
      ? topProductRow.sample_sessions.find((session) => safeString(session?.session_id).trim())
      : null;

    const topDeviceEntry = deviceJourneyRows
      .map((row) => {
        const sectionCounts = row?.sectionCounts && typeof row.sectionCounts === 'object' ? row.sectionCounts : null;
        const sessions = sectionCounts ? (Number(sectionCounts[topStage.key]) || 0) : 0;
        return sessions > 0 ? { row, sessions } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.sessions - a.sessions)[0] || null;
    const topDevice = topDeviceEntry?.row || null;
    const topDeviceSessions = Number(topDeviceEntry?.sessions) || 0;
    const topDeviceTrafficShare = Number(topDevice?.trafficShare) || 0;

    const attributedTotal = stageKeys.reduce((sum, key) => sum + (Number(counts[key]) || 0), 0) + (Number(counts.Other) || 0);
    const topStageShare = journeyClassifiedAbandonSessions > 0 ? topStage.sessions / journeyClassifiedAbandonSessions : 0;
    const topDeviceShare = topStage.sessions > 0 ? topDeviceSessions / topStage.sessions : 0;
    const topDeviceOverIndex = topDeviceTrafficShare > TRAFFIC_RATIO_MIN_SHARE
      ? topDeviceShare / topDeviceTrafficShare
      : null;
    const topCountryEntry = countryJourneyRows
      .map((row) => {
        const sectionCounts = row?.sectionCounts && typeof row.sectionCounts === 'object' ? row.sectionCounts : null;
        const sessions = sectionCounts ? (Number(sectionCounts[topStage.key]) || 0) : 0;
        return sessions > 0 ? { row, sessions } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.sessions - a.sessions)[0] || null;
    const topCountry = topCountryEntry?.row || null;
    const topCountrySessions = Number(topCountryEntry?.sessions) || 0;
    const topCountryTrafficShare = Number(topCountry?.trafficShare) || 0;
    const topCountryShare = topStage.sessions > 0 ? topCountrySessions / topStage.sessions : 0;
    const topCountryOverIndex = topCountryTrafficShare > TRAFFIC_RATIO_MIN_SHARE
      ? topCountryShare / topCountryTrafficShare
      : null;

    return {
      stageCounts: counts,
      attributedTotal,
      topStageKey: topStage.key,
      topStageLabel: scopeLabel(topStage.key),
      topStageSessions: topStage.sessions,
      topStageShare,
      topProduct: topProduct && topProduct !== '—' ? topProduct : '',
      topDeviceLabel: safeString(topDevice?.label || topDevice?.key).trim(),
      topDeviceSessions,
      topDeviceShare,
      topDeviceTrafficShare,
      topDeviceOverIndex,
      topCountryCode: safeString(topCountry?.key || topCountry?.label).trim().toUpperCase(),
      topCountrySessions,
      topCountryShare,
      topCountryTrafficShare,
      topCountryOverIndex,
      topSampleSession
    };
  }, [
    abandonmentJourneyRows,
    countryJourneyRows,
    deviceJourneyRows,
    journeyClassifiedAbandonSessions,
    journeyError,
    journeyLoading,
    journeyScope
  ]);

  const scopedAbandonmentJourneyRows = useMemo(() => {
    if (journeyScope === 'all') return abandonmentJourneyRows;
    return abandonmentJourneyRows.filter((row) => ((row?.abandoned_part || '').toString().trim() === journeyScope));
  }, [abandonmentJourneyRows, journeyScope]);

  const scopedDeviceJourneyRows = useMemo(() => {
    if (journeyScope === 'all') return deviceJourneyRows;
    const scopeKey = journeyScope;
    const countFor = (row) => {
      const value = row?.sectionCounts && typeof row.sectionCounts === 'object'
        ? row.sectionCounts[scopeKey]
        : null;
      return Number(value) || 0;
    };
    return [...deviceJourneyRows].sort((a, b) => {
      const delta = countFor(b) - countFor(a);
      if (delta) return delta;
      if ((b.excessAbandon || 0) !== (a.excessAbandon || 0)) return (b.excessAbandon || 0) - (a.excessAbandon || 0);
      return (b.abandonRate || 0) - (a.abandonRate || 0);
    });
  }, [deviceJourneyRows, journeyScope]);
  const journeyPeriodLabel = landingJourneyReport?.period?.start && landingJourneyReport?.period?.end
    ? `${landingJourneyReport.period.start} to ${landingJourneyReport.period.end} (UTC)`
    : libraryDay ? `${libraryDay} (UTC)` : 'Current range';

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
            <span className="bento-card si-refresh-inner">
              <RefreshCw className={loading ? 'animate-spin' : ''} size={14} />
              Refresh
            </span>
          </button>
        </div>
      </div>

      <div className="bento-card si-realtime-card" style={{ marginBottom: 12 }}>
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
          <div className="bento-card si-realtime-panel-map">
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

          <div className="bento-card si-realtime-panel-source">
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

          <div className="bento-card si-realtime-panel-pages">
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

          <div className="bento-card si-realtime-panel-events">
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

      <div className="bento-card si-summary-card" style={{ marginBottom: 12 }}>
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
            <div className="si-summary-kpi-value">{formatNumber(summaryTotals.highIntentSessions)}</div>
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

      <div className="bento-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Journey directional</h3>
          <span className="si-muted">{journeyPeriodLabel}</span>
        </div>

        {libraryDay ? (
          journeyLoading && !abandonmentJourneyReport ? (
            <div className="si-empty" style={{ padding: 10 }}>Loading data health…</div>
          ) : journeyError ? (
            <div className="si-empty" style={{ color: '#b42318', padding: 10 }}>{journeyError}</div>
          ) : (
            <>
              <div className="si-row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                <div className="si-integrity-summary">
                  <span className="si-muted">Data health</span>
                  <button
                    className={`si-badge si-badge-clickable ${
                      journeyIntegrityTone === 'success'
                        ? 'si-badge-success'
                        : journeyIntegrityTone === 'warn'
                          ? 'si-badge-warn'
                          : journeyIntegrityTone === 'danger'
                            ? 'si-badge-danger'
                            : ''
                    }`}
                    type="button"
                    onClick={() => setShowIntegrityDetails((v) => !v)}
                    aria-expanded={showIntegrityDetails}
                  >
                    {journeyIntegrityTone === 'success'
                      ? t('integrity.status.success')
                      : journeyIntegrityTone === 'warn'
                        ? t('integrity.status.warn')
                        : journeyIntegrityTone === 'danger'
                          ? t('integrity.status.danger')
                          : t('integrity.status.neutral')}
                    <span className="si-badge-chevron">{showIntegrityDetails ? '▾' : '▸'}</span>
                  </button>
                  <span className="si-muted si-integrity-headline">
                    {journeyIntegrityTone === 'success'
                      ? t('integrity.healthySummary', { count: formatNumber(journeyTotalAbandonSessions) })
                      : journeyIntegrityTone === 'neutral'
                        ? t('integrity.neutralSummary')
                        : t('integrity.issueSummary', { coverage: formatPercent(journeyCoverageRatio, 0) })}
                  </span>
                </div>
              </div>

              {showIntegrityDetails ? (
                <div className="si-integrity-details">
                  <div className="si-muted" style={{ marginBottom: 10 }}>
                    {t('integrity.scopeNote')}
                  </div>
                  <div className="si-metric-row">
                    <span className="si-muted">{t('integrity.totalAbandons')}</span>
                    <strong>{formatNumber(journeyTotalAbandonSessions)}</strong>
                  </div>
                  <div className="si-metric-row">
                    <span className="si-muted">{t('integrity.coverageRatio')}</span>
                    <strong className={journeyCoverageRatio < INTEGRITY_THRESHOLDS.COVERAGE_WARN_THRESHOLD ? 'si-text-warn' : ''}>
                      {formatPercent(journeyCoverageRatio, 0)}
                    </strong>
                  </div>
                  {journeyIntegrity.reconciliationSignificant ? (
                    <div className="si-metric-row">
                      <span className="si-muted">{t('integrity.deviceReconciliation')}</span>
                      <strong className="si-text-warn">{formatSignedNumber(journeyDeviceMinusRoot, 0)}</strong>
                    </div>
                  ) : null}
                  {journeyUnclassifiedAbandonSessions > 0 ? (
                    <div className="si-metric-row">
                      <span className="si-muted">{t('integrity.unclassified')}</span>
                      <strong>{formatNumber(journeyUnclassifiedAbandonSessions)}</strong>
                      <span className="si-muted">({formatPercent(journeyIntegrity.unclassifiedRatio, 0)})</span>
                    </div>
                  ) : null}
                  {abandonmentJourneyReport?.unclassifiedBreakdown && typeof abandonmentJourneyReport.unclassifiedBreakdown === 'object' ? (
                    <div className="si-breakdown-mini">
                      {Object.entries(abandonmentJourneyReport.unclassifiedBreakdown).slice(0, 3).map(([reason, count]) => (
                        <div key={reason} className="si-breakdown-row">
                          <span className="si-muted">{reason}</span>
                          <span>{formatNumber(count)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {journeyHero ? (
                <div className="si-journey-hero">
                  <div className="si-journey-hero-top">
                    <div className="si-journey-hero-kicker">Largest attributed drop-off</div>
                    <div className="si-journey-hero-main">
                      <span className="si-badge">{journeyHero.topStageLabel}</span>
                      <strong>{formatNumber(journeyHero.topStageSessions)}</strong>
                      <span className="si-muted">({formatPercent(journeyHero.topStageShare, 0)} of attributed)</span>
                    </div>
                    {journeyHero.topDeviceSessions > 0 && journeyHero.topDeviceLabel ? (
                      <div className="si-muted">
                        Top device: <strong>{journeyHero.topDeviceLabel}</strong>
                        {' '}({formatPercent(journeyHero.topDeviceShare, 0)} of drop-offs vs {formatPercent(journeyHero.topDeviceTrafficShare, 0)} traffic
                        {journeyHero.topDeviceOverIndex != null ? `, ${formatTimes(journeyHero.topDeviceOverIndex)} over-index` : ''})
                      </div>
                    ) : null}
                    {journeyHero.topCountrySessions > 0 && journeyHero.topCountryCode ? (
                      <div className="si-muted">
                        Top country: <strong>{countryNameFromCode(journeyHero.topCountryCode)}</strong>
                        {' '}({formatPercent(journeyHero.topCountryShare, 0)} of drop-offs vs {formatPercent(journeyHero.topCountryTrafficShare, 0)} traffic
                        {journeyHero.topCountryOverIndex != null ? `, ${formatTimes(journeyHero.topCountryOverIndex)} over-index` : ''})
                      </div>
                    ) : null}
                    {journeyHero.topProduct ? (
                      <div className="si-muted">Top product focus: <strong>{journeyHero.topProduct}</strong></div>
                    ) : null}
                  </div>

                  <div className="si-journey-hero-bar" aria-hidden="true">
                    {(() => {
                      const total = Math.max(1, Number(journeyHero.attributedTotal) || 0);
                      const cart = Number(journeyHero.stageCounts?.Cart) || 0;
                      const checkout = Number(journeyHero.stageCounts?.Checkout) || 0;
                      const payment = Number(journeyHero.stageCounts?.['Checkout Payment']) || 0;
                      const other = Number(journeyHero.stageCounts?.Other) || 0;
                      return (
                        <>
                          {cart > 0 ? <span className="si-journey-hero-seg si-journey-hero-cart" style={{ width: `${(cart / total) * 100}%` }} /> : null}
                          {checkout > 0 ? <span className="si-journey-hero-seg si-journey-hero-checkout" style={{ width: `${(checkout / total) * 100}%` }} /> : null}
                          {payment > 0 ? <span className="si-journey-hero-seg si-journey-hero-payment" style={{ width: `${(payment / total) * 100}%` }} /> : null}
                          {other > 0 ? <span className="si-journey-hero-seg si-journey-hero-other" style={{ width: `${(other / total) * 100}%` }} /> : null}
                        </>
                      );
                    })()}
                  </div>

                  <div className="si-row si-journey-hero-actions" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="si-button si-button-small"
                      type="button"
                      onClick={() => setJourneyScope(journeyHero.topStageKey)}
                    >
                      Focus {journeyHero.topStageLabel}
                    </button>
                    <button
                      className="si-button si-button-small"
                      type="button"
                      onClick={scrollToDeviceTable}
                    >
                      View devices
                    </button>
                    {safeString(journeyHero.topSampleSession?.session_id).trim() ? (
                      <button
                        className="si-button si-button-small"
                        type="button"
                        onClick={() => openStory(journeyHero.topSampleSession.session_id, journeyHero.topSampleSession)}
                      >
                        Open sample session
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          )
        ) : null}

        <div className="si-row si-scope-row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div className="si-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="si-muted">Focus</span>
            {journeyScopeOptions.map((option) => (
              <button
                key={option.key}
                className={`si-button si-button-small ${journeyScope === option.key ? 'si-button-active' : ''}`}
                type="button"
                onClick={() => setJourneyScope(option.key)}
                aria-pressed={journeyScope === option.key}
              >
                {option.label}
              </button>
            ))}
          </div>
          {journeyScope !== 'all' ? (
            <span className="si-muted">
              Showing {scopedAbandonmentJourneyRows.length} rows in <strong>{journeyScopeOptions.find((o) => o.key === journeyScope)?.label || journeyScope}</strong>.
            </span>
          ) : null}
        </div>

        {journeyLoading && !landingJourneyReport && !abandonmentJourneyReport ? (
          <div className="si-empty">Loading journey directional reports…</div>
        ) : null}

        {!journeyLoading && journeyError ? (
          <div className="si-empty" style={{ color: '#b42318' }}>{journeyError}</div>
        ) : null}

        {!journeyError ? (
          <div className="si-row" style={{ alignItems: 'stretch', gap: 12, flexWrap: 'wrap' }}>
            <div className="bento-card" style={{ flex: '1 1 420px' }}>
              <div className="si-card-title">
                <h3 style={{ fontSize: 15 }}>Page → Purchase</h3>
                <span className="si-muted">Directional landing influence</span>
              </div>
              {landingJourneyRows.length === 0 ? (
                <div className="si-empty">No attributed purchase journeys in this range.</div>
              ) : (
                <table className="si-event-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Landing page cluster</th>
                      <th>Purchases</th>
                      <th>Share</th>
                      <th>Top campaign</th>
                    </tr>
                  </thead>
                  <tbody>
                    {landingJourneyRows.slice(0, 8).map((row) => (
                      <tr key={`journey-landing-${row.rank}-${row.landing}`}>
                        <td><strong>{row.rank}</strong></td>
                        <td>{row.landing || '—'}</td>
                        <td>{formatNumber(row.purchases)}</td>
                        <td>{formatPercent(row.share, 1)}</td>
                        <td>{row.top_campaigns?.[0]?.value || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bento-card" style={{ flex: '1 1 420px' }}>
              <div className="si-card-title">
                <h3 style={{ fontSize: 15 }}>Abandonment by area</h3>
                <span className="si-muted">
                  Total: {formatNumber(journeyTotalAbandonSessions)}
                  {' '}• Attributed: {formatNumber(journeyClassifiedAbandonSessions)}
                  {' '}• Attribution: {formatPercent(journeyCoverageRatio, 0)}
                  {journeyUnclassifiedAbandonSessions > 0
                    ? <> • Needs review: {formatNumber(journeyUnclassifiedAbandonSessions)}</>
                    : null}
                </span>
              </div>
              {scopedAbandonmentJourneyRows.length === 0 ? (
                <div className="si-empty">
                  {journeyScope === 'all'
                    ? 'No ranked abandonment areas in this range.'
                    : `No abandonment rows in ${journeyScopeOptions.find((o) => o.key === journeyScope)?.label || journeyScope}.`}
                </div>
              ) : (
                <table className="si-event-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Abandon area</th>
                      <th>Product focus</th>
                      <th>Sessions</th>
                      <th>Share</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {scopedAbandonmentJourneyRows.slice(0, 8).map((row, idx) => {
                      const key = `${safeString(row?.abandoned_part).trim()}||${safeString(row?.product).trim()}||${safeString(row?.rank ?? idx).trim()}`;
                      const detailsId = `si-abandon-details-${fnv1a32(key).toString(36)}`;
                      const isExpanded = expandedAbandonmentKey === key;
                      const sampleSessions = Array.isArray(row?.sample_sessions) ? row.sample_sessions : [];
                      const topCountries = Array.isArray(row?.top_countries) ? row.top_countries : [];
                      return (
                        <Fragment key={key}>
                          <tr key={`journey-abandon-${row.rank}-${row.abandoned_part}-${row.product}`}>
                            <td><strong>{row.rank}</strong></td>
                            <td>{row.abandoned_part || '—'}</td>
                            <td>{row.product || '—'}</td>
                            <td>{formatNumber(row.sessions)}</td>
                            <td>{formatPercent(row.share, 1)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                className={`si-expand-btn ${isExpanded ? 'si-expand-btn-open' : ''}`}
                                type="button"
                                onClick={() => setExpandedAbandonmentKey(isExpanded ? '' : key)}
                                aria-expanded={isExpanded}
                                aria-controls={detailsId}
                                title={isExpanded ? 'Hide details' : 'Show details'}
                              >
                                <ChevronDown size={14} className="si-expand-icon" />
                              </button>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="si-row-expanded" key={`journey-abandon-details-${key}-${idx}`}>
                              <td colSpan={6}>
                                <div className="si-abandon-details" id={detailsId}>
                                  <div className="si-abandon-detail">
                                    <div className="si-muted">Top countries</div>
                                    <div className="si-abandon-chips">
                                      {topCountries.length === 0 ? (
                                        <span className="si-muted">—</span>
                                      ) : (
                                        topCountries.slice(0, 3).map((item) => {
                                          const rowSessions = Number(row?.sessions) || 0;
                                          const countryCode = safeString(item?.code).trim().toUpperCase();
                                          const stageShare = rowSessions > 0 ? (Number(item?.count) || 0) / rowSessions : 0;
                                          const trafficShare = countryTrafficShareByCode.get(countryCode) || 0;
                                          const overIndex = trafficShare > TRAFFIC_RATIO_MIN_SHARE
                                            ? stageShare / trafficShare
                                            : null;
                                          return (
                                            <span key={item.code} className="si-chip" title="Share in this drop-off row versus country traffic share">
                                              {countryNameFromCode(item.code)}
                                              {' '}
                                              <strong>{formatNumber(item.count)}</strong>
                                              {' '}
                                              <span className="si-muted">{formatPercent(stageShare, 0)} vs {formatPercent(trafficShare, 0)}</span>
                                              {overIndex != null ? <span className="si-muted"> ({formatTimes(overIndex)})</span> : null}
                                            </span>
                                          );
                                        })
                                      )}
                                    </div>
                                  </div>
                                  <div className="si-abandon-detail">
                                    <div className="si-muted">Sample sessions</div>
                                    <div className="si-abandon-chips">
                                      {sampleSessions.length === 0 ? (
                                        <span className="si-muted">—</span>
                                      ) : (
                                        sampleSessions.slice(0, 5).map((session) => (
                                          <button
                                            key={session.session_id}
                                            className="si-chip si-chip-button"
                                            type="button"
                                            title={session.last_event_at ? `Last event ${timeAgo(session.last_event_at)}` : ''}
                                            onClick={() => openStory(session.session_id, session)}
                                          >
                                            {userLabel(session)}
                                          </button>
                                        ))
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="bento-card" style={{ marginBottom: 12 }} ref={journeyDeviceTableRef}>
        <div className="si-card-title">
          <h3>Abandonment by device</h3>
          <span className="si-muted">Segmented denominator (high-intent sessions per device)</span>
        </div>
        <div className="si-summary-line" style={{ marginBottom: 10 }}>
          Formula: <strong>device abandon rate = abandon sessions ÷ high-intent sessions</strong> for that device.
          {' '}Baseline (all devices): <strong>{formatPercent(deviceBaselineAbandonRate, 1)}</strong>.
        </div>
        {deviceJourneyRows.length === 0 ? (
          <div className="si-empty">No device abandonment segments available in this range.</div>
        ) : (
          <table className="si-event-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Traffic share</th>
                <th>High-intent</th>
                <th>Abandon</th>
                <th>Purchase</th>
                <th>Abandon rate</th>
                <th>Purchase rate</th>
                <th>Excess vs baseline</th>
                <th>Likely abandon area</th>
                <th>Mix</th>
              </tr>
            </thead>
            <tbody>
              {scopedDeviceJourneyRows.map((row) => {
                const scopedSectionCount = journeyScope !== 'all' && row?.sectionCounts && typeof row.sectionCounts === 'object'
                  ? Number(row.sectionCounts[journeyScope]) || 0
                  : 0;
                const scopedSectionShare = journeyScope !== 'all' && Number(row.abandonSessions) > 0
                  ? scopedSectionCount / Number(row.abandonSessions)
                  : 0;
                const sectionCounts = row?.sectionCounts && typeof row.sectionCounts === 'object' ? row.sectionCounts : {};
                const abandonTotal = Number(row.abandonSessions) || 0;
                const cartCount = Number(sectionCounts.Cart) || 0;
                const checkoutCount = Number(sectionCounts.Checkout) || 0;
                const paymentCount = Number(sectionCounts['Checkout Payment']) || 0;
                const knownSum = cartCount + checkoutCount + paymentCount;
                const otherCount = Math.max(0, abandonTotal - knownSum);
                const scopedLabel = journeyScope === 'Checkout Payment'
                  ? 'Payment'
                  : journeyScope;
                return (
                <tr key={`journey-device-${row.key}`}>
                  <td><strong>{row.label || row.key || '—'}</strong></td>
                  <td>{formatPercent(row.trafficShare, 1)}</td>
                  <td>{formatNumber(row.highIntentSessions)}</td>
                  <td>{formatNumber(row.abandonSessions)}</td>
                  <td>{formatNumber(row.purchaseSessions)}</td>
                  <td>{formatPercent(row.abandonRate, 1)}</td>
                  <td>{formatPercent(row.purchaseRate, 1)}</td>
                  <td>{formatSignedNumber(row.excessAbandon, 1)}</td>
                  <td>
                    {journeyScope === 'all'
                      ? (row.topSectionLabel && row.topSectionLabel !== '—'
                        ? `${row.topSectionLabel} (${formatPercent(row.topSectionShare, 0)})`
                        : '—')
                      : (scopedSectionCount > 0
                        ? `${scopedLabel} (${formatPercent(scopedSectionShare, 0)})`
                        : '—')}
                  </td>
                  <td>
                    <div
                      className="si-device-mix-bar"
                      title={`Cart ${formatNumber(cartCount)} • Checkout ${formatNumber(checkoutCount)} • Payment ${formatNumber(paymentCount)}${otherCount ? ` • Other ${formatNumber(otherCount)}` : ''}`}
                    >
                      {abandonTotal > 0 ? (
                        <>
                          {cartCount > 0 ? (
                            <span
                              className={`si-device-mix-segment si-device-mix-cart ${
                                journeyScope !== 'all' && journeyScope !== 'Cart' ? 'si-device-mix-dim' : ''
                              }`}
                              style={{ width: `${(cartCount / abandonTotal) * 100}%` }}
                            />
                          ) : null}
                          {checkoutCount > 0 ? (
                            <span
                              className={`si-device-mix-segment si-device-mix-checkout ${
                                journeyScope !== 'all' && journeyScope !== 'Checkout' ? 'si-device-mix-dim' : ''
                              }`}
                              style={{ width: `${(checkoutCount / abandonTotal) * 100}%` }}
                            />
                          ) : null}
                          {paymentCount > 0 ? (
                            <span
                              className={`si-device-mix-segment si-device-mix-payment ${
                                journeyScope !== 'all' && journeyScope !== 'Checkout Payment' ? 'si-device-mix-dim' : ''
                              }`}
                              style={{ width: `${(paymentCount / abandonTotal) * 100}%` }}
                            />
                          ) : null}
                          {otherCount > 0 ? (
                            <span
                              className={`si-device-mix-segment si-device-mix-other ${
                                journeyScope !== 'all' ? 'si-device-mix-dim' : ''
                              }`}
                              style={{ width: `${(otherCount / abandonTotal) * 100}%` }}
                            />
                          ) : null}
                        </>
                      ) : (
                        <span className="si-device-mix-empty" />
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="bento-card si-issues-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Top issues</h3>
          <span className="si-muted">Top {Math.min(issueRows.length, 8)} visible • Mid strictness</span>
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

        {!clarityLoading && !clarityError && issueRows.length > 0 ? (
          <>
            <table className="si-event-table si-issues-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Issue</th>
                  <th>Where</th>
                  <th>Sessions affected</th>
                  <th>% analyzed sessions affected</th>
                  <th>Confidence</th>
                  <th>Action</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {visibleIssueRows.map((row) => {
                  const confidenceClass = row.confidenceLabel === 'High'
                    ? 'si-confidence-high'
                    : row.confidenceLabel === 'Med'
                      ? 'si-confidence-med'
                      : 'si-confidence-low';
                  const sampleList = Array.isArray(row.sampleSessions) ? row.sampleSessions : [];
                  const proofSession = sampleList[0];
                  const proofCount = Math.min(sampleList.length, 5);
                  return (
                    <tr key={row.id} className={`si-issue-row si-issue-${row.type}`}>
                      <td><strong>{row.rank}</strong></td>
                      <td>{row.issueLabel}</td>
                      <td title={row.whereLabel}>{row.whereLabel}</td>
                      <td>{pluralize(row.sessionsAffected, 'session', 'sessions')}</td>
                      <td>{formatPercent(row.issueRate, 0)}</td>
                      <td>
                        <span className={`si-chip ${confidenceClass}`}>{row.confidenceLabel}</span>
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

            {issueRows.length > 8 ? (
              <div className="si-row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
                <span className="si-muted">
                  Showing {visibleIssueRows.length} of {issueRows.length} issue rows
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
          <div className="bento-card si-intro-card">
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
            <div className="bento-card">
              <div className="si-metric-label">
                <div className="si-icon" />
                Sessions (24h)
              </div>
              <div className="si-metric-value">{overview?.kpis?.sessions24h ?? '—'}</div>
              <div className="si-metric-sub">Store: {store?.name || storeId}</div>
            </div>

            <div className="bento-card">
              <div className="si-metric-label">
                <div className="si-icon" />
                Add to cart (24h)
              </div>
              <div className="si-metric-value">{overview?.kpis?.atc24h ?? '—'}</div>
              <div className="si-metric-sub">
                Sessions • Events: {overview?.kpis?.atcEvents24h ?? '—'}
              </div>
            </div>

            <div className="bento-card">
              <div className="si-metric-label">
                <div className="si-icon" />
                Checkout started (24h)
              </div>
              <div className="si-metric-value">{overview?.kpis?.checkoutStarted24h ?? '—'}</div>
              <div className="si-metric-sub">
                Sessions • Events: {overview?.kpis?.checkoutStartedEvents24h ?? '—'}
              </div>
            </div>

            <div className="bento-card">
              <div className="si-metric-label">
                <div className="si-icon" />
                Purchases (24h)
              </div>
              <div className="si-metric-value">{overview?.kpis?.purchases24h ?? '—'}</div>
              <div className="si-metric-sub">
                Sessions • Events: {overview?.kpis?.purchasesEvents24h ?? '—'}
              </div>
            </div>

            <div className="bento-card">
              <div className="si-metric-label">
                <div className="si-icon" />
                ATC abandoned
              </div>
              <div className="si-metric-value">{overview?.kpis?.atcAbandoned ?? '—'}</div>
              <div className="si-metric-sub">{overview?.abandonAfterHours ?? 24}h since ATC, no purchase</div>
            </div>
          </div>

          <div className="si-panels">
            <div className="bento-card">
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

            <div className="bento-card">
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

          <div className="bento-card si-flow-card" style={{ marginBottom: 12 }}>
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

          <div className="bento-card" style={{ marginBottom: 12 }}>
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

          <div className="bento-card" style={{ marginBottom: 12 }}>
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

          <div className="bento-card" style={{ marginBottom: 12 }}>
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

          <div className="bento-card" style={{ marginTop: 14 }}>
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
            <div className="bento-card" style={{ marginTop: 10 }}>
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
