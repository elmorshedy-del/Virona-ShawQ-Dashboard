import { useMemo } from 'react';
import {
    AlertTriangle,
    ArrowUpRight,
    Clock3,
    FlaskConical,
    LineChart as LineChartIcon,
    Rocket,
    ShieldCheck,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Zap
} from 'lucide-react';
import {
    LineChart,
    Line,
    ResponsiveContainer
} from 'recharts';

const ACTION_PLANNER_RULES = Object.freeze({
    discountRevenueRiskShare: 0.35,
    repeatRateOpportunity: 0.25,
    lowCityCoverage: 0.8,
    lowCountryCoverage: 0.95,
    minOrdersForStrongSignal: 20,
    watchlistLimit: 3,
    concentrationRiskShare: 0.45
});

const RATE_NORMALIZATION_RULES = Object.freeze({
    ratioMaxAbs: 1,
    percentMaxAbs: 100,
    basisPointsMaxAbs: 10000,
    percentDivisor: 100,
    basisPointsDivisor: 10000
});

const TIMELINE_PLAYBOOK = Object.freeze([
    {
        key: 'immediate',
        label: '24-48h',
        title: 'Protect momentum',
        objective: 'Handle abrupt rank shifts, stock pressure, and conversion blockers while signal is fresh.',
        icon: Clock3,
        accent: 'text-rose-600',
        bg: 'bg-rose-50',
        border: 'border-rose-100'
    },
    {
        key: 'weekly',
        label: '7d',
        title: 'Run tactical experiments',
        objective: 'Test pricing, onsite placement, and bundle pairing for measurable lift by next weekly review.',
        icon: FlaskConical,
        accent: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-100'
    },
    {
        key: 'monthly',
        label: '28d',
        title: 'Build repeat demand',
        objective: 'Improve retention and lifecycle value with flows, content loops, and repeat-purchase offers.',
        icon: Sparkles,
        accent: 'text-indigo-600',
        bg: 'bg-indigo-50',
        border: 'border-indigo-100'
    },
    {
        key: 'quarterly',
        label: '90d',
        title: 'Shape the portfolio',
        objective: 'Decide what to scale, hold, and sunset based on sustained trend quality rather than one-off spikes.',
        icon: LineChartIcon,
        accent: 'text-emerald-600',
        bg: 'bg-emerald-50',
        border: 'border-emerald-100'
    }
]);

const TIMELINE_ORDER = {
    '24-48h': 0,
    '7d': 1,
    '28d': 2,
    '90d': 3
};

const ACTION_PRIORITY = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
};

const WATCHLIST_COPY = {
    breakout: {
        title: 'Breakout',
        subtitle: 'Winners to scale quickly',
        icon: TrendingUp,
        accent: 'text-emerald-700',
        bg: 'bg-emerald-50'
    },
    atRisk: {
        title: 'At Risk',
        subtitle: 'Revenue exposed to immediate drag',
        icon: AlertTriangle,
        accent: 'text-amber-700',
        bg: 'bg-amber-50'
    },
    fading: {
        title: 'Fading',
        subtitle: 'Needs repositioning or sunset plan',
        icon: TrendingDown,
        accent: 'text-slate-700',
        bg: 'bg-slate-100'
    }
};

