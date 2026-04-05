import express from 'express';
import axios from 'axios';

const router = express.Router();
const UPSTREAM_CREATIVE_DATA_PATH_PREFIX = '/creative-library';

function resolveUpstreamBaseUrl() {
  const raw = (process.env.CREATIVE_INTELLIGENCE_API_BASE_URL || '').trim();
  return raw.replace(/\/+$/, '');
}

function extractErrorMessage(error) {
  const detail = error?.response?.data;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (typeof detail?.detail === 'string' && detail.detail.trim()) return detail.detail.trim();
  if (typeof detail?.error === 'string' && detail.error.trim()) return detail.error.trim();
  if (typeof detail?.message === 'string' && detail.message.trim()) return detail.message.trim();
  return error?.message || 'Creative intelligence proxy request failed';
}

async function forwardCreativeIntelligenceRequest(req, res, targetPath) {
  const baseUrl = resolveUpstreamBaseUrl();
  if (!baseUrl) {
    return res.status(503).json({
      error:
        'Creative intelligence backend URL is not configured. Set CREATIVE_INTELLIGENCE_API_BASE_URL.',
    });
  }

  try {
    const upstream = await axios({
      method: req.method,
      url: `${baseUrl}${targetPath}`,
      params: req.query,
      data: req.body,
      timeout: 180000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      validateStatus: () => true,
    });

    return res.status(upstream.status).json(upstream.data);
  } catch (error) {
    const statusCode = Number(error?.response?.status) || 502;
    const message = extractErrorMessage(error);
    return res.status(statusCode).json({ error: message });
  }
}

router.all('/creative-intelligence-data/*', async (req, res) => {
  const pathSuffix = req.path.replace(/^\/creative-intelligence-data/, '');
  const targetPath = `${UPSTREAM_CREATIVE_DATA_PATH_PREFIX}${pathSuffix}`;
  return forwardCreativeIntelligenceRequest(req, res, targetPath);
});

export default router;
