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
  getFunnelDiagnostics,
  getReactivationCandidates,
  getAllMetaObjects
} from '../services/analyticsService.js';
import { importMetaDailyRows } from '../services/metaImportService.js';
import { syncMetaData, getBackfillStatus, triggerBackfill } from '../services/metaService.js';

const router = express.Router();

// 1. Dashboard Data
// Supports ?includeInactive=true to show inactive campaigns/adsets/ads
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
    res.json(getOrdersByDayOfWeek(store, { period, ...req.query }));
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
// Supports ?includeInactive=true to show inactive campaigns/adsets/ads
router.get('/meta-ad-manager', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    res.json(getMetaAdManagerHierarchy(store, req.query));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Funnel diagnostics endpoint
// Supports ?includeInactive=true
router.get('/funnel-diagnostics', (req, res) => {
  try {
    const { store, startDate, endDate, campaignId, includeInactive } = req.query;
    const data = getFunnelDiagnostics(store || 'vironax', { startDate, endDate, campaignId, includeInactive });
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Funnel diagnostics error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// REACTIVATION CANDIDATES ENDPOINT
// Returns inactive campaigns/adsets/ads with good historical performance
// for AI to recommend reactivation
// Uses Meta Awareness feature module for consistent scoring and data
// ============================================================================
router.get('/reactivation-candidates', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getReactivationCandidates(store, req.query);
    // Return data directly for frontend compatibility
    res.json(data);
  } catch (error) {
    console.error('[Analytics] Reactivation candidates error:', error);
    res.status(500).json({ error: error.message, campaigns: [], adsets: [], ads: [], summary: { total: 0 } });
  }
});

// ============================================================================
// NEW: META OBJECTS ENDPOINT
// Returns all campaigns/adsets/ads with their status info
// Used by AI for full account visibility
// ============================================================================
router.get('/meta-objects', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getAllMetaObjects(store, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Meta objects error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// NEW: BACKFILL STATUS ENDPOINT
// Returns the status of historical data backfill
// ============================================================================
router.get('/meta/backfill-status', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const status = getBackfillStatus(store);
    res.json({ success: true, data: status });
  } catch (error) {
    console.error('[Analytics] Backfill status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// NEW: TRIGGER BACKFILL ENDPOINT
// Manually trigger historical data backfill
// ============================================================================
router.post('/meta/backfill', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const result = await triggerBackfill(store);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[Analytics] Backfill trigger error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
