import express from 'express';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import { resolveExchangeRateProviders } from '../services/exchangeRateConfig.js';
import {
  fetchApilayerHistoricalTryToUsdRate,
  fetchCurrencyFreaksHistoricalTryToUsdRate,
  fetchCurrencyFreaksLatestTryToUsdRate,
  fetchFrankfurterTryToUsdRate,
  fetchOXRHistoricalTryToUsdRate
} from '../services/exchangeRateProviders.js';

const router = express.Router();

function mapProviderLabel(provider) {
  if (provider === 'currencyfreaks') return 'CurrencyFreaks';
  if (provider === 'oxr') return 'Open Exchange Rates';
  if (provider === 'apilayer') return 'APILayer';
  if (provider === 'frankfurter') return 'Frankfurter (ECB)';
  return provider;
}

function toCustomerError({ provider, tier, result }) {
  const providerName = mapProviderLabel(provider);

  if (result?.code === 'missing_api_key') {
    return {
      httpStatus: 500,
      error: `${providerName} is not configured yet. Please add the API key and try again.`,
      code: result.code
    };
  }

  if (result?.code === 'quota_reached') {
    return {
      httpStatus: 429,
      error: `${providerName} quota reached. Backfill is temporarily paused. Please try again later, or switch to another provider.`,
      code: result.code
    };
  }

  if (result?.code === 'rate_unavailable') {
    return {
      httpStatus: 400,
      error: 'Exchange rate is not available for this date from the selected source.',
      code: result.code
    };
  }

  if (result?.code === 'network_error') {
    return {
      httpStatus: 502,
      error: `${providerName} is temporarily unavailable. Please try again in a moment.`,
      code: result.code
    };
  }

  if (result?.code === 'invalid_response') {
    return {
      httpStatus: 502,
      error: `${providerName} returned an unexpected response. Please try again.`,
      code: result.code
    };
  }

  if (result?.code === 'http_error' || result?.code === 'provider_error') {
    return {
      httpStatus: 400,
      error: `${providerName} couldn't provide a rate for this request. Please verify your plan supports historical rates, then try again.`,
      code: result.code
    };
  }

  return {
    httpStatus: 500,
    error: 'Something went wrong while fetching the exchange rate. Please try again.',
    code: result?.code || 'unknown'
  };
}

// GET /api/exchange-rates/providers - Show configured provider strategy (safe: no secrets)
router.get('/providers', (req, res) => {
  const config = resolveExchangeRateProviders();
  return res.json({
    success: true,
    config: {
      dailyProvider: config.dailyProvider,
      primaryBackfillProvider: config.primaryBackfillProvider,
      secondaryBackfillProvider: config.secondaryBackfillProvider,
      sources: config.sources,
      configured: config.configured
    },
    tiers: {
      primaryDaily: {
        id: 'primary_daily',
        label: 'Primary (Daily)',
        description: 'Used to fetch the most recently finalized day (yesterday, GMT+3).'
      },
      primaryBackfill: {
        id: 'primary_backfill',
        label: 'Primary (Backfill)',
        description: 'Used to backfill missing historical days.'
      },
      secondaryBackfill: {
        id: 'secondary_backfill',
        label: 'Secondary (Backfill)',
        description: 'Fallback provider used only when the primary backfill source cannot return a rate.'
      }
    }
  });
});

