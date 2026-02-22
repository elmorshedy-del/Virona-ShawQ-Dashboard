import { getCountryInfo } from '../utils/countryData.js';

const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v18';
const GOOGLE_ADS_BASE_URL =
  process.env.GOOGLE_ADS_API_BASE_URL || `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GOOGLE_OAUTH_TOKEN_URL =
  process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';

const MICROS_PER_CURRENCY_UNIT = 1_000_000;
const ACCESS_TOKEN_CACHE_TTL_MS = 55 * 60 * 1000;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.GOOGLE_ADS_REQUEST_TIMEOUT_MS || '20000', 10);
const GEO_TARGET_LOOKUP_CHUNK_SIZE = 100;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTED_BREAKDOWNS = new Set(['none', 'country']);

const REQUIRED_CONFIG_KEYS = Object.freeze([
  'customerId',
  'developerToken',
  'refreshToken',
  'clientId',
  'clientSecret'
]);

const GOOGLE_STATUS_TO_META_STATUS = Object.freeze({
  ENABLED: 'ACTIVE',
  PAUSED: 'PAUSED',
  REMOVED: 'ARCHIVED'
});

const accessTokenCache = new Map();

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function microsToCurrency(value) {
  return toFiniteNumber(value) / MICROS_PER_CURRENCY_UNIT;
}

function normalizeStorePrefix(store) {
  return String(store || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');
}

function getStoreScopedEnv(store, baseKey) {
  const scopedKey = `${normalizeStorePrefix(store)}_${baseKey}`;
  return process.env[scopedKey] || process.env[baseKey] || '';
}

function sanitizeCustomerId(customerId) {
  return String(customerId || '').replace(/[^0-9]/g, '');
}

function resolveGoogleAdsConfig(store) {
  const config = {
    customerId: sanitizeCustomerId(getStoreScopedEnv(store, 'GOOGLE_ADS_CUSTOMER_ID')),
    developerToken: String(getStoreScopedEnv(store, 'GOOGLE_ADS_DEVELOPER_TOKEN') || '').trim(),
    refreshToken: String(getStoreScopedEnv(store, 'GOOGLE_ADS_REFRESH_TOKEN') || '').trim(),
    clientId: String(getStoreScopedEnv(store, 'GOOGLE_ADS_CLIENT_ID') || '').trim(),
    clientSecret: String(getStoreScopedEnv(store, 'GOOGLE_ADS_CLIENT_SECRET') || '').trim(),
    loginCustomerId: sanitizeCustomerId(getStoreScopedEnv(store, 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'))
  };

  const missing = REQUIRED_CONFIG_KEYS.filter((key) => !config[key]);
  return {
    ...config,
    configured: missing.length === 0,
    missing
  };
}

function isValidDateValue(value) {
  return DATE_PATTERN.test(String(value || ''));
}

function escapeGaqlValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function resolveMetaStyleStatus(googleStatus) {
  const status = String(googleStatus || '').toUpperCase();
  return GOOGLE_STATUS_TO_META_STATUS[status] || 'UNKNOWN';
}

function parseGoogleCampaignFilter(campaignId) {
  const raw = String(campaignId || '').trim();
  if (!raw) {
    return { skipGoogle: false, googleCampaignId: null };
  }

  if (!raw.startsWith('google:')) {
    return { skipGoogle: true, googleCampaignId: null };
  }

  const numericId = raw.slice('google:'.length).replace(/[^0-9]/g, '');
  if (!numericId) {
    return { skipGoogle: true, googleCampaignId: null };
  }

  return { skipGoogle: false, googleCampaignId: numericId };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (_error) {
        body = { raw: text };
      }
    }
    return { response, body };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getTokenCacheKey(config) {
  return [config.customerId, config.clientId].join(':');
}

function getCachedAccessToken(cacheKey) {
  const cached = accessTokenCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > ACCESS_TOKEN_CACHE_TTL_MS) {
    accessTokenCache.delete(cacheKey);
    return null;
  }
  return cached.token;
}

function cacheAccessToken(cacheKey, token) {
  accessTokenCache.set(cacheKey, {
    token,
    createdAt: Date.now()
  });
}

async function getGoogleAccessToken(config) {
  const cacheKey = getTokenCacheKey(config);
  const cachedToken = getCachedAccessToken(cacheKey);
  if (cachedToken) {
    return cachedToken;
  }

  const payload = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken
  });

  const { response, body } = await fetchJsonWithTimeout(
    GOOGLE_OAUTH_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: payload.toString()
    }
  );

  if (!response.ok || !body?.access_token) {
    const reason = body?.error_description || body?.error || `HTTP ${response.status}`;
    throw new Error(`OAuth token exchange failed (${reason})`);
  }

  cacheAccessToken(cacheKey, body.access_token);
  return body.access_token;
}

function parseSearchStreamRows(payload) {
  const batches = Array.isArray(payload) ? payload : [payload];
  const rows = [];

  batches.forEach((batch) => {
    if (Array.isArray(batch?.results)) {
      rows.push(...batch.results);
    }
  });

  return rows;
}

async function runGaqlSearch(config, accessToken, query) {
  const endpoint = `${GOOGLE_ADS_BASE_URL}/customers/${config.customerId}/googleAds:searchStream`;
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    'content-type': 'application/json'
  };

  if (config.loginCustomerId) {
    headers['login-customer-id'] = config.loginCustomerId;
  }

  const { response, body } = await fetchJsonWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query })
    }
  );

  if (!response.ok) {
    const apiMessage =
      body?.error?.message ||
      body?.error?.details?.[0]?.message ||
      `HTTP ${response.status}`;
    throw new Error(`Google Ads query failed (${apiMessage})`);
  }

  return parseSearchStreamRows(body);
}

function buildCampaignQuery({ startDate, endDate, includeInactive, googleCampaignId }) {
  const where = [
    `segments.date BETWEEN '${escapeGaqlValue(startDate)}' AND '${escapeGaqlValue(endDate)}'`
  ];

  if (includeInactive) {
    where.push("campaign.status != 'REMOVED'");
  } else {
    where.push("campaign.status = 'ENABLED'");
  }

  if (googleCampaignId) {
    where.push(`campaign.id = ${Number.parseInt(googleCampaignId, 10)}`);
  }

  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE ${where.join(' AND ')}
  `.trim();
}

