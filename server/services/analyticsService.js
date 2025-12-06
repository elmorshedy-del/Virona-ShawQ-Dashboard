import { getCountryInfo, getAllCountries } from '../utils/countryData.js';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

// 1. Date Helpers
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

// Calculate the EXACT previous period (Rolling Window) for Trend Arrows
function getPreviousDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = end.getTime() - start.getTime();
  
  // End of previous period = 1 day before current start
  const prevEnd = new Date(start.getTime() - (24 * 60 * 60 * 1000)); 
  // Start of previous period = End - duration
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  
  return {
    startDate: formatDateAsGmt3(prevStart),
    endDate: formatDateAsGmt3(prevEnd)
  };
}

// 2. Data Calculation Helper (The "Engine")
function getTotalsForRange(db, store, startDate, endDate) {
  // A. Get Meta Data (Always needed for Spend)
  const metaTotals = db.prepare(`
    SELECT
      SUM(spend) as metaSpendTotal,
      SUM(conversion_value) as metaRevenueTotal,
      SUM(conversions) as conversions_total
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  const metaSpend = metaTotals.metaSpendTotal || 0;
  const metaRevenue = metaTotals.metaRevenueTotal || 0;
  const metaOrders = metaTotals.conversions_total || 0;

  // B. Get Shopify Data (Shawq Only)
  let ecomOrders = 0;
  let ecomRevenue = 0;

  if (store === 'shawq') {
    const ecomData = db.prepare(`
      SELECT COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ?
    `).get(store, startDate, endDate) || {};
    ecomOrders = ecomData.orders || 0;
    ecomRevenue = ecomData.revenue || 0;
  }

  // C. Get Manual Data
  const manualData = db.prepare(`
    SELECT SUM(spend) as spend, SUM(orders_count) as orders, SUM(revenue) as revenue
    FROM manual_orders WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  const manualSpend = manualData.spend || 0;
  const manualOrders = manualData.orders || 0;
  const manualRevenue = manualData.revenue || 0;

  // D. Get Overrides
  const overrides = db.prepare(`
    SELECT SUM(amount) as amount FROM manual_spend_overrides 
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate);
  const overrideSpend = overrides?.amount || null;

  // E. Combine Logic
  // Spend is always Meta + Manual (unless overridden)
  const finalSpend = overrideSpend !== null ? overrideSpend : (metaSpend + manualSpend);

  // Revenue/Orders Logic
  let finalRevenue = 0;
  let finalOrders = 0;

  if (store === 'shawq') {
    // Shawq: Shopify + Manual
    finalRevenue = ecomRevenue + manualRevenue;
    finalOrders = ecomOrders + manualOrders;
  } else {
    // Virona: Meta Pixel + Manual
    finalRevenue = metaRevenue + manualRevenue;
    finalOrders = metaOrders + manualOrders;
  }

  return {
    spend: finalSpend,
    revenue: finalRevenue,
    orders: finalOrders,
    aov: finalOrders > 0 ? finalRevenue / finalOrders : 0,
    cac: finalOrders > 0 ? finalSpend / finalOrders : 0,
    roas: finalSpend > 0 ? finalRevenue / finalSpend : 0
  };
}

// 3. Main Dashboard Function
export function getDashboard(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  const prevRange = getPreviousDateRange(startDate, endDate);

  // A. Calculate Current & Previous Totals (Fixes Arrows)
  const current = getTotalsForRange(db, store, startDate, endDate);
  const previous = getTotalsForRange(db, store, prevRange.startDate, prevRange.endDate);

  // B. Calculate Percentage Changes
  const calcChange = (curr, prev) => prev > 0 ? ((curr - prev) / prev) * 100 : 0;

  const overview = {
    ...current,
    revenueChange: calcChange(current.revenue, previous.revenue),
    spendChange: calcChange(current.spend, previous.spend),
    ordersChange: calcChange(current.orders, previous.orders),
    aovChange: calcChange(current.aov, previous.aov),
    cacChange: calcChange(current.cac, previous.cac),
    roasChange: calcChange(current.roas, previous.roas),
    
    manualOrders: 0 // Placeholder
  };

  // C. Get Campaign Breakdown (Current Period)
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

  // D. Get Raw Meta Totals (For Section 2 & Funnel)
  const metaTotals = db.prepare(`
    SELECT
      SUM(impressions) as impressions_total,
      SUM(reach) as reach_total,
      SUM(clicks) as clicks_total,
      SUM(landing_page_views) as lpv_total,
      SUM(add_to_cart) as atc_total,
      SUM(checkouts_initiated) as checkout_total,
      COUNT(DISTINCT campaign_name) as campaign_count
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  // *** THIS IS THE LINE THAT WAS MISSING ***
  const metaCampaignCount = metaTotals.campaign_count || 0;
  
  const metaImpressionsTotal = metaTotals.impressions_total || 0;
  const metaClicksTotal = metaTotals.clicks_total || 0;

  // E. Dynamic Countries
  const countries = getDynamicCountries(db, store, startDate, endDate);

  return {
    overview,
    campaigns,
    countries,
    trends: getTrends(store, startDate, endDate),
    diagnostics: generateDiagnostics(campaigns, overview),
    dateRange: { startDate, endDate },
    
    // Meta Specifics
    metaCampaignCount, // No longer undefined
    metaSpendTotal: current.spend, 
    metaRevenueTotal: current.revenue, 
    metaRoasTotal: current.roas,
    metaImpressionsTotal,
    metaReachTotal: metaTotals.reach_total || 0,
    metaClicksTotal,
    metaCtrTotal: (metaImpressionsTotal > 0 ? metaClicksTotal / metaImpressionsTotal : 0),
    metaLpvTotal: metaTotals.lpv_total || 0,
    metaAtcTotal: metaTotals.atc_total || 0,
    metaCheckoutTotal: metaTotals.checkout_total || 0,
    metaConversionsTotal: current.orders,
    metaCacTotal: current.cac
  };
}

// Helper: Build the Country Table (Restored logic)
function getDynamicCountries(db, store, startDate, endDate) {
  // 1. Get Meta Data
  const metaByCountry = db.prepare(`
    SELECT country as countryCode, SUM(spend) as spend, SUM(conversions) as conversions, 
           SUM(conversion_value) as conversionValue, SUM(impressions) as impressions, SUM(clicks) as clicks
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY country
  `).all(store, startDate, endDate);

  // 2. Get Ecom Data (Shawq Only)
  let ecomOrders = [];
  if (store === 'shawq') {
    ecomOrders = db.prepare(`
      SELECT country_code as countryCode, COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL
      GROUP BY country_code
    `).all(store, startDate, endDate);
  }

  // 3. Merge
  const countryMap = new Map();

  // Load Ecom first (Shawq)
  for (const e of ecomOrders) {
    const info = getCountryInfo(e.countryCode);
    countryMap.set(e.countryCode, {
      code: e.countryCode, name: info.name, flag: info.flag,
      spend: 0, revenue: e.revenue || 0, totalOrders: e.orders || 0,
      impressions: 0, clicks: 0, cities: []
    });
  }

  // Load Meta
  for (const m of metaByCountry) {
    if (!m.spend && !m.conversions) continue;
    if (!countryMap.has(m.countryCode)) {
      const info = getCountryInfo(m.countryCode);
      countryMap.set(m.countryCode, {
        code: m.countryCode, name: info.name, flag: info.flag,
        spend: 0, revenue: 0, totalOrders: 0, impressions: 0, clicks: 0, cities: []
      });
    }
    const c = countryMap.get(m.countryCode);
    c.spend += m.spend || 0;
    c.impressions += m.impressions || 0;
    c.clicks += m.clicks || 0;
    
    if (store === 'vironax') {
      c.revenue = m.conversionValue || 0;
      c.totalOrders = m.conversions || 0;
    }
  }

  // Calculate Metrics
  return Array.from(countryMap.values())
    .map(c => ({
      ...c,
      aov: c.totalOrders > 0 ? c.revenue / c.totalOrders : 0,
      cac: c.totalOrders > 0 ? c.spend / c.totalOrders : 0,
      roas: c.spend > 0 ? c.revenue / c.spend : 0
    }))
    .sort((a, b) => b.spend - a.spend);
}

// Trends Helper
function getTrends(store, startDate, endDate) {
  const db = getDb();
  const allDates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    allDates.push(formatDateAsGmt3(d));
  }

  let data = [];
  if (store === 'shawq') {
    data = db.prepare(`SELECT date, COUNT(*) as orders, SUM(subtotal) as revenue FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ? GROUP BY date`).all(store, startDate, endDate);
  } else {
    data = db.prepare(`SELECT date, SUM(conversions) as orders, SUM(conversion_value) as revenue FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? GROUP BY date`).all(store, startDate, endDate);
  }
  
  const metaData = db.prepare(`SELECT date, SUM(spend) as spend FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? GROUP BY date`).all(store, startDate, endDate);

  const dateMap = new Map();
  allDates.forEach(d => dateMap.set(d, { date: d, orders: 0, revenue: 0, spend: 0 }));
  
  // Add Sales Data
  data.forEach(r => { 
      if(dateMap.has(r.date)) { 
          dateMap.get(r.date).orders = r.orders; 
          dateMap.get(r.date).revenue = r.revenue; 
      }
  });
  
  // Add Spend Data (Always from Meta)
  metaData.forEach(r => {
      if(dateMap.has(r.date)) {
          dateMap.get(r.date).spend = r.spend;
      }
  });

  return Array.from(dateMap.values());
}

function generateDiagnostics(campaigns, overview) { return []; }

// FIX: Restore the correct country list logic
export function getAvailableCountries(store) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT country as code FROM meta_daily_metrics WHERE store = ? AND country != 'ALL' AND (spend > 0 OR conversions > 0)
    UNION SELECT DISTINCT country_code as code FROM shopify_orders WHERE store = ?
    UNION SELECT DISTINCT country_code as code FROM salla_orders WHERE store = ?
  `).all(store, store, store);
  return rows.map(r => getCountryInfo(r.code)).filter(c => c && c.name);
}

export function getEfficiency(store, params) { return { status: 'green', campaigns: [], countries: [] }; }
export function getEfficiencyTrends(store, params) { return []; }
export function getRecommendations(store, params) { return []; }
export function getCampaignsByCountry(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  return db.prepare(`SELECT * FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'`).all(store, startDate, endDate);
}
export function getCampaignsByAge(store, params) { return []; }
export function getCampaignsByGender(store, params) { return []; }
export function getCampaignsByPlacement(store, params) { return []; }
export function getCampaignsByAgeGender(store, params) { return []; }

