import { RefreshCw } from 'lucide-react';
import './SessionIntelligencePreview.css';

/* ── Mock data ──────────────────────────────────────────────────────────── */
const MOCK_DAY_PULSE = {
  sessionsSoFar: 1247,
  projectedSessions: 2340,
  projectionLabel: 'Mid',
  comparisons: [
    { label: 'vs yesterday', arrow: '\u2191', deltaLabel: '+18%', sessions: 1054, direction: 'up' },
    { label: 'vs last week', arrow: '\u2193', deltaLabel: '\u20123%', sessions: 1284, direction: 'down' },
  ],
};

const MOCK_REALTIME_KPIS = [
  {
    key: 'sessions',
    label: 'Sessions today',
    value: 1247,
    sparklineDirection: 'up',
    comparisons: [
      { label: 'Yesterday', arrow: '\u2191', deltaLabel: '+18%', value: 1054, direction: 'up' },
      { label: 'Last week', arrow: '\u2193', deltaLabel: '\u20123%', value: 1284, direction: 'down' },
    ],
  },
  {
    key: 'shoppers',
    label: 'Shoppers today',
    value: 843,
    sparklineDirection: 'up',
    comparisons: [
      { label: 'Yesterday', arrow: '\u2191', deltaLabel: '+12%', value: 752, direction: 'up' },
    ],
  },
  {
    key: 'events',
    label: 'Events today',
    value: 18421,
    sparklineDirection: 'flat',
    comparisons: [
      { label: 'Yesterday', arrow: '\u2191', deltaLabel: '+5%', value: 17539, direction: 'up' },
    ],
  },
];

const MOCK_SECONDARY_KPIS = [
  { key: 'atc', label: 'Add to cart', value: 187 },
  { key: 'checkout', label: 'Checkout started', value: 94 },
  { key: 'purchases', label: 'Purchases', value: 42 },
  { key: 'rage', label: 'Rage clicks', value: 23 },
];

const MOCK_SOURCES = [
  { value: 'google / organic', count: 432 },
  { value: 'instagram / paid', count: 287 },
  { value: 'direct', count: 198 },
  { value: 'tiktok / paid', count: 143 },
  { value: 'facebook / paid', count: 89 },
];

const MOCK_PAGES = [
  { value: '/', count: 354 },
  { value: '/collections/new', count: 221 },
  { value: '/products/silk-dress', count: 178 },
  { value: '/cart', count: 94 },
  { value: '/checkout', count: 67 },
];

const MOCK_EVENTS = [
  { name: 'page_viewed', count: 8743 },
  { name: 'product_viewed', count: 3214 },
  { name: 'add_to_cart', count: 487 },
  { name: 'checkout_started', count: 194 },
  { name: 'purchase', count: 42 },
  { name: 'rage_click', count: 23 },
];

const MOCK_ABANDONMENT = [
  { rank: 1, stage: 'Checkout', area: 'Payment step', product: 'Silk Evening Dress', sessions: 47 },
  { rank: 2, stage: 'Cart', area: 'Cart page', product: 'Multiple items', sessions: 38 },
  { rank: 3, stage: 'Product', area: 'Size selection', product: 'Linen Blazer', sessions: 31 },
  { rank: 4, stage: 'Checkout', area: 'Shipping step', product: 'Cashmere Sweater', sessions: 24 },
  { rank: 5, stage: 'Product', area: 'Price comparison', product: 'Denim Jacket', sessions: 19 },
];

const MOCK_LANDING = [
  { rank: 1, stage: 'Home', landing: '/', purchases: 18, record: 'Silk Dress x2, Blazer x1' },
  { rank: 2, stage: 'Product', landing: '/products/silk-dress', purchases: 12, record: 'Silk Dress x8, Accessories x4' },
  { rank: 3, stage: 'Home', landing: '/collections/new', purchases: 7, record: 'New arrivals x5' },
  { rank: 4, stage: 'Product', landing: '/products/linen-blazer', purchases: 3, record: 'Linen Blazer x3' },
];