// GET /api/exchange-rates/debug - Exchange rate + API usage debug info
router.get('/debug', (req, res) => {
  try {
    const db = getDb();

    const providersConfig = resolveExchangeRateProviders();

    // Get last 60 days of rates
    const rates = db.prepare(`
      SELECT date, rate, source, created_at
      FROM exchange_rates
      WHERE from_currency = 'TRY' AND to_currency = 'USD'
      ORDER BY date DESC
      LIMIT 60
    `).all();

    // Get conversion stats from meta_daily_metrics for Shawq
    const conversionStats = db.prepare(`
      SELECT
        date,
        SUM(spend) as total_spend_usd,
        COUNT(*) as row_count
      FROM meta_daily_metrics
      WHERE store = 'shawq'
      GROUP BY date
      ORDER BY date DESC
      LIMIT 30
    `).all();

    // Month usage (actual external API calls)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthStr = startOfMonth.toISOString().split('T')[0];

    const usageRows = db.prepare(`
      SELECT provider, COUNT(*) as count
      FROM exchange_rate_api_usage
      WHERE created_at >= ?
      GROUP BY provider
    `).all(monthStr);

    const usageByProvider = {};
    let totalCallsThisMonth = 0;
    for (const row of usageRows) {
      usageByProvider[row.provider] = row.count;
      totalCallsThisMonth += row.count;
    }

    const currencyfreaksCallsThisMonth = usageByProvider.currencyfreaks || 0;

    // Get missing dates in last 60 days
    const missingDates = [];
    const todayGmt3 = formatDateAsGmt3(new Date());
    for (let i = 1; i <= 60; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = formatDateAsGmt3(d);
      if (dateStr === todayGmt3) {
        continue;
      }
      const hasRate = rates.find(r => r.date === dateStr);
      if (!hasRate) {
        missingDates.push(dateStr);
      }
    }

    return res.json({
      success: true,
      providerStrategy: {
        dailyProvider: providersConfig.dailyProvider,
        primaryBackfillProvider: providersConfig.primaryBackfillProvider,
        secondaryBackfillProvider: providersConfig.secondaryBackfillProvider,
        sources: providersConfig.sources,
        configured: providersConfig.configured
      },
      summary: {
        totalRatesStored: rates.length,
        totalExternalCallsThisMonth: totalCallsThisMonth,
        currencyfreaksCallsThisMonth,
        currencyfreaksCallsRemainingEstimate: Math.max(0, 1000 - currencyfreaksCallsThisMonth),
        missingDatesCount: missingDates.length,
        oldestRate: rates[rates.length - 1]?.date || null,
        newestRate: rates[0]?.date || null
      },
      usageByProvider,
      rates: rates.map(r => ({
        date: r.date,
        rate: r.rate,
        usdToTry: (1 / r.rate).toFixed(2),
        source: r.source,
        createdAt: r.created_at
      })),
      conversionStats: conversionStats.map(s => ({
        date: s.date,
        totalSpendUsd: s.total_spend_usd?.toFixed(2) || '0.00',
        rowCount: s.row_count
      })),
      missingDates
    });
  } catch (err) {
    console.error('[Exchange Debug] Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/exchange-rates/backfill-single - Backfill a single date
router.post('/backfill-single', async (req, res) => {
  const { date, tier } = req.body || {};

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'Please select a valid date (YYYY-MM-DD).' });
  }

  const selectedTier = (tier || 'primary_backfill').toLowerCase();

  const db = getDb();

  const existing = db.prepare(`
    SELECT rate, source FROM exchange_rates
    WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
  `).get(date);

  if (existing) {
    const applyStats = applyExchangeRatesToMetaMetrics({
      db,
      store: 'shawq',
      startDate: date,
      endDate: date
    });

    return res.json({
      success: true,
      date,
      rate: existing.rate,
      usdToTry: 1 / existing.rate,
      source: existing.source,
      cached: true,
      applied: {
        startDate: date,
        endDate: date,
        tableStats: applyStats.perTable,
        totals: applyStats.totals
      }
    });
  }

  const { dailyProvider, primaryBackfillProvider, secondaryBackfillProvider } = resolveExchangeRateProviders();

  let provider = null;
  let mode = 'historical';

  if (selectedTier === 'primary_daily') {
    provider = dailyProvider;
    mode = 'daily';
  } else if (selectedTier === 'secondary_backfill') {
    provider = secondaryBackfillProvider;
    mode = 'historical';
  } else {
    provider = primaryBackfillProvider;
    mode = 'historical';
  }

  if (!provider) {
    return res.status(500).json({
      success: false,
      error: 'Historical rates are not configured yet. Please set up an exchange-rate provider and try again.'
    });
  }

  // Primary (Daily): use CurrencyFreaks latest for yesterday, and CurrencyFreaks historical for other dates.
  // This lets users safely use the same "primary" source for both daily and manual historical lookups.
  if (mode === 'daily') {
    const yesterday = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));

    if (provider !== 'currencyfreaks') {
      return res.status(500).json({
        success: false,
        error: `Primary (Daily) is configured as "${provider}", but only CurrencyFreaks is supported for this option right now.`
      });
    }

    const result = date == yesterday
      ? await fetchCurrencyFreaksLatestTryToUsdRate()
      : await fetchCurrencyFreaksHistoricalTryToUsdRate(date);
    if (!result.ok) {
      const mapped = toCustomerError({ provider, tier: selectedTier, result });
      return res.status(mapped.httpStatus).json({
        success: false,
        error: mapped.error,
        provider,
        tier: selectedTier,
        code: mapped.code
      });
    }

    const tryToUsd = result.tryToUsd;
    db.prepare(`
      INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
      VALUES ('TRY', 'USD', ?, ?, ?)
    `).run(tryToUsd, date, result.source || provider);

    const applyStats = applyExchangeRatesToMetaMetrics({
      db,
      store: 'shawq',
      startDate: date,
      endDate: date
    });

    return res.json({
      success: true,
      date,
      rate: tryToUsd,
      usdToTry: 1 / tryToUsd,
      source: result.source || provider,
      tier: selectedTier,
      applied: {
        startDate: date,
        endDate: date,
        tableStats: applyStats.perTable,
        totals: applyStats.totals
      }
    });
  }

  // Historical / backfill mode
  let result = null;

  if (provider === 'currencyfreaks') {
    result = await fetchCurrencyFreaksHistoricalTryToUsdRate(date);
  } else if (provider === 'oxr') {
    result = await fetchOXRHistoricalTryToUsdRate(date);
  } else if (provider === 'apilayer') {
    result = await fetchApilayerHistoricalTryToUsdRate(date);
  } else if (provider === 'frankfurter') {
    result = await fetchFrankfurterTryToUsdRate(date);
  } else {
    return res.status(500).json({ success: false, error: `Unknown backfill provider: ${provider}` });
  }

  if (!result.ok) {
    const mapped = toCustomerError({ provider, tier: selectedTier, result });
    return res.status(mapped.httpStatus).json({
      success: false,
      error: mapped.error,
      provider,
      tier: selectedTier,
      code: mapped.code
    });
  }

  const tryToUsd = result.tryToUsd;

  if (!Number.isFinite(tryToUsd) || tryToUsd <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Backfill is not available for this date from the selected source. Please try another provider or date.'
    });
  }

  db.prepare(`
    INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
    VALUES ('TRY', 'USD', ?, ?, ?)
  `).run(tryToUsd, date, result.source || provider);

  const applyStats = applyExchangeRatesToMetaMetrics({
    db,
    store: 'shawq',
    startDate: date,
    endDate: date
  });

  return res.json({
    success: true,
    date,
    rate: tryToUsd,
    usdToTry: 1 / tryToUsd,
    source: result.source || provider,
    tier: selectedTier,
    applied: {
      startDate: date,
      endDate: date,
      tableStats: applyStats.perTable,
      totals: applyStats.totals
    }
  });
});


