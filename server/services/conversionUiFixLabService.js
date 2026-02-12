import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

import { getDb } from '../db/database.js';

const TRUST_SIGNAL_KEYWORDS = [
  'review',
  'reviews',
  'testimonial',
  'trusted',
  'secure',
  'guarantee',
  'warranty',
  'free returns',
  'money back',
  'refund',
  'verified'
];

const MAX_FINDINGS_PER_PAGE = 6;
const VALID_FIX_STATES = new Set(['open', 'approved', 'edited', 'rejected']);
const DEFAULT_MAX_PAGES = 6;
const DEFAULT_MAX_DEPTH = 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('URL is required.');
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  parsed.hash = '';
  return parsed.toString();
}

function canonicalizeUrl(candidate, origin) {
  try {
    const parsed = new URL(candidate, origin);
    if (parsed.origin !== origin) return null;
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;

    const lowerPath = parsed.pathname.toLowerCase();
    if (/(\.jpg|\.jpeg|\.png|\.gif|\.webp|\.svg|\.pdf|\.zip|\.mp4|\.css|\.js|\.xml)$/i.test(lowerPath)) {
      return null;
    }

    parsed.hash = '';
    parsed.search = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function pageLabelFromUrl(targetUrl) {
  const parsed = new URL(targetUrl);
  const pathName = decodeURIComponent(parsed.pathname || '/');

  if (pathName === '/' || pathName === '') return 'Home page';
  if (pathName.startsWith('/cart')) return 'Cart page';
  if (pathName.startsWith('/checkout')) return 'Checkout page';

  if (pathName.startsWith('/products/')) {
    const slug = pathName.split('/products/')[1]?.split('/')[0] || '';
    return `Product page: ${humanizeSlug(slug)}`;
  }

  if (pathName.startsWith('/collections/')) {
    const slug = pathName.split('/collections/')[1]?.split('/')[0] || '';
    return `Collection page: ${humanizeSlug(slug)}`;
  }

  if (pathName.startsWith('/pages/')) {
    const slug = pathName.split('/pages/')[1]?.split('/')[0] || '';
    return `Content page: ${humanizeSlug(slug)}`;
  }

  return `Page: ${pathName}`;
}

function humanizeSlug(slug) {
  const words = String(slug || '')
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  return words.join(' ') || 'Untitled';
}

function pageTemplateHint(pageUrl) {
  const pathName = new URL(pageUrl).pathname || '/';
  if (pathName === '/' || pathName === '') return 'templates/index.json + sections/main-index.liquid';
  if (pathName.startsWith('/products/')) return 'templates/product.json + sections/main-product.liquid';
  if (pathName.startsWith('/collections/')) return 'templates/collection.json + sections/main-collection-product-grid.liquid';
  if (pathName.startsWith('/cart')) return 'templates/cart.json + sections/main-cart-items.liquid';
  return 'template file depends on route type';
}

function effortForRule(ruleId) {
  if (ruleId === 'submit_control_gap') return 'Medium';
  if (ruleId === 'cta_hierarchy') return 'Low';
  if (ruleId === 'cta_contrast') return 'Low';
  if (ruleId === 'h1_structure') return 'Low';
  if (ruleId === 'trust_signal_missing') return 'Low';
  if (ruleId === 'first_fold_density') return 'Medium';
  return 'Medium';
}

function impactForSeverity(severity) {
  if (severity === 'high') return 'High';
  if (severity === 'medium') return 'Medium-High';
  return 'Medium';
}

function findSectionLabel(pageLabel) {
  if (pageLabel.startsWith('Cart page')) return 'Checkout summary';
  if (pageLabel.startsWith('Product page')) return 'Buy box';
  if (pageLabel.startsWith('Collection page')) return 'Collection toolbar';
  if (pageLabel.startsWith('Home page')) return 'Hero banner';
  return 'Primary content section';
}

function estimateLift(findings) {
  const high = findings.filter((item) => item.severity === 'high').length;
  const medium = findings.filter((item) => item.severity === 'medium').length;
  const low = findings.filter((item) => item.severity === 'low').length;
  const raw = (high * 1.6) + (medium * 0.8) + (low * 0.3);
  return clamp(Number(raw.toFixed(1)), 0.8, 18);
}

function sessionBaseDir() {
  return path.join(process.cwd(), 'data', 'conversion-ui-fix-lab');
}

function getSessionDir(sessionId) {
  return path.join(sessionBaseDir(), sessionId);
}

function ensureSessionDir(sessionId) {
  const dir = getSessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function generateSessionId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `cufl_${Date.now()}_${rand}`;
}

function persistSession(session) {
  const db = getDb();

  db.prepare(`
    INSERT INTO conversion_ui_fix_lab_sessions (
      session_id, store, root_url, status, request_json, report_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      store = excluded.store,
      root_url = excluded.root_url,
      status = excluded.status,
      request_json = excluded.request_json,
      report_json = excluded.report_json,
      updated_at = datetime('now')
  `).run(
    session.sessionId,
    session.store,
    session.rootUrl,
    session.status || 'completed',
    JSON.stringify(session.request || {}),
    JSON.stringify(session.report || {})
  );
}

export function getConversionUiFixLabSession(sessionId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT session_id, store, root_url, status, request_json, report_json, created_at, updated_at
    FROM conversion_ui_fix_lab_sessions
    WHERE session_id = ?
  `).get(sessionId);

  if (!row) {
    return null;
  }

  const rawReport = row.report_json ? JSON.parse(row.report_json) : {};
  const hydratedReport = hydrateReportWithFixStateOverrides(row.session_id, rawReport);

  return {
    sessionId: row.session_id,
    store: row.store,
    rootUrl: row.root_url,
    status: row.status,
    request: row.request_json ? JSON.parse(row.request_json) : {},
    report: hydratedReport,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildScreenshotUrl(sessionId, fileName) {
  return `/api/conversion-ui-fix-lab/sessions/${encodeURIComponent(sessionId)}/screenshots/${encodeURIComponent(fileName)}`;
}

function buildNarrative(pages, findingsByPage) {
  if (!pages.length) {
    return 'No pages were crawled, so narrative guidance is unavailable for this run.';
  }

  const narrativeParts = pages.map((page) => {
    const pageFindings = findingsByPage.get(page.pageId) || [];
    if (!pageFindings.length) {
      return `${page.label}: this page is structurally stable and no high-confidence CRO/UI blockers were detected in the captured viewport.`;
    }

    const top = pageFindings[0];
    return `${page.label}: ${top.problem} The exact reference is ${top.referenceLabel}. Recommended adjustment: ${top.solution}`;
  });

  return narrativeParts.join(' ');
}

function pickFixType(ruleId) {
  if (ruleId === 'cta_contrast' || ruleId === 'h1_structure') return 'UI';
  if (ruleId === 'first_fold_density') return 'CRO + UI';
  return 'CRO';
}

function sortFindings(a, b) {
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const aOrder = severityOrder[a.severity] ?? 9;
  const bOrder = severityOrder[b.severity] ?? 9;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return (b.confidence || 0) - (a.confidence || 0);
}

function buildApplyPlanFromFixes(fixes) {
  return fixes
    .filter((fix) => fix.state === 'approved')
    .map((fix) => ({
      fixId: fix.id,
      title: fix.title,
      page: fix.pageLabel,
      section: fix.section,
      templateHint: fix.templateHint,
      qaGate: 'Duplicate theme patch + conversion QA gate'
    }));
}

function updateSummaryWithFixes(summary, fixes) {
  const openFixes = fixes.filter((item) => item.state === 'open').length;
  const approvedFixes = fixes.filter((item) => item.state === 'approved').length;
  return {
    ...summary,
    openFixes,
    approvedFixes
  };
}

function normalizeFixNote(note) {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 600);
}

function applyStoredFixStateOverrides(sessionId, fixes) {
  if (!Array.isArray(fixes) || fixes.length === 0) return [];

  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT fix_id, state, note
      FROM conversion_ui_fix_lab_fix_states
      WHERE session_id = ?
    `).all(sessionId);
  } catch (error) {
    console.warn('[Conversion/UI Fix Lab] Failed to load fix-state overrides:', error?.message || error);
    return fixes;
  }

  if (!rows.length) return fixes;

  const overrides = new Map(rows.map((row) => [row.fix_id, row]));
  return fixes.map((fix) => {
    const override = overrides.get(fix.id);
    if (!override) return fix;

    const next = { ...fix };
    const nextState = String(override.state || '').toLowerCase();
    if (VALID_FIX_STATES.has(nextState)) {
      next.state = nextState;
    }

    const note = normalizeFixNote(override.note);
    if (note) {
      next.note = note;
    } else if ('note' in next) {
      delete next.note;
    }

    return next;
  });
}

