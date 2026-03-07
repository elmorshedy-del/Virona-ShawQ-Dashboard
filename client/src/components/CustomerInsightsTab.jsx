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
const TOP_PRODUCTS_VISIBLE_COUNT = 9;
const TOP_PRODUCTS_COMMENTARY_COUNT = 5;
const TOP_PRODUCTS_NAME_PREVIEW_LIMIT = 2;
const TOP_PRODUCTS_DEFAULT_WINDOW_LABEL = 'Rolling last 30 days';
const TOP_PRODUCTS_DEFAULT_COMPARISON_LABEL = 'Previous 30 days';
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

const buildInsightsParams = (store, range) => {
  const params = new URLSearchParams();
  if (store) {
    params.set('store', String(store).trim().toLowerCase());
  }
  if (range?.startDate && range?.endDate) {
    params.set('startDate', String(range.startDate));
    params.set('endDate', String(range.endDate));
  } else if (range?.type && range.value != null) {
    params.set(range.type, String(range.value));
  }
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

const ISO_MONTH_SHORT = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]);

const normalizeIsoDate = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length >= 10 ? text.slice(0, 10) : text;
};

const formatIsoDateShort = (isoDate) => {
  const normalized = normalizeIsoDate(isoDate);
  if (!normalized) return null;
  const parts = normalized.split('-');
  if (parts.length !== 3) return normalized;
  const monthIndex = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  const monthLabel = ISO_MONTH_SHORT[monthIndex];
  if (!monthLabel || !Number.isFinite(day) || day <= 0) return normalized;
  return `${monthLabel} ${day}`;
};

const resolveSparklineWindow = (sparkline) => {
  if (!Array.isArray(sparkline) || !sparkline.length) return null;
  let minDate = null;
  let maxDate = null;

  sparkline.forEach((point) => {
    const isoDate = normalizeIsoDate(point?.date);
    if (!isoDate) return;
    if (!minDate || isoDate < minDate) minDate = isoDate;
    if (!maxDate || isoDate > maxDate) maxDate = isoDate;
  });

  if (!minDate && !maxDate) return null;
  return { startDate: minDate, endDate: maxDate };
};

const formatSparklineLookback = (sparkline) => {
  const window = resolveSparklineWindow(sparkline);
  if (!window?.startDate) return null;
  const startLabel = formatIsoDateShort(window.startDate) || window.startDate;
  const endLabel = window.endDate ? (formatIsoDateShort(window.endDate) || window.endDate) : null;
  if (!endLabel || window.startDate === window.endDate) return startLabel;
  return `${startLabel} → ${endLabel}`;
};

const getProductRowKey = (row, index = 0) => (
  row?.key
  || row?.product_id
  || row?.variant_id
  || row?.sku
  || row?.title
  || `product-row-${index}`
);

const getProductRowTitle = (row) => (
  row?.title
  || row?.cache_title
  || row?.sku
  || 'Untitled product'
);

const parseHeroTitle = (title, fallbackHeadline) => {
  const fallback = fallbackHeadline && fallbackHeadline !== 'Location signal building'
    ? String(fallbackHeadline)
    : 'Customer insight signal';
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) {
    return {
      kicker: 'Revenue-leading customer pocket',
      headline: fallback
    };
  }

  const separatorIndex = text.indexOf(':');
  if (separatorIndex > 0 && separatorIndex < text.length - 1) {
    return {
      kicker: text.slice(0, separatorIndex).trim(),
      headline: text.slice(separatorIndex + 1).trim()
    };
  }

  return {
    kicker: 'Customer brief',
    headline: text
  };
};

const buildHeroStory = (subtitle, fallbackHeadline) => {
  const text = typeof subtitle === 'string' ? subtitle.trim() : '';
  if (text) return text;
  if (fallbackHeadline && fallbackHeadline !== 'Location signal building') {
    return `${fallbackHeadline} is leading this window based on current customer revenue distribution.`;
  }
  return 'Insights update once customer, location, and product data are fully synced.';
};

