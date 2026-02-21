import express from 'express';
import { getCampaignIntelligenceSnapshot } from '../services/campaignIntelligence/service.js';

const router = express.Router();

router.get('/snapshot', async (req, res) => {
  try {
    const data = await getCampaignIntelligenceSnapshot(req.query || {});
    res.json(data);
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : 500;
    if (statusCode >= 500) {
      console.error('[CampaignIntelligence] Snapshot error:', error);
    }
    res.status(statusCode).json({
      success: false,
      error: error?.message || 'Failed to generate campaign intelligence snapshot'
    });
  }
});

export default router;
