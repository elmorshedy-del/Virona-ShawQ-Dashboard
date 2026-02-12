import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  ExternalLink,
  FlaskConical,
  Globe2,
  Link as LinkIcon,
  Loader2,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  XCircle
} from 'lucide-react';

const API_BASE = '/api';

const QUICK_IDEAS = [
  'palestinian hoodie',
  'tatreez long sleeve',
  'olive branch embroidered skirt',
  'keffiyeh streetwear hoodie',
  'palestine wall art framed'
];

const RADAR_SCAN_DEFAULTS = {
  maxMetaChecks: 6,
  metaLimit: 25
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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

function SourceDot({ on }) {
  return (
    <span
      className={`inline-flex h-2.5 w-2.5 rounded-full ${
        on ? 'bg-emerald-500' : 'bg-amber-500'
      }`}
    />
  );
}

function ScoreChip({ label, value, tone = 'neutral' }) {
  const rounded = Number.isFinite(Number(value)) ? Math.round(Number(value)) : '-';
  const toneClasses =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : tone === 'bad'
          ? 'bg-rose-50 text-rose-800 border-rose-200'
          : 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses}`}>
      <span>{label}</span>
      <span>{rounded}</span>
    </span>
  );
}

function CandidateCard({ item }) {
  const overall = toNumber(item?.scores?.overall, null);
  const demand = toNumber(item?.scores?.demand, null);
  const momentum = toNumber(item?.scores?.momentum, null);
  const risk = toNumber(item?.scores?.risk, null);
  const competition = toNumber(item?.scores?.competition, null);
  const confidence = toNumber(item?.scores?.confidence, null);
  const reasons = Array.isArray(item?.reasons) ? item.reasons : [];
  const trendsUrl = item?.links?.trends || null;
  const metaUrl = item?.links?.metaAdLibrary || null;

  return (
    <div className="group rounded-2xl border border-[#e6e2d6] bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{item?.keyword || 'Untitled angle'}</div>
          <div className="mt-1 text-xs text-slate-500">
            Overall {Number.isFinite(overall) ? Math.round(overall) : '-'} / 100
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <ScoreChip label="Demand" value={demand} tone="good" />
        <ScoreChip label="Momentum" value={momentum} tone="good" />
        <ScoreChip label="Competition" value={competition} tone="warn" />
        <ScoreChip label="Risk" value={risk} tone="bad" />
        <ScoreChip label="Confidence" value={confidence} tone="neutral" />
      </div>

      {reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
          {reasons.slice(0, 2).map((line) => (
            <li key={`${item?.keyword}-${line}`}>{line}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {trendsUrl && (
          <a
            href={trendsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-[#d7e4f8] bg-[#eef5ff] px-2.5 py-1.5 text-xs font-semibold text-[#1d4f91] hover:bg-[#e3eefb]"
          >
            Trends <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {metaUrl && (
          <a
            href={metaUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-[#e3e0f8] bg-[#f3f2ff] px-2.5 py-1.5 text-xs font-semibold text-[#5242a6] hover:bg-[#eceaff]"
          >
            Meta Ads <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function ProductFinderPremium({ store }) {
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [query, setQuery] = useState('');
  const [timeframeDays, setTimeframeDays] = useState(90);
  const [maxCandidates, setMaxCandidates] = useState(12);
  const [includeMetaAds, setIncludeMetaAds] = useState(true);
  const [metaCountry, setMetaCountry] = useState('ALL');
  const [useAiModels, setUseAiModels] = useState(true);
  const [includeGeoSpread, setIncludeGeoSpread] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [agentData, setAgentData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getJson(`${API_BASE}/product-radar/health`);
        if (!cancelled) {
          setHealth(res);
          setHealthError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setHealth(null);
          setHealthError(err?.message || 'Could not load source health');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const consultation = useMemo(() => {
    if (!agentData?.insight) return null;
    const top = toNumber(agentData.insight.topOverall);
    const avgDemand = toNumber(agentData.insight.averageDemand);
    const avgMomentum = toNumber(agentData.insight.averageMomentum);

    const all = [
      ...(agentData?.recommendations?.primary || []),
      ...(agentData?.recommendations?.experiments || [])
    ];
    const avgConfidence = all.length
      ? all.reduce((sum, item) => sum + toNumber(item?.scores?.confidence), 0) / all.length
      : 35;

    const strength = (top * 0.45 + avgDemand * 0.3 + avgMomentum * 0.25) / 100;
    const lowPerDay = Math.max(0.2, Number((strength * 1.8).toFixed(1)));
    const highPerDay = Math.max(lowPerDay + 0.4, Number((strength * 4.5).toFixed(1)));

    const decision =
      top >= 72 && avgMomentum >= 55 ? 'GO' : top >= 55 ? 'TEST SMALL BATCH' : 'HOLD';
    const confidenceLabel =
      avgConfidence >= 70 ? 'High' : avgConfidence >= 45 ? 'Medium' : 'Low';

    return {
      decision,
      confidenceLabel,
      lowPerDay,
      highPerDay
    };
  }, [agentData]);

  const sourceStatus = health?.sources || {};
  const recommendations = agentData?.recommendations || {
    primary: [],
    experiments: [],
    avoidNow: []
  };
  const topResults = Array.isArray(agentData?.scan?.results) ? agentData.scan.results.slice(0, 6) : [];

  const buildPayload = (q) => ({
    query: q,
    timeframeDays,
    maxCandidates,
    maxMetaChecks: RADAR_SCAN_DEFAULTS.maxMetaChecks,
    includeMetaAds,
    metaCountry,
    metaLimit: RADAR_SCAN_DEFAULTS.metaLimit,
    useAiModels,
    includeGeoSpread
  });

  const runAgent = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const res = await postJson(`${API_BASE}/product-radar/agent`, buildPayload(trimmed));
      setAgentData(res?.data || null);
    } catch (err) {
      setAgentData(null);
      setError(err?.message || 'Product Finder request failed');
    } finally {
      setLoading(false);
    }
  };

  const storeName = store?.name || 'Store';

  return (
    <div className="rounded-[30px] border border-[#ece6d8] bg-[#fcfaf4] p-6 text-slate-900 shadow-[0_30px_80px_-45px_rgba(15,23,42,0.55)] md:p-8">
      <div className="relative overflow-hidden rounded-[26px] border border-[#e8e2d6] bg-gradient-to-br from-[#fffdf8] via-[#f9f6ee] to-[#f2f5ff] p-6 md:p-8">
        <div className="pointer-events-none absolute -right-16 -top-14 h-56 w-56 rounded-full bg-[#fcd9a7]/35 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-56 w-56 rounded-full bg-[#bce0ff]/30 blur-3xl" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#dbe7f7] bg-[#eef6ff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#2a5f96]">
            <Compass className="h-3.5 w-3.5" />
            Product Finder
          </div>
          <h2
            className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl"
            style={{ fontFamily: 'Sora, Manrope, Poppins, sans-serif' }}
          >
            Premium product consultation
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
            Built as a standalone discovery surface for {storeName}. Enter a product concept and get
            ranked opportunities, evidence links, and an operational launch consultation.
          </p>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[#dce8d9] bg-white/90 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Evidence first</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">Demand + momentum + competition</div>
            </div>
            <div className="rounded-xl border border-[#d9e3f0] bg-white/90 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Store aware</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">Optimized for niche brand decisions</div>
            </div>
            <div className="rounded-xl border border-[#e8dfd2] bg-white/90 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Actionable</div>
              <div className="mt-2 text-sm font-semibold text-slate-900">GO / TEST / HOLD + pieces/day range</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-[#e8e2d7] bg-white p-5 md:p-6">
        <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Concept</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. olive three-branch embroidered palestinian skirt'
                className="w-full rounded-xl border border-[#d9d3c5] bg-[#fffdf8] py-3 pl-10 pr-3 text-sm text-slate-900 shadow-sm focus:border-[#70a8dc] focus:outline-none focus:ring-2 focus:ring-[#9ac3e9]/35"
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => setQuery(idea)}
                  className="rounded-full border border-[#d5dceb] bg-[#f4f8ff] px-3 py-1.5 text-xs font-semibold text-[#2d5c90] transition-colors hover:bg-[#e9f1ff]"
                >
                  {idea}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#ede7db] bg-[#fdfbf6] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Source health
            </div>
            {healthError && (
              <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {healthError}
              </div>
            )}
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Google Trends</span>
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <SourceDot on={!!sourceStatus?.googleTrends?.configured} />
                  {sourceStatus?.googleTrends?.configured ? 'On' : 'Off'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">AI models</span>
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <SourceDot on={!!sourceStatus?.aiModels?.available} />
                  {sourceStatus?.aiModels?.available ? 'Connected' : 'Limited'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Meta ad library</span>
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <SourceDot on={!!sourceStatus?.metaAdLibrary?.configured} />
                  {sourceStatus?.metaAdLibrary?.configured ? 'Connected' : 'Not connected'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            Timeframe
            <select
              value={timeframeDays}
              onChange={(e) => setTimeframeDays(Number(e.target.value))}
              className="mt-1.5 block w-full rounded-lg border border-[#d8d2c3] bg-white px-2.5 py-2 text-sm font-medium text-slate-700"
            >
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>12 months</option>
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            Breadth
            <select
              value={maxCandidates}
              onChange={(e) => setMaxCandidates(Number(e.target.value))}
              className="mt-1.5 block w-full rounded-lg border border-[#d8d2c3] bg-white px-2.5 py-2 text-sm font-medium text-slate-700"
            >
              <option value={8}>Focused</option>
              <option value={12}>Balanced</option>
              <option value={18}>Wide</option>
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
            Meta country
            <select
              value={metaCountry}
              onChange={(e) => setMetaCountry(e.target.value)}
              disabled={!includeMetaAds}
              className="mt-1.5 block w-full rounded-lg border border-[#d8d2c3] bg-white px-2.5 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
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

          <label className="inline-flex items-center gap-2 rounded-lg border border-[#d8d2c3] bg-[#f9f7f0] px-3 py-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={includeMetaAds}
              onChange={(e) => setIncludeMetaAds(e.target.checked)}
            />
            Include Meta ads
          </label>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-lg border border-[#d8d2c3] bg-[#f9f7f0] px-3 py-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={useAiModels}
                onChange={(e) => setUseAiModels(e.target.checked)}
              />
              AI models
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-[#d8d2c3] bg-[#f9f7f0] px-3 py-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={includeGeoSpread}
                onChange={(e) => setIncludeGeoSpread(e.target.checked)}
              />
              Geo spread
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runAgent}
            disabled={loading || !query.trim()}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-md transition-all ${
              loading || !query.trim()
                ? 'cursor-not-allowed bg-slate-400'
                : 'bg-gradient-to-r from-[#0f766e] to-[#1d4ed8] hover:from-[#0e6b64] hover:to-[#1a43ba]'
            }`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {loading ? 'Running consultation...' : 'Run Product Finder'}
          </button>
          <button
            type="button"
            onClick={() => {
              setAgentData(null);
              setError(null);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-[#d5cfbf] bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <LinkIcon className="h-4 w-4" />
            Clear result
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {!agentData && !loading && (
        <div className="mt-6 rounded-2xl border border-dashed border-[#d9d2c3] bg-[#fbf9f4] p-8 text-center">
          <Radar className="mx-auto h-8 w-8 text-slate-400" />
          <h3 className="mt-3 text-lg font-semibold text-slate-800">Ready for a premium product readout</h3>
          <p className="mt-2 text-sm text-slate-600">
            Run a concept to get ranked opportunities, direct evidence links, and an operator-focused launch recommendation.
          </p>
        </div>
      )}

      {agentData && (
        <div className="mt-6 space-y-5">
          <div className="grid gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-[#e8e0d1] bg-white p-4 lg:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Consultation</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#d5e7d7] bg-[#eef9ef] px-3 py-1 text-xs font-bold text-emerald-800">
                  Decision: {consultation?.decision || 'TEST'}
                </span>
                <span className="rounded-full border border-[#dce3f0] bg-[#f1f5fb] px-3 py-1 text-xs font-bold text-slate-700">
                  Confidence: {consultation?.confidenceLabel || 'Medium'}
                </span>
              </div>
              <div className="mt-3 text-sm text-slate-700">
                Suggested sales pace: <span className="font-bold text-slate-900">
                  {consultation ? `${consultation.lowPerDay} - ${consultation.highPerDay} pieces/day` : 'n/a'}
                </span>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Directional estimate from demand, momentum, competition and confidence signals.
              </div>
            </div>

            <div className="rounded-2xl border border-[#e8e0d1] bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Top overall</div>
              <div className="mt-2 text-3xl font-black text-slate-900">{Math.round(toNumber(agentData?.insight?.topOverall))}</div>
              <div className="mt-1 text-xs text-slate-500">Best candidate score</div>
            </div>

            <div className="rounded-2xl border border-[#e8e0d1] bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Signal mix</div>
              <div className="mt-2 space-y-1 text-xs text-slate-700">
                <div className="flex items-center justify-between"><span>Demand</span><span className="font-bold">{Math.round(toNumber(agentData?.insight?.averageDemand))}</span></div>
                <div className="flex items-center justify-between"><span>Momentum</span><span className="font-bold">{Math.round(toNumber(agentData?.insight?.averageMomentum))}</span></div>
                <div className="flex items-center justify-between"><span>Candidates</span><span className="font-bold">{Math.round(toNumber(agentData?.insight?.totalCandidates))}</span></div>
              </div>
            </div>
          </div>

          {Array.isArray(agentData?.warnings) && agentData.warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                Heads up
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                {agentData.warnings.slice(0, 4).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-[#dde9dd] bg-[#f7fcf7] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-900">
                <CheckCircle2 className="h-4 w-4" />
                Primary picks
              </div>
              <div className="space-y-3">
                {recommendations.primary.length > 0 ? recommendations.primary.map((item) => (
                  <CandidateCard key={`primary-${item.keyword}`} item={item} />
                )) : <div className="text-sm text-slate-500">No primary pick yet.</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-[#dde6f0] bg-[#f7faff] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-[#1d4f91]">
                <FlaskConical className="h-4 w-4" />
                Experiment queue
              </div>
              <div className="space-y-3">
                {recommendations.experiments.length > 0 ? recommendations.experiments.map((item) => (
                  <CandidateCard key={`exp-${item.keyword}`} item={item} />
                )) : <div className="text-sm text-slate-500">No experiment queue.</div>}
              </div>
            </div>

            <div className="rounded-2xl border border-[#f1dede] bg-[#fff8f8] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-rose-900">
                <XCircle className="h-4 w-4" />
                Avoid now
              </div>
              <div className="space-y-3">
                {recommendations.avoidNow.length > 0 ? recommendations.avoidNow.map((item) => (
                  <CandidateCard key={`avoid-${item.keyword}`} item={item} />
                )) : <div className="text-sm text-slate-500">No avoid-now flags right now.</div>}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-[#e7e2d6] bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                <TrendingUp className="h-4 w-4 text-emerald-700" />
                Action plan
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
                {(agentData?.actionPlan || []).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl border border-[#e7e2d6] bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-900">
                <Globe2 className="h-4 w-4 text-[#2e6fa8]" />
                Sourcing checklist
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {(agentData?.sourcingChecklist || []).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>

          {topResults.length > 0 && (
            <div className="rounded-2xl border border-[#e7e2d6] bg-white p-4">
              <div className="mb-3 text-sm font-bold text-slate-900">Radar evidence snapshots</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {topResults.map((item) => (
                  <div key={item.id} className="rounded-xl border border-[#ebe7db] bg-[#fffdf9] p-3">
                    <div className="text-sm font-semibold text-slate-900">{item.keyword}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ScoreChip label="Overall" value={item?.scores?.overall} tone="neutral" />
                      <ScoreChip label="Demand" value={item?.scores?.demand} tone="good" />
                      <ScoreChip label="Momentum" value={item?.scores?.momentum} tone="good" />
                    </div>
                    {item?.evidence?.demand?.url && (
                      <a
                        href={item.evidence.demand.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#1d4f91] hover:text-[#163d70]"
                      >
                        Open trends evidence <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
