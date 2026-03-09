import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Contrast,
  Crop,
  Crosshair,
  Download,
  Droplets,
  Eraser,
  Film,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Layers3,
  Loader2,
  Music,
  Paintbrush,
  Palette,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  ShoppingBag,
  SkipBack,
  SkipForward,
  Sparkles,
  Sun,
  Sunset,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
  XCircle,
  Zap
} from 'lucide-react';
import VideoResizerPanel from './VideoResizerPanel';
import ProductHubPanel from './ProductHubPanel';

const API_BASE = '/api';
const withStore = (path, store) => `${API_BASE}${path}${path.includes('?') ? '&' : '?'}store=${encodeURIComponent(store ?? 'vironax')}`;

const cn = (...classes) => classes.filter(Boolean).join(' ');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const formatCurrency = (value, currency = 'USD') => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(value); }
  catch { return `$${value}`; }
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return '-';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const slugify = (value) =>
  String(value || 'source')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'source';

function StatusPill({ ok, label, title }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide',
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-600'
      )}
      title={title || label}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      <span>{label}</span>
    </div>
  );
}

function Button({ variant = 'primary', disabled, className, children, ...props }) {
  const styles = {
    primary: 'border border-indigo-200 bg-indigo-600 text-white shadow-sm hover:bg-indigo-500',
    secondary: 'border border-gray-200 bg-white text-gray-700 shadow-sm hover:bg-gray-50 hover:border-gray-300',
    ghost: 'border border-transparent bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700'
  };

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-all',
        'disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function Label({ children }) {
  return <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{children}</div>;
}

function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors',
        'placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100',
        className
      )}
      {...props}
    />
  );
}

