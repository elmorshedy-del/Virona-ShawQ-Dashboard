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
  precision: { label: 'Precision', maxCandidates: 8, maxMetaChecks: 4 },
  balanced: { label: 'Balanced', maxCandidates: 12, maxMetaChecks: 6 },
  scout: { label: 'Scout Wide', maxCandidates: 18, maxMetaChecks: 8 }
};

const STORE_PLAYBOOKS = {
  shawq: {
    include: ['palestinian', 'tatreez', 'keffiyeh', 'embroidered', 'hoodie', 'skirt', 'apparel', 'heritage'],
    exclude: ['ring', 'bracelet', 'necklace', 'earring', 'supplement', 'gadget'],
    edge: 'Cultural apparel with premium finishing and storytelling.'
  },
  vironax: {
    include: ['ring', 'bracelet', 'necklace', 'jewelry', 'stainless', 'chain', 'men'],
    exclude: ['skirt', 'hoodie', 'dress', 'apparel'],
    edge: 'Durable men jewelry with clean modern styling.'
  },
  default: {
    include: [],
    exclude: [],
    edge: 'Brand-fit scoring based on keyword relevance.'
  }
};

const FLOW_STEPS = [
  { id: 'store', title: 'Store Lens', blurb: 'Score every idea against your catalog direction.' },
  { id: 'trend', title: 'Sustained Trend', blurb: 'Use momentum + consistency, not one-week spikes.' },
  { id: 'market', title: 'Market Reality', blurb: 'Check live ad density and active competitor pressure.' },
  { id: 'decision', title: 'Decision Memo', blurb: 'Output GO/TEST/HOLD with operational next moves.' }
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

function OpportunityCard({ item, laneLabel }) {
  const reasons = Array.isArray(item?.reasons) ? item.reasons.slice(0, 2) : [];
  const trendsUrl = item?.links?.trends || null;
  const metaUrl = item?.links?.metaAdLibrary || null;

  return (
    <div className="rounded-2xl border border-[#e5def8] bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-900">{item?.keyword || 'Untitled concept'}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700">{laneLabel}</div>
        </div>
        <div className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-800">
          Overall {Math.round(toNumber(item?.scores?.overall))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <ResultChip label="Demand" value={item?.scores?.demand} tone="good" />
        <ResultChip label="Momentum" value={item?.scores?.momentum} tone="good" />
        <ResultChip label="Store Fit" value={item?.storeFit} tone="neutral" />
        <ResultChip label="Quality" value={item?.qualityEdge} tone="neutral" />
        <ResultChip label="Risk" value={item?.scores?.risk} tone="bad" />
      </div>

      {reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
          {reasons.map((reason) => (
            <li key={`${item?.keyword}-${reason}`}>{reason}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {trendsUrl && (
          <a
            href={trendsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-[#d7cdf9] bg-[#f5f1ff] px-2.5 py-1.5 text-xs font-bold text-violet-800 hover:bg-[#eee6ff]"
          >
            Trends
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {metaUrl && (
          <a
            href={metaUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-[#cedcfd] bg-[#edf4ff] px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-[#e5efff]"
          >
            Meta Library
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function PieceCard({ piece }) {
  return (
    <div className="rounded-2xl border border-[#e3ddfa] bg-white p-4 shadow-sm">
      <div className="text-sm font-bold text-slate-900">{piece.pageName || 'Live market creative'}</div>
      <div className="mt-1 text-xs text-slate-500">Angle: {piece.keyword}</div>
      {piece.snippet && <p className="mt-2 text-xs leading-5 text-slate-600">{piece.snippet}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-violet-800">
          Overall {Math.round(toNumber(piece.overall))}
        </span>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-800">
          Competition {Math.round(toNumber(piece.competition))}
        </span>
      </div>
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

function getStorePlaybook(store) {
  const id = String(store?.id || '').toLowerCase();
  return STORE_PLAYBOOKS[id] || STORE_PLAYBOOKS.default;
}

function scoreStoreFit(keyword, store) {
  const playbook = getStorePlaybook(store);
  const text = String(keyword || '').toLowerCase();
  if (!text) return 40;

  const includeHits = playbook.include.reduce((sum, token) => (text.includes(token) ? sum + 1 : sum), 0);
  const excludeHits = playbook.exclude.reduce((sum, token) => (text.includes(token) ? sum + 1 : sum), 0);

  const includeBase = playbook.include.length ? (includeHits / playbook.include.length) * 100 : 55;
  const penalty = excludeHits * 24;
  return Math.round(clamp(5, includeBase - penalty + 30, 100));
}

function formatDate(dateString) {
  if (!dateString) return 'Unknown start';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'Unknown start';
  return date.toLocaleDateString();
}

export default function ProductFinderPremium({ store }) {
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);

  const [query, setQuery] = useState('');
  const [timeframeDays, setTimeframeDays] = useState(90);
  const [breadthKey, setBreadthKey] = useState('balanced');
  const [includeMetaAds, setIncludeMetaAds] = useState(true);
  const [metaCountry, setMetaCountry] = useState('ALL');
  const [useAiModels, setUseAiModels] = useState(true);
  const [includeGeoSpread, setIncludeGeoSpread] = useState(true);
  const [qualityBias, setQualityBias] = useState(true);

  const [activeLane, setActiveLane] = useState('primary');
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
          setHealthError(err?.message || 'Unable to load source health');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const breadth = BREADTH_OPTIONS[breadthKey] || BREADTH_OPTIONS.balanced;
  const sourceStatus = health?.sources || {};

  const enriched = useMemo(() => {
    const recommendations = agentData?.recommendations || { primary: [], experiments: [], avoidNow: [] };

    const decorate = (items = [], lane) =>
      (Array.isArray(items) ? items : []).map((item) => {
        const storeFit = scoreStoreFit(item?.keyword, store);
        const confidence = toNumber(item?.scores?.confidence, 35);
        const risk = toNumber(item?.scores?.risk, 60);
        const competition = toNumber(item?.scores?.competition, 55);
        const qualityEdge = Math.round(clamp(0, 0.45 * confidence + 0.35 * (100 - risk) + 0.2 * (100 - competition), 100));
        return {
          ...item,
          lane,
          storeFit,
          qualityEdge
        };
      });

    return {
      primary: decorate(recommendations.primary, 'primary'),
      experiments: decorate(recommendations.experiments, 'experiments'),
      avoidNow: decorate(recommendations.avoidNow, 'avoidNow')
    };
  }, [agentData, store]);

  const filtered = useMemo(() => {
    if (!qualityBias) return enriched;

    const keepQuality = (item) =>
      toNumber(item?.qualityEdge) >= 52 &&
      toNumber(item?.scores?.risk, 100) <= 76 &&
      toNumber(item?.scores?.demand) >= 40;

    return {
      primary: enriched.primary.filter(keepQuality),
      experiments: enriched.experiments.filter(keepQuality),
      avoidNow: enriched.avoidNow
    };
  }, [enriched, qualityBias]);

  const activeLaneItems = useMemo(() => {
    if (activeLane === 'experiments') return filtered.experiments;
    if (activeLane === 'avoidNow') return filtered.avoidNow;
    return filtered.primary;
  }, [activeLane, filtered]);

  const topPick = useMemo(() => {
    const all = [...filtered.primary, ...filtered.experiments, ...filtered.avoidNow];
    return all.sort((a, b) => toNumber(b?.scores?.overall) - toNumber(a?.scores?.overall))[0] || null;
  }, [filtered]);

  const copyworthyPieces = useMemo(() => {
    const scanResults = Array.isArray(agentData?.scan?.results) ? [...agentData.scan.results] : [];
    scanResults.sort((a, b) => toNumber(b?.scores?.overall) - toNumber(a?.scores?.overall));

    const out = [];
    const seen = new Set();

    for (const item of scanResults) {
      const sample = Array.isArray(item?.evidence?.competition?.sample) ? item.evidence.competition.sample : [];
      for (const ad of sample) {
        const url = ad?.snapshot_url || null;
        if (!url || seen.has(url)) continue;
        seen.add(url);

        const snippetRaw = String(ad?.ad_copy || '').trim();
        const snippet = snippetRaw ? `${snippetRaw.slice(0, 140)}${snippetRaw.length > 140 ? '...' : ''}` : '';

        out.push({
          url,
          keyword: item?.keyword || '',
          pageName: ad?.page_name || '',
          snippet,
          overall: item?.scores?.overall,
          competition: item?.scores?.competition,
          startedAt: formatDate(ad?.start_date)
        });

        if (out.length >= 6) return out;
      }
    }

    return out;
  }, [agentData]);

  const sustainedTrendScore = useMemo(() => {
    if (!agentData) return 0;

    const scanResults = Array.isArray(agentData?.scan?.results) ? agentData.scan.results.slice(0, 5) : [];
    if (!scanResults.length) return 0;

    const values = scanResults.map((item) => {
      const momentum = toNumber(item?.scores?.momentum, 45);
      const confidence = toNumber(item?.scores?.confidence, 35);
      const forecast = toNumber(item?.evidence?.momentum?.forecast?.pctChangeFromLast, 0);
      const anomalyPenalty = item?.evidence?.momentum?.anomaly?.isAnomaly ? 10 : 0;
      const forecastBoost = forecast > 0 ? clamp(0, forecast / 2, 14) : clamp(-14, forecast / 2, 0);
      return clamp(0, 0.6 * momentum + 0.3 * confidence + 0.1 * (50 + forecastBoost) - anomalyPenalty, 100);
    });

    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }, [agentData]);

  const consultation = useMemo(() => {
    if (!agentData) return null;

    const bestOverall = toNumber(topPick?.scores?.overall, toNumber(agentData?.insight?.topOverall, 0));
    const storeFit = toNumber(topPick?.storeFit, 50);
    const avgQuality = (() => {
      const all = [...filtered.primary, ...filtered.experiments];
      if (!all.length) return 45;
      return all.reduce((sum, item) => sum + toNumber(item?.qualityEdge, 40), 0) / all.length;
    })();

    const marketHeat = clamp(0, 0.6 * toNumber(agentData?.insight?.averageDemand, 40) + 0.4 * toNumber(bestOverall, 40), 100);
    const readiness = Math.round(clamp(0, 0.3 * bestOverall + 0.25 * sustainedTrendScore + 0.25 * storeFit + 0.2 * avgQuality, 100));

    const decision = readiness >= 72 ? 'GO' : readiness >= 58 ? 'TEST' : 'HOLD';
    const confidenceRaw = toNumber(topPick?.scores?.confidence, 35);
    const confidenceLabel = confidenceRaw >= 70 ? 'High' : confidenceRaw >= 45 ? 'Medium' : 'Low';

    const baseline = readiness / 100;
    const lowPerDay = decision === 'HOLD'
      ? 0.2
      : Number(Math.max(0.6, (baseline * 2.6)).toFixed(1));
    const highPerDay = decision === 'HOLD'
      ? 1.1
      : Number(Math.max(lowPerDay + 0.8, (baseline * 6.0)).toFixed(1));

    const summary = [
      `${store?.name || 'Store'} fit is ${storeFit >= 70 ? 'strong' : storeFit >= 50 ? 'moderate' : 'weak'} for the top concept.`,
      `Trend sustainability score is ${sustainedTrendScore}/100 from momentum consistency and anomaly checks.`,
      `Market heat is ${Math.round(marketHeat)}/100 based on demand depth and live competition signals.`
    ];

    return {
      decision,
      confidenceLabel,
      confidenceRaw,
      lowPerDay,
      highPerDay,
      readiness,
      storeFit,
      qualityEdge: Math.round(avgQuality),
      marketHeat: Math.round(marketHeat),
      summary
    };
  }, [agentData, filtered, topPick, sustainedTrendScore, store]);

  const buildPayload = (q) => ({
    query: q,
    timeframeDays,
    maxCandidates: breadth.maxCandidates,
    maxMetaChecks: breadth.maxMetaChecks,
    includeMetaAds,
    metaCountry,
    metaLimit: 25,
    useAiModels,
    includeGeoSpread,
    storeId: store?.id || null,
    storeName: store?.name || null,
    storeTagline: store?.tagline || null,
    qualityBias
  });

  const runConsultation = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await postJson(`${API_BASE}/product-radar/agent`, buildPayload(trimmed));
      setAgentData(res?.data || null);
      setActiveLane('primary');
    } catch (err) {
      setAgentData(null);
      setError(err?.message || 'Consultation failed');
    } finally {
      setLoading(false);
    }
  };

  const clearResult = () => {
    setAgentData(null);
    setError(null);
  };

  const playbook = getStorePlaybook(store);

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
                Built only for your flow: store-aware direction, sustained trend validation, market reality checks,
                and concrete pieces worth copying with direct links.
              </p>
            </div>

            <div className="min-w-[250px] rounded-2xl border border-[#dfd4ff] bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Store className="h-4 w-4 text-violet-700" />
                Store Lens
              </div>
              <div className="mt-2 text-sm font-semibold text-violet-800">{store?.name || 'Store'}: {store?.tagline || 'No tagline'}</div>
              <div className="mt-2 text-xs leading-5 text-slate-600">{playbook.edge}</div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {FLOW_STEPS.map((step, idx) => (
              <div
                key={step.id}
                className="group rounded-2xl border border-[#e6dcff] bg-white p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md"
              >
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
                Meta country
                <select
                  value={metaCountry}
                  onChange={(e) => setMetaCountry(e.target.value)}
                  disabled={!includeMetaAds}
                  className="mt-1.5 block w-full rounded-xl border border-[#d9d0ff] bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
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
                <input type="checkbox" checked={includeMetaAds} onChange={(e) => setIncludeMetaAds(e.target.checked)} />
                Market reality checks
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-[#dad0ff] bg-[#f8f5ff] px-3 py-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={useAiModels} onChange={(e) => setUseAiModels(e.target.checked)} />
                Sustained trend AI
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-[#dad0ff] bg-[#f8f5ff] px-3 py-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={includeGeoSpread} onChange={(e) => setIncludeGeoSpread(e.target.checked)} />
                Geo spread
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-[#dad0ff] bg-[#f8f5ff] px-3 py-2 text-xs font-bold text-slate-700">
                <input type="checkbox" checked={qualityBias} onChange={(e) => setQualityBias(e.target.checked)} />
                Quality-first filter
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
                label="AI models"
                on={!!sourceStatus?.aiModels?.available}
                onText="Connected"
                offText="Limited"
              />
              <SourceStatus
                label="Meta Ad Library"
                on={!!sourceStatus?.metaAdLibrary?.configured}
                onText="Connected"
                offText="Not connected"
              />
            </div>

            <div className="mt-4 rounded-2xl border border-[#e5def8] bg-[#f8f5ff] p-3 text-xs leading-5 text-slate-600">
              This tab runs your flow only: store fit, sustained demand, quality filter, and direct live-piece links.
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!agentData && !loading && (
          <div className="mt-6 rounded-3xl border border-dashed border-[#daccff] bg-white/70 p-10 text-center">
            <Target className="mx-auto h-8 w-8 text-violet-500" />
            <h3 className="mt-3 text-xl font-bold text-slate-900">Ready for a store-aware decision memo</h3>
            <p className="mt-2 text-sm text-slate-600">
              Submit one product concept and this page will return ranked opportunities, live evidence links, and a practical inventory direction.
            </p>
          </div>
        )}

        {agentData && consultation && (
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
                      Confidence: {consultation.confidenceLabel} ({Math.round(consultation.confidenceRaw)})
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#d7cbff] bg-[#f5f0ff] px-4 py-3 text-sm font-bold text-violet-900">
                    {consultation.lowPerDay} - {consultation.highPerDay} pieces/day
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-700">
                  {consultation.summary.map((line) => (
                    <div key={line} className="flex items-start gap-2">
                      <BadgeCheck className="mt-0.5 h-4 w-4 text-violet-600" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-[#e3d9ff] bg-white p-5 shadow-sm">
                <div className="text-xs font-black uppercase tracking-[0.12em] text-violet-700">Signal board</div>
                <div className="mt-3 space-y-3">
                  <MetricBar label="Readiness" value={consultation.readiness} tone="violet" />
                  <MetricBar label="Store Fit" value={consultation.storeFit} tone="blue" />
                  <MetricBar label="Sustained Trend" value={sustainedTrendScore} tone="mint" />
                  <MetricBar label="Market Heat" value={consultation.marketHeat} tone="rose" />
                  <MetricBar label="Quality Edge" value={consultation.qualityEdge} tone="violet" />
                </div>
              </div>
            </div>

            {Array.isArray(agentData?.warnings) && agentData.warnings.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-900">
                  <AlertTriangle className="h-4 w-4" />
                  Evidence warnings
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                  {agentData.warnings.slice(0, 4).map((warning) => (
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
                    { key: 'primary', label: `Primary (${filtered.primary.length})` },
                    { key: 'experiments', label: `Experiments (${filtered.experiments.length})` },
                    { key: 'avoidNow', label: `Avoid (${filtered.avoidNow.length})` }
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

              {activeLaneItems.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {activeLaneItems.map((item) => (
                    <OpportunityCard
                      key={`${activeLane}-${item?.keyword}`}
                      item={item}
                      laneLabel={activeLane === 'primary' ? 'Priority' : activeLane === 'experiments' ? 'Test Queue' : 'Avoid'}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#daccff] bg-[#f8f5ff] p-5 text-sm text-slate-600">
                  No opportunities matched this lane with the current quality filter.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-[#e4d8ff] bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
                <Globe2 className="h-4 w-4 text-violet-700" />
                Pieces worth copying right now
              </div>

              {copyworthyPieces.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {copyworthyPieces.map((piece) => (
                    <PieceCard key={piece.url} piece={piece} />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#daccff] bg-[#f8f5ff] p-4 text-sm text-slate-600">
                  No live piece links yet. Enable market reality checks and rerun to capture live ad snapshot links.
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
                  {(agentData?.actionPlan || []).map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>

              <div className="rounded-3xl border border-[#e4d8ff] bg-white p-5 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-900">
                  <Lightbulb className="h-4 w-4 text-violet-700" />
                  Sourcing + launch checklist
                </div>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                  {(agentData?.sourcingChecklist || []).map((line) => (
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
