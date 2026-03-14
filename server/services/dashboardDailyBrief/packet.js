import {
  DASHBOARD_DAILY_BRIEF_PACKET_LIMITS,
  DASHBOARD_DAILY_BRIEF_THRESHOLDS
} from './constants.js';
import { normalizeDashboardDailyBriefIncludeConfig } from './options.js';

const RATE_DECIMALS = 4;
const AMOUNT_DECIMALS = 2;
const PERCENT_MULTIPLIER = 100;

function toFiniteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundValue(value, digits = RATE_DECIMALS) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeRate(value) {
  return roundValue(toFiniteOrNull(value), RATE_DECIMALS);
}

function normalizeAmount(value) {
  return roundValue(toFiniteOrNull(value), AMOUNT_DECIMALS);
}

function normalizeCount(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
}

function safeDivide(numerator, denominator, fallback = 0) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) {
    return fallback;
  }
  return top / bottom;
}

function calcDeltaRatio(currentValue, baselineValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || baselineValue === 0) {
    return null;
  }
  return (currentValue - baselineValue) / Math.abs(baselineValue);
}

function buildWindowSummary(rows = []) {
  const totals = rows.reduce((accumulator, row) => {
    accumulator.spend += Number(row?.spend) || 0;
    accumulator.metaPurchases += Number(row?.conversions) || 0;
    accumulator.shopifyOrders += Number(row?.orders) || 0;
    accumulator.revenue += Number(row?.revenue) || 0;
    accumulator.impressions += Number(row?.impressions) || 0;
    accumulator.clicks += Number(row?.clicks) || 0;
    accumulator.landingPageViews += Number(row?.landingPageViews) || 0;
    accumulator.addToCart += Number(row?.addToCart) || 0;
    accumulator.checkoutsInitiated += Number(row?.checkoutsInitiated) || 0;
    return accumulator;
  }, {
    spend: 0,
    metaPurchases: 0,
    shopifyOrders: 0,
    revenue: 0,
    impressions: 0,
    clicks: 0,
    landingPageViews: 0,
    addToCart: 0,
    checkoutsInitiated: 0
  });

  return {
    spend: normalizeAmount(totals.spend),
    metaPurchases: normalizeCount(totals.metaPurchases),
    shopifyOrders: normalizeCount(totals.shopifyOrders),
    revenue: normalizeAmount(totals.revenue),
    ctr: normalizeRate(safeDivide(totals.clicks, totals.impressions, null)),
    lpvClick: normalizeRate(safeDivide(totals.landingPageViews, totals.clicks, null)),
    atcLpv: normalizeRate(safeDivide(totals.addToCart, totals.landingPageViews, null)),
    icAtc: normalizeRate(safeDivide(totals.checkoutsInitiated, totals.addToCart, null)),
    purchaseIc: normalizeRate(safeDivide(totals.metaPurchases, totals.checkoutsInitiated, null)),
    roas: normalizeRate(safeDivide(totals.revenue, totals.spend, null))
  };
}

function buildDeltaBlock(current, baseline) {
  return {
    spend: roundValue(calcDeltaRatio(current?.spend, baseline?.spend), RATE_DECIMALS),
    shopifyOrders: roundValue(calcDeltaRatio(current?.shopifyOrders, baseline?.shopifyOrders), RATE_DECIMALS),
    revenue: roundValue(calcDeltaRatio(current?.revenue, baseline?.revenue), RATE_DECIMALS),
    ctr: roundValue(calcDeltaRatio(current?.ctr, baseline?.ctr), RATE_DECIMALS),
    lpvClick: roundValue(calcDeltaRatio(current?.lpvClick, baseline?.lpvClick), RATE_DECIMALS),
    atcLpv: roundValue(calcDeltaRatio(current?.atcLpv, baseline?.atcLpv), RATE_DECIMALS),
    icAtc: roundValue(calcDeltaRatio(current?.icAtc, baseline?.icAtc), RATE_DECIMALS),
    purchaseIc: roundValue(calcDeltaRatio(current?.purchaseIc, baseline?.purchaseIc), RATE_DECIMALS),
    roas: roundValue(calcDeltaRatio(current?.roas, baseline?.roas), RATE_DECIMALS)
  };
}