function hydrateReportWithFixStateOverrides(sessionId, report) {
  const baseReport = report && typeof report === 'object' ? report : {};
  const baseFixes = Array.isArray(baseReport.fixes) ? baseReport.fixes : [];
  const fixes = applyStoredFixStateOverrides(sessionId, baseFixes);

  return {
    ...baseReport,
    fixes,
    applyPlan: buildApplyPlanFromFixes(fixes),
    summary: updateSummaryWithFixes(baseReport.summary || {}, fixes)
  };
}

function toReferenceLabel({ selector, elementText, colorHex }) {
  const partA = selector ? `selector ${selector}` : 'selector n/a';
  const partB = elementText ? `text "${elementText}"` : 'text n/a';
  const partC = colorHex ? `color ${colorHex}` : 'color n/a';
  return `${partA}, ${partB}, ${partC}`;
}

function buildFindingsForPage(page) {
  const findings = [];
  const section = findSectionLabel(page.label);
  const aboveFoldCtas = page.ctas.filter((item) => item.aboveFold);
  const firstCta = aboveFoldCtas[0] || page.ctas[0] || null;

  if (aboveFoldCtas.length === 0) {
    findings.push({
      ruleId: 'cta_hierarchy',
      severity: 'high',
      confidence: 0.86,
      pageLabel: page.label,
      pageId: page.pageId,
      pageUrl: page.url,
      section,
      elementText: page.h1 || page.title || '[no heading detected]',
      selector: page.h1Selector || 'h1',
      colorHex: null,
      problem: 'No clear above-fold conversion CTA is visible in the first viewport.',
      solution: 'Introduce one primary CTA in the first viewport with clear visual priority and concise action text.',
      evidence: [`Above-fold CTA count is 0 on ${page.label}.`]
    });
  } else if (aboveFoldCtas.length > 2) {
    findings.push({
      ruleId: 'cta_hierarchy',
      severity: 'medium',
      confidence: 0.79,
      pageLabel: page.label,
      pageId: page.pageId,
      pageUrl: page.url,
      section,
      elementText: aboveFoldCtas.map((item) => item.text).filter(Boolean).slice(0, 3).join(' | ') || '[cta text unavailable]',
      selector: firstCta?.selector || 'button, a',
      colorHex: firstCta?.backgroundHex || firstCta?.colorHex || null,
      problem: 'Multiple above-fold CTAs are competing for attention, which increases choice friction.',
      solution: 'Keep one primary action and visually demote secondary links until after the first decision point.',
      evidence: [`Above-fold CTA count is ${aboveFoldCtas.length}.`]
    });
  }

  const missingSubmitForms = page.forms.filter((form) => form.actionable && !form.hasSubmit);
  if (missingSubmitForms.length > 0) {
    const form = missingSubmitForms[0];
    findings.push({
      ruleId: 'submit_control_gap',
      severity: 'high',
      confidence: 0.93,
      pageLabel: page.label,
      pageId: page.pageId,
      pageUrl: page.url,
      section,
      elementText: form.signature,
      selector: form.selector,
      colorHex: null,
      problem: 'Actionable form detected without a confirmed submit control.',
      solution: 'Add an explicit submit button (`button[type="submit"]` or `input[type="submit"]`) and verify click + Enter-key behavior.',
      evidence: [
        `${form.signature} has no submit control evidence.`,
        `Method ${form.method.toUpperCase()}, input count ${form.inputCount}.`
      ]
    });
  }

  if ((page.trustSignalHits || 0) === 0) {
    findings.push({
      ruleId: 'trust_signal_missing',
      severity: 'medium',
      confidence: 0.78,
      pageLabel: page.label,
      pageId: page.pageId,
      pageUrl: page.url,
      section,
      elementText: firstCta?.text || page.h1 || page.title || '[text unavailable]',
      selector: firstCta?.selector || page.h1Selector || 'main',
      colorHex: firstCta?.backgroundHex || firstCta?.colorHex || null,
      problem: 'Trust reassurance is not visible near the primary decision area.',
      solution: 'Add concise trust proof near the conversion action (returns, shipping promise, secure checkout, social proof).',
      evidence: ['No trust-signal keyword matched visible text on this page.']
    });
  }

  if ((page.h1Count || 0) !== 1) {
    findings.push({
      ruleId: 'h1_structure',
      severity: 'medium',
      confidence: 0.82,
      pageLabel: page.label,
      pageId: page.pageId,
      pageUrl: page.url,
      section,
      elementText: page.h1 || '[missing h1]',
      selector: page.h1Selector || 'h1',
      colorHex: null,
      problem: `Heading structure issue detected: expected one H1 but found ${page.h1Count || 0}.`,
      solution: 'Use exactly one H1 aligned to page intent, then descend with H2/H3 for supporting sections.',
      evidence: [`H1 count = ${page.h1Count || 0}.`]
    });
  }

  if (firstCta && typeof firstCta.contrastRatio === 'number' && firstCta.contrastRatio > 0 && firstCta.contrastRatio < 3) {
    findings.push({
      ruleId: 'cta_contrast',
      severity: 'medium',
      confidence: 0.75,
      pageLabel: page.label,
      pageId: page.pageId,
      pageUrl: page.url,
      section,
      elementText: firstCta.text || '[cta text unavailable]',
      selector: firstCta.selector,
      colorHex: firstCta.colorHex || firstCta.backgroundHex || null,
      problem: 'Primary CTA visual contrast is low against its background, reducing action prominence.',
      solution: 'Increase contrast and fill weight for the primary CTA so it visually anchors the first action.',
      evidence: [
        `Computed contrast ratio is ${firstCta.contrastRatio.toFixed(2)}.`,
        `Foreground ${firstCta.colorHex || 'n/a'}, background ${firstCta.backgroundHex || 'n/a'}.`
      ]
    });
  }

  if ((page.firstViewportWordCount || 0) > 220) {
    findings.push({
      ruleId: 'first_fold_density',
      severity: 'low',
      confidence: 0.68,
      pageLabel: page.label,
      pageId: page.pageId,
      pageUrl: page.url,
      section,
      elementText: page.h1 || page.title || '[text unavailable]',
      selector: page.h1Selector || 'main',
      colorHex: null,
      problem: 'First viewport copy density is high and may dilute clarity of the next action.',
      solution: 'Reduce first-fold copy and keep the core value proposition plus one supporting proof line before CTA.',
      evidence: [`First viewport word count is ${page.firstViewportWordCount}.`]
    });
  }

  return findings
    .map((item, index) => {
      const referenceLabel = toReferenceLabel({
        selector: item.selector,
        elementText: item.elementText,
        colorHex: item.colorHex
      });
      return {
        ...item,
        id: `${item.pageId}-${item.ruleId}-${index + 1}`,
        referenceLabel
      };
    })
    .sort(sortFindings)
    .slice(0, MAX_FINDINGS_PER_PAGE);
}

