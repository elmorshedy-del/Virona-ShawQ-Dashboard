export const SUPPORTED_STORES = new Set(['vironax', 'shawq']);
export const SUPPORTED_LEVELS = new Set(['campaign', 'adset', 'ad']);

export const LEVEL_CONFIG = Object.freeze({
  campaign: Object.freeze({
    table: 'meta_daily_metrics',
    idColumn: 'campaign_id',
    nameColumn: 'campaign_name',
    label: 'Campaign'
  }),
  adset: Object.freeze({
    table: 'meta_adset_metrics',
    idColumn: 'adset_id',
    nameColumn: 'adset_name',
    label: 'Ad Set'
  }),
  ad: Object.freeze({
    table: 'meta_ad_metrics',
    idColumn: 'ad_id',
    nameColumn: 'ad_name',
    label: 'Ad'
  })
});

export const STORE_DEFAULT_AOV = Object.freeze({
  vironax: 280,
  shawq: 75
});

export const QUERY_LIMITS = Object.freeze({
  minAnalysisWindowDays: 7,
  maxAnalysisWindowDays: 120,
  minAnchorWindowDays: 7,
  maxAnchorWindowDays: 120,
  minBeforeAfterWindowDays: 2,
  maxBeforeAfterWindowDays: 7,
  minTargetRoas: 0.5,
  maxTargetRoas: 20,
  minTargetCpa: 1,
  maxTargetCpa: 10000,
  minTargetHorizonDays: 4,
  maxTargetHorizonDays: 14,
  minLaunchWindowDays: 2,
  maxLaunchWindowDays: 14,
  maxSelectorOptions: 160
});

export const DEFAULT_SETTINGS = Object.freeze({
  defaultStore: 'vironax',
  defaultLevel: 'campaign',
  defaultCountry: 'ALL',
  analysisWindowDays: 35,
  anchorWindowDays: 21,
  beforeAfterWindowDays: 3,
  targetRoas: 4,
  targetHorizonDays: 7,
  selectorLimit: 80,
  defaultPreset: 'balanced'
});

export const MODEL_PRESET_OPTIONS = new Set(['conservative', 'balanced', 'aggressive']);

export const SENTINEL_PRESETS = Object.freeze({
  conservative: Object.freeze({
    currentWindowDays: 4,
    policyRecheckWindowDays: 3,
    cvrDropAlertRatio: 0.2,
    cpmRiseAlertRatio: 0.18,
    lpvRateDropAlertRatio: 0.16,
    ordersPerSpendDropAlertRatio: 0.2,
    warningThreshold: 42,
    criticalThreshold: 62,
    minimumCurrentClicks: 150,
    targetClicksForConfidence: 700,
    riskWeights: Object.freeze({
      cvrDrop: 0.34,
      cpmRise: 0.23,
      lpvDrop: 0.2,
      ordersYieldDrop: 0.23
    })
  }),
  balanced: Object.freeze({
    currentWindowDays: 3,
    policyRecheckWindowDays: 2,
    cvrDropAlertRatio: 0.16,
    cpmRiseAlertRatio: 0.14,
    lpvRateDropAlertRatio: 0.12,
    ordersPerSpendDropAlertRatio: 0.16,
    warningThreshold: 36,
    criticalThreshold: 56,
    minimumCurrentClicks: 120,
    targetClicksForConfidence: 550,
    riskWeights: Object.freeze({
      cvrDrop: 0.36,
      cpmRise: 0.22,
      lpvDrop: 0.2,
      ordersYieldDrop: 0.22
    })
  }),
  aggressive: Object.freeze({
    currentWindowDays: 2,
    policyRecheckWindowDays: 1,
    cvrDropAlertRatio: 0.12,
    cpmRiseAlertRatio: 0.1,
    lpvRateDropAlertRatio: 0.1,
    ordersPerSpendDropAlertRatio: 0.12,
    warningThreshold: 30,
    criticalThreshold: 48,
    minimumCurrentClicks: 90,
    targetClicksForConfidence: 420,
    riskWeights: Object.freeze({
      cvrDrop: 0.39,
      cpmRise: 0.22,
      lpvDrop: 0.18,
      ordersYieldDrop: 0.21
    })
  })
});

