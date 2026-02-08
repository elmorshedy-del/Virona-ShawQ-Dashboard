const PERFORMANCE_TUNABLES = {
  endpointUrl: 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
  timeoutMs: 45000,
  scoreScale: 100,
  topOpportunityLimit: 3,
  strategies: ['mobile', 'desktop'],
  metricAuditKeys: {
    firstContentfulPaint: 'first-contentful-paint',
    largestContentfulPaint: 'largest-contentful-paint',
    interactionToNextPaint: 'interaction-to-next-paint',
    cumulativeLayoutShift: 'cumulative-layout-shift',
    totalBlockingTime: 'total-blocking-time',
    speedIndex: 'speed-index',
    timeToInteractive: 'interactive'
  }
};

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseMetric(audits, key, unit) {
  const audit = audits?.[key];
  if (!audit) return null;
  return {
    id: key,
    label: audit.title || key,
    value: toFiniteNumber(audit.numericValue),
    displayValue: audit.displayValue || null,
    score: toFiniteNumber(audit.score),
    unit
  };
}

function parseOpportunities(audits) {
  const entries = Object.entries(audits || {})
    .map(([id, audit]) => ({ id, audit }))
    .filter(({ audit }) => audit?.details?.type === 'opportunity')
    .map(({ id, audit }) => ({
      id,
      title: audit.title || id,
      score: toFiniteNumber(audit.score),
      potentialSavingsMs: toFiniteNumber(audit.numericValue),
      displayValue: audit.displayValue || null
    }))
    .filter((item) => Number.isFinite(item.potentialSavingsMs))
    .sort((a, b) => b.potentialSavingsMs - a.potentialSavingsMs)
    .slice(0, PERFORMANCE_TUNABLES.topOpportunityLimit);

  return entries.map((item) => ({
    ...item,
    potentialSavingsMs: round(item.potentialSavingsMs, 1)
  }));
}

function parsePageSpeedPayload(payload, strategy, targetUrl) {
  const lighthouse = payload?.lighthouseResult || {};
  const audits = lighthouse.audits || {};
  const categoryScore = toFiniteNumber(lighthouse?.categories?.performance?.score);
  const overallScore = Number.isFinite(categoryScore)
    ? round(categoryScore * PERFORMANCE_TUNABLES.scoreScale, 1)
    : null;

  const metrics = {
    firstContentfulPaint: parseMetric(audits, PERFORMANCE_TUNABLES.metricAuditKeys.firstContentfulPaint, 'ms'),
    largestContentfulPaint: parseMetric(audits, PERFORMANCE_TUNABLES.metricAuditKeys.largestContentfulPaint, 'ms'),
    interactionToNextPaint: parseMetric(audits, PERFORMANCE_TUNABLES.metricAuditKeys.interactionToNextPaint, 'ms'),
    cumulativeLayoutShift: parseMetric(audits, PERFORMANCE_TUNABLES.metricAuditKeys.cumulativeLayoutShift, 'score'),
    totalBlockingTime: parseMetric(audits, PERFORMANCE_TUNABLES.metricAuditKeys.totalBlockingTime, 'ms'),
    speedIndex: parseMetric(audits, PERFORMANCE_TUNABLES.metricAuditKeys.speedIndex, 'ms'),
    timeToInteractive: parseMetric(audits, PERFORMANCE_TUNABLES.metricAuditKeys.timeToInteractive, 'ms')
  };

  const loadingExperience = payload?.loadingExperience || {};
  const originLoadingExperience = payload?.originLoadingExperience || {};

  return {
    strategy,
    requestedUrl: payload?.id || targetUrl,
    fetchedAt: new Date().toISOString(),
    score: overallScore,
    categoryScore,
    metrics,
    opportunities: parseOpportunities(audits),
    fieldData: {
      page: loadingExperience?.overall_category || null,
      origin: originLoadingExperience?.overall_category || null
    }
  };
}

function buildPageSpeedUrl(targetUrl, strategy) {
  const search = new URLSearchParams({
    url: targetUrl,
    strategy,
    category: 'PERFORMANCE'
  });
  if (process.env.PAGESPEED_API_KEY) {
    search.set('key', process.env.PAGESPEED_API_KEY);
  }
  return `${PERFORMANCE_TUNABLES.endpointUrl}?${search.toString()}`;
}

async function fetchPageSpeedStrategy(targetUrl, strategy) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PERFORMANCE_TUNABLES.timeoutMs);

  try {
    const response = await fetch(buildPageSpeedUrl(targetUrl, strategy), {
      method: 'GET',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`PageSpeed ${strategy} request failed (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    return parsePageSpeedPayload(payload, strategy, targetUrl);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGooglePerformanceBundle(targetUrl) {
  const result = {
    provider: 'google-pagespeed-insights',
    fetchedAt: new Date().toISOString(),
    mobile: null,
    desktop: null,
    errors: []
  };

  const responses = await Promise.allSettled(
    PERFORMANCE_TUNABLES.strategies.map((strategy) => fetchPageSpeedStrategy(targetUrl, strategy))
  );

  responses.forEach((response, index) => {
    const strategy = PERFORMANCE_TUNABLES.strategies[index];
    if (response.status === 'fulfilled') {
      result[strategy] = response.value;
      return;
    }

    result.errors.push({
      strategy,
      message: response.reason?.message || `Failed to fetch ${strategy} PageSpeed data.`
    });
  });

  return result;
}

