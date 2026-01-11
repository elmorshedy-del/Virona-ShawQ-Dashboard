import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

const API_BASE = '/api';

const EMPTY_PREVIEW_VIDEO = {
  video_id: null,
  source_url: null,
  embed_html: null,
  thumbnail_url: null,
  length: null,
  permalink_url: null,
  message: 'No video found for this ad.'
};

// ============================================================================
// PREMIUM DESIGN TOKENS - Warm, comforting palette
// ============================================================================
const colors = {
  bg: '#F8FAFC',
  bgWarm: '#FAFAF9',
  bgSubtle: '#F1F5F9',
  card: '#FFFFFF',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  text: '#1E293B',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  accent: '#6366F1',
  accentLight: '#EEF2FF',
  purple: '#8B5CF6',
  success: '#10B981',
  successLight: '#D1FAE5',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  error: '#EF4444',
  errorLight: '#FEE2E2'
};

// ============================================================================
// GLOBAL STYLES - Injected once
// ============================================================================
const injectGlobalStyles = () => {
  if (document.getElementById('creative-intelligence-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'creative-intelligence-styles';
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Cairo:wght@400;500;600;700&display=swap');
    
    .ci-root {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
      line-height: 1.6;
    }
    
    .ci-root [lang="ar"], .ci-root .arabic {
      font-family: 'Cairo', 'Inter', sans-serif;
    }
    
    .ci-shadow-soft {
      box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03);
    }
    
    .ci-shadow-glow {
      box-shadow: 0 0 40px rgba(139,92,246,0.08), 0 0 80px rgba(139,92,246,0.05), 0 4px 20px rgba(0,0,0,0.03);
      border: 1px solid rgba(139,92,246,0.08);
    }
    
    @keyframes purpleBreath {
      0%, 100% {
        box-shadow: 0 0 30px rgba(139,92,246,0.12), 0 0 60px rgba(139,92,246,0.06), 0 4px 20px rgba(0,0,0,0.03);
        border-color: rgba(139,92,246,0.15);
      }
      50% {
        box-shadow: 0 0 50px rgba(139,92,246,0.22), 0 0 100px rgba(139,92,246,0.12), 0 4px 20px rgba(0,0,0,0.03);
        border-color: rgba(139,92,246,0.25);
      }
    }
    
    .ci-aura-active {
      animation: purpleBreath 2.5s ease-in-out infinite;
    }
    
    @keyframes msgSlide {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .ci-msg-enter {
      animation: msgSlide 0.35s cubic-bezier(0.16,1,0.3,1) forwards;
    }
    
    @keyframes cursorPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    
    .ci-cursor {
      display: inline-block;
      width: 2px;
      height: 1.1em;
      background: linear-gradient(135deg, #8B5CF6, #6366F1);
      margin-left: 2px;
      vertical-align: text-bottom;
      animation: cursorPulse 1s ease-in-out infinite;
      border-radius: 1px;
    }
    
    @keyframes particleFly {
      0% { opacity: 1; transform: scale(1); }
      100% { opacity: 0; transform: scale(0.4) translateY(-30px); }
    }
    
    .ci-particle {
      position: absolute;
      pointer-events: none;
      animation: particleFly 1s cubic-bezier(0.16,1,0.3,1) forwards;
    }
    
    .ci-copy-btn {
      opacity: 0;
      transform: scale(0.9);
      transition: all 0.2s ease;
    }
    
    .ci-msg-wrap:hover .ci-copy-btn {
      opacity: 1;
      transform: scale(1);
    }
    
    .ci-input-glow:focus {
      box-shadow: 0 0 0 3px rgba(99,102,241,0.1), 0 0 20px rgba(99,102,241,0.08);
      border-color: rgba(99,102,241,0.4);
    }
    
    .ci-hover-lift {
      transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
    }
    
    .ci-hover-lift:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    
    .ci-root ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    
    .ci-root ::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .ci-root ::-webkit-scrollbar-thumb {
      background: #CBD5E1;
      border-radius: 3px;
    }
    
    .ci-root ::-webkit-scrollbar-thumb:hover {
      background: #94A3B8;
    }
  `;
  document.head.appendChild(style);
};

// ============================================================================
// PARTICLE EXPLOSION
// ============================================================================
const ParticleExplosion = ({ active, onDone }) => {
  const ref = useRef(null);
  
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const particleColors = ['#8B5CF6', '#6366F1', '#A78BFA', '#C4B5FD', '#10B981'];
    
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('div');
      p.className = 'ci-particle';
      const size = Math.random() * 8 + 4;
      const angle = (Math.PI * 2 * i) / 16;
      const dist = Math.random() * 60 + 30;
      const color = particleColors[Math.floor(Math.random() * particleColors.length)];
      
      p.style.cssText = `
        width: ${size}px; height: ${size}px;
        background: ${color}; border-radius: 50%;
        left: 50%; top: 50%;
        transform: translate(-50%, -50%);
      `;
      container.appendChild(p);
      
      const endX = Math.cos(angle) * dist;
      const endY = Math.sin(angle) * dist;
      
      p.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${endX}px), calc(-50% + ${endY}px)) scale(0.3)`, opacity: 0 }
      ], { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'forwards' });
    }
    
    setTimeout(() => {
      while (container.firstChild) container.removeChild(container.firstChild);
      onDone?.();
    }, 1200);
  }, [active, onDone]);
  
  return <div ref={ref} className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 50 }} />;
};

