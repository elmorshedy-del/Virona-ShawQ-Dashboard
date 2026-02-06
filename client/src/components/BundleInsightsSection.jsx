import { useMemo, useState } from 'react';

const BUNDLE_DISPLAY_DEFAULTS = {
  MIN_STORE_ORDERS: 30,
  MIN_PAIR_ORDERS_DISPLAY: 3,
  T1_MIN_PAIR_ORDERS: 8,
  T1_MIN_ANCHOR_ORDERS: 20,
  T1_MAX_FALSE_DISCOVERY_RISK: 0.1,
  T2_MIN_PAIR_ORDERS: 5,
  T2_MIN_ANCHOR_ORDERS: 10,
  TREND_MIN_PREVIOUS_ORDERS: 3
};

const TIER_META = {
  T1: {
    label: 'Actionable',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dotClass: 'bg-emerald-500'
  },
  T2: {
    label: 'Watchlist',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
    dotClass: 'bg-amber-500'
  },
  T3: {
    label: 'Early Signal',
    badgeClass: 'border-slate-200 bg-slate-50 text-slate-600',
    dotClass: 'bg-slate-400'
  }
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatPercent = (value, digits = 1) => {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
};

const formatNumber = (value) => {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
};

const formatSignedInteger = (value) => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString()}`;
};

const formatLift = (value) => {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${value.toFixed(2)}x`;
};

const normalizePairKey = (pairKeys = []) => {
  if (!Array.isArray(pairKeys) || pairKeys.length < 2) return null;
  return `${String(pairKeys[0])}||${String(pairKeys[1])}`;
};

const getTier = (row, rules = BUNDLE_DISPLAY_DEFAULTS) => {
  if (row?.tier === 'T1' || row?.tier === 'T2' || row?.tier === 'T3') return row.tier;
  const pairOrders = toNumber(row?.count);
  const anchorOrders = toNumber(row?.anchorOrders);
  const falseDiscoveryRisk = toNumber(row?.falseDiscoveryRisk, 1);

  if (
    pairOrders >= rules.T1_MIN_PAIR_ORDERS
    && anchorOrders >= rules.T1_MIN_ANCHOR_ORDERS
    && falseDiscoveryRisk <= rules.T1_MAX_FALSE_DISCOVERY_RISK
  ) {
    return 'T1';
  }

  if (
    pairOrders >= rules.T2_MIN_PAIR_ORDERS
    && anchorOrders >= rules.T2_MIN_ANCHOR_ORDERS
  ) {
    return 'T2';
  }

  if (pairOrders >= rules.MIN_PAIR_ORDERS_DISPLAY) return 'T3';
  return null;
};

const getDeltaDisplay = (row, rules = BUNDLE_DISPLAY_DEFAULTS) => {
  const current = toNumber(row?.count);
  const previous = Math.max(0, toNumber(row?.previousCount));
  const delta = current - previous;
  const trendState = row?.trendState;

  if (trendState === 'new') {
    return {
      main: 'New this period',
      sub: null,
      tone: 'text-slate-500'
    };
  }

  if (previous === 0) {
    return {
      main: 'New this period',
      sub: null,
      tone: 'text-slate-500'
    };
  }

  if (trendState === 'limited' || previous < rules.TREND_MIN_PREVIOUS_ORDERS) {
    return {
      main: `${formatSignedInteger(delta)} vs ${formatNumber(previous)} last period`,
      sub: 'limited history',
      tone: delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-slate-500'
    };
  }

  const rate = previous > 0 ? delta / previous : null;
  return {
    main: formatSignedInteger(delta),
    sub: Number.isFinite(rate) ? `${rate > 0 ? '+' : ''}${(rate * 100).toFixed(0)}%` : null,
    tone: delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-slate-500'
  };
};

const getWatchlistStatus = (row, rules = BUNDLE_DISPLAY_DEFAULTS) => {
  const pairGap = Math.max(0, rules.T1_MIN_PAIR_ORDERS - toNumber(row?.count));
  const anchorGap = Math.max(0, rules.T1_MIN_ANCHOR_ORDERS - toNumber(row?.anchorOrders));

  if (pairGap > 0 && anchorGap > 0) {
    return `Needs ${pairGap} more pair orders and ${anchorGap} more anchor orders`;
  }
  if (pairGap > 0) return `Needs ${pairGap} more pair orders`;
  if (anchorGap > 0) return `Needs ${anchorGap} more anchor orders`;
  return 'Building toward actionable confidence';
};

