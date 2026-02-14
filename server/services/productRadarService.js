import crypto from 'crypto';
import fetch from 'node-fetch';
import { searchByBrand as searchMetaAds } from './apifyService.js';
import {
  analyzeProductRadarTimeseries,
  isProductRadarAiConfigured,
  rankProductRadarCandidates
} from './productRadarAiClient.js';

const GOOGLE_TRENDS_API = 'https://trends.google.com/trends/api';
const GOOGLE_TRENDS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const TRENDS_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const TRENDS_CACHE_MAX = 400;
const TRENDS_MAX_COMPARISON_ITEMS = 5; // Google Trends comparisonItem limit (empirically 5)
const TRENDS_MIN_DELAY_MS = 450; // pacing to reduce 429s
const DEFAULT_TIMEFRAME_DAYS = 90;
const DEFAULT_RECENT_WINDOW_POINTS = 14;
const DEFAULT_MAX_CANDIDATES = 12;
const DEFAULT_MAX_META_CHECKS = 6;
const DEFAULT_META_COUNTRY = 'ALL';
const DEFAULT_META_LIMIT = 25;
const DEFAULT_USE_AI_MODELS = process.env.PRODUCT_RADAR_USE_AI_MODELS !== '0';
const DEFAULT_FORECAST_HORIZON_POINTS = 14;
const EPS = 1e-6;

const cache = new Map();
const trendsCache = new Map();

