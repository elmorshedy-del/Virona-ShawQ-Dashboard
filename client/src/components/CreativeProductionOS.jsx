import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Briefcase,
  Camera,
  CheckCircle,
  Download,
  Film,
  Globe,
  Layout,
  Layers,
  MessageSquare,
  Monitor,
  Palette,
  Play,
  RefreshCw,
  Settings,
  Smartphone,
  Sparkles,
  Star,
  Target,
  X,
  Upload,
  Zap
} from 'lucide-react';
import './CreativeProductionOS.css';

const DEFAULT_TENANT = 'default-tenant';
const PRODUCT_PRICE_BASE = 89;
const PRODUCT_PRICE_RANGE = 140;
const PRODUCT_PRICE_DECIMAL_PLACES = 2;
const VIDEO_MIN_VARIANTS = 1;
const VIDEO_MAX_VARIANTS = 12;
const API_BASE = '/api';
const MAX_CATALOG_PRODUCTS = 150;

const CREATIVE_MODULES = [
  {
    id: 'design_studio',
    title: 'Design Studio',
    subtitle: 'Canva + Photoroom replacement for ad creative production.',
    icon: Palette,
    helper: 'Ad-native canvases, product URL import, brand-locked templates.'
  },
  {
    id: 'video_studio',
    title: 'Video Studio',
    subtitle: 'CapCut replacement focused on paid ad timelines.',
    icon: Film,
    helper: 'Hook-to-CTA structures, branded captions, voice + beat sync.'
  },
  {
    id: 'multi_format_engine',
    title: 'Multi-Format Engine',
    subtitle: 'Design once and export ad-ready assets everywhere.',
    icon: Layout,
    helper: 'Smart recomposition, safe zones, batch export naming.'
  }
];

const AD_FORMAT_PRESETS = [
  {
    id: 'meta_feed_4_5',
    name: 'Meta Feed',
    ratio: '4:5',
    platform: 'Meta',
    platformKey: 'meta',
    safeZone: 'Top 14% + bottom 20%'
  },
  {
    id: 'instagram_story_9_16',
    name: 'Instagram Story',
    ratio: '9:16',
    platform: 'Instagram',
    platformKey: 'instagram',
    safeZone: 'Top 18% + bottom 24%'
  },
  {
    id: 'tiktok_9_16',
    name: 'TikTok',
    ratio: '9:16',
    platform: 'TikTok',
    platformKey: 'tiktok',
    safeZone: 'Bottom 26% + right 11%'
  },
  {
    id: 'square_1_1',
    name: 'Square',
    ratio: '1:1',
    platform: 'Meta',
    platformKey: 'square',
    safeZone: 'Balanced center safety'
  },
  {
    id: 'youtube_16_9',
    name: 'YouTube',
    ratio: '16:9',
    platform: 'YouTube',
    platformKey: 'youtube',
    safeZone: 'Bottom 12% + left 8%'
  }
];

const DESIGN_TEMPLATES = [
  { id: 'showcase', name: 'Product Showcase', note: 'Hero product + value headline.' },
  { id: 'sale', name: 'Sale Announcement', note: 'Urgency structure for promotions.' },
  { id: 'arrival', name: 'New Arrival', note: 'Launch framing with premium tone.' },
  { id: 'testimonial', name: 'Testimonial', note: 'Social proof layout for paid ads.' },
  { id: 'comparison', name: 'Comparison', note: 'Before/after and side-by-side proof.' }
];

const VIDEO_STRUCTURE_STAGES = [
  { id: 'hook', label: 'Hook', window: '0-3s', duration: 3, note: 'Pattern interrupt with clear value.' },
  { id: 'problem', label: 'Problem', window: '3-8s', duration: 5, note: 'Name pain point with empathy.' },
  { id: 'solution', label: 'Solution', window: '8-18s', duration: 10, note: 'Show product in action.' },
  { id: 'proof', label: 'Proof', window: '18-25s', duration: 7, note: 'Demonstrate outcome or testimonial.' },
  { id: 'cta', label: 'CTA', window: '25-30s', duration: 5, note: 'Single action close with clarity.' }
];

const VIDEO_VOICE_OPTIONS = [
  { id: 'record', label: 'Record Voiceover', detail: 'Direct mic capture with noise handling.' },
  { id: 'upload', label: 'Upload Voice', detail: 'Import narrator track and align quickly.' },
  { id: 'ai_arabic', label: 'AI Arabic Accent', detail: 'Arabic-accent voices tuned for ad cadence.' }
];

const CAPTION_STYLES = [
  { id: 'branded', label: 'Brand Motion', detail: 'Use saved brand fonts and colors.' },
  { id: 'minimal', label: 'Minimal Motion', detail: 'Calm entrance with premium spacing.' },
  { id: 'impact', label: 'Impact Motion', detail: 'Bold kinetic reveals for hooks.' }
];

const PRODUCT_COLLECTIONS = [
  { id: 'all', name: 'All Products' },
  { id: 'new_arrivals', name: 'New Arrivals' },
  { id: 'best_sellers', name: 'Best Sellers' },
  { id: 'evergreen', name: 'Evergreen Core' }
];

const SAMPLE_PRODUCTS = [
  {
    id: 'product_contour_abaya',
    name: 'Contour Abaya',
    price: 149,
    currency: 'USD',
    collection: 'new_arrivals',
    angles: 6,
    variants: 4,
    blurb: 'Fluid movement, clean drape, premium finish.',
    gradient: 'from-emerald-200 via-white to-emerald-50'
  },
  {
    id: 'product_sculpt_blazer',
    name: 'Sculpt Blazer',
    price: 189,
    currency: 'USD',
    collection: 'best_sellers',
    angles: 8,
    variants: 5,
    blurb: 'Structured tailoring with lightweight comfort.',
    gradient: 'from-amber-100 via-white to-orange-50'
  },
  {
    id: 'product_everyday_set',
    name: 'Everyday Set',
    price: 118,
    currency: 'USD',
    collection: 'evergreen',
    angles: 5,
    variants: 3,
    blurb: 'Modular set for repeatable campaign testing.',
    gradient: 'from-cyan-100 via-white to-sky-50'
  }
];

const CATALOG_INTEGRATIONS = [
  {
    id: 'shopify',
    title: 'Shopify',
    detail: 'Catalog sync + price map + image variants.'
  },
  {
    id: 'salla',
    title: 'Salla',
    detail: 'Store-ready product feed and collection mapping.'
  },
  {
    id: 'woocommerce',
    title: 'WooCommerce',
    detail: 'Self-hosted store connection with product refresh.'
  }
];

const MUSIC_MOODS = [
  { id: 'uplift', label: 'Uplift Energy' },
  { id: 'editorial', label: 'Editorial Luxe' },
  { id: 'confident', label: 'Confident Pulse' }
];

const PANEL_LABELS = {
  design_studio: 'Visual Production Layer',
  video_studio: 'Timeline Production Layer',
  multi_format_engine: 'Distribution Layer'
};

const BRAND_FONT_OPTIONS = [
  { id: 'sora', label: 'Sora' },
  { id: 'manrope', label: 'Manrope' },
  { id: 'ibm_plex_sans_arabic', label: 'IBM Plex Sans Arabic' }
];

const DEFAULT_EXPORT_TARGETS = ['meta_feed_4_5', 'instagram_story_9_16', 'tiktok_9_16'];
const DEFAULT_SCENE_PRESET_ID = 'studio_soft';
const MAX_TIMELINE_BEATS = 24;
const DEFAULT_CURRENCY = 'USD';
const BRAND_LOGO_UPLOAD_DATA_URL_PREFIX = 'data:image/';

const DESIGN_SCENE_PRESETS = [
  { id: 'studio_soft', label: 'Studio Soft' },
  { id: 'lifestyle_warm', label: 'Lifestyle Warm' },
  { id: 'editorial_luxe', label: 'Editorial Luxe' }
];

const MAX_TIMELINE_SECONDS = 180;
const MIN_TIMELINE_SEGMENT_SECONDS = 0.6;
const DEFAULT_TRANSITION_DURATION = 0.28;
const MIN_TRANSITION_DURATION = 0.06;
const MAX_TRANSITION_DURATION = 1.2;
const DRAG_PRODUCT_MIME = 'application/x-creative-product';
const PRICE_SYNC_INTERVAL_MS = 30000;
const CAPTION_STYLE_TO_ANIMATION = {
  branded: 'fade_up',
  minimal: 'hard_cut',
  impact: 'pop'
};
const TRANSITION_OPTIONS = [
  { id: 'fade', label: 'Fade' },
  { id: 'slideleft', label: 'Slide Left' },
  { id: 'slideright', label: 'Slide Right' },
  { id: 'smoothleft', label: 'Smooth Left' },
  { id: 'smoothright', label: 'Smooth Right' },
  { id: 'circleopen', label: 'Circle Open' }
];
const TIMELINE_TRACK_ORDER = ['video', 'captions', 'voice', 'music'];

const toSlug = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'asset';
};

const toTitleCase = (value) => {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeProductUrl = (rawValue) => {
  const trimmedValue = String(rawValue || '').trim();
  if (!trimmedValue) {
    return null;
  }

  const candidate = trimmedValue.includes('://') ? trimmedValue : `https://${trimmedValue}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) return null;
    return parsed;
  } catch (error) {
    return null;
  }
};

const deriveProductFromUrl = (rawValue) => {
  const parsedUrl = normalizeProductUrl(rawValue);
  if (!parsedUrl) {
    return null;
  }

  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
  const seed = hostname.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  const derivedPrice = PRODUCT_PRICE_BASE + (seed % PRODUCT_PRICE_RANGE);
  const sourceName = pathSegments[pathSegments.length - 1] || hostname.split('.')[0] || 'signature-product';

  return {
    id: `imported-${toSlug(sourceName)}`,
    name: toTitleCase(sourceName),
    price: Number(derivedPrice.toFixed(PRODUCT_PRICE_DECIMAL_PLACES)),
    currency: 'USD',
    collection: 'new_arrivals',
    angles: 7,
    variants: 5,
    blurb: `Imported from ${hostname}. Ready for template auto-population.`,
    gradient: 'from-violet-100 via-white to-teal-50',
    source: parsedUrl.href
  };
};

const formatCurrency = (value, currency) => {
  const parsedValue = Number(value || 0);
  const safeValue = Number.isFinite(parsedValue) ? parsedValue : 0;
  const rawCurrency = String(currency || DEFAULT_CURRENCY).trim().toUpperCase();
  const safeCurrency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : DEFAULT_CURRENCY;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: PRODUCT_PRICE_DECIMAL_PLACES
    }).format(safeValue);
  } catch (error) {
    return `${safeValue.toFixed(PRODUCT_PRICE_DECIMAL_PLACES)} ${DEFAULT_CURRENCY}`;
  }
};

const clampVariantCount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return VIDEO_MIN_VARIANTS;
  }
  return Math.min(VIDEO_MAX_VARIANTS, Math.max(VIDEO_MIN_VARIANTS, Math.floor(parsed)));
};

const buildApiUrl = (path, store) => {
  const separator = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${separator}store=${encodeURIComponent(store || DEFAULT_TENANT)}`;
};

const parseResponseJson = async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }
  return payload;
};

const toInlineAssetUrl = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return `${raw}${raw.includes('?') ? '&' : '?'}inline=1`;
};

const clampNumber = (value, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
};

const formatSeconds = (value) => `${Number(value || 0).toFixed(2)}s`;

const getCanvasDimensions = (formatId) => {
  if (formatId === 'meta_feed_4_5') return { width: 1080, height: 1350 };
  if (formatId === 'instagram_story_9_16') return { width: 1080, height: 1920 };
  if (formatId === 'tiktok_9_16') return { width: 1080, height: 1920 };
  if (formatId === 'square_1_1') return { width: 1080, height: 1080 };
  if (formatId === 'youtube_16_9') return { width: 1920, height: 1080 };
  return { width: 1080, height: 1350 };
};

