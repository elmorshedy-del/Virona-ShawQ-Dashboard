import assert from 'assert/strict';
import {
  buildBudgetChangeMonitor,
  buildModelBundle,
  buildShockAwareSeries
} from '../services/campaignIntelligence/models.js';

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildDailyRow({
  date,
  spend,
  impressions,
  reach,
  clicks,
  conversions,
  orders,
  revenuePerOrder
}) {
  const landingPageViews = clicks * 0.76;
  const revenue = orders * revenuePerOrder;

  return {
    date,
    spend,
    impressions,
    reach,
    clicks,
    landingPageViews,
    addToCart: conversions * 2.1,
    checkoutsInitiated: conversions * 1.45,
    conversions,
    conversionValue: revenue,
    orders,
    revenue,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cvr: clicks > 0 ? conversions / clicks : 0,
    cpm: impressions > 0 ? (spend * 1000) / impressions : 0,
    lpvRate: clicks > 0 ? landingPageViews / clicks : 0,
    frequency: reach > 0 ? impressions / reach : 0,
    ordersPerSpend: spend > 0 ? orders / spend : 0
  };
}

function buildWindow({
  startDate,
  days,
  spend,
  impressions,
  reach,
  clicks,
  conversions,
  orders,
  revenuePerOrder,
  ramp = 0,
  volatility = 0
}) {
  const rows = [];

  for (let index = 0; index < days; index += 1) {
    const date = addDays(startDate, index);
    const rampFactor = 1 + (ramp * index);
    const wave = volatility === 0 ? 1 : 1 + (Math.sin(index / 2) * volatility);

    rows.push(buildDailyRow({
      date,
      spend: spend * rampFactor * wave,
      impressions: impressions * rampFactor,
      reach: reach * rampFactor,
      clicks: clicks * rampFactor,
      conversions: conversions * rampFactor * wave,
      orders: orders * rampFactor * wave,
      revenuePerOrder
    }));
  }

  return rows;
}

function runScenario({
  name,
  store,
  anchorRows,
  analysisRows,
  budgetHistoryEvents = [],
  expected
}) {
  const shockAwareAnchor = buildShockAwareSeries(anchorRows);
  const shockAwareAnalysis = buildShockAwareSeries(analysisRows);

  const modelBundle = buildModelBundle({
    analysisSeries: shockAwareAnalysis,
    anchorSeries: shockAwareAnchor,
    baselineSeries: shockAwareAnchor,
    store,
    sentinelPreset: 'balanced',
    headroomPreset: 'balanced',
    launchPreset: 'balanced',
    launchMinDays: null,
    launchMaxDays: null,
    targetRoas: 4,
    targetCpa: null,
    targetHorizonDays: 7,
    seedKey: `qc-${name}`
  });

  const monitor = buildBudgetChangeMonitor(shockAwareAnalysis, budgetHistoryEvents);

  assert(Number.isFinite(modelBundle.sentinel.riskScore), `${name}: sentinel risk score should be finite`);
  assert(Number.isFinite(modelBundle.headroom.headroomScore), `${name}: headroom score should be finite`);
  assert(modelBundle.launchJudgeEligibility, `${name}: launch judge eligibility should exist`);
  if (modelBundle.launchJudge) {
    assert(modelBundle.launchJudge.status, `${name}: launch judge status should exist when eligible`);
  }
  assert(modelBundle.calibration.reliabilityBand.length === 2, `${name}: calibration band should be available`);

  if (expected?.minSentinelRisk != null) {
    assert(
      modelBundle.sentinel.riskScore >= expected.minSentinelRisk,
      `${name}: expected sentinel risk >= ${expected.minSentinelRisk}, got ${modelBundle.sentinel.riskScore}`
    );
  }

  if (expected?.maxSentinelRisk != null) {
    assert(
      modelBundle.sentinel.riskScore <= expected.maxSentinelRisk,
      `${name}: expected sentinel risk <= ${expected.maxSentinelRisk}, got ${modelBundle.sentinel.riskScore}`
    );
  }

  if (expected?.requiresMonitorEvent) {
    assert(monitor.hasEvent, `${name}: expected budget change monitor to detect a shift event`);
  }

  if (expected?.minRoasProbability != null) {
    assert(modelBundle.launchJudge, `${name}: launch judge should be present for ROAS probability assertions`);
    assert(
      modelBundle.launchJudge.probabilities.hitTargetRoas >= expected.minRoasProbability,
      `${name}: expected ROAS hit probability >= ${expected.minRoasProbability}, got ${modelBundle.launchJudge.probabilities.hitTargetRoas}`
    );
  }

  if (expected?.statusIncludes?.length) {
    assert(modelBundle.launchJudge, `${name}: launch judge should be present for launch status assertions`);
    assert(
      expected.statusIncludes.includes(modelBundle.launchJudge.status),
      `${name}: expected launch status in ${expected.statusIncludes.join(', ')}, got ${modelBundle.launchJudge.status}`
    );
  }

  return {
    name,
    sentinelRisk: modelBundle.sentinel.riskScore,
    headroomScore: modelBundle.headroom.headroomScore,
    launchStatus: modelBundle.launchJudge?.status || 'not_eligible',
    roasHitProbability: modelBundle.launchJudge?.probabilities?.hitTargetRoas ?? null,
    launchEligible: modelBundle.launchJudgeEligibility?.eligible || false,
    monitorDetected: monitor.hasEvent
  };
}

