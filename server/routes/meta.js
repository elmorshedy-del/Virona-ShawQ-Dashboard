import express from 'express';
import { timingSafeEqual } from 'crypto';
import fetch from 'node-fetch';

const router = express.Router();

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
const DEBUG_BUFFER_LIMIT = 100;
const META_BODY_LIMIT = 20000;
const CAMPAIGN_OBJECTIVES = new Set(['OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS']);
const CTA_TYPES = new Set(['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'CONTACT_US']);
const STORE_IDS = new Set(['vironax', 'shawq']);
const AD_ACCOUNT_ID_PATTERN = /^(?:act_)?([0-9]{5,32})$/;
const GRAPH_NODE_ID_PATTERN = /^[0-9]{5,32}$/;

const debugEvents = [];

const TOKEN_PATTERNS = [
  /access_token=([^&\s"]+)/gi,
  /EAAB[a-zA-Z0-9]+/g,
  /EAA[a-zA-Z0-9]+/g
];

function redactTokenString(value) {
  if (typeof value !== 'string') return value;
  return TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, match => {
    if (match.toLowerCase().startsWith('access_token=')) {
      return 'access_token=[REDACTED]';
    }
    return '[REDACTED]';
  }), value);
}

function redactTokensDeep(value) {
  if (Array.isArray(value)) {
    return value.map(item => redactTokensDeep(item));
  }
  if (value && typeof value === 'object') {
    const result = {};
    Object.entries(value).forEach(([key, val]) => {
      if (/token/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactTokensDeep(val);
      }
    });
    return result;
  }
  if (typeof value === 'string') {
    return redactTokenString(value);
  }
  return value;
}

function truncateMetaBody(body) {
  if (body == null) return { body, truncated: false };
  if (typeof body === 'string') {
    if (body.length <= META_BODY_LIMIT) {
      return { body, truncated: false };
    }
    return { body: body.slice(0, META_BODY_LIMIT), truncated: true };
  }
  try {
    const serialized = JSON.stringify(body);
    if (serialized.length <= META_BODY_LIMIT) {
      return { body, truncated: false };
    }
    return { body: serialized.slice(0, META_BODY_LIMIT), truncated: true };
  } catch (error) {
    const fallback = String(body);
    if (fallback.length <= META_BODY_LIMIT) {
      return { body: fallback, truncated: false };
    }
    return { body: fallback.slice(0, META_BODY_LIMIT), truncated: true };
  }
}

function addDebugEvent(event) {
  debugEvents.unshift(event);
  if (debugEvents.length > DEBUG_BUFFER_LIMIT) {
    debugEvents.length = DEBUG_BUFFER_LIMIT;
  }
}

function getStoreConfig(store) {
  const normalized = store || 'vironax';
  if (normalized === 'shawq') {
    return {
      store: 'shawq',
      accessToken: process.env.SHAWQ_META_ACCESS_TOKEN,
      adAccountId: process.env.SHAWQ_META_AD_ACCOUNT_ID
    };
  }
  return {
    store: 'vironax',
    accessToken: process.env.META_ACCESS_TOKEN || process.env.VIRONAX_META_ACCESS_TOKEN,
    adAccountId: process.env.META_AD_ACCOUNT_ID || process.env.VIRONAX_META_AD_ACCOUNT_ID
  };
}

function getStorePixelId(store) {
  if ((store || 'vironax') === 'shawq') {
    return process.env.SHAWQ_META_PIXEL_ID || process.env.META_PIXEL_ID || '';
  }
  return process.env.META_PIXEL_ID || process.env.VIRONAX_META_PIXEL_ID || '';
}

function normalizeStoreValue(rawStore) {
  const normalized = String(rawStore || 'vironax').trim().toLowerCase();
  if (STORE_IDS.has(normalized)) return normalized;
  return '';
}

function extractBearerToken(authHeader) {
  if (typeof authHeader !== 'string') return '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function timingSafeEqualString(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getCampaignLauncherAuthSecret(req) {
  const directHeaderSecret = String(req.get('x-meta-launcher-key') || req.get('x-api-key') || '').trim();
  if (directHeaderSecret) return directHeaderSecret;
  return extractBearerToken(req.get('authorization'));
}

function requireCampaignLauncherAuth(req, res, next) {
  const expectedSecret = String(process.env.META_CAMPAIGN_LAUNCHER_API_KEY || '').trim();
  if (!expectedSecret) {
    return res.status(503).json({
      error: 'Campaign launcher is disabled. Configure META_CAMPAIGN_LAUNCHER_API_KEY.'
    });
  }

  const providedSecret = getCampaignLauncherAuthSecret(req);
  if (!providedSecret || !timingSafeEqualString(providedSecret, expectedSecret)) {
    return res.status(401).json({ error: 'Unauthorized campaign launcher request.' });
  }

  return next();
}

function buildGraphPath(path, params) {
  const query = new URLSearchParams(params);
  query.delete('access_token');
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function buildPostDebugPath(path, params = {}) {
  const debugParams = {};
  Object.entries(params).forEach(([key, value]) => {
    if (key === 'access_token') return;
    if (key === 'bytes') {
      debugParams[key] = '[BASE64_IMAGE]';
      return;
    }
    if (typeof value === 'string' && value.length > 120) {
      debugParams[key] = `${value.slice(0, 117)}...`;
      return;
    }
    debugParams[key] = value;
  });
  return buildGraphPath(path, debugParams);
}

async function fetchMetaJson({ path, params = {}, store, localEndpoint, adAccountId }) {
  const { accessToken } = getStoreConfig(store);
  if (!accessToken) {
    addDebugEvent({
      ts: new Date().toISOString(),
      localEndpoint,
      store,
      adAccountId,
      graphPath: buildGraphPath(path, params),
      metaStatus: null,
      metaBody: { message: 'Missing Meta access token' }
    });
    return {
      ok: false,
      status: 400,
      data: { error: { message: 'Missing Meta access token' } },
      graphPath: buildGraphPath(path, params)
    };
  }

  const requestParams = { ...params, access_token: accessToken };
  const url = new URL(`${META_BASE_URL}${path}`);
  Object.entries(requestParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const graphPath = buildGraphPath(path, requestParams);

  try {
    const response = await fetch(url.toString());
    const text = await response.text();
    let parsed;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (parseError) {
      parsed = text || null;
    }

    const isError = !response.ok || (parsed && typeof parsed === 'object' && parsed.error);

    if (isError) {
      const redacted = redactTokensDeep(parsed);
      const { body, truncated } = truncateMetaBody(redacted);

      addDebugEvent({
        ts: new Date().toISOString(),
        localEndpoint,
        store,
        adAccountId,
        graphPath,
        metaStatus: response.status,
        metaBody: truncated ? { truncated: true, body } : body
      });
    }

    return {
      ok: !isError,
      status: response.status,
      data: parsed,
      graphPath
    };
  } catch (error) {
    const redactedMessage = redactTokenString(error.message || 'Meta request failed');
    addDebugEvent({
      ts: new Date().toISOString(),
      localEndpoint,
      store,
      adAccountId,
      graphPath,
      metaStatus: null,
      metaBody: { message: redactedMessage }
    });

    return {
      ok: false,
      status: 500,
      data: { error: { message: redactedMessage } },
      graphPath
    };
  }
}

function toMetaFormValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

async function postMetaJson({ path, body = {}, store, localEndpoint, adAccountId }) {
  const { accessToken } = getStoreConfig(store);
  if (!accessToken) {
    const debugPath = buildPostDebugPath(path, body);
    addDebugEvent({
      ts: new Date().toISOString(),
      localEndpoint,
      store,
      adAccountId,
      graphPath: debugPath,
      metaStatus: null,
      metaBody: { message: 'Missing Meta access token' }
    });
    return {
      ok: false,
      status: 400,
      data: { error: { message: 'Missing Meta access token' } },
      graphPath: debugPath
    };
  }

  const requestBody = { ...body, access_token: accessToken };
  const form = new URLSearchParams();
  Object.entries(requestBody).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      form.set(key, toMetaFormValue(value));
    }
  });

  const graphPath = buildPostDebugPath(path, requestBody);

  try {
    const response = await fetch(`${META_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    const text = await response.text();
    let parsed;

    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (parseError) {
      parsed = text || null;
    }

    const isError = !response.ok || (parsed && typeof parsed === 'object' && parsed.error);
    if (isError) {
      const redacted = redactTokensDeep(parsed);
      const { body: redactedBody, truncated } = truncateMetaBody(redacted);

      addDebugEvent({
        ts: new Date().toISOString(),
        localEndpoint,
        store,
        adAccountId,
        graphPath,
        metaStatus: response.status,
        metaBody: truncated ? { truncated: true, body: redactedBody } : redactedBody
      });
    }

    return {
      ok: !isError,
      status: response.status,
      data: parsed,
      graphPath
    };
  } catch (error) {
    const redactedMessage = redactTokenString(error.message || 'Meta request failed');
    addDebugEvent({
      ts: new Date().toISOString(),
      localEndpoint,
      store,
      adAccountId,
      graphPath,
      metaStatus: null,
      metaBody: { message: redactedMessage }
    });

    return {
      ok: false,
      status: 500,
      data: { error: { message: redactedMessage } },
      graphPath
    };
  }
}

function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return '';
  const match = String(adAccountId).trim().match(AD_ACCOUNT_ID_PATTERN);
  return match?.[1] || '';
}

function normalizeGraphNodeId(rawId) {
  if (!rawId) return '';
  const cleaned = String(rawId).trim();
  if (!GRAPH_NODE_ID_PATTERN.test(cleaned)) return '';
  return cleaned;
}

function collectAuthorizedAdAccountIds(store) {
  const config = getStoreConfig(store);
  const storeAllowlistEnv = store === 'shawq'
    ? process.env.SHAWQ_META_ALLOWED_AD_ACCOUNT_IDS
    : process.env.VIRONAX_META_ALLOWED_AD_ACCOUNT_IDS;
  const globalAllowlistEnv = process.env.META_ALLOWED_AD_ACCOUNT_IDS;
  const authorized = new Set();

  const addId = (value) => {
    const normalized = normalizeAdAccountId(value);
    if (normalized) authorized.add(normalized);
  };

  const addCsvIds = (value) => {
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach(addId);
  };

  addId(config.adAccountId);
  addCsvIds(storeAllowlistEnv);
  addCsvIds(globalAllowlistEnv);

  return authorized;
}

function normalizeGenderValue(rawGender) {
  if (!Array.isArray(rawGender) || rawGender.length === 0) return [1, 2];
  const parsed = rawGender
    .map((value) => Number(value))
    .filter((value) => value === 1 || value === 2);
  return parsed.length > 0 ? Array.from(new Set(parsed)) : [1, 2];
}

function parsePositiveBudget(value) {
  const budget = Number(value);
  if (!Number.isFinite(budget) || budget <= 0) return null;
  return Math.round(budget * 100);
}

function buildAdSetGoal(objective, store) {
  if (objective === 'OUTCOME_AWARENESS') {
    return {
      optimizationGoal: 'REACH',
      billingEvent: 'IMPRESSIONS',
      warnings: []
    };
  }

  if (objective === 'OUTCOME_TRAFFIC') {
    return {
      optimizationGoal: 'LINK_CLICKS',
      billingEvent: 'IMPRESSIONS',
      warnings: []
    };
  }

  const pixelId = getStorePixelId(store);
  if (pixelId) {
    return {
      optimizationGoal: 'OFFSITE_CONVERSIONS',
      billingEvent: 'IMPRESSIONS',
      promotedObject: {
        pixel_id: pixelId,
        custom_event_type: 'PURCHASE'
      },
      warnings: []
    };
  }

  return {
    optimizationGoal: 'LINK_CLICKS',
    billingEvent: 'LINK_CLICKS',
    warnings: [
      'No pixel ID configured for this store. Falling back to traffic optimization for the ad set.'
    ]
  };
}

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function extractVideoId(creative) {
  if (!creative) return null;

  const directVideoId = creative?.object_story_spec?.video_data?.video_id;
  if (directVideoId) return directVideoId;

  const linkVideoId = creative?.object_story_spec?.link_data?.video_id;
  if (linkVideoId) return linkVideoId;

  const videos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(videos) && videos.length > 0) {
    const videoEntry = videos.find((video) => video?.video_id) || videos[0];
    return videoEntry?.video_id || null;
  }

  const carouselElements = creative?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(carouselElements)) {
    const videoElement = carouselElements.find((element) => element?.video_id);
    if (videoElement?.video_id) return videoElement.video_id;
  }

  return null;
}

function extractThumbnailUrl(creative) {
  if (!creative) return null;

  if (creative.image_url) return creative.image_url;

  const videoImage = creative?.object_story_spec?.video_data?.image_url;
  if (videoImage) return videoImage;

  const linkImage =
    creative?.object_story_spec?.link_data?.image_url ||
    creative?.object_story_spec?.link_data?.picture;
  if (linkImage) return linkImage;

  const photoUrl =
    creative?.object_story_spec?.photo_data?.url ||
    creative?.object_story_spec?.photo_data?.image_url;
  if (photoUrl) return photoUrl;

  const assetImages = creative?.asset_feed_spec?.images;
  if (Array.isArray(assetImages) && assetImages.length > 0) {
    const image = assetImages[0];
    if (image?.url) return image.url;
    if (image?.image_url) return image.image_url;
  }

  const assetVideos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(assetVideos) && assetVideos.length > 0) {
    const video = assetVideos[0];
    if (video?.thumbnail_url) return video.thumbnail_url;
    if (video?.picture) return video.picture;
  }

  const carouselElements = creative?.object_story_spec?.link_data?.child_attachments;
  if (Array.isArray(carouselElements) && carouselElements.length > 0) {
    const first = carouselElements[0];
    if (first?.picture) return first.picture;
    if (first?.image_url) return first.image_url;
  }

  // `thumbnail_url` is often returned at a very small size (blurry when upscaled).
  if (creative.thumbnail_url) return creative.thumbnail_url;
  return null;
}

router.get('/adaccounts', async (req, res) => {
  const store = normalizeStoreValue(req.query.store);
  if (!store) {
    return res.status(400).json({ error: 'Unsupported store value' });
  }
  const config = getStoreConfig(store);
  const { accessToken } = config;

  if (!accessToken) {
    return res.status(400).json({ error: 'Missing Meta credentials.' });
  }

  const result = await fetchMetaJson({
    path: '/me/adaccounts',
    params: { fields: 'id,name,account_status,disable_reason', limit: '100' },
    store,
    localEndpoint: '/api/meta/adaccounts'
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.data?.error?.message || 'Meta request failed' });
  }

  let accounts = Array.isArray(result.data?.data) ? result.data.data : [];

  if (accounts.length === 0 && config.adAccountId) {
    accounts = [{
      id: `act_${config.adAccountId.replace(/^act_/, '')}`,
      name: `Manual Account (${config.adAccountId})`
    }];
  }

  res.json({ data: accounts });
});

router.get('/pages', async (req, res) => {
  const store = normalizeStoreValue(req.query.store);
  if (!store) {
    return res.status(400).json({ error: 'Unsupported store value' });
  }
  const config = getStoreConfig(store);
  const { accessToken } = config;

  if (!accessToken) {
    return res.status(400).json({ error: 'Missing Meta credentials.' });
  }

  const result = await fetchMetaJson({
    path: '/me/accounts',
    params: { fields: 'id,name,category,tasks', limit: '200' },
    store,
    localEndpoint: '/api/meta/pages'
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.data?.error?.message || 'Meta request failed' });
  }

  const pages = Array.isArray(result.data?.data)
    ? result.data.data.map((page) => ({
      id: page.id,
      name: page.name,
      category: page.category || null,
      tasks: Array.isArray(page.tasks) ? page.tasks : []
    }))
    : [];

  res.json({ data: pages });
});

router.post('/campaign-launcher', requireCampaignLauncherAuth, async (req, res) => {
  const store = normalizeStoreValue(req.body?.store || req.query.store);
  if (!store) {
    return res.status(400).json({ error: 'Unsupported store value' });
  }
  const adAccountIdRaw = String(req.body?.adAccountId || '').trim();
  const campaignName = String(req.body?.campaignName || '').trim();
  const pageId = String(req.body?.pageId || '').trim();
  const objective = String(req.body?.objective || 'OUTCOME_SALES').trim().toUpperCase();
  const adName = String(req.body?.adName || '').trim() || `${campaignName || 'New Campaign'} - Ad`;
  const primaryText = String(req.body?.primaryText || '').trim();
  const headline = String(req.body?.headline || '').trim();
  const description = String(req.body?.description || '').trim();
  const linkUrl = String(req.body?.linkUrl || '').trim();
  const cta = String(req.body?.cta || 'SHOP_NOW').trim().toUpperCase();
  const imageUrl = String(req.body?.imageUrl || '').trim();
  const imageBase64 = String(req.body?.imageBase64 || '').trim();
  const imageFilename = String(req.body?.imageFilename || '').trim() || `campaign-${Date.now()}.jpg`;
  const country = String(req.body?.country || '').trim().toUpperCase();
  const gender = normalizeGenderValue(req.body?.gender);
  const budgetCents = parsePositiveBudget(req.body?.dailyBudget);
  const ageMinRaw = Number(req.body?.ageMin);
  const ageMaxRaw = Number(req.body?.ageMax);
  const ageMin = Number.isFinite(ageMinRaw) ? Math.max(13, Math.floor(ageMinRaw)) : 18;
  const ageMax = Number.isFinite(ageMaxRaw)
    ? Math.max(ageMin, Math.min(65, Math.floor(ageMaxRaw)))
    : 65;

  if (!adAccountIdRaw) {
    return res.status(400).json({ error: 'adAccountId is required' });
  }
  if (!campaignName) {
    return res.status(400).json({ error: 'campaignName is required' });
  }
  if (!pageId) {
    return res.status(400).json({ error: 'pageId is required' });
  }
  if (!CAMPAIGN_OBJECTIVES.has(objective)) {
    return res.status(400).json({ error: 'Unsupported objective value' });
  }
  if (!CTA_TYPES.has(cta)) {
    return res.status(400).json({ error: 'Unsupported CTA type' });
  }
  if (!budgetCents) {
    return res.status(400).json({ error: 'dailyBudget must be a positive number' });
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    return res.status(400).json({ error: 'country must be a 2-letter ISO code' });
  }
  if (!isHttpUrl(linkUrl)) {
    return res.status(400).json({ error: 'linkUrl must be a valid HTTP(S) URL' });
  }
  if (imageUrl && !isHttpUrl(imageUrl)) {
    return res.status(400).json({ error: 'imageUrl must be a valid HTTP(S) URL when provided' });
  }

  const cleanAccountId = normalizeAdAccountId(adAccountIdRaw);
  if (!cleanAccountId) {
    return res.status(400).json({ error: 'adAccountId is invalid' });
  }
  const authorizedAdAccountIds = collectAuthorizedAdAccountIds(store);
  if (authorizedAdAccountIds.size === 0) {
    return res.status(500).json({
      error: 'No authorized ad account configured for this store. Set *_META_AD_ACCOUNT_ID or *_META_ALLOWED_AD_ACCOUNT_IDS.'
    });
  }
  if (!authorizedAdAccountIds.has(cleanAccountId)) {
    return res.status(403).json({ error: 'adAccountId is not authorized for this store' });
  }
  const warnings = [];

  const respondStepError = (step, result, fallbackMessage, partialIds = {}) => {
    const status = result?.status && Number.isInteger(result.status) ? result.status : 502;
    const errorMessage = result?.data?.error?.message || fallbackMessage;
    return res.status(status).json({
      error: errorMessage,
      step,
      ...partialIds,
      details: redactTokensDeep(result?.data || null)
    });
  };

  const campaignResult = await postMetaJson({
    path: `/act_${cleanAccountId}/campaigns`,
    body: {
      name: campaignName,
      objective,
      special_ad_categories: '[]',
      is_adset_budget_sharing_enabled: false,
      status: 'PAUSED'
    },
    store,
    adAccountId: adAccountIdRaw,
    localEndpoint: '/api/meta/campaign-launcher'
  });

  if (!campaignResult.ok) {
    return respondStepError('campaign', campaignResult, 'Failed to create campaign');
  }

  const campaignId = campaignResult.data?.id;
  if (!campaignId) {
    return res.status(502).json({ error: 'Meta did not return campaign id', step: 'campaign' });
  }

  const adSetGoal = buildAdSetGoal(objective, store);
  warnings.push(...adSetGoal.warnings);

  const targeting = compactObject({
    geo_locations: { countries: [country] },
    age_min: ageMin,
    age_max: ageMax,
    genders: gender.length === 2 ? undefined : gender
  });

  const adSetBody = compactObject({
    name: `${campaignName} - Ad Set`,
    campaign_id: campaignId,
    daily_budget: budgetCents,
    billing_event: adSetGoal.billingEvent,
    optimization_goal: adSetGoal.optimizationGoal,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: 'WEBSITE',
    targeting: JSON.stringify(targeting),
    promoted_object: adSetGoal.promotedObject ? JSON.stringify(adSetGoal.promotedObject) : undefined,
    status: 'PAUSED'
  });

  const adSetResult = await postMetaJson({
    path: `/act_${cleanAccountId}/adsets`,
    body: adSetBody,
    store,
    adAccountId: adAccountIdRaw,
    localEndpoint: '/api/meta/campaign-launcher'
  });

  if (!adSetResult.ok) {
    return respondStepError(
      'adset',
      adSetResult,
      'Campaign created but ad set creation failed',
      { campaign_id: campaignId }
    );
  }

  const adSetId = adSetResult.data?.id;
  if (!adSetId) {
    return res.status(502).json({
      error: 'Meta did not return ad set id',
      step: 'adset',
      campaign_id: campaignId
    });
  }

  let uploadedImageHash = null;
  if (imageBase64) {
    const imageUploadResult = await postMetaJson({
      path: `/act_${cleanAccountId}/adimages`,
      body: {
        bytes: imageBase64,
        name: imageFilename
      },
      store,
      adAccountId: adAccountIdRaw,
      localEndpoint: '/api/meta/campaign-launcher'
    });

    if (!imageUploadResult.ok) {
      return respondStepError(
        'image_upload',
        imageUploadResult,
        'Campaign and ad set created, but image upload failed',
        { campaign_id: campaignId, adset_id: adSetId }
      );
    }

    const uploadedImages = imageUploadResult.data?.images || {};
    const firstImage = Object.values(uploadedImages)[0];
    uploadedImageHash = firstImage?.hash || null;
    if (!uploadedImageHash) {
      return res.status(502).json({
        error: 'Image upload did not return an image hash',
        step: 'image_upload',
        campaign_id: campaignId,
        adset_id: adSetId
      });
    }
  }

  const linkData = compactObject({
    link: linkUrl,
    message: primaryText || campaignName,
    name: headline || campaignName,
    description: description || undefined,
    image_hash: uploadedImageHash || undefined,
    image_url: !uploadedImageHash && imageUrl ? imageUrl : undefined,
    call_to_action: {
      type: cta,
      value: { link: linkUrl }
    }
  });

  const creativeResult = await postMetaJson({
    path: `/act_${cleanAccountId}/adcreatives`,
    body: {
      name: `${adName} Creative`,
      object_story_spec: JSON.stringify({
        page_id: pageId,
        link_data: linkData
      })
    },
    store,
    adAccountId: adAccountIdRaw,
    localEndpoint: '/api/meta/campaign-launcher'
  });

  if (!creativeResult.ok) {
    return respondStepError(
      'creative',
      creativeResult,
      'Campaign and ad set created, but creative creation failed',
      { campaign_id: campaignId, adset_id: adSetId }
    );
  }

  const creativeId = creativeResult.data?.id;
  if (!creativeId) {
    return res.status(502).json({
      error: 'Meta did not return creative id',
      step: 'creative',
      campaign_id: campaignId,
      adset_id: adSetId
    });
  }

  const adResult = await postMetaJson({
    path: `/act_${cleanAccountId}/ads`,
    body: {
      name: adName,
      adset_id: adSetId,
      creative: JSON.stringify({ creative_id: creativeId }),
      status: 'PAUSED'
    },
    store,
    adAccountId: adAccountIdRaw,
    localEndpoint: '/api/meta/campaign-launcher'
  });

  if (!adResult.ok) {
    return respondStepError(
      'ad',
      adResult,
      'Campaign, ad set, and creative created, but ad creation failed',
      { campaign_id: campaignId, adset_id: adSetId, creative_id: creativeId }
    );
  }

  const adId = adResult.data?.id;
  if (!adId) {
    return res.status(502).json({
      error: 'Meta did not return ad id',
      step: 'ad',
      campaign_id: campaignId,
      adset_id: adSetId,
      creative_id: creativeId
    });
  }

  return res.json({
    success: true,
    campaign_id: campaignId,
    adset_id: adSetId,
    creative_id: creativeId,
    ad_id: adId,
    warnings,
    mode: 'live'
  });
});

router.get('/campaigns', async (req, res) => {
  const store = normalizeStoreValue(req.query.store);
  if (!store) {
    return res.status(400).json({ error: 'Unsupported store value' });
  }
  const adAccountId = req.query.adAccountId;
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), 100)
    : 500;

  if (!adAccountId) {
    return res.status(400).json({ error: 'adAccountId is required' });
  }

  const cleanId = normalizeAdAccountId(adAccountId);
  if (!cleanId) {
    return res.status(400).json({ error: 'adAccountId is invalid' });
  }
  const result = await fetchMetaJson({
    path: `/act_${cleanId}/campaigns`,
    params: {
      fields: 'id,name,status,effective_status,created_time,updated_time',
      limit: String(Math.max(limit, 100))
    },
    store,
    adAccountId,
    localEndpoint: '/api/meta/campaigns'
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.data?.error?.message || 'Meta request failed' });
  }

  const campaigns = Array.isArray(result.data?.data) ? result.data.data : [];
  const sortedCampaigns = [...campaigns].sort((left, right) => {
    const leftTs = Date.parse(left?.updated_time || left?.created_time || '') || 0;
    const rightTs = Date.parse(right?.updated_time || right?.created_time || '') || 0;
    return rightTs - leftTs;
  });

  res.json({ data: sortedCampaigns.slice(0, limit) });
});

router.get('/campaigns/:campaignId/ads', async (req, res) => {
  const store = normalizeStoreValue(req.query.store);
  if (!store) {
    return res.status(400).json({ error: 'Unsupported store value' });
  }
  const adAccountId = req.query.adAccountId;
  const { campaignId } = req.params;

  const cleanCampaignId = normalizeGraphNodeId(campaignId);
  if (!cleanCampaignId) {
    return res.status(400).json({ error: 'campaignId is invalid' });
  }

  const result = await fetchMetaJson({
    path: `/${cleanCampaignId}/ads`,
    params: {
      fields:
        'id,name,status,effective_status,creative{thumbnail_url,image_url,object_story_spec{video_data,link_data,photo_data},asset_feed_spec{videos,images}}',
      limit: '500'
    },
    store,
    adAccountId,
    localEndpoint: '/api/meta/campaigns/:campaignId/ads'
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.data?.error?.message || 'Meta request failed' });
  }

  const ads = Array.isArray(result.data?.data) ? result.data.data : [];
  const formattedAds = ads.map((ad) => ({
    ...ad,
    thumbnail_url: extractThumbnailUrl(ad.creative)
  }));
  res.json({ data: formattedAds });
});

router.get('/campaigns/:campaignId/adsets', async (req, res) => {
  const store = normalizeStoreValue(req.query.store);
  if (!store) {
    return res.status(400).json({ error: 'Unsupported store value' });
  }
  const adAccountId = req.query.adAccountId;
  const { campaignId } = req.params;

  const cleanCampaignId = normalizeGraphNodeId(campaignId);
  if (!cleanCampaignId) {
    return res.status(400).json({ error: 'campaignId is invalid' });
  }

  const result = await fetchMetaJson({
    path: `/${cleanCampaignId}/adsets`,
    params: {
      fields:
        'id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,optimization_goal,created_time,updated_time',
      limit: '500'
    },
    store,
    adAccountId,
    localEndpoint: '/api/meta/campaigns/:campaignId/adsets'
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.data?.error?.message || 'Meta request failed' });
  }

  const adSets = Array.isArray(result.data?.data) ? result.data.data : [];
  const sortedAdSets = [...adSets].sort((left, right) => {
    const leftTs = Date.parse(left?.updated_time || left?.created_time || '') || 0;
    const rightTs = Date.parse(right?.updated_time || right?.created_time || '') || 0;
    return rightTs - leftTs;
  });
  res.json({ data: sortedAdSets });
});

router.get('/ads/:adId/video', async (req, res) => {
  const store = normalizeStoreValue(req.query.store);
  if (!store) {
    return res.status(400).json({ error: 'Unsupported store value' });
  }
  const adAccountId = req.query.adAccountId;
  const { adId } = req.params;

  const cleanAdId = normalizeGraphNodeId(adId);
  if (!cleanAdId) {
    return res.status(400).json({ error: 'adId is invalid' });
  }

  const creativeResult = await fetchMetaJson({
    path: `/${cleanAdId}`,
    params: { fields: 'creative{object_story_spec,asset_feed_spec}' },
    store,
    adAccountId,
    localEndpoint: '/api/meta/ads/:adId/video'
  });

  if (!creativeResult.ok) {
    return res.status(creativeResult.status).json({
      error: creativeResult.data?.error?.message || 'Meta request failed'
    });
  }

  const creative = creativeResult.data?.creative;
  const videoId = extractVideoId(creative);

  if (!videoId) {
    return res.json({
      video_id: null,
      source_url: null,
      embed_html: null,
      thumbnail_url: null,
      length: null,
      permalink_url: null,
      message: 'No video found for this ad.'
    });
  }

  const videoResult = await fetchMetaJson({
    path: `/${videoId}`,
    params: { fields: 'source,picture,thumbnails{uri,height,width},length,permalink_url,embed_html' },
    store,
    adAccountId,
    localEndpoint: '/api/meta/ads/:adId/video'
  });

  if (!videoResult.ok) {
    if (videoResult.data?.error?.code === 10) {
      return res.json({
        playable: false,
        reason: 'NO_VIDEO_PERMISSION',
        video_id: videoId
      });
    }

    return res.status(videoResult.status).json({
      error: videoResult.data?.error?.message || 'Meta request failed',
      video_id: videoId
    });
  }

  const videoData = videoResult.data || {};
  const thumbnails = Array.isArray(videoData?.thumbnails?.data) ? videoData.thumbnails.data : [];
  const bestThumbnail = thumbnails.reduce((best, item) => {
    if (!item?.uri) return best;
    if (!best) return item;
    const bestArea = (Number(best.width) || 0) * (Number(best.height) || 0);
    const itemArea = (Number(item.width) || 0) * (Number(item.height) || 0);
    if (itemArea > bestArea) return item;
    return best;
  }, null);
  const thumbnailUrl =
    bestThumbnail?.uri ||
    videoData?.picture ||
    thumbnails[0]?.uri ||
    null;

  res.json({
    video_id: videoId,
    source_url: videoData?.source || null,
    embed_html: videoData?.embed_html || null,
    thumbnail_url: thumbnailUrl,
    length: videoData?.length ?? null,
    permalink_url: videoData?.permalink_url || null
  });
});

router.get('/debug/events', (req, res) => {
  res.json({ events: debugEvents });
});

router.delete('/debug/events', (req, res) => {
  debugEvents.length = 0;
  res.json({ ok: true });
});

export default router;
