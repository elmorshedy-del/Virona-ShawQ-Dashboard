import express from 'express';
import budgetIntelligenceService from '../services/budgetIntelligenceService.js';
import aiBudgetDataAdapter from '../services/aiBudgetDataAdapter.js';
import weeklyAggregationService from '../services/weeklyAggregationService.js';
import metaAIBudgetBridge from '../services/metaAIBudgetBridge.js';

const router = express.Router();

/**
 * GET /api/aibudget
 * Base AI Budget dataset with full hierarchy and standardized metrics
 * Query params: store (default: shawq), startDate, endDate
 */
router.get('/', async (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const { startDate, endDate } = req.query;

    // Use unified bridge for standardized data with hierarchy
    const data = await metaAIBudgetBridge.getStandardizedData(store, {
      startDate,
      endDate
    });

    res.json({
      success: true,
      store,
      dateRange: data.dateRange,
      hierarchy: data.hierarchy,
      rows: data.rows,
      summary: {
        totalRows: data.rows.length,
        campaignRows: data.rows.filter(r => r.level === 'campaign').length,
        adsetRows: data.rows.filter(r => r.level === 'adset').length,
        adRows: data.rows.filter(r => r.level === 'ad').length
      }
    });
  } catch (error) {
    console.error('Error getting AI Budget dataset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get AI Budget dataset',
      message: error.message
    });
  }
});

/**
 * GET /api/aibudget/recommendations
 * Get AI-powered budget recommendations
 * Query params: store, startDate, endDate, lookback
 */
router.get('/recommendations', async (req, res) => {
  try {
    const { startDate, endDate, lookback, store = 'shawq' } = req.query;

    let data;

    // Use lookback if provided, otherwise use date range
    if (lookback) {
      const weeklyData = await weeklyAggregationService.getWeeklySummary(store, lookback);
      data = weeklyData.rawData;
    } else if (startDate && endDate) {
      data = await aiBudgetDataAdapter.getWeeklyAggregatedData(store, { startDate, endDate });
    } else {
      // Default to 4 weeks
      const weeklyData = await weeklyAggregationService.getWeeklySummary(store, '4weeks');
      data = weeklyData.rawData;
    }

    // Pass normalized data to budget intelligence service
    const recommendations = await budgetIntelligenceService.getAIRecommendations(data, startDate, endDate);

    res.json({
      success: true,
      data: recommendations,
      meta: {
        store,
        recordCount: data.length,
        dateRange: { startDate, endDate },
        lookback: lookback || 'custom'
      }
    });

  } catch (error) {
    console.error('Error getting AI budget recommendations:', error);
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
 * Query params: store (default: shawq), lookback (1week, 2weeks, 4weeks, alltime)
 */
router.get('/weekly-summary', async (req, res) => {
  try {
    const { lookback = '4weeks', store = 'shawq' } = req.query;

    const summary = await weeklyAggregationService.getWeeklySummary(store, lookback);

    res.json({
      success: true,
      store,
      data: summary
    });

  } catch (error) {
    console.error('Error getting weekly summary:', error);
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
      id,
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
    console.error('Error getting campaign data:', error);
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
 * Query params: store (default: shawq), startDate, endDate
 */
router.get('/data', async (req, res) => {
  try {
    const { startDate, endDate, store = 'shawq' } = req.query;

    const data = await aiBudgetDataAdapter.getAIBudgetData(store, { startDate, endDate });

    res.json({
      success: true,
      store,
      data: data,
      meta: {
        recordCount: data.length,
        dateRange: { startDate, endDate },
        levels: {
          campaign: data.filter(r => r.level === 'campaign').length,
          adset: data.filter(r => r.level === 'adset').length,
          ad: data.filter(r => r.level === 'ad').length
        }
      }
    });

  } catch (error) {
    console.error('Error getting AIBudget data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get AIBudget data',
      message: error.message
    });
  }
});

/**
 * GET /api/aibudget/data/:level
 * Get AIBudget data filtered by level
 * Params: level (campaign, adset, ad)
 * Query params: store (default: shawq), startDate, endDate
 */
router.get('/data/:level', async (req, res) => {
  try {
    const { level } = req.params;
    const { startDate, endDate, store = 'shawq' } = req.query;

    if (!['campaign', 'adset', 'ad'].includes(level)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid level. Must be campaign, adset, or ad'
      });
    }

    const data = await aiBudgetDataAdapter.getDataByLevel(store, level, { startDate, endDate });

    res.json({
      success: true,
      store,
      level,
      data: data,
      meta: {
        recordCount: data.length,
        dateRange: { startDate, endDate }
      }
    });

  } catch (error) {
    console.error(`Error getting ${req.params.level} data:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to get ${req.params.level} data`,
      message: error.message
    });
  }
});

/**
 * GET /api/aibudget/totals
 * Get aggregated totals
 * Query params: store (default: shawq), startDate, endDate
 */
router.get('/totals', async (req, res) => {
  try {
    const { startDate, endDate, store = 'shawq' } = req.query;

    const totals = await aiBudgetDataAdapter.getAggregatedTotals(store, { startDate, endDate });

    res.json({
      success: true,
      store,
      data: totals,
      meta: {
        dateRange: { startDate, endDate }
      }
    });

  } catch (error) {
    console.error('Error getting totals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get totals',
      message: error.message
    });
  }
});

export default router;
