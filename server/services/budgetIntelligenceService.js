import { getDb } from '../db/database.js';
import { getAvailableCountries } from './analyticsService.js';

const FX_SAR_RATES = {
  SAR: 1,
  USD: 1 / 3.75
};

const BRAND_CONSTANTS = {
  vironax: {
    fallbackCAC: 120,
    fallbackROAS: 2.5,
    targetROAS: 3.0,
    currency: 'SAR'
  },
  shawq: {
    fallbackCAC: 45,
    fallbackROAS: 2.0,
    targetROAS: 2.5,
    currency: 'USD'
  }
};

function getDateRange(params) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  if (params.startDate && params.endDate) {
    const start = new Date(params.startDate);
    const end = new Date(params.endDate);
    const days = Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1;
    return { startDate: params.startDate, endDate: params.endDate, days };
  }

  if (params.yesterday) {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { startDate: yesterday, endDate: yesterday, days: 1 };
  }

  let days = 7;

  if (params.days) days = parseInt(params.days);
  else if (params.weeks) days = parseInt(params.weeks) * 7;
  else if (params.months) days = parseInt(params.months) * 30;

  const endDate = today;
  const startMs = now.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
  const startDate = new Date(startMs).toISOString().split('T')[0];

  return { startDate, endDate, days };
}

function getPriorRange(endDate, daysBack = 60) {
  const end = new Date(endDate || new Date());
  const start = new Date(end);
  start.setDate(end.getDate() - (daysBack - 1));
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
    days: daysBack
  };
}

function sarToCurrency(amount, currency) {
  const rate = FX_SAR_RATES[currency] || 1;
  return amount * rate;
}

function safeDivide(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computePosterior(priorMean, priorWeight, observedMean, effectiveN) {
  const observed = observedMean == null ? priorMean : observedMean;
  const weight = effectiveN >= 20 ? 3 : priorWeight;
  const obsWeight = effectiveN || 1;
  return ((priorMean * weight) + (observed * obsWeight)) / (weight + obsWeight);
}

function normalCdf(x) {
  // Abramowitz and Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let probability = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) {
    probability = 1 - probability;
  }
  return probability;
}

function probabilityAboveThreshold(mean, sigma, target, direction = 'above') {
  if (sigma === 0) return mean >= target ? 1 : 0;
  const z = (target - mean) / sigma;
  const prob = normalCdf(z);
  return direction === 'above' ? 1 - prob : prob;
}

function confidenceLabel(effectiveN) {
  if (effectiveN >= 20) return 'High';
  if (effectiveN >= 8) return 'Medium';
  return 'Low';
}

