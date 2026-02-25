import {
  BUDGET_MONITOR_CONFIG,
  CONFIDENCE_CALIBRATION,
  HEADROOM_PRESETS,
  LAUNCH_PRESETS,
  METRIC_DIRECTION,
  MODEL_PRESET_OPTIONS,
  MONTE_CARLO_CONFIG,
  SENTINEL_PRESETS,
  SHIFT_INTENT,
  SHOCK_FILTER_CONFIG,
  STORE_DEFAULT_AOV
} from './constants.js';
import {
  buildRecencyWeights,
  clamp01,
  clampInt,
  clampNumber,
  createSeededRng,
  hashStringToSeed,
  linearTrendSlope,
  mad,
  mean,
  median,
  normalizePercent,
  percentile,
  round,
  safeDeltaRatio,
  safeDivide,
  sampleBeta,
  sampleGamma,
  samplePoisson,
  sum,
  weightedLinearRegression
} from './utils.js';

const METRIC_SMOOTHING_MAP = Object.freeze({
  reach: 'reach',
  ctr: 'ctr',
  spend: 'spend',
  orders: 'orders'
});

const METRIC_MONITOR_DEFS = Object.freeze([
  Object.freeze({ key: 'spend', label: 'Spend', direction: METRIC_DIRECTION.spend }),
  Object.freeze({ key: 'reach', label: 'Unique Reach', direction: METRIC_DIRECTION.reach }),
  Object.freeze({ key: 'ctr', label: 'CTR', direction: METRIC_DIRECTION.ctr }),
  Object.freeze({ key: 'cvr', label: 'CVR', direction: METRIC_DIRECTION.cvr }),
  Object.freeze({ key: 'cpm', label: 'CPM', direction: METRIC_DIRECTION.cpm }),
  Object.freeze({ key: 'orders', label: 'Orders', direction: METRIC_DIRECTION.orders }),
  Object.freeze({ key: 'lpvRate', label: 'LPV Rate', direction: METRIC_DIRECTION.lpvRate })
]);

function resolvePresetOption(presets, requestedPreset) {
  const normalized = String(requestedPreset || '').trim().toLowerCase();
  if (MODEL_PRESET_OPTIONS.has(normalized) && presets[normalized]) {
    return { name: normalized, config: presets[normalized] };
  }
  return { name: 'balanced', config: presets.balanced };
}

function getTrailingWindow(series, days) {
  if (!Array.isArray(series) || !series.length || days <= 0) return [];
  return series.slice(Math.max(0, series.length - days));
}

function getLeadingWindow(series, days) {
  if (!Array.isArray(series) || !series.length || days <= 0) return [];
  return series.slice(0, Math.min(days, series.length));
}

function getSpendActiveSeries(series) {
  if (!Array.isArray(series)) return [];
  return series.filter((row) => (Number(row?.spend) || 0) > 0);
}

function summarizeSeriesWindow(series) {
  const totals = series.reduce((accumulator, row) => {
    accumulator.spend += Number(row.spend) || 0;
    accumulator.impressions += Number(row.impressions) || 0;
    accumulator.reach += Number(row.reach) || 0;
    accumulator.clicks += Number(row.clicks) || 0;
    accumulator.landingPageViews += Number(row.landingPageViews) || 0;
    accumulator.conversions += Number(row.conversions) || 0;
    accumulator.orders += Number(row.orders) || 0;
    accumulator.revenue += Number(row.revenue) || 0;
    return accumulator;
  }, {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    landingPageViews: 0,
    conversions: 0,
    orders: 0,
    revenue: 0
  });

  return {
    days: series.length,
    totals,
    rates: {
      ctr: safeDivide(totals.clicks, totals.impressions),
      cvr: safeDivide(totals.conversions, totals.clicks),
      cpm: safeDivide(totals.spend * 1000, totals.impressions),
      lpvRate: safeDivide(totals.landingPageViews, totals.clicks),
      ordersPerSpend: safeDivide(totals.orders, totals.spend),
      roas: safeDivide(totals.revenue, totals.spend)
    }
  };
}

function calculateAdaptiveSmoothed(values, metricKey) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      smoothed: [],
      shockZ: []
    };
  }

  const fallbackScale = SHOCK_FILTER_CONFIG.scaleFallbacks[metricKey] || 1;
  const smoothed = [];
  const shockZ = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = Number.isFinite(values[index]) ? values[index] : 0;

    if (index === 0) {
      smoothed.push(value);
      shockZ.push(0);
      continue;
    }

    const windowStart = Math.max(0, index - SHOCK_FILTER_CONFIG.windowDays);
    const baselineValues = values
      .slice(windowStart, index)
      .filter((baselineValue) => Number.isFinite(baselineValue));

    const baselineMedian = median(baselineValues);
    const baselineMad = mad(baselineValues, baselineMedian);

    let scale = fallbackScale;
    if (
      baselineValues.length >= SHOCK_FILTER_CONFIG.minimumBaselinePoints
      && baselineMad != null
      && baselineMad > SHOCK_FILTER_CONFIG.epsilon
    ) {
      scale = Math.max(
        SHOCK_FILTER_CONFIG.epsilon,
        baselineMad * 1.4826
      );
    }

    const z = baselineMedian == null
      ? 0
      : safeDivide(value - baselineMedian, scale, 0);

    const shockStrength = Math.max(0, Math.abs(z) - SHOCK_FILTER_CONFIG.zTolerance);
    const alpha = clampNumber(
      SHOCK_FILTER_CONFIG.baseAlpha / (1 + (shockStrength * SHOCK_FILTER_CONFIG.dampingFactor)),
      SHOCK_FILTER_CONFIG.minAlpha,
      SHOCK_FILTER_CONFIG.baseAlpha
    );

    const previousSmoothed = smoothed[index - 1];
    const smoothedValue = (alpha * value) + ((1 - alpha) * previousSmoothed);

    smoothed.push(smoothedValue);
    shockZ.push(round(z, 4));
  }

  return { smoothed, shockZ };
}

