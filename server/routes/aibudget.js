import express from 'express';
import budgetIntelligenceService from '../services/budgetIntelligenceService.js';
import aiBudgetBridge from '../services/aiBudgetBridge.js';
import weeklyAggregationService from '../services/weeklyAggregationService.js';

const router = express.Router();

/**
 * GET /api/aibudget
 * Base AI Budget dataset (hierarchy + metrics)
 * Now uses aiBudgetBridge for unified data flow
 */
router.get('/', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { startDate, endDate, days, lookback, includeInactive } = req.query;
    
    console.log(`[aibudget] GET / - store: ${store}, lookback: ${lookback}, days: ${days}`);

    let result;
    
    // Support lookback periods (e.g., '14d', '30d', '90d', 'alltime')
    if (lookback) {
      result = await aiBudgetBridge.fetchByLookback(store, lookback, {
        includeInactive: includeInactive === 'true'
      });
    } else {
      result = await aiBudgetBridge.fetchAIBudgetData(store, startDate, endDate, {
        days: days ? parseInt(days) : 30,
        includeInactive: includeInactive === 'true'
      });
    }

    res.json(result);
  } catch (error) {
    console.error('❌ [aibudget] Error getting AI Budget dataset:', error);
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
 * Query params: startDate, endDate, lookback
 */
router.get('/recommendations', async (req, res) => {
  try {
    const { startDate, endDate, lookback } = req.query;

    let data;

    // Use lookback if provided, otherwise use date range
    if (lookback) {
      const weeklyData = await weeklyAggregationService.getWeeklySummary(lookback);
      data = weeklyData.rawData;
    } else if (startDate && endDate) {
      data = await aiBudgetDataAdapter.getWeeklyAggregatedData(startDate, endDate);
    } else {
      // Default to 4 weeks
      const weeklyData = await weeklyAggregationService.getWeeklySummary('4weeks');
      data = weeklyData.rawData;
    }

    // Pass normalized data to budget intelligence service
    // The service will use its existing math/logic
    const recommendations = await budgetIntelligenceService.getAIRecommendations(data, startDate, endDate);

    res.json({
      success: true,
      data: recommendations,
      meta: {
        recordCount: data.length,
        dateRange: { startDate, endDate },
        lookback: lookback || 'custom'
      }
    });

  } catch (error) {
    console.error('❌ Error getting AI budget recommendations:', error);
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
