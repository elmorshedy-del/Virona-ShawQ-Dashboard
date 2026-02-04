import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as geminiVision from '../services/geminiVisionService.js';
import * as cloudinary from '../services/cloudinaryService.js';
import * as fbAdLibrary from '../services/fbAdLibraryService.js';
import * as fatigueService from '../services/fatigueService.js';
import * as auditorService from '../services/auditorService.js';
import { extractAndDownloadVideoFromUrl } from '../utils/videoExtractor.js';
import { getDb } from '../db/database.js';
import * as apifyService from '../services/apifyService.js';
import { isBrandCacheValid, getBrandCacheExpiry } from '../db/competitorSpyMigration.js';
import { getOrCreateStoreProfile } from '../services/storeProfileService.js';
import { detectVideoOverlays, getVideoOverlayAiHealth, isVideoOverlayAiConfigured } from '../services/videoOverlayAiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const router = express.Router();
const db = getDb();

const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// VIDEO OVERLAY EDITOR (VideoOverlayAI) - temp storage + helpers
// ============================================================================

const VIDEO_OVERLAY_TMP_DIR = path.join(os.tmpdir(), 'creative-studio', 'video-overlay');
const VIDEO_OVERLAY_UPLOADS_DIR = path.join(VIDEO_OVERLAY_TMP_DIR, 'uploads');
const VIDEO_OVERLAY_OUTPUTS_DIR = path.join(VIDEO_OVERLAY_TMP_DIR, 'outputs');

async function ensureVideoOverlayDirs() {
  await fs.promises.mkdir(VIDEO_OVERLAY_UPLOADS_DIR, { recursive: true });
  await fs.promises.mkdir(VIDEO_OVERLAY_OUTPUTS_DIR, { recursive: true });
}

function getUploadedVideoPath(videoId) {
  return path.join(VIDEO_OVERLAY_UPLOADS_DIR, videoId);
}

function getExportedVideoPath(exportId) {
  return path.join(VIDEO_OVERLAY_OUTPUTS_DIR, `${exportId}.mp4`);
}

function safeParseNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max) {
  const n = safeParseNumber(value, min);
  return Math.min(max, Math.max(min, n));
}

function normalizeOverlayKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHexColor(hex) {
  const normalized = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return { r, g, b, hex: `#${normalized.toLowerCase()}` };
}

function escapeDrawtext(text) {
  // drawtext parsing is `:` separated, and supports expansions by default.
  // We disable expansion and still escape chars that break parsing.
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

async function ffprobeVideoInfo(videoPath) {
  const { stdout: durationOut } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath
  ]);

  const duration = Math.max(0, safeParseNumber(String(durationOut).trim(), 0));

  const { stdout: streamOut } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    videoPath
  ]);

  const [widthStr, heightStr] = String(streamOut).trim().split('x');
  const width = Math.max(0, parseInt(widthStr || '0', 10) || 0);
  const height = Math.max(0, parseInt(heightStr || '0', 10) || 0);

  return { duration, width, height };
}

function buildSegmentsFromFrameKeys({ frames, durationSec, intervalSec }) {
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const segments = [];

  let current = null;
  for (const frame of sorted) {
    const key = normalizeOverlayKey(frame.overlay_text);
    if (!current) {
      current = { key, start: frame.t, end: frame.t, sample_t: frame.t, raw: frame.overlay_text || null };
      continue;
    }

    if (key === current.key) {
      current.end = frame.t;
      continue;
    }

    segments.push(current);
    current = { key, start: frame.t, end: frame.t, sample_t: frame.t, raw: frame.overlay_text || null };
  }

  if (current) segments.push(current);

  // Convert sampling points to time ranges using the next segment's start.
  const ranged = segments.map((seg, idx) => {
    const next = segments[idx + 1];
    const start = clampNumber(seg.start, 0, durationSec);
    const end = next ? clampNumber(next.start, start, durationSec) : durationSec;

    // Prefer the first sample time in the segment as the representative frame.
    const sample_t = clampNumber(seg.sample_t, start, end || durationSec);

    return {
      id: crypto.randomUUID(),
      key: seg.key,
      label: seg.raw || null,
      start,
      end,
      sample_t
    };
  });

  // Drop "no overlay" segments (empty keys) unless the whole video is empty.
  const withOverlay = ranged.filter(seg => seg.key);
  if (withOverlay.length > 0) return withOverlay;
  return ranged;
}

function toOverlayBox(det, { startTime, endTime } = {}) {
  const font = det?.font || {};
  const colors = det?.colors || {};
  const backgroundHex = colors?.background?.hex || '#333333';
  const textHex = colors?.text?.hex || '#ffffff';

  return {
    id: crypto.randomUUID(),
    x: det?.x ?? 0,
    y: det?.y ?? 0,
    width: det?.width ?? 0,
    height: det?.height ?? 0,
    text: det?.text || 'Detected',
    backgroundColor: backgroundHex,
    textColor: textHex,
    fontSize: font?.size || 24,
    fontWeight: font?.weight || 'normal',
    fontStyle: font?.style || 'normal',
    fontFamily: (font?.suggested_fonts && font.suggested_fonts[0]) || 'Inter',
    isGradient: Boolean(colors?.is_gradient),
    gradient: colors?.gradient || null,
    confidence: det?.confidence ?? 0.9,
    startTime: typeof startTime === 'number' ? startTime : null,
    endTime: typeof endTime === 'number' ? endTime : null
  };
}

const LOCALE_LABELS = {
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'ar-SA': 'Arabic (Saudi)',
  'ar-AE': 'Arabic (UAE)',
  'ar-EG': 'Arabic (Egypt)',
  'ar-TN': 'Arabic (Tunisia)',
  'ar-MA': 'Arabic (Morocco)',
  'es-ES': 'Spanish (ES)',
  'es-419': 'Spanish (LATAM)',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'zh-HK': 'Chinese (HK)',
  'ko-KR': 'Korean',
  'ja-JP': 'Japanese',
  'fr-FR': 'French',
  'it-IT': 'Italian'
};

const COUNTRY_TO_LOCALE = {
  SA: 'ar-SA',
  AE: 'ar-AE',
  EG: 'ar-EG',
  TN: 'ar-TN',
  MA: 'ar-MA',
  US: 'en-US',
  GB: 'en-GB',
  CA: 'en-US',
  AU: 'en-GB',
  NZ: 'en-GB',
  ES: 'es-ES',
  MX: 'es-419',
  AR: 'es-419',
  CO: 'es-419',
  CL: 'es-419',
  PE: 'es-419',
  BR: 'en-US',
  FR: 'fr-FR',
  IT: 'it-IT',
  CN: 'zh-CN',
  TW: 'zh-TW',
  HK: 'zh-HK',
  JP: 'ja-JP',
  KR: 'ko-KR'
};

