import express from 'express';
import { getDb } from '../db/database.js';
import { askOpenAIChat, streamOpenAIChat } from '../services/openaiService.js';

const router = express.Router();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_RANGE_DAYS = 14;

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

function parseAttribution(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
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
  current,
  previous,
  missingIdRate,
  prevMissingIdRate,
  consentRate,
  prevConsentRate,
  zeroMetaDays,
  totalDays,
  topCountryGap,
  topCountryCode,
  periodLabel,
  compareLabel
}) {
  const alerts = [];

  const coverageDelta = current.coverageRate != null && previous.coverageRate != null
    ? current.coverageRate - previous.coverageRate
    : null;

  if (coverageDelta != null && coverageDelta <= -0.15) {
    alerts.push({
      id: 'coverage_drop',
      title: 'Coverage dropped',
      message: `Coverage fell to ${Math.round(current.coverageRate * 100)}% in ${periodLabel} vs ${Math.round(previous.coverageRate * 100)}% in ${compareLabel}.`,
      fix: 'Check pixel/CAPI delivery and consent rates to recover attribution.',
      severity: 'high'
    });
  }

  if (coverageDelta != null && coverageDelta >= 0.15) {
    alerts.push({
      id: 'coverage_up',
      title: 'Coverage improved',
      message: `Coverage rose to ${Math.round(current.coverageRate * 100)}% in ${periodLabel} vs ${Math.round(previous.coverageRate * 100)}% in ${compareLabel}.`,
      fix: 'Keep current tracking setup and monitor for consistency.',
      severity: 'medium'
    });
  }

  if (missingIdRate != null && prevMissingIdRate != null && missingIdRate - prevMissingIdRate >= 0.1 && missingIdRate >= 0.15) {
    alerts.push({
      id: 'missing_ids_spike',
      title: 'Missing Meta IDs spiked',
      message: `Orders missing Meta IDs rose to ${Math.round(missingIdRate * 100)}% in ${periodLabel} vs ${Math.round(prevMissingIdRate * 100)}% in ${compareLabel}.`,
      fix: 'Confirm pixel fires on every product and checkout page.',
      severity: 'high'
    });
  }

  if (consentRate != null && prevConsentRate != null && consentRate - prevConsentRate >= 0.08 && consentRate >= 0.12) {
    alerts.push({
      id: 'consent_decline',
      title: 'Consent declines increased',
      message: `Consent declines hit ${Math.round(consentRate * 100)}% in ${periodLabel} vs ${Math.round(prevConsentRate * 100)}% in ${compareLabel}.`,
      fix: 'Review consent banner placement and reduce friction at checkout.',
      severity: 'medium'
    });
  }

  if (zeroMetaDays >= 2 && totalDays > 0 && zeroMetaDays / totalDays >= 0.3) {
    alerts.push({
      id: 'meta_zero_days',
      title: 'Meta reported zero orders on multiple days',
      message: `Meta reported zero orders on ${zeroMetaDays} of ${totalDays} days in ${periodLabel}.`,
      fix: 'Audit pixel/CAPI health and confirm tokens are active.',
      severity: 'high'
    });
  }

  if (topCountryGap >= 10 && topCountryCode) {
    alerts.push({
      id: 'country_gap',
      title: 'Unattributed orders concentrated in one country',
      message: `${topCountryCode} shows the largest gap with ${topCountryGap} more Shopify orders than Meta in ${periodLabel}.`,
      fix: 'Check localized tracking scripts, currency, and consent settings.',
      severity: 'medium'
    });
  }

  return alerts;
}

