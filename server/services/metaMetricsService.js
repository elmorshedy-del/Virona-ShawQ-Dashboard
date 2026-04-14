import { getDashboard, getEfficiency, getTimeOfDay } from './analyticsService.js';
import { getSessionIntelligenceRealtimeOverview } from './sessionIntelligenceService.js';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

const DEFAULT_LIVE_WINDOW_MINUTES = 30;
const DEFAULT_LIVE_ROWS_LIMIT = 10;
const MAX_HIGHLIGHTED_DAYS = 6;
const MAX_TREND_GROUPS = 12;
const MAX_CAMPAIGN_OPTIONS = 20;
const PERCENT_SCALE = 100;
const AVERAGE_BUDGET_FALLBACK_DIVISOR = 1;
const STACKED_PANEL_BASELINES = {
  stories: 10800,
  casual: 9600,
  image: 8400,
  video: 7200
};
const AGE_BAR_TEMPLATE = [
  { label: '18', weight: 4200 },
  { weight: 5800 },
  { weight: 6800 },
  { label: '20', weight: 7600 },
  { weight: 8400 },
  { weight: 8600 },
  { weight: 8200 },
  { weight: 7800 },
  { weight: 7100 },
  { label: '30', weight: 6200 },
  { weight: 5100 },
  { weight: 3900 },
  { weight: 3000 },
  { label: '40', weight: 2100 },
  { weight: 1600 },
  { label: '50', weight: 1250 },
  { weight: 980 },
  { label: '60', weight: 720 }
];
const AGE_BUCKET_SLOT_MAP = {
  '13-17': [0, 1],
  '18-24': [2, 3, 4, 5],
  '25-34': [6, 7, 8, 9],
  '35-44': [10, 11, 12, 13],
  '45-54': [14, 15],
  '55-64': [16],
  '65+': [17],
  unknown: [17]
};
const DEFAULT_MEASURE_OPTIONS = [
  'Impressions',
  'Clicks',
  'Share',
  'Comment',
  'Purchase',
  'Engagement',
  'CTR',
  'Engagement Rate',
  'Conversion Rate',
  'Purchase Rate',
  'Total Budget',
  'Avg Budget'
];
const METRIC_COLOR_ORDER = ['cyan', 'indigo', 'teal', 'cyan', 'indigo', 'teal', 'cyan', 'indigo', 'teal', 'cyan', 'indigo', 'teal'];

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

function formatCompactNumber(value, digits = 1) {
  const numericValue = toNumber(value);
  if (numericValue >= 1_000_000) return `${(numericValue / 1_000_000).toFixed(digits)}M`;
  if (numericValue >= 1_000) return `${(numericValue / 1_000).toFixed(numericValue >= 10_000 ? 0 : digits)}K`;
  return `${Math.round(numericValue)}`;
}

function formatCompactCurrency(value, digits = 1) {
  const numericValue = toNumber(value);
  const prefix = '$';
  if (numericValue >= 1_000_000_000) return `${prefix}${(numericValue / 1_000_000_000).toFixed(digits)}B`;
  if (numericValue >= 1_000_000) return `${prefix}${(numericValue / 1_000_000).toFixed(digits)}M`;
  if (numericValue >= 1_000) return `${prefix}${(numericValue / 1_000).toFixed(digits)}K`;
  return `${prefix}${numericValue.toFixed(digits)}`;
}

function formatPercent(value, digits = 2) {
  const numericValue = toNumber(value);
  return `${numericValue.toFixed(digits)}%`;
}

function formatDeltaLabel(value) {
  const numericValue = toNumber(value);
  const sign = numericValue > 0 ? '+' : '';
  return `${sign}${numericValue.toFixed(1)}%`;
}

function takeLastRows(rows, limit) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.slice(Math.max(0, rows.length - limit));
}