const DEFAULT_RECOMMENDED = ['ar-SA', 'en-US', 'es-419'];

function buildRecommendedLocales(store) {
  const rawRows = db.prepare(`
    SELECT country_code as country, COUNT(*) as orders, SUM(order_total) as revenue
    FROM salla_orders
    WHERE store = ? AND country_code IS NOT NULL AND country_code != ''
    GROUP BY country_code
    UNION ALL
    SELECT country_code as country, COUNT(*) as orders, SUM(subtotal) as revenue
    FROM shopify_orders
    WHERE store = ? AND country_code IS NOT NULL AND country_code != ''
    GROUP BY country_code
    UNION ALL
    SELECT country as country, SUM(orders_count) as orders, SUM(revenue) as revenue
    FROM manual_orders
    WHERE store = ? AND country IS NOT NULL AND country != ''
    GROUP BY country
  `).all(store, store, store);

  const countryMap = new Map();
  rawRows.forEach(row => {
    const code = (row.country || '').toUpperCase().trim();
    if (!code) return;
    if (!countryMap.has(code)) {
      countryMap.set(code, { country: code, orders: 0, revenue: 0 });
    }
    const existing = countryMap.get(code);
    existing.orders += row.orders || 0;
    existing.revenue += row.revenue || 0;
  });

  const sorted = Array.from(countryMap.values())
    .filter(row => row.orders > 0 || row.revenue > 0)
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || (b.orders || 0) - (a.orders || 0));

  const significant = sorted.filter(row => row.orders >= 2 || row.revenue >= 100);
  const topCountries = (significant.length ? significant : sorted).slice(0, 3);

  if (topCountries.length === 0) {
    return DEFAULT_RECOMMENDED.map((locale, index) => ({
      value: locale,
      label: LOCALE_LABELS[locale] || locale,
      rank: index + 1
    }));
  }

  return topCountries.map((row, index) => {
    const locale = COUNTRY_TO_LOCALE[row.country] || 'en-US';
    return {
      value: locale,
      label: LOCALE_LABELS[locale] || locale,
      rank: index + 1,
      country: row.country,
      orders: row.orders,
      revenue: row.revenue
    };
  });
}

// ============================================================================
// META CONNECTION STATUS
// ============================================================================

router.get('/meta-status', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const db = getDb();

    const hasData = db.prepare(`
      SELECT COUNT(*) as count FROM meta_daily_metrics WHERE store = ?
    `).get(store);

    res.json({
      connected: hasData.count > 0,
      store
    });
  } catch (error) {
    console.error('Meta status error:', error);
    res.status(500).json({ connected: false, error: error.message });
  }
});

// ============================================================================
// GEMINI PROXY (Ad Studio)
// ============================================================================

router.post('/gemini', async (req, res) => {
  try {
    const { model, payload } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    if (!payload) {
      return res.status(400).json({ error: 'Payload is required.' });
    }

    const resolvedModel = model || 'gemini-2.5-flash-preview-09-2025';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    return res.json(response.data);
  } catch (error) {
    console.error('Gemini proxy error:', error?.response?.data || error.message);
    return res.status(500).json({ error: error?.response?.data?.error?.message || error.message });
  }
});

// ============================================================================
// STORE PROFILE (Summary + Logo)
// ============================================================================

