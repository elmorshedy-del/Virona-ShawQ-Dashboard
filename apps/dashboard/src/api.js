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
