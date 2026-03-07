import express from 'express';
import {
  analyzeSessionIntelligenceDay,
  analyzeSessionIntelligenceSession,
  cleanupSessionIntelligenceRaw,
  getSessionIntelligenceEventsForDay,
  getSessionIntelligenceSessionsForDay,
  getSessionIntelligenceBriefForDay,
  getSessionIntelligenceClaritySignalsForDay,
  getSessionIntelligenceDayPulse,
  getSessionIntelligenceLandingToPurchase,
  getSessionIntelligenceAbandonmentByLocation,
  getSessionIntelligenceFlowForDay,
  getSessionIntelligenceLatestBrief,
  getSessionIntelligenceOverview,
  getSessionIntelligenceRealtimeOverview,
  getSessionIntelligencePurchasesByCampaign,
  getSessionIntelligenceRecentEvents,
  getSessionIntelligenceSessions,
  generateSessionIntelligenceDailyBrief,
  listSessionIntelligenceDays
} from '../services/sessionIntelligenceService.js';
import {
  attachCachedClarityVerifications,
  triggerClarityVerificationForSignals
} from '../services/sessionIntelligenceVerificationService.js';
import {
  listInvestigationIssuesForDate,
  listInvestigationJobs,
  queueInvestigationJobs,
  runQueuedInvestigationJobs
} from '../services/sessionIntelligenceInvestigationService.js';
import {
  getSessionIntelligenceSurveySummary,
  listSessionIntelligenceSurveyTemplates,
  recordSessionIntelligenceSurveyResponse,
  upsertSessionIntelligenceSurveyTemplateConfig
} from '../services/sessionIntelligenceSurveyService.js';

const router = express.Router();

function normalizeFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function parsePositiveInt(value, fallback, min = 1, max = 1000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeIssueKeysInput(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

router.get('/overview', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const data = getSessionIntelligenceOverview(store);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[SessionIntelligence] overview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load overview' });
  }
});

router.get('/day-pulse', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const data = getSessionIntelligenceDayPulse(store);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[SessionIntelligence] day-pulse error:', error);
    res.status(500).json({ success: false, error: 'Failed to load day pulse' });
  }
});

router.get('/realtime', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const windowMinutes = req.query.windowMinutes ?? req.query.window ?? 30;
    const limit = req.query.limit ?? 10;
    const data = getSessionIntelligenceRealtimeOverview(store, { windowMinutes, limit });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[SessionIntelligence] realtime error:', error);
    res.status(500).json({ success: false, error: 'Failed to load realtime overview' });
  }
});

router.get('/events', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 80;
    const events = getSessionIntelligenceRecentEvents(store, limit);
    res.json({ success: true, store, events });
  } catch (error) {
    console.error('[SessionIntelligence] events error:', error);
    res.status(500).json({ success: false, error: 'Failed to load events' });
  }
});

router.get('/sessions', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 60;
    const sessions = getSessionIntelligenceSessions(store, limit);
    res.json({ success: true, store, sessions });
  } catch (error) {
    console.error('[SessionIntelligence] sessions error:', error);
    res.status(500).json({ success: false, error: 'Failed to load sessions' });
  }
});

router.get('/brief', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const date = req.query.date || null;
    const brief = date ? getSessionIntelligenceBriefForDay(store, date) : getSessionIntelligenceLatestBrief(store);
    res.json({ success: true, store, brief: brief || null });
  } catch (error) {
    console.error('[SessionIntelligence] brief error:', error);
    res.status(500).json({ success: false, error: 'Failed to load brief' });
  }
});

router.get('/flow', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const date = req.query.date;
    const mode = req.query.mode || 'all';
    const limitSessions = req.query.limitSessions ? Number(req.query.limitSessions) : 5000;
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });

    const result = getSessionIntelligenceFlowForDay(store, date, { mode, limitSessions });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] flow error:', error);
    res.status(500).json({ success: false, error: 'Failed to load flow' });
  }
});

router.get('/clarity', async (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const date = req.query.date;
    const mode = req.query.mode || 'high_intent_no_purchase';
    const limitSessions = req.query.limitSessions ? Number(req.query.limitSessions) : 5000;
    const verifyValue = typeof req.query.verify === 'string' ? req.query.verify.trim().toLowerCase() : '';
    const shouldVerify = normalizeFlag(req.query.verify) || verifyValue === 'wait';
    const waitForVerify = verifyValue === 'wait' || normalizeFlag(req.query.verifyWait);
    const forceVerify = normalizeFlag(req.query.forceVerify) || normalizeFlag(req.query.force);
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });

    const result = getSessionIntelligenceClaritySignalsForDay(store, date, { mode, limitSessions });
    if (!result.success) return res.status(400).json(result);

    const attachVerificationSummary = () => {
      const attached = attachCachedClarityVerifications({
        store,
        date,
        signals: result?.data?.signals
      });
      result.data.signals = attached.signals;
      result.data.verification = {
        ...(result.data.verification || {}),
        ...attached.summary
      };
    };

    attachVerificationSummary();

    if (shouldVerify) {
      const verificationJob = triggerClarityVerificationForSignals({
        store,
        date,
        signals: result?.data?.signals,
        force: forceVerify
      });

      if (waitForVerify) {
        const verificationResult = await verificationJob;
        attachVerificationSummary();
        result.data.verification = {
          ...(result.data.verification || {}),
          mode: 'wait',
          ...verificationResult
        };
      } else {
        verificationJob.catch((error) => {
          console.warn('[SessionIntelligence] clarity verification job failed:', error?.message || error);
        });
        result.data.verification = {
          ...(result.data.verification || {}),
          mode: 'async',
          queued: true
        };
      }
    }

    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] clarity error:', error);
    res.status(500).json({ success: false, error: 'Failed to load clarity signals' });
  }
});

