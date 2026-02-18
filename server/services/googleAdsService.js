import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import fs from 'fs';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
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
    const adGroupQuery = buildAdGroupQuery({
      startDate,
      endDate,
      includeInactive,
      campaignId: params.campaignId
    });
    const campaignQuery = buildCampaignQuery({
      startDate,
      endDate,
      includeInactive,
      campaignId: params.campaignId
    });
    const conversionCategoryQuery = buildConversionCategoryQuery({
      startDate,
      endDate,
      includeInactive,
      campaignId: params.campaignId
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
    const data = mergeConversionCategoryIntoHierarchy(merged, conversionTotals);
    return {
      data,
      notice: data.length
        ? ''
        : `No Google Ads data for ${startDate} to ${endDate}.`,
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
