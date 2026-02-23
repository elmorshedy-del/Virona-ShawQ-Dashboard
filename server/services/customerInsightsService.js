import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import { getCountryInfo } from '../utils/countryData.js';
import { ensureShopifyProductsCached } from './shopifyService.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toNumber = (value) => (Number.isFinite(value) ? value : 0);
const safeDivide = (num, den) => (den ? num / den : 0);

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ARABIC_REGEX = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const TIP_REGEX = /\btip\b|gratuity/i;
const TEST_REGEX = /\btest\b/i;
const UNKNOWN_TEXT_REGEX = /^(unknown|unk|n\/a|na|null|undefined|none|-)$/i;
const BUNDLE_CONFIGURED_MARKER_REGEX = /\b(bundle|set|pack|kit|combo|duo|trio|pair)\b/i;
const BUNDLE_TYPE_CONFIGURED = 'configured';
const BUNDLE_TYPE_ORGANIC = 'organic';
const BUNDLE_TYPE_LABELS = {
  [BUNDLE_TYPE_CONFIGURED]: 'Configured Bundle',
  [BUNDLE_TYPE_ORGANIC]: 'Organic Co-Purchase'
};
const BUNDLE_FDR_TARGET = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_BUNDLE_FDR || '0.1'),
  0.01,
  0.25
);
const BUNDLE_STORE_MIN_ELIGIBLE_ORDERS = Math.max(
  1,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_BUNDLE_MIN_STORE_ORDERS || '30', 10) || 30
);
const BUNDLE_MIN_PAIR_ORDERS_DISPLAY = Math.max(
  1,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_BUNDLE_MIN_PAIR_ORDERS_DISPLAY || '3', 10) || 3
);
const BUNDLE_T1_MIN_ANCHOR_ORDERS = Math.max(
  1,
  Number.parseInt(
    process.env.CUSTOMER_INSIGHTS_BUNDLE_T1_MIN_ANCHOR_ORDERS
    || process.env.CUSTOMER_INSIGHTS_BUNDLE_MIN_ANCHOR_ORDERS
    || '20',
    10
  ) || 20
);
const BUNDLE_T1_MIN_PAIR_ORDERS = Math.max(
  1,
  Number.parseInt(
    process.env.CUSTOMER_INSIGHTS_BUNDLE_T1_MIN_PAIR_ORDERS
    || process.env.CUSTOMER_INSIGHTS_BUNDLE_MIN_PAIR_ORDERS
    || '8',
    10
  ) || 8
);
const BUNDLE_T2_MIN_ANCHOR_ORDERS = Math.max(
  1,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_BUNDLE_T2_MIN_ANCHOR_ORDERS || '10', 10) || 10
);
const BUNDLE_T2_MIN_PAIR_ORDERS = Math.max(
  1,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_BUNDLE_T2_MIN_PAIR_ORDERS || '5', 10) || 5
);
const BUNDLE_TREND_MIN_PREVIOUS_ORDERS = Math.max(
  1,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_BUNDLE_TREND_MIN_PREVIOUS_ORDERS || '3', 10) || 3
);
const BUNDLE_RANK_CONFIDENCE_FLOOR = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_BUNDLE_RANK_CONFIDENCE_FLOOR || '0.5'),
  0,
  1
);
const WILSON_CONFIDENCE_Z_95 = 1.959963984540054;
const MIN_PROBABILITY = 1e-9;
const BUNDLE_INSIGHT_MAX_COUNT = Number.parseInt(process.env.CUSTOMER_INSIGHTS_BUNDLE_INSIGHTS_MAX || '3', 10) || 3;
const BUNDLE_RESULT_LIMIT = Math.max(
  BUNDLE_INSIGHT_MAX_COUNT,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_BUNDLE_RESULT_LIMIT || '8', 10) || 8
);
const BUNDLE_SIGNAL_THRESHOLDS = {
  strong: clamp(Number.parseFloat(process.env.CUSTOMER_INSIGHTS_BUNDLE_SIGNAL_STRONG_FDR || '0.05'), 0.001, 0.5),
  reliable: clamp(Number.parseFloat(process.env.CUSTOMER_INSIGHTS_BUNDLE_SIGNAL_RELIABLE_FDR || '0.1'), 0.001, 0.5),
  directional: clamp(Number.parseFloat(process.env.CUSTOMER_INSIGHTS_BUNDLE_SIGNAL_DIRECTIONAL_FDR || '0.2'), 0.001, 0.8)
};
const BUNDLE_ACTION_WINDOW_DAYS = Math.max(
  1,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_BUNDLE_ACTION_WINDOW_DAYS || '14', 10) || 14
);

const DEFAULT_STORE_TIMEZONE = process.env.STORE_TIMEZONE_DEFAULT || 'UTC';

// ── Product Momentum & Watch engine ──────────────────────────────────────────
const MOMENTUM_MIN_ORDERS = Math.max(
  1,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_MOMENTUM_MIN_ORDERS || '3', 10) || 3
);
const MOMENTUM_HERO_SHARE_DROP = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_MOMENTUM_HERO_SHARE_DROP || '0.15'),
  0.05, 0.5
);
const MOMENTUM_CONCENTRATION_RISK = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_MOMENTUM_CONCENTRATION_RISK || '0.25'),
  0.1, 0.6
);
const MOMENTUM_RISING_PILLAR_SHARE = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_MOMENTUM_RISING_PILLAR_SHARE || '0.10'),
  0.03, 0.3
);
const MOMENTUM_DISCOUNT_DEPENDENCY = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_MOMENTUM_DISCOUNT_DEPENDENCY || '0.50'),
  0.2, 0.9
);
const MOMENTUM_DISCOUNT_PP_INCREASE = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_MOMENTUM_DISCOUNT_PP_INCREASE || '0.10'),
  0.03, 0.3
);
const MOMENTUM_RESULT_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_MOMENTUM_RESULT_LIMIT || '6', 10) || 6
);
const MOMENTUM_CUSUM_THRESHOLD = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_MOMENTUM_CUSUM_THRESHOLD || '4'),
  1, 20
);
const MOMENTUM_HERO_TENURE_MIN = Math.max(
  2,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_MOMENTUM_HERO_TENURE_MIN || '3', 10) || 3
);
const MOMENTUM_RESHUFFLE_MIN = Math.max(
  2,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_MOMENTUM_RESHUFFLE_MIN || '3', 10) || 3
);
const MOMENTUM_METEORIC_RANK_JUMP = Math.max(
  3,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_MOMENTUM_METEORIC_RANK_JUMP || '5', 10) || 5
);
const MOMENTUM_STREAK_MIN_PERIODS = Math.max(
  2,
  Number.parseInt(process.env.CUSTOMER_INSIGHTS_MOMENTUM_STREAK_MIN_PERIODS || '3', 10) || 3
);
const MOMENTUM_STREAK_MIN_GROWTH = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_MOMENTUM_STREAK_MIN_GROWTH || '0.10'),
  0.01, 0.5
);
const MOMENTUM_FDR_TARGET = clamp(
  Number.parseFloat(process.env.CUSTOMER_INSIGHTS_MOMENTUM_FDR || '0.1'),
  0.01, 0.25
);

const normalizeStoreEnvKey = (store) =>
  String(store || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');

function getStoreTimeZone(store) {
  const key = `STORE_TIMEZONE_${normalizeStoreEnvKey(store)}`;
  const fallback = DEFAULT_STORE_TIMEZONE;
  const configured = process.env[key] || fallback;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured });
    return configured;
  } catch (e) {
    return fallback;
  }
}

function getMinSegmentOrders(totalOrders) {
  const configured = parseInt(process.env.CUSTOMER_INSIGHTS_MIN_SEGMENT_ORDERS || '', 10);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (!totalOrders) return 3;
  return Math.max(3, Math.min(10, Math.round(totalOrders * 0.05)));
}

function sanitizeProductLabel(label) {
  if (!label || typeof label !== 'string') return label;
  const cleaned = label.replace(ARABIC_REGEX, '').replace(/\s+/g, ' ').trim();
  return cleaned || label.trim();
}

function isTipItem(row) {
  const text = [row?.title, row?.cache_title, row?.sku].filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  return TIP_REGEX.test(text);
}

function isExcludedProduct(row) {
  const text = [row?.title, row?.cache_title, row?.sku].filter(Boolean).join(' ').toLowerCase();
  if (!text) return false;
  return TIP_REGEX.test(text) || TEST_REGEX.test(text);
}

function isUnknownText(value) {
  if (value == null) return true;
  const text = String(value).trim();
  if (!text) return true;
  return UNKNOWN_TEXT_REGEX.test(text);
}

function getItemIdentity(row) {
  const key = row?.variant_id || row?.product_id || row?.sku || row?.title;
  if (!key) return { key: null, label: null };

  if (isExcludedProduct(row)) return { key: null, label: null };

  const title = typeof row?.title === 'string' ? row.title.trim() : '';
  const cacheTitle = typeof row?.cache_title === 'string' ? row.cache_title.trim() : '';
  const sku = typeof row?.sku === 'string' ? row.sku.trim() : '';

  let label = title || sku || '';
  if ((!label || /^\d+$/.test(label)) && cacheTitle && !/^\d+$/.test(cacheTitle)) {
    label = cacheTitle;
  }

  if (!label || /^\d+$/.test(label)) {
    if (row?.sku && !/^\d+$/.test(String(row.sku))) {
      label = String(row.sku);
    } else if (row?.product_id) {
      label = `Product ${row.product_id}`;
    } else if (row?.variant_id) {
      label = `Variant ${row.variant_id}`;
    } else {
      label = String(key);
    }
  }

  return {
    key: String(key),
    label: sanitizeProductLabel(label)
  };
}

function getProductKey(row) {
  if (isExcludedProduct(row)) return null;
  return row?.product_id || row?.variant_id || row?.sku || row?.title || null;
}

function getProductLabel(row) {
  const identity = getItemIdentity(row);
  return identity.label;
}

function getDateRange(params) {
  const now = new Date();
  const today = formatDateAsGmt3(now);

  if (params.startDate && params.endDate) {
    const start = new Date(params.startDate);
    const end = new Date(params.endDate);
    const days = Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1;
    return { startDate: params.startDate, endDate: params.endDate, days };
  }

  if (params.yesterday) {
    const yesterday = formatDateAsGmt3(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    return { startDate: yesterday, endDate: yesterday, days: 1 };
  }

  let days = 7;
  if (params.days) days = parseInt(params.days, 10);
  else if (params.weeks) days = parseInt(params.weeks, 10) * 7;
  else if (params.months) days = parseInt(params.months, 10) * 30;

  const endDate = today;
  const startMs = now.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
  const startDate = formatDateAsGmt3(new Date(startMs));

  return { startDate, endDate, days };
}

function shiftDate(dateStr, deltaDays) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + deltaDays);
  return formatDateAsGmt3(d);
}

function getOrdersTable(store) {
  return store === 'vironax' ? 'salla_orders' : 'shopify_orders';
}

function getOrderRows(db, store, startDate, endDate) {
  const table = getOrdersTable(store);
  if (table === 'shopify_orders') {
    return db.prepare(`
      SELECT
        order_id,
        date,
        country,
        country_code,
        city,
        state,
        order_total,
        subtotal,
        discount,
        order_created_at as order_ts,
        customer_id,
        customer_email
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ? AND COALESCE(is_excluded, 0) = 0
    `).all(store, startDate, endDate);
  }

  return db.prepare(`
    SELECT
      order_id,
      date,
      country,
      country_code,
      city,
      state,
      order_total,
      subtotal,
      discount,
      created_at as order_ts,
      NULL as customer_id,
      NULL as customer_email
    FROM salla_orders
    WHERE store = ? AND date BETWEEN ? AND ? AND COALESCE(is_excluded, 0) = 0
  `).all(store, startDate, endDate);
}

