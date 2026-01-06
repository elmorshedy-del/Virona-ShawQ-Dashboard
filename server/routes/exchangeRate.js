import express from 'express';
import fetch from 'node-fetch';
import { getDb } from '../db/database.js';

const router = express.Router();

// GET /api/exchange-rates/debug - Get exchange rate debug info
router.get('/debug', (req, res) => {
  try {
    const db = getDb();

    // Get last 60 days of rates
    const rates = db.prepare(`
      SELECT date, rate, source, fetched_at
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
      WHERE source = 'oxr' AND fetched_at >= ?
    `).get(monthStr);

    // Get missing dates in last 60 days
    const missingDates = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
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
        missingDatesCount: missingDates.length,
        oldestRate: rates[rates.length - 1]?.date || null,
        newestRate: rates[0]?.date || null
      },
      rates: rates.map(r => ({
        date: r.date,
        rate: r.rate,
        usdToTry: (1 / r.rate).toFixed(2),
        source: r.source,
        fetchedAt: r.fetched_at
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

  const OXR_APP_ID = process.env.OXR_APP_ID;
  if (!OXR_APP_ID) {
    return res.status(500).json({ success: false, error: 'OXR_APP_ID not configured' });
  }

  try {
    const url = `https://openexchangerates.org/api/historical/${date}.json?app_id=${OXR_APP_ID}&symbols=TRY`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ success: false, error: data.message || data.description });
    }

    if (data.rates?.TRY) {
      const db = getDb();
      const tryToUsd = 1 / data.rates.TRY;

      db.prepare(`
        INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source, fetched_at)
        VALUES ('TRY', 'USD', ?, ?, 'oxr', datetime('now'))
      `).run(tryToUsd, date);

      return res.json({
        success: true,
        date,
        rate: tryToUsd,
        usdToTry: data.rates.TRY
      });
    }

    res.status(400).json({ success: false, error: 'No TRY rate in response' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
