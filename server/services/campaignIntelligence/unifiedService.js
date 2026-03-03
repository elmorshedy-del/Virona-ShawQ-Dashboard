import {
  BRIEF_PROMPT_CONFIG,
  DEFAULT_SETTINGS,
  LEVEL_CONFIG
} from './constants.js';
import {
  fetchCountryOptions,
  fetchDailyMetaRows,
  fetchUnifiedHierarchyRows,
  normalizeCampaignIntelligenceRequest
} from './data.js';
import {
  addDaysIso,
  clampInt,
  listDateRange,
  round,
  safeDivide,
  toNumber
} from './utils.js';
import {
  buildCampaignIntelligenceBriefScopeKey,
  getCampaignIntelligenceBriefModelOptions,
  getCampaignIntelligenceBriefSettings,
  getLatestCampaignIntelligenceBrief
} from './briefs.js';

const UNIFIED_DEFAULT_WINDOW_DAYS = 14;
const UNIFIED_CACHE_TTL_MS = 30 * 1000;
const UNIFIED_CACHE_MAX_ENTRIES = 60;
const UNIFIED_CACHE = new Map();
const UNIFIED_CACHE_QUERY_KEYS = Object.freeze([
  'store',
  'country',
  'startDate',
  'endDate',
  'analysisWindowDays',
  'selectorLimit'
]);

function buildCacheKey(query = {}) {
  return UNIFIED_CACHE_QUERY_KEYS.map((key) => `${key}=${String(query?.[key] ?? '').trim()}`).join('&');
}

function pruneCache() {
  while (UNIFIED_CACHE.size > UNIFIED_CACHE_MAX_ENTRIES) {
    const oldestKey = UNIFIED_CACHE.keys().next().value;
    if (!oldestKey) break;
    UNIFIED_CACHE.delete(oldestKey);
  }
}

function getCached(cacheKey) {
  const entry = UNIFIED_CACHE.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    UNIFIED_CACHE.delete(cacheKey);
    return null;
  }
  return entry.payload || null;
}

function setCached(cacheKey, payload) {
  UNIFIED_CACHE.set(cacheKey, { expiresAt: Date.now() + UNIFIED_CACHE_TTL_MS, payload });
  pruneCache();
}

function buildBaselineRangeFromAnalysis(analysisRange) {
  const windowDays = listDateRange(analysisRange.startDate, analysisRange.endDate).length;
  const baselineEndDate = addDaysIso(analysisRange.startDate, -1);
  return {
    startDate: addDaysIso(baselineEndDate, -(windowDays - 1)),
    endDate: baselineEndDate,
    source: 'previous_window'
  };
}

function buildMetaDailySeries({ startDate, endDate, metaRows }) {
  const metaByDate = new Map(metaRows.map((row) => [row.date, row]));

  return listDateRange(startDate, endDate).map((date) => {
    const meta = metaByDate.get(date) || {};
    const spend = toNumber(meta.spend);
    const impressions = toNumber(meta.impressions);
    const reach = toNumber(meta.reach);
    const clicks = toNumber(meta.clicks);
    const landingPageViews = toNumber(meta.landingPageViews);
    const addToCart = toNumber(meta.addToCart);
    const checkoutsInitiated = toNumber(meta.checkoutsInitiated);
    const conversions = toNumber(meta.conversions);
    const conversionValue = toNumber(meta.conversionValue);

    return {
      date,
      spend: round(spend, 4),
      impressions: Math.round(impressions),
      reach: Math.round(reach),
      clicks: Math.round(clicks),
      landingPageViews: Math.round(landingPageViews),
      addToCart: Math.round(addToCart),
      checkoutsInitiated: Math.round(checkoutsInitiated),
      conversions: round(conversions, 4),
      conversionValue: round(conversionValue, 4),
      ctr: safeDivide(clicks, impressions),
      cvr: safeDivide(conversions, clicks),
      cpm: safeDivide(spend * 1000, impressions),
      lpvRate: safeDivide(landingPageViews, clicks),
      frequency: safeDivide(impressions, reach),
      roas: safeDivide(conversionValue, spend)
    };
  });
}

