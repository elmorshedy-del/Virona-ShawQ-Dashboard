import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

const APILAYER_EXCHANGE_RATES_KEY = process.env.APILAYER_EXCHANGE_RATES_KEY;
const OXR_APP_ID = process.env.OXR_APP_ID;
const MAX_CALLS = parseInt(process.env.EXCHANGE_RATE_BACKFILL_MAX_CALLS || '100', 10);

if (!APILAYER_EXCHANGE_RATES_KEY && !OXR_APP_ID) {
  console.error('ERROR: No exchange rate provider configured (APILAYER_EXCHANGE_RATES_KEY or OXR_APP_ID)');
  process.exit(1);
}


async function backfill(daysBack = 60) {
  const db = getDb();
  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  const yesterday = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));

  console.log(`[Backfill] Starting backfill for ${daysBack} days...`);

  for (let i = 1; i <= daysBack; i++) {
    if (fetched >= MAX_CALLS) {
      console.log(`[Backfill] Reached max API calls (${MAX_CALLS}). Stopping.`);
      break;
    }

    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = formatDateAsGmt3(date); // YYYY-MM-DD in GMT+3

    if (dateStr === yesterday) {
      skipped++;
      continue;
    }

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

    try {
      let tryToUsd = null;
      let source = null;

      if (APILAYER_EXCHANGE_RATES_KEY) {
        const url = `https://api.exchangeratesapi.io/v1/${dateStr}?access_key=${APILAYER_EXCHANGE_RATES_KEY}&symbols=USD,TRY`;
        const res = await fetch(url);
        if (res.status === 429) {
          console.error('[Backfill] APILayer rate limit reached. Stopping.');
          break;
        }
        const data = await res.json();
        if (data?.success === false) {
          console.error(`[Backfill] ${dateStr}: APILayer error - ${data?.error?.info || data?.error?.type || 'Unknown error'}`);
        } else {
          const usdRate = parseFloat(data?.rates?.USD);
          const tryRate = parseFloat(data?.rates?.TRY);
          if (Number.isFinite(usdRate) && Number.isFinite(tryRate) && tryRate > 0) {
            tryToUsd = usdRate / tryRate;
            source = 'apilayer';
          } else {
            console.error(`[Backfill] ${dateStr}: APILayer response missing USD/TRY rates`);
          }
        }
      } else if (OXR_APP_ID) {
        const url = `https://openexchangerates.org/api/historical/${dateStr}.json?app_id=${OXR_APP_ID}&symbols=TRY`;
        const res = await fetch(url);
        if (res.status === 429) {
          console.error('[Backfill] OXR rate limit reached. Stopping.');
          break;
        }
        const data = await res.json();
        if (data.error) {
          console.error(`[Backfill] ${dateStr}: OXR error - ${data.message || data.description}`);
        } else if (data.rates?.TRY) {
          tryToUsd = 1 / data.rates.TRY;
          source = 'oxr';
        } else {
          console.error(`[Backfill] ${dateStr}: No TRY rate in OXR response`);
        }
      }

      if (tryToUsd) {
        db.prepare(`
          INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
          VALUES ('TRY', 'USD', ?, ?, ?)
        `).run(tryToUsd, dateStr, source);

        console.log(`[Backfill] ${dateStr}: TRY→USD = ${tryToUsd.toFixed(6)} (${source})`);
        fetched++;
      } else {
        failed++;
      }

      // Short delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));

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
  console.log(`  Max API calls allowed: ${MAX_CALLS}`);
}

backfill(60);