function computeSeriesChange(series) {
  const values = (Array.isArray(series) ? series : [])
    .map((row) => toNumber(row))
    .filter((value) => Number.isFinite(value));

  if (values.length < 2) return 0;
  const midpoint = Math.max(1, Math.floor(values.length / 2));
  const startWindow = values.slice(0, midpoint);
  const endWindow = values.slice(values.length - midpoint);
  const startAverage = startWindow.reduce((sum, value) => sum + value, 0) / startWindow.length;
  const endAverage = endWindow.reduce((sum, value) => sum + value, 0) / endWindow.length;

  if (startAverage <= 0) {
    return endAverage > 0 ? PERCENT_SCALE : 0;
  }

  return ((endAverage - startAverage) / startAverage) * PERCENT_SCALE;
}

function resolveSegmentMagnitude(row) {
  const impressionValue = toNumber(row?.impressions);
  const clickValue = toNumber(row?.clicks);
  const purchaseValue = toNumber(row?.purchases);
  const spendValue = toNumber(row?.spend);

  if (impressionValue > 0) return impressionValue;
  if (clickValue > 0) return clickValue;
  if (purchaseValue > 0) return purchaseValue;
  return spendValue;
}

function resolveDateRange(query = {}) {
  const now = new Date();
  const today = formatDateAsGmt3(now);

  if (query.startDate && query.endDate) {
    return {
      startDate: String(query.startDate),
      endDate: String(query.endDate)
    };
  }

  if (query.yesterday === true || query.yesterday === '1') {
    const yesterday = formatDateAsGmt3(new Date(now.getTime() - (24 * 60 * 60 * 1000)));
    return { startDate: yesterday, endDate: yesterday };
  }

  const days = Number.isFinite(Number(query.days)) ? Math.max(1, Number(query.days)) : 7;
  const startDate = formatDateAsGmt3(new Date(now.getTime() - ((days - 1) * 24 * 60 * 60 * 1000)));
  return { startDate, endDate: today };
}

function buildStatusFilter(query = {}) {
  if (query.includeInactive === '1' || query.includeInactive === 'true' || query.includeInactive === true) {
    return '';
  }
  return " AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)";
}

function buildCampaignFilter(query = {}) {
  const campaignId = typeof query.campaignId === 'string' ? query.campaignId.trim() : '';
  if (!campaignId) return { clause: '', args: [] };
  return {
    clause: ' AND campaign_id = ?',
    args: [campaignId]
  };
}

function buildChannelFilter(query = {}) {
  const channel = String(query.channel || '').trim().toLowerCase();
  if (channel !== 'facebook' && channel !== 'instagram') {
    return { clause: '', args: [] };
  }
  return {
    clause: " AND LOWER(COALESCE(publisher_platform, '')) = ?",
    args: [channel]
  };
}

function getAgeGenderRowsFromMetaDaily(store, query = {}, range = null) {
  const db = getDb();
  const { startDate, endDate } = range || resolveDateRange(query);
  const statusClause = buildStatusFilter(query);
  const { clause: campaignClause, args: campaignArgs } = buildCampaignFilter(query);
  const { clause: channelClause, args: channelArgs } = buildChannelFilter(query);

  return db.prepare(`
    SELECT
      age,
      gender,
      SUM(impressions) as impressions,
      SUM(clicks) as clicks,
      SUM(conversions) as purchases,
      SUM(spend) as spend
    FROM meta_daily_metrics
    WHERE store = ?
      AND date BETWEEN ? AND ?
      AND age IS NOT NULL
      AND TRIM(age) != ''
      AND gender IS NOT NULL
      AND TRIM(gender) != ''
      ${statusClause}
      ${campaignClause}
      ${channelClause}
    GROUP BY age, gender
    ORDER BY SUM(impressions) DESC
  `).all(store, startDate, endDate, ...campaignArgs, ...channelArgs);
}

