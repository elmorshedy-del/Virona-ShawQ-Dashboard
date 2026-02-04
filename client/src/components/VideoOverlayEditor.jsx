import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, Wand2, Scissors, AlertTriangle, RefreshCw } from 'lucide-react';

const API_BASE = '/api';
const withStore = (path, store) => `${API_BASE}${path}${path.includes('?') ? '&' : '?'}store=${encodeURIComponent(store ?? 'vironax')}`;

const formatTime = (seconds) => {
  const s = Number.isFinite(seconds) ? seconds : 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function VideoOverlayEditor({ store }) {
  const [videoSrc, setVideoSrc] = useState(null);

  useEffect(() => {
    const objectUrl = videoSrc;

    // This cleanup function will be called when the component unmounts
    // or when videoSrc changes, preventing memory leaks.
    return () => {
      if (objectUrl && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [videoSrc]);

  const [videoId, setVideoId] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null); // {duration,width,height}
  const [segments, setSegments] = useState([]); // [{id,start,end,label,overlays:[]}]
  const [selectedSegmentId, setSelectedSegmentId] = useState(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState(null);
  const [scanConfig, setScanConfig] = useState({ intervalSec: 1, maxFrames: 30, useGemini: true });

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const videoBoxRef = useRef(null);
  const [videoDisplay, setVideoDisplay] = useState({ w: 0, h: 0 });

  // Keep overlay alignment correct when the <video> is scaled.
  useEffect(() => {
    if (!videoBoxRef.current) return;
    const el = videoBoxRef.current;
    const ro = new ResizeObserver((entries) => {
      const rect = entries?.[0]?.contentRect;
      if (!rect) return;
      setVideoDisplay({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime = () => setCurrentTime(v.currentTime || 0);
    const onLoaded = () => setCurrentTime(v.currentTime || 0);

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onLoaded);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [videoSrc]);

  const scale = useMemo(() => {
    const naturalW = videoRef.current?.videoWidth || 0;
    const naturalH = videoRef.current?.videoHeight || 0;
    if (!naturalW || !naturalH || !videoDisplay.w || !videoDisplay.h) return { x: 1, y: 1 };
    return { x: videoDisplay.w / naturalW, y: videoDisplay.h / naturalH };
  }, [videoDisplay.w, videoDisplay.h, videoSrc]);

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

  const updateOverlay = useCallback((segmentId, overlayId, patch) => {
    setSegments((prev) => prev.map((seg) => {
      if (seg.id !== segmentId) return seg;
      const overlays = (seg.overlays || []).map((ov) => (ov.id === overlayId ? { ...ov, ...patch } : ov));
      return { ...seg, overlays };
    }));
  }, []);

  const updateSegment = useCallback((segmentId, patch) => {
    setSegments((prev) => prev.map((seg) => (seg.id === segmentId ? { ...seg, ...patch } : seg)));
  }, []);

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
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Upload failed');
      }
      setVideoId(data.video_id);
      setVideoInfo({ duration: data.duration || null, width: data.width || null, height: data.height || null });
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
          use_gemini: scanConfig.useGemini
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Scan failed');
      }
      const segs = Array.isArray(data.segments) ? data.segments : [];
      setSegments(segs);
      if (segs[0]) {
        setSelectedSegmentId(segs[0].id);
        setSelectedOverlayId(segs[0].overlays?.[0]?.id || null);
        // Seek to the first segment for convenience
        if (videoRef.current) videoRef.current.currentTime = clamp(segs[0].start || 0, 0, videoRef.current.duration || 999999);
      }
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
              // Keep export payload minimal + stable
              startTime: undefined,
              endTime: undefined
            }))
          }))
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Export failed');
      }
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 rounded-3xl border border-white/60 bg-gradient-to-br from-white via-violet-50/40 to-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Magical Video Overlay Editor</h2>
        <p className="text-gray-500">
          Upload a video with a burnt-in overlay. Auto-scan finds overlay segments, then you edit the box and export a new MP4.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        {/* Main */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleVideoUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-black transition"
                disabled={isUploading}
              >
                {isUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {videoSrc ? 'Replace Video' : 'Upload Video'}
              </button>

              <button
                onClick={runScan}
                disabled={!videoId || isUploading || isScanning}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50"
              >
                {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                {isScanning ? 'Scanning...' : 'Auto-Scan Segments'}
              </button>

              <button
                onClick={exportVideo}
                disabled={!videoId || !segments.length || isUploading || isScanning || isExporting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 disabled:opacity-50"
              >
                {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isExporting ? 'Exporting...' : 'Export MP4'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <label className="flex items-center gap-2">
                <span>Scan interval</span>
                <input
                  type="number"
                  min="0.25"
                  max="10"
                  step="0.25"
                  value={scanConfig.intervalSec}
                  onChange={(e) => setScanConfig((p) => ({ ...p, intervalSec: Number(e.target.value) }))}
                  className="w-20 rounded-md border border-gray-200 px-2 py-1"
                />
                <span>s</span>
              </label>
              <label className="flex items-center gap-2">
                <span>Max frames</span>
                <input
                  type="number"
                  min="5"
                  max="120"
                  step="1"
                  value={scanConfig.maxFrames}
                  onChange={(e) => setScanConfig((p) => ({ ...p, maxFrames: Number(e.target.value) }))}
                  className="w-20 rounded-md border border-gray-200 px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={scanConfig.useGemini}
                  onChange={(e) => setScanConfig((p) => ({ ...p, useGemini: e.target.checked }))}
                />
                <span className="flex items-center gap-1">
                  <Wand2 className="w-3 h-3" />
                  Gemini scan
                </span>
              </label>
              {videoInfo?.duration ? (
                <span className="px-2 py-1 rounded bg-gray-50 border border-gray-100">
                  Duration: {formatTime(videoInfo.duration)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-center justify-center min-h-[420px]">
            {videoSrc ? (
              <div className="relative inline-block">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  className="max-w-full max-h-[520px] rounded-lg shadow bg-black"
                  onEnded={() => {}}
                />
                <div ref={videoBoxRef} className="absolute inset-0 pointer-events-none">
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
                      <button
                        key={`${ov._segmentId}:${ov.id}`}
                        type="button"
                        className={`absolute pointer-events-auto border-2 transition-all ${
                          isSelected ? 'border-violet-500 shadow-lg' : 'border-transparent hover:border-white/60'
                        }`}
                        style={{ left, top, width, height }}
                        onClick={() => {
                          setSelectedSegmentId(ov._segmentId);
                          setSelectedOverlayId(ov.id);
                        }}
                        title={`Segment ${formatTime(ov._segmentStart)}–${formatTime(ov._segmentEnd)}`}
                      >
                        <div
                          className="w-full h-full flex items-center justify-center overflow-hidden"
                          style={{ background }}
                        >
                          <span
                            style={{
                              color: ov.textColor,
                              fontFamily: ov.fontFamily || 'Inter, Arial, sans-serif',
                              fontSize: ov.fontSize ? `${Math.max(8, ov.fontSize) * scale.y}px` : undefined,
                              fontWeight: ov.fontWeight || 'normal',
                              fontStyle: ov.fontStyle || 'normal'
                            }}
                          >
                            {ov.text}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-gray-600 font-medium">Upload a video to start</p>
                <p className="text-sm text-gray-400 mt-1">Then click Auto-Scan to find overlay segments.</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">Segments</h3>
            <span className="text-xs text-gray-400">{segments.length ? `${segments.length} found` : '—'}</span>
          </div>

          {segments.length ? (
            <div className="space-y-2 mb-5">
              {segments.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => {
                    setSelectedSegmentId(seg.id);
                    setSelectedOverlayId(seg.overlays?.[0]?.id || null);
                    if (videoRef.current) {
                      videoRef.current.currentTime = clamp(seg.start || 0, 0, videoRef.current.duration || 999999);
                    }
                  }}
                  className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition ${
                    selectedSegmentId === seg.id
                      ? 'border-violet-200 bg-violet-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-gray-900">
                      {formatTime(seg.start)}–{formatTime(seg.end)}
                    </div>
                    <div className="text-xs text-gray-400">
                      {seg.overlays?.length ? `${seg.overlays.length} box${seg.overlays.length > 1 ? 'es' : ''}` : '0'}
                    </div>
                  </div>
                  {seg.label ? (
                    <div className="text-xs text-gray-500 mt-1 truncate">{seg.label}</div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 mb-5">
              Run Auto-Scan to detect when the overlay changes across the video.
            </div>
          )}

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">Overlay</h3>

            {selectedSegment && selectedOverlay ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500">
                    Start (s)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={Number(selectedSegment.start || 0).toFixed(2)}
                      onChange={(e) => updateSegment(selectedSegment.id, { start: Number(e.target.value) })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                  <label className="text-xs text-gray-500">
                    End (s)
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={Number(selectedSegment.end || 0).toFixed(2)}
                      onChange={(e) => updateSegment(selectedSegment.id, { end: Number(e.target.value) })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                </div>

                <label className="text-xs text-gray-500">
                  Text
                  <input
                    type="text"
                    value={selectedOverlay.text || ''}
                    onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { text: e.target.value })}
                    className="mt-1 w-full rounded-md border border-gray-200 px-2 py-2 text-sm text-gray-900"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500">
                    Background
                    <input
                      type="color"
                      value={selectedOverlay.backgroundColor || '#333333'}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { backgroundColor: e.target.value, isGradient: false, gradient: null })}
                      className="mt-1 w-full h-9 rounded-md border border-gray-200"
                    />
                  </label>
                  <label className="text-xs text-gray-500">
                    Text color
                    <input
                      type="color"
                      value={selectedOverlay.textColor || '#ffffff'}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { textColor: e.target.value })}
                      className="mt-1 w-full h-9 rounded-md border border-gray-200"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500">
                    X
                    <input
                      type="number"
                      value={selectedOverlay.x}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { x: Number(e.target.value) })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                  <label className="text-xs text-gray-500">
                    Y
                    <input
                      type="number"
                      value={selectedOverlay.y}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { y: Number(e.target.value) })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                  <label className="text-xs text-gray-500">
                    W
                    <input
                      type="number"
                      value={selectedOverlay.width}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { width: Number(e.target.value) })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                  <label className="text-xs text-gray-500">
                    H
                    <input
                      type="number"
                      value={selectedOverlay.height}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { height: Number(e.target.value) })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500">
                    Font size
                    <input
                      type="number"
                      min="8"
                      value={selectedOverlay.fontSize || 24}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { fontSize: Number(e.target.value) })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                  <label className="text-xs text-gray-500">
                    Weight
                    <select
                      value={selectedOverlay.fontWeight || 'normal'}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { fontWeight: e.target.value })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    >
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                    </select>
                  </label>
                  <label className="text-xs text-gray-500">
                    Style
                    <select
                      value={selectedOverlay.fontStyle || 'normal'}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { fontStyle: e.target.value })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    >
                      <option value="normal">Normal</option>
                      <option value="italic">Italic</option>
                    </select>
                  </label>
                  <label className="text-xs text-gray-500">
                    Family
                    <input
                      type="text"
                      value={selectedOverlay.fontFamily || 'Inter'}
                      onChange={(e) => updateOverlay(selectedSegment.id, selectedOverlay.id, { fontFamily: e.target.value })}
                      className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-900"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                Select a segment + overlay box from the video preview.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

