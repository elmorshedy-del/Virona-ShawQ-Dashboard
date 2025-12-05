import express from 'express';
import { getDb } from '../db/database.js';
import {
  getDashboard,
  getEfficiency,
  getEfficiencyTrends,
  getRecommendations,
  getAvailableCountries,
  getCampaignsByCountry,
  getCampaignsByAge,
  getCampaignsByGender,
  getCampaignsByPlacement,
  getCountryTrends,
  getCampaignsByAgeGender,
  getShopifyTimeOfDay
} from '../services/analyticsService.js';
import { importMetaDailyRows } from '../services/metaImportService.js';

const router = express.Router();

router.get('/dashboard', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getDashboard(store, req.query);
    res.json(data);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/meta/clear', (req, res) => {
  try {
    const store = req.query.store;
    if (!store) return res.status(400).json({ error: 'Store required' });
    const db = getDb();
    const info = db.prepare('DELETE FROM meta_daily_metrics WHERE store = ?').run(store);
    res.json({ success: true, deleted: info.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/meta/import', async (req, res) => {
  try {
    const store = req.query.store || req.body.store;
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!store) return res.status(400).json({ error: 'store is required' });
    if (rows.length === 0) return res.json({ ok: true, inserted: 0, updated: 0, skipped: 0 });

    const result = importMetaDailyRows(store, rows);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Meta import error:', err);
    res.status(500).json({ error: err?.message || 'Meta import failed' });
  }
});

router.get('/campaigns/by-country', (req, res) => { try { res.json(getCampaignsByCountry(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/campaigns/by-age', (req, res) => { try { res.json(getCampaignsByAge(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/campaigns/by-gender', (req, res) => { try { res.json(getCampaignsByGender(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/campaigns/by-placement', (req, res) => { try { res.json(getCampaignsByPlacement(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/campaigns/by-age-gender', (req, res) => { try { res.json(getCampaignsByAgeGender(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/efficiency', (req, res) => { try { res.json(getEfficiency(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/efficiency/trends', (req, res) => { try { res.json(getEfficiencyTrends(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/recommendations', (req, res) => { try { res.json(getRecommendations(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/countries', (req, res) => { try { res.json(getAvailableCountries(req.query.store)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/countries/trends', (req, res) => { try { res.json(getCountryTrends(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/shopify/time-of-day', (req, res) => { try { res.json(getShopifyTimeOfDay(req.query.store, req.query)); } catch (e) { res.status(500).json({ error: e.message }); } });

export default router;
