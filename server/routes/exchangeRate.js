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
    return res.json({
      success: true,
      date,
      rate: existing.rate,
      usdToTry: 1 / existing.rate,
      source: existing.source,
      cached: true
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

  // Daily mode is ONLY for yesterday (finalized day). Never store a "latest" value onto arbitrary dates.
  if (mode === 'daily') {
    const yesterday = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));
    if (date !== yesterday) {
      return res.status(400).json({
        success: false,
        error: `Primary (Daily) only supports yesterday (${yesterday}) because today's final rate isn't published yet. Select Primary (Backfill) for other dates.`
      });
    }

    if (provider !== 'currencyfreaks') {
      return res.status(500).json({
        success: false,
        error: `Primary (Daily) is configured as "${provider}", but only CurrencyFreaks is supported for daily right now.`
      });
    }

    const result = await fetchCurrencyFreaksLatestTryToUsdRate();
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

    return res.json({
      success: true,
      date,
      rate: tryToUsd,
      usdToTry: 1 / tryToUsd,
      source: result.source || provider,
      tier: selectedTier
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

  return res.json({
    success: true,
    date,
    rate: tryToUsd,
    usdToTry: 1 / tryToUsd,
    source: result.source || provider,
    tier: selectedTier
  });
});

export default router;