// ============================================================================
// COPY BUTTON
// ============================================================================
const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      className="ci-copy-btn absolute top-2 right-2 p-1.5 rounded-lg bg-white/90 backdrop-blur border border-gray-200 hover:bg-white"
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
};

// ============================================================================
// EMPTY STATE
// ============================================================================
const EmptyState = () => (
  <div className="flex-1 flex items-center justify-center p-8">
    <div className="text-center max-w-sm">
      <svg width="180" height="140" viewBox="0 0 180 140" fill="none" className="mx-auto mb-6">
        <defs>
          <linearGradient id="emptyGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#EEF2FF" />
            <stop offset="100%" stopColor="#E0E7FF" />
          </linearGradient>
          <linearGradient id="emptyGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#6366F1" />
          </linearGradient>
        </defs>
        <rect x="35" y="25" width="110" height="90" rx="12" fill="url(#emptyGrad1)" />
        <rect x="35" y="25" width="110" height="90" rx="12" stroke="#C7D2FE" strokeWidth="2" />
        <circle cx="90" cy="60" r="20" fill="white" filter="drop-shadow(0 3px 8px rgba(0,0,0,0.1))" />
        <path d="M85 52 L98 60 L85 68 Z" fill="url(#emptyGrad2)" />
        <rect x="50" y="95" width="45" height="6" rx="3" fill="#C7D2FE" />
        <rect x="100" y="95" width="30" height="6" rx="3" fill="#DDD6FE" />
        <circle cx="25" cy="45" r="5" fill="#DDD6FE" opacity="0.6" />
        <circle cx="160" cy="80" r="6" fill="#C7D2FE" opacity="0.5" />
        <path d="M18 70 L8 70 M8 70 L13 65 M8 70 L13 75" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </svg>
      <h3 className="text-lg font-semibold mb-2" style={{ color: colors.text }}>Select an ad to analyze</h3>
      <p className="text-sm" style={{ color: colors.textSecondary }}>Choose an ad from the list to get AI-powered creative insights</p>
    </div>
  </div>
);