function buildFunnelDeltaBlock(current, baseline) {
  return {
    ctr: roundValue(calcDeltaRatio(current?.ctr, baseline?.ctr), RATE_DECIMALS),
    lpvClick: roundValue(calcDeltaRatio(current?.lpvClick, baseline?.lpvClick), RATE_DECIMALS),
    atcLpv: roundValue(calcDeltaRatio(current?.atcLpv, baseline?.atcLpv), RATE_DECIMALS),
    icAtc: roundValue(calcDeltaRatio(current?.icAtc, baseline?.icAtc), RATE_DECIMALS),
    purchaseIc: roundValue(calcDeltaRatio(current?.purchaseIc, baseline?.purchaseIc), RATE_DECIMALS),
    roas: roundValue(calcDeltaRatio(current?.roas, baseline?.roas), RATE_DECIMALS)
  };
}

function buildAccountContext(dailyRows = []) {
  const lastIndex = dailyRows.length - 1;
  const closedDayRow = lastIndex >= 0 ? dailyRows[lastIndex] : null;
  const priorDayRow = lastIndex >= 1 ? dailyRows[lastIndex - 1] : null;
  const sevenDayBaselineRows = dailyRows.slice(Math.max(0, dailyRows.length - 8), Math.max(0, dailyRows.length - 1));
  const priorSevenRows = dailyRows.slice(Math.max(0, dailyRows.length - 15), Math.max(0, dailyRows.length - 8));

  const closedDay = buildWindowSummary(closedDayRow ? [closedDayRow] : []);
  const priorDay = buildWindowSummary(priorDayRow ? [priorDayRow] : []);
  const sevenDayBaseline = buildWindowSummary(sevenDayBaselineRows);
  const priorSeven = buildWindowSummary(priorSevenRows);

  return {
    closedDayDate: closedDayRow?.date || null,
    closedDay,
    priorDayDate: priorDayRow?.date || null,
    priorDay,
    sevenDayBaseline,
    priorSeven,
    vsPriorDay: buildDeltaBlock(closedDay, priorDay),
    vsSevenDayBaseline: buildDeltaBlock(closedDay, sevenDayBaseline)
  };
}

function buildTimelineRows(dailyRows = [], recentChanges = []) {
  const eventDateSet = new Set((recentChanges || []).map((event) => String(event?.date || '').trim()).filter(Boolean));
  return dailyRows
    .slice(-DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentTimelineRows)
    .map((row) => ({
      date: row?.date || null,
      spend: normalizeAmount(row?.spend),
      metaPurchases: normalizeCount(row?.conversions),
      shopifyOrders: normalizeCount(row?.orders),
      revenue: normalizeAmount(row?.revenue),
      ctrPct: roundValue(toFiniteOrNull(row?.ctr) * PERCENT_MULTIPLIER, 2),
      lpvClickPct: roundValue(safeDivide(row?.landingPageViews, row?.clicks, null) * PERCENT_MULTIPLIER, 2),
      atcLpvPct: roundValue(safeDivide(row?.addToCart, row?.landingPageViews, null) * PERCENT_MULTIPLIER, 2),
      icAtcPct: roundValue(safeDivide(row?.checkoutsInitiated, row?.addToCart, null) * PERCENT_MULTIPLIER, 2),
      purchaseIcPct: roundValue(safeDivide(row?.conversions, row?.checkoutsInitiated, null) * PERCENT_MULTIPLIER, 2),
      roas: normalizeRate(safeDivide(row?.revenue, row?.spend, null)),
      budgetEvent: eventDateSet.has(String(row?.date || '').trim())
    }));
}

