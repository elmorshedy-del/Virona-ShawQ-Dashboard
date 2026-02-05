import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  TrendingUp,
  Target,
  ShoppingBag,
  Activity,
  ArrowUpRight,
  Package,
  Users,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import MetaDemographics from './MetaDemographics';

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
  activation: Sparkles,
  demographics: Users
};



function KpiCard({ label, value, format, hint, formatter, index = 0 }) {
  const displayValue = useMemo(() => {
    if (format === 'percent') return formatPercent(value);
    if (format === 'currency') return formatter ? formatter(value, 0) : formatNumber(value);
    if (format === 'number') return formatNumber(value);
    return value || '—';
  }, [format, value, formatter]);

  const textSizeClass = useMemo(() => {
    const len = String(displayValue).length;
    if (len <= 8) return 'text-2xl';
    if (len <= 12) return 'text-xl';
    if (len <= 20) return 'text-lg';
    if (len <= 30) return 'text-base';
    return 'text-sm';
  }, [displayValue]);

  return (
    <div
      className="group relative flex min-h-[124px] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/80 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.10)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(79,70,229,0.20)]"
      style={{ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}
      title={String(displayValue).length > 20 ? displayValue : undefined}
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl border border-white/10" />
      <div className="absolute left-0 top-0 h-full w-0.5 bg-indigo-500/40 opacity-70 transition-all duration-300 group-hover:w-1 group-hover:opacity-100" />
      <div className="absolute left-0 top-0 h-0.5 w-full bg-indigo-500/30 opacity-70 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="relative z-10 flex h-full flex-col">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">
          {label}
        </div>
        <div className="mt-2 flex flex-1 items-start">
          <div className={`${textSizeClass} font-semibold leading-snug text-gray-900 break-words hyphens-auto`}>
            {displayValue}
          </div>
        </div>
        {hint && (
          <div className="mt-auto pt-2 text-xs text-gray-500 line-clamp-2">
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
  const canInvestigate = Boolean(insight?.target && onInvestigate);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900">{insight.title}</div>
        <div className="text-xs font-semibold text-indigo-600">{insight.impact}</div>
      </div>
      <div className="mt-2 text-sm text-gray-600">{insight.detail}</div>
      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span>{insight.confidence ? `Confidence: ${confidenceLabel(insight.confidence)}` : 'Confidence: —'}</span>
        {canInvestigate ? (
          <button
            type="button"
            onClick={() => onInvestigate?.(insight)}
            className="flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-700"
          >
            View details <ArrowUpRight className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SectionCard({ id, title, subtitle, icon: Icon, children }) {
  return (
    <section id={id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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

function CollapsibleSectionCard({ id, title, subtitle, icon: Icon, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section id={id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
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
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-500 hover:border-gray-300 hover:text-gray-700"
        >
          {open ? 'Hide' : 'Show'}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>
      {open ? <div className="mt-4">{children}</div> : null}
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

export default function CustomerInsightsTab({ data, loading, formatCurrency, store, dateRange }) {
  const kpis = data?.kpis || [];
  const insights = data?.insights || [];
  const sections = data?.sections || {};
  const dataQuality = data?.dataQuality || {};
  const hero = data?.hero || null;
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

  const scrollToSection = (target) => {
    if (!target) return;
    const el = document.getElementById(`ci-${target}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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

      {hero ? (
        <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-indigo-50 via-white to-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Customer brief</div>
              <div className="mt-2 text-base font-semibold text-gray-900">{hero.title}</div>
              <div className="mt-1 text-sm text-gray-600">{hero.subtitle}</div>
            </div>
            <div className="rounded-2xl border border-indigo-100 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{hero.metricLabel}</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">
                {hero.metricFormat === 'percent' ? formatPercent(hero.metricValue) : hero.metricValue}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Confidence: {confidenceLabel(hero.confidence || 0)} · Sample: {formatNumber(hero.sampleSize || 0)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-3 text-sm font-semibold text-gray-700">Actionable Insights</div>
        <div className="grid gap-4 md:grid-cols-3">
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onInvestigate={() => scrollToSection(insight.target)}
            />
          ))}
          {insights.length === 0 && (
            <div className="col-span-full rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
              Insights will appear once enough data accumulates.
            </div>
          )}
        </div>
      </div>

      <CollapsibleSectionCard
        id="ci-metaDemographics"
        title="Meta Demographics"
        subtitle="Age, gender, and country performance signals from Meta."
        icon={sectionIcons.demographics}
      >
	        <MetaDemographics
	          store={store}
	          globalDateRange={dateRange}
	          formatCurrency={formatCurrency}
	        />
      </CollapsibleSectionCard>

      <div className="space-y-4">
        <SectionCard
          id="ci-topProducts"
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
          id="ci-segments"
          title="Geography & Timing"
          subtitle={sections.segments?.summary || 'Where your best buyers come from and when they order'}
          icon={Users}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Coverage</div>
              <div className="mt-2 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">City coverage</span>
                  <span className="font-semibold text-gray-900">{formatPercent(sections.segments?.geo?.cityCoverage)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Country coverage</span>
                  <span className="font-semibold text-gray-900">{formatPercent(sections.segments?.geo?.countryCoverage)}</span>
                </div>
              </div>
              <div className="mt-3 text-xs text-gray-400">
                Geo stats use segments with ≥ {sections.segments?.geo?.minOrders || '—'} orders in this window.
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Peak demand</div>
              <div className="mt-2 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Top day</span>
                  <span className="font-semibold text-gray-900">{sections.segments?.timing?.topDay || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Top hour</span>
                  <span className="font-semibold text-gray-900">
                    {sections.segments?.timing?.topHour != null ? `${sections.segments.timing.topHour}:00` : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Top Cities</div>
              {(sections.segments?.geo?.cities || []).length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-gray-400">
                        <th className="py-2">City</th>
                        <th className="py-2 text-right">Revenue</th>
                        <th className="py-2 text-right">Orders</th>
                        <th className="py-2 text-right">AOV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sections.segments?.geo?.cities || []).map((row) => (
                        <tr key={row.city} className="border-t border-gray-100">
                          <td className="py-2 text-gray-700">{row.city}</td>
                          <td className="py-2 text-right text-gray-700">{formatCurrency(row.revenue, 0)}</td>
                          <td className="py-2 text-right text-gray-700">{formatNumber(row.orders)}</td>
                          <td className="py-2 text-right text-gray-700">{formatCurrency(row.aov, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                  City ranking will appear once city data is present on orders.
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Top Countries</div>
              {(sections.segments?.geo?.countries || []).length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-gray-400">
                        <th className="py-2">Country</th>
                        <th className="py-2 text-right">Revenue</th>
                        <th className="py-2 text-right">Orders</th>
                        <th className="py-2 text-right">AOV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sections.segments?.geo?.countries || []).map((row) => (
                        <tr key={row.code} className="border-t border-gray-100">
                          <td className="py-2 text-gray-700">{row.name}</td>
                          <td className="py-2 text-right text-gray-700">{formatCurrency(row.revenue, 0)}</td>
                          <td className="py-2 text-right text-gray-700">{formatNumber(row.orders)}</td>
                          <td className="py-2 text-right text-gray-700">{formatCurrency(row.aov, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                  Country ranking will appear once country data is present on orders.
                </div>
              )}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          id="ci-cohorts"
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
          id="ci-repeatPaths"
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
          id="ci-discountRefund"
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
          id="ci-bundles"
          title="Bundles"
          subtitle={sections.bundles?.summary || 'Frequently bought together'}
          icon={sectionIcons.bundles}
        >
          {(sections.bundles?.bundles || []).length ? (
            <div className="space-y-3">
              <div className="text-xs text-gray-500">
                Lift compares attach rate vs baseline purchase rate (higher = stronger bundle signal).
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gray-400">
                      <th className="py-2">Bundle</th>
                      <th className="py-2 text-right">Seen</th>
                      <th className="py-2 text-right">Attach</th>
                      <th className="py-2 text-right">Baseline</th>
                      <th className="py-2 text-right">Lift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sections.bundles?.bundles || []).map((row) => (
                      <tr key={`${row.pairKeys?.[0] || row.pair[0]}-${row.pairKeys?.[1] || row.pair[1]}`} className="border-t border-gray-100">
                        <td className="py-2 text-gray-700">
                          {row.pair?.[0]} → {row.pair?.[1]}
                        </td>
                        <td className="py-2 text-right text-gray-700">{formatNumber(row.count)}</td>
                        <td className="py-2 text-right text-gray-700">{formatPercent(row.attachRate)}</td>
                        <td className="py-2 text-right text-gray-700">{formatPercent(row.baselineRate)}</td>
                        <td className="py-2 text-right font-semibold text-gray-900">{Number(row.lift || 0).toFixed(2)}x</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
              Bundle insights need more multi-item orders.
            </div>
          )}
        </SectionCard>

        <SectionCard
          id="ci-activation"
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
