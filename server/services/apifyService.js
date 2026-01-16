// server/services/apifyService.js
// Apify Facebook Ads Scraper Integration with robust error handling

import { getDb } from '../db/database.js';
import crypto from 'crypto';
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

// Configuration
const CONFIG = {
  POLL_INTERVAL_MS: 3000,          // Poll every 3 seconds (faster feedback)
  MAX_POLL_TIME_MS: 180000,        // Max 3 minutes polling (reasonable timeout)
  INITIAL_WAIT_MS: 5000,           // Wait 5 seconds before first poll
  MAX_RETRIES: 2,                  // Retry failed requests
  RETRY_DELAY_MS: 2000,            // Wait 2 seconds between retries
};

// Apify cost estimation (approximate - check Apify pricing for exact rates)
// Facebook Ads Scraper typically costs ~$0.50-1.00 per 1000 results
// Plus compute units (~$0.25-0.50 per actor run depending on duration)
const COST_ESTIMATE = {
  PER_RESULT: 0.001,              // ~$0.001 per ad result (rough estimate)
  BASE_RUN_COST: 0.05,            // ~$0.05 base cost per actor run
  PER_MINUTE_COMPUTE: 0.004,      // ~$0.004 per minute of compute
};

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

// Debug logger for tracking search progress
const debugLog = {
  logs: [],
  add(stage, message, data = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      stage,
      message,
      data
    };
    this.logs.push(entry);
    console.log(`[CompetitorSpy] ${stage}: ${message}`, data ? JSON.stringify(data).slice(0, 200) : '');
    // Keep only last 100 logs
    if (this.logs.length > 100) {
      this.logs = this.logs.slice(-100);
    }
  },
  getRecent(count = 20) {
    return this.logs.slice(-count);
  },
  clear() {
    this.logs = [];
  }
};

export function getDebugLogs(count = 20) {
  return debugLog.getRecent(count);
}

export function getSupportedCountries() {
  return SUPPORTED_COUNTRIES;
}

/**
 * Search for ads by brand name
 * Uses 24-hour cache to reduce API calls
 */
export async function searchByBrand(store, brandName, options = {}) {
  const { country = 'ALL', forceRefresh = false, limit = 2 } = options;
  const searchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  debugLog.add('SEARCH_START', `Search initiated for "${brandName}"`, { store, country, forceRefresh, limit, searchId });
  
  // Validate API token
  if (!APIFY_API_TOKEN) {
    const error = new Error('APIFY_API_TOKEN is not configured. Please set this environment variable.');
    error.code = 'CONFIG_ERROR';
    error.debug = { stage: 'VALIDATION', searchId };
    debugLog.add('ERROR', 'Missing APIFY_API_TOKEN');
    throw error;
  }

  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    debugLog.add('CACHE_CHECK', 'Checking cache...');
    const cachedAdIds = getCachedAdIds(store, brandName, country);
    if (cachedAdIds && cachedAdIds.length > 0) {
      debugLog.add('CACHE_HIT', `Found ${cachedAdIds.length} cached ads`);
      const ads = getAdsByIds(cachedAdIds);
      return {
        ads,
        fromCache: true,
        cacheInfo: {
          ...getCacheExpiry(store, brandName, country),
          is_valid: true
        },
        debug: {
          searchId,
          stage: 'CACHE_HIT',
          logs: debugLog.getRecent(5)
        }
      };
    }
    debugLog.add('CACHE_MISS', 'No valid cache found');
  }

  // Fetch from Apify
  try {
    debugLog.add('APIFY_START', 'Starting Apify fetch...');
    const result = await fetchFromApify(brandName, { country, limit, searchId });
    
    if (!result.ads || result.ads.length === 0) {
      debugLog.add('NO_RESULTS', 'Apify returned no ads');
      return {
        ads: [],
        fromCache: false,
        cacheInfo: null,
        cost: result.cost || null,
        debug: {
          searchId,
          stage: 'NO_RESULTS',
          apifyRunId: result.runId,
          logs: debugLog.getRecent(10)
        }
      };
    }
    
    // Process and store ads
    debugLog.add('PROCESSING', `Processing ${result.ads.length} ads...`);
    const storedAds = await processAndStoreAds(result.ads);
    
    // Update cache
    const adIds = storedAds.map(ad => ad.ad_id);
    updateBrandCache(store, brandName, country, adIds);
    debugLog.add('CACHE_UPDATE', `Cached ${adIds.length} ad IDs`);

    return {
      ads: storedAds,
      fromCache: false,
      cacheInfo: getCacheExpiry(store, brandName, country),
      cost: result.cost || null,
      debug: {
        searchId,
        stage: 'SUCCESS',
        apifyRunId: result.runId,
        processedCount: storedAds.length,
        logs: debugLog.getRecent(10)
      }
    };
  } catch (error) {
    debugLog.add('ERROR', error.message, { code: error.code, stage: error.debug?.stage });
    
    // Try to return stale cache if available
    const db = getDb();
    const staleCache = db.prepare(`
      SELECT ad_ids FROM competitor_brand_cache 
      WHERE store = ? AND brand_name = ? AND country = ?
    `).get(store, brandName, country);
    
    if (staleCache) {
      debugLog.add('STALE_CACHE', 'Returning stale cache due to error');
      const adIds = JSON.parse(staleCache.ad_ids || '[]');
      const ads = getAdsByIds(adIds);
      return {
        ads,
        fromCache: true,
        stale: true,
        error: error.message,
        errorCode: error.code || 'UNKNOWN',
        debug: {
          searchId,
          stage: 'STALE_CACHE_FALLBACK',
          originalError: error.message,
          logs: debugLog.getRecent(15)
        }
      };
    }
    
    // Enhance error with debug info
    error.debug = {
      searchId,
      stage: error.debug?.stage || 'UNKNOWN',
      logs: debugLog.getRecent(15)
    };
    throw error;
  }
}

