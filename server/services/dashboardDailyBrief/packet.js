import {
  fetchCountryOptions,
  fetchEntityOptions,
  normalizeCampaignIntelligenceRequest
} from '../campaignIntelligence/data.js';
import { addDaysIso, round, safeDivide, toNumber } from '../campaignIntelligence/utils.js';
import {
  DASHBOARD_DAILY_BRIEF_DEFAULTS,
  DASHBOARD_DAILY_BRIEF_PACKET_LIMITS,
  DASHBOARD_DAILY_BRIEF_THRESHOLDS
} from './constants.js';

const RATE_DECIMALS = 4;
const AMOUNT_DECIMALS = 2;
const PERCENT_MULTIPLIER = 100;

function toFiniteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundOrNull(value, digits = RATE_DECIMALS) {
  return Number.isFinite(value) ? round(value, digits) : null;
}

function normalizeRate(value) {
  return roundOrNull(toFiniteOrNull(value), RATE_DECIMALS);
}

function normalizeAmount(value) {
  return roundOrNull(toFiniteOrNull(value), AMOUNT_DECIMALS);
}

function normalizeCount(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
}

function calcDeltaRatio(currentValue, baselineValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || baselineValue === 0) {
    return null;
  }
  return (currentValue - baselineValue) / Math.abs(baselineValue);
}

