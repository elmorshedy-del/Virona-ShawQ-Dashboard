/**
 * VideoResizerPanel — Reusable video resizer panel for embedding in editors.
 * Adapted from the standalone VideoResizer in CreativeStudio.jsx.
 * Accepts an already-uploaded videoId so it skips the upload step.
 */
import { useState, useCallback } from 'react';
import {
  CheckCircle2,
  Crop,
  Download,
  Film,
  Loader2,
  Play,
  RefreshCw,
  X
} from 'lucide-react';

const API_BASE = '/api';
const cn = (...c) => c.filter(Boolean).join(' ');
const DEFAULT_STORE_SCOPE = 'default-tenant';
const CLOUDINARY_UPLOAD_SEGMENT = '/upload/';
const CLOUDINARY_POSTER_SEGMENT = '/upload/so_0/';

const resolveStoreScope = (store) => {
  if (store) return store;
  if (typeof window !== 'undefined') {
    const selectedStore = window.localStorage.getItem('selectedStore');
    if (selectedStore) return selectedStore;
  }
  return DEFAULT_STORE_SCOPE;
};

const withStore = (path, store) => {
  const resolvedStore = resolveStoreScope(store);
  return `${API_BASE}${path}${path.includes('?') ? '&' : '?'}store=${encodeURIComponent(resolvedStore)}`;
};

