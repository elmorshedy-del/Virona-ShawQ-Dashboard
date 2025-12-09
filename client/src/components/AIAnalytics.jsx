import { useState, useRef, useEffect } from 'react';
import { 
  Brain, Zap, TrendingUp, Lightbulb, Send, Loader2, Sparkles, 
  Plus, MessageSquare, Trash2, ChevronLeft, ChevronRight, Upload, X
} from 'lucide-react';

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

export default function AIAnalytics({ store }) {
  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  
  // Chat state
  const [messages, setMessages] = useState([]);
  const [mode, setMode] = useState('decide');
  const [depth, setDepth] = useState('balanced');
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  
  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  
  const messagesEndRef = useRef(null);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [store.id]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const loadConversations = async () => {
    try {
      const res = await fetch(`/api/ai/conversations?store=${store.id}`);
      const data = await res.json();
      if (data.success) {
        setConversations(data.conversations);
      }
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

  const createNewConversation = async () => {
    setCurrentConversationId(null);
    setMessages([]);
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    
    try {
      await fetch(`/api/ai/conversations/${id}`, { method: 'DELETE' });
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
      loadConversations();
    } catch (e) {
      console.error('Failed to delete conversation:', e);
    }
  };

  const saveMessage = async (convId, role, content, msgMode, msgDepth, model) => {
    if (!convId) return;
    
    try {
      await fetch(`/api/ai/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, mode: msgMode, depth: msgDepth, model })
      });
    } catch (e) {
      console.error('Failed to save message:', e);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim() || loading) return;

    // Create conversation if none exists
    let convId = currentConversationId;
    if (!convId) {
      try {
        const res = await fetch('/api/ai/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: store.id })
        });
        const data = await res.json();
        if (data.success) {
          convId = data.conversationId;
          setCurrentConversationId(convId);
        }
      } catch (e) {
        console.error('Failed to create conversation:', e);
        return;
      }
    }

    const userMessage = {
      role: 'user',
      content: question,
      mode,
      depth: mode === 'decide' ? depth : null
    };

    setMessages(prev => [...prev, userMessage]);
    saveMessage(convId, 'user', question, mode, mode === 'decide' ? depth : null, null);
    
    setQuestion('');
    setLoading(true);
    setStreamingText('');

    try {
      if (mode === 'decide') {
        // Streaming
        const res = await fetch('/api/ai/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, store: store.id, depth, conversationId: convId })
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let modelUsed = '';

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
                  fullText += data.text;
                  setStreamingText(fullText);
                } else if (data.type === 'done') {
                  modelUsed = data.model;
                } else if (data.type === 'error') {
                  fullText = `Error: ${data.error}`;
                }
              } catch (err) {}
            }
          }
        }

        const assistantMessage = {
          role: 'assistant',
          content: fullText,
          model: modelUsed,
          mode,
          depth
        };

        setMessages(prev => [...prev, assistantMessage]);
        saveMessage(convId, 'assistant', fullText, mode, depth, modelUsed);
        setStreamingText('');
      } else {
        // Non-streaming
        const endpoint = mode === 'analyze' ? '/api/ai/analyze' : '/api/ai/summarize';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, store: store.id, conversationId: convId })
        });

        const data = await res.json();
        const content = data.success ? data.answer : `Error: ${data.error}`;
        
        const assistantMessage = {
          role: 'assistant',
          content,
          model: data.model,
          mode
        };

        setMessages(prev => [...prev, assistantMessage]);
        saveMessage(convId, 'assistant', content, mode, null, data.model);
      }
      
      loadConversations();
    } catch (error) {
      const errorMsg = `Error: ${error.message}`;
      setMessages(prev => [...prev, { role: 'assistant', content: errorMsg }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex h-[700px] rounded-2xl overflow-hidden shadow-xl bg-white">
      {/* Sidebar */}
      <div 
        className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 bg-gray-900 flex flex-col overflow-hidden flex-shrink-0`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-white/10">
          <button
            onClick={createNewConversation}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-white font-medium transition-colors"
          >
            <Plus className="w-5 h-5" />
            New Chat
          </button>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => loadConversation(conv.id)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                currentConversationId === conv.id
                  ? 'bg-white/20 text-white'
                  : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 truncate text-sm">{conv.title}</span>
              <button
                onClick={(e) => deleteConversation(conv.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          ))}
          
          {conversations.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm">
              No conversations yet
            </div>
          )}
        </div>

        {/* Import Button */}
        <div className="p-4 border-t border-white/10">
          <button
            onClick={() => setShowImportModal(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-sm"
          >
            <Upload className="w-4 h-4" />
            Import Historical Data
          </button>
        </div>
      </div>

      {/* Sidebar Toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className={`absolute top-4 z-10 p-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-all ${
          sidebarOpen ? 'left-[276px]' : 'left-2'
        }`}
      >
        {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-gradient-to-br from-slate-50 to-slate-100">
        {/* Header */}
        <div className="px-6 py-4 bg-white/80 backdrop-blur-sm border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-r from-violet-500 to-purple-500 rounded-xl">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900">AI Analytics</h2>
                <p className="text-xs text-gray-500">GPT-5.1 • {messages.length} messages</p>
              </div>
            </div>

            {/* Mode & Depth */}
            <div className="flex items-center gap-3">
              <div className="flex bg-gray-100 rounded-lg p-1">
                {MODES.map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        mode === m.id
                          ? 'bg-white shadow-sm text-gray-900'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {m.label}
                    </button>
                  );
                })}
              </div>

              {mode === 'decide' && (
                <div className="flex bg-gray-100 rounded-lg p-1">
                  {DEPTHS.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDepth(d.id)}
                      className={`px-2.5 py-1.5 rounded-md text-sm transition-all ${
                        depth === d.id
                          ? 'bg-white shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                      title={d.label}
                    >
                      {d.emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && !loading ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <div className="p-4 bg-gradient-to-r from-violet-500/20 to-purple-500/20 rounded-2xl mb-4">
                <Sparkles className="w-12 h-12 text-violet-500" />
              </div>
              <p className="text-lg font-medium text-gray-600">How can I help you today?</p>
              <p className="text-sm mt-1">Ask me anything about your store data</p>
              
              {/* Quick suggestions */}
              <div className="flex flex-wrap gap-2 mt-6 max-w-lg justify-center">
                {[
                  "How are we doing today?",
                  "Which campaigns should I scale?",
                  "Compare today vs yesterday",
                  "Best performing ads?"
                ].map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setQuestion(q)}
                    className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-full text-sm text-gray-600 transition-all hover:shadow-sm"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-tr-sm'
                        : 'bg-white border border-gray-100 shadow-sm rounded-tl-sm'
                    }`}
                  >
                    {msg.role === 'assistant' && msg.model && (
                      <div className="text-xs text-gray-400 mb-2 flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />
                        {msg.model}
                        {msg.depth && <span className="text-violet-500">• {msg.depth}</span>}
                      </div>
                    )}
                    <div className={msg.role === 'user' ? '' : 'prose prose-sm max-w-none text-gray-700'}>
                      {msg.role === 'assistant' ? formatMessage(msg.content) : msg.content}
                    </div>
                  </div>
                </div>
              ))}

              {/* Streaming */}
              {streamingText && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-3 bg-white border border-gray-100 shadow-sm">
                    <div className="text-xs text-gray-400 mb-2 flex items-center gap-2">
                      <Sparkles className="w-3 h-3 animate-pulse" />
                      Thinking...
                    </div>
                    <div className="prose prose-sm max-w-none text-gray-700">
                      {formatMessage(streamingText)}
                      <span className="inline-block w-2 h-4 bg-violet-500 animate-pulse ml-1" />
                    </div>
                  </div>
                </div>
              )}

              {/* Loading */}
              {loading && !streamingText && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-white border border-gray-100">
                    <div className="flex items-center gap-2 text-gray-500">
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
        <div className="p-4 bg-white/80 backdrop-blur-sm border-t border-gray-200 flex-shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about your data..."
              className="flex-1 px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/50 text-gray-800"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className={`px-5 py-3 rounded-xl font-medium transition-all flex items-center gap-2 ${
                loading || !question.trim()
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:shadow-lg'
              }`}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </form>
        </div>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal 
          store={store} 
          onClose={() => setShowImportModal(false)} 
        />
      )}
    </div>
  );
}

