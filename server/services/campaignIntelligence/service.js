import {
  BUDGET_MONITOR_CONFIG,
  DEFAULT_SETTINGS,
  EDUCATION_SECTIONS,
  MODEL_PRESET_OPTIONS,
  QUERY_LIMITS,
  SUPPORTED_LEVELS
} from './constants.js';
import {
  buildDailyAggregationSummary,
  fetchCountryOptions,
  fetchDailyMetaRows,
  fetchDailyOrdersRows,
  fetchEntityOptions,
  fetchEntitySnapshot,
  fetchMetaBudgetHistoryEvents,
  fetchScopedCampaignIds,
  fetchScopeLifecycleSummary,
  mergeDailySeries,
  normalizeCampaignIntelligenceRequest
} from './data.js';
import {
  buildBudgetChangeMonitor,
  buildModelBundle,
  buildShockAwareSeries
} from './models.js';
import {
  addDaysIso,
  clampInt,
  clampNumber,
  listDateRange,
  round
} from './utils.js';

function resolvePresetName(rawPreset) {
  const normalized = String(rawPreset || DEFAULT_SETTINGS.defaultPreset).trim().toLowerCase();
  if (MODEL_PRESET_OPTIONS.has(normalized)) {
    return normalized;
  }
  return DEFAULT_SETTINGS.defaultPreset;
}

function resolveTargetRoas(rawTargetRoas) {
  const parsed = Number(rawTargetRoas);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.targetRoas;
  return clampNumber(parsed, QUERY_LIMITS.minTargetRoas, QUERY_LIMITS.maxTargetRoas);
}

function resolveTargetCpa(rawTargetCpa) {
  if (rawTargetCpa == null || rawTargetCpa === '') return null;
  const parsed = Number(rawTargetCpa);
  if (!Number.isFinite(parsed)) return null;
  return clampNumber(parsed, QUERY_LIMITS.minTargetCpa, QUERY_LIMITS.maxTargetCpa);
}

function resolveHorizonDays(rawHorizonDays) {
  return clampInt(
    rawHorizonDays,
    QUERY_LIMITS.minTargetHorizonDays,
    QUERY_LIMITS.maxTargetHorizonDays,
    DEFAULT_SETTINGS.targetHorizonDays
  );
}

function resolveLaunchWindowOverride(rawMinDays, rawMaxDays) {
  const parsedMin = clampInt(rawMinDays, QUERY_LIMITS.minLaunchWindowDays, QUERY_LIMITS.maxLaunchWindowDays, NaN);
  const parsedMax = clampInt(rawMaxDays, QUERY_LIMITS.minLaunchWindowDays, QUERY_LIMITS.maxLaunchWindowDays, NaN);

  const hasMin = Number.isFinite(parsedMin);
  const hasMax = Number.isFinite(parsedMax);

  if (!hasMin && !hasMax) {
    return { minDays: null, maxDays: null };
  }

  const fallbackMin = hasMin ? parsedMin : parsedMax;
  const fallbackMax = hasMax ? parsedMax : parsedMin;

  return {
    minDays: Math.min(fallbackMin, fallbackMax),
    maxDays: Math.max(fallbackMin, fallbackMax)
  };
}

function resolveModelSettings(query = {}) {
  const sentinelPreset = resolvePresetName(query.sentinelPreset);
  const headroomPreset = resolvePresetName(query.headroomPreset);
  const launchPreset = resolvePresetName(query.launchPreset);
  const launchWindow = resolveLaunchWindowOverride(query.launchMinDays, query.launchMaxDays);

  return {
    sentinelPreset,
    headroomPreset,
    launchPreset,
    launchMinDays: launchWindow.minDays,
    launchMaxDays: launchWindow.maxDays,
    targetRoas: resolveTargetRoas(query.targetRoas),
    targetCpa: resolveTargetCpa(query.targetCpa),
    targetHorizonDays: resolveHorizonDays(query.targetHorizonDays)
  };
}

function buildLevelsList() {
  return Array.from(SUPPORTED_LEVELS).map((level) => ({
    id: level,
    label: level === 'adset' ? 'Ad Set' : level.charAt(0).toUpperCase() + level.slice(1)
  }));
}

function ensureEntityFallback(entityId, entityOptions) {
  if (!entityId) return null;
  const exists = entityOptions.some((option) => option.id === entityId);
  return exists ? entityId : null;
}

function attachSmoothedSeries(series) {
  return series.map((row) => ({
    ...row,
    ctrPercent: round((row.ctr || 0) * 100, 4),
    cvrPercent: round((row.cvr || 0) * 100, 4),
    lpvRatePercent: round((row.lpvRate || 0) * 100, 4),
    smoothedCtrPercent: round((row?.smoothed?.ctr || 0) * 100, 4)
  }));
}

async function getScopedBaselineRows({ scope }) {
  const baselineMetaRows = fetchDailyMetaRows({
    db: scope.db,
    store: scope.store,
    levelConfig: scope.levelConfig,
    startDate: scope.anchorRange.startDate,
    endDate: scope.anchorRange.endDate,
    entityId: scope.entityId,
    country: scope.country
  });

  const baselineOrderRows = await fetchDailyOrdersRows({
    db: scope.db,
    store: scope.store,
    startDate: scope.anchorRange.startDate,
    endDate: scope.anchorRange.endDate,
    country: scope.country
  });

  const baselineSeries = mergeDailySeries({
    dateRange: listDateRange(scope.anchorRange.startDate, scope.anchorRange.endDate),
    metaRows: baselineMetaRows,
    orderRows: baselineOrderRows
  });

  const peerMetaRows = fetchDailyMetaRows({
    db: scope.db,
    store: scope.store,
    levelConfig: scope.levelConfig,
    startDate: scope.anchorRange.startDate,
    endDate: scope.anchorRange.endDate,
    entityId: null,
    country: scope.country
  });

  const peerSeries = mergeDailySeries({
    dateRange: listDateRange(scope.anchorRange.startDate, scope.anchorRange.endDate),
    metaRows: peerMetaRows,
    orderRows: baselineOrderRows
  });

  return {
    baselineSeries,
    peerSeries
  };
}