export function buildShockAwareSeries(series) {
  const reachValues = series.map((row) => Number(row.reach) || 0);
  const ctrValues = series.map((row) => Number(row.ctr) || 0);
  const spendValues = series.map((row) => Number(row.spend) || 0);
  const orderValues = series.map((row) => Number(row.orders) || 0);

  const reachSmooth = calculateAdaptiveSmoothed(reachValues, METRIC_SMOOTHING_MAP.reach);
  const ctrSmooth = calculateAdaptiveSmoothed(ctrValues, METRIC_SMOOTHING_MAP.ctr);
  const spendSmooth = calculateAdaptiveSmoothed(spendValues, METRIC_SMOOTHING_MAP.spend);
  const orderSmooth = calculateAdaptiveSmoothed(orderValues, METRIC_SMOOTHING_MAP.orders);

  return series.map((row, index) => {
    const maxShockZ = Math.max(
      Math.abs(reachSmooth.shockZ[index] || 0),
      Math.abs(ctrSmooth.shockZ[index] || 0),
      Math.abs(spendSmooth.shockZ[index] || 0),
      Math.abs(orderSmooth.shockZ[index] || 0)
    );

    return {
      ...row,
      smoothed: {
        reach: round(reachSmooth.smoothed[index] || 0, 2),
        ctr: round(ctrSmooth.smoothed[index] || 0, 6),
        spend: round(spendSmooth.smoothed[index] || 0, 2),
        orders: round(orderSmooth.smoothed[index] || 0, 2)
      },
      shocks: {
        reachZ: reachSmooth.shockZ[index] || 0,
        ctrZ: ctrSmooth.shockZ[index] || 0,
        spendZ: spendSmooth.shockZ[index] || 0,
        ordersZ: orderSmooth.shockZ[index] || 0,
        maxZ: round(maxShockZ, 4),
        severe: maxShockZ >= SHOCK_FILTER_CONFIG.severeShockZ
      }
    };
  });
}

function classifyShiftIntent(metricKey, deltaRatio) {
  const direction = METRIC_DIRECTION[metricKey] || 'neutral';
  const tiers = BUDGET_MONITOR_CONFIG.deltaTiers;

  if (!Number.isFinite(deltaRatio) || direction === 'neutral') {
    return SHIFT_INTENT.info;
  }

  const signedImprovement = direction === 'lower_better' ? -deltaRatio : deltaRatio;

  if (signedImprovement >= tiers.strong) return SHIFT_INTENT.strong_improvement;
  if (signedImprovement >= tiers.medium) return SHIFT_INTENT.improvement;
  if (signedImprovement >= tiers.mild) return SHIFT_INTENT.slight_improvement;
  if (signedImprovement <= -tiers.strong) return SHIFT_INTENT.strong_decline;
  if (signedImprovement <= -tiers.medium) return SHIFT_INTENT.decline;
  if (signedImprovement <= -tiers.mild) return SHIFT_INTENT.slight_decline;
  return SHIFT_INTENT.neutral;
}

function resolvePivotIndex(series, pivotDate) {
  if (!Array.isArray(series) || !series.length || !pivotDate) return -1;

  const exactIndex = series.findIndex((row) => row?.date === pivotDate);
  if (exactIndex >= 0) return exactIndex;

  const nextIndex = series.findIndex((row) => (row?.date || '') > pivotDate);
  if (nextIndex >= 0) return nextIndex;

  return series.length - 1;
}