function buildCountryBreakdownQuery({ startDate, endDate, includeInactive, googleCampaignId }) {
  const where = [
    `segments.date BETWEEN '${escapeGaqlValue(startDate)}' AND '${escapeGaqlValue(endDate)}'`,
    'segments.geo_target_country IS NOT NULL'
  ];

  if (includeInactive) {
    where.push("campaign.status != 'REMOVED'");
  } else {
    where.push("campaign.status = 'ENABLED'");
  }

  if (googleCampaignId) {
    where.push(`campaign.id = ${Number.parseInt(googleCampaignId, 10)}`);
  }

  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      segments.geo_target_country,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE ${where.join(' AND ')}
  `.trim();
}

function buildGeoTargetLookupQuery(resourceNames = []) {
  const quoted = resourceNames
    .map((name) => `'${escapeGaqlValue(name)}'`)
    .join(', ');

  return `
    SELECT
      geo_target_constant.resource_name,
      geo_target_constant.country_code
    FROM geo_target_constant
    WHERE geo_target_constant.resource_name IN (${quoted})
  `.trim();
}

function buildGoogleCampaignNode(campaign) {
  const rawCampaignId = String(campaign?.id || '').trim();
  const mappedStatus = resolveMetaStyleStatus(campaign?.status);

  return {
    campaign_id: `google:${rawCampaignId}`,
    campaign_name: campaign?.name || `Google Campaign ${rawCampaignId}`,
    status: mappedStatus,
    effective_status: mappedStatus,
    isActive: mappedStatus === 'ACTIVE',
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    inline_link_clicks: 0,
    outbound_clicks: null,
    unique_outbound_clicks: null,
    lpv: null,
    atc: null,
    checkout: null,
    conversions: 0,
    conversion_value: 0,
    cost_per_inline_link_click: null,
    level: 'campaign',
    data_source: 'Google Ads',
    provider: 'google',
    adsets: [],
    country_breakdowns: []
  };
}

function applyGoogleMetrics(target, metrics) {
  target.spend += microsToCurrency(metrics?.costMicros);
  target.impressions += toFiniteNumber(metrics?.impressions);
  target.clicks += toFiniteNumber(metrics?.clicks);
  target.inline_link_clicks += toFiniteNumber(metrics?.clicks);
  target.conversions += toFiniteNumber(metrics?.conversions);
  target.conversion_value += toFiniteNumber(metrics?.conversionsValue);
}

function finalizeGoogleMetrics(target) {
  if (target.inline_link_clicks > 0) {
    target.cost_per_inline_link_click = target.spend / target.inline_link_clicks;
  } else {
    target.cost_per_inline_link_click = null;
  }
  return target;
}

function toCountryCodeFromResource(resourceName, lookupMap) {
  const resource = String(resourceName || '').trim();
  if (!resource) return null;
  const fromLookup = String(lookupMap.get(resource) || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(fromLookup)) {
    return fromLookup;
  }
  return null;
}

function buildUnknownCountryLabel(resourceName) {
  const parts = String(resourceName || '').split('/');
  const suffix = parts[parts.length - 1] || 'unknown';
  return `UNKNOWN-${suffix}`;
}

async function lookupGeoTargetCountryCodes(config, accessToken, resourceNames = []) {
  const uniqueNames = Array.from(new Set(resourceNames.filter(Boolean)));
  const countryMap = new Map();

  for (let i = 0; i < uniqueNames.length; i += GEO_TARGET_LOOKUP_CHUNK_SIZE) {
    const chunk = uniqueNames.slice(i, i + GEO_TARGET_LOOKUP_CHUNK_SIZE);
    if (!chunk.length) continue;

    try {
      const query = buildGeoTargetLookupQuery(chunk);
      const rows = await runGaqlSearch(config, accessToken, query);

      rows.forEach((row) => {
        const resourceName = row?.geoTargetConstant?.resourceName;
        const countryCode = row?.geoTargetConstant?.countryCode;
        if (resourceName && countryCode) {
          countryMap.set(resourceName, countryCode);
        }
      });
    } catch (error) {
      console.warn(`[GoogleAds] Geo target lookup failed: ${error?.message || error}`);
      return countryMap;
    }
  }

  return countryMap;
}

export async function fetchGoogleCampaignHierarchy({
  store,
  startDate,
  endDate,
  breakdown = 'none',
  includeInactive = false,
  campaignId = null
}) {
  if (!isValidDateValue(startDate) || !isValidDateValue(endDate)) {
    return { data: [], notice: 'Google Ads fetch skipped due to invalid date range.' };
  }

  const filter = parseGoogleCampaignFilter(campaignId);
  if (filter.skipGoogle) {
    return { data: [], notice: '' };
  }

  if (!SUPPORTED_BREAKDOWNS.has(breakdown)) {
    return { data: [], notice: 'Google Ads currently supports No Breakdown and By Country in Unified Campaign.' };
  }

  const config = resolveGoogleAdsConfig(store);
  if (!config.configured) {
    return { data: [], notice: `Google Ads credentials are not configured for store "${store}".` };
  }

  try {
    const accessToken = await getGoogleAccessToken(config);

    if (breakdown === 'country') {
      const countryRows = await runGaqlSearch(
        config,
        accessToken,
        buildCountryBreakdownQuery({
          startDate,
          endDate,
          includeInactive,
          googleCampaignId: filter.googleCampaignId
        })
      );

      if (!countryRows.length) {
        return { data: [], notice: '' };
      }

      const geoResources = countryRows
        .map((row) => row?.segments?.geoTargetCountry)
        .filter(Boolean);
      const geoCountryCodeMap = await lookupGeoTargetCountryCodes(config, accessToken, geoResources);

      const campaignMap = new Map();
      const campaignCountryMap = new Map();

      countryRows.forEach((row) => {
        const campaignIdValue = String(row?.campaign?.id || '').trim();
        if (!campaignIdValue) return;

        const prefixedCampaignId = `google:${campaignIdValue}`;
        if (!campaignMap.has(prefixedCampaignId)) {
          campaignMap.set(prefixedCampaignId, buildGoogleCampaignNode(row.campaign));
        }

        const campaignNode = campaignMap.get(prefixedCampaignId);
        applyGoogleMetrics(campaignNode, row.metrics);

        const countryCode = toCountryCodeFromResource(row?.segments?.geoTargetCountry, geoCountryCodeMap);
        const countryKey = countryCode || buildUnknownCountryLabel(row?.segments?.geoTargetCountry);
        if (!campaignCountryMap.has(prefixedCampaignId)) {
          campaignCountryMap.set(prefixedCampaignId, new Map());
        }

        const perCampaignCountries = campaignCountryMap.get(prefixedCampaignId);
        if (!perCampaignCountries.has(countryKey)) {
          const info = countryCode ? getCountryInfo(countryCode) : null;
          perCampaignCountries.set(countryKey, {
            campaign_id: prefixedCampaignId,
            campaign_name: campaignNode.campaign_name,
            country: countryCode || countryKey,
            countryName: info?.name || 'Unknown Country',
            spend: 0,
            impressions: 0,
            reach: 0,
            clicks: 0,
            inline_link_clicks: 0,
            outbound_clicks: null,
            unique_outbound_clicks: null,
            lpv: null,
            atc: null,
            checkout: null,
            conversions: 0,
            conversion_value: 0,
            cost_per_inline_link_click: null,
            data_source: 'Google Ads',
            provider: 'google',
            level: 'breakdown',
            lastOrderDate: null
          });
        }

        const countryNode = perCampaignCountries.get(countryKey);
        applyGoogleMetrics(countryNode, row.metrics);
      });

      const finalizedCampaigns = Array.from(campaignMap.values())
        .map((campaignNode) => {
          const countryBreakdowns = Array.from(campaignCountryMap.get(campaignNode.campaign_id)?.values() || [])
            .map((row) => finalizeGoogleMetrics(row))
            .sort((a, b) => (b?.spend || 0) - (a?.spend || 0));

          return finalizeGoogleMetrics({
            ...campaignNode,
            country_breakdowns: countryBreakdowns
          });
        })
        .sort((a, b) => (b?.spend || 0) - (a?.spend || 0));

      return { data: finalizedCampaigns, notice: '' };
    }

    const campaignRows = await runGaqlSearch(
      config,
      accessToken,
      buildCampaignQuery({
        startDate,
        endDate,
        includeInactive,
        googleCampaignId: filter.googleCampaignId
      })
    );

    const campaignMap = new Map();
    campaignRows.forEach((row) => {
      const campaignIdValue = String(row?.campaign?.id || '').trim();
      if (!campaignIdValue) return;

      const prefixedCampaignId = `google:${campaignIdValue}`;
      if (!campaignMap.has(prefixedCampaignId)) {
        campaignMap.set(prefixedCampaignId, buildGoogleCampaignNode(row.campaign));
      }

      const campaignNode = campaignMap.get(prefixedCampaignId);
      applyGoogleMetrics(campaignNode, row.metrics);
    });

    const finalizedCampaigns = Array.from(campaignMap.values())
      .map((row) => finalizeGoogleMetrics(row))
      .sort((a, b) => (b?.spend || 0) - (a?.spend || 0));

    return { data: finalizedCampaigns, notice: '' };
  } catch (error) {
    console.warn(`[GoogleAds] Failed to fetch unified campaign data for ${store}: ${error?.message || error}`);
    return { data: [], notice: 'Google Ads data could not be loaded right now.' };
  }
}