function getOrderItems(db, store, startDate, endDate) {
  if (store !== 'shawq') return [];
  return db.prepare(`
    SELECT
      oi.order_id,
      oi.product_id,
      oi.variant_id,
      oi.sku,
      COALESCE(NULLIF(oi.title, ''), pc.title) as title,
      COALESCE(NULLIF(oi.image_url, ''), pc.image_url) as image_url,
      pc.title as cache_title,
      oi.quantity,
      oi.price,
      oi.discount,
      oi.net_price,
      o.customer_id,
      o.order_created_at,
      o.date
    FROM shopify_order_items oi
    JOIN shopify_orders o
      ON o.order_id = oi.order_id AND o.store = oi.store
    LEFT JOIN shopify_products_cache pc
      ON pc.store = oi.store AND pc.product_id = oi.product_id
    WHERE o.store = ? AND o.date BETWEEN ? AND ?
      AND COALESCE(o.is_excluded, 0) = 0
      AND COALESCE(oi.is_excluded, 0) = 0
  `).all(store, startDate, endDate);
}

function computeDiscountMetrics(orders) {
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, row) => sum + toNumber(row.order_total), 0);
  let discountedOrders = 0;
  let discountedRevenue = 0;
  let discountRateSum = 0;
  let discountRateCount = 0;
  let discountedAovSum = 0;
  let discountedAovCount = 0;
  let fullAovSum = 0;
  let fullAovCount = 0;

  orders.forEach((row) => {
    const discount = toNumber(row.discount);
    const subtotal = toNumber(row.subtotal);
    const revenue = toNumber(row.order_total);

    if (discount > 0) {
      discountedOrders += 1;
      discountedRevenue += revenue;
      discountedAovSum += revenue;
      discountedAovCount += 1;
      if (subtotal > 0) {
        discountRateSum += discount / subtotal;
        discountRateCount += 1;
      }
    } else {
      fullAovSum += revenue;
      fullAovCount += 1;
    }
  });

  return {
    discountedOrders,
    discountOrderRate: safeDivide(discountedOrders, totalOrders),
    discountedRevenue,
    discountRevenueShare: safeDivide(discountedRevenue, totalRevenue),
    avgDiscountRate: discountRateCount ? discountRateSum / discountRateCount : 0,
    avgDiscountedAov: discountedAovCount ? discountedAovSum / discountedAovCount : 0,
    avgFullAov: fullAovCount ? fullAovSum / fullAovCount : 0
  };
}

function computeCustomerStats(orders) {
  const customers = new Map();
  orders.forEach((row) => {
    const customerId = row.customer_id || null;
    if (!customerId) return;
    const entry = customers.get(customerId) || { orders: 0, revenue: 0, firstTs: null, orderEvents: [] };
    entry.orders += 1;
    const amount = toNumber(row.order_total);
    entry.revenue += amount;
    const ts = row.order_ts ? new Date(row.order_ts) : null;
    if (ts && !Number.isNaN(ts.getTime())) {
      entry.orderEvents.push({ ts, amount });
      if (!entry.firstTs || ts < entry.firstTs) entry.firstTs = ts;
    }
    customers.set(customerId, entry);
  });

  const customerCount = customers.size;
  if (!customerCount) {
    return { customerCount: 0, repeatRate: null, avgLtv90: null, cohorts: [] };
  }

  let repeatCustomers = 0;
  let ltv90Sum = 0;

  const cohorts = new Map();

  customers.forEach((entry) => {
    if (entry.orders >= 2) repeatCustomers += 1;

    const firstTs = entry.firstTs;
    if (firstTs) {
      const horizon30 = new Date(firstTs.getTime() + 30 * 24 * 60 * 60 * 1000);
      const horizon60 = new Date(firstTs.getTime() + 60 * 24 * 60 * 60 * 1000);
      const horizon90 = new Date(firstTs.getTime() + 90 * 24 * 60 * 60 * 1000);

      let rev30 = 0;
      let rev60 = 0;
      let rev90 = 0;

      entry.orderEvents.forEach((event) => {
        if (event.ts <= horizon30) rev30 += event.amount;
        if (event.ts <= horizon60) rev60 += event.amount;
        if (event.ts <= horizon90) rev90 += event.amount;
      });

      ltv90Sum += rev90;

      const cohortKey = `${firstTs.getFullYear()}-${String(firstTs.getMonth() + 1).padStart(2, '0')}`;
      const cohort = cohorts.get(cohortKey) || { cohort: cohortKey, customers: 0, ltv30: 0, ltv60: 0, ltv90: 0 };
      cohort.customers += 1;
      cohort.ltv30 += rev30;
      cohort.ltv60 += rev60;
      cohort.ltv90 += rev90;
      cohorts.set(cohortKey, cohort);
    }
  });

  const cohortRows = Array.from(cohorts.values())
    .sort((a, b) => (a.cohort < b.cohort ? 1 : -1))
    .slice(0, 6)
    .map((row) => ({
      cohort: row.cohort,
      customers: row.customers,
      ltv30: row.customers ? row.ltv30 / row.customers : 0,
      ltv60: row.customers ? row.ltv60 / row.customers : 0,
      ltv90: row.customers ? row.ltv90 / row.customers : 0
    }));

  return {
    customerCount,
    repeatRate: safeDivide(repeatCustomers, customerCount),
    avgLtv90: ltv90Sum / customerCount,
    cohorts: cohortRows
  };
}

function getMetaTopSegment(db, store, startDate, endDate) {
  const row = db.prepare(`
    SELECT country, age, gender,
      SUM(conversions) as conversions,
      SUM(conversion_value) as revenue,
      SUM(spend) as spend
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND conversions > 0
    GROUP BY country, age, gender
    ORDER BY revenue DESC
    LIMIT 1
  `).get(store, startDate, endDate);

  if (!row || !row.country || row.country === 'ALL') return null;

  const age = (row.age || '').trim();
  const gender = (row.gender || '').toLowerCase().trim();

  const genderLabel = gender === 'female' ? 'Women' : gender === 'male' ? 'Men' : null;
  const ageLabel = age || null;

  // Ignore "All ages / All genders" rows; we only surface meaningful breakdowns.
  if (!genderLabel && !ageLabel) return null;

  const country = getCountryInfo(row.country);

  const labelParts = [];
  if (genderLabel) labelParts.push(genderLabel);
  if (ageLabel) labelParts.push(ageLabel);
  labelParts.push(`in ${country.name}`);

  return {
    label: labelParts.join(' '),
    country: country.name,
    age: ageLabel,
    gender: genderLabel,
    conversions: toNumber(row.conversions),
    revenue: toNumber(row.revenue),
    spend: toNumber(row.spend)
  };
}

function getTopTiming(orders, store) {
  const hourCounts = new Array(24).fill(0);
  const dayCounts = new Array(7).fill(0);

  const timeZone = getStoreTimeZone(store);
  let formatter;

  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
      weekday: 'long'
    });
  } catch (e) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_STORE_TIMEZONE,
      hour: '2-digit',
      hour12: false,
      weekday: 'long'
    });
  }

  orders.forEach((row) => {
    if (!row.order_ts) return;
    const ts = new Date(row.order_ts);
    if (Number.isNaN(ts.getTime())) return;

    const parts = formatter.formatToParts(ts);
    const hourPart = parts.find((part) => part.type === 'hour')?.value;
    const weekdayPart = parts.find((part) => part.type === 'weekday')?.value;

    const hour = hourPart != null ? parseInt(hourPart, 10) : Number.NaN;
    if (!Number.isNaN(hour)) hourCounts[clamp(hour, 0, 23)] += 1;

    const dayIndex = weekdayPart ? DAY_NAMES.indexOf(weekdayPart) : -1;
    if (dayIndex >= 0) dayCounts[dayIndex] += 1;
  });

  const topHour = hourCounts.reduce(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: 0, count: 0 }
  );
  const topDay = dayCounts.reduce(
    (best, count, day) => (count > best.count ? { day, count } : best),
    { day: 0, count: 0 }
  );

  return {
    hourCounts,
    dayCounts,
    topHour,
    topDay,
    timeZone
  };
}

function describeDaypart(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late night';
}

function formatPercentValue(value) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function clampProbability(value) {
  if (!Number.isFinite(value)) return MIN_PROBABILITY;
  return clamp(value, MIN_PROBABILITY, 1 - MIN_PROBABILITY);
}

function logAddExp(a, b) {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  const max = Math.max(a, b);
  return max + Math.log(Math.exp(a - max) + Math.exp(b - max));
}

function logCombination(n, k) {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  const reduced = Math.min(k, n - k);
  if (reduced === 0) return 0;
  let logValue = 0;
  for (let i = 1; i <= reduced; i += 1) {
    logValue += Math.log(n - reduced + i) - Math.log(i);
  }
  return logValue;
}

function logBinomialPmf(k, n, p) {
  const safeP = clampProbability(p);
  return logCombination(n, k) + k * Math.log(safeP) + (n - k) * Math.log(1 - safeP);
}

function exactBinomialTailProbability(n, k, p, direction = 'greater') {
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (!Number.isFinite(k)) return 1;

  const successes = clamp(Math.round(k), 0, n);
  const safeP = clampProbability(p);
  let logTail = Number.NEGATIVE_INFINITY;

  if (direction === 'less') {
    for (let i = 0; i <= successes; i += 1) {
      logTail = logAddExp(logTail, logBinomialPmf(i, n, safeP));
    }
  } else {
    for (let i = successes; i <= n; i += 1) {
      logTail = logAddExp(logTail, logBinomialPmf(i, n, safeP));
    }
  }

  if (!Number.isFinite(logTail)) return 1;
  return clamp(Math.exp(logTail), 0, 1);
}

function computeWilsonInterval(successes, trials, z = WILSON_CONFIDENCE_Z_95) {
  const n = Math.max(0, Math.round(trials || 0));
  const x = clamp(Math.round(successes || 0), 0, n);
  if (!n) return { low: 0, high: 0 };

  const phat = x / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denominator;
  const margin = (z / denominator) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));

  return {
    low: clamp(center - margin, 0, 1),
    high: clamp(center + margin, 0, 1)
  };
}

function computeBenjaminiHochbergQValues(pValues = []) {
  const indexed = pValues
    .map((pValue, index) => ({
      index,
      pValue: Number.isFinite(pValue) ? clamp(pValue, 0, 1) : 1
    }))
    .sort((a, b) => a.pValue - b.pValue);

  const total = indexed.length;
  if (!total) return [];

  const qValues = new Array(total).fill(1);
  let runningMin = 1;

  for (let i = total - 1; i >= 0; i -= 1) {
    const rank = i + 1;
    const adjusted = (indexed[i].pValue * total) / rank;
    runningMin = Math.min(runningMin, adjusted);
    qValues[indexed[i].index] = clamp(runningMin, 0, 1);
  }

  return qValues;
}

function getBundleSignalLabel(falseDiscoveryRisk) {
  if (!Number.isFinite(falseDiscoveryRisk)) return 'Emerging';
  if (falseDiscoveryRisk <= BUNDLE_SIGNAL_THRESHOLDS.strong) return 'Strong';
  if (falseDiscoveryRisk <= BUNDLE_SIGNAL_THRESHOLDS.reliable) return 'Reliable';
  if (falseDiscoveryRisk <= BUNDLE_SIGNAL_THRESHOLDS.directional) return 'Directional';
  return 'Emerging';
}

function formatLiftMultiplier(value) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${value.toFixed(2)}x`;
}

function formatCountValue(value) {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString('en-US');
}

function formatSignedCountValue(value) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${formatCountValue(rounded)}`;
}

function getBundleTier(bundle) {
  if (!bundle) return null;
  const pairOrders = Math.max(0, Math.round(toNumber(bundle.count)));
  const anchorOrders = Math.max(0, Math.round(toNumber(bundle.anchorOrders)));
  const falseDiscoveryRisk = Number.isFinite(bundle.falseDiscoveryRisk)
    ? clamp(bundle.falseDiscoveryRisk, 0, 1)
    : 1;

  if (
    pairOrders >= BUNDLE_T1_MIN_PAIR_ORDERS
    && anchorOrders >= BUNDLE_T1_MIN_ANCHOR_ORDERS
    && falseDiscoveryRisk <= BUNDLE_FDR_TARGET
  ) {
    return 'T1';
  }

  if (
    pairOrders >= BUNDLE_T2_MIN_PAIR_ORDERS
    && anchorOrders >= BUNDLE_T2_MIN_ANCHOR_ORDERS
  ) {
    return 'T2';
  }

  if (pairOrders >= BUNDLE_MIN_PAIR_ORDERS_DISPLAY) return 'T3';
  return null;
}

function getBundleTrendState(previousCount) {
  const previous = Math.max(0, Math.round(toNumber(previousCount)));
  if (!previous) return 'new';
  if (previous < BUNDLE_TREND_MIN_PREVIOUS_ORDERS) return 'limited';
  return 'sufficient';
}

