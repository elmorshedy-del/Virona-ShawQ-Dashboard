import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck,
  Radar,
  Search,
  ExternalLink,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const API_BASE = '/api';

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
    const err = new Error(message);
    err.status = res.status;
    err.payload = json;
    throw err;
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
    const err = new Error(json?.message || `Request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
};

const shortModelName = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split('/');
  return parts[parts.length - 1] || raw;
};

function ScorePill({ label, value, intent = 'neutral' }) {
  const v = Number.isFinite(value) ? Math.round(value) : null;
  const color =
    intent === 'good'
      ? 'bg-emerald-500/15 text-emerald-200 border-emerald-400/25'
      : intent === 'bad'
        ? 'bg-rose-500/15 text-rose-200 border-rose-400/25'
        : 'bg-white/5 text-slate-200 border-white/10';

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold ${color}`}>
      <span className="opacity-80">{label}</span>
      <span className="font-bold">{v == null ? '—' : v}</span>
    </div>
  );
}

function Sparkline({ series }) {
  const values = useMemo(() => {
    if (!Array.isArray(series)) return [];
    return series
      .map((p) => Number(p?.v))
      .filter((v) => Number.isFinite(v));
  }, [series]);

  if (values.length < 2) return null;

  const w = 140;
  const h = 36;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  const points = values
    .map((v, idx) => {
      const x = (idx / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <polyline
        fill="none"
        stroke="#22d3ee"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}

function SourceRow({ name, status, detail }) {
  const dot =
    status === 'on'
      ? 'bg-emerald-500'
      : status === 'warn'
        ? 'bg-amber-500'
        : 'bg-gray-300';

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        <span className="text-sm font-medium text-slate-100">{name}</span>
      </div>
      <div className="text-xs text-slate-400 text-right">{detail}</div>
    </div>
  );
}

export default function ProductRadar() {
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
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getJson(`${API_BASE}/product-radar/health`);
        if (!cancelled) {
          setHealth(res);
          setHealthError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setHealth(null);
          setHealthError(e?.message || 'Failed to load sources');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const sources = data?.sources || health?.sources || null;

  const ai = sources?.aiModels || null;
  const aiEmbed = ai?.models?.embed?.short || shortModelName(ai?.models?.embed?.name || ai?.models?.embed);
  const aiRerank = ai?.models?.rerank?.short || shortModelName(ai?.models?.rerank?.name || ai?.models?.rerank);
  const aiStatus = ai?.configured ? (ai?.available ? 'on' : 'warn') : (ai ? 'warn' : 'off');
  const aiDetail = ai?.available
    ? `Semantic: ${aiEmbed || 'embeddings'}${aiRerank ? ` + ${aiRerank}` : ''} • PELT + ETS`
    : (ai?.reason || 'Not connected');

  const plannedSources = useMemo(
    () => [
      'Amazon Best Sellers / Movers & Shakers',
      'Noon Best Sellers (UAE/KSA)',
      'TikTok Creative Center',
      'Google Ads Transparency Center',
      'AliExpress / Alibaba (supplier reality)',
      'Etsy / eBay / Walmart (marketplace reality)'
    ],
    []
  );

  const handleScan = async () => {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await postJson(`${API_BASE}/product-radar/scan`, {
        query: q,
        timeframeDays,
        maxCandidates,
        maxMetaChecks: 6,
        includeMetaAds,
        metaCountry,
        metaLimit: 25,
        useAiModels,
        includeGeoSpread
      });

      setData(res?.data || null);
      setOpenId(null);
    } catch (e) {
      setError(e?.message || 'Scan failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-2xl">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-cyan-500/20 blur-[100px]" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-fuchsia-500/15 blur-[110px]" />
        <div className="absolute top-1/2 left-1/2 w-72 h-72 rounded-full bg-indigo-500/10 blur-[120px] -translate-x-1/2 -translate-y-1/2" />
        <div className="relative p-6 md:p-8 space-y-6">
      {/* Explainer / Trust Card */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-6 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Radar className="w-6 h-6 text-cyan-300" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-indigo-300 to-fuchsia-300">Product Radar</h2>
              <p className="text-sm text-slate-300">Find product opportunities to source — with transparent evidence.</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-200">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs font-semibold">Evidence-first (not vibes)</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="text-sm text-slate-200 leading-relaxed">
              Type a niche (example: <span className="font-semibold">gemstone rings</span>). Product Radar expands into adjacent product angles people actually search for, then ranks them using public signals.
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-2 h-2 rounded-full bg-cyan-400" />
                <div>
                  <div className="font-semibold text-slate-100">Demand + geo</div>
                  <div className="text-slate-300">Google Trends (time series + regions).</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-2 h-2 rounded-full bg-cyan-400" />
                <div>
                  <div className="font-semibold text-slate-100">Semantic discovery + forecasting</div>
                  <div className="text-slate-300">BM25 + embeddings (+ change-points + ETS forecast if connected).</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-2 h-2 rounded-full bg-cyan-400" />
                <div>
                  <div className="font-semibold text-slate-100">Competition proxy</div>
                  <div className="text-slate-300">Meta Ad Library sample (how many active ads show up).</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-2 h-2 rounded-full bg-cyan-400" />
                <div>
                  <div className="font-semibold text-slate-100">Transparent scoring</div>
                  <div className="text-slate-300">Every result includes “how we got this”.</div>
                </div>
              </div>

              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-2 h-2 rounded-full bg-cyan-400" />
                <div>
                  <div className="font-semibold text-slate-100">Not a guarantee</div>
                  <div className="text-slate-300">Use it to shortlist what to source + test.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-950/40 rounded-2xl border border-white/10 p-4">
            <div className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-2">Sources</div>

            {healthError && (
              <div className="flex items-center gap-2 text-xs text-rose-200 mb-3">
                <AlertCircle className="w-4 h-4" />
                {healthError}
              </div>
            )}

            <SourceRow
              name="Google Trends"
              status={sources?.googleTrends?.configured ? 'on' : 'off'}
              detail="Demand + momentum + geo"
            />
            <div className="border-t border-white/10" />
            <SourceRow
              name="AI models"
              status={aiStatus}
              detail={aiDetail}
            />
            <div className="border-t border-white/10" />
            <SourceRow
              name="Meta Ad Library (via Apify)"
              status={sources?.metaAdLibrary?.configured ? 'on' : sources?.metaAdLibrary ? 'warn' : 'off'}
              detail={sources?.metaAdLibrary?.configured ? 'Competition proxy' : (sources?.metaAdLibrary?.reason || 'Not connected')}
            />

            <div className="mt-3 text-xs text-slate-400">Planned next:</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-300 list-disc pl-5">
              {plannedSources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Search / Controls */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-6 backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-200 mb-2">Niche / product seed</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. gemstone rings"
                className="w-full pl-10 pr-3 py-3 rounded-xl border border-white/10 bg-slate-950/40 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-300/40"
              />
            </div>
          </div>

          <div className="w-full md:w-48">
            <label className="block text-sm font-medium text-slate-200 mb-2">Timeframe</label>
            <select
              value={timeframeDays}
              onChange={(e) => setTimeframeDays(Number(e.target.value))}
              className="w-full px-3 py-3 rounded-xl border border-white/10 bg-slate-950/40 text-slate-100"
            >
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 12 months</option>
            </select>
          </div>

          <div className="w-full md:w-48">
            <label className="block text-sm font-medium text-slate-200 mb-2">Breadth</label>
            <select
              value={maxCandidates}
              onChange={(e) => setMaxCandidates(Number(e.target.value))}
              className="w-full px-3 py-3 rounded-xl border border-white/10 bg-slate-950/40 text-slate-100"
            >
              <option value={8}>Focused (8 ideas)</option>
              <option value={12}>Balanced (12 ideas)</option>
              <option value={18}>Wide (18 ideas)</option>
            </select>
          </div>

          <div className="w-full md:w-44">
            <label className="block text-sm font-medium text-slate-200 mb-2">Meta ads</label>
            <div className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl border border-white/10 bg-slate-950/40">
              <label className="text-sm text-slate-200 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeMetaAds}
                  onChange={(e) => setIncludeMetaAds(e.target.checked)}
                />
                Include
              </label>
              <select
                value={metaCountry}
                onChange={(e) => setMetaCountry(e.target.value)}
                className="text-sm bg-transparent outline-none text-slate-100"
                disabled={!includeMetaAds}
              >
                <option value="ALL">ALL</option>
                <option value="US">US</option>
                <option value="GB">GB</option>
                <option value="DE">DE</option>
                <option value="FR">FR</option>
                <option value="ES">ES</option>
                <option value="IT">IT</option>
                <option value="AE">AE</option>
                <option value="SA">SA</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleScan}
            disabled={loading || !query.trim()}
            className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors ${
              loading || !query.trim() ? 'bg-white/10 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 hover:from-cyan-400 hover:via-indigo-400 hover:to-fuchsia-400 shadow-lg shadow-cyan-500/10'
            }`}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
            {loading ? 'Scanning…' : 'Run Radar'}
          </button>
        </div>

        <div className="mt-3 text-xs text-slate-400">
          Tip: the more specific the seed query, the more actionable the angles (e.g., “moissanite rings” vs “jewelry”).
        </div>

        <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-sm">
          <label className="text-slate-200 flex items-center gap-2">
            <input
              type="checkbox"
              checked={useAiModels}
              onChange={(e) => setUseAiModels(e.target.checked)}
              disabled={!ai?.available}
            />
            Use AI models
            {!ai?.available && <span className="text-xs text-slate-400">(not connected)</span>}
          </label>

          <label className="text-slate-200 flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeGeoSpread}
              onChange={(e) => setIncludeGeoSpread(e.target.checked)}
            />
            Include geo spread
          </label>
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          <div className="bg-white/5 rounded-2xl border border-white/10 p-5 backdrop-blur-xl">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-sm text-slate-400">Seed</div>
                <div className="text-lg font-bold text-slate-100">{data.query}</div>
                <div className="text-xs text-slate-400">Generated {new Date(data.generatedAt).toLocaleString()}</div>
              </div>
              {data.seedContext?.googleTrendsUrl && (
                <a
                  href={data.seedContext.googleTrendsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                >
                  View seed on Google Trends <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>

            {Array.isArray(data.seedContext?.topCountries) && data.seedContext.topCountries.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.seedContext.topCountries.map((c) => (
                  <span
                    key={`${c.geoCode}-${c.geoName}`}
                    className="px-2 py-1 text-xs rounded-full bg-white/5 border border-white/10 text-slate-200"
                    title={c.geoCode}
                  >
                    {c.geoName} · {Math.round(c.value)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {(data.results || []).map((r) => {
              const isOpen = openId === r.id;
              const demand = r.scores?.demand;
              const momentum = r.scores?.momentum;
              const competition = r.scores?.competition;
              const risk = r.scores?.risk;
              const confidence = r.scores?.confidence;
              const overall = r.scores?.overall;

              return (
                <div key={r.id} className="bg-white/5 rounded-2xl border border-white/10 p-5 backdrop-blur-xl">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-slate-400">Product angle</div>
                          <div className="text-xl font-bold text-slate-100">{r.keyword}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="px-3 py-1 rounded-full bg-gradient-to-r from-cyan-500/20 to-fuchsia-500/20 border border-white/10 text-slate-100 text-xs font-semibold">
                            Overall {overall == null ? '—' : Math.round(overall)}
                          </div>
                          {r.evidence?.demand?.url && (
                            <a
                              href={r.evidence.demand.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                            >
                              Trends <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <ScorePill label="Demand" value={demand} intent="good" />
                        <ScorePill label="Momentum" value={momentum} intent="good" />
                        <ScorePill label="Competition" value={competition} intent={competition == null ? 'neutral' : 'bad'} />
                        <ScorePill label="Risk" value={risk} intent="bad" />
                        <ScorePill label="Confidence" value={confidence} intent="neutral" />
                      </div>

                      {Array.isArray(r.explanation) && r.explanation.length > 0 && (
                        <ul className="mt-3 space-y-1 text-sm text-slate-200 list-disc pl-5">
                          {r.explanation.slice(0, 4).map((line, idx) => (
                            <li key={idx}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="lg:w-48 lg:flex lg:flex-col lg:items-end lg:justify-between">
                      <div className="bg-slate-950/40 border border-white/10 rounded-xl p-3">
                        <div className="text-xs font-semibold text-slate-300 mb-2">Trend sparkline</div>
                        <Sparkline series={r.evidence?.demand?.series} />
                      </div>

                      <button
                        onClick={() => setOpenId(isOpen ? null : r.id)}
                        className="mt-3 lg:mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-slate-100"
                      >
                        {isOpen ? (
                          <>
                            Hide how it was reached <ChevronUp className="w-4 h-4" />
                          </>
                        ) : (
                          <>
                            How it was reached <ChevronDown className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-5 pt-5 border-t border-white/10 grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <div className="bg-slate-950/40 border border-white/10 rounded-xl p-4">
                        <div className="text-sm font-semibold text-slate-100">Demand</div>
                        <div className="text-xs text-slate-300 mt-1">Google Trends · last {data.timeframeDays} days</div>
                        <div className="mt-3 space-y-1 text-sm text-slate-200">
                          <div>Ratio vs seed: <span className="font-semibold">{r.evidence?.demand?.ratioVsSeed ?? '—'}</span>×</div>
                          <div>Demand level score: <span className="font-semibold">{r.evidence?.demand?.demandLevel ?? '—'}</span></div>
                          <div>Geo spread: <span className="font-semibold">{r.evidence?.demand?.geoSpread ?? '—'}</span></div>
                          <div>Recent avg: <span className="font-semibold">{r.evidence?.demand?.recentMean ?? '—'}</span></div>
                          <div>Prev avg: <span className="font-semibold">{r.evidence?.demand?.prevMean ?? '—'}</span></div>
                          <div>Δ: <span className="font-semibold">{r.evidence?.demand?.percentChange ?? '—'}</span>%</div>
                        </div>

                        {Array.isArray(r.evidence?.demand?.geoTopCountries) && r.evidence.demand.geoTopCountries.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {r.evidence.demand.geoTopCountries.slice(0, 6).map((c) => (
                              <span
                                key={`${r.keyword}-${c.geoCode || c.geoName}`}
                                className="px-2 py-1 text-xs rounded-full bg-white/5 border border-white/10 text-slate-200"
                              >
                                {c.geoName} · {Math.round(c.value)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="bg-slate-950/40 border border-white/10 rounded-xl p-4">
                        <div className="text-sm font-semibold text-slate-100">Momentum</div>
                        <div className="text-xs text-slate-300 mt-1">Forecast + change-points (if connected)</div>

                        {r.evidence?.momentum?.ok ? (
                          <div className="mt-3 space-y-1 text-sm text-slate-200">
                            <div>Forecast Δ: <span className="font-semibold">{Number.isFinite(r.evidence?.momentum?.forecast?.pctChangeFromLast) ? Math.round(r.evidence.momentum.forecast.pctChangeFromLast) : '—'}</span>%</div>
                            <div>Change-point: <span className="font-semibold">{r.evidence?.momentum?.changePoint?.recent ? (r.evidence.momentum.changePoint.direction + ' ' + Math.abs(r.evidence.momentum.changePoint.magnitudePct || 0).toFixed(0) + '%') : '—'}</span></div>
                            <div>Anomaly: <span className="font-semibold">{r.evidence?.momentum?.anomaly?.isAnomaly ? 'Yes' : 'No'}</span></div>
                          </div>
                        ) : (
                          <div className="mt-3 text-sm text-slate-300">
                            {ai?.configured ? 'Not available for this result.' : 'Not connected (set PRODUCT_RADAR_AI_URL).'}
                          </div>
                        )}
                      </div>

                      <div className="bg-slate-950/40 border border-white/10 rounded-xl p-4">
                        <div className="text-sm font-semibold text-slate-100">Competition</div>
                        <div className="text-xs text-slate-300 mt-1">Meta Ad Library sample (if connected)</div>

                        {r.evidence?.competition?.configured ? (
                          <div className="mt-3 space-y-1 text-sm text-slate-200">
                            <div>Sample ads: <span className="font-semibold">{r.evidence.competition.sampleSize}</span> (limit {r.evidence.competition.limit})</div>
                            <div>Advertisers: <span className="font-semibold">{r.evidence.competition.uniqueAdvertisers}</span></div>
                            <div>Country: <span className="font-semibold">{r.evidence.competition.country}</span></div>
                            {r.evidence.competition.url && (
                              <a
                                href={r.evidence.competition.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200 mt-2"
                              >
                                Open in Meta Ad Library <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <div className="mt-3 text-sm text-slate-300">
                            {sources?.metaAdLibrary?.configured ? 'Not available for this result.' : 'Not connected (needs APIFY_API_TOKEN).'}
                          </div>
                        )}
                      </div>

                      <div className="bg-slate-950/40 border border-white/10 rounded-xl p-4">
                        <div className="text-sm font-semibold text-slate-100">Risk & confidence</div>
                        <div className="text-xs text-slate-300 mt-1">Transparent heuristics (MVP)</div>

                        <div className="mt-3">
                          {Array.isArray(r.evidence?.risk?.drivers) && r.evidence.risk.drivers.length > 0 ? (
                            <ul className="space-y-1 text-sm text-slate-200 list-disc pl-5">
                              {r.evidence.risk.drivers.map((d) => (
                                <li key={d}>{d}</li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-sm text-slate-300">No risk flags detected from keywords.</div>
                          )}

                          <div className="mt-3 text-sm text-slate-200">
                            Confidence score: <span className="font-semibold">{confidence ?? '—'}</span>
                            <div className="text-xs text-slate-400 mt-1">Higher means the trend series has more consistent non-zero signal.</div>
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-3 text-xs text-slate-400">
                        <div>Demand: {data.methodology?.scoring?.demand || '—'}</div>
                        <div>Momentum: {data.methodology?.scoring?.momentum || '—'}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="text-center text-sm text-slate-400">
          Run Product Radar to see ranked product angles and the evidence behind them.
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