function buildMetaAggregationSummary(series) {
  const totals = series.reduce((accumulator, row) => {
    accumulator.spend += toNumber(row.spend);
    accumulator.impressions += toNumber(row.impressions);
    accumulator.reach += toNumber(row.reach);
    accumulator.clicks += toNumber(row.clicks);
    accumulator.landingPageViews += toNumber(row.landingPageViews);
    accumulator.addToCart += toNumber(row.addToCart);
    accumulator.checkoutsInitiated += toNumber(row.checkoutsInitiated);
    accumulator.conversions += toNumber(row.conversions);
    accumulator.conversionValue += toNumber(row.conversionValue);
    return accumulator;
  }, {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    landingPageViews: 0,
    addToCart: 0,
    checkoutsInitiated: 0,
    conversions: 0,
    conversionValue: 0
  });

  return {
    totals: {
      spend: round(totals.spend, 2),
      impressions: Math.round(totals.impressions),
      reach: Math.round(totals.reach),
      clicks: Math.round(totals.clicks),
      landingPageViews: Math.round(totals.landingPageViews),
      addToCart: Math.round(totals.addToCart),
      checkoutsInitiated: Math.round(totals.checkoutsInitiated),
      conversions: round(totals.conversions, 2),
      conversionValue: round(totals.conversionValue, 2)
    },
    rates: {
      ctr: safeDivide(totals.clicks, totals.impressions),
      cvr: safeDivide(totals.conversions, totals.clicks),
      cpm: safeDivide(totals.spend * 1000, totals.impressions),
      lpvRate: safeDivide(totals.landingPageViews, totals.clicks),
      roas: safeDivide(totals.conversionValue, totals.spend)
    }
  };
}

function normalizeUnifiedRequest(query = {}) {
  const normalizedWindowDays = clampInt(
    query.analysisWindowDays,
    3,
    60,
    UNIFIED_DEFAULT_WINDOW_DAYS
  );

  return normalizeCampaignIntelligenceRequest({
    ...query,
    level: 'campaign',
    entityId: null,
    analysisWindowDays: normalizedWindowDays,
    selectorLimit: clampInt(query.selectorLimit, 10, BRIEF_PROMPT_CONFIG.maxHierarchyRows, DEFAULT_SETTINGS.selectorLimit)
  });
}

