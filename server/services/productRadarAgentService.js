import { runProductRadarScan } from './productRadarService.js';

const PRODUCT_RADAR_AGENT_LIMITS = {
  primaryRecommendations: 3,
  experimentRecommendations: 3,
  avoidRecommendations: 3,
  reasonLines: 2,
  actionPlanSteps: 5
};

const PRODUCT_RADAR_AGENT_THRESHOLDS = {
  primaryMinOverall: 60,
  highRisk: 75,
  highCompetition: 80
};

const PRODUCT_RADAR_AGENT_SOURCING_CHECKLIST = [
  'Confirm supplier lead time and MOQ before committing ad spend.',
  'Verify gross margin after shipping + returns buffer.',
  'Prepare 3 creative hooks and 2 landing-page angles per priority keyword.',
  'Validate policy/compliance risk before launching Meta ads.',
  'Set kill thresholds for CPA and CTR before first test week.'
];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueByKeyword(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const keyword = String(item?.keyword || '').toLowerCase();
    if (!keyword || seen.has(keyword)) return false;
    seen.add(keyword);
    return true;
  });
}

function normalizeRecommendation(item) {
  const explanation = Array.isArray(item?.explanation) ? item.explanation : [];
  const countries = Array.isArray(item?.evidence?.demand?.geoTopCountries)
    ? item.evidence.demand.geoTopCountries.slice(0, 4).map((country) => ({
      geoCode: country?.geoCode || null,
      geoName: country?.geoName || null,
      value: toNumber(country?.value)
    }))
    : [];

  return {
    id: item?.id || null,
    keyword: item?.keyword || '',
    scores: {
      overall: toNumber(item?.scores?.overall),
      demand: toNumber(item?.scores?.demand),
      momentum: toNumber(item?.scores?.momentum),
      competition: toNumber(item?.scores?.competition),
      risk: toNumber(item?.scores?.risk),
      confidence: toNumber(item?.scores?.confidence)
    },
    reasons: explanation.slice(0, PRODUCT_RADAR_AGENT_LIMITS.reasonLines),
    links: {
      trends: item?.evidence?.demand?.url || null,
      metaAdLibrary: item?.evidence?.competition?.url || null
    },
    geoTopCountries: countries
  };
}

function buildRecommendationBuckets(results = []) {
  const sorted = uniqueByKeyword(
    [...results].sort((a, b) => (toNumber(b?.scores?.overall) || 0) - (toNumber(a?.scores?.overall) || 0))
  );

  const primary = [];
  const experiments = [];
  const avoidNow = [];

  for (const item of sorted) {
    const overall = toNumber(item?.scores?.overall) || 0;
    const risk = toNumber(item?.scores?.risk) || 0;
    const competition = toNumber(item?.scores?.competition) || 0;

    if (
      risk >= PRODUCT_RADAR_AGENT_THRESHOLDS.highRisk ||
      competition >= PRODUCT_RADAR_AGENT_THRESHOLDS.highCompetition
    ) {
      if (avoidNow.length < PRODUCT_RADAR_AGENT_LIMITS.avoidRecommendations) {
        avoidNow.push(normalizeRecommendation(item));
      }
      continue;
    }

    if (
      overall >= PRODUCT_RADAR_AGENT_THRESHOLDS.primaryMinOverall &&
      primary.length < PRODUCT_RADAR_AGENT_LIMITS.primaryRecommendations
    ) {
      primary.push(normalizeRecommendation(item));
      continue;
    }

    if (experiments.length < PRODUCT_RADAR_AGENT_LIMITS.experimentRecommendations) {
      experiments.push(normalizeRecommendation(item));
    }
  }

  return { primary, experiments, avoidNow };
}

function buildActionPlan({ query, recommendations }) {
  const primaryKeyword = recommendations.primary[0]?.keyword || null;
  const experimentKeyword = recommendations.experiments[0]?.keyword || null;
  const avoidKeyword = recommendations.avoidNow[0]?.keyword || null;

  const actions = [
    primaryKeyword
      ? `Source and launch a fast validation test for "${primaryKeyword}" with a capped 7-day budget.`
      : `Run a narrower scan for "${query}" using a more specific seed to get stronger priority picks.`,
    primaryKeyword
      ? `Create 3 ad hooks + 2 landing variants for "${primaryKeyword}" before launch.`
      : 'Prepare creative variants only after a stable high-overall candidate appears.',
    experimentKeyword
      ? `Queue "${experimentKeyword}" as a secondary experiment after the first winner passes CPA guardrails.`
      : 'Use a secondary candidate only after primary test quality is confirmed.',
    avoidKeyword
      ? `Delay "${avoidKeyword}" until competition or risk indicators improve.`
      : 'Avoid candidates with high risk or crowded Meta ad density in this cycle.',
    'Review results after 7 days and rerun Product Radar Agent to update priorities.'
  ];

  return actions.slice(0, PRODUCT_RADAR_AGENT_LIMITS.actionPlanSteps);
}

function buildInsightSummary(scan, recommendations) {
  const results = Array.isArray(scan?.results) ? scan.results : [];
  const count = results.length || 1;

  const aggregate = results.reduce(
    (acc, item) => {
      acc.overall += toNumber(item?.scores?.overall) || 0;
      acc.demand += toNumber(item?.scores?.demand) || 0;
      acc.momentum += toNumber(item?.scores?.momentum) || 0;
      return acc;
    },
    { overall: 0, demand: 0, momentum: 0 }
  );

  const topOverall = toNumber(recommendations.primary[0]?.scores?.overall) || 0;

  return {
    totalCandidates: results.length,
    averageOverall: Number((aggregate.overall / count).toFixed(1)),
    averageDemand: Number((aggregate.demand / count).toFixed(1)),
    averageMomentum: Number((aggregate.momentum / count).toFixed(1)),
    topOverall,
    aiConfigured: !!scan?.sources?.aiModels?.configured
  };
}

export async function runProductRadarAgent(options) {
  const scan = await runProductRadarScan(options);
  const results = Array.isArray(scan?.results) ? scan.results : [];
  const recommendations = buildRecommendationBuckets(results);
  const actionPlan = buildActionPlan({
    query: scan?.query || options?.query || '',
    recommendations
  });

  return {
    generatedAt: new Date().toISOString(),
    query: scan?.query || options?.query || '',
    timeframeDays: scan?.timeframeDays || options?.timeframeDays || null,
    insight: buildInsightSummary(scan, recommendations),
    recommendations,
    actionPlan,
    sourcingChecklist: PRODUCT_RADAR_AGENT_SOURCING_CHECKLIST,
    warnings: Array.isArray(scan?.warnings) ? scan.warnings : [],
    seedContext: scan?.seedContext || null,
    sources: scan?.sources || null,
    methodology: scan?.methodology || null,
    scan
  };
}

