import { useState, useRef, useEffect } from 'react';
import { 
  Brain, Zap, TrendingUp, Lightbulb, Send, Loader2, Sparkles, 
  Plus, MessageSquare, Trash2, ChevronLeft, ChevronRight, Upload, X,
  BarChart3, LineChart, PieChart, Sun, Moon, Calendar, FileText
} from 'lucide-react';
import {
  LineChart as RechartsLine, Line, BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const MODES = [
  { id: 'analyze', label: 'Analyze', icon: Zap, color: 'from-blue-500 to-cyan-500' },
  { id: 'summarize', label: 'Summarize', icon: TrendingUp, color: 'from-purple-500 to-pink-500' },
  { id: 'decide', label: 'Decide', icon: Lightbulb, color: 'from-orange-500 to-red-500' }
];

const DEPTHS = [
  { id: 'instant', label: 'Instant', emoji: '⚡' },
  { id: 'fast', label: 'Fast', emoji: '🚀' },
  { id: 'balanced', label: 'Balanced', emoji: '⚖️' },
  { id: 'deep', label: 'Deep', emoji: '🧠' }
];

const CHART_COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1', '#14b8a6'];

// Country code display names
const COUNTRY_DISPLAY_NAMES = {
  'AE': 'UAE', 'SA': 'Saudi Arabia', 'KW': 'Kuwait', 'QA': 'Qatar', 
  'OM': 'Oman', 'BH': 'Bahrain', 'US': 'USA', 'GB': 'UK', 
  'DE': 'Germany', 'FR': 'France', 'TR': 'Turkey'
};

function formatCountryCode(code) {
  return COUNTRY_DISPLAY_NAMES[code] || code;
}

// Main tabs
const MAIN_TABS = [
  { id: 'chat', label: 'AI Chat', icon: MessageSquare },
  { id: 'daily', label: 'Daily Summary', icon: Calendar }
];

export default function AIAnalytics({ store }) {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="space-y-4">
      {/* Main Tab Selector */}
      <div className="flex gap-2 bg-white p-1.5 rounded-xl shadow-sm border border-gray-200 w-fit">
        {MAIN_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-md'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'chat' && <ChatTab store={store} />}
      {activeTab === 'daily' && <DailySummaryTab store={store} />}
    </div>
  );
}

// ============================================================================
// CHAT TAB - Original chat functionality
// ============================================================================

function ChatTab({ store }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [mode, setMode] = useState('decide');
  const [depth, setDepth] = useState('balanced');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadConversations();
  }, [store.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const loadConversations = async () => {
    try {
      const res = await fetch(`/api/ai/conversations?store=${store.id}`);
      const data = await res.json();
      if (data.success) setConversations(data.conversations);
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  };

  const loadConversation = async (id) => {
    try {
      const res = await fetch(`/api/ai/conversations/${id}`);
      const data = await res.json();
      if (data.success) {
        setCurrentConversationId(id);
        setMessages(data.messages);
      }
    } catch (e) {
      console.error('Failed to load conversation:', e);
    }
  };

  const createNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    try {
      await fetch(`/api/ai/conversations/${id}`, { method: 'DELETE' });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error('Failed to delete conversation:', e);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim() || loading) return;

    const userMessage = question.trim();
    setQuestion('');
    setLoading(true);
    setStreamingText('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const historyForAPI = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: store.id, question: userMessage, mode, depth,
          history: historyForAPI, conversationId: currentConversationId
        })
      });

      if (!response.ok) throw new Error('Stream request failed');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let convId = currentConversationId;
      let modelUsed = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.conversationId && !convId) {
                convId = parsed.conversationId;
                setCurrentConversationId(convId);
              }
              if (parsed.model) modelUsed = parsed.model;
              if (parsed.text) {
                fullText += parsed.text;
                setStreamingText(fullText);
              }
            } catch (e) {}
          }
        }
      }

      setMessages(prev => [...prev, { role: 'assistant', content: fullText, model: modelUsed, depth }]);
      setStreamingText('');
      loadConversations();
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex h-[650px] rounded-2xl overflow-hidden shadow-xl bg-white">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 bg-gray-900 flex flex-col overflow-hidden flex-shrink-0`}>
        <div className="p-4 border-b border-white/10">
          <button onClick={createNewConversation} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-colors">
            <Plus className="w-5 h-5" /> New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((conv) => (
            <div key={conv.id} onClick={() => loadConversation(conv.id)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${currentConversationId === conv.id ? 'bg-white/20 text-white' : 'text-gray-300 hover:bg-white/10'}`}>
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 truncate text-sm">{conv.title}</span>
              <button onClick={(e) => deleteConversation(conv.id, e)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all">
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          ))}
          {conversations.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No conversations yet</div>}
        </div>
        <div className="p-4 border-t border-white/10">
          <button onClick={() => setShowImportModal(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-sm">
            <Upload className="w-4 h-4" /> Import Historical Data
          </button>
        </div>
      </div>

      {/* Sidebar Toggle */}
      <button onClick={() => setSidebarOpen(!sidebarOpen)} className={`absolute top-4 z-10 p-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-all ${sidebarOpen ? 'left-[276px]' : 'left-2'}`}>
        {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="p-4 bg-white border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <button key={m.id} onClick={() => setMode(m.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${mode === m.id ? `bg-gradient-to-r ${m.color} text-white shadow-md` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    <Icon className="w-4 h-4" />{m.label}
                  </button>
                );
              })}
            </div>
            <div className="flex bg-gray-100 rounded-lg p-1">
              {DEPTHS.map((d) => (
                <button key={d.id} onClick={() => setDepth(d.id)}
                  className={`px-3 py-1 rounded-md text-sm transition-all ${depth === d.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}>
                  {d.emoji} {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-gray-50 to-white">
          {messages.length === 0 && !streamingText ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-4 shadow-lg">
                <Brain className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">AI Analytics for {store.name}</h2>
              <p className="text-gray-500 max-w-md mb-4">Ask questions, generate charts, get insights.</p>
              <div className="flex flex-wrap gap-2 mt-2 max-w-xl justify-center">
                {["Show me revenue chart", "Compare by country", "How are we doing?", "Best campaigns?"].map((q, i) => (
                  <button key={i} onClick={() => setQuestion(q)} className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-full text-sm text-gray-600 transition-all hover:shadow-sm">{q}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.role === 'user' ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-tr-sm' : 'bg-white border border-gray-100 shadow-sm rounded-tl-sm'}`}>
                    {msg.role === 'assistant' && msg.model && (
                      <div className="text-xs text-gray-400 mb-2 flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />{msg.model}{msg.depth && <span className="text-violet-500">• {msg.depth}</span>}
                      </div>
                    )}
                    <div className={msg.role === 'user' ? '' : 'prose prose-sm max-w-none text-gray-700'}>
                      {msg.role === 'assistant' ? <MessageContent content={msg.content} /> : msg.content}
                    </div>
                  </div>
                </div>
              ))}
              {streamingText && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 bg-white border border-gray-100 shadow-sm">
                    <div className="text-xs text-gray-400 mb-2 flex items-center gap-2"><Sparkles className="w-3 h-3 animate-pulse" />Thinking...</div>
                    <div className="prose prose-sm max-w-none text-gray-700">
                      <MessageContent content={streamingText} isStreaming />
                      <span className="inline-block w-2 h-4 bg-violet-500 animate-pulse ml-1" />
                    </div>
                  </div>
                </div>
              )}
              {loading && !streamingText && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-white border border-gray-100">
                    <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />Thinking...</div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="p-4 bg-white/80 backdrop-blur-sm border-t border-gray-200 flex-shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about your data..." disabled={loading}
              className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-gray-800" />
            <button type="submit" disabled={loading || !question.trim()}
              className={`px-5 py-3 rounded-xl font-medium transition-all flex items-center gap-2 ${loading || !question.trim() ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:shadow-lg'}`}>
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>

      {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} store={store} onImport={loadConversations} />}
    </div>
  );
}

// ============================================================================
// DAILY SUMMARY TAB - AM/PM Reports with GPT-5.1 Deep
// ============================================================================

const DAILY_SUMMARY_SYSTEM_PROMPT = `You are the Principal Growth Scientist for two brands:

1) Virona — KSA/GCC men's jewelry (uses Salla platform)
2) Shawq — US/UK/EU/Turkey apparel (uses Shopify platform)

You produce twice-daily decision-grade reports (AM and PM).
Your job is to identify the most likely true constraints in the funnel, rank performance with risk-adjusted logic, and recommend controlled budget and campaign actions.

IMPORTANT: When you see country code "AE", display it as "UAE". Other codes: SA=Saudi Arabia, KW=Kuwait, QA=Qatar, US=USA, GB=UK.

Hard rules:
1) Use ONLY the data provided. Do not invent numbers, events, or platform changes.
2) If data is missing, say: "Data missing" and state how that limits confidence.
3) Avoid generic advice. Every recommendation must cite a specific data cue from input.
4) Prefer reversible changes unless confidence is High.
5) Separate Virona and Shawq analysis completely.

Pass 0 — Data Integrity Gate (must do before any actions):
Check for:
- Low volume
- Missing fields
- Sudden schema/metric gaps
- Partial-day distortions
If any risk is detected:
- State "Data integrity risk"
- Downgrade confidence by one level
- Limit actions to small, reversible moves

Key metrics to analyze:
- ROAS (Return on Ad Spend)
- CPA (Cost Per Acquisition)
- Revenue and Orders
- Country/region performance
- Campaign performance
- Daily trends

Time windows (use all when available):
- Today-so-far
- Yesterday
- Last 7 days baseline
- Last 30 days for trends

Budget model — step-ladder with guardrails:
- SCALE only if efficiency is stable/improving
- SCALE step size: +10–15% for stable, +5–10% for noisy
- CUT only with multi-stage confirmation
- CUT step size: -10–20% (up to -25% if high-confidence deterioration)
- HOLD when signals are mixed
- If confidence is Low: no aggressive budget moves

PM accountability rule:
In PM reports, explicitly validate or reject the AM hypotheses.

Output format:

DATE: [current date]
REVIEW TYPE: [AM or PM]

BRAND: Virona (if data available)
1) Data Integrity Gate
2) Executive Snapshot (key numbers)
3) Performance Analysis
4) Primary Constraint (choose 1 main issue)
5) Top Performers (campaigns/countries)
6) Budget Decision (Scale/Hold/Cut + step size)
7) Recommended Actions (max 4)
8) AM→PM Check (PM only)

BRAND: Shawq (if data available)
[Same structure as Virona]`;

function DailySummaryTab({ store }) {
  const [reportType, setReportType] = useState('am');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [lastGenerated, setLastGenerated] = useState(null);

  const generateReport = async () => {
    setLoading(true);
    setStreamingText('');
    setReport('');

    try {
      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: store.id,
          question: '', // Not needed for daily summary
          mode: 'daily-summary',
          reportType
        })
      });

      if (!response.ok) throw new Error('Request failed');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                fullText += parsed.text;
                setStreamingText(fullText);
              }
            } catch (e) {}
          }
        }
      }

      setReport(fullText);
      setStreamingText('');
      setLastGenerated(new Date());
    } catch (error) {
      setReport(`Error generating report: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const displayText = streamingText || report;

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-6 h-6 text-amber-600" />
              Daily Performance Summary
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Rigorous AM/PM analysis using GPT-5.1 Deep • {store.name}
            </p>
          </div>

          {/* AM/PM Toggle */}
          <div className="flex items-center gap-3">
            <div className="flex bg-white rounded-xl p-1 shadow-sm border border-gray-200">
              <button
                onClick={() => setReportType('am')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                  reportType === 'am'
                    ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-white shadow-md'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Sun className="w-4 h-4" />
                AM Report
              </button>
              <button
                onClick={() => setReportType('pm')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                  reportType === 'pm'
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Moon className="w-4 h-4" />
                PM Report
              </button>
            </div>

            <button
              onClick={generateReport}
              disabled={loading}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium transition-all ${
                loading
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:shadow-lg hover:scale-105'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Brain className="w-5 h-5" />
                  Generate {reportType.toUpperCase()}
                </>
              )}
            </button>
          </div>
        </div>

        {lastGenerated && (
          <div className="mt-3 text-xs text-gray-500">
            Last generated: {lastGenerated.toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Report Content */}
      <div className="p-6 min-h-[500px] max-h-[600px] overflow-y-auto">
        {!displayText && !loading ? (
          <div className="flex flex-col items-center justify-center h-96 text-center">
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-4 shadow-lg ${
              reportType === 'am' 
                ? 'bg-gradient-to-br from-amber-400 to-orange-500' 
                : 'bg-gradient-to-br from-indigo-500 to-purple-600'
            }`}>
              {reportType === 'am' ? <Sun className="w-10 h-10 text-white" /> : <Moon className="w-10 h-10 text-white" />}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {reportType === 'am' ? 'Morning Review' : 'Evening Review'}
            </h3>
            <p className="text-gray-500 max-w-md mb-6">
              {reportType === 'am' 
                ? 'Generate a comprehensive morning analysis with budget decisions and action plans for today.'
                : 'Generate an evening review validating AM hypotheses and planning for tomorrow.'}
            </p>
            <div className="flex items-center gap-2 text-sm text-violet-600 bg-violet-50 px-4 py-2 rounded-lg">
              <Sparkles className="w-4 h-4" />
              Uses GPT-5.1 Deep for rigorous analysis
            </div>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none">
            {loading && !streamingText ? (
              <div className="flex items-center justify-center h-40 gap-3 text-gray-500">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Analyzing data and generating {reportType.toUpperCase()} report...</span>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-xl p-6 font-mono text-sm whitespace-pre-wrap border border-gray-200">
                {displayText}
                {loading && <span className="inline-block w-2 h-4 bg-violet-500 animate-pulse ml-1" />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MESSAGE CONTENT - Parses text and renders charts
// ============================================================================

function MessageContent({ content, isStreaming = false }) {
  if (!content) return null;
  const parts = parseContentWithCharts(content);
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'chart') {
          if (isStreaming && !part.complete) return <span key={i} className="text-gray-400 italic">Generating chart...</span>;
          return <ChartRenderer key={i} config={part.config} />;
        }
        return <TextContent key={i} text={part.text} />;
      })}
    </>
  );
}