function describeBundleOrdersDelta(currentCount, previousCount) {
  const current = Math.max(0, Math.round(toNumber(currentCount)));
  const previous = Math.max(0, Math.round(toNumber(previousCount)));
  const delta = current - previous;
  const trendState = getBundleTrendState(previous);

  if (trendState === 'new') {
    return {
      trendState,
      delta,
      deltaText: 'New this period',
      narrativeText: `first appeared this period with ${formatCountValue(current)} co-purchases`,
      hasPercentChange: false,
      percentText: null
    };
  }

  if (trendState === 'limited') {
    return {
      trendState,
      delta,
      deltaText: `${formatSignedCountValue(delta)} vs ${formatCountValue(previous)} last period`,
      narrativeText: `recorded ${formatCountValue(current)} co-purchases this period with limited prior history (${formatCountValue(previous)} last period)`,
      hasPercentChange: false,
      percentText: null
    };
  }

  const changeRate = previous > 0 ? delta / previous : 0;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const absDelta = formatCountValue(Math.abs(delta));
  const percentText = `${changeRate > 0 ? '+' : ''}${(changeRate * 100).toFixed(0)}%`;

  if (direction === 'flat') {
    return {
      trendState,
      delta,
      deltaText: 'Flat vs last period',
      narrativeText: `held flat versus last period`,
      hasPercentChange: true,
      percentText: '0%'
    };
  }

  return {
    trendState,
    delta,
    deltaText: `${formatSignedCountValue(delta)} (${percentText})`,
    narrativeText: `${direction} ${absDelta} (${percentText}) versus last period`,
    hasPercentChange: true,
    percentText
  };
}

function getWatchlistProgress(bundle) {
  const pairGap = Math.max(0, BUNDLE_T1_MIN_PAIR_ORDERS - Math.max(0, Math.round(toNumber(bundle?.count))));
  const anchorGap = Math.max(0, BUNDLE_T1_MIN_ANCHOR_ORDERS - Math.max(0, Math.round(toNumber(bundle?.anchorOrders))));
  return { pairGap, anchorGap };
}

function isConfiguredBundleMarkerRow(row) {
  const text = [row?.title, row?.cache_title, row?.sku]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!text) return false;
  return BUNDLE_CONFIGURED_MARKER_REGEX.test(text);
}

function getBundleTypeLabel(bundleType) {
  return BUNDLE_TYPE_LABELS[bundleType] || BUNDLE_TYPE_LABELS[BUNDLE_TYPE_ORGANIC];
}

function getBundleAction(bundle) {
  const tier = bundle?.tier || getBundleTier(bundle);
  const trendState = bundle?.trendState || getBundleTrendState(bundle?.previousCount);
  if (!tier) {
    return {
      recommendedAction: 'Collect additional co-purchase history before taking action.',
      successKpi: `Reach at least ${formatCountValue(BUNDLE_MIN_PAIR_ORDERS_DISPLAY)} pair orders before operationalizing.`
    };
  }

  if (tier === 'T3') {
    return {
      recommendedAction: 'Early signal only; keep this pair in observation while collecting more periods.',
      successKpi: `Reach watchlist thresholds (${formatCountValue(BUNDLE_T2_MIN_PAIR_ORDERS)} pair orders and ${formatCountValue(BUNDLE_T2_MIN_ANCHOR_ORDERS)} anchor orders).`
    };
  }

  if (tier === 'T2') {
    const { pairGap, anchorGap } = getWatchlistProgress(bundle);
    if (pairGap > 0 && anchorGap > 0) {
      return {
        recommendedAction: 'Watchlist pair building momentum; continue monitoring before formalizing.',
        successKpi: `Reach ${formatCountValue(pairGap)} more pair orders and ${formatCountValue(anchorGap)} more anchor orders to become actionable.`
      };
    }
    if (pairGap > 0) {
      return {
        recommendedAction: 'Watchlist pair close to actionable; keep monitoring co-purchases.',
        successKpi: `Reach ${formatCountValue(pairGap)} more pair orders to become actionable.`
      };
    }
    if (anchorGap > 0) {
      return {
        recommendedAction: 'Watchlist pair close to actionable; grow anchor volume before scaling.',
        successKpi: `Reach ${formatCountValue(anchorGap)} more anchor orders to become actionable.`
      };
    }
    return {
      recommendedAction: 'Watchlist pair is near the actionable threshold; validate one more period before rollout.',
      successKpi: 'Maintain current attach rate while increasing anchor-order volume.'
    };
  }

  const isConfigured = bundle?.bundleType === BUNDLE_TYPE_CONFIGURED;
  const orderDelta = toNumber(bundle?.countDelta);
  const attachDelta = toNumber(bundle?.attachRateDelta);

  if (isConfigured) {
    if (trendState !== 'sufficient' && (orderDelta < 0 || attachDelta < 0)) {
      return {
        recommendedAction: 'Configured bundle trend is negative but history is limited; continue monitoring before major changes.',
        successKpi: `Collect at least ${formatCountValue(BUNDLE_TREND_MIN_PREVIOUS_ORDERS)} previous-period orders for trend validation.`
      };
    }
    if (orderDelta < 0 || attachDelta < 0) {
      return {
        recommendedAction: `Declining configured bundle; audit pricing, placement, stock, and creative, then relaunch a ${formatCountValue(BUNDLE_ACTION_WINDOW_DAYS)}-day recovery test.`,
        successKpi: `Configured bundle orders and bundle gross margin over the next ${formatCountValue(BUNDLE_ACTION_WINDOW_DAYS)} days.`
      };
    }
    return {
      recommendedAction: 'Configured bundle is stable; scale traffic to anchor-led placements while enforcing margin guardrails.',
      successKpi: 'Configured bundle orders and blended margin hold at or above the current period baseline.'
    };
  }

  if (trendState === 'new') {
    return {
      recommendedAction: 'Newly detected co-purchase; add as a PDP/cart cross-sell and collect one more full period before formal bundle rollout.',
      successKpi: 'Repeat co-purchase count in the next period and attach-rate retention.'
    };
  }

  if (trendState === 'limited') {
    return {
      recommendedAction: 'Positive early signal with limited history; keep as cross-sell until trend history is sufficient.',
      successKpi: `Reach at least ${formatCountValue(BUNDLE_TREND_MIN_PREVIOUS_ORDERS)} previous-period co-purchases while maintaining current attach rate.`
    };
  }

  if (orderDelta >= 0 || attachDelta >= 0) {
    return {
      recommendedAction: `Validated organic co-purchase with positive trend; launch as explicit bundle offer and run a controlled ${formatCountValue(BUNDLE_ACTION_WINDOW_DAYS)}-day test.`,
      successKpi: 'Bundle take rate and incremental AOV versus a no-offer control.'
    };
  }

  return {
    recommendedAction: 'Organic co-purchase is flat or declining; keep as cross-sell and test a light incentive before formal bundling.',
    successKpi: 'Attach-rate recovery and incremental revenue per anchor session in the next test window.'
  };
}

function buildBundleNarrative(bundle) {
  if (!bundle || !Array.isArray(bundle.pair)) return null;
  const anchor = bundle.pair[0] || 'Anchor product';
  const attach = bundle.pair[1] || 'Attach product';
  const pairOrdersCurrent = Math.max(0, Math.round(toNumber(bundle.count)));
  const pairOrdersPrevious = Math.max(0, Math.round(toNumber(bundle.previousCount)));
  const attachRateCurrent = Number.isFinite(bundle.attachRate) ? bundle.attachRate : 0;
  const attachRatePrevious = Number.isFinite(bundle.previousAttachRate) ? bundle.previousAttachRate : 0;
  const baselineCurrent = Number.isFinite(bundle.baselineRate) ? bundle.baselineRate : 0;
  const baselinePrevious = Number.isFinite(bundle.previousBaselineRate) ? bundle.previousBaselineRate : 0;
  const liftText = formatLiftMultiplier(bundle.lift);
  const falseDiscoveryRiskText = formatPercentValue(bundle.falseDiscoveryRisk);
  const confidenceText = formatPercentValue(bundle.statisticalConfidence);
  const orderChange = describeBundleOrdersDelta(pairOrdersCurrent, pairOrdersPrevious);
  const trendState = orderChange.trendState;
  const attachRateChangeText = Number.isFinite(bundle.attachRateDeltaRate)
    ? `${bundle.attachRateDeltaRate > 0 ? '+' : ''}${(bundle.attachRateDeltaRate * 100).toFixed(0)}%`
    : null;
  const action = getBundleAction(bundle);
  const bundleTypeLabel = bundle.bundleTypeLabel || getBundleTypeLabel(bundle.bundleType);

  let businessSummary = '';
  if (trendState === 'new') {
    businessSummary = `${bundleTypeLabel}: ${anchor} + ${attach} first appeared this period with ${formatCountValue(pairOrdersCurrent)} co-purchases across ${formatCountValue(toNumber(bundle.anchorOrders))} ${anchor} orders. Attach rate is ${formatPercentValue(attachRateCurrent)} against a ${formatPercentValue(baselineCurrent)} baseline.`;
  } else if (trendState === 'limited') {
    businessSummary = `${bundleTypeLabel}: ${anchor} + ${attach} recorded ${formatCountValue(pairOrdersCurrent)} co-purchases this period with limited prior history (${formatCountValue(pairOrdersPrevious)} last period). Attach rate is ${formatPercentValue(attachRateCurrent)} versus ${formatPercentValue(attachRatePrevious)} previously.`;
  } else {
    businessSummary = `${bundleTypeLabel}: ${anchor} + ${attach} recorded ${formatCountValue(pairOrdersCurrent)} orders this period vs ${formatCountValue(pairOrdersPrevious)} last period, ${orderChange.narrativeText}. Attach rate moved from ${formatPercentValue(attachRatePrevious)} to ${formatPercentValue(attachRateCurrent)}${attachRateChangeText ? ` (${attachRateChangeText})` : ''}.`;
  }

  const methodology = `Compared this period with the immediately preceding window of equal length. Classified as ${bundleTypeLabel} using Shopify product-name/SKU markers; all remaining pairs are treated as Organic Co-Purchase.`;

  const computationLogic = [
    `Orders change: ${formatCountValue(pairOrdersCurrent)} this period vs ${formatCountValue(pairOrdersPrevious)} last period (${orderChange.deltaText}).`,
    `Attach rate = pair orders / anchor orders = ${formatPercentValue(attachRateCurrent)} this period vs ${formatPercentValue(attachRatePrevious)} last period.`,
    `Baseline = attach-product order share across all orders = ${formatPercentValue(baselineCurrent)} this period vs ${formatPercentValue(baselinePrevious)} last period.`,
    `Lift = attach rate / baseline = ${liftText}. Reliability uses exact binomial testing with false-discovery control (risk ${falseDiscoveryRiskText}, confidence ${confidenceText}).`
  ].join(' ');

  const title = `${anchor} with ${attach}`;

  return {
    title,
    businessSummary,
    methodology,
    computationLogic,
    recommendedAction: action.recommendedAction,
    successKpi: action.successKpi,
    trendState
  };
}

function buildBundleKeyInsights(bundles = [], maxCount = BUNDLE_INSIGHT_MAX_COUNT) {
  if (!Array.isArray(bundles) || !bundles.length) return [];
  const limit = Math.max(1, Math.min(maxCount, bundles.length));
  return bundles.slice(0, limit).map((bundle, index) => {
    const narrative = buildBundleNarrative(bundle);
    return {
      id: `bundle-key-${index + 1}-${bundle.pairKeys?.[0] || 'a'}-${bundle.pairKeys?.[1] || 'b'}`,
      type: 'bundle',
      text: narrative?.businessSummary || 'Bundle signal detected from product-level co-purchase behavior.',
      title: narrative?.title || 'Bundle signal detected',
      businessSummary: narrative?.businessSummary || null,
      methodology: narrative?.methodology || null,
      computationLogic: narrative?.computationLogic || null,
      recommendedAction: narrative?.recommendedAction || null,
      successKpi: narrative?.successKpi || null,
      classification: bundle.bundleTypeLabel || getBundleTypeLabel(bundle.bundleType),
      signal: bundle.signal || 'Emerging',
      falseDiscoveryRisk: Number.isFinite(bundle.falseDiscoveryRisk) ? bundle.falseDiscoveryRisk : null,
      statisticalConfidence: Number.isFinite(bundle.statisticalConfidence) ? bundle.statisticalConfidence : null,
      tier: bundle.tier || getBundleTier(bundle),
      trendState: bundle.trendState || getBundleTrendState(bundle?.previousCount),
      pair: bundle.pair,
      pairKeys: bundle.pairKeys
    };
  });
}

