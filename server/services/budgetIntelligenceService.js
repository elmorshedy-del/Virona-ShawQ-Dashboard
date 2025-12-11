import { getDb } from '../db/database.js';

// Helper: safe division
function safeDivide(numerator, denominator, fallback = 0) {
  if (!denominator || denominator === 0 || denominator === null || denominator === undefined) {
    return fallback;
  }
  return numerator / denominator;
}

// Helper: clamp
function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

// Helper: median
function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Normalize a row into the canonical metric names the frontend simulator expects.
 * This does NOT remove any existing keys; it only adds/overwrites the standard ones.
 */
function normalizeForSimulatorRow(row) {
  if (!row) return row;

  const normalized = { ...row };

  // Core identifiers
  normalized.campaign_id =
    row.campaign_id ||
    row.campaignId ||
    row.campaign_id_raw ||
    null;

  normalized.campaign_name =
    row.campaign_name ||
    row.campaignName ||
    row.campaign ||
    null;

  // Geography
  normalized.geo =
    row.geo ||
    row.country ||
    row.country_code ||
    null;

  // Date (if available; many guidance rows are aggregated and will be null)
  normalized.date =
    row.date ||
    row.day ||
    row.date_start ||
    row.reporting_starts ||
    null;

  // Spend
  normalized.spend =
    row.spend ||
    row.totalSpend ||
    row.total_spend ||
    row.amount_spent ||
    null;

  // Revenue / purchase value
  normalized.purchase_value =
    row.purchase_value ||
    row.revenue ||
    row.totalRevenue ||
    row.conversion_value ||
    null;

  // Conversions / orders
  normalized.purchases =
    row.purchases ||
    row.orders ||
    row.total_orders ||
    row.conversions ||
    null;

  // Funnel metrics (optional)
  normalized.impressions =
    row.impressions ||
    row.impressions_raw ||
    null;

  normalized.clicks =
    row.clicks ||
    row.link_clicks ||
    null;

  normalized.atc =
    row.atc ||
    row.add_to_cart ||
    row.adds_to_cart ||
    null;

  normalized.ic =
    row.ic ||
    row.checkouts_initiated ||
    row.initiated_checkouts ||
    null;

  return normalized;
}

// Posterior calculation (simple Bayesian update using conjugate-like logic)
function computePosterior(priorMean, priorWeight, obsMean, obsWeight) {
  const totalWeight = priorWeight + obsWeight;
  if (totalWeight === 0) {
    return {
      mean: priorMean,
      weight: 0
    };
  }
  const mean = (priorMean * priorWeight + obsMean * obsWeight) / totalWeight;
  return {
    mean,
    weight: totalWeight
  };
}

