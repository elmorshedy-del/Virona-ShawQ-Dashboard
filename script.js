/* ══════════════════════════════════════════
   PERIHELION — SCRIPT
   Intro: Phase 1 (Scanner) → Phase 2 (Score Reveal) → Dashboard
══════════════════════════════════════════ */

/* ─── Utilities ─── */
function qs(id) { return document.getElementById(id); }

function animateCounter(el, from, to, duration, onDone) {
  const start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else if (onDone) onDone();
  }
  requestAnimationFrame(step);
}

/* ─── Tab switching ─── */
function setTab(el, id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  qs(id).classList.add('active');
}

/* ─── Dashboard: metric bars + ring ─── */
function animateBars() {
  document.querySelectorAll('.metric-bar').forEach((bar, i) => {
    const val = parseInt(bar.dataset.val, 10);
    const valEl = qs('val-' + i);
    setTimeout(() => {
      bar.style.width = val + '%';
      if (valEl) animateCounter(valEl, 0, val, 900);
    }, i * 120);
  });
}

function animateRing(score) {
  const C = 2 * Math.PI * 58;
  const ringEl = qs('ring-fill');
  const scoreEl = qs('score-number');
  if (!ringEl || !scoreEl) return;
  animateCounter(scoreEl, 0, score, 1400);
  setTimeout(() => {
    ringEl.style.strokeDashoffset = C * (1 - score / 100);
  }, 200);
}

function showDashboard() {
  const section = qs('results-section');
  section.classList.add('visible');
  setTimeout(() => animateRing(72), 300);
  setTimeout(() => animateBars(), 500);
}

/* ─── Run Audit button ─── */
function runAudit() {
  const btn = qs('run-btn');
  const textEl = btn.querySelector('.run-btn-text');
  const iconEl = btn.querySelector('.run-btn-icon');
  textEl.textContent = 'Analysing…';
  iconEl.style.display = 'none';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  btn.appendChild(spinner);
  btn.disabled = true;

  setTimeout(() => {
    spinner.remove();
    iconEl.style.display = '';
    textEl.textContent = 'Run Audit';
    btn.disabled = false;
    const section = qs('results-section');
    section.classList.remove('visible');
    document.querySelectorAll('.metric-bar').forEach(b => b.style.width = '0');
    const rf = qs('ring-fill');
    if (rf) rf.style.strokeDashoffset = 2 * Math.PI * 58;
    const sn = qs('score-number');
    if (sn) sn.textContent = '0';
    setTimeout(() => showDashboard(), 80);
  }, 1800);
}

/* ══════════════════════════════════════════
   INTRO SEQUENCE
══════════════════════════════════════════ */
function runIntro() {
  const intro    = qs('intro');
  const phase1   = qs('intro-phase-1');
  const phase2   = qs('intro-phase-2');
  const browser  = qs('intro-browser');
  const scanLine = qs('scan-line');
  const srScore  = qs('sr-score');
  const headline = qs('intro-headline');
  const markers  = [qs('diag-1'), qs('diag-2'), qs('diag-3'), qs('diag-4'), qs('diag-5')];

  // Init ring dasharray
  const C = 2 * Math.PI * 58;
  const rf = qs('ring-fill');
  if (rf) { rf.style.strokeDasharray = C; rf.style.strokeDashoffset = C; }

  /* ─────────────────────────────────────
     HEADLINE: words bounce in at t=300ms
     holds for ~1.8s, then exits upward
  ───────────────────────────────────── */
  setTimeout(() => headline.classList.add('active'), 300);

  // Headline exits at t=2500ms
  setTimeout(() => {
    headline.classList.add('exit');
  }, 2500);

  /* ─────────────────────────────────────
     PHASE 1: Scanner
     (all times offset by +2700ms vs before)
  ───────────────────────────────────── */
  setTimeout(() => phase1.classList.add('active'), 2700);

  // Browser slides in
  setTimeout(() => browser.classList.add('visible'), 3200);

  // Scan line sweeps (3.8s in CSS)
  setTimeout(() => {
    const fp  = document.querySelector('.fake-page');
    const fpH = fp ? fp.offsetHeight : 300;
    scanLine.style.top = '0px';
    scanLine.classList.add('scanning');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { scanLine.style.top = fpH + 'px'; });
    });
  }, 3900);

  // Diagnostic markers stagger in as scan passes
  const markerDelays = [4400, 5100, 4200, 5700, 6400];
  markers.forEach((m, i) => {
    if (!m) return;
    setTimeout(() => m.classList.add('visible'), markerDelays[i]);
  });

  // Label flips to "Analysis complete"
  setTimeout(() => {
    const lbl = qs('intro-scanning-label');
    if (lbl) lbl.textContent = 'Analysis complete';
  }, 6900);

  /* ─────────────────────────────────────
     TRANSITION: Phase 1 → Phase 2
  ───────────────────────────────────── */
  setTimeout(() => {
    browser.classList.add('collapse');
    setTimeout(() => phase1.classList.remove('active'), 400);

    // Phase 2 active
    setTimeout(() => {
      phase2.classList.add('active');

      const srCategory = qs('sr-category');
      const cats = ['First Impression', 'Copy & Messaging', 'Call-to-Action', 'Trust & Proof', 'Mobile & Access', 'Performance'];
      let catIndex = 0;
      let catInterval;

      if (srCategory) {
        catInterval = setInterval(() => {
          srCategory.textContent = 'Analysing: ' + cats[catIndex % cats.length];
          catIndex++;
        }, 150);
      }

      // Score: 0 → 100 (overshoot) → 72 (settle)
      if (srScore) {
        animateCounter(srScore, 0, 100, 1200, () => {
          setTimeout(() => {
            animateCounter(srScore, 100, 72, 900, () => {
              if (catInterval) clearInterval(catInterval);
              if (srCategory) srCategory.textContent = 'Opportunities Detected';
            });
          }, 600);
        });
      }
    }, 600);
  }, 7900);

  /* ─────────────────────────────────────
     PHASE 2 exit → dashboard reveal
  ───────────────────────────────────── */
  setTimeout(() => {
    intro.classList.add('hidden');
    setTimeout(() => {
      intro.style.display = 'none';
      showDashboard();
    }, 700);
  }, 11500);
}

/* ─── Boot ─── */
window.addEventListener('DOMContentLoaded', runIntro);
