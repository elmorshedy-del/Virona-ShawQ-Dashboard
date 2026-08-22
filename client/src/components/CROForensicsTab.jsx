import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Beaker,
  BrainCircuit,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles
} from 'lucide-react';

const API_BASE = '/api';

const TRAFFIC_SOURCE_OPTIONS = [
  { value: 'paid_social', label: 'Paid Social' },
  { value: 'paid_search', label: 'Paid Search' },
  { value: 'organic_search', label: 'Organic Search' },
  { value: 'email', label: 'Email' },
  { value: 'direct', label: 'Direct' },
  { value: 'referral', label: 'Referral' }
];

const AUDIENCE_OPTIONS = [
  { value: 'cold', label: 'Cold audience' },
  { value: 'warm', label: 'Warm audience' },
  { value: 'hot', label: 'Hot audience' }
];

const PRICE_RISK_OPTIONS = [
  { value: 'low', label: 'Low price/risk' },
  { value: 'medium', label: 'Medium price/risk' },
  { value: 'high', label: 'High price/risk' }
];

const OFFER_TYPE_OPTIONS = [
  { value: 'single-product', label: 'Single product page' },
  { value: 'collection', label: 'Collection category page' },
  { value: 'lead-gen', label: 'Lead generation page' },
  { value: 'checkout', label: 'Checkout/offer step' }
];

const MODEL_ICON = {
  decision_friction: Activity,
  message_intent_alignment: BrainCircuit,
  proof_architecture: ShieldCheck,
  choice_architecture: Search,
  anxiety_risk_reversal: AlertTriangle
};

function scoreTone(score) {
  if (score >= 80) return 'text-emerald-700';
  if (score >= 65) return 'text-violet-700';
  if (score >= 50) return 'text-amber-700';
  return 'text-rose-700';
}

function scorePillClass(score) {
  if (score >= 80) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (score >= 65) return 'bg-violet-100 text-violet-700 border-violet-200';
  if (score >= 50) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-rose-100 text-rose-700 border-rose-200';
}