// ============================================================================
// CHAT MESSAGE
// ============================================================================
const ChatMessage = ({ message }) => {
  const isUser = message.role === 'user';
  
  return (
    <div className={`ci-msg-wrap ci-msg-enter flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`relative max-w-[85%] px-5 py-4 rounded-2xl ${isUser ? 'rounded-br-md' : 'rounded-bl-md'}`}
        style={{
          backgroundColor: isUser ? colors.accent : colors.bgSubtle,
          color: isUser ? 'white' : colors.text,
          boxShadow: isUser ? '0 2px 8px rgba(99,102,241,0.25)' : '0 1px 3px rgba(0,0,0,0.04)',
          lineHeight: '1.7',
          fontSize: '14.5px'
        }}
      >
        {!isUser && !message.streaming && <CopyButton text={message.content} />}
        {isUser ? (
          <div className="whitespace-pre-wrap">
            {message.content}
            {message.streaming && <span className="ci-cursor" />}
          </div>
        ) : (
          <div className="ci-markdown">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                h1: ({ children }) => <h1 className="text-lg font-semibold mt-4 mb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-2">{children}</h3>,
                ul: ({ children }) => <ul className="my-2 ml-4 list-disc">{children}</ul>,
                ol: ({ children }) => <ol className="my-2 ml-4 list-decimal">{children}</ol>,
                li: ({ children }) => <li className="my-1">{children}</li>,
                hr: () => <hr className="my-4 border-gray-300/70" />,
                code: ({ children }) => <code className="bg-gray-200/70 px-1 py-0.5 rounded text-xs">{children}</code>
              }}
            >
              {message.content || ''}
            </ReactMarkdown>
            {message.streaming && message.content && <span className="ci-cursor" />}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// SUGGESTION CHIPS
// ============================================================================
const SuggestionChips = ({ onSelect, disabled }) => {
  const suggestions = [
    { icon: '🎯', text: 'Why did this ad work?' },
    { icon: '📊', text: 'Compare to my top performers' },
    { icon: '✨', text: 'Give me 3 variations' },
    { icon: '🔍', text: 'What could be improved?' }
  ];
  
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => !disabled && onSelect(s.text)}
          disabled={disabled}
          className="px-4 py-2.5 text-sm rounded-full border ci-hover-lift disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ borderColor: colors.border, color: colors.textSecondary, backgroundColor: 'white' }}
        >
          <span className="mr-1.5">{s.icon}</span>{s.text}
        </button>
      ))}
    </div>
  );
};

// ============================================================================
// HELPERS
// ============================================================================
const filterStoreAccounts = (accounts, storeId) => {
  if (!Array.isArray(accounts)) return [];
  if (storeId === 'vironax') {
    const m = accounts.filter(a => /virona shop/i.test(a?.name || ''));
    return m.length > 0 ? m : accounts;
  }
  if (storeId === 'shawq') {
    const m = accounts.filter(a => /shawq\.co/i.test(a?.name || ''));
    return m.length > 0 ? m : accounts;
  }
  return accounts;
};

const extractGeminiTranscript = (scriptData) => {
  if (!scriptData || scriptData.analysisType !== 'video_frames' || !Array.isArray(scriptData.frames)) return '';
  const seen = new Set();
  const lines = [];
  scriptData.frames.forEach(f => {
    const v = typeof f?.voiceover === 'string' ? f.voiceover.trim() : '';
    if (v && v.toLowerCase() !== 'none' && v.toLowerCase() !== 'n/a' && !seen.has(v)) {
      seen.add(v);
      lines.push(v);
    }
  });
  return lines.join('\n');
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function CreativeIntelligence({ store }) {
  useEffect(() => { injectGlobalStyles(); }, []);
  
  const storeId = typeof store === 'string' ? store : store?.id;
  
  const [adAccounts, setAdAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [ads, setAds] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [selectedAd, setSelectedAd] = useState(null);
  const [scriptStatuses, setScriptStatuses] = useState({});
  
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(false);
  
  const [error, setError] = useState('');
  const [showInactiveCampaigns, setShowInactiveCampaigns] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [videoData, setVideoData] = useState(null);
  const [scriptStatus, setScriptStatus] = useState(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [showParticles, setShowParticles] = useState(false);
  const [tokenUsage, setTokenUsage] = useState({ gemini: null, sonnet: null });
  
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);

  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewAd, setPreviewAd] = useState(null);
  const [previewVideoData, setPreviewVideoData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewMediaDimensions, setPreviewMediaDimensions] = useState({ width: null, height: null });
  const previewVideoRef = useRef(null);
  const previewImageRef = useRef(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(null);
  
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (previewModalOpen && previewVideoRef.current) {
      previewVideoRef.current.play().catch(() => undefined);
    }
  }, [previewModalOpen, previewVideoData]);

  // Fetch ad accounts
  useEffect(() => {
    if (!storeId) return;
    setLoadingAccounts(true);
    fetch(`${API_BASE}/meta/adaccounts?store=${storeId}`)
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data?.data) ? data.data : [];
        const filtered = filterStoreAccounts(list, storeId);
        setAdAccounts(filtered);
        if (filtered.length > 0) setSelectedAccount(filtered[0].id);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingAccounts(false));
  }, [storeId]);

  // Fetch campaigns
  useEffect(() => {
    if (!selectedAccount) { setCampaigns([]); setSelectedCampaign(''); return; }
    setLoadingCampaigns(true);
    fetch(`${API_BASE}/meta/campaigns?store=${storeId}&adAccountId=${selectedAccount}`)
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data?.data) ? data.data : [];
        setCampaigns(list);
        const active = list.find(c => (c?.effective_status || c?.status || '').toUpperCase() === 'ACTIVE');
        setSelectedCampaign(active?.id || list[0]?.id || '');
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingCampaigns(false));
  }, [selectedAccount, storeId]);

  // Fetch ads
  useEffect(() => {
    if (!selectedCampaign) { setAds([]); setScriptStatuses({}); return; }
    setLoadingAds(true);
    fetch(`${API_BASE}/meta/campaigns/${selectedCampaign}/ads?store=${storeId}&adAccountId=${selectedAccount}`)
      .then(res => res.json())
      .then(data => setAds(Array.isArray(data?.data) ? data.data : []))
      .catch(err => setError(err.message))
      .finally(() => setLoadingAds(false));
  }, [selectedCampaign, selectedAccount, storeId]);

  // Fetch script statuses
  useEffect(() => {
    if (!storeId || !selectedCampaign || ads.length === 0) { setScriptStatuses({}); return; }
    fetch(`${API_BASE}/creative-intelligence/scripts?store=${storeId}&campaignId=${selectedCampaign}`)
      .then(res => res.json())
      .then(data => {
        const next = {};
        (data?.scripts || []).forEach(s => { if (s?.ad_id) next[s.ad_id] = s.status || 'pending'; });
        setScriptStatuses(next);
      })
      .catch(() => setScriptStatuses({}));
  }, [storeId, selectedCampaign, ads.length]);

  // Fetch settings
  useEffect(() => {
    if (!storeId) return;
    fetch(`${API_BASE}/creative-intelligence/settings?store=${storeId}`)
      .then(res => res.json())
      .then(data => data.success && setSettings(data.settings))
      .catch(console.error);
  }, [storeId]);

  // Handle ad selection
  const handleSelectAd = async (ad) => {
    setSelectedAd(ad);
    setLoadingVideo(true);
    setVideoData(null);
    setScriptStatus(null);
    setChatMessages([]);
    setConversationId(null);
    setTokenUsage({ gemini: null, sonnet: null });

    try {
      const videoRes = await fetch(`${API_BASE}/meta/ads/${ad.id}/video?store=${storeId}&adAccountId=${selectedAccount}`);
      const video = await videoRes.json();
      setVideoData(video);

      const scriptRes = await fetch(`${API_BASE}/creative-intelligence/script/${ad.id}?store=${storeId}`);
      const script = await scriptRes.json();
      setScriptStatus(script);
      setScriptStatuses(prev => ({ ...prev, [ad.id]: script?.status || 'pending' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingVideo(false);
    }
  };

  // Analyze ad
  const handleAnalyze = async () => {
    if (!selectedAd || !videoData) return;
    setScriptStatus({ status: 'processing' });

    const payload = {
      store: storeId,
      adId: selectedAd.id,
      adName: selectedAd.name,
      campaignId: selectedCampaign,
      campaignName: campaigns.find(c => c.id === selectedCampaign)?.name,
      sourceUrl: videoData.source_url,
      embedHtml: videoData.embed_html,
      thumbnailUrl: videoData.thumbnail_url
    };

    try {
      const res = await fetch(`${API_BASE}/creative-intelligence/analyze-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setScriptStatus({ exists: true, status: 'complete', script: data.script });
        setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'complete' }));
        setTokenUsage(prev => ({ ...prev, gemini: data.usage?.gemini ?? null }));
        setShowParticles(true);
      } else {
        setScriptStatus({ status: 'failed', error: data.error });
        setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'failed' }));
      }
    } catch (err) {
      setScriptStatus({ status: 'failed', error: err.message });
      setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'failed' }));
    }
  };

  const handlePreviewOpen = async (ad) => {
    setPreviewAd(ad);
    setPreviewModalOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewVideoData(null);
    setPreviewMediaDimensions({ width: null, height: null });

    try {
      const res = await fetch(`${API_BASE}/meta/ads/${ad.id}/video?store=${storeId}&adAccountId=${selectedAccount}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load video');
      }
      setPreviewVideoData(data || EMPTY_PREVIEW_VIDEO);
    } catch (err) {
      setPreviewError(err?.message || 'Failed to load video');
      setPreviewVideoData(EMPTY_PREVIEW_VIDEO);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePreviewClose = () => {
    setPreviewModalOpen(false);
    setPreviewAd(null);
    setPreviewVideoData(null);
    setPreviewError('');
    setPreviewMediaDimensions({ width: null, height: null });
  };

  const handlePreviewVideoMetadata = () => {
    const video = previewVideoRef.current;
    if (!video) return;
    if (video.videoWidth && video.videoHeight) {
      setPreviewMediaDimensions({ width: video.videoWidth, height: video.videoHeight });
    }
  };

  const handlePreviewImageLoad = () => {
    const image = previewImageRef.current;
    if (!image) return;
    if (image.naturalWidth && image.naturalHeight) {
      setPreviewMediaDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    }
  };

  const handleReanalyze = async () => {
    if (!selectedAd) return;
    await fetch(`${API_BASE}/creative-intelligence/script/${selectedAd.id}?store=${storeId}`, { method: 'DELETE' });
    setScriptStatus({ status: 'pending' });
    setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'pending' }));
    setChatMessages([]);
    setConversationId(null);
    await handleAnalyze();
  };

  // Send chat message
  const handleSendMessage = async (msgText) => {
    const userMessage = (msgText || chatInput).trim();
    if (!userMessage || chatLoading) return;

    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatLoading(true);

    const selectedModel = settings?.model || 'sonnet-4.5';
    const openAiModels = new Set(['gpt-5.1', 'gpt-5.2', 'gpt-5.2-pro']);
    const openAiStreamingModels = new Set(['gpt-5.2', 'gpt-5.2-pro']);
    const isOpenAI = openAiModels.has(selectedModel);
    const shouldStream = (settings?.streaming && !isOpenAI) || openAiStreamingModels.has(selectedModel);

    try {
      const res = await fetch(`${API_BASE}/creative-intelligence/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: storeId,
          message: userMessage,
          adId: selectedAd?.id,
          conversationId,
          reasoning_effort: settings?.reasoning_effort || 'medium'
        })
      });

      if (!res.ok) throw new Error((await res.json())?.error || 'Chat failed');

      if (shouldStream) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantMsg = '';
        let buffer = '';
        let lastFlushAt = 0;
        let flushTimeout = null;
        let streamFinished = false;

        const minFlushIntervalMs = 160;
        const minWordsPerChunk = 10;
        const maxWordsPerChunk = 18;

        const countWords = (text) => {
          const trimmed = text.trim();
          if (!trimmed) return 0;
          return trimmed.split(/\s+/).length;
        };

        const shouldFlushChunk = (pending) => {
          if (!pending) return false;
          if (/[.!?:;\n]\s*$/.test(pending)) return true;
          const words = countWords(pending);
          if (words >= maxWordsPerChunk) return true;
          return words >= minWordsPerChunk && /\s$/.test(pending);
        };

        const updateStreamingMessage = (content, streaming = true) => {
          setChatMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content, streaming };
            return updated;
          });
        };

        const flushBuffer = (force = false) => {
          if (!buffer) return;
          const now = Date.now();
          const elapsed = now - lastFlushAt;
          if (!force && elapsed < minFlushIntervalMs) {
            if (!flushTimeout) {
              flushTimeout = setTimeout(() => {
                flushTimeout = null;
                flushBuffer();
              }, minFlushIntervalMs - elapsed);
            }
            return;
          }
          assistantMsg += buffer;
          buffer = '';
          lastFlushAt = Date.now();
          updateStreamingMessage(assistantMsg, true);
        };

        setChatMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'delta') {
                  buffer += data.text;
                  if (shouldFlushChunk(buffer)) {
                    flushBuffer();
                  }
                } else if (data.type === 'done') {
                  streamFinished = true;
                  if (flushTimeout) {
                    clearTimeout(flushTimeout);
                    flushTimeout = null;
                  }
                  flushBuffer(true);
                  setConversationId(data.conversationId);
                  if (!isOpenAI) setTokenUsage(prev => ({ ...prev, sonnet: data.usage ?? null }));
                  updateStreamingMessage(assistantMsg, false);
                }
              } catch {}
            }
          }
        }
        if (!streamFinished) {
          if (flushTimeout) {
            clearTimeout(flushTimeout);
            flushTimeout = null;
          }
          flushBuffer(true);
          updateStreamingMessage(assistantMsg, false);
        }
      } else {
        const data = await res.json();
        if (data.success) {
          setChatMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
          setConversationId(data.conversationId);
          setTokenUsage(prev => ({ ...prev, sonnet: data.usage ?? null }));
        }
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleFormSubmit = (e) => { e?.preventDefault(); handleSendMessage(); };

  const handleSaveSettings = async (newSettings) => {
    try {
      await fetch(`${API_BASE}/creative-intelligence/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: storeId, ...newSettings })
      });
      setSettings(newSettings);
      setShowSettings(false);
    } catch (err) {
      console.error('Save settings failed:', err);
    }
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // Derived data
  const campaignRows = useMemo(() => campaigns.map(c => ({
    id: c.id,
    name: c.name || c.id,
    status: (c?.effective_status || c?.status || 'UNKNOWN').toUpperCase(),
    isActive: (c?.effective_status || c?.status || '').toUpperCase() === 'ACTIVE'
  })), [campaigns]);

  const activeCampaigns = campaignRows.filter(c => c.isActive);
  const inactiveCampaigns = campaignRows.filter(c => !c.isActive);

  const adRows = useMemo(() => ads.map(ad => ({
    id: ad.id,
    name: ad.name || 'Untitled',
    status: (ad.effective_status || ad.status || 'UNKNOWN').toUpperCase(),
    isActive: (ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE',
    thumbnail: ad.thumbnail_url
  })), [ads]);

  const previewHasVideo = !!previewVideoData?.source_url;
  const previewHasEmbed = !previewHasVideo && !!previewVideoData?.embed_html;
  const previewDisplayThumbnail = previewVideoData?.thumbnail_url || previewAd?.thumbnail || null;
  const previewHasThumbnail = !previewHasVideo && !previewHasEmbed && !!previewDisplayThumbnail;
  const previewShowNoVideo = !previewLoading && !previewHasVideo && !previewHasEmbed && !previewHasThumbnail;
  const previewShowPermissionFallback = previewVideoData?.playable === false && previewHasThumbnail;
  const previewFallbackMessage =
    previewVideoData?.message ||
    (previewVideoData?.reason === 'NO_VIDEO_PERMISSION'
      ? "Can't access this video's preview."
      : 'No video found for this ad.');

  const previewModalMaxWidth = useMemo(() => {
    const width = previewMediaDimensions.width;
    const height = previewMediaDimensions.height;
    if (!width || !height) {
      return 'min(420px, 92vw)';
    }
    return width >= height ? 'min(960px, 92vw)' : 'min(420px, 92vw)';
  }, [previewMediaDimensions]);

  const filteredAds = useMemo(() => {
    if (activeTab === 'all') return adRows;
    if (activeTab === 'analyzed') return adRows.filter(ad => scriptStatuses[ad.id] === 'complete');
    return adRows.filter(ad => scriptStatuses[ad.id] !== 'complete');
  }, [adRows, activeTab, scriptStatuses]);

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="ci-root min-h-screen" style={{ backgroundColor: colors.bgWarm }}>
      {/* Header */}
      <div className="px-6 py-4 border-b ci-shadow-soft" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold" style={{ color: colors.text, letterSpacing: '-0.02em' }}>
              Creative Intelligence
            </h1>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="px-4 py-2 text-sm rounded-xl border bg-white focus:outline-none"
              style={{ borderColor: colors.border, color: colors.text }}
            >
              {loadingAccounts && <option>Loading...</option>}
              {adAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name || acc.id}</option>)}
            </select>
          </div>
          <button onClick={() => setShowSettings(true)} className="p-2.5 rounded-xl hover:bg-gray-100 transition-colors" title="Settings">
            <svg className="w-5 h-5" fill="none" stroke={colors.textSecondary} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left Panel */}
        <div className="w-80 border-r overflow-y-auto" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
          {/* Campaigns */}
          <div className="p-5 border-b" style={{ borderColor: colors.borderLight }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: colors.textMuted }}>Campaigns</div>
            {loadingCampaigns ? (
              <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded-xl bg-gray-100 animate-pulse" />)}</div>
            ) : (
              <div className="space-y-1">
                {activeCampaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCampaign(c.id)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition-all ${selectedCampaign === c.id ? 'ci-shadow-soft' : 'hover:bg-gray-50'}`}
                    style={{
                      backgroundColor: selectedCampaign === c.id ? colors.accentLight : undefined,
                      color: selectedCampaign === c.id ? colors.accent : colors.text,
                      fontWeight: selectedCampaign === c.id ? 500 : 400
                    }}
                  >
                    <div className="truncate">{c.name}</div>
                  </button>
                ))}
                {inactiveCampaigns.length > 0 && (
                  <button onClick={() => setShowInactiveCampaigns(!showInactiveCampaigns)} className="w-full text-left px-4 py-2.5 text-xs font-medium" style={{ color: colors.textMuted }}>
                    {showInactiveCampaigns ? '▼' : '▶'} Inactive ({inactiveCampaigns.length})
                  </button>
                )}
                {showInactiveCampaigns && inactiveCampaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCampaign(c.id)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition-all ${selectedCampaign === c.id ? 'ci-shadow-soft' : 'hover:bg-gray-50'}`}
                    style={{
                      backgroundColor: selectedCampaign === c.id ? colors.accentLight : undefined,
                      color: selectedCampaign === c.id ? colors.accent : colors.textSecondary
                    }}
                  >
                    <div className="truncate">{c.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="px-5 pt-5">
            <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: colors.bgSubtle }}>
              {['all', 'analyzed', 'pending'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-all ${activeTab === tab ? 'ci-shadow-soft' : ''}`}
                  style={{ backgroundColor: activeTab === tab ? colors.card : 'transparent', color: activeTab === tab ? colors.text : colors.textMuted }}
                >
                  {tab === 'all' ? 'All Ads' : tab === 'analyzed' ? 'Analyzed' : 'Not Analyzed'}
                </button>
              ))}
            </div>
          </div>

          {/* Ad List */}
          <div className="p-5 space-y-2">
            {loadingAds ? (
              <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-2xl bg-gray-100 animate-pulse" />)}</div>
            ) : filteredAds.length === 0 ? (
              <div className="text-sm text-center py-8" style={{ color: colors.textMuted }}>No ads found</div>
            ) : (
              filteredAds.map(ad => (
                <button
                  key={ad.id}
                  onClick={() => handleSelectAd(ad)}
                  className={`w-full text-left p-3.5 rounded-2xl border transition-all ci-hover-lift ${selectedAd?.id === ad.id ? 'ci-shadow-soft' : ''}`}
                  style={{
                    borderColor: selectedAd?.id === ad.id ? colors.accent : colors.border,
                    backgroundColor: selectedAd?.id === ad.id ? colors.accentLight : colors.card
                  }}
                >
                  <div className="flex items-center gap-3">
                    {ad.thumbnail ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handlePreviewOpen(ad);
                        }}
                        className="w-11 h-11 rounded-xl overflow-hidden"
                        aria-label={`Preview ${ad.name}`}
                        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                      >
                        <img src={ad.thumbnail} alt="" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: colors.bgSubtle }}>
                        <svg className="w-5 h-5" fill="none" stroke={colors.textMuted} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: colors.text }}>{ad.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ad.isActive ? colors.success : colors.textMuted }} />
                        <span className="text-xs" style={{ color: colors.textMuted }}>{ad.status}</span>
                        {scriptStatuses[ad.id] === 'complete' && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: colors.successLight, color: colors.success }}>Analyzed</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedAd ? <EmptyState /> : (
            <>
              {/* Ad Header */}
              <div className="px-6 py-4 border-b" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold" style={{ color: colors.text, letterSpacing: '-0.02em' }}>{selectedAd.name}</h2>
                    <div className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>{campaigns.find(c => c.id === selectedCampaign)?.name}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {scriptStatus?.status === 'complete' && (
                      <span className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium" style={{ backgroundColor: colors.successLight, color: colors.success }}>
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.success }} />Analyzed
                      </span>
                    )}
                    {scriptStatus?.status === 'processing' && (
                      <span className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium" style={{ backgroundColor: colors.warningLight, color: colors.warning }}>
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: colors.warning }} />Analyzing...
                      </span>
                    )}
                    {scriptStatus?.status === 'failed' && (
                      <span className="px-3 py-1.5 rounded-full text-sm font-medium" style={{ backgroundColor: colors.errorLight, color: colors.error }}>Failed</span>
                    )}
                    <div className="flex items-center gap-2">
                      {scriptStatus?.status === 'complete' && (
                        <button onClick={handleReanalyze} className="px-4 py-2 rounded-xl text-sm font-medium border ci-hover-lift" style={{ borderColor: colors.border, color: colors.textSecondary, backgroundColor: colors.card }}>
                          🔄 Reanalyze
                        </button>
                      )}
                      {scriptStatus?.status !== 'complete' && scriptStatus?.status !== 'processing' && (
                        <button
                          onClick={handleAnalyze}
                          className="px-4 py-2 rounded-xl text-sm font-medium text-white ci-hover-lift"
                          style={{ background: `linear-gradient(135deg, ${colors.purple}, ${colors.accent})`, boxShadow: '0 2px 8px rgba(99,102,241,0.3)' }}
                        >
                          ✨ Analyze
                        </button>
                      )}
                    </div>
                    {videoData?.permalink_url && (
                      <button
                        onClick={() => window.open(videoData.permalink_url, '_blank')}
                        className="px-4 py-2 rounded-xl text-sm border ci-hover-lift"
                        style={{ borderColor: colors.border, color: colors.textSecondary, backgroundColor: colors.card }}
                      >
                        Open on FB
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Chat with Aura */}
              <div
                className={`flex-1 flex flex-col overflow-hidden m-6 rounded-2xl border transition-all duration-300 ${chatLoading ? 'ci-aura-active' : 'ci-shadow-glow'}`}
                style={{ borderColor: chatLoading ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.08)', backgroundColor: colors.card, position: 'relative' }}
              >
                <ParticleExplosion active={showParticles} onDone={() => setShowParticles(false)} />
                
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6">
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center">
                      <div className="text-center max-w-md">
                        <div className="text-5xl mb-6">💬</div>
                        <h3 className="text-lg font-semibold mb-2" style={{ color: colors.text }}>Ask Claude about this ad</h3>
                        <p className="text-sm mb-6" style={{ color: colors.textSecondary }}>Get insights on why it works, compare to other ads, or generate new variations</p>
                        <SuggestionChips onSelect={handleSendMessage} disabled={scriptStatus?.status !== 'complete' || chatLoading} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      {chatMessages.map((msg, i) => <ChatMessage key={i} message={msg} />)}
                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>

                {/* Input */}
                <div className="p-4 border-t" style={{ borderColor: colors.borderLight }}>
                  <form onSubmit={handleFormSubmit} className="flex gap-3">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={scriptStatus?.status === 'complete' ? "Ask about this ad..." : "Analyze the ad first..."}
                      disabled={chatLoading || scriptStatus?.status !== 'complete'}
                      className="ci-input-glow flex-1 px-5 py-3.5 rounded-xl border text-sm focus:outline-none disabled:opacity-50 transition-all"
                      style={{ borderColor: colors.border, backgroundColor: colors.card, color: colors.text }}
                    />
                    <button
                      type="submit"
                      disabled={!chatInput.trim() || chatLoading || scriptStatus?.status !== 'complete'}
                      className="px-6 py-3.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-all"
                      style={{ background: `linear-gradient(135deg, ${colors.purple}, ${colors.accent})`, boxShadow: chatInput.trim() && !chatLoading ? '0 2px 12px rgba(99,102,241,0.3)' : 'none' }}
                    >
                      {chatLoading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> : 'Send'}
                    </button>
                  </form>
                </div>
              </div>

              {/* Debug */}
              <div className="mx-6 mb-6 rounded-2xl border overflow-hidden" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
                <button onClick={() => setDebugOpen(!debugOpen)} className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium hover:bg-gray-50 transition-colors" style={{ color: colors.text }}>
                  <span>Debug & Tokens</span>
                  <span className="text-xs" style={{ color: colors.textMuted }}>{debugOpen ? '▼' : '▶'}</span>
                </button>
                {debugOpen && (
                  <div className="p-5 pt-0 text-xs" style={{ color: colors.textSecondary }}>
                    <div className="space-y-1">
                      <div><span className="font-semibold" style={{ color: colors.text }}>Gemini:</span> {tokenUsage.gemini ? `${tokenUsage.gemini.totalTokens || 'n/a'} tokens` : 'Not reported'}</div>
                      <div><span className="font-semibold" style={{ color: colors.text }}>Claude:</span> {tokenUsage.sonnet ? `${(tokenUsage.sonnet.input_tokens || 0) + (tokenUsage.sonnet.output_tokens || 0)} tokens` : 'Not reported'}</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {previewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div
            className="bg-white rounded-xl shadow-xl w-full max-h-[92vh] flex flex-col"
            style={{ maxWidth: previewModalMaxWidth }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="text-sm font-semibold text-gray-800 truncate">
                {previewAd?.name || 'Ad Preview'}
              </div>
              <button
                onClick={handlePreviewClose}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="flex items-center justify-center">
                {previewLoading && (
                  <div className="text-sm text-gray-500">Loading media...</div>
                )}

                {!previewLoading && previewError && (
                  <div className="text-sm text-red-600">{previewError}</div>
                )}

                {!previewLoading && previewHasVideo && (
                  <video
                    ref={previewVideoRef}
                    src={previewVideoData.source_url}
                    autoPlay
                    controls
                    onLoadedMetadata={handlePreviewVideoMetadata}
                    className="w-full h-auto max-h-[85vh] object-contain"
                  />
                )}

                {!previewLoading && previewHasEmbed && (
                  <div
                    className="w-full flex justify-center"
                    dangerouslySetInnerHTML={{ __html: previewVideoData.embed_html }}
                  />
                )}

                {!previewLoading && !previewHasVideo && previewHasThumbnail && (
                  <div className="text-center">
                    <img
                      ref={previewImageRef}
                      src={previewDisplayThumbnail}
                      alt="Ad thumbnail"
                      onLoad={handlePreviewImageLoad}
                      className="w-full h-auto max-h-[85vh] object-contain"
                    />
                    <p className="mt-3 text-sm text-gray-600">
                      {previewShowPermissionFallback ? "Can't play this video here." : 'Playable video source unavailable.'}
                    </p>
                    {previewVideoData?.permalink_url && (
                      <button
                        onClick={() => window.open(previewVideoData.permalink_url, '_blank')}
                        className="mt-3 px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg"
                      >
                        Open on Facebook
                      </button>
                    )}
                  </div>
                )}

                {!previewLoading && previewShowNoVideo && (
                  <div className="text-sm text-gray-600 text-center">
                    <p>{previewFallbackMessage}</p>
                    {previewVideoData?.permalink_url && (
                      <button
                        onClick={() => window.open(previewVideoData.permalink_url, '_blank')}
                        className="mt-3 px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg"
                      >
                        Open on Facebook
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && <SettingsModal settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}

      {/* Error */}
      {error && (
        <div className="fixed bottom-4 right-4 px-5 py-3.5 rounded-xl text-sm text-white ci-shadow-soft" style={{ backgroundColor: colors.error }}>
          {error}
          <button onClick={() => setError('')} className="ml-3 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SETTINGS MODAL
// ============================================================================
function SettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    model: settings?.model || 'sonnet-4.5',
    reasoning_effort: settings?.reasoning_effort || 'medium',
    streaming: settings?.streaming ?? true,
    capabilities: settings?.capabilities || { analyze: true, clone: true, ideate: true, audit: true }
  });

  const openAiEffortOptions = { 'gpt-5.2': ['none', 'medium', 'xhigh'], 'gpt-5.2-pro': ['none', 'medium', 'xhigh'], 'gpt-5.1': ['medium'] };
  const isOpenAiModel = ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1'].includes(form.model);
  const allowedEfforts = openAiEffortOptions[form.model] || ['medium'];

  const updateModel = (value) => {
    setForm(prev => ({
      ...prev,
      model: value,
      reasoning_effort: openAiEffortOptions[value]?.includes(prev.reasoning_effort) ? prev.reasoning_effort : (openAiEffortOptions[value]?.[0] || prev.reasoning_effort)
    }));
  };

  const handleCapabilityToggle = (key) => {
    setForm(prev => ({ ...prev, capabilities: { ...prev.capabilities, [key]: !prev.capabilities[key] } }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        <div className="p-6 border-b" style={{ borderColor: colors.borderLight }}>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold" style={{ color: colors.text }}>AI Settings</h2>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100">
              <svg className="w-5 h-5" fill="none" stroke={colors.textSecondary} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Model */}
          <div>
            <label className="block text-sm font-semibold mb-3" style={{ color: colors.text }}>Model</label>
            <div className="space-y-2">
              {[
                { value: 'sonnet-4.5', name: 'Claude Sonnet 4.5', badge: 'Recommended', badgeColor: colors.accent, desc: 'Fast, sharp insights' },
                { value: 'opus-4.5', name: 'Claude Opus 4.5', badge: 'Premium', badgeColor: '#F59E0B', desc: 'Deep reasoning' },
                { value: 'gpt-5.2', name: 'GPT-5.2', badge: 'OpenAI', badgeColor: '#10B981', desc: 'Balanced reasoning' },
                { value: 'gpt-5.2-pro', name: 'GPT-5.2 Pro', badge: 'OpenAI Pro', badgeColor: '#10B981', desc: 'Maximum reasoning' }
              ].map(m => (
                <label
                  key={m.value}
                  className={`flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${form.model === m.value ? 'ci-shadow-soft' : 'hover:bg-gray-50'}`}
                  style={{ borderColor: form.model === m.value ? colors.accent : colors.border, backgroundColor: form.model === m.value ? colors.accentLight : colors.card }}
                >
                  <input type="radio" name="model" value={m.value} checked={form.model === m.value} onChange={(e) => updateModel(e.target.value)} className="mt-1 accent-indigo-500" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: colors.text }}>{m.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: `${m.badgeColor}20`, color: m.badgeColor }}>{m.badge}</span>
                    </div>
                    <div className="text-sm mt-0.5" style={{ color: colors.textSecondary }}>{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Reasoning Effort */}
          {isOpenAiModel && (
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: colors.text }}>Reasoning Effort</label>
              <select
                value={form.reasoning_effort}
                onChange={(e) => setForm(prev => ({ ...prev, reasoning_effort: e.target.value }))}
                className="w-full px-4 py-3 text-sm rounded-xl border focus:outline-none"
                style={{ borderColor: colors.border }}
              >
                {allowedEfforts.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          )}

          {/* Capabilities */}
          <div>
            <label className="block text-sm font-semibold mb-3" style={{ color: colors.text }}>Capabilities</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: 'analyze', icon: '🎯', label: 'Analyze' },
                { key: 'clone', icon: '📋', label: 'Clone' },
                { key: 'ideate', icon: '💡', label: 'Ideate' },
                { key: 'audit', icon: '🔍', label: 'Audit' }
              ].map(cap => (
                <label
                  key={cap.key}
                  className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${form.capabilities[cap.key] ? '' : 'opacity-50'}`}
                  style={{ borderColor: form.capabilities[cap.key] ? colors.accent : colors.border, backgroundColor: form.capabilities[cap.key] ? colors.accentLight : colors.card }}
                >
                  <input type="checkbox" checked={form.capabilities[cap.key]} onChange={() => handleCapabilityToggle(cap.key)} className="accent-indigo-500" />
                  <span>{cap.icon}</span>
                  <span className="text-sm font-medium" style={{ color: colors.text }}>{cap.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Streaming */}
          <label className="flex items-center justify-between p-4 rounded-2xl border cursor-pointer hover:bg-gray-50" style={{ borderColor: colors.border }}>
            <div>
              <div className="font-medium" style={{ color: colors.text }}>Streaming Responses</div>
              <div className="text-sm" style={{ color: colors.textSecondary }}>See responses as they generate</div>
            </div>
            <input type="checkbox" checked={form.streaming} onChange={(e) => setForm(prev => ({ ...prev, streaming: e.target.checked }))} className="w-5 h-5 accent-indigo-500" />
          </label>
        </div>

        <div className="p-6 border-t" style={{ borderColor: colors.borderLight }}>
          <button
            onClick={() => onSave(form)}
            className="w-full py-3.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: `linear-gradient(135deg, ${colors.purple}, ${colors.accent})`, boxShadow: '0 2px 12px rgba(99,102,241,0.3)' }}
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