const formatTitlePreview = (titles) => {
  const cleanTitles = (titles || []).filter(Boolean);
  if (!cleanTitles.length) return 'No products';
  if (cleanTitles.length <= TOP_PRODUCTS_NAME_PREVIEW_LIMIT) {
    return cleanTitles.join(' + ');
  }
  const visible = cleanTitles.slice(0, TOP_PRODUCTS_NAME_PREVIEW_LIMIT);
  return `${visible.join(' + ')} +${cleanTitles.length - visible.length}`;
};

const formatTopProductMetricSnippet = (row, formatCurrency) => {
  const orders = formatNumber(row?.orders);
  const revenue = formatCurrency ? formatCurrency(row?.revenue || 0, 0) : formatNumber(row?.revenue || 0);
  return `${orders} orders · ${revenue}`;
};

const buildTopProductsCommentary = (currentProducts, previousProducts, formatCurrency) => {
  const currentTop = Array.isArray(currentProducts) ? currentProducts.slice(0, TOP_PRODUCTS_COMMENTARY_COUNT) : [];
  const previousTop = Array.isArray(previousProducts) ? previousProducts.slice(0, TOP_PRODUCTS_COMMENTARY_COUNT) : [];
  const currentKeys = new Set(currentTop.map((row, index) => getProductRowKey(row, index)));
  const previousKeys = new Set(previousTop.map((row, index) => getProductRowKey(row, index)));
  const currentLeader = currentTop[0] || null;
  const previousLeader = previousTop[0] || null;
  const entered = currentTop.filter((row, index) => !previousKeys.has(getProductRowKey(row, index)));
  const exited = previousTop.filter((row, index) => !currentKeys.has(getProductRowKey(row, index)));
  const retained = currentTop.filter((row, index) => previousKeys.has(getProductRowKey(row, index)));
  const notes = [];

  if (currentLeader) {
    const currentLeaderKey = getProductRowKey(currentLeader, 0);
    const previousLeaderKey = previousLeader ? getProductRowKey(previousLeader, 0) : null;
    notes.push(
      currentLeaderKey === previousLeaderKey
        ? {
          tone: 'steady',
          label: 'Leader held',
          title: getProductRowTitle(currentLeader),
          text: `${formatTopProductMetricSnippet(currentLeader, formatCurrency)}. Still leading the rolling leaderboard.`
        }
        : {
          tone: 'fresh',
          label: 'New #1',
          title: getProductRowTitle(currentLeader),
          text: previousLeader
            ? `${formatTopProductMetricSnippet(currentLeader, formatCurrency)}. Overtook ${getProductRowTitle(previousLeader)}.`
            : `${formatTopProductMetricSnippet(currentLeader, formatCurrency)}.`
        }
    );
  }

  if (entered.length) {
    notes.push({
      tone: 'fresh',
      label: `${entered.length} entered top 5`,
      title: formatTitlePreview(entered.map((row) => getProductRowTitle(row))),
      text: 'New arrivals inside the current rolling 30-day top five.'
    });
  }

  if (retained.length) {
    notes.push({
      tone: 'steady',
      label: `${retained.length} still holding`,
      title: formatTitlePreview(retained.map((row) => getProductRowTitle(row))),
      text: retained.length === TOP_PRODUCTS_COMMENTARY_COUNT
        ? 'Every product from the prior top five kept its place in the current rolling window.'
        : 'These products kept a top-five position from the prior rolling window.'
    });
  } else if (exited.length) {
    notes.push({
      tone: 'fade',
      label: `${exited.length} exited top 5`,
      title: formatTitlePreview(exited.map((row) => getProductRowTitle(row))),
      text: 'These products were in the previous rolling window but not the current one.'
    });
  }

  if (!notes.length) {
    notes.push({
      tone: 'steady',
      label: 'Stable top 5',
      title: 'No leaderboard reshuffle',
      text: 'The same products are holding the rolling top five versus the prior window.'
    });
  }

  return notes.slice(0, 3);
};