function buildWindowSummary(rows = []) {
  const totals = rows.reduce((accumulator, row) => {
    accumulator.spend += toNumber(row?.spend);
    accumulator.metaPurchases += toNumber(row?.conversions);
    accumulator.shopifyOrders += toNumber(row?.orders);
    accumulator.revenue += toNumber(row?.revenue);
    accumulator.impressions += toNumber(row?.impressions);
    accumulator.clicks += toNumber(row?.clicks);
    accumulator.landingPageViews += toNumber(row?.landingPageViews);
    accumulator.addToCart += toNumber(row?.addToCart);
    accumulator.checkoutsInitiated += toNumber(row?.checkoutsInitiated);
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
    metaPurchases: roundOrNull(totals.metaPurchases, RATE_DECIMALS),
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
    spend: roundOrNull(calcDeltaRatio(current?.spend, baseline?.spend), RATE_DECIMALS),
    shopifyOrders: roundOrNull(calcDeltaRatio(current?.shopifyOrders, baseline?.shopifyOrders), RATE_DECIMALS),
    revenue: roundOrNull(calcDeltaRatio(current?.revenue, baseline?.revenue), RATE_DECIMALS),
    ctr: roundOrNull(calcDeltaRatio(current?.ctr, baseline?.ctr), RATE_DECIMALS),
    lpvClick: roundOrNull(calcDeltaRatio(current?.lpvClick, baseline?.lpvClick), RATE_DECIMALS),
    atcLpv: roundOrNull(calcDeltaRatio(current?.atcLpv, baseline?.atcLpv), RATE_DECIMALS),
    icAtc: roundOrNull(calcDeltaRatio(current?.icAtc, baseline?.icAtc), RATE_DECIMALS),
    purchaseIc: roundOrNull(calcDeltaRatio(current?.purchaseIc, baseline?.purchaseIc), RATE_DECIMALS),
    roas: roundOrNull(calcDeltaRatio(current?.roas, baseline?.roas), RATE_DECIMALS)
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

function buildTimelineRows(dailyRows = [], budgetEvents = []) {
  const eventDateSet = new Set((budgetEvents || []).map((event) => String(event?.pivotDate || '').trim()).filter(Boolean));
  return dailyRows
    .slice(-DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentTimelineRows)
    .map((row) => ({
      date: row?.date || null,
      spend: normalizeAmount(row?.spend),
      metaPurchases: roundOrNull(toFiniteOrNull(row?.conversions), RATE_DECIMALS),
      shopifyOrders: normalizeCount(row?.orders),
      revenue: normalizeAmount(row?.revenue),
      ctrPct: roundOrNull(toFiniteOrNull(row?.ctr) * PERCENT_MULTIPLIER, 2),
      lpvClickPct: roundOrNull(safeDivide(toNumber(row?.landingPageViews), toNumber(row?.clicks), null) * PERCENT_MULTIPLIER, 2),
      atcLpvPct: roundOrNull(safeDivide(toNumber(row?.addToCart), toNumber(row?.landingPageViews), null) * PERCENT_MULTIPLIER, 2),
      icAtcPct: roundOrNull(safeDivide(toNumber(row?.checkoutsInitiated), toNumber(row?.addToCart), null) * PERCENT_MULTIPLIER, 2),
      purchaseIcPct: roundOrNull(safeDivide(toNumber(row?.conversions), toNumber(row?.checkoutsInitiated), null) * PERCENT_MULTIPLIER, 2),
      roas: normalizeRate(safeDivide(toNumber(row?.revenue), toNumber(row?.spend), null)),
      budgetEvent: eventDateSet.has(String(row?.date || '').trim())
    }));
}

function buildRecentEntityStateRows(entityRows = [], briefDate) {
  if (!briefDate) {
    return { recentLaunches: [], recentlyQuiet: [] };
  }

  const recentLaunchCutoff = addDaysIso(briefDate, -(DASHBOARD_DAILY_BRIEF_THRESHOLDS.recentLaunchDays - 1));
  const quietCutoff = addDaysIso(briefDate, -DASHBOARD_DAILY_BRIEF_THRESHOLDS.quietEntityDays);

  const recentLaunches = entityRows
    .filter((row) => row?.firstSeen && row.firstSeen >= recentLaunchCutoff)
    .slice(0, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentEntityRows)
    .map((row) => ({
      id: row.id,
      name: row.name,
      firstSeen: row.firstSeen,
      spend: normalizeAmount(row.spend),
      metaPurchases: normalizeCount(row.conversions)
    }));

  const recentlyQuiet = entityRows
    .filter((row) => row?.lastSeen && row.lastSeen <= quietCutoff)
    .slice(0, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentEntityRows)
    .map((row) => ({
      id: row.id,
      name: row.name,
      lastSeen: row.lastSeen,
      spend: normalizeAmount(row.spend),
      metaPurchases: normalizeCount(row.conversions)
    }));

  return { recentLaunches, recentlyQuiet };
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
    spendShare: roundOrNull(safeDivide(toNumber(now.spend), accountSpend, 0), RATE_DECIMALS),
    metaPurchases: normalizeCount(now.purchases),
    roas: normalizeRate(now.roas),
    ctrPct: roundOrNull(toFiniteOrNull(now.ctr) * PERCENT_MULTIPLIER, 2),
    lpvClickPct: roundOrNull(toFiniteOrNull(now.lpvClick) * PERCENT_MULTIPLIER, 2),
    atcLpvPct: roundOrNull(toFiniteOrNull(now.atcLpv) * PERCENT_MULTIPLIER, 2),
    icAtcPct: roundOrNull(toFiniteOrNull(now.icAtc) * PERCENT_MULTIPLIER, 2),
    purchaseIcPct: roundOrNull(toFiniteOrNull(now.purchaseIc) * PERCENT_MULTIPLIER, 2),
    baseline: {
      roas: normalizeRate(baseline.roas),
      ctrPct: roundOrNull(toFiniteOrNull(baseline.ctr) * PERCENT_MULTIPLIER, 2),
      lpvClickPct: roundOrNull(toFiniteOrNull(baseline.lpvClick) * PERCENT_MULTIPLIER, 2),
      atcLpvPct: roundOrNull(toFiniteOrNull(baseline.atcLpv) * PERCENT_MULTIPLIER, 2),
      icAtcPct: roundOrNull(toFiniteOrNull(baseline.icAtc) * PERCENT_MULTIPLIER, 2),
      purchaseIcPct: roundOrNull(toFiniteOrNull(baseline.purchaseIc) * PERCENT_MULTIPLIER, 2)
    },
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
    metaPurchases: normalizeCount(row?.conversions),
    roas: normalizeRate(row?.roas),
    ctrPct: roundOrNull(toFiniteOrNull(row?.ctr) * PERCENT_MULTIPLIER, 2),
    purchaseIcPct: roundOrNull(toFiniteOrNull(row?.purchaseIc) * PERCENT_MULTIPLIER, 2),
    baseline: {
      roas: normalizeRate(row?.baseline?.roas),
      ctrPct: roundOrNull(toFiniteOrNull(row?.baseline?.ctr) * PERCENT_MULTIPLIER, 2),
      purchaseIcPct: roundOrNull(toFiniteOrNull(row?.baseline?.purchaseIc) * PERCENT_MULTIPLIER, 2)
    },
    flags: buildGeoFlags(row, accountRoas)
  };
}

function buildRecentChangeRows(budgetMonitor = {}) {
  return (Array.isArray(budgetMonitor?.events) ? budgetMonitor.events : [])
    .slice(0, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentChangeRows)
    .map((event) => ({
      date: event?.pivotDate || null,
      fromBudget: normalizeAmount(event?.fromBudget),
      toBudget: normalizeAmount(event?.toBudget),
      budgetShiftPercent: roundOrNull(toFiniteOrNull(event?.budgetShiftPercent), 2),
      preSpendAvg: normalizeAmount(event?.preSpendAvg),
      postSpendAvg: normalizeAmount(event?.postSpendAvg),
      spendShiftPercent: roundOrNull(toFiniteOrNull(event?.shiftPercent), 2)
    }));
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

function buildEntityScope({ store, level, analysisStartDate, analysisEndDate, anchorStartDate, anchorEndDate, selectorLimit }) {
  return normalizeCampaignIntelligenceRequest({
    store,
    level,
    country: 'ALL',
    startDate: analysisStartDate,
    endDate: analysisEndDate,
    anchorStartDate,
    anchorEndDate,
    selectorLimit
  });
}

export function buildDashboardDailyBriefPacket({ snapshot, entityOptionGroups = {}, geoRows = [] }) {
  const dailyRows = Array.isArray(snapshot?.timeline?.daily) ? snapshot.timeline.daily : [];
  const accountContext = buildAccountContext(dailyRows);
  const analysisSummary = snapshot?.summary?.analysis || {};
  const accountRoas = toFiniteOrNull(analysisSummary?.rates?.roas)
    ?? toFiniteOrNull(accountContext?.sevenDayBaseline?.roas)
    ?? toFiniteOrNull(accountContext?.closedDay?.roas)
    ?? 0;
  const accountSpend = toFiniteOrNull(analysisSummary?.totals?.spend)
    ?? toFiniteOrNull(accountContext?.sevenDayBaseline?.spend)
    ?? toFiniteOrNull(accountContext?.closedDay?.spend)
    ?? 0;
  const hierarchyRows = Array.isArray(snapshot?.hierarchy?.rows) ? snapshot.hierarchy.rows : [];

  const campaignRows = hierarchyRows
    .filter((row) => row.level === 'campaign')
    .map((row) => mapHierarchyRow(row, accountRoas, accountSpend))
    .slice(0, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.topCampaignRows);

  const adsetRows = hierarchyRows
    .filter((row) => row.level === 'adset')
    .map((row) => mapHierarchyRow(row, accountRoas, accountSpend));

  const adRows = hierarchyRows
    .filter((row) => row.level === 'ad')
    .map((row) => mapHierarchyRow(row, accountRoas, accountSpend));

  const recentChanges = buildRecentChangeRows(snapshot?.budgetMonitor);
  const briefDate = String(snapshot?.scope?.analysisEndDate || accountContext?.closedDayDate || '').trim() || null;
  const recentCampaignState = buildRecentEntityStateRows(entityOptionGroups.campaign || [], briefDate);
  const recentAdsetState = buildRecentEntityStateRows(entityOptionGroups.adset || [], briefDate);
  const recentAdState = buildRecentEntityStateRows(entityOptionGroups.ad || [], briefDate);

  return {
    meta: {
      store: snapshot?.scope?.store || null,
      scope: 'all_campaigns',
      briefDate,
      analysisStartDate: snapshot?.scope?.analysisStartDate || null,
      analysisEndDate: snapshot?.scope?.analysisEndDate || null,
      anchorStartDate: snapshot?.scope?.anchorStartDate || null,
      anchorEndDate: snapshot?.scope?.anchorEndDate || null
    },
    account: accountContext,
    lifecycle: snapshot?.selectors?.lifecycle || null,
    recentTimeline: buildTimelineRows(dailyRows, snapshot?.budgetMonitor?.events || []),
    topCampaigns: campaignRows,
    flaggedAdSets: filterFlaggedRows(adsetRows, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.flaggedAdsetRows),
    flaggedAds: filterFlaggedRows(adRows, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.flaggedAdRows),
    topGeos: (geoRows || [])
      .map((row) => mapGeoRow(row, accountRoas))
      .slice(0, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.topGeoRows),
    recentChanges,
    recentEntityState: {
      campaigns: recentCampaignState,
      adSets: recentAdsetState,
      ads: recentAdState
    },
    globalFlags: buildGlobalFlags(accountContext)
  };
}

export function buildDashboardDailyBriefPacketContext({ snapshot }) {
  const analysisStartDate = snapshot?.scope?.analysisStartDate;
  const analysisEndDate = snapshot?.scope?.analysisEndDate;
  const anchorStartDate = snapshot?.scope?.anchorStartDate;
  const anchorEndDate = snapshot?.scope?.anchorEndDate;
  const store = snapshot?.scope?.store;
  const selectorLimit = DASHBOARD_DAILY_BRIEF_DEFAULTS.selectorLimit;

  const campaignScope = buildEntityScope({
    store,
    level: 'campaign',
    analysisStartDate,
    analysisEndDate,
    anchorStartDate,
    anchorEndDate,
    selectorLimit
  });
  const adsetScope = buildEntityScope({
    store,
    level: 'adset',
    analysisStartDate,
    analysisEndDate,
    anchorStartDate,
    anchorEndDate,
    selectorLimit
  });
  const adScope = buildEntityScope({
    store,
    level: 'ad',
    analysisStartDate,
    analysisEndDate,
    anchorStartDate,
    anchorEndDate,
    selectorLimit
  });

  return {
    entityOptionGroups: {
      campaign: fetchEntityOptions(campaignScope),
      adset: fetchEntityOptions(adsetScope),
      ad: fetchEntityOptions(adScope)
    },
    geoRows: fetchCountryOptions(campaignScope)
  };
}