router.get('/store-profile', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const storeUrl = req.query.store_url || req.query.storeUrl || null;
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    const profile = await getOrCreateStoreProfile(store, { storeUrl, forceRefresh });
    if (profile.error) {
      return res.status(400).json({ success: false, error: profile.error });
    }

    return res.json({ success: true, profile, generated: profile.generated });
  } catch (error) {
    console.error('Store profile error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// RECOMMENDED LOCALES
// ============================================================================

router.get('/recommended-locales', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const locales = buildRecommendedLocales(store);
    res.json({ success: true, locales });
  } catch (error) {
    console.error('Recommended locales error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ============================================================================
// CREATIVES CRUD
// ============================================================================

// Save new creative
router.post('/creatives', async (req, res) => {
  try {
    const { name, type, layout, content, style, thumbnail_url, image_url, product_id, source } = req.body;

    const stmt = db.prepare(`
      INSERT INTO studio_creatives (name, type, layout, content, style, thumbnail_url, image_url, product_id, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name || 'Untitled',
      type || 'post',
      layout || 'centered',
      JSON.stringify(content || {}),
      JSON.stringify(style || {}),
      thumbnail_url,
      image_url,
      product_id,
      source || 'manual'
    );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Creative saved successfully'
    });
  } catch (error) {
    console.error('Save creative error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all creatives
router.get('/creatives', async (req, res) => {
  try {
    const { type, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM studio_creatives';
    const params = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const creatives = db.prepare(query).all(...params);

    // Parse JSON fields
    const parsed = creatives.map(c => ({
      ...c,
      content: JSON.parse(c.content || '{}'),
      style: JSON.parse(c.style || '{}')
    }));

    res.json({ success: true, creatives: parsed });
  } catch (error) {
    console.error('Get creatives error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete creative
router.delete('/creatives/:id', async (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM studio_creatives WHERE id = ?').run(id);
    res.json({ success: true, message: 'Creative deleted' });
  } catch (error) {
    console.error('Delete creative error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// STYLE EXTRACTOR
// ============================================================================

router.post('/extract-style', upload.single('image'), async (req, res) => {
  try {
    let imageBase64;

    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    } else if (req.body.image_url) {
      imageBase64 = await cloudinary.fetchAsBase64(req.body.image_url);
    } else {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    const style = await geminiVision.extractStyle(imageBase64);

    res.json({ success: true, style });
  } catch (error) {
    console.error('Style extraction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// ============================================================================
// COMPETITOR SPY (Apify-powered)
// ============================================================================

// Health check and debug info for competitor spy
router.get('/competitor/health', async (req, res) => {
  try {
    const health = apifyService.getHealthStatus();
    const debugLogs = apifyService.getDebugLogs(20);
    
    res.json({
      success: true,
      health,
      recentLogs: debugLogs,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get debug logs
router.get('/competitor/debug-logs', async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 50;
    const logs = apifyService.getDebugLogs(count);
    res.json({ success: true, logs, count: logs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search for competitor ads
router.get('/competitor/search', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { brand_name, country = 'ALL', force_refresh = 'false', limit = '2' } = req.query;

    if (!brand_name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Brand name required',
        errorCode: 'MISSING_BRAND_NAME'
      });
    }

    const result = await apifyService.searchByBrand(store, brand_name, {
      country,
      forceRefresh: force_refresh === 'true',
      limit: Math.min(parseInt(limit) || 10, 50)
    });

    res.json({
      success: true,
      ads: result.ads,
      count: result.ads.length,
      from_cache: result.fromCache,
      stale: result.stale || false,
      cache_info: result.cacheInfo,
      cost: result.cost || null,
      debug: result.debug || null,
      // Include any non-fatal errors
      warning: result.error || null
    });
  } catch (error) {
    console.error('Competitor search error:', error);
    
    // Return detailed error info
    res.status(500).json({ 
      success: false, 
      error: error.message,
      errorCode: error.code || 'UNKNOWN_ERROR',
      debug: error.debug || null,
      suggestion: getErrorSuggestion(error.code)
    });
  }
});

// Helper to provide user-friendly error suggestions
function getErrorSuggestion(errorCode) {
  const suggestions = {
    'CONFIG_ERROR': 'Contact support - the API is not properly configured.',
    'AUTH_ERROR': 'Contact support - the API authentication has failed.',
    'CREDITS_ERROR': 'The search service is temporarily unavailable. Try again later.',
    'ACTOR_START_ERROR': 'The search service is temporarily unavailable. Try again in a few minutes.',
    'NETWORK_ERROR': 'Check your internet connection and try again.',
    'ACTOR_FAILED': 'The search failed. Try a different brand name or country.',
    'ACTOR_ABORTED': 'The search was interrupted. Please try again.',
    'ACTOR_TIMEOUT': 'The search took too long. Try searching with fewer results.',
    'POLL_TIMEOUT': 'The search is still processing. Wait a minute and try again, or search for fewer results.',
    'RESULTS_FETCH_ERROR': 'Failed to retrieve results. Please try again.'
  };
  return suggestions[errorCode] || 'An unexpected error occurred. Please try again.';
}

// Force refresh brand search
router.post('/competitor/refresh', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { brand_name, country = 'ALL' } = req.body;

    if (!brand_name) {
      return res.status(400).json({ success: false, error: 'Brand name required' });
    }

    const result = await apifyService.searchByBrand(store, brand_name, {
      country,
      forceRefresh: true
    });

    res.json({
      success: true,
      ads: result.ads,
      count: result.ads.length,
      cache_info: result.cacheInfo
    });
  } catch (error) {
    console.error('Competitor refresh error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single ad details
router.get('/competitor/ad/:ad_id', async (req, res) => {
  try {
    const ad = apifyService.getAdById(req.params.ad_id);
    if (!ad) {
      return res.status(404).json({ success: false, error: 'Ad not found' });
    }
    res.json({ success: true, ad });
  } catch (error) {
    console.error('Get ad error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get supported countries
router.get('/competitor/countries', (req, res) => {
  res.json({ success: true, countries: apifyService.getSupportedCountries() });
});

// Analyze competitor ad
router.post('/competitor/analyze', async (req, res) => {
  try {
    const { ad_id, image_url, snapshot_url, brand_name } = req.body;

    // Check if ad already has cached analysis
    if (ad_id) {
      const existingAd = apifyService.getAdById(ad_id);
      if (existingAd?.analysis) {
        return res.json({ success: true, analysis: existingAd.analysis, from_cache: true });
      }
    }

    let analysis;
    if (snapshot_url) {
      const videoResult = await extractAndDownloadVideoFromUrl(snapshot_url);
      if (videoResult.success) {
        analysis = await geminiVision.analyzeCompetitorVideo(videoResult.data);
      } else {
        return res.status(400).json({ success: false, error: videoResult.error });
      }
    } else if (image_url) {
      const imageBase64 = await cloudinary.fetchAsBase64(image_url);
      analysis = await geminiVision.analyzeCompetitorAd(imageBase64);
    } else {
      return res.status(400).json({ success: false, error: 'No image or video URL provided' });
    }

    // Cache analysis to ad if ad_id provided
    if (ad_id) {
      apifyService.saveAnalysisToAd(ad_id, analysis);
    }

    res.json({ success: true, analysis, from_cache: false });
  } catch (error) {
    console.error('Competitor analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get past analyses
router.get('/competitor/analyses', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { limit = 20 } = req.query;
    const ads = apifyService.getAdsWithAnalysis(store, parseInt(limit));
    res.json({ success: true, analyses: ads });
  } catch (error) {
    console.error('Get analyses error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SWIPE FILES CRUD
router.get('/competitor/swipe-files', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const db = getDb();
    const files = db.prepare('SELECT * FROM competitor_swipe_files WHERE store = ? ORDER BY created_at DESC').all(store);
    const filesWithCount = files.map(f => {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM competitor_saved_ads WHERE swipe_file_id = ?').get(f.id);
      return { ...f, ad_count: count.cnt };
    });
    res.json({ success: true, swipe_files: filesWithCount });
  } catch (error) {
    console.error('Get swipe files error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/competitor/swipe-files', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { name, description, color, icon } = req.body;
    const db = getDb();
    const result = db.prepare('INSERT INTO competitor_swipe_files (store, name, description, color, icon) VALUES (?, ?, ?, ?, ?)').run(store, name, description || null, color || '#6366f1', icon || '📁');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create swipe file error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/competitor/swipe-files/:id', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { name, description, color, icon } = req.body;
    const db = getDb();
    db.prepare('UPDATE competitor_swipe_files SET name = ?, description = ?, color = ?, icon = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store = ?').run(name, description, color, icon, req.params.id, store);
    res.json({ success: true });
  } catch (error) {
    console.error('Update swipe file error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/competitor/swipe-files/:id', async (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM competitor_swipe_files WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete swipe file error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/competitor/swipe-files/:id/ads', async (req, res) => {
  try {
    const db = getDb();
    const saved = db.prepare('SELECT ca.*, csa.notes, csa.tags, csa.saved_at FROM competitor_saved_ads csa JOIN competitor_ads ca ON csa.ad_id = ca.ad_id WHERE csa.swipe_file_id = ? ORDER BY csa.saved_at DESC').all(req.params.id);
    const ads = saved.map(a => ({ ...a, platforms: JSON.parse(a.platforms || '[]'), analysis: a.analysis ? JSON.parse(a.analysis) : null }));
    res.json({ success: true, ads });
  } catch (error) {
    console.error('Get swipe file ads error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/competitor/swipe-files/:id/ads', async (req, res) => {
  try {
    const { ad_id, notes, tags } = req.body;
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO competitor_saved_ads (swipe_file_id, ad_id, notes, tags) VALUES (?, ?, ?, ?)').run(req.params.id, ad_id, notes || null, JSON.stringify(tags || []));
    res.json({ success: true });
  } catch (error) {
    console.error('Save ad to swipe file error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/competitor/swipe-files/:id/ads/:ad_id', async (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM competitor_saved_ads WHERE swipe_file_id = ? AND ad_id = ?').run(req.params.id, req.params.ad_id);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove ad from swipe file error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// TRACKED BRANDS
router.get('/competitor/tracked-brands', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const db = getDb();
    const brands = db.prepare('SELECT * FROM competitor_tracked_brands WHERE store = ? AND is_active = 1 ORDER BY created_at DESC').all(store);
    res.json({ success: true, tracked_brands: brands });
  } catch (error) {
    console.error('Get tracked brands error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/competitor/tracked-brands', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { brand_name, country, check_frequency } = req.body;
    const db = getDb();
    const result = db.prepare('INSERT OR REPLACE INTO competitor_tracked_brands (store, brand_name, country, check_frequency) VALUES (?, ?, ?, ?)').run(store, brand_name, country || 'ALL', check_frequency || 'daily');
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add tracked brand error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/competitor/tracked-brands/:id/check', async (req, res) => {
  try {
    const db = getDb();
    const brand = db.prepare('SELECT * FROM competitor_tracked_brands WHERE id = ?').get(req.params.id);
    if (!brand) return res.status(404).json({ success: false, error: 'Brand not found' });
    const result = await apifyService.searchByBrand(brand.store, brand.brand_name, { country: brand.country, forceRefresh: true });
    const newCount = result.ads.length - brand.total_ads_found;
    db.prepare('UPDATE competitor_tracked_brands SET last_checked_at = CURRENT_TIMESTAMP, total_ads_found = ?, new_ads_since_last_check = ? WHERE id = ?').run(result.ads.length, Math.max(0, newCount), req.params.id);
    res.json({ success: true, new_ads: Math.max(0, newCount), total: result.ads.length });
  } catch (error) {
    console.error('Check tracked brand error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/competitor/tracked-brands/:id', async (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE competitor_tracked_brands SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete tracked brand error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ONBOARDING
router.get('/onboarding/:feature/:element', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { feature, element } = req.params;
    const db = getDb();
    const dismissed = db.prepare('SELECT * FROM user_onboarding WHERE store = ? AND feature = ? AND element = ?').get(store, feature, element);
    res.json({ success: true, should_show: !dismissed });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/onboarding/:feature/:element/dismiss', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { feature, element } = req.params;
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO user_onboarding (store, feature, element) VALUES (?, ?, ?)').run(store, feature, element);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate brief from competitor ad
router.post('/competitor/to-brief', async (req, res) => {
  try {
    const { ad_id, analysis } = req.body;
    const brief = {
      product_name: analysis?.creative_brief?.brand || '',
      product_description: analysis?.creative_brief?.key_message || '',
      target_audience: analysis?.target_audience_signals?.demographics || '',
      objective: analysis?.creative_brief?.objective || '',
      inspiration_ad_id: ad_id
    };
    res.json({ success: true, brief });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// HOOK GENERATOR
// ============================================================================

router.post('/generate/hooks', async (req, res) => {
  try {
    const { product_name, product_description, target_audience, tone = 'professional', count = 20 } = req.body;

    if (!product_name || !product_description) {
      return res.status(400).json({ success: false, error: 'Product name and description required' });
    }

    const hooks = await geminiVision.generateHooks({
      product_name,
      product_description,
      target_audience: target_audience || 'general audience',
      tone,
      count: Math.min(count, 30)
    });

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO generated_content (type, input, output, model_used)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      'hook',
      JSON.stringify({ product_name, product_description, target_audience, tone }),
      JSON.stringify(hooks),
      'gemini-2.0-flash'
    );

    res.json({ success: true, hooks });
  } catch (error) {
    console.error('Hook generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// UGC SCRIPT WRITER
// ============================================================================

router.post('/generate/script', async (req, res) => {
  try {
    const {
      product_name,
      product_benefits,
      target_audience,
      duration = '30s',
      style = 'testimonial'
    } = req.body;

    if (!product_name || !product_benefits) {
      return res.status(400).json({ success: false, error: 'Product name and benefits required' });
    }

    const script = await geminiVision.generateUGCScript({
      product_name,
      product_benefits,
      target_audience: target_audience || 'general audience',
      duration,
      style
    });

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO generated_content (type, input, output, model_used)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      'script',
      JSON.stringify({ product_name, product_benefits, target_audience, duration, style }),
      JSON.stringify(script),
      'gemini-2.0-flash'
    );

    res.json({ success: true, script });
  } catch (error) {
    console.error('Script generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// AD COPY LOCALIZER
// ============================================================================

router.post('/localize', async (req, res) => {
  try {
    const {
      text,
      source_lang = 'en',
      target_lang = 'ar',
      context = 'ecommerce',
      target_region = 'GCC'
    } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: 'Text required' });
    }

    const localized = await geminiVision.localizeAdCopy({
      text,
      source_lang,
      target_lang,
      context,
      target_region
    });

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO generated_content (type, input, output, model_used)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      'localization',
      JSON.stringify({ text, source_lang, target_lang, context }),
      JSON.stringify(localized),
      'gemini-2.0-flash'
    );

    res.json({ success: true, localized });
  } catch (error) {
    console.error('Localization error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CREATIVE BRIEF GENERATOR
// ============================================================================

router.post('/generate/brief', async (req, res) => {
  try {
    const {
      product_name,
      product_description,
      target_audience,
      objective,
      budget_level = 'medium'
    } = req.body;

    if (!product_name || !objective) {
      return res.status(400).json({ success: false, error: 'Product name and objective required' });
    }

    const brief = await geminiVision.generateCreativeBrief({
      product_name,
      product_description: product_description || '',
      target_audience: target_audience || 'general audience',
      objective,
      budget_level
    });

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO generated_content (type, input, output, model_used)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      'brief',
      JSON.stringify({ product_name, product_description, target_audience, objective }),
      JSON.stringify(brief),
      'gemini-2.0-flash'
    );

    res.json({ success: true, brief });
  } catch (error) {
    console.error('Brief generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// THUMBNAIL A/B PREDICTOR
// ============================================================================

router.post('/predict/thumbnails', upload.array('images', 4), async (req, res) => {
  try {
    const images = [];

    // Handle uploaded files
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        images.push(file.buffer.toString('base64'));
      }
    }

    // Handle URLs
    if (req.body.image_urls) {
      const urls = Array.isArray(req.body.image_urls) ? req.body.image_urls : [req.body.image_urls];
      for (const url of urls) {
        const base64 = await cloudinary.fetchAsBase64(url);
        images.push(base64);
      }
    }

    if (images.length < 2) {
      return res.status(400).json({ success: false, error: 'At least 2 images required for comparison' });
    }

    const predictions = await geminiVision.predictThumbnails(images);

    res.json({ success: true, predictions });
  } catch (error) {
    console.error('Thumbnail prediction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// AD IMPROVER
// ============================================================================

router.post('/improve', upload.single('image'), async (req, res) => {
  try {
    let imageBase64;

    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    } else if (req.body.image_url) {
      imageBase64 = await cloudinary.fetchAsBase64(req.body.image_url);
    } else {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    const improvements = await geminiVision.analyzeAndImprove(imageBase64);

    res.json({ success: true, improvements });
  } catch (error) {
    console.error('Ad improvement error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// VIDEO RESIZER
// ============================================================================

// Upload video
router.post('/video/upload', upload.single('video'), async (req, res) => {
  try {
    if (!cloudinary.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME with either CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET or CLOUDINARY_UNSIGNED_UPLOAD_PRESET.'
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No video provided' });
    }

    const result = await cloudinary.uploadVideo(req.file.buffer);

    res.json({
      success: true,
      video_id: result.public_id,
      url: result.secure_url,
      duration: result.duration,
      width: result.width,
      height: result.height,
      format: result.format,
      size: result.bytes
    });
  } catch (error) {
    console.error('Video upload error:', error);
    const message = error?.message || 'Video upload failed';
    if (message.includes('Invalid Signature')) {
      return res.status(401).json({
        success: false,
        error: 'Cloudinary signature rejected. Verify CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, or use CLOUDINARY_UNSIGNED_UPLOAD_PRESET.'
      });
    }
    res.status(error?.http_code || 500).json({ success: false, error: message });
  }
});

// Resize video to multiple dimensions
router.post('/video/resize', async (req, res) => {
  try {
    if (!cloudinary.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME with either CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET or CLOUDINARY_UNSIGNED_UPLOAD_PRESET.'
      });
    }

    const { video_id, smart_crop = true } = req.body;

    if (!video_id) {
      return res.status(400).json({ success: false, error: 'Video ID required' });
    }

    const versions = await cloudinary.resizeVideo(video_id, { smart_crop });

    res.json({ success: true, versions });
  } catch (error) {
    console.error('Video resize error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy download for Safari compatibility
router.get('/video/download', async (req, res) => {
  try {
    const { url, filename } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'video.mp4'}"`);

    response.data.pipe(res);
  } catch (error) {
    console.error('Download proxy error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// ============================================================================
// VIDEO TEXT OVERLAY EDITOR (burnt-in overlay editing)
// ============================================================================

router.get('/video-overlay/health', async (req, res) => {
  try {
    const overlayAiConfigured = isVideoOverlayAiConfigured();
    const overlayAiHealth = overlayAiConfigured ? await getVideoOverlayAiHealth().catch(() => null) : null;

    res.json({
      success: true,
      overlay_ai: {
        configured: overlayAiConfigured,
        url: process.env.VIDEO_OVERLAY_AI_URL || null,
        health: overlayAiHealth
      },
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY),
        model: process.env.VIDEO_OVERLAY_SCAN_MODEL || 'gemini-2.5-flash-lite'
      },
      tools: {
        ffmpeg: true,
        ffprobe: true
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/video-overlay/upload', upload.single('video'), async (req, res) => {
  try {
    await ensureVideoOverlayDirs();

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No video provided' });
    }

    const videoId = crypto.randomUUID();
    const videoPath = getUploadedVideoPath(videoId);
    await fs.promises.writeFile(videoPath, req.file.buffer);

    let info = { duration: null, width: null, height: null };
    try {
      info = await ffprobeVideoInfo(videoPath);
    } catch (e) {
      console.warn('ffprobe failed for upload:', e?.message || e);
    }

    return res.json({
      success: true,
      video_id: videoId,
      filename: req.file.originalname,
      size: req.file.size,
      ...info
    });
  } catch (error) {
    console.error('Video overlay upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/video-overlay/detect', async (req, res) => {
  try {
    const imageBase64 = req.body?.image || '';
    const startTime = safeParseNumber(req.body?.startTime, null);
    const endTime = safeParseNumber(req.body?.endTime, null);

    if (!imageBase64) {
      return res.status(400).json({ success: false, error: 'image is required (base64 JPEG/PNG, no data: prefix)' });
    }

    if (!isVideoOverlayAiConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'VIDEO_OVERLAY_AI_URL is not configured. Start the Python detector and set VIDEO_OVERLAY_AI_URL.'
      });
    }

    const detections = await detectVideoOverlays({ imageBase64 });
    const overlays = Array.isArray(detections)
      ? detections.map((det) => toOverlayBox(det, { startTime, endTime }))
      : [];

    return res.json({ success: true, overlays, raw: detections });
  } catch (error) {
    console.error('Video overlay detect error:', error?.payload || error);
    const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 500;
    res.status(status).json({ success: false, error: error.message, details: error?.payload || null });
  }
});

async function extractFrameBase64(videoPath, { t, width = null } = {}) {
  const tmpDir = path.join(VIDEO_OVERLAY_TMP_DIR, 'frames', crypto.randomUUID());
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, 'frame.jpg');

  const args = [
    '-ss', String(Math.max(0, t || 0)),
    '-i', videoPath,
    '-frames:v', '1'
  ];

  if (width && Number.isFinite(width) && width > 0) {
    args.push('-vf', `scale=${Math.round(width)}:-1`);
  }

  args.push('-q:v', '4', '-y', outPath);

  await execFileAsync('ffmpeg', args);
  const b64 = await fs.promises.readFile(outPath, 'base64');

  // Best-effort cleanup
  fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  return b64;
}

async function detectOverlayKeysWithGemini({ frames } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const modelName = process.env.VIDEO_OVERLAY_SCAN_MODEL || 'gemini-2.5-flash-lite';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const results = [];
  const chunkSize = 8;

  for (let i = 0; i < frames.length; i += chunkSize) {
    const chunk = frames.slice(i, i + chunkSize);

    const prompt = `You analyze video frames to find when a burnt-in text overlay changes.

For each frame, read ONLY the prominent burnt-in text overlay (lower-third/subtitle/caption) that appears as a boxed/overlayed text element.
If there is no such overlay, return null.
If there are multiple overlays, pick the most prominent editable overlay.
If the text is unreadable, return "UNREADABLE" (do not guess).

Return ONLY valid JSON with this exact shape:
{"frames":[{"t":0.0,"overlay_text":null}]}`;

    const parts = [{ text: prompt }];

    for (const frame of chunk) {
      parts.push({ text: `FRAME t=${frame.t}` });
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: frame.b64 } });
    }

    const result = await model.generateContent(parts);
    const text = String(result?.response?.text?.() ?? '').trim();

    // Robust JSON extraction
    const jsonText = text
      .replace(/```json|```/g, '')
      .trim();

    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    const slice = start >= 0 && end >= 0 ? jsonText.slice(start, end + 1) : jsonText;

    let parsed = null;
    try {
      parsed = JSON.parse(slice);
    } catch (e) {
      throw new Error(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
    }

    const frameRows = Array.isArray(parsed?.frames) ? parsed.frames : [];
    for (const row of frameRows) {
      const t = safeParseNumber(row?.t, null);
      if (t === null) continue;
      results.push({ t, overlay_text: row?.overlay_text ?? null });
    }
  }

  return results;
}

async function detectOverlayKeysWithDetector({ videoPath, times } = {}) {
  if (!isVideoOverlayAiConfigured()) {
    throw new Error('VIDEO_OVERLAY_AI_URL is not configured.');
  }

  const frames = [];
  for (const t of times) {
    const b64 = await extractFrameBase64(videoPath, { t, width: 512 });
    const detections = await detectVideoOverlays({ imageBase64: b64 });
    const texts = Array.isArray(detections)
      ? detections
        .map(d => String(d?.text || '').trim())
        .filter(Boolean)
      : [];
    frames.push({
      t,
      overlay_text: texts.length ? texts.join(' | ') : null
    });
  }
  return frames;
}

router.post('/video-overlay/scan', async (req, res) => {
  try {
    await ensureVideoOverlayDirs();

    const videoId = String(req.body?.video_id || '').trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(videoId)) {
      return res.status(400).json({ success: false, error: 'Invalid video_id format' });
    }
    const videoPath = getUploadedVideoPath(videoId);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ success: false, error: 'Uploaded video not found (upload again)' });
    }

    let info;
    try {
      info = await ffprobeVideoInfo(videoPath);
    } catch (e) {
      const msg = e?.code === 'ENOENT'
        ? 'ffprobe not found on server. Install ffmpeg/ffprobe.'
        : (e?.message || 'Failed to read video metadata');
      return res.status(500).json({ success: false, error: msg });
    }

    const durationSec = info.duration || 0;
    if (!durationSec) {
      return res.status(400).json({ success: false, error: 'Invalid video duration (ffprobe returned 0)' });
    }

    let intervalSec = clampNumber(req.body?.interval_sec ?? 1, 0.25, 10);
    const maxFrames = Math.round(clampNumber(req.body?.max_frames ?? 30, 5, 120));

    // Keep within maxFrames by increasing interval automatically.
    if (durationSec / intervalSec > maxFrames) {
      intervalSec = durationSec / maxFrames;
    }

    const times = [];
    for (let t = 0; t < durationSec && times.length < maxFrames; t += intervalSec) {
      times.push(Math.min(durationSec, t));
    }

    // Extract scaled frames for scanning (Gemini / fallback)
    const scanFrames = [];
    for (const t of times) {
      const b64 = await extractFrameBase64(videoPath, { t, width: 512 });
      scanFrames.push({ t, b64 });
    }

    if (!isVideoOverlayAiConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'VIDEO_OVERLAY_AI_URL is not configured. This feature requires the DINO+SAM2 overlay detector service.'
      });
    }

    const overlayHealth = await getVideoOverlayAiHealth().catch(() => null);
    if (!overlayHealth?.ok) {
      return res.status(503).json({
        success: false,
        error: 'Video Overlay AI service is not ready. DINO + SAM2 must be loaded (no fallback mode).',
        details: overlayHealth?.payload || null
      });
    }

    const useGemini = req.body?.use_gemini !== false;
    if (!useGemini) {
      return res.status(400).json({
        success: false,
        error: 'Gemini scan is required for video-wide overlay segmentation (no fallback mode). Enable Gemini scan.'
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured. This feature requires Gemini for segment detection (no fallback mode).'
      });
    }

    const frameKeys = await detectOverlayKeysWithGemini({ frames: scanFrames });
    const scanMethod = 'gemini';

    const segmentsRaw = buildSegmentsFromFrameKeys({ frames: frameKeys, durationSec, intervalSec });
    if (!segmentsRaw.some(seg => seg.key)) {
      return res.json({
        success: true,
        scan_method: scanMethod,
        duration: durationSec,
        interval_sec: intervalSec,
        max_frames: maxFrames,
        frames_analyzed: scanFrames.length,
        segments: []
      });
    }

    // For each segment, run the exact detector on a full-res representative frame to get geometry/colors/fonts.
    // Strict mode: no silent segment failures.
    const segments = [];
    for (const seg of segmentsRaw) {
      const fullFrameB64 = await extractFrameBase64(videoPath, { t: seg.sample_t, width: null });
      const detections = await detectVideoOverlays({ imageBase64: fullFrameB64 });
      const overlays = Array.isArray(detections)
        ? detections.map((det) => toOverlayBox(det, { startTime: seg.start, endTime: seg.end }))
        : [];

      if (!overlays.length) {
        throw new Error(`Detector returned 0 overlays for segment start=${seg.start}s end=${seg.end}s (sample_t=${seg.sample_t}s).`);
      }

      segments.push({
        id: seg.id,
        label: seg.label,
        start: seg.start,
        end: seg.end,
        sample_time: seg.sample_t,
        overlays
      });
    }

    res.json({
      success: true,
      scan_method: scanMethod,
      duration: durationSec,
      interval_sec: intervalSec,
      max_frames: maxFrames,
      frames_analyzed: scanFrames.length,
      segments
    });
  } catch (error) {
    console.error('Video overlay scan error:', error);
    const msg = error?.code === 'ENOENT'
      ? 'ffmpeg/ffprobe not found on server. Install ffmpeg.'
      : error.message;
    res.status(500).json({ success: false, error: msg });
  }
});

function buildOverlayFiltergraph({ durationSec, segments, fontPath } = {}) {
  const filters = [];
  let label = '[0:v]';
  let step = 0;

  // Make sure we always have a working font file path.
  const fallbackFont = fontPath || path.join(__dirname, '..', 'assets', 'fonts', 'Inter-Regular.ttf');
  const resolvedFontPath = fs.existsSync(fallbackFont)
    ? fallbackFont
    : path.join(__dirname, '..', '..', 'Inter-Regular.ttf');

  for (const seg of segments || []) {
    const start = clampNumber(seg?.start, 0, durationSec);
    const end = clampNumber(seg?.end, start, durationSec);
    const overlays = Array.isArray(seg?.overlays) ? seg.overlays : [];

    for (const ov of overlays) {
      const x = Math.max(0, Math.round(ov?.x || 0));
      const y = Math.max(0, Math.round(ov?.y || 0));
      const w = Math.max(1, Math.round(ov?.width || 1));
      const h = Math.max(1, Math.round(ov?.height || 1));

      const enable = `between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`;

      const bgHex = parseHexColor(ov?.backgroundColor)?.hex || '#333333';
      const textHex = parseHexColor(ov?.textColor)?.hex || '#ffffff';
      const fontsize = Math.max(8, Math.round(safeParseNumber(ov?.fontSize, 24)));
      const text = escapeDrawtext(ov?.text || '');

      // Background: prefer gradient when provided; fall back to solid color.
      let bgStream = `[bg${step}]`;
      if (ov?.isGradient && ov?.gradient?.from?.hex && ov?.gradient?.to?.hex) {
        const from = parseHexColor(ov.gradient.from.hex);
        const to = parseHexColor(ov.gradient.to.hex);
        const dir = ov.gradient.direction === 'horizontal' ? 'horizontal' : 'vertical';

        if (from && to) {
          // This uses geq; if ffmpeg lacks it or parsing fails, the export route will fall back to solid.
          const axis = dir === 'horizontal' ? 'X' : 'Y';
          const denom = dir === 'horizontal' ? 'W' : 'H';
          filters.push(
            `color=c=black:s=${w}x${h}:d=${durationSec.toFixed(3)},format=rgba,geq=` +
              `r='${from.r}+(${to.r}-${from.r})*${axis}/${denom}':` +
              `g='${from.g}+(${to.g}-${from.g})*${axis}/${denom}':` +
              `b='${from.b}+(${to.b}-${from.b})*${axis}/${denom}':` +
              `a=255${bgStream}`
          );
        } else {
          filters.push(`color=c=${bgHex}:s=${w}x${h}:d=${durationSec.toFixed(3)}${bgStream}`);
        }
      } else {
        filters.push(`color=c=${bgHex}:s=${w}x${h}:d=${durationSec.toFixed(3)}${bgStream}`);
      }

      const out1 = `[v${++step}]`;
      filters.push(`${label}${bgStream}overlay=${x}:${y}:enable='${enable}'${out1}`);
      label = out1;

      const out2 = `[v${++step}]`;
      const draw = `drawtext=fontfile='${resolvedFontPath}':text='${text}':` +
        `x=${x}+((${w}-text_w)/2):y=${y}+((${h}-text_h)/2):` +
        `fontsize=${fontsize}:fontcolor=${textHex}:` +
        `expansion=none:enable='${enable}'`;
      filters.push(`${label}${draw}${out2}`);
      label = out2;
    }
  }

  return {
    filterComplex: filters.join(';'),
    finalLabel: label,
    resolvedFontPath
  };
}

router.post('/video-overlay/export', async (req, res) => {
  try {
    await ensureVideoOverlayDirs();

    const videoId = String(req.body?.video_id || '').trim();
    const segments = Array.isArray(req.body?.segments) ? req.body.segments : [];

    if (!videoId) {
      return res.status(400).json({ success: false, error: 'video_id is required' });
    }
    if (!segments.length) {
      return res.status(400).json({ success: false, error: 'segments are required' });
    }

    const videoPath = getUploadedVideoPath(videoId);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ success: false, error: 'Uploaded video not found (upload again)' });
    }

    let info;
    try {
      info = await ffprobeVideoInfo(videoPath);
    } catch (e) {
      const msg = e?.code === 'ENOENT'
        ? 'ffprobe not found on server. Install ffmpeg/ffprobe.'
        : (e?.message || 'Failed to read video metadata');
      return res.status(500).json({ success: false, error: msg });
    }

    const exportId = crypto.randomUUID();
    const outPath = getExportedVideoPath(exportId);

    // Build filtergraph (includes gradients when provided). No fallback mode.
    const fontPath = path.join(__dirname, '..', 'assets', 'fonts', 'Inter-Regular.ttf');
    const graph = buildOverlayFiltergraph({ durationSec: info.duration, segments, fontPath });
    if (!graph.filterComplex) {
      return res.status(400).json({ success: false, error: 'No overlays found in segments (nothing to export)' });
    }

    const baseArgs = [
      '-i', videoPath,
      '-filter_complex', graph.filterComplex,
      '-map', graph.finalLabel,
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      '-y',
      outPath
    ];

    await execFileAsync('ffmpeg', baseArgs);

    const filename = String(req.body?.filename || 'edited_video.mp4');
    const downloadUrl = `/api/creative-studio/video-overlay/download?output_id=${encodeURIComponent(exportId)}&filename=${encodeURIComponent(filename)}`;

    return res.json({
      success: true,
      output_id: exportId,
      url: downloadUrl
    });
  } catch (error) {
    console.error('Video overlay export error:', error);
    const msg = error?.code === 'ENOENT'
      ? 'ffmpeg not found on server. Install ffmpeg.'
      : error.message;
    res.status(500).json({ success: false, error: msg });
  }
});

