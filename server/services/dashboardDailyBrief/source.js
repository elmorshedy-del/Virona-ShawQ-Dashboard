import {
  DASHBOARD_DAILY_BRIEF_DEFAULTS,
  DASHBOARD_DAILY_BRIEF_PACKET_LIMITS
} from './constants.js';
import { normalizeDashboardDailyBriefIncludeConfig } from './options.js';
import {
  ensureDashboardDailyBriefSnapshotRange,
  readDashboardDailyBriefAccountRows,
  readDashboardDailyBriefGeoRows,
  readDashboardDailyBriefHierarchyRows,
  readDashboardDailyBriefRecentEvents,
  resolveDashboardDailyBriefDate,
  shiftIsoDate
} from './snapshots.js';

function buildRecentEntityState(hierarchyRows = []) {
  const limit = DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentEntityRows;
  const groups = {
    campaigns: [],
    adSets: [],
    ads: []
  };

  for (const row of hierarchyRows) {
    if (!row?.id || !row?.level) continue;
    const target =
      row.level === 'campaign'
        ? groups.campaigns
        : row.level === 'adset'
          ? groups.adSets
          : row.level === 'ad'
            ? groups.ads
            : null;
    if (!target || target.length >= limit) continue;

    target.push({
      id: row.id,
      name: row.name || null,
      spend: row?.metrics?.now?.spend ?? 0,
      metaPurchases: row?.metrics?.now?.purchases ?? 0,
      roas: row?.metrics?.now?.roas ?? 0
    });
  }

  return groups;
}

export { resolveDashboardDailyBriefDate };

export async function loadDashboardDailyBriefSource({ store, briefDate: requestedBriefDate = null, include: includeOverrides = null }) {
  const include = normalizeDashboardDailyBriefIncludeConfig(includeOverrides);
  const briefDate = resolveDashboardDailyBriefDate(requestedBriefDate);
  const analysisStartDate = shiftIsoDate(briefDate, -(DASHBOARD_DAILY_BRIEF_DEFAULTS.analysisWindowDays - 1));
  const baselineStartDate = shiftIsoDate(briefDate, -DASHBOARD_DAILY_BRIEF_DEFAULTS.baselineComparisonDays);
  const baselineEndDate = shiftIsoDate(briefDate, -1);

  await ensureDashboardDailyBriefSnapshotRange({
    store,
    startDate: analysisStartDate,
    endDate: briefDate
  });

  const shouldReadHierarchy = include.campaigns || include.adSets || include.ads || include.recentEntityState;
  const dailyRows = include.account || include.timeline
    ? readDashboardDailyBriefAccountRows({
      store,
      startDate: analysisStartDate,
      endDate: briefDate
    })
    : [];
  const hierarchyRows = shouldReadHierarchy
    ? readDashboardDailyBriefHierarchyRows({
      store,
      briefDate,
      baselineStartDate,
      baselineEndDate
    })
    : [];
  const geoRows = include.geos
    ? readDashboardDailyBriefGeoRows({
      store,
      briefDate,
      baselineStartDate,
      baselineEndDate
    })
    : [];
  const recentChanges = include.recentChanges
    ? readDashboardDailyBriefRecentEvents({
      store,
      endDate: briefDate
    })
    : [];

  return {
    store,
    briefDate,
    analysisStartDate,
    analysisEndDate: briefDate,
    anchorStartDate: baselineStartDate,
    anchorEndDate: baselineEndDate,
    dailyRows,
    hierarchyRows,
    geoRows,
    recentChanges,
    include,
    recentEntityState: include.recentEntityState ? buildRecentEntityState(hierarchyRows) : null
  };
}
