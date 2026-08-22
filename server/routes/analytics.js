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
  getNewYorkTrends,
  getCampaignTrends,
  getCtrTrends,
  getCampaignsByAgeGender,
  getShopifyTimeOfDay,
  getTimeOfDay,
  getOrdersByDayOfWeek,
  getCitiesByCountry,
  getMetaAdManagerHierarchy,
  getFunnelDiagnostics,
  getPerformancePulse,
  getReactivationCandidates,
  getAllMetaObjects
} from '../services/analyticsService.js';
import { getGoogleAdManagerHierarchy } from '../services/googleAdsService.js';
import { importMetaDailyRows } from '../services/metaImportService.js';
import { syncMetaData, getBackfillStatus, triggerBackfill } from '../services/metaService.js';
import { getShopifyConnectionStatus, syncShopifyOrders } from '../services/shopifyService.js';

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

// Performance pulse cards (compact second hierarchy under KPI cards)
router.get('/performance-pulse', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = await getPerformancePulse(store, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Analytics] Performance pulse error:', error);
    res.status(500).json({ success: false, error: error.message });
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

router.get('/ctr-trends', (req, res) => {
  try { res.json(getCtrTrends(req.query.store || 'vironax', req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/countries/trends', (req, res) => {
  try { res.json(getCountryTrends(req.query.store, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/newyork/trends', (req, res) => {
  try { res.json(getNewYorkTrends(req.query.store, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/campaigns/trends', (req, res) => {
  try { res.json(getCampaignTrends(req.query.store, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/shopify/time-of-day', (req, res) => {
  try { res.json(getShopifyTimeOfDay(req.query.store, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Shopify connection/health status (Shawq)
router.get('/shopify/status', (req, res) => {
  try {
    res.json(getShopifyConnectionStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
router.get('/meta-ad-manager', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = await getMetaAdManagerHierarchy(store, req.query);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Google Ads hierarchy endpoint
router.get('/google-ad-manager', async (req, res) => {
  try {
    res.json(await getGoogleAdManagerHierarchy(req.query));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Funnel diagnostics endpoint
// Supports ?includeInactive=true
router.get('/funnel-diagnostics', (req, res) => {
  try {
    const { store, startDate, endDate, campaignId, includeInactive, baselineMode } = req.query;
    const data = getFunnelDiagnostics(store || 'vironax', { startDate, endDate, campaignId, includeInactive, baselineMode });
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

// ============================================================================
// TRIGGER SHOPIFY BACKFILL
// Pulls a wider order history than the rolling sync window without a redeploy.
// Shopify is Shawq's storefront (Vironax sells through Salla), so it defaults to shawq.
// ============================================================================
const DEFAULT_SHOPIFY_BACKFILL_DAYS = 730;

router.post('/shopify/backfill', (req, res) => {
  const store = String(req.query.store || req.body?.store || 'shawq').trim().toLowerCase();
  const requestedDays = req.query.days ?? req.query.rangeDays ?? req.body?.days ?? req.body?.rangeDays;
  const parsedDays = Number.parseInt(String(requestedDays ?? DEFAULT_SHOPIFY_BACKFILL_DAYS), 10);
  const rangeDays = Number.isFinite(parsedDays) && parsedDays > 0
    ? parsedDays
    : DEFAULT_SHOPIFY_BACKFILL_DAYS;

  // A long range paginates through the Shopify API for minutes, well past a gateway
  // timeout, so kick it off and report progress to the logs like the Meta backfill does.
  syncShopifyOrders({ storeKeys: [store], rangeDays })
    .then((result) => {
      if (result?.success) {
        console.log(
          `[Shopify] Backfill ${store}: ${result.records} order(s) over ${result.rangeDays} day(s) ` +
            `(${result.startDate}..${result.endDate})`
        );
      } else {
        console.warn(`[Shopify] Backfill ${store} failed: ${result?.message || 'unknown error'}`);
      }
    })
    .catch((error) => {
      console.error(`[Shopify] Backfill ${store} error:`, error?.message || error);
    });

  res.status(202).json({
    success: true,
    started: true,
    store,
    rangeDays,
    message: 'Shopify backfill started; it runs in the background. Watch the logs for [Shopify] Backfill.'
  });
});

export default router;
