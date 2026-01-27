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

export default function SessionIntelligenceTab({ store }) {
  const storeId = store?.id || 'shawq';

  const [overview, setOverview] = useState(null);
  const [brief, setBrief] = useState(null);
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

  const manualRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadOverview(), loadBrief(), loadEvents()]);
    } finally {
      setLoading(false);
    }
  }, [loadBrief, loadEvents, loadOverview]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEventsStatus('loading');

    Promise.all([loadOverview(), loadBrief(), loadEvents()])
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
    }, POLL_OVERVIEW_MS);

    return () => {
      active = false;
      clearInterval(eventsTimer);
      clearInterval(overviewTimer);
    };
  }, [loadBrief, loadEvents, loadOverview]);

  const dropoffChips = useMemo(() => {
    const byStep = overview?.checkoutDropoffsByStep || {};
    const entries = Object.entries(byStep)
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0));
    return entries.slice(0, 8);
  }, [overview]);

  const latestEventAt = events?.[0]?.created_at || null;

  return (
    <div className="si-root">
      <div className="si-header">
        <div className="si-title">
          <h2>Session Intelligence</h2>
          <p>
            Stripe‑indigo light. Raw events auto‑delete after{' '}
            <strong>{overview?.retentionHours ?? 72}h</strong>. Drop‑offs = last checkout step seen before{' '}
            <strong>{overview?.abandonAfterHours ?? 24}h</strong> with no purchase.
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
          <div className="si-metric-sub">From pixel + theme clicks</div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            Checkout started (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.checkoutStarted24h ?? '—'}</div>
          <div className="si-metric-sub">Seen checkout_started</div>
        </div>

        <div className="si-card">
          <div className="si-metric-label">
            <div className="si-icon" />
            Purchases (24h)
          </div>
          <div className="si-metric-value">{overview?.kpis?.purchases24h ?? '—'}</div>
          <div className="si-metric-sub">Seen checkout_completed</div>
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
            <span className="si-muted">Last step observed</span>
          </div>

          {dropoffChips.length === 0 ? (
            <div className="si-empty">No drop‑offs detected yet (or waiting for the 24h window).</div>
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
                    <th>Session</th>
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
                      <td title={event.page_path || ''}>{event.page_path || '—'}</td>
                      <td>
                        {event.checkout_step ? (
                          <span className="si-badge">{normalizeStepLabel(event.checkout_step)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td title={event.session_id || ''}>
                        {(event.session_id || '—').slice(0, 16)}
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
