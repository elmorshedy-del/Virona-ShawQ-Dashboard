import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Compass,
  ExternalLink,
  Globe2,
  Lightbulb,
  Loader2,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  TrendingUp
} from 'lucide-react';

const API_BASE = '/api';

const QUICK_IDEAS = [
  'palestinian hoodie premium embroidery',
  'olive branch embroidered skirt palestinian',
  'tatreez long sleeve streetwear',
  'keffiyeh modern cut hoodie',
  'palestinian heritage overshirt'
];

const BREADTH_OPTIONS = {
  precision: { label: 'Precision', maxCandidates: 8 },
  balanced: { label: 'Balanced', maxCandidates: 12 },
  scout: { label: 'Scout Wide', maxCandidates: 18 }
};

const FLOW_STEPS = [
  { id: 'store', title: 'Store Lens', blurb: 'Every recommendation is tied to your store profile.' },
  { id: 'trend', title: 'Sustained Trend', blurb: 'Uses time-series direction, not one-off spikes.' },
  { id: 'market', title: 'Market Reality', blurb: 'Reads live marketplace listing depth and samples.' },
  { id: 'decision', title: 'Decision Memo', blurb: 'Backend returns GO/TEST/WATCH/HOLD and pace.' }
];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (min, value, max) => Math.min(max, Math.max(min, value));

const postJson = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const message = json?.message || `Request failed (HTTP ${res.status})`;
    throw new Error(message);
  }

  return json;
};

const getJson = async (url) => {
  const res = await fetch(url);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(json?.message || `Request failed (HTTP ${res.status})`);
  }

  return json;
};

function SourceStatus({ label, on, offText, onText }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[#e5def8] bg-white/80 px-3 py-2 text-xs">
      <span className="font-semibold text-slate-600">{label}</span>
      <span className={`inline-flex items-center gap-2 font-semibold ${on ? 'text-emerald-700' : 'text-amber-700'}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${on ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {on ? onText : offText}
      </span>
    </div>
  );
}

function MetricBar({ label, value, tone = 'violet' }) {
  const safe = clamp(0, toNumber(value), 100);
  const toneClass =
    tone === 'mint'
      ? 'from-[#7ad7c5] to-[#42c3ab]'
      : tone === 'blue'
        ? 'from-[#7bb7ff] to-[#4e93ff]'
        : tone === 'rose'
          ? 'from-[#f5a8d9] to-[#e77bc0]'
          : 'from-[#a78bff] to-[#7b61ff]';

  return (
    <div className="rounded-xl border border-[#e6dffc] bg-white p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
        <span>{label}</span>
        <span>{Math.round(safe)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#ede8ff]">
        <div className={`h-full rounded-full bg-gradient-to-r ${toneClass} transition-all duration-500`} style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

function ResultChip({ label, value, tone = 'neutral' }) {
  const tones = {
    good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    bad: 'border-rose-200 bg-rose-50 text-rose-800',
    neutral: 'border-slate-200 bg-slate-100 text-slate-700'
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${tones[tone] || tones.neutral}`}>
      <span>{label}</span>
      <span>{Math.round(toNumber(value))}</span>
    </span>
  );
}

