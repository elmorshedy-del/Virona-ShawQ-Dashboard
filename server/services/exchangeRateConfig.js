const SUPPORTED_EXCHANGE_RATE_PROVIDERS = ['currencyfreaks', 'oxr', 'apilayer', 'frankfurter'];

function normalizeProvider(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (!v || v === 'none' || v === 'null' || v === 'false') return null;

  // Allow common aliases and minor typos in env vars (Railway UI is easy to mis-type).
  if (v === 'frankfurt' || v === 'frankfurter') return 'frankfurter';
  if (v === 'openexchangerates' || v === 'open-exchange-rates' || v === 'open_exchange_rates') return 'oxr';
  if (v === 'currency-freaks' || v === 'currency_freaks' || v === 'currencyfreak') return 'currencyfreaks';

  return v;
}

export function isSupportedExchangeRateProvider(provider) {
  return SUPPORTED_EXCHANGE_RATE_PROVIDERS.includes(provider);
}

export function isExchangeRateProviderConfigured(provider) {
  if (!provider) return false;
  if (provider === 'currencyfreaks') return Boolean(process.env.CURRENCYFREAKS_API_KEY);
  if (provider === 'oxr') return Boolean(process.env.OXR_APP_ID);
  if (provider === 'apilayer') return Boolean(process.env.APILAYER_EXCHANGE_RATES_KEY);
  if (provider === 'frankfurter') return true;
  return false;
}

export function resolveExchangeRateProviders() {
  const dailyProvider = normalizeProvider(process.env.EXCHANGE_RATE_DAILY_PROVIDER) || 'currencyfreaks';

  // Backfill providers:
  // - Primary: explicitly configured or inferred from available keys.
  // - Secondary: optional fallback when primary is unavailable for a date.
  const primaryConfigured =
    normalizeProvider(process.env.EXCHANGE_RATE_BACKFILL_PRIMARY_PROVIDER) ||
    normalizeProvider(process.env.EXCHANGE_RATE_BACKFILL_PROVIDER) ||
    normalizeProvider(process.env.EXCHANGE_RATE_HISTORICAL_PROVIDER);

  const inferredPrimary =
    (process.env.CURRENCYFREAKS_API_KEY && 'currencyfreaks') ||
    (process.env.APILAYER_EXCHANGE_RATES_KEY && 'apilayer') ||
    (process.env.OXR_APP_ID && 'oxr') ||
    null;

  const primaryBackfillProvider = primaryConfigured || inferredPrimary;

  const secondaryConfigured = normalizeProvider(process.env.EXCHANGE_RATE_BACKFILL_SECONDARY_PROVIDER);

  // If no explicit secondary is set, prefer OXR when available and not already primary.
  const inferredSecondary =
    !secondaryConfigured && process.env.OXR_APP_ID && primaryBackfillProvider !== 'oxr'
      ? 'oxr'
      : null;

  const secondaryBackfillProvider = secondaryConfigured || inferredSecondary;

  return {
    supportedProviders: SUPPORTED_EXCHANGE_RATE_PROVIDERS,
    dailyProvider,
    primaryBackfillProvider,
    secondaryBackfillProvider,
    configured: {
      currencyfreaks: Boolean(process.env.CURRENCYFREAKS_API_KEY),
      oxr: Boolean(process.env.OXR_APP_ID),
      apilayer: Boolean(process.env.APILAYER_EXCHANGE_RATES_KEY),
      frankfurter: true
    }
  };
}
