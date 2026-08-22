import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Brain,
  ChevronDown,
  ChevronUp,
  Gauge,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingDown,
  TrendingUp
} from 'lucide-react';
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import CampaignIntelligenceUnifiedSection from './CampaignIntelligenceUnifiedSection';

const API_ENDPOINT = '/api/campaign-intelligence/snapshot';
const UNIFIED_API_ENDPOINT = '/api/campaign-intelligence/unified-snapshot';
const DEFAULT_ANCHOR_DAYS = 21;
const DEFAULT_TARGET_ROAS = 4;
const DEFAULT_TARGET_HORIZON_DAYS = 7;
const ALL_COUNTRIES_CODE = 'ALL';
const REGIONAL_INDICATOR_OFFSET = 127397;
const SIGNAL_NEAR_THRESHOLD_RATIO = 0.6;
const SIGNAL_ZERO_BASELINE_EPSILON = 1e-9;
const SIGNAL_CONTRIBUTION_DECIMALS = 2;
const ANALYSIS_REQUEST_DEBOUNCE_MS = 250;
const TODAY_REFRESH_INTERVAL_MS = 60 * 1000;
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60 * 1000;
const DASHBOARD_DAY_UTC_OFFSET_HOURS = 5;
const DASHBOARD_DAY_UTC_OFFSET_MINUTES = DASHBOARD_DAY_UTC_OFFSET_HOURS * MINUTES_PER_HOUR;

const PRESET_OPTIONS = [
  { id: 'conservative', label: 'Conservative (Recommended)' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'aggressive', label: 'Aggressive' }
];

const REGION_DISPLAY_NAMES = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

const SHIFT_INTENT_STYLES = {
  strong_improvement: 'bg-emerald-700 text-white',
  improvement: 'bg-emerald-500/90 text-white',
  slight_improvement: 'bg-emerald-100 text-emerald-800',
  neutral: 'bg-slate-100 text-slate-700',
  slight_decline: 'bg-orange-100 text-orange-800',
  decline: 'bg-red-500/90 text-white',
  strong_decline: 'bg-red-800 text-white',
  info: 'bg-indigo-100 text-indigo-700'
};

const SIGNAL_DIRECTION_BY_KEY = Object.freeze({
  cpm: 'lower_better',
  cvr: 'higher_better',
  lpvRate: 'higher_better',
  ordersPerSpend: 'higher_better'
});

const SIGNAL_METRIC_LABELS = Object.freeze({
  cpm: 'CPM (USD)',
  cvr: 'CVR',
  lpvRate: 'LPV rate',
  ordersPerSpend: 'Orders per spend'
});

const SIGNAL_STATUS_STYLES = Object.freeze({
  triggered: 'bg-red-100 text-red-700 border-red-200',
  near_threshold: 'bg-amber-100 text-amber-700 border-amber-200',
  not_triggered: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  insufficient_baseline: 'bg-slate-100 text-slate-700 border-slate-200'
});

const MODEL_CARD_META = {
  mature_sentinel: {
    icon: ShieldCheck,
    title: 'Mature Campaign Sentinel'
  },
  headroom_model: {
    icon: Gauge,
    title: 'Headroom Model'
  },
  launch_judge: {
    icon: Target,
    title: 'Launch Judge'
  }
};

const CAMPAIGN_INTEL_VIEW = Object.freeze({
  modelConsole: 'model_console',
  unifiedManager: 'unified_manager'
});
const ANALYSIS_PARAM_KEYS = Object.freeze(new Set([
  'level',
  'entityId',
  'country',
  'startDate',
  'endDate',
  'anchorDays',
  'anchorStartDate',
  'anchorEndDate',
  'sentinelPreset',
  'headroomPreset',
  'launchPreset',
  'launchMinDays',
  'launchMaxDays',
  'targetRoas',
  'targetCpa',
  'targetHorizonDays'
]));

const UNIFIED_PARAM_KEYS = Object.freeze(new Set([
  'country',
  'startDate',
  'endDate',
  'analysisWindowDays',
  'selectorLimit'
]));

function getDashboardDateString(date = new Date()) {
  const dashboardMs = date.getTime() + (DASHBOARD_DAY_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  return new Date(dashboardMs).toISOString().split('T')[0];
}

function formatPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00%';
  return `${(num * 100).toFixed(digits)}%`;
}

function formatDeltaPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00%';
  const signed = num >= 0 ? '+' : '';
  return `${signed}${num.toFixed(digits)}%`;
}

function formatNumber(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function getStoreCurrency(store) {
  if (!store?.currency) return 'USD';
  return store.currency;
}

function formatMoney(value, store) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  const currency = getStoreCurrency(store);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    }).format(num);
  } catch (_error) {
    return formatNumber(num, 2);
  }
}

function formatUsdMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '$0.00';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(num);
}

