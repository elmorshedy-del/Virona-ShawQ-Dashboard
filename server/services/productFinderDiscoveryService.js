import crypto from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const DISCOVERY_OUTPUT_DIR = path.join(os.tmpdir(), 'virona-product-finder-runs');
const DISCOVERY_PACKAGE_DIR = path.join(REPO_ROOT, 'product_discovery_agent');

const DEFAULT_SOURCING_CHECKLIST = [
  'Lock supplier lead time and MOQ before launch week.',
  'Validate gross margin after shipping, duties, and returns buffer.',
  'Prepare 3 creative hooks and 2 landing-page variants before paid launch.',
  'Define kill and scale guardrails (CPA, CTR, CVR) before day 1.',
  'Review trend + marketplace movement weekly and refresh priorities.'
];

const STORE_MARKETPLACES = {
  shawq: ['amazon', 'target'],
  vironax: ['amazon', 'walmart']
};

const STORE_EXCLUDE_KEYWORDS = {
  shawq: [
    'cat & jack',
    'boys',
    'girls',
    'toddler',
    'kids',
    'all in motion',
    'goodfellow',
    'universal thread'
  ],
  vironax: ['hoodie', 'sweatshirt', 'dress', 'apparel', 'toddler', 'kids']
};

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRecommendation(rec) {
  const key = String(rec || '').toLowerCase();
  if (key === 'add_now') return 'add_now';
  if (key === 'test_small_batch') return 'test_small_batch';
  if (key === 'watchlist') return 'watchlist';
  return 'reject';
}

function recommendationToLane(recommendation) {
  if (recommendation === 'add_now') return 'primary';
  if (recommendation === 'test_small_batch' || recommendation === 'watchlist') return 'experiments';
  return 'avoid';
}

function recommendationToDecision(recommendation) {
  if (recommendation === 'add_now') return 'GO';
  if (recommendation === 'test_small_batch') return 'TEST';
  if (recommendation === 'watchlist') return 'WATCH';
  return 'HOLD';
}

function mapTimeframeToTrendWindow(timeframeDays) {
  const days = toNumber(timeframeDays, 90);
  if (days >= 365) return 'today 12-m';
  if (days >= 180) return 'today 6-m';
  return 'today 3-m';
}

function mapCountryToGeo(metaCountry) {
  const country = String(metaCountry || '').trim().toUpperCase();
  if (!country || country === 'ALL') return 'US';
  return country;
}

function buildGoogleTrendsUrl(keyword, geo, trendWindow) {
  const params = new URLSearchParams();
  params.set('q', keyword);
  if (geo) params.set('geo', geo);
  params.set('date', trendWindow || 'today 12-m');
  return `https://trends.google.com/trends/explore?${params.toString()}`;
}

function pickBestSnapshot(snapshots = []) {
  const valid = (Array.isArray(snapshots) ? snapshots : []).filter(
    (item) => item?.status === 'ok' && toNumber(item?.total_results_estimate, 0) > 0
  );
  if (!valid.length) return null;

  return [...valid].sort(
    (a, b) => toNumber(b?.total_results_estimate, 0) - toNumber(a?.total_results_estimate, 0)
  )[0];
}

function buildOpportunity(item, { geo, trendWindow }) {
  const recommendation = normalizeRecommendation(item?.inventory_recommendation);
  const bestSnapshot = pickBestSnapshot(item?.marketplace_snapshots || []);
  const keyword = String(item?.keyword || '').trim();
  const sourceUrl = bestSnapshot?.source_url || null;

  return {
    keyword,
    recommendation,
    lane: recommendationToLane(recommendation),
    scores: {
      total: clamp(0, toNumber(item?.score_total, 0), 100),
      search: clamp(0, toNumber(item?.search_score, 0), 100),
      trend: clamp(0, toNumber(item?.trend_score, 0), 100),
      sustained: clamp(0, toNumber(item?.sustained_trend_score, 0), 100),
      marketplace: clamp(0, toNumber(item?.marketplace_score, 0), 100),
      quality: clamp(0, toNumber(item?.quality_fit_score, 0), 100)
    },
    sources: Array.isArray(item?.sources) ? item.sources : [],
    rationale: Array.isArray(item?.rationale) ? item.rationale : [],
    links: {
      trends: buildGoogleTrendsUrl(keyword, geo, trendWindow),
      marketplace: sourceUrl
    },
    market: {
      marketplace: bestSnapshot?.marketplace || null,
      estimatedResults: toNumber(bestSnapshot?.total_results_estimate, 0),
      sourceUrl,
      sampleProducts: Array.isArray(bestSnapshot?.sample_products)
        ? bestSnapshot.sample_products.slice(0, 6)
        : []
    }
  };
}

