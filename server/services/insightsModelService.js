import fetch from 'node-fetch';
import { getDb } from '../db/database.js';

const MODEL_TIMEOUT_MS = parseInt(process.env.INSIGHTS_MODEL_TIMEOUT_MS || '6000', 10);

const SEGMENT_AGES = {
  'Gift Buyers': ['45-54', '55-64', '65+'],
  'Premium Seekers': ['35-44'],
  'Core Buyers': ['25-34'],
  'Trend Hunters': ['18-24']
};

const STOPWORDS = new Set([
  'ad', 'ads', 'adset', 'campaign', 'creative', 'test', 'video', 'image', 'copy',
  'new', 'promo', 'offer', 'sale', 'arabic', 'english', 'v1', 'v2', 'v3',
  'v4', 'v5', 'version', 'static', 'carousel', 'story', 'feed', 'reel'
]);

const getServiceUrl = (envKey) => {
  const value = process.env[envKey];
  return value && value.trim().length > 0 ? value.trim() : null;
};

const normalizeInsight = (payload) => {
  if (!payload) return null;
  if (payload.insight && typeof payload.insight === 'object') return payload.insight;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  if (typeof payload === 'object') return payload;
  return null;
};

const applyMethodMeta = (insight, requested, fallbackUsed, fallbackWarnings = []) => {
  if (!insight || typeof insight !== 'object') return insight;
  const next = { ...insight };
  if (!next.method_requested) next.method_requested = requested;
  if (!next.method_used && fallbackUsed) next.method_used = fallbackUsed;
  if (fallbackWarnings.length) {
    next.warnings = [...(next.warnings || []), ...fallbackWarnings];
  }
  return next;
};


