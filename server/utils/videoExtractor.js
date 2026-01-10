import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execPromise = promisify(exec);

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  ytdlp: {
    timeout: 30000,      // 30 seconds
    retries: 2
  },
  puppeteer: {
    timeout: 20000,      // 20 seconds
    waitTime: 5000       // Wait for video to start loading
  },
  download: {
    timeout: 60000,      // 60 seconds
    maxSize: 50 * 1024 * 1024  // 50MB max
  }
};

// ============================================================================
// LOGGING
// ============================================================================
function log(level, method, message, data = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, method, message, ...data }));
}

// ============================================================================
// YT-DLP EXTRACTION (OPTIMIZED)
// ============================================================================
async function extractWithYtdlp(embedHtml, retryCount = 0) {
  if (!embedHtml) return null;

  // Extract Facebook URL from embed
  const match = embedHtml.match(/href=([^&"]+)/);
  if (!match) {
    log('warn', 'ytdlp', 'No URL found in embed HTML');
    return null;
  }

  const fbUrl = decodeURIComponent(match[1]);
  log('info', 'ytdlp', 'Attempting extraction', { url: fbUrl, retry: retryCount });

  try {
    // Optimized yt-dlp command with multiple fallbacks
    const commands = [
      // Try 1: Standard extraction
      `yt-dlp -g --no-warnings "${fbUrl}"`,
      // Try 2: With format selection
      `yt-dlp -g -f "best[ext=mp4]" --no-warnings "${fbUrl}"`,
      // Try 3: Force generic extractor
      `yt-dlp -g --extractor-args "facebook:format=dash" --no-warnings "${fbUrl}"`
    ];

    for (const cmd of commands) {
      try {
        const { stdout } = await execPromise(cmd, { timeout: CONFIG.ytdlp.timeout });
        const url = stdout.trim().split('\n')[0]; // Get first URL if multiple
        
        if (url && url.startsWith('http')) {
          log('info', 'ytdlp', 'Extraction successful', { url: url.substring(0, 100) });
          return url;
        }
      } catch (cmdErr) {
        continue; // Try next command
      }
    }

    throw new Error('All yt-dlp commands failed');

  } catch (err) {
    log('warn', 'ytdlp', 'Extraction failed', { error: err.message, retry: retryCount });
    
    // Retry once
    if (retryCount < CONFIG.ytdlp.retries) {
      await sleep(1000);
      return extractWithYtdlp(embedHtml, retryCount + 1);
    }
    
    return null;
  }
}

// ============================================================================
// PUPPETEER EXTRACTION (FALLBACK)
// ============================================================================
async function extractWithPuppeteer(embedHtml) {
  if (!embedHtml) return null;

  let browser = null;
  
  try {
    // Dynamic import to avoid loading if not needed
    const puppeteer = await import('puppeteer');
    
    // Extract embed URL
    const embedUrlMatch = embedHtml.match(/src="([^"]+)"/);
    if (!embedUrlMatch) {
      log('warn', 'puppeteer', 'No src URL found in embed');
      return null;
    }

    const embedUrl = embedUrlMatch[1].replace(/&amp;/g, '&');
    log('info', 'puppeteer', 'Starting browser', { url: embedUrl.substring(0, 100) });

    // Launch browser
    browser = await puppeteer.default.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let videoUrl = null;

    // Intercept network requests
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
      // Block unnecessary resources to speed up
      const type = request.resourceType();
      if (['image', 'stylesheet', 'font'].includes(type)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    page.on('response', async (response) => {
      const url = response.url();
      
      // Look for video URLs
      if (
        (url.includes('.mp4') || 
         url.includes('video.xx.fbcdn.net') ||
         url.includes('video.fxx') ||
         url.includes('fbcdn.net/v/')) &&
        !url.includes('.jpg') &&
        !url.includes('.png')
      ) {
        // Prefer higher quality
        if (!videoUrl || url.length > videoUrl.length) {
          videoUrl = url;
          log('info', 'puppeteer', 'Found video URL', { url: url.substring(0, 100) });
        }
      }
    });

    // Navigate to page
    await page.goto(embedUrl, { 
      waitUntil: 'networkidle2',
      timeout: CONFIG.puppeteer.timeout 
    });

    // Try to click play button if exists
    try {
      await page.click('[aria-label="Play"]', { timeout: 2000 });
    } catch (e) {
      // Play button might not exist or video autoplays
    }

    // Try alternative play buttons
    try {
      await page.click('[data-sigil="playInlineVideo"]', { timeout: 1000 });
    } catch (e) {}

    // Wait for video to start loading
    await sleep(CONFIG.puppeteer.waitTime);

    await browser.close();
    browser = null;

    if (videoUrl) {
      log('info', 'puppeteer', 'Extraction successful');
      return videoUrl;
    }

    log('warn', 'puppeteer', 'No video URL captured');
    return null;

  } catch (err) {
    log('error', 'puppeteer', 'Extraction failed', { error: err.message });
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

// ============================================================================
// DOWNLOAD VIDEO
// ============================================================================
async function downloadVideo(url) {
  if (!url) return null;

  log('info', 'download', 'Starting download', { url: url.substring(0, 100) });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.download.timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    
    if (buffer.byteLength > CONFIG.download.maxSize) {
      log('warn', 'download', 'Video too large', { size: buffer.byteLength });
      return null;
    }

    if (buffer.byteLength < 1000) {
      log('warn', 'download', 'Video too small (likely error page)', { size: buffer.byteLength });
      return null;
    }

    log('info', 'download', 'Download successful', { size: buffer.byteLength });
    return Buffer.from(buffer);

  } catch (err) {
    log('error', 'download', 'Download failed', { error: err.message });
    return null;
  }
}

// ============================================================================
// DOWNLOAD THUMBNAIL
// ============================================================================
async function downloadThumbnail(url) {
  if (!url) return null;

  log('info', 'thumbnail', 'Downloading', { url: url.substring(0, 100) });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    log('info', 'thumbnail', 'Download successful', { size: buffer.byteLength });
    return Buffer.from(buffer);

  } catch (err) {
    log('error', 'thumbnail', 'Download failed', { error: err.message });
    return null;
  }
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================
export async function extractAndDownloadMedia(options) {
  const { sourceUrl, embedHtml, thumbnailUrl } = options;
  
  log('info', 'extract', 'Starting media extraction', {
    hasSourceUrl: !!sourceUrl,
    hasEmbed: !!embedHtml,
    hasThumbnail: !!thumbnailUrl
  });

  // ATTEMPT 1: Direct source URL
  if (sourceUrl) {
    log('info', 'extract', 'Trying source URL');
    const buffer = await downloadVideo(sourceUrl);
    if (buffer) {
      return {
        success: true,
        type: 'video',
        method: 'source_url',
        data: buffer.toString('base64'),
        mimeType: 'video/mp4'
      };
    }
  }

  // ATTEMPT 2: yt-dlp extraction
  if (embedHtml) {
    log('info', 'extract', 'Trying yt-dlp');
    const ytdlpUrl = await extractWithYtdlp(embedHtml);
    if (ytdlpUrl) {
      const buffer = await downloadVideo(ytdlpUrl);
      if (buffer) {
        return {
          success: true,
          type: 'video',
          method: 'ytdlp',
          data: buffer.toString('base64'),
          mimeType: 'video/mp4'
        };
      }
    }
  }

  // ATTEMPT 3: Puppeteer extraction
  if (embedHtml) {
    log('info', 'extract', 'Trying Puppeteer');
    const puppeteerUrl = await extractWithPuppeteer(embedHtml);
    if (puppeteerUrl) {
      const buffer = await downloadVideo(puppeteerUrl);
      if (buffer) {
        return {
          success: true,
          type: 'video',
          method: 'puppeteer',
          data: buffer.toString('base64'),
          mimeType: 'video/mp4'
        };
      }
    }
  }

  // ATTEMPT 4: Thumbnail fallback
  if (thumbnailUrl) {
    log('info', 'extract', 'Falling back to thumbnail');
    const buffer = await downloadThumbnail(thumbnailUrl);
    if (buffer) {
      return {
        success: true,
        type: 'image',
        method: 'thumbnail',
        data: buffer.toString('base64'),
        mimeType: 'image/jpeg'
      };
    }
  }

  // ALL FAILED
  log('error', 'extract', 'All extraction methods failed');
  return {
    success: false,
    error: 'Could not extract video or thumbnail'
  };
}

// ============================================================================
// UTILITY
// ============================================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// UPDATE YT-DLP
// ============================================================================
export async function updateYtdlp() {
  try {
    await execPromise('yt-dlp -U', { timeout: 60000 });
    log('info', 'ytdlp', 'Updated successfully');
    return true;
  } catch (err) {
    log('warn', 'ytdlp', 'Update failed', { error: err.message });
    return false;
  }
}

// ============================================================================
// CHECK YT-DLP STATUS
// ============================================================================
export async function getYtdlpStatus() {
  try {
    const { stdout } = await execPromise('yt-dlp --version', { timeout: 5000 });
    return { installed: true, version: stdout.trim() };
  } catch (err) {
    return { installed: false, error: err.message };
  }
}
