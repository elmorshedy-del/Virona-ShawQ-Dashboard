import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = '/api';

// ============================================================================
// DESIGN TOKENS
// ============================================================================
const colors = {
  bg: '#FAFBFC',
  card: '#FFFFFF',
  border: '#E5E7EB',
  borderHover: '#D1D5DB',
  text: '#111827',
  textSecondary: '#6B7280',
  accent: '#6366F1',
  accentLight: '#F5F3FF',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444'
};

const filterStoreAccounts = (accounts, storeId) => {
  if (!Array.isArray(accounts)) return [];
  if (storeId === 'vironax') {
    const matches = accounts.filter((account) => /virona shop/i.test(account?.name || ''));
    return matches.length > 0 ? matches : accounts;
  }
  if (storeId === 'shawq') {
    const matches = accounts.filter((account) => /shawq\.co/i.test(account?.name || ''));
    return matches.length > 0 ? matches : accounts;
  }
  return accounts;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function CreativeIntelligence({ store }) {
  const storeId = typeof store === 'string' ? store : store?.id;
  // Data states
  const [adAccounts, setAdAccounts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [ads, setAds] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [selectedAd, setSelectedAd] = useState(null);
  const [scriptStatuses, setScriptStatuses] = useState({});
  
  // Loading states
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingAds, setLoadingAds] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(false);
  
  // UI states
  const [error, setError] = useState('');
  const [showInactiveCampaigns, setShowInactiveCampaigns] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // all, analyzed, pending
  const [videoData, setVideoData] = useState(null);
  const [scriptStatus, setScriptStatus] = useState(null);
  
  // Chat states
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  
  // Settings states
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(null);
  const [debugInfo, setDebugInfo] = useState({ analyze: null, chat: null });
  
  // Refs
  const videoRef = useRef(null);
  const chatEndRef = useRef(null);
  const buildTranscript = (scriptData) => {
    if (scriptData?.analysisType !== 'video_frames' || !Array.isArray(scriptData.frames)) return null;
    const lines = scriptData.frames
      .map(frame => {
        const voiceover = typeof frame?.voiceover === 'string' ? frame.voiceover.trim() : '';
        if (!voiceover || voiceover.toLowerCase() === 'none') return null;
        const time = frame?.time ? `${frame.time} ` : '';
        return `${time}${voiceover}`;
      })
      .filter(Boolean);
    return lines.length ? lines.join('\n') : null;
  };

  // ============================================================================
  // FETCH AD ACCOUNTS
  // ============================================================================
  useEffect(() => {
    if (!storeId) return undefined;

    let mounted = true;
    setLoadingAccounts(true);
    
    fetch(`${API_BASE}/meta/adaccounts?store=${storeId}`)
      .then(res => res.json())
      .then(data => {
        if (!mounted) return;
        const list = Array.isArray(data?.data) ? data.data : [];
        const filtered = filterStoreAccounts(list, storeId);
        setAdAccounts(filtered);
        if (filtered.length > 0) setSelectedAccount(filtered[0].id);
      })
      .catch(err => mounted && setError(err.message))
      .finally(() => mounted && setLoadingAccounts(false));

    return () => { mounted = false; };
  }, [storeId]);

  // ============================================================================
  // FETCH CAMPAIGNS
  // ============================================================================
  useEffect(() => {
    if (!selectedAccount) {
      setCampaigns([]);
      setSelectedCampaign('');
      return;
    }

    let mounted = true;
    setLoadingCampaigns(true);
    
    fetch(`${API_BASE}/meta/campaigns?store=${storeId}&adAccountId=${selectedAccount}`)
      .then(res => res.json())
      .then(data => {
        if (!mounted) return;
        const list = Array.isArray(data?.data) ? data.data : [];
        setCampaigns(list);
        const active = list.find(c => 
          (c?.effective_status || c?.status || '').toUpperCase() === 'ACTIVE'
        );
        setSelectedCampaign(active?.id || list[0]?.id || '');
      })
      .catch(err => mounted && setError(err.message))
      .finally(() => mounted && setLoadingCampaigns(false));

    return () => { mounted = false; };
  }, [selectedAccount, storeId]);

  // ============================================================================
  // FETCH ADS
  // ============================================================================
  useEffect(() => {
    if (!selectedCampaign) {
      setAds([]);
      setScriptStatuses({});
      return;
    }

    let mounted = true;
    setLoadingAds(true);
    
    fetch(`${API_BASE}/meta/campaigns/${selectedCampaign}/ads?store=${storeId}&adAccountId=${selectedAccount}`)
      .then(res => res.json())
      .then(data => {
        if (!mounted) return;
        setAds(Array.isArray(data?.data) ? data.data : []);
      })
      .catch(err => mounted && setError(err.message))
      .finally(() => mounted && setLoadingAds(false));

    return () => { mounted = false; };
  }, [selectedCampaign, selectedAccount, storeId]);

  useEffect(() => {
    if (!storeId || !selectedCampaign || ads.length === 0) {
      setScriptStatuses({});
      return;
    }

    let mounted = true;
    fetch(`${API_BASE}/creative-intelligence/scripts?store=${storeId}&campaignId=${selectedCampaign}`)
      .then(res => res.json())
      .then(data => {
        if (!mounted) return;
        const nextStatuses = {};
        const scripts = Array.isArray(data?.scripts) ? data.scripts : [];
        scripts.forEach((script) => {
          if (script?.ad_id) {
            nextStatuses[script.ad_id] = script.status || 'pending';
          }
        });
        setScriptStatuses(nextStatuses);
      })
      .catch(() => mounted && setScriptStatuses({}));

    return () => { mounted = false; };
  }, [storeId, selectedCampaign, ads.length]);

  // ============================================================================
  // FETCH SETTINGS
  // ============================================================================
  useEffect(() => {
    if (!storeId) return;

    fetch(`${API_BASE}/creative-intelligence/settings?store=${storeId}`)
      .then(res => res.json())
      .then(data => data.success && setSettings(data.settings))
      .catch(console.error);
  }, [storeId]);

  // ============================================================================
  // HANDLE AD SELECTION
  // ============================================================================
  const handleSelectAd = async (ad) => {
    setSelectedAd(ad);
    setLoadingVideo(true);
    setVideoData(null);
    setScriptStatus(null);
    setChatMessages([]);
    setConversationId(null);
    setDebugInfo({ analyze: null, chat: null });

    try {
      // Fetch video data
      const videoRes = await fetch(
        `${API_BASE}/meta/ads/${ad.id}/video?store=${storeId}&adAccountId=${selectedAccount}`
      );
      const video = await videoRes.json();
      setVideoData(video);

      // Check script status
      const scriptRes = await fetch(
        `${API_BASE}/creative-intelligence/script/${ad.id}?store=${storeId}`
      );
      const script = await scriptRes.json();
      setScriptStatus(script);
      setScriptStatuses(prev => ({
        ...prev,
        [ad.id]: script?.status || (script?.exists ? 'pending' : 'pending')
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingVideo(false);
    }
  };

  // ============================================================================
  // ANALYZE AD
  // ============================================================================
  const handleAnalyze = async () => {
    if (!selectedAd || !videoData) return;
    
    setScriptStatus({ status: 'processing' });
    const analyzeEndpoint = `${API_BASE}/creative-intelligence/analyze-video`;

    setDebugInfo(prev => ({
      ...prev,
      analyze: {
        status: 'running',
        endpoint: analyzeEndpoint,
        steps: [
          `Client → API: POST ${analyzeEndpoint}`,
          'API → Gemini: pending'
        ],
        error: null,
        usage: null,
        transcript: null,
        analysisType: null,
        cached: false,
        timestamp: new Date().toISOString()
      }
    }));

    try {
      const campaign = campaigns.find(c => c.id === selectedCampaign);
      
      const res = await fetch(analyzeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: storeId,
          adId: selectedAd.id,
          adName: selectedAd.name,
          campaignId: selectedCampaign,
          campaignName: campaign?.name,
          sourceUrl: videoData.source_url,
          embedHtml: videoData.embed_html,
          thumbnailUrl: videoData.thumbnail_url
        })
      });

      const data = await res.json();
      
      if (res.ok && data.success) {
        const transcript = buildTranscript(data.script);
        setScriptStatus({ exists: true, status: 'complete', script: data.script });
        setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'complete' }));
        setDebugInfo(prev => ({
          ...prev,
          analyze: {
            ...prev.analyze,
            status: 'success',
            steps: [
              `Client → API: POST ${analyzeEndpoint}`,
              `API → Gemini: ${data.analysisType || data.script?.analysisType || 'analysis'}`,
              'Gemini → API: success',
              `API → Client: ${res.status}`
            ],
            usage: data.usage || null,
            transcript,
            analysisType: data.analysisType || data.script?.analysisType || null,
            cached: data.cached || false,
            error: null
          }
        }));
      } else {
        const errorMessage = data?.error || `Request failed with status ${res.status}`;
        setScriptStatus({ status: 'failed', error: data.error });
        setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'failed' }));
        setDebugInfo(prev => ({
          ...prev,
          analyze: {
            ...prev.analyze,
            status: 'failed',
            steps: [
              `Client → API: POST ${analyzeEndpoint}`,
              'API → Gemini: failed',
              `API → Client: ${res.status}`
            ],
            error: { message: errorMessage, status: res.status },
            usage: data.usage || null
          }
        }));
      }
    } catch (err) {
      setScriptStatus({ status: 'failed', error: err.message });
      setScriptStatuses(prev => ({ ...prev, [selectedAd.id]: 'failed' }));
      setDebugInfo(prev => ({
        ...prev,
        analyze: {
          ...prev.analyze,
          status: 'failed',
          steps: [
            `Client → API: POST ${analyzeEndpoint}`,
            'API → Gemini: failed'
          ],
          error: { message: err.message }
        }
      }));
    }
  };

  // ============================================================================
  // SEND CHAT MESSAGE
  // ============================================================================
  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatLoading(true);
    const chatEndpoint = `${API_BASE}/creative-intelligence/chat`;

    setDebugInfo(prev => ({
      ...prev,
      chat: {
        status: 'running',
        endpoint: chatEndpoint,
        model: settings?.model || 'sonnet-4.5',
        steps: [
          `Client → API: POST ${chatEndpoint}`,
          `API → Claude (${settings?.model || 'sonnet-4.5'})`
        ],
        error: null,
        usage: null,
        timestamp: new Date().toISOString()
      }
    }));

    try {
      const res = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: storeId,
          message: userMessage,
          adId: selectedAd?.id,
          conversationId
        })
      });

      if (settings?.streaming) {
        // Handle streaming response
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = '';

        setChatMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'delta') {
                  assistantMessage += data.text;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: 'assistant', content: assistantMessage, streaming: true };
                    return updated;
                  });
                } else if (data.type === 'done') {
                  setConversationId(data.conversationId);
                  setChatMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: 'assistant', content: assistantMessage };
                    return updated;
                  });
                  setDebugInfo(prev => ({
                    ...prev,
                    chat: {
                      ...prev.chat,
                      status: 'success',
                      steps: [
                        `Client → API: POST ${chatEndpoint}`,
                        `API → Claude (${settings?.model || 'sonnet-4.5'})`,
                        `API → Client: ${res.status}`
                      ],
                      usage: data.usage || null,
                      error: null
                    }
                  }));
                } else if (data.type === 'error') {
                  setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
                  setDebugInfo(prev => ({
                    ...prev,
                    chat: {
                      ...prev.chat,
                      status: 'failed',
                      steps: [
                        `Client → API: POST ${chatEndpoint}`,
                        `API → Claude (${settings?.model || 'sonnet-4.5'})`,
                        `API → Client: ${res.status}`
                      ],
                      error: { message: data.error, status: res.status }
                    }
                  }));
                }
              } catch {}
            }
          }
        }
      } else {
        // Non-streaming response
        const data = await res.json();
        if (res.ok && data.success) {
          setChatMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
          setConversationId(data.conversationId);
          setDebugInfo(prev => ({
            ...prev,
            chat: {
              ...prev.chat,
              status: 'success',
              steps: [
                `Client → API: POST ${chatEndpoint}`,
                `API → Claude (${settings?.model || 'sonnet-4.5'})`,
                `API → Client: ${res.status}`
              ],
              usage: data.usage || null,
              error: null
            }
          }));
        } else {
          const errorMessage = data?.error || `Request failed with status ${res.status}`;
          setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMessage}` }]);
          setDebugInfo(prev => ({
            ...prev,
            chat: {
              ...prev.chat,
              status: 'failed',
              steps: [
                `Client → API: POST ${chatEndpoint}`,
                `API → Claude (${settings?.model || 'sonnet-4.5'})`,
                `API → Client: ${res.status}`
              ],
              error: { message: errorMessage, status: res.status }
            }
          }));
        }
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
      setDebugInfo(prev => ({
        ...prev,
        chat: {
          ...prev.chat,
          status: 'failed',
          steps: [
            `Client → API: POST ${chatEndpoint}`,
            `API → Claude (${settings?.model || 'sonnet-4.5'})`
          ],
          error: { message: err.message }
        }
      }));
    } finally {
      setChatLoading(false);
    }
  };

  // ============================================================================
  // SAVE SETTINGS
  // ============================================================================
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
      console.error('Failed to save settings:', err);
    }
  };

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ============================================================================
  // DERIVED DATA
  // ============================================================================
  const campaignRows = useMemo(() => {
    return campaigns.map(c => ({
      id: c.id,
      name: c.name || c.id,
      status: (c?.effective_status || c?.status || 'UNKNOWN').toUpperCase(),
      isActive: (c?.effective_status || c?.status || '').toUpperCase() === 'ACTIVE'
    }));
  }, [campaigns]);

  const activeCampaigns = campaignRows.filter(c => c.isActive);
  const inactiveCampaigns = campaignRows.filter(c => !c.isActive);

  const adRows = useMemo(() => {
    return ads.map(ad => ({
      id: ad.id,
      name: ad.name || 'Untitled',
      status: (ad.effective_status || ad.status || 'UNKNOWN').toUpperCase(),
      isActive: (ad.effective_status || ad.status || '').toUpperCase() === 'ACTIVE',
      thumbnail: ad.thumbnail_url
    }));
  }, [ads]);

  const filteredAds = useMemo(() => {
    if (activeTab === 'all') return adRows;
    if (activeTab === 'analyzed') {
      return adRows.filter(ad => scriptStatuses[ad.id] === 'complete');
    }
    return adRows.filter(ad => scriptStatuses[ad.id] !== 'complete');
  }, [adRows, activeTab, scriptStatuses]);

  const hasVideo = !!videoData?.source_url;
  const hasThumbnail = !hasVideo && !!(videoData?.thumbnail_url || selectedAd?.thumbnail);
  const geminiTokenRows = (usage) => {
    if (!usage) return [];
    return [
      { label: 'Prompt', value: usage.promptTokenCount },
      { label: 'Candidates', value: usage.candidatesTokenCount },
      { label: 'Total', value: usage.totalTokenCount }
    ].filter(row => row.value !== undefined && row.value !== null);
  };
  const sonnetTokenRows = (usage) => {
    if (!usage) return [];
    return [
      { label: 'Input', value: usage.input_tokens },
      { label: 'Output', value: usage.output_tokens },
      { label: 'Total', value: usage.total_tokens }
    ].filter(row => row.value !== undefined && row.value !== null);
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="min-h-screen" style={{ backgroundColor: colors.bg }}>
      {/* Header */}
      <div className="p-4 border-b" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold" style={{ color: colors.text }}>Creatives</h1>
            
            {/* Account Selector */}
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2"
              style={{ borderColor: colors.border, color: colors.text }}
            >
              {loadingAccounts && <option>Loading...</option>}
              {adAccounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name || acc.id}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="AI Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left Panel - Campaign & Ad List */}
        <div className="w-80 border-r overflow-y-auto" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
          {/* Campaigns */}
          <div className="p-4 border-b" style={{ borderColor: colors.border }}>
            <div className="text-xs font-semibold uppercase mb-2" style={{ color: colors.textSecondary }}>
              Campaigns
            </div>
            
            {loadingCampaigns ? (
              <div className="text-sm" style={{ color: colors.textSecondary }}>Loading...</div>
            ) : (
              <div className="space-y-1">
                {activeCampaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCampaign(c.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                      selectedCampaign === c.id
                        ? 'border-l-2'
                        : 'hover:bg-gray-50'
                    }`}
                    style={{
                      borderColor: selectedCampaign === c.id ? colors.accent : 'transparent',
                      backgroundColor: selectedCampaign === c.id ? colors.accentLight : undefined,
                      color: selectedCampaign === c.id ? colors.accent : colors.text
                    }}
                  >
                    <div className="truncate">{c.name}</div>
                  </button>
                ))}
                
                {inactiveCampaigns.length > 0 && (
                  <button
                    onClick={() => setShowInactiveCampaigns(!showInactiveCampaigns)}
                    className="w-full text-left px-3 py-2 text-xs font-medium"
                    style={{ color: colors.textSecondary }}
                  >
                    {showInactiveCampaigns ? '▼' : '▶'} Inactive ({inactiveCampaigns.length})
                  </button>
                )}
                
                {showInactiveCampaigns && inactiveCampaigns.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCampaign(c.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                      selectedCampaign === c.id
                        ? 'border-l-2'
                        : 'hover:bg-gray-50'
                    }`}
                    style={{
                      borderColor: selectedCampaign === c.id ? colors.accent : 'transparent',
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
          <div className="px-4 pt-4">
            <div className="flex gap-1 p-1 rounded-lg" style={{ backgroundColor: colors.bg }}>
              {['all', 'analyzed', 'pending'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    activeTab === tab ? 'bg-white shadow-sm' : ''
                  }`}
                  style={{ color: activeTab === tab ? colors.text : colors.textSecondary }}
                >
                  {tab === 'all' ? 'All Ads' : tab === 'analyzed' ? 'Analyzed' : 'Not Analyzed'}
                </button>
              ))}
            </div>
          </div>

          {/* Ad List */}
          <div className="p-4 space-y-2">
            {loadingAds ? (
              <div className="text-sm" style={{ color: colors.textSecondary }}>Loading ads...</div>
            ) : filteredAds.length === 0 ? (
              <div className="text-sm" style={{ color: colors.textSecondary }}>No ads found</div>
            ) : (
              filteredAds.map(ad => (
                <button
                  key={ad.id}
                  onClick={() => handleSelectAd(ad)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedAd?.id === ad.id
                      ? 'border-l-2 shadow-sm'
                      : 'hover:shadow-sm hover:border-gray-300'
                  }`}
                  style={{
                    borderColor: selectedAd?.id === ad.id ? colors.accent : colors.border,
                    backgroundColor: selectedAd?.id === ad.id ? colors.accentLight : colors.card
                  }}
                >
                  <div className="flex items-center gap-3">
                    {ad.thumbnail ? (
                      <img src={ad.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: colors.text }}>{ad.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: ad.isActive ? colors.success : colors.textSecondary }}
                        />
                        <span className="text-xs" style={{ color: colors.textSecondary }}>{ad.status}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Ad Info + Chat Only */}
<div className="flex-1 flex flex-col overflow-hidden">
  {!selectedAd ? (
    <div className="flex-1 flex items-center justify-center" style={{ color: colors.textSecondary }}>
      <div className="text-center">
        <div className="text-4xl mb-4">👈</div>
        <div className="text-sm">Select an ad to analyze</div>
      </div>
    </div>
  ) : (
    <>
      {/* Ad Info Header */}
      <div className="p-4 border-b" style={{ borderColor: colors.border }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold" style={{ color: colors.text }}>{selectedAd.name}</h2>
            <div className="text-sm" style={{ color: colors.textSecondary }}>
              {campaigns.find(c => c.id === selectedCampaign)?.name}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Status */}
            {scriptStatus?.status === 'complete' ? (
              <span className="flex items-center gap-2 text-sm" style={{ color: colors.success }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.success }} />
                Analyzed
              </span>
            ) : scriptStatus?.status === 'processing' ? (
              <span className="flex items-center gap-2 text-sm" style={{ color: colors.warning }}>
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: colors.warning }} />
                Analyzing...
              </span>
            ) : scriptStatus?.status === 'failed' ? (
              <span className="text-sm" style={{ color: colors.error }}>Failed</span>
            ) : null}

            {/* Analyze Button */}
            {scriptStatus?.status !== 'complete' && scriptStatus?.status !== 'processing' && (
              <button
                onClick={handleAnalyze}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ backgroundColor: colors.accent }}
              >
                ✨ Analyze
              </button>
            )}

            {/* Facebook Link */}
            {videoData?.permalink_url && (
              <button
                onClick={() => window.open(videoData.permalink_url, '_blank')}
                className="px-3 py-2 rounded-lg text-sm border hover:bg-gray-50"
                style={{ borderColor: colors.border, color: colors.textSecondary }}
              >
                Open on FB
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Chat Section */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {chatMessages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-4xl mb-4">💬</div>
                <div className="font-medium mb-2" style={{ color: colors.text }}>Ask Claude about this ad</div>
                <div className="text-sm mb-4" style={{ color: colors.textSecondary }}>
                  Get insights on why it works, compare to other ads, or generate new variations.
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {['Why did this ad work?', 'Compare to my top performers', 'Give me 3 variations'].map(s => (
                    <button
                      key={s}
                      onClick={() => setChatInput(s)}
                      className="px-3 py-1.5 text-xs rounded-full border hover:bg-gray-50"
                      style={{ borderColor: colors.border, color: colors.textSecondary }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm ${
                    msg.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
                  }`}
                  style={{
                    backgroundColor: msg.role === 'user' ? colors.accent : colors.bg,
                    color: msg.role === 'user' ? 'white' : colors.text
                  }}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.streaming && <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />}
                </div>
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat Input */}
        <div className="p-4 border-t" style={{ borderColor: colors.border }}>
          <form onSubmit={handleSendMessage} className="flex gap-3">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask about this ad..."
              disabled={chatLoading || scriptStatus?.status !== 'complete'}
              className="flex-1 px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
              style={{ borderColor: colors.border }}
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || chatLoading || scriptStatus?.status !== 'complete'}
              className="px-6 py-3 rounded-xl text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: colors.accent }}
            >
              {chatLoading ? '...' : 'Send'}
            </button>
          </form>
          {scriptStatus?.status !== 'complete' && (
            <div className="mt-2 text-xs" style={{ color: colors.textSecondary }}>
              Analyze the ad first to enable chat
            </div>
          )}
        </div>

        {/* Debug Panel */}
        <div className="border-t" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
          <div className="p-4 text-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold" style={{ color: colors.text }}>Debugging & Token Usage</div>
              <div className="text-[11px]" style={{ color: colors.textSecondary }}>
                {debugInfo?.analyze?.timestamp || debugInfo?.chat?.timestamp ? 'Latest activity captured' : 'No activity yet'}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: colors.border }}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold" style={{ color: colors.text }}>Analyze (Gemini)</div>
                  <div className="text-[11px]" style={{ color: colors.textSecondary }}>
                    {debugInfo?.analyze?.status || 'idle'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase" style={{ color: colors.textSecondary }}>Connection Pathway</div>
                  <ul className="mt-2 space-y-1 text-[11px]">
                    {(debugInfo?.analyze?.steps || ['Awaiting analyze request...']).map((step, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="text-gray-400">{index + 1}.</span>
                        <span style={{ color: colors.text }}>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  {geminiTokenRows(debugInfo?.analyze?.usage).map(row => (
                    <div key={row.label} className="rounded-lg bg-gray-50 p-2">
                      <div className="font-semibold text-gray-600">{row.label}</div>
                      <div className="text-gray-900">{row.value?.toLocaleString?.() || row.value}</div>
                    </div>
                  ))}
                  {geminiTokenRows(debugInfo?.analyze?.usage).length === 0 && (
                    <div className="col-span-3 text-[11px]" style={{ color: colors.textSecondary }}>
                      Token usage will appear after analysis completes.
                    </div>
                  )}
                </div>
                {debugInfo?.analyze?.transcript && (
                  <div>
                    <div className="text-[11px] font-semibold uppercase" style={{ color: colors.textSecondary }}>Gemini Transcript</div>
                    <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-[11px] text-gray-700">
                      {debugInfo.analyze.transcript}
                    </pre>
                  </div>
                )}
                {debugInfo?.analyze?.status === 'failed' && (
                  <div className="rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
                    <div className="font-semibold">Failure Details</div>
                    <div>{debugInfo.analyze?.error?.message || 'Unknown error'}</div>
                    {debugInfo.analyze?.error?.status && (
                      <div>Status: {debugInfo.analyze.error.status}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: colors.border }}>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold" style={{ color: colors.text }}>Sonnet Response</div>
                  <div className="text-[11px]" style={{ color: colors.textSecondary }}>
                    {debugInfo?.chat?.status || 'idle'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase" style={{ color: colors.textSecondary }}>Connection Pathway</div>
                  <ul className="mt-2 space-y-1 text-[11px]">
                    {(debugInfo?.chat?.steps || ['Awaiting chat request...']).map((step, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="text-gray-400">{index + 1}.</span>
                        <span style={{ color: colors.text }}>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  {sonnetTokenRows(debugInfo?.chat?.usage).map(row => (
                    <div key={row.label} className="rounded-lg bg-gray-50 p-2">
                      <div className="font-semibold text-gray-600">{row.label}</div>
                      <div className="text-gray-900">{row.value?.toLocaleString?.() || row.value}</div>
                    </div>
                  ))}
                  {sonnetTokenRows(debugInfo?.chat?.usage).length === 0 && (
                    <div className="col-span-3 text-[11px]" style={{ color: colors.textSecondary }}>
                      Token usage will appear after Claude responds.
                    </div>
                  )}
                </div>
                {debugInfo?.chat?.status === 'failed' && (
                  <div className="rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
                    <div className="font-semibold">Failure Details</div>
                    <div>{debugInfo.chat?.error?.message || 'Unknown error'}</div>
                    {debugInfo.chat?.error?.status && (
                      <div>Status: {debugInfo.chat.error.status}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    
             
            </>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-4 right-4 px-4 py-3 rounded-lg text-sm text-white bg-red-500 shadow-lg">
          {error}
          <button onClick={() => setError('')} className="ml-3 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SETTINGS MODAL COMPONENT
// ============================================================================
function SettingsModal({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    model: settings?.model || 'sonnet-4.5',
    streaming: settings?.streaming ?? true,
    tone: settings?.tone || 'balanced',
    custom_prompt: settings?.custom_prompt || '',
    capabilities: settings?.capabilities || { analyze: true, clone: true, ideate: true, audit: true }
  });

  const handleCapabilityToggle = (key) => {
    setForm(prev => ({
      ...prev,
      capabilities: { ...prev.capabilities, [key]: !prev.capabilities[key] }
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Creative Intelligence</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Model Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Model</label>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                form.model === 'sonnet-4.5' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
              }`}>
                <input
                  type="radio"
                  name="model"
                  value="sonnet-4.5"
                  checked={form.model === 'sonnet-4.5'}
                  onChange={(e) => setForm(prev => ({ ...prev, model: e.target.value }))}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-900">Sonnet 4.5 <span className="text-xs text-indigo-600 ml-1">Recommended</span></div>
                  <div className="text-sm text-gray-500">Fast, sharp insights. Best for daily analysis.</div>
                </div>
              </label>
              
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                form.model === 'opus-4.5' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
              }`}>
                <input
                  type="radio"
                  name="model"
                  value="opus-4.5"
                  checked={form.model === 'opus-4.5'}
                  onChange={(e) => setForm(prev => ({ ...prev, model: e.target.value }))}
                  className="mt-1"
                />
                <div>
                  <div className="font-medium text-gray-900">Opus 4.5 <span className="text-xs text-amber-600 ml-1">Premium</span></div>
                  <div className="text-sm text-gray-500">Deeper reasoning, creative connections. Best for strategy sessions.</div>
                </div>
              </label>
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Capabilities</label>
            <div className="space-y-2">
              {[
                { key: 'analyze', label: 'Analyze Performance', desc: '"Why did this win?" • Compare ads • Find patterns' },
                { key: 'clone', label: 'Clone Winners', desc: 'Generate variations • Same structure, fresh angles' },
                { key: 'ideate', label: 'Ideate New Concepts', desc: 'New hooks • Untested angles • Creative briefs' },
                { key: 'audit', label: 'Audit & Recommend', desc: "What's fatigued • What to kill • What to test" }
              ].map(cap => (
                <label
                  key={cap.key}
                  className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 cursor-pointer hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={form.capabilities[cap.key]}
                    onChange={() => handleCapabilityToggle(cap.key)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">{cap.label}</div>
                    <div className="text-sm text-gray-500">{cap.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Tone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">Tone</label>
            <div className="space-y-2">
              {[
                { value: 'balanced', label: 'Balanced', desc: 'Clear insights, practical recommendations' },
                { value: 'data-heavy', label: 'Data-Heavy', desc: 'Numbers first, minimal fluff' },
                { value: 'creative-led', label: 'Creative-Led', desc: 'Story-focused, emotional angles' },
                { value: 'custom', label: 'Custom', desc: 'Write your own instructions' }
              ].map(t => (
                <label
                  key={t.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    form.tone === t.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="tone"
                    value={t.value}
                    checked={form.tone === t.value}
                    onChange={(e) => setForm(prev => ({ ...prev, tone: e.target.value }))}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{t.label}</div>
                    <div className="text-sm text-gray-500">{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>
            
            {form.tone === 'custom' && (
              <textarea
                value={form.custom_prompt}
                onChange={(e) => setForm(prev => ({ ...prev, custom_prompt: e.target.value }))}
                placeholder="Write your custom instructions..."
                className="mt-3 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                rows={3}
              />
            )}
          </div>

          {/* Streaming */}
          <div>
            <label className="flex items-center justify-between p-3 rounded-xl border border-gray-200">
              <div>
                <div className="font-medium text-gray-900">Streaming Responses</div>
                <div className="text-sm text-gray-500">See responses as they're generated</div>
              </div>
              <input
                type="checkbox"
                checked={form.streaming}
                onChange={(e) => setForm(prev => ({ ...prev, streaming: e.target.checked }))}
                className="w-5 h-5 rounded"
              />
            </label>
          </div>

          {/* Info */}
          <div className="p-4 rounded-xl bg-gray-50 text-sm text-gray-600">
            <div className="font-medium text-gray-900 mb-2">💡 What this does</div>
            <p>Your ads are analyzed frame-by-frame by AI vision. When you ask questions, Claude sees the full script + your Meta data (CTR, ROAS, spend) to give you insights no dashboard can.</p>
          </div>
        </div>

        <div className="p-6 border-t border-gray-200">
          <button
            onClick={() => onSave(form)}
            className="w-full py-3 rounded-xl text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-600 transition-colors"
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