const MOCK_STAGE_TRENDS = [
  { stage: 'Home', count: 412, trend: '+8%', direction: 'up' },
  { stage: 'Product', count: 287, trend: '+3%', direction: 'up' },
  { stage: 'Cart', count: 94, trend: '\u20125%', direction: 'down', significant: true },
  { stage: 'Checkout', count: 67, trend: '\u20122%', direction: 'down' },
  { stage: 'Purchase', count: 42, trend: '+1%', direction: 'up' },
];

const MOCK_ISSUES = [
  { id: 'i1', name: 'Payment form validation error', type: 'error', badge: 'Error', where: '/checkout (Payment step)', sessions: 23, highIntent: '87%', status: 'Confirmed', verification: 'confirmed' },
  { id: 'i2', name: 'Size selector unresponsive', type: 'friction', badge: 'Friction', where: '/products/*', sessions: 19, highIntent: '62%', status: 'Investigating', verification: 'investigating' },
  { id: 'i3', name: 'Rage clicks on shipping options', type: 'signal', badge: 'Signal', where: '/checkout (Shipping step)', sessions: 14, highIntent: '78%', status: 'Investigating', verification: 'investigating' },
  { id: 'i4', name: 'Cart page JS error', type: 'error', badge: 'Error', where: '/cart', sessions: 11, highIntent: '45%', status: 'Confirmed', verification: 'confirmed' },
];

const MOCK_DEVICE_ABANDON = {
  baselineRate: '34%',
  pieGradient: 'conic-gradient(#6366f1 0deg 126deg, #0ea5e9 126deg 216deg, #14b8a6 216deg 324deg, #94a3b8 324deg 360deg)',
  rows: [
    { key: 'ios', label: 'iOS', color: '#6366f1', share: '35%', excess: '+12 vs expected', positive: true, sessions: 412, rate: '38.2%', index: '1.24x', topSection: 'Payment (41%)' },
    { key: 'android', label: 'Android', color: '#0ea5e9', share: '25%', excess: '+4 vs expected', positive: true, sessions: 298, rate: '35.1%', index: '1.08x', topSection: 'Shipping (38%)' },
    { key: 'desktop', label: 'Desktop', color: '#14b8a6', share: '30%', excess: '\u22123 vs expected', positive: false, sessions: 487, rate: '31.0%', index: '0.92x', topSection: 'Cart (29%)' },
    { key: 'unknown', label: 'Unknown', color: '#94a3b8', share: '10%', excess: '0 vs expected', positive: false, sessions: 50, rate: '34.0%', index: '1.00x', topSection: '\u2014' },
  ],
};

const MOCK_PATTERNS = [
  {
    id: 'p1',
    title: 'Instagram / paid \u2192 high cart abandon on iOS',
    where: 'Cart \u2192 Checkout transition',
    observation: '62% of Instagram paid traffic on iOS abandons at cart, vs 34% baseline.',
    suggests: 'Mobile checkout UX friction specific to Instagram referral landing context.',
    nextCheck: 'Compare iOS Safari vs Chrome behaviour at cart.',
    fixFirst: 'Simplify cart-to-checkout CTA on mobile viewports.',
    status: 'Established',
    statusLine: '47 sessions \u2022 1.82x over-index',
  },
  {
    id: 'p2',
    title: 'TikTok / paid \u2192 bounce at product page',
    where: 'Product page (all)',
    observation: '71% of TikTok traffic bounces within 8s on product pages.',
    suggests: 'Landing page mismatch with ad creative expectations.',
    nextCheck: 'Check if product pages match TikTok ad imagery.',
    fixFirst: 'Add above-the-fold hero matching the ad visual.',
    status: 'Emerging',
    statusLine: '31 sessions \u2022 1.45x over-index',
  },
];

const MOCK_FLOW_STAGES = [
  { stage: 'landing', label: 'Landing', reached: 1247, dropoffs: 541, toNext: '56.6%', dwell: '18s', share: 100 },
  { stage: 'product', label: 'Product', reached: 706, dropoffs: 287, toNext: '59.3%', dwell: '42s', share: 56.6 },
  { stage: 'atc', label: 'Add to cart', reached: 419, dropoffs: 232, toNext: '44.6%', dwell: '12s', share: 33.6 },
  { stage: 'cart', label: 'Cart', reached: 187, dropoffs: 93, toNext: '50.3%', dwell: '35s', share: 15.0 },
  { stage: 'checkout', label: 'Checkout', reached: 94, dropoffs: 52, toNext: '44.7%', dwell: '67s', share: 7.5 },
  { stage: 'purchase', label: 'Purchase', reached: 42, dropoffs: 0, toNext: null, dwell: '\u2014', share: 3.4 },
];

