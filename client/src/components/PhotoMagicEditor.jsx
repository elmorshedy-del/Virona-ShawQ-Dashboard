import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eraser,
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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function StatusPill({ ok, label, title }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'
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
    primary: 'bg-gray-900 text-white hover:bg-black',
    secondary: 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-50',
    violet: 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700'
  };
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition shadow-sm',
        'disabled:opacity-50 disabled:cursor-not-allowed',
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
  return <div className="text-[11px] font-semibold tracking-wider text-gray-500 uppercase">{children}</div>;
}

function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none',
        'focus:border-violet-400 focus:ring-4 focus:ring-violet-100',
        className
      )}
      {...props}
    />
  );
}

function Toggle({ value, onChange, options = [] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          disabled={opt.disabled}
          className={cn(
            'rounded-xl border px-3 py-2 text-sm font-semibold transition',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            value === opt.value
              ? 'border-violet-200 bg-violet-50 text-violet-700'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
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

export default function PhotoMagicEditor({ store }) {
  const [health, setHealth] = useState(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [showStatusDetails, setShowStatusDetails] = useState(false);

  const [tool, setTool] = useState('remove_bg'); // remove_bg | erase
  const [error, setError] = useState(null);

  const [imageId, setImageId] = useState(null);
  const [imageMeta, setImageMeta] = useState(null);
  const [imageSrc, setImageSrc] = useState(null); // blob URL
  const fileInputRef = useRef(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  // Background removal results
  const [cutoutUrl, setCutoutUrl] = useState(null);
  const [maskUrl, setMaskUrl] = useState(null);

  // RMBG/SAM settings
  const [maxSide, setMaxSide] = useState(2048);
  const [precisionMode, setPrecisionMode] = useState(false);
  const [points, setPoints] = useState([]); // [{x_norm,y_norm,label}]
  const [maskDilatePx, setMaskDilatePx] = useState(0);
  const [maskFeatherPx, setMaskFeatherPx] = useState(0);

  // Eraser settings + results
  const [quality, setQuality] = useState('standard'); // standard | hq
  const [eraseUrl, setEraseUrl] = useState(null);
  const [brushSize, setBrushSize] = useState(32);
  const [eraseMode, setEraseMode] = useState('paint'); // paint | erase
  const [cropToMask, setCropToMask] = useState(true);
  const [cropMarginPx, setCropMarginPx] = useState(128);
  const [sdxlSteps, setSdxlSteps] = useState(20);
  const [sdxlGuidance, setSdxlGuidance] = useState(8.0);
  const [sdxlStrength, setSdxlStrength] = useState(0.99);
  const [sdxlSeed, setSdxlSeed] = useState(0);

  const imgRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const paintStateRef = useRef({ painting: false, lastX: 0, lastY: 0 });
  const undoStackRef = useRef([]);

  const aiConfigured = Boolean(health?.photo_magic?.ai?.configured);
  const aiHealthPayload = health?.photo_magic?.ai?.health?.payload || {};
  const aiModels = aiHealthPayload?.models || {};
  const rmbg2Ready = Boolean(aiConfigured && aiModels?.rmbg2);
  const sam2Ready = Boolean(aiConfigured && aiModels?.sam2);
  const lamaReady = Boolean(aiConfigured && aiModels?.lama);

  const hqConfigured = Boolean(health?.photo_magic?.hq?.configured);
  const hqOk = Boolean(health?.photo_magic?.hq?.health?.ok);
  const hqReason = health?.photo_magic?.hq?.health?.payload?.errors?.sdxl_inpaint || null;

  const hqOption = useMemo(() => {
    if (!hqConfigured) return { disabled: true, title: 'HQ service not configured (set PHOTO_MAGIC_HQ_AI_URL)' };
    if (!hqOk) return { disabled: true, title: hqReason || 'HQ service not ready' };
    return { disabled: false, title: 'SDXL Inpainting (slow, best quality)' };
  }, [hqConfigured, hqOk, hqReason]);

  const refreshHealth = useCallback(async () => {
    setIsHealthLoading(true);
    try {
      const res = await fetch(withStore('/creative-studio/photo-magic/health', store));
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to load system status');
      setHealth(data);
    } catch (e) {
      console.error(e);
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

  const resetOutputs = useCallback(() => {
    setCutoutUrl(null);
    setMaskUrl(null);
    setEraseUrl(null);
    setPoints([]);
    undoStackRef.current = [];
    const canvas = maskCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const uploadImage = useCallback(async (file) => {
    setError(null);
    setIsUploading(true);
    try {
      resetOutputs();
      const form = new FormData();
      form.append('image', file);
      const res = await fetch(withStore('/creative-studio/photo-magic/upload', store), { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Upload failed');

      setImageId(data.image_id);
      setImageMeta({ width: data.width, height: data.height, filename: data.filename, mime: data.mime });
      setImageSrc(URL.createObjectURL(file));
      setPrecisionMode(false);
      setTool('remove_bg');
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Upload failed');
    } finally {
      setIsUploading(false);
      refreshHealth();
    }
  }, [refreshHealth, resetOutputs, store]);

  const onPickFile = useCallback(() => {
    fileInputRef.current?.click?.();
  }, []);

  const onFileChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) uploadImage(file);
      e.target.value = '';
    },
    [uploadImage]
  );

  const ensureMaskCanvasSize = useCallback(() => {
    const img = imgRef.current;
    const canvas = maskCanvasRef.current;
    if (!img || !canvas) return;
    const rect = img.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w || canvas.height !== h) {
      const prev = document.createElement('canvas');
      prev.width = canvas.width;
      prev.height = canvas.height;
      const prevCtx = prev.getContext('2d');
      prevCtx?.drawImage(canvas, 0, 0);

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, w, h);
      if (prev.width > 0 && prev.height > 0) ctx?.drawImage(prev, 0, 0, w, h);
    }
  }, []);

  useEffect(() => {
    ensureMaskCanvasSize();
    const onResize = () => ensureMaskCanvasSize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ensureMaskCanvasSize]);

  const addPointFromEvent = useCallback(
    (e) => {
      if (tool !== 'remove_bg' || !precisionMode) return;
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      const label = e.altKey || e.metaKey ? 0 : 1;
      setPoints((prev) => [...prev, { x_norm: x, y_norm: y, label }]);
    },
    [precisionMode, tool]
  );

  const runRemoveBg = useCallback(async () => {
    if (!imageId) return;
    setError(null);
    setIsRunning(true);
    try {
      const res = await fetch(withStore('/creative-studio/photo-magic/remove-bg', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: imageId, engine: 'rmbg2', max_side: maxSide })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Background removal failed');
      setCutoutUrl(data.cutout?.url || null);
      setMaskUrl(data.mask?.url || null);
      setTool('remove_bg');
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Background removal failed');
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [imageId, maxSide, refreshHealth, store]);

  const runRefine = useCallback(async () => {
    if (!imageId || !points.length) return;
    setError(null);
    setIsRunning(true);
    try {
      const res = await fetch(withStore('/creative-studio/photo-magic/remove-bg/refine', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_id: imageId,
          points,
          max_side: maxSide,
          mask_dilate_px: maskDilatePx,
          mask_feather_px: maskFeatherPx
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'SAM2 refine failed');
      setCutoutUrl(data.cutout?.url || null);
      setMaskUrl(data.mask?.url || null);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'SAM2 refine failed');
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [imageId, maskDilatePx, maskFeatherPx, maxSide, points, refreshHealth, store]);

  const pushUndo = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      undoStackRef.current.push(dataUrl);
      if (undoStackRef.current.length > 20) undoStackRef.current.shift();
    } catch {}
  }, []);

  const undoMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      ctx?.drawImage(img, 0, 0);
    };
    img.src = prev;
  }, []);

  const clearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    pushUndo();
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
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

  const getCanvasPoint = useCallback((e) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const y = clamp(e.clientY - rect.top, 0, rect.height);
    return { x, y };
  }, []);

  const onMaskPointerDown = useCallback(
    (e) => {
      if (tool !== 'erase') return;
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      ensureMaskCanvasSize();
      pushUndo();

      const p = getCanvasPoint(e);
      if (!p) return;

      paintStateRef.current = { painting: true, lastX: p.x, lastY: p.y };
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {}

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawStroke(ctx, p.x, p.y, p.x, p.y, brushSize / 2, eraseMode);
    },
    [brushSize, drawStroke, ensureMaskCanvasSize, eraseMode, getCanvasPoint, pushUndo, tool]
  );

  const onMaskPointerMove = useCallback(
    (e) => {
      if (tool !== 'erase') return;
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      const state = paintStateRef.current;
      if (!state.painting) return;

      const p = getCanvasPoint(e);
      if (!p) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawStroke(ctx, p.x, p.y, state.lastX, state.lastY, brushSize / 2, eraseMode);
      paintStateRef.current.lastX = p.x;
      paintStateRef.current.lastY = p.y;
    },
    [brushSize, drawStroke, eraseMode, getCanvasPoint, tool]
  );

  const onMaskPointerUp = useCallback(
    (e) => {
      if (tool !== 'erase') return;
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      paintStateRef.current.painting = false;
      try {
        canvas.releasePointerCapture?.(e.pointerId);
      } catch {}
    },
    [tool]
  );

  const exportMaskBlob = useCallback(async () => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const targetW = toNumber(imageMeta?.width, canvas.width);
    const targetH = toNumber(imageMeta?.height, canvas.height);

    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(targetW || canvas.width));
    out.height = Math.max(1, Math.round(targetH || canvas.height));
    const outCtx = out.getContext('2d');
    outCtx?.drawImage(canvas, 0, 0, out.width, out.height);

    const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    if (blob) return blob;

    // Fallback: toBlob can return null in some environments.
    const dataUrl = out.toDataURL('image/png');
    const res = await fetch(dataUrl);
    return await res.blob();
  }, [imageMeta?.height, imageMeta?.width]);

  const runErase = useCallback(async () => {
    if (!imageId) return;
    setError(null);
    setIsRunning(true);
    try {
      const maskBlob = await exportMaskBlob();
      if (!maskBlob) throw new Error('Mask not ready');

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

      const res = await fetch(withStore('/creative-studio/photo-magic/erase', store), {
        method: 'POST',
        body: form
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Erase failed');
      setEraseUrl(data.url || null);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Erase failed');
    } finally {
      setIsRunning(false);
      refreshHealth();
    }
  }, [
    cropMarginPx,
    cropToMask,
    exportMaskBlob,
    imageId,
    maskDilatePx,
    maskFeatherPx,
    maxSide,
    quality,
    refreshHealth,
    sdxlGuidance,
    sdxlSeed,
    sdxlSteps,
    sdxlStrength,
    store
  ]);

  const stageTitle = tool === 'remove_bg' ? 'Background Removal' : 'Magic Eraser';

  return (
    <div className="px-4 py-6">
      <div className="max-w-[1800px] mx-auto">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-xl font-bold text-gray-900">Photo Magic</div>
              <div className="text-sm text-gray-500">RMBG2 Auto + SAM2 Precision + Magic Eraser (LaMa / SDXL)</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={refreshHealth} disabled={isHealthLoading}>
              <RefreshCw className={cn('h-4 w-4', isHealthLoading ? 'animate-spin' : '')} />
              Status
            </Button>
            <Button variant="violet" onClick={onPickFile} disabled={isUploading}>
              <Upload className="h-4 w-4" />
              Upload Image
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[420px_1fr_420px] gap-4 items-start">
          {/* Left panel */}
          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600" />
                System Status
              </div>
              <button
                type="button"
                className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                onClick={() => setShowStatusDetails((v) => !v)}
              >
                {showStatusDetails ? 'Hide' : 'Details'}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill ok={rmbg2Ready} label="RMBG2" title={aiHealthPayload?.errors?.rmbg2 || ''} />
              <StatusPill ok={sam2Ready} label="SAM2" title={aiHealthPayload?.errors?.sam2 || ''} />
              <StatusPill ok={lamaReady} label="LaMa" title={aiHealthPayload?.errors?.lama || ''} />
              <StatusPill ok={Boolean(hqOk)} label="SDXL HQ" title={hqReason || ''} />
            </div>

            {showStatusDetails && (
              <pre className="mt-3 text-[11px] leading-snug rounded-2xl border border-gray-100 bg-gray-50 p-3 overflow-auto max-h-[220px]">
                {JSON.stringify(health ?? null, null, 2)}
              </pre>
            )}

            <div className="mt-4">
              <Label>Tool</Label>
              <div className="mt-2">
                <Toggle
                  value={tool}
                  onChange={(v) => {
                    setTool(v);
                    setError(null);
                    if (v !== 'remove_bg') setPrecisionMode(false);
                  }}
                  options={[
                    { value: 'remove_bg', label: 'Background' },
                    { value: 'erase', label: 'Eraser' }
                  ]}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <Label>Max Side</Label>
                <Input
                  type="number"
                  min={256}
                  max={8192}
                  value={maxSide}
                  onChange={(e) => setMaxSide(clamp(toNumber(e.target.value, 2048), 256, 8192))}
                />
              </div>
              <div>
                <Label>Dilate (px)</Label>
                <Input type="number" min={0} max={64} value={maskDilatePx} onChange={(e) => setMaskDilatePx(clamp(toNumber(e.target.value, 0), 0, 64))} />
              </div>
              <div>
                <Label>Feather (px)</Label>
                <Input type="number" min={0} max={64} value={maskFeatherPx} onChange={(e) => setMaskFeatherPx(clamp(toNumber(e.target.value, 0), 0, 64))} />
              </div>
              <div>
                <Label>Crop Margin</Label>
                <Input type="number" min={0} max={2048} value={cropMarginPx} onChange={(e) => setCropMarginPx(clamp(toNumber(e.target.value, 128), 0, 2048))} />
              </div>
            </div>

            {tool === 'remove_bg' && (
              <div className="mt-4 space-y-2">
                <Button variant="violet" onClick={runRemoveBg} disabled={!imageId || isRunning || !rmbg2Ready}>
                  <Wand2 className="h-4 w-4" />
                  Remove Background (RMBG2)
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => setPrecisionMode((v) => !v)}
                  disabled={!imageId || isRunning || !sam2Ready}
                >
                  <Sparkles className="h-4 w-4" />
                  {precisionMode ? 'Exit Precision' : 'Precision Editor (SAM2)'}
                </Button>

                {precisionMode && (
                  <div className="mt-2 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                    <div className="text-sm font-semibold text-gray-800">Precision Tips</div>
                    <div className="mt-1 text-xs text-gray-600">
                      Click to add <span className="font-semibold text-emerald-700">keep</span> points. Hold{' '}
                      <span className="font-semibold">Alt/Option</span> (or <span className="font-semibold">⌘</span>) to add{' '}
                      <span className="font-semibold text-rose-700">remove</span> points.
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button variant="violet" onClick={runRefine} disabled={!points.length || isRunning}>
                        Apply refine ({points.length})
                      </Button>
                      <Button variant="secondary" onClick={() => setPoints([])} disabled={!points.length || isRunning}>
                        Clear points
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tool === 'erase' && (
              <div className="mt-4 space-y-3">
                <div>
                  <Label>Quality</Label>
                  <div className="mt-2">
                    <Toggle
                      value={quality}
                      onChange={(v) => setQuality(v)}
                      options={[
                        { value: 'standard', label: 'Standard', title: 'LaMa (fast)' },
                        { value: 'hq', label: 'High Quality', disabled: hqOption.disabled, title: hqOption.title }
                      ]}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Brush</Label>
                    <Input type="number" min={4} max={256} value={brushSize} onChange={(e) => setBrushSize(clamp(toNumber(e.target.value, 32), 4, 256))} />
                  </div>
                  <div>
                    <Label>Mode</Label>
                    <Toggle value={eraseMode} onChange={setEraseMode} options={[{ value: 'paint', label: 'Paint' }, { value: 'erase', label: 'Erase' }]} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={undoMask} disabled={isRunning}>
                    Undo
                  </Button>
                  <Button variant="secondary" onClick={clearMask} disabled={isRunning}>
                    Clear
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Label>Crop to mask</Label>
                  <button
                    type="button"
                    onClick={() => setCropToMask((v) => !v)}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold',
                      cropToMask ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-700'
                    )}
                  >
                    {cropToMask ? 'On' : 'Off'}
                  </button>
                </div>

                {quality === 'hq' && (
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                    <div className="text-sm font-semibold text-gray-800">SDXL knobs</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Steps</Label>
                        <Input type="number" min={5} max={80} value={sdxlSteps} onChange={(e) => setSdxlSteps(clamp(toNumber(e.target.value, 20), 5, 80))} />
                      </div>
                      <div>
                        <Label>Guidance</Label>
                        <Input type="number" min={0} max={20} step="0.1" value={sdxlGuidance} onChange={(e) => setSdxlGuidance(clamp(toNumber(e.target.value, 8.0), 0, 20))} />
                      </div>
                      <div>
                        <Label>Strength</Label>
                        <Input type="number" min={0} max={1} step="0.01" value={sdxlStrength} onChange={(e) => setSdxlStrength(clamp(toNumber(e.target.value, 0.99), 0, 1))} />
                      </div>
                      <div>
                        <Label>Seed</Label>
                        <Input type="number" min={0} max={2147483647} value={sdxlSeed} onChange={(e) => setSdxlSeed(clamp(toNumber(e.target.value, 0), 0, 2147483647))} />
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  variant="violet"
                  onClick={runErase}
                  disabled={!imageId || isRunning || (quality === 'hq' ? hqOption.disabled : !lamaReady)}
                >
                  <Eraser className="h-4 w-4" />
                  Erase
                </Button>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <div>{error}</div>
              </div>
            )}
          </div>

          {/* Stage */}
          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
                {tool === 'remove_bg' ? <Sparkles className="h-4 w-4 text-violet-600" /> : <Paintbrush className="h-4 w-4 text-violet-600" />}
                {stageTitle}
              </div>
              {precisionMode && tool === 'remove_bg' && <div className="text-xs font-semibold text-gray-500">Precision mode: click to add points</div>}
            </div>

            <div className="mt-4 flex justify-center">
              {!imageSrc ? (
                <div className="w-full rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                  <div className="text-sm font-semibold text-gray-700">Upload an image to start</div>
                  <div className="text-xs text-gray-500 mt-1">Background removal and eraser will appear here.</div>
                  <div className="mt-4 flex justify-center">
                    <Button variant="violet" onClick={onPickFile} disabled={isUploading}>
                      <Upload className="h-4 w-4" />
                      Upload Image
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="relative inline-block select-none" onClick={addPointFromEvent}>
                  <img
                    ref={imgRef}
                    src={imageSrc}
                    alt="Uploaded"
                    className="max-h-[720px] max-w-full rounded-2xl shadow-sm"
                    onLoad={() => {
                      ensureMaskCanvasSize();
                    }}
                  />

                  {tool === 'remove_bg' && maskUrl && (
                    <img src={maskUrl} alt="Mask" className="absolute inset-0 w-full h-full opacity-35 mix-blend-multiply pointer-events-none rounded-2xl" />
                  )}

                  {tool === 'remove_bg' &&
                    precisionMode &&
                    points.map((p, idx) => (
                      <div
                        key={`${idx}-${p.label}`}
                        className={cn(
                          'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                          p.label ? 'bg-emerald-500/90 border-white' : 'bg-rose-500/90 border-white'
                        )}
                        style={{ left: `${p.x_norm * 100}%`, top: `${p.y_norm * 100}%`, width: 10, height: 10 }}
                        title={p.label ? 'keep' : 'remove'}
                      />
                    ))}

                  {tool === 'erase' && (
                    <canvas
                      ref={maskCanvasRef}
                      className="absolute inset-0 w-full h-full rounded-2xl"
                      style={{ cursor: 'crosshair' }}
                      onPointerDown={onMaskPointerDown}
                      onPointerMove={onMaskPointerMove}
                      onPointerUp={onMaskPointerUp}
                      onPointerCancel={onMaskPointerUp}
                    />
                  )}
                </div>
              )}
            </div>

            {tool === 'erase' && imageSrc && (
              <div className="mt-3 text-xs text-gray-500">
                Paint a mask over the object to remove. Use <span className="font-semibold">Mode</span> to erase strokes.
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm p-4">
            <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Download className="h-4 w-4 text-violet-600" />
              Outputs
            </div>

            <div className="mt-4 space-y-4">
              {tool === 'remove_bg' && (
                <>
                  <div>
                    <Label>Cutout preview</Label>
                    <div className="mt-2 rounded-2xl border border-gray-100 overflow-hidden" style={makeCheckerBg()}>
                      {cutoutUrl ? <img src={cutoutUrl} alt="Cutout" className="w-full h-auto block" /> : <div className="p-8 text-center text-sm text-gray-500">Run RMBG2 or SAM2 refine to preview.</div>}
                    </div>
                    {cutoutUrl && (
                      <div className="mt-2">
                        <a className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 hover:text-violet-800" href={cutoutUrl} target="_blank" rel="noreferrer">
                          <Download className="h-4 w-4" />
                          Download cutout
                        </a>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label>Mask</Label>
                    <div className="mt-2 rounded-2xl border border-gray-100 overflow-hidden bg-gray-50">
                      {maskUrl ? <img src={maskUrl} alt="Mask" className="w-full h-auto block" /> : <div className="p-8 text-center text-sm text-gray-500">Mask appears after background removal.</div>}
                    </div>
                    {maskUrl && (
                      <div className="mt-2">
                        <a className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 hover:text-violet-800" href={maskUrl} target="_blank" rel="noreferrer">
                          <Download className="h-4 w-4" />
                          Download mask
                        </a>
                      </div>
                    )}
                  </div>
                </>
              )}

              {tool === 'erase' && (
                <div>
                  <Label>Result</Label>
                  <div className="mt-2 rounded-2xl border border-gray-100 overflow-hidden bg-gray-50">
                    {eraseUrl ? <img src={eraseUrl} alt="Erase result" className="w-full h-auto block" /> : <div className="p-8 text-center text-sm text-gray-500">Paint a mask, then click Erase.</div>}
                  </div>
                  {eraseUrl && (
                    <div className="mt-2">
                      <a className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 hover:text-violet-800" href={eraseUrl} target="_blank" rel="noreferrer">
                        <Download className="h-4 w-4" />
                        Download result
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
