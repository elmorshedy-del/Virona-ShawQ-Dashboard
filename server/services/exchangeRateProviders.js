import fetch from 'node-fetch';
import { getDb } from '../db/database.js';

function parsePositiveNumber(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
  }
  return { res, json, text };
}

function logApiUsage({ provider, kind, status, httpStatus, date = null, startDate = null, endDate = null, errorCode = null, errorMessage = null }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO exchange_rate_api_usage (
        provider, kind, date, start_date, end_date, status, http_status, error_code, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(provider, kind, date, startDate, endDate, status, httpStatus, errorCode, errorMessage);
  } catch (e) {
    // Best-effort only; never break app flow on logging.
  }
}

function ok(provider, kind, tryToUsd, extra = {}) {
  return { ok: true, provider, kind, tryToUsd, ...extra };
}

function err(provider, kind, status, code, message, extra = {}) {
  return { ok: false, provider, kind, status, code, message, ...extra };
}

export async function fetchCurrencyFreaksLatestTryToUsdRate() {
  const apiKey = process.env.CURRENCYFREAKS_API_KEY;
  if (!apiKey) {
    return err('currencyfreaks', 'latest', null, 'missing_api_key', 'CurrencyFreaks API key is not configured.');
  }

  const url = `https://api.currencyfreaks.com/v2.0/rates/latest?apikey=${apiKey}&symbols=TRY`;

  try {
    const { res, json } = await fetchJson(url);

    let result;
    if (res.status === 429) {
      result = err('currencyfreaks', 'latest', 429, 'quota_reached', 'CurrencyFreaks quota reached.');
    } else if (!res.ok) {
      const msg = json?.message || json?.error || `CurrencyFreaks request failed (HTTP ${res.status}).`;
      result = err('currencyfreaks', 'latest', res.status, 'http_error', msg);
    } else {
      const usdToTry = parsePositiveNumber(json?.rates?.TRY);
      if (!usdToTry) {
        result = err('currencyfreaks', 'latest', res.status, 'invalid_response', 'CurrencyFreaks response was missing TRY rate.');
      } else {
        result = ok('currencyfreaks', 'latest', 1 / usdToTry, { source: 'currencyfreaks' });
      }
    }

    logApiUsage({
      provider: 'currencyfreaks',
      kind: 'latest',
      status: result.ok ? 'success' : 'error',
      httpStatus: res.status,
      errorCode: result.ok ? null : result.code,
      errorMessage: result.ok ? null : result.message
    });

    return result;
  } catch (e) {
    const result = err('currencyfreaks', 'latest', null, 'network_error', `CurrencyFreaks request failed: ${e.message}`);
    logApiUsage({
      provider: 'currencyfreaks',
      kind: 'latest',
      status: 'error',
      httpStatus: null,
      errorCode: result.code,
      errorMessage: result.message
    });
    return result;
  }
}

export async function fetchCurrencyFreaksHistoricalTryToUsdRate(dateStr) {
  const apiKey = process.env.CURRENCYFREAKS_API_KEY;
  if (!apiKey) {
    return err('currencyfreaks', 'historical', null, 'missing_api_key', 'CurrencyFreaks API key is not configured.');
  }

  const url = `https://api.currencyfreaks.com/v2.0/rates/historical?apikey=${apiKey}&date=${dateStr}&symbols=TRY`;

  try {
    const { res, json } = await fetchJson(url);

    let result;
    if (res.status === 429) {
      result = err('currencyfreaks', 'historical', 429, 'quota_reached', 'CurrencyFreaks quota reached.');
    } else if (!res.ok) {
      const msg = json?.message || json?.error || `CurrencyFreaks request failed (HTTP ${res.status}).`;
      result = err('currencyfreaks', 'historical', res.status, 'http_error', msg);
    } else {
      const usdToTry = parsePositiveNumber(json?.rates?.TRY);
      if (!usdToTry) {
        result = err('currencyfreaks', 'historical', res.status, 'invalid_response', 'CurrencyFreaks response was missing TRY rate.');
      } else {
        result = ok('currencyfreaks', 'historical', 1 / usdToTry, { source: 'currencyfreaks' });
      }
    }

    logApiUsage({
      provider: 'currencyfreaks',
      kind: 'historical',
      status: result.ok ? 'success' : 'error',
      httpStatus: res.status,
      date: dateStr,
      errorCode: result.ok ? null : result.code,
      errorMessage: result.ok ? null : result.message
    });

    return result;
  } catch (e) {
    const result = err('currencyfreaks', 'historical', null, 'network_error', `CurrencyFreaks request failed: ${e.message}`);
    logApiUsage({
      provider: 'currencyfreaks',
      kind: 'historical',
      status: 'error',
      httpStatus: null,
      date: dateStr,
      errorCode: result.code,
      errorMessage: result.message
    });
    return result;
  }
}

