import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, RefreshCw } from 'lucide-react';
import './SessionIntelligenceTab.css';

const POLL_EVENTS_MS = 5000;
const POLL_OVERVIEW_MS = 20000;

const STEP_LABELS = {
  contact: 'Contact',
  shipping: 'Shipping',
  payment: 'Payment',
  review: 'Review',
  thank_you: 'Thank you',
  unknown: 'Unknown'
};

function parseSqliteTimestamp(ts) {
  if (!ts || typeof ts !== 'string') return null;
  if (ts.includes('T')) {
    const date = new Date(ts);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(`${ts.replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function timeAgo(ts) {
  const date = parseSqliteTimestamp(ts);
  if (!date) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

async function fetchJson(url, options) {
  const res = await fetch(url, { cache: 'no-store', ...options });
  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();

  if (!contentType.includes('application/json')) {
    const snippet = raw.slice(0, 200);
    throw new Error(`Expected JSON but got ${contentType || 'unknown'}: ${snippet}`);
  }

  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  }
  if (!data?.success) {
    throw new Error(data?.error || 'Invalid response');
  }
  return data;
}

function normalizeStepLabel(step) {
  const key = (step || '').toString().toLowerCase().trim();
  if (!key) return '—';
  return STEP_LABELS[key] || key;
}

function fnv1a32(input) {
  const str = (input || '').toString();
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

function toCode(prefix, raw, width = 6) {
  if (!raw) return '—';
  const code = fnv1a32(raw).toString(36).toUpperCase();
  const padded = code.padStart(width, '0');
  return `${prefix}-${padded.slice(-width)}`;
}

function userLabel(row) {
  if (!row || typeof row !== 'object') return '—';
  const clientId = row.client_id || row.clientId || null;
  if (clientId) return toCode('U', clientId, 6);
  const sessionId = row.session_id || row.sessionId || null;
  return sessionId ? toCode('A', sessionId, 6) : '—';
}

export default function SessionIntelligenceTab({ store }) {
  const storeId = store?.id || 'shawq';

  const [overview, setOverview] = useState(null);
  const [brief, setBrief] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsStatus, setEventsStatus] = useState('idle');
  const [sanityOpen, setSanityOpen] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const latestEventIdRef = useRef(null);

  const loadOverview = useCallback(async () => {
    const url = `/api/session-intelligence/overview?store=${encodeURIComponent(storeId)}`;
    const data = await fetchJson(url);
    setOverview(data.data);
  }, [storeId]);

  const loadBrief = useCallback(async () => {
    const url = `/api/session-intelligence/brief?store=${encodeURIComponent(storeId)}`;
    const data = await fetchJson(url);
    setBrief(data.brief || null);
  }, [storeId]);

  const loadEvents = useCallback(async () => {
    const url = `/api/session-intelligence/events?store=${encodeURIComponent(storeId)}&limit=80`;
    const data = await fetchJson(url);
    const list = Array.isArray(data.events) ? data.events : [];
    setEvents(list);
    setLastUpdatedAt(new Date().toISOString());
    setEventsStatus('ok');

    if (list.length) {
      const latestId = list[0]?.id || null;
      if (latestId && latestEventIdRef.current && latestId !== latestEventIdRef.current) {
        // We can add a subtle pulse here later if needed.
      }
      latestEventIdRef.current = latestId;
    }
  }, [storeId]);

  const loadSessions = useCallback(async () => {
    const url = `/api/session-intelligence/sessions?store=${encodeURIComponent(storeId)}&limit=80`;
    const data = await fetchJson(url);
    const list = Array.isArray(data.sessions) ? data.sessions : [];
    setSessions(list);
  }, [storeId]);

  const manualRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadOverview(), loadBrief(), loadSessions(), loadEvents()]);
    } finally {
      setLoading(false);
    }
  }, [loadBrief, loadEvents, loadOverview, loadSessions]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEventsStatus('loading');

    Promise.all([loadOverview(), loadBrief(), loadSessions(), loadEvents()])
      .catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] initial load failed:', error);
        setEventsStatus('error');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    const eventsTimer = setInterval(() => {
      loadEvents().catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] events poll failed:', error);
        setEventsStatus('error');
      });
    }, POLL_EVENTS_MS);

    const overviewTimer = setInterval(() => {
      loadOverview().catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] overview poll failed:', error);
      });
      loadSessions().catch((error) => {
        if (!active) return;
        console.error('[SessionIntelligenceTab] sessions poll failed:', error);
      });
    }, POLL_OVERVIEW_MS);

    return () => {
      active = false;
      clearInterval(eventsTimer);
      clearInterval(overviewTimer);
    };
  }, [loadBrief, loadEvents, loadOverview, loadSessions]);

  const dropoffChips = useMemo(() => {
    const byStep = overview?.checkoutDropoffsByStep || {};
    const entries = Object.entries(byStep)
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0));
    return entries.slice(0, 8);
  }, [overview]);

  const latestEventAt = events?.[0]?.created_at || null;

  const abandonAfterHours = overview?.abandonAfterHours ?? 24;
  const checkoutDropMinutes = overview?.checkoutDropMinutes ?? 30;
  const abandonCutoffMs = Date.now() - abandonAfterHours * 60 * 60 * 1000;

  const abandonedSessions = useMemo(() => {
    if (!Array.isArray(sessions) || sessions.length === 0) return [];
    return sessions
      .filter((s) => s?.atc_at && !s?.purchase_at)
      .filter((s) => {
        const atcDate = parseSqliteTimestamp(s.atc_at);
        if (!atcDate) return false;
        return atcDate.getTime() <= abandonCutoffMs;
      })
      .sort((a, b) => {
        const aDate = parseSqliteTimestamp(a.atc_at)?.getTime() || 0;
        const bDate = parseSqliteTimestamp(b.atc_at)?.getTime() || 0;
        return bDate - aDate;
      })
      .slice(0, 20);
  }, [abandonCutoffMs, sessions]);

  const getCartSummary = useCallback((lastCartJson) => {
    if (!lastCartJson || typeof lastCartJson !== 'string') return '—';
    try {
      const cart = JSON.parse(lastCartJson);
      const items =
        cart?.lines ||
        cart?.lineItems ||
        cart?.items ||
        cart?.cartLines ||
        cart?.cart_lines ||
        null;
      if (!Array.isArray(items) || items.length === 0) return '—';

      const first = items[0];
      const title =
        first?.merchandise?.product?.title ||
        first?.merchandise?.title ||
        first?.product?.title ||
        first?.title ||
        first?.name ||
        'Item';
      const qty = first?.quantity || first?.qty || null;
      return qty ? `${title} ×${qty}` : title;
    } catch (e) {
      return '—';
    }
  }, []);

  return (
	    <div className="si-root">
	      <div className="si-header">
	        <div className="si-title">
	          <h2>Session Intelligence</h2>
	          <p>
	            Understand Shopify shopper behavior at scale: sessions, funnel movement, and where people drop in checkout.
	          </p>
	        </div>

        <div className="si-actions">
          <div className="si-pill" title="Polling Shopify events">
            <span className="si-pill-dot" />
            {eventsStatus === 'ok' ? 'Connected' : eventsStatus === 'error' ? 'Degraded' : 'Loading'}
          </div>
          <button className="si-button" onClick={manualRefresh} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw className={loading ? 'animate-spin' : ''} size={14} />
              Refresh
            </span>
          </button>
        </div>
	      </div>

	      <div className="si-card si-intro-card">
	        <div className="si-card-title">
	          <h3>What this page does (and how it works)</h3>
	          <span className="si-muted">Team-friendly • Privacy-safe</span>
	        </div>
	        <div className="si-muted">
	          This page turns Shopify events into session-level insights and retargeting signals without storing recordings.
	        </div>
	        <ul className="si-list">
	          <li>
	            <strong>Data source:</strong> Shopify Custom Pixel (plus optional theme click tracking) sends events to this dashboard.
	          </li>
	          <li>
	            <strong>Sessions vs events:</strong> KPIs show both. “Events” can be higher when the same shopper triggers an action multiple times.
	          </li>
	          <li>
	            <strong>Checkout drop‑offs:</strong> We infer the step from the checkout URL (example{' '}
	            <code className="si-code">?step=shipping_method</code>) and mark it dropped after <strong>{checkoutDropMinutes}m</strong>{' '}
	            inactivity with no purchase.
	          </li>
	          <li>
	            <strong>ATC abandoned:</strong> Add‑to‑cart with no purchase after <strong>{abandonAfterHours}h</strong> (useful for audiences).
	          </li>
	          <li>
	            <strong>Anonymous IDs:</strong> Shoppers appear as friendly codes like <code className="si-code">U-4K9X2P</code> (same browser).
	          </li>
	          <li>
	            <strong>Retention:</strong> Raw events auto‑delete after <strong>{overview?.retentionHours ?? 72}h</strong>.
	          </li>
	        </ul>
	      </div>

	      <div className="si-grid">
	        <div className="si-card">
	          <div className="si-metric-label">
	            <div className="si-icon" />
	            Sessions (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.sessions24h ?? '—'}</div>
          <div className="si-metric-sub">Store: {store?.name || storeId}</div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            Add to cart (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.atc24h ?? '—'}</div>
          <div className="si-metric-sub">
            Sessions • Events: {overview?.kpis?.atcEvents24h ?? '—'}
          </div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            Checkout started (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.checkoutStarted24h ?? '—'}</div>
          <div className="si-metric-sub">
            Sessions • Events: {overview?.kpis?.checkoutStartedEvents24h ?? '—'}
          </div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            Purchases (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.purchases24h ?? '—'}</div>
          <div className="si-metric-sub">
            Sessions • Events: {overview?.kpis?.purchasesEvents24h ?? '—'}
          </div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            ATC abandoned
          </div>
          <div className="si-metric-value">{overview?.kpis?.atcAbandoned ?? '—'}</div>
          <div className="si-metric-sub">{overview?.abandonAfterHours ?? 24}h since ATC, no purchase</div>
        </div>
      </div>

      <div className="si-panels">
        <div className="si-card">
          <div className="si-card-title">
            <h3>Checkout drop‑offs (no purchase)</h3>
            <span className="si-muted">
              Dropped: {overview?.kpis?.checkoutDropped24h ?? 0} • In progress: {overview?.kpis?.checkoutInProgress ?? 0}
            </span>
          </div>

          {dropoffChips.length === 0 ? (
            <div className="si-empty">
              No dropped checkouts yet (based on {checkoutDropMinutes}m inactivity).
            </div>
          ) : (
            <div className="si-steps">
              {dropoffChips.map(([step, count]) => (
                <div key={step} className="si-step-chip">
                  <strong>{count}</strong>
                  <span>{normalizeStepLabel(step)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="si-card">
          <div className="si-card-title">
            <h3>Daily brief (coming online)</h3>
            <span className="si-muted">{brief?.date || '—'}</span>
          </div>
          <div className="si-muted">
            {brief?.content
              ? brief.content
              : 'Next step: enable AI review for abandoned ATC sessions (10/day) to turn these events into reasons & fixes.'}
          </div>
        </div>
      </div>

      <div className="si-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Abandoned sessions (ATC → no purchase)</h3>
          <span className="si-muted">Older than {abandonAfterHours}h</span>
        </div>

        {abandonedSessions.length === 0 ? (
          <div className="si-empty">None yet. Once users add to cart and don’t purchase for {abandonAfterHours}h, they appear here.</div>
        ) : (
	          <table className="si-event-table">
	            <thead>
	              <tr>
	                <th>Last seen</th>
	                <th>Cart (last)</th>
	                <th>Drop‑off step</th>
	                <th>ATC</th>
	                <th>User</th>
	              </tr>
	            </thead>
	            <tbody>
	              {abandonedSessions.map((s) => (
	                <tr key={s.session_id}>
	                  <td>{timeAgo(s.last_event_at || s.updated_at || s.created_at)}</td>
	                  <td title={getCartSummary(s.last_cart_json)}>{getCartSummary(s.last_cart_json)}</td>
                  <td>
                    {s.last_checkout_step ? (
                      <span className="si-badge">{normalizeStepLabel(s.last_checkout_step)}</span>
                    ) : (
                      <span className="si-muted">Pre‑checkout</span>
                    )}
	                  </td>
	                  <td>{timeAgo(s.atc_at)}</td>
	                  <td
	                    title={[
	                      s.client_id ? `client_id: ${s.client_id}` : null,
	                      s.session_id ? `session_id: ${s.session_id}` : null
	                    ].filter(Boolean).join('\n')}
	                  >
	                    {userLabel(s)}
	                  </td>
	                </tr>
	              ))}
	            </tbody>
	          </table>
	        )}
      </div>

      <div className="si-sanity">
        <div
          className="si-sanity-header"
          role="button"
          tabIndex={0}
          onClick={() => setSanityOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setSanityOpen((v) => !v);
          }}
        >
          <div className="si-sanity-title">
            <span>Sanity panel (events from Shopify)</span>
            <small>
              {eventsStatus === 'ok'
                ? `Last event ${latestEventAt ? timeAgo(latestEventAt) : '—'} • Updated ${lastUpdatedAt ? timeAgo(lastUpdatedAt) : '—'}`
                : 'Waiting for events…'}
            </small>
          </div>

          <div className="si-chevron" data-open={sanityOpen ? 'true' : 'false'}>
            <ChevronDown size={16} />
          </div>
        </div>

        {sanityOpen && (
          <div className="si-sanity-body">
            {events.length === 0 ? (
              <div className="si-empty">
                No events yet. Open Shopify and trigger <span className="si-badge">page_viewed</span> or{' '}
                <span className="si-badge">checkout_started</span>.
              </div>
            ) : (
	              <table className="si-event-table">
	                <thead>
	                  <tr>
	                    <th>When</th>
	                    <th>Event</th>
	                    <th>Path</th>
	                    <th>Checkout step</th>
	                    <th>User</th>
	                  </tr>
	                </thead>
	                <tbody>
	                  {events.slice(0, 30).map((event) => (
	                    <tr key={event.id}>
	                      <td>{timeAgo(event.created_at || event.event_ts)}</td>
                      <td>
                        <span className="si-event-name">
                          <Activity size={14} />
                          {event.event_name}
	                        </span>
	                      </td>
	                      <td title={event.page_url || event.page_path || ''}>
	                        {event.page_path || event.page_url || '—'}
	                      </td>
	                      <td>
	                        {event.checkout_step ? (
	                          <span className="si-badge">{normalizeStepLabel(event.checkout_step)}</span>
	                        ) : (
                          '—'
                        )}
                      </td>
	                      <td
	                        title={[
	                          event.client_id ? `client_id: ${event.client_id}` : null,
	                          event.session_id ? `session_id: ${event.session_id}` : null
	                        ].filter(Boolean).join('\n')}
	                      >
	                        {userLabel(event)}
	                      </td>
	                    </tr>
	                  ))}
	                </tbody>
	              </table>
	            )}
	          </div>
	        )}
      </div>
    </div>
  );
}
