import express from 'express';
import { getCustomerInsightsPayload } from '../services/customerInsightsService.js';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const data = getCustomerInsightsPayload(store, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Customer insights error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load customer insights',
      message: error.message
    });
  }
});

export default router;
