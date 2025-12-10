// ============================================================================
// whatif.js - BACKEND ROUTE
// Place in: server/routes/whatif.js
// Purpose: API endpoints for What-If Budget Simulator
// ============================================================================

import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import {
  syncWhatIfData,
  smartSync,
  getSyncStatus,
  getCampaigns,
  getAdsets,
  getTimeseries,
  getSmartLookbackData,
  getDataHealth,
  importCSV,
  STORE_CONFIG
} from '../services/whatifMetaService.js';

const router = express.Router();

// Configure multer for CSV uploads (in-memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// ============================================================================
// SYNC ENDPOINTS
// ============================================================================

/**
 * GET /api/whatif/status/:store
 * Get sync status for a store
 */
router.get('/status/:store', (req, res) => {
  try {
    const { store } = req.params;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    const status = getSyncStatus(store);
    const health = getDataHealth(store);
    
    res.json({
      ...status,
      health,
      currency: STORE_CONFIG[store].currency
    });
  } catch (error) {
    console.error('[WhatIf Route] Status error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/whatif/sync/:store
 * Trigger manual sync for a store
 */
router.post('/sync/:store', async (req, res) => {
  try {
    const { store } = req.params;
    const { fullSync, lookbackDays } = req.body;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    console.log(`[WhatIf Route] Manual sync triggered for ${store}`);
    
    let result;
    if (fullSync) {
      result = await syncWhatIfData(store, { lookbackDays });
    } else {
      result = await smartSync(store);
    }
    
    res.json(result);
  } catch (error) {
    console.error('[WhatIf Route] Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CAMPAIGN & ADSET ENDPOINTS
// ============================================================================

/**
 * GET /api/whatif/campaigns/:store
 * Get list of campaigns for a store
 */
router.get('/campaigns/:store', (req, res) => {
  try {
    const { store } = req.params;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    const campaigns = getCampaigns(store);
    
    res.json({
      store,
      currency: STORE_CONFIG[store].currency,
      campaigns,
      count: campaigns.length
    });
  } catch (error) {
    console.error('[WhatIf Route] Campaigns error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/whatif/adsets/:store/:campaignId
 * Get ad sets for a campaign
 */
router.get('/adsets/:store/:campaignId', (req, res) => {
  try {
    const { store, campaignId } = req.params;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    const adsets = getAdsets(store, campaignId);
    
    res.json({
      store,
      campaignId,
      currency: STORE_CONFIG[store].currency,
      adsets,
      count: adsets.length
    });
  } catch (error) {
    console.error('[WhatIf Route] Adsets error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// TIMESERIES & DATA ENDPOINTS
// ============================================================================

/**
 * GET /api/whatif/timeseries/:store/:campaignId
 * Get timeseries data for a campaign
 * Query params: adsetId, lookbackDays
 */
router.get('/timeseries/:store/:campaignId', (req, res) => {
  try {
    const { store, campaignId } = req.params;
    const { adsetId, lookbackDays } = req.query;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    const data = getTimeseries(store, campaignId, {
      adsetId,
      lookbackDays: lookbackDays ? parseInt(lookbackDays, 10) : null
    });
    
    res.json({
      store,
      campaignId,
      adsetId: adsetId || 'all',
      currency: STORE_CONFIG[store].currency,
      data,
      count: data.length
    });
  } catch (error) {
    console.error('[WhatIf Route] Timeseries error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/whatif/smart-data/:store/:campaignId
 * Get data with smart lookback resolution
 * Query params: lookback (auto, 7d, 14d, 30d, all)
 */
router.get('/smart-data/:store/:campaignId', (req, res) => {
  try {
    const { store, campaignId } = req.params;
    const { lookback = 'auto' } = req.query;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    const result = getSmartLookbackData(store, campaignId, lookback);
    
    res.json({
      store,
      campaignId,
      currency: STORE_CONFIG[store].currency,
      requestedLookback: lookback,
      ...result
    });
  } catch (error) {
    console.error('[WhatIf Route] Smart data error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/whatif/health/:store
 * Get data health metrics
 * Query params: campaignId (optional)
 */
router.get('/health/:store', (req, res) => {
  try {
    const { store } = req.params;
    const { campaignId } = req.query;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    const health = getDataHealth(store, campaignId);
    
    res.json({
      store,
      campaignId: campaignId || 'all',
      currency: STORE_CONFIG[store].currency,
      ...health
    });
  } catch (error) {
    console.error('[WhatIf Route] Health error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CSV UPLOAD ENDPOINTS
// ============================================================================

/**
 * POST /api/whatif/upload-csv/:store
 * Upload CSV data (override or complement)
 * Body: mode (override/complement), campaignId (for scoped import)
 */
router.post('/upload-csv/:store', upload.single('file'), (req, res) => {
  try {
    const { store } = req.params;
    const { mode = 'complement', campaignId } = req.body;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Parse CSV
    const csvContent = req.file.buffer.toString('utf-8');
    let rows;
    
    try {
      rows = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } catch (parseError) {
      return res.status(400).json({
        error: 'Invalid CSV format',
        details: parseError.message
      });
    }
    
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'CSV is empty' });
    }
    
    // Import CSV
    const result = importCSV(store, rows, mode, campaignId);
    
    res.json({
      store,
      currency: STORE_CONFIG[store].currency,
      ...result
    });
  } catch (error) {
    console.error('[WhatIf Route] CSV upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/whatif/csv-template
 * Download CSV template
 */
router.get('/csv-template', (req, res) => {
  const template = `date,campaign_id,campaign_name,adset_id,adset_name,spend,purchases,revenue,impressions,clicks,atc,ic,reach,frequency
2024-01-01,123456789,My Campaign,987654321,My Adset,100.00,5,500.00,10000,250,50,25,8000,1.25
2024-01-02,123456789,My Campaign,987654321,My Adset,120.00,7,700.00,12000,300,60,30,9000,1.33`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=whatif_template.csv');
  res.send(template);
});

// ============================================================================
// PREDICTION ENDPOINT (for advanced server-side calculations)
// ============================================================================

/**
 * POST /api/whatif/predict/:store
 * Run prediction with given parameters
 * Body: campaignId, budget, structure (ABO/CBO/ASC), horizon, lookback
 */
router.post('/predict/:store', (req, res) => {
  try {
    const { store } = req.params;
    const { 
      campaignId, 
      budget, 
      structure = 'CBO',
      horizon = 7,
      lookback = 'auto',
      adsetId = null 
    } = req.body;
    
    if (!STORE_CONFIG[store]) {
      return res.status(400).json({ error: 'Invalid store' });
    }
    
    if (!campaignId || budget === undefined) {
      return res.status(400).json({ error: 'campaignId and budget are required' });
    }
    
    // Get data with smart lookback
    const dataResult = getSmartLookbackData(store, campaignId, lookback);
    
    if (!dataResult.data || dataResult.data.length === 0) {
      return res.status(400).json({
        error: 'Insufficient data',
        details: 'No timeseries data available for this campaign'
      });
    }
    
    // Calculate prediction using blueprint math
    // NOTE: Full math is implemented in frontend (AIBudget.jsx)
    // This endpoint provides data + basic stats for server-side validation
    
    const data = dataResult.data;
    
    // Basic stats
    const totalSpend = data.reduce((sum, d) => sum + (d.spend || 0), 0);
    const totalRevenue = data.reduce((sum, d) => sum + (d.revenue || 0), 0);
    const totalPurchases = data.reduce((sum, d) => sum + (d.purchases || 0), 0);
    const avgDailySpend = totalSpend / dataResult.dataPoints;
    const avgDailyRevenue = totalRevenue / dataResult.dataPoints;
    const historicalROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    
    // Simple linear extrapolation (frontend does advanced Hill curve math)
    const spendRatio = avgDailySpend > 0 ? budget / avgDailySpend : 1;
    const projectedDailyRevenue = avgDailyRevenue * Math.min(spendRatio, 2); // Cap at 2x
    const projectedROAS = budget > 0 ? projectedDailyRevenue / budget : 0;
    
    // Confidence based on data quality
    let confidence = 'Low';
    if (dataResult.dataPoints >= 14 && totalPurchases >= 10) {
      confidence = 'High';
    } else if (dataResult.dataPoints >= 7 && totalPurchases >= 5) {
      confidence = 'Medium';
    }
    
    res.json({
      store,
      campaignId,
      currency: STORE_CONFIG[store].currency,
      input: {
        budget,
        structure,
        horizon,
        lookback: dataResult.resolvedLookback,
        adsetId
      },
      dataQuality: {
        dataPoints: dataResult.dataPoints,
        lookbackDays: dataResult.lookbackDays,
        totalPurchases,
        totalSpend,
        totalRevenue
      },
      prediction: {
        avgDailyRevenue: Math.round(projectedDailyRevenue * 100) / 100,
        projectedROAS: Math.round(projectedROAS * 100) / 100,
        confidence,
        // Note: P10/P90 ranges calculated in frontend with full math
        note: 'Full Hill curve + adstock modeling done in frontend'
      },
      historical: {
        avgDailySpend: Math.round(avgDailySpend * 100) / 100,
        avgDailyRevenue: Math.round(avgDailyRevenue * 100) / 100,
        historicalROAS: Math.round(historicalROAS * 100) / 100
      }
    });
  } catch (error) {
    console.error('[WhatIf Route] Predict error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