const postJson = async (url, body) => {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text}`.trim());
    }

    const data = await res.json();
    return data;
  } catch (error) {
    console.warn(`[InsightsModel] ${url} failed:`, error?.message || error);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const safeRate = (num, den) => (den > 0 ? num / den : 0);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const tokenize = (value) => {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
};

const cosineSimilarity = (a, b) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const buildDailySeries = (rows, startDate, endDate) => {
  const byDate = new Map();
  rows.forEach((row) => {
    byDate.set(row.date, row.conversions || 0);
  });

  const series = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    series.push({ date: key, value: byDate.get(key) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return series;
};

const linearSlope = (values) => {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (!denom) return 0;
  return (n * sumXY - sumX * sumY) / denom;
};

const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

const getOrdersTable = (store) => (store === 'vironax' ? 'salla_orders' : 'shopify_orders');

async function localPersonaInsight({ store, topGeo, topSegment, recentStart, endDate }) {
  const db = getDb();
  const ages = SEGMENT_AGES[topSegment] || [];

  const rows = db.prepare(`
    SELECT age, country, ad_name,
           SUM(impressions) as impressions,
           SUM(clicks) as clicks,
           SUM(conversions) as conversions
    FROM meta_ad_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
      AND age != '' AND country != 'ALL'
    GROUP BY age, country, ad_name
  `).all(store, recentStart, endDate);

  if (!rows.length) return null;

  const overallClicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const overallImpressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
  const overallCtr = safeRate(overallClicks, overallImpressions);

  const segmentRows = rows.filter((row) => (ages.length ? ages.includes(row.age) : true) && row.country === topGeo);
  if (!segmentRows.length) return null;

  const segmentClicks = segmentRows.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const segmentImpressions = segmentRows.reduce((sum, row) => sum + (row.impressions || 0), 0);
  const segmentCtr = safeRate(segmentClicks, segmentImpressions);
  const segmentConversions = segmentRows.reduce((sum, row) => sum + (row.conversions || 0), 0);

  const adDocs = new Map();
  const tokenCounts = new Map();
  let docCount = 0;
  rows.forEach((row) => {
    const tokens = tokenize(row.ad_name);
    if (!tokens.length) return;
    docCount += 1;
    const uniqueTokens = new Set(tokens);
    uniqueTokens.forEach((token) => {
      adDocs.set(token, (adDocs.get(token) || 0) + 1);
    });
  });

  segmentRows.forEach((row) => {
    const tokens = tokenize(row.ad_name);
    if (!tokens.length) return;
    const weight = (row.conversions || 0) * 2 + (row.clicks || 0);
    tokens.forEach((token) => {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + weight);
    });
  });

  let topToken = null;
  let topScore = 0;
  tokenCounts.forEach((tf, token) => {
    const df = adDocs.get(token) || 1;
    const idf = Math.log((docCount + 1) / (df + 1)) + 1;
    const score = tf * idf;
    if (score > topScore) {
      topScore = score;
      topToken = token;
    }
  });

  const cue = topToken ? `"${topToken}"` : 'premium cues';
  const lift = overallCtr > 0 ? ((segmentCtr - overallCtr) / overallCtr) * 100 : 0;
  const confidence = clamp(0.5 + Math.min(0.35, Math.log10(segmentConversions + 1) / 6), 0.45, 0.88);

  return {
    title: `${topSegment} respond to ${topToken ? topToken : 'premium'} creatives in ${topGeo}`,
    finding: `CTR for ${topSegment} in ${topGeo} is ${(segmentCtr * 100).toFixed(1)}% vs ${(overallCtr * 100).toFixed(1)}% baseline (${lift.toFixed(1)}% lift).`,
    why: `Top-performing ads for this segment mention ${cue} more than other creatives.`,
    action: `Emphasize ${cue} visual cues in ${topGeo} ads targeting ${topSegment}.`,
    confidence,
    signals: ['Meta ad-level CTR', 'Age + geo segment lift', 'Creative keyword extraction'],
    models: [
      { name: 'Segment Uplift Ranker', description: 'Ranks segment performance by CTR lift vs baseline.' },
      { name: 'TF-IDF Creative Cue Extractor', description: 'Finds keywords tied to higher conversion density.' }
    ],
    logic: `Segment CTR uplift of ${lift.toFixed(1)}% indicates creative resonance for ${topSegment} in ${topGeo}.`,
    limits: 'Accuracy depends on stable ad naming conventions and sufficient segment volume.'
  };
}

async function localGeoInsight({ topGeo, radarPoints }) {
  if (!Array.isArray(radarPoints) || radarPoints.length < 2) return null;

  const points = radarPoints.map((point) => ({
    ...point,
    demand: point.demand || 0,
    competition: point.competition || 0,
    marketSize: point.marketSize || 0,
    readiness: point.readiness || 0
  }));

  const max = (key) => Math.max(...points.map((point) => point[key]));
  const min = (key) => Math.min(...points.map((point) => point[key]));

  const normalize = (value, key) => {
    const minVal = min(key);
    const maxVal = max(key);
    if (maxVal === minVal) return 0.5;
    return (value - minVal) / (maxVal - minVal);
  };

  const scored = points.map((point) => {
    const demand = normalize(point.demand, 'demand');
    const competition = normalize(point.competition, 'competition');
    const marketSize = normalize(point.marketSize, 'marketSize');
    const readiness = normalize(point.readiness, 'readiness');
    const score = demand * 0.45 + marketSize * 0.25 + readiness * 0.2 - competition * 0.3;
    return { ...point, score, vector: [demand, marketSize, readiness, 1 - competition] };
  });

  scored.sort((a, b) => b.score - a.score);
  let candidate = scored[0];
  if (candidate.geo === topGeo && scored.length > 1) {
    candidate = scored[1];
  }

  const anchor = scored.find((point) => point.geo === topGeo) || scored[0];
  const similarity = cosineSimilarity(candidate.vector, anchor.vector);
  const confidence = clamp(0.55 + (candidate.score - scored[scored.length - 1].score) * 0.4, 0.45, 0.86);

  return {
    title: `${candidate.geo} shows the strongest opportunity signal`,
    finding: `Demand ${candidate.demand}/100 with competition ${candidate.competition}/100; similarity to ${anchor.geo} is ${(similarity * 100).toFixed(0)}%.`,
    why: `Weighted opportunity score favors ${candidate.geo} due to demand and readiness headroom.`,
    action: `Start a 14-day geo test in ${candidate.geo} with localized creatives.`,
    confidence,
    signals: ['Geo demand score', 'Competition density', 'Readiness index'],
    models: [
      { name: 'Geo Opportunity Scorer', description: 'Weighted linear model on demand, size, readiness, competition.' },
      { name: 'Cosine Similarity Match', description: 'Compares candidate geos to top-performing market.' }
    ],
    logic: `Opportunity score ranking places ${candidate.geo} above peers with similar demand but lower competition.`,
    limits: 'Scores depend on recent spend patterns and do not include external market data yet.'
  };
}

async function localAdjacentInsight({ store, adjacentSuggestion, recentStart, endDate }) {
  const db = getDb();
  const table = getOrdersTable(store);

  const rows = db.prepare(`
    SELECT
      SUM(CASE WHEN items_count >= 2 THEN 1 ELSE 0 END) as multi_orders,
      COUNT(*) as total_orders,
      AVG(items_count) as avg_items
    FROM ${table}
    WHERE store = ? AND date BETWEEN ? AND ?
  `).get(store, recentStart, endDate);

  if (!rows || !rows.total_orders) return null;

  const multiRate = safeRate(rows.multi_orders || 0, rows.total_orders || 1);
  const avgItems = rows.avg_items || 1;
  const confidence = clamp(0.5 + Math.min(0.3, multiRate), 0.45, 0.82);

  const bundleSignal = multiRate >= 0.22 || avgItems >= 1.25;
  const bundleText = bundleSignal ? 'Multi-item orders are rising' : 'Single-item orders still dominate';

  return {
    title: bundleSignal ? `${adjacentSuggestion} is a strong bundle candidate` : `${adjacentSuggestion} is worth a light test`,
    finding: `${bundleText}. Multi-item rate is ${(multiRate * 100).toFixed(1)}% with ${avgItems.toFixed(2)} items/order.`,
    why: 'Order composition indicates whether bundle offers will lift AOV.',
    action: bundleSignal
      ? `Launch a 2-piece ${adjacentSuggestion} bundle and test premium packaging.`
      : `Test ${adjacentSuggestion} as a limited bundle before expanding inventory.`,
    confidence,
    signals: ['Order item counts', 'Bundle take-rate'],
    models: [
      { name: 'Bundle Propensity Score', description: 'Scores likelihood of bundle adoption from order mix.' }
    ],
    logic: `Higher multi-item share suggests stronger bundle elasticity.`,
    limits: 'Does not yet include external marketplace demand signals.'
  };
}

async function localPeaksInsight({ store, trendDirection, recentStart, endDate }) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, SUM(conversions) as conversions
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date
  `).all(store, recentStart, endDate);

  if (!rows.length) return null;

  const series = buildDailySeries(rows, recentStart, endDate);
  const values = series.map((point) => point.value || 0);
  const recentWindow = values.slice(-7);
  const recentAvg = avg(recentWindow);
  const slope = linearSlope(values.slice(-14));

  const forecast = [];
  const lastValue = values[values.length - 1] || 0;
  for (let i = 1; i <= 21; i += 1) {
    forecast.push({
      day: i,
      value: Math.max(0, lastValue + slope * i)
    });
  }
  const peak = forecast.reduce((max, point) => (point.value > max.value ? point : max), forecast[0]);
  const uplift = recentAvg > 0 ? (peak.value - recentAvg) / recentAvg : 0;
  const confidence = clamp(0.5 + Math.min(0.3, Math.abs(slope) / 5), 0.45, 0.8);

  const title = trendDirection === 'up' || uplift > 0.08
    ? `Peak window expected in ${peak.day} days`
    : 'Softening demand window detected';

  return {
    title,
    finding: `Forecast suggests ${(uplift * 100).toFixed(0)}% change vs last 7-day average; trend slope is ${slope.toFixed(2)} conv/day.`,
    why: 'Recent conversion trend indicates a shift relative to baseline momentum.',
    action: trendDirection === 'up' || uplift > 0.08
      ? 'Increase inventory buffer and ramp creatives 7-10 days ahead.'
      : 'Protect margin and tighten spend on weaker segments.',
    confidence,
    signals: ['Daily conversions', 'Short-term trend slope'],
    models: [
      { name: 'Holt Trend Filter', description: 'Linear trend extrapolation on recent conversions.' }
    ],
    logic: `Positive slope and forecasted uplift point to a short-term peak window.`,
    limits: 'Short history or volatile spend can reduce forecast stability.'
  };
}

