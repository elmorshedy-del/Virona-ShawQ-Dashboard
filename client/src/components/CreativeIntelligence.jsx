import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const API_BASE = '/api';

// ============================================================================
// PREMIUM DESIGN TOKENS
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

const EMPTY_VIDEO = {
  video_id: null,
  source_url: null,
  embed_html: null,
  thumbnail_url: null,
  length: null,
  permalink_url: null,
  message: 'No video found for this ad.'
};

// ============================================================================
// TRANSCRIPT EXTRACTION HELPERS
// ============================================================================
const extractGeminiTranscript = (scriptData) => {
  if (!scriptData || scriptData.analysisType !== 'video_frames' || !Array.isArray(scriptData.frames)) {
    return '';
  }
  const seen = new Set();
  const lines = [];
  scriptData.frames.forEach((frame) => {
    const voiceover = typeof frame?.voiceover === 'string' ? frame.voiceover.trim() : '';
    if (!voiceover || voiceover.toLowerCase() === 'none' || voiceover.toLowerCase() === 'n/a') {
      return;
    }
    if (!seen.has(voiceover)) {
      seen.add(voiceover);
      lines.push(voiceover);
    }
  });
  return lines.join('\n');
};

const extractGeminiFullTranscript = (scriptData) => {
  if (!scriptData || scriptData.analysisType !== 'video_frames' || !Array.isArray(scriptData.frames)) {
    return '';
  }
  const lines = [];
  scriptData.frames.forEach((frame) => {
    const timeLabel = frame?.time ? `[${frame.time}]` : '';
    const voiceover = typeof frame?.voiceover === 'string' ? frame.voiceover.trim() : '';
    const text = typeof frame?.text === 'string' ? frame.text.trim() : '';
    const chunk = [];
    if (voiceover && voiceover.toLowerCase() !== 'none' && voiceover.toLowerCase() !== 'n/a') {
      chunk.push(`${timeLabel} Voiceover: ${voiceover}`.trim());
    }
    if (text && text.toLowerCase() !== 'none' && text.toLowerCase() !== 'n/a') {
      chunk.push(`${timeLabel} On-screen text: ${text}`.trim());
    }
    if (chunk.length > 0) {
      lines.push(chunk.join('\n'));
    }
  });
  return lines.join('\n');
};