function computeDirectionalBundleLookup(items) {
  const orderProducts = new Map();

  items.forEach((row) => {
    if (!row.order_id) return;
    const productKey = getProductKey(row);
    if (!productKey) return;
    const normalizedKey = String(productKey);
    const productSet = orderProducts.get(row.order_id) || new Set();
    productSet.add(normalizedKey);
    orderProducts.set(row.order_id, productSet);
  });

  const totalOrders = orderProducts.size;
  const productOrderCounts = new Map();
  const pairCounts = new Map();

  orderProducts.forEach((products) => {
    const rows = Array.from(products);
    rows.forEach((productKey) => {
      productOrderCounts.set(productKey, (productOrderCounts.get(productKey) || 0) + 1);
    });

    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const [a, b] = [rows[i], rows[j]].sort();
        const pairKey = `${a}||${b}`;
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
    }
  });

  const lookup = new Map();
  pairCounts.forEach((pairCount, pairKey) => {
    const [a, b] = pairKey.split('||');
    const countA = productOrderCounts.get(a) || 0;
    const countB = productOrderCounts.get(b) || 0;
    if (!countA || !countB) return;

    const metricsAtoB = {
      count: pairCount,
      anchorOrders: countA,
      attachOrders: countB,
      attachRate: safeDivide(pairCount, countA),
      baselineRate: safeDivide(countB, totalOrders)
    };

    const metricsBtoA = {
      count: pairCount,
      anchorOrders: countB,
      attachOrders: countA,
      attachRate: safeDivide(pairCount, countB),
      baselineRate: safeDivide(countA, totalOrders)
    };

    lookup.set(`${a}||${b}`, metricsAtoB);
    lookup.set(`${b}||${a}`, metricsBtoA);
  });

  return lookup;
}

function enrichBundlesWithPeriodComparison(bundles, previousLookup) {
  if (!Array.isArray(bundles) || !bundles.length) return [];

  return bundles.map((bundle) => {
    const directionKey = `${bundle.pairKeys?.[0] || ''}||${bundle.pairKeys?.[1] || ''}`;
    const previous = previousLookup?.get(directionKey) || null;
    const previousCount = Number.isFinite(previous?.count) ? previous.count : 0;
    const previousAttachRate = Number.isFinite(previous?.attachRate) ? previous.attachRate : 0;
    const previousBaselineRate = Number.isFinite(previous?.baselineRate) ? previous.baselineRate : 0;
    const countDelta = toNumber(bundle.count) - previousCount;
    const trendState = getBundleTrendState(previousCount);
    const hasTrendHistory = trendState === 'sufficient';
    const countDeltaRate = hasTrendHistory && previousCount > 0 ? countDelta / previousCount : null;
    const attachRateDelta = toNumber(bundle.attachRate) - previousAttachRate;
    const attachRateDeltaRate = hasTrendHistory && previousAttachRate > 0 ? attachRateDelta / previousAttachRate : null;

    return {
      ...bundle,
      previousCount,
      trendState,
      countDelta,
      countDeltaRate,
      previousAttachRate,
      attachRateDelta,
      attachRateDeltaRate,
      previousBaselineRate
    };
  });
}

function computeBundles(items) {
  const orderProducts = new Map();
  const orderRevenueByProduct = new Map();
  const labelByKey = new Map();
  const productMetadataByKey = new Map();

  items.forEach((row) => {
    if (!row.order_id) return;
    const productKey = getProductKey(row);
    if (!productKey) return;
    const normalizedKey = String(productKey);
    const label = getProductLabel(row);
    if (label && !labelByKey.has(normalizedKey)) labelByKey.set(normalizedKey, label);
    const metadata = productMetadataByKey.get(normalizedKey) || { hasConfiguredMarker: false };
    if (isConfiguredBundleMarkerRow(row)) metadata.hasConfiguredMarker = true;
    productMetadataByKey.set(normalizedKey, metadata);

    const productSet = orderProducts.get(row.order_id) || new Set();
    productSet.add(normalizedKey);
    orderProducts.set(row.order_id, productSet);

    const quantity = Math.max(1, toNumber(row.quantity || 1));
    const netFromRow = toNumber(row.price) * quantity - toNumber(row.discount);
    const netRevenue = Math.max(0, Number.isFinite(row.net_price) ? toNumber(row.net_price) : netFromRow);
    const revenueByProduct = orderRevenueByProduct.get(row.order_id) || new Map();
    revenueByProduct.set(normalizedKey, (revenueByProduct.get(normalizedKey) || 0) + netRevenue);
    orderRevenueByProduct.set(row.order_id, revenueByProduct);
  });

  const totalOrders = orderProducts.size;
  if (!totalOrders) return [];

  const productOrderCounts = new Map();
  const productRevenueTotals = new Map();
  const pairCounts = new Map();

  orderProducts.forEach((products, orderId) => {
    const rows = Array.from(products);
    const revenueMap = orderRevenueByProduct.get(orderId) || new Map();

    rows.forEach((productKey) => {
      productOrderCounts.set(productKey, (productOrderCounts.get(productKey) || 0) + 1);
      productRevenueTotals.set(productKey, (productRevenueTotals.get(productKey) || 0) + (revenueMap.get(productKey) || 0));
    });

    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const [a, b] = [rows[i], rows[j]].sort();
        const pairKey = `${a}||${b}`;
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
      }
    }
  });

  const directionalCandidates = [];

  pairCounts.forEach((pairCount, pairKey) => {
    if (pairCount < BUNDLE_MIN_PAIR_ORDERS_DISPLAY) return;
    const [a, b] = pairKey.split('||');
    const countA = productOrderCounts.get(a) || 0;
    const countB = productOrderCounts.get(b) || 0;
    if (!countA || !countB) return;

    const directions = [
      { anchorKey: a, attachKey: b, anchorOrders: countA, attachOrders: countB },
      { anchorKey: b, attachKey: a, anchorOrders: countB, attachOrders: countA }
    ];

    directions.forEach((direction) => {
      const baselineRate = safeDivide(direction.attachOrders, totalOrders);
      const attachRate = safeDivide(pairCount, direction.anchorOrders);
      const absoluteLift = attachRate - baselineRate;
      const lift = baselineRate > 0 ? attachRate / baselineRate : 0;
      const interval = computeWilsonInterval(pairCount, direction.anchorOrders, WILSON_CONFIDENCE_Z_95);
      const pValue = exactBinomialTailProbability(
        direction.anchorOrders,
        pairCount,
        baselineRate,
        absoluteLift >= 0 ? 'greater' : 'less'
      );

      const avgAttachRevenue = safeDivide(
        productRevenueTotals.get(direction.attachKey) || 0,
        direction.attachOrders
      );
      const anchorAvgRevenue = safeDivide(
        productRevenueTotals.get(direction.anchorKey) || 0,
        direction.anchorOrders
      );
      const attachAvgRevenue = safeDivide(
        productRevenueTotals.get(direction.attachKey) || 0,
        direction.attachOrders
      );
      const anchorMeta = productMetadataByKey.get(direction.anchorKey) || {};
      const attachMeta = productMetadataByKey.get(direction.attachKey) || {};
      const bundleType = (anchorMeta.hasConfiguredMarker || attachMeta.hasConfiguredMarker)
        ? BUNDLE_TYPE_CONFIGURED
        : BUNDLE_TYPE_ORGANIC;
      const expectedIncrementalAttachOrders = absoluteLift * direction.anchorOrders;
      const expectedIncrementalRevenue = expectedIncrementalAttachOrders * avgAttachRevenue;

      directionalCandidates.push({
        pairKey,
        pair: [
          labelByKey.get(direction.anchorKey) || direction.anchorKey,
          labelByKey.get(direction.attachKey) || direction.attachKey
        ],
        pairKeys: [direction.anchorKey, direction.attachKey],
        count: pairCount,
        support: safeDivide(pairCount, totalOrders),
        anchorOrders: direction.anchorOrders,
        attachOrders: direction.attachOrders,
        attachRate,
        attachRateCiLow: interval.low,
        attachRateCiHigh: interval.high,
        baselineRate,
        absoluteLift,
        lift,
        pValue,
        avgAttachRevenue,
        anchorAvgRevenue,
        attachAvgRevenue,
        expectedIncrementalAttachOrders,
        expectedIncrementalRevenue,
        bundleType,
        bundleTypeLabel: getBundleTypeLabel(bundleType)
      });
    });
  });

  const qValues = computeBenjaminiHochbergQValues(directionalCandidates.map((row) => row.pValue));
  const scored = directionalCandidates.map((row, index) => {
    const falseDiscoveryRisk = qValues[index] ?? 1;
    const statisticalConfidence = clamp(1 - falseDiscoveryRisk, 0, 1);
    const positiveIncrementalRevenue = Math.max(0, row.expectedIncrementalRevenue);
    const rankingConfidence = statisticalConfidence >= BUNDLE_RANK_CONFIDENCE_FLOOR ? statisticalConfidence : 0;
    const rankScore = positiveIncrementalRevenue * rankingConfidence;

    return {
      ...row,
      falseDiscoveryRisk,
      statisticalConfidence,
      rankingConfidence,
      controlsFalseDiscoveries: falseDiscoveryRisk <= BUNDLE_FDR_TARGET,
      signal: getBundleSignalLabel(falseDiscoveryRisk),
      rankScore
    };
  });

  const scoredByPair = new Map();
  scored.forEach((row) => {
    const list = scoredByPair.get(row.pairKey) || [];
    list.push(row);
    scoredByPair.set(row.pairKey, list);
  });

  const topDirectionByPair = new Map();
  scoredByPair.forEach((pairRows, pairKey) => {
    const strategicRows = pairRows.filter((row) =>
      Number.isFinite(row.anchorAvgRevenue)
      && Number.isFinite(row.attachAvgRevenue)
      && row.anchorAvgRevenue >= row.attachAvgRevenue
    );
    const pool = strategicRows.length ? strategicRows : pairRows;
    const sortedPool = [...pool].sort((a, b) => {
      if ((b.rankScore || 0) !== (a.rankScore || 0)) return (b.rankScore || 0) - (a.rankScore || 0);
      if ((a.falseDiscoveryRisk || 1) !== (b.falseDiscoveryRisk || 1)) return (a.falseDiscoveryRisk || 1) - (b.falseDiscoveryRisk || 1);
      return (b.count || 0) - (a.count || 0);
    });
    topDirectionByPair.set(pairKey, sortedPool[0]);
  });

  return Array.from(topDirectionByPair.values())
    .sort((a, b) => {
      if ((b.rankScore || 0) !== (a.rankScore || 0)) return (b.rankScore || 0) - (a.rankScore || 0);
      if ((a.falseDiscoveryRisk || 1) !== (b.falseDiscoveryRisk || 1)) return (a.falseDiscoveryRisk || 1) - (b.falseDiscoveryRisk || 1);
      return (b.count || 0) - (a.count || 0);
    })
    .slice(0, BUNDLE_RESULT_LIMIT)
    .map((row) => ({
      ...row,
      pValue: clamp(row.pValue, 0, 1),
      falseDiscoveryRisk: clamp(row.falseDiscoveryRisk, 0, 1),
      tier: getBundleTier(row)
    }));
}