const SEVERITY_COLORS = {
    critical: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', pill: 'bg-rose-100 text-rose-700' },
    high: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', pill: 'bg-amber-100 text-amber-700' },
    medium: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', pill: 'bg-indigo-100 text-indigo-700' },
    low: { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', pill: 'bg-slate-100 text-slate-700' }
};

const TRIGGER_HORIZONS = {
    hero_decline: '24-48h',
    concentration_risk: '90d',
    rising_pillar: '24-48h',
    new_traction: '7d',
    velocity_stall: '7d',
    discount_dependency: '28d',
    discount_increase: '7d',
    quiet_exit: '90d',
    first_hero_slip: '24-48h',
    leaderboard_reshuffle: '7d',
    meteoric_rise: '24-48h',
    record_period: '24-48h',
    sustained_streak: '7d',
    sharp_reversal: '24-48h'
};

const TRIGGER_OWNERS = {
    hero_decline: 'Merch',
    concentration_risk: 'Leadership',
    rising_pillar: 'Growth',
    new_traction: 'Growth',
    velocity_stall: 'Merch',
    discount_dependency: 'Pricing',
    discount_increase: 'Pricing',
    quiet_exit: 'Merch',
    first_hero_slip: 'Growth',
    leaderboard_reshuffle: 'Leadership',
    meteoric_rise: 'Growth',
    record_period: 'Growth',
    sustained_streak: 'Growth',
    sharp_reversal: 'Merch'
};

function formatPercent(value) {
    const normalized = normalizeRate(value);
    if (normalized == null) return '—';
    return `${(normalized * 100).toFixed(1)}%`;
}

function formatNumber(value) {
    if (value == null || Number.isNaN(value)) return '—';
    return Math.round(value).toLocaleString();
}

function getKpiValue(kpis, id) {
    const row = Array.isArray(kpis) ? kpis.find((item) => item.id === id) : null;
    return row && typeof row.value === 'number' ? row.value : null;
}

function normalizeRate(rawValue) {
    if (rawValue == null || rawValue === '') return null;

    let numericValue = null;
    let isPercentString = false;

    if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        if (!trimmed) return null;
        isPercentString = trimmed.endsWith('%');
        numericValue = Number(trimmed.replace(/%/g, '').replace(/,/g, ''));
    } else {
        numericValue = Number(rawValue);
    }

    if (!Number.isFinite(numericValue)) return null;

    if (isPercentString) {
        const absPercentValue = Math.abs(numericValue);
        if (absPercentValue <= RATE_NORMALIZATION_RULES.percentMaxAbs) {
            return numericValue / RATE_NORMALIZATION_RULES.percentDivisor;
        }
        if (absPercentValue <= RATE_NORMALIZATION_RULES.percentMaxAbs * 10) {
            return numericValue / (RATE_NORMALIZATION_RULES.percentDivisor * 10);
        }
        if (absPercentValue <= RATE_NORMALIZATION_RULES.basisPointsMaxAbs) {
            return numericValue / RATE_NORMALIZATION_RULES.basisPointsDivisor;
        }
        return null;
    }

    const absValue = Math.abs(numericValue);
    if (absValue <= RATE_NORMALIZATION_RULES.ratioMaxAbs) return numericValue;
    if (absValue <= RATE_NORMALIZATION_RULES.percentMaxAbs) {
        return numericValue / RATE_NORMALIZATION_RULES.percentDivisor;
    }
    if (absValue <= RATE_NORMALIZATION_RULES.basisPointsMaxAbs) {
        return numericValue / RATE_NORMALIZATION_RULES.basisPointsDivisor;
    }
    return null;
}

function normalizeUnitShare(rawValue) {
    const normalized = normalizeRate(rawValue);
    if (normalized == null) return null;
    return Math.min(1, Math.max(0, normalized));
}

function cleanMoverProductTitle(rawTitle, suffix) {
    if (!rawTitle) return null;
    const needle = ` ${suffix}`;
    if (rawTitle.toLowerCase().endsWith(needle)) {
        return rawTitle.slice(0, -needle.length).trim();
    }
    return rawTitle.trim();
}

function makeDiscountLookup(discountSkus) {
    const lookup = new Map();
    (discountSkus || []).forEach((row) => {
        if (!row?.title) return;
        lookup.set(String(row.title).toLowerCase(), normalizeUnitShare(row.discountShare) || 0);
    });
    return lookup;
}

function getDiscountShare(lookup, title) {
    if (!title) return 0;
    return lookup.get(String(title).toLowerCase()) || 0;
}

function dedupeByTitle(items, limit) {
    const seen = new Set();
    const deduped = [];

    items.forEach((item) => {
        if (!item?.title) return;
        const key = String(item.title).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(item);
    });

    return deduped.slice(0, limit);
}

