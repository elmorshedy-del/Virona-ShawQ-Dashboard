import { useEffect, useMemo, useState } from 'react';
import './ConversionUIFixLabTab.css';

const CHAPTERS = {
  home: {
    id: 'home',
    title: 'Home page',
    subtitle: 'Hero banner + featured collection strip',
    sectionLabel: 'Section: hero banner',
    finding:
      'The button text "Shop Now" uses #0F8A67 on white, but surrounding links have similar visual weight. Increase CTA fill emphasis and spacing from secondary links to clarify the first action.',
    hotspots: [
      { top: '29%', left: '22%', text: '#0F8A67 CTA has low dominance in first fold' },
      { top: '58%', left: '49%', text: '"Shop Now" competes with nearby secondary links' }
    ]
  },
  product: {
    id: 'product',
    title: 'Product page: Premium Kuffiyah',
    subtitle: 'Buy box + shipping confidence block',
    sectionLabel: 'Section: buy box',
    finding:
      'Price, variant controls, and add-to-cart are compressed into one dense zone. Add vertical rhythm and stronger CTA anchoring so intent flow is price -> confidence -> submit.',
    hotspots: [
      { top: '36%', left: '37%', text: 'Price + variant + CTA stack has compressed spacing' },
      { top: '68%', left: '72%', text: '#0F8A67 guarantee line blends into metadata' }
    ]
  },
  cart: {
    id: 'cart',
    title: 'Cart page',
    subtitle: 'Checkout summary + payment trust row',
    sectionLabel: 'Section: checkout summary',
    finding:
      'Checkout CTA emphasis is too close to update controls. Tighten hierarchy and position trust row closer to checkout to reduce hesitation before submit.',
    hotspots: [
      { top: '38%', left: '64%', text: 'Checkout CTA competes with lower-priority controls' },
      { top: '74%', left: '34%', text: 'Trust row sits too far from primary submit action' }
    ]
  }
};

const INITIAL_FIXES = [
  {
    id: 'fx-01',
    type: 'CRO',
    title: 'Home page: Hero CTA hierarchy',
    description:
      'Increase primary CTA visual weight and spacing from secondary links to reduce first-fold choice friction.',
    impact: 'High',
    effort: 'Low',
    confidence: 0.89,
    state: 'open'
  },
  {
    id: 'fx-02',
    type: 'UI',
    title: 'Product page: Buy box spacing rhythm',
    description:
      'Add breathing room before price cluster and guarantee strip to reduce crowding near add-to-cart.',
    impact: 'Medium-High',
    effort: 'Low',
    confidence: 0.83,
    state: 'open'
  },
  {
    id: 'fx-03',
    type: 'CRO + UI',
    title: 'Cart page: Checkout submit emphasis',
    description:
      'Increase checkout button prominence and simplify summary copy so users commit to checkout faster.',
    impact: 'High',
    effort: 'Medium',
    confidence: 0.92,
    state: 'open'
  }
];

const STATE_LABEL = {
  open: 'Open',
  approved: 'Approved',
  edited: 'Edited',
  rejected: 'Rejected'
};

const QA_GATES = [
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

export default function ConversionUIFixLabTab() {
  const [activeChapter, setActiveChapter] = useState('home');
  const [fixes, setFixes] = useState(INITIAL_FIXES);

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

  const chapter = CHAPTERS[activeChapter] || CHAPTERS.home;

  const approvedCount = useMemo(
    () => fixes.filter((item) => item.state === 'approved').length,
    [fixes]
  );

  const openCount = useMemo(
    () => fixes.filter((item) => item.state === 'open').length,
    [fixes]
  );

  const approvalPercent = useMemo(() => {
    if (!fixes.length) return 0;
    return Math.round((approvedCount / fixes.length) * 100);
  }, [approvedCount, fixes.length]);

  const handleFixState = (id, state) => {
    setFixes((prev) => prev.map((fix) => (fix.id === id ? { ...fix, state } : fix)));
  };

  const approvedFixes = fixes.filter((item) => item.state === 'approved');

  return (
    <div className="cufl-root">
      <div className="cufl-orb cufl-orb--a" aria-hidden="true" />
      <div className="cufl-orb cufl-orb--b" aria-hidden="true" />

      <div className="cufl-shell">
        <section className="cufl-card cufl-reveal">
          <p className="cufl-subtle" style={{ marginTop: 0, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, fontSize: '0.72rem' }}>
            Business-grade audit and execution
          </p>
          <h2 className="cufl-hero-title">Turn CRO/UI findings into approved, safe Shopify theme edits.</h2>
          <p className="cufl-subtle">
            Exact evidence, narrative guidance, and controlled execution in one workflow: Audit, Approve, Apply, QA, Publish.
          </p>

          <div className="cufl-kpi-grid">
            <article className="cufl-kpi">
              <p className="cufl-kpi-label">Pages Crawled</p>
              <p className="cufl-kpi-value">8</p>
            </article>
            <article className="cufl-kpi">
              <p className="cufl-kpi-label">Open Fixes</p>
              <p className="cufl-kpi-value">{openCount}</p>
            </article>
            <article className="cufl-kpi">
              <p className="cufl-kpi-label">Approved</p>
              <p className="cufl-kpi-value">{approvedCount}</p>
            </article>
            <article className="cufl-kpi">
              <p className="cufl-kpi-label">Est. Impact</p>
              <p className="cufl-kpi-value">+7.4% CVR</p>
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
                {Object.values(CHAPTERS).map((item) => (
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
                <span className="cufl-shot-label">Screenshot region</span>
                {chapter.hotspots.map((spot) => (
                  <div
                    key={`${chapter.id}-${spot.top}-${spot.left}`}
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
            {fixes.map((fix) => (
              <article className="cufl-fix" key={fix.id} data-state={fix.state}>
                <header className="cufl-fix-head">
                  <p className="cufl-fix-type">{fix.type}</p>
                  <span className="cufl-pill">{STATE_LABEL[fix.state] || 'Open'}</span>
                </header>

                <h3>{fix.title}</h3>
                <p>{fix.description}</p>

                <div className="cufl-meta">
                  <span>Impact: {fix.impact}</span>
                  <span>Effort: {fix.effort}</span>
                  <span>Confidence: {fix.confidence.toFixed(2)}</span>
                </div>

                <div className="cufl-actions">
                  <button type="button" className="cufl-btn cufl-btn--approve" onClick={() => handleFixState(fix.id, 'approved')}>
                    Approve
                  </button>
                  <button type="button" className="cufl-btn" onClick={() => handleFixState(fix.id, 'edited')}>
                    Edit
                  </button>
                  <button type="button" className="cufl-btn cufl-btn--reject" onClick={() => handleFixState(fix.id, 'rejected')}>
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
            {approvedFixes.length === 0 ? (
              <p className="cufl-plan-empty">
                No approved fixes yet. Approve at least one item to build a safe duplicate-theme apply plan.
              </p>
            ) : (
              <ol className="cufl-plan-list">
                {approvedFixes.map((fix) => (
                  <li key={`plan-${fix.id}`}>
                    <strong>{fix.title}</strong>
                    <span>Duplicate theme patch + conversion QA gate</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section className="cufl-card cufl-reveal">
          <h2>Conversion QA Gates</h2>
          <p className="cufl-subtle">Blocking checks before publish.</p>
          <div className="cufl-qa-grid">
            {QA_GATES.map((gate) => (
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
