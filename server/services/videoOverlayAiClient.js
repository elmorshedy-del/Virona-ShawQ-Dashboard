import fetch from 'node-fetch';

const VIDEO_OVERLAY_AI_URL = (process.env.VIDEO_OVERLAY_AI_URL || '').trim().replace(/\/+$/, '');
const VIDEO_OVERLAY_AI_TIMEOUT_MS = Number(process.env.VIDEO_OVERLAY_AI_TIMEOUT_MS || 120000);
const VIDEO_OVERLAY_AI_HEALTH_TIMEOUT_MS = Number(process.env.VIDEO_OVERLAY_AI_HEALTH_TIMEOUT_MS || 10000);
const VIDEO_OVERLAY_AI_DETECT_TIMEOUT_MS = Number(process.env.VIDEO_OVERLAY_AI_DETECT_TIMEOUT_MS || VIDEO_OVERLAY_AI_TIMEOUT_MS);

export function isVideoOverlayAiConfigured() {
  return Boolean(VIDEO_OVERLAY_AI_URL);
}

export function getVideoOverlayAiBaseUrl() {
  return VIDEO_OVERLAY_AI_URL;
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number.isFinite(Number(options?.timeoutMs)) ? Number(options.timeoutMs) : VIDEO_OVERLAY_AI_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
      const err = new Error(json?.error || json?.message || `Video Overlay AI request failed (HTTP ${res.status})`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getVideoOverlayAiHealth() {
  if (!isVideoOverlayAiConfigured()) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VIDEO_OVERLAY_AI_HEALTH_TIMEOUT_MS);

  try {
    const res = await fetch(`${VIDEO_OVERLAY_AI_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
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

export async function detectVideoOverlays({ imageBase64 } = {}) {
  if (!isVideoOverlayAiConfigured()) return null;
  if (!imageBase64) return null;

  return fetchJson(`${VIDEO_OVERLAY_AI_URL}/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64 }),
    timeoutMs: VIDEO_OVERLAY_AI_DETECT_TIMEOUT_MS
  });
}