router.get('/investigation/issues', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const date = req.query.date;
    const mode = req.query.mode || 'high_intent_no_purchase';
    const limit = parsePositiveInt(req.query.limit, 100, 1, 500);
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });

    const result = listInvestigationIssuesForDate({ store, date, mode, limit });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] investigation issues error:', error);
    res.status(500).json({ success: false, error: 'Failed to load investigation issues' });
  }
});

router.get('/investigation/jobs', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const status = req.query.status || '';
    const limit = parsePositiveInt(req.query.limit, 50, 1, 200);
    const result = listInvestigationJobs({ store, status, limit });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] investigation jobs error:', error);
    res.status(500).json({ success: false, error: 'Failed to load investigation jobs' });
  }
});

router.post('/investigation/jobs/queue', async (req, res) => {
  try {
    const store = req.body?.store || 'shawq';
    const date = req.body?.date;
    const mode = req.body?.mode || 'high_intent_no_purchase';
    const issueKeys = normalizeIssueKeysInput(req.body?.issueKeys);
    const limit = parsePositiveInt(req.body?.limit, 24, 1, 200);
    const priority = parsePositiveInt(req.body?.priority, 100, 1, 1000);
    const includeObserved = normalizeFlag(req.body?.includeObserved);
    const includeUnverifiable = normalizeFlag(req.body?.includeUnverifiable);
    const force = normalizeFlag(req.body?.force);
    const wait = normalizeFlag(req.body?.wait);
    const requestedBy = typeof req.body?.requestedBy === 'string' ? req.body.requestedBy.trim() : 'api';
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });

    const queueResult = queueInvestigationJobs({
      store,
      date,
      mode,
      issueKeys,
      limit,
      priority,
      requestedBy,
      includeObserved,
      includeUnverifiable,
      force
    });
    if (!queueResult.success) return res.status(400).json(queueResult);

    if (!wait) return res.json(queueResult);

    const runResult = await runQueuedInvestigationJobs({
      store,
      maxJobs: limit
    });

    res.json({
      success: true,
      data: {
        queue: queueResult.data,
        run: runResult.data
      }
    });
  } catch (error) {
    console.error('[SessionIntelligence] investigation queue error:', error);
    res.status(500).json({ success: false, error: 'Failed to queue investigation jobs' });
  }
});

router.post('/investigation/jobs/run', async (req, res) => {
  try {
    const store = req.body?.store || 'shawq';
    const maxJobs = parsePositiveInt(req.body?.maxJobs, 8, 1, 200);
    const result = await runQueuedInvestigationJobs({ store, maxJobs });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] investigation run error:', error);
    res.status(500).json({ success: false, error: 'Failed to run investigation jobs' });
  }
});

router.get('/survey/templates', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const startDate = req.query.startDate || req.query.start || null;
    const endDate = req.query.endDate || req.query.end || null;
    const activeOnly = normalizeFlag(req.query.activeOnly);
    const result = listSessionIntelligenceSurveyTemplates({ store, startDate, endDate, activeOnly });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] survey templates error:', error);
    res.status(500).json({ success: false, error: 'Failed to load survey templates' });
  }
});

router.post('/survey/templates/config', (req, res) => {
  try {
    const store = req.body?.store || 'shawq';
    const templateKey = req.body?.templateKey || req.body?.template_key;
    const status = req.body?.status;
    const consentMode = req.body?.consentMode || req.body?.consent_mode;
    const deliveryType = req.body?.deliveryType || req.body?.delivery_type;
    const questionText = req.body?.questionText || req.body?.question_text;
    const choices = Array.isArray(req.body?.choices) ? req.body.choices : undefined;

    const result = upsertSessionIntelligenceSurveyTemplateConfig({
      store,
      templateKey,
      status,
      consentMode,
      deliveryType,
      questionText,
      choices
    });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] survey config error:', error);
    res.status(500).json({ success: false, error: 'Failed to save survey template config' });
  }
});

router.get('/survey/summary', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const startDate = req.query.startDate || req.query.start || null;
    const endDate = req.query.endDate || req.query.end || null;
    const limit = parsePositiveInt(req.query.limit, 8, 1, 20);
    const result = getSessionIntelligenceSurveySummary({ store, startDate, endDate, limit });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] survey summary error:', error);
    res.status(500).json({ success: false, error: 'Failed to load survey summary' });
  }
});

