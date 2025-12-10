import { getCountryInfo, getAllCountries } from '../utils/countryData.js';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

// Import Meta Awareness feature module for consistent status filtering
import {
  buildStatusFilter as featureBuildStatusFilter,
  shouldIncludeInactive as featureShouldIncludeInactive,
  getReactivationCandidates as featureGetReactivationCandidates
} from '../features/meta-awareness/index.js';

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
// STATUS FILTERING HELPERS
// Uses Meta Awareness feature module for consistent filtering across the app
// ============================================================================

// Check if includeInactive is requested - delegates to feature module
function shouldIncludeInactive(params) {
  return featureShouldIncludeInactive(params);
}

// Build status filter clause for SQL queries - delegates to feature module
// Default: only ACTIVE effective_status
// With includeInactive: include all statuses
function buildStatusFilter(params, columnPrefix = '') {
  return featureBuildStatusFilter(params, columnPrefix);
}

// ============================================================================
// SALLA DETECTION
// ============================================================================
function isSallaActive() {
  return !!process.env.VIRONAX_SALLA_ACCESS_TOKEN;
}

// ============================================================================
// CITIES BY COUNTRY
// ============================================================================
export function getCitiesByCountry(store, countryCode, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);

  try {
    let citiesData = [];
    let source = '';

    if (store === 'shawq') {
      // Shopify cities for Shawq
      citiesData = db.prepare(`
        SELECT
          city,
          state,
          COUNT(*) as orders,
          SUM(subtotal) as revenue
        FROM shopify_orders
        WHERE store = ? AND country_code = ? AND date BETWEEN ? AND ?
        AND city IS NOT NULL AND city != ''
        GROUP BY city, state
        ORDER BY orders DESC
      `).all(store, countryCode, startDate, endDate);
      source = 'Shopify';
    } else if (store === 'vironax') {
      // Try Salla cities for VironaX
      citiesData = db.prepare(`
        SELECT
          city,
          state,
          COUNT(*) as orders,
          SUM(subtotal) as revenue
        FROM salla_orders
        WHERE store = ? AND country_code = ? AND date BETWEEN ? AND ?
        AND city IS NOT NULL AND city != ''
        GROUP BY city, state
        ORDER BY orders DESC
      `).all(store, countryCode, startDate, endDate);
      source = 'Salla';

      // If no Salla data, return "Requires Salla connection" message
      if (!citiesData || citiesData.length === 0) {
        return [{
          name: 'Requires Salla connection',
          city: 'Requires Salla connection',
          state: null,
          orders: 0,
          revenue: 0,
          rank: 1,
          source: 'none',
          message: 'Requires Salla connection',
          requiresSalla: true
        }];
      }
    }

    if (!citiesData || citiesData.length === 0) {
      return [];
    }

    return citiesData.map((city, index) => ({
      name: city.state ? `${city.city}, ${city.state}` : city.city,
      city: city.city || 'Unknown',
      state: city.state || null,
      orders: city.orders || 0,
      revenue: city.revenue || 0,
      aov: city.orders > 0 ? (city.revenue || 0) / city.orders : 0,
      rank: index + 1,
      source
    }));
  } catch (error) {
    console.error(`[Analytics] Error getting cities for ${countryCode}:`, error);
    return [];
  }
}