function Select({ className, children, ...props }) {
  return (
    <select
      className={cn(
        'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors',
        'focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

function Slider({ label, tooltip, value, onChange, min, max, step = 1, disabled, className }) {
  const decimals = step < 1 ? String(step).split('.')[1]?.length || 2 : 0;
  const display = decimals ? Number(value).toFixed(decimals) : value;
  return (
    <div className={cn('group', className)}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 transition-colors group-hover:text-gray-600">{label}</span>
          {tooltip ? (
            <span className="text-gray-300 hover:text-gray-500 transition-colors cursor-help" title={tooltip}>
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.93 12.4h-1.86v-1.6h1.86v1.6zm1.82-5.68c-.2.36-.66.8-1.38 1.3-.4.28-.62.52-.68.72-.06.2-.08.48-.08.84H6.93c0-.56.08-1 .24-1.32.16-.32.54-.72 1.14-1.18.46-.36.76-.66.88-.92.12-.26.18-.54.18-.84 0-.42-.14-.76-.42-1.02-.28-.26-.66-.4-1.14-.4-.48 0-.86.14-1.14.42-.28.28-.42.66-.42 1.14H4.39c.02-.96.36-1.72 1.02-2.28.66-.56 1.5-.84 2.52-.84.98 0 1.78.26 2.38.78.6.52.9 1.22.9 2.1 0 .56-.16 1.08-.46 1.5z"/></svg>
            </span>
          ) : null}
        </div>
        <span className="text-[11px] font-mono font-medium text-gray-500 tabular-nums transition-colors group-hover:text-gray-700">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} disabled={disabled} className="pm-slider w-full" />
    </div>
  );
}

function AccordionSection({ icon: Icon, title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-gray-100/80 bg-white/70 shadow-sm overflow-hidden transition-all">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50/50 transition-colors"
      >
        {Icon ? <Icon className="h-3.5 w-3.5 text-indigo-400" /> : null}
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-500">{title}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <div className="pm-accordion-body" data-open={String(open)}>
        <div className="px-3.5 pb-3.5 pt-1 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function Toggle({ value, onChange, options = [] }) {
  const columns = Math.max(1, Math.min(options.length, 3));

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          disabled={opt.disabled}
          className={cn(
            'rounded-xl border px-3 py-2 text-sm font-medium transition-all',
            'disabled:cursor-not-allowed disabled:opacity-45',
            value === opt.value
              ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          )}
          title={opt.title}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function makeTransparentBg() {
  return {
    background: 'linear-gradient(135deg, #f8f9ff 0%, #eef0f8 25%, #f3f0fa 50%, #eef4fb 75%, #f8f9ff 100%)'
  };
}

const TOOL_DEFINITIONS = {
  remove_bg: {
    label: 'Remove BG',
    engine: 'BiRefNet + SAM2',
    description: 'Automatically remove the background, then fine-tune the edges if needed.'
  },
  erase: {
    label: 'Object Remover',
    engine: 'Standard / HD removal',
    description: 'Select objects with AI or paint a mask manually, then remove them cleanly.'
  },
  relight: {
    label: 'Lighting',
    engine: 'Relight + shadows',
    description: 'Reshape your image with studio-quality directional lighting and natural shadows.'
  },
  expand: {
    label: 'Extend',
    engine: 'SDXL expand',
    description: 'Expand the frame to a new aspect ratio and generate the missing background.'
  },
  enhance: {
    label: 'Enhance',
    engine: 'Real-ESRGAN + restoration',
    description: 'Upscale, sharpen, denoise, or recover detail from low-quality images.'
  }
};

/* ── Video Magic Tool Definitions ─────────────────────────── */
const VIDEO_TOOL_DEFINITIONS = {
  overlay:     { label: 'Overlays',     description: 'Detect & edit text overlays on your video' },
  resize:      { label: 'Smart Resize', description: 'Auto-resize for every social platform' },
  product_hub: { label: 'Product Hub',  description: 'Connect products from your catalog' },
  music:       { label: 'Music',        description: 'Add background music to your video' },
  enhance_v:   { label: 'Enhance',      description: 'Upscale and improve video quality' },
};

const VIDEO_TOOL_ICONS = {
  overlay: Layers3,
  resize: Crop,
  product_hub: ShoppingBag,
  music: Music,
  enhance_v: Zap,
};

/* ── Video Time Formatting ────────────────────────────────── */
const formatVideoTime = (seconds) => {
  if (!seconds || !Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/* ── Photo Adjustment Presets ──────────────────────────────── */
const DEFAULT_ADJUSTMENTS = {
  brightness: 0, contrast: 0, exposure: 0, highlights: 0, shadows: 0,
  saturation: 0, vibrance: 0, temperature: 0, tint: 0,
  sharpness: 0, clarity: 0, blur: 0,
  vignette: 0, grain: 0, fade: 0,
  rotate: 0, flipH: false, flipV: false
};

const PHOTO_FILTERS = [
  { id: 'original', label: 'Original', adj: {} },
  { id: 'vivid', label: 'Vivid', adj: { brightness: 5, contrast: 12, saturation: 30 } },
  { id: 'warm', label: 'Warm', adj: { temperature: 25, brightness: 3, saturation: 10 } },
  { id: 'cool', label: 'Cool', adj: { temperature: -22, brightness: 3, saturation: -5 } },
  { id: 'bw', label: 'B\u2009&\u2009W', adj: { saturation: -100, contrast: 10 } },
  { id: 'cinematic', label: 'Cinematic', adj: { contrast: 18, saturation: -12, temperature: 6, vignette: 35 } },
  { id: 'vintage', label: 'Vintage', adj: { temperature: 16, contrast: -10, brightness: 5, grain: 22, fade: 15 } },
  { id: 'dramatic', label: 'Dramatic', adj: { contrast: 30, brightness: -5, shadows: -20, clarity: 20 } },
  { id: 'soft', label: 'Soft', adj: { contrast: -15, brightness: 10, clarity: -15, highlights: 15 } },
  { id: 'film', label: 'Film', adj: { contrast: 5, saturation: -15, grain: 15, temperature: 8, fade: 10 } },
];

/** Build CSS filter + transform strings from adjustment values */
function buildFilterStyles(adj) {
  const filters = [];
  const b = 1 + (adj.brightness || 0) / 100 + (adj.exposure || 0) / 200;
  if (b !== 1) filters.push(`brightness(${b.toFixed(3)})`);
  const c = 1 + (adj.contrast || 0) / 100 + (adj.clarity || 0) / 200;
  if (c !== 1) filters.push(`contrast(${c.toFixed(3)})`);
  const s = 1 + (adj.saturation || 0) / 100 + (adj.vibrance || 0) / 200;
  if (s !== 1) filters.push(`saturate(${s.toFixed(3)})`);
  if (adj.temperature) {
    const t = adj.temperature;
    if (t > 0) filters.push(`sepia(${(t / 300).toFixed(3)})`);
    filters.push(`hue-rotate(${(-t * 0.4).toFixed(1)}deg)`);
  }
  if (adj.tint) filters.push(`hue-rotate(${(adj.tint * 0.6).toFixed(1)}deg)`);
  if (adj.highlights) filters.push(`brightness(${(1 + adj.highlights / 300).toFixed(3)})`);
  if (adj.shadows) filters.push(`brightness(${(1 + adj.shadows / 400).toFixed(3)})`);
  if (adj.blur) filters.push(`blur(${(adj.blur / 12).toFixed(1)}px)`);
  if (adj.fade) filters.push(`opacity(${(1 - adj.fade / 150).toFixed(3)})`);

  const transforms = [];
  if (adj.rotate) transforms.push(`rotate(${adj.rotate}deg)`);
  if (adj.flipH) transforms.push('scaleX(-1)');
  if (adj.flipV) transforms.push('scaleY(-1)');

  return {
    filter: filters.length ? filters.join(' ') : undefined,
    transform: transforms.length ? transforms.join(' ') : undefined,
    '--pm-vignette': adj.vignette ? (adj.vignette / 100 * 0.7).toFixed(2) : '0',
    '--pm-grain': adj.grain ? (adj.grain / 100 * 0.4).toFixed(2) : '0',
  };
}

const DEBUG_TRACE_LIMIT = 80;
const MASK_PIXEL_THRESHOLD = 18;
const MASK_MIN_PAINTED_PIXELS = 64;

const formatDebugTimestamp = (value) =>
  new Date(value).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

const readJsonSafe = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const RELIGHT_PRESET_DEFAULTS = {
  studio: { subjectBoost: 0.34, backgroundExposure: -0.16, warmth: 0.1, shadowOpacity: 0.42, shadowBlurPx: 48, shadowOffsetX: 0, shadowOffsetY: 40 },
  window_left: { subjectBoost: 0.42, backgroundExposure: -0.2, warmth: 0.16, shadowOpacity: 0.46, shadowBlurPx: 52, shadowOffsetX: 28, shadowOffsetY: 40 },
  window_right: { subjectBoost: 0.42, backgroundExposure: -0.2, warmth: 0.16, shadowOpacity: 0.46, shadowBlurPx: 52, shadowOffsetX: -28, shadowOffsetY: 40 },
  golden_hour: { subjectBoost: 0.44, backgroundExposure: -0.12, warmth: 0.24, shadowOpacity: 0.38, shadowBlurPx: 56, shadowOffsetX: 22, shadowOffsetY: 42 },
  rim: { subjectBoost: 0.3, backgroundExposure: -0.22, warmth: 0.06, shadowOpacity: 0.34, shadowBlurPx: 42, shadowOffsetX: -16, shadowOffsetY: 34 }
};

export default function PhotoMagicEditor({ store }) {
  const [health, setHealth] = useState(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugTrace, setDebugTrace] = useState([]);

  const [tool, setTool] = useState('remove_bg');
  const [error, setError] = useState(null);

  const [imageId, setImageId] = useState(null);
  const [imageMeta, setImageMeta] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceStage, setSourceStage] = useState('Original');
  const [sourceHistory, setSourceHistory] = useState([]);
  const [viewportMode, setViewportMode] = useState('source');
  const [compareSplit, setCompareSplit] = useState(56);
  const [lastRenderSummary, setLastRenderSummary] = useState('Idle');

  const fileInputRef = useRef(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const [cutoutUrl, setCutoutUrl] = useState(null);
  const [maskUrl, setMaskUrl] = useState(null);
  const [cutoutOutputId, setCutoutOutputId] = useState(null);
  const [maskOutputId, setMaskOutputId] = useState(null);

  const [selectionPrompt, setSelectionPrompt] = useState('');
  const [selectionCutoutUrl, setSelectionCutoutUrl] = useState(null);
  const [selectionMaskUrl, setSelectionMaskUrl] = useState(null);
  const [selectionCutoutOutputId, setSelectionCutoutOutputId] = useState(null);
  const [selectionMaskOutputId, setSelectionMaskOutputId] = useState(null);
  const [selectionMeta, setSelectionMeta] = useState(null);

  const [maxSide, setMaxSide] = useState(2048);
  const [precisionMode, setPrecisionMode] = useState(false);
  const [points, setPoints] = useState([]);
  const [maskDilatePx, setMaskDilatePx] = useState(0);
  const [maskFeatherPx, setMaskFeatherPx] = useState(0);

  const [quality, setQuality] = useState('standard');
  const [eraseUrl, setEraseUrl] = useState(null);
  const [brushSize, setBrushSize] = useState(32);
  const [eraseMode, setEraseMode] = useState('paint');
  const [cropToMask, setCropToMask] = useState(true);
  const [cropMarginPx, setCropMarginPx] = useState(128);
  const [sdxlSteps, setSdxlSteps] = useState(20);
  const [sdxlGuidance, setSdxlGuidance] = useState(8.0);
  const [sdxlStrength, setSdxlStrength] = useState(0.99);
  const [sdxlSeed, setSdxlSeed] = useState(0);

  const [enhanceMode, setEnhanceMode] = useState('upscale');
  const [enhanceStrength, setEnhanceStrength] = useState(0.5);
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const [enhanceUrl, setEnhanceUrl] = useState(null);

  const [relightPreset, setRelightPreset] = useState('studio');
  const [subjectBoost, setSubjectBoost] = useState(0.22);
  const [backgroundExposure, setBackgroundExposure] = useState(-0.08);
  const [relightWarmth, setRelightWarmth] = useState(0.08);
  const [shadowOpacity, setShadowOpacity] = useState(0.28);
  const [shadowBlurPx, setShadowBlurPx] = useState(42);
  const [shadowOffsetX, setShadowOffsetX] = useState(0);
  const [shadowOffsetY, setShadowOffsetY] = useState(34);
  const [relightUrl, setRelightUrl] = useState(null);
  const [relightMaskUrl, setRelightMaskUrl] = useState(null);
  const [relightMaskOutputId, setRelightMaskOutputId] = useState(null);

  const [expandAspectRatio, setExpandAspectRatio] = useState('4:5');
  const [expandAnchor, setExpandAnchor] = useState('center');
  const [expandPrompt, setExpandPrompt] = useState('');
  const [expandNegativePrompt, setExpandNegativePrompt] = useState('');
  const [expandSteps, setExpandSteps] = useState(24);
  const [expandGuidance, setExpandGuidance] = useState(7.5);
  const [expandStrength, setExpandStrength] = useState(0.96);
  const [expandSeed, setExpandSeed] = useState(0);
  const [expandFeatherPx, setExpandFeatherPx] = useState(24);
  const [expandUrl, setExpandUrl] = useState(null);
  const [expandMaskUrl, setExpandMaskUrl] = useState(null);
  const [expandMaskOutputId, setExpandMaskOutputId] = useState(null);

  // ── Object Remover: mask method toggle ──
  const [maskMethod, setMaskMethod] = useState('smart');

  // ── Export Modal ──
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState('png');
  const [exportQuality, setExportQuality] = useState(90);
  const [exportScale, setExportScale] = useState('1x');

  // ── Editor Mode: photo / video ──
  const [editorMode, setEditorMode] = useState('photo');

  // ── Video State ──
  const [videoSrc, setVideoSrc] = useState(null);
  const [videoId, setVideoId] = useState(null);
  const [videoFileInfo, setVideoFileInfo] = useState(null);
  const [isVideoUploading, setIsVideoUploading] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTrimStart, setVideoTrimStart] = useState(0);
  const [videoTrimEnd, setVideoTrimEnd] = useState(null);
  const [videoVolume, setVideoVolume] = useState(100);
  const [videoSpeed, setVideoSpeed] = useState(1);
  const [videoMuted, setVideoMuted] = useState(false);
  const [videoTool, setVideoTool] = useState('overlay');
  const videoRef = useRef(null);
  const videoFileInputRef = useRef(null);

  // ── Video Overlay State ──
  const [overlaySegments, setOverlaySegments] = useState([]);
  const [overlayScanning, setOverlayScanning] = useState(false);
  const [overlayExporting, setOverlayExporting] = useState(false);
  const [selectedOverlaySegIdx, setSelectedOverlaySegIdx] = useState(null);
  const [selectedOverlayIdx, setSelectedOverlayIdx] = useState(null);
  const [overlayScanInterval, setOverlayScanInterval] = useState(1.0);
  const [overlayScanMaxFrames, setOverlayScanMaxFrames] = useState(60);

  // ── Music State ──
  const [musicTracks, setMusicTracks] = useState([]);
  const [musicLoading, setMusicLoading] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [musicVolume, setMusicVolume] = useState(80);
  const [musicFadeIn, setMusicFadeIn] = useState(2);
  const [musicFadeOut, setMusicFadeOut] = useState(3);

  // ── Photo Adjustments ──
  const [adjustments, setAdjustments] = useState({ ...DEFAULT_ADJUSTMENTS });
  const [activeFilter, setActiveFilter] = useState('original');
  const setAdj = useCallback((key, val) => {
    setAdjustments((prev) => ({ ...prev, [key]: val }));
    setActiveFilter('original');
  }, []);
  const resetAdjustments = useCallback(() => {
    setAdjustments({ ...DEFAULT_ADJUSTMENTS });
    setActiveFilter('original');
  }, []);
  const applyFilter = useCallback((filter) => {
    setActiveFilter(filter.id);
    setAdjustments((prev) => ({ ...DEFAULT_ADJUSTMENTS, ...filter.adj, rotate: prev.rotate, flipH: prev.flipH, flipV: prev.flipV }));
  }, []);
  const adjStyles = useMemo(() => buildFilterStyles(adjustments), [adjustments]);
  const hasAdjustments = useMemo(() => Object.keys(DEFAULT_ADJUSTMENTS).some((k) => adjustments[k] !== DEFAULT_ADJUSTMENTS[k]), [adjustments]);

  const imgRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const paintStateRef = useRef({ painting: false, lastX: 0, lastY: 0 });
  const undoStackRef = useRef([]);
  const debugRunIdRef = useRef(0);
  const [maskMetrics, setMaskMetrics] = useState({ hasMask: false, paintedPixels: 0, coverage: 0 });

  const aiConfigured = Boolean(health?.photo_magic?.ai?.configured);
  const aiHealthPayload = health?.photo_magic?.ai?.health?.payload || {};
  const aiModels = aiHealthPayload?.models || {};
  const rmbg2Ready = Boolean(aiConfigured && aiModels?.rmbg2);
  const sam2Ready = Boolean(aiConfigured && aiModels?.sam2);
  const lamaReady = Boolean(aiConfigured && aiModels?.lama);
  const realEsrganReady = Boolean(aiConfigured && aiModels?.realesrgan);
  const relightReady = Boolean(aiConfigured && aiModels?.relight);
  const geminiReady = Boolean(health?.photo_magic?.guidance?.gemini?.configured);

  const hqConfigured = Boolean(health?.photo_magic?.hq?.configured);
  const hqOk = Boolean(health?.photo_magic?.hq?.health?.ok);
  const hqModels = health?.photo_magic?.hq?.health?.payload?.models || {};
  const hqReason = health?.photo_magic?.hq?.health?.payload?.errors?.sdxl_inpaint || null;
  const expandReady = Boolean(hqConfigured && hqOk && hqModels?.sdxl_expand);
  const standardEraseState = health?.photo_magic?.standard_erase || {};
  const standardEraseReady = Boolean(standardEraseState?.ready ?? lamaReady);
  const standardEraseProvider = String(standardEraseState?.provider || (lamaReady ? 'photo-magic-ai' : 'standard')).trim();
  const standardEraseModel = String(
    standardEraseState?.model || (standardEraseProvider === 'replicate' ? 'black-forest-labs/flux-fill-pro' : 'LaMa inpainting')
  ).trim();
  const standardEraseToggleLabel = standardEraseProvider === 'replicate' ? 'Fast (Flux Fill)' : 'Fast (LaMa)';

  const currentMaskOutputId = selectionMaskOutputId || maskOutputId || relightMaskOutputId || expandMaskOutputId || null;
  const latestMaskForErase = selectionMaskUrl || maskUrl || relightMaskUrl || expandMaskUrl || null;
  const latestMaskSourceLabel = selectionMaskUrl
    ? 'Prompt selection'
    : maskUrl
      ? 'Foreground isolation'
      : relightMaskUrl
        ? 'Lighting stage'
        : expandMaskUrl
          ? 'Canvas expand'
          : null;

  const hqOption = useMemo(() => {
    if (!hqConfigured) return { disabled: true, title: 'HQ service not configured. Set PHOTO_MAGIC_HQ_AI_URL.' };
    if (!hqOk) return { disabled: true, title: hqReason || 'HQ service is not ready.' };
    return { disabled: false, title: 'SDXL inpaint for final cleanup renders.' };
  }, [hqConfigured, hqOk, hqReason]);

  const pushDebugEvent = useCallback((entry) => {
    setDebugTrace((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          at: Date.now(),
          ...entry
        }
      ];
      return next.slice(-DEBUG_TRACE_LIMIT);
    });
  }, []);

  const startDebugRun = useCallback(
    (scope, message, details = null) => {
      const runId = debugRunIdRef.current + 1;
      debugRunIdRef.current = runId;
      pushDebugEvent({ runId, scope, step: 'start', status: 'running', message, details });
      return runId;
    },
    [pushDebugEvent]
  );

  const logDebug = useCallback(
    (runId, scope, step, status, message, details = null) => {
      pushDebugEvent({ runId, scope, step, status, message, details });
    },
    [pushDebugEvent]
  );

  const clearDebugTrace = useCallback(() => {
    setDebugTrace([]);
  }, []);

  const inspectMaskCanvas = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
      return { hasMask: false, paintedPixels: 0, coverage: 0 };
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { hasMask: false, paintedPixels: 0, coverage: 0 };

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let paintedPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      const brightness = Math.max(data[index], data[index + 1], data[index + 2]);
      if (alpha >= MASK_PIXEL_THRESHOLD || brightness >= MASK_PIXEL_THRESHOLD) paintedPixels += 1;
    }

    const totalPixels = Math.max(1, canvas.width * canvas.height);
    const coverage = paintedPixels / totalPixels;
    return {
      hasMask: paintedPixels >= MASK_MIN_PAINTED_PIXELS,
      paintedPixels,
      coverage
    };
  }, []);

  const syncMaskMetrics = useCallback(() => {
    const next = inspectMaskCanvas();
    setMaskMetrics(next);
    return next;
  }, [inspectMaskCanvas]);

  const requestJson = useCallback(
    async ({ runId, scope, step, url, options, successMessage, failureMessage, successDetails }) => {
      logDebug(runId, scope, step, 'running', `${options?.method || 'GET'} ${url.replace(API_BASE, '')}`);
      const res = await fetch(url, options);
      const data = await readJsonSafe(res);

      if (!res.ok || !data?.success) {
        const message = data?.error || failureMessage;
        logDebug(runId, scope, step, 'failed', message, {
          status: res.status,
          details: data?.details || null
        });
        const nextError = new Error(message || failureMessage);
        nextError.status = res.status;
        nextError.payload = data;
        throw nextError;
      }

      logDebug(
        runId,
        scope,
        step,
        'success',
        successMessage,
        typeof successDetails === 'function' ? successDetails(data) : successDetails || { status: res.status }
      );
      return data;
    },
    [logDebug]
  );

  const refreshHealth = useCallback(async () => {
    setIsHealthLoading(true);
    try {
      const res = await fetch(withStore('/creative-studio/photo-magic/health', store));
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to load Photo Magic stack status');
      setHealth(data);
    } catch (nextError) {
      console.error(nextError);
      setHealth(null);
    } finally {
      setIsHealthLoading(false);
    }
  }, [store]);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  useEffect(() => {
    return () => {
      if (imageSrc && imageSrc.startsWith('blob:')) URL.revokeObjectURL(imageSrc);
    };
  }, [imageSrc]);

  useEffect(() => {
    if (quality === 'hq' && hqOption.disabled) {
      setQuality('standard');
    }
  }, [hqOption.disabled, quality]);

  useEffect(() => {
    const preset = RELIGHT_PRESET_DEFAULTS[relightPreset] || RELIGHT_PRESET_DEFAULTS.studio;
    setSubjectBoost(preset.subjectBoost);
    setBackgroundExposure(preset.backgroundExposure);
    setRelightWarmth(preset.warmth);
    setShadowOpacity(preset.shadowOpacity);
    setShadowBlurPx(preset.shadowBlurPx);
    setShadowOffsetX(preset.shadowOffsetX);
    setShadowOffsetY(preset.shadowOffsetY);
  }, [relightPreset]);

  // ── Video: Upload handler ──
  const handleVideoUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsVideoUploading(true);
    setVideoSrc(URL.createObjectURL(file));
    setVideoTrimStart(0);
    setVideoTrimEnd(null);
    setOverlaySegments([]);
    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch(withStore('/creative-studio/video-overlay/upload', store), { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok && data?.success !== false) {
        setVideoId(data.video_id || data.videoId);
        setVideoFileInfo({ width: data.width, height: data.height, duration: data.duration, size: file.size });
      }
    } catch (_err) {
      console.error('Video upload failed:', _err);
    }
    setIsVideoUploading(false);
  }, [store]);

  // ── Video: Playback controls ──
  const toggleVideoPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setIsVideoPlaying(true); }
    else { v.pause(); setIsVideoPlaying(false); }
  }, []);

  const seekVideo = useCallback((time) => {
    const v = videoRef.current;
    if (v) { v.currentTime = time; setVideoCurrentTime(time); }
  }, []);

  const skipVideo = useCallback((delta) => {
    const v = videoRef.current;
    if (v) seekVideo(clamp(v.currentTime + delta, 0, videoDuration));
  }, [seekVideo, videoDuration]);

  // ── Video: Time update handler ──
  const onVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideoCurrentTime(v.currentTime);
    const end = videoTrimEnd ?? videoDuration;
    if (v.currentTime >= end) { v.pause(); setIsVideoPlaying(false); }
  }, [videoTrimEnd, videoDuration]);

  const onVideoLoaded = useCallback(() => {
    const v = videoRef.current;
    if (v) { setVideoDuration(v.duration); setVideoTrimEnd(null); }
  }, []);

  // ── Video: Volume/Speed sync ──
  useEffect(() => {
    const v = videoRef.current;
    if (v) { v.volume = videoMuted ? 0 : videoVolume / 100; v.playbackRate = videoSpeed; }
  }, [videoVolume, videoMuted, videoSpeed]);

  // ── Video: Overlay scan ──
  const scanOverlays = useCallback(async () => {
    if (!videoId) return;
    setOverlayScanning(true);
    try {
      const res = await fetch(withStore('/creative-studio/video-overlay/scan', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: videoId, intervalSec: overlayScanInterval, maxFrames: overlayScanMaxFrames })
      });
      const data = await res.json();
      if (res.ok && data?.segments) {
        setOverlaySegments(data.segments);
      }
    } catch (_err) {
      console.error('Overlay scan failed:', _err);
    }
    setOverlayScanning(false);
  }, [videoId, overlayScanInterval, overlayScanMaxFrames, store]);

  // ── Video: Overlay export ──
  const exportOverlays = useCallback(async () => {
    if (!videoId || !overlaySegments.length) return;
    setOverlayExporting(true);
    try {
      const res = await fetch(withStore('/creative-studio/video-overlay/export', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, segments: overlaySegments })
      });
      const data = await res.json();
      if (res.ok && data?.downloadUrl) {
        const link = document.createElement('a');
        link.href = data.downloadUrl;
        link.download = 'video-with-overlays.mp4';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (_err) {
      console.error('Export failed:', _err);
    }
    setOverlayExporting(false);
  }, [videoId, overlaySegments, store]);

  // ── Video: Music library fetch ──
  const loadMusicLibrary = useCallback(async () => {
    setMusicLoading(true);
    try {
      const res = await fetch(withStore('/creative-studio/creative-os/video/music/library', store));
      const data = await res.json();
      if (res.ok && data?.tracks) setMusicTracks(data.tracks);
      else if (res.ok && Array.isArray(data)) setMusicTracks(data);
    } catch (_err) {
      console.error('Music library load failed:', _err);
    }
    setMusicLoading(false);
  }, [store]);

  // ── Video: Update overlay ──
  const updateOverlay = useCallback((segIdx, ovIdx, patch) => {
    setOverlaySegments((prev) => prev.map((seg, si) => {
      if (si !== segIdx) return seg;
      return { ...seg, overlays: seg.overlays.map((ov, oi) => oi === ovIdx ? { ...ov, ...patch } : ov) };
    }));
  }, []);

  const deleteOverlay = useCallback((segIdx, ovIdx) => {
    setOverlaySegments((prev) => prev.map((seg, si) => {
      if (si !== segIdx) return seg;
      return { ...seg, overlays: seg.overlays.filter((_, oi) => oi !== ovIdx) };
    }));
  }, []);

  // ── Export: Download with quality/format/scale ──
  const handleExport = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const scales = { '0.5x': 0.5, '1x': 1, '2x': 2, '3x': 3, '4x': 4 };
    const scale = scales[exportScale] || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');

    // Apply CSS filters if any
    if (adjStyles.filter) ctx.filter = adjStyles.filter;
    // Apply transforms
    ctx.save();
    if (adjustments.flipH || adjustments.flipV || adjustments.rotate) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      if (adjustments.rotate) ctx.rotate((adjustments.rotate * Math.PI) / 180);
      ctx.scale(adjustments.flipH ? -1 : 1, adjustments.flipV ? -1 : 1);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.restore();

    const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
    const mime = mimeTypes[exportFormat] || 'image/png';
    const quality = exportFormat === 'png' ? undefined : exportQuality / 100;
    const dataUrl = canvas.toDataURL(mime, quality);

    const link = document.createElement('a');
    link.href = dataUrl;
    const baseName = sourceLabel?.replace(/\.\w+$/, '') || 'export';
    link.download = `${baseName}-${exportScale}.${exportFormat}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportModal(false);
  }, [adjStyles, adjustments, exportFormat, exportQuality, exportScale, sourceLabel]);

  const resetOutputs = useCallback(() => {
    setCutoutUrl(null);
    setMaskUrl(null);
    setCutoutOutputId(null);
    setMaskOutputId(null);
    setSelectionCutoutUrl(null);
    setSelectionMaskUrl(null);
    setSelectionCutoutOutputId(null);
    setSelectionMaskOutputId(null);
    setSelectionMeta(null);
    setEraseUrl(null);
    setRelightUrl(null);
    setRelightMaskUrl(null);
    setRelightMaskOutputId(null);
    setExpandUrl(null);
    setExpandMaskUrl(null);
    setExpandMaskOutputId(null);
    setEnhanceUrl(null);
    setPoints([]);
    setViewportMode('source');
    undoStackRef.current = [];
    setMaskMetrics({ hasMask: false, paintedPixels: 0, coverage: 0 });
    const canvas = maskCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const uploadImage = useCallback(
    async (file, options = {}) => {
      const {
        sourceStageLabel = 'Original',
        sourceName = file?.name || '',
        nextTool = 'remove_bg',
        resetHistory = true
      } = options;

      setError(null);
      setIsUploading(true);
      const runId = startDebugRun('Upload', `Importing ${sourceName || file?.name || 'image'}`);

      try {
        resetOutputs();
        const form = new FormData();
        form.append('image', file);

        const data = await requestJson({
          runId,
          scope: 'Upload',
          step: 'upload',
          url: withStore('/creative-studio/photo-magic/upload', store),
          options: {
            method: 'POST',
            body: form
          },
          successMessage: 'Image uploaded',
          failureMessage: 'Upload failed',
          successDetails: (payload) => ({
            imageId: payload?.image_id || null,
            width: payload?.width || null,
            height: payload?.height || null,
            filename: payload?.filename || null
          })
        });

        setImageId(data.image_id);
        setImageMeta({
          width: data.width,
          height: data.height,
          filename: data.filename,
          mime: data.mime,
          size: data.size
        });
        setImageSrc(URL.createObjectURL(file));
        setSourceLabel(sourceName || data.filename || file?.name || 'untitled');
        setSourceStage(sourceStageLabel);
        setSourceHistory((prev) => (resetHistory ? [sourceStageLabel] : [...prev, sourceStageLabel].slice(-4)));
        setPrecisionMode(false);
        setViewportMode('source');
        setTool(nextTool);
        setLastRenderSummary(`Source ready ${data.width || '?'}x${data.height || '?'}`);
      } catch (nextError) {
        console.error(nextError);
        const message = nextError?.message || 'Upload failed';
        setError(message);
        setLastRenderSummary(`Failed: ${message}`);
        logDebug(runId, 'Upload', 'complete', 'failed', message);
      } finally {
        setIsUploading(false);
        refreshHealth();
      }
    },
    [logDebug, refreshHealth, requestJson, resetOutputs, startDebugRun, store]
  );

  const promoteOutputToSource = useCallback(
    async ({ url, stageLabel, nextTool = 'remove_bg' }) => {
      if (!url) return;

      setError(null);
      const runId = startDebugRun('Route', `Promoting ${stageLabel || 'output'} into the source chain`);
      try {
        logDebug(runId, 'Route', 'download', 'running', 'Fetching render output for source promotion', { url });
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to route output back into the source chain');

        const blob = await response.blob();
        const normalizedType = blob.type || 'image/png';
        const extension = normalizedType.includes('jpeg') ? 'jpg' : 'png';
        const file = new File([blob], `${slugify(stageLabel)}.${extension}`, { type: normalizedType });

        await uploadImage(file, {
          sourceStageLabel: stageLabel,
          sourceName: file.name,
          nextTool,
          resetHistory: false
        });
        logDebug(runId, 'Route', 'complete', 'success', `${stageLabel || 'Output'} promoted into source`, {
          fileType: normalizedType,
          nextTool
        });
      } catch (nextError) {
        console.error(nextError);
        const message = nextError?.message || 'Failed to promote output into the active source';
        setError(message);
        setLastRenderSummary(`Failed: ${message}`);
        logDebug(runId, 'Route', 'complete', 'failed', message);
      }
    },
    [logDebug, startDebugRun, uploadImage]
  );

  const onPickFile = useCallback(() => {
    fileInputRef.current?.click?.();
  }, []);

  const onFileChange = useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (file) {
        uploadImage(file, {
          sourceStageLabel: 'Original',
          sourceName: file.name,
          nextTool: 'remove_bg',
          resetHistory: true
        });
      }
      event.target.value = '';
    },
    [uploadImage]
  );

  const ensureMaskCanvasSize = useCallback(() => {
    const img = imgRef.current;
    const canvas = maskCanvasRef.current;
    if (!img || !canvas) return;

    const rect = img.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      const previous = document.createElement('canvas');
      previous.width = canvas.width;
      previous.height = canvas.height;
      const prevCtx = previous.getContext('2d');
      prevCtx?.drawImage(canvas, 0, 0);

      canvas.width = nextWidth;
      canvas.height = nextHeight;
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, nextWidth, nextHeight);
      if (previous.width > 0 && previous.height > 0) {
        ctx?.drawImage(previous, 0, 0, nextWidth, nextHeight);
      }
    }
  }, []);

  useEffect(() => {
    ensureMaskCanvasSize();
    const handleResize = () => ensureMaskCanvasSize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [ensureMaskCanvasSize]);

  const addPointFromEvent = useCallback(
    (event) => {
      if (tool !== 'remove_bg' || !precisionMode || viewportMode !== 'source') return;
      const img = imgRef.current;
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const label = event.altKey || event.metaKey ? 0 : 1;
      setPoints((prev) => [...prev, { x_norm: x, y_norm: y, label }]);
    },
    [precisionMode, tool, viewportMode]
  );

  const runRemoveBg = useCallback(async () => {
    if (!imageId) return;

    setError(null);
    setIsRunning(true);
    const runId = startDebugRun('Foreground Isolation', 'Starting auto cutout');
    try {
      const data = await requestJson({
        runId,
        scope: 'Foreground Isolation',
        step: 'remove-bg',
        url: withStore('/creative-studio/photo-magic/remove-bg', store),
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_id: imageId, engine: 'rmbg2', max_side: maxSide })
        },
        successMessage: 'Cutout and mask assets generated',
        failureMessage: 'Foreground isolation failed',
        successDetails: (payload) => ({
          cutoutReady: Boolean(payload?.cutout?.url),
          maskReady: Boolean(payload?.mask?.url),
          width: payload?.width || null,
          height: payload?.height || null
        })
      });

      setCutoutUrl(data.cutout?.url || null);
      setMaskUrl(data.mask?.url || null);
      setCutoutOutputId(data.cutout?.output_id || null);
      setMaskOutputId(data.mask?.output_id || null);
      setViewportMode('compare');
      setLastRenderSummary(`Auto cutout ready ${data.width || imageMeta?.width || '?'}x${data.height || imageMeta?.height || '?'}`);
    } catch (nextError) {
      console.error(nextError);
      const message = nextError?.message || 'Foreground isolation failed';
      setError(message);
      setLastRenderSummary(`Failed: ${message}`);
      logDebug(runId, 'Foreground Isolation', 'complete', 'failed', message);
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [imageId, imageMeta?.height, imageMeta?.width, logDebug, maxSide, refreshHealth, requestJson, startDebugRun, store]);

  const runRefine = useCallback(async () => {
    if (!imageId || !points.length) return;

    setError(null);
    setIsRunning(true);
    const runId = startDebugRun('Precision Mask', `Applying SAM2 refine with ${points.length} guide points`);
    try {
      const data = await requestJson({
        runId,
        scope: 'Precision Mask',
        step: 'sam2-refine',
        url: withStore('/creative-studio/photo-magic/remove-bg/refine', store),
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_id: imageId,
            points,
            max_side: maxSide,
            mask_dilate_px: maskDilatePx,
            mask_feather_px: maskFeatherPx
          })
        },
        successMessage: 'SAM2 mask refinement completed',
        failureMessage: 'SAM2 refine failed',
        successDetails: (payload) => ({
          cutoutReady: Boolean(payload?.cutout?.url),
          maskReady: Boolean(payload?.mask?.url)
        })
      });

      setCutoutUrl(data.cutout?.url || null);
      setMaskUrl(data.mask?.url || null);
      setCutoutOutputId(data.cutout?.output_id || null);
      setMaskOutputId(data.mask?.output_id || null);
      setViewportMode('compare');
      setLastRenderSummary(`Precision mask ready with ${points.length} guide points`);
    } catch (nextError) {
      console.error(nextError);
      const message = nextError?.message || 'SAM2 refine failed';
      setError(message);
      setLastRenderSummary(`Failed: ${message}`);
      logDebug(runId, 'Precision Mask', 'complete', 'failed', message);
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [imageId, logDebug, maskDilatePx, maskFeatherPx, maxSide, points, refreshHealth, requestJson, startDebugRun, store]);

  const runSelect = useCallback(async () => {
    if (!imageId || !selectionPrompt.trim()) return;

    setError(null);
    setIsRunning(true);
    const promptLabel = selectionPrompt.trim();
    const runId = startDebugRun('Prompt Selection', `Resolving "${promptLabel}"`);
    try {
      const data = await requestJson({
        runId,
        scope: 'Prompt Selection',
        step: 'select',
        url: withStore('/creative-studio/photo-magic/select', store),
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_id: imageId,
            prompt: promptLabel,
            max_side: maxSide,
            mask_dilate_px: maskDilatePx,
            mask_feather_px: maskFeatherPx
          })
        },
        successMessage: 'Prompt selection mask resolved',
        failureMessage: 'Prompt selection failed',
        successDetails: (payload) => ({
          label: payload?.selection?.label || promptLabel,
          confidence: payload?.selection?.confidence || null,
          maskReady: Boolean(payload?.mask?.url)
        })
      });

      setSelectionCutoutUrl(data.cutout?.url || null);
      setSelectionMaskUrl(data.mask?.url || null);
      setSelectionCutoutOutputId(data.cutout?.output_id || null);
      setSelectionMaskOutputId(data.mask?.output_id || null);
      setSelectionMeta(data.selection || null);
      setViewportMode('compare');
      setLastRenderSummary(`Selection locked for ${data.selection?.label || promptLabel}`);
    } catch (nextError) {
      console.error(nextError);
      const message = nextError?.message || 'Prompt selection failed';
      setError(message);
      setLastRenderSummary(`Failed: ${message}`);
      logDebug(runId, 'Prompt Selection', 'complete', 'failed', message, { prompt: promptLabel });
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [imageId, logDebug, maskDilatePx, maskFeatherPx, maxSide, refreshHealth, requestJson, selectionPrompt, startDebugRun, store]);

  const pushUndo = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;

    try {
      undoStackRef.current.push(canvas.toDataURL('image/png'));
      if (undoStackRef.current.length > 20) undoStackRef.current.shift();
    } catch {
      // Ignore browser-specific canvas serialization failures.
    }
  }, []);

  const undoMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;

    const previous = undoStackRef.current.pop();
    if (!previous) return;

    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      ctx?.drawImage(img, 0, 0);
      syncMaskMetrics();
    };
    img.src = previous;
  }, [syncMaskMetrics]);

  const clearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;

    pushUndo();
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setMaskMetrics({ hasMask: false, paintedPixels: 0, coverage: 0 });
    setLastRenderSummary('Clean plate mask cleared');
  }, [pushUndo]);

  const drawStroke = useCallback((ctx, x, y, prevX, prevY, radius, mode) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = radius * 2;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.lineTo(x, y);
    ctx.stroke();
  }, []);

  const getCanvasPoint = useCallback((event) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height)
    };
  }, []);

  const onMaskPointerDown = useCallback(
    (event) => {
      if (tool !== 'erase' || viewportMode !== 'source') return;

      const canvas = maskCanvasRef.current;
      if (!canvas) return;

      ensureMaskCanvasSize();
      pushUndo();

      const point = getCanvasPoint(event);
      if (!point) return;

      paintStateRef.current = { painting: true, lastX: point.x, lastY: point.y };
      try {
        canvas.setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture is not available in every environment.
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawStroke(ctx, point.x, point.y, point.x, point.y, brushSize / 2, eraseMode);
    },
    [brushSize, drawStroke, ensureMaskCanvasSize, eraseMode, getCanvasPoint, pushUndo, tool, viewportMode]
  );

  const onMaskPointerMove = useCallback(
    (event) => {
      if (tool !== 'erase' || viewportMode !== 'source') return;

      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      const state = paintStateRef.current;
      if (!state.painting) return;

      const point = getCanvasPoint(event);
      if (!point) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawStroke(ctx, point.x, point.y, state.lastX, state.lastY, brushSize / 2, eraseMode);
      paintStateRef.current.lastX = point.x;
      paintStateRef.current.lastY = point.y;
    },
    [brushSize, drawStroke, eraseMode, getCanvasPoint, tool, viewportMode]
  );

  const onMaskPointerUp = useCallback(
    (event) => {
      if (tool !== 'erase') return;

      const canvas = maskCanvasRef.current;
      if (!canvas) return;

      paintStateRef.current.painting = false;
      try {
        canvas.releasePointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture is not available in every environment.
      }
      syncMaskMetrics();
    },
    [syncMaskMetrics, tool]
  );

  const exportMaskBlob = useCallback(async () => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;

    const targetWidth = toNumber(imageMeta?.width, canvas.width);
    const targetHeight = toNumber(imageMeta?.height, canvas.height);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = Math.max(1, Math.round(targetWidth || canvas.width));
    outputCanvas.height = Math.max(1, Math.round(targetHeight || canvas.height));

    const outputCtx = outputCanvas.getContext('2d');
    outputCtx?.drawImage(canvas, 0, 0, outputCanvas.width, outputCanvas.height);

    const blob = await new Promise((resolve) => outputCanvas.toBlob(resolve, 'image/png'));
    if (blob) return blob;

    const dataUrl = outputCanvas.toDataURL('image/png');
    const res = await fetch(dataUrl);
    return await res.blob();
  }, [imageMeta?.height, imageMeta?.width]);

  const applyMaskArtifactToCanvas = useCallback(
    async (url, options = {}) => {
      if (!url || !imageSrc) return;
      const { summary = 'Selection mask routed into object remover', logMessage = summary, runId = null } = options;

      setTool('erase');
      setViewportMode('source');
      setError(null);

      await new Promise((resolve) => requestAnimationFrame(resolve));
      ensureMaskCanvasSize();

      const canvas = maskCanvasRef.current;
      if (!canvas) return;

      const image = new Image();
      image.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Failed to load the mask artifact'));
        image.src = url;
      });

      pushUndo();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const stats = syncMaskMetrics();
      setLastRenderSummary(summary);
      if (runId != null) {
        logDebug(runId, 'Object Remover', 'mask-route', 'success', logMessage, {
          coverage: Number((stats.coverage * 100).toFixed(2)),
          paintedPixels: stats.paintedPixels
        });
      }
    },
    [ensureMaskCanvasSize, imageSrc, logDebug, pushUndo, syncMaskMetrics]
  );

  const runErase = useCallback(async () => {
    if (!imageId) return;

    setError(null);
    setIsRunning(true);
    const scope = quality === 'hq' ? 'HD Remove' : 'Object Remover';
    const runId = startDebugRun(scope, `${quality === 'hq' ? 'HD' : 'Standard'} object removal requested`);
    try {
      let maskState = syncMaskMetrics();
      logDebug(runId, scope, 'mask-check', maskState.hasMask ? 'success' : 'running', maskState.hasMask ? 'Mask surface already contains painted or routed pixels' : 'Mask surface is blank', {
        coverage: Number((maskState.coverage * 100).toFixed(2)),
        paintedPixels: maskState.paintedPixels
      });

      if (!maskState.hasMask && latestMaskForErase) {
        logDebug(runId, scope, 'mask-route', 'running', `Auto-loading ${latestMaskSourceLabel || 'latest'} mask into object remover`);
        await applyMaskArtifactToCanvas(latestMaskForErase, {
          summary: `${latestMaskSourceLabel || 'Latest'} mask loaded for object remover`,
          logMessage: `${latestMaskSourceLabel || 'Latest'} mask copied into the object remover surface`,
          runId
        });
        maskState = syncMaskMetrics();
      }

      if (!maskState.hasMask) {
        throw new Error('Paint a removal mask or route a mask artifact into Object Remover first.');
      }

      const maskBlob = await exportMaskBlob();
      if (!maskBlob) throw new Error('Mask surface is not ready');

      const form = new FormData();
      form.append('image_id', imageId);
      form.append('quality', quality);
      form.append('max_side', String(maxSide));
      form.append('mask_dilate_px', String(maskDilatePx));
      form.append('mask_feather_px', String(maskFeatherPx));
      form.append('crop_to_mask', String(Boolean(cropToMask)));
      form.append('crop_margin_px', String(cropMarginPx));
      form.append('mask', maskBlob, 'mask.png');

      if (quality === 'hq') {
        form.append('num_inference_steps', String(sdxlSteps));
        form.append('guidance_scale', String(sdxlGuidance));
        form.append('strength', String(sdxlStrength));
        form.append('seed', String(sdxlSeed));
      }

      const data = await requestJson({
        runId,
        scope,
        step: 'erase',
        url: withStore('/creative-studio/photo-magic/erase', store),
        options: {
          method: 'POST',
          body: form
        },
        successMessage: `${quality === 'hq' ? 'HD' : 'Standard'} object removal completed`,
        failureMessage: 'Object removal failed',
        successDetails: (payload) => ({
          outputReady: Boolean(payload?.url),
          width: payload?.width || null,
          height: payload?.height || null,
          coverage: Number((maskState.coverage * 100).toFixed(2))
        })
      });

      setEraseUrl(data.url || null);
      setViewportMode('compare');
      setLastRenderSummary(`${quality === 'hq' ? 'HD' : 'Standard'} object removal ready`);
    } catch (nextError) {
      console.error(nextError);
      const message = nextError?.message || 'Object removal failed';
      setError(message);
      setLastRenderSummary(`Failed: ${message}`);
      logDebug(runId, scope, 'complete', 'failed', message);
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [
    applyMaskArtifactToCanvas,
    cropMarginPx,
    cropToMask,
    exportMaskBlob,
    imageId,
    latestMaskForErase,
    latestMaskSourceLabel,
    logDebug,
    maskDilatePx,
    maskFeatherPx,
    maxSide,
    quality,
    refreshHealth,
    requestJson,
    sdxlGuidance,
    sdxlSeed,
    sdxlSteps,
    sdxlStrength,
    startDebugRun,
    store
    ,
    syncMaskMetrics
  ]);

  const runEnhance = useCallback(async () => {
    if (!imageId) return;

    setError(null);
    setIsRunning(true);
    const scope = 'Enhancement';
    const runId = startDebugRun(scope, `Running ${enhanceMode.replace('_', ' ')} enhancement`);
    try {
      const data = await requestJson({
        runId,
        scope,
        step: 'enhance',
        url: withStore('/creative-studio/photo-magic/enhance', store),
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_id: imageId,
            mode: enhanceMode,
            source_max_side: maxSide,
            strength: enhanceStrength,
            upscale_factor: upscaleFactor
          })
        },
        successMessage: 'Enhancement pass rendered',
        failureMessage: 'Enhancement pass failed',
        successDetails: (payload) => ({
          outputReady: Boolean(payload?.url),
          engine: payload?.engine || null,
          mode: enhanceMode
        })
      });

      setEnhanceUrl(data.url || null);
      setViewportMode('compare');
      setLastRenderSummary(`${enhanceMode.replace('_', ' ')} pass ready${data.engine ? ` via ${data.engine}` : ''}`);
    } catch (nextError) {
      console.error(nextError);
      const message = nextError?.message || 'Enhancement pass failed';
      setError(message);
      setLastRenderSummary(`Failed: ${message}`);
      logDebug(runId, scope, 'complete', 'failed', message);
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [
    enhanceMode,
    enhanceStrength,
    imageId,
    logDebug,
    maxSide,
    refreshHealth,
    requestJson,
    startDebugRun,
    store,
    upscaleFactor
  ]);

  const runRelight = useCallback(async () => {
    if (!imageId) return;

    setError(null);
    setIsRunning(true);
    const runId = startDebugRun('Lighting Stage', `Running ${relightPreset.replace('_', ' ')} relight preset`);
    try {
      const data = await requestJson({
        runId,
        scope: 'Lighting Stage',
        step: 'relight',
        url: withStore('/creative-studio/photo-magic/relight', store),
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_id: imageId,
            mask_output_id: currentMaskOutputId,
            preset: relightPreset,
            subject_boost: subjectBoost,
            background_exposure: backgroundExposure,
            warmth: relightWarmth,
            shadow_opacity: shadowOpacity,
            shadow_blur_px: shadowBlurPx,
            shadow_offset_x: shadowOffsetX,
            shadow_offset_y: shadowOffsetY
          })
        },
        successMessage: 'Lighting pass rendered',
        failureMessage: 'Relight stage failed',
        successDetails: (payload) => ({
          resultReady: Boolean(payload?.url),
          maskReady: Boolean(payload?.mask?.url),
          preset: relightPreset
        })
      });

      setRelightUrl(data.url || null);
      setRelightMaskUrl(data.mask?.url || null);
      setRelightMaskOutputId(data.mask?.output_id || null);
      setViewportMode('compare');
      setLastRenderSummary(`${relightPreset.replace('_', ' ')} relight ready`);
    } catch (nextError) {
      console.error(nextError);
      const message = nextError?.message || 'Relight stage failed';
      setError(message);
      setLastRenderSummary(`Failed: ${message}`);
      logDebug(runId, 'Lighting Stage', 'complete', 'failed', message);
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [
    backgroundExposure,
    currentMaskOutputId,
    imageId,
    logDebug,
    refreshHealth,
    relightPreset,
    relightWarmth,
    requestJson,
    shadowBlurPx,
    shadowOffsetX,
    shadowOffsetY,
    shadowOpacity,
    startDebugRun,
    store,
    subjectBoost
  ]);

  const runExpand = useCallback(async () => {
    if (!imageId) return;

    setError(null);
    setIsRunning(true);
    const scope = 'Canvas Expand';
    const runId = startDebugRun(scope, `Expanding canvas to ${expandAspectRatio} from ${expandAnchor}`);
    try {
      const data = await requestJson({
        runId,
        scope,
        step: 'expand',
        url: withStore('/creative-studio/photo-magic/expand', store),
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_id: imageId,
            prompt: expandPrompt,
            negative_prompt: expandNegativePrompt,
            aspect_ratio: expandAspectRatio,
            anchor: expandAnchor,
            num_inference_steps: expandSteps,
            guidance_scale: expandGuidance,
            strength: expandStrength,
            seed: expandSeed,
            feather_px: expandFeatherPx
          })
        },
        successMessage: 'Canvas expand render completed',
        failureMessage: 'Canvas expand failed',
        successDetails: (payload) => ({
          outputReady: Boolean(payload?.url),
          maskReady: Boolean(payload?.mask?.url),
          aspectRatio: payload?.aspect_ratio || expandAspectRatio
        })
      });

      setExpandUrl(data.url || null);
      setExpandMaskUrl(data.mask?.url || null);
      setExpandMaskOutputId(data.mask?.output_id || null);
      setViewportMode('compare');
      setLastRenderSummary(`Canvas expanded to ${data.aspect_ratio || expandAspectRatio}`);
    } catch (nextError) {
      console.error(nextError);
      const message = nextError?.message || 'Canvas expand failed';
      setError(message);
      setLastRenderSummary(`Failed: ${message}`);
      logDebug(runId, scope, 'complete', 'failed', message);
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [
    expandAnchor,
    expandAspectRatio,
    expandFeatherPx,
    expandGuidance,
    expandNegativePrompt,
    expandPrompt,
    expandSeed,
    expandSteps,
    expandStrength,
    imageId,
    logDebug,
    refreshHealth,
    requestJson,
    startDebugRun,
    store
  ]);

  const connectedStack = useMemo(
    () => [
      {
        id: 'rmbg2',
        title: 'Auto Cutout',
        model: 'BiRefNet matting',
        ready: rmbg2Ready,
        description: 'Primary foreground isolation for the current image.',
        error: aiHealthPayload?.errors?.rmbg2 || ''
      },
      {
        id: 'sam2',
        title: 'Precision Mask',
        model: 'Meta SAM2',
        ready: sam2Ready,
        description: 'Point-guided mask refinement on the current source.',
        error: aiHealthPayload?.errors?.sam2 || ''
      },
      {
        id: 'select',
        title: 'Prompt Selection',
        model: sam2Ready ? 'Gemini Vision + SAM2' : 'Gemini Vision',
        ready: Boolean(geminiReady),
        description: 'Language-based target pickup that resolves into a real mask.',
        error: geminiReady ? '' : 'GEMINI_API_KEY is not configured.'
      },
      {
        id: 'lama',
        title: 'Standard Remove',
        model: standardEraseModel,
        ready: standardEraseReady,
        description: 'Fast object removal for working iterations.',
        error: standardEraseState?.error || aiHealthPayload?.errors?.lama || ''
      },
      {
        id: 'sdxl',
        title: 'HD Remove',
        model: 'SDXL inpaint',
        ready: Boolean(hqOk),
        description: 'GPU-backed final cleanup render for high scrutiny output.',
        error: hqReason || ''
      },
      {
        id: 'relight',
        title: 'Lighting Stage',
        model: 'Relight + cast shadow',
        ready: relightReady,
        description: 'Subject lift, background grade, and contact shadow pass on the active source.',
        error: aiHealthPayload?.errors?.relight || aiHealthPayload?.errors?.rmbg2 || ''
      },
      {
        id: 'expand',
        title: 'Canvas Expand',
        model: 'SDXL expand',
        ready: expandReady,
        description: 'Outpaint and regenerate scene space around the active source canvas.',
        error: health?.photo_magic?.hq?.health?.payload?.errors?.sdxl_expand || hqReason || ''
      },
      {
        id: 'realesrgan',
        title: 'Enhancement',
        model: 'Real-ESRGAN + restoration',
        ready: realEsrganReady,
        description: 'Upscale and recovery passes from the same source chain.',
        error: aiHealthPayload?.errors?.realesrgan || ''
      }
    ],
    [
      aiHealthPayload?.errors?.lama,
      aiHealthPayload?.errors?.realesrgan,
      aiHealthPayload?.errors?.relight,
      aiHealthPayload?.errors?.rmbg2,
      aiHealthPayload?.errors?.sam2,
      expandReady,
      geminiReady,
      health?.photo_magic?.hq?.health?.payload?.errors?.sdxl_expand,
      hqOk,
      hqReason,
      lamaReady,
      realEsrganReady,
      relightReady,
      rmbg2Ready,
      sam2Ready,
      standardEraseModel,
      standardEraseReady,
      standardEraseState?.error
    ]
  );

  const visibleStack = useMemo(() => {
    const alwaysShow = new Set(['rmbg2', 'lama', 'select']);
    return connectedStack.filter((item) => alwaysShow.has(item.id) || item.ready);
  }, [connectedStack]);
  const readyCount = visibleStack.filter((item) => item.ready).length;

  const availableTools = useMemo(() => {
    const gating = {
      expand: expandReady,
    };
    return Object.fromEntries(
      Object.entries(TOOL_DEFINITIONS).filter(([key]) => gating[key] === undefined || gating[key])
    );
  }, [expandReady]);

  const stageConfig = TOOL_DEFINITIONS[tool] || TOOL_DEFINITIONS['erase'];
  const outputCards = useMemo(() => {
    if (tool === 'remove_bg') {
      return [
        {
          id: 'cutout',
          title: 'Background Removed',
          engine: 'BiRefNet / SAM2',
          url: cutoutUrl,
          empty: 'Run background removal to produce a clean cutout.',
          promoteable: true,
          promoteLabel: 'Use as source',
          promoteStage: 'Cutout source',
          nextTool: 'erase',
          checker: true,
          primary: true
        },
        {
          id: 'mask',
          title: 'Selection Mask',
          engine: 'Segmentation mask',
          url: maskUrl,
          empty: 'Mask appears after the background removal pass.',
          promoteable: false,
          maskAction: maskUrl ? 'Use for removal' : null,
          checker: false,
          primary: false
        }
      ];
    }

    if (tool === 'select' || tool === 'erase') {
      const cards = [];
      if (selectionCutoutUrl) {
        cards.push({
          id: 'selection',
          title: 'Detected Object',
          engine: selectionMeta?.label ? `AI: ${selectionMeta.label}` : 'Smart Select',
          url: selectionCutoutUrl,
          empty: 'Use Smart Select to detect and extract an object.',
          promoteable: true,
          promoteLabel: 'Use as source',
          promoteStage: selectionMeta?.label ? `${selectionMeta.label} source` : 'Selected source',
          nextTool: 'erase',
          checker: true,
          primary: false
        });
      }
      cards.push({
        id: 'erase',
        title: 'Cleaned Image',
        engine: quality === 'hq' ? 'SDXL HQ' : (standardEraseProvider === 'replicate' ? 'FLUX Fill' : 'LaMa'),
        url: eraseUrl,
        empty: 'Select the area to remove, then run the removal engine.',
        promoteable: true,
        promoteLabel: 'Use as source',
        promoteStage: quality === 'hq' ? 'HD remove' : 'Removed source',
        nextTool: 'relight',
        checker: false,
        primary: true
      });
      return cards;
    }

    if (tool === 'relight') {
      return [
        {
          id: 'relight',
          title: 'Relit Image',
          engine: 'Relight + shadow stage',
          url: relightUrl,
          empty: 'Apply lighting to reshape your image with studio-quality light.',
          promoteable: true,
          promoteLabel: 'Use as source',
          promoteStage: 'Relit source',
          nextTool: 'expand',
          checker: false,
          primary: true
        },
        {
          id: 'relight-mask',
          title: 'Subject Mask',
          engine: 'Subject matte',
          url: relightMaskUrl,
          empty: 'Subject mask generated automatically during lighting.',
          promoteable: false,
          checker: false,
          primary: false
        }
      ];
    }

    if (tool === 'expand') {
      return [
        {
          id: 'expand',
          title: 'Extended Canvas',
          engine: 'SDXL expand',
          url: expandUrl,
          empty: 'Extend the frame and generate the missing background area.',
          promoteable: true,
          promoteLabel: 'Use as source',
          promoteStage: 'Expanded source',
          nextTool: 'enhance',
          checker: false,
          primary: true
        },
        {
          id: 'expand-mask',
          title: 'Extension Mask',
          engine: 'Outpaint mask',
          url: expandMaskUrl,
          empty: 'The extension mask appears after the canvas expand pass.',
          promoteable: false,
          checker: false,
          primary: false
        }
      ];
    }

    return [
      {
        id: 'enhance',
        title: 'Enhanced Image',
        engine: enhanceMode === 'upscale' ? 'Real-ESRGAN' : 'Enhancement pipeline',
        url: enhanceUrl,
        empty: 'Run enhancement to produce a polished render.',
        promoteable: true,
        promoteLabel: 'Use as source',
        promoteStage: 'Enhanced source',
        nextTool: 'enhance',
        checker: false,
        primary: true
      }
    ];
  }, [cutoutUrl, enhanceMode, enhanceUrl, eraseUrl, expandMaskUrl, expandUrl, maskUrl, quality, relightMaskUrl, relightUrl, selectionCutoutUrl, selectionMaskUrl, selectionMeta?.label, tool]);

  const activeMaskUrl =
    tool === 'erase'
      ? (selectionMaskUrl || maskUrl)
      : tool === 'select'
        ? selectionMaskUrl
        : tool === 'relight'
          ? relightMaskUrl
          : tool === 'expand'
            ? expandMaskUrl
            : maskUrl;

  const primaryOutput = outputCards.find((item) => item.primary && item.url) || outputCards.find((item) => item.url) || null;
  const primaryOutputUrl = primaryOutput?.url || null;
  const canCompare = Boolean(imageSrc && primaryOutputUrl);
  const sourceDimensions = imageMeta?.width && imageMeta?.height ? `${imageMeta.width} x ${imageMeta.height}px` : 'No source';
  const activeViewOptions = useMemo(
    () => [
      { id: 'source', label: 'Source', enabled: Boolean(imageSrc) },
      { id: 'compare', label: 'Compare', enabled: canCompare },
      { id: 'result', label: 'Result', enabled: Boolean(primaryOutputUrl) },
      { id: 'mask', label: 'Mask', enabled: Boolean(activeMaskUrl) }
    ],
    [activeMaskUrl, canCompare, imageSrc, primaryOutputUrl]
  );

  useEffect(() => {
    if (precisionMode) setViewportMode('source');
  }, [precisionMode]);

  useEffect(() => {
    const compareAvailable = Boolean(imageSrc && primaryOutputUrl);
    const maskAvailable = Boolean(activeMaskUrl);
    const resultAvailable = Boolean(primaryOutputUrl);

    if (!imageSrc && viewportMode !== 'source') {
      setViewportMode('source');
      return;
    }
    if (viewportMode === 'compare' && !compareAvailable) {
      setViewportMode(imageSrc ? 'source' : 'source');
      return;
    }
    if (viewportMode === 'result' && !resultAvailable) {
      setViewportMode(imageSrc ? 'source' : 'source');
      return;
    }
    if (viewportMode === 'mask' && !maskAvailable) {
      setViewportMode(compareAvailable ? 'compare' : 'source');
    }
  }, [activeMaskUrl, imageSrc, primaryOutputUrl, tool, viewportMode]);

  const sourcePreviewStyles = cutoutUrl && tool === 'remove_bg' ? makeTransparentBg() : undefined;
  const isBusy = isUploading || isRunning;
  const cleanPlateMaskReady = maskMetrics.hasMask;
  const maskCoverageLabel = `${(maskMetrics.coverage * 100).toFixed(maskMetrics.coverage > 0 && maskMetrics.coverage < 0.1 ? 1 : 0)}%`;

  const renderCanvas = () => {
    if (!imageSrc) {
      return (
        <div className="flex min-h-[720px] items-center justify-center px-8">
          <div className="relative flex max-w-xl flex-col items-center text-center">
            <div className="absolute left-1/2 top-1/2 h-24 w-px -translate-x-1/2 -translate-y-1/2 bg-gray-200" />
            <div className="absolute left-1/2 top-1/2 h-px w-24 -translate-x-1/2 -translate-y-1/2 bg-gray-200" />
            <Crosshair className="relative z-10 h-6 w-6 text-gray-400" />
            <div className="mt-6 text-sm font-medium tracking-wide text-gray-900">Upload a photo to start editing</div>
            <div className="mt-2 max-w-md text-sm leading-6 text-gray-500">
              Remove backgrounds, erase objects, adjust lighting, extend canvas, and enhance quality — all in one place. Each result can be used as input for the next step.
            </div>
            <div className="mt-6">
              <Button variant="primary" onClick={onPickFile} disabled={isUploading}>
                <ImagePlus className="h-4 w-4" />
                Upload Photo
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (viewportMode === 'mask' && activeMaskUrl) {
      return (
        <div className="flex min-h-[720px] items-center justify-center p-10">
          <img src={activeMaskUrl} alt="Mask artifact" className="block max-h-[780px] max-w-full rounded-xl border border-gray-100 bg-gray-50" />
        </div>
      );
    }

    if (viewportMode === 'result' && primaryOutputUrl) {
      return (
        <div className="flex min-h-[720px] items-center justify-center p-10">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-0" style={primaryOutput?.checker ? makeTransparentBg() : undefined}>
            <img src={primaryOutputUrl} alt={primaryOutput?.title || 'Result'} className="block max-h-[780px] max-w-full rounded-xl" />
          </div>
        </div>
      );
    }

    if (viewportMode === 'compare' && primaryOutputUrl) {
      return (
        <div className="flex min-h-[720px] items-center justify-center p-10">
          <div className="relative inline-block overflow-hidden rounded-xl border border-gray-100 bg-gray-50" style={primaryOutput?.checker ? makeTransparentBg() : undefined}>
            <img src={primaryOutputUrl} alt={primaryOutput?.title || 'Result'} className="block max-h-[780px] max-w-full rounded-xl" />
            <div className="pointer-events-none absolute inset-0">
              <img
                src={imageSrc}
                alt="Source asset"
                className="block h-full w-full object-contain"
                style={{ clipPath: `inset(0 ${100 - compareSplit}% 0 0)` }}
              />
            </div>
            <div className="pointer-events-none absolute inset-y-0 border-r border-white/80" style={{ left: `${compareSplit}%` }} />
            <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-white/50 bg-white/75 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-500 shadow-sm" style={{ backdropFilter: 'blur(24px)' }}>
              Source
            </div>
            <div className="pointer-events-none absolute right-4 top-4 rounded-xl border border-white/50 bg-white/75 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-500 shadow-sm" style={{ backdropFilter: 'blur(24px)' }}>
              Result
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-[720px] items-center justify-center p-10">
        <div className="relative inline-block select-none" onClick={addPointFromEvent}>
          <div className="relative rounded-xl border border-gray-100 bg-gray-50 overflow-hidden" style={sourcePreviewStyles}>
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Active source asset"
              className="block max-h-[780px] max-w-full rounded-sm"
              style={{ filter: adjStyles.filter, transform: adjStyles.transform, transition: 'filter 0.15s ease, transform 0.2s ease' }}
              onLoad={() => ensureMaskCanvasSize()}
            />
            {adjustments.vignette > 0 && <div className="pm-vignette-overlay" style={{ '--pm-vignette': adjStyles['--pm-vignette'] }} />}
            {adjustments.grain > 0 && <div className="pm-grain-overlay" style={{ '--pm-grain': adjStyles['--pm-grain'] }} />}
          </div>

          {(tool === 'remove_bg' || tool === 'erase') && activeMaskUrl && (
            <img
              src={activeMaskUrl}
              alt="Mask overlay"
              className="pointer-events-none absolute inset-0 h-full w-full rounded-sm object-contain opacity-20 mix-blend-screen"
            />
          )}

          {tool === 'remove_bg' &&
            precisionMode &&
            points.map((point, index) => (
              <div
                key={`${index}-${point.label}`}
                className={cn(
                  'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                  point.label ? 'border-emerald-100 bg-emerald-500/95' : 'border-rose-100 bg-rose-500/95'
                )}
                style={{ left: `${point.x_norm * 100}%`, top: `${point.y_norm * 100}%`, width: 10, height: 10 }}
                title={point.label ? 'keep point' : 'remove point'}
              />
            ))}

          {tool === 'erase' && viewportMode === 'source' && (
            <canvas
              ref={maskCanvasRef}
              className="absolute inset-0 h-full w-full rounded-sm"
              style={{ cursor: 'crosshair' }}
              onPointerDown={onMaskPointerDown}
              onPointerMove={onMaskPointerMove}
              onPointerUp={onMaskPointerUp}
              onPointerCancel={onMaskPointerUp}
            />
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="px-4 py-4 text-gray-900" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div className="mx-auto max-w-[1880px] overflow-hidden rounded-2xl border border-gray-200/60 bg-white/80 shadow-xl" style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 text-white shadow-lg shadow-indigo-500/20">
              <Wand2 className="h-4 w-4 pm-sparkle-icon" />
            </div>
            <div>
              <span className="text-[15px] font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">
                {editorMode === 'photo' ? 'Photo Magic' : 'Video Magic'}
              </span>
              <div className="flex items-center gap-1.5 mt-[-2px]">
                <span className="text-[9px] font-semibold text-indigo-500 tracking-widest uppercase">Studio Engine</span>
                <div className="w-1 h-1 rounded-full bg-indigo-400" />
              </div>
              {editorMode === 'photo' ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{sourceStage}</span>
                  <span className="h-1 w-1 rounded-full bg-gray-300" />
                  <span>{sourceLabel || 'No image loaded'}</span>
                  <span className="h-1 w-1 rounded-full bg-gray-300" />
                  <span>{sourceDimensions}</span>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {videoFileInfo ? (
                    <>
                      <span>{videoFileInfo.width}x{videoFileInfo.height}</span>
                      <span className="h-1 w-1 rounded-full bg-gray-300" />
                      <span>{formatVideoTime(videoFileInfo.duration)}</span>
                      <span className="h-1 w-1 rounded-full bg-gray-300" />
                      <span>{(videoFileInfo.size / 1024 / 1024).toFixed(1)}MB</span>
                    </>
                  ) : (
                    <span>Awaiting video</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* ── Mode Toggle ── */}
            <div className="pm-mode-toggle">
              <div className="pm-mode-pill" style={{ left: editorMode === 'photo' ? 3 : '50%', width: 'calc(50% - 3px)' }} />
              <button type="button" className={editorMode === 'photo' ? 'active' : ''} onClick={() => setEditorMode('photo')}>
                <Camera className="h-3.5 w-3.5" /> Photo
              </button>
              <button type="button" className={editorMode === 'video' ? 'active' : ''} onClick={() => setEditorMode('video')}>
                <Film className="h-3.5 w-3.5" /> Video
              </button>
            </div>

            {editorMode === 'photo' && (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-1.5 shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-50 blur-[2px]" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 pm-pulse-badge" />
                </span>
                <span className="text-[11px] font-semibold text-gray-600">
                  {readyCount}/{visibleStack.length} Online
                </span>
              </div>
            )}

            {editorMode === 'photo' && (
              <Button variant="secondary" onClick={refreshHealth} disabled={isHealthLoading}>
                <RefreshCw className={cn('h-4 w-4', isHealthLoading ? 'animate-spin' : '')} />
                Sync
              </Button>
            )}

            {editorMode === 'photo' ? (
              <>
                <button
                  type="button"
                  onClick={onPickFile}
                  disabled={isUploading}
                  className="pm-shimmer flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold shadow-md shadow-blue-500/20 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import Image
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
                {imageSrc && (
                  <button
                    type="button"
                    onClick={() => setShowExportModal(true)}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-md transition-transform hover:scale-105"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => videoFileInputRef.current?.click()}
                  disabled={isVideoUploading}
                  className="pm-shimmer flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold shadow-md shadow-blue-500/20 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isVideoUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {isVideoUploading ? 'Uploading...' : 'Import Video'}
                </button>
                <input ref={videoFileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/x-msvideo" className="hidden" onChange={handleVideoUpload} />
              </>
            )}
          </div>
        </div>

        {editorMode === 'photo' ? (
        <div className="grid xl:grid-cols-[260px_minmax(0,1fr)_360px]">
          {/* ── Left Panel: Photo Adjustments ── */}
          <div className="pm-glass-panel pm-scroll pm-left-panel flex flex-col border-r border-white/60 p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.45)', boxShadow: '20px 0 40px rgba(0,0,0,0.02)' }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-400 flex items-center justify-center">
                  <Palette className="h-3 w-3 text-white" />
                </div>
                <span className="text-[12px] font-bold tracking-tight text-gray-700">Adjustments</span>
              </div>
              {hasAdjustments ? (
                <button type="button" onClick={resetAdjustments} className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors flex items-center gap-1">
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              ) : null}
            </div>

            <AccordionSection icon={Sun} title="Light" defaultOpen>
              <Slider label="Brightness" value={adjustments.brightness} onChange={(e) => setAdj('brightness', +e.target.value)} min={-100} max={100} />
              <Slider label="Contrast" value={adjustments.contrast} onChange={(e) => setAdj('contrast', +e.target.value)} min={-100} max={100} />
              <Slider label="Exposure" value={adjustments.exposure} onChange={(e) => setAdj('exposure', +e.target.value)} min={-100} max={100} />
              <Slider label="Highlights" value={adjustments.highlights} onChange={(e) => setAdj('highlights', +e.target.value)} min={-100} max={100} />
              <Slider label="Shadows" value={adjustments.shadows} onChange={(e) => setAdj('shadows', +e.target.value)} min={-100} max={100} />
            </AccordionSection>

            <AccordionSection icon={Droplets} title="Color">
              <Slider label="Saturation" value={adjustments.saturation} onChange={(e) => setAdj('saturation', +e.target.value)} min={-100} max={100} />
              <Slider label="Vibrance" value={adjustments.vibrance} onChange={(e) => setAdj('vibrance', +e.target.value)} min={-100} max={100} />
              <Slider label="Temperature" value={adjustments.temperature} onChange={(e) => setAdj('temperature', +e.target.value)} min={-100} max={100} />
              <Slider label="Tint" value={adjustments.tint} onChange={(e) => setAdj('tint', +e.target.value)} min={-100} max={100} />
            </AccordionSection>

            <AccordionSection icon={Contrast} title="Detail">
              <Slider label="Sharpness" value={adjustments.sharpness} onChange={(e) => setAdj('sharpness', +e.target.value)} min={0} max={100} />
              <Slider label="Clarity" value={adjustments.clarity} onChange={(e) => setAdj('clarity', +e.target.value)} min={-100} max={100} />
              <Slider label="Blur" value={adjustments.blur} onChange={(e) => setAdj('blur', +e.target.value)} min={0} max={100} />
            </AccordionSection>

            <AccordionSection icon={Sparkles} title="Effects">
              <Slider label="Vignette" value={adjustments.vignette} onChange={(e) => setAdj('vignette', +e.target.value)} min={0} max={100} />
              <Slider label="Grain" value={adjustments.grain} onChange={(e) => setAdj('grain', +e.target.value)} min={0} max={100} />
              <Slider label="Fade" value={adjustments.fade} onChange={(e) => setAdj('fade', +e.target.value)} min={0} max={100} />
            </AccordionSection>

            <AccordionSection icon={Crop} title="Transform">
              <Slider label="Rotate" value={adjustments.rotate} onChange={(e) => setAdj('rotate', +e.target.value)} min={-180} max={180} />
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setAdj('flipH', !adjustments.flipH)}
                  className={cn('pm-icon-btn flex-1', adjustments.flipH && 'active')}
                  title="Flip horizontal"
                >
                  <FlipHorizontal2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setAdj('flipV', !adjustments.flipV)}
                  className={cn('pm-icon-btn flex-1', adjustments.flipV && 'active')}
                  title="Flip vertical"
                >
                  <FlipVertical2 className="h-4 w-4" />
                </button>
              </div>
            </AccordionSection>

            <AccordionSection icon={Sunset} title="Filters">
              <div className="grid grid-cols-3 gap-1.5">
                {PHOTO_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => applyFilter(f)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl p-1.5 transition-all text-center',
                      activeFilter === f.id
                        ? 'bg-indigo-50 border border-indigo-200 shadow-sm'
                        : 'border border-transparent hover:bg-gray-50 hover:border-gray-100'
                    )}
                  >
                    <div
                      className="w-full aspect-square rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden"
                      style={imageSrc ? {
                        backgroundImage: `url(${imageSrc})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: buildFilterStyles({ ...DEFAULT_ADJUSTMENTS, ...f.adj }).filter || 'none'
                      } : undefined}
                    />
                    <span className={cn(
                      'text-[9px] font-semibold uppercase tracking-wider',
                      activeFilter === f.id ? 'text-indigo-600' : 'text-gray-400'
                    )}>
                      {f.label}
                    </span>
                  </button>
                ))}
              </div>
            </AccordionSection>

            {hasAdjustments ? (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={resetAdjustments}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5 pm-btn-hover"
                >
                  <RotateCcw className="h-3 w-3" /> Reset All Adjustments
                </button>
              </div>
            ) : null}
          </div>

          {/* ── Center: Canvas Viewport ── */}
          <div className="relative min-w-0 overflow-hidden bg-[#f0f0f3] p-6">
            {/* Floating gradient orbs */}
            <div className="pointer-events-none absolute -top-20 -left-20 h-64 w-64 rounded-full bg-purple-300/20 opacity-70" style={{ filter: 'blur(80px)', animation: 'pm-float-gentle 6s infinite ease-in-out' }} />
            <div className="pointer-events-none absolute -bottom-16 right-[20%] h-64 w-64 rounded-full bg-blue-300/20 opacity-70" style={{ filter: 'blur(80px)', animation: 'pm-float-gentle 8s infinite ease-in-out reverse' }} />

            <div className="rounded-2xl border border-white bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)]">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-5 py-3">
                <div>
                  <Label>Viewport</Label>
                  <div className="mt-1 text-sm font-medium text-gray-900">{stageConfig.label}</div>
                </div>

                <div className="flex gap-1 rounded-xl bg-gray-100 p-0.5">
                  {activeViewOptions.map((view) => (
                    <button
                      key={view.id}
                      type="button"
                      disabled={!view.enabled}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-40',
                        viewportMode === view.id
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      )}
                      onClick={() => setViewportMode(view.id)}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative overflow-hidden bg-[#f0f0f3]" style={makeTransparentBg()}>
                {renderCanvas()}

                {imageSrc ? (
                  <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-white/50 bg-white/75 px-3 py-1.5 text-[11px] font-mono text-gray-500 shadow-sm" style={{ backdropFilter: 'blur(24px)' }}>
                    {sourceDimensions}
                  </div>
                ) : null}

                <div className="pointer-events-none absolute bottom-4 right-4 rounded-xl border border-white/50 bg-white/75 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-gray-500 shadow-sm" style={{ backdropFilter: 'blur(24px)' }}>
                  {viewportMode}
                </div>

                {/* Floating engine badges */}
                <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-10">
                  {visibleStack.filter(item => item.ready).map((item) => (
                    <div key={item.id} className="pm-hover-lift flex items-center gap-2.5 rounded-xl border border-white/50 bg-white/75 px-3 py-1.5 shadow-sm cursor-default" style={{ backdropFilter: 'blur(24px)' }}>
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100">
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      </div>
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 leading-none">Online</div>
                        <div className="text-[11px] font-bold text-gray-800 leading-none mt-0.5">{item.title}</div>
                      </div>
                      <span className="relative flex h-1.5 w-1.5 ml-1">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      </span>
                    </div>
                  ))}
                </div>

              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 px-5 py-3">
                <div className="text-xs text-gray-500">
                  {tool === 'remove_bg' && precisionMode
                    ? 'Click to add keep points. Hold Alt or Cmd for remove points.'
                    : tool === 'relight'
                      ? 'Adjust lighting to reshape your image. Use Compare to preview changes.'
                      : tool === 'expand'
                        ? 'Extend the canvas and regenerate the missing area. Use the result as your new starting image.'
                    : tool === 'erase' && imageSrc
                      ? 'Use Smart Select or paint a mask manually, then remove. Switch to Compare to preview.'
                      : 'Use the tools on the right to process your image. Each result can be used as input for the next step.'}
                </div>

                {viewportMode === 'compare' && canCompare ? (
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-gray-400">Split</span>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      value={compareSplit}
                      onChange={(event) => setCompareSplit(clamp(toNumber(event.target.value, 56), 10, 90))}
                      className="w-40 accent-indigo-500"
                    />
                    <span className="text-[11px] font-mono text-gray-400">{compareSplit}%</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* ── Right Panel: AI Magic Tools ── */}
          <div className="pm-glass-panel pm-scroll pm-right-panel flex flex-col border-l border-white p-5" style={{ background: 'rgba(255,255,255,0.40)', boxShadow: '-20px 0 40px rgba(0,0,0,0.03)' }}>
            <div className="mb-6">
              <h2 className="text-[13px] font-bold tracking-widest uppercase text-gray-400 mb-4 flex items-center gap-2">
                <Layers3 className="h-4 w-4" /> Operation Mode
              </h2>
              <div className="relative flex p-1 rounded-xl border border-gray-200/50 shadow-inner" style={{ background: 'rgba(243,244,246,0.8)' }}>
                {Object.entries(availableTools).map(([value, config]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setTool(value);
                      setError(null);
                      if (value !== 'remove_bg') setPrecisionMode(false);
                      if (value === 'erase' || value === 'relight' || value === 'expand') setViewportMode('source');
                    }}
                    className={cn(
                      'flex-1 rounded-lg px-2 py-1.5 text-center text-[12px] font-medium transition-all relative z-10',
                      tool === value
                        ? 'bg-white text-indigo-600 font-semibold shadow-sm'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-white/50'
                    )}
                  >
                    {config.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Remove Background ── */}
            {tool === 'remove_bg' ? (
              <div className="mt-4 space-y-3 pm-section-enter">
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <Label>Processing Settings</Label>
                  <div className="mt-4 space-y-3">
                    <Slider label="Max Resolution" tooltip="Maximum image dimension for processing" value={maxSide} onChange={(e) => setMaxSide(clamp(toNumber(e.target.value, 2048), 256, 8192))} min={256} max={8192} step={256} />
                    <Slider label="Edge Expansion" tooltip="Grow the selection boundary outward" value={maskDilatePx} onChange={(e) => setMaskDilatePx(clamp(toNumber(e.target.value, 0), 0, 64))} min={0} max={64} />
                    <Slider label="Edge Softness" tooltip="Smooth the selection edges" value={maskFeatherPx} onChange={(e) => setMaskFeatherPx(clamp(toNumber(e.target.value, 0), 0, 64))} min={0} max={64} />
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <Label>Background Removal</Label>
                  <div className="mt-2 text-sm text-gray-500">Automatically remove the background, then fine-tune edges if needed.</div>
                  <div className="mt-4 space-y-2">
                    <Button variant="primary" onClick={runRemoveBg} disabled={!imageId || isRunning || !rmbg2Ready} className="w-full justify-center pm-btn-hover">
                      <Wand2 className="h-4 w-4 pm-sparkle-icon" />
                      Remove Background
                    </Button>
                    <Button variant="secondary" onClick={() => { setPrecisionMode((prev) => !prev); setViewportMode('source'); }} disabled={!imageId || isRunning || !sam2Ready} className="w-full justify-center pm-btn-hover">
                      <Crosshair className="h-4 w-4" />
                      {precisionMode ? 'Exit Precision Mode' : 'Refine Edges'}
                    </Button>
                    {precisionMode ? (
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3 pm-section-enter">
                        <div className="text-sm font-medium text-gray-900">Edge Guide Points</div>
                        <div className="mt-1.5 text-xs leading-5 text-gray-500">Click to add keep points. Hold Alt/Cmd for remove points.</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="primary" onClick={runRefine} disabled={!points.length || isRunning} className="pm-btn-hover">
                            Apply Refinement ({points.length})
                          </Button>
                          <Button variant="secondary" onClick={() => setPoints([])} disabled={!points.length || isRunning}>Clear</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── Object Remover (merged select + erase) ── */}
            {tool === 'erase' ? (
              <div className="mt-4 space-y-3 pm-section-enter">
                {/* Mask method toggle */}
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <Label>How to Select</Label>
                  <div className="mt-3">
                    <Toggle value={maskMethod} onChange={setMaskMethod} options={[
                      { value: 'smart', label: 'Smart Select', title: 'AI-powered detection using text prompts' },
                      { value: 'brush', label: 'Manual Brush', title: 'Paint the mask by hand' }
                    ]} />
                  </div>
                </div>

                {/* Smart Select */}
                {maskMethod === 'smart' ? (
                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm pm-section-enter">
                    <div className="flex items-center gap-2 mb-2">
                      <ScanSearch className="h-4 w-4 text-indigo-400" />
                      <Label>Smart Select</Label>
                    </div>
                    <div className="text-xs text-gray-500 mb-3">Describe what to detect. AI will find and mask it.</div>
                    <div className="space-y-3">
                      <Slider label="Max Resolution" tooltip="Maximum image dimension" value={maxSide} onChange={(e) => setMaxSide(clamp(toNumber(e.target.value, 2048), 256, 8192))} min={256} max={8192} step={256} />
                      <Slider label="Edge Expansion" tooltip="Grow the boundary outward" value={maskDilatePx} onChange={(e) => setMaskDilatePx(clamp(toNumber(e.target.value, 0), 0, 64))} min={0} max={64} />
                      <Slider label="Edge Softness" tooltip="Smooth the edges" value={maskFeatherPx} onChange={(e) => setMaskFeatherPx(clamp(toNumber(e.target.value, 0), 0, 64))} min={0} max={64} />
                    </div>
                    <div className="mt-3">
                      <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">What to detect</div>
                      <Input value={selectionPrompt} onChange={(e) => setSelectionPrompt(e.target.value)} placeholder="e.g. price tag, logo, shoe, hand..." />
                    </div>
                    {selectionMeta ? (
                      <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-2.5 pm-section-enter">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">{selectionMeta.label || 'Detected'}</span>
                          <span className="text-[11px] font-mono font-semibold text-emerald-600">{Math.round((selectionMeta.confidence || 0) * 100)}%</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <Button variant="primary" onClick={runSelect} disabled={!imageId || isRunning || !geminiReady || !selectionPrompt.trim()} className="w-full justify-center pm-btn-hover">
                        <ScanSearch className="h-4 w-4" />
                        Detect Object
                      </Button>
                    </div>
                    {selectionMaskUrl ? (
                      <div className="mt-2 space-y-1.5 pm-section-enter">
                        <Button variant="primary" onClick={() => { applyMaskArtifactToCanvas(selectionMaskUrl); setMaskMethod('brush'); }} disabled={isBusy} className="w-full justify-center pm-btn-hover">
                          <Eraser className="h-4 w-4" /> Remove Object
                        </Button>
                        <Button variant="secondary" onClick={() => promoteOutputToSource({ url: selectionCutoutUrl, stageLabel: selectionMeta?.label ? `${selectionMeta.label} extract` : 'Extracted object', nextTool: 'erase' })} disabled={isBusy || !selectionCutoutUrl} className="w-full justify-center pm-btn-hover">
                          <Wand2 className="h-4 w-4" /> Extract Object
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Manual Brush */}
                {maskMethod === 'brush' ? (
                  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm pm-section-enter">
                    <div className="flex items-center gap-2 mb-2">
                      <Paintbrush className="h-4 w-4 text-rose-400" />
                      <Label>Brush Controls</Label>
                    </div>
                    <div className="space-y-3">
                      <Slider label="Brush Size" value={brushSize} onChange={(e) => setBrushSize(clamp(toNumber(e.target.value, 32), 4, 256))} min={4} max={256} />
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Brush Mode</div>
                        <Toggle value={eraseMode} onChange={setEraseMode} options={[
                          { value: 'paint', label: 'Paint' },
                          { value: 'erase', label: 'Erase' }
                        ]} />
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button variant="secondary" onClick={undoMask} disabled={isRunning} className="flex-1 pm-btn-hover">Undo</Button>
                      <Button variant="secondary" onClick={clearMask} disabled={isRunning} className="flex-1 pm-btn-hover">Clear</Button>
                    </div>
                    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Coverage</div>
                          <div className="mt-0.5 text-sm font-medium text-gray-900">
                            {cleanPlateMaskReady ? `${maskCoverageLabel} painted` : 'No mask yet'}
                          </div>
                        </div>
                        <StatusPill ok={cleanPlateMaskReady} label={cleanPlateMaskReady ? 'Ready' : 'Needed'} />
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Removal Engine */}
                <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <Label>Removal Engine</Label>
                  <div className="mt-3">
                    <Toggle value={quality} onChange={setQuality} options={[
                      { value: 'standard', label: standardEraseToggleLabel, title: 'Quick removal' },
                      { value: 'hq', label: 'HD (SDXL)', disabled: hqOption.disabled, title: hqOption.title }
                    ]} />
                  </div>
                  <div className="mt-3 space-y-3">
                    <Slider label="Padding" tooltip="Extra space around detected region" value={cropMarginPx} onChange={(e) => setCropMarginPx(clamp(toNumber(e.target.value, 128), 0, 2048))} min={0} max={2048} step={16} />
                    <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Crop to selection</span>
                      <button type="button" onClick={() => setCropToMask((prev) => !prev)} className={cn('pm-icon-btn', cropToMask && 'active')} style={{ width: 28, height: 28 }}>
                        {cropToMask ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  {quality === 'hq' ? (
                    <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 pm-section-enter">
                      <div className="text-xs font-semibold text-gray-700 mb-2">HD Quality Settings</div>
                      <div className="space-y-2.5">
                        <Slider label="Quality Steps" tooltip="More = higher quality, slower" value={sdxlSteps} onChange={(e) => setSdxlSteps(clamp(toNumber(e.target.value, 20), 5, 80))} min={5} max={80} />
                        <Slider label="AI Creativity" tooltip="Lower = follows image closely" value={sdxlGuidance} onChange={(e) => setSdxlGuidance(clamp(toNumber(e.target.value, 8), 0, 20))} min={0} max={20} step={0.1} />
                        <Slider label="Effect Intensity" value={sdxlStrength} onChange={(e) => setSdxlStrength(clamp(toNumber(e.target.value, 0.99), 0, 1))} min={0} max={1} step={0.01} />
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Variation Seed</span>
                          </div>
                          <Input type="number" min={0} max={2147483647} value={sdxlSeed} onChange={(e) => setSdxlSeed(clamp(toNumber(e.target.value, 0), 0, 2147483647))} />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3">
                    <Button variant="primary" onClick={runErase} disabled={!imageId || isRunning || (quality === 'hq' ? hqOption.disabled : !standardEraseReady) || (!cleanPlateMaskReady && !latestMaskForErase)} className="w-full justify-center pm-btn-hover">
                      <Eraser className="h-4 w-4" />
                      {quality === 'hq' ? 'Remove (HD)' : 'Remove Object'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── Adjust Lighting ── */}
            {tool === 'relight' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm pm-section-enter">
                <Label>Lighting Adjustment</Label>
                <div className="mt-3">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Preset</div>
                  <Select value={relightPreset} onChange={(e) => setRelightPreset(e.target.value)}>
                    <option value="studio">Studio</option>
                    <option value="window_left">Window Left</option>
                    <option value="window_right">Window Right</option>
                    <option value="golden_hour">Golden Hour</option>
                    <option value="rim">Rim Light</option>
                  </Select>
                </div>
                <div className="mt-4 space-y-3">
                  <Slider label="Subject Brightness" value={subjectBoost} onChange={(e) => setSubjectBoost(clamp(toNumber(e.target.value, 0.22), -0.2, 0.8))} min={-0.2} max={0.8} step={0.01} />
                  <Slider label="Background Brightness" value={backgroundExposure} onChange={(e) => setBackgroundExposure(clamp(toNumber(e.target.value, -0.08), -0.6, 0.35))} min={-0.6} max={0.35} step={0.01} />
                  <Slider label="Color Warmth" value={relightWarmth} onChange={(e) => setRelightWarmth(clamp(toNumber(e.target.value, 0.08), -0.35, 0.35))} min={-0.35} max={0.35} step={0.01} />
                  <Slider label="Shadow Darkness" value={shadowOpacity} onChange={(e) => setShadowOpacity(clamp(toNumber(e.target.value, 0.28), 0, 1))} min={0} max={1} step={0.01} />
                  <Slider label="Shadow Softness" value={shadowBlurPx} onChange={(e) => setShadowBlurPx(clamp(toNumber(e.target.value, 42), 0, 240))} min={0} max={240} />
                  <Slider label="Shadow Position X" value={shadowOffsetX} onChange={(e) => setShadowOffsetX(clamp(toNumber(e.target.value, 0), -256, 256))} min={-256} max={256} />
                  <Slider label="Shadow Position Y" value={shadowOffsetY} onChange={(e) => setShadowOffsetY(clamp(toNumber(e.target.value, 34), -256, 256))} min={-256} max={256} />
                </div>
                <div className="mt-4">
                  <Button variant="primary" onClick={runRelight} disabled={!imageId || isRunning || !relightReady} className="w-full justify-center pm-btn-hover">
                    <Sparkles className="h-4 w-4 pm-sparkle-icon" />
                    Apply Lighting
                  </Button>
                </div>
              </div>
            ) : null}

            {/* ── Extend Canvas ── */}
            {tool === 'expand' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm pm-section-enter">
                <Label>Canvas Extension</Label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Aspect Ratio</div>
                    <Select value={expandAspectRatio} onChange={(e) => setExpandAspectRatio(e.target.value)}>
                      <option value="1:1">1:1</option>
                      <option value="4:5">4:5</option>
                      <option value="5:4">5:4</option>
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                      <option value="3:2">3:2</option>
                      <option value="2:3">2:3</option>
                    </Select>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Anchor</div>
                    <Select value={expandAnchor} onChange={(e) => setExpandAnchor(e.target.value)}>
                      <option value="center">Center</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                    </Select>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Scene Description</div>
                  <Input value={expandPrompt} onChange={(e) => setExpandPrompt(e.target.value)} placeholder="premium studio backdrop, soft gradient..." />
                </div>
                <div className="mt-3">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Avoid</div>
                  <Input value={expandNegativePrompt} onChange={(e) => setExpandNegativePrompt(e.target.value)} placeholder="text, watermark, clutter..." />
                </div>
                <div className="mt-4 space-y-3">
                  <Slider label="Quality Steps" tooltip="More = higher quality, slower" value={expandSteps} onChange={(e) => setExpandSteps(clamp(toNumber(e.target.value, 24), 5, 80))} min={5} max={80} />
                  <Slider label="AI Creativity" tooltip="Lower = follows image closely" value={expandGuidance} onChange={(e) => setExpandGuidance(clamp(toNumber(e.target.value, 7.5), 0, 20))} min={0} max={20} step={0.1} />
                  <Slider label="Effect Intensity" value={expandStrength} onChange={(e) => setExpandStrength(clamp(toNumber(e.target.value, 0.96), 0, 1))} min={0} max={1} step={0.01} />
                  <Slider label="Blend Softness" tooltip="How smoothly new area blends" value={expandFeatherPx} onChange={(e) => setExpandFeatherPx(clamp(toNumber(e.target.value, 24), 0, 128))} min={0} max={128} />
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Variation Seed</span>
                    </div>
                    <Input type="number" min={0} max={2147483647} value={expandSeed} onChange={(e) => setExpandSeed(clamp(toNumber(e.target.value, 0), 0, 2147483647))} />
                  </div>
                </div>
                <div className="mt-4">
                  <Button variant="primary" onClick={runExpand} disabled={!imageId || isRunning || !expandReady} className="w-full justify-center pm-btn-hover">
                    <Sparkles className="h-4 w-4 pm-sparkle-icon" />
                    Extend Canvas
                  </Button>
                </div>
              </div>
            ) : null}

            {/* ── Enhance Quality ── */}
            {tool === 'enhance' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm pm-section-enter">
                <Label>Quality Enhancement</Label>
                <div className="mt-3">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Mode</div>
                  <Select value={enhanceMode} onChange={(e) => setEnhanceMode(e.target.value)}>
                    <option value="upscale">Upscale</option>
                    <option value="denoise">Denoise</option>
                    <option value="deblur">Deblur</option>
                    <option value="sharpen">Sharpen</option>
                    <option value="low_light">Low Light</option>
                  </Select>
                </div>
                <div className="mt-4 space-y-3">
                  <Slider label="Effect Intensity" value={enhanceStrength} onChange={(e) => setEnhanceStrength(clamp(toNumber(e.target.value, 0.5), 0, 1))} min={0} max={1} step={0.05} />
                  <Slider label="Upscale Factor" value={upscaleFactor} onChange={(e) => setUpscaleFactor(clamp(toNumber(e.target.value, 2), 1, 4))} min={1} max={4} disabled={enhanceMode !== 'upscale'} />
                </div>
                <div className="mt-4">
                  <Button variant="primary" onClick={runEnhance} disabled={!imageId || isRunning || (enhanceMode === 'upscale' && !realEsrganReady)} className="w-full justify-center pm-btn-hover">
                    <Zap className="h-4 w-4" />
                    Enhance Image
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
              <Label>Rendered Outputs</Label>
              <div className="mt-4 space-y-4">
                {outputCards.map((card) => (
                  <div key={card.id} className="rounded-2xl border border-gray-100 bg-gray-50/80 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{card.title}</div>
                        <div className="mt-1 text-[10px] font-mono uppercase tracking-[0.18em] text-indigo-500">{card.engine}</div>
                      </div>
                      <StatusPill ok={Boolean(card.url)} label={card.url ? 'Ready' : 'Idle'} title={card.engine} />
                    </div>

                    <div className="mt-3 overflow-hidden rounded-xl border border-gray-100 bg-gray-50" style={card.checker ? makeTransparentBg() : undefined}>
                      {card.url ? (
                        <img src={card.url} alt={card.title} className="block aspect-[4/5] w-full object-contain" />
                      ) : (
                        <div className="flex aspect-[4/5] items-center justify-center px-6 text-center text-sm leading-6 text-gray-400">{card.empty}</div>
                      )}
                    </div>

                    {card.url ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {card.promoteable ? (
                          <Button
                            variant="secondary"
                            onClick={() => promoteOutputToSource({ url: card.url, stageLabel: card.promoteStage, nextTool: card.nextTool })}
                            disabled={isBusy}
                          >
                            <Upload className="h-4 w-4" />
                            {card.promoteLabel}
                          </Button>
                        ) : null}
                        {card.maskAction ? (
                          <Button variant="secondary" onClick={() => applyMaskArtifactToCanvas(card.url)} disabled={isBusy}>
                            <Paintbrush className="h-4 w-4" />
                            {card.maskAction}
                          </Button>
                        ) : null}
                        <a
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
                          href={card.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {showDebugPanel ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <Label>Execution Trace</Label>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={clearDebugTrace} className="px-2 py-1 text-xs">
                      Clear
                    </Button>
                    <Button variant="ghost" onClick={() => setShowDebugPanel(false)} className="px-2 py-1 text-xs">
                      Hide
                    </Button>
                  </div>
                </div>

                {debugTrace.length ? (
                  <div className="mt-4 max-h-[420px] space-y-2 overflow-auto">
                    {debugTrace.map((entry) => {
                      const tone =
                        entry.status === 'failed'
                          ? 'border-rose-200 bg-rose-50'
                          : entry.status === 'success'
                            ? 'border-emerald-200 bg-emerald-50'
                            : 'border-gray-100 bg-gray-50/80';
                      const pillTone =
                        entry.status === 'failed'
                          ? 'text-rose-600'
                          : entry.status === 'success'
                            ? 'text-emerald-600'
                            : entry.status === 'running'
                              ? 'text-amber-600'
                              : 'text-gray-400';

                      return (
                        <div key={entry.id} className={cn('rounded-md border px-3 py-3', tone)}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.16em] text-gray-400">
                              <span>{entry.scope}</span>
                              <span>{entry.step}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={cn('text-[11px] font-mono uppercase tracking-[0.16em]', pillTone)}>{entry.status}</span>
                              <span className="text-[11px] font-mono text-gray-400">{formatDebugTimestamp(entry.at)}</span>
                            </div>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-gray-700">{entry.message}</div>
                          {entry.details ? (
                            <pre className="mt-3 overflow-auto rounded-xl border border-gray-100 bg-gray-50 p-3 text-[11px] leading-5 text-gray-500">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/80 px-3 py-3 text-xs leading-5 text-gray-400">
                    No execution trace yet. Run a stage and this panel will show request start, success, failure, and any mask or routing blocker.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <Button variant="ghost" onClick={() => setShowDebugPanel(true)} className="w-full justify-center px-2 py-1 text-xs text-gray-400">
                  Show execution trace
                </Button>
              </div>
            )}
          </div>
        </div>
        ) : (
        /* ══════════════════════════════════════════════════════════
           VIDEO MODE — Full 3-column video editing layout
           ══════════════════════════════════════════════════════════ */
        <div className="grid xl:grid-cols-[260px_minmax(0,1fr)_360px]">
          {/* ── Video Left Panel: Adjustments ── */}
          <div className="pm-glass-panel pm-scroll pm-left-panel flex flex-col border-r border-white/60 p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.45)', boxShadow: '20px 0 40px rgba(0,0,0,0.02)' }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-purple-500 to-pink-400 flex items-center justify-center">
                  <Film className="h-3 w-3 text-white" />
                </div>
                <span className="text-[12px] font-bold tracking-tight text-gray-700">Video Edits</span>
              </div>
              {hasAdjustments ? (
                <button type="button" onClick={resetAdjustments} className="text-[10px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors flex items-center gap-1">
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              ) : null}
            </div>

            <AccordionSection icon={Play} title="Playback" defaultOpen>
              <Slider label="Speed" tooltip="Playback speed multiplier" value={videoSpeed} onChange={(e) => setVideoSpeed(+e.target.value)} min={0.25} max={4} step={0.25} />
              <div className="flex items-center gap-2 mt-1">
                <Slider label="Volume" value={videoVolume} onChange={(e) => setVideoVolume(+e.target.value)} min={0} max={100} className="flex-1" />
                <button type="button" onClick={() => setVideoMuted(!videoMuted)} className={cn('pm-icon-btn', videoMuted && 'active')}>
                  {videoMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </AccordionSection>

            {videoDuration > 0 && (
              <AccordionSection icon={Crop} title="Trim">
                <Slider label="Start" value={videoTrimStart} onChange={(e) => { setVideoTrimStart(+e.target.value); seekVideo(+e.target.value); }} min={0} max={videoDuration} step={0.1} />
                <Slider label="End" value={videoTrimEnd ?? videoDuration} onChange={(e) => setVideoTrimEnd(+e.target.value)} min={0} max={videoDuration} step={0.1} />
                <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
                  <span>{formatVideoTime(videoTrimStart)}</span>
                  <span>Duration: {formatVideoTime((videoTrimEnd ?? videoDuration) - videoTrimStart)}</span>
                  <span>{formatVideoTime(videoTrimEnd ?? videoDuration)}</span>
                </div>
                <button type="button" onClick={() => { setVideoTrimStart(0); setVideoTrimEnd(null); }} className="w-full mt-1 text-[10px] font-medium text-gray-400 hover:text-indigo-500 transition-colors">
                  Reset Trim
                </button>
              </AccordionSection>
            )}

            <AccordionSection icon={Sun} title="Color Grading">
              <Slider label="Brightness" value={adjustments.brightness} onChange={(e) => setAdj('brightness', +e.target.value)} min={-100} max={100} />
              <Slider label="Contrast" value={adjustments.contrast} onChange={(e) => setAdj('contrast', +e.target.value)} min={-100} max={100} />
              <Slider label="Exposure" value={adjustments.exposure} onChange={(e) => setAdj('exposure', +e.target.value)} min={-100} max={100} />
              <Slider label="Saturation" value={adjustments.saturation} onChange={(e) => setAdj('saturation', +e.target.value)} min={-100} max={100} />
              <Slider label="Temperature" value={adjustments.temperature} onChange={(e) => setAdj('temperature', +e.target.value)} min={-100} max={100} />
              <Slider label="Tint" value={adjustments.tint} onChange={(e) => setAdj('tint', +e.target.value)} min={-100} max={100} />
            </AccordionSection>

            <AccordionSection icon={Sparkles} title="Effects">
              <Slider label="Vignette" value={adjustments.vignette} onChange={(e) => setAdj('vignette', +e.target.value)} min={0} max={100} />
              <Slider label="Grain" value={adjustments.grain} onChange={(e) => setAdj('grain', +e.target.value)} min={0} max={100} />
              <Slider label="Fade" value={adjustments.fade} onChange={(e) => setAdj('fade', +e.target.value)} min={0} max={100} />
            </AccordionSection>

            <AccordionSection icon={Sunset} title="Filters">
              <div className="grid grid-cols-3 gap-1.5">
                {PHOTO_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => applyFilter(f)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-xl p-1.5 transition-all text-center',
                      activeFilter === f.id
                        ? 'bg-indigo-50 border border-indigo-200 shadow-sm'
                        : 'border border-transparent hover:bg-gray-50 hover:border-gray-100'
                    )}
                  >
                    <div className="w-full aspect-square rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden"
                      style={{ filter: buildFilterStyles({ ...DEFAULT_ADJUSTMENTS, ...f.adj }).filter || 'none' }}
                    />
                    <span className={cn('text-[9px] font-semibold uppercase tracking-wider', activeFilter === f.id ? 'text-indigo-600' : 'text-gray-400')}>
                      {f.label}
                    </span>
                  </button>
                ))}
              </div>
            </AccordionSection>

            <AccordionSection icon={Crop} title="Transform">
              <Slider label="Rotate" value={adjustments.rotate} onChange={(e) => setAdj('rotate', +e.target.value)} min={-180} max={180} />
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={() => setAdj('flipH', !adjustments.flipH)} className={cn('pm-icon-btn flex-1', adjustments.flipH && 'active')} title="Flip horizontal">
                  <FlipHorizontal2 className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setAdj('flipV', !adjustments.flipV)} className={cn('pm-icon-btn flex-1', adjustments.flipV && 'active')} title="Flip vertical">
                  <FlipVertical2 className="h-4 w-4" />
                </button>
              </div>
            </AccordionSection>

            {hasAdjustments && (
              <div className="pt-2">
                <button type="button" onClick={resetAdjustments} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5 pm-btn-hover">
                  <RotateCcw className="h-3 w-3" /> Reset All
                </button>
              </div>
            )}
          </div>

          {/* ── Video Center Panel: Player ── */}
          <div className="relative min-w-0 overflow-hidden bg-[#f0f0f3] p-6">
            <div className="pointer-events-none absolute -top-20 -left-20 h-64 w-64 rounded-full bg-purple-300/20 opacity-70" style={{ filter: 'blur(80px)', animation: 'pm-float-gentle 6s infinite ease-in-out' }} />
            <div className="pointer-events-none absolute -bottom-16 right-[20%] h-64 w-64 rounded-full bg-pink-300/20 opacity-70" style={{ filter: 'blur(80px)', animation: 'pm-float-gentle 8s infinite ease-in-out reverse' }} />

            <div className="rounded-2xl border border-white bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] overflow-hidden">
              {!videoSrc ? (
                /* Upload area */
                <div className="pm-video-dropzone" onClick={() => videoFileInputRef.current?.click()}>
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-100 to-pink-100 flex items-center justify-center mb-4">
                    <Film className="h-7 w-7 text-purple-400" />
                  </div>
                  <p className="text-sm font-semibold text-gray-600 mb-1">Import a video to begin</p>
                  <p className="text-xs text-gray-400">MP4, WebM, MOV up to 100MB</p>
                  {isVideoUploading && (
                    <div className="mt-4 flex items-center gap-2 text-indigo-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs font-medium">Uploading...</span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Video Preview */}
                  <div className="relative" style={makeTransparentBg()}>
                    <video
                      ref={videoRef}
                      src={videoSrc}
                      className="block w-full max-h-[520px] object-contain"
                      style={{ filter: adjStyles.filter, transform: adjStyles.transform, transition: 'filter 0.15s ease, transform 0.2s ease' }}
                      onTimeUpdate={onVideoTimeUpdate}
                      onLoadedMetadata={onVideoLoaded}
                      onEnded={() => setIsVideoPlaying(false)}
                      onClick={toggleVideoPlay}
                    />
                    {adjustments.vignette > 0 && <div className="pm-vignette-overlay" style={{ '--pm-vignette': adjStyles['--pm-vignette'] }} />}
                    {adjustments.grain > 0 && <div className="pm-grain-overlay" style={{ '--pm-grain': adjStyles['--pm-grain'] }} />}

                    {/* Play overlay on pause */}
                    {!isVideoPlaying && videoSrc && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-16 h-16 rounded-full bg-white/80 shadow-xl flex items-center justify-center" style={{ backdropFilter: 'blur(12px)' }}>
                          <Play className="h-6 w-6 text-indigo-600 ml-1" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="px-4 pt-3">
                    <div className="pm-progress-bar" onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
                      seekVideo(pct * videoDuration);
                    }}>
                      <div className="pm-progress-fill" style={{ width: `${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%` }} />
                      <div className="pm-progress-thumb" style={{ left: `${videoDuration ? (videoCurrentTime / videoDuration) * 100 : 0}%` }} />
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="pm-video-controls">
                    <span className="text-[11px] font-mono text-gray-400 tabular-nums w-10">{formatVideoTime(videoCurrentTime)}</span>
                    <button type="button" className="pm-video-ctrl-btn" onClick={() => skipVideo(-5)}>
                      <SkipBack className="h-4 w-4" />
                    </button>
                    <button type="button" className="pm-video-ctrl-btn primary" onClick={toggleVideoPlay}>
                      {isVideoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                    </button>
                    <button type="button" className="pm-video-ctrl-btn" onClick={() => skipVideo(5)}>
                      <SkipForward className="h-4 w-4" />
                    </button>
                    <span className="text-[11px] font-mono text-gray-400 tabular-nums w-10">{formatVideoTime(videoDuration)}</span>
                    <div className="flex-1" />
                    <button type="button" onClick={() => setVideoMuted(!videoMuted)} className="pm-video-ctrl-btn">
                      {videoMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                    <span className="text-[11px] font-mono text-gray-500 tabular-nums">{videoSpeed}x</span>
                  </div>

                  {/* Trim Bar */}
                  {videoDuration > 0 && (
                    <div className="px-4 pb-3">
                      <div className="pm-trim-bar">
                        <div className="pm-trim-region" style={{
                          left: `${(videoTrimStart / videoDuration) * 100}%`,
                          width: `${(((videoTrimEnd ?? videoDuration) - videoTrimStart) / videoDuration) * 100}%`
                        }} />
                        <div className="pm-trim-playhead" style={{ left: `${(videoCurrentTime / videoDuration) * 100}%` }} />
                        <div className="absolute inset-0 flex items-end justify-between px-1 pb-1">
                          <span className="text-[8px] font-mono text-gray-400">{formatVideoTime(videoTrimStart)}</span>
                          <span className="text-[8px] font-mono text-gray-400">{formatVideoTime(videoTrimEnd ?? videoDuration)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Video Right Panel: Magic Tools ── */}
          <div className="pm-glass-panel pm-scroll pm-right-panel flex flex-col border-l border-white p-5" style={{ background: 'rgba(255,255,255,0.40)', boxShadow: '-20px 0 40px rgba(0,0,0,0.03)' }}>
            <div className="mb-6">
              <h2 className="text-[13px] font-bold tracking-widest uppercase text-gray-400 mb-4 flex items-center gap-2">
                <Sparkles className="h-4 w-4" /> Video Magic
              </h2>
              <div className="relative flex flex-wrap p-1 gap-0.5 rounded-xl border border-gray-200/50 shadow-inner" style={{ background: 'rgba(243,244,246,0.8)' }}>
                {Object.entries(VIDEO_TOOL_DEFINITIONS).map(([key, def]) => {
                  const IconComp = VIDEO_TOOL_ICONS[key] || Zap;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        'flex-1 min-w-0 rounded-lg px-1.5 py-1.5 text-center transition-all',
                        videoTool === key
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-400 hover:text-gray-600'
                      )}
                      onClick={() => {
                        setVideoTool(key);
                        if (key === 'music' && musicTracks.length === 0) loadMusicLibrary();
                      }}
                    >
                      <IconComp className="h-3.5 w-3.5 mx-auto mb-0.5" />
                      <span className="text-[9px] font-bold uppercase tracking-wider block truncate">{def.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] text-gray-400 leading-relaxed">{VIDEO_TOOL_DEFINITIONS[videoTool]?.description}</p>
            </div>

            {/* ═══ Overlays Tool ═══ */}
            {videoTool === 'overlay' && (
              <div className="space-y-3 pm-section-enter">
                <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 shadow-sm space-y-3">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block">Scan Settings</span>
                  <Slider label="Interval" tooltip="Seconds between frames" value={overlayScanInterval} onChange={(e) => setOverlayScanInterval(+e.target.value)} min={0.5} max={5} step={0.5} />
                  <Slider label="Max Frames" value={overlayScanMaxFrames} onChange={(e) => setOverlayScanMaxFrames(+e.target.value)} min={10} max={120} step={5} />
                  <button
                    type="button"
                    onClick={scanOverlays}
                    disabled={!videoId || overlayScanning}
                    className="w-full py-2 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    {overlayScanning ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning...</> : <><ScanSearch className="h-3.5 w-3.5" /> Scan for Overlays</>}
                  </button>
                </div>

                {overlaySegments.length > 0 && (
                  <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 shadow-sm">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block mb-2">Detected Segments</span>
                    <div className="space-y-2 max-h-48 overflow-y-auto pm-scroll">
                      {overlaySegments.map((seg, si) => (
                        <div key={si} className="rounded-xl border border-gray-100 bg-white/50 p-2">
                          <button type="button" onClick={() => { setSelectedOverlaySegIdx(si); seekVideo(seg.start || 0); }}
                            className="w-full text-left text-[10px] font-semibold text-gray-600 mb-1">
                            Segment {si + 1} <span className="text-gray-400 font-mono">({formatVideoTime(seg.start)} - {formatVideoTime(seg.end)})</span>
                          </button>
                          {seg.overlays?.map((ov, oi) => (
                            <div key={oi} className={cn(
                              'flex items-center justify-between px-2 py-1 rounded-lg transition-all cursor-pointer',
                              selectedOverlaySegIdx === si && selectedOverlayIdx === oi ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-50'
                            )} onClick={() => { setSelectedOverlaySegIdx(si); setSelectedOverlayIdx(oi); }}>
                              <span className="text-[10px] text-gray-600 truncate flex-1">"{ov.text || 'Overlay'}"</span>
                              <button type="button" onClick={(e) => { e.stopPropagation(); deleteOverlay(si, oi); }} className="text-gray-300 hover:text-red-400 ml-1">
                                <XCircle className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedOverlaySegIdx !== null && selectedOverlayIdx !== null && overlaySegments[selectedOverlaySegIdx]?.overlays?.[selectedOverlayIdx] && (() => {
                  const ov = overlaySegments[selectedOverlaySegIdx].overlays[selectedOverlayIdx];
                  const patch = (p) => updateOverlay(selectedOverlaySegIdx, selectedOverlayIdx, p);
                  return (
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-3 shadow-sm space-y-2">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-400 block">Edit Overlay</span>
                      <div>
                        <span className="text-[10px] font-semibold text-gray-500 mb-1 block">Text</span>
                        <input type="text" value={ov.text || ''} onChange={(e) => patch({ text: e.target.value })}
                          className="w-full px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                      </div>
                      <Slider label="Font Size" value={ov.fontSize || 24} onChange={(e) => patch({ fontSize: +e.target.value })} min={8} max={120} />
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <span className="text-[10px] font-semibold text-gray-500 mb-1 block">Text Color</span>
                          <input type="color" value={ov.textColor || '#ffffff'} onChange={(e) => patch({ textColor: e.target.value })} className="w-full h-7 rounded-lg cursor-pointer" />
                        </div>
                        <div className="flex-1">
                          <span className="text-[10px] font-semibold text-gray-500 mb-1 block">Background</span>
                          <input type="color" value={ov.backgroundColor || '#333333'} onChange={(e) => patch({ backgroundColor: e.target.value })} className="w-full h-7 rounded-lg cursor-pointer" />
                        </div>
                      </div>
                      <Slider label="Border Radius" value={ov.borderRadius || 0} onChange={(e) => patch({ borderRadius: +e.target.value })} min={0} max={32} />
                    </div>
                  );
                })()}

                {overlaySegments.length > 0 && (
                  <button
                    type="button"
                    onClick={exportOverlays}
                    disabled={overlayExporting}
                    className="w-full py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    {overlayExporting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Exporting...</> : <><Film className="h-3.5 w-3.5" /> Export with Overlays</>}
                  </button>
                )}
              </div>
            )}

            {/* ═══ Smart Resize Tool ═══ */}
            {videoTool === 'resize' && (
              <div className="pm-section-enter">
                <VideoResizerPanel store={store} videoId={videoId} videoInfo={videoFileInfo} />
              </div>
            )}

            {/* ═══ Product Hub Tool ═══ */}
            {videoTool === 'product_hub' && (
              <div className="pm-section-enter">
                <ProductHubPanel store={store} onProductSelect={(product) => {
                  // Add product text as a new overlay on the current segment
                  if (overlaySegments.length === 0) {
                    setOverlaySegments([{ start: 0, end: videoDuration || 10, overlays: [{ text: `${product.name} — ${formatCurrency(product.price, product.currency)}`, fontSize: 28, textColor: '#ffffff', backgroundColor: '#1a1a2e', borderRadius: 8, x: 40, y: 40, width: 400, height: 60 }] }]);
                  } else {
                    const segIdx = selectedOverlaySegIdx ?? 0;
                    setOverlaySegments((prev) => prev.map((seg, i) => {
                      if (i !== segIdx) return seg;
                      return { ...seg, overlays: [...(seg.overlays || []), { text: `${product.name} — ${formatCurrency(product.price, product.currency)}`, fontSize: 28, textColor: '#ffffff', backgroundColor: '#1a1a2e', borderRadius: 8, x: 40, y: 40 + (seg.overlays?.length || 0) * 70, width: 400, height: 60 }] };
                    }));
                  }
                  setVideoTool('overlay');
                }} />
              </div>
            )}

            {/* ═══ Music Library Tool ═══ */}
            {videoTool === 'music' && (
              <div className="space-y-3 pm-section-enter">
                <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-pink-400 to-purple-400 flex items-center justify-center">
                      <Music className="h-3 w-3 text-white" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Background Music</span>
                  </div>

                  {musicLoading ? (
                    <div className="flex items-center justify-center py-6 text-gray-400">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      <span className="text-[11px]">Loading tracks...</span>
                    </div>
                  ) : musicTracks.length === 0 ? (
                    <div className="text-center py-6 text-gray-400">
                      <Music className="h-6 w-6 mx-auto mb-2 opacity-40" />
                      <p className="text-[11px]">No tracks loaded</p>
                      <button type="button" onClick={loadMusicLibrary} className="mt-2 text-[10px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors">
                        Load Library
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {musicTracks.map((track, idx) => (
                        <div
                          key={track.id || idx}
                          className={cn('pm-music-card', selectedTrackId === (track.id || idx) && 'active')}
                          onClick={() => setSelectedTrackId(track.id || idx)}
                        >
                          <div className="pm-music-icon" style={{ background: `linear-gradient(135deg, ${idx === 0 ? '#c084fc, #a78bfa' : idx === 1 ? '#f472b6, #e879f9' : '#60a5fa, #818cf8'})` }}>
                            <Music className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-gray-700 truncate">{track.name || track.title || `Track ${idx + 1}`}</p>
                            <p className="text-[9px] text-gray-400">{track.bpm ? `${track.bpm} BPM` : ''} {track.mood ? `\u00B7 ${track.mood}` : ''}</p>
                          </div>
                          <div className={cn('w-3 h-3 rounded-full border-2 transition-all', selectedTrackId === (track.id || idx) ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 bg-white')} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 shadow-sm space-y-3">
                  <Slider label="Volume" value={musicVolume} onChange={(e) => setMusicVolume(+e.target.value)} min={0} max={100} />
                  <Slider label="Fade In" tooltip="Seconds" value={musicFadeIn} onChange={(e) => setMusicFadeIn(+e.target.value)} min={0} max={10} step={0.5} />
                  <Slider label="Fade Out" tooltip="Seconds" value={musicFadeOut} onChange={(e) => setMusicFadeOut(+e.target.value)} min={0} max={10} step={0.5} />
                </div>

                <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/30 p-3 text-center">
                  <span className="pm-badge-soon">Coming Soon</span>
                  <p className="text-[11px] text-gray-500 mt-2 font-medium">Connect Music Service</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Epidemic Sound, Artlist, and more</p>
                </div>

                <button
                  type="button"
                  disabled={selectedTrackId === null}
                  className="w-full py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >
                  <Music className="h-3.5 w-3.5" /> Apply to Video
                </button>
              </div>
            )}

            {/* ═══ Enhance Tool ═══ */}
            {videoTool === 'enhance_v' && (
              <div className="space-y-3 pm-section-enter">
                <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 shadow-sm space-y-3">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500 block">Enhancement Mode</span>
                  <div className="flex gap-1.5">
                    {['Upscale', 'Denoise', 'Stabilize'].map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={cn(
                          'flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all relative',
                          mode === 'Upscale' ? 'bg-indigo-100 text-indigo-600 shadow-sm' : 'bg-gray-100/60 text-gray-400 hover:text-gray-600'
                        )}
                      >
                        {mode}
                        {mode === 'Stabilize' && <span className="pm-badge-soon absolute -top-1 -right-1">Soon</span>}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 shadow-sm space-y-3">
                  <Slider label="Quality" value={80} onChange={() => {}} min={0} max={100} />
                  <Slider label="Strength" value={50} onChange={() => {}} min={0} max={100} />
                </div>

                <button
                  type="button"
                  disabled
                  className="w-full py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                >
                  <Zap className="h-3.5 w-3.5" /> Enhance Video
                </button>

                <div className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/30 p-3 text-center">
                  <span className="pm-badge-soon">Coming Soon</span>
                  <p className="text-[11px] text-gray-500 mt-2 font-medium">Video enhancement is in development</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">AI upscaling, denoising, and stabilization</p>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        <div className="border-t border-gray-100 bg-white/60 px-5 py-3" style={{ backdropFilter: 'blur(24px)' }}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-mono uppercase tracking-[0.16em] text-gray-400">
            <span>{editorMode === 'photo' ? (stageConfig?.label || tool) : (VIDEO_TOOL_DEFINITIONS[videoTool]?.label || videoTool)}</span>
            <span>{editorMode === 'photo' ? (isUploading ? 'Uploading...' : isRunning ? 'Processing...' : lastRenderSummary) : (isVideoUploading ? 'Uploading video...' : videoSrc ? 'Ready' : 'Idle')}</span>
          </div>
        </div>

        {error ? (
          <div className="border-t border-rose-200 bg-rose-50 px-5 py-4">
            <div className="flex items-start gap-3 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-rose-500" />
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-rose-500">Render Console</div>
                <div className="mt-2 leading-6">{error}</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ═══ Export Modal ═══ */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" style={{ backdropFilter: 'blur(8px)' }} onClick={() => setShowExportModal(false)}>
          <div className="bg-white rounded-3xl overflow-hidden w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Export Image</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Choose format, quality, and size</p>
                </div>
                <button type="button" onClick={() => setShowExportModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                  <XCircle className="h-5 w-5 text-gray-400" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Format */}
              <div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Format</span>
                <div className="flex gap-2">
                  {['png', 'jpg', 'webp'].map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setExportFormat(fmt)}
                      className={cn(
                        'flex-1 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all',
                        exportFormat === fmt
                          ? 'bg-indigo-100 text-indigo-600 shadow-sm border border-indigo-200'
                          : 'bg-gray-50 text-gray-400 border border-transparent hover:bg-gray-100'
                      )}
                    >
                      .{fmt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quality (only for jpg/webp) */}
              {exportFormat !== 'png' && (
                <div>
                  <Slider label="Quality" tooltip="Higher = better quality, larger file" value={exportQuality} onChange={(e) => setExportQuality(+e.target.value)} min={10} max={100} />
                </div>
              )}

              {/* Scale / Size */}
              <div>
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Size</span>
                <div className="flex gap-2">
                  {['0.5x', '1x', '2x', '3x', '4x'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setExportScale(s)}
                      className={cn(
                        'flex-1 py-2.5 rounded-xl text-xs font-bold tracking-wider transition-all',
                        exportScale === s
                          ? 'bg-indigo-100 text-indigo-600 shadow-sm border border-indigo-200'
                          : 'bg-gray-50 text-gray-400 border border-transparent hover:bg-gray-100'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {imageMeta?.width && (
                  <p className="text-[10px] text-gray-400 mt-2 text-center">
                    Output: {Math.round(imageMeta.width * ({ '0.5x': 0.5, '1x': 1, '2x': 2, '3x': 3, '4x': 4 }[exportScale] || 1))} x {Math.round(imageMeta.height * ({ '0.5x': 0.5, '1x': 1, '2x': 2, '3x': 3, '4x': 4 }[exportScale] || 1))} px
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExport}
                className="flex-1 py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-md"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
