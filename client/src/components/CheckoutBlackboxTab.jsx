import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';

const DEFAULT_LOOKBACK_DAYS = 3;
const EVENT_LIMIT_OPTIONS = [100, 200, 500];
const DEFAULT_EVENT_LIMIT = 200;
const CSV_EXPORT_LIMIT = 5000;
const AUTO_REFRESH_INTERVAL_MS = 30 * 1000;

function getIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultRange(days = DEFAULT_LOOKBACK_DAYS) {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return {
    startDate: getIsoDate(start),
    endDate: getIsoDate(end)
  };
}

function buildQueryString(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
}

function formatNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0';
  return new Intl.NumberFormat().format(parsed);
}

function formatPercent(value, digits = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0%';
  return `${(parsed * 100).toFixed(digits)}%`;
}

function formatTimestamp(value) {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatSessionIdentity(row) {
  return row?.session_id || row?.client_id || row?.ip_hash || '—';
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const raw = await res.text();

  let data = null;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    throw new Error(`Non-JSON response from ${url}`);
  }

  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </div>
  );
}

function OrderCandidatesTable({ title, hint, rows, emptyLabel }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
      <div className="mt-3 max-h-80 overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">Order</th>
              <th className="py-2 pr-3">Created</th>
              <th className="py-2 pr-3">Geo</th>
              <th className="py-2 pr-3">Coverage</th>
              <th className="py-2">Approx Last Checkout</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={`${row.order_id}-${row.delivery_status || 'candidate'}`} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div className="font-mono">{row.order_id}</div>
                  <div>{row.currency || ''} {row.order_total || ''}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">{formatTimestamp(row.order_created_at || row.date)}</td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>{row.country_code || '—'}</div>
                  <div className="text-gray-500">{[row.city, row.state].filter(Boolean).join(', ') || '—'}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div className="font-mono">{row.purchase_path_summary || 'none'}</div>
                  <div className="text-gray-500">events: {formatNumber(row.purchase_events || 0)}</div>
                </td>
                <td className="py-2 text-xs text-gray-700">
                  <div>{formatTimestamp(row.approx_last_begin_checkout_at)}</div>
                  <div className="text-gray-500">{row.approx_last_checkout_button || '—'}</div>
                </td>
              </tr>
            )) : (
              <tr>
                <td className="py-3 text-sm text-gray-500" colSpan={5}>{emptyLabel}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CheckoutBlackboxTab({ store }) {
  const storeId = store?.id || 'shawq';
  const [range, setRange] = useState(() => getDefaultRange(DEFAULT_LOOKBACK_DAYS));
  const [eventName, setEventName] = useState('');
  const [source, setSource] = useState('');
  const [sessionHint, setSessionHint] = useState('');
  const [limit, setLimit] = useState(DEFAULT_EVENT_LIMIT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState('');
  const [overview, setOverview] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventOptions, setEventOptions] = useState([]);
  const [sourceOptions, setSourceOptions] = useState([]);

  const baseQuery = useMemo(() => ({
    store: storeId,
    startDate: range.startDate,
    endDate: range.endDate
  }), [storeId, range.endDate, range.startDate]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const cacheBust = Date.now();
      const common = {
        ...baseQuery,
        eventName,
        source,
        sessionHint,
        _ts: cacheBust
      };
      const overviewQuery = buildQueryString(common);
      const eventsQuery = buildQueryString({
        ...common,
        limit,
        offset: 0
      });

      const [overviewResponse, eventsResponse] = await Promise.all([
        fetchJson(`/api/blackbox/overview?${overviewQuery}`),
        fetchJson(`/api/blackbox/events?${eventsQuery}`)
      ]);

      setOverview(overviewResponse.data || null);
      setEvents(eventsResponse.data?.rows || []);
      setEventsTotal(Number(eventsResponse.data?.total || 0));
      setEventOptions(eventsResponse.data?.options?.eventNames || []);
      setSourceOptions(eventsResponse.data?.options?.sources || []);
      setLastRefreshedAt(new Date().toISOString());
    } catch (loadError) {
      setError(loadError?.message || 'Failed to load Blackbox data');
    } finally {
      setLoading(false);
    }
  }, [baseQuery, eventName, limit, sessionHint, source]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData();
      }
    };

    const handleWindowFocus = () => {
      loadData();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [loadData]);

  const handleExportCsv = useCallback(() => {
    const query = buildQueryString({
      ...baseQuery,
      eventName,
      source,
      sessionHint,
      limit: CSV_EXPORT_LIMIT
    });
    window.open(`/api/blackbox/export.csv?${query}`, '_blank', 'noopener,noreferrer');
  }, [baseQuery, eventName, sessionHint, source]);

  const duplicateGroups = overview?.duplicates?.groups || [];
  const topDuplicateButtons = overview?.duplicates?.top_buttons || [];
  const ghostSessions = overview?.ghost_sessions || [];
  const hardGhostOrders = overview?.hard_ghost_orders || overview?.ghost_orders || [];
  const recoveredWebhookOrders = overview?.recovered_webhook_only_orders || [];
  const partialMissOrders = overview?.partial_miss_orders || [];
  const noTelemetryOrders = overview?.no_telemetry_orders || [];
  const summary = overview?.summary || {};
  const purchaseStreamActive = summary.blackbox_purchase_stream_active !== undefined
    ? Boolean(summary.blackbox_purchase_stream_active)
    : Number(summary.purchase_events || 0) > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Checkout Blackbox</h2>
            <p className="mt-1 text-sm text-gray-600">
              Dedicated diagnostics for checkout duplication and ghost purchase patterns.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Ingest endpoint: <code>/api/blackbox/ingest</code> (store-scoped, isolated from Session Intelligence).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Start Date</label>
            <input
              type="date"
              value={range.startDate}
              onChange={(event) => setRange((prev) => ({ ...prev, startDate: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">End Date</label>
            <input
              type="date"
              value={range.endDate}
              onChange={(event) => setRange((prev) => ({ ...prev, endDate: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Event</label>
            <select
              value={eventName}
              onChange={(event) => setEventName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All events</option>
              {eventOptions.map((item) => (
                <option key={item.event_name} value={item.event_name}>
                  {item.event_name} ({formatNumber(item.count)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Source</label>
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All sources</option>
              {sourceOptions.map((item) => (
                <option key={item.source} value={item.source}>
                  {item.source} ({formatNumber(item.count)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Session / Client / IP Hash</label>
            <input
              type="text"
              value={sessionHint}
              onChange={(event) => setSessionHint(event.target.value)}
              placeholder="Optional exact identity filter"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <div>
            Last refreshed: {lastRefreshedAt ? formatTimestamp(lastRefreshedAt) : '—'}
          </div>
          <div>
            Auto-refresh: every {Math.round(AUTO_REFRESH_INTERVAL_MS / 1000)}s
          </div>
          <div>
            Showing up to{' '}
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className="rounded border border-gray-300 px-2 py-1 text-xs"
            >
              {EVENT_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>{' '}
            events
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {!error && !purchaseStreamActive ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No Blackbox purchase stream detected in this date range. Hard ghost counts are strict and no-telemetry orders are separated below.
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Begin Checkout Events"
          value={formatNumber(summary.begin_checkout_events)}
          hint={`Sampled sessions: ${formatNumber(summary.sampled_sessions)}`}
        />
        <StatCard
          label="Purchase Events"
          value={formatNumber(summary.purchase_events)}
          hint={`Sampled events: ${formatNumber(summary.sampled_events)}`}
        />
        <StatCard
          label="Duplicate Begin Checkout"
          value={formatNumber(summary.duplicate_begin_checkout_events)}
          hint={`Rate: ${formatPercent(summary.duplicate_begin_checkout_rate || 0)}`}
        />
        <StatCard
          label="Ghost Sessions"
          value={formatNumber(summary.ghost_sessions_without_purchase)}
          hint="Begin checkout seen but no purchase in sampled stream"
        />
        <StatCard
          label="Shopify Orders"
          value={formatNumber(summary.shopify_orders_in_range)}
          hint={`Observed Blackbox purchases: ${formatNumber(summary.orders_with_blackbox_purchase)}`}
        />
        <StatCard
          label="Hard Ghost Orders"
          value={formatNumber(summary.hard_ghost_orders ?? summary.ghost_orders_without_blackbox_purchase)}
          hint="Shopify order with no pixel + no GTM + no webhook purchase signal"
        />
        <StatCard
          label="Recovered (Webhook Only)"
          value={formatNumber(summary.recovered_webhook_only_orders)}
          hint="Order recovered by webhook when pixel and GTM purchase were both missing"
        />
        <StatCard
          label="Partial Miss Orders"
          value={formatNumber(summary.partial_miss_orders)}
          hint="Exactly one side fired (pixel xor GTM)"
        />
        <StatCard
          label="No Telemetry Orders"
          value={formatNumber(summary.no_telemetry_orders)}
          hint="Orders in range with no purchase telemetry stream available"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Top Duplicate Button Paths</h3>
          <p className="mt-1 text-xs text-gray-500">
            Ranked by duplicated begin_checkout events inside the configured duplicate window.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Button / Source</th>
                  <th className="py-2">Duplicate Count</th>
                </tr>
              </thead>
              <tbody>
                {topDuplicateButtons.length ? topDuplicateButtons.map((row) => (
                  <tr key={row.checkout_button} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-700">{row.checkout_button}</td>
                    <td className="py-2 font-medium text-gray-900">{formatNumber(row.count)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td className="py-3 text-sm text-gray-500" colSpan={2}>No duplicate clusters in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Recent Duplicate Clusters</h3>
          <p className="mt-1 text-xs text-gray-500">
            Most recent repeated begin_checkout clusters by identity + cart/checkout flow key.
          </p>
          <div className="mt-3 max-h-72 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Count</th>
                  <th className="py-2">Button</th>
                </tr>
              </thead>
              <tbody>
                {duplicateGroups.length ? duplicateGroups.slice(0, 20).map((row, index) => (
                  <tr key={`${row.identity_key}-${row.flow_key}-${index}`} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-3 text-xs text-gray-700">{formatTimestamp(row.last_event_ts)}</td>
                    <td className="py-2 pr-3 font-semibold text-gray-900">{formatNumber(row.count)}</td>
                    <td className="py-2 text-xs text-gray-700">
                      <div className="font-mono">{row.checkout_button || row.checkout_source || 'unknown'}</div>
                      <div className="text-gray-500">{row.page_path || '—'}</div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td className="py-3 text-sm text-gray-500" colSpan={3}>No duplicate groups detected.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900">Ghost Session Candidates</h3>
          <p className="mt-1 text-xs text-gray-500">
            Sessions with begin_checkout but no purchase in this sampled window.
          </p>
          <div className="mt-3 max-h-80 overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Last Seen</th>
                  <th className="py-2 pr-3">Begin Events</th>
                  <th className="py-2 pr-3">Identity</th>
                  <th className="py-2">Last Button</th>
                </tr>
              </thead>
              <tbody>
                {ghostSessions.length ? ghostSessions.map((row) => (
                  <tr key={row.identity_key} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-3 text-xs text-gray-700">{formatTimestamp(row.last_event_ts)}</td>
                    <td className="py-2 pr-3 font-medium text-gray-900">{formatNumber(row.begin_checkout_events)}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600">
                      <div className="font-mono">{row.identity_key}</div>
                      <div>{row.country_code || '—'} {row.region_code ? `• ${row.region_code}` : ''}</div>
                    </td>
                    <td className="py-2 text-xs text-gray-700">{row.last_checkout_button || '—'}</td>
                  </tr>
                )) : (
                  <tr>
                    <td className="py-3 text-sm text-gray-500" colSpan={4}>No ghost session candidates in this range.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <OrderCandidatesTable
          title="Hard Ghost Order Candidates"
          hint="Strict definition: Shopify order with no pixel purchase and no GTM purchase (and no webhook recovery signal)."
          rows={hardGhostOrders}
          emptyLabel="No hard ghost order candidates in this range."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <OrderCandidatesTable
          title="Recovered (Webhook Only) Orders"
          hint="Webhook purchase signal exists, but both pixel and GTM purchase signals are missing."
          rows={recoveredWebhookOrders}
          emptyLabel="No webhook-only recovered orders in this range."
        />
        <OrderCandidatesTable
          title="Partial Miss Orders"
          hint="Only one of pixel or GTM purchase signals fired for the order."
          rows={partialMissOrders}
          emptyLabel="No partial miss orders in this range."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-1">
        <OrderCandidatesTable
          title="No Telemetry Orders"
          hint="Orders where this range has no purchase telemetry stream to classify delivery path."
          rows={noTelemetryOrders}
          emptyLabel="No no-telemetry orders in this range."
        />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900">Raw Blackbox Events</h3>
        <p className="mt-1 text-xs text-gray-500">
          {formatNumber(eventsTotal)} matching events in range. Showing top {formatNumber(events.length)}.
        </p>
        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Event</th>
                <th className="py-2 pr-3">Identity</th>
                <th className="py-2 pr-3">Button / Source</th>
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">Geo</th>
                <th className="py-2">Path</th>
              </tr>
            </thead>
            <tbody>
              {events.length ? events.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 align-top">
                  <td className="py-2 pr-3 text-xs text-gray-700">{formatTimestamp(row.event_ts)}</td>
                  <td className="py-2 pr-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.is_purchase
                        ? 'bg-emerald-100 text-emerald-700'
                        : row.is_begin_checkout
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                    >
                      {row.event_name}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-700">
                    <div className="font-mono">{formatSessionIdentity(row)}</div>
                    <div className="text-gray-500">{row.source || '—'}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-700">
                    <div>{row.checkout_button || '—'}</div>
                    <div className="text-gray-500">{row.checkout_source || '—'}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-700">
                    <div className="font-mono">{row.order_id || '—'}</div>
                    <div className="text-gray-500">{row.event_id || '—'}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-700">
                    <div>{row.country_code || '—'} {row.region_code ? `• ${row.region_code}` : ''}</div>
                    <div className="text-gray-500">{row.ip_hash || '—'}</div>
                  </td>
                  <td className="py-2 text-xs text-gray-700">
                    <div>{row.page_path || '—'}</div>
                    <div className="max-w-sm truncate text-gray-500" title={row.page_url || ''}>{row.page_url || '—'}</div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td className="py-3 text-sm text-gray-500" colSpan={7}>No events matched this filter set.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
