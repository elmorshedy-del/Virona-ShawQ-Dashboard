import { Router } from 'express';
import {
  getDashboardData,
  getEfficiencyData,
  getEfficiencyTrends,
  getRecommendations,
  getAvailableCountries,
  getCountryTrends,
  getShopifyTimeOfDay,
  getMetaBreakdowns
} from '../services/analyticsService.js';
import { importMetaDailyRows } from '../services/metaImportService.js';

const router = Router();

router.get('/dashboard', async (req, res) => {
  try {
    const { store, ...params } = req.query;
    const data = getDashboardData(store, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load dashboard' });
  }
});

// Manual Meta import (temporary replacement for token-based sync)
// Expects JSON body: { store?: string, rows: [...] }
router.post('/meta/import', async (req, res) => {
  try {
    const store = req.query.store || req.body.store;
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

    if (!store) {
      return res.status(400).json({ error: 'store is required' });
    }
    if (rows.length === 0) {
      return res.json({ ok: true, inserted: 0, updated: 0, skipped: 0, reason: 'No rows provided' });
    }

    const result = importMetaDailyRows(store, rows);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Meta import failed' });
  }
});

router.get('/efficiency', async (req, res) => {
  try {
    const { store, ...params } = req.query;
    const data = getEfficiencyData(store, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load efficiency' });
  }
});

router.get('/efficiency/trends', async (req, res) => {
  try {
    const { store, ...params } = req.query;
    const data = getEfficiencyTrends(store, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load efficiency trends' });
  }
});

router.get('/recommendations', async (req, res) => {
  try {
    const { store, ...params } = req.query;
    const data = getRecommendations(store, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load recommendations' });
  }
});

router.get('/countries', async (req, res) => {
  try {
    const { store } = req.query;
    const data = getAvailableCountries(store);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load countries' });
  }
});

router.get('/countries/trends', async (req, res) => {
  try {
    const { store, ...params } = req.query;
    const data = getCountryTrends(store, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load country trends' });
  }
});

router.get('/shopify/time-of-day', async (req, res) => {
  try {
    const { store, ...params } = req.query;
    const data = getShopifyTimeOfDay(store, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load Shopify time of day' });
  }
});

router.get('/meta/breakdowns', async (req, res) => {
  try {
    const { store, ...params } = req.query;
    const data = getMetaBreakdowns(store, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Failed to load Meta breakdowns' });
  }
});

export default router;
