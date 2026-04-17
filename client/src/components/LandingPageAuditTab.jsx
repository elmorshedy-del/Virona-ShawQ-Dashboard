import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Save,
  Share2,
  Trash2,
  Upload
} from 'lucide-react';
import './LandingPageAudit.css';

const API_BASE = '/api/landing-audit';
const RING_RADIUS = 86;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const INTRO_PHASE_MS = 2_000;
const INTRO_SCAN_MS = 3_800;
const INTRO_SCORE_UP_MS = 1_200;
const INTRO_SCORE_PAUSE_MS = 600;
const INTRO_SCORE_SETTLE_MS = 900;
const INTRO_SCORE_HOLD_MS = 800;
const INTRO_DEMO_SCORE = 72;
const INTRO_CATEGORIES = ['First Impression', 'Copy & Messaging', 'Call-to-Action', 'Trust & Proof', 'Mobile & Access', 'Performance'];
const INTRO_CATEGORY_CYCLE_MS = 150;
const INTRO_SEEN_KEY_PREFIX = 'lpa_intro_seen_';
const BAR_ANIMATION_STAGGER_MS = 90;
const COUNTER_ANIMATION_MS = 1_100;
const BUSINESS_TYPES = ['SaaS', 'E-commerce', 'Agency', 'Course/Info Product', 'Newsletter/Lead Magnet', 'Startup', 'Other'];
const CONVERSION_GOALS = ['Sign Up', 'Purchase', 'Lead Form', 'Demo Call', 'Download', 'Other'];
/* ── Animated SVG dimension icons (matching original design commit 79ac322) ── */
const DimensionIconEye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" className="lpa-m-eye-pupil" />
  </svg>
);
const DimensionIconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 10h8" className="lpa-m-msg-line1" />
    <path d="M8 14h4" className="lpa-m-msg-line2" />
  </svg>
);
const DimensionIconCTA = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="12" cy="12" r="3" className="lpa-m-cta-pulse" />
  </svg>
);
const DimensionIconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" className="lpa-m-shield-check" />
  </svg>
);
const DimensionIconMobile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="lpa-m-mobile-device">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);
const DimensionIconBolt = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" className="lpa-m-bolt-zap">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const DIMENSION_ICON_COMPONENT = {
  'First Impression': DimensionIconEye,
  'Copy & Messaging': DimensionIconCopy,
  'Call-to-Action': DimensionIconCTA,
  'Trust & Proof': DimensionIconShield,
  'Mobile & Access': DimensionIconMobile,
  Performance: DimensionIconBolt
};

/* ── Model options with estimated cost per audit ── */
const MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', estimatedCost: '$0.05' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google', estimatedCost: '$0.01' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google', estimatedCost: '$0.02' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google', estimatedCost: '$0.005' }
];
const DEFAULT_MODEL = MODEL_OPTIONS[0].value;

async function parseApiResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: `HTTP ${response.status}` };
  }
}

function getStoreId(store) {
  if (typeof store === 'string') return store;
  return store?.id || 'unknown-store';
}

function gradeTone(grade) {
  if (String(grade).startsWith('A')) return 'good';
  if (String(grade).startsWith('B')) return 'violet';
  return 'warn';
}