function makeChapterFromPage(page, pageFindings) {
  const strongest = pageFindings[0] || null;
  const fallbackSection = findSectionLabel(page.label);

  const hotspots = (pageFindings.length ? pageFindings : [])
    .slice(0, 2)
    .map((finding, index) => ({
      top: `${30 + (index * 28)}%`,
      left: `${22 + (index * 28)}%`,
      text: finding.referenceLabel
    }));

  if (!hotspots.length) {
    hotspots.push({
      top: '42%',
      left: '34%',
      text: 'No critical hotspots detected in this viewport.'
    });
  }

  return {
    id: page.pageId,
    title: page.label,
    subtitle: strongest?.problem || 'No critical blockers detected.',
    sectionLabel: strongest?.section || fallbackSection,
    finding: strongest
      ? `${strongest.problem} ${strongest.solution}`
      : 'Page structure appears stable with no high-confidence conversion blockers in this run.',
    screenshotUrl: page.screenshotUrl,
    hotspots
  };
}

function summarizePage(page, findings) {
  return {
    pageId: page.pageId,
    url: page.url,
    label: page.label,
    title: page.title,
    h1: page.h1,
    screenshotUrl: page.screenshotUrl,
    metrics: {
      ctaCount: page.ctas.length,
      aboveFoldCtaCount: page.ctas.filter((item) => item.aboveFold).length,
      actionableFormCount: page.forms.filter((item) => item.actionable).length,
      formsMissingSubmit: page.forms.filter((item) => item.actionable && !item.hasSubmit).length,
      trustSignalHits: page.trustSignalHits,
      h1Count: page.h1Count,
      firstViewportWordCount: page.firstViewportWordCount
    },
    findings
  };
}