function buildLanes(opportunities = []) {
  const primary = [];
  const experiments = [];
  const avoid = [];

  for (const item of opportunities) {
    if (item.lane === 'primary') {
      primary.push(item);
      continue;
    }
    if (item.lane === 'experiments') {
      experiments.push(item);
      continue;
    }
    avoid.push(item);
  }

  return {
    primary: primary.slice(0, 6),
    experiments: experiments.slice(0, 8),
    avoid: avoid.slice(0, 8)
  };
}

function buildCopyworthyPieces(opportunities = []) {
  const rows = [];
  const seen = new Set();

  for (const item of opportunities) {
    if (item.recommendation === 'reject') continue;

    const market = item.market || {};
    const sourceUrl = market.sourceUrl;
    if (!sourceUrl) continue;

    const titles = Array.isArray(market.sampleProducts) ? market.sampleProducts : [];
    for (const title of titles) {
      const key = `${sourceUrl}::${title}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        keyword: item.keyword,
        title,
        marketplace: market.marketplace || 'marketplace',
        estimatedResults: market.estimatedResults || 0,
        sustainedScore: item.scores.sustained,
        totalScore: item.scores.total,
        url: sourceUrl
      });

      if (rows.length >= 6) return rows;
    }
  }

  return rows;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildMetrics(opportunities = []) {
  if (!opportunities.length) {
    return {
      avgTotal: 0,
      avgSearch: 0,
      avgSustained: 0,
      avgMarketplace: 0,
      avgQuality: 0
    };
  }

  return {
    avgTotal: Number(average(opportunities.map((item) => item.scores.total)).toFixed(1)),
    avgSearch: Number(average(opportunities.map((item) => item.scores.search)).toFixed(1)),
    avgSustained: Number(average(opportunities.map((item) => item.scores.sustained)).toFixed(1)),
    avgMarketplace: Number(average(opportunities.map((item) => item.scores.marketplace)).toFixed(1)),
    avgQuality: Number(average(opportunities.map((item) => item.scores.quality)).toFixed(1))
  };
}

function buildConsultation(opportunities = [], query = '') {
  const top = opportunities[0] || null;
  if (!top) {
    return {
      decision: 'HOLD',
      confidenceLabel: 'Low',
      confidenceScore: 20,
      piecesPerDay: { low: 0.2, high: 1.0 },
      topKeyword: query,
      readinessScore: 20,
      rationale: ['No strong opportunities returned. Refine concept and rerun with tighter scope.']
    };
  }

  const decision = recommendationToDecision(top.recommendation);
  const confidenceScore = Math.round(
    clamp(20, top.scores.total * 0.62 + top.scores.sustained * 0.38, 95)
  );

  const confidenceLabel =
    confidenceScore >= 75 ? 'High' : confidenceScore >= 50 ? 'Medium' : 'Low';

  let low = 0.3;
  let high = 1.2;

  if (decision === 'GO') {
    low = Number(Math.max(1.0, (top.scores.total / 35)).toFixed(1));
    high = Number(Math.max(low + 1.4, (top.scores.total / 16)).toFixed(1));
  } else if (decision === 'TEST') {
    low = Number(Math.max(0.6, (top.scores.total / 70)).toFixed(1));
    high = Number(Math.max(low + 0.9, (top.scores.total / 28)).toFixed(1));
  } else if (decision === 'WATCH') {
    low = Number(Math.max(0.3, (top.scores.total / 120)).toFixed(1));
    high = Number(Math.max(low + 0.5, (top.scores.total / 48)).toFixed(1));
  }

  return {
    decision,
    confidenceLabel,
    confidenceScore,
    piecesPerDay: { low, high },
    topKeyword: top.keyword,
    readinessScore: Math.round(top.scores.total),
    rationale: [
      `Top keyword: "${top.keyword}" with total score ${top.scores.total.toFixed(1)}.`,
      `Sustained trend score ${top.scores.sustained.toFixed(1)} and marketplace score ${top.scores.marketplace.toFixed(1)}.`
    ]
  };
}

function buildActionPlan(opportunities = [], query = '') {
  const top = opportunities[0] || null;
  const second = opportunities[1] || null;
  const avoid = opportunities.find((item) => item.recommendation === 'reject') || null;

  return [
    top
      ? `Launch a controlled validation batch for "${top.keyword}" for 7 days.`
      : `Refine "${query}" with a narrower intent and rerun.`,
    top
      ? `Prepare 3 hooks and 2 PDP variants for "${top.keyword}" before spend.`
      : 'Prepare creative variants after one candidate clears sustained signal thresholds.',
    second
      ? `Queue "${second.keyword}" as the secondary test after primary KPI validation.`
      : 'Run one lane first before widening experiments.',
    avoid
      ? `Hold "${avoid.keyword}" until sustained trend and quality fit improve.`
      : 'Hold weak-fit and low-sustained concepts this cycle.',
    'Review outcomes weekly and rerun Product Finder to refresh inventory priorities.'
  ];
}

function buildSummary(report, opportunities) {
  const warnings = Array.isArray(report?.warnings) ? report.warnings.length : 0;
  const sustained = Array.isArray(report?.sustained_trend_signals)
    ? report.sustained_trend_signals.length
    : 0;

  return {
    totalOpportunities: opportunities.length,
    sustainedSignals: sustained,
    warnings,
    trendWindow: report?.config?.trend_time_window || null,
    marketplaces: Array.isArray(report?.config?.marketplaces) ? report.config.marketplaces : []
  };
}

function mapReportToProductFinderData(report, options = {}) {
  const geo = report?.config?.geo || mapCountryToGeo(options.metaCountry);
  const trendWindow = report?.config?.trend_time_window || mapTimeframeToTrendWindow(options.timeframeDays);

  const opportunities = (Array.isArray(report?.opportunities) ? report.opportunities : [])
    .map((item) => buildOpportunity(item, { geo, trendWindow }))
    .sort((a, b) => b.scores.total - a.scores.total);

  const lanes = buildLanes(opportunities);
  const consultation = buildConsultation(opportunities, options.query);

  return {
    generatedAt: report?.generated_at || new Date().toISOString(),
    engine: 'product_discovery_agent',
    query: String(options.query || '').trim(),
    profile: report?.profile || null,
    config: report?.config || null,
    summary: buildSummary(report, opportunities),
    consultation,
    metrics: buildMetrics(opportunities),
    lanes,
    copyworthyPieces: buildCopyworthyPieces(opportunities),
    actionPlan: buildActionPlan(opportunities, options.query),
    sourcingChecklist: DEFAULT_SOURCING_CHECKLIST,
    warnings: Array.isArray(report?.warnings) ? report.warnings : [],
    sustainedTrendSignals: Array.isArray(report?.sustained_trend_signals)
      ? report.sustained_trend_signals
      : [],
    searchExpansions: Array.isArray(report?.search_expansions) ? report.search_expansions : []
  };
}

async function runPython(args, { cwd = REPO_ROOT, timeoutMs = 120000 } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn('python3', args, { cwd, env: process.env });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`product_discovery_agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Python exited with code ${code}`).trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function getProductFinderHealth() {
  let pythonReady = false;
  let pythonReason = null;

  try {
    await runPython(['--version'], { timeoutMs: 5000 });
    pythonReady = true;
  } catch (error) {
    pythonReason = error?.message || 'python3 not available';
  }

  let engineReady = false;
  let engineReason = null;

  try {
    await fs.access(DISCOVERY_PACKAGE_DIR);
    engineReady = true;
  } catch {
    engineReason = 'product_discovery_agent package missing in repository';
  }

  const ready = pythonReady && engineReady;
  return {
    success: true,
    engine: 'product_discovery_agent',
    sources: {
      googleTrends: {
        available: ready,
        configured: ready,
        reason: ready ? null : (pythonReason || engineReason)
      },
      marketplaceScanners: {
        available: ready,
        configured: ready,
        supported: ['amazon', 'walmart', 'target'],
        reason: ready ? null : (pythonReason || engineReason)
      },
      aiModels: {
        available: false,
        configured: false,
        reason: 'Not required for current Product Finder core.'
      }
    },
    timestamp: new Date().toISOString()
  };
}

export async function runProductFinderConsultation(options = {}) {
  const query = String(options.query || '').trim();
  if (!query) {
    const error = new Error('Query is required');
    error.status = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const storeId = String(options.storeId || '').trim().toLowerCase();
  const storeName = String(options.storeName || 'Store').trim() || 'Store';
  const positioningMode = options.qualityBias ? 'quality' : 'balanced';
  const geo = mapCountryToGeo(options.metaCountry);
  const trendWindow = mapTimeframeToTrendWindow(options.timeframeDays);

  const includeMarketplaces = options.includeMarketplaces !== false;
  const marketplaces = includeMarketplaces
    ? (STORE_MARKETPLACES[storeId] || ['amazon', 'target', 'walmart'])
    : ['amazon'];

  const excludeKeywords = STORE_EXCLUDE_KEYWORDS[storeId] || [];
  const maxMarketplaceTerms = clamp(4, toNumber(options.maxCandidates, 12), 30);
  const maxSustainedTerms = clamp(4, Math.min(maxMarketplaceTerms, 12), 16);

  await fs.mkdir(DISCOVERY_OUTPUT_DIR, { recursive: true });

  const fileStem = `product-finder-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const jsonPath = path.join(DISCOVERY_OUTPUT_DIR, `${fileStem}.json`);
  const markdownPath = path.join(DISCOVERY_OUTPUT_DIR, `${fileStem}.md`);

  const args = [
    '-m', 'product_discovery_agent.cli',
    '--store-name', storeName,
    '--seed-keyword', query,
    '--positioning-mode', positioningMode,
    '--geo', geo,
    '--trend-time-window', trendWindow,
    '--max-marketplace-terms', String(maxMarketplaceTerms),
    '--max-sustained-trend-terms', String(maxSustainedTerms),
    '--max-suggestions-per-source', '10',
    '--max-sample-products', '6',
    '--output-dir', DISCOVERY_OUTPUT_DIR,
    '--file-stem', fileStem
  ];

  for (const marketplace of marketplaces) {
    args.push('--marketplace', marketplace);
  }

  for (const excluded of excludeKeywords) {
    args.push('--exclude-keyword', excluded);
  }

  try {
    await runPython(args, { cwd: REPO_ROOT, timeoutMs: 150000 });

    const raw = await fs.readFile(jsonPath, 'utf-8');
    const report = JSON.parse(raw);

    return mapReportToProductFinderData(report, {
      query,
      timeframeDays: options.timeframeDays,
      metaCountry: options.metaCountry
    });
  } catch (error) {
    const wrapped = new Error(error?.message || 'Product Finder consultation failed');
    wrapped.status = Number.isInteger(error?.status) ? error.status : 502;
    wrapped.code = error?.code || 'PRODUCT_FINDER_FAILED';
    throw wrapped;
  } finally {
    await Promise.allSettled([
      fs.unlink(jsonPath),
      fs.unlink(markdownPath)
    ]);
  }
}
