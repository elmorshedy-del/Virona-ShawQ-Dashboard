import express from 'express';
import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

const router = express.Router();

// GET /api/exchange-rates/debug - Get exchange rate debug info
router.get('/debug', (req, res) => {
  try {
    const db = getDb();

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

    // Get API call count this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthStr = startOfMonth.toISOString().split('T')[0];

    const apiCallsThisMonth = db.prepare(`
      SELECT COUNT(*) as count
      FROM exchange_rates
      WHERE source IN ('currencyfreaks', 'oxr') AND created_at >= ?
    `).get(monthStr);

    const backfillCallsThisMonth = db.prepare(`
      SELECT COUNT(*) as count
      FROM exchange_rates
      WHERE source = 'apilayer' AND created_at >= ?
    `).get(monthStr);

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

    res.json({
      success: true,
      summary: {
        totalRatesStored: rates.length,
        apiCallsThisMonth: apiCallsThisMonth?.count || 0,
        apiCallsRemaining: 1000 - (apiCallsThisMonth?.count || 0),
        backfillCallsThisMonth: backfillCallsThisMonth?.count || 0,
        backfillCallsRemaining: 100 - (backfillCallsThisMonth?.count || 0),
        missingDatesCount: missingDates.length,
        oldestRate: rates[rates.length - 1]?.date || null,
        newestRate: rates[0]?.date || null
      },
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/exchange-rates/backfill-single - Backfill a single date
router.post('/backfill-single', async (req, res) => {
  const { date } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  const db = getDb();
  const existing = db.prepare(`
    SELECT rate FROM exchange_rates
    WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
  `).get(date);

  if (existing) {
    return res.json({
      success: true,
      date,
      rate: existing.rate,
      usdToTry: 1 / existing.rate
    });
  }

  const apilayerKey = process.env.APILAYER_EXCHANGE_RATES_KEY;
  const oxrKey = process.env.OXR_APP_ID;

  if (!apilayerKey && !oxrKey) {
    return res.status(500).json({ success: false, error: 'No exchange rate provider configured' });
  }

  try {
    let tryToUsd = null;
    let usdToTry = null;
    let source = null;

    if (apilayerKey) {
      const url = `https://api.exchangeratesapi.io/v1/${date}?access_key=${apilayerKey}&symbols=USD,TRY`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(400).json({ success: false, error: `APILayer request failed (${response.status})` });
      }
      const data = await response.json();
      if (data?.success === false) {
        return res.status(400).json({ success: false, error: data?.error?.info || data?.error?.type || 'APILayer error' });
      }
      const usdRate = parseFloat(data?.rates?.USD);
      const tryRate = parseFloat(data?.rates?.TRY);
      if (!Number.isFinite(usdRate) || !Number.isFinite(tryRate) || tryRate <= 0) {
        return res.status(400).json({ success: false, error: 'No USD/TRY rates in APILayer response' });
      }
      tryToUsd = usdRate / tryRate;
      usdToTry = 1 / tryToUsd;
      source = 'apilayer';
    } else if (oxrKey) {
      const url = `https://openexchangerates.org/api/historical/${date}.json?app_id=${oxrKey}&symbols=TRY`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(400).json({ success: false, error: `OXR request failed (${response.status})` });
      }
      const data = await response.json();
      if (data.error) {
        return res.status(400).json({ success: false, error: data.message || data.description || 'OXR error' });
      }
      const usdRate = parseFloat(data?.rates?.TRY);
      if (!Number.isFinite(usdRate) || usdRate <= 0) {
        return res.status(400).json({ success: false, error: 'No TRY rate in OXR response' });
      }
      usdToTry = usdRate;
      tryToUsd = 1 / usdToTry;
      source = 'oxr';
    }

    if (!tryToUsd) {
      return res.status(400).json({ success: false, error: 'Backfill unavailable for this date' });
    }

    db.prepare(`
      INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
      VALUES ('TRY', 'USD', ?, ?, ?)
    `).run(tryToUsd, date, source);

    return res.json({
      success: true,
      date,
      rate: tryToUsd,
      usdToTry
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