export async function fetchPersonaInsight({
  store,
  topGeo,
  topSegment,
  heatmap,
  recentStart,
  endDate,
  baseCard,
  assets = [],
  history = [],
  method
}) {
  const requested = method || 'auto';
  const url = getServiceUrl('INSIGHTS_CREATIVE_EMBED_SERVICE_URL');
  if (url) {
    const payload = {
      store,
      window: { start: recentStart, end: endDate },
      topGeo,
      topSegment,
      heatmap,
      assets,
      history,
      base: baseCard,
      method: requested
    };
    const response = await postJson(url, payload);
    const normalized = normalizeInsight(response);
    if (normalized) return applyMethodMeta(normalized, requested);
  }
  try {
    const fallbackWarnings = [];
    if (requested === 'deepsurv') {
      fallbackWarnings.push('DeepSurv unavailable in fallback; using heuristic.');
    }
    const local = await localPersonaInsight({ store, topGeo, topSegment, recentStart, endDate });
    return applyMethodMeta(local, requested, 'heuristic', fallbackWarnings);
  } catch (error) {
    console.warn('[InsightsModel] local persona failed:', error?.message || error);
    return null;
  }
}


export async function fetchGeoInsight({
  store,
  topGeo,
  geos = [],
  radarPoints,
  recentStart,
  endDate,
  baseCard,
  method
}) {
  const requested = method || 'auto';
  const url = getServiceUrl('INSIGHTS_GEO_SIM_SERVICE_URL');
  if (url) {
    const payload = {
      store,
      window: { start: recentStart, end: endDate },
      topGeo,
      geos,
      radarPoints,
      base: baseCard,
      method: requested
    };
    const response = await postJson(url, payload);
    const normalized = normalizeInsight(response);
    if (normalized) return applyMethodMeta(normalized, requested);
  }
  try {
    const fallbackWarnings = [];
    if (['tabpfn', 'tabpfn+siamese', 'siamese'].includes(requested)) {
      fallbackWarnings.push('Requested model unavailable in fallback; using opportunity scorer.');
    }
    const local = await localGeoInsight({ store, topGeo, radarPoints, recentStart, endDate });
    return applyMethodMeta(local, requested, 'scorer', fallbackWarnings);
  } catch (error) {
    console.warn('[InsightsModel] local geo failed:', error?.message || error);
    return null;
  }
}