// ============================================================================
// GET TOTALS FOR RANGE
// ============================================================================
function getTotalsForRange(db, store, startDate, endDate, params = {}) {
  const statusFilter = buildStatusFilter(params);

  const metaTotals = db.prepare(`
    SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as orders
    FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ?${statusFilter}
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
  const statusFilter = buildStatusFilter(params);
  const includeInactive = shouldIncludeInactive(params);

  const current = getTotalsForRange(db, store, startDate, endDate, params);
  const previous = getTotalsForRange(db, store, prevRange.startDate, prevRange.endDate, params);

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
      MAX(status) as status, MAX(effective_status) as effective_status,
      SUM(spend) as spend, SUM(impressions) as impressions, SUM(reach) as reach,
      SUM(clicks) as clicks, SUM(conversions) as conversions, SUM(conversion_value) as conversionValue,
      SUM(landing_page_views) as lpv, SUM(add_to_cart) as atc, SUM(checkouts_initiated) as checkout
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?${statusFilter}
    GROUP BY campaign_name
    ORDER BY spend DESC
  `).all(store, startDate, endDate);

  const campaigns = campaignData.map(c => ({
    ...c,
    status: c.status || 'UNKNOWN',
    effective_status: c.effective_status || 'UNKNOWN',
    isActive: c.effective_status === 'ACTIVE',
    cpc: c.clicks > 0 ? c.spend / c.clicks : null,
    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null,
    cr: c.clicks > 0 ? (c.conversions / c.clicks) * 100 : null,
    metaRoas: c.spend > 0 ? c.conversionValue / c.spend : null,
    metaAov: c.conversions > 0 ? c.conversionValue / c.conversions : null,
    metaCac: c.conversions > 0 ? c.spend / c.conversions : null,
    cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : null,
    frequency: c.reach > 0 ? c.impressions / c.reach : null,
    conversion_value: c.conversionValue
  }));

  const metaTotals = db.prepare(`
    SELECT
      SUM(impressions) as impressions_total, SUM(reach) as reach_total,
      SUM(clicks) as clicks_total, SUM(landing_page_views) as lpv_total,
      SUM(add_to_cart) as atc_total, SUM(checkouts_initiated) as checkout_total,
      COUNT(DISTINCT campaign_name) as campaign_count
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?${statusFilter}
  `).get(store, startDate, endDate) || {};

  const metaCampaignCount = metaTotals.campaign_count || 0;
  const metaImpressionsTotal = metaTotals.impressions_total || 0;
  const metaClicksTotal = metaTotals.clicks_total || 0;

  const { countries, dataSource: countriesDataSource } = getDynamicCountries(db, store, startDate, endDate, params);

  return {
    overview,
    campaigns,
    countries,
    countriesDataSource,
    trends: getTrends(store, startDate, endDate, params),
    diagnostics: [],
    dateRange: { startDate, endDate },
    includeInactive,

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
function getDynamicCountries(db, store, startDate, endDate, params = {}) {
  const statusFilter = buildStatusFilter(params);

  // Get all Meta metrics by country (upper/mid/lower funnel)
  const metaData = db.prepare(`
    SELECT
      country as countryCode,
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
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'${statusFilter}
    GROUP BY country
  `).all(store, startDate, endDate);

  let ecomData = [];
  let dataSource = 'Meta'; // Default to Meta

  if (store === 'shawq') {
    ecomData = db.prepare(`
      SELECT country_code as countryCode, COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL GROUP BY country_code
    `).all(store, startDate, endDate);
    dataSource = 'Shopify';
  } else if (store === 'vironax') {
    // Check if Salla token exists (not database - avoids demo data issues)
    if (isSallaActive()) {
      ecomData = db.prepare(`
        SELECT country_code as countryCode, COUNT(*) as orders, SUM(subtotal) as revenue
        FROM salla_orders WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL GROUP BY country_code
      `).all(store, startDate, endDate);
      dataSource = 'Salla';
    } else {
      // Salla NOT connected - Meta conversions will be used via fallback below
      dataSource = 'Meta';
    }
  }

  const map = new Map();
  let usedMetaFallback = false;

  // First, add e-commerce data
  ecomData.forEach(e => {
    const info = getCountryInfo(e.countryCode);
    map.set(e.countryCode, {
      code: e.countryCode, name: info.name, flag: info.flag,
      spend: 0, revenue: e.revenue || 0, totalOrders: e.orders || 0,
      impressions: 0, reach: 0, clicks: 0, lpv: 0, atc: 0, checkout: 0,
      cities: []
    });
  });

  // Then, merge with Meta data
  metaData.forEach(m => {
    if(!m.spend && !m.conversions) return;
    if(!map.has(m.countryCode)) {
      const info = getCountryInfo(m.countryCode);
      map.set(m.countryCode, {
        code: m.countryCode, name: info.name, flag: info.flag,
        spend: 0, revenue: 0, totalOrders: 0,
        impressions: 0, reach: 0, clicks: 0, lpv: 0, atc: 0, checkout: 0,
        cities: []
      });
    }
    const c = map.get(m.countryCode);

    // Add Meta metrics
    c.spend += m.spend || 0;
    c.impressions += m.impressions || 0;
    c.reach += m.reach || 0;
    c.clicks += m.clicks || 0;
    c.lpv += m.lpv || 0;
    c.atc += m.atc || 0;
    c.checkout += m.checkout || 0;

    // For VironaX without Salla data, use Meta conversions
    if (store === 'vironax' && c.totalOrders === 0) {
      c.revenue = m.conversionValue || 0;
      c.totalOrders = m.conversions || 0;
      usedMetaFallback = true;
    }
  });

  // If VironaX used Meta fallback, set dataSource to Meta
  if (store === 'vironax' && usedMetaFallback && ecomData.length === 0) {
    dataSource = 'Meta';
  }

  // Add cities data for each country
  for (const [countryCode, countryData] of map.entries()) {
    const cities = getCitiesByCountry(store, countryCode, { startDate, endDate });
    countryData.cities = cities;
  }

  // Calculate metrics for each country and filter
  const countries = Array.from(map.values())
    .map(c => ({
      ...c,
      // Upper funnel metrics
      cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : null,
      frequency: c.reach > 0 ? c.impressions / c.reach : null,
      // Mid funnel metrics
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null,
      cpc: c.clicks > 0 ? c.spend / c.clicks : null,
      // Lower funnel metrics (using e-commerce data or Meta fallback)
      aov: c.totalOrders > 0 ? c.revenue / c.totalOrders : null,
      cac: c.totalOrders > 0 ? c.spend / c.totalOrders : null,
      roas: c.spend > 0 ? c.revenue / c.spend : null
    }))
    .filter(c => c.totalOrders > 0)  // Hide 0-order countries
    .filter(c => c.code && c.code !== 'ALL' && c.code.toLowerCase() !== 'unknown')
    .sort((a, b) => b.totalOrders - a.totalOrders);  // Sort by orders

  return { countries, dataSource };
}

// ============================================================================
// TRENDS
// ============================================================================
function getTrends(store, startDate, endDate, params = {}) {
  const db = getDb();
  const statusFilter = buildStatusFilter(params);
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
    salesData = db.prepare(`SELECT date, SUM(conversions) as orders, SUM(conversion_value) as revenue FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ?${statusFilter} GROUP BY date`).all(store, startDate, endDate);
  }

  const spendData = db.prepare(`SELECT date, SUM(spend) as spend FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ?${statusFilter} GROUP BY date`).all(store, startDate, endDate);

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
  // Fix 6: Changed from 7 days to 14 days
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));
  const statusFilter = buildStatusFilter(params);

  try {
    let rawData = [];
    let dataSource = 'Meta';

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
      dataSource = 'Shopify';

    } else if (store === 'vironax') {
      // Check if Salla token exists (not database - avoids demo data issues)
      if (isSallaActive()) {
        // Salla connected - try to get Salla data
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
        dataSource = 'Salla';
      } else {
        // Salla NOT connected - use Meta conversions (Meta sends intraday data)
        rawData = db.prepare(`
          SELECT
            date,
            country as countryCode,
            SUM(conversions) as orders,
            SUM(conversion_value) as revenue
          FROM meta_daily_metrics
          WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'${statusFilter}
          GROUP BY date, country
          ORDER BY date ASC, country ASC
        `).all(store, startDate, endDate);
        dataSource = 'Meta';
      }
    } else {
      return { data: [], dataSource: 'none' };
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

    // Fix 6: Filter out countries with 0 total orders and unknown countries
    const result = Array.from(countriesMap.values())
      .filter(c => c.totalOrders > 0)
      .filter(c => c.countryCode && c.countryCode.toLowerCase() !== 'unknown')
      .sort((a, b) => b.totalOrders - a.totalOrders);

    return { data: result, dataSource };
  } catch (error) {
    console.error(`[Analytics] Error getting country trends:`, error);
    return { data: [], dataSource: 'error' };
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
      sampleTimestamps: [],
      source: 'Shopify'
    };
  } catch (error) {
    console.error('[Analytics] Error getting time of day:', error);
    return { data: [], timezone: 'UTC', region: 'all', sampleTimestamps: [], source: 'error' };
  }
}

