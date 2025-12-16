import express from 'express';
import budgetIntelligenceService from '../services/budgetIntelligenceService.js';
import aiBudgetBridge from '../services/aiBudgetBridge.js';
import weeklyAggregationService from '../services/weeklyAggregationService.js';
import { getAiBudgetMetaDataset } from '../features/aibudget/metaDataset.js';

const router = express.Router();

/**
 * GET /api/aibudget
 * Base AI Budget dataset (hierarchy + metrics)
 * Returns granular daily data for the frontend Data Sufficiency Advisor and Sanity Check
 * Format: { metrics: { campaignDaily, adsetDaily, adDaily }, hierarchy: { campaigns, adsets, ads } }
 */
router.get('/', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { startDate, endDate, days, lookback, includeInactive } = req.query;

    console.log(`[aibudget] GET / - store: ${store}, lookback: ${lookback}, days: ${days}`);

    // Calculate date range based on lookback or provided dates
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (lookback) {
      effectiveEndDate = new Date().toISOString().split('T')[0];
      const daysBack = {
        '7d': 7, '1week': 7,
        '14d': 14, '2weeks': 14,
        '30d': 30, '4weeks': 30,
        '90d': 90, '12weeks': 84,
        'alltime': 365, 'full': 365
      }[lookback] || 30;

      const start = new Date();
      start.setDate(start.getDate() - daysBack);
      effectiveStartDate = start.toISOString().split('T')[0];
    } else if (!startDate && days) {
      effectiveEndDate = new Date().toISOString().split('T')[0];
      const d = parseInt(days) || 30;
      const start = new Date();
      start.setDate(start.getDate() - d);
      effectiveStartDate = start.toISOString().split('T')[0];
    }

    // Get granular daily data from metaDataset (the format frontend expects)
    const result = getAiBudgetMetaDataset(store, {
      startDate: effectiveStartDate,
      endDate: effectiveEndDate
    });

    // Return in the format frontend expects:
    // { metrics: { campaignDaily, adsetDaily, adDaily }, hierarchy: { campaigns, adsets, ads } }
    res.json({
      success: result.success,
      store: result.store,
      dateRange: result.dateRange,
      metrics: result.metrics,
      hierarchy: result.hierarchy
    });
  } catch (error) {
    console.error('❌ [aibudget] Error getting AI Budget dataset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get AI Budget dataset',
      message: error.message,
      metrics: { campaignDaily: [], adsetDaily: [], adDaily: [] },
      hierarchy: { campaigns: [], adsets: [], ads: [] }
    });
  }
});

/**
 * GET /api/aibudget/recommendations
 * Get AI-powered budget recommendations
 * Query params: store, startDate, endDate, lookback
 * Now uses aiBudgetBridge for unified data flow
 */
router.get('/recommendations', async (req, res) => {
  try {
    const { store = 'vironax', startDate, endDate, lookback } = req.query;

    console.log(`[aibudget] GET /recommendations - store: ${store}, lookback: ${lookback}`);

    let result;

    // Use lookback if provided, otherwise use date range
    if (lookback) {
      result = await aiBudgetBridge.fetchByLookback(store, lookback);
    } else if (startDate && endDate) {
      result = await aiBudgetBridge.fetchAIBudgetData(store, startDate, endDate);
    } else {
      // Default to 30 days
      result = await aiBudgetBridge.fetchByLookback(store, '30d');
    }

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch data');
    }

    // Pass data to budget intelligence service for recommendations
    const recommendations = await budgetIntelligenceService.getAIRecommendations(result.data, startDate, endDate);

    res.json({
      success: true,
      data: recommendations,
      totals: result.totals,
      meta: {
        ...result.meta,
        lookback: lookback || 'custom'
      }
    });

  } catch (error) {
    console.error('❌ [aibudget] Error getting AI budget recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get AI budget recommendations',
      message: error.message
    });
  }
});

/**
 * GET /api/aibudget/weekly-summary
 * Get weekly aggregated summary
 * Query params: lookback (1week, 2weeks, 4weeks, alltime)
 */
router.get('/weekly-summary', async (req, res) => {
  try {
    const { lookback = '4weeks' } = req.query;
    
    const summary = await weeklyAggregationService.getWeeklySummary(lookback);

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('❌ Error getting weekly summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get weekly summary',
      message: error.message
    });
  }
});

/**
 * GET /api/aibudget/campaign/:id
 * Get specific campaign data
 * Query params: weeksBack (default: 4)
 */
router.get('/campaign/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { weeksBack = 4 } = req.query;

    const data = await aiBudgetDataAdapter.getCampaignTimeSeries(
      parseInt(id), 
      parseInt(weeksBack)
    );

    res.json({
      success: true,
      data: data,
      meta: {
        campaignId: id,
        weeksBack: weeksBack,
        recordCount: data.length
      }
    });

  } catch (error) {
    console.error('❌ Error getting campaign data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign data',
      message: error.message
    });
  }
});

/**
 * GET /api/aibudget/data
 * Get raw AIBudget data with standard schema
 * Query params: startDate, endDate
 */
router.get('/data', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate and endDate are required'
      });
    }

    const data = await aiBudgetDataAdapter.getAIBudgetData(startDate, endDate);

    res.json({
      success: true,
      data: data,
      meta: {
        recordCount: data.length,
        dateRange: { startDate, endDate }
      }
    });

  } catch (error) {
    console.error('❌ Error getting AIBudget data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get AIBudget data',
      message: error.message
    });
  }
});

export default router;
