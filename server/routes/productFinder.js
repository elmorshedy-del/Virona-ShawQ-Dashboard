import express from 'express';
import {
  getProductFinderHealth,
  runProductFinderConsultation
} from '../services/productFinderDiscoveryService.js';

const router = express.Router();

const PRODUCT_FINDER_DEFAULTS = {
  timeframeDays: 90,
  maxCandidates: 12,
  includeMarketplaces: true,
  metaCountry: 'ALL',
  qualityBias: true
};

const PRODUCT_FINDER_LIMITS = {
  queryMaxLength: 140,
  timeframeDays: { min: 30, max: 365 },
  maxCandidates: { min: 4, max: 30 },
  storeFieldMaxLength: 80
};

const ALLOWED_META_COUNTRIES = new Set([
  'ALL', 'US', 'GB', 'DE', 'FR', 'ES', 'IT', 'AE', 'SA'
]);

function clampNumber(value, { min, max, fallback }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function trimField(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizePayload(body = {}) {
  const query = trimField(body.query, PRODUCT_FINDER_LIMITS.queryMaxLength);
  if (!query) {
    const error = new Error('Query is required');
    error.status = 400;
    error.code = 'INVALID_INPUT';
    throw error;
  }

  const metaCountryRaw = String(body.metaCountry || PRODUCT_FINDER_DEFAULTS.metaCountry).trim().toUpperCase();
  const metaCountry = ALLOWED_META_COUNTRIES.has(metaCountryRaw)
    ? metaCountryRaw
    : PRODUCT_FINDER_DEFAULTS.metaCountry;

  return {
    query,
    timeframeDays: clampNumber(body.timeframeDays, {
      ...PRODUCT_FINDER_LIMITS.timeframeDays,
      fallback: PRODUCT_FINDER_DEFAULTS.timeframeDays
    }),
    maxCandidates: clampNumber(body.maxCandidates, {
      ...PRODUCT_FINDER_LIMITS.maxCandidates,
      fallback: PRODUCT_FINDER_DEFAULTS.maxCandidates
    }),
    includeMarketplaces: toBoolean(body.includeMarketplaces, PRODUCT_FINDER_DEFAULTS.includeMarketplaces),
    metaCountry,
    qualityBias: toBoolean(body.qualityBias, PRODUCT_FINDER_DEFAULTS.qualityBias),
    storeId: trimField(body.storeId, PRODUCT_FINDER_LIMITS.storeFieldMaxLength),
    storeName: trimField(body.storeName, PRODUCT_FINDER_LIMITS.storeFieldMaxLength),
    storeTagline: trimField(body.storeTagline, PRODUCT_FINDER_LIMITS.storeFieldMaxLength)
  };
}

function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({
    success: false,
    error: error?.code || 'PRODUCT_FINDER_FAILED',
    message: error?.message || 'Product Finder request failed'
  });
}

router.get('/health', async (_req, res) => {
  try {
    const health = await getProductFinderHealth();
    res.json(health);
  } catch (error) {
    console.error('Product Finder health error:', error);
    sendError(res, error);
  }
});

router.post('/consult', async (req, res) => {
  try {
    const payload = normalizePayload(req.body || {});
    const data = await runProductFinderConsultation(payload);
    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Product Finder consult error:', error);
    sendError(res, error);
  }
});

export default router;
