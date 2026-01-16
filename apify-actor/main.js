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

  // Extract ads - try to get raw HTML structure first
  console.log('Extracting ads...');
  
  // Wait more for dynamic content
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Debug: log page structure
  const debugInfo = await page.evaluate(() => {
    return {
      divCount: document.querySelectorAll('div').length,
      imgCount: document.querySelectorAll('img').length,
      hasArticles: document.querySelectorAll('[role="article"]').length,
      bodyText: document.body.innerText.slice(0, 1000)
    };
  });
  console.log('Page debug:', JSON.stringify(debugInfo));
  
  const ads = await page.evaluate((maxAds, searchTerm) => {
    const results = [];
    const searchLower = searchTerm.toLowerCase();
    
    // Facebook Ad Library uses complex nested divs
    // Look for ad cards by finding elements with specific patterns
    
    // Method 1: Find all links to ad library pages (these are usually page names)
    const pageLinks = document.querySelectorAll('a[href*="/ads/library/?"]');
    const processedIds = new Set();
    
    pageLinks.forEach((link, i) => {
      if (results.length >= maxAds * 3) return;
      
      try {
        // Get the parent container (go up several levels)
        let container = link;
        for (let j = 0; j < 10; j++) {
          if (container.parentElement) container = container.parentElement;
        }
        
        // Skip if we've seen this container
        const containerId = container.innerHTML.slice(0, 100);
        if (processedIds.has(containerId)) return;
        processedIds.add(containerId);
        
        // Extract page name from link
        const pageName = link.textContent?.trim() || '';
        
        // Find ad copy - look for longer text blocks
        let adCopy = '';
        const textNodes = container.querySelectorAll('span, div');
        textNodes.forEach(node => {
          const text = node.textContent?.trim() || '';
          // Ad copy is usually 50-2000 chars and not the page name
          if (text.length > 50 && text.length < 2000 && text !== pageName && text.length > adCopy.length) {
            // Skip if it looks like UI text
            if (!text.includes('Ad Library') && !text.includes('See ad details')) {
              adCopy = text;
            }
          }
        });
        
        // Find images
        const images = [];
        container.querySelectorAll('img').forEach(img => {
          const src = img.src || img.getAttribute('src');
          if (src && (src.includes('scontent') || src.includes('fbcdn')) && !src.includes('emoji')) {
            const width = img.naturalWidth || img.width || 0;
            if (width > 50 || src.includes('p720x720')) {
              images.push(src);
            }
          }
        });
        
        // Find videos
        const videos = [];
        container.querySelectorAll('video, video source').forEach(el => {
          const src = el.src || el.getAttribute('src');
          if (src) videos.push(src);
        });
        
        // Extract start date
        const containerText = container.textContent || '';
        const dateMatch = containerText.match(/Started running on ([A-Za-z]+ \d+, \d+)/);
        const startDate = dateMatch ? dateMatch[1] : null;
        
        // Platforms
        const platforms = [];
        if (containerText.includes('Facebook')) platforms.push('facebook');
        if (containerText.includes('Instagram')) platforms.push('instagram');
        
        // Only add if we have meaningful data
        if (pageName && pageName.length > 1) {
          results.push({
            ad_id: `fb_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
            page_name: pageName,
            ad_copy: adCopy || '',
            original_image_url: images[0] || null,
            original_video_url: videos[0] || null,
            all_images: images.slice(0, 5),
            all_videos: videos.slice(0, 3),
            media_type: videos.length > 0 ? 'video' : (images.length > 0 ? 'image' : 'text'),
            platforms: platforms.length > 0 ? platforms : ['facebook'],
            start_date: startDate,
            is_active: true
          });
        }
      } catch (e) {
        // Continue on error
      }
    });
    
    return results;
  }, limit, searchQuery);

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
