import fetch from 'node-fetch';

const PHOTO_MAGIC_HQ_AI_URL = (process.env.PHOTO_MAGIC_HQ_AI_URL || '').trim().replace(/\/+$/, '');
const PHOTO_MAGIC_HQ_TIMEOUT_MS = Number(process.env.PHOTO_MAGIC_HQ_TIMEOUT_MS || 600000);
const PHOTO_MAGIC_HQ_HEALTH_TIMEOUT_MS = Number(process.env.PHOTO_MAGIC_HQ_HEALTH_TIMEOUT_MS || 10000);
const PHOTO_MAGIC_HQ_TOKEN = (process.env.PHOTO_MAGIC_HQ_TOKEN || '').trim();

function getAuthHeaders() {
  if (!PHOTO_MAGIC_HQ_TOKEN) return {};
  return { Authorization: `Bearer ${PHOTO_MAGIC_HQ_TOKEN}` };
}

export function isPhotoMagicHqConfigured() {
  return Boolean(PHOTO_MAGIC_HQ_AI_URL);
}

export function getPhotoMagicHqBaseUrl() {
  return PHOTO_MAGIC_HQ_AI_URL;
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) ? Number(options.timeoutMs) : PHOTO_MAGIC_HQ_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
        ...getAuthHeaders()
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
      const err = new Error(json?.error || json?.message || `Photo Magic HQ request failed (HTTP ${res.status})`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getPhotoMagicHqHealth() {
  if (!isPhotoMagicHqConfigured()) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PHOTO_MAGIC_HQ_HEALTH_TIMEOUT_MS);

  try {
    const res = await fetch(`${PHOTO_MAGIC_HQ_AI_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', ...getAuthHeaders() }
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { ok: res.ok, status: res.status, payload: json };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function eraseSdxl({
  imageBase64,
  maskBase64,
  numInferenceSteps = 20,
  guidanceScale = 8.0,
  strength = 0.99,
  seed = 0,
  maskDilatePx = 8,
  maskFeatherPx = 8,
  cropToMask = true,
  cropMarginPx = 128
} = {}) {
  if (!isPhotoMagicHqConfigured()) return null;
  if (!imageBase64 || !maskBase64) return null;
  return fetchJson(`${PHOTO_MAGIC_HQ_AI_URL}/erase/sdxl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageBase64,
      mask: maskBase64,
      num_inference_steps: numInferenceSteps,
      guidance_scale: guidanceScale,
      strength,
      seed,
      mask_dilate_px: maskDilatePx,
      mask_feather_px: maskFeatherPx,
      crop_to_mask: cropToMask,
      crop_margin_px: cropMarginPx
    }),
    timeoutMs: PHOTO_MAGIC_HQ_TIMEOUT_MS
  });
}
