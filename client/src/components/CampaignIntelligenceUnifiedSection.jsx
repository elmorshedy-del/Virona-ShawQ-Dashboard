import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, ChevronDown, ChevronRight, ListChecks, Loader2, RefreshCw, Save, Sparkles, Target } from 'lucide-react';

const BRIEF_ENDPOINT_GENERATE = '/api/campaign-intelligence/brief/generate';
const BRIEF_ENDPOINT_SETTINGS = '/api/campaign-intelligence/brief/settings';
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
  strong_good: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  good: 'bg-green-50 border-green-200 text-green-800',
  caution: 'bg-amber-50 border-amber-200 text-amber-800',
  bad: 'bg-orange-50 border-orange-200 text-orange-800',
  critical: 'bg-red-50 border-red-200 text-red-800',
  insufficient: 'bg-slate-50 border-slate-200 text-slate-500'
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
const ROW_DEPTH_OFFSET_PX = 14;
const CHART_WIDTH = 280;
const CHART_HEIGHT = 64;
const CHART_EPSILON = 1e-6;

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNullableNumber(value) {
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
  const base = parseNullableNumber(baseline);
  if (!Number.isFinite(now) || !Number.isFinite(base) || Math.abs(base) < CHART_EPSILON) {
    return { code: 'insufficient', note: 'Insufficient baseline' };
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
  return toFiniteNumber(row?.metrics?.[side]?.[metricKey], NaN);
}

function computeHealthScore(row, targetRoas) {
  const roasNow = rowMetric(row, 'roas', 'now');
  const roasBase = rowMetric(row, 'roas', 'baseline');
  const purchaseIcNow = rowMetric(row, 'purchaseIc', 'now');
  const cpmNow = rowMetric(row, 'cpm', 'now');
  const cpmBase = rowMetric(row, 'cpm', 'baseline');
  const ctrNow = rowMetric(row, 'ctr', 'now');
  const ctrBase = rowMetric(row, 'ctr', 'baseline');

  const roasVsTarget = Number.isFinite(roasNow)
    ? clamp(roasNow / Math.max(0.1, targetRoas), 0, 1.4)
    : 0;
  const roasVsBaseline = Number.isFinite(roasNow) && Number.isFinite(roasBase) && roasBase > 0
    ? clamp(roasNow / roasBase, 0, 1.4)
    : 0;
  const purchaseIcScore = Number.isFinite(purchaseIcNow)
    ? clamp(purchaseIcNow / KEY_METRIC_BOUNDS.purchaseIcFloorRate, 0, 1.4)
    : 0;
  const cpmScore = Number.isFinite(cpmNow) && Number.isFinite(cpmBase) && cpmBase > 0
    ? clamp(cpmBase / Math.max(cpmNow, CHART_EPSILON), 0, 1.4)
    : 0;
  const ctrScore = Number.isFinite(ctrNow) && Number.isFinite(ctrBase) && ctrBase > 0
    ? clamp(ctrNow / ctrBase, 0, 1.4)
    : 0;

  const weights = HEALTH_RULES.weights;
  const weighted = (
    (roasVsTarget * weights.roasVsTarget) +
    (roasVsBaseline * weights.roasVsBaseline) +
    (purchaseIcScore * weights.purchaseIc) +
    (cpmScore * weights.cpmPressure) +
    (ctrScore * weights.ctrResilience)
  ) / Math.max(
    CHART_EPSILON,
    weights.roasVsTarget + weights.roasVsBaseline + weights.purchaseIc + weights.cpmPressure + weights.ctrResilience
  );

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

function directionPillStyle(direction) {
  if (direction === 'improving') return 'bg-emerald-100 text-emerald-800';
  if (direction === 'deteriorating') return 'bg-red-100 text-red-800';
  if (direction === 'saturating') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-700';
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
  const sentinelSummary = String(snapshot?.models?.sentinel?.summary || '').trim();
  const topDrivers = Array.isArray(snapshot?.models?.topDrivers) ? snapshot.models.topDrivers : [];

  const draggers = computeDraggerRows(rows, targetRoas).map((row) => ({
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

  const toWatch = (topDrivers.slice(0, 4)).map((driver) => ({
    scope: driver.modelName || 'Model',
    signal: driver.label || 'Driver',
    why: `Impact ${formatNumber(driver.impact || 0, 2)} | Delta ${formatNumber(driver.deltaPercent || 0, 2)}%`,
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
    executiveSummary: sentinelSummary || 'Deterministic brief: monitor quality drift and keep scaling decisions inside guardrails.',
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

function normalizeBriefForRender(briefReport, fallbackBrief) {
  if (!briefReport) return fallbackBrief;

  return {
    executiveSummary: String(briefReport.executiveSummary || fallbackBrief.executiveSummary || '').trim() || fallbackBrief.executiveSummary,
    draggers: Array.isArray(briefReport.draggers) && briefReport.draggers.length ? briefReport.draggers : fallbackBrief.draggers,
    creativePriorities: Array.isArray(briefReport.creativePriorities) && briefReport.creativePriorities.length
      ? briefReport.creativePriorities
      : fallbackBrief.creativePriorities,
    toWatch: Array.isArray(briefReport.toWatch) && briefReport.toWatch.length ? briefReport.toWatch : fallbackBrief.toWatch,
    toDo: Array.isArray(briefReport.toDo) && briefReport.toDo.length ? briefReport.toDo : fallbackBrief.toDo,
    notes: Array.isArray(briefReport.notes) && briefReport.notes.length ? briefReport.notes : fallbackBrief.notes
  };
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
  return {
    level: analysisParams.level,
    entityId: analysisParams.entityId || null,
    country: analysisParams.country || 'ALL',
    startDate: analysisParams.startDate || null,
    endDate: analysisParams.endDate || null,
    anchorDays: analysisParams.anchorDays,
    anchorStartDate: analysisParams.anchorStartDate || null,
    anchorEndDate: analysisParams.anchorEndDate || null
  };
}

function buildGeneratePayload({ storeId, analysisParams, provider, model, reasoningEffort, verbosity }) {
  return {
    store: storeId,
    level: analysisParams.level,
    entityId: analysisParams.entityId || undefined,
    country: analysisParams.country,
    startDate: analysisParams.startDate || undefined,
    endDate: analysisParams.endDate || undefined,
    anchorWindowDays: analysisParams.anchorDays,
    anchorStartDate: analysisParams.anchorStartDate || undefined,
    anchorEndDate: analysisParams.anchorEndDate || undefined,
    sentinelPreset: analysisParams.sentinelPreset,
    headroomPreset: analysisParams.headroomPreset,
    launchPreset: analysisParams.launchPreset,
    launchMinDays: analysisParams.launchMinDays || undefined,
    launchMaxDays: analysisParams.launchMaxDays || undefined,
    targetRoas: analysisParams.targetRoas,
    targetCpa: analysisParams.targetCpa || undefined,
    targetHorizonDays: analysisParams.targetHorizonDays,
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

function formatBriefModelOptionLabel(option) {
  const inPrice = Number(option.inputUsdPerMillionTokens || 0).toFixed(2);
  const outPrice = Number(option.outputUsdPerMillionTokens || 0).toFixed(2);
  return `${option.label} (${option.provider}) • in $${inPrice}/M • out $${outPrice}/M`;
}

export default function CampaignIntelligenceUnifiedSection({
  snapshot,
  analysisParams,
  store,
  targetRoas,
  onSnapshotUpdate
}) {
  const hierarchyRows = Array.isArray(snapshot?.hierarchy?.rows) ? snapshot.hierarchy.rows : [];

  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [selectedRowId, setSelectedRowId] = useState('');

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

  useEffect(() => {
    const defaultExpanded = new Set(
      hierarchyRows
        .filter((row) => row.level === 'campaign')
        .map((row) => row.id)
    );
    setExpandedIds(defaultExpanded);
  }, [hierarchyRows]);

  useEffect(() => {
    if (!hierarchyRows.length) {
      setSelectedRowId('');
      return;
    }

    const exists = hierarchyRows.some((row) => row.id === selectedRowId);
    if (!exists) {
      setSelectedRowId(hierarchyRows[0].id);
    }
  }, [hierarchyRows, selectedRowId]);

  useEffect(() => {
    const settings = briefMeta?.settings;
    if (!settings) return;

    setScheduleMode(settings.scheduleMode || 'manual');
    setSelectedProvider(settings.provider || 'openai');
    setSelectedModel(settings.model || 'gpt-5.2');
    setReasoningEffort(settings.reasoningEffort || 'medium');
    setVerbosity(settings.verbosity || 'low');
  }, [briefMeta]);

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
    return hierarchyRows.map((row) => {
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

  const visibleRows = useMemo(() => getVisibleRows(rowsWithComputed, expandedIds), [rowsWithComputed, expandedIds]);

  const childrenByParent = useMemo(() => listToMapByParent(rowsWithComputed), [rowsWithComputed]);

  const selectedRow = useMemo(() => {
    if (!rowsWithComputed.length) return null;
    return rowsWithComputed.find((row) => row.id === selectedRowId) || rowsWithComputed[0];
  }, [rowsWithComputed, selectedRowId]);

  const timelineDaily = useMemo(() => (Array.isArray(snapshot?.timeline?.daily) ? snapshot.timeline.daily : []), [snapshot]);

  const ctrSeries = useMemo(() => timelineDaily.map((row) => toFiniteNumber(row.ctr) * 100), [timelineDaily]);
  const reachSeries = useMemo(() => timelineDaily.map((row) => toFiniteNumber(row.reach)), [timelineDaily]);

  const metricDeltaDetails = useMemo(() => {
    if (!selectedRow) return [];
    return getMetricDeltaDetails(selectedRow, targetRoas);
  }, [selectedRow, targetRoas]);

  const deterministicBrief = useMemo(() => buildDeterministicBriefFallback(snapshot, rowsWithComputed, targetRoas), [snapshot, rowsWithComputed, targetRoas]);

  const activeBrief = useMemo(() => {
    if (manualBrief && snapshot?.brief?.latest) {
      const manualCreated = new Date(manualBrief.createdAt || 0).getTime();
      const latestCreated = new Date(snapshot.brief.latest.createdAt || 0).getTime();
      return manualCreated >= latestCreated ? manualBrief : snapshot.brief.latest;
    }
    return manualBrief || snapshot?.brief?.latest || null;
  }, [manualBrief, snapshot]);

  const renderedBrief = useMemo(() => {
    return normalizeBriefForRender(activeBrief?.report || null, deterministicBrief);
  }, [activeBrief, deterministicBrief]);

  const draggerRows = useMemo(() => {
    if (Array.isArray(renderedBrief?.draggers)) {
      return renderedBrief.draggers.slice(0, TOP_DRAGGERS_LIMIT);
    }
    return [];
  }, [renderedBrief]);

  const creativeRows = useMemo(() => {
    if (Array.isArray(renderedBrief?.creativePriorities)) {
      return renderedBrief.creativePriorities.slice(0, TOP_CREATIVES_LIMIT);
    }
    return [];
  }, [renderedBrief]);

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
        throw new Error(json?.error || `Brief generation failed (HTTP ${response.status})`);
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

  const scopeHasRows = rowsWithComputed.length > 0;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-5 md:p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-[25px] font-semibold text-slate-900 tracking-tight" style={{ fontFamily: TYPOGRAPHY_HEADING }}>
              Unified Funnel Health Console
            </h3>
            <p className="mt-1 text-sm text-slate-600 max-w-4xl">
              One-screen campaign, ad set, and ad triage with deterministic health scoring plus optional LLM daily brief.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
            Live Data
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Brief Mode</label>
            <select
              value={scheduleMode}
              onChange={(event) => setScheduleMode(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="manual">Manual only</option>
              <option value="daily">Daily end-of-day</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">LLM Provider</label>
            <select
              value={selectedProvider}
              onChange={(event) => setSelectedProvider(event.target.value)}
              disabled={!llmAvailable}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {!llmAvailable && <option value="">No providers configured</option>}
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Model</label>
            <select
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              disabled={!llmAvailable}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {!llmAvailable && <option value="">No models configured</option>}
              {modelOptionsForProvider.map((option) => (
                <option key={`${option.provider}:${option.model}`} value={option.model}>
                  {formatBriefModelOptionLabel(option)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={saveBriefSettings}
              disabled={settingsBusy || !store?.id}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {settingsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Mode
            </button>
            <button
              type="button"
              onClick={runBriefGeneration}
              disabled={briefBusy || !store?.id || !scopeHasRows || !llmAvailable}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {briefBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Generate Brief
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1">
            <RefreshCw className="w-3.5 h-3.5 text-indigo-600" />
            {scheduleMode === 'daily' ? 'Daily mode: enabled (runs at end of day)' : 'Daily mode: off (manual only)'}
          </span>
          {activeBrief && (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1">
              Last run: {activeBrief.source} • {activeBrief.provider} {activeBrief.model} • Cost {formatBriefCost(activeBrief.estimatedCostUsd)}
            </span>
          )}
        </div>

        {!llmAvailable && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No LLM provider is configured on the server. Add at least one provider key to enable brief generation.
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
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          No hierarchy rows are available for the current scope.
        </section>
      )}

      {scopeHasRows && (
        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-auto">
              <table className="min-w-[1500px] w-full border-collapse">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
                    <th className="sticky top-0 z-10 bg-slate-50 py-3 px-3 border-b">Entity</th>
                    <th className="sticky top-0 z-10 bg-slate-50 py-3 px-3 border-b">Spend</th>
                    {METRIC_KEYS.map((metricKey) => (
                      <th key={`header-${metricKey}`} className="sticky top-0 z-10 bg-slate-50 py-3 px-3 border-b">
                        {METRIC_CONFIG[metricKey].label}
                      </th>
                    ))}
                    <th className="sticky top-0 z-10 bg-slate-50 py-3 px-3 border-b">Health</th>
                    <th className="sticky top-0 z-10 bg-slate-50 py-3 px-3 border-b">Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const isSelected = selectedRow?.id === row.id;
                    const childRows = childrenByParent.get(row.id) || [];
                    const hasChildren = childRows.length > 0;
                    const healthState = getHealthState(row.healthScore);

                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-100 hover:bg-indigo-50/40 cursor-pointer ${isSelected ? 'bg-indigo-50/70' : ''}`}
                        onClick={() => setSelectedRowId(row.id)}
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2" style={{ marginLeft: `${row.depth * ROW_DEPTH_OFFSET_PX}px` }}>
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleExpand(row.id);
                                }}
                                className="h-5 w-5 rounded border border-slate-300 text-slate-500 inline-flex items-center justify-center"
                              >
                                {expandedIds.has(row.id) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                              </button>
                            ) : (
                              <span className="inline-block w-5" />
                            )}
                            <div>
                              <div className="text-sm font-semibold text-slate-900">{row.name}</div>
                              <div className="text-[10px] uppercase tracking-wide text-slate-500">{row.type}</div>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-sm font-semibold text-slate-800">
                          {formatUsd(row?.metrics?.now?.spend)}
                        </td>

                        {METRIC_KEYS.map((metricKey) => {
                          const now = row?.metrics?.now?.[metricKey];
                          const baseline = row?.metrics?.baseline?.[metricKey];
                          const state = resolveCellStatus(metricKey, now, baseline, targetRoas);

                          return (
                            <td key={`${row.id}-${metricKey}`} className="py-2 px-2.5">
                              <div className={`rounded-lg border px-2 py-1.5 min-w-[104px] ${CELL_STATUS_STYLE[state.code]}`}>
                                <div className="text-[12px] font-semibold leading-4">{formatMetricValue(metricKey, now)}</div>
                                <div className="text-[10px] mt-0.5 opacity-90">{state.note}</div>
                              </div>
                            </td>
                          );
                        })}

                        <td className="py-2 px-2.5">
                          <div className={`rounded-lg border px-2 py-1.5 min-w-[94px] ${CELL_STATUS_STYLE[healthState.code]}`}>
                            <div className="text-[12px] font-semibold">{row.healthScore}</div>
                            <div className="text-[10px] mt-0.5 opacity-90">{healthState.note}</div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${directionPillStyle(row.direction)}`}>
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

          <aside className="rounded-3xl border border-indigo-100 bg-white shadow-sm p-4 space-y-3">
            <div>
              <h4 className="text-lg font-semibold text-slate-900" style={{ fontFamily: TYPOGRAPHY_HEADING }}>Diagnostic Brief</h4>
              <p className="text-xs text-slate-500 mt-1">Immediate metric explanation for the selected row.</p>
            </div>

            {selectedRow && (
              <>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">{selectedRow.name}</div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${directionPillStyle(selectedRow.direction)}`}>
                      {selectedRow.direction}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-600">
                    {selectedRow.type} • Health score {selectedRow.healthScore}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">What changed vs baseline</div>
                  <div className="mt-2 space-y-2">
                    {metricDeltaDetails.map((item) => (
                      <div key={`${selectedRow.id}-delta-${item.metricKey}`} className="rounded-lg border border-slate-200 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-slate-800">{item.label}</div>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${CELL_STATUS_STYLE[item.status.code]}`}>
                            {item.status.note}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-600">
                          Baseline {formatMetricValue(item.metricKey, item.baseline)} {'->'} Current {formatMetricValue(item.metricKey, item.now)}
                        </div>
                        <div className="text-[11px] text-slate-600">Delta {item.delta}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Scope Trend</div>
                  <div className="mt-2 text-[11px] text-slate-600">CTR</div>
                  <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-16 mt-1">
                    <polyline points={buildSparklinePoints(ctrSeries)} fill="none" stroke="#2563eb" strokeWidth="2" />
                  </svg>

                  <div className="mt-2 text-[11px] text-slate-600">Unique Reach</div>
                  <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-16 mt-1">
                    <polyline points={buildSparklinePoints(reachSeries)} fill="none" stroke="#7c3aed" strokeWidth="2" />
                  </svg>
                </div>
              </>
            )}
          </aside>
        </section>
      )}

      <section className="rounded-3xl border border-indigo-100 bg-white p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-[22px] font-semibold text-slate-900" style={{ fontFamily: TYPOGRAPHY_HEADING }}>Daily Operating Brief</h3>
          <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
            {activeBrief ? `${activeBrief.provider} ${activeBrief.model}` : 'Deterministic fallback'}
          </span>
        </div>

        <p className="mt-1 text-sm text-slate-600">Structured output with clear watch list, action queue, draggers, and creative priorities.</p>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Executive Summary</div>
            <p className="mt-2 text-sm text-slate-700">{renderedBrief.executiveSummary}</p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top Draggers and Bleeds</div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase tracking-wide">
                  <th className="text-left py-1 pr-3">Scope</th>
                  <th className="text-left py-1 pr-3">Issue</th>
                  <th className="text-left py-1 pr-3">Evidence</th>
                  <th className="text-left py-1">Impact</th>
                </tr>
              </thead>
              <tbody>
                {draggerRows.map((row, index) => (
                  <tr key={`dragger-${index}-${row.scope}`} className="border-t border-slate-200">
                    <td className="py-1.5 pr-3">{row.scope}</td>
                    <td className="py-1.5 pr-3">{row.issue}</td>
                    <td className="py-1.5 pr-3">{row.evidence}</td>
                    <td className="py-1.5 font-semibold text-red-700 uppercase">{row.impact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Creative Priority Ranking</div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase tracking-wide">
                  <th className="text-left py-1 pr-3">Creative</th>
                  <th className="text-left py-1 pr-3">Recommendation</th>
                  <th className="text-left py-1">Reason</th>
                </tr>
              </thead>
              <tbody>
                {creativeRows.map((row, index) => (
                  <tr key={`creative-${index}-${row.creative}`} className="border-t border-slate-200">
                    <td className="py-1.5 pr-3 font-medium">{row.creative}</td>
                    <td className="py-1.5 pr-3 uppercase font-semibold text-slate-700">{row.recommendation}</td>
                    <td className="py-1.5">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">To Watch</div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase tracking-wide">
                  <th className="text-left py-1 pr-3">Scope</th>
                  <th className="text-left py-1 pr-3">Signal</th>
                  <th className="text-left py-1">Re-check</th>
                </tr>
              </thead>
              <tbody>
                {watchRows.map((row, index) => (
                  <tr key={`watch-${index}-${row.scope}`} className="border-t border-slate-200">
                    <td className="py-1.5 pr-3">{row.scope}</td>
                    <td className="py-1.5 pr-3">{row.signal}</td>
                    <td className="py-1.5">{row.recheck}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">To Do</div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-slate-500 uppercase tracking-wide">
                  <th className="text-left py-1 pr-3">Priority</th>
                  <th className="text-left py-1 pr-3">Action</th>
                  <th className="text-left py-1">Guardrail</th>
                </tr>
              </thead>
              <tbody>
                {todoRows.map((row, index) => (
                  <tr key={`todo-${index}-${row.priority}`} className="border-t border-slate-200">
                    <td className="py-1.5 pr-3 font-semibold">{row.priority}</td>
                    <td className="py-1.5 pr-3">{row.action}</td>
                    <td className="py-1.5">{row.guardrail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </div>

        {notes.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Notes</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {notes.map((line, index) => (
                <li key={`note-${index}`} className="flex items-start gap-2">
                  <span className="mt-[5px] h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold text-slate-800 inline-flex items-center gap-1"><Target className="w-3.5 h-3.5" /> Deterministic Core</div>
            <div className="mt-1 text-slate-600">Health, cell colors, model scores, and alerts remain deterministic and tenant-scoped.</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold text-slate-800 inline-flex items-center gap-1"><ListChecks className="w-3.5 h-3.5" /> LLM Narrative Layer</div>
            <div className="mt-1 text-slate-600">LLM writes interpretation and action framing only; it does not mutate underlying scores.</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold text-slate-800 inline-flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" /> Transparent Costing</div>
            <div className="mt-1 text-slate-600">Each brief run shows provider, model, and estimated USD cost directly in the UI.</div>
          </div>
        </div>
      </section>
    </div>
  );
}
