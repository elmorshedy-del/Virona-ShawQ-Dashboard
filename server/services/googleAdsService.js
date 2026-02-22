import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import { getCountryInfo } from '../utils/countryData.js';
import fs from 'fs';

const GOOGLE_OAUTH_TOKEN_URL = process.env.GOOGLE_OAUTH_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_API_BASE = process.env.GOOGLE_ADS_API_BASE_URL || 'https://googleads.googleapis.com';
const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v22';

function getDateRange(params = {}) {
  const now = new Date();
  const today = formatDateAsGmt3(now);

  if (params.startDate && params.endDate) {
    return { startDate: params.startDate, endDate: params.endDate };
  }

  if (params.yesterday) {
    const yesterday = formatDateAsGmt3(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    return { startDate: yesterday, endDate: yesterday };
  }

  let days = 7;
  if (params.days) days = parseInt(params.days, 10);
  else if (params.weeks) days = parseInt(params.weeks, 10) * 7;
  else if (params.months) days = parseInt(params.months, 10) * 30;

  const endDate = today;
  const startMs = now.getTime() - (Math.max(days, 1) - 1) * 24 * 60 * 60 * 1000;
  const startDate = formatDateAsGmt3(new Date(startMs));

  return { startDate, endDate };
}

function normalizeCustomerId(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function isTruthy(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function microsToCurrency(value) {
  return asNumber(value) / 1_000_000;
}

const ATC_CATEGORIES = new Set(['ADD_TO_CART']);
const CHECKOUT_CATEGORIES = new Set(['BEGIN_CHECKOUT']);
const PURCHASE_CATEGORIES = new Set(['PURCHASE', 'STORE_SALE']);

function createMetrics() {
  return {
    spend: 0,
    conversion_value: 0,
    conversions: 0,
    impressions: 0,
    inline_link_clicks: 0,
    lpv: 0,
    atc: 0,
    checkout: 0,
    reach: null,
    frequency: null
  };
}

function applyDerivedMetrics(row) {
  const spend = asNumber(row.spend);
  const revenue = asNumber(row.conversion_value);
  const conversions = asNumber(row.conversions);
  const impressions = asNumber(row.impressions);
  const clicks = asNumber(row.inline_link_clicks);

  row.cpc = clicks > 0 ? spend / clicks : null;
  row.cpm = impressions > 0 ? (spend * 1000) / impressions : null;
  row.ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
  row.roas = spend > 0 ? revenue / spend : null;
  row.cac = conversions > 0 ? spend / conversions : null;
  row.aov = conversions > 0 ? revenue / conversions : null;
  return row;
}

function addMetrics(target, metrics) {
  target.spend += metrics.spend;
  target.conversion_value += metrics.conversion_value;
  target.conversions += metrics.conversions;
  target.impressions += metrics.impressions;
  target.inline_link_clicks += metrics.inline_link_clicks;
  target.lpv += metrics.lpv;
}

function loadOauthClientFromJson() {
  const secretPath = process.env.GOOGLE_OAUTH_CLIENT_SECRET_PATH || process.env.GOOGLE_ADS_CLIENT_SECRET_PATH;
  if (!secretPath) return { clientId: '', clientSecret: '' };
  if (!fs.existsSync(secretPath)) {
    throw new Error(`OAuth client secret JSON not found at ${secretPath}`);
  }

  const raw = fs.readFileSync(secretPath, 'utf8');
  const parsed = JSON.parse(raw);
  const root = parsed.installed || parsed.web || parsed;
  return {
    clientId: String(root?.client_id || ''),
    clientSecret: String(root?.client_secret || '')
  };
}

async function getAccessToken() {
  const fromJson = loadOauthClientFromJson();
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID || fromJson.clientId || '';
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET || fromJson.clientSecret || '';
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN || '';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET / GOOGLE_ADS_REFRESH_TOKEN');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const message = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`OAuth token exchange failed: ${message}`);
  }

  return payload.access_token;
}

function buildAdGroupQuery({ startDate, endDate, includeInactive, campaignId }) {
  const conditions = [`segments.date BETWEEN '${startDate}' AND '${endDate}'`];
  if (!includeInactive) {
    conditions.push('campaign.status = ENABLED');
    conditions.push('ad_group.status = ENABLED');
    conditions.push('ad_group_ad.status = ENABLED');
  }

  const normalizedCampaignId = normalizeCustomerId(campaignId);
  if (normalizedCampaignId) {
    conditions.push(`campaign.id = ${normalizedCampaignId}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return `
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  ad_group.id,
  ad_group.name,
  ad_group.status,
  ad_group_ad.status,
  ad_group_ad.ad.id,
  ad_group_ad.ad.name,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value
FROM ad_group_ad
${whereClause}
ORDER BY metrics.cost_micros DESC
LIMIT 10000
  `.trim();
}

function buildCampaignQuery({ startDate, endDate, includeInactive, campaignId }) {
  const conditions = [`segments.date BETWEEN '${startDate}' AND '${endDate}'`];
  if (!includeInactive) {
    conditions.push('campaign.status = ENABLED');
  }

  const normalizedCampaignId = normalizeCustomerId(campaignId);
  if (normalizedCampaignId) {
    conditions.push(`campaign.id = ${normalizedCampaignId}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return `
SELECT
  campaign.id,
  campaign.name,
  campaign.status,
  campaign.advertising_channel_type,
  campaign.advertising_channel_sub_type,
  metrics.impressions,
  metrics.clicks,
  metrics.cost_micros,
  metrics.conversions,
  metrics.conversions_value,
  metrics.unique_users,
  metrics.average_impression_frequency_per_user
FROM campaign
${whereClause}
ORDER BY metrics.cost_micros DESC
LIMIT 10000
  `.trim();
}

function buildConversionCategoryQuery({ startDate, endDate, includeInactive, campaignId }) {
  const conditions = [`segments.date BETWEEN '${startDate}' AND '${endDate}'`];
  if (!includeInactive) {
    conditions.push('campaign.status = ENABLED');
  }

  const normalizedCampaignId = normalizeCustomerId(campaignId);
  if (normalizedCampaignId) {
    conditions.push(`campaign.id = ${normalizedCampaignId}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return `
SELECT
  campaign.id,
  segments.conversion_action_category,
  metrics.all_conversions,
  metrics.all_conversions_value
FROM campaign
${whereClause}
ORDER BY metrics.all_conversions DESC
LIMIT 10000
  `.trim();
}

async function searchGoogleAds({ customerId, loginCustomerId, developerToken, accessToken, query }) {
  const endpoint = `${GOOGLE_ADS_API_BASE}/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json'
  };

  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage =
      payload?.error?.message ||
      payload?.error?.details?.[0]?.errors?.[0]?.message ||
      `HTTP ${response.status}`;
    throw new Error(`Google Ads API error: ${apiMessage}`);
  }

  const chunks = Array.isArray(payload) ? payload : [payload];
  return chunks.flatMap((chunk) => (Array.isArray(chunk?.results) ? chunk.results : []));
}

function mapRowsToHierarchy(rows = []) {
  const campaignMap = new Map();

  for (const row of rows) {
    const campaign = row?.campaign || {};
    const adGroup = row?.adGroup || row?.ad_group || {};
    const adGroupAd = row?.adGroupAd || row?.ad_group_ad || {};
    const ad = adGroupAd?.ad || {};
    const metrics = row?.metrics || {};

    const campaignId = normalizeCustomerId(campaign?.id);
    if (!campaignId) continue;

    const adsetId = normalizeCustomerId(adGroup?.id);
    const adId = normalizeCustomerId(ad?.id);

    if (!campaignMap.has(campaignId)) {
      campaignMap.set(campaignId, {
        campaign_id: campaignId,
        campaign_name: campaign?.name || `Campaign ${campaignId}`,
        campaign_status: campaign?.status || null,
        channel_type: campaign?.advertisingChannelType || campaign?.advertising_channel_type || null,
        channel_sub_type: campaign?.advertisingChannelSubType || campaign?.advertising_channel_sub_type || null,
        adsets: [],
        _adsetMap: new Map(),
        ...createMetrics()
      });
    }

    const campaignNode = campaignMap.get(campaignId);

    if (adsetId && !campaignNode._adsetMap.has(adsetId)) {
      campaignNode._adsetMap.set(adsetId, {
        adset_id: adsetId,
        adset_name: adGroup?.name || `Ad Group ${adsetId}`,
        adset_status: adGroup?.status || null,
        ads: [],
        _adMap: new Map(),
        ...createMetrics()
      });
    }

    const adsetNode = adsetId ? campaignNode._adsetMap.get(adsetId) : null;
    if (adsetNode && adId && !adsetNode._adMap.has(adId)) {
      adsetNode._adMap.set(adId, {
        ad_id: adId,
        ad_name: ad?.name || `Ad ${adId}`,
        ad_status: adGroupAd?.status || null,
        ...createMetrics()
      });
    }

    const rowMetrics = {
      spend: microsToCurrency(metrics?.costMicros ?? metrics?.cost_micros),
      conversion_value: asNumber(metrics?.conversionsValue ?? metrics?.conversions_value),
      conversions: asNumber(metrics?.conversions),
      impressions: asNumber(metrics?.impressions),
      inline_link_clicks: asNumber(metrics?.clicks),
      lpv: asNumber(metrics?.clicks)
    };

    addMetrics(campaignNode, rowMetrics);
    if (adsetNode) addMetrics(adsetNode, rowMetrics);
    if (adsetNode && adId) addMetrics(adsetNode._adMap.get(adId), rowMetrics);
  }

  const campaigns = Array.from(campaignMap.values()).map((campaign) => {
    const adsets = Array.from(campaign._adsetMap.values()).map((adset) => {
      const ads = Array.from(adset._adMap.values())
        .map((ad) => applyDerivedMetrics(ad))
        .sort((a, b) => asNumber(b.spend) - asNumber(a.spend));

      delete adset._adMap;
      adset.ads = ads;
      return applyDerivedMetrics(adset);
    }).sort((a, b) => asNumber(b.spend) - asNumber(a.spend));

    delete campaign._adsetMap;
    campaign.adsets = adsets;
    return applyDerivedMetrics(campaign);
  }).sort((a, b) => asNumber(b.spend) - asNumber(a.spend));

  return campaigns;
}

function mapCampaignTotals(rows = []) {
  const campaignMap = new Map();

  for (const row of rows) {
    const campaign = row?.campaign || {};
    const metrics = row?.metrics || {};
    const campaignId = normalizeCustomerId(campaign?.id);
    if (!campaignId) continue;

    if (!campaignMap.has(campaignId)) {
      campaignMap.set(campaignId, {
        campaign_id: campaignId,
        campaign_name: campaign?.name || `Campaign ${campaignId}`,
        campaign_status: campaign?.status || null,
        channel_type: campaign?.advertisingChannelType || campaign?.advertising_channel_type || null,
        channel_sub_type: campaign?.advertisingChannelSubType || campaign?.advertising_channel_sub_type || null,
        adsets: [],
        ...createMetrics()
      });
    }

    const campaignNode = campaignMap.get(campaignId);
    const rowMetrics = {
      spend: microsToCurrency(metrics?.costMicros ?? metrics?.cost_micros),
      conversion_value: asNumber(metrics?.conversionsValue ?? metrics?.conversions_value),
      conversions: asNumber(metrics?.conversions),
      impressions: asNumber(metrics?.impressions),
      inline_link_clicks: asNumber(metrics?.clicks),
      lpv: asNumber(metrics?.clicks),
      reach: asNumber(metrics?.uniqueUsers ?? metrics?.unique_users),
      frequency: asNumber(metrics?.averageImpressionFrequencyPerUser ?? metrics?.average_impression_frequency_per_user)
    };

    addMetrics(campaignNode, rowMetrics);
    campaignNode.reach = rowMetrics.reach || campaignNode.reach || null;
    campaignNode.frequency = rowMetrics.frequency || campaignNode.frequency || null;
  }

  return Array.from(campaignMap.values())
    .map((campaign) => applyDerivedMetrics(campaign))
    .sort((a, b) => asNumber(b.spend) - asNumber(a.spend));
}

function mergeCampaignTotalsIntoHierarchy(hierarchyRows = [], campaignTotals = []) {
  const byId = new Map(hierarchyRows.map((row) => [row.campaign_id, row]));

  for (const total of campaignTotals) {
    const existing = byId.get(total.campaign_id);
    if (!existing) {
      byId.set(total.campaign_id, { ...total, adsets: [] });
      continue;
    }

    existing.campaign_name = total.campaign_name || existing.campaign_name;
    existing.campaign_status = total.campaign_status || existing.campaign_status;
    existing.channel_type = total.channel_type || existing.channel_type;
    existing.channel_sub_type = total.channel_sub_type || existing.channel_sub_type;

    // Campaign-level metrics are the most reliable top-line values across all campaign types.
    existing.spend = asNumber(total.spend);
    existing.conversion_value = asNumber(total.conversion_value);
    existing.conversions = asNumber(total.conversions);
    existing.impressions = asNumber(total.impressions);
    existing.inline_link_clicks = asNumber(total.inline_link_clicks);
    existing.lpv = asNumber(total.lpv);
    existing.reach = asNumber(total.reach) || null;
    existing.frequency = asNumber(total.frequency) || null;
    applyDerivedMetrics(existing);
  }

  return Array.from(byId.values()).sort((a, b) => asNumber(b.spend) - asNumber(a.spend));
}

function mapConversionCategoryTotals(rows = []) {
  const totals = new Map();

  for (const row of rows) {
    const campaignId = normalizeCustomerId(row?.campaign?.id);
    if (!campaignId) continue;

    const category = String(row?.segments?.conversionActionCategory || row?.segments?.conversion_action_category || '').toUpperCase();
    const count = asNumber(row?.metrics?.allConversions ?? row?.metrics?.all_conversions);
    const value = asNumber(row?.metrics?.allConversionsValue ?? row?.metrics?.all_conversions_value);

    if (!totals.has(campaignId)) {
      totals.set(campaignId, {
        atc: 0,
        checkout: 0,
        purchaseCount: 0,
        purchaseValue: 0
      });
    }

    const target = totals.get(campaignId);
    if (ATC_CATEGORIES.has(category)) target.atc += count;
    if (CHECKOUT_CATEGORIES.has(category)) target.checkout += count;
    if (PURCHASE_CATEGORIES.has(category)) {
      target.purchaseCount += count;
      target.purchaseValue += value;
    }
  }

  return totals;
}

function mergeConversionCategoryIntoHierarchy(rows = [], conversionTotals = new Map()) {
  return rows.map((row) => {
    const totals = conversionTotals.get(row.campaign_id);
    row.atc = totals ? totals.atc : (row.atc ?? 0);
    row.checkout = totals ? totals.checkout : (row.checkout ?? 0);

    // If purchase-specific conversion category exists, prefer it for order/revenue semantics.
    if (totals && totals.purchaseCount > 0) {
      row.conversions = totals.purchaseCount;
      if (totals.purchaseValue > 0) {
        row.conversion_value = totals.purchaseValue;
      }
      applyDerivedMetrics(row);
    }

    return row;
  });
}

export async function getGoogleAdManagerHierarchy(params = {}) {
  const customerId = normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const developerToken = String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();

  if (!customerId || !developerToken) {
    return {
      data: [],
      notice: 'Google Ads is not configured. Add GOOGLE_ADS_CUSTOMER_ID and GOOGLE_ADS_DEVELOPER_TOKEN in .env.',
      source: 'google-ads-api'
    };
  }

  const includeInactive = isTruthy(params.includeInactive);
  const { startDate, endDate } = getDateRange(params);

  try {
    const accessToken = await getAccessToken();
    const fetchHierarchy = async (campaignId) => {
      const adGroupQuery = buildAdGroupQuery({
        startDate,
        endDate,
        includeInactive,
        campaignId
      });
      const campaignQuery = buildCampaignQuery({
        startDate,
        endDate,
        includeInactive,
        campaignId
      });
      const conversionCategoryQuery = buildConversionCategoryQuery({
        startDate,
        endDate,
        includeInactive,
        campaignId
      });

      const [adGroupRows, campaignRows, conversionCategoryRows] = await Promise.all([
        searchGoogleAds({
          customerId,
          loginCustomerId,
          developerToken,
          accessToken,
          query: adGroupQuery
        }),
        searchGoogleAds({
          customerId,
          loginCustomerId,
          developerToken,
          accessToken,
          query: campaignQuery
        }),
        searchGoogleAds({
          customerId,
          loginCustomerId,
          developerToken,
          accessToken,
          query: conversionCategoryQuery
        })
      ]);

      const hierarchyRows = mapRowsToHierarchy(adGroupRows);
      const campaignTotals = mapCampaignTotals(campaignRows);
      const conversionTotals = mapConversionCategoryTotals(conversionCategoryRows);
      const merged = mergeCampaignTotalsIntoHierarchy(hierarchyRows, campaignTotals);
      return mergeConversionCategoryIntoHierarchy(merged, conversionTotals);
    };

    const requestedCampaignId = params.campaignId;
    let data = await fetchHierarchy(requestedCampaignId);
    let notice = data.length
      ? ''
      : `No Google Ads data for ${startDate} to ${endDate}.`;

    // Defensive fallback: if a non-Google campaign id is passed from shared filters,
    // rerun without campaign filter so campaigns are still visible.
    if (!data.length && requestedCampaignId) {
      const fallbackData = await fetchHierarchy(null);
      if (fallbackData.length) {
        data = fallbackData;
        notice = 'Selected campaign filter did not match Google campaigns. Showing all Google campaigns.';
      }
    }

    return {
      data,
      notice,
      source: 'google-ads-api',
      dateRange: { startDate, endDate }
    };
  } catch (error) {
    console.error('[GoogleAds] Hierarchy fetch failed:', error?.message || error);
    return {
      data: [],
      notice: `Google Ads fetch failed: ${error?.message || 'Unknown error'}`,
      source: 'google-ads-api',
      dateRange: { startDate, endDate }
    };
  }
}

const UNIFIED_SUPPORTED_BREAKDOWNS = new Set(['none', 'country']);
const UNIFIED_REQUIRED_CONFIG_KEYS = Object.freeze([
  'customerId',
  'developerToken',
  'refreshToken',
  'clientId',
  'clientSecret'
]);
const UNIFIED_MICROS_PER_CURRENCY_UNIT = 1_000_000;
const UNIFIED_GEO_LOOKUP_CHUNK_SIZE = 100;
const UNIFIED_TOKEN_CACHE_TTL_MS = 55 * 60 * 1000;
const UNIFIED_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const UNIFIED_STATUS_MAP = Object.freeze({
  ENABLED: 'ACTIVE',
  PAUSED: 'PAUSED',
  REMOVED: 'ARCHIVED'
});

const unifiedTokenCache = new Map();

function normalizeStorePrefixForUnified(store) {
  return String(store || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');
}

function getStoreScopedGoogleEnv(store, baseKey) {
  const scopedKey = `${normalizeStorePrefixForUnified(store)}_${baseKey}`;
  return process.env[scopedKey] || process.env[baseKey] || '';
}

function resolveUnifiedConfig(store) {
  const config = {
    customerId: normalizeCustomerId(getStoreScopedGoogleEnv(store, 'GOOGLE_ADS_CUSTOMER_ID')),
    developerToken: String(getStoreScopedGoogleEnv(store, 'GOOGLE_ADS_DEVELOPER_TOKEN') || '').trim(),
    refreshToken: String(getStoreScopedGoogleEnv(store, 'GOOGLE_ADS_REFRESH_TOKEN') || '').trim(),
    clientId: String(getStoreScopedGoogleEnv(store, 'GOOGLE_ADS_CLIENT_ID') || '').trim(),
    clientSecret: String(getStoreScopedGoogleEnv(store, 'GOOGLE_ADS_CLIENT_SECRET') || '').trim(),
    loginCustomerId: normalizeCustomerId(getStoreScopedGoogleEnv(store, 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'))
  };

  const missing = UNIFIED_REQUIRED_CONFIG_KEYS.filter((key) => !config[key]);
  return {
    ...config,
    configured: missing.length === 0,
    missing
  };
}

function parseUnifiedCampaignFilter(campaignId) {
  const raw = String(campaignId || '').trim();
  if (!raw) {
    return { skipGoogle: false, googleCampaignId: null };
  }

  if (!raw.startsWith('google:')) {
    return { skipGoogle: true, googleCampaignId: null };
  }

  const normalizedId = normalizeCustomerId(raw.slice('google:'.length));
  if (!normalizedId) {
    return { skipGoogle: true, googleCampaignId: null };
  }

  return { skipGoogle: false, googleCampaignId: normalizedId };
}

function buildUnifiedWhere({ startDate, endDate, includeInactive, googleCampaignId, countryOnly = false }) {
  const conditions = [`segments.date BETWEEN '${startDate}' AND '${endDate}'`];
  if (countryOnly) {
    conditions.push('segments.geo_target_country IS NOT NULL');
  }

  if (includeInactive) {
    conditions.push('campaign.status != REMOVED');
  } else {
    conditions.push('campaign.status = ENABLED');
  }

  if (googleCampaignId) {
    conditions.push(`campaign.id = ${googleCampaignId}`);
  }

  return `WHERE ${conditions.join(' AND ')}`;
}

function buildUnifiedCampaignQuery({ startDate, endDate, includeInactive, googleCampaignId }) {
  const whereClause = buildUnifiedWhere({ startDate, endDate, includeInactive, googleCampaignId });
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
${whereClause}
ORDER BY metrics.cost_micros DESC
LIMIT 10000
  `.trim();
}

function buildUnifiedCountryQuery({ startDate, endDate, includeInactive, googleCampaignId }) {
  const whereClause = buildUnifiedWhere({
    startDate,
    endDate,
    includeInactive,
    googleCampaignId,
    countryOnly: true
  });

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
${whereClause}
ORDER BY metrics.cost_micros DESC
LIMIT 10000
  `.trim();
}

function buildUnifiedGeoLookupQuery(resourceNames = []) {
  const quoted = resourceNames
    .map((name) => `'${String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
    .join(', ');

  return `
SELECT
  geo_target_constant.resource_name,
  geo_target_constant.country_code
FROM geo_target_constant
WHERE geo_target_constant.resource_name IN (${quoted})
LIMIT 10000
  `.trim();
}

function getUnifiedStatus(status) {
  const key = String(status || '').toUpperCase();
  return UNIFIED_STATUS_MAP[key] || 'UNKNOWN';
}

function getUnifiedTokenCacheKey(config) {
  return `${config.customerId}:${config.clientId}`;
}

function readUnifiedTokenCache(cacheKey) {
  const cached = unifiedTokenCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > UNIFIED_TOKEN_CACHE_TTL_MS) {
    unifiedTokenCache.delete(cacheKey);
    return null;
  }
  return cached.token;
}

function writeUnifiedTokenCache(cacheKey, token) {
  unifiedTokenCache.set(cacheKey, { token, createdAt: Date.now() });
}

async function getUnifiedAccessToken(config) {
  const cacheKey = getUnifiedTokenCacheKey(config);
  const cachedToken = readUnifiedTokenCache(cacheKey);
  if (cachedToken) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token'
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const message = payload?.error_description || payload?.error || `HTTP ${response.status}`;
    throw new Error(`OAuth token exchange failed: ${message}`);
  }

  writeUnifiedTokenCache(cacheKey, payload.access_token);
  return payload.access_token;
}

async function runUnifiedGoogleQuery(config, accessToken, query) {
  return searchGoogleAds({
    customerId: config.customerId,
    loginCustomerId: config.loginCustomerId,
    developerToken: config.developerToken,
    accessToken,
    query
  });
}

function buildUnifiedCampaignNode(campaign) {
  const rawCampaignId = normalizeCustomerId(campaign?.id);
  const mappedStatus = getUnifiedStatus(campaign?.status);

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

function addUnifiedMetrics(target, metrics) {
  target.spend += asNumber(metrics?.costMicros ?? metrics?.cost_micros) / UNIFIED_MICROS_PER_CURRENCY_UNIT;
  target.impressions += asNumber(metrics?.impressions);
  target.clicks += asNumber(metrics?.clicks);
  target.inline_link_clicks += asNumber(metrics?.clicks);
  target.conversions += asNumber(metrics?.conversions);
  target.conversion_value += asNumber(metrics?.conversionsValue ?? metrics?.conversions_value);
}

function finalizeUnifiedMetrics(target) {
  target.cost_per_inline_link_click = target.inline_link_clicks > 0
    ? target.spend / target.inline_link_clicks
    : null;

  target.cpc = target.cost_per_inline_link_click;
  target.cpm = target.impressions > 0 ? (target.spend * 1000) / target.impressions : null;
  target.ctr = target.impressions > 0 ? (target.inline_link_clicks * 100) / target.impressions : null;
  target.roas = target.spend > 0 ? target.conversion_value / target.spend : null;
  target.aov = target.conversions > 0 ? target.conversion_value / target.conversions : null;
  target.cac = target.conversions > 0 ? target.spend / target.conversions : null;
  return target;
}

async function lookupUnifiedCountryCodes(config, accessToken, resourceNames = []) {
  const uniqueResources = Array.from(new Set(resourceNames.filter(Boolean)));
  const countryMap = new Map();

  for (let i = 0; i < uniqueResources.length; i += UNIFIED_GEO_LOOKUP_CHUNK_SIZE) {
    const chunk = uniqueResources.slice(i, i + UNIFIED_GEO_LOOKUP_CHUNK_SIZE);
    if (!chunk.length) continue;

    try {
      const rows = await runUnifiedGoogleQuery(
        config,
        accessToken,
        buildUnifiedGeoLookupQuery(chunk)
      );

      rows.forEach((row) => {
        const resourceName = row?.geoTargetConstant?.resourceName;
        const countryCode = row?.geoTargetConstant?.countryCode;
        if (resourceName && countryCode) {
          countryMap.set(resourceName, countryCode);
        }
      });
    } catch (error) {
      console.warn(`[GoogleAds] Country lookup skipped: ${error?.message || error}`);
      return countryMap;
    }
  }

  return countryMap;
}

function resolveCountryCodeFromResource(resourceName, countryMap) {
  const key = String(resourceName || '').trim();
  if (!key) return null;
  const code = String(countryMap.get(key) || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export async function fetchGoogleCampaignHierarchy({
  store,
  startDate,
  endDate,
  breakdown = 'none',
  includeInactive = false,
  campaignId = null
}) {
  if (!UNIFIED_DATE_PATTERN.test(String(startDate || '')) || !UNIFIED_DATE_PATTERN.test(String(endDate || ''))) {
    return { data: [], notice: 'Google Ads fetch skipped due to invalid date range.' };
  }

  const filter = parseUnifiedCampaignFilter(campaignId);
  if (filter.skipGoogle) {
    return { data: [], notice: '' };
  }

  if (!UNIFIED_SUPPORTED_BREAKDOWNS.has(breakdown)) {
    return { data: [], notice: 'Google Ads currently supports No Breakdown and By Country in Unified Campaign.' };
  }

  const config = resolveUnifiedConfig(store);
  if (!config.configured) {
    return { data: [], notice: `Google Ads credentials are not configured for store "${store}".` };
  }

  try {
    const accessToken = await getUnifiedAccessToken(config);

    if (breakdown === 'country') {
      const rows = await runUnifiedGoogleQuery(
        config,
        accessToken,
        buildUnifiedCountryQuery({
          startDate,
          endDate,
          includeInactive,
          googleCampaignId: filter.googleCampaignId
        })
      );

      if (!rows.length) {
        return { data: [], notice: '' };
      }

      const countryResources = rows
        .map((row) => row?.segments?.geoTargetCountry || row?.segments?.geo_target_country)
        .filter(Boolean);
      const countryCodeMap = await lookupUnifiedCountryCodes(config, accessToken, countryResources);

      const campaignMap = new Map();
      const countryBreakdownMap = new Map();

      rows.forEach((row) => {
        const campaign = row?.campaign || {};
        const campaignIdValue = normalizeCustomerId(campaign?.id);
        if (!campaignIdValue) return;

        const prefixedCampaignId = `google:${campaignIdValue}`;
        if (!campaignMap.has(prefixedCampaignId)) {
          campaignMap.set(prefixedCampaignId, buildUnifiedCampaignNode(campaign));
        }

        const campaignNode = campaignMap.get(prefixedCampaignId);
        addUnifiedMetrics(campaignNode, row?.metrics || {});

        if (!countryBreakdownMap.has(prefixedCampaignId)) {
          countryBreakdownMap.set(prefixedCampaignId, new Map());
        }

        const countryMap = countryBreakdownMap.get(prefixedCampaignId);
        const resourceName = row?.segments?.geoTargetCountry || row?.segments?.geo_target_country;
        const countryCode = resolveCountryCodeFromResource(resourceName, countryCodeMap);
        const countryKey = countryCode || `UNKNOWN-${String(resourceName || '').split('/').pop() || 'geo'}`;

        if (!countryMap.has(countryKey)) {
          const countryInfo = countryCode ? getCountryInfo(countryCode) : null;
          countryMap.set(countryKey, {
            campaign_id: prefixedCampaignId,
            campaign_name: campaignNode.campaign_name,
            country: countryCode || countryKey,
            countryName: countryInfo?.name || 'Unknown Country',
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

        addUnifiedMetrics(countryMap.get(countryKey), row?.metrics || {});
      });

      const data = Array.from(campaignMap.values())
        .map((campaignNode) => {
          const countryRows = Array.from(countryBreakdownMap.get(campaignNode.campaign_id)?.values() || [])
            .map((row) => finalizeUnifiedMetrics(row))
            .sort((a, b) => asNumber(b.spend) - asNumber(a.spend));

          return finalizeUnifiedMetrics({
            ...campaignNode,
            country_breakdowns: countryRows
          });
        })
        .sort((a, b) => asNumber(b.spend) - asNumber(a.spend));

      return { data, notice: '' };
    }

    const rows = await runUnifiedGoogleQuery(
      config,
      accessToken,
      buildUnifiedCampaignQuery({
        startDate,
        endDate,
        includeInactive,
        googleCampaignId: filter.googleCampaignId
      })
    );

    const campaignMap = new Map();
    rows.forEach((row) => {
      const campaign = row?.campaign || {};
      const campaignIdValue = normalizeCustomerId(campaign?.id);
      if (!campaignIdValue) return;

      const prefixedCampaignId = `google:${campaignIdValue}`;
      if (!campaignMap.has(prefixedCampaignId)) {
        campaignMap.set(prefixedCampaignId, buildUnifiedCampaignNode(campaign));
      }

      addUnifiedMetrics(campaignMap.get(prefixedCampaignId), row?.metrics || {});
    });

    const data = Array.from(campaignMap.values())
      .map((campaignNode) => finalizeUnifiedMetrics(campaignNode))
      .sort((a, b) => asNumber(b.spend) - asNumber(a.spend));

    return { data, notice: '' };
  } catch (error) {
    console.warn(`[GoogleAds] Failed to fetch unified campaign data for ${store}: ${error?.message || error}`);
    return { data: [], notice: 'Google Ads data could not be loaded right now.' };
  }
}
