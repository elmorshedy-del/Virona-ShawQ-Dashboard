import express from 'express';
import {
  analyzeSessionIntelligenceDay,
  analyzeSessionIntelligenceSession,
  cleanupSessionIntelligenceRaw,
  getSessionIntelligenceEventsForDay,
  getSessionIntelligenceSessionsForDay,
  getSessionIntelligenceBriefForDay,
  getSessionIntelligenceClaritySignalsForDay,
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

const router = express.Router();

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

router.get('/clarity', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const date = req.query.date;
    const mode = req.query.mode || 'high_intent_no_purchase';
    const limitSessions = req.query.limitSessions ? Number(req.query.limitSessions) : 5000;
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });

    const result = getSessionIntelligenceClaritySignalsForDay(store, date, { mode, limitSessions });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[SessionIntelligence] clarity error:', error);
    res.status(500).json({ success: false, error: 'Failed to load clarity signals' });
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
