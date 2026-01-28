import express from 'express';
import { getInsightsPayload } from '../services/insightsService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const data = await getInsightsPayload(store, req.query);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Insights error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load insights',
      message: error.message
    });
  }
});

export default router;