export async function fetchCurrencyFreaksTimeseriesTryToUsdRates(startDate, endDate) {
  const apiKey = process.env.CURRENCYFREAKS_API_KEY;
  if (!apiKey) {
    return err('currencyfreaks', 'timeseries', null, 'missing_api_key', 'CurrencyFreaks API key is not configured.');
  }

  const url = `https://api.currencyfreaks.com/v2.0/timeseries?apikey=${apiKey}&startDate=${startDate}&endDate=${endDate}&symbols=TRY`;

  try {
    const { res, json } = await fetchJson(url);

    let result;
    if (res.status === 429) {
      result = err('currencyfreaks', 'timeseries', 429, 'quota_reached', 'CurrencyFreaks quota reached.');
    } else if (!res.ok) {
      const msg = json?.message || json?.error || `CurrencyFreaks request failed (HTTP ${res.status}).`;
      result = err('currencyfreaks', 'timeseries', res.status, 'http_error', msg);
    } else {
      const rates = json?.rates;
      if (!rates || typeof rates !== 'object') {
        result = err('currencyfreaks', 'timeseries', res.status, 'invalid_response', 'CurrencyFreaks timeseries response was missing rates.');
      } else {
        const out = new Map();
        // Expected shape: {"YYYY-MM-DD": {"TRY": ".."}, ...}
        for (const [dateStr, dayRates] of Object.entries(rates)) {
          const usdToTry = parsePositiveNumber(dayRates?.TRY);
          if (!usdToTry) continue;
          out.set(dateStr, 1 / usdToTry);
        }
        result = {
          ok: true,
          provider: 'currencyfreaks',
          kind: 'timeseries',
          source: 'currencyfreaks',
          ratesByDate: out
        };
      }
    }

    logApiUsage({
      provider: 'currencyfreaks',
      kind: 'timeseries',
      status: result.ok ? 'success' : 'error',
      httpStatus: res.status,
      startDate,
      endDate,
      errorCode: result.ok ? null : result.code,
      errorMessage: result.ok ? null : result.message
    });

    return result;
  } catch (e) {
    const result = err('currencyfreaks', 'timeseries', null, 'network_error', `CurrencyFreaks request failed: ${e.message}`);
    logApiUsage({
      provider: 'currencyfreaks',
      kind: 'timeseries',
      status: 'error',
      httpStatus: null,
      startDate,
      endDate,
      errorCode: result.code,
      errorMessage: result.message
    });
    return result;
  }
}

export async function fetchOXRHistoricalTryToUsdRate(dateStr) {
  const apiKey = process.env.OXR_APP_ID;
  if (!apiKey) {
    return err('oxr', 'historical', null, 'missing_api_key', 'Open Exchange Rates (OXR) app id is not configured.');
  }

  const url = `https://openexchangerates.org/api/historical/${dateStr}.json?app_id=${apiKey}&symbols=TRY`;

  try {
    const { res, json } = await fetchJson(url);

    let result;
    if (res.status === 429) {
      result = err('oxr', 'historical', 429, 'quota_reached', 'Open Exchange Rates quota reached.');
    } else if (!res.ok) {
      const msg = json?.message || json?.description || `OXR request failed (HTTP ${res.status}).`;
      result = err('oxr', 'historical', res.status, 'http_error', msg);
    } else if (json?.error) {
      const msg = json?.message || json?.description || 'OXR returned an error.';
      result = err('oxr', 'historical', res.status, 'provider_error', msg, { providerError: json });
    } else {
      const usdToTry = parsePositiveNumber(json?.rates?.TRY);
      if (!usdToTry) {
        result = err('oxr', 'historical', res.status, 'invalid_response', 'OXR response was missing TRY rate.');
      } else {
        result = ok('oxr', 'historical', 1 / usdToTry, { source: 'oxr' });
      }
    }

    logApiUsage({
      provider: 'oxr',
      kind: 'historical',
      status: result.ok ? 'success' : 'error',
      httpStatus: res.status,
      date: dateStr,
      errorCode: result.ok ? null : result.code,
      errorMessage: result.ok ? null : result.message
    });

    return result;
  } catch (e) {
    const result = err('oxr', 'historical', null, 'network_error', `OXR request failed: ${e.message}`);
    logApiUsage({
      provider: 'oxr',
      kind: 'historical',
      status: 'error',
      httpStatus: null,
      date: dateStr,
      errorCode: result.code,
      errorMessage: result.message
    });
    return result;
  }
}

