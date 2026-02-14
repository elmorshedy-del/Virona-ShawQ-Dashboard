import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MODE_CONFIG = {
  assistant: {
    endpoint: '/api/attribution/assistant',
    label: 'Instant AI'
  },
  debug: {
    endpoint: '/api/attribution/assistant/debug',
    label: 'Claude Opus'
  }
};

const LLM_STORAGE_KEY = 'virona.attribution.assistant.llm.v1';

function loadLlmSettings() {
  try {
    const raw = window.localStorage.getItem(LLM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function persistLlmSettings(value) {
  try {
    window.localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(value));
  } catch (_error) {
    // ignore
  }
}

function buildEmptyMessage(role, content) {
  return { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role, content };
}

async function streamSseResponse({ endpoint, payload, onDelta }) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: true })
  });

  if (!res.ok) {
    const errorPayload = await res.json().catch(() => ({}));
    throw new Error(errorPayload.error || 'AI request failed.');
  }

  if (!res.body) {
    throw new Error('Streaming response is not available.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitIndex = buffer.indexOf('\n\n');
    while (splitIndex !== -1) {
      const raw = buffer.slice(0, splitIndex).trim();
      buffer = buffer.slice(splitIndex + 2);

      if (raw.startsWith('data:')) {
        const json = raw.replace(/^data:\s*/, '');
        const payload = JSON.parse(json);
        if (payload.type === 'delta') {
          onDelta(payload.text || '');
        }
        if (payload.type === 'error') {
          throw new Error(payload.error || 'AI request failed.');
        }
        if (payload.type === 'done') {
          return;
        }
      }

      splitIndex = buffer.indexOf('\n\n');
    }
  }
}

export default function AttributionChatDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  mode = 'assistant',
  context,
  autoPrompt
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const autoPromptRef = useRef(false);
  const scrollRef = useRef(null);

  const modeConfig = MODE_CONFIG[mode] || MODE_CONFIG.assistant;
  const [llmSettings, setLlmSettings] = useState(() => (
    loadLlmSettings() || { provider: 'deepseek', model: 'deepseek-reasoner', temperature: 1.0 }
  ));

  const promptContext = useMemo(() => context || {}, [context]);

  useEffect(() => {
    if (!open) {
      setMessages([]);
      setInput('');
      setError('');
      setStreaming(false);
      autoPromptRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    persistLlmSettings(llmSettings);
  }, [llmSettings, open]);

  const handleSend = useCallback(async (value) => {
    const content = value.trim();
    if (!content || streaming) return;

    setError('');
    const userMessage = buildEmptyMessage('user', content);
    const assistantMessage = buildEmptyMessage('assistant', '');

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setStreaming(true);
    setInput('');

    try {
      await streamSseResponse({
        endpoint: modeConfig.endpoint,
        payload: {
          question: content,
          context: promptContext,
          llm: mode === 'assistant' ? llmSettings : undefined
        },
        onDelta: (delta) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              last.content += delta;
            }
            return next;
          });
        }
      });
    } catch (err) {
      setError(err.message || 'AI request failed.');
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          last.content = last.content || 'Sorry, I could not respond just now.';
        }
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }, [mode, llmSettings, modeConfig.endpoint, promptContext, streaming]);

  useEffect(() => {
    if (!open || !autoPrompt || autoPromptRef.current || messages.length) return;
    autoPromptRef.current = true;
    handleSend(autoPrompt);
  }, [open, autoPrompt, messages.length, handleSend]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-slate-950/20 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed right-0 top-0 h-full w-full max-w-lg border-l border-white/60 bg-white/90 backdrop-blur-xl shadow-[0_0_0_1px_rgba(15,23,42,0.08),0_20px_60px_rgba(15,23,42,0.18),0_0_40px_rgba(59,130,246,0.18)]"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between border-b border-slate-200/70 px-6 py-4">
              <div>
                <Dialog.Title className="text-lg font-semibold text-slate-900">{title}</Dialog.Title>
                <div className="text-xs text-slate-500 mt-1">
                  {subtitle || modeConfig.label}
                </div>
                {mode === 'assistant' && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      value={`${llmSettings.provider}:${llmSettings.model || 'auto'}`}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === 'openai:auto') {
                          setLlmSettings((prev) => ({ ...prev, provider: 'openai', model: '' }));
                          return;
                        }
                        if (value === 'deepseek:deepseek-chat') {
                          setLlmSettings((prev) => ({ ...prev, provider: 'deepseek', model: 'deepseek-chat' }));
                          return;
                        }
                        if (value === 'deepseek:deepseek-reasoner') {
                          setLlmSettings((prev) => ({ ...prev, provider: 'deepseek', model: 'deepseek-reasoner' }));
                        }
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                      title="AI model"
                    >
                      <option value="deepseek:deepseek-reasoner">DeepSeek Reasoner (Thinking)</option>
                      <option value="deepseek:deepseek-chat">DeepSeek Chat (Non-thinking)</option>
                      <option value="openai:auto">OpenAI (gpt-4o-mini)</option>
                    </select>

                    {llmSettings.provider === 'deepseek' && (
                      <select
                        value={String(llmSettings.temperature ?? 1.0)}
                        onChange={(event) => setLlmSettings((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                        title="Temperature"
                      >
                        <option value="0">Coding / Math (0.0)</option>
                        <option value="1">Data Analysis (1.0)</option>
                        <option value="1.3">General / Translation (1.3)</option>
                        <option value="1.5">Creative Writing (1.5)</option>
                      </select>
                    )}
                  </div>
                )}
              </div>
              <Dialog.Close
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:text-slate-900"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
              {messages.length === 0 && (
                <div className="rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-sm text-slate-600">
                  Ask anything about attribution quality, missing orders, or tracking health.
                </div>
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                      message.role === 'user'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-700 border border-slate-200/70'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || '...'}</ReactMarkdown>
                    ) : (
                      message.content
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200/70 px-6 py-4">
              {error && (
                <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
              <form
                className="flex items-center gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSend(input);
                }}
              >
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask a question"
                  className="flex-1 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                />
                <button
                  type="submit"
                  disabled={streaming || !input.trim()}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {streaming ? '...' : 'Send'}
                </button>
              </form>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
