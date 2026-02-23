import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import os from 'os';
import path from 'path';
import net from 'net';
import dns from 'dns/promises';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
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
import sharp from 'sharp';
import {
  enhancePhoto,
  eraseLama,
  getPhotoMagicAiHealth,
  isPhotoMagicAiConfigured,
  refineBgSam2,
  removeBgRmbg2
} from '../services/photoMagicAiClient.js';
import { eraseSdxl, getPhotoMagicHqHealth, isPhotoMagicHqConfigured } from '../services/photoMagicHqClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const router = express.Router();
const db = getDb();
const DEFAULT_GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash-preview-09-2025';
const GEMINI_MODEL_FALLBACK_MESSAGE_PATTERN = /not found|unknown model|unsupported|deprecated/i;

const upload = multer({ storage: multer.memoryStorage() });

const PHOTO_MAGIC_MAX_UPLOAD_BYTES = (() => {
  const mb = Number(process.env.PHOTO_MAGIC_MAX_UPLOAD_MB || 25);
  const resolved = Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : 25 * 1024 * 1024;
  return Math.min(Math.max(1 * 1024 * 1024, resolved), 200 * 1024 * 1024);
})();

const PHOTO_MAGIC_MAX_IMAGE_PIXELS = (() => {
  const raw = Number(process.env.PHOTO_MAGIC_MAX_IMAGE_PIXELS || 60000000);
  const resolved = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 60000000;
  return Math.min(Math.max(1000000, resolved), 200000000);
})();

const photoMagicUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAGIC_MAX_UPLOAD_BYTES }
});

function photoMagicSingle(fieldName) {
  const middleware = photoMagicUpload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      const isTooLarge = err?.code === 'LIMIT_FILE_SIZE';
      const status = isTooLarge ? 413 : 400;
      return res.status(status).json({
        success: false,
        error: isTooLarge
          ? `File too large (max ${Math.round(PHOTO_MAGIC_MAX_UPLOAD_BYTES / (1024 * 1024))}MB)`
          : (err?.message || 'Upload error'),
        code: err?.code || 'UPLOAD_ERROR',
        limit_bytes: PHOTO_MAGIC_MAX_UPLOAD_BYTES
      });
    });
  };
}

function createBoundedUploadSingle({ fieldName, maxBytes, typeLabel }) {
  const boundedUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes }
  });
  const middleware = boundedUpload.single(fieldName);

  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      const isTooLarge = err?.code === 'LIMIT_FILE_SIZE';
      const status = isTooLarge ? 413 : 400;
      return res.status(status).json({
        success: false,
        error: isTooLarge
          ? `${typeLabel} file too large (max ${Math.round(maxBytes / (1024 * 1024))}MB).`
          : (err?.message || `${typeLabel} upload failed.`),
        code: err?.code || 'UPLOAD_ERROR',
        limit_bytes: maxBytes
      });
    });
  };
}


// ============================================================================
// VIDEO OVERLAY EDITOR (VideoOverlayAI) - temp storage + helpers
// ============================================================================

const VIDEO_OVERLAY_TMP_DIR = path.join(os.tmpdir(), 'creative-studio', 'video-overlay');
const VIDEO_OVERLAY_UPLOADS_DIR = path.join(VIDEO_OVERLAY_TMP_DIR, 'uploads');
const VIDEO_OVERLAY_OUTPUTS_DIR = path.join(VIDEO_OVERLAY_TMP_DIR, 'outputs');
const VIDEO_OVERLAY_TEXTS_DIR = path.join(VIDEO_OVERLAY_TMP_DIR, 'texts');

async function ensureVideoOverlayDirs() {
  await fs.promises.mkdir(VIDEO_OVERLAY_UPLOADS_DIR, { recursive: true });
  await fs.promises.mkdir(VIDEO_OVERLAY_OUTPUTS_DIR, { recursive: true });
  await fs.promises.mkdir(VIDEO_OVERLAY_TEXTS_DIR, { recursive: true });
}

function getUploadedVideoPath(videoId) {
  return path.join(VIDEO_OVERLAY_UPLOADS_DIR, videoId);
}

function getExportedVideoPath(exportId) {
  return path.join(VIDEO_OVERLAY_OUTPUTS_DIR, `${exportId}.mp4`);
}

function getOverlayTextFilePath(exportId, index) {
  return path.join(VIDEO_OVERLAY_TEXTS_DIR, `${exportId}-${index}.txt`);
}

const VIDEO_OVERLAY_SUPPORTED_SCAN_MODELS = [
  'gemini-3-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];
const VIDEO_OVERLAY_DEFAULT_SCAN_MODEL = 'gemini-2.5-flash-lite';
const VIDEO_OVERLAY_LEGACY_SCAN_MODEL_MAP = {
  'gemini-3-pro': 'gemini-3-pro-preview',
  'gemini-2.0-flash-lite': VIDEO_OVERLAY_DEFAULT_SCAN_MODEL
};

function normalizeVideoOverlayScanModelName(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveVideoOverlayScanModel({ requestedModel = null, configuredModel = null } = {}) {
  const normalizeCandidate = (rawValue) => {
    const raw = String(rawValue || '').trim();
    if (!raw) return null;
    const normalized = normalizeVideoOverlayScanModelName(raw);
    return VIDEO_OVERLAY_LEGACY_SCAN_MODEL_MAP[normalized] || normalized;
  };

  const requested = normalizeCandidate(requestedModel);
  if (requested) {
    if (!VIDEO_OVERLAY_SUPPORTED_SCAN_MODELS.includes(requested)) {
      const err = new Error(
        `Unsupported scan model "${requestedModel}". Supported models: ${VIDEO_OVERLAY_SUPPORTED_SCAN_MODELS.join(', ')}`
      );
      err.statusCode = 400;
      throw err;
    }
    return requested;
  }

  const configured = normalizeCandidate(configuredModel);
  if (configured && VIDEO_OVERLAY_SUPPORTED_SCAN_MODELS.includes(configured)) {
    return configured;
  }

  return VIDEO_OVERLAY_DEFAULT_SCAN_MODEL;
}

function getVideoOverlayScanModelWarning(configuredModel) {
  const raw = String(configuredModel || '').trim();
  if (!raw) return null;

  const normalized = normalizeVideoOverlayScanModelName(raw);
  if (VIDEO_OVERLAY_LEGACY_SCAN_MODEL_MAP[normalized]) {
    const mapped = VIDEO_OVERLAY_LEGACY_SCAN_MODEL_MAP[normalized];
    return `VIDEO_OVERLAY_SCAN_MODEL=${raw} is deprecated. Using ${mapped} instead.`;
  }

  const resolved = resolveVideoOverlayScanModel({ configuredModel: raw });
  if (resolved !== normalized) {
    return `VIDEO_OVERLAY_SCAN_MODEL=${raw} is unsupported. Falling back to ${resolved}.`;
  }

  return null;
}

// ============================================================================
// PHOTO MAGIC (background removal + magic eraser) - temp storage + helpers
// ============================================================================

const PHOTO_MAGIC_TMP_DIR = path.join(os.tmpdir(), 'creative-studio', 'photo-magic');
const PHOTO_MAGIC_DEFAULT_STORE = 'vironax';

function toSafePathSegment(value, { fallback = 'unknown', maxLen = 64 } = {}) {
  const raw = String(value || '').trim();
  const normalized = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, maxLen);
  if (!normalized || normalized === '.' || normalized === '..') return fallback;
  return normalized;
}

function withStoreParam(relativeUrl, store) {
  const resolvedStore = String(store || PHOTO_MAGIC_DEFAULT_STORE);
  const sep = relativeUrl.includes('?') ? '&' : '?';
  return `${relativeUrl}${sep}store=${encodeURIComponent(resolvedStore)}`;
}

function sanitizeDownloadFilename(filename, fallback) {
  const raw = String(filename || '').trim();
  const base = path.basename(raw).replace(/[\r\n"]/g, '').trim();
  const safe = base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);
  return safe || fallback;
}

function getPhotoMagicStoreDir(store) {
  return path.join(PHOTO_MAGIC_TMP_DIR, toSafePathSegment(store || PHOTO_MAGIC_DEFAULT_STORE));
}

function getPhotoMagicUploadsDir(store) {
  return path.join(getPhotoMagicStoreDir(store), 'uploads');
}

function getPhotoMagicOutputsDir(store) {
  return path.join(getPhotoMagicStoreDir(store), 'outputs');
}

async function ensurePhotoMagicDirs(store) {
  await fs.promises.mkdir(getPhotoMagicUploadsDir(store), { recursive: true });
  await fs.promises.mkdir(getPhotoMagicOutputsDir(store), { recursive: true });
}

function getUploadedPhotoPath(store, imageId) {
  return path.join(getPhotoMagicUploadsDir(store), imageId);
}

function getPhotoMagicOutputPath(store, outputId, ext = 'png') {
  return path.join(getPhotoMagicOutputsDir(store), `${outputId}.${ext}`);
}

function isSafeTmpId(id) {
  return /^[a-f0-9-]{8,}$/i.test(String(id || '').trim());
}

function safeParseNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max) {
  const n = safeParseNumber(value, min);
  return Math.min(max, Math.max(min, n));
}

function parseBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  return fallback;
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

const CREATIVE_OS_DEFAULT_STORE = 'vironax';
const CREATIVE_OS_IMPORT_TIMEOUT_MS = 8000;
const CREATIVE_OS_IMPORT_MAX_REDIRECTS = 3;
const CREATIVE_OS_IMPORT_MAX_HTML_BYTES = 2 * 1024 * 1024;
const CREATIVE_OS_IMPORT_ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
const CREATIVE_OS_EXPORT_TMP_DIR = path.join(os.tmpdir(), 'creative-studio', 'creative-os', 'exports');
const CREATIVE_OS_EXPORT_ID_PATTERN = /^[a-f0-9-]{20,}$/i;
const CREATIVE_OS_MAX_EXPORT_TARGETS = 8;
const CREATIVE_OS_MAX_PALETTE_COLORS = 6;
const CREATIVE_OS_QUANTIZATION_STEP = 16;
const CREATIVE_OS_MAX_PRODUCT_NAME_LENGTH = 120;
const CREATIVE_OS_MAX_DESCRIPTION_LENGTH = 240;
const CREATIVE_OS_MAX_CAPTION_LENGTH = 280;
const CREATIVE_OS_MAX_TEMPLATE_LENGTH = 64;
const CREATIVE_OS_RECENT_PRODUCT_WINDOW_DAYS = 45;
const CREATIVE_OS_BEST_SELLER_UNITS_THRESHOLD = 8;
const CREATIVE_OS_DEFAULT_CURRENCY = 'USD';
const CREATIVE_OS_IMAGE_PIPELINE_MAX_SIDE = 2048;
const CREATIVE_OS_DEFAULT_SCENE_PRESET = 'studio_soft';
const CREATIVE_OS_MAX_CAPTION_PLAN_SCRIPT_LENGTH = 2400;
const CREATIVE_OS_MIN_CAPTION_WORDS_PER_SEGMENT = 2;
const CREATIVE_OS_MAX_CAPTION_WORDS_PER_SEGMENT = 10;
const CREATIVE_OS_MIN_CAPTION_SEGMENT_SECONDS = 0.35;
const CREATIVE_OS_CAPTION_SNAP_TOLERANCE_SECONDS = 0.45;
const CREATIVE_OS_MAX_BEAT_MARKERS = 320;
const CREATIVE_OS_ENHANCE_MODES = new Set(['upscale', 'denoise', 'deblur', 'sharpen', 'low_light']);
const CREATIVE_OS_VIDEO_TMP_DIR = path.join(os.tmpdir(), 'creative-studio', 'creative-os', 'video');
const CREATIVE_OS_VIDEO_UPLOADS_DIR = path.join(CREATIVE_OS_VIDEO_TMP_DIR, 'uploads');
const CREATIVE_OS_AUDIO_UPLOADS_DIR = path.join(CREATIVE_OS_VIDEO_TMP_DIR, 'audio');
const CREATIVE_OS_VIDEO_OUTPUTS_DIR = path.join(CREATIVE_OS_VIDEO_TMP_DIR, 'outputs');
const CREATIVE_OS_TIMELINE_FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Inter-Regular.ttf');
const CREATIVE_OS_TIMELINE_MAX_CAPTIONS = 120;
const CREATIVE_OS_TIMELINE_MAX_TEXT_CHARS = 180;
const CREATIVE_OS_TIMELINE_MAX_TTS_CHARS = 400;
const CREATIVE_OS_TTS_PROVIDER_MAX_CHARS = 200;
const CREATIVE_OS_VIDEO_UPLOAD_MAX_BYTES = (() => {
  const mb = Number(process.env.CREATIVE_OS_VIDEO_MAX_UPLOAD_MB || 180);
  const resolved = Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : 180 * 1024 * 1024;
  return Math.min(Math.max(8 * 1024 * 1024, resolved), 512 * 1024 * 1024);
})();
const CREATIVE_OS_AUDIO_UPLOAD_MAX_BYTES = (() => {
  const mb = Number(process.env.CREATIVE_OS_AUDIO_MAX_UPLOAD_MB || 40);
  const resolved = Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : 40 * 1024 * 1024;
  return Math.min(Math.max(2 * 1024 * 1024, resolved), 128 * 1024 * 1024);
})();
const creativeOsVideoSingle = createBoundedUploadSingle({
  fieldName: 'video',
  maxBytes: CREATIVE_OS_VIDEO_UPLOAD_MAX_BYTES,
  typeLabel: 'Video'
});
const creativeOsAudioSingle = createBoundedUploadSingle({
  fieldName: 'audio',
  maxBytes: CREATIVE_OS_AUDIO_UPLOAD_MAX_BYTES,
  typeLabel: 'Audio'
});
const CREATIVE_OS_MEDIA_ID_PATTERN = /^[a-zA-Z0-9_-]{8,120}$/;
const CREATIVE_OS_TIMELINE_MAX_SEGMENTS = 24;
const CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS = 0.6;
const CREATIVE_OS_TRANSITION_DEFAULT_DURATION = 0.28;
const CREATIVE_OS_TRANSITION_MIN_DURATION = 0.06;
const CREATIVE_OS_TRANSITION_MAX_DURATION = 1.2;
const CREATIVE_OS_TRANSITION_ALLOWLIST = new Set([
  'fade',
  'wipeleft',
  'wiperight',
  'slideleft',
  'slideright',
  'smoothleft',
  'smoothright',
  'circleopen',
  'circleclose'
]);
const CREATIVE_OS_TIMELINE_MIN_FONT_SIZE = 16;
const CREATIVE_OS_TIMELINE_MAX_FONT_SIZE = 120;
const CREATIVE_OS_TTS_TIMEOUT_MS = 20000;
const CREATIVE_OS_TTS_LANG_ALLOWLIST = new Set([
  'en', 'en-US', 'en-GB',
  'ar', 'ar-SA', 'ar-AE', 'ar-EG',
  'es', 'es-ES', 'es-419',
  'fr', 'de', 'it', 'pt', 'tr'
]);
const CREATIVE_OS_TTS_SOURCE_BASE_URL = 'https://translate.googleapis.com/translate_tts';
const CREATIVE_OS_MUSIC_TRACK_DURATION_SECONDS = 30;
const CREATIVE_OS_MUSIC_LIBRARY_WARMUP_RETRY_DELAY_MS = 60000;
const CREATIVE_OS_PREWARM_MUSIC_LIBRARY = parseBool(process.env.CREATIVE_OS_PREWARM_MUSIC_LIBRARY ?? 'true', true);
const CREATIVE_OS_MUSIC_LIBRARY_TRACKS = [
  {
    id: 'uplift_glow',
    title: 'Uplift Glow',
    mood: 'uplift',
    bpm: 124,
    base_frequency_hz: 228,
    lead_frequency_hz: 684,
    noise_color: 'pink',
    base_volume: 0.22,
    lead_volume: 0.08,
    noise_volume: 0.02,
    license: 'Royalty-free (generated in-app)'
  },
  {
    id: 'editorial_luxe',
    title: 'Editorial Luxe',
    mood: 'editorial',
    bpm: 98,
    base_frequency_hz: 196,
    lead_frequency_hz: 588,
    noise_color: 'brown',
    base_volume: 0.2,
    lead_volume: 0.06,
    noise_volume: 0.015,
    license: 'Royalty-free (generated in-app)'
  },
  {
    id: 'confident_pulse',
    title: 'Confident Pulse',
    mood: 'confident',
    bpm: 132,
    base_frequency_hz: 246,
    lead_frequency_hz: 740,
    noise_color: 'violet',
    base_volume: 0.24,
    lead_volume: 0.085,
    noise_volume: 0.018,
    license: 'Royalty-free (generated in-app)'
  }
];

const creativeOsMusicLibraryWarmupState = {
  status: 'idle',
  startedAt: null,
  completedAt: null,
  error: null,
  promise: null
};

const CREATIVE_OS_FORMAT_CONFIG = {
  meta_feed_4_5: {
    id: 'meta_feed_4_5',
    platformKey: 'meta',
    ratio: '4:5',
    width: 1080,
    height: 1350,
    safeZone: { top: 0.14, bottom: 0.2, left: 0.06, right: 0.06 }
  },
  instagram_story_9_16: {
    id: 'instagram_story_9_16',
    platformKey: 'instagram',
    ratio: '9:16',
    width: 1080,
    height: 1920,
    safeZone: { top: 0.18, bottom: 0.24, left: 0.06, right: 0.06 }
  },
  tiktok_9_16: {
    id: 'tiktok_9_16',
    platformKey: 'tiktok',
    ratio: '9:16',
    width: 1080,
    height: 1920,
    safeZone: { top: 0.12, bottom: 0.26, left: 0.06, right: 0.11 }
  },
  square_1_1: {
    id: 'square_1_1',
    platformKey: 'square',
    ratio: '1:1',
    width: 1080,
    height: 1080,
    safeZone: { top: 0.1, bottom: 0.1, left: 0.08, right: 0.08 }
  },
  youtube_16_9: {
    id: 'youtube_16_9',
    platformKey: 'youtube',
    ratio: '16:9',
    width: 1920,
    height: 1080,
    safeZone: { top: 0.1, bottom: 0.12, left: 0.08, right: 0.08 }
  }
};

const CREATIVE_OS_SCENE_PRESETS = {
  studio_soft: {
    id: 'studio_soft',
    name: 'Studio Soft',
    bgStart: '#f0fdfa',
    bgEnd: '#dbeafe',
    panelTint: 'rgba(255,255,255,0.66)',
    orbA: '#99f6e4',
    orbB: '#bfdbfe',
    floor: 'rgba(15, 23, 42, 0.18)'
  },
  lifestyle_warm: {
    id: 'lifestyle_warm',
    name: 'Lifestyle Warm',
    bgStart: '#fffbeb',
    bgEnd: '#fee2e2',
    panelTint: 'rgba(255,255,255,0.62)',
    orbA: '#fcd34d',
    orbB: '#fca5a5',
    floor: 'rgba(120, 53, 15, 0.2)'
  },
  editorial_luxe: {
    id: 'editorial_luxe',
    name: 'Editorial Luxe',
    bgStart: '#0f172a',
    bgEnd: '#1e293b',
    panelTint: 'rgba(255,255,255,0.08)',
    orbA: '#22d3ee',
    orbB: '#a78bfa',
    floor: 'rgba(255, 255, 255, 0.16)'
  }
};

const CREATIVE_OS_BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '::1'
]);

const CREATIVE_OS_BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.internal',
  '.localhost'
];

function isCreativeOsBlockedHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return true;
  if (CREATIVE_OS_BLOCKED_HOSTNAMES.has(normalized)) return true;
  return CREATIVE_OS_BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function ipv4ToLong(ip) {
  const parts = String(ip || '')
    .split('.')
    .map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

function isPrivateIpv4(ip) {
  const long = ipv4ToLong(ip);
  if (long === null) return true;

  const inRange = (start, end) => long >= start && long <= end;
  return (
    inRange(ipv4ToLong('10.0.0.0'), ipv4ToLong('10.255.255.255'))
    || inRange(ipv4ToLong('127.0.0.0'), ipv4ToLong('127.255.255.255'))
    || inRange(ipv4ToLong('169.254.0.0'), ipv4ToLong('169.254.255.255'))
    || inRange(ipv4ToLong('172.16.0.0'), ipv4ToLong('172.31.255.255'))
    || inRange(ipv4ToLong('192.168.0.0'), ipv4ToLong('192.168.255.255'))
    || inRange(ipv4ToLong('0.0.0.0'), ipv4ToLong('0.255.255.255'))
  );
}

function isPrivateIpv6(ip) {
  const normalized = String(ip || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:')) {
    const maybeV4 = normalized.replace('::ffff:', '');
    if (net.isIP(maybeV4) === 4) {
      return isPrivateIpv4(maybeV4);
    }
  }
  return false;
}

function isPrivateIpAddress(ip) {
  const version = net.isIP(String(ip || '').trim());
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

async function assertCreativeOsPublicHost(hostname) {
  if (isCreativeOsBlockedHostname(hostname)) {
    throw new Error('Blocked hostname for security reasons.');
  }

  const lookupResults = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!Array.isArray(lookupResults) || lookupResults.length === 0) {
    throw new Error('Could not resolve hostname.');
  }

  for (const result of lookupResults) {
    if (isPrivateIpAddress(result.address)) {
      throw new Error('Target host resolves to a private address.');
    }
  }
}

async function validateCreativeOsImportUrl(rawUrl) {
  const candidate = String(rawUrl || '').trim();
  if (!candidate) {
    const err = new Error('Product URL is required.');
    err.statusCode = 400;
    throw err;
  }

  const prefixed = candidate.includes('://') ? candidate : `https://${candidate}`;
  let parsed;
  try {
    parsed = new URL(prefixed);
  } catch (error) {
    const err = new Error('Invalid product URL.');
    err.statusCode = 400;
    throw err;
  }

  if (!CREATIVE_OS_IMPORT_ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    const err = new Error('Only HTTP/HTTPS URLs are allowed.');
    err.statusCode = 400;
    throw err;
  }

  if (parsed.username || parsed.password) {
    const err = new Error('Credentials in URL are not allowed.');
    err.statusCode = 400;
    throw err;
  }

  await assertCreativeOsPublicHost(parsed.hostname);
  return parsed.toString();
}

function sanitizeCreativeOsText(value, maxLength, fallback = '') {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return fallback;
  return normalized.slice(0, maxLength);
}

function toCreativeOsSlug(value, fallback = 'asset') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractMetaValue(html, keys = []) {
  const haystack = String(html || '');
  for (const key of keys) {
    const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<meta[^>]+(?:(?:name|property)=["']${escapedKey}["'][^>]+content=["']([^"']+)["'])|(?:content=["']([^"']+)["'][^>]+(?:name|property)=["']${escapedKey}["'])`,
      'i'
    );
    const match = haystack.match(regex);
    if (match) return (match[1] || match[2]).trim();
  }
  return null;
}

function extractHtmlTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return match[1].replace(/\s+/g, ' ').trim();
}

function parseJsonLdBlocks(html) {
  const blocks = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(String(html || ''))) !== null) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch (error) {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return blocks;
}

function flattenJsonLdNodes(node, out = []) {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => flattenJsonLdNodes(item, out));
    return out;
  }
  if (typeof node === 'object') {
    out.push(node);
    if (Array.isArray(node['@graph'])) {
      flattenJsonLdNodes(node['@graph'], out);
    }
  }
  return out;
}

function readProductFromJsonLd(html) {
  const blocks = parseJsonLdBlocks(html);
  const nodes = flattenJsonLdNodes(blocks, []);
  const productNode = nodes.find((item) => {
    const type = item?.['@type'];
    if (Array.isArray(type)) {
      return type.some((entry) => String(entry).toLowerCase() === 'product');
    }
    return String(type || '').toLowerCase() === 'product';
  });

  if (!productNode) return null;

  const rawImage = productNode.image;
  const image = Array.isArray(rawImage) ? rawImage[0] : rawImage;
  const rawOffers = Array.isArray(productNode.offers) ? productNode.offers[0] : productNode.offers;

  return {
    title: sanitizeCreativeOsText(productNode.name, CREATIVE_OS_MAX_PRODUCT_NAME_LENGTH),
    description: sanitizeCreativeOsText(productNode.description, CREATIVE_OS_MAX_DESCRIPTION_LENGTH),
    image_url: typeof image === 'string' ? image : null,
    price: rawOffers?.price ?? null,
    currency: rawOffers?.priceCurrency || null,
    url: productNode.url || rawOffers?.url || null
  };
}

function parsePriceCandidate(rawValue) {
  if (rawValue === null || rawValue === undefined) return null;
  const cleaned = String(rawValue).replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function parseCurrencyCandidate(rawValue) {
  const cleaned = String(rawValue || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(cleaned)) return cleaned;
  return null;
}

function extractPriceFromHtml(html, jsonLdProduct) {
  const candidates = [
    jsonLdProduct?.price,
    extractMetaValue(html, ['product:price:amount', 'og:price:amount']),
    String(html || '').match(/"price"\s*:\s*"([^"]+)"/i)?.[1],
    String(html || '').match(/"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i)?.[1]
  ];

  for (const candidate of candidates) {
    const parsed = parsePriceCandidate(candidate);
    if (parsed !== null) return parsed;
  }
  return null;
}

function extractCurrencyFromHtml(html, jsonLdProduct) {
  const candidates = [
    jsonLdProduct?.currency,
    extractMetaValue(html, ['product:price:currency', 'og:price:currency']),
    String(html || '').match(/"priceCurrency"\s*:\s*"([^"]+)"/i)?.[1]
  ];

  for (const candidate of candidates) {
    const parsed = parseCurrencyCandidate(candidate);
    if (parsed) return parsed;
  }
  return CREATIVE_OS_DEFAULT_CURRENCY;
}

function splitTextLines(text, maxCharsPerLine, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxCharsPerLine && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

function parseColorWithFallback(rawColor, fallback) {
  const parsed = parseHexColor(rawColor || fallback);
  return parsed?.hex || fallback;
}

function srgbToLinear(value) {
  const normalized = value / 255;
  if (normalized <= 0.04045) return normalized / 12.92;
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hexColor) {
  const parsed = parseHexColor(hexColor);
  if (!parsed) return 0;
  const r = srgbToLinear(parsed.r);
  const g = srgbToLinear(parsed.g);
  const b = srgbToLinear(parsed.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const light = Math.max(lumA, lumB);
  const dark = Math.min(lumA, lumB);
  return (light + 0.05) / (dark + 0.05);
}

function bestTextColorForBackground(backgroundHex) {
  const whiteRatio = contrastRatio(backgroundHex, '#ffffff');
  const darkRatio = contrastRatio(backgroundHex, '#0f172a');
  return whiteRatio >= darkRatio ? '#ffffff' : '#0f172a';
}

function inferCollectionFromSignals({ unitsSold, lastSeenIso }) {
  const nowMs = Date.now();
  const lastSeenMs = lastSeenIso ? new Date(lastSeenIso).getTime() : 0;
  const recentWindowMs = CREATIVE_OS_RECENT_PRODUCT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (lastSeenMs && Number.isFinite(lastSeenMs) && nowMs - lastSeenMs <= recentWindowMs) {
    return 'new_arrivals';
  }
  if (Number(unitsSold || 0) >= CREATIVE_OS_BEST_SELLER_UNITS_THRESHOLD) {
    return 'best_sellers';
  }
  return 'evergreen';
}

async function ensureCreativeOsExportDir() {
  await fs.promises.mkdir(CREATIVE_OS_EXPORT_TMP_DIR, { recursive: true });
}

function getCreativeOsExportPath(assetId) {
  return path.join(CREATIVE_OS_EXPORT_TMP_DIR, `${assetId}.png`);
}

async function ensureCreativeOsVideoDirs() {
  await fs.promises.mkdir(CREATIVE_OS_VIDEO_UPLOADS_DIR, { recursive: true });
  await fs.promises.mkdir(CREATIVE_OS_AUDIO_UPLOADS_DIR, { recursive: true });
  await fs.promises.mkdir(CREATIVE_OS_VIDEO_OUTPUTS_DIR, { recursive: true });
}

function isCreativeOsMediaId(value) {
  return CREATIVE_OS_MEDIA_ID_PATTERN.test(String(value || '').trim());
}

function sanitizeCreativeOsMediaFilename(filename, fallback = 'media.bin') {
  return sanitizeDownloadFilename(filename, fallback);
}

function getCreativeOsVideoUploadPath(mediaId, ext = 'mp4') {
  return path.join(CREATIVE_OS_VIDEO_UPLOADS_DIR, `${mediaId}.${ext}`);
}

function getCreativeOsAudioUploadPath(audioId, ext = 'mp3') {
  return path.join(CREATIVE_OS_AUDIO_UPLOADS_DIR, `${audioId}.${ext}`);
}

function getCreativeOsVideoOutputPath(outputId, ext = 'mp4') {
  return path.join(CREATIVE_OS_VIDEO_OUTPUTS_DIR, `${outputId}.${ext}`);
}

function resolveCreativeOsAudioMime(ext) {
  const normalized = String(ext || '').trim().toLowerCase();
  if (normalized === 'wav') return 'audio/wav';
  if (normalized === 'aac') return 'audio/aac';
  if (normalized === 'ogg') return 'audio/ogg';
  if (normalized === 'webm') return 'audio/webm';
  return 'audio/mpeg';
}

async function ffprobeHasAudioStream(videoPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=index',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath
  ]);
  const marker = String(stdout || '').trim();
  return marker !== '';
}

function parseCreativeOsAudioExtension(mimeType, originalName, fallback = 'mp3') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('aac')) return 'aac';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  const ext = String(path.extname(originalName || '') || '').replace('.', '').toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
  return fallback;
}

function parseCreativeOsVideoExtension(mimeType, originalName, fallback = 'mp4') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  const ext = String(path.extname(originalName || '') || '').replace('.', '').toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
  return fallback;
}

function parseCreativeOsTtsLanguage(rawValue) {
  const candidate = sanitizeCreativeOsText(rawValue, 16, 'en').trim();
  if (CREATIVE_OS_TTS_LANG_ALLOWLIST.has(candidate)) return candidate;
  const shortLang = candidate.split('-')[0];
  if (CREATIVE_OS_TTS_LANG_ALLOWLIST.has(shortLang)) return shortLang;
  return 'en';
}

function splitCreativeOsTtsChunks(text, maxChunkChars = CREATIVE_OS_TTS_PROVIDER_MAX_CHARS) {
  const normalized = sanitizeCreativeOsText(text, CREATIVE_OS_TIMELINE_MAX_TTS_CHARS, '');
  if (!normalized) return [];

  const words = normalized.split(' ').filter(Boolean);
  const chunks = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxChunkChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let cursor = 0; cursor < word.length; cursor += maxChunkChars) {
        chunks.push(word.slice(cursor, cursor + maxChunkChars));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChunkChars) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    current = word;
  }

  if (current) chunks.push(current);
  return chunks;
}

async function synthesizeCreativeOsTtsChunks({ language, textChunks }) {
  const chunks = Array.isArray(textChunks) ? textChunks.filter(Boolean) : [];
  if (!chunks.length) {
    const err = new Error('TTS text is empty after chunking.');
    err.statusCode = 400;
    throw err;
  }

  const audioParts = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const response = await axios.get(CREATIVE_OS_TTS_SOURCE_BASE_URL, {
      responseType: 'arraybuffer',
      timeout: CREATIVE_OS_TTS_TIMEOUT_MS,
      params: {
        ie: 'UTF-8',
        client: 'tw-ob',
        tl: language,
        q: chunk,
        idx: index,
        total: chunks.length,
        textlen: chunk.length
      },
      headers: {
        'User-Agent': 'VironaCreativeOS/1.0'
      }
    });

    const audioBuffer = Buffer.from(response.data || []);
    if (!audioBuffer.length) {
      const err = new Error(`TTS provider returned empty audio for chunk ${index + 1}/${chunks.length}.`);
      err.statusCode = 502;
      throw err;
    }
    audioParts.push(audioBuffer);
  }

  return audioParts.length === 1 ? audioParts[0] : Buffer.concat(audioParts);
}

function resolveCreativeOsTransitionType(rawValue) {
  const normalized = sanitizeCreativeOsText(rawValue, 32, 'fade').toLowerCase();
  return CREATIVE_OS_TRANSITION_ALLOWLIST.has(normalized) ? normalized : 'fade';
}

async function ensureCreativeOsMusicLibraryTracks() {
  await ensureCreativeOsVideoDirs();
  const fadeOutStart = Math.max(0.1, CREATIVE_OS_MUSIC_TRACK_DURATION_SECONDS - 0.8);

  for (const track of CREATIVE_OS_MUSIC_LIBRARY_TRACKS) {
    const audioId = `lib_${track.id}`;
    const outputPath = getCreativeOsAudioUploadPath(audioId, 'mp3');
    if (fs.existsSync(outputPath)) continue;

    const baseFrequency = clampNumber(track.base_frequency_hz, 120, 420);
    const leadFrequency = clampNumber(track.lead_frequency_hz, 360, 1200);
    const baseVolume = clampNumber(track.base_volume, 0.08, 0.4);
    const leadVolume = clampNumber(track.lead_volume, 0.02, 0.2);
    const noiseVolume = clampNumber(track.noise_volume, 0.005, 0.05);
    const noiseColor = sanitizeCreativeOsText(track.noise_color, 16, 'pink').toLowerCase();

    const filterComplex = [
      `[0:a]volume=${baseVolume.toFixed(3)},lowpass=f=1500[base]`,
      `[1:a]volume=${leadVolume.toFixed(3)},highpass=f=520,aecho=0.8:0.6:85:0.22[lead]`,
      `[2:a]volume=${noiseVolume.toFixed(3)},highpass=f=2200[texture]`,
      `[base][lead][texture]amix=inputs=3:normalize=0,` +
        `afade=t=in:st=0:d=0.4,` +
        `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.8[out]`
    ].join(';');

    const ffmpegArgs = [
      '-f', 'lavfi',
      '-i', `sine=frequency=${baseFrequency.toFixed(2)}:sample_rate=44100:duration=${CREATIVE_OS_MUSIC_TRACK_DURATION_SECONDS}`,
      '-f', 'lavfi',
      '-i', `sine=frequency=${leadFrequency.toFixed(2)}:sample_rate=44100:duration=${CREATIVE_OS_MUSIC_TRACK_DURATION_SECONDS}`,
      '-f', 'lavfi',
      '-i', `anoisesrc=color=${noiseColor}:sample_rate=44100:duration=${CREATIVE_OS_MUSIC_TRACK_DURATION_SECONDS}`,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      '-y',
      outputPath
    ];

    try {
      await execFileAsync('ffmpeg', ffmpegArgs);
    } catch (error) {
      console.warn('[creative-os/music/library] ffmpeg generation warning:', error?.message || error);
      break;
    }
  }
}

function getCreativeOsMusicLibraryWarmupStatus() {
  return {
    status: creativeOsMusicLibraryWarmupState.status,
    started_at: creativeOsMusicLibraryWarmupState.startedAt,
    completed_at: creativeOsMusicLibraryWarmupState.completedAt,
    error: creativeOsMusicLibraryWarmupState.error
  };
}

function shouldRetryCreativeOsMusicWarmup() {
  if (creativeOsMusicLibraryWarmupState.status !== 'error') return false;
  const completedAtMs = creativeOsMusicLibraryWarmupState.completedAt
    ? new Date(creativeOsMusicLibraryWarmupState.completedAt).getTime()
    : 0;
  if (!Number.isFinite(completedAtMs) || completedAtMs <= 0) return true;
  return (Date.now() - completedAtMs) >= CREATIVE_OS_MUSIC_LIBRARY_WARMUP_RETRY_DELAY_MS;
}

function queueCreativeOsMusicLibraryWarmup({ force = false } = {}) {
  if (creativeOsMusicLibraryWarmupState.promise) {
    return creativeOsMusicLibraryWarmupState.promise;
  }

  if (!force) {
    if (creativeOsMusicLibraryWarmupState.status === 'ready') {
      return Promise.resolve(true);
    }
    if (creativeOsMusicLibraryWarmupState.status === 'error' && !shouldRetryCreativeOsMusicWarmup()) {
      return Promise.resolve(false);
    }
  }

  creativeOsMusicLibraryWarmupState.status = 'warming';
  creativeOsMusicLibraryWarmupState.startedAt = new Date().toISOString();
  creativeOsMusicLibraryWarmupState.error = null;

  const warmupPromise = ensureCreativeOsMusicLibraryTracks()
    .then(() => {
      creativeOsMusicLibraryWarmupState.status = 'ready';
      creativeOsMusicLibraryWarmupState.completedAt = new Date().toISOString();
      creativeOsMusicLibraryWarmupState.error = null;
      return true;
    })
    .catch((error) => {
      creativeOsMusicLibraryWarmupState.status = 'error';
      creativeOsMusicLibraryWarmupState.completedAt = new Date().toISOString();
      creativeOsMusicLibraryWarmupState.error = error?.code === 'ENOENT'
        ? 'ffmpeg/ffprobe not found on server. Install ffmpeg to build music library.'
        : (error?.message || 'Music library warmup failed.');
      console.warn('[creative-os/music/library] background warmup failed:', error?.message || error);
      return false;
    })
    .finally(() => {
      creativeOsMusicLibraryWarmupState.promise = null;
    });

  creativeOsMusicLibraryWarmupState.promise = warmupPromise;
  return warmupPromise;
}

function primeCreativeOsBackgroundWarmups() {
  if (!CREATIVE_OS_PREWARM_MUSIC_LIBRARY) return;
  setTimeout(() => {
    queueCreativeOsMusicLibraryWarmup().catch((error) => {
      console.warn('[creative-os/music/library] warmup bootstrap error:', error?.message || error);
    });
  }, 0);
}

primeCreativeOsBackgroundWarmups();

