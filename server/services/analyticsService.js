import { getCountryInfo, getAllCountries } from '../utils/countryData.js';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

function getDateRange(params) {
  const now = new Date();
  const today = formatDateAsGmt3(now);
  
  if (params.startDate && params.endDate) {
    const start = new Date(params.startDate);
    const end = new Date(params.endDate);
    const days = Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1;
    return { startDate: params.startDate, endDate: params.endDate, days };
  }
  
  if (params.yesterday) {
    const yesterday = formatDateAsGmt3(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    return { startDate: yesterday, endDate: yesterday, days: 1 };
  }
  
  let days = 7;
  if (params.days) days = parseInt(params.days);
  else if (params.weeks) days = parseInt(params.weeks) * 7;
  else if (params.months) days = parseInt(params.months) * 30;
  
  const endDate = today;
  const startMs = now.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
  const startDate = formatDateAsGmt3(new Date(startMs));
  
  return { startDate, endDate, days };
}

export function getDashboard(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);

  // 1. CAMPAIGN DATA
  const campaignData = db.prepare(`
    SELECT 
      campaign_id as campaignId,
      campaign_name as campaignName,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversionValue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY campaign_name
    ORDER BY spend DESC
  `).all(store, startDate, endDate);

  const campaigns = campaignData.map(c => ({
    ...c,
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
    cr: c.clicks > 0 ? (c.conversions / c.clicks) * 100 : 0,
    metaRoas: c.spend > 0 ? c.conversionValue / c.spend : 0,
    metaAov: c.conversions > 0 ? c.conversionValue / c.conversions : 0,
    metaCac: c.conversions > 0 ? c.spend / c.conversions : 0,
    cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
    frequency: c.reach > 0 ? c.impressions / c.reach : 0
  }));

  // 2. TOTALS
  const metaTotals = db.prepare(`
    SELECT
      SUM(spend) as metaSpendTotal,
      SUM(conversion_value) as metaRevenueTotal,
      SUM(impressions) as impressions_total,
      SUM(reach) as reach_total,
      SUM(clicks) as clicks_total,
      SUM(landing_page_views) as lpv_total,
      SUM(add_to_cart) as atc_total,
      SUM(checkouts_initiated) as checkout_total,
      SUM(conversions) as conversions_total,
      COUNT(DISTINCT campaign_name) as campaign_count
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  const metaCampaignCount = metaTotals.campaign_count || 0;
  const metaSpendTotal = metaTotals.metaSpendTotal || 0;
  const metaRevenueTotal = metaTotals.metaRevenueTotal || 0;
  const conversions_total = metaTotals.conversions_total || 0;
  
  // 3. OVERVIEW (SWITCHED TO META ONLY as requested)
  const overview = {
    revenue: metaRevenueTotal, // Taking directly from Meta Pixel Revenue
    spend: metaSpendTotal,
    orders: conversions_total, // Taking directly from Meta Pixel Purchases
    sallaOrders: 0, // Ignored for now
    shopifyOrders: 0, // Ignored for now
    manualOrders: 0,
    aov: conversions_total > 0 ? metaRevenueTotal / conversions_total : 0,
    cac: conversions_total > 0 ? metaSpendTotal / conversions_total : 0,
    roas: metaSpendTotal > 0 ? metaRevenueTotal / metaSpendTotal : 0
  };

  // 4. META BY COUNTRY
  const metaByCountry = db.prepare(`
    SELECT 
      country as countryCode, 
      SUM(spend) as spend, 
      SUM(conversions) as conversions, 
      SUM(conversion_value) as conversionValue,
      SUM(impressions) as impressions,
      SUM(clicks) as clicks
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY country
  `).all(store, startDate, endDate);

  // 5. BUILD COUNTRY LIST (Dynamic - only if data exists)
  const countryMap = new Map();
  
  for (const m of metaByCountry) {
    // Skip if no spend and no conversions (Truly empty rows)
    if (!m.spend && !m.conversions) continue;

    if (!countryMap.has(m.countryCode)) {
      const info = getCountryInfo(m.countryCode);
      countryMap.set(m.countryCode, {
        code: m.countryCode, name: info.name, flag: info.flag,
        spend: 0, manualSpend: 0, metaOrders: 0, metaRevenue: 0,
        impressions: 0, clicks: 0,
        ecomOrders: 0, manualOrders: 0, revenue: 0, cities: []
      });
    }
    const country = countryMap.get(m.countryCode);
    country.spend = (country.spend || 0) + (m.spend || 0);
    country.metaOrders = (country.metaOrders || 0) + (m.conversions || 0);
    country.metaRevenue = (country.metaRevenue || 0) + (m.conversionValue || 0);
    country.impressions = (country.impressions || 0) + (m.impressions || 0);
    country.clicks = (country.clicks || 0) + (m.clicks || 0);
    
    // Populate "Revenue" and "Orders" columns from Meta for now
    country.revenue = country.metaRevenue;
    country.totalOrders = country.metaOrders;
  }

  const countries = Array.from(countryMap.values())
    .map(c => ({
      ...c,
      aov: c.totalOrders > 0 ? c.revenue / c.totalOrders : 0,
      cac: c.totalOrders > 0 ? c.spend / c.totalOrders : 0,
      roas: c.spend > 0 ? c.revenue / c.spend : 0
    }))
    .sort((a, b) => b.spend - a.spend);

  const trends = getTrends(store, startDate, endDate);
  const diagnostics = generateDiagnostics(campaigns, overview);

  return {
    overview,
    campaigns,
    countries,
    trends,
    diagnostics,
    dateRange: { startDate, endDate },
    metaCampaignCount,
    metaSpendTotal,
    metaRevenueTotal,
    metaRoasTotal: overview.roas,
    metaImpressionsTotal: metaTotals.impressions_total || 0,
    metaReachTotal: metaTotals.reach_total || 0,
    metaClicksTotal: metaTotals.clicks_total || 0,
    metaCtrTotal: (metaTotals.impressions_total > 0 ? metaTotals.clicks_total / metaTotals.impressions_total : 0),
    metaLpvTotal: metaTotals.lpv_total || 0,
    metaAtcTotal: metaTotals.atc_total || 0,
    metaCheckoutTotal: metaTotals.checkout_total || 0,
    metaConversionsTotal: conversions_total,
    metaCacTotal: overview.cac
  };
}

// UPDATED: Now includes Meta Data in the trend lines
function getTrends(store, startDate, endDate) {
  const db = getDb();
  const allDates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    allDates.push(formatDateAsGmt3(d));
  }
  
  // 1. Get Meta Daily Data (Grouped by Date)
  const metaDaily = db.prepare(`
    SELECT 
      date,
      SUM(spend) as spend,
      SUM(conversions) as metaConversions,
      SUM(conversion_value) as metaRevenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY date
  `).all(store, startDate, endDate);

  const dateMap = new Map();
  for (const date of allDates) {
    dateMap.set(date, { date, spend: 0, orders: 0, revenue: 0 });
  }
  
  // 2. Fill with Meta Data (Since user wants Meta to drive charts)
  for (const m of metaDaily) {
    if (dateMap.has(m.date)) {
      const d = dateMap.get(m.date);
      d.spend = m.spend || 0;
      d.orders = m.metaConversions || 0; // Use Meta conversions for orders
      d.revenue = m.metaRevenue || 0;    // Use Meta value for revenue
    }
  }

  return Array.from(dateMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      ...d,
      aov: d.orders > 0 ? d.revenue / d.orders : 0,
      cac: d.orders > 0 ? d.spend / d.orders : 0,
      roas: d.spend > 0 ? d.revenue / d.spend : 0
    }));
}

function generateDiagnostics(campaigns, overview) {
  const diagnostics = [];
  if (overview.roas < 2) {
    diagnostics.push({ type: 'warning', icon: '⚠️', title: 'Low ROAS', detail: `Overall ROAS is ${overview.roas.toFixed(2)}×`, action: 'Review low performers' });
  } else if (overview.roas > 4) {
    diagnostics.push({ type: 'success', icon: '✅', title: 'Strong ROAS', detail: `Overall ROAS is ${overview.roas.toFixed(2)}×`, action: 'Scale top performers' });
  }
  const avgCAC = overview.cac;
  if (avgCAC > 100) {
    diagnostics.push({ type: 'warning', icon: '💰', title: 'High CAC', detail: `Average CAC is $${avgCAC.toFixed(0)}`, action: 'Check creative performance' });
  }
  return diagnostics;
}

// FIXED: Dynamic Countries + Meta Data Source
// Returns daily trends per country, sourced from Meta
export function getCountryTrends(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  const allDates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    allDates.push(formatDateAsGmt3(d));
  }

  // Get Meta Daily by Country
  const metaData = db.prepare(`
    SELECT date, country, SUM(conversions) as orders, SUM(conversion_value) as revenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY date, country
  `).all(store, startDate, endDate);

  const countryMap = new Map();

  for (const row of metaData) {
    if (!row.country) continue;
    if (!countryMap.has(row.country)) {
      countryMap.set(row.country, new Map());
    }
    const dates = countryMap.get(row.country);
    dates.set(row.date, { orders: row.orders || 0, revenue: row.revenue || 0 });
  }

  const result = [];
  for (const [country, datesMap] of countryMap) {
    const countryInfo = getCountryInfo(country);
    const trends = allDates.map(date => {
      const d = datesMap.get(date) || { orders: 0, revenue: 0 };
      return { date, ...d };
    });
    
    const totalOrders = trends.reduce((s, t) => s + t.orders, 0);
    if (totalOrders > 0) { // Only include if data exists
        result.push({
            country: countryInfo.name,
            countryCode: country,
            flag: countryInfo.flag,
            totalOrders,
            trends
        });
    }
  }

  return result.sort((a, b) => b.totalOrders - a.totalOrders);
}

export function getAvailableCountries(store) {
  const db = getDb();
  // Only return countries that have Meta Spend or Conversions
  const rows = db.prepare(`
    SELECT DISTINCT country as code FROM meta_daily_metrics 
    WHERE store = ? AND country != 'ALL' AND (spend > 0 OR conversions > 0)
  `).all(store);

  return rows.map(r => getCountryInfo(r.code)).filter(c => c && c.name);
}

export function getEfficiency(store, params) {
  const dashboard = getDashboard(store, params);
  return {
    status: 'green',
    spendChange: 0,
    roasChange: 0,
    efficiencyRatio: 1,
    averageCac: dashboard.overview.cac,
    marginalCac: 0,
    marginalPremium: 0,
    campaigns: [],
    countries: []
  };
}

export function getEfficiencyTrends(store, params) {
  return getTrends(store, params.startDate || '2024-01-01', params.endDate || '2024-12-31');
}

export function getRecommendations(store, params) {
  return [];
}

export function getCampaignsByCountry(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  return db.prepare(`SELECT * FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'`).all(store, startDate, endDate);
}

export function getCampaignsByAge(store, params) { return []; }
export function getCampaignsByGender(store, params) { return []; }
export function getCampaignsByPlacement(store, params) { return []; }
export function getCampaignsByAgeGender(store, params) { return []; }
export function getShopifyTimeOfDay(store, params) { return { data: [], timezone: 'UTC', sampleTimestamps: [] }; }
export function getMetaBreakdowns(store, params) { return []; }
