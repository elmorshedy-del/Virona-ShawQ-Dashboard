import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, RefreshCw } from 'lucide-react';
import GeoHotspotsMap from './GeoHotspotsMap';
import './SessionIntelligenceTab.css';

const POLL_EVENTS_MS = 1000;
const POLL_REALTIME_MS = 5000;
const POLL_DAY_PULSE_MS = 10000;
const POLL_OVERVIEW_MS = 20000;
const POLL_JOURNEY_MS = 60000;
const REALTIME_WINDOW_MINUTES = 30;
const REQUEST_TIMEOUT_MS = 15000;
const REALTIME_GEO_ROWS_LIMIT = 8;
const REALTIME_KPI_SPARKLINE_WIDTH = 120;
const REALTIME_KPI_SPARKLINE_HEIGHT = 30;
const REALTIME_KPI_SPARKLINE_PADDING = 4;
const REALTIME_KPI_SPARKLINE_CURVE_FACTOR = 0.18;
const REALTIME_DELTA_EPSILON = 1e-9;
const REALTIME_METRIC_CARD_CONFIG = [
  { key: 'sessions', label: 'Sessions today' },
  { key: 'shoppers', label: 'Shoppers today' },
  { key: 'events', label: 'Events today' }
];
const REALTIME_METRIC_COMPARISON_KEYS = ['yesterday', 'lastWeek'];
const CLARITY_SIGNAL_EVENT_NAMES = new Set([
  'rage_click',
  'dead_click',
  'js_error',
  'unhandled_rejection',
  'form_invalid',
  'scroll_depth',
  'scroll_max'
]);
const ACTION_PLAN_ROW_LIMIT = 6;
const ACTION_PLAN_EMERGING_MIN_SESSIONS = 40;
const ACTION_PLAN_ESTABLISHED_MIN_SESSIONS = 80;
const DEVICE_ABANDONMENT_FULL_CIRCLE_DEGREES = 360;
const JOURNEY_TABLE_LIMIT = 25;
const JOURNEY_UI_ROW_LIMIT = 8;
const JOURNEY_STAGE_DISPLAY_ORDER = ['Home', 'Product', 'Cart', 'Checkout', 'Payment submitted', 'Other'];
const JOURNEY_DEFAULT_RANGE_DAYS = 7;
const JOURNEY_SIGNIFICANT_DELTA_RATE = 0.25;
const JOURNEY_SIGNIFICANT_DELTA_COUNT = 3;
const ISSUE_TABLE_ROW_LIMIT = 8;
const ISSUE_PROOF_SESSION_LIMIT = 5;
const ISSUE_SCOPE_MODE = 'all';
const ISSUE_SCOPE_LABEL = 'All sessions';
const ISSUE_AUTO_INVESTIGATE_MIN_AFFECTED_SESSIONS = 3;
const ISSUE_OBSERVED_STATUS_HINT = 'Spotted and monitored closely. Automatic investigation starts when the pattern consistently affects more sessions.';
const SURVEY_TEMPLATE_ROW_LIMIT = 6;
const SURVEY_RECENT_RESPONSE_ROW_LIMIT = 6;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

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

const DEVICE_ABANDONMENT_SEGMENTS = [
  { key: 'ios', label: 'iOS', color: '#6366f1' },
  { key: 'android', label: 'Android', color: '#0ea5e9' },
  { key: 'desktop', label: 'Desktop', color: '#14b8a6' },
  { key: 'unknown', label: 'Unknown', color: '#94a3b8' }
];

const DEVICE_ABANDON_SECTION_ORDER = ['Payment', 'Checkout', 'Cart', 'Product', 'Landing'];

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