const MOCK_FIXES = [
  {
    id: 'f1',
    title: 'Payment form validation error',
    where: '/checkout (Payment step)',
    steps: ['Check if the payment iframe loads correctly on all browsers', 'Add error boundary around the payment form component', 'Log the full error to Sentry for detailed stack trace'],
    signature: 'TypeError: Cannot read properties of undefined (reading "submit")',
  },
  {
    id: 'f2',
    title: 'Size selector unresponsive',
    where: '/products/* (variant picker)',
    steps: ['Verify click handlers are attached after DOM hydration', 'Check for z-index conflicts with overlay elements', 'Test with slow 3G to see if async variant fetch blocks the UI'],
    signature: null,
  },
];

/* ── Sparkline helper ───────────────────────────────────────────────────── */
function MiniSparkline({ direction }) {
  const pts = direction === 'up'
    ? [{ x: 0, y: 24 }, { x: 20, y: 20 }, { x: 40, y: 22 }, { x: 60, y: 16 }, { x: 80, y: 12 }, { x: 100, y: 4 }]
    : direction === 'down'
      ? [{ x: 0, y: 4 }, { x: 20, y: 8 }, { x: 40, y: 6 }, { x: 60, y: 14 }, { x: 80, y: 18 }, { x: 100, y: 24 }]
      : [{ x: 0, y: 14 }, { x: 20, y: 12 }, { x: 40, y: 16 }, { x: 60, y: 13 }, { x: 80, y: 15 }, { x: 100, y: 14 }];

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = `${line} L100,28 L0,28 Z`;
  const colorClass = direction === 'up' ? 'si2-kpi-sparkline-up' : direction === 'down' ? 'si2-kpi-sparkline-down' : '';

  return (
    <svg viewBox="0 0 100 28" role="presentation">
      <defs>
        <linearGradient id={`sp-grad-${direction}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sp-grad-${direction})`} className={`si2-kpi-sparkline-area ${colorClass}`} />
      <path d={line} className={`si2-kpi-sparkline-path ${colorClass}`} />
      <circle cx={pts[0].x} cy={pts[0].y} r="2" className={`si2-kpi-sparkline-dot ${colorClass}`} />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="2.4" className={`si2-kpi-sparkline-dot ${colorClass}`} />
    </svg>
  );
}

