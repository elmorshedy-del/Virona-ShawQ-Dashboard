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

function coerceProvider(name, label) {
  if (!name) return null;
  if (!SUPPORTED_EXCHANGE_RATE_PROVIDERS.includes(name)) {
    console.warn(`[Exchange] ${label} provider "${name}" is not supported. Allowed: ${SUPPORTED_EXCHANGE_RATE_PROVIDERS.join(', ')}`);
    return null;
  }
  return name;
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
  const dailyEnv = normalizeProvider(process.env.EXCHANGE_RATE_DAILY_PROVIDER);
  let dailyProvider = 'currencyfreaks';
  let dailySource = dailyEnv ? 'env' : 'default';

  const coercedDaily = coerceProvider(dailyEnv, 'daily');
  if (coercedDaily) {
    dailyProvider = coercedDaily;
  } else if (dailyEnv) {
    dailySource = 'env_invalid';
  }

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

  const primaryBackfillProviderRaw = primaryConfigured || inferredPrimary;
  const primaryBackfillProvider = coerceProvider(primaryBackfillProviderRaw, 'primary backfill');
  let primarySource = primaryConfigured ? 'env' : (inferredPrimary ? 'inferred' : 'none');
  if (primaryConfigured && !primaryBackfillProvider) primarySource = 'env_invalid';

  const secondaryConfigured = normalizeProvider(process.env.EXCHANGE_RATE_BACKFILL_SECONDARY_PROVIDER);

  // If no explicit secondary is set, prefer OXR when available and not already primary.
  const inferredSecondary =
    !secondaryConfigured && process.env.OXR_APP_ID && primaryBackfillProvider !== 'oxr'
      ? 'oxr'
      : null;

  const secondaryBackfillProviderRaw = secondaryConfigured || inferredSecondary;
  const secondaryBackfillProvider = coerceProvider(secondaryBackfillProviderRaw, 'secondary backfill');
  let secondarySource = secondaryConfigured ? 'env' : (inferredSecondary ? 'inferred' : 'none');
  if (secondaryConfigured && !secondaryBackfillProvider) secondarySource = 'env_invalid';

  const sources = {
    daily: dailySource,
    primaryBackfill: primarySource,
    secondaryBackfill: secondarySource
  };

  return {
    supportedProviders: SUPPORTED_EXCHANGE_RATE_PROVIDERS,
    dailyProvider,
    primaryBackfillProvider: primaryBackfillProvider || null,
    secondaryBackfillProvider: secondaryBackfillProvider || null,
    sources,
    configured: {
      currencyfreaks: Boolean(process.env.CURRENCYFREAKS_API_KEY),
      oxr: Boolean(process.env.OXR_APP_ID),
      apilayer: Boolean(process.env.APILAYER_EXCHANGE_RATES_KEY),
      frankfurter: true
    }
  };
}
