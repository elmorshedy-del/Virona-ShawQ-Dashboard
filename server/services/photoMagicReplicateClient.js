import fetch from 'node-fetch';

const REPLICATE_API_BASE_URL = 'https://api.replicate.com/v1';
const REPLICATE_FILL_MODEL_FALLBACK = 'black-forest-labs/flux-fill-pro';
const REPLICATE_ENHANCE_MODEL_FALLBACK = 'bria/increase-resolution';
const REPLICATE_ERASE_DEFAULT_PROMPT = 'reconstruct the masked area naturally to match the surrounding image, preserving texture, lighting, shading, and perspective';
const REPLICATE_EXPAND_DEFAULT_PROMPT = 'extend the canvas naturally to match the surrounding scene, preserving lighting, texture, shading, and perspective';

const REPLICATE_API_TOKEN = String(process.env.REPLICATE_API_TOKEN || '').trim();
const PHOTO_MAGIC_REPLICATE_FILL_MODEL = String(process.env.PHOTO_MAGIC_REPLICATE_MODEL || process.env.PHOTO_MAGIC_REPLICATE_FILL_MODEL || REPLICATE_FILL_MODEL_FALLBACK).trim() || REPLICATE_FILL_MODEL_FALLBACK;
const PHOTO_MAGIC_REPLICATE_ENHANCE_MODEL = String(process.env.PHOTO_MAGIC_REPLICATE_ENHANCE_MODEL || REPLICATE_ENHANCE_MODEL_FALLBACK).trim() || REPLICATE_ENHANCE_MODEL_FALLBACK;
const PHOTO_MAGIC_REPLICATE_TIMEOUT_MS = Number(process.env.PHOTO_MAGIC_REPLICATE_TIMEOUT_MS || 300000);
const PHOTO_MAGIC_REPLICATE_WAIT_SECONDS = Number(process.env.PHOTO_MAGIC_REPLICATE_WAIT_SECONDS || 20);
const PHOTO_MAGIC_REPLICATE_POLL_INTERVAL_MS = Number(process.env.PHOTO_MAGIC_REPLICATE_POLL_INTERVAL_MS || 1500);
const PHOTO_MAGIC_REPLICATE_PROMPT = String(process.env.PHOTO_MAGIC_REPLICATE_PROMPT || REPLICATE_ERASE_DEFAULT_PROMPT).trim() || REPLICATE_ERASE_DEFAULT_PROMPT;
const PHOTO_MAGIC_REPLICATE_EXPAND_PROMPT = String(process.env.PHOTO_MAGIC_REPLICATE_EXPAND_PROMPT || REPLICATE_EXPAND_DEFAULT_PROMPT).trim() || REPLICATE_EXPAND_DEFAULT_PROMPT;
const PHOTO_MAGIC_REPLICATE_STEPS = Number(process.env.PHOTO_MAGIC_REPLICATE_STEPS || 28);
const PHOTO_MAGIC_REPLICATE_GUIDANCE = Number(process.env.PHOTO_MAGIC_REPLICATE_GUIDANCE || 3);
const PHOTO_MAGIC_REPLICATE_SAFETY_TOLERANCE = Number(process.env.PHOTO_MAGIC_REPLICATE_SAFETY_TOLERANCE || 2);
const PHOTO_MAGIC_REPLICATE_OUTPUT_FORMAT = String(process.env.PHOTO_MAGIC_REPLICATE_OUTPUT_FORMAT || 'png').trim() || 'png';
const PHOTO_MAGIC_REPLICATE_HEALTH_TIMEOUT_MS = Number(process.env.PHOTO_MAGIC_REPLICATE_HEALTH_TIMEOUT_MS || 10000);
const PHOTO_MAGIC_REPLICATE_HEALTH_TTL_MS = Number(process.env.PHOTO_MAGIC_REPLICATE_HEALTH_TTL_MS || 60000);

const replicateHealthCache = new Map();

function getHeaders(extra = {}) {
  if (!REPLICATE_API_TOKEN) return extra;
  return {
    Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
    ...extra
  };
}

function parseModelRef(modelRef) {
  const normalized = String(modelRef || '').trim().replace(/^replicate:/i, '');
  const match = normalized.match(/^([^/]+)\/([^:]+)$/);
  if (!match) {
    throw new Error(`Unsupported Replicate model ref: ${normalized}`);
  }
  return { owner: match[1], name: match[2] };
}

function resolveOutputUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output.find((entry) => typeof entry === 'string') || null;
  }
  if (typeof output === 'object') {
    if (typeof output.url === 'string') return output.url;
    if (typeof output.output === 'string') return output.output;
  }
  return null;
}

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = PHOTO_MAGIC_REPLICATE_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: getHeaders({
        Accept: 'application/json',
        ...headers
      }),
      body,
      signal: controller.signal
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const err = new Error(json?.detail || json?.error || json?.message || `Replicate request failed (HTTP ${res.status})`);
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForPrediction(prediction) {
  const startedAt = Date.now();
  let current = prediction;

  while (current && !['succeeded', 'failed', 'canceled'].includes(String(current.status || '').toLowerCase())) {
    if ((Date.now() - startedAt) >= PHOTO_MAGIC_REPLICATE_TIMEOUT_MS) {
      const timeoutError = new Error('Replicate prediction timed out');
      timeoutError.status = 504;
      timeoutError.payload = current;
      throw timeoutError;
    }

    await new Promise((resolve) => setTimeout(resolve, PHOTO_MAGIC_REPLICATE_POLL_INTERVAL_MS));
    const pollUrl = current?.urls?.get || `${REPLICATE_API_BASE_URL}/predictions/${current.id}`;
    current = await fetchJson(pollUrl, { timeoutMs: PHOTO_MAGIC_REPLICATE_TIMEOUT_MS });
  }

  if (!current || String(current.status || '').toLowerCase() !== 'succeeded') {
    const err = new Error(current?.error || 'Replicate prediction failed');
    err.status = 502;
    err.payload = current;
    throw err;
  }

  return current;
}

export function isPhotoMagicReplicateConfigured() {
  return Boolean(REPLICATE_API_TOKEN);
}

export function getPhotoMagicReplicateConfig() {
  return {
    configured: isPhotoMagicReplicateConfigured(),
    provider: 'replicate',
    model: PHOTO_MAGIC_REPLICATE_FILL_MODEL,
    prompt: PHOTO_MAGIC_REPLICATE_PROMPT,
    timeout_ms: PHOTO_MAGIC_REPLICATE_TIMEOUT_MS,
    wait_seconds: PHOTO_MAGIC_REPLICATE_WAIT_SECONDS
  };
}

export function getPhotoMagicReplicateExpandConfig() {
  return {
    configured: isPhotoMagicReplicateConfigured(),
    provider: 'replicate',
    model: PHOTO_MAGIC_REPLICATE_FILL_MODEL,
    prompt: PHOTO_MAGIC_REPLICATE_EXPAND_PROMPT,
    timeout_ms: PHOTO_MAGIC_REPLICATE_TIMEOUT_MS,
    wait_seconds: PHOTO_MAGIC_REPLICATE_WAIT_SECONDS
  };
}

export function getPhotoMagicReplicateEnhanceConfig() {
  return {
    configured: isPhotoMagicReplicateConfigured(),
    provider: 'replicate',
    model: PHOTO_MAGIC_REPLICATE_ENHANCE_MODEL,
    timeout_ms: PHOTO_MAGIC_REPLICATE_TIMEOUT_MS,
    wait_seconds: PHOTO_MAGIC_REPLICATE_WAIT_SECONDS
  };
}

export async function getReplicateModelHealth(modelRef, { force = false } = {}) {
  if (!isPhotoMagicReplicateConfigured()) return null;

  const now = Date.now();
  const cacheKey = String(modelRef || '').trim() || PHOTO_MAGIC_REPLICATE_FILL_MODEL;
  const cached = replicateHealthCache.get(cacheKey);
  if (!force && cached && (now - cached.timestamp) < PHOTO_MAGIC_REPLICATE_HEALTH_TTL_MS) {
    return cached.value;
  }

  try {
    const { owner, name } = parseModelRef(cacheKey);
    const payload = await fetchJson(`${REPLICATE_API_BASE_URL}/models/${owner}/${name}`, {
      timeoutMs: PHOTO_MAGIC_REPLICATE_HEALTH_TIMEOUT_MS
    });

    const health = {
      ok: true,
      status: 200,
      payload: {
        provider: 'replicate',
        owner,
        name,
        latest_version: payload?.latest_version?.id || null
      }
    };
    replicateHealthCache.set(cacheKey, { timestamp: now, value: health });
    return health;
  } catch (error) {
    const health = {
      ok: false,
      status: error?.status || 0,
      payload: error?.payload || { error: error?.message || 'Replicate model check failed' }
    };
    replicateHealthCache.set(cacheKey, { timestamp: now, value: health });
    return health;
  }
}

