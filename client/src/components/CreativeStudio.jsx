// client/src/components/CreativeStudio.jsx
// Main Creative Studio Component - Google-style Ad Editor

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Type, Image as ImageIcon, Download, Layout, Palette, Move,
  Maximize, Smartphone, Monitor, Check, Undo, Upload, Wand2,
  Search, FileText, Video, Sparkles, Copy, RefreshCw, ChevronDown,
  Zap, Target, TrendingUp, AlertTriangle, CheckCircle, X, 
  Play, Pause, SkipForward, Clock, Languages, Globe, Settings,
  Camera, Film, Layers, Eye, Save, Trash2, Plus, ArrowRight
} from 'lucide-react';

const API_BASE = '/api';
const buildApiUrl = (path, store) => {
  const basePath = `${API_BASE}${path}`;
  if (!store) {
    return basePath;
  }
  const separator = basePath.includes('?') ? '&' : '?';
  return `${basePath}${separator}store=${encodeURIComponent(store)}`;
};

// ============================================================================
// DESIGN TOKENS
// ============================================================================
const fonts = {
  classic: "'Playfair Display', serif",
  modern: "'Montserrat', sans-serif",
  minimal: "'Inter', sans-serif",
  arabic: "'Cairo', sans-serif",
  luxury: "'Cormorant Garamond', serif"
};

const presets = {
  light: {
    name: 'Clean Light',
    textColor: '#1a1a1a',
    bgColor: '#ffffff',
    accentColor: '#000000',
    overlayOpacity: 0
  },
  dark: {
    name: 'Dark Mode',
    textColor: '#ffffff',
    bgColor: '#0a0a0a',
    accentColor: '#ffffff',
    overlayOpacity: 40
  },
  luxury: {
    name: 'Luxury Gold',
    textColor: '#d4af37',
    bgColor: '#1a1a1a',
    accentColor: '#d4af37',
    overlayOpacity: 50
  },
  vibrant: {
    name: 'Vibrant',
    textColor: '#ffffff',
    bgColor: '#7c3aed',
    accentColor: '#fbbf24',
    overlayOpacity: 30
  }
};