function resolveCloudinaryPosterUrl(sourceUrl) {
  if (!sourceUrl) return null;

  try {
    const parsed = new URL(sourceUrl, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (!parsed.pathname.includes(CLOUDINARY_UPLOAD_SEGMENT)) return null;
    parsed.pathname = parsed.pathname
      .replace(CLOUDINARY_UPLOAD_SEGMENT, CLOUDINARY_POSTER_SEGMENT)
      .replace(/\.\w+$/, '.jpg');
    return parsed.toString();
  } catch {
    return null;
  }
}

const PLATFORM_SIZES = [
  { id: 'meta_feed', label: 'Meta Feed', ratio: '1.91:1', platform: 'Meta' },
  { id: 'meta_portrait', label: 'Meta Portrait', ratio: '4:5', platform: 'Meta' },
  { id: 'meta_story', label: 'Meta Story / Reel', ratio: '9:16', platform: 'Meta' },
  { id: 'square', label: 'Square', ratio: '1:1', platform: 'All' },
  { id: 'landscape', label: 'Landscape', ratio: '16:9', platform: 'All' },
  { id: 'tiktok_feed', label: 'TikTok Feed', ratio: '9:16', platform: 'TikTok' },
  { id: 'tiktok_spark', label: 'TikTok Spark Ad', ratio: '1:1', platform: 'TikTok' },
  { id: 'snap_story', label: 'Snapchat Story', ratio: '9:16', platform: 'Snap' },
  { id: 'snap_spotlight', label: 'Snap Spotlight', ratio: '9:16', platform: 'Snap' },
  { id: 'snap_discover', label: 'Snap Discover', ratio: '4:5', platform: 'Snap' },
];

export default function VideoResizerPanel({ store, videoId, videoInfo, onVersionSelect }) {
  const storeScope = resolveStoreScope(store);
  const [processing, setProcessing] = useState(false);
  const [versions, setVersions] = useState(null);
  const [smartCrop, setSmartCrop] = useState(true);
  const [error, setError] = useState(null);
  const [previewVersion, setPreviewVersion] = useState(null);

  const resolveVersionUrl = (version) => (
    version?.url || version?.downloadUrl || version?.download_url || version?.source_url || null
  );

  const resolveThumbnailUrl = (version) => {
    const directThumb = version?.thumbnail || version?.thumbnail_url || version?.thumbnailUrl;
    if (directThumb) return directThumb;
    const baseUrl = resolveVersionUrl(version);
    if (!baseUrl) return null;
    return resolveCloudinaryPosterUrl(baseUrl);
  };

  const triggerDownload = async (version) => {
    const filename = `${version.name}_${version.width}x${version.height}.mp4`;
    const directUrl = resolveVersionUrl(version);
    if (!directUrl) return;
    try {
      const response = await fetch(directUrl, { mode: 'cors' });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      return;
    } catch (_err) {
      console.warn('Direct download failed, falling back to proxy.');
    }
    const proxyUrl = `${API_BASE}/creative-studio/video/download?url=${encodeURIComponent(directUrl)}&filename=${encodeURIComponent(filename)}`;
    const link = document.createElement('a');
    link.href = proxyUrl;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleResize = useCallback(async () => {
    if (!videoId) return;
    setError(null);
    setProcessing(true);
    try {
      const response = await fetch(withStore('/creative-studio/video/resize', storeScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, smart_crop: smartCrop })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setVersions(data.versions);
      } else {
        setError(data?.error || 'Resize failed. Try again.');
      }
    } catch (_err) {
      setError('Resize failed. Check connection and try again.');
    }
    setProcessing(false);
  }, [videoId, smartCrop, storeScope]);

  if (!videoId) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-gray-400">
        <Crop className="h-8 w-8 mb-3 opacity-40" />
        <p className="text-xs font-medium">Upload a video first</p>
        <p className="text-[10px] mt-1">Then come back here to auto-resize for every platform</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Smart Crop Toggle */}
      <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">AI Smart Crop</span>
            <p className="text-[10px] text-gray-400 mt-0.5">Detects faces & products for optimal framing</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={smartCrop}
            aria-label={`AI Smart Crop ${smartCrop ? 'enabled' : 'disabled'}`}
            className={cn(
            'relative w-10 h-5 rounded-full transition-colors',
            smartCrop ? 'bg-indigo-500' : 'bg-gray-200'
          )} onClick={() => setSmartCrop(!smartCrop)}>
            <span className="sr-only">Toggle AI Smart Crop</span>
            <div className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
              smartCrop ? 'translate-x-5' : 'translate-x-0.5'
            )} />
          </button>
        </div>
      </div>

      {/* Platform Sizes Reference */}
      <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 space-y-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400 block mb-1">Target Formats</span>
        {['Meta', 'TikTok', 'Snap', 'All'].map((platform) => {
          const items = PLATFORM_SIZES.filter((p) => p.platform === platform);
          if (!items.length) return null;
          return (
            <div key={platform}>
              <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-400 block mb-1">{platform === 'All' ? 'Universal' : platform}</span>
              {items.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-[10px] py-0.5">
                  <span className="text-gray-600 font-medium">{p.label}</span>
                  <span className="text-gray-400 font-mono">{p.ratio}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Generate Button */}
      <button
        onClick={handleResize}
        disabled={processing}
        className="pm-btn-primary-grad w-full py-2.5 rounded-xl text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
      >
        {processing ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Resizing...</>
        ) : (
          <><Crop className="h-3.5 w-3.5" /> Generate All Sizes</>
        )}
      </button>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-600">{error}</div>
      )}

      {/* Results */}
      {versions && (
        <div className="rounded-2xl border border-gray-100/80 bg-white/70 p-3 space-y-2">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-600">Ready</span>
          </div>
          {Object.entries(versions).map(([key, version]) => (
            <div
              key={key}
              className="group flex items-center justify-between p-2 rounded-xl hover:bg-white hover:shadow-sm cursor-pointer transition-all"
              onClick={() => setPreviewVersion(version)}
            >
              <div className="flex items-center gap-2.5">
                <div className="relative w-12 h-8 rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                  {resolveThumbnailUrl(version) ? (
                    <img src={resolveThumbnailUrl(version)} alt={version.name} className="w-full h-full object-cover" />
                  ) : (
                    <Film className="h-3 w-3 text-gray-300" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="h-3 w-3 text-white" />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-700">{(version.name || key).replace(/_/g, ' ')}</p>
                  <p className="text-[9px] text-gray-400 font-mono">{version.width}x{version.height}</p>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); triggerDownload(version); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewVersion && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setPreviewVersion(null)}>
          <div className="bg-white rounded-2xl overflow-hidden max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">{(previewVersion.name || '').replace(/_/g, ' ')}</h3>
                <p className="text-xs text-gray-500">{previewVersion.width}x{previewVersion.height}</p>
              </div>
              <button onClick={() => setPreviewVersion(null)} className="p-2 hover:bg-gray-100 rounded-full"><X size={18} /></button>
            </div>
            <div className="bg-black flex items-center justify-center" style={{ maxHeight: '65vh' }}>
              <video
                src={resolveVersionUrl(previewVersion)}
                controls
                autoPlay
                className="max-h-[65vh]"
                style={{ aspectRatio: `${previewVersion.width}/${previewVersion.height}` }}
              />
            </div>
            <div className="p-3 flex justify-end gap-2">
              <button onClick={() => setPreviewVersion(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg">Close</button>
              <button
                onClick={() => triggerDownload(previewVersion)}
                className="pm-btn-primary-grad px-3 py-1.5 text-xs font-medium text-white rounded-lg flex items-center gap-1.5"
              >
                <Download size={14} /> Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
