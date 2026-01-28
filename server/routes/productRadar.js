import express from 'express';
import { runProductRadarScan } from '../services/productRadarService.js';

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    success: true,
    sources: {
      googleTrends: { available: true, configured: true },
      metaAdLibrary: {
        available: true,
        configured: !!process.env.APIFY_API_TOKEN,
        reason: process.env.APIFY_API_TOKEN ? null : 'APIFY_API_TOKEN not set'
      }
    },
    timestamp: new Date().toISOString()
  });
});

router.post('/scan', async (req, res) => {
  try {
    const {
      query,
      geo = '',
      timeframeDays = 90,
      maxCandidates = 12,
      maxMetaChecks = 6,
      includeMetaAds = true,
      metaCountry = 'ALL',
      metaLimit = 25
    } = req.body || {};

    const data = await runProductRadarScan({
      query,
      geo,
      timeframeDays: Number(timeframeDays) || 90,
      maxCandidates: Number(maxCandidates) || 12,
      maxMetaChecks: Number(maxMetaChecks) || 6,
      includeMetaAds: !!includeMetaAds,
      metaCountry: String(metaCountry || 'ALL'),
      metaLimit: Number(metaLimit) || 25
    });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Product Radar scan error:', error);
    res.status(500).json({
      success: false,
      error: error?.code || 'PRODUCT_RADAR_SCAN_FAILED',
      message: error?.message || 'Failed to scan Product Radar'
    });
  }
});

export default router;