export async function getCampaignIntelligenceSnapshot(query = {}) {
  const scope = normalizeCampaignIntelligenceRequest(query);
  const modelSettings = resolveModelSettings(query);

  const entityOptions = fetchEntityOptions(scope);
  const selectedEntityId = ensureEntityFallback(scope.entityId, entityOptions);

  const analysisMetaRows = fetchDailyMetaRows({
    db: scope.db,
    store: scope.store,
    levelConfig: scope.levelConfig,
    startDate: scope.analysisRange.startDate,
    endDate: scope.analysisRange.endDate,
    entityId: selectedEntityId,
    country: scope.country
  });

  const analysisOrderRows = await fetchDailyOrdersRows({
    db: scope.db,
    store: scope.store,
    startDate: scope.analysisRange.startDate,
    endDate: scope.analysisRange.endDate,
    country: scope.country
  });

  const analysisSeries = mergeDailySeries({
    dateRange: listDateRange(scope.analysisRange.startDate, scope.analysisRange.endDate),
    metaRows: analysisMetaRows,
    orderRows: analysisOrderRows
  });

  const baselineData = await getScopedBaselineRows({ scope: { ...scope, entityId: selectedEntityId } });

  const shockAwareSeries = buildShockAwareSeries(analysisSeries);
  const shockAwareBaselineSeries = buildShockAwareSeries(baselineData.baselineSeries);
  const shockAwarePeerSeries = buildShockAwareSeries(baselineData.peerSeries);

  const modelBundle = buildModelBundle({
    analysisSeries: shockAwareSeries,
    anchorSeries: shockAwareBaselineSeries,
    baselineSeries: shockAwarePeerSeries,
    store: scope.store,
    sentinelPreset: modelSettings.sentinelPreset,
    headroomPreset: modelSettings.headroomPreset,
    launchPreset: modelSettings.launchPreset,
    launchMinDays: modelSettings.launchMinDays,
    launchMaxDays: modelSettings.launchMaxDays,
    targetRoas: modelSettings.targetRoas,
    targetCpa: modelSettings.targetCpa,
    targetHorizonDays: modelSettings.targetHorizonDays,
    seedKey: `${scope.store}:${scope.level}:${selectedEntityId || 'all'}:${scope.country}:${scope.analysisRange.endDate}`
  });

  const budgetHistoryStartDate = addDaysIso(
    scope.analysisRange.endDate,
    -(BUDGET_MONITOR_CONFIG.monitorLookbackDays - 1)
  );

  const scopedCampaignIds = fetchScopedCampaignIds({
    db: scope.db,
    store: scope.store,
    levelConfig: scope.levelConfig,
    startDate: budgetHistoryStartDate,
    endDate: scope.analysisRange.endDate,
    entityId: selectedEntityId,
    country: scope.country
  });

  const budgetHistoryEvents = await fetchMetaBudgetHistoryEvents({
    store: scope.store,
    startDate: budgetHistoryStartDate,
    endDate: scope.analysisRange.endDate,
    campaignIds: scopedCampaignIds
  });

  const budgetMonitor = buildBudgetChangeMonitor(shockAwareSeries, budgetHistoryEvents);
  const lifecycle = fetchScopeLifecycleSummary({ ...scope, entityId: selectedEntityId });
  const entitySnapshot = fetchEntitySnapshot({ ...scope, entityId: selectedEntityId });
  const countries = fetchCountryOptions({ ...scope, entityId: selectedEntityId });

  const analysisSummary = buildDailyAggregationSummary(shockAwareSeries);
  const anchorSummary = buildDailyAggregationSummary(shockAwareBaselineSeries);

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    scope: {
      store: scope.store,
      level: scope.level,
      entityId: selectedEntityId,
      country: scope.country,
      analysisStartDate: scope.analysisRange.startDate,
      analysisEndDate: scope.analysisRange.endDate,
      anchorStartDate: scope.anchorRange.startDate,
      anchorEndDate: scope.anchorRange.endDate,
      anchorSource: scope.anchorRange.source
    },
    settings: {
      beforeAfterWindowDays: scope.beforeAfterWindowDays,
      sentinelPreset: modelSettings.sentinelPreset,
      headroomPreset: modelSettings.headroomPreset,
      launchPreset: modelSettings.launchPreset,
      launchMinDays: modelSettings.launchMinDays,
      launchMaxDays: modelSettings.launchMaxDays,
      targetRoas: modelSettings.targetRoas,
      targetCpa: modelSettings.targetCpa,
      targetHorizonDays: modelSettings.targetHorizonDays
    },
    selectors: {
      levels: buildLevelsList(),
      entities: entityOptions,
      countries: [{ code: 'ALL', spend: 0, conversions: 0 }, ...countries],
      lifecycle
    },
    entitySnapshot,
    summary: {
      analysis: analysisSummary,
      anchor: anchorSummary
    },
    timeline: {
      daily: attachSmoothedSeries(shockAwareSeries),
      anchorDaily: attachSmoothedSeries(shockAwareBaselineSeries)
    },
    budgetMonitor,
    models: modelBundle,
    education: EDUCATION_SECTIONS
  };
}
