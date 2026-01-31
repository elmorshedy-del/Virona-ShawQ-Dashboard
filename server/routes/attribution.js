import express from 'express';
import { getDb } from '../db/database.js';
import { askOpenAIChat, streamOpenAIChat } from '../services/openaiService.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

const router = express.Router();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_RANGE_DAYS = 14;

// Attribution signals should not treat yesterday as "final" immediately.
// Meta reporting can lag after midnight; we consider a day finalized only after this grace period.
const FINALIZE_GRACE_MINUTES = Number.parseInt(process.env.ATTRIBUTION_FINALIZE_GRACE_MINUTES || '60', 10);

// Signal tuning (keep signals meaningful; avoid small-sample noise).
const SIGNAL_Z_THRESHOLD = 1.64; // ~90% confidence for two-proportion z-test
const COUNTRY_SIGNAL_MIN_ORDERS = 5;
const COUNTRY_SIGNAL_MIN_SHARE = 0.1;
const COUNTRY_WORST_MISSED_RATE_THRESHOLD = 0.15;

// Country signal thresholds (tuned for meaningful time + percent signals).
const COUNTRY_LOW_COVERAGE_THRESHOLD = 0.7;
const COUNTRY_HIGH_COVERAGE_THRESHOLD = 0.85;
const COUNTRY_SIGNAL_MIN_ACTIVE_DAYS = 4;
const COUNTRY_SIGNAL_MIN_LOW_DAYS = 4;
const COUNTRY_SIGNAL_MIN_HIGH_DAYS = 4;
const COUNTRY_SIGNAL_IMPROVE_DELTA = 0.1;
const COUNTRY_SIGNAL_WORSEN_DELTA = 0.1;

const GMT3_OFFSET_MS = 3 * 60 * 60 * 1000;