router.get('/video-overlay/download', async (req, res) => {
  try {
    const outputId = String(req.query?.output_id || '').trim();
    const filename = String(req.query?.filename || 'edited_video.mp4');

    if (!outputId) {
      return res.status(400).json({ success: false, error: 'output_id is required' });
    }

    const outPath = getExportedVideoPath(outputId);
    if (!fs.existsSync(outPath)) {
      return res.status(404).json({ success: false, error: 'Export not found (export again)' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(outPath).pipe(res);
  } catch (error) {
    console.error('Video overlay download error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// IMAGE RESIZER
// ============================================================================

router.post('/image/resize', upload.single('image'), async (req, res) => {
  try {
    let result;

    if (req.file) {
      result = await cloudinary.uploadImage(req.file.buffer);
    } else if (req.body.image_url) {
      // Upload from URL
      const base64 = await cloudinary.fetchAsBase64(req.body.image_url);
      result = await cloudinary.uploadImage(Buffer.from(base64, 'base64'));
    } else {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    const versions = await cloudinary.resizeImage(result.public_id);

    res.json({
      success: true,
      original: {
        url: result.secure_url,
        width: result.width,
        height: result.height
      },
      versions
    });
  } catch (error) {
    console.error('Image resize error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CREATIVE FATIGUE DETECTOR
// ============================================================================

router.post('/fatigue/analyze', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    let { ads } = req.body;

    if (!ads || !Array.isArray(ads) || ads.length === 0) {
      const rows = db.prepare(`
        SELECT campaign_id, campaign_name, date, ctr, frequency, impressions, spend
        FROM meta_daily_metrics
        WHERE store = ?
        ORDER BY date ASC
      `).all(store);

      if (rows.length === 0) {
        return res.status(400).json({ success: false, error: 'Ads data required' });
      }

      const averages = (values) => {
        if (!values || values.length === 0) return 0;
        return values.reduce((sum, value) => sum + (value || 0), 0) / values.length;
      };

      const adsByCampaign = new Map();

      rows.forEach(row => {
        if (!adsByCampaign.has(row.campaign_id)) {
          adsByCampaign.set(row.campaign_id, {
            ad_id: row.campaign_id,
            ad_name: row.campaign_name,
            creative_url: null,
            dates: [],
            ctrs: [],
            frequencies: [],
            impressions: 0,
            spend: 0
          });
        }

        const entry = adsByCampaign.get(row.campaign_id);
        entry.dates.push(row.date);
        entry.ctrs.push(row.ctr || 0);
        entry.frequencies.push(row.frequency || 0);
        entry.impressions += row.impressions || 0;
        entry.spend += row.spend || 0;
      });

      ads = Array.from(adsByCampaign.values()).map(entry => {
        const baseline_ctr = averages(entry.ctrs.slice(0, 3));
        const current_ctr = averages(entry.ctrs.slice(-3));
        const frequency = averages(entry.frequencies.slice(-3));

        return {
          ad_id: entry.ad_id,
          ad_name: entry.ad_name,
          creative_url: entry.creative_url,
          current_ctr,
          baseline_ctr,
          frequency,
          start_date: entry.dates[0],
          impressions: entry.impressions,
          spend: entry.spend
        };
      });
    }

    const results = fatigueService.calculateFatigueForAds(ads);

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO creative_fatigue (ad_id, ad_name, creative_url, fatigue_score, ctr_baseline, ctr_current, ctr_decline_pct, frequency, days_running, status, recommendation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ad of results.ads) {
      stmt.run(
        ad.ad_id,
        ad.ad_name,
        ad.creative_url,
        ad.fatigue_score,
        ad.metrics.ctr_baseline,
        ad.metrics.ctr_current,
        ad.metrics.ctr_decline_pct,
        ad.metrics.frequency,
        ad.metrics.days_running,
        ad.status,
        ad.recommendation
      );
    }

    res.json({ success: true, ...results });
  } catch (error) {
    console.error('Fatigue analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get fatigue history
router.get('/fatigue/history', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const history = db.prepare(`
      SELECT * FROM creative_fatigue 
      WHERE calculated_at >= datetime('now', '-${parseInt(days)} days')
      ORDER BY calculated_at DESC
    `).all();

    res.json({ success: true, history });
  } catch (error) {
    console.error('Get fatigue history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// AD ACCOUNT AUDITOR
// ============================================================================

router.post('/audit', async (req, res) => {
  try {
    const accountData = req.body;

    const audit = await auditorService.runFullAudit(accountData);

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO account_audits (audit_date, health_score, status, issues, recommendations, metrics)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      new Date().toISOString().split('T')[0],
      audit.health_score,
      audit.status,
      JSON.stringify(audit.issues),
      JSON.stringify(audit.recommendations),
      JSON.stringify(audit.summary)
    );

    res.json({ success: true, audit });
  } catch (error) {
    console.error('Account audit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get audit history
router.get('/audit/history', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const audits = db.prepare(`
      SELECT * FROM account_audits 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(parseInt(limit));

    const parsed = audits.map(a => ({
      ...a,
      issues: JSON.parse(a.issues || '[]'),
      recommendations: JSON.parse(a.recommendations || '[]'),
      metrics: JSON.parse(a.metrics || '{}')
    }));

    res.json({ success: true, audits: parsed });
  } catch (error) {
    console.error('Get audit history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate audit report
router.get('/audit/:id/report', async (req, res) => {
  try {
    const { id } = req.params;

    const audit = db.prepare('SELECT * FROM account_audits WHERE id = ?').get(id);

    if (!audit) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }

    const parsed = {
      ...audit,
      issues: JSON.parse(audit.issues || '[]'),
      recommendations: JSON.parse(audit.recommendations || '[]')
    };

    const report = auditorService.generateAuditReport(parsed);

    res.json({ success: true, report });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// TEMPLATES CRUD
// ============================================================================

router.get('/templates', async (req, res) => {
  try {
    const templates = db.prepare('SELECT * FROM studio_templates ORDER BY is_default DESC, created_at DESC').all();

    const parsed = templates.map(t => ({
      ...t,
      style: JSON.parse(t.style || '{}')
    }));

    res.json({ success: true, templates: parsed });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, style, layout, is_default = false } = req.body;

    if (!name || !style) {
      return res.status(400).json({ success: false, error: 'Name and style required' });
    }

    const stmt = db.prepare(`
      INSERT INTO studio_templates (name, style, layout, is_default)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      JSON.stringify(style),
      layout,
      is_default ? 1 : 0
    );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Template saved'
    });
  } catch (error) {
    console.error('Save template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM studio_templates WHERE id = ?').run(id);
    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// GENERATED CONTENT HISTORY
// ============================================================================

router.get('/history', async (req, res) => {
  try {
    const { type, limit = 50 } = req.query;

    let query = 'SELECT * FROM generated_content';
    const params = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const content = db.prepare(query).all(...params);

    const parsed = content.map(c => ({
      ...c,
      input: JSON.parse(c.input || '{}'),
      output: JSON.parse(c.output || '{}')
    }));

    res.json({ success: true, content: parsed });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