function TierBadge({ tier }) {
  const meta = TIER_META[tier] || TIER_META.T3;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${meta.badgeClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
      {meta.label}
    </span>
  );
}

function BundleTypeBadge({ label }) {
  const isConfigured = label === 'Configured Bundle';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
      isConfigured
        ? 'border-violet-200 bg-violet-50 text-violet-700'
        : 'border-slate-200 bg-slate-50 text-slate-600'
    }`}>
      {label || 'Organic Co-Purchase'}
    </span>
  );
}

function MetricCell({ label, value, hint, caution = false }) {
  return (
    <div className="flex min-w-[110px] flex-col gap-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${caution ? 'text-amber-700' : 'text-gray-900'}`}>{value}</div>
      {hint ? <div className="text-[11px] text-gray-500">{hint}</div> : null}
    </div>
  );
}

function BundleActionableCard({ bundle, insight, methodology, formatCurrency, displayRules }) {
  const [showMethodology, setShowMethodology] = useState(false);
  const delta = useMemo(() => getDeltaDisplay(bundle, displayRules), [bundle, displayRules]);
  const attachRateCaution = toNumber(bundle?.anchorOrders) < 10;

  const businessSummary = insight?.businessSummary
    || insight?.text
    || `${bundle?.pair?.[0] || 'Anchor'} with ${bundle?.pair?.[1] || 'Attach'} generated ${formatNumber(toNumber(bundle?.count))} co-purchases this period.`;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier="T1" />
            <BundleTypeBadge label={bundle?.bundleTypeLabel || 'Organic Co-Purchase'} />
          </div>
          <div className="text-base font-semibold text-gray-900">
            {bundle?.pair?.[0] || 'Anchor product'} <span className="mx-1 text-gray-400">→</span> {bundle?.pair?.[1] || 'Attach product'}
          </div>
          <div className="text-sm text-gray-600">
            Signal: {bundle?.signal || 'Emerging'} · False-discovery risk {formatPercent(bundle?.falseDiscoveryRisk)}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-white px-4 py-3 text-right">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500">Est. Incremental Revenue</div>
          <div className="mt-1 text-xl font-semibold text-emerald-700 tabular-nums">
            {formatCurrency(toNumber(bundle?.expectedIncrementalRevenue), 0)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        <MetricCell label="Co-purchases" value={formatNumber(toNumber(bundle?.count))} hint={delta.main === 'New this period' ? delta.main : `${delta.main}${delta.sub ? ` · ${delta.sub}` : ''}`} />
        <MetricCell label="Anchor orders" value={formatNumber(toNumber(bundle?.anchorOrders))} />
        <MetricCell label="Attach rate" value={formatPercent(bundle?.attachRate)} caution={attachRateCaution} hint={attachRateCaution ? 'Limited anchor volume' : null} />
        <MetricCell label="Baseline" value={formatPercent(bundle?.baselineRate)} />
        <MetricCell label="Lift" value={formatLift(bundle?.lift)} />
        <MetricCell label="Confidence" value={formatPercent(bundle?.statisticalConfidence)} />
      </div>

      {!showMethodology ? (
        <div className="mt-4 rounded-xl border border-emerald-200/70 bg-white/80 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Business Summary</div>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{businessSummary}</p>
          {(insight?.recommendedAction || insight?.successKpi) ? (
            <div className="mt-3 space-y-1 text-sm text-gray-700">
              {insight?.recommendedAction ? <p><span className="font-semibold text-gray-900">Recommended action:</span> {insight.recommendedAction}</p> : null}
              {insight?.successKpi ? <p><span className="font-semibold text-gray-900">Success KPI:</span> {insight.successKpi}</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Methodology</div>
          <p className="mt-2 text-sm text-gray-700">{insight?.methodology || methodology?.classification || 'Classification and reliability are derived from bundle metadata and controlled significance tests.'}</p>
          <div className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Computation Logic</div>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{insight?.computationLogic || methodology?.baselineDefinition || 'Attach rate, baseline, lift, and false-discovery risk are computed from observed order-level co-purchase behavior.'}</p>
        </div>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowMethodology((prev) => !prev)}
          className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-700 hover:border-gray-400"
        >
          {showMethodology ? 'Back to summary' : 'View methodology'}
        </button>
      </div>
    </div>
  );
}

export default function BundleInsightsSection({
  section,
  window,
  eligibleOrders,
  formatCurrency
}) {
  const [showEarlySignals, setShowEarlySignals] = useState(false);
  const rows = Array.isArray(section?.bundles) ? section.bundles : [];
  const keyInsights = Array.isArray(section?.keyInsights) ? section.keyInsights : [];
  const displayRules = useMemo(() => {
    const methodology = section?.methodology || {};
    const tierThresholds = methodology.tierThresholds || {};
    const t1 = tierThresholds.t1 || {};
    const t2 = tierThresholds.t2 || {};

    return {
      MIN_STORE_ORDERS: Math.max(1, Math.round(toNumber(methodology.minStoreOrders, BUNDLE_DISPLAY_DEFAULTS.MIN_STORE_ORDERS))),
      MIN_PAIR_ORDERS_DISPLAY: Math.max(1, Math.round(toNumber(methodology.minPairOrdersDisplay, BUNDLE_DISPLAY_DEFAULTS.MIN_PAIR_ORDERS_DISPLAY))),
      T1_MIN_PAIR_ORDERS: Math.max(1, Math.round(toNumber(t1.minPairOrders, BUNDLE_DISPLAY_DEFAULTS.T1_MIN_PAIR_ORDERS))),
      T1_MIN_ANCHOR_ORDERS: Math.max(1, Math.round(toNumber(t1.minAnchorOrders, BUNDLE_DISPLAY_DEFAULTS.T1_MIN_ANCHOR_ORDERS))),
      T1_MAX_FALSE_DISCOVERY_RISK: toNumber(methodology.falseDiscoveryTarget, BUNDLE_DISPLAY_DEFAULTS.T1_MAX_FALSE_DISCOVERY_RISK),
      T2_MIN_PAIR_ORDERS: Math.max(1, Math.round(toNumber(t2.minPairOrders, BUNDLE_DISPLAY_DEFAULTS.T2_MIN_PAIR_ORDERS))),
      T2_MIN_ANCHOR_ORDERS: Math.max(1, Math.round(toNumber(t2.minAnchorOrders, BUNDLE_DISPLAY_DEFAULTS.T2_MIN_ANCHOR_ORDERS))),
      TREND_MIN_PREVIOUS_ORDERS: Math.max(1, Math.round(toNumber(methodology.trendMinPreviousOrders, BUNDLE_DISPLAY_DEFAULTS.TREND_MIN_PREVIOUS_ORDERS)))
    };
  }, [section?.methodology]);

  const directionalInsightLookup = useMemo(() => {
    const map = new Map();
    keyInsights.forEach((insight) => {
      const key = normalizePairKey(insight?.pairKeys);
      if (key) map.set(key, insight);
    });
    return map;
  }, [keyInsights]);

  const tiered = useMemo(() => {
    const eligibleRows = rows.filter((row) => toNumber(row?.count) >= displayRules.MIN_PAIR_ORDERS_DISPLAY);
    const t1 = [];
    const t2 = [];
    const t3 = [];

    eligibleRows.forEach((row) => {
      const tier = getTier(row, displayRules);
      if (!tier) return;
      if (tier === 'T1') t1.push(row);
      else if (tier === 'T2') t2.push(row);
      else t3.push(row);
    });

    return { eligibleRows, t1, t2, t3 };
  }, [rows, displayRules]);

  const topActionable = tiered.t1[0] || null;
  const topActionableInsight = topActionable
    ? directionalInsightLookup.get(normalizePairKey(topActionable?.pairKeys)) || null
    : null;
  const watchlistTop = tiered.t2[0] || null;
  const canAnalyzeStore = toNumber(eligibleOrders) >= displayRules.MIN_STORE_ORDERS;

  if (!canAnalyzeStore) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-5 text-sm text-gray-600">
        Bundle patterns require at least {displayRules.MIN_STORE_ORDERS} eligible orders. You currently have {formatNumber(toNumber(eligibleOrders))}. Insights will activate automatically once volume is sufficient.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{window?.startDate && window?.endDate ? `Period: ${window.startDate} → ${window.endDate}` : 'Period: current selection'}</span>
          <span>Eligible orders: {formatNumber(toNumber(eligibleOrders))}</span>
          <span>Comparison: previous equal-length period</span>
        </div>
      </div>

      {topActionable ? (
        <BundleActionableCard
          bundle={topActionable}
          insight={topActionableInsight}
          methodology={section?.methodology}
          formatCurrency={formatCurrency}
          displayRules={displayRules}
        />
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          No bundle pairs have reached actionable confidence yet.
          {tiered.t2.length ? (
            <span>
              {' '} {formatNumber(tiered.t2.length)} pairs are on the watchlist; the strongest is <span className="font-semibold">{watchlistTop?.pair?.[0]} → {watchlistTop?.pair?.[1]}</span> with {formatNumber(toNumber(watchlistTop?.count))} co-purchases.
            </span>
          ) : null}
        </div>
      )}

      {(tiered.t1.length || tiered.t2.length || tiered.t3.length) ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-[11px] uppercase tracking-[0.08em] text-gray-500">
                  <th className="py-3 pl-4 pr-2">Pair</th>
                  <th className="px-2 py-3 text-right">Orders</th>
                  <th className="px-2 py-3 text-right">Delta</th>
                  <th className="px-2 py-3 text-right">Attach</th>
                  <th className="px-2 py-3 text-right">Lift</th>
                  <th className="px-2 py-3 text-right">Confidence</th>
                  <th className="px-2 py-3 text-right">Est. Incremental</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...tiered.t1, ...tiered.t2, ...(showEarlySignals ? tiered.t3 : [])].map((row) => {
                  const tier = getTier(row, displayRules);
                  const delta = getDeltaDisplay(row, displayRules);
                  const watchlistStatus = tier === 'T2' ? getWatchlistStatus(row, displayRules) : null;
                  const attachRateCaution = toNumber(row?.anchorOrders) < displayRules.T2_MIN_ANCHOR_ORDERS;

                  return (
                    <tr key={`${row.pairKeys?.[0] || row.pair?.[0]}-${row.pairKeys?.[1] || row.pair?.[1]}`} className="border-t border-gray-100">
                      <td className="py-3 pl-4 pr-2">
                        <div className="flex flex-col gap-1">
                          <div className="text-sm font-semibold text-gray-900">
                            {row.pair?.[0]} <span className="mx-1 text-gray-400">→</span> {row.pair?.[1]}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <TierBadge tier={tier} />
                            <BundleTypeBadge label={row.bundleTypeLabel || 'Organic Co-Purchase'} />
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right font-semibold text-gray-900 tabular-nums">{formatNumber(toNumber(row.count))}</td>
                      <td className="px-2 py-3 text-right">
                        <div className={`text-xs font-semibold tabular-nums ${delta.tone}`}>{delta.main}</div>
                        {delta.sub ? <div className="text-[11px] text-gray-500">{delta.sub}</div> : null}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <div className={`font-semibold tabular-nums ${attachRateCaution ? 'text-amber-700' : 'text-gray-900'}`}>{formatPercent(row.attachRate)}</div>
                        {attachRateCaution ? <div className="text-[11px] text-amber-700">low anchor volume</div> : null}
                      </td>
                      <td className="px-2 py-3 text-right text-gray-700 tabular-nums">{formatLift(row.lift)}</td>
                      <td className="px-2 py-3 text-right font-semibold text-gray-900 tabular-nums">{formatPercent(row.statisticalConfidence)}</td>
                      <td className="px-2 py-3 text-right font-semibold text-gray-900 tabular-nums">{formatCurrency(toNumber(row.expectedIncrementalRevenue), 0)}</td>
                      <td className="px-4 py-3 text-right text-xs text-gray-600">
                        {tier === 'T1' ? 'Ready for action' : tier === 'T2' ? watchlistStatus : 'Observing'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {tiered.t3.length ? (
            <button
              type="button"
              onClick={() => setShowEarlySignals((prev) => !prev)}
              className="w-full border-t border-gray-100 bg-gray-50 px-4 py-2 text-center text-xs font-semibold text-gray-600 hover:bg-gray-100"
            >
              {showEarlySignals ? 'Hide early signals' : `Show ${formatNumber(tiered.t3.length)} early signals`}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-5 text-sm text-gray-600">
          Bundle insights need more multi-item orders.
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
        <p>{section?.methodology?.baselineDefinition || 'Each row compares this period versus the immediately previous period of equal length. Baseline is attach-product order share across all orders in each period.'}</p>
        <p className="mt-1">{section?.methodology?.classification || 'Bundle type is Configured Bundle when Shopify product naming/SKU markers indicate an explicit offer; all other surfaced pairs are Organic Co-Purchase.'}</p>
        <p className="mt-1">{section?.methodology?.significance || 'Reliability is measured with exact one-sided binomial testing and Benjamini-Hochberg false-discovery control.'}</p>
      </div>
    </div>
  );
}