function formatPercent(value, digits = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num.toFixed(digits)}%`;
}

function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (response) => {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = data?.message || `Request failed (HTTP ${response.status})`;
      throw new Error(message);
    }

    return data;
  });
}

function ModelCard({ model }) {
  const Icon = MODEL_ICON[model.id] || Sparkles;
  const meterWidth = Math.max(4, Math.min(100, model.adjustedScore));

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_18px_40px_rgba(88,28,135,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Model</p>
          <h3 className="mt-1 text-[15px] font-semibold text-slate-900">{model.label}</h3>
        </div>
        <div className="rounded-xl border border-violet-100 bg-violet-50 p-2">
          <Icon className="h-4 w-4 text-violet-700" />
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div>
          <div className={`text-3xl font-semibold ${scoreTone(model.adjustedScore)}`}>
            {Math.round(model.adjustedScore)}
          </div>
          <p className="mt-1 text-xs text-slate-400">Weighted score</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Drag probability</p>
          <p className="text-sm font-semibold text-slate-900">{formatPercent(model.dragProbability * 100, 1)}</p>
          <p className="mt-1 text-xs text-slate-500">Confidence {formatPercent(model.confidence * 100, 0)}</p>
        </div>
      </div>

      <div className="mt-4 h-2 rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${meterWidth >= 70 ? 'bg-emerald-400' : meterWidth >= 50 ? 'bg-amber-300' : 'bg-rose-400'}`}
          style={{ width: `${meterWidth}%` }}
        />
      </div>

      <div className="mt-4 space-y-2">
        {model.dominantRisks?.slice(0, 2).map((risk) => (
          <div key={`${model.id}-${risk.key}`} className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2">
            <p className="text-xs font-medium text-slate-800">{risk.label}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{risk.evidence}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperimentRow({ item, index }) {
  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-[0_14px_30px_rgba(88,28,135,0.07)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="rounded-full border border-violet-200 px-2 py-0.5">#{index + 1}</span>
            <span>Priority queue</span>
          </div>
          <h4 className="mt-2 text-sm font-semibold text-slate-900">{item.title}</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.hypothesis}</p>
          {item.trigger && (
            <p className="mt-2 text-[11px] text-violet-700">
              Trigger: {item.trigger}
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-violet-700">
            <p className="text-[11px] uppercase tracking-wide">Priority</p>
            <p className="text-base font-semibold">{item.priorityScore}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full border border-violet-200 px-3 py-1 text-[11px] text-slate-700">Lift {item.expectedLiftPct}</span>
        <span className="rounded-full border border-violet-200 px-3 py-1 text-[11px] text-slate-700">Metric {item.targetMetric}</span>
        <span className="rounded-full border border-violet-200 px-3 py-1 text-[11px] text-slate-700">Effort {item.effort}</span>
        <span className="rounded-full border border-violet-200 px-3 py-1 text-[11px] text-slate-700">Confidence {formatPercent(item.confidence * 100)}</span>
      </div>
    </div>
  );
}

export default function CROForensicsTab() {
  const [form, setForm] = useState({
    url: '',
    conversionGoal: 'Purchase ring size kit',
    trafficSource: 'paid_social',
    audienceSophistication: 'cold',
    priceRisk: 'medium',
    offerType: 'single-product'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [audit, setAudit] = useState(null);

  const overallPillClass = useMemo(() => scorePillClass(audit?.summary?.overallScore ?? 0), [audit]);

  const handleField = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const runAudit = async () => {
    if (!form.url.trim()) {
      setError('Enter a URL to run CRO Forensics.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await postJson(`${API_BASE}/cro-forensics/audit`, form);
      setAudit(response?.audit || null);
    } catch (err) {
      setError(err.message || 'Audit failed.');
      setAudit(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-violet-100 bg-[#f8f6ff] p-6 md:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_14%,rgba(139,92,246,0.24),transparent_36%),radial-gradient(circle_at_88%_8%,rgba(192,132,252,0.24),transparent_34%),linear-gradient(165deg,#ffffff,#f7f3ff_48%,#f3edff)]" />
      <div className="relative z-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-violet-600">Conversion Intelligence</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900 md:text-4xl">CRO Forensics</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-700">
              One-time Bayesian conversion audit across Decision Friction, Message-Intent Alignment,
              Proof Architecture, Choice Architecture, and Anxiety/Risk Reversal.
            </p>
          </div>
          <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-right">
            <p className="text-[11px] uppercase tracking-[0.18em] text-violet-500">Scoring method</p>
            <p className="mt-1 text-sm font-semibold text-violet-700">Bayesian Conversion-Drag v1</p>
          </div>
        </div>

        <div className="mt-7 rounded-2xl border border-violet-100 bg-white/95 p-4 md:p-5 shadow-[0_20px_42px_rgba(88,28,135,0.09)]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-slate-600">Website URL</label>
              <input
                type="text"
                value={form.url}
                onChange={handleField('url')}
                placeholder="https://example.com/product-page"
                className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
              />
            </div>
            <div className="md:col-span-6">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-slate-600">Primary conversion goal</label>
              <input
                type="text"
                value={form.conversionGoal}
                onChange={handleField('conversionGoal')}
                placeholder="Purchase, booking, lead submit..."
                className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
              />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-slate-600">Traffic source</label>
              <select
                value={form.trafficSource}
                onChange={handleField('trafficSource')}
                className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
              >
                {TRAFFIC_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-slate-600">Audience stage</label>
              <select
                value={form.audienceSophistication}
                onChange={handleField('audienceSophistication')}
                className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
              >
                {AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-slate-600">Price risk</label>
              <select
                value={form.priceRisk}
                onChange={handleField('priceRisk')}
                className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
              >
                {PRICE_RISK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="text-xs font-medium uppercase tracking-[0.14em] text-slate-600">Offer type</label>
              <select
                value={form.offerType}
                onChange={handleField('offerType')}
                className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/25"
              >
                {OFFER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              Formula: Drag probability per model = sigmoid(logit(prior) + Σ(beta × risk-centered-signal))
            </div>
            <button
              type="button"
              onClick={runAudit}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-500 bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Beaker className="h-4 w-4" />}
              {loading ? 'Running Forensics...' : 'Run Audit'}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>

        {audit && (
          <div className="mt-7 space-y-7">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
              <div className="md:col-span-8 rounded-2xl border border-violet-100 bg-white p-5 shadow-[0_14px_34px_rgba(88,28,135,0.07)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Overall conversion score</p>
                    <div className="mt-2 flex items-center gap-3">
                      <div className={`rounded-full border px-3 py-1 text-sm font-semibold ${overallPillClass}`}>
                        {Math.round(audit.summary.overallScore)} / 100
                      </div>
                      <p className="text-sm text-slate-700">
                        {audit.summary.status} • Confidence {formatPercent(audit.summary.overallConfidence * 100)}
                      </p>
                    </div>
                  </div>
                  <a
                    href={audit.input?.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-violet-700 hover:text-violet-800"
                  >
                    Open audited page
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Extraction mode</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{audit.evidence?.extractionMode || '-'}</p>
                  </div>
                  <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Word count</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{audit.evidence?.page?.wordCount || 0}</p>
                  </div>
                  <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Readability</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{audit.evidence?.language?.readability ?? '-'}</p>
                  </div>
                </div>
              </div>

              <div className="md:col-span-4 rounded-2xl border border-violet-200 bg-violet-50/70 p-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-200 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-violet-700">
                  <Sparkles className="h-3.5 w-3.5 text-violet-700" />
                  Top finding
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">
                  {audit.findings?.[0]?.label || 'No major friction finding'}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-700">
                  {audit.findings?.[0]?.evidence || 'No evidence summary was generated for this run.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
              {audit.models?.map((model) => (
                <ModelCard key={model.id} model={model} />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
              <div className="xl:col-span-8">
                <h3 className="mb-3 text-lg font-semibold text-slate-900">Top 5 Experiments</h3>
                <div className="space-y-3">
                  {audit.experiments?.map((item, index) => (
                    <ExperimentRow key={`${item.modelId}-${index}`} item={item} index={index} />
                  ))}
                </div>
              </div>

              <div className="xl:col-span-4">
                <h3 className="mb-3 text-lg font-semibold text-slate-900">Evidence Snapshot</h3>
                <div className="space-y-3 rounded-2xl border border-violet-100 bg-white p-4 shadow-[0_14px_34px_rgba(88,28,135,0.07)]">
                  <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Message evidence</p>
                    <p className="mt-2 text-xs text-slate-800">Title: {audit.evidence?.page?.title || '-'}</p>
                    <p className="mt-1 text-xs text-slate-600">H1: {audit.evidence?.page?.h1 || '-'}</p>
                  </div>

                  <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Structure evidence</p>
                    <div className="mt-2 space-y-1 text-xs text-slate-700">
                      <p>CTAs above fold: {audit.evidence?.structure?.ctasAboveFold ?? 0}</p>
                      <p>Form fields: {audit.evidence?.structure?.formFieldCount ?? 0}</p>
                      <p>Links above fold: {audit.evidence?.structure?.linksAboveFold ?? 0}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">Proof and risk evidence</p>
                    <div className="mt-2 space-y-1 text-xs text-slate-700">
                      <p>Claims detected: {audit.evidence?.language?.claimCount ?? 0}</p>
                      <p>Evidence markers: {(audit.evidence?.language?.evidenceKeywordCount ?? 0) + (audit.evidence?.language?.numericEvidenceCount ?? 0)}</p>
                      <p>Risk reversal cues: {audit.evidence?.language?.riskReversalCount ?? 0}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