const buildDefaultTimelineSegments = (durationSeconds) => {
  const safeDuration = clampNumber(durationSeconds, 3, MAX_TIMELINE_SECONDS);
  const totalStageDuration = VIDEO_STRUCTURE_STAGES.reduce((total, stage) => total + stage.duration, 0) || safeDuration;
  let cursor = 0;

  return VIDEO_STRUCTURE_STAGES.map((stage, index) => {
    const proportionalDuration = index === VIDEO_STRUCTURE_STAGES.length - 1
      ? Math.max(MIN_TIMELINE_SEGMENT_SECONDS, safeDuration - cursor)
      : Math.max(MIN_TIMELINE_SEGMENT_SECONDS, (stage.duration / totalStageDuration) * safeDuration);
    const start = Number(cursor.toFixed(3));
    const end = Number(Math.min(safeDuration, cursor + proportionalDuration).toFixed(3));
    cursor = end;
    return {
      id: `stage_${stage.id}`,
      stageId: stage.id,
      label: stage.label,
      note: stage.note,
      start,
      end,
      transition: 'fade',
      transitionDuration: DEFAULT_TRANSITION_DURATION
    };
  });
};

const normalizeTimelineSegments = (segments, durationSeconds) => {
  const safeDuration = clampNumber(durationSeconds, 3, MAX_TIMELINE_SECONDS);
  const sorted = [...segments]
    .map((segment) => ({
      ...segment,
      start: clampNumber(segment.start, 0, safeDuration),
      end: clampNumber(segment.end, 0, safeDuration)
    }))
    .sort((a, b) => a.start - b.start);

  const normalized = [];
  let cursor = 0;
  sorted.forEach((segment) => {
    const start = Math.max(cursor, clampNumber(segment.start, 0, safeDuration));
    const end = clampNumber(segment.end, start + MIN_TIMELINE_SEGMENT_SECONDS, safeDuration);
    if (end - start < MIN_TIMELINE_SEGMENT_SECONDS) return;
    normalized.push({
      ...segment,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      transitionDuration: clampNumber(
        segment.transitionDuration ?? DEFAULT_TRANSITION_DURATION,
        MIN_TRANSITION_DURATION,
        MAX_TRANSITION_DURATION
      )
    });
    cursor = end;
  });

  if (normalized.length === 0) {
    return [{
      id: 'stage_hook',
      stageId: 'hook',
      label: 'Hook',
      note: 'Pattern interrupt with clear value.',
      start: 0,
      end: safeDuration,
      transition: 'fade',
      transitionDuration: DEFAULT_TRANSITION_DURATION
    }];
  }

  return normalized;
};

const snapTimeToBeat = (timeValue, beatMarkers) => {
  if (!Array.isArray(beatMarkers) || beatMarkers.length === 0) return timeValue;
  let best = timeValue;
  let minDelta = Number.POSITIVE_INFINITY;
  beatMarkers.forEach((beat) => {
    const delta = Math.abs(Number(beat) - timeValue);
    if (Number.isFinite(delta) && delta < minDelta) {
      minDelta = delta;
      best = Number(beat);
    }
  });
  if (minDelta > 0.45) {
    return timeValue;
  }
  return Number(best.toFixed(3));
};

const createInitialCanvasLayers = () => ({
  product: { x: 0.15, y: 0.17, width: 0.42, height: 0.58, visible: true },
  headline: { x: 0.62, y: 0.2, width: 0.3, height: 0.2, visible: true },
  price: { x: 0.62, y: 0.46, width: 0.24, height: 0.09, visible: true },
  cta: { x: 0.62, y: 0.58, width: 0.22, height: 0.08, visible: true }
});

