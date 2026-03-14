export const DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS = Object.freeze({
  account: true,
  timeline: true,
  campaigns: true,
  adSets: true,
  ads: true,
  geos: true,
  recentChanges: true,
  recentEntityState: true,
  geoCampaignIntersections: false
});

function coerceBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeDashboardDailyBriefIncludeConfig(overrides = {}) {
  const source = overrides && typeof overrides === 'object' ? overrides : {};

  return {
    account: coerceBoolean(source.account, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.account),
    timeline: coerceBoolean(source.timeline, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.timeline),
    campaigns: coerceBoolean(source.campaigns, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.campaigns),
    adSets: coerceBoolean(source.adSets, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.adSets),
    ads: coerceBoolean(source.ads, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.ads),
    geos: coerceBoolean(source.geos, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.geos),
    recentChanges: coerceBoolean(source.recentChanges, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.recentChanges),
    recentEntityState: coerceBoolean(source.recentEntityState, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.recentEntityState),
    geoCampaignIntersections: coerceBoolean(source.geoCampaignIntersections, DASHBOARD_DAILY_BRIEF_INCLUDE_DEFAULTS.geoCampaignIntersections)
  };
}