function buildHistoryShiftEvents(series, historyEvents = []) {
  if (!Array.isArray(historyEvents) || historyEvents.length === 0) {
    return [];
  }

  return historyEvents
    .map((event) => {
      const pivotDate = typeof event?.pivotDate === 'string' ? event.pivotDate : null;
      const pivotIndex = resolvePivotIndex(series, pivotDate);
      if (pivotIndex < 0) return null;

      const fromBudget = Number(event?.fromBudget);
      const toBudget = Number(event?.toBudget);
      const hasBudgetValues = event?.fromBudget != null
        && event?.toBudget != null
        && Number.isFinite(fromBudget)
        && Number.isFinite(toBudget);
      if (!hasBudgetValues) return null;

      const budgetShiftRatio = safeDeltaRatio(toBudget, fromBudget);
      if (!Number.isFinite(budgetShiftRatio)) return null;
      if (Math.abs(budgetShiftRatio) < BUDGET_MONITOR_CONFIG.minShiftRatio) return null;

      return {
        pivotIndex,
        pivotDate,
        preSpendAvg: 0,
        postSpendAvg: 0,
        shiftRatio: budgetShiftRatio,
        source: 'meta_history',
        eventTime: typeof event?.eventTime === 'string' ? event.eventTime : null,
        campaignId: event?.campaignId || null,
        objectId: event?.objectId || null,
        objectType: event?.objectType || null,
        fromBudget,
        toBudget,
        budgetShiftRatio
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftKey = left?.eventTime || left?.pivotDate || '';
      const rightKey = right?.eventTime || right?.pivotDate || '';
      return rightKey.localeCompare(leftKey);
    })
    .slice(0, BUDGET_MONITOR_CONFIG.historyMaxEvents);
}

function summarizeMonitorMetric({ series, event, metricKey }) {
  const preWindow = series.slice(event.pivotIndex - BUDGET_MONITOR_CONFIG.preWindowDays, event.pivotIndex);
  const postWindow = series.slice(event.pivotIndex, event.pivotIndex + BUDGET_MONITOR_CONFIG.postWindowDays);

  const preMean = mean(preWindow.map((row) => Number(row[metricKey]) || 0)) || 0;
  const postMean = mean(postWindow.map((row) => Number(row[metricKey]) || 0)) || 0;
  const deltaRatio = safeDeltaRatio(postMean, preMean);

  return {
    preMean,
    postMean,
    deltaRatio,
    intent: classifyShiftIntent(metricKey, deltaRatio)
  };
}

export function buildBudgetChangeMonitor(series, budgetHistoryEvents = []) {
  if (!Array.isArray(series) || series.length < (BUDGET_MONITOR_CONFIG.preWindowDays + BUDGET_MONITOR_CONFIG.postWindowDays)) {
    return {
      hasEvent: false,
      events: [],
      latest: null,
      metrics: []
    };
  }

  const lookbackSeries = getTrailingWindow(series, BUDGET_MONITOR_CONFIG.monitorLookbackDays);
  const historyEvents = buildHistoryShiftEvents(lookbackSeries, budgetHistoryEvents);
  const events = historyEvents;

  const latest = events[0] || null;
  if (!latest) {
    return {
      hasEvent: false,
      events: [],
      latest: null,
      metrics: []
    };
  }

  const latestSpendMetric = summarizeMonitorMetric({
    series: lookbackSeries,
    event: latest,
    metricKey: 'spend'
  });

  const metrics = METRIC_MONITOR_DEFS.map((metricDef) => {
    const metricStats = summarizeMonitorMetric({
      series: lookbackSeries,
      event: latest,
      metricKey: metricDef.key
    });

    return {
      key: metricDef.key,
      label: metricDef.label,
      direction: metricDef.direction,
      preValue: round(metricStats.preMean, metricDef.key === 'ctr' || metricDef.key === 'cvr' || metricDef.key === 'lpvRate' ? 6 : 2),
      postValue: round(metricStats.postMean, metricDef.key === 'ctr' || metricDef.key === 'cvr' || metricDef.key === 'lpvRate' ? 6 : 2),
      deltaRatio: round(metricStats.deltaRatio, 4),
      deltaPercent: normalizePercent(metricStats.deltaRatio),
      intent: metricStats.intent
    };
  });

  return {
    hasEvent: true,
    events: events.map((event) => ({
      pivotDate: event.pivotDate,
      source: 'meta_history',
      preSpendAvg: round(
        summarizeMonitorMetric({ series: lookbackSeries, event, metricKey: 'spend' }).preMean || 0,
        2
      ),
      postSpendAvg: round(
        summarizeMonitorMetric({ series: lookbackSeries, event, metricKey: 'spend' }).postMean || 0,
        2
      ),
      shiftRatio: round(event.shiftRatio, 4),
      shiftPercent: normalizePercent(event.shiftRatio),
      fromBudget: Number.isFinite(event.fromBudget) ? round(event.fromBudget, 2) : null,
      toBudget: Number.isFinite(event.toBudget) ? round(event.toBudget, 2) : null,
      budgetShiftPercent: Number.isFinite(event.budgetShiftRatio) ? normalizePercent(event.budgetShiftRatio) : null
    })),
    latest: {
      pivotDate: latest.pivotDate,
      source: 'meta_history',
      preSpendAvg: round(latestSpendMetric.preMean || 0, 2),
      postSpendAvg: round(latestSpendMetric.postMean || 0, 2),
      shiftRatio: round(latest.shiftRatio, 4),
      shiftPercent: normalizePercent(latest.shiftRatio),
      fromBudget: Number.isFinite(latest.fromBudget) ? round(latest.fromBudget, 2) : null,
      toBudget: Number.isFinite(latest.toBudget) ? round(latest.toBudget, 2) : null,
      budgetShiftPercent: Number.isFinite(latest.budgetShiftRatio) ? normalizePercent(latest.budgetShiftRatio) : null,
      preWindowDays: BUDGET_MONITOR_CONFIG.preWindowDays,
      postWindowDays: BUDGET_MONITOR_CONFIG.postWindowDays
    },
    metrics
  };
}

function buildSignal({
  key,
  label,
  currentValue,
  baselineValue,
  thresholdRatio,
  direction,
  weight,
  source
}) {
  const deltaRatio = safeDeltaRatio(currentValue, baselineValue);
  const normalizedRisk = direction === 'lower_better'
    ? clamp01(deltaRatio / Math.max(thresholdRatio, 1e-6))
    : clamp01((-deltaRatio) / Math.max(thresholdRatio, 1e-6));
  const hasBaseline = Number.isFinite(baselineValue) && Math.abs(baselineValue) > 1e-9;
  const adverseDirection = direction === 'lower_better' ? deltaRatio > 0 : deltaRatio < 0;

  return {
    key,
    label,
    source,
    weight,
    baselineValue: round(baselineValue, 6),
    currentValue: round(currentValue, 6),
    deltaRatio: round(deltaRatio, 4),
    deltaPercent: normalizePercent(deltaRatio),
    thresholdPercent: normalizePercent(thresholdRatio),
    risk: round(normalizedRisk, 4),
    weightedImpact: round(normalizedRisk * weight * 100, 2),
    hasBaseline,
    trend: hasBaseline ? (adverseDirection ? 'deteriorated' : 'improved') : 'insufficient_baseline'
  };
}

function buildSentinelStatus(riskScore, preset) {
  if (riskScore >= preset.criticalThreshold) {
    return { code: 'critical', label: 'Critical', tone: 'critical' };
  }
  if (riskScore >= preset.warningThreshold) {
    return { code: 'watch', label: 'Watch', tone: 'warning' };
  }
  return { code: 'stable', label: 'Stable', tone: 'healthy' };
}

function estimateModelConfidence({
  signalClicks,
  minimumClicks,
  targetClicks,
  currentWindowDays,
  expectedWindowDays,
  avgShock
}) {
  const clickCoverage = clamp01(safeDivide(signalClicks - minimumClicks, Math.max(targetClicks - minimumClicks, 1), 0));
  const dayCoverage = clamp01(safeDivide(currentWindowDays, expectedWindowDays, 0));
  const shockPenalty = clamp01(safeDivide(avgShock, SHOCK_FILTER_CONFIG.severeShockZ, 0));

  const confidence = 0.35 + (0.32 * clickCoverage) + (0.28 * dayCoverage) - (0.2 * shockPenalty);
  return clampNumber(confidence, 0.1, 0.95);
}

export function buildMatureSentinelModel({ analysisSeries, anchorSeries, presetName = 'balanced' }) {
  const { name: resolvedPresetName, config: preset } = resolvePresetOption(SENTINEL_PRESETS, presetName);

  const spendActiveAnalysisSeries = getSpendActiveSeries(analysisSeries);
  const spendActiveAnchorSeries = getSpendActiveSeries(anchorSeries);
  const currentWindow = getTrailingWindow(spendActiveAnalysisSeries, preset.currentWindowDays);
  let baselineWindow = spendActiveAnchorSeries;

  if (!baselineWindow.length) {
    baselineWindow = getLeadingWindow(
      spendActiveAnalysisSeries,
      Math.max(preset.currentWindowDays * 3, preset.currentWindowDays + 1)
    );
  }

  if (!currentWindow.length) {
    return {
      id: 'mature_sentinel',
      name: 'Mature Campaign Sentinel',
      preset: resolvedPresetName,
      status: { code: 'stable', label: 'Stable', tone: 'healthy' },
      riskScore: 0,
      confidence: 0.1,
      decisionWindowDays: preset.policyRecheckWindowDays,
      decisionWindowSource: 'policy',
      decisionWindowPolicyDays: preset.policyRecheckWindowDays,
      decisionWindowLearningAdjustmentDays: 0,
      summary: 'Stable: no active spend days in the current watch window.',
      action: 'Wait for fresh delivery data before re-scoring risk signals.',
      signals: [],
      policy: {
        warningThreshold: preset.warningThreshold,
        criticalThreshold: preset.criticalThreshold,
        minimumCurrentClicks: preset.minimumCurrentClicks
      },
      evidence: {
        currentWindowDays: 0,
        baselineWindowDays: baselineWindow.length,
        currentTotals: summarizeSeriesWindow([]).totals,
        baselineTotals: summarizeSeriesWindow(baselineWindow).totals,
        averageShockZ: 0
      }
    };
  }

  const currentSummary = summarizeSeriesWindow(currentWindow);
  const baselineSummary = summarizeSeriesWindow(baselineWindow);

  const riskSignals = [
    buildSignal({
      key: 'cvr',
      label: 'CVR deterioration',
      currentValue: currentSummary.rates.cvr,
      baselineValue: baselineSummary.rates.cvr,
      thresholdRatio: preset.cvrDropAlertRatio,
      direction: 'higher_better',
      weight: preset.riskWeights.cvrDrop,
      source: 'learned_anchor'
    }),
    buildSignal({
      key: 'cpm',
      label: 'CPM inflation',
      currentValue: currentSummary.rates.cpm,
      baselineValue: baselineSummary.rates.cpm,
      thresholdRatio: preset.cpmRiseAlertRatio,
      direction: 'lower_better',
      weight: preset.riskWeights.cpmRise,
      source: 'learned_anchor'
    }),
    buildSignal({
      key: 'lpvRate',
      label: 'Funnel quality shift',
      currentValue: currentSummary.rates.lpvRate,
      baselineValue: baselineSummary.rates.lpvRate,
      thresholdRatio: preset.lpvRateDropAlertRatio,
      direction: 'higher_better',
      weight: preset.riskWeights.lpvDrop,
      source: 'learned_anchor'
    }),
    buildSignal({
      key: 'ordersPerSpend',
      label: 'Orders per spend drop',
      currentValue: currentSummary.rates.ordersPerSpend,
      baselineValue: baselineSummary.rates.ordersPerSpend,
      thresholdRatio: preset.ordersPerSpendDropAlertRatio,
      direction: 'higher_better',
      weight: preset.riskWeights.ordersYieldDrop,
      source: 'learned_anchor'
    })
  ];

  const weightedRiskScore = riskSignals.reduce(
    (sumValue, signal) => sumValue + (signal.risk * signal.weight),
    0
  );

  const riskScore = round(clamp01(weightedRiskScore) * 100, 1);
  const status = buildSentinelStatus(riskScore, preset);

  const averageShock = mean(currentWindow.map((row) => row?.shocks?.maxZ || 0)) || 0;
  const confidence = estimateModelConfidence({
    signalClicks: currentSummary.totals.clicks,
    minimumClicks: preset.minimumCurrentClicks,
    targetClicks: preset.targetClicksForConfidence,
    currentWindowDays: currentWindow.length,
    expectedWindowDays: preset.currentWindowDays,
    avgShock: averageShock
  });

  const learnedAdjustmentDays = status.code === 'critical'
    ? 0
    : confidence < 0.55
      ? 1
      : 0;

  const decisionWindowDays = preset.policyRecheckWindowDays + learnedAdjustmentDays;

  let decisionAction = 'Maintain settings and monitor';
  if (status.code === 'critical') {
    decisionAction = 'Protect delivery: pause scaling and isolate source of deterioration';
  } else if (status.code === 'watch') {
    decisionAction = 'Hold major budget changes and watch for confirmation';
  }

  return {
    id: 'mature_sentinel',
    name: 'Mature Campaign Sentinel',
    preset: resolvedPresetName,
    status,
    riskScore,
    confidence: round(confidence, 3),
    decisionWindowDays,
    decisionWindowSource: learnedAdjustmentDays > 0 ? 'policy_plus_learning' : 'policy',
    decisionWindowPolicyDays: preset.policyRecheckWindowDays,
    decisionWindowLearningAdjustmentDays: learnedAdjustmentDays,
    summary: `${status.label}: CVR/CPM/quality drift tracked against the anchor window.`,
    action: decisionAction,
    signals: riskSignals
      .sort((left, right) => right.risk - left.risk)
      .map((signal) => ({
        ...signal,
        severity: signal.risk >= 0.7 ? 'high' : signal.risk >= 0.45 ? 'medium' : 'low'
      })),
    policy: {
      warningThreshold: preset.warningThreshold,
      criticalThreshold: preset.criticalThreshold,
      minimumCurrentClicks: preset.minimumCurrentClicks
    },
    evidence: {
      currentWindowDays: currentWindow.length,
      baselineWindowDays: baselineWindow.length,
      currentTotals: currentSummary.totals,
      baselineTotals: baselineSummary.totals,
      averageShockZ: round(averageShock, 4)
    }
  };
}

function calculateSaturationRisk(series) {
  if (!series.length) return 0;

  const cpmValues = series.map((row) => row.cpm);
  const reachValues = series.map((row) => row.reach);
  const cpmBase = mean(cpmValues) || 0;
  const reachBase = mean(reachValues) || 0;

  const cpmSlopeRatio = safeDivide(linearTrendSlope(cpmValues), Math.max(cpmBase, 1), 0);
  const reachSlopeRatio = safeDivide(linearTrendSlope(reachValues), Math.max(reachBase, 1), 0);

  const inflationRisk = clamp01(cpmSlopeRatio * 6);
  const compressionRisk = clamp01((-reachSlopeRatio) * 6);

  return clamp01((inflationRisk * 0.55) + (compressionRisk * 0.45));
}

export function buildHeadroomModel({ analysisSeries, anchorSeries, presetName = 'balanced' }) {
  const { name: resolvedPresetName, config: preset } = resolvePresetOption(HEADROOM_PRESETS, presetName);

  const spendActiveAnalysisSeries = getSpendActiveSeries(analysisSeries);
  const spendActiveAnchorSeries = getSpendActiveSeries(anchorSeries);
  const combinedSeries = [...spendActiveAnchorSeries, ...spendActiveAnalysisSeries];
  const usablePoints = combinedSeries
    .map((row, index) => ({
      date: row.date,
      spend: Number(row.spend) || 0,
      outcome: (Number(row.orders) || Number(row.conversions) || 0),
      index
    }))
    .filter((row) => row.spend >= preset.minSpendPerDay);

  const recencyWeights = buildRecencyWeights(usablePoints.length, 10);
  const regressionPoints = usablePoints.map((point, index) => ({
    x: Math.log(point.spend + 1),
    y: Math.log(point.outcome + 1),
    w: recencyWeights[index] || 1
  }));

  const regression = weightedLinearRegression(regressionPoints);
  const elasticity = clampNumber(regression.slope, 0, 1.4);

  const baselineWindow = getTrailingWindow(spendActiveAnalysisSeries, preset.baselineWindowDays);
  const efficiencySeries = baselineWindow.map((row) => safeDivide((row.orders || row.conversions || 0), Math.max(row.spend, 1), 0));
  const efficiencyBaseline = mean(efficiencySeries) || 0;
  const efficiencyTrend = safeDivide(linearTrendSlope(efficiencySeries), Math.max(efficiencyBaseline, 1e-6), 0);

  const saturationRisk = calculateSaturationRisk(baselineWindow);

  const elasticityBoost = (elasticity - preset.elasticityNeutral) * preset.elasticityToScaleFactor;
  const efficiencyBoost = clampNumber(
    safeDivide(efficiencyTrend, preset.efficiencyTrendForFullBoost, 0) * preset.maxEfficiencyBoostPct,
    -preset.maxEfficiencyBoostPct,
    preset.maxEfficiencyBoostPct
  );

  const safeScaleUpRatio = clampNumber(
    preset.scaleStepPct + elasticityBoost + efficiencyBoost - (saturationRisk * preset.maxSaturationPenaltyPct),
    preset.minScaleUpPct,
    preset.maxScaleUpPct
  );

  const safeScaleDownRatio = clampNumber(
    preset.scaleDownBasePct + (saturationRisk * preset.maxSaturationPenaltyPct) - (efficiencyBoost * 0.5),
    preset.minScaleUpPct,
    preset.maxScaleDownPct
  );

  const headroomScore = round(
    clamp01(
      0.5
      + ((elasticity - preset.elasticityNeutral) * 0.9)
      + (efficiencyBoost * 2)
      - (saturationRisk * 0.9)
    ) * 100,
    1
  );

  const currentSpend = mean(getTrailingWindow(spendActiveAnalysisSeries, preset.baselineWindowDays).map((row) => row.spend)) || 0;
  let suggestedPctChange = 0;
  let status = 'hold';

  if (headroomScore >= preset.highHeadroomScore) {
    suggestedPctChange = safeScaleUpRatio;
    status = 'scale';
  } else if (headroomScore <= preset.lowHeadroomScore) {
    suggestedPctChange = -safeScaleDownRatio;
    status = 'protect';
  }

  const suggestedDailySpend = currentSpend * (1 + suggestedPctChange);
  const safeMinDailySpend = currentSpend * (1 - safeScaleDownRatio);
  const safeMaxDailySpend = currentSpend * (1 + safeScaleUpRatio);

  const confidence = clampNumber(
    0.3
    + (0.25 * clamp01(safeDivide(usablePoints.length, preset.minDataDays, 0)))
    + (0.25 * regression.rSquared)
    + (0.2 * clamp01(safeDivide(currentSpend, preset.minSpendPerDay * 2, 0))),
    0.1,
    0.94
  );

  return {
    id: 'headroom_model',
    name: 'Headroom Model',
    preset: resolvedPresetName,
    status,
    headroomScore,
    confidence: round(confidence, 3),
    summary: 'Safe scale band estimated from spend-to-outcome saturation behavior.',
    recommendation: {
      suggestedPctChange: round(suggestedPctChange, 4),
      suggestedPercent: normalizePercent(suggestedPctChange),
      currentDailySpend: round(currentSpend, 2),
      suggestedDailySpend: round(suggestedDailySpend, 2),
      safeDailySpendMin: round(safeMinDailySpend, 2),
      safeDailySpendMax: round(safeMaxDailySpend, 2)
    },
    diagnostics: {
      elasticity: round(elasticity, 4),
      fitQualityR2: round(regression.rSquared, 4),
      saturationRisk: round(saturationRisk, 4),
      efficiencyTrendRatio: round(efficiencyTrend, 4),
      usableDataDays: usablePoints.length,
      minimumDataDays: preset.minDataDays
    },
    policy: {
      minSpendPerDay: preset.minSpendPerDay,
      maxScaleUpPercent: normalizePercent(preset.maxScaleUpPct),
      maxScaleDownPercent: normalizePercent(preset.maxScaleDownPct)
    }
  };
}

function samplePosteriorIntervals({ alpha, beta, sampleCount, rng }) {
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    samples.push(sampleBeta(alpha, beta, rng));
  }
  return {
    mean: mean(samples) || 0,
    p05: percentile(samples, 0.05) || 0,
    p95: percentile(samples, 0.95) || 0,
    samples
  };
}

