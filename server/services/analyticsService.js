import { getCountryInfo, getAllCountries } from '../utils/countryData.js';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

// ============================================================================
// SALLA DETECTION (NEW)
// ============================================================================
function isSallaActive() {
  const sallaToken = process.env.SALLA_ACCESS_TOKEN;
  const sallaMerchantId = process.env.SALLA_MERCHANT_ID;
  
  if (!sallaToken || !sallaMerchantId) {
    return false;
  }
  
  const db = getDb();
  try {
    const recentSync = db.prepare(`
      SELECT COUNT(*) as count FROM salla_orders 
      WHERE store = 'vironax' 
      AND created_at > datetime('now', '-24 hours')
    `).get();
    
    return recentSync.count > 0;
  } catch (error) {
    console.warn('[Analytics] Error checking Salla active status:', error);
    return false;
  }
}

// ============================================================================
// GET CITIES BY COUNTRY (NEW)
// ============================================================================
function getCitiesByCountry(store, countryCode, params) {
  if (store !== 'shawq') {
    return [];
  }

  const db = getDb();
  const { startDate, endDate } = getDateRange(params);

  try {
    const citiesData = db.prepare(`
      SELECT 
        city,
        state,
        COUNT(*) as orders,
        SUM(subtotal) as revenue,
        COUNT(DISTINCT DATE(created_at)) as days_active
      FROM shopify_orders
      WHERE store = ? AND country_code = ? AND date BETWEEN ? AND ?
      AND city IS NOT NULL
      GROUP BY city, state
      ORDER BY orders DESC
    `).all(store, countryCode, startDate, endDate);

    return citiesData.map((city, index) => ({
      ...city,
      city: city.city || 'Unknown',
      state: city.state || null,
      orders: city.orders || 0,
      revenue: city.revenue || 0,
      days_active: city.days_active || 0,
      rank: index + 1,
      medal: (countryCode === 'US' && index === 0) ? '🥇' 
           : (countryCode === 'US' && index === 1) ? '🥈'
           : (countryCode === 'US' && index === 2) ? '🥉'
           : null
    }));
  } catch (error) {
    console.error(`[Analytics] Error getting cities for ${countryCode}:`, error);
    return [];
  }
}

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

