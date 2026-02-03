import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Compass,
  Globe2,
  Layers,
  Sparkles,
  Tag,
  TrendingUp,
  Users,
  Wallet,
  X,
  Zap
} from 'lucide-react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from 'recharts';
import { AnimatePresence, motion } from 'framer-motion';
import './InsightsTab.css';

const INSIGHT_META = {
  persona: {
    label: 'Persona -> Creative',
    icon: Users,
    accent: '#38bdf8'
  },
  geo: {
    label: 'Geo Discovery',
    icon: Globe2,
    accent: '#f97316'
  },
  adjacent: {
    label: 'Adjacent Products',
    icon: Layers,
    accent: '#10b981'
  },
  peaks: {
    label: 'Peaks & Slumps',
    icon: TrendingUp,
    accent: '#22c55e'
  },
  anomalies: {
    label: 'Unusual Movement',
    icon: Activity,
    accent: '#ef4444'
  },
  pricing: {
    label: 'Pricing Adjustments',
    icon: Tag,
    accent: '#0ea5e9'
  },
  budget: {
    label: 'Budget Guidance',
    icon: Wallet,
    accent: '#14b8a6'
  }
};

const easeOut = [0.22, 1, 0.36, 1];

const INSIGHTS_LLM_STORAGE_KEY = 'virona.insights.ask.llm.v1';