function buildFixesFromFindings(findings) {
  const ordered = [...findings].sort(sortFindings).slice(0, 12);
  return ordered.map((finding, index) => ({
    id: `fix-${String(index + 1).padStart(3, '0')}`,
    findingId: finding.id,
    type: pickFixType(finding.ruleId),
    title: `${finding.pageLabel}: ${finding.problem}`,
    description: finding.solution,
    impact: impactForSeverity(finding.severity),
    effort: effortForRule(finding.ruleId),
    confidence: Number((finding.confidence || 0.7).toFixed(2)),
    state: 'open',
    pageLabel: finding.pageLabel,
    pageUrl: finding.pageUrl,
    section: finding.section,
    selector: finding.selector,
    elementText: finding.elementText,
    colorHex: finding.colorHex,
    evidence: finding.evidence,
    problem: finding.problem,
    solution: finding.solution,
    templateHint: pageTemplateHint(finding.pageUrl),
    referenceLabel: finding.referenceLabel
  }));
}

function buildQaGates() {
  return [
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
}

async function crawlSinglePage({
  browser,
  targetUrl,
  origin,
  sessionId,
  sessionDir,
  index
}) {
  const page = await browser.newPage();
  let result = null;

  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const type = request.resourceType();
      if (type === 'media' || type === 'font') {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    await page.waitForNetworkIdle({ idleTime: 550, timeout: 5000 }).catch(() => null);

    const parsed = new URL(targetUrl);
    const suffix = parsed.pathname === '/' ? 'home' : slugify(parsed.pathname.replace(/^\/+/, '')) || `page-${index + 1}`;
    const fileName = `${String(index + 1).padStart(2, '0')}-${suffix}.png`;
    const filePath = path.join(sessionDir, fileName);

    await page.screenshot({ path: filePath, fullPage: true });

    const data = await page.evaluate(({ originUrl, trustSignals }) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const lower = (value) => normalize(value).toLowerCase();
      const clampValue = (value, min, max) => Math.min(max, Math.max(min, value));

      const cssEscapeSafe = (value) => {
        if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      };

      const parseHex = (value) => {
        const text = String(value || '').trim();
        if (!text) return null;
        if (text.startsWith('#')) {
          if (text.length === 4) {
            return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toUpperCase();
          }
          if (text.length >= 7) {
            return text.slice(0, 7).toUpperCase();
          }
        }
        return null;
      };

      const rgbToHex = (colorText) => {
        const direct = parseHex(colorText);
        if (direct) return direct;

        const match = String(colorText || '').match(/rgba?\(([^)]+)\)/i);
        if (!match) return null;
        const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim())).slice(0, 3);
        if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
        const toHex = (num) => clampValue(Math.round(num), 0, 255).toString(16).padStart(2, '0');
        return `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`.toUpperCase();
      };

      const parseRgb = (hex) => {
        if (!hex || !/^#[0-9A-F]{6}$/i.test(hex)) return null;
        return {
          r: Number.parseInt(hex.slice(1, 3), 16),
          g: Number.parseInt(hex.slice(3, 5), 16),
          b: Number.parseInt(hex.slice(5, 7), 16)
        };
      };

      const luminanceChannel = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? (c / 12.92) : (((c + 0.055) / 1.055) ** 2.4);
      };

      const contrastRatio = (aHex, bHex) => {
        const a = parseRgb(aHex);
        const b = parseRgb(bHex);
        if (!a || !b) return null;

        const lumA = (0.2126 * luminanceChannel(a.r)) + (0.7152 * luminanceChannel(a.g)) + (0.0722 * luminanceChannel(a.b));
        const lumB = (0.2126 * luminanceChannel(b.r)) + (0.7152 * luminanceChannel(b.g)) + (0.0722 * luminanceChannel(b.b));
        const lighter = Math.max(lumA, lumB);
        const darker = Math.min(lumA, lumB);
        return Number((((lighter + 0.05) / (darker + 0.05))).toFixed(2));
      };

      const visible = (element) => {
        if (!element) return false;
        const style = window.getComputedStyle(element);
        if (!style) return false;
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const elementText = (element) => normalize(element?.innerText || element?.textContent || '');

      const selectorFor = (element) => {
        if (!element || element.nodeType !== 1) return '';

        if (element.id) {
          return `#${cssEscapeSafe(element.id)}`;
        }

        const parts = [];
        let current = element;
        while (current && current.nodeType === 1 && current.tagName.toLowerCase() !== 'html' && parts.length < 4) {
          const tag = current.tagName.toLowerCase();
          const classNames = Array.from(current.classList || []).filter(Boolean).slice(0, 2);
          let part = tag;
          if (classNames.length) {
            part += `.${classNames.map(cssEscapeSafe).join('.')}`;
          }

          if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children).filter((node) => node.tagName === current.tagName);
            if (siblings.length > 1) {
              part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
          }

          parts.unshift(part);
          current = current.parentElement;
        }

        return parts.join(' > ');
      };

      const viewportHeight = window.innerHeight || 900;
      const viewportWidth = window.innerWidth || 1440;

      const headingNodes = Array.from(document.querySelectorAll('h1, h2, h3')).filter(visible);
      const h1Nodes = headingNodes.filter((node) => node.tagName.toLowerCase() === 'h1');

      const actionRegex = /(buy|shop|start|get|join|subscribe|add to cart|checkout|book|claim|order|contact|learn more|get started|view details)/i;
      const ctaNodes = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="submit"], input[type="button"], input[type="image"]'))
        .filter(visible)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const text = elementText(node).slice(0, 140);
          const style = window.getComputedStyle(node);
          const colorHex = rgbToHex(style?.color || '');
          const backgroundHex = rgbToHex(style?.backgroundColor || '');
          const centerX = rect.left + (rect.width / 2);
          const centerY = rect.top + (rect.height / 2);
          const aboveFold = rect.top >= 0 && rect.top < viewportHeight;

          return {
            text,
            selector: selectorFor(node),
            aboveFold,
            isLikelyCta: actionRegex.test(text || '') || node.tagName.toLowerCase() === 'button',
            colorHex,
            backgroundHex,
            contrastRatio: contrastRatio(colorHex, backgroundHex),
            centerXPct: Number(clampValue((centerX / viewportWidth) * 100, 2, 98).toFixed(1)),
            centerYPct: Number(clampValue((centerY / viewportHeight) * 100, 2, 98).toFixed(1))
          };
        })
        .filter((item) => item.text || item.isLikelyCta);

      const formNodes = Array.from(document.querySelectorAll('form')).map((form) => {
        const inputs = Array.from(form.querySelectorAll('input, select, textarea'));
        const inputTypes = inputs
          .map((input) => (input.getAttribute('type') || input.tagName || '').toLowerCase())
          .filter(Boolean);

        const method = lower(form.getAttribute('method') || 'get');
        const formId = lower(form.getAttribute('id') || '');
        const formClass = lower(form.getAttribute('class') || '');
        const role = lower(form.getAttribute('role') || '');
        const ariaLabel = lower(form.getAttribute('aria-label') || '');
        const action = form.getAttribute('action') || '(same page)';

        const searchHint = [formId, formClass, role, ariaLabel, lower(action)].some((value) => value.includes('search'));
        const onlySearchInputs = inputTypes.length > 0 && inputTypes.every((type) => type === 'search' || type === 'hidden');

        const hasSubmitInside = Boolean(
          form.querySelector('button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]')
        );

        let hasExternalSubmit = false;
        if (formId) {
          const escaped = cssEscapeSafe(formId);
          hasExternalSubmit = Boolean(document.querySelector(`button[form="${escaped}"][type="submit"], button[form="${escaped}"]:not([type]), input[form="${escaped}"][type="submit"], input[form="${escaped}"][type="image"]`));
        }

        const actionable = inputs.length > 0 && !(searchHint && (method === 'get' || onlySearchInputs)) && !onlySearchInputs;

        return {
          selector: selectorFor(form),
          method,
          action,
          inputCount: inputs.length,
          hasSubmit: hasSubmitInside || hasExternalSubmit,
          actionable,
          signature: `<form action="${action}" method="${method.toUpperCase()}">`
        };
      });

      const bodyText = normalize(document.body?.innerText || '').slice(0, 120000);
      const bodyLower = bodyText.toLowerCase();
      const trustSignalHits = trustSignals.reduce((count, keyword) => (
        bodyLower.includes(keyword) ? count + 1 : count
      ), 0);

      const visibleTextInViewport = Array.from(document.querySelectorAll('h1, h2, p, li, a, button, span'))
        .filter(visible)
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top >= 0 && rect.top < viewportHeight;
        })
        .map((node) => elementText(node))
        .join(' ')
        .trim();

      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((node) => node.href)
        .filter(Boolean);

      const firstH1 = h1Nodes[0] || null;

      return {
        title: normalize(document.title || ''),
        metaDescription: normalize(document.querySelector('meta[name="description"]')?.content || ''),
        h1: normalize(firstH1?.innerText || ''),
        h1Selector: firstH1 ? selectorFor(firstH1) : 'h1',
        h1Count: h1Nodes.length,
        headings: headingNodes.map((node) => ({
          level: node.tagName.toLowerCase(),
          text: elementText(node).slice(0, 180),
          selector: selectorFor(node)
        })).slice(0, 24),
        ctas: ctaNodes.filter((item) => item.isLikelyCta || item.aboveFold).slice(0, 40),
        forms: formNodes,
        trustSignalHits,
        bodyWordCount: bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0,
        firstViewportWordCount: visibleTextInViewport ? visibleTextInViewport.split(/\s+/).filter(Boolean).length : 0,
        links,
        navLinkCount: document.querySelectorAll('nav a, header a').length,
        extractionMode: 'puppeteer'
      };
    }, {
      originUrl: origin,
      trustSignals: TRUST_SIGNAL_KEYWORDS
    });

    result = {
      pageId: `page-${String(index + 1).padStart(2, '0')}`,
      url: targetUrl,
      label: pageLabelFromUrl(targetUrl),
      title: data.title,
      h1: data.h1,
      h1Selector: data.h1Selector,
      h1Count: data.h1Count,
      headings: data.headings,
      ctas: data.ctas,
      forms: data.forms,
      trustSignalHits: data.trustSignalHits,
      bodyWordCount: data.bodyWordCount,
      firstViewportWordCount: data.firstViewportWordCount,
      links: data.links
        .map((href) => canonicalizeUrl(href, origin))
        .filter(Boolean),
      navLinkCount: data.navLinkCount,
      extractionMode: data.extractionMode,
      screenshotFileName: fileName,
      screenshotUrl: buildScreenshotUrl(sessionId, fileName)
    };
  } finally {
    await page.close();
  }

  return result;
}

