import { useEffect, useMemo, useState } from 'react';
import './ConversionUIFixLabTab.css';

const API_BASE = '/api/conversion-ui-fix-lab';
const SESSION_STORAGE_KEY = 'conversion_ui_fix_lab_session_id';

const STATE_LABEL = {
  open: 'Open',
  approved: 'Approved',
  edited: 'Edited',
  rejected: 'Rejected'
};

const FALLBACK_QA_GATES = [
  {
    title: 'Submit Control Validation',
    body: 'Primary conversion forms must expose explicit submit controls with click and Enter-key parity.'
  },
  {
    title: 'Funnel Smoke Test',
    body: 'Product -> Add to Cart -> Cart Update -> Checkout handoff must complete without errors.'
  },
  {
    title: 'Mobile Breakpoint Audit',
    body: 'Validate CTA visibility and thumb reach at 390px, 768px, and 1024px.'
  },
  {
    title: 'Performance Guardrail',
    body: 'No major LCP/CLS regressions and no blocking script growth on edited templates.'
  }
];

const MOCK_SESSION = {
  sessionId: null,
  rootUrl: 'https://shawq.co',
  summary: {
    pagesCrawled: 0,
    openFixes: 0,
    approvedFixes: 0,
    estimatedCvrLiftPct: 0
  },
  narrative: {
    executiveSummary: 'Run a live audit to generate narrative page-by-page CRO/UI findings with exact references.'
  },
  chapters: [
    {
      id: 'placeholder',
      title: 'No crawl yet',
      subtitle: 'Enter a URL and run the audit',
      sectionLabel: 'Awaiting crawl',
      finding: 'Once the crawl is complete, this area will show screenshot-backed narrative findings.',
      screenshotUrl: null,
      hotspots: [{ top: '42%', left: '36%', text: 'Awaiting crawl data.' }]
    }
  ],
  fixes: [],
  applyPlan: [],
  qaGates: FALLBACK_QA_GATES
};

function formatLift(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 'n/a';
  return `+${num.toFixed(1)}% CVR`;
}

function stateLabel(value) {
  return STATE_LABEL[String(value || '').toLowerCase()] || 'Open';
}