// 2. Calculate Previous Period (For Arrows) - FIXED
function getPreviousDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = end.getTime() - start.getTime();
  
  // Go back exactly one period from the start date
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

  try {
    let rawData = [];

    if (store === 'shawq') {
      // SHAWQ: Get Shopify data only
      rawData = db.prepare(`
        SELECT 
          date, 
          country_code as countryCode,
          COUNT(*) as orders, 
          SUM(subtotal) as revenue
        FROM shopify_orders 
        WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL
        GROUP BY date, country_code
        ORDER BY date ASC, country_code ASC
      `).all(store, startDate, endDate);

      console.log(`[Analytics] Country trends for Shawq (Shopify): ${rawData.length} rows`);

    } else if (store === 'vironax') {
      // VIRONAX: Get Meta data, but check if Salla is active to mute Meta
      const sallaActive = isSallaActive();
      
      if (sallaActive) {
        // Salla is active: use Salla orders instead of Meta
        rawData = db.prepare(`
          SELECT 
            date, 
            country_code as countryCode,
            COUNT(*) as orders, 
            SUM(total_price) as revenue
          FROM salla_orders 
          WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL
          GROUP BY date, country_code
          ORDER BY date ASC, country_code ASC
        `).all(store, startDate, endDate);

        console.log(`[Analytics] Country trends for Vironax (Salla active): ${rawData.length} rows`);
      } else {
        // Salla not active: use Meta data
        rawData = db.prepare(`
          SELECT 
            date, 
            country as countryCode,
            SUM(conversions) as orders, 
            SUM(conversion_value) as revenue
          FROM meta_daily_metrics 
          WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
          GROUP BY date, country
          ORDER BY date ASC, country ASC
        `).all(store, startDate, endDate);

        console.log(`[Analytics] Country trends for Vironax (Meta): ${rawData.length} rows`);
      }
    } else {
      console.log(`[Analytics] Store ${store} not supported for country trends`);
      return [];
    }

    // Group by country and build structure
    const countriesMap = new Map();

    for (const row of rawData) {
      if (!countriesMap.has(row.countryCode)) {
        const countryInfo = getCountryInfo(row.countryCode);
        countriesMap.set(row.countryCode, {
          countryCode: row.countryCode,
          country: countryInfo?.name || row.countryCode,
          flag: countryInfo?.flag || '🏳️',
          totalOrders: 0,
          totalRevenue: 0,
          trends: []  // Daily breakdown for chart
        });
      }

      const countryData = countriesMap.get(row.countryCode);
      countryData.trends.push({
        date: row.date,
        orders: row.orders || 0,
        revenue: row.revenue || 0
      });
      countryData.totalOrders += row.orders || 0;
      countryData.totalRevenue += row.revenue || 0;
    }

    // Add cities data for each country (only for Shawq)
    if (store === 'shawq') {
      for (const countryData of countriesMap.values()) {
        countryData.cities = getCitiesByCountry(store, countryData.countryCode, params);
      }
    }

    // Sort by total orders descending
    const result = Array.from(countriesMap.values()).sort((a, b) => b.totalOrders - a.totalOrders);

    console.log(`[Analytics] Processed ${countriesMap.size} countries for trends`);

    return result;
  } catch (error) {
    console.error(`[Analytics] Error getting country trends for ${store}:`, error);
    return [];
  }
}
export function getShopifyTimeOfDay(store, params) { 
  if (store !== 'shawq') {
    return { data: [], timezone: 'UTC', sampleTimestamps: [] };
  }

  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  const region = params.region || 'all';

  try {
    // Get timezone mapping based on region
    const timezoneMap = {
      'us': 'America/Chicago',
      'europe': 'Europe/London',
      'all': 'UTC'
    };
    const timezone = timezoneMap[region] || 'UTC';

    // Query Shopify orders
    let query = `
      SELECT 
        CAST(strftime('%H', datetime(created_at)) AS INTEGER) as hour,
        COUNT(*) as orders,
        SUM(subtotal) as revenue
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ?
    `;

    const params_list = [store, startDate, endDate];

    // Filter by country for regions
    if (region === 'us') {
      query += ` AND country_code IN ('US', 'CA')`;
    } else if (region === 'europe') {
      query += ` AND country_code IN ('GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'IE', 'PT', 'GR', 'PL')`;
    }

    query += ` GROUP BY hour ORDER BY hour ASC`;

    const data = db.prepare(query).all(...params_list);

    // Map hours to 0-23 format with labels
    const hourLabels = {
      0: '12 AM', 1: '1 AM', 2: '2 AM', 3: '3 AM', 4: '4 AM', 5: '5 AM',
      6: '6 AM', 7: '7 AM', 8: '8 AM', 9: '9 AM', 10: '10 AM', 11: '11 AM',
      12: '12 PM', 13: '1 PM', 14: '2 PM', 15: '3 PM', 16: '4 PM', 17: '5 PM',
      18: '6 PM', 19: '7 PM', 20: '8 PM', 21: '9 PM', 22: '10 PM', 23: '11 PM'
    };

    const formattedData = data.map(d => ({
      hour: d.hour,
      label: hourLabels[d.hour] || `${d.hour}:00`,
      orders: d.orders || 0,
      revenue: d.revenue || 0,
      aov: d.orders > 0 ? d.revenue / d.orders : 0
    }));

    return {
      data: formattedData,
      timezone,
      region,
      sampleTimestamps: []
    };
  } catch (error) {
    console.error('[Analytics] Error getting time of day:', error);
    return { data: [], timezone: 'UTC', sampleTimestamps: [] };
  }
}

// ============================================================================
// BUDGET EFFICIENCY FUNCTIONS (NEW)
// ============================================================================

function getOverviewKPIs(startDate, endDate) {
  const db = getDb();

  const metaSpend = db.prepare(`
    SELECT COALESCE(SUM(spend), 0) as total
    FROM meta_daily_metrics
    WHERE date BETWEEN ? AND ? AND country = 'ALL'
  `).get(startDate, endDate);

  const sallaData = db.prepare(`
    SELECT 
      COUNT(*) as orders,
      COALESCE(SUM(order_total), 0) as revenue
    FROM salla_orders
    WHERE date BETWEEN ? AND ?
  `).get(startDate, endDate);

  const manualData = db.prepare(`
    SELECT 
      COALESCE(SUM(orders_count), 0) as orders,
      COALESCE(SUM(revenue), 0) as revenue
    FROM manual_orders
    WHERE date BETWEEN ? AND ?
  `).get(startDate, endDate);

  const totalOrders = (sallaData?.orders || 0) + (manualData?.orders || 0);
  const totalRevenue = (sallaData?.revenue || 0) + (manualData?.revenue || 0);
  const spend = metaSpend?.total || 0;

  return {
    spend,
    orders: totalOrders,
    sallaOrders: sallaData?.orders || 0,
    manualOrders: manualData?.orders || 0,
    revenue: totalRevenue,
    aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    cac: totalOrders > 0 ? spend / totalOrders : 0,
    roas: spend > 0 ? totalRevenue / spend : 0
  };
}