// ============================================================================
// TIME OF DAY FOR SALLA (VironaX)
// ============================================================================
export function getSallaTimeOfDay(store, params) {
  const db = getDb();
  // Use 14 days for better distribution
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));

  // Riyadh timezone is GMT+3
  const timezone = 'Asia/Riyadh';
  const offset = 3;

  const hourLabels = {
    0: '12 AM', 1: '1 AM', 2: '2 AM', 3: '3 AM', 4: '4 AM', 5: '5 AM',
    6: '6 AM', 7: '7 AM', 8: '8 AM', 9: '9 AM', 10: '10 AM', 11: '11 AM',
    12: '12 PM', 13: '1 PM', 14: '2 PM', 15: '3 PM', 16: '4 PM', 17: '5 PM',
    18: '6 PM', 19: '7 PM', 20: '8 PM', 21: '9 PM', 22: '10 PM', 23: '11 PM'
  };

  try {
    // Check if salla_orders table has created_at with time info
    const rawData = db.prepare(`
      SELECT
        created_at,
        country_code,
        subtotal as revenue
      FROM salla_orders
      WHERE store = ? AND date BETWEEN ? AND ?
      AND created_at IS NOT NULL
    `).all(store, startDate, endDate);

    if (!rawData || rawData.length === 0) {
      return { data: [], timezone, totalOrders: 0, sampleTimestamps: [], source: 'Salla', message: 'No Salla order data with timestamps' };
    }

    const hourBuckets = {};
    for (let h = 0; h < 24; h++) {
      hourBuckets[h] = { orders: 0, revenue: 0 };
    }

    for (const order of rawData) {
      if (!order.created_at) continue;

      const orderDate = new Date(order.created_at);
      if (isNaN(orderDate.getTime())) continue;

      // Convert UTC to Riyadh time (GMT+3)
      let hour = orderDate.getUTCHours() + offset;
      if (hour >= 24) hour -= 24;
      if (hour < 0) hour += 24;

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
      totalOrders: rawData.length,
      sampleTimestamps: [],
      source: 'Salla'
    };
  } catch (error) {
    console.error('[Analytics] Error getting Salla time of day:', error);
    return { data: [], timezone: 'Asia/Riyadh', sampleTimestamps: [], source: 'error' };
  }
}