function inferDefaultAov(store, series) {
  const totalRevenue = sum(series.map((row) => row.revenue));
  const totalOrders = sum(series.map((row) => row.orders));
  if (totalOrders > 0 && totalRevenue > 0) {
    return totalRevenue / totalOrders;
  }
  return STORE_DEFAULT_AOV[store] || STORE_DEFAULT_AOV.vironax;
}

function classifyLaunchStatus({ probabilityHitCpa, probabilityHitRoas, cvrDropProbability, preset }) {
  const failThreshold = preset.failProbabilityThreshold;
  const winnerThreshold = preset.winnerProbabilityThreshold;

  if (
    probabilityHitCpa < failThreshold
    && probabilityHitRoas < failThreshold
    && cvrDropProbability > 0.5
  ) {
    return 'likely_fail';
  }

  if (
    probabilityHitCpa >= winnerThreshold
    && probabilityHitRoas >= winnerThreshold
    && cvrDropProbability < 0.4
  ) {
    return 'likely_winner';
  }

  return 'continue_testing';
}

export function buildLaunchJudgeModel({
  analysisSeries,
  baselineSeries,
  store,
  presetName = 'balanced',
  launchMinDays,
  launchMaxDays,
  targetRoas,
  targetCpa,
  targetHorizonDays,
  seedKey = ''
}) {
  const { name: resolvedPresetName, config: preset } = resolvePresetOption(LAUNCH_PRESETS, presetName);
  const effectiveMinDays = clampInt(launchMinDays, 2, 14, preset.minTrialDays);
  const effectiveMaxDays = clampInt(launchMaxDays, effectiveMinDays, 14, preset.maxTrialDays);

  const activeRows = analysisSeries.filter((row) => (row.spend || 0) > 0);
  const observedRows = getTrailingWindow(activeRows, effectiveMaxDays);
  const observedDays = observedRows.length;

  const trialSummary = summarizeSeriesWindow(observedRows);
  const baselineSummary = summarizeSeriesWindow(baselineSeries.length ? baselineSeries : analysisSeries);

  const baselineCtr = Math.max(baselineSummary.rates.ctr || 0.005, 0.0001);
  const baselineCvr = Math.max(baselineSummary.rates.cvr || 0.01, 0.0001);

  const priorCtrAlpha = (baselineCtr * preset.priorPseudoImpressions) + 1;
  const priorCtrBeta = ((1 - baselineCtr) * preset.priorPseudoImpressions) + 1;
  const posteriorCtrAlpha = priorCtrAlpha + trialSummary.totals.clicks;
  const posteriorCtrBeta = priorCtrBeta + Math.max(trialSummary.totals.impressions - trialSummary.totals.clicks, 0);

  const priorCvrAlpha = (baselineCvr * preset.priorPseudoClicks) + 1;
  const priorCvrBeta = ((1 - baselineCvr) * preset.priorPseudoClicks) + 1;
  const posteriorCvrAlpha = priorCvrAlpha + trialSummary.totals.conversions;
  const posteriorCvrBeta = priorCvrBeta + Math.max(trialSummary.totals.clicks - trialSummary.totals.conversions, 0);

  const seed = hashStringToSeed(`${seedKey}:${store}:${resolvedPresetName}:${observedRows[0]?.date || 'none'}:${observedRows.length}`) + MONTE_CARLO_CONFIG.randomSeedSalt;
  const rng = createSeededRng(seed);

  const ctrPosterior = samplePosteriorIntervals({
    alpha: posteriorCtrAlpha,
    beta: posteriorCtrBeta,
    sampleCount: MONTE_CARLO_CONFIG.betaSamples,
    rng
  });

  const cvrPosterior = samplePosteriorIntervals({
    alpha: posteriorCvrAlpha,
    beta: posteriorCvrBeta,
    sampleCount: MONTE_CARLO_CONFIG.betaSamples,
    rng
  });

  const ctrDropFloor = baselineCtr * (1 - preset.cvrDropThreshold);
  const cvrDropFloor = baselineCvr * (1 - preset.cvrDropThreshold);

  const ctrDropProbability = safeDivide(
    ctrPosterior.samples.filter((value) => value < ctrDropFloor).length,
    ctrPosterior.samples.length,
    0
  );

  const cvrDropProbability = safeDivide(
    cvrPosterior.samples.filter((value) => value < cvrDropFloor).length,
    cvrPosterior.samples.length,
    0
  );

  const aov = inferDefaultAov(store, observedRows);
  const effectiveTargetRoas = clampNumber(targetRoas || 4, 0.5, 20);
  const derivedTargetCpa = targetCpa || safeDivide(aov, effectiveTargetRoas, aov / 4);
  const effectiveTargetCpa = clampNumber(derivedTargetCpa, 1, 10000);
  const effectiveHorizonDays = clampInt(targetHorizonDays, 4, 14, 7);

  const remainingDays = Math.max(0, effectiveHorizonDays - observedDays);
  const observedOrders = trialSummary.totals.orders;
  const observedSpend = trialSummary.totals.spend;
  const observedRevenue = trialSummary.totals.revenue;
  const observedDailySpend = safeDivide(observedSpend, Math.max(observedDays, 1), 0);

  const baselineOrderRate = safeDivide(
    baselineSummary.totals.orders,
    Math.max(baselineSummary.days, 1),
    0.2
  );

  const priorShape = Math.max(0.25, (baselineOrderRate * preset.orderPriorStrength) + 0.1);
  const priorRate = Math.max(0.2, preset.orderPriorStrength);
  const posteriorShape = priorShape + observedOrders;
  const posteriorRate = priorRate + observedDays;

  let hitCpaCount = 0;
  let hitRoasCount = 0;

  for (let index = 0; index < MONTE_CARLO_CONFIG.orderSamples; index += 1) {
    const orderRatePerDay = sampleGamma(posteriorShape, 1 / posteriorRate, rng);
    const projectedOrders = observedOrders + samplePoisson(orderRatePerDay * remainingDays, rng);
    const projectedSpend = observedSpend + (observedDailySpend * remainingDays);
    const projectedRevenue = observedRevenue > 0
      ? (projectedOrders * safeDivide(observedRevenue, Math.max(observedOrders, 1), aov))
      : (projectedOrders * aov);

    const projectedCpa = safeDivide(projectedSpend, Math.max(projectedOrders, 1), Number.POSITIVE_INFINITY);
    const projectedRoas = safeDivide(projectedRevenue, projectedSpend, 0);

    if (projectedCpa <= (effectiveTargetCpa * preset.cpaGuardrailMultiplier)) {
      hitCpaCount += 1;
    }
    if (projectedRoas >= (effectiveTargetRoas * preset.roasGuardrailMultiplier)) {
      hitRoasCount += 1;
    }
  }

  const probabilityHitCpa = safeDivide(hitCpaCount, MONTE_CARLO_CONFIG.orderSamples, 0);
  const probabilityHitRoas = safeDivide(hitRoasCount, MONTE_CARLO_CONFIG.orderSamples, 0);

  const status = classifyLaunchStatus({
    probabilityHitCpa,
    probabilityHitRoas,
    cvrDropProbability,
    preset
  });

  const confidence = clampNumber(
    0.25
    + (0.25 * clamp01(safeDivide(trialSummary.totals.clicks, preset.minTrialClicks, 0)))
    + (0.2 * clamp01(safeDivide(trialSummary.totals.spend, preset.minTrialSpend, 0)))
    + (0.3 * clamp01(safeDivide(observedDays, effectiveMinDays, 0))),
    0.08,
    0.95
  );

  return {
    id: 'launch_judge',
    name: 'Launch Judge',
    preset: resolvedPresetName,
    status,
    confidence: round(confidence, 3),
    summary: 'Bayesian trial assessment for early winner/fail classification.',
    trialWindow: {
      minDays: effectiveMinDays,
      maxDays: effectiveMaxDays,
      observedDays,
      source: (launchMinDays || launchMaxDays) ? 'advanced_override' : 'preset'
    },
    targets: {
      targetRoas: round(effectiveTargetRoas, 3),
      targetCpa: round(effectiveTargetCpa, 2),
      targetHorizonDays: effectiveHorizonDays
    },
    probabilities: {
      hitTargetCpa: round(probabilityHitCpa, 4),
      hitTargetRoas: round(probabilityHitRoas, 4),
      ctrDropBeyondThreshold: round(ctrDropProbability, 4),
      cvrDropBeyondThreshold: round(cvrDropProbability, 4)
    },
    posterior: {
      ctrMean: round(ctrPosterior.mean, 6),
      ctrInterval: [round(ctrPosterior.p05, 6), round(ctrPosterior.p95, 6)],
      cvrMean: round(cvrPosterior.mean, 6),
      cvrInterval: [round(cvrPosterior.p05, 6), round(cvrPosterior.p95, 6)]
    },
    evidence: {
      observedClicks: trialSummary.totals.clicks,
      observedImpressions: trialSummary.totals.impressions,
      observedConversions: trialSummary.totals.conversions,
      observedOrders: trialSummary.totals.orders,
      observedSpend: round(observedSpend, 2),
      baselineCtr: round(baselineCtr, 6),
      baselineCvr: round(baselineCvr, 6)
    },
    policy: {
      minTrialClicks: preset.minTrialClicks,
      minTrialSpend: preset.minTrialSpend,
      failProbabilityThreshold: preset.failProbabilityThreshold,
      winnerProbabilityThreshold: preset.winnerProbabilityThreshold
    }
  };
}