router.get('/summary', (req, res) => {
  try {
    const store = (req.query.store || 'shawq').toString();
    const startParam = req.query.start;
    const endParam = req.query.end;

    const range = startParam && endParam
      ? normalizeRange(startParam, endParam)
      : normalizeRange(addDays(formatDate(new Date()), -(DEFAULT_RANGE_DAYS - 1)), formatDate(new Date()));

    if (!range) {
      return res.status(400).json({
        success: false,
        error: 'Please select a valid start and end date for attribution reporting.'
      });
    }

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

    const db = getDb();

    const orderSource = resolveOrderSource(db, store);
    const orderTable = orderSource.table;
    const attributionDataAvailable = orderSource.supportsAttribution;

    const rangeMin = range.start < compareRange.start ? range.start : compareRange.start;
    const rangeMax = range.end > compareRange.end ? range.end : compareRange.end;

    const hasCountryRows = db.prepare(`
      SELECT COUNT(*) as count
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
    `).get(store, rangeMin, rangeMax)?.count > 0;

    const shopifyDaily = db.prepare(`
      SELECT date, COUNT(*) as orders
      FROM ${orderTable}
      WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY date
    `).all(store, range.start, range.end);

    const metaDailyCountry = hasCountryRows
      ? db.prepare(`
          SELECT date, SUM(conversions) as orders
          FROM meta_daily_metrics
          WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
          GROUP BY date
        `).all(store, range.start, range.end)
      : [];

    const metaDailyAll = db.prepare(`
      SELECT date, SUM(conversions) as orders
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ? AND (country = 'ALL' OR country IS NULL OR country = '')
      GROUP BY date
    `).all(store, range.start, range.end);

    const shopifyDailyCompare = db.prepare(`
      SELECT date, COUNT(*) as orders
      FROM ${orderTable}
      WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY date
    `).all(store, compareRange.start, compareRange.end);

    const metaDailyCountryCompare = hasCountryRows
      ? db.prepare(`
          SELECT date, SUM(conversions) as orders
          FROM meta_daily_metrics
          WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
          GROUP BY date
        `).all(store, compareRange.start, compareRange.end)
      : [];

    const metaDailyAllCompare = db.prepare(`
      SELECT date, SUM(conversions) as orders
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ? AND (country = 'ALL' OR country IS NULL OR country = '')
      GROUP BY date
    `).all(store, compareRange.start, compareRange.end);

    const shopifyByDate = new Map(shopifyDaily.map((row) => [row.date, row.orders || 0]));

    const metaByDateCountry = new Map(metaDailyCountry.map((row) => [row.date, row.orders || 0]));
    const metaByDateAll = new Map(metaDailyAll.map((row) => [row.date, row.orders || 0]));

    const metaByDate = new Map();
    enumerateDates(range.start, range.end).forEach((date) => {
      if (hasCountryRows && metaByDateCountry.has(date)) {
        metaByDate.set(date, metaByDateCountry.get(date) || 0);
        return;
      }
      metaByDate.set(date, metaByDateAll.get(date) || 0);
    });

    const compareShopifyByDate = new Map(shopifyDailyCompare.map((row) => [row.date, row.orders || 0]));

    const compareMetaByDateCountry = new Map(metaDailyCountryCompare.map((row) => [row.date, row.orders || 0]));
    const compareMetaByDateAll = new Map(metaDailyAllCompare.map((row) => [row.date, row.orders || 0]));
    const compareMetaByDate = new Map();
    enumerateDates(compareRange.start, compareRange.end).forEach((date) => {
      if (hasCountryRows && compareMetaByDateCountry.has(date)) {
        compareMetaByDate.set(date, compareMetaByDateCountry.get(date) || 0);
        return;
      }
      compareMetaByDate.set(date, compareMetaByDateAll.get(date) || 0);
    });

    const series = enumerateDates(range.start, range.end).map((date) => {
      const shopifyOrders = shopifyByDate.get(date) || 0;
      const metaOrders = metaByDate.get(date) || 0;
      const unattributed = Math.max(0, shopifyOrders - metaOrders);
      const coverageRate = safeDivide(metaOrders, shopifyOrders);

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
      return {
        date,
        shopifyOrders,
        metaOrders
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
        return acc;
      },
      { shopifyOrders: 0, metaOrders: 0 }
    );

    const currentCoverageRate = safeDivide(totals.metaOrders, totals.shopifyOrders);
    const previousCoverageRate = safeDivide(compareTotals.metaOrders, compareTotals.shopifyOrders);

    const shopifyByCountry = db.prepare(`
      SELECT COALESCE(NULLIF(country_code, ''), 'UN') as country_code, COUNT(*) as orders
      FROM ${orderTable}
      WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY COALESCE(NULLIF(country_code, ''), 'UN')
    `).all(store, range.start, range.end);

    const metaByCountry = hasCountryRows
      ? db.prepare(`
          SELECT country as country_code, SUM(conversions) as orders
          FROM meta_daily_metrics
          WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
          GROUP BY country
        `).all(store, range.start, range.end)
      : [];

    const metaCountryMap = new Map(
      metaByCountry
        .filter((row) => row.country_code)
        .map((row) => [row.country_code, row.orders || 0])
    );

    const countryGaps = hasCountryRows
      ? shopifyByCountry.map((row) => {
          const metaOrders = metaCountryMap.get(row.country_code) || 0;
          const shopifyOrders = row.orders || 0;
          const gap = Math.max(0, shopifyOrders - metaOrders);
          return {
            countryCode: row.country_code,
            shopifyOrders,
            metaOrders,
            gap,
            coverageRate: safeDivide(metaOrders, shopifyOrders)
          };
        }).sort((a, b) => b.gap - a.gap)
      : [];

    const ordersRaw = attributionDataAvailable
      ? db.prepare(`
          SELECT order_id, date, country, country_code, order_total, attribution_json
          FROM ${orderTable}
          WHERE store = ? AND date BETWEEN ? AND ?
          ORDER BY date DESC
        `).all(store, range.start, range.end)
      : [];

    const metaDailyByCountry = hasCountryRows
      ? db.prepare(`
          SELECT date, country as country_code, SUM(conversions) as orders
          FROM meta_daily_metrics
          WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
          GROUP BY date, country
        `).all(store, range.start, range.end)
      : [];

    const metaByDateCountryMap = new Map();
    metaDailyByCountry.forEach((row) => {
      if (!row.country_code) return;
      const key = `${row.date}|${row.country_code}`;
      metaByDateCountryMap.set(key, row.orders || 0);
    });

    let missingIdsCount = 0;
    let consentDeniedCount = 0;

    const unattributedOrders = ordersRaw.map((order) => {
      const attrs = parseAttribution(order.attribution_json);
      const metaForDate = metaByDate.get(order.date) || 0;
      const metaForDateCountry = metaByDateCountryMap.get(`${order.date}|${order.country_code || 'UN'}`) || 0;
      const reason = buildOrderReason({
        attrs,
        orderDate: order.date,
        metaForDate,
        metaForDateCountry,
        hasCountryBreakdown: hasCountryRows
      });

      const metaIds = getMetaIdStatus(attrs);
      if (!metaIds.hasMetaIds) missingIdsCount += 1;
      if (parseConsentStatus(attrs.consent) === 'denied') consentDeniedCount += 1;

      const shopifyOrdersForDate = shopifyByDate.get(order.date) || 0;
      const metaOrdersForDate = metaByDate.get(order.date) || 0;
      const hasGapForDate = shopifyOrdersForDate > metaOrdersForDate;
      if (!hasGapForDate) return null;

      return {
        orderId: order.order_id,
        date: order.date,
        country: order.country,
        countryCode: order.country_code || 'UN',
        orderTotal: order.order_total,
        reason: reason.reason,
        fix: reason.fix,
        firstTouch: buildTouchLabel(attrs, 'first'),
        lastTouch: buildTouchLabel(attrs, 'last')
      };
    }).filter(Boolean).sort((a, b) => {
      const dateCompare = String(b.date).localeCompare(String(a.date));
      if (dateCompare !== 0) return dateCompare;
      return String(a.orderId).localeCompare(String(b.orderId));
    });

    const limitedUnattributed = unattributedOrders.slice(0, 50);

    const missingIdRate = attributionDataAvailable && totals.shopifyOrders ? missingIdsCount / totals.shopifyOrders : null;
    const consentRate = attributionDataAvailable && totals.shopifyOrders ? consentDeniedCount / totals.shopifyOrders : null;

    const compareOrdersRaw = attributionDataAvailable
      ? db.prepare(`
          SELECT order_id, date, attribution_json
          FROM ${orderTable}
          WHERE store = ? AND date BETWEEN ? AND ?
        `).all(store, compareRange.start, compareRange.end)
      : [];

    let prevMissingIds = 0;
    let prevConsentDenied = 0;

    compareOrdersRaw.forEach((order) => {
      const attrs = parseAttribution(order.attribution_json);
      const metaIds = getMetaIdStatus(attrs);
      if (!metaIds.hasMetaIds) prevMissingIds += 1;
      if (parseConsentStatus(attrs.consent) === 'denied') prevConsentDenied += 1;
    });

    const prevMissingIdRate = attributionDataAvailable && compareTotals.shopifyOrders ? prevMissingIds / compareTotals.shopifyOrders : null;
    const prevConsentRate = attributionDataAvailable && compareTotals.shopifyOrders ? prevConsentDenied / compareTotals.shopifyOrders : null;

    const zeroMetaDays = series.filter((row) => row.shopifyOrders > 0 && row.metaOrders === 0).length;
    const totalDays = series.length;
    const topCountryGap = hasCountryRows ? (countryGaps[0]?.gap || 0) : 0;
    const topCountryCode = hasCountryRows ? (countryGaps[0]?.countryCode || null) : null;

    const alerts = buildAlerts({
      current: { coverageRate: currentCoverageRate },
      previous: { coverageRate: previousCoverageRate },
      missingIdRate,
      prevMissingIdRate,
      consentRate,
      prevConsentRate,
      zeroMetaDays,
      totalDays,
      topCountryGap,
      topCountryCode,
      periodLabel: getPeriodLabel(range.start, range.end),
      compareLabel: getPeriodLabel(compareRange.start, compareRange.end)
    });

    return res.json({
      success: true,
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
      countryGaps: countryGaps.slice(0, 8),
      unattributedOrders: limitedUnattributed,
      alerts,
      countryBreakdownAvailable: hasCountryRows,
      attributionDataAvailable,
      diagnostics: {
        missingIdRate,
        consentRate,
        zeroMetaDays,
        totalDays
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
        model: 'claude-opus-4-20250514',
        max_tokens: 1200,
        system: systemPrompt,
        messages
      });

      responseStream.on('text', (text) => {
        res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
      });

      responseStream.on('end', () => {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      });

      responseStream.on('error', (err) => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      });

      return;
    }

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
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
