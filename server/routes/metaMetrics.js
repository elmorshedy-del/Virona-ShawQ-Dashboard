import express from 'express';
import {
  getMetaMetricsAge,
  getMetaMetricsGender,
  getMetaMetricsOverview
} from '../services/metaMetricsService.js';

const router = express.Router();
const DEFAULT_LIVE_WINDOW_MINUTES = 30;
const MIN_LIVE_WINDOW_MINUTES = 5;
const MAX_LIVE_WINDOW_MINUTES = 240;
const DEFAULT_STORE_ID = 'vironax';

function normalizeStoreId(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : DEFAULT_STORE_ID;
}

function parseLiveWindowMinutes(value) {
  const numericValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numericValue)) return DEFAULT_LIVE_WINDOW_MINUTES;
  return Math.min(MAX_LIVE_WINDOW_MINUTES, Math.max(MIN_LIVE_WINDOW_MINUTES, numericValue));
}

router.get('/overview', async (req, res) => {
  try {
    const store = normalizeStoreId(req.query.store);
    const liveWindowMinutes = parseLiveWindowMinutes(req.query.liveWindowMinutes);

    const data = await getMetaMetricsOverview({
      store,
      query: req.query,
      liveWindowMinutes
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('[MetaMetrics] overview error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to load Meta Metrics overview.'
    });
  }
});

router.get('/gender', async (req, res) => {
  try {
    const store = normalizeStoreId(req.query.store);
    const data = await getMetaMetricsGender({
      store,
      query: req.query
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[MetaMetrics] gender error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to load Meta Metrics gender data.'
    });
  }
});

router.get('/age', async (req, res) => {
  try {
    const store = normalizeStoreId(req.query.store);
    const data = await getMetaMetricsAge({
      store,
      query: req.query
    });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[MetaMetrics] age error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to load Meta Metrics age data.'
    });
  }
});

export default router;