function buildMetricCards({ dashboard, efficiency }) {
  const sparklineData = Array.isArray(efficiency?.sparklineData) ? efficiency.sparklineData : [];
  const totalCampaigns = Math.max(toNumber(dashboard?.metaCampaignCount), AVERAGE_BUDGET_FALLBACK_DIVISOR);
  const avgBudget = safeDivide(toNumber(dashboard?.metaSpendTotal), totalCampaigns);

  const cardDefinitions = [
    {
      id: 'impressions',
      label: 'Impressions',
      value: formatCompactNumber(dashboard?.metaImpressionsTotal),
      change: formatDeltaLabel(computeSeriesChange(sparklineData.map((row) => row?.impressions))),
      sparkline: sparklineData.map((row) => toNumber(row?.impressions))
    },
    {
      id: 'clicks',
      label: 'Clicks',
      value: formatCompactNumber(dashboard?.metaClicksTotal),
      change: formatDeltaLabel(computeSeriesChange(sparklineData.map((row) => row?.clicks))),
      sparkline: sparklineData.map((row) => toNumber(row?.clicks))
    },
    {
      id: 'share',
      label: 'Share',
      value: formatCompactNumber(dashboard?.metaReachTotal),
      change: formatDeltaLabel(efficiency?.changes?.uniqueReach),
      sparkline: sparklineData.map((row) => toNumber(row?.reach))
    },
    {
      id: 'comment',
      label: 'Comment',
      value: formatCompactNumber(dashboard?.metaLpvTotal),
      change: formatDeltaLabel(efficiency?.changes?.lpvRate),
      sparkline: sparklineData.map((row) => toNumber(row?.lpv))
    },
    {
      id: 'purchase',
      label: 'Purchase',
      value: formatCompactNumber(dashboard?.metaConversionsTotal),
      change: formatDeltaLabel(computeSeriesChange(sparklineData.map((row) => row?.purchases))),
      sparkline: sparklineData.map((row) => toNumber(row?.purchases))
    },
    {
      id: 'engagement',
      label: 'Engagement',
      value: formatCompactNumber(dashboard?.metaAtcTotal),
      change: formatDeltaLabel(efficiency?.changes?.atcRate),
      sparkline: sparklineData.map((row) => toNumber(row?.atc))
    },
    {
      id: 'ctr',
      label: 'CTR (click through rate)',
      value: formatPercent(efficiency?.current?.ctr),
      change: formatDeltaLabel(efficiency?.changes?.ctr),
      sparkline: sparklineData.map((row) => safeDivide(toNumber(row?.clicks), Math.max(toNumber(row?.impressions), 1)) * PERCENT_SCALE)
    },
    {
      id: 'engRate',
      label: 'Engagement Rate',
      value: formatPercent(efficiency?.current?.lpvRate),
      change: formatDeltaLabel(efficiency?.changes?.lpvRate),
      sparkline: sparklineData.map((row) => safeDivide(toNumber(row?.lpv), Math.max(toNumber(row?.clicks), 1)) * PERCENT_SCALE)
    },
    {
      id: 'convRate',
      label: 'Conversion Rate',
      value: formatPercent(efficiency?.current?.cvr),
      change: formatDeltaLabel(efficiency?.changes?.cvr),
      sparkline: sparklineData.map((row) => safeDivide(toNumber(row?.purchases), Math.max(toNumber(row?.clicks), 1)) * PERCENT_SCALE)
    },
    {
      id: 'purchRate',
      label: 'Purchase Rate',
      value: formatPercent(efficiency?.current?.purchaseRate),
      change: formatDeltaLabel(efficiency?.changes?.purchaseRate),
      sparkline: sparklineData.map((row) => safeDivide(toNumber(row?.purchases), Math.max(toNumber(row?.impressions), 1)) * PERCENT_SCALE)
    },
    {
      id: 'totalBudget',
      label: 'Total Budget',
      value: formatCompactCurrency(dashboard?.metaSpendTotal),
      change: formatDeltaLabel(dashboard?.overview?.spendChange),
      sparkline: sparklineData.map((row) => toNumber(row?.spend))
    },
    {
      id: 'avgBudget',
      label: 'Avg Budget',
      value: formatCompactCurrency(avgBudget),
      change: formatDeltaLabel(dashboard?.overview?.spendChange),
      sparkline: sparklineData.map((row) => safeDivide(toNumber(row?.spend), totalCampaigns))
    }
  ];

  return cardDefinitions.map((card, index) => ({
    ...card,
    accentColor: METRIC_COLOR_ORDER[index]
  }));
}

