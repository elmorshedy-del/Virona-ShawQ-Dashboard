import express from 'express';
import CampaignIntelligenceService from '../services/campaignIntelligenceService.js';

const router = express.Router();
let intelligenceService;

export const initService = (db) => {
  intelligenceService = new CampaignIntelligenceService(db);
};

router.get('/campaigns', async (req, res) => {
  try {
    const { store = 'vironax' } = req.query;
    const campaigns = await intelligenceService.getAllCampaigns(store);
    res.json({ success: true, campaigns });
  } catch (error) {
    console.error('Error getting campaigns:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/campaign/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { store = 'vironax' } = req.query;
    const analysis = await intelligenceService.analyzeCampaign(id, store);
    res.json({ success: true, analysis });
  } catch (error) {
    console.error('Error analyzing campaign:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/geo-comparison', async (req, res) => {
  try {
    const { store = 'vironax' } = req.query;
    const geos = await intelligenceService.getGeoComparison(store);
    res.json({ success: true, geos });
  } catch (error) {
    console.error('Error getting geo comparison:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/benchmarks', async (req, res) => {
  try {
    const { store = 'vironax', geo = 'SA' } = req.query;
    const benchmark = await intelligenceService.getBenchmark(geo, store);
    res.json({ success: true, benchmark });
  } catch (error) {
    console.error('Error getting benchmarks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/compare-adsets', async (req, res) => {
  try {
    const { adSetA, adSetB } = req.body;

    if (!adSetA || !adSetB) {
      return res.status(400).json({
        success: false,
        error: 'Both adSetA and adSetB required with clicks and purchases',
      });
    }

    const comparison = intelligenceService.compareAdSets(adSetA, adSetB);
    res.json({ success: true, comparison });
  } catch (error) {
    console.error('Error comparing ad sets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/update-benchmarks', async (req, res) => {
  try {
    const { campaignId, store = 'vironax' } = req.body;
    const result = await intelligenceService.updateBenchmarksFromCampaign(campaignId, store);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error updating benchmarks:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const { store = 'vironax', limit = 20 } = req.query;
    const alerts = await intelligenceService.getAlerts(store, parseInt(limit, 10));
    res.json({ success: true, alerts });
  } catch (error) {
    console.error('Error getting alerts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/ad-sets/:campaignId', async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { store = 'vironax' } = req.query;

    const adSets = await intelligenceService.getAdSetsForCampaign(campaignId, store);
    res.json({ success: true, adSets });
  } catch (error) {
    console.error('Error getting ad sets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export { router };
export default router;
