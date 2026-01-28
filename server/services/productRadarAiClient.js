import fetch from 'node-fetch';

const PRODUCT_RADAR_AI_URL = (process.env.PRODUCT_RADAR_AI_URL || '').replace(/\/+$/, '');
const PRODUCT_RADAR_AI_TIMEOUT_MS = Number(process.env.PRODUCT_RADAR_AI_TIMEOUT_MS || 8000);

export function isProductRadarAiConfigured() {
  return Boolean(PRODUCT_RADAR_AI_URL);
}

export function getProductRadarAiBaseUrl() {
  return PRODUCT_RADAR_AI_URL;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PRODUCT_RADAR_AI_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const err = new Error(json?.message || `Product Radar AI request failed (HTTP ${res.status})`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getProductRadarAiHealth() {
  if (!isProductRadarAiConfigured()) return null;
  return fetchJson(`${PRODUCT_RADAR_AI_URL}/health`);
}

export async function rankProductRadarCandidates({
  query,
  candidates,
  maxSelected = 24,
  topN = 120,
  rerankN = 40,
  diversify = true
} = {}) {
  if (!isProductRadarAiConfigured()) return null;

  const payload = {
    query,
    candidates,
    maxSelected,
    topN,
    rerankN,
    diversify
  };

  return fetchJson(`${PRODUCT_RADAR_AI_URL}/rank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function analyzeProductRadarTimeseries({
  series,
  horizon = 14
} = {}) {
  if (!isProductRadarAiConfigured()) return null;

  const payload = {
    series,
    horizon
  };

  return fetchJson(`${PRODUCT_RADAR_AI_URL}/timeseries/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