// ── Upgraded: builds watchlists from momentum engine data when available ─────
function buildWatchlists({ topProducts, discountSkus, upInsight, downInsight, momentumData }) {
    const discountLookup = makeDiscountLookup(discountSkus);

    // If momentum engine data is available, use trigger-based classification
    if (momentumData?.momentum?.length || momentumData?.watch?.length) {
        const breakoutSeed = [];
        const atRiskSeed = [];
        const fadingSeed = [];

        (momentumData.momentum || []).forEach((prod) => {
            const triggers = prod.triggers || [];
            const headline = prod.assessment?.headline || prod.title;
            const signal = prod.statistical?.signal;
            const signalLabel = signal ? ` [${signal}]` : '';

            if (triggers.includes('rising_pillar') || triggers.includes('new_traction') || prod.exceptionalEvent === 'meteoric_rise' || prod.exceptionalEvent === 'record_period' || prod.exceptionalEvent === 'sustained_streak') {
                breakoutSeed.push({
                    title: prod.title,
                    note: headline + signalLabel,
                    sparkline: prod.sparkline,
                    severity: prod.assessment?.severity
                });
            }
        });

        (momentumData.watch || []).forEach((prod) => {
            const triggers = prod.triggers || [];
            const headline = prod.assessment?.headline || prod.title;
            const signal = prod.statistical?.signal;
            const signalLabel = signal ? ` [${signal}]` : '';

            if (triggers.includes('hero_decline') || triggers.includes('discount_dependency') || triggers.includes('discount_increase') || triggers.includes('velocity_stall') || prod.exceptionalEvent === 'first_hero_slip' || prod.exceptionalEvent === 'sharp_reversal') {
                atRiskSeed.push({
                    title: prod.title,
                    note: headline + signalLabel,
                    sparkline: prod.sparkline,
                    severity: prod.assessment?.severity
                });
            } else if (triggers.includes('quiet_exit')) {
                fadingSeed.push({
                    title: prod.title,
                    note: headline + signalLabel,
                    sparkline: prod.sparkline,
                    severity: prod.assessment?.severity
                });
            }
        });

        // Fill from traditional sources if empty
        if (!breakoutSeed.length && upInsight?.title) {
            breakoutSeed.push({
                title: cleanMoverProductTitle(upInsight.title, 'surged'),
                note: upInsight.detail || 'Recent positive movement vs prior window.'
            });
        }

        if (!atRiskSeed.length && downInsight?.title) {
            atRiskSeed.push({
                title: cleanMoverProductTitle(downInsight.title, 'softened'),
                note: downInsight.detail || 'Recent negative movement vs prior window.'
            });
        }

        const byRevenueAsc = [...(topProducts || [])].sort((a, b) => (a.revenue || 0) - (b.revenue || 0));
        if (!fadingSeed.length) {
            byRevenueAsc.forEach((row) => {
                fadingSeed.push({
                    title: row.title,
                    note: `Lower current contribution (${formatNumber(row.orders)} orders; ${formatNumber(row.quantity)} units).`
                });
            });
        }

        return {
            breakout: dedupeByTitle(breakoutSeed, ACTION_PLANNER_RULES.watchlistLimit),
            atRisk: dedupeByTitle(atRiskSeed, ACTION_PLANNER_RULES.watchlistLimit),
            fading: dedupeByTitle(fadingSeed, ACTION_PLANNER_RULES.watchlistLimit)
        };
    }

    // fallback: original logic
    const byRevenueDesc = [...(topProducts || [])].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    const byRevenueAsc = [...byRevenueDesc].reverse();

    const breakoutSeed = [];
    if (upInsight?.title) {
        breakoutSeed.push({
            title: cleanMoverProductTitle(upInsight.title, 'surged'),
            note: upInsight.detail || 'Recent positive movement vs prior window.'
        });
    }

    byRevenueDesc.forEach((row) => {
        const discountShare = getDiscountShare(discountLookup, row.title);
        if (discountShare < ACTION_PLANNER_RULES.discountRevenueRiskShare) {
            breakoutSeed.push({
                title: row.title,
                note: `${formatNumber(row.orders)} orders with lower discount reliance (${formatPercent(discountShare)}).`
            });
        }
    });

    const atRiskSeed = [];
    if (downInsight?.title) {
        atRiskSeed.push({
            title: cleanMoverProductTitle(downInsight.title, 'softened'),
            note: downInsight.detail || 'Recent negative movement vs prior window.'
        });
    }

    (discountSkus || []).forEach((row) => {
        if ((row.discountShare || 0) >= ACTION_PLANNER_RULES.discountRevenueRiskShare) {
            atRiskSeed.push({
                title: row.title,
                note: `Discount-heavy demand (${formatPercent(row.discountShare)} discount share).`
            });
        }
    });

    const fadingSeed = byRevenueAsc.map((row) => ({
        title: row.title,
        note: `Lower current contribution (${formatNumber(row.orders)} orders; ${formatNumber(row.quantity)} units).`
    }));

    return {
        breakout: dedupeByTitle(breakoutSeed, ACTION_PLANNER_RULES.watchlistLimit),
        atRisk: dedupeByTitle(atRiskSeed, ACTION_PLANNER_RULES.watchlistLimit),
        fading: dedupeByTitle(fadingSeed, ACTION_PLANNER_RULES.watchlistLimit)
    };
}

