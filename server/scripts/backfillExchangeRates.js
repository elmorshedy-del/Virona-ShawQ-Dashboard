import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

const APILAYER_EXCHANGE_RATES_KEY = process.env.APILAYER_EXCHANGE_RATES_KEY;
const OXR_APP_ID = process.env.OXR_APP_ID;
const MAX_CALLS = parseInt(process.env.EXCHANGE_RATE_BACKFILL_MAX_CALLS || '100', 10);
const PROVIDER_OVERRIDE = (
  process.env.EXCHANGE_RATE_BACKFILL_PRIMARY_PROVIDER ||
  process.env.EXCHANGE_RATE_BACKFILL_PROVIDER ||
  process.env.EXCHANGE_RATE_HISTORICAL_PROVIDER ||
  ''
).toLowerCase();

function resolveProvider() {
  if (PROVIDER_OVERRIDE) {
    return PROVIDER_OVERRIDE;
  }
  if (APILAYER_EXCHANGE_RATES_KEY) {
    return 'apilayer';
  }
  if (OXR_APP_ID) {
    return 'oxr';
  }
  return null;
}

const provider = resolveProvider();

if (!provider) {
  console.error('ERROR: No exchange rate provider configured. Set APILAYER_EXCHANGE_RATES_KEY, OXR_APP_ID, or EXCHANGE_RATE_BACKFILL_PRIMARY_PROVIDER=frankfurter');
  process.exit(1);
}

if (!['apilayer', 'oxr', 'frankfurter'].includes(provider)) {
  console.error(`ERROR: Unknown backfill provider value: ${provider}. Supported: apilayer, oxr, frankfurter`);
  process.exit(1);
}

if (provider === 'apilayer' && !APILAYER_EXCHANGE_RATES_KEY) {
  console.error('ERROR: APILAYER_EXCHANGE_RATES_KEY not set');
  process.exit(1);
}

if (provider === 'oxr' && !OXR_APP_ID) {
  console.error('ERROR: OXR_APP_ID not set');
  process.exit(1);
}

async function backfill(daysBack = 60) {
  const db = getDb();
  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let calls = 0;
  const yesterday = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const missingDates = [];

  console.log(`[Backfill] Starting backfill for ${daysBack} days using ${provider}...`);

  for (let i = 1; i <= daysBack; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = formatDateAsGmt3(date); // YYYY-MM-DD in GMT+3

    if (dateStr === yesterday) {
      skipped++;
      continue;
    }

    const existing = db.prepare(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
    `).get(dateStr);

    if (existing) {
      console.log(`[Backfill] ${dateStr}: Already exists (${existing.rate.toFixed(6)})`);
      skipped++;
      continue;
    }

    missingDates.push(dateStr);
  }

  if (!missingDates.length) {
    console.log('[Backfill] No missing exchange rates found.');
    console.log(`  Skipped (already existed): ${skipped}`);
    return;
  }

  if (provider === 'frankfurter') {
    if (MAX_CALLS < 1) {
      console.log('[Backfill] EXCHANGE_RATE_BACKFILL_MAX_CALLS=0; backfill disabled.');
      return;
    }

    const sortedDates = [...missingDates].sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];
    const url = `https://api.frankfurter.app/${startDate}..${endDate}?from=TRY&to=USD`;

    try {
      const res = await fetch(url);
      calls += 1;
      if (!res.ok) {
        console.error(`[Backfill] Frankfurter request failed (${res.status}).`);
        failed = missingDates.length;
      } else {
        const data = await res.json();
        const rates = data?.rates || {};

        for (const dateStr of missingDates) {
          const rate = parseFloat(rates?.[dateStr]?.USD);
          if (!Number.isFinite(rate) || rate <= 0) {
            console.warn(`[Backfill] ${dateStr}: No published rate (market closed or unavailable)`);
            failed++;
            continue;
          }

          db.prepare(`
            INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
            VALUES ('TRY', 'USD', ?, ?, ?)
          `).run(rate, dateStr, 'frankfurter');

          console.log(`[Backfill] ${dateStr}: TRY→USD = ${rate.toFixed(6)} (frankfurter)`);
          fetched++;
        }
      }
    } catch (err) {
      console.error(`[Backfill] Frankfurter fetch error: ${err.message}`);
      failed = missingDates.length;
    }
  } else {
    for (const dateStr of missingDates) {
      if (calls >= MAX_CALLS) {
        console.log(`[Backfill] Reached max API calls (${MAX_CALLS}). Stopping.`);
        break;
      }

      try {
        let tryToUsd = null;
        let source = null;

        if (provider === 'apilayer') {
          const url = `https://api.exchangeratesapi.io/v1/${dateStr}?access_key=${APILAYER_EXCHANGE_RATES_KEY}&symbols=USD,TRY`;
          const res = await fetch(url);
          calls += 1;
          if (res.status === 429) {
            console.error('[Backfill] APILayer quota reached. Stopping.');
            break;
          }
          if (!res.ok) {
            console.error(`[Backfill] ${dateStr}: APILayer request failed (${res.status})`);
            failed++;
            continue;
          }

          const data = await res.json();
          if (data?.success === false) {
            console.error(`[Backfill] ${dateStr}: APILayer error - ${data?.error?.info || data?.error?.type || 'Unknown error'}`);
            failed++;
            continue;
          }

          const usdRate = parseFloat(data?.rates?.USD);
          const tryRate = parseFloat(data?.rates?.TRY);
          if (Number.isFinite(usdRate) && Number.isFinite(tryRate) && tryRate > 0) {
            tryToUsd = usdRate / tryRate;
            source = 'apilayer';
          } else {
            console.error(`[Backfill] ${dateStr}: APILayer response missing USD/TRY rates`);
            failed++;
            continue;
          }
        } else if (provider === 'oxr') {
          const url = `https://openexchangerates.org/api/historical/${dateStr}.json?app_id=${OXR_APP_ID}&symbols=TRY`;
          const res = await fetch(url);
          calls += 1;
          if (res.status === 429) {
            console.error('[Backfill] OXR quota reached. Stopping.');
            break;
          }
          if (!res.ok) {
            console.error(`[Backfill] ${dateStr}: OXR request failed (${res.status})`);
            failed++;
            continue;
          }

          const data = await res.json();
          if (data.error) {
            console.error(`[Backfill] ${dateStr}: OXR error - ${data.message || data.description}`);
            failed++;
            continue;
          }

          if (data.rates?.TRY) {
            tryToUsd = 1 / data.rates.TRY;
            source = 'oxr';
          } else {
            console.error(`[Backfill] ${dateStr}: No TRY rate in OXR response`);
            failed++;
            continue;
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

        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`[Backfill] ${dateStr}: Fetch error - ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`
[Backfill] Complete!`);
  console.log(`  Fetched: ${fetched}`);
  console.log(`  Skipped (already existed): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total API calls used: ${calls}`);
  console.log(`  Max API calls allowed: ${MAX_CALLS}`);
}

backfill(60);