function computeRepeatPaths(items) {
  const ordersById = new Map();
  const labelByKey = new Map();

  items.forEach((row) => {
    if (!row.order_id) return;
    const entry = ordersById.get(row.order_id) || {
      order_id: row.order_id,
      customer_id: row.customer_id,
      ts: row.order_created_at ? new Date(row.order_created_at) : null,
      products: new Map()
    };

    const productKey = getProductKey(row);
    if (!productKey) return;
    const label = getProductLabel(row);
    if (label && !labelByKey.has(productKey)) labelByKey.set(productKey, label);

    const revenue = toNumber(row.price) * toNumber(row.quantity || 1);
    entry.products.set(String(productKey), (entry.products.get(String(productKey)) || 0) + revenue);
    ordersById.set(row.order_id, entry);
  });

  const customerOrders = new Map();
  ordersById.forEach((order) => {
    if (!order.customer_id || order.products.size === 0) return;
    const list = customerOrders.get(order.customer_id) || [];
    list.push(order);
    customerOrders.set(order.customer_id, list);
  });

  const transitions = new Map();

  const pickPrimaryProduct = (products) => {
    let bestKey = null;
    let bestRevenue = -1;
    products.forEach((revenue, key) => {
      if (revenue > bestRevenue) {
        bestRevenue = revenue;
        bestKey = key;
      }
    });
    return bestKey;
  };

  customerOrders.forEach((list) => {
    list.sort((a, b) => {
      const at = a.ts ? a.ts.getTime() : 0;
      const bt = b.ts ? b.ts.getTime() : 0;
      return at - bt;
    });

    for (let i = 0; i < list.length - 1; i += 1) {
      const fromKey = pickPrimaryProduct(list[i].products);
      const toKey = pickPrimaryProduct(list[i + 1].products);
      if (!fromKey || !toKey || fromKey === toKey) continue;
      const key = `${fromKey}||${toKey}`;
      transitions.set(key, (transitions.get(key) || 0) + 1);
    }
  });

  return Array.from(transitions.entries())
    .map(([key, count]) => {
      const [fromKey, toKey] = key.split('||');
      return {
        from: labelByKey.get(fromKey) || fromKey,
        to: labelByKey.get(toKey) || toKey,
        fromKey,
        toKey,
        count
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function computeTopProducts(items) {
  const byProduct = new Map();

  items.forEach((row) => {
    const productKey = getProductKey(row);
    if (!productKey || !row.order_id) return;
    const label = getProductLabel(row) || 'Product';

    const entry = byProduct.get(productKey) || {
      key: String(productKey),
      title: label,
      image_url: row.image_url || null,
      quantity: 0,
      revenue: 0,
      orderIds: new Set()
    };

    if (!entry.image_url && row.image_url) entry.image_url = row.image_url;
    if ((!entry.title || /^Product\s\d+$/.test(entry.title)) && label) entry.title = label;

    const quantity = toNumber(row.quantity || 1);
    const revenue = toNumber(row.price) * quantity;

    entry.quantity += quantity;
    entry.revenue += revenue;
    entry.orderIds.add(row.order_id);

    byProduct.set(productKey, entry);
  });

  return Array.from(byProduct.values())
    .map((row) => ({
      key: row.key,
      title: row.title,
      image_url: row.image_url,
      quantity: row.quantity,
      revenue: row.revenue,
      orders: row.orderIds.size
    }))
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      if (b.orders !== a.orders) return b.orders - a.orders;
      return b.quantity - a.quantity;
    })
    .slice(0, 12);
}

function computeProductMetrics(items) {
  const byProduct = new Map();

  items.forEach((row) => {
    const productKey = getProductKey(row);
    if (!productKey || !row.order_id) return;
    const label = getProductLabel(row) || 'Product';

    const entry = byProduct.get(productKey) || {
      key: String(productKey),
      title: label,
      revenue: 0,
      orders: 0,
      orderIds: new Set()
    };

    if ((!entry.title || /^Product\s\d+$/.test(entry.title)) && label) entry.title = label;

    const quantity = toNumber(row.quantity || 1);
    const revenue = toNumber(row.price) * quantity;

    entry.revenue += revenue;
    entry.orderIds.add(row.order_id);

    byProduct.set(productKey, entry);
  });

  return new Map(Array.from(byProduct.entries()).map(([key, row]) => [key, {
    ...row,
    orders: row.orderIds.size
  }]));
}

function rankProducts(metricsMap) {
  const sorted = Array.from(metricsMap.values())
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      if (b.orders !== a.orders) return b.orders - a.orders;
      return a.title.localeCompare(b.title);
    });

  const ranks = new Map();
  sorted.forEach((row, index) => {
    ranks.set(row.key, index + 1);
  });

  return { sorted, ranks };
}

// ── Two-proportion z-test ────────────────────────────────────────────────────
function computeTwoProportionZTest(k1, n1, k2, n2) {
  if (!n1 || !n2) return 1;
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const pPooled = (k1 + k2) / (n1 + n2);
  if (pPooled <= 0 || pPooled >= 1) return 1;
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
  if (se <= 0) return 1;
  const z = (p1 - p2) / se;
  // Two-sided p-value via normal CDF approximation
  const absZ = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989422804014327;
  const p = d * Math.exp(-absZ * absZ / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.8212560 + t * 1.3302744))));
  return clamp(2 * p, 0, 1);
}

// ── CUSUM (cumulative sum control chart) ─────────────────────────────────────
function computeCUSUM(dailyCounts) {
  if (!dailyCounts.length) return { driftUp: false, driftDown: false, maxUp: 0, maxDown: 0 };
  const mean = dailyCounts.reduce((s, v) => s + v, 0) / dailyCounts.length;
  const std = Math.sqrt(dailyCounts.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyCounts.length) || 1;
  const slack = 0.5 * std;
  let sumUp = 0;
  let sumDown = 0;
  let maxUp = 0;
  let maxDown = 0;
  dailyCounts.forEach((val) => {
    sumUp = Math.max(0, sumUp + (val - mean - slack));
    sumDown = Math.max(0, sumDown + (mean - slack - val));
    maxUp = Math.max(maxUp, sumUp);
    maxDown = Math.max(maxDown, sumDown);
  });
  const threshold = MOMENTUM_CUSUM_THRESHOLD * std;
  return {
    driftUp: maxUp >= threshold,
    driftDown: maxDown >= threshold,
    maxUp: std > 0 ? maxUp / std : 0,
    maxDown: std > 0 ? maxDown / std : 0
  };
}

// ── Empirical percentile rank ────────────────────────────────────────────────
function empiricalPercentileLabel(currentValue, historicalValues) {
  if (!historicalValues.length) return null;
  const sorted = [...historicalValues].sort((a, b) => a - b);
  if (currentValue > sorted[sorted.length - 1]) return 'Best period on record for this product';
  if (currentValue < sorted[0]) return 'Worst period on record for this product';
  const below = sorted.filter((v) => v < currentValue).length;
  const pct = below / sorted.length;
  if (pct >= 0.8) return 'Unusually strong for this product';
  if (pct <= 0.2) return 'Unusually slow for this product';
  return null;
}

