import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  XCircle
} from 'lucide-react';

const API_BASE = '/api';
const withStore = (path, store) => `${API_BASE}${path}${path.includes('?') ? '&' : '?'}store=${encodeURIComponent(store ?? 'vironax')}`;

const cn = (...classes) => classes.filter(Boolean).join(' ');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const makeId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isTypingTarget = (target) => {
  const el = target;
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
};

const formatTime = (seconds) => {
  const total = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

function Select({ className, children, ...props }) {
  return (
    <select
      className={cn(
        'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none',
        'focus:border-violet-400 focus:ring-4 focus:ring-violet-100',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export default function VideoOverlayEditor({ store }) {
  const [health, setHealth] = useState(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);

  const [videoSrc, setVideoSrc] = useState(null);
  const [videoId, setVideoId] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null); // {duration,width,height}

  const [segments, setSegments] = useState([]); // [{id,start,end,label,overlays:[]}]
  const [selectedSegmentId, setSelectedSegmentId] = useState(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(null);
  const [scanConfig, setScanConfig] = useState({ intervalSec: 1, maxFrames: 30 });

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const overlayLayerRef = useRef(null);
  const [overlayLayerSize, setOverlayLayerSize] = useState({ w: 0, h: 0 });

  const interactionRef = useRef(null);
  const [isInteracting, setIsInteracting] = useState(false);

  // Clean up blob URLs (avoid memory leaks).
  useEffect(() => {
    const objectUrl = videoSrc;
    return () => {
      if (objectUrl && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [videoSrc]);

  const refreshHealth = useCallback(async () => {
    setIsHealthLoading(true);
    try {
      const res = await fetch(withStore('/creative-studio/video-overlay/health', store));
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

  // Keep overlay alignment correct when the <video> is scaled.
  useEffect(() => {
    if (!overlayLayerRef.current) return;
    const el = overlayLayerRef.current;
    const ro = new ResizeObserver((entries) => {
      const rect = entries?.[0]?.contentRect;
      if (!rect) return;
      setOverlayLayerSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Video events.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const sync = () => {
      setCurrentTime(v.currentTime || 0);
      setDuration(v.duration || 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    v.addEventListener('loadedmetadata', sync);
    v.addEventListener('durationchange', sync);
    v.addEventListener('timeupdate', sync);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('loadedmetadata', sync);
      v.removeEventListener('durationchange', sync);
      v.removeEventListener('timeupdate', sync);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [videoSrc]);

  // Keyboard shortcuts (when not typing): Space play/pause, ←/→ nudge 0.2s.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      if (!videoRef.current) return;
      if (e.code === 'Space') {
        e.preventDefault();
        const v = videoRef.current;
        if (v.paused) v.play();
        else v.pause();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        videoRef.current.currentTime = clamp((videoRef.current.currentTime || 0) - 0.2, 0, videoRef.current.duration || 999999);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        videoRef.current.currentTime = clamp((videoRef.current.currentTime || 0) + 0.2, 0, videoRef.current.duration || 999999);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const naturalSize = useMemo(() => {
    const w = videoRef.current?.videoWidth || videoInfo?.width || 0;
    const h = videoRef.current?.videoHeight || videoInfo?.height || 0;
    return { w, h };
  }, [videoInfo, videoSrc, duration]);

  const scale = useMemo(() => {
    if (!naturalSize.w || !naturalSize.h || !overlayLayerSize.w || !overlayLayerSize.h) return { x: 1, y: 1 };
    return { x: overlayLayerSize.w / naturalSize.w, y: overlayLayerSize.h / naturalSize.h };
  }, [naturalSize.w, naturalSize.h, overlayLayerSize.w, overlayLayerSize.h]);

  const activeOverlays = useMemo(() => {
    const active = [];
    for (const seg of segments) {
      if (currentTime >= seg.start && currentTime < seg.end) {
        for (const ov of seg.overlays || []) {
          active.push({ ...ov, _segmentId: seg.id, _segmentStart: seg.start, _segmentEnd: seg.end });
        }
      }
    }
    return active;
  }, [segments, currentTime]);

  const selectedSegment = useMemo(
    () => segments.find((s) => s.id === selectedSegmentId) || null,
    [segments, selectedSegmentId]
  );

  const selectedOverlay = useMemo(() => {
    if (!selectedSegment) return null;
    return (selectedSegment.overlays || []).find((o) => o.id === selectedOverlayId) || null;
  }, [selectedSegment, selectedOverlayId]);

  const selectedGradientDirection = selectedOverlay?.gradient?.direction === 'horizontal' ? 'horizontal' : 'vertical';
  const selectedGradientFromHex = selectedOverlay?.gradient?.from?.hex || selectedOverlay?.backgroundColor || '#333333';
  const selectedGradientToHex = selectedOverlay?.gradient?.to?.hex || selectedOverlay?.backgroundColor || '#111111';

  const segmentForTime = useMemo(() => {
    return segments.find((seg) => currentTime >= seg.start && currentTime < seg.end) || null;
  }, [segments, currentTime]);

  const updateOverlay = useCallback((segmentId, overlayId, patch) => {
    const shouldClampGeometry = Boolean(patch) && (
      Object.prototype.hasOwnProperty.call(patch, 'x') ||
      Object.prototype.hasOwnProperty.call(patch, 'y') ||
      Object.prototype.hasOwnProperty.call(patch, 'width') ||
      Object.prototype.hasOwnProperty.call(patch, 'height')
    );

    setSegments((prev) => prev.map((seg) => {
      if (seg.id !== segmentId) return seg;
      const overlays = (seg.overlays || []).map((ov) => {
        if (ov.id !== overlayId) return ov;
        const next = { ...ov, ...patch };
        if (!shouldClampGeometry) return next;

        const minSize = 10;
        const maxW = naturalSize.w || 0;
        const maxH = naturalSize.h || 0;

        let width = Math.max(minSize, toNumber(next.width, toNumber(ov.width, minSize)));
        let height = Math.max(minSize, toNumber(next.height, toNumber(ov.height, minSize)));
        let x = toNumber(next.x, toNumber(ov.x, 0));
        let y = toNumber(next.y, toNumber(ov.y, 0));

        if (maxW > 0 && maxH > 0) {
          width = clamp(width, minSize, maxW);
          height = clamp(height, minSize, maxH);
          x = clamp(x, 0, Math.max(0, maxW - width));
          y = clamp(y, 0, Math.max(0, maxH - height));
          width = clamp(width, minSize, Math.max(minSize, maxW - x));
          height = clamp(height, minSize, Math.max(minSize, maxH - y));
        } else {
          x = Math.max(0, x);
          y = Math.max(0, y);
        }

        return {
          ...next,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height)
        };
      });
      return { ...seg, overlays };
    }));
  }, [naturalSize.w, naturalSize.h]);

  const updateSegment = useCallback((segmentId, patch) => {
    const hasStart = Boolean(patch) && Object.prototype.hasOwnProperty.call(patch, 'start');
    const hasEnd = Boolean(patch) && Object.prototype.hasOwnProperty.call(patch, 'end');
    const maxT = (duration || videoInfo?.duration) ? (duration || videoInfo?.duration) : Number.POSITIVE_INFINITY;

    setSegments((prev) => prev.map((seg) => {
      if (seg.id !== segmentId) return seg;

      if (!hasStart && !hasEnd) {
        return { ...seg, ...patch };
      }

      let start = hasStart ? toNumber(patch.start, toNumber(seg.start, 0)) : toNumber(seg.start, 0);
      let end = hasEnd ? toNumber(patch.end, toNumber(seg.end, start)) : toNumber(seg.end, start);

      start = clamp(start, 0, maxT);
      end = clamp(end, 0, maxT);

      if (start > end) {
        if (hasStart && !hasEnd) end = start;
        else start = end;
      }

      return { ...seg, ...patch, start, end };
    }));
  }, [duration, videoInfo?.duration]);

  const selectSegment = useCallback((seg) => {
    if (!seg) return;
    setSelectedSegmentId(seg.id);
    setSelectedOverlayId(seg.overlays?.[0]?.id || null);
    if (videoRef.current) {
      videoRef.current.currentTime = clamp(seg.start || 0, 0, videoRef.current.duration || 999999);
    }
  }, []);

  const addOverlayToSelectedSegment = useCallback(() => {
    if (!selectedSegmentId) return;

    const baseW = naturalSize.w || videoInfo?.width || 0;
    const baseH = naturalSize.h || videoInfo?.height || 0;

    const width = Math.round(Math.min(420, baseW || 420));
    const height = Math.round(Math.min(140, baseH || 140));
    const x = Math.round(baseW ? clamp((baseW - width) / 2, 0, Math.max(0, baseW - width)) : 0);
    const y = Math.round(baseH ? clamp((baseH - height) / 2, 0, Math.max(0, baseH - height)) : 0);

    const overlayId = makeId();
    const newOverlay = {
      id: overlayId,
      x,
      y,
      width,
      height,
      text: 'New overlay',
      backgroundColor: '#333333',
      textColor: '#ffffff',
      fontSize: 28,
      fontWeight: 'bold',
      fontStyle: 'normal',
      fontFamily: 'Inter',
      isGradient: false,
      gradient: null,
      confidence: 1
    };

    setSegments((prev) => prev.map((seg) => {
      if (seg.id !== selectedSegmentId) return seg;
      return { ...seg, overlays: [...(seg.overlays || []), newOverlay] };
    }));
    setSelectedOverlayId(overlayId);
  }, [naturalSize.h, naturalSize.w, selectedSegmentId, videoInfo?.height, videoInfo?.width]);

  const duplicateSelectedOverlay = useCallback(() => {
    if (!selectedSegmentId || !selectedOverlay) return;

    const baseW = naturalSize.w || videoInfo?.width || 0;
    const baseH = naturalSize.h || videoInfo?.height || 0;

    const overlayId = makeId();
    const w = Math.max(10, toNumber(selectedOverlay.width, 10));
    const h = Math.max(10, toNumber(selectedOverlay.height, 10));
    let x = toNumber(selectedOverlay.x, 0) + 12;
    let y = toNumber(selectedOverlay.y, 0) + 12;

    if (baseW) x = clamp(x, 0, Math.max(0, baseW - w));
    else x = Math.max(0, x);
    if (baseH) y = clamp(y, 0, Math.max(0, baseH - h));
    else y = Math.max(0, y);

    const cloned = {
      ...selectedOverlay,
      id: overlayId,
      x: Math.round(x),
      y: Math.round(y),
      confidence: 1
    };

    setSegments((prev) => prev.map((seg) => {
      if (seg.id !== selectedSegmentId) return seg;
      return { ...seg, overlays: [...(seg.overlays || []), cloned] };
    }));
    setSelectedOverlayId(overlayId);
  }, [naturalSize.h, naturalSize.w, selectedOverlay, selectedSegmentId, videoInfo?.height, videoInfo?.width]);

  const deleteSelectedOverlay = useCallback(() => {
    if (!selectedSegmentId || !selectedOverlayId) return;

    let nextId = null;
    setSegments((prev) => prev.map((seg) => {
      if (seg.id !== selectedSegmentId) return seg;
      const overlays = (seg.overlays || []).filter((ov) => ov.id !== selectedOverlayId);
      nextId = overlays[0]?.id || null;
      return { ...seg, overlays };
    }));
    setSelectedOverlayId(nextId);
  }, [selectedOverlayId, selectedSegmentId]);

  const handleVideoUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsUploading(true);
    setSegments([]);
    setSelectedSegmentId(null);
    setSelectedOverlayId(null);

    const localUrl = URL.createObjectURL(file);
    setVideoSrc(localUrl);

    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch(withStore('/creative-studio/video-overlay/upload', store), {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Upload failed');

      setVideoId(data.video_id);
      setVideoInfo({ duration: data.duration || null, width: data.width || null, height: data.height || null });
      refreshHealth();
    } catch (e) {
      console.error(e);
      setVideoId(null);
      setVideoInfo(null);
      setError(e?.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const runScan = async () => {
    if (!videoId) return;
    setError(null);
    setIsScanning(true);
    try {
      const res = await fetch(withStore('/creative-studio/video-overlay/scan', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          interval_sec: scanConfig.intervalSec,
          max_frames: scanConfig.maxFrames,
          use_gemini: true
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Scan failed');

      const segs = Array.isArray(data.segments) ? data.segments : [];
      setSegments(segs);
      if (segs[0]) selectSegment(segs[0]);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const exportVideo = async () => {
    if (!videoId || !segments.length) return;
    setError(null);
    setIsExporting(true);
    try {
      const res = await fetch(withStore('/creative-studio/video-overlay/export', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          filename: 'overlay_edit.mp4',
          segments: segments.map((seg) => ({
            id: seg.id,
            start: seg.start,
            end: seg.end,
            overlays: (seg.overlays || []).map((ov) => ({
              ...ov,
              startTime: undefined,
              endTime: undefined
            }))
          }))
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Export failed');

      const url = data.url;
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.download = 'overlay_edit.mp4';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (e) {
      console.error(e);
      setError(e?.message || 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const beginInteraction = useCallback((e, overlay, mode, handle = null) => {
    if (!overlay?._segmentId || !overlay?.id) return;
    if (!naturalSize.w || !naturalSize.h) return;

    setSelectedSegmentId(overlay._segmentId);
    setSelectedOverlayId(overlay.id);

    interactionRef.current = {
      mode,
      handle,
      segmentId: overlay._segmentId,
      overlayId: overlay.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: {
        x: toNumber(overlay.x, 0),
        y: toNumber(overlay.y, 0),
        width: Math.max(1, toNumber(overlay.width, 1)),
        height: Math.max(1, toNumber(overlay.height, 1))
      }
    };

    setIsInteracting(true);
    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch {}
  }, [naturalSize.w, naturalSize.h]);

  useEffect(() => {
    if (!isInteracting) return;
    const onMove = (e) => {
      const state = interactionRef.current;
      if (!state) return;
      const { segmentId, overlayId, startClientX, startClientY, startBox, mode, handle } = state;

      const dx = (e.clientX - startClientX) / (scale.x || 1);
      const dy = (e.clientY - startClientY) / (scale.y || 1);

      const minSize = 10;
      const maxW = naturalSize.w || 999999;
      const maxH = naturalSize.h || 999999;

      let x = startBox.x;
      let y = startBox.y;
      let w = startBox.width;
      let h = startBox.height;

      if (mode === 'move') {
        x = startBox.x + dx;
        y = startBox.y + dy;
      } else if (mode === 'resize') {
        const wantsLeft = handle?.includes('w');
        const wantsRight = handle?.includes('e');
        const wantsTop = handle?.includes('n');
        const wantsBottom = handle?.includes('s');

        if (wantsLeft) {
          x = startBox.x + dx;
          w = startBox.width - dx;
        }
        if (wantsRight) {
          w = startBox.width + dx;
        }
        if (wantsTop) {
          y = startBox.y + dy;
          h = startBox.height - dy;
        }
        if (wantsBottom) {
          h = startBox.height + dy;
        }
      }

      w = Math.max(minSize, w);
      h = Math.max(minSize, h);

      x = clamp(x, 0, Math.max(0, maxW - w));
      y = clamp(y, 0, Math.max(0, maxH - h));
      w = clamp(w, minSize, Math.max(minSize, maxW - x));
      h = clamp(h, minSize, Math.max(minSize, maxH - y));

      updateOverlay(segmentId, overlayId, {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(w),
        height: Math.round(h)
      });
    };

    const onUp = () => {
      interactionRef.current = null;
      setIsInteracting(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isInteracting, naturalSize.w, naturalSize.h, scale.x, scale.y, updateOverlay]);

  const overlayAiOk = Boolean(health?.overlay_ai?.health?.ok);
  const overlayAiConfigured = Boolean(health?.overlay_ai?.configured);
  const geminiConfigured = Boolean(health?.gemini?.configured);

  const canScan = Boolean(videoId) && !isUploading && !isScanning;
  const canExport = Boolean(videoId) && segments.length > 0 && !isUploading && !isScanning && !isExporting;

  const disableScanReason = !videoId
    ? 'Upload a video first.'
    : !overlayAiConfigured
      ? 'Configure VIDEO_OVERLAY_AI_URL on the Node server.'
      : !overlayAiOk
        ? 'Detector service is not ready (DINO + SAM2 must be loaded).'
        : !geminiConfigured
          ? 'Configure GEMINI_API_KEY on the Node server.'
          : null;

  const disableExportReason = !videoId
    ? 'Upload a video first.'
    : !segments.length
      ? 'Run Auto-Scan first.'
      : null;

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-600 flex items-center justify-center shadow-sm">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-semibold text-gray-900">Overlay Editor</div>
            <div className="text-sm text-gray-500">
              Upload → Auto-Scan → Fine-tune → Export
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            ok={overlayAiOk}
            label={overlayAiOk ? 'Detector ready' : 'Detector not ready'}
            title={health?.overlay_ai?.health?.payload?.errors ? JSON.stringify(health.overlay_ai.health.payload.errors) : undefined}
          />
          <StatusPill ok={geminiConfigured} label={geminiConfigured ? 'Gemini ready' : 'Gemini missing'} />
          <Button
            variant="secondary"
            className="pl-3"
            disabled={isHealthLoading}
            onClick={refreshHealth}
          >
            {isHealthLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
            Status
          </Button>
        </div>
      </div>

      {/* Error */}
      {error ? (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">Action required</div>
            <div className="mt-0.5">{error}</div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr_420px] gap-6">
        {/* Left */}
        <div className="space-y-6">
          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-gray-900">Project</div>
                <div className="mt-1 text-xs text-gray-500">Burnt-in overlays → editable overlays.</div>
              </div>
              {videoInfo?.duration ? (
                <div className="text-xs font-medium text-gray-500">{formatTime(videoInfo.duration)}</div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleVideoUpload}
                className="hidden"
              />
              <Button
                variant="primary"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {videoSrc ? 'Replace video' : 'Upload video'}
              </Button>

              <Button
                variant="secondary"
                disabled={!canScan || Boolean(disableScanReason)}
                onClick={runScan}
                title={disableScanReason || 'Auto-scan the full video'}
              >
                {isScanning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                {isScanning ? 'Scanning…' : 'Auto-Scan segments'}
              </Button>

              <Button
                variant="violet"
                disabled={!canExport || Boolean(disableExportReason)}
                onClick={exportVideo}
                title={disableExportReason || 'Export MP4 with overlays burned in'}
              >
                {isExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isExporting ? 'Exporting…' : 'Export MP4'}
              </Button>
            </div>

            <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-gray-700">Scan settings</div>
                <div className="text-[11px] text-gray-400">Advanced</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <Label>Interval (s)</Label>
                  <div className="mt-2">
                    <Input
                      type="number"
                      min="0.25"
                      max="10"
                      step="0.25"
                      value={scanConfig.intervalSec}
                      onChange={(e) => setScanConfig((p) => ({ ...p, intervalSec: toNumber(e.target.value, 1) }))}
                    />
                  </div>
                </div>
                <div>
                  <Label>Max frames</Label>
                  <div className="mt-2">
                    <Input
                      type="number"
                      min="5"
                      max="120"
                      step="1"
                      value={scanConfig.maxFrames}
                      onChange={(e) => setScanConfig((p) => ({ ...p, maxFrames: Math.round(toNumber(e.target.value, 30)) }))}
                    />
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                  <span className="text-gray-700 font-medium">Gemini scan</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Required
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Segments</div>
              <div className="text-xs text-gray-400">{segments.length ? `${segments.length} detected` : '—'}</div>
            </div>
            <div className="mt-4">
              {segments.length ? (
                <div className="space-y-2">
                  {segments.map((seg) => (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => selectSegment(seg)}
                      className={cn(
                        'w-full rounded-2xl border px-4 py-3 text-left transition',
                        selectedSegmentId === seg.id
                          ? 'border-violet-200 bg-violet-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold text-gray-900">{formatTime(seg.start)}–{formatTime(seg.end)}</div>
                        <div className="text-xs text-gray-400">{seg.overlays?.length ? `${seg.overlays.length} overlay` : '0'}</div>
                      </div>
                      {seg.label ? <div className="mt-1 text-xs text-gray-500 truncate">{seg.label}</div> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  No segments yet. Upload a video, then run Auto-Scan.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center */}
        <div className="rounded-3xl border border-gray-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-semibold text-gray-900">Stage</div>
            <div className="text-xs text-gray-500">
              <span className="font-medium">{formatTime(currentTime)}</span>
              <span className="mx-1 text-gray-300">/</span>
              <span>{formatTime(duration || videoInfo?.duration || 0)}</span>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 flex items-center justify-center min-h-[520px]">
            {videoSrc ? (
              <div className="relative inline-block">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="max-w-full max-h-[600px] rounded-2xl shadow bg-black"
                  controls={false}
                />

                <div ref={overlayLayerRef} className="absolute inset-0">
                  {activeOverlays.map((ov) => {
                    const isSelected = ov.id === selectedOverlayId && ov._segmentId === selectedSegmentId;
                    const left = (ov.x || 0) * scale.x;
                    const top = (ov.y || 0) * scale.y;
                    const width = (ov.width || 0) * scale.x;
                    const height = (ov.height || 0) * scale.y;

                    const background = ov.isGradient && ov.gradient
                      ? `linear-gradient(${ov.gradient.direction === 'vertical' ? 'to bottom' : 'to right'}, ${ov.gradient.from.hex}, ${ov.gradient.to.hex})`
                      : ov.backgroundColor;

                    return (
                      <div
                        key={`${ov._segmentId}:${ov.id}`}
                        className={cn(
                          'absolute rounded-xl select-none cursor-move',
                          isSelected ? 'ring-2 ring-violet-500 shadow-sm' : 'ring-1 ring-transparent hover:ring-white/60'
                        )}
                        style={{ left, top, width, height }}
                        title={`Segment ${formatTime(ov._segmentStart)}–${formatTime(ov._segmentEnd)}`}
                        onPointerDown={(e) => beginInteraction(e, ov, 'move')}
                      >
                        <div className="absolute inset-0 rounded-xl overflow-hidden">
                          <div className="absolute inset-0" style={{ background }} />
                          <div className="relative w-full h-full flex items-center justify-center px-2">
                            <span
                              style={{
                                color: ov.textColor || '#fff',
                                fontFamily: ov.fontFamily || 'Inter, system-ui, -apple-system',
                                fontSize: ov.fontSize ? `${ov.fontSize}px` : undefined,
                                fontWeight: ov.fontWeight || 'normal',
                                fontStyle: ov.fontStyle || 'normal'
                              }}
                              className="truncate"
                            >
                              {ov.text || ''}
                            </span>
                          </div>
                        </div>

                        {isSelected ? (
                          <div className="absolute inset-0">
                            {[
                              { key: 'nw', left: -6, top: -6, cursor: 'nwse-resize' },
                              { key: 'n', left: '50%', top: -6, cursor: 'ns-resize', transform: 'translateX(-50%)' },
                              { key: 'ne', right: -6, top: -6, cursor: 'nesw-resize' },
                              { key: 'e', right: -6, top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' },
                              { key: 'se', right: -6, bottom: -6, cursor: 'nwse-resize' },
                              { key: 's', left: '50%', bottom: -6, cursor: 'ns-resize', transform: 'translateX(-50%)' },
                              { key: 'sw', left: -6, bottom: -6, cursor: 'nesw-resize' },
                              { key: 'w', left: -6, top: '50%', cursor: 'ew-resize', transform: 'translateY(-50%)' }
                            ].map((h) => (
                              <div
                                key={h.key}
                                className="absolute h-3.5 w-3.5 rounded-full bg-white shadow ring-1 ring-gray-300"
                                style={{
                                  left: h.left,
                                  right: h.right,
                                  top: h.top,
                                  bottom: h.bottom,
                                  cursor: h.cursor,
                                  transform: h.transform
                                }}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  beginInteraction(e, ov, 'resize', h.key);
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="mx-auto h-12 w-12 rounded-2xl bg-white border border-gray-200 flex items-center justify-center shadow-sm">
                  <Upload className="h-5 w-5 text-gray-500" />
                </div>
                <div className="mt-3 text-sm font-semibold text-gray-900">Upload a video</div>
                <div className="mt-1 text-sm text-gray-500">Then auto-scan segments and edit overlays.</div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  className="px-3"
                  disabled={!videoSrc}
                  onClick={() => {
                    const v = videoRef.current;
                    if (!v) return;
                    if (v.paused) v.play();
                    else v.pause();
                  }}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {isPlaying ? 'Pause' : 'Play'}
                </Button>
                {segmentForTime ? (
                  <div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
                    <div className="h-2 w-2 rounded-full bg-violet-600" />
                    <span className="font-medium text-gray-700">Segment</span>
                    <span>{formatTime(segmentForTime.start)}–{formatTime(segmentForTime.end)}</span>
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">Space</span> play/pause • <span className="font-medium text-gray-700">←/→</span> nudge
              </div>
            </div>

            <div className="mt-4">
              <div className="relative">
                <div className="h-2 rounded-full bg-gray-100 border border-gray-200 overflow-hidden">
                  {duration > 0 ? (
                    <>
                      {segments.map((seg) => {
                        const left = (seg.start / duration) * 100;
                        const width = ((seg.end - seg.start) / duration) * 100;
                        const selected = seg.id === selectedSegmentId;
                        return (
                          <div
                            key={seg.id}
                            className={cn('absolute top-0 h-full rounded-full', selected ? 'bg-violet-500/70' : 'bg-violet-400/35')}
                            style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%` }}
                          />
                        );
                      })}
                      <div className="absolute top-0 h-full w-0.5 bg-gray-900/70" style={{ left: `${(currentTime / duration) * 100}%` }} />
                    </>
                  ) : null}
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, duration || videoInfo?.duration || 0)}
                  step={0.01}
                  value={currentTime}
                  onChange={(e) => {
                    const v = videoRef.current;
                    if (!v) return;
                    v.currentTime = clamp(toNumber(e.target.value, 0), 0, v.duration || 999999);
                  }}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer"
                  disabled={!videoSrc}
                  aria-label="Seek"
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                <span>00:00</span>
                <span>{formatTime(duration || videoInfo?.duration || 0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="rounded-3xl border border-gray-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Inspector</div>
            {selectedOverlay?.confidence ? (
              <div className="text-xs text-gray-400">Confidence {Math.round(selectedOverlay.confidence * 100)}%</div>
            ) : null}
          </div>

          <div className="mt-4 space-y-6">
            {selectedSegment ? (
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs font-semibold text-gray-700">Segment</div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <Label>Start (s)</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        value={Number(selectedSegment.start || 0).toFixed(2)}
                        onChange={(e) => updateSegment(selectedSegment.id, { start: toNumber(e.target.value, 0) })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>End (s)</Label>
                    <div className="mt-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.1"
                        value={Number(selectedSegment.end || 0).toFixed(2)}
                        onChange={(e) => updateSegment(selectedSegment.id, { end: toNumber(e.target.value, 0) })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                Select a segment to edit its overlays.
              </div>
            )}

            {selectedSegment ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label>Overlays</Label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={addOverlayToSelectedSegment}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!selectedSegmentId}
                      title="Add a new overlay to this segment"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={duplicateSelectedOverlay}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!selectedOverlay}
                      title="Duplicate selected overlay"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelectedOverlay}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!selectedOverlay}
                      title="Delete selected overlay"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {selectedSegment.overlays?.length ? (
                    selectedSegment.overlays.map((ov, idx) => (
                      (() => {
                        const swatch = ov?.isGradient && ov?.gradient?.from?.hex && ov?.gradient?.to?.hex
                          ? `linear-gradient(${ov.gradient.direction === 'vertical' ? 'to bottom' : 'to right'}, ${ov.gradient.from.hex}, ${ov.gradient.to.hex})`
                          : (ov?.backgroundColor || '#333333');

                        return (
                      <button
                        key={ov.id}
                        type="button"
                        onClick={() => setSelectedOverlayId(ov.id)}
                        className={cn(
                          'w-full rounded-2xl border px-4 py-3 text-left transition',
                          selectedOverlayId === ov.id ? 'border-violet-200 bg-violet-50' : 'border-gray-200 hover:bg-gray-50'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <div className="h-3 w-3 rounded-full border border-gray-200" style={{ background: swatch }} />
                            <div className="font-semibold text-gray-900">Overlay {idx + 1}</div>
                          </div>
                          <div className="text-xs text-gray-400">{Math.round(toNumber(ov.width, 0))}×{Math.round(toNumber(ov.height, 0))}</div>
                        </div>
                        <div className="mt-1 text-xs text-gray-500 truncate">{ov.text || '—'}</div>
                      </button>
                        );
                      })()
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                      No overlays detected in this segment.
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {selectedSegment && selectedOverlay ? (
              <div className="space-y-6">
                <div className="rounded-2xl border border-gray-200 p-4">
                  <div className="text-xs font-semibold text-gray-700">Content</div>
                  <div className="mt-3">
                    <Label>Text</Label>
                    <div className="mt-2">
                      <Input
                        type="text"
                        value={selectedOverlay.text || ''}
                        onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { text: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 p-4">
                  <div className="text-xs font-semibold text-gray-700">Appearance</div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <Label>Background type</Label>
                      <div className="mt-2 inline-flex w-full items-center rounded-xl border border-gray-200 bg-white p-1">
                        <button
                          type="button"
                          className={cn(
                            'flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition',
                            !selectedOverlay.isGradient ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                          )}
                          onClick={() => updateOverlay(selectedSegment.id, selectedOverlay.id, { isGradient: false, gradient: null })}
                        >
                          Solid
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition',
                            selectedOverlay.isGradient ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                          )}
                          onClick={() => updateOverlay(selectedSegment.id, selectedOverlay.id, {
                            isGradient: true,
                            gradient: {
                              direction: selectedGradientDirection,
                              from: { ...(selectedOverlay.gradient?.from || {}), hex: selectedGradientFromHex },
                              to: { ...(selectedOverlay.gradient?.to || {}), hex: selectedGradientToHex }
                            }
                          })}
                        >
                          Gradient
                        </button>
                      </div>
                    </div>

                    {selectedOverlay.isGradient ? (
                      <>
                        <div>
                          <Label>Direction</Label>
                          <div className="mt-2">
                            <Select
                              value={selectedGradientDirection}
                              onChange={(e) => {
                                const dir = e.target.value === 'horizontal' ? 'horizontal' : 'vertical';
                                updateOverlay(selectedSegment.id, selectedOverlay.id, {
                                  isGradient: true,
                                  gradient: {
                                    direction: dir,
                                    from: { ...(selectedOverlay.gradient?.from || {}), hex: selectedGradientFromHex },
                                    to: { ...(selectedOverlay.gradient?.to || {}), hex: selectedGradientToHex }
                                  }
                                });
                              }}
                            >
                              <option value="vertical">Vertical</option>
                              <option value="horizontal">Horizontal</option>
                            </Select>
                          </div>
                        </div>

                        <div>
                          <Label>Text color</Label>
                          <div className="mt-2">
                            <input
                              type="color"
                              value={selectedOverlay.textColor || '#ffffff'}
                              onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { textColor: e.target.value })}
                              className="w-full h-10 rounded-xl border border-gray-200 bg-white"
                            />
                          </div>
                        </div>

                        <div>
                          <Label>From</Label>
                          <div className="mt-2">
                            <input
                              type="color"
                              value={selectedGradientFromHex}
                              onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, {
                                isGradient: true,
                                gradient: {
                                  direction: selectedGradientDirection,
                                  from: { ...(selectedOverlay.gradient?.from || {}), hex: e.target.value },
                                  to: { ...(selectedOverlay.gradient?.to || {}), hex: selectedGradientToHex }
                                },
                                backgroundColor: e.target.value
                              })}
                              className="w-full h-10 rounded-xl border border-gray-200 bg-white"
                            />
                          </div>
                        </div>

                        <div>
                          <Label>To</Label>
                          <div className="mt-2">
                            <input
                              type="color"
                              value={selectedGradientToHex}
                              onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, {
                                isGradient: true,
                                gradient: {
                                  direction: selectedGradientDirection,
                                  from: { ...(selectedOverlay.gradient?.from || {}), hex: selectedGradientFromHex },
                                  to: { ...(selectedOverlay.gradient?.to || {}), hex: e.target.value }
                                }
                              })}
                              className="w-full h-10 rounded-xl border border-gray-200 bg-white"
                            />
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <Label>Background</Label>
                          <div className="mt-2">
                            <input
                              type="color"
                              value={selectedOverlay.backgroundColor || '#333333'}
                              onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { backgroundColor: e.target.value, isGradient: false, gradient: null })}
                              className="w-full h-10 rounded-xl border border-gray-200 bg-white"
                            />
                          </div>
                        </div>

                        <div>
                          <Label>Text color</Label>
                          <div className="mt-2">
                            <input
                              type="color"
                              value={selectedOverlay.textColor || '#ffffff'}
                              onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { textColor: e.target.value })}
                              className="w-full h-10 rounded-xl border border-gray-200 bg-white"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 p-4">
                  <div className="text-xs font-semibold text-gray-700">Typography</div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <Label>Font size</Label>
                      <div className="mt-2">
                        <Input
                          type="number"
                          min="8"
                          value={selectedOverlay.fontSize || 24}
                          onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { fontSize: toNumber(e.target.value, 24) })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Weight</Label>
                      <div className="mt-2">
                        <Select
                          value={selectedOverlay.fontWeight || 'normal'}
                          onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { fontWeight: e.target.value })}
                        >
                          <option value="normal">Normal</option>
                          <option value="bold">Bold</option>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Style</Label>
                      <div className="mt-2">
                        <Select
                          value={selectedOverlay.fontStyle || 'normal'}
                          onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { fontStyle: e.target.value })}
                        >
                          <option value="normal">Normal</option>
                          <option value="italic">Italic</option>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Family</Label>
                      <div className="mt-2">
                        <Input
                          type="text"
                          value={selectedOverlay.fontFamily || 'Inter'}
                          onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { fontFamily: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 p-4">
                  <div className="text-xs font-semibold text-gray-700">Geometry</div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <Label>X</Label>
                      <div className="mt-2">
                        <Input
                          type="number"
                          value={selectedOverlay.x}
                          onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { x: Math.round(toNumber(e.target.value, 0)) })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>Y</Label>
                      <div className="mt-2">
                        <Input
                          type="number"
                          value={selectedOverlay.y}
                          onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { y: Math.round(toNumber(e.target.value, 0)) })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>W</Label>
                      <div className="mt-2">
                        <Input
                          type="number"
                          value={selectedOverlay.width}
                          onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { width: Math.round(toNumber(e.target.value, 1)) })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label>H</Label>
                      <div className="mt-2">
                        <Input
                          type="number"
                          value={selectedOverlay.height}
                          onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { height: Math.round(toNumber(e.target.value, 1)) })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-gray-500">
                    Tip: drag the overlay on the stage to move it, or drag the handles to resize.
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