export const HEADROOM_PRESETS = Object.freeze({
  conservative: Object.freeze({
    minSpendPerDay: 120,
    minDataDays: 14,
    baselineWindowDays: 7,
    scaleStepPct: 0.08,
    maxScaleUpPct: 0.22,
    minScaleUpPct: 0.03,
    scaleDownBasePct: 0.12,
    maxScaleDownPct: 0.32,
    elasticityNeutral: 0.62,
    elasticityToScaleFactor: 0.35,
    efficiencyTrendForFullBoost: 0.2,
    maxEfficiencyBoostPct: 0.08,
    maxSaturationPenaltyPct: 0.15,
    highHeadroomScore: 62,
    lowHeadroomScore: 44
  }),
  balanced: Object.freeze({
    minSpendPerDay: 80,
    minDataDays: 10,
    baselineWindowDays: 6,
    scaleStepPct: 0.12,
    maxScaleUpPct: 0.3,
    minScaleUpPct: 0.04,
    scaleDownBasePct: 0.1,
    maxScaleDownPct: 0.28,
    elasticityNeutral: 0.58,
    elasticityToScaleFactor: 0.42,
    efficiencyTrendForFullBoost: 0.18,
    maxEfficiencyBoostPct: 0.1,
    maxSaturationPenaltyPct: 0.16,
    highHeadroomScore: 58,
    lowHeadroomScore: 42
  }),
  aggressive: Object.freeze({
    minSpendPerDay: 60,
    minDataDays: 8,
    baselineWindowDays: 5,
    scaleStepPct: 0.15,
    maxScaleUpPct: 0.4,
    minScaleUpPct: 0.05,
    scaleDownBasePct: 0.08,
    maxScaleDownPct: 0.24,
    elasticityNeutral: 0.54,
    elasticityToScaleFactor: 0.5,
    efficiencyTrendForFullBoost: 0.14,
    maxEfficiencyBoostPct: 0.12,
    maxSaturationPenaltyPct: 0.2,
    highHeadroomScore: 54,
    lowHeadroomScore: 38
  })
});

export const LAUNCH_PRESETS = Object.freeze({
  conservative: Object.freeze({
    minTrialDays: 5,
    maxTrialDays: 8,
    minTrialClicks: 220,
    minTrialSpend: 450,
    priorPseudoImpressions: 900,
    priorPseudoClicks: 260,
    orderPriorStrength: 2.2,
    failProbabilityThreshold: 0.28,
    winnerProbabilityThreshold: 0.72,
    cvrDropThreshold: 0.18,
    cpaGuardrailMultiplier: 0.9,
    roasGuardrailMultiplier: 1.02
  }),
  balanced: Object.freeze({
    minTrialDays: 4,
    maxTrialDays: 6,
    minTrialClicks: 170,
    minTrialSpend: 320,
    priorPseudoImpressions: 700,
    priorPseudoClicks: 200,
    orderPriorStrength: 1.8,
    failProbabilityThreshold: 0.34,
    winnerProbabilityThreshold: 0.66,
    cvrDropThreshold: 0.15,
    cpaGuardrailMultiplier: 1,
    roasGuardrailMultiplier: 1
  }),
  aggressive: Object.freeze({
    minTrialDays: 3,
    maxTrialDays: 5,
    minTrialClicks: 130,
    minTrialSpend: 220,
    priorPseudoImpressions: 520,
    priorPseudoClicks: 150,
    orderPriorStrength: 1.4,
    failProbabilityThreshold: 0.4,
    winnerProbabilityThreshold: 0.6,
    cvrDropThreshold: 0.12,
    cpaGuardrailMultiplier: 1.07,
    roasGuardrailMultiplier: 0.95
  })
});

export const SHOCK_FILTER_CONFIG = Object.freeze({
  windowDays: 7,
  minimumBaselinePoints: 3,
  zTolerance: 2.2,
  baseAlpha: 0.42,
  minAlpha: 0.1,
  dampingFactor: 0.85,
  epsilon: 1e-6,
  scaleFallbacks: Object.freeze({
    reach: 300,
    ctr: 0.001,
    spend: 120,
    orders: 2
  }),
  severeShockZ: 3.2
});

export const BUDGET_MONITOR_CONFIG = Object.freeze({
  preWindowDays: 3,
  postWindowDays: 3,
  minBaselineSpend: 150,
  minShiftRatio: 0.3,
  monitorLookbackDays: 21,
  historyMaxEvents: 24,
  historyFetchPageLimit: 100,
  historyFetchMaxPages: 6,
  historyRequestTimeoutMs: 12000,
  historyCacheTtlMinutes: 10,
  historyCacheMaxEntries: 30,
  dashboardDayUtcOffsetMinutes: 300,
  deltaTiers: Object.freeze({
    strong: 0.22,
    medium: 0.12,
    mild: 0.05
  })
});