// ============================================================================
// COMBINED TIME OF DAY (supports both stores)
// ============================================================================
export function getTimeOfDay(store, params) {
  if (store === 'shawq') {
    return getShopifyTimeOfDay(store, params);
  }

  if (store === 'vironax') {
    // Try Salla first
    const sallaResult = getSallaTimeOfDay(store, params);
    if (sallaResult.data && sallaResult.data.length > 0) {
      const hasOrders = sallaResult.data.some(d => d.orders > 0);
      if (hasOrders) {
        return sallaResult;
      }
    }

    // If no Salla data, return "Requires Salla connection" message
    return {
      data: [],
      timezone: 'Asia/Riyadh',
      totalOrders: 0,
      sampleTimestamps: [],
      source: 'none',
      message: 'Requires Salla connection',
      requiresSalla: true
    };
  }

  return { data: [], timezone: 'UTC', totalOrders: 0, sampleTimestamps: [], source: 'none', message: 'Unknown store' };
}

// ============================================================================
// ORDERS BY DAY OF WEEK (Fix 8)
// ============================================================================
export function getOrdersByDayOfWeek(store, params) {
  const db = getDb();
  const period = params.period || '14d';
  const statusFilter = buildStatusFilter(params);

  // Calculate date range based on period
  const endDate = formatDateAsGmt3(new Date());
  let startDate;
  if (period === '14d') {
    startDate = formatDateAsGmt3(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));
  } else if (period === '30d') {
    startDate = formatDateAsGmt3(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000));
  } else { // 'all'
    startDate = formatDateAsGmt3(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  try {
    let orders = [];
    let source = '';

    if (store === 'shawq') {
      orders = db.prepare(`SELECT date FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ?`).all(store, startDate, endDate);
      source = 'Shopify';
    } else if (store === 'vironax') {
      // Check if Salla token exists (not database - avoids demo data issues)
      if (isSallaActive()) {
        orders = db.prepare(`SELECT date FROM salla_orders WHERE store = ? AND date BETWEEN ? AND ?`).all(store, startDate, endDate);
        source = 'Salla';
      } else {
        // Salla NOT connected - use Meta conversions
        orders = db.prepare(`SELECT date FROM meta_daily_metrics WHERE store = ? AND date BETWEEN ? AND ? AND conversions > 0${statusFilter}`).all(store, startDate, endDate);
        source = 'Meta';
      }
    }

    // Count by day of week
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];
    for (const row of orders) {
      const dayIndex = new Date(row.date).getDay();
      dayCounts[dayIndex]++;
    }

    const total = dayCounts.reduce((sum, c) => sum + c, 0);

    // Build result array
    const result = dayNames.map((day, idx) => ({
      day,
      dayIndex: idx,
      orders: dayCounts[idx],
      percentage: total > 0 ? ((dayCounts[idx] / total) * 100).toFixed(1) : '0.0'
    }));

    // Sort by orders descending, add rank
    result.sort((a, b) => b.orders - a.orders);
    result.forEach((item, idx) => item.rank = idx + 1);

    return { data: result, source, totalOrders: total, period };
  } catch (error) {
    console.error('[Analytics] Days of week error:', error);
    return { data: [], source: 'error', totalOrders: 0, period };
  }
}