const MAX_MANUAL_DAYS_RANGE = 370;
const EXCHANGE_APPLY_TABLES = ['meta_daily_metrics', 'meta_adset_metrics', 'meta_ad_metrics'];

function parsePositiveNumber(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function validateDateString(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

function buildDateRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays < 0) return null;
  if (diffDays + 1 > MAX_MANUAL_DAYS_RANGE) {
    return { error: `Please keep ranges to ${MAX_MANUAL_DAYS_RANGE} days or fewer.` };
  }

  const dates = [];
  for (let i = 0; i <= diffDays; i += 1) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    dates.push(d.toISOString().slice(0, 10));
  }

  return { dates };
}

function applyExchangeRatesToMetaMetrics({ db, store, startDate, endDate }) {
  const perTable = {};
  let totalCandidates = 0;
  let totalConvertible = 0;
  let totalUpdated = 0;

  const tx = db.transaction(() => {
    for (const table of EXCHANGE_APPLY_TABLES) {
      const candidateRows = db.prepare(`
        SELECT COUNT(*) as count
        FROM ${table}
        WHERE store = ?
          AND date BETWEEN ? AND ?
          AND COALESCE(original_currency, 'TRY') = 'TRY'
      `).get(store, startDate, endDate)?.count || 0;

      const convertibleRows = db.prepare(`
        SELECT COUNT(*) as count
        FROM ${table}
        WHERE store = ?
          AND date BETWEEN ? AND ?
          AND COALESCE(original_currency, 'TRY') = 'TRY'
          AND EXISTS (
            SELECT 1
            FROM exchange_rates er
            WHERE er.from_currency = 'TRY'
              AND er.to_currency = 'USD'
              AND er.date = ${table}.date
          )
      `).get(store, startDate, endDate)?.count || 0;

      const updateResult = db.prepare(`
        UPDATE ${table}
        SET
          spend = CASE
            WHEN spend_original IS NOT NULL THEN spend_original * (
              SELECT er.rate
              FROM exchange_rates er
              WHERE er.from_currency = 'TRY'
                AND er.to_currency = 'USD'
                AND er.date = ${table}.date
            )
            ELSE spend
          END,
          conversion_value = CASE
            WHEN conversion_value_original IS NOT NULL THEN conversion_value_original * (
              SELECT er.rate
              FROM exchange_rates er
              WHERE er.from_currency = 'TRY'
                AND er.to_currency = 'USD'
                AND er.date = ${table}.date
            )
            ELSE conversion_value
          END,
          cost_per_inline_link_click = CASE
            WHEN cost_per_inline_link_click_original IS NOT NULL THEN cost_per_inline_link_click_original * (
              SELECT er.rate
              FROM exchange_rates er
              WHERE er.from_currency = 'TRY'
                AND er.to_currency = 'USD'
                AND er.date = ${table}.date
            )
            ELSE cost_per_inline_link_click
          END
        WHERE store = ?
          AND date BETWEEN ? AND ?
          AND COALESCE(original_currency, 'TRY') = 'TRY'
          AND EXISTS (
            SELECT 1
            FROM exchange_rates er
            WHERE er.from_currency = 'TRY'
              AND er.to_currency = 'USD'
              AND er.date = ${table}.date
          )
      `).run(store, startDate, endDate);

      totalCandidates += candidateRows;
      totalConvertible += convertibleRows;
      totalUpdated += updateResult.changes;

      perTable[table] = {
        candidates: candidateRows,
        convertible: convertibleRows,
        updated: updateResult.changes
      };
    }
  });

  tx();

  return {
    perTable,
    totals: {
      candidates: totalCandidates,
      convertible: totalConvertible,
      updated: totalUpdated
    }
  };
}