/* ── Horizontal bar helper ──────────────────────────────────────────────── */
function BarList({ items, labelKey = 'value', valueKey = 'count' }) {
  const max = Math.max(...items.map((r) => Number(r[valueKey]) || 0), 1);
  return (
    <div className="si2-bars">
      {items.map((row, idx) => {
        const width = Math.round(((Number(row[valueKey]) || 0) / max) * 100);
        return (
          <div key={row[labelKey] || idx} className="si2-bar-row">
            <div className="si2-bar-label">{row[labelKey]}</div>
            <div className="si2-bar-track">
              <div className="si2-bar-fill" style={{ width: `${width}%` }} />
            </div>
            <div className="si2-bar-value">{Number(row[valueKey]).toLocaleString()}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Stage key helper ───────────────────────────────────────────────────── */
function stageClass(stage) {
  const s = String(stage).toLowerCase();
  if (s === 'home' || s === 'landing') return 'si2-stage-home';
  if (s === 'product') return 'si2-stage-product';
  if (s === 'cart') return 'si2-stage-cart';
  if (s.includes('checkout') || s.includes('payment') || s.includes('shipping')) return 'si2-stage-checkout';
  if (s === 'purchase') return 'si2-stage-purchase';
  return '';
}

/* ════════════════════════════════════════════════════════════════════════ */
/* Main Preview Component                                                  */
/* ════════════════════════════════════════════════════════════════════════ */
export default function SessionIntelligencePreview() {
  return (
    <div className="si2-root">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="si2-header">
        <div className="si2-title">
          <h2>Session Intelligence</h2>
          <p>Live shopper journeys, checkout drop-offs, and AI-ready insights.</p>
        </div>
        <div className="si2-actions">
          <div className="si2-pill">
            <span className="si2-pill-dot" />
            Connected
          </div>
          <button className="si2-btn" type="button">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </header>

      <div className="si2-stack">

        {/* ── Today's Session Pulse ─────────────────────────────────── */}
        <div className="si2-card si2-card-accent">
          <div className="si2-card-title">
            <h3>{"Today\u2019s Session Pulse"}</h3>
            <span className="si2-muted">{"Live \u2022 updated 14:32:18"}</span>
          </div>
          <div className="si2-pulse-main">
            <div className="si2-pulse-value">{MOCK_DAY_PULSE.sessionsSoFar.toLocaleString()}</div>
            <div className="si2-pulse-side">
              <span className="si2-chip si2-chip-mid">{MOCK_DAY_PULSE.projectionLabel} day</span>
              <span className="si2-muted">Projected: {MOCK_DAY_PULSE.projectedSessions.toLocaleString()}</span>
            </div>
          </div>
          <div className="si2-pulse-sub">Sessions recorded so far today</div>
          <div className="si2-pulse-comparisons">
            {MOCK_DAY_PULSE.comparisons.map((c) => (
              <div key={c.label} className={`si2-pulse-delta si2-pulse-delta-${c.direction}`}>
                <span>{c.arrow}</span>
                <span>{c.deltaLabel}</span>
                <span className="si2-pulse-delta-label">{c.label}</span>
                <span className="si2-pulse-delta-baseline">{c.sessions.toLocaleString()} sessions</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Realtime Overview ─────────────────────────────────────── */}
        <div className="si2-card">
          <div className="si2-card-title">
            <h3>Realtime overview</h3>
            <span className="si2-muted">{"KPI cards: today so far \u2022 Map/events: last 30m \u2022 Last event 3s ago"}</span>
          </div>

          <div className="si2-row" style={{ marginBottom: 14 }}>
            <button className="si2-btn si2-btn-sm" type="button">Refresh</button>
            <span className="si2-muted">Last refreshed at 14:32:18</span>
            <span style={{ flex: 1 }} />
            <span className="si2-muted">Map</span>
            <button className="si2-btn si2-btn-sm si2-btn-active" type="button">World</button>
            <button className="si2-btn si2-btn-sm" type="button">Focus</button>
          </div>

          {/* Primary KPIs */}
          <div className="si2-grid-3" style={{ marginBottom: 14 }}>
            {MOCK_REALTIME_KPIS.map((card) => (
              <div key={card.key} className="si2-card si2-kpi-primary" style={{ padding: '14px 16px' }}>
                <div className="si2-kpi-head">
                  <div className="si2-kpi-label">{card.label}</div>
                  <div className="si2-kpi-sparkline">
                    <MiniSparkline direction={card.sparklineDirection} />
                  </div>
                </div>
                <div className="si2-kpi-value">{card.value.toLocaleString()}</div>
                <div className="si2-kpi-deltas">
                  {card.comparisons.map((c) => (
                    <span key={c.label} className={`si2-kpi-delta si2-kpi-delta-${c.direction}`}>
                      {c.arrow} {c.deltaLabel}
                      <span className="si2-kpi-delta-label">{c.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Secondary KPIs */}
          <div className="si2-grid-4" style={{ marginBottom: 14 }}>
            {MOCK_SECONDARY_KPIS.map((card) => (
              <div key={card.key} className="si2-kpi-secondary">
                <div className="si2-kpi-label">{card.label}</div>
                <div className="si2-kpi-value">{card.value.toLocaleString()}</div>
              </div>
            ))}
          </div>

          {/* 4-panel grid */}
          <div className="si2-panel-grid">
            <div className="si2-panel">
              <div className="si2-panel-title">
                <span>Geo hotspots (last 30m)</span>
                <span className="si2-muted">By country</span>
              </div>
              <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--si2-border)', borderRadius: 'var(--si2-radius-sm)', marginBottom: 10 }}>
                <span className="si2-muted">Map placeholder</span>
              </div>
              {[{ c: 'Saudi Arabia', n: 187 }, { c: 'UAE', n: 94 }, { c: 'Kuwait', n: 43 }, { c: 'Egypt', n: 31 }].map((r) => (
                <div key={r.c} className="si2-bar-row" style={{ marginBottom: 2 }}>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--si2-text-secondary)' }}>{r.c}</span>
                  <span style={{ fontWeight: 650, fontSize: 12 }}>{r.n}</span>
                </div>
              ))}
            </div>

            <div className="si2-panel">
              <div className="si2-panel-title">
                <span>Active sessions by source</span>
                <span className="si2-muted">Last touch</span>
              </div>
              <BarList items={MOCK_SOURCES} />
            </div>

            <div className="si2-panel">
              <div className="si2-panel-title">
                <span>Current pages</span>
                <span className="si2-muted">Where users are</span>
              </div>
              <BarList items={MOCK_PAGES} />
            </div>

            <div className="si2-panel">
              <div className="si2-panel-title">
                <span>Events (last 30m)</span>
                <span className="si2-muted">By event name</span>
              </div>
              <BarList items={MOCK_EVENTS} labelKey="name" />
            </div>
          </div>
        </div>

        {/* ── Summary ──────────────────────────────────────────────── */}
        <div className="si2-card si2-card-accent">
          <div className="si2-card-title">
            <h3>Summary</h3>
            <span className="si2-muted">{"Today \u2022 Ranked by impact"}</span>
          </div>
          <div className="si2-summary-line">
            {"Payment form validation failures are the #1 issue today, blocking 23 high-intent sessions at checkout. iOS shoppers from Instagram paid traffic show 1.8\u00d7 higher cart abandonment than baseline. Size selector friction on product pages is the second biggest drop-off driver."}
          </div>
          <button className="si2-btn si2-btn-sm" type="button" style={{ marginBottom: 14 }}>
            Fix biggest issue
          </button>
          <div className="si2-summary-kpis">
            {[
              { label: 'Sessions', value: '1,247' },
              { label: 'High-intent sessions', value: '419' },
              { label: 'Purchases', value: '42' },
              { label: 'Estimated at risk', value: '67' },
            ].map((kpi) => (
              <div key={kpi.label} className="si2-summary-kpi">
                <div className="si2-summary-kpi-label">{kpi.label}</div>
                <div className="si2-summary-kpi-value">{kpi.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Journey Grid: Abandonment + Landing ──────────────────── */}
        <div className="si2-grid-2">
          {/* Abandonment map */}
          <div className="si2-card">
            <div className="si2-card-title">
              <h3>Abandonment map</h3>
              <span className="si2-muted">Last 7 days</span>
            </div>
            <div className="si2-stage-row">
              {MOCK_STAGE_TRENDS.map((t) => (
                <span key={t.stage} className={`si2-stage-pill ${stageClass(t.stage)} ${t.significant ? 'si2-stage-pill-significant' : ''}`}>
                  <span>{t.stage}</span>
                  <span className="si2-stage-pill-count">{t.count}</span>
                  <span className={`si2-stage-trend-${t.direction}`}>{t.trend}</span>
                </span>
              ))}
            </div>
            <div className="si2-table-wrap">
              <table className="si2-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Section</th>
                    <th>Drop-off area</th>
                    <th>Product context</th>
                    <th>Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_ABANDONMENT.map((row) => (
                    <tr key={row.rank}>
                      <td><strong>{row.rank}</strong></td>
                      <td><span className={`si2-stage-pill si2-stage-pill-inline ${stageClass(row.stage)}`}>{row.stage}</span></td>
                      <td>{row.area}</td>
                      <td>{row.product}</td>
                      <td><strong>{row.sessions}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="si2-muted" style={{ marginTop: 10 }}>
              Classified sessions: 1,247. Unclassified: 34. Breakdown: 28 no events, 6 unknown path.
            </div>
          </div>

          {/* Landing pages */}
          <div className="si2-card">
            <div className="si2-card-title">
              <h3>Landing pages that lead to purchases</h3>
              <span className="si2-muted">Last 7 days</span>
            </div>
            <div className="si2-stage-row">
              {MOCK_STAGE_TRENDS.slice(0, 3).map((t) => (
                <span key={t.stage} className={`si2-stage-pill ${stageClass(t.stage)}`}>
                  <span>{t.stage}</span>
                  <span className="si2-stage-pill-count">{t.count}</span>
                  <span className={`si2-stage-trend-${t.direction}`}>{t.trend}</span>
                </span>
              ))}
            </div>
            <div className="si2-table-wrap">
              <table className="si2-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Section</th>
                    <th>Landing page</th>
                    <th>Purchases</th>
                    <th>Purchase record</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_LANDING.map((row) => (
                    <tr key={row.rank}>
                      <td><strong>{row.rank}</strong></td>
                      <td><span className={`si2-stage-pill si2-stage-pill-inline ${stageClass(row.stage)}`}>{row.stage}</span></td>
                      <td>{row.landing}</td>
                      <td><strong>{row.purchases}</strong></td>
                      <td>{row.record}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="si2-muted" style={{ marginTop: 10 }}>
              Attributed purchases: 40 / 42. Unattributed: 2. Breakdown: 2 unknown referrer.
            </div>
          </div>
        </div>

        {/* ── Top Issues ───────────────────────────────────────────── */}
        <div className="si2-card">
          <div className="si2-card-title">
            <h3>Top issues</h3>
            <span className="si2-muted">{"Ranked by high-intent impact \u2022 Investigating"}</span>
          </div>

          <div className="si2-row" style={{ marginBottom: 12 }}>
            <button className="si2-btn si2-btn-sm si2-btn-active" type="button">Investigating</button>
            <button className="si2-btn si2-btn-sm" type="button">Confirmed</button>
            <span className="si2-muted">Verifier: 2 confirmed, 0 false alerts, 2 under review</span>
          </div>

          <div className="si2-table-wrap">
            <table className="si2-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Issue</th>
                  <th>Where</th>
                  <th>Sessions</th>
                  <th>% high-intent</th>
                  <th>Status</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_ISSUES.map((row, idx) => (
                  <tr key={row.id}>
                    <td><strong>{idx + 1}</strong></td>
                    <td>
                      <div className="si2-issue-cell">
                        <span className="si2-issue-name">{row.name}</span>
                        <span className={`si2-issue-badge si2-issue-badge-${row.type}`}>{row.badge}</span>
                      </div>
                    </td>
                    <td className="si2-issue-where" title={row.where}>{row.where}</td>
                    <td>{row.sessions} sessions</td>
                    <td>{row.highIntent}</td>
                    <td>
                      <span className={`si2-chip si2-verify-${row.verification}`}>{row.status}</span>
                    </td>
                    <td>
                      <button className="si2-btn si2-btn-sm" type="button">View 3</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Abandonment by Device ────────────────────────────────── */}
        <div className="si2-card">
          <div className="si2-card-title">
            <h3>Abandonment by device</h3>
            <span className="si2-muted">{"Traffic-adjusted view \u2022 Today"}</span>
          </div>

          <div className="si2-device-layout">
            <div className="si2-device-pie-wrap">
              <div className="si2-device-pie" style={{ background: MOCK_DEVICE_ABANDON.pieGradient }}>
                <div className="si2-device-pie-center">
                  <div className="si2-device-pie-value">{MOCK_DEVICE_ABANDON.baselineRate}</div>
                  <div className="si2-device-pie-label">Baseline<br />abandon rate</div>
                </div>
              </div>
            </div>
            <div className="si2-device-legend">
              {MOCK_DEVICE_ABANDON.rows.map((row) => (
                <div key={row.key} className="si2-device-legend-row">
                  <span className="si2-device-dot" style={{ background: row.color }} />
                  <span className="si2-device-legend-name">{row.label}</span>
                  <span className="si2-device-legend-share">{row.share}</span>
                  <span className={`si2-device-legend-excess ${row.positive ? 'si2-device-legend-excess-positive' : 'si2-device-legend-excess-neutral'}`}>
                    {row.excess}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="si2-device-callout">
            Strongest over-index today: <strong>iOS</strong> (38.2% abandon rate), most commonly at <strong>Payment</strong>.
          </div>

          <div className="si2-table-wrap">
            <table className="si2-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Sessions</th>
                  <th>Abandon rate</th>
                  <th>Adjusted index</th>
                  <th>Likely abandon section</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_DEVICE_ABANDON.rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="si2-device-dot" style={{ background: row.color }} />
                        <strong>{row.label}</strong>
                      </span>
                    </td>
                    <td>{row.sessions} sessions</td>
                    <td>{row.rate}</td>
                    <td>{row.index}</td>
                    <td>{row.topSection}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Behavior Patterns ────────────────────────────────────── */}
        <div className="si2-card">
          <div className="si2-card-title">
            <h3>Behavior patterns</h3>
            <span className="si2-muted">Campaign/country segments that over-index vs the day baseline</span>
          </div>
          <div className="si2-patterns">
            {MOCK_PATTERNS.map((row, idx) => (
              <div key={row.id} className="si2-pattern-row">
                <div className="si2-pattern-rank">{idx + 1}</div>
                <div className="si2-pattern-body">
                  <div className="si2-pattern-title">{row.title}</div>
                  <div className="si2-pattern-where">{row.where}</div>
                  <div className="si2-pattern-evidence"><strong>Observation:</strong> {row.observation}</div>
                  <div className="si2-pattern-evidence"><strong>What it suggests:</strong> {row.suggests}</div>
                  <div className="si2-pattern-evidence"><strong>Next check:</strong> {row.nextCheck}</div>
                  <div className="si2-pattern-evidence"><strong>Fix first:</strong> {row.fixFirst}</div>
                </div>
                <div className="si2-pattern-meta">
                  <span className={`si2-chip ${row.status === 'Established' ? 'si2-chip-established' : 'si2-chip-emerging'}`}>{row.status}</span>
                  <div className="si2-pattern-impact">{row.statusLine}</div>
                  <button className="si2-btn si2-btn-sm" type="button">View evidence</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Developer Fix Instructions ───────────────────────────── */}
        <div className="si2-card">
          <div className="si2-card-title">
            <h3>Developer fix instructions</h3>
            <span className="si2-muted">How to resolve each top technical issue</span>
          </div>
          <div className="si2-fix-grid">
            {MOCK_FIXES.map((fix) => (
              <div key={fix.id} className="si2-fix-card">
                <div className="si2-fix-title">{fix.title}</div>
                <div className="si2-fix-where">{fix.where}</div>
                <ol className="si2-fix-list">
                  {fix.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                {fix.signature ? (
                  <div className="si2-fix-tech">
                    <span className="si2-muted">Technical signature</span>
                    <code>{fix.signature}</code>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* ── Shop Walk ────────────────────────────────────────────── */}
        <div className="si2-card">
          <div className="si2-card-title">
            <h3>Shop walk</h3>
            <span className="si2-muted">{"Today \u2022 1,247 sessions"}</span>
          </div>

          <div className="si2-row" style={{ marginBottom: 14 }}>
            <button className="si2-btn si2-btn-active" type="button">All sessions</button>
            <button className="si2-btn" type="button">High intent (no purchase)</button>
            <button className="si2-btn si2-btn-sm" type="button">Reload</button>
          </div>

          <div className="si2-flow">
            <div className="si2-flow-track" aria-hidden="true" />
            <div className="si2-flow-stations">
              {MOCK_FLOW_STAGES.map((stage) => (
                <div key={stage.stage} className="si2-flow-stage">
                  <div className="si2-flow-stage-dot" />
                  <div className="si2-flow-label">{stage.label}</div>
                  <div className="si2-flow-reached">{stage.reached.toLocaleString()}</div>
                  <div className="si2-flow-bar" aria-hidden="true">
                    <div className="si2-flow-bar-fill" style={{ width: `${stage.share}%` }} />
                  </div>
                  <div className="si2-flow-metrics">
                    <div>
                      <div className="si2-flow-metric-label">To next</div>
                      <div className="si2-flow-metric-value">{stage.toNext || '\u2014'}</div>
                    </div>
                    <div>
                      <div className="si2-flow-metric-label">Dwell p50</div>
                      <div className="si2-flow-metric-value">{stage.dwell}</div>
                    </div>
                  </div>
                  <div className={`si2-flow-dropoff ${stage.dropoffs > 0 ? '' : 'si2-flow-dropoff-none'}`}>
                    Drop-offs: {stage.dropoffs}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