function buildEntityFlags({ row, accountRoas, accountSpend }) {
  const flags = [];
  const spend = toFiniteOrNull(row?.metrics?.now?.spend);
  const purchases = toFiniteOrNull(row?.metrics?.now?.purchases);
  const roas = toFiniteOrNull(row?.metrics?.now?.roas);
  const spendShare = safeDivide(spend, accountSpend, 0);
  const baselineRoas = toFiniteOrNull(row?.metrics?.baseline?.roas);
  const atcDelta = calcDeltaRatio(toFiniteOrNull(row?.metrics?.now?.atcLpv), toFiniteOrNull(row?.metrics?.baseline?.atcLpv));
  const purchaseIcDelta = calcDeltaRatio(toFiniteOrNull(row?.metrics?.now?.purchaseIc), toFiniteOrNull(row?.metrics?.baseline?.purchaseIc));

  if (spendShare >= DASHBOARD_DAILY_BRIEF_THRESHOLDS.zeroPurchaseSpendShare && (!Number.isFinite(purchases) || purchases <= 0)) {
    flags.push('zero_purchase_spend');
  }
  if (spendShare >= DASHBOARD_DAILY_BRIEF_THRESHOLDS.significantSpendShare && Number.isFinite(roas) && Number.isFinite(accountRoas) && roas < (accountRoas * DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRoasRatioVsAccount)) {
    flags.push('weak_roas');
  }
  if (Number.isFinite(atcDelta) && atcDelta <= DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRateDeltaRatio) {
    flags.push('atc_lpv_down');
  }
  if (Number.isFinite(purchaseIcDelta) && purchaseIcDelta <= DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRateDeltaRatio) {
    flags.push('purchase_ic_down');
  }
  if (spendShare >= DASHBOARD_DAILY_BRIEF_THRESHOLDS.significantSpendShare && Number.isFinite(roas) && Number.isFinite(accountRoas) && roas >= (accountRoas * DASHBOARD_DAILY_BRIEF_THRESHOLDS.strongRoasRatioVsAccount) && Number.isFinite(purchases) && purchases > 0) {
    flags.push('winner');
  }
  if ((!Number.isFinite(baselineRoas) || baselineRoas <= 0) && Number.isFinite(purchases) && purchases > 0) {
    flags.push('new_conversion_signal');
  }

  return flags;
}

function mapHierarchyRow(row, accountRoas, accountSpend) {
  const now = row?.metrics?.now || {};
  const baseline = row?.metrics?.baseline || {};

  return {
    id: row.id,
    level: row.level,
    name: row.name,
    campaignName: row.campaignName || null,
    adsetName: row.adsetName || null,
    spend: normalizeAmount(now.spend),
    spendShare: roundValue(safeDivide(now.spend, accountSpend, 0), RATE_DECIMALS),
    metaPurchases: normalizeCount(now.purchases),
    roas: normalizeRate(now.roas),
    ctrPct: roundValue(toFiniteOrNull(now.ctr) * PERCENT_MULTIPLIER, 2),
    lpvClickPct: roundValue(toFiniteOrNull(now.lpvClick) * PERCENT_MULTIPLIER, 2),
    atcLpvPct: roundValue(toFiniteOrNull(now.atcLpv) * PERCENT_MULTIPLIER, 2),
    icAtcPct: roundValue(toFiniteOrNull(now.icAtc) * PERCENT_MULTIPLIER, 2),
    purchaseIcPct: roundValue(toFiniteOrNull(now.purchaseIc) * PERCENT_MULTIPLIER, 2),
    baseline: {
      roas: normalizeRate(baseline.roas),
      ctrPct: roundValue(toFiniteOrNull(baseline.ctr) * PERCENT_MULTIPLIER, 2),
      lpvClickPct: roundValue(toFiniteOrNull(baseline.lpvClick) * PERCENT_MULTIPLIER, 2),
      atcLpvPct: roundValue(toFiniteOrNull(baseline.atcLpv) * PERCENT_MULTIPLIER, 2),
      icAtcPct: roundValue(toFiniteOrNull(baseline.icAtc) * PERCENT_MULTIPLIER, 2),
      purchaseIcPct: roundValue(toFiniteOrNull(baseline.purchaseIc) * PERCENT_MULTIPLIER, 2)
    },
    delta: buildFunnelDeltaBlock(now, baseline),
    flags: buildEntityFlags({ row, accountRoas, accountSpend })
  };
}