// ============================================================================
// GLOBAL STYLES
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
    
    /* Sentence fade-in animation */
    @keyframes sentenceFade {
      from { 
        opacity: 0; 
        transform: translateY(4px);
      }
      to { 
        opacity: 1; 
        transform: translateY(0);
      }
    }
    
    .ci-sentence {
      display: inline;
      animation: sentenceFade 0.4s cubic-bezier(0.16,1,0.3,1) forwards;
    }
    
    .ci-sentence-pending {
      opacity: 0;
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

    .ci-markdown > *:first-child {
      margin-top: 0;
    }

    .ci-markdown > *:last-child {
      margin-bottom: 0;
    }

    .ci-markdown p {
      margin: 0 0 0.75em 0;
    }

    .ci-markdown ul,
    .ci-markdown ol {
      margin: 0.25em 0 0.75em 1.25em;
      padding: 0;
    }

    .ci-markdown li {
      margin: 0.25em 0;
    }

    .ci-markdown h1,
    .ci-markdown h2,
    .ci-markdown h3,
    .ci-markdown h4 {
      margin: 0.6em 0 0.4em;
      font-weight: 600;
    }

    .ci-markdown code {
      background: rgba(148,163,184,0.2);
      padding: 0.1em 0.3em;
      border-radius: 6px;
      font-size: 0.9em;
    }

    .ci-markdown pre {
      background: rgba(15,23,42,0.06);
      padding: 0.75em;
      border-radius: 12px;
      overflow-x: auto;
    }
    
    .ci-hover-lift {
      transition: all 0.2s cubic-bezier(0.16,1,0.3,1);
    }
    
    .ci-hover-lift:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    
    /* Fixed height chat container */
    .ci-chat-container {
      display: flex;
      flex-direction: column;
      min-height: 0; /* Critical for flex child to allow shrinking */
      flex: 1;
    }
    
    .ci-chat-messages {
      flex: 1;
      overflow-y: auto;
      min-height: 0; /* Critical for flex child */
    }
    
    /* Scroll to bottom button */
    @keyframes bounceIn {
      0% { transform: translateX(-50%) scale(0.8); opacity: 0; }
      100% { transform: translateX(-50%) scale(1); opacity: 1; }
    }
    
    .ci-scroll-btn {
      animation: bounceIn 0.2s ease-out forwards;
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
// CHAT MESSAGE - With sentence fade-in for streaming
// ============================================================================
const ChatMessage = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  
  // Split content into sentences for fade-in effect during streaming
  const renderContent = () => {
    if (isUser) {
      return <div className="whitespace-pre-wrap">{message.content}</div>;
    }
    
    // For completed messages, use markdown
    if (!message.streaming) {
      return (
        <div className="ci-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {message.content}
          </ReactMarkdown>
        </div>
      );
    }
    
    // For streaming messages, split by sentences and fade each in
    const sentences = message.sentences || [];
    const pendingText = message.pendingText || '';
    
    return (
      <div className="ci-markdown">
        {sentences.map((sentence, idx) => (
          <span key={idx} className="ci-sentence">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
              p: ({ children }) => <span>{children} </span>
            }}>
              {sentence}
            </ReactMarkdown>
          </span>
        ))}
        {pendingText && (
          <span className="opacity-50">{pendingText}</span>
        )}
        <span className="ci-cursor" />
      </div>
    );
  };
  
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
        {renderContent()}
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
// SCROLL TO BOTTOM BUTTON
// ============================================================================
const ScrollToBottomButton = ({ onClick, visible }) => {
  if (!visible) return null;
  
  return (
    <button
      onClick={onClick}
      className="ci-scroll-btn absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white shadow-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-2"
      style={{ zIndex: 10 }}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
      New messages
    </button>
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

const getSelectedAdStorageKey = (storeId) => (storeId ? `creative-intelligence:${storeId}:selected-ad` : null);

const getChatStorageKey = (storeId, adId) => (
  storeId && adId ? `creative-intelligence:${storeId}:chat:${adId}` : null
);

// Sentence boundary detection
const splitIntoSentences = (text) => {
  // Split on sentence-ending punctuation followed by space or end
  const regex = /[^.!?\n]+[.!?\n]+\s*/g;
  const matches = text.match(regex) || [];
  return matches;
};

// ============================================================================
// SMOOTH SCROLL HOOK - Using requestAnimationFrame + lerp
// ============================================================================
const useSmoothScroll = (containerRef, enabled) => {
  const targetScrollRef = useRef(0);
  const animatingRef = useRef(false);
  const isUserScrolledUpRef = useRef(false);
  
  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    const threshold = 8;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, [containerRef]);
  
  const scrollToBottom = useCallback((smooth = true) => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    
    if (!smooth) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    
    targetScrollRef.current = container.scrollHeight;
    
    if (animatingRef.current) return;
    animatingRef.current = true;
    
    const animate = () => {
      const container = containerRef.current;
      if (!container) {
        animatingRef.current = false;
        return;
      }
      if (!enabled || isUserScrolledUpRef.current) {
        animatingRef.current = false;
        return;
      }
      
      const current = container.scrollTop;
      const target = container.scrollHeight; // Always chase latest
      const distance = target - current;
      
      // Lerp - move 12% of remaining distance each frame
      const step = distance * 0.12;
      
      if (Math.abs(distance) > 1) {
        container.scrollTop = current + step;
        requestAnimationFrame(animate);
      } else {
        container.scrollTop = target;
        animatingRef.current = false;
      }
    };
    
    requestAnimationFrame(animate);
  }, [containerRef, enabled]);
  
  const handleUserScroll = useCallback(() => {
    if (!enabled) return;
    isUserScrolledUpRef.current = !checkIfAtBottom();
  }, [checkIfAtBottom, enabled]);
  
  const isUserScrolledUp = useCallback(() => {
    return isUserScrolledUpRef.current;
  }, []);
  
  const resetUserScroll = useCallback(() => {
    isUserScrolledUpRef.current = false;
  }, []);
  
  return {
    scrollToBottom,
    checkIfAtBottom,
    handleUserScroll,
    isUserScrolledUp,
    resetUserScroll
  };
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function CreativeIntelligence({ store }) {
  useEffect(() => { injectGlobalStyles(); }, []);
  
  const storeId = typeof store === 'string' ? store : store?.id;
  const storageKey = storeId ? `creativeIntelligenceState:${storeId}` : null;
  
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
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [debugEvents, setDebugEvents] = useState([]);
  const [geminiTranscript, setGeminiTranscript] = useState('');
  const [geminiFullTranscript, setGeminiFullTranscript] = useState('');

  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewAd, setPreviewAd] = useState(null);
  const [previewVideoData, setPreviewVideoData] = useState(null);
  const [previewVideoLoading, setPreviewVideoLoading] = useState(false);
  const [previewVideoError, setPreviewVideoError] = useState('');
  const [previewMediaDimensions, setPreviewMediaDimensions] = useState({ width: null, height: null });
  const previewVideoRef = useRef(null);
  const previewImageRef = useRef(null);
  
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [savedSelectedAdId, setSavedSelectedAdId] = useState(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(null);
  const [restoredState, setRestoredState] = useState(null);
  
  const chatEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const hasRestoredSelection = useRef(false);
  
  // Debug event logger
  const pushDebugEvent = useCallback((entry) => {
    const timestamp = new Date().toISOString();
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setDebugEvents((prev) => [{ id, timestamp, ...entry }, ...prev].slice(0, 20));
  }, []);

  // Extract transcripts when script status changes
  useEffect(() => {
    if (scriptStatus?.status === 'complete' && scriptStatus?.script) {
      setGeminiTranscript(extractGeminiTranscript(scriptStatus.script));
      setGeminiFullTranscript(extractGeminiFullTranscript(scriptStatus.script));
    }
  }, [scriptStatus]);

  // Load debug events from localStorage
  useEffect(() => {
    if (!selectedAd?.id || !storeId) return;
    const key = `creative-debug-${storeId}-${selectedAd.id}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        setDebugEvents(JSON.parse(stored));
      } catch (err) {
        console.warn('Failed to parse stored debug events:', err);
        setDebugEvents([]);
      }
    } else {
      setDebugEvents([]);
    }
  }, [selectedAd?.id, storeId]);

  // Save debug events to localStorage
  useEffect(() => {
    if (!selectedAd?.id || !storeId) return;
    const key = `creative-debug-${storeId}-${selectedAd.id}`;
    localStorage.setItem(key, JSON.stringify(debugEvents));
  }, [debugEvents, selectedAd?.id, storeId]);
  
  // Smooth scroll hook
  const { 
    scrollToBottom, 
    checkIfAtBottom, 
    handleUserScroll, 
    isUserScrolledUp,
    resetUserScroll 
  } = useSmoothScroll(chatContainerRef, settings?.autoScroll ?? true);

  // Handle scroll events to detect user scrolling up
  useEffect(() => {
    if (!settings?.autoScroll) {
      setShowScrollButton(false);
      return;
    }
    const container = chatContainerRef.current;
    if (!container) return;
    
    const onScroll = () => {
      handleUserScroll();
      // Show scroll button if user scrolled up during streaming
      if (chatLoading && isUserScrolledUp()) {
        setShowScrollButton(true);
      } else if (checkIfAtBottom()) {
        setShowScrollButton(false);
      }
    };
    
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [handleUserScroll, isUserScrolledUp, checkIfAtBottom, chatLoading, settings?.autoScroll]);

  // Auto-scroll logic
  useEffect(() => {
    if (!settings?.autoScroll) return;
    if (isUserScrolledUp()) return;
    
    // Only scroll if at bottom or new message from user
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (lastMessage?.role === 'user') {
      resetUserScroll();
      scrollToBottom(true);
    } else if (lastMessage?.streaming && checkIfAtBottom()) {
      scrollToBottom(true);
    }
  }, [chatMessages, settings?.autoScroll, scrollToBottom, checkIfAtBottom, isUserScrolledUp, resetUserScroll]);

  // Smooth scroll to bottom when streaming completes
  useEffect(() => {
    if (!settings?.autoScroll) return;
    if (isUserScrolledUp()) return;
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (lastMessage && !lastMessage.streaming) {
      setTimeout(() => scrollToBottom(true), 100);
    }
  }, [chatMessages, settings?.autoScroll, scrollToBottom, isUserScrolledUp]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      setRestoredState(saved ? JSON.parse(saved) : null);
    } catch (err) {
      console.error('Error reading localStorage:', err);
      setRestoredState(null);
    }
  }, [storageKey]);

  useEffect(() => {
    hasRestoredSelection.current = false;
  }, [storeId]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const payload = {
        selectedAccount,
        selectedCampaign,
        selectedAdId: selectedAd?.id || null,
        conversationId
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (err) {
      console.error('Error writing localStorage:', err);
    }
  }, [storageKey, selectedAccount, selectedCampaign, selectedAd?.id, conversationId]);

  const hydrateChatForAd = useCallback((adId) => {
    const key = getChatStorageKey(storeId, adId);
    if (!key) {
      setChatMessages([]);
      setConversationId(null);
      return;
    }

    try {
      const saved = localStorage.getItem(key);
      if (!saved) {
        setChatMessages([]);
        setConversationId(null);
        return;
      }

      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed?.messages)) {
        setChatMessages(parsed.messages);
      } else {
        setChatMessages([]);
      }
      setConversationId(parsed?.conversationId ?? null);
    } catch (error) {
      console.error('Error reading localStorage:', error);
      setChatMessages([]);
      setConversationId(null);
    }
  }, [storeId]);

  const loadConversation = useCallback(async (conversationToLoad) => {
    if (!conversationToLoad) return;
    try {
      const res = await fetch(`${API_BASE}/creative-intelligence/conversations/${conversationToLoad}`);
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setChatMessages(Array.isArray(data?.messages) ? data.messages : []);
      setConversationId(data?.conversation?.id ?? conversationToLoad);
    } catch (err) {
      console.error('Error loading conversation:', err);
      setError(err?.message || 'Failed to load conversation');
    }
  }, []);

  const handleSelectAd = useCallback(async (ad, options = {}) => {
    const { resetChat = true, restoreConversationId = null } = options;
    setSelectedAd(ad);
    setLoadingVideo(true);
    setVideoData(null);
    setScriptStatus(null);
    setTokenUsage({ gemini: null, sonnet: null });

    if (resetChat || !restoreConversationId) {
      hydrateChatForAd(ad?.id);
    }
    if (restoreConversationId) {
      await loadConversation(restoreConversationId);
    }

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
  }, [hydrateChatForAd, loadConversation, selectedAccount, storeId]);

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
        const preferred = restoredState?.selectedAccount;
        const nextAccount = preferred && filtered.some(acc => acc.id === preferred)
          ? preferred
          : filtered[0]?.id || '';
        if (nextAccount) setSelectedAccount(nextAccount);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingAccounts(false));
  }, [storeId, restoredState]);

  useEffect(() => {
    if (!storeId) return;
    const key = getSelectedAdStorageKey(storeId);
    if (!key) return;
    try {
      const saved = localStorage.getItem(key);
      setSavedSelectedAdId(saved);
    } catch (error) {
      console.error('Error reading localStorage:', error);
    }
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
        const preferred = restoredState?.selectedCampaign;
        const preferredCampaign = preferred && list.find(c => c.id === preferred);
        const active = list.find(c => (c?.effective_status || c?.status || '').toUpperCase() === 'ACTIVE');
        setSelectedCampaign(preferredCampaign?.id || active?.id || list[0]?.id || '');
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingCampaigns(false));
  }, [selectedAccount, storeId, restoredState]);

  // Fetch ads
  useEffect(() => {
    if (!selectedCampaign) { setAds([]); setScriptStatuses({}); return; }
    setLoadingAds(true);
    fetch(`${API_BASE}/meta/campaigns/${selectedCampaign}/ads?store=${storeId}&adAccountId=${selectedAccount}`)
      .then(res => res.json())
      .then(data => {
        const list = Array.isArray(data?.data) ? data.data : [];
        setAds(list);
        if (!hasRestoredSelection.current && restoredState?.selectedAdId) {
          const nextAd = list.find(ad => ad.id === restoredState.selectedAdId);
          if (nextAd) {
            hasRestoredSelection.current = true;
            handleSelectAd(nextAd, {
              resetChat: false,
              restoreConversationId: restoredState.conversationId
            });
          }
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoadingAds(false));
  }, [selectedCampaign, selectedAccount, storeId, restoredState, handleSelectAd]);

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
      .then(data => {
        if (data.success) {
          // Ensure autoScroll has a default
          setSettings({ autoScroll: true, ...data.settings });
        }
      })
      .catch(console.error);
  }, [storeId]);

  useEffect(() => {
    if (!savedSelectedAdId || selectedAd) return;
    const matched = ads.find((ad) => ad.id === savedSelectedAdId);
    if (matched) {
      handleSelectAd(matched);
    }
  }, [ads, handleSelectAd, savedSelectedAdId, selectedAd]);

  useEffect(() => {
    if (!storeId) return;
    const key = getSelectedAdStorageKey(storeId);
    if (!key) return;
    try {
      if (selectedAd?.id) {
        localStorage.setItem(key, selectedAd.id);
      } else {
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.error('Error writing localStorage:', error);
    }
  }, [selectedAd, storeId]);

  // Analyze ad
  const handleAnalyze = async () => {
    if (!selectedAd || !videoData) return;
    setScriptStatus({ status: 'processing' });
    const startedAt = Date.now();
    const endpoint = `${API_BASE}/creative-intelligence/analyze-video`;

    const payload = {
      store: storeId,
      adId: selectedAd.id,
      adName: selectedAd.name,
      campaignId: selectedCampaign,
      campaignName: campaigns.find(c => c.id === selectedCampaign)?.name,
      sourceUrl: videoData.source_url,
      embedHtml: videoData.embed_html,
      thumbnailUrl: videoData.thumbnail_url,
      gemini_analysis_model: settings?.gemini_analysis_model
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let data;
      try {
        data = await res.json();
      } catch (parseError) {
        data = { error: 'Invalid JSON response', parseError: parseError.message };
      }
      const durationMs = Date.now() - startedAt;

      if (res.ok && data.success) {
        setScriptStatus({ exists: true, status: 'complete', script: data.script });
        setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'complete' }));
        setTokenUsage(prev => ({ ...prev, gemini: data.usage?.gemini ?? null }));
        setGeminiTranscript(extractGeminiTranscript(data.script));
        setGeminiFullTranscript(extractGeminiFullTranscript(data.script));
        setShowParticles(true);
        pushDebugEvent({
          action: 'Analyze',
          status: 'success',
          endpoint,
          durationMs,
          pathway: [
            'Creative tab → API',
            `${endpoint}`,
            `Gemini: ${data.model || settings?.gemini_analysis_model || 'gemini-2.5-flash-lite'}`
          ],
          details: {
            adId: selectedAd.id,
            campaignId: selectedCampaign,
            analysisType: data.analysisType,
            cached: data.cached ?? false,
            usage: data.usage?.gemini ?? null
          }
        });
      } else {
        setScriptStatus({ status: 'failed', error: data.error });
        setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'failed' }));
        pushDebugEvent({
          action: 'Analyze',
          status: 'failed',
          endpoint,
          durationMs,
          pathway: [
            'Creative tab → API',
            `${endpoint}`,
            `Gemini: ${data?.model || settings?.gemini_analysis_model || 'gemini-2.5-flash-lite'}`
          ],
          details: {
            adId: selectedAd.id,
            campaignId: selectedCampaign,
            statusCode: res.status,
            error: data?.error || 'Unknown error',
            payload
          }
        });
      }
    } catch (err) {
      setScriptStatus({ status: 'failed', error: err.message });
      setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'failed' }));
      pushDebugEvent({
        action: 'Analyze',
        status: 'failed',
        endpoint,
        durationMs: Date.now() - startedAt,
        pathway: [
          'Creative tab → API',
          `${endpoint}`,
          `Gemini: ${settings?.gemini_analysis_model || 'gemini-2.5-flash-lite'}`
        ],
        details: {
          adId: selectedAd.id,
          campaignId: selectedCampaign,
          error: err.message,
          payload
        }
      });
    }
  };

  const handleReanalyze = async () => {
    if (!selectedAd) return;
    await fetch(`${API_BASE}/creative-intelligence/script/${selectedAd.id}?store=${storeId}`, { method: 'DELETE' });
    setScriptStatus({ status: 'pending' });
    setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'pending' }));
    setChatMessages([]);
    setConversationId(null);
    setTokenUsage({ gemini: null, sonnet: null });
    setGeminiTranscript('');
    setGeminiFullTranscript('');
    await handleAnalyze();
  };

  // Send chat message with sentence-based streaming
  const handleSendMessage = async (msgText) => {
    const userMessage = (msgText || chatInput).trim();
    if (!userMessage || chatLoading) return;

    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatLoading(true);
    resetUserScroll();
    setShowScrollButton(false);

    const startedAt = Date.now();
    const endpoint = `${API_BASE}/creative-intelligence/chat`;
    const selectedModel = settings?.model || 'sonnet-4.5';
    const openAiModels = new Set(['gpt-5.1', 'gpt-5.2', 'gpt-5.2-pro']);
    const openAiStreamingModels = new Set(['gpt-5.2', 'gpt-5.2-pro']);
    const isOpenAI = openAiModels.has(selectedModel);
    const isDeepSeek = typeof selectedModel === 'string' && selectedModel.startsWith('deepseek-');
    const shouldStream = (settings?.streaming && !isOpenAI) || openAiStreamingModels.has(selectedModel);
    const reasoningEffort = settings?.reasoning_effort || 'medium';
    const buildModelLabel = (model = null) => {
      const labelModel = model || selectedModel;
      if (isOpenAI) return `OpenAI ${labelModel}`;
      if (isDeepSeek) return `DeepSeek ${labelModel}`;
      return `Claude: ${labelModel}`;
    };
    const requestPayload = {
      store: storeId,
      message: userMessage,
      adId: selectedAd?.id,
      conversationId,
      reasoning_effort: reasoningEffort
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!res.ok) {
        let errorData;
        try {
          errorData = await res.json();
        } catch (parseError) {
          errorData = { error: 'Invalid JSON response', parseError: parseError.message };
        }
        pushDebugEvent({
          action: 'Chat',
          status: 'failed',
          endpoint,
          durationMs: Date.now() - startedAt,
          pathway: [
            'Creative tab → API',
            `${endpoint}`,
            buildModelLabel()
          ],
          details: {
            statusCode: res.status,
            error: errorData?.error || 'Unknown error',
            conversationId,
            adId: selectedAd?.id,
            messageLength: userMessage.length
          }
        });
        throw new Error(errorData?.error || 'Chat request failed');
      }

      if (shouldStream) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let sentences = [];
        let pendingText = '';
        let modelUsed = null;
        let usage = null;

        // Add streaming message
        setChatMessages(prev => [...prev, { 
          role: 'assistant', 
          content: '', 
          streaming: true,
          sentences: [],
          pendingText: ''
        }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'delta') {
                  fullContent += data.text;
                  pendingText += data.text;
                  
                  // Check for sentence boundaries
                  const sentenceEnders = /([.!?]\s+|\n\n)/g;
                  let match;
                  let lastIndex = 0;
                  
                  while ((match = sentenceEnders.exec(pendingText)) !== null) {
                    const sentence = pendingText.slice(lastIndex, match.index + match[0].length);
                    if (sentence.trim()) {
                      sentences.push(sentence);
                    }
                    lastIndex = match.index + match[0].length;
                  }
                  
                  // Keep remaining text as pending
                  pendingText = pendingText.slice(lastIndex);
                  
                  setChatMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { 
                      role: 'assistant', 
                      content: fullContent,
                      streaming: true,
                      sentences: [...sentences],
                      pendingText
                    };
                    return updated;
                  });
                  
                } else if (data.type === 'done') {
                  // Add any remaining pending text as final sentence
                  if (pendingText.trim()) {
                    sentences.push(pendingText);
                  }
                  
                  setConversationId(data.conversationId);
                  modelUsed = data.model || modelUsed;
                  usage = data.usage || usage;
                  
                  if (!isOpenAI) setTokenUsage(prev => ({ ...prev, sonnet: usage ?? null }));
                  
                  setChatMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { 
                      role: 'assistant', 
                      content: fullContent,
                      streaming: false
                    };
                    return updated;
                  });
                  
                  pushDebugEvent({
                    action: 'Chat',
                    status: 'success',
                    endpoint,
                    durationMs: Date.now() - startedAt,
                    pathway: [
                      'Creative tab → API',
                      `${endpoint}`,
                      buildModelLabel(modelUsed)
                    ],
                    details: {
                      conversationId: data.conversationId,
                      adId: selectedAd?.id,
                      usage
                    }
                  });
                } else if (data.type === 'error') {
                  pushDebugEvent({
                    action: 'Chat',
                    status: 'failed',
                    endpoint,
                    durationMs: Date.now() - startedAt,
                    pathway: [
                      'Creative tab → API',
                      `${endpoint}`,
                      buildModelLabel(data.model)
                    ],
                    details: {
                      conversationId,
                      adId: selectedAd?.id,
                      error: data.error || 'Unknown streaming error'
                    }
                  });
                }
              } catch {}
            }
          }
        }
      } else {
        const data = await res.json();
        if (data.success) {
          setChatMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
          setConversationId(data.conversationId);
          setTokenUsage(prev => ({ ...prev, sonnet: data.usage ?? null }));
          pushDebugEvent({
            action: 'Chat',
            status: 'success',
            endpoint,
            durationMs: Date.now() - startedAt,
            pathway: [
              'Creative tab → API',
              `${endpoint}`,
              buildModelLabel(data.model)
            ],
            details: {
              conversationId: data.conversationId,
              adId: selectedAd?.id,
              usage: data.usage ?? null
            }
          });
        } else {
          pushDebugEvent({
            action: 'Chat',
            status: 'failed',
            endpoint,
            durationMs: Date.now() - startedAt,
            pathway: [
              'Creative tab → API',
              `${endpoint}`,
              buildModelLabel(data.model)
            ],
            details: {
              conversationId,
              adId: selectedAd?.id,
              error: data.error || 'Unknown chat error'
            }
          });
          setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error || 'Chat failed'}` }]);
        }
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
      pushDebugEvent({
        action: 'Chat',
        status: 'failed',
        endpoint,
        durationMs: Date.now() - startedAt,
        pathway: [
          'Creative tab → API',
          `${endpoint}`,
          buildModelLabel()
        ],
        details: {
          conversationId,
          adId: selectedAd?.id,
          error: err.message,
          messageLength: userMessage.length
        }
      });
    } finally {
      setChatLoading(false);
      setShowScrollButton(false);
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

  useEffect(() => {
    if (previewModalOpen && previewVideoRef.current) {
      previewVideoRef.current.play().catch(() => undefined);
    }
  }, [previewModalOpen, previewVideoData]);

  const previewModalMaxWidth = useMemo(() => {
    const width = previewMediaDimensions.width;
    const height = previewMediaDimensions.height;
    if (!width || !height) {
      return 'min(420px, 92vw)';
    }
    return width >= height ? 'min(960px, 92vw)' : 'min(420px, 92vw)';
  }, [previewMediaDimensions]);

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

  const handlePreviewAdClick = async (ad) => {
    setPreviewAd(ad);
    setPreviewModalOpen(true);
    setPreviewVideoLoading(true);
    setPreviewVideoError('');
    setPreviewVideoData(null);
    setPreviewMediaDimensions({ width: null, height: null });

    try {
      const res = await fetch(`${API_BASE}/meta/ads/${ad.id}/video?store=${storeId}&adAccountId=${selectedAccount}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load video');
      }
      setPreviewVideoData(data || EMPTY_VIDEO);
    } catch (err) {
      setPreviewVideoError(err?.message || 'Failed to load video');
      setPreviewVideoData(EMPTY_VIDEO);
    } finally {
      setPreviewVideoLoading(false);
    }
  };

  const closePreviewModal = () => {
    setPreviewModalOpen(false);
    setPreviewAd(null);
    setPreviewVideoData(null);
    setPreviewVideoError('');
    setPreviewMediaDimensions({ width: null, height: null });
  };

  const previewHasVideo = !!(previewVideoData?.source_url);
  const previewHasEmbed = !previewHasVideo && !!(previewVideoData?.embed_html);
  const previewHasThumbnail = !previewHasVideo && !!(previewVideoData?.thumbnail_url || previewAd?.thumbnail);
  const previewDisplayThumbnail = previewVideoData?.thumbnail_url || previewAd?.thumbnail;
  const previewShowPermissionFallback = !previewHasVideo && !previewHasEmbed && previewHasThumbnail && previewVideoData?.source_url === null;
  const previewShowNoVideo = !previewHasVideo && !previewHasEmbed && !previewHasThumbnail;
  const previewFallbackMessage = previewVideoData?.message || 'No video found for this ad.';

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

      <div className="flex" style={{ height: 'calc(100vh - 73px)' }}>
        {/* Left Panel */}
        <div className="w-80 border-r overflow-y-auto flex-shrink-0" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
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
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); handlePreviewAdClick(ad); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            handlePreviewAdClick(ad);
                          }
                        }}
                        className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0"
                        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
                      >
                        <img src={ad.thumbnail} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={(event) => { event.stopPropagation(); handlePreviewAdClick(ad); }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            event.stopPropagation();
                            handlePreviewAdClick(ad);
                          }
                        }}
                        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: colors.bgSubtle }}
                      >
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

        {/* Right Panel - Fixed height, no page scroll */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!selectedAd ? <EmptyState /> : (
            <>
              {/* Ad Header */}
              <div className="px-6 py-4 border-b flex-shrink-0" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
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

              {/* Chat with Aura - Fixed height container */}
              <div
                className={`ci-chat-container m-6 rounded-2xl border transition-all duration-300 ${chatLoading ? 'ci-aura-active' : 'ci-shadow-glow'}`}
                style={{ 
                  borderColor: chatLoading ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.08)', 
                  backgroundColor: colors.card, 
                  position: 'relative',
                  flex: '1 1 0%',
                  minHeight: 0
                }}
              >
                <ParticleExplosion active={showParticles} onDone={() => setShowParticles(false)} />
                
                {/* Messages - Scrollable container */}
                <div 
                  ref={chatContainerRef}
                  className="ci-chat-messages p-6"
                >
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center" style={{ minHeight: '300px' }}>
                      <div className="text-center max-w-md">
                        <div className="text-5xl mb-6">💬</div>
                        <h3 className="text-lg font-semibold mb-2" style={{ color: colors.text }}>Ask Claude about this ad</h3>
                        <p className="text-sm mb-6" style={{ color: colors.textSecondary }}>Get insights on why it works, compare to other ads, or generate new variations</p>
                        <SuggestionChips onSelect={handleSendMessage} disabled={scriptStatus?.status !== 'complete' || chatLoading} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      {chatMessages.map((msg, i) => (
                        <ChatMessage key={i} message={msg} isStreaming={msg.streaming} />
                      ))}
                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>
                
                {/* Scroll to bottom button */}
                <ScrollToBottomButton 
                  visible={showScrollButton} 
                  onClick={() => {
                    setShowScrollButton(false);
                    resetUserScroll();
                    scrollToBottom(true);
                  }} 
                />

                {/* Input */}
                <div className="p-4 border-t flex-shrink-0" style={{ borderColor: colors.borderLight }}>
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

              {/* Debug - Collapsible */}
              <div className="mx-6 mb-6 rounded-2xl border overflow-hidden flex-shrink-0" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
                <button onClick={() => setDebugOpen(!debugOpen)} className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium hover:bg-gray-50 transition-colors" style={{ color: colors.text }}>
                  <span>Debugging & Token Usage</span>
                  <span className="text-xs" style={{ color: colors.textMuted }}>{debugOpen ? 'Collapse' : 'Expand'}</span>
                </button>
                {debugOpen && (
                  <div className="p-4 space-y-4 max-h-72 overflow-y-auto">
                    <div className="text-xs" style={{ color: colors.textSecondary }}>
                      Connection pathways, failures, and token usage from Gemini + Sonnet.
                    </div>
                    <div className="grid gap-3 text-xs" style={{ color: colors.textSecondary }}>
                      <div>
                        <span className="font-semibold text-gray-700">Gemini tokens:</span>{' '}
                        {tokenUsage.gemini
                          ? `total ${tokenUsage.gemini.totalTokens ?? 'n/a'} (prompt ${tokenUsage.gemini.promptTokens ?? 'n/a'}, output ${tokenUsage.gemini.outputTokens ?? 'n/a'})`
                          : 'Not reported yet'}
                      </div>
                      <div>
                        <span className="font-semibold text-gray-700">Sonnet tokens:</span>{' '}
                        {tokenUsage.sonnet
                          ? `input ${tokenUsage.sonnet.input_tokens ?? 'n/a'}, output ${tokenUsage.sonnet.output_tokens ?? 'n/a'}`
                          : 'Not reported yet'}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-gray-700">Connection log</div>
                      {debugEvents.length === 0 ? (
                        <div className="text-xs" style={{ color: colors.textSecondary }}>
                          No debug events yet. Run Analyze or send a chat prompt to populate this.
                        </div>
                      ) : (
                        <div className="max-h-48 overflow-y-auto space-y-2">
                          {debugEvents.map((event) => (
                            <div key={event.id} className="rounded-lg border p-2" style={{ borderColor: colors.border }}>
                              <div className="flex items-center justify-between text-[11px] text-gray-500">
                                <span>{new Date(event.timestamp).toLocaleString()}</span>
                                <span className={event.status === 'failed' ? 'text-red-500' : 'text-green-600'}>
                                  {event.action} {event.status}
                                </span>
                              </div>
                              <div className="mt-1 text-[11px] text-gray-600">
                                <div><span className="font-semibold">Endpoint:</span> {event.endpoint}</div>
                                {event.durationMs != null && (
                                  <div><span className="font-semibold">Duration:</span> {event.durationMs}ms</div>
                                )}
                                {event.pathway && (
                                  <div>
                                    <span className="font-semibold">Pathway:</span>
                                    <ul className="list-disc ml-4">
                                      {event.pathway.map((step, index) => (
                                        <li key={`${event.id}-path-${index}`}>{step}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {event.details && (
                                  <div className="mt-1 whitespace-pre-wrap">
                                    <span className="font-semibold">Details:</span>{' '}
                                    {JSON.stringify(event.details, null, 2)}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-semibold text-gray-700">Gemini transcript (extracted audio)</div>
                        <div className="text-[11px] text-gray-600 whitespace-pre-wrap max-h-32 overflow-y-auto border rounded-lg p-2" style={{ borderColor: colors.border }}>
                          {geminiTranscript || 'No transcript extracted yet.'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-700">Gemini transcript (full audio + on-screen)</div>
                        <div className="text-[11px] text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto border rounded-lg p-2" style={{ borderColor: colors.border }}>
                          {geminiFullTranscript || 'No transcript extracted yet.'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Preview Modal */}
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
              <button onClick={closePreviewModal} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              <div className="flex items-center justify-center">
                {previewVideoLoading && (
                  <div className="text-sm text-gray-500">Loading media...</div>
                )}

                {!previewVideoLoading && previewVideoError && (
                  <div className="text-sm text-red-600">{previewVideoError}</div>
                )}

                {!previewVideoLoading && previewHasVideo && (
                  <video
                    ref={previewVideoRef}
                    src={previewVideoData.source_url}
                    autoPlay
                    controls
                    onLoadedMetadata={handlePreviewVideoMetadata}
                    className="w-full h-auto max-h-[85vh] object-contain"
                  />
                )}

                {!previewVideoLoading && previewHasEmbed && (
                  <div
                    className="w-full flex justify-center"
                    dangerouslySetInnerHTML={{ __html: previewVideoData.embed_html }}
                  />
                )}

                {!previewVideoLoading && !previewHasVideo && previewHasThumbnail && (
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

                {!previewVideoLoading && previewShowNoVideo && (
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
// SETTINGS MODAL - With auto-scroll toggle
// ============================================================================
function SettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    model: settings?.model || 'sonnet-4.5',
    gemini_analysis_model: settings?.gemini_analysis_model || 'gemini-2.5-flash-lite',
    reasoning_effort: settings?.reasoning_effort || 'medium',
    temperature: settings?.temperature ?? 1.0,
    streaming: typeof settings?.model === 'string' && settings.model.startsWith('deepseek-') ? true : (settings?.streaming ?? true),
    autoScroll: settings?.autoScroll ?? true,
    capabilities: settings?.capabilities || { analyze: true, clone: true, ideate: true, audit: true }
  });

  const openAiEffortOptions = { 'gpt-5.2': ['none', 'medium', 'xhigh'], 'gpt-5.2-pro': ['none', 'medium', 'xhigh'], 'gpt-5.1': ['medium'] };
  const isOpenAiModel = ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1'].includes(form.model);
  const isDeepSeekModel = typeof form.model === 'string' && form.model.startsWith('deepseek-');
  const allowedEfforts = openAiEffortOptions[form.model] || ['medium'];

  const updateModel = (value) => {
    setForm(prev => ({
      ...prev,
      model: value,
      reasoning_effort: openAiEffortOptions[value]?.includes(prev.reasoning_effort) ? prev.reasoning_effort : (openAiEffortOptions[value]?.[0] || prev.reasoning_effort),
      // DeepSeek is wired for streaming-first UX across the app.
      streaming: typeof value === 'string' && value.startsWith('deepseek-') ? true : prev.streaming
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
                { value: 'gpt-5.2-pro', name: 'GPT-5.2 Pro', badge: 'OpenAI Pro', badgeColor: '#10B981', desc: 'Maximum reasoning' },
                { value: 'deepseek-chat', name: 'DeepSeek Chat', badge: 'DeepSeek', badgeColor: '#0EA5E9', desc: 'Non-thinking mode (fast)' },
                { value: 'deepseek-reasoner', name: 'DeepSeek Reasoner', badge: 'DeepSeek', badgeColor: '#0EA5E9', desc: 'Thinking mode (best conclusions)' }
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

          {/* Gemini analysis model */}
          <div>
            <label className="block text-sm font-semibold mb-3" style={{ color: colors.text }}>Analyze button (Gemini)</label>
            <div className="space-y-2">
              {[
                { value: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', badge: 'Fast', badgeColor: colors.success, desc: 'Lower cost, great for most creatives' },
                { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', badge: 'Stronger', badgeColor: colors.warning, desc: 'More capable analysis, slightly slower' }
              ].map(m => (
                <label
                  key={m.value}
                  className={`flex items-start gap-3 p-4 rounded-2xl border cursor-pointer transition-all ${form.gemini_analysis_model === m.value ? 'ci-shadow-soft' : 'hover:bg-gray-50'}`}
                  style={{ borderColor: form.gemini_analysis_model === m.value ? colors.accent : colors.border, backgroundColor: form.gemini_analysis_model === m.value ? colors.accentLight : colors.card }}
                >
                  <input
                    type="radio"
                    name="gemini_analysis_model"
                    value={m.value}
                    checked={form.gemini_analysis_model === m.value}
                    onChange={(e) => setForm(prev => ({ ...prev, gemini_analysis_model: e.target.value }))}
                    className="mt-1 accent-indigo-500"
                  />
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

          {/* Temperature (DeepSeek only) */}
          {isDeepSeekModel && (
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: colors.text }}>Temperature</label>
              <select
                value={String(form.temperature)}
                onChange={(e) => setForm(prev => ({ ...prev, temperature: Number(e.target.value) }))}
                className="w-full px-4 py-3 text-sm rounded-xl border focus:outline-none"
                style={{ borderColor: colors.border }}
              >
                <option value="0">Coding / Math (0.0)</option>
                <option value="1">Data Analysis (1.0)</option>
                <option value="1.3">General / Translation (1.3)</option>
                <option value="1.5">Creative Writing (1.5)</option>
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
              <div className="text-sm" style={{ color: colors.textSecondary }}>
                {isDeepSeekModel ? 'DeepSeek always streams.' : 'See responses as they generate'}
              </div>
            </div>
            <input
              type="checkbox"
              checked={form.streaming}
              disabled={isDeepSeekModel}
              onChange={(e) => setForm(prev => ({ ...prev, streaming: e.target.checked }))}
              className="w-5 h-5 accent-indigo-500 disabled:opacity-60"
            />
          </label>

          {/* Auto-scroll Toggle */}
          <label className="flex items-center justify-between p-4 rounded-2xl border cursor-pointer hover:bg-gray-50" style={{ borderColor: colors.border }}>
            <div>
              <div className="font-medium" style={{ color: colors.text }}>Auto-scroll</div>
              <div className="text-sm" style={{ color: colors.textSecondary }}>Automatically scroll as response streams in</div>
            </div>
            <input type="checkbox" checked={form.autoScroll} onChange={(e) => setForm(prev => ({ ...prev, autoScroll: e.target.checked }))} className="w-5 h-5 accent-indigo-500" />
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