export function getBudgetIntelligence(store, params) {
  const db = getDb();
  const { startDate, endDate, days } = getDateRange(params);
  const brandDefaults = BRAND_CONSTANTS[store] || BRAND_CONSTANTS.shawq;

  // Priors: use last 60 days ending at selected end date
  const priorRange = getPriorRange(endDate);
  const priorMeta = db.prepare(`
    SELECT SUM(spend) as spend, SUM(conversions) as purchases, SUM(conversion_value) as revenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, priorRange.startDate, priorRange.endDate) || {};

  const priorConversions = priorMeta.purchases || 0;
  const priorSpend = priorMeta.spend || 0;
  const priorRevenue = priorMeta.revenue || 0;

  const metaCacSamples = db.prepare(`
    SELECT spend, conversions
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND conversions > 0 AND spend > 0
  `).all(store, priorRange.startDate, priorRange.endDate);

  const cacValues = metaCacSamples.map(row => row.spend / row.conversions).filter(v => v > 0);
  const medianBrandCac = median(cacValues) || brandDefaults.fallbackCAC;

  const priorMeanCAC = priorConversions > 0 && priorSpend > 0
    ? priorSpend / priorConversions
    : brandDefaults.fallbackCAC;
  const priorMeanROAS = priorSpend > 0 ? priorRevenue / priorSpend : brandDefaults.fallbackROAS;

  // Current period meta by campaign x country (excluding ALL)
  const campaignRows = db.prepare(`
    SELECT
      campaign_id as campaignId,
      campaign_name as campaignName,
      country,
      SUM(spend) as spend,
      SUM(conversions) as conversions,
      SUM(conversion_value) as revenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY campaign_id, campaign_name, country
  `).all(store, startDate, endDate);

  // Country-level aggregates for observed signal
  const metaByCountry = db.prepare(`
    SELECT country, SUM(spend) as spend, SUM(conversions) as conversions, SUM(conversion_value) as revenue
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    GROUP BY country
  `).all(store, startDate, endDate);

  let ecommerceOrders = [];
  if (store === 'vironax') {
    ecommerceOrders = db.prepare(`
      SELECT country_code as country, COUNT(*) as orders, SUM(order_total) as revenue
      FROM salla_orders
      WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code
    `).all(store, startDate, endDate);
  } else {
    ecommerceOrders = db.prepare(`
      SELECT country_code as country, COUNT(*) as orders, SUM(subtotal) as revenue
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL AND country_code != ''
      GROUP BY country_code
    `).all(store, startDate, endDate);
  }

  const manualOrders = db.prepare(`
    SELECT country as country, SUM(orders_count) as orders, SUM(revenue) as revenue
    FROM manual_orders
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY country
  `).all(store, startDate, endDate);

  const countryMap = new Map();
  const addToCountry = (code, data) => {
    if (!code) return;
    if (!countryMap.has(code)) {
      countryMap.set(code, { country: code, spend: 0, purchases: 0, revenue: 0, orders: 0 });
    }
    const existing = countryMap.get(code);
    existing.spend += data.spend || 0;
    existing.purchases += data.purchases || 0;
    existing.revenue += data.revenue || 0;
    existing.orders += data.orders || 0;
  };

  metaByCountry.forEach(row => addToCountry(row.country, {
    spend: row.spend,
    purchases: row.conversions,
    revenue: row.revenue
  }));
  ecommerceOrders.forEach(row => addToCountry(row.country, {
    orders: row.orders,
    revenue: row.revenue
  }));
  manualOrders.forEach(row => addToCountry(row.country, {
    orders: row.orders,
    revenue: row.revenue
  }));

  const availableCountries = getAvailableCountries(store);
  const countryMetadata = new Map(availableCountries.map(c => [c.code, c]));

  const countryStats = Array.from(countryMap.values()).map(row => {
    const meta = countryMetadata.get(row.country) || { name: row.country, flag: '🏳️' };
    const effectiveN = Math.max(1, row.purchases || row.orders || 1);
    const observedCAC = row.purchases > 0 ? safeDivide(row.spend, row.purchases) : (row.orders > 0 ? safeDivide(row.spend, row.orders) : null);
    const observedROAS = safeDivide(row.revenue, row.spend) || null;
    const posteriorCAC = computePosterior(priorMeanCAC, 8, observedCAC, effectiveN);
    const posteriorROAS = computePosterior(priorMeanROAS, 8, observedROAS, effectiveN);
    const dailySpend = row.spend / days;
    const aov = row.purchases > 0 ? safeDivide(row.revenue, row.purchases) : null;

    return {
      ...meta,
      country: row.country,
      spend: row.spend,
      purchases: row.purchases,
      orders: row.orders,
      revenue: row.revenue,
      aov,
      dailySpend,
      observedCAC,
      observedROAS,
      posteriorCAC,
      posteriorROAS,
      effectiveN
    };
  });

  const comparableDailySpends = countryStats
    .map(c => c.dailySpend)
    .filter(v => v && v > 0);

  const targetPurchasesRange = { min: 8, max: 15 };
  const testDays = 4;
  const minDailySar = 20;
  const maxDailySar = 300;

  const startPlans = countryStats.map(c => {
    const targetPurchases = (targetPurchasesRange.min + targetPurchasesRange.max) / 2;
    const recommendedTotal = c.posteriorCAC * targetPurchases;
    let recommendedDaily = recommendedTotal / testDays;

    // Clamp vs comparable geos
    if (comparableDailySpends.length > 0) {
      let nearest = comparableDailySpends[0];
      let minDiff = Math.abs(recommendedDaily - nearest);
      for (const val of comparableDailySpends) {
        const diff = Math.abs(recommendedDaily - val);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = val;
        }
      }
      recommendedDaily = Math.min(recommendedDaily, nearest * 1.3);
      recommendedDaily = Math.max(recommendedDaily, nearest * 0.7);
    }

    const minDaily = sarToCurrency(minDailySar, brandDefaults.currency);
    const maxDaily = sarToCurrency(maxDailySar, brandDefaults.currency);
    recommendedDaily = Math.min(Math.max(recommendedDaily, minDaily), maxDaily);

    const expectedPurchases = recommendedDaily * testDays / Math.max(c.posteriorCAC || priorMeanCAC, 1);
    const expectedRange = {
      low: Math.max(targetPurchasesRange.min * 0.8, expectedPurchases * 0.8),
      high: Math.min(targetPurchasesRange.max * 1.2, expectedPurchases * 1.2)
    };

    const sigmaRoas = Math.max(0.15, 1 / Math.sqrt(c.effectiveN)) * c.posteriorROAS;
    const confidenceBand = {
      low: c.posteriorROAS - sigmaRoas,
      high: c.posteriorROAS + sigmaRoas
    };

    return {
      country: c.country,
      name: c.name,
      flag: c.flag,
      recommendedDaily,
      recommendedTotal,
      testDays,
      posteriorCAC: c.posteriorCAC,
      posteriorROAS: c.posteriorROAS,
      expectedPurchases: expectedPurchases,
      expectedRange,
      confidence: confidenceLabel(c.effectiveN),
      confidenceBand,
      rationale: c.purchases > 0 || c.orders > 0 ? 'Blended prior + observed performance' : 'Using brand priors only',
      effectiveN: c.effectiveN,
      observedCAC: c.observedCAC,
      observedROAS: c.observedROAS
    };
  });

  // Live guidance table
  const targetCAC = medianBrandCac;
  const minimalSpendSar = 40;
  const minimalSpend = sarToCurrency(minimalSpendSar, brandDefaults.currency);

  const liveGuidance = campaignRows.map(row => {
    const effectiveN = Math.max(1, row.conversions || 0);
    const observedCAC = row.conversions > 0 ? safeDivide(row.spend, row.conversions) : null;
    const observedROAS = safeDivide(row.revenue, row.spend) || null;
    const posteriorCAC = computePosterior(priorMeanCAC, 8, observedCAC, effectiveN);
    const posteriorROAS = computePosterior(priorMeanROAS, 8, observedROAS, effectiveN);

    const sigmaRoas = Math.max(0.15, 1 / Math.sqrt(effectiveN)) * posteriorROAS;
    const sigmaCac = Math.max(0.15, 1 / Math.sqrt(effectiveN)) * posteriorCAC;

    const probRoas = probabilityAboveThreshold(posteriorROAS, sigmaRoas, brandDefaults.targetROAS, 'above');
    const probCac = probabilityAboveThreshold(posteriorCAC, sigmaCac, targetCAC, 'below');

    let action = 'Hold';
    let reason = 'Steady with mixed signals';

    if (row.spend < minimalSpend || effectiveN < 2) {
      action = 'Insufficient Data';
      reason = 'Not enough spend or purchases yet';
    } else if (probRoas >= 0.7 || probCac >= 0.7) {
      action = 'Scale';
      reason = 'High probability of beating targets';
    } else if (probRoas <= 0.3 && probCac <= 0.3) {
      action = 'Cut';
      reason = 'Low probability of meeting targets';
    }

    return {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      country: row.country,
      spend: row.spend,
      purchases: row.conversions,
      revenue: row.revenue,
      aov: row.conversions > 0 ? row.revenue / row.conversions : null,
      cac: observedCAC,
      roas: observedROAS,
      posteriorCAC,
      posteriorROAS,
      sigmaRoas,
      sigmaCac,
      probRoas,
      probCac,
      action,
      reason,
      effectiveN
    };
  });

  // Learning map scoring
  const learningMap = {
    highPriority: [],
    noisy: [],
    poorFit: [],
    lowSignal: []
  };

  countryStats.forEach(c => {
    if (c.effectiveN < 2) {
      learningMap.lowSignal.push(c);
      return;
    }

    const roasScore = c.posteriorROAS / (priorMeanROAS || 1);
    const cacScore = (priorMeanCAC || 1) / (c.posteriorCAC || priorMeanCAC || 1);
    const signalStrengthBonus = Math.min(0.8, Math.log10(c.effectiveN + 1));
    const score = roasScore + cacScore - 1 + signalStrengthBonus;

    if (score >= 1) learningMap.highPriority.push(c);
    else if (score >= 0.2) learningMap.noisy.push(c);
    else if (score <= -0.2) learningMap.poorFit.push(c);
    else learningMap.lowSignal.push(c);
  });

  return {
    store,
    currency: brandDefaults.currency,
    availableCountries,
    priors: {
      meanCAC: priorMeanCAC,
      meanROAS: priorMeanROAS,
      priorWeight: 8,
      targetROAS: brandDefaults.targetROAS,
      targetCAC,
      medianBrandCac,
      baselineSpend: priorSpend,
      baselinePurchases: priorConversions
    },
    planningDefaults: {
      targetPurchasesRange,
      testDays,
      minDaily: sarToCurrency(minDailySar, brandDefaults.currency),
      maxDaily: sarToCurrency(maxDailySar, brandDefaults.currency),
      comparableDailySpends
    },
    startPlans,
    liveGuidance,
    learningMap,
    period: { startDate, endDate, days },
    priorRange
  };
}

export default getBudgetIntelligence;