// ── Upgraded: builds actions from momentum engine data when available ─────────
function buildActions({ data, topProducts, discountMetrics, repeatRate, upInsight, downInsight, momentumData }) {
    const actions = [];
    const bundleTop = data?.sections?.bundles?.bundles?.[0] || null;
    const cityCoverage = normalizeUnitShare(data?.sections?.segments?.geo?.cityCoverage);
    const countryCoverage = normalizeUnitShare(data?.sections?.segments?.geo?.countryCoverage);
    const discountRevenueShare = normalizeUnitShare(discountMetrics.discountRevenueShare) || 0;
    const normalizedRepeatRate = normalizeUnitShare(repeatRate);
    const orders = data?.dataQuality?.orders || 0;

    // Use momentum engine data if available
    const allMomentumProducts = [
        ...(momentumData?.momentum || []),
        ...(momentumData?.watch || [])
    ];

    if (allMomentumProducts.length) {
        allMomentumProducts.forEach((prod) => {
            const trigger = prod.trigger || prod.exceptionalEvent;
            if (!trigger) return;

            const assessment = prod.assessment || {};
            const horizon = TRIGGER_HORIZONS[trigger] || '7d';
            const owner = TRIGGER_OWNERS[trigger] || 'Growth';
            const priority = assessment.severity || 'medium';

            actions.push({
                id: `momentum-${trigger}-${prod.key}`,
                priority,
                horizon,
                owner,
                title: assessment.headline || `${prod.title} — ${trigger.replace(/_/g, ' ')}`,
                why: assessment.subline || assessment.action || '',
                kpi: assessment.kpi || 'Monitor product rank and revenue share',
                target: 'topProducts',
                signal: prod.statistical?.signal,
                trigger
            });
        });
    } else {
        // Fallback: original logic
        if (upInsight) {
            const title = cleanMoverProductTitle(upInsight.title, 'surged') || 'Top mover';
            actions.push({
                id: 'scale-momentum',
                priority: upInsight.severity || 'critical',
                horizon: '24-48h',
                owner: 'Growth',
                title: `Scale ${title} while momentum is active`,
                why: upInsight.detail,
                kpi: upInsight.assessment?.kpi || 'Unit velocity + rank movement',
                target: 'topProducts',
                signal: upInsight.signal
            });
        }

        if (downInsight) {
            const title = cleanMoverProductTitle(downInsight.title, 'softened') || 'Declining SKU';
            actions.push({
                id: 'stabilize-decliner',
                priority: downInsight.severity || 'critical',
                horizon: '24-48h',
                owner: 'Merch',
                title: `Investigate ${title} conversion drag`,
                why: downInsight.detail,
                kpi: downInsight.assessment?.kpi || 'PDP conversion + return/refund trend',
                target: 'topProducts',
                signal: downInsight.signal
            });
        }
    }

    if (discountRevenueShare >= ACTION_PLANNER_RULES.discountRevenueRiskShare) {
        actions.push({
            id: 'discount-pressure',
            priority: 'high',
            horizon: '7d',
            owner: 'Pricing',
            title: 'Reduce discount dependence on revenue-driving SKUs',
            why: `Discounted revenue share is ${formatPercent(discountRevenueShare)} in this window.`,
            kpi: 'Gross margin + full-price order share',
            target: 'discountRefund'
        });
    }

    if (normalizedRepeatRate != null && normalizedRepeatRate < ACTION_PLANNER_RULES.repeatRateOpportunity) {
        actions.push({
            id: 'retention-loop',
            priority: 'high',
            horizon: '28d',
            owner: 'CRM',
            title: 'Launch repeat-order recovery loop',
            why: `Repeat rate is ${formatPercent(normalizedRepeatRate)}; below the target floor of ${formatPercent(ACTION_PLANNER_RULES.repeatRateOpportunity)}.`,
            kpi: 'Repeat rate + 90-day LTV',
            target: 'cohorts'
        });
    }

    if (bundleTop) {
        actions.push({
            id: 'bundle-rollout',
            priority: 'medium',
            horizon: '7d',
            owner: 'Merch',
            title: 'Deploy top bundle pairing into PDP/cart surfaces',
            why: `${bundleTop.pair?.[0] || 'Anchor'} + ${bundleTop.pair?.[1] || 'Attach'} shows the strongest attach signal this window.`,
            kpi: 'Attach rate + bundle AOV',
            target: 'bundles'
        });
    }

    if (cityCoverage != null && cityCoverage < ACTION_PLANNER_RULES.lowCityCoverage) {
        actions.push({
            id: 'city-data-coverage',
            priority: 'medium',
            horizon: '7d',
            owner: 'Data Ops',
            title: 'Improve city capture quality for channel decisions',
            why: `City coverage is ${formatPercent(cityCoverage)}, which weakens location-level optimization confidence.`,
            kpi: 'City coverage rate',
            target: 'segments'
        });
    }

    if (countryCoverage != null && countryCoverage < ACTION_PLANNER_RULES.lowCountryCoverage) {
        actions.push({
            id: 'country-data-coverage',
            priority: 'medium',
            horizon: '7d',
            owner: 'Data Ops',
            title: 'Close country attribution gaps before scaling geo spend',
            why: `Country coverage is ${formatPercent(countryCoverage)}; geo-level spend control is partially blind.`,
            kpi: 'Country coverage rate',
            target: 'segments'
        });
    }

    const topRevenue = (topProducts || []).reduce((sum, row) => sum + (row.revenue || 0), 0);
    const leaderShare = topRevenue > 0 ? (topProducts?.[0]?.revenue || 0) / topRevenue : 0;
    if (leaderShare >= ACTION_PLANNER_RULES.concentrationRiskShare) {
        actions.push({
            id: 'portfolio-risk',
            priority: 'low',
            horizon: '90d',
            owner: 'Leadership',
            title: 'Reduce portfolio concentration risk',
            why: `Top product contributes ${formatPercent(leaderShare)} of tracked product revenue in this window.`,
            kpi: 'Top SKU revenue share + category depth',
            target: 'topProducts'
        });
    }

    if (!actions.length && orders >= ACTION_PLANNER_RULES.minOrdersForStrongSignal) {
        actions.push({
            id: 'steady-state',
            priority: 'low',
            horizon: '7d',
            owner: 'Growth',
            title: 'Run one controlled experiment on top products',
            why: 'Signal quality is stable; use this window to test one focused conversion or pricing hypothesis.',
            kpi: 'Test lift vs control',
            target: 'topProducts'
        });
    }

    return actions
        .sort((a, b) => {
            const byHorizon = (TIMELINE_ORDER[a.horizon] ?? 99) - (TIMELINE_ORDER[b.horizon] ?? 99);
            if (byHorizon !== 0) return byHorizon;
            return (ACTION_PRIORITY[a.priority] ?? 99) - (ACTION_PRIORITY[b.priority] ?? 99);
        })
        .slice(0, 8);
}

