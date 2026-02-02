import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  TrendingUp,
  Target,
  ShoppingBag,
  Activity,
  ArrowUpRight,
  Package
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
  topProducts: Package,
  cohorts: TrendingUp,
  repeat: Activity,
  discount: ShoppingBag,
  bundles: Target,
  activation: Sparkles
};

const kpiThemes = [
  'border-indigo-200/80 from-indigo-50 via-white to-white shadow-indigo-100/80',
  'border-violet-200/80 from-violet-50 via-white to-white shadow-violet-100/80',
  'border-sky-200/80 from-sky-50 via-white to-white shadow-sky-100/80',
  'border-emerald-200/80 from-emerald-50 via-white to-white shadow-emerald-100/80',
  'border-amber-200/80 from-amber-50 via-white to-white shadow-amber-100/80',
  'border-fuchsia-200/80 from-fuchsia-50 via-white to-white shadow-fuchsia-100/80',
  'border-rose-200/80 from-rose-50 via-white to-white shadow-rose-100/80'
];

function KpiCard({ label, value, format, hint, formatter, index = 0 }) {
  const displayValue = useMemo(() => {
    if (format === 'percent') return formatPercent(value);
    if (format === 'currency') return formatter ? formatter(value, 0) : formatNumber(value);
    if (format === 'number') return formatNumber(value);
    return value || '—';
  }, [format, value, formatter]);

  // Unified color scheme with a modern, professional look
  const theme = 'bg-gray-800/90 border-gray-700/60 shadow-2xl shadow-indigo-500/10';

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border p-5 transition-all duration-300 ease-in-out hover:shadow-indigo-500/20 hover:-translate-y-1 ${theme}`}
    >
      <div className="relative z-10 flex flex-col h-full">
        <div className="flex-shrink-0">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</div>
        </div>
        <div className="flex-grow flex items-end mt-4">
          <div className="text-4xl font-bold text-white leading-none tracking-tight">
            {displayValue}
          </div>
        </div>
        {hint && <div className="mt-3 text-sm text-gray-400/80">{hint}</div>}
      </div>
      {/* Subtle glow effect */}
      <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-indigo-600/20 blur-3xl opacity-50" />
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

function SectionCard({ title, subtitle, icon: Icon, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ProductThumbnail({ src, title }) {
  if (src) {
    return (
      <img
        src={src}
        alt={title || 'Product image'}
        className="h-14 w-14 rounded-xl border border-gray-200 object-cover"
        loading="lazy"
      />
    );
  }

  const initial = title ? title.trim().charAt(0).toUpperCase() : 'P';
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-gray-200 bg-gradient-to-br from-indigo-50 to-violet-50 text-sm font-semibold text-indigo-700">
      {initial}
    </div>
  );
}

export default function CustomerInsightsTab({ data, loading, formatCurrency }) {
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
        {kpis.map((kpi, index) => (
          <KpiCard key={kpi.id} {...kpi} formatter={formatCurrency} index={index} />
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
          <div className="mt-2 text-sm font-semibold text-gray-900">Top Products</div>
          <div className="mt-2 text-sm text-gray-600">{sections.topProducts?.summary}</div>
          <div className="mt-4 text-xs font-semibold text-indigo-600">Visual product ranking below</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-gray-400">Understand</div>
          <div className="mt-2 text-sm font-semibold text-gray-900">Cohorts & Paths</div>
          <div className="mt-2 text-sm text-gray-600">{sections.cohorts?.summary}</div>
          <div className="mt-4 text-xs font-semibold text-indigo-600">Retention and next purchase paths</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-gray-400">Activate</div>
          <div className="mt-2 text-sm font-semibold text-gray-900">Audience Actions</div>
          <div className="mt-2 text-sm text-gray-600">{sections.activation?.summary}</div>
          <div className="mt-4 text-xs font-semibold text-indigo-600">Export-ready segments</div>
        </div>
      </div>

      <div className="space-y-4">
        <SectionCard
          title="Top Products"
          subtitle={sections.topProducts?.summary || 'Best products by revenue and order count'}
          icon={sectionIcons.topProducts}
        >
          {(sections.topProducts?.products || []).length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(sections.topProducts?.products || []).map((row) => (
                <div key={row.key} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-3 shadow-sm">
                  <ProductThumbnail src={row.image_url} title={row.title} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900">{row.title}</div>
                    <div className="mt-1 text-xs text-gray-500">{formatNumber(row.orders)} orders · {formatNumber(row.quantity)} units</div>
                  </div>
                  <div className="text-right text-sm font-semibold text-gray-900">{formatCurrency(row.revenue, 0)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
              Product ranking will appear once line-item data is synced.
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Cohorts & LTV"
          subtitle="Retention signal and expected value over time"
          icon={sectionIcons.cohorts}
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
        >
          {(sections.repeatPaths?.paths || []).length ? (
            <div className="space-y-2">
              {(sections.repeatPaths?.paths || []).map((row) => (
                <div key={`${row.from}-${row.to}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <span className="text-gray-600">{row.from} → {row.to}</span>
                  <span className="font-semibold text-gray-900">{row.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
              Repeat paths need more product-level repeat orders.
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Discount & Refund Impact"
          subtitle={sections.discountRefund?.summary || 'Discount reliance and margin pressure'}
          icon={sectionIcons.discount}
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
              <div className="text-xs font-semibold uppercase text-gray-400">Most discount-dependent products</div>
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
        >
          {(sections.bundles?.bundles || []).length ? (
            <div className="space-y-2">
              {(sections.bundles?.bundles || []).map((row) => (
                <div key={`${row.pair[0]}-${row.pair[1]}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <span className="text-gray-600">{row.pair[0]} + {row.pair[1]}</span>
                  <span className="font-semibold text-gray-900">{row.lift.toFixed(2)}x lift</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
              Bundle insights need more multi-item orders.
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Activation"
          subtitle={sections.activation?.summary || 'Create audiences from insights'}
          icon={sectionIcons.activation}
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