function buildGenderData(ageGenderRows = []) {
  const resolvedRows = Array.isArray(ageGenderRows)
    ? ageGenderRows
    : [];

  if (resolvedRows.length === 0) {
    return {
      female: { count: '0', pct: '(0.0%)' },
      all: { count: '0', pct: '(0.0%)' },
      male: { count: '0', pct: '(0.0%)' }
    };
  }

  const totalsByGender = new Map();
  resolvedRows.forEach((row) => {
    const genderKey = String(row?.gender || 'unknown').toLowerCase();
    totalsByGender.set(genderKey, (totalsByGender.get(genderKey) || 0) + resolveSegmentMagnitude(row));
  });

  const female = toNumber(totalsByGender.get('female'));
  const male = toNumber(totalsByGender.get('male'));
  const middle = toNumber(totalsByGender.get('unknown') || totalsByGender.get('all'));
  const total = Math.max(female + male + middle, 1);

  return {
    female: {
      count: formatCompactNumber(female),
      pct: `(${((female / total) * PERCENT_SCALE).toFixed(1)}%)`
    },
    all: {
      count: formatCompactNumber(middle),
      pct: `(${((middle / total) * PERCENT_SCALE).toFixed(1)}%)`
    },
    male: {
      count: formatCompactNumber(male),
      pct: `(${((male / total) * PERCENT_SCALE).toFixed(1)}%)`
    }
  };
}

function buildAgeBars(ageGenderRows = []) {
  const resolvedRows = Array.isArray(ageGenderRows)
    ? ageGenderRows
    : [];

  const totalsByAge = new Map();
  resolvedRows.forEach((row) => {
    const ageKey = String(row?.age || 'unknown');
    totalsByAge.set(ageKey, (totalsByAge.get(ageKey) || 0) + resolveSegmentMagnitude(row));
  });

  const bars = AGE_BAR_TEMPLATE.map((slot) => ({ label: slot.label, value: 0 }));
  Object.entries(AGE_BUCKET_SLOT_MAP).forEach(([ageKey, slotIndexes]) => {
    const total = toNumber(totalsByAge.get(ageKey));
    if (total <= 0) return;

    const slotWeightTotal = slotIndexes.reduce((sum, slotIndex) => sum + AGE_BAR_TEMPLATE[slotIndex].weight, 0);
    slotIndexes.forEach((slotIndex) => {
      const slotWeight = AGE_BAR_TEMPLATE[slotIndex].weight;
      bars[slotIndex].value += total * safeDivide(slotWeight, slotWeightTotal);
    });
  });

  const hasValues = bars.some((bar) => bar.value > 0);
  return hasValues
    ? bars.map((bar) => ({ ...bar, value: Math.max(1, Math.round(bar.value)) }))
    : AGE_BAR_TEMPLATE.map((slot) => ({ label: slot.label, value: slot.weight }));
}

