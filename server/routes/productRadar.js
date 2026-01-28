import express from 'express';
import { runProductRadarScan } from '../services/productRadarService.js';
import {
  getProductRadarAiBaseUrl,
  getProductRadarAiHealth,
  isProductRadarAiConfigured
} from '../services/productRadarAiClient.js';

const router = express.Router();

router.get('/health', async (req, res) => {
  let aiModels = {
    available: false,
    configured: false,
    reason: 'PRODUCT_RADAR_AI_URL not set'
  };

  if (isProductRadarAiConfigured()) {
    try {
      const aiHealth = await getProductRadarAiHealth();
      if (aiHealth?.success) {
        aiModels = {
          available: true,
          configured: true,
          url: getProductRadarAiBaseUrl(),
          models: aiHealth.models || null,
          features: aiHealth.features || null
        };
      } else {
        aiModels = {
          available: false,
          configured: true,
          url: getProductRadarAiBaseUrl(),
          reason: 'AI service returned invalid health response'
        };
      }
    } catch (error) {
      aiModels = {
        available: false,
        configured: true,
        url: getProductRadarAiBaseUrl(),
        reason: error?.message || 'AI service unreachable'
      };
    }
  }

  res.json({
    success: true,
    sources: {
      googleTrends: { available: true, configured: true },
      metaAdLibrary: {
        available: true,
        configured: !!process.env.APIFY_API_TOKEN,
        reason: process.env.APIFY_API_TOKEN ? null : 'APIFY_API_TOKEN not set'
      },
      aiModels
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
      metaLimit = 25,
      useAiModels = true,
      includeGeoSpread = true
    } = req.body || {};

    const data = await runProductRadarScan({
      query,
      geo,
      timeframeDays: Number(timeframeDays) || 90,
      maxCandidates: Number(maxCandidates) || 12,
      maxMetaChecks: Number(maxMetaChecks) || 6,
      includeMetaAds: !!includeMetaAds,
      metaCountry: String(metaCountry || 'ALL'),
      metaLimit: Number(metaLimit) || 25,
      useAiModels: !!useAiModels,
      includeGeoSpread: !!includeGeoSpread
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