function SectionCard({ title, icon: Icon, helper, children, className = '' }) {
  return (
    <div className={`creative-os-panel ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="creative-os-heading text-base font-semibold text-slate-900">{title}</h3>
          {helper && <p className="mt-1 text-sm text-slate-600">{helper}</p>}
        </div>
        {Icon && (
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function ToggleChip({ selected, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        selected
          ? 'border-teal-500 bg-teal-500 text-white shadow-sm shadow-teal-200'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function ModuleButton({ module, isActive, onClick }) {
  const Icon = module.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`creative-os-module-btn ${isActive ? 'active' : ''}`}
    >
      <span className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 text-slate-700">
        <Icon size={16} />
      </span>
      <span className="text-left">
        <span className="creative-os-heading block text-sm font-semibold text-slate-900">{module.title}</span>
        <span className="mt-1 block text-xs text-slate-600">{module.helper}</span>
      </span>
    </button>
  );
}

export default function CreativeProductionOS({ store }) {
  const tenantKey = store || DEFAULT_TENANT;
  const [activeModuleId, setActiveModuleId] = useState(CREATIVE_MODULES[0].id);

  const [catalogProducts, setCatalogProducts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogInfo, setCatalogInfo] = useState(null);

  const [selectedFormatId, setSelectedFormatId] = useState(AD_FORMAT_PRESETS[0].id);
  const [selectedTemplateId, setSelectedTemplateId] = useState(DESIGN_TEMPLATES[0].id);
  const [productUrlDraft, setProductUrlDraft] = useState('');
  const [importError, setImportError] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importedProduct, setImportedProduct] = useState(null);
  const [captionDirection, setCaptionDirection] = useState('ltr');
  const [captionDraft, setCaptionDraft] = useState('Elevate every arrival with premium movement.');
  const [brandKit, setBrandKit] = useState({
    font: BRAND_FONT_OPTIONS[0].id,
    primaryColor: '#0f766e',
    accentColor: '#d97706',
    logoUrl: '',
    enforceAcrossAssets: true
  });
  const [brandKitLogoLoading, setBrandKitLogoLoading] = useState(false);
  const [brandKitLogoError, setBrandKitLogoError] = useState('');
  const [designAutomation, setDesignAutomation] = useState({
    smartResize: true,
    backgroundRemoval: true,
    aiScenePlacement: true
  });
  const [styleExtractLoading, setStyleExtractLoading] = useState(false);
  const [styleExtractError, setStyleExtractError] = useState('');
  const [stylePalette, setStylePalette] = useState([]);
  const [styleImageFile, setStyleImageFile] = useState(null);
  const [styleImageName, setStyleImageName] = useState('');
  const [designImageFile, setDesignImageFile] = useState(null);
  const [designImageName, setDesignImageName] = useState('');
  const [designImagePreviewUrl, setDesignImagePreviewUrl] = useState('');
  const [scenePresetId, setScenePresetId] = useState(DEFAULT_SCENE_PRESET_ID);
  const [designPipelineLoading, setDesignPipelineLoading] = useState(false);
  const [designPipelineError, setDesignPipelineError] = useState('');
  const [designPipelineResult, setDesignPipelineResult] = useState(null);
  const [canvasLayers, setCanvasLayers] = useState(createInitialCanvasLayers);
  const [canvasDropMessage, setCanvasDropMessage] = useState('');
  const [canvasDragLayerId, setCanvasDragLayerId] = useState('');
  const canvasDropRef = useRef(null);

  const [activeVideoStageId, setActiveVideoStageId] = useState(VIDEO_STRUCTURE_STAGES[0].id);
  const [selectedVoiceMode, setSelectedVoiceMode] = useState(VIDEO_VOICE_OPTIONS[2].id);
  const [selectedCaptionStyle, setSelectedCaptionStyle] = useState(CAPTION_STYLES[0].id);
  const [beatSyncEnabled, setBeatSyncEnabled] = useState(true);
  const [selectedMusicMood, setSelectedMusicMood] = useState(MUSIC_MOODS[1].id);
  const [variantCount, setVariantCount] = useState(4);
  const [beatBpm, setBeatBpm] = useState(120);
  const [beatGrid, setBeatGrid] = useState([]);
  const [beatGridLoading, setBeatGridLoading] = useState(false);
  const [beatGridError, setBeatGridError] = useState('');
  const [hooksLoading, setHooksLoading] = useState(false);
  const [generatedHooks, setGeneratedHooks] = useState([]);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [generatedScript, setGeneratedScript] = useState('');
  const [videoWorkflowError, setVideoWorkflowError] = useState('');
  const [captionPlanLoading, setCaptionPlanLoading] = useState(false);
  const [captionPlanError, setCaptionPlanError] = useState('');
  const [captionPlan, setCaptionPlan] = useState([]);
  const [timelineDurationSeconds, setTimelineDurationSeconds] = useState(30);
  const [timelineSegments, setTimelineSegments] = useState(buildDefaultTimelineSegments(30));
  const [timelineCaptionClips, setTimelineCaptionClips] = useState([]);
  const [videoSourceFileName, setVideoSourceFileName] = useState('');
  const [videoSourceUpload, setVideoSourceUpload] = useState(null);
  const [videoSourceUploadLoading, setVideoSourceUploadLoading] = useState(false);
  const [videoSourceUploadError, setVideoSourceUploadError] = useState('');
  const [voiceTrackSource, setVoiceTrackSource] = useState(null);
  const [voiceTrackOffset, setVoiceTrackOffset] = useState(0);
  const [voiceTrackUploadName, setVoiceTrackUploadName] = useState('');
  const [voiceTrackLoading, setVoiceTrackLoading] = useState(false);
  const [voiceTrackError, setVoiceTrackError] = useState('');
  const [voiceScriptDraft, setVoiceScriptDraft] = useState('Discover premium comfort with every order.');
  const [voiceLanguage, setVoiceLanguage] = useState('en');
  const [ttsLoading, setTtsLoading] = useState(false);
  const [musicLibrary, setMusicLibrary] = useState([]);
  const [musicLibraryLoading, setMusicLibraryLoading] = useState(false);
  const [musicLibraryError, setMusicLibraryError] = useState('');
  const [selectedMusicTrackId, setSelectedMusicTrackId] = useState('');
  const [musicTrackOffset, setMusicTrackOffset] = useState(0);
  const [videoRenderLoading, setVideoRenderLoading] = useState(false);
  const [videoRenderError, setVideoRenderError] = useState('');
  const [videoRenderResult, setVideoRenderResult] = useState(null);
  const [recordingActive, setRecordingActive] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const catalogRefreshTimerRef = useRef(null);

  const [integrationState, setIntegrationState] = useState({
    shopify: true,
    salla: true,
    woocommerce: false
  });
  const [selectedCollectionId, setSelectedCollectionId] = useState(PRODUCT_COLLECTIONS[0].id);
  const [selectedProductId, setSelectedProductId] = useState(SAMPLE_PRODUCTS[0].id);
  const [dynamicPriceSync, setDynamicPriceSync] = useState(true);
  const [productHubMessage, setProductHubMessage] = useState('');

  const [baseFormatId, setBaseFormatId] = useState(AD_FORMAT_PRESETS[0].id);
  const [exportTargets, setExportTargets] = useState(DEFAULT_EXPORT_TARGETS);
  const [safeZonePreviewEnabled, setSafeZonePreviewEnabled] = useState(true);
  const [variantSuffix, setVariantSuffix] = useState('launch-a');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportedAssets, setExportedAssets] = useState([]);
  const [savePresetLoading, setSavePresetLoading] = useState(false);
  const [savePresetMessage, setSavePresetMessage] = useState('');

  const activeModule = useMemo(() => {
    return CREATIVE_MODULES.find((module) => module.id === activeModuleId) || CREATIVE_MODULES[0];
  }, [activeModuleId]);

  const allProducts = useMemo(() => {
    const catalogSeed = catalogProducts.length > 0 ? catalogProducts : SAMPLE_PRODUCTS;
    if (!importedProduct) {
      return catalogSeed;
    }
    return [importedProduct, ...catalogSeed.filter((product) => product.id !== importedProduct.id)];
  }, [catalogProducts, importedProduct]);

  const visibleProducts = useMemo(() => {
    if (selectedCollectionId === 'all') {
      return allProducts;
    }
    return allProducts.filter((product) => product.collection === selectedCollectionId);
  }, [allProducts, selectedCollectionId]);

  const selectedProduct = useMemo(() => {
    return allProducts.find((product) => product.id === selectedProductId) || allProducts[0];
  }, [allProducts, selectedProductId]);

  const selectedFormat = useMemo(() => {
    return AD_FORMAT_PRESETS.find((preset) => preset.id === selectedFormatId) || AD_FORMAT_PRESETS[0];
  }, [selectedFormatId]);

  const selectedTemplate = useMemo(() => {
    return DESIGN_TEMPLATES.find((template) => template.id === selectedTemplateId) || DESIGN_TEMPLATES[0];
  }, [selectedTemplateId]);

  const baseFormat = useMemo(() => {
    return AD_FORMAT_PRESETS.find((preset) => preset.id === baseFormatId) || AD_FORMAT_PRESETS[0];
  }, [baseFormatId]);

  const selectedVideoStage = useMemo(() => {
    return VIDEO_STRUCTURE_STAGES.find((stage) => stage.id === activeVideoStageId) || VIDEO_STRUCTURE_STAGES[0];
  }, [activeVideoStageId]);

  const totalVideoSeconds = useMemo(() => {
    return VIDEO_STRUCTURE_STAGES.reduce((total, stage) => total + stage.duration, 0);
  }, []);

  const canvasDimensions = useMemo(() => getCanvasDimensions(selectedFormatId), [selectedFormatId]);

  const selectedMusicTrack = useMemo(() => {
    return musicLibrary.find((track) => track.id === selectedMusicTrackId) || null;
  }, [musicLibrary, selectedMusicTrackId]);

  const voiceTrackClip = useMemo(() => {
    if (!voiceTrackSource?.audio_id) return null;
    const clipDuration = clampNumber(
      voiceTrackSource.duration ?? timelineDurationSeconds,
      MIN_TIMELINE_SEGMENT_SECONDS,
      timelineDurationSeconds
    );
    const start = clampNumber(
      voiceTrackOffset,
      0,
      Math.max(0, timelineDurationSeconds - clipDuration)
    );
    return {
      id: 'voice_track',
      label: voiceTrackSource.label || 'Voiceover',
      start: Number(start.toFixed(3)),
      end: Number((start + clipDuration).toFixed(3))
    };
  }, [voiceTrackSource, timelineDurationSeconds, voiceTrackOffset]);

  const musicTrackClip = useMemo(() => {
    if (!selectedMusicTrack?.audio_id) return null;
    const clipDuration = clampNumber(
      selectedMusicTrack.duration ?? timelineDurationSeconds,
      MIN_TIMELINE_SEGMENT_SECONDS,
      timelineDurationSeconds
    );
    const start = clampNumber(
      musicTrackOffset,
      0,
      Math.max(0, timelineDurationSeconds - clipDuration)
    );
    return {
      id: 'music_track',
      label: selectedMusicTrack.title,
      start: Number(start.toFixed(3)),
      end: Number((start + clipDuration).toFixed(3))
    };
  }, [selectedMusicTrack, timelineDurationSeconds, musicTrackOffset]);

  const exportFileNames = useMemo(() => {
    const productSlug = toSlug(selectedProduct?.name || 'product');
    const suffix = toSlug(variantSuffix || 'variant-a');
    return exportTargets.map((targetId) => {
      const target = AD_FORMAT_PRESETS.find((preset) => preset.id === targetId);
      if (!target) {
        return `${productSlug}_custom_${suffix}.png`;
      }
      return `${productSlug}_${target.platformKey}_${suffix}.png`;
    });
  }, [exportTargets, selectedProduct, variantSuffix]);

  const connectedIntegrationCount = useMemo(() => {
    return CATALOG_INTEGRATIONS.reduce((total, integration) => {
      return total + (integrationState[integration.id] ? 1 : 0);
    }, 0);
  }, [integrationState]);

  useEffect(() => {
    if (!selectedProductId && allProducts.length > 0) {
      setSelectedProductId(allProducts[0].id);
      return;
    }
    if (selectedProductId && !allProducts.some((product) => product.id === selectedProductId)) {
      setSelectedProductId(allProducts[0]?.id || '');
    }
  }, [allProducts, selectedProductId]);

  useEffect(() => {
    return () => {
      if (designImagePreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(designImagePreviewUrl);
      }
    };
  }, [designImagePreviewUrl]);

  useEffect(() => {
    const nextDuration = clampNumber(
      videoSourceUpload?.duration ?? totalVideoSeconds,
      3,
      MAX_TIMELINE_SECONDS
    );
    setTimelineDurationSeconds(nextDuration);
    setTimelineSegments((previous) => {
      if (previous.length === 0) {
        return buildDefaultTimelineSegments(nextDuration);
      }
      return normalizeTimelineSegments(previous, nextDuration);
    });
  }, [videoSourceUpload?.duration, totalVideoSeconds]);

  useEffect(() => {
    if (captionPlan.length === 0) return;
    setTimelineCaptionClips(captionPlan.map((caption) => ({
      id: `caption_${caption.id}`,
      text: caption.text,
      start: clampNumber(caption.start, 0, timelineDurationSeconds),
      end: clampNumber(caption.end, 0, timelineDurationSeconds)
    })).filter((caption) => caption.end > caption.start));
  }, [captionPlan, timelineDurationSeconds]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const response = await fetch(buildApiUrl(`/creative-studio/creative-os/catalog?limit=${MAX_CATALOG_PRODUCTS}`, tenantKey));
      const payload = await parseResponseJson(response);
      const products = Array.isArray(payload.products) ? payload.products : [];
      setCatalogProducts(products);
      if (payload.integrations) {
        setIntegrationState((previous) => ({
          ...previous,
          shopify: Boolean(payload.integrations.shopify),
          salla: Boolean(payload.integrations.salla),
          woocommerce: Boolean(payload.integrations.woocommerce)
        }));
      }
      setCatalogInfo(payload.source_stats || null);
    } catch (error) {
      setCatalogError(error.message || 'Failed to load catalog.');
    } finally {
      setCatalogLoading(false);
    }
  }, [tenantKey]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!dynamicPriceSync) {
      if (catalogRefreshTimerRef.current) {
        clearInterval(catalogRefreshTimerRef.current);
        catalogRefreshTimerRef.current = null;
      }
      return undefined;
    }

    if (catalogRefreshTimerRef.current) {
      clearInterval(catalogRefreshTimerRef.current);
    }
    catalogRefreshTimerRef.current = setInterval(() => {
      loadCatalog();
    }, PRICE_SYNC_INTERVAL_MS);

    return () => {
      if (catalogRefreshTimerRef.current) {
        clearInterval(catalogRefreshTimerRef.current);
        catalogRefreshTimerRef.current = null;
      }
    };
  }, [dynamicPriceSync, loadCatalog]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const activateModule = (moduleId) => {
    if (!CREATIVE_MODULES.some((module) => module.id === moduleId)) return;
    setActiveModuleId(moduleId);
  };

  const importProductFromUrl = async () => {
    const parsed = normalizeProductUrl(productUrlDraft);
    if (!parsed) {
      setImportError('Enter a valid product URL to auto-pull creative fields.');
      return;
    }

    setImportLoading(true);
    setImportError('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/product/import-url', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: tenantKey, url: parsed.toString() })
      });
      const payload = await parseResponseJson(response);
      const imported = payload.product || deriveProductFromUrl(parsed.toString());
      if (!imported?.id) {
        throw new Error('No product data returned from URL.');
      }
      setImportedProduct(imported);
      setSelectedProductId(imported.id);
      setSelectedCollectionId('all');
      setProductHubMessage(`Imported ${imported.name} from URL.`);
    } catch (error) {
      setImportError(error.message || 'Failed to import product URL.');
    } finally {
      setImportLoading(false);
    }
  };

  const handleStyleImageSelect = (event) => {
    const nextFile = event.target.files?.[0] || null;
    setStyleImageFile(nextFile);
    setStyleImageName(nextFile?.name || '');
    setStyleExtractError('');
  };

  const handleDesignImageSelect = (event) => {
    const nextFile = event.target.files?.[0] || null;
    if (designImagePreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(designImagePreviewUrl);
    }
    setDesignImageFile(nextFile);
    setDesignImageName(nextFile?.name || '');
    setDesignImagePreviewUrl(nextFile ? URL.createObjectURL(nextFile) : '');
    setDesignPipelineError('');
    setDesignPipelineResult(null);
  };

  const handleBrandLogoSelect = (event) => {
    const nextFile = event.target.files?.[0] || null;
    if (!nextFile) return;
    if (!String(nextFile.type || '').toLowerCase().startsWith('image/')) {
      setBrandKitLogoError('Upload an image file for brand logo.');
      return;
    }
    setBrandKitLogoError('');
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      if (!result.startsWith(BRAND_LOGO_UPLOAD_DATA_URL_PREFIX)) {
        setBrandKitLogoError('Unable to read logo file.');
        return;
      }
      setBrandKit((previous) => ({ ...previous, logoUrl: result }));
    };
    reader.onerror = () => setBrandKitLogoError('Unable to read logo file.');
    reader.readAsDataURL(nextFile);
  };

  const extractBrandLogoFromStore = async () => {
    setBrandKitLogoLoading(true);
    setBrandKitLogoError('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/brand-kit/bootstrap', tenantKey));
      const payload = await parseResponseJson(response);
      const logoUrl = String(payload?.brand_kit?.logo_url || '').trim();
      if (!logoUrl) {
        throw new Error('No logo detected in connected store profile.');
      }
      setBrandKit((previous) => ({
        ...previous,
        logoUrl,
        primaryColor: payload?.brand_kit?.primary_color || previous.primaryColor,
        accentColor: payload?.brand_kit?.accent_color || previous.accentColor
      }));
    } catch (error) {
      setBrandKitLogoError(error.message || 'Failed to fetch store logo.');
    } finally {
      setBrandKitLogoLoading(false);
    }
  };

  const runStyleExtraction = async () => {
    if (!styleImageFile) {
      setStyleExtractError('Choose an image first to run non-LLM style extraction.');
      return;
    }
    setStyleExtractLoading(true);
    setStyleExtractError('');
    try {
      const formData = new FormData();
      formData.append('image', styleImageFile);
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/style/extract', tenantKey), {
        method: 'POST',
        body: formData
      });
      const payload = await parseResponseJson(response);
      setStylePalette(Array.isArray(payload.palette) ? payload.palette : []);
      if (payload.recommendations?.primary) {
        setBrandKit((previous) => ({
          ...previous,
          primaryColor: payload.recommendations.primary,
          accentColor: payload.recommendations.accent || previous.accentColor
        }));
      }
    } catch (error) {
      setStyleExtractError(error.message || 'Failed to extract palette.');
    } finally {
      setStyleExtractLoading(false);
    }
  };

  const runDesignImagePipeline = async () => {
    if (!designImageFile) {
      setDesignPipelineError('Upload a product image first.');
      return;
    }

    setDesignPipelineLoading(true);
    setDesignPipelineError('');
    try {
      const formData = new FormData();
      formData.append('image', designImageFile);
      formData.append('store', tenantKey);
      formData.append('format_id', selectedFormatId);
      formData.append('scene_preset', scenePresetId);
      formData.append('product_name', selectedProduct?.name || 'product');
      formData.append('variant_suffix', variantSuffix || 'scene-a');
      formData.append('brand_primary', brandKit.primaryColor);
      formData.append('brand_accent', brandKit.accentColor);
      formData.append('apply_background_removal', String(Boolean(designAutomation.backgroundRemoval)));
      formData.append('apply_scene_placement', String(Boolean(designAutomation.aiScenePlacement)));

      const response = await fetch(buildApiUrl('/creative-studio/creative-os/design/process', tenantKey), {
        method: 'POST',
        body: formData
      });
      const payload = await parseResponseJson(response);
      setDesignPipelineResult(payload.pipeline || null);
      if (Array.isArray(payload.pipeline?.warnings) && payload.pipeline.warnings.length > 0) {
        setDesignPipelineError(payload.pipeline.warnings.join(' '));
      }
    } catch (error) {
      setDesignPipelineError(error.message || 'Failed to run design image pipeline.');
    } finally {
      setDesignPipelineLoading(false);
    }
  };

  const generateBeatGrid = async () => {
    setBeatGridLoading(true);
    setBeatGridError('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/video/beat-grid', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bpm: beatBpm,
          duration_seconds: timelineDurationSeconds
        })
      });
      const payload = await parseResponseJson(response);
      setBeatGrid(Array.isArray(payload.beats) ? payload.beats.slice(0, MAX_TIMELINE_BEATS) : []);
    } catch (error) {
      setBeatGridError(error.message || 'Failed to generate beat grid.');
    } finally {
      setBeatGridLoading(false);
    }
  };

  const generateHooks = async (countOverride = null) => {
    if (!selectedProduct?.name) {
      setVideoWorkflowError('Select a product first.');
      return;
    }
    const targetCount = clampVariantCount(countOverride ?? variantCount);
    setHooksLoading(true);
    setVideoWorkflowError('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/generate/hooks', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: selectedProduct.name,
          product_description: selectedProduct.blurb || captionDraft,
          target_audience: 'E-commerce shoppers',
          count: targetCount
        })
      });
      const payload = await parseResponseJson(response);
      const hooks = Array.isArray(payload.hooks) ? payload.hooks : [];
      setGeneratedHooks(hooks.slice(0, targetCount));
    } catch (error) {
      setVideoWorkflowError(error.message || 'Failed to generate hooks.');
    } finally {
      setHooksLoading(false);
    }
  };

  const generateScript = async () => {
    if (!selectedProduct?.name) {
      setVideoWorkflowError('Select a product first.');
      return;
    }
    setScriptLoading(true);
    setVideoWorkflowError('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/generate/script', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_name: selectedProduct.name,
          product_benefits: selectedProduct.blurb || captionDraft,
          target_audience: 'E-commerce shoppers',
          duration: '30s',
          style: 'testimonial'
        })
      });
      const payload = await parseResponseJson(response);
      const script = payload.script || payload.output || payload.data || '';
      if (typeof script === 'string') {
        setGeneratedScript(script);
      } else {
        setGeneratedScript(JSON.stringify(script, null, 2));
      }
    } catch (error) {
      setVideoWorkflowError(error.message || 'Failed to generate script.');
    } finally {
      setScriptLoading(false);
    }
  };

  const generateCaptionPlan = async () => {
    const scriptSource = typeof generatedScript === 'string' && generatedScript.trim()
      ? generatedScript
      : captionDraft;

    if (!scriptSource?.trim()) {
      setCaptionPlanError('Generate a script or add caption text first.');
      return;
    }

    setCaptionPlanLoading(true);
    setCaptionPlanError('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/video/caption-plan', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script_text: scriptSource,
          duration_seconds: timelineDurationSeconds,
          max_words_per_caption: selectedCaptionStyle === 'impact' ? 3 : selectedCaptionStyle === 'minimal' ? 4 : 5,
          beat_markers: beatGrid,
          style_id: selectedCaptionStyle,
          brand_kit: brandKit
        })
      });
      const payload = await parseResponseJson(response);
      setCaptionPlan(Array.isArray(payload.captions) ? payload.captions : []);
    } catch (error) {
      setCaptionPlanError(error.message || 'Failed to generate caption plan.');
    } finally {
      setCaptionPlanLoading(false);
    }
  };

  const loadMusicLibrary = useCallback(async () => {
    setMusicLibraryLoading(true);
    setMusicLibraryError('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/video/music/library', tenantKey));
      const payload = await parseResponseJson(response);
      const tracks = Array.isArray(payload.tracks) ? payload.tracks : [];
      setMusicLibrary(tracks);
      if (tracks.length > 0) {
        setSelectedMusicTrackId((previous) => previous || tracks[0].id);
      }
    } catch (error) {
      setMusicLibraryError(error.message || 'Failed to load royalty-free music library.');
    } finally {
      setMusicLibraryLoading(false);
    }
  }, [tenantKey]);

  useEffect(() => {
    loadMusicLibrary();
  }, [loadMusicLibrary]);

  useEffect(() => {
    if (!selectedMusicTrack?.bpm) return;
    setBeatBpm(Number(selectedMusicTrack.bpm));
    if (selectedMusicTrack.mood) {
      setSelectedMusicMood(selectedMusicTrack.mood);
    }
  }, [selectedMusicTrack]);

  useEffect(() => {
    if (!selectedMusicMood || musicLibrary.length === 0) return;
    const moodMatch = musicLibrary.find((track) => track.mood === selectedMusicMood);
    if (moodMatch && moodMatch.id !== selectedMusicTrackId) {
      setSelectedMusicTrackId(moodMatch.id);
    }
  }, [selectedMusicMood, musicLibrary, selectedMusicTrackId]);

  const handleProductDragStart = (event, productId) => {
    event.dataTransfer.setData(DRAG_PRODUCT_MIME, productId);
    event.dataTransfer.setData('text/plain', `product:${productId}`);
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleCanvasLayerDragStart = (event, layerId) => {
    setCanvasDragLayerId(layerId);
    event.dataTransfer.setData('text/plain', `layer:${layerId}`);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleCanvasDrop = (event) => {
    event.preventDefault();
    const rect = canvasDropRef.current?.getBoundingClientRect();
    if (!rect) return;

    const xRatio = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
    const yRatio = clampNumber((event.clientY - rect.top) / rect.height, 0, 1);
    const droppedProductId = event.dataTransfer.getData(DRAG_PRODUCT_MIME);
    const droppedPlain = event.dataTransfer.getData('text/plain');

    if (droppedProductId) {
      setSelectedProductId(droppedProductId);
      setCanvasLayers((previous) => {
        const layer = previous.product;
        return {
          ...previous,
          product: {
            ...layer,
            x: clampNumber(xRatio - (layer.width / 2), 0, 1 - layer.width),
            y: clampNumber(yRatio - (layer.height / 2), 0, 1 - layer.height)
          }
        };
      });
      const product = allProducts.find((entry) => entry.id === droppedProductId);
      setCanvasDropMessage(product ? `${product.name} dropped into canvas.` : 'Product dropped into canvas.');
      setTimeout(() => setCanvasDropMessage(''), 1800);
      return;
    }

    if (droppedPlain.startsWith('layer:')) {
      const layerId = droppedPlain.replace('layer:', '');
      setCanvasLayers((previous) => {
        const layer = previous[layerId];
        if (!layer) return previous;
        return {
          ...previous,
          [layerId]: {
            ...layer,
            x: clampNumber(xRatio - (layer.width / 2), 0, 1 - layer.width),
            y: clampNumber(yRatio - (layer.height / 2), 0, 1 - layer.height)
          }
        };
      });
    }
  };

  const handleCanvasDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const snapTimelineToBeats = () => {
    if (beatGrid.length === 0 || timelineSegments.length <= 1) return;
    setTimelineSegments((previous) => {
      const next = normalizeTimelineSegments(previous, timelineDurationSeconds).map((segment) => ({ ...segment }));
      for (let index = 0; index < next.length - 1; index += 1) {
        const current = next[index];
        const following = next[index + 1];
        const minBoundary = current.start + MIN_TIMELINE_SEGMENT_SECONDS;
        const maxBoundary = following.end - MIN_TIMELINE_SEGMENT_SECONDS;
        if (maxBoundary <= minBoundary) continue;
        const snappedBoundary = clampNumber(
          snapTimeToBeat(current.end, beatGrid),
          minBoundary,
          maxBoundary
        );
        current.end = Number(snappedBoundary.toFixed(3));
        following.start = Number(snappedBoundary.toFixed(3));
      }
      return next;
    });
  };

  const handleTimelineClipDragStart = (event, trackId, clipId) => {
    const payload = JSON.stringify({ trackId, clipId });
    event.dataTransfer.setData('application/json', payload);
    event.dataTransfer.setData('text/plain', `${trackId}:${clipId}`);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleTimelineTrackDrop = (event, targetTrackId) => {
    event.preventDefault();
    const payloadText = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain');
    if (!payloadText) return;

    let payload = null;
    try {
      payload = JSON.parse(payloadText);
    } catch (error) {
      const [trackId, clipId] = String(payloadText).split(':');
      payload = { trackId, clipId };
    }

    if (!payload?.trackId || !payload?.clipId) return;
    if (payload.trackId !== targetTrackId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const dropRatio = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
    const targetTime = Number((dropRatio * timelineDurationSeconds).toFixed(3));

    if (targetTrackId === 'video') {
      setTimelineSegments((previous) => {
        const next = normalizeTimelineSegments(previous, timelineDurationSeconds).map((segment) => ({ ...segment }));
        const index = next.findIndex((segment) => segment.id === payload.clipId);
        if (index < 0) return next;
        const clipDuration = next[index].end - next[index].start;
        const prevBoundary = index > 0 ? next[index - 1].end : 0;
        const nextBoundary = index < next.length - 1 ? next[index + 1].start : timelineDurationSeconds;
        const nextStart = clampNumber(
          targetTime - (clipDuration / 2),
          prevBoundary,
          Math.max(prevBoundary, nextBoundary - clipDuration)
        );
        next[index].start = Number(nextStart.toFixed(3));
        next[index].end = Number((nextStart + clipDuration).toFixed(3));
        return next;
      });
    }

    if (targetTrackId === 'captions') {
      setTimelineCaptionClips((previous) => {
        const next = [...previous];
        const index = next.findIndex((clip) => clip.id === payload.clipId);
        if (index < 0) return next;
        const clipDuration = next[index].end - next[index].start;
        const newStart = clampNumber(targetTime - (clipDuration / 2), 0, Math.max(0, timelineDurationSeconds - clipDuration));
        next[index] = {
          ...next[index],
          start: Number(newStart.toFixed(3)),
          end: Number((newStart + clipDuration).toFixed(3))
        };
        return next;
      });
    }

    if (targetTrackId === 'voice' && voiceTrackClip) {
      const clipDuration = voiceTrackClip.end - voiceTrackClip.start;
      const nextStart = clampNumber(targetTime - (clipDuration / 2), 0, Math.max(0, timelineDurationSeconds - clipDuration));
      setVoiceTrackOffset(Number(nextStart.toFixed(3)));
    }

    if (targetTrackId === 'music' && musicTrackClip) {
      const clipDuration = musicTrackClip.end - musicTrackClip.start;
      const nextStart = clampNumber(targetTime - (clipDuration / 2), 0, Math.max(0, timelineDurationSeconds - clipDuration));
      setMusicTrackOffset(Number(nextStart.toFixed(3)));
    }
  };

  const uploadVideoSource = async (file) => {
    if (!file) return;
    setVideoSourceUploadLoading(true);
    setVideoSourceUploadError('');
    try {
      const formData = new FormData();
      formData.append('video', file);
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/video/upload', tenantKey), {
        method: 'POST',
        body: formData
      });
      const payload = await parseResponseJson(response);
      setVideoSourceUpload(payload.video || null);
      setVideoSourceFileName(file.name);
    } catch (error) {
      setVideoSourceUploadError(error.message || 'Failed to upload timeline source video.');
    } finally {
      setVideoSourceUploadLoading(false);
    }
  };

  const handleVideoSourceFileSelect = async (event) => {
    const file = event.target.files?.[0] || null;
    await uploadVideoSource(file);
  };

  const uploadVoiceTrack = async (file, label) => {
    if (!file) return;
    setVoiceTrackLoading(true);
    setVoiceTrackError('');
    try {
      const formData = new FormData();
      formData.append('audio', file);
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/video/audio/upload', tenantKey), {
        method: 'POST',
        body: formData
      });
      const payload = await parseResponseJson(response);
      const audio = payload.audio || {};
      setVoiceTrackSource({
        ...audio,
        label: label || audio.filename || 'Voiceover'
      });
      setVoiceTrackUploadName(file.name || audio.filename || 'voice-track');
      setVoiceTrackOffset(0);
    } catch (error) {
      setVoiceTrackError(error.message || 'Failed to upload voice track.');
    } finally {
      setVoiceTrackLoading(false);
    }
  };

  const handleVoiceTrackFileSelect = async (event) => {
    const file = event.target.files?.[0] || null;
    await uploadVoiceTrack(file, 'Uploaded Voice');
  };

  const generateTtsVoiceover = async () => {
    if (!voiceScriptDraft.trim()) {
      setVoiceTrackError('Enter voice script text first.');
      return;
    }
    setTtsLoading(true);
    setVoiceTrackError('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/video/tts', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: voiceScriptDraft,
          language: voiceLanguage
        })
      });
      const payload = await parseResponseJson(response);
      const audio = payload.audio || {};
      setVoiceTrackSource({
        ...audio,
        label: `AI TTS (${audio.language || voiceLanguage})`
      });
      setVoiceTrackUploadName(audio.filename || 'tts-voice.mp3');
      setVoiceTrackOffset(0);
    } catch (error) {
      setVoiceTrackError(error.message || 'Failed to generate AI voiceover.');
    } finally {
      setTtsLoading(false);
    }
  };

  const startVoiceRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceTrackError('Browser does not support microphone recording in this environment.');
      return;
    }

    try {
      setVoiceTrackError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingActive(false);
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        const extension = mimeType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `recorded-voice.${extension}`, { type: mimeType });
        await uploadVoiceTrack(file, 'Recorded Voice');
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingActive(true);
    } catch (error) {
      setVoiceTrackError(error.message || 'Unable to access microphone.');
    }
  };

  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  };

  const renderVideoTimeline = async () => {
    if (!videoSourceUpload?.video_id) {
      setVideoRenderError('Upload a source video before rendering.');
      return;
    }

    const normalizedSegments = normalizeTimelineSegments(timelineSegments, timelineDurationSeconds).map((segment) => ({ ...segment }));
    if (beatSyncEnabled && beatGrid.length > 0 && normalizedSegments.length > 1) {
      for (let index = 0; index < normalizedSegments.length - 1; index += 1) {
        const current = normalizedSegments[index];
        const following = normalizedSegments[index + 1];
        const minBoundary = current.start + MIN_TIMELINE_SEGMENT_SECONDS;
        const maxBoundary = following.end - MIN_TIMELINE_SEGMENT_SECONDS;
        if (maxBoundary <= minBoundary) continue;
        const snappedBoundary = clampNumber(snapTimeToBeat(current.end, beatGrid), minBoundary, maxBoundary);
        current.end = Number(snappedBoundary.toFixed(3));
        following.start = Number(snappedBoundary.toFixed(3));
      }
    }

    const captionAnimation = CAPTION_STYLE_TO_ANIMATION[selectedCaptionStyle] || 'fade_up';
    const captionSource = timelineCaptionClips.length > 0
      ? timelineCaptionClips
      : captionPlan.map((entry) => ({
        id: `caption_${entry.id}`,
        text: entry.text,
        start: entry.start,
        end: entry.end
      }));
    const captionWidth = Math.round(canvasDimensions.width * 0.82);
    const captionHeight = Math.round(canvasDimensions.height * 0.12);
    const captionX = Math.round((canvasDimensions.width - captionWidth) / 2);
    const captionY = Math.round(canvasDimensions.height * 0.78);

    const payload = {
      store: tenantKey,
      product_name: selectedProduct?.name || 'product',
      filename: `${toSlug(selectedProduct?.name || 'product')}_${toSlug(selectedFormat.platformKey || 'video')}_${toSlug(variantSuffix || 'variant-a')}.mp4`,
      video_id: videoSourceUpload.video_id,
      video_ext: videoSourceUpload.ext || 'mp4',
      beat_sync_enabled: beatSyncEnabled,
      beat_markers: beatGrid,
      timeline_segments: normalizedSegments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        transition: segment.transition || 'fade',
        transition_duration: segment.transitionDuration ?? DEFAULT_TRANSITION_DURATION
      })),
      captions: captionSource.map((caption) => ({
        text: caption.text,
        start: clampNumber(caption.start, 0, timelineDurationSeconds),
        end: clampNumber(caption.end, 0, timelineDurationSeconds),
        x: captionX,
        y: captionY,
        width: captionWidth,
        height: captionHeight,
        font_size: Math.round(captionHeight * 0.32),
        bg_color: brandKit.primaryColor,
        text_color: '#ffffff',
        animation: captionAnimation,
        opacity: 0.84
      })),
      voiceover_audio_id: voiceTrackSource?.audio_id || undefined,
      voiceover_audio_ext: voiceTrackSource?.ext || undefined,
      music_audio_id: selectedMusicTrack?.audio_id || undefined,
      music_audio_ext: selectedMusicTrack?.audio_ext || undefined
    };

    setVideoRenderLoading(true);
    setVideoRenderError('');
    setVideoRenderResult(null);
    try {
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/video/render', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await parseResponseJson(response);
      setVideoRenderResult(result.render || null);
    } catch (error) {
      setVideoRenderError(error.message || 'Timeline render failed.');
    } finally {
      setVideoRenderLoading(false);
    }
  };

  const selectedTransitionOption = (transitionId) => (
    TRANSITION_OPTIONS.find((entry) => entry.id === transitionId)?.label || 'Fade'
  );

  const runBatchExport = async () => {
    if (!selectedProduct?.name) {
      setExportError('Select a product before export.');
      return;
    }

    setExportLoading(true);
    setExportError('');
    setExportedAssets([]);
    try {
      const response = await fetch(buildApiUrl('/creative-studio/creative-os/export/batch', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: tenantKey,
          product: selectedProduct,
          caption: captionDraft,
          template_name: selectedTemplate.name,
          brand_kit: brandKit,
          format_ids: exportTargets,
          variant_suffix: variantSuffix
        })
      });
      const payload = await parseResponseJson(response);
      setExportedAssets(Array.isArray(payload.assets) ? payload.assets : []);
    } catch (error) {
      setExportError(error.message || 'Failed to generate export pack.');
    } finally {
      setExportLoading(false);
    }
  };

  const saveWorkspacePreset = async () => {
    if (!selectedProduct?.name) {
      setSavePresetMessage('Select a product before saving a preset.');
      return;
    }
    setSavePresetLoading(true);
    setSavePresetMessage('');
    try {
      const response = await fetch(buildApiUrl('/creative-studio/templates', tenantKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${selectedProduct.name} ${selectedTemplate.name}`,
          layout: selectedTemplate.id,
          is_default: false,
          style: {
            format: selectedFormatId,
            template: selectedTemplateId,
            brandKit,
            captionDirection,
            captionDraft
          }
        })
      });
      await parseResponseJson(response);
      setSavePresetMessage('Workspace preset saved.');
    } catch (error) {
      setSavePresetMessage(error.message || 'Failed to save preset.');
    } finally {
      setSavePresetLoading(false);
    }
  };

  const toggleIntegration = (integrationId) => {
    void integrationId;
    setProductHubMessage('Integrations are synced from backend data. Use Sync Catalog to refresh status.');
  };

  const toggleExportTarget = (targetId) => {
    setExportTargets((previous) => {
      if (previous.includes(targetId)) {
        if (previous.length === 1) {
          return previous;
        }
        return previous.filter((id) => id !== targetId);
      }
      return [...previous, targetId];
    });
  };

  return (
    <div className="creative-os-root p-5 md:p-6 lg:p-8">
      <div className="creative-os-glow" aria-hidden="true" />
      <div className="creative-os-grid" aria-hidden="true" />

      <div className="relative z-10 space-y-6">
        <header className="creative-os-panel">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Creative Studio / Creative OS</p>
              <h2 className="creative-os-heading mt-2 text-2xl font-semibold text-slate-900 md:text-3xl">
                End-to-end e-commerce ad production in one premium workflow
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 md:text-base">
                Built for multi-tenant teams. One workspace replaces Canva, CapCut, Photoroom, and scattered export tools with connected modules and ad-native outputs.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="creative-os-pill">
                  <CheckCircle size={14} />
                  Tenant: {tenantKey}
                </span>
                <span className="creative-os-pill">
                  <Sparkles size={14} />
                  Brand Kit Lock: {brandKit.enforceAcrossAssets ? 'Enabled' : 'Optional'}
                </span>
                <span className="creative-os-pill">
                  <Activity size={14} />
                  Active Module: {activeModule.title}
                </span>
                <span className="creative-os-pill">
                  <RefreshCw size={14} />
                  Catalog: {catalogLoading ? 'Syncing' : `${catalogProducts.length} products`}
                </span>
              </div>
            </div>

            <div className="grid min-w-[270px] grid-cols-2 gap-3 self-stretch">
              <div className="creative-os-metric">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Connected Catalogs</p>
                <p className="creative-os-heading mt-1 text-xl font-semibold text-slate-900">{connectedIntegrationCount}/3</p>
              </div>
              <div className="creative-os-metric">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Live Export Targets</p>
                <p className="creative-os-heading mt-1 text-xl font-semibold text-slate-900">{exportTargets.length}</p>
              </div>
              <div className="creative-os-metric">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Video Variants</p>
                <p className="creative-os-heading mt-1 text-xl font-semibold text-slate-900">{variantCount}</p>
              </div>
              <div className="creative-os-metric">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Primary Canvas</p>
                <p className="creative-os-heading mt-1 text-xl font-semibold text-slate-900">{selectedFormat.ratio}</p>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="creative-os-panel">
              <div className="mb-3 flex items-center gap-2 text-slate-700">
                <Layers size={16} />
                <h3 className="creative-os-heading text-sm font-semibold uppercase tracking-[0.14em]">Workspace Modules</h3>
              </div>

              <div className="space-y-2">
                {CREATIVE_MODULES.map((module) => (
                  <ModuleButton
                    key={module.id}
                    module={module}
                    isActive={module.id === activeModuleId}
                    onClick={() => activateModule(module.id)}
                  />
                ))}
              </div>
            </div>

            <div className="creative-os-panel">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-slate-700">
                  <Briefcase size={16} />
                  <h3 className="creative-os-heading text-sm font-semibold uppercase tracking-[0.14em]">Product Hub</h3>
                </div>
                <button
                  type="button"
                  onClick={loadCatalog}
                  disabled={catalogLoading}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                >
                  {catalogLoading ? 'Syncing…' : 'Sync'}
                </button>
              </div>

              <div className="space-y-2">
                {CATALOG_INTEGRATIONS.map((integration) => {
                  const connected = integrationState[integration.id];
                  return (
                    <button
                      key={integration.id}
                      type="button"
                      onClick={() => toggleIntegration(integration.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                        connected ? 'border-teal-400 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="creative-os-heading text-sm font-semibold text-slate-900">{integration.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${connected ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                          {connected ? 'Connected' : 'Not Connected'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Collection</p>
                <div className="flex flex-wrap gap-2">
                  {PRODUCT_COLLECTIONS.map((collection) => (
                    <ToggleChip
                      key={collection.id}
                      selected={selectedCollectionId === collection.id}
                      onClick={() => setSelectedCollectionId(collection.id)}
                    >
                      {collection.name}
                    </ToggleChip>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setDynamicPriceSync((previous) => !previous)}
                  className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                    dynamicPriceSync ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <RefreshCw size={13} />
                  Dynamic Price Tags: {dynamicPriceSync ? 'Live Sync' : 'Manual'}
                </button>
              </div>

              <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                {visibleProducts.map((product) => (
                  <button
                    key={`hub-${product.id}`}
                    type="button"
                    draggable
                    onDragStart={(event) => handleProductDragStart(event, product.id)}
                    onClick={() => setSelectedProductId(product.id)}
                    className={`w-full rounded-xl border p-2 text-left transition ${
                      selectedProductId === product.id ? 'border-teal-400 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-900">{product.name}</p>
                    <p className="text-[11px] text-slate-500">{formatCurrency(product.price, product.currency)}</p>
                  </button>
                ))}
              </div>
              {catalogError && <p className="mt-2 text-xs text-rose-600">{catalogError}</p>}
              {productHubMessage && <p className="mt-2 text-xs text-teal-700">{productHubMessage}</p>}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setActiveModuleId('design_studio')}
                  className="creative-os-action-btn"
                >
                  <Palette size={14} />
                  Use In Design
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModuleId('video_studio')}
                  className="creative-os-action-btn"
                >
                  <Film size={14} />
                  Use In Video
                </button>
              </div>
            </div>

            <div className="creative-os-panel">
              <div className="mb-3 flex items-center gap-2 text-slate-700">
                <Star size={16} />
                <h3 className="creative-os-heading text-sm font-semibold uppercase tracking-[0.14em]">Brand Kit</h3>
              </div>
              <p className="text-xs text-slate-500">Logo, palette, and font are applied across design, video captions, and exports.</p>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-slate-500">
                  Primary
                  <input
                    type="color"
                    value={brandKit.primaryColor}
                    onChange={(event) => setBrandKit((previous) => ({ ...previous, primaryColor: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200"
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Accent
                  <input
                    type="color"
                    value={brandKit.accentColor}
                    onChange={(event) => setBrandKit((previous) => ({ ...previous, accentColor: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-200"
                  />
                </label>
              </div>

              <label className="mt-3 block text-xs text-slate-500">
                Font
                <select
                  value={brandKit.font}
                  onChange={(event) => setBrandKit((previous) => ({ ...previous, font: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                >
                  {BRAND_FONT_OPTIONS.map((fontOption) => (
                    <option key={fontOption.id} value={fontOption.id}>{fontOption.label}</option>
                  ))}
                </select>
              </label>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={extractBrandLogoFromStore}
                  disabled={brandKitLogoLoading}
                  className="creative-os-action-btn"
                >
                  <Sparkles size={14} />
                  {brandKitLogoLoading ? 'Extracting…' : 'Extract Logo'}
                </button>
                <label className="creative-os-action-btn">
                  <Upload size={14} />
                  Upload Logo
                  <input type="file" accept="image/*" onChange={handleBrandLogoSelect} className="hidden" />
                </label>
                <button
                  type="button"
                  onClick={() => setBrandKit((previous) => ({ ...previous, logoUrl: '' }))}
                  className="creative-os-action-btn"
                >
                  <X size={14} />
                  Clear
                </button>
              </div>

              {brandKit.logoUrl && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Active Logo</p>
                  <img src={brandKit.logoUrl} alt="Brand kit logo" className="mt-2 h-16 w-40 rounded-lg object-contain" />
                </div>
              )}
              {brandKitLogoError && <p className="mt-2 text-xs text-rose-600">{brandKitLogoError}</p>}
            </div>

            <div className="creative-os-panel">
              <h3 className="creative-os-heading text-sm font-semibold uppercase tracking-[0.14em] text-slate-700">
                Session Checklist
              </h3>
              <ul className="mt-4 space-y-3 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <CheckCircle size={15} className="mt-0.5 text-teal-600" />
                  Product and pricing sync validated for tenant {tenantKey}.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle size={15} className="mt-0.5 text-teal-600" />
                  Brand kit typography and color tokens locked for all variants.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle size={15} className="mt-0.5 text-teal-600" />
                  Safe zones visible before batch export is triggered.
                </li>
              </ul>
            </div>
          </aside>

          <div>
            <div>
                {activeModuleId === 'design_studio' && (
                  <div className="space-y-4">
                    <SectionCard
                      title="Design Studio"
                      helper="Drag-and-drop editor purpose-built for ad creative speed, with tenant-safe brand consistency."
                      icon={Palette}
                    >
                      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <div className="space-y-4">
                          <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Ad Native Canvas Sizes</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {AD_FORMAT_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => setSelectedFormatId(preset.id)}
                                  className={`creative-os-select-btn ${selectedFormatId === preset.id ? 'active' : ''}`}
                                >
                                  <span className="creative-os-heading text-sm font-semibold text-slate-900">{preset.name}</span>
                                  <span className="text-xs text-slate-500">{preset.ratio} • {preset.platform}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Template Library</p>
                            <div className="flex flex-wrap gap-2">
                              {DESIGN_TEMPLATES.map((template) => (
                                <ToggleChip
                                  key={template.id}
                                  selected={selectedTemplateId === template.id}
                                  onClick={() => setSelectedTemplateId(template.id)}
                                >
                                  {template.name}
                                </ToggleChip>
                              ))}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">{selectedTemplate.note}</p>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Product URL Import</p>
                            <div className="flex flex-wrap gap-2">
                              <input
                                type="text"
                                value={productUrlDraft}
                                onChange={(event) => setProductUrlDraft(event.target.value)}
                                placeholder="Paste product URL to auto-pull image/title/price"
                                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none ring-teal-200 transition focus:border-teal-400 focus:ring"
                              />
                              <button
                                type="button"
                                onClick={importProductFromUrl}
                                disabled={importLoading}
                                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                              >
                                <Upload size={15} />
                                {importLoading ? 'Importing...' : 'Import'}
                              </button>
                            </div>
                            {importError && <p className="mt-2 text-xs text-rose-600">{importError}</p>}
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Brand Kit Pro</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="text-xs text-slate-500">
                                Primary color
                                <input
                                  type="color"
                                  value={brandKit.primaryColor}
                                  onChange={(event) => setBrandKit((previous) => ({ ...previous, primaryColor: event.target.value }))}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-200"
                                />
                              </label>
                              <label className="text-xs text-slate-500">
                                Accent color
                                <input
                                  type="color"
                                  value={brandKit.accentColor}
                                  onChange={(event) => setBrandKit((previous) => ({ ...previous, accentColor: event.target.value }))}
                                  className="mt-1 h-10 w-full rounded-lg border border-slate-200"
                                />
                              </label>
                              <label className="text-xs text-slate-500 sm:col-span-2">
                                Brand font
                                <select
                                  value={brandKit.font}
                                  onChange={(event) => setBrandKit((previous) => ({ ...previous, font: event.target.value }))}
                                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                >
                                  {BRAND_FONT_OPTIONS.map((fontOption) => (
                                    <option key={fontOption.id} value={fontOption.id}>{fontOption.label}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <button
                              type="button"
                              onClick={() => setBrandKit((previous) => ({ ...previous, enforceAcrossAssets: !previous.enforceAcrossAssets }))}
                              className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                                brandKit.enforceAcrossAssets
                                  ? 'bg-teal-100 text-teal-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              <Settings size={13} />
                              Brand Kit Enforcement: {brandKit.enforceAcrossAssets ? 'On' : 'Off'}
                            </button>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Non-LLM Style Extractor (CV)</p>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleStyleImageSelect}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600"
                            />
                            {styleImageName && <p className="mt-2 text-xs text-slate-500">Selected: {styleImageName}</p>}
                            <button
                              type="button"
                              onClick={runStyleExtraction}
                              disabled={!styleImageFile || styleExtractLoading}
                              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Sparkles size={13} />
                              {styleExtractLoading ? 'Extracting...' : 'Extract Palette'}
                            </button>
                            {styleExtractError && <p className="mt-2 text-xs text-rose-600">{styleExtractError}</p>}
                            {stylePalette.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {stylePalette.map((entry) => (
                                  <span
                                    key={entry.hex}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-600"
                                  >
                                    <span className="h-3 w-3 rounded-full border border-slate-200" style={{ backgroundColor: entry.hex }} />
                                    {entry.hex}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Non-LLM Image Pipeline (RMBG2 + Scene Composer)</p>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleDesignImageSelect}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600"
                            />
                            {designImageName && <p className="mt-2 text-xs text-slate-500">Selected: {designImageName}</p>}

                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              <label className="text-xs text-slate-500">
                                Scene preset
                                <select
                                  value={scenePresetId}
                                  onChange={(event) => setScenePresetId(event.target.value)}
                                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                >
                                  {DESIGN_SCENE_PRESETS.map((preset) => (
                                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                                  ))}
                                </select>
                              </label>
                              <button
                                type="button"
                                onClick={runDesignImagePipeline}
                                disabled={!designImageFile || designPipelineLoading}
                                className="self-end rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {designPipelineLoading ? 'Processing...' : 'Run Image Pipeline'}
                              </button>
                            </div>

                            {designPipelineError && <p className="mt-2 text-xs text-rose-600">{designPipelineError}</p>}

                            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                              {designImagePreviewUrl && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Input</p>
                                  <img src={designImagePreviewUrl} alt="Pipeline input" className="mt-2 h-32 w-full rounded-lg object-cover" />
                                </div>
                              )}
                              {designPipelineResult?.cutout_asset?.download_url && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Cutout</p>
                                  <img
                                    src={toInlineAssetUrl(designPipelineResult.cutout_asset.download_url)}
                                    alt="Pipeline cutout"
                                    className="mt-2 h-32 w-full rounded-lg object-cover"
                                  />
                                </div>
                              )}
                              {designPipelineResult?.output_asset?.download_url && (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Output</p>
                                  <img
                                    src={toInlineAssetUrl(designPipelineResult.output_asset.download_url)}
                                    alt="Pipeline output"
                                    className="mt-2 h-32 w-full rounded-lg object-cover"
                                  />
                                  <a
                                    href={designPipelineResult.output_asset.download_url}
                                    className="mt-2 inline-flex text-[11px] font-semibold text-teal-700 hover:text-teal-800"
                                  >
                                    Download output
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Drag Product To Canvas</p>
                            <p className="text-xs text-slate-500">Drag any product card into the canvas to bind image, title, and live price.</p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {visibleProducts.slice(0, 6).map((product) => (
                                <button
                                  key={`design-drag-${product.id}`}
                                  type="button"
                                  draggable
                                  onDragStart={(event) => handleProductDragStart(event, product.id)}
                                  onClick={() => setSelectedProductId(product.id)}
                                  className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                                    selectedProductId === product.id
                                      ? 'border-teal-400 bg-teal-50'
                                      : 'border-slate-200 bg-white hover:border-slate-300'
                                  }`}
                                >
                                  <span className="block font-semibold text-slate-900">{product.name}</span>
                                  <span className="text-slate-500">{formatCurrency(product.price, product.currency)}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="creative-os-preview-card">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Live Canvas Preview</p>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{selectedFormat.name} {selectedFormat.ratio}</span>
                            </div>
                            <div
                              ref={canvasDropRef}
                              onDragOver={handleCanvasDragOver}
                              onDrop={handleCanvasDrop}
                              className={`creative-os-canvas-shell mt-3 ${canvasDragLayerId ? 'is-layer-dragging' : ''}`}
                              style={{ borderColor: brandKit.primaryColor }}
                            >
                              <div
                                className={`creative-os-canvas-stage bg-gradient-to-br ${selectedProduct?.gradient || 'from-slate-100 to-white'}`}
                                style={{ aspectRatio: `${canvasDimensions.width}/${canvasDimensions.height}` }}
                              >
                                <div className="creative-os-canvas-safe-zone" />
                                {brandKit.logoUrl && (
                                  <div className="creative-os-canvas-logo">
                                    <img src={brandKit.logoUrl} alt="Brand logo" className="h-full w-full object-contain" />
                                  </div>
                                )}

                                {canvasLayers.product.visible && (
                                  <div
                                    draggable
                                    onDragStart={(event) => handleCanvasLayerDragStart(event, 'product')}
                                    onDragEnd={() => setCanvasDragLayerId('')}
                                    className={`creative-os-canvas-layer product ${canvasDragLayerId === 'product' ? 'is-dragging' : ''}`}
                                    style={{
                                      left: `${canvasLayers.product.x * 100}%`,
                                      top: `${canvasLayers.product.y * 100}%`,
                                      width: `${canvasLayers.product.width * 100}%`,
                                      height: `${canvasLayers.product.height * 100}%`
                                    }}
                                  >
                                    {selectedProduct?.image_url ? (
                                      <img
                                        src={selectedProduct.image_url}
                                        alt={selectedProduct.name}
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center rounded-xl bg-white/70 text-xs font-semibold text-slate-700">
                                        {selectedProduct?.name || 'Drop product'}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {canvasLayers.headline.visible && (
                                  <div
                                    draggable
                                    onDragStart={(event) => handleCanvasLayerDragStart(event, 'headline')}
                                    onDragEnd={() => setCanvasDragLayerId('')}
                                    className={`creative-os-canvas-layer headline ${canvasDragLayerId === 'headline' ? 'is-dragging' : ''}`}
                                    style={{
                                      left: `${canvasLayers.headline.x * 100}%`,
                                      top: `${canvasLayers.headline.y * 100}%`,
                                      width: `${canvasLayers.headline.width * 100}%`,
                                      height: `${canvasLayers.headline.height * 100}%`
                                    }}
                                  >
                                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{selectedTemplate.name}</p>
                                    <h4 className="creative-os-heading mt-1 text-sm font-semibold text-slate-900">{selectedProduct?.name || 'Select product'}</h4>
                                    <p className="mt-1 text-[11px] text-slate-600 line-clamp-3">{selectedProduct?.blurb || 'Drag product card onto canvas.'}</p>
                                  </div>
                                )}

                                {canvasLayers.price.visible && (
                                  <div
                                    draggable
                                    onDragStart={(event) => handleCanvasLayerDragStart(event, 'price')}
                                    onDragEnd={() => setCanvasDragLayerId('')}
                                    className={`creative-os-canvas-layer price ${canvasDragLayerId === 'price' ? 'is-dragging' : ''}`}
                                    style={{
                                      left: `${canvasLayers.price.x * 100}%`,
                                      top: `${canvasLayers.price.y * 100}%`,
                                      width: `${canvasLayers.price.width * 100}%`,
                                      height: `${canvasLayers.price.height * 100}%`,
                                      backgroundColor: brandKit.primaryColor
                                    }}
                                  >
                                    {selectedProduct?.price ? formatCurrency(selectedProduct.price, selectedProduct.currency) : 'Price Pending'}
                                  </div>
                                )}

                                {canvasLayers.cta.visible && (
                                  <div
                                    draggable
                                    onDragStart={(event) => handleCanvasLayerDragStart(event, 'cta')}
                                    onDragEnd={() => setCanvasDragLayerId('')}
                                    className={`creative-os-canvas-layer cta ${canvasDragLayerId === 'cta' ? 'is-dragging' : ''}`}
                                    style={{
                                      left: `${canvasLayers.cta.x * 100}%`,
                                      top: `${canvasLayers.cta.y * 100}%`,
                                      width: `${canvasLayers.cta.width * 100}%`,
                                      height: `${canvasLayers.cta.height * 100}%`,
                                      color: brandKit.accentColor
                                    }}
                                  >
                                    Shop Now
                                  </div>
                                )}
                              </div>
                            </div>
                            {canvasDropMessage && <p className="mt-2 text-xs text-teal-700">{canvasDropMessage}</p>}
                            <p className="mt-2 text-[11px] text-slate-500">Drag product cards and layers directly on canvas. Price badge stays live with catalog sync.</p>

                            <div className="mt-4">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Arabic / RTL Engine</p>
                              <div className="flex gap-2">
                                <ToggleChip selected={captionDirection === 'ltr'} onClick={() => setCaptionDirection('ltr')}>LTR</ToggleChip>
                                <ToggleChip selected={captionDirection === 'rtl'} onClick={() => setCaptionDirection('rtl')}>RTL</ToggleChip>
                              </div>
                              <textarea
                                dir={captionDirection}
                                value={captionDraft}
                                onChange={(event) => setCaptionDraft(event.target.value)}
                                className="mt-3 h-24 w-full rounded-xl border border-slate-200 p-3 text-sm text-slate-700"
                              />
                            </div>

                            <div className="mt-4 grid gap-2 sm:grid-cols-3">
                              <button
                                type="button"
                                onClick={() => setDesignAutomation((previous) => ({ ...previous, backgroundRemoval: !previous.backgroundRemoval }))}
                                className={`creative-os-automation-btn ${designAutomation.backgroundRemoval ? 'active' : ''}`}
                              >
                                <Camera size={14} />
                                Background Removal
                              </button>
                              <button
                                type="button"
                                onClick={() => setDesignAutomation((previous) => ({ ...previous, aiScenePlacement: !previous.aiScenePlacement }))}
                                className={`creative-os-automation-btn ${designAutomation.aiScenePlacement ? 'active' : ''}`}
                              >
                                <Sparkles size={14} />
                                AI Scene Placement
                              </button>
                              <button
                                type="button"
                                onClick={() => setDesignAutomation((previous) => ({ ...previous, smartResize: !previous.smartResize }))}
                                className={`creative-os-automation-btn ${designAutomation.smartResize ? 'active' : ''}`}
                              >
                                <RefreshCw size={14} />
                                Smart Resize
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </SectionCard>
                  </div>
                )}

                {activeModuleId === 'video_studio' && (
                  <div className="space-y-4">
                    <SectionCard
                      title="Video Studio"
                      helper="Multi-track ad timeline with real caption burn-in, voiceover stack, music library, and beat-synced transitions."
                      icon={Film}
                    >
                      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Timeline Source Video</p>
                            <input
                              type="file"
                              accept="video/*"
                              onChange={handleVideoSourceFileSelect}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600"
                            />
                            {videoSourceFileName && <p className="mt-2 text-xs text-slate-500">Selected: {videoSourceFileName}</p>}
                            {videoSourceUpload && (
                              <p className="mt-2 text-xs text-teal-700">
                                Uploaded: {videoSourceUpload.filename} • {formatSeconds(videoSourceUpload.duration)} • {videoSourceUpload.width}x{videoSourceUpload.height}
                              </p>
                            )}
                            {videoSourceUploadError && <p className="mt-2 text-xs text-rose-600">{videoSourceUploadError}</p>}
                            {videoSourceUploadLoading && <p className="mt-2 text-xs text-slate-500">Uploading source video...</p>}
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Multi-Track Timeline Editor</p>
                              <button
                                type="button"
                                onClick={snapTimelineToBeats}
                                disabled={beatGrid.length === 0}
                                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Snap Segments To Beats
                              </button>
                            </div>
                            <p className="text-xs text-slate-500">Drag clips horizontally inside each row. Video segments drive transition rendering in export.</p>

                            <div className="creative-os-timeline-ruler mt-3">
                              <div className="flex justify-between text-[10px] text-slate-500">
                                <span>0s</span>
                                <span>{formatSeconds(timelineDurationSeconds / 2)}</span>
                                <span>{formatSeconds(timelineDurationSeconds)}</span>
                              </div>
                            </div>

                            <div className="mt-3 space-y-2">
                              <div
                                className="creative-os-track-row"
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleTimelineTrackDrop(event, 'video')}
                              >
                                <span className="creative-os-track-label">Video</span>
                                <div className="creative-os-track-lane">
                                  {timelineSegments.map((segment) => {
                                    const left = (segment.start / timelineDurationSeconds) * 100;
                                    const width = ((segment.end - segment.start) / timelineDurationSeconds) * 100;
                                    return (
                                      <button
                                        key={segment.id}
                                        type="button"
                                        draggable
                                        onDragStart={(event) => handleTimelineClipDragStart(event, 'video', segment.id)}
                                        onClick={() => setActiveVideoStageId(segment.stageId)}
                                        className={`creative-os-track-clip video ${activeVideoStageId === segment.stageId ? 'active' : ''}`}
                                        style={{ left: `${left}%`, width: `${width}%` }}
                                      >
                                        {segment.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div
                                className="creative-os-track-row"
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleTimelineTrackDrop(event, 'captions')}
                              >
                                <span className="creative-os-track-label">Captions</span>
                                <div className="creative-os-track-lane">
                                  {timelineCaptionClips.map((caption) => {
                                    const left = (caption.start / timelineDurationSeconds) * 100;
                                    const width = ((caption.end - caption.start) / timelineDurationSeconds) * 100;
                                    return (
                                      <button
                                        key={caption.id}
                                        type="button"
                                        draggable
                                        onDragStart={(event) => handleTimelineClipDragStart(event, 'captions', caption.id)}
                                        className="creative-os-track-clip captions"
                                        style={{ left: `${left}%`, width: `${Math.max(width, 4)}%` }}
                                      >
                                        {caption.text}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div
                                className="creative-os-track-row"
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleTimelineTrackDrop(event, 'voice')}
                              >
                                <span className="creative-os-track-label">Voice</span>
                                <div className="creative-os-track-lane">
                                  {voiceTrackClip && (
                                    <button
                                      type="button"
                                      draggable
                                      onDragStart={(event) => handleTimelineClipDragStart(event, 'voice', voiceTrackClip.id)}
                                      className="creative-os-track-clip voice"
                                      style={{
                                        left: `${(voiceTrackClip.start / timelineDurationSeconds) * 100}%`,
                                        width: `${((voiceTrackClip.end - voiceTrackClip.start) / timelineDurationSeconds) * 100}%`
                                      }}
                                    >
                                      {voiceTrackClip.label}
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div
                                className="creative-os-track-row"
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => handleTimelineTrackDrop(event, 'music')}
                              >
                                <span className="creative-os-track-label">Music</span>
                                <div className="creative-os-track-lane">
                                  {musicTrackClip && (
                                    <button
                                      type="button"
                                      draggable
                                      onDragStart={(event) => handleTimelineClipDragStart(event, 'music', musicTrackClip.id)}
                                      className="creative-os-track-clip music"
                                      style={{
                                        left: `${(musicTrackClip.start / timelineDurationSeconds) * 100}%`,
                                        width: `${((musicTrackClip.end - musicTrackClip.start) / timelineDurationSeconds) * 100}%`
                                      }}
                                    >
                                      {musicTrackClip.label}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 max-h-36 space-y-2 overflow-auto pr-1">
                              {timelineSegments.map((segment, index) => (
                                <div key={`segment-edit-${segment.id}`} className="grid items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 md:grid-cols-[1fr_150px_120px]">
                                  <p className="text-xs text-slate-700">
                                    <span className="font-semibold">{segment.label}</span> • {formatSeconds(segment.start)} → {formatSeconds(segment.end)}
                                  </p>
                                  <select
                                    value={segment.transition || 'fade'}
                                    onChange={(event) => {
                                      const transition = event.target.value;
                                      setTimelineSegments((previous) => previous.map((entry, entryIndex) => (
                                        entryIndex === index ? { ...entry, transition } : entry
                                      )));
                                    }}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                  >
                                    {TRANSITION_OPTIONS.map((option) => (
                                      <option key={option.id} value={option.id}>{option.label}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min={MIN_TRANSITION_DURATION}
                                    max={MAX_TRANSITION_DURATION}
                                    value={segment.transitionDuration ?? DEFAULT_TRANSITION_DURATION}
                                    onChange={(event) => {
                                      const transitionDuration = clampNumber(event.target.value, MIN_TRANSITION_DURATION, MAX_TRANSITION_DURATION);
                                      setTimelineSegments((previous) => previous.map((entry, entryIndex) => (
                                        entryIndex === index ? { ...entry, transitionDuration } : entry
                                      )));
                                    }}
                                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Auto Captions + Voiceover Stack</p>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <p className="mb-2 text-xs font-semibold text-slate-500">Caption style</p>
                                <div className="space-y-2">
                                  {CAPTION_STYLES.map((style) => (
                                    <button
                                      key={style.id}
                                      type="button"
                                      onClick={() => setSelectedCaptionStyle(style.id)}
                                      className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                                        selectedCaptionStyle === style.id
                                          ? 'border-teal-400 bg-teal-50'
                                          : 'border-slate-200 hover:border-slate-300'
                                      }`}
                                    >
                                      <span className="block font-semibold text-slate-900">{style.label}</span>
                                      <span className="text-slate-500">{style.detail}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="mb-2 text-xs font-semibold text-slate-500">Voice mode</p>
                                <div className="space-y-2">
                                  {VIDEO_VOICE_OPTIONS.map((voiceOption) => (
                                    <button
                                      key={voiceOption.id}
                                      type="button"
                                      onClick={() => setSelectedVoiceMode(voiceOption.id)}
                                      className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                                        selectedVoiceMode === voiceOption.id
                                          ? 'border-teal-400 bg-teal-50'
                                          : 'border-slate-200 hover:border-slate-300'
                                      }`}
                                    >
                                      <span className="block font-semibold text-slate-900">{voiceOption.label}</span>
                                      <span className="text-slate-500">{voiceOption.detail}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setBeatSyncEnabled((previous) => !previous)}
                                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                                  beatSyncEnabled ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                <Zap size={13} />
                                Beat Sync: {beatSyncEnabled ? 'On' : 'Off'}
                              </button>

                              <select
                                value={selectedMusicMood}
                                onChange={(event) => setSelectedMusicMood(event.target.value)}
                                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                {MUSIC_MOODS.map((mood) => (
                                  <option key={mood.id} value={mood.id}>{mood.label}</option>
                                ))}
                              </select>
                            </div>

                            <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                              <textarea
                                value={voiceScriptDraft}
                                onChange={(event) => setVoiceScriptDraft(event.target.value)}
                                placeholder="Voiceover script for AI TTS"
                                className="h-20 w-full rounded-xl border border-slate-200 p-2 text-xs text-slate-700"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <select
                                  value={voiceLanguage}
                                  onChange={(event) => setVoiceLanguage(event.target.value)}
                                  className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                                >
                                  <option value="en">English</option>
                                  <option value="en-US">English (US)</option>
                                  <option value="ar">Arabic</option>
                                  <option value="ar-SA">Arabic (Saudi)</option>
                                  <option value="ar-EG">Arabic (Egypt)</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={generateTtsVoiceover}
                                  disabled={ttsLoading}
                                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {ttsLoading ? 'Generating TTS...' : 'Generate AI Voice'}
                                </button>
                                <button
                                  type="button"
                                  onClick={recordingActive ? stopVoiceRecording : startVoiceRecording}
                                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                    recordingActive ? 'bg-rose-100 text-rose-700' : 'bg-teal-100 text-teal-700'
                                  }`}
                                >
                                  {recordingActive ? 'Stop Recording' : 'Record Voice'}
                                </button>
                                <label className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                                  Upload Voice
                                  <input type="file" accept="audio/*" onChange={handleVoiceTrackFileSelect} className="hidden" />
                                </label>
                              </div>
                              {voiceTrackUploadName && <p className="text-xs text-slate-500">Voice track: {voiceTrackUploadName}</p>}
                              {voiceTrackSource?.audio_id && (
                                <audio controls src={toInlineAssetUrl(buildApiUrl(`/creative-studio/creative-os/video/audio/download?audio_id=${encodeURIComponent(voiceTrackSource.audio_id)}&ext=${encodeURIComponent(voiceTrackSource.ext || 'mp3')}`, tenantKey))} className="h-8 w-full" />
                              )}
                              {voiceTrackError && <p className="text-xs text-rose-600">{voiceTrackError}</p>}
                              {voiceTrackLoading && <p className="text-xs text-slate-500">Uploading voice track...</p>}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Royalty-Free Music Library</p>
                              <button
                                type="button"
                                onClick={loadMusicLibrary}
                                disabled={musicLibraryLoading}
                                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
                              >
                                {musicLibraryLoading ? 'Refreshing...' : 'Refresh'}
                              </button>
                            </div>
                            {musicLibraryError && <p className="mb-2 text-xs text-rose-600">{musicLibraryError}</p>}
                            <div className="space-y-2">
                              {musicLibrary.map((track) => (
                                <div
                                  key={track.id}
                                  className={`rounded-xl border p-2 ${selectedMusicTrackId === track.id ? 'border-teal-400 bg-teal-50' : 'border-slate-200 bg-white'}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-semibold text-slate-900">{track.title}</p>
                                      <p className="text-[11px] text-slate-500">{track.license} • {track.bpm} BPM</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedMusicTrackId(track.id)}
                                      className="rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white"
                                    >
                                      {selectedMusicTrackId === track.id ? 'Selected' : 'Use'}
                                    </button>
                                  </div>
                                  <audio controls src={track.preview_url} className="mt-2 h-8 w-full" />
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Advanced Timing + Copy Generation</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="text-xs text-slate-500">
                                Beat BPM
                                <input
                                  type="number"
                                  min={60}
                                  max={220}
                                  value={beatBpm}
                                  onChange={(event) => setBeatBpm(Number(event.target.value) || 120)}
                                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                />
                              </label>
                              <button
                                type="button"
                                onClick={generateBeatGrid}
                                disabled={beatGridLoading}
                                className="self-end rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {beatGridLoading ? 'Mapping beats...' : 'Generate Beat Grid'}
                              </button>
                            </div>
                            {beatGridError && <p className="mt-2 text-xs text-rose-600">{beatGridError}</p>}
                            {beatGrid.length > 0 && (
                              <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                Beats: {beatGrid.map((beat) => `${beat}s`).join(', ')}
                              </div>
                            )}

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={generateHooks}
                                disabled={hooksLoading}
                                className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {hooksLoading ? 'Generating hooks...' : 'Generate Hooks'}
                              </button>
                              <button
                                type="button"
                                onClick={generateScript}
                                disabled={scriptLoading}
                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {scriptLoading ? 'Generating script...' : 'Generate Script'}
                              </button>
                              <button
                                type="button"
                                onClick={generateCaptionPlan}
                                disabled={captionPlanLoading}
                                className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {captionPlanLoading ? 'Planning captions...' : 'Generate Caption Plan'}
                              </button>
                            </div>
                            {videoWorkflowError && <p className="mt-2 text-xs text-rose-600">{videoWorkflowError}</p>}
                            {captionPlanError && <p className="mt-2 text-xs text-rose-600">{captionPlanError}</p>}
                            {generatedHooks.length > 0 && (
                              <div className="mt-2 rounded-xl bg-slate-50 p-2 text-xs text-slate-700">
                                {generatedHooks.map((hook, index) => (
                                  <div key={`${hook}-${index}`} className="py-0.5">
                                    {index + 1}. {hook}
                                  </div>
                                ))}
                              </div>
                            )}
                            {generatedScript && (
                              <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-700">{generatedScript}</pre>
                            )}
                            {captionPlan.length > 0 && (
                              <div className="mt-2 rounded-xl bg-slate-50 p-2 text-xs text-slate-700">
                                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Caption Timeline</p>
                                <div className="max-h-36 space-y-1 overflow-auto">
                                  {captionPlan.map((caption) => (
                                    <div key={caption.id} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                                      <span className="font-mono text-[11px] text-slate-500">{caption.start}s → {caption.end}s</span>
                                      <p className="mt-0.5 text-xs text-slate-700">{caption.text}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="creative-os-preview-card">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Current Stage</p>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{selectedVideoStage.window}</span>
                            </div>
                            <h4 className="creative-os-heading mt-2 text-lg font-semibold text-slate-900">{selectedVideoStage.label}</h4>
                            <p className="mt-1 text-sm text-slate-600">{selectedVideoStage.note}</p>

                            <div className="mt-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-4 text-white">
                              <div className="flex items-center justify-between text-xs text-slate-300">
                                <span className="inline-flex items-center gap-1">
                                  <Play size={13} />
                                  Platform Preview
                                </span>
                                <span>{selectedProduct?.name || 'No product selected'}</span>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                                <div className="rounded-lg border border-white/20 bg-white/10 p-2">
                                  <Smartphone size={12} className="mb-1" /> TikTok / Story
                                </div>
                                <div className="rounded-lg border border-white/20 bg-white/10 p-2">
                                  <Monitor size={12} className="mb-1" /> Meta Feed
                                </div>
                              </div>
                              <div className="mt-3 rounded-lg border border-white/20 bg-white/10 p-2 text-xs text-slate-200">
                                Caption style: {CAPTION_STYLES.find((style) => style.id === selectedCaptionStyle)?.label}
                                <br />
                                Voice: {VIDEO_VOICE_OPTIONS.find((option) => option.id === selectedVoiceMode)?.label}
                                <br />
                                Transition: {selectedTransitionOption(timelineSegments.find((segment) => segment.stageId === selectedVideoStage.id)?.transition)}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Render Timeline Export</p>
                            <button
                              type="button"
                              onClick={renderVideoTimeline}
                              disabled={videoRenderLoading || !videoSourceUpload?.video_id}
                              className="w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {videoRenderLoading ? 'Rendering timeline...' : 'Render Caption Burn-in Video'}
                            </button>
                            {videoRenderError && <p className="mt-2 text-xs text-rose-600">{videoRenderError}</p>}
                            {videoRenderResult?.download_url && (
                              <div className="mt-3 space-y-2 rounded-xl border border-teal-200 bg-teal-50/50 p-3">
                                <video controls src={toInlineAssetUrl(videoRenderResult.download_url)} className="w-full rounded-lg border border-slate-200 bg-black/90" />
                                <a
                                  href={videoRenderResult.download_url}
                                  className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  <Download size={12} />
                                  Download Rendered Video
                                </a>
                                <p className="text-[11px] text-slate-500">
                                  {videoRenderResult.captions_count} captions burned in • {videoRenderResult.timeline_duration_seconds}s timeline
                                </p>
                              </div>
                            )}
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Batch Variant Generation</p>
                            <label className="text-xs text-slate-500">
                              Variant count ({VIDEO_MIN_VARIANTS}-{VIDEO_MAX_VARIANTS})
                              <input
                                type="number"
                                min={VIDEO_MIN_VARIANTS}
                                max={VIDEO_MAX_VARIANTS}
                                value={variantCount}
                                onChange={(event) => setVariantCount(clampVariantCount(event.target.value))}
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                              />
                            </label>
                            <div className="mt-3 grid gap-2 text-xs text-slate-600">
                              <div className="rounded-xl bg-slate-50 px-3 py-2">Swap Hooks: {variantCount} options</div>
                              <div className="rounded-xl bg-slate-50 px-3 py-2">Swap CTAs: {variantCount} options</div>
                              <div className="rounded-xl bg-slate-50 px-3 py-2">Music Mood: {MUSIC_MOODS.find((mood) => mood.id === selectedMusicMood)?.label}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </SectionCard>
                  </div>
                )}

                {activeModuleId === 'multi_format_engine' && (
                  <div className="space-y-4">
                    <SectionCard
                      title="Multi-Format Engine"
                      helper="Smart recomposition with platform-safe previews and one-click batch export naming."
                      icon={Layout}
                    >
                      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Base Format</p>
                            <select
                              value={baseFormatId}
                              onChange={(event) => setBaseFormatId(event.target.value)}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                            >
                              {AD_FORMAT_PRESETS.map((preset) => (
                                <option key={preset.id} value={preset.id}>{preset.name} ({preset.ratio})</option>
                              ))}
                            </select>

                            <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Batch Export Targets</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {AD_FORMAT_PRESETS.map((preset) => (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => toggleExportTarget(preset.id)}
                                  className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                                    exportTargets.includes(preset.id)
                                      ? 'border-teal-400 bg-teal-50'
                                      : 'border-slate-200 hover:border-slate-300'
                                  }`}
                                >
                                  <span className="block font-semibold text-slate-900">{preset.name}</span>
                                  <span className="text-slate-500">{preset.ratio}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Safe Zone + Naming</p>
                            <button
                              type="button"
                              onClick={() => setSafeZonePreviewEnabled((previous) => !previous)}
                              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                                safeZonePreviewEnabled ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              <Globe size={13} />
                              Safe Zone Overlay: {safeZonePreviewEnabled ? 'Visible' : 'Hidden'}
                            </button>

                            <label className="mt-3 block text-xs text-slate-500">
                              Export variant suffix
                              <input
                                type="text"
                                value={variantSuffix}
                                onChange={(event) => setVariantSuffix(event.target.value)}
                                placeholder="launch-a"
                                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={runBatchExport}
                              disabled={exportLoading}
                              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Download size={13} />
                              {exportLoading ? 'Rendering assets...' : 'Render Creative Pack'}
                            </button>
                            {exportError && <p className="mt-2 text-xs text-rose-600">{exportError}</p>}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="creative-os-preview-card">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Platform Safe Zones</p>
                            <p className="mt-1 text-xs text-slate-500">
                              Base format: {baseFormat.name} ({baseFormat.ratio})
                            </p>
                            <div className="mt-3 space-y-2">
                              {exportTargets.map((targetId) => {
                                const preset = AD_FORMAT_PRESETS.find((entry) => entry.id === targetId);
                                if (!preset) return null;
                                return (
                                  <div key={targetId} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                                    <div className="flex items-center justify-between">
                                      <span className="creative-os-heading text-sm font-semibold text-slate-900">{preset.name}</span>
                                      <span className="text-xs text-slate-500">{preset.ratio}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">{safeZonePreviewEnabled ? preset.safeZone : 'Overlay hidden'}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Export File Names</p>
                            <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3">
                              {exportFileNames.map((fileName) => (
                                <div key={fileName} className="flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
                                  <span className="font-mono text-slate-700">{fileName}</span>
                                  <Download size={12} className="text-slate-500" />
                                </div>
                              ))}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">Naming format: product_platform_variant</p>
                            {exportedAssets.length > 0 && (
                              <div className="mt-3 space-y-2 rounded-xl border border-teal-200 bg-teal-50/50 p-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-teal-700">Rendered Assets</p>
                                {exportedAssets.map((asset) => (
                                  <a
                                    key={asset.asset_id}
                                    href={asset.download_url}
                                    className="flex items-center justify-between rounded-lg bg-white px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                                  >
                                    <span className="font-mono">{asset.file_name}</span>
                                    <Download size={12} />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </SectionCard>
                  </div>
                )}
            </div>
          </div>
        </section>

        <footer className="creative-os-panel flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="creative-os-heading text-sm font-semibold text-slate-900">{PANEL_LABELS[activeModuleId]}</p>
            <p className="text-sm text-slate-600">
              Ready state: {selectedProduct?.name || 'No product selected'} | {selectedFormat.name} | {exportTargets.length} export targets
            </p>
            {savePresetMessage && <p className="mt-1 text-xs text-teal-700">{savePresetMessage}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveWorkspacePreset}
              disabled={savePresetLoading}
              className="creative-os-action-btn"
            >
              <Star size={14} />
              {savePresetLoading ? 'Saving...' : 'Save Workspace Preset'}
            </button>
            <button
              type="button"
              onClick={runBatchExport}
              disabled={exportLoading}
              className="creative-os-action-btn primary"
            >
              <Play size={14} />
              {exportLoading ? 'Building Pack...' : 'Build Final Creative Pack'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
