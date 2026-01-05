import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

function getMetaCredentials(store) {
  const accountIdEnv = store === 'shawq' ? 'SHAWQ_META_AD_ACCOUNT_ID' : 'META_AD_ACCOUNT_ID';
  const tokenEnv = store === 'shawq' ? 'SHAWQ_META_ACCESS_TOKEN' : 'META_ACCESS_TOKEN';
  return {
    accountId: process.env[accountIdEnv],
    accessToken: process.env[tokenEnv]
  };
}

function normalizeAccountId(adAccountId) {
  if (!adAccountId) return '';
  return adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
}

async function fetchMetaJson(url) {
  const response = await fetch(url);
  const json = await response.json();
  if (!response.ok || json?.error) {
    const message = json?.error?.message || `Meta API request failed (${response.status})`;
    throw new Error(message);
  }
  return json;
}

function extractVideoId(creative) {
  const objectStoryVideoId = creative?.object_story_spec?.video_data?.video_id;
  if (objectStoryVideoId) return objectStoryVideoId;

  const assetVideos = creative?.asset_feed_spec?.videos;
  if (Array.isArray(assetVideos) && assetVideos.length > 0) {
    const first = assetVideos[0];
    if (typeof first === 'string') return first;
    return first.video_id || first.id || null;
  }

  return null;
}

router.get('/adaccounts', async (req, res) => {
  const store = req.query.store || 'vironax';
  try {
    const { accountId, accessToken } = getMetaCredentials(store);
    if (!accessToken) {
      return res.status(400).json({ error: 'Missing Meta access token for store.' });
    }

    const url = `${META_BASE_URL}/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${accessToken}`;
    try {
      const json = await fetchMetaJson(url);
      return res.json({ data: Array.isArray(json.data) ? json.data : [] });
    } catch (error) {
      if (accountId) {
        return res.json({
          data: [{
            id: normalizeAccountId(accountId),
            name: `Ad Account ${normalizeAccountId(accountId)}`,
            account_status: 'UNKNOWN'
          }],
          warning: error.message
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[Meta] Failed to load ad accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/campaigns', async (req, res) => {
  const store = req.query.store || 'vironax';
  const adAccountId = normalizeAccountId(req.query.adAccountId);

  if (!adAccountId) {
    return res.status(400).json({ error: 'adAccountId is required.' });
  }

  try {
    const { accessToken } = getMetaCredentials(store);
    if (!accessToken) {
      return res.status(400).json({ error: 'Missing Meta access token for store.' });
    }

    const fields = 'id,name,status,effective_status';
    const url = `${META_BASE_URL}/${adAccountId}/campaigns?fields=${fields}&limit=500&access_token=${accessToken}`;
    const json = await fetchMetaJson(url);
    res.json({ data: Array.isArray(json.data) ? json.data : [] });
  } catch (error) {
    console.error('[Meta] Failed to load campaigns:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/campaigns/:campaignId/ads', async (req, res) => {
  const store = req.query.store || 'vironax';
  const campaignId = req.params.campaignId;

  if (!campaignId) {
    return res.status(400).json({ error: 'campaignId is required.' });
  }

  try {
    const { accessToken } = getMetaCredentials(store);
    if (!accessToken) {
      return res.status(400).json({ error: 'Missing Meta access token for store.' });
    }

    const fields = 'id,name,status,effective_status,creative{thumbnail_url,image_url}';
    const url = `${META_BASE_URL}/${campaignId}/ads?fields=${fields}&limit=500&access_token=${accessToken}`;
    const json = await fetchMetaJson(url);
    res.json({ data: Array.isArray(json.data) ? json.data : [] });
  } catch (error) {
    console.error('[Meta] Failed to load ads:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/ads/:adId/video', async (req, res) => {
  const store = req.query.store || 'vironax';
  const adId = req.params.adId;

  if (!adId) {
    return res.status(400).json({ error: 'adId is required.' });
  }

  try {
    const { accessToken } = getMetaCredentials(store);
    if (!accessToken) {
      return res.status(400).json({ error: 'Missing Meta access token for store.' });
    }

    const creativeUrl = `${META_BASE_URL}/${adId}?fields=creative{object_story_spec,asset_feed_spec}&access_token=${accessToken}`;
    const creativeJson = await fetchMetaJson(creativeUrl);
    const creative = creativeJson?.creative || null;
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

    const videoUrl = `${META_BASE_URL}/${videoId}?fields=source,picture,thumbnails{uri},length,permalink_url&access_token=${accessToken}`;
    const videoJson = await fetchMetaJson(videoUrl);

    const thumbnails = Array.isArray(videoJson?.thumbnails?.data) ? videoJson.thumbnails.data : [];
    const thumbnailUrl = videoJson?.picture || thumbnails[0]?.uri || null;
    const sourceUrl = videoJson?.source || null;
    const permalinkUrl = videoJson?.permalink_url || null;

    if (!sourceUrl) {
      return res.json({
        video_id: videoId,
        source_url: null,
        thumbnail_url: thumbnailUrl,
        length: videoJson?.length || null,
        permalink_url: permalinkUrl,
        message: 'Video source is unavailable or expired.'
      });
    }

    res.json({
      video_id: videoId,
      source_url: sourceUrl,
      thumbnail_url: thumbnailUrl,
      length: videoJson?.length || null,
      permalink_url: permalinkUrl
    });
  } catch (error) {
    console.error('[Meta] Failed to load ad video:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
