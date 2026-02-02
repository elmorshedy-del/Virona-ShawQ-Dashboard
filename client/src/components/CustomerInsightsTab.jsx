import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Users,
  TrendingUp,
  Target,
  ShoppingBag,
  Activity,
  ChevronDown,
  ChevronUp,
  ArrowUpRight
} from 'lucide-react';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const formatPercent = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
};

const formatNumber = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString();
};

const confidenceLabel = (value) => {
  if (value >= 0.75) return 'Strong';
  if (value >= 0.5) return 'Directional';
  return 'Light';
};

const sectionIcons = {
  segments: Users,
  cohorts: TrendingUp,
  repeat: Activity,
  discount: ShoppingBag,
  bundles: Target,
  activation: Sparkles
};

function KpiCard({ label, value, format, hint, formatter }) {
  const displayValue = useMemo(() => {
    if (format === 'percent') return formatPercent(value);
    if (format === 'currency') return formatter ? formatter(value, 0) : formatNumber(value);
    if (format === 'number') return formatNumber(value);
    return value || '—';
  }, [format, value, formatter]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-lg font-semibold text-gray-900">{displayValue}</div>
      {hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

function InsightCard({ insight, onInvestigate }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900">{insight.title}</div>
        <div className="text-xs font-semibold text-indigo-600">{insight.impact}</div>
      </div>
      <div className="mt-2 text-sm text-gray-600">{insight.detail}</div>
      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span>{insight.confidence ? `Confidence: ${confidenceLabel(insight.confidence)}` : 'Confidence: —'}</span>
        <button
          type="button"
          onClick={() => onInvestigate?.(insight)}
          className="flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-700"
        >
          Investigate <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, icon: Icon, children, expanded, onToggle }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1 text-xs font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
        >
          {expanded ? 'Collapse' : 'Expand'}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>
      <div className={`mt-4 ${expanded ? 'block' : 'hidden'}`}>{children}</div>
    </section>
  );
}

export default function CustomerInsightsTab({ data, loading, formatCurrency }) {
  const [expanded, setExpanded] = useState({
    segments: true,
    cohorts: false,
    repeat: false,
    discount: false,
    bundles: false,
    activation: false
  });

  const hero = data?.hero;
  const kpis = data?.kpis || [];
  const insights = data?.insights || [];
  const sections = data?.sections || {};
  const dataQuality = data?.dataQuality || {};
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = (message) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <div className="space-y-6">
      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-2xl border border-gray-200 bg-white/90 px-4 py-3 text-sm text-gray-900 shadow-lg backdrop-blur">
          {toast}
        </div>
      ) : null}
      <div className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50 px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-500">
              <Sparkles className="h-4 w-4" />
              Customer Insights
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-gray-900">{hero?.title || 'Insights are loading'}</h2>
            <p className="mt-2 text-sm text-gray-600">{hero?.subtitle}</p>
          </div>
          <div className="rounded-2xl border border-indigo-100 bg-white/70 px-4 py-3">
            <div className="text-xs font-medium uppercase text-gray-400">{hero?.metricLabel || 'Segment lift'}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">
              {hero?.metricFormat === 'percent' ? formatPercent(hero?.metricValue) : formatNumber(hero?.metricValue)}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Confidence: {confidenceLabel(hero?.confidence || 0)} · n={hero?.sampleSize || 0}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} {...kpi} formatter={formatCurrency} />
        ))}
      </div>

      <div>
        <div className="mb-3 text-sm font-semibold text-gray-700">Top Insights</div>
        <div className="grid gap-4 md:grid-cols-3">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onInvestigate={() => showToast('Investigate is coming soon — this will open the underlying orders, segments, and recommended next actions.')}
            />
          ))}
          {insights.length === 0 && (
            <div className="col-span-full rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
              Insights will appear once enough data accumulates.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-gray-400">Discover</div>
          <div className="mt-2 text-sm font-semibold text-gray-900">Segment Explorer</div>
          <div className="mt-2 text-sm text-gray-600">{sections.segments?.summary}</div>
          <button
            onClick={() => setExpanded((prev) => ({ ...prev, segments: true }))}
            className="mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
          >
            View segments
          </button>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-gray-400">Understand</div>
          <div className="mt-2 text-sm font-semibold text-gray-900">Cohorts & Paths</div>
          <div className="mt-2 text-sm text-gray-600">{sections.cohorts?.summary}</div>
          <button
            onClick={() => setExpanded((prev) => ({ ...prev, cohorts: true, repeat: true }))}
            className="mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Explore cohorts
          </button>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-gray-400">Activate</div>
          <div className="mt-2 text-sm font-semibold text-gray-900">Audience Actions</div>
          <div className="mt-2 text-sm text-gray-600">{sections.activation?.summary}</div>
          <button
            onClick={() => setExpanded((prev) => ({ ...prev, activation: true }))}
            className="mt-4 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Open activation
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <SectionCard
          title="Segments"
          subtitle={sections.segments?.summary || 'Segment rankings by geo and timing'}
          icon={sectionIcons.segments}
          expanded={expanded.segments}
          onToggle={() => setExpanded((prev) => ({ ...prev, segments: !prev.segments }))}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-gray-400">Top Countries</div>
              <div className="mt-2 space-y-2">
                {(sections.segments?.countries || []).map((row) => (
                  <div key={row.code} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <div className="text-gray-700">{row.name}</div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {formatNumber(row.orders)} orders · {formatCurrency(row.aov, 0)} AOV
                      </div>
                    </div>
                    <div className="text-right font-semibold text-gray-900">{formatCurrency(row.revenue, 0)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-gray-400">Top Cities</div>
              <div className="mt-2 space-y-2">
                {(sections.segments?.cities || []).map((row) => (
                  <div key={row.city} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <div className="text-gray-700">{row.city}</div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {formatNumber(row.orders)} orders · {formatCurrency(row.aov, 0)} AOV
                      </div>
                    </div>
                    <div className="text-right font-semibold text-gray-900">{formatCurrency(row.revenue, 0)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Cohorts & LTV"
          subtitle="Retention signal and expected value over time"
          icon={sectionIcons.cohorts}
          expanded={expanded.cohorts}
          onToggle={() => setExpanded((prev) => ({ ...prev, cohorts: !prev.cohorts }))}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-48 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sections.cohorts?.curve || []}>
                  <XAxis dataKey="horizon" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={40} />
                  <Tooltip formatter={(value) => formatCurrency(value, 0)} />
                  <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 text-sm">
              {(sections.cohorts?.cohorts || []).map((row) => (
                <div key={row.cohort} className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-3 py-2">
                  <span className="text-gray-600">{row.cohort}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(row.ltv90, 0)}</span>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Repeat Paths"
          subtitle={sections.repeatPaths?.summary || 'Next-purchase transitions'}
          icon={sectionIcons.repeat}
          expanded={expanded.repeat}
          onToggle={() => setExpanded((prev) => ({ ...prev, repeat: !prev.repeat }))}
        >
          <div className="space-y-2">
            {(sections.repeatPaths?.paths || []).map((row) => (
              <div key={`${row.from}-${row.to}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                <span className="text-gray-600">{row.from} → {row.to}</span>
                <span className="font-semibold text-gray-900">{row.count}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Discount & Refund Impact"
          subtitle={sections.discountRefund?.summary || 'Discount reliance and margin pressure'}
          icon={sectionIcons.discount}
          expanded={expanded.discount}
          onToggle={() => setExpanded((prev) => ({ ...prev, discount: !prev.discount }))}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Discount order rate</span>
                <span className="font-semibold text-gray-900">{formatPercent(sections.discountRefund?.metrics?.discountOrderRate)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Discount revenue share</span>
                <span className="font-semibold text-gray-900">{formatPercent(sections.discountRefund?.metrics?.discountRevenueShare)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Avg discount rate</span>
                <span className="font-semibold text-gray-900">{formatPercent(sections.discountRefund?.metrics?.avgDiscountRate)}</span>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-gray-400">Most discount-dependent SKUs</div>
              <div className="mt-2 space-y-2 text-sm">
                {(sections.discountRefund?.discountSkus || []).map((row) => (
                  <div key={row.title} className="flex items-center justify-between">
                    <span className="text-gray-600">{row.title}</span>
                    <span className="font-semibold text-gray-900">{formatPercent(row.discountShare)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Bundles"
          subtitle={sections.bundles?.summary || 'Frequently bought together'}
          icon={sectionIcons.bundles}
          expanded={expanded.bundles}
          onToggle={() => setExpanded((prev) => ({ ...prev, bundles: !prev.bundles }))}
        >
          <div className="space-y-2">
            {(sections.bundles?.bundles || []).map((row) => (
              <div key={`${row.pair[0]}-${row.pair[1]}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                <span className="text-gray-600">{row.pair[0]} + {row.pair[1]}</span>
                <span className="font-semibold text-gray-900">{row.lift.toFixed(2)}x lift</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Activation"
          subtitle={sections.activation?.summary || 'Create audiences from insights'}
          icon={sectionIcons.activation}
          expanded={expanded.activation}
          onToggle={() => setExpanded((prev) => ({ ...prev, activation: !prev.activation }))}
        >
          <div className="space-y-3">
            {(sections.activation?.readySegments || []).map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2 text-sm">
                <div>
                  <div className="font-semibold text-gray-900">{row.label}</div>
                  <div className="text-xs text-gray-400">{row.type} · {formatNumber(row.size)} signals</div>
                </div>
                <button
                  type="button"
                  onClick={() => showToast('Create audience is coming soon — this will export the segment into Meta as a Custom Audience / Lookalike seed.')}
                  className="rounded-lg border border-indigo-200 px-3 py-1 text-xs font-semibold text-indigo-600 hover:border-indigo-300"
                >
                  Create audience
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${loading ? 'bg-yellow-400' : 'bg-green-400'}`} />
          <span>Data freshness: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : '—'}</span>
        </div>
        {dataQuality.notes?.length ? (
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {dataQuality.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
