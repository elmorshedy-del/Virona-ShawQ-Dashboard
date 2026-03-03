import express from 'express';
import { getCampaignIntelligenceSnapshot } from '../services/campaignIntelligence/service.js';
import { getCampaignIntelligenceUnifiedSnapshot } from '../services/campaignIntelligence/unifiedService.js';
import {
  buildCampaignIntelligenceBriefScopeKey,
  campaignIntelligenceBriefSource,
  generateCampaignIntelligenceBrief,
  updateCampaignIntelligenceBriefSettings
} from '../services/campaignIntelligence/briefs.js';

const router = express.Router();

function extractScopeQuery(input = {}) {
  return {
    store: input.store,
    level: input.level,
    entityId: input.entityId,
    country: input.country,
    startDate: input.startDate,
    endDate: input.endDate,
    anchorWindowDays: input.anchorWindowDays,
    anchorStartDate: input.anchorStartDate,
    anchorEndDate: input.anchorEndDate,
    analysisWindowDays: input.analysisWindowDays,
    sentinelPreset: input.sentinelPreset,
    headroomPreset: input.headroomPreset,
    launchPreset: input.launchPreset,
    launchMinDays: input.launchMinDays,
    launchMaxDays: input.launchMaxDays,
    targetRoas: input.targetRoas,
    targetCpa: input.targetCpa,
    targetHorizonDays: input.targetHorizonDays
  };
}

router.get('/snapshot', async (req, res) => {
  try {
    const data = await getCampaignIntelligenceSnapshot(req.query || {});
    res.json(data);
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : 500;
    if (statusCode >= 500) {
      console.error('[CampaignIntelligence] Snapshot error:', error);
    }
    res.status(statusCode).json({
      success: false,
      error: error?.message || 'Failed to generate campaign intelligence snapshot'
    });
  }
});

router.get('/unified-snapshot', async (req, res) => {
  try {
    const data = await getCampaignIntelligenceUnifiedSnapshot(req.query || {});
    res.json(data);
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : 500;
    if (statusCode >= 500) {
      console.error('[CampaignIntelligence] Unified snapshot error:', error);
    }
    res.status(statusCode).json({
      success: false,
      error: error?.message || 'Failed to generate unified campaign intelligence snapshot'
    });
  }
});

router.post('/brief/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const scopeQuery = extractScopeQuery(body);
    const snapshot = await getCampaignIntelligenceSnapshot(scopeQuery);
    const scopeKey = buildCampaignIntelligenceBriefScopeKey({
      level: snapshot?.scope?.level,
      entityId: snapshot?.scope?.entityId,
      country: snapshot?.scope?.country
    });

    const brief = await generateCampaignIntelligenceBrief({
      store: snapshot?.scope?.store || scopeQuery.store,
      source: campaignIntelligenceBriefSource.manual,
      scopeKey,
      snapshot,
      provider: body.provider,
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      verbosity: body.verbosity
    });

    if (snapshot?.brief) {
      snapshot.brief.latest = brief;
    }

    res.json({
      success: true,
      scopeKey,
      brief,
      snapshot
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : 500;
    if (statusCode >= 500) {
      console.error('[CampaignIntelligence] Brief generation error:', error);
    }
    res.status(statusCode).json({
      success: false,
      error: error?.message || 'Failed to generate campaign intelligence brief'
    });
  }
});

router.post('/unified-brief/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const snapshot = await getCampaignIntelligenceUnifiedSnapshot({
      store: body.store,
      country: body.country,
      startDate: body.startDate,
      endDate: body.endDate,
      analysisWindowDays: body.analysisWindowDays,
      selectorLimit: body.selectorLimit
    });

    const scopeKey = buildCampaignIntelligenceBriefScopeKey({
      level: snapshot?.scope?.level,
      entityId: snapshot?.scope?.entityId,
      country: snapshot?.scope?.country
    });

    const brief = await generateCampaignIntelligenceBrief({
      store: snapshot?.scope?.store || body.store,
      source: campaignIntelligenceBriefSource.manual,
      scopeKey,
      snapshot,
      provider: body.provider,
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      verbosity: body.verbosity
    });

    if (snapshot?.brief) {
      snapshot.brief.latest = brief;
    }

    res.json({
      success: true,
      scopeKey,
      brief,
      snapshot
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : 500;
    if (statusCode >= 500) {
      console.error('[CampaignIntelligence] Unified brief generation error:', error);
    }
    res.status(statusCode).json({
      success: false,
      error: error?.message || 'Failed to generate unified campaign intelligence brief'
    });
  }
});

router.post('/brief/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const settings = updateCampaignIntelligenceBriefSettings(body.store, {
      scheduleMode: body.scheduleMode,
      provider: body.provider,
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      verbosity: body.verbosity,
      scope: body.scope
    });

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : 500;
    if (statusCode >= 500) {
      console.error('[CampaignIntelligence] Brief settings error:', error);
    }
    res.status(statusCode).json({
      success: false,
      error: error?.message || 'Failed to update campaign intelligence brief settings'
    });
  }
});

export default router;
