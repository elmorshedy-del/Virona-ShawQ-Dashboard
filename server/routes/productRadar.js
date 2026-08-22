import express from 'express';
import { runProductRadarScan } from '../services/productRadarService.js';
import { runProductRadarAgent } from '../services/productRadarAgentService.js';
import {
  getProductRadarAiBaseUrl,
  getProductRadarAiHealth,
  isProductRadarAiConfigured
} from '../services/productRadarAiClient.js';

const router = express.Router();
const PRODUCT_RADAR_DEFAULTS = {
  geo: '',
  timeframeDays: 90,
  maxCandidates: 12,
  maxMetaChecks: 6,
  includeMetaAds: true,
  metaCountry: 'ALL',
  metaLimit: 25,
  useAiModels: true,
  includeGeoSpread: true
};
const PRODUCT_RADAR_LIMITS = {
  queryMaxLength: 120,
  geoMaxLength: 12,
  timeframeDays: { min: 7, max: 3650 },
  maxCandidates: { min: 4, max: 30 },
  maxMetaChecks: { min: 0, max: 12 },
  metaLimit: { min: 5, max: 100 }
};
const PRODUCT_RADAR_ALLOWED_META_COUNTRIES = new Set([
  'ALL', 'US', 'GB', 'DE', 'FR', 'ES', 'IT', 'AE', 'SA'
]);

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function clampNumber(value, { min, max, fallback }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeProductRadarPayload(body = {}) {
  const query = String(body.query || '').trim().slice(0, PRODUCT_RADAR_LIMITS.queryMaxLength);
  if (!query) {
    const err = new Error('Query is required');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }

  const metaCountryRaw = String(body.metaCountry || PRODUCT_RADAR_DEFAULTS.metaCountry).trim().toUpperCase();
  const metaCountry = PRODUCT_RADAR_ALLOWED_META_COUNTRIES.has(metaCountryRaw)
    ? metaCountryRaw
    : PRODUCT_RADAR_DEFAULTS.metaCountry;

  return {
    query,
    geo: String(body.geo || PRODUCT_RADAR_DEFAULTS.geo).trim().slice(0, PRODUCT_RADAR_LIMITS.geoMaxLength),
    timeframeDays: clampNumber(body.timeframeDays, {
      ...PRODUCT_RADAR_LIMITS.timeframeDays,
      fallback: PRODUCT_RADAR_DEFAULTS.timeframeDays
    }),
    maxCandidates: clampNumber(body.maxCandidates, {
      ...PRODUCT_RADAR_LIMITS.maxCandidates,
      fallback: PRODUCT_RADAR_DEFAULTS.maxCandidates
    }),
    maxMetaChecks: clampNumber(body.maxMetaChecks, {
      ...PRODUCT_RADAR_LIMITS.maxMetaChecks,
      fallback: PRODUCT_RADAR_DEFAULTS.maxMetaChecks
    }),
    includeMetaAds: toBoolean(body.includeMetaAds, PRODUCT_RADAR_DEFAULTS.includeMetaAds),
    metaCountry,
    metaLimit: clampNumber(body.metaLimit, {
      ...PRODUCT_RADAR_LIMITS.metaLimit,
      fallback: PRODUCT_RADAR_DEFAULTS.metaLimit
    }),
    useAiModels: toBoolean(body.useAiModels, PRODUCT_RADAR_DEFAULTS.useAiModels),
    includeGeoSpread: toBoolean(body.includeGeoSpread, PRODUCT_RADAR_DEFAULTS.includeGeoSpread)
  };
}

function sendProductRadarError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({
    success: false,
    error: error?.code || 'PRODUCT_RADAR_FAILED',
    message: error?.message || 'Product Radar request failed'
  });
}

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
    const payload = normalizeProductRadarPayload(req.body || {});
    const data = await runProductRadarScan(payload);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Product Radar scan error:', error);
    sendProductRadarError(res, error);
  }
});

router.post('/agent', async (req, res) => {
  try {
    const payload = normalizeProductRadarPayload(req.body || {});
    const data = await runProductRadarAgent(payload);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Product Radar agent error:', error);
    sendProductRadarError(res, error);
  }
});

export default router;
