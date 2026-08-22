export function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function safeDivide(numerator, denominator, fallback = 0) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }
  return numerator / denominator;
}

export function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return normalized;
}

export function addDaysIso(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function listDateRange(startDate, endDate) {
  const out = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

export function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function weightedMean(values, weights) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const weight = weights[index];
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue;
    weightedTotal += value * weight;
    weightTotal += weight;
  }
  if (weightTotal <= 0) return null;
  return weightedTotal / weightTotal;
}

export function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2 === 0) {
    return (clean[middle - 1] + clean[middle]) / 2;
  }
  return clean[middle];
}

export function mad(values, baselineMedian) {
  if (!Array.isArray(values) || baselineMedian == null) return null;
  const absoluteDeviations = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.abs(value - baselineMedian));
  return median(absoluteDeviations);
}

export function variance(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length <= 1) return 0;
  const avg = mean(clean);
  const squareError = clean.reduce((sum, value) => sum + ((value - avg) ** 2), 0);
  return squareError / (clean.length - 1);
}

export function stdDev(values) {
  return Math.sqrt(Math.max(variance(values), 0));
}

export function linearTrendSlope(values) {
  const clean = values
    .map((value, index) => ({ x: index + 1, y: value }))
    .filter((point) => Number.isFinite(point.y));

  if (clean.length < 2) return 0;

  const sumX = clean.reduce((sum, point) => sum + point.x, 0);
  const sumY = clean.reduce((sum, point) => sum + point.y, 0);
  const sumXY = clean.reduce((sum, point) => sum + (point.x * point.y), 0);
  const sumXX = clean.reduce((sum, point) => sum + (point.x * point.x), 0);

  const count = clean.length;
  const denominator = (count * sumXX) - (sumX ** 2);
  if (denominator === 0) return 0;
  return ((count * sumXY) - (sumX * sumY)) / denominator;
}

export function weightedLinearRegression(points) {
  const filtered = points.filter((point) =>
    Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.w) && point.w > 0
  );

  if (filtered.length < 2) {
    return { slope: 0, intercept: 0, rSquared: 0 };
  }

  const totalWeight = filtered.reduce((sum, point) => sum + point.w, 0);
  const meanX = filtered.reduce((sum, point) => sum + (point.x * point.w), 0) / totalWeight;
  const meanY = filtered.reduce((sum, point) => sum + (point.y * point.w), 0) / totalWeight;

  let numerator = 0;
  let denominator = 0;
  for (const point of filtered) {
    numerator += point.w * (point.x - meanX) * (point.y - meanY);
    denominator += point.w * ((point.x - meanX) ** 2);
  }

  if (denominator === 0) {
    return { slope: 0, intercept: meanY, rSquared: 0 };
  }

  const slope = numerator / denominator;
  const intercept = meanY - (slope * meanX);

  let weightedError = 0;
  let weightedTotal = 0;
  for (const point of filtered) {
    const prediction = intercept + (slope * point.x);
    weightedError += point.w * ((point.y - prediction) ** 2);
    weightedTotal += point.w * ((point.y - meanY) ** 2);
  }

  const rSquared = weightedTotal > 0 ? (1 - (weightedError / weightedTotal)) : 0;

  return {
    slope,
    intercept,
    rSquared: clampNumber(rSquared, 0, 1)
  };
}

export function percentile(values, ratio) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!clean.length) return null;
  const clampedRatio = clampNumber(ratio, 0, 1);
  const index = (clean.length - 1) * clampedRatio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return clean[lower];
  const weight = index - lower;
  return (clean[lower] * (1 - weight)) + (clean[upper] * weight);
}

export function buildRecencyWeights(length, halfLifeDays = 7) {
  if (!Number.isFinite(length) || length <= 0) return [];
  const safeHalfLife = Math.max(1, halfLifeDays);
  const decay = Math.log(2) / safeHalfLife;
  const values = [];
  for (let index = 0; index < length; index += 1) {
    const age = (length - 1) - index;
    values.push(Math.exp(-decay * age));
  }
  return values;
}

export function sum(values) {
  return values.reduce((accumulator, value) => accumulator + (Number.isFinite(value) ? value : 0), 0);
}

export function createSeededRng(seedInput) {
  let seed = Math.abs(Math.floor(seedInput)) % 2147483647;
  if (seed === 0) seed = 1;
  return () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function hashStringToSeed(value) {
  const raw = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function sampleStandardNormal(rng) {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = Math.max(rng(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function sampleGamma(shape, scale, rng) {
  if (!Number.isFinite(shape) || !Number.isFinite(scale) || shape <= 0 || scale <= 0) {
    return 0;
  }

  if (shape < 1) {
    const sample = sampleGamma(shape + 1, scale, rng);
    const uniform = Math.max(rng(), Number.EPSILON);
    return sample * (uniform ** (1 / shape));
  }

  const d = shape - (1 / 3);
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    let x;
    let v;
    do {
      x = sampleStandardNormal(rng);
      v = 1 + (c * x);
    } while (v <= 0);

    v = v ** 3;
    const uniform = Math.max(rng(), Number.EPSILON);

    if (uniform < 1 - (0.0331 * (x ** 4))) {
      return d * v * scale;
    }

    if (Math.log(uniform) < 0.5 * (x ** 2) + d * (1 - v + Math.log(v))) {
      return d * v * scale;
    }
  }
}

export function sampleBeta(alpha, beta, rng) {
  const x = sampleGamma(alpha, 1, rng);
  const y = sampleGamma(beta, 1, rng);
  if (x <= 0 && y <= 0) return 0;
  return x / (x + y);
}

export function samplePoisson(lambda, rng) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;

  const LARGE_LAMBDA_THRESHOLD = 30;
  if (lambda > LARGE_LAMBDA_THRESHOLD) {
    const normal = sampleStandardNormal(rng);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal));
  }

  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= rng();
  } while (product > limit);
  return Math.max(0, count - 1);
}

export function safeDeltaRatio(currentValue, baselineValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue)) return 0;
  if (baselineValue === 0) {
    if (currentValue === 0) return 0;
    return currentValue > 0 ? 1 : -1;
  }
  return (currentValue - baselineValue) / Math.abs(baselineValue);
}

export function clamp01(value) {
  return clampNumber(value, 0, 1);
}

export function normalizePercent(value) {
  if (!Number.isFinite(value)) return 0;
  return round(value * 100, 2);
}
