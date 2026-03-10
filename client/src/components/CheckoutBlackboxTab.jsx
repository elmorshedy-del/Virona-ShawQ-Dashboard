import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function coverageStatusLabel(value) {
  switch (value) {
    case 'full': return 'Full';
    case 'partial': return 'Partial';
    case 'webhook_only': return 'Webhook only';
    case 'unknown_only': return 'Unknown purchase';
    case 'no_purchase_signal': return 'No purchase signal';
    default: return value || '—';
  }
}

function deliveryStatusLabel(value) {
  switch (value) {
    case 'hard_ghost': return 'Missing both';
    case 'recovered_webhook_only': return 'Recovered by webhook';
    case 'partial_miss': return 'Pixel/GTM mismatch';
    case 'unknown_purchase_source': return 'Unknown purchase source';
    case 'no_telemetry': return 'No purchase telemetry';
    default: return value || '—';
  }
}

function attributionBadgeClass(status) {
  switch (status) {
    case 'attributed': return 'bg-emerald-100 text-emerald-700';
    case 'partial': return 'bg-amber-100 text-amber-800';
    case 'missing': return 'bg-rose-100 text-rose-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function coverageBadgeClass(status) {
  switch (status) {
    case 'full': return 'bg-emerald-100 text-emerald-700';
    case 'partial': return 'bg-amber-100 text-amber-800';
    case 'webhook_only': return 'bg-sky-100 text-sky-700';
    case 'no_purchase_signal': return 'bg-rose-100 text-rose-700';
    case 'unknown_only': return 'bg-gray-100 text-gray-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function PillList({ items, emptyLabel = '—' }) {
  if (!Array.isArray(items) || !items.length) {
    return <span className="text-xs text-gray-500">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-700"
        >
          {item}
        </span>
      ))}
    </div>
  );
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