export async function getPhotoMagicReplicateHealth({ force = false } = {}) {
  return getReplicateModelHealth(PHOTO_MAGIC_REPLICATE_FILL_MODEL, { force });
}

export async function getPhotoMagicReplicateEnhanceHealth({ force = false } = {}) {
  return getReplicateModelHealth(PHOTO_MAGIC_REPLICATE_ENHANCE_MODEL, { force });
}

async function createPrediction({ modelRef, input }) {
  if (!isPhotoMagicReplicateConfigured()) return null;
  const { owner, name } = parseModelRef(modelRef);
  const initialPrediction = await fetchJson(`${REPLICATE_API_BASE_URL}/models/${owner}/${name}/predictions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: `wait=${Math.max(1, Math.round(PHOTO_MAGIC_REPLICATE_WAIT_SECONDS))}`
    },
    body: JSON.stringify({ input })
  });

  const finalPrediction = await waitForPrediction(initialPrediction);
  const outputUrl = resolveOutputUrl(finalPrediction.output);
  if (!outputUrl) {
    const err = new Error('Replicate returned no output URL');
    err.status = 502;
    err.payload = finalPrediction;
    throw err;
  }

  return {
    prediction: finalPrediction,
    outputUrl
  };
}

export async function eraseFluxFill({
  imageUrl,
  maskUrl,
  prompt = PHOTO_MAGIC_REPLICATE_PROMPT
} = {}) {
  if (!imageUrl || !maskUrl) return null;

  return createPrediction({
    modelRef: PHOTO_MAGIC_REPLICATE_FILL_MODEL,
    input: {
      image: imageUrl,
      mask: maskUrl,
      prompt: String(prompt || PHOTO_MAGIC_REPLICATE_PROMPT || REPLICATE_ERASE_DEFAULT_PROMPT).trim() || REPLICATE_ERASE_DEFAULT_PROMPT,
      steps: PHOTO_MAGIC_REPLICATE_STEPS,
      guidance: PHOTO_MAGIC_REPLICATE_GUIDANCE,
      safety_tolerance: PHOTO_MAGIC_REPLICATE_SAFETY_TOLERANCE,
      prompt_upsampling: false,
      output_format: PHOTO_MAGIC_REPLICATE_OUTPUT_FORMAT
    }
  });
}

export async function expandFluxFill({
  imageUrl,
  maskUrl,
  prompt = PHOTO_MAGIC_REPLICATE_EXPAND_PROMPT
} = {}) {
  if (!imageUrl || !maskUrl) return null;

  return createPrediction({
    modelRef: PHOTO_MAGIC_REPLICATE_FILL_MODEL,
    input: {
      image: imageUrl,
      mask: maskUrl,
      prompt: String(prompt || PHOTO_MAGIC_REPLICATE_EXPAND_PROMPT || REPLICATE_EXPAND_DEFAULT_PROMPT).trim() || REPLICATE_EXPAND_DEFAULT_PROMPT,
      steps: PHOTO_MAGIC_REPLICATE_STEPS,
      guidance: PHOTO_MAGIC_REPLICATE_GUIDANCE,
      safety_tolerance: PHOTO_MAGIC_REPLICATE_SAFETY_TOLERANCE,
      prompt_upsampling: false,
      output_format: PHOTO_MAGIC_REPLICATE_OUTPUT_FORMAT
    }
  });
}

export async function enhanceBria({
  imageUrl,
  desiredIncrease = 2
} = {}) {
  if (!imageUrl) return null;

  return createPrediction({
    modelRef: PHOTO_MAGIC_REPLICATE_ENHANCE_MODEL,
    input: {
      image: imageUrl,
      desired_increase: Math.max(2, Math.min(4, Math.round(desiredIncrease)))
    }
  });
}
