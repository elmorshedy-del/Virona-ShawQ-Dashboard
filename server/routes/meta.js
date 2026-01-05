import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

function getStoreConfig(store) {
  if (store === 'shawq') {
    return {
      accessToken: process.env.SHAWQ_META_ACCESS_TOKEN,
      adAccountId: process.env.SHAWQ_META_AD_ACCOUNT_ID
    };
  }

  if (store === 'vironax') {
    return {
      accessToken: process.env.META_ACCESS_TOKEN,
      adAccountId: process.env.META_AD_ACCOUNT_ID
    };
  }

  return { accessToken: null, adAccountId: null };
}

function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return null;
  const cleanId = adAccountId.replace(/^act_/, '');
  return `act_${cleanId}`;
}

async function fetchMetaJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Meta API error (${response.status})`);
  }
  return response.json();
}

router.get('/adaccounts', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { accessToken, adAccountId } = getStoreConfig(store);
    if (!accessToken) {
      return res.json({ data: [] });
    }

    const url = new URL(`${META_BASE_URL}/me/adaccounts`);
    url.searchParams.set('fields', 'id,name,account_id,account_status');
    url.searchParams.set('limit', '100');
    url.searchParams.set('access_token', accessToken);

    let allAccounts = [];
    let nextUrl = url.toString();
    while (nextUrl) {
      const json = await fetchMetaJson(nextUrl);
      allAccounts = allAccounts.concat(json.data || []);
      nextUrl = json.paging?.next || null;
    }

    if (allAccounts.length === 0 && adAccountId) {
      allAccounts = [
        {
          id: normalizeAdAccountId(adAccountId),
          account_id: adAccountId,
          name: normalizeAdAccountId(adAccountId)
        }
      ];
    }

    const data = allAccounts.map(account => {
      const normalizedId = normalizeAdAccountId(account.id || account.account_id);
      return {
        id: normalizedId,
        name: account.name || normalizedId || '',
        account_status: account.account_status ?? null
      };
    }).filter(account => account.id);

    res.json({ data });
  } catch (error) {
    console.error('[Meta API] Ad accounts error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/campaigns', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const adAccountId = normalizeAdAccountId(req.query.adAccountId);
    const { accessToken } = getStoreConfig(store);

    if (!accessToken || !adAccountId) {
      return res.json({ data: [] });
    }

    const url = new URL(`${META_BASE_URL}/${adAccountId}/campaigns`);
    url.searchParams.set('fields', 'id,name,status,effective_status');
    url.searchParams.set('limit', '500');
    url.searchParams.set('access_token', accessToken);

    let allCampaigns = [];
    let nextUrl = url.toString();
    while (nextUrl) {
      const json = await fetchMetaJson(nextUrl);
      allCampaigns = allCampaigns.concat(json.data || []);
      nextUrl = json.paging?.next || null;
    }

    res.json({ data: allCampaigns });
  } catch (error) {
    console.error('[Meta API] Campaigns error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/campaigns/:campaignId/ads', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { campaignId } = req.params;
    const { accessToken } = getStoreConfig(store);

    if (!accessToken || !campaignId) {
      return res.json({ data: [] });
    }

    const url = new URL(`${META_BASE_URL}/${campaignId}/ads`);
    url.searchParams.set('fields', 'id,name,status,effective_status,creative{thumbnail_url}');
    url.searchParams.set('limit', '500');
    url.searchParams.set('access_token', accessToken);

    let allAds = [];
    let nextUrl = url.toString();
    while (nextUrl) {
      const json = await fetchMetaJson(nextUrl);
      allAds = allAds.concat(json.data || []);
      nextUrl = json.paging?.next || null;
    }

    const ads = allAds.map(ad => ({
      id: ad.id,
      name: ad.name,
      status: ad.effective_status || ad.status || 'UNKNOWN',
      thumbnail_url: ad.creative?.thumbnail_url || null
    }));

    res.json({ data: ads });
  } catch (error) {
    console.error('[Meta API] Campaign ads error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/ads/:adId/video', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { adId } = req.params;
    const { accessToken } = getStoreConfig(store);

    if (!accessToken || !adId) {
      return res.json({
        video_id: null,
        source_url: null,
        thumbnail_url: null,
        length: null,
        permalink_url: null
      });
    }

    const creativeUrl = new URL(`${META_BASE_URL}/${adId}`);
    creativeUrl.searchParams.set('fields', 'creative{object_story_spec,asset_feed_spec,thumbnail_url}');
    creativeUrl.searchParams.set('access_token', accessToken);

    const creativeJson = await fetchMetaJson(creativeUrl.toString());
    const creative = creativeJson.creative || {};
    const objectStory = creative.object_story_spec || {};
    const videoData = objectStory.video_data || {};

    let videoId = videoData.video_id || null;
    if (!videoId) {
      const assetVideos = creative.asset_feed_spec?.videos;
      if (Array.isArray(assetVideos) && assetVideos.length > 0) {
        const firstVideo = assetVideos.find(video => video.video_id || video.id) || assetVideos[0];
        videoId = firstVideo?.video_id || firstVideo?.id || null;
      }
    }

    if (!videoId) {
      return res.json({
        video_id: null,
        source_url: null,
        thumbnail_url: creative.thumbnail_url || null,
        length: null,
        permalink_url: null
      });
    }

    const videoUrl = new URL(`${META_BASE_URL}/${videoId}`);
    videoUrl.searchParams.set('fields', 'source,picture,thumbnails{uri},length,permalink_url');
    videoUrl.searchParams.set('access_token', accessToken);

    const videoJson = await fetchMetaJson(videoUrl.toString());
    const thumbnail = videoJson.thumbnails?.data?.[0]?.uri || videoJson.picture || creative.thumbnail_url || null;

    res.json({
      video_id: videoId,
      source_url: videoJson.source || null,
      thumbnail_url: thumbnail,
      length: videoJson.length ?? null,
      permalink_url: videoJson.permalink_url || null
    });
  } catch (error) {
    console.error('[Meta API] Ad video error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
