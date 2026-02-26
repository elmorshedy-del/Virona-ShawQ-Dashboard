import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  TrendingUp,
  Target,
  ShoppingBag,
  Activity,
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
import BundleInsightsSection from './BundleInsightsSection';
import CustomerActionPlanner from './CustomerActionPlanner';
import './CustomerInsightsTabMomentum.css';

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
  productMomentum: Activity,
  topProducts: Package,
  cohorts: TrendingUp,
  repeat: Activity,
  discount: ShoppingBag,
  bundles: Target,
  activation: Sparkles,
  demographics: Users
};

const UPPER_METRIC_SLOT_COUNT = 4;
const MOMENTUM_LIVE_WINDOW_DAYS = 7;
const MOMENTUM_MODE_LIVE = 'live';
const MOMENTUM_MODE_SELECTED = 'selected';
const MOMENTUM_LAYER1_RISK_TRIGGERS = new Set([
  'hero_decline',
  'concentration_risk',
  'velocity_stall',
  'discount_dependency',
  'quiet_exit'
]);
const MOMENTUM_LAYER1_OPPORTUNITY_TRIGGERS = new Set([
  'rising_pillar',
  'new_traction'
]);
const MOMENTUM_LAYER2_RISK_EVENTS = new Set([
  'first_hero_slip',
  'leaderboard_reshuffle',
  'sharp_reversal'
]);
const MOMENTUM_LAYER2_OPPORTUNITY_EVENTS = new Set([
  'meteoric_rise',
  'record_period',
  'sustained_streak'
]);

const getMomentumPolarity = (product, mode) => {
  const trigger = String(product?.trigger || '').toLowerCase();
  const event = String(product?.exceptionalEvent || '').toLowerCase();

  if (mode === 'layer1') {
    if (MOMENTUM_LAYER1_RISK_TRIGGERS.has(trigger)) return 'risk';
    if (MOMENTUM_LAYER1_OPPORTUNITY_TRIGGERS.has(trigger)) return 'opportunity';
  } else {
    if (MOMENTUM_LAYER2_RISK_EVENTS.has(event)) return 'risk';
    if (MOMENTUM_LAYER2_OPPORTUNITY_EVENTS.has(event)) return 'opportunity';
  }

  const impact = Number(product?.facts?.revenueImpact ?? product?.facts?.revenueDelta);
  if (Number.isFinite(impact)) return impact < 0 ? 'risk' : 'opportunity';
  return 'opportunity';
};

const getMomentumSeverityLabel = (severity, polarity, mode, hasTrigger) => {
  if (mode === 'layer2' && !hasTrigger) {
    return polarity === 'risk' ? 'Risk' : 'Opportunity';
  }

  const cleanSeverity = String(severity || '').toLowerCase();
  const prefix = cleanSeverity === 'high'
    ? 'High'
    : cleanSeverity === 'medium'
      ? 'Medium'
      : cleanSeverity === 'low'
        ? 'Low'
        : '';
  if (!prefix) return polarity === 'risk' ? 'Risk' : 'Opportunity';
  return `${prefix} ${polarity === 'risk' ? 'risk' : 'opportunity'}`;
};

const buildInsightsParams = (store, range) => {
  const params = new URLSearchParams();
  params.set('store', String(store || 'shawq'));
  if (!range || typeof range !== 'object') {
    params.set('days', String(MOMENTUM_LIVE_WINDOW_DAYS));
    return params;
  }

  if (range.type === 'custom' && range.start && range.end) {
    params.set('startDate', range.start);
    params.set('endDate', range.end);
    return params;
  }

  if (range.type === 'yesterday') {
    params.set('yesterday', '1');
    return params;
  }

  const value = Number(range.value);
  if (range.type && Number.isFinite(value) && value > 0) {
    params.set(range.type, String(value));
    return params;
  }

  params.set('days', String(MOMENTUM_LIVE_WINDOW_DAYS));
  return params;
};

