import express from 'express';

import {
  getConversionUiFixLabSession,
  resolveConversionUiFixLabScreenshotPath,
  runConversionUiFixLabAudit,
  updateConversionUiFixLabApprovals
} from '../services/conversionUiFixLabService.js';

const router = express.Router();

router.post('/audit', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const store = String(req.body?.store || 'shawq').trim();
    const maxPages = req.body?.maxPages;
    const maxDepth = req.body?.maxDepth;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required.' });
    }

    const session = await runConversionUiFixLabAudit({
      url,
      store,
      maxPages,
      maxDepth
    });

    return res.json({ success: true, session });
  } catch (error) {
    console.error('[Conversion/UI Fix Lab] audit error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to run Conversion/UI Fix Lab audit.'
    });
  }
});

router.get('/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = getConversionUiFixLabSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }

    return res.json({ success: true, session: session.report });
  } catch (error) {
    console.error('[Conversion/UI Fix Lab] get session error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load session.' });
  }
});

router.post('/sessions/:sessionId/approvals', (req, res) => {
  try {
    const { sessionId } = req.params;
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];

    const session = getConversionUiFixLabSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found.' });
    }

    const updated = updateConversionUiFixLabApprovals({ sessionId, updates });
    return res.json({ success: true, session: updated });
  } catch (error) {
    console.error('[Conversion/UI Fix Lab] approval update error:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to update approvals.' });
  }
});

router.get('/sessions/:sessionId/screenshots/:fileName', (req, res) => {
  try {
    const { sessionId, fileName } = req.params;
    const target = resolveConversionUiFixLabScreenshotPath(sessionId, fileName);
    if (!target) {
      return res.status(404).json({ success: false, error: 'Screenshot not found.' });
    }

    return res.sendFile(target);
  } catch (error) {
    console.error('[Conversion/UI Fix Lab] screenshot read error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load screenshot.' });
  }
});

export default router;