const dimensions = {
  post: { width: 1080, height: 1080, label: 'Feed Post', ratio: '1:1', icon: '⬛' },
  portrait: { width: 1080, height: 1350, label: 'Portrait', ratio: '4:5', icon: '📱' },
  story: { width: 1080, height: 1920, label: 'Story/Reel', ratio: '9:16', icon: '📲' },
  landscape: { width: 1200, height: 628, label: 'FB Link', ratio: '1.91:1', icon: '🖼️' },
  wide: { width: 1920, height: 1080, label: 'Landscape', ratio: '16:9', icon: '🎬' }
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function CreativeStudio({ store }) {
  // Active tab
  const [activeTab, setActiveTab] = useState('editor');

  // Tabs configuration
  const tabs = [
    { id: 'editor', label: 'Ad Editor', icon: <Layers size={18} /> },
    { id: 'video', label: 'Video Resizer', icon: <Film size={18} /> },
    { id: 'spy', label: 'Competitor Spy', icon: <Search size={18} /> },
    { id: 'generate', label: 'AI Generate', icon: <Wand2 size={18} /> },
    { id: 'analyze', label: 'Analyze', icon: <Target size={18} /> }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-[1800px] mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-lg font-semibold text-gray-900">Creative Studio</h1>
            </div>

            {/* Tab Navigation */}
            <div className="flex items-center gap-1">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab.id
                      ? 'bg-violet-100 text-violet-700'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {tab.icon}
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg">
                <Settings size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[1800px] mx-auto">
        {activeTab === 'editor' && <AdEditor store={store} />}
        {activeTab === 'video' && <VideoResizer store={store} />}
        {activeTab === 'spy' && <CompetitorSpy store={store} />}
        {activeTab === 'generate' && <AIGenerate store={store} />}
        {activeTab === 'analyze' && <AnalyzeTools store={store} />}
      </div>
    </div>
  );
}

// ============================================================================
// AD EDITOR (Google-style)
// ============================================================================
function AdEditor({ store }) {
  const [format, setFormat] = useState('post');
  const [layout, setLayout] = useState('centered');
  const [image, setImage] = useState(null);
  const [content, setContent] = useState({
    headline: 'NEW COLLECTION',
    subhead: 'Spring / Summer 2026',
    cta: 'SHOP NOW',
    overlayOpacity: 30,
    textColor: '#ffffff',
    accentColor: '#000000',
    bgColor: '#1a1a1a',
    fontStyle: 'modern',
    textAlign: 'center',
    showLogo: false
  });
  const [downloading, setDownloading] = useState(false);
  const [extractingStyle, setExtractingStyle] = useState(false);
  const [savedCreatives, setSavedCreatives] = useState([]);
  const adRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load Google Fonts
  useEffect(() => {
    const link = document.createElement('link');
    link.href = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@300;400;500;600&family=Montserrat:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, [store]);

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result);
      reader.readAsDataURL(file);
    }
  };

  // Extract style from reference image
  const handleExtractStyle = async () => {
    if (!image) return;

    setExtractingStyle(true);
    try {
      const base64 = image.split(',')[1];
      const response = await fetch(buildApiUrl('/creative-studio/extract-style', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: image })
      });

      const data = await response.json();
      if (data.success && data.style) {
        setContent(prev => ({
          ...prev,
          textColor: data.style.colors?.text || prev.textColor,
          accentColor: data.style.colors?.accent || prev.accentColor,
          bgColor: data.style.colors?.background || prev.bgColor,
          fontStyle: data.style.fontCategory === 'serif' ? 'classic' : 'modern',
          overlayOpacity: data.style.overlayOpacity || prev.overlayOpacity
        }));
      }
    } catch (error) {
      console.error('Style extraction failed:', error);
    }
    setExtractingStyle(false);
  };

  // Apply preset
  const applyPreset = (presetKey) => {
    const p = presets[presetKey];
    setContent(prev => ({
      ...prev,
      textColor: p.textColor,
      bgColor: p.bgColor,
      accentColor: p.accentColor,
      overlayOpacity: p.overlayOpacity
    }));
  };

  // Update content helper
  const updateContent = (key, value) => {
    setContent(prev => ({ ...prev, [key]: value }));
  };

  // Export image
  const handleDownload = async () => {
    if (!adRef.current) return;

    setDownloading(true);
    try {
      // Dynamic import html2canvas
      const html2canvas = (await import('html2canvas')).default;

      const canvas = await html2canvas(adRef.current, {
        useCORS: true,
        scale: 2,
        backgroundColor: null,
        logging: false
      });

      const link = document.createElement('a');
      link.download = `creative-${format}-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed. Try uploading your own image.");
    }
    setDownloading(false);
  };

  // Get current dimensions
  const dims = dimensions[format];
  const scale = Math.min(1, 500 / dims.width, 600 / dims.height);

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* Left Panel - Controls */}
      <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-4 space-y-6">
          {/* Format Selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Format
            </label>
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(dimensions).map(([key, dim]) => (
                <button
                  key={key}
                  onClick={() => setFormat(key)}
                  className={`flex flex-col items-center p-2 rounded-lg border-2 transition-all ${
                    format === key
                      ? 'border-violet-500 bg-violet-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="text-lg">{dim.icon}</span>
                  <span className="text-[10px] text-gray-500 mt-1">{dim.ratio}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Layout Selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Layout
            </label>
            <div className="flex gap-2">
              {['centered', 'split', 'framed'].map(l => (
                <button
                  key={l}
                  onClick={() => setLayout(l)}
                  className={`flex-1 py-2 text-xs uppercase tracking-wide rounded-lg border-2 font-medium transition-all ${
                    layout === l
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Background Image
            </label>
            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-24 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-violet-400 hover:bg-violet-50 transition-all"
              >
                {image ? (
                  <img src={image} alt="Preview" className="h-full w-full object-cover rounded-lg" />
                ) : (
                  <>
                    <Upload size={24} className="mb-1" />
                    <span className="text-xs">Click to upload</span>
                  </>
                )}
              </button>
              {image && (
                <button
                  onClick={handleExtractStyle}
                  disabled={extractingStyle}
                  className="absolute bottom-2 right-2 px-2 py-1 bg-violet-600 text-white text-xs rounded-lg flex items-center gap-1 hover:bg-violet-700 disabled:opacity-50"
                >
                  <Wand2 size={12} />
                  {extractingStyle ? 'Extracting...' : 'Extract Style'}
                </button>
              )}
            </div>
          </div>

          {/* Style Presets */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Style Presets
            </label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(presets).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="flex flex-col items-center p-2 rounded-lg border border-gray-200 hover:border-violet-400 transition-all group"
                >
                  <div
                    className="w-8 h-8 rounded-full border-2 border-white shadow-sm"
                    style={{ background: `linear-gradient(135deg, ${preset.bgColor}, ${preset.accentColor})` }}
                  />
                  <span className="text-[10px] text-gray-500 mt-1 group-hover:text-violet-600">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Content Inputs */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Content
            </label>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Headline</label>
                <input
                  type="text"
                  value={content.headline}
                  onChange={(e) => updateContent('headline', e.target.value)}
                  className="w-full p-2 border border-gray-200 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none text-sm"
                  placeholder="Main headline"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Subtext</label>
                <input
                  type="text"
                  value={content.subhead}
                  onChange={(e) => updateContent('subhead', e.target.value)}
                  className="w-full p-2 border border-gray-200 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none text-sm"
                  placeholder="Supporting text"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Button Text</label>
                <input
                  type="text"
                  value={content.cta}
                  onChange={(e) => updateContent('cta', e.target.value)}
                  className="w-full p-2 border border-gray-200 rounded-lg focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none text-sm uppercase"
                  placeholder="Call to action"
                />
              </div>
            </div>
          </div>

          {/* Typography */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Typography
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'classic', label: 'Serif' },
                { key: 'modern', label: 'Sans' },
                { key: 'minimal', label: 'Clean' }
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => updateContent('fontStyle', f.key)}
                  className={`py-2 text-xs border rounded-lg transition-all ${
                    content.fontStyle === f.key
                      ? 'border-gray-900 bg-gray-100 font-medium'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  style={{ fontFamily: fonts[f.key] }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Colors */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Colors
            </label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Text Color</span>
                <div className="flex gap-2">
                  {['#ffffff', '#000000', '#d4af37', '#f5f5dc'].map(c => (
                    <button
                      key={c}
                      onClick={() => updateContent('textColor', c)}
                      className={`w-6 h-6 rounded-full border-2 shadow-sm transition-all ${
                        content.textColor === c ? 'ring-2 ring-violet-500 ring-offset-1' : 'border-gray-200'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={content.textColor}
                    onChange={(e) => updateContent('textColor', e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer"
                  />
                </div>
              </div>

              {layout !== 'framed' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Overlay Darkness</span>
                    <span className="text-gray-400">{content.overlayOpacity}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="80"
                    value={content.overlayOpacity}
                    onChange={(e) => updateContent('overlayOpacity', parseInt(e.target.value))}
                    className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-violet-600"
                  />
                </div>
              )}

              {layout === 'split' && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Accent Color</span>
                  <div className="flex gap-2">
                    {['#000000', '#1a1a2e', '#7c3aed', '#0ea5e9'].map(c => (
                      <button
                        key={c}
                        onClick={() => updateContent('accentColor', c)}
                        className={`w-6 h-6 rounded-full border-2 shadow-sm transition-all ${
                          content.accentColor === c ? 'ring-2 ring-violet-500 ring-offset-1' : 'border-gray-200'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Export Button */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 sticky bottom-0">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-violet-700 hover:to-purple-700 transition-all disabled:opacity-50"
          >
            {downloading ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : (
              <Download size={18} />
            )}
            {downloading ? 'Exporting...' : 'Export Creative'}
          </button>
          <p className="text-[10px] text-gray-400 text-center mt-2">
            {dims.width} × {dims.height}px • {dims.label}
          </p>
        </div>
      </div>

      {/* Right Panel - Preview */}
      <div className="flex-1 bg-gray-100 flex items-center justify-center p-8 overflow-auto">
        <div className="relative">
          {/* Preview Label */}
          <div className="absolute -top-8 left-0 text-xs font-mono text-gray-400 uppercase tracking-wider">
            Live Preview • {dims.label} ({dims.ratio})
          </div>

          {/* The Ad Container */}
          <div
            ref={adRef}
            className="shadow-2xl transition-all duration-500 relative overflow-hidden"
            style={{
              width: dims.width * scale,
              height: dims.height * scale,
              backgroundColor: content.bgColor
            }}
          >
            {/* Background Image */}
            {image && (
              <div className="absolute inset-0">
                <img
                  src={image}
                  alt="Background"
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                />
                {content.overlayOpacity > 0 && layout !== 'framed' && (
                  <div
                    className="absolute inset-0 bg-black"
                    style={{ opacity: content.overlayOpacity / 100 }}
                  />
                )}
              </div>
            )}

            {/* Layout: Centered */}
            {layout === 'centered' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                <h2
                  className="text-4xl font-semibold mb-2 tracking-wide"
                  style={{
                    fontFamily: fonts[content.fontStyle],
                    color: content.textColor,
                    textShadow: image ? '0 2px 10px rgba(0,0,0,0.3)' : 'none',
                    fontSize: `${Math.max(24, dims.width * scale * 0.06)}px`
                  }}
                >
                  {content.headline}
                </h2>
                <p
                  className="text-sm uppercase tracking-widest opacity-80 mb-6"
                  style={{
                    fontFamily: fonts.modern,
                    color: content.textColor,
                    fontSize: `${Math.max(10, dims.width * scale * 0.025)}px`
                  }}
                >
                  {content.subhead}
                </p>
                <div
                  className="px-6 py-2 border text-sm tracking-widest uppercase font-medium"
                  style={{
                    borderColor: content.textColor,
                    color: content.textColor,
                    fontFamily: fonts.modern,
                    fontSize: `${Math.max(10, dims.width * scale * 0.022)}px`
                  }}
                >
                  {content.cta}
                </div>
              </div>
            )}

            {/* Layout: Split */}
            {layout === 'split' && (
              <div className="w-full h-full flex flex-col">
                <div className="h-2/3 relative overflow-hidden">
                  {image ? (
                    <img src={image} className="w-full h-full object-cover" crossOrigin="anonymous" alt="Product" />
                  ) : (
                    <div className="w-full h-full bg-gray-200" />
                  )}
                </div>
                <div
                  className="h-1/3 flex flex-col items-center justify-center p-4 text-center"
                  style={{ backgroundColor: content.accentColor }}
                >
                  <h2
                    className="text-2xl mb-1"
                    style={{ fontFamily: fonts[content.fontStyle], color: '#ffffff' }}
                  >
                    {content.headline}
                  </h2>
                  <p
                    className="text-xs uppercase tracking-widest opacity-80 mb-3"
                    style={{ fontFamily: fonts.modern, color: '#ffffff' }}
                  >
                    {content.subhead}
                  </p>
                  <div className="px-4 py-1.5 bg-white text-black text-xs font-bold uppercase tracking-widest">
                    {content.cta}
                  </div>
                </div>
              </div>
            )}

            {/* Layout: Framed */}
            {layout === 'framed' && (
              <div className="w-full h-full p-4 bg-white flex flex-col">
                <div className="flex-1 relative overflow-hidden border border-gray-100">
                  {image ? (
                    <img src={image} className="w-full h-full object-cover" crossOrigin="anonymous" alt="Product" />
                  ) : (
                    <div className="w-full h-full bg-gray-100" />
                  )}
                </div>
                <div className="py-4 bg-white text-center">
                  <h2
                    className="text-xl mb-1 text-gray-900"
                    style={{ fontFamily: fonts[content.fontStyle] }}
                  >
                    {content.headline}
                  </h2>
                  <p
                    className="text-xs text-gray-500 uppercase tracking-widest mb-2"
                    style={{ fontFamily: fonts.modern }}
                  >
                    {content.subhead}
                  </p>
                  <div className="text-xs border-b-2 border-gray-900 pb-0.5 inline-block uppercase tracking-wider font-semibold">
                    {content.cta}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dimension Badge */}
          <div className="absolute -bottom-8 right-0 text-xs text-gray-400">
            Scaled {Math.round(scale * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// VIDEO RESIZER
// ============================================================================
function VideoResizer({ store }) {
  const [video, setVideo] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [versions, setVersions] = useState(null);
  const [smartCrop, setSmartCrop] = useState(true);
  const [videoInfo, setVideoInfo] = useState(null);
  const fileInputRef = useRef(null);

  const handleVideoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setVideo(file);
    setVideoUrl(URL.createObjectURL(file));
    setVersions(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('video', file);

      const response = await fetch(buildApiUrl('/creative-studio/video/upload', store), {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        setVideoInfo(data);
      }
    } catch (error) {
      console.error('Video upload failed:', error);
    }
    setUploading(false);
  };

  const handleResize = async () => {
    if (!videoInfo?.video_id) return;

    setProcessing(true);
    try {
      const response = await fetch(buildApiUrl('/creative-studio/video/resize', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoInfo.video_id,
          smart_crop: smartCrop
        })
      });

      const data = await response.json();
      if (data.success) {
        setVersions(data.versions);
      }
    } catch (error) {
      console.error('Video resize failed:', error);
    }
    setProcessing(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Video Resizer</h2>
        <p className="text-gray-500">Upload a video and get all Meta ad dimensions with AI smart crop</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Upload size={18} />
            Upload Video
          </h3>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleVideoUpload}
            className="hidden"
          />

          {!videoUrl ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-48 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-violet-400 hover:bg-violet-50 transition-all"
            >
              <Film size={32} className="mb-2" />
              <span>Click to upload video</span>
              <span className="text-xs mt-1">MP4, MOV, WebM up to 100MB</span>
            </button>
          ) : (
            <div className="space-y-4">
              <video
                src={videoUrl}
                controls
                className="w-full rounded-lg bg-black"
              />
              {videoInfo && (
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  <span>{videoInfo.width}×{videoInfo.height}</span>
                  <span>{Math.round(videoInfo.duration)}s</span>
                  <span>{(videoInfo.size / 1024 / 1024).toFixed(1)}MB</span>
                </div>
              )}
            </div>
          )}

          {/* Smart Crop Toggle */}
          <label className="flex items-center justify-between mt-4 p-3 bg-gray-50 rounded-lg cursor-pointer">
            <div>
              <span className="font-medium text-gray-900">AI Smart Crop</span>
              <p className="text-xs text-gray-500">Detect faces & products for optimal cropping</p>
            </div>
            <input
              type="checkbox"
              checked={smartCrop}
              onChange={(e) => setSmartCrop(e.target.checked)}
              className="w-5 h-5 accent-violet-600"
            />
          </label>

          {/* Process Button */}
          <button
            onClick={handleResize}
            disabled={!videoInfo || processing || uploading}
            className="w-full mt-4 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-violet-700 hover:to-purple-700 transition-all disabled:opacity-50"
          >
            {uploading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Uploading...
              </>
            ) : processing ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Maximize size={18} />
                Generate All Sizes
              </>
            )}
          </button>
        </div>

        {/* Results Section */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Layers size={18} />
            Output Versions
          </h3>

          {!versions ? (
            <div className="h-48 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Layers size={32} className="mx-auto mb-2 opacity-50" />
                <p>Upload and process a video to see results</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(versions).map(([key, version]) => (
                <div
                  key={key}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={version.thumbnail}
                      alt={version.name}
                      className="w-16 h-10 object-cover rounded bg-gray-200"
                    />
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{version.name.replace('_', ' ')}</p>
                      <p className="text-xs text-gray-500">{version.width}×{version.height} ({version.ratio})</p>
                    </div>
                  </div>
                  <a
                    href={version.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-violet-100 text-violet-700 text-xs font-medium rounded-lg hover:bg-violet-200 transition-all"
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// COMPETITOR SPY
// ============================================================================
function CompetitorSpy({ store }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [country, setCountry] = useState('SA');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedAd, setSelectedAd] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [countries, setCountries] = useState({});

  // Load countries
  useEffect(() => {
    fetch(buildApiUrl('/creative-studio/competitor/countries', store))
      .then(res => res.json())
      .then(data => {
        if (data.success) setCountries(data.countries);
      });
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setResults([]);
    setSelectedAd(null);
    setAnalysis(null);

    try {
      const response = await fetch(
        buildApiUrl(
          `/creative-studio/competitor/search?brand_name=${encodeURIComponent(searchQuery)}&country=${country}`,
          store
        )
      );
      const data = await response.json();
      if (data.success) {
        setResults(data.ads);
      }
    } catch (error) {
      console.error('Search failed:', error);
    }
    setLoading(false);
  };

  const handleAnalyze = async (ad) => {
    setSelectedAd(ad);
    setAnalyzing(true);
    setAnalysis(null);

    try {
      const response = await fetch(buildApiUrl('/creative-studio/competitor/analyze', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: ad.snapshot_url,
          brand_name: ad.page_name,
          source_url: ad.snapshot_url,
          source_type: 'ad_library'
        })
      });

      const data = await response.json();
      if (data.success) {
        setAnalysis(data.analysis);
      }
    } catch (error) {
      console.error('Analysis failed:', error);
    }
    setAnalyzing(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Competitor Spy</h2>
        <p className="text-gray-500">Search Facebook Ad Library and get AI-powered breakdowns</p>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Enter brand or page name..."
              className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
            />
          </div>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="px-4 py-3 border border-gray-200 rounded-xl focus:border-violet-500 outline-none bg-white"
          >
            {Object.entries(countries).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            disabled={loading || !searchQuery.trim()}
            className="px-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium flex items-center gap-2 hover:from-violet-700 hover:to-purple-700 transition-all disabled:opacity-50"
          >
            {loading ? <RefreshCw size={18} className="animate-spin" /> : <Search size={18} />}
            Search
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Results Grid */}
        <div className="lg:col-span-2">
          {results.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {results.map((ad, idx) => (
                <div
                  key={ad.id || idx}
                  onClick={() => handleAnalyze(ad)}
                  className={`bg-white rounded-xl overflow-hidden border-2 cursor-pointer transition-all hover:shadow-lg ${
                    selectedAd?.id === ad.id ? 'border-violet-500' : 'border-gray-100'
                  }`}
                >
                  <div className="aspect-square bg-gray-100 relative">
                    <iframe
                      src={ad.snapshot_url}
                      className="w-full h-full pointer-events-none"
                      title={ad.page_name}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute bottom-2 left-2 right-2">
                      <p className="text-white text-xs font-medium truncate">{ad.page_name}</p>
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-gray-500 line-clamp-2">{ad.copy || 'No copy available'}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400">
                      {ad.platforms?.slice(0, 2).map(p => (
                        <span key={p} className="px-1.5 py-0.5 bg-gray-100 rounded">{p}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : !loading ? (
            <div className="bg-white rounded-2xl p-12 text-center text-gray-400 border border-gray-100">
              <Search size={40} className="mx-auto mb-3 opacity-50" />
              <p>Search for a brand to see their active ads</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
              <RefreshCw size={32} className="mx-auto mb-3 animate-spin text-violet-500" />
              <p className="text-gray-500">Searching Ad Library...</p>
            </div>
          )}
        </div>

        {/* Analysis Panel */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 h-fit sticky top-20">
          <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Target size={18} />
            AI Analysis
          </h3>

          {!selectedAd ? (
            <div className="text-center text-gray-400 py-8">
              <Eye size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Select an ad to analyze</p>
            </div>
          ) : analyzing ? (
            <div className="text-center py-8">
              <RefreshCw size={32} className="mx-auto mb-3 animate-spin text-violet-500" />
              <p className="text-gray-500">Analyzing creative...</p>
            </div>
          ) : analysis ? (
            <div className="space-y-4 text-sm">
              {/* Visual Style */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Visual Style</h4>
                <div className="flex gap-1 flex-wrap">
                  {analysis.visual_style?.colors?.map((c, i) => (
                    <div key={i} className="w-6 h-6 rounded" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <p className="text-gray-500 mt-1">{analysis.visual_style?.layout_type}</p>
              </div>

              {/* Hook Structure */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Hook Strategy</h4>
                <p className="text-gray-600">{analysis.hook_structure?.type}</p>
                <p className="text-xs text-gray-400 mt-1">{analysis.hook_structure?.attention_grabber}</p>
              </div>

              {/* What Works */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Why It Works</h4>
                <ul className="space-y-1">
                  {analysis.what_makes_it_work?.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-600">
                      <CheckCircle size={14} className="text-green-500 mt-0.5 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Replicable */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Copy These Elements</h4>
                <ul className="space-y-1">
                  {analysis.replicable_elements?.map((item, i) => (
                    <li key={i} className="text-gray-600 text-xs bg-violet-50 px-2 py-1 rounded">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <button className="w-full mt-4 py-2 bg-violet-100 text-violet-700 rounded-lg font-medium text-sm hover:bg-violet-200 transition-all">
                Generate My Version
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AI GENERATE (Hooks, Scripts, Brief, Localizer)
// ============================================================================
function AIGenerate({ store }) {
  const [activeGen, setActiveGen] = useState('hooks');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Form states
  const [hookForm, setHookForm] = useState({
    product_name: '',
    product_description: '',
    target_audience: '',
    tone: 'professional'
  });

  const [scriptForm, setScriptForm] = useState({
    product_name: '',
    product_benefits: '',
    target_audience: '',
    duration: '30s',
    style: 'testimonial'
  });

  const [localizeForm, setLocalizeForm] = useState({
    text: '',
    context: 'ecommerce'
  });

  const [briefForm, setBriefForm] = useState({
    product_name: '',
    product_description: '',
    target_audience: '',
    objective: '',
    budget_level: 'medium'
  });

  const generators = [
    { id: 'hooks', label: 'Hooks', icon: <Zap size={18} /> },
    { id: 'script', label: 'UGC Script', icon: <FileText size={18} /> },
    { id: 'localize', label: 'Localizer', icon: <Languages size={18} /> },
    { id: 'brief', label: 'Creative Brief', icon: <Target size={18} /> }
  ];

  const handleGenerate = async () => {
    setLoading(true);
    setResult(null);

    try {
      let endpoint, body;

      switch (activeGen) {
        case 'hooks':
          endpoint = '/generate/hooks';
          body = hookForm;
          break;
        case 'script':
          endpoint = '/generate/script';
          body = scriptForm;
          break;
        case 'localize':
          endpoint = '/localize';
          body = localizeForm;
          break;
        case 'brief':
          endpoint = '/generate/brief';
          body = briefForm;
          break;
      }

      const response = await fetch(buildApiUrl(`/creative-studio${endpoint}`, store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      if (data.success) {
        setResult(data);
      }
    } catch (error) {
      console.error('Generation failed:', error);
    }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">AI Generate</h2>
        <p className="text-gray-500">Create hooks, scripts, localized copy, and creative briefs with AI</p>
      </div>

      {/* Generator Tabs */}
      <div className="flex gap-2 mb-6">
        {generators.map(gen => (
          <button
            key={gen.id}
            onClick={() => { setActiveGen(gen.id); setResult(null); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeGen === gen.id
                ? 'bg-violet-100 text-violet-700'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {gen.icon}
            {gen.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Form */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          {/* Hook Generator Form */}
          {activeGen === 'hooks' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                <input
                  type="text"
                  value={hookForm.product_name}
                  onChange={(e) => setHookForm({ ...hookForm, product_name: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                  placeholder="e.g., Sterling Silver Ring Collection"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={hookForm.product_description}
                  onChange={(e) => setHookForm({ ...hookForm, product_description: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none h-24"
                  placeholder="Describe your product's key features and benefits..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
                <input
                  type="text"
                  value={hookForm.target_audience}
                  onChange={(e) => setHookForm({ ...hookForm, target_audience: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                  placeholder="e.g., Men 25-45 in Saudi Arabia who appreciate luxury"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tone</label>
                <select
                  value={hookForm.tone}
                  onChange={(e) => setHookForm({ ...hookForm, tone: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                >
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="urgent">Urgent</option>
                  <option value="playful">Playful</option>
                  <option value="luxurious">Luxurious</option>
                </select>
              </div>
            </div>
          )}

          {/* Script Generator Form */}
          {activeGen === 'script' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                <input
                  type="text"
                  value={scriptForm.product_name}
                  onChange={(e) => setScriptForm({ ...scriptForm, product_name: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key Benefits</label>
                <textarea
                  value={scriptForm.product_benefits}
                  onChange={(e) => setScriptForm({ ...scriptForm, product_benefits: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none h-24"
                  placeholder="List the main benefits to highlight..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                  <select
                    value={scriptForm.duration}
                    onChange={(e) => setScriptForm({ ...scriptForm, duration: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                  >
                    <option value="15s">15 seconds</option>
                    <option value="30s">30 seconds</option>
                    <option value="60s">60 seconds</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Style</label>
                  <select
                    value={scriptForm.style}
                    onChange={(e) => setScriptForm({ ...scriptForm, style: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                  >
                    <option value="testimonial">Testimonial</option>
                    <option value="problem-solution">Problem-Solution</option>
                    <option value="unboxing">Unboxing</option>
                    <option value="day-in-life">Day in Life</option>
                    <option value="before-after">Before-After</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Localizer Form */}
          {activeGen === 'localize' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">English Text</label>
                <textarea
                  value={localizeForm.text}
                  onChange={(e) => setLocalizeForm({ ...localizeForm, text: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none h-32"
                  placeholder="Enter your English ad copy to translate to Arabic..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Context</label>
                <select
                  value={localizeForm.context}
                  onChange={(e) => setLocalizeForm({ ...localizeForm, context: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                >
                  <option value="jewelry">Jewelry</option>
                  <option value="fashion">Fashion</option>
                  <option value="beauty">Beauty</option>
                  <option value="tech">Technology</option>
                  <option value="ecommerce">General E-commerce</option>
                </select>
              </div>
            </div>
          )}

          {/* Brief Generator Form */}
          {activeGen === 'brief' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                <input
                  type="text"
                  value={briefForm.product_name}
                  onChange={(e) => setBriefForm({ ...briefForm, product_name: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={briefForm.product_description}
                  onChange={(e) => setBriefForm({ ...briefForm, product_description: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none h-20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Objective</label>
                <input
                  type="text"
                  value={briefForm.objective}
                  onChange={(e) => setBriefForm({ ...briefForm, objective: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:border-violet-500 outline-none"
                  placeholder="e.g., Drive sales for Ramadan collection"
                />
              </div>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full mt-6 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-violet-700 hover:to-purple-700 transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 size={18} />
                Generate
              </>
            )}
          </button>
        </div>

        {/* Results */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 max-h-[600px] overflow-y-auto">
          {!result ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Sparkles size={40} className="mx-auto mb-3 opacity-50" />
                <p>Fill in the form and click Generate</p>
              </div>
            </div>
          ) : activeGen === 'hooks' && result.hooks ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900 mb-4">Generated Hooks ({result.hooks.length})</h3>
              {result.hooks.map((hook, idx) => (
                <div key={idx} className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-gray-900 font-medium">{hook.hook}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 bg-violet-100 text-violet-700 rounded">{hook.framework}</span>
                    <span className="text-xs text-gray-400">{hook.best_for}</span>
                    <button className="ml-auto text-gray-400 hover:text-gray-600">
                      <Copy size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : activeGen === 'script' && result.script ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900">UGC Script</h3>
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="mb-4">
                  <span className="text-xs font-medium text-violet-600 uppercase">Hook ({result.script.script?.hook?.time})</span>
                  <p className="text-gray-900 mt-1">{result.script.script?.hook?.text}</p>
                  <p className="text-xs text-gray-500 mt-1 italic">{result.script.script?.hook?.delivery}</p>
                </div>
                {result.script.script?.body?.map((section, idx) => (
                  <div key={idx} className="mb-4">
                    <span className="text-xs font-medium text-gray-500 uppercase">Body ({section.time})</span>
                    <p className="text-gray-900 mt-1">{section.text}</p>
                    <p className="text-xs text-gray-500 mt-1 italic">{section.delivery}</p>
                  </div>
                ))}
                <div>
                  <span className="text-xs font-medium text-green-600 uppercase">CTA ({result.script.script?.cta?.time})</span>
                  <p className="text-gray-900 mt-1">{result.script.script?.cta?.text}</p>
                </div>
              </div>
              {result.script.shot_list && (
                <div>
                  <h4 className="font-medium text-gray-700 mb-2">Shot List</h4>
                  <div className="space-y-2">
                    {result.script.shot_list.map((shot, idx) => (
                      <div key={idx} className="text-sm text-gray-600">
                        <span className="font-medium">Shot {shot.shot}:</span> {shot.description} ({shot.duration})
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : activeGen === 'localize' && result.localized ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900">Arabic Translation</h3>
              <div className="p-4 bg-gray-50 rounded-lg" dir="rtl">
                <p className="text-xl text-gray-900 font-medium" style={{ fontFamily: "'Cairo', sans-serif" }}>
                  {result.localized.primary_translation}
                </p>
              </div>
              {result.localized.alternatives?.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-700 mb-2">Alternatives</h4>
                  {result.localized.alternatives.map((alt, idx) => (
                    <div key={idx} className="p-3 bg-violet-50 rounded-lg mb-2" dir="rtl">
                      <p className="text-gray-900" style={{ fontFamily: "'Cairo', sans-serif" }}>{alt.text}</p>
                      <p className="text-xs text-violet-600 mt-1" dir="ltr">Tone: {alt.tone}</p>
                    </div>
                  ))}
                </div>
              )}
              {result.localized.cultural_notes?.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-700 mb-2">Cultural Notes</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {result.localized.cultural_notes.map((note, idx) => (
                      <li key={idx}>• {note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : activeGen === 'brief' && result.brief ? (
            <div className="space-y-4">
              <h3 className="font-semibold text-gray-900">{result.brief.brief_title}</h3>
              <div>
                <h4 className="font-medium text-gray-700">Key Message</h4>
                <p className="text-gray-600">{result.brief.messaging?.key_message}</p>
              </div>
              <div>
                <h4 className="font-medium text-gray-700">Target Audience</h4>
                <p className="text-gray-600">{result.brief.target_audience?.demographics}</p>
                <p className="text-sm text-gray-500 mt-1">{result.brief.target_audience?.psychographics}</p>
              </div>
              <div>
                <h4 className="font-medium text-gray-700">Creative Direction</h4>
                <p className="text-gray-600">{result.brief.creative_direction?.visual_style}</p>
                <div className="flex gap-1 mt-2">
                  {result.brief.creative_direction?.color_palette?.map((c, i) => (
                    <div key={i} className="w-8 h-8 rounded" style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <div>
                <h4 className="font-medium text-gray-700">Hooks to Test</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  {result.brief.hooks_to_test?.map((h, i) => (
                    <li key={i} className="p-2 bg-gray-50 rounded">{h}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// ANALYZE TOOLS (Fatigue, Audit, Thumbnail Predictor)
// ============================================================================
function AnalyzeTools({ store }) {
  const [activeTool, setActiveTool] = useState('fatigue');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [metaConnected, setMetaConnected] = useState(false);
  const [checkingMeta, setCheckingMeta] = useState(true);
  const [fatigueError, setFatigueError] = useState(null);

  // For thumbnail predictor
  const [images, setImages] = useState([]);
  const fileInputRef = useRef(null);

  const tools = [
    { id: 'fatigue', label: 'Fatigue Detector', icon: <TrendingUp size={18} /> },
    { id: 'audit', label: 'Account Audit', icon: <CheckCircle size={18} /> },
    { id: 'thumbnail', label: 'Thumbnail A/B', icon: <Eye size={18} /> }
  ];

  useEffect(() => {
    const checkMetaStatus = async () => {
      setCheckingMeta(true);
      try {
        const res = await fetch(buildApiUrl('/creative-studio/meta-status', store));
        const data = await res.json();
        setMetaConnected(Boolean(data.connected));
      } catch (e) {
        console.error('Meta status check failed:', e);
        setMetaConnected(false);
      }
      setCheckingMeta(false);
    };

    if (store) {
      checkMetaStatus();
    } else {
      setMetaConnected(false);
      setCheckingMeta(false);
    }
  }, [store]);

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files).slice(0, 4);
    const newImages = files.map(file => ({
      file,
      url: URL.createObjectURL(file)
    }));
    setImages(prev => [...prev, ...newImages].slice(0, 4));
  };

  const handlePredictThumbnails = async () => {
    if (images.length < 2) return;

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      images.forEach(img => formData.append('images', img.file));

      const response = await fetch(buildApiUrl('/creative-studio/predict/thumbnails', store), {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        setResult({ predictions: data.predictions });
      }
    } catch (error) {
      console.error('Prediction failed:', error);
    }
    setLoading(false);
  };

  const handleRunAudit = async () => {
    setLoading(true);
    setResult(null);
    setFatigueError(null);

    try {
      // In real implementation, this would pull data from your Meta connection
      const response = await fetch(buildApiUrl('/creative-studio/audit', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adSets: [],
          ads: [],
          dailyMetrics: [],
          shopifyOrders: [],
          metaConversions: []
        })
      });

      const data = await response.json();
      if (data.success) {
        setResult({ audit: data.audit });
      }
    } catch (error) {
      console.error('Audit failed:', error);
    }
    setLoading(false);
  };

  const handleAnalyzeFatigue = async () => {
    setLoading(true);
    setResult(null);
    setFatigueError(null);

    try {
      const response = await fetch(buildApiUrl('/creative-studio/fatigue/analyze', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ads: []
        })
      });

      const data = await response.json();
      if (data.success) {
        setResult({ fatigue: data });
      } else {
        setFatigueError(data?.error || 'Fatigue analysis failed.');
      }
    } catch (error) {
      console.error('Fatigue analysis failed:', error);
      setFatigueError('Fatigue analysis failed.');
    }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Analyze</h2>
        <p className="text-gray-500">Detect fatigue, audit your account, and predict thumbnail performance</p>
      </div>

      {/* Tool Tabs */}
      <div className="flex gap-2 mb-6">
        {tools.map(tool => (
          <button
            key={tool.id}
            onClick={() => {
              setActiveTool(tool.id);
              setResult(null);
              setFatigueError(null);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              activeTool === tool.id
                ? 'bg-violet-100 text-violet-700'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {tool.icon}
            {tool.label}
          </button>
        ))}
      </div>

      {/* Thumbnail A/B Predictor */}
      {activeTool === 'thumbnail' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-4">Upload 2-4 Thumbnail Variations</h3>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            className="hidden"
          />

          <div className="grid grid-cols-4 gap-4 mb-6">
            {[0, 1, 2, 3].map(idx => (
              <div key={idx}>
                {images[idx] ? (
                  <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                    <img src={images[idx].url} alt={`Thumbnail ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full"
                    >
                      <X size={12} />
                    </button>
                    {result?.predictions && (
                      <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white p-2 text-center">
                        <span className="text-2xl font-bold">#{result.predictions.find(p => p.image_index === idx)?.rank || '?'}</span>
                        <p className="text-xs">{result.predictions.find(p => p.image_index === idx)?.overall_score || 0}/100</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-violet-400 hover:bg-violet-50 transition-all"
                  >
                    <Plus size={24} />
                    <span className="text-xs mt-1">Add #{idx + 1}</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={handlePredictThumbnails}
            disabled={images.length < 2 || loading}
            className="w-full py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:from-violet-700 hover:to-purple-700 transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Eye size={18} />
                Predict Winner
              </>
            )}
          </button>

          {result?.predictions && (
            <div className="mt-6 space-y-4">
              <h4 className="font-semibold text-gray-900">Results (Ranked Best → Worst)</h4>
              {result.predictions.map((pred, idx) => (
                <div key={idx} className={`p-4 rounded-lg border-2 ${pred.rank === 1 ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Thumbnail #{pred.image_index + 1}</span>
                    <span className={`text-2xl font-bold ${pred.rank === 1 ? 'text-green-600' : 'text-gray-600'}`}>
                      Rank #{pred.rank}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-sm">
                    <div className="text-center p-2 bg-white rounded">
                      <p className="text-gray-500 text-xs">Overall</p>
                      <p className="font-bold text-lg">{pred.overall_score}</p>
                    </div>
                    <div className="text-center p-2 bg-white rounded">
                      <p className="text-gray-500 text-xs">Scroll Stop</p>
                      <p className="font-bold">{pred.scores?.scroll_stopping_power || 0}</p>
                    </div>
                    <div className="text-center p-2 bg-white rounded">
                      <p className="text-gray-500 text-xs">Emotion</p>
                      <p className="font-bold">{pred.scores?.emotional_impact || 0}</p>
                    </div>
                    <div className="text-center p-2 bg-white rounded">
                      <p className="text-gray-500 text-xs">CTR Index</p>
                      <p className="font-bold text-xs">{pred.predicted_ctr_index}</p>
                    </div>
                  </div>
                  {pred.strengths?.length > 0 && (
                    <div className="mt-2 text-sm">
                      <span className="text-green-600">✓</span> {pred.strengths[0]}
                    </div>
                  )}
                  {pred.weaknesses?.length > 0 && (
                    <div className="text-sm">
                      <span className="text-red-500">✗</span> {pred.weaknesses[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Account Audit */}
      {activeTool === 'audit' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="text-center py-8">
            <CheckCircle size={48} className="mx-auto mb-4 text-violet-500" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Ad Account Health Audit</h3>
            <p className="text-gray-500 mb-6">Connect your Meta account to run a comprehensive health check</p>
            <button
              onClick={handleRunAudit}
              disabled={loading}
              className="px-8 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium inline-flex items-center gap-2 hover:from-violet-700 hover:to-purple-700 transition-all disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  Running Audit...
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  Run Full Audit
                </>
              )}
            </button>
          </div>

          {result?.audit && (
            <div className="mt-6 space-y-4">
              <div className={`p-6 rounded-xl text-center ${
                result.audit.status === 'healthy' ? 'bg-green-50' :
                result.audit.status === 'needs_attention' ? 'bg-yellow-50' :
                result.audit.status === 'warning' ? 'bg-orange-50' : 'bg-red-50'
              }`}>
                <span className="text-4xl">{result.audit.status_emoji}</span>
                <h4 className="text-2xl font-bold mt-2">{result.audit.health_score}/100</h4>
                <p className="text-gray-600">{result.audit.summary_message}</p>
              </div>

              {result.audit.issues?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-3">Issues Found</h4>
                  {result.audit.issues.map((issue, idx) => (
                    <div key={idx} className={`p-4 rounded-lg mb-2 ${
                      issue.severity === 'high' ? 'bg-red-50 border-l-4 border-red-500' :
                      issue.severity === 'medium' ? 'bg-yellow-50 border-l-4 border-yellow-500' :
                      'bg-gray-50 border-l-4 border-gray-300'
                    }`}>
                      <h5 className="font-medium text-gray-900">{issue.title}</h5>
                      <p className="text-sm text-gray-600">{issue.message}</p>
                    </div>
                  ))}
                </div>
              )}

              {result.audit.recommendations?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-3">Recommendations</h4>
                  {result.audit.recommendations.map((rec, idx) => (
                    <div key={idx} className="p-4 bg-violet-50 rounded-lg mb-2">
                      <h5 className="font-medium text-violet-900">{rec.action}</h5>
                      <p className="text-sm text-violet-700">Impact: {rec.impact}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Fatigue Detector */}
      {activeTool === 'fatigue' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          {checkingMeta ? (
            <div className="text-center py-8">
              <RefreshCw className="animate-spin mx-auto mb-4" />
              <p>Checking Meta connection...</p>
            </div>
          ) : metaConnected ? (
            <div>
              <div className="text-center py-8">
                <TrendingUp size={48} className="mx-auto mb-4 text-violet-500" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Creative Fatigue Detector</h3>
                <p className="text-gray-500 mb-6">Scan your Meta creatives for performance fatigue</p>
                <button
                  onClick={handleAnalyzeFatigue}
                  disabled={loading}
                  className="px-8 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium inline-flex items-center gap-2 hover:from-violet-700 hover:to-purple-700 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <TrendingUp size={18} />
                      Analyze Fatigue
                    </>
                  )}
                </button>
              </div>

              {fatigueError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {fatigueError}
                </div>
              )}

              {result?.fatigue && (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <p className="text-sm text-gray-600">
                      Average fatigue score: <span className="font-semibold text-gray-900">{result.fatigue.summary?.average_score ?? 0}</span>
                    </p>
                    <p className="text-sm text-gray-600 mt-2">{result.fatigue.overall_recommendation}</p>
                  </div>

                  <div className="space-y-3">
                    {result.fatigue.ads?.map((ad) => (
                      <div key={ad.ad_id} className="rounded-lg border border-gray-100 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-900">{ad.ad_name}</p>
                            <p className="text-xs text-gray-500">{ad.ad_id}</p>
                          </div>
                          <span className="text-sm font-semibold text-gray-700">{ad.status}</span>
                        </div>
                        <p className="text-sm text-gray-600 mt-2">{ad.recommendation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <TrendingUp size={48} className="mx-auto mb-4 text-violet-500" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Creative Fatigue Detector</h3>
              <p>No Meta data found for this store.</p>
              <p className="text-sm text-gray-400">Sync your Meta account from the main dashboard first.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
