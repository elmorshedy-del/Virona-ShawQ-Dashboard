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
    // keep plain-text fallback
  }
  return text || fallback || "Request failed";
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (!text) return;
    qs.set(key, text);
  });
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "Request failed");
  }
  return response.json();
}

export async function analyzeStore(storeUrl) {
  const normalizedStoreUrl = normalizeStoreUrl(storeUrl);
  const response = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store_url: normalizedStoreUrl, max_keywords: 300 }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "Analysis failed");
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
    const message = await readError(response);
    throw new Error(message || "Creative DNA refresh failed");
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
    const message = await readError(response);
    throw new Error(message || "SVG conversion failed");
  }
  return response.json();
}

export async function fetchBlackboxOverview({ tenantKey, storeKey, lookbackDays = 7 }) {
  return getJson(
    `/blackbox/overview${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
    })}`,
  );
}

export async function fetchBlackboxCases({
  tenantKey,
  storeKey,
  status,
  confidence,
  dateFrom,
  dateTo,
  limit = 100,
  offset = 0,
}) {
  return getJson(
    `/blackbox/cases${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      status,
      confidence,
      date_from: dateFrom,
      date_to: dateTo,
      limit,
      offset,
    })}`,
  );
}

export async function fetchBlackboxCaseEvents({ tenantKey, storeKey, caseId, limit = 500 }) {
  const encoded = encodeURIComponent(caseId);
  return getJson(
    `/blackbox/cases/${encoded}/events${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      limit,
    })}`,
  );
}

export function blackboxCasesCsvUrl({
  tenantKey,
  storeKey,
  status,
  confidence,
  dateFrom,
  dateTo,
  limit = 20000,
}) {
  const query = buildQuery({
    tenant_key: tenantKey,
    store_key: storeKey,
    status,
    confidence,
    date_from: dateFrom,
    date_to: dateTo,
    limit,
  });
  return `${API_BASE}/blackbox/cases/export.csv${query}`;
}