export async function fetchApilayerHistoricalTryToUsdRate(dateStr) {
  const apiKey = process.env.APILAYER_EXCHANGE_RATES_KEY;
  if (!apiKey) {
    return err('apilayer', 'historical', null, 'missing_api_key', 'APILayer access key is not configured.');
  }

  const url = `https://api.exchangeratesapi.io/v1/${dateStr}?access_key=${apiKey}&symbols=USD,TRY`;

  try {
    const { res, json } = await fetchJson(url);

    let result;
    if (res.status === 429) {
      result = err('apilayer', 'historical', 429, 'quota_reached', 'APILayer quota reached.');
    } else if (!res.ok) {
      const msg = json?.message || json?.error?.info || json?.error?.type || `APILayer request failed (HTTP ${res.status}).`;
      result = err('apilayer', 'historical', res.status, 'http_error', msg, { providerError: json?.error || json });
    } else if (json?.success === false) {
      const msg = json?.error?.info || json?.error?.type || 'APILayer returned an error.';
      result = err('apilayer', 'historical', res.status, 'provider_error', msg, { providerError: json?.error || json });
    } else {
      const usdRate = parsePositiveNumber(json?.rates?.USD);
      const tryRate = parsePositiveNumber(json?.rates?.TRY);
      if (!usdRate || !tryRate) {
        result = err('apilayer', 'historical', res.status, 'invalid_response', 'APILayer response was missing USD/TRY rates.');
      } else {
        result = ok('apilayer', 'historical', usdRate / tryRate, { source: 'apilayer' });
      }
    }

    logApiUsage({
      provider: 'apilayer',
      kind: 'historical',
      status: result.ok ? 'success' : 'error',
      httpStatus: res.status,
      date: dateStr,
      errorCode: result.ok ? null : result.code,
      errorMessage: result.ok ? null : result.message
    });

    return result;
  } catch (e) {
    const result = err('apilayer', 'historical', null, 'network_error', `APILayer request failed: ${e.message}`);
    logApiUsage({
      provider: 'apilayer',
      kind: 'historical',
      status: 'error',
      httpStatus: null,
      date: dateStr,
      errorCode: result.code,
      errorMessage: result.message
    });
    return result;
  }
}

export async function fetchFrankfurterTryToUsdRate(dateStr) {
  const url = `https://api.frankfurter.app/${dateStr}?from=TRY&to=USD`;

  try {
    const { res, json } = await fetchJson(url);

    let result;
    if (!res.ok) {
      result = err('frankfurter', 'historical', res.status, 'http_error', `Frankfurter request failed (HTTP ${res.status}).`);
    } else if (json?.date !== dateStr) {
      // Frankfurter (ECB) returns closest business day when date has no published rate.
      result = err('frankfurter', 'historical', res.status, 'rate_unavailable', 'No published rate for this date (market closed or unavailable).');
    } else {
      const rate = parsePositiveNumber(json?.rates?.USD);
      if (!rate) {
        result = err('frankfurter', 'historical', res.status, 'invalid_response', 'Frankfurter response was missing USD rate.');
      } else {
        result = ok('frankfurter', 'historical', rate, { source: 'frankfurter' });
      }
    }

    logApiUsage({
      provider: 'frankfurter',
      kind: 'historical',
      status: result.ok ? 'success' : 'error',
      httpStatus: res.status,
      date: dateStr,
      errorCode: result.ok ? null : result.code,
      errorMessage: result.ok ? null : result.message
    });

    return result;
  } catch (e) {
    const result = err('frankfurter', 'historical', null, 'network_error', `Frankfurter request failed: ${e.message}`);
    logApiUsage({
      provider: 'frankfurter',
      kind: 'historical',
      status: 'error',
      httpStatus: null,
      date: dateStr,
      errorCode: result.code,
      errorMessage: result.message
    });
    return result;
  }
}
