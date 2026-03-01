import { getCampaignIntelligenceSnapshot } from './service.js';
import {
  buildCampaignIntelligenceBriefScopeKey,
  campaignIntelligenceBriefSource,
  generateCampaignIntelligenceBrief,
  getCampaignIntelligenceBriefSettings,
  hasCampaignIntelligenceBriefForDate,
  listCampaignIntelligenceDailyBriefStores
} from './briefs.js';

function buildSnapshotQuery(store, settings) {
  const scope = settings?.scope || {};

  const query = {
    store,
    level: scope.level || 'campaign',
    country: scope.country || 'ALL',
    anchorWindowDays: scope.anchorDays || 21
  };

  if (scope.entityId) query.entityId = scope.entityId;
  if (scope.startDate) query.startDate = scope.startDate;
  if (scope.endDate) query.endDate = scope.endDate;
  if (scope.anchorStartDate) query.anchorStartDate = scope.anchorStartDate;
  if (scope.anchorEndDate) query.anchorEndDate = scope.anchorEndDate;

  return query;
}

export async function runCampaignIntelligenceDailyBriefs() {
  const stores = listCampaignIntelligenceDailyBriefStores();
  if (!stores.length) {
    return {
      storesScanned: 0,
      generated: 0,
      skipped: 0,
      failures: []
    };
  }

  let generated = 0;
  let skipped = 0;
  const failures = [];

  for (const store of stores) {
    try {
      const settings = getCampaignIntelligenceBriefSettings(store);
      const query = buildSnapshotQuery(store, settings);
      const snapshot = await getCampaignIntelligenceSnapshot(query);
      const scopeKey = buildCampaignIntelligenceBriefScopeKey({
        level: snapshot?.scope?.level,
        entityId: snapshot?.scope?.entityId,
        country: snapshot?.scope?.country
      });
      const briefDate = snapshot?.scope?.analysisEndDate || new Date().toISOString().slice(0, 10);

      if (hasCampaignIntelligenceBriefForDate({
        store,
        scopeKey,
        briefDate,
        source: campaignIntelligenceBriefSource.daily
      })) {
        skipped += 1;
        continue;
      }

      await generateCampaignIntelligenceBrief({
        store,
        source: campaignIntelligenceBriefSource.daily,
        scopeKey,
        snapshot,
        provider: settings.provider,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        verbosity: settings.verbosity
      });

      generated += 1;
    } catch (error) {
      failures.push({
        store,
        error: error?.message || 'Unknown error'
      });
      console.warn(`[CampaignIntelligence] Daily brief failed for ${store}:`, error?.message || error);
    }
  }

  return {
    storesScanned: stores.length,
    generated,
    skipped,
    failures
  };
}
