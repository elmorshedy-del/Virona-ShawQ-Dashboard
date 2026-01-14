// server/services/apifyService.js
// Apify Facebook Ads Scraper Integration

import { getDb } from '../db/database.js';
import { 
  isBrandCacheValid, 
  updateBrandCache, 
  getCachedAdIds 
} from '../db/competitorSpyMigration.js';

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const APIFY_ACTOR_ID = 'apify~facebook-ads-scraper';

// Cloudinary config (optional but recommended for permanent URLs)
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

const SUPPORTED_COUNTRIES = {
  'ALL': 'All Countries',
  'SA': 'Saudi Arabia',
  'AE': 'United Arab Emirates',
  'KW': 'Kuwait',
  'QA': 'Qatar',
  'BH': 'Bahrain',
  'OM': 'Oman',
  'EG': 'Egypt',
  'JO': 'Jordan',
  'LB': 'Lebanon',
  'US': 'United States',
  'GB': 'United Kingdom',
  'DE': 'Germany',
  'FR': 'France',
  'TR': 'Turkey',
  'PK': 'Pakistan',
  'IN': 'India',
  'ID': 'Indonesia',
  'MY': 'Malaysia',
  'PH': 'Philippines'
};

export function getSupportedCountries() {
  return SUPPORTED_COUNTRIES;
}

/**
 * Search for ads by brand name
 * Uses 24-hour cache to reduce API calls
 */
export async function searchByBrand(store, brandName, options = {}) {
  const { country = 'ALL', forceRefresh = false, limit = 50 } = options;
  
  if (!APIFY_API_TOKEN) {
    throw new Error('APIFY_API_TOKEN is not configured');
  }

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cachedAdIds = getCachedAdIds(store, brandName, country);
    if (cachedAdIds && cachedAdIds.length > 0) {
      const ads = getAdsByIds(cachedAdIds);
      return {
        ads,
        fromCache: true,
        cacheInfo: {
          ...getCacheExpiry(store, brandName, country),
          is_valid: true
        }
      };
    }
  }

  // Fetch from Apify
  try {
    const ads = await fetchFromApify(brandName, { country, limit });
    
    // Process and store ads
    const storedAds = await processAndStoreAds(ads);
    
    // Update cache
    const adIds = storedAds.map(ad => ad.ad_id);
    updateBrandCache(store, brandName, country, adIds);

    return {
      ads: storedAds,
      fromCache: false,
      cacheInfo: getCacheExpiry(store, brandName, country)
    };
  } catch (error) {
    console.error('Apify fetch error:', error);
    
    // Try to return stale cache if available
    const db = getDb();
    const staleCache = db.prepare(`
      SELECT ad_ids FROM competitor_brand_cache 
      WHERE store = ? AND brand_name = ? AND country = ?
    `).get(store, brandName, country);
    
    if (staleCache) {
      const adIds = JSON.parse(staleCache.ad_ids || '[]');
      const ads = getAdsByIds(adIds);
      return {
        ads,
        fromCache: true,
        stale: true,
        error: error.message
      };
    }
    
    throw error;
  }
}

/**
 * Fetch ads from Apify actor
 */
async function fetchFromApify(searchQuery, options = {}) {
  const { country = 'ALL', limit = 50 } = options;

  const input = {
    searchQuery,
    countryCode: country === 'ALL' ? undefined : country,
    maxItems: limit,
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL']
    }
  };

  // Start the actor run
  const runResponse = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${APIFY_API_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  );

  if (!runResponse.ok) {
    const error = await runResponse.text();
    throw new Error(`Apify actor start failed: ${error}`);
  }

  const runData = await runResponse.json();
  const runId = runData.data.id;

  // Wait for the run to complete (poll every 5 seconds, max 5 minutes)
  let status = 'RUNNING';
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes

  while (status === 'RUNNING' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const statusResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`
    );
    const statusData = await statusResponse.json();
    status = statusData.data.status;
    attempts++;
  }

  if (status !== 'SUCCEEDED') {
    throw new Error(`Apify actor run failed with status: ${status}`);
  }

  // Get the results
  const datasetId = runData.data.defaultDatasetId;
  const resultsResponse = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}`
  );

  if (!resultsResponse.ok) {
    throw new Error('Failed to fetch Apify results');
  }

  return await resultsResponse.json();
}

