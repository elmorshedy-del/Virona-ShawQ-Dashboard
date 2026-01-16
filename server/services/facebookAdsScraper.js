// server/services/facebookAdsScraper.js
// Custom Facebook Ad Library Scraper using Puppeteer with Stealth

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

const DEBUG = true;
const log = (msg, data = null) => {
  if (DEBUG) console.log(`[FB-Scraper] ${msg}`, data ? JSON.stringify(data).slice(0, 200) : '');
};

/**
 * Scrape Facebook Ad Library for a brand
 * @param {string} searchQuery - Brand name to search
 * @param {object} options - { country, limit }
 * @returns {Promise<{ads: Array, error?: string}>}
 */
export async function scrapeAds(searchQuery, options = {}) {
  const { country = 'ALL', limit = 5 } = options;
  
  let browser = null;
  const ads = [];
  
  try {
    log('Starting browser...');
    
    // Use Puppeteer's bundled Chromium
    log('Launching browser...');
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--window-size=1920,1080'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Build the Ad Library URL
    const countryCode = country === 'ALL' ? 'ALL' : country;
    const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${countryCode}&q=${encodeURIComponent(searchQuery)}&search_type=keyword_unordered&media_type=all`;
    
    log('Navigating to:', url);
    
    // Navigate with extended timeout
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    log('Page loaded, waiting for content...');
    
    // Wait longer for Facebook's JS to load
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check page title to see if we're on the right page
    const pageTitle = await page.title();
    log('Page title:', pageTitle);
    
    // Get page content for debugging
    const pageText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    log('Page text preview:', pageText.slice(0, 200));
    
    // Check if Facebook is blocking us
    const pageContent = await page.content();
    if (pageContent.includes('login') || pageContent.includes('Log In') || pageContent.includes('Log into')) {
      log('Facebook requires login - bot might be blocked');
      return { ads: [], error: 'Facebook requires login - may be blocking automated access' };
    }
    
    if (pageContent.includes('No ads match') || pageContent.includes('no results')) {
      log('No ads found for this search');
      return { ads: [], message: 'No ads found for this search query' };
    }
    
    // Wait for ads to load (try multiple selectors)
    const adSelectors = [
      '[data-testid="ad_library_preview"]',
      'div[class*="_7jyr"]', // Common FB ad card class
      'div[class*="x1dr59a3"]', // Another FB class
      'div[role="article"]',
      'div[class*="xrvj5dj"]',
      'div[class*="x1lliihq"]',
    ];
    
    let foundSelector = null;
    for (const selector of adSelectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          foundSelector = selector;
          log(`Found ${elements.length} elements with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    if (!foundSelector) {
      log('Could not find ad elements with known selectors');
      
      // Try to find ANY divs with substantial content
      const divCount = await page.evaluate(() => {
        return document.querySelectorAll('div').length;
      });
      log(`Page has ${divCount} divs total`);
      
      return { ads: [], error: 'Could not find ad elements on page - Facebook may have changed layout' };
    }
    
    // Wait a bit more for all content to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Extract ads
    log('Extracting ad data...');
    
    const extractedAds = await page.evaluate((maxAds) => {
      const results = [];
      
      // Try to find ad containers
      const adContainers = document.querySelectorAll('[data-testid="ad_library_preview"], div[role="article"], .x1lliihq');
      
      for (let i = 0; i < Math.min(adContainers.length, maxAds); i++) {
        const container = adContainers[i];
        
        try {
          // Extract page name
          const pageNameEl = container.querySelector('a[href*="/ads/library/"] span, strong, h4');
          const pageName = pageNameEl?.textContent?.trim() || 'Unknown';
          
          // Extract ad copy
          const textEls = container.querySelectorAll('div[style*="webkit-line-clamp"], span[dir="auto"]');
          let adCopy = '';
          textEls.forEach(el => {
            const text = el.textContent?.trim();
            if (text && text.length > adCopy.length) {
              adCopy = text;
            }
          });
          
          // Extract images
          const images = [];
          container.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]').forEach(img => {
            if (img.src && !img.src.includes('emoji') && img.width > 50) {
              images.push(img.src);
            }
          });
          
          // Extract videos
          const videos = [];
          container.querySelectorAll('video source, video[src]').forEach(video => {
            const src = video.src || video.querySelector('source')?.src;
            if (src) videos.push(src);
          });
          
          // Extract start date
          const dateMatch = container.textContent?.match(/Started running on (\w+ \d+, \d+)/);
          const startDate = dateMatch ? dateMatch[1] : null;
          
          // Extract platforms
          const platforms = [];
          if (container.textContent?.includes('Facebook')) platforms.push('facebook');
          if (container.textContent?.includes('Instagram')) platforms.push('instagram');
          if (container.textContent?.includes('Messenger')) platforms.push('messenger');
          
          if (pageName !== 'Unknown' || adCopy || images.length > 0) {
            results.push({
              ad_id: `custom_${Date.now()}_${i}`,
              page_name: pageName,
              ad_copy: adCopy,
              original_image_url: images[0] || null,
              original_video_url: videos[0] || null,
              media_type: videos.length > 0 ? 'video' : 'image',
              platforms: platforms.length > 0 ? platforms : ['facebook'],
              start_date: startDate,
              is_active: true,
              source: 'custom_scraper'
            });
          }
        } catch (e) {
          console.error('Error extracting ad:', e);
        }
      }
      
      return results;
    }, limit);
    
    log(`Extracted ${extractedAds.length} ads`);
    
    // FILTER: Only keep ads that match the search query
    const searchLower = searchQuery.toLowerCase();
    const filteredAds = extractedAds.filter(ad => {
      const pageName = (ad.page_name || '').toLowerCase();
      const adCopy = (ad.ad_copy || '').toLowerCase();
      
      // Check if page name or ad copy contains the search term
      return pageName.includes(searchLower) || adCopy.includes(searchLower);
    });
    
    log(`Filtered to ${filteredAds.length} relevant ads (matched "${searchQuery}")`);
    
    // If no matches, return all with a warning
    if (filteredAds.length === 0 && extractedAds.length > 0) {
      log('No exact matches found, returning unfiltered results with warning');
      return { 
        ads: extractedAds,
        count: extractedAds.length,
        source: 'custom_puppeteer_scraper',
        warning: `No ads exactly matching "${searchQuery}" - showing all results`
      };
    }
    
    return { 
      ads: filteredAds,
      count: filteredAds.length,
      source: 'custom_puppeteer_scraper',
      filtered: true
    };
    
  } catch (error) {
    log('Scraper error:', error.message);
    return { 
      ads: [], 
      error: error.message 
    };
  } finally {
    if (browser) {
      await browser.close();
      log('Browser closed');
    }
  }
}

/**
 * Health check - verify scraper can run
 */
export async function healthCheck() {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process', '--no-zygote']
    });
    await browser.close();
    return { ok: true, message: 'Puppeteer working' };
  } catch (error) {
    return { ok: false, message: error.message };
  } finally {
    if (browser) await browser.close();
  }
}
