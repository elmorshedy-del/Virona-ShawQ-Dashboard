import fetch from 'node-fetch';
import { fal } from '@fal-ai/client';

const FAL_API_BASE_URL = 'https://api.fal.ai/v1';
const FAL_SELECTION_MODEL_FALLBACK = 'fal-ai/sam-3/image';
const FAL_SELECTION_TIMEOUT_MS = Number(process.env.PHOTO_MAGIC_FAL_TIMEOUT_MS || 60000);
const FAL_SELECTION_HEALTH_TIMEOUT_MS = Number(process.env.PHOTO_MAGIC_FAL_HEALTH_TIMEOUT_MS || 10000);
const FAL_SELECTION_HEALTH_TTL_MS = Number(process.env.PHOTO_MAGIC_FAL_HEALTH_TTL_MS || 60000);
const FAL_SELECTION_OUTPUT_FORMAT = 'png';
const FAL_SELECTION_MAX_MASKS = 1;
const FAL_SELECTION_FOREGROUND_LABEL = 1;
const FAL_DATA_URI_PATTERN = /^data:([^;]+);base64,(.+)$/;

const FAL_KEY = String(process.env.FAL_KEY || '').trim();
const PHOTO_MAGIC_FAL_SELECTION_MODEL = String(
  process.env.PHOTO_MAGIC_FAL_SELECTION_MODEL || FAL_SELECTION_MODEL_FALLBACK
).trim() || FAL_SELECTION_MODEL_FALLBACK;

const falHealthCache = new Map();

if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

function getFalHeaders(extra = {}) {
  return {
    Authorization: `Key ${FAL_KEY}`,
    Accept: 'application/json',
    ...extra
  };
}

function normalizeFalModelRef(modelRef) {
  return String(modelRef || '').trim() || FAL_SELECTION_MODEL_FALLBACK;
}

function decodeFalDataUri(value) {
  const match = String(value || '').match(FAL_DATA_URI_PATTERN);
  if (!match) return null;
  return {
    mime: match[1] || 'image/png',
    buffer: Buffer.from(match[2] || '', 'base64')
  };
}