function calibrateModel({ model, evidenceVolume, volatilityScore }) {
  const evidenceBoost = clamp01(safeDivide(evidenceVolume, CONFIDENCE_CALIBRATION.evidenceForFullBoost, 0));
  const volatilityPenalty = clamp01(volatilityScore) * CONFIDENCE_CALIBRATION.volatilityPenaltyScale;

  const reliability = clampNumber(
    CONFIDENCE_CALIBRATION.minimumReliability
    + (model.confidence * (CONFIDENCE_CALIBRATION.maximumReliability - CONFIDENCE_CALIBRATION.minimumReliability))
    + (evidenceBoost * CONFIDENCE_CALIBRATION.evidenceBoostScale)
    - CONFIDENCE_CALIBRATION.baselineUncertainty
    - volatilityPenalty,
    CONFIDENCE_CALIBRATION.minimumReliability,
    CONFIDENCE_CALIBRATION.maximumReliability
  );

  const calibrationError = clampNumber(
    CONFIDENCE_CALIBRATION.baselineUncertainty + volatilityPenalty - (evidenceBoost * 0.08),
    0.02,
    0.35
  );

  return {
    modelId: model.id,
    reliability: round(reliability, 4),
    calibrationError: round(calibrationError, 4),
    reliabilityBand: [
      round(clampNumber(reliability - calibrationError, 0, 1), 4),
      round(clampNumber(reliability + calibrationError, 0, 1), 4)
    ]
  };
}

