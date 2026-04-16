import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Save,
  Share2,
  Trash2
} from 'lucide-react';
import './LandingPageAudit.css';

const API_BASE = '/api/landing-audit';
const RING_RADIUS = 86;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const INTRO_PHASE_COUNT = 3;
const INTRO_PHASE_MS = 2_000;
const INTRO_SCAN_MS = 3_800;
const INTRO_SCORE_COUNT_MS = 1_500;
const INTRO_SCORE_HOLD_MS = 2_000;
const INTRO_DEMO_SCORE = 87;
const INTRO_SEEN_KEY_PREFIX = 'lpa_intro_seen_';
const BAR_ANIMATION_STAGGER_MS = 90;
const COUNTER_ANIMATION_MS = 1_100;
const BUSINESS_TYPES = ['SaaS', 'E-commerce', 'Agency', 'Course/Info Product', 'Newsletter/Lead Magnet', 'Startup', 'Other'];
const CONVERSION_GOALS = ['Sign Up', 'Purchase', 'Lead Form', 'Demo Call', 'Download', 'Other'];
const DIMENSION_ICON = {
  'First Impression': '👁️',
  'Copy & Messaging': '⌨️',
  'Call-to-Action': '🎯',
  'Trust & Proof': '🛡️',
  'Mobile & Access': '📱',
  Performance: '⚡'
};

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
    targetCustomer: ''
  });
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState([]);
  const [audit, setAudit] = useState(null);
  const [activeDimension, setActiveDimension] = useState('First Impression');
  const [displayScore, setDisplayScore] = useState(0);
  const [introVisible, setIntroVisible] = useState(false);
  const [introPhase, setIntroPhase] = useState(0);
  const [introScore, setIntroScore] = useState(0);
  const introTimeoutRef = useRef([]);

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
    setIntroVisible(true);
    setIntroPhase(0);
    setIntroScore(0);

    const phase2Start = INTRO_PHASE_MS + INTRO_SCAN_MS;
    const totalDuration = phase2Start + INTRO_SCORE_COUNT_MS + INTRO_SCORE_HOLD_MS;

    introTimeoutRef.current.push(setTimeout(() => setIntroPhase(1), INTRO_PHASE_MS));
    introTimeoutRef.current.push(setTimeout(() => setIntroPhase(2), phase2Start));
    introTimeoutRef.current.push(
      setTimeout(() => {
        setIntroVisible(false);
        setIntroPhase(0);
      }, totalDuration)
    );

    const target = Number(score || 0);
    const overshoot = Math.min(100, target + 5);

    introTimeoutRef.current.push(
      setTimeout(() => {
        const start = performance.now();
        const animate = (now) => {
          const progress = Math.min(1, (now - start) / INTRO_SCORE_COUNT_MS);
          const eased = 1 - Math.pow(1 - progress, 4);
          const current = progress < 0.85
            ? overshoot * (eased / 0.85)
            : target + ((overshoot - target) * (1 - eased));
          setIntroScore(Math.round(Math.max(0, Math.min(100, current))));
          if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      }, phase2Start)
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
    setIsRunning(true);

    try {
      const response = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: storeId,
          url: form.url,
          businessType: form.businessType,
          conversionGoal: form.conversionGoal,
          targetCustomer: form.targetCustomer
        })
      });

      const payload = await parseApiResponse(response);
      if (!response.ok || !payload?.success || !payload?.audit) {
        throw new Error(payload?.error || 'Failed to run audit');
      }

      setAudit(payload.audit);
      setActiveDimension('First Impression');
      runIntro(payload.audit.overall?.score || 0);
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
                <h2>
                  <span>Know</span> <span>why</span> <span>visitors</span> <span className="lpa-violet">leave.</span>
                </h2>
                <p>Landing Page Audit</p>
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
                <div className="lpa-intro-score-number">{introScore}</div>
                <div className="lpa-intro-score-grade">{audit?.overall?.grade || 'B'}</div>
              </div>
            )}
          </div>
        </div>
      )}

      <section className="lpa-input-card">
        <p className="lpa-eyebrow">Conversion Intelligence</p>
        <h2>Landing Page Audit</h2>
        <p className="lpa-subtitle">Claude-powered landing page scoring with roast-my-landing-page rubric fidelity.</p>

        <form className="lpa-form" onSubmit={runAudit}>
          <label>
            <span>URL</span>
            <div className="lpa-input-wrap">
              <Globe size={16} />
              <input
                type="text"
                placeholder="e.g. www.shawq.co or https://shawq.co"
                value={form.url}
                onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                required
              />
            </div>
          </label>

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

          <button className="lpa-run-btn" type="submit" disabled={isRunning}>
            {isRunning ? <Loader2 size={16} className="lpa-spin" /> : <ArrowRight size={16} />}
            {isRunning ? 'Running audit...' : 'Run Audit'}
          </button>
        </form>

        {error && <p className="lpa-error">{error}</p>}
        {notice && <p className="lpa-notice">{notice}</p>}
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
                {(audit.dimensions || []).map((dimension, index) => (
                  <div key={dimension.name} className="lpa-metric-row" style={{ transitionDelay: `${index * BAR_ANIMATION_STAGGER_MS}ms` }}>
                    <div className="lpa-metric-head">
                      <span>{DIMENSION_ICON[dimension.name] || '📊'}</span>
                      <span>{dimension.name}</span>
                      <strong>{Math.round(dimension.score)}</strong>
                    </div>
                    <div className="lpa-metric-track">
                      <div className="lpa-metric-fill" style={{ width: `${Math.max(0, Math.min(100, dimension.score))}%` }} />
                    </div>
                  </div>
                ))}
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
