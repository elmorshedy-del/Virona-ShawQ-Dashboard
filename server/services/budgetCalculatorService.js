import { getDb } from '../db/database.js';
import { buildStatusFilter } from '../features/meta-awareness/index.js';
import {
  calculateBudgetCurve,
  formatCurrency,
  safeDivide
} from '../utils/budgetCalculator.js';

function getDateRange(params, prefix) {
  const startKey = `${prefix}StartDate`;
  const endKey = `${prefix}EndDate`;
  if (!params[startKey] || !params[endKey]) {
    return { error: `Missing ${prefix} date range.` };
  }

  const startDate = params[startKey];
  const endDate = params[endKey];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1;
  return { startDate, endDate, days };
}

function getCampaignRows(db, store, campaignId, dateRange, statusFilter) {
  return db.prepare(`
    SELECT
      date,
      spend,
      conversions,
      conversion_value,
      country,
      campaign_name
    FROM meta_daily_metrics
    WHERE store = ? AND campaign_id = ? AND date BETWEEN ? AND ?${statusFilter}
  `).all(store, campaignId, dateRange.startDate, dateRange.endDate);
}

function findCampaignByName(db, store, keyword) {
  const row = db.prepare(`
    SELECT
      campaign_id as campaignId,
      campaign_name as campaignName,
      MIN(date) as startDate,
      MAX(date) as endDate
    FROM meta_daily_metrics
    WHERE store = ?
      AND LOWER(campaign_name) LIKE ?
    GROUP BY campaign_id, campaign_name
    ORDER BY SUM(spend) DESC
    LIMIT 1
  `).get(store, `%${keyword.toLowerCase()}%`);

  if (!row?.campaignId) {
    return null;
  }

  const startDate = row.startDate;
  const endDate = row.endDate;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1;

  return {
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    dateRange: { startDate, endDate, days }
  };
}

function groupByCountry(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const code = row.country || 'ALL';
    if (!map.has(code)) {
      map.set(code, []);
    }
    map.get(code).push(row);
  });
  return map;
}

function summarizeCountry(rows, dateRange) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.spend += Number(row.spend || 0);
      acc.conversions += Number(row.conversions || 0);
      acc.revenue += Number(row.conversion_value || 0);
      acc.campaignName = acc.campaignName || row.campaign_name;
      return acc;
    },
    { spend: 0, conversions: 0, revenue: 0, campaignName: null }
  );

  const days = dateRange.days;
  return {
    ...totals,
    dailySpend: safeDivide(totals.spend, days),
    dailyConversions: safeDivide(totals.conversions, days),
    aov: safeDivide(totals.revenue, totals.conversions),
    dateRange
  };
}

function formatDateRange(range) {
  if (!range?.startDate || !range?.endDate) return 'n/a';
  return `${range.startDate} → ${range.endDate}`;
}

function formatTableRows(rows) {
  return rows.map((row) => ({
    Country: row.country,
    'White Friday Range': formatDateRange(row.whiteFriday.dateRange),
    'Winter Range': formatDateRange(row.winter.dateRange),
    'White Friday Spend/Day': formatCurrency(row.whiteFriday.dailySpend),
    'White Friday Conversions/Day': row.whiteFriday.dailyConversions.toFixed(2),
    'Winter Spend/Day': formatCurrency(row.winter.dailySpend),
    'Winter Conversions/Day': row.winter.dailyConversions.toFixed(2),
    'Blended AOV': formatCurrency(row.aov),
    'B (Decay)': row.b.toFixed(2),
    'Optimal Spend': formatCurrency(row.optimalSpend),
    'Ad Breakeven': formatCurrency(row.adBreakeven),
    'Real Ceiling': formatCurrency(row.realCeiling),
    'Max Daily Profit': formatCurrency(row.maxDailyProfit)
  }));
}

export function getCampaignBudgetReport(store, params) {
  const db = getDb();
  const statusFilter = buildStatusFilter(params);
  const margin = Number(params.margin || 35);
  const overhead = Number(params.overhead || 0);

  let whiteCampaignId = params.whiteFridayCampaignId;
  let winterCampaignId = params.winterCampaignId;
  let whiteRange = getDateRange(params, 'whiteFriday');
  let winterRange = getDateRange(params, 'winter');

  if (!whiteCampaignId || !winterCampaignId || whiteRange.error || winterRange.error) {
    const whiteCampaign = findCampaignByName(db, store, 'white friday');
    const winterCampaign = findCampaignByName(db, store, 'shawq winter');

    if (!whiteCampaign || !winterCampaign) {
      return { error: 'Missing campaign IDs and could not auto-detect campaigns.' };
    }

    whiteCampaignId = whiteCampaign.campaignId;
    winterCampaignId = winterCampaign.campaignId;
    whiteRange = whiteCampaign.dateRange;
    winterRange = winterCampaign.dateRange;
  }

  const whiteRows = getCampaignRows(db, store, whiteCampaignId, whiteRange, statusFilter);
  const winterRows = getCampaignRows(db, store, winterCampaignId, winterRange, statusFilter);
  const whiteByCountry = groupByCountry(whiteRows);
  const winterByCountry = groupByCountry(winterRows);

  const results = [];
  const warnings = [];
  whiteByCountry.forEach((whiteRowsByCountry, country) => {
    const winterRowsByCountry = winterByCountry.get(country);
    if (!winterRowsByCountry) return;

    const whiteSummary = summarizeCountry(whiteRowsByCountry, whiteRange);
    const winterSummary = summarizeCountry(winterRowsByCountry, winterRange);
    if (!whiteSummary.dailySpend || !winterSummary.dailySpend || !whiteSummary.dailyConversions || !winterSummary.dailyConversions) {
      warnings.push({ country, reason: 'Missing daily spend/conversions.' });
      return;
    }

    const blendedAov = safeDivide(
      whiteSummary.revenue + winterSummary.revenue,
      whiteSummary.conversions + winterSummary.conversions
    );
    if (!blendedAov) {
      warnings.push({ country, reason: 'Missing blended AOV.' });
      return;
    }

    const curve = calculateBudgetCurve({
      spend1: whiteSummary.dailySpend,
      conv1: whiteSummary.dailyConversions,
      spend2: winterSummary.dailySpend,
      conv2: winterSummary.dailyConversions,
      aov: blendedAov,
      margin: margin / 100,
      monthlyOverhead: overhead
    });

    if (curve.error) {
      warnings.push({ country, reason: curve.error });
      return;
    }

    results.push({
      country,
      whiteFriday: whiteSummary,
      winter: winterSummary,
      aov: blendedAov,
      b: curve.B,
      optimalSpend: curve.optimal,
      adBreakeven: curve.ceiling,
      realCeiling: curve.realCeiling,
      maxDailyProfit: curve.profitAtOptimal
    });
  });

  return {
    whiteFriday: {
      campaignId: whiteCampaignId,
      dateRange: whiteRange
    },
    winter: {
      campaignId: winterCampaignId,
      dateRange: winterRange
    },
    margin,
    overhead,
    tables: formatTableRows(results),
    warnings
  };
}