function buildCreativeOsTimelineTextExpression(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function buildCreativeOsTimelineFilter({
  captions,
  durationSeconds,
  width,
  height,
  fontPath,
  inputLabel = '[0:v]'
}) {
  const safeWidth = Math.max(1, Math.round(safeParseNumber(width, 1080)));
  const safeHeight = Math.max(1, Math.round(safeParseNumber(height, 1920)));
  const safeDuration = Math.max(0.1, safeParseNumber(durationSeconds, 30));
  const filters = [];
  let label = inputLabel;
  let step = 0;

  const defaultFontPath = fs.existsSync(fontPath || '')
    ? fontPath
    : (fs.existsSync(CREATIVE_OS_TIMELINE_FONT_PATH) ? CREATIVE_OS_TIMELINE_FONT_PATH : path.join(__dirname, '..', '..', 'Inter-Regular.ttf'));
  const escapedFontPath = escapeDrawtextPath(defaultFontPath);

  for (const caption of captions) {
    const start = clampNumber(caption.start, 0, safeDuration);
    const end = clampNumber(caption.end, start + 0.05, safeDuration);
    const text = sanitizeCreativeOsText(caption.text, CREATIVE_OS_TIMELINE_MAX_TEXT_CHARS, '');
    if (!text) continue;

    const marginX = clampNumber(caption.margin_x ?? caption.marginX ?? 68, 8, Math.floor(safeWidth * 0.3));
    const boxWidth = clampNumber(caption.width ?? Math.round(safeWidth - marginX * 2), 140, safeWidth - marginX);
    const boxHeight = clampNumber(caption.height ?? Math.round(Math.max(74, safeHeight * 0.11)), 44, Math.max(52, safeHeight * 0.4));
    const x = clampNumber(caption.x ?? Math.round((safeWidth - boxWidth) / 2), 0, Math.max(0, safeWidth - boxWidth));
    const y = clampNumber(caption.y ?? Math.round(safeHeight - boxHeight - safeHeight * 0.13), 0, Math.max(0, safeHeight - boxHeight));
    const fontSize = clampNumber(caption.font_size ?? caption.fontSize ?? Math.round(boxHeight * 0.32), CREATIVE_OS_TIMELINE_MIN_FONT_SIZE, CREATIVE_OS_TIMELINE_MAX_FONT_SIZE);

    const textColor = parseHexColor(caption.text_color || caption.textColor)?.hex || '#ffffff';
    const bgColor = parseHexColor(caption.bg_color || caption.bgColor)?.hex || '#111827';
    const opacity = clampNumber(caption.opacity ?? 0.82, 0.25, 1);
    const animation = sanitizeCreativeOsText(caption.animation, 32, 'fade_up').toLowerCase();
    const fadeInSec = clampNumber(caption.fade_in ?? caption.fadeIn ?? 0.16, 0.05, 0.8);
    const fadeOutSec = clampNumber(caption.fade_out ?? caption.fadeOut ?? 0.13, 0.05, 0.8);

    const boxColorWithAlpha = `${bgColor}@${opacity.toFixed(2)}`;
    const textExpr = buildCreativeOsTimelineTextExpression(text);

    let alphaExpr = `if(lt(t\\,${(start + fadeInSec).toFixed(3)})\\,(t-${start.toFixed(3)})/${fadeInSec.toFixed(3)}\\,if(lt(t\\,${(end - fadeOutSec).toFixed(3)})\\,1\\,((${end.toFixed(3)}-t)/${fadeOutSec.toFixed(3)})))`;
    if (animation === 'hard_cut') {
      alphaExpr = '1';
    }

    let yExpr = `${y}+((${boxHeight}-text_h)/2)`;
    if (animation === 'fade_up') {
      yExpr = `${y}+((${boxHeight}-text_h)/2)+if(lt(t\\,${(start + fadeInSec).toFixed(3)})\\,${Math.round(boxHeight * 0.14)}*(1-((t-${start.toFixed(3)})/${fadeInSec.toFixed(3)}))\\,0)`;
    }
    if (animation === 'pop') {
      const popWindow = clampNumber(caption.pop_window ?? 0.14, 0.05, 0.4);
      alphaExpr = `if(lt(t\\,${(start + popWindow).toFixed(3)})\\,min(1\\,(t-${start.toFixed(3)})/${popWindow.toFixed(3)}*1.25)\\,if(lt(t\\,${(end - fadeOutSec).toFixed(3)})\\,1\\,((${end.toFixed(3)}-t)/${fadeOutSec.toFixed(3)})))`;
    }

    const enableExpr = `between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`;

    const drawboxOut = `[cosvb${step}]`;
    filters.push(`${label}drawbox=x=${Math.round(x)}:y=${Math.round(y)}:w=${Math.round(boxWidth)}:h=${Math.round(boxHeight)}:color=${boxColorWithAlpha}:t=fill:enable='${enableExpr}'${drawboxOut}`);
    label = drawboxOut;
    step += 1;

    const drawtextOut = `[cosvt${step}]`;
    const drawtext = `drawtext=fontfile='${escapedFontPath}':text='${textExpr}':` +
      `x=${Math.round(x)}+((${Math.round(boxWidth)}-text_w)/2):` +
      `y=${yExpr}:fontsize=${Math.round(fontSize)}:fontcolor=${textColor}:alpha='${alphaExpr}':expansion=none:enable='${enableExpr}'`;
    filters.push(`${label}${drawtext}${drawtextOut}`);
    label = drawtextOut;
    step += 1;
  }

  return {
    filterComplex: filters.join(';'),
    finalVideoLabel: label
  };
}

function resolveCreativeOsFormatConfig(formatId) {
  const normalized = String(formatId || '').trim();
  return CREATIVE_OS_FORMAT_CONFIG[normalized] || CREATIVE_OS_FORMAT_CONFIG.meta_feed_4_5;
}

function resolveCreativeOsScenePreset(scenePresetId) {
  const normalized = String(scenePresetId || '').trim().toLowerCase();
  return CREATIVE_OS_SCENE_PRESETS[normalized] || CREATIVE_OS_SCENE_PRESETS[CREATIVE_OS_DEFAULT_SCENE_PRESET];
}

function buildCreativeOsAssetDownloadUrl({ assetId, fileName, store }) {
  return withStoreParam(
    `/api/creative-studio/creative-os/export/download?asset_id=${encodeURIComponent(assetId)}&filename=${encodeURIComponent(fileName)}`,
    store
  );
}

function buildCreativeOsSceneBackdropSvg({ formatConfig, preset, brandPrimary, brandAccent }) {
  const width = formatConfig.width;
  const height = formatConfig.height;
  const safe = formatConfig.safeZone;
  const safeTop = Math.round(height * safe.top);
  const safeBottom = Math.round(height * safe.bottom);
  const safeLeft = Math.round(width * safe.left);
  const safeRight = Math.round(width * safe.right);
  const orbSize = Math.round(Math.min(width, height) * 0.46);
  const panelHeight = Math.round(height * 0.36);
  const panelY = height - safeBottom - panelHeight;
  const panelWidth = width - safeLeft - safeRight;
  const panelX = safeLeft;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="orbA" cx="0" cy="0" r="1">
      <stop offset="0%" stop-color="${preset.orbA}" stop-opacity="0.44"/>
      <stop offset="100%" stop-color="${preset.orbA}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="orbB" cx="0" cy="0" r="1">
      <stop offset="0%" stop-color="${preset.orbB}" stop-opacity="0.36"/>
      <stop offset="100%" stop-color="${preset.orbB}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${preset.bgStart}" />
      <stop offset="55%" stop-color="${brandPrimary}" />
      <stop offset="100%" stop-color="${brandAccent}" />
    </linearGradient>
    <linearGradient id="panel" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${preset.panelTint}" />
      <stop offset="100%" stop-color="rgba(255,255,255,0.1)" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.17)}" r="${orbSize}" fill="url(#orbA)" />
  <circle cx="${Math.round(width * 0.87)}" cy="${Math.round(height * 0.12)}" r="${Math.round(orbSize * 0.74)}" fill="url(#orbB)" />
  <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="${Math.round(panelHeight * 0.14)}" fill="url(#panel)" />
  <ellipse cx="${Math.round(width / 2)}" cy="${Math.round(height - safeBottom - (height * 0.02))}" rx="${Math.round(width * 0.34)}" ry="${Math.round(height * 0.03)}" fill="${preset.floor}" />
  <rect x="${safeLeft}" y="${safeTop}" width="${panelWidth}" height="${Math.max(120, panelY - safeTop - 16)}" rx="${Math.round(Math.min(width, height) * 0.03)}" fill="rgba(255,255,255,0.05)" />
</svg>`;
}

async function renderCreativeOsScenePlacement({
  sourceBuffer,
  formatConfig,
  scenePresetId,
  brandPrimary,
  brandAccent
}) {
  const preset = resolveCreativeOsScenePreset(scenePresetId);
  const width = formatConfig.width;
  const height = formatConfig.height;
  const safeBottom = Math.round(height * (formatConfig.safeZone?.bottom || 0.18));
  const maxProductWidth = Math.round(width * 0.78);
  const maxProductHeight = Math.round(height * 0.66);

  const productBuffer = await sharp(sourceBuffer)
    .rotate()
    .png()
    .resize(maxProductWidth, maxProductHeight, { fit: 'contain', withoutEnlargement: true })
    .toBuffer();

  const productMeta = await sharp(productBuffer).metadata();
  const productWidth = productMeta.width || maxProductWidth;
  const productHeight = productMeta.height || maxProductHeight;
  const productX = Math.round((width - productWidth) / 2);
  const productY = Math.max(
    Math.round(height * 0.14),
    Math.round(height - safeBottom - productHeight - (height * 0.04))
  );

  const shadowWidth = Math.max(140, Math.round(productWidth * 0.72));
  const shadowHeight = Math.max(32, Math.round(productHeight * 0.1));
  const shadowX = Math.round((width - shadowWidth) / 2);
  const shadowY = Math.min(
    height - safeBottom - Math.round(shadowHeight * 0.18),
    productY + productHeight - Math.round(shadowHeight * 0.4)
  );

  const shadowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <filter id="shadow-blur" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${Math.max(6, Math.round(shadowHeight * 0.16))}" />
    </filter>
  </defs>
  <ellipse cx="${shadowX + Math.round(shadowWidth / 2)}" cy="${shadowY}" rx="${Math.round(shadowWidth / 2)}" ry="${Math.round(shadowHeight / 2)}" fill="rgba(15,23,42,0.34)" filter="url(#shadow-blur)" />
</svg>`;

  const backdrop = Buffer.from(buildCreativeOsSceneBackdropSvg({ formatConfig, preset, brandPrimary, brandAccent }));
  const composedBuffer = await sharp(backdrop)
    .composite([
      { input: Buffer.from(shadowSvg), top: 0, left: 0 },
      { input: productBuffer, top: productY, left: productX }
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return {
    scene: preset,
    buffer: composedBuffer,
    placement: {
      x: productX,
      y: productY,
      width: productWidth,
      height: productHeight
    }
  };
}

function parseCreativeOsBeatMarkers(rawValue, maxDuration) {
  const beatInput = Array.isArray(rawValue) ? rawValue : [];
  const beats = beatInput
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= maxDuration)
    .map((value) => Number(value.toFixed(3)));

  const unique = [];
  const seen = new Set();
  for (const beat of beats) {
    const key = beat.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(beat);
    if (unique.length >= CREATIVE_OS_MAX_BEAT_MARKERS) break;
  }
  return unique.sort((a, b) => a - b);
}

function snapCaptionBoundaryToBeat(boundary, beatMarkers, minValue, maxValue) {
  if (!beatMarkers.length) return boundary;

  let best = boundary;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const beat of beatMarkers) {
    if (beat < minValue || beat > maxValue) continue;
    const delta = Math.abs(beat - boundary);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = beat;
    }
  }

  if (!Number.isFinite(bestDelta) || bestDelta > CREATIVE_OS_CAPTION_SNAP_TOLERANCE_SECONDS) {
    return boundary;
  }
  return best;
}

function buildCreativeOsCaptionPlan({
  scriptText,
  durationSeconds,
  maxWordsPerSegment,
  beatMarkers
}) {
  const normalizedScript = String(scriptText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CREATIVE_OS_MAX_CAPTION_PLAN_SCRIPT_LENGTH);

  if (!normalizedScript) return [];

  const words = normalizedScript.split(' ').filter(Boolean);
  const segmentWordLimit = clampNumber(
    maxWordsPerSegment ?? 5,
    CREATIVE_OS_MIN_CAPTION_WORDS_PER_SEGMENT,
    CREATIVE_OS_MAX_CAPTION_WORDS_PER_SEGMENT
  );

  const chunks = [];
  for (let idx = 0; idx < words.length; idx += segmentWordLimit) {
    chunks.push(words.slice(idx, idx + segmentWordLimit).join(' '));
  }

  const safeDuration = clampNumber(durationSeconds, 3, 180);
  const boundaries = [0];
  for (let idx = 1; idx < chunks.length; idx += 1) {
    const nominalBoundary = (idx / chunks.length) * safeDuration;
    const minBoundary = boundaries[idx - 1] + CREATIVE_OS_MIN_CAPTION_SEGMENT_SECONDS;
    const maxBoundary = Math.max(minBoundary, safeDuration - CREATIVE_OS_MIN_CAPTION_SEGMENT_SECONDS);
    const snapped = snapCaptionBoundaryToBeat(nominalBoundary, beatMarkers, minBoundary, maxBoundary);
    boundaries.push(Math.min(maxBoundary, Math.max(minBoundary, snapped)));
  }
  boundaries.push(safeDuration);

  for (let idx = 1; idx < boundaries.length; idx += 1) {
    if (boundaries[idx] <= boundaries[idx - 1]) {
      boundaries[idx] = Math.min(
        safeDuration,
        boundaries[idx - 1] + CREATIVE_OS_MIN_CAPTION_SEGMENT_SECONDS
      );
    }
  }
  boundaries[boundaries.length - 1] = safeDuration;

  return chunks.map((text, idx) => {
    const start = Number(boundaries[idx].toFixed(3));
    const end = Number(Math.max(start + CREATIVE_OS_MIN_CAPTION_SEGMENT_SECONDS, boundaries[idx + 1]).toFixed(3));
    return {
      id: idx + 1,
      start,
      end: Number(Math.min(safeDuration, end).toFixed(3)),
      text,
      words: text.split(' ').length
    };
  });
}

