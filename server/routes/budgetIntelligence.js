const express = require('express');
const router = express.Router();
const budgetIntelligenceService = require('../services/budgetIntelligenceService');
const aiBudgetDataAdapter = require('../services/aiBudgetDataAdapter');
const weeklyAggregationService = require('../services/weeklyAggregationService');

/**
 * GET /api/budget-intelligence/analysis
 * Get intelligent budget analysis
 */
router.get('/analysis', async (req, res) => {
  try {
    const { startDate, endDate, lookback } = req.query;

    let data;

    if (lookback) {
      const weeklyData = await weeklyAggregationService.getWeeklySummary(lookback);
      data = weeklyData.rawData;
    } else if (startDate && endDate) {
      data = await aiBudgetDataAdapter.getWeeklyAggregatedData(startDate, endDate);
    } else {
      const weeklyData = await weeklyAggregationService.getWeeklySummary('4weeks');
      data = weeklyData.rawData;
    }

    const analysis = await budgetIntelligenceService.analyzeBudgetPerformance(data);

    res.json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('❌ Error in budget intelligence analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze budget performance',
      message: error.message
    });
  }
});

/**
 * GET /api/budget-intelligence/recommendations
 * Same as aibudget recommendations (alias)
 */
router.get('/recommendations', async (req, res) => {
  try {
    const { startDate, endDate, lookback } = req.query;

    let data;

    if (lookback) {
      const weeklyData = await weeklyAggregationService.getWeeklySummary(lookback);
      data = weeklyData.rawData;
    } else if (startDate && endDate) {
      data = await aiBudgetDataAdapter.getWeeklyAggregatedData(startDate, endDate);
    } else {
      const weeklyData = await weeklyAggregationService.getWeeklySummary('4weeks');
      data = weeklyData.rawData;
    }

    const recommendations = await budgetIntelligenceService.getAIRecommendations(data, startDate, endDate);

    res.json({
      success: true,
      data: recommendations
    });

  } catch (error) {
    console.error('❌ Error getting recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendations',
      message: error.message
    });
  }
});

module.exports = router;
