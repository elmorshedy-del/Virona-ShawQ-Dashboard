import fetch from 'node-fetch';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

const STORE_CONFIG = {
  vironax: {
    accessTokenEnv: 'META_ACCESS_TOKEN',
    adAccountEnv: 'META_AD_ACCOUNT_ID'
  },
  shawq: {
    accessTokenEnv: 'SHAWQ_META_ACCESS_TOKEN',
    adAccountEnv: 'SHAWQ_META_AD_ACCOUNT_ID'
  }
};

const getStoreConfig = (store) => STORE_CONFIG[store] || STORE_CONFIG.vironax;

const normalizeAdAccountId = (adAccountId) => {
  if (!adAccountId) return null;
  return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
};

const getAccessToken = (store) => {
  const config = getStoreConfig(store);
  return process.env[config.accessTokenEnv];
};

const getFallbackAdAccountId = (store) => {
  const config = getStoreConfig(store);
  const adAccountId = process.env[config.adAccountEnv];
  return normalizeAdAccountId(adAccountId);
};

const buildMetaUrl = (path, params = {}) => {
  const url = new URL(`${META_BASE_URL}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
};

const fetchMetaJson = async (url) => {
  const response = await fetch(url);
  const json = await response.json();
  if (!response.ok || json?.error) {
    const message = json?.error?.message || `Meta API error (${response.status})`;
    throw new Error(message);
  }
  return json;
};

export const getAdAccounts = async (store) => {
  const accessToken = getAccessToken(store);
  if (!accessToken) {
    throw new Error('Meta access token is not configured.');
  }

  const url = buildMetaUrl('me/adaccounts', {
    access_token: accessToken,
    fields: 'id,name,account_id,account_status',
    limit: '200'
  });

  let accounts = [];
  try {
    const json = await fetchMetaJson(url);
    accounts = Array.isArray(json.data) ? json.data : [];
  } catch (error) {
    console.warn('[Meta] Failed to list ad accounts:', error.message);
  }

  if (accounts.length === 0) {
    const fallbackId = getFallbackAdAccountId(store);
    if (fallbackId) {
      accounts = [{ id: fallbackId, name: fallbackId, account_id: fallbackId.replace('act_', '') }];
    }
  }

  return accounts.map((account) => ({
    id: normalizeAdAccountId(account.id || account.account_id),
    name: account.name || account.id || account.account_id,
    account_id: account.account_id || account.id
  }));
};

export const getCampaigns = async (store, adAccountId) => {
  const accessToken = getAccessToken(store);
  if (!accessToken) {
    throw new Error('Meta access token is not configured.');
  }

  const normalizedId = normalizeAdAccountId(adAccountId);
  if (!normalizedId) {
    throw new Error('Missing ad account ID.');
  }

  const url = buildMetaUrl(`${normalizedId}/campaigns`, {
    access_token: accessToken,
    fields: 'id,name,status,effective_status',
    limit: '200'
  });

  const json = await fetchMetaJson(url);
  return Array.isArray(json.data) ? json.data : [];
};

const extractThumbnailUrl = (creative) => {
  if (!creative) return null;
  return creative.thumbnail_url || creative.image_url || creative?.object_story_spec?.video_data?.image_url || null;
};

export const getCampaignAds = async (store, campaignId) => {
  const accessToken = getAccessToken(store);
  if (!accessToken) {
    throw new Error('Meta access token is not configured.');
  }

  if (!campaignId) {
    throw new Error('Missing campaign ID.');
  }

  const url = buildMetaUrl(`${campaignId}/ads`, {
    access_token: accessToken,
    fields: 'id,name,status,effective_status,creative{thumbnail_url,object_story_spec,asset_feed_spec}',
    limit: '500'
  });

  const json = await fetchMetaJson(url);
  const ads = Array.isArray(json.data) ? json.data : [];

  return ads.map((ad) => ({
    id: ad.id,
    name: ad.name || 'Untitled ad',
    status: ad.status || ad.effective_status || 'UNKNOWN',
    thumbnail_url: extractThumbnailUrl(ad.creative)
  }));
};

const extractVideoId = (creative) => {
  const directId = creative?.object_story_spec?.video_data?.video_id;
  if (directId) return directId;

  const assetVideos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(assetVideos) && assetVideos.length > 0) {
    const candidate = assetVideos.find((video) => video.video_id || video.id) || assetVideos[0];
    return candidate.video_id || candidate.id || null;
  }

  return null;
};

export const getAdVideoDetails = async (store, adId) => {
  const accessToken = getAccessToken(store);
  if (!accessToken) {
    throw new Error('Meta access token is not configured.');
  }

  if (!adId) {
    throw new Error('Missing ad ID.');
  }

  const adUrl = buildMetaUrl(`${adId}`, {
    access_token: accessToken,
    fields: 'creative{object_story_spec,asset_feed_spec}'
  });

  const adJson = await fetchMetaJson(adUrl);
  const creative = adJson?.creative || null;
  const videoId = extractVideoId(creative);

  if (!videoId) {
    return {
      video_id: null,
      source_url: null,
      thumbnail_url: null,
      length: null,
      permalink_url: null
    };
  }

  const videoUrl = buildMetaUrl(`${videoId}`, {
    access_token: accessToken,
    fields: 'source,picture,thumbnails{uri},length,permalink_url'
  });

  const videoJson = await fetchMetaJson(videoUrl);
  const thumbnails = Array.isArray(videoJson?.thumbnails?.data) ? videoJson.thumbnails.data : [];
  const thumbnailUrl = videoJson?.picture || thumbnails[0]?.uri || null;

  return {
    video_id: videoId,
    source_url: videoJson?.source || null,
    thumbnail_url: thumbnailUrl,
    length: videoJson?.length ?? null,
    permalink_url: videoJson?.permalink_url || null
  };
};
