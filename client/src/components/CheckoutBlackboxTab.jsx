import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';

const DEFAULT_LOOKBACK_DAYS = 3;
const EVENT_LIMIT_OPTIONS = [100, 200, 500];
const DEFAULT_EVENT_LIMIT = 200;
const CSV_EXPORT_LIMIT = 5000;
const AUTO_REFRESH_INTERVAL_MS = 30 * 1000;
const ATTRIBUTION_GRACE_HOURS = 2;

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

function formatIdentity(row) {
  return row?.session_id || row?.client_id || row?.ip_hash || '—';
}

function attributionBadgeClass(status) {
  switch (status) {
    case 'attributed': return 'bg-emerald-100 text-emerald-700';
    case 'partial': return 'bg-amber-100 text-amber-800';
    case 'missing': return 'bg-rose-100 text-rose-700';
    case 'none': return 'bg-gray-100 text-gray-600';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function transitionBadgeClass(status) {
  switch (status) {
    case 'dropped_at_checkout': return 'bg-rose-100 text-rose-700';
    case 'weak_upstream': return 'bg-amber-100 text-amber-800';
    case 'no_upstream_signal': return 'bg-sky-100 text-sky-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function transitionLabel(status) {
  switch (status) {
    case 'dropped_at_checkout': return 'Dropped at checkout';
    case 'weak_upstream': return 'Weak upstream';
    case 'no_upstream_signal': return 'No upstream signal';
    default: return status || '—';
  }
}

function signalBadgeClass(value) {
  return value ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200';
}

function SignalPill({ label, value }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${signalBadgeClass(value)}`}>
      {label}: {value ? 'yes' : 'no'}
    </span>
  );
}

function fetchJson(url) {
  return fetch(url, { cache: 'no-store' })
    .then((res) => res.text().then((raw) => ({ res, raw })))
    .then(({ res, raw }) => {
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
    });
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

function DuplicatePathsTable({ rows }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Top Duplicate Checkout Paths</h3>
      <p className="mt-1 text-xs text-gray-500">
        Repeated <code>begin_checkout</code> clusters inside the duplicate window.
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

function MisattributedCheckoutsTable({ rows }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Unresolved Misattributed Checkouts</h3>
      <p className="mt-1 text-xs text-gray-500">
        Only checkouts older than {ATTRIBUTION_GRACE_HOURS} hours are shown. Primary status is based on attribution IDs surviving (<code>fbc/fbclid</code> or <code>fbp</code>). Page context stays visible as supporting evidence.
      </p>
      <div className="mt-3 max-h-[36rem] overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2 pr-3">Checkout Time</th>
              <th className="py-2 pr-3">Identity</th>
              <th className="py-2 pr-3">Checkout Path</th>
              <th className="py-2 pr-3">Checkout IDs</th>
              <th className="py-2 pr-3">Upstream Snapshot</th>
              <th className="py-2 pr-3">Diagnosis</th>
              <th className="py-2">Page</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>{formatTimestamp(row.event_ts)}</div>
                  <div className="text-gray-500">{row.country_code || '—'} {row.region_code ? `• ${row.region_code}` : ''}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div className="font-mono">{formatIdentity(row)}</div>
                  <div className="text-gray-500">{row.source || '—'}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>{row.resolved_checkout_button || row.checkout_button || '—'}</div>
                  <div className="text-gray-500">{row.resolved_checkout_source || row.checkout_source || '—'}</div>
                  {row.resolved_checkout_context_from === 'related_previous' ? (
                    <div className="mt-1 text-[11px] text-gray-400">
                      from {row.resolved_checkout_context_event_name || 'earlier event'}
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${attributionBadgeClass(row.attribution_status)}`}>
                      {row.attribution_status}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <SignalPill label="fbc" value={row.has_fbc || row.has_fbclid} />
                    <SignalPill label="fbp" value={row.has_fbp} />
                    <SignalPill label="ctx" value={row.has_event_source_url || row.has_landing_context} />
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    ID signals: {row.attribution_id_signal_count || 0}/2
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${attributionBadgeClass(row.upstream_attribution_status)}`}>
                      {row.upstream_attribution_status}
                    </span>
                  </div>
                  <div className="mt-1 text-gray-500">{formatTimestamp(row.upstream_event_ts)}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <SignalPill label="fbc" value={row.upstream_has_fbc || row.upstream_has_click_id} />
                    <SignalPill label="fbp" value={row.upstream_has_fbp} />
                    <SignalPill label="ctx" value={row.upstream_has_event_source_url || row.upstream_has_landing_context} />
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    Source event: {row.upstream_event_name || '—'}
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${transitionBadgeClass(row.attribution_transition)}`}>
                      {transitionLabel(row.attribution_transition)}
                    </span>
                  </div>
                  <div className="mt-1 text-gray-500">
                    {row.attribution_id_signal_count || 0}/2 ID signals at checkout
                  </div>
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
                <td className="py-3 text-sm text-gray-500" colSpan={7}>No unresolved misattributed checkouts in this range.</td>
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
              <th className="py-2">Page</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 text-xs text-gray-700">{formatTimestamp(row.event_ts)}</td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div className="font-medium text-gray-900">{row.event_name}</div>
                  <div className="text-gray-500">{row.source || '—'}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${attributionBadgeClass(row.attribution_status)}`}>
                    {row.attribution_status}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <SignalPill label="fbc" value={row.has_fbc || row.has_fbclid} />
                    <SignalPill label="fbp" value={row.has_fbp} />
                    <SignalPill label="ctx" value={row.has_event_source_url || row.has_landing_context} />
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div className="font-mono">{formatIdentity(row)}</div>
                  <div className="text-gray-500">{row.country_code || '—'} {row.region_code ? `• ${row.region_code}` : ''}</div>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  <div>{row.checkout_button || '—'}</div>
                  <div className="text-gray-500">{row.checkout_source || '—'}</div>
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
                <td className="py-3 text-sm text-gray-500" colSpan={6}>No events matched this filter set.</td>
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
    endDate: range.endDate,
    attributionGraceHours: ATTRIBUTION_GRACE_HOURS
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
  const misattribution = overview?.misattribution || {};
  const unresolvedRows = misattribution.rows || [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Misattributed Checkout Monitor</h2>
            <p className="mt-1 text-sm text-gray-600">
              Clean operator view for linked checkouts that stayed weak after a grace window: did attribution IDs survive, did they drop at checkout, and which button path triggered them.
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
          <div>Grace window: {ATTRIBUTION_GRACE_HOURS}h</div>
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
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Begin Checkout"
          value={formatNumber(summary.begin_checkout_events)}
          hint={`With attribution IDs: ${formatPercent(summary.begin_checkout_events ? (summary.begin_checkout_attributed / summary.begin_checkout_events) : 0)}`}
        />
        <StatCard
          label="Unresolved Misattributed"
          value={formatNumber(summary.unresolved_misattributed_checkouts)}
          hint={`Older than ${ATTRIBUTION_GRACE_HOURS}h`}
        />
        <StatCard
          label="Dropped at Checkout"
          value={formatNumber(summary.dropped_at_checkout_count)}
          hint="Upstream looked better than checkout"
        />
        <StatCard
          label="Weak Upstream"
          value={formatNumber(summary.weak_upstream_count)}
          hint="Already weak before checkout"
        />
        <StatCard
          label="Recovered Later"
          value={formatNumber(summary.recovered_late_checkouts)}
          hint="Auto-cleared from unresolved list"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
        <MisattributedCheckoutsTable rows={unresolvedRows} />
        <DuplicatePathsTable rows={duplicates.top_buttons || []} />
      </div>

      <RawEventsTable rows={events} total={eventsTotal} />
    </div>
  );
}
