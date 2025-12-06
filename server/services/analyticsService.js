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
  
  // Get campaign data
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
      SUM(conversion_value) as conversionValue,
      AVG(cpm) as cpm,
      AVG(frequency) as frequency
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country = 'ALL'
    GROUP BY campaign_id, campaign_name
    ORDER BY spend DESC
  `).all(store, startDate, endDate);

  const campaigns = campaignData.map(c => ({
    ...c,
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
    cr: c.clicks > 0 ? (c.conversions / c.clicks) * 100 : 0,
    metaRoas: c.spend > 0 ? c.conversionValue / c.spend : 0,
    metaAov: c.conversions > 0 ? c.conversionValue / c.conversions : 0,
    metaCac: c.conversions > 0 ? c.spend / c.conversions : 0
  }));

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
      SUM(conversions) as conversions_total
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, startDate, endDate) || {};

  const metaCampaignCount = db.prepare(`
    SELECT COUNT(DISTINCT campaign_id) as count
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND spend > 0
  `).get(store, startDate, endDate)?.count || 0;

  const metaSpendTotal = metaTotals.metaSpendTotal || 0;
  const metaRevenueTotal = metaTotals.metaRevenueTotal || 0;
  const impressions_total = metaTotals.impressions_total || 0;
  const reach_total = metaTotals.reach_total || 0;
  const clicks_total = metaTotals.clicks_total || 0;
  const lpv_total = metaTotals.lpv_total || 0;
  const atc_total = metaTotals.atc_total || 0;
  const checkout_total = metaTotals.checkout_total || 0;
  const conversions_total = metaTotals.conversions_total || 0;

  const metaRoasTotal = metaSpendTotal > 0 ? metaRevenueTotal / metaSpendTotal : null;
  const ctr_total = impressions_total > 0 ? clicks_total / impressions_total : null;
  const meta_cac_total = conversions_total > 0 ? metaSpendTotal / conversions_total : null;

  // Get e-commerce orders
  let ecomOrders;
  let ecomCityOrders;
  if (store === 'vironax') {
    ecomOrders = db.prepare(`
      SELECT
        country_code as countryCode,
        COUNT(*) as orders,
        SUM(order_total) as revenue
      FROM salla_orders
      WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code
    `).all(store, startDate, endDate);

    // FIXED: Use correct column name for Salla
    ecomCityOrders = db.prepare(`
      SELECT
        country_code as countryCode,
        COALESCE(NULLIF(city, ''), 'Unknown') as city,
        COUNT(*) as orders,
        SUM(order_total) as revenue
      FROM salla_orders
      WHERE store = ? AND date BETWEEN ? AND ? 
        AND country_code IS NOT NULL 
        AND country_code != ''
        AND city IS NOT NULL
        AND city != ''
      GROUP BY country_code, city
    `).all(store, startDate, endDate);
  } else {
    ecomOrders = db.prepare(`
      SELECT
        country_code as countryCode,
        COUNT(*) as orders,
        SUM(subtotal) as revenue
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code
    `).all(store, startDate, endDate);

    // FIXED: Use billing_city and billing_province for Shopify
    ecomCityOrders = db.prepare(`
      SELECT
        country_code as countryCode,
        COALESCE(NULLIF(billing_city, ''), 'Unknown') as city,
        COALESCE(NULLIF(billing_province, ''), '') as state,
        COUNT(*) as orders,
        SUM(subtotal) as revenue
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ? 
        AND country_code IS NOT NULL 
        AND country_code != ''
        AND billing_city IS NOT NULL
        AND billing_city != ''
      GROUP BY country_code, billing_province, billing_city
      ORDER BY country_code, orders DESC
    `).all(store, startDate, endDate);
  }

  // Get manual orders
  const manualOrders = db.prepare(`
    SELECT
      country as countryCode,
      SUM(spend) as spend,
      SUM(orders_count) as orders,
      SUM(revenue) as revenue
    FROM manual_orders
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY country
  `).all(store, startDate, endDate);

  const manualSpendOverrides = db.prepare(`
    SELECT
      country as countryCode,
      SUM(amount) as amount
    FROM manual_spend_overrides
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY country
  `).all(store, startDate, endDate);

  // Get meta spend by country
  const metaByCountry = db.prepare(`
    SELECT 
      country as countryCode,
      SUM(spend) as spend,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversionValue,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY country
  `).all(store, startDate, endDate);

  // Build dynamic countries list
  const countryMap = new Map();

  // Seed with ecommerce countries
  for (const e of ecomOrders) {
    const info = getCountryInfo(e.countryCode);
    countryMap.set(e.countryCode, {
      code: e.countryCode,
      name: info.name,
      flag: info.flag,
      spend: 0,
      manualSpend: 0,
      metaOrders: 0,
      metaRevenue: 0,
      ecomOrders: e.orders || 0,
      manualOrders: 0,
      revenue: e.revenue || 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      lpv: 0,
      atc: 0,
      checkout: 0,
      cities: []
    });
  }

  // Attach ecommerce cities
  const usStateAggregates = new Map();
  for (const cityRow of ecomCityOrders || []) {
    const country = countryMap.get(cityRow.countryCode);
    if (!country) continue;
    if (!cityRow.orders && !cityRow.revenue) continue;

    // For US: aggregate by state
    if (cityRow.countryCode === 'US') {
      const stateName = cityRow.state?.trim() || 'Unknown';
      const cityName = cityRow.city?.trim() || 'Unknown';

      const existing = usStateAggregates.get(stateName) || {
        city: stateName,
        orders: 0,
        revenue: 0,
        cities: []
      };

      existing.orders += cityRow.orders || 0;
      existing.revenue += cityRow.revenue || 0;

      if (cityRow.orders || cityRow.revenue) {
        const cityList = existing.cities || [];
        const existingCity = cityList.find(c => c.city === cityName) || { city: cityName, orders: 0, revenue: 0 };
        existingCity.orders += cityRow.orders || 0;
        existingCity.revenue += cityRow.revenue || 0;

        if (!cityList.includes(existingCity)) {
          cityList.push(existingCity);
        }

        existing.cities = cityList;
      }

      usStateAggregates.set(stateName, existing);
      continue;
    }

    // Non-US: flat city list
    const cityName = cityRow.city?.trim() || 'Unknown';
    const formattedCity = cityRow.countryCode === 'US' && (cityRow.state?.trim())
      ? `${cityName}, ${cityRow.state.trim()}`
      : cityName;
    country.cities.push({
      city: formattedCity,
      orders: cityRow.orders || 0,
      revenue: cityRow.revenue || 0
    });
  }

  // Attach US states with rankings
  if (usStateAggregates.size > 0 && countryMap.has('US')) {
    const usStates = Array.from(usStateAggregates.values()).filter(state => state.orders > 0);
    const rankedStates = [...usStates].sort((a, b) => b.orders - a.orders);

    rankedStates.slice(0, 3).forEach((state, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
      const target = usStates.find(s => s.city === state.city);
      if (target) {
        target.medal = medal;
        target.rank = idx + 1;
      }
    });

    const topStates = rankedStates.slice(0, 3);
    const remainingStates = usStates
      .filter(state => !topStates.some(top => top.city === state.city))
      .sort((a, b) => a.city.localeCompare(b.city));

    const orderedStates = [...topStates, ...remainingStates].map(state => ({
      ...state,
      cities: (state.cities || [])
        .filter(city => city.orders > 0)
        .sort((a, b) => b.orders - a.orders)
    }));

    countryMap.get('US').cities = orderedStates;
  }

  // Add Meta spend
  for (const m of metaByCountry) {
    if (!countryMap.has(m.countryCode)) continue;
    const country = countryMap.get(m.countryCode);
    country.spend = (country.spend || 0) + (m.spend || 0);
    country.metaOrders = (country.metaOrders || 0) + (m.conversions || 0);
    country.metaRevenue = (country.metaRevenue || 0) + (m.conversionValue || 0);
    country.impressions = (country.impressions || 0) + (m.impressions || 0);
    country.reach = (country.reach || 0) + (m.reach || 0);
    country.clicks = (country.clicks || 0) + (m.clicks || 0);
    country.lpv = (country.lpv || 0) + (m.lpv || 0);
    country.atc = (country.atc || 0) + (m.atc || 0);
    country.checkout = (country.checkout || 0) + (m.checkout || 0);
  }

  // Add manual orders
  for (const m of manualOrders) {
    if (!countryMap.has(m.countryCode)) continue;
    const country = countryMap.get(m.countryCode);
    country.manualOrders = (country.manualOrders || 0) + (m.orders || 0);
    country.manualSpend = (country.manualSpend || 0) + (m.spend || 0);
    country.spend = (country.spend || 0) + (m.spend || 0);
    country.revenue += m.revenue || 0;
  }

  // Apply spend overrides
  const overrideMap = new Map(
    manualSpendOverrides.map(o => [o.countryCode || 'ALL', o.amount || 0])
  );

  for (const [countryCode, amount] of overrideMap.entries()) {
    if (countryCode === 'ALL') continue;
    if (!countryMap.has(countryCode)) continue;
    const country = countryMap.get(countryCode);
    country.spend = amount || 0;
    country.manualSpend = amount || 0;
  }

  // Calculate country metrics
  const countries = Array.from(countryMap.values())
    .map(c => {
      const totalOrders = c.ecomOrders + c.manualOrders;
      const citiesWithAov = (c.code === 'US'
        ? (c.cities || []).map(city => ({
            ...city,
            aov: city.orders > 0 ? city.revenue / city.orders : 0,
            cities: (city.cities || []).map(innerCity => ({
              ...innerCity,
              aov: innerCity.orders > 0 ? innerCity.revenue / innerCity.orders : 0
            }))
          }))
        : (c.cities || []).map(city => ({
            ...city,
            aov: city.orders > 0 ? city.revenue / city.orders : 0
          }))
      );
      return {
        ...c,
        cities: citiesWithAov,
        totalOrders,
        aov: totalOrders > 0 ? c.revenue / totalOrders : 0,
        cac: totalOrders > 0 ? c.spend / totalOrders : 0,
        roas: c.spend > 0 ? c.revenue / c.spend : 0,
        ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
        cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0,
        frequency: c.reach > 0 ? c.impressions / c.reach : 0
      };
    })
    .filter(c => (c.ecomOrders || 0) > 0 || (c.revenue || 0) > 0)
    .sort((a, b) => b.spend - a.spend);

  // Calculate overview
  const overallOverride = overrideMap.get('ALL');
  const totalSpend = overallOverride != null
    ? overallOverride
    : countries.reduce((s, c) => s + (c.spend || 0), 0);
  const totalEcomOrders = ecomOrders.reduce((s, e) => s + e.orders, 0);
  const totalManualOrders = manualOrders.reduce((s, m) => s + m.orders, 0);
  const totalOrders = totalEcomOrders + totalManualOrders;
  const totalRevenue = countries.reduce((s, c) => s + c.revenue, 0);

  const overview = {
    revenue: totalRevenue,
    spend: totalSpend,
    orders: totalOrders,
    sallaOrders: store === 'vironax' ? totalEcomOrders : 0,
    shopifyOrders: store === 'shawq' ? totalEcomOrders : 0,
    manualOrders: totalManualOrders,
    aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    cac: totalOrders > 0 ? totalSpend / totalOrders : 0,
    roas: totalSpend > 0 ? totalRevenue / totalSpend : 0
  };

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
    metaRoasTotal,
    metaImpressionsTotal: impressions_total,
    metaReachTotal: reach_total,
    metaClicksTotal: clicks_total,
    metaCtrTotal: ctr_total,
    metaLpvTotal: lpv_total,
    metaAtcTotal: atc_total,
    metaCheckoutTotal: checkout_total,
    metaConversionsTotal: conversions_total,
    metaCacTotal: meta_cac_total
  };
}

function getTrends(store, startDate, endDate) {
  const db = getDb();
  
  const allDates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    allDates.push(formatDateAsGmt3(d));
  }
  
  const metaDaily = db.prepare(`
    SELECT 
      date,
      SUM(spend) as spend,
      SUM(conversions) as metaConversions,
      SUM(conversion_value) as metaRevenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country = 'ALL'
    GROUP BY date
    ORDER BY date
  `).all(store, startDate, endDate);

  let ecomDaily;
  if (store === 'vironax') {
    ecomDaily = db.prepare(`
      SELECT date, COUNT(*) as orders, SUM(order_total) as revenue
      FROM salla_orders WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY date
    `).all(store, startDate, endDate);
  } else {
    ecomDaily = db.prepare(`
      SELECT date, COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY date
    `).all(store, startDate, endDate);
  }

  const manualDaily = db.prepare(`
    SELECT date, SUM(spend) as spend, SUM(orders_count) as orders, SUM(revenue) as revenue
    FROM manual_orders WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY date
  `).all(store, startDate, endDate);

  const dateMap = new Map();
  for (const date of allDates) {
    dateMap.set(date, { date, spend: 0, orders: 0, revenue: 0 });
  }
  
  for (const m of metaDaily) {
    if (dateMap.has(m.date)) {
      dateMap.get(m.date).spend = m.spend || 0;
    }
  }

  for (const e of ecomDaily) {
    if (dateMap.has(e.date)) {
      dateMap.get(e.date).orders += e.orders || 0;
      dateMap.get(e.date).revenue += e.revenue || 0;
    }
  }

  for (const m of manualDaily) {
    if (dateMap.has(m.date)) {
      dateMap.get(m.date).spend += m.spend || 0;
      dateMap.get(m.date).orders += m.orders || 0;
      dateMap.get(m.date).revenue += m.revenue || 0;
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
    diagnostics.push({
      type: 'warning',
      icon: '⚠️',
      title: 'Low ROAS',
      detail: `Overall ROAS is ${overview.roas.toFixed(2)}× which is below the 2× breakeven threshold`,
      action: 'Consider pausing low performers and reallocating budget'
    });
  } else if (overview.roas > 4) {
    diagnostics.push({
      type: 'success',
      icon: '✅',
      title: 'Strong ROAS',
      detail: `Overall ROAS is ${overview.roas.toFixed(2)}× - excellent performance`,
      action: 'Consider scaling budget on top performers'
    });
  }

  const avgCAC = overview.cac;
  if (avgCAC > 100) {
    diagnostics.push({
      type: 'warning',
      icon: '💰',
      title: 'High CAC',
      detail: `Average CAC is $${avgCAC.toFixed(0)} which may be eating into margins`,
      action: 'Review targeting and creative performance'
    });
  }

  for (const c of campaigns) {
    if (c.frequency > 3) {
      diagnostics.push({
        type: 'warning',
        icon: '🔄',
        title: `High Frequency: ${c.campaignName}`,
        detail: `Frequency of ${c.frequency.toFixed(1)} indicates audience fatigue`,
        action: 'Refresh creatives or expand audience'
      });
      break;
    }
  }

  const avgCTR = campaigns.reduce((s, c) => s + c.ctr, 0) / (campaigns.length || 1);
  if (avgCTR < 0.8) {
    diagnostics.push({
      type: 'warning',
      icon: '👆',
      title: 'Low CTR',
      detail: `Average CTR is ${avgCTR.toFixed(2)}% - below industry benchmark`,
      action: 'Test new ad creatives and copy'
    });
  }

  return diagnostics;
}

export function getEfficiency(store, params) {
  return { status: 'green', campaigns: [], countries: [], averageCac: 0, marginalCac: 0 };
}

export function getEfficiencyTrends(store, params) {
  return [];
}

export function getRecommendations(store, params) {
  return [];
}

export function getAvailableCountries(store) {
  return getAllCountries();
}

export function getCampaignsByCountry(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  
  const data = db.prepare(`
    SELECT 
      campaign_id as campaignId,
      campaign_name as campaignName,
      country,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(landing_page_views) as lpv,
      SUM(add_to_cart) as atc,
      SUM(checkouts_initiated) as checkout,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversionValue,
      AVG(cpm) as cpm,
      AVG(frequency) as frequency
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY campaign_id, campaign_name, country
    ORDER BY campaign_name, spend DESC
  `).all(store, startDate, endDate);

  return data.map(c => {
    const countryInfo = getCountryInfo(c.country);
    return {
      ...c,
      countryName: countryInfo.name,
      countryFlag: countryInfo.flag,
      cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
      cr: c.clicks > 0 ? (c.conversions / c.clicks) * 100 : 0,
      metaRoas: c.spend > 0 ? c.conversionValue / c.spend : 0,
      metaAov: c.conversions > 0 ? c.conversionValue / c.conversions : 0,
      metaCac: c.conversions > 0 ? c.spend / c.conversions : 0
    };
  });
}

export function getCampaignsByAge(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  
  const data = db.prepare(`
    SELECT 
      campaign_id as campaignId,
      campaign_name as campaignName,
      age,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversionValue,
      AVG(cpm) as cpm,
      AVG(frequency) as frequency
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND age IS NOT NULL AND age != ''
    GROUP BY campaign_id, campaign_name, age
    ORDER BY campaign_name, spend DESC
  `).all(store, startDate, endDate);

  return data.map(c => ({
    ...c,
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
    cr: c.clicks > 0 ? (c.conversions / c.clicks) * 100 : 0,
    metaRoas: c.spend > 0 ? c.conversionValue / c.spend : 0,
    metaAov: c.conversions > 0 ? c.conversionValue / c.conversions : 0,
    metaCac: c.conversions > 0 ? c.spend / c.conversions : 0
  }));
}

export function getCampaignsByGender(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);
  
  const data = db.prepare(`
    SELECT 
      campaign_id as campaignId,
      campaign_name as campaignName,
      gender,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversionValue,
      AVG(cpm) as cpm,
      AVG(frequency) as frequency
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND gender IS NOT NULL AND gender != ''
    GROUP BY campaign_id, campaign_name, gender
    ORDER BY campaign_name, spend DESC
  `).all(store, startDate, endDate);

  return data.map(c => ({
    ...c,
    genderLabel: c.gender === 'male' ? '👨 Male' : c.gender === 'female' ? '👩 Female' : '❓ Unknown',
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
    ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
    cr: c.clicks > 0 ? (c.conversions / c.clicks) * 100 : 0,
    metaRoas: c.spend > 0 ? c.conversionValue / c.spend : 0,
    metaAov: c.conversions > 0 ? c.conversionValue / c.conversions : 0,
    metaCac: c.conversions > 0 ?