function parseContentWithCharts(content) {
  const parts = [];
  const chartRegex = /```chart\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = chartRegex.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    try {
      const config = JSON.parse(match[1].trim());
      parts.push({ type: 'chart', config, complete: true });
    } catch (e) {
      parts.push({ type: 'text', text: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  const incompleteMatch = content.slice(lastIndex).match(/```chart\n[\s\S]*$/);
  if (incompleteMatch) {
    parts.push({ type: 'text', text: content.slice(lastIndex, lastIndex + incompleteMatch.index) });
    parts.push({ type: 'chart', config: null, complete: false });
  } else if (lastIndex < content.length) {
    parts.push({ type: 'text', text: content.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', text: content }];
}

function TextContent({ text }) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) return <h3 key={i} className="text-lg font-bold text-gray-900 mt-3 mb-2">{line.slice(3)}</h3>;
    if (line.startsWith('### ')) return <h4 key={i} className="text-md font-semibold text-gray-800 mt-2 mb-1">{line.slice(4)}</h4>;
    if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} className="flex gap-2 ml-2 my-0.5"><span className="text-violet-500">•</span><span>{formatBold(line.slice(2))}</span></div>;
    if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) return <div key={i} className="flex gap-2 ml-2 my-0.5"><span className="text-violet-600 font-medium min-w-[1.5rem]">{match[1]}.</span><span>{formatBold(match[2])}</span></div>;
    }
    if (line.startsWith('---')) return <hr key={i} className="my-3 border-gray-200" />;
    if (line.trim() === '') return <div key={i} className="h-1.5" />;
    return <p key={i} className="my-0.5">{formatBold(line)}</p>;
  });
}