function filterFlaggedRows(rows = [], limit) {
  const flagged = rows.filter((row) => Array.isArray(row.flags) && row.flags.length > 0);
  if (flagged.length >= limit) {
    return flagged.slice(0, limit);
  }
  return rows.slice(0, limit);
}

function buildGeoFlags(row, accountRoas) {
  const flags = [];
  const roas = toFiniteOrNull(row?.roas);
  const baselineRoas = toFiniteOrNull(row?.baseline?.roas);
  const purchaseIcDelta = calcDeltaRatio(
    toFiniteOrNull(row?.purchaseIc),
    toFiniteOrNull(row?.baseline?.purchaseIc)
  );
  const roasDelta = calcDeltaRatio(roas, baselineRoas);

  if (Number.isFinite(roas) && Number.isFinite(accountRoas) && roas < (accountRoas * DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRoasRatioVsAccount)) {
    flags.push('weak_roas');
  }
  if (Number.isFinite(roasDelta) && roasDelta <= DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRateDeltaRatio) {
    flags.push('roas_down_vs_baseline');
  }
  if (Number.isFinite(purchaseIcDelta) && purchaseIcDelta <= DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRateDeltaRatio) {
    flags.push('purchase_ic_down');
  }

  return flags;
}

function mapGeoRow(row, accountRoas) {
  return {
    code: row?.code || '??',
    spend: normalizeAmount(row?.spend),
    metaPurchases: normalizeCount(row?.metaPurchases),
    roas: normalizeRate(row?.roas),
    ctrPct: roundValue(toFiniteOrNull(row?.ctr) * PERCENT_MULTIPLIER, 2),
    lpvClickPct: roundValue(toFiniteOrNull(row?.lpvClick) * PERCENT_MULTIPLIER, 2),
    atcLpvPct: roundValue(toFiniteOrNull(row?.atcLpv) * PERCENT_MULTIPLIER, 2),
    icAtcPct: roundValue(toFiniteOrNull(row?.icAtc) * PERCENT_MULTIPLIER, 2),
    purchaseIcPct: roundValue(toFiniteOrNull(row?.purchaseIc) * PERCENT_MULTIPLIER, 2),
    baseline: {
      roas: normalizeRate(row?.baseline?.roas),
      ctrPct: roundValue(toFiniteOrNull(row?.baseline?.ctr) * PERCENT_MULTIPLIER, 2),
      lpvClickPct: roundValue(toFiniteOrNull(row?.baseline?.lpvClick) * PERCENT_MULTIPLIER, 2),
      atcLpvPct: roundValue(toFiniteOrNull(row?.baseline?.atcLpv) * PERCENT_MULTIPLIER, 2),
      icAtcPct: roundValue(toFiniteOrNull(row?.baseline?.icAtc) * PERCENT_MULTIPLIER, 2),
      purchaseIcPct: roundValue(toFiniteOrNull(row?.baseline?.purchaseIc) * PERCENT_MULTIPLIER, 2)
    },
    delta: buildFunnelDeltaBlock(row, row?.baseline || {}),
    flags: buildGeoFlags(row, accountRoas)
  };
}