function buildTimelineSummary(actions) {
    return TIMELINE_PLAYBOOK.map((timeline) => {
        const timelineActions = actions.filter((action) => action.horizon === timeline.label);
        return {
            ...timeline,
            actionCount: timelineActions.length,
            status: timelineActions.length ? 'Action needed' : 'No blockers detected',
            topAction: timelineActions[0]?.title || null
        };
    });
}

function buildGuardrails(data, actions, momentumData) {
    const notes = [];
    const orders = data?.dataQuality?.orders || 0;
    const hasItems = Boolean(data?.dataQuality?.hasItems);
    const cityCoverage = normalizeUnitShare(data?.sections?.segments?.geo?.cityCoverage);
    const countryCoverage = normalizeUnitShare(data?.sections?.segments?.geo?.countryCoverage);
    const compareDays = data?.window?.days;

    if (compareDays) {
        notes.push({
            id: 'window-logic',
            text: `Window logic: current period is compared to the immediately previous ${compareDays}-day window.`
        });
    }

    // Momentum engine signal quality note
    const allMomentum = [...(momentumData?.momentum || []), ...(momentumData?.watch || [])];
    const confirmedCount = allMomentum.filter((p) => p.statistical?.signal === 'Confirmed' || p.statistical?.signal === 'Likely').length;
    if (confirmedCount > 0) {
        notes.push({
            id: 'momentum-confidence',
            text: `${confirmedCount} product signal${confirmedCount === 1 ? '' : 's'} confirmed or likely via statistical testing (z-test + BH FDR correction).`
        });
    }

    if (orders < ACTION_PLANNER_RULES.minOrdersForStrongSignal) {
        notes.push({
            id: 'low-signal',
            text: `Signal volume is light (${formatNumber(orders)} orders). Treat movement as directional until volume increases.`
        });
    }

    if (!hasItems) {
        notes.push({
            id: 'incomplete-items',
            text: 'Line-item detail is incomplete, so product-level actions are provisional.'
        });
    }

    if (cityCoverage != null && cityCoverage < ACTION_PLANNER_RULES.lowCityCoverage) {
        notes.push({
            id: 'low-city-coverage',
            text: `City coverage (${formatPercent(cityCoverage)}) is below the quality floor (${formatPercent(ACTION_PLANNER_RULES.lowCityCoverage)}).`
        });
    }

    if (countryCoverage != null && countryCoverage < ACTION_PLANNER_RULES.lowCountryCoverage) {
        notes.push({
            id: 'low-country-coverage',
            text: `Country coverage (${formatPercent(countryCoverage)}) is below the quality floor (${formatPercent(ACTION_PLANNER_RULES.lowCountryCoverage)}).`
        });
    }

    if (!actions.length) {
        notes.push({
            id: 'no-actions',
            text: 'No high-priority actions were triggered this cycle. Keep monitoring and run one controlled test per week.'
        });
    }

    return notes.slice(0, 5);
}

