// client/src/components/CreativeStudio.jsx
// Main Creative Studio Component - Google-style Ad Editor

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Type, Image as ImageIcon, Download, Layout, Palette, Move,
  Maximize, Smartphone, Monitor, Check, Undo, Upload, Wand2,
  Search, FileText, Video, Sparkles, Copy, RefreshCw, ChevronDown,
  Zap, Target, TrendingUp, AlertTriangle, CheckCircle, X,
  Play, Pause, SkipForward, Clock, Languages, Globe, Settings,
  Camera, Film, Layers, Eye, Save, Trash2, Plus, ArrowRight,
  Loader2, Mic, MessageSquare, Calendar, Briefcase, Send, Activity, Star
} from 'lucide-react';

const API_BASE = '/api';
const withStore = (path, store) => `${API_BASE}${path}${path.includes('?') ? '&' : '?'}store=${encodeURIComponent(store ?? 'vironax')}`;

// ============================================================================
// DESIGN TOKENS
// ============================================================================
const fonts = {
  classic: "'Playfair Display', serif",
  modern: "'Montserrat', sans-serif",
  minimal: "'Lato', sans-serif"
};

const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop";
const ON_CREATIVE_SYSTEM_PROMPT = `You are a luxury-performance ad copywriter generating SHORT ON-CREATIVE text (headline + subheadline + CTA) for paid social (Meta/TikTok).

GOAL
Create the best-fitting words for the product and image—fresh, premium, high-converting. Be creative and varied. Avoid generic filler and “template” phrasing.

GLOBAL HARD RULES (must obey)
1) No new claims or facts. Only use what is explicitly provided in the input context/copy.
   - Don’t invent discounts, prices, shipping times, guarantees, “#1/best”, limited stock, materials, awards, endorsements.
2) Overlay-friendly length:
   - Headline: 2–5 words
   - Subheadline: 3–8 words
   - CTA: 1–3 words
3) Clean typography for image text:
   - No emojis, no hashtags, no quotation marks
   - Minimal punctuation only (avoid long punctuation chains)
   - Avoid ALL CAPS (unless standard for the locale and only for one emphasis word)
   - Arabic: no tashkeel (diacritics) and no kashida (ـ)
4) Premium tone:
   - Polished, confident, editorial-luxury
   - Strong CTA, not pushy or “coupon-y”
5) If the input is vague, stay safely general rather than inventing details.

LOCALE / DIALECT RULES (must obey)
General:
- Match local spelling, cadence, and current ad phrasing for that locale (modern, marketing-native).
- Avoid awkward literal translation; keep it natural and stylish.

English:
- en-US: American spelling and retail phrasing.
- en-GB: British spelling and phrasing; slightly more understated tone.

Spanish:
- Premium but direct; natural retail phrasing.
- Avoid country-specific idioms unless the locale is specified.

Chinese:
- Use correct script for the locale (Simplified vs Traditional).
- Clean luxury commerce tone; avoid cheesy internet slang; avoid exaggerated superlatives unless provided.

Japanese:
- Understated, refined, minimal luxury tone.
- Avoid aggressive hard-sell language; concise and elegant.

Korean:
- Modern premium commerce tone; concise and confident.
- Avoid overly casual slang; keep it polished.

Arabic (dialects with freedom, still brand-safe):
- Write in the requested dialect/region using CURRENT marketing style in that region (what people actually see in ads today).
- Dialect wording and cadence are allowed (not strict MSA), as long as it stays readable, premium, and not overly slangy.
- Light mixing with MSA is allowed for clarity (especially headlines).
- Keep it premium: avoid “cheap” vibes and heavy slang.
- Avoid words that imply claims (e.g., “رقم 1/الأفضل/مضمون”) unless explicitly provided.

Arabic region guidance (choose based on requested locale):
- Gulf: confident, clean, premium; modern Gulf ad cadence; avoid Egypt/Maghreb-only phrasing.
- Egypt: catchy and friendly but still premium; avoid very “street” slang.
- Levant: smooth, warm, boutique feel; broadly understandable across Levant.
- Maghreb: allow local feel but keep clarity high; avoid heavy Darija spelling that becomes hard to read.

CREATIVE FREEDOM WITH BOUNDARIES
- Produce multiple options with genuinely different angles (seasonal/editorial, craftsmanship, identity, minimal elegance, exclusivity mood, etc.)
- Do not repeat the same core phrase across options.`;

const LANGUAGE_OPTIONS = [
  {
    id: 'en',
    label: 'English',
    locales: [
      { value: 'en-US', label: 'English (US)' },
      { value: 'en-GB', label: 'English (UK)' }
    ]
  },
  {
    id: 'ar',
    label: 'Arabic',
    locales: [
      { value: 'ar-SA', label: 'Arabic (Saudi)' },
      { value: 'ar-AE', label: 'Arabic (UAE)' },
      { value: 'ar-EG', label: 'Arabic (Egypt)' },
      { value: 'ar-TN', label: 'Arabic (Tunisia)' },
      { value: 'ar-MA', label: 'Arabic (Morocco)' }
    ]
  },
  {
    id: 'es',
    label: 'Spanish',
    locales: [
      { value: 'es-ES', label: 'Spanish (ES)' },
      { value: 'es-419', label: 'Spanish (LATAM)' }
    ]
  },
  {
    id: 'zh',
    label: 'Chinese',
    locales: [
      { value: 'zh-CN', label: 'Chinese (Simplified)' },
      { value: 'zh-TW', label: 'Chinese (Traditional)' },
      { value: 'zh-HK', label: 'Chinese (HK)' }
    ]
  },
  {
    id: 'ko',
    label: 'Korean',
    locales: [{ value: 'ko-KR', label: 'Korean' }]
  },
  {
    id: 'ja',
    label: 'Japanese',
    locales: [{ value: 'ja-JP', label: 'Japanese' }]
  },
  {
    id: 'fr',
    label: 'French',
    locales: [{ value: 'fr-FR', label: 'French' }]
  },
  {
    id: 'it',
    label: 'Italian',
    locales: [{ value: 'it-IT', label: 'Italian' }]
  }
];

const RECOMMENDED_LOCALES = [
  { value: 'ar-SA', label: 'Arabic (Saudi)', rank: 1 },
  { value: 'en-US', label: 'English (US)', rank: 2 },
  { value: 'es-419', label: 'Spanish (LATAM)', rank: 3 }
];