/**
 * Fetch ads from Apify actor with robust error handling
 */
async function fetchFromApify(searchQuery, options = {}) {
  const { country = 'ALL', limit = 2, searchId = 'unknown' } = options;

  const searchUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country === "ALL" ? "ALL" : country}&q=${encodeURIComponent(searchQuery)}&search_type=keyword_unordered&media_type=all`;

  const input = {
    startUrls: [{ url: searchUrl }],
    maxItems: Math.min(limit, 50), // Cap at 50 to reduce timeout risk
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL']
    }
  };

  debugLog.add('APIFY_INPUT', 'Prepared Apify input', { searchUrl: searchUrl.slice(0, 100), maxItems: input.maxItems });

  // Start the actor run with retry
  let runResponse;
  let retries = 0;
  
  while (retries <= CONFIG.MAX_RETRIES) {
    try {
      debugLog.add('APIFY_REQUEST', `Starting actor run (attempt ${retries + 1})...`);
      
      runResponse = await fetch(
        `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${APIFY_API_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input)
        }
      );

      if (runResponse.ok) break;
      
      const errorText = await runResponse.text();
      debugLog.add('APIFY_ERROR', `Actor start failed: ${runResponse.status}`, { error: errorText.slice(0, 200) });
      
      if (runResponse.status === 401) {
        const error = new Error('Invalid Apify API token. Please check your APIFY_API_TOKEN.');
        error.code = 'AUTH_ERROR';
        error.debug = { stage: 'ACTOR_START' };
        throw error;
      }
      
      if (runResponse.status === 402) {
        const error = new Error('Apify account has insufficient credits. Please add credits or upgrade your plan.');
        error.code = 'CREDITS_ERROR';
        error.debug = { stage: 'ACTOR_START' };
        throw error;
      }
      
      if (runResponse.status >= 500) {
        retries++;
        if (retries <= CONFIG.MAX_RETRIES) {
          debugLog.add('RETRY', `Server error, retrying in ${CONFIG.RETRY_DELAY_MS}ms...`);
          await sleep(CONFIG.RETRY_DELAY_MS);
          continue;
        }
      }
      
      const error = new Error(`Apify actor start failed (${runResponse.status}): ${errorText.slice(0, 100)}`);
      error.code = 'ACTOR_START_ERROR';
      error.debug = { stage: 'ACTOR_START', status: runResponse.status };
      throw error;
      
    } catch (fetchError) {
      if (fetchError.code) throw fetchError; // Re-throw our custom errors
      
      retries++;
      if (retries <= CONFIG.MAX_RETRIES) {
        debugLog.add('RETRY', `Network error, retrying in ${CONFIG.RETRY_DELAY_MS}ms...`, { error: fetchError.message });
        await sleep(CONFIG.RETRY_DELAY_MS);
        continue;
      }
      
      const error = new Error(`Network error connecting to Apify: ${fetchError.message}`);
      error.code = 'NETWORK_ERROR';
      error.debug = { stage: 'ACTOR_START' };
      throw error;
    }
  }

  const runData = await runResponse.json();
  const runId = runData.data?.id;
  
  if (!runId) {
    const error = new Error('Apify did not return a run ID');
    error.code = 'INVALID_RESPONSE';
    error.debug = { stage: 'ACTOR_START', response: JSON.stringify(runData).slice(0, 200) };
    throw error;
  }

  debugLog.add('APIFY_RUN_STARTED', `Actor run started`, { runId, defaultDatasetId: runData.data?.defaultDatasetId });

  // Initial wait before polling
  debugLog.add('POLLING_WAIT', `Waiting ${CONFIG.INITIAL_WAIT_MS}ms before polling...`);
  await sleep(CONFIG.INITIAL_WAIT_MS);

  // Poll for completion with timeout
  const startTime = Date.now();
  let status = 'RUNNING';
  let pollCount = 0;
  let lastStatusData = null;

  while (Date.now() - startTime < CONFIG.MAX_POLL_TIME_MS) {
    pollCount++;
    
    try {
      const statusResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`
      );
      
      if (!statusResponse.ok) {
        debugLog.add('POLL_ERROR', `Status check failed: ${statusResponse.status}`);
        await sleep(CONFIG.POLL_INTERVAL_MS);
        continue;
      }
      
      const statusData = await statusResponse.json();
      lastStatusData = statusData.data;
      status = statusData.data?.status;
      
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      debugLog.add('POLL_STATUS', `Poll #${pollCount}: ${status} (${elapsedSec}s elapsed)`);
      
      // Check for terminal states
      if (status === 'SUCCEEDED') {
        debugLog.add('APIFY_SUCCESS', 'Actor run completed successfully');
        break;
      }
      
      if (status === 'FAILED') {
        const error = new Error(`Apify actor run failed. Check the Apify console for details.`);
        error.code = 'ACTOR_FAILED';
        error.debug = { stage: 'POLLING', runId, statusMessage: lastStatusData?.statusMessage };
        throw error;
      }
      
      if (status === 'ABORTED') {
        const error = new Error('Apify actor run was aborted');
        error.code = 'ACTOR_ABORTED';
        error.debug = { stage: 'POLLING', runId };
        throw error;
      }
      
      if (status === 'TIMED-OUT') {
        const error = new Error('Apify actor run timed out. Try searching with fewer results or a more specific query.');
        error.code = 'ACTOR_TIMEOUT';
        error.debug = { stage: 'POLLING', runId };
        throw error;
      }
      
      // Still running, wait and poll again
      if (status === 'RUNNING' || status === 'READY') {
        await sleep(CONFIG.POLL_INTERVAL_MS);
        continue;
      }
      
      // Unknown status
      debugLog.add('UNKNOWN_STATUS', `Unexpected status: ${status}`);
      await sleep(CONFIG.POLL_INTERVAL_MS);
      
    } catch (pollError) {
      if (pollError.code) throw pollError; // Re-throw our custom errors
      
      debugLog.add('POLL_NETWORK_ERROR', pollError.message);
      await sleep(CONFIG.POLL_INTERVAL_MS);
    }
  }

  // Check if we timed out while still running
  if (status !== 'SUCCEEDED') {
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    const error = new Error(
      `Search timed out after ${elapsedSec} seconds. The search is still running on Apify. ` +
      `Try again in a minute or search for fewer results.`
    );
    error.code = 'POLL_TIMEOUT';
    error.debug = { 
      stage: 'POLLING', 
      runId, 
      lastStatus: status, 
      elapsedMs: Date.now() - startTime,
      pollCount 
    };
    throw error;
  }

  // Get the results
  const datasetId = runData.data.defaultDatasetId;
  debugLog.add('FETCHING_RESULTS', `Fetching results from dataset ${datasetId}...`);
  
  const resultsResponse = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}`
  );

  if (!resultsResponse.ok) {
    const errorText = await resultsResponse.text();
    const error = new Error(`Failed to fetch Apify results: ${resultsResponse.status}`);
    error.code = 'RESULTS_FETCH_ERROR';
    error.debug = { stage: 'RESULTS_FETCH', datasetId, status: resultsResponse.status };
    throw error;
  }

  const results = await resultsResponse.json();
  const runDurationMs = Date.now() - startTime;
  const runDurationMin = runDurationMs / 60000;
  
  // Calculate estimated cost
  const estimatedCost = {
    baseCost: COST_ESTIMATE.BASE_RUN_COST,
    computeCost: runDurationMin * COST_ESTIMATE.PER_MINUTE_COMPUTE,
    resultsCost: results.length * COST_ESTIMATE.PER_RESULT,
    total: 0,
    runDurationSeconds: Math.round(runDurationMs / 1000),
    resultsCount: results.length
  };
  estimatedCost.total = estimatedCost.baseCost + estimatedCost.computeCost + estimatedCost.resultsCost;
  
  debugLog.add('RESULTS_FETCHED', `Fetched ${results.length} raw results in ${estimatedCost.runDurationSeconds}s`, {
    estimatedCost: `$${estimatedCost.total.toFixed(4)}`
  });

  return { ads: results, runId, cost: estimatedCost };
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
        processedAds.push(formatAdForResponse(existing));
        continue;
      }

      // Extract media URLs with multiple fallbacks
      let originalImageUrl = null;
      let originalVideoUrl = null;
      let mediaType = 'image';

      // Try multiple paths for video URLs
      if (rawAd.snapshot?.videos?.length > 0) {
        const video = rawAd.snapshot.videos[0];
        originalVideoUrl = video.video_hd_url || video.video_sd_url || video.video_url || video.url;
        mediaType = 'video';
      } else if (rawAd.video_url || rawAd.videoUrl) {
        originalVideoUrl = rawAd.video_url || rawAd.videoUrl;
        mediaType = 'video';
      }
      
      // Try multiple paths for image URLs
      if (rawAd.snapshot?.images?.length > 0) {
        originalImageUrl = rawAd.snapshot.images[0];
      } else if (rawAd.snapshot?.cards?.length > 0) {
        originalImageUrl = rawAd.snapshot.cards[0].original_image_url || rawAd.snapshot.cards[0].image_url;
        if (!originalVideoUrl) mediaType = 'carousel';
      } else if (rawAd.image_url || rawAd.imageUrl || rawAd.thumbnail_url) {
        originalImageUrl = rawAd.image_url || rawAd.imageUrl || rawAd.thumbnail_url;
      }

      // Upload to Cloudinary if configured (with timeout protection)
      let cloudinaryImageUrl = null;
      let cloudinaryVideoUrl = null;
      let cloudinaryThumbnailUrl = null;

      if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
        try {
          if (originalImageUrl) {
            cloudinaryImageUrl = await uploadToCloudinaryWithTimeout(originalImageUrl, 'image');
            if (cloudinaryImageUrl) {
              cloudinaryThumbnailUrl = cloudinaryImageUrl.replace('/upload/', '/upload/w_400,h_400,c_fill/');
            }
          }
          if (originalVideoUrl) {
            cloudinaryVideoUrl = await uploadToCloudinaryWithTimeout(originalVideoUrl, 'video');
            if (cloudinaryVideoUrl) {
              // Generate video thumbnail
              cloudinaryThumbnailUrl = cloudinaryVideoUrl
                .replace('/upload/', '/upload/w_400,h_400,c_fill,so_0/')
                .replace(/\.(mp4|webm|mov)$/i, '.jpg');
            }
          }
        } catch (cloudinaryError) {
          debugLog.add('CLOUDINARY_ERROR', `Failed to upload media: ${cloudinaryError.message}`);
          // Continue without Cloudinary URLs - we'll use originals as fallback
        }
      }

      // Extract ad copy with fallbacks
      const adCopy = rawAd.snapshot?.body?.text || rawAd.snapshot?.caption || rawAd.body || rawAd.text || '';
      const headline = rawAd.snapshot?.title || rawAd.title || rawAd.headline || '';
      const ctaText = rawAd.snapshot?.cta_text || rawAd.snapshot?.link_title || rawAd.cta_text || '';
      const ctaLink = rawAd.snapshot?.link_url || rawAd.link_url || '';

      // Extract dates
      const startDate = rawAd.startDate || rawAd.startDateFormatted || rawAd.start_date || null;
      const endDate = rawAd.endDate || rawAd.endDateFormatted || rawAd.end_date || null;
      const isActive = !endDate || new Date(endDate) > new Date();

      // Extract platforms
      const platforms = rawAd.publisherPlatform || rawAd.platforms || ['facebook'];

      // Extract reach/spend estimates
      const impressionsLower = rawAd.impressions?.lower_bound || rawAd.impressionsLowerBound || null;
      const impressionsUpper = rawAd.impressions?.upper_bound || rawAd.impressionsUpperBound || null;
      const spendLower = rawAd.spend?.lower_bound || rawAd.spendLowerBound || null;
      const spendUpper = rawAd.spend?.upper_bound || rawAd.spendUpperBound || null;
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
        rawAd.pageProfilePictureURL || rawAd.snapshot?.page_profile_picture_url || rawAd.page_profile_picture_url || null,
        adCopy,
        headline,
        rawAd.snapshot?.link_description || rawAd.description || '',
        ctaText,
        ctaLink,
        originalImageUrl,
        originalVideoUrl,
        cloudinaryImageUrl,
        cloudinaryVideoUrl,
        cloudinaryThumbnailUrl,
        mediaType,
        JSON.stringify(Array.isArray(platforms) ? platforms : [platforms]),
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
      debugLog.add('PROCESS_AD_ERROR', `Error processing ad: ${error.message}`);
      console.error('Error processing ad:', error);
    }
  }

  return processedAds;
}

/**
 * Upload media to Cloudinary with timeout
 */
async function uploadToCloudinaryWithTimeout(url, resourceType = 'image', timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const result = await uploadToCloudinary(url, resourceType, controller.signal);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      debugLog.add('CLOUDINARY_TIMEOUT', `Upload timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Upload media to Cloudinary
 */