/**
 * Process ads and store them in the database
 * Uploads media to Cloudinary for permanent storage
 */
async function processAndStoreAds(rawAds) {
  const db = getDb();
  const processedAds = [];

  for (const rawAd of rawAds) {
    try {
      // Generate a unique ad_id
      const adId = rawAd.adArchiveID || rawAd.id || `ad_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Check if ad already exists
      const existing = db.prepare('SELECT * FROM competitor_ads WHERE ad_id = ?').get(adId);
      if (existing) {
        processedAds.push(existing);
        continue;
      }

      // Extract media URLs
      let originalImageUrl = null;
      let originalVideoUrl = null;
      let mediaType = 'image';

      if (rawAd.snapshot?.videos?.length > 0) {
        originalVideoUrl = rawAd.snapshot.videos[0].video_hd_url || rawAd.snapshot.videos[0].video_sd_url;
        mediaType = 'video';
      } else if (rawAd.snapshot?.images?.length > 0) {
        originalImageUrl = rawAd.snapshot.images[0];
      } else if (rawAd.snapshot?.cards?.length > 0) {
        originalImageUrl = rawAd.snapshot.cards[0].original_image_url;
        mediaType = 'carousel';
      }

      // Upload to Cloudinary if configured
      let cloudinaryImageUrl = null;
      let cloudinaryVideoUrl = null;
      let cloudinaryThumbnailUrl = null;

      if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
        if (originalImageUrl) {
          cloudinaryImageUrl = await uploadToCloudinary(originalImageUrl, 'image');
          cloudinaryThumbnailUrl = cloudinaryImageUrl?.replace('/upload/', '/upload/w_400,h_400,c_fill/');
        }
        if (originalVideoUrl) {
          cloudinaryVideoUrl = await uploadToCloudinary(originalVideoUrl, 'video');
          // Generate video thumbnail
          cloudinaryThumbnailUrl = cloudinaryVideoUrl?.replace('/upload/', '/upload/w_400,h_400,c_fill,so_0/').replace('.mp4', '.jpg');
        }
      }

      // Extract ad copy
      const adCopy = rawAd.snapshot?.body?.text || rawAd.snapshot?.caption || '';
      const headline = rawAd.snapshot?.title || '';
      const ctaText = rawAd.snapshot?.cta_text || rawAd.snapshot?.link_title || '';
      const ctaLink = rawAd.snapshot?.link_url || '';

      // Extract dates
      const startDate = rawAd.startDate || rawAd.startDateFormatted || null;
      const endDate = rawAd.endDate || rawAd.endDateFormatted || null;
      const isActive = !endDate || new Date(endDate) > new Date();

      // Extract platforms
      const platforms = rawAd.publisherPlatform || ['facebook'];

      // Extract reach/spend estimates
      const impressionsLower = rawAd.impressions?.lower_bound || null;
      const impressionsUpper = rawAd.impressions?.upper_bound || null;
      const spendLower = rawAd.spend?.lower_bound || null;
      const spendUpper = rawAd.spend?.upper_bound || null;
      const currency = rawAd.currency || 'USD';

      // Insert into database
      const stmt = db.prepare(`
        INSERT INTO competitor_ads (
          ad_id, page_id, page_name, page_profile_picture_url,
          ad_copy, headline, description, cta_text, cta_link,
          original_image_url, original_video_url,
          cloudinary_image_url, cloudinary_video_url, cloudinary_thumbnail_url,
          media_type, platforms, countries,
          start_date, end_date, is_active,
          impressions_lower, impressions_upper, spend_lower, spend_upper, currency,
          demographic_distribution, region_distribution, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        adId,
        rawAd.pageID || rawAd.page_id || null,
        rawAd.pageName || rawAd.page_name || 'Unknown',
        rawAd.pageProfilePictureURL || rawAd.snapshot?.page_profile_picture_url || null,
        adCopy,
        headline,
        rawAd.snapshot?.link_description || '',
        ctaText,
        ctaLink,
        originalImageUrl,
        originalVideoUrl,
        cloudinaryImageUrl,
        cloudinaryVideoUrl,
        cloudinaryThumbnailUrl,
        mediaType,
        JSON.stringify(platforms),
        JSON.stringify(rawAd.deliveryByRegion?.map(r => r.region) || []),
        startDate,
        endDate,
        isActive ? 1 : 0,
        impressionsLower,
        impressionsUpper,
        spendLower,
        spendUpper,
        currency,
        JSON.stringify(rawAd.demographicDistribution || null),
        JSON.stringify(rawAd.deliveryByRegion || null),
        JSON.stringify(rawAd)
      );

      const insertedAd = db.prepare('SELECT * FROM competitor_ads WHERE ad_id = ?').get(adId);
      processedAds.push(formatAdForResponse(insertedAd));
    } catch (error) {
      console.error('Error processing ad:', error);
    }
  }

  return processedAds;
}

