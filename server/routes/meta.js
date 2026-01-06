import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
const DEBUG_BUFFER_LIMIT = 100;
const META_BODY_LIMIT = 20000;

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
    accessToken: process.env.META_ACCESS_TOKEN,
    adAccountId: process.env.META_AD_ACCOUNT_ID
  };
}

function buildGraphPath(path, params) {
  const query = new URLSearchParams(params);
  query.delete('access_token');
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
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

function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return '';
  return adAccountId.replace(/^act_/, '');
}

function extractVideoId(creative) {
  if (!creative) return null;
  const directVideoId = creative?.object_story_spec?.video_data?.video_id;
  if (directVideoId) return directVideoId;

  const videos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(videos)) {
    const videoEntry = videos.find(video => video?.video_id) || videos[0];
    return videoEntry?.video_id || null;
  }

  return null;
}

router.get('/adaccounts', async (req, res) => {
  const store = req.query.store || 'vironax';
  const { accessToken } = getStoreConfig(store);

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

  res.json({
    data: Array.isArray(result.data?.data) ? result.data.data : []
  });
});

router.get('/campaigns', async (req, res) => {
  const store = req.query.store || 'vironax';
  const adAccountId = req.query.adAccountId;

  if (!adAccountId) {
    return res.status(400).json({ error: 'adAccountId is required' });
  }

  const cleanId = normalizeAdAccountId(adAccountId);
  const result = await fetchMetaJson({
    path: `/act_${cleanId}/campaigns`,
    params: { fields: 'id,name,status,effective_status', limit: '500' },
    store,
    adAccountId,
    localEndpoint: '/api/meta/campaigns'
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.data?.error?.message || 'Meta request failed' });
  }

  res.json({
    data: Array.isArray(result.data?.data) ? result.data.data : []
  });
});

router.get('/campaigns/:campaignId/ads', async (req, res) => {
  const store = req.query.store || 'vironax';
  const adAccountId = req.query.adAccountId;
  const { campaignId } = req.params;

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required' });
  }

  const result = await fetchMetaJson({
    path: `/${campaignId}/ads`,
    params: {
      fields: 'id,name,status,effective_status,creative{object_story_spec,asset_feed_spec},thumbnail_url',
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
  res.json({ data: ads });
});

router.get('/ads/:adId/video', async (req, res) => {
  const store = req.query.store || 'vironax';
  const adAccountId = req.query.adAccountId;
  const { adId } = req.params;

  if (!adId) {
    return res.status(400).json({ error: 'adId is required' });
  }

  const creativeResult = await fetchMetaJson({
    path: `/${adId}`,
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
      thumbnail_url: null,
      length: null,
      permalink_url: null,
      message: 'No video found for this ad.'
    });
  }

  const safePreviewResult = await fetchMetaJson({
    path: `/${videoId}`,
    params: { fields: 'picture,thumbnails{uri},length,permalink_url' },
    store,
    adAccountId,
    localEndpoint: '/api/meta/ads/:adId/video'
  });

  if (!safePreviewResult.ok) {
    if (safePreviewResult.data?.error?.code === 10) {
      return res.json({
        playable: false,
        reason: 'NO_VIDEO_PERMISSION',
        video_id: videoId
      });
    }

    return res.status(safePreviewResult.status).json({
      error: safePreviewResult.data?.error?.message || 'Meta request failed',
      video_id: videoId
    });
  }

  const safePreview = safePreviewResult.data || {};
  const thumbnailUrl =
    safePreview?.picture ||
    safePreview?.thumbnails?.data?.[0]?.uri ||
    null;

  const sourceResult = await fetchMetaJson({
    path: `/${videoId}`,
    params: { fields: 'source' },
    store,
    adAccountId,
    localEndpoint: '/api/meta/ads/:adId/video'
  });

  if (!sourceResult.ok) {
    if (sourceResult.data?.error?.code === 10) {
      return res.json({
        playable: false,
        reason: 'NO_SOURCE_PERMISSION',
        video_id: videoId,
        thumbnail_url: thumbnailUrl,
        permalink_url: safePreview?.permalink_url || null,
        length: safePreview?.length ?? null
      });
    }

    return res.status(sourceResult.status).json({
      error: sourceResult.data?.error?.message || 'Meta request failed',
      video_id: videoId
    });
  }

  res.json({
    video_id: videoId,
    source_url: sourceResult.data?.source || null,
    thumbnail_url: thumbnailUrl,
    length: safePreview?.length ?? null,
    permalink_url: safePreview?.permalink_url || null
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
