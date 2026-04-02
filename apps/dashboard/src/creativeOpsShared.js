export const WINDOW_TO_DAYS = {
  "30d": 30,
  "60d": 60,
  "90d": 90,
  all_time: 365,
};

export const DATASET_GROUP_LABELS = {
  identity_metadata: "Identity Metadata",
  performance_context: "Performance Context",
  visual_structural: "Visual Structural",
  text_layer: "Text Layer",
  audio_layer: "Audio Layer",
  strategic_labels: "Strategic Labels",
};

export function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function fmtMoney(value, currency = "TRY") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const resolved = String(currency || "").trim().toUpperCase() || "TRY";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: resolved,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return `${resolved} ${fmtNumber(value, 2)}`;
  }
}

export function fmtPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${fmtNumber(value, 2)}%`;
}