function buildWeekGroups(dashboard) {
  const trendRows = takeLastRows(dashboard?.trends, MAX_TREND_GROUPS);
  if (trendRows.length === 0) {
    return [
      { stories: 8400, casual: 9000, image: 7800, video: 6600 },
      { stories: 10200, casual: 9600, image: 8400, video: 7300, label: '20' },
      { stories: 9000, casual: 7800, image: 7200, video: 6000 },
      { stories: 10800, casual: 9000, image: 8400, video: 6600 },
      { stories: 9600, casual: 8400, image: 7200, video: 7800 },
      { stories: 10500, casual: 9000, image: 7500, video: 6300, label: '25' },
      { stories: 9900, casual: 8700, image: 7200, video: 6600 },
      { stories: 9300, casual: 8400, image: 7200, video: 6900 },
      { stories: 11100, casual: 9300, image: 7800, video: 7200, label: '30' },
      { stories: 10200, casual: 9000, image: 7500, video: 6600 },
      { stories: 9600, casual: 8400, image: 7200, video: 6300 },
      { stories: 10500, casual: 8700, image: 7500, video: 6600 }
    ];
  }

  const maxSpend = Math.max(...trendRows.map((row) => toNumber(row?.spend)), 1);
  const maxRevenue = Math.max(...trendRows.map((row) => toNumber(row?.revenue)), 1);
  const maxOrders = Math.max(...trendRows.map((row) => toNumber(row?.orders)), 1);
  const maxRoas = Math.max(...trendRows.map((row) => toNumber(row?.roas)), 1);

  return trendRows.map((row, index) => {
    const labelDate = row?.date ? new Date(`${row.date}T00:00:00Z`) : null;
    const label = labelDate && index % 3 === 1 ? `${labelDate.getUTCDate()}` : undefined;

    return {
      label,
      stories: Math.max(1, Math.round(safeDivide(toNumber(row?.orders), maxOrders) * STACKED_PANEL_BASELINES.stories)),
      casual: Math.max(1, Math.round(safeDivide(toNumber(row?.spend), maxSpend) * STACKED_PANEL_BASELINES.casual)),
      image: Math.max(1, Math.round(safeDivide(toNumber(row?.revenue), maxRevenue) * STACKED_PANEL_BASELINES.image)),
      video: Math.max(1, Math.round(safeDivide(toNumber(row?.roas), maxRoas) * STACKED_PANEL_BASELINES.video))
    };
  });
}

function buildHighlightedDays(dashboard) {
  const trendRows = Array.isArray(dashboard?.trends) ? dashboard.trends : [];
  const endDateKey = dashboard?.dateRange?.endDate;
  if (!endDateKey || trendRows.length === 0) return [];

  const endDate = new Date(`${endDateKey}T00:00:00Z`);
  const endMonth = endDate.getUTCMonth();
  const endYear = endDate.getUTCFullYear();

  return trendRows
    .map((row) => {
      const parsedDate = row?.date ? new Date(`${row.date}T00:00:00Z`) : null;
      return {
        day: parsedDate ? parsedDate.getUTCDate() : null,
        month: parsedDate ? parsedDate.getUTCMonth() : null,
        year: parsedDate ? parsedDate.getUTCFullYear() : null,
        spend: toNumber(row?.spend)
      };
    })
    .filter((row) => row.day && row.month === endMonth && row.year === endYear)
    .sort((left, right) => right.spend - left.spend)
    .slice(0, MAX_HIGHLIGHTED_DAYS)
    .map((row) => row.day)
    .sort((left, right) => left - right);
}

function buildHourlyData(timeOfDayData) {
  const rawRows = Array.isArray(timeOfDayData?.data) ? timeOfDayData.data : [];
  const resolvedRows = rawRows
    .map((row) => ({
      hour: Number.isFinite(Number(row?.hour)) ? Number(row.hour) : 0,
      value: Math.max(toNumber(row?.orders), toNumber(row?.budgetSpend))
    }))
    .sort((left, right) => left.hour - right.hour);

  if (resolvedRows.length > 0) return resolvedRows;

  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    value: Math.max(0, 300 - Math.abs(11 - hour) * 12)
  }));
}

const ACTIVE_STATUSES = new Set(['ACTIVE', 'UNKNOWN']);

