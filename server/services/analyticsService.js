import { getCountryInfo, getAllCountries } from '../utils/countryData.js';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

// ============================================================================
// DATE HELPERS
// ============================================================================
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

// FIXED: Compare same-length previous period
function getPreviousDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const durationMs = end.getTime() - start.getTime();
  const durationDays = Math.ceil(durationMs / (24 * 60 * 60 * 1000)) + 1;
  
  // Go back exactly one period
  const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - (durationDays - 1) * 24 * 60 * 60 * 1000);
  
  return {
    startDate: formatDateAsGmt3(prevStart),
    endDate: formatDateAsGmt3(prevEnd)
  };
}

// ============================================================================
// SALLA DETECTION
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
// CITIES BY COUNTRY
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
        SUM(subtotal) as revenue
      FROM shopify_orders
      WHERE store = ? AND country_code = ? AND date BETWEEN ? AND ?
      AND city IS NOT NULL
      GROUP BY city, state
      ORDER BY orders DESC
    `).all(store, countryCode, startDate, endDate);

    return citiesData.map((city, index) => ({
      name: city.state ? `${city.city}, ${city.state}` : city.city,
      city: city.city || 'Unknown',
      state: city.state || null,
      orders: city.orders || 0,
      revenue: city.revenue || 0,
      rank: index + 1
    }));
  } catch (error) {
    console.error(`[Analytics] Error getting cities for ${countryCode}:`, error);
    return [];
  }
}

// ============================================================================
// GET TOTALS FOR RANGE
// ============================================================================
function getTotalsForRange(db, store, startDate, endDate) {
  const metaTotals = db.prepare(`
    SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as orders
    FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  let totalSpend = metaTotals.spend || 0;
  let totalRevenue = metaTotals.revenue || 0;
  let totalOrders = metaTotals.orders || 0;

  if (store === 'shawq') {
    const ecomData = db.prepare(`
      SELECT COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ?
    `).get(store, startDate, endDate) || {};
    totalOrders = ecomData.orders || 0;
    totalRevenue = ecomData.revenue || 0;
  }

  const manualData = db.prepare(`
    SELECT SUM(spend) as spend, SUM(orders_count) as orders, SUM(revenue) as revenue
    FROM manual_orders WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  totalSpend += manualData.spend || 0;
  totalRevenue += manualData.revenue || 0;
  totalOrders += manualData.orders || 0;

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

// ============================================================================
// DASHBOARD
// ============================================================================
export function getDashboard(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  const prevRange = getPreviousDateRange(startDate, endDate);

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
    manualOrders: 0,
    sallaOrders: 0,
    shopifyOrders: 0
  };

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

  const metaTotals = db.prepare(`
    SELECT
      SUM(impressions) as impressions_total, SUM(reach) as reach_total,
      SUM(clicks) as clicks_total, SUM(landing_page_views) as lpv_total,
      SUM(add_to_cart) as atc_total, SUM(checkouts_initiated) as checkout_total,
      COUNT(DISTINCT campaign_name) as campaign_count
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  const metaCampaignCount = metaTotals.campaign_count || 0;
  const metaImpressionsTotal = metaTotals.impressions_total || 0;
  const metaClicksTotal = metaTotals.clicks_total || 0;

  const countries = getDynamicCountries(db, store, startDate, endDate);

  return {
    overview,
    campaigns,
    countries,
    trends: getTrends(store, startDate, endDate),
    diagnostics: [],
    dateRange: { startDate, endDate },
    
    metaCampaignCount,
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

// ============================================================================
// DYNAMIC COUNTRIES
// ============================================================================
function getDynamicCountries(db, store, startDate, endDate) {
  const metaData = db.prepare(`
    SELECT country as countryCode, SUM(spend) as spend, SUM(conversions) as conversions, 
           SUM(conversion_value) as conversionValue
    FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL' GROUP BY country
  `).all(store, startDate, endDate);

  let ecomData = [];
  if (store === 'shawq') {
    ecomData = db.prepare(`
      SELECT country_code as countryCode, COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL GROUP BY country_code
    `).all(store, startDate, endDate);
  }

  const map = new Map();
  
  ecomData.forEach(e => {
    const info = getCountryInfo(e.countryCode);
    map.set(e.countryCode, { 
      code: e.countryCode, name: info.name, flag: info.flag, 
      spend: 0, revenue: e.revenue, totalOrders: e.orders, 
      impressions: 0, clicks: 0, cities: [] 
    });
  });

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
    
    if (store === 'vironax') {
      c.revenue = m.conversionValue || 0;
      c.totalOrders = m.conversions || 0;
    }
  });

  return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
}

// ============================================================================
// TRENDS
// ============================================================================
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

// ============================================================================
// COUNTRY TRENDS (with nested cities)
// ============================================================================
export function getCountryTrends(store, params) {
  const db = getDb();
  // FIXED: Always use last 7 days, ignore date picker
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

  try {
    let rawData = [];

    if (store === 'shawq') {
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

    } else if (store === 'vironax') {
      const sallaActive = isSallaActive();
      
      if (sallaActive) {
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
      } else {
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
      }
    } else {
      return [];
    }

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
          trends: []
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

    if (store === 'shawq') {
      for (const countryData of countriesMap.values()) {
        countryData.cities = getCitiesByCountry(store, countryData.countryCode, { startDate, endDate });
      }
    }

    const result = Array.from(countriesMap.values()).sort((a, b) => b.totalOrders - a.totalOrders);

    return result;
  } catch (error) {
    console.error(`[Analytics] Error getting country trends:`, error);
    return [];
  }
}