function TopMissingFieldsTable({ rows }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Top Missing Attribution Fields</h3>
      <p className="mt-1 text-xs text-gray-500">
        Counted across sampled <code>begin_checkout</code> events in this range.
      </p>
      <div className="mt-3 max-h-72 overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-4">Field</th>
              <th className="py-2">Missing Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.field} className="border-b border-gray-100">
                <td className="py-2 pr-4 font-mono text-xs text-gray-700">{row.field}</td>
                <td className="py-2 font-medium text-gray-900">{formatNumber(row.count)}</td>
              </tr>
            )) : (
              <tr>
                <td className="py-3 text-sm text-gray-500" colSpan={2}>No missing-field patterns in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DuplicatePathsTable({ rows }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Top Duplicate Checkout Paths</h3>
      <p className="mt-1 text-xs text-gray-500">
        Ranked by repeated <code>begin_checkout</code> clusters inside the duplicate window.
      </p>
      <div className="mt-3 max-h-72 overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-4">Button / Source</th>
              <th className="py-2">Duplicate Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.checkout_button} className="border-b border-gray-100">
                <td className="py-2 pr-4 font-mono text-xs text-gray-700">{row.checkout_button}</td>
                <td className="py-2 font-medium text-gray-900">{formatNumber(row.count)}</td>
              </tr>
            )) : (
              <tr>
                <td className="py-3 text-sm text-gray-500" colSpan={2}>No duplicate checkout paths in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeakCheckoutTable({ rows }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Weak / Missing Checkout Attribution</h3>
      <p className="mt-1 text-xs text-gray-500">
        Checkout starts that reached the platform but did not carry a complete attribution snapshot.
      </p>
      <div className="mt-3 max-h-[28rem] overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">Time</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Missing</th>
              <th className="py-2 pr-3">Button / Source</th>
              <th className="py-2 pr-3">Identity</th>
              <th className="py-2">Path</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 text-xs text-gray-700">{formatTimestamp(row.event_ts)}</td>
                <td className="py-2 pr-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${attributionBadgeClass(row.attribution_status)}`}>
                    {row.attribution_status}
                  </span>
                  <div className="mt-1 text-[11px] text-gray-500">
                    signals: {formatNumber(row.attribution_signal_count || 0)}/4
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <PillList items={row.attribution_missing_core_fields} />
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>{row.checkout_button || '—'}</div>
                  <div className="text-gray-500">{row.checkout_source || '—'}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div className="font-mono">{formatSessionIdentity(row)}</div>
                  <div className="text-gray-500">{row.country_code || '—'} {row.region_code ? `• ${row.region_code}` : ''}</div>
                </td>
                <td className="py-2 text-xs text-gray-700">
                  <div>{row.page_path || '—'}</div>
                  <div className="max-w-sm truncate text-gray-500" title={row.event_source_url_resolved || row.page_url || ''}>
                    {row.event_source_url_resolved || row.page_url || '—'}
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td className="py-3 text-sm text-gray-500" colSpan={6}>No weak checkout attribution events in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PurchaseGapTable({ rows, emptyLabel }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Purchase Coverage Gaps</h3>
      <p className="mt-1 text-xs text-gray-500">
        Shopify orders where platform purchase coverage is incomplete across pixel / GTM paths.
      </p>
      <div className="mt-3 max-h-[28rem] overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">Order</th>
              <th className="py-2 pr-3">Created</th>
              <th className="py-2 pr-3">Coverage</th>
              <th className="py-2 pr-3">Last Checkout</th>
              <th className="py-2 pr-3">Checkout Attribution</th>
              <th className="py-2">Geo</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={`${row.order_id}-${row.delivery_status || 'gap'}`} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div className="font-mono">{row.order_id}</div>
                  <div>{row.currency || ''} {row.order_total || ''}</div>
                  <div className="mt-1 text-[11px] text-gray-500">{deliveryStatusLabel(row.delivery_status)}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">{formatTimestamp(row.order_created_at || row.date)}</td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${coverageBadgeClass(row.coverage_status)}`}>
                    {coverageStatusLabel(row.coverage_status)}
                  </span>
                  <div className="mt-1 font-mono text-[11px] text-gray-500">{row.purchase_path_summary || 'none'}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>{formatTimestamp(row.approx_last_begin_checkout_at)}</div>
                  <div className="text-gray-500">{row.approx_last_checkout_button || '—'}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${attributionBadgeClass(row.approx_attribution_status)}`}>
                    {row.approx_attribution_status || '—'}
                  </span>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {row.approx_attribution_signal_count ? `signals: ${row.approx_attribution_signal_count}/4` : 'no linked checkout'}
                  </div>
                  <div className="mt-1">
                    <PillList items={row.approx_attribution_missing_core_fields} />
                  </div>
                </td>
                <td className="py-2 text-xs text-gray-700">
                  <div>{row.country_code || '—'}</div>
                  <div className="text-gray-500">{[row.city, row.state].filter(Boolean).join(', ') || '—'}</div>
                </td>
              </tr>
            )) : (
              <tr>
                <td className="py-3 text-sm text-gray-500" colSpan={6}>{emptyLabel}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RawEventsTable({ rows, total }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Raw Diagnostics Stream</h3>
      <p className="mt-1 text-xs text-gray-500">
        {formatNumber(total)} matching events in range. Showing top {formatNumber(rows.length)}.
      </p>
      <div className="mt-3 overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">Time</th>
              <th className="py-2 pr-3">Event</th>
              <th className="py-2 pr-3">Attribution</th>
              <th className="py-2 pr-3">Identity</th>
              <th className="py-2 pr-3">Button / Source</th>
              <th className="py-2 pr-3">Order</th>
              <th className="py-2">Path</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
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
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${attributionBadgeClass(row.attribution_status)}`}>
                    {row.attribution_status}
                  </span>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {row.attribution_signal_count || 0}/4
                  </div>
                  <div className="mt-1 max-w-44">
                    <PillList items={row.attribution_missing_core_fields} emptyLabel="" />
                  </div>
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
                <td className="py-2 text-xs text-gray-700">
                  <div>{row.page_path || '—'}</div>
                  <div className="max-w-sm truncate text-gray-500" title={row.event_source_url_resolved || row.page_url || ''}>
                    {row.event_source_url_resolved || row.page_url || '—'}
                  </div>
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
  const isRefreshingRef = useRef(false);

  const baseQuery = useMemo(() => ({
    store: storeId,
    startDate: range.startDate,
    endDate: range.endDate
  }), [storeId, range.endDate, range.startDate]);

  const loadData = useCallback(async (options = {}) => {
    const { allowHidden = true } = options || {};
    if (!allowHidden && document.visibilityState !== 'visible') return;
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;
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
      setError(loadError?.message || 'Failed to load Checkout Blackbox data');
    } finally {
      setLoading(false);
      isRefreshingRef.current = false;
    }
  }, [baseQuery, eventName, limit, sessionHint, source]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const refreshVisible = () => {
      loadData({ allowHidden: false });
    };

    const interval = window.setInterval(refreshVisible, AUTO_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('focus', refreshVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('focus', refreshVisible);
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

  const summary = overview?.summary || {};
  const duplicates = overview?.duplicates || {};
  const checkoutAttribution = overview?.checkout_attribution || {};
  const purchaseGapOrders = overview?.purchase_gap_orders || [];
  const noTelemetryOrders = overview?.no_telemetry_orders || [];
  const purchaseStreamActive = summary.blackbox_purchase_stream_active !== undefined
    ? Boolean(summary.blackbox_purchase_stream_active)
    : Number(summary.purchase_events || 0) > 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Checkout Attribution Diagnostics</h2>
            <p className="mt-1 text-sm text-gray-600">
              Clean operator view for checkout path duplication, missing attribution context, and missing purchase coverage.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Ingest endpoint: <code>/api/blackbox/ingest</code> (store-scoped, isolated from Session Intelligence).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => loadData()}
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
          <div>Last refreshed: {lastRefreshedAt ? formatTimestamp(lastRefreshedAt) : '—'}</div>
          <div>Auto-refresh: every {Math.round(AUTO_REFRESH_INTERVAL_MS / 1000)}s</div>
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
            No purchase telemetry stream was detected in this date range. Checkout attribution diagnostics are still valid, but purchase-gap sections should be read as “stream missing” rather than “order ghosted.”
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Begin Checkout"
          value={formatNumber(summary.begin_checkout_events)}
          hint={`Sampled sessions: ${formatNumber(summary.sampled_sessions)}`}
        />
        <StatCard
          label="Attributed Checkout"
          value={formatNumber(summary.begin_checkout_attributed)}
          hint={`Rate: ${formatPercent(summary.begin_checkout_events ? (summary.begin_checkout_attributed / summary.begin_checkout_events) : 0)}`}
        />
        <StatCard
          label="Weak / Missing Checkout"
          value={formatNumber((summary.begin_checkout_partial || 0) + (summary.begin_checkout_missing || 0))}
          hint={`Partial: ${formatNumber(summary.begin_checkout_partial)} • Missing: ${formatNumber(summary.begin_checkout_missing)}`}
        />
        <StatCard
          label="Duplicate Checkout"
          value={formatNumber(summary.duplicate_begin_checkout_events)}
          hint={`Rate: ${formatPercent(summary.duplicate_begin_checkout_rate || 0)}`}
        />
        <StatCard
          label="Orders with Full Purchase Coverage"
          value={formatNumber(summary.orders_with_full_purchase_coverage)}
          hint={`Shopify orders: ${formatNumber(summary.shopify_orders_in_range)}`}
        />
        <StatCard
          label="Orders with Purchase Gaps"
          value={formatNumber(summary.orders_with_purchase_gap)}
          hint={`No telemetry only: ${formatNumber(summary.no_telemetry_orders)}`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <DuplicatePathsTable rows={duplicates.top_buttons || []} />
        <TopMissingFieldsTable rows={checkoutAttribution.top_missing_core || []} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WeakCheckoutTable rows={checkoutAttribution.weak_rows || []} />
        <PurchaseGapTable
          rows={purchaseGapOrders}
          emptyLabel="No purchase coverage gaps in this range."
        />
      </div>

      {noTelemetryOrders.length ? (
        <div className="grid gap-4 xl:grid-cols-1">
          <PurchaseGapTable
            rows={noTelemetryOrders}
            emptyLabel="No no-telemetry orders in this range."
          />
        </div>
      ) : null}

      <RawEventsTable rows={events} total={eventsTotal} />
    </div>
  );
}
