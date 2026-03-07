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
        'inline-flex items-center gap-2 rounded-sm border px-2.5 py-1 text-[11px] font-semibold tracking-wide',
        ok ? 'border-emerald-900 bg-emerald-950/40 text-emerald-300' : 'border-rose-900 bg-rose-950/30 text-rose-300'
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
    primary: 'border border-amber-400/40 bg-amber-500 text-[#09090b] hover:bg-amber-400',
    secondary: 'border border-slate-700 bg-[#161b23] text-slate-100 hover:bg-[#1d2430]',
    ghost: 'border border-transparent bg-transparent text-slate-400 hover:border-slate-700 hover:bg-[#161b23] hover:text-slate-100'
  };

  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm px-3 py-2 text-sm font-medium transition-colors',
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
  return <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">{children}</div>;
}

function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'w-full rounded-sm border border-slate-700 bg-[#0f131a] px-3 py-2 text-sm text-slate-100 outline-none transition-colors',
        'focus:border-amber-400 focus:bg-[#121924]',
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
        'w-full rounded-sm border border-slate-700 bg-[#0f131a] px-3 py-2 text-sm text-slate-100 outline-none transition-colors',
        'focus:border-amber-400 focus:bg-[#121924]',
        className
      )}
      {...props}
    >
      {children}
    </select>
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
            'rounded-sm border px-3 py-2 text-sm font-medium transition-colors',
            'disabled:cursor-not-allowed disabled:opacity-45',
            value === opt.value
              ? 'border-amber-400 bg-amber-500/12 text-amber-100'
              : 'border-slate-700 bg-[#0f131a] text-slate-300 hover:bg-[#151b24]'
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
      'linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%),' +
      'linear-gradient(-45deg, rgba(255,255,255,0.05) 25%, transparent 25%),' +
      'linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.05) 75%),' +
      'linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.05) 75%)',
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
    label: 'Prompt Selection',
    engine: 'Gemini Vision + SAM2',
    description: 'Find a target from a text prompt, then convert the detection into a production mask.'
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
  const [showDebugPanel, setShowDebugPanel] = useState(true);
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
        title: 'Prompt Selection',
        model: 'Gemini Vision + SAM2',
        ready: Boolean(geminiReady && sam2Ready),
        description: 'Language-based target pickup that resolves into a real mask.',
        error: geminiReady ? (aiHealthPayload?.errors?.sam2 || '') : 'GEMINI_API_KEY is not configured.'
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

  const readyCount = connectedStack.filter((item) => item.ready).length;
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
          title: 'Selected Asset',
          engine: selectionMeta?.label ? `Gemini: ${selectionMeta.label}` : 'Gemini Vision / SAM2',
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
          title: 'Selection Mask',
          engine: 'Prompt mask',
          url: selectionMaskUrl,
          empty: 'The target mask appears after the prompt selection pass.',
          promoteable: false,
          maskAction: selectionMaskUrl ? 'Route to clean plate' : null,
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
            <div className="absolute left-1/2 top-1/2 h-24 w-px -translate-x-1/2 -translate-y-1/2 bg-slate-700" />
            <div className="absolute left-1/2 top-1/2 h-px w-24 -translate-x-1/2 -translate-y-1/2 bg-slate-700" />
            <Crosshair className="relative z-10 h-6 w-6 text-slate-500" />
            <div className="mt-6 text-sm font-medium tracking-wide text-slate-100">Import seed asset or route an output into the source chain</div>
            <div className="mt-2 max-w-md text-sm leading-6 text-slate-400">
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
          <img src={activeMaskUrl} alt="Mask artifact" className="block max-h-[780px] max-w-full rounded-sm border border-slate-700 bg-[#10151d]" />
        </div>
      );
    }

    if (viewportMode === 'result' && primaryOutputUrl) {
      return (
        <div className="flex min-h-[720px] items-center justify-center p-10">
          <div className="rounded-sm border border-slate-700 bg-[#10151d] p-0" style={primaryOutput?.checker ? makeCheckerBg() : undefined}>
            <img src={primaryOutputUrl} alt={primaryOutput?.title || 'Result'} className="block max-h-[780px] max-w-full rounded-sm" />
          </div>
        </div>
      );
    }

    if (viewportMode === 'compare' && primaryOutputUrl) {
      return (
        <div className="flex min-h-[720px] items-center justify-center p-10">
          <div className="relative inline-block overflow-hidden rounded-sm border border-slate-700 bg-[#10151d]" style={primaryOutput?.checker ? makeCheckerBg() : undefined}>
            <img src={primaryOutputUrl} alt={primaryOutput?.title || 'Result'} className="block max-h-[780px] max-w-full rounded-sm" />
            <div className="pointer-events-none absolute inset-0">
              <img
                src={imageSrc}
                alt="Source asset"
                className="block h-full w-full object-contain"
                style={{ clipPath: `inset(0 ${100 - compareSplit}% 0 0)` }}
              />
            </div>
            <div className="pointer-events-none absolute inset-y-0 border-r border-white/80" style={{ left: `${compareSplit}%` }} />
            <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-slate-700 bg-[#0f131a]/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              Source
            </div>
            <div className="pointer-events-none absolute right-4 top-4 rounded-md border border-slate-700 bg-[#0f131a]/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              Result
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-[720px] items-center justify-center p-10">
        <div className="relative inline-block select-none" onClick={addPointFromEvent}>
          <div className="rounded-sm border border-slate-700 bg-[#10151d]" style={sourcePreviewStyles}>
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
    <div className="px-4 py-4 text-slate-100" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div className="mx-auto max-w-[1880px] overflow-hidden rounded-sm border border-slate-800 bg-[#0f1115]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-amber-400/30 bg-amber-500/10 text-amber-200">
              <Wand2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">Creative Studio / Photo Magic</div>
              <div className="mt-1 text-lg font-semibold tracking-tight text-white">Photo Magic Studio</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{sourceStage}</span>
                <span className="h-1 w-1 rounded-full bg-slate-700" />
                <span>{sourceLabel || 'Awaiting seed asset'}</span>
                <span className="h-1 w-1 rounded-full bg-slate-700" />
                <span>{sourceDimensions}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-sm border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-[11px] font-mono text-cyan-200">
              Stack {readyCount}/{connectedStack.length} online
            </div>
            <Button variant="secondary" onClick={refreshHealth} disabled={isHealthLoading}>
              <RefreshCw className={cn('h-4 w-4', isHealthLoading ? 'animate-spin' : '')} />
              Sync stack
            </Button>
            <Button variant="primary" onClick={onPickFile} disabled={isUploading}>
              <Upload className="h-4 w-4" />
              Import seed asset
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
          </div>
        </div>

        <div className="grid xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <div className="border-b border-slate-800 bg-[#11161e] p-4 xl:border-b-0 xl:border-r">
            <div className="rounded-md border border-slate-800 bg-[#0d1117] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Active Source</Label>
                  <div className="mt-2 text-sm font-medium text-slate-100">{sourceLabel || 'No source loaded'}</div>
                </div>
                <StatusPill ok={Boolean(imageId)} label={imageId ? 'Loaded' : 'Idle'} title={imageId || 'Upload a source image'} />
              </div>

              <div className="mt-4 overflow-hidden rounded-sm border border-slate-800 bg-[#161b23]" style={imageSrc ? makeCheckerBg() : undefined}>
                {imageSrc ? (
                  <img src={imageSrc} alt="Source preview" className="block aspect-[4/5] w-full object-contain" />
                ) : (
                  <div className="flex aspect-[4/5] items-center justify-center text-sm text-slate-500">Source preview</div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <Label>Stage</Label>
                  <div className="mt-2 text-sm text-slate-200">{sourceStage}</div>
                </div>
                <div>
                  <Label>File</Label>
                  <div className="mt-2 text-sm text-slate-200">{imageMeta?.filename || '-'}</div>
                </div>
                <div>
                  <Label>Resolution</Label>
                  <div className="mt-2 text-sm text-slate-200">{sourceDimensions}</div>
                </div>
                <div>
                  <Label>Size</Label>
                  <div className="mt-2 text-sm text-slate-200">{formatBytes(imageMeta?.size)}</div>
                </div>
              </div>

              <div className="mt-4">
                <Label>Working Chain</Label>
                <div className="mt-2 rounded-md border border-slate-800 bg-[#0f131a] px-3 py-2 text-xs font-mono text-slate-400">
                  {sourceHistory.length ? sourceHistory.join(' > ') : 'Seed asset > Render > Promote back to source'}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Connected Stack</Label>
                  <div className="mt-2 text-sm font-medium text-slate-100">Every engine is surfaced as a real stage</div>
                </div>
                <Layers3 className="h-4 w-4 text-slate-500" />
              </div>

              <div className="mt-4 space-y-3">
                {connectedStack.map((item) => (
                  <div key={item.id} className="rounded-sm border border-slate-800 bg-[#10151d] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-100">{item.title}</div>
                      <StatusPill ok={item.ready} label={item.ready ? 'Online' : 'Offline'} title={item.error} />
                    </div>
                    <div className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-cyan-300/80">{item.model}</div>
                    <div className="mt-2 text-xs leading-5 text-slate-400">{item.description}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Diagnostics</Label>
                  <div className="mt-2 text-sm font-medium text-slate-100">Service status and payload detail</div>
                </div>
                <Button variant="ghost" onClick={() => setShowDiagnostics((prev) => !prev)} className="px-2 py-1 text-xs">
                  {showDiagnostics ? 'Hide' : 'Show'}
                </Button>
              </div>

              {showDiagnostics ? (
                <pre className="mt-4 max-h-[320px] overflow-auto rounded-md border border-slate-800 bg-[#0a0d12] p-3 text-[11px] leading-5 text-slate-400">
                  {JSON.stringify(health ?? null, null, 2)}
                </pre>
              ) : (
                <div className="mt-4 rounded-md border border-dashed border-slate-800 bg-[#0f131a] px-3 py-3 text-xs text-slate-500">
                  Keep this collapsed unless you need exact health payloads from the AI and HQ services.
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 border-b border-slate-800 bg-[#0f1115] p-4 xl:border-b-0 xl:border-r">
            <div className="rounded-md border border-slate-800 bg-[#131922]">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-4 py-3">
                <div>
                  <Label>Viewport</Label>
                  <div className="mt-2 text-sm font-medium text-slate-100">{stageConfig.label}</div>
                  <div className="mt-1 text-xs text-slate-400">{stageConfig.description}</div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {activeViewOptions.map((view) => (
                    <Button
                      key={view.id}
                      variant={viewportMode === view.id ? 'primary' : 'secondary'}
                      disabled={!view.enabled}
                      className="px-3 py-1.5 text-xs"
                      onClick={() => setViewportMode(view.id)}
                    >
                      {view.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="relative overflow-hidden bg-[#1a1d23]">
                {renderCanvas()}

                {imageSrc ? (
                  <div className="pointer-events-none absolute left-6 top-6 rounded-md border border-slate-700 bg-[#0f131a]/90 px-3 py-2 text-[11px] font-mono text-slate-400">
                    {sourceDimensions}
                  </div>
                ) : null}

                <div className="pointer-events-none absolute bottom-6 right-6 rounded-md border border-slate-700 bg-[#0f131a]/90 px-3 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-slate-400">
                  {viewportMode}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 px-4 py-3">
                <div className="text-xs text-slate-400">
                  {tool === 'remove_bg' && precisionMode
                    ? 'Precision mode is live. Click to add keep points. Hold Alt or Command to add remove points.'
                    : tool === 'select'
                      ? 'Prompt selection produces a usable mask. Route the mask into clean plate if you want direct object removal.'
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
                    <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-slate-500">Split</span>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      value={compareSplit}
                      onChange={(event) => setCompareSplit(clamp(toNumber(event.target.value, 56), 10, 90))}
                      className="w-40 accent-amber-400"
                    />
                    <span className="text-[11px] font-mono text-slate-400">{compareSplit}%</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="bg-[#11161e] p-4">
            <div className="rounded-md border border-slate-800 bg-[#0d1117] p-4">
              <Label>Operation Mode</Label>
              <div className="mt-3 space-y-2">
                {Object.entries(TOOL_DEFINITIONS).map(([value, config]) => (
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
                      'w-full rounded-sm border p-3 text-left transition-colors',
                      tool === value
                        ? 'border-amber-400 bg-amber-500/10'
                        : 'border-slate-800 bg-[#10151d] hover:bg-[#151b24]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-100">{config.label}</div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">{config.engine}</div>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-400">{config.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {['remove_bg', 'select', 'erase'].includes(tool) ? (
              <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
                <Label>Execution Parameters</Label>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Source Max Side</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={256}
                        max={8192}
                        value={maxSide}
                        onChange={(event) => setMaxSide(clamp(toNumber(event.target.value, 2048), 256, 8192))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Mask Dilation</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={64}
                        value={maskDilatePx}
                        onChange={(event) => setMaskDilatePx(clamp(toNumber(event.target.value, 0), 0, 64))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Mask Feather</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={64}
                        value={maskFeatherPx}
                        onChange={(event) => setMaskFeatherPx(clamp(toNumber(event.target.value, 0), 0, 64))}
                      />
                    </div>
                  </div>
                  {tool === 'erase' ? (
                    <div>
                      <Label>Crop Margin</Label>
                      <div className="mt-2">
                        <Input
                          type="number"
                          min={0}
                          max={2048}
                          value={cropMarginPx}
                          onChange={(event) => setCropMarginPx(clamp(toNumber(event.target.value, 128), 0, 2048))}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-slate-800 bg-[#10151d] px-3 py-3 text-xs leading-5 text-slate-400">
                      {tool === 'select'
                        ? 'Selection uses Gemini Vision for target pickup, then SAM2 converts the detected region into a production mask.'
                        : 'Isolation stages share the same mask dilation and feather controls so the cutout chain stays consistent.'}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {tool === 'remove_bg' ? (
              <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
                <Label>Foreground Isolation</Label>
                <div className="mt-3 text-sm text-slate-300">Run the auto cutout first, then enter SAM2 precision if the silhouette needs manual correction.</div>

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
                    <div className="rounded-md border border-slate-800 bg-[#10151d] p-3">
                      <div className="text-sm font-medium text-slate-100">SAM2 guide points</div>
                      <div className="mt-2 text-xs leading-5 text-slate-400">
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
              <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
                <Label>Prompt Selection</Label>
                <div className="mt-3 text-sm text-slate-300">Describe the target you want masked. The editor will detect one best region and convert it into a usable production mask.</div>

                <div className="mt-4">
                  <Label>Target Prompt</Label>
                  <div className="mt-2">
                    <Input
                      value={selectionPrompt}
                      onChange={(event) => setSelectionPrompt(event.target.value)}
                      placeholder='price tag, brand logo, shoe, hand, text label'
                    />
                  </div>
                </div>

                {selectionMeta ? (
                  <div className="mt-4 rounded-md border border-slate-800 bg-[#10151d] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-100">{selectionMeta.label || 'Resolved target'}</div>
                      <div className="text-[11px] font-mono text-slate-400">{Math.round((selectionMeta.confidence || 0) * 100)}%</div>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-400">
                      {selectionMeta.notes || 'Prompt detection is ready. Route the mask to clean plate if you want immediate object removal.'}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4">
                  <Button variant="primary" onClick={runSelect} disabled={!imageId || isRunning || !geminiReady || !sam2Ready || !selectionPrompt.trim()} className="w-full justify-center">
                    <Sparkles className="h-4 w-4" />
                    Execute prompt selection
                  </Button>
                </div>
              </div>
            ) : null}

            {tool === 'erase' ? (
              <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
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

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-[#10151d] px-3 py-3">
                  <div>
                    <Label>Crop to Mask</Label>
                    <div className="mt-2 text-sm text-slate-300">Limit the render region to the painted area before cleanup.</div>
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

                <div className="mt-4 rounded-md border border-slate-800 bg-[#10151d] px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <Label>Mask Coverage</Label>
                      <div className="mt-2 text-sm font-medium text-slate-100">
                        {cleanPlateMaskReady ? `${maskCoverageLabel} painted` : 'No active clean plate mask'}
                      </div>
                    </div>
                    <StatusPill
                      ok={cleanPlateMaskReady}
                      label={cleanPlateMaskReady ? 'Mask ready' : 'Mask needed'}
                      title={cleanPlateMaskReady ? `${maskMetrics.paintedPixels} painted pixels` : 'Paint over the source or route a mask artifact first'}
                    />
                  </div>
                  <div className="mt-2 text-xs leading-5 text-slate-400">
                    {latestMaskForErase
                      ? 'If the surface is blank, Photo Magic will auto-load the latest available mask before rendering.'
                      : 'Paint over the region to remove. Clean plate will not run until the mask surface contains visible pixels.'}
                  </div>
                </div>

                {quality === 'hq' ? (
                  <div className="mt-4 rounded-md border border-slate-800 bg-[#10151d] p-3">
                    <div className="text-sm font-medium text-slate-100">SDXL tuning</div>
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
              <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
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
                  <div>
                    <Label>Shadow Blur</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={240}
                        value={shadowBlurPx}
                        onChange={(event) => setShadowBlurPx(clamp(toNumber(event.target.value, 42), 0, 240))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Subject Boost</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={-0.2}
                        max={0.8}
                        step="0.01"
                        value={subjectBoost}
                        onChange={(event) => setSubjectBoost(clamp(toNumber(event.target.value, 0.22), -0.2, 0.8))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Background Exposure</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={-0.6}
                        max={0.35}
                        step="0.01"
                        value={backgroundExposure}
                        onChange={(event) => setBackgroundExposure(clamp(toNumber(event.target.value, -0.08), -0.6, 0.35))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Warmth</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={-0.35}
                        max={0.35}
                        step="0.01"
                        value={relightWarmth}
                        onChange={(event) => setRelightWarmth(clamp(toNumber(event.target.value, 0.08), -0.35, 0.35))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Shadow Opacity</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step="0.01"
                        value={shadowOpacity}
                        onChange={(event) => setShadowOpacity(clamp(toNumber(event.target.value, 0.28), 0, 1))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Shadow X</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={-256}
                        max={256}
                        value={shadowOffsetX}
                        onChange={(event) => setShadowOffsetX(clamp(toNumber(event.target.value, 0), -256, 256))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Shadow Y</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min={-256}
                        max={256}
                        value={shadowOffsetY}
                        onChange={(event) => setShadowOffsetY(clamp(toNumber(event.target.value, 34), -256, 256))}
                      />
                    </div>
                  </div>
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
              <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
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
              <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
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

            <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
              <Label>Rendered Outputs</Label>
              <div className="mt-4 space-y-4">
                {outputCards.map((card) => (
                  <div key={card.id} className="rounded-md border border-slate-800 bg-[#10151d] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-100">{card.title}</div>
                        <div className="mt-1 text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-300/80">{card.engine}</div>
                      </div>
                      <StatusPill ok={Boolean(card.url)} label={card.url ? 'Ready' : 'Idle'} title={card.engine} />
                    </div>

                    <div className="mt-3 overflow-hidden rounded-sm border border-slate-800 bg-[#161b23]" style={card.checker ? makeCheckerBg() : undefined}>
                      {card.url ? (
                        <img src={card.url} alt={card.title} className="block aspect-[4/5] w-full object-contain" />
                      ) : (
                        <div className="flex aspect-[4/5] items-center justify-center px-6 text-center text-sm leading-6 text-slate-500">{card.empty}</div>
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
                          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-[#161b23] px-3 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-[#1d2430]"
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

            <div className="mt-4 rounded-md border border-slate-800 bg-[#0d1117] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Execution Trace</Label>
                  <div className="mt-2 text-sm font-medium text-slate-100">Track each stage request and exact failure point</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={clearDebugTrace} className="px-2 py-1 text-xs">
                    Clear
                  </Button>
                  <Button variant="ghost" onClick={() => setShowDebugPanel((prev) => !prev)} className="px-2 py-1 text-xs">
                    {showDebugPanel ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>

              {showDebugPanel ? (
                debugTrace.length ? (
                  <div className="mt-4 max-h-[420px] space-y-2 overflow-auto">
                    {debugTrace.map((entry) => {
                      const tone =
                        entry.status === 'failed'
                          ? 'border-rose-900/70 bg-rose-950/20'
                          : entry.status === 'success'
                            ? 'border-emerald-900/70 bg-emerald-950/20'
                            : 'border-slate-800 bg-[#10151d]';
                      const pillTone =
                        entry.status === 'failed'
                          ? 'text-rose-300'
                          : entry.status === 'success'
                            ? 'text-emerald-300'
                            : entry.status === 'running'
                              ? 'text-amber-300'
                              : 'text-slate-400';

                      return (
                        <div key={entry.id} className={cn('rounded-md border px-3 py-3', tone)}>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase tracking-[0.16em] text-slate-500">
                              <span>Run {entry.runId}</span>
                              <span>{entry.scope}</span>
                              <span>{entry.step}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={cn('text-[11px] font-mono uppercase tracking-[0.16em]', pillTone)}>{entry.status}</span>
                              <span className="text-[11px] font-mono text-slate-500">{formatDebugTimestamp(entry.at)}</span>
                            </div>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-200">{entry.message}</div>
                          {entry.details ? (
                            <pre className="mt-3 overflow-auto rounded-sm border border-slate-800 bg-[#0b0f15] p-3 text-[11px] leading-5 text-slate-400">
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-md border border-dashed border-slate-800 bg-[#10151d] px-3 py-3 text-xs leading-5 text-slate-500">
                    No execution trace yet. Run a stage and this panel will show request start, success, failure, and any mask or routing blocker.
                  </div>
                )
              ) : (
                <div className="mt-4 rounded-md border border-dashed border-slate-800 bg-[#10151d] px-3 py-3 text-xs leading-5 text-slate-500">
                  Keep this open while testing Photo Magic. It records the last {DEBUG_TRACE_LIMIT} execution events.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-800 bg-[#0b0f15] px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-mono uppercase tracking-[0.16em] text-slate-500">
            <span>Source {sourceLabel || 'none'}</span>
            <span>Tool {tool}</span>
            <span>View {viewportMode}</span>
            <span>Store {store || 'vironax'}</span>
            <span>Status {isUploading ? 'uploading' : isRunning ? 'running' : 'idle'}</span>
            <span>Last {lastRenderSummary}</span>
          </div>
        </div>

        {error ? (
          <div className="border-t border-rose-900/60 bg-rose-950/25 px-5 py-4">
            <div className="flex items-start gap-3 text-sm text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-rose-300">Render Console</div>
                <div className="mt-2 leading-6">{error}</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