function loadInsightsLlmSettings() {
  try {
    const raw = window.localStorage.getItem(INSIGHTS_LLM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function persistInsightsLlmSettings(value) {
  try {
    window.localStorage.setItem(INSIGHTS_LLM_STORAGE_KEY, JSON.stringify(value));
  } catch (_error) {
    // ignore
  }
}

const CARD_SUMMARIES = {
  persona: 'Creative guidance by segment.',
  geo: 'New markets worth testing.',
  adjacent: 'Products to add next.',
  peaks: 'Upcoming demand shifts.',
  anomalies: 'Unexpected spikes or drops.',
  pricing: 'Price band moves to test.'
};

const BUDGET_SUMMARIES = {
  startPlan: 'How to start budgets in new geos.',
  reallocation: 'Where to shift spend now.',
  incrementality: 'Scale vs cut by true lift.'
};

const SECTION_INDEX = [
  { id: 'insight-summary', title: 'Executive Summary', summary: 'Key drivers and risks.' },
  { id: 'insight-signal-fusion', title: 'Signal Fusion', summary: 'Confidence from combined signals.' },
  { id: 'insight-opportunity-radar', title: 'Opportunity Radar', summary: 'Demand vs competition by geo.' },
  { id: 'insight-narrative', title: 'Narrative Brief', summary: 'Weekly decision memo.' },
  { id: 'insight-persona-heatmap', title: 'Persona Heatmap', summary: 'Segments vs geos.' },
  { id: 'insight-demand-simulation', title: 'Demand Simulation', summary: 'Price vs demand curve.' },
  { id: 'insight-competitor-motion', title: 'Competitor Motion', summary: 'What changed in market.' },
  { id: 'insight-action-feed', title: 'Action Feed', summary: 'Most actionable moves.' },
  { id: 'insight-budget-guidance', title: 'Budget Guidance', summary: 'Start, shift, scale.' },
  { id: 'insight-launch-readiness', title: 'Launch Readiness', summary: 'Operational checklist.' }
];

const METHOD_OPTIONS = {
  persona: [
    { value: 'auto', label: 'Auto (recommended)' },
    { value: 'heuristic', label: 'Fatigue heuristic (fast)', note: 'Needs basic CTR history.' },
    { value: 'deepsurv', label: 'DeepSurv (survival model)', note: 'Recommended >=10 creatives with fatigue events.' }
  ],
  geo: [
    { value: 'auto', label: 'Auto (recommended)' },
    { value: 'scorer', label: 'Opportunity scorer + cosine', note: 'Lightweight baseline.' },
    { value: 'tabpfn', label: 'TabPFN', note: 'Recommended >=6 geos with conversions.' },
    { value: 'tabpfn+siamese', label: 'TabPFN + Siamese', note: 'Recommended >=10 geos for embeddings.' }
  ],
  adjacent: [
    { value: 'auto', label: 'Auto (recommended)' },
    { value: 'copurchase', label: 'Co-purchase lift + transitions', note: 'Best for small catalogs.' },
    { value: 'graphsage', label: 'GraphSAGE (offline)', note: 'Recommended >=200 SKUs + embeddings.' },
    { value: 'sasrec', label: 'SASRec (offline)', note: 'Recommended >=5000 sessions + scores.' }
  ],
  peaks: [
    { value: 'auto', label: 'Auto (recommended)' },
    { value: 'chronos', label: 'Chronos-2', note: 'Foundation forecasting model.' },
    { value: 'linear', label: 'Linear trend heuristic', note: 'Fast fallback.' }
  ]
};
const confidenceLabel = (value) => {
  if (value >= 0.75) return 'High';
  if (value >= 0.5) return 'Medium';
  return 'Low';
};

const getGaugeDegrees = (value) => `${Math.round(Math.max(0, Math.min(1, value)) * 360)}deg`;

const slugify = (value = '') =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const getAnchorId = (value) => `insight-${slugify(value || 'card')}`;

const createBaselinePayload = (store) => {
  const storeName = store?.name || 'Store';
  const now = new Date();
  const basePrice = store?.defaultAOV || 120;

  return {
    updatedAt: now.toISOString(),
    summary: {
      headline: `${storeName} has rising demand pockets with clear creative and pricing leverage.`,
      drivers: [
        'Search velocity is accelerating in two core geos.',
        'Competitor ad density eased in premium messaging.',
        'Gift-led segments are up in the last 21 days.'
      ],
      risks: [
        'Attribution gaps may hide true lift in mid-tier campaigns.',
        'Inventory compression expected if peak week repeats.',
        'Price dispersion widening across competitors.'
      ],
      confidence: 0.76,
      window: 'Last 30 days'
    },
    narrative: {
      title: 'Narrative Brief',
      summary: `${storeName} should lean into premium gifting creatives while testing two new geos that show early intent signals.`,
      actions: [
        'Shift 10-15% of creative budget toward luxury gifting visuals.',
        'Open UAE + Bahrain prospecting with a 14-day test.',
        'Maintain price band within 5% of premium competitors.'
      ],
      confidence: 0.72
    },
    signalFusion: {
      score: 0.78,
      drivers: ['Search + social momentum', 'Low creative fatigue', 'Stable CAC in core geo'],
      risks: ['Price pressure rising', 'Inventory lead time tight'],
      coverage: 0.84
    },
    radar: {
      points: [
        { geo: 'UAE', demand: 78, competition: 42, marketSize: 68, readiness: 74 },
        { geo: 'KSA', demand: 62, competition: 71, marketSize: 82, readiness: 66 },
        { geo: 'Qatar', demand: 58, competition: 38, marketSize: 44, readiness: 61 },
        { geo: 'Bahrain', demand: 66, competition: 33, marketSize: 52, readiness: 59 }
      ]
    },
    heatmap: {
      geos: ['UAE', 'KSA', 'Qatar', 'Bahrain'],
      segments: ['Gift Buyers', 'Premium Seekers', 'Value Hunters', 'Trend Hunters'],
      values: [
        [92, 66, 58, 71],
        [88, 62, 54, 64],
        [56, 72, 61, 49],
        [69, 58, 42, 77]
      ]
    },
    demandSimulation: {
      basePrice,
      curve: [
        { price: Math.round(basePrice * 0.8), demand: 88 },
        { price: Math.round(basePrice * 0.9), demand: 96 },
        { price: Math.round(basePrice), demand: 100 },
        { price: Math.round(basePrice * 1.1), demand: 92 },
        { price: Math.round(basePrice * 1.2), demand: 84 }
      ],
      elasticity: -1.05,
      bestPrice: Math.round(basePrice * 0.95)
    },
    competitorMotion: {
      events: [
        {
          id: 'motion-1',
          title: 'Premium gifting angle rising',
          detail: 'Three competitors introduced dark-stone creatives in UAE.',
          impact: 'Medium',
          source: 'Ad library tracking'
        },
        {
          id: 'motion-2',
          title: 'Price undercut in KSA',
          detail: 'Two new sellers launched entry bundles under your base price.',
          impact: 'High',
          source: 'Marketplace scan'
        }
      ]
    },
    readiness: {
      items: [
        { id: 'r1', title: 'Localization', status: 'Ready', detail: 'Arabic creative pack complete.' },
        { id: 'r2', title: 'Fulfillment', status: 'Watch', detail: 'Inventory lead time at 9 days.' },
        { id: 'r3', title: 'Tracking', status: 'Needs work', detail: 'CAPI coverage at 62%.' }
      ]
    },
    cards: [
      {
        id: 'card-persona',
        type: 'persona',
        title: 'Gift buyers react to darker luxury creatives',
        finding: 'Gift-led segments are up 31% in UAE with higher CTR on dark visuals.',
        why: 'Luxury cues outperform minimal palettes in top-performing ads.',
        action: 'Shift hero creative to dark-stone gifting story and update CTA to "premium gift".',
        confidence: 0.78,
        sources: ['Meta Ads performance', 'Review topic mining'],
        models: [
          { name: 'CLIP ViT-L/14', description: 'Embeds creative visuals into semantic vectors.' },
          { name: 'HDBSCAN', description: 'Clusters creatives by visual similarity.' },
          { name: 'Fatigue Heuristic', description: 'Rule-based fatigue estimate using CTR decay vs peak.' }
        ],
        models_available: [
          { name: 'DeepSurv (optional)', description: 'Enable when you have >= 10 creatives and fatigue events.' }
        ],
        method_used: 'heuristic',
        logic: 'Winning creative clusters are identified by higher conversion-weighted scores.',
        limits: 'Needs enough creatives and stable targeting. DeepSurv is optional.'
      },
      {
        id: 'card-geo',
        type: 'geo',
        title: 'Bahrain shows early demand with low competition',
        finding: 'Search velocity +28% QoQ with below-median ad density.',
        why: 'Adjacent to UAE performance but less saturated.',
        action: 'Run a 14-day acquisition test with localized creatives.',
        confidence: 0.71,
        sources: ['Search trends', 'Ad density scan'],
        models: [
          { name: 'Geo Opportunity Scorer', description: 'Weighted scoring on demand, readiness, and competition.' },
          { name: 'Cosine Similarity', description: 'Matches geos by similarity to top performers.' }
        ],
        models_available: [
          { name: 'TabPFN (optional)', description: 'Enable with >= 6 geos for stronger low-data prediction.' },
          { name: 'Siamese Similarity (optional)', description: 'Enable with >= 10 geos for learned embeddings.' }
        ],
        method_used: 'scorer',
        logic: 'Candidate geo ranks top in opportunity score while matching winning markets.',
        limits: 'Add external market data for stronger geo discovery.'
      },
      {
        id: 'card-adjacent',
        type: 'adjacent',
        title: 'Onyx + amber bundles are underrepresented',
        finding: 'Co-search and review clusters indicate rising demand for stone bundles.',
        why: 'Competitors list 6x more bundle SKUs in premium tiers.',
        action: 'Add a 2-piece bundle with premium packaging.',
        confidence: 0.66,
        sources: ['Marketplace scan', 'Review clustering'],
        models: [
          { name: 'Directional Co-purchase Lift', description: 'Computes P(Y|X) + lift to avoid popularity bias.' },
          { name: 'Markov Transition Model', description: 'Counts next-step transitions from sessions when available.' }
        ],
        models_available: [
          { name: 'GraphSAGE (optional)', description: 'Enable with >= 200 SKUs and offline-trained embeddings.' },
          { name: 'SASRec (optional)', description: 'Enable with >= 5000 sessions and offline-trained scores.' }
        ],
        method_used: 'copurchase',
        logic: 'Rank directional pairs by lift then support, optionally boosted by transitions.',
        limits: 'Small catalogs rarely benefit from deep graph/sequence models.'
      },
      {
        id: 'card-peaks',
        type: 'peaks',
        title: 'Peak window expected in 3 weeks',
        finding: 'Forecast shows +18% uplift around upcoming gifting period.',
        why: 'Seasonality and social intent accelerating together.',
        action: 'Lock inventory buffer + ramp creatives 10 days prior.',
        confidence: 0.74,
        sources: ['Demand forecast', 'Seasonality model'],
        models: [
          { name: 'Linear Trend', description: 'Slope-based short-term forecast.' }
        ],
        models_available: [
          { name: 'Chronos-2 (optional)', description: 'Enable when Chronos weights are available.' }
        ],
        method_used: 'linear',
        logic: 'Positive slope and forecasted uplift point to a short-term peak window.',
        limits: 'Short history or volatile spend can reduce forecast stability.'
      },
      {
        id: 'card-anomaly',
        type: 'anomalies',
        title: 'Recent slowdown tied to competitor surge',
        finding: 'KSA conversions dropped 2.2 sigma after competitor promo burst.',
        why: 'Ad intensity spike coincided with price undercut.',
        action: 'Match promo for 5 days and re-evaluate CAC.',
        confidence: 0.69,
        sources: ['Conversion anomaly detection', 'Ad shift tracker'],
        models: [
          { name: 'LSTM Autoencoder', description: 'Flags abnormal drops beyond seasonal baseline.' },
          { name: 'BSTS', description: 'Estimates likely drivers of the change.' }
        ]
      },
      {
        id: 'card-pricing',
        type: 'pricing',
        title: 'Price elasticity suggests a 5% drop test',
        finding: 'Model indicates 9-12% demand lift with a small price dip.',
        why: 'Competitor spread widened while conversion softened.',
        action: 'Run a 14-day A/B with a 5% price band decrease.',
        confidence: 0.73,
        sources: ['Price history', 'Competitor pricing'],
        models: [
          { name: 'Deep Lattice Network', description: 'Monotonic demand curve estimation.' },
          { name: 'DragonNet', description: 'Uplift model for price interventions.' }
        ]
      }
    ],
    budget: {
      startPlan: {
        title: 'Cold-start budget plan',
        finding: 'Start UAE at $4-6k/week split 65/35 Meta/TikTok.',
        action: 'Deploy for 14 days before scaling.',
        confidence: 0.7,
        models: [
          { name: 'MAML Meta-Learning', description: 'Adapts quickly from similar shop patterns.' },
          { name: 'Geo Similarity Embeddings', description: 'Transfers expectations from adjacent markets.' }
        ]
      },
      reallocation: {
        title: 'Reallocation guidance',
        finding: 'Shift 12% budget from KSA Meta to UAE TikTok.',
        action: 'Review CPA after 7-day holdout.',
        confidence: 0.68,
        models: [
          { name: 'NeuralUCB Bandit', description: 'Allocates spend using contextual signals.' }
        ]
      },
      incrementality: {
        title: 'Scale vs cut',
        finding: 'Meta UAE shows +11% incremental lift.',
        action: 'Scale 15-20% while maintaining guardrails.',
        confidence: 0.72,
        models: [
          { name: 'Causal Forest', description: 'Estimates incremental lift per channel.' },
          { name: 'Double ML', description: 'Controls confounding for spend impact.' }
        ]
      }
    }
  };
};

function ConfidencePill({ value }) {
  const label = confidenceLabel(value);
  const tone = value >= 0.75
    ? 'bg-emerald-500/15 text-emerald-700'
    : value >= 0.5
      ? 'bg-amber-400/20 text-amber-700'
      : 'bg-rose-400/20 text-rose-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>
      {label} confidence
    </span>
  );
}

function InsightCard({ card, anchorId, flash, onAsk, override, onOverrideChange }) {
  const meta = INSIGHT_META[card.type] || INSIGHT_META.persona;
  const Icon = meta.icon;
  const [flipped, setFlipped] = useState(false);

  const methodOptions = METHOD_OPTIONS[card.type] || [{ value: 'auto', label: 'Auto (recommended)' }];
  const mode = override?.mode || 'auto';
  const selectedMethod = override?.method || 'auto';
  const selectedOption = methodOptions.find((option) => option.value === (mode === 'manual' ? selectedMethod : 'auto'));
  const methodUsed = card.method_used || (card.models || []).map((model) => model.name).join(', ') || 'Auto';
  const methodRequested = mode === 'manual' ? selectedMethod : 'auto';
  const warnings = card.warnings || [];
  const logic = card.logic;
  const limits = card.limits;
  const modelsAvailable = card.models_available || [];

  const modelTag = (name = '') => {
    const heuristicPattern = /(heuristic|scorer|lift|cosine|trend|linear|propensity)/i;
    return heuristicPattern.test(name) ? 'Heuristic' : 'Model';
  };

  const handleModeChange = (nextMode) => {
    if (!onOverrideChange) return;
    if (nextMode === 'auto') {
      onOverrideChange(card.type, { mode: 'auto', method: 'auto' });
      return;
    }
    const fallback = methodOptions.find((option) => option.value !== 'auto')?.value || 'auto';
    onOverrideChange(card.type, { mode: 'manual', method: selectedMethod !== 'auto' ? selectedMethod : fallback });
  };

  const handleMethodChange = (event) => {
    if (!onOverrideChange) return;
    onOverrideChange(card.type, { mode: 'manual', method: event.target.value });
  };

  return (
    <motion.div
      id={anchorId}
      className={`insights-card-border insights-anchor insights-card-shell ${flash ? 'insights-flash' : ''}`}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.25, ease: easeOut }}
    >
      <div className="insights-card-flip">
        <div className={`insights-card-inner ${flipped ? 'is-flipped' : ''}`}>
          <div className="insights-card-face insights-card-front">
            <div className="insights-card p-5">
              <div className="insights-card-actions">
                <button
                  type="button"
                  className="insights-action-pill"
                  aria-label="Explain"
                  title="Explain"
                  onClick={() => setFlipped(true)}
                >
                  <Zap className="h-3.5 w-3.5" />
                  <span>Explain</span>
                </button>
                <ConfidencePill value={card.confidence} />
              </div>
              <div className="flex items-start gap-3">
                <div className="insights-icon" style={{ boxShadow: `0 0 18px ${meta.accent}` }}>
                  <Icon className="h-5 w-5" style={{ color: meta.accent }} />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{meta.label}</div>
                  <div className="mt-2 text-base font-semibold text-slate-900">{card.title}</div>
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <div><span className="font-semibold text-slate-800">Finding:</span> {card.finding}</div>
                <div><span className="font-semibold text-slate-800">Why it matters:</span> {card.why}</div>
                <div className="text-slate-900"><span className="font-semibold">Action:</span> {card.action}</div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(card.sources || []).map((source) => (
                  <span key={source} className="insights-chip">{source}</span>
                ))}
              </div>
              <button
                type="button"
                className="insights-ask insights-ask-floating"
                aria-label="Ask AI"
                title="Ask AI"
                onClick={() => onAsk?.(card, meta)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Ask AI</span>
              </button>
            </div>
          </div>

          <div className="insights-card-face insights-card-back">
            <div className="insights-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Method & evidence</div>
                  <div className="mt-2 text-base font-semibold text-slate-900">{meta.label}</div>
                  <div className="mt-1 text-xs text-slate-500">Used: {methodUsed}</div>
                </div>
                <button type="button" className="insights-action-pill" onClick={() => setFlipped(false)} aria-label="Back" title="Back">
                  <Zap className="h-3.5 w-3.5" />
                  <span>Back</span>
                </button>
              </div>

              <div className="insights-card-scroll">
                <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Mode</span>
                  <div className="inline-flex rounded-full border border-slate-200 bg-white/80 p-0.5">
                    <button
                      type="button"
                      className={`insights-toggle ${mode === 'auto' ? 'is-active' : ''}`}
                      onClick={() => handleModeChange('auto')}
                    >
                      Auto
                    </button>
                    <button
                      type="button"
                      className={`insights-toggle ${mode === 'manual' ? 'is-active' : ''}`}
                      onClick={() => handleModeChange('manual')}
                    >
                      Manual
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Method override</label>
                  <select
                    className="insights-select"
                    disabled={mode !== 'manual'}
                    value={mode === 'manual' ? selectedMethod : 'auto'}
                    onChange={handleMethodChange}
                  >
                    {methodOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  {mode === 'manual' && methodRequested !== 'auto' && (
                    <div className="mt-2 text-[11px] text-slate-500">Requested: {methodRequested}</div>
                  )}
                {selectedOption?.note && (
                  <div className="mt-1 text-[11px] text-slate-500">{selectedOption.note}</div>
                )}
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  {warnings.map((warning) => (
                    <div key={warning}>• {warning}</div>
                  ))}
                </div>
              )}

              <div className="mt-4 space-y-3 text-xs text-slate-600">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Models used</div>
                {(card.models || []).map((model) => (
                  <div key={model.name} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                    <div>
                      <div className="text-slate-800 font-semibold">{model.name} <span className="text-[10px] uppercase text-slate-400">({modelTag(model.name)})</span></div>
                      <div>{model.description}</div>
                    </div>
                  </div>
                ))}
              </div>

              {modelsAvailable.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Available upgrades</div>
                  <div className="mt-2 space-y-2 text-xs text-slate-600">
                    {modelsAvailable.map((model) => (
                      <div key={model.name} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                        <div>
                          <div className="text-slate-800 font-semibold">{model.name}</div>
                          <div>{model.description}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(logic || limits) && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white/70 p-3 text-xs text-slate-600">
                  {logic && (
                    <div><span className="font-semibold text-slate-700">Logic:</span> {logic}</div>
                  )}
                  {limits && (
                    <div className="mt-2"><span className="font-semibold text-slate-700">Limits:</span> {limits}</div>
                  )}
                </div>
              )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function BudgetCard({ card, anchorId, flash, onAsk }) {
  return (
    <div id={anchorId} className={`insights-card-border insights-anchor insights-card-shell ${flash ? 'insights-flash' : ''}`}>
      <div className="insights-card insights-card-budget p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">{card.title}</div>
          <ConfidencePill value={card.confidence} />
        </div>
        <div className="mt-3 text-sm text-slate-600">{card.finding}</div>
        <div className="mt-3 text-sm font-semibold text-slate-900">Action: {card.action}</div>
        <details className="insights-details mt-3 rounded-xl border border-slate-200 bg-white/60 p-3 text-xs text-slate-500">
          <summary className="font-semibold text-slate-700">Model details</summary>
          <div className="mt-2 space-y-2">
            {(card.models || []).map((model) => (
              <div key={model.name} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-400" />
                <div>
                  <div className="text-slate-800 font-semibold">{model.name}</div>
                  <div>{model.description}</div>
                </div>
              </div>
            ))}
          </div>
        </details>
        <button
          type="button"
          className="insights-ask insights-ask-floating"
          aria-label="Ask AI"
          title="Ask AI"
          onClick={() => onAsk?.(card, { label: 'Budget Guidance', accent: '#14b8a6' })}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Ask AI</span>
        </button>
      </div>
    </div>
  );
}

export default function InsightsTab({ store, formatCurrency }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [flashId, setFlashId] = useState('');
  const flashTimer = useRef(null);
  const [askContext, setAskContext] = useState(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState('');
  const [askLlmSettings, setAskLlmSettings] = useState(() => (
    loadInsightsLlmSettings() || { provider: 'openai', model: '', temperature: 1.0 }
  ));
  const [methodOverrides, setMethodOverrides] = useState({});

  useEffect(() => {
    return () => {
      if (flashTimer.current) {
        clearTimeout(flashTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!askContext) return;
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        setAskContext(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [askContext]);


  const handleOverrideChange = (type, next) => {
    setMethodOverrides((prev) => ({
      ...prev,
      [type]: {
        ...(prev[type] || { mode: 'auto', method: 'auto' }),
        ...next
      }
    }));
  };
  useEffect(() => {
    if (!store?.id) return;
    setLoading(true);
    setError('');

    const overridePayload = Object.entries(methodOverrides).reduce((acc, [type, cfg]) => {
      if (cfg?.mode === 'manual' && cfg.method && cfg.method !== 'auto') {
        acc[type] = cfg.method;
      }
      return acc;
    }, {});
    const methodsParam = Object.keys(overridePayload).length
      ? `&methods=${encodeURIComponent(JSON.stringify(overridePayload))}`
      : '';

    fetch(`/api/insights?store=${store.id}${methodsParam}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data || data.success === false) {
          throw new Error(data?.error || 'Unable to load insights.');
        }
        setPayload(data.data || null);
      })
      .catch((err) => {
        setError(err.message || 'Unable to load insights.');
        setPayload(null);
      })
      .finally(() => setLoading(false));
  }, [store?.id, methodOverrides]);

  const insights = useMemo(() => payload || createBaselinePayload(store), [payload, store]);
  const navItems = useMemo(() => {
    if (!insights) return [];
    const entries = (insights.cards || []).map((card) => ({
      id: getAnchorId(card.id || card.type || card.title),
      title: card.title,
      summary: CARD_SUMMARIES[card.type] || 'Actionable insight.'
    }));
    const budget = insights.budget || {};
    const budgetEntries = ['startPlan', 'reallocation', 'incrementality']
      .filter((key) => budget[key])
      .map((key) => ({
        id: getAnchorId(`budget-${key}`),
        title: budget[key].title,
        summary: BUDGET_SUMMARIES[key] || 'Budget guidance.'
      }));
    return [...SECTION_INDEX, ...entries, ...budgetEntries];
  }, [insights]);

  const buildAskPrompt = (card, meta) => {
    const storeName = store?.name || store?.id || 'store';
    const signals = (card?.signals || card?.sources || []).join(', ') || 'internal performance signals';
    const models = (card?.models || []).map((model) => model.name).join(', ') || 'ensemble heuristics';
    return `You are an insights analyst for ${storeName}. Explain the insight in plain language but scientific tone (max 120 words). Include: what changed, why it matters, and the action. Add one sentence about confidence and limits. No bullet points.\n\nTitle: ${card?.title}\nFinding: ${card?.finding}\nWhy: ${card?.why}\nAction: ${card?.action}\nConfidence: ${Math.round((card?.confidence || 0) * 100)}%\nSignals: ${signals}\nModels: ${models}`;
  };

  const handleJump = (targetId) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlashId(targetId);
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
    }
    flashTimer.current = setTimeout(() => setFlashId(''), 1400);
  };

  const handleAskOpen = async (card, meta = {}) => {
    if (!card) return;
    const label = meta.label || 'Insight';
    const accent = meta.accent || '#38bdf8';
    const signals = card.signals || card.sources || [];
    const logic = card.logic || card.why || card.finding || 'This insight comes from recent performance shifts plus market signals.';
    const limits = card.limits || 'Accuracy depends on tracking coverage, sample size, and signal freshness.';
    setAskContext({
      ...card,
      label,
      accent,
      signals,
      logic,
      limits,
      response: 'Generating explanation...'
    });
    setAskLoading(true);
    setAskError('');

    try {
      const question = buildAskPrompt(card, meta);
      persistInsightsLlmSettings(askLlmSettings);

      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          store: store?.id || store?.name || 'shawq',
          mode: 'analyze',
          llm: askLlmSettings
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'AI unavailable.');
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Streaming response is not available.');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          if (!payload.trim()) continue;

          try {
            const data = JSON.parse(payload);
            if (data.type === 'delta') {
              fullText += data.text || '';
              setAskContext((prev) => (prev ? { ...prev, response: fullText } : prev));
            } else if (data.type === 'done') {
              setAskContext((prev) => (prev ? { ...prev, response: fullText, model: data.model || null } : prev));
            } else if (data.type === 'error') {
              throw new Error(data.error || 'AI unavailable.');
            }
          } catch (_parseError) {
            // ignore malformed lines
          }
        }
      }
    } catch (error) {
      const message = error?.message || 'AI unavailable.';
      setAskError(message);
      setAskContext((prev) => (prev ? { ...prev, response: 'AI is unavailable. Add an API key to enable Ask AI.' } : prev));
    } finally {
      setAskLoading(false);
    }
  };

  const handleAskClose = () => {
    setAskContext(null);
    setAskLoading(false);
    setAskError('');
  };

  if (!store) return null;

  return (
    <div className="insights-root">
      <motion.div
        className="insights-shell p-8 md:p-10"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: easeOut }}
      >
        <div className="insights-orb insights-orb--cool" />
        <div className="insights-orb insights-orb--warm" />

        <div className="relative z-10 space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <Sparkles className="h-3.5 w-3.5" />
                Insight Lab
              </div>
              <h2 className="insights-title mt-4 text-3xl font-semibold text-slate-900 md:text-4xl">
                Intelligent growth signals for {store.name}
              </h2>
              <p className="mt-2 max-w-xl text-sm text-slate-600">
                A living research feed that surfaces what changed, why it matters, and exactly what to do next.
              </p>
            </div>
            <div className="space-y-2 text-right">
              <div className="insights-pill insights-shimmer">{insights.summary.window}</div>
              <div className="text-xs text-slate-500">Updated {new Date(insights.updatedAt).toLocaleString()}</div>
            </div>
          </div>

          {navItems.length > 0 && (
            <div className="insights-index">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="insights-index-card"
                  onClick={() => handleJump(item.id)}
                >
                  <span className="insights-index-label">See:</span>
                  <span className="insights-index-title">{item.title}</span>
                  <span className="insights-index-sub">{item.summary}</span>
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <div id="insight-summary" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-summary' ? 'insights-flash' : ''}`}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                <Compass className="h-4 w-4" />
                Executive summary
              </div>
              <div className="insights-title mt-3 text-xl font-semibold text-slate-900">
                {insights.summary.headline}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Drivers</div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    {insights.summary.drivers.map((driver) => (
                      <li key={driver} className="flex items-start gap-2">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                        <span>{driver}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Risks</div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    {insights.summary.risks.map((risk) => (
                      <li key={risk} className="flex items-start gap-2">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-rose-400" />
                        <span>{risk}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div id="insight-signal-fusion" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-signal-fusion' ? 'insights-flash' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Signal Fusion</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">Confidence engine</div>
                </div>
                <ConfidencePill value={insights.signalFusion.score} />
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-6">
                <div className="insights-gauge" style={{ '--gauge-value': getGaugeDegrees(insights.signalFusion.score) }}>
                  <div className="insights-gauge-inner">
                    <div className="text-2xl font-semibold text-slate-900">{Math.round(insights.signalFusion.score * 100)}</div>
                    <div className="text-[11px] text-slate-500">Signal</div>
                  </div>
                </div>
                <div className="space-y-3 text-sm text-slate-600">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Top drivers</div>
                    <div className="mt-2 space-y-1">
                      {insights.signalFusion.drivers.map((driver) => (
                        <div key={driver} className="flex items-center gap-2">
                          <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                          {driver}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Risks</div>
                    <div className="mt-2 space-y-1">
                      {insights.signalFusion.risks.map((risk) => (
                        <div key={risk} className="flex items-center gap-2">
                          <ArrowDownRight className="h-3 w-3 text-rose-500" />
                          {risk}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <div id="insight-opportunity-radar" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-opportunity-radar' ? 'insights-flash' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Opportunity Radar</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">Where to play next</div>
                </div>
                <span className="insights-chip">Demand vs competition</span>
              </div>
              <div className="mt-6 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <XAxis type="number" dataKey="competition" name="Competition" tick={{ fontSize: 11 }} />
                    <YAxis type="number" dataKey="demand" name="Demand" tick={{ fontSize: 11 }} />
                    <ZAxis type="number" dataKey="marketSize" range={[80, 200]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0' }} />
                    <Scatter data={insights.radar.points} fill="#38bdf8" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {insights.radar.points.map((point) => (
                  <div key={point.geo} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between font-semibold text-slate-800">
                      <span>{point.geo}</span>
                      <span>{point.demand}/100 demand</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">Competition {point.competition}/100 | Readiness {point.readiness}/100</div>
                  </div>
                ))}
              </div>
            </div>

            <div id="insight-narrative" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-narrative' ? 'insights-flash' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Narrative brief</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">Weekly decision memo</div>
                </div>
                <ConfidencePill value={insights.narrative.confidence} />
              </div>
              <p className="mt-4 text-sm text-slate-600">{insights.narrative.summary}</p>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                {insights.narrative.actions.map((action) => (
                  <div key={action} className="flex items-start gap-2">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400" />
                    <span>{action}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                <Sparkles className="h-3 w-3" />
                Auto-updated weekly
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <div id="insight-persona-heatmap" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-persona-heatmap' ? 'insights-flash' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Persona heatmap</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">Who wants it most</div>
                </div>
                <span className="insights-chip">Intent strength</span>
              </div>
              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-5 bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <div className="px-3 py-2">Segment</div>
                  {insights.heatmap.geos.map((geo) => (
                    <div key={geo} className="px-3 py-2 text-center">{geo}</div>
                  ))}
                </div>
                <div className="divide-y divide-slate-100">
                  {insights.heatmap.segments.map((segment, rowIndex) => (
                    <div key={segment} className="grid grid-cols-5 bg-white text-xs text-slate-700">
                      <div className="px-3 py-2 font-semibold">{segment}</div>
                      {insights.heatmap.geos.map((geo, colIndex) => {
                        const value = insights.heatmap.values[rowIndex][colIndex];
                        const intensity = Math.max(0.15, value / 100);
                        return (
                          <div
                            key={`${segment}-${geo}`}
                            className="px-3 py-2 text-center"
                            style={{ background: `rgba(56, 189, 248, ${intensity})` }}
                          >
                            {value}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-6">
              <div id="insight-demand-simulation" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-demand-simulation' ? 'insights-flash' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Demand simulation</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">Price vs demand curve</div>
                  </div>
                  <span className="insights-chip">Elasticity {insights.demandSimulation.elasticity}</span>
                </div>
                <div className="mt-4 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={insights.demandSimulation.curve} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                      <XAxis dataKey="price" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0' }} />
                      <Line type="monotone" dataKey="demand" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 text-xs text-slate-500">Suggested price band near {formatCurrency ? formatCurrency(insights.demandSimulation.bestPrice, 0) : insights.demandSimulation.bestPrice}.</div>
              </div>

              <div id="insight-competitor-motion" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-competitor-motion' ? 'insights-flash' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Competitor motion</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">What competitors changed</div>
                  </div>
                  <Zap className="h-4 w-4 text-amber-500" />
                </div>
                <div className="mt-4 space-y-3">
                  {insights.competitorMotion.events.map((event) => (
                    <div key={event.id} className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-xs text-slate-600">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-900">{event.title}</div>
                        <span className="insights-chip">{event.impact}</span>
                      </div>
                      <div className="mt-2">{event.detail}</div>
                      <div className="mt-2 text-[11px] text-slate-400">Source: {event.source}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div id="insight-action-feed" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-action-feed' ? 'insights-flash' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Action feed</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">Most actionable moves right now</div>
              </div>
              <span className="insights-chip">Updated hourly</span>
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-2 insights-card-grid">
              {insights.cards.map((card) => {
                const anchorId = getAnchorId(card.id || card.type || card.title);
                return (
                  <InsightCard
                    key={card.id}
                    card={card}
                    anchorId={anchorId}
                    flash={flashId === anchorId}
                    onAsk={handleAskOpen}
                    override={methodOverrides[card.type] || { mode: 'auto', method: 'auto' }}
                    onOverrideChange={handleOverrideChange}
                  />
                );
              })}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
            <div id="insight-budget-guidance" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-budget-guidance' ? 'insights-flash' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Budget guidance</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">Start, shift, or scale</div>
                </div>
                <div className="insights-pill insights-pill--soft">
                  <BarChart3 className="h-4 w-4" />
                  Advisory mode
                </div>
              </div>
              <div className="mt-5 grid gap-4">
                {['startPlan', 'reallocation', 'incrementality'].map((key) => {
                  const value = insights.budget[key];
                  if (!value) return null;
                  const anchorId = getAnchorId(`budget-${key}`);
                  return (
                    <BudgetCard
                      key={key}
                      card={value}
                      anchorId={anchorId}
                      flash={flashId === anchorId}
                      onAsk={handleAskOpen}
                    />
                  );
                })}
              </div>
            </div>

            <div id="insight-launch-readiness" className={`insights-glass insights-anchor p-6 ${flashId === 'insight-launch-readiness' ? 'insights-flash' : ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Launch readiness</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">Operational checklist</div>
                </div>
                <div className="insights-pill insights-pill--soft">Live status</div>
              </div>
              <div className="mt-5 space-y-3">
                {insights.readiness.items.map((item) => {
                  const tone = item.status === 'Ready'
                    ? 'bg-emerald-400/15 text-emerald-700'
                    : item.status === 'Watch'
                      ? 'bg-amber-400/15 text-amber-700'
                      : 'bg-rose-400/15 text-rose-700';
                  return (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-white/80 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{item.status}</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">{item.detail}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {askContext && (
            <>
              <motion.div
                className="insights-ask-backdrop"
                onClick={handleAskClose}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
              <motion.aside
                className="insights-ask-drawer"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ duration: 0.35, ease: easeOut }}
              >
                <div className="insights-ask-header">
                  <div className="insights-ask-title">
                    <Sparkles className="h-4 w-4" style={{ color: askContext.accent }} />
                    Ask AI
                  </div>
                  <button type="button" className="insights-ask-close" onClick={handleAskClose} aria-label="Close">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={`${askLlmSettings.provider}:${askLlmSettings.model || 'auto'}`}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === 'openai:auto') {
                        setAskLlmSettings((prev) => ({ ...prev, provider: 'openai', model: '' }));
                        return;
                      }
                      if (value === 'deepseek:deepseek-chat') {
                        setAskLlmSettings((prev) => ({ ...prev, provider: 'deepseek', model: 'deepseek-chat' }));
                        return;
                      }
                      if (value === 'deepseek:deepseek-reasoner') {
                        setAskLlmSettings((prev) => ({ ...prev, provider: 'deepseek', model: 'deepseek-reasoner' }));
                      }
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
                    title="AI model"
                  >
                    <option value="openai:auto">OpenAI (auto)</option>
                    <option value="deepseek:deepseek-chat">DeepSeek Chat (Non-thinking)</option>
                    <option value="deepseek:deepseek-reasoner">DeepSeek Reasoner (Thinking)</option>
                  </select>

                  {askLlmSettings.provider === 'deepseek' && (
                    <select
                      value={String(askLlmSettings.temperature ?? 1.0)}
                      onChange={(event) => setAskLlmSettings((prev) => ({ ...prev, temperature: Number(event.target.value) }))}
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

                <div className="insights-ask-meta">
                  <span className="insights-chip">{askContext.label}</span>
                  {askContext.confidence !== undefined && (
                    <ConfidencePill value={askContext.confidence} />
                  )}
                </div>

                <h3 className="mt-3 text-lg font-semibold text-slate-900">{askContext.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{askContext.finding}</p>

                <div className="insights-ask-block">
                  <div className="insights-ask-label">AI summary</div>
                  <div className="text-sm text-slate-700">{askContext.response}</div>
                  {askLoading && (
                    <div className="insights-ask-status">Analyzing signals...</div>
                  )}
                  {askError && (
                    <div className="insights-ask-status insights-ask-error">{askError}</div>
                  )}
                </div>

                <div className="insights-ask-block">
                  <div className="insights-ask-label">Signals used</div>
                  <div className="insights-ask-list">
                    {(askContext.signals || []).map((signal) => (
                      <span key={signal} className="insights-chip">{signal}</span>
                    ))}
                  </div>
                </div>

                <div className="insights-ask-block">
                  <div className="insights-ask-label">Models</div>
                  <div className="space-y-2 text-xs text-slate-600">
                    {(askContext.models || []).map((model) => (
                      <div key={model.name} className="rounded-xl border border-slate-200 bg-white/70 p-2">
                        <div className="font-semibold text-slate-800">{model.name}</div>
                        <div>{model.description}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="insights-ask-block">
                  <div className="insights-ask-label">Decision logic</div>
                  <div className="text-sm text-slate-600">{askContext.logic}</div>
                </div>

                <div className="insights-ask-block">
                  <div className="insights-ask-label">Limits</div>
                  <div className="text-sm text-slate-600">{askContext.limits}</div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-[36px] bg-white/60 text-sm text-slate-500 backdrop-blur">
            Loading insights...
          </div>
        )}
      </motion.div>
    </div>
  );
}