function getKPITrends(startDate, endDate) {
  const db = getDb();

  const spendByDay = db.prepare(`
    SELECT date, SUM(spend) as spend
    FROM meta_daily_metrics
    WHERE date BETWEEN ? AND ? AND country = 'ALL'
    GROUP BY date
    ORDER BY date
  `).all(startDate, endDate);

  const sallaByDay = db.prepare(`
    SELECT date, COUNT(*) as orders, SUM(order_total) as revenue
    FROM salla_orders
    WHERE date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date
  `).all(startDate, endDate);

  const manualByDay = db.prepare(`
    SELECT date, SUM(orders_count) as orders, SUM(revenue) as revenue
    FROM manual_orders
    WHERE date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date
  `).all(startDate, endDate);

  const dateMap = {};

  for (const row of spendByDay) {
    if (!dateMap[row.date]) dateMap[row.date] = { date: row.date, spend: 0, orders: 0, revenue: 0 };
    dateMap[row.date].spend = row.spend;
  }

  for (const row of sallaByDay) {
    if (!dateMap[row.date]) dateMap[row.date] = { date: row.date, spend: 0, orders: 0, revenue: 0 };
    dateMap[row.date].orders += row.orders;
    dateMap[row.date].revenue += row.revenue;
  }

  for (const row of manualByDay) {
    if (!dateMap[row.date]) dateMap[row.date] = { date: row.date, spend: 0, orders: 0, revenue: 0 };
    dateMap[row.date].orders += row.orders || 0;
    dateMap[row.date].revenue += row.revenue || 0;
  }

  const trends = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

  return trends.map(day => ({
    ...day,
    aov: day.orders > 0 ? day.revenue / day.orders : 0,
    cac: day.orders > 0 ? day.spend / day.orders : 0,
    roas: day.spend > 0 ? day.revenue / day.spend : 0
  }));
}

function getCampaignMetrics(startDate, endDate) {
  const db = getDb();

  const campaigns = db.prepare(`
    SELECT 
      campaign_id,
      campaign_name,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversion_value,
      AVG(frequency) as frequency
    FROM meta_daily_metrics
    WHERE date BETWEEN ? AND ? AND country = 'ALL'
    GROUP BY campaign_id, campaign_name
    ORDER BY spend DESC
  `).all(startDate, endDate);

  return campaigns.map(c => {
    const cpm = c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0;
    const cpc = c.clicks > 0 ? c.spend / c.clicks : 0;
    const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
    const cr = c.clicks > 0 ? (c.conversions / c.clicks) * 100 : 0;
    const metaRoas = c.spend > 0 ? c.conversion_value / c.spend : 0;
    const metaAov = c.conversions > 0 ? c.conversion_value / c.conversions : 0;
    const metaCac = c.conversions > 0 ? c.spend / c.conversions : 0;

    return {
      campaignId: c.campaign_id,
      campaignName: c.campaign_name,
      spend: c.spend,
      impressions: c.impressions,
      reach: c.reach,
      clicks: c.clicks,
      lpv: c.lpv,
      atc: c.atc,
      checkout: c.checkout,
      conversions: c.conversions,
      conversionValue: c.conversion_value,
      cpm,
      cpc,
      ctr,
      cr,
      frequency: c.frequency,
      metaRoas,
      metaAov,
      metaCac
    };
  });
}

function getCountryMetrics(startDate, endDate) {
  const db = getDb();

  const metaByCountry = db.prepare(`
    SELECT 
      country,
      SUM(spend) as spend
    FROM meta_daily_metrics
    WHERE date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY country
  `).all(startDate, endDate);

  const sallaByCountry = db.prepare(`
    SELECT 
      country,
      COUNT(*) as orders,
      SUM(order_total) as revenue
    FROM salla_orders
    WHERE date BETWEEN ? AND ?
    GROUP BY country
  `).all(startDate, endDate);

  const manualByCountry = db.prepare(`
    SELECT 
      country,
      SUM(orders_count) as orders,
      SUM(revenue) as revenue
    FROM manual_orders
    WHERE date BETWEEN ? AND ?
    GROUP BY country
  `).all(startDate, endDate);

  const countryMap = {};

  for (const row of metaByCountry) {
    const code = row.country;
    if (!countryMap[code]) {
      countryMap[code] = {
        code,
        name: getCountryInfo(code)?.name || code,
        flag: getCountryInfo(code)?.flag || '🏳️',
        spend: 0,
        sallaOrders: 0,
        manualOrders: 0,
        sallaRevenue: 0,
        manualRevenue: 0
      };
    }
    countryMap[code].spend = row.spend;
  }

  for (const row of sallaByCountry) {
    const code = row.country;
    if (!countryMap[code]) {
      countryMap[code] = {
        code,
        name: getCountryInfo(code)?.name || code,
        flag: getCountryInfo(code)?.flag || '🏳️',
        spend: 0,
        sallaOrders: 0,
        manualOrders: 0,
        sallaRevenue: 0,
        manualRevenue: 0
      };
    }
    countryMap[code].sallaOrders = row.orders;
    countryMap[code].sallaRevenue = row.revenue;
  }

  for (const row of manualByCountry) {
    const code = row.country;
    if (!countryMap[code]) {
      countryMap[code] = {
        code,
        name: getCountryInfo(code)?.name || code,
        flag: getCountryInfo(code)?.flag || '🏳️',
        spend: 0,
        sallaOrders: 0,
        manualOrders: 0,
        sallaRevenue: 0,
        manualRevenue: 0
      };
    }
    countryMap[code].manualOrders = row.orders || 0;
    countryMap[code].manualRevenue = row.revenue || 0;
  }

  return Object.values(countryMap).map(c => {
    const totalOrders = c.sallaOrders + c.manualOrders;
    const totalRevenue = c.sallaRevenue + c.manualRevenue;
    return {
      ...c,
      totalOrders,
      totalRevenue,
      aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      cac: totalOrders > 0 ? c.spend / totalOrders : 0,
      roas: c.spend > 0 ? totalRevenue / c.spend : 0
    };
  }).sort((a, b) => b.spend - a.spend);
}