async function fetchFalJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: getFalHeaders(),
      signal: controller.signal
    });

    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const error = new Error(payload?.detail || payload?.error || payload?.message || `fal request failed (HTTP ${res.status})`);
      error.status = res.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function bufferFromFalImage(image) {
  if (!image) return null;

  const inline = decodeFalDataUri(image.file_data);
  if (inline?.buffer?.length) {
    return {
      buffer: inline.buffer,
      mime: inline.mime
    };
  }

  const imageUrl = String(image.url || '').trim();
  if (!imageUrl) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FAL_SELECTION_TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, {
      method: 'GET',
      signal: controller.signal
    });
    if (!res.ok) {
      const error = new Error(`Failed to download fal selection image (HTTP ${res.status})`);
      error.status = res.status;
      throw error;
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mime: String(res.headers.get('content-type') || image.content_type || 'image/png')
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function selectBestFalMask(output) {
  const masks = Array.isArray(output?.masks) ? output.masks : [];
  const scores = Array.isArray(output?.scores) ? output.scores : [];
  const metadata = Array.isArray(output?.metadata) ? output.metadata : [];

  if (!masks.length) {
    const error = new Error('fal SAM returned no masks');
    error.status = 502;
    error.payload = output;
    throw error;
  }

  let selectedIndex = 0;
  let bestScore = Number.isFinite(Number(scores[0])) ? Number(scores[0]) : Number.NEGATIVE_INFINITY;

  for (let index = 1; index < masks.length; index += 1) {
    const nextScore = Number.isFinite(Number(scores[index])) ? Number(scores[index]) : Number.NEGATIVE_INFINITY;
    if (nextScore > bestScore) {
      bestScore = nextScore;
      selectedIndex = index;
    }
  }

  return {
    image: masks[selectedIndex],
    metadata: metadata[selectedIndex] || null,
    score: Number.isFinite(bestScore) ? bestScore : null,
    box: Array.isArray(output?.boxes?.[selectedIndex]) ? output.boxes[selectedIndex] : null,
    index: selectedIndex
  };
}

export function isPhotoMagicFalConfigured() {
  return Boolean(FAL_KEY);
}

export function getPhotoMagicFalSelectionConfig() {
  return {
    configured: isPhotoMagicFalConfigured(),
    provider: 'fal',
    model: PHOTO_MAGIC_FAL_SELECTION_MODEL,
    timeout_ms: FAL_SELECTION_TIMEOUT_MS,
    supported_modes: ['click', 'prompt']
  };
}

export async function getPhotoMagicFalSelectionHealth({ force = false } = {}) {
  if (!isPhotoMagicFalConfigured()) return null;

  const cacheKey = normalizeFalModelRef(PHOTO_MAGIC_FAL_SELECTION_MODEL);
  const now = Date.now();
  const cached = falHealthCache.get(cacheKey);
  if (!force && cached && (now - cached.timestamp) < FAL_SELECTION_HEALTH_TTL_MS) {
    return cached.value;
  }

  try {
    const payload = await fetchFalJson(
      `${FAL_API_BASE_URL}/models?endpoint_id=${encodeURIComponent(cacheKey)}&limit=1`,
      FAL_SELECTION_HEALTH_TIMEOUT_MS
    );
    const models = Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];

    const health = {
      ok: true,
      status: 200,
      payload: {
        provider: 'fal',
        endpoint_id: cacheKey,
        matched_models: models.length
      }
    };
    falHealthCache.set(cacheKey, { timestamp: now, value: health });
    return health;
  } catch (error) {
    const health = {
      ok: false,
      status: error?.status || 0,
      payload: error?.payload || { error: error?.message || 'fal model check failed' }
    };
    falHealthCache.set(cacheKey, { timestamp: now, value: health });
    return health;
  }
}

export async function selectPhotoMagicMaskWithFal({
  imageBuffer,
  prompt = '',
  pointPrompt = null
} = {}) {
  if (!isPhotoMagicFalConfigured()) return null;

  const resolvedPrompt = String(prompt || '').trim();
  const hasPointPrompt = Number.isFinite(Number(pointPrompt?.x)) && Number.isFinite(Number(pointPrompt?.y));

  if (!imageBuffer?.length) {
    throw new Error('Magic Lift selection requires an image buffer.');
  }
  if (!resolvedPrompt && !hasPointPrompt) {
    throw new Error('Magic Lift selection requires either a prompt or a click point.');
  }

  const input = {
    image_url: new Blob([imageBuffer], { type: 'image/png' }),
    apply_mask: false,
    sync_mode: true,
    output_format: FAL_SELECTION_OUTPUT_FORMAT,
    return_multiple_masks: false,
    max_masks: FAL_SELECTION_MAX_MASKS,
    include_scores: true,
    include_boxes: true
  };

  if (resolvedPrompt) {
    input.prompt = resolvedPrompt;
  }

  if (hasPointPrompt) {
    input.point_prompts = [
      {
        x: Math.max(0, Math.round(Number(pointPrompt.x))),
        y: Math.max(0, Math.round(Number(pointPrompt.y))),
        label: FAL_SELECTION_FOREGROUND_LABEL
      }
    ];
  }

  const output = await fal.run(PHOTO_MAGIC_FAL_SELECTION_MODEL, { input });
  const selectedMask = selectBestFalMask(output);
  const maskImage = await bufferFromFalImage(selectedMask.image);

  if (!maskImage?.buffer?.length) {
    const error = new Error('fal SAM returned a mask without downloadable image data');
    error.status = 502;
    error.payload = output;
    throw error;
  }

  return {
    maskBuffer: maskImage.buffer,
    maskMime: maskImage.mime,
    score: selectedMask.score,
    box: selectedMask.box,
    metadata: selectedMask.metadata,
    output
  };
}
