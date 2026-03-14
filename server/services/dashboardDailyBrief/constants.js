export const SUPPORTED_STORES = new Set(['vironax', 'shawq']);

export const DASHBOARD_DAILY_BRIEF_SCOPE_KEY = 'dashboard:all-campaigns';

export const DASHBOARD_DAILY_BRIEF_SOURCE = Object.freeze({
  daily: 'daily',
  manual: 'manual'
});

export const DASHBOARD_DAILY_BRIEF_DEFAULTS = Object.freeze({
  provider: 'openai',
  model: 'gpt-5.2',
  reasoningEffort: 'xhigh',
  verbosity: 'low',
  fallbackProvider: 'fireworks',
  fallbackModel: 'accounts/fireworks/models/glm-5',
  fallbackReasoningEffort: 'high',
  fallbackTemperature: 0.15,
  analysisWindowDays: 35,
  anchorWindowDays: 21,
  baselineComparisonDays: 7,
  selectorLimit: 36,
  maxOutputTokens: 560,
  estimatedCharsPerToken: 4,
  maxParagraphChars: 1800,
  inputUsdPerMillionTokens: 1.75,
  outputUsdPerMillionTokens: 14
});

export const DASHBOARD_DAILY_BRIEF_PACKET_LIMITS = Object.freeze({
  recentTimelineRows: 10,
  topCampaignRows: 8,
  flaggedAdsetRows: 8,
  flaggedAdRows: 10,
  topGeoRows: 6,
  recentChangeRows: 5,
  recentEntityRows: 6
});

export const DASHBOARD_DAILY_BRIEF_THRESHOLDS = Object.freeze({
  significantSpendShare: 0.08,
  zeroPurchaseSpendShare: 0.05,
  weakRoasRatioVsAccount: 0.7,
  strongRoasRatioVsAccount: 1.25,
  weakRateDeltaRatio: -0.25,
  strongRateDeltaRatio: 0.25,
  inLineDeltaRatio: 0.1,
  meaningfulFunnelDeltaRatio: 0.12,
  recentLaunchDays: 7,
  quietEntityDays: 3
});

export const DASHBOARD_DAILY_BRIEF_SNAPSHOT_EVENT_THRESHOLDS = Object.freeze({
  meaningfulSpendChangeRatio: 0.4,
  minimumSpendForShiftEvent: 25,
  minimumSpendForLaunchEvent: 15
});
