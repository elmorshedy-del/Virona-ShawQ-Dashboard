// Facebook Ad Library Scraper - Robust DOM Extraction
// Focus on reliable DOM scraping instead of fragile API interception

import { Actor } from 'apify';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const CONFIG = {
  INITIAL_WAIT_MS: 8000,
  SCROLL_WAIT_MS: 3000,
  SCROLL_COUNT: 5,
  SCROLL_DISTANCE: 800
};

await Actor.init();

const input = await Actor.getInput() || {};
const {
  searchQuery = '',
  country = 'ALL',
  limit = 10,
  filterResults = true,
  debugMode = true
} = input;

const DEBUG = debugMode;

console.log(`[START] Searching for "${searchQuery}" in ${country}, limit ${limit}`);

let browser = null;

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

  // Navigate to Ad Library
  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(searchQuery)}&search_type=keyword_unordered&media_type=all`;
  
  console.log(`[NAV] Going to: ${url}`);
  
  await page.goto(url, { 
    waitUntil: 'networkidle2',
    timeout: 60000 
  });

  // Wait for page to fully load
  console.log('[WAIT] Waiting for ads to render...');
  await new Promise(resolve => setTimeout(resolve, CONFIG.INITIAL_WAIT_MS));

  // Take screenshot for debugging
  if (DEBUG) {
    console.log('[DEBUG] Page title:', await page.title());
  }

  // Scroll to load more ads - with early abort if we have enough
  for (let i = 0; i < CONFIG.SCROLL_COUNT; i++) {
    await page.evaluate((distance) => window.scrollBy(0, distance), CONFIG.SCROLL_DISTANCE);
    await new Promise(resolve => setTimeout(resolve, CONFIG.SCROLL_WAIT_MS));
    
    // Quick check: count ad cards to see if we have enough
    const adCount = await page.evaluate((search) => {
      const searchLower = search.toLowerCase();
      let count = 0;
      const divs = document.querySelectorAll('div');
      divs.forEach(div => {
        const text = div.innerText || '';
        const hasStartedRunning = text.includes('Started running');
        const hasImage = div.querySelector('img[src*="scontent"], img[src*="fbcdn"]');
        const rect = div.getBoundingClientRect();
        const isReasonableSize = rect.width > 200 && rect.width < 600 && rect.height > 100;
        
        // Check if it matches our search
        if (hasStartedRunning && hasImage && isReasonableSize) {
          if (text.toLowerCase().includes(searchLower)) {
            count++;
          }
        }
      });
      return count;
    }, searchQuery);
    
    console.log(`[SCROLL] ${i + 1}/${CONFIG.SCROLL_COUNT} - found ~${adCount} matching ads`);
    
    // Early abort if we have enough
    if (adCount >= limit) {
      console.log(`[ABORT] Found ${adCount} ads, stopping scroll early`);
      break;
    }
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Hover over ad cards to trigger lazy loading of images
  console.log('[HOVER] Triggering lazy load on visible elements...');
  await page.evaluate(() => {
    // Find all potential ad card images and hover to trigger load
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      const event = new MouseEvent('mouseover', { bubbles: true });
      img.dispatchEvent(event);
    });
    
    // Also trigger on divs that might contain background images
    const divs = document.querySelectorAll('div');
    divs.forEach(div => {
      const rect = div.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100 && rect.width < 600) {
        const event = new MouseEvent('mouseover', { bubbles: true });
        div.dispatchEvent(event);
      }
    });
  });
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Extract ads using multiple strategies
  const extractedAds = await page.evaluate((searchQuery, limit, debug) => {
    const ads = [];
    const searchLower = searchQuery.toLowerCase();
    
    // Log DOM structure for debugging
    if (debug) {
      console.log('[DOM] Document body length:', document.body.innerHTML.length);
    }

    // STRATEGY 1: Find ad containers by looking for specific patterns
    // Facebook Ad Library ad cards typically contain:
    // - A link to the page
    // - Image/video media
    // - "Started running" or date text
    // - Platform icons
    
    // Find all potential ad containers - they're typically divs with specific data attributes or structure
    const allDivs = document.querySelectorAll('div');
    const adContainers = [];
    
    allDivs.forEach(div => {
      // Check if this div looks like an ad card
      const text = div.innerText || '';
      const hasStartedRunning = text.includes('Started running');
      const hasDisclaimer = text.includes('Disclaimer');
      const hasImage = div.querySelector('img[src*="scontent"], img[src*="fbcdn"]');
      const hasVideo = div.querySelector('video');
      
      // Ad cards usually have a reasonable size and contain ad indicators
      const rect = div.getBoundingClientRect();
      const isReasonableSize = rect.width > 200 && rect.width < 600 && rect.height > 100;
      
      if ((hasStartedRunning || hasDisclaimer) && (hasImage || hasVideo) && isReasonableSize) {
        // Check it's not nested inside another already-found container
        let isNested = adContainers.some(container => container.contains(div) || div.contains(container));
        if (!isNested) {
          adContainers.push(div);
        }
      }
    });

    if (debug) {
      console.log('[STRATEGY 1] Found ad containers:', adContainers.length);
    }

    // Extract data from each ad container
    adContainers.slice(0, limit * 2).forEach((container, index) => {
      try {
        // Get page name - usually in a link or span at the top of the card
        let pageName = '';
        const links = container.querySelectorAll('a[href*="/ads/library/"]');
        links.forEach(link => {
          const text = link.innerText?.trim();
          if (text && text.length > 1 && text.length < 100 && !text.includes('See ad details')) {
            if (!pageName || text.length > pageName.length) {
              pageName = text;
            }
          }
        });
        
        // Fallback: look for spans with page name characteristics
        if (!pageName) {
          const spans = container.querySelectorAll('span');
          spans.forEach(span => {
            const text = span.innerText?.trim();
            if (text && text.length > 2 && text.length < 80) {
              // Page names are usually at the start and don't contain dates or common phrases
              if (!text.includes('Started') && !text.includes('Disclaimer') && 
                  !text.includes('Active') && !text.includes('Inactive') &&
                  !text.match(/^\d/) && !pageName) {
                pageName = text;
              }
            }
          });
        }

        // Get ad copy - look for text content more thoroughly
        let adCopy = '';
        
        // Method 1: Look for longer text blocks in spans/divs
        const textElements = container.querySelectorAll('span, div');
        textElements.forEach(el => {
          const text = el.innerText?.trim();
          if (text && text.length > 30 && text.length < 5000) {
            // Avoid dates, page names, and common UI text
            if (!text.includes('Started running') && 
                !text.includes('Disclaimer') &&
                !text.includes('See ad details') &&
                !text.includes('Library ID') &&
                !text.includes('About this ad') &&
                !text.match(/^(Active|Inactive)$/) &&
                text !== pageName) {
              // Prefer longer, more substantial text
              if (!adCopy || (text.length > adCopy.length && text.length < 1000)) {
                adCopy = text;
              }
            }
          }
        });
        
        // Method 2: Look for text that looks like ad copy (call to action patterns)
        if (!adCopy) {
          const allText = container.innerText || '';
          const lines = allText.split('\n').filter(l => l.trim().length > 20);
          for (const line of lines) {
            if (line.length > 30 && line.length < 500 &&
                !line.includes('Started') && 
                !line.includes('Disclaimer') &&
                !line.includes('Active') &&
                line !== pageName) {
              adCopy = line.trim();
              break;
            }
          }
        }

        // Clean up ad copy - take first paragraph if too long
        if (adCopy && adCopy.length > 500) {
          const firstPara = adCopy.split('\n')[0];
          if (firstPara.length > 50) adCopy = firstPara;
        }

        // Get images - check ALL possible locations
        const images = [];
        
        // 1. Regular img tags
        container.querySelectorAll('img').forEach(img => {
          const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
          if (src && (src.includes('scontent') || src.includes('fbcdn')) && 
              !src.includes('emoji') && !src.includes('static') && !src.includes('rsrc.php')) {
            images.push(src);
          }
        });
        
        // 2. Background images in style attributes
        container.querySelectorAll('[style*="background"]').forEach(el => {
          const style = el.getAttribute('style') || '';
          const urlMatch = style.match(/url\(['"]?(https:\/\/[^'")\s]+)['"]?\)/);
          if (urlMatch && (urlMatch[1].includes('scontent') || urlMatch[1].includes('fbcdn'))) {
            images.push(urlMatch[1]);
          }
        });
        
        // 3. Check for image URLs in any data attributes
        container.querySelectorAll('[data-src], [data-imgsrc], [data-thumb]').forEach(el => {
          ['data-src', 'data-imgsrc', 'data-thumb', 'data-highres'].forEach(attr => {
            const src = el.getAttribute(attr);
            if (src && (src.includes('scontent') || src.includes('fbcdn'))) {
              images.push(src);
            }
          });
        });
        
        // 4. Look for image URLs in the raw HTML of the container
        const containerHtml = container.innerHTML;
        const imgUrlMatches = containerHtml.match(/https:\/\/[^"'\s<>]+(?:scontent|fbcdn)[^"'\s<>]+\.(?:jpg|jpeg|png|webp)[^"'\s<>]*/gi) || [];
        imgUrlMatches.forEach(url => {
          // Clean up the URL (remove any trailing characters)
          const cleanUrl = url.split(/[&?]amp;/).join('&').replace(/&amp;/g, '&');
          if (!images.includes(cleanUrl) && !cleanUrl.includes('emoji') && !cleanUrl.includes('rsrc.php')) {
            images.push(cleanUrl);
          }
        });

        // Get videos - check ALL possible locations
        const videos = [];
        
        // 1. Regular video tags
        container.querySelectorAll('video').forEach(video => {
          const src = video.src || video.querySelector('source')?.src;
          if (src) videos.push(src);
        });
        
        // 2. Video URLs in data attributes
        container.querySelectorAll('[data-video-url], [data-src]').forEach(el => {
          const videoUrl = el.getAttribute('data-video-url') || el.getAttribute('data-video-src');
          if (videoUrl) videos.push(videoUrl);
        });
        
        // 3. Look for video URLs in raw HTML
        const videoUrlMatches = containerHtml.match(/https:\/\/[^"'\s<>]+\.(?:mp4|webm|mov)[^"'\s<>]*/gi) || [];
        videoUrlMatches.forEach(url => {
          const cleanUrl = url.split(/[&?]amp;/).join('&').replace(/&amp;/g, '&');
          if (!videos.includes(cleanUrl)) videos.push(cleanUrl);
        });
        
        // Also look for video poster images as fallback
        container.querySelectorAll('video[poster]').forEach(video => {
          if (video.poster && !images.includes(video.poster)) {
            images.push(video.poster);
          }
        });

        // Get start date
        let startDate = '';
        const dateMatch = container.innerText.match(/Started running on (\w+ \d+, \d{4})/);
        if (dateMatch) startDate = dateMatch[1];

        // Check if active
        const isActive = container.innerText.includes('Active') && !container.innerText.includes('Inactive');

        if (pageName || images.length > 0 || videos.length > 0) {
          if (debug) {
            console.log(`[AD_FOUND] pageName="${pageName}" images=${images.length} videos=${videos.length}`);
            if (images.length > 0) console.log(`[AD_IMAGES] ${images.slice(0, 2).join(' | ')}`);
          }
          ads.push({
            ad_id: `fb_${Date.now()}_${index}`,
            page_name: pageName || searchQuery,
            ad_copy: adCopy || '',
            original_image_url: images[0] || null,
            original_video_url: videos[0] || null,
            all_images: images,
            all_videos: videos,
            media_type: videos.length > 0 ? 'video' : (images.length > 0 ? 'image' : 'text'),
            platforms: ['facebook'],
            start_date: startDate || null,
            is_active: isActive
          });
        }
      } catch (e) {
        console.error('[EXTRACT ERROR]', e.message);
      }
    });

    // STRATEGY 2: If Strategy 1 failed, try extracting all images with nearby text
    if (ads.length === 0) {
      if (debug) console.log('[STRATEGY 2] Trying image-based extraction...');
      
      // Get all images including those from background-image styles
      const allImageUrls = new Set();
      
      // Regular img tags
      document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src');
        if (src && (src.includes('scontent') || src.includes('fbcdn')) && 
            !src.includes('emoji') && !src.includes('static.xx') && !src.includes('rsrc.php')) {
          allImageUrls.add(src);
        }
      });
      
      // Background images
      document.querySelectorAll('[style*="background"]').forEach(el => {
        const style = el.getAttribute('style') || '';
        const urlMatch = style.match(/url\(['"]?(https:\/\/[^'")\s]+)['"]?\)/);
        if (urlMatch && (urlMatch[1].includes('scontent') || urlMatch[1].includes('fbcdn'))) {
          allImageUrls.add(urlMatch[1]);
        }
      });
      
      // From raw HTML
      const htmlImgMatches = document.body.innerHTML.match(/https:\/\/[^"'\s<>]+(?:scontent|fbcdn)[^"'\s<>]+\.(?:jpg|jpeg|png|webp)[^"'\s<>]*/gi) || [];
      htmlImgMatches.forEach(url => {
        const cleanUrl = url.replace(/&amp;/g, '&');
        if (!cleanUrl.includes('emoji') && !cleanUrl.includes('rsrc.php')) {
          allImageUrls.add(cleanUrl);
        }
      });
      
      if (debug) console.log(`[STRATEGY 2] Found ${allImageUrls.size} unique images`);
      
      let index = 0;
      for (const src of allImageUrls) {
        if (index >= limit) break;
        
        // Find the image element to get surrounding context
        const img = document.querySelector(`img[src="${src}"]`) || 
                   document.querySelector(`[style*="${src.slice(0, 50)}"]`);
        
        let textContent = '';
        let pageName = '';
        
        if (img) {
          // Walk up the DOM to find text
          let parent = img.parentElement;
          for (let i = 0; i < 15 && parent; i++) {
            const text = parent.innerText || '';
            if (text.length > textContent.length && text.length < 2000) {
              textContent = text;
            }
            parent = parent.parentElement;
          }
        }
        
        // Try to extract page name from text
        const lines = textContent.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
          pageName = lines[0].trim();
          if (pageName.length > 80) pageName = pageName.slice(0, 80);
        }
        
        // Find ad copy
        let adCopy = '';
        lines.forEach(line => {
          if (line.length > 30 && line.length < 500 && line.length > adCopy.length && 
              !line.includes('Started') && !line.includes('Disclaimer') && line !== pageName) {
            adCopy = line;
          }
        });

        ads.push({
          ad_id: `fb_img_${Date.now()}_${index}`,
          page_name: pageName || searchQuery,
          ad_copy: adCopy || '',
          original_image_url: src,
          original_video_url: null,
          all_images: [src],
          all_videos: [],
          media_type: 'image',
          platforms: ['facebook'],
          start_date: null,
          is_active: true
        });
        
        index++;
      }
    }

    // STRATEGY 3: Direct XPath/selector targeting known FB structures
    if (ads.length === 0) {
      if (debug) console.log('[STRATEGY 3] Trying direct selectors...');
      
      // FB uses data-visualcompletion attributes
      const adCards = document.querySelectorAll('[data-visualcompletion="ignore-dynamic"]');
      
      adCards.forEach((card, index) => {
        if (index >= limit) return;
        
        const img = card.querySelector('img[src*="scontent"], img[src*="fbcdn"]');
        const text = card.innerText || '';
        
        if (img) {
          ads.push({
            ad_id: `fb_card_${Date.now()}_${index}`,
            page_name: text.split('\n')[0]?.trim().slice(0, 80) || searchQuery,
            ad_copy: '',
            original_image_url: img.src,
            original_video_url: null,
            all_images: [img.src],
            all_videos: [],
            media_type: 'image',
            platforms: ['facebook'],
            start_date: null,
            is_active: true
          });
        }
      });
    }

    return ads;
  }, searchQuery, limit, DEBUG);

  console.log(`[EXTRACTED] Found ${extractedAds.length} ads`);

  // Filter results if needed
  let finalAds = extractedAds;
  if (filterResults && searchQuery) {
    const searchLower = searchQuery.toLowerCase();
    finalAds = extractedAds.filter(ad => {
      const pageName = (ad.page_name || '').toLowerCase();
      const adCopy = (ad.ad_copy || '').toLowerCase();
      return pageName.includes(searchLower) || adCopy.includes(searchLower) || pageName === searchQuery.toLowerCase();
    });
    console.log(`[FILTERED] ${finalAds.length} ads match "${searchQuery}"`);
  }

  // Apply limit
  finalAds = finalAds.slice(0, limit);

  // Log results
  if (DEBUG) {
    finalAds.forEach((ad, i) => {
      console.log(`[AD ${i + 1}] ${ad.page_name} | img: ${ad.original_image_url ? 'YES' : 'NO'} | copy: ${ad.ad_copy?.slice(0, 50) || 'none'}`);
    });
  }

  if (finalAds.length > 0) {
    await Actor.pushData(finalAds);
    console.log(`[SAVED] Pushed ${finalAds.length} ads to dataset`);
    
    // Log summary of what was found
    const withImages = finalAds.filter(a => a.original_image_url).length;
    const withVideos = finalAds.filter(a => a.original_video_url).length;
    const withCopy = finalAds.filter(a => a.ad_copy && a.ad_copy.length > 10).length;
    console.log(`[SUMMARY] ${withImages} with images, ${withVideos} with videos, ${withCopy} with ad copy`);
    
    // If ads found but missing images, try to find images from page HTML
    if (withImages === 0) {
      console.log('[WARN] No images extracted, searching page HTML for image URLs...');
      const pageContent = await page.content();
      const allImgUrls = pageContent.match(/https:\/\/[^"'\s<>]+(?:scontent|fbcdn)[^"'\s<>]+\.(?:jpg|jpeg|png|webp)[^"'\s<>]*/gi) || [];
      const uniqueUrls = [...new Set(allImgUrls)].filter(u => !u.includes('emoji') && !u.includes('rsrc.php'));
      console.log(`[DEBUG] Found ${uniqueUrls.length} image URLs in page HTML`);
      if (uniqueUrls.length > 0) {
        console.log(`[DEBUG] Sample URLs: ${uniqueUrls.slice(0, 3).join(' | ')}`);
        
        // Assign images to ads that don't have them
        finalAds.forEach((ad, i) => {
          if (!ad.original_image_url && uniqueUrls[i]) {
            ad.original_image_url = uniqueUrls[i].replace(/&amp;/g, '&');
            ad.all_images = [ad.original_image_url];
            ad.media_type = 'image';
          }
        });
      }
    }
  } else {
    // Debug: capture page content
    const pageContent = await page.content();
    console.log('[DEBUG] Page HTML length:', pageContent.length);
    console.log('[DEBUG] Contains "scontent":', pageContent.includes('scontent'));
    console.log('[DEBUG] Contains "Started running":', pageContent.includes('Started running'));
    
    // Save a sample of the HTML for debugging
    const sampleHtml = pageContent.slice(0, 5000);
    
    await Actor.pushData([{
      error: 'No ads found',
      searchQuery,
      country,
      timestamp: new Date().toISOString(),
      debug_info: {
        page_html_length: pageContent.length,
        has_scontent: pageContent.includes('scontent'),
        has_started_running: pageContent.includes('Started running'),
        sample_html: sampleHtml
      }
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