function formatClockTime(ts) {
  const date = parseSqliteTimestamp(ts);
  if (!date) return '—';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
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
  if (hasPurchase(session)) return 'purchase';

  const step = normalizeCheckoutStepKey(session.last_checkout_step);
  if (Number(session.checkout_started_events || 0) > 0 || step) {
    if (step === 'thank_you') return 'purchase';
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

function formatSignedPercent(value, digits = 0) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const absolute = Math.abs(n);
  const formatted = `${(absolute * 100).toFixed(digits)}%`;
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return formatted;
}

function formatComparisonDeltaLabel({ delta, current, baseline }) {
  const baseLabel = formatSignedPercent(delta, 0);
  if (baseLabel !== '—') return baseLabel;

  const currentValue = Number(current);
  const baselineValue = Number(baseline);
  const safeCurrent = Number.isFinite(currentValue) ? currentValue : 0;
  const safeBaseline = Number.isFinite(baselineValue) ? baselineValue : 0;

  if (safeBaseline <= 0 && safeCurrent > 0) return 'New';
  if (safeBaseline <= 0 && safeCurrent <= 0) return '0%';
  return '—';
}

function normalizeDeltaDirection(direction, delta) {
  const normalized = (direction || '').toString().trim().toLowerCase();
  if (normalized === 'up' || normalized === 'down' || normalized === 'flat') return normalized;

  const deltaValue = Number(delta);
  if (!Number.isFinite(deltaValue)) return 'na';
  if (deltaValue > REALTIME_DELTA_EPSILON) return 'up';
  if (deltaValue < -REALTIME_DELTA_EPSILON) return 'down';
  return 'flat';
}

function deltaArrow(direction) {
  if (direction === 'up') return '↑';
  if (direction === 'down') return '↓';
  return '→';
}

function resolveComparisonDirection({ direction, delta, current, baseline }) {
  const normalized = normalizeDeltaDirection(direction, delta);
  if (normalized !== 'na') return normalized;

  const currentValue = Number(current);
  const baselineValue = Number(baseline);
  const safeCurrent = Number.isFinite(currentValue) ? currentValue : 0;
  const safeBaseline = Number.isFinite(baselineValue) ? baselineValue : 0;

  if (safeBaseline <= 0 && safeCurrent > 0) return 'up';
  if (safeBaseline <= 0 && safeCurrent <= 0) return 'flat';
  return 'na';
}

function buildRealtimeSparklineGeometry(trendRows, {
  width = REALTIME_KPI_SPARKLINE_WIDTH,
  height = REALTIME_KPI_SPARKLINE_HEIGHT,
  padding = REALTIME_KPI_SPARKLINE_PADDING
} = {}) {
  const rows = Array.isArray(trendRows) ? trendRows : [];
  if (rows.length < 2) return null;

  const values = rows.map((row) => {
    const value = Number(row?.value);
    return Number.isFinite(value) ? value : 0;
  });
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const innerWidth = Math.max(width - (padding * 2), 1);
  const innerHeight = Math.max(height - (padding * 2), 1);
  const stepX = rows.length > 1 ? innerWidth / (rows.length - 1) : 0;
  const points = values.map((value, index) => {
    const x = padding + (index * stepX);
    const normalized = range > 0 ? (value - min) / range : 0.5;
    const y = padding + ((1 - normalized) * innerHeight);
    return { x, y };
  });

  if (points.length < 2) return null;

  const lineParts = [`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];
  for (let idx = 0; idx < points.length - 1; idx += 1) {
    const p0 = idx > 0 ? points[idx - 1] : points[idx];
    const p1 = points[idx];
    const p2 = points[idx + 1];
    const p3 = idx !== points.length - 2 ? points[idx + 2] : p2;

    const c1x = p1.x + ((p2.x - p0.x) * REALTIME_KPI_SPARKLINE_CURVE_FACTOR);
    const c1y = p1.y + ((p2.y - p0.y) * REALTIME_KPI_SPARKLINE_CURVE_FACTOR);
    const c2x = p2.x - ((p3.x - p1.x) * REALTIME_KPI_SPARKLINE_CURVE_FACTOR);
    const c2y = p2.y - ((p3.y - p1.y) * REALTIME_KPI_SPARKLINE_CURVE_FACTOR);

    lineParts.push(
      `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
    );
  }

  const linePath = lineParts.join(' ');
  const baselineY = (height - padding).toFixed(2);
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(2)},${baselineY} L${first.x.toFixed(2)},${baselineY} Z`;

  return {
    linePath,
    areaPath,
    firstPoint: first,
    lastPoint: last
  };
}

function realtimeSparklineDirection(trendRows) {
  const values = (Array.isArray(trendRows) ? trendRows : [])
    .map((row) => {
      const value = Number(row?.value);
      return Number.isFinite(value) ? value : null;
    })
    .filter((value) => value !== null);

  if (values.length < 2) return 'flat';
  const delta = values[values.length - 1] - values[0];
  if (delta > REALTIME_DELTA_EPSILON) return 'up';
  if (delta < -REALTIME_DELTA_EPSILON) return 'down';
  return 'flat';
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

const JOURNEY_UNATTRIBUTED_REASON_LABELS = {
  checkout_only_capture: 'Checkout captured without storefront entry page',
  missing_entry_context: 'Missing landing page context',
  excluded_content_page: 'Entry page excluded (policy/care/terms)',
  unclassified_path: 'Unclassified landing path',
  low_signal_missing_context: 'Low-signal sessions with missing context'
};

function formatJourneyReasonLabel(reason) {
  const key = (reason || '').toString().trim();
  if (!key) return 'Unknown reason';
  if (JOURNEY_UNATTRIBUTED_REASON_LABELS[key]) return JOURNEY_UNATTRIBUTED_REASON_LABELS[key];
  return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatJourneyBreakdownSummary(breakdown) {
  const entries = Object.entries(breakdown || {})
    .map(([key, value]) => ({ key, count: Number(value) || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);

  if (entries.length === 0) return '—';
  return entries
    .map((item) => `${formatJourneyReasonLabel(item.key)}: ${formatNumber(item.count)}`)
    .join(' • ');
}

function errorMessageFromSettledResult(result, fallbackMessage) {
  if (!result || result.status !== 'rejected') return '';
  const reason = result.reason;
  if (reason && typeof reason === 'object' && typeof reason.message === 'string' && reason.message.trim()) {
    return reason.message.trim();
  }
  const raw = (reason || '').toString().trim();
  return raw || fallbackMessage;
}

function formatJourneyPurchaseRecord(list) {
  if (!Array.isArray(list) || list.length === 0) return 'Unknown product';
  const normalized = list
    .map((item) => ({
      value: (item?.value || '').toString().trim(),
      count: Number(item?.count) || 0
    }))
    .filter((item) => item.value)
    .sort((a, b) => b.count - a.count);

  if (!normalized.length) return 'Unknown product';
  const [top, ...rest] = normalized;
  const topLabel = `${top.value} (${formatNumber(top.count)})`;
  if (!rest.length) return topLabel;
  return `${topLabel} +${formatNumber(rest.length)} more`;
}

function parseIsoDayToUtcMs(value) {
  const iso = (value || '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isoDayFromUtcMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function resolveJourneyComparisonRanges(dateRange) {
  const startMs = parseIsoDayToUtcMs(dateRange?.startDate);
  const endMs = parseIsoDayToUtcMs(dateRange?.endDate);

  let currentStartMs;
  let currentEndMs;

  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
    currentStartMs = startMs;
    currentEndMs = endMs;
  } else {
    const now = new Date();
    const todayMs = parseIsoDayToUtcMs(now.toISOString().slice(0, 10));
    const fallbackEndMs = Number.isFinite(todayMs) ? todayMs : Date.now();
    const daySpan = JOURNEY_DEFAULT_RANGE_DAYS - 1;
    currentEndMs = fallbackEndMs;
    currentStartMs = fallbackEndMs - (daySpan * MILLISECONDS_PER_DAY);
  }

  const spanDays = Math.max(1, Math.round((currentEndMs - currentStartMs) / MILLISECONDS_PER_DAY) + 1);
  const previousEndMs = currentStartMs - MILLISECONDS_PER_DAY;
  const previousStartMs = previousEndMs - ((spanDays - 1) * MILLISECONDS_PER_DAY);

  return {
    current: {
      startDate: isoDayFromUtcMs(currentStartMs),
      endDate: isoDayFromUtcMs(currentEndMs)
    },
    previous: {
      startDate: isoDayFromUtcMs(previousStartMs),
      endDate: isoDayFromUtcMs(previousEndMs)
    }
  };
}

function journeyStageFromLandingLabel(landingLabel) {
  const label = (landingLabel || '').toString().toLowerCase().trim();
  if (!label) return 'Other';
  if (label === 'home') return 'Home';
  if (label === 'cart') return 'Cart';
  if (label.startsWith('product:')) return 'Product';
  if (label.startsWith('checkout')) return 'Checkout';
  return 'Other';
}

function journeyStageFromAbandonArea(areaLabel) {
  const label = (areaLabel || '').toString().toLowerCase().trim();
  if (!label) return 'Other';
  if (label === 'home') return 'Home';
  if (label.startsWith('product')) return 'Product';
  if (label.startsWith('cart')) return 'Cart';
  if (label.includes('payment')) return 'Payment submitted';
  if (label.startsWith('checkout')) return 'Checkout';
  return 'Other';
}

function journeyStageKey(stageLabel) {
  const label = (stageLabel || '').toString().toLowerCase().trim();
  if (label === 'home') return 'home';
  if (label === 'product') return 'product';
  if (label === 'cart') return 'cart';
  if (label === 'checkout') return 'checkout';
  if (label === 'payment submitted') return 'payment-submitted';
  return 'other';
}

function buildJourneyStageBreakdown(rows, { getStage, getCount }) {
  const totals = new Map(JOURNEY_STAGE_DISPLAY_ORDER.map((stage) => [stage, 0]));
  for (const row of rows || []) {
    const stage = getStage(row);
    const count = Number(getCount(row)) || 0;
    if (!totals.has(stage)) totals.set(stage, 0);
    totals.set(stage, (totals.get(stage) || 0) + count);
  }
  return JOURNEY_STAGE_DISPLAY_ORDER
    .map((stage) => ({ stage, count: totals.get(stage) || 0 }))
    .filter((item) => item.count > 0);
}

function breakdownRowsToStageCountMap(breakdownRows) {
  const out = new Map();
  for (const item of breakdownRows || []) {
    const stage = (item?.stage || '').toString().trim();
    if (!stage) continue;
    out.set(stage, Number(item?.count) || 0);
  }
  return out;
}

function formatStageTrendLabel(trend) {
  const deltaRatePct = Math.round((Number(trend?.deltaRate) || 0) * 100);
  if ((trend?.direction || 'flat') === 'up') return `↑ ${deltaRatePct}%`;
  if ((trend?.direction || 'flat') === 'down') return `↓ ${Math.abs(deltaRatePct)}%`;
  return '→ 0%';
}

function buildJourneyStageTrends(currentBreakdownRows, previousBreakdownRows) {
  const currentMap = breakdownRowsToStageCountMap(currentBreakdownRows);
  const previousMap = breakdownRowsToStageCountMap(previousBreakdownRows);
  const stageSet = new Set([
    ...JOURNEY_STAGE_DISPLAY_ORDER,
    ...currentMap.keys(),
    ...previousMap.keys()
  ]);

  const raw = Array.from(stageSet).map((stage) => {
    const currentCount = Number(currentMap.get(stage) || 0);
    const previousCount = Number(previousMap.get(stage) || 0);
    const deltaCount = currentCount - previousCount;
    const deltaRate = previousCount > 0
      ? (deltaCount / previousCount)
      : currentCount > 0
        ? 1
        : 0;
    const direction = deltaCount > 0 ? 'up' : deltaCount < 0 ? 'down' : 'flat';
    const significant = (
      Math.abs(deltaCount) >= JOURNEY_SIGNIFICANT_DELTA_COUNT &&
      Math.abs(deltaRate) >= JOURNEY_SIGNIFICANT_DELTA_RATE
    );
    return {
      stage,
      currentCount,
      previousCount,
      deltaCount,
      deltaRate,
      direction,
      significant,
      trendLabel: formatStageTrendLabel({ deltaRate, direction })
    };
  });

  const topSignificant = raw
    .filter((item) => item.significant)
    .sort((a, b) => Math.abs(b.deltaCount) - Math.abs(a.deltaCount))[0] || null;

  return raw
    .filter((item) => item.currentCount > 0 || item.previousCount > 0)
    .sort((a, b) => {
      const aIdx = JOURNEY_STAGE_DISPLAY_ORDER.indexOf(a.stage);
      const bIdx = JOURNEY_STAGE_DISPLAY_ORDER.indexOf(b.stage);
      const safeA = aIdx >= 0 ? aIdx : JOURNEY_STAGE_DISPLAY_ORDER.length;
      const safeB = bIdx >= 0 ? bIdx : JOURNEY_STAGE_DISPLAY_ORDER.length;
      return safeA - safeB;
    })
    .map((item) => ({
      ...item,
      isTopSignificant: Boolean(topSignificant && topSignificant.stage === item.stage)
    }));
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
  if (key === 'google_ads' || key === 'googleads' || key.includes('google ads') || key.includes('adwords') || key.includes('gads')) return 'Google Ads';
  if (key.includes('google')) return 'Google';

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

function verificationUi(status, issue = null) {
  const sessionsAffected = Number(issue?.sessionsAffected) || 0;
  if (status === 'confirmed') return { label: 'Confirmed', className: 'si-verify-confirmed' };
  if (status === 'false_positive') return { label: 'False alert', className: 'si-verify-false-positive' };
  if (status === 'not_applicable') return { label: 'Observed', className: 'si-verify-observed', hint: ISSUE_OBSERVED_STATUS_HINT };
  if (sessionsAffected < ISSUE_AUTO_INVESTIGATE_MIN_AFFECTED_SESSIONS) {
    return { label: 'Observed', className: 'si-verify-observed', hint: ISSUE_OBSERVED_STATUS_HINT };
  }
  return { label: 'Investigating', className: 'si-verify-pending', hint: 'Actively verifying this issue cluster now.' };
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
  INVESTIGATING: 'investigating',
  CONFIRMED: 'confirmed'
};

const TECHNICAL_ISSUE_TYPES = new Set(['js_errors', 'form_invalid', 'scroll_dropoff']);
const INTERACTION_FRICTION_ISSUE_TYPES = new Set(['dead_clicks', 'rage_clicks']);
const ISSUE_TYPE_BADGE_META = {
  js_errors: { label: 'Runtime', tone: 'runtime' },
  form_invalid: { label: 'Form', tone: 'form' },
  scroll_dropoff: { label: 'Scroll', tone: 'scroll' },
  dead_clicks: { label: 'Dead click', tone: 'dead' },
  rage_clicks: { label: 'Rage click', tone: 'rage' }
};

function issueTypeBadgeMeta(type) {
  return ISSUE_TYPE_BADGE_META[type] || { label: 'Signal', tone: 'neutral' };
}

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

function hasPurchase(session) {
  if (!session || typeof session !== 'object') return false;
  if ((Number(session?.purchase_events) || 0) > 0) return true;

  const step = normalizeCheckoutStepKey(session?.last_checkout_step);
  if (step === 'thank_you') return true;

  const status = normalizeLooseKey(session?.status);
  if (status === 'purchased') return true;

  return false;
}

function hasCheckout(session) {
  return (Number(session?.checkout_started_events) || 0) > 0
    || normalizeCheckoutStepKey(session?.last_checkout_step) !== null;
}

function hasCart(session) {
  return (Number(session?.cart_events) || 0) > 0 || (Number(session?.atc_events) || 0) > 0;
}

function noPurchase(session) {
  return !hasPurchase(session);
}

function deviceSegmentKeyFromSession(session) {
  const rawType = normalizeLooseKey(session?.device_type);
  const rawOs = normalizeLooseKey(session?.device_os);

  if (rawType === 'desktop' || rawType.includes('desktop')) return 'desktop';
  if (rawOs === 'ios' || rawType === 'ios' || rawType === 'ipados' || rawType.includes('ios') || rawType.includes('ipad')) return 'ios';
  if (rawOs === 'android' || rawType === 'android' || rawType === 'android tablet' || rawType.includes('android')) return 'android';
  return 'unknown';
}

function abandonSectionLabelFromSession(session) {
  const stage = inferDropoffStageFromSummary(session);
  if (stage === 'checkout_payment') return 'Payment';
  if (stage === 'checkout_contact' || stage === 'checkout_shipping') return 'Checkout';
  if (stage === 'cart' || stage === 'atc') return 'Cart';
  if (stage === 'product') return 'Product';
  return 'Landing';
}

function compareAbandonSectionEntries(a, b) {
  if (b[1] !== a[1]) return b[1] - a[1];
  const aOrder = DEVICE_ABANDON_SECTION_ORDER.indexOf(a[0]);
  const bOrder = DEVICE_ABANDON_SECTION_ORDER.indexOf(b[0]);
  const safeA = aOrder >= 0 ? aOrder : DEVICE_ABANDON_SECTION_ORDER.length;
  const safeB = bOrder >= 0 ? bOrder : DEVICE_ABANDON_SECTION_ORDER.length;
  return safeA - safeB;
}

function buildTrafficAdjustedPieGradient(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let cursorDegrees = 0;
  const segments = [];

  list.forEach((row) => {
    const share = clamp01(row?.adjustedShare || 0);
    if (share <= 0) return;
    const start = cursorDegrees;
    const end = start + (share * DEVICE_ABANDONMENT_FULL_CIRCLE_DEGREES);
    segments.push(`${row.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`);
    cursorDegrees = end;
  });

  if (!segments.length) {
    return 'conic-gradient(rgba(148, 163, 184, 0.30) 0deg 360deg)';
  }
  return `conic-gradient(${segments.join(', ')})`;
}

function buildDeviceAbandonmentModel({ librarySessions }) {
  const sessions = Array.isArray(librarySessions) ? librarySessions : [];
  const buckets = new Map(
    DEVICE_ABANDONMENT_SEGMENTS.map((segment) => [
      segment.key,
      {
        ...segment,
        totalSessions: 0,
        abandonSessions: 0,
        sectionCounts: new Map()
      }
    ])
  );

  sessions.forEach((session) => {
    const segmentKey = deviceSegmentKeyFromSession(session);
    const isAbandon = noPurchase(session);

    const bucket = buckets.get(segmentKey);
    if (!bucket) return;

    bucket.totalSessions += 1;
    if (!isAbandon) return;

    bucket.abandonSessions += 1;
    const section = abandonSectionLabelFromSession(session);
    bucket.sectionCounts.set(section, (bucket.sectionCounts.get(section) || 0) + 1);
  });

  const rows = DEVICE_ABANDONMENT_SEGMENTS.map((segment) => {
    const bucket = buckets.get(segment.key);
    const totalSessions = Number(bucket?.totalSessions) || 0;
    const abandonSessions = Number(bucket?.abandonSessions) || 0;
    const abandonRate = totalSessions > 0 ? (abandonSessions / totalSessions) : 0;
    const topSectionEntry = Array.from(bucket?.sectionCounts?.entries?.() || [])
      .sort(compareAbandonSectionEntries)[0] || null;
    const topSectionLabel = topSectionEntry ? topSectionEntry[0] : '—';
    const topSectionCount = topSectionEntry ? Number(topSectionEntry[1]) || 0 : 0;
    const topSectionShare = abandonSessions > 0 ? (topSectionCount / abandonSessions) : 0;

    return {
      ...segment,
      totalSessions,
      abandonSessions,
      abandonRate,
      topSectionLabel,
      topSectionCount,
      topSectionShare
    };
  });

  const totalClassifiedSessions = rows.reduce((sum, row) => sum + row.totalSessions, 0);
  const totalClassifiedAbandon = rows.reduce((sum, row) => sum + row.abandonSessions, 0);
  const baselineAbandonRate = totalClassifiedSessions > 0 ? (totalClassifiedAbandon / totalClassifiedSessions) : 0;

  const withNormalization = rows.map((row) => {
    const trafficShare = totalClassifiedSessions > 0 ? (row.totalSessions / totalClassifiedSessions) : 0;
    const abandonShare = totalClassifiedAbandon > 0 ? (row.abandonSessions / totalClassifiedAbandon) : 0;
    const expectedAbandon = row.totalSessions * baselineAbandonRate;
    const excessAbandon = row.abandonSessions - expectedAbandon;
    const adjustedIndex = trafficShare > 0 ? (abandonShare / trafficShare) : 0;
    return {
      ...row,
      trafficShare,
      abandonShare,
      expectedAbandon,
      excessAbandon,
      adjustedIndex
    };
  });

  const adjustedIndexTotal = withNormalization.reduce((sum, row) => sum + row.adjustedIndex, 0);
  const rowsWithAdjustedShare = withNormalization.map((row) => ({
    ...row,
    adjustedShare: adjustedIndexTotal > 0 ? (row.adjustedIndex / adjustedIndexTotal) : 0
  }));

  const topOverIndexed = rowsWithAdjustedShare
    .filter((row) => row.excessAbandon > 0)
    .sort((a, b) => {
      if (b.adjustedIndex !== a.adjustedIndex) return b.adjustedIndex - a.adjustedIndex;
      return b.excessAbandon - a.excessAbandon;
    })[0] || null;

  const unknownRow = rowsWithAdjustedShare.find((row) => row.key === 'unknown') || null;

  return {
    rows: rowsWithAdjustedShare,
    totalSessions: totalClassifiedSessions,
    totalAbandonSessions: totalClassifiedAbandon,
    baselineAbandonRate,
    unknownSessions: unknownRow?.totalSessions || 0,
    pieGradient: buildTrafficAdjustedPieGradient(rowsWithAdjustedShare),
    topOverIndexed
  };
}

function actionPlanStatusForCount(count) {
  const sessions = Math.max(0, Number(count) || 0);
  if (sessions >= ACTION_PLAN_ESTABLISHED_MIN_SESSIONS) return 'Established';
  if (sessions >= ACTION_PLAN_EMERGING_MIN_SESSIONS) return 'Emerging';
  return null;
}

function buildPatternRow({
  id,
  patternLabel,
  whereLabel,
  eligibleCount,
  affectedSessions,
  affectedCount,
  baselineRate,
  segmentRate,
  overIndex,
  excessSessions,
  score,
  observation,
  suggests,
  nextCheck,
  fixFirst
}) {
  const eligibleSessions = Math.max(0, Number(eligibleCount) || 0);
  const affectedList = Array.isArray(affectedSessions) ? affectedSessions : [];
  const affectedSessionsCount = Math.max(
    0,
    Number.isFinite(Number(affectedCount))
      ? Number(affectedCount)
      : affectedList.length
  );

  const status = actionPlanStatusForCount(eligibleSessions);
  if (!status) return null;

  const safeRate = eligibleSessions > 0 ? affectedSessionsCount / eligibleSessions : 0;
  const baseline = Number.isFinite(Number(baselineRate)) ? Number(baselineRate) : null;
  const statusLineParts = [
    `${status} · ${formatNumber(affectedSessionsCount)}/${formatNumber(eligibleSessions)} sessions (${formatPercent(safeRate, 0)})`
  ];
  if (baseline != null) {
    statusLineParts.push(`baseline ${formatPercent(baseline, 0)}`);
  }

  return {
    id,
    patternLabel,
    whereLabel,
    status,
    eligibleCount: eligibleSessions,
    sessionsCount: affectedSessionsCount,
    segmentRate: Number.isFinite(Number(segmentRate)) ? Number(segmentRate) : safeRate,
    baselineRate: baseline,
    overIndex: Number.isFinite(Number(overIndex)) ? Number(overIndex) : null,
    excessSessions: Number.isFinite(Number(excessSessions)) ? Number(excessSessions) : null,
    score: Number.isFinite(Number(score)) ? Number(score) : null,
    statusLine: statusLineParts.join(' · '),
    observation,
    suggests,
    nextCheck,
    fixFirst,
    sampleSession: affectedList[0] || null
  };
}

function buildBehaviorPatternRows({ librarySessions }) {
  const sessions = Array.isArray(librarySessions) ? librarySessions : [];
  if (!sessions.length) return [];

  const sentenceCase = (value) => {
    const raw = (value || '').toString();
    if (!raw) return '';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  const SEGMENT_DIMENSIONS = [
    {
      key: 'campaign',
      label: 'Campaign',
      getKey: (session) => (session?.utm_campaign || '').toString().trim() || '(not set)',
      format: (value) => (value || '').toString().trim() || '(not set)'
    },
    {
      key: 'country',
      label: 'Country',
      getKey: (session) => (session?.country_code || '').toString().trim().toUpperCase(),
      format: (value) => countryNameFromCode(value)
    }
  ];

  const reachedPayment = (session) => {
    const step = normalizeCheckoutStepKey(session?.last_checkout_step);
    return step === 'payment' || step === 'thank_you' || hasPurchase(session);
  };

  const PATTERNS = [
    {
      id: 'payment-step-exit',
      label: 'Payment-step exit before purchase',
      eligibilityLabel: 'payment-step sessions',
      badLabel: 'payment-step exits',
      eligible: reachedPayment,
      bad: (session) => noPurchase(session) && normalizeCheckoutStepKey(session?.last_checkout_step) === 'payment',
      suggests: 'Final-step confidence, payment method clarity, or gateway flow may be blocking completion.',
      nextCheck: 'Validate payment method availability and final-step messaging on desktop and mobile.',
      fixFirst: 'Audit payment-step UX first and keep fallback payment options clearly visible.'
    },
    {
      id: 'checkout-exit-before-payment',
      label: 'Checkout exit before payment',
      eligibilityLabel: 'checkout sessions',
      badLabel: 'checkout exits before payment',
      eligible: (session) => hasCheckout(session),
      bad: (session) => {
        if (hasPurchase(session)) return false;
        if (!hasCheckout(session)) return false;
        const step = normalizeCheckoutStepKey(session?.last_checkout_step);
        return step !== 'payment' && step !== 'thank_you';
      },
      suggests: 'Early checkout friction in contact/shipping steps may be slowing progression.',
      nextCheck: 'Trace contact and shipping step completion flows across device types.',
      fixFirst: 'Reduce form friction and clarify shipping expectations before payment.'
    },
    {
      id: 'cart-hesitation',
      label: 'Cart hesitation before checkout',
      eligibilityLabel: 'cart sessions',
      badLabel: 'cart exits before checkout',
      eligible: (session) => hasCart(session),
      bad: (session) => noPurchase(session) && hasCart(session) && !hasCheckout(session),
      suggests: 'Cost expectations, shipping clarity, or weak next-step guidance may be causing hesitation.',
      nextCheck: 'Review cart totals, shipping estimate visibility, and checkout CTA prominence.',
      fixFirst: 'Make total cost expectations explicit in cart and highlight the checkout path.'
    },
    {
      id: 'reconsider-without-cart',
      label: 'Repeat product consideration without cart',
      eligibilityLabel: 'sessions with 2+ product views',
      badLabel: 'exits without cart/checkout',
      eligible: (session) => (Number(session?.product_views) || 0) >= 2,
      bad: (session) => (
        noPurchase(session)
        && (Number(session?.product_views) || 0) >= 2
        && !hasCart(session)
        && !hasCheckout(session)
      ),
      suggests: 'Decision clarity may be missing around fit, value, or selection confidence.',
      nextCheck: 'Review product detail hierarchy and variant guidance on the first view.',
      fixFirst: 'Strengthen product-page decision support near the variant and add-to-cart zone.'
    },
    {
      id: 'product-view-no-progress',
      label: 'Exit after product view (no cart/checkout)',
      eligibilityLabel: 'sessions that reached a product page',
      badLabel: 'exits before cart/checkout',
      eligible: (session) => (Number(session?.product_views) || 0) > 0,
      bad: (session) => noPurchase(session) && !hasCart(session) && !hasCheckout(session),
      suggests: 'Traffic expectation may be misaligned with the first product/offer experience.',
      nextCheck: 'Compare traffic promise against the first product view and offer framing.',
      fixFirst: 'Align the first product view with the traffic promise and make the primary CTA unmissable.'
    }
  ];

  const candidates = [];

  PATTERNS.forEach((pattern) => {
    const eligibleSessions = sessions.filter(pattern.eligible);
    const totalEligible = eligibleSessions.length;
    if (totalEligible <= 0) return;

    const affectedAll = eligibleSessions.filter(pattern.bad);
    const totalAffected = affectedAll.length;
    if (totalAffected <= 0) return;

    const baselineRate = totalAffected / totalEligible;

    SEGMENT_DIMENSIONS.forEach((dimension) => {
      const buckets = new Map();

      eligibleSessions.forEach((session) => {
        const key = dimension.getKey(session);
        if (!key) return;
        const bucket = buckets.get(key) || {
          key,
          eligibleCount: 0,
          affectedCount: 0,
          otherCounts: new Map(),
          sampleAffected: []
        };
        bucket.eligibleCount += 1;
        if (pattern.bad(session)) {
          bucket.affectedCount += 1;
          const otherKey = dimension.key === 'campaign'
            ? (session?.country_code || '').toString().trim().toUpperCase()
            : (session?.utm_campaign || '').toString().trim();
          if (otherKey) bucket.otherCounts.set(otherKey, (bucket.otherCounts.get(otherKey) || 0) + 1);
          if (bucket.sampleAffected.length < 6) bucket.sampleAffected.push(session);
        }
        buckets.set(key, bucket);
      });

      Array.from(buckets.values()).forEach((bucket) => {
        const eligibleCount = bucket.eligibleCount;
        const affectedCount = bucket.affectedCount;
        if (eligibleCount <= 0 || affectedCount <= 0) return;

        const segmentRate = affectedCount / eligibleCount;
        const expected = eligibleCount * baselineRate;
        const excess = affectedCount - expected;
        if (!(excess >= 1)) return;

        const trafficShare = eligibleCount / totalEligible;
        const affectedShare = totalAffected > 0 ? affectedCount / totalAffected : 0;
        const overIndex = baselineRate > 0 ? (segmentRate / baselineRate) : 0;
        if (!(overIndex > 1)) return;

        const score = excess * Math.max(0, overIndex - 1);
        const excessRounded = Math.max(1, Math.round(excess));

        const crossContext = (() => {
          const topOther = Array.from(bucket.otherCounts.entries()).sort((a, b) => b[1] - a[1])[0] || null;
          if (!topOther) return '';

          if (dimension.key === 'campaign') {
            return `Top country: ${countryNameFromCode(topOther[0])}.`;
          }
          return `Top campaign: ${topOther[0]}.`;
        })();

        const observationParts = [
          `This ${dimension.label.toLowerCase()} is ${formatPercent(trafficShare, 0)} of ${pattern.eligibilityLabel} but ${formatPercent(affectedShare, 0)} of ${pattern.badLabel} (${overIndex.toFixed(2)}x baseline).`,
          `${sentenceCase(pattern.badLabel)} rate: ${formatPercent(segmentRate, 0)} vs baseline ${formatPercent(baselineRate, 0)} (+${formatNumber(excessRounded)} sessions vs expected).`
        ];
        if (crossContext) observationParts.push(crossContext);

        candidates.push(buildPatternRow({
          id: `${pattern.id}-${dimension.key}-${bucket.key}`,
          patternLabel: pattern.label,
          whereLabel: `${dimension.label} • ${dimension.format(bucket.key)}`,
          eligibleCount,
          affectedSessions: bucket.sampleAffected,
          affectedCount,
          baselineRate,
          segmentRate,
          overIndex,
          excessSessions: excess,
          score,
          observation: observationParts.join(' '),
          suggests: pattern.suggests,
          nextCheck: pattern.nextCheck,
          fixFirst: pattern.fixFirst
        }));
      });
    });
  });

  return candidates
    .filter(Boolean)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, ACTION_PLAN_ROW_LIMIT);
}

function buildClarityIssueRows({ claritySignals, librarySessions, selectedDay }) {
  const sessions = Array.isArray(librarySessions) ? librarySessions : [];
  const claritySelectedSessions = Math.max(0, Number(claritySignals?.totals?.sessions) || 0);
  const claritySourceSessions = Math.max(0, Number(claritySignals?.totals?.source_sessions) || 0);
  const totalSessionUniverse = Math.max(sessions.length, claritySourceSessions, claritySelectedSessions);
  const highIntentNoPurchaseSessions = sessions.filter((s) => (
    noPurchase(s) && ((Number(s?.atc_events) || 0) > 0 || hasCheckout(s))
  ));

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
        pagePath: issue?.page || '',
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
      purchases: sessions.filter((s) => hasPurchase(s)).length
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

  const purchases = sessions.filter((s) => hasPurchase(s)).length;
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

function normalizeSurveyKey(value) {
  return (value || '').toString().toLowerCase().trim();
}

function surveyStatusLabel(status) {
  const key = normalizeSurveyKey(status);
  if (key === 'active') return 'Active';
  if (key === 'paused') return 'Paused';
  return 'Ready';
}

function surveyStatusClassName(status) {
  const key = normalizeSurveyKey(status);
  if (key === 'active') return 'si-survey-status-active';
  if (key === 'paused') return 'si-survey-status-paused';
  return 'si-survey-status-ready';
}

function surveyDeliveryLabel(deliveryType, fallbackLabel) {
  const key = normalizeSurveyKey(deliveryType);
  if (key === 'return_visit') return 'Return visit';
  if (key === 'recovery') return 'Recovery';
  if (key === 'checkout_plus') return 'Checkout Plus';
  if (key === 'storefront') return 'Storefront';
  return fallbackLabel || 'Storefront';
}

function surveyConsentLabel(consentMode) {
  const key = normalizeSurveyKey(consentMode);
  if (key === 'ask_consent') return 'Ask consent';
  if (key === 'response_only') return 'Response only';
  return 'Auto-link';
}

function formatSurveyResponseSnippet(text) {
  const raw = (text || '').toString().trim();
  if (!raw) return '—';
  if (raw.length <= 120) return raw;
  return `${raw.slice(0, 117)}…`;
}

export default function SessionIntelligenceTab({ store, dashboardDateRange = null }) {
  const storeId = store?.id || 'shawq';

  const [overview, setOverview] = useState(null);
  const [brief, setBrief] = useState(null);
  const [dayPulse, setDayPulse] = useState(null);
  const [dayPulseLoading, setDayPulseLoading] = useState(false);
  const [dayPulseError, setDayPulseError] = useState('');
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
  const [issueVerificationView, setIssueVerificationView] = useState(ISSUE_VERIFICATION_VIEW.INVESTIGATING);
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
  const [landingPurchaseReport, setLandingPurchaseReport] = useState(null);
  const [landingPurchasePreviousReport, setLandingPurchasePreviousReport] = useState(null);
  const [landingPurchaseLoading, setLandingPurchaseLoading] = useState(false);
  const [landingPurchaseError, setLandingPurchaseError] = useState('');
  const [abandonmentReport, setAbandonmentReport] = useState(null);
  const [abandonmentPreviousReport, setAbandonmentPreviousReport] = useState(null);
  const [abandonmentLoading, setAbandonmentLoading] = useState(false);
  const [abandonmentError, setAbandonmentError] = useState('');
  const [surveyTemplates, setSurveyTemplates] = useState([]);
  const [surveySummary, setSurveySummary] = useState(null);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [surveyError, setSurveyError] = useState('');
  const [surveySavingKey, setSurveySavingKey] = useState('');

  const latestEventIdRef = useRef(null);
  const libraryTimelineRef = useRef(null);
  const journeyRequestIdRef = useRef(0);
  const surveyRequestIdRef = useRef(0);
  const dayPulseDataRef = useRef(null);
  const realtimeDataRef = useRef(null);
  const surveyTemplatesRef = useRef([]);
  const surveySummaryRef = useRef(null);

  useEffect(() => {
    persistSessionIntelligenceLlmSettings(analysisLlm);
  }, [analysisLlm]);

  useEffect(() => {
    dayPulseDataRef.current = dayPulse;
  }, [dayPulse]);

  useEffect(() => {
    realtimeDataRef.current = realtime;
  }, [realtime]);

  useEffect(() => {
    surveyTemplatesRef.current = surveyTemplates;
  }, [surveyTemplates]);

  useEffect(() => {
    surveySummaryRef.current = surveySummary;
  }, [surveySummary]);

  const journeyComparisonRanges = useMemo(
    () => resolveJourneyComparisonRanges(dashboardDateRange),
    [dashboardDateRange]
  );

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

  useEffect(() => {
    if (!storyOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeStory();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeStory, storyOpen]);

  const loadRealtime = useCallback(async (options = {}) => {
    const showLoading = options.showLoading !== false || !realtimeDataRef.current;
    if (showLoading) setRealtimeLoading(true);
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
      if (!realtimeDataRef.current) setRealtime(null);
    } finally {
      if (showLoading) setRealtimeLoading(false);
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

  const loadJourneyReports = useCallback(async () => {
    const requestId = journeyRequestIdRef.current + 1;
    journeyRequestIdRef.current = requestId;

    const currentParams = new URLSearchParams({
      store: storeId,
      limit: String(JOURNEY_TABLE_LIMIT),
      startDate: journeyComparisonRanges.current.startDate,
      endDate: journeyComparisonRanges.current.endDate
    });
    const previousParams = new URLSearchParams({
      store: storeId,
      limit: String(JOURNEY_TABLE_LIMIT),
      startDate: journeyComparisonRanges.previous.startDate,
      endDate: journeyComparisonRanges.previous.endDate
    });

    setLandingPurchaseLoading(true);
    setLandingPurchaseError('');
    setAbandonmentLoading(true);
    setAbandonmentError('');

    const [
      landingCurrentResult,
      abandonmentCurrentResult,
      landingPreviousResult,
      abandonmentPreviousResult
    ] = await Promise.allSettled([
        fetchJson(`/api/session-intelligence/journey/landing-purchases?${currentParams.toString()}`),
        fetchJson(`/api/session-intelligence/journey/abandonment?${currentParams.toString()}`),
        fetchJson(`/api/session-intelligence/journey/landing-purchases?${previousParams.toString()}`),
        fetchJson(`/api/session-intelligence/journey/abandonment?${previousParams.toString()}`)
      ]);

    if (requestId !== journeyRequestIdRef.current) return;

    if (landingCurrentResult.status === 'fulfilled') {
      setLandingPurchaseReport(landingCurrentResult.value || null);
      setLandingPurchaseError('');
    } else {
      const message = errorMessageFromSettledResult(landingCurrentResult, 'Failed to load landing-to-purchase report');
      console.error('[SessionIntelligenceTab] landing journey load failed:', landingCurrentResult.reason || message);
      setLandingPurchaseReport(null);
      setLandingPurchaseError(message);
    }

    if (abandonmentCurrentResult.status === 'fulfilled') {
      setAbandonmentReport(abandonmentCurrentResult.value || null);
      setAbandonmentError('');
    } else {
      const message = errorMessageFromSettledResult(abandonmentCurrentResult, 'Failed to load abandonment report');
      console.error('[SessionIntelligenceTab] abandonment journey load failed:', abandonmentCurrentResult.reason || message);
      setAbandonmentReport(null);
      setAbandonmentError(message);
    }

    if (landingPreviousResult.status === 'fulfilled') {
      setLandingPurchasePreviousReport(landingPreviousResult.value || null);
    } else {
      console.warn('[SessionIntelligenceTab] previous landing journey load failed:', landingPreviousResult.reason || 'unknown error');
      setLandingPurchasePreviousReport(null);
    }

    if (abandonmentPreviousResult.status === 'fulfilled') {
      setAbandonmentPreviousReport(abandonmentPreviousResult.value || null);
    } else {
      console.warn('[SessionIntelligenceTab] previous abandonment journey load failed:', abandonmentPreviousResult.reason || 'unknown error');
      setAbandonmentPreviousReport(null);
    }

    if (requestId === journeyRequestIdRef.current) {
      setLandingPurchaseLoading(false);
      setAbandonmentLoading(false);
    }
  }, [journeyComparisonRanges.current.endDate, journeyComparisonRanges.current.startDate, journeyComparisonRanges.previous.endDate, journeyComparisonRanges.previous.startDate, storeId]);

  const loadSurveyData = useCallback(async (options = {}) => {
    const requestId = surveyRequestIdRef.current + 1;
    surveyRequestIdRef.current = requestId;
    const showLoading = options.showLoading !== false
      || ((surveyTemplatesRef.current?.length || 0) === 0 && !surveySummaryRef.current);

    const params = new URLSearchParams({
      store: storeId,
      startDate: journeyComparisonRanges.current.startDate,
      endDate: journeyComparisonRanges.current.endDate,
      limit: String(SURVEY_TEMPLATE_ROW_LIMIT)
    });

    if (showLoading) setSurveyLoading(true);
    setSurveyError('');

    const [templatesResult, summaryResult] = await Promise.allSettled([
      fetchJson(`/api/session-intelligence/survey/templates?${params.toString()}`),
      fetchJson(`/api/session-intelligence/survey/summary?${params.toString()}`)
    ]);

    if (requestId !== surveyRequestIdRef.current) return;

    const errors = [];

    if (templatesResult.status === 'fulfilled') {
      setSurveyTemplates(Array.isArray(templatesResult.value?.data?.templates) ? templatesResult.value.data.templates : []);
    } else {
      console.error('[SessionIntelligenceTab] survey templates load failed:', templatesResult.reason || templatesResult);
      setSurveyTemplates([]);
      errors.push('Failed to load survey templates.');
    }

    if (summaryResult.status === 'fulfilled') {
      setSurveySummary(summaryResult.value?.data || null);
    } else {
      console.error('[SessionIntelligenceTab] survey summary load failed:', summaryResult.reason || summaryResult);
      setSurveySummary(null);
      errors.push('Failed to load survey responses.');
    }

    setSurveyError(errors.join(' '));

    if (requestId === surveyRequestIdRef.current && showLoading) {
      setSurveyLoading(false);
    }
  }, [journeyComparisonRanges.current.endDate, journeyComparisonRanges.current.startDate, storeId]);

  const toggleSurveyTemplate = useCallback(async (template) => {
    if (!template?.key) return;
    const nextStatus = template.status === 'active' ? 'paused' : 'active';
    setSurveySavingKey(template.key);
    try {
      await fetchJson('/api/session-intelligence/survey/templates/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: storeId,
          templateKey: template.key,
          status: nextStatus
        })
      });
      await loadSurveyData();
    } catch (error) {
      console.error('[SessionIntelligenceTab] survey template save failed:', error);
      setSurveyError(error?.message || 'Failed to update survey template');
    } finally {
      setSurveySavingKey('');
    }
  }, [loadSurveyData, storeId]);

  const loadOverview = useCallback(async () => {
    const url = `/api/session-intelligence/overview?store=${encodeURIComponent(storeId)}`;
    const data = await fetchJson(url);
    setOverview(data.data);
  }, [storeId]);

  const loadDayPulse = useCallback(async (options = {}) => {
    const showLoading = options.showLoading !== false || !dayPulseDataRef.current;
    if (showLoading) setDayPulseLoading(true);
    setDayPulseError('');
    try {
      const url = `/api/session-intelligence/day-pulse?store=${encodeURIComponent(storeId)}`;
      const data = await fetchJson(url);
      setDayPulse(data.data || null);
    } catch (error) {
      console.error('[SessionIntelligenceTab] day pulse load failed:', error);
      setDayPulseError(error?.message || 'Failed to load day pulse');
      if (!dayPulseDataRef.current) setDayPulse(null);
    } finally {
      if (showLoading) setDayPulseLoading(false);
    }
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
    loadClarity(libraryDay, ISSUE_SCOPE_MODE);
  }, [libraryDay, loadClarity]);

  const filteredLibrarySessions = useMemo(() => {
    let list = librarySessions;

    if (highIntentOnly) {
      list = list.filter((s) => (
        Number(s.atc_events) > 0 ||
        hasCheckout(s) ||
        hasPurchase(s)
      ));
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
        loadDayPulse(),
        loadRealtime(),
        loadOverview(),
        loadBrief(),
        loadFlow(libraryDay, flowMode),
        loadClarity(libraryDay, ISSUE_SCOPE_MODE),
        loadJourneyReports(),
        loadSurveyData(),
        loadSessions(),
        loadEvents(),
        loadLibraryDays()
      ]);
    } finally {
      setLoading(false);
    }
  }, [flowMode, libraryDay, loadBrief, loadClarity, loadDayPulse, loadEvents, loadFlow, loadJourneyReports, loadLibraryDays, loadOverview, loadRealtime, loadSessions, loadSurveyData]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEventsStatus('loading');

    Promise.all([loadDayPulse(), loadRealtime(), loadOverview(), loadBrief(), loadJourneyReports(), loadSurveyData(), loadSessions(), loadEvents(), loadLibraryDays()])
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
      loadRealtime({ showLoading: false }).catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] realtime poll failed:', error);
      });
    }, POLL_REALTIME_MS);

    const dayPulseTimer = setInterval(() => {
      loadDayPulse({ showLoading: false }).catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] day pulse poll failed:', error);
      });
    }, POLL_DAY_PULSE_MS);

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

    const journeyTimer = setInterval(() => {
      loadJourneyReports().catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] journey poll failed:', error);
      });
      loadSurveyData({ showLoading: false }).catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] survey poll failed:', error);
      });
    }, POLL_JOURNEY_MS);

    return () => {
      active = false;
      clearInterval(realtimeTimer);
      clearInterval(dayPulseTimer);
      clearInterval(eventsTimer);
      clearInterval(overviewTimer);
      clearInterval(journeyTimer);
    };
  }, [loadBrief, loadDayPulse, loadEvents, loadJourneyReports, loadLibraryDays, loadOverview, loadRealtime, loadSessions, loadSurveyData]);

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
  const realtimeMapSubtitle = (() => {
    if (realtimeMapMode !== 'focus') return 'Hotspots';
    if (hasRealtimeFocusGeo) return `Top ${realtimeFocusRowsLabel}`;
    return 'Cities / regions';
  })();
  const realtimeGeoEmptyMessage = realtimeMapMode === 'focus'
    ? realtimeFocusCountryName
      ? `No city/region detail yet for ${realtimeFocusCountryName}.`
      : 'No geo data yet.'
    : 'No geo data yet.';
  const realtimeMetricCards = useMemo(() => (
    REALTIME_METRIC_CARD_CONFIG.map((config) => {
      const metric = realtime?.metrics?.[config.key] || null;
      const fallbackValue = config.key === 'sessions'
        ? realtime?.activeSessions
        : config.key === 'shoppers'
          ? realtime?.activeShoppers
          : realtime?.events;
      const currentValue = metric?.current ?? fallbackValue ?? 0;
      const trend = Array.isArray(metric?.trend) ? metric.trend : [];
      const sparkline = buildRealtimeSparklineGeometry(trend);
      const sparklineDirection = realtimeSparklineDirection(trend);
      const comparisons = REALTIME_METRIC_COMPARISON_KEYS
        .map((comparisonKey) => metric?.[comparisonKey])
        .filter((comparison) => comparison && typeof comparison === 'object')
        .map((comparison) => {
          const baseline = Number(comparison.value);
          const safeBaseline = Number.isFinite(baseline) ? baseline : 0;
          const direction = resolveComparisonDirection({
            direction: comparison.direction,
            delta: comparison.delta,
            current: currentValue,
            baseline: safeBaseline
          });
          return {
            ...comparison,
            value: safeBaseline,
            direction,
            arrow: deltaArrow(direction),
            deltaLabel: formatComparisonDeltaLabel({
              delta: comparison.delta,
              current: currentValue,
              baseline: safeBaseline
            })
          };
        });

      return {
        key: config.key,
        label: config.label,
        value: currentValue,
        sparkline,
        sparklineDirection,
        comparisons
      };
    })
  ), [realtime]);
  const realtimeKeyEventCards = useMemo(() => ([
    { key: 'atc', label: 'ATC', value: realtime?.keyEvents?.atc },
    { key: 'checkout_started', label: 'Checkout', value: realtime?.keyEvents?.checkout_started },
    { key: 'purchase', label: 'Purchase', value: realtime?.keyEvents?.purchase }
  ]), [realtime?.keyEvents?.atc, realtime?.keyEvents?.checkout_started, realtime?.keyEvents?.purchase]);
  const dayPulseComparisons = useMemo(() => {
    const yesterday = dayPulse?.comparisons?.yesterday || null;
    const lastWeek = dayPulse?.comparisons?.lastWeek || null;
    return [yesterday, lastWeek]
      .filter(Boolean)
      .map((comparison) => {
        const baseline = Number(comparison.sessions);
        const safeBaseline = Number.isFinite(baseline) ? baseline : 0;
        const current = Number(dayPulse?.sessionsSoFar) || 0;
        const direction = resolveComparisonDirection({
          direction: comparison.direction,
          delta: comparison.delta,
          current,
          baseline: safeBaseline
        });
        return {
          ...comparison,
          sessions: safeBaseline,
          direction,
          arrow: deltaArrow(direction),
          deltaLabel: formatComparisonDeltaLabel({
            delta: comparison.delta,
            current,
            baseline: safeBaseline
          })
        };
      });
  }, [dayPulse]);
  const dayPulseProjectionClass = useMemo(() => {
    const key = (dayPulse?.projectionLabel || '').toString().toLowerCase().trim();
    if (key === 'heavy') return 'si-day-pulse-projection-heavy';
    if (key === 'light') return 'si-day-pulse-projection-light';
    return 'si-day-pulse-projection-mid';
  }, [dayPulse?.projectionLabel]);
  const hasDayFilters = Boolean(dropoffStageFilter || dropoffDeviceFilter || dropoffCountryFilter || dropoffCampaignFilter);
  const storefrontPixelInstallUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
    const encodedStore = encodeURIComponent(storeId);
    return origin ? `${origin}/pixel.js?store=${encodedStore}` : `/pixel.js?store=${encodedStore}`;
  }, [storeId]);
  const hasRecentStorefrontSignals = useMemo(() => {
    return events.some((event) => {
      const eventName = normalizeLooseKey(event?.event_name);
      const eventSource = normalizeLooseKey(event?.source);
      return eventSource === 'theme_pixel' || CLARITY_SIGNAL_EVENT_NAMES.has(eventName);
    });
  }, [events]);
  const clarityEmptyMessage = useMemo(() => {
    if (clarityLoading || clarityError || claritySignals) return '';
    if (!libraryDay && libraryDays.length > 0) {
      return 'Select a day to load clarity signals for that day.';
    }
    if (hasRecentStorefrontSignals) {
      return `No clarity signals found for ${libraryDay || 'the selected day'} in ${ISSUE_SCOPE_LABEL}. Try another day.`;
    }
    return 'No clarity signals yet. Install the storefront script:';
  }, [
    clarityError,
    clarityLoading,
    claritySignals,
    hasRecentStorefrontSignals,
    libraryDay,
    libraryDays.length
  ]);
  const shouldShowClarityInstallHint = useMemo(() => (
    !clarityLoading
    && !clarityError
    && !claritySignals
    && !hasRecentStorefrontSignals
    && !(libraryDays.length > 0 && !libraryDay)
  ), [clarityError, clarityLoading, claritySignals, hasRecentStorefrontSignals, libraryDay, libraryDays.length]);

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
  const hasConfirmedIssues = issueRows.some((row) => row.verificationStatus === 'confirmed');
  const investigatingIssueRows = useMemo(() => (
    issueRows.filter((row) => row.verificationStatus !== 'confirmed' && row.verificationStatus !== 'false_positive')
  ), [issueRows]);
  const confirmedIssueRows = useMemo(() => (
    issueRows.filter((row) => row.verificationStatus === 'confirmed')
  ), [issueRows]);
  const filteredIssueRows = useMemo(() => {
    if (issueVerificationView === ISSUE_VERIFICATION_VIEW.CONFIRMED) return confirmedIssueRows;
    return investigatingIssueRows;
  }, [confirmedIssueRows, investigatingIssueRows, issueVerificationView]);
  const technicalIssueRows = useMemo(() => (
    filteredIssueRows.filter((row) => TECHNICAL_ISSUE_TYPES.has(row.type))
  ), [filteredIssueRows]);
  const interactionFrictionRows = useMemo(() => (
    filteredIssueRows.filter((row) => INTERACTION_FRICTION_ISSUE_TYPES.has(row.type))
  ), [filteredIssueRows]);
  const visibleTechnicalIssueRows = technicalIssueRows.slice(0, ISSUE_TABLE_ROW_LIMIT);
  const visibleInteractionFrictionRows = interactionFrictionRows.slice(0, ISSUE_TABLE_ROW_LIMIT);
  const issueTableSections = useMemo(() => ([
    {
      key: 'technical',
      title: 'Technical issues',
      subtitle: 'JS/runtime/form/scroll clusters',
      emptyMessage: issueVerificationView === ISSUE_VERIFICATION_VIEW.CONFIRMED
        ? 'No confirmed technical issues in this range yet.'
        : 'No technical issues under review in this range.',
      rows: visibleTechnicalIssueRows
    },
    {
      key: 'interaction',
      title: 'Interaction friction',
      subtitle: 'Dead and rage clicks only',
      emptyMessage: issueVerificationView === ISSUE_VERIFICATION_VIEW.CONFIRMED
        ? 'No confirmed interaction friction in this range yet.'
        : 'No interaction friction under review in this range.',
      rows: visibleInteractionFrictionRows
    }
  ]), [issueVerificationView, visibleInteractionFrictionRows, visibleTechnicalIssueRows]);
  const topIssue = filteredIssueRows[0] || issueRows[0] || null;
  const developerGuideRows = technicalIssueRows.slice(0, 3);
  const actionPlanRows = useMemo(() => (
    buildBehaviorPatternRows({ librarySessions })
  ), [librarySessions]);
  const deviceAbandonmentModel = useMemo(() => (
    buildDeviceAbandonmentModel({ librarySessions })
  ), [librarySessions]);
  const visibleSurveyTemplates = useMemo(() => (
    (Array.isArray(surveyTemplates) ? surveyTemplates : []).slice(0, SURVEY_TEMPLATE_ROW_LIMIT)
  ), [surveyTemplates]);
  const surveySummaryRows = useMemo(() => (
    (Array.isArray(surveySummary?.rows) ? surveySummary.rows : []).slice(0, SURVEY_TEMPLATE_ROW_LIMIT)
  ), [surveySummary?.rows]);
  const recentSurveyResponses = useMemo(() => (
    (Array.isArray(surveySummary?.recentResponses) ? surveySummary.recentResponses : []).slice(0, SURVEY_RECENT_RESPONSE_ROW_LIMIT)
  ), [surveySummary?.recentResponses]);
  const surveyRangeLabel = `${journeyComparisonRanges.current.startDate} to ${journeyComparisonRanges.current.endDate} (UTC)`;

  useEffect(() => {
    if (hasConfirmedIssues) return;
    if (issueVerificationView !== ISSUE_VERIFICATION_VIEW.CONFIRMED) return;
    setIssueVerificationView(ISSUE_VERIFICATION_VIEW.INVESTIGATING);
  }, [hasConfirmedIssues, issueVerificationView]);

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

  const landingRows = Array.isArray(landingPurchaseReport?.rows) ? landingPurchaseReport.rows : [];
  const abandonmentRows = Array.isArray(abandonmentReport?.rows) ? abandonmentReport.rows : [];
  const previousLandingRows = Array.isArray(landingPurchasePreviousReport?.rows) ? landingPurchasePreviousReport.rows : [];
  const previousAbandonmentRows = Array.isArray(abandonmentPreviousReport?.rows) ? abandonmentPreviousReport.rows : [];
  const visibleLandingRows = landingRows.slice(0, JOURNEY_UI_ROW_LIMIT);
  const visibleAbandonmentRows = abandonmentRows.slice(0, JOURNEY_UI_ROW_LIMIT);
  const landingStageBreakdown = useMemo(() => (
    buildJourneyStageBreakdown(landingRows, {
      getStage: (row) => journeyStageFromLandingLabel(row?.landing),
      getCount: (row) => row?.purchases
    })
  ), [landingRows]);
  const previousLandingStageBreakdown = useMemo(() => (
    buildJourneyStageBreakdown(previousLandingRows, {
      getStage: (row) => journeyStageFromLandingLabel(row?.landing),
      getCount: (row) => row?.purchases
    })
  ), [previousLandingRows]);
  const abandonmentStageBreakdown = useMemo(() => (
    buildJourneyStageBreakdown(abandonmentRows, {
      getStage: (row) => journeyStageFromAbandonArea(row?.abandoned_part),
      getCount: (row) => row?.sessions
    })
  ), [abandonmentRows]);
  const previousAbandonmentStageBreakdown = useMemo(() => (
    buildJourneyStageBreakdown(previousAbandonmentRows, {
      getStage: (row) => journeyStageFromAbandonArea(row?.abandoned_part),
      getCount: (row) => row?.sessions
    })
  ), [previousAbandonmentRows]);
  const landingStageTrends = useMemo(
    () => buildJourneyStageTrends(landingStageBreakdown, previousLandingStageBreakdown),
    [landingStageBreakdown, previousLandingStageBreakdown]
  );
  const abandonmentStageTrends = useMemo(
    () => buildJourneyStageTrends(abandonmentStageBreakdown, previousAbandonmentStageBreakdown),
    [abandonmentStageBreakdown, previousAbandonmentStageBreakdown]
  );
  const landingPeriodLabel = landingPurchaseReport?.period?.start && landingPurchaseReport?.period?.end
    ? `${landingPurchaseReport.period.start} to ${landingPurchaseReport.period.end} (UTC)`
    : 'Last 7 days (UTC)';
  const abandonmentPeriodLabel = abandonmentReport?.period?.start && abandonmentReport?.period?.end
    ? `${abandonmentReport.period.start} to ${abandonmentReport.period.end} (UTC)`
    : 'Last 7 days (UTC)';

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

      <div className="si-card si-day-pulse-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Today&apos;s Session Pulse</h3>
          <span className="si-muted">
            {dayPulse?.updatedAt
              ? `Live • updated ${formatClockTime(dayPulse.updatedAt)}`
              : dayPulseLoading
                ? 'Live • updating...'
                : 'Live'}
          </span>
        </div>

        {dayPulseError ? (
          <div className="si-empty" style={{ paddingTop: 6, color: '#b42318' }}>
            {dayPulseError}
          </div>
        ) : (
          <>
            <div className="si-day-pulse-main-row">
              <div className="si-day-pulse-value">{formatNumber(dayPulse?.sessionsSoFar || 0)}</div>
              <div className="si-day-pulse-side">
                <span className={`si-chip si-day-pulse-projection ${dayPulseProjectionClass}`}>
                  {dayPulse?.projectionLabel || 'Mid'} day
                </span>
                <span className="si-day-pulse-projected">
                  Projected: {formatNumber(dayPulse?.projectedSessions || 0)}
                </span>
              </div>
            </div>

            <div className="si-day-pulse-sub">Sessions recorded so far today</div>

            <div className="si-day-pulse-comparisons">
              {dayPulseComparisons.map((comparison, index) => {
                const direction = (comparison?.direction || 'na').toString().toLowerCase();
                return (
                  <div
                    key={`${comparison.label || 'comparison'}-${index}`}
                    className={`si-day-pulse-delta si-day-pulse-delta-${direction}`}
                    title={`${comparison.label}: ${comparison.deltaLabel} (baseline ${formatNumber(comparison.sessions)} sessions)`}
                  >
                    <span className="si-day-pulse-arrow">{comparison.arrow}</span>
                    <span className="si-day-pulse-delta-value">{comparison.deltaLabel}</span>
                    <span className="si-day-pulse-delta-label">{comparison.label}</span>
                    <span className="si-day-pulse-delta-baseline">{formatNumber(comparison.sessions)} sessions</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="si-card si-realtime-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Realtime overview</h3>
          <span className="si-muted">
            KPI cards: today so far • Map/events: last {REALTIME_WINDOW_MINUTES}m • {realtime?.lastEventAt ? `Last event ${timeAgo(realtime.lastEventAt)}` : '—'}
          </span>
        </div>

        <div className="si-row si-realtime-controls">
          <button className="si-button si-button-small" type="button" onClick={loadRealtime} disabled={realtimeLoading}>
            {realtimeLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          {realtime?.updatedAt ? (
            <span className="si-muted">Last refreshed at {formatClockTime(realtime.updatedAt)}</span>
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

        <div className="si-realtime-kpis si-realtime-kpis-primary">
          {realtimeMetricCards.map((card) => (
            <div key={card.key} className="si-realtime-kpi si-realtime-kpi-primary">
              <div className="si-realtime-kpi-head">
                <div className="si-realtime-kpi-label">{card.label}</div>
                <div className="si-realtime-kpi-sparkline" aria-hidden="true">
                  {card.sparkline?.linePath ? (
                    <svg
                      viewBox={`0 0 ${REALTIME_KPI_SPARKLINE_WIDTH} ${REALTIME_KPI_SPARKLINE_HEIGHT}`}
                      role="presentation"
                    >
                      <defs>
                        <linearGradient id={`si-sparkline-gradient-${card.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
                          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
                        </linearGradient>
                      </defs>
                      <path
                        d={card.sparkline.areaPath}
                        className={`si-realtime-kpi-sparkline-area si-realtime-kpi-sparkline-area-${card.sparklineDirection}`}
                        fill={`url(#si-sparkline-gradient-${card.key})`}
                      />
                      <path
                        d={card.sparkline.linePath}
                        className={`si-realtime-kpi-sparkline-path si-realtime-kpi-sparkline-path-${card.sparklineDirection}`}
                      />
                      <circle
                        cx={card.sparkline.firstPoint?.x ?? 0}
                        cy={card.sparkline.firstPoint?.y ?? 0}
                        r="2"
                        className={`si-realtime-kpi-sparkline-dot si-realtime-kpi-sparkline-dot-${card.sparklineDirection}`}
                      />
                      <circle
                        cx={card.sparkline.lastPoint?.x ?? 0}
                        cy={card.sparkline.lastPoint?.y ?? 0}
                        r="2.4"
                        className={`si-realtime-kpi-sparkline-dot si-realtime-kpi-sparkline-dot-${card.sparklineDirection}`}
                      />
                    </svg>
                  ) : (
                    <span className="si-realtime-kpi-sparkline-empty">No trend yet</span>
                  )}
                </div>
              </div>
              <div className="si-realtime-kpi-value">{formatNumber(card.value)}</div>
              <div className="si-realtime-kpi-deltas">
                {card.comparisons.map((comparison) => (
                  <div
                    key={`${card.key}-${comparison.label || 'comparison'}`}
                    className={`si-realtime-kpi-delta si-realtime-kpi-delta-${comparison.direction}`}
                    title={`${comparison.label || ''}: ${comparison.deltaLabel} (baseline ${formatNumber(comparison.value)})`}
                  >
                    <span className="si-realtime-kpi-delta-arrow">{comparison.arrow}</span>
                    <span className="si-realtime-kpi-delta-value">{comparison.deltaLabel}</span>
                    <span className="si-realtime-kpi-delta-label">{comparison.label || 'comparison'}</span>
                    <span className="si-realtime-kpi-delta-baseline">{formatNumber(comparison.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="si-realtime-kpis si-realtime-kpis-secondary">
          {realtimeKeyEventCards.map((card) => (
            <div key={card.key} className="si-realtime-kpi si-realtime-kpi-secondary">
              <div className="si-realtime-kpi-label">{card.label}</div>
              <div className="si-realtime-kpi-value">{formatNumber(card.value)}</div>
            </div>
          ))}
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

      <div className="si-journey-grid" style={{ marginBottom: 12 }}>
        <div className="si-card si-journey-card">
          <div className="si-card-title">
            <h3>Abandonment map</h3>
            <span className="si-muted">{abandonmentPeriodLabel}</span>
          </div>
          {abandonmentStageTrends.length > 0 ? (
            <div className="si-journey-stage-row">
              {abandonmentStageTrends.map((trend) => (
                <span
                  key={`abandon-stage-${trend.stage}`}
                  className={`si-stage-pill si-stage-${journeyStageKey(trend.stage)} ${trend.isTopSignificant ? 'si-stage-pill-significant' : ''}`}
                  title={`Previous: ${formatNumber(trend.previousCount)} • Delta: ${trend.deltaCount >= 0 ? '+' : ''}${formatNumber(trend.deltaCount)}`}
                >
                  <span>{trend.stage}</span>
                  <span className="si-stage-pill-count">{formatNumber(trend.currentCount)}</span>
                  <span className={`si-stage-trend si-stage-trend-${trend.direction}`}>{trend.trendLabel}</span>
                </span>
              ))}
            </div>
          ) : null}

          {abandonmentLoading && !abandonmentReport ? (
            <div className="si-empty">Loading abandonment report…</div>
          ) : null}

          {!abandonmentLoading && abandonmentError ? (
            <div className="si-empty" style={{ color: '#b42318' }}>{abandonmentError}</div>
          ) : null}

          {!abandonmentLoading && !abandonmentError && abandonmentRows.length === 0 ? (
            <div className="si-empty">No ranked abandonment clusters yet in this range.</div>
          ) : null}

          {!abandonmentLoading && !abandonmentError && abandonmentRows.length > 0 ? (
            <>
              <div className="si-journey-table-wrap">
                <table className="si-event-table si-journey-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Section</th>
                      <th>Drop-off area</th>
                      <th>Product context</th>
                      <th>Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAbandonmentRows.map((row) => {
                      const stage = journeyStageFromAbandonArea(row?.abandoned_part);
                      return (
                      <tr key={`abandon-row-${row.rank}-${row.abandoned_part}-${row.product}`}>
                        <td><strong>{row.rank}</strong></td>
                        <td>
                          <span className={`si-stage-pill si-stage-pill-inline si-stage-${journeyStageKey(stage)}`}>{stage}</span>
                        </td>
                        <td>{row.abandoned_part || '—'}</td>
                        <td>{row.product || '—'}</td>
                        <td>{formatNumber(row.sessions)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="si-muted" style={{ marginTop: 10 }}>
                Classified sessions: {formatNumber(abandonmentReport.totalAbandonSessions)}.
                {' '}Unclassified: {formatNumber(abandonmentReport.unclassifiedSessions)}.
                {' '}Breakdown: {formatJourneyBreakdownSummary(abandonmentReport.unclassifiedBreakdown)}.
              </div>
            </>
          ) : null}
        </div>

        <div className="si-card si-journey-card">
          <div className="si-card-title">
            <h3>Landing pages that lead to purchases</h3>
            <span className="si-muted">{landingPeriodLabel}</span>
          </div>
          {landingStageTrends.length > 0 ? (
            <div className="si-journey-stage-row">
              {landingStageTrends.map((trend) => (
                <span
                  key={`landing-stage-${trend.stage}`}
                  className={`si-stage-pill si-stage-${journeyStageKey(trend.stage)} ${trend.isTopSignificant ? 'si-stage-pill-significant' : ''}`}
                  title={`Previous: ${formatNumber(trend.previousCount)} • Delta: ${trend.deltaCount >= 0 ? '+' : ''}${formatNumber(trend.deltaCount)}`}
                >
                  <span>{trend.stage}</span>
                  <span className="si-stage-pill-count">{formatNumber(trend.currentCount)}</span>
                  <span className={`si-stage-trend si-stage-trend-${trend.direction}`}>{trend.trendLabel}</span>
                </span>
              ))}
            </div>
          ) : null}

          {landingPurchaseLoading && !landingPurchaseReport ? (
            <div className="si-empty">Loading landing-to-purchase report…</div>
          ) : null}

          {!landingPurchaseLoading && landingPurchaseError ? (
            <div className="si-empty" style={{ color: '#b42318' }}>{landingPurchaseError}</div>
          ) : null}

          {!landingPurchaseLoading && !landingPurchaseError && landingRows.length === 0 ? (
            <div className="si-empty">No attributed purchases yet in this range.</div>
          ) : null}

          {!landingPurchaseLoading && !landingPurchaseError && landingRows.length > 0 ? (
            <>
              <div className="si-journey-table-wrap">
                <table className="si-event-table si-journey-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Section</th>
                      <th>Landing page</th>
                      <th>Purchases</th>
                      <th>Purchase record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLandingRows.map((row) => {
                      const stage = journeyStageFromLandingLabel(row?.landing);
                      return (
                      <tr key={`landing-row-${row.rank}-${row.landing}`}>
                        <td><strong>{row.rank}</strong></td>
                        <td>
                          <span className={`si-stage-pill si-stage-pill-inline si-stage-${journeyStageKey(stage)}`}>{stage}</span>
                        </td>
                        <td>{row.landing || '—'}</td>
                        <td>{formatNumber(row.purchases)}</td>
                        <td>{formatJourneyPurchaseRecord(row.top_products)}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="si-muted" style={{ marginTop: 10 }}>
                Attributed purchases: {formatNumber(landingPurchaseReport.attributedPurchases)} / {formatNumber(landingPurchaseReport.totalPurchases)}.
                {' '}Unattributed: {formatNumber(landingPurchaseReport.unattributedPurchases)}.
                {' '}Breakdown: {formatJourneyBreakdownSummary(landingPurchaseReport.unattributedBreakdown)}.
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="si-card si-issues-layout-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Top issues</h3>
          <span className="si-muted">
            Ranked by high-intent impact • {issueVerificationView === ISSUE_VERIFICATION_VIEW.CONFIRMED ? 'Confirmed' : 'Investigating'}
          </span>
        </div>

        <div className="si-row si-issues-toolbar" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button
            className={`si-chip si-chip-button ${issueVerificationView === ISSUE_VERIFICATION_VIEW.INVESTIGATING ? 'si-chip-active' : ''}`}
            type="button"
            onClick={() => setIssueVerificationView(ISSUE_VERIFICATION_VIEW.INVESTIGATING)}
          >
            Investigating
          </button>
          <button
            className={`si-chip si-chip-button ${issueVerificationView === ISSUE_VERIFICATION_VIEW.CONFIRMED ? 'si-chip-active' : ''}`}
            type="button"
            onClick={() => setIssueVerificationView(ISSUE_VERIFICATION_VIEW.CONFIRMED)}
            disabled={!hasConfirmedIssues}
            title={hasConfirmedIssues ? 'Show confirmed issues only.' : 'No confirmed issues yet.'}
          >
            Confirmed
          </button>
          {verificationSummary?.total > 0 ? (
            <span className="si-muted">
              Verifier: {formatNumber(verificationSummary.confirmed)} confirmed, {formatNumber(verificationSummary.false_positive)} false alerts, {formatNumber(verificationSummary.unverified)} under review
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
            No rows match this status filter yet.
          </div>
        ) : null}

        {!clarityLoading && !clarityError && filteredIssueRows.length > 0 ? (
          <div className="si-journey-grid si-issues-split-grid">
            {issueTableSections.map((section) => (
              <div key={section.key} className="si-card si-journey-card si-issues-panel-card">
                <div className="si-card-title si-table-panel-header">
                  <h3>{section.title}</h3>
                  <span className="si-muted">{section.subtitle}</span>
                </div>
                {section.rows.length === 0 ? (
                  <div className="si-empty">{section.emptyMessage}</div>
                ) : (
                  <div className="si-journey-table-wrap si-issues-table-wrap">
                    <table className="si-event-table si-issues-compact-table">
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Issue</th>
                          <th>Where</th>
                          <th>Sessions</th>
                          <th>% high-intent</th>
                          <th>Status</th>
                          <th>Proof</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row, rowIndex) => {
                          const verificationState = verificationUi(row.verificationStatus, row);
                          const sampleList = Array.isArray(row.sampleSessions) ? row.sampleSessions : [];
                          const proofSession = sampleList[0];
                          const proofCount = Math.min(sampleList.length, ISSUE_PROOF_SESSION_LIMIT);
                          const issueBadge = issueTypeBadgeMeta(row.type);
                          return (
                            <tr key={row.id} className={`si-issue-row si-issue-${row.type}`}>
                              <td><strong>{rowIndex + 1}</strong></td>
                              <td>
                                <div className="si-issue-cell">
                                  <span className="si-issue-name">{row.issueLabel}</span>
                                  <span className={`si-issue-type-badge si-issue-type-${issueBadge.tone}`}>{issueBadge.label}</span>
                                </div>
                              </td>
                              <td title={row.whereLabel}>
                                <span className="si-issue-where-text">{row.whereLabel}</span>
                              </td>
                              <td>{pluralize(row.sessionsAffected, 'session', 'sessions')}</td>
                              <td>{formatPercent(row.highIntentRate, 0)}</td>
                              <td title={verificationState.hint || row.verificationReason || ''}>
                                <span className={`si-chip ${verificationState.className}`}>{verificationState.label}</span>
                              </td>
                              <td>
                                {proofSession?.session_id ? (
                                  <button
                                    className="si-button si-button-small"
                                    type="button"
                                    onClick={() => openStory(proofSession.session_id, proofSession)}
                                    title={`View ${pluralize(proofCount, 'session', 'sessions')}`}
                                  >
                                    View {proofCount || 1}
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
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="si-card si-device-abandon-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Abandonment by device</h3>
          <span className="si-muted">Traffic-adjusted view • {libraryDay || 'Today'}</span>
        </div>
        {deviceAbandonmentModel.totalSessions === 0 ? (
          <div className="si-empty">
            No classified iOS/Android/Desktop sessions yet for this day.
          </div>
        ) : (
          <>
            <div className="si-device-abandon-layout">
              <div className="si-device-pie-wrap">
                <div className="si-device-pie" style={{ background: deviceAbandonmentModel.pieGradient }}>
                  <div className="si-device-pie-center">
                    <div className="si-device-pie-value">{formatPercent(deviceAbandonmentModel.baselineAbandonRate, 0)}</div>
                    <div className="si-device-pie-label">Baseline abandon rate</div>
                  </div>
                </div>
              </div>
              <div className="si-device-legend">
                {deviceAbandonmentModel.rows.map((row) => {
                  const excessRounded = Math.round(row.excessAbandon);
                  const excessLabel = `${excessRounded > 0 ? '+' : ''}${formatNumber(excessRounded)} vs expected`;
                  return (
                    <div key={`device-legend-${row.key}`} className="si-device-legend-row">
                      <span className="si-device-dot" style={{ background: row.color }} />
                      <span className="si-device-legend-name">{row.label}</span>
                      <span className="si-device-legend-share">{formatPercent(row.adjustedShare, 0)}</span>
                      <span className={`si-device-legend-excess ${row.excessAbandon > 0 ? 'si-device-legend-excess-positive' : 'si-device-legend-excess-neutral'}`}>
                        {excessLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="si-device-note">
              This chart adjusts abandonment by each device&apos;s share of total sessions, so high-volume traffic does not dominate by default.
            </div>
            <div className="si-device-note si-device-note-fine">
              Math note: adjusted share is proportional to (device abandon share ÷ device traffic share), then normalized to 100%.
            </div>
            {deviceAbandonmentModel.unknownSessions > 0 ? (
              <div className="si-muted" style={{ marginTop: 6 }}>
                {pluralize(deviceAbandonmentModel.unknownSessions, 'session', 'sessions')} could not be classified as iOS/Android/Desktop and are shown as <strong>Unknown</strong>.
              </div>
            ) : null}
            {deviceAbandonmentModel.topOverIndexed ? (
              <div className="si-device-callout">
                Strongest over-index today: <strong>{deviceAbandonmentModel.topOverIndexed.label}</strong> ({formatPercent(deviceAbandonmentModel.topOverIndexed.abandonRate, 1)} abandon rate), most commonly at <strong>{deviceAbandonmentModel.topOverIndexed.topSectionLabel}</strong>.
              </div>
            ) : null}

            <table className="si-event-table si-device-abandon-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Sessions</th>
                  <th>Abandon rate</th>
                  <th>Traffic-adjusted index</th>
                  <th>Likely abandon section</th>
                </tr>
              </thead>
              <tbody>
                {deviceAbandonmentModel.rows.map((row) => (
                  <tr key={`device-row-${row.key}`}>
                    <td>
                      <span className="si-device-table-device">
                        <span className="si-device-dot" style={{ background: row.color }} />
                        {row.label}
                      </span>
                    </td>
                    <td>{pluralize(row.totalSessions, 'session', 'sessions')}</td>
                    <td>{formatPercent(row.abandonRate, 1)}</td>
                    <td>{row.adjustedIndex.toFixed(2)}x</td>
                    <td>
                      {row.topSectionLabel === '—'
                        ? '—'
                        : `${row.topSectionLabel} (${formatPercent(row.topSectionShare, 0)} of abandons)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="si-card si-action-plan-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Behavior patterns</h3>
          <span className="si-muted">Campaign/country segments that over-index vs the day baseline</span>
        </div>
        {actionPlanRows.length === 0 ? (
          <div className="si-empty">
            No campaign/country segments reached the emerging threshold yet.
          </div>
        ) : (
          <div className="si-action-plan-list">
            {actionPlanRows.map((row, idx) => {
              const proofSession = row.sampleSession;
              return (
                <div key={`pattern-${row.id}`} className="si-action-plan-row">
                  <div className="si-action-plan-rank">{idx + 1}</div>
                  <div className="si-action-plan-body">
                    <div className="si-action-plan-title">{row.patternLabel}</div>
                    <div className="si-action-plan-where">{row.whereLabel}</div>
                    <div className="si-action-plan-evidence"><strong>Observation:</strong> {row.observation}</div>
                    <div className="si-action-plan-evidence"><strong>What it suggests:</strong> {row.suggests}</div>
                    <div className="si-action-plan-evidence"><strong>Next check:</strong> {row.nextCheck}</div>
                    <div className="si-action-plan-evidence"><strong>Fix first:</strong> {row.fixFirst}</div>
                  </div>
                  <div className="si-action-plan-meta">
                    <span className={`si-chip ${row.status === 'Established' ? 'si-pattern-established' : 'si-pattern-emerging'}`}>{row.status}</span>
                    <div className="si-action-plan-impact">{row.statusLine}</div>
                    {proofSession?.session_id ? (
                      <button
                        className="si-button si-button-small"
                        type="button"
                        onClick={() => openStory(proofSession.session_id, proofSession)}
                      >
                        View evidence
                      </button>
                    ) : (
                      <span className="si-muted">No sample</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="si-journey-grid" style={{ marginBottom: 12 }}>
        <div className="si-card si-journey-card">
          <div className="si-card-title">
            <h3>Survey templates</h3>
            <span className="si-muted">{surveyRangeLabel}</span>
          </div>

          {surveyLoading && visibleSurveyTemplates.length === 0 ? (
            <div className="si-empty">Loading survey templates…</div>
          ) : null}

          {!surveyLoading && surveyError ? (
            <div className="si-empty" style={{ color: '#b42318' }}>{surveyError}</div>
          ) : null}

          {!surveyLoading && !surveyError && visibleSurveyTemplates.length === 0 ? (
            <div className="si-empty">No survey templates are registered yet.</div>
          ) : null}

          {!surveyLoading && !surveyError && visibleSurveyTemplates.length > 0 ? (
            <div className="si-journey-table-wrap">
              <table className="si-event-table si-survey-table">
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Trigger</th>
                    <th>Delivery</th>
                    <th>Status</th>
                    <th>Usage</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSurveyTemplates.map((template) => {
                    const recommendation = template.recommendation || {};
                    const actionLabel = template.status === 'active' ? 'Pause' : 'Enable';
                    return (
                      <tr key={template.key}>
                        <td>
                          <div className="si-survey-template-cell">
                            <div className="si-survey-template-name">{template.name}</div>
                            <div className="si-survey-template-goal">{template.goal}</div>
                            {recommendation.recommended ? (
                              <div className="si-survey-template-note">
                                Recommended now • {pluralize(recommendation.affectedSessions, 'session', 'sessions')} in scope
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td>{template.triggerLabel}</td>
                        <td>
                          <div className="si-survey-chip-stack">
                            <span className="si-badge si-survey-badge-delivery">{surveyDeliveryLabel(template.deliveryType, template.deliveryLabel)}</span>
                            <span className="si-badge si-survey-badge-consent">{surveyConsentLabel(template.consentMode)}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`si-chip ${surveyStatusClassName(template.status)}`}>{surveyStatusLabel(template.status)}</span>
                        </td>
                        <td>
                          {template.responseCount > 0 ? (
                            <div className="si-survey-usage">
                              <strong>{pluralize(template.responseCount, 'response', 'responses')}</strong>
                              <span className="si-muted">{pluralize(template.linkedSessions, 'linked session', 'linked sessions')}</span>
                            </div>
                          ) : (
                            <span className="si-muted">No responses yet</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="si-button si-button-small"
                            type="button"
                            disabled={surveySavingKey === template.key}
                            onClick={() => toggleSurveyTemplate(template)}
                          >
                            {surveySavingKey === template.key ? 'Saving…' : actionLabel}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="si-card si-journey-card">
          <div className="si-card-title">
            <h3>Survey evidence</h3>
            <span className="si-muted">{surveyRangeLabel}</span>
          </div>

          {surveyLoading && !surveySummary ? (
            <div className="si-empty">Loading linked survey responses…</div>
          ) : null}

          {!surveyLoading && !surveyError && surveySummaryRows.length === 0 ? (
            <div className="si-empty">
              No linked survey responses yet. Once a live survey is enabled and shoppers respond, the strongest reasons will show here.
            </div>
          ) : null}

          {!surveyLoading && surveySummaryRows.length > 0 ? (
            <>
              <div className="si-journey-table-wrap">
                <table className="si-event-table si-survey-table">
                  <thead>
                    <tr>
                      <th>Template</th>
                      <th>Responses</th>
                      <th>Top reason</th>
                      <th>Linked sessions</th>
                      <th>Last response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {surveySummaryRows.map((row) => (
                      <tr key={`survey-summary-${row.templateKey}`}>
                        <td>{row.templateName}</td>
                        <td>{pluralize(row.responseCount, 'response', 'responses')}</td>
                        <td>{row.topChoice?.label ? `${row.topChoice.label} (${formatNumber(row.topChoice.responses)})` : '—'}</td>
                        <td>{pluralize(row.linkedSessions, 'session', 'sessions')}</td>
                        <td>{timeAgo(row.lastResponseAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {recentSurveyResponses.length > 0 ? (
                <div className="si-survey-recent-list">
                  {recentSurveyResponses.map((row, idx) => (
                    <div key={`survey-recent-${row.templateKey}-${row.submittedAt}-${idx}`} className="si-survey-recent-item">
                      <div className="si-survey-recent-top">
                        <span className="si-survey-recent-template">{row.templateName}</span>
                        <span className="si-muted">{timeAgo(row.submittedAt)}</span>
                      </div>
                      <div className="si-survey-recent-body">
                        <span className="si-badge si-survey-badge-reason">{row.responseChoiceLabel || 'Open text'}</span>
                        <span>{formatSurveyResponseSnippet(row.responseText)}</span>
                      </div>
                      <div className="si-muted">
                        {row.pagePath ? `${formatPathLabel(row.pagePath)} • ` : ''}{row.shopperNumber ? formatShopperNumber(row.shopperNumber) : 'Unlinked'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
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

        {developerGuideRows.length > 0 ? (
          <div className="si-card si-dev-guide-card" style={{ marginBottom: 12 }}>
            <div className="si-card-title">
              <h3>Developer fix instructions</h3>
              <span className="si-muted">How to resolve each top technical issue</span>
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
            {ISSUE_SCOPE_LABEL}
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

        {!clarityLoading && !clarityError && !claritySignals && clarityEmptyMessage ? (
          <div className="si-empty" style={{ marginTop: 10 }}>
            {clarityEmptyMessage}{' '}
            {shouldShowClarityInstallHint ? (
              <span className="si-code">{storefrontPixelInstallUrl}</span>
            ) : null}
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
                    <th>Entry page</th>
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
                    <td title={s.entry_page_path || s.entry_page_url || ''}>
                      <span className="si-path-label">
                        {formatPathLabel(s.entry_page_path || s.entry_page_url || '')}
                      </span>
                    </td>
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