function buildGlobalFlags(accountContext) {
  const flags = [];
  if (toFiniteOrNull(accountContext?.vsSevenDayBaseline?.shopifyOrders) <= DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRateDeltaRatio) {
    flags.push('shopify_orders_down_vs_7d');
  }
  if (toFiniteOrNull(accountContext?.vsSevenDayBaseline?.roas) <= DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRateDeltaRatio) {
    flags.push('roas_down_vs_7d');
  }
  if (toFiniteOrNull(accountContext?.vsSevenDayBaseline?.atcLpv) <= DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRateDeltaRatio) {
    flags.push('atc_lpv_down_vs_7d');
  }
  if (toFiniteOrNull(accountContext?.vsSevenDayBaseline?.purchaseIc) <= DASHBOARD_DAILY_BRIEF_THRESHOLDS.weakRateDeltaRatio) {
    flags.push('purchase_ic_down_vs_7d');
  }
  if (toFiniteOrNull(accountContext?.vsSevenDayBaseline?.shopifyOrders) >= DASHBOARD_DAILY_BRIEF_THRESHOLDS.strongRateDeltaRatio) {
    flags.push('shopify_orders_up_vs_7d');
  }
  return flags;
}

export function buildDashboardDailyBriefPacket({ source }) {
  const include = normalizeDashboardDailyBriefIncludeConfig(source?.include);
  const dailyRows = Array.isArray(source?.dailyRows) ? source.dailyRows : [];
  const accountContext = buildAccountContext(dailyRows);
  const accountRoas = toFiniteOrNull(accountContext?.closedDay?.roas)
    ?? toFiniteOrNull(accountContext?.sevenDayBaseline?.roas)
    ?? 0;
  const accountSpend = toFiniteOrNull(accountContext?.closedDay?.spend)
    ?? toFiniteOrNull(accountContext?.sevenDayBaseline?.spend)
    ?? 0;

  const hierarchyRows = Array.isArray(source?.hierarchyRows) ? source.hierarchyRows : [];
  const campaignRows = !include.campaigns ? [] : hierarchyRows
    .filter((row) => row.level === 'campaign')
    .map((row) => mapHierarchyRow(row, accountRoas, accountSpend))
    .slice(0, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.topCampaignRows);
  const adsetRows = !include.adSets ? [] : hierarchyRows
    .filter((row) => row.level === 'adset')
    .map((row) => mapHierarchyRow(row, accountRoas, accountSpend));
  const adRows = !include.ads ? [] : hierarchyRows
    .filter((row) => row.level === 'ad')
    .map((row) => mapHierarchyRow(row, accountRoas, accountSpend));
  const timelineRows = include.timeline ? buildTimelineRows(dailyRows, source?.recentChanges || []) : [];
  const geoRows = include.geos
    ? (Array.isArray(source?.geoRows) ? source.geoRows : [])
      .map((row) => mapGeoRow(row, accountRoas))
      .slice(0, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.topGeoRows)
    : [];
  const recentChanges = include.recentChanges && Array.isArray(source?.recentChanges) ? source.recentChanges : [];
  const recentEntityState = include.recentEntityState
    ? source?.recentEntityState || {
      campaigns: [],
      adSets: [],
      ads: []
    }
    : null;

  return {
    meta: {
      store: source?.store || null,
      scope: 'all_campaigns',
      briefDate: source?.briefDate || accountContext?.closedDayDate || null,
      analysisStartDate: source?.analysisStartDate || null,
      analysisEndDate: source?.analysisEndDate || null,
      anchorStartDate: source?.anchorStartDate || null,
      anchorEndDate: source?.anchorEndDate || null,
      include
    },
    account: include.account ? accountContext : null,
    lifecycle: null,
    recentTimeline: timelineRows,
    topCampaigns: campaignRows,
    flaggedAdSets: filterFlaggedRows(adsetRows, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.flaggedAdsetRows),
    flaggedAds: filterFlaggedRows(adRows, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.flaggedAdRows),
    topGeos: geoRows,
    recentChanges,
    recentEntityState,
    globalFlags: buildGlobalFlags(accountContext)
  };
}
