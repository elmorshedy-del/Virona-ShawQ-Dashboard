import express from 'express';
import {
  analyzeSessionIntelligenceDay,
  analyzeSessionIntelligenceSession,
  cleanupSessionIntelligenceRaw,
  getSessionIntelligenceEventsForDay,
  getSessionIntelligenceSessionsForDay,
  getSessionIntelligenceLatestBrief,
  getSessionIntelligenceOverview,
  getSessionIntelligenceRecentEvents,
  getSessionIntelligenceSessions,
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
    const brief = getSessionIntelligenceLatestBrief(store);
    res.json({ success: true, store, brief: brief || null });
  } catch (error) {
    console.error('[SessionIntelligence] brief error:', error);
    res.status(500).json({ success: false, error: 'Failed to load brief' });
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
    if (!sessionId) return res.status(400).json({ success: false, error: 'Missing sessionId' });
    const result = await analyzeSessionIntelligenceSession({ store, sessionId });
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
    if (!date) return res.status(400).json({ success: false, error: 'Missing date (YYYY-MM-DD)' });
    const result = await analyzeSessionIntelligenceDay({ store, date, mode, limit });
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