let trendsQueue = Promise.resolve();
let trendsLastAt = 0;
let trendsBlockedUntil = 0;

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scheduleTrendsRequest(fn) {
  trendsQueue = trendsQueue
    .catch(() => {})
    .then(async () => {
      const now = Date.now();
      if (trendsBlockedUntil > now) {
        const err = new Error('Google Trends temporarily rate-limited');
        err.status = 429;
        err.retryAfterMs = trendsBlockedUntil - now;
        throw err;
      }

      const wait = Math.max(0, TRENDS_MIN_DELAY_MS - (now - trendsLastAt));
      if (wait) await sleep(wait);
      trendsLastAt = Date.now();
      return fn();
    });

  return trendsQueue;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const val of values) {
    const num = Number(val);
    if (Number.isFinite(num)) {
      sum += num;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function splitWindows(values, windowSize) {
  const w = Math.max(1, Math.floor(windowSize));
  const recent = values.slice(-w);
  const prev = values.slice(Math.max(0, values.length - 2 * w), Math.max(0, values.length - w));
  return { recent, prev };
}

function percentChange(recentMean, prevMean) {
  if (!Number.isFinite(recentMean) || !Number.isFinite(prevMean)) return 0;
  return ((recentMean - prevMean) / Math.max(EPS, prevMean)) * 100;
}

function log2Safe(value) {
  return Math.log(Math.max(EPS, value)) / Math.log(2);
}

function demandScoreFromRatio(ratio) {
  // Ratio is candidate / seed. 1.0 => ~50. 2x => ~65. 4x => ~80. 8x => ~95
  const score = 50 + 15 * log2Safe(ratio);
  return Math.round(clamp(0, score, 100));
}

function momentumScoreFromPercentChange(pct) {
  // 0% => 50, +50% => ~84, +100% => ~93, -50% => ~16
  const score = 50 + 45 * Math.tanh(pct / 50);
  return Math.round(clamp(0, score, 100));
}

function confidenceFromSeries(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const nonZero = values.filter((v) => Number(v) > 0).length;
  const coverage = nonZero / values.length;
  const lengthFactor = clamp(0.4, values.length / 30, 1);
  const score = coverage * 100 * lengthFactor;
  return Math.round(clamp(5, score, 95));
}

function geoSpreadScoreFromCountries(countries) {
  const values = (countries || [])
    .map((c) => Number(c?.value))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (values.length === 0) return 0;
  if (values.length === 1) return 15;

  const sum = values.reduce((acc, v) => acc + v, 0);
  if (!Number.isFinite(sum) || sum <= 0) return 0;

  const probs = values.map((v) => v / sum);
  const entropy = -probs.reduce((acc, p) => acc + p * Math.log(Math.max(EPS, p)), 0);
  const maxEntropy = Math.log(values.length);
  const normalized = maxEntropy > 0 ? entropy / maxEntropy : 0;

  return Math.round(clamp(0, normalized * 100, 100));
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const val = String(raw || '').trim();
    if (!val) continue;
    const key = val.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(val);
  }
  return out;
}

function normalizeCandidate(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function shouldKeepCandidate(candidate) {
  if (!candidate) return false;
  if (candidate.length < 3) return false;
  if (candidate.length > 64) return false;
  // Avoid ultra-generic navigational noise.
  if (/^(amazon|noon|tiktok|facebook|meta|walmart|etsy|aliexpress|alibaba)$/i.test(candidate)) return false;
  return true;
}

function buildGoogleTrendsExploreUrl(keyword, { geo = '', timeframeDays = DEFAULT_TIMEFRAME_DAYS } = {}) {
  const date =
    timeframeDays >= 365 ? 'today 12-m' :
    timeframeDays >= 180 ? 'today 6-m' :
    'today 3-m';

  const params = new URLSearchParams();
  params.set('q', keyword);
  if (geo) params.set('geo', geo);
  params.set('date', date);
  return `https://trends.google.com/trends/explore?${params.toString()}`;
}

function buildMetaAdLibraryUrl(keyword, { country = DEFAULT_META_COUNTRY } = {}) {
  const params = new URLSearchParams();
  params.set('active_status', 'active');
  params.set('ad_type', 'all');
  params.set('country', country);
  params.set('q', keyword);
  params.set('search_type', 'keyword_unordered');
  params.set('media_type', 'all');
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

function stripXssi(text) {
  // Google Trends prefixes JSON with an XSSI guard: ")]}'\n"
  return String(text || '').replace(/^\)\]\}',?\n?/, '');
}

async function fetchTrendsJson(url) {
  const now = Date.now();
  const cached = trendsCache.get(url);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await scheduleTrendsRequest(async () => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': GOOGLE_TRENDS_UA,
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Google Trends HTTP ${res.status}`);
      err.status = res.status;
      err.body = body?.slice?.(0, 2000) || '';
      if (res.status === 429) {
        trendsBlockedUntil = Date.now() + 10 * 60 * 1000;
      }
      throw err;
    }

    const text = await res.text();
    return JSON.parse(stripXssi(text));
  });

  trendsCache.set(url, { expiresAt: now + TRENDS_CACHE_TTL_MS, value });
  while (trendsCache.size > TRENDS_CACHE_MAX) {
    const firstKey = trendsCache.keys().next().value;
    if (!firstKey) break;
    trendsCache.delete(firstKey);
  }

  return value;
}

function toDateString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function toTimeRange(startTime, endTime) {
  return `${toDateString(startTime)} ${toDateString(endTime)}`;
}

async function withRetry(fn, { attempts = 2, delayMs = 700 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error?.status === 429) {
        throw error;
      }
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

async function trendsExplore({ comparisonItem, hl = 'en-US', tz = 0 }) {
  const reqObj = {
    comparisonItem,
    category: 0,
    property: ''
  };

  const url = `${GOOGLE_TRENDS_API}/explore?hl=${encodeURIComponent(hl)}&tz=${tz}&req=${encodeURIComponent(
    JSON.stringify(reqObj)
  )}`;

  return fetchTrendsJson(url);
}

function pickWidget(explore, type) {
  const widgets = explore?.widgets || [];
  return widgets.find((w) => w?.type === type) || null;
}

async function getRelatedQueryCandidates(seedQuery, { geo, startTime, endTime, hl }) {
  const time = toTimeRange(startTime, endTime);

  const explore = await withRetry(() =>
    trendsExplore({
      comparisonItem: [{ keyword: seedQuery, geo, time }],
      hl,
      tz: 0
    })
  );

  const widget = pickWidget(explore, 'RELATED_QUERIES');
  if (!widget?.token || !widget?.request) return [];

  const url = `${GOOGLE_TRENDS_API}/widgetdata/relatedsearches?hl=${encodeURIComponent(hl)}&tz=0&req=${encodeURIComponent(
    JSON.stringify(widget.request)
  )}&token=${encodeURIComponent(widget.token)}`;

  const data = await withRetry(() => fetchTrendsJson(url));

  const rankedList = data?.default?.rankedList || [];
  const extract = (rankedEntry) =>
    (rankedEntry?.rankedKeyword || [])
      .map((kw) => normalizeCandidate(kw?.query))
      .filter(shouldKeepCandidate);

  const top = rankedList[0] ? extract(rankedList[0]) : [];
  const rising = rankedList[1] ? extract(rankedList[1]) : [];

  return uniqueStrings([...top, ...rising]);
}

async function getRelatedTopicCandidates(seedQuery, { geo, startTime, endTime, hl }) {
  const time = toTimeRange(startTime, endTime);

  const explore = await withRetry(() =>
    trendsExplore({
      comparisonItem: [{ keyword: seedQuery, geo, time }],
      hl,
      tz: 0
    })
  );

  const widget = pickWidget(explore, 'RELATED_TOPICS');
  if (!widget?.token || !widget?.request) return [];

  const url = `${GOOGLE_TRENDS_API}/widgetdata/relatedsearches?hl=${encodeURIComponent(hl)}&tz=0&req=${encodeURIComponent(
    JSON.stringify(widget.request)
  )}&token=${encodeURIComponent(widget.token)}`;

  const data = await withRetry(() => fetchTrendsJson(url));

  const rankedList = data?.default?.rankedList || [];
  const extract = (rankedEntry) =>
    (rankedEntry?.rankedKeyword || [])
      .map((kw) => normalizeCandidate(kw?.topic?.title || kw?.query))
      .filter(shouldKeepCandidate);

  const top = rankedList[0] ? extract(rankedList[0]) : [];
  const rising = rankedList[1] ? extract(rankedList[1]) : [];

  return uniqueStrings([...top, ...rising]);
}

async function getGoogleSuggestCandidates(seedQuery, { hl = 'en-US' } = {}) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${encodeURIComponent(hl)}&q=${encodeURIComponent(
    seedQuery
  )}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': GOOGLE_TRENDS_UA,
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  if (!res.ok) return [];

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  const suggestions = Array.isArray(data?.[1]) ? data[1] : [];
  return uniqueStrings(suggestions.map((s) => normalizeCandidate(s)).filter(shouldKeepCandidate));
}

async function getInterestPairSeries(seedQuery, candidateQuery, { geo, startTime, endTime, hl }) {
  const time = toTimeRange(startTime, endTime);

  const explore = await withRetry(() =>
    trendsExplore({
      comparisonItem: [
        { keyword: seedQuery, geo, time },
        { keyword: candidateQuery, geo, time }
      ],
      hl,
      tz: 0
    })
  );

  const widget = pickWidget(explore, 'TIMESERIES');
  if (!widget?.token || !widget?.request) return [];

  const url = `${GOOGLE_TRENDS_API}/widgetdata/multiline?hl=${encodeURIComponent(hl)}&tz=0&req=${encodeURIComponent(
    JSON.stringify(widget.request)
  )}&token=${encodeURIComponent(widget.token)}`;

  const data = await withRetry(() => fetchTrendsJson(url));
  const timeline = data?.default?.timelineData || [];

  return timeline
    .map((entry) => {
      const values = Array.isArray(entry?.value) ? entry.value : [];
      return {
        time: entry?.time ? Number(entry.time) * 1000 : null,
        formattedTime: entry?.formattedTime || '',
        seed: Number(values[0] ?? 0),
        candidate: Number(values[1] ?? 0)
      };
    })
    .filter((point) => point.time);
}

function chunk(values, size) {
  const out = [];
  const s = Math.max(1, Math.floor(size));
  for (let i = 0; i < (values || []).length; i += s) {
    out.push(values.slice(i, i + s));
  }
  return out;
}

async function getInterestMultiSeries(seedQuery, candidateQueries, { geo, startTime, endTime, hl }) {
  const candidates = (candidateQueries || []).filter(Boolean);
  if (!candidates.length) return new Map();

  const maxCandidatesPerReq = Math.max(1, TRENDS_MAX_COMPARISON_ITEMS - 1);
  const limited = candidates.slice(0, maxCandidatesPerReq);

  const time = toTimeRange(startTime, endTime);
  const explore = await withRetry(() =>
    trendsExplore({
      comparisonItem: [{ keyword: seedQuery, geo, time }, ...limited.map((keyword) => ({ keyword, geo, time }))],
      hl,
      tz: 0
    })
  );

  const widget = pickWidget(explore, 'TIMESERIES');
  if (!widget?.token || !widget?.request) return new Map();

  const url = `${GOOGLE_TRENDS_API}/widgetdata/multiline?hl=${encodeURIComponent(hl)}&tz=0&req=${encodeURIComponent(
    JSON.stringify(widget.request)
  )}&token=${encodeURIComponent(widget.token)}`;

  const data = await withRetry(() => fetchTrendsJson(url));
  const timeline = data?.default?.timelineData || [];

  const out = new Map();
  for (const c of limited) out.set(c, []);

  for (const entry of timeline) {
    const values = Array.isArray(entry?.value) ? entry.value : [];
    const timeMs = entry?.time ? Number(entry.time) * 1000 : null;
    if (!timeMs) continue;
    const seedVal = Number(values[0] ?? 0);

    for (let i = 0; i < limited.length; i += 1) {
      const candidate = limited[i];
      const candidateVal = Number(values[i + 1] ?? 0);
      out.get(candidate).push({
        time: timeMs,
        formattedTime: entry?.formattedTime || '',
        seed: seedVal,
        candidate: candidateVal
      });
    }
  }

  return out;
}

async function getInterestByCountry(keyword, { geo, startTime, endTime, hl }) {
  const time = toTimeRange(startTime, endTime);

  const explore = await withRetry(() =>
    trendsExplore({
      comparisonItem: [{ keyword, geo, time }],
      hl,
      tz: 0
    })
  );

  const widget = pickWidget(explore, 'GEO_MAP');
  if (!widget?.token || !widget?.request) return [];

  const request = {
    ...widget.request,
    resolution: 'COUNTRY'
  };

  const url = `${GOOGLE_TRENDS_API}/widgetdata/comparedgeo?hl=${encodeURIComponent(hl)}&tz=0&req=${encodeURIComponent(
    JSON.stringify(request)
  )}&token=${encodeURIComponent(widget.token)}`;

  const data = await withRetry(() => fetchTrendsJson(url));
  const rows = data?.default?.geoMapData || [];

  return rows
    .map((row) => ({
      geoCode: row?.geoCode || '',
      geoName: row?.geoName || '',
      value: Array.isArray(row?.value) ? Number(row.value[0] ?? 0) : Number(row?.value ?? 0)
    }))
    .filter((row) => row.geoCode && row.geoName)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 8);
}

function inferRiskHeuristics(keyword) {
  const k = String(keyword || '').toLowerCase();
  const drivers = [];

  const add = (rule) => drivers.push(rule);

  if (/(ring|shoe|sneaker|dress|shirt|pants|jeans|bra|lingerie|jacket|coat)/i.test(k)) {
    add('Sizing/fit returns risk');
  }
  if (/(supplement|vitamin|pill|capsule|powder|protein|weight loss|slimming)/i.test(k)) {
    add('Regulated/claims risk');
  }
  if (/(skincare|serum|cream|lotion|cosmetic|makeup|hair)/i.test(k)) {
    add('Allergy/claims risk');
  }
  if (/(battery|lithium|charger|electronics|earbuds|headphones|phone|smart)/i.test(k)) {
    add('Battery/electronics shipping risk');
  }
  if (/(kids|baby|toddler|toy)/i.test(k)) {
    add('Child safety compliance risk');
  }
  if (/(glass|ceramic|fragile|crystal)/i.test(k)) {
    add('Fragile shipping risk');
  }

  // Score is intentionally conservative. This is a heuristic, not a classifier.
  const base = 45;
  const score = base + Math.min(45, drivers.length * 12);
  return {
    score: Math.round(clamp(0, score, 100)),
    drivers
  };
}

function computeCompetitionScoreFromMetaSample({ sampleSize, limit, uniqueAdvertisers }) {
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) return 0;
  const hitLimit = sampleSize >= limit;
  const density = clamp(0, sampleSize / Math.max(1, limit), 1);
  const advertiserFactor = clamp(0, uniqueAdvertisers / 20, 1);
  const score = density * 70 + advertiserFactor * 30 + (hitLimit ? 10 : 0);
  return Math.round(clamp(0, score, 100));
}

function computeOverallScore({ demand, momentum, competition, risk, confidence }) {
  const parts = [];

  if (Number.isFinite(demand)) parts.push({ value: demand, weight: 0.45 });
  if (Number.isFinite(momentum)) parts.push({ value: momentum, weight: 0.25 });
  if (Number.isFinite(competition)) parts.push({ value: 100 - competition, weight: 0.2 });
  if (Number.isFinite(risk)) parts.push({ value: 100 - risk, weight: 0.1 });

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0) || 1;
  const base = parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight;
  const conf = Number.isFinite(confidence) ? clamp(0, confidence, 100) : 50;

  // Confidence dampens results when signals are sparse.
  const dampener = 0.7 + 0.3 * (conf / 100);
  return Math.round(clamp(0, base * dampener, 100));
}

async function gatherMetaAdLibraryEvidence(keyword, { country, limit }) {
  try {
    const result = await searchMetaAds('product-radar', keyword, {
      country,
      forceRefresh: false,
      limit
    });

    const ads = Array.isArray(result?.ads) ? result.ads : [];
    const uniqueAdvertisers = new Set(
      ads
        .map((ad) => String(ad?.page_name || ad?.pageName || '').trim())
        .filter(Boolean)
        .map((name) => name.toLowerCase())
    ).size;

    const sampleSize = ads.length;
    const competitionScore = computeCompetitionScoreFromMetaSample({
      sampleSize,
      limit,
      uniqueAdvertisers
    });

    return {
      available: true,
      configured: true,
      country,
      limit,
      sampleSize,
      uniqueAdvertisers,
      hitLimit: sampleSize >= limit,
      competitionScore,
      fromCache: !!result?.fromCache,
      cacheInfo: result?.cacheInfo || null,
      cost: result?.cost || null,
      url: buildMetaAdLibraryUrl(keyword, { country }),
      sample: ads.slice(0, 6).map((ad) => ({
        ad_id: ad?.ad_id || ad?.adId || null,
        page_name: ad?.page_name || ad?.pageName || null,
        ad_copy: ad?.ad_copy || ad?.adCopy || null,
        snapshot_url: ad?.snapshot_url || ad?.snapshotUrl || null,
        platforms: ad?.platforms || null,
        start_date: ad?.start_date || ad?.startDate || null
      }))
    };
  } catch (error) {
    const msg = error?.message || 'Meta Ad Library lookup failed';
    return {
      available: false,
      configured: true,
      country,
      limit,
      error: msg,
      url: buildMetaAdLibraryUrl(keyword, { country })
    };
  }
}

export async function runProductRadarScan(options) {
  const {
    query,
    geo = '',
    hl = 'en-US',
    timeframeDays = DEFAULT_TIMEFRAME_DAYS,
    maxCandidates = DEFAULT_MAX_CANDIDATES,
    maxMetaChecks = DEFAULT_MAX_META_CHECKS,
    includeMetaAds = true,
    metaCountry = DEFAULT_META_COUNTRY,
    metaLimit = DEFAULT_META_LIMIT,
    useAiModels = DEFAULT_USE_AI_MODELS,
    includeGeoSpread = true
  } = options || {};

  const seed = String(query || '').trim();
  if (!seed) {
    const err = new Error('Query is required');
    err.code = 'MISSING_QUERY';
    throw err;
  }

  const startTime = new Date(Date.now() - Math.max(1, timeframeDays) * 24 * 60 * 60 * 1000);
  const endTime = new Date();

  const cacheKey = JSON.stringify({
    seed,
    geo,
    hl,
    timeframeDays,
    maxCandidates,
    maxMetaChecks,
    includeMetaAds,
    metaCountry,
    metaLimit,
    useAiModels,
    includeGeoSpread
  });

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, cached: true };
  }

  const aiConfigured = isProductRadarAiConfigured();

  const sources = {
    googleTrends: { available: true, configured: true },
    metaAdLibrary: { available: true, configured: !!process.env.APIFY_API_TOKEN },
    aiModels: useAiModels
      ? {
          available: aiConfigured,
          configured: aiConfigured,
          reason: aiConfigured ? null : 'PRODUCT_RADAR_AI_URL not set'
        }
      : { available: false, configured: false, reason: 'useAiModels=false' }
  };

  // 1) Candidate generation (multi-source)
  let relatedQueries = [];
  let relatedTopics = [];
  let googleSuggest = [];

  try {
    relatedQueries = await getRelatedQueryCandidates(seed, { geo, startTime, endTime, hl });
  } catch (error) {
    console.warn('[ProductRadar] relatedQueries failed:', error?.message || error);
  }

  try {
    relatedTopics = await getRelatedTopicCandidates(seed, { geo, startTime, endTime, hl });
  } catch (error) {
    console.warn('[ProductRadar] relatedTopics failed:', error?.message || error);
  }

  try {
    googleSuggest = await getGoogleSuggestCandidates(seed, { hl });
  } catch (error) {
    console.warn('[ProductRadar] googleSuggest failed:', error?.message || error);
  }

  const candidateSourceCounts = {
    trendsRelatedQueries: relatedQueries.length,
    trendsRelatedTopics: relatedTopics.length,
    googleSuggest: googleSuggest.length
  };

  let candidates = uniqueStrings([...relatedQueries, ...relatedTopics, ...googleSuggest])
    .map(normalizeCandidate)
    .filter(shouldKeepCandidate)
    .filter((c) => c.toLowerCase() !== seed.toLowerCase());

  // 2) Hybrid semantic ranking + diversity (optional)
  const evaluationCount = clamp(6, Math.round(maxCandidates * 1.25), 24);
  const discoveryByKeyword = new Map();

  if (useAiModels && aiConfigured && candidates.length) {
    try {
      const ranked = await rankProductRadarCandidates({
        query: seed,
        candidates,
        maxSelected: evaluationCount,
        topN: 120,
        rerankN: 40,
        diversify: true
      });

      if (ranked?.success && Array.isArray(ranked.selected)) {
        candidates = ranked.selected
          .map((it) => String(it?.text || '').trim())
          .filter(Boolean)
          .slice(0, evaluationCount);

        for (const it of ranked.selected) {
          const key = String(it?.text || '').toLowerCase();
          if (key) discoveryByKeyword.set(key, it);
        }

        sources.aiModels = {
          ...sources.aiModels,
          available: true,
          configured: true,
          models: ranked.models || null
        };
      } else {
        candidates = candidates.slice(0, evaluationCount);
      }
    } catch (error) {
      sources.aiModels = {
        ...sources.aiModels,
        available: false,
        configured: true,
        reason: error?.message || 'AI ranking failed'
      };
      candidates = candidates.slice(0, evaluationCount);
    }
  } else {
    candidates = candidates.slice(0, evaluationCount);
  }

  const results = [];
  const rawSeriesByKeyword = new Map();
  const warnings = [];
  let trendsRateLimited = false;

  // 3) Pull time-series evidence from Trends (batched) + compute baseline scores
  const batchSize = Math.max(1, TRENDS_MAX_COMPARISON_ITEMS - 1);
  for (const batch of chunk(candidates, batchSize)) {
    try {
      const seriesByCandidate = await getInterestMultiSeries(seed, batch, { geo, startTime, endTime, hl });

      for (const candidate of batch) {
        const points = seriesByCandidate.get(candidate) || [];
        if (!points.length) continue;

        const candidateSeries = points.map((p) => p.candidate);
        const seedSeries = points.map((p) => p.seed);
        rawSeriesByKeyword.set(candidate, { candidateSeries, seedSeries, points });

        const w = Math.min(DEFAULT_RECENT_WINDOW_POINTS, Math.max(3, Math.floor(candidateSeries.length / 3)));
        const { recent, prev } = splitWindows(candidateSeries, w);
        const { recent: seedRecent } = splitWindows(seedSeries, w);

        const recentMean = mean(recent);
        const prevMean = mean(prev);
        const seedRecentMean = mean(seedRecent);

        const pct = percentChange(recentMean, prevMean);
        const ratio = recentMean / Math.max(EPS, seedRecentMean);

        const demandLevel = demandScoreFromRatio(ratio);
        const momentumBase = momentumScoreFromPercentChange(pct);
        const confidenceBase = confidenceFromSeries(candidateSeries);
        const risk = inferRiskHeuristics(candidate);

        const discovery = discoveryByKeyword.get(candidate.toLowerCase()) || null;

        results.push({
          id: `pr_${crypto.randomUUID()}`,
          keyword: candidate,
          scores: {
            demand: demandLevel,
            momentum: momentumBase,
            competition: null,
            margin: null,
            risk: risk.score,
            confidence: confidenceBase,
            overall: null
          },
          evidence: {
            discovery: discovery
              ? {
                  source: 'product_radar_ai',
                  bm25: discovery?.bm25 ?? null,
                  embedSim: discovery?.embedSim ?? null,
                  rerank: discovery?.rerank ?? null,
                  clusterId: discovery?.clusterId ?? null
                }
              : {
                  source: 'google_trends',
                  detail: 'related queries/topics + autocomplete'
                },
            demand: {
              source: 'google_trends',
              timeframeDays,
              geo: geo || 'WORLD',
              ratioVsSeed: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
              recentMean: Number.isFinite(recentMean) ? Number(recentMean.toFixed(1)) : null,
              prevMean: Number.isFinite(prevMean) ? Number(prevMean.toFixed(1)) : null,
              percentChange: Number.isFinite(pct) ? Number(pct.toFixed(1)) : null,
              demandLevel,
              geoSpread: null,
              geoTopCountries: null,
              series: points.slice(-Math.min(points.length, 60)).map((p) => ({
                t: p.time,
                v: p.candidate
              })),
              url: buildGoogleTrendsExploreUrl(candidate, { geo, timeframeDays })
            },
            momentum: null,
            competition: null,
            margin: null,
            risk: {
              source: 'heuristic',
              drivers: risk.drivers
            }
          },
          explanation: []
        });
      }
    } catch (error) {
      if (error?.status === 429) {
        trendsRateLimited = true;
        warnings.push(
          'Google Trends is rate-limiting requests right now (HTTP 429). Returning autocomplete-based angles; try again later for demand & momentum scores.'
        );
        break;
      }
      console.warn('[ProductRadar] candidate batch failed:', error?.message || error);
    }
  }

  if (trendsRateLimited) {
    sources.googleTrends = { available: false, configured: true, reason: 'Google Trends HTTP 429 (rate limited)' };
  }

  if (trendsRateLimited && results.length === 0) {
    const fallback = candidates.slice(0, clamp(6, maxCandidates, 24)).map((candidate) => {
      const risk = inferRiskHeuristics(candidate);
      const discovery = discoveryByKeyword.get(candidate.toLowerCase()) || null;
      return {
        id: `pr_${crypto.randomUUID()}`,
        keyword: candidate,
        scores: {
          demand: 50,
          momentum: 50,
          competition: null,
          margin: null,
          risk: risk.score,
          confidence: 20,
          overall: null
        },
        evidence: {
          discovery: discovery
            ? {
                source: 'product_radar_ai',
                bm25: discovery?.bm25 ?? null,
                embedSim: discovery?.embedSim ?? null,
                rerank: discovery?.rerank ?? null,
                clusterId: discovery?.clusterId ?? null
              }
            : {
                source: 'google_autocomplete',
                detail: 'google suggest'
              },
          demand: { source: 'unavailable', note: 'Google Trends rate-limited (HTTP 429).', series: [] },
          momentum: null,
          competition: null,
          margin: null,
          risk: { source: 'heuristic', drivers: risk.drivers }
        },
        explanation: [
          'Google Trends is rate-limiting (HTTP 429), so demand/momentum scores are temporarily unavailable.',
          'Showing autocomplete-derived angles people type into Google (great for enriching your catalog).',
          'Retry later (or reduce breadth) to get demand + momentum scoring.'
        ]
      };
    });

    results.push(...fallback);
  }

  // 3b) Geo spread (optional, limited to top candidates to reduce throttling)
  if (includeGeoSpread && results.length > 0) {
    const topForGeo = [...results]
      .sort((a, b) => b.scores.demand + b.scores.momentum - (a.scores.demand + a.scores.momentum))
      .slice(0, Math.min(4, results.length));

    const geoByKeyword = new Map();
    for (const item of topForGeo) {
      try {
        const countries = await getInterestByCountry(item.keyword, { geo, startTime, endTime, hl });
        geoByKeyword.set(item.keyword, countries);
      } catch (error) {
        console.warn('[ProductRadar] candidate geo failed:', item.keyword, error?.message || error);
      }
    }

    for (const item of results) {
      const countries = geoByKeyword.get(item.keyword) || null;
      if (!countries) continue;
      const spread = geoSpreadScoreFromCountries(countries);

      // Demand = level + geo spread (weighted)
      const level = Number(item.evidence?.demand?.demandLevel ?? item.scores.demand);
      const blended = Math.round(clamp(0, 0.75 * level + 0.25 * spread, 100));
      item.scores.demand = blended;

      item.evidence.demand.geoSpread = spread;
      item.evidence.demand.geoTopCountries = countries;
    }
  }

  // Seed geo context (where interest is concentrated)
  let seedRegions = [];
  try {
    seedRegions = await getInterestByCountry(seed, { geo, startTime, endTime, hl });
  } catch (error) {
    console.warn('[ProductRadar] interestByRegion failed:', error?.message || error);
    if (error?.status === 429) {
      sources.googleTrends = { available: false, configured: true, reason: 'Google Trends HTTP 429 (rate limited)' };
      warnings.push('Google Trends geo breakdown temporarily unavailable due to rate limiting (HTTP 429).');
    }
  }

  // 3c) Advanced momentum features (forecasting + change-point detection)
  if (useAiModels && aiConfigured && results.length > 0) {
    try {
      const series = results.map((item) => {
        const raw = rawSeriesByKeyword.get(item.keyword);
        const values = raw?.candidateSeries || [];
        return { id: item.keyword, values };
      });

      const analysis = await analyzeProductRadarTimeseries({
        series,
        horizon: DEFAULT_FORECAST_HORIZON_POINTS
      });

      const analysisById = new Map(
        (analysis?.results || [])
          .filter((r) => r?.id)
          .map((r) => [String(r.id), r])
      );

      for (const item of results) {
        const a = analysisById.get(item.keyword);
        if (!a) continue;

        item.evidence.momentum = {
          source: 'product_radar_ai',
          ...a
        };

        if (!a.ok) continue;

        let momentum = Number(item.scores.momentum) || 0;
        const pct = Number(item.evidence?.demand?.percentChange);

        // Forecast lift (ETS/Holt)
        const f = Number(a?.forecast?.pctChangeFromLast);
        if (Number.isFinite(f)) {
          momentum += 12 * Math.tanh(f / 40);
        }

        // Change-point bonus/penalty
        const cp = a?.changePoint;
        if (cp?.recent && cp?.direction === 'up' && Number.isFinite(cp?.magnitudePct)) {
          momentum += clamp(0, Math.abs(cp.magnitudePct) / 10, 15);
        }
        if (cp?.recent && cp?.direction === 'down' && Number.isFinite(cp?.magnitudePct)) {
          momentum -= clamp(0, Math.abs(cp.magnitudePct) / 12, 12);
        }

        // Tail slope nudges
        if (Number.isFinite(a?.slope)) {
          momentum += 6 * Math.tanh(a.slope / 4);
        }

        // Penalize if it looks like an outlier spike
        if (a?.anomaly?.isAnomaly) {
          momentum -= 6;
        }

        item.scores.momentum = Math.round(clamp(0, momentum, 100));

        // Confidence: downweight anomalous/noisy series
        if (a?.anomaly?.isAnomaly) {
          item.scores.confidence = Math.max(5, (Number(item.scores.confidence) || 50) - 12);
        }

        // If raw % change is unavailable but models ran, give a small neutral explanation.
        if (!Number.isFinite(pct)) {
          item.evidence.demand.percentChange = null;
        }
      }
    } catch (error) {
      sources.aiModels = {
        ...sources.aiModels,
        available: false,
        configured: true,
        reason: error?.message || 'AI time-series analysis failed'
      };
    }
  }

  // 4) Meta Ad Library evidence for top candidates (optional + requires APIFY token)
  if (includeMetaAds && sources.metaAdLibrary.configured && results.length > 0) {
    const topForCompetition = [...results]
      .sort((a, b) => b.scores.demand + b.scores.momentum - (a.scores.demand + a.scores.momentum))
      .slice(0, clamp(1, maxMetaChecks, 12));

    const metaEvidenceByKeyword = new Map();
    for (const item of topForCompetition) {
      metaEvidenceByKeyword.set(
        item.keyword,
        await gatherMetaAdLibraryEvidence(item.keyword, { country: metaCountry, limit: metaLimit })
      );
    }

    for (const item of results) {
      const meta = metaEvidenceByKeyword.get(item.keyword) || null;
      if (meta?.competitionScore != null) {
        item.scores.competition = meta.competitionScore;
        item.evidence.competition = {
          source: 'meta_ad_library',
          ...meta
        };
      }
    }
  } else if (includeMetaAds && !sources.metaAdLibrary.configured) {
    sources.metaAdLibrary = { available: false, configured: false, reason: 'APIFY_API_TOKEN not set' };
  }

  // 5) Final scoring + explanations
  for (const item of results) {
    item.scores.overall = computeOverallScore({
      demand: item.scores.demand,
      momentum: item.scores.momentum,
      competition: item.scores.competition,
      risk: item.scores.risk,
      confidence: item.scores.confidence
    });

    const demandRatio = item.evidence?.demand?.ratioVsSeed;
    const geoSpread = item.evidence?.demand?.geoSpread;

    const discoveredViaAi = item.evidence?.discovery?.source === 'product_radar_ai';
    item.explanation.push(
      discoveredViaAi
        ? `Discovered via hybrid retrieval (BM25 + embeddings) + diversity clustering.`
        : `Discovered as a related search to “${seed}” (Trends + autocomplete).`
    );

    if (Number.isFinite(demandRatio)) {
      item.explanation.push(`Demand level: ~${demandRatio}× vs seed query (Google Trends, last ${timeframeDays}d).`);
    }
    if (Number.isFinite(geoSpread)) {
      item.explanation.push(`Geo spread: ${Math.round(geoSpread)}/100 (more spread = more cross-market potential).`);
    }

    const m = item.evidence?.momentum;
    if (m?.ok) {
      const f = m?.forecast?.pctChangeFromLast;
      const cp = m?.changePoint;
      if (Number.isFinite(f)) {
        const dir = f > 0 ? 'up' : f < 0 ? 'down' : 'flat';
        item.explanation.push(`Forecast (ETS): ${dir} ${Math.abs(f).toFixed(0)}% over the next ~${DEFAULT_FORECAST_HORIZON_POINTS} points.`);
      }
      if (cp?.recent && Number.isFinite(cp?.magnitudePct)) {
        item.explanation.push(`Change-point (PELT): ${cp.direction} shift ~${Math.abs(cp.magnitudePct).toFixed(0)}% near the end of the window.`);
      }
      if (m?.anomaly?.isAnomaly) {
        item.explanation.push('Anomaly flag: recent points look spiky/noisy — confidence reduced.');
      }
    } else {
      const pct = item.evidence?.demand?.percentChange;
      if (Number.isFinite(pct)) {
        const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
        item.explanation.push(`Momentum: ${dir} ${Math.abs(pct).toFixed(0)}% vs prior window (recent vs previous).`);
      }
    }

    if (item.scores.competition != null) {
      const meta = item.evidence?.competition;
      if (meta?.sampleSize != null && meta?.uniqueAdvertisers != null) {
        item.explanation.push(
          `Competition proxy: sampled ${meta.sampleSize} active Meta ads from ${meta.uniqueAdvertisers} advertisers (country=${meta.country}).`
        );
      }
    } else {
      item.explanation.push('Competition proxy: not available (Meta Ad Library not connected).');
    }

    if (Array.isArray(item.evidence?.risk?.drivers) && item.evidence.risk.drivers.length) {
      item.explanation.push(`Risk heuristic: ${item.evidence.risk.drivers.join(', ')}.`);
    }
  }

  const payload = {
    query: seed,
    geo: geo || 'WORLD',
    timeframeDays,
    generatedAt: new Date().toISOString(),
    cached: false,
    warnings: warnings.length ? warnings : undefined,
    sources: {
      ...sources,
      candidateGeneration: candidateSourceCounts
    },
    seedContext: {
      topCountries: seedRegions,
      googleTrendsUrl: buildGoogleTrendsExploreUrl(seed, { geo, timeframeDays })
    },
    methodology: {
      layman: [
        'We start from your niche, then expand to nearby product angles people actually search for.',
        useAiModels
          ? 'We use hybrid retrieval (BM25 + embeddings, optional reranking) to keep results relevant and diverse.'
          : 'We expand using Google Trends related queries/topics plus Google autocomplete suggestions.',
        'We use Google Trends to estimate demand + momentum, and optionally sample the Meta Ad Library to approximate competition.',
        'Each result shows the signals used, the timeframe, and direct links to sources.'
      ].filter(Boolean),
      scoring: {
        demand: 'Google Trends ratio vs your seed query + optional geo spread (top countries entropy).',
        momentum: useAiModels
          ? 'Forecasting (ETS/Holt) + change-point detection (PELT) + tail slope, all as features.'
          : 'Recent window % change vs previous window (same query).',
        competition: 'Meta Ad Library sample density (how quickly we hit the sample limit + unique advertisers).',
        risk: 'Transparent keyword-based heuristic (not a classifier).',
        confidence: 'How much consistent non-zero signal we see in the trend series (downweighted if spiky).'
      }
    },
    results: results
      .sort((a, b) => (b.scores.overall ?? 0) - (a.scores.overall ?? 0))
      .slice(0, 30)
  };

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: payload });

  return payload;
}
