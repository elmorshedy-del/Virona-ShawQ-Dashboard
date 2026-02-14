import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Activity,
  AlertTriangle,
  Calendar,
  ChevronRight,
  RefreshCw,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function formatPercent(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNumber(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = payload?.error || payload?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return payload;
}

function severityStyles(severity) {
  if (severity === 'high') return { badge: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' };
  if (severity === 'medium') return { badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' };
  return { badge: 'bg-slate-50 text-slate-700 border-slate-200', dot: 'bg-slate-400' };
}

function domainLabel(domain) {
  if (domain === 'growth') return 'Growth';
  if (domain === 'waste') return 'Waste';
  if (domain === 'tracking') return 'Tracking';
  return 'Risk';
}

function domainChip(domain) {
  if (domain === 'growth') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (domain === 'waste') return 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200';
  if (domain === 'tracking') return 'bg-sky-50 text-sky-700 border-sky-200';
  return 'bg-indigo-50 text-indigo-700 border-indigo-200';
}

function metricFormat(metricKey, value, formatCurrency) {
  if (value == null || Number.isNaN(value)) return '—';
  if (metricKey === 'revenue' || metricKey === 'spend') return formatCurrency ? formatCurrency(value, 0) : formatNumber(value, 0);
  if (metricKey === 'orders' || metricKey === 'clicks' || metricKey === 'conversions') return formatNumber(value, 0);
  if (metricKey === 'roas' || metricKey === 'aov' || metricKey === 'cpm') return formatNumber(value, 2);
  if (metricKey === 'ctr' || metricKey === 'cvr' || metricKey === 'discountRate' || metricKey === 'attributionGap') return formatPercent(value, 1);
  return formatNumber(value, 2);
}

function HealthBadge({ status }) {
  const styles = useMemo(() => {
    if (status === 'healthy') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (status === 'needs_attention') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (status === 'warning') return 'bg-orange-50 text-orange-700 border-orange-200';
    return 'bg-red-50 text-red-700 border-red-200';
  }, [status]);

  const label = useMemo(() => {
    if (status === 'healthy') return 'Healthy';
    if (status === 'needs_attention') return 'Needs attention';
    if (status === 'warning') return 'Warning';
    return 'Critical';
  }, [status]);

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${styles}`}>
      <span className="h-2 w-2 rounded-full bg-current opacity-60" />
      {label}
    </span>
  );
}

function formatCompactDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}`;
}

async function streamAi({ question, store, onDelta }) {
  const res = await fetch('/api/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, store, mode: 'summarize' })
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || payload.message || 'AI request failed');
  }

  if (!res.body) throw new Error('Streaming response not available');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
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
          throw new Error(payload.error || 'AI request failed');
        }
        if (payload.type === 'done') {
          return;
        }
      }

      splitIndex = buffer.indexOf('\n\n');
    }
  }
}

