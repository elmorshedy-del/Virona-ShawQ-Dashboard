import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';

const COLLAPSED_PREVIEW_CHARS = 180;
const REGENERATE_BUTTON_LABEL = 'Regenerate Yesterday';
const MONTH_INDEX_OFFSET = 1;

function formatModelLabel(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower.includes('glm-5')) return 'GLM-5';
  if (lower === 'gpt-5.2') return 'GPT-5.2';
  return normalized;
}

function formatBriefDate(value) {
  if (!value) return 'Closed day';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function buildPreview(markdown) {
  const normalized = String(markdown || '')
    .replace(/\*\*/g, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'No narrative brief available yet.';
  if (normalized.length <= COLLAPSED_PREVIEW_CHARS) return normalized;
  return `${normalized.slice(0, COLLAPSED_PREVIEW_CHARS - 1).trim()}...`;
}

function getFallbackYesterdayBriefDate() {
  const localYesterday = new Date();
  localYesterday.setDate(localYesterday.getDate() - 1);
  const year = localYesterday.getFullYear();
  const month = String(localYesterday.getMonth() + MONTH_INDEX_OFFSET).padStart(2, '0');
  const day = String(localYesterday.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DashboardDailyBriefCard({ apiBase = '/api', storeId, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [brief, setBrief] = useState(null);

  const loadBrief = useCallback(async ({ signal, force = false, briefDate = null } = {}) => {
    if (!storeId) return;

    const isForceRun = Boolean(force);
    if (isForceRun) {
      setRegenerating(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const response = isForceRun
        ? await fetch(`${apiBase}/dashboard-daily-brief/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: storeId, force: true, briefDate }),
          signal
        })
        : await fetch(`${apiBase}/dashboard-daily-brief?store=${encodeURIComponent(storeId)}${briefDate ? `&briefDate=${encodeURIComponent(briefDate)}` : ''}`, {
          signal
        });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${response.status}`);
      }
      setBrief(json.brief || null);
    } catch (fetchError) {
      if (fetchError?.name === 'AbortError') return;
      setError(fetchError?.message || (isForceRun ? 'Failed to regenerate daily brief' : 'Failed to load daily brief'));
      if (!isForceRun) {
        setBrief(null);
      }
    } finally {
      if (!signal?.aborted) {
        if (isForceRun) {
          setRegenerating(false);
        } else {
          setLoading(false);
        }
      }
    }
  }, [apiBase, storeId]);

  useEffect(() => {
    if (!storeId) return undefined;

    const controller = new AbortController();
    loadBrief({ signal: controller.signal });
    return () => controller.abort();
  }, [loadBrief, storeId]);

  const previewText = useMemo(() => buildPreview(brief?.paragraph), [brief?.paragraph]);
  const targetBriefDate = getFallbackYesterdayBriefDate();
  const isBusy = loading || regenerating;

  return (
    <div className={`bg-white rounded-xl p-5 shadow-sm border border-gray-100 ${className}`.trim()}>
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                Campaign Daily Brief
              </span>
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-700">
                Store-wide
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{formatBriefDate(brief?.briefDate)}</span>
              {brief?.model ? <span>{formatModelLabel(brief.model)}</span> : null}
              {brief?.createdAt ? <span>Generated {new Date(brief.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span> : null}
            </div>
            {!expanded && error && (
              <p className="mt-3 text-sm leading-6 text-rose-700">{error}</p>
            )}
            {!expanded && loading && !error && !brief && (
              <p className="mt-3 text-sm leading-6 text-gray-500">Loading daily brief...</p>
            )}
            {!expanded && !loading && !error && (
              <p className="mt-3 text-sm leading-6 text-gray-700">{previewText}</p>
            )}
          </div>
        </button>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => loadBrief({ force: true, briefDate: targetBriefDate })}
            disabled={!storeId || isBusy}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={REGENERATE_BUTTON_LABEL}
            title={`${REGENERATE_BUTTON_LABEL} (${formatBriefDate(targetBriefDate)})`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{REGENERATE_BUTTON_LABEL}</span>
          </button>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : null}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-50 hover:text-gray-600"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse daily brief' : 'Expand daily brief'}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          {error ? (
            <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : loading && !brief ? (
            <div className="text-sm text-gray-500">Loading daily brief...</div>
          ) : brief?.paragraph ? (
            <div className="prose prose-sm max-w-none text-gray-700 prose-p:my-0 prose-strong:text-gray-900 prose-em:text-gray-700">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {brief.paragraph}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No daily brief available for the latest closed day.</div>
          )}
        </div>
      )}
    </div>
  );
}
