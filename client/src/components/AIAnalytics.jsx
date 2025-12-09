import { useState, useRef, useEffect } from 'react';
import { 
  Brain, Zap, TrendingUp, Lightbulb, Send, Loader2, Sparkles, 
  Plus, MessageSquare, Trash2, Upload, X, Sun, Moon, Calendar, 
  FileText, BarChart2, ChevronDown
} from 'lucide-react';

// ============================================================================
// MAIN COMPONENT - Tabs: Chat | Daily Summary
// ============================================================================

export default function AIAnalytics({ store }) {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="space-y-4">
      {/* Tab Selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'chat'
              ? 'bg-violet-600 text-white shadow-md'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          AI Chat
        </button>
        <button
          onClick={() => setActiveTab('daily')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
            activeTab === 'daily'
              ? 'bg-violet-600 text-white shadow-md'
              : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          <Calendar className="w-4 h-4" />
          Daily Summary
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'chat' && <ChatTab store={store} />}
      {activeTab === 'daily' && <DailySummaryTab store={store} />}
    </div>
  );
}

// ============================================================================
// CHAT TAB - Clean interface with white sidebar
// ============================================================================

function ChatTab({ store }) {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  
  // Mode and Depth
  const [mode, setMode] = useState('decide'); // analyze, summarize, decide
  const [depth, setDepth] = useState('balanced'); // instant, fast, balanced, deep
  
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

  const createNewChat = () => {
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
      const historyForAPI = messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: store.id,
          question: userMessage,
          mode,
          depth: mode === 'decide' ? depth : 'balanced',
          history: historyForAPI,
          conversationId: currentConversationId
        })
      });

      if (!response.ok) throw new Error('Request failed');

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

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: fullText,
        model: modelUsed,
        mode,
        depth: mode === 'decide' ? depth : null
      }]);
      setStreamingText('');
      loadConversations();
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const MODES = [
    { id: 'analyze', label: 'Analyze', icon: Zap, desc: 'Quick insights', color: 'blue' },
    { id: 'summarize', label: 'Summarize', icon: BarChart2, desc: 'Trends & charts', color: 'purple' },
    { id: 'decide', label: 'Decide', icon: Lightbulb, desc: 'Strategic advice', color: 'orange' }
  ];

  const DEPTHS = [
    { id: 'instant', label: 'Instant', emoji: '⚡' },
    { id: 'fast', label: 'Fast', emoji: '🚀' },
    { id: 'balanced', label: 'Balanced', emoji: '⚖️' },
    { id: 'deep', label: 'Deep', emoji: '🧠' }
  ];

  return (
    <div className="flex h-[650px] rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
      {/* Sidebar - White */}
      <div className="w-64 border-r border-gray-200 flex flex-col bg-gray-50">
        {/* New Chat Button */}
        <div className="p-3 border-b border-gray-200">
          <button
            onClick={createNewChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 rounded-lg text-white font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No conversations yet</p>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => loadConversation(conv.id)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  currentConversationId === conv.id
                    ? 'bg-violet-100 text-violet-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <MessageSquare className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 truncate text-sm">{conv.title}</span>
                <button
                  onClick={(e) => deleteConversation(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col">
        {/* Header - Mode & Depth Selection */}
        <div className="p-3 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Mode Selection */}
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              {MODES.map((m) => {
                const Icon = m.icon;
                const isActive = mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    title={m.desc}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      isActive
                        ? m.color === 'blue' ? 'bg-blue-500 text-white' 
                        : m.color === 'purple' ? 'bg-purple-500 text-white'
                        : 'bg-orange-500 text-white'
                        : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {m.label}
                  </button>
                );
              })}
            </div>

            {/* Depth Selection - Only for Decide mode */}
            {mode === 'decide' && (
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                {DEPTHS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDepth(d.id)}
                    className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                      depth === d.id
                        ? 'bg-white shadow-sm text-gray-900 font-medium'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {d.emoji} {d.label}
                  </button>
                ))}
              </div>
            )}

            {/* Mode description */}
            <span className="text-xs text-gray-400 ml-auto">
              {mode === 'analyze' && '⚡ Quick answers using GPT-5 nano'}
              {mode === 'summarize' && '📊 Trends & charts using GPT-5 mini'}
              {mode === 'decide' && `🎯 Strategic decisions using GPT-5.1 (${depth})`}
            </span>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {messages.length === 0 && !streamingText ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">AI Analytics for {store.name}</h2>
              <p className="text-gray-500 text-sm max-w-md mb-4">
                Ask questions, get insights, and make decisions based on your data.
              </p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {[
                  "How are we doing today?",
                  "Compare today vs yesterday",
                  "Best performing campaigns?",
                  "Show revenue trend"
                ].map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setQuestion(q)}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white'
                      : 'bg-white border border-gray-200 shadow-sm'
                  }`}>
                    {msg.role === 'assistant' && msg.model && (
                      <div className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        {msg.model}
                        {msg.depth && <span className="text-violet-500">• {msg.depth}</span>}
                      </div>
                    )}
                    <div className={msg.role === 'user' ? '' : 'text-gray-700 text-sm'}>
                      {msg.role === 'assistant' ? <FormattedMessage text={msg.content} /> : msg.content}
                    </div>
                  </div>
                </div>
              ))}

              {streamingText && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-xl px-4 py-3 bg-white border border-gray-200 shadow-sm">
                    <div className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 animate-pulse" />
                      Thinking...
                    </div>
                    <div className="text-gray-700 text-sm">
                      <FormattedMessage text={streamingText} />
                      <span className="inline-block w-2 h-4 bg-violet-500 animate-pulse ml-1" />
                    </div>
                  </div>
                </div>
              )}

              {loading && !streamingText && (
                <div className="flex justify-start">
                  <div className="rounded-xl px-4 py-3 bg-white border border-gray-200">
                    <div className="flex items-center gap-2 text-gray-500 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Thinking...
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-gray-200 bg-white">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about your data..."
              className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-300 text-gray-800 text-sm"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className={`px-4 py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 ${
                loading || !question.trim()
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-violet-600 text-white hover:bg-violet-700'
              }`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DAILY SUMMARY TAB - AM/PM Reports
// ============================================================================

function DailySummaryTab({ store }) {
  const [reportType, setReportType] = useState('am');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [lastGenerated, setLastGenerated] = useState(null);
  const [clearing, setClearing] = useState(false);

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
          question: '',
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
      setReport(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const clearDemoData = async () => {
    if (!confirm('Delete all Salla demo data? This cannot be undone.')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/ai/demo-data', { method: 'DELETE' });
      const data = await res.json();
      alert(`Deleted ${data.results?.salla?.deleted || 0} Salla demo records`);
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setClearing(false);
    }
  };

  const displayText = streamingText || report;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-600" />
              Daily Performance Summary
            </h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Rigorous analysis for both VironaX & Shawq • GPT-5.1 Deep
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* AM/PM Toggle */}
            <div className="flex bg-white rounded-lg p-1 border border-gray-200">
              <button
                onClick={() => setReportType('am')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  reportType === 'am'
                    ? 'bg-amber-500 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Sun className="w-4 h-4" />
                AM
              </button>
              <button
                onClick={() => setReportType('pm')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  reportType === 'pm'
                    ? 'bg-indigo-500 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Moon className="w-4 h-4" />
                PM
              </button>
            </div>

            <button
              onClick={generateReport}
              disabled={loading}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                loading
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-violet-600 text-white hover:bg-violet-700'
              }`}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
              ) : (
                <><Brain className="w-4 h-4" /> Generate {reportType.toUpperCase()}</>
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mt-2">
          {lastGenerated && (
            <p className="text-xs text-gray-500">
              Last generated: {lastGenerated.toLocaleTimeString()}
            </p>
          )}
          <button
            onClick={clearDemoData}
            disabled={clearing}
            className="text-xs text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
          >
            {clearing ? 'Clearing...' : 'Clear Salla Demo Data'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 min-h-[400px] max-h-[500px] overflow-y-auto">
        {!displayText && !loading ? (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <div className={`w-16 h-16 rounded-xl flex items-center justify-center mb-3 ${
              reportType === 'am' 
                ? 'bg-gradient-to-br from-amber-400 to-orange-500' 
                : 'bg-gradient-to-br from-indigo-500 to-purple-600'
            }`}>
              {reportType === 'am' ? <Sun className="w-8 h-8 text-white" /> : <Moon className="w-8 h-8 text-white" />}
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {reportType === 'am' ? 'Morning Review' : 'Evening Review'}
            </h3>
            <p className="text-gray-500 text-sm max-w-md">
              {reportType === 'am' 
                ? 'Comprehensive morning analysis with budget decisions and action plans.'
                : 'Evening review validating AM hypotheses and planning for tomorrow.'}
            </p>
          </div>
        ) : (
          <div className="prose prose-sm max-w-none">
            {loading && !streamingText ? (
              <div className="flex items-center justify-center h-40 gap-2 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Analyzing data...</span>
              </div>
            ) : (
              <FormattedMessage text={displayText} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// FORMATTED MESSAGE - Handles markdown-like formatting
// ============================================================================

function FormattedMessage({ text }) {
  if (!text) return null;
  
  return text.split('\n').map((line, i) => {
    // Headers
    if (line.startsWith('## ')) {
      return <h3 key={i} className="text-base font-bold text-gray-900 mt-3 mb-1">{line.slice(3)}</h3>;
    }
    if (line.startsWith('### ')) {
      return <h4 key={i} className="text-sm font-semibold text-gray-800 mt-2 mb-1">{line.slice(4)}</h4>;
    }
    // Bullet points
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <div key={i} className="flex gap-2 ml-2 my-0.5">
          <span className="text-violet-500">•</span>
          <span>{formatBold(line.slice(2))}</span>
        </div>
      );
    }
    // Numbered lists
    if (line.match(/^\d+\.\s/) || line.match(/^\d+\)\s/)) {
      const match = line.match(/^(\d+)[\.\)]\s(.*)$/);
      if (match) {
        return (
          <div key={i} className="flex gap-2 ml-2 my-0.5">
            <span className="text-violet-600 font-medium min-w-[1.5rem]">{match[1]}.</span>
            <span>{formatBold(match[2])}</span>
          </div>
        );
      }
    }
    // Horizontal rule
    if (line.startsWith('---')) {
      return <hr key={i} className="my-3 border-gray-200" />;
    }
    // Empty line
    if (line.trim() === '') {
      return <div key={i} className="h-2" />;
    }
    // Regular paragraph
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
