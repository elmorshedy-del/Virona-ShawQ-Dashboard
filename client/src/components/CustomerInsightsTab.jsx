import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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



function KpiCard({ label, value, format, hint, formatter, index = 0 }) {
  const displayValue = useMemo(() => {
    if (format === 'percent') return formatPercent(value);
    if (format === 'currency') return formatter ? formatter(value, 0) : formatNumber(value);
    if (format === 'number') return formatNumber(value);
    return value || '—';
  }, [format, value, formatter]);

  const valueRef = useRef(null);

  useLayoutEffect(() => {
    const el = valueRef.current;
    if (!el) return;

    const baseSize = parseFloat(el.dataset.baseSize || '0') || parseFloat(getComputedStyle(el).fontSize || '0');
    if (baseSize) el.style.fontSize = `${baseSize}px`;

    let currentSize = baseSize || parseFloat(getComputedStyle(el).fontSize || '0');
    const minSize = 18;
    let guard = 10;

    while (el.scrollHeight > el.clientHeight && currentSize > minSize && guard > 0) {
      currentSize -= 2;
      el.style.fontSize = `${currentSize}px`;
      guard -= 1;
    }

    el.dataset.baseSize = `${baseSize || currentSize}`;
  }, [displayValue, label]);

  return (
    <div
      className="group relative min-h-[124px] overflow-hidden rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.10)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(79,70,229,0.20)]"
      style={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl border border-white/10" />
      <div className="absolute left-0 top-0 h-full w-0.5 bg-indigo-500/40 opacity-70 transition-all duration-300 group-hover:w-1 group-hover:opacity-100" />
      <div className="absolute left-0 top-0 h-0.5 w-full bg-indigo-500/30 opacity-70 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative z-10 flex h-full flex-col">
        <div
          className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-700"
          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'normal', overflowWrap: 'normal', hyphens: 'none' }}
          title={label}
        >
          {label}
        </div>
        <div className="mt-2 flex-grow">
          <div className="min-h-[3.2rem] text-[20px] sm:text-[22px] md:text-[24px] font-semibold leading-tight text-gray-900 line-clamp-2 whitespace-normal break-words">
            {displayValue}
          </div>
        </div>
        {hint && (
          <div className="mt-2 text-xs text-gray-600/90 line-clamp-2 whitespace-normal break-words">
            {hint}
          </div>
        )}
      </div>

      <div
        className="pointer-events-none absolute -inset-3 rounded-[28px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ boxShadow: '0 0 24px rgba(79,70,229,0.18)' }}
      />
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
                    <div className="line-clamp-2 text-sm font-semibold text-gray-900 whitespace-normal break-words">{row.title}</div>
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