function buildCreativeOsSvgAsset({
  formatConfig,
  productName,
  productDescription,
  caption,
  priceLabel,
  templateName,
  brandPrimary,
  brandAccent
}) {
  const width = formatConfig.width;
  const height = formatConfig.height;
  const safe = formatConfig.safeZone;

  const safeTop = Math.round(height * safe.top);
  const safeBottom = Math.round(height * safe.bottom);
  const safeLeft = Math.round(width * safe.left);
  const safeRight = Math.round(width * safe.right);

  const contentWidth = width - safeLeft - safeRight;
  const panelHeight = Math.round(height * 0.28);
  const panelY = Math.round(height - safeBottom - panelHeight);
  const headerY = safeTop + Math.round(height * 0.05);
  const headlineFontSize = Math.max(40, Math.round(Math.min(width, height) * 0.06));
  const captionFontSize = Math.max(24, Math.round(Math.min(width, height) * 0.028));

  const headlineLines = splitTextLines(productName, 26, 2);
  const captionLines = splitTextLines(caption || productDescription, 50, 3);
  const accentTextColor = bestTextColorForBackground(brandAccent);

  const headlineSvg = headlineLines.map((line, index) => (
    `<tspan x="${safeLeft}" y="${headerY + (index * (headlineFontSize + 10))}">${escapeXml(line)}</tspan>`
  )).join('');

  const captionStartY = panelY + Math.round(panelHeight * 0.35);
  const captionSvg = captionLines.map((line, index) => (
    `<tspan x="${safeLeft + 24}" y="${captionStartY + (index * (captionFontSize + 10))}">${escapeXml(line)}</tspan>`
  )).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${brandPrimary}" />
      <stop offset="100%" stop-color="${brandAccent}" />
    </linearGradient>
    <linearGradient id="panel" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="rgba(15, 23, 42, 0.62)" />
      <stop offset="100%" stop-color="rgba(15, 23, 42, 0.34)" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect x="${safeLeft}" y="${safeTop}" width="${contentWidth}" height="${Math.max(100, panelY - safeTop - 24)}" fill="rgba(255,255,255,0.08)" rx="28" />
  <rect x="${safeLeft}" y="${panelY}" width="${contentWidth}" height="${panelHeight}" fill="url(#panel)" rx="24" />
  <text fill="#ffffff" font-size="${headlineFontSize}" font-family="Inter, Arial, sans-serif" font-weight="700">
    ${headlineSvg}
  </text>
  <rect x="${safeLeft + 24}" y="${panelY + 24}" width="${Math.max(220, Math.round(contentWidth * 0.36))}" height="${Math.max(54, Math.round(panelHeight * 0.26))}" rx="16" fill="${brandAccent}" />
  <text x="${safeLeft + 40}" y="${panelY + 60}" fill="${accentTextColor}" font-size="${Math.max(30, Math.round(captionFontSize * 1.2))}" font-family="Inter, Arial, sans-serif" font-weight="700">${escapeXml(priceLabel)}</text>
  <text fill="#ffffff" font-size="${captionFontSize}" font-family="Inter, Arial, sans-serif" font-weight="500">
    ${captionSvg}
  </text>
  <text x="${safeLeft + 24}" y="${panelY + panelHeight - 20}" fill="rgba(255,255,255,0.86)" font-size="${Math.max(18, Math.round(captionFontSize * 0.76))}" font-family="Inter, Arial, sans-serif" font-weight="600">${escapeXml(templateName)}</text>
</svg>`;
}

function buildCreativeOsProductRecord({
  key,
  productId,
  title,
  imageUrl,
  avgPrice,
  unitsSold,
  lastSeen,
  currency
}) {
  const normalizedName = sanitizeCreativeOsText(title, CREATIVE_OS_MAX_PRODUCT_NAME_LENGTH, 'Product');
  const resolvedCollection = inferCollectionFromSignals({ unitsSold, lastSeenIso: lastSeen });
  const resolvedPrice = Number.isFinite(Number(avgPrice)) && Number(avgPrice) > 0
    ? Number(Number(avgPrice).toFixed(2))
    : null;

  return {
    id: productId || key || toCreativeOsSlug(normalizedName, 'product'),
    product_id: productId || null,
    name: normalizedName,
    price: resolvedPrice,
    currency: parseCurrencyCandidate(currency) || CREATIVE_OS_DEFAULT_CURRENCY,
    collection: resolvedCollection,
    angles: 4,
    variants: 3,
    units_sold: Number(unitsSold || 0),
    image_url: imageUrl || null,
    blurb: 'Synced from connected catalog data.',
    source: 'catalog',
    last_seen: lastSeen || null
  };
}

function buildCreativeOsPaletteFromRawImage(rawBuffer, channels) {
  const bucketCounts = new Map();
  const stride = Math.max(3, channels || 3);

  for (let i = 0; i < rawBuffer.length; i += stride) {
    const r = rawBuffer[i];
    const g = rawBuffer[i + 1];
    const b = rawBuffer[i + 2];
    if (![r, g, b].every((value) => Number.isFinite(value))) continue;

    const rb = Math.floor(r / CREATIVE_OS_QUANTIZATION_STEP);
    const gb = Math.floor(g / CREATIVE_OS_QUANTIZATION_STEP);
    const bb = Math.floor(b / CREATIVE_OS_QUANTIZATION_STEP);
    const key = `${rb},${gb},${bb}`;
    bucketCounts.set(key, (bucketCounts.get(key) || 0) + 1);
  }

  const sortedBuckets = Array.from(bucketCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, CREATIVE_OS_MAX_PALETTE_COLORS);

  return sortedBuckets.map(([key, hits]) => {
    const [rb, gb, bb] = key.split(',').map((part) => Number(part));
    const r = Math.min(255, rb * CREATIVE_OS_QUANTIZATION_STEP + Math.floor(CREATIVE_OS_QUANTIZATION_STEP / 2));
    const g = Math.min(255, gb * CREATIVE_OS_QUANTIZATION_STEP + Math.floor(CREATIVE_OS_QUANTIZATION_STEP / 2));
    const b = Math.min(255, bb * CREATIVE_OS_QUANTIZATION_STEP + Math.floor(CREATIVE_OS_QUANTIZATION_STEP / 2));
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    return {
      hex,
      hits,
      recommendedTextColor: bestTextColorForBackground(hex)
    };
  });
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

function toOverlayBox(det, { startTime, endTime, videoWidth: maxVideoWidth = 0, videoHeight: maxVideoHeight = 0 } = {}) {
  const font = det?.font || {};
  const colors = det?.colors || {};
  const backgroundHex = colors?.background?.hex || '#333333';
  const textHex = colors?.text?.hex || '#ffffff';
  const videoWidth = Math.max(0, Math.round(safeParseNumber(maxVideoWidth, 0)));
  const videoHeight = Math.max(0, Math.round(safeParseNumber(maxVideoHeight, 0)));
  const rawWidth = Math.max(1, Math.round(safeParseNumber(det?.width, 1)));
  const rawHeight = Math.max(1, Math.round(safeParseNumber(det?.height, 1)));
  const width = videoWidth > 1 ? clampNumber(rawWidth, 1, videoWidth) : rawWidth;
  const height = videoHeight > 1 ? clampNumber(rawHeight, 1, videoHeight) : rawHeight;
  const rawX = Math.round(safeParseNumber(det?.x, 0));
  const rawY = Math.round(safeParseNumber(det?.y, 0));
  const x = videoWidth > 1 ? clampNumber(rawX, 0, Math.max(0, videoWidth - width)) : Math.max(0, rawX);
  const y = videoHeight > 1 ? clampNumber(rawY, 0, Math.max(0, videoHeight - height)) : Math.max(0, rawY);

  return {
    id: crypto.randomUUID(),
    x,
    y,
    width,
    height,
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

function tokenizeOverlayKey(text) {
  return new Set(
    normalizeOverlayKey(text)
      .split(' ')
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

function scoreOverlayTextMatch({ segmentKey, overlayText }) {
  const segNorm = normalizeOverlayKey(segmentKey);
  const overlayNorm = normalizeOverlayKey(overlayText);
  if (!segNorm || !overlayNorm) return 0;
  if (segNorm === overlayNorm) return 4;
  if (segNorm.includes(overlayNorm) || overlayNorm.includes(segNorm)) return 2.5;

  const segTokens = tokenizeOverlayKey(segNorm);
  const overlayTokens = tokenizeOverlayKey(overlayNorm);
  if (!segTokens.size || !overlayTokens.size) return 0;

  let intersection = 0;
  for (const token of segTokens) {
    if (overlayTokens.has(token)) intersection += 1;
  }

  const union = new Set([...segTokens, ...overlayTokens]).size || 1;
  return (intersection / union) * 2;
}

function scoreSampleOverlaySet({ segmentKey, overlays, sampleTime, preferredTime }) {
  if (!Array.isArray(overlays) || overlays.length === 0) return Number.NEGATIVE_INFINITY;

  const bestOverlayScore = overlays.reduce((best, overlay) => {
    const confidence = safeParseNumber(overlay?.confidence, 0);
    const textScore = scoreOverlayTextMatch({ segmentKey, overlayText: overlay?.text || '' });
    return Math.max(best, confidence + textScore);
  }, Number.NEGATIVE_INFINITY);

  const timePenalty = Math.abs(safeParseNumber(sampleTime, 0) - safeParseNumber(preferredTime, 0)) * 0.01;
  return bestOverlayScore - timePenalty;
}

function buildSegmentSampleTimes(seg, durationSec) {
  const start = clampNumber(seg?.start, 0, durationSec);
  const end = clampNumber(seg?.end, start, durationSec);
  const span = Math.max(0, end - start);
  const edgeOffset = Math.min(0.25, Math.max(0.05, span * 0.25));

  const candidates = [
    clampNumber(seg?.sample_t ?? start, start, end || durationSec),
    clampNumber(start + span / 2, start, end || durationSec),
    clampNumber(start + edgeOffset, start, end || durationSec),
    clampNumber(end - edgeOffset, start, end || durationSec),
    clampNumber(start + 0.01, start, end || durationSec)
  ];

  const seen = new Set();
  const unique = [];
  for (const t of candidates) {
    const key = Number(t).toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(Number(key));
  }
  return unique;
}

function buildPlaceholderOverlay({ seg, videoWidth, videoHeight } = {}) {
  const safeWidth = Math.max(360, Math.round(safeParseNumber(videoWidth, 1080)));
  const safeHeight = Math.max(360, Math.round(safeParseNumber(videoHeight, 1920)));

  const width = Math.round(clampNumber(safeWidth * 0.58, 180, Math.max(180, safeWidth - 20)));
  const height = Math.round(clampNumber(width * 0.22, 56, Math.max(56, safeHeight * 0.35)));
  const x = Math.round(clampNumber((safeWidth - width) / 2, 0, Math.max(0, safeWidth - width)));
  const y = Math.round(clampNumber(safeHeight * 0.68, 0, Math.max(0, safeHeight - height)));
  const fontSize = Math.round(clampNumber(height * 0.42, 18, 56));

  const rawText = String(seg?.label || '').trim();
  const text = rawText && rawText.toUpperCase() !== 'UNREADABLE'
    ? rawText.slice(0, 120)
    : 'Edit overlay text';

  return {
    id: crypto.randomUUID(),
    x,
    y,
    width,
    height,
    text,
    backgroundColor: '#a32929',
    textColor: '#ffffff',
    fontSize,
    fontWeight: 'bold',
    fontStyle: 'normal',
    fontFamily: 'Inter',
    isGradient: false,
    gradient: null,
    confidence: 0,
    startTime: typeof seg?.start === 'number' ? seg.start : null,
    endTime: typeof seg?.end === 'number' ? seg.end : null,
    placeholder: true
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
    WHERE store = ? AND COALESCE(is_excluded, 0) = 0 AND country_code IS NOT NULL AND country_code != ''
    GROUP BY country_code
    UNION ALL
    SELECT country_code as country, COUNT(*) as orders, SUM(COALESCE(subtotal, 0) + COALESCE(shipping, 0)) as revenue
    FROM shopify_orders
    WHERE store = ? AND COALESCE(is_excluded, 0) = 0 AND country_code IS NOT NULL AND country_code != ''
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

    const requestedModel = sanitizeCreativeOsText(model, 128, DEFAULT_GEMINI_TEXT_MODEL);
    const requestGemini = async (targetModel) => {
      const modelName = sanitizeCreativeOsText(targetModel, 128, DEFAULT_GEMINI_TEXT_MODEL);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;
      return axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const response = await requestGemini(requestedModel);
      return res.json({
        ...response.data,
        model: requestedModel
      });
    } catch (primaryError) {
      const upstreamStatus = Number.isInteger(primaryError?.response?.status)
        ? primaryError.response.status
        : null;
      const upstreamMessage = primaryError?.response?.data?.error?.message || primaryError.message || 'Gemini request failed.';
      const shouldFallbackToDefault =
        requestedModel !== DEFAULT_GEMINI_TEXT_MODEL &&
        (upstreamStatus === 404 || upstreamStatus === 400) &&
        GEMINI_MODEL_FALLBACK_MESSAGE_PATTERN.test(String(upstreamMessage || ''));

      if (shouldFallbackToDefault) {
        try {
          const fallbackResponse = await requestGemini(DEFAULT_GEMINI_TEXT_MODEL);
          return res.json({
            ...fallbackResponse.data,
            model: DEFAULT_GEMINI_TEXT_MODEL,
            fallback_from: requestedModel
          });
        } catch (fallbackError) {
          const fallbackStatus = Number.isInteger(fallbackError?.response?.status)
            ? fallbackError.response.status
            : null;
          const fallbackMessage = fallbackError?.response?.data?.error?.message || fallbackError.message || 'Gemini fallback failed.';
          console.error('Gemini fallback error:', fallbackError?.response?.data || fallbackError.message);
          return res.status(fallbackStatus || upstreamStatus || 500).json({
            error: fallbackMessage,
            model: DEFAULT_GEMINI_TEXT_MODEL,
            fallback_from: requestedModel,
            primary_error: upstreamMessage
          });
        }
      }

      console.error('Gemini proxy error:', primaryError?.response?.data || primaryError.message);
      return res.status(upstreamStatus || 500).json({ error: upstreamMessage, model: requestedModel });
    }
  } catch (error) {
    console.error('Gemini proxy error:', error?.response?.data || error.message);
    const upstreamStatus = Number.isInteger(error?.response?.status) ? error.response.status : 500;
    return res.status(upstreamStatus).json({ error: error?.response?.data?.error?.message || error.message });
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
    const configuredModel = String(process.env.VIDEO_OVERLAY_SCAN_MODEL || '').trim();
    const resolvedModel = resolveVideoOverlayScanModel({ configuredModel });
    const modelWarning = getVideoOverlayScanModelWarning(configuredModel);

    res.json({
      success: true,
      overlay_ai: {
        configured: overlayAiConfigured,
        url: process.env.VIDEO_OVERLAY_AI_URL || null,
        health: overlayAiHealth,
        timeouts_ms: {
          default: Number(process.env.VIDEO_OVERLAY_AI_TIMEOUT_MS || 120000),
          health: Number(process.env.VIDEO_OVERLAY_AI_HEALTH_TIMEOUT_MS || 10000),
          detect: Number(process.env.VIDEO_OVERLAY_AI_DETECT_TIMEOUT_MS || Number(process.env.VIDEO_OVERLAY_AI_TIMEOUT_MS || 120000))
        }
      },
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY),
        model: resolvedModel,
        configured_model: configuredModel || null,
        supported_models: VIDEO_OVERLAY_SUPPORTED_SCAN_MODELS,
        warning: modelWarning
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

async function detectOverlayKeysWithGemini({ frames, modelName = null } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const resolvedModelName = resolveVideoOverlayScanModel({
    requestedModel: modelName,
    configuredModel: process.env.VIDEO_OVERLAY_SCAN_MODEL || ''
  });
  const genAI = new GoogleGenerativeAI(apiKey);

  const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      frames: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            t: { type: SchemaType.NUMBER },
            overlay_text: { type: SchemaType.STRING, nullable: true }
          },
          required: ['t', 'overlay_text']
        }
      }
    },
    required: ['frames']
  };

  const model = genAI.getGenerativeModel({
    model: resolvedModelName,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: Math.round(clampNumber(process.env.VIDEO_OVERLAY_GEMINI_MAX_OUTPUT_TOKENS ?? 2048, 512, 8192)),
      responseMimeType: 'application/json',
      responseSchema
    }
  });

  const results = [];
  const configuredChunkSize = Math.round(clampNumber(process.env.VIDEO_OVERLAY_GEMINI_CHUNK_SIZE ?? 8, 1, 16));
  const chunkSize = resolvedModelName === 'gemini-3-pro-preview'
    ? Math.min(configuredChunkSize, 4)
    : configuredChunkSize;
  const parseRetries = Math.round(clampNumber(process.env.VIDEO_OVERLAY_GEMINI_PARSE_RETRIES ?? 2, 0, 5));
  const maxRetries = Math.round(clampNumber(process.env.VIDEO_OVERLAY_GEMINI_RETRIES ?? 6, 0, 10));
  const minDelayMs = Math.round(clampNumber(process.env.VIDEO_OVERLAY_GEMINI_MIN_DELAY_MS ?? 250, 0, 5000));

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getHttpStatus = (error) => {
    if (!error) return null;
    if (Number.isFinite(error.status)) return Number(error.status);
    const msg = String(error.message || '');
    const match = msg.match(/\[(\d{3})\s/);
    return match ? Number(match[1]) : null;
  };

  const isRetryable = (error) => {
    const status = getHttpStatus(error);
    if (status === 429) return true;
    if (status && [500, 502, 503, 504].includes(status)) return true;
    const msg = String(error?.message || '').toLowerCase();
    return msg.includes('resource exhausted') || msg.includes('too many requests') || msg.includes('quota');
  };

  const generateWithRetry = async (parts) => {
    let attempt = 0;
    while (true) {
      try {
        return await model.generateContent(parts);
      } catch (error) {
        const status = getHttpStatus(error);
        if (!isRetryable(error) || attempt >= maxRetries) {
          const err = new Error(
            status === 429
              ? `Gemini rate limit / quota exceeded (HTTP 429). Try again in a minute, lower max frames, or increase quota. Model=${resolvedModelName}.`
              : `Gemini request failed${status ? ` (HTTP ${status})` : ''}. Model=${resolvedModelName}. ${error?.message || ''}`.trim()
          );
          err.statusCode = status || 500;
          err.cause = error;
          throw err;
        }

        // Exponential backoff with jitter (kept small to avoid long-running requests).
        const base = 750;
        const delay = Math.min(15000, base * Math.pow(2, attempt)) + Math.floor(Math.random() * 250);
        attempt += 1;
        await sleep(delay);
      }
    }
  };

  const extractFirstJsonObject = (rawText) => {
    const text = String(rawText || '');
    const start = text.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
          continue;
        }
        if (ch === '\\') {
          isEscaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  };

  const parseGeminiJson = (rawText) => {
    const cleaned = String(rawText || '')
      .replace(/```json|```/g, '')
      .trim();

    if (!cleaned) {
      throw new Error('Gemini returned an empty response body.');
    }

    try {
      return JSON.parse(cleaned);
    } catch {}

    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) {
      throw new Error(`Gemini returned JSON but it looks incomplete. Preview: ${cleaned.slice(0, 200)}`);
    }

    try {
      return JSON.parse(extracted);
    } catch {
      throw new Error(`Gemini returned invalid JSON. Preview: ${cleaned.slice(0, 200)}`);
    }
  };

  const buildChunkParts = (chunk) => {
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
    return parts;
  };

  const normalizeFrameRows = (parsed) => {
    const frameRows = Array.isArray(parsed?.frames) ? parsed.frames : [];
    const rows = [];
    for (const row of frameRows) {
      const t = safeParseNumber(row?.t, null);
      if (t === null) continue;
      rows.push({ t, overlay_text: row?.overlay_text ?? null });
    }
    return rows;
  };

  const requestChunkRows = async (chunk, { allowSplit = true } = {}) => {
    let lastParseError = null;
    for (let attempt = 0; attempt <= parseRetries; attempt += 1) {
      const result = await generateWithRetry(buildChunkParts(chunk));
      const text = String(result?.response?.text?.() ?? '').trim();
      try {
        const parsed = parseGeminiJson(text);
        const rows = normalizeFrameRows(parsed);
        if (rows.length > 0) {
          return rows;
        }
        lastParseError = new Error('Gemini returned no frame rows.');
      } catch (error) {
        lastParseError = error;
      }

      if (attempt < parseRetries) {
        await sleep(300 * (attempt + 1));
      }
    }

    if (allowSplit && chunk.length > 1) {
      const splitRows = [];
      for (const frame of chunk) {
        const rows = await requestChunkRows([frame], { allowSplit: false });
        splitRows.push(...rows);
      }
      return splitRows;
    }

    const fallbackRows = chunk
      .map((frame) => ({ t: safeParseNumber(frame?.t, null), overlay_text: null }))
      .filter((row) => row.t !== null);

    if (lastParseError) {
      console.warn(
        `[video-overlay] Gemini parse fallback used for ${chunk.length} frame(s). Model=${resolvedModelName}. Reason=${lastParseError.message}`
      );
    }

    return fallbackRows;
  };

  for (let i = 0; i < frames.length; i += chunkSize) {
    const chunk = frames.slice(i, i + chunkSize);
    const rows = await requestChunkRows(chunk);
    results.push(...rows);

    if (minDelayMs > 0 && i + chunkSize < frames.length) {
      await sleep(minDelayMs);
    }
  }

  const dedupByTime = new Map();
  for (const row of results) {
    const t = safeParseNumber(row?.t, null);
    if (t === null) continue;
    const key = Number(t).toFixed(3);
    const prev = dedupByTime.get(key);
    if (!prev || (prev.overlay_text == null && row.overlay_text != null)) {
      dedupByTime.set(key, { t, overlay_text: row?.overlay_text ?? null });
    }
  }

  return Array.from(dedupByTime.values()).sort((a, b) => a.t - b.t);
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

async function detectSegmentOverlaysWithGeminiVision({
  frameBase64,
  videoWidth,
  videoHeight,
  modelName = null,
  startTime = null,
  endTime = null
} = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }
  if (!frameBase64) {
    throw new Error('Frame image is required for Gemini Vision detection.');
  }

  const resolvedModelName = resolveVideoOverlayScanModel({
    requestedModel: modelName,
    configuredModel: process.env.VIDEO_OVERLAY_SCAN_MODEL || ''
  });
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: resolvedModelName,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json'
    }
  });

  const prompt = `Analyze this video frame and detect all text overlay boxes (banners, captions, labels with colored backgrounds and text on top).

For each overlay found, return a JSON array where each item has:
- "box_2d": [y0, x0, y1, x1] — bounding box coordinates normalized to 0-1000 scale
- "text": the exact text content displayed in the overlay
- "bg_color": background color as hex string (e.g. "#8B1A1A")
- "text_color": text color as hex string (e.g. "#FFFFFF")
- "font_size_ratio": estimated font height as a ratio of the overlay box height (0.0 to 1.0)
- "font_weight": "normal" or "bold"
- "font_style": "normal" or "italic"

Only detect overlays that are clearly added/burned-in text boxes with solid or gradient backgrounds — NOT text that is naturally part of the scene (signs, clothing, etc).

Return ONLY a JSON array. No explanation, no markdown.`;

  const extractFirstJsonArray = (rawText) => {
    const text = String(rawText || '');
    const start = text.indexOf('[');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '[') {
        depth += 1;
        continue;
      }
      if (ch === ']') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  };

  const parseGeminiArray = (rawText) => {
    const cleaned = String(rawText || '')
      .replace(/```json|```/g, '')
      .trim();

    if (!cleaned) return [];

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.overlays)) return parsed.overlays;
    } catch {}

    const extracted = extractFirstJsonArray(cleaned);
    if (!extracted) {
      throw new Error(`Gemini returned invalid JSON array. Preview: ${cleaned.slice(0, 200)}`);
    }

    try {
      const parsed = JSON.parse(extracted);
      if (Array.isArray(parsed)) return parsed;
    } catch {}

    throw new Error(`Gemini returned invalid JSON array. Preview: ${cleaned.slice(0, 200)}`);
  };

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: frameBase64 } }
  ]);

  const rawText = String(result?.response?.text?.() ?? '').trim();
  const geminiRows = parseGeminiArray(rawText);
  const safeVideoWidth = Math.max(1, Math.round(safeParseNumber(videoWidth, 1)));
  const safeVideoHeight = Math.max(1, Math.round(safeParseNumber(videoHeight, 1)));

  const overlays = [];
  for (const item of geminiRows) {
    const box = Array.isArray(item?.box_2d) ? item.box_2d : null;
    if (!box || box.length !== 4) continue;

    const y0Norm = clampNumber(box[0], 0, 1000);
    const x0Norm = clampNumber(box[1], 0, 1000);
    const y1Norm = clampNumber(box[2], 0, 1000);
    const x1Norm = clampNumber(box[3], 0, 1000);

    const yMinNorm = Math.min(y0Norm, y1Norm);
    const yMaxNorm = Math.max(y0Norm, y1Norm);
    const xMinNorm = Math.min(x0Norm, x1Norm);
    const xMaxNorm = Math.max(x0Norm, x1Norm);

    const x = Math.round((xMinNorm / 1000) * safeVideoWidth);
    const y = Math.round((yMinNorm / 1000) * safeVideoHeight);
    const width = Math.round(((xMaxNorm - xMinNorm) / 1000) * safeVideoWidth);
    const height = Math.round(((yMaxNorm - yMinNorm) / 1000) * safeVideoHeight);

    const clampedX = Math.max(0, Math.min(x, safeVideoWidth - 1));
    const clampedY = Math.max(0, Math.min(y, safeVideoHeight - 1));
    const clampedW = Math.max(1, Math.min(width, safeVideoWidth - clampedX));
    const clampedH = Math.max(1, Math.min(height, safeVideoHeight - clampedY));

    const text = String(item?.text || '').trim() || 'Detected';
    const bgHex = parseHexColor(item?.bg_color)?.hex || '#000000';
    const textHex = parseHexColor(item?.text_color)?.hex || '#ffffff';
    const fontSizeRatio = clampNumber(item?.font_size_ratio ?? 0.5, 0, 1);
    const fontSize = Math.max(8, Math.round(fontSizeRatio * clampedH));
    const fontWeight = String(item?.font_weight || '').trim().toLowerCase() === 'bold' ? 'bold' : 'normal';
    const fontStyle = String(item?.font_style || '').trim().toLowerCase() === 'italic' ? 'italic' : 'normal';

    overlays.push({
      id: crypto.randomUUID(),
      x: clampedX,
      y: clampedY,
      width: clampedW,
      height: clampedH,
      text,
      backgroundColor: bgHex,
      textColor: textHex,
      fontSize,
      fontWeight,
      fontStyle,
      fontFamily: 'Arial',
      isGradient: false,
      gradient: null,
      confidence: 0.9,
      startTime: typeof startTime === 'number' ? startTime : null,
      endTime: typeof endTime === 'number' ? endTime : null
    });
  }

  return overlays;
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

    const detectionModeRaw = String(req.body?.detectionMode ?? req.body?.detection_mode ?? 'gemini').trim().toLowerCase();
    const detectionMode = detectionModeRaw === 'dino' ? 'dino' : 'gemini';
    const requestedScanModel = String(req.body?.scan_model ?? req.body?.scanModel ?? '').trim();
    const scanModel = resolveVideoOverlayScanModel({
      requestedModel: requestedScanModel || null,
      configuredModel: process.env.VIDEO_OVERLAY_SCAN_MODEL || ''
    });

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

    const frameKeys = await detectOverlayKeysWithGemini({ frames: scanFrames, modelName: scanModel });
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
        detection_mode: detectionMode,
        scan_model: scanModel,
        segments: [],
        warnings: []
      });
    }

    // For each segment, run either DINO+SAM detector (existing path) or Gemini Vision overlay detection.
    const segments = [];
    const warnings = [];
    const videoWidth = Math.max(1, Math.round(safeParseNumber(info?.width, 1080)));
    const videoHeight = Math.max(1, Math.round(safeParseNumber(info?.height, 1920)));

    if (detectionMode === 'dino') {
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

      // Existing DINO+SAM path: keep behavior unchanged.
      for (const seg of segmentsRaw) {
        const sampleTimes = buildSegmentSampleTimes(seg, durationSec);
        let overlays = [];
        let resolvedSampleTime = seg.sample_t;
        let hadDetectorResponse = false;
        let lastDetectorError = null;
        let bestSampleScore = Number.NEGATIVE_INFINITY;

        for (const sampleTime of sampleTimes) {
          try {
            const fullFrameB64 = await extractFrameBase64(videoPath, { t: sampleTime, width: null });
            const detections = await detectVideoOverlays({ imageBase64: fullFrameB64 });
            hadDetectorResponse = true;
            const candidateOverlays = Array.isArray(detections)
              ? detections.map((det) => toOverlayBox(det, {
                startTime: seg.start,
                endTime: seg.end,
                videoWidth,
                videoHeight
              }))
              : [];

            if (candidateOverlays.length) {
              const sampleScore = scoreSampleOverlaySet({
                segmentKey: seg.key || seg.label || '',
                overlays: candidateOverlays,
                sampleTime,
                preferredTime: seg.sample_t
              });

              if (!Number.isFinite(sampleScore)) continue;
              if (sampleScore > bestSampleScore) {
                bestSampleScore = sampleScore;
                overlays = candidateOverlays;
                resolvedSampleTime = sampleTime;
              }
            }
          } catch (sampleErr) {
            lastDetectorError = sampleErr;
          }
        }

        if (!overlays.length && !hadDetectorResponse && lastDetectorError) {
          const baseMsg = lastDetectorError?.message || String(lastDetectorError);
          throw new Error(
            `Detector failed for segment start=${seg.start}s end=${seg.end}s after ${sampleTimes.length} attempts: ${baseMsg}`
          );
        }

        if (!overlays.length) {
          overlays = [buildPlaceholderOverlay({ seg, videoWidth, videoHeight })];
          warnings.push(
            `No overlays detected for segment ${seg.start.toFixed(3)}-${seg.end.toFixed(3)}s. Inserted placeholder for manual edit.`
          );
        }

        segments.push({
          id: seg.id,
          label: seg.label,
          start: seg.start,
          end: seg.end,
          sample_time: resolvedSampleTime,
          overlays
        });
      }
    } else {
      const findNearestScanFrame = (targetT) => {
        if (!scanFrames.length) return null;

        const target = safeParseNumber(targetT, 0) || 0;
        let low = 0;
        let high = scanFrames.length - 1;

        const lowTime = safeParseNumber(scanFrames[low]?.t, 0);
        if (target <= lowTime) return scanFrames[low];

        const highTime = safeParseNumber(scanFrames[high]?.t, 0);
        if (target >= highTime) return scanFrames[high];

        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const midTime = safeParseNumber(scanFrames[mid]?.t, 0);

          if (midTime === target) return scanFrames[mid];
          if (midTime < target) low = mid + 1;
          else high = mid - 1;
        }

        const prevIndex = Math.max(0, high);
        const nextIndex = Math.min(scanFrames.length - 1, low);
        const prevFrame = scanFrames[prevIndex];
        const nextFrame = scanFrames[nextIndex];

        const prevDelta = Math.abs(target - safeParseNumber(prevFrame?.t, 0));
        const nextDelta = Math.abs(safeParseNumber(nextFrame?.t, 0) - target);

        return prevDelta <= nextDelta ? prevFrame : nextFrame;
      };

      for (const seg of segmentsRaw) {
        const sampleTimes = buildSegmentSampleTimes(seg, durationSec);
        const preferredTimes = [seg.sample_t, ...sampleTimes];
        let chosenFrame = null;
        for (const tCandidate of preferredTimes) {
          const nearest = findNearestScanFrame(tCandidate);
          if (nearest?.b64) {
            chosenFrame = nearest;
            break;
          }
        }

        if (!chosenFrame?.b64) {
          warnings.push(
            `Gemini Vision could not find a sample frame for segment ${seg.start.toFixed(3)}-${seg.end.toFixed(3)}s.`
          );
          segments.push({
            id: seg.id,
            label: seg.label,
            start: seg.start,
            end: seg.end,
            sample_time: seg.sample_t,
            overlays: []
          });
          continue;
        }

        let overlays = [];
        try {
          overlays = await detectSegmentOverlaysWithGeminiVision({
            frameBase64: chosenFrame.b64,
            videoWidth,
            videoHeight,
            modelName: scanModel,
            startTime: seg.start,
            endTime: seg.end
          });
        } catch (visionErr) {
          console.error('Gemini Vision overlay detection error:', visionErr);
          warnings.push(
            `Gemini Vision failed for segment ${seg.start.toFixed(3)}-${seg.end.toFixed(3)}s: ${visionErr?.message || 'unknown error'}`
          );
          overlays = [];
        }

        if (!overlays.length) {
          warnings.push(
            `Gemini Vision returned 0 overlays for segment ${seg.start.toFixed(3)}-${seg.end.toFixed(3)}s.`
          );
        }

        segments.push({
          id: seg.id,
          label: seg.label,
          start: seg.start,
          end: seg.end,
          sample_time: safeParseNumber(chosenFrame.t, seg.sample_t) ?? seg.sample_t,
          overlays
        });
      }
    }

    const placeholderCount = detectionMode === 'dino'
      ? warnings.filter((msg) => String(msg || '').includes('Inserted placeholder')).length
      : 0;

    res.json({
      success: true,
      scan_method: scanMethod,
      detection_mode: detectionMode,
      scan_model: scanModel,
      duration: durationSec,
      interval_sec: intervalSec,
      max_frames: maxFrames,
      frames_analyzed: scanFrames.length,
      segments,
      warnings,
      segments_with_placeholder: placeholderCount
    });
  } catch (error) {
    console.error('Video overlay scan error:', error);
    if (Number.isFinite(Number(error?.statusCode)) && Number(error.statusCode) !== 500) {
      return res.status(Number(error.statusCode)).json({ success: false, error: error.message });
    }
    const msg = error?.code === 'ENOENT'
      ? 'ffmpeg/ffprobe not found on server. Install ffmpeg.'
      : error.message;
    res.status(500).json({ success: false, error: msg });
  }
});

function escapeDrawtextPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

function buildOverlayFiltergraph({ durationSec, segments, fontPath, textFileResolver, videoWidth = 0, videoHeight = 0 } = {}) {
  const filters = [];
  let label = '[0:v]';
  let step = 0;
  const maxVideoWidth = Math.max(1, Math.round(safeParseNumber(videoWidth, 1)));
  const maxVideoHeight = Math.max(1, Math.round(safeParseNumber(videoHeight, 1)));

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
      const w = clampNumber(Math.round(safeParseNumber(ov?.width, 1)), 1, maxVideoWidth);
      const h = clampNumber(Math.round(safeParseNumber(ov?.height, 1)), 1, maxVideoHeight);
      const x = clampNumber(Math.round(safeParseNumber(ov?.x, 0)), 0, Math.max(0, maxVideoWidth - w));
      const y = clampNumber(Math.round(safeParseNumber(ov?.y, 0)), 0, Math.max(0, maxVideoHeight - h));

      const enable = `between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`;

      const bgHex = parseHexColor(ov?.backgroundColor)?.hex || '#333333';
      const textHex = parseHexColor(ov?.textColor)?.hex || '#ffffff';
      const fontsize = Math.max(8, Math.round(safeParseNumber(ov?.fontSize, 24)));
      const textFilePath = typeof textFileResolver === 'function' ? textFileResolver(ov?.text || '') : '';
      if (!textFilePath) continue;
      const textfile = escapeDrawtextPath(textFilePath);

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
      const draw = `drawtext=fontfile='${resolvedFontPath}':textfile='${textfile}':` +
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
    const textFiles = [];

    try {
      const writeOverlayTextFile = (text) => {
        const filePath = getOverlayTextFilePath(exportId, textFiles.length);
        fs.writeFileSync(filePath, String(text ?? ''), 'utf8');
        textFiles.push(filePath);
        return filePath;
      };

      // Build filtergraph (includes gradients when provided). No fallback mode.
      const fontPath = path.join(__dirname, '..', 'assets', 'fonts', 'Inter-Regular.ttf');
      const graph = buildOverlayFiltergraph({
        durationSec: info.duration,
        segments,
        fontPath,
        textFileResolver: writeOverlayTextFile,
        videoWidth: info.width,
        videoHeight: info.height
      });
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
    } finally {
      await Promise.all(textFiles.map((filePath) => fs.promises.unlink(filePath).catch(() => null)));
    }
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
    const filename = sanitizeDownloadFilename(req.query?.filename, 'edited_video.mp4');

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
// PHOTO MAGIC (RMBG2 + SAM2 + LaMa + optional SDXL HQ)
// ============================================================================

router.get('/photo-magic/health', async (req, res) => {
  try {
    const aiConfigured = isPhotoMagicAiConfigured();
    const aiHealth = aiConfigured
      ? await getPhotoMagicAiHealth().catch((e) => ({ ok: false, status: 0, payload: { error: e?.message || String(e) } }))
      : null;

    const hqConfigured = isPhotoMagicHqConfigured();
    const hqHealth = hqConfigured
      ? await getPhotoMagicHqHealth().catch((e) => ({ ok: false, status: 0, payload: { error: e?.message || String(e) } }))
      : null;

    res.json({
      success: true,
      photo_magic: {
        uploads: {
          max_upload_bytes: PHOTO_MAGIC_MAX_UPLOAD_BYTES,
          max_image_pixels: PHOTO_MAGIC_MAX_IMAGE_PIXELS
        },
        ai: {
          configured: aiConfigured,
          url: process.env.PHOTO_MAGIC_AI_URL || null,
          health: aiHealth,
          timeouts_ms: {
            default: Number(process.env.PHOTO_MAGIC_AI_TIMEOUT_MS || 240000),
            health: Number(process.env.PHOTO_MAGIC_AI_HEALTH_TIMEOUT_MS || 10000)
          }
        },
        hq: {
          configured: hqConfigured,
          url: process.env.PHOTO_MAGIC_HQ_AI_URL || null,
          health: hqHealth,
          timeouts_ms: {
            default: Number(process.env.PHOTO_MAGIC_HQ_TIMEOUT_MS || 600000),
            health: Number(process.env.PHOTO_MAGIC_HQ_HEALTH_TIMEOUT_MS || 10000)
          }
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/photo-magic/upload', photoMagicSingle('image'), async (req, res) => {
  try {
    const store = req.query.store || PHOTO_MAGIC_DEFAULT_STORE;
    await ensurePhotoMagicDirs(store);

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    const mime = String(req.file.mimetype || '').toLowerCase();
    if (mime && !mime.startsWith('image/')) {
      return res.status(415).json({ success: false, error: 'Unsupported file type (expected image/*)' });
    }

    let meta = null;
    try {
      meta = await sharp(req.file.buffer).metadata();
    } catch {
      meta = null;
    }

    const width = Number(meta?.width || 0);
    const height = Number(meta?.height || 0);
    if (!width || !height) {
      return res.status(400).json({ success: false, error: 'Invalid image (could not read metadata)' });
    }

    const pixels = width * height;
    if (Number.isFinite(pixels) && pixels > PHOTO_MAGIC_MAX_IMAGE_PIXELS) {
      return res.status(413).json({
        success: false,
        error: `Image too large (${width}x${height}). Max pixels is ${PHOTO_MAGIC_MAX_IMAGE_PIXELS}.`
      });
    }

    const imageId = crypto.randomUUID();
    const imagePath = getUploadedPhotoPath(store, imageId);
    await fs.promises.writeFile(imagePath, req.file.buffer);

    return res.json({
      success: true,
      image_id: imageId,
      filename: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
      width,
      height
    });
  } catch (error) {
    console.error('Photo magic upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/photo-magic/remove-bg', async (req, res) => {
  try {
    const store = req.query.store || PHOTO_MAGIC_DEFAULT_STORE;
    await ensurePhotoMagicDirs(store);

    if (!isPhotoMagicAiConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'PHOTO_MAGIC_AI_URL is not configured. Deploy the Photo Magic AI service and set PHOTO_MAGIC_AI_URL.'
      });
    }

    const imageId = String(req.body?.image_id || '').trim();
    const engine = String(req.body?.engine || 'rmbg2').trim();
    const maxSide = clampNumber(req.body?.max_side ?? req.body?.maxSide ?? 2048, 256, 8192);

    if (!imageId || !isSafeTmpId(imageId)) {
      return res.status(400).json({ success: false, error: 'image_id is required' });
    }
    if (engine !== 'rmbg2') {
      return res.status(400).json({ success: false, error: 'Unsupported engine (expected rmbg2)' });
    }

    const imagePath = getUploadedPhotoPath(store, imageId);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ success: false, error: 'Upload not found (upload again)' });
    }

    const buf = await fs.promises.readFile(imagePath);
    const imageBase64 = buf.toString('base64');

    const result = await removeBgRmbg2({ imageBase64, maxSide });

    const cutoutId = crypto.randomUUID();
    const maskId = crypto.randomUUID();

    const cutoutPath = getPhotoMagicOutputPath(store, cutoutId, 'png');
    const maskPath = getPhotoMagicOutputPath(store, maskId, 'png');

    await fs.promises.writeFile(cutoutPath, Buffer.from(String(result?.cutout_png || ''), 'base64'));
    await fs.promises.writeFile(maskPath, Buffer.from(String(result?.mask_png || ''), 'base64'));

    return res.json({
      success: true,
      width: result?.width ?? null,
      height: result?.height ?? null,
      cutout: {
        output_id: cutoutId,
        url: withStoreParam(
          `/api/creative-studio/photo-magic/download?output_id=${encodeURIComponent(cutoutId)}&filename=${encodeURIComponent('cutout.png')}`,
          store
        )
      },
      mask: {
        output_id: maskId,
        url: withStoreParam(
          `/api/creative-studio/photo-magic/download?output_id=${encodeURIComponent(maskId)}&filename=${encodeURIComponent('mask.png')}`,
          store
        )
      }
    });
  } catch (error) {
    console.error('Photo magic remove-bg error:', error?.payload || error);
    const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 500;
    res.status(status).json({ success: false, error: error.message, details: error?.payload || null });
  }
});

router.post('/photo-magic/remove-bg/refine', async (req, res) => {
  try {
    const store = req.query.store || PHOTO_MAGIC_DEFAULT_STORE;
    await ensurePhotoMagicDirs(store);

    if (!isPhotoMagicAiConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'PHOTO_MAGIC_AI_URL is not configured. Deploy the Photo Magic AI service and set PHOTO_MAGIC_AI_URL.'
      });
    }

    const imageId = String(req.body?.image_id || '').trim();
    const points = Array.isArray(req.body?.points) ? req.body.points : [];
    const boxXyxy = Array.isArray(req.body?.box_xyxy) ? req.body.box_xyxy : null;
    const maxSide = clampNumber(req.body?.max_side ?? req.body?.maxSide ?? 2048, 256, 8192);
    const maskDilatePx = clampNumber(req.body?.mask_dilate_px ?? req.body?.maskDilatePx ?? 0, 0, 64);
    const maskFeatherPx = clampNumber(req.body?.mask_feather_px ?? req.body?.maskFeatherPx ?? 0, 0, 64);

    if (!imageId || !isSafeTmpId(imageId)) {
      return res.status(400).json({ success: false, error: 'image_id is required' });
    }
    if (!points.length) {
      return res.status(400).json({ success: false, error: 'points is required (at least 1 point)' });
    }

    const imagePath = getUploadedPhotoPath(store, imageId);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ success: false, error: 'Upload not found (upload again)' });
    }

    const buf = await fs.promises.readFile(imagePath);
    const imageBase64 = buf.toString('base64');

    const result = await refineBgSam2({
      imageBase64,
      points,
      boxXyxy,
      maxSide,
      maskDilatePx,
      maskFeatherPx
    });

    const cutoutId = crypto.randomUUID();
    const maskId = crypto.randomUUID();

    const cutoutPath = getPhotoMagicOutputPath(store, cutoutId, 'png');
    const maskPath = getPhotoMagicOutputPath(store, maskId, 'png');

    await fs.promises.writeFile(cutoutPath, Buffer.from(String(result?.cutout_png || ''), 'base64'));
    await fs.promises.writeFile(maskPath, Buffer.from(String(result?.mask_png || ''), 'base64'));

    return res.json({
      success: true,
      width: result?.width ?? null,
      height: result?.height ?? null,
      cutout: {
        output_id: cutoutId,
        url: withStoreParam(
          `/api/creative-studio/photo-magic/download?output_id=${encodeURIComponent(cutoutId)}&filename=${encodeURIComponent('cutout.png')}`,
          store
        )
      },
      mask: {
        output_id: maskId,
        url: withStoreParam(
          `/api/creative-studio/photo-magic/download?output_id=${encodeURIComponent(maskId)}&filename=${encodeURIComponent('mask.png')}`,
          store
        )
      }
    });
  } catch (error) {
    console.error('Photo magic refine error:', error?.payload || error);
    const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 500;
    res.status(status).json({ success: false, error: error.message, details: error?.payload || null });
  }
});

router.post('/photo-magic/erase', photoMagicSingle('mask'), async (req, res) => {
  try {
    const store = req.query.store || PHOTO_MAGIC_DEFAULT_STORE;
    await ensurePhotoMagicDirs(store);

    const imageId = String(req.body?.image_id || '').trim();
    const maskBase64 = req.file?.buffer?.length
      ? req.file.buffer.toString('base64')
      : (req.body?.mask_png_base64 || req.body?.mask_png || req.body?.mask || '');
    const quality = String(req.body?.quality || 'standard').trim().toLowerCase();

    if (!imageId || !isSafeTmpId(imageId)) {
      return res.status(400).json({ success: false, error: 'image_id is required' });
    }
    if (req.file) {
      const maskMime = String(req.file.mimetype || '').toLowerCase();
      if (maskMime && !maskMime.startsWith('image/')) {
        return res.status(415).json({ success: false, error: 'Unsupported mask file type (expected image/*)' });
      }
    }
    if (!maskBase64) {
      return res.status(400).json({ success: false, error: 'mask is required' });
    }

    const imagePath = getUploadedPhotoPath(store, imageId);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ success: false, error: 'Upload not found (upload again)' });
    }

    const buf = await fs.promises.readFile(imagePath);
    const imageBase64 = buf.toString('base64');

    const maxSide = clampNumber(req.body?.max_side ?? req.body?.maxSide ?? 2048, 256, 8192);
    const maskDilatePx = clampNumber(req.body?.mask_dilate_px ?? req.body?.maskDilatePx ?? 8, 0, 64);
    const maskFeatherPx = clampNumber(req.body?.mask_feather_px ?? req.body?.maskFeatherPx ?? 8, 0, 64);
    const cropToMask = parseBool(req.body?.crop_to_mask ?? req.body?.cropToMask, true);
    const cropMarginPx = clampNumber(req.body?.crop_margin_px ?? req.body?.cropMarginPx ?? 128, 0, 2048);

    let result;
    if (quality === 'hq') {
      if (!isPhotoMagicHqConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'PHOTO_MAGIC_HQ_AI_URL is not configured. Deploy the HQ service and set PHOTO_MAGIC_HQ_AI_URL.'
        });
      }

      const health = await getPhotoMagicHqHealth().catch(() => null);
      if (!health?.ok) {
        return res.status(503).json({
          success: false,
          error: 'Photo Magic HQ service is not ready (check /photo-magic/health)',
          details: health
        });
      }

      const steps = clampNumber(req.body?.num_inference_steps ?? req.body?.numInferenceSteps ?? 20, 5, 80);
      const guidance = clampNumber(req.body?.guidance_scale ?? req.body?.guidanceScale ?? 8.0, 0.0, 20.0);
      const strength = clampNumber(req.body?.strength ?? 0.99, 0.0, 1.0);
      const seed = clampNumber(req.body?.seed ?? 0, 0, Number.MAX_SAFE_INTEGER);

      result = await eraseSdxl({
        imageBase64,
        maskBase64,
        numInferenceSteps: steps,
        guidanceScale: guidance,
        strength,
        seed,
        maskDilatePx,
        maskFeatherPx,
        cropToMask,
        cropMarginPx
      });
    } else {
      if (!isPhotoMagicAiConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'PHOTO_MAGIC_AI_URL is not configured. Deploy the Photo Magic AI service and set PHOTO_MAGIC_AI_URL.'
        });
      }

      result = await eraseLama({
        imageBase64,
        maskBase64,
        maxSide,
        maskDilatePx,
        maskFeatherPx,
        cropToMask,
        cropMarginPx
      });
    }

    const outId = crypto.randomUUID();
    const outPath = getPhotoMagicOutputPath(store, outId, 'png');
    await fs.promises.writeFile(outPath, Buffer.from(String(result?.result_png || ''), 'base64'));

    return res.json({
      success: true,
      width: result?.width ?? null,
      height: result?.height ?? null,
      output_id: outId,
      url: withStoreParam(
        `/api/creative-studio/photo-magic/download?output_id=${encodeURIComponent(outId)}&filename=${encodeURIComponent('result.png')}`,
        store
      )
    });
  } catch (error) {
    console.error('Photo magic erase error:', error?.payload || error);
    const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 500;
    res.status(status).json({ success: false, error: error.message, details: error?.payload || null });
  }
});

router.post('/photo-magic/enhance', async (req, res) => {
  try {
    const store = req.query.store || PHOTO_MAGIC_DEFAULT_STORE;
    await ensurePhotoMagicDirs(store);

    if (!isPhotoMagicAiConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'PHOTO_MAGIC_AI_URL is not configured. Deploy the Photo Magic AI service and set PHOTO_MAGIC_AI_URL.'
      });
    }

    const imageId = String(req.body?.image_id || '').trim();
    const mode = String(req.body?.mode || 'upscale').trim().toLowerCase();
    const supportedModes = new Set(['upscale', 'denoise', 'deblur', 'sharpen', 'low_light']);
    if (!imageId || !isSafeTmpId(imageId)) {
      return res.status(400).json({ success: false, error: 'image_id is required' });
    }
    if (!supportedModes.has(mode)) {
      return res.status(400).json({ success: false, error: `Unsupported mode: ${mode}` });
    }

    const imagePath = getUploadedPhotoPath(store, imageId);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ success: false, error: 'Upload not found (upload again)' });
    }

    const sourceMaxSide = clampNumber(req.body?.source_max_side ?? req.body?.sourceMaxSide ?? 2048, 256, 8192);
    const strength = clampNumber(req.body?.strength ?? 0.5, 0.0, 1.0);
    const upscaleFactor = clampNumber(req.body?.upscale_factor ?? req.body?.upscaleFactor ?? 2, 1, 4);

    const buf = await fs.promises.readFile(imagePath);
    const imageBase64 = buf.toString('base64');

    const result = await enhancePhoto({
      imageBase64,
      mode,
      sourceMaxSide,
      strength,
      upscaleFactor
    });

    const outId = crypto.randomUUID();
    const outPath = getPhotoMagicOutputPath(store, outId, 'png');
    await fs.promises.writeFile(outPath, Buffer.from(String(result?.result_png || ''), 'base64'));

    return res.json({
      success: true,
      mode: result?.mode ?? mode,
      engine: result?.engine ?? null,
      source_width: result?.source_width ?? null,
      source_height: result?.source_height ?? null,
      width: result?.width ?? null,
      height: result?.height ?? null,
      output_id: outId,
      url: withStoreParam(
        `/api/creative-studio/photo-magic/download?output_id=${encodeURIComponent(outId)}&filename=${encodeURIComponent(`enhance-${mode}.png`)}`,
        store
      )
    });
  } catch (error) {
    console.error('Photo magic enhance error:', error?.payload || error);
    const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 500;
    res.status(status).json({ success: false, error: error.message, details: error?.payload || null });
  }
});

router.get('/photo-magic/download', async (req, res) => {
  try {
    const store = req.query.store || PHOTO_MAGIC_DEFAULT_STORE;
    const outputId = String(req.query?.output_id || '').trim();
    const filename = sanitizeDownloadFilename(req.query?.filename, 'result.png');

    if (!outputId) {
      return res.status(400).json({ success: false, error: 'output_id is required' });
    }
    if (!isSafeTmpId(outputId)) {
      return res.status(400).json({ success: false, error: 'Invalid output_id' });
    }

    const outPath = getPhotoMagicOutputPath(store, outputId, 'png');
    if (!fs.existsSync(outPath)) {
      return res.status(404).json({ success: false, error: 'Output not found (run again)' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    fs.createReadStream(outPath).pipe(res);
  } catch (error) {
    console.error('Photo magic download error:', error);
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
// CREATIVE OS API (world-class production workflow)
// ============================================================================

router.get('/creative-os/catalog', async (req, res) => {
  try {
    const store = sanitizeCreativeOsText(req.query.store, 64, CREATIVE_OS_DEFAULT_STORE).toLowerCase();
    const requestedLimit = clampNumber(req.query.limit ?? 120, 20, 400);

    const orderRows = db.prepare(`
      SELECT
        COALESCE(NULLIF(oi.product_id, ''), LOWER(TRIM(oi.title))) AS product_key,
        NULLIF(oi.product_id, '') AS product_id,
        MAX(NULLIF(oi.title, '')) AS title,
        MAX(NULLIF(oi.image_url, '')) AS image_url,
        AVG(NULLIF(oi.net_price, 0)) AS avg_price,
        SUM(COALESCE(oi.quantity, 0)) AS units_sold,
        MAX(oi.created_at) AS last_seen,
        MAX(so.currency) AS currency
      FROM shopify_order_items oi
      LEFT JOIN shopify_orders so
        ON so.store = oi.store AND so.order_id = oi.order_id
      WHERE oi.store = ?
        AND COALESCE(oi.is_excluded, 0) = 0
      GROUP BY COALESCE(NULLIF(oi.product_id, ''), LOWER(TRIM(oi.title)))
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(store, requestedLimit * 3);

    const cachedRows = db.prepare(`
      SELECT
        product_id,
        title,
        image_url,
        updated_at
      FROM shopify_products_cache
      WHERE store = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(store, requestedLimit * 3);

    let profileRow = null;
    try {
      profileRow = db.prepare(`
        SELECT summary_json
        FROM store_profiles
        WHERE store = ?
        LIMIT 1
      `).get(store);
    } catch (error) {
      console.warn('[creative-os/catalog] store_profiles lookup skipped:', error.message);
    }

    const profileProducts = [];
    try {
      const parsedSummary = JSON.parse(profileRow?.summary_json || '{}');
      const keyProducts = Array.isArray(parsedSummary?.keyProducts) ? parsedSummary.keyProducts : [];
      keyProducts.forEach((entry, index) => {
        const title = sanitizeCreativeOsText(entry?.name || entry?.title, CREATIVE_OS_MAX_PRODUCT_NAME_LENGTH);
        if (!title) return;
        profileProducts.push({
          key: `profile-${toCreativeOsSlug(title)}-${index}`,
          productId: null,
          title,
          imageUrl: null,
          avgPrice: null,
          unitsSold: 0,
          lastSeen: null,
          currency: CREATIVE_OS_DEFAULT_CURRENCY,
          source: 'store_profile'
        });
      });
    } catch (error) {
      console.warn('[creative-os/catalog] Failed to parse store profile summary:', error.message);
    }

    const productMap = new Map();

    const upsertProduct = (candidate) => {
      const key = String(candidate?.key || '').trim();
      if (!key) return;

      const current = productMap.get(key);
      const next = buildCreativeOsProductRecord({
        key,
        productId: candidate?.productId || null,
        title: candidate?.title || current?.name || 'Product',
        imageUrl: candidate?.imageUrl || current?.image_url || null,
        avgPrice: candidate?.avgPrice ?? current?.price ?? null,
        unitsSold: candidate?.unitsSold ?? current?.units_sold ?? 0,
        lastSeen: candidate?.lastSeen || current?.last_seen || null,
        currency: candidate?.currency || current?.currency || CREATIVE_OS_DEFAULT_CURRENCY
      });

      if (current) {
        next.variants = Math.max(current.variants || 3, next.variants || 3);
        next.angles = Math.max(current.angles || 4, next.angles || 4);
        next.source = current.source === 'catalog' || candidate?.source === 'catalog' ? 'catalog' : (candidate?.source || current.source);
      } else {
        next.source = candidate?.source || 'catalog';
      }

      productMap.set(key, next);
    };

    orderRows.forEach((row) => {
      upsertProduct({
        key: row.product_key || row.product_id || row.title,
        productId: row.product_id,
        title: row.title,
        imageUrl: row.image_url,
        avgPrice: row.avg_price,
        unitsSold: row.units_sold,
        lastSeen: row.last_seen,
        currency: row.currency,
        source: 'catalog'
      });
    });

    cachedRows.forEach((row) => {
      const fallbackKey = row.product_id || row.title;
      if (!fallbackKey) return;
      upsertProduct({
        key: fallbackKey,
        productId: row.product_id,
        title: row.title,
        imageUrl: row.image_url,
        avgPrice: null,
        unitsSold: 0,
        lastSeen: row.updated_at,
        currency: CREATIVE_OS_DEFAULT_CURRENCY,
        source: 'catalog'
      });
    });

    profileProducts.forEach(upsertProduct);

    const products = Array.from(productMap.values())
      .sort((a, b) => {
        const soldDelta = Number(b.units_sold || 0) - Number(a.units_sold || 0);
        if (soldDelta !== 0) return soldDelta;
        const bLastSeen = b.last_seen ? new Date(b.last_seen).getTime() : 0;
        const aLastSeen = a.last_seen ? new Date(a.last_seen).getTime() : 0;
        return bLastSeen - aLastSeen;
      })
      .slice(0, requestedLimit);

    const hasShopifyData = Boolean(
      db.prepare('SELECT 1 FROM shopify_order_items WHERE store = ? LIMIT 1').get(store)
      || db.prepare('SELECT 1 FROM shopify_products_cache WHERE store = ? LIMIT 1').get(store)
    );
    const hasSallaData = Boolean(db.prepare('SELECT 1 FROM salla_orders WHERE store = ? LIMIT 1').get(store));
    const wooConfigured = parseBool(process.env.WOOCOMMERCE_ENABLED || process.env.WOO_ENABLED, false);

    res.json({
      success: true,
      products,
      integrations: {
        shopify: hasShopifyData,
        salla: hasSallaData,
        woocommerce: wooConfigured
      },
      source_stats: {
        order_rows: orderRows.length,
        cache_rows: cachedRows.length,
        profile_rows: profileProducts.length
      }
    });
  } catch (error) {
    console.error('[creative-os/catalog] error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/product/import-url', async (req, res) => {
  try {
    const store = sanitizeCreativeOsText(req.body?.store || req.query?.store, 64, CREATIVE_OS_DEFAULT_STORE).toLowerCase();
    const rawUrl = req.body?.url || req.body?.product_url || req.query?.url;
    const validatedUrl = await validateCreativeOsImportUrl(rawUrl);

    const response = await axios.get(validatedUrl, {
      timeout: CREATIVE_OS_IMPORT_TIMEOUT_MS,
      maxRedirects: CREATIVE_OS_IMPORT_MAX_REDIRECTS,
      maxBodyLength: CREATIVE_OS_IMPORT_MAX_HTML_BYTES,
      maxContentLength: CREATIVE_OS_IMPORT_MAX_HTML_BYTES,
      responseType: 'text',
      headers: {
        'User-Agent': 'VironaCreativeOS/1.0 (+https://virona.app)'
      }
    });

    const finalUrlRaw = response?.request?.res?.responseUrl || validatedUrl;
    const finalParsed = new URL(finalUrlRaw);
    await assertCreativeOsPublicHost(finalParsed.hostname);

    const html = String(response.data || '').slice(0, CREATIVE_OS_IMPORT_MAX_HTML_BYTES);
    const jsonLdProduct = readProductFromJsonLd(html);

    const title = sanitizeCreativeOsText(
      jsonLdProduct?.title
      || extractMetaValue(html, ['og:title', 'twitter:title'])
      || extractHtmlTitle(html),
      CREATIVE_OS_MAX_PRODUCT_NAME_LENGTH,
      sanitizeCreativeOsText(finalParsed.hostname.replace(/^www\./i, '').split('.')[0], CREATIVE_OS_MAX_PRODUCT_NAME_LENGTH, 'Imported Product')
    );

    const description = sanitizeCreativeOsText(
      jsonLdProduct?.description
      || extractMetaValue(html, ['description', 'og:description', 'twitter:description'])
      || 'Imported from product URL',
      CREATIVE_OS_MAX_DESCRIPTION_LENGTH,
      'Imported from product URL'
    );

    const imageUrl = sanitizeCreativeOsText(
      jsonLdProduct?.image_url
      || extractMetaValue(html, ['og:image', 'twitter:image']),
      1024,
      ''
    ) || null;

    const price = extractPriceFromHtml(html, jsonLdProduct);
    const currency = extractCurrencyFromHtml(html, jsonLdProduct);

    const product = {
      id: `imported-${toCreativeOsSlug(title, 'product')}`,
      name: title,
      price,
      currency,
      collection: 'new_arrivals',
      angles: 6,
      variants: 4,
      blurb: description,
      image_url: imageUrl,
      source: 'url_import',
      source_url: finalParsed.toString(),
      store
    };

    res.json({
      success: true,
      product,
      extracted: {
        title,
        description,
        image_url: imageUrl,
        price,
        currency
      }
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode || error?.status || 500);
    console.error('[creative-os/product/import-url] error:', error.message);
    res.status(statusCode).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/style/extract', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Image file is required.' });
    }

    const mime = String(req.file.mimetype || '').toLowerCase();
    if (mime && !mime.startsWith('image/')) {
      return res.status(415).json({ success: false, error: 'Unsupported file type (expected image/*).' });
    }

    const { data, info } = await sharp(req.file.buffer)
      .rotate()
      .removeAlpha()
      .resize(144, 144, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const palette = buildCreativeOsPaletteFromRawImage(data, info?.channels || 3);
    const primary = palette[0]?.hex || '#0f766e';
    const accent = palette[1]?.hex || '#d97706';
    const textColor = bestTextColorForBackground(primary);

    res.json({
      success: true,
      palette,
      recommendations: {
        primary,
        accent,
        textColor,
        contrast: Number(contrastRatio(primary, textColor).toFixed(2))
      }
    });
  } catch (error) {
    console.error('[creative-os/style/extract] error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/creative-os/brand-kit/bootstrap', async (req, res) => {
  try {
    const store = sanitizeCreativeOsText(req.query.store, 64, CREATIVE_OS_DEFAULT_STORE).toLowerCase();
    const storeUrl = sanitizeCreativeOsText(req.query.store_url || req.query.storeUrl, 1024, '') || null;
    const forceRefresh = parseBool(req.query.refresh, false);

    const profile = await getOrCreateStoreProfile(store, { storeUrl, forceRefresh });
    const logoUrl = sanitizeCreativeOsText(profile?.logoUrl, 1024, '') || null;

    let primaryColor = '#0f766e';
    let accentColor = '#d97706';
    let textColor = '#ffffff';
    let palette = [];

    if (logoUrl) {
      try {
        const parsedLogo = new URL(logoUrl);
        if (!CREATIVE_OS_IMPORT_ALLOWED_PROTOCOLS.has(parsedLogo.protocol)) {
          throw new Error('Unsupported logo URL protocol.');
        }
        await assertCreativeOsPublicHost(parsedLogo.hostname);

        const logoResponse = await axios.get(parsedLogo.toString(), {
          responseType: 'arraybuffer',
          timeout: CREATIVE_OS_IMPORT_TIMEOUT_MS,
          maxBodyLength: 2 * 1024 * 1024,
          maxContentLength: 2 * 1024 * 1024
        });
        const logoBuffer = Buffer.from(logoResponse.data || []);
        if (logoBuffer.length > 0) {
          const { data, info } = await sharp(logoBuffer)
            .rotate()
            .removeAlpha()
            .resize(144, 144, { fit: 'inside' })
            .raw()
            .toBuffer({ resolveWithObject: true });
          palette = buildCreativeOsPaletteFromRawImage(data, info?.channels || 3);
          primaryColor = palette[0]?.hex || primaryColor;
          accentColor = palette[1]?.hex || accentColor;
          textColor = bestTextColorForBackground(primaryColor);
        }
      } catch (error) {
        console.warn('[creative-os/brand-kit/bootstrap] logo color extraction warning:', error?.message || error);
      }
    }

    return res.json({
      success: true,
      brand_kit: {
        logo_url: logoUrl,
        primary_color: primaryColor,
        accent_color: accentColor,
        text_color: textColor,
        font: 'sora',
        enforce_across_assets: true,
        palette
      },
      profile: {
        store,
        store_url: profile?.storeUrl || storeUrl || null,
        summary: profile?.summary || null
      }
    });
  } catch (error) {
    console.error('[creative-os/brand-kit/bootstrap] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/creative-os/models/health', async (req, res) => {
  try {
    const photoMagicConfigured = isPhotoMagicAiConfigured();
    const photoMagicHealth = photoMagicConfigured
      ? await getPhotoMagicAiHealth().catch((error) => ({
        ok: false,
        status: 0,
        payload: { error: error?.message || 'photo_magic_health_failed' }
      }))
      : null;

    const photoMagicHqConfigured = isPhotoMagicHqConfigured();
    const photoMagicHqHealth = photoMagicHqConfigured
      ? await getPhotoMagicHqHealth().catch((error) => ({
        ok: false,
        status: 0,
        payload: { error: error?.message || 'photo_magic_hq_health_failed' }
      }))
      : null;

    const models = photoMagicHealth?.payload?.models || {};

    return res.json({
      success: true,
      models: {
        photo_magic_ai: {
          configured: photoMagicConfigured,
          healthy: Boolean(photoMagicHealth?.ok),
          models
        },
        photo_magic_hq: {
          configured: photoMagicHqConfigured,
          healthy: Boolean(photoMagicHqHealth?.ok),
          status: photoMagicHqHealth?.status || null
        }
      },
      capabilities: {
        background_removal_rmbg2: Boolean(models.rmbg2),
        scene_refine_sam2: Boolean(models.sam2),
        inpaint_lama: Boolean(models.lama),
        upscale_realesrgan: Boolean(models.realesrgan),
        hq_inpaint_sdxl: Boolean(photoMagicHqHealth?.ok)
      }
    });
  } catch (error) {
    console.error('[creative-os/models/health] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/video/upload', creativeOsVideoSingle, async (req, res) => {
  try {
    await ensureCreativeOsVideoDirs();

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Video file is required.' });
    }

    const mime = String(req.file.mimetype || '').toLowerCase();
    if (mime && !mime.startsWith('video/')) {
      return res.status(415).json({ success: false, error: 'Unsupported file type (expected video/*).' });
    }

    const mediaId = crypto.randomUUID();
    const ext = parseCreativeOsVideoExtension(req.file.mimetype, req.file.originalname, 'mp4');
    const outputPath = getCreativeOsVideoUploadPath(mediaId, ext);
    await fs.promises.writeFile(outputPath, req.file.buffer);

    let mediaInfo = { duration: null, width: null, height: null };
    try {
      mediaInfo = await ffprobeVideoInfo(outputPath);
    } catch (error) {
      console.warn('[creative-os/video/upload] ffprobe warning:', error?.message || error);
    }

    return res.json({
      success: true,
      video: {
        video_id: mediaId,
        ext,
        filename: sanitizeCreativeOsMediaFilename(req.file.originalname, `video.${ext}`),
        size: req.file.size,
        mime: req.file.mimetype,
        ...mediaInfo
      }
    });
  } catch (error) {
    console.error('[creative-os/video/upload] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/video/audio/upload', creativeOsAudioSingle, async (req, res) => {
  try {
    await ensureCreativeOsVideoDirs();

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Audio file is required.' });
    }

    const mime = String(req.file.mimetype || '').toLowerCase();
    if (mime && !mime.startsWith('audio/')) {
      return res.status(415).json({ success: false, error: 'Unsupported file type (expected audio/*).' });
    }

    const audioId = crypto.randomUUID();
    const ext = parseCreativeOsAudioExtension(req.file.mimetype, req.file.originalname, 'mp3');
    const outputPath = getCreativeOsAudioUploadPath(audioId, ext);
    await fs.promises.writeFile(outputPath, req.file.buffer);

    let duration = null;
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        outputPath
      ]);
      const parsedDuration = safeParseNumber(String(stdout || '').trim(), null);
      if (parsedDuration !== null) {
        duration = Number(parsedDuration.toFixed(3));
      }
    } catch (error) {
      console.warn('[creative-os/video/audio/upload] ffprobe warning:', error?.message || error);
    }

    return res.json({
      success: true,
      audio: {
        audio_id: audioId,
        ext,
        filename: sanitizeCreativeOsMediaFilename(req.file.originalname, `audio.${ext}`),
        size: req.file.size,
        mime: req.file.mimetype,
        duration
      }
    });
  } catch (error) {
    console.error('[creative-os/video/audio/upload] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/creative-os/video/music/library', async (req, res) => {
  try {
    const store = sanitizeCreativeOsText(req.query.store, 64, CREATIVE_OS_DEFAULT_STORE).toLowerCase();
    const warmupBeforeRead = getCreativeOsMusicLibraryWarmupStatus();
    if (warmupBeforeRead.status === 'idle' || warmupBeforeRead.status === 'error') {
      void queueCreativeOsMusicLibraryWarmup({ force: warmupBeforeRead.status === 'error' });
    }

    const tracks = [];
    for (const track of CREATIVE_OS_MUSIC_LIBRARY_TRACKS) {
      const audioId = `lib_${track.id}`;
      const audioPath = getCreativeOsAudioUploadPath(audioId, 'mp3');
      if (!fs.existsSync(audioPath)) continue;

      let duration = CREATIVE_OS_MUSIC_TRACK_DURATION_SECONDS;
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          audioPath
        ]);
        const parsedDuration = safeParseNumber(String(stdout || '').trim(), null);
        if (parsedDuration !== null) {
          duration = Number(parsedDuration.toFixed(3));
        }
      } catch (error) {
        console.warn('[creative-os/video/music/library] ffprobe warning:', error?.message || error);
      }

      const filename = sanitizeCreativeOsMediaFilename(`${track.id}.mp3`, 'track.mp3');
      tracks.push({
        id: track.id,
        title: track.title,
        mood: track.mood,
        bpm: track.bpm,
        duration,
        license: track.license,
        audio_id: audioId,
        audio_ext: 'mp3',
        preview_url: withStoreParam(
          `/api/creative-studio/creative-os/video/audio/download?audio_id=${encodeURIComponent(audioId)}&ext=mp3&filename=${encodeURIComponent(filename)}&inline=1`,
          store
        ),
        download_url: withStoreParam(
          `/api/creative-studio/creative-os/video/audio/download?audio_id=${encodeURIComponent(audioId)}&ext=mp3&filename=${encodeURIComponent(filename)}`,
          store
        )
      });
    }

    const warmup = getCreativeOsMusicLibraryWarmupStatus();
    if (!tracks.length && warmup.status === 'error') {
      return res.status(503).json({
        success: false,
        error: warmup.error || 'Music library warmup failed.',
        generated: false,
        initializing: false,
        warmup,
        tracks: []
      });
    }

    return res.json({
      success: true,
      generated: tracks.length === CREATIVE_OS_MUSIC_LIBRARY_TRACKS.length,
      initializing: warmup.status === 'warming',
      warmup,
      tracks
    });
  } catch (error) {
    console.error('[creative-os/video/music/library] error:', error);
    const message = error?.code === 'ENOENT'
      ? 'ffmpeg/ffprobe not found on server. Install ffmpeg to build music library.'
      : error.message;
    return res.status(500).json({ success: false, error: message });
  }
});

router.get('/creative-os/video/audio/download', async (req, res) => {
  try {
    const audioId = String(req.query.audio_id || req.query.audioId || '').trim();
    if (!audioId || !isCreativeOsMediaId(audioId)) {
      return res.status(400).json({ success: false, error: 'Invalid audio_id.' });
    }

    const ext = parseCreativeOsAudioExtension(req.query.ext || req.query.audio_ext || req.query.audioExt, '', 'mp3');
    const filename = sanitizeCreativeOsMediaFilename(req.query.filename, `${audioId}.${ext}`);
    const renderInline = parseBool(req.query.inline, false);
    const audioPath = getCreativeOsAudioUploadPath(audioId, ext);
    if (!fs.existsSync(audioPath)) {
      return res.status(404).json({ success: false, error: 'Audio track not found.' });
    }

    res.setHeader('Content-Type', resolveCreativeOsAudioMime(ext));
    res.setHeader('Content-Disposition', `${renderInline ? 'inline' : 'attachment'}; filename="${filename}"`);
    fs.createReadStream(audioPath).pipe(res);
  } catch (error) {
    console.error('[creative-os/video/audio/download] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/video/tts', async (req, res) => {
  try {
    await ensureCreativeOsVideoDirs();

    const text = sanitizeCreativeOsText(req.body?.text, CREATIVE_OS_TIMELINE_MAX_TTS_CHARS, '');
    if (!text) {
      return res.status(400).json({ success: false, error: 'text is required.' });
    }

    const language = parseCreativeOsTtsLanguage(req.body?.language || req.body?.lang || 'en');
    const textChunks = splitCreativeOsTtsChunks(text, CREATIVE_OS_TTS_PROVIDER_MAX_CHARS);
    const audioBuffer = await synthesizeCreativeOsTtsChunks({ language, textChunks });
    if (!audioBuffer.length) {
      return res.status(502).json({ success: false, error: 'TTS provider returned empty audio.' });
    }

    const audioId = crypto.randomUUID();
    const outputPath = getCreativeOsAudioUploadPath(audioId, 'mp3');
    await fs.promises.writeFile(outputPath, audioBuffer);

    return res.json({
      success: true,
      audio: {
        audio_id: audioId,
        ext: 'mp3',
        filename: `tts-${language}.mp3`,
        language,
        source: textChunks.length > 1 ? 'google-tts-fallback-chunked' : 'google-tts-fallback',
        chunk_count: textChunks.length
      }
    });
  } catch (error) {
    const upstreamStatus = Number.isInteger(error?.response?.status) ? error.response.status : null;
    console.error('[creative-os/video/tts] error:', upstreamStatus || error?.message || error);
    return res.status(upstreamStatus || 500).json({
      success: false,
      error: upstreamStatus === 400
        ? `TTS provider rejected the script. Try shorter phrases (${CREATIVE_OS_TTS_PROVIDER_MAX_CHARS} chars max per chunk).`
        : 'TTS generation failed. Try a shorter script or upload your own voiceover.'
    });
  }
});

router.post('/creative-os/video/render', async (req, res) => {
  try {
    await ensureCreativeOsVideoDirs();

    const videoId = sanitizeCreativeOsText(req.body?.video_id || req.body?.videoId, 120, '');
    if (!videoId || !isCreativeOsMediaId(videoId)) {
      return res.status(400).json({ success: false, error: 'Valid video_id is required.' });
    }

    const videoExt = parseCreativeOsVideoExtension(req.body?.video_ext || req.body?.videoExt, '', 'mp4');

    const videoPath = getCreativeOsVideoUploadPath(videoId, videoExt);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ success: false, error: 'Uploaded video not found.' });
    }

    const voiceAudioId = sanitizeCreativeOsText(req.body?.voiceover_audio_id || req.body?.voiceoverAudioId, 120, '');
    if (voiceAudioId && !isCreativeOsMediaId(voiceAudioId)) {
      return res.status(400).json({ success: false, error: 'Invalid voiceover_audio_id.' });
    }
    const voiceAudioExt = parseCreativeOsAudioExtension(req.body?.voiceover_audio_ext || req.body?.voiceoverAudioExt, '', 'mp3');
    const musicAudioId = sanitizeCreativeOsText(req.body?.music_audio_id || req.body?.musicAudioId, 120, '');
    if (musicAudioId && !isCreativeOsMediaId(musicAudioId)) {
      return res.status(400).json({ success: false, error: 'Invalid music_audio_id.' });
    }
    const musicAudioExt = parseCreativeOsAudioExtension(req.body?.music_audio_ext || req.body?.musicAudioExt, '', 'mp3');

    const voiceAudioPath = voiceAudioId ? getCreativeOsAudioUploadPath(voiceAudioId, voiceAudioExt) : null;
    const musicAudioPath = musicAudioId ? getCreativeOsAudioUploadPath(musicAudioId, musicAudioExt) : null;
    const hasVoiceTrack = Boolean(voiceAudioPath && fs.existsSync(voiceAudioPath));
    const hasMusicTrack = Boolean(musicAudioPath && fs.existsSync(musicAudioPath));

    if (voiceAudioId && !hasVoiceTrack) {
      return res.status(404).json({ success: false, error: 'Voiceover track not found for provided voiceover_audio_id.' });
    }
    if (musicAudioId && !hasMusicTrack) {
      return res.status(404).json({ success: false, error: 'Music track not found for provided music_audio_id.' });
    }

    const info = await ffprobeVideoInfo(videoPath);
    const videoDurationSeconds = Math.max(0.1, safeParseNumber(info?.duration, 30));

    const beatSyncEnabled = parseBool(req.body?.beat_sync_enabled ?? req.body?.beatSyncEnabled, false);
    const beatMarkers = parseCreativeOsBeatMarkers(req.body?.beat_markers ?? req.body?.beatMarkers, videoDurationSeconds);

    const rawSegments = Array.isArray(req.body?.timeline_segments) ? req.body.timeline_segments : [];
    const parsedSegments = rawSegments.slice(0, CREATIVE_OS_TIMELINE_MAX_SEGMENTS).map((segment) => ({
      start: clampNumber(segment?.start ?? 0, 0, videoDurationSeconds),
      end: clampNumber(segment?.end ?? videoDurationSeconds, 0, videoDurationSeconds),
      transition: resolveCreativeOsTransitionType(segment?.transition),
      transition_duration: clampNumber(
        segment?.transition_duration ?? segment?.transitionDuration ?? CREATIVE_OS_TRANSITION_DEFAULT_DURATION,
        CREATIVE_OS_TRANSITION_MIN_DURATION,
        CREATIVE_OS_TRANSITION_MAX_DURATION
      )
    })).filter((segment) => segment.end > segment.start);

    const sortedSegments = parsedSegments.sort((a, b) => a.start - b.start);
    const timelineSegments = [];
    let cursor = 0;
    for (const segment of sortedSegments) {
      const start = Math.max(cursor, clampNumber(segment.start, 0, Math.max(0, videoDurationSeconds - CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS)));
      const end = clampNumber(segment.end, start + CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS, videoDurationSeconds);
      if (end - start < CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS) continue;
      timelineSegments.push({
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        duration: Number((end - start).toFixed(3)),
        transition: segment.transition,
        transition_duration: segment.transition_duration
      });
      cursor = end;
      if (timelineSegments.length >= CREATIVE_OS_TIMELINE_MAX_SEGMENTS) break;
      if (cursor >= videoDurationSeconds - CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS) break;
    }

    if (timelineSegments.length === 0) {
      timelineSegments.push({
        start: 0,
        end: Number(videoDurationSeconds.toFixed(3)),
        duration: Number(videoDurationSeconds.toFixed(3)),
        transition: 'fade',
        transition_duration: CREATIVE_OS_TRANSITION_DEFAULT_DURATION
      });
    }

    if (beatSyncEnabled && beatMarkers.length > 0 && timelineSegments.length > 1) {
      for (let index = 0; index < timelineSegments.length - 1; index += 1) {
        const current = timelineSegments[index];
        const next = timelineSegments[index + 1];
        const minBoundary = current.start + CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS;
        const maxBoundary = next.end - CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS;
        if (maxBoundary <= minBoundary) continue;
        const snappedBoundary = snapCaptionBoundaryToBeat(current.end, beatMarkers, minBoundary, maxBoundary);
        current.end = Number(snappedBoundary.toFixed(3));
        next.start = Number(snappedBoundary.toFixed(3));
      }
      timelineSegments.forEach((segment) => {
        segment.duration = Number(Math.max(CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS, segment.end - segment.start).toFixed(3));
      });
    }

    const captionsInput = Array.isArray(req.body?.captions) ? req.body.captions : [];
    const captions = captionsInput.slice(0, CREATIVE_OS_TIMELINE_MAX_CAPTIONS).map((entry, index) => ({
      id: index + 1,
      start: clampNumber(entry?.start ?? 0, 0, 7200),
      end: clampNumber(entry?.end ?? 0, 0, 7200),
      text: sanitizeCreativeOsText(entry?.text, CREATIVE_OS_TIMELINE_MAX_TEXT_CHARS, ''),
      x: safeParseNumber(entry?.x, null),
      y: safeParseNumber(entry?.y, null),
      width: safeParseNumber(entry?.width, null),
      height: safeParseNumber(entry?.height, null),
      margin_x: safeParseNumber(entry?.margin_x ?? entry?.marginX, null),
      font_size: safeParseNumber(entry?.font_size ?? entry?.fontSize, null),
      bg_color: entry?.bg_color || entry?.bgColor,
      text_color: entry?.text_color || entry?.textColor,
      opacity: safeParseNumber(entry?.opacity, null),
      animation: sanitizeCreativeOsText(entry?.animation, 32, 'fade_up'),
      fade_in: safeParseNumber(entry?.fade_in ?? entry?.fadeIn, null),
      fade_out: safeParseNumber(entry?.fade_out ?? entry?.fadeOut, null),
      pop_window: safeParseNumber(entry?.pop_window ?? entry?.popWindow, null)
    })).filter((entry) => entry.text && entry.end > entry.start);

    const voiceoverVolume = clampNumber(req.body?.voiceover_volume ?? req.body?.voiceoverVolume ?? 1, 0, 2);
    const musicVolume = clampNumber(req.body?.music_volume ?? req.body?.musicVolume ?? 0.24, 0, 2);
    const baseAudioVolume = clampNumber(req.body?.base_audio_volume ?? req.body?.baseAudioVolume ?? 1, 0, 2);

    const ffmpegInputs = ['-i', videoPath];
    const trackIndexes = {
      video: 0,
      voice: null,
      music: null
    };

    if (hasVoiceTrack) {
      trackIndexes.voice = ffmpegInputs.length / 2;
      ffmpegInputs.push('-i', voiceAudioPath);
    }
    if (hasMusicTrack) {
      trackIndexes.music = ffmpegInputs.length / 2;
      ffmpegInputs.push('-i', musicAudioPath);
    }

    const hasBaseAudio = await ffprobeHasAudioStream(videoPath).catch(() => false);

    const filterParts = [];
    let finalVideoLabel = '[0:v]';
    let baseAudioInputLabel = null;
    let renderedDurationSeconds = videoDurationSeconds;

    if (timelineSegments.length === 1 && (timelineSegments[0].start > 0 || timelineSegments[0].end < videoDurationSeconds)) {
      const segment = timelineSegments[0];
      filterParts.push(
        `[0:v]trim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},setpts=PTS-STARTPTS[cosvseg0]`
      );
      finalVideoLabel = '[cosvseg0]';
      renderedDurationSeconds = segment.duration;

      if (hasBaseAudio) {
        filterParts.push(
          `[0:a]atrim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},asetpts=PTS-STARTPTS[cosaseg0]`
        );
        baseAudioInputLabel = '[cosaseg0]';
      }
    } else if (timelineSegments.length > 1) {
      timelineSegments.forEach((segment, index) => {
        filterParts.push(
          `[0:v]trim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},setpts=PTS-STARTPTS[cosvseg${index}]`
        );
        if (hasBaseAudio) {
          filterParts.push(
            `[0:a]atrim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},asetpts=PTS-STARTPTS[cosaseg${index}]`
          );
        }
      });

      let videoChain = '[cosvseg0]';
      let audioChain = hasBaseAudio ? '[cosaseg0]' : null;
      let consumed = timelineSegments[0].duration;

      for (let index = 1; index < timelineSegments.length; index += 1) {
        const segment = timelineSegments[index];
        const nextDuration = Math.max(CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS, segment.duration);
        const maxTransition = Math.min(
          CREATIVE_OS_TRANSITION_MAX_DURATION,
          Math.max(CREATIVE_OS_TRANSITION_MIN_DURATION, consumed - (CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS * 0.35)),
          Math.max(CREATIVE_OS_TRANSITION_MIN_DURATION, nextDuration - (CREATIVE_OS_TIMELINE_MIN_SEGMENT_SECONDS * 0.35))
        );
        const transitionDuration = clampNumber(
          segment.transition_duration ?? CREATIVE_OS_TRANSITION_DEFAULT_DURATION,
          CREATIVE_OS_TRANSITION_MIN_DURATION,
          maxTransition
        );
        segment.transition_duration = Number(transitionDuration.toFixed(3));

        const videoOut = `[cosvxf${index}]`;
        const xfadeOffset = Math.max(0, consumed - transitionDuration);
        filterParts.push(
          `${videoChain}[cosvseg${index}]xfade=transition=${segment.transition}:duration=${transitionDuration.toFixed(3)}:offset=${xfadeOffset.toFixed(3)}${videoOut}`
        );
        videoChain = videoOut;

        if (hasBaseAudio && audioChain) {
          const audioOut = `[cosaxf${index}]`;
          filterParts.push(
            `${audioChain}[cosaseg${index}]acrossfade=d=${transitionDuration.toFixed(3)}:c1=tri:c2=tri${audioOut}`
          );
          audioChain = audioOut;
        }

        consumed += nextDuration - transitionDuration;
      }

      finalVideoLabel = videoChain;
      renderedDurationSeconds = Math.max(0.1, consumed);
      baseAudioInputLabel = audioChain;
    }

    const timelineGraph = buildCreativeOsTimelineFilter({
      captions: captions.map((entry) => ({
        ...entry,
        start: clampNumber(entry.start, 0, renderedDurationSeconds),
        end: clampNumber(entry.end, 0, renderedDurationSeconds)
      })).filter((entry) => entry.end > entry.start),
      durationSeconds: renderedDurationSeconds,
      width: info?.width || 1080,
      height: info?.height || 1920,
      fontPath: CREATIVE_OS_TIMELINE_FONT_PATH,
      inputLabel: finalVideoLabel
    });
    if (timelineGraph.filterComplex) {
      filterParts.push(timelineGraph.filterComplex);
      finalVideoLabel = timelineGraph.finalVideoLabel;
    }

    const audioInputs = [];

    if (hasBaseAudio) {
      const baseLabel = '[cosab]';
      if (baseAudioInputLabel) {
        filterParts.push(`${baseAudioInputLabel}volume=${baseAudioVolume.toFixed(3)},atrim=0:${renderedDurationSeconds.toFixed(3)}${baseLabel}`);
      } else {
        filterParts.push(`[0:a]volume=${baseAudioVolume.toFixed(3)},atrim=0:${renderedDurationSeconds.toFixed(3)}${baseLabel}`);
      }
      audioInputs.push(baseLabel);
    }

    if (hasVoiceTrack && trackIndexes.voice !== null) {
      const voiceLabel = '[cosav]';
      filterParts.push(`[${trackIndexes.voice}:a]volume=${voiceoverVolume.toFixed(3)},atrim=0:${renderedDurationSeconds.toFixed(3)}${voiceLabel}`);
      audioInputs.push(voiceLabel);
    }

    if (hasMusicTrack && trackIndexes.music !== null) {
      const fadeStart = Math.max(0, renderedDurationSeconds - 0.75);
      const musicLabel = '[cosam]';
      filterParts.push(
        `[${trackIndexes.music}:a]volume=${musicVolume.toFixed(3)},atrim=0:${renderedDurationSeconds.toFixed(3)},` +
        `afade=t=out:st=${fadeStart.toFixed(3)}:d=0.75${musicLabel}`
      );
      audioInputs.push(musicLabel);
    }

    let finalAudioLabel = null;
    if (audioInputs.length === 1) {
      finalAudioLabel = audioInputs[0];
    } else if (audioInputs.length > 1) {
      finalAudioLabel = '[cosaout]';
      filterParts.push(`${audioInputs.join('')}amix=inputs=${audioInputs.length}:duration=first:dropout_transition=2${finalAudioLabel}`);
    }

    const outputId = crypto.randomUUID();
    const outputPath = getCreativeOsVideoOutputPath(outputId, 'mp4');

    const ffmpegArgs = [
      ...ffmpegInputs,
      ...(filterParts.length > 0 ? ['-filter_complex', filterParts.join(';')] : []),
      ...(filterParts.length > 0 ? ['-map', finalVideoLabel] : ['-map', '0:v']),
      ...(finalAudioLabel ? ['-map', finalAudioLabel] : ['-map', '0:a?']),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    await execFileAsync('ffmpeg', ffmpegArgs);

    const filename = sanitizeCreativeOsMediaFilename(
      req.body?.filename || `${toCreativeOsSlug(req.body?.product_name || 'creative')}-creative.mp4`,
      'creative-os.mp4'
    );
    const downloadUrl = withStoreParam(
      `/api/creative-studio/creative-os/video/download?output_id=${encodeURIComponent(outputId)}&filename=${encodeURIComponent(filename)}`,
      sanitizeCreativeOsText(req.body?.store, 64, CREATIVE_OS_DEFAULT_STORE).toLowerCase()
    );

    return res.json({
      success: true,
      render: {
        output_id: outputId,
        filename,
        download_url: downloadUrl,
        captions_count: captions.length,
        beat_sync_enabled: beatSyncEnabled,
        beat_markers_count: beatMarkers.length,
        timeline_duration_seconds: Number(renderedDurationSeconds.toFixed(3)),
        timeline_segments: timelineSegments.map((segment) => ({
          start: segment.start,
          end: segment.end,
          transition: segment.transition,
          transition_duration: Number(segment.transition_duration || 0)
        })),
        tracks: {
          has_base_audio: hasBaseAudio,
          has_voiceover: hasVoiceTrack,
          has_music: hasMusicTrack
        }
      }
    });
  } catch (error) {
    console.error('[creative-os/video/render] error:', error);
    const message = error?.code === 'ENOENT'
      ? 'ffmpeg/ffprobe not found on server. Install ffmpeg to render videos.'
      : error.message;
    return res.status(500).json({ success: false, error: message });
  }
});

router.get('/creative-os/video/download', async (req, res) => {
  try {
    const outputId = String(req.query.output_id || '').trim();
    const filename = sanitizeCreativeOsMediaFilename(req.query.filename, 'creative-os.mp4');
    const renderInline = parseBool(req.query.inline, false);

    if (!outputId || !CREATIVE_OS_EXPORT_ID_PATTERN.test(outputId)) {
      return res.status(400).json({ success: false, error: 'Invalid output_id.' });
    }

    const outputPath = getCreativeOsVideoOutputPath(outputId, 'mp4');
    if (!fs.existsSync(outputPath)) {
      return res.status(404).json({ success: false, error: 'Rendered video not found.' });
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `${renderInline ? 'inline' : 'attachment'}; filename="${filename}"`);
    fs.createReadStream(outputPath).pipe(res);
  } catch (error) {
    console.error('[creative-os/video/download] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/design/process', photoMagicSingle('image'), async (req, res) => {
  try {
    const store = sanitizeCreativeOsText(req.body?.store || req.query?.store, 64, CREATIVE_OS_DEFAULT_STORE).toLowerCase();

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Image file is required.' });
    }

    const mime = String(req.file.mimetype || '').toLowerCase();
    if (mime && !mime.startsWith('image/')) {
      return res.status(415).json({ success: false, error: 'Unsupported file type (expected image/*).' });
    }

    const formatId = sanitizeCreativeOsText(req.body?.format_id || req.body?.formatId, 64, 'meta_feed_4_5');
    const formatConfig = resolveCreativeOsFormatConfig(formatId);
    const applyBackgroundRemoval = parseBool(
      req.body?.apply_background_removal ?? req.body?.applyBackgroundRemoval,
      true
    );
    const applyScenePlacement = parseBool(
      req.body?.apply_scene_placement ?? req.body?.applyScenePlacement,
      true
    );
    const applyEnhance = parseBool(
      req.body?.apply_enhance ?? req.body?.applyEnhance,
      false
    );
    const rawEnhanceMode = sanitizeCreativeOsText(
      req.body?.enhance_mode || req.body?.enhanceMode,
      32,
      'upscale'
    ).toLowerCase();
    const enhanceMode = CREATIVE_OS_ENHANCE_MODES.has(rawEnhanceMode) ? rawEnhanceMode : 'upscale';
    const enhanceStrength = clampNumber(req.body?.enhance_strength ?? req.body?.enhanceStrength ?? 0.55, 0, 1);
    const enhanceUpscaleFactor = clampNumber(req.body?.enhance_upscale_factor ?? req.body?.enhanceUpscaleFactor ?? 2, 1, 4);
    const scenePresetId = sanitizeCreativeOsText(
      req.body?.scene_preset || req.body?.scenePreset,
      64,
      CREATIVE_OS_DEFAULT_SCENE_PRESET
    );
    const brandPrimary = parseColorWithFallback(req.body?.brand_primary || req.body?.brandPrimary, '#0f766e');
    const brandAccent = parseColorWithFallback(req.body?.brand_accent || req.body?.brandAccent, '#d97706');
    const sourceMaxSide = clampNumber(req.body?.source_max_side ?? req.body?.sourceMaxSide ?? CREATIVE_OS_IMAGE_PIPELINE_MAX_SIDE, 512, 4096);
    const productName = sanitizeCreativeOsText(req.body?.product_name || req.body?.productName, CREATIVE_OS_MAX_PRODUCT_NAME_LENGTH, 'product');
    const variantSuffix = toCreativeOsSlug(req.body?.variant_suffix || req.body?.variantSuffix || 'scene-a', 'scene-a');
    const productSlug = toCreativeOsSlug(productName, 'product');

    await ensureCreativeOsExportDir();

    let workingBuffer = await sharp(req.file.buffer)
      .rotate()
      .png()
      .resize(sourceMaxSide, sourceMaxSide, { fit: 'inside', withoutEnlargement: true })
      .toBuffer();

    const warnings = [];
    let cutoutAsset = null;
    let scenePlacement = null;

    if (applyBackgroundRemoval) {
      if (!isPhotoMagicAiConfigured()) {
        warnings.push('Background removal model is not configured. Original image was used.');
      } else {
        try {
          const cutoutResult = await removeBgRmbg2({
            imageBase64: workingBuffer.toString('base64'),
            maxSide: sourceMaxSide
          });

          if (cutoutResult?.cutout_png) {
            workingBuffer = Buffer.from(String(cutoutResult.cutout_png), 'base64');
            const cutoutAssetId = crypto.randomUUID();
            const cutoutPath = getCreativeOsExportPath(cutoutAssetId);
            await fs.promises.writeFile(cutoutPath, workingBuffer);
            const cutoutFileName = `${productSlug}_cutout_${variantSuffix}.png`;
            cutoutAsset = {
              asset_id: cutoutAssetId,
              file_name: cutoutFileName,
              download_url: buildCreativeOsAssetDownloadUrl({
                assetId: cutoutAssetId,
                fileName: cutoutFileName,
                store
              })
            };
          } else {
            warnings.push('Background removal returned no cutout. Original image was used.');
          }
        } catch (error) {
          warnings.push(`Background removal failed (${sanitizeCreativeOsText(error.message, 120, 'model error')}). Original image was used.`);
        }
      }
    }

    let outputBuffer = workingBuffer;
    let resolvedScenePreset = null;
    let enhanceApplied = false;
    let enhanceEngine = null;

    if (applyScenePlacement) {
      const sceneResult = await renderCreativeOsScenePlacement({
        sourceBuffer: workingBuffer,
        formatConfig,
        scenePresetId,
        brandPrimary,
        brandAccent
      });
      outputBuffer = sceneResult.buffer;
      scenePlacement = sceneResult.placement;
      resolvedScenePreset = sceneResult.scene?.id || resolveCreativeOsScenePreset(scenePresetId).id;
    }

    if (applyEnhance) {
      if (!isPhotoMagicAiConfigured()) {
        warnings.push('Enhancement model is not configured. Scene output was not enhanced.');
      } else {
        try {
          const enhanced = await enhancePhoto({
            imageBase64: outputBuffer.toString('base64'),
            mode: enhanceMode,
            sourceMaxSide: Math.max(formatConfig.width, formatConfig.height),
            strength: enhanceStrength,
            upscaleFactor: enhanceUpscaleFactor
          });

          if (enhanced?.result_png) {
            outputBuffer = Buffer.from(String(enhanced.result_png), 'base64');
            enhanceApplied = true;
            enhanceEngine = sanitizeCreativeOsText(enhanced.engine, 32, null);
          } else {
            warnings.push('Enhancement returned no output. Base render was used.');
          }
        } catch (error) {
          warnings.push(`Enhancement failed (${sanitizeCreativeOsText(error.message, 120, 'model error')}). Base render was used.`);
        }
      }
    }

    const outputAssetId = crypto.randomUUID();
    const outputPath = getCreativeOsExportPath(outputAssetId);
    await fs.promises.writeFile(outputPath, outputBuffer);

    const outputFileName = `${productSlug}_${formatConfig.platformKey}_${variantSuffix}.png`;
    const outputAsset = {
      asset_id: outputAssetId,
      file_name: outputFileName,
      format_id: formatConfig.id,
      ratio: formatConfig.ratio,
      width: formatConfig.width,
      height: formatConfig.height,
      download_url: buildCreativeOsAssetDownloadUrl({
        assetId: outputAssetId,
        fileName: outputFileName,
        store
      })
    };

    return res.json({
      success: true,
      pipeline: {
        format_id: formatConfig.id,
        background_removed: Boolean(cutoutAsset),
        scene_composed: applyScenePlacement,
        scene_preset: resolvedScenePreset,
        enhanced: enhanceApplied,
        enhance_mode: enhanceMode,
        enhance_engine: enhanceEngine,
        placement: scenePlacement,
        cutout_asset: cutoutAsset,
        output_asset: outputAsset,
        warnings
      }
    });
  } catch (error) {
    console.error('[creative-os/design/process] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/video/caption-plan', async (req, res) => {
  try {
    const scriptText = sanitizeCreativeOsText(
      req.body?.script_text || req.body?.scriptText || '',
      CREATIVE_OS_MAX_CAPTION_PLAN_SCRIPT_LENGTH,
      ''
    );
    if (!scriptText) {
      return res.status(400).json({ success: false, error: 'script_text is required.' });
    }

    const durationSeconds = clampNumber(req.body?.duration_seconds ?? req.body?.durationSeconds ?? 30, 3, 180);
    const maxWordsPerCaption = clampNumber(
      req.body?.max_words_per_caption ?? req.body?.maxWordsPerCaption ?? 5,
      CREATIVE_OS_MIN_CAPTION_WORDS_PER_SEGMENT,
      CREATIVE_OS_MAX_CAPTION_WORDS_PER_SEGMENT
    );
    const beatMarkers = parseCreativeOsBeatMarkers(req.body?.beat_markers ?? req.body?.beatMarkers, durationSeconds);
    const captions = buildCreativeOsCaptionPlan({
      scriptText,
      durationSeconds,
      maxWordsPerSegment: maxWordsPerCaption,
      beatMarkers
    });

    const styleId = sanitizeCreativeOsText(req.body?.style_id || req.body?.styleId, 64, 'branded');
    const brandKit = req.body?.brand_kit || req.body?.brandKit || {};
    const style = {
      id: styleId,
      font: sanitizeCreativeOsText(brandKit?.font, 64, 'sora'),
      primary_color: parseColorWithFallback(brandKit?.primaryColor, '#0f766e'),
      accent_color: parseColorWithFallback(brandKit?.accentColor, '#d97706')
    };

    return res.json({
      success: true,
      duration_seconds: durationSeconds,
      max_words_per_caption: maxWordsPerCaption,
      beat_markers: beatMarkers,
      captions,
      style
    });
  } catch (error) {
    console.error('[creative-os/video/caption-plan] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/video/beat-grid', async (req, res) => {
  try {
    const durationSeconds = clampNumber(req.body?.duration_seconds ?? req.body?.durationSeconds ?? 30, 1, 600);
    const bpm = clampNumber(req.body?.bpm ?? 120, 60, 220);
    const offsetSeconds = clampNumber(req.body?.offset_seconds ?? req.body?.offsetSeconds ?? 0, 0, durationSeconds);
    const interval = 60 / bpm;

    const beats = [];
    for (let marker = offsetSeconds; marker <= durationSeconds; marker += interval) {
      beats.push(Number(marker.toFixed(3)));
    }

    res.json({
      success: true,
      bpm,
      interval_seconds: Number(interval.toFixed(4)),
      beats
    });
  } catch (error) {
    console.error('[creative-os/video/beat-grid] error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/creative-os/export/batch', async (req, res) => {
  try {
    const store = sanitizeCreativeOsText(req.body?.store, 64, CREATIVE_OS_DEFAULT_STORE).toLowerCase();
    const formatIdsRaw = Array.isArray(req.body?.format_ids) ? req.body.format_ids : [];
    const requestedFormatIds = Array.from(new Set(
      formatIdsRaw
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )).slice(0, CREATIVE_OS_MAX_EXPORT_TARGETS);

    if (requestedFormatIds.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one export format is required.' });
    }

    const invalidFormat = requestedFormatIds.find((id) => !CREATIVE_OS_FORMAT_CONFIG[id]);
    if (invalidFormat) {
      return res.status(400).json({ success: false, error: `Unsupported format id: ${invalidFormat}` });
    }

    const rawProduct = req.body?.product || {};
    const productName = sanitizeCreativeOsText(rawProduct?.name, CREATIVE_OS_MAX_PRODUCT_NAME_LENGTH, 'Product');
    const productDescription = sanitizeCreativeOsText(rawProduct?.blurb, CREATIVE_OS_MAX_DESCRIPTION_LENGTH, 'Premium product creative');
    const templateName = sanitizeCreativeOsText(
      req.body?.template_name || req.body?.templateName || 'Product Showcase',
      CREATIVE_OS_MAX_TEMPLATE_LENGTH,
      'Product Showcase'
    );
    const caption = sanitizeCreativeOsText(req.body?.caption, CREATIVE_OS_MAX_CAPTION_LENGTH, productDescription);
    const variantSuffix = toCreativeOsSlug(req.body?.variant_suffix || req.body?.variantSuffix || 'variant-a', 'variant-a');

    const brandKit = req.body?.brand_kit || req.body?.brandKit || {};
    const brandPrimary = parseColorWithFallback(brandKit?.primaryColor, '#0f766e');
    const brandAccent = parseColorWithFallback(brandKit?.accentColor, '#d97706');

    const rawPrice = parsePriceCandidate(rawProduct?.price);
    const currency = parseCurrencyCandidate(rawProduct?.currency) || CREATIVE_OS_DEFAULT_CURRENCY;
    const priceLabel = rawPrice !== null
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(rawPrice)
      : 'Shop Now';

    await ensureCreativeOsExportDir();

    const productSlug = toCreativeOsSlug(productName, 'product');
    const assets = [];

    for (const formatId of requestedFormatIds) {
      const formatConfig = CREATIVE_OS_FORMAT_CONFIG[formatId];
      const svg = buildCreativeOsSvgAsset({
        formatConfig,
        productName,
        productDescription,
        caption,
        priceLabel,
        templateName,
        brandPrimary,
        brandAccent
      });
      const pngBuffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
      const assetId = crypto.randomUUID();
      const outputPath = getCreativeOsExportPath(assetId);
      await fs.promises.writeFile(outputPath, pngBuffer);

      const fileName = `${productSlug}_${formatConfig.platformKey}_${variantSuffix}.png`;
      const downloadUrl = buildCreativeOsAssetDownloadUrl({
        assetId,
        fileName,
        store
      });

      assets.push({
        asset_id: assetId,
        file_name: fileName,
        format_id: formatId,
        ratio: formatConfig.ratio,
        width: formatConfig.width,
        height: formatConfig.height,
        download_url: downloadUrl
      });
    }

    return res.json({
      success: true,
      assets,
      meta: {
        store,
        generated_at: new Date().toISOString(),
        count: assets.length
      }
    });
  } catch (error) {
    console.error('[creative-os/export/batch] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/creative-os/export/download', async (req, res) => {
  try {
    const assetId = String(req.query.asset_id || '').trim();
    const filename = sanitizeDownloadFilename(req.query.filename, 'creative-os-asset.png');
    const renderInline = parseBool(req.query.inline, false);

    if (!assetId || !CREATIVE_OS_EXPORT_ID_PATTERN.test(assetId)) {
      return res.status(400).json({ success: false, error: 'Invalid asset_id' });
    }

    const filePath = getCreativeOsExportPath(assetId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `${renderInline ? 'inline' : 'attachment'}; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('[creative-os/export/download] error:', error);
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