function getBudgetEfficiency(startDate, endDate) {
  const current = getOverviewKPIs(startDate, endDate);
  const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
  const prevEndDate = new Date(startDate);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - daysDiff);

  const previous = getOverviewKPIs(
    formatDateAsGmt3(prevStartDate),
    formatDateAsGmt3(prevEndDate)
  );

  const spendChange = previous.spend > 0 ? ((current.spend - previous.spend) / previous.spend) * 100 : 0;
  const roasChange = previous.roas > 0 ? ((current.roas - previous.roas) / previous.roas) * 100 : 0;
  const efficiencyRatio = spendChange !== 0 && roasChange !== 0 
    ? (1 + roasChange/100) / (1 + spendChange/100) 
    : 1;

  const incrementalSpend = current.spend - previous.spend;
  const incrementalOrders = current.orders - previous.orders;
  const marginalCac = incrementalOrders > 0 ? incrementalSpend / incrementalOrders : current.cac;

  let status = 'green';
  if (efficiencyRatio < 0.85 || marginalCac > current.cac * 1.3) {
    status = 'yellow';
  }
  if (efficiencyRatio < 0.7 || marginalCac > current.cac * 1.5) {
    status = 'red';
  }

  return {
    status,
    current,
    previous,
    spendChange,
    roasChange,
    efficiencyRatio,
    averageCac: current.cac,
    marginalCac,
    marginalPremium: current.cac > 0 ? ((marginalCac - current.cac) / current.cac) * 100 : 0
  };
}

export function getEfficiency(store, params) {
  const { startDate, endDate } = getDateRange(params);
  return getBudgetEfficiency(startDate, endDate);
}

export function getEfficiencyTrends(store, params) {
  const { startDate, endDate } = getDateRange(params);
  const trends = getKPITrends(startDate, endDate);
  const windowSize = 3;
  
  return trends.map((day, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const window = trends.slice(start, i + 1);
    
    const rollingSpend = window.reduce((s, d) => s + d.spend, 0);
    const rollingOrders = window.reduce((s, d) => s + d.orders, 0);
    const rollingRevenue = window.reduce((s, d) => s + d.revenue, 0);
    
    return {
      date: day.date,
      spend: day.spend,
      orders: day.orders,
      revenue: day.revenue,
      cac: day.cac,
      roas: day.roas,
      rollingCac: rollingOrders > 0 ? rollingSpend / rollingOrders : 0,
      rollingRoas: rollingSpend > 0 ? rollingRevenue / rollingSpend : 0,
      marginalCac: i > 0 && (day.orders - trends[i-1].orders) > 0
        ? (day.spend - trends[i-1].spend) / (day.orders - trends[i-1].orders)
        : day.cac
    };
  });
}

export function getRecommendations(store, params) {
  const { startDate, endDate } = getDateRange(params);
  const efficiency = getBudgetEfficiency(startDate, endDate);
  const campaigns = getCampaignMetrics(startDate, endDate);
  const recommendations = [];

  for (const camp of campaigns) {
    if (camp.frequency > 3.5) {
      recommendations.push({
        priority: 1,
        type: 'urgent',
        title: `${camp.campaignName}: High Frequency`,
        detail: `Frequency at ${camp.frequency.toFixed(1)}. Reduce budget 20%.`,
        impact: `Save ~$${(camp.spend * 0.2).toFixed(0)}`
      });
    }
  }

  return recommendations;
}