// ── Sparkline component ──────────────────────────────────────────────────────
function MiniSparkline({ data, color = '#6366f1' }) {
    if (!data?.length || data.length < 2) return null;
    return (
        <div className="h-6 w-16">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                    <Line type="monotone" dataKey="orders" stroke={color} strokeWidth={1.5} dot={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

// ── Signal badge ─────────────────────────────────────────────────────────────
function SignalBadge({ signal }) {
    if (!signal) return null;
    const colors = {
        Confirmed: 'bg-emerald-100 text-emerald-700',
        Likely: 'bg-blue-100 text-blue-700',
        Possible: 'bg-amber-100 text-amber-700',
        Emerging: 'bg-slate-100 text-slate-600'
    };
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors[signal] || colors.Emerging}`}>
            {signal}
        </span>
    );
}

// ── Watchlist column with sparklines ─────────────────────────────────────────
function WatchlistColumn({ listKey, items }) {
    const config = WATCHLIST_COPY[listKey];
    const Icon = config.icon;
    const sparklineColor = listKey === 'breakout' ? '#10b981' : listKey === 'atRisk' ? '#f59e0b' : '#94a3b8';

    return (
        <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-full ${config.bg} ${config.accent}`}>
                    <Icon className="h-4 w-4" />
                </div>
                <div>
                    <div className="text-sm font-semibold text-gray-900">{config.title}</div>
                    <div className="text-xs text-gray-500">{config.subtitle}</div>
                </div>
            </div>

            <div className="mt-3 space-y-2">
                {(items || []).length ? (
                    items.map((row) => (
                        <div key={`${listKey}-${row.title}`} className="rounded-lg border border-gray-100 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-gray-900 truncate">{row.title}</div>
                                    <div className="mt-1 text-xs text-gray-500">{row.note}</div>
                                </div>
                                {row.sparkline ? (
                                    <MiniSparkline data={row.sparkline} color={sparklineColor} />
                                ) : null}
                            </div>
                            {row.severity ? (
                                <div className="mt-1">
                                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${SEVERITY_COLORS[row.severity]?.pill || SEVERITY_COLORS.low.pill}`}>
                                        {row.severity}
                                    </span>
                                </div>
                            ) : null}
                        </div>
                    ))
                ) : (
                    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-500">
                        No products flagged right now.
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Exceptional event banner ─────────────────────────────────────────────────
function ExceptionalEventBanners({ momentumData }) {
    const allProducts = [...(momentumData?.momentum || []), ...(momentumData?.watch || [])];
    const eventsToShow = allProducts
        .filter((p) => p.exceptionalEvent)
        .slice(0, 2);

    if (!eventsToShow.length) return null;

    return (
        <div className="space-y-2">
            {eventsToShow.map((prod) => {
                const isNegative = ['first_hero_slip', 'sharp_reversal'].includes(prod.exceptionalEvent);
                const borderColor = isNegative ? 'border-amber-200' : 'border-emerald-200';
                const bgColor = isNegative ? 'bg-amber-50' : 'bg-emerald-50';
                const icon = isNegative ? '⚠️' : '⚡';

                return (
                    <div key={`event-${prod.key}`} className={`rounded-xl border ${borderColor} ${bgColor} px-4 py-3`}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold text-gray-900">
                                    {icon} {prod.assessment?.headline || prod.title}
                                </div>
                                {prod.assessment?.subline ? (
                                    <div className="mt-1 text-xs text-gray-600">{prod.assessment.subline}</div>
                                ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                                <SignalBadge signal={prod.statistical?.signal} />
                                {prod.sparkline?.length > 1 ? (
                                    <MiniSparkline
                                        data={prod.sparkline}
                                        color={isNegative ? '#f59e0b' : '#10b981'}
                                    />
                                ) : null}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default function CustomerActionPlanner({ data, onOpenSection, embedded = false }) {
    const plan = useMemo(() => {
        const sections = data?.sections || {};
        const insights = data?.insights || [];
        const topProducts = sections.topProducts?.products || [];
        const discountMetrics = sections.discountRefund?.metrics || {};
        const discountSkus = sections.discountRefund?.discountSkus || [];
        const repeatRate = getKpiValue(data?.kpis, 'repeat-rate');
        const momentumData = sections.productMomentum || null;

        const upInsight = insights.find((insight) => insight.id === 'product-mover-up') || null;
        const downInsight = insights.find((insight) => insight.id === 'product-mover-down') || null;

        const actions = buildActions({
            data,
            topProducts,
            discountMetrics,
            repeatRate,
            upInsight,
            downInsight,
            momentumData
        });

        return {
            timeline: buildTimelineSummary(actions),
            actions,
            watchlists: buildWatchlists({ topProducts, discountSkus, upInsight, downInsight, momentumData }),
            guardrails: buildGuardrails(data, actions, momentumData),
            momentumData
        };
    }, [data]);

    return (
        <section className={embedded ? 'rounded-xl border border-gray-100 bg-gray-50/40 p-4' : 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm'}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">Decision cockpit</div>
                    <h3 className="mt-1 text-lg font-semibold text-gray-900">Turn customer data into weekly decisions</h3>
                    <p className="mt-1 text-sm text-gray-600">
                        Every card below ties a timeline to a concrete owner, action, and KPI so the tab stays operational instead of descriptive.
                    </p>
                </div>
                <div className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                    Dynamic action plan
                </div>
            </div>

            {/* Layer 2: Exceptional event banners */}
            {plan.momentumData ? (
                <div className="mt-4">
                    <ExceptionalEventBanners momentumData={plan.momentumData} />
                </div>
            ) : null}

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {plan.timeline.map((item) => {
                    const Icon = item.icon;
                    return (
                        <div key={item.key} className={`rounded-xl border ${item.border} ${item.bg} p-4`}>
                            <div className="flex items-center justify-between gap-2">
                                <div className={`text-xs font-semibold uppercase tracking-wide ${item.accent}`}>{item.label}</div>
                                <Icon className={`h-4 w-4 ${item.accent}`} />
                            </div>
                            <div className="mt-2 text-sm font-semibold text-gray-900">{item.title}</div>
                            <div className="mt-1 text-xs text-gray-600">{item.objective}</div>
                            <div className="mt-3 text-xs text-gray-500">
                                {item.actionCount ? `${item.actionCount} action${item.actionCount === 1 ? '' : 's'} queued` : item.status}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2 rounded-xl border border-gray-100 bg-white p-4">
                    <div className="flex items-center gap-2">
                        <Rocket className="h-4 w-4 text-indigo-600" />
                        <div className="text-sm font-semibold text-gray-900">Priority actions</div>
                    </div>

                    <div className="mt-3 space-y-2">
                        {plan.actions.length ? (
                            plan.actions.map((action) => (
                                <div key={action.id} className="rounded-lg border border-gray-100 px-3 py-3">
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div>
                                            <div className="text-sm font-semibold text-gray-900">{action.title}</div>
                                            <div className="mt-1 text-xs text-gray-600">{action.why}</div>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="rounded-full border border-gray-200 px-2 py-0.5 font-semibold text-gray-700">{action.horizon}</span>
                                            <span className="rounded-full border border-gray-200 px-2 py-0.5 text-gray-600">{action.owner}</span>
                                            {action.signal ? <SignalBadge signal={action.signal} /> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
                                        <div className="text-xs text-gray-500">KPI to watch: {action.kpi}</div>
                                        {action.target ? (
                                            <button
                                                type="button"
                                                onClick={() => onOpenSection?.(action.target)}
                                                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                                            >
                                                Open section <ArrowUpRight className="h-3 w-3" />
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                                No urgent actions detected in this window.
                            </div>
                        )}
                    </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-4">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        <div className="text-sm font-semibold text-gray-900">Signal guardrails</div>
                    </div>
                    <div className="mt-3 space-y-2">
                        {plan.guardrails.map((note) => (
                            <div key={note.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                {note.text}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <WatchlistColumn listKey="breakout" items={plan.watchlists.breakout} />
                <WatchlistColumn listKey="atRisk" items={plan.watchlists.atRisk} />
                <WatchlistColumn listKey="fading" items={plan.watchlists.fading} />
            </div>

            <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-800">
                <div className="font-semibold">Operating cadence</div>
                <div className="mt-1">
                    Daily: monitor 24-48h actions. Weekly: ship 7d tests. Monthly: evaluate 28d retention lift. Quarterly: rebalance 90d assortment decisions.
                </div>
            </div>
        </section>
    );
}