function buildScenarios() {
  const stableAnchor = buildWindow({
    startDate: '2026-01-01',
    days: 21,
    spend: 1000,
    impressions: 120000,
    reach: 62000,
    clicks: 1850,
    conversions: 74,
    orders: 70,
    revenuePerOrder: 85,
    ramp: 0,
    volatility: 0.02
  });

  const stableAnalysis = buildWindow({
    startDate: '2026-01-22',
    days: 14,
    spend: 1025,
    impressions: 122000,
    reach: 62800,
    clicks: 1880,
    conversions: 73,
    orders: 71,
    revenuePerOrder: 86,
    ramp: 0.002,
    volatility: 0.02
  });

  const deteriorationAnchor = stableAnchor;
  const deteriorationAnalysis = [
    ...buildWindow({
      startDate: '2026-01-22',
      days: 7,
      spend: 1020,
      impressions: 121000,
      reach: 63000,
      clicks: 1870,
      conversions: 74,
      orders: 70,
      revenuePerOrder: 85,
      volatility: 0.01
    }),
    ...buildWindow({
      startDate: '2026-01-29',
      days: 7,
      spend: 1450,
      impressions: 120500,
      reach: 59000,
      clicks: 1960,
      conversions: 39,
      orders: 34,
      revenuePerOrder: 84,
      volatility: 0.02
    })
  ];

  const launchAnchor = buildWindow({
    startDate: '2026-01-01',
    days: 21,
    spend: 520,
    impressions: 76000,
    reach: 42000,
    clicks: 940,
    conversions: 22,
    orders: 20,
    revenuePerOrder: 82,
    volatility: 0.02
  });

  const launchAnalysis = buildWindow({
    startDate: '2026-01-22',
    days: 5,
    spend: 680,
    impressions: 84000,
    reach: 46000,
    clicks: 2200,
    conversions: 130,
    orders: 118,
    revenuePerOrder: 87,
    ramp: 0.01,
    volatility: 0.015
  });

  return [
    {
      name: 'stable-regime',
      store: 'shawq',
      anchorRows: stableAnchor,
      analysisRows: stableAnalysis,
      expected: {
        maxSentinelRisk: 45
      }
    },
    {
      name: 'deterioration-after-scale',
      store: 'shawq',
      anchorRows: deteriorationAnchor,
      analysisRows: deteriorationAnalysis,
      budgetHistoryEvents: [
        {
          pivotDate: '2026-01-29',
          eventTime: '2026-01-29T09:00:00Z',
          fromBudget: 1020,
          toBudget: 1450,
          source: 'meta_history'
        }
      ],
      expected: {
        minSentinelRisk: 55,
        requiresMonitorEvent: true
      }
    },
    {
      name: 'launch-winner-trial',
      store: 'shawq',
      anchorRows: launchAnchor,
      analysisRows: launchAnalysis,
      expected: {
        minRoasProbability: 0.55,
        statusIncludes: ['likely_winner', 'continue_testing']
      }
    }
  ];
}

function main() {
  const scenarios = buildScenarios();
  const outputs = scenarios.map((scenario) => runScenario(scenario));

  console.log('\n[Campaign Intelligence QC] Simulation results');
  outputs.forEach((output) => {
    console.log(`- ${output.name}`);
    console.log(`  sentinel_risk: ${output.sentinelRisk}`);
    console.log(`  headroom_score: ${output.headroomScore}`);
    console.log(`  launch_status: ${output.launchStatus}`);
    console.log(`  roas_hit_probability: ${output.roasHitProbability}`);
    console.log(`  monitor_detected: ${output.monitorDetected}`);
  });
  console.log(`\n[Campaign Intelligence QC] ${outputs.length} simulations passed.`);
}

main();