// POST /api/exchange-rates/apply - Reapply stored TRY->USD rates to historical Meta spend rows
router.post('/apply', (req, res) => {
  const { date, startDate, endDate, store } = req.body || {};
  const dateStr = typeof date === 'string' ? date.trim() : '';
  const startStr = typeof startDate === 'string' ? startDate.trim() : '';
  const endStr = typeof endDate === 'string' ? endDate.trim() : '';
  const targetStore = (typeof store === 'string' && store.trim()) ? store.trim().toLowerCase() : 'shawq';

  const isSingle = Boolean(dateStr);
  const isRange = Boolean(startStr || endStr);

  if (!isSingle && !isRange) {
    return res.status(400).json({ success: false, error: 'Please provide either "date" or "startDate/endDate".' });
  }
  if (isSingle && isRange) {
    return res.status(400).json({
      success: false,
      error: 'Please provide either a single "date" or a "startDate/endDate" range (not both).'
    });
  }

  let dates = [];
  let effectiveStartDate = '';
  let effectiveEndDate = '';

  if (isSingle) {
    if (!validateDateString(dateStr)) {
      return res.status(400).json({ success: false, error: 'Please select a valid date (YYYY-MM-DD).' });
    }
    dates = [dateStr];
    effectiveStartDate = dateStr;
    effectiveEndDate = dateStr;
  } else {
    if (!startStr || !endStr) {
      return res.status(400).json({ success: false, error: 'Please provide both "startDate" and "endDate".' });
    }
    if (!validateDateString(startStr) || !validateDateString(endStr)) {
      return res.status(400).json({ success: false, error: 'Please select a valid start/end date (YYYY-MM-DD).' });
    }
    const range = buildDateRange(startStr, endStr);
    if (!range) {
      return res.status(400).json({ success: false, error: 'Start date must be before or equal to end date.' });
    }
    if (range.error) {
      return res.status(400).json({ success: false, error: range.error });
    }
    dates = range.dates;
    effectiveStartDate = startStr;
    effectiveEndDate = endStr;
  }

  const db = getDb();

  const rateRows = db.prepare(`
    SELECT date
    FROM exchange_rates
    WHERE from_currency = 'TRY'
      AND to_currency = 'USD'
      AND date BETWEEN ? AND ?
  `).all(effectiveStartDate, effectiveEndDate);
  const rateSet = new Set(rateRows.map((row) => row.date));
  const missingRateDates = dates.filter((d) => !rateSet.has(d));

  const applyStats = applyExchangeRatesToMetaMetrics({
    db,
    store: targetStore,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate
  });

  return res.json({
    success: true,
    store: targetStore,
    mode: isSingle ? 'single' : 'range',
    date: isSingle ? dateStr : undefined,
    startDate: effectiveStartDate,
    endDate: effectiveEndDate,
    totalDates: dates.length,
    datesWithRates: dates.length - missingRateDates.length,
    datesMissingRates: missingRateDates.length,
    missingRateDates,
    tableStats: applyStats.perTable,
    totals: applyStats.totals
  });
});

