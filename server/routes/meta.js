import express from 'express';
import {
  getAdAccounts,
  getCampaigns,
  getCampaignAds,
  getAdVideoDetails
} from '../services/metaCreativeService.js';

const router = express.Router();

router.get('/adaccounts', async (req, res) => {
  const store = req.query.store || 'vironax';
  try {
    const data = await getAdAccounts(store);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Meta] Ad accounts error:', error);
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

router.get('/campaigns', async (req, res) => {
  const store = req.query.store || 'vironax';
  const { adAccountId } = req.query;
  try {
    const data = await getCampaigns(store, adAccountId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Meta] Campaigns error:', error);
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

router.get('/campaigns/:campaignId/ads', async (req, res) => {
  const store = req.query.store || 'vironax';
  const { campaignId } = req.params;
  try {
    const data = await getCampaignAds(store, campaignId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Meta] Campaign ads error:', error);
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

router.get('/ads/:adId/video', async (req, res) => {
  const store = req.query.store || 'vironax';
  const { adId } = req.params;
  try {
    const data = await getAdVideoDetails(store, adId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Meta] Ad video error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
