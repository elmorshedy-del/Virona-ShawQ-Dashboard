import fetch from 'node-fetch';
import { getDb } from '../db/database.js';

const OXR_APP_ID = process.env.OXR_APP_ID;

if (!OXR_APP_ID) {
  console.error('ERROR: OXR_APP_ID environment variable not set');
  process.exit(1);
}

async function backfill(daysBack = 60) {
  const db = getDb();
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  console.log(`[Backfill] Starting backfill for ${daysBack} days...`);

  for (let i = 0; i < daysBack; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if already exists
    const existing = db.prepare(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
    `).get(dateStr);

    if (existing) {
      console.log(`[Backfill] ${dateStr}: Already exists (${existing.rate.toFixed(6)})`);
      skipped++;
      continue;
    }

    // Fetch from OXR
    try {
      const url = `https://openexchangerates.org/api/historical/${dateStr}.json?app_id=${OXR_APP_ID}&symbols=TRY`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) {
        console.error(`[Backfill] ${dateStr}: API error - ${data.message || data.description}`);
        failed++;
        continue;
      }

      if (data.rates?.TRY) {
        const tryToUsd = 1 / data.rates.TRY;

        db.prepare(`
          INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source, fetched_at)
          VALUES ('TRY', 'USD', ?, ?, 'oxr', datetime('now'))
        `).run(tryToUsd, dateStr);

        console.log(`[Backfill] ${dateStr}: TRY→USD = ${tryToUsd.toFixed(6)} (1 USD = ${data.rates.TRY.toFixed(2)} TRY)`);
        fetched++;
      } else {
        console.error(`[Backfill] ${dateStr}: No TRY rate in response`);
        failed++;
      }

      // Rate limit: 1 second between requests to avoid throttling
      await new Promise(r => setTimeout(r, 1000));

    } catch (err) {
      console.error(`[Backfill] ${dateStr}: Fetch error - ${err.message}`);
      failed++;
    }
  }

  console.log(`\n[Backfill] Complete!`);
  console.log(`  Fetched: ${fetched}`);
  console.log(`  Skipped (already existed): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total API calls used: ${fetched}`);
}

backfill(60);
