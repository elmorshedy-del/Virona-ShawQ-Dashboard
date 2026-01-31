// server/routes/fatigue.js
// API routes for Creative Fatigue & Audience Saturation Detection

import express from 'express';
import { getFatigueAnalysis, getAdFatigueDetail } from '../services/fatigueDetectorService.js';

const router = express.Router();

// Get fatigue analysis for all ad sets
router.get('/', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getFatigueAnalysis(store, req.query);
    res.json(data);
  } catch (error) {
    console.error('[Fatigue] Analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get detailed analysis for a specific ad
router.get('/ad/:adId', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getAdFatigueDetail(store, req.params.adId, req.query);
    res.json(data);
  } catch (error) {
    console.error('[Fatigue] Ad detail error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