function recommendationBadge(rec) {
  const key = String(rec || '').toLowerCase();
  if (key === 'add_now') return { label: 'ADD NOW', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
  if (key === 'test_small_batch') return { label: 'TEST BATCH', className: 'bg-blue-50 text-blue-800 border-blue-200' };
  if (key === 'watchlist') return { label: 'WATCHLIST', className: 'bg-amber-50 text-amber-800 border-amber-200' };
  return { label: 'REJECT', className: 'bg-rose-50 text-rose-800 border-rose-200' };
}

function OpportunityCard({ item }) {
  const badge = recommendationBadge(item?.recommendation);
  const market = item?.market || {};

  return (
    <div className="rounded-2xl border border-[#e5def8] bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-900">{item?.keyword || 'Untitled concept'}</div>
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${badge.className}`}>
          {badge.label}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <ResultChip label="Total" value={item?.scores?.total} tone="good" />
        <ResultChip label="Search" value={item?.scores?.search} tone="neutral" />
        <ResultChip label="Sustained" value={item?.scores?.sustained} tone="good" />
        <ResultChip label="Market" value={item?.scores?.marketplace} tone="warn" />
        <ResultChip label="Quality" value={item?.scores?.quality} tone="neutral" />
      </div>

      {Array.isArray(item?.rationale) && item.rationale.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
          {item.rationale.slice(0, 2).map((reason) => (
            <li key={`${item?.keyword}-${reason}`}>{reason}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {item?.links?.trends && (
          <a
            href={item.links.trends}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-[#d7cdf9] bg-[#f5f1ff] px-2.5 py-1.5 text-xs font-bold text-violet-800 hover:bg-[#eee6ff]"
          >
            Trends
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {item?.links?.marketplace && (
          <a
            href={item.links.marketplace}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-[#cedcfd] bg-[#edf4ff] px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-[#e5efff]"
          >
            Marketplace
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {market?.marketplace && (
        <div className="mt-3 text-[11px] font-semibold text-slate-500">
          {market.marketplace.toUpperCase()} • {toNumber(market.estimatedResults, 0).toLocaleString()} estimated results
        </div>
      )}
    </div>
  );
}

function PieceCard({ piece }) {
  return (
    <div className="rounded-2xl border border-[#e3ddfa] bg-white p-4 shadow-sm">
      <div className="text-sm font-bold text-slate-900">{piece.title || 'Live market reference'}</div>
      <div className="mt-1 text-xs text-slate-500">Angle: {piece.keyword}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-violet-800">
          Total {Math.round(toNumber(piece.totalScore))}
        </span>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-800">
          Sustained {Math.round(toNumber(piece.sustainedScore))}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
          {piece.marketplace}
        </span>
      </div>
      <div className="mt-2 text-xs text-slate-500">{toNumber(piece.estimatedResults, 0).toLocaleString()} estimated listings</div>
      <a
        href={piece.url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-violet-700 hover:text-violet-900"
      >
        Open live piece
        <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

export default function ProductFinderPremium({ store }) {
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);

  const [query, setQuery] = useState('');
  const [timeframeDays, setTimeframeDays] = useState(90);
  const [breadthKey, setBreadthKey] = useState('balanced');
  const [includeMarketplaces, setIncludeMarketplaces] = useState(true);
  const [metaCountry, setMetaCountry] = useState('ALL');
  const [qualityBias, setQualityBias] = useState(true);

  const [activeLane, setActiveLane] = useState('primary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await getJson(`${API_BASE}/product-finder/health`);
        if (!cancelled) {
          setHealth(res);
          setHealthError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setHealth(null);
          setHealthError(err?.message || 'Unable to load Product Finder health');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const breadth = BREADTH_OPTIONS[breadthKey] || BREADTH_OPTIONS.balanced;
  const sourceStatus = health?.sources || {};

  const activeItems = useMemo(() => {
    if (!result?.lanes) return [];
    if (activeLane === 'experiments') return result.lanes.experiments || [];
    if (activeLane === 'avoid') return result.lanes.avoid || [];
    return result.lanes.primary || [];
  }, [activeLane, result]);

  const runConsultation = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await postJson(`${API_BASE}/product-finder/consult`, {
        query: trimmed,
        timeframeDays,
        maxCandidates: breadth.maxCandidates,
        includeMarketplaces,
        metaCountry,
        qualityBias,
        storeId: store?.id || null,
        storeName: store?.name || null,
        storeTagline: store?.tagline || null
      });
      setResult(res?.data || null);
      setActiveLane('primary');
    } catch (err) {
      setResult(null);
      setError(err?.message || 'Consultation failed');
    } finally {
      setLoading(false);
    }
  };

  const clearResult = () => {
    setResult(null);
    setError(null);
  };

  const consultation = result?.consultation || null;
  const metrics = result?.metrics || null;

  return (
    <div className="relative overflow-hidden rounded-[34px] border border-[#ddd2ff] bg-gradient-to-br from-[#faf7ff] via-[#f5f1ff] to-[#eef5ff] p-4 text-slate-900 shadow-[0_38px_90px_-52px_rgba(80,54,170,0.55)] md:p-7">
      <div className="pointer-events-none absolute -left-20 top-8 h-64 w-64 rounded-full bg-[#d7c8ff]/55 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-[#bfe5ff]/45 blur-3xl" />
      <div className="pointer-events-none absolute left-1/3 top-1/2 h-48 w-48 rounded-full bg-[#f4b9df]/25 blur-3xl" />

      <div className="relative">
        <div className="rounded-[30px] border border-[#e6dcff] bg-white/72 p-5 backdrop-blur md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8cbff] bg-[#f1ebff] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-800">
                <Compass className="h-3.5 w-3.5" />
                Product Finder Studio
              </div>
              <h2 className="mt-4 text-2xl font-black tracking-tight text-slate-900 md:text-4xl" style={{ fontFamily: 'Sora, Manrope, Poppins, sans-serif' }}>
                Standalone Product Consultation
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
                This tab is wired to one backend core only: Product Discovery Agent.
                UI here only renders backend output.
              </p>
            </div>

            <div className="min-w-[250px] rounded-2xl border border-[#dfd4ff] bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Store className="h-4 w-4 text-violet-700" />
                Store context
              </div>
              <div className="mt-2 text-sm font-semibold text-violet-800">{store?.name || 'Store'}: {store?.tagline || 'No tagline'}</div>
              <div className="mt-2 text-xs leading-5 text-slate-600">Engine: {health?.engine || 'product_discovery_agent'}</div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {FLOW_STEPS.map((step, idx) => (
              <div key={step.id} className="rounded-2xl border border-[#e6dcff] bg-white p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md">
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-violet-700">0{idx + 1}</div>
                <div className="mt-2 text-sm font-bold text-slate-900">{step.title}</div>
                <div className="mt-1 text-xs leading-5 text-slate-600">{step.blurb}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
          <div className="rounded-3xl border border-[#e4d8ff] bg-white p-5 shadow-sm md:p-6">
            <label className="mb-2 block text-sm font-bold text-slate-700">Product concept</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. olive three-branch palestinian embroidered skirt"
              rows={3}
              className="w-full rounded-2xl border border-[#d8cbff] bg-[#fbf9ff] p-3 text-sm text-slate-900 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => setQuery(idea)}
                  className="rounded-full border border-[#d9d1ff] bg-[#f6f2ff] px-3 py-1.5 text-xs font-bold text-violet-800 transition-colors hover:bg-[#eee7ff]"
                >
                  {idea}
                </button>
              ))}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <label className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
                Timeframe
                <select
                  value={timeframeDays}
                  onChange={(e) => setTimeframeDays(Number(e.target.value))}
                  className="mt-1.5 block w-full rounded-xl border border-[#d9d0ff] bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                  <option value={365}>12 months</option>
                </select>
              </label>

              <label className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
                Depth mode
                <select
                  value={breadthKey}
                  onChange={(e) => setBreadthKey(e.target.value)}
                  className="mt-1.5 block w-full rounded-xl border border-[#d9d0ff] bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  {Object.entries(BREADTH_OPTIONS).map(([key, option]) => (
                    <option key={key} value={key}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
                Geo focus
                <select
                  value={metaCountry}
                  onChange={(e) => setMetaCountry(e.target.value)}
                  className="mt-1.5 block w-full rounded-xl border border-[#d9d0ff] bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  <option value="ALL">ALL</option>
                  <option value="US">US</option>
                  <option value="GB">GB</option>
                  <option value="AE">AE</option>
                  <option value="SA">SA</option>
                  <option value="DE">DE</option>
                  <option value="FR">FR</option>
                </select>
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 rounded-xl border border-[#dad0ff] bg-[#f8f5ff] px-3 py-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={includeMarketplaces} onChange={(e) => setIncludeMarketplaces(e.target.checked)} />
                Marketplace scans
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-[#dad0ff] bg-[#f8f5ff] px-3 py-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={qualityBias} onChange={(e) => setQualityBias(e.target.checked)} />
                Quality positioning mode
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runConsultation}
                disabled={loading || !query.trim()}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-md transition-all ${
                  loading || !query.trim()
                    ? 'cursor-not-allowed bg-slate-400'
                    : 'bg-gradient-to-r from-[#6d4dff] via-[#7e64ff] to-[#4c9bff] hover:from-[#6344ef] hover:via-[#7458f1] hover:to-[#428de9]'
                }`}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {loading ? 'Running consultation...' : 'Run Product Finder'}
              </button>

              <button
                type="button"
                onClick={clearResult}
                className="rounded-xl border border-[#d5c9ff] bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Clear result
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-[#e4d8ff] bg-white p-5 shadow-sm md:p-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-violet-700" />
              Source health
            </div>

            {healthError && (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {healthError}
              </div>
            )}

            <div className="space-y-2">
              <SourceStatus
                label="Google Trends"
                on={!!sourceStatus?.googleTrends?.configured}
                onText="Connected"
                offText="Unavailable"
              />
              <SourceStatus
                label="Marketplace scanners"
                on={!!sourceStatus?.marketplaceScanners?.configured}
                onText="Connected"
                offText="Unavailable"
              />
              <SourceStatus
                label="AI models"
                on={!!sourceStatus?.aiModels?.available}
                onText="Connected"
                offText="Not used"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-[#e5def8] bg-[#f8f5ff] p-3 text-xs leading-5 text-slate-600">
              Frontend mirrors backend response only (`/api/product-finder/consult`).
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!result && !loading && (
          <div className="mt-6 rounded-3xl border border-dashed border-[#daccff] bg-white/70 p-10 text-center">
            <Target className="mx-auto h-8 w-8 text-violet-500" />
            <h3 className="mt-3 text-xl font-bold text-slate-900">Ready for a backend-driven decision memo</h3>
            <p className="mt-2 text-sm text-slate-600">
              Submit one concept and view exactly what the backend core returns.
            </p>
          </div>
        )}

        {result && consultation && (
          <div className="mt-6 space-y-5">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
              <div className="rounded-3xl border border-[#e3d9ff] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.12em] text-violet-700">Decision memo</div>
                    <div className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">
                      {consultation.decision}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-600">
                      Confidence: {consultation.confidenceLabel} ({Math.round(toNumber(consultation.confidenceScore, 0))})
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Top keyword: <span className="font-semibold">{consultation.topKeyword || '-'}</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#d7cbff] bg-[#f5f0ff] px-4 py-3 text-sm font-bold text-violet-900">
                    {toNumber(consultation?.piecesPerDay?.low, 0).toFixed(1)} - {toNumber(consultation?.piecesPerDay?.high, 0).toFixed(1)} pieces/day
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  {(consultation?.rationale || []).map((line) => (
                    <div key={line} className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-4 w-4 text-violet-600" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-[#e3d9ff] bg-white p-5 shadow-sm">
                <div className="text-xs font-black uppercase tracking-[0.12em] text-violet-700">Backend metrics</div>
                <div className="mt-3 space-y-3">
                  <MetricBar label="Avg Total" value={metrics?.avgTotal} tone="violet" />
                  <MetricBar label="Avg Search" value={metrics?.avgSearch} tone="blue" />
                  <MetricBar label="Avg Sustained" value={metrics?.avgSustained} tone="mint" />
                  <MetricBar label="Avg Marketplace" value={metrics?.avgMarketplace} tone="rose" />
                  <MetricBar label="Avg Quality" value={metrics?.avgQuality} tone="violet" />
                </div>
              </div>
            </div>

            {Array.isArray(result?.warnings) && result.warnings.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  Collection warnings
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                  {result.warnings.slice(0, 6).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-3xl border border-[#e4d8ff] bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-black text-slate-900">Inventory opportunities</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'primary', label: `Primary (${(result?.lanes?.primary || []).length})` },
                    { key: 'experiments', label: `Experiments (${(result?.lanes?.experiments || []).length})` },
                    { key: 'avoid', label: `Avoid (${(result?.lanes?.avoid || []).length})` }
                  ].map((lane) => (
                    <button
                      key={lane.key}
                      type="button"
                      onClick={() => setActiveLane(lane.key)}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                        activeLane === lane.key
                          ? 'bg-violet-700 text-white'
                          : 'bg-violet-50 text-violet-800 hover:bg-violet-100'
                      }`}
                    >
                      {lane.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeItems.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {activeItems.map((item) => (
                    <OpportunityCard key={`${activeLane}-${item.keyword}`} item={item} />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#daccff] bg-[#f8f5ff] p-5 text-sm text-slate-600">
                  No opportunities in this lane for the current backend run.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-[#e4d8ff] bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
                <Globe2 className="h-4 w-4 text-violet-700" />
                Pieces worth copying
              </div>

              {(result?.copyworthyPieces || []).length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {result.copyworthyPieces.map((piece) => (
                    <PieceCard key={`${piece.url}-${piece.title}`} piece={piece} />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#daccff] bg-[#f8f5ff] p-4 text-sm text-slate-600">
                  No copyworthy pieces returned for this run.
                </div>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-3xl border border-[#e4d8ff] bg-white p-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-900">
                  <TrendingUp className="h-4 w-4 text-violet-700" />
                  Action plan
                </div>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
                  {(result?.actionPlan || []).map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>

              <div className="rounded-3xl border border-[#e4d8ff] bg-white p-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-900">
                  <Lightbulb className="h-4 w-4 text-violet-700" />
                  Sourcing checklist
                </div>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                  {(result?.sourcingChecklist || []).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
