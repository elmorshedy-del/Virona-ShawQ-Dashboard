import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';

const BRIEF_ENDPOINT_GENERATE = '/api/campaign-intelligence/unified-brief/generate';
const BRIEF_ENDPOINT_SETTINGS = '/api/campaign-intelligence/brief/settings';
const UNIFIED_TIMELINE_ENDPOINT = '/api/campaign-intelligence/unified-timeline';
const TYPOGRAPHY_HEADING = '"Space Grotesk", "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, sans-serif';

const METRIC_KEYS = Object.freeze([
  'ctr',
  'hookRate',
  'lpvClick',
  'atcLpv',
  'costAtc',
  'icAtc',
  'purchaseIc',
  'roas',
  'frequency',
  'cpm',
  'concentration'
]);

const METRIC_CONFIG = Object.freeze({
  ctr: Object.freeze({ label: 'CTR', direction: 'higher_better', type: 'percent' }),
  hookRate: Object.freeze({ label: 'Hook Rate', direction: 'higher_better', type: 'percent' }),
  lpvClick: Object.freeze({ label: 'LPV/Click', direction: 'higher_better', type: 'percent' }),
  atcLpv: Object.freeze({ label: 'ATC/LPV', direction: 'higher_better', type: 'percent' }),
  costAtc: Object.freeze({ label: 'Cost/ATC', direction: 'lower_better', type: 'usd' }),
  icAtc: Object.freeze({ label: 'IC/ATC', direction: 'higher_better', type: 'percent' }),
  purchaseIc: Object.freeze({ label: 'Purchase/IC', direction: 'higher_better', type: 'percent' }),
  roas: Object.freeze({ label: 'ROAS', direction: 'higher_better', type: 'ratio' }),
  frequency: Object.freeze({ label: 'Frequency', direction: 'lower_better', type: 'number' }),
  cpm: Object.freeze({ label: 'CPM', direction: 'lower_better', type: 'usd' }),
  concentration: Object.freeze({ label: 'Concentration', direction: 'lower_better', type: 'percent' })
});

const CELL_STATUS_STYLE = Object.freeze({
  strong_good: 'bg-[#ecfdf3] border-[#a7f3d0] text-[#065f46]',
  good: 'bg-[#f0fdf4] border-[#bbf7d0] text-[#166534]',
  caution: 'bg-[#fffbeb] border-[#fde68a] text-[#92400e]',
  bad: 'bg-[#fff7ed] border-[#fdba74] text-[#9a3412]',
  critical: 'bg-[#fef2f2] border-[#fca5a5] text-[#991b1b]',
  insufficient: 'bg-[#f8fafc] border-[#cbd5e1] text-[#64748b]'
});

const METRIC_STATUS_THRESHOLDS = Object.freeze({
  // Relative movement vs baseline for non-floor metrics.
  strongImprovementRatio: 0.1,
  improvementRatio: 0,
  mildDeclineRatio: -0.1,
  declineRatio: -0.25,
  severeDeclineRatio: -0.4
});

const KEY_METRIC_BOUNDS = Object.freeze({
  purchaseIcFloorRate: 0.3,
  costAtcCapUsd: 18
});

const HEALTH_RULES = Object.freeze({
  weights: Object.freeze({
    roasVsTarget: 0.45,
    roasVsBaseline: 0.2,
    purchaseIc: 0.15,
    cpmPressure: 0.1,
    ctrResilience: 0.1
  }),
  statusCutoffs: Object.freeze({
    strong: 85,
    healthy: 72,
    watch: 55,
    weak: 40
  })
});

const BRIEF_PRIORITY = Object.freeze({
  P1: 1,
  P2: 2,
  P3: 3
});

const TOP_DRAGGERS_LIMIT = 5;
const TOP_CREATIVES_LIMIT = 5;
const BRIEF_NOTES_LIMIT = 4;
const DEFAULT_VISIBLE_CAMPAIGN_LIMIT = 5;
const ROW_DEPTH_OFFSET_PX = 14;
const CHART_WIDTH = 280;
const CHART_HEIGHT = 64;
const CHART_EPSILON = 1e-6;
const TABLE_MIN_WIDTH_PX = 1500;
const PANEL_CHART_WIDTH = 300;
const PANEL_CHART_HEIGHT = 82;
const UI_SURFACE_STYLE = Object.freeze({
  cardBorder: '#dfe5ff',
  tableHeaderBg: '#f7f9ff',
  tableHeaderText: '#5e6da2',
  tableRowHover: '#f7f9ff',
  tableRowActive: '#f2f5ff',
  panelMutedText: '#5d6785'
});
const ACTIVE_STATUS_VALUES = Object.freeze(new Set(['ACTIVE']));
const TREND_HEALTH_PROXY_CONFIG = Object.freeze({
  roasWeight: 22,
  cvrWeight: 2600,
  min: 0,
  max: 100
});
const DRIVER_SIGNAL_LIMIT = 5;
const INSUFFICIENT_FUNDS_ERROR_CODE = 'insufficient_funds';
const INSUFFICIENT_FUNDS_MESSAGE = 'LLM credits/funds are insufficient for brief generation. Add billing/credits, then retry.';
const BRIEF_REPORT_KEYS = Object.freeze([
  'executiveSummary',
  'toWatch',
  'toDo',
  'draggers',
  'creativePriorities',
  'notes'
]);
const MOCK_VIEW_OPTIONS = Object.freeze([
  { value: 'hierarchy', label: 'Campaign / Ad Set / Ad' },
  { value: 'geo_split', label: 'Campaign / Country split' }
]);
const MOCK_WINDOW_OPTIONS = Object.freeze([
  { value: '14d', label: 'Last 14 full days' },
  { value: '7d', label: 'Last 7 full days' }
]);
const MOCK_TRIAGE_OPTIONS = Object.freeze([
  { value: 'attention', label: 'Only Needs Attention' },
  { value: 'all', label: 'Show All' }
]);
const DEFAULT_COUNTRY_OPTION = Object.freeze({
  code: 'ALL',
  label: 'All Active'
});
const WINDOW_DAY_LOOKUP = Object.freeze({
  '14d': 14,
  '7d': 7
});
const KEY_COLORED_METRICS = Object.freeze(new Set(['roas', 'costAtc', 'purchaseIc']));
const DIRECTION_DISPLAY_STYLE = Object.freeze({
  improving: 'bg-[#e9fbf3] text-[#12855f]',
  stable: 'bg-[#eef2ff] text-[#5f6b93]',
  deteriorating: 'bg-[#ffeded] text-[#b42828]',
  saturating: 'bg-[#fff5e6] text-[#b46a00]',
  insufficient: 'bg-[#f1f5f9] text-[#64748b]'
});
const DRAGGER_IMPACT_WASTE_RATIO = Object.freeze({
  high: 0.2,
  medium: 0.14,
  low: 0.08
});
const DRAGGER_CONFIDENCE_SCORE = Object.freeze({
  high: 86,
  medium: 72,
  low: 58
});
const DEFAULT_RECHECK_WINDOW = '24h';
const DEFAULT_TRIGGER_THRESHOLD = 'Monitor next full day';
const DEFAULT_ACTION_SCOPE_LEVEL = 'Scope';
const DEFAULT_ACTION_SCOPE_NAME = 'Current scope';
const BEST_FOR_BUSINESS_WEIGHTS = Object.freeze({
  efficiency: 0.45,
  volume: 0.3,
  stability: 0.15,
  incrementality: 0.1
});
const MAX_COUNTRY_BOARD_ROWS = 8;
const MAX_REGIME_ROWS = 6;
const CROSS_ENTITY_INSIGHT_LIMIT = 5;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const BRIEF_SUMMARY_MAX_CHARS = 560;
const COUNTRY_REGIME_CONFIG = Object.freeze({
  roasWeight: 0.45,
  cpmWeight: 0.3,
  purchaseIcWeight: 0.25,
  directionEdgeRatio: 1.05,
  materialDeltaRatio: 0.08
});

function toFiniteNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableNumber(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function safeDivide(numerator, denominator) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || Math.abs(bottom) < CHART_EPSILON) {
    return null;
  }
  return top / bottom;
}

function formatUsd(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/A';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(numeric);
}

function formatPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/A';
  return `${(numeric * 100).toFixed(digits)}%`;
}

function formatRatio(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/A';
  return numeric.toFixed(digits);
}

function formatNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/A';
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatCompactNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/A';
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
}

function getCountryDisplayName(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized || normalized === 'ALL') return DEFAULT_COUNTRY_OPTION.label;
  if (!/^[A-Z]{2}$/.test(normalized)) return normalized;
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return displayNames.of(normalized) || normalized;
  } catch (_error) {
    return normalized;
  }
}

function toCountryFlag(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '';
  const chars = [...normalized].map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
  return chars.join('');
}

function formatMetricValue(metricKey, value) {
  const config = METRIC_CONFIG[metricKey];
  if (!config) return 'N/A';
  const numeric = parseNullableNumber(value);
  if (!Number.isFinite(numeric)) return 'N/A';

  if (config.type === 'percent') return formatPercent(numeric, 2);
  if (config.type === 'usd') return formatUsd(numeric);
  if (config.type === 'ratio') return formatRatio(numeric, 2);
  if (config.type === 'number') return formatNumber(numeric, 2);
  return formatNumber(numeric, 2);
}