// ── Daily sparkline builder ──────────────────────────────────────────────────
function buildDailySparkline(items, productKey) {
  const daily = new Map();
  items.forEach((row) => {
    const pk = getProductKey(row);
    if (pk !== productKey || !row.date) return;
    const d = String(row.date).slice(0, 10);
    const entry = daily.get(d) || { date: d, orders: 0, revenue: 0 };
    entry.orders += 1;
    entry.revenue += toNumber(row.price) * toNumber(row.quantity || 1);
    daily.set(d, entry);
  });
  return Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Momentum signal label (mirrors bundle convention) ────────────────────────
function getMomentumSignalLabel(qValue) {
  if (qValue <= 0.05) return 'Confirmed';
  if (qValue <= 0.10) return 'Likely';
  if (qValue <= 0.20) return 'Possible';
  return 'Emerging';
}

// ── Momentum severity ────────────────────────────────────────────────────────
function getMomentumSeverity(trigger, signal, revenueAtRisk) {
  const absRisk = Math.abs(revenueAtRisk || 0);
  if (trigger === 'hero_decline' && (signal === 'Confirmed' || signal === 'Likely')) return 'critical';
  if (absRisk > 5000 || trigger === 'hero_decline') return 'high';
  if (absRisk > 1000 || signal === 'Confirmed' || signal === 'Likely') return 'medium';
  return 'low';
}

// ── Momentum tier ────────────────────────────────────────────────────────────
function getMomentumTier(qValue, currOrders, prevOrders) {
  if (qValue <= MOMENTUM_FDR_TARGET && currOrders >= 5 && prevOrders >= 5) return 'T1';
  if (qValue <= 0.20 && currOrders >= MOMENTUM_MIN_ORDERS) return 'T2';
  if (currOrders >= 2) return 'T3';
  return null;
}

// ── Business trigger assessment ──────────────────────────────────────────────
function assessBusinessTrigger(trigger, product) {
  const templates = {
    hero_decline: {
      headline: `Your #${product.rank} product lost ${Math.abs(product.sharePointsDelta || 0).toFixed(1)}pp of revenue share`,
      action: 'Audit stock levels, creative fatigue, and pricing vs competitors. If all clear, test a refreshed PDP within 7 days.',
      kpi: `Recover revenue share above ${((product.prevRevenueShare || 0) * 100).toFixed(0)}% within 14 days`
    },
    concentration_risk: {
      headline: `"${product.title}" is ${((product.revenueShare || 0) * 100).toFixed(0)}% of your revenue — high dependency`,
      action: 'Redistribute ad spend across 2-3 secondary products. Develop alternatives to reduce single-product risk.',
      kpi: 'Reduce top-product share below 25% over 90 days'
    },
    rising_pillar: {
      headline: `"${product.title}" crossed ${((product.revenueShare || 0) * 100).toFixed(0)}% share and is still accelerating`,
      action: 'Increase ad spend allocation, add to homepage hero, ensure 3-week stock buffer.',
      kpi: `Maintain share above ${((product.revenueShare || 0) * 100 * 0.8).toFixed(0)}% for 14 days`
    },
    new_traction: {
      headline: `"${product.title}" is a new product gaining traction (${product.currOrders} orders)`,
      action: 'Keep spend allocation, don\'t kill early. Monitor conversion rate and return rate.',
      kpi: 'Sustain or grow order volume for 2 more weeks'
    },
    velocity_stall: {
      headline: `"${product.title}" growth stalled after weeks of gains`,
      action: 'Diagnose: is it seasonal, stock, or creative fatigue? Test A/B on PDP or offer.',
      kpi: 'Resume positive week-over-week growth within 14 days'
    },
    discount_dependency: {
      headline: `"${product.title}" is ${((product.discountShare || 0) * 100).toFixed(0)}% discount-driven — margin at risk`,
      action: 'Re-evaluate promotion strategy. Test reducing discount depth by 5-10% to measure demand sensitivity.',
      kpi: 'Reduce discount share below 50% while maintaining order volume'
    },
    quiet_exit: {
      headline: `"${product.title}" dropped out of your top 10`,
      action: 'Decide: markdown and clear inventory, or reinvest with refreshed creative and positioning.',
      kpi: 'Make a clear keep-or-sunset decision within 14 days'
    },
    discount_increase: {
      headline: `"${product.title}" discount reliance jumped ${((product.discountShareDelta || 0) * 100).toFixed(0)}pp vs prior period`,
      action: 'Review whether increased discounting is driving real new demand or cannibalizing full-price orders.',
      kpi: 'Full-price order share + gross margin per unit'
    }
  };
  return templates[trigger] || { headline: '', action: '', kpi: '' };
}

// ── Exceptional event headline ───────────────────────────────────────────────
function assessExceptionalEvent(event, product) {
  const templates = {
    first_hero_slip: {
      headline: `Your #1 product slipped for the first time in ${product.heroTenure || '?'} periods`,
      subline: 'A stable leader destabilizing is a structural shift — investigate what changed'
    },
    leaderboard_reshuffle: {
      headline: `${product.reshuffleCount || '?'} of your top 5 products changed rank this period`,
      subline: 'The demand landscape is shifting fast — review assortment strategy'
    },
    meteoric_rise: {
      headline: `"${product.title}" jumped ${product.rankJump || '?'} spots into your top ${product.rank}`,
      subline: 'Something caught fire — capitalize before the window closes'
    },
    record_period: {
      headline: `"${product.title}" hit an all-time high — ${product.currOrders} orders`,
      subline: 'Demand peak — ensure stock, scale spend to ride the wave'
    },
    sustained_streak: {
      headline: `"${product.title}" has grown ${product.streakLength || '?'} periods in a row`,
      subline: 'Reliable grower — flagship candidate, prioritize in marketing'
    },
    sharp_reversal: {
      headline: `"${product.title}" went from top grower to declining in one period`,
      subline: 'Was it a promo spike or organic demand? Investigate immediately'
    }
  };
  return templates[event] || { headline: '', subline: '' };
}

// ── Main momentum engine ─────────────────────────────────────────────────────
function computeProductMomentumEngine(currentItems, previousItems, prevPrevItems, discountSkuMap, prevDiscountSkuMap) {
  const currentMetrics = computeProductMetrics(currentItems);
  const previousMetrics = computeProductMetrics(previousItems);
  const prevPrevMetrics = prevPrevItems.length ? computeProductMetrics(prevPrevItems) : new Map();

  if (!currentMetrics.size) return { insights: [], momentum: [], watch: [] };

  const { sorted: currentSorted, ranks: currentRanks } = rankProducts(currentMetrics);
  const { ranks: previousRanks } = rankProducts(previousMetrics);
  const { ranks: prevPrevRanks } = prevPrevMetrics.size ? rankProducts(prevPrevMetrics) : { ranks: new Map() };

  const totalOrdersCurr = Array.from(currentMetrics.values()).reduce((s, p) => s + p.orders, 0);
  const totalOrdersPrev = Array.from(previousMetrics.values()).reduce((s, p) => s + p.orders, 0);
  const totalRevenueCurr = Array.from(currentMetrics.values()).reduce((s, p) => s + p.revenue, 0);

  // Collect all products for z-test and FDR
  const allProducts = [];

  currentMetrics.forEach((current) => {
    const prev = previousMetrics.get(current.key);
    const prevPrev = prevPrevMetrics.get(current.key);
    const currRank = currentRanks.get(current.key) || null;
    const prevRank = previousRanks.get(current.key) || null;
    const prevPrevRank = prevPrevRanks.get(current.key) || null;
    const currOrders = current.orders;
    const prevOrders = prev?.orders || 0;
    const prevPrevOrders = prevPrev?.orders || 0;
    const currRevenue = current.revenue || 0;
    const prevRevenue = prev?.revenue || 0;
    const revenueDelta = currRevenue - prevRevenue;
    const revenueLift = prevRevenue > 0 ? revenueDelta / prevRevenue : null;
    const revenueShare = totalRevenueCurr > 0 ? currRevenue / totalRevenueCurr : 0;
    const prevRevenueShare = totalOrdersPrev > 0 && prev ? prev.revenue / Array.from(previousMetrics.values()).reduce((s, p) => s + p.revenue, 0) : 0;
    const sharePointsDelta = revenueShare - prevRevenueShare;
    const rankDelta = prevRank ? prevRank - currRank : null;
    const isNew = !prevRank && currOrders >= MOMENTUM_MIN_ORDERS;

    // z-test for share shift
    const pValue = totalOrdersCurr >= 5 && totalOrdersPrev >= 5
      ? computeTwoProportionZTest(currOrders, totalOrdersCurr, prevOrders, totalOrdersPrev)
      : 1;

    // Week-over-week growth (orders-based)
    const wowGrowth = prevOrders > 0 ? currOrders / prevOrders : (currOrders > 0 ? 2 : 0);
    const prevWowGrowth = prevPrevOrders > 0 && prevOrders > 0 ? prevOrders / prevPrevOrders : null;

    // Discount share for this product
    const discountShare = discountSkuMap?.get(current.key) || 0;
    const prevDiscountShare = prevDiscountSkuMap?.get(current.key) || 0;
    const discountShareDelta = discountShare - prevDiscountShare;

    // Sparkline daily data
    const sparkline = buildDailySparkline(currentItems, current.key);
    const dailyCounts = sparkline.map((d) => d.orders);

    // CUSUM
    const cusum = computeCUSUM(dailyCounts);

    // Historical orders for empirical percentile
    const historicalOrders = [prevOrders];
    if (prevPrevOrders > 0) historicalOrders.push(prevPrevOrders);

    // Empirical percentile label
    const percentileLabel = empiricalPercentileLabel(currOrders, historicalOrders);

    allProducts.push({
      key: current.key,
      title: current.title,
      image_url: currentSorted.find((r) => r.key === current.key)?.image_url || null,
      rank: currRank,
      prevRank,
      prevPrevRank,
      rankDelta,
      currOrders,
      prevOrders,
      prevPrevOrders,
      currRevenue,
      prevRevenue,
      revenueDelta,
      revenueLift,
      revenueShare,
      prevRevenueShare,
      sharePointsDelta,
      isNew,
      pValue,
      wowGrowth,
      prevWowGrowth,
      discountShare,
      prevDiscountShare,
      discountShareDelta,
      sparkline,
      cusum,
      percentileLabel
    });
  });

  // BH FDR correction
  const pValues = allProducts.map((p) => p.pValue);
  const qValues = computeBenjaminiHochbergQValues(pValues);
  allProducts.forEach((p, i) => {
    p.qValue = qValues[i];
    p.signal = getMomentumSignalLabel(p.qValue);
    p.tier = getMomentumTier(p.qValue, p.currOrders, p.prevOrders);
  });

  // Wilson CI on current order share
  allProducts.forEach((p) => {
    if (totalOrdersCurr > 0) {
      const ci = computeWilsonInterval(p.currOrders, totalOrdersCurr);
      p.wilsonCiLow = ci.low;
      p.wilsonCiHigh = ci.high;
    } else {
      p.wilsonCiLow = 0;
      p.wilsonCiHigh = 0;
    }
  });

  // ── Layer 1: Business triggers ───────────────────────────────────────────
  const triggeredProducts = [];

  allProducts.forEach((p) => {
    const triggers = [];

    // Hero decline: top-2 product share drops significantly
    if (p.rank <= 2 && p.prevRank && p.prevRank <= 2 && p.sharePointsDelta < 0) {
      const relDrop = p.prevRevenueShare > 0 ? Math.abs(p.sharePointsDelta) / p.prevRevenueShare : 0;
      if (relDrop >= MOMENTUM_HERO_SHARE_DROP && p.qValue <= 0.20) {
        triggers.push('hero_decline');
      }
    }

    // Concentration risk: single product > threshold of revenue
    if (p.revenueShare > MOMENTUM_CONCENTRATION_RISK) {
      triggers.push('concentration_risk');
    }

    // Rising pillar: crosses share threshold and is accelerating
    if (p.revenueShare >= MOMENTUM_RISING_PILLAR_SHARE && p.wowGrowth > 1.0 && p.sharePointsDelta > 0) {
      triggers.push('rising_pillar');
    }

    // New product traction
    if (p.isNew && p.currOrders >= 5) {
      triggers.push('new_traction');
    }

    // Velocity stall: growth flipped from positive to ≤ 0
    if (p.prevWowGrowth != null && p.prevWowGrowth > 1.0 && p.wowGrowth <= 1.0 && p.currOrders >= MOMENTUM_MIN_ORDERS) {
      triggers.push('velocity_stall');
    }

    // Discount dependency
    if (p.discountShare >= MOMENTUM_DISCOUNT_DEPENDENCY && p.currOrders >= MOMENTUM_MIN_ORDERS) {
      triggers.push('discount_dependency');
    }

    // Discount share increase: rising discount reliance vs prior period
    if (p.prevDiscountShare > 0 && p.discountShareDelta >= MOMENTUM_DISCOUNT_PP_INCREASE && p.currOrders >= MOMENTUM_MIN_ORDERS) {
      triggers.push('discount_increase');
    }

    // Quiet exit: was top-10, now below threshold
    if (p.prevRank && p.prevRank <= 10 && (p.rank > 10 || p.currOrders < MOMENTUM_MIN_ORDERS)) {
      triggers.push('quiet_exit');
    }

    if (triggers.length) {
      triggeredProducts.push({ ...p, triggers });
    }
  });

  // ── Layer 2: Exceptional events ──────────────────────────────────────────
  const exceptionalEvents = [];

  // First hero slip: #1 held for multiple periods, just lost it
  const currentHero = allProducts.find((p) => p.rank === 1);
  if (currentHero) {
    const prevHeroKey = Array.from(previousMetrics.entries()).reduce((best, [key, val]) => {
      const r = previousRanks.get(key);
      return r === 1 ? key : best;
    }, null);
    const prevPrevHeroKey = prevPrevRanks.size
      ? Array.from(prevPrevMetrics.entries()).reduce((best, [key]) => {
        const r = prevPrevRanks.get(key);
        return r === 1 ? key : best;
      }, null)
      : null;

    if (prevHeroKey && prevHeroKey !== currentHero.key) {
      let tenure = 1;
      if (prevPrevHeroKey === prevHeroKey) tenure = 2;
      if (tenure >= 2) {
        const slippedProduct = allProducts.find((p) => p.key === prevHeroKey);
        if (slippedProduct) {
          slippedProduct.heroTenure = tenure + 1;
          exceptionalEvents.push({ event: 'first_hero_slip', product: slippedProduct });
        }
      }
    }
  }

  // Leaderboard reshuffle: ≥ N of top-5 changed rank
  const top5Current = allProducts.filter((p) => p.rank <= 5);
  const reshuffled = top5Current.filter((p) => p.prevRank && p.prevRank !== p.rank).length;
  if (reshuffled >= MOMENTUM_RESHUFFLE_MIN) {
    const representative = top5Current[0];
    if (representative) {
      representative.reshuffleCount = reshuffled;
      exceptionalEvents.push({ event: 'leaderboard_reshuffle', product: representative });
    }
  }

  // Meteoric rise: bottom-half jumped into top-10
  allProducts.forEach((p) => {
    if (p.prevRank && p.rank <= 10 && (p.prevRank - p.rank) >= MOMENTUM_METEORIC_RANK_JUMP && p.prevRank > allProducts.length / 2) {
      p.rankJump = p.prevRank - p.rank;
      exceptionalEvents.push({ event: 'meteoric_rise', product: p });
    }
  });

  // Record period: highest-ever orders (compared to available history)
  allProducts.forEach((p) => {
    const maxHistorical = Math.max(p.prevOrders, p.prevPrevOrders || 0);
    if (maxHistorical > 0 && p.currOrders > maxHistorical * 1.2 && p.currOrders >= 5) {
      exceptionalEvents.push({ event: 'record_period', product: p });
    }
  });

  // Sustained streak: grew for multiple consecutive periods
  allProducts.forEach((p) => {
    if (p.prevWowGrowth != null && p.prevWowGrowth >= (1 + MOMENTUM_STREAK_MIN_GROWTH) && p.wowGrowth >= (1 + MOMENTUM_STREAK_MIN_GROWTH)) {
      p.streakLength = p.prevPrevOrders > 0 ? 3 : 2;
      if (p.streakLength >= MOMENTUM_STREAK_MIN_PERIODS) {
        exceptionalEvents.push({ event: 'sustained_streak', product: p });
      }
    }
  });

  // Sharp reversal: was top-3 grower, now declining
  const prevGrowthRanked = allProducts
    .filter((p) => p.prevWowGrowth != null && p.prevWowGrowth > 1.0)
    .sort((a, b) => (b.prevWowGrowth || 0) - (a.prevWowGrowth || 0));
  const topGrowers = prevGrowthRanked.slice(0, 3);
  topGrowers.forEach((p) => {
    if (p.wowGrowth < 1.0 && p.currOrders >= MOMENTUM_MIN_ORDERS) {
      exceptionalEvents.push({ event: 'sharp_reversal', product: p });
    }
  });

  // ── Build event map for triggered products ───────────────────────────────
  const eventMap = new Map();
  exceptionalEvents.forEach(({ event, product }) => {
    const existing = eventMap.get(product.key) || [];
    existing.push(event);
    eventMap.set(product.key, existing);
  });

  // ── Build enriched insights (backward-compatible IDs) ────────────────────
  const allTriggered = [...triggeredProducts];
  // Add exceptional-event-only products not already triggered
  exceptionalEvents.forEach(({ product }) => {
    if (!allTriggered.find((t) => t.key === product.key)) {
      allTriggered.push({ ...product, triggers: [] });
    }
  });

  const momentumProducts = [];
  const watchProducts = [];

  allTriggered.forEach((p) => {
    const events = eventMap.get(p.key) || [];
    const primaryTrigger = p.triggers[0] || null;
    const primaryEvent = events[0] || null;

    const assessment = primaryTrigger ? assessBusinessTrigger(primaryTrigger, p) : { headline: '', action: '', kpi: '' };
    const eventAssessment = primaryEvent ? assessExceptionalEvent(primaryEvent, p) : null;

    const severity = primaryTrigger
      ? getMomentumSeverity(primaryTrigger, p.signal, p.revenueDelta)
      : 'medium';

    const revenueAtRisk = p.revenueDelta < 0 ? Math.abs(p.revenueDelta) * 2 : p.revenueDelta;

    const enriched = {
      key: p.key,
      title: p.title,
      image_url: p.image_url,
      trigger: primaryTrigger,
      exceptionalEvent: primaryEvent,
      triggers: p.triggers,
      exceptionalEvents: events,
      facts: {
        revenueShare: p.revenueShare,
        prevRevenueShare: p.prevRevenueShare,
        sharePointsDelta: p.sharePointsDelta,
        revenueDelta: p.revenueDelta,
        revenueLift: p.revenueLift,
        ordersDelta: p.currOrders - p.prevOrders,
        rank: p.rank,
        prevRank: p.prevRank,
        weekOverWeekGrowth: p.wowGrowth,
        discountShare: p.discountShare,
        percentileLabel: p.percentileLabel,
        heroTenure: p.heroTenure || null,
        rankJump: p.rankJump || null,
        streakLength: p.streakLength || null,
        reshuffleCount: p.reshuffleCount || null
      },
      statistical: {
        pValue: p.pValue,
        qValue: p.qValue,
        signal: p.signal,
        tier: p.tier,
        wilsonCi: { low: p.wilsonCiLow, high: p.wilsonCiHigh },
        cusum: { driftUp: p.cusum.driftUp, driftDown: p.cusum.driftDown }
      },
      assessment: {
        severity,
        revenueAtRisk,
        headline: eventAssessment?.headline || assessment.headline,
        subline: eventAssessment?.subline || '',
        action: assessment.action || (eventAssessment ? 'Investigate this pattern break immediately.' : ''),
        kpi: assessment.kpi || ''
      },
      sparkline: p.sparkline
    };

    // Classify as momentum or watch
    const isNegative = ['hero_decline', 'velocity_stall', 'discount_dependency', 'discount_increase', 'quiet_exit'].includes(primaryTrigger)
      || ['first_hero_slip', 'sharp_reversal'].includes(primaryEvent);

    if (isNegative) {
      watchProducts.push(enriched);
    } else {
      momentumProducts.push(enriched);
    }
  });

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  momentumProducts.sort((a, b) => (severityOrder[a.assessment.severity] ?? 3) - (severityOrder[b.assessment.severity] ?? 3));
  watchProducts.sort((a, b) => (severityOrder[a.assessment.severity] ?? 3) - (severityOrder[b.assessment.severity] ?? 3));

  // ── Build backward-compatible insight cards ──────────────────────────────
  const insights = [];
  const topMomentum = momentumProducts[0];
  const topWatch = watchProducts[0];

  if (topMomentum) {
    const t = topMomentum;
    insights.push({
      id: 'product-mover-up',
      title: t.title + ' surged',
      detail: t.assessment.headline + (t.assessment.subline ? ' — ' + t.assessment.subline : ''),
      impact: 'Product momentum',
      target: 'topProducts',
      confidence: t.statistical.signal === 'Confirmed' ? 0.9 : t.statistical.signal === 'Likely' ? 0.75 : t.statistical.signal === 'Possible' ? 0.55 : 0.4,
      // Enriched fields
      trigger: t.trigger,
      exceptionalEvent: t.exceptionalEvent,
      signal: t.statistical.signal,
      severity: t.assessment.severity,
      facts: t.facts,
      assessment: t.assessment,
      sparkline: t.sparkline
    });
  }

  if (topWatch) {
    const t = topWatch;
    insights.push({
      id: 'product-mover-down',
      title: t.title + ' softened',
      detail: t.assessment.headline + (t.assessment.subline ? ' — ' + t.assessment.subline : ''),
      impact: 'Product watch',
      target: 'topProducts',
      confidence: t.statistical.signal === 'Confirmed' ? 0.9 : t.statistical.signal === 'Likely' ? 0.75 : t.statistical.signal === 'Possible' ? 0.55 : 0.4,
      // Enriched fields
      trigger: t.trigger,
      exceptionalEvent: t.exceptionalEvent,
      signal: t.statistical.signal,
      severity: t.assessment.severity,
      facts: t.facts,
      assessment: t.assessment,
      sparkline: t.sparkline
    });
  }

  return {
    insights,
    momentum: momentumProducts.slice(0, MOMENTUM_RESULT_LIMIT),
    watch: watchProducts.slice(0, MOMENTUM_RESULT_LIMIT)
  };
}


function computeDiscountSkus(items) {
  const bySku = new Map();
  items.forEach((row) => {
    const { key, label } = getItemIdentity(row);
    const itemKey = key || row.title || row.product_id || row.sku;
    const itemLabel = label || row.title || row.product_id || row.sku;
    if (!itemKey || !itemLabel) return;

    const lookupKey = String(itemKey);
    const displayLabel = String(itemLabel);

    const entry = bySku.get(lookupKey) || {
      key: lookupKey,
      title: displayLabel,
      orders: 0,
      revenue: 0,
      discountedRevenue: 0,
      discountCount: 0
    };

    const revenue = toNumber(row.price) * toNumber(row.quantity || 1);
    entry.orders += 1;
    entry.revenue += revenue;
    if (toNumber(row.discount) > 0) {
      entry.discountedRevenue += revenue;
      entry.discountCount += 1;
    }
    bySku.set(lookupKey, entry);
  });

  return Array.from(bySku.values())
    .filter((row) => row.orders >= 3)
    .map((row) => ({
      title: row.title,
      discountShare: safeDivide(row.discountedRevenue, row.revenue),
      discountedOrders: row.discountCount,
      orders: row.orders
    }))
    .sort((a, b) => b.discountShare - a.discountShare)
    .slice(0, 8);
}

function scoreConfidence(sampleSize) {
  if (!sampleSize) return 0.25;
  return clamp(sampleSize / 80, 0.35, 0.95);
}

function buildInsights({
  discountMetrics,
  repeatRate,
  customerCount,
  totalOrders,
  topDay,
  topHour,
  bundleTop,
  segment,
  productShiftInsights
}) {
  const insights = [];

  const DISCOUNT_REVENUE_SHARE_RISK = 0.35;
  const REPEAT_RATE_OPPORTUNITY = 0.25;
  const TIMING_MIN_ORDERS = 20;

  if (discountMetrics.discountRevenueShare > DISCOUNT_REVENUE_SHARE_RISK) {
    insights.push({
      id: 'discount-reliance',
      title: 'Discount-driven revenue is high',
      detail: `Discounted orders contribute ${(discountMetrics.discountRevenueShare * 100).toFixed(1)}% of revenue.`,
      impact: 'Margin risk',
      target: 'discountRefund',
      confidence: scoreConfidence(discountMetrics.discountedOrders)
    });
  }

  if (repeatRate != null && repeatRate < REPEAT_RATE_OPPORTUNITY) {
    insights.push({
      id: 'repeat-rate-opportunity',
      title: 'Repeat rate opportunity',
      detail: `Repeat customers represent ${(repeatRate * 100).toFixed(1)}% of buyers in this window.`,
      impact: 'Retention upside',
      target: 'cohorts',
      confidence: scoreConfidence(customerCount)
    });
  }

  if (topDay && topHour && (topDay.count || 0) >= TIMING_MIN_ORDERS) {
    insights.push({
      id: 'timing',
      title: `Peak demand hits on ${DAY_NAMES[topDay.day]}`,
      detail: `Most orders arrive around ${topHour.hour}:00 (${describeDaypart(topHour.hour)}).`,
      impact: 'Media timing',
      target: 'segments',
      confidence: scoreConfidence(topDay.count)
    });
  }

  const bundleConfidence = Number.isFinite(bundleTop?.statisticalConfidence) ? bundleTop.statisticalConfidence : 0;
  const bundleHasEvidence = Boolean(bundleTop && getBundleTier(bundleTop) === 'T1');

  if (bundleHasEvidence) {
    const narrative = buildBundleNarrative(bundleTop);
    insights.push({
      id: 'bundle',
      title: narrative?.title || 'Bundle opportunity spotted',
      detail: `${narrative?.businessSummary || 'A statistically reliable bundle signal was detected.'} Action: ${narrative?.recommendedAction || 'Test bundle placement.'} Signal: ${bundleTop.signal || 'Emerging'} (false-discovery risk ${formatPercentValue(bundleTop.falseDiscoveryRisk)}).`,
      impact: 'AOV lift',
      target: 'bundles',
      confidence: clamp(bundleConfidence, 0.35, 0.99),
      text: narrative?.businessSummary || null,
      methodology: narrative?.methodology || null,
      computationLogic: narrative?.computationLogic || null,
      recommendedAction: narrative?.recommendedAction || null,
      successKpi: narrative?.successKpi || null
    });
  }

  if (productShiftInsights?.length) {
    insights.push(...productShiftInsights);
  }

  if (segment?.label) {
    insights.push({
      id: 'segment',
      title: 'Meta segment worth scaling',
      detail: `${segment.label}${segment.revenue ? ` (${segment.revenue.toFixed(0)} revenue)` : ''}.`,
      impact: 'Targeting focus',
      target: 'metaDemographics',
      confidence: 0.7
    });
  }

  const priority = {
    'product-mover-up': 1.25,
    'product-mover-down': 1.1,
    bundle: 1.05,
    segment: 1.0,
    'discount-reliance': 0.95,
    'repeat-rate-opportunity': 0.9,
    timing: 0.55
  };

  return insights
    .map((insight) => {
      const conf = Number.isFinite(insight.confidence) ? insight.confidence : 0.5;
      const weight = priority[insight.id] ?? 0.75;
      return { ...insight, _score: weight * conf };
    })
    .sort((a, b) => (b._score || 0) - (a._score || 0))
    .slice(0, 6)
    .map(({ _score, ...insight }) => insight);
}

export async function getCustomerInsightsPayload(store, params = {}) {
  const db = getDb();
  const { startDate, endDate, days } = getDateRange(params);

  const orders = getOrderRows(db, store, startDate, endDate);
  let items = getOrderItems(db, store, startDate, endDate);

  const prevStartDate = shiftDate(startDate, -days);
  const prevEndDate = shiftDate(endDate, -days);
  let previousItems = store === 'shawq' ? getOrderItems(db, store, prevStartDate, prevEndDate) : [];

  // Prev-prev lookback for momentum engine (streak detection, growth history)
  const prevPrevStartDate = shiftDate(startDate, -days * 2);
  const prevPrevEndDate = shiftDate(endDate, -days * 2);
  let prevPrevItems = store === 'shawq' ? getOrderItems(db, store, prevPrevStartDate, prevPrevEndDate) : [];

  if (store === 'shawq' && (items.length || previousItems.length || prevPrevItems.length)) {
    const productIds = Array.from(new Set(
      items.concat(previousItems, prevPrevItems)
        .map((row) => row.product_id)
        .filter(Boolean)
        .map((id) => String(id))
    ));
    if (productIds.length) {
      await ensureShopifyProductsCached(store, productIds);
      items = getOrderItems(db, store, startDate, endDate);
      previousItems = getOrderItems(db, store, prevStartDate, prevEndDate);
      prevPrevItems = getOrderItems(db, store, prevPrevStartDate, prevPrevEndDate);
    }
  }

  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((sum, row) => sum + toNumber(row.order_total), 0);
  const avgOrderValue = safeDivide(totalRevenue, totalOrders);

  const discountMetrics = computeDiscountMetrics(orders);
  const customerStats = computeCustomerStats(orders);
  const metaSegment = getMetaTopSegment(db, store, startDate, endDate);
  const timing = getTopTiming(orders, store);
  const hasBundleStoreSufficiency = totalOrders >= BUNDLE_STORE_MIN_ELIGIBLE_ORDERS;
  const previousBundleLookup = hasBundleStoreSufficiency ? computeDirectionalBundleLookup(previousItems) : new Map();
  const bundles = hasBundleStoreSufficiency
    ? enrichBundlesWithPeriodComparison(computeBundles(items), previousBundleLookup)
    : [];
  const bundleKeyInsights = hasBundleStoreSufficiency
    ? buildBundleKeyInsights(bundles, Math.max(BUNDLE_INSIGHT_MAX_COUNT, bundles.length))
    : [];
  const repeatPaths = computeRepeatPaths(items);
  const topProducts = computeTopProducts(items);
  const discountSkus = computeDiscountSkus(items);
  // Build discount share lookup for momentum engine (current + previous period)
  const discountSkuMap = new Map();
  discountSkus.forEach((row) => {
    const productKey = row.title;
    if (productKey) discountSkuMap.set(productKey, row.discountShare || 0);
  });
  const prevDiscountSkus = computeDiscountSkus(previousItems);
  const prevDiscountSkuMap = new Map();
  prevDiscountSkus.forEach((row) => {
    const productKey = row.title;
    if (productKey) prevDiscountSkuMap.set(productKey, row.discountShare || 0);
  });

  // Momentum engine (replaces old computeProductShiftInsights)
  const momentumResult = computeProductMomentumEngine(items, previousItems, prevPrevItems, discountSkuMap, prevDiscountSkuMap);
  const productShiftInsights = momentumResult.insights;

  let ordersWithCountry = 0;
  const topCountry = orders.reduce((best, row) => {
    const rawCountry = row.country_code || row.country;
    if (isUnknownText(rawCountry)) return best;
    ordersWithCountry += 1;
    const code = String(rawCountry).trim();
    const entry = best.map.get(code) || { code, revenue: 0, orders: 0 };
    entry.revenue += toNumber(row.order_total);
    entry.orders += 1;
    best.map.set(code, entry);
    return best;
  }, { map: new Map() });

  const countryRows = Array.from(topCountry.map.values())
    .map((row) => ({
      code: row.code,
      name: getCountryInfo(row.code).name,
      revenue: row.revenue,
      orders: row.orders,
      aov: safeDivide(row.revenue, row.orders)
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const cityMap = new Map();
  let ordersWithCity = 0;
  orders.forEach((row) => {
    if (isUnknownText(row.city)) return;
    const key = String(row.city).trim();
    if (!key) return;
    ordersWithCity += 1;
    const entry = cityMap.get(key) || { city: key, revenue: 0, orders: 0 };
    entry.revenue += toNumber(row.order_total);
    entry.orders += 1;
    cityMap.set(key, entry);
  });

  const cityRows = Array.from(cityMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((row) => ({
      city: row.city,
      revenue: row.revenue,
      orders: row.orders,
      aov: safeDivide(row.revenue, row.orders)
    }));

  const minSegmentOrders = getMinSegmentOrders(totalOrders);

  const topCity = cityRows[0];
  const topCountryRow = countryRows[0];

  const reliableCity = cityRows.find((row) => row.orders >= minSegmentOrders) || null;
  const reliableCountry = countryRows.find((row) => row.orders >= minSegmentOrders) || null;

  const bestCustomerSegment = reliableCity
    ? { type: 'city', label: reliableCity.city, orders: reliableCity.orders, revenue: reliableCity.revenue, aov: reliableCity.aov }
    : (reliableCountry
      ? { type: 'country', label: reliableCountry.name, orders: reliableCountry.orders, revenue: reliableCountry.revenue, aov: reliableCountry.aov }
      : (topCountryRow ? { type: 'country', label: topCountryRow.name, orders: topCountryRow.orders, revenue: topCountryRow.revenue, aov: topCountryRow.aov } : null));

  const bestCustomerLabel = bestCustomerSegment?.label || null;
  const segmentOrders = bestCustomerSegment?.orders || 0;
  const segmentRevenue = bestCustomerSegment?.revenue || 0;

  const topDay = timing.topDay.count ? timing.topDay : null;
  const topHour = timing.topHour.count ? timing.topHour : null;

  const confidence = scoreConfidence(segmentOrders);
  const cityCoverage = safeDivide(ordersWithCity, totalOrders);
  const countryCoverage = safeDivide(ordersWithCountry, totalOrders);

  const hero = {
    title: bestCustomerLabel
      ? `${bestCustomerSegment?.type === 'city' ? 'Top city' : 'Top country'} by revenue: ${bestCustomerLabel}`
      : 'Customer insights are building',
    subtitle: topDay && topHour
      ? `Peak orders on ${DAY_NAMES[topDay.day]} ${describeDaypart(topHour.hour)}.`
      : `Window: ${startDate} → ${endDate}`,
    metricLabel: 'Revenue share',
    metricValue: segmentRevenue && totalRevenue ? safeDivide(segmentRevenue, totalRevenue) : 0,
    metricFormat: 'percent',
    confidence,
    sampleSize: segmentOrders || 0
  };

  const kpis = [
    bestCustomerLabel
      ? {
        id: 'best-segment',
        label: 'Top location',
        value: bestCustomerLabel,
        format: 'text',
        hint: `${bestCustomerSegment?.type === 'city' ? 'City' : 'Country'} with most revenue (min ${minSegmentOrders} orders)`
      }
      : null,
    { id: 'ltv90', label: '90-Day LTV', value: customerStats.avgLtv90 ?? avgOrderValue, format: 'currency' },
    customerStats.customerCount ? { id: 'repeat-rate', label: 'Repeat Rate', value: customerStats.repeatRate, format: 'percent' } : null,
    { id: 'discount-reliance', label: 'Discount Revenue Share', value: discountMetrics.discountRevenueShare, format: 'percent' },
    repeatPaths[0] ? { id: 'top-repeat', label: 'Top Repeat Path', value: `${repeatPaths[0].from} → ${repeatPaths[0].to}`, format: 'text' } : null,
    bundles[0] ? { id: 'top-bundle', label: 'Top Bundle', value: `${bundles[0].pair[0]} → ${bundles[0].pair[1]}`, format: 'text' } : null
  ].filter(Boolean);

  const insights = buildInsights({
    discountMetrics,
    repeatRate: customerStats.repeatRate,
    customerCount: customerStats.customerCount,
    totalOrders,
    topDay,
    topHour,
    bundleTop: bundles[0],
    segment: metaSegment,
    productShiftInsights
  });

  const windowLabel = params.startDate && params.endDate
    ? `${startDate} → ${endDate}`
    : `Last ${days} days`;

  return {
    updatedAt: new Date().toISOString(),
    window: {
      startDate,
      endDate,
      days,
      label: windowLabel
    },
    hero,
    kpis,
    insights,
    sections: {
      segments: {
        summary: bestCustomerLabel ? `Top customers: ${bestCustomerLabel}` : 'Segment rankings will appear once data flows in.',
        timing: {
          topDay: topDay ? DAY_NAMES[topDay.day] : null,
          topHour: topHour ? topHour.hour : null
        },
        geo: {
          minOrders: minSegmentOrders,
          cityCoverage,
          countryCoverage,
          cities: cityRows.map((row) => ({
            ...row,
            revenueShare: totalRevenue ? safeDivide(row.revenue, totalRevenue) : 0,
            orderShare: totalOrders ? safeDivide(row.orders, totalOrders) : 0
          })),
          countries: countryRows.map((row) => ({
            ...row,
            revenueShare: totalRevenue ? safeDivide(row.revenue, totalRevenue) : 0,
            orderShare: totalOrders ? safeDivide(row.orders, totalOrders) : 0
          }))
        }
      },
      topProducts: {
        summary: topProducts.length ? 'Top products by revenue and order count.' : 'Top products will appear once line-item data is synced.',
        products: topProducts
      },
      productMomentum: {
        summary: (momentumResult.momentum.length || momentumResult.watch.length)
          ? 'Product momentum and watch signals detected.'
          : 'Product momentum insights will appear after sufficient order history builds up.',
        momentum: momentumResult.momentum,
        watch: momentumResult.watch
      },
      cohorts: {
        summary: customerStats.customerCount
          ? `Tracking ${customerStats.customerCount} customers in this window.`
          : 'Customer-level data not available yet.',
        curve: [
          { horizon: '30d', value: customerStats.cohorts[0]?.ltv30 ?? avgOrderValue },
          { horizon: '60d', value: customerStats.cohorts[0]?.ltv60 ?? avgOrderValue },
          { horizon: '90d', value: customerStats.cohorts[0]?.ltv90 ?? avgOrderValue }
        ],
        cohorts: customerStats.cohorts
      },
      repeatPaths: {
        summary: repeatPaths.length ? 'Top next-purchase paths identified.' : 'Repeat paths need product-level data.',
        paths: repeatPaths
      },
      discountRefund: {
        summary: `Discounted orders represent ${(discountMetrics.discountRevenueShare * 100).toFixed(1)}% of revenue.`,
        metrics: {
          discountOrderRate: discountMetrics.discountOrderRate,
          discountRevenueShare: discountMetrics.discountRevenueShare,
          avgDiscountRate: discountMetrics.avgDiscountRate,
          avgDiscountedAov: discountMetrics.avgDiscountedAov,
          avgFullAov: discountMetrics.avgFullAov
        },
        discountSkus
      },
      bundles: {
        summary: !hasBundleStoreSufficiency
          ? `Bundle insights activate after ${formatCountValue(BUNDLE_STORE_MIN_ELIGIBLE_ORDERS)} eligible orders; current volume is ${formatCountValue(totalOrders)}.`
          : (bundles.length
            ? 'Bundle patterns ranked by confidence-weighted incremental revenue and statistical reliability.'
            : 'No bundle pairs reached minimum pair-order thresholds in this period.'),
        methodology: {
          baselineDefinition: 'Each row compares this period versus the immediately previous period of equal length. Baseline is attach-product order share across all orders in each period.',
          classification: 'Bundle type is Configured Bundle when Shopify product naming/SKU markers indicate an explicit offer; all other surfaced pairs are Organic Co-Purchase.',
          significance: 'Reliability is measured with an exact one-sided binomial test and Benjamini-Hochberg false-discovery control.',
          falseDiscoveryTarget: BUNDLE_FDR_TARGET,
          ranking: 'Pairs are ranked by non-negative expected incremental revenue weighted by statistical confidence; low-confidence rows below the ranking floor do not get ranking credit.',
          minStoreOrders: BUNDLE_STORE_MIN_ELIGIBLE_ORDERS,
          minPairOrdersDisplay: BUNDLE_MIN_PAIR_ORDERS_DISPLAY,
          tierThresholds: {
            t1: {
              minPairOrders: BUNDLE_T1_MIN_PAIR_ORDERS,
              minAnchorOrders: BUNDLE_T1_MIN_ANCHOR_ORDERS
            },
            t2: {
              minPairOrders: BUNDLE_T2_MIN_PAIR_ORDERS,
              minAnchorOrders: BUNDLE_T2_MIN_ANCHOR_ORDERS
            }
          },
          trendMinPreviousOrders: BUNDLE_TREND_MIN_PREVIOUS_ORDERS,
          rankConfidenceFloor: BUNDLE_RANK_CONFIDENCE_FLOOR
        },
        keyInsights: bundleKeyInsights,
        bundles
      },
      activation: {
        summary: metaSegment ? 'Audience actions ready for activation.' : 'Connect Meta breakdowns to enable activation.',
        readySegments: [
          metaSegment ? { label: metaSegment.label, size: metaSegment.conversions, type: 'Meta breakdown' } : null,
          bestCustomerSegment ? { label: `${bestCustomerSegment.label} buyers`, size: bestCustomerSegment.orders, type: 'Geo' } : null
        ].filter(Boolean)
      }
    },
    dataQuality: {
      orders: totalOrders,
      revenue: totalRevenue,
      customers: customerStats.customerCount,
      hasItems: items.length > 0,
      hasMetaBreakdowns: Boolean(metaSegment),
      notes: [
        totalOrders && cityCoverage < 0.8
          ? `City missing on ${Math.round((1 - cityCoverage) * 100)}% of orders; city insights may be noisy.`
          : null,
        totalOrders && countryCoverage < 0.95
          ? `Country missing on ${Math.round((1 - countryCoverage) * 100)}% of orders; country insights may be incomplete.`
          : null,
        customerStats.customerCount ? null : 'Customer IDs missing for full repeat analysis.',
        items.length ? null : 'Line items not yet synced for bundles and paths.',
        hasBundleStoreSufficiency
          ? null
          : `Bundle insights require at least ${formatCountValue(BUNDLE_STORE_MIN_ELIGIBLE_ORDERS)} eligible orders; currently ${formatCountValue(totalOrders)}.`,
        metaSegment ? null : 'Meta age/gender breakdowns not available.',
        timing.timeZone ? `Order timing shown in ${timing.timeZone}.` : null
      ].filter(Boolean)
    }
  };
}