export const LEARNING_STATE_CONFIG = Object.freeze({
  ewmaAlpha: 0.35,
  minimumPointsForPersistence: 3
});

export const METRIC_DIRECTION = Object.freeze({
  spend: 'neutral',
  reach: 'higher_better',
  ctr: 'higher_better',
  cvr: 'higher_better',
  cpm: 'lower_better',
  orders: 'higher_better',
  lpvRate: 'higher_better'
});

export const SHIFT_INTENT = Object.freeze({
  strong_improvement: 'strong_improvement',
  improvement: 'improvement',
  slight_improvement: 'slight_improvement',
  neutral: 'neutral',
  slight_decline: 'slight_decline',
  decline: 'decline',
  strong_decline: 'strong_decline',
  info: 'info'
});

export const EDUCATION_SECTIONS = Object.freeze([
  Object.freeze({
    modelId: 'mature_sentinel',
    title: 'Mature Campaign Sentinel',
    basics: [
      'Compares your latest days against a recent anchor window and watches CVR, CPM, reach quality, and orders per spend.',
      'Returns a risk score, confidence, and a short watch window so you know when to re-check.',
      'Uses shock-aware smoothing so single abnormal days do not over-steer the signal.'
    ],
    policyVsLearning: [
      'Policy: risk thresholds, minimum evidence, and re-check window defaults from your selected preset.',
      'Anchored: baseline comes from your selected anchor window and geo scope.',
      'Learns over time: moving baseline, adaptive smoothing weights, and trend deltas update as new days arrive.'
    ]
  }),
  Object.freeze({
    modelId: 'headroom_model',
    title: 'Headroom Model',
    basics: [
      'Fits diminishing-return behavior between spend and outcomes to estimate a safe scale band.',
      'Outputs a suggested daily spend range and whether conditions support scaling or protection.',
      'Balances elasticity, efficiency trend, and saturation pressure so it is not a single-metric rule.'
    ],
    policyVsLearning: [
      'Policy: min data depth, max scale step, and safety penalties by preset.',
      'Anchored: baseline windows and current spend context come from your selected dates/geo.',
      'Learns over time: elasticity and efficiency trend refresh as new spend/outcome points arrive.'
    ]
  }),
  Object.freeze({
    modelId: 'launch_judge',
    title: 'Launch Judge (4-5 day trials)',
    basics: [
      'Uses Bayesian CTR/CVR and order-rate forecasting to classify trial campaigns early.',
      'Outputs chance to hit target CPA and ROAS by the chosen horizon with a status label.',
      'Designed for low-data windows, so it avoids overreacting to single-day swings.'
    ],
    policyVsLearning: [
      'Policy: trial-day bounds, minimum evidence, and winner/fail cutoffs from preset + your advanced overrides.',
      'Anchored: priors are anchored to your recent baseline window and selected geo scope.',
      'Learns over time: posterior probabilities and order-rate forecasts update with each new day.'
    ]
  }),
  Object.freeze({
    modelId: 'calibration_layer',
    title: 'Calibration Layer',
    basics: [
      'Transforms raw model confidence into reliability guidance for decision quality.',
      'Shows whether confidence is likely over-stated or under-stated at current data volume.',
      'Helps interpret statements like “80% confidence” in practical terms.'
    ],
    policyVsLearning: [
      'Policy: reliability floor/ceiling and minimum sample assumptions.',
      'Anchored: calibration quality references current volatility and evidence depth.',
      'Learns over time: confidence mapping changes as sample depth and noise regime evolve.'
    ]
  })
]);

export const ORDERS_TABLE_BY_STORE = Object.freeze({
  vironax: 'salla_orders',
  shawq: 'shopify_orders'
});

export const CONFIDENCE_CALIBRATION = Object.freeze({
  minimumReliability: 0.45,
  maximumReliability: 0.96,
  baselineUncertainty: 0.18,
  volatilityPenaltyScale: 0.22,
  evidenceBoostScale: 0.35,
  evidenceForFullBoost: 1200
});

export const MONTE_CARLO_CONFIG = Object.freeze({
  betaSamples: 800,
  orderSamples: 800,
  randomSeedSalt: 9173
});