// FIX: Restore correct trend query for Shawq/Virona
export function getCountryTrends(store, params) { 
    const db = getDb();
    const { startDate, endDate } = getDateRange(params);
    
    // Generate All Dates
    const allDates = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      allDates.push(formatDateAsGmt3(d));
    }

    let data = [];
    if(store === 'shawq') {
        data = db.prepare(`SELECT date, country_code as country, COUNT(*) as orders, SUM(subtotal) as revenue FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ? GROUP BY date, country_code`).all(store, startDate, endDate);
    } else {
        data = db.prepare(`SELECT date, country, SUM(conversions) as orders, SUM(conversion_value) as revenue FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL' GROUP BY date, country`).all(store, startDate, endDate);
    }
    
    // Transform into required format
    const countryMap = new Map();
    for(const row of data) {
        if(!countryMap.has(row.country)) countryMap.set(row.country, new Map());
        countryMap.get(row.country).set(row.date, { orders: row.orders, revenue: row.revenue });
    }

    const result = [];
    for(const [code, dateMap] of countryMap) {
        const trends = allDates.map(d => ({ date: d, ...dateMap.get(d) || { orders: 0, revenue: 0 } }));
        const totalOrders = trends.reduce((s, t) => s + t.orders, 0);
        if(totalOrders > 0) {
            const info = getCountryInfo(code);
            result.push({ country: info.name, countryCode: code, flag: info.flag, totalOrders, trends });
        }
    }
    
    return result.sort((a, b) => b.totalOrders - a.totalOrders);
}
export function getShopifyTimeOfDay(store, params) { return { data: [], timezone: 'UTC', sampleTimestamps: [] }; }
export function getMetaBreakdowns(store, params) { return []; }
