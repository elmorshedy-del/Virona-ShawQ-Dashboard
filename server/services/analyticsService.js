import { getCountryInfo, getAllCountries } from '../utils/countryData.js';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

// 1. Date Helper
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

// 2. Calculate Previous Period (For Arrows)
function getPreviousDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = end.getTime() - start.getTime();
  
  const prevEnd = new Date(start.getTime() - (24 * 60 * 60 * 1000)); 
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  
  return {
    startDate: formatDateAsGmt3(prevStart),
    endDate: formatDateAsGmt3(prevEnd)
  };
}

// 3. Get Totals for Any Range (The "Engine")
function getTotalsForRange(db, store, startDate, endDate) {
  // Meta Totals
  const metaTotals = db.prepare(`
    SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as orders
    FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  let totalSpend = metaTotals.spend || 0;
  let totalRevenue = metaTotals.revenue || 0;
  let totalOrders = metaTotals.orders || 0;

  // Shopify Data (Shawq Only)
  if (store === 'shawq') {
    const ecomData = db.prepare(`
      SELECT COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ?
    `).get(store, startDate, endDate) || {};
    totalOrders = ecomData.orders || 0; // Use Real Shopify Orders
    totalRevenue = ecomData.revenue || 0; // Use Real Shopify Revenue
  }

  // Manual Data (Always Added)
  const manualData = db.prepare(`
    SELECT SUM(spend) as spend, SUM(orders_count) as orders, SUM(revenue) as revenue
    FROM manual_orders WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  totalSpend += manualData.spend || 0;
  totalRevenue += manualData.revenue || 0;
  // For Virona, manual orders add to Meta orders. For Shawq, they add to Shopify orders.
  totalOrders += manualData.orders || 0;

  // Overrides
  const override = db.prepare(`
    SELECT SUM(amount) as amount FROM manual_spend_overrides WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate);
  if (override?.amount) totalSpend = override.amount;

  return {
    spend: totalSpend,
    revenue: totalRevenue,
    orders: totalOrders,
    aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    cac: totalOrders > 0 ? totalSpend / totalOrders : 0,
    roas: totalSpend > 0 ? totalRevenue / totalSpend : 0
  };
}

// 4. Main Dashboard Function
export function getDashboard(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  const prevRange = getPreviousDateRange(startDate, endDate);

  // A. Calculate Current vs Previous (For Arrows)
  const current = getTotalsForRange(db, store, startDate, endDate);
  const previous = getTotalsForRange(db, store, prevRange.startDate, prevRange.endDate);

  const calcChange = (curr, prev) => prev > 0 ? ((curr - prev) / prev) * 100 : 0;

  const overview = {
    ...current,
    revenueChange: calcChange(current.revenue, previous.revenue),
    spendChange: calcChange(current.spend, previous.spend),
    ordersChange: calcChange(current.orders, previous.orders),
    aovChange: calcChange(current.aov, previous.aov),
    cacChange: calcChange(current.cac, previous.cac),
    roasChange: calcChange(current.roas, previous.roas),
    manualOrders: 0, sallaOrders: 0, shopifyOrders: 0 // Placeholders
  };

  // B. Campaign List (Aggregated from Meta)
  const campaignData = db.prepare(`
    SELECT 
      campaign_id as campaignId, campaign_name as campaignName,
      SUM(spend) as spend, SUM(impressions) as impressions, SUM(reach) as reach,
      SUM(clicks) as clicks, SUM(conversions) as conversions, SUM(conversion_value) as conversionValue,
      SUM(landing_page_views) as lpv, SUM(add_to_cart) as atc, SUM(checkouts_initiated) as checkout
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

  // C. Meta Raw Totals (Section 2)
  const metaTotals = db.prepare(`
    SELECT
      SUM(impressions) as impressions_total, SUM(reach) as reach_total,
      SUM(clicks) as clicks_total, SUM(landing_page_views) as lpv_total,
      SUM(add_to_cart) as atc_total, SUM(checkouts_initiated) as checkout_total,
      COUNT(DISTINCT campaign_name) as campaign_count
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  // *** CRASH FIX: Defined metaCampaignCount ***
  const metaCampaignCount = metaTotals.campaign_count || 0;
  
  const metaImpressionsTotal = metaTotals.impressions_total || 0;
  const metaClicksTotal = metaTotals.clicks_total || 0;

  // D. Dynamic Countries
  const countries = getDynamicCountries(db, store, startDate, endDate);

  return {
    overview,
    campaigns,
    countries,
    trends: getTrends(store, startDate, endDate),
    diagnostics: generateDiagnostics(campaigns, overview),
    dateRange: { startDate, endDate },
    
    metaCampaignCount, // Variable is now safe to use
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

// 5. Country Table Helper
function getDynamicCountries(db, store, startDate, endDate) {
  // Get Meta
  const metaData = db.prepare(`
    SELECT country as countryCode, SUM(spend) as spend, SUM(conversions) as conversions, 
           SUM(conversion_value) as conversionValue, SUM(impressions) as impressions, SUM(clicks) as clicks
    FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL' GROUP BY country
  `).all(store, startDate, endDate);

  // Get Ecom (Shawq)
  let ecomData = [];
  if (store === 'shawq') {
    ecomData = db.prepare(`
      SELECT country_code as countryCode, COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL GROUP BY country_code
    `).all(store, startDate, endDate);
  }

  const map = new Map();
  
  // Load Ecom
  ecomData.forEach(e => {
    const info = getCountryInfo(e.countryCode);
    map.set(e.countryCode, { 
      code: e.countryCode, name: info.name, flag: info.flag, 
      spend: 0, revenue: e.revenue, totalOrders: e.orders, 
      impressions: 0, clicks: 0, cities: [] 
    });
  });

  // Load Meta
  metaData.forEach(m => {
    if(!m.spend && !m.conversions) return;
    if(!map.has(m.countryCode)) {
      const info = getCountryInfo(m.countryCode);
      map.set(m.countryCode, { 
        code: m.countryCode, name: info.name, flag: info.flag, 
        spend: 0, revenue: 0, totalOrders: 0, impressions: 0, clicks: 0, cities: [] 
      });
    }
    const c = map.get(m.countryCode);
    c.spend += m.spend || 0;
    c.impressions += m.impressions || 0;
    c.clicks += m.clicks || 0;
    
    if (store === 'vironax') { // Virona uses Meta for sales
      c.revenue = m.conversionValue || 0;
      c.totalOrders = m.conversions || 0;
    }
  });

  return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
}

// 6. Trends Helper (Fixed for Both Stores)
function getTrends(store, startDate, endDate) {
  const db = getDb();
  const allDates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    allDates.push(formatDateAsGmt3(d));
  }

  let salesData = [];
  if (store === 'shawq') {
    salesData = db.prepare(`SELECT date, COUNT(*) as orders, SUM(subtotal) as revenue FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ? GROUP BY date`).all(store, startDate, endDate);
  } else {
    salesData = db.prepare(`SELECT date, SUM(conversions) as orders, SUM(conversion_value) as revenue FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? GROUP BY date`).all(store, startDate, endDate);
  }
  
  const spendData = db.prepare(`SELECT date, SUM(spend) as spend FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? GROUP BY date`).all(store, startDate, endDate);

  const map = new Map();
  allDates.forEach(d => map.set(d, { date: d, orders: 0, revenue: 0, spend: 0 }));
  
  salesData.forEach(r => { if(map.has(r.date)) { map.get(r.date).orders = r.orders; map.get(r.date).revenue = r.revenue; }});
  spendData.forEach(r => { if(map.has(r.date)) { map.get(r.date).spend = r.spend; }});

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({
    ...d, 
    aov: d.orders > 0 ? d.revenue / d.orders : 0,
    cac: d.orders > 0 ? d.spend / d.orders : 0,
    roas: d.spend > 0 ? d.revenue / d.spend : 0
  }));
}

function generateDiagnostics(campaigns, overview) { return []; }

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
export function getCountryTrends(store, params) { 
    const db = getDb();
    const { startDate, endDate } = getDateRange(params);
    if(store === 'shawq') return db.prepare(`SELECT date, country_code as country, COUNT(*) as orders, SUM(subtotal) as revenue FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ? GROUP BY date, country_code`).all(store, startDate, endDate);
    return db.prepare(`SELECT date, country, SUM(conversions) as orders, SUM(conversion_value) as revenue FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL' GROUP BY date, country`).all(store, startDate, endDate);
}
export function getShopifyTimeOfDay(store, params) { return { data: [], timezone: 'UTC', sampleTimestamps: [] }; }
export function getMetaBreakdowns(store, params) { return []; }
