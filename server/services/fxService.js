import fetch from 'node-fetch';
import { getDb } from '../db/database.js';

export const FX_PAIR = 'USD_TRY';
export const DEFAULT_USD_TRY = parseFloat(process.env.DEFAULT_USD_TRY || '42.6');

const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=TRY';
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

let schedulerStarted = false;

function getCachedRate() {
  const db = getDb();
  return db
    .prepare(`SELECT pair, rate, as_of_date, fetched_at, source FROM fx_rates WHERE pair = ?`)
    .get(FX_PAIR);
}

function saveRate(record) {
  const db = getDb();
  db.prepare(`
    INSERT INTO fx_rates (pair, rate, as_of_date, fetched_at, source)
    VALUES (@pair, @rate, @as_of_date, @fetched_at, @source)
    ON CONFLICT(pair) DO UPDATE SET
      rate = excluded.rate,
      as_of_date = excluded.as_of_date,
      fetched_at = excluded.fetched_at,
      source = excluded.source
  `).run(record);
}

function buildDefaultRecord() {
  return {
    pair: FX_PAIR,
    rate: DEFAULT_USD_TRY,
    as_of_date: null,
    fetched_at: new Date().toISOString(),
    source: 'default'
  };
}

async function fetchFrankfurterRate() {
  const response = await fetch(FRANKFURTER_URL);
  if (!response.ok) {
    throw new Error(`Frankfurter response ${response.status}`);
  }

  const data = await response.json();
  const rate = data?.rates?.TRY;

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Invalid TRY rate from Frankfurter');
  }

  return {
    pair: FX_PAIR,
    rate: Number(rate),
    as_of_date: data?.date || null,
    fetched_at: new Date().toISOString(),
    source: 'frankfurter'
  };
}

function formatQuote(record) {
  const fetchedAtMs = record?.fetched_at ? Date.parse(record.fetched_at) : null;
  const ageSeconds = fetchedAtMs ? Math.floor((Date.now() - fetchedAtMs) / 1000) : null;
  const stale =
    record?.source === 'default' ||
    !ageSeconds ||
    ageSeconds * 1000 > STALE_THRESHOLD_MS;

  return {
    base: 'USD',
    quote: 'TRY',
    pair: FX_PAIR,
    rate: Number(record?.rate || DEFAULT_USD_TRY),
    as_of_date: record?.as_of_date || null,
    fetched_at: record?.fetched_at || null,
    age_seconds: ageSeconds,
    stale,
    source: record?.source || 'default'
  };
}

export function getUsdTryQuote() {
  const cached = getCachedRate();
  if (cached && Number.isFinite(cached.rate) && cached.rate > 0) {
    return formatQuote(cached);
  }

  const fallback = buildDefaultRecord();
  saveRate(fallback);
  return formatQuote(fallback);
}

export function getUsdTryRateValue() {
  const quote = getUsdTryQuote();
  const rate = Number(quote.rate);
  if (!Number.isFinite(rate) || rate <= 0) return DEFAULT_USD_TRY;
  return rate;
}

export function convertUsdToTry(amount, usdTryRate) {
  const rate = usdTryRate || getUsdTryRateValue();
  const value = Number(amount) || 0;
  if (!Number.isFinite(rate) || rate <= 0) return value * DEFAULT_USD_TRY;
  return value * rate;
}

export function convertTryToUsd(amount, usdTryRate) {
  const rate = usdTryRate || getUsdTryRateValue();
  const value = Number(amount) || 0;
  if (!Number.isFinite(rate) || rate <= 0) return value / DEFAULT_USD_TRY;
  return value / rate;
}

export async function refreshUsdTryRate() {
  try {
    const record = await fetchFrankfurterRate();
    saveRate(record);
    console.log(`[FX] USD_TRY refreshed from Frankfurter at rate ${record.rate}`);
    return formatQuote(record);
  } catch (error) {
    console.warn(`[FX] Failed to refresh USD_TRY: ${error.message}`);
    const cached = getCachedRate();
    if (cached) {
      return formatQuote(cached);
    }

    const fallback = buildDefaultRecord();
    saveRate(fallback);
    return formatQuote(fallback);
  }
}

export function startUsdTryScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Immediate attempt on startup (non-blocking)
  refreshUsdTryRate();

  // Scheduled refresh
  setInterval(() => {
    refreshUsdTryRate();
  }, REFRESH_INTERVAL_MS);
}

export function getFxDebugInfo() {
  return {
    usd_try: getUsdTryQuote()
  };
}