export async function runConversionUiFixLabAudit({
  url,
  store = 'shawq',
  maxPages = DEFAULT_MAX_PAGES,
  maxDepth = DEFAULT_MAX_DEPTH
}) {
  const rootUrl = normalizeUrl(url);
  const origin = new URL(rootUrl).origin;
  const sessionId = generateSessionId();
  const startedAt = new Date().toISOString();
  const sessionDir = ensureSessionDir(sessionId);

  const crawlMaxPages = clamp(Number(maxPages) || DEFAULT_MAX_PAGES, 1, 12);
  const crawlMaxDepth = clamp(Number(maxDepth) || DEFAULT_MAX_DEPTH, 0, 3);

  const queue = [{ url: rootUrl, depth: 0 }];
  const queued = new Set([rootUrl]);
  const visited = new Set();
  const pages = [];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    while (queue.length > 0 && pages.length < crawlMaxPages) {
      const current = queue.shift();
      if (!current || visited.has(current.url)) {
        continue;
      }

      visited.add(current.url);

      try {
        const page = await crawlSinglePage({
          browser,
          targetUrl: current.url,
          origin,
          sessionId,
          sessionDir,
          index: pages.length
        });

        pages.push(page);

        if (current.depth < crawlMaxDepth) {
          page.links.forEach((href) => {
            if (visited.has(href) || queued.has(href)) return;
            queue.push({ url: href, depth: current.depth + 1 });
            queued.add(href);
          });
        }
      } catch (error) {
        console.warn('[Conversion/UI Fix Lab] Failed to crawl page:', current.url, error.message);
      }
    }
  } finally {
    await browser.close();
  }

  const findingsByPage = new Map();
  const allFindings = [];

  pages.forEach((page) => {
    const pageFindings = buildFindingsForPage(page);
    findingsByPage.set(page.pageId, pageFindings);
    allFindings.push(...pageFindings);
  });

  const fixes = buildFixesFromFindings(allFindings);
  const applyPlan = buildApplyPlanFromFixes(fixes);
  const pagesSummary = pages.map((page) => summarizePage(page, findingsByPage.get(page.pageId) || []));
  const chapters = pagesSummary.slice(0, 3).map((page) => makeChapterFromPage(page, page.findings));

  const summary = {
    pagesCrawled: pagesSummary.length,
    findingsCount: allFindings.length,
    openFixes: fixes.filter((item) => item.state === 'open').length,
    approvedFixes: 0,
    estimatedCvrLiftPct: estimateLift(allFindings)
  };

  const report = {
    sessionId,
    store,
    rootUrl,
    generatedAt: new Date().toISOString(),
    summary,
    narrative: {
      executiveSummary: buildNarrative(pagesSummary, findingsByPage)
    },
    pages: pagesSummary,
    chapters,
    fixes,
    applyPlan,
    qaGates: buildQaGates()
  };

  persistSession({
    sessionId,
    store,
    rootUrl,
    status: 'completed',
    request: { url: rootUrl, maxPages: crawlMaxPages, maxDepth: crawlMaxDepth, startedAt },
    report
  });

  return report;
}