// ============================================================================
// TIME OF DAY (with timezone logic)
// ============================================================================
export function getShopifyTimeOfDay(store, params) {
  if (store !== 'shawq') {
    return { data: [], timezone: 'UTC', region: 'all', sampleTimestamps: [], message: 'Time of day requires Shopify data' };
  }

  const db = getDb();
  // Use 14 days for better distribution
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));
  const region = params.region || 'all';

  const timezoneOffsets = {
    'us': -6,      // Chicago (CST)
    'europe': 0,   // London (GMT)
    'all': 0       // UTC
  };
  const offset = timezoneOffsets[region] || 0;

  const timezoneMap = {
    'us': 'America/Chicago',
    'europe': 'Europe/London',
    'all': 'UTC'
  };
  const timezone = timezoneMap[region] || 'UTC';

  const hourLabels = {
    0: '12 AM', 1: '1 AM', 2: '2 AM', 3: '3 AM', 4: '4 AM', 5: '5 AM',
    6: '6 AM', 7: '7 AM', 8: '8 AM', 9: '9 AM', 10: '10 AM', 11: '11 AM',
    12: '12 PM', 13: '1 PM', 14: '2 PM', 15: '3 PM', 16: '4 PM', 17: '5 PM',
    18: '6 PM', 19: '7 PM', 20: '8 PM', 21: '9 PM', 22: '10 PM', 23: '11 PM'
  };

  try {
    let query = `
      SELECT
        order_created_at,
        country_code,
        subtotal as revenue
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ?
      AND order_created_at IS NOT NULL
    `;

    const queryParams = [store, startDate, endDate];

    if (region === 'us') {
      query += ` AND country_code IN ('US', 'CA')`;
    } else if (region === 'europe') {
      query += ` AND country_code IN ('GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'IE', 'PT', 'GR', 'PL', 'FI', 'CZ', 'HU', 'RO')`;
    }

    const rawData = db.prepare(query).all(...queryParams);

    const hourBuckets = {};
    for (let h = 0; h < 24; h++) {
      hourBuckets[h] = { orders: 0, revenue: 0 };
    }

    for (const order of rawData) {
      if (!order.order_created_at) continue;

      const orderDate = new Date(order.order_created_at);
      if (isNaN(orderDate.getTime())) continue;

      let hour = orderDate.getUTCHours() + offset;
      if (hour < 0) hour += 24;
      if (hour >= 24) hour -= 24;

      hourBuckets[hour].orders += 1;
      hourBuckets[hour].revenue += order.revenue || 0;
    }

    const formattedData = [];
    for (let hour = 0; hour < 24; hour++) {
      const stats = hourBuckets[hour];
      formattedData.push({
        hour,
        label: hourLabels[hour],
        orders: stats.orders,
        revenue: stats.revenue,
        aov: stats.orders > 0 ? stats.revenue / stats.orders : 0
      });
    }

    return {
      data: formattedData,
      timezone,
      region,
      totalOrders: rawData.length,
      sampleTimestamps: []
    };
  } catch (error) {
    console.error('[Analytics] Error getting time of day:', error);
    return { data: [], timezone: 'UTC', region: 'all', sampleTimestamps: [] };
  }
}

// ============================================================================
// BUDGET EFFICIENCY
// ============================================================================
export function getEfficiency(store, params) {
  const { startDate, endDate } = getDateRange(params);
  const db = getDb();
  const prevRange = getPreviousDateRange(startDate, endDate);

  const current = getTotalsForRange(db, store, startDate, endDate);
  const previous = getTotalsForRange(db, store, prevRange.startDate, prevRange.endDate);

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

export function getEfficiencyTrends(store, params) {
  const { startDate, endDate } = getDateRange(params);
  const trends = getTrends(store, startDate, endDate);
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
      rollingRoas: rollingSpend > 0 ? rollingRevenue / rollingSpend : 0
    };
  });
}

export function getRecommendations(store, params) {
  return [];
}

export function getAvailableCountries(store) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT country as code FROM meta_daily_metrics WHERE store = ? AND country != 'ALL' AND (spend > 0 OR conversions > 0)
    UNION SELECT DISTINCT country_code as code FROM shopify_orders WHERE store = ?
    UNION SELECT DISTINCT country_code as code FROM salla_orders WHERE store = ?
  `).all(store, store, store);
  return rows.map(r => getCountryInfo(r.code)).filter(c => c && c.name);
}

export function getCampaignsByCountry(store, params) { return []; }
export function getCampaignsByAge(store, params) { return []; }
export function getCampaignsByGender(store, params) { return []; }
export function getCampaignsByPlacement(store, params) { return []; }
export function getCampaignsByAgeGender(store, params) { return []; }
export function getMetaBreakdowns(store, params) { return []; }
