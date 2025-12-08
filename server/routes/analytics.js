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
  getShopifyTimeOfDay,
  getTimeOfDay,
  getOrdersByDayOfWeek,
  getCitiesByCountry,
  getMetaAdManagerHierarchy,
  getFunnelDiagnostics
} from '../services/analyticsService.js';
import { importMetaDailyRows } from '../services/metaImportService.js';
import { syncMetaData } from '../services/metaService.js';

const router = express.Router();

// 1. Dashboard Data
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

// 2. Trigger Manual API Sync (The "Sync Meta Now" Button)
router.post('/meta/sync-now', async (req, res) => {
  const store = req.query.store;
  try {
    const result = await syncMetaData(store);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Clear Meta Data (The "Reset Data" Button)
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

// 4. Import Meta Data (The CSV Upload)
router.post('/meta/import', async (req, res) => {
  try {
    const store = req.query.store || req.body.store;
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

    if (!store) {
      return res.status(400).json({ error: 'store is required' });
    }
    if (rows.length === 0) {
      return res.json({ ok: true, inserted: 0, updated: 0, skipped: 0 });
    }

    const result = importMetaDailyRows(store, rows);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Meta import error:', err);
    res.status(500).json({ error: err?.message || 'Meta import failed' });
  }
});

// 5. Breakdown Routes
router.get('/campaigns/by-country', (req, res) => {
  try { res.json(getCampaignsByCountry(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/by-age', (req, res) => {
  try { res.json(getCampaignsByAge(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/by-gender', (req, res) => {
  try { res.json(getCampaignsByGender(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/by-placement', (req, res) => {
  try { res.json(getCampaignsByPlacement(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/by-age-gender', (req, res) => {
  try { res.json(getCampaignsByAgeGender(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 6. Other Analytics Routes
router.get('/efficiency', (req, res) => {
  try { res.json(getEfficiency(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/efficiency/trends', (req, res) => {
  try { res.json(getEfficiencyTrends(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/recommendations', (req, res) => {
  try { res.json(getRecommendations(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/countries', (req, res) => {
  try { res.json(getAvailableCountries(req.query.store)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/countries/trends', (req, res) => {
  try { res.json(getCountryTrends(req.query.store, req.query)); } 
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/shopify/time-of-day', (req, res) => {
  try { res.json(getShopifyTimeOfDay(req.query.store, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Combined time of day endpoint (supports both stores)
router.get('/time-of-day', (req, res) => {
  try { res.json(getTimeOfDay(req.query.store, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Days of week endpoint
router.get('/days-of-week', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const period = req.query.period || '14d';
    res.json(getOrdersByDayOfWeek(store, { period }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cities by country endpoint
router.get('/cities/:countryCode', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { countryCode } = req.params;
    res.json(getCitiesByCountry(store, countryCode, req.query));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Meta Ad Manager hierarchy endpoint
router.get('/meta-ad-manager', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    res.json(getMetaAdManagerHierarchy(store, req.query));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Funnel diagnostics endpoint
router.get('/funnel-diagnostics', (req, res) => {
  try {
    const { store, startDate, endDate, campaignId } = req.query;
    const data = getFunnelDiagnostics(store || 'vironax', { startDate, endDate, campaignId });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Funnel diagnostics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
