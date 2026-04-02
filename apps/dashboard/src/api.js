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

export async function materializeCreativeUsaRollup({
  tenantKey = "default",
  storeKey,
  lookbackDays = 60,
  lookbackWindow = null,
  minSpendThreshold = 30,
  metricKeys = ["spend", "roas", "orders", "ctr", "hook_rate"],
}) {
  const response = await fetch(`${API_BASE}/creative-library/usa-rollup/materialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
      lookback_window: lookbackWindow,
      min_spend_threshold: minSpendThreshold,
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
  lookbackWindow = null,
  limit = 100,
  offset = 0,
  metricKeys = ["spend", "roas", "orders", "ctr", "hook_rate"],
}) {
  return getJson(
    `/creative-library/usa-rollup${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
      lookback_window: lookbackWindow,
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
  lookbackDays = 60,
  lookbackWindow = null,
  metricKeys = ["spend", "roas", "orders", "ctr", "hook_rate"],
}) {
  return getJson(
    `/creative-library/usa-rollup/${encodeURIComponent(rollupId)}${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
      lookback_window: lookbackWindow,
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

export async function scoreClaudeSubjective({ tenantKey = "default", storeKey, rollupId, forceRefresh = false }) {
  const response = await fetch(`${API_BASE}/signalstack/claude/subjective-score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      rollup_id: rollupId,
      force_refresh: forceRefresh,
    }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "Claude subjective score failed");
  }
  return response.json();
}

export async function fetchCreativeWorkbenchQueue({
  tenantKey = "default",
  storeKey,
  lookbackDays = 90,
  lookbackWindow = null,
  status = "all",
  limit = 50,
  offset = 0,
}) {
  return getJson(
    `/creative-library/workbench/queue${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
      lookback_window: lookbackWindow,
      status,
      limit,
      offset,
    })}`,
  );
}

export async function runCreativeBatchLabel({
  tenantKey = "default",
  storeKey,
  lookbackDays = 90,
  lookbackWindow = null,
  status = "unlabeled",
  limit = 10,
  forceRefresh = false,
  rollupIds = [],
  variantIds = [],
}) {
  const response = await fetch(`${API_BASE}/creative-library/workbench/batch-label`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
      lookback_window: lookbackWindow,
      status,
      limit,
      force_refresh: forceRefresh,
      rollup_ids: rollupIds,
      variant_ids: variantIds,
    }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "Creative batch label failed");
  }
  return response.json();
}

export async function materializeCreativeLabels({
  tenantKey = "default",
  storeKey,
  canonicalCreativeId,
  rollupId,
  variantId,
  forceRefresh = false,
}) {
  const response = await fetch(`${API_BASE}/creative-library/labels/materialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      canonical_creative_id: canonicalCreativeId || null,
      rollup_id: rollupId || null,
      variant_id: variantId || null,
      force_refresh: forceRefresh,
    }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "Creative label materialization failed");
  }
  return response.json();
}

export async function fetchCreativeLabels({
  tenantKey = "default",
  storeKey,
  canonicalCreativeId,
  variantId = null,
}) {
  return getJson(
    `/creative-library/labels/${encodeURIComponent(canonicalCreativeId)}${buildQuery({
      tenant_key: tenantKey,
      store_key: storeKey,
      variant_id: variantId,
    })}`,
  );
}

export async function previewCreativeDataset({
  tenantKey = "default",
  storeKey,
  lookbackDays = 90,
  lookbackWindow = null,
  geo = "US",
  minSpendThreshold = 30,
  labeledOnly = true,
  featureGroups = [],
  selectedFields = [],
  targetMetric = "log_blended_roas",
  sampleLimit = 5,
}) {
  const response = await fetch(`${API_BASE}/creative-library/dataset-hub/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      lookback_days: lookbackDays,
      lookback_window: lookbackWindow,
      geo,
      min_spend_threshold: minSpendThreshold,
      labeled_only: labeledOnly,
      feature_groups: featureGroups,
      selected_fields: selectedFields,
      target_metric: targetMetric,
      sample_limit: sampleLimit,
    }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "Dataset preview failed");
  }
  return response.json();
}

export async function buildCreativeDataset({
  tenantKey = "default",
  storeKey,
  datasetName,
  lookbackDays = 90,
  lookbackWindow = null,
  geo = "US",
  minSpendThreshold = 30,
  labeledOnly = true,
  featureGroups = [],
  selectedFields = [],
  targetMetric = "log_blended_roas",
  outputFormat = "csv",
}) {
  const response = await fetch(`${API_BASE}/creative-library/dataset-hub/build`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: tenantKey,
      store_key: storeKey,
      dataset_name: datasetName,
      lookback_days: lookbackDays,
      lookback_window: lookbackWindow,
      geo,
      min_spend_threshold: minSpendThreshold,
      labeled_only: labeledOnly,
      feature_groups: featureGroups,
      selected_fields: selectedFields,
      target_metric: targetMetric,
      output_format: outputFormat,
    }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message || "Dataset build failed");
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