function resolveOrderSource(db, store) {
  const sources = [
    { table: 'shopify_orders', supportsAttribution: true },
    { table: 'salla_orders', supportsAttribution: false }
  ];

  for (const source of sources) {
    try {
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${source.table} WHERE store = ?`).get(store)?.count || 0;
      if (count > 0) return source;
    } catch (error) {
      // Ignore missing table or errors; try next source.
    }
  }

  return sources[0];
}

function parseDate(value) {
  if (!value || typeof value !== 'string') return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const date = parseDate(dateStr);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

function normalizeRange(start, end) {
  let startDate = parseDate(start);
  let endDate = parseDate(end);

  if (!startDate || !endDate) return null;
  if (startDate > endDate) {
    const tmp = startDate;
    startDate = endDate;
    endDate = tmp;
  }

  return {
    start: formatDate(startDate),
    end: formatDate(endDate)
  };
}

function enumerateDates(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return [];

  const dates = [];
  const cursor = new Date(startDate.getTime());

  while (cursor <= endDate) {
    dates.push(formatDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function getPeriodLabel(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return `${start} to ${end}`;

  const startMonth = MONTHS[startDate.getUTCMonth()];
  const endMonth = MONTHS[endDate.getUTCMonth()];
  const startDay = startDate.getUTCDate();
  const endDay = endDate.getUTCDate();
  const startYear = startDate.getUTCFullYear();
  const endYear = endDate.getUTCFullYear();

  if (startYear === endYear && startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}, ${startYear}`;
  }

  if (startYear === endYear) {
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${startYear}`;
  }

  return `${startMonth} ${startDay}, ${startYear} - ${endMonth} ${endDay}, ${endYear}`;
}

function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function minDateStr(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a < b ? a : b;
}

function maxDateStr(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

function clampDateStr(value, minValue, maxValue) {
  if (!value) return null;
  const lowerBound = minValue || null;
  const upperBound = maxValue || null;
  let result = value;
  if (lowerBound && result < lowerBound) result = lowerBound;
  if (upperBound && result > upperBound) result = upperBound;
  return result;
}

function getFinalizedEndDateStr(graceMinutes = FINALIZE_GRACE_MINUTES) {
  const minutes = Number.isFinite(graceMinutes) ? Math.max(0, graceMinutes) : 60;
  const gmt3Now = new Date(Date.now() + GMT3_OFFSET_MS);
  const minutesSinceMidnight = gmt3Now.getUTCHours() * 60 + gmt3Now.getUTCMinutes();

  // Before +grace minutes after midnight (GMT+3), treat "yesterday" as still settling.
  const daysBack = minutesSinceMidnight < minutes ? 2 : 1;
  return formatDateAsGmt3(new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000));
}

function buildOrderWhereClause(orderTable) {
  // For Shopify attribution comparisons, count paid orders only.
  if (orderTable === 'shopify_orders') {
    return ` AND (financial_status = 'paid' OR financial_status = 'partially_paid')`;
  }
  return '';
}

function coverageRateFromCounts(metaOrders, shopifyOrders) {
  if (!Number.isFinite(metaOrders) || !Number.isFinite(shopifyOrders) || shopifyOrders <= 0) return null;
  const covered = Math.min(shopifyOrders, Math.max(0, metaOrders));
  return safeDivide(covered, shopifyOrders);
}

// Meta rows can exist in two shapes depending on how insights were fetched:
// - country breakdown rows (country != 'ALL')
// - aggregate rows (country = 'ALL' or missing)
// We compute per-campaign totals without double-counting: if a campaign has country rows for a day,
// we ignore its ALL row for that day; otherwise we use its ALL row.
function buildMetaDailyTotals(db, { store, start, end }) {
  const rows = db.prepare(`
    SELECT
      date,
      SUM(CASE WHEN has_country = 1 THEN country_sum ELSE all_sum END) as orders
    FROM (
      SELECT
        date,
        campaign_id,
        MAX(CASE WHEN country IS NOT NULL AND country != '' AND country != 'ALL' THEN 1 ELSE 0 END) as has_country,
        SUM(CASE WHEN country IS NOT NULL AND country != '' AND country != 'ALL' THEN conversions ELSE 0 END) as country_sum,
        SUM(CASE WHEN country IS NULL OR country = '' OR country = 'ALL' THEN conversions ELSE 0 END) as all_sum
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY date, campaign_id
    )
    GROUP BY date
  `).all(store, start, end);

  return new Map(rows.map((row) => [row.date, row.orders || 0]));
}

function buildMetaDailyByCountry(db, { store, start, end }) {
  const rows = db.prepare(`
    SELECT date, country as country_code, SUM(conversions) as orders
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ? AND country IS NOT NULL AND country != '' AND country != 'ALL'
    GROUP BY date, country
  `).all(store, start, end);

  const map = new Map();
  rows.forEach((row) => {
    if (!row.country_code) return;
    map.set(`${row.date}|${row.country_code}`, row.orders || 0);
  });
  return map;
}

function buildWindowStats(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.shopifyOrders += row.shopifyOrders || 0;
      acc.metaOrders += row.metaOrders || 0;
      acc.unattributed += row.unattributed || 0;
      if ((row.shopifyOrders || 0) > 0 && (row.metaOrders || 0) === 0) acc.zeroMetaDays += 1;
      return acc;
    },
    { shopifyOrders: 0, metaOrders: 0, unattributed: 0, zeroMetaDays: 0 }
  );

  const missedRate = totals.shopifyOrders >= 3 ? safeDivide(totals.unattributed, totals.shopifyOrders) : null;
  const coverageRate = totals.shopifyOrders > 0 ? safeDivide(totals.shopifyOrders - totals.unattributed, totals.shopifyOrders) : null;

  return {
    ...totals,
    missedRate,
    coverageRate
  };
}

function parseAttribution(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

const countryDisplay = typeof Intl !== 'undefined' && Intl.DisplayNames
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

function getCountryLabel(code) {
  if (!code || code === 'UN') return 'Unknown';
  if (!countryDisplay) return code;
  try {
    return countryDisplay.of(code) || code;
  } catch (error) {
    return code;
  }
}

function twoProportionZScore(successA, totalA, successB, totalB) {
  if (!Number.isFinite(successA) || !Number.isFinite(totalA) || totalA <= 0) return null;
  if (!Number.isFinite(successB) || !Number.isFinite(totalB) || totalB <= 0) return null;

  const pA = successA / totalA;
  const pB = successB / totalB;
  const pooled = (successA + successB) / (totalA + totalB);

  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  if (!Number.isFinite(se) || se === 0) return null;

  return (pA - pB) / se;
}

function parseConsentStatus(value) {
  if (value == null) return 'unknown';
  const normalized = String(value).trim().toLowerCase();
  if (['denied', 'false', '0', 'no', 'blocked'].includes(normalized)) return 'denied';
  if (['granted', 'true', '1', 'yes', 'allowed'].includes(normalized)) return 'granted';
  return 'unknown';
}

function parseFbcTimestamp(fbc) {
  if (!fbc) return null;
  const parts = String(fbc).split('.');
  if (parts.length < 3) return null;
  const timestamp = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(timestamp)) return null;
  return timestamp * 1000;
}

function pickAttr(attrs, base, suffix) {
  if (!attrs) return null;
  return attrs[`${base}_${suffix}`] || attrs[base] || null;
}

function buildTouchLabel(attrs, suffix) {
  const source = pickAttr(attrs, 'utm_source', suffix);
  const medium = pickAttr(attrs, 'utm_medium', suffix);
  const campaign = pickAttr(attrs, 'utm_campaign', suffix);
  const referrer = pickAttr(attrs, 'referrer', suffix);
  const landing = pickAttr(attrs, 'landing_page', suffix);

  const parts = [];
  if (source) parts.push(source);
  if (medium) parts.push(medium);
  if (campaign) parts.push(campaign);

  if (parts.length) return parts.join(' / ');
  if (referrer) return referrer;
  if (landing) return landing;
  return 'Direct / Unknown';
}

function getMetaIdStatus(attrs) {
  const fbp = attrs.fbp || null;
  const fbc = attrs.fbc || attrs.fbc_last || attrs.fbc_first || null;
  const fbclid = attrs.fbclid || attrs.fbclid_last || attrs.fbclid_first || null;

  return {
    fbp,
    fbc,
    fbclid,
    hasMetaIds: Boolean(fbp || fbc || fbclid)
  };
}

function buildOrderReason({ attrs, orderDate, metaForDate, metaForDateCountry, hasCountryBreakdown }) {
  const consentStatus = parseConsentStatus(attrs.consent);
  const metaIds = getMetaIdStatus(attrs);
  const fbcTimestamp = parseFbcTimestamp(metaIds.fbc);
  const orderTime = parseDate(orderDate)?.getTime() || null;
  const daysSinceClick = fbcTimestamp && orderTime ? (orderTime - fbcTimestamp) / (1000 * 60 * 60 * 24) : null;

  if (consentStatus === 'denied') {
    return {
      code: 'consent_denied',
      reason: 'Tracking consent was declined at checkout.',
      fix: 'Review consent banner timing and wording to reduce opt-outs.',
      priority: 1
    };
  }

  if (!metaIds.hasMetaIds) {
    return {
      code: 'missing_meta_ids',
      reason: 'No Meta identifiers (fbp/fbc/fbclid) were captured.',
      fix: 'Ensure the pixel loads before checkout and ad links include fbclid.',
      priority: 2
    };
  }

  if (Number.isFinite(daysSinceClick) && daysSinceClick > 7) {
    return {
      code: 'window_expired',
      reason: 'Click timestamp falls outside the typical attribution window.',
      fix: 'Shorten conversion paths or use retargeting to capture late purchases.',
      priority: 3
    };
  }

  if (!metaForDate) {
    return {
      code: 'meta_zero',
      reason: 'Meta reported zero conversions for this day.',
      fix: 'Check pixel/CAPI delivery health and token status.',
      priority: 4
    };
  }

  if (hasCountryBreakdown && !metaForDateCountry && metaForDate) {
    return {
      code: 'meta_zero_country',
      reason: 'Meta reported zero conversions for this country on that day.',
      fix: 'Validate country targeting and currency/locale tracking consistency.',
      priority: 5
    };
  }

  return {
    code: 'unknown',
    reason: 'Not enough attribution data to explain this miss.',
    fix: 'Verify pixel/CAPI events and make sure IDs are passed to orders.',
    priority: 6
  };
}

function buildAlerts({
  current7,
  previous7,
  missingIdRate7,
  prevMissingIdRate7,
  consentRate7,
  prevConsentRate7,
  constantlyLowCountries,
  improvingCountries,
  worseningCountries,
  worstCountry,
  worstCountryDiagnostics,
  periodLabel
}) {
  const alerts = [];

  const hasCurrent = current7?.shopifyOrders >= 3 && current7?.missedRate != null;
  const hasPrevious = previous7?.shopifyOrders >= 3 && previous7?.missedRate != null;

  // Country-level callout: highlight the lowest coverage market (ex: France).
  const worstCountryGap = hasCurrent && worstCountry?.missedRate != null
    ? worstCountry.missedRate - current7.missedRate
    : null;

  const worstCountryShare = hasCurrent && worstCountry?.shopifyOrders
    ? safeDivide(worstCountry.shopifyOrders, current7?.shopifyOrders || 0)
    : null;
  const worstCountryEnoughOrders = worstCountry?.shopifyOrders >= 3 || (worstCountryShare != null && worstCountryShare >= COUNTRY_SIGNAL_MIN_SHARE);

  const shouldCalloutWorstCountry = hasCurrent && worstCountry?.missedRate != null && worstCountryEnoughOrders && (
    worstCountry.missedRate >= COUNTRY_WORST_MISSED_RATE_THRESHOLD
    || (worstCountryGap != null && worstCountryGap >= 0.1 && worstCountry.missedRate >= 0.08)
  );

  if (shouldCalloutWorstCountry) {
    const countryLabel = getCountryLabel(worstCountry.countryCode);
    const coverageRate = worstCountry.coverageRate != null ? worstCountry.coverageRate : (1 - worstCountry.missedRate);
    const coveragePct = coverageRate != null ? Math.round(coverageRate * 100) : null;
    const missedPct = Math.round(worstCountry.missedRate * 100);

    const drivers = [];
    if (worstCountryDiagnostics?.missingIdRate != null) {
      drivers.push(`${Math.round(worstCountryDiagnostics.missingIdRate * 100)}% missing Meta IDs`);
    }
    if (worstCountryDiagnostics?.consentRate != null) {
      drivers.push(`${Math.round(worstCountryDiagnostics.consentRate * 100)}% consent denied`);
    }

    const severity = worstCountry.missedRate >= 0.3 || (worstCountryGap != null && worstCountryGap >= 0.15)
      ? 'high'
      : (worstCountry.missedRate >= 0.2 ? 'medium' : 'low');

    alerts.push({
      id: 'worst_country_coverage',
      title: `Lowest country coverage: ${countryLabel}`,
      message: `${countryLabel} has the lowest coverage in the last 7 days: ${coveragePct == null ? '-' : `${coveragePct}%`} (${worstCountry.metaOrders}/${worstCountry.shopifyOrders}). Missed ${worstCountry.missed} orders (${missedPct}%).${worstCountryGap != null && worstCountryGap >= 0.1 ? ` That is ${Math.round(worstCountryGap * 100)}% worse than overall.` : ''}${drivers.length ? ` Drivers: ${drivers.join(', ')}.` : ''}`,
      fix: 'Start with Meta IDs (fbp/fbc/fbclid) capture + consent, then verify Pixel/CAPI delivery and domain verification for that market.',
      severity
    });
  }

  if (hasCurrent && current7.missedRate >= 0.3) {
    alerts.push({
      id: 'high_missed_rate',
      title: 'High missed attribution rate',
      message: `Missed attribution is ${Math.round(current7.missedRate * 100)}% in the last 7 days (${current7.unattributed}/${current7.shopifyOrders} orders).`,
      fix: 'Audit Pixel + CAPI delivery, consent rates, and ensure Meta IDs (fbp/fbc/fbclid) are captured.',
      severity: 'high'
    });
  }

  if (hasCurrent && hasPrevious) {
    const rateDelta = previous7.missedRate - current7.missedRate; // positive = improved
    const missedDelta = previous7.unattributed - current7.unattributed;
    const relative = previous7.missedRate > 0 ? rateDelta / previous7.missedRate : null;

    const improvementZ = twoProportionZScore(
      previous7.unattributed,
      previous7.shopifyOrders,
      current7.unattributed,
      current7.shopifyOrders
    );

    const meaningfulRateMove = rateDelta >= 0.05 && relative != null && relative >= 0.3;
    const meaningfulCountMove = missedDelta >= 2;
    const statisticallyMeaningful = improvementZ != null && improvementZ >= SIGNAL_Z_THRESHOLD;

    if (meaningfulRateMove && meaningfulCountMove && statisticallyMeaningful) {
      alerts.push({
        id: 'missed_rate_improved',
        title: 'Attribution improved',
        message: `Missed attribution dropped from ${Math.round(previous7.missedRate * 100)}% to ${Math.round(current7.missedRate * 100)}% (last 7d vs prior 7d).`,
        fix: 'Keep monitoring tracking stability and replicate what changed (consent, pixel, CAPI, checkout).',
        severity: 'medium'
      });
    }

    const worsenDelta = current7.missedRate - previous7.missedRate;
    const worsenRel = previous7.missedRate > 0 ? worsenDelta / previous7.missedRate : null;

    const worseningZ = twoProportionZScore(
      current7.unattributed,
      current7.shopifyOrders,
      previous7.unattributed,
      previous7.shopifyOrders
    );

    const worsenRateMove = worsenDelta >= 0.05 && (worsenRel == null ? current7.missedRate >= 0.15 : worsenRel >= 0.3);
    const worsenCountMove = (current7.unattributed - previous7.unattributed) >= 2;
    const statisticallyMeaningfulWorsen = worseningZ != null && worseningZ >= SIGNAL_Z_THRESHOLD;

    if (worsenRateMove && worsenCountMove && statisticallyMeaningfulWorsen) {
      alerts.push({
        id: 'missed_rate_worsened',
        title: 'Attribution worsened',
        message: `Missed attribution rose from ${Math.round(previous7.missedRate * 100)}% to ${Math.round(current7.missedRate * 100)}% (last 7d vs prior 7d).`,
        fix: 'Investigate recent changes: pixel/CAPI outages, consent banner changes, checkout scripts, or domain issues.',
        severity: 'high'
      });
    }
  }

  if (missingIdRate7 != null && prevMissingIdRate7 != null && missingIdRate7 - prevMissingIdRate7 >= 0.1 && missingIdRate7 >= 0.15) {
    alerts.push({
      id: 'missing_ids_spike',
      title: 'Missing Meta IDs spiked',
      message: `Orders missing Meta IDs rose to ${Math.round(missingIdRate7 * 100)}% in the last 7 days vs ${Math.round(prevMissingIdRate7 * 100)}% in the prior 7 days.`,
      fix: 'Confirm pixel fires on every product and checkout page.',
      severity: 'high'
    });
  }

  if (consentRate7 != null && prevConsentRate7 != null && consentRate7 - prevConsentRate7 >= 0.08 && consentRate7 >= 0.12) {
    alerts.push({
      id: 'consent_decline',
      title: 'Consent declines increased',
      message: `Consent declines hit ${Math.round(consentRate7 * 100)}% in the last 7 days vs ${Math.round(prevConsentRate7 * 100)}% in the prior 7 days.`,
      fix: 'Review consent banner placement and reduce friction at checkout.',
      severity: 'medium'
    });
  }

  if (current7?.zeroMetaDays >= 2) {
    alerts.push({
      id: 'meta_zero_days',
      title: 'Meta reported zero orders on multiple days',
      message: `Meta reported zero orders on ${current7.zeroMetaDays} of 7 days in ${periodLabel}.`,
      fix: 'Audit pixel/CAPI health and confirm tokens are active.',
      severity: 'high'
    });
  }

  if (Array.isArray(constantlyLowCountries) && constantlyLowCountries.length) {
    const list = constantlyLowCountries
      .slice(0, 3)
      .map((row) => `${row.countryCode} ${Math.round(row.coverageRate * 100)}%`)
      .join(', ');
    const worst = constantlyLowCountries[0];
    const severity = worst && worst.coverageRate <= 0.6 ? 'high' : 'medium';
    alerts.push({
      id: 'countries_constantly_low',
      title: 'Countries with consistently low coverage',
      message: `${list} coverage in the last 7 days. These markets are persistently below ${Math.round(COUNTRY_LOW_COVERAGE_THRESHOLD * 100)}%.`,
      fix: 'Prioritize these markets: verify localized checkout scripts, consent, pixel + CAPI match quality, and domain verification.',
      severity
    });
  }

  if (Array.isArray(improvingCountries) && improvingCountries.length) {
    const list = improvingCountries
      .slice(0, 3)
      .map((row) => `${row.countryCode} +${Math.round(row.delta * 100)}%`)
      .join(', ');
    alerts.push({
      id: 'countries_improving',
      title: 'Countries improving from low coverage',
      message: `${list} improved coverage vs the prior 7 days after being consistently low.`,
      fix: 'Keep the changes that improved coverage (consent, pixel, CAPI) and monitor stability.',
      severity: 'medium'
    });
  }

  if (Array.isArray(worseningCountries) && worseningCountries.length) {
    const list = worseningCountries
      .slice(0, 3)
      .map((row) => `${row.countryCode} -${Math.round(Math.abs(row.delta) * 100)}%`)
      .join(', ');
    alerts.push({
      id: 'countries_worsening',
      title: 'Countries falling back',
      message: `${list} dropped from previously strong coverage in the last 7 days.`,
      fix: 'Investigate market-specific changes: consent rates, pixel/CAPI outages, localized checkout scripts, or domain/currency issues.',
      severity: 'high'
    });
  }

  return alerts;
}router.get('/summary', (req, res) => {
  try {
    const store = (req.query.store || 'shawq').toString();
    const startParam = req.query.start;
    const endParam = req.query.end;

    const requestedRange = startParam && endParam
      ? normalizeRange(startParam, endParam)
      : normalizeRange(addDays(formatDateAsGmt3(new Date()), -(DEFAULT_RANGE_DAYS - 1)), formatDateAsGmt3(new Date()));

    if (!requestedRange) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid start and end date for attribution reporting.'
      });
    }

    const db = getDb();

    const orderSource = resolveOrderSource(db, store);
    const orderTable = orderSource.table;
    const attributionDataAvailable = orderSource.supportsAttribution;
    const orderWhere = buildOrderWhereClause(orderTable);

    const metaMinDate = db.prepare(`
      SELECT MIN(date) as date
      FROM meta_daily_metrics
      WHERE store = ?
    `).get(store)?.date || null;

    const ordersMinDate = db.prepare(`
      SELECT MIN(date) as date
      FROM ${orderTable}
      WHERE store = ?${orderWhere}
    `).get(store)?.date || null;

    // Start at the first day where both sources exist to avoid misleading 100%/0% periods.
    const dataStart = metaMinDate && ordersMinDate
      ? maxDateStr(metaMinDate, ordersMinDate)
      : (metaMinDate || ordersMinDate);

    const range = dataStart && requestedRange.start < dataStart
      ? { ...requestedRange, start: dataStart }
      : requestedRange;

    const compareRange = req.query.compareStart && req.query.compareEnd
      ? normalizeRange(req.query.compareStart, req.query.compareEnd)
      : (() => {
        const days = enumerateDates(range.start, range.end).length;
        const compareEnd = addDays(range.start, -1);
        const compareStart = addDays(range.start, -days);
        return normalizeRange(compareStart, compareEnd);
      })();

    if (!compareRange) {
      return res.status(400).json({
        success: false,
        error: 'Comparison range could not be calculated. Please adjust the dates and try again.'
      });
    }

    const rangeMin = minDateStr(range.start, compareRange.start);
    const rangeMax = maxDateStr(range.end, compareRange.end);

    const hasCountryRows = db.prepare(`
      SELECT COUNT(*) as count
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ?
        AND country IS NOT NULL AND country != '' AND country != 'ALL'
    `).get(store, rangeMin, rangeMax)?.count > 0;

    const shopifyDaily = db.prepare(`
      SELECT date, COUNT(*) as orders
      FROM ${orderTable}
      WHERE store = ? AND date BETWEEN ? AND ?
      ${orderWhere}
      GROUP BY date
    `).all(store, range.start, range.end);

    const shopifyDailyCompare = db.prepare(`
      SELECT date, COUNT(*) as orders
      FROM ${orderTable}
      WHERE store = ? AND date BETWEEN ? AND ?
      ${orderWhere}
      GROUP BY date
    `).all(store, compareRange.start, compareRange.end);

    const shopifyByDate = new Map(shopifyDaily.map((row) => [row.date, row.orders || 0]));
    const compareShopifyByDate = new Map(shopifyDailyCompare.map((row) => [row.date, row.orders || 0]));

    const metaByDate = buildMetaDailyTotals(db, { store, start: range.start, end: range.end });
    const compareMetaByDate = buildMetaDailyTotals(db, { store, start: compareRange.start, end: compareRange.end });

    const series = enumerateDates(range.start, range.end).map((date) => {
      const shopifyOrders = shopifyByDate.get(date) || 0;
      const metaOrders = metaByDate.get(date) || 0;
      const unattributed = Math.max(0, shopifyOrders - metaOrders);
      const coverageRate = coverageRateFromCounts(metaOrders, shopifyOrders);

      return {
        date,
        shopifyOrders,
        metaOrders,
        unattributed,
        coverageRate
      };
    });

    const compareSeries = enumerateDates(compareRange.start, compareRange.end).map((date) => {
      const shopifyOrders = compareShopifyByDate.get(date) || 0;
      const metaOrders = compareMetaByDate.get(date) || 0;
      const unattributed = Math.max(0, shopifyOrders - metaOrders);
      const coverageRate = coverageRateFromCounts(metaOrders, shopifyOrders);

      return {
        date,
        shopifyOrders,
        metaOrders,
        unattributed,
        coverageRate
      };
    });

    const totals = series.reduce(
      (acc, row) => {
        acc.shopifyOrders += row.shopifyOrders;
        acc.metaOrders += row.metaOrders;
        acc.unattributed += row.unattributed;
        return acc;
      },
      { shopifyOrders: 0, metaOrders: 0, unattributed: 0 }
    );

    const compareTotals = compareSeries.reduce(
      (acc, row) => {
        acc.shopifyOrders += row.shopifyOrders;
        acc.metaOrders += row.metaOrders;
        acc.unattributed += row.unattributed;
        return acc;
      },
      { shopifyOrders: 0, metaOrders: 0, unattributed: 0 }
    );

    const currentCoverageRate = coverageRateFromCounts(totals.metaOrders, totals.shopifyOrders);
    const previousCoverageRate = coverageRateFromCounts(compareTotals.metaOrders, compareTotals.shopifyOrders);

    const shopifyByCountry = db.prepare(`
      SELECT COALESCE(NULLIF(country_code, ''), 'UN') as country_code, COUNT(*) as orders
      FROM ${orderTable}
      WHERE store = ? AND date BETWEEN ? AND ?
      ${orderWhere}
      GROUP BY COALESCE(NULLIF(country_code, ''), 'UN')
    `).all(store, range.start, range.end);

    const metaByCountry = hasCountryRows
      ? db.prepare(`
          SELECT country as country_code, SUM(conversions) as orders
          FROM meta_daily_metrics
          WHERE store = ? AND date BETWEEN ? AND ?
            AND country IS NOT NULL AND country != '' AND country != 'ALL'
          GROUP BY country
        `).all(store, range.start, range.end)
      : [];

    const metaCountryMap = new Map(
      metaByCountry
        .filter((row) => row.country_code)
        .map((row) => [row.country_code, row.orders || 0])
    );

    const countryGaps = hasCountryRows
      ? shopifyByCountry
        .map((row) => {
          const metaOrders = metaCountryMap.get(row.country_code) || 0;
          const shopifyOrders = row.orders || 0;
          const gap = Math.max(0, shopifyOrders - metaOrders);
          return {
            countryCode: row.country_code,
            shopifyOrders,
            metaOrders,
            gap,
            missedRate: shopifyOrders >= 3 ? safeDivide(gap, shopifyOrders) : null,
            coverageRate: coverageRateFromCounts(metaOrders, shopifyOrders)
          };
        })
        .filter((row) => (row.shopifyOrders || 0) >= 1)
        .sort((a, b) => {
          const aRate = a.missedRate ?? -1;
          const bRate = b.missedRate ?? -1;
          if (bRate != aRate) return bRate - aRate;
          return (b.shopifyOrders || 0) - (a.shopifyOrders || 0);
        })
      : [];

    const metaByDateCountryMap = hasCountryRows
      ? buildMetaDailyByCountry(db, { store, start: range.start, end: range.end })
      : new Map();

    const shopifyDailyByCountry = hasCountryRows
      ? db.prepare(`
          SELECT date, COALESCE(NULLIF(country_code, ''), 'UN') as country_code, COUNT(*) as orders
          FROM ${orderTable}
          WHERE store = ? AND date BETWEEN ? AND ?
          ${orderWhere}
          GROUP BY date, COALESCE(NULLIF(country_code, ''), 'UN')
        `).all(store, range.start, range.end)
      : [];

    const gapByBucket = new Map();
    if (hasCountryRows) {
      shopifyDailyByCountry.forEach((row) => {
        const countryCode = row.country_code || 'UN';
        const key = `${row.date}|${countryCode}`;
        const shopifyOrdersForBucket = row.orders || 0;
        const metaOrdersForBucket = metaByDateCountryMap.get(key) || 0;
        gapByBucket.set(key, Math.max(0, shopifyOrdersForBucket - metaOrdersForBucket));
      });
    } else {
      series.forEach((row) => {
        gapByBucket.set(row.date, row.unattributed || 0);
      });
    }

    const ordersRaw = attributionDataAvailable
      ? db.prepare(`
          SELECT order_id, date, country, country_code, order_total, attribution_json
          FROM ${orderTable}
          WHERE store = ? AND date BETWEEN ? AND ?
          ${orderWhere}
          ORDER BY date DESC
        `).all(store, range.start, range.end)
      : [];

    let missingIdsCount = 0;
    let consentDeniedCount = 0;

    // Build a constrained "unattributed orders" list:
    // show no more rows than the computed gap per date/country bucket.
    const bucketOrders = new Map();

    ordersRaw.forEach((order) => {
      const attrs = parseAttribution(order.attribution_json);
      const metaIds = getMetaIdStatus(attrs);
      if (!metaIds.hasMetaIds) missingIdsCount += 1;
      if (parseConsentStatus(attrs.consent) === 'denied') consentDeniedCount += 1;

      const countryCode = order.country_code || 'UN';
      const bucketKey = hasCountryRows ? `${order.date}|${countryCode}` : order.date;
      const gapForBucket = gapByBucket.get(bucketKey) || 0;
      if (!gapForBucket) return;

      const metaForDate = metaByDate.get(order.date) || 0;
      const metaForDateCountry = hasCountryRows ? (metaByDateCountryMap.get(`${order.date}|${countryCode}`) || 0) : 0;
      const reason = buildOrderReason({
        attrs,
        orderDate: order.date,
        metaForDate,
        metaForDateCountry,
        hasCountryBreakdown: hasCountryRows
      });

      const entry = {
        orderId: order.order_id,
        date: order.date,
        country: order.country,
        countryCode,
        orderTotal: order.order_total,
        reason: reason.reason,
        fix: reason.fix,
        priority: reason.priority,
        firstTouch: buildTouchLabel(attrs, 'first'),
        lastTouch: buildTouchLabel(attrs, 'last')
      };

      const list = bucketOrders.get(bucketKey) || [];
      list.push(entry);
      bucketOrders.set(bucketKey, list);
    });

    const unattributedOrders = [];
    bucketOrders.forEach((orders, bucketKey) => {
      const gap = gapByBucket.get(bucketKey) || 0;
      if (!gap) return;

      const sorted = [...orders].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const dateCompare = String(b.date).localeCompare(String(a.date));
        if (dateCompare !== 0) return dateCompare;
        return String(a.orderId).localeCompare(String(b.orderId));
      });

      unattributedOrders.push(...sorted.slice(0, gap));
    });

    const limitedUnattributed = unattributedOrders
      .sort((a, b) => {
        const dateCompare = String(b.date).localeCompare(String(a.date));
        if (dateCompare !== 0) return dateCompare;
        return String(a.orderId).localeCompare(String(b.orderId));
      })
      .slice(0, 50)
      .map(({ priority, ...rest }) => rest);

    const missingIdRate = attributionDataAvailable && totals.shopifyOrders
      ? missingIdsCount / totals.shopifyOrders
      : null;

    const consentRate = attributionDataAvailable && totals.shopifyOrders
      ? consentDeniedCount / totals.shopifyOrders
      : null;

    // Signals: use finalized days only.
    const finalizedEndDate = clampDateStr(range.end, null, getFinalizedEndDateStr());
    const finalizedSeries = finalizedEndDate
      ? series.filter((row) => row.date <= finalizedEndDate)
      : [];

    const last7 = finalizedSeries.slice(-7);
    const current7 = last7.length === 7 ? buildWindowStats(last7) : null;
    const current7Start = current7 ? last7[0]?.date : null;

    const prevWindowEnd = current7Start ? addDays(current7Start, -1) : null;
    const prevWindowStart = prevWindowEnd ? addDays(prevWindowEnd, -6) : null;

    const previousRows = finalizedSeries.length >= 14
      ? finalizedSeries.slice(-14, -7)
      : (compareSeries.length === 7 ? compareSeries : []);

    const previous7 = previousRows.length === 7 ? buildWindowStats(previousRows) : null;

    const computeOrderDiagnostics = (windowStart, windowEnd) => {
      if (!attributionDataAvailable || !windowStart || !windowEnd) {
        return {
          orders: 0,
          missingIds: 0,
          consentDenied: 0,
          missingIdRate: null,
          consentRate: null
        };
      }

      const rows = db.prepare(`
        SELECT attribution_json
        FROM ${orderTable}
        WHERE store = ? AND date BETWEEN ? AND ?
        ${orderWhere}
      `).all(store, windowStart, windowEnd);

      let missingIds = 0;
      let consentDenied = 0;

      rows.forEach((row) => {
        const attrs = parseAttribution(row.attribution_json);
        const metaIds = getMetaIdStatus(attrs);
        if (!metaIds.hasMetaIds) missingIds += 1;
        if (parseConsentStatus(attrs.consent) === 'denied') consentDenied += 1;
      });

      const orders = rows.length;
      return {
        orders,
        missingIds,
        consentDenied,
        missingIdRate: orders >= 3 ? safeDivide(missingIds, orders) : null,
        consentRate: orders >= 3 ? safeDivide(consentDenied, orders) : null
      };
    };

    const currentDiag = computeOrderDiagnostics(current7Start, finalizedEndDate);
    const previousDiag = computeOrderDiagnostics(prevWindowStart, prevWindowEnd);

    const missingIdRate7 = currentDiag.missingIdRate;
    const prevMissingIdRate7 = previousDiag.missingIdRate;
    const consentRate7 = currentDiag.consentRate;
    const prevConsentRate7 = previousDiag.consentRate;


    const constantlyLowCountries = [];
    const improvingCountries = [];
    const worseningCountries = [];
    let worstCountry = null;
    let worstCountryDiagnostics = null;

    let currCountryShopify = [];
    let currMetaMap = new Map();

    if (hasCountryRows && current7Start && finalizedEndDate) {
      currCountryShopify = db.prepare(`
        SELECT COALESCE(NULLIF(country_code, ''), 'UN') as country_code, COUNT(*) as orders
        FROM ${orderTable}
        WHERE store = ? AND date BETWEEN ? AND ?
        ${orderWhere}
        GROUP BY COALESCE(NULLIF(country_code, ''), 'UN')
      `).all(store, current7Start, finalizedEndDate);

      const currCountryMeta = db.prepare(`
        SELECT country as country_code, SUM(conversions) as orders
        FROM meta_daily_metrics
        WHERE store = ? AND date BETWEEN ? AND ?
          AND country IS NOT NULL AND country != '' AND country != 'ALL'
        GROUP BY country
      `).all(store, current7Start, finalizedEndDate);

      const toMap = (rows) => new Map(rows.filter((r) => r.country_code).map((r) => [r.country_code, r.orders || 0]));
      currMetaMap = toMap(currCountryMeta);

      const countryStats = currCountryShopify
        .map((row) => {
          const code = row.country_code;
          const shopifyOrders = row.orders || 0;
          const metaOrders = currMetaMap.get(code) || 0;
          const missed = Math.max(0, shopifyOrders - metaOrders);
          const missedRate = shopifyOrders > 0 ? safeDivide(missed, shopifyOrders) : null;
          const coverageRate = coverageRateFromCounts(metaOrders, shopifyOrders);
          return {
            countryCode: code,
            shopifyOrders,
            metaOrders,
            missed,
            missedRate,
            coverageRate
          };
        })
        .filter((row) => row.missedRate != null)
        .sort((a, b) => (b.missedRate ?? -1) - (a.missedRate ?? -1));

      worstCountry = countryStats[0] || null;

      const computeCountryOrderDiagnostics = (countryCode, windowStart, windowEnd) => {
        if (!attributionDataAvailable || !countryCode || !windowStart || !windowEnd) return null;

        const rows = db.prepare(`
          SELECT attribution_json
          FROM ${orderTable}
          WHERE store = ? AND date BETWEEN ? AND ?
            AND COALESCE(NULLIF(country_code, ''), 'UN') = ?
          ${orderWhere}
        `).all(store, windowStart, windowEnd, countryCode);

        let missingIds = 0;
        let consentDenied = 0;

        rows.forEach((row) => {
          const attrs = parseAttribution(row.attribution_json);
          const metaIds = getMetaIdStatus(attrs);
          if (!metaIds.hasMetaIds) missingIds += 1;
          if (parseConsentStatus(attrs.consent) === 'denied') consentDenied += 1;
        });

        const orders = rows.length;
        return {
          orders,
          missingIdRate: orders >= 3 ? safeDivide(missingIds, orders) : null,
          consentRate: orders >= 3 ? safeDivide(consentDenied, orders) : null
        };
      };

      if (worstCountry) {
        worstCountryDiagnostics = computeCountryOrderDiagnostics(worstCountry.countryCode, current7Start, finalizedEndDate);
      }
    }

    if (hasCountryRows && current7Start && finalizedEndDate) {
      const signalStart = prevWindowStart || current7Start;
      const signalEnd = finalizedEndDate;

      const countryDailyRows = db.prepare(`
        SELECT date, COALESCE(NULLIF(country_code, ''), 'UN') as country_code, COUNT(*) as orders
        FROM ${orderTable}
        WHERE store = ? AND date BETWEEN ? AND ?
        ${orderWhere}
        GROUP BY date, COALESCE(NULLIF(country_code, ''), 'UN')
      `).all(store, signalStart, signalEnd);

      const countryMetaDailyMap = buildMetaDailyByCountry(db, { store, start: signalStart, end: signalEnd });

      const buildCountryWindowStats = (rows, metaMap, windowStart, windowEnd) => {
        const stats = new Map();
        rows.forEach((row) => {
          if (!row.date || row.date < windowStart || row.date > windowEnd) return;
          const countryCode = row.country_code || 'UN';
          const shopifyOrders = row.orders || 0;
          const metaOrders = metaMap.get(`${row.date}|${countryCode}`) || 0;
          const covered = Math.min(shopifyOrders, Math.max(0, metaOrders));

          if (!stats.has(countryCode)) {
            stats.set(countryCode, {
              countryCode,
              totalShopify: 0,
              totalMeta: 0,
              covered: 0,
              daysWithOrders: 0,
              lowDays: 0,
              highDays: 0
            });
          }

          const stat = stats.get(countryCode);
          stat.totalShopify += shopifyOrders;
          stat.totalMeta += metaOrders;
          stat.covered += covered;

          if (shopifyOrders > 0) {
            stat.daysWithOrders += 1;
            const coverage = covered / shopifyOrders;
            if (coverage <= COUNTRY_LOW_COVERAGE_THRESHOLD) stat.lowDays += 1;
            if (coverage >= COUNTRY_HIGH_COVERAGE_THRESHOLD) stat.highDays += 1;
          }
        });

        stats.forEach((stat) => {
          stat.coverageRate = stat.totalShopify > 0 ? safeDivide(stat.covered, stat.totalShopify) : null;
          stat.missedRate = stat.coverageRate == null ? null : 1 - stat.coverageRate;
        });

        return stats;
      };

      const currentStatsByCountry = buildCountryWindowStats(countryDailyRows, countryMetaDailyMap, current7Start, finalizedEndDate);
      const prevStatsByCountry = prevWindowStart && prevWindowEnd
        ? buildCountryWindowStats(countryDailyRows, countryMetaDailyMap, prevWindowStart, prevWindowEnd)
        : new Map();

      currentStatsByCountry.forEach((stat, code) => {
        if (stat.totalShopify < COUNTRY_SIGNAL_MIN_ORDERS) return;
        if (stat.daysWithOrders < COUNTRY_SIGNAL_MIN_ACTIVE_DAYS) return;
        if (stat.coverageRate == null) return;

        if (stat.coverageRate <= COUNTRY_LOW_COVERAGE_THRESHOLD && stat.lowDays >= COUNTRY_SIGNAL_MIN_LOW_DAYS) {
          constantlyLowCountries.push({
            countryCode: code,
            coverageRate: stat.coverageRate,
            shopifyOrders: stat.totalShopify
          });
        }

        const prev = prevStatsByCountry.get(code);
        if (!prev) return;
        if (prev.totalShopify < COUNTRY_SIGNAL_MIN_ORDERS) return;
        if (prev.daysWithOrders < COUNTRY_SIGNAL_MIN_ACTIVE_DAYS) return;
        if (prev.coverageRate == null) return;

        const improveDelta = stat.coverageRate - prev.coverageRate;
        const improveZ = twoProportionZScore(stat.covered, stat.totalShopify, prev.covered, prev.totalShopify);
        const improvedFromLow = prev.coverageRate <= COUNTRY_LOW_COVERAGE_THRESHOLD && prev.lowDays >= COUNTRY_SIGNAL_MIN_LOW_DAYS;

        if (improvedFromLow && improveDelta >= COUNTRY_SIGNAL_IMPROVE_DELTA && improveZ != null && improveZ >= SIGNAL_Z_THRESHOLD) {
          improvingCountries.push({
            countryCode: code,
            delta: improveDelta,
            coverageRate: stat.coverageRate
          });
        }

        const worsenDelta = prev.coverageRate - stat.coverageRate;
        const worsenZ = twoProportionZScore(prev.covered, prev.totalShopify, stat.covered, stat.totalShopify);
        const fellFromHigh = prev.coverageRate >= COUNTRY_HIGH_COVERAGE_THRESHOLD && prev.highDays >= COUNTRY_SIGNAL_MIN_HIGH_DAYS;

        if (fellFromHigh && worsenDelta >= COUNTRY_SIGNAL_WORSEN_DELTA && worsenZ != null && worsenZ >= SIGNAL_Z_THRESHOLD) {
          worseningCountries.push({
            countryCode: code,
            delta: -worsenDelta,
            coverageRate: stat.coverageRate
          });
        }
      });

      constantlyLowCountries.sort((a, b) => a.coverageRate - b.coverageRate);
      improvingCountries.sort((a, b) => b.delta - a.delta);
      worseningCountries.sort((a, b) => a.delta - b.delta);
    }

    const alerts = buildAlerts({
      current7,
      previous7,
      missingIdRate7,
      prevMissingIdRate7,
      consentRate7,
      prevConsentRate7,
      constantlyLowCountries,
      improvingCountries,
      worseningCountries,
      worstCountry,
      worstCountryDiagnostics,
      periodLabel: current7Start && finalizedEndDate
        ? getPeriodLabel(current7Start, finalizedEndDate)
        : getPeriodLabel(range.start, range.end)
    });

    return res.json({
      success: true,
      requestedPeriod: requestedRange,
      dataStart,
      period: range,
      compare: compareRange,
      totals: {
        ...totals,
        coverageRate: currentCoverageRate
      },
      compareTotals: {
        ...compareTotals,
        coverageRate: previousCoverageRate
      },
      series,
      countryGaps,
      unattributedOrders: limitedUnattributed,
      alerts,
      countryBreakdownAvailable: hasCountryRows,
      attributionDataAvailable,
      finalizedEndDate,
      signalWindow: current7Start && finalizedEndDate ? { start: current7Start, end: finalizedEndDate } : null,
      diagnostics: {
        missingIdRate,
        consentRate,
        missingIdRate7,
        consentRate7
      }
    });
  } catch (error) {
    console.error('[Attribution] Summary error:', error);
    return res.status(500).json({
      success: false,
      error: 'We could not load attribution insights right now. Please try again in a moment.'
    });
  }
});

router.get('/country-series', (req, res) => {
  try {
    const store = (req.query.store || 'shawq').toString();
    const country = (req.query.country || '').toString().trim().toUpperCase();
    const startParam = req.query.start;
    const endParam = req.query.end;

    if (!country) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a country code.'
      });
    }

    const requestedRange = startParam && endParam
      ? normalizeRange(startParam, endParam)
      : normalizeRange(addDays(formatDateAsGmt3(new Date()), -(DEFAULT_RANGE_DAYS - 1)), formatDateAsGmt3(new Date()));

    if (!requestedRange) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid start and end date.'
      });
    }

    const db = getDb();
    const orderSource = resolveOrderSource(db, store);
    const orderTable = orderSource.table;
    const orderWhere = buildOrderWhereClause(orderTable);

    const metaMinDate = db.prepare(`
      SELECT MIN(date) as date
      FROM meta_daily_metrics
      WHERE store = ?
    `).get(store)?.date || null;

    const ordersMinDate = db.prepare(`
      SELECT MIN(date) as date
      FROM ${orderTable}
      WHERE store = ?${orderWhere}
    `).get(store)?.date || null;

    const dataStart = metaMinDate && ordersMinDate
      ? maxDateStr(metaMinDate, ordersMinDate)
      : (metaMinDate || ordersMinDate);

    const range = dataStart && requestedRange.start < dataStart
      ? { ...requestedRange, start: dataStart }
      : requestedRange;

    const shopifyDaily = db.prepare(`
      SELECT date, COUNT(*) as orders
      FROM ${orderTable}
      WHERE store = ? AND date BETWEEN ? AND ?
        AND COALESCE(NULLIF(country_code, ''), 'UN') = ?
      ${orderWhere}
      GROUP BY date
    `).all(store, range.start, range.end, country);

    const metaDaily = db.prepare(`
      SELECT date, SUM(conversions) as orders
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ? AND country = ?
      GROUP BY date
    `).all(store, range.start, range.end, country);

    const shopifyByDate = new Map(shopifyDaily.map((row) => [row.date, row.orders || 0]));
    const metaByDate = new Map(metaDaily.map((row) => [row.date, row.orders || 0]));

    const series = enumerateDates(range.start, range.end).map((date) => {
      const shopifyOrders = shopifyByDate.get(date) || 0;
      const metaOrders = metaByDate.get(date) || 0;
      const unattributed = Math.max(0, shopifyOrders - metaOrders);
      const coverageRate = coverageRateFromCounts(metaOrders, shopifyOrders);

      return {
        date,
        shopifyOrders,
        metaOrders,
        unattributed,
        coverageRate
      };
    });

    const totals = series.reduce(
      (acc, row) => {
        acc.shopifyOrders += row.shopifyOrders;
        acc.metaOrders += row.metaOrders;
        acc.unattributed += row.unattributed;
        return acc;
      },
      { shopifyOrders: 0, metaOrders: 0, unattributed: 0 }
    );

    return res.json({
      success: true,
      country,
      requestedPeriod: requestedRange,
      dataStart,
      period: range,
      totals: {
        ...totals,
        coverageRate: coverageRateFromCounts(totals.metaOrders, totals.shopifyOrders)
      },
      series
    });
  } catch (error) {
    console.error('[Attribution] Country series error:', error);
    return res.status(500).json({
      success: false,
      error: 'We could not load country attribution right now. Please try again in a moment.'
    });
  }
});

router.post('/assistant', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'AI assistant is not configured. Please add OPENAI_API_KEY and retry.'
      });
    }

    const { question, context, stream } = req.body || {};
    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a question so I can help.'
      });
    }

    const systemPrompt = 'You are an analytics assistant for attribution. Be concise, customer-friendly, and actionable. If data is missing, say so clearly.';
    const messages = [
      {
        role: 'user',
        content: `Question:\n${question}\n\nContext:\n${JSON.stringify(context || {}, null, 2)}`
      }
    ];

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      try {
        await streamOpenAIChat({
          model: 'gpt-4o-mini',
          systemPrompt,
          messages,
          maxOutputTokens: 1200,
          verbosity: 'low',
          onDelta: (text) => {
            res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
          }
        });
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        return res.end();
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      return res.end();
    }

    const response = await askOpenAIChat({
      model: 'gpt-4o-mini',
      systemPrompt,
      messages,
      maxOutputTokens: 1200,
      verbosity: 'low'
    });

    return res.json({
      success: true,
      message: response
    });
  } catch (error) {
    console.error('[Attribution] Assistant error:', error);
    return res.status(500).json({
      success: false,
      error: 'AI assistant failed to respond. Please try again shortly.'
    });
  }
});

router.post('/assistant/debug', async (req, res) => {
  try {
    const { question, context, stream } = req.body || {};
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'AI debug assistant is not configured. Please add ANTHROPIC_API_KEY and retry.'
      });
    }

    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a question so I can help.'
      });
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = 'You are a senior attribution analyst. Provide clear, step-by-step fixes with no fluff. If data is missing, say so.';
    const messages = [
      {
        role: 'user',
        content: `Question:\n${question}\n\nContext:\n${JSON.stringify(context || {}, null, 2)}`
      }
    ];

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const responseStream = anthropic.messages.stream({
        model: 'claude-3-opus-20240229',
        max_tokens: 1200,
        system: systemPrompt,
        messages
      });

      const writeEvent = (payload) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
      };

      const endStream = () => {
        if (!res.writableEnded) {
          res.end();
        }
      };

      try {
        responseStream.on('text', (text) => {
          writeEvent({ type: 'delta', text });
        });

        responseStream.on('end', () => {
          writeEvent({ type: 'done' });
          endStream();
        });

        responseStream.on('error', (err) => {
          writeEvent({ type: 'error', error: err.message || 'Stream error' });
          endStream();
        });
      } catch (err) {
        console.error('[Attribution] Debug assistant stream error:', err);
        writeEvent({ type: 'error', error: 'An unexpected error occurred during streaming.' });
        endStream();
      }

      return;
    }

    const response = await anthropic.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 1200,
      system: systemPrompt,
      messages
    });

    return res.json({
      success: true,
      message: response?.content?.[0]?.text || ''
    });
  } catch (error) {
    console.error('[Attribution] Debug assistant error:', error);
    return res.status(500).json({
      success: false,
      error: 'AI debug assistant failed to respond. Please try again shortly.'
    });
  }
});

export default router;