async function uploadToCloudinary(url, resourceType = 'image', signal = null) {
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return null;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = 'competitor-spy';
    
    // Create signature
    const signatureString = `folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
    const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

    const formData = new FormData();
    formData.append('file', url);
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);
    formData.append('folder', folder);

    const fetchOptions = {
      method: 'POST',
      body: formData
    };
    
    if (signal) {
      fetchOptions.signal = signal;
    }

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
      fetchOptions
    );

    if (!response.ok) {
      const errorText = await response.text();
      debugLog.add('CLOUDINARY_UPLOAD_FAILED', `Upload failed: ${response.status}`, { error: errorText.slice(0, 100) });
      return null;
    }

    const data = await response.json();
    return data.secure_url;
  } catch (error) {
    debugLog.add('CLOUDINARY_ERROR', `Cloudinary upload error: ${error.message}`);
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
 * Format ad for API response with fallback URLs
 */
function formatAdForResponse(ad) {
  if (!ad) return null;
  
  // Determine best available media URLs (prefer Cloudinary, fallback to original)
  const videoUrl = ad.cloudinary_video_url || ad.original_video_url || null;
  const imageUrl = ad.cloudinary_image_url || ad.original_image_url || null;
  const thumbnailUrl = ad.cloudinary_thumbnail_url || imageUrl || null;
  
  return {
    ...ad,
    // Add convenience fields with fallbacks
    video_url: videoUrl,
    image_url: imageUrl,
    thumbnail_url: thumbnailUrl,
    // Parse JSON fields
    platforms: safeJsonParse(ad.platforms, []),
    countries: safeJsonParse(ad.countries, []),
    demographic_distribution: ad.demographic_distribution ? safeJsonParse(ad.demographic_distribution, null) : null,
    region_distribution: ad.region_distribution ? safeJsonParse(ad.region_distribution, null) : null,
    analysis: ad.analysis ? safeJsonParse(ad.analysis, null) : null,
    is_active: Boolean(ad.is_active),
    // Add media availability flags
    has_video: Boolean(videoUrl),
    has_image: Boolean(imageUrl),
    media_source: ad.cloudinary_video_url || ad.cloudinary_image_url ? 'cloudinary' : 'original'
  };
}

/**
 * Safely parse JSON with fallback
 */
function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
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

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get service health status
 */
export function getHealthStatus() {
  return {
    apifyConfigured: Boolean(APIFY_API_TOKEN),
    cloudinaryConfigured: Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET),
    config: {
      pollIntervalMs: CONFIG.POLL_INTERVAL_MS,
      maxPollTimeMs: CONFIG.MAX_POLL_TIME_MS,
      maxRetries: CONFIG.MAX_RETRIES
    }
  };
}