// POST /api/exchange-rates/manual - Save a manual rate for a date (or date range)
router.post('/manual', (req, res) => {
  const { date, startDate, endDate, tryToUsd, usdToTry, overwrite } = req.body || {};

  const dateStr = typeof date === 'string' ? date.trim() : '';
  const startStr = typeof startDate === 'string' ? startDate.trim() : '';
  const endStr = typeof endDate === 'string' ? endDate.trim() : '';

  const isSingle = Boolean(dateStr);
  const isRange = Boolean(startStr || endStr);

  if (!isSingle && !isRange) {
    return res.status(400).json({ success: false, error: 'Please provide either "date" or "startDate/endDate".' });
  }

  if (isSingle && isRange) {
    return res.status(400).json({
      success: false,
      error: 'Please provide either a single "date" or a "startDate/endDate" range (not both).'
    });
  }

  if (isSingle && !validateDateString(dateStr)) {
    return res.status(400).json({ success: false, error: 'Please select a valid date (YYYY-MM-DD).' });
  }

  if (isRange) {
    if (!startStr || !endStr) {
      return res.status(400).json({ success: false, error: 'Please provide both "startDate" and "endDate".' });
    }

    if (!validateDateString(startStr) || !validateDateString(endStr)) {
      return res.status(400).json({ success: false, error: 'Please select a valid start/end date (YYYY-MM-DD).' });
    }
  }

  const parsedTryToUsd = parsePositiveNumber(tryToUsd);
  const parsedUsdToTry = parsePositiveNumber(usdToTry);

  if (!parsedTryToUsd && !parsedUsdToTry) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a valid exchange rate ("tryToUsd" or "usdToTry").'
    });
  }

  const rate = parsedTryToUsd || (1 / parsedUsdToTry);
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ success: false, error: 'Please provide a valid positive exchange rate.' });
  }

  const db = getDb();
  const allowOverwrite = Boolean(overwrite);

  const selectExisting = db.prepare(`
    SELECT rate, source FROM exchange_rates
    WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
  `);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
    VALUES ('TRY', 'USD', ?, ?, 'manual')
  `);

  if (isSingle) {
    const existing = selectExisting.get(dateStr);
    if (existing && !allowOverwrite) {
      return res.status(409).json({
        success: false,
        error: 'A rate already exists for this date. Enable overwrite to replace it.',
        date: dateStr,
        existing: {
          rate: existing.rate,
          usdToTry: 1 / existing.rate,
          source: existing.source
        }
      });
    }

    upsert.run(rate, dateStr);
    const applyStats = applyExchangeRatesToMetaMetrics({
      db,
      store: 'shawq',
      startDate: dateStr,
      endDate: dateStr
    });

    return res.json({
      success: true,
      mode: 'single',
      date: dateStr,
      rate,
      usdToTry: 1 / rate,
      source: 'manual',
      overwritten: Boolean(existing && allowOverwrite),
      applied: {
        startDate: dateStr,
        endDate: dateStr,
        tableStats: applyStats.perTable,
        totals: applyStats.totals
      }
    });
  }

  const range = buildDateRange(startStr, endStr);
  if (!range) {
    return res.status(400).json({ success: false, error: 'Start date must be before or equal to end date.' });
  }
  if (range.error) {
    return res.status(400).json({ success: false, error: range.error });
  }

  let inserted = 0;
  let skippedExisting = 0;
  let overwritten = 0;

  const txn = db.transaction(() => {
    for (const day of range.dates) {
      const existing = selectExisting.get(day);
      if (existing && !allowOverwrite) {
        skippedExisting += 1;
        continue;
      }
      if (existing && allowOverwrite) {
        overwritten += 1;
      }
      upsert.run(rate, day);
      inserted += 1;
    }
  });

  txn();
  const applyStats = applyExchangeRatesToMetaMetrics({
    db,
    store: 'shawq',
    startDate: startStr,
    endDate: endStr
  });

  return res.json({
    success: true,
    mode: 'range',
    startDate: startStr,
    endDate: endStr,
    rate,
    usdToTry: 1 / rate,
    source: 'manual',
    overwrite: allowOverwrite,
    inserted,
    skippedExisting,
    overwritten,
    applied: {
      startDate: startStr,
      endDate: endStr,
      tableStats: applyStats.perTable,
      totals: applyStats.totals
    }
  });
});

export default router;