export async function getCampaignIntelligenceUnifiedSnapshot(query = {}) {
  const cacheKey = buildCacheKey(query);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const scope = normalizeUnifiedRequest(query);
  const baselineRange = buildBaselineRangeFromAnalysis(scope.analysisRange);

  const analysisMetaRows = fetchDailyMetaRows({
    db: scope.db,
    store: scope.store,
    levelConfig: LEVEL_CONFIG.campaign,
    startDate: scope.analysisRange.startDate,
    endDate: scope.analysisRange.endDate,
    entityId: null,
    country: scope.country
  });

  const baselineMetaRows = fetchDailyMetaRows({
    db: scope.db,
    store: scope.store,
    levelConfig: LEVEL_CONFIG.campaign,
    startDate: baselineRange.startDate,
    endDate: baselineRange.endDate,
    entityId: null,
    country: scope.country
  });

  const analysisSeries = buildMetaDailySeries({
    startDate: scope.analysisRange.startDate,
    endDate: scope.analysisRange.endDate,
    metaRows: analysisMetaRows
  });

  const baselineSeries = buildMetaDailySeries({
    startDate: baselineRange.startDate,
    endDate: baselineRange.endDate,
    metaRows: baselineMetaRows
  });

  const countries = fetchCountryOptions({
    ...scope,
    level: 'campaign',
    levelConfig: LEVEL_CONFIG.campaign,
    entityId: null
  });

  const baselineCountries = fetchCountryOptions({
    ...scope,
    analysisRange: {
      startDate: baselineRange.startDate,
      endDate: baselineRange.endDate
    },
    level: 'campaign',
    levelConfig: LEVEL_CONFIG.campaign,
    entityId: null
  });

  const baselineCountryByCode = new Map(baselineCountries.map((row) => [row.code, row]));
  const mergedCountries = countries.map((row) => ({
    ...row,
    baseline: baselineCountryByCode.get(row.code) || null
  }));

  const hierarchyRows = fetchUnifiedHierarchyRows({
    db: scope.db,
    store: scope.store,
    analysisRange: scope.analysisRange,
    anchorRange: baselineRange,
    country: scope.country,
    selectorLimit: scope.selectorLimit,
    focusLevel: null,
    focusEntityId: null
  });

  const briefScopeKey = buildCampaignIntelligenceBriefScopeKey({
    level: 'campaign',
    entityId: null,
    country: scope.country
  });
  const briefSettings = getCampaignIntelligenceBriefSettings(scope.store);
  const latestBrief = getLatestCampaignIntelligenceBrief({
    store: scope.store,
    scopeKey: briefScopeKey
  });
  const briefModels = getCampaignIntelligenceBriefModelOptions();
  const briefProviderAvailability = briefModels.reduce((accumulator, modelDef) => ({
    ...accumulator,
    [modelDef.provider]: accumulator[modelDef.provider] || Boolean(modelDef.enabled)
  }), {});

  const generatedAt = new Date().toISOString();
  const snapshot = {
    success: true,
    generatedAt,
    scope: {
      store: scope.store,
      level: 'campaign',
      entityId: null,
      country: scope.country,
      analysisStartDate: scope.analysisRange.startDate,
      analysisEndDate: scope.analysisRange.endDate,
      anchorStartDate: baselineRange.startDate,
      anchorEndDate: baselineRange.endDate,
      anchorSource: baselineRange.source
    },
    selectors: {
      countries: [{ code: 'ALL', spend: 0, conversions: 0, baseline: null }, ...mergedCountries]
    },
    summary: {
      analysis: buildMetaAggregationSummary(analysisSeries),
      anchor: buildMetaAggregationSummary(baselineSeries)
    },
    timeline: {
      daily: analysisSeries,
      anchorDaily: baselineSeries
    },
    hierarchy: {
      rows: hierarchyRows
    },
    brief: {
      scopeKey: briefScopeKey,
      settings: briefSettings,
      latest: latestBrief,
      modelOptions: briefModels,
      providerAvailability: briefProviderAvailability
    }
  };

  setCached(cacheKey, snapshot);
  return snapshot;
}

export async function getCampaignIntelligenceUnifiedEntityTimeline(query = {}) {
  const scope = normalizeCampaignIntelligenceRequest({
    store: query.store,
    level: query.level,
    entityId: query.entityId,
    country: query.country,
    startDate: query.startDate,
    endDate: query.endDate,
    analysisWindowDays: query.analysisWindowDays,
    selectorLimit: 10
  });

  if (!scope.entityId) {
    const error = new Error('entityId is required');
    error.status = 400;
    throw error;
  }

  const metaRows = fetchDailyMetaRows({
    db: scope.db,
    store: scope.store,
    levelConfig: scope.levelConfig,
    startDate: scope.analysisRange.startDate,
    endDate: scope.analysisRange.endDate,
    entityId: scope.entityId,
    country: scope.country
  });

  const series = buildMetaDailySeries({
    startDate: scope.analysisRange.startDate,
    endDate: scope.analysisRange.endDate,
    metaRows
  });

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    scope: {
      store: scope.store,
      level: scope.level,
      entityId: scope.entityId,
      country: scope.country,
      analysisStartDate: scope.analysisRange.startDate,
      analysisEndDate: scope.analysisRange.endDate
    },
    timeline: {
      daily: series
    }
  };
}
