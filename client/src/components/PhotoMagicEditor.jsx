import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Download,
  Eraser,
  ImagePlus,
  Layers3,
  Paintbrush,
  RefreshCw,
  Sparkles,
  Upload,
  Wand2,
  XCircle
} from 'lucide-react';

const API_BASE = '/api';
const withStore = (path, store) => `${API_BASE}${path}${path.includes('?') ? '&' : '?'}store=${encodeURIComponent(store ?? 'vironax')}`;

const cn = (...classes) => classes.filter(Boolean).join(' ');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
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

function RangeControl({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  formatValue = (next) => String(next),
  minLabel,
  maxLabel
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/70 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-100 hover:bg-white hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label>{label}</Label>
          {hint ? <div className="mt-2 text-xs leading-5 text-gray-500">{hint}</div> : null}
        </div>
        <div className="shrink-0 rounded-full border border-white/80 bg-white px-2.5 py-1 text-[11px] font-semibold tracking-wide text-gray-600 shadow-sm">
          {formatValue(value)}
        </div>
      </div>

      <div className="mt-4">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-indigo-100 via-indigo-200 to-violet-200 accent-indigo-500"
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] font-medium tracking-wide text-gray-400">
        <span>{minLabel || formatValue(min)}</span>
        <span>{maxLabel || formatValue(max)}</span>
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

function makeCheckerBg() {
  return {
    backgroundImage:
      'linear-gradient(45deg, rgba(0,0,0,0.06) 25%, transparent 25%),' +
      'linear-gradient(-45deg, rgba(0,0,0,0.06) 25%, transparent 25%),' +
      'linear-gradient(45deg, transparent 75%, rgba(0,0,0,0.06) 75%),' +
      'linear-gradient(-45deg, transparent 75%, rgba(0,0,0,0.06) 75%)',
    backgroundSize: '24px 24px',
    backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px'
  };
}

const TOOL_DEFINITIONS = {
  remove_bg: {
    label: 'Foreground Isolation',
    engine: 'BiRefNet + SAM2',
    description: 'Cut the subject fast, then refine the edge mask with guided points.'
  },
  select: {
    label: 'Target Selection',
    engine: 'Gemini Vision',
    description: 'Find a logo, label, or object from language, then extract it or send the mask straight into eraser.'
  },
  erase: {
    label: 'Clean Plate',
    engine: 'LaMa / SDXL HQ',
    description: 'Paint removal regions and render a cleaned frame from the active source.'
  },
  relight: {
    label: 'Lighting Stage',
    engine: 'Relight + shadows',
    description: 'Re-ground the current subject with directional light shaping and contact shadow control.'
  },
  expand: {
    label: 'Canvas Expand',
    engine: 'SDXL expand',
    description: 'Extend the canvas, regenerate background space, and keep the current subject anchored.'
  },
  enhance: {
    label: 'Enhancement',
    engine: 'Real-ESRGAN + restoration',
    description: 'Recover detail, upscale soft inputs, or stabilize low-quality source work.'
  }
};

const TOOL_DISPLAY = {
  remove_bg: { label: 'Background', accent: 'Cut out', icon: Wand2 },
  select: { label: 'Target', accent: 'Find it', icon: Crosshair },
  erase: { label: 'Eraser', accent: 'Remove', icon: Eraser },
  relight: { label: 'Lighting', accent: 'Shape', icon: Sparkles },
  expand: { label: 'Canvas', accent: 'Extend', icon: Layers3 },
  enhance: { label: 'Enhance', accent: 'Recover', icon: RefreshCw }
};

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
  const [sourceStage, setSourceStage] = useState('Seed asset');
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
  const [selectionIntent, setSelectionIntent] = useState('extract');
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

  const currentMaskOutputId = selectionMaskOutputId || maskOutputId || relightMaskOutputId || expandMaskOutputId || null;
  const latestMaskForErase = selectionMaskUrl || maskUrl || relightMaskUrl || expandMaskUrl || null;
  const latestMaskSourceLabel = selectionMaskUrl
    ? 'Target selection'
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
        sourceStageLabel = 'Seed asset',
        sourceName = file?.name || '',
        nextTool = 'remove_bg',
        resetHistory = true
      } = options;

      setError(null);
      setIsUploading(true);
      const runId = startDebugRun('Upload', `Importing ${sourceName || file?.name || 'seed asset'}`);

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
          successMessage: 'Seed asset uploaded',
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
        setSourceLabel(sourceName || data.filename || file?.name || 'seed-asset');
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
          sourceStageLabel: 'Seed asset',
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
      const { summary = 'Selection mask routed into clean plate', logMessage = summary, runId = null } = options;

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
        logDebug(runId, 'Clean Plate', 'mask-route', 'success', logMessage, {
          coverage: Number((stats.coverage * 100).toFixed(2)),
          paintedPixels: stats.paintedPixels
        });
      }
    },
    [ensureMaskCanvasSize, imageSrc, logDebug, pushUndo, syncMaskMetrics]
  );

  const runSelect = useCallback(
    async (intentOverride = selectionIntent) => {
      if (!imageId || !selectionPrompt.trim()) return;

      const intentMode = intentOverride === 'erase' ? 'erase' : 'extract';
      const promptLabel = selectionPrompt.trim();

      setError(null);
      setIsRunning(true);
      const runId = startDebugRun('Target Selection', `Resolving "${promptLabel}" for ${intentMode === 'erase' ? 'eraser' : 'extraction'}`);
      try {
        const data = await requestJson({
          runId,
          scope: 'Target Selection',
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
          successMessage: 'Target selection resolved',
          failureMessage: 'Target selection failed',
          successDetails: (payload) => ({
            label: payload?.selection?.label || promptLabel,
            confidence: payload?.selection?.confidence || null,
            maskReady: Boolean(payload?.mask?.url),
            intent: intentMode
          })
        });

        setSelectionCutoutUrl(data.cutout?.url || null);
        setSelectionMaskUrl(data.mask?.url || null);
        setSelectionCutoutOutputId(data.cutout?.output_id || null);
        setSelectionMaskOutputId(data.mask?.output_id || null);
        setSelectionMeta(data.selection || null);

        if (intentMode === 'erase' && data.mask?.url) {
          await applyMaskArtifactToCanvas(data.mask.url, {
            summary: `${data.selection?.label || promptLabel} mask is ready inside Clean Plate`,
            logMessage: `${data.selection?.label || promptLabel} target mask routed into clean plate`,
            runId
          });
          setLastRenderSummary(`${data.selection?.label || promptLabel} is ready to remove`);
        } else {
          setViewportMode('compare');
          setLastRenderSummary(`${data.selection?.label || promptLabel} is ready as its own asset`);
        }
      } catch (nextError) {
        console.error(nextError);
        const message = nextError?.message || 'Target selection failed';
        setError(message);
        setLastRenderSummary(`Failed: ${message}`);
        logDebug(runId, 'Target Selection', 'complete', 'failed', message, { prompt: promptLabel, intent: intentMode });
      } finally {
        setIsRunning(false);
        refreshHealth();
      }
    },
    [
      applyMaskArtifactToCanvas,
      imageId,
      logDebug,
      maskDilatePx,
      maskFeatherPx,
      maxSide,
      refreshHealth,
      requestJson,
      selectionIntent,
      selectionPrompt,
      startDebugRun,
      store
    ]
  );

  const runErase = useCallback(async () => {
    if (!imageId) return;

    setError(null);
    setIsRunning(true);
    const scope = quality === 'hq' ? 'HQ Clean Plate' : 'Clean Plate';
    const runId = startDebugRun(scope, `${quality === 'hq' ? 'HQ' : 'Standard'} clean plate requested`);
    try {
      let maskState = syncMaskMetrics();
      logDebug(runId, scope, 'mask-check', maskState.hasMask ? 'success' : 'running', maskState.hasMask ? 'Mask surface already contains painted or routed pixels' : 'Mask surface is blank', {
        coverage: Number((maskState.coverage * 100).toFixed(2)),
        paintedPixels: maskState.paintedPixels
      });

      if (!maskState.hasMask && latestMaskForErase) {
        logDebug(runId, scope, 'mask-route', 'running', `Auto-loading ${latestMaskSourceLabel || 'latest'} mask into clean plate`);
        await applyMaskArtifactToCanvas(latestMaskForErase, {
          summary: `${latestMaskSourceLabel || 'Latest'} mask loaded for clean plate`,
          logMessage: `${latestMaskSourceLabel || 'Latest'} mask copied into the clean plate surface`,
          runId
        });
        maskState = syncMaskMetrics();
      }

      if (!maskState.hasMask) {
        throw new Error('Paint a removal mask or route a mask artifact into clean plate first.');
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
        successMessage: `${quality === 'hq' ? 'HQ' : 'Standard'} clean plate render completed`,
        failureMessage: 'Clean plate render failed',
        successDetails: (payload) => ({
          outputReady: Boolean(payload?.url),
          width: payload?.width || null,
          height: payload?.height || null,
          coverage: Number((maskState.coverage * 100).toFixed(2))
        })
      });

      setEraseUrl(data.url || null);
      setViewportMode('compare');
      setLastRenderSummary(`${quality === 'hq' ? 'HQ' : 'Standard'} clean plate ready`);
    } catch (nextError) {
      console.error(nextError);
      const message = nextError?.message || 'Clean plate render failed';
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
        description: 'Primary foreground isolation for the active seed asset.',
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
        title: 'Target Selection',
        model: sam2Ready ? 'Gemini Vision + SAM2' : 'Gemini Vision',
        ready: Boolean(geminiReady),
        description: 'Language-based target pickup that can extract an asset or feed eraser with a mask.',
        error: geminiReady ? '' : 'GEMINI_API_KEY is not configured.'
      },
      {
        id: 'lama',
        title: 'Standard Clean Plate',
        model: 'LaMa inpainting',
        ready: lamaReady,
        description: 'Fast object removal for working iterations.',
        error: aiHealthPayload?.errors?.lama || ''
      },
      {
        id: 'sdxl',
        title: 'HQ Clean Plate',
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
      sam2Ready
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

  const stageConfig = TOOL_DEFINITIONS[tool];
  const outputCards = useMemo(() => {
    if (tool === 'remove_bg') {
      return [
        {
          id: 'cutout',
          title: 'Cutout Asset',
          engine: 'BiRefNet / SAM2',
          url: cutoutUrl,
          empty: 'Run auto cutout or SAM2 refine to produce a foreground asset.',
          promoteable: true,
          promoteLabel: 'Route to source',
          promoteStage: 'Cutout source',
          nextTool: 'select',
          checker: true,
          primary: true
        },
        {
          id: 'mask',
          title: 'Mask Artifact',
          engine: 'Segmentation mask',
          url: maskUrl,
          empty: 'Mask artifact appears after the isolation pass.',
          promoteable: false,
          maskAction: maskUrl ? 'Route to clean plate' : null,
          checker: false,
          primary: false
        }
      ];
    }

    if (tool === 'select') {
      return [
        {
          id: 'selection',
          title: 'Extracted Target',
          engine: selectionMeta?.label ? `Gemini: ${selectionMeta.label}` : 'Gemini target pickup',
          url: selectionCutoutUrl,
          empty: 'Type a target prompt to isolate a price tag, logo, bag, shoe, face, or text block.',
          promoteable: true,
          promoteLabel: 'Route to source',
          promoteStage: selectionMeta?.label ? `${selectionMeta.label} source` : 'Selected source',
          nextTool: 'erase',
          checker: true,
          primary: true
        },
        {
          id: 'selection-mask',
          title: 'Target Mask',
          engine: 'Prompt mask',
          url: selectionMaskUrl,
          empty: 'The target mask appears after the prompt selection pass.',
          promoteable: false,
          maskAction: selectionMaskUrl ? 'Send to eraser' : null,
          checker: false,
          primary: false
        }
      ];
    }

    if (tool === 'erase') {
      return [
        {
          id: 'erase',
          title: 'Clean Plate',
          engine: quality === 'hq' ? 'SDXL HQ' : 'LaMa',
          url: eraseUrl,
          empty: 'Paint the removal region, then render a clean plate.',
          promoteable: true,
          promoteLabel: 'Route to source',
          promoteStage: quality === 'hq' ? 'HQ clean plate' : 'Clean plate',
          nextTool: 'relight',
          checker: false,
          primary: true
        }
      ];
    }

    if (tool === 'relight') {
      return [
        {
          id: 'relight',
          title: 'Lighting Pass',
          engine: 'Relight + shadow stage',
          url: relightUrl,
          empty: 'Run the lighting stage to re-ground the active source with controlled highlights and cast shadow.',
          promoteable: true,
          promoteLabel: 'Route to source',
          promoteStage: 'Relit source',
          nextTool: 'expand',
          checker: false,
          primary: true
        },
        {
          id: 'relight-mask',
          title: 'Lighting Subject Mask',
          engine: 'Subject matte',
          url: relightMaskUrl,
          empty: 'Subject matte is generated automatically during the relight stage.',
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
          title: 'Expanded Canvas',
          engine: 'SDXL expand',
          url: expandUrl,
          empty: 'Extend the frame to a new aspect ratio and regenerate the missing background area.',
          promoteable: true,
          promoteLabel: 'Route to source',
          promoteStage: 'Expanded source',
          nextTool: 'enhance',
          checker: false,
          primary: true
        },
        {
          id: 'expand-mask',
          title: 'Expansion Mask',
          engine: 'Outpaint mask',
          url: expandMaskUrl,
          empty: 'The outpaint mask appears after the canvas expand pass.',
          promoteable: false,
          checker: false,
          primary: false
        }
      ];
    }

    return [
        {
          id: 'enhance',
          title: 'Enhanced Render',
          engine: enhanceMode === 'upscale' ? 'Real-ESRGAN' : 'Enhancement pipeline',
          url: enhanceUrl,
          empty: 'Run the selected enhancement pass to produce a finishing render.',
          promoteable: true,
          promoteLabel: 'Route back to source',
        promoteStage: 'Enhanced source',
        nextTool: 'enhance',
        checker: false,
        primary: true
      }
    ];
  }, [cutoutUrl, enhanceMode, enhanceUrl, eraseUrl, expandMaskUrl, expandUrl, maskUrl, quality, relightMaskUrl, relightUrl, selectionCutoutUrl, selectionMaskUrl, selectionMeta?.label, tool]);

  const activeMaskUrl =
    tool === 'select'
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

  const sourcePreviewStyles = cutoutUrl && tool === 'remove_bg' ? makeCheckerBg() : undefined;
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
            <div className="mt-6 text-sm font-medium tracking-wide text-gray-900">Import seed asset or route an output into the source chain</div>
            <div className="mt-2 max-w-md text-sm leading-6 text-gray-500">
              This workbench treats cutout, cleanup, and enhancement as one connected sequence. Start with a seed asset and promote renders back into source when you want to continue the stack.
            </div>
            <div className="mt-6">
              <Button variant="primary" onClick={onPickFile} disabled={isUploading}>
                <ImagePlus className="h-4 w-4" />
                Import seed asset
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
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-0" style={primaryOutput?.checker ? makeCheckerBg() : undefined}>
            <img src={primaryOutputUrl} alt={primaryOutput?.title || 'Result'} className="block max-h-[780px] max-w-full rounded-xl" />
          </div>
        </div>
      );
    }

    if (viewportMode === 'compare' && primaryOutputUrl) {
      return (
        <div className="flex min-h-[720px] items-center justify-center p-10">
          <div className="relative inline-block overflow-hidden rounded-xl border border-gray-100 bg-gray-50" style={primaryOutput?.checker ? makeCheckerBg() : undefined}>
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
          <div className="rounded-xl border border-gray-100 bg-gray-50" style={sourcePreviewStyles}>
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Active source asset"
              className="block max-h-[780px] max-w-full rounded-sm"
              onLoad={() => ensureMaskCanvasSize()}
            />
          </div>

          {(tool === 'remove_bg' || tool === 'select') && activeMaskUrl && (
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
              <span className="text-[15px] font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">Photo Magic</span>
              <div className="flex items-center gap-1.5 mt-[-2px]">
                <span className="text-[9px] font-semibold text-indigo-500 tracking-widest uppercase">Studio Engine</span>
                <div className="w-1 h-1 rounded-full bg-indigo-400" />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>{sourceStage}</span>
                <span className="h-1 w-1 rounded-full bg-gray-300" />
                <span>{sourceLabel || 'Awaiting seed asset'}</span>
                <span className="h-1 w-1 rounded-full bg-gray-300" />
                <span>{sourceDimensions}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-1.5 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-50 blur-[2px]" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 pm-pulse-badge" />
              </span>
              <span className="text-[11px] font-semibold text-gray-600">
                {readyCount}/{visibleStack.length} Online
              </span>
            </div>
            <Button variant="secondary" onClick={refreshHealth} disabled={isHealthLoading}>
              <RefreshCw className={cn('h-4 w-4', isHealthLoading ? 'animate-spin' : '')} />
              Sync
            </Button>
            <button
              type="button"
              onClick={onPickFile}
              disabled={isUploading}
              className="pm-shimmer flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold shadow-md shadow-blue-500/20 transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              Import Asset
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
          </div>
        </div>

        <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
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

              <div className="relative overflow-hidden bg-[#f0f0f3]" style={makeCheckerBg()}>
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

                {/* Floating zoom controls */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-2xl border border-white/60 bg-white/75 px-1.5 py-1.5 shadow-xl z-10 pm-hover-lift" style={{ backdropFilter: 'blur(24px)' }}>
                  <button type="button" className="p-2 text-gray-500 hover:text-gray-900 hover:bg-white rounded-xl transition">
                    <Wand2 className="h-4 w-4" />
                  </button>
                  <div className="px-3 text-[11px] font-bold text-gray-700 font-mono tracking-wider bg-white/50 py-1 rounded-lg">100%</div>
                  <button type="button" className="p-2 text-gray-500 hover:text-gray-900 hover:bg-white rounded-xl transition">
                    <Layers3 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 px-5 py-3">
                <div className="text-xs text-gray-500">
                  {tool === 'remove_bg' && precisionMode
                    ? 'Precision mode is live. Click to add keep points. Hold Alt or Command to add remove points.'
                    : tool === 'select'
                      ? 'Target selection can either extract the detected asset or hand its mask straight to eraser for removal.'
                      : tool === 'relight'
                        ? 'Lighting stage reshapes the active source with highlight bias and cast shadow. Use Compare to judge grounding.'
                        : tool === 'expand'
                          ? 'Canvas expand regenerates only the missing frame area. Route the expanded result back into source for the next pass.'
                    : tool === 'erase' && imageSrc
                      ? 'Paint removal regions on the active source. Switch to Compare to inspect the clean plate after render.'
                      : 'Route outputs back into source when you want to continue the stack from the latest render.'}
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

          <div className="pm-glass-panel pm-scroll flex flex-col overflow-y-auto border-l border-white p-5" style={{ background: 'rgba(255,255,255,0.40)', boxShadow: '-20px 0 40px rgba(0,0,0,0.03)' }}>
            <div className="mb-6">
              <h2 className="text-[13px] font-bold tracking-widest uppercase text-gray-400 mb-4 flex items-center gap-2">
                <Layers3 className="h-4 w-4" /> Operation Mode
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(availableTools).map(([value, config]) => {
                  const display = TOOL_DISPLAY[value] || { label: config.label, accent: config.engine, icon: Layers3 };
                  const ToolIcon = display.icon;

                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setTool(value);
                        setError(null);
                        if (value !== 'remove_bg') setPrecisionMode(false);
                        if (value === 'erase' || value === 'select' || value === 'relight' || value === 'expand') setViewportMode('source');
                      }}
                      className={cn(
                        'group relative overflow-hidden rounded-2xl border px-3 py-3 text-left transition-all duration-300',
                        tool === value
                          ? 'border-indigo-200 bg-white shadow-[0_12px_32px_rgba(99,102,241,0.14)]'
                          : 'border-gray-200/70 bg-white/72 hover:-translate-y-0.5 hover:border-indigo-100 hover:bg-white hover:shadow-sm'
                      )}
                      style={{ backdropFilter: 'blur(18px)' }}
                    >
                      <div
                        className={cn(
                          'pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300',
                          tool === value ? 'opacity-100' : 'group-hover:opacity-70'
                        )}
                        style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0), rgba(99,102,241,0.55), rgba(255,255,255,0))' }}
                      />
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={cn(
                              'flex h-9 w-9 items-center justify-center rounded-2xl border transition-all duration-300',
                              tool === value ? 'border-indigo-100 bg-indigo-50 text-indigo-600' : 'border-white/80 bg-white text-gray-500'
                            )}
                          >
                            <ToolIcon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">{display.accent}</div>
                            <div className={cn('mt-1 text-sm font-semibold', tool === value ? 'text-gray-950' : 'text-gray-700')}>{display.label}</div>
                          </div>
                        </div>
                        <span
                          className={cn(
                            'mt-1 h-2.5 w-2.5 rounded-full transition-all duration-300',
                            tool === value ? 'animate-pulse bg-indigo-500 shadow-[0_0_0_6px_rgba(99,102,241,0.08)]' : 'bg-gray-200 group-hover:bg-indigo-200'
                          )}
                        />
                      </div>
                      <div className="mt-3 text-[12px] leading-5 text-gray-500">{config.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {['remove_bg', 'select', 'erase'].includes(tool) ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <Label>Execution Parameters</Label>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <RangeControl
                    label="Detail Budget"
                    value={maxSide}
                    min={256}
                    max={8192}
                    step={64}
                    onChange={(value) => setMaxSide(clamp(toNumber(value, 2048), 256, 8192))}
                    formatValue={(value) => `${value}px`}
                    minLabel="Fast"
                    maxLabel="Fine detail"
                    hint="The working resolution for AI passes. Raise it when tiny logos, seams, or tags need more edge fidelity."
                  />
                  <RangeControl
                    label="Edge Grow"
                    value={maskDilatePx}
                    min={0}
                    max={64}
                    step={1}
                    onChange={(value) => setMaskDilatePx(clamp(toNumber(value, 0), 0, 64))}
                    formatValue={(value) => `${value}px`}
                    minLabel="Tight"
                    maxLabel="Wider"
                    hint="Expands the detected mask before the render runs, useful when the selection is clipping the edge."
                  />
                  <RangeControl
                    label="Edge Softness"
                    value={maskFeatherPx}
                    min={0}
                    max={64}
                    step={1}
                    onChange={(value) => setMaskFeatherPx(clamp(toNumber(value, 0), 0, 64))}
                    formatValue={(value) => `${value}px`}
                    minLabel="Crisp"
                    maxLabel="Blended"
                    hint="Softens the mask edge so the cutout or cleanup feels less mechanical against the source."
                  />
                  {tool === 'erase' ? (
                    <RangeControl
                      label="Cleanup Margin"
                      value={cropMarginPx}
                      min={0}
                      max={2048}
                      step={16}
                      onChange={(value) => setCropMarginPx(clamp(toNumber(value, 128), 0, 2048))}
                      formatValue={(value) => `${value}px`}
                      minLabel="Mask bounds"
                      maxLabel="More breathing room"
                      hint="Adds extra space around the painted area before inpainting so cleanup has room to rebuild the surrounding pixels."
                    />
                  ) : (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-3 py-3 text-xs leading-5 text-gray-500">
                      {tool === 'select'
                        ? 'Target Selection uses Gemini Vision to pick the right region, then either extracts that target or hands its mask to eraser.'
                        : 'Isolation stages share the same mask dilation and feather controls so the cutout chain stays consistent.'}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {tool === 'remove_bg' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <Label>Foreground Isolation</Label>
                <div className="mt-3 text-sm text-gray-600">Run the auto cutout first, then enter SAM2 precision if the silhouette needs manual correction.</div>

                <div className="mt-4 space-y-3">
                  <Button variant="primary" onClick={runRemoveBg} disabled={!imageId || isRunning || !rmbg2Ready} className="w-full justify-center">
                    <Wand2 className="h-4 w-4" />
                    Execute cutout
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPrecisionMode((prev) => !prev);
                      setViewportMode('source');
                    }}
                    disabled={!imageId || isRunning || !sam2Ready}
                    className="w-full justify-center"
                  >
                    <Sparkles className="h-4 w-4" />
                    {precisionMode ? 'Exit SAM2 precision' : 'Enter SAM2 precision'}
                  </Button>

                  {precisionMode ? (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-3">
                      <div className="text-sm font-medium text-gray-900">SAM2 guide points</div>
                      <div className="mt-2 text-xs leading-5 text-gray-500">
                        Default clicks add keep points. Hold Alt or Command for remove points. The refine pass uses the current source plus your point set.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="primary" onClick={runRefine} disabled={!points.length || isRunning}>
                          Apply precision mask ({points.length})
                        </Button>
                        <Button variant="secondary" onClick={() => setPoints([])} disabled={!points.length || isRunning}>
                          Clear points
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {tool === 'select' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <Label>Target Selection</Label>
                <div className="mt-3 text-sm text-gray-600">Describe a logo, label, tag, or object. Photo Magic will detect one best region, then either isolate it as its own asset or pass the mask directly into eraser.</div>

                <div className="mt-4">
                  <Label>Deliver Into</Label>
                  <div className="mt-2">
                    <Toggle
                      value={selectionIntent}
                      onChange={setSelectionIntent}
                      options={[
                        { value: 'extract', label: 'Extract target', title: 'Keep only the detected target as a separate asset.' },
                        { value: 'erase', label: 'Send to eraser', title: 'Detect the target and drop its mask straight into Clean Plate.' }
                      ]}
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <Label>Target Prompt</Label>
                  <div className="mt-2">
                    <Input
                      value={selectionPrompt}
                      onChange={(event) => setSelectionPrompt(event.target.value)}
                      placeholder='logo on hoodie, neck label, price tag, chest text'
                    />
                  </div>
                </div>

                {selectionMeta ? (
                  <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-gray-900">{selectionMeta.label || 'Resolved target'}</div>
                      <div className="text-[11px] font-mono text-gray-500">{Math.round((selectionMeta.confidence || 0) * 100)}%</div>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-gray-500">
                      {selectionMeta.notes || (selectionIntent === 'erase'
                        ? 'The detection is ready to remove from the source. Send the mask to eraser when you want instant cleanup.'
                        : 'The detection is ready as its own asset. Route the extracted result back into source if you want to keep editing it.')}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectionCutoutUrl ? (
                        <Button
                          variant="secondary"
                          onClick={() => promoteOutputToSource({
                            url: selectionCutoutUrl,
                            stageLabel: selectionMeta?.label ? `${selectionMeta.label} source` : 'Selected source',
                            nextTool: 'erase'
                          })}
                          disabled={isRunning}
                        >
                          <Upload className="h-4 w-4" />
                          Route extracted target
                        </Button>
                      ) : null}
                      {selectionMaskUrl ? (
                        <Button variant="secondary" onClick={() => runSelect('erase')} disabled={isRunning}>
                          <Paintbrush className="h-4 w-4" />
                          Refresh eraser mask
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4">
                  <Button variant="primary" onClick={() => runSelect()} disabled={!imageId || isRunning || !geminiReady || !selectionPrompt.trim()} className="w-full justify-center">
                    <Sparkles className="h-4 w-4" />
                    {selectionIntent === 'erase' ? 'Find target and prep eraser' : 'Find and isolate target'}
                  </Button>
                </div>
              </div>
            ) : null}

            {tool === 'erase' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <Label>Clean Plate Engine</Label>
                <div className="mt-4">
                  <Toggle
                    value={quality}
                    onChange={setQuality}
                    options={[
                      { value: 'standard', label: 'LaMa', title: 'Fast standard cleanup' },
                      { value: 'hq', label: 'SDXL HQ', disabled: hqOption.disabled, title: hqOption.title }
                    ]}
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Brush Size</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={4}
                        max={256}
                        value={brushSize}
                        onChange={(event) => setBrushSize(clamp(toNumber(event.target.value, 32), 4, 256))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Mask Mode</Label>
                    <div className="mt-2">
                      <Toggle
                        value={eraseMode}
                        onChange={setEraseMode}
                        options={[
                          { value: 'paint', label: 'Paint' },
                          { value: 'erase', label: 'Erase' }
                        ]}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50/80 px-3 py-3">
                  <div>
                    <Label>Crop to Mask</Label>
                    <div className="mt-2 text-sm text-gray-600">Limit the render region to the painted area before cleanup.</div>
                  </div>
                  <Button variant={cropToMask ? 'primary' : 'secondary'} onClick={() => setCropToMask((prev) => !prev)} className="px-3 py-1.5 text-xs">
                    {cropToMask ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={undoMask} disabled={isRunning}>
                    Undo mask
                  </Button>
                  <Button variant="secondary" onClick={clearMask} disabled={isRunning}>
                    Clear mask
                  </Button>
                </div>

                <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/80 px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <Label>Mask Coverage</Label>
                      <div className="mt-2 text-sm font-medium text-gray-900">
                        {cleanPlateMaskReady ? `${maskCoverageLabel} painted` : 'No active clean plate mask'}
                      </div>
                    </div>
                    <StatusPill
                      ok={cleanPlateMaskReady}
                      label={cleanPlateMaskReady ? 'Mask ready' : 'Mask needed'}
                      title={cleanPlateMaskReady ? `${maskMetrics.paintedPixels} painted pixels` : 'Paint over the source or route a mask artifact first'}
                    />
                  </div>
                  <div className="mt-2 text-xs leading-5 text-gray-500">
                    {latestMaskForErase
                      ? 'If the surface is blank, Photo Magic will auto-load the latest available mask before rendering.'
                      : 'Paint over the region to remove. Clean plate will not run until the mask surface contains visible pixels.'}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label>Prompt Masking</Label>
                      <div className="mt-2 text-sm leading-6 text-gray-600">Describe what should disappear, and Gemini will detect it and route the mask straight into this eraser surface.</div>
                    </div>
                    <StatusPill ok={geminiReady} label={geminiReady ? 'Gemini on' : 'Gemini off'} title={geminiReady ? 'Gemini prompt targeting is available' : 'Set GEMINI_API_KEY to use prompt masking'} />
                  </div>
                  <div className="mt-3 flex flex-col gap-3">
                    <Input
                      value={selectionPrompt}
                      onChange={(event) => setSelectionPrompt(event.target.value)}
                      placeholder='logo on hoodie, neck label, chest text, hang tag'
                    />
                    <Button
                      variant="secondary"
                      onClick={() => runSelect('erase')}
                      disabled={!imageId || isRunning || !geminiReady || !selectionPrompt.trim()}
                      className="justify-center"
                    >
                      <Sparkles className="h-4 w-4" />
                      Find target mask
                    </Button>
                  </div>
                </div>

                {quality === 'hq' ? (
                  <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-3">
                    <div className="text-sm font-medium text-gray-900">SDXL tuning</div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <Label>Steps</Label>
                        <div className="mt-2">
                          <Input
                            type="number"
                            min={5}
                            max={80}
                            value={sdxlSteps}
                            onChange={(event) => setSdxlSteps(clamp(toNumber(event.target.value, 20), 5, 80))}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Guidance</Label>
                        <div className="mt-2">
                          <Input
                            type="number"
                            min={0}
                            max={20}
                            step="0.1"
                            value={sdxlGuidance}
                            onChange={(event) => setSdxlGuidance(clamp(toNumber(event.target.value, 8), 0, 20))}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Strength</Label>
                        <div className="mt-2">
                          <Input
                            type="number"
                            min={0}
                            max={1}
                            step="0.01"
                            value={sdxlStrength}
                            onChange={(event) => setSdxlStrength(clamp(toNumber(event.target.value, 0.99), 0, 1))}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Seed</Label>
                        <div className="mt-2">
                          <Input
                            type="number"
                            min={0}
                            max={2147483647}
                            value={sdxlSeed}
                            onChange={(event) => setSdxlSeed(clamp(toNumber(event.target.value, 0), 0, 2147483647))}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4">
                  <Button
                    variant="primary"
                    onClick={runErase}
                    disabled={!imageId || isRunning || (quality === 'hq' ? hqOption.disabled : !lamaReady) || (!cleanPlateMaskReady && !latestMaskForErase)}
                    className="w-full justify-center"
                  >
                    <Eraser className="h-4 w-4" />
                    {quality === 'hq' ? 'Execute HQ clean plate' : 'Execute clean plate'}
                  </Button>
                </div>
              </div>
            ) : null}

            {tool === 'relight' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <Label>Lighting Stage</Label>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Preset</Label>
                    <div className="mt-2">
                      <Select value={relightPreset} onChange={(event) => setRelightPreset(event.target.value)}>
                        <option value="studio">Studio</option>
                        <option value="window_left">Window Left</option>
                        <option value="window_right">Window Right</option>
                        <option value="golden_hour">Golden Hour</option>
                        <option value="rim">Rim Light</option>
                      </Select>
                    </div>
                  </div>
                  <RangeControl
                    label="Shadow Softness"
                    value={shadowBlurPx}
                    min={0}
                    max={240}
                    step={1}
                    onChange={(value) => setShadowBlurPx(clamp(toNumber(value, 42), 0, 240))}
                    formatValue={(value) => `${value}px`}
                    minLabel="Tight"
                    maxLabel="Airy"
                    hint="Softens the cast shadow edge so the subject feels grounded without looking pasted in."
                  />
                  <RangeControl
                    label="Subject Lift"
                    value={subjectBoost}
                    min={-0.2}
                    max={0.8}
                    step={0.01}
                    onChange={(value) => setSubjectBoost(clamp(toNumber(value, 0.22), -0.2, 0.8))}
                    formatValue={(value) => value.toFixed(2)}
                    minLabel="Muted"
                    maxLabel="Hero"
                    hint="Pushes highlight energy into the subject without changing the whole frame."
                  />
                  <RangeControl
                    label="Backdrop Exposure"
                    value={backgroundExposure}
                    min={-0.6}
                    max={0.35}
                    step={0.01}
                    onChange={(value) => setBackgroundExposure(clamp(toNumber(value, -0.08), -0.6, 0.35))}
                    formatValue={(value) => value.toFixed(2)}
                    minLabel="Moodier"
                    maxLabel="Lighter"
                    hint="Grades the background independently so the subject can step forward without losing depth."
                  />
                  <RangeControl
                    label="Color Warmth"
                    value={relightWarmth}
                    min={-0.35}
                    max={0.35}
                    step={0.01}
                    onChange={(value) => setRelightWarmth(clamp(toNumber(value, 0.08), -0.35, 0.35))}
                    formatValue={(value) => value.toFixed(2)}
                    minLabel="Cooler"
                    maxLabel="Warmer"
                    hint="Shifts the light mood from cooler editorial tones to warmer hero-lighting."
                  />
                  <RangeControl
                    label="Shadow Density"
                    value={shadowOpacity}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) => setShadowOpacity(clamp(toNumber(value, 0.28), 0, 1))}
                    formatValue={(value) => `${Math.round(value * 100)}%`}
                    minLabel="Light"
                    maxLabel="Dense"
                    hint="Controls how visible the grounding shadow is once the lighting pass is rendered."
                  />
                  <RangeControl
                    label="Shadow Drift X"
                    value={shadowOffsetX}
                    min={-256}
                    max={256}
                    step={1}
                    onChange={(value) => setShadowOffsetX(clamp(toNumber(value, 0), -256, 256))}
                    formatValue={(value) => `${value}px`}
                    minLabel="Left"
                    maxLabel="Right"
                    hint="Slides the cast shadow sideways to match the implied light direction."
                  />
                  <RangeControl
                    label="Shadow Drop Y"
                    value={shadowOffsetY}
                    min={-256}
                    max={256}
                    step={1}
                    onChange={(value) => setShadowOffsetY(clamp(toNumber(value, 34), -256, 256))}
                    formatValue={(value) => `${value}px`}
                    minLabel="Lift"
                    maxLabel="Drop"
                    hint="Moves the shadow forward or backward to keep contact with the floor plane."
                  />
                </div>

                <div className="mt-4">
                  <Button variant="primary" onClick={runRelight} disabled={!imageId || isRunning || !relightReady} className="w-full justify-center">
                    <Sparkles className="h-4 w-4" />
                    Execute lighting stage
                  </Button>
                </div>
              </div>
            ) : null}

            {tool === 'expand' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <Label>Canvas Expand</Label>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Aspect Ratio</Label>
                    <div className="mt-2">
                      <Select value={expandAspectRatio} onChange={(event) => setExpandAspectRatio(event.target.value)}>
                        <option value="1:1">1:1</option>
                        <option value="4:5">4:5</option>
                        <option value="5:4">5:4</option>
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="3:2">3:2</option>
                        <option value="2:3">2:3</option>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Anchor</Label>
                    <div className="mt-2">
                      <Select value={expandAnchor} onChange={(event) => setExpandAnchor(event.target.value)}>
                        <option value="center">Center</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="top">Top</option>
                        <option value="bottom">Bottom</option>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <Label>Prompt</Label>
                  <div className="mt-2">
                    <Input value={expandPrompt} onChange={(event) => setExpandPrompt(event.target.value)} placeholder="premium studio backdrop, soft floor gradient, natural depth" />
                  </div>
                </div>

                <div className="mt-4">
                  <Label>Negative Prompt</Label>
                  <div className="mt-2">
                    <Input value={expandNegativePrompt} onChange={(event) => setExpandNegativePrompt(event.target.value)} placeholder="text, watermark, duplicate subject, clutter" />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Steps</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={5}
                        max={80}
                        value={expandSteps}
                        onChange={(event) => setExpandSteps(clamp(toNumber(event.target.value, 24), 5, 80))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Guidance</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={20}
                        step="0.1"
                        value={expandGuidance}
                        onChange={(event) => setExpandGuidance(clamp(toNumber(event.target.value, 7.5), 0, 20))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Strength</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step="0.01"
                        value={expandStrength}
                        onChange={(event) => setExpandStrength(clamp(toNumber(event.target.value, 0.96), 0, 1))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Feather</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={128}
                        value={expandFeatherPx}
                        onChange={(event) => setExpandFeatherPx(clamp(toNumber(event.target.value, 24), 0, 128))}
                      />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Label>Seed</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={2147483647}
                        value={expandSeed}
                        onChange={(event) => setExpandSeed(clamp(toNumber(event.target.value, 0), 0, 2147483647))}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <Button variant="primary" onClick={runExpand} disabled={!imageId || isRunning || !expandReady} className="w-full justify-center">
                    <Sparkles className="h-4 w-4" />
                    Execute canvas expand
                  </Button>
                </div>
              </div>
            ) : null}

            {tool === 'enhance' ? (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <Label>Enhancement Pass</Label>
                <div className="mt-4">
                  <Label>Mode</Label>
                  <div className="mt-2">
                    <Select value={enhanceMode} onChange={(event) => setEnhanceMode(event.target.value)}>
                      <option value="upscale">Upscale</option>
                      <option value="denoise">Denoise</option>
                      <option value="deblur">Deblur</option>
                      <option value="sharpen">Sharpen</option>
                      <option value="low_light">Low light</option>
                    </Select>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Strength</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step="0.05"
                        value={enhanceStrength}
                        onChange={(event) => setEnhanceStrength(clamp(toNumber(event.target.value, 0.5), 0, 1))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Upscale Factor</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={1}
                        max={4}
                        step="1"
                        value={upscaleFactor}
                        onChange={(event) => setUpscaleFactor(clamp(toNumber(event.target.value, 2), 1, 4))}
                        disabled={enhanceMode !== 'upscale'}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <Button
                    variant="primary"
                    onClick={runEnhance}
                    disabled={!imageId || isRunning || (enhanceMode === 'upscale' && !realEsrganReady)}
                    className="w-full justify-center"
                  >
                    <Sparkles className="h-4 w-4" />
                    Execute enhancement pass
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

                    <div className="mt-3 overflow-hidden rounded-xl border border-gray-100 bg-gray-50" style={card.checker ? makeCheckerBg() : undefined}>
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

        <div className="border-t border-gray-100 bg-white/60 px-5 py-3" style={{ backdropFilter: 'blur(24px)' }}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-mono uppercase tracking-[0.16em] text-gray-400">
            <span>{stageConfig?.label || tool}</span>
            <span>{isUploading ? 'Uploading...' : isRunning ? 'Processing...' : lastRenderSummary}</span>
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
    </div>
  );
}