function scoreTone(score) {
  if (score >= 85) return 'good';
  if (score >= 70) return 'violet';
  return 'warn';
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

function readAuditForView(row) {
  return {
    id: row.id,
    overall: {
      score: row.score,
      grade: row.grade,
      verdict: ''
    },
    meta: {
      url: row.url,
      businessType: row.business_type,
      conversionGoal: row.conversion_goal,
      targetCustomer: row.target_customer,
      auditDate: row.created_at,
      toolsUsed: []
    },
    dimensions: [],
    roasts: [],
    wins: [],
    antiPatterns: [],
    improvementPath: {
      steps: [],
      currentGrade: row.grade,
      projectedGrade: row.grade,
      totalEstimatedTime: '—'
    }
  };
}

export default function LandingPageAuditTab({ store }) {
  const storeId = getStoreId(store);
  const [form, setForm] = useState({
    url: '',
    businessType: 'E-commerce',
    conversionGoal: 'Purchase',
    targetCustomer: '',
    model: DEFAULT_MODEL
  });
  const [manualMode, setManualMode] = useState(false);
  const [rawHtml, setRawHtml] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fetchWarnings, setFetchWarnings] = useState([]);
  const [history, setHistory] = useState([]);
  const [audit, setAudit] = useState(null);
  const [lastCost, setLastCost] = useState(null);
  const [activeDimension, setActiveDimension] = useState('First Impression');
  const [displayScore, setDisplayScore] = useState(0);
  const [introVisible, setIntroVisible] = useState(false);
  const [introPhase, setIntroPhase] = useState(0);
  const [introScore, setIntroScore] = useState(0);
  const [introCategory, setIntroCategory] = useState('');
  const introTimeoutRef = useRef([]);
  const introCatIntervalRef = useRef(null);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/history/${encodeURIComponent(storeId)}`);
      const payload = await parseApiResponse(response);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to load history');
      }
      setHistory(payload.history || []);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load history');
    }
  }, [storeId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const targetScore = Number(audit?.overall?.score || 0);
    let frameId;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - start) / COUNTER_ANIMATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayScore(Math.round(targetScore * eased));
      if (progress < 1) frameId = requestAnimationFrame(step);
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [audit?.overall?.score]);

  useEffect(() => {
    return () => {
      introTimeoutRef.current.forEach((id) => clearTimeout(id));
      introTimeoutRef.current = [];
      if (introCatIntervalRef.current) clearInterval(introCatIntervalRef.current);
    };
  }, []);

  const primaryFindings = useMemo(() => {
    if (!audit?.dimensions?.length) return [];
    return audit.dimensions
      .flatMap((dimension) => (dimension.findings || []).map((finding) => ({ ...finding, dimension: dimension.name })))
      .filter((finding) => finding.severity !== 'PASS')
      .slice(0, 6);
  }, [audit]);

  const activeDimensionRecord = useMemo(
    () => audit?.dimensions?.find((dimension) => dimension.name === activeDimension) || null,
    [audit, activeDimension]
  );

  const runIntro = useCallback((score) => {
    introTimeoutRef.current.forEach((id) => clearTimeout(id));
    introTimeoutRef.current = [];
    if (introCatIntervalRef.current) clearInterval(introCatIntervalRef.current);
    setIntroVisible(true);
    setIntroPhase(0);
    setIntroScore(0);
    setIntroCategory('Initializing\u2026');

    const phase2Start = INTRO_PHASE_MS + INTRO_SCAN_MS;
    const target = Number(score || 0);

    /* Phase-1 (scanner) and Phase-2 (score reveal) transitions */
    introTimeoutRef.current.push(setTimeout(() => setIntroPhase(1), INTRO_PHASE_MS));
    introTimeoutRef.current.push(setTimeout(() => setIntroPhase(2), phase2Start));

    /* ── Two-phase score counter (matches original design) ──
       0 → 100 (overshoot) in 1200ms → pause 600ms → 100 → 72 (settle) in 900ms
       Category text cycles through dimensions at 150ms, then stops at "Opportunities Detected" */
    const animateCounter = (from, to, duration, onDone) => {
      const start = performance.now();
      const step = (now) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setIntroScore(Math.round(from + (to - from) * eased));
        if (p < 1) requestAnimationFrame(step);
        else if (onDone) onDone();
      };
      requestAnimationFrame(step);
    };

    introTimeoutRef.current.push(
      setTimeout(() => {
        /* Start category cycling */
        let catIdx = 0;
        introCatIntervalRef.current = setInterval(() => {
          setIntroCategory('Analysing: ' + INTRO_CATEGORIES[catIdx % INTRO_CATEGORIES.length]);
          catIdx++;
        }, INTRO_CATEGORY_CYCLE_MS);

        /* Phase A – count 0 → 100 */
        animateCounter(0, 100, INTRO_SCORE_UP_MS, () => {
          /* Phase B – pause, then settle 100 → target */
          introTimeoutRef.current.push(
            setTimeout(() => {
              animateCounter(100, target, INTRO_SCORE_SETTLE_MS, () => {
                /* Stop category cycling and show final message */
                if (introCatIntervalRef.current) {
                  clearInterval(introCatIntervalRef.current);
                  introCatIntervalRef.current = null;
                }
                setIntroCategory('Opportunities Detected');
              });
            }, INTRO_SCORE_PAUSE_MS)
          );
        });
      }, phase2Start)
    );

    /* Dismiss intro after score fully settles + short hold */
    const totalDuration =
      phase2Start + INTRO_SCORE_UP_MS + INTRO_SCORE_PAUSE_MS + INTRO_SCORE_SETTLE_MS + INTRO_SCORE_HOLD_MS;
    introTimeoutRef.current.push(
      setTimeout(() => {
        if (introCatIntervalRef.current) {
          clearInterval(introCatIntervalRef.current);
          introCatIntervalRef.current = null;
        }
        setIntroVisible(false);
        setIntroPhase(0);
      }, totalDuration)
    );
  }, []);

  useEffect(() => {
    const key = `${INTRO_SEEN_KEY_PREFIX}${storeId}`;
    try {
      if (!sessionStorage.getItem(key)) {
        runIntro(INTRO_DEMO_SCORE);
        sessionStorage.setItem(key, '1');
      }
    } catch {
      /* sessionStorage unavailable — skip intro guard */
    }
  }, [storeId, runIntro]);

  const runAudit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setLastCost(null);
    setFetchWarnings([]);
    setIsRunning(true);

    try {
      const body = {
        store: storeId,
        url: form.url,
        businessType: form.businessType,
        conversionGoal: form.conversionGoal,
        targetCustomer: form.targetCustomer,
        model: form.model
      };

      if (manualMode && rawHtml.trim()) {
        body.rawHtml = rawHtml;
      }

      const response = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const payload = await parseApiResponse(response);
      if (!response.ok || !payload?.success || !payload?.audit) {
        throw new Error(payload?.error || 'Failed to run audit');
      }

      setAudit(payload.audit);
      setActiveDimension('First Impression');
      if (payload.estimatedCost) setLastCost(payload.estimatedCost);
      if (payload.fetchWarnings?.length) setFetchWarnings(payload.fetchWarnings);
      if (payload.fetchStrategy && payload.fetchStrategy !== 'puppeteer') {
        setNotice(`Fetched via ${payload.fetchStrategy} mode — some visual/performance checks may be limited.`);
      }
      await loadHistory();
    } catch (runError) {
      setError(runError.message || 'Failed to run audit');
    } finally {
      setIsRunning(false);
    }
  };

  const deleteAudit = async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}?store=${encodeURIComponent(storeId)}`, { method: 'DELETE' });
      const payload = await parseApiResponse(response);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Delete failed');
      }
      if (audit?.id === id) setAudit(null);
      await loadHistory();
    } catch (deleteError) {
      setError(deleteError.message || 'Failed to delete audit');
    }
  };

  const viewAudit = async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}?store=${encodeURIComponent(storeId)}`);
      const payload = await parseApiResponse(response);
      if (!response.ok || !payload?.success || !payload?.audit) {
        throw new Error(payload?.error || 'Failed to load audit');
      }
      const resultAudit = payload.audit.result ? { id, ...payload.audit.result } : readAuditForView(payload.audit);
      setAudit(resultAudit);
    } catch (viewError) {
      setError(viewError.message || 'Failed to load audit');
    }
  };

  const saveReport = () => {
    if (!audit) return;
    try {
      const key = `landing_audit_saved_${storeId}`;
      localStorage.setItem(key, JSON.stringify(audit));
      setNotice('Report saved to browser storage.');
    } catch {
      setError('Failed to save report locally.');
    }
  };

  const exportJson = () => {
    if (!audit) return;
    const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `landing-audit-${storeId}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportAuditById = async (id) => {
    try {
      const response = await fetch(`${API_BASE}/${id}?store=${encodeURIComponent(storeId)}`);
      const payload = await parseApiResponse(response);
      if (!response.ok || !payload?.success || !payload?.audit) {
        throw new Error(payload?.error || 'Failed to load audit export.');
      }
      const targetAudit = payload.audit.result ? { id, ...payload.audit.result } : readAuditForView(payload.audit);
      const blob = new Blob([JSON.stringify(targetAudit, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `landing-audit-${storeId}-${id}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (exportError) {
      setError(exportError.message || 'Failed to export audit');
    }
  };

  const shareAudit = async () => {
    if (!audit?.id) return;
    try {
      const shareUrl = `${window.location.origin}${window.location.pathname}?tab=Landing%20Page%20Audit&auditId=${audit.id}`;
      await navigator.clipboard.writeText(shareUrl);
      setNotice('Share link copied to clipboard.');
    } catch {
      setError('Failed to copy share link.');
    }
  };

  const scoreOffset = RING_CIRCUMFERENCE - ((Math.max(0, Math.min(100, displayScore)) / 100) * RING_CIRCUMFERENCE);

  return (
    <div className="lpa-shell">
      {introVisible && (
        <div className="lpa-intro-overlay" aria-live="polite">
          <div className={`lpa-intro-phase lpa-intro-phase--${introPhase}`}>
            {introPhase === 0 && (
              <div className="lpa-intro-headline-card">
                <div className="lpa-hl-words-wrap">
                  <span className="lpa-hl-word" style={{ '--i': 0 }}>Know</span>
                  <span className="lpa-hl-word" style={{ '--i': 1 }}>why</span>
                  <span className="lpa-hl-word" style={{ '--i': 2 }}>visitors</span>
                  <span className="lpa-hl-word lpa-violet" style={{ '--i': 3 }}>leave.</span>
                </div>
                <p className="lpa-hl-subhead">Landing Page Audit</p>
              </div>
            )}
            {introPhase === 1 && (
              <div className="lpa-intro-scanner">
                <div className="lpa-intro-browser-bar" />
                <div className="lpa-intro-wireframe" />
                <div className="lpa-intro-scan-line" />
                <div className="lpa-intro-marker lpa-intro-marker--critical">No social proof</div>
                <div className="lpa-intro-marker lpa-intro-marker--warning">CTA low contrast</div>
                <div className="lpa-intro-marker lpa-intro-marker--good">Fast load time</div>
              </div>
            )}
            {introPhase === 2 && (
              <div className="lpa-intro-score">
                <div className="lpa-sr-category">{introCategory}</div>
                <div className="lpa-sr-score">{introScore}</div>
                <div className="lpa-sr-denom">/100</div>
                <div className="lpa-sr-grade">Grade C+</div>
                <div className="lpa-sr-verdict">Visitors are leaving before they convert.</div>
              </div>
            )}
          </div>
        </div>
      )}

      <section className="lpa-input-card">
        <p className="lpa-eyebrow">Conversion Intelligence</p>
        <h2>Landing Page Audit</h2>
        <p className="lpa-subtitle">Claude-powered landing page scoring with roast-my-landing-page rubric fidelity.</p>

        <div className="lpa-mode-toggle">
          <button
            type="button"
            className={`lpa-mode-btn ${!manualMode ? 'is-active' : ''}`}
            onClick={() => setManualMode(false)}
          >
            <Globe size={14} /> URL Fetch
          </button>
          <button
            type="button"
            className={`lpa-mode-btn ${manualMode ? 'is-active' : ''}`}
            onClick={() => setManualMode(true)}
          >
            <Code2 size={14} /> Paste HTML
          </button>
        </div>

        {manualMode && (
          <div className="lpa-manual-hint">
            <AlertTriangle size={14} />
            <span>Paste your page&apos;s HTML source below. Use this when the site is behind auth, bot protection, or when browser-based fetching fails in your environment.</span>
          </div>
        )}

        <form className="lpa-form" onSubmit={runAudit}>
          <label>
            <span>URL {manualMode ? '(optional — for labelling)' : ''}</span>
            <div className="lpa-input-wrap">
              <Globe size={16} />
              <input
                type="text"
                placeholder={manualMode ? 'e.g. www.example.com (optional)' : 'e.g. www.shawq.co or https://shawq.co'}
                value={form.url}
                onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                required={!manualMode}
              />
            </div>
          </label>

          {manualMode && (
            <label>
              <span>HTML Source <span className="lpa-required">*</span></span>
              <textarea
                className="lpa-html-textarea"
                placeholder="Paste the full HTML source of the page here (Ctrl+U / Cmd+U in browser → Select All → Copy)"
                value={rawHtml}
                onChange={(event) => setRawHtml(event.target.value)}
                required
                rows={6}
              />
              {rawHtml.length > 0 && (
                <small className="lpa-html-size">{Math.round(rawHtml.length / 1024)} KB</small>
              )}
            </label>
          )}

          <label>
            <span>Business Type</span>
            <select
              value={form.businessType}
              onChange={(event) => setForm((prev) => ({ ...prev, businessType: event.target.value }))}
            >
              {BUSINESS_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <label>
            <span>Conversion Goal</span>
            <select
              value={form.conversionGoal}
              onChange={(event) => setForm((prev) => ({ ...prev, conversionGoal: event.target.value }))}
            >
              {CONVERSION_GOALS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>

          <label>
            <span>Target Customer</span>
            <input
              type="text"
              value={form.targetCustomer}
              onChange={(event) => setForm((prev) => ({ ...prev, targetCustomer: event.target.value }))}
              required
            />
          </label>

          <label>
            <span>Model</span>
            <select
              value={form.model}
              onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} (~{option.estimatedCost}/audit)
                </option>
              ))}
            </select>
          </label>

          <button className="lpa-run-btn" type="submit" disabled={isRunning}>
            {isRunning ? <Loader2 size={16} className="lpa-spin" /> : <ArrowRight size={16} />}
            {isRunning ? 'Running audit...' : 'Run Audit'}
          </button>
        </form>

        {error && <p className="lpa-error">{error}</p>}
        {notice && <p className="lpa-notice">{notice}</p>}
        {fetchWarnings.length > 0 && (
          <div className="lpa-fetch-warnings">
            <AlertTriangle size={14} />
            <ul>
              {fetchWarnings.map((warning, index) => <li key={`fw-${index}`}>{warning}</li>)}
            </ul>
          </div>
        )}
        {lastCost && <p className="lpa-notice">Estimated cost for this audit: {lastCost}</p>}
      </section>

      {audit && (
        <>
          <section className="lpa-results-grid">
            <article className="lpa-card lpa-card--score">
              <div className="lpa-ring-wrap">
                <svg width="220" height="220" viewBox="0 0 220 220" aria-label="Score ring">
                  <circle cx="110" cy="110" r={RING_RADIUS} className="lpa-ring-bg" />
                  <circle
                    cx="110"
                    cy="110"
                    r={RING_RADIUS}
                    className="lpa-ring-value"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={scoreOffset}
                  />
                </svg>
                <div className="lpa-ring-score">
                  <strong>{displayScore}</strong>
                  <span>/100</span>
                </div>
              </div>
              <div className={`lpa-grade-badge lpa-grade-badge--${gradeTone(audit?.overall?.grade)}`}>{audit?.overall?.grade}</div>
              <p className="lpa-verdict">{audit?.overall?.verdict}</p>

              <div className="lpa-metrics">
                {(audit.dimensions || []).map((dimension, index) => {
                  const IconComponent = DIMENSION_ICON_COMPONENT[dimension.name] || null;
                  return (
                    <div key={dimension.name} className="lpa-metric-row" style={{ transitionDelay: `${index * BAR_ANIMATION_STAGGER_MS}ms` }}>
                      <div className="lpa-metric-head">
                        <span className="lpa-metric-icon">{IconComponent ? <IconComponent /> : '📊'}</span>
                        <span>{dimension.name}</span>
                        <strong>{Math.round(dimension.score)}</strong>
                      </div>
                      <div className="lpa-metric-track">
                        <div className="lpa-metric-fill" style={{ width: `${Math.max(0, Math.min(100, dimension.score))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>

            <div className="lpa-right-stack">
              <article className="lpa-card">
                <h3>Critical Findings</h3>
                <div className="lpa-findings-list">
                  {primaryFindings.length === 0 ? <p>No critical findings yet.</p> : primaryFindings.map((finding, index) => (
                    <div key={`${finding.dimension}-${index}`} className={`lpa-finding lpa-finding--${String(finding.severity || '').toLowerCase()}`}>
                      <p><strong>{finding.dimension}</strong> · {finding.text}</p>
                      <small>{finding.fix}</small>
                    </div>
                  ))}
                </div>
              </article>

              <article className="lpa-card">
                <h3>Key Strengths</h3>
                <ul className="lpa-wins">
                  {(audit.wins || []).slice(0, 6).map((win, index) => (
                    <li key={`${win}-${index}`}><CheckCircle2 size={14} /> {win}</li>
                  ))}
                </ul>
              </article>
            </div>
          </section>

          <section className="lpa-card">
            <header className="lpa-section-head">
              <h3>Path to {audit?.improvementPath?.projectedGrade || 'higher grade'}</h3>
              <span>{audit?.improvementPath?.currentGrade} → {audit?.improvementPath?.projectedGrade}</span>
            </header>
            <div className="lpa-steps-grid">
              {(audit?.improvementPath?.steps || []).slice(0, 6).map((step, index) => (
                <article key={`${step.action}-${index}`} className="lpa-step-card">
                  <span className="lpa-step-number">{String(index + 1).padStart(2, '0')}</span>
                  <h4>{step.action}</h4>
                  <p>{step.dimension}: {step.currentScore} → {step.projectedScore}</p>
                  <small>{step.estimatedTime}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="lpa-card">
            <h3>Detailed Findings</h3>
            <div className="lpa-dimension-tabs" role="tablist" aria-label="Audit dimensions">
              {(audit.dimensions || []).map((dimension) => (
                <button
                  key={dimension.name}
                  className={dimension.name === activeDimension ? 'is-active' : ''}
                  onClick={() => setActiveDimension(dimension.name)}
                  type="button"
                >
                  <span className="lpa-severity-dot" />
                  {dimension.name}
                </button>
              ))}
            </div>

            <div className="lpa-dimension-panel">
              {(activeDimensionRecord?.findings || []).map((finding, index) => (
                <article key={`${activeDimensionRecord?.name}-${index}`} className="lpa-detail-item">
                  <h4>{finding.severity}</h4>
                  <p>{finding.text}</p>
                  <small>{finding.fix}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="lpa-actions-row">
            <button type="button" onClick={saveReport}><Save size={15} /> Save Report</button>
            <button type="button" onClick={exportJson}><Download size={15} /> Export JSON</button>
            <button type="button" onClick={shareAudit}><Share2 size={15} /> Share Link</button>
          </section>
        </>
      )}

      <section className="lpa-card">
        <h3>Audit History</h3>
        <div className="lpa-history-table-wrap">
          <table className="lpa-history-table">
            <thead>
              <tr>
                <th>URL</th>
                <th>Score</th>
                <th>Grade</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5}>No audits yet for {storeId}.</td>
                </tr>
              ) : history.map((row) => (
                <tr key={row.id}>
                  <td>{row.url}</td>
                  <td>
                    <span className={`lpa-score-pill lpa-score-pill--${scoreTone(row.score)}`}>{row.score}</span>
                  </td>
                  <td>{row.grade}</td>
                  <td>{formatDate(row.created_at)}</td>
                  <td className="lpa-row-actions">
                    <button type="button" onClick={() => viewAudit(row.id)} aria-label="View audit"><ExternalLink size={15} /></button>
                    <button type="button" onClick={() => exportAuditById(row.id)} aria-label="Export audit"><Download size={15} /></button>
                    <button type="button" onClick={() => deleteAudit(row.id)} aria-label="Delete audit"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
