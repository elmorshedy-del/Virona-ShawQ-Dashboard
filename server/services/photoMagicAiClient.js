import fetch from 'node-fetch';

const PHOTO_MAGIC_AI_URL = (process.env.PHOTO_MAGIC_AI_URL || '').trim().replace(/\/+$/, '');
const PHOTO_MAGIC_AI_TIMEOUT_MS = Number(process.env.PHOTO_MAGIC_AI_TIMEOUT_MS || 240000);
const PHOTO_MAGIC_AI_HEALTH_TIMEOUT_MS = Number(process.env.PHOTO_MAGIC_AI_HEALTH_TIMEOUT_MS || 10000);
const PHOTO_MAGIC_AI_TOKEN = (process.env.PHOTO_MAGIC_AI_TOKEN || '').trim();

function getAuthHeaders() {
  if (!PHOTO_MAGIC_AI_TOKEN) return {};
  return { Authorization: `Bearer ${PHOTO_MAGIC_AI_TOKEN}` };
}

export function isPhotoMagicAiConfigured() {
  return Boolean(PHOTO_MAGIC_AI_URL);
}

export function getPhotoMagicAiBaseUrl() {
  return PHOTO_MAGIC_AI_URL;
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) ? Number(options.timeoutMs) : PHOTO_MAGIC_AI_TIMEOUT_MS;
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
      const err = new Error(json?.error || json?.message || `Photo Magic AI request failed (HTTP ${res.status})`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getPhotoMagicAiHealth() {
  if (!isPhotoMagicAiConfigured()) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PHOTO_MAGIC_AI_HEALTH_TIMEOUT_MS);

  try {
    const res = await fetch(`${PHOTO_MAGIC_AI_URL}/health`, {
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

export async function removeBgRmbg2({ imageBase64, maxSide = 2048 } = {}) {
  if (!isPhotoMagicAiConfigured()) return null;
  if (!imageBase64) return null;
  return fetchJson(`${PHOTO_MAGIC_AI_URL}/remove-bg/rmbg2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64, max_side: maxSide, return_mask: true })
  });
}

export async function refineBgSam2({
  imageBase64,
  points = [],
  boxXyxy = null,
  maxSide = 2048,
  maskDilatePx = 0,
  maskFeatherPx = 0
} = {}) {
  if (!isPhotoMagicAiConfigured()) return null;
  if (!imageBase64) return null;
  return fetchJson(`${PHOTO_MAGIC_AI_URL}/remove-bg/sam2-refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageBase64,
      points,
      box_xyxy: boxXyxy,
      max_side: maxSide,
      mask_dilate_px: maskDilatePx,
      mask_feather_px: maskFeatherPx
    })
  });
}

export async function eraseLama({
  imageBase64,
  maskBase64,
  maxSide = 2048,
  maskDilatePx = 8,
  maskFeatherPx = 8,
  cropToMask = true,
  cropMarginPx = 128
} = {}) {
  if (!isPhotoMagicAiConfigured()) return null;
  if (!imageBase64 || !maskBase64) return null;
  return fetchJson(`${PHOTO_MAGIC_AI_URL}/erase/lama`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageBase64,
      mask: maskBase64,
      max_side: maxSide,
      mask_dilate_px: maskDilatePx,
      mask_feather_px: maskFeatherPx,
      crop_to_mask: cropToMask,
      crop_margin_px: cropMarginPx
    })
  });
}

export async function enhancePhoto({
  imageBase64,
  mode = 'upscale',
  sourceMaxSide = 2048,
  strength = 0.5,
  upscaleFactor = 2
} = {}) {
  if (!isPhotoMagicAiConfigured()) return null;
  if (!imageBase64) return null;
  return fetchJson(`${PHOTO_MAGIC_AI_URL}/enhance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: imageBase64,
      mode,
      source_max_side: sourceMaxSide,
      strength,
      upscale_factor: upscaleFactor
    })
  });
}