router.post('/survey/respond', (req, res) => {
  try {
    const store = req.body?.store || 'shawq';
    const result = recordSessionIntelligenceSurveyResponse({
      store,
      payload: req.body || {},
      source: req.body?.source || 'storefront'
    });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] survey respond error:', error);
    res.status(500).json({ success: false, error: 'Failed to record survey response' });
  }
});

router.post('/brief/generate', async (req, res) => {
  try {
    const store = req.body?.store || 'shawq';
    const date = req.body?.date;
    const model = req.body?.model || null;
    const temperature = req.body?.temperature ?? null;
    const limitSessions = req.body?.limitSessions ?? req.body?.limit ?? null;

    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });

    const result = await generateSessionIntelligenceDailyBrief({
      store,
      date,
      model: model || undefined,
      temperature,
      limitSessions: limitSessions ?? undefined
    });

    if (!result.success) return res.status(500).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] generate brief error:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate brief' });
  }
});

router.get('/days', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    const days = listSessionIntelligenceDays(store, limit);
    res.json({ success: true, store, days });
  } catch (error) {
    console.error('[SessionIntelligence] days error:', error);
    res.status(500).json({ success: false, error: 'Failed to load days' });
  }
});

router.get('/purchases-by-campaign', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const startDate = req.query.startDate || req.query.start || null;
    const endDate = req.query.endDate || req.query.end || null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 250;

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'Missing startDate/endDate (YYYY-MM-DD)' });
    }

    const report = getSessionIntelligencePurchasesByCampaign(store, { startDate, endDate, limit });
    res.json({ success: true, ...report });
  } catch (error) {
    console.error('[SessionIntelligence] purchases-by-campaign error:', error);
    res.status(500).json({ success: false, error: 'Failed to load purchases by campaign' });
  }
});

router.get('/journey/landing-purchases', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const startDate = req.query.startDate || req.query.start || null;
    const endDate = req.query.endDate || req.query.end || null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;

    const report = getSessionIntelligenceLandingToPurchase(store, { startDate, endDate, limit });
    res.json({ success: true, ...report });
  } catch (error) {
    console.error('[SessionIntelligence] journey landing-purchases error:', error);
    res.status(500).json({ success: false, error: 'Failed to load landing to purchase report' });
  }
});

router.get('/journey/abandonment', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const startDate = req.query.startDate || req.query.start || null;
    const endDate = req.query.endDate || req.query.end || null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;

    const report = getSessionIntelligenceAbandonmentByLocation(store, { startDate, endDate, limit });
    res.json({ success: true, ...report });
  } catch (error) {
    console.error('[SessionIntelligence] journey abandonment error:', error);
    res.status(500).json({ success: false, error: 'Failed to load abandonment report' });
  }
});

router.get('/sessions-by-day', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const date = req.query.date;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 200;
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });
    const sessions = getSessionIntelligenceSessionsForDay(store, date, limit);
    res.json({ success: true, store, date, sessions });
  } catch (error) {
    console.error('[SessionIntelligence] sessions-by-day error:', error);
    res.status(500).json({ success: false, error: 'Failed to load sessions for day' });
  }
});

router.get('/events-by-day', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const date = req.query.date;
    const sessionId = req.query.sessionId || null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 800;
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });
    const events = getSessionIntelligenceEventsForDay(store, date, { sessionId, limit });
    res.json({ success: true, store, date, sessionId, events });
  } catch (error) {
    console.error('[SessionIntelligence] events-by-day error:', error);
    res.status(500).json({ success: false, error: 'Failed to load events for day' });
  }
});

router.post('/analyze-session', async (req, res) => {
  try {
    const store = req.body?.store || 'shawq';
    const sessionId = req.body?.sessionId;
    const model = req.body?.model;
    const temperature = req.body?.temperature;
    if (!sessionId) return res.status(400).json({ success: false, error: 'Missing sessionId' });
    const result = await analyzeSessionIntelligenceSession({ store, sessionId, model, temperature });
    if (!result.success) return res.status(500).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] analyze-session error:', error);
    res.status(500).json({ success: false, error: 'Failed to analyze session' });
  }
});

router.post('/analyze-day', async (req, res) => {
  try {
    const store = req.body?.store || 'shawq';
    const date = req.body?.date;
    const mode = req.body?.mode || 'high_intent';
    const limit = req.body?.limit ?? 20;
    const model = req.body?.model;
    const temperature = req.body?.temperature;
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });
    const result = await analyzeSessionIntelligenceDay({ store, date, mode, limit, model, temperature });
    if (!result.success) return res.status(500).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] analyze-day error:', error);
    res.status(500).json({ success: false, error: 'Failed to analyze day' });
  }
});

router.post('/cleanup', (req, res) => {
  try {
    const retentionHours = req.body?.retentionHours;
    const result = cleanupSessionIntelligenceRaw({ retentionHours });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[SessionIntelligence] cleanup error:', error);
    res.status(500).json({ success: false, error: 'Failed to cleanup raw events' });
  }
});

export default router;