function formatBold(text) {
  if (!text || !text.includes('**')) return text;
  const parts = [];
  let remaining = text;
  let key = 0;
  while (remaining.includes('**')) {
    const start = remaining.indexOf('**');
    const end = remaining.indexOf('**', start + 2);
    if (end === -1) break;
    if (start > 0) parts.push(<span key={key++}>{remaining.slice(0, start)}</span>);
    parts.push(<strong key={key++} className="font-semibold">{remaining.slice(start + 2, end)}</strong>);
    remaining = remaining.slice(end + 2);
  }
  if (remaining) parts.push(<span key={key++}>{remaining}</span>);
  return parts.length > 0 ? parts : text;
}

// ============================================================================
// CHART RENDERER
// ============================================================================

function ChartRenderer({ config }) {
  if (!config || !config.data || config.data.length === 0) {
    return <div className="my-4 p-4 bg-gray-50 rounded-xl border border-gray-200 text-gray-500 text-sm">No chart data available</div>;
  }

  const { type = 'line', title, data, xKey = 'name', yKey = 'value', yKeys = [] } = config;
  const dataKeys = yKeys && yKeys.length > 0 ? yKeys : [yKey];

  return (
    <div className="my-4 p-4 bg-gradient-to-br from-gray-50 to-white rounded-xl border border-gray-200 shadow-sm">
      {title && (
        <div className="flex items-center gap-2 mb-3">
          {type === 'line' && <LineChart className="w-4 h-4 text-violet-500" />}
          {type === 'bar' && <BarChart3 className="w-4 h-4 text-cyan-500" />}
          {type === 'pie' && <PieChart className="w-4 h-4 text-emerald-500" />}
          {type === 'area' && <TrendingUp className="w-4 h-4 text-orange-500" />}
          <span className="font-medium text-gray-800">{title}</span>
        </div>
      )}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'line' && (
            <RechartsLine data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              {dataKeys.length > 1 && <Legend />}
              {dataKeys.map((key, i) => <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ fill: CHART_COLORS[i % CHART_COLORS.length], r: 3 }} />)}
            </RechartsLine>
          )}
          {type === 'bar' && (
            <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              {dataKeys.length > 1 && <Legend />}
              {dataKeys.map((key, i) => <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />)}
            </BarChart>
          )}
          {type === 'area' && (
            <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey={xKey} tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              {dataKeys.length > 1 && <Legend />}
              {dataKeys.map((key, i) => <Area key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.3} />)}
            </AreaChart>
          )}
          {type === 'pie' && (
            <RechartsPie data={data} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
              <Pie data={data} dataKey={yKey} nameKey={xKey} cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {data.map((entry, index) => <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
            </RechartsPie>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================================
// IMPORT MODAL
// ============================================================================

function ImportModal({ onClose, store, onImport }) {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('store', store.id);
    try {
      const res = await fetch('/api/ai/import-history', { method: 'POST', body: formData });
      const data = await res.json();
      setResult(data);
      if (data.success) onImport();
    } catch (e) {
      setResult({ success: false, error: e.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Import Historical Data</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">Upload a CSV file with historical data.</p>
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center mb-4">
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])} className="hidden" id="csv-upload" />
          <label htmlFor="csv-upload" className="cursor-pointer">
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            {file ? <p className="text-sm text-gray-900 font-medium">{file.name}</p> : <p className="text-sm text-gray-500">Click to select CSV file</p>}
          </label>
        </div>
        {result && <div className={`p-3 rounded-lg mb-4 ${result.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}><p className="text-sm">{result.success ? `Imported ${result.records} records` : result.error}</p></div>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleImport} disabled={!file || importing} className="flex-1 px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-2">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Import
          </button>
        </div>
      </div>
    </div>
  );
}