export function updateConversionUiFixLabApprovals({ sessionId, updates = [] }) {
  const session = getConversionUiFixLabSession(sessionId);
  if (!session) {
    throw new Error('Session not found.');
  }

  const report = session.report || {};
  const fixes = Array.isArray(report.fixes) ? report.fixes : [];
  const validFixIds = new Set(
    fixes
      .map((fix) => String(fix?.id || '').trim())
      .filter(Boolean)
  );

  const updatesByFixId = new Map();
  updates.forEach((update) => {
    const fixId = String(update?.fixId || '').trim();
    const state = String(update?.state || '').trim().toLowerCase();
    if (!fixId || !validFixIds.has(fixId) || !VALID_FIX_STATES.has(state)) {
      return;
    }

    updatesByFixId.set(fixId, {
      fixId,
      state,
      note: normalizeFixNote(update?.note)
    });
  });

  const normalizedUpdates = Array.from(updatesByFixId.values());
  if (!normalizedUpdates.length) {
    return hydrateReportWithFixStateOverrides(sessionId, report);
  }

  const db = getDb();
  const upsertFixState = db.prepare(`
    INSERT INTO conversion_ui_fix_lab_fix_states (
      session_id, fix_id, state, note, updated_at
    ) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, fix_id) DO UPDATE SET
      state = excluded.state,
      note = excluded.note,
      updated_at = datetime('now')
  `);
  const clearFixState = db.prepare(`
    DELETE FROM conversion_ui_fix_lab_fix_states
    WHERE session_id = ? AND fix_id = ?
  `);
  const touchSession = db.prepare(`
    UPDATE conversion_ui_fix_lab_sessions
    SET updated_at = datetime('now')
    WHERE session_id = ?
  `);

  const writeUpdates = db.transaction((rows) => {
    rows.forEach((item) => {
      // "open" without note means fallback to the base report state.
      if (item.state === 'open' && !item.note) {
        clearFixState.run(sessionId, item.fixId);
        return;
      }
      upsertFixState.run(sessionId, item.fixId, item.state, item.note);
    });
    touchSession.run(sessionId);
  });

  writeUpdates(normalizedUpdates);

  return hydrateReportWithFixStateOverrides(sessionId, report);
}

export function resolveConversionUiFixLabScreenshotPath(sessionId, fileName) {
  const safeSessionId = String(sessionId || '').trim();
  const safeFileName = String(fileName || '').trim();

  if (!/^[a-zA-Z0-9_-]+$/.test(safeSessionId)) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(safeFileName)) return null;

  const baseDir = getSessionDir(safeSessionId);
  const target = path.resolve(baseDir, safeFileName);
  const expectedPrefix = path.resolve(baseDir) + path.sep;

  if (!target.startsWith(expectedPrefix)) return null;
  if (!fs.existsSync(target)) return null;

  return target;
}