// Helper: compute percentiles
function computePercentiles(values) {
  if (!values || values.length === 0) {
    return { p10: null, p25: null, p50: null, p75: null, p90: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p) => {
    const idx = Math.floor((p / 100) * (sorted.length - 1));
    return sorted[idx];
  };
  return {
    p10: pick(10),
    p25: pick(25),
    p50: pick(50),
    p75: pick(75),
    p90: pick(90),
  };
}

// Simple color tagger
function tagColor(value, thresholds) {
  // thresholds: { good, warn }
  if (value === null || value === undefined || Number.isNaN(value)) return 'muted';
  if (value >= thresholds.good) return 'good';
  if (value >= thresholds.warn) return 'warn';
  return 'bad';
}

// Simple band builder (for ROAS-like metrics)
function buildConfidenceBand(base, volatilityFactor = 0.25) {
  if (base === null || base === undefined || Number.isNaN(base)) {
    return { low: null, high: null };
  }
  const width = Math.abs(base) * volatilityFactor;
  return {
    low: base - width,
    high: base + width,
  };
}

// Build a simple learning stage label based on spend and days
function inferLearningStage(totalSpend, activeDays) {
  if (!activeDays || activeDays < 3) {
    return {
      stage: 'Cold Start',
      hint: 'Very early data – treat all signals as fragile.',
    };
  }
  if (totalSpend < 5000) {
    return {
      stage: 'Early Learning',
      hint: 'Spend more to let the algorithm discover stable patterns.',
    };
  }
  if (totalSpend < 20000) {
    return {
      stage: 'Emerging Signal',
      hint: 'Patterns are emerging – small budget shifts are sensible.',
    };
  }
  return {
    stage: 'Mature',
    hint: 'Signals fairly robust – use more aggressive optimizations.',
  };
}

// Helper: ROAS category
function roasCategory(roas) {
  if (roas === null || roas === undefined || Number.isNaN(roas)) return 'unknown';
  if (roas >= 5) return 'elite';
  if (roas >= 3) return 'strong';
  if (roas >= 2) return 'ok';
  if (roas > 0) return 'weak';
  return 'loss';
}

// Helper: build scale/hold/cut recommendation
function scaleDecision(roas, target, spend) {
  if (!roas || roas <= 0) {
    return {
      action: 'Cut',
      rationale: 'No reliable return. Free up budget for stronger geos/campaigns.',
    };
  }
  if (!target || target <= 0) {
    target = 3.0; // default safe
  }

  const ratio = roas / target;
  if (ratio >= 1.4) {
    return {
      action: 'Scale',
      rationale: `ROAS well above target (${roas.toFixed(2)}x vs ${target.toFixed(2)}x). Consider increasing budget if volume is meaningful.`,
    };
  }
  if (ratio >= 0.8) {
    return {
      action: 'Hold',
      rationale: `ROAS near target (${roas.toFixed(2)}x). Maintain and watch for consistency.`,
    };
  }
  return {
    action: 'Cut',
    rationale: `ROAS materially below target (${roas.toFixed(2)}x vs ${target.toFixed(2)}x). Consider cutting or restructuring.`,
  };
}

// Helper to compute posterior CAC/ROAS using simple weights
function bayesianBlendMetric(priorMean, priorWeight, obsMean, obsWeight) {
  if (priorMean === null || priorMean === undefined) {
    // No prior, just return observed
    return {
      mean: obsMean,
      weight: obsWeight,
    };
  }
  if (obsMean === null || obsMean === undefined) {
    // No observed, just prior
    return {
      mean: priorMean,
      weight: priorWeight,
    };
  }
  const totalWeight = priorWeight + obsWeight;
  if (totalWeight <= 0) {
    return {
      mean: priorMean,
      weight: 0,
    };
  }
  const mean = (priorMean * priorWeight + obsMean * obsWeight) / totalWeight;
  return {
    mean,
    weight: totalWeight,
  };
}

// Helper: classify spend band
function spendBand(spend) {
  if (spend === null || spend === undefined) return 'none';
  if (spend < 1000) return 'tiny';
  if (spend < 5000) return 'small';
  if (spend < 20000) return 'medium';
  if (spend < 50000) return 'large';
  return 'very_large';
}

// Helper: classify learning depth
function learningDepth(effectiveN) {
  if (!effectiveN || effectiveN < 5) return 'thin';
  if (effectiveN < 20) return 'moderate';
  if (effectiveN < 50) return 'strong';
  return 'deep';
}

// Main budget intelligence function
export async function getBudgetIntelligence(store, params = {}) {
  const db = await getDb();

  // Parse date range if provided
  const { dateStart, dateEnd } = params;
  const filters = [];
  const filterParams = [];

  if (dateStart) {
    filters.push('date >= ?');
    filterParams.push(dateStart);
  }
  if (dateEnd) {
    filters.push('date <= ?');
    filterParams.push(dateEnd);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  // Fetch available countries for this store
  const countries = await db.all(
    `
    SELECT country, COUNT(DISTINCT campaign_id) AS campaignCount
    FROM meta_daily_metrics
    WHERE store = ?
    GROUP BY country
    ORDER BY campaignCount DESC
  `,
    [store]
  );

  // Compute priors across all countries (last ~60 days)
  const priorRows = await db.all(
    `
    SELECT
      country,
      SUM(spend) AS spend,
      SUM(conversion_value) AS revenue,
      SUM(conversions) AS conversions
    FROM meta_daily_metrics
    WHERE store = ?
      AND date >= date('now', '-60 days')
    GROUP BY country
  `,
    [store]
  );

  // Global priors by country
  const priorsByCountry = priorRows.map((row) => {
    const roas = safeDivide(row.revenue, row.spend, null);
    const cac = safeDivide(row.spend, row.conversions, null);
    const band = buildConfidenceBand(roas, 0.3);
    return {
      country: row.country,
      spend: row.spend,
      revenue: row.revenue,
      conversions: row.conversions,
      roas,
      cac,
      band,
    };
  });

  // Global priors (all countries)
  const globalPriorSpend = priorRows.reduce((sum, r) => sum + (r.spend || 0), 0);
  const globalPriorRevenue = priorRows.reduce((sum, r) => sum + (r.revenue || 0), 0);
  const globalPriorConversions = priorRows.reduce(
    (sum, r) => sum + (r.conversions || 0),
    0
  );
  const globalPriorRoas = safeDivide(globalPriorRevenue, globalPriorSpend, null);
  const globalPriorCac = safeDivide(globalPriorSpend, globalPriorConversions, null);

  const globalPriorBand = buildConfidenceBand(globalPriorRoas, 0.25);

  // Compute per-country stats for the selected range (for posterior)
  const countryRows = await db.all(
    `
    SELECT
      country,
      SUM(spend) AS spend,
      SUM(conversion_value) AS revenue,
      SUM(conversions) AS conversions,
      COUNT(DISTINCT date) AS activeDays
    FROM meta_daily_metrics
    WHERE store = ?
      ${whereClause ? 'AND ' + whereClause.replace('WHERE ', '') : ''}
    GROUP BY country
  `,
    [store, ...filterParams]
  );

  const countryStats = countryRows.map((row) => {
    const obsRoas = safeDivide(row.revenue, row.spend, null);
    const obsCac = safeDivide(row.spend, row.conversions, null);

    const priorCountry = priorsByCountry.find((p) => p.country === row.country);
    const priorRoas = priorCountry ? priorCountry.roas : globalPriorRoas;
    const priorCac = priorCountry ? priorCountry.cac : globalPriorCac;

    const priorWeight = priorCountry ? clamp(5, 20, (priorCountry.spend || 0) / 1000) : 10;
    const obsWeight = clamp(1, 30, (row.spend || 0) / 500);

    const roasPosterior = bayesianBlendMetric(
      priorRoas,
      priorWeight,
      obsRoas,
      obsWeight
    );
    const cacPosterior = bayesianBlendMetric(priorCac, priorWeight, obsCac, obsWeight);

    const roasBand = buildConfidenceBand(roasPosterior.mean, 0.3);

    const learning = inferLearningStage(row.spend, row.activeDays);

    return {
      country: row.country,
      spend: row.spend,
      revenue: row.revenue,
      conversions: row.conversions,
      activeDays: row.activeDays,
      obsRoas,
      obsCac,
      priorRoas,
      priorCac,
      roasPosterior,
      cacPosterior,
      roasBand,
      learningStage: learning.stage,
      learningHint: learning.hint,
      spendBand: spendBand(row.spend),
      depth: learningDepth(roasPosterior.weight),
    };
  });

  // Compute a "learning map" – basically a grid of country vs. learning depth
  const learningMap = countryStats.map((c) => ({
    country: c.country,
    spend: c.spend,
    roas: c.roasPosterior.mean,
    roasBand: c.roasBand,
    learningStage: c.learningStage,
    depth: c.depth,
    category: roasCategory(c.roasPosterior.mean),
  }));

  // Global summary
  const globalStats = {
    spend: globalPriorSpend,
    revenue: globalPriorRevenue,
    conversions: globalPriorConversions,
    roas: globalPriorRoas,
    cac: globalPriorCac,
    roasBand: globalPriorBand,
  };

  // Build per-campaign guidance using meta_daily_metrics
  const campaignRows = await db.all(
    `
    SELECT
      campaign_id,
      campaign_name,
      country,
      SUM(spend) AS spend,
      SUM(conversion_value) AS revenue,
      SUM(conversions) AS conversions,
      COUNT(DISTINCT date) AS activeDays
    FROM meta_daily_metrics
    WHERE store = ?
      ${whereClause ? 'AND ' + whereClause.replace('WHERE ', '') : ''}
    GROUP BY campaign_id, campaign_name, country
  `,
    [store, ...filterParams]
  );

  // Join campaigns to country posterior stats
  let liveGuidance = campaignRows.map((row) => {
    const countryStat = countryStats.find((c) => c.country === row.country);
    const priorCountry = priorsByCountry.find((p) => p.country === row.country);

    const obsRoas = safeDivide(row.revenue, row.spend, null);
    const obsCac = safeDivide(row.spend, row.conversions, null);

    const priorRoas = countryStat ? countryStat.priorRoas : globalPriorRoas;
    const priorCac = countryStat ? countryStat.priorCac : globalPriorCac;

    const priorWeight = priorCountry ? clamp(5, 20, (priorCountry.spend || 0) / 1000) : 10;
    const obsWeight = clamp(1, 30, (row.spend || 0) / 500);

    const roasPosterior = bayesianBlendMetric(
      priorRoas,
      priorWeight,
      obsRoas,
      obsWeight
    );
    const cacPosterior = bayesianBlendMetric(priorCac, priorWeight, obsCac, obsWeight);

    const roasBand = buildConfidenceBand(roasPosterior.mean, 0.3);
    const learning = inferLearningStage(row.spend, row.activeDays);

    const roasCat = roasCategory(roasPosterior.mean);
    const decision = scaleDecision(roasPosterior.mean, 3.0, row.spend);

    return {
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      country: row.country,
      spend: row.spend,
      revenue: row.revenue,
      conversions: row.conversions,
      activeDays: row.activeDays,
      obsRoas,
      obsCac,
      roasPosterior: roasPosterior.mean,
      cacPosterior: cacPosterior.mean,
      roasBand,
      learningStage: learning.stage,
      learningHint: learning.hint,
      roasCategory: roasCat,
      action: decision.action,
      rationale: decision.rationale,
    };
  });

  // Normalize for simulator metric names
  liveGuidance = liveGuidance.map(normalizeForSimulatorRow);

  // Learning map summary (simple)
  const guidanceSummary = {
    totalCampaigns: liveGuidance.length,
    scaleCount: liveGuidance.filter((g) => g.action === 'Scale').length,
    holdCount: liveGuidance.filter((g) => g.action === 'Hold').length,
    cutCount: liveGuidance.filter((g) => g.action === 'Cut').length,
  };

  // Build "start plans" per country (for forward planning)
  const startPlans = countryStats.map((c) => {
    // A very rough "recommended" daily budget: aim for at least 5–10x CAC per day
    const targetDailySpend = c.cacPosterior.mean
      ? clamp(100, 20000, c.cacPosterior.mean * 8)
      : 2000;

    const expectedDailyRevenue = c.roasPosterior.mean
      ? targetDailySpend * c.roasPosterior.mean
      : null;

    const expectedPurchases = c.cacPosterior.mean
      ? safeDivide(targetDailySpend, c.cacPosterior.mean, null)
      : null;

    const band = buildConfidenceBand(
      c.roasPosterior.mean,
      c.depth === 'thin' ? 0.5 : c.depth === 'moderate' ? 0.35 : 0.25
    );

    return {
      country: c.country,
      name: `Starter plan for ${c.country}`,
      recommendedDaily: targetDailySpend,
      recommendedTotal: targetDailySpend * 7, // simple 7-day plan
      expectedDailyRevenue,
      expectedPurchases,
      roasPosterior: c.roasPosterior.mean,
      cacPosterior: c.cacPosterior.mean,
      roasBand: band,
      confidence:
        c.depth === 'deep'
          ? 'High'
          : c.depth === 'moderate'
          ? 'Medium'
          : 'Low',
      rationale:
        c.depth === 'deep'
          ? 'Strong historical data – good candidate for structured scaling tests.'
          : c.depth === 'moderate'
          ? 'Reasonable data – start moderately and adjust based on near-term results.'
          : 'Thin data – treat as exploratory with tight guardrails.',
      effectiveN: c.roasPosterior.weight,
      observedRoas: c.obsRoas,
      observedCac: c.obsCac,
    };
  });

  // Planning defaults (for frontend)
  const planningDefaults = {
    targetRoas: 3.0,
    minDailySpend: 100,
    maxDailySpend: 20000,
    horizonDays: 7,
  };

  // Period info
  const period = {
    dateStart: dateStart || null,
    dateEnd: dateEnd || null,
  };

  const priorRange = {
    windowDays: 60,
  };

  return {
    store,
    currency: store === 'virona' ? 'SAR' : 'USD',
    availableCountries: countries.map((c) => ({
      country: c.country,
      campaignCount: c.campaignCount,
    })),
    global: globalStats,
    priors: {
      byCountry: priorsByCountry,
      global: {
        roas: globalPriorRoas,
        cac: globalPriorCac,
        band: globalPriorBand,
      },
    },
    posteriors: {
      byCountry: countryStats,
    },
    learningMap,
    liveGuidance,
    guidanceSummary,
    startPlans,
    planningDefaults,
    period,
    priorRange,
  };
}