export function buildCalibrationLayer({ models, series }) {
  const evidenceVolume = sum(series.map((row) => row.impressions));
  const volatilityScore = clamp01((mean(series.map((row) => row?.shocks?.maxZ || 0)) || 0) / SHOCK_FILTER_CONFIG.severeShockZ);

  const perModel = models.map((model) => calibrateModel({
    model,
    evidenceVolume,
    volatilityScore
  }));

  const aggregateReliability = mean(perModel.map((entry) => entry.reliability)) || CONFIDENCE_CALIBRATION.minimumReliability;
  const aggregateError = mean(perModel.map((entry) => entry.calibrationError)) || CONFIDENCE_CALIBRATION.baselineUncertainty;

  return {
    id: 'calibration_layer',
    name: 'Calibration Layer',
    reliability: round(aggregateReliability, 4),
    calibrationError: round(aggregateError, 4),
    reliabilityBand: [
      round(clampNumber(aggregateReliability - aggregateError, 0, 1), 4),
      round(clampNumber(aggregateReliability + aggregateError, 0, 1), 4)
    ],
    summary: `Confidence reliability centers around ${normalizePercent(aggregateReliability)}% with ~${normalizePercent(aggregateError)}% expected calibration error.`,
    perModel
  };
}

export function buildTopDrivers(models) {
  const driverRows = [];

  for (const model of models) {
    if (Array.isArray(model.signals)) {
      for (const signal of model.signals) {
        driverRows.push({
          modelId: model.id,
          modelName: model.name,
          label: signal.label,
          impact: signal.weightedImpact || 0,
          deltaPercent: signal.deltaPercent || 0,
          severity: signal.severity || 'medium',
          source: signal.source || 'learned_anchor'
        });
      }
    }

    if (model.id === 'headroom_model') {
      driverRows.push({
        modelId: model.id,
        modelName: model.name,
        label: 'Elasticity',
        impact: normalizePercent(model.diagnostics?.elasticity || 0) * 0.2,
        deltaPercent: normalizePercent(model.recommendation?.suggestedPctChange || 0),
        severity: model.status === 'protect' ? 'high' : model.status === 'scale' ? 'low' : 'medium',
        source: 'learned_fit'
      });
    }

    if (model.id === 'launch_judge') {
      driverRows.push({
        modelId: model.id,
        modelName: model.name,
        label: 'Hit target ROAS probability',
        impact: normalizePercent(model.probabilities?.hitTargetRoas || 0),
        deltaPercent: normalizePercent((model.probabilities?.hitTargetRoas || 0) - 0.5),
        severity: model.status === 'likely_fail' ? 'high' : model.status === 'likely_winner' ? 'low' : 'medium',
        source: 'bayesian_posterior'
      });
    }
  }

  return driverRows
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    .slice(0, 10)
    .map((entry) => ({
      ...entry,
      impact: round(entry.impact, 2),
      deltaPercent: round(entry.deltaPercent, 2)
    }));
}