const addWavHeader = (pcmData, sampleRate = 24000, numChannels = 1, bitDepth = 16) => {
  const byteRate = sampleRate * numChannels * (bitDepth / 8);
  const blockAlign = numChannels * (bitDepth / 8);
  const dataSize = pcmData.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (viewRef, offset, string) => {
    for (let i = 0; i < string.length; i += 1) {
      viewRef.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const pcmArray = new Uint8Array(pcmData);
  const bufferArray = new Uint8Array(buffer);
  bufferArray.set(pcmArray, 44);

  return buffer;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function CreativeStudio({ store }) {
  // Active tab
  const [activeTab, setActiveTab] = useState('editor');
  const [pendingBrief, setPendingBrief] = useState(null);

  // Tabs configuration
  const tabs = [
    { id: 'editor', label: 'Ad Editor', icon: <Layers size={18} /> },
    { id: 'video', label: 'Video Resizer', icon: <Film size={18} /> },
    { id: 'spy', label: 'Competitor Spy', icon: <Search size={18} /> },
    { id: 'generate', label: 'AI Generate', icon: <Wand2 size={18} /> },
    { id: 'analyze', label: 'Analyze', icon: <Target size={18} /> }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-violet-50">
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
        {activeTab === 'spy' && (
          <CompetitorSpy
            store={store}
            onGenerateBrief={(brief) => {
              setPendingBrief(brief);
              setActiveTab('generate');
            }}
          />
        )}
        {activeTab === 'generate' && (
          <AIGenerate
            store={store}
            prefillBrief={pendingBrief}
            onPrefillApplied={() => setPendingBrief(null)}
          />
        )}
        {activeTab === 'analyze' && <AnalyzeTools store={store} />}
      </div>
    </div>
  );
}

// ============================================================================
// AD EDITOR (Virona Ad Studio)
// ============================================================================
function AdEditor({ store }) {
  const [format, setFormat] = useState('square');
  const [image, setImage] = useState(DEFAULT_IMAGE);
  const [content, setContent] = useState({
    headline: 'NEW SEASON',
    subhead: 'Spring / Summer Collection 2026',
    cta: 'SHOP NOW',
    showOverlay: true,
    overlayOpacity: 30,
    textColor: '#ffffff',
    accentColor: '#000000',
    fontStyle: 'classic',
    layout: 'centered'
  });

  const [downloading, setDownloading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [caption, setCaption] = useState('');
  const [isCaptionLoading, setIsCaptionLoading] = useState(false);
  const [strategy, setStrategy] = useState(null);
  const [isStrategyLoading, setIsStrategyLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [magicCommand, setMagicCommand] = useState('');
  const [isMagicLoading, setIsMagicLoading] = useState(false);
  const [critique, setCritique] = useState(null);
  const [isCritiqueLoading, setIsCritiqueLoading] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState('en-US');
  const [defaultLocale, setDefaultLocale] = useState(null);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [recommendedOpen, setRecommendedOpen] = useState(false);
  const [recommendedLocales, setRecommendedLocales] = useState(RECOMMENDED_LOCALES);
  const [storeProfile, setStoreProfile] = useState(null);
  const [isStoreProfileLoading, setIsStoreProfileLoading] = useState(false);
  const [languageSearch, setLanguageSearch] = useState('');
  const [activeLanguage, setActiveLanguage] = useState('en');
  const [colorRecommendations, setColorRecommendations] = useState([]);
  const [isColorLoading, setIsColorLoading] = useState(false);
  const [imageFocus, setImageFocus] = useState({ x: 0.5, y: 0.5, subject: 'subject', confidence: 0 });
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [websiteError, setWebsiteError] = useState('');
  const [isWebsiteFetchLoading, setIsWebsiteFetchLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState(null);
  const [logoSettings, setLogoSettings] = useState({
    enabled: false,
    position: 'bottom-left',
    scale: 0.18,
    opacity: 1
  });

  const adRef = useRef(null);

  useEffect(() => {
    const link = document.createElement('link');
    link.href = "https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&family=Montserrat:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    script.async = true;
    document.body.appendChild(script);

    return () => {
      document.head.removeChild(link);
      document.body.removeChild(script);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadRecommendedLocales = async () => {
      try {
        const response = await fetch(withStore('/creative-studio/recommended-locales', store));
        const data = await response.json();
        if (!response.ok || !data?.success) return;

        const locales = (data.locales || []).map((locale, index) => {
          const label = LANGUAGE_OPTIONS
            .flatMap((option) => option.locales)
            .find((entry) => entry.value === locale.value)?.label || locale.label || locale.value;
          return {
            ...locale,
            label,
            rank: locale.rank || index + 1
          };
        });

        if (isMounted && locales.length > 0) {
          setRecommendedLocales(locales);
        }
      } catch (error) {
        console.error('Failed to load recommended locales:', error);
      }
    };

    loadRecommendedLocales();

    return () => {
      isMounted = false;
    };
  }, [store]);

  useEffect(() => {
    let isMounted = true;

    const loadStoreProfile = async () => {
      setIsStoreProfileLoading(true);
      try {
        const response = await fetch(withStore('/creative-studio/store-profile', store));
        const data = await response.json();
        if (response.ok && data?.success && isMounted) {
          setStoreProfile(data.profile);
        }
      } catch (error) {
        console.error('Failed to load store profile:', error);
      } finally {
        if (isMounted) {
          setIsStoreProfileLoading(false);
        }
      }
    };

    loadStoreProfile();

    return () => {
      isMounted = false;
    };
  }, [store]);

  useEffect(() => {
    if (storeProfile?.storeUrl && !websiteUrl) {
      setWebsiteUrl(storeProfile.storeUrl);
    }
    if (storeProfile?.logoUrl) {
      setLogoUrl(storeProfile.logoUrl);
    }
  }, [storeProfile, websiteUrl]);

  useEffect(() => {
    const storedDefault = window.localStorage.getItem(`creativeStudio.defaultLocale.${store ?? 'vironax'}`);
    if (storedDefault) {
      setDefaultLocale(storedDefault);
      setSelectedLocale(storedDefault);
      const match = LANGUAGE_OPTIONS.find((option) => option.locales.some((locale) => locale.value === storedDefault));
      if (match) {
        setActiveLanguage(match.id);
      }
      return;
    }

    const suggested = recommendedLocales[0]?.value;
    if (suggested) {
      setSelectedLocale(suggested);
      const match = LANGUAGE_OPTIONS.find((option) => option.locales.some((locale) => locale.value === suggested));
      if (match) {
        setActiveLanguage(match.id);
      }
    }
  }, [store, recommendedLocales]);

  const localeLabel = LANGUAGE_OPTIONS
    .flatMap((option) => option.locales)
    .find((locale) => locale.value === selectedLocale)?.label || selectedLocale;
  const defaultLocaleLabel = defaultLocale
    ? LANGUAGE_OPTIONS.flatMap((option) => option.locales)
      .find((locale) => locale.value === defaultLocale)?.label || defaultLocale
    : null;

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result);
        detectImageFocus(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const detectImageFocus = async (imageDataUrl) => {
    if (!imageDataUrl?.startsWith('data:image')) {
      setImageFocus({ x: 0.5, y: 0.5, subject: 'subject', confidence: 0 });
      return;
    }

    try {
      const imageBase64 = imageDataUrl.split(',')[1];
      const imageMime = imageDataUrl.split(';')[0].split(':')[1];

      const prompt = `Analyze the image and find the most important subject (face or product).\nReturn JSON with:\n- x (0-1) horizontal focal point\n- y (0-1) vertical focal point\n- subject (face | product | other)\n- confidence (0-1)\nOnly return JSON.`;

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: imageMime, data: imageBase64 } }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              x: { type: "NUMBER" },
              y: { type: "NUMBER" },
              subject: { type: "STRING" },
              confidence: { type: "NUMBER" }
            }
          }
        }
      };

      const data = await callGemini(payload);
      const result = JSON.parse(data.candidates[0].content.parts[0].text);
      const nextFocus = {
        x: typeof result.x === 'number' ? Math.min(Math.max(result.x, 0.05), 0.95) : 0.5,
        y: typeof result.y === 'number' ? Math.min(Math.max(result.y, 0.05), 0.95) : 0.5,
        subject: result.subject || 'subject',
        confidence: typeof result.confidence === 'number' ? result.confidence : 0
      };
      setImageFocus(nextFocus);
    } catch (error) {
      console.error('Image focus detection failed:', error);
      setImageFocus({ x: 0.5, y: 0.5, subject: 'subject', confidence: 0 });
    }
  };

  const updateContent = (key, value) => {
    setContent(prev => ({ ...prev, [key]: value }));
  };

  const handleLocaleSelect = (localeValue) => {
    setSelectedLocale(localeValue);
    const match = LANGUAGE_OPTIONS.find((option) => option.locales.some((locale) => locale.value === localeValue));
    if (match) {
      setActiveLanguage(match.id);
    }
    setLanguageMenuOpen(false);
  };

  const handleSetDefaultLocale = (localeValue) => {
    setDefaultLocale(localeValue);
    window.localStorage.setItem(`creativeStudio.defaultLocale.${store ?? 'vironax'}`, localeValue);
  };

  const handleWebsiteFetch = async () => {
    if (!websiteUrl.trim()) return;
    setWebsiteError('');
    setIsWebsiteFetchLoading(true);
    try {
      const response = await fetch(
        withStore(`/creative-studio/store-profile?store_url=${encodeURIComponent(websiteUrl.trim())}`, store)
      );
      const data = await response.json();
      if (response.ok && data?.success) {
        setStoreProfile(data.profile);
        setLogoUrl(data.profile?.logoUrl || null);
      } else {
        setWebsiteError(data?.error || 'Unable to fetch website details.');
      }
    } catch (error) {
      console.error('Website fetch failed:', error);
      setWebsiteError('Unable to fetch website details.');
    } finally {
      setIsWebsiteFetchLoading(false);
    }
  };

  const generateColorRecommendations = async () => {
    setIsColorLoading(true);
    try {
      let imageBase64 = null;
      let imageMime = null;
      if (image.startsWith('data:image')) {
        imageBase64 = image.split(',')[1];
        imageMime = image.split(';')[0].split(':')[1];
      }

      const prompt = `Analyze the ad image and suggest 3-4 premium on-creative text colors for legibility.
Return JSON array of { "color": "#hex", "reason": "short rationale" }.`;

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            ...(imageBase64 ? [{ inlineData: { mimeType: imageMime, data: imageBase64 } }] : [])
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                color: { type: "STRING" },
                reason: { type: "STRING" }
              }
            }
          }
        }
      };

      const data = await callGemini(payload);
      const result = JSON.parse(data.candidates[0].content.parts[0].text);
      setColorRecommendations(result);
    } catch (error) {
      console.error("Color recommendation failed:", error);
    } finally {
      setIsColorLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!window.html2canvas || !adRef.current) return;
    setDownloading(true);
    try {
      const canvas = await window.html2canvas(adRef.current, {
        useCORS: true,
        scale: 2,
        backgroundColor: null
      });
      const link = document.createElement('a');
      link.download = `virona-ad-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error("Export failed:", err);
      alert("Could not export image. Try uploading your own image!");
    }
    setDownloading(false);
  };

  const callGemini = async (payload, model = "gemini-2.5-flash-preview-09-2025") => {
    const response = await fetch(withStore('/creative-studio/gemini', store), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, model })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Gemini request failed');
    }
    if (data.error) {
      throw new Error(data.error.message || 'Gemini request failed');
    }
    return data;
  };

  const generateAdConcept = async () => {
    setIsAiLoading(true);
    try {
      let imageBase64 = null;
      let imageMime = null;
      if (image.startsWith('data:image')) {
        imageBase64 = image.split(',')[1];
        imageMime = image.split(';')[0].split(':')[1];
      }

      const profileSummary = storeProfile?.summary || {};
      const brandLine = profileSummary.summary || storeProfile?.storeUrl || store;

      const prompt = `${ON_CREATIVE_SYSTEM_PROMPT}

LOCALE REQUEST
- Requested locale: ${selectedLocale} (${localeLabel})

INPUT CONTEXT
- Brand: ${brandLine}
- Brand tone: ${profileSummary.tone || 'Luxury, Editorial, Timeless'}
- Language style: ${profileSummary.languageStyle || 'Premium, modern'}
- Product types: ${(profileSummary.productTypes || []).join(', ') || 'Fashion, accessories'}
- Target audience: ${profileSummary.targetAudience || 'Luxury fashion shoppers'}
- Price positioning: ${profileSummary.pricePositioning || 'Premium'}
- Keywords: ${(profileSummary.keywords || []).join(', ') || 'Luxury, modern, timeless'}
- Vibe request: ${aiPrompt || 'Luxury, Editorial, Timeless'}
- Existing copy (if any): ${JSON.stringify({ headline: content.headline, subhead: content.subhead, cta: content.cta })}

Return a JSON object with keys: headline, subhead, cta, accentColor, textColor.`;

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            ...(imageBase64 ? [{ inlineData: { mimeType: imageMime, data: imageBase64 } }] : [])
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              headline: { type: "STRING" },
              subhead: { type: "STRING" },
              cta: { type: "STRING" },
              accentColor: { type: "STRING" },
              textColor: { type: "STRING" }
            }
          }
        }
      };

      const data = await callGemini(payload);
      const result = JSON.parse(data.candidates[0].content.parts[0].text);

      setContent(prev => ({
        ...prev,
        headline: result.headline || prev.headline,
        subhead: result.subhead || prev.subhead,
        cta: result.cta || prev.cta || 'Shop Now',
        accentColor: result.accentColor || prev.accentColor,
        textColor: result.textColor || prev.textColor
      }));
    } catch (error) {
      console.error("AI Generation failed:", error);
      alert("AI Generation failed. Please try again.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const translateContent = async (localeValue) => {
    setIsAiLoading(true);
    try {
      const selectedLabel = LANGUAGE_OPTIONS
        .flatMap((option) => option.locales)
        .find((locale) => locale.value === localeValue)?.label || localeValue;

      let imageBase64 = null;
      let imageMime = null;
      if (image.startsWith('data:image')) {
        imageBase64 = image.split(',')[1];
        imageMime = image.split(';')[0].split(':')[1];
      }

      const prompt = `${ON_CREATIVE_SYSTEM_PROMPT}

LOCALE REQUEST
- Requested locale: ${localeValue} (${selectedLabel})

INPUT COPY JSON
${JSON.stringify({ headline: content.headline, subhead: content.subhead, cta: content.cta })}

Return JSON with the same keys (headline, subhead, cta).`;

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            ...(imageBase64 ? [{ inlineData: { mimeType: imageMime, data: imageBase64 } }] : [])
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              headline: { type: "STRING" },
              subhead: { type: "STRING" },
              cta: { type: "STRING" }
            }
          }
        }
      };

      const data = await callGemini(payload);
      const result = JSON.parse(data.candidates[0].content.parts[0].text);

      setContent(prev => ({
        ...prev,
        headline: result.headline || prev.headline,
        subhead: result.subhead || prev.subhead,
        cta: result.cta || prev.cta || 'Shop Now'
      }));
    } catch (error) {
      console.error("Translation failed:", error);
    } finally {
      setIsAiLoading(false);
    }
  };

  const generateCaption = async () => {
    setIsCaptionLoading(true);
    try {
      const prompt = `Write a short, engaging Instagram caption for a luxury fashion brand post.
      Ad Headline: "${content.headline}"
      Ad Subhead: "${content.subhead}"
      Vibe: High-fashion, elegant, minimal.
      Include 5-7 relevant hashtags.
      Do not use emojis unless they are very minimal (like ✨ or 🤍).`;

      const payload = { contents: [{ parts: [{ text: prompt }] }] };
      const data = await callGemini(payload);
      setCaption(data.candidates[0].content.parts[0].text);
    } catch (error) {
      console.error("Caption failed:", error);
    } finally {
      setIsCaptionLoading(false);
    }
  };

  const generateVoiceover = async () => {
    setIsAudioLoading(true);
    try {
      const textToSay = `Virona. ${content.headline}. ${content.subhead}. ${content.cta}.`;

      const payload = {
        contents: [{ parts: [{ text: textToSay }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Kore"
              }
            }
          }
        }
      };

      const data = await callGemini(payload, "gemini-2.5-flash-preview-tts");

      const base64Audio = data.candidates[0].content.parts[0].inlineData.data;
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const wavBuffer = addWavHeader(bytes.buffer, 24000);
      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (error) {
      console.error("TTS failed:", error);
      alert("Voiceover generation failed. Please try again.");
    } finally {
      setIsAudioLoading(false);
    }
  };

  const generateStrategy = async () => {
    setIsStrategyLoading(true);
    try {
      const prompt = `Create a 3-phase mini launch strategy for this fashion ad.
      Product: ${content.headline} - ${content.subhead}.
      Format as JSON list with keys: phase, title, concept.
      Phases: Teaser, Launch, Sustain.
      Keep concepts one sentence, very high-fashion and mysterious.`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                phase: { type: "STRING" },
                title: { type: "STRING" },
                concept: { type: "STRING" }
              }
            }
          }
        }
      };

      const data = await callGemini(payload);
      const result = JSON.parse(data.candidates[0].content.parts[0].text);
      setStrategy(result);
    } catch (error) {
      console.error("Strategy failed:", error);
    } finally {
      setIsStrategyLoading(false);
    }
  };

  const handleMagicEdit = async () => {
    if (!magicCommand.trim()) return;
    setIsMagicLoading(true);
    try {
      const prompt = `You are a state manager for a fashion ad editor.
      Current State JSON: ${JSON.stringify(content)}.
      User Instruction: "${magicCommand}".
      Available layouts: 'centered', 'split', 'framed'.
      Available fontStyles: 'classic' (serif), 'modern' (sans), 'minimal' (thin).
      
      Return a JSON object with ONLY the keys that need to change to satisfy the instruction. 
      For example, if user says "Make it dark mode", return { "textColor": "#ffffff", "accentColor": "#000000" } (if split layout) or similar.
      Do not change text content unless explicitly asked.`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              headline: { type: "STRING" },
              subhead: { type: "STRING" },
              cta: { type: "STRING" },
              showOverlay: { type: "BOOLEAN" },
              overlayOpacity: { type: "NUMBER" },
              textColor: { type: "STRING" },
              accentColor: { type: "STRING" },
              fontStyle: { type: "STRING" },
              layout: { type: "STRING" }
            }
          }
        }
      };

      const data = await callGemini(payload);
      const changes = JSON.parse(data.candidates[0].content.parts[0].text);
      setContent(prev => ({ ...prev, ...changes }));
      setMagicCommand('');
    } catch (error) {
      console.error("Magic Edit failed:", error);
      alert("Could not process command.");
    } finally {
      setIsMagicLoading(false);
    }
  };

  const generateCritique = async () => {
    setIsCritiqueLoading(true);
    try {
      let imageBase64 = null;
      let imageMime = null;
      if (image.startsWith('data:image')) {
        imageBase64 = image.split(',')[1];
        imageMime = image.split(';')[0].split(':')[1];
      }

      const prompt = `Analyze this fashion ad design. 
      Headline: "${content.headline}". 
      Subhead: "${content.subhead}". 
      Layout: ${content.layout}.
      Colors: Text ${content.textColor}, Accent ${content.accentColor}.
      
      Rate "Luxury" (0-100) and "Impact" (0-100).
      Provide a 1-sentence constructive critique on how to improve it.
      Return JSON.`;

      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            ...(imageBase64 ? [{ inlineData: { mimeType: imageMime, data: imageBase64 } }] : [])
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              luxuryScore: { type: "NUMBER" },
              impactScore: { type: "NUMBER" },
              feedback: { type: "STRING" }
            }
          }
        }
      };

      const data = await callGemini(payload);
      const result = JSON.parse(data.candidates[0].content.parts[0].text);
      setCritique(result);
    } catch (error) {
      console.error("Critique failed:", error);
    } finally {
      setIsCritiqueLoading(false);
    }
  };

  const getDimensions = () => {
    switch (format) {
      case 'story':
        return { width: 360, height: 640 };
      case 'landscape':
        return { width: 600, height: 338 };
      case 'square':
      default:
        return { width: 500, height: 500 };
    }
  };
  const dims = getDimensions();

  const renderLayout = () => {
    const commonTextStyles = {
      fontFamily: fonts[content.fontStyle],
      color: content.textColor,
      textShadow: content.showOverlay ? '0 2px 10px rgba(0,0,0,0.3)' : 'none'
    };

    const resolvedCta = content.cta?.trim() || 'Shop Now';
    const imagePosition = `${Math.round(imageFocus.x * 100)}% ${Math.round(imageFocus.y * 100)}%`;

    const CTA = (
      <div
        className="mt-6 px-6 py-2.5 text-sm tracking-widest uppercase font-medium border transition-colors inline-block cursor-default"
        style={{ borderColor: content.textColor, color: content.textColor, fontFamily: fonts.modern }}
      >
        {resolvedCta}
      </div>
    );

    const logoPlacement = {
      'top-left': 'top-4 left-4',
      'top-right': 'top-4 right-4',
      'bottom-left': 'bottom-4 left-4',
      'bottom-right': 'bottom-4 right-4',
      center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
    };

    const LogoLayer = () => {
      if (!logoSettings.enabled || !logoUrl) return null;
      const size = Math.max(40, Math.round(dims.width * logoSettings.scale));
      return (
        <div className={`absolute ${logoPlacement[logoSettings.position] || logoPlacement['bottom-left']} z-20 pointer-events-none`}>
          <img
            src={logoUrl}
            alt="Brand logo"
            className="object-contain"
            style={{ width: `${size}px`, opacity: logoSettings.opacity, backgroundColor: 'transparent' }}
            crossOrigin="anonymous"
          />
        </div>
      );
    };

    const BackgroundLayer = () => (
      <div className="absolute inset-0 w-full h-full overflow-hidden">
        <img
          src={image}
          alt="Bg"
          className="w-full h-full object-cover"
          style={{ objectPosition: imagePosition }}
          crossOrigin="anonymous"
          key={image}
        />
        {content.showOverlay && (
          <div className="absolute inset-0 bg-black transition-opacity" style={{ opacity: content.overlayOpacity / 100 }} />
        )}
      </div>
    );

    switch (content.layout) {
      case 'split':
        return (
          <div className="w-full h-full flex flex-col bg-white relative">
            <div className="h-2/3 relative overflow-hidden">
              <img
                src={image}
                className="w-full h-full object-cover"
                style={{ objectPosition: imagePosition }}
                crossOrigin="anonymous"
                alt="Product"
                key={image}
              />
            </div>
            <div className="h-1/3 flex flex-col items-center justify-center p-6 text-center" style={{ backgroundColor: content.accentColor }}>
              <h2 className="text-3xl mb-2" style={{ fontFamily: fonts[content.fontStyle], color: '#fff' }}>{content.headline}</h2>
              <p className="text-xs uppercase tracking-widest opacity-90" style={{ fontFamily: fonts.modern, color: '#fff' }}>{content.subhead}</p>
              <div className="mt-4 px-6 py-2 bg-white text-black text-xs font-bold uppercase tracking-widest">{resolvedCta}</div>
            </div>
            <LogoLayer />
          </div>
        );
      case 'framed':
        return (
          <div className="w-full h-full p-6 relative bg-white flex items-center justify-center">
            <div className="relative w-full h-full border border-gray-200 flex flex-col">
              <div className="flex-1 relative overflow-hidden">
                <img
                  src={image}
                  className="w-full h-full object-cover"
                  style={{ objectPosition: imagePosition }}
                  crossOrigin="anonymous"
                  alt="Product"
                  key={image}
                />
                {content.showOverlay && <div className="absolute inset-0 bg-black/20" />}
              </div>
              <div className="h-auto py-6 bg-white flex flex-col items-center justify-center text-center z-10">
                <h2 className="text-2xl mb-1 text-black" style={{ fontFamily: fonts[content.fontStyle] }}>{content.headline}</h2>
                <p className="text-xs text-gray-500 uppercase tracking-widest mb-3" style={{ fontFamily: fonts.modern }}>{content.subhead}</p>
                <div className="text-xs border-b border-black pb-0.5 uppercase tracking-wider font-semibold">{resolvedCta}</div>
              </div>
            </div>
            <LogoLayer />
          </div>
        );
      case 'centered':
      default:
        return (
          <div className="w-full h-full relative flex flex-col items-center justify-center text-center p-8">
            <BackgroundLayer />
            <div className="relative z-10 max-w-md">
              <p className="mb-3 text-xs md:text-sm uppercase tracking-[0.2em]" style={commonTextStyles}>{content.subhead}</p>
              <h1 className="text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight" style={{ ...commonTextStyles, fontStyle: 'italic' }}>{content.headline}</h1>
              {CTA}
            </div>
            <LogoLayer />
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-800 font-sans flex flex-col md:flex-row">
      <div className="w-full md:w-96 bg-white border-r border-neutral-200 h-screen overflow-y-auto shadow-xl z-20 flex flex-col scrollbar-thin scrollbar-thumb-neutral-200">
        <div className="p-6 border-b border-neutral-100 bg-white sticky top-0 z-10">
          <h1 className="text-xl font-serif italic font-bold tracking-wide text-black">Virona <span className="text-neutral-400 not-italic font-sans text-xs ml-2 font-normal">AD STUDIO</span></h1>
        </div>

        <div className="p-6 space-y-8 flex-1">
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-4 rounded-lg border border-indigo-100 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-800">
              <Sparkles size={14} className="text-indigo-600" /> AI Creative Director
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Vibe: e.g. Minimalist, Bold..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="flex-1 text-xs p-2 border border-indigo-200 rounded focus:border-indigo-400 outline-none bg-white"
              />
            </div>
            <button
              onClick={generateAdConcept}
              disabled={isAiLoading}
              className="w-full py-2 bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
            >
              {isAiLoading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {isAiLoading ? 'Designing...' : 'Magic Auto-Fill'}
            </button>

            <div className="pt-2 border-t border-indigo-100 mt-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Or ask: 'Make it dark mode', 'Change layout'..."
                  value={magicCommand}
                  onChange={(e) => setMagicCommand(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleMagicEdit()}
                  className="flex-1 text-xs p-2 border border-indigo-200 rounded focus:border-indigo-400 outline-none bg-white placeholder:text-indigo-300"
                />
                <button
                  onClick={handleMagicEdit}
                  disabled={isMagicLoading || !magicCommand}
                  className="p-2 bg-white border border-indigo-200 text-indigo-600 rounded hover:bg-indigo-50 disabled:opacity-50"
                >
                  {isMagicLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4 border-t border-neutral-100 pt-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
              <Globe size={14} /> Website Snapshot
            </div>
            <div className="space-y-3">
              <div className="text-[11px] text-neutral-500">Preview what the editor would capture from a storefront.</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://storefront.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  className="flex-1 text-xs p-2 border border-neutral-300 rounded focus:border-black outline-none bg-white"
                />
                <button
                  type="button"
                  onClick={handleWebsiteFetch}
                  disabled={isWebsiteFetchLoading || !websiteUrl.trim()}
                  className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold bg-black text-white rounded disabled:opacity-50"
                >
                  {isWebsiteFetchLoading ? 'Fetching...' : 'Fetch'}
                </button>
              </div>
              {websiteError && <div className="text-[10px] text-red-500">{websiteError}</div>}
              {isStoreProfileLoading && !storeProfile && (
                <div className="text-[10px] text-neutral-400">Loading store profile...</div>
              )}
              {storeProfile && (
                <div className="space-y-3 bg-white p-3 rounded border border-neutral-200 shadow-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-neutral-400">Summary</div>
                    <p className="text-[11px] text-neutral-600 mt-1">
                      {storeProfile.summary?.summary || 'No summary available yet.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] text-neutral-500">
                    <span className="px-2 py-1 rounded-full bg-neutral-100">Tone: {storeProfile.summary?.tone || '—'}</span>
                    <span className="px-2 py-1 rounded-full bg-neutral-100">Style: {storeProfile.summary?.languageStyle || '—'}</span>
                    <span className="px-2 py-1 rounded-full bg-neutral-100">Positioning: {storeProfile.summary?.pricePositioning || '—'}</span>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-neutral-400">Keywords</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(storeProfile.summary?.keywords || []).slice(0, 6).map((keyword) => (
                        <span
                          key={keyword}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-200 text-neutral-500"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 border-t border-neutral-100 pt-3">
                    <div className="w-12 h-12 border border-neutral-200 rounded bg-white flex items-center justify-center overflow-hidden">
                      {logoUrl ? (
                        <img src={logoUrl} alt="Fetched logo" className="w-full h-full object-contain" style={{ backgroundColor: 'transparent' }} />
                      ) : (
                        <span className="text-[9px] text-neutral-300 uppercase">Logo</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-[10px] font-bold text-neutral-600">Logo (transparent)</div>
                      <button
                        type="button"
                        onClick={() => setLogoSettings((prev) => ({ ...prev, enabled: !prev.enabled }))}
                        disabled={!logoUrl}
                        className="mt-1 text-[10px] uppercase tracking-widest font-bold text-black disabled:text-neutral-300"
                      >
                        {logoSettings.enabled ? 'Remove from canvas' : 'Place on canvas'}
                      </button>
                    </div>
                  </div>
                  {logoSettings.enabled && (
                    <div className="space-y-3 border-t border-neutral-100 pt-3">
                      <div className="flex items-center justify-between text-[10px] text-neutral-500">
                        <span>Logo size</span>
                        <span>{Math.round(logoSettings.scale * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="0.35"
                        step="0.01"
                        value={logoSettings.scale}
                        onChange={(e) => setLogoSettings((prev) => ({ ...prev, scale: Number(e.target.value) }))}
                        className="w-full h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-black"
                      />
                      <div className="flex items-center justify-between text-[10px] text-neutral-500">
                        <span>Opacity</span>
                        <span>{Math.round(logoSettings.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.3"
                        max="1"
                        step="0.05"
                        value={logoSettings.opacity}
                        onChange={(e) => setLogoSettings((prev) => ({ ...prev, opacity: Number(e.target.value) }))}
                        className="w-full h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-black"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-neutral-500">Position</span>
                        <select
                          value={logoSettings.position}
                          onChange={(e) => setLogoSettings((prev) => ({ ...prev, position: e.target.value }))}
                          className="text-[10px] border border-neutral-200 rounded px-2 py-1 bg-white"
                        >
                          <option value="top-left">Top left</option>
                          <option value="top-right">Top right</option>
                          <option value="bottom-left">Bottom left</option>
                          <option value="bottom-right">Bottom right</option>
                          <option value="center">Center</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'square', icon: <Layout size={16} />, label: 'Post' },
                { id: 'story', icon: <Smartphone size={16} />, label: 'Story' },
                { id: 'landscape', icon: <Monitor size={16} />, label: 'Banner' }
              ].map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => setFormat(fmt.id)}
                  className={`flex flex-col items-center justify-center p-2 rounded border transition-all ${
                    format === fmt.id ? 'border-black bg-neutral-50 text-black' : 'border-neutral-200 text-neutral-500'
                  }`}
                >
                  {fmt.icon}
                  <span className="text-[10px] mt-1 font-medium">{fmt.label}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {['centered', 'split', 'framed'].map(l => (
                <button
                  key={l}
                  onClick={() => updateContent('layout', l)}
                  className={`flex-1 py-1.5 text-[10px] uppercase tracking-wide border ${content.layout === l ? 'bg-black text-white border-black' : 'bg-white text-neutral-600 border-neutral-200'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 border-t border-neutral-100 pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
                <Type size={14} /> Content & Audio
              </div>
              <button
                onClick={() => translateContent(selectedLocale)}
                disabled={isAiLoading}
                className="text-[10px] font-bold text-neutral-500 hover:text-black px-2 py-1 rounded border border-neutral-200 bg-white"
              >
                {isAiLoading ? 'Translating...' : 'Translate'}
              </button>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setLanguageMenuOpen((prev) => !prev)}
                    className="flex items-center gap-2 px-3 py-1.5 text-[11px] border border-neutral-200 rounded-full bg-white text-neutral-700"
                  >
                    <Languages size={12} />
                    <span>Language: {localeLabel}</span>
                    <ChevronDown size={12} className={`transition-transform ${languageMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {languageMenuOpen && (
                    <div className="absolute left-0 mt-2 w-72 rounded-lg border border-neutral-200 bg-white shadow-lg p-3 z-20">
                      <input
                        type="text"
                        placeholder="Search languages"
                        value={languageSearch}
                        onChange={(e) => setLanguageSearch(e.target.value)}
                        className="w-full mb-2 px-2 py-1 text-xs border border-neutral-200 rounded"
                      />
                      <div className="flex flex-wrap gap-1 mb-3">
                        {LANGUAGE_OPTIONS.filter((option) => option.label.toLowerCase().includes(languageSearch.toLowerCase()))
                          .map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setActiveLanguage(option.id)}
                              className={`px-2 py-1 text-[10px] rounded-full border ${activeLanguage === option.id ? 'bg-black text-white border-black' : 'border-neutral-200 text-neutral-600'}`}
                            >
                              {option.label}
                            </button>
                          ))}
                      </div>
                      <div className="space-y-1">
                        {LANGUAGE_OPTIONS.find((option) => option.id === activeLanguage)?.locales
                          .filter((locale) => locale.label.toLowerCase().includes(languageSearch.toLowerCase()))
                          .map((locale) => (
                            <button
                              key={locale.value}
                              type="button"
                              onClick={() => handleLocaleSelect(locale.value)}
                              className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs ${selectedLocale === locale.value ? 'bg-violet-50 text-violet-700' : 'hover:bg-neutral-50'}`}
                            >
                              <span>{locale.label}</span>
                              {selectedLocale === locale.value && <Check size={12} />}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setRecommendedOpen((prev) => !prev)}
                  className="flex items-center gap-2 px-3 py-1.5 text-[11px] border border-neutral-200 rounded-full bg-neutral-50 text-neutral-600"
                >
                  Recommended
                  <ChevronDown size={12} className={`transition-transform ${recommendedOpen ? 'rotate-180' : ''}`} />
                </button>
                <span className="text-[10px] text-neutral-400">Based on your top customer demographics</span>
                {defaultLocaleLabel && (
                  <span className="text-[10px] text-neutral-400">Default: {defaultLocaleLabel}</span>
                )}
              </div>
              {recommendedOpen && (
                <div className="flex flex-wrap gap-2 bg-neutral-50 border border-neutral-200 rounded-lg p-3">
                  {recommendedLocales.map((locale) => (
                    <div key={locale.value} className="flex items-center gap-2 px-2 py-1 rounded-full border border-neutral-200 bg-white text-[10px]">
                      <button
                        type="button"
                        onClick={() => handleLocaleSelect(locale.value)}
                        className="text-neutral-700 hover:text-black"
                      >
                        {locale.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetDefaultLocale(locale.value)}
                        className="text-[9px] uppercase tracking-widest text-violet-600"
                      >
                        Use as default
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input type="text" value={content.headline} onChange={(e) => updateContent('headline', e.target.value)} className="w-full p-2 border border-neutral-300 rounded focus:border-black outline-none font-serif text-lg" placeholder="Headline" />
              <input type="text" value={content.subhead} onChange={(e) => updateContent('subhead', e.target.value)} className="w-full p-2 border border-neutral-300 rounded focus:border-black outline-none text-sm" placeholder="Subhead" />
              <input type="text" value={content.cta} onChange={(e) => updateContent('cta', e.target.value)} className="w-full p-2 border border-neutral-300 rounded focus:border-black outline-none text-sm font-medium uppercase" placeholder="CTA" />
            </div>

            <div className="bg-neutral-50 p-3 rounded border border-neutral-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={generateVoiceover}
                  disabled={isAudioLoading}
                  className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-full hover:bg-neutral-800 transition-colors"
                >
                  {isAudioLoading ? <Loader2 size={14} className="animate-spin" /> : <Mic size={14} />}
                </button>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-neutral-700">Voiceover</span>
                  <span className="text-[10px] text-neutral-400">Preview with "Kore"</span>
                </div>
              </div>
              {audioUrl && (
                <audio controls src={audioUrl} className="h-8 w-24" style={{ height: '30px' }} />
              )}
            </div>
          </div>

          <div className="space-y-4 border-t border-neutral-100 pt-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
              <Briefcase size={14} /> Marketing Kit
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white p-3 rounded border border-neutral-200 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold uppercase text-neutral-500 flex items-center gap-1"><MessageSquare size={10} /> Social</span>
                  <button onClick={generateCaption} disabled={isCaptionLoading} className="text-blue-600 hover:text-blue-800"><Sparkles size={12} /></button>
                </div>
                {caption ? (
                  <div className="text-[10px] text-neutral-600 leading-snug h-16 overflow-y-auto scrollbar-none border-t pt-2 border-neutral-100">
                    {caption}
                  </div>
                ) : <div className="h-16 flex items-center justify-center text-[9px] text-neutral-300 italic">Generate a caption...</div>}
              </div>

              <div className="bg-white p-3 rounded border border-neutral-200 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold uppercase text-neutral-500 flex items-center gap-1"><Activity size={10} /> Critique</span>
                  <button onClick={generateCritique} disabled={isCritiqueLoading} className="text-orange-600 hover:text-orange-800"><Star size={12} /></button>
                </div>
                {critique ? (
                  <div className="text-[9px] h-16 overflow-y-auto scrollbar-none space-y-2 border-t pt-2 border-neutral-100">
                    <div className="flex justify-between">
                      <span className="font-bold text-neutral-800">Luxury: {critique.luxuryScore}/100</span>
                      <span className="font-bold text-neutral-800">Impact: {critique.impactScore}/100</span>
                    </div>
                    <p className="text-neutral-500 italic leading-snug">{critique.feedback}</p>
                  </div>
                ) : <div className="h-16 flex items-center justify-center text-[9px] text-neutral-300 italic">Get AI Design Review...</div>}
              </div>
            </div>

            <div className="bg-white p-3 rounded border border-neutral-200 shadow-sm">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-bold uppercase text-neutral-500 flex items-center gap-1"><Calendar size={10} /> Rollout Plan</span>
                <button onClick={generateStrategy} disabled={isStrategyLoading} className="text-purple-600 hover:text-purple-800"><Sparkles size={12} /></button>
              </div>
              {strategy ? (
                <div className="text-[9px] overflow-y-auto scrollbar-none space-y-1 border-t pt-2 border-neutral-100">
                  {strategy.map((s, i) => (
                    <div key={i}><span className="font-bold text-neutral-800">{s.phase}:</span> <span className="text-neutral-500">{s.concept}</span></div>
                  ))}
                </div>
              ) : <div className="text-[9px] text-neutral-300 italic">Generate a 3-phase launch strategy...</div>}
            </div>
          </div>

          <div className="space-y-4 border-t border-neutral-100 pt-6">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
              <ImageIcon size={14} /> Visuals
            </div>
            <div className="relative group">
              <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className="w-full h-24 border-2 border-dashed border-neutral-300 rounded flex flex-col items-center justify-center text-neutral-400 group-hover:border-neutral-400 group-hover:bg-neutral-50 transition-colors">
                <ImageIcon className="mb-2" size={16} />
                <span className="text-[10px] uppercase font-medium">Upload Image</span>
              </div>
            </div>
            {content.layout !== 'framed' && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-500">Overlay</span>
                <input type="range" min="0" max="80" value={content.overlayOpacity} onChange={(e) => updateContent('overlayOpacity', e.target.value)} className="w-24 h-1 bg-neutral-200 rounded-lg appearance-none cursor-pointer accent-black" />
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-neutral-500">Colors</span>
              <div className="flex gap-2">
                {['#ffffff', '#000000', '#f5f5dc', content.accentColor].map((c, i) => (
                  <button key={i} onClick={() => updateContent('textColor', c)} className={`w-5 h-5 rounded-full border border-neutral-200 shadow-sm ${content.textColor === c ? 'ring-1 ring-offset-1 ring-black' : ''}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-neutral-500">Recommended</span>
              <button
                onClick={generateColorRecommendations}
                disabled={isColorLoading}
                className="text-[10px] font-bold text-neutral-500 hover:text-black px-2 py-1 rounded border border-neutral-200 bg-white"
              >
                {isColorLoading ? 'Analyzing...' : 'Get Suggestions'}
              </button>
            </div>
            {colorRecommendations.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {colorRecommendations.map((rec) => (
                  <button
                    key={rec.color}
                    onClick={() => updateContent('textColor', rec.color)}
                    className="flex items-center gap-2 px-2 py-1 rounded-full border border-neutral-200 bg-white text-[10px]"
                  >
                    <span className="w-3 h-3 rounded-full border border-neutral-200" style={{ backgroundColor: rec.color }} />
                    <span className="text-neutral-600">{rec.color}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-6 border-t border-neutral-200 bg-neutral-50 sticky bottom-0">
          <button onClick={handleDownload} disabled={downloading} className="w-full py-3 bg-black text-white hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2 uppercase tracking-widest text-sm font-medium">
            {downloading ? <span>Processing...</span> : <><Download size={18} /> Export Ad</>}
          </button>
        </div>
      </div>

      <div className="flex-1 bg-neutral-200 flex items-center justify-center p-8 overflow-hidden relative">
        <div className="absolute top-4 left-4 text-xs font-mono text-neutral-500 opacity-50 pointer-events-none uppercase">Live Preview Canvas</div>
        <div
          className="shadow-2xl transition-all duration-500 ease-in-out bg-white relative"
          ref={adRef}
          style={{
            width: `${dims.width}px`,
            height: `${dims.height}px`,
            transform: 'scale(min(1, calc(100vw - 450px) / 600))',
            transformOrigin: 'center center'
          }}
        >
          {renderLayout()}
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
  const [error, setError] = useState(null);
  const [previewVersion, setPreviewVersion] = useState(null);
  const fileInputRef = useRef(null);

  const resolveVersionUrl = (version) => (
    version?.url ||
    version?.downloadUrl ||
    version?.download_url ||
    version?.source_url ||
    null
  );

  const resolveThumbnailUrl = (version) => {
    const directThumb = version?.thumbnail || version?.thumbnail_url || version?.thumbnailUrl;
    if (directThumb) return directThumb;

    const baseUrl = resolveVersionUrl(version);
    if (!baseUrl) return null;

    const [path, query] = baseUrl.split('?');
    const thumbnailPath = path
      .replace('/upload/', '/upload/so_0/')
      .replace(/\.\w+$/, '.jpg');
    return query ? `${thumbnailPath}?${query}` : thumbnailPath;
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
    } catch (error) {
      console.warn('Direct download failed, falling back to proxy.', error);
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

  const handleVideoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError(null);
    setVideo(file);
    setVideoUrl(URL.createObjectURL(file));
    setVersions(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('video', file);

      const response = await fetch(withStore('/creative-studio/video/upload', store), {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setVideoInfo(data);
      } else {
        setVideoInfo(null);
        setError(data?.error || 'Video upload failed. Please try again.');
      }
    } catch (error) {
      console.error('Video upload failed:', error);
      setVideoInfo(null);
      setError('Video upload failed. Please try again.');
    }
    setUploading(false);
  };

  const handleResize = async () => {
    if (!videoInfo?.video_id) return;

    setError(null);
    setProcessing(true);
    try {
      const response = await fetch(withStore('/creative-studio/video/resize', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoInfo.video_id,
          smart_crop: smartCrop
        })
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setVersions(data.versions);
      } else {
        setError(data?.error || 'Video resize failed. Please try again.');
      }
    } catch (error) {
      console.error('Video resize failed:', error);
      setError('Video resize failed. Please try again.');
    }
    setProcessing(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 rounded-3xl border border-white/60 bg-gradient-to-br from-white via-violet-50/40 to-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Video Resizer</h2>
        <p className="text-gray-500">Upload a video and get all Meta ad dimensions with AI smart crop</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
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
              className="w-full h-48 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:border-violet-400 hover:bg-violet-50 transition-all duration-300"
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

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Smart Crop Toggle */}
          <label className="flex items-center justify-between mt-4 p-3 bg-gray-50 rounded-lg cursor-pointer transition-all duration-300 hover:bg-gray-100">
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
            className="w-full mt-4 py-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-all duration-300 hover:from-violet-700 hover:to-purple-700 hover:shadow-lg disabled:opacity-50"
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
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
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
                  className="group flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-white hover:shadow-sm cursor-pointer transition-all duration-300"
                  onClick={() => setPreviewVersion(version)}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {resolveThumbnailUrl(version) ? (
                        <img
                          src={resolveThumbnailUrl(version)}
                          alt={version.name}
                          className="w-16 h-10 object-cover rounded bg-gray-200"
                        />
                      ) : (
                        <div className="w-16 h-10 rounded bg-gradient-to-br from-violet-200 to-purple-200 flex items-center justify-center">
                          <Film size={16} className="text-violet-700" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <Play size={16} className="text-white" />
                      </div>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 text-sm">{version.name.replace('_', ' ')}</p>
                      <p className="text-xs text-gray-500">{version.width}×{version.height} ({version.ratio})</p>
                    </div>
                  </div>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      triggerDownload(version);
                    }}
                    className="px-3 py-1.5 bg-violet-100 text-violet-700 text-xs font-medium rounded-lg transition-all duration-300 hover:bg-violet-200 hover:shadow-sm"
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {previewVersion && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewVersion(null)}
        >
          <div
            className="bg-white rounded-2xl overflow-hidden max-w-2xl w-full"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{previewVersion.name.replace('_', ' ')}</h3>
                <p className="text-sm text-gray-500">{previewVersion.width}×{previewVersion.height}</p>
              </div>
              <button
                onClick={() => setPreviewVersion(null)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X size={20} />
              </button>
            </div>
            <div className="bg-black flex items-center justify-center" style={{ maxHeight: '70vh' }}>
              <video
                src={previewVersion.url}
                controls
                autoPlay
                className="max-h-[70vh]"
                style={{
                  aspectRatio: `${previewVersion.width}/${previewVersion.height}`
                }}
              />
            </div>
            <div className="p-4 flex justify-end gap-3">
              <button
                onClick={() => setPreviewVersion(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Close
              </button>
              <button
                onClick={() => triggerDownload(previewVersion)}
                className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 flex items-center gap-2 transition-all duration-300 hover:shadow-lg"
              >
                <Download size={16} />
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPETITOR SPY
// ============================================================================
function CompetitorSpy({ store, onGenerateBrief }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [country, setCountry] = useState('SA');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedAd, setSelectedAd] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [countries, setCountries] = useState({});
  const [metaStatus, setMetaStatus] = useState(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Load countries
  useEffect(() => {
    fetch(withStore('/creative-studio/competitor/countries', store))
      .then(res => res.json())
      .then(data => {
        if (data.success) setCountries(data.countries);
      });
  }, [store]);

  const fetchMetaStatus = useCallback(async () => {
    try {
      setMetaLoading(true);
      const response = await fetch('/api/auth/meta/status');
      const data = await response.json();
      setMetaStatus(data);
    } catch (error) {
      console.error('Meta auth status failed:', error);
      setMetaStatus({ connected: false });
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetaStatus();
  }, [fetchMetaStatus]);

  const handleConnect = () => {
    window.location.assign('/api/auth/meta/start');
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/meta/disconnect', { method: 'POST' });
      await fetchMetaStatus();
    } catch (error) {
      console.error('Meta disconnect failed:', error);
    }
  };

  const handleCopyToken = async () => {
    if (!metaStatus?.token) return;
    try {
      await navigator.clipboard.writeText(metaStatus.token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 1500);
    } catch (error) {
      console.error('Copy token failed:', error);
    }
  };

  const formatDate = (value) => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString();
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setResults([]);
    setSelectedAd(null);
    setAnalysis(null);

    try {
      const response = await fetch(
        withStore(`/creative-studio/competitor/search?brand_name=${encodeURIComponent(searchQuery)}&country=${country}`, store)
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
      const response = await fetch(withStore('/creative-studio/competitor/analyze', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot_url: ad.snapshot_url,
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

      {/* Meta Connection Panel */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Meta Connection</h3>
            <p className="text-sm text-gray-500">Connect a user token to power Ad Library searches.</p>
          </div>
          <div className="flex items-center gap-3">
            {metaLoading ? (
              <span className="text-sm text-gray-400">Checking status...</span>
            ) : metaStatus?.connected ? (
              <span className="inline-flex items-center gap-2 text-sm font-medium text-green-700 bg-green-50 px-3 py-1 rounded-full">
                <CheckCircle size={16} /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-700 bg-amber-50 px-3 py-1 rounded-full">
                <AlertTriangle size={16} /> Not connected
              </span>
            )}

            {metaStatus?.connected ? (
              <>
                <button
                  onClick={handleConnect}
                  className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-all"
                >
                  Reconnect
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-all"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={handleConnect}
                className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-all"
              >
                Connect
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
          <div className="space-y-2">
            <div>
              <span className="text-gray-500">Expires at:</span>{' '}
              <span className="font-medium text-gray-800">{formatDate(metaStatus?.expires_at)}</span>
            </div>
            <div>
              <span className="text-gray-500">Scopes:</span>{' '}
              {metaStatus?.scopes?.length ? (
                <span className="font-medium text-gray-800">{metaStatus.scopes.join(', ')}</span>
              ) : (
                <span className="text-gray-400">Unknown</span>
              )}
            </div>
            <div>
              <span className="text-gray-500">Last API call:</span>{' '}
              <span className={`font-medium ${metaStatus?.last_api_status === 'failed' ? 'text-red-600' : 'text-green-600'}`}>
                {metaStatus?.last_api_status || 'Unknown'}
              </span>
            </div>
            {metaStatus?.last_api_status === 'failed' && metaStatus?.last_fbtrace_id && (
              <div>
                <span className="text-gray-500">Last fbtrace_id:</span>{' '}
                <span className="font-medium text-gray-800">{metaStatus.last_fbtrace_id}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <span className="text-gray-500">Token:</span>{' '}
                <span className="font-mono text-xs text-gray-800">
                  {metaStatus?.token_masked || 'Not available'}
                </span>
              </div>
              <button
                onClick={handleCopyToken}
                disabled={!metaStatus?.token}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <Copy size={14} />
                {tokenCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {metaStatus?.last_api_at && (
              <div>
                <span className="text-gray-500">Last API time:</span>{' '}
                <span className="font-medium text-gray-800">{formatDate(metaStatus.last_api_at)}</span>
              </div>
            )}
            {metaStatus?.last_api_error && metaStatus?.last_api_status === 'failed' && (
              <div className="text-xs text-red-500">
                {metaStatus.last_api_error}
              </div>
            )}
          </div>
        </div>
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
                  <div className="aspect-square bg-gray-100 relative flex items-center justify-center">
                    <div className="text-center text-gray-400">
                      <Video size={32} className="mx-auto mb-2 opacity-60" />
                      <p className="text-xs">Video ad preview</p>
                    </div>
                    <div className="absolute inset-x-0 bottom-2 px-2">
                      <p className="text-gray-700 text-xs font-medium truncate">{ad.page_name}</p>
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-gray-500 line-clamp-2">{ad.copy || 'No copy available'}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400">
                      {ad.platforms?.slice(0, 2).map(p => (
                        <span key={p} className="px-1.5 py-0.5 bg-gray-100 rounded">{p}</span>
                      ))}
                      {ad.snapshot_url && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(ad.snapshot_url, '_blank', 'noopener,noreferrer');
                          }}
                          className="ml-auto text-[10px] text-violet-600 hover:text-violet-700"
                        >
                          Open Ad
                        </button>
                      )}
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

              <button
                className="w-full mt-4 py-2 bg-violet-100 text-violet-700 rounded-lg font-medium text-sm hover:bg-violet-200 transition-all"
                onClick={() => {
                  if (!analysis || !selectedAd || !onGenerateBrief) return;
                  onGenerateBrief({
                    product_name: selectedAd.page_name || '',
                    product_description: analysis.creative_brief?.key_message || '',
                    target_audience: analysis.target_audience_signals?.demographics || '',
                    objective: analysis.creative_brief?.objective || '',
                    budget_level: 'medium'
                  });
                }}
              >
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
function AIGenerate({ store, prefillBrief, onPrefillApplied }) {
  const [activeGen, setActiveGen] = useState('hooks');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [copiedHookIndex, setCopiedHookIndex] = useState(null);

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

  useEffect(() => {
    if (!prefillBrief) return;
    setActiveGen('brief');
    setBriefForm(prev => ({
      ...prev,
      ...prefillBrief
    }));
    onPrefillApplied?.();
  }, [prefillBrief, onPrefillApplied]);

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

      const response = await fetch(withStore(`/creative-studio${endpoint}`, store), {
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
                    <button
                      className="ml-auto text-gray-400 hover:text-gray-600"
                      onClick={() => {
                        const text = hook.hook || '';
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(text).catch(err => console.error('Failed to copy hook to clipboard:', err));
                        }
                        setCopiedHookIndex(idx);
                        setTimeout(() => setCopiedHookIndex(null), 1500);
                      }}
                    >
                      {copiedHookIndex === idx ? <Check size={14} /> : <Copy size={14} />}
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

  // For thumbnail predictor
  const [images, setImages] = useState([]);
  const fileInputRef = useRef(null);

  const tools = [
    { id: 'fatigue', label: 'Fatigue Detector', icon: <TrendingUp size={18} /> },
    { id: 'audit', label: 'Account Audit', icon: <CheckCircle size={18} /> },
    { id: 'thumbnail', label: 'Thumbnail A/B', icon: <Eye size={18} /> }
  ];

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files).slice(0, 4);
    const newImages = files.map(file => ({
      file,
      url: URL.createObjectURL(file)
    }));
    setImages(prev => [...prev, ...newImages].slice(0, 4));
  };

  useEffect(() => {
    let isMounted = true;

    const checkMetaStatus = async () => {
      try {
        const response = await fetch(withStore('/creative-studio/meta-status', store));
        const data = await response.json();
        if (isMounted) {
          setMetaConnected(Boolean(data.connected));
        }
      } catch (error) {
        console.error('Meta status check failed:', error);
        if (isMounted) {
          setMetaConnected(false);
        }
      }

      if (isMounted) {
        setCheckingMeta(false);
      }
    };

    if (!store) {
      setMetaConnected(false);
      setCheckingMeta(false);
      return () => {};
    }

    setCheckingMeta(true);
    checkMetaStatus();

    return () => {
      isMounted = false;
    };
  }, [store]);

  const handlePredictThumbnails = async () => {
    if (images.length < 2) return;

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      images.forEach(img => formData.append('images', img.file));

      const response = await fetch(withStore('/creative-studio/predict/thumbnails', store), {
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

    try {
      // In real implementation, this would pull data from your Meta connection
      const response = await fetch(withStore('/creative-studio/audit', store), {
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

    try {
      const response = await fetch(withStore('/creative-studio/fatigue/analyze', store), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const data = await response.json();
      if (data.success) {
        setResult({ fatigue: data });
      }
    } catch (error) {
      console.error('Fatigue analysis failed:', error);
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
            onClick={() => { setActiveTool(tool.id); setResult(null); }}
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
                <p className="text-gray-500 mb-6">Scan your Meta data to spot fatigued creatives</p>
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

              {result?.fatigue && (
                <div className="mt-6 space-y-4">
                  <div className="p-6 rounded-xl bg-violet-50 text-center">
                    <h4 className="text-lg font-semibold text-gray-900">Overall Summary</h4>
                    <p className="text-2xl font-bold text-violet-700 mt-2">
                      Avg Score: {result.fatigue.summary?.average_score ?? 0}
                    </p>
                    <p className="text-gray-600 mt-1">{result.fatigue.overall_recommendation}</p>
                  </div>

                  <div className="grid gap-4">
                    {result.fatigue.ads?.map(ad => (
                      <div key={ad.ad_id} className="p-4 border border-gray-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <h5 className="font-semibold text-gray-900">{ad.ad_name}</h5>
                            <p className="text-sm text-gray-500">Score: {ad.fatigue_score}</p>
                          </div>
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            ad.status === 'dead' ? 'bg-red-100 text-red-700' :
                            ad.status === 'fatigued' ? 'bg-orange-100 text-orange-700' :
                            ad.status === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            {ad.status}
                          </span>
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
              <p>No Meta data found for this store.</p>
              <p className="text-sm text-gray-400">Sync your Meta account from the main dashboard first.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
