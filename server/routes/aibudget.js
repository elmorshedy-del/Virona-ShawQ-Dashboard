import express from 'express';
import aiBudgetService from '../services/aiBudgetService.js';
import budgetIntelligenceService from '../services/budgetIntelligenceService.js';

const router = express.Router();

/**
 * GET /api/aibudget
 * Base AI Budget dataset (hierarchy + metrics)
 * Query: store, startDate, endDate, lookback, includeInactive
 */
router.get('/', async (req, res) => {
  try {
    const { 
      store = 'vironax', 
      startDate, 
      endDate, 
      lookback, 
      includeInactive 
    } = req.query;

    const options = {
      startDate,
      endDate,
      lookback,
      includeInactive: includeInactive === 'true' || includeInactive === true
    };

    const result = await aiBudgetService.getData(store, options);

    res.json(result);
  } catch (error) {
    console.error('[aibudget] GET / error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get AI Budget dataset',
      message: error.message,
      hierarchy: { campaigns: [], adsets: [], ads: [] },
      metrics: { campaignDaily: [], adsetDaily: [], adDaily: [] }
    });
  }
});

/**
 * GET /api/aibudget/recommendations
 * AI-powered budget recommendations
 * Query: store, startDate, endDate, lookback
 */
router.get('/recommendations', async (req, res) => {
  try {
    const { 
      store = 'vironax', 
      startDate, 
      endDate, 
      lookback 
    } = req.query;

    const options = { startDate, endDate, lookback };
    
    // Get aggregated data
    const result = await aiBudgetService.getAggregatedData(store, options);

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch data');
    }

    // Generate AI recommendations
    const recommendations = await budgetIntelligenceService.getAIRecommendations(
      result.data, 
      options.startDate, 
      options.endDate
    );

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
    console.error('[aibudget] GET /recommendations error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get AI budget recommendations',
      message: error.message
    });
  }
});

/**
 * GET /api/aibudget/campaign/:id
 * Get specific campaign data
 * Query: weeksBack (default: 4)
 */
router.get('/campaign/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { weeksBack = 4, store = 'vironax' } = req.query;

    const days = parseInt(weeksBack) * 7;
    const options = { lookback: `${days}d` };

    const result = await aiBudgetService.getData(store, options);

    if (!result.success) {
      throw new Error('Campaign not found');
    }

    // Filter for specific campaign
    const campaignMetrics = result.metrics.campaignDaily.filter(
      m => m.campaign_id === id
    );

    const campaignInfo = result.hierarchy.campaigns.find(
      c => c.object_id === id
    );

    res.json({
      success: true,
      campaign: campaignInfo,
      metrics: campaignMetrics,
      meta: {
        campaignId: id,
        weeksBack,
        recordCount: campaignMetrics.length
      }
    });

  } catch (error) {
    console.error('[aibudget] GET /campaign/:id error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign data',
      message: error.message
    });
  }
});

/**
 * POST /api/aibudget/cache/clear
 * Clear service cache
 */
router.post('/cache/clear', async (req, res) => {
  try {
    aiBudgetService.clearCache();
    res.json({
      success: true,
      message: 'Cache cleared'
    });
  } catch (error) {
    console.error('[aibudget] POST /cache/clear error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
      message: error.message
    });
  }
});

export default router;
