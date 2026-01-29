import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { Globe2, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import AttributionChatDrawer from './AttributionChatDrawer';
import { COUNTRIES } from '../data/countries';

const QUICK_RANGES = [
  { id: 'today', label: 'Today' },
  { id: '3d', label: '3D', days: 3 },
  { id: '7d', label: '7D', days: 7 },
  { id: '14d', label: '14D', days: 14 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: 'custom', label: 'Custom' }
];

const GMT3_OFFSET_MS = 3 * 60 * 60 * 1000;

const getGmt3DateString = (date = new Date()) => {
  const gmt3Date = new Date(date.getTime() + GMT3_OFFSET_MS);
  return gmt3Date.toISOString().slice(0, 10);
};

const addDays = (dateStr, days) => {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return getGmt3DateString(date);
};

const formatPercent = (value) => {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
};

const computeRateDomain = (points, { padding = 0.05, minSpan = 0.15 } = {}) => {
  const values = (points || []).filter((value) => value != null && Number.isFinite(value));
  if (!values.length) return [0, 1];

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  let min = Math.max(0, rawMin - padding);
  let max = Math.min(1, rawMax + padding);

  if (max - min < minSpan) {
    const center = (min + max) / 2;
    min = Math.max(0, center - minSpan / 2);
    max = Math.min(1, center + minSpan / 2);
    if (max - min < minSpan) {
      if (min === 0) max = Math.min(1, minSpan);
      if (max === 1) min = Math.max(0, 1 - minSpan);
    }
  }

  return [min, max];
};

export default function AttributionTab({ store, formatNumber, formatCurrency }) {
  const [rangePreset, setRangePreset] = useState('30d');
  const [customRange, setCustomRange] = useState({
    start: getGmt3DateString(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)),
    end: getGmt3DateString()
  });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chatConfig, setChatConfig] = useState({
    open: false,
    mode: 'assistant',
    title: 'Attribution Assistant',
    subtitle: '',
    context: null,
    autoPrompt: ''
  });

  const [countryDrawerOpen, setCountryDrawerOpen] = useState(false);
  const [selectedCountryCode, setSelectedCountryCode] = useState('');
  const [countrySummary, setCountrySummary] = useState(null);
  const [countryLoading, setCountryLoading] = useState(false);
  const [countryError, setCountryError] = useState('');

  const countryMap = useMemo(() => {
    const map = new Map();
    COUNTRIES.forEach((country) => map.set(country.code, country.name));
    return map;
  }, []);

  const isTodayView = rangePreset === 'today';

  const resolvedRange = useMemo(() => {
    const preset = QUICK_RANGES.find((item) => item.id === rangePreset);
    if (!preset || preset.id === 'custom') {
      return customRange;
    }

    const end = getGmt3DateString();

    if (preset.id === 'today') {
      return { start: end, end };
    }

    const days = Math.max(1, Number(preset.days) || 1);
    const start = addDays(end, -(days - 1));
    return { start, end };
  }, [rangePreset, customRange]);

  const fetchSummary = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        store: store.id,
        start: resolvedRange.start,
        end: resolvedRange.end
      });

      const res = await fetch(`/api/attribution/summary?${params.toString()}`);
      const data = await res.json();

      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Unable to load attribution data.');
      }

      setSummary(data);
    } catch (err) {
      setError(err.message || 'Unable to load attribution data.');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [store?.id, resolvedRange.start, resolvedRange.end]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const fetchCountrySeries = useCallback(async (countryCode) => {
    if (!store?.id || !countryCode) return;

    setCountryLoading(true);
    setCountryError('');

    try {
      const params = new URLSearchParams({
        store: store.id,
        country: countryCode,
        start: resolvedRange.start,
        end: resolvedRange.end
      });

      const res = await fetch(`/api/attribution/country-series?${params.toString()}`);
      const data = await res.json();

      if (!res.ok || data.success === false) {
        throw new Error(data.error || 'Unable to load country attribution.');
      }

      setCountrySummary(data);
    } catch (err) {
      setCountryError(err.message || 'Unable to load country attribution.');
      setCountrySummary(null);
    } finally {
      setCountryLoading(false);
    }
  }, [store?.id, resolvedRange.start, resolvedRange.end]);

  useEffect(() => {
    if (!countryDrawerOpen || !selectedCountryCode) return;
    fetchCountrySeries(selectedCountryCode);
  }, [countryDrawerOpen, selectedCountryCode, fetchCountrySeries]);

  const totals = summary?.totals || {};
  const isReady = Boolean(summary);
  const series = summary?.series || [];
  const alerts = summary?.alerts || [];
  const countryGaps = summary?.countryGaps || [];
  const unattributedOrders = summary?.unattributedOrders || [];
  const countryBreakdownAvailable = summary?.countryBreakdownAvailable ?? false;
  const attributionDataAvailable = summary?.attributionDataAvailable ?? false;

  const assistantContext = useMemo(() => ({
    store: store?.id,
    period: summary?.period,
    compare: summary?.compare,
    totals: summary?.totals,
    compareTotals: summary?.compareTotals,
    diagnostics: summary?.diagnostics,
    topCountries: countryGaps.slice(0, 5),
    alerts,
    countryBreakdownAvailable,
    attributionDataAvailable,
    finalizedEndDate: summary?.finalizedEndDate,
    signalWindow: summary?.signalWindow
  }), [store?.id, summary, countryGaps, alerts, countryBreakdownAvailable, attributionDataAvailable]);

  const openAssistant = () => {
    setChatConfig({
      open: true,
      mode: 'assistant',
      title: 'Attribution Assistant',
      subtitle: 'Instant answers with context-aware insights',
      context: assistantContext,
      autoPrompt: ''
    });
  };

  const openAlertDebug = (alert) => {
    setChatConfig({
      open: true,
      mode: 'debug',
      title: 'Attribution Debug',
      subtitle: 'Claude Opus',
      context: { alert, ...assistantContext },
      autoPrompt: `Explain this alert and list the most likely fixes: ${alert.title}.`
    });
  };

  const openCountryDrawer = (countryCode) => {
    const normalized = (countryCode || '').toString().trim().toUpperCase();
    setSelectedCountryCode(normalized || '');
    setCountrySummary(null);
    setCountryError('');
    setCountryDrawerOpen(true);
  };

  const renderTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload || {};
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg">
        <div className="text-[11px] text-slate-500">{label}</div>
        <div className="mt-1 flex flex-col gap-1">
          <span>Shopify: {formatNumber(point.shopifyOrders || 0)}</span>
          <span>Meta: {formatNumber(point.metaOrders || 0)}</span>
          <span>Unattributed: {formatNumber(point.unattributed || 0)}</span>
          <span>Coverage: {formatPercent(point.coverageRate)}</span>
        </div>
      </div>
    );
  };

  const countrySeries = countrySummary?.series || [];
  const countryTotals = countrySummary?.totals || {};

  const countryDomain = useMemo(() => {
    const values = countrySeries.map((row) => row.coverageRate);
    return computeRateDomain(values, { padding: 0.06, minSpan: 0.18 });
  }, [countrySeries]);

  const renderCountryTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload || {};
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg">
        <div className="text-[11px] text-slate-500">{label}</div>
        <div className="mt-1 flex flex-col gap-1">
          <span>Coverage: {formatPercent(point.coverageRate)}</span>
          <span>Shopify: {formatNumber(point.shopifyOrders || 0)}</span>
          <span>Meta: {formatNumber(point.metaOrders || 0)}</span>
          <span>Missed: {formatNumber(point.unattributed || 0)}</span>
        </div>
      </div>
    );
  };

  const selectedCountryName = selectedCountryCode
    ? (selectedCountryCode === 'UN' ? 'Unknown' : (countryMap.get(selectedCountryCode) || selectedCountryCode))
    : '';

  return (
    <motion.div
      className="space-y-8"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <div className="rounded-[32px] border border-slate-200/70 bg-gradient-to-br from-white via-slate-50 to-indigo-50/40 p-8 shadow-[0_30px_60px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold text-slate-900">Attribution</h2>
            <p className="text-sm text-slate-500">Track Shopify vs Meta orders and spot attribution gaps fast.</p>
            {summary?.finalizedEndDate && (
              <div className="mt-2 text-xs text-slate-500">
                Finalized through <span className="font-semibold text-slate-700">{summary.finalizedEndDate}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm">
            {QUICK_RANGES.map((range) => (
              <button
                key={range.id}
                onClick={() => setRangePreset(range.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  rangePreset === range.id
                    ? 'bg-slate-900 text-white shadow-[0_10px_24px_rgba(15,23,42,0.25)]'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {rangePreset === 'custom' && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span>Start</span>
              <input
                type="date"
                value={customRange.start}
                max={customRange.end}
                onChange={(event) => setCustomRange((prev) => ({ ...prev, start: event.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <span>End</span>
              <input
                type="date"
                value={customRange.end}
                max={getGmt3DateString()}
                onChange={(event) => setCustomRange((prev) => ({ ...prev, end: event.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              />
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Shopify Orders', value: isReady ? (totals.shopifyOrders || 0) : '-' },
            { label: 'Meta Orders', value: isReady ? (totals.metaOrders || 0) : '-' },
            { label: 'Coverage Rate', value: isReady ? formatPercent(totals.coverageRate) : '-' },
            { label: 'Unattributed', value: isReady ? (totals.unattributed || 0) : '-' }
          ].map((card) => (
            <motion.div
              key={card.label}
              whileHover={{ y: -2 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className="rounded-2xl border border-white/50 bg-white/80 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur"
            >
              <div className="text-xs uppercase tracking-wide text-slate-400">{card.label}</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {typeof card.value === 'string' ? card.value : formatNumber(card.value)}
              </div>
            </motion.div>
          ))}
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-12">
          <div className="xl:col-span-8 rounded-2xl border border-white/60 bg-white/80 p-6 shadow-[0_12px_32px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-900">Order coverage over time</div>
                <div className="text-xs text-slate-500">Shopify vs Meta with unattributed gap.</div>
              </div>
              <div className="text-xs text-slate-400">{summary?.period?.start} to {summary?.period?.end}</div>
            </div>

            {!isTodayView && (
              <div className="mt-3 text-xs text-slate-500">
                Signals use finalized days (to avoid false gaps from Meta reporting lag).
              </div>
            )}

            <div className={`mt-6 ${isTodayView ? 'h-0' : 'h-64'}`}>
              {isTodayView ? null : loading ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading insights...</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={renderTooltip} />
                    <Area type="monotone" dataKey="unattributed" fill="rgba(248,113,113,0.10)" stroke="none" />
                    <Line type="monotone" dataKey="shopifyOrders" stroke="#0f172a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="metaOrders" stroke="#6366f1" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {isTodayView && (
              <div className="mt-6 rounded-xl border border-slate-200/70 bg-slate-50/60 px-4 py-3 text-sm text-slate-600">
                Today is shown as totals only. Switch to 3D+ to see a trend line.
              </div>
            )}
          </div>

          <div className="xl:col-span-4 space-y-6">
            {alerts.length > 0 && (
              <div className="rounded-2xl border border-white/60 bg-white/80 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.08)] backdrop-blur">
                <div className="text-sm font-semibold text-slate-900">Signals</div>
                <div className="mt-4 space-y-4">
                  {alerts.map((alert) => (
                    <motion.div
                      key={alert.id}
                      whileHover={{ y: -1 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                      className="rounded-xl border border-slate-200/70 bg-white px-4 py-3"
                    >
                      <div className="text-sm font-semibold text-slate-900">{alert.title}</div>
                      <div className="mt-1 text-xs text-slate-600">{alert.message}</div>
                      <div className="mt-2 text-[11px] text-slate-500">Fix: {alert.fix}</div>
                      <button
                        type="button"
                        onClick={() => openAlertDebug(alert)}
                        className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-300"
                      >
                        <Sparkles className="h-3 w-3" />
                        Ask AI
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-white/60 bg-white/80 p-5 shadow-[0_12px_32px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">Countries with the largest gap</div>
                <button
                  type="button"
                  onClick={() => openCountryDrawer(countryGaps[0]?.countryCode || 'US')}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-300"
                >
                  <Globe2 className="h-3 w-3" />
                  View any country
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {loading ? (
                  <div className="text-xs text-slate-500">Loading country gaps...</div>
                ) : !countryBreakdownAvailable ? (
                  <div className="text-xs text-slate-500">Country breakdown is not available for this period.</div>
                ) : countryGaps.length === 0 ? (
                  <div className="text-xs text-slate-500">No country gaps detected for this period.</div>
                ) : null}

                {!loading && countryBreakdownAvailable && countryGaps.map((row) => {
                  const name = countryMap.get(row.countryCode) || row.countryCode || 'Unknown';
                  const coverage = row.coverageRate != null ? Math.min(100, Math.round(row.coverageRate * 100)) : 0;
                  return (
                    <button
                      key={row.countryCode}
                      type="button"
                      onClick={() => openCountryDrawer(row.countryCode)}
                      className="w-full rounded-xl border border-slate-200/60 bg-white px-3 py-3 text-left transition hover:border-slate-300 hover:shadow-sm"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span className="font-semibold text-slate-800">{name}</span>
                        <span>{formatNumber(row.gap)} gap</span>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-slate-900"
                          style={{ width: `${coverage}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Coverage {formatPercent(row.coverageRate)}</span>
                        <span className="text-slate-400">Click to view trend</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-white/60 bg-white/80 p-6 shadow-[0_12px_32px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Unattributed orders</div>
              <div className="text-xs text-slate-500">Examples capped to the computed gap per day/country.</div>
            </div>
            <div className="text-xs text-slate-400">Showing {unattributedOrders.length} orders</div>
          </div>

          <div className="mt-4 overflow-x-auto">
            {loading ? (
              <div className="rounded-xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500">
                Loading unattributed orders...
              </div>
            ) : !attributionDataAvailable ? (
              <div className="rounded-xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500">
                Attribution details are not available for this store yet.
              </div>
            ) : unattributedOrders.length === 0 ? (
              <div className="rounded-xl border border-slate-200/70 bg-white p-4 text-sm text-slate-500">
                No unattributed orders detected in this period.
              </div>
            ) : (
              <table className="min-w-full text-left text-xs text-slate-600">
                <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-2">Date</th>
                    <th className="py-2">Order</th>
                    <th className="py-2">Country</th>
                    <th className="py-2">Reason</th>
                    <th className="py-2">First touch</th>
                    <th className="py-2">Last touch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {unattributedOrders.map((order) => (
                    <tr key={order.orderId} className="align-top">
                      <td className="py-3 pr-4 text-slate-700">{order.date}</td>
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-slate-800">#{order.orderId}</div>
                        <div className="text-[11px] text-slate-500">{formatCurrency(order.orderTotal, 0)}</div>
                      </td>
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          onClick={() => openCountryDrawer(order.countryCode)}
                          className="rounded-md px-2 py-1 text-left text-slate-700 hover:bg-slate-100"
                        >
                          {countryMap.get(order.countryCode) || order.countryCode}
                        </button>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-slate-700">{order.reason}</div>
                        <div className="text-[11px] text-slate-500">Fix: {order.fix}</div>
                      </td>
                      <td className="py-3 pr-4 text-[11px] text-slate-600">{order.firstTouch}</td>
                      <td className="py-3 pr-4 text-[11px] text-slate-600">{order.lastTouch}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={openAssistant}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.3)]"
      >
        <Sparkles className="h-4 w-4" />
        Ask AI
      </button>

      <AttributionChatDrawer
        open={chatConfig.open}
        onOpenChange={(open) => setChatConfig((prev) => ({ ...prev, open }))}
        title={chatConfig.title}
        subtitle={chatConfig.subtitle}
        mode={chatConfig.mode}
        context={chatConfig.context}
        autoPrompt={chatConfig.autoPrompt}
      />

      <AnimatePresence>
        {countryDrawerOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCountryDrawerOpen(false)}
            />
            <motion.div
              className="fixed right-0 top-0 z-50 h-full w-full max-w-xl border-l border-white/60 bg-white/90 backdrop-blur-xl shadow-[0_0_0_1px_rgba(15,23,42,0.08),0_20px_60px_rgba(15,23,42,0.18),0_0_40px_rgba(99,102,241,0.18)]"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between border-b border-slate-200/70 px-6 py-4">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">Country attribution rate</div>
                    <div className="mt-1 text-xs text-slate-500">Single-line coverage trend for a selected country.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCountryDrawerOpen(false)}
                    className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition hover:text-slate-900"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">{selectedCountryName}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Country</span>
                      <select
                        value={selectedCountryCode}
                        onChange={(e) => setSelectedCountryCode(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                      >
                        <option value="">Select</option>
                        <option value="UN">Unknown</option>
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {countryError && (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {countryError}
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {[
                      { label: 'Shopify', value: countryTotals.shopifyOrders || 0 },
                      { label: 'Meta', value: countryTotals.metaOrders || 0 },
                      { label: 'Coverage', value: formatPercent(countryTotals.coverageRate) },
                      { label: 'Missed', value: countryTotals.unattributed || 0 }
                    ].map((card) => (
                      <div
                        key={card.label}
                        className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
                      >
                        <div className="text-[11px] uppercase tracking-wide text-slate-400">{card.label}</div>
                        <div className="mt-2 text-lg font-semibold text-slate-900">
                          {typeof card.value === 'string' ? card.value : formatNumber(card.value)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Coverage over time</div>
                        <div className="text-xs text-slate-500">Line breaks on days with zero Shopify orders.</div>
                      </div>
                      <div className="text-xs text-slate-400">{resolvedRange.start} to {resolvedRange.end}</div>
                    </div>

                    <div className="mt-5 h-64">
                      {countryLoading ? (
                        <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading country trend...</div>
                      ) : !countrySeries.length ? (
                        <div className="flex h-full items-center justify-center text-sm text-slate-500">
                          No data for this country in the selected period.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={countrySeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis
                              tick={{ fontSize: 10 }}
                              domain={countryDomain}
                              tickFormatter={(v) => `${Math.round(v * 100)}%`}
                            />
                            <Tooltip content={renderCountryTooltip} />
                            <Line
                              type="monotone"
                              dataKey="coverageRate"
                              stroke="#6366f1"
                              strokeWidth={3}
                              dot={false}
                              connectNulls={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
