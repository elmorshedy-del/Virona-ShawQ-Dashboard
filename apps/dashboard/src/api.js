const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

function normalizeStoreUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return value;
  if (value.includes("://")) return value;
  return `https://${value}`;
}

async function readError(response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const text = await response.text();
  if (!text) return fallback || "Request failed";
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
    if (Array.isArray(parsed?.detail) && parsed.detail.length) {
      const message = parsed.detail
        .map((item) => item?.msg)
        .find((entry) => typeof entry === "string" && entry.trim());
      if (message) return message;
    }
  } catch {
    return text || fallback || "Request failed";
  }
  return text || fallback || "Request failed";
}

function buildQuery(params = {}) {
  const queryString = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const normalizedValue = String(value).trim();
    if (!normalizedValue) return;
    queryString.set(key, normalizedValue);
  });
  const serializedQuery = queryString.toString();
  return serializedQuery ? `?${serializedQuery}` : "";
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function fetchCreativeDNAProfile({ tenantKey = "default", storeKey }) {
  return getJson(
    `/creative-dna/profile${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
    })}`,
  );
}

export async function materializeCreativeUsaRollup({
  tenantKey = "default",
  storeKey,
  lookbackDays = 60,
  metricKeys = ["spend", "roas", "orders", "ctr", "hook_rate"],
}) {
  const response = await fetch(`${API_BASE}/creative-library/usa-rollup/materialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
      metric_keys: metricKeys,
    }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "USA rollup materialization failed");
  }
  return response.json();
}

export async function fetchCreativeUsaRollup({
  tenantKey = "default",
  storeKey,
  lookbackDays = 60,
  limit = 100,
  offset = 0,
  metricKeys = ["spend", "roas", "orders", "ctr", "hook_rate"],
}) {
  return getJson(
    `/creative-library/usa-rollup${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
      limit,
      offset,
      metric_keys: metricKeys.join(","),
    })}`,
  );
}

export async function fetchCreativeUsaRollupDetail({
  tenantKey = "default",
  storeKey,
  rollupId,
  metricKeys = ["spend", "roas", "orders", "ctr", "hook_rate"],
}) {
  return getJson(
    `/creative-library/usa-rollup/${encodeURIComponent(rollupId)}${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      metric_keys: metricKeys.join(","),
    })}`,
  );
}

export async function analyzeSignalStackAudio({ videoUrl, audioUrl }) {
  const response = await fetch(`${API_BASE}/signalstack/audio-stack/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_url: videoUrl || null,
      audio_url: audioUrl || null,
    }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "Audio stack analysis failed");
  }
  return response.json();
}

export async function embedSiglip({ imageUrl }) {
  const response = await fetch(`${API_BASE}/signalstack/siglip/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "SigLIP embedding failed");
  }
  return response.json();
}

export async function refreshCreativeDNA({ tenantKey = "default", storeUrl, storeKey }) {
  const normalizedStoreUrl = normalizeStoreUrl(storeUrl);
  const response = await fetch(`${API_BASE}/creative-dna/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      store_url: normalizedStoreUrl,
    }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function vectorizeCreativeDNAMark({
  tenantKey = "default",
  storeKey,
  storeUrl,
  name,
  filename,
  imageBase64,
  preset = "color",
}) {
  const normalizedStoreUrl = normalizeStoreUrl(storeUrl);
  const response = await fetch(`${API_BASE}/creative-dna/vectorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      store_url: normalizedStoreUrl,
      name,
      filename,
      image_base64: imageBase64,
      preset,
    }),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}