const getUpperMetricById = (kpis, id) => (kpis || []).find((row) => row?.id === id) || null;

const resolveUpperMetrics = (kpis = []) => {
  const ordered = [
    getUpperMetricById(kpis, 'ltv90'),
    getUpperMetricById(kpis, 'repeat-rate'),
    getUpperMetricById(kpis, 'discount-reliance'),
    getUpperMetricById(kpis, 'top-repeat') || getUpperMetricById(kpis, 'best-segment')
  ].filter(Boolean);

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

function HeroSpotlightMetric({ metric, formatCurrency }) {
  const value = formatUpperMetricValue(metric, formatCurrency);
  return (
    <div className={`ci-hero-kpi-item ${metric?.format === 'text' ? 'is-text-item' : ''}`.trim()}>
      <div className="ci-hero-kpi-label">{metric?.label || 'Metric'}</div>
      <div className={`ci-hero-kpi-value ${metric?.format === 'text' ? 'is-text' : ''}`.trim()}>{value}</div>
      {metric?.hint ? <div className="ci-hero-kpi-hint">{metric.hint}</div> : null}
    </div>
  );
}

function HeroHighlightItem({ label, value, detail, tone = '' }) {
  return (
    <div className={`ci-hero-highlight-item ${tone}`.trim()}>
      <div className="ci-hero-highlight-label">{label}</div>
      <div className="ci-hero-highlight-value">{value}</div>
      <div className="ci-hero-highlight-detail">{detail}</div>
    </div>
  );
}

function TopProductsCommentaryCard({ note }) {
  return (
    <div className={`ci-top-products-commentary-card ${note.tone}`.trim()}>
      <div className="ci-top-products-commentary-label">{note.label}</div>
      <div className="ci-top-products-commentary-copy">
        <div className="ci-top-products-commentary-title">{note.title}</div>
        <div className="ci-top-products-commentary-text">{note.text}</div>
      </div>
    </div>
  );
}

function CustomerBriefHero({
  hero,
  heroMetricValue,
  heroWindowLabel,
  upperMetrics,
  formatCurrency,
  bestLocationValue,
  bestLocationHint,
  peakDemandValue,
  topBundleValue
}) {
  const heroSummary = parseHeroTitle(hero?.title, bestLocationValue);
  const story = buildHeroStory(hero?.subtitle, bestLocationValue);
  const sampleLabel = `${confidenceLabel(hero?.confidence || 0)} signal · Sample ${formatNumber(hero?.sampleSize || 0)}`;
  const spotlightCaption = bestLocationValue && bestLocationValue !== 'Location signal building'
    ? `Share of current-window revenue attributed to ${bestLocationValue}.`
    : 'Share of current-window revenue attributed to the strongest detected customer pocket.';
  const inlineRead = bestLocationValue && bestLocationValue !== 'Location signal building'
    ? `${bestLocationValue} leading`
    : 'Signal building';
  const highlights = [
    {
      label: 'Top location',
      value: String(bestLocationValue),
      detail: bestLocationHint || 'Location signal is still forming.',
      tone: 'is-compact'
    },
    {
      label: 'Peak demand',
      value: peakDemandValue,
      detail: 'Strongest order timing in the active window.',
      tone: 'is-compact'
    },
    {
      label: 'Top bundle',
      value: topBundleValue,
      detail: 'Highest-signal co-purchase pair.',
      tone: 'is-wide'
    }
  ];

  return (
    <div className="ci-hero-stage">
      <div className="card ci-hero-brief-card">
        <div className="ci-hero-head">
          <div className="ci-hero-head-copy">
            <div className="card-label">Customer Brief</div>
            <div className="ci-hero-kicker">{heroSummary.kicker}</div>
          </div>
          <div className="ci-hero-pills">
            <span className="ci-soft-pill strong">{heroWindowLabel}</span>
            <span className="ci-soft-pill">{sampleLabel}</span>
            <span className="ci-inline-note">{inlineRead}</span>
          </div>
        </div>

        <div className="ci-hero-copy">
          <h2 className="ci-hero-headline">{heroSummary.headline}</h2>
          <p className="ci-hero-story">{story}</p>
        </div>

        <div className="ci-hero-highlights">
          {highlights.map((item) => (
            <HeroHighlightItem
              key={item.label}
              label={item.label}
              value={item.value}
              detail={item.detail}
              tone={item.tone}
            />
          ))}
        </div>
      </div>

      <div className="card ci-hero-spotlight-card">
        <div className="ci-hero-spotlight-top">
          <div className="ci-hero-spotlight-label">{hero?.metricLabel || 'Revenue share'}</div>
          <span className="ci-hero-spotlight-badge">{heroWindowLabel}</span>
        </div>
        <div className="ci-hero-spotlight-value">{heroMetricValue}</div>
        <div className="ci-hero-spotlight-caption">{spotlightCaption}</div>
        <div className="ci-hero-spotlight-meta">Confidence · {sampleLabel}</div>
        <div className="ci-hero-kpi-grid">
          {upperMetrics.map((metric, index) => (
            <HeroSpotlightMetric
              key={metric?.id || `spotlight-metric-${index}`}
              metric={metric}
              formatCurrency={formatCurrency}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TopProductsGrid({ section, formatCurrency }) {
  const products = (section?.products || []).slice(0, TOP_PRODUCTS_VISIBLE_COUNT);
  const windowLabel = section?.window?.label || TOP_PRODUCTS_DEFAULT_WINDOW_LABEL;
  const comparisonLabel = section?.comparisonWindow?.label || TOP_PRODUCTS_DEFAULT_COMPARISON_LABEL;
  const commentary = buildTopProductsCommentary(section?.products || [], section?.comparisonProducts || [], formatCurrency);

  if (!products.length) {
    return (
      <div className="ci-top-products-panel">
        <div className="ci-top-products-meta">
          <span className="ci-soft-pill strong">{windowLabel}</span>
          <span className="ci-soft-pill">{comparisonLabel}</span>
          <span className="ci-soft-pill">Pinned to rolling 30d</span>
        </div>
        <div className="ci-top-products-empty">
          Product ranking will appear once line-item data is synced.
        </div>
      </div>
    );
  }

  return (
    <div className="ci-top-products-panel">
      <div className="ci-top-products-summary">
        <div className="ci-top-products-summary-copy">
          <div className="ci-top-products-summary-title">Rolling top-products read</div>
          <div className="ci-top-products-summary-text">
            Notes below explain who took the lead, who entered the top five, and which products held their place versus the prior 30 days.
          </div>
        </div>
        <div className="ci-top-products-meta">
          <span className="ci-soft-pill strong">{windowLabel}</span>
          <span className="ci-soft-pill">{comparisonLabel}</span>
        </div>
      </div>

      <div className="ci-top-products-commentary">
        {commentary.map((note) => (
          <TopProductsCommentaryCard key={`${note.label}-${note.title}`} note={note} />
        ))}
      </div>

      <div className="ci-top-products-grid">
        {products.map((row, index) => (
          <article key={getProductRowKey(row, index)} className="ci-top-products-card">
            <div className="ci-top-products-card-body">
              <ProductThumbnail src={row.image_url} title={getProductRowTitle(row)} />
              <div className="ci-top-products-card-copy">
                <div className="ci-top-products-card-title">{getProductRowTitle(row)}</div>
                <div className="ci-top-products-card-meta">
                  {formatNumber(row.orders)} orders · {formatNumber(row.quantity)} units
                </div>
                <div className="ci-top-products-card-stats">
                  <div className="ci-top-products-stat">
                    <span className="ci-top-products-stat-value">{formatCurrency(row.revenue, 0)}</span>
                    <span className="ci-top-products-stat-label">Revenue</span>
                  </div>
                  <div className="ci-top-products-stat">
                    <span className="ci-top-products-stat-value">{formatNumber(row.orders)}</span>
                    <span className="ci-top-products-stat-label">Orders</span>
                  </div>
                </div>
              </div>
            </div>
          </article>
        ))}
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
        className="ci-top-products-thumb"
        loading="lazy"
      />
    );
  }

  const initial = title ? title.trim().charAt(0).toUpperCase() : 'P';
  return (
    <div className="ci-top-products-thumb ci-top-products-thumb-fallback">
      {initial}
    </div>
  );
}

function formatMomentumLabel(value, fallback = 'N/A') {
  if (!value) return fallback;
  return String(value)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
  const polarity = getMomentumPolarity(product, mode);
  const momentumKey = mode === 'layer1' ? product?.trigger : product?.exceptionalEvent;
  const statement = formatMomentumLabel(momentumKey, mode === 'layer1' ? 'Business trigger' : 'Exceptional event');
  const headline = product?.assessment?.headline || product?.title || 'Product signal';
  const subline = product?.assessment?.subline || '';
  const action = product?.assessment?.action || '';
  const impactClass = polarity === 'risk' ? 'pm-impact-risk' : 'pm-impact-opportunity';
  const polarityLabel = polarity === 'risk' ? 'Risk' : 'Opportunity';
  const signal = product?.statistical?.signal || null;
  const lookbackLabel = formatSparklineLookback(product?.sparkline);
  const thumbnailSrc = typeof product?.image_url === 'string'
    ? product.image_url
    : typeof product?.imageUrl === 'string'
      ? product.imageUrl
      : typeof product?.thumbnailUrl === 'string'
        ? product.thumbnailUrl
        : null;

  return (
    <article className={`pm-card ${polarity}`}>
      <div className="pm-card-header">
        <ProductThumbnail src={thumbnailSrc} title={product?.title} />
        <div className="pm-card-title-wrap">
          <div className="pm-card-statement-row">
            <h4 className="pm-card-title">{statement}</h4>
            <div className="pm-card-pills">
              <span className={`pm-severity-pill binary ${polarity}`}>{polarityLabel}</span>
              <SignalBadge signal={signal} />
            </div>
          </div>
          <div className="pm-card-news">{headline}</div>
          {subline ? <div className="pm-card-news-subline">{subline}</div> : null}
          {lookbackLabel ? (
            <div className="pm-card-meta">
              <span className="pm-trigger pm-lookback">Lookback: {lookbackLabel}</span>
            </div>
          ) : null}
        </div>
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
    if (!store) {
      setLiveSection(null);
      setLiveLoading(false);
      setLiveError(false);
      return undefined;
    }

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

    loadLiveLayer();
    return () => {
      active = false;
      controller.abort();
    };
  }, [store]);

  const layer1Selected = (section?.products || []).filter((row) => row?.trigger);
  const layer1Live = (liveSection?.products || []).filter((row) => row?.trigger);
  const layer1 = layer1Mode === MOMENTUM_MODE_LIVE && layer1Live.length ? layer1Live : layer1Selected;
  const layer2Live = (liveSection?.products || []).filter((row) => row?.exceptionalEvent);
  const layer2 = layer2Live;
  const thresholds = (layer1Mode === MOMENTUM_MODE_LIVE ? liveSection?.methodology : section?.methodology)?.thresholds
    || section?.methodology?.thresholds
    || {};
  const activeSummary = layer1Mode === MOMENTUM_MODE_LIVE ? (liveSection?.summary || section?.summary) : section?.summary;
  const selectedLabel = dateRange?.type === 'custom' ? 'Selected range' : 'Selected range';
  const layer2CountLabel = liveLoading ? 'Loading...' : liveError ? 'Unavailable' : `${layer2.length} detected`;

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
            Live ({MOMENTUM_LIVE_WINDOW_DAYS}d)
          </button>
          <button
            type="button"
            className={`pm-btn ${layer1Mode === MOMENTUM_MODE_SELECTED ? 'active' : ''}`}
            onClick={() => setLayer1Mode(MOMENTUM_MODE_SELECTED)}
          >
            {selectedLabel}
          </button>
        </div>
      </section>

      <div className="pm-summary">{activeSummary || 'No product momentum triggers crossed thresholds in this window.'}</div>
      <section className="pm-panel pm-grid">
        <div className="pm-layer">
          <div className="pm-layer-head">
            <h4>Business triggers</h4>
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
            <div className="pm-empty">No trigger is active in this window.</div>
          )}
          {layer1Mode === MOMENTUM_MODE_LIVE && liveError ? (
            <div className="pm-note">Live {MOMENTUM_LIVE_WINDOW_DAYS}d data could not be loaded, showing selected range instead.</div>
          ) : null}
        </div>

        <div className="pm-layer">
          <div className="pm-layer-head">
            <h4>Exceptional events</h4>
            <span>{layer2CountLabel}</span>
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
            <div className="pm-empty">
              {liveLoading
                ? 'Loading exceptional events...'
                : liveError
                  ? 'Exceptional events could not be loaded right now.'
                  : 'No exceptional event is active right now.'}
            </div>
          )}
          {liveError ? (
            <div className="pm-note">Tip: Exceptional events use the live {MOMENTUM_LIVE_WINDOW_DAYS}d monitor and are independent of the dashboard date range.</div>
          ) : null}
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
            <p>{(layer1Mode === MOMENTUM_MODE_LIVE ? liveSection : section)?.methodology?.description || 'Methodology details are not available.'}</p>
            <div className="pm-threshold-grid">
              {Object.entries(thresholds).map(([key, value]) => (
                <div key={key} className="pm-threshold-row">
                  <span>{formatMomentumLabel(key, 'N/A')}</span>
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
  const hero = data?.hero || null;
  const dataQuality = data?.dataQuality || { orders: 0, notes: [] };
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const upperMetrics = useMemo(() => resolveUpperMetrics(kpis), [kpis]);
  const topBundle = useMemo(() => resolveTopBundle(sections, kpis), [sections, kpis]);
  const bestSegmentMetric = useMemo(() => getUpperMetricById(kpis, 'best-segment'), [kpis]);
  const heroMetricValue = useMemo(() => {
    if (!hero) return '—';
    if (hero.metricFormat === 'percent') return formatPercent(hero.metricValue);
    if (hero.metricFormat === 'currency') return formatCurrency(hero.metricValue, 0);
    return hero.metricValue ?? '—';
  }, [hero, formatCurrency]);
  const bestLocationValue = bestSegmentMetric?.value || 'Location signal building';
  const bestLocationHint = bestSegmentMetric?.hint || 'Customer segment signal is still forming.';
  const peakDemandValue = sections.segments?.timing?.topDay && sections.segments?.timing?.topHour != null
    ? `${sections.segments.timing.topDay} · ${sections.segments.timing.topHour}:00`
    : sections.segments?.timing?.topDay || 'Peak demand still forming';
  const heroWindowLabel = data?.window?.label || 'Current window';
  const topBundleValue = topBundle ? `${topBundle.from} → ${topBundle.to}` : 'Bundle signal still building';

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
          <CustomerBriefHero
            hero={hero}
            heroMetricValue={heroMetricValue}
            heroWindowLabel={heroWindowLabel}
            upperMetrics={upperMetrics}
            formatCurrency={formatCurrency}
            bestLocationValue={bestLocationValue}
            bestLocationHint={bestLocationHint}
            peakDemandValue={peakDemandValue}
            topBundleValue={topBundleValue}
          />
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
          <div className="space-y-5">
            <TopProductsGrid section={sections.topProducts || null} formatCurrency={formatCurrency} />
            <CustomerActionPlanner data={data} onOpenSection={scrollToSection} embedded />
          </div>
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
