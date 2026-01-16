// Facebook Ad Library Scraper - Network Interception Approach
// Instead of fragile DOM scraping, we intercept Facebook's internal API responses

import { Actor } from 'apify';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

// Configuration constants for easier maintenance
const CONFIG = {
  INITIAL_WAIT_MS: 5000,
  SCROLL_WAIT_MS: 2000,
  SCROLL_COUNT: 3,
  SCROLL_DISTANCE: 1000,
  MAX_RECURSION_DEPTH: 10
};

await Actor.init();

const input = await Actor.getInput() || {};
const {
  searchQuery = '',
  country = 'ALL',
  limit = 10,
  filterResults = true
} = input;

console.log(`[START] Searching for "${searchQuery}" in ${country}, limit ${limit}`);

let browser = null;
const capturedAds = [];

try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // INTERCEPT NETWORK RESPONSES - This is the key!
  // Facebook's frontend loads ad data via GraphQL/API calls
  await page.setRequestInterception(true);
  
  page.on('request', request => {
    request.continue();
  });

  page.on('response', async response => {
    const url = response.url();
    
    // Facebook Ad Library API endpoints
    if (url.includes('api/graphql') || url.includes('ads_library') || url.includes('ad_library')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json') || contentType.includes('text')) {
          const text = await response.text();
          
          // Try to parse as JSON
          try {
            // Facebook sometimes wraps responses
            let data = text;
            if (text.startsWith('for (;;);')) {
              data = text.slice(9);
            }
            
            const json = JSON.parse(data);
            extractAdsFromResponse(json, capturedAds, searchQuery, filterResults);
          } catch (e) {
            // Not JSON, try to find JSON in text
            const jsonMatch = text.match(/\{[\s\S]*"ads"[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const json = JSON.parse(jsonMatch[0]);
                extractAdsFromResponse(json, capturedAds, searchQuery, filterResults);
              } catch (e2) {
                console.warn('[WARN] Failed to parse JSON from regex match:', e2.message);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[WARN] Could not read response body:', e.message);
      }
    }
  });

  // Navigate to Ad Library
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(searchQuery)}&search_type=keyword_unordered&media_type=all`;
  
  console.log(`[NAV] Going to: ${url}`);
  
  await page.goto(url, { 
    waitUntil: 'networkidle2',
    timeout: 60000 
  });

  // Wait for content and scroll to trigger more loads
  console.log('[WAIT] Waiting for ads to load...');
  await new Promise(resolve => setTimeout(resolve, CONFIG.INITIAL_WAIT_MS));
  
  // Scroll down to trigger lazy loading
  for (let i = 0; i < CONFIG.SCROLL_COUNT; i++) {
    await page.evaluate((distance) => window.scrollBy(0, distance), CONFIG.SCROLL_DISTANCE);
    await new Promise(resolve => setTimeout(resolve, CONFIG.SCROLL_WAIT_MS));
    console.log(`[SCROLL] Scroll ${i + 1}/3, captured ${capturedAds.length} ads so far`);
    
    if (capturedAds.length >= limit) break;
  }

  // If network interception didn't work, fall back to DOM scraping
  if (capturedAds.length === 0) {
    console.log('[FALLBACK] Network interception got 0 ads, trying DOM extraction...');
    
    const domAds = await page.evaluate((maxAds, search) => {
      const results = [];
      const searchLower = search.toLowerCase();
      
      // Get all text content and images from the page
      const allText = document.body.innerText;
      const allImages = Array.from(document.querySelectorAll('img'))
        .map(img => img.src)
        .filter(src => src && (src.includes('scontent') || src.includes('fbcdn')) && !src.includes('emoji'));
      
      // Find page names - they appear before "Disclaimer" or dates
      const pageNameMatches = allText.match(/([A-Za-z0-9\s&'.-]+)\s*(?:·|•|\|)\s*(?:Disclaimer|Inactive|Active)/g) || [];
      
      pageNameMatches.slice(0, maxAds).forEach((match, i) => {
        const pageName = match.split(/·|•|\|/)[0].trim();
        
        results.push({
          ad_id: `fb_dom_${Date.now()}_${i}`,
          page_name: pageName || 'Unknown',
          ad_copy: '',
          original_image_url: allImages[i] || null,
          original_video_url: null,
          media_type: allImages[i] ? 'image' : 'text',
          platforms: ['facebook'],
          start_date: null,
          is_active: true
        });
      });
      
      // If still nothing, create placeholder with images
      if (results.length === 0 && allImages.length > 0) {
        allImages.slice(0, maxAds).forEach((img, i) => {
          results.push({
            ad_id: `fb_img_${Date.now()}_${i}`,
            page_name: search,
            ad_copy: '',
            original_image_url: img,
            original_video_url: null,
            media_type: 'image',
            platforms: ['facebook'],
            start_date: null,
            is_active: true
          });
        });
      }
      
      return results;
    }, limit, searchQuery);
    
    capturedAds.push(...domAds);
  }

  console.log(`[DONE] Total ads captured: ${capturedAds.length}`);

  // Apply limit and push to dataset
  const finalAds = capturedAds.slice(0, limit);
  
  if (finalAds.length > 0) {
    await Actor.pushData(finalAds);
    console.log(`[SAVED] Pushed ${finalAds.length} ads to dataset`);
  } else {
    // Push error info
    await Actor.pushData([{
      error: 'No ads found',
      searchQuery,
      country,
      timestamp: new Date().toISOString()
    }]);
  }

} catch (error) {
  console.error('[ERROR]', error.message);
  await Actor.pushData([{ 
    error: error.message,
    searchQuery,
    country 
  }]);
} finally {
  if (browser) await browser.close();
}

await Actor.exit();

// Helper function to extract ads from Facebook API response
function extractAdsFromResponse(data, adsArray, searchQuery, filterResults) {
  const searchLower = searchQuery.toLowerCase();
  // Use Set for O(1) duplicate lookups instead of O(n) array.some()
  const seenAdKeys = new Set(adsArray.map(ad => `${ad.page_name}|${ad.ad_copy}`));
  
  // Recursively search for ad-like objects in the response
  function findAds(obj, depth = 0) {
    if (depth > CONFIG.MAX_RECURSION_DEPTH || !obj) return;
    
    if (Array.isArray(obj)) {
      obj.forEach(item => findAds(item, depth + 1));
      return;
    }
    
    if (typeof obj !== 'object') return;
    
    // Check if this looks like an ad object
    const hasAdIndicators = 
      obj.adArchiveID || 
      obj.ad_archive_id ||
      obj.adid ||
      obj.ad_id ||
      (obj.snapshot && (obj.snapshot.body || obj.snapshot.images)) ||
      (obj.pageName && obj.startDate) ||
      (obj.page_name && obj.ad_creative_bodies);
    
    if (hasAdIndicators) {
      // LOG THE RAW OBJECT TO SEE WHAT FACEBOOK RETURNS
      console.log('[RAW_AD_OBJECT]', JSON.stringify(obj).slice(0, 2000));
      
      const ad = parseAdObject(obj);
      
      // Filter if needed
      if (filterResults && searchQuery) {
        const pageName = (ad.page_name || '').toLowerCase();
        const adCopy = (ad.ad_copy || '').toLowerCase();
        if (!pageName.includes(searchLower) && !adCopy.includes(searchLower)) {
          return; // Skip non-matching ad
        }
      }
      
      // Avoid duplicates using Set for O(1) lookups
      const adKey = `${ad.page_name}|${ad.ad_copy}`;
      if (!seenAdKeys.has(adKey) && ad.page_name) {
        seenAdKeys.add(adKey);
        adsArray.push(ad);
        console.log(`[CAPTURED] Ad from "${ad.page_name}" | copy: "${ad.ad_copy?.slice(0, 100)}" | img: ${ad.original_image_url ? 'YES' : 'NO'}`);
      }
    }
    
    // Recurse into child objects
    Object.values(obj).forEach(value => findAds(value, depth + 1));
  }
  
  findAds(data);
}

// Parse various ad object formats into our standard format
function parseAdObject(obj) {
  // Handle different Facebook API response formats - try ALL possible field names
  const pageName = 
    obj.pageName || 
    obj.page_name || 
    obj.snapshot?.page_name ||
    obj.snapshot?.pageName ||
    obj.page?.name ||
    obj.page?.pageName ||
    obj.collationID ||  // Sometimes this contains page info
    findNestedValue(obj, ['pageName', 'page_name', 'name']) ||
    '';
  
  const adCopy = 
    obj.snapshot?.body?.text ||
    obj.snapshot?.body?.markup?.__html ||
    obj.snapshot?.body_with_entities?.text ||
    obj.ad_creative_bodies?.[0] ||
    obj.body?.text ||
    obj.bodyText ||
    obj.message ||
    obj.text ||
    findNestedValue(obj, ['body', 'text', 'message', 'ad_creative_bodies']) ||
    '';
  
  const images = [];
  // Try all possible image locations
  if (obj.snapshot?.images) images.push(...obj.snapshot.images);
  if (obj.snapshot?.resized_image_url) images.push(obj.snapshot.resized_image_url);
  if (obj.snapshot?.watermarked_resized_image_url) images.push(obj.snapshot.watermarked_resized_image_url);
  if (obj.snapshot?.cards) {
    obj.snapshot.cards.forEach(card => {
      if (card.original_image_url) images.push(card.original_image_url);
      if (card.resized_image_url) images.push(card.resized_image_url);
    });
  }
  if (obj.ad_snapshot_url) images.push(obj.ad_snapshot_url);
  if (obj.image_url) images.push(obj.image_url);
  if (obj.imageUrl) images.push(obj.imageUrl);
  
  // Find any URL that looks like an image
  const objStr = JSON.stringify(obj);
  const imageMatches = objStr.match(/https:\/\/[^"]+(?:scontent|fbcdn)[^"]+\.(?:jpg|jpeg|png|webp)/gi) || [];
  images.push(...imageMatches.slice(0, 5));
  
  const videos = [];
  if (obj.snapshot?.videos) {
    obj.snapshot.videos.forEach(v => {
      if (v.video_hd_url) videos.push(v.video_hd_url);
      if (v.video_sd_url) videos.push(v.video_sd_url);
      if (v.video_url) videos.push(v.video_url);
    });
  }
  if (obj.video_url) videos.push(obj.video_url);
  if (obj.videoUrl) videos.push(obj.videoUrl);
  
  // Find any URL that looks like a video
  const videoMatches = objStr.match(/https:\/\/[^"]+\.(?:mp4|webm|mov)/gi) || [];
  videos.push(...videoMatches.slice(0, 3));
  
  const startDate = 
    obj.startDate ||
    obj.start_date ||
    obj.ad_delivery_start_time ||
    obj.startDateText ||
    null;
  
  const platforms = 
    obj.publisherPlatform ||
    obj.publisher_platforms ||
    obj.platforms ||
    ['facebook'];

  console.log(`[PARSE] pageName="${pageName}" | adCopy="${(typeof adCopy === 'string' ? adCopy : '').slice(0, 50)}" | images=${images.length} | videos=${videos.length}`);
  
  return {
    ad_id: obj.adArchiveID || obj.ad_archive_id || obj.adid || obj.id || `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    page_name: pageName,
    ad_copy: typeof adCopy === 'string' ? adCopy : (Array.isArray(adCopy) ? adCopy[0] : ''),
    original_image_url: images[0] || null,
    original_video_url: videos[0] || null,
    all_images: [...new Set(images)], // Remove duplicates
    all_videos: [...new Set(videos)],
    media_type: videos.length > 0 ? 'video' : (images.length > 0 ? 'image' : 'text'),
    platforms: Array.isArray(platforms) ? platforms : [platforms],
    start_date: startDate,
    is_active: obj.isActive !== false && obj.is_active !== false
  };
}

// Helper to find a value in nested object by trying multiple keys
function findNestedValue(obj, keys, depth = 0) {
  if (depth > 5 || !obj) return null;
  
  for (const key of keys) {
    if (obj[key]) return obj[key];
  }
  
  if (typeof obj === 'object') {
    for (const value of Object.values(obj)) {
      const found = findNestedValue(value, keys, depth + 1);
      if (found) return found;
    }
  }
  
  return null;
}