export default function ConversionUIFixLabTab() {
  const [targetUrl, setTargetUrl] = useState('https://shawq.co');
  const [session, setSession] = useState(MOCK_SESSION);
  const [activeChapter, setActiveChapter] = useState('placeholder');
  const [isRunning, setIsRunning] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll('.cufl-reveal'));
    if (!nodes.length) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
          }
        });
      },
      { threshold: 0.12 }
    );

    nodes.forEach((node, index) => {
      node.style.transitionDelay = `${Math.min(index * 55, 330)}ms`;
      observer.observe(node);
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedSessionId) return;

    let ignore = false;

    const loadSession = async () => {
      try {
        const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(storedSessionId)}`);
        const payload = await response.json();
        if (!response.ok || !payload?.success || !payload?.session) {
          localStorage.removeItem(SESSION_STORAGE_KEY);
          return;
        }

        if (!ignore) {
          setSession(payload.session);
          setTargetUrl(payload.session.rootUrl || 'https://shawq.co');
        }
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    };

    loadSession();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const firstId = session?.chapters?.[0]?.id;
    if (!session?.chapters?.length) {
      setActiveChapter('placeholder');
      return;
    }

    const chapterExists = session.chapters.some((chapter) => chapter.id === activeChapter);
    if (!chapterExists && firstId) {
      setActiveChapter(firstId);
    }
  }, [session, activeChapter]);

  const chapters = session?.chapters?.length ? session.chapters : MOCK_SESSION.chapters;
  const chapter = chapters.find((item) => item.id === activeChapter) || chapters[0];

  const fixes = Array.isArray(session?.fixes) ? session.fixes : [];
  const approvedCount = fixes.filter((item) => item.state === 'approved').length;
  const openCount = fixes.filter((item) => item.state === 'open').length;
  const approvalPercent = fixes.length ? Math.round((approvedCount / fixes.length) * 100) : 0;

  const qaGates = session?.qaGates?.length ? session.qaGates : FALLBACK_QA_GATES;

  const applyPlan = useMemo(() => (
    Array.isArray(session?.applyPlan) ? session.applyPlan : []
  ), [session]);

  const runAudit = async (event) => {
    event.preventDefault();
    const url = String(targetUrl || '').trim();
    if (!url) {
      setError('Enter a website URL before running the audit.');
      return;
    }

    setError('');
    setIsRunning(true);

    try {
      const response = await fetch(`${API_BASE}/audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: 'shawq',
          url,
          maxPages: 6,
          maxDepth: 2
        })
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success || !payload?.session) {
        throw new Error(payload?.error || 'Failed to run the audit.');
      }

      setSession(payload.session);
      setActiveChapter(payload.session?.chapters?.[0]?.id || 'placeholder');
      if (payload.session?.sessionId) {
        localStorage.setItem(SESSION_STORAGE_KEY, payload.session.sessionId);
      }
    } catch (runError) {
      setError(runError.message || 'Failed to run Conversion/UI Fix Lab audit.');
    } finally {
      setIsRunning(false);
    }
  };

  const updateFixState = async (fixId, state) => {
    if (!fixId || !state) return;

    const sessionId = session?.sessionId;

    if (!sessionId) {
      setSession((prev) => ({
        ...prev,
        fixes: (prev.fixes || []).map((fix) => (fix.id === fixId ? { ...fix, state } : fix))
      }));
      return;
    }

    setError('');
    setIsUpdating(true);

    try {
      const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: [{ fixId, state }]
        })
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success || !payload?.session) {
        throw new Error(payload?.error || 'Failed to update fix status.');
      }

      setSession(payload.session);
    } catch (updateError) {
      setError(updateError.message || 'Failed to update approval status.');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="cufl-root">
      <div className="cufl-orb cufl-orb--a" aria-hidden="true" />
      <div className="cufl-orb cufl-orb--b" aria-hidden="true" />

      <div className="cufl-shell">
        <section className="cufl-card cufl-reveal">
          <p
            className="cufl-subtle"
            style={{ marginTop: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, fontSize: '0.72rem' }}
          >
            Business-grade audit and execution
          </p>
          <h2 className="cufl-hero-title">Turn CRO/UI findings into approved, safe Shopify theme edits.</h2>
          <p className="cufl-subtle">
            Exact evidence, narrative guidance, and controlled execution in one workflow: Audit, Approve, Apply, QA, Publish.
          </p>

          <form className="cufl-run-form" onSubmit={runAudit}>
            <input
              type="text"
              className="cufl-input"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://your-store.com"
              aria-label="Website URL"
            />
            <button type="submit" className="cufl-run-btn" disabled={isRunning}>
              {isRunning ? 'Running crawl...' : 'Run Live Audit'}
            </button>
          </form>

          {session?.sessionId ? (
            <p className="cufl-session-note">Session: {session.sessionId}</p>
          ) : null}

          {error ? <p className="cufl-error">{error}</p> : null}

          <div className="cufl-kpi-grid">
            <article className="cufl-kpi">
              <p className="cufl-kpi-label">Pages Crawled</p>
              <p className="cufl-kpi-value">{session?.summary?.pagesCrawled || 0}</p>
            </article>
            <article className="cufl-kpi">
              <p className="cufl-kpi-label">Open Fixes</p>
              <p className="cufl-kpi-value">{session?.summary?.openFixes ?? openCount}</p>
            </article>
            <article className="cufl-kpi">
              <p className="cufl-kpi-label">Approved</p>
              <p className="cufl-kpi-value">{session?.summary?.approvedFixes ?? approvedCount}</p>
            </article>
            <article className="cufl-kpi">
              <p className="cufl-kpi-label">Est. Impact</p>
              <p className="cufl-kpi-value">{formatLift(session?.summary?.estimatedCvrLiftPct)}</p>
            </article>
          </div>
        </section>

        <section className="cufl-card cufl-reveal">
          <h2>Workflow</h2>
          <p className="cufl-subtle">Audit, Narrative, Approve, Apply, QA, Publish or Rollback.</p>
          <ol className="cufl-workflow">
            <li><span className="cufl-step">01</span>Crawl funnel pages and capture screenshot evidence.</li>
            <li><span className="cufl-step">02</span>Generate narrative findings with exact page and section citations.</li>
            <li><span className="cufl-step">03</span>Approve only the fixes that match business priorities.</li>
            <li><span className="cufl-step">04</span>Apply on duplicate theme, run QA gates, then publish safely.</li>
          </ol>
        </section>

        <section className="cufl-card cufl-reveal">
          <h2>Narrative Audit Walkthrough</h2>
          <p className="cufl-subtle">Top-to-bottom, human-readable guidance with exact issue callouts and color references.</p>

          <div className="cufl-split">
            <div>
              <div className="cufl-chapters" role="tablist" aria-label="Audit chapters">
                {chapters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={activeChapter === item.id}
                    className={`cufl-chapter ${activeChapter === item.id ? 'is-active' : ''}`}
                    onClick={() => setActiveChapter(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.subtitle}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="cufl-canvas">
              <div className="cufl-canvas-head">
                <p className="cufl-canvas-title">{chapter.title}</p>
                <p className="cufl-canvas-sub">{chapter.sectionLabel}</p>
              </div>

              <div className="cufl-shot">
                {chapter.screenshotUrl ? (
                  <img src={chapter.screenshotUrl} alt={`${chapter.title} screenshot`} className="cufl-shot-image" loading="lazy" />
                ) : null}
                <span className="cufl-shot-label">Screenshot region</span>
                {(chapter.hotspots || []).map((spot) => (
                  <div
                    key={`${chapter.id}-${spot.top}-${spot.left}-${spot.text}`}
                    className="cufl-hotspot"
                    style={{ top: spot.top, left: spot.left }}
                  >
                    <span>{spot.text}</span>
                  </div>
                ))}
              </div>

              <div className="cufl-finding">
                <p>
                  <strong>Problem and solution</strong>
                  {chapter.finding}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="cufl-card cufl-reveal">
          <div className="cufl-queue-head">
            <div>
              <h2>Approval Queue</h2>
              <p className="cufl-subtle">Only approved items are included in the apply plan.</p>
            </div>
            <div className="cufl-meter" aria-label="Approval progress">
              <div className="cufl-meter-fill" style={{ width: `${approvalPercent}%` }} />
            </div>
          </div>

          <div className="cufl-fix-grid">
            {fixes.length === 0 ? (
              <article className="cufl-fix" data-state="open">
                <h3>No fixes yet</h3>
                <p>Run an audit to generate real, page-cited CRO/UI fixes.</p>
              </article>
            ) : fixes.map((fix) => (
              <article className="cufl-fix" key={fix.id} data-state={fix.state}>
                <header className="cufl-fix-head">
                  <p className="cufl-fix-type">{fix.type}</p>
                  <span className="cufl-pill">{stateLabel(fix.state)}</span>
                </header>

                <h3>{fix.title}</h3>
                <p>{fix.description}</p>
                <p className="cufl-fix-reference">
                  {fix.pageLabel} • {fix.section} • {fix.selector || 'selector n/a'}
                  {fix.colorHex ? ` • ${fix.colorHex}` : ''}
                </p>

                <div className="cufl-meta">
                  <span>Impact: {fix.impact}</span>
                  <span>Effort: {fix.effort}</span>
                  <span>Confidence: {Number(fix.confidence || 0).toFixed(2)}</span>
                </div>

                <div className="cufl-actions">
                  <button
                    type="button"
                    className="cufl-btn cufl-btn--approve"
                    onClick={() => updateFixState(fix.id, 'approved')}
                    disabled={isUpdating}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="cufl-btn"
                    onClick={() => updateFixState(fix.id, 'edited')}
                    disabled={isUpdating}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="cufl-btn cufl-btn--reject"
                    onClick={() => updateFixState(fix.id, 'rejected')}
                    disabled={isUpdating}
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="cufl-card cufl-reveal">
          <h2>Apply Plan</h2>
          <p className="cufl-subtle">Generated automatically from approved fixes.</p>

          <div className="cufl-plan">
            {applyPlan.length === 0 ? (
              <p className="cufl-plan-empty">
                No approved fixes yet. Approve at least one item to build a safe duplicate-theme apply plan.
              </p>
            ) : (
              <ol className="cufl-plan-list">
                {applyPlan.map((item) => (
                  <li key={`plan-${item.fixId}`}>
                    <strong>{item.title}</strong>
                    <span>{item.templateHint}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section className="cufl-card cufl-reveal">
          <h2>Narrative Summary</h2>
          <p className="cufl-subtle">Business-readable summary from this crawl session.</p>
          <div className="cufl-finding" style={{ marginTop: '10px' }}>
            <p>{session?.narrative?.executiveSummary || MOCK_SESSION.narrative.executiveSummary}</p>
          </div>
        </section>

        <section className="cufl-card cufl-reveal">
          <h2>Conversion QA Gates</h2>
          <p className="cufl-subtle">Blocking checks before publish.</p>
          <div className="cufl-qa-grid">
            {qaGates.map((gate) => (
              <article className="cufl-qa-item" key={gate.title}>
                <h3>{gate.title}</h3>
                <p>{gate.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