function isEffectivelyActive(campaign) {
  const status = (campaign?.effective_status ?? '').toString().toUpperCase().trim();
  return !status || ACTIVE_STATUSES.has(status);
}

function buildCampaignOptions(dashboard) {
  const campaigns = Array.isArray(dashboard?.campaigns) ? dashboard.campaigns : [];
  const byId = new Map();

  campaigns.forEach((campaign) => {
    if (!isEffectivelyActive(campaign)) return;
    const campaignId = String(campaign?.campaignId || campaign?.campaign_id || '').trim();
    const campaignName = String(campaign?.campaignName || campaign?.campaign_name || '').trim();
    if (!campaignId || !campaignName) return;

    const existing = byId.get(campaignId);
    const spend = toNumber(campaign?.spend);
    if (!existing || spend > existing.spend) {
      byId.set(campaignId, { campaignId, campaignName, spend });
    }
  });

  const options = Array.from(byId.values())
    .sort((left, right) => right.spend - left.spend)
    .slice(0, MAX_CAMPAIGN_OPTIONS)
    .map(({ campaignId, campaignName }) => ({ campaignId, campaignName }));

  return [{ campaignId: '', campaignName: 'All Campaigns' }, ...options];
}

function buildLiveView(realtimeOverview) {
  const countries = Array.isArray(realtimeOverview?.breakdowns?.countries)
    ? realtimeOverview.breakdowns.countries
    : [];
  const focus = realtimeOverview?.breakdowns?.focus || {};

  return {
    updatedAt: realtimeOverview?.updatedAt || null,
    lastEventAt: realtimeOverview?.lastEventAt || null,
    countries,
    focusCountry: focus?.country || countries[0]?.value || null,
    focusRegions: Array.isArray(focus?.regions) ? focus.regions : [],
    focusCities: Array.isArray(focus?.cities) ? focus.cities : []
  };
}

export async function getMetaMetricsOverview({
  store = 'vironax',
  query = {},
  liveWindowMinutes = DEFAULT_LIVE_WINDOW_MINUTES
} = {}) {
  const scopedQuery = { ...query, store };
  const dashboard = getDashboard(store, scopedQuery);
  const efficiency = getEfficiency(store, scopedQuery);
  const timeOfDay = getTimeOfDay(store, scopedQuery);
  const ageGenderRows = getAgeGenderRowsFromMetaDaily(store, scopedQuery, dashboard?.dateRange || null);
  const realtimeOverview = getSessionIntelligenceRealtimeOverview(store, {
    windowMinutes: liveWindowMinutes,
    limit: DEFAULT_LIVE_ROWS_LIMIT
  });

  return {
    store,
    period: dashboard?.dateRange || null,
    filters: {
      measureOptions: DEFAULT_MEASURE_OPTIONS,
      campaignOptions: buildCampaignOptions(dashboard)
    },
    shell: {
      metrics: buildMetricCards({ dashboard, efficiency }),
      genderData: buildGenderData(ageGenderRows),
      ageBars: buildAgeBars(ageGenderRows),
      weekGroups: buildWeekGroups(dashboard),
      hourlyData: buildHourlyData(timeOfDay),
      highlightedDays: buildHighlightedDays(dashboard),
      countryLiveView: buildLiveView(realtimeOverview)
    }
  };
}

export async function getMetaMetricsGender({ store = 'vironax', query = {} } = {}) {
  const scopedQuery = { ...query, store };
  const ageGenderRows = getAgeGenderRowsFromMetaDaily(store, scopedQuery);
  return {
    store,
    genderData: buildGenderData(ageGenderRows)
  };
}

export async function getMetaMetricsAge({ store = 'vironax', query = {} } = {}) {
  const scopedQuery = { ...query, store };
  const ageGenderRows = getAgeGenderRowsFromMetaDaily(store, scopedQuery);
  return {
    store,
    ageBars: buildAgeBars(ageGenderRows)
  };
}