function formatDeltaPercent(current, baseline) {
  const now = parseNullableNumber(current);
  const base = parseNullableNumber(baseline);
  if (!Number.isFinite(now) || !Number.isFinite(base) || Math.abs(base) < CHART_EPSILON) {
    return 'N/A';
  }

  const delta = ((now - base) / Math.abs(base)) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

function metricDeltaRatio(metricKey, current, baseline) {
  const now = parseNullableNumber(current);
  const base = parseNullableNumber(baseline);
  if (!Number.isFinite(now) || !Number.isFinite(base) || Math.abs(base) < CHART_EPSILON) {
    return null;
  }

  const direction = METRIC_CONFIG[metricKey]?.direction || 'higher_better';
  const rawDeltaRatio = (now - base) / Math.abs(base);
  if (direction === 'lower_better') {
    return -rawDeltaRatio;
  }
  return rawDeltaRatio;
}

function resolveCellStatus(metricKey, current, baseline, targetRoas) {
  const now = parseNullableNumber(current);
  if (!Number.isFinite(now)) {
    return { code: 'insufficient', note: 'Insufficient data' };
  }

  if (metricKey === 'roas') {
    const floor = Math.max(0.1, toFiniteNumber(targetRoas, 4));
    if (now >= floor * 1.1) return { code: 'strong_good', note: 'Above target floor' };
    if (now >= floor) return { code: 'good', note: 'At target floor' };
    if (now >= floor * 0.9) return { code: 'caution', note: 'Slightly below floor' };
    if (now >= floor * 0.75) return { code: 'bad', note: 'Below floor' };
    return { code: 'critical', note: 'Far below floor' };
  }

  if (metricKey === 'costAtc') {
    const cap = KEY_METRIC_BOUNDS.costAtcCapUsd;
    if (now <= cap * 0.8) return { code: 'strong_good', note: 'Well below cap' };
    if (now <= cap) return { code: 'good', note: 'Within cap' };
    if (now <= cap * 1.15) return { code: 'caution', note: 'Near cap' };
    if (now <= cap * 1.35) return { code: 'bad', note: 'Above cap' };
    return { code: 'critical', note: 'Far above cap' };
  }

  if (metricKey === 'purchaseIc') {
    const floor = KEY_METRIC_BOUNDS.purchaseIcFloorRate;
    if (now >= floor * 1.15) return { code: 'strong_good', note: 'Strong close rate' };
    if (now >= floor) return { code: 'good', note: 'At floor' };
    if (now >= floor * 0.9) return { code: 'caution', note: 'Near floor' };
    if (now >= floor * 0.75) return { code: 'bad', note: 'Below floor' };
    return { code: 'critical', note: 'Far below floor' };
  }

  const base = parseNullableNumber(baseline);
  if (!Number.isFinite(base) || Math.abs(base) < CHART_EPSILON) {
    return { code: 'insufficient', note: 'Insufficient baseline' };
  }

  const effectiveDeltaRatio = metricDeltaRatio(metricKey, now, base);
  if (effectiveDeltaRatio == null) {
    return { code: 'insufficient', note: 'Insufficient baseline' };
  }

  if (effectiveDeltaRatio >= METRIC_STATUS_THRESHOLDS.strongImprovementRatio) {
    return { code: 'strong_good', note: 'Improving vs baseline' };
  }
  if (effectiveDeltaRatio >= METRIC_STATUS_THRESHOLDS.improvementRatio) {
    return { code: 'good', note: 'At baseline' };
  }
  if (effectiveDeltaRatio >= METRIC_STATUS_THRESHOLDS.mildDeclineRatio) {
    return { code: 'caution', note: 'Slight softening' };
  }
  if (effectiveDeltaRatio >= METRIC_STATUS_THRESHOLDS.declineRatio) {
    return { code: 'bad', note: 'Meaningful decline' };
  }
  if (effectiveDeltaRatio < METRIC_STATUS_THRESHOLDS.severeDeclineRatio) {
    return { code: 'critical', note: 'Severe decline' };
  }
  return { code: 'critical', note: 'Deep decline' };
}

function getRowDepth(row) {
  if (row?.level === 'campaign') return 0;
  if (row?.level === 'adset') return 1;
  return 2;
}

function getRowType(row) {
  if (row?.levelLabel) return row.levelLabel;
  if (row?.level === 'adset') return 'Ad Set';
  if (row?.level === 'ad') return 'Ad';
  return 'Campaign';
}

function rowMetric(row, metricKey, side = 'now') {
  return parseNullableNumber(row?.metrics?.[side]?.[metricKey]);
}

function computeHealthScore(row, targetRoas) {
  const roasNow = rowMetric(row, 'roas', 'now');
  const roasBase = rowMetric(row, 'roas', 'baseline');
  const purchaseIcNow = rowMetric(row, 'purchaseIc', 'now');
  const cpmNow = rowMetric(row, 'cpm', 'now');
  const cpmBase = rowMetric(row, 'cpm', 'baseline');
  const ctrNow = rowMetric(row, 'ctr', 'now');
  const ctrBase = rowMetric(row, 'ctr', 'baseline');

  const weights = HEALTH_RULES.weights;
  const components = [];

  if (Number.isFinite(roasNow)) {
    components.push({
      score: clamp(roasNow / Math.max(0.1, targetRoas), 0, 1.4),
      weight: weights.roasVsTarget
    });
  }

  if (Number.isFinite(roasNow) && Number.isFinite(roasBase) && roasBase > 0) {
    components.push({
      score: clamp(roasNow / roasBase, 0, 1.4),
      weight: weights.roasVsBaseline
    });
  }

  if (Number.isFinite(purchaseIcNow)) {
    components.push({
      score: clamp(purchaseIcNow / KEY_METRIC_BOUNDS.purchaseIcFloorRate, 0, 1.4),
      weight: weights.purchaseIc
    });
  }

  if (Number.isFinite(cpmNow) && Number.isFinite(cpmBase) && cpmBase > 0) {
    components.push({
      score: clamp(cpmBase / Math.max(cpmNow, CHART_EPSILON), 0, 1.4),
      weight: weights.cpmPressure
    });
  }

  if (Number.isFinite(ctrNow) && Number.isFinite(ctrBase) && ctrBase > 0) {
    components.push({
      score: clamp(ctrNow / ctrBase, 0, 1.4),
      weight: weights.ctrResilience
    });
  }

  if (!components.length) {
    return 0;
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  const weighted = components.reduce((sum, component) => sum + (component.score * component.weight), 0)
    / Math.max(CHART_EPSILON, totalWeight);

  return clamp(Math.round(weighted * 100), 0, 100);
}

function getHealthState(score) {
  if (!Number.isFinite(score)) return { code: 'insufficient', note: 'Insufficient data' };
  if (score >= HEALTH_RULES.statusCutoffs.strong) return { code: 'strong_good', note: 'Strong' };
  if (score >= HEALTH_RULES.statusCutoffs.healthy) return { code: 'good', note: 'Healthy' };
  if (score >= HEALTH_RULES.statusCutoffs.watch) return { code: 'caution', note: 'Watch' };
  if (score >= HEALTH_RULES.statusCutoffs.weak) return { code: 'bad', note: 'Weak' };
  return { code: 'critical', note: 'Critical' };
}

function resolveDirection(row, targetRoas, healthScore) {
  const roasNow = rowMetric(row, 'roas', 'now');
  const roasBase = rowMetric(row, 'roas', 'baseline');
  const cpmNow = rowMetric(row, 'cpm', 'now');
  const cpmBase = rowMetric(row, 'cpm', 'baseline');

  if (!Number.isFinite(roasNow) || !Number.isFinite(roasBase) || roasBase <= 0) {
    return 'stable';
  }

  const roasDelta = (roasNow - roasBase) / roasBase;
  const cpmDelta = Number.isFinite(cpmNow) && Number.isFinite(cpmBase) && cpmBase > 0
    ? (cpmNow - cpmBase) / cpmBase
    : 0;

  if (roasNow >= targetRoas && roasDelta >= 0.05 && cpmDelta <= 0.1) return 'improving';
  if (healthScore < HEALTH_RULES.statusCutoffs.watch || roasDelta <= -0.12 || cpmDelta >= 0.2) return 'deteriorating';
  if (cpmDelta > 0.1 && roasDelta < 0.04) return 'saturating';
  return 'stable';
}

function rowNeedsAttention(row, targetRoas) {
  const healthScore = toFiniteNumber(row?.healthScore, 0);
  if (healthScore < HEALTH_RULES.statusCutoffs.watch) return true;
  if (row?.direction === 'deteriorating' || row?.direction === 'saturating') return true;

  const riskMetrics = ['roas', 'costAtc', 'purchaseIc'];
  return riskMetrics.some((metricKey) => {
    const now = row?.metrics?.now?.[metricKey];
    const baseline = row?.metrics?.baseline?.[metricKey];
    const status = resolveCellStatus(metricKey, now, baseline, targetRoas);
    return status.code === 'bad' || status.code === 'critical';
  });
}

function directionPillStyle(direction) {
  if (direction === 'improving') return 'bg-[#e9fbf3] text-[#12855f]';
  if (direction === 'deteriorating') return 'bg-[#ffeded] text-[#b42828]';
  if (direction === 'saturating') return 'bg-[#fff5e6] text-[#b46a00]';
  return 'bg-[#eef2ff] text-[#5f6b93]';
}

function toIsoDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysIso(baseIsoDate, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(baseIsoDate || ''))) return null;
  const baseDate = new Date(`${baseIsoDate}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) return null;
  baseDate.setDate(baseDate.getDate() + Number(days || 0));
  return toIsoDateString(baseDate);
}

function buildWindowRange(windowMode, endDate) {
  const windowDays = WINDOW_DAY_LOOKUP[windowMode] || WINDOW_DAY_LOOKUP['14d'];
  const normalizedEndDate = /^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ''))
    ? endDate
    : toIsoDateString();
  const startDate = addDaysIso(normalizedEndDate, -(windowDays - 1)) || normalizedEndDate;
  return { startDate, endDate: normalizedEndDate, windowDays };
}

function parseScopeParts(scopeText) {
  const normalized = String(scopeText || '').trim();
  if (!normalized) {
    return {
      level: 'Scope',
      entity: 'Unknown',
      country: 'ALL'
    };
  }

  const parts = normalized.split('·').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      level: parts[0],
      entity: parts.slice(1).join(' · '),
      country: 'ALL'
    };
  }

  return {
    level: 'Scope',
    entity: normalized,
    country: 'ALL'
  };
}

function resolveDirectionStyle(direction) {
  const normalized = String(direction || '').trim().toLowerCase();
  return DIRECTION_DISPLAY_STYLE[normalized] || DIRECTION_DISPLAY_STYLE.stable;
}

function resolveDirectionFromScore(score) {
  if (!Number.isFinite(score)) return 'insufficient';
  if (score >= HEALTH_RULES.statusCutoffs.strong) return 'improving';
  if (score >= HEALTH_RULES.statusCutoffs.healthy) return 'stable';
  if (score >= HEALTH_RULES.statusCutoffs.watch) return 'saturating';
  return 'deteriorating';
}

function computeEstimatedDailyWaste(spend, impact) {
  const normalizedSpend = Math.max(0, toFiniteNumber(spend, 0));
  const ratio = DRAGGER_IMPACT_WASTE_RATIO[impact] || DRAGGER_IMPACT_WASTE_RATIO.low;
  return round(normalizedSpend * ratio, 2);
}

function deriveCreativeStability(row) {
  const cpmNow = toFiniteNumber(row?.metrics?.now?.cpm, 0);
  const cpmBase = toFiniteNumber(row?.metrics?.baseline?.cpm, cpmNow);
  if (cpmNow <= 0 || cpmBase <= 0) return 50;
  const variance = Math.abs((cpmNow - cpmBase) / cpmBase);
  return clamp(round((1 - variance) * 100, 1), 0, 100);
}

function deriveCreativeIncrementality(row, targetRoas) {
  const roasNow = toFiniteNumber(row?.metrics?.now?.roas, 0);
  const roasBase = toFiniteNumber(row?.metrics?.baseline?.roas, roasNow);
  const purchaseIcNow = toFiniteNumber(row?.metrics?.now?.purchaseIc, 0);
  const purchaseIcBase = toFiniteNumber(row?.metrics?.baseline?.purchaseIc, purchaseIcNow);

  const roasLift = roasBase > 0 ? (roasNow / roasBase) : (roasNow / Math.max(targetRoas, 0.1));
  const purchaseLift = purchaseIcBase > 0 ? (purchaseIcNow / purchaseIcBase) : (purchaseIcNow / KEY_METRIC_BOUNDS.purchaseIcFloorRate);
  const normalized = ((roasLift * 0.7) + (purchaseLift * 0.3)) * 100;
  return clamp(round(normalized, 1), 0, 140);
}

function normalizeStatusValue(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

function isActiveEntityRow(row = {}) {
  const statusCandidates = [
    row?.effectiveStatus,
    row?.effective_status,
    row?.status,
    row?.campaignStatus,
    row?.campaign_effective_status,
    row?.adset_effective_status,
    row?.ad_effective_status
  ]
    .map(normalizeStatusValue)
    .filter(Boolean);

  if (!statusCandidates.length) {
    return true;
  }

  return statusCandidates.some((status) => ACTIVE_STATUS_VALUES.has(status));
}

function titleCaseDirection(value) {
  const text = String(value || 'stable').trim().toLowerCase();
  if (!text) return 'Stable';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getVisibleRows(rows, expandedIds) {
  const rowMap = new Map(rows.map((row) => [row.id, row]));

  const visible = [];
  for (const row of rows) {
    let parentId = row.parentId;
    let allowed = true;

    while (parentId) {
      if (!expandedIds.has(parentId)) {
        allowed = false;
        break;
      }
      parentId = rowMap.get(parentId)?.parentId || null;
    }

    if (allowed) {
      visible.push(row);
    }
  }

  return visible;
}

function listToMapByParent(rows) {
  const map = new Map();
  for (const row of rows) {
    const parentId = row.parentId || '__root__';
    const current = map.get(parentId) || [];
    current.push(row);
    map.set(parentId, current);
  }
  return map;
}

function buildSparklinePoints(values, width = CHART_WIDTH, height = CHART_HEIGHT) {
  if (!Array.isArray(values) || values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(CHART_EPSILON, max - min);
  const stepX = width / (values.length - 1);

  return values
    .map((value, index) => {
      const x = index * stepX;
      const y = height - (((value - min) / span) * height);
      return `${x},${y}`;
    })
    .join(' ');
}

function getMetricDeltaDetails(row, targetRoas) {
  const keys = ['roas', 'cpm', 'ctr', 'purchaseIc', 'costAtc'];

  return keys.map((metricKey) => {
    const now = row?.metrics?.now?.[metricKey];
    const baseline = row?.metrics?.baseline?.[metricKey];

    return {
      metricKey,
      label: METRIC_CONFIG[metricKey].label,
      now,
      baseline,
      delta: formatDeltaPercent(now, baseline),
      status: resolveCellStatus(metricKey, now, baseline, targetRoas)
    };
  });
}

function computeDraggerRows(rows, targetRoas) {
  return rows
    .map((row) => {
      const healthScore = computeHealthScore(row, targetRoas);
      const spend = toFiniteNumber(row?.metrics?.now?.spend);
      const severity = ((100 - healthScore) * 0.7) + (Math.min(spend, 10000) / 10000) * 30;
      const direction = resolveDirection(row, targetRoas, healthScore);
      const issue = direction === 'deteriorating'
        ? 'Lower-funnel efficiency weakened under active spend.'
        : direction === 'saturating'
          ? 'Rising CPM pressure with soft conversion leverage.'
          : 'Relative efficiency is trailing peers.';

      return {
        id: row.id,
        scope: `${getRowType(row)} · ${row.name}`,
        issue,
        impactScore: round(severity, 2)
      };
    })
    .sort((left, right) => right.impactScore - left.impactScore)
    .slice(0, TOP_DRAGGERS_LIMIT);
}

function computeCreativePriorityRows(rows, targetRoas) {
  const adRows = rows.filter((row) => row.level === 'ad');

  const candidateRows = adRows.length ? adRows : rows.filter((row) => row.level !== 'campaign');
  if (!candidateRows.length) return [];

  const maxSpend = Math.max(...candidateRows.map((row) => toFiniteNumber(row?.metrics?.now?.spend)), CHART_EPSILON);

  return candidateRows
    .map((row) => {
      const roas = toFiniteNumber(row?.metrics?.now?.roas);
      const spend = toFiniteNumber(row?.metrics?.now?.spend);
      const purchaseIc = toFiniteNumber(row?.metrics?.now?.purchaseIc);
      const cpmNow = toFiniteNumber(row?.metrics?.now?.cpm);
      const cpmBase = toFiniteNumber(row?.metrics?.baseline?.cpm, cpmNow);

      const efficiencyScore = clamp((roas / Math.max(targetRoas, 0.1)) * 100, 0, 140);
      const volumeScore = clamp((spend / maxSpend) * 100, 0, 100);
      const purchaseScore = clamp((purchaseIc / KEY_METRIC_BOUNDS.purchaseIcFloorRate) * 100, 0, 140);
      const cpmStability = cpmNow > 0 ? clamp((cpmBase / cpmNow) * 100, 0, 130) : 0;

      const composite = (
        (efficiencyScore * 0.45) +
        (volumeScore * 0.3) +
        (purchaseScore * 0.15) +
        (cpmStability * 0.1)
      );

      return {
        id: row.id,
        creative: row.name,
        efficiencyScore: round(efficiencyScore, 1),
        volumeScore: round(volumeScore, 1),
        compositeScore: round(composite, 1)
      };
    })
    .sort((left, right) => right.compositeScore - left.compositeScore)
    .slice(0, TOP_CREATIVES_LIMIT);
}

function buildDeterministicBriefFallback(snapshot, rows, targetRoas) {
  const analysisRoas = toFiniteNumber(snapshot?.summary?.analysis?.rates?.roas, 0);
  const analysisCtr = toFiniteNumber(snapshot?.summary?.analysis?.rates?.ctr, 0);
  const analysisCvr = toFiniteNumber(snapshot?.summary?.analysis?.rates?.cvr, 0);
  const anchorRoas = toFiniteNumber(snapshot?.summary?.anchor?.rates?.roas, 0);
  const deltaVsAnchor = anchorRoas > 0 ? ((analysisRoas - anchorRoas) / anchorRoas) * 100 : 0;

  const computedDraggers = computeDraggerRows(rows, targetRoas);
  const draggers = computedDraggers.map((row) => ({
    scope: row.scope,
    issue: row.issue,
    evidence: `Impact score ${row.impactScore}`,
    impact: row.impactScore >= 70 ? 'high' : row.impactScore >= 45 ? 'medium' : 'low'
  }));

  const priorities = computeCreativePriorityRows(rows, targetRoas).map((row) => ({
    creative: row.creative,
    recommendation: row.compositeScore >= 90 ? 'scale' : row.compositeScore >= 70 ? 'hold' : 'test',
    reason: `Composite score ${row.compositeScore} from efficiency + volume balance.`
  }));

  const toWatch = computedDraggers.slice(0, 4).map((row) => ({
    scope: row.scope,
    signal: row.issue,
    why: `Impact score ${formatNumber(row.impactScore || 0, 2)} from efficiency and spend-weighted deterioration.`,
    recheck: '24h'
  }));

  const toDo = [
    {
      priority: 'P1',
      action: 'Protect spend from deteriorating entities and keep reallocations bounded.',
      guardrail: 'Cap single-day budget edits to 10-15%.'
    },
    {
      priority: 'P2',
      action: 'Promote top-ranked creatives into highest-intent ad sets.',
      guardrail: 'Require two completed days of confirmation before scaling.'
    }
  ];

  return {
    executiveSummary: `Scope delivered ROAS ${formatNumber(analysisRoas, 2)} vs anchor ${formatNumber(anchorRoas, 2)} (${formatNumber(deltaVsAnchor, 1)}%), CTR ${formatNumber(analysisCtr * 100, 2)}%, CVR ${formatNumber(analysisCvr * 100, 2)}%. Prioritize highest-impact draggers first.`,
    draggers,
    creativePriorities: priorities,
    toWatch,
    toDo,
    notes: [
      'This fallback is deterministic and data-bound.',
      'Enable LLM brief generation for richer narrative interpretation.'
    ]
  };
}

function hasBriefShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return BRIEF_REPORT_KEYS.some((key) => key in value);
}

function tryParseSummaryEmbeddedBrief(summaryText) {
  const normalized = String(summaryText || '').trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(normalized);
    return hasBriefShape(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function coerceBriefReport(briefReport) {
  if (!hasBriefShape(briefReport)) return briefReport;
  const parsedSummary = tryParseSummaryEmbeddedBrief(briefReport.executiveSummary);
  if (!parsedSummary) return briefReport;

  const parsedSummaryText = String(parsedSummary.executiveSummary || '').trim();
  const sourceSummaryText = String(briefReport.executiveSummary || '').trim();

  return {
    ...parsedSummary,
    ...briefReport,
    executiveSummary: parsedSummaryText || sourceSummaryText,
    toWatch: Array.isArray(briefReport.toWatch) && briefReport.toWatch.length
      ? briefReport.toWatch
      : parsedSummary.toWatch,
    toDo: Array.isArray(briefReport.toDo) && briefReport.toDo.length
      ? briefReport.toDo
      : parsedSummary.toDo,
    draggers: Array.isArray(briefReport.draggers) && briefReport.draggers.length
      ? briefReport.draggers
      : parsedSummary.draggers,
    creativePriorities: Array.isArray(briefReport.creativePriorities) && briefReport.creativePriorities.length
      ? briefReport.creativePriorities
      : parsedSummary.creativePriorities,
    notes: Array.isArray(briefReport.notes) && briefReport.notes.length
      ? briefReport.notes
      : parsedSummary.notes
  };
}

function isLikelyStructuredBlob(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if ((normalized.startsWith('{') && normalized.endsWith('}')) || (normalized.startsWith('[') && normalized.endsWith(']'))) {
    return true;
  }
  return normalized.includes('"executiveSummary"') || normalized.includes('"toWatch"') || normalized.includes('"toDo"');
}

function sanitizeBriefSummary(value, fallback) {
  const normalized = String(value || '').trim();
  if (!normalized) return String(fallback || '').trim();
  if (isLikelyStructuredBlob(normalized)) return String(fallback || '').trim();
  if (normalized.length > BRIEF_SUMMARY_MAX_CHARS) {
    return `${normalized.slice(0, BRIEF_SUMMARY_MAX_CHARS - 3).trim()}...`;
  }
  return normalized;
}

function normalizeBriefForRender(briefReport, fallbackBrief) {
  const resolvedBrief = coerceBriefReport(briefReport);
  if (!resolvedBrief) return fallbackBrief;

  return {
    executiveSummary: sanitizeBriefSummary(resolvedBrief.executiveSummary, fallbackBrief.executiveSummary) || fallbackBrief.executiveSummary,
    draggers: Array.isArray(resolvedBrief.draggers) && resolvedBrief.draggers.length ? resolvedBrief.draggers : fallbackBrief.draggers,
    creativePriorities: Array.isArray(resolvedBrief.creativePriorities) && resolvedBrief.creativePriorities.length
      ? resolvedBrief.creativePriorities
      : fallbackBrief.creativePriorities,
    toWatch: Array.isArray(resolvedBrief.toWatch) && resolvedBrief.toWatch.length ? resolvedBrief.toWatch : fallbackBrief.toWatch,
    toDo: Array.isArray(resolvedBrief.toDo) && resolvedBrief.toDo.length ? resolvedBrief.toDo : fallbackBrief.toDo,
    notes: Array.isArray(resolvedBrief.notes) && resolvedBrief.notes.length ? resolvedBrief.notes : fallbackBrief.notes
  };
}

function isBriefAlignedWithScope(brief, scope) {
  const briefDate = String(brief?.briefDate || '').trim();
  const scopeEndDate = String(scope?.analysisEndDate || '').trim();
  if (!briefDate || !scopeEndDate) return false;
  return briefDate === scopeEndDate;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function buildBriefScopeFromAnalysis(analysisParams = {}) {
  const normalizedCountry = String(analysisParams.country || 'ALL').trim().toUpperCase() || 'ALL';
  return {
    level: 'campaign',
    entityId: null,
    country: normalizedCountry,
    startDate: analysisParams.startDate || null,
    endDate: analysisParams.endDate || null,
    analysisWindowDays: analysisParams.analysisWindowDays || null,
    selectorLimit: analysisParams.selectorLimit || null
  };
}

function buildGeneratePayload({ storeId, analysisParams, provider, model, reasoningEffort, verbosity }) {
  return {
    store: storeId,
    country: analysisParams.country,
    startDate: analysisParams.startDate || undefined,
    endDate: analysisParams.endDate || undefined,
    analysisWindowDays: analysisParams.analysisWindowDays || undefined,
    selectorLimit: analysisParams.selectorLimit || undefined,
    provider,
    model,
    reasoningEffort,
    verbosity
  };
}

function formatBriefCost(costUsd) {
  const numeric = Number(costUsd);
  if (!Number.isFinite(numeric)) return '$0.000000';
  return `$${numeric.toFixed(6)}`;
}

function resolveBriefGenerationErrorMessage(response, payload) {
  const rawMessage = String(payload?.error || '').trim();
  const code = String(payload?.code || '').trim().toLowerCase();
  const messageLower = rawMessage.toLowerCase();
  const isInsufficientFunds = code === INSUFFICIENT_FUNDS_ERROR_CODE
    || response?.status === 402
    || messageLower.includes('insufficient')
    || messageLower.includes('credits')
    || messageLower.includes('billing')
    || messageLower.includes('payment required');

  if (isInsufficientFunds) {
    return INSUFFICIENT_FUNDS_MESSAGE;
  }

  if (rawMessage) {
    return rawMessage;
  }

  return `Brief generation failed (HTTP ${response?.status || 500})`;
}

export default function CampaignIntelligenceUnifiedSection({
  snapshot,
  analysisParams,
  store,
  targetRoas,
  onSnapshotUpdate,
  onAnalysisParamsChange
}) {
  if (!snapshot || snapshot?.success === false) {
    return (
      <div className="rounded-2xl border border-[#dfe5ff] bg-white p-6">
        <div className="inline-flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading Unified Manager…
        </div>
      </div>
    );
  }

  const hierarchyRows = Array.isArray(snapshot?.hierarchy?.rows) ? snapshot.hierarchy.rows : [];

  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [selectedRowId, setSelectedRowId] = useState('');
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [viewMode, setViewMode] = useState(MOCK_VIEW_OPTIONS[0].value);
  const [windowMode, setWindowMode] = useState(MOCK_WINDOW_OPTIONS[0].value);
  const [triageMode, setTriageMode] = useState(MOCK_TRIAGE_OPTIONS[0].value);
  const [toolbarCountryCode, setToolbarCountryCode] = useState(() => String(analysisParams?.country || 'ALL').toUpperCase());

  const briefMeta = snapshot?.brief || {};
  const [scheduleMode, setScheduleMode] = useState('manual');
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [selectedModel, setSelectedModel] = useState('gpt-5.2');
  const [reasoningEffort, setReasoningEffort] = useState('medium');
  const [verbosity, setVerbosity] = useState('low');

  const [briefBusy, setBriefBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [manualBrief, setManualBrief] = useState(null);

  const timelineCacheRef = useRef(new Map());
  const timelineRequestRef = useRef({ id: 0, controller: null });
  const [entityTimeline, setEntityTimeline] = useState(null);
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [timelineError, setTimelineError] = useState('');

  useEffect(() => {
    setExpandedIds(new Set());
  }, [snapshot?.generatedAt]);

  useEffect(() => {
    if (!displayRows.length) {
      setSelectedRowId('');
      return;
    }

    const exists = displayRows.some((row) => row.id === selectedRowId);
    if (!exists) {
      setSelectedRowId(displayRows[0].id);
    }
  }, [displayRows, selectedRowId]);

  useEffect(() => {
    const settings = briefMeta?.settings;
    if (!settings) return;

    setScheduleMode(settings.scheduleMode || 'manual');
    setSelectedProvider(settings.provider || 'openai');
    setSelectedModel(settings.model || 'gpt-5.2');
    setReasoningEffort(settings.reasoningEffort || 'medium');
    setVerbosity(settings.verbosity || 'low');
  }, [briefMeta]);

  useEffect(() => {
    setToolbarCountryCode(String(analysisParams?.country || 'ALL').toUpperCase());
  }, [analysisParams?.country]);

  useEffect(() => {
    const start = String(analysisParams?.startDate || '').trim();
    const end = String(analysisParams?.endDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return;

    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;

    const diffMs = endDate.getTime() - startDate.getTime();
    const inclusiveDays = Math.floor(diffMs / MILLISECONDS_PER_DAY) + 1;
    if (inclusiveDays === WINDOW_DAY_LOOKUP['7d']) {
      setWindowMode('7d');
    } else if (inclusiveDays === WINDOW_DAY_LOOKUP['14d']) {
      setWindowMode('14d');
    }
  }, [analysisParams?.endDate, analysisParams?.startDate]);

  const modelOptions = useMemo(() => {
    const options = Array.isArray(briefMeta?.modelOptions) ? briefMeta.modelOptions : [];
    return options.filter((option) => option.enabled);
  }, [briefMeta]);

  const providerOptions = useMemo(() => {
    return Array.from(new Set(modelOptions.map((option) => option.provider)));
  }, [modelOptions]);
  const llmAvailable = providerOptions.length > 0;

  useEffect(() => {
    if (!providerOptions.length) return;
    if (!providerOptions.includes(selectedProvider)) {
      setSelectedProvider(providerOptions[0]);
    }
  }, [providerOptions, selectedProvider]);

  const modelOptionsForProvider = useMemo(() => {
    return modelOptions.filter((option) => option.provider === selectedProvider);
  }, [modelOptions, selectedProvider]);

  useEffect(() => {
    if (!modelOptionsForProvider.length) return;
    const exists = modelOptionsForProvider.some((option) => option.model === selectedModel);
    if (!exists) {
      setSelectedModel(modelOptionsForProvider[0].model);
    }
  }, [modelOptionsForProvider, selectedModel]);

  const rowsWithComputed = useMemo(() => {
    return hierarchyRows
      .filter((row) => isActiveEntityRow(row))
      .map((row) => {
        const healthScore = computeHealthScore(row, targetRoas);
        const direction = resolveDirection(row, targetRoas, healthScore);
        return {
          ...row,
          depth: getRowDepth(row),
          type: getRowType(row),
          healthScore,
          direction
        };
      });
  }, [hierarchyRows, targetRoas]);

  const triageFilteredRows = useMemo(() => {
    if (triageMode !== 'attention') return rowsWithComputed;
    return rowsWithComputed.filter((row) => rowNeedsAttention(row, targetRoas));
  }, [rowsWithComputed, triageMode, targetRoas]);

  const rankedCampaignRows = useMemo(() => {
    return triageFilteredRows
      .filter((row) => row.level === 'campaign')
      .slice()
      .sort((left, right) => {
        const rightPurchases = toFiniteNumber(right?.metrics?.now?.purchases, 0);
        const leftPurchases = toFiniteNumber(left?.metrics?.now?.purchases, 0);
        if (rightPurchases !== leftPurchases) return rightPurchases - leftPurchases;
        return toFiniteNumber(right?.metrics?.now?.spend, 0) - toFiniteNumber(left?.metrics?.now?.spend, 0);
      });
  }, [triageFilteredRows]);

  const campaignLimitedRows = useMemo(() => {
    if (showAllCampaigns) return triageFilteredRows;

    const campaignIdSet = new Set(
      rankedCampaignRows
        .slice(0, DEFAULT_VISIBLE_CAMPAIGN_LIMIT)
        .map((row) => String(row?.campaignId || row?.entityId || '').trim())
        .filter(Boolean)
    );

    return triageFilteredRows.filter((row) => {
      const campaignId = String(row?.campaignId || '').trim() || (row.level === 'campaign' ? String(row?.entityId || '').trim() : '');
      if (!campaignId) return false;
      return campaignIdSet.has(campaignId);
    });
  }, [rankedCampaignRows, showAllCampaigns, triageFilteredRows]);

  const displayRows = useMemo(() => {
    const baseRows = campaignLimitedRows;
    if (viewMode !== 'geo_split') return baseRows;
    return baseRows.filter((row) => row.level === 'campaign');
  }, [campaignLimitedRows, viewMode]);

  const visibleRows = useMemo(() => getVisibleRows(displayRows, expandedIds), [displayRows, expandedIds]);

  const childrenByParent = useMemo(() => listToMapByParent(displayRows), [displayRows]);

  const selectedRow = useMemo(() => {
    if (!displayRows.length) return null;
    return displayRows.find((row) => row.id === selectedRowId) || displayRows[0];
  }, [displayRows, selectedRowId]);

  const analysisScope = snapshot?.scope || {};
  const scopeTimelineDaily = useMemo(() => (Array.isArray(snapshot?.timeline?.daily) ? snapshot.timeline.daily : []), [snapshot]);
  const analysisEndDate = snapshot?.scope?.analysisEndDate || analysisParams?.endDate || toIsoDateString();

	  const timelineCacheKey = useMemo(() => {
	    if (!selectedRow?.entityId) return '';
	    return [
	      String(store?.id || analysisScope.store || '').trim(),
	      String(toolbarCountryCode || analysisScope.country || 'ALL').trim(),
	      String(analysisScope.analysisStartDate || '').trim(),
	      String(analysisScope.analysisEndDate || '').trim(),
	      String(selectedRow.level || '').trim(),
	      String(selectedRow.entityId || '').trim()
	    ].join('|');
	  }, [
	    analysisScope.analysisEndDate,
	    analysisScope.analysisStartDate,
	    analysisScope.store,
	    selectedRow?.entityId,
	    selectedRow?.level,
	    store?.id,
	    toolbarCountryCode
	  ]);

  useEffect(() => {
    if (!timelineCacheKey || !store?.id || !selectedRow?.entityId || !selectedRow?.level) {
      setEntityTimeline(null);
      setTimelineError('');
      return;
    }

    const cached = timelineCacheRef.current.get(timelineCacheKey);
    if (cached) {
      setEntityTimeline(cached);
      setTimelineError('');
      return;
    }

    timelineRequestRef.current.id += 1;
    const requestId = timelineRequestRef.current.id;
    if (timelineRequestRef.current.controller) {
      timelineRequestRef.current.controller.abort();
    }
    const controller = new AbortController();
    timelineRequestRef.current.controller = controller;

    setTimelineBusy(true);
    setTimelineError('');
    setEntityTimeline(null);

	    const params = new URLSearchParams();
	    params.set('store', String(store.id));
	    params.set('level', String(selectedRow.level));
	    params.set('entityId', String(selectedRow.entityId));
	    params.set('country', String(toolbarCountryCode || analysisScope.country || 'ALL'));
	    if (analysisScope.analysisStartDate) params.set('startDate', String(analysisScope.analysisStartDate));
	    if (analysisScope.analysisEndDate) params.set('endDate', String(analysisScope.analysisEndDate));

    fetch(`${UNIFIED_TIMELINE_ENDPOINT}?${params.toString()}`, { signal: controller.signal })
      .then((response) => readJsonResponse(response).then((json) => ({ response, json })))
      .then(({ response, json }) => {
        if (timelineRequestRef.current.id !== requestId) return;
        if (!response.ok || !json?.success) {
          throw new Error(json?.error || `Unified timeline fetch failed (HTTP ${response.status})`);
        }

        timelineCacheRef.current.set(timelineCacheKey, json);
        setEntityTimeline(json);
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        if (timelineRequestRef.current.id !== requestId) return;
        setEntityTimeline(null);
        setTimelineError(error?.message || 'Unified timeline fetch failed');
      })
      .finally(() => {
        if (timelineRequestRef.current.id === requestId) {
          setTimelineBusy(false);
        }
      });

    return () => controller.abort();
  }, [
    analysisScope.analysisEndDate,
    analysisScope.analysisStartDate,
    analysisScope.country,
    selectedRow?.entityId,
    selectedRow?.level,
    store?.id,
    timelineCacheKey,
    toolbarCountryCode
  ]);

  const timelineDaily = useMemo(() => {
    const daily = entityTimeline?.timeline?.daily;
    if (Array.isArray(daily) && daily.length) return daily;
    if (timelineBusy) return [];
    return scopeTimelineDaily;
  }, [entityTimeline?.timeline?.daily, scopeTimelineDaily, timelineBusy]);

  const countryOptions = useMemo(() => {
    const selectorRows = Array.isArray(snapshot?.selectors?.countries) ? snapshot.selectors.countries : [];
    const normalizeCountryRow = (row) => ({
      spend: toFiniteNumber(row?.spend, 0),
      conversions: toFiniteNumber(row?.conversions, 0),
      conversionValue: toFiniteNumber(row?.conversionValue, 0),
      addToCart: toFiniteNumber(row?.addToCart, 0),
      checkoutsInitiated: toFiniteNumber(row?.checkoutsInitiated, 0),
      clicks: toFiniteNumber(row?.clicks, 0),
      impressions: toFiniteNumber(row?.impressions, 0),
      cpm: parseNullableNumber(row?.cpm),
      costAtc: parseNullableNumber(row?.costAtc),
      purchaseIc: parseNullableNumber(row?.purchaseIc),
      roas: parseNullableNumber(row?.roas)
    });

    const normalizedRows = selectorRows
      .map((row) => {
        const baseline = row?.baseline || null;
        return {
          code: String(row?.code || '').trim().toUpperCase() || 'ALL',
          ...normalizeCountryRow(row),
          baseline: baseline ? normalizeCountryRow(baseline) : null
        };
      })
      .filter((row) => row.code);

    const uniqueRows = [];
    const seen = new Set();
    for (const row of normalizedRows) {
      if (seen.has(row.code)) continue;
      seen.add(row.code);
      uniqueRows.push({
        ...row,
        label: row.code === 'ALL' ? DEFAULT_COUNTRY_OPTION.label : getCountryDisplayName(row.code),
        flag: toCountryFlag(row.code)
      });
    }

    if (!seen.has('ALL')) {
      uniqueRows.unshift({
        ...DEFAULT_COUNTRY_OPTION,
        spend: 0,
        conversions: 0,
        conversionValue: 0,
        addToCart: 0,
        checkoutsInitiated: 0,
        clicks: 0,
        impressions: 0,
        cpm: null,
        costAtc: null,
        purchaseIc: null,
        roas: null,
        baseline: null,
        flag: ''
      });
    }

    return uniqueRows;
  }, [snapshot?.selectors?.countries]);

  const windowedTimeline = useMemo(() => {
    const { startDate, endDate } = buildWindowRange(windowMode, analysisEndDate);
    return timelineDaily.filter((row) => String(row?.date || '') >= startDate && String(row?.date || '') <= endDate);
  }, [analysisEndDate, timelineDaily, windowMode]);

  const ctrSeries = useMemo(() => windowedTimeline.map((row) => toFiniteNumber(row.ctr) * 100), [windowedTimeline]);
  const reachSeries = useMemo(() => windowedTimeline.map((row) => toFiniteNumber(row.reach)), [windowedTimeline]);
  const purchasesSeries = useMemo(() => windowedTimeline.map((row) => toFiniteNumber(row.conversions)), [windowedTimeline]);
  const spendSeries = useMemo(() => windowedTimeline.map((row) => toFiniteNumber(row.spend)), [windowedTimeline]);
  const healthSeries = useMemo(() => {
    const config = TREND_HEALTH_PROXY_CONFIG;
    return windowedTimeline.map((row) => {
      const roas = toFiniteNumber(row?.roas);
      const cvr = toFiniteNumber(row?.cvr);
      const weighted = (roas * config.roasWeight) + (cvr * config.cvrWeight);
      return clamp(weighted, config.min, config.max);
    });
  }, [windowedTimeline]);

  const metricDeltaDetails = useMemo(() => {
    if (!selectedRow) return [];
    return getMetricDeltaDetails(selectedRow, targetRoas);
  }, [selectedRow, targetRoas]);

  const deterministicBrief = useMemo(() => buildDeterministicBriefFallback(snapshot, rowsWithComputed, targetRoas), [snapshot, rowsWithComputed, targetRoas]);

  const activeBrief = useMemo(() => {
    const latestBrief = isBriefAlignedWithScope(snapshot?.brief?.latest, snapshot?.scope) ? snapshot?.brief?.latest : null;
    if (manualBrief && latestBrief) {
      const manualCreated = new Date(manualBrief.createdAt || 0).getTime();
      const latestCreated = new Date(latestBrief.createdAt || 0).getTime();
      return manualCreated >= latestCreated ? manualBrief : latestBrief;
    }
    return manualBrief || latestBrief || null;
  }, [manualBrief, snapshot?.brief?.latest, snapshot?.scope]);

  const renderedBrief = useMemo(() => {
    return normalizeBriefForRender(activeBrief?.report || null, deterministicBrief);
  }, [activeBrief, deterministicBrief]);

  const draggerRows = useMemo(() => {
    if (Array.isArray(renderedBrief?.draggers)) {
      return renderedBrief.draggers.slice(0, TOP_DRAGGERS_LIMIT);
    }
    return [];
  }, [renderedBrief]);

  const runBadgeText = useMemo(() => {
    const timestampValue = activeBrief?.createdAt || snapshot?.generatedAt || null;
    if (!timestampValue) {
      return 'Manual run';
    }
    const parsed = new Date(timestampValue);
    if (Number.isNaN(parsed.getTime())) {
      return 'Manual run';
    }
    return `Run ${parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${parsed.toLocaleDateString()}`;
  }, [activeBrief?.createdAt, snapshot?.generatedAt]);

  const watchRows = useMemo(() => {
    if (Array.isArray(renderedBrief?.toWatch)) {
      return renderedBrief.toWatch;
    }
    return [];
  }, [renderedBrief]);

  const todoRows = useMemo(() => {
    if (!Array.isArray(renderedBrief?.toDo)) return [];
    return renderedBrief.toDo
      .slice()
      .sort((left, right) => (BRIEF_PRIORITY[left.priority] || 99) - (BRIEF_PRIORITY[right.priority] || 99));
  }, [renderedBrief]);

  const notes = useMemo(() => {
    if (!Array.isArray(renderedBrief?.notes)) return [];
    return renderedBrief.notes.slice(0, BRIEF_NOTES_LIMIT);
  }, [renderedBrief]);

  const windowSummary = useMemo(() => buildWindowRange(windowMode, analysisEndDate), [analysisEndDate, windowMode]);

  const scopeRulesText = useMemo(() => {
    const anchorSource = String(snapshot?.scope?.anchorSource || 'policy').replace(/_/g, ' ');
    return {
      scope: 'active entities only',
      baseline: 'business floor + own baseline + peer benchmark',
      anchorSource
    };
  }, [snapshot?.scope?.anchorSource]);

	  const countryHealthRows = useMemo(() => {
	    const rows = countryOptions
	      .filter((row) => row.code !== 'ALL')
	      .map((row) => {
	        const roas = row.roas ?? safeDivide(row.conversionValue, row.spend);
	        const costAtc = row.costAtc ?? safeDivide(row.spend, row.addToCart);
	        const purchaseIc = row.purchaseIc ?? safeDivide(row.conversions, row.checkoutsInitiated);
	        const ctr = safeDivide(row.clicks, row.impressions);

	        const baseline = row.baseline || null;
	        const baselineRoas = baseline ? (baseline.roas ?? safeDivide(baseline.conversionValue, baseline.spend)) : null;
	        const baselineCostAtc = baseline ? (baseline.costAtc ?? safeDivide(baseline.spend, baseline.addToCart)) : null;
	        const baselinePurchaseIc = baseline ? (baseline.purchaseIc ?? safeDivide(baseline.conversions, baseline.checkoutsInitiated)) : null;
	        const baselineCtr = baseline ? safeDivide(baseline.clicks, baseline.impressions) : null;
	        const baselineCpm = baseline ? (baseline.cpm ?? safeDivide(baseline.spend * 1000, baseline.impressions)) : null;

	        const pseudoRow = {
	          metrics: {
	            now: {
	              roas,
	              costAtc,
	              purchaseIc,
	              ctr,
	              cpm: row.cpm,
	              spend: row.spend
	            },
	            baseline: {
	              roas: baselineRoas,
	              costAtc: baselineCostAtc,
	              purchaseIc: baselinePurchaseIc,
	              ctr: baselineCtr,
	              cpm: baselineCpm
	            }
	          }
	        };

	        const healthScore = computeHealthScore(pseudoRow, targetRoas);
	        const baselineHealthScore = baselineRoas == null && baselineCostAtc == null && baselinePurchaseIc == null && baselineCtr == null && baselineCpm == null
	          ? null
	          : computeHealthScore({
	            metrics: {
	              now: {
	                roas: baselineRoas,
	                costAtc: baselineCostAtc,
	                purchaseIc: baselinePurchaseIc,
	                ctr: baselineCtr,
	                cpm: baselineCpm,
	                spend: baseline?.spend
	              },
	              baseline: {}
	            }
	          }, targetRoas);
	        const direction = resolveDirectionFromScore(healthScore);

	        return {
	          ...row,
	          roas,
	          costAtc,
	          purchaseIc,
	          healthScore,
	          baselineHealthScore,
	          direction
	        };
	      })
	      .sort((left, right) => right.spend - left.spend);

	    return rows.slice(0, MAX_COUNTRY_BOARD_ROWS);
	  }, [countryOptions, targetRoas]);

  const countryRegimeRows = useMemo(() => {
    const baselineStartDate = String(snapshot?.scope?.anchorStartDate || '').trim();
    const baselineEndDate = String(snapshot?.scope?.anchorEndDate || '').trim();
    const analysisStartDate = String(snapshot?.scope?.analysisStartDate || windowSummary.startDate || '').trim();
    const analysisEndDate = String(snapshot?.scope?.analysisEndDate || windowSummary.endDate || '').trim();

    return countryHealthRows
      .filter((row) => row.baseline)
      .slice(0, MAX_REGIME_ROWS)
      .map((row) => {
        const config = COUNTRY_REGIME_CONFIG;
        const baseline = row.baseline;
        const baselineRoas = parseNullableNumber(baseline?.roas);
        const baselineCpm = parseNullableNumber(baseline?.cpm);
        const baselinePurchaseIc = parseNullableNumber(baseline?.purchaseIc);
        const roasDelta = metricDeltaRatio('roas', row.roas, baselineRoas);
        const cpmDelta = metricDeltaRatio('cpm', row.cpm, baselineCpm);
        const purchaseIcDelta = metricDeltaRatio('purchaseIc', row.purchaseIc, baselinePurchaseIc);
        const riskScore = (
          (Number.isFinite(roasDelta) ? Math.max(0, -roasDelta) : 0) * config.roasWeight
          + (Number.isFinite(cpmDelta) ? Math.max(0, -cpmDelta) : 0) * config.cpmWeight
          + (Number.isFinite(purchaseIcDelta) ? Math.max(0, -purchaseIcDelta) : 0) * config.purchaseIcWeight
        );
        const upliftScore = (
          (Number.isFinite(roasDelta) ? Math.max(0, roasDelta) : 0) * config.roasWeight
          + (Number.isFinite(cpmDelta) ? Math.max(0, cpmDelta) : 0) * config.cpmWeight
          + (Number.isFinite(purchaseIcDelta) ? Math.max(0, purchaseIcDelta) : 0) * config.purchaseIcWeight
        );
        const direction = riskScore > upliftScore * config.directionEdgeRatio
          ? 'deteriorating'
          : upliftScore > riskScore * config.directionEdgeRatio
            ? 'improving'
            : 'stable';

        const reasonParts = [];
        if (Number.isFinite(roasDelta) && Math.abs(roasDelta) >= config.materialDeltaRatio) {
          reasonParts.push(`ROAS ${roasDelta >= 0 ? 'up' : 'down'} ${Math.abs(roasDelta * 100).toFixed(1)}%`);
        }
        if (Number.isFinite(cpmDelta) && Math.abs(cpmDelta) >= config.materialDeltaRatio) {
          reasonParts.push(`CPM ${cpmDelta >= 0 ? 'eased' : 'inflated'} ${Math.abs(cpmDelta * 100).toFixed(1)}%`);
        }
        if (Number.isFinite(purchaseIcDelta) && Math.abs(purchaseIcDelta) >= config.materialDeltaRatio) {
          reasonParts.push(`Purchase/IC ${purchaseIcDelta >= 0 ? 'up' : 'down'} ${Math.abs(purchaseIcDelta * 100).toFixed(1)}%`);
        }
        const reason = reasonParts.length ? reasonParts.join('; ') : 'No material shift vs baseline.';

        return {
          code: row.code,
          label: row.label,
          flag: row.flag,
          direction,
          baselineHealthScore: row.baselineHealthScore,
          healthScore: row.healthScore,
          reason,
          baselineWindow: baselineStartDate && baselineEndDate ? `${baselineStartDate} → ${baselineEndDate}` : '',
          analysisWindow: analysisStartDate && analysisEndDate ? `${analysisStartDate} → ${analysisEndDate}` : ''
        };
	      });
	  }, [
	    countryHealthRows,
	    snapshot?.scope?.anchorEndDate,
	    snapshot?.scope?.anchorStartDate,
	    snapshot?.scope?.analysisEndDate,
	    snapshot?.scope?.analysisStartDate,
	    windowSummary.endDate,
	    windowSummary.startDate
	  ]);

  const draggerDetailRows = useMemo(() => {
    const rowIndex = new Map(triageFilteredRows.map((row) => [String(row.name || '').toLowerCase(), row]));

    return draggerRows.map((row, index) => {
      const parsedScope = parseScopeParts(row.scope);
      const rowNameKey = String(parsedScope.entity || '').toLowerCase();
      const matchedRow = rowIndex.get(rowNameKey) || null;
      const impact = String(row.impact || 'medium').toLowerCase();
      const waste = computeEstimatedDailyWaste(matchedRow?.metrics?.now?.spend || 0, impact);
      const confidence = DRAGGER_CONFIDENCE_SCORE[impact] || DRAGGER_CONFIDENCE_SCORE.medium;
      const classLabel = /bleed/i.test(`${row.issue || ''} ${row.scope || ''}`) ? 'bleed' : 'dragger';

      return {
        id: `${row.scope}-${index}`,
        level: parsedScope.level,
        entity: parsedScope.entity,
        country: parsedScope.country,
        classLabel,
        confidence,
        waste,
        reason: `${row.issue}${row.evidence ? ` ${row.evidence}` : ''}`.trim()
      };
    });
  }, [draggerRows, triageFilteredRows]);

  const toWatchDetailRows = useMemo(() => {
    return watchRows.map((row, index) => {
      const parsedScope = parseScopeParts(row.scope);
      const status = /risk|critical|decline|deteriorat/i.test(String(row.signal || '')) ? 'risk' : 'watch';
      return {
        id: `${row.scope}-${index}`,
        level: parsedScope.level,
        entity: parsedScope.entity,
        status,
        signal: String(row.signal || 'No signal').trim(),
        threshold: String(row.triggerThreshold || DEFAULT_TRIGGER_THRESHOLD).trim(),
        recheck: String(row.recheck || DEFAULT_RECHECK_WINDOW).trim()
      };
    });
  }, [watchRows]);

  const toDoDetailRows = useMemo(() => {
    return todoRows.map((row, index) => ({
      id: `${row.priority}-${index}`,
      priority: String(row.priority || 'P3').trim().toUpperCase(),
      level: String(row.level || DEFAULT_ACTION_SCOPE_LEVEL).trim(),
      entity: String(row.entity || DEFAULT_ACTION_SCOPE_NAME).trim(),
      action: String(row.action || '').trim(),
      expectedImpact: String(row.expectedImpact || 'Efficiency stabilization in the next full-day window.').trim(),
      guardrail: String(row.guardrail || 'Keep changes bounded and verify after one full day.').trim()
    }));
  }, [todoRows]);

  const bestForBusinessRows = useMemo(() => {
    const baseRows = triageFilteredRows.filter((row) => row.level === 'ad');
    const rankedRows = (baseRows.length ? baseRows : triageFilteredRows.filter((row) => row.level !== 'campaign'))
      .slice()
      .sort((left, right) => toFiniteNumber(right?.metrics?.now?.spend, 0) - toFiniteNumber(left?.metrics?.now?.spend, 0))
      .slice(0, TOP_CREATIVES_LIMIT * 2);

    const maxSpend = Math.max(...rankedRows.map((row) => toFiniteNumber(row?.metrics?.now?.spend, 0)), CHART_EPSILON);
    const rows = rankedRows.map((row) => {
      const efficiency = clamp((toFiniteNumber(row?.metrics?.now?.roas, 0) / Math.max(targetRoas, 0.1)) * 100, 0, 130);
      const volume = clamp((toFiniteNumber(row?.metrics?.now?.spend, 0) / maxSpend) * 100, 0, 100);
      const stability = deriveCreativeStability(row);
      const incrementality = deriveCreativeIncrementality(row, targetRoas);
      const score = (
        (efficiency * BEST_FOR_BUSINESS_WEIGHTS.efficiency)
        + (volume * BEST_FOR_BUSINESS_WEIGHTS.volume)
        + (stability * BEST_FOR_BUSINESS_WEIGHTS.stability)
        + (incrementality * BEST_FOR_BUSINESS_WEIGHTS.incrementality)
      );

      return {
        id: row.id,
        adName: row.name,
        campaignName: row.campaignName || 'N/A',
        adsetName: row.adsetName || 'N/A',
        efficiency: round(efficiency, 1),
        volume: round(volume, 1),
        stability: round(stability, 1),
        incrementality: round(incrementality, 1),
        score: round(score, 1)
      };
    });

    return rows
      .sort((left, right) => right.score - left.score)
      .slice(0, TOP_CREATIVES_LIMIT);
  }, [targetRoas, triageFilteredRows]);

  const crossEntityInsights = useMemo(() => {
    const insights = [];
    if (bestForBusinessRows.length >= 2) {
      const top = bestForBusinessRows[0];
      const second = bestForBusinessRows[1];
      insights.push(`Top ad leader: ${top.adName} outranks ${second.adName} on combined efficiency and volume.`);
    }
    if (draggerDetailRows.length > 0) {
      const primaryDragger = draggerDetailRows[0];
      insights.push(`Primary dragger: ${primaryDragger.entity} shows a ${primaryDragger.classLabel} pattern with estimated waste ${formatUsd(primaryDragger.waste)}.`);
    }
    if (countryHealthRows.length > 0) {
      const weakestCountry = countryHealthRows.slice().sort((left, right) => left.healthScore - right.healthScore)[0];
      insights.push(`Country pressure point: ${weakestCountry.label} is below the portfolio median health score.`);
    }
    if (watchRows.length > 0) {
      insights.push(`Watchlist concentration: ${watchRows.length} scoped signals currently need follow-up checks.`);
    }
    if (!insights.length) {
      insights.push('No high-confidence cross-entity outliers detected in the selected window.');
    }
    return insights.slice(0, CROSS_ENTITY_INSIGHT_LIMIT);
  }, [bestForBusinessRows, countryHealthRows, draggerDetailRows, watchRows]);

  const rootCauseRows = useMemo(() => {
    return draggerDetailRows.slice(0, 4).map((row, index) => ({
      id: `${row.id}-${index}`,
      scope: `${row.entity}${row.country !== 'ALL' ? ` (${row.country})` : ''}`,
      stage: row.classLabel === 'bleed' ? 'ATC/LPV -> Purchase/IC' : 'LPV/Click -> ATC/LPV',
      evidence: row.reason || 'See watchlist signals',
      fix: row.classLabel === 'bleed'
        ? 'Trim or replace weak creative; keep budget capped until efficiency stabilizes.'
        : 'Keep spend stable and rotate weaker creatives to recover funnel quality.',
      check: 'Re-check after one full day with spend held stable.'
    }));
  }, [draggerDetailRows]);

  const budgetDirectionRows = useMemo(() => {
    return countryHealthRows.slice(0, 3).map((row) => {
      if (row.healthScore >= HEALTH_RULES.statusCutoffs.strong) {
        return `${row.label}: hold to +8% only if Cost/ATC stays within cap for 2 full days.`;
      }
      if (row.healthScore >= HEALTH_RULES.statusCutoffs.watch) {
        return `${row.label}: hold budget; rotate weak ads before scaling.`;
      }
      return `${row.label}: reduce by 10% until funnel quality recovers to baseline band.`;
    });
  }, [countryHealthRows]);

  const tomorrowWatchlistRows = useMemo(() => {
    if (watchRows.length > 0) {
      return watchRows.slice(0, 5).map((row) => `${row.signal} -> ${row.recheck || DEFAULT_RECHECK_WINDOW}.`);
    }
    return [
      'Cost/ATC rising above cap for two full days.',
      'LPV/Click softening while CTR is stable.',
      'Frequency and CPM rising together.'
    ];
  }, [watchRows]);

  const toggleExpand = useCallback((rowId) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const handleCountryChange = useCallback((nextCountryCode) => {
    const normalizedCode = String(nextCountryCode || 'ALL').trim().toUpperCase() || 'ALL';
    setToolbarCountryCode(normalizedCode);
    if (typeof onAnalysisParamsChange === 'function') {
      onAnalysisParamsChange({
        country: normalizedCode
      });
    }
  }, [onAnalysisParamsChange]);

  const handleWindowChange = useCallback((nextWindowMode) => {
    const normalizedWindow = WINDOW_DAY_LOOKUP[nextWindowMode] ? nextWindowMode : MOCK_WINDOW_OPTIONS[0].value;
    setWindowMode(normalizedWindow);

    if (typeof onAnalysisParamsChange !== 'function') return;
    const nextRange = buildWindowRange(normalizedWindow, analysisEndDate);
    onAnalysisParamsChange({
      startDate: nextRange.startDate,
      endDate: nextRange.endDate
    });
  }, [analysisEndDate, onAnalysisParamsChange]);

  const runBriefGeneration = useCallback(async () => {
    if (!store?.id) return;

    setBriefBusy(true);
    setBriefError('');
    setStatusMessage('');

    try {
      const payload = buildGeneratePayload({
        storeId: store.id,
        analysisParams,
        provider: selectedProvider,
        model: selectedModel,
        reasoningEffort,
        verbosity
      });

      const response = await fetch(BRIEF_ENDPOINT_GENERATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await readJsonResponse(response);

      if (!response.ok || !json?.success) {
        throw new Error(resolveBriefGenerationErrorMessage(response, json));
      }

      setManualBrief(json.brief || null);
      if (json.snapshot && typeof onSnapshotUpdate === 'function') {
        onSnapshotUpdate(json.snapshot);
      }

      setStatusMessage(`Brief generated (${json?.brief?.provider || selectedProvider} ${json?.brief?.model || selectedModel}) • Estimated cost ${formatBriefCost(json?.brief?.estimatedCostUsd || 0)}.`);
    } catch (error) {
      setBriefError(error?.message || 'Brief generation failed');
    } finally {
      setBriefBusy(false);
    }
  }, [analysisParams, onSnapshotUpdate, reasoningEffort, selectedModel, selectedProvider, store?.id, verbosity]);

  const saveBriefSettings = useCallback(async () => {
    if (!store?.id) return;

    setSettingsBusy(true);
    setSettingsError('');
    setStatusMessage('');

    try {
      const response = await fetch(BRIEF_ENDPOINT_SETTINGS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: store.id,
          scheduleMode,
          provider: selectedProvider,
          model: selectedModel,
          reasoningEffort,
          verbosity,
          scope: buildBriefScopeFromAnalysis(analysisParams)
        })
      });
      const json = await readJsonResponse(response);

      if (!response.ok || !json?.success) {
        throw new Error(json?.error || `Saving brief settings failed (HTTP ${response.status})`);
      }

      setStatusMessage(
        scheduleMode === 'daily'
          ? 'Daily end-of-day brief is enabled for current scope.'
          : 'Brief mode saved as manual-only.'
      );
    } catch (error) {
      setSettingsError(error?.message || 'Failed to save brief settings');
    } finally {
      setSettingsBusy(false);
    }
  }, [analysisParams, reasoningEffort, scheduleMode, selectedModel, selectedProvider, store?.id, verbosity]);

  const openFullDiagnosis = useCallback(async () => {
    if (!store?.id || briefBusy || settingsBusy) return;
    setStatusMessage('');
    setBriefError('');
    setSettingsError('');

    await saveBriefSettings();
    await runBriefGeneration();
  }, [briefBusy, runBriefGeneration, saveBriefSettings, settingsBusy, store?.id]);

  const scopeHasRows = displayRows.length > 0;
  const campaignCount = rankedCampaignRows.length;
  const campaignsAreLimited = !showAllCampaigns && campaignCount > DEFAULT_VISIBLE_CAMPAIGN_LIMIT;
  const visibleCampaignCount = showAllCampaigns ? campaignCount : Math.min(DEFAULT_VISIBLE_CAMPAIGN_LIMIT, campaignCount);

  return (
    <div className="space-y-3">
      <section
        className="rounded-2xl border bg-white p-4 md:p-[18px]"
        style={{ borderColor: UI_SURFACE_STYLE.cardBorder }}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-[24px] font-semibold text-[#0f172a]" style={{ fontFamily: TYPOGRAPHY_HEADING }}>
              Unified Funnel Health Manager
            </h3>
            <p className="text-[13px] text-[#5d6785] mt-0.5">
              Meta-style hierarchy with funnel-health-only columns and directional triage.
            </p>
          </div>
          <span
            className="inline-flex items-center rounded-full border px-3 py-2 text-xs font-semibold text-[#31407b]"
            style={{ borderColor: '#d5dcff', background: 'linear-gradient(135deg, #f4f6ff, #f6fbff)' }}
          >
            Live Data
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-5 gap-2.5">
          <div className="grid gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.5px] font-bold text-[#6372a8]">View</label>
            <select
              value={viewMode}
              onChange={(event) => setViewMode(event.target.value)}
              className="h-[39px] rounded-[10px] border bg-white px-2.5 text-[13px] font-semibold text-[#1a2754]"
              style={{ borderColor: '#d8defa' }}
            >
              {MOCK_VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.5px] font-bold text-[#6372a8]">Country</label>
            <select
              value={toolbarCountryCode}
              onChange={(event) => handleCountryChange(event.target.value)}
              className="h-[39px] rounded-[10px] border bg-white px-2.5 text-[13px] font-semibold text-[#1a2754]"
              style={{ borderColor: '#d8defa' }}
            >
              {countryOptions.map((option) => (
                <option key={`country-option-${option.code}`} value={option.code}>
                  {option.flag ? `${option.flag} ` : ''}{option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.5px] font-bold text-[#6372a8]">Window</label>
            <select
              value={windowMode}
              onChange={(event) => handleWindowChange(event.target.value)}
              className="h-[39px] rounded-[10px] border bg-white px-2.5 text-[13px] font-semibold text-[#1a2754]"
              style={{ borderColor: '#d8defa' }}
            >
              {MOCK_WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.5px] font-bold text-[#6372a8]">Triage</label>
            <select
              value={triageMode}
              onChange={(event) => setTriageMode(event.target.value)}
              className="h-[39px] rounded-[10px] border bg-white px-2.5 text-[13px] font-semibold text-[#1a2754]"
              style={{ borderColor: '#d8defa' }}
            >
              {MOCK_TRIAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label className="text-[11px] uppercase tracking-[0.5px] font-bold text-[#6372a8]">Action</label>
            <button
              type="button"
              onClick={openFullDiagnosis}
              disabled={!scopeHasRows || !store?.id || !llmAvailable || briefBusy || settingsBusy}
              className="h-[39px] rounded-[10px] border-0 text-[13px] font-semibold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
              style={{ background: 'linear-gradient(90deg, #5b4fff, #1f63ff)' }}
            >
              {briefBusy || settingsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Open Full Diagnosis
            </button>
          </div>
        </div>

        <div
          className="mt-3 rounded-[10px] border border-dashed px-2.5 py-2 text-[11px] text-[#44527f] flex flex-wrap gap-2.5"
          style={{ borderColor: '#cdd6ff', background: '#f8faff' }}
        >
          <span><b className="text-[#24376e]">Cell logic:</b> current value only (no delta coloring)</span>
          <span><b className="text-[#24376e]">Compared against:</b> {scopeRulesText.baseline}</span>
          <span><b className="text-[#24376e]">Key colored cells:</b> ROAS, Cost/ATC, Purchase/IC, Health</span>
          <span><b className="text-[#24376e]">Scope:</b> {scopeRulesText.scope}</span>
          <span><b className="text-[#24376e]">Mode:</b> {scheduleMode === 'daily' ? 'daily end-of-day' : 'manual'} ({scopeRulesText.anchorSource})</span>
          {activeBrief && <span><b className="text-[#24376e]">Cost:</b> {formatBriefCost(activeBrief.estimatedCostUsd || 0)}</span>}
        </div>

        {!llmAvailable && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            LLM provider is not configured. Configure provider keys to enable daily diagnosis generation.
          </div>
        )}
        {statusMessage && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {statusMessage}
          </div>
        )}
        {(briefError || settingsError) && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {briefError || settingsError}
          </div>
        )}
      </section>

      {!scopeHasRows && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          No hierarchy rows are available for the current scope.
        </section>
      )}

      {scopeHasRows && (
        <section className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_360px] gap-3.5">
          <div className="rounded-2xl border bg-white overflow-hidden" style={{ borderColor: UI_SURFACE_STYLE.cardBorder }}>
            <div
              className="flex items-center justify-between gap-2 px-3 py-2 border-b"
              style={{ borderColor: '#eef1ff', background: 'linear-gradient(135deg, #f7f9ff, #fbfcff)' }}
            >
              <div className="text-[12px] font-semibold text-[#1a2754]">
                {showAllCampaigns
                  ? `Showing ${visibleCampaignCount} campaign${visibleCampaignCount === 1 ? '' : 's'}`
                  : `Showing top ${visibleCampaignCount} campaign${visibleCampaignCount === 1 ? '' : 's'} by purchases`}
                {campaignCount ? ` (of ${campaignCount})` : ''}
              </div>
              {(campaignsAreLimited || showAllCampaigns) && (
                <button
                  type="button"
                  onClick={() => setShowAllCampaigns((previous) => !previous)}
                  className="text-[11px] font-bold rounded-full border px-3 py-1"
                  style={{ borderColor: '#d5dcff', color: '#31407b', background: '#fff' }}
	                >
	                  {showAllCampaigns ? `Show top ${DEFAULT_VISIBLE_CAMPAIGN_LIMIT}` : 'Show all'}
	                </button>
	              )}
	            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse" style={{ minWidth: `${TABLE_MIN_WIDTH_PX}px` }}>
                <thead>
                  <tr>
                    <th className="sticky top-0 z-10 py-[11px] px-[10px] text-left text-[11px] uppercase tracking-[0.4px] border-b whitespace-nowrap" style={{ background: '#f7f9ff', color: '#5e6da2', borderColor: UI_SURFACE_STYLE.cardBorder }}>Entity</th>
                    <th className="sticky top-0 z-10 py-[11px] px-[10px] text-left text-[11px] uppercase tracking-[0.4px] border-b whitespace-nowrap" style={{ background: '#f7f9ff', color: '#5e6da2', borderColor: UI_SURFACE_STYLE.cardBorder }}>Spend {windowSummary.windowDays}d</th>
                    {METRIC_KEYS.map((metricKey) => (
                      <th key={`header-${metricKey}`} className="sticky top-0 z-10 py-[11px] px-[10px] text-left text-[11px] uppercase tracking-[0.4px] border-b whitespace-nowrap" style={{ background: '#f7f9ff', color: '#5e6da2', borderColor: UI_SURFACE_STYLE.cardBorder }}>
                        {METRIC_CONFIG[metricKey].label}
                      </th>
                    ))}
                    <th className="sticky top-0 z-10 py-[11px] px-[10px] text-left text-[11px] uppercase tracking-[0.4px] border-b whitespace-nowrap" style={{ background: '#f7f9ff', color: '#5e6da2', borderColor: UI_SURFACE_STYLE.cardBorder }}>Health Score</th>
                    <th className="sticky top-0 z-10 py-[11px] px-[10px] text-left text-[11px] uppercase tracking-[0.4px] border-b whitespace-nowrap" style={{ background: '#f7f9ff', color: '#5e6da2', borderColor: UI_SURFACE_STYLE.cardBorder }}>Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const isSelected = selectedRow?.id === row.id;
                    const childRows = childrenByParent.get(row.id) || [];
                    const hasChildren = childRows.length > 0;
                    const healthState = getHealthState(row.healthScore);
                    const healthBarGradient = row.healthScore >= HEALTH_RULES.statusCutoffs.healthy
                      ? 'linear-gradient(90deg,#06b37d,#31d098)'
                      : row.healthScore >= HEALTH_RULES.statusCutoffs.watch
                        ? 'linear-gradient(90deg,#f6b226,#ffcf65)'
                        : 'linear-gradient(90deg,#f05353,#ff7b7b)';

                    return (
                      <tr
                        key={row.id}
                        className="cursor-pointer border-b"
                        style={{
                          borderColor: '#eef1ff',
                          background: isSelected ? '#f2f5ff' : 'transparent'
                        }}
                        onClick={() => setSelectedRowId(row.id)}
                      >
                        <td className="py-2 px-[10px] min-w-[260px]">
                          <div className="flex items-center gap-2" style={{ marginLeft: `${row.depth * ROW_DEPTH_OFFSET_PX}px` }}>
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleExpand(row.id);
                                }}
                                className="h-[18px] w-[18px] rounded-[4px] border text-[11px] leading-[15px] inline-flex items-center justify-center"
                                style={{ borderColor: '#d0d7f7', color: '#4964ca', background: '#fff' }}
                              >
                                {expandedIds.has(row.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </button>
                            ) : (
                              <span className="inline-block w-[18px]" />
                            )}
                            <div>
                              <div className="text-[13px] font-semibold text-[#1a2754] max-w-[250px] truncate">{row.name}</div>
                              <div className="text-[10px] uppercase tracking-[0.4px] font-bold text-[#6f7fb6]">{row.type}</div>
                            </div>
                          </div>
                        </td>

                        <td className="py-2 px-[10px] text-[12px] font-semibold text-[#1a2754]">{formatUsd(row?.metrics?.now?.spend)}</td>

                        {METRIC_KEYS.map((metricKey) => {
                          const now = row?.metrics?.now?.[metricKey];
                          const baseline = row?.metrics?.baseline?.[metricKey];
                          const computedState = resolveCellStatus(metricKey, now, baseline, targetRoas);
                          const visibleStateCode = KEY_COLORED_METRICS.has(metricKey) ? computedState.code : 'insufficient';
                          const visibleNote = KEY_COLORED_METRICS.has(metricKey) ? computedState.note : 'Current';
                          return (
                            <td key={`${row.id}-${metricKey}`} className="py-1.5 px-2">
                              <div className={`min-w-[96px] rounded-[10px] border px-2 py-1.5 ${CELL_STATUS_STYLE[visibleStateCode]}`}>
                                <div className="text-[12px] font-bold leading-4">{formatMetricValue(metricKey, now)}</div>
                                <div className="text-[10px] mt-0.5 font-semibold opacity-90">{visibleNote}</div>
                              </div>
                            </td>
                          );
                        })}

                        <td className="py-1.5 px-2">
                          <div className={`min-w-[96px] rounded-[10px] border px-2 py-1.5 ${CELL_STATUS_STYLE[healthState.code]}`}>
                            <div className="text-[12px] font-bold leading-4 text-[#1a2754]">{row.healthScore}</div>
                            <div className="mt-1 w-[96px] h-[7px] rounded-full bg-[#e7ebff] overflow-hidden">
                              <span className="block h-full rounded-full" style={{ width: `${clamp(row.healthScore, 0, 100)}%`, background: healthBarGradient }} />
                            </div>
                          </div>
                        </td>

                        <td className="py-2 px-[10px]">
                          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.3px] ${directionPillStyle(row.direction)}`}>
                            {row.direction}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-2xl border bg-white p-3.5 grid gap-3" style={{ borderColor: UI_SURFACE_STYLE.cardBorder }}>
            <div>
              <h4 className="text-[18px] font-semibold text-[#0f172a]" style={{ fontFamily: TYPOGRAPHY_HEADING }}>
                {selectedRow ? selectedRow.name : 'Select a row'}
              </h4>
	              <p className="mt-0.5 text-[12px] text-[#5d6785]">
	                {selectedRow ? `${selectedRow.type} | Health ${selectedRow.healthScore}` : 'Right panel explains exactly what changed first.'}
	              </p>
	              {timelineBusy && (
	                <div className="mt-1 text-[11px] text-[#5d6785] inline-flex items-center gap-2">
	                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
	                  Loading row timeline…
	                </div>
	              )}
	              {!timelineBusy && timelineError && (
	                <div className="mt-1 text-[11px] text-[#b42828]">
	                  {timelineError}. Showing scope timeline as fallback.
	                </div>
	              )}
	            </div>

            <section className="rounded-xl border p-2.5" style={{ borderColor: '#e4e8ff', background: 'linear-gradient(165deg, #fbfcff, #f6f8ff)' }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[12px] font-bold text-[#1b2a61]">Top Drivers</div>
                {selectedRow && (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.3px] ${directionPillStyle(selectedRow.direction)}`}>
                    {titleCaseDirection(selectedRow.direction)}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {selectedRow && metricDeltaDetails.slice(0, DRIVER_SIGNAL_LIMIT).map((item) => (
                  <div key={`${selectedRow.id}-driver-${item.metricKey}`} className="flex items-start justify-between gap-2 text-[12px] py-0.5">
                    <div>
                      <div className="font-semibold text-[#1b2a61]">{item.label}</div>
                      <div className="text-[#5d6785]">Baseline {formatMetricValue(item.metricKey, item.baseline)} {' -> '} Current {formatMetricValue(item.metricKey, item.now)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-[#1b2a61]">{item.delta}</div>
                      <div className="text-[10px] text-[#5d6785]">{item.status.note}</div>
                    </div>
                  </div>
                ))}
                {!selectedRow && <div className="text-[12px] text-[#5d6785]">No row selected.</div>}
              </div>
            </section>

            <section className="rounded-[10px] border p-2" style={{ borderColor: '#e2e7ff', background: '#fff' }}>
              <div className="text-[12px] font-bold text-[#1b2a61]">Purchases ({windowSummary.windowDays}d)</div>
              <svg viewBox={`0 0 ${PANEL_CHART_WIDTH} ${PANEL_CHART_HEIGHT}`} className="w-full h-[82px] mt-1">
                <polyline points={buildSparklinePoints(purchasesSeries, PANEL_CHART_WIDTH, PANEL_CHART_HEIGHT)} fill="none" stroke="#1f63ff" strokeWidth="2" />
              </svg>

              <div className="text-[12px] font-bold text-[#1b2a61] mt-2">Spend ({windowSummary.windowDays}d)</div>
              <svg viewBox={`0 0 ${PANEL_CHART_WIDTH} ${PANEL_CHART_HEIGHT}`} className="w-full h-[82px] mt-1">
                <polyline points={buildSparklinePoints(spendSeries, PANEL_CHART_WIDTH, PANEL_CHART_HEIGHT)} fill="none" stroke="#5b4fff" strokeWidth="2" />
              </svg>

              <div className="text-[12px] font-bold text-[#1b2a61] mt-2">Health ({windowSummary.windowDays}d)</div>
              <svg viewBox={`0 0 ${PANEL_CHART_WIDTH} ${PANEL_CHART_HEIGHT}`} className="w-full h-[82px] mt-1">
                <polyline points={buildSparklinePoints(healthSeries, PANEL_CHART_WIDTH, PANEL_CHART_HEIGHT)} fill="none" stroke="#0f9d7a" strokeWidth="2" />
              </svg>
            </section>

            <section className="rounded-[10px] border p-2" style={{ borderColor: '#e2e7ff', background: '#fff' }}>
              <div className="text-[12px] font-bold text-[#1b2a61]">CTR ({windowSummary.windowDays}d)</div>
              <svg viewBox={`0 0 ${PANEL_CHART_WIDTH} ${PANEL_CHART_HEIGHT}`} className="w-full h-[82px] mt-1">
                <polyline points={buildSparklinePoints(ctrSeries, PANEL_CHART_WIDTH, PANEL_CHART_HEIGHT)} fill="none" stroke="#1f63ff" strokeWidth="2" />
              </svg>
              <div className="flex flex-wrap gap-2 text-[11px] text-[#5f6e98]">
                <span><i className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: '#1f63ff' }} />CTR</span>
              </div>

              <div className="text-[12px] font-bold text-[#1b2a61] mt-2">Unique Reach ({windowSummary.windowDays}d)</div>
              <svg viewBox={`0 0 ${PANEL_CHART_WIDTH} ${PANEL_CHART_HEIGHT}`} className="w-full h-[82px] mt-1">
                <polyline points={buildSparklinePoints(reachSeries, PANEL_CHART_WIDTH, PANEL_CHART_HEIGHT)} fill="none" stroke="#7c3aed" strokeWidth="2" />
              </svg>
              <div className="flex flex-wrap gap-2 text-[11px] text-[#5f6e98]">
                <span><i className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: '#7c3aed' }} />Unique Reach</span>
              </div>
            </section>

            <section className="rounded-xl border p-2.5" style={{ borderColor: '#e4e8ff', background: 'linear-gradient(165deg, #fbfcff, #f6f8ff)' }}>
              <div className="text-[12px] font-bold text-[#1b2a61]">Immediate Direction</div>
              <div className="mt-1 text-[12px] text-[#5d6785]">
                {selectedRow
                  ? `${titleCaseDirection(selectedRow.direction)} signal on ${selectedRow.type}. Focus on the top drivers above and re-check after one full-day cycle.`
                  : 'Click any campaign, ad set, or ad to load a concise health narrative.'}
              </div>
            </section>
          </aside>
        </section>
      )}

      <section className="rounded-2xl border border-[#dfe5ff] bg-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-[20px] font-semibold text-slate-900" style={{ fontFamily: TYPOGRAPHY_HEADING }}>
            Daily AI Audit Result
          </h3>
          <span className="inline-flex items-center rounded-full border border-[#d5dcff] px-3 py-1 text-xs font-semibold text-[#31407b]" style={{ background: 'linear-gradient(135deg, #f4f6ff, #f6fbff)' }}>
            {runBadgeText}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Executive Summary</h4>
            <p className="mt-2 text-[13px] leading-relaxed text-[#243463]">{renderedBrief.executiveSummary}</p>
          </article>

	          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3">
	            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Country Shifts (vs baseline window)</h4>
	            <ul className="mt-2 space-y-1.5 text-[12px] text-[#243463]">
		              {countryRegimeRows.map((row) => (
		                <li key={`regime-${row.code}`}>
		                  <b>{row.flag ? `${row.flag} ` : ''}{row.label}:</b> {titleCaseDirection(row.direction)} ({row.baselineHealthScore} → {row.healthScore})
		                  {(row.baselineWindow && row.analysisWindow) ? ` · ${row.baselineWindow} vs ${row.analysisWindow}` : ''}
		                  {row.reason ? ` · ${row.reason}` : ''}
		                </li>
		              ))}
	              {countryRegimeRows.length === 0 && <li>Insufficient country-level regime evidence in this scope.</li>}
	            </ul>
	          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3 xl:col-span-2">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Country Health Board</h4>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12px] mt-1">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Country</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Spend</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">ROAS</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Cost/ATC</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Health</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {countryHealthRows.map((row) => (
                    <tr key={`country-health-${row.code}`}>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.flag ? `${row.flag} ` : ''}{row.label}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{formatUsd(row.spend)}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{formatRatio(row.roas, 2)}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{formatUsd(row.costAtc)}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${resolveDirectionStyle(resolveDirectionFromScore(row.healthScore))}`}>
                          {row.healthScore}
                        </span>
                      </td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${resolveDirectionStyle(row.direction)}`}>
                          {row.direction}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {countryHealthRows.length === 0 && (
                    <tr>
                      <td className="py-2 px-1.5 border-b border-[#ebefff] text-[#5d6785]" colSpan={6}>No country board data available for this scope.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3 xl:col-span-2">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Top Draggers & Bleeds</h4>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12px] mt-1">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Level</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Entity</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Country</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Class</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Conf.</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Est. Daily Waste</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {draggerDetailRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.level}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.entity}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.country}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${row.classLabel === 'bleed' ? resolveDirectionStyle('deteriorating') : resolveDirectionStyle('saturating')}`}>
                          {row.classLabel}
                        </span>
                      </td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.confidence}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{formatUsd(row.waste)}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.reason}</td>
                    </tr>
                  ))}
                  {draggerDetailRows.length === 0 && (
                    <tr>
                      <td className="py-2 px-1.5 border-b border-[#ebefff] text-[#5d6785]" colSpan={7}>No high-confidence draggers detected in this window.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3 xl:col-span-2">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">To Watch (All Campaigns + Ad Sets Audited)</h4>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12px] mt-1">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Level</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Entity</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Status</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Primary Risk Signal</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Trigger Threshold</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Re-check</th>
                  </tr>
                </thead>
                <tbody>
                  {toWatchDetailRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.level}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.entity}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${resolveDirectionStyle(row.status === 'risk' ? 'deteriorating' : 'saturating')}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.signal}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.threshold}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.recheck}</td>
                    </tr>
                  ))}
                  {toWatchDetailRows.length === 0 && (
                    <tr>
                      <td className="py-2 px-1.5 border-b border-[#ebefff] text-[#5d6785]" colSpan={6}>No watchlist entries for this run.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3 xl:col-span-2">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">To Do (Prioritized Actions by Campaign/Ad Set)</h4>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12px] mt-1">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Priority</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Level</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Entity</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Action</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Expected Impact</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Guardrail</th>
                  </tr>
                </thead>
                <tbody>
                  {toDoDetailRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.priority}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.level}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.entity}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.action}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.expectedImpact}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.guardrail}</td>
                    </tr>
                  ))}
                  {toDoDetailRows.length === 0 && (
                    <tr>
                      <td className="py-2 px-1.5 border-b border-[#ebefff] text-[#5d6785]" colSpan={6}>No prioritized action items in this run.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3 xl:col-span-2">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Top Ads - Best for Business (Efficiency + Volume, Rigorous)</h4>
            <p className="text-[13px] text-[#243463] leading-relaxed mt-1">
              Score formula: <b>Best for Business = 100 * (0.45*Efficiency + 0.30*Volume + 0.15*Stability + 0.10*Incrementality)</b>.
              Efficiency and volume are weighted strongest to keep choices commercially grounded.
            </p>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12px] mt-1">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Rank</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Ad</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Campaign / Ad Set</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Efficiency</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Volume</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Stability</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Incrementality</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Best for Business</th>
                  </tr>
                </thead>
                <tbody>
                  {bestForBusinessRows.map((row, index) => (
                    <tr key={row.id}>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{index + 1}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.adName}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.campaignName} / {row.adsetName}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{formatNumber(row.efficiency, 1)}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{formatNumber(row.volume, 1)}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{formatNumber(row.stability, 1)}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{formatNumber(row.incrementality, 1)}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${resolveDirectionStyle(row.score >= 75 ? 'improving' : row.score >= 55 ? 'stable' : 'deteriorating')}`}>
                          {formatNumber(row.score, 1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {bestForBusinessRows.length === 0 && (
                    <tr>
                      <td className="py-2 px-1.5 border-b border-[#ebefff] text-[#5d6785]" colSpan={8}>No ad-level records available in this scope.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3 xl:col-span-2">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Sharp Cross-Entity Insights (Ad vs Ad, Ad Set vs Ad Set, Cross-Campaign)</h4>
            <ul className="mt-2 space-y-1.5 text-[12px] text-[#243463]">
              {crossEntityInsights.map((insight, index) => (
                <li key={`cross-entity-${index}`}>{insight}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3 xl:col-span-2">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Underperforming Campaign/Country Root Cause and Fixable Funnel Step</h4>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-[12px] mt-1">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Scope</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Root Drag Stage</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Evidence</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Fix Suggestion</th>
                    <th className="text-left py-2 px-1.5 border-b border-[#ebefff] text-[10px] uppercase tracking-[0.4px] text-[#5d6ca2]">Success Check (24-48h)</th>
                  </tr>
                </thead>
                <tbody>
                  {rootCauseRows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.scope}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.stage}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.evidence}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.fix}</td>
                      <td className="py-2 px-1.5 border-b border-[#ebefff]">{row.check}</td>
                    </tr>
                  ))}
                  {rootCauseRows.length === 0 && (
                    <tr>
                      <td className="py-2 px-1.5 border-b border-[#ebefff] text-[#5d6785]" colSpan={5}>No root-cause candidates found in this run.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Budget Direction (Next 24h)</h4>
            <ul className="mt-2 space-y-1.5 text-[12px] text-[#243463]">
              {budgetDirectionRows.map((line, index) => (
                <li key={`budget-direction-${index}`}>{line}</li>
              ))}
            </ul>
          </article>

          <article className="rounded-xl border border-[#e3e8ff] bg-[linear-gradient(160deg,#fcfdff,#f8faff)] p-3">
            <h4 className="text-[13px] uppercase tracking-[0.4px] text-[#5e6da2] font-semibold">Tomorrow Watchlist</h4>
            <ul className="mt-2 space-y-1.5 text-[12px] text-[#243463]">
              {tomorrowWatchlistRows.map((line, index) => (
                <li key={`tomorrow-watch-${index}`}>{line}</li>
              ))}
              {notes.map((note, index) => (
                <li key={`run-note-${index}`}>{note}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}
