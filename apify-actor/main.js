// Facebook Ad Library Scraper - Custom Apify Actor
// Uses stealth Puppeteer + filtering to get relevant ads

import { Actor } from 'apify';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add stealth plugin
puppeteer.use(StealthPlugin());

await Actor.init();

// Get input
const input = await Actor.getInput() || {};
const {
  searchQuery = '',
  country = 'ALL',  // 'ALL' for global search, or country code like 'US'
  limit = 10,
  filterResults = true  // Only return ads matching searchQuery
} = input;

console.log(`Starting search for "${searchQuery}" in ${country}, limit ${limit}`);

let browser = null;

try {
  // Launch browser with Apify's proxy
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
  
  // Set viewport and user agent
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Build URL
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(searchQuery)}&search_type=keyword_unordered&media_type=all`;
  
  console.log(`Navigating to: ${url}`);
  
  await page.goto(url, { 
    waitUntil: 'networkidle2',
    timeout: 60000 
  });

  // Wait for content to load
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Check if blocked
  const pageContent = await page.content();
  if (pageContent.includes('login') || pageContent.includes('Log In')) {
    throw new Error('Facebook requires login - blocked');
  }

  // Extract ads
  console.log('Extracting ads...');
  
  const ads = await page.evaluate((maxAds) => {
    const results = [];
    
    // Try multiple selectors
    const containers = document.querySelectorAll('div[role="article"], div[class*="_7jyr"], div[class*="x1dr59a3"]');
    
    for (let i = 0; i < Math.min(containers.length, maxAds * 2); i++) {
      const container = containers[i];
      
      try {
        // Page name
        const pageNameEl = container.querySelector('a[href*="/ads/library/"] span, strong, h4, a[role="link"] span');
        const pageName = pageNameEl?.textContent?.trim() || '';
        
        // Ad copy - get longest text
        let adCopy = '';
        container.querySelectorAll('div[style*="webkit-line-clamp"], span[dir="auto"], div[dir="auto"]').forEach(el => {
          const text = el.textContent?.trim();
          if (text && text.length > adCopy.length) {
            adCopy = text;
          }
        });
        
        // Images
        const images = [];
        container.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]').forEach(img => {
          if (img.src && !img.src.includes('emoji') && img.width > 50) {
            images.push(img.src);
          }
        });
        
        // Videos  
        const videos = [];
        container.querySelectorAll('video source, video[src]').forEach(video => {
          const src = video.src || video.getAttribute('src');
          if (src) videos.push(src);
        });
        
        // Start date
        const dateMatch = container.textContent?.match(/Started running on (\w+ \d+, \d+)/);
        const startDate = dateMatch ? dateMatch[1] : null;
        
        // Platforms
        const platforms = [];
        const text = container.textContent || '';
        if (text.includes('Facebook')) platforms.push('facebook');
        if (text.includes('Instagram')) platforms.push('instagram');
        if (text.includes('Messenger')) platforms.push('messenger');
        
        if (pageName || adCopy || images.length > 0) {
          results.push({
            ad_id: `fb_${Date.now()}_${i}`,
            page_name: pageName,
            ad_copy: adCopy,
            original_image_url: images[0] || null,
            original_video_url: videos[0] || null,
            all_images: images,
            all_videos: videos,
            media_type: videos.length > 0 ? 'video' : (images.length > 0 ? 'image' : 'text'),
            platforms: platforms.length > 0 ? platforms : ['facebook'],
            start_date: startDate,
            is_active: true
          });
        }
      } catch (e) {
        console.error('Error extracting ad:', e);
      }
    }
    
    return results;
  }, limit);

  console.log(`Extracted ${ads.length} ads`);

  // Filter results to only include matching ads
  let finalAds = ads;
  if (filterResults && searchQuery) {
    const searchLower = searchQuery.toLowerCase();
    finalAds = ads.filter(ad => {
      const pageName = (ad.page_name || '').toLowerCase();
      const adCopy = (ad.ad_copy || '').toLowerCase();
      return pageName.includes(searchLower) || adCopy.includes(searchLower);
    });
    console.log(`Filtered to ${finalAds.length} matching ads`);
  }

  // Limit results
  finalAds = finalAds.slice(0, limit);

  // Push to dataset
  await Actor.pushData(finalAds);
  
  console.log(`Saved ${finalAds.length} ads to dataset`);

} catch (error) {
  console.error('Scraper error:', error.message);
  await Actor.pushData([{ error: error.message }]);
} finally {
  if (browser) {
    await browser.close();
  }
}

await Actor.exit();