const formatSignedNumber = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  const rounded = Math.round(value);
  const prefix = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${prefix}${Math.abs(rounded).toLocaleString()}`;
};

const formatSharePoints = (value) => {
  if (value == null || Number.isNaN(value)) return '—';
  const points = value * 100;
  const prefix = points > 0 ? '+' : points < 0 ? '-' : '';
  return `${prefix}${Math.abs(points).toFixed(1)}pp`;
};

const getUpperMetricById = (kpis, id) => (kpis || []).find((row) => row?.id === id) || null;

const resolveUpperMetrics = (kpis = []) => {
  const ordered = [
    getUpperMetricById(kpis, 'best-segment'),
    getUpperMetricById(kpis, 'ltv90'),
    getUpperMetricById(kpis, 'repeat-rate'),
    getUpperMetricById(kpis, 'discount-reliance')
  ];

  const fallback = kpis.filter((row) => !ordered.includes(row));
  const filled = [...ordered];
  while (filled.length < UPPER_METRIC_SLOT_COUNT && fallback.length) {
    filled.push(fallback.shift());
  }
  while (filled.length < UPPER_METRIC_SLOT_COUNT) {
    filled.push(null);
  }
  return filled.slice(0, UPPER_METRIC_SLOT_COUNT);
};

const resolveTopBundle = (sections, kpis = []) => {
  const topPair = sections?.bundles?.bundles?.[0]?.pair;
  if (Array.isArray(topPair) && topPair.length >= 2) {
    return { from: String(topPair[0]), to: String(topPair[1]) };
  }
  const topBundleKpi = getUpperMetricById(kpis, 'top-bundle')?.value;
  if (topBundleKpi) {
    const parts = String(topBundleKpi).split(/->|→/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { from: parts[0], to: parts[1] };
    }
  }
  return null;
};

const formatUpperMetricValue = (metric, formatCurrency) => {
  if (!metric) return '—';
  if (metric.format === 'percent') return formatPercent(metric.value);
  if (metric.format === 'currency') return formatCurrency ? formatCurrency(metric.value, 0) : formatNumber(metric.value);
  if (metric.format === 'number') return formatNumber(metric.value);
  if (metric.value == null) return '—';
  return String(metric.value);
};

function UpperMetricCard({ metric, formatCurrency }) {
  const value = formatUpperMetricValue(metric, formatCurrency);
  return (
    <div className="card ci-card-metric">
      <div className="card-label">{metric?.label || 'Metric'}</div>
      <div className="metric-huge-value">{value}</div>
      {metric?.hint ? <div className="metric-subtitle">{metric.hint}</div> : null}
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

function humanizeTrigger(value) {
  if (!value) return 'N/A';
  return String(value).replace(/_/g, ' ');
}

function Sparkline({ points, polarity }) {
  if (!Array.isArray(points) || points.length < 2) {
    return <div className="pm-sparkline-empty">No trend line yet</div>;
  }
  return (
    <div className={`pm-sparkline ${polarity}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <Line
            type="monotone"
            dataKey="orders"
            strokeWidth={2.5}
            stroke="var(--pm-spark-stroke)"
            dot={false}
            style={{ filter: 'var(--pm-spark-shadow)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SignalBadge({ signal }) {
  if (!signal) return null;
  const key = String(signal).toLowerCase();
  return (
    <span className={`pm-signal-badge pm-signal-${key}`}>
      {signal}
    </span>
  );
}

function MomentumCard({ product, mode }) {
  const hasTrigger = Boolean(product?.trigger);
  const severity = product?.assessment?.severity || null;
  const polarity = getMomentumPolarity(product, mode);
  const severityLabel = getMomentumSeverityLabel(severity, polarity, mode, hasTrigger);
  const headline = product?.assessment?.headline || product?.title || 'Product signal';
  const action = product?.assessment?.action || '';
  const triggerText = humanizeTrigger(mode === 'layer1' ? product?.trigger : product?.exceptionalEvent);
  const impactClass = polarity === 'risk' ? 'pm-impact-risk' : 'pm-impact-opportunity';

  return (
    <article className={`pm-card ${polarity} pm-severity-${severity || 'medium'}`}>
      <div className="pm-card-header">
        <div className="pm-card-title-wrap">
          <h4 className="pm-card-title">{headline}</h4>
          <div className="pm-card-meta">
            <span className="pm-trigger">{triggerText}</span>
            <SignalBadge signal={product?.statistical?.signal} />
          </div>
        </div>
        <span className={`pm-severity-pill ${!hasTrigger ? `binary ${polarity}` : ''}`}>
          {severityLabel}
        </span>
      </div>

      <div className="pm-card-body">
        <div className="pm-card-facts">
          <div className="pm-fact-row">
            <span>Revenue share</span>
            <strong>{formatPercent(product?.facts?.revenueShare)}</strong>
          </div>
          <div className="pm-fact-row">
            <span>Share delta</span>
            <strong>{formatSharePoints(product?.facts?.shareDelta)}</strong>
          </div>
          <div className="pm-fact-row">
            <span>Revenue impact</span>
            <strong className={impactClass}>{formatSignedNumber(product?.facts?.revenueImpact)}</strong>
          </div>
        </div>
        <Sparkline points={product?.sparkline || []} polarity={polarity} />
      </div>

      {action ? <p className="pm-card-action">{action}</p> : null}
    </article>
  );
}

function ProductMomentumSection({ section, store, dateRange }) {
  const [showMethodology, setShowMethodology] = useState(false);
  const [layer1Mode, setLayer1Mode] = useState(MOMENTUM_MODE_LIVE);
  const [liveSection, setLiveSection] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(false);

  useEffect(() => {
    const params = buildInsightsParams(store, { type: 'days', value: MOMENTUM_LIVE_WINDOW_DAYS });
    const controller = new AbortController();
    let active = true;

    const loadLiveLayer = async () => {
      setLiveLoading(true);
      setLiveError(false);
      try {
        const response = await fetch(`/api/customer-insights?${params.toString()}`, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (!active) return;
        setLiveSection(payload?.data?.sections?.productMomentum || null);
      } catch (error) {
        if (!active || error?.name === 'AbortError') return;
        setLiveError(true);
        setLiveSection(null);
      } finally {
        if (active) setLiveLoading(false);
      }
    };

    if (store) {
      loadLiveLayer();
    }
    return () => {
      active = false;
      controller.abort();
    };
  }, [store]);

  const layer1Selected = (section?.products || []).filter((row) => row?.trigger);
  const layer1Live = (liveSection?.products || []).filter((row) => row?.trigger);
  const layer1 = layer1Mode === MOMENTUM_MODE_LIVE && layer1Live.length ? layer1Live : layer1Selected;
  const layer2 = (section?.products || []).filter((row) => row?.exceptionalEvent);
  const thresholds = (layer1Mode === MOMENTUM_MODE_LIVE ? liveSection?.methodology : section?.methodology)?.thresholds || section?.methodology?.thresholds || {};
  const activeSummary = layer1Mode === MOMENTUM_MODE_LIVE ? (liveSection?.summary || section?.summary) : section?.summary;
  const selectedLabel = dateRange?.type === 'custom' ? 'Selected Range' : 'Selected Range';

  return (
    <div className="pm-root">
      <section className="pm-panel pm-top">
        <div>
          <div className="pm-title">Product Momentum & Watch</div>
          <div className="pm-sub">Live monitor + review mode, with unified risk/opportunity color logic.</div>
        </div>
        <div className="pm-toggles">
          <button
            type="button"
            className={`pm-btn ${layer1Mode === MOMENTUM_MODE_LIVE ? 'active' : ''}`}
            onClick={() => setLayer1Mode(MOMENTUM_MODE_LIVE)}
          >
            Layer 1: Live ({MOMENTUM_LIVE_WINDOW_DAYS}d)
          </button>
          <button
            type="button"
            className={`pm-btn ${layer1Mode === MOMENTUM_MODE_SELECTED ? 'active' : ''}`}
            onClick={() => setLayer1Mode(MOMENTUM_MODE_SELECTED)}
          >
            Layer 1: {selectedLabel}
          </button>
        </div>
      </section>

      <div className="pm-summary">{activeSummary || 'No product momentum triggers crossed thresholds in this window.'}</div>
      <section className="pm-panel pm-grid">
        <div className="pm-layer">
          <div className="pm-layer-head">
            <h4>Layer 1: Business triggers</h4>
            <span>
              {layer1Mode === MOMENTUM_MODE_LIVE && liveLoading
                ? 'Loading...'
                : `${layer1.length} active`}
            </span>
          </div>
          {layer1.length ? (
            <div className="pm-list">
              {layer1.map((product, index) => (
                <MomentumCard
                  key={`layer1-${product?.key || 'product'}-${product?.trigger || index}`}
                  product={product}
                  mode="layer1"
                />
              ))}
            </div>
          ) : (
            <div className="pm-empty">No Layer 1 trigger is active in this window.</div>
          )}
          {layer1Mode === MOMENTUM_MODE_LIVE && liveError ? (
            <div className="pm-note">Live 7d data could not be loaded, showing selected range instead.</div>
          ) : null}
        </div>

        <div className="pm-layer">
          <div className="pm-layer-head">
            <h4>Layer 2: Exceptional events</h4>
            <span>{layer2.length} detected</span>
          </div>
          {layer2.length ? (
            <div className="pm-list">
              {layer2.map((product, index) => (
                <MomentumCard
                  key={`layer2-${product?.key || 'product'}-${product?.exceptionalEvent || index}`}
                  product={product}
                  mode="layer2"
                />
              ))}
            </div>
          ) : (
            <div className="pm-empty">No Layer 2 event is active in this window.</div>
          )}
        </div>
      </section>

      <div className="pm-methodology">
        <button
          type="button"
          onClick={() => setShowMethodology((prev) => !prev)}
          className="pm-methodology-toggle"
        >
          {showMethodology ? 'Hide methodology' : 'Show methodology'}
        </button>

        {showMethodology ? (
          <div className="pm-methodology-body">
            <p>{section?.methodology?.description || 'Methodology details are not available.'}</p>
            <div className="pm-threshold-grid">
              {Object.entries(thresholds).map(([key, value]) => (
                <div key={key} className="pm-threshold-row">
                  <span>{humanizeTrigger(key)}</span>
                  <strong>{typeof value === 'number' ? value.toFixed(2) : String(value)}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CustomerInsightsTab({ data, loading, formatCurrency, store, dateRange }) {
  const kpis = data?.kpis || [];
  const sections = data?.sections || {};
  const dataQuality = data?.dataQuality || {};
  const hero = data?.hero || null;
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const upperMetrics = useMemo(() => resolveUpperMetrics(kpis), [kpis]);
  const topBundle = useMemo(() => resolveTopBundle(sections, kpis), [sections, kpis]);
  const heroMetricValue = useMemo(() => {
    if (!hero) return '—';
    if (hero.metricFormat === 'percent') return formatPercent(hero.metricValue);
    if (hero.metricFormat === 'currency') return formatCurrency(hero.metricValue, 0);
    return hero.metricValue ?? '—';
  }, [hero, formatCurrency]);

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
    <div className="space-y-6 ci-premium">
      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-2xl border border-gray-200 bg-white/90 px-4 py-3 text-sm text-gray-900 shadow-lg backdrop-blur">
          {toast}
        </div>
      ) : null}

      <section className="ci-upper">
        <div className="dashboard-container">
          <div className="row-1">
            <div className="card card-hero">
              <div className="hero-left">
                <div className="card-label">Customer Brief</div>
                <div className="hero-title">{hero?.title || 'Customer brief will appear once enough data is available.'}</div>
                <div className="hero-subtitle">{hero?.subtitle || 'Insights update when line-item and customer data are synced.'}</div>
              </div>
              <div className="hero-right">
                <div className="card-label">{hero?.metricLabel || 'Revenue Share'}</div>
                <div className="metric-huge-value">{heroMetricValue}</div>
                <div className="confidence-text">
                  {confidenceLabel(hero?.confidence || 0)} · Sample: {formatNumber(hero?.sampleSize || 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="row-2">
            {upperMetrics.map((metric, index) => (
              <UpperMetricCard key={metric?.id || `upper-metric-${index}`} metric={metric} formatCurrency={formatCurrency} />
            ))}
          </div>

          <div className="row-3">
            <div className="card card-bundle">
              <div className="card-label">Top Bundle</div>
              <div className="bundle-text">
                {topBundle ? (
                  <>
                    {topBundle.from} <span className="arrow-icon">→</span> {topBundle.to}
                  </>
                ) : (
                  'Bundle signal will appear once enough pair evidence is detected.'
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

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
          id="ci-productMomentum"
          title="Product Momentum & Watch"
          subtitle={sections.productMomentum?.summary || 'Business-grade product momentum monitoring'}
          icon={sectionIcons.productMomentum}
        >
          <ProductMomentumSection section={sections.productMomentum || {}} store={store} dateRange={dateRange} />
        </SectionCard>

        <SectionCard
          id="ci-topProducts"
          title="Top Products"
          subtitle={sections.topProducts?.summary || 'Best products by revenue and order count'}
          icon={sectionIcons.topProducts}
        >
          {(sections.topProducts?.products || []).length ? (
            <div className="space-y-5">
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
              <CustomerActionPlanner data={data} onOpenSection={scrollToSection} embedded />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                Product ranking will appear once line-item data is synced.
              </div>
              <CustomerActionPlanner data={data} onOpenSection={scrollToSection} embedded />
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
          <BundleInsightsSection
            section={sections.bundles}
            window={data?.window}
            eligibleOrders={dataQuality.orders}
            formatCurrency={formatCurrency}
          />
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
