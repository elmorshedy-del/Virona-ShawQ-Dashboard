import express from 'express';
import {
  cleanupSessionIntelligenceRaw,
  getSessionIntelligenceLatestBrief,
  getSessionIntelligenceOverview,
  getSessionIntelligenceRecentEvents,
  getSessionIntelligenceSessions
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