// ============================================================================
// BUDGET EFFICIENCY
// ============================================================================
export function getEfficiency(store, params) {
  const { startDate, endDate } = getDateRange(params);
  const db = getDb();
  const prevRange = getPreviousDateRange(startDate, endDate);

  const current = getTotalsForRange(db, store, startDate, endDate, params);
  const previous = getTotalsForRange(db, store, prevRange.startDate, prevRange.endDate, params);

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
  const trends = getTrends(store, startDate, endDate, params);
  const windowSize = 3;

  return trends.map((day, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const window = trends.slice(start, i + 1);

    const rollingSpend = window.reduce((s, d) => s + (d.spend || 0), 0);
    const rollingOrders = window.reduce((s, d) => s + (d.orders || 0), 0);
    const rollingRevenue = window.reduce((s, d) => s + (d.revenue || 0), 0);

    return {
      date: day.date,
      spend: day.spend || 0,
      orders: day.orders || 0,
      revenue: day.revenue || 0,
      cac: day.cac || 0,
      roas: day.roas || 0,
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

// ============================================================================
// HIERARCHICAL META AD MANAGER DATA
// ============================================================================

// Helper: Calculate metrics with proper null handling and defensive guards
// Uses inline_link_clicks for Link Clicks and cost_per_inline_link_click for CPC from Meta API
function calculateMetrics(row) {
  const spend = row.spend || 0;
  const impressions = row.impressions || 0;
  const reach = row.reach || 0;
  const clicks = row.clicks || 0;
  const inline_link_clicks = row.inline_link_clicks || 0;
  const conversions = row.conversions || 0;
  const conversion_value = row.conversion_value || 0;
  // Use cost_per_inline_link_click directly from Meta API if available
  const cost_per_inline_link_click = row.cost_per_inline_link_click || null;

  return {
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    frequency: reach > 0 ? impressions / reach : null,
    // CTR based on inline_link_clicks (Link Clicks)
    ctr: impressions > 0 ? (inline_link_clicks / impressions) * 100 : null,
    // Use cost_per_inline_link_click directly from Meta API
    cpc: cost_per_inline_link_click,
    roas: spend > 0 ? conversion_value / spend : null,
    aov: conversions > 0 ? conversion_value / conversions : null,
    cac: conversions > 0 ? spend / conversions : null
  };
}

// Get hierarchical Meta Ad Manager data with optional breakdown
// REDESIGNED: Country breakdown now shows as nested rows under each campaign
export function getMetaAdManagerHierarchy(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  const breakdown = params.breakdown || 'none'; // none, country, age, gender, age_gender, placement
  const statusFilter = buildStatusFilter(params);
  const includeInactive = shouldIncludeInactive(params);

  // CRITICAL: For country breakdown, we first get campaign totals, then country breakdowns as nested data
  // This ensures each campaign appears ONCE with countries as expandable nested rows

  if (breakdown === 'country') {
    // Get campaign totals (aggregate across all countries)
    const campaignTotalsQuery = `
      SELECT
        campaign_id, campaign_name,
        MAX(status) as status, MAX(effective_status) as effective_status,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value,
        CASE WHEN SUM(inline_link_clicks) > 0 THEN SUM(spend) / SUM(inline_link_clicks) ELSE NULL END as cost_per_inline_link_click
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ?${statusFilter}
      GROUP BY campaign_id
      ORDER BY spend DESC
    `;

    const campaignTotals = db.prepare(campaignTotalsQuery).all(store, startDate, endDate);

    // Get country breakdown data for all campaigns
    const countryBreakdownQuery = `
      SELECT
        campaign_id,
        country,
        MAX(date) as lastOrderDate,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value,
        CASE WHEN SUM(inline_link_clicks) > 0 THEN SUM(spend) / SUM(inline_link_clicks) ELSE NULL END as cost_per_inline_link_click
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ? AND country IS NOT NULL AND country != '' AND country != 'ALL'${statusFilter}
      GROUP BY campaign_id, country
      ORDER BY spend DESC
    `;

    const countryBreakdowns = db.prepare(countryBreakdownQuery).all(store, startDate, endDate);

    // Group country breakdowns by campaign_id
    const countryMap = new Map();
    countryBreakdowns.forEach(row => {
      if (!countryMap.has(row.campaign_id)) {
        countryMap.set(row.campaign_id, []);
      }
      const countryInfo = getCountryInfo(row.country);
      countryMap.get(row.campaign_id).push({
        ...row,
        countryName: countryInfo?.name || row.country,
        countryFlag: countryInfo?.flag || '🌍',
        ...calculateMetrics(row)
      });
    });

    // ALSO fetch adsets and ads for full hierarchy support
    const adsetQuery = `
      SELECT
        campaign_id, campaign_name, adset_id, adset_name,
        MAX(status) as status, MAX(effective_status) as effective_status,
        MAX(adset_status) as adset_status, MAX(adset_effective_status) as adset_effective_status,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value,
        CASE WHEN SUM(inline_link_clicks) > 0 THEN SUM(spend) / SUM(inline_link_clicks) ELSE NULL END as cost_per_inline_link_click
      FROM meta_adset_metrics
      WHERE store = ? AND date BETWEEN ? AND ?${statusFilter}
      GROUP BY adset_id
      ORDER BY spend DESC
    `;
    const adsets = db.prepare(adsetQuery).all(store, startDate, endDate);

    const adQuery = `
      SELECT
        campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
        MAX(status) as status, MAX(effective_status) as effective_status,
        MAX(ad_status) as ad_status, MAX(ad_effective_status) as ad_effective_status,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value,
        CASE WHEN SUM(inline_link_clicks) > 0 THEN SUM(spend) / SUM(inline_link_clicks) ELSE NULL END as cost_per_inline_link_click
      FROM meta_ad_metrics
      WHERE store = ? AND date BETWEEN ? AND ?${statusFilter}
      GROUP BY ad_id
      ORDER BY spend DESC
    `;
    const ads = db.prepare(adQuery).all(store, startDate, endDate);

    // Group ads by adset_id
    const adMap = new Map();
    ads.forEach(ad => {
      if (!adMap.has(ad.adset_id)) adMap.set(ad.adset_id, []);
      adMap.get(ad.adset_id).push({
        ...ad,
        status: ad.status || 'UNKNOWN',
        effective_status: ad.effective_status || 'UNKNOWN',
        ad_status: ad.ad_status || 'UNKNOWN',
        ad_effective_status: ad.ad_effective_status || 'UNKNOWN',
        isActive: ad.ad_effective_status === 'ACTIVE' || ad.effective_status === 'ACTIVE',
        ...calculateMetrics(ad),
        level: 'ad'
      });
    });

    // Group adsets by campaign_id
    const adsetMap = new Map();
    adsets.forEach(adset => {
      if (!adsetMap.has(adset.campaign_id)) adsetMap.set(adset.campaign_id, []);
      adsetMap.get(adset.campaign_id).push({
        ...adset,
        status: adset.status || 'UNKNOWN',
        effective_status: adset.effective_status || 'UNKNOWN',
        adset_status: adset.adset_status || 'UNKNOWN',
        adset_effective_status: adset.adset_effective_status || 'UNKNOWN',
        isActive: adset.adset_effective_status === 'ACTIVE' || adset.effective_status === 'ACTIVE',
        ...calculateMetrics(adset),
        level: 'adset',
        ads: adMap.get(adset.adset_id) || []
      });
    });

    // Build hierarchy with BOTH country breakdowns AND adsets
    const hierarchy = campaignTotals.map(campaign => ({
      ...campaign,
      status: campaign.status || 'UNKNOWN',
      effective_status: campaign.effective_status || 'UNKNOWN',
      isActive: campaign.effective_status === 'ACTIVE',
      ...calculateMetrics(campaign),
      level: 'campaign',
      country_breakdowns: countryMap.get(campaign.campaign_id) || [],
      adsets: adsetMap.get(campaign.campaign_id) || []
    }));

    return {
      data: hierarchy,
      includeInactive,
      dateRange: { startDate, endDate }
    };
  }

  // For non-country breakdowns, use original logic
  let breakdownSelect = '';
  let breakdownGroup = '';
  let breakdownWhere = '';

  if (breakdown === 'age') {
    breakdownSelect = ', age';
    breakdownGroup = ', age';
    breakdownWhere = "AND age != ''";
  } else if (breakdown === 'gender') {
    breakdownSelect = ', gender';
    breakdownGroup = ', gender';
    breakdownWhere = "AND gender != ''";
  } else if (breakdown === 'age_gender') {
    breakdownSelect = ', age, gender';
    breakdownGroup = ', age, gender';
    breakdownWhere = "AND age != '' AND gender != ''";
  } else if (breakdown === 'placement') {
    breakdownSelect = ', publisher_platform, platform_position';
    breakdownGroup = ', publisher_platform, platform_position';
    breakdownWhere = "AND publisher_platform != ''";
  }

  // Get campaigns with status info
  const campaignQuery = `
    SELECT
      campaign_id, campaign_name,
      MAX(status) as status, MAX(effective_status) as effective_status,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(inline_link_clicks) as inline_link_clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversion_value,
      CASE WHEN SUM(inline_link_clicks) > 0 THEN SUM(spend) / SUM(inline_link_clicks) ELSE NULL END as cost_per_inline_link_click
      ${breakdownSelect}
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? ${breakdownWhere}${statusFilter}
    GROUP BY campaign_id${breakdownGroup}
    ORDER BY spend DESC
  `;

  const campaigns = db.prepare(campaignQuery).all(store, startDate, endDate);

  const campaignsWithMetrics = campaigns.map(c => ({
    ...c,
    status: c.status || 'UNKNOWN',
    effective_status: c.effective_status || 'UNKNOWN',
    isActive: c.effective_status === 'ACTIVE',
    ...calculateMetrics(c),
    level: 'campaign'
  }));

  // Get ad sets with status info
  const adsetQuery = `
    SELECT
      campaign_id, campaign_name, adset_id, adset_name,
      MAX(status) as status, MAX(effective_status) as effective_status,
      MAX(adset_status) as adset_status, MAX(adset_effective_status) as adset_effective_status,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(inline_link_clicks) as inline_link_clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversion_value,
      CASE WHEN SUM(inline_link_clicks) > 0 THEN SUM(spend) / SUM(inline_link_clicks) ELSE NULL END as cost_per_inline_link_click
      ${breakdownSelect}
    FROM meta_adset_metrics
    WHERE store = ? AND date BETWEEN ? AND ? ${breakdownWhere}${statusFilter}
    GROUP BY adset_id${breakdownGroup}
    ORDER BY spend DESC
  `;

  const adsets = db.prepare(adsetQuery).all(store, startDate, endDate);

  const adsetsWithMetrics = adsets.map(a => ({
    ...a,
    status: a.status || 'UNKNOWN',
    effective_status: a.effective_status || 'UNKNOWN',
    adset_status: a.adset_status || 'UNKNOWN',
    adset_effective_status: a.adset_effective_status || 'UNKNOWN',
    isActive: a.adset_effective_status === 'ACTIVE' || a.effective_status === 'ACTIVE',
    ...calculateMetrics(a),
    level: 'adset'
  }));

  // Get ads with status info
  const adQuery = `
    SELECT
      campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
      MAX(status) as status, MAX(effective_status) as effective_status,
      MAX(ad_status) as ad_status, MAX(ad_effective_status) as ad_effective_status,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(inline_link_clicks) as inline_link_clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversion_value,
      CASE WHEN SUM(inline_link_clicks) > 0 THEN SUM(spend) / SUM(inline_link_clicks) ELSE NULL END as cost_per_inline_link_click
      ${breakdownSelect}
    FROM meta_ad_metrics
    WHERE store = ? AND date BETWEEN ? AND ? ${breakdownWhere}${statusFilter}
    GROUP BY ad_id${breakdownGroup}
    ORDER BY spend DESC
  `;

  const ads = db.prepare(adQuery).all(store, startDate, endDate);

  const adsWithMetrics = ads.map(a => ({
    ...a,
    status: a.status || 'UNKNOWN',
    effective_status: a.effective_status || 'UNKNOWN',
    ad_status: a.ad_status || 'UNKNOWN',
    ad_effective_status: a.ad_effective_status || 'UNKNOWN',
    isActive: a.ad_effective_status === 'ACTIVE' || a.effective_status === 'ACTIVE',
    ...calculateMetrics(a),
    level: 'ad'
  }));

  // Helper: Create composite key for matching with breakdown
  const getCompositeKey = (item) => {
    let key = '';
    if (breakdown === 'age') {
      key = item.age || '';
    } else if (breakdown === 'gender') {
      key = item.gender || '';
    } else if (breakdown === 'age_gender') {
      key = `${item.age || ''}-${item.gender || ''}`;
    } else if (breakdown === 'placement') {
      key = `${item.publisher_platform || ''}-${item.platform_position || ''}`;
    }
    return key;
  };

  // Build hierarchy with breakdown-aware grouping
  // Group adsets by campaign_id
  const adsetMap = new Map();
  adsetsWithMetrics.forEach(adset => {
    const key = breakdown === 'none' ? adset.campaign_id : `${adset.campaign_id}-${getCompositeKey(adset)}`;
    if (!adsetMap.has(key)) adsetMap.set(key, []);
    adsetMap.get(key).push(adset);
  });

  // Group ads by adset_id
  const adMap = new Map();
  adsWithMetrics.forEach(ad => {
    const key = breakdown === 'none' ? ad.adset_id : `${ad.adset_id}-${getCompositeKey(ad)}`;
    if (!adMap.has(key)) adMap.set(key, []);
    adMap.get(key).push(ad);
  });

  // Build hierarchy using grouped data
  const hierarchy = campaignsWithMetrics.map(campaign => {
    const campaignKey = breakdown === 'none' ? campaign.campaign_id : `${campaign.campaign_id}-${getCompositeKey(campaign)}`;
    const campaignAdsets = (adsetMap.get(campaignKey) || []).map(adset => {
      const adsetKey = breakdown === 'none' ? adset.adset_id : `${adset.adset_id}-${getCompositeKey(adset)}`;
      return {
        ...adset,
        ads: adMap.get(adsetKey) || []
      };
    });

    return {
      ...campaign,
      adsets: campaignAdsets,
      country_breakdowns: [] // Empty for non-country breakdowns
    };
  });

  return {
    data: hierarchy,
    includeInactive,
    dateRange: { startDate, endDate }
  };
}

// ============================================================================
// REACTIVATION CANDIDATES - For AI to recommend reactivating old winners
// Uses Meta Awareness feature module for consistent scoring and data
// ============================================================================
export function getReactivationCandidates(store, params = {}) {
  try {
    // Delegate to the feature module for consistent scoring and data structure
    return featureGetReactivationCandidates(store, params);
  } catch (error) {
    console.error('[Analytics] Error getting reactivation candidates:', error);
    return {
      campaigns: [],
      adsets: [],
      ads: [],
      summary: { total: 0, campaigns: 0, adsets: 0, ads: 0, topScore: 0 },
      dateRange: { startDate: '', endDate: '' },
      note: 'Error fetching reactivation candidates'
    };
  }
}

// ============================================================================
// GET ALL OBJECTS WITH STATUS - For AI to understand full account structure
// ============================================================================
export function getAllMetaObjects(store, params = {}) {
  const db = getDb();

  try {
    const objects = db.prepare(`
      SELECT
        object_type,
        object_id,
        object_name,
        parent_id,
        parent_name,
        grandparent_id,
        grandparent_name,
        status,
        effective_status,
        created_time,
        start_time,
        stop_time,
        daily_budget,
        lifetime_budget,
        objective,
        optimization_goal,
        bid_strategy,
        last_synced_at
      FROM meta_objects
      WHERE store = ?
      ORDER BY object_type, object_name
    `).all(store);

    // Group by type
    const campaigns = objects.filter(o => o.object_type === 'campaign');
    const adsets = objects.filter(o => o.object_type === 'adset');
    const ads = objects.filter(o => o.object_type === 'ad');

    // Count active/inactive
    const activeCount = objects.filter(o => o.effective_status === 'ACTIVE').length;
    const pausedCount = objects.filter(o => o.effective_status === 'PAUSED').length;
    const archivedCount = objects.filter(o => o.effective_status === 'ARCHIVED').length;
    const otherCount = objects.length - activeCount - pausedCount - archivedCount;

    return {
      campaigns,
      adsets,
      ads,
      summary: {
        total: objects.length,
        active: activeCount,
        paused: pausedCount,
        archived: archivedCount,
        other: otherCount,
        byCampaigns: campaigns.length,
        byAdsets: adsets.length,
        byAds: ads.length
      }
    };
  } catch (error) {
    console.error('[Analytics] Error getting meta objects:', error);
    return { campaigns: [], adsets: [], ads: [], summary: {} };
  }
}

// ============================================================================
// FUNNEL DIAGNOSTICS
// ============================================================================
export function getFunnelDiagnostics(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  const campaignId = params.campaignId || null; // Optional campaign filter
  const statusFilter = buildStatusFilter(params);

  // Calculate previous period for comparison
  const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
  const prevEndDate = new Date(new Date(startDate).getTime() - (1000 * 60 * 60 * 24));
  const prevStartDate = new Date(prevEndDate.getTime() - ((daysDiff - 1) * 1000 * 60 * 60 * 24));
  const prevStartStr = formatDateAsGmt3(prevStartDate);
  const prevEndStr = formatDateAsGmt3(prevEndDate);

  // Build WHERE clause with optional campaign filter
  const campaignFilter = campaignId ? ' AND campaign_id = ?' : '';
  const queryParams = campaignId
    ? [store, startDate, endDate, campaignId]
    : [store, startDate, endDate];
  const prevQueryParams = campaignId
    ? [store, prevStartStr, prevEndStr, campaignId]
    : [store, prevStartStr, prevEndStr];

  // Get current period metrics
  const currentQuery = `
    SELECT
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout,
      SUM(conversions) as purchases,
      SUM(conversion_value) as revenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?${campaignFilter}${statusFilter}
  `;

  const current = db.prepare(currentQuery).get(...queryParams);
  const previous = db.prepare(currentQuery).get(...prevQueryParams);

  // Get daily data for sparklines (last 7 days of current period)
  const dailyQuery = `
    SELECT
      date,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout,
      SUM(conversions) as purchases,
      SUM(conversion_value) as revenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?${campaignFilter}${statusFilter}
    GROUP BY date
    ORDER BY date DESC
    LIMIT 7
  `;

  const dailyData = db.prepare(dailyQuery).all(...queryParams).reverse();

  // Get campaign name if specific campaign selected
  let campaignName = null;
  if (campaignId) {
    const campaignInfo = db.prepare(
      'SELECT campaign_name FROM meta_daily_metrics WHERE campaign_id = ? LIMIT 1'
    ).get(campaignId);
    campaignName = campaignInfo?.campaign_name || null;
  }

  // Calculate metrics with defensive guards
  const calcMetrics = (d) => {
    if (!d) return null;
    const spend = d.spend || 0;
    const impressions = d.impressions || 0;
    const reach = d.reach || 0;
    const clicks = d.clicks || 0;
    const lpv = d.lpv || 0;
    const atc = d.atc || 0;
    const checkout = d.checkout || 0;
    const purchases = d.purchases || 0;
    const revenue = d.revenue || 0;

    if (impressions === 0) return null;

    return {
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      frequency: reach > 0 ? impressions / reach : 0,
      lpvRate: clicks > 0 ? (lpv / clicks) * 100 : 0,
      atcRate: lpv > 0 ? (atc / lpv) * 100 : 0,
      checkoutRate: atc > 0 ? (checkout / atc) * 100 : 0,
      purchaseRate: checkout > 0 ? (purchases / checkout) * 100 : 0,
      cvr: clicks > 0 ? (purchases / clicks) * 100 : 0,
      roas: spend > 0 ? revenue / spend : 0,
      cac: purchases > 0 ? spend / purchases : 0,
      aov: purchases > 0 ? revenue / purchases : 0,
      // Raw values for display
      spend,
      impressions,
      clicks,
      purchases,
      revenue
    };
  };

  const currentMetrics = calcMetrics(current);
  const previousMetrics = calcMetrics(previous);

  // Calculate daily metrics for sparklines
  const sparklineData = dailyData.map(d => calcMetrics(d)).filter(Boolean);

  // Calculate % changes
  const calcChange = (curr, prev) => {
    if (!prev || prev === 0) return null;
    return ((curr - prev) / prev) * 100;
  };

  const changes = currentMetrics && previousMetrics ? {
    ctr: calcChange(currentMetrics.ctr, previousMetrics.ctr),
    cpc: calcChange(currentMetrics.cpc, previousMetrics.cpc),
    cpm: calcChange(currentMetrics.cpm, previousMetrics.cpm),
    frequency: calcChange(currentMetrics.frequency, previousMetrics.frequency),
    lpvRate: calcChange(currentMetrics.lpvRate, previousMetrics.lpvRate),
    atcRate: calcChange(currentMetrics.atcRate, previousMetrics.atcRate),
    checkoutRate: calcChange(currentMetrics.checkoutRate, previousMetrics.checkoutRate),
    purchaseRate: calcChange(currentMetrics.purchaseRate, previousMetrics.purchaseRate),
    cvr: calcChange(currentMetrics.cvr, previousMetrics.cvr),
    roas: calcChange(currentMetrics.roas, previousMetrics.roas),
    cac: calcChange(currentMetrics.cac, previousMetrics.cac),
  } : {};

  return {
    current: currentMetrics,
    previous: previousMetrics,
    changes,
    sparklineData,
    campaignId,
    campaignName,
    period: { startDate, endDate, prevStartDate: prevStartStr, prevEndDate: prevEndStr }
  };
}