export default function WatchtowerTab({ store, formatCurrency }) {
  const storeId = store?.id || 'shawq';
  const [rangeDays, setRangeDays] = useState(60);
  const [scanDays, setScanDays] = useState(14);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [overview, setOverview] = useState(null);

  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [series, setSeries] = useState(null);
  const [drivers, setDrivers] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiText, setAiText] = useState('');
  const aiAbortRef = useRef({ aborted: false });

  const annotations = overview?.annotations || [];

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        store: storeId,
        rangeDays: String(rangeDays),
        scanDays: String(scanDays)
      });
      const res = await fetchJson(`/api/watchtower/overview?${params.toString()}`);
      setOverview(res.data || null);
    } catch (err) {
      setOverview(null);
      setError(err.message || 'Failed to load Watchtower');
    } finally {
      setLoading(false);
    }
  }, [storeId, rangeDays, scanDays]);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError('');
    try {
      const params = new URLSearchParams({ store: storeId });
      const res = await fetchJson(`/api/watchtower/rules?${params.toString()}`);
      setRules(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setRules([]);
      setRulesError(err.message || 'Failed to load guardrails');
    } finally {
      setRulesLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    loadOverview();
    loadRules();
  }, [loadOverview, loadRules]);

  const handleOpenAlert = useCallback(async (alert) => {
    setSelectedAlert(alert);
    setDrawerOpen(true);
    setSeries(null);
    setDrivers(null);
    setAiOpen(false);
    setAiText('');
    aiAbortRef.current.aborted = false;
    setDetailError('');
    setDetailLoading(true);

    try {
      const paramsSeries = new URLSearchParams({
        store: storeId,
        metric: alert.metricKey,
        rangeDays: String(rangeDays)
      });
      const paramsDrivers = new URLSearchParams({
        store: storeId,
        metric: alert.metricKey,
        date: alert.date,
        windowDays: String(alert.windowDays || 14)
      });

      const [seriesRes, driversRes] = await Promise.all([
        fetchJson(`/api/watchtower/series?${paramsSeries.toString()}`),
        fetchJson(`/api/watchtower/drivers?${paramsDrivers.toString()}`)
      ]);

      setSeries(seriesRes.data || null);
      setDrivers(driversRes.data || null);
    } catch (err) {
      setDetailError(err.message || 'Failed to load details');
    } finally {
      setDetailLoading(false);
    }
  }, [storeId, rangeDays]);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedAlert(null);
    setSeries(null);
    setDrivers(null);
    setDetailError('');
    aiAbortRef.current.aborted = true;
    setAiStreaming(false);
  }, []);

  const freshness = overview?.freshness || {};

  const alertCounts = useMemo(() => {
    const list = overview?.alerts || [];
    return {
      total: list.length,
      high: list.filter((a) => a.severity === 'high').length,
      medium: list.filter((a) => a.severity === 'medium').length,
      low: list.filter((a) => a.severity === 'low').length
    };
  }, [overview?.alerts]);

  const [annotationDraft, setAnnotationDraft] = useState(() => ({
    eventDate: '',
    category: 'promo',
    title: '',
    detail: ''
  }));

  useEffect(() => {
    if (!overview?.snapshot?.date) return;
    setAnnotationDraft((prev) => (prev.eventDate ? prev : { ...prev, eventDate: overview.snapshot.date }));
  }, [overview?.snapshot?.date]);

  const handleCreateAnnotation = useCallback(async () => {
    const payload = {
      store: storeId,
      eventDate: annotationDraft.eventDate,
      category: annotationDraft.category,
      title: annotationDraft.title,
      detail: annotationDraft.detail
    };

    try {
      await fetchJson('/api/watchtower/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setAnnotationDraft((prev) => ({ ...prev, title: '', detail: '' }));
      loadOverview();
    } catch (err) {
      setError(err.message || 'Failed to add annotation');
    }
  }, [annotationDraft, storeId, loadOverview]);

  const handleDeleteAnnotation = useCallback(async (id) => {
    try {
      const params = new URLSearchParams({ store: storeId });
      await fetchJson(`/api/watchtower/annotations/${id}?${params.toString()}`, { method: 'DELETE' });
      loadOverview();
    } catch (err) {
      setError(err.message || 'Failed to delete annotation');
    }
  }, [storeId, loadOverview]);

  const handleToggleRule = useCallback(async (rule) => {
    try {
      setRulesError('');
      await fetchJson('/api/watchtower/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rule,
          store: storeId,
          isEnabled: !rule.isEnabled
        })
      });
      loadRules();
      loadOverview();
    } catch (err) {
      setRulesError(err.message || 'Failed to update guardrail');
    }
  }, [storeId, loadOverview, loadRules]);

  const handleUpdateRule = useCallback(async (rule, patch) => {
    try {
      setRulesError('');
      await fetchJson('/api/watchtower/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rule,
          ...patch,
          store: storeId
        })
      });
      loadRules();
      loadOverview();
    } catch (err) {
      setRulesError(err.message || 'Failed to update guardrail');
    }
  }, [storeId, loadOverview, loadRules]);

  const handleExplainWithAi = useCallback(async () => {
    if (!selectedAlert || aiStreaming) return;
    setAiOpen(true);
    setAiStreaming(true);
    setAiText('');
    aiAbortRef.current.aborted = false;

    const driverBullets = (drivers?.drivers || [])
      .slice(0, 6)
      .map((d) => `- ${d.dimension}: ${d.key} (Δ ${(d.deltaPct == null ? '—' : `${(d.deltaPct * 100).toFixed(0)}%`)})`)
      .join('\n');

    const question = [
      `You are a senior performance analyst.`,
      `Explain this anomaly and provide 5 concrete next actions (not vanity).`,
      ``,
      `Context:`,
      `- Store: ${storeId}`,
      `- Metric: ${selectedAlert.metricLabel} (${selectedAlert.metricKey})`,
      `- Date: ${selectedAlert.date}`,
      `- Observed: ${metricFormat(selectedAlert.metricKey, selectedAlert.observed, formatCurrency)}`,
      `- Expected (baseline): ${metricFormat(selectedAlert.metricKey, selectedAlert.expected, formatCurrency)}`,
      `- Delta: ${selectedAlert.deltaPct == null ? '—' : `${(selectedAlert.deltaPct * 100).toFixed(1)}%`}`,
      `- Confidence: ${selectedAlert.confidence == null ? '—' : `${Math.round(selectedAlert.confidence * 100)}%`}`,
      ``,
      `Top drivers (if any):`,
      driverBullets || '- —',
      ``,
      `Output format:`,
      `1) What likely happened (3 bullets)`,
      `2) Most probable root causes (ranked)`,
      `3) Actions (5 bullets, each with expected impact and how to verify)`,
      `4) What to monitor next 48h`
    ].join('\n');

    try {
      await streamAi({
        question,
        store: storeId,
        onDelta: (delta) => {
          if (aiAbortRef.current.aborted) return;
          setAiText((prev) => prev + delta);
        }
      });
    } catch (err) {
      setAiText(`Error: ${err.message || 'AI request failed'}`);
    } finally {
      setAiStreaming(false);
    }
  }, [selectedAlert, aiStreaming, drivers, storeId, formatCurrency]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-indigo-600" />
              <h2 className="text-xl font-semibold text-gray-900">Watchtower</h2>
              {overview?.health?.status ? <HealthBadge status={overview.health.status} /> : null}
            </div>
            <p className="mt-1 text-sm text-gray-600 max-w-2xl">
              Always-on anomaly detection + guardrails across revenue, spend, efficiency, and tracking — with drilldowns and AI explanations.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1">
                <Calendar className="h-3.5 w-3.5" />
                Window: last {rangeDays}d
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1">
                <Activity className="h-3.5 w-3.5" />
                Scan: last {scanDays}d
              </span>
              {overview?.generatedAt ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Updated {new Date(overview.generatedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
              <Settings2 className="h-4 w-4 text-gray-400" />
              <select
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value))}
                className="bg-transparent text-sm text-gray-700 focus:outline-none"
              >
                {[30, 60, 90, 120].map((d) => (
                  <option key={d} value={d}>{d}d window</option>
                ))}
              </select>
              <div className="h-5 w-px bg-gray-200" />
              <select
                value={scanDays}
                onChange={(e) => setScanDays(Number(e.target.value))}
                className="bg-transparent text-sm text-gray-700 focus:outline-none"
              >
                {[7, 14, 21, 28].map((d) => (
                  <option key={d} value={d}>{d}d scan</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={loadOverview}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Scan now
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Health score</div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <div className="text-3xl font-semibold text-gray-900">
                  {overview?.health?.score ?? '—'}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Based on severity-weighted signals + freshness
                </div>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <div className="flex items-center justify-between gap-3">
                  <span>High</span><span className="font-semibold text-gray-900">{alertCounts.high}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Med</span><span className="font-semibold text-gray-900">{alertCounts.medium}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Low</span><span className="font-semibold text-gray-900">{alertCounts.low}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-2 text-xs text-gray-600">
              <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <span>Orders freshness</span>
                <span className="font-semibold text-gray-900">{freshness.orders?.lastDate || '—'}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <span>Meta freshness</span>
                <span className="font-semibold text-gray-900">{freshness.meta?.lastDate || '—'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Today snapshot</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{overview?.snapshot?.date || '—'}</div>
                <div className="mt-1 text-xs text-gray-500">
                  Fast glance: revenue, orders, spend, ROAS
                </div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700">
                <Sparkles className="h-4 w-4" />
                Click a signal to investigate
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="text-xs text-gray-500">Revenue</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">
                  {metricFormat('revenue', overview?.snapshot?.revenue, formatCurrency)}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="text-xs text-gray-500">Orders</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">
                  {metricFormat('orders', overview?.snapshot?.orders, formatCurrency)}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="text-xs text-gray-500">Spend</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">
                  {metricFormat('spend', overview?.snapshot?.spend, formatCurrency)}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="text-xs text-gray-500">ROAS</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">
                  {metricFormat('roas', overview?.snapshot?.roas, formatCurrency)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Signal inbox</h3>
              <span className="text-xs text-gray-500">({alertCounts.total})</span>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white">
            {loading ? (
              <div className="p-6 text-sm text-gray-500">Scanning…</div>
            ) : null}

            {!loading && overview?.alerts?.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">
                No actionable anomalies detected in the last {scanDays} days. This tab will light up when something moves materially.
              </div>
            ) : null}

            <div className="divide-y divide-gray-100">
              {(overview?.alerts || []).map((alert) => {
                const styles = severityStyles(alert.severity);
                return (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => handleOpenAlert(alert)}
                    className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-gray-50"
                  >
                    <div className={`mt-1 h-2.5 w-2.5 rounded-full ${styles.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{alert.title}</span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles.badge}`}>
                          {alert.severity.toUpperCase()}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${domainChip(alert.domain)}`}>
                          {domainLabel(alert.domain)}
                        </span>
                        <span className="text-[11px] font-semibold text-gray-500">{alert.date}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span>
                          Observed: <span className="font-semibold text-gray-800">{metricFormat(alert.metricKey, alert.observed, formatCurrency)}</span>
                        </span>
                        <span>·</span>
                        <span>
                          Expected: <span className="font-semibold text-gray-800">{metricFormat(alert.metricKey, alert.expected, formatCurrency)}</span>
                        </span>
                        <span>·</span>
                        <span>
                          Δ: <span className="font-semibold text-gray-800">{alert.deltaPct == null ? '—' : `${(alert.deltaPct * 100).toFixed(1)}%`}</span>
                        </span>
                        <span>·</span>
                        <span>
                          Conf: <span className="font-semibold text-gray-800">{alert.confidence == null ? '—' : `${Math.round(alert.confidence * 100)}%`}</span>
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 text-gray-400" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900">Guardrails</h3>
              </div>
              {rulesLoading ? <span className="text-xs text-gray-400">Loading…</span> : null}
            </div>

            {rulesError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{rulesError}</div>
            ) : null}

            <div className="mt-4 space-y-3">
              {rules.slice(0, 8).map((rule) => (
                <div key={rule.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-gray-900">
                        {rule.title || rule.metricKey}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {rule.metricKey} · {rule.direction} · {rule.thresholdType}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleRule(rule)}
                      className={`h-6 w-11 rounded-full transition-colors ${rule.isEnabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
                      title={rule.isEnabled ? 'Enabled' : 'Disabled'}
                    >
                      <span className={`block h-5 w-5 translate-y-0.5 rounded-full bg-white transition-transform ${rule.isEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-[11px] text-gray-500">
                      Threshold
                      <input
                        type="number"
                        step="0.01"
                        value={rule.thresholdValue}
                        onChange={(e) => handleUpdateRule(rule, { thresholdValue: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                      />
                    </label>
                    <label className="text-[11px] text-gray-500">
                      Window (days)
                      <input
                        type="number"
                        min="7"
                        max="56"
                        value={rule.windowDays}
                        onChange={(e) => handleUpdateRule(rule, { windowDays: Number(e.target.value) })}
                        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                      />
                    </label>
                  </div>
                </div>
              ))}
              {rules.length > 8 ? (
                <div className="text-xs text-gray-500">
                  Showing 8 of {rules.length}. (You can extend this panel later.)
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Annotations</h3>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Add context (promo, creative, site changes) so spikes/drops are explainable later.
            </p>

            <div className="mt-4 grid gap-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={annotationDraft.eventDate}
                  onChange={(e) => setAnnotationDraft((prev) => ({ ...prev, eventDate: e.target.value }))}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700"
                />
                <select
                  value={annotationDraft.category}
                  onChange={(e) => setAnnotationDraft((prev) => ({ ...prev, category: e.target.value }))}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700"
                >
                  <option value="promo">Promo</option>
                  <option value="creative">Creative</option>
                  <option value="site">Site</option>
                  <option value="budget">Budget</option>
                  <option value="ops">Ops</option>
                  <option value="note">Note</option>
                </select>
              </div>
              <input
                type="text"
                value={annotationDraft.title}
                onChange={(e) => setAnnotationDraft((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g., White Friday promo launched"
                className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700"
              />
              <textarea
                value={annotationDraft.detail}
                onChange={(e) => setAnnotationDraft((prev) => ({ ...prev, detail: e.target.value }))}
                placeholder="Optional details / links"
                rows={2}
                className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700"
              />
              <button
                type="button"
                onClick={handleCreateAnnotation}
                disabled={!annotationDraft.eventDate || !annotationDraft.title.trim()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                Add annotation
              </button>
            </div>

            <div className="mt-5 space-y-2">
              {annotations.slice(0, 8).map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-900">
                      <span className="text-[11px] font-semibold text-gray-500">{a.eventDate}</span>
                      <span className="mx-2 text-gray-300">·</span>
                      {a.title}
                    </div>
                    {a.detail ? <div className="mt-0.5 text-[11px] text-gray-500 line-clamp-2">{a.detail}</div> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteAnnotation(a.id)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-white hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {annotations.length === 0 ? (
                <div className="text-xs text-gray-500">No annotations yet.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <Dialog.Root open={drawerOpen} onOpenChange={(next) => (next ? setDrawerOpen(true) : handleCloseDrawer())}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-slate-950/20 backdrop-blur-sm" />
          <Dialog.Content className="fixed right-0 top-0 h-full w-full max-w-2xl border-l border-white/60 bg-white/95 backdrop-blur-xl shadow-[0_0_0_1px_rgba(15,23,42,0.08),0_20px_60px_rgba(15,23,42,0.18)]">
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between border-b border-gray-200 px-6 py-5">
                <div className="min-w-0">
                  <Dialog.Title className="text-base font-semibold text-gray-900">
                    {selectedAlert?.title || 'Investigate'}
                  </Dialog.Title>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    {selectedAlert?.date ? <span>{selectedAlert.date}</span> : null}
                    {selectedAlert?.domain ? (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${domainChip(selectedAlert.domain)}`}>
                        {domainLabel(selectedAlert.domain)}
                      </span>
                    ) : null}
                    {selectedAlert?.severity ? (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${severityStyles(selectedAlert.severity).badge}`}>
                        {selectedAlert.severity.toUpperCase()}
                      </span>
                    ) : null}
                    {selectedAlert?.confidence != null ? (
                      <span>Confidence: {Math.round(selectedAlert.confidence * 100)}%</span>
                    ) : null}
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button
                    type="button"
                    onClick={handleCloseDrawer}
                    className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>

              <div className="flex-1 overflow-auto px-6 py-5">
                {detailError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {detailError}
                  </div>
                ) : null}

                {detailLoading ? (
                  <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    Loading details…
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 lg:col-span-2">
                    <div className="text-xs font-semibold uppercase text-gray-400">
                      Trend
                    </div>
                    <div className="mt-2 h-56 rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={(series?.series || []).map((p) => ({ ...p, label: formatCompactDate(p.date) }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} width={42} />
                          <Tooltip
                            formatter={(value) => metricFormat(selectedAlert?.metricKey, value, formatCurrency)}
                            labelFormatter={(label, payload) => {
                              const date = payload?.[0]?.payload?.date;
                              return date ? `${date}` : label;
                            }}
                          />
                          {selectedAlert?.expected != null ? (
                            <ReferenceLine y={selectedAlert.expected} stroke="#6366f1" strokeDasharray="4 4" />
                          ) : null}
                          <Line type="monotone" dataKey="value" stroke="#111827" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                        <div className="text-xs text-gray-500">Observed</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">
                          {metricFormat(selectedAlert?.metricKey, selectedAlert?.observed, formatCurrency)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                        <div className="text-xs text-gray-500">Expected</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">
                          {metricFormat(selectedAlert?.metricKey, selectedAlert?.expected, formatCurrency)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
                        <div className="text-xs text-gray-500">Delta</div>
                        <div className="mt-1 text-sm font-semibold text-gray-900">
                          {selectedAlert?.deltaPct == null ? '—' : `${(selectedAlert.deltaPct * 100).toFixed(1)}%`}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="text-xs font-semibold uppercase text-gray-400">Drivers</div>
                    <div className="mt-2 space-y-2">
                      {(drivers?.drivers || []).slice(0, 8).map((d) => (
                        <div key={`${d.dimension}-${d.key}`} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 text-xs font-semibold text-gray-900 truncate">
                              {d.key}
                            </div>
                            <div className="text-[11px] font-semibold text-gray-600">
                              {d.deltaPct == null ? '—' : `${(d.deltaPct * 100).toFixed(0)}%`}
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-gray-500">
                            {metricFormat(selectedAlert?.metricKey, d.observed, formatCurrency)} vs {metricFormat(selectedAlert?.metricKey, d.expected, formatCurrency)}
                          </div>
                        </div>
                      ))}
                      {(drivers?.drivers || []).length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-500">
                          No drivers available yet.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-900">Explain with AI</div>
                    <button
                      type="button"
                      onClick={handleExplainWithAi}
                      disabled={aiStreaming || !selectedAlert}
                      className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                    >
                      <Sparkles className="h-4 w-4" />
                      {aiStreaming ? 'Thinking…' : 'Generate'}
                    </button>
                  </div>

                  {aiOpen ? (
                    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm max-w-none">
                        {aiText || (aiStreaming ? '...' : '—')}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-gray-500">
                      Generates a root-cause hypothesis + 5 concrete actions (with verification steps).
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