/**
 * Upload media to Cloudinary
 */
async function uploadToCloudinary(url, resourceType = 'image') {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return null;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'competitor-spy';
    
    // Create signature
    // Create signature
    const signatureString = `folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

    const formData = new FormData();
    formData.append('file', url);
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);
    formData.append('folder', folder);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
      {
        method: 'POST',
        body: formData
      }
    );

    if (!response.ok) {
      console.error('Cloudinary upload failed:', await response.text());
      return null;
    }

    const data = await response.json();
    return data.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    return null;
  }
}

/**
 * Get ads by their IDs
 */
function getAdsByIds(adIds) {
  if (!adIds || adIds.length === 0) return [];
  
  const db = getDb();
  const placeholders = adIds.map(() => '?').join(',');
  const ads = db.prepare(`
    SELECT * FROM competitor_ads WHERE ad_id IN (${placeholders})
  `).all(...adIds);
  
  return ads.map(formatAdForResponse);
}

/**
 * Get a single ad by ID
 */
export function getAdById(adId) {
  const db = getDb();
  const ad = db.prepare('SELECT * FROM competitor_ads WHERE ad_id = ?').get(adId);
  return ad ? formatAdForResponse(ad) : null;
}

/**
 * Save analysis to an ad (cache forever)
 */
export function saveAnalysisToAd(adId, analysis) {
  const db = getDb();
  const now = new Date().toISOString();
  
  db.prepare(`
    UPDATE competitor_ads 
    SET analysis = ?, analyzed_at = ?, updated_at = ?
    WHERE ad_id = ?
  `).run(JSON.stringify(analysis), now, now, adId);
  
  return getAdById(adId);
}

/**
 * Get ads that have analysis cached
 */
export function getAdsWithAnalysis(store, limit = 20) {
  const db = getDb();
  const ads = db.prepare(`
    SELECT * FROM competitor_ads 
    WHERE analysis IS NOT NULL 
    ORDER BY analyzed_at DESC 
    LIMIT ?
  `).all(limit);
  
  return ads.map(formatAdForResponse);
}

/**
 * Format ad for API response
 */
function formatAdForResponse(ad) {
  if (!ad) return null;
  
  return {
    ...ad,
    platforms: JSON.parse(ad.platforms || '[]'),
    countries: JSON.parse(ad.countries || '[]'),
    demographic_distribution: ad.demographic_distribution ? JSON.parse(ad.demographic_distribution) : null,
    region_distribution: ad.region_distribution ? JSON.parse(ad.region_distribution) : null,
    analysis: ad.analysis ? JSON.parse(ad.analysis) : null,
    is_active: Boolean(ad.is_active)
  };
}

/**
 * Get cache expiry info
 */
function getCacheExpiry(store, brandName, country) {
  const db = getDb();
  const cache = db.prepare(`
    SELECT expires_at, last_fetched_at FROM competitor_brand_cache 
    WHERE store = ? AND brand_name = ? AND country = ?
  `).get(store, brandName, country);
  
  if (!cache) return { is_valid: false };
  
  const expiresAt = new Date(cache.expires_at);
  const now = new Date();
  const hoursRemaining = (expiresAt - now) / (1000 * 60 * 60);
  
  return {
    expires_at: cache.expires_at,
    last_fetched_at: cache.last_fetched_at,
    hours_remaining: Math.max(0, hoursRemaining),
    is_valid: hoursRemaining > 0
  };
}