function countryCodeToFlag(countryCode) {
  const normalized = String(countryCode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '';
  const first = normalized.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET;
  const second = normalized.charCodeAt(1) + REGIONAL_INDICATOR_OFFSET;
  return String.fromCodePoint(first, second);
}

function formatCountryLabel(countryCode) {
  const normalized = String(countryCode || '').trim().toUpperCase();
  if (!normalized) return 'Unknown';
  if (normalized === ALL_COUNTRIES_CODE) return '🌐 All Countries';

  const fullName = REGION_DISPLAY_NAMES?.of(normalized) || normalized;
  const flag = countryCodeToFlag(normalized);
  return flag ? `${flag} ${fullName} (${normalized})` : `${fullName} (${normalized})`;
}

function formatSignalMetricValue(signal, value) {
  if (signal?.key === 'cpm') {
    return formatUsdMoney(value);
  }
  return formatPercent(value, 2);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function getListKey(prefix, value, index) {
  if (typeof value === 'string' && value.trim()) {
    return `${prefix}-${value.trim()}-${index}`;
  }
  if (value && typeof value === 'object') {
    if (value.id) return `${prefix}-${value.id}-${index}`;
    if (value.key) return `${prefix}-${value.key}-${index}`;
    if (value.code) return `${prefix}-${value.code}-${index}`;
    if (value.date) return `${prefix}-${value.date}-${index}`;
  }
  return `${prefix}-${index}`;
}

function getSignalDirection(signal) {
  return SIGNAL_DIRECTION_BY_KEY[signal?.key] || 'higher_better';
}

function getSignalState(signal) {
  const baseline = Number(signal?.baselineValue) || 0;
  const deltaPercent = Number(signal?.deltaPercent) || 0;
  const thresholdPercent = Math.abs(Number(signal?.thresholdPercent) || 0);
  const direction = getSignalDirection(signal);

  if (Math.abs(baseline) <= SIGNAL_ZERO_BASELINE_EPSILON) {
    return {
      code: 'insufficient_baseline',
      label: 'Insufficient baseline',
      detail: 'Anchor baseline unavailable in selected scope/window.'
    };
  }

  const adversePercent = direction === 'lower_better'
    ? Math.max(deltaPercent, 0)
    : Math.max(-deltaPercent, 0);
  const thresholdHit = thresholdPercent > 0 && adversePercent >= thresholdPercent;
  const nearThreshold = thresholdPercent > 0
    && adversePercent > 0
    && adversePercent >= (thresholdPercent * SIGNAL_NEAR_THRESHOLD_RATIO);

  if (thresholdHit) {
    return {
      code: 'triggered',
      label: 'Triggered',
      detail: 'Alert condition met for this fixed signal.'
    };
  }

  if (nearThreshold) {
    return {
      code: 'near_threshold',
      label: 'Near threshold',
      detail: 'Moving toward alert threshold; monitor closely.'
    };
  }

  if (adversePercent <= 0) {
    return {
      code: 'not_triggered',
      label: 'No risk signal',
      detail: 'Direction is favorable vs anchor baseline.'
    };
  }

  return {
    code: 'not_triggered',
    label: 'Not triggered',
    detail: 'Signal is within acceptable threshold range.'
  };
}

function getSignalTriggerText(signal) {
  const baseline = Number(signal?.baselineValue) || 0;
  const thresholdPercent = Math.abs(Number(signal?.thresholdPercent) || 0);
  const thresholdRatio = thresholdPercent / 100;
  const direction = getSignalDirection(signal);
  const metricLabel = SIGNAL_METRIC_LABELS[signal?.key] || signal?.label || 'Signal';

  if (Math.abs(baseline) <= SIGNAL_ZERO_BASELINE_EPSILON) {
    return 'Trigger rule unavailable because anchor baseline is zero in this scope/window.';
  }

  const boundaryValue = direction === 'lower_better'
    ? baseline * (1 + thresholdRatio)
    : baseline * (1 - thresholdRatio);
  const comparator = direction === 'lower_better' ? '>=' : '<=';

  return `Triggers when ${metricLabel} ${comparator} ${formatSignalMetricValue(signal, boundaryValue)}.`;
}

function getSignalDisplayLabel(signal) {
  const fallback = String(signal?.label || 'Signal').trim() || 'Signal';
  const baseline = Number(signal?.baselineValue) || 0;
  const current = Number(signal?.currentValue) || 0;
  if (Math.abs(baseline) <= SIGNAL_ZERO_BASELINE_EPSILON) {
    return fallback;
  }

  const direction = getSignalDirection(signal);
  const improved = direction === 'lower_better' ? current < baseline : current > baseline;
  if (!improved) return fallback;

  if (signal?.key === 'cpm') return 'CPM improvement';
  if (signal?.key === 'cvr') return 'CVR improvement';
  if (signal?.key === 'lpvRate') return 'Funnel quality improvement';
  if (signal?.key === 'ordersPerSpend') return 'Orders per spend improvement';
  return fallback;
}

function formatSignalSource(source) {
  return String(source || '').replace(/_/g, ' ');
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

async function executeApiRequest({
  requestRef,
  setLoading,
  setError,
  setData,
  endpoint,
  params,
  failureLabel
}) {
  requestRef.current.id += 1;
  const requestId = requestRef.current.id;
  if (requestRef.current.controller) {
    requestRef.current.controller.abort();
  }

  const controller = new AbortController();
  requestRef.current.controller = controller;

  setLoading(true);
  setError('');

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`, {
      signal: controller.signal
    });
    const json = await readJsonResponse(response);

    if (!response.ok || !json?.success) {
      throw new Error(json?.error || `${failureLabel} (HTTP ${response.status})`);
    }

    if (requestRef.current.id !== requestId) return;
    setData(json);
  } catch (loadError) {
    if (loadError?.name === 'AbortError') {
      return;
    }
    if (requestRef.current.id !== requestId) return;
    setData(null);
    setError(loadError?.message || failureLabel);
  } finally {
    if (requestRef.current.id === requestId) {
      setLoading(false);
    }
  }
}

function MetricChartCard({
  title,
  subtitle,
  data,
  valueKey,
  smoothedKey,
  lineColor,
  formatter,
  yAxisFormatter,
  markers = []
}) {
  return (
    <div className="rounded-2xl border border-indigo-100 bg-white shadow-sm p-5">
      <div className="mb-4">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2ff" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={yAxisFormatter} />
            <Tooltip
              formatter={(value, name) => [formatter(value), name === smoothedKey ? 'Smoothed' : 'Raw']}
              labelFormatter={(value) => `Date: ${value}`}
            />
            <Line
              type="monotone"
              dataKey={valueKey}
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              name="raw"
            />
            <Line
              type="monotone"
              dataKey={smoothedKey}
              stroke="#312e81"
              strokeDasharray="5 4"
              strokeWidth={2}
              dot={false}
              name="smoothed"
            />
            {markers.map((marker, index) => (
              <ReferenceDot
                key={getListKey('budget-marker', marker, index)}
                x={marker.date}
                y={marker.value}
                r={4.5}
                fill="#ef4444"
                stroke="#ffffff"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
              >
                <Label value={marker.deltaLabel} position="top" fontSize={10} fill="#b91c1c" />
              </ReferenceDot>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {markers.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {markers.map((marker, index) => (
            <div key={getListKey('budget-marker-legend', marker, index)} className="text-xs text-slate-600">
              <span className="font-semibold">{marker.date}</span>
              {' • '}
              <span className="text-red-700 font-semibold">{marker.deltaLabel}</span>
              {' • '}
              {marker.fromValue} {' -> '} {marker.toValue}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }) {
  const normalized = typeof status === 'string'
    ? status.toLowerCase()
    : String(status?.code || '').toLowerCase();
  const style = normalized === 'critical'
    ? 'bg-red-100 text-red-700 border-red-200'
    : normalized === 'watch' || normalized === 'protect'
      ? 'bg-amber-100 text-amber-700 border-amber-200'
      : normalized === 'scale' || normalized === 'likely_winner'
        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
        : normalized === 'likely_fail'
          ? 'bg-red-100 text-red-700 border-red-200'
          : 'bg-slate-100 text-slate-700 border-slate-200';

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${style}`}>
      {typeof status === 'string' ? status.replace(/_/g, ' ') : (status?.label || 'Unknown')}
    </span>
  );
}

function modelStatusLabel(model) {
  if (model?.status?.label) return model.status.label;
  if (typeof model?.status === 'string') {
    return model.status.replace(/_/g, ' ');
  }
  return 'Unknown';
}

function buildQueryParams({
  store,
  level,
  entityId,
  country,
  startDate,
  endDate,
  anchorDays,
  anchorStartDate,
  anchorEndDate,
  sentinelPreset,
  headroomPreset,
  launchPreset,
  launchMinDays,
  launchMaxDays,
  targetRoas,
  targetCpa,
  targetHorizonDays
}) {
  const params = new URLSearchParams();
  params.set('store', store || 'vironax');
  params.set('level', level);
  params.set('country', country);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  if (entityId) params.set('entityId', entityId);

  if (anchorStartDate && anchorEndDate) {
    params.set('anchorStartDate', anchorStartDate);
    params.set('anchorEndDate', anchorEndDate);
  } else {
    params.set('anchorWindowDays', String(anchorDays));
  }

  params.set('sentinelPreset', sentinelPreset);
  params.set('headroomPreset', headroomPreset);
  params.set('launchPreset', launchPreset);

  if (launchMinDays) params.set('launchMinDays', String(launchMinDays));
  if (launchMaxDays) params.set('launchMaxDays', String(launchMaxDays));

  params.set('targetRoas', String(targetRoas));
  params.set('targetHorizonDays', String(targetHorizonDays));
  if (targetCpa) params.set('targetCpa', String(targetCpa));

  return params;
}

function parseMonitorValue(metricKey, value, store) {
  if (metricKey === 'spend') {
    return formatMoney(value, store);
  }
  if (metricKey === 'cpm') {
    return formatUsdMoney(value);
  }
  if (metricKey === 'ctr' || metricKey === 'cvr' || metricKey === 'lpvRate') {
    return formatPercent(value, 2);
  }
  return formatNumber(value, 2);
}

export default function CampaignIntelligenceTab({ store }) {
  const [dashboardToday, setDashboardToday] = useState(() => getDashboardDateString());

  const [analysisParams, setAnalysisParams] = useState(() => ({
    level: 'campaign',
    entityId: '',
    country: 'ALL',
    startDate: '',
    endDate: '',
    anchorDays: DEFAULT_ANCHOR_DAYS,
    anchorStartDate: '',
    anchorEndDate: '',
    sentinelPreset: 'balanced',
    headroomPreset: 'balanced',
    launchPreset: 'balanced',
    launchMinDays: '',
    launchMaxDays: '',
    targetRoas: DEFAULT_TARGET_ROAS,
    targetCpa: '',
    targetHorizonDays: DEFAULT_TARGET_HORIZON_DAYS
  }));

  const [unifiedParams, setUnifiedParams] = useState(() => ({
    country: 'ALL',
    startDate: '',
    endDate: '',
    analysisWindowDays: 14,
    selectorLimit: 80
  }));

  const updateAnalysisParam = useCallback((key, valueOrUpdater) => {
    setAnalysisParams((prev) => {
      const currentValue = prev[key];
      const nextValue = typeof valueOrUpdater === 'function'
        ? valueOrUpdater(currentValue, prev)
        : valueOrUpdater;
      if (Object.is(currentValue, nextValue)) return prev;
      return { ...prev, [key]: nextValue };
    });
  }, []);

  const updateUnifiedParam = useCallback((key, valueOrUpdater) => {
    setUnifiedParams((prev) => {
      const currentValue = prev[key];
      const nextValue = typeof valueOrUpdater === 'function'
        ? valueOrUpdater(currentValue, prev)
        : valueOrUpdater;
      if (Object.is(currentValue, nextValue)) return prev;
      return { ...prev, [key]: nextValue };
    });
  }, []);

  const {
    level,
    entityId,
    country,
    startDate,
    endDate,
    anchorDays,
    anchorStartDate,
    anchorEndDate,
    sentinelPreset,
    headroomPreset,
    launchPreset,
    launchMinDays,
    launchMaxDays,
    targetRoas,
    targetCpa,
    targetHorizonDays
  } = analysisParams;

  const handleUnifiedAnalysisParamPatch = useCallback((updates = {}) => {
    for (const [key, value] of Object.entries(updates)) {
      if (!ANALYSIS_PARAM_KEYS.has(key)) continue;
      updateAnalysisParam(key, value);
    }
  }, [updateAnalysisParam]);

  const handleUnifiedManagerParamPatch = useCallback((updates = {}) => {
    for (const [key, value] of Object.entries(updates)) {
      if (!UNIFIED_PARAM_KEYS.has(key)) continue;
      updateUnifiedParam(key, value);
    }
  }, [updateUnifiedParam]);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [unifiedLoading, setUnifiedLoading] = useState(false);
  const [unifiedError, setUnifiedError] = useState('');
  const [unifiedSnapshot, setUnifiedSnapshot] = useState(null);
  const [selectedModelId, setSelectedModelId] = useState('mature_sentinel');
  const [activeView, setActiveView] = useState(CAMPAIGN_INTEL_VIEW.modelConsole);
  const requestRef = useRef({ id: 0, controller: null });
  const unifiedRequestRef = useRef({ id: 0, controller: null });

  const modelCards = useMemo(() => {
    if (!snapshot?.models) return [];
    return [snapshot.models.sentinel, snapshot.models.headroom, snapshot.models.launchJudge].filter(Boolean);
  }, [snapshot]);

  const selectedModel = useMemo(() => {
    if (!modelCards.length) return null;
    return modelCards.find((model) => model.id === selectedModelId) || modelCards[0];
  }, [modelCards, selectedModelId]);

  const runAnalysis = useCallback(async () => {
    if (!store?.id) return;

    const params = buildQueryParams({
      store: store.id,
      ...analysisParams
    });

    await executeApiRequest({
      requestRef,
      setLoading,
      setError,
      setData: setSnapshot,
      endpoint: API_ENDPOINT,
      params,
      failureLabel: 'Failed to load campaign intelligence'
    });
  }, [store?.id, analysisParams]);

  useEffect(() => {
    if (!store?.id) return undefined;
    if (activeView !== CAMPAIGN_INTEL_VIEW.modelConsole) return undefined;
    const timerId = setTimeout(() => {
      runAnalysis();
    }, ANALYSIS_REQUEST_DEBOUNCE_MS);
    return () => clearTimeout(timerId);
  }, [activeView, store?.id, runAnalysis]);

  const runUnifiedAnalysis = useCallback(async () => {
    if (!store?.id) return;

    const params = new URLSearchParams();
    params.set('store', String(store.id));
    if (unifiedParams.country) params.set('country', String(unifiedParams.country));
    if (unifiedParams.startDate) params.set('startDate', String(unifiedParams.startDate));
    if (unifiedParams.endDate) params.set('endDate', String(unifiedParams.endDate));
    if (unifiedParams.analysisWindowDays) params.set('analysisWindowDays', String(unifiedParams.analysisWindowDays));
    if (unifiedParams.selectorLimit) params.set('selectorLimit', String(unifiedParams.selectorLimit));

    await executeApiRequest({
      requestRef: unifiedRequestRef,
      setLoading: setUnifiedLoading,
      setError: setUnifiedError,
      setData: setUnifiedSnapshot,
      endpoint: UNIFIED_API_ENDPOINT,
      params,
      failureLabel: 'Failed to load unified manager'
    });
  }, [store?.id, unifiedParams]);

  useEffect(() => {
    if (!store?.id) return undefined;
    if (activeView !== CAMPAIGN_INTEL_VIEW.unifiedManager) return undefined;

    const timerId = setTimeout(() => {
      runUnifiedAnalysis();
    }, ANALYSIS_REQUEST_DEBOUNCE_MS);

    return () => clearTimeout(timerId);
  }, [activeView, runUnifiedAnalysis, store?.id]);

  useEffect(() => () => {
    if (requestRef.current.controller) {
      requestRef.current.controller.abort();
    }
    if (unifiedRequestRef.current.controller) {
      unifiedRequestRef.current.controller.abort();
    }
  }, []);

  useEffect(() => {
    if (!entityId || !snapshot?.selectors?.entities) return;
    const exists = snapshot.selectors.entities.some((option) => option.id === entityId);
    if (!exists) {
      updateAnalysisParam('entityId', '');
    }
  }, [snapshot, entityId, updateAnalysisParam]);

  useEffect(() => {
    const timerId = setInterval(() => {
      setDashboardToday((currentValue) => {
        const latestDate = getDashboardDateString();
        return currentValue === latestDate ? currentValue : latestDate;
      });
    }, TODAY_REFRESH_INTERVAL_MS);

    return () => clearInterval(timerId);
  }, []);

  const timelineDaily = toArray(snapshot?.timeline?.daily);
  const selectors = snapshot?.selectors || {};
  const lifecycle = selectors?.lifecycle || {};

  const chartData = useMemo(() => {
    const filteredRows = timelineDaily.length > 1
      ? timelineDaily.filter((row) => row?.date !== dashboardToday)
      : timelineDaily;

    return filteredRows.map((row) => ({
      ...row,
      ctrPercent: row.ctrPercent ?? ((row.ctr || 0) * 100),
      smoothedCtrPercent: row.smoothedCtrPercent ?? (((row?.smoothed?.ctr || 0) * 100)),
      smoothedReach: row?.smoothed?.reach ?? row.reach,
      smoothedSpend: row?.smoothed?.spend ?? row.spend
    }));
  }, [timelineDaily, dashboardToday]);

  const budgetChartMarkers = useMemo(() => {
    const chartByDate = new Map(chartData.map((row) => [row.date, row]));
    const events = snapshot?.budgetMonitor?.events || [];

    return events
      .slice(0, 5)
      .map((event) => {
        const row = chartByDate.get(event.pivotDate);
        if (!row) return null;

        const hasBudgetValues = event.fromBudget != null
          && event.toBudget != null
          && Number.isFinite(Number(event.fromBudget))
          && Number.isFinite(Number(event.toBudget));
        if (!hasBudgetValues) return null;

        const deltaPercent = Number(event.budgetShiftPercent || 0);
        const fromValue = formatMoney(event.fromBudget || 0, store);
        const toValue = formatMoney(event.toBudget || 0, store);

        return {
          date: event.pivotDate,
          value: row.spend,
          deltaPercent,
          deltaLabel: formatDeltaPercent(deltaPercent, 1),
          fromValue,
          toValue
        };
      })
      .filter(Boolean);
  }, [chartData, snapshot, store]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-blue-50 shadow-sm">
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-indigo-200/35 blur-3xl" />
        <div className="absolute -bottom-28 -left-16 w-80 h-80 rounded-full bg-blue-200/30 blur-3xl" />

        <div className="relative p-6 md:p-7 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 border border-indigo-100 text-xs text-indigo-700 font-semibold">
                <Brain className="w-3.5 h-3.5" />
                Campaign Intelligence
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mt-3">Fast, action-first campaign operating view</h2>
              <p className="text-sm text-slate-600 mt-1">
                Structured for quick scanning: lifecycle, model verdicts, smoothed KPI trajectories, and budget-shift impact.
              </p>
            </div>

            <button
              type="button"
              onClick={activeView === CAMPAIGN_INTEL_VIEW.unifiedManager ? runUnifiedAnalysis : runAnalysis}
              disabled={activeView === CAMPAIGN_INTEL_VIEW.unifiedManager ? unifiedLoading : loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${(activeView === CAMPAIGN_INTEL_VIEW.unifiedManager ? unifiedLoading : loading) ? 'animate-spin' : ''}`} />
              {activeView === CAMPAIGN_INTEL_VIEW.unifiedManager
                ? (unifiedLoading ? 'Refreshing...' : 'Refresh')
                : (loading ? 'Running...' : 'Run Analysis')}
            </button>
          </div>

          <div className="inline-flex items-center rounded-xl border border-indigo-100 bg-white p-1 gap-1 w-fit">
            <button
              type="button"
              onClick={() => setActiveView(CAMPAIGN_INTEL_VIEW.modelConsole)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeView === CAMPAIGN_INTEL_VIEW.modelConsole
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Model Console
            </button>
            <button
              type="button"
              onClick={() => setActiveView(CAMPAIGN_INTEL_VIEW.unifiedManager)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeView === CAMPAIGN_INTEL_VIEW.unifiedManager
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Unified Manager
            </button>
          </div>

          {activeView === CAMPAIGN_INTEL_VIEW.modelConsole && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-indigo-100 bg-white/90 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Active {level}</div>
              <div className="text-xl font-bold text-slate-900 mt-1">{formatNumber(lifecycle.active || 0)}</div>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white/90 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Newly Started (7d)</div>
              <div className="text-xl font-bold text-slate-900 mt-1">{formatNumber(lifecycle.newlyStarted || 0)}</div>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white/90 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Went Quiet</div>
              <div className="text-xl font-bold text-slate-900 mt-1">{formatNumber(lifecycle.wentQuiet || 0)}</div>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white/90 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Tracked {level}</div>
              <div className="text-xl font-bold text-slate-900 mt-1">{formatNumber(lifecycle.totalTracked || 0)}</div>
            </div>
          </div>
          )}

          {activeView === CAMPAIGN_INTEL_VIEW.modelConsole && (
          <div className="rounded-2xl border border-indigo-100 bg-white p-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Hierarchy</label>
                <select
                  value={level}
                  onChange={(event) => {
                    const nextLevel = event.target.value;
                    setAnalysisParams((prev) => ({
                      ...prev,
                      level: nextLevel,
                      entityId: ''
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {toArray(selectors.levels).map((option, index) => (
                    <option key={getListKey('level', option, index)} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Campaign / Ad Set / Ad</label>
                <select
                  value={entityId}
                  onChange={(event) => updateAnalysisParam('entityId', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">All {level === 'adset' ? 'Ad Sets' : level === 'ad' ? 'Ads' : 'Campaigns'}</option>
                  {toArray(selectors.entities).map((entity, index) => (
                    <option key={getListKey('entity', entity, index)} value={entity.id}>{entity.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Country</label>
                <select
                  value={country}
                  onChange={(event) => updateAnalysisParam('country', event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {toArray(selectors.countries).map((option, index) => (
                    <option key={getListKey('country', option, index)} value={option.code}>{formatCountryLabel(option.code)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => setAdvancedOpen((open) => !open)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:text-indigo-800"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Advanced Settings
                {advancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {advancedOpen && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Analysis Start (Optional Override)</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(event) => updateAnalysisParam('startDate', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                      <div className="text-[11px] text-slate-500 mt-1">Default: entity lifecycle start</div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Analysis End (Optional Override)</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(event) => updateAnalysisParam('endDate', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                      <div className="text-[11px] text-slate-500 mt-1">Default: latest fully available day</div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Effective Analysis Window</label>
                      <div className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        {snapshot?.scope?.analysisStartDate || '-'} {' -> '} {snapshot?.scope?.analysisEndDate || '-'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Anchor Days (Recommended 21)</label>
                      <input
                        type="number"
                        min="7"
                        max="120"
                        value={anchorDays}
                        onChange={(event) => updateAnalysisParam('anchorDays', Number(event.target.value) || DEFAULT_ANCHOR_DAYS)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Anchor Start (Optional)</label>
                      <input
                        type="date"
                        value={anchorStartDate}
                        onChange={(event) => updateAnalysisParam('anchorStartDate', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Anchor End (Optional)</label>
                      <input
                        type="date"
                        value={anchorEndDate}
                        onChange={(event) => updateAnalysisParam('anchorEndDate', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Target Horizon (days)</label>
                      <input
                        type="number"
                        min="4"
                        max="14"
                        value={targetHorizonDays}
                        onChange={(event) => updateAnalysisParam('targetHorizonDays', Number(event.target.value) || DEFAULT_TARGET_HORIZON_DAYS)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Sentinel Preset</label>
                      <select
                        value={sentinelPreset}
                        onChange={(event) => updateAnalysisParam('sentinelPreset', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {PRESET_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Headroom Preset</label>
                      <select
                        value={headroomPreset}
                        onChange={(event) => updateAnalysisParam('headroomPreset', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {PRESET_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Launch Preset</label>
                      <select
                        value={launchPreset}
                        onChange={(event) => updateAnalysisParam('launchPreset', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {PRESET_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Launch Min Days (Optional)</label>
                      <input
                        type="number"
                        min="2"
                        max="14"
                        value={launchMinDays}
                        onChange={(event) => updateAnalysisParam('launchMinDays', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Launch Max Days (Optional)</label>
                      <input
                        type="number"
                        min="2"
                        max="14"
                        value={launchMaxDays}
                        onChange={(event) => updateAnalysisParam('launchMaxDays', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Target ROAS</label>
                      <input
                        type="number"
                        min="0.5"
                        max="20"
                        step="0.1"
                        value={targetRoas}
                        onChange={(event) => updateAnalysisParam('targetRoas', Number(event.target.value) || DEFAULT_TARGET_ROAS)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Target CPA (Optional)</label>
                      <input
                        type="number"
                        min="1"
                        step="0.1"
                        value={targetCpa}
                        onChange={(event) => updateAnalysisParam('targetCpa', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {activeView === CAMPAIGN_INTEL_VIEW.modelConsole && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 inline-flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      {activeView === CAMPAIGN_INTEL_VIEW.unifiedManager && unifiedError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 inline-flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {unifiedError}
        </div>
      )}

      {activeView === CAMPAIGN_INTEL_VIEW.modelConsole && (
      <>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 space-y-4">
          {modelCards.map((model) => {
            const cardMeta = MODEL_CARD_META[model.id] || MODEL_CARD_META.mature_sentinel;
            const Icon = cardMeta.icon;
            const isSelected = selectedModel?.id === model.id;

            return (
              <button
                key={model.id}
                type="button"
                onClick={() => setSelectedModelId(model.id)}
                className={`w-full text-left rounded-2xl border p-4 transition-all ${
                  isSelected
                    ? 'border-indigo-400 bg-indigo-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-indigo-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{cardMeta.title}</div>
                      <div className="text-xs text-slate-500 mt-1">Preset: {model.preset}</div>
                    </div>
                  </div>
                  <StatusPill status={model.status?.code ? model.status : modelStatusLabel(model)} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">Confidence</div>
                    <div className="text-sm font-semibold text-slate-900 mt-1">{formatPercent(model.confidence || 0, 1)}</div>
                  </div>

                  {model.id === 'mature_sentinel' && (
                    <>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Risk Score</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">{formatNumber(model.riskScore || 0, 1)}</div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Re-check</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">{model.decisionWindowDays || 0} days</div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Window Source</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">{model.decisionWindowSource || 'policy'}</div>
                      </div>
                    </>
                  )}

                  {model.id === 'headroom_model' && (
                    <>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Headroom Score</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">{formatNumber(model.headroomScore || 0, 1)}</div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Suggested Change</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">{formatDeltaPercent(model.recommendation?.suggestedPercent || 0, 1)}</div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Elasticity</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">{formatNumber(model.diagnostics?.elasticity || 0, 3)}</div>
                      </div>
                    </>
                  )}

                  {model.id === 'launch_judge' && (
                    <>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Hit CPA</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">{formatPercent(model.probabilities?.hitTargetCpa || 0, 1)}</div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Hit ROAS</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">{formatPercent(model.probabilities?.hitTargetRoas || 0, 1)}</div>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 p-2.5">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500">Trial Window</div>
                        <div className="text-sm font-semibold text-slate-900 mt-1">
                          {model.trialWindow?.minDays || '-'}-{model.trialWindow?.maxDays || '-'} days
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </button>
            );
          })}
          {snapshot?.models?.launchJudgeEligibility && !snapshot.models.launchJudgeEligibility.eligible && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Launch Judge appears only for fresh campaigns. Current scope has {snapshot.models.launchJudgeEligibility.activeSpendDays} active spend day(s), above the trial window max of {snapshot.models.launchJudgeEligibility.maxTrialDays} day(s).
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-indigo-100 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">Decision Breakdown</div>
          <div className="text-xs text-slate-500 mt-1">Why this model produced its current verdict.</div>

          {!selectedModel && (
            <div className="text-sm text-slate-500 mt-4">Run analysis to load model decisions.</div>
          )}

          {selectedModel && (
            <div className="mt-4 space-y-4 text-sm text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="font-semibold text-slate-900">{selectedModel.summary}</div>
                {'action' in selectedModel && selectedModel.action && (
                  <div className="mt-2 text-slate-700">{selectedModel.action}</div>
                )}
              </div>

              {selectedModel.id === 'mature_sentinel' && (
                <>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Top signals</div>
                  <div className="space-y-2">
                    {toArray(selectedModel.signals).slice(0, 4).map((signal, index) => {
                      const signalState = getSignalState(signal);
                      const signalDisplayLabel = getSignalDisplayLabel(signal);
                      return (
                        <div key={getListKey('signal', signal, index)} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-slate-900">{signalDisplayLabel}</div>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${SIGNAL_STATUS_STYLES[signalState.code] || SIGNAL_STATUS_STYLES.not_triggered}`}>
                              {signalState.label}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 mt-1">{signalState.detail}</div>
                          <div className="text-xs text-slate-500 mt-1">
                            Baseline {formatSignalMetricValue(signal, signal.baselineValue)} {' -> '} Current {formatSignalMetricValue(signal, signal.currentValue)}
                          </div>
                          <div className="text-xs text-slate-600 mt-1">
                            Delta {formatDeltaPercent(signal.deltaPercent, 2)} | Threshold {formatNumber(signal.thresholdPercent, 1)}% | Source {formatSignalSource(signal.source)}
                          </div>
                          <div className="text-xs text-slate-600 mt-1">
                            {getSignalTriggerText(signal)}
                          </div>
                          <div className="text-xs text-slate-600 mt-1">
                            Risk contribution: {formatNumber(signal.weightedImpact || 0, SIGNAL_CONTRIBUTION_DECIMALS)} pts
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-xs text-slate-500">
                    Re-check window is {selectedModel.decisionWindowDays} days ({selectedModel.decisionWindowSource});
                    policy base = {selectedModel.decisionWindowPolicyDays} day(s), learning adjustment = {selectedModel.decisionWindowLearningAdjustmentDays} day(s).
                  </div>
                </>
              )}

              {selectedModel.id === 'headroom_model' && (
                <>
                  <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="font-medium text-slate-900">Safe spend band</div>
                    <div className="text-xs text-slate-600">
                      Current {formatMoney(selectedModel.recommendation?.currentDailySpend || 0, store)}
                      {' -> '}Suggested {formatMoney(selectedModel.recommendation?.suggestedDailySpend || 0, store)}
                    </div>
                    <div className="text-xs text-slate-600">
                      Range: {formatMoney(selectedModel.recommendation?.safeDailySpendMin || 0, store)} to {formatMoney(selectedModel.recommendation?.safeDailySpendMax || 0, store)}
                    </div>
                    <div className="text-xs text-slate-600">
                      Elasticity {formatNumber(selectedModel.diagnostics?.elasticity || 0, 3)} | Saturation risk {formatPercent(selectedModel.diagnostics?.saturationRisk || 0, 1)} | Fit R² {formatNumber(selectedModel.diagnostics?.fitQualityR2 || 0, 2)}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    Policy guardrails cap scale-up at {formatNumber(selectedModel.policy?.maxScaleUpPercent || 0, 1)}% and scale-down at {formatNumber(selectedModel.policy?.maxScaleDownPercent || 0, 1)}%.
                  </div>
                </>
              )}

              {selectedModel.id === 'launch_judge' && (
                <>
                  <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                    <div className="font-medium text-slate-900">Launch probability readout</div>
                    <div className="text-xs text-slate-600">Chance hit target CPA by day {selectedModel.targets?.targetHorizonDays}: {formatPercent(selectedModel.probabilities?.hitTargetCpa || 0, 1)}</div>
                    <div className="text-xs text-slate-600">Chance hit target ROAS by day {selectedModel.targets?.targetHorizonDays}: {formatPercent(selectedModel.probabilities?.hitTargetRoas || 0, 1)}</div>
                    <div className="text-xs text-slate-600">CVR drop risk vs anchor: {formatPercent(selectedModel.probabilities?.cvrDropBeyondThreshold || 0, 1)}</div>
                    <div className="text-xs text-slate-600">Trial window source: {selectedModel.trialWindow?.source || 'preset'}</div>
                  </div>
                  <div className="text-xs text-slate-500">
                    Targets applied: ROAS {formatNumber(selectedModel.targets?.targetRoas || 0, 2)} and CPA {formatNumber(selectedModel.targets?.targetCpa || 0, 2)}.
                  </div>
                </>
              )}
            </div>
          )}

          {snapshot?.models?.calibration && (
            <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
              <div className="text-xs uppercase tracking-wide text-indigo-700 font-semibold">Calibration Layer</div>
              <div className="text-sm text-indigo-900 mt-1">
                Confidence reliability: {formatPercent(snapshot.models.calibration.reliability || 0, 1)}
                {' • '}
                Expected error: {formatPercent(snapshot.models.calibration.calibrationError || 0, 1)}
              </div>
              <div className="text-xs text-indigo-700 mt-2">
                Reliability band: {formatPercent(snapshot.models.calibration.reliabilityBand?.[0] || 0, 1)} to {formatPercent(snapshot.models.calibration.reliabilityBand?.[1] || 0, 1)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <MetricChartCard
          title="Unique Reach"
          subtitle="Raw vs shock-smoothed trend"
          data={chartData}
          valueKey="reach"
          smoothedKey="smoothedReach"
          lineColor="#2563eb"
          formatter={(value) => formatNumber(value, 0)}
          yAxisFormatter={(value) => formatNumber(value, 0)}
        />

        <MetricChartCard
          title="CTR"
          subtitle="Percent points, smoothed to reduce one-day shock noise"
          data={chartData}
          valueKey="ctrPercent"
          smoothedKey="smoothedCtrPercent"
          lineColor="#7c3aed"
          formatter={(value) => `${formatNumber(value, 2)}%`}
          yAxisFormatter={(value) => `${formatNumber(value, 1)}%`}
        />

        <MetricChartCard
          title="Spend (Budget Proxy)"
          subtitle="Delivery spend used as live budget pacing signal"
          data={chartData}
          valueKey="spend"
          smoothedKey="smoothedSpend"
          lineColor="#0ea5e9"
          formatter={(value) => formatMoney(value, store)}
          yAxisFormatter={(value) => formatNumber(value, 0)}
          markers={budgetChartMarkers}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">Budget Change Monitor</div>
            <div className="text-xs text-slate-500 mt-1">Compares pre-change vs post-change metrics for the latest significant Meta-recorded budget change.</div>
          </div>
          {snapshot?.budgetMonitor?.latest && (
            <div className="text-xs text-slate-600">
              Pivot day: <span className="font-semibold">{snapshot.budgetMonitor.latest.pivotDate}</span>
              {' • '}Budget shift: <span className="font-semibold">{formatDeltaPercent((snapshot.budgetMonitor.latest.budgetShiftPercent ?? 0), 1)}</span>
            </div>
          )}
        </div>

        {!snapshot?.budgetMonitor?.hasEvent && (
          <div className="mt-4 text-sm text-slate-500">No significant Meta budget-change event detected in the recent monitor window.</div>
        )}

        {snapshot?.budgetMonitor?.hasEvent && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b">
                  <th className="py-2 pr-3">Metric</th>
                  <th className="py-2 pr-3">Pre</th>
                  <th className="py-2 pr-3">Post</th>
                  <th className="py-2 pr-3">Delta</th>
                </tr>
              </thead>
              <tbody>
                {toArray(snapshot.budgetMonitor.metrics).map((metric, index) => (
                  <tr key={getListKey('budget-metric', metric, index)} className="border-b last:border-b-0">
                    <td className="py-2.5 pr-3 text-sm font-medium text-slate-800">{metric.label}</td>
                    <td className="py-2.5 pr-3 text-sm text-slate-700">{parseMonitorValue(metric.key, metric.preValue, store)}</td>
                    <td className="py-2.5 pr-3 text-sm text-slate-700">{parseMonitorValue(metric.key, metric.postValue, store)}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${SHIFT_INTENT_STYLES[metric.intent] || SHIFT_INTENT_STYLES.neutral}`}>
                        {formatDeltaPercent(metric.deltaPercent, 2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-indigo-100 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Education Center</div>
        <div className="text-xs text-slate-500 mt-1">What each model does, what is policy-defined, and what adapts over time.</div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {toArray(snapshot?.education).map((section, sectionIndex) => (
            <div key={getListKey('education-section', section, sectionIndex)} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="font-semibold text-slate-900 text-sm">{section.title}</div>
              <div className="mt-2 space-y-2">
                {toArray(section.basics).map((line, lineIndex) => (
                  <div key={getListKey('education-basics', line, lineIndex)} className="text-xs text-slate-700 flex items-start gap-2">
                    <BarChart3 className="w-3.5 h-3.5 mt-0.5 text-indigo-500" />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Policy vs anchored vs learned</div>
                <div className="mt-2 space-y-2">
                  {toArray(section.policyVsLearning).map((line, lineIndex) => (
                    <div key={getListKey('education-policy', line, lineIndex)} className="text-xs text-slate-700 flex items-start gap-2">
                      <TrendingUp className="w-3.5 h-3.5 mt-0.5 text-indigo-500" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {snapshot?.models?.topDrivers?.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-900">Top Drivers</div>
          <div className="text-xs text-slate-500 mt-1">Highest-impact indicators across all active models.</div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {snapshot.models.topDrivers.slice(0, 6).map((driver, index) => (
              <div key={`${driver.modelId}-${driver.label}-${index}`} className="rounded-xl border border-slate-200 p-3 bg-slate-50">
                <div className="text-xs text-slate-500">{driver.modelName}</div>
                <div className="text-sm font-semibold text-slate-900 mt-1">{driver.label}</div>
                <div className="text-xs text-slate-600 mt-2">Impact: {formatNumber(driver.impact || 0, 2)}</div>
                <div className="text-xs mt-1 inline-flex items-center gap-1 text-slate-600">
                  {driver.deltaPercent >= 0 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> : <TrendingDown className="w-3.5 h-3.5 text-red-600" />}
                  Delta {formatDeltaPercent(driver.deltaPercent || 0, 2)}
                </div>
                <div className="text-[11px] text-slate-500 mt-2">Source: {driver.source}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}

      {activeView === CAMPAIGN_INTEL_VIEW.unifiedManager && (
      <CampaignIntelligenceUnifiedSection
        snapshot={unifiedSnapshot}
        analysisParams={unifiedParams}
        targetRoas={targetRoas}
        store={store}
        onSnapshotUpdate={setUnifiedSnapshot}
        onAnalysisParamsChange={handleUnifiedManagerParamPatch}
      />
      )}
    </div>
  );
}