export async function fetchAdjacentInsight({
  store,
  topGeo,
  topSegment,
  adjacentSuggestion,
  recentStart,
  endDate,
  baseCard,
  orders = [],
  edges = [],
  transitions = [],
  sessionCount = 0,
  method
}) {
  const requested = method || 'auto';
  const url = getServiceUrl('INSIGHTS_ADJACENT_SERVICE_URL');
  if (url) {
    const payload = {
      store,
      window: { start: recentStart, end: endDate },
      topGeo,
      topSegment,
      seed: adjacentSuggestion,
      orders,
      edges,
      transitions,
      session_count: sessionCount,
      base: baseCard,
      method: requested
    };
    const response = await postJson(url, payload);
    const normalized = normalizeInsight(response);
    if (normalized) return applyMethodMeta(normalized, requested);
  }
  try {
    const fallbackWarnings = [];
    if (['graphsage', 'sasrec'].includes(requested)) {
      fallbackWarnings.push('Requested model unavailable in fallback; using co-purchase lift.');
    }
    const local = await localAdjacentInsight({ store, adjacentSuggestion, recentStart, endDate });
    return applyMethodMeta(local, requested, 'copurchase', fallbackWarnings);
  } catch (error) {
    console.warn('[InsightsModel] local adjacent failed:', error?.message || error);
    return null;
  }
}


export async function fetchPeaksInsight({
  store,
  trendDirection,
  recentStart,
  endDate,
  baseCard,
  series = [],
  method
}) {
  const requested = method || 'auto';
  const url = getServiceUrl('INSIGHTS_FORECAST_SERVICE_URL');
  if (url) {
    const payload = {
      store,
      window: { start: recentStart, end: endDate },
      trendDirection,
      series,
      base: baseCard,
      method: requested
    };
    const response = await postJson(url, payload);
    const normalized = normalizeInsight(response);
    if (normalized) return applyMethodMeta(normalized, requested);
  }
  try {
    const fallbackWarnings = [];
    if (requested === 'chronos') {
      fallbackWarnings.push('Chronos unavailable in fallback; using linear trend.');
    }
    const local = await localPeaksInsight({ store, trendDirection, recentStart, endDate });
    return applyMethodMeta(local, requested, 'linear', fallbackWarnings);
  } catch (error) {
    console.warn('[InsightsModel] local peaks failed:', error?.message || error);
    return null;
  }
}

