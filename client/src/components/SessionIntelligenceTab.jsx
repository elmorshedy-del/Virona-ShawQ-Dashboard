import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronDown, RefreshCw } from 'lucide-react';
import './SessionIntelligenceTab.css';

const POLL_EVENTS_MS = 1000;
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

function isoDayUtc(date) {
  if (!(date instanceof Date)) return '';
  return date.toISOString().slice(0, 10);
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

function safeDecodePath(value) {
  const raw = (value || '').toString();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
}

function stripLocalePrefix(path) {
  const p = (path || '').toString();
  if (!p.startsWith('/')) return p;
  const parts = p.split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  const first = parts[0];
  if (/^[a-z]{2}$/i.test(first)) {
    const rest = parts.slice(1).join('/');
    return `/${rest}`;
  }
  return `/${parts.join('/')}`;
}

function titleFromHandle(handle) {
  const decoded = safeDecodePath(handle).replace(/[-_]+/g, ' ').trim();
  if (!decoded) return null;
  const words = decoded.split(/\s+/);
  const capped = words
    .slice(0, 10)
    .map((w) => (/^[A-Za-z]/.test(w) ? `${w.charAt(0).toUpperCase()}${w.slice(1)}` : w))
    .join(' ');
  return capped;
}

function formatPathLabel(path, checkoutStep) {
  const raw = (path || '').toString();
  if (!raw) return '—';

  const cleaned = stripLocalePrefix(raw);
  const withoutQuery = cleaned.split('?')[0].split('#')[0];
  if (withoutQuery === '/' || withoutQuery === '') return 'Home';

  if (withoutQuery.startsWith('/checkouts/')) {
    const step = checkoutStep ? ` • ${normalizeStepLabel(checkoutStep)}` : '';
    return `Checkout${step}`;
  }

  if (withoutQuery === '/cart' || withoutQuery.startsWith('/cart/')) return 'Cart';
  if (withoutQuery === '/search' || withoutQuery.startsWith('/search')) return 'Search';

  const parts = withoutQuery.split('/').filter(Boolean);
  if (parts[0] === 'products' && parts[1]) {
    const title = titleFromHandle(parts[1]);
    return title ? `Product • ${title}` : 'Product';
  }
  if (parts[0] === 'collections' && parts[1]) {
    const title = titleFromHandle(parts[1]);
    return title ? `Collection • ${title}` : 'Collection';
  }
  if (parts[0] === 'pages' && parts[1]) {
    const title = titleFromHandle(parts[1]);
    return title ? `Page • ${title}` : 'Page';
  }

  const title = titleFromHandle(parts[0]);
  return title ? title : withoutQuery;
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

function formatShopperNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `Shopper-${String(Math.trunc(n)).padStart(4, '0')}`;
}

function userLabel(row) {
  if (!row || typeof row !== 'object') return '—';
  const shopper = formatShopperNumber(row.shopper_number ?? row.shopperNumber);
  if (shopper) return shopper;
  const clientId = row.client_id || row.clientId || null;
  if (clientId) return toCode('Visitor', clientId, 6);
  const sessionId = row.session_id || row.sessionId || null;
  return sessionId ? toCode('Session', sessionId, 6) : '—';
}

export default function SessionIntelligenceTab({ store }) {
  const storeId = store?.id || 'shawq';

  const [overview, setOverview] = useState(null);
  const [brief, setBrief] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsStatus, setEventsStatus] = useState('idle');
  const [sanityOpen, setSanityOpen] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const [libraryDays, setLibraryDays] = useState([]);
  const [libraryDay, setLibraryDay] = useState('');
  const [librarySessions, setLibrarySessions] = useState([]);
  const [librarySessionId, setLibrarySessionId] = useState('');
  const [libraryEvents, setLibraryEvents] = useState([]);
  const [libraryError, setLibraryError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeLimit, setAnalyzeLimit] = useState(20);
  const [highIntentOnly, setHighIntentOnly] = useState(false);

  const [campaignStartDate, setCampaignStartDate] = useState(() => isoDayUtc(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)));
  const [campaignEndDate, setCampaignEndDate] = useState(() => isoDayUtc(new Date()));
  const [campaignPurchasesReport, setCampaignPurchasesReport] = useState(null);
  const [campaignPurchasesLoading, setCampaignPurchasesLoading] = useState(false);
  const [campaignPurchasesError, setCampaignPurchasesError] = useState('');

  const latestEventIdRef = useRef(null);
  const libraryTimelineRef = useRef(null);

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

  const loadLibraryDays = useCallback(async () => {
    const url = `/api/session-intelligence/days?store=${encodeURIComponent(storeId)}&limit=10`;
    const data = await fetchJson(url);
    const days = Array.isArray(data.days) ? data.days : [];
    setLibraryDays(days);
    if (days.length > 0) {
      setLibraryDay((current) => current || days[0].day);
    }
  }, [storeId]);

  const filteredLibrarySessions = useMemo(() => {
    if (!highIntentOnly) return librarySessions;
    return librarySessions.filter((s) =>
      Number(s.atc_events) > 0 ||
      Number(s.checkout_started_events) > 0 ||
      Number(s.purchase_events) > 0
    );
  }, [librarySessions, highIntentOnly]);

  const loadLibrarySessions = useCallback(async (day) => {
    if (!day) return;
    const url = `/api/session-intelligence/sessions-by-day?store=${encodeURIComponent(storeId)}&date=${encodeURIComponent(day)}&limit=200`;
    const data = await fetchJson(url);
    setLibrarySessions(Array.isArray(data.sessions) ? data.sessions : []);
  }, [storeId]);

  const loadLibraryEvents = useCallback(async (day, sessionId) => {
    if (!day || !sessionId) return;
    const url = `/api/session-intelligence/events-by-day?store=${encodeURIComponent(storeId)}&date=${encodeURIComponent(day)}&sessionId=${encodeURIComponent(sessionId)}&limit=1200`;
    const data = await fetchJson(url);
    setLibraryEvents(Array.isArray(data.events) ? data.events : []);
  }, [storeId]);

  const loadCampaignPurchases = useCallback(async (startDate = campaignStartDate, endDate = campaignEndDate) => {
    if (!startDate || !endDate) return;
    setCampaignPurchasesLoading(true);
    setCampaignPurchasesError('');
    try {
      const url = `/api/session-intelligence/purchases-by-campaign?store=${encodeURIComponent(storeId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&limit=500`;
      const data = await fetchJson(url);
      setCampaignPurchasesReport(data);
    } catch (error) {
      console.error('[SessionIntelligenceTab] purchases-by-campaign load failed:', error);
      setCampaignPurchasesError(error?.message || 'Failed to load purchases by campaign');
      setCampaignPurchasesReport(null);
    } finally {
      setCampaignPurchasesLoading(false);
    }
  }, [campaignEndDate, campaignStartDate, storeId]);

  const manualRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadOverview(),
        loadBrief(),
        loadSessions(),
        loadEvents(),
        loadLibraryDays(),
        loadCampaignPurchases()
      ]);
    } finally {
      setLoading(false);
    }
  }, [loadBrief, loadCampaignPurchases, loadEvents, loadLibraryDays, loadOverview, loadSessions]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setEventsStatus('loading');

    Promise.all([loadOverview(), loadBrief(), loadSessions(), loadEvents(), loadLibraryDays(), loadCampaignPurchases()])
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
  }, [loadBrief, loadCampaignPurchases, loadEvents, loadLibraryDays, loadOverview, loadSessions]);

  useEffect(() => {
    setLibraryError('');
    setLibrarySessions([]);
    setLibraryEvents([]);
    setLibrarySessionId('');

    if (!libraryDay) return;

    loadLibrarySessions(libraryDay).catch((error) => {
      console.error('[SessionIntelligenceTab] library sessions load failed:', error);
      setLibraryError(error?.message || 'Failed to load day sessions');
    });
  }, [libraryDay, loadLibrarySessions]);

  useEffect(() => {
    setLibraryError('');
    setLibraryEvents([]);
    if (!libraryDay || !librarySessionId) return;

    loadLibraryEvents(libraryDay, librarySessionId).catch((error) => {
      console.error('[SessionIntelligenceTab] library events load failed:', error);
      setLibraryError(error?.message || 'Failed to load session events');
    });
  }, [libraryDay, librarySessionId, loadLibraryEvents]);

  useEffect(() => {
    if (!librarySessionId) return;
    // Make "View" feel instant even if the timeline is below the fold.
    libraryTimelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [librarySessionId]);

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

  const selectedLibrarySession = useMemo(() => {
    if (!librarySessionId) return null;
    return librarySessions.find((s) => s.session_id === librarySessionId) || null;
  }, [librarySessionId, librarySessions]);

  const timelineLabel = (() => {
    if (!librarySessionId) return '—';
    const shopper = formatShopperNumber(selectedLibrarySession?.shopper_number ?? selectedLibrarySession?.shopperNumber);
    const sessionCode = toCode('Session', selectedLibrarySession?.session_id || librarySessionId, 6);
    if (shopper) return `${shopper} • ${sessionCode}`;
    return userLabel(selectedLibrarySession || { session_id: librarySessionId });
  })();

  const mostViewedNotBought = overview?.insights?.mostViewedNotBought || [];
  const outOfStockSizesClicked = overview?.insights?.outOfStockSizesClicked || [];

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

  const formatShort = useCallback((ts) => {
    const date = parseSqliteTimestamp(ts);
    if (!date) return '—';
    return date.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }, []);

  const analyzeSession = useCallback(async (sessionId) => {
    if (!sessionId) return;
    setAnalyzing(true);
    setLibraryError('');
    try {
      await fetchJson('/api/session-intelligence/analyze-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store: storeId, sessionId })
      });
      await loadLibrarySessions(libraryDay);
    } catch (error) {
      setLibraryError(error?.message || 'Failed to analyze session');
    } finally {
      setAnalyzing(false);
    }
  }, [libraryDay, loadLibrarySessions, storeId]);

  const analyzeDay = useCallback(async (mode) => {
    if (!libraryDay) return;
    setAnalyzing(true);
    setLibraryError('');
    try {
      await fetchJson('/api/session-intelligence/analyze-day', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store: storeId, date: libraryDay, mode, limit: analyzeLimit })
      });
      await loadLibrarySessions(libraryDay);
    } catch (error) {
      setLibraryError(error?.message || 'Failed to analyze day');
    } finally {
      setAnalyzing(false);
    }
  }, [analyzeLimit, libraryDay, loadLibrarySessions, storeId]);

  return (
	    <div className="si-root">
	      <div className="si-header">
	        <div className="si-title">
	          <h2>Session Intelligence</h2>
	          <p>
	            Live shopper journeys, checkout drop-offs, and AI-ready insights.
	          </p>
	        </div>

        <div className="si-actions">
          <div className="si-pill" title="Polling Shopify events">
            <span className="si-pill-dot" />
            {eventsStatus === 'ok' ? 'Connected' : eventsStatus === 'error' ? 'Degraded' : 'Loading'}
          </div>
          <button className="si-button" type="button" onClick={manualRefresh} disabled={loading}>
            <span className="inline-flex items-center gap-2">
              <RefreshCw className={loading ? 'animate-spin' : ''} size={14} />
              Refresh
            </span>
          </button>
        </div>
	      </div>

	      <div className="si-card si-intro-card">
	        <div className="si-card-title">
	          <h3>What this page is</h3>
	          <span className="si-muted">Live • Team-friendly</span>
	        </div>
	        <div className="si-muted">
	          This page is your live “truth layer” for Shawq — basically Microsoft Clarity, but without the numerous, endless recordings.
	        </div>
	        <ul className="si-list">
	          <li>
	            <strong>Live feed (updates every second):</strong> it receives behavior signals from our Shopify Custom Pixel, so you’re not guessing — you’re watching real intent form in real time.
	          </li>
	          <li>
	            <strong>Full journey per shopper:</strong> each shopper gets a private <em>Shopper‑0001</em> style ID, and we track their path step‑by‑step across the entire session (page → product → add to cart → checkout steps → purchase or drop‑off).
	          </li>
	          <li>
	            <strong>Checkout clarity:</strong> we pinpoint exactly where checkout stalls (Contact / Shipping / Payment) so you know what to fix first.
	          </li>
	          <li>
	            <strong>AI insights (next phase):</strong> AI will review the highest‑impact sessions (like ATC with no purchase) and send a short brief: what likely happened, what’s broken/confusing, and the fixes that move revenue.
	          </li>
	          <li>
	            <strong>Audience power:</strong> we can turn “high intent” shoppers into retargeting audiences automatically.
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
          <h3>Product signals (last {overview?.retentionHours ?? 72}h)</h3>
          <span className="si-muted">Only sessions with a purchase</span>
        </div>

        <div className="si-insights-grid">
          <div className="si-insight-block">
            <div className="si-insight-title">Most viewed, not bought</div>
            {mostViewedNotBought.length === 0 ? (
              <div className="si-empty">No qualified sessions yet.</div>
            ) : (
              <ul className="si-insight-list">
                {mostViewedNotBought.map((item) => (
                  <li key={item.product_id} className="si-insight-item">
                    <span title={item.product_path || item.product_id}>
                      {item.product_path ? formatPathLabel(item.product_path) : item.product_id}
                    </span>
                    <span className="si-muted">{item.views} views • {item.sessions} buyers</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="si-insight-block">
            <div className="si-insight-title">Out‑of‑stock sizes clicked</div>
            {outOfStockSizesClicked.length === 0 ? (
              <div className="si-empty">No OOS clicks captured yet.</div>
            ) : (
              <ul className="si-insight-list">
                {outOfStockSizesClicked.map((item, idx) => (
                  <li key={[item.size_label, item.variant_id, item.product_id].filter(Boolean).join('-') || idx} className="si-insight-item">
                    <span title={[item.size_label, item.variant_id, item.product_id].filter(Boolean).join(' • ')}>
                      {item.size_label || item.variant_id || item.product_id || 'Unknown size'}
                    </span>
                    <span className="si-muted">{item.clicks} clicks</span>
                  </li>
                ))}
              </ul>
            )}
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

      <div className="si-card" style={{ marginBottom: 12 }}>
        <div className="si-card-title">
          <h3>Purchases by campaign & country</h3>
          <span className="si-muted">From our Shopify tracking (UTC)</span>
        </div>

        <div className="si-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Start
            <input
              className="si-input"
              type="date"
              value={campaignStartDate}
              onChange={(e) => setCampaignStartDate(e.target.value)}
            />
          </label>
          <label className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            End
            <input
              className="si-input"
              type="date"
              value={campaignEndDate}
              onChange={(e) => setCampaignEndDate(e.target.value)}
            />
          </label>

          <button className="si-button" type="button" onClick={() => loadCampaignPurchases()} disabled={campaignPurchasesLoading}>
            {campaignPurchasesLoading ? 'Loading…' : 'Load'}
          </button>

          <span className="si-muted">
            Purchases: {campaignPurchasesReport?.totalPurchases ?? '—'}
          </span>
        </div>

        {campaignPurchasesError ? (
          <div className="si-empty" style={{ color: '#b42318', marginTop: 10 }}>
            {campaignPurchasesError}
          </div>
        ) : null}

        {campaignPurchasesLoading && !campaignPurchasesReport ? (
          <div className="si-empty" style={{ marginTop: 10 }}>
            Loading purchases…
          </div>
        ) : Array.isArray(campaignPurchasesReport?.rows) && campaignPurchasesReport.rows.length > 0 ? (
          <table className="si-event-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Country</th>
                <th style={{ textAlign: 'right' }}>Purchases</th>
              </tr>
            </thead>
            <tbody>
              {campaignPurchasesReport.rows.map((row) => (
                <tr key={`${row.campaign}||${row.country}`}>
                  <td title={row.campaign}>{row.campaign}</td>
                  <td>{row.country}</td>
                  <td style={{ textAlign: 'right' }}>{row.purchases}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="si-empty" style={{ marginTop: 10 }}>
            No purchases found in this date range.
          </div>
        )}
      </div>

      <div className="si-card" style={{ marginTop: 14 }}>
        <div className="si-card-title">
          <h3>Events library (last {overview?.retentionHours ?? 72}h)</h3>
          <span className="si-muted">Browse by day • Pick a session • Run AI</span>
        </div>

        <div className="si-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Day (UTC)
            <select
              className="si-select"
              value={libraryDay}
              onChange={(e) => setLibraryDay(e.target.value)}
              disabled={libraryDays.length === 0}
            >
              {libraryDays.length === 0 ? (
                <option value="">No days yet</option>
              ) : (
                libraryDays.map((d) => (
                  <option key={d.day} value={d.day}>
                    {d.day} • {d.sessions} sessions • {d.events} events
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="si-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="si-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Limit
              <input
                className="si-input"
                type="number"
                min={1}
                max={100}
                value={analyzeLimit}
                onChange={(e) => setAnalyzeLimit(parseInt(e.target.value, 10) || 20)}
                style={{ width: 90 }}
              />
            </label>
            <button
              className={`si-button ${highIntentOnly ? 'si-button-active' : ''}`}
              type="button"
              aria-pressed={highIntentOnly}
              onClick={() => setHighIntentOnly((v) => !v)}
              disabled={librarySessions.length === 0}
            >
              High intent
            </button>
            <button className="si-button" type="button" onClick={() => analyzeDay('high_intent')} disabled={analyzing || !libraryDay}>
              Analyze high intent
            </button>
            <button className="si-button" type="button" onClick={() => analyzeDay('all')} disabled={analyzing || !libraryDay}>
              Analyze all
            </button>
          </div>
        </div>

        {libraryError ? (
          <div className="si-empty" style={{ color: '#b42318' }}>{libraryError}</div>
        ) : null}

        {filteredLibrarySessions.length === 0 ? (
          <div className="si-empty" style={{ marginTop: 10 }}>
            No sessions for this day yet.
          </div>
        ) : (
          <table className="si-event-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Shopper</th>
                <th>Last seen</th>
                <th>Signals</th>
                <th>Checkout</th>
                <th>Device</th>
                <th>Country</th>
                <th>Campaign</th>
                <th>AI</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredLibrarySessions.map((s) => {
                const selected = librarySessionId === s.session_id;
                const signals = [
                  s.atc_events ? `ATC×${s.atc_events}` : null,
                  s.checkout_started_events ? `Checkout×${s.checkout_started_events}` : null,
                  s.purchase_events ? `Purchase×${s.purchase_events}` : null
                ].filter(Boolean).join(' • ') || '—';
                const ai = s.summary ? `${s.primary_reason || 'Insight'} (${Math.round((s.confidence || 0) * 100)}%)` : '—';
                return (
                  <tr key={s.session_id} className={selected ? 'si-row-selected' : ''}>
                    <td title={s.session_id}>{userLabel(s)}</td>
                    <td>{timeAgo(s.last_seen)}</td>
                    <td>{signals}</td>
                    <td>{s.last_checkout_step ? <span className="si-badge">{normalizeStepLabel(s.last_checkout_step)}</span> : '—'}</td>
                    <td>{s.device_type || '—'}</td>
                    <td>{s.country_code || '—'}</td>
                    <td title={[s.utm_source, s.utm_campaign].filter(Boolean).join(' / ')}>
                      {s.utm_campaign || s.utm_source || '—'}
                    </td>
                    <td title={s.summary || ''}>{ai}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="si-button si-button-small"
                        type="button"
                        onClick={() => {
                          setLibrarySessionId(s.session_id);
                        }}
                        disabled={!libraryDay}
                      >
                        View
                      </button>{' '}
                      <button
                        className="si-button si-button-small"
                        type="button"
                        onClick={() => analyzeSession(s.session_id)}
                        disabled={analyzing}
                      >
                        Analyze
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {librarySessionId && (
            <div style={{ marginTop: 14 }} ref={libraryTimelineRef}>
            <div className="si-card-title" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 14, margin: 0 }}>Session timeline</h3>
              <span className="si-muted">{timelineLabel}</span>
            </div>

            {libraryEvents.length === 0 ? (
              <div className="si-empty">No events loaded for this session.</div>
            ) : (
              <table className="si-event-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Path</th>
                    <th>Step</th>
                    <th>Product</th>
                    <th>Campaign</th>
                    <th>Device</th>
                    <th>Country</th>
                  </tr>
                </thead>
                <tbody>
                  {libraryEvents.slice(0, 200).map((e) => (
                    <tr key={e.id}>
                      <td title={e.created_at || e.event_ts}>{formatShort(e.created_at || e.event_ts)}</td>
                      <td>{e.event_name}</td>
                      <td title={e.page_path || ''}>
                        <span className="si-path-label">{formatPathLabel(e.page_path, e.checkout_step)}</span>
                      </td>
                      <td>{e.checkout_step ? <span className="si-badge">{normalizeStepLabel(e.checkout_step)}</span> : '—'}</td>
                      <td title={[e.product_id, e.variant_id].filter(Boolean).join('\n')}>
                        {e.variant_id ? 'variant' : e.product_id ? 'product' : '—'}
                      </td>
                      <td title={[e.utm_source, e.utm_campaign].filter(Boolean).join(' / ')}>
                        {e.utm_campaign || e.utm_source || '—'}
                      </td>
                      <td>{e.device_type || '—'}</td>
                      <td>{e.country_code || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {selectedLibrarySession?.summary && (
              <div className="si-card si-ai-card" style={{ marginTop: 12 }}>
                <div className="si-card-title">
                  <h3>AI summary</h3>
                  <span className="si-muted">
                    {selectedLibrarySession.primary_reason || '—'} •{' '}
                    {selectedLibrarySession.confidence != null ? `${Math.round(selectedLibrarySession.confidence * 100)}%` : '—'}
                  </span>
                </div>
                <div className="si-muted">{selectedLibrarySession.summary}</div>
              </div>
            )}
          </div>
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