function countActiveSpendDays(series) {
  return series.filter((row) => (Number(row?.spend) || 0) > 0).length;
}

function evaluateLaunchJudgeEligibility({ analysisSeries, launchJudge }) {
  const activeSpendDays = countActiveSpendDays(analysisSeries);
  const maxTrialDays = Math.max(
    Number(launchJudge?.trialWindow?.maxDays) || 0,
    Number(launchJudge?.trialWindow?.minDays) || 0
  );

  const eligible = maxTrialDays > 0 && activeSpendDays <= maxTrialDays;

  return {
    eligible,
    activeSpendDays,
    maxTrialDays,
    reason: eligible
      ? 'fresh_campaign_window'
      : 'outside_launch_window'
  };
}

export function buildModelBundle({
  analysisSeries,
  anchorSeries,
  baselineSeries,
  store,
  sentinelPreset,
  headroomPreset,
  launchPreset,
  launchMinDays,
  launchMaxDays,
  targetRoas,
  targetCpa,
  targetHorizonDays,
  seedKey
}) {
  const spendActiveAnalysisSeries = getSpendActiveSeries(analysisSeries);
  const spendActiveAnchorSeries = getSpendActiveSeries(anchorSeries);
  const spendActiveBaselineSeries = getSpendActiveSeries(baselineSeries);

  const sentinel = buildMatureSentinelModel({
    analysisSeries: spendActiveAnalysisSeries.length ? spendActiveAnalysisSeries : analysisSeries,
    anchorSeries: spendActiveAnchorSeries.length ? spendActiveAnchorSeries : anchorSeries,
    presetName: sentinelPreset
  });

  const headroom = buildHeadroomModel({
    analysisSeries: spendActiveAnalysisSeries.length ? spendActiveAnalysisSeries : analysisSeries,
    anchorSeries: spendActiveAnchorSeries.length ? spendActiveAnchorSeries : anchorSeries,
    presetName: headroomPreset
  });

  const launchJudge = buildLaunchJudgeModel({
    analysisSeries: spendActiveAnalysisSeries.length ? spendActiveAnalysisSeries : analysisSeries,
    baselineSeries: spendActiveBaselineSeries.length ? spendActiveBaselineSeries : baselineSeries,
    store,
    presetName: launchPreset,
    launchMinDays,
    launchMaxDays,
    targetRoas,
    targetCpa,
    targetHorizonDays,
    seedKey
  });

  const launchJudgeEligibility = evaluateLaunchJudgeEligibility({
    analysisSeries: spendActiveAnalysisSeries.length ? spendActiveAnalysisSeries : analysisSeries,
    launchJudge
  });
  const scopedLaunchJudge = launchJudgeEligibility.eligible ? launchJudge : null;
  const modelList = [sentinel, headroom, scopedLaunchJudge].filter(Boolean);
  const calibration = buildCalibrationLayer({
    models: modelList,
    series: spendActiveAnalysisSeries.length ? spendActiveAnalysisSeries : analysisSeries
  });

  return {
    sentinel,
    headroom,
    launchJudge: scopedLaunchJudge,
    launchJudgeEligibility,
    calibration,
    topDrivers: buildTopDrivers(modelList)
  };
}