// Import Modal Component
function ImportModal({ store, onClose }) {
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleImport = async () => {
    if (!csvText.trim()) return;

    setImporting(true);
    setResult(null);

    try {
      // Parse CSV
      const lines = csvText.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
      
      const data = lines.slice(1).map(line => {
        const values = line.split(',');
        const row = {};
        headers.forEach((h, i) => {
          row[h] = values[i]?.trim();
        });
        return row;
      });

      // Send to server
      const res = await fetch('/api/ai/import-historical', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store: store.id, data })
      });

      const result = await res.json();
      setResult(result);
    } catch (e) {
      setResult({ success: false, error: e.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-900">Import Historical Data</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">
            Paste CSV data with columns: <code className="bg-gray-100 px-1 rounded">date, campaign_name, spend, conversions, conversion_value</code>
          </p>
          
          <p className="text-xs text-gray-500">
            Optional columns: campaign_id, country, impressions, clicks
          </p>

          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={`date,campaign_name,spend,conversions,conversion_value
2023-01-15,White Friday,500,10,2500
2023-01-16,White Friday,450,8,2000
2023-01-17,GCC Campaign,300,5,1200`}
            className="w-full h-64 px-4 py-3 border border-gray-200 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50"
          />

          {result && (
            <div className={`p-4 rounded-lg ${result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {result.success 
                ? `✓ Imported ${result.imported} records (${result.skipped} skipped)`
                : `✕ Error: ${result.error}`
              }
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={importing || !csvText.trim()}
              className={`flex-1 px-4 py-2.5 rounded-lg font-medium transition-all ${
                importing || !csvText.trim()
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-violet-500 to-purple-500 text-white hover:shadow-lg'
              }`}
            >
              {importing ? 'Importing...' : 'Import Data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Format assistant messages
function formatMessage(text) {
  if (!text) return null;
  
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) {
      return <h3 key={i} className="text-lg font-bold text-gray-900 mt-3 mb-2">{line.slice(3)}</h3>;
    }
    if (line.startsWith('### ')) {
      return <h4 key={i} className="text-md font-semibold text-gray-800 mt-2 mb-1">{line.slice(4)}</h4>;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <div key={i} className="flex gap-2 ml-2 my-0.5">
          <span className="text-violet-500">•</span>
          <span>{formatBold(line.slice(2))}</span>
        </div>
      );
    }
    if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        return (
          <div key={i} className="flex gap-2 ml-2 my-0.5">
            <span className="text-violet-600 font-medium min-w-[1.5rem]">{match[1]}.</span>
            <span>{formatBold(match[2])}</span>
          </div>
        );
      }
    }
    if (line.startsWith('---')) {
      return <hr key={i} className="my-3 border-gray-200" />;
    }
    if (line.trim() === '') {
      return <div key={i} className="h-1.5" />;
    }
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
