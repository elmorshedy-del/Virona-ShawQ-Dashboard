import express from 'express';
import puppeteer from 'puppeteer';

const router = express.Router();

const MODEL_WEIGHTS = {
  decision_friction: 28,
  message_intent_alignment: 22,
  proof_architecture: 18,
  choice_architecture: 17,
  anxiety_risk_reversal: 15
};

const SOURCE_ALIGNMENT_TARGETS = {
  paid_social: 0.2,
  paid_search: 0.3,
  organic_search: 0.24,
  email: 0.2,
  direct: 0.16,
  referral: 0.18
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'in', 'into',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were',
  'will', 'with', 'you', 'your', 'we', 'our', 'us', 'can', 'get', 'new', 'best', 'now'
]);

const CLAIM_WORDS = [
  'best', 'number one', '#1', 'ultimate', 'revolutionary', 'premium', 'world class',
  'guaranteed', 'breakthrough', 'amazing', 'incredible'
];

const EVIDENCE_WORDS = [
  'study', 'data', 'results', 'case study', 'benchmark', 'measured', 'verified',
  'certified', 'independent', 'lab tested', 'customers', 'orders', 'reviews'
];

const MECHANISM_WORDS = [
  'how it works', 'step', 'process', 'works by', 'because', 'framework',
  'method', 'system', 'sequence'
];

const RISK_REVERSAL_WORDS = [
  'money-back', 'money back', 'refund', 'free return', 'returns', 'risk-free',
  'no risk', 'cancel anytime', 'warranty', 'guarantee', 'try it free'
];

const ANXIETY_WORDS = [
  'hidden', 'fees', 'delay', 'complicated', 'risk', 'expensive', 'uncertain',
  'hard to', 'not sure', 'worry', 'shipping calculated at checkout', 'final sale'
];

const OBJECTION_CATEGORIES = [
  ['shipping', 'delivery', 'dispatch', 'arrival'],
  ['return', 'refund', 'exchange', 'money-back'],
  ['secure', 'encrypted', 'privacy', 'trusted', 'safe checkout'],
  ['quality', 'materials', 'durable', 'fit', 'sizing'],
  ['support', 'contact', 'help', 'chat']
];

const EXPERIMENT_TEMPLATES = {
  decision_friction: {
    title: 'Reduce first-screen decision friction',
    hypothesis: 'Clarifying value proposition and narrowing early action choices will increase progression to the next funnel step.',
    targetMetric: 'Primary CTA click-through rate',
    effort: 'medium',
    reach: 0.85
  },
  message_intent_alignment: {
    title: 'Tighten ad-to-landing intent match',
    hypothesis: 'Mirroring traffic intent in the headline and CTA language will reduce bounce and improve qualified clicks.',
    targetMetric: 'Landing-page bounce rate',
    effort: 'low',
    reach: 0.8
  },
  proof_architecture: {
    title: 'Upgrade claim-to-proof architecture',
    hypothesis: 'Adding quantified evidence near major claims will improve credibility and conversion confidence.',
    targetMetric: 'Add-to-cart rate',
    effort: 'medium',
    reach: 0.65
  },
  choice_architecture: {
    title: 'Simplify primary action path',
    hypothesis: 'Reducing competing above-fold actions and simplifying flow sequencing will improve CTA completion.',
    targetMetric: 'Primary CTA completion rate',
    effort: 'medium',
    reach: 0.75
  },
  anxiety_risk_reversal: {
    title: 'Strengthen risk reversal near the CTA',
    hypothesis: 'Specific guarantees and policy clarity at decision points will reduce hesitation and improve checkout starts.',
    targetMetric: 'Checkout initiation rate',
    effort: 'low',
    reach: 0.7
  }
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function logit(p) {
  const bounded = clamp(p, 0.0001, 0.9999);
  return Math.log(bounded / (1 - bounded));
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
  return parsed.toString();
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && token.length > 2 && !STOPWORDS.has(token));
}

function uniqueTokenSet(text) {
  return new Set(tokenize(text));
}

function jaccardSimilarity(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

function countMatches(text, phrases = []) {
  const haystack = String(text || '').toLowerCase();
  return phrases.reduce((count, phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    const hits = haystack.match(regex);
    return count + (hits ? hits.length : 0);
  }, 0);
}

function countRegexMatches(text, regex) {
  const matches = String(text || '').match(regex);
  return matches ? matches.length : 0;
}

function coverageScore(text, categories) {
  if (!categories.length) return 0;
  const haystack = String(text || '').toLowerCase();
  let covered = 0;
  categories.forEach((category) => {
    if (category.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      covered += 1;
    }
  });
  return covered / categories.length;
}

function estimateSyllables(word) {
  const clean = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;
  if (clean.length <= 3) return 1;
  const groups = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function fleschReadingEase(text) {
  const content = String(text || '').trim();
  if (!content) return 0;
  const sentences = Math.max(1, (content.match(/[.!?]+/g) || []).length);
  const words = content.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const syllables = words.reduce((sum, word) => sum + estimateSyllables(word), 0);
  const score = 206.835 - (1.015 * (words.length / sentences)) - (84.6 * (syllables / words.length));
  return clamp(score, 0, 100);
}

function getConfidence({ coverage, richness }) {
  const score = 0.45 + (coverage * 0.35) + (richness * 0.2);
  return round(clamp(score, 0.35, 0.95), 2);
}

function scoreBayesianModel({ id, label, weight, prior = 0.35, features = [], richness = 0.5 }) {
  const base = logit(prior);
  let logOdds = base;
  let evidenceCount = 0;

  const scoredFeatures = features.map((feature) => {
    const risk = clamp(feature.risk ?? 0.5, 0, 1);
    const centered = (risk - 0.5) * 2;
    const contribution = feature.beta * centered;
    logOdds += contribution;
    if (feature.available !== false) evidenceCount += 1;

    return {
      key: feature.key,
      label: feature.label,
      beta: feature.beta,
      risk: round(risk, 3),
      contribution: round(contribution, 3),
      evidence: feature.evidence || 'No evidence captured.'
    };
  });

  const dragProbability = clamp(sigmoid(logOdds), 0.01, 0.99);
  const rawScore = (1 - dragProbability) * 100;
  const coverage = features.length ? evidenceCount / features.length : 0;
  const confidence = getConfidence({ coverage, richness });
  const adjustedScore = (confidence * rawScore) + ((1 - confidence) * 50);

  const dominantRisks = [...scoredFeatures]
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 3);

  return {
    id,
    label,
    weight,
    prior,
    score: round(rawScore, 1),
    adjustedScore: round(adjustedScore, 1),
    dragProbability: round(dragProbability, 3),
    confidence,
    evidenceCount,
    features: scoredFeatures,
    dominantRisks
  };
}

function scoreStatus(score) {
  if (score >= 80) return { label: 'Strong', tone: 'strong' };
  if (score >= 65) return { label: 'Competitive', tone: 'good' };
  if (score >= 50) return { label: 'At Risk', tone: 'warning' };
  return { label: 'Critical Drag', tone: 'critical' };
}

function buildExperiments(models) {
  const effortFactor = { low: 1, medium: 1.25, high: 1.5 };
  const queue = models.map((model) => {
    const template = EXPERIMENT_TEMPLATES[model.id];
    const gap = clamp(100 - model.adjustedScore, 0, 100);
    const impact = clamp(gap / 20, 1, 5);
    const confidence = clamp(model.confidence * 0.95, 0.3, 0.95);
    const reach = template.reach;
    const effort = template.effort;
    const priority = (impact * reach * confidence * 100) / (effortFactor[effort] || 1.25);
    const liftBase = impact * reach * confidence * 2.4;
    const liftLow = Math.max(1, Math.round(liftBase));
    const liftHigh = Math.max(liftLow + 1, Math.round(liftBase * 2.1));
    const topRisk = model.dominantRisks[0];

    return {
      modelId: model.id,
      title: template.title,
      hypothesis: template.hypothesis,
      targetMetric: template.targetMetric,
      effort,
      confidence: round(confidence, 2),
      impact: round(impact, 2),
      reach: round(reach, 2),
      priorityScore: round(priority, 1),
      expectedLiftPct: `${liftLow}% - ${liftHigh}%`,
      trigger: topRisk ? `${topRisk.label}: ${topRisk.evidence}` : null
    };
  });

  return queue.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 5);
}

async function extractWithPuppeteer(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'media') req.abort();
      else req.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1800);

    const performance = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return null;
      return {
        domContentLoadedMs: nav.domContentLoadedEventEnd || 0,
        loadMs: nav.loadEventEnd || nav.duration || 0,
        ttfbMs: nav.responseStart || 0
      };
    });

    const data = await page.evaluate(() => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const viewportHeight = window.innerHeight || 900;
      const actionPattern = /(buy|shop|get|start|join|subscribe|add to cart|checkout|book|claim|order|learn|try)/i;
      const textFrom = (el) => normalize(el?.innerText || el?.textContent || '');

      const title = normalize(document.title || '');
      const metaDescription = normalize(document.querySelector('meta[name="description"]')?.content || '');
      const h1 = normalize(document.querySelector('h1')?.innerText || '');
      const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
        .filter(visible)
        .map((el) => textFrom(el))
        .filter(Boolean)
        .slice(0, 20);

      const actionElements = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a'))
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const text = textFrom(el).slice(0, 120);
          return {
            text,
            aboveFold: rect.top >= 0 && rect.top < viewportHeight,
            isCta: actionPattern.test(text)
          };
        });

      const ctaElements = actionElements.filter((item) => item.isCta);
      const ctasAboveFold = ctaElements.filter((item) => item.aboveFold);
      const actionsAboveFold = actionElements.filter((item) => item.aboveFold);
      const uniqueCtasAboveFold = new Set(
        ctasAboveFold
          .map((item) => item.text.toLowerCase())
          .filter(Boolean)
      ).size;

      const firstScreenText = Array.from(document.querySelectorAll('h1, h2, p, li, a, button, span'))
        .filter(visible)
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.top < viewportHeight;
        })
        .map((el) => textFrom(el))
        .join(' ');

      const bodyText = normalize(document.body?.innerText || '').slice(0, 80000);
      const words = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
      const navLinks = document.querySelectorAll('nav a, header a').length;
      const linksAboveFold = Array.from(document.querySelectorAll('a'))
        .filter(visible)
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.top < viewportHeight;
        }).length;

      const forms = Array.from(document.querySelectorAll('form'));
      const formFieldCount = forms.reduce((total, form) => (
        total + form.querySelectorAll('input, select, textarea').length
      ), 0);

      const policyLinks = Array.from(document.querySelectorAll('a'))
        .map((el) => textFrom(el).toLowerCase())
        .filter((text) => /(return|refund|shipping|warranty|guarantee|privacy|terms|policy|support)/i.test(text))
        .slice(0, 50);

      const hiddenCostMentions = /(shipping calculated at checkout|taxes calculated at checkout|fees apply|non-refundable|final sale)/i.test(bodyText);
      const hasHeroHeading = Boolean(h1 || headings[0]);
      const firstScreenWordCount = firstScreenText ? firstScreenText.split(/\s+/).filter(Boolean).length : 0;

      return {
        title,
        metaDescription,
        h1,
        headings,
        bodyText,
        wordCount: words,
        actionCount: actionElements.length,
        ctaCount: ctaElements.length,
        ctasAboveFold: ctasAboveFold.length,
        uniqueCtasAboveFold,
        actionsAboveFold: actionsAboveFold.length,
        hasHeroHeading,
        firstScreenWordCount,
        navLinks,
        linksAboveFold,
        formsCount: forms.length,
        formFieldCount,
        policyLinks,
        hiddenCostMentions
      };
    });

    return { ...data, performance };
  } finally {
    await browser.close();
  }
}

async function extractWithFetch(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; CROForensics/1.0)'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch target URL (HTTP ${response.status}).`);
  }
  const html = await response.text();

  const readTag = (regex) => {
    const match = html.match(regex);
    if (!match) return '';
    return String(match[1] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };

  const title = readTag(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = readTag(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i);
  const h1 = readTag(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const headingMatches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].slice(0, 20);
  const headings = headingMatches.map((match) => String(match[1] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80000);

  const ctaCount = countRegexMatches(html, /<(button|a|input)[^>]*>([\s\S]*?)<\/(button|a)>/gi) || 0;
  const formFieldCount = countRegexMatches(html, /<(input|select|textarea)\b/gi);
  const policyLinks = [...html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => String(match[1] || '').replace(/<[^>]*>/g, ' ').trim().toLowerCase())
    .filter((text) => /(return|refund|shipping|warranty|guarantee|privacy|terms|policy|support)/i.test(text))
    .slice(0, 50);

  return {
    title,
    metaDescription,
    h1,
    headings,
    bodyText,
    wordCount: bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0,
    actionCount: ctaCount,
    ctaCount,
    ctasAboveFold: 0,
    uniqueCtasAboveFold: 0,
    actionsAboveFold: 0,
    hasHeroHeading: Boolean(h1 || headings[0]),
    firstScreenWordCount: 0,
    navLinks: 0,
    linksAboveFold: 0,
    formsCount: countRegexMatches(html, /<form\b/gi),
    formFieldCount,
    policyLinks,
    hiddenCostMentions: /(shipping calculated at checkout|taxes calculated at checkout|fees apply|non-refundable|final sale)/i.test(bodyText),
    performance: null,
    extractionMode: 'fetch-fallback'
  };
}

async function extractWebsiteSignals(url) {
  try {
    const data = await extractWithPuppeteer(url);
    return {
      ...data,
      extractionMode: 'puppeteer'
    };
  } catch (error) {
    console.warn('[CRO Forensics] Puppeteer extraction failed, using fetch fallback:', error.message);
    const fallback = await extractWithFetch(url);
    return fallback;
  }
}

function buildAudit(body, pageData, url) {
  const conversionGoal = String(body?.conversionGoal || 'Purchase').trim();
  const trafficSource = String(body?.trafficSource || 'paid_social').trim().toLowerCase();
  const audienceSophistication = String(body?.audienceSophistication || 'cold').trim().toLowerCase();
  const priceRisk = String(body?.priceRisk || 'medium').trim().toLowerCase();
  const offerType = String(body?.offerType || 'single-product').trim().toLowerCase();

  const pageNarrative = [
    pageData.title,
    pageData.metaDescription,
    pageData.h1,
    ...(pageData.headings || [])
  ].join(' ');
  const corpus = String(pageData.bodyText || '');
  const lowerCorpus = corpus.toLowerCase();
  const readingEase = fleschReadingEase(corpus);

  const intentText = [
    conversionGoal,
    trafficSource,
    audienceSophistication,
    priceRisk,
    offerType
  ].join(' ');

  const intentSimilarity = jaccardSimilarity(uniqueTokenSet(intentText), uniqueTokenSet(pageNarrative));
  const alignmentTarget = SOURCE_ALIGNMENT_TARGETS[trafficSource] || 0.2;
  const intentMismatchRisk = clamp((alignmentTarget - intentSimilarity) / Math.max(alignmentTarget, 0.01), 0, 1);

  const claimCount = countMatches(lowerCorpus, CLAIM_WORDS);
  const evidenceKeywordCount = countMatches(lowerCorpus, EVIDENCE_WORDS);
  const numericEvidenceCount = countRegexMatches(corpus, /\b\d+(?:\.\d+)?%?\b/g);
  const mechanismCount = countMatches(lowerCorpus, MECHANISM_WORDS);
  const riskReversalCount = countMatches(lowerCorpus, RISK_REVERSAL_WORDS);
  const anxietyCount = countMatches(lowerCorpus, ANXIETY_WORDS);
  const objectionCoverage = coverageScore(lowerCorpus, OBJECTION_CATEGORIES);

  const richness = clamp(
    (
      Math.min(1, (pageData.wordCount || 0) / 1200) +
      Math.min(1, (pageData.headings?.length || 0) / 8) +
      Math.min(1, (pageData.actionCount || 0) / 14)
    ) / 3,
    0,
    1
  );

  const attentionRisk = clamp(
    (
      (pageData.hasHeroHeading ? 0.15 : 0.82) +
      ((pageData.ctasAboveFold || 0) === 0 ? 0.9 : (pageData.ctasAboveFold > 2 ? 0.58 : 0.2)) +
      clamp(((pageData.firstScreenWordCount || 0) - 160) / 180, 0, 1)
    ) / 3,
    0,
    1
  );
  const comprehensionRisk = clamp(((55 - readingEase) / 55), 0, 1);
  const beliefRisk = clamp(
    (
      clamp((claimCount - (evidenceKeywordCount + numericEvidenceCount * 0.4)) / Math.max(claimCount + 1, 2), 0, 1) +
      (1 - clamp((mechanismCount + (numericEvidenceCount * 0.35)) / 8, 0, 1))
    ) / 2,
    0,
    1
  );
  const actionRisk = clamp(
    (
      (((pageData.ctasAboveFold || 0) > 3) ? 0.85 : ((pageData.ctasAboveFold || 0) === 0 ? 0.78 : 0.25)) +
      clamp(((pageData.formFieldCount || 0) - 4) / 8, 0, 1) +
      clamp(((pageData.linksAboveFold || 0) - 12) / 24, 0, 1)
    ) / 3,
    0,
    1
  );
  const riskFriction = clamp(
    (
      (1 - clamp((riskReversalCount + (pageData.policyLinks?.length || 0) * 0.6) / 8, 0, 1)) +
      (pageData.hiddenCostMentions ? 0.8 : 0.2)
    ) / 2,
    0,
    1
  );

  const modelDecision = scoreBayesianModel({
    id: 'decision_friction',
    label: 'Decision Friction',
    weight: MODEL_WEIGHTS.decision_friction,
    prior: 0.36,
    richness,
    features: [
      {
        key: 'attention_friction',
        label: 'Attention friction',
        beta: 1.15,
        risk: attentionRisk,
        evidence: `Above-fold CTAs: ${pageData.ctasAboveFold || 0}, first-screen words: ${pageData.firstScreenWordCount || 0}`
      },
      {
        key: 'comprehension_friction',
        label: 'Comprehension friction',
        beta: 1.05,
        risk: comprehensionRisk,
        evidence: `Readability score: ${round(readingEase, 1)}`
      },
      {
        key: 'belief_friction',
        label: 'Belief friction',
        beta: 0.95,
        risk: beliefRisk,
        evidence: `Claim count: ${claimCount}, evidence markers: ${evidenceKeywordCount + numericEvidenceCount}`
      },
      {
        key: 'action_friction',
        label: 'Action friction',
        beta: 1.05,
        risk: actionRisk,
        evidence: `Form fields: ${pageData.formFieldCount || 0}, links above fold: ${pageData.linksAboveFold || 0}`
      },
      {
        key: 'risk_friction',
        label: 'Risk friction',
        beta: 0.9,
        risk: riskFriction,
        evidence: `Risk reversal mentions: ${riskReversalCount}, policy links: ${pageData.policyLinks?.length || 0}`
      }
    ]
  });

  const promiseContinuityRisk = clamp(
    (
      intentMismatchRisk +
      clamp((pageData.h1 ? 0 : 0.65), 0, 1) +
      clamp(((pageData.metaDescription || '').length < 40 ? 0.45 : 0.15), 0, 1)
    ) / 3,
    0,
    1
  );

  const stageMismatchRisk = clamp(
    (
      (audienceSophistication === 'cold' && (pageData.ctasAboveFold || 0) > 2 ? 0.55 : 0.22) +
      (audienceSophistication === 'hot' && (pageData.ctasAboveFold || 0) === 0 ? 0.65 : 0.18)
    ) / 2,
    0,
    1
  );

  const modelIntent = scoreBayesianModel({
    id: 'message_intent_alignment',
    label: 'Message-Intent Alignment',
    weight: MODEL_WEIGHTS.message_intent_alignment,
    prior: 0.33,
    richness,
    features: [
      {
        key: 'intent_gap',
        label: 'Intent gap severity',
        beta: 1.35,
        risk: intentMismatchRisk,
        evidence: `Intent similarity: ${round(intentSimilarity, 3)} vs target ${alignmentTarget}`
      },
      {
        key: 'promise_continuity',
        label: 'Promise continuity',
        beta: 1.0,
        risk: promiseContinuityRisk,
        evidence: `Title/H1/meta continuity score derived from narrative depth`
      },
      {
        key: 'funnel_stage_fit',
        label: 'Funnel-stage fit',
        beta: 0.8,
        risk: stageMismatchRisk,
        evidence: `Audience sophistication: ${audienceSophistication}, above-fold CTA count: ${pageData.ctasAboveFold || 0}`
      }
    ]
  });

  const claimEvidenceRisk = clamp(
    (claimCount / Math.max((evidenceKeywordCount + numericEvidenceCount * 0.5), 1) - 1) / 3,
    0,
    1
  );
  const mechanismRisk = 1 - clamp(mechanismCount / 4, 0, 1);
  const specificityRisk = 1 - clamp((numericEvidenceCount + evidenceKeywordCount * 0.7) / 10, 0, 1);
  const objectionRisk = 1 - objectionCoverage;

  const modelProof = scoreBayesianModel({
    id: 'proof_architecture',
    label: 'Proof Architecture',
    weight: MODEL_WEIGHTS.proof_architecture,
    prior: 0.34,
    richness,
    features: [
      {
        key: 'claim_to_evidence',
        label: 'Claim-to-evidence ratio',
        beta: 1.2,
        risk: claimEvidenceRisk,
        evidence: `Claims: ${claimCount}, evidence markers: ${evidenceKeywordCount + numericEvidenceCount}`
      },
      {
        key: 'mechanism_clarity',
        label: 'Mechanism clarity',
        beta: 0.95,
        risk: mechanismRisk,
        evidence: `Mechanism cues detected: ${mechanismCount}`
      },
      {
        key: 'specificity_strength',
        label: 'Specificity strength',
        beta: 0.85,
        risk: specificityRisk,
        evidence: `Numeric/specific references: ${numericEvidenceCount}`
      },
      {
        key: 'objection_coverage',
        label: 'Objection coverage',
        beta: 0.85,
        risk: objectionRisk,
        evidence: `Coverage ratio across 5 objection groups: ${round(objectionCoverage, 2)}`
      }
    ]
  });

  const ctaCompetitionRisk = clamp(
    (pageData.ctasAboveFold || 0) <= 1
      ? 0.2
      : (pageData.ctasAboveFold || 0) === 2
        ? 0.42
        : (pageData.ctasAboveFold || 0) === 3
          ? 0.68
          : 0.85,
    0,
    1
  );

  const branchingRisk = clamp(((pageData.linksAboveFold || 0) - 10) / 22, 0, 1);
  const sequenceRisk = clamp(
    (
      ((pageData.hasHeroHeading ? 0.15 : 0.75)) +
      ((pageData.ctasAboveFold || 0) === 0 ? 0.7 : 0.2)
    ) / 2,
    0,
    1
  );
  const formFrictionRisk = clamp(((pageData.formFieldCount || 0) - 5) / 8, 0, 1);

  const modelChoice = scoreBayesianModel({
    id: 'choice_architecture',
    label: 'Choice Architecture',
    weight: MODEL_WEIGHTS.choice_architecture,
    prior: 0.33,
    richness,
    features: [
      {
        key: 'cta_competition',
        label: 'CTA competition',
        beta: 1.05,
        risk: ctaCompetitionRisk,
        evidence: `Above-fold CTAs: ${pageData.ctasAboveFold || 0}, unique: ${pageData.uniqueCtasAboveFold || 0}`
      },
      {
        key: 'branching_complexity',
        label: 'Branching complexity',
        beta: 0.95,
        risk: branchingRisk,
        evidence: `Links above fold: ${pageData.linksAboveFold || 0}`
      },
      {
        key: 'sequence_clarity',
        label: 'Sequence clarity',
        beta: 0.8,
        risk: sequenceRisk,
        evidence: `Hero heading present: ${pageData.hasHeroHeading ? 'yes' : 'no'}`
      },
      {
        key: 'form_friction',
        label: 'Form friction',
        beta: 0.8,
        risk: formFrictionRisk,
        evidence: `Form fields in flow: ${pageData.formFieldCount || 0}`
      }
    ]
  });

  const unresolvedFearRisk = clamp(
    (
      clamp((anxietyCount - riskReversalCount) / 8, 0, 1) +
      (pageData.hiddenCostMentions ? 0.85 : 0.18)
    ) / 2,
    0,
    1
  );

  const guaranteeSpecificityRisk = 1 - clamp((riskReversalCount + (pageData.policyLinks?.length || 0) * 0.5) / 6, 0, 1);
  const priceRiskFactor = priceRisk === 'high' ? 0.72 : priceRisk === 'medium' ? 0.52 : 0.35;
  const priceAnxietyRisk = clamp((unresolvedFearRisk * 0.6) + (priceRiskFactor * 0.4), 0, 1);

  const modelAnxiety = scoreBayesianModel({
    id: 'anxiety_risk_reversal',
    label: 'Anxiety & Risk Reversal',
    weight: MODEL_WEIGHTS.anxiety_risk_reversal,
    prior: 0.34,
    richness,
    features: [
      {
        key: 'unresolved_fears',
        label: 'Unresolved fear cues',
        beta: 1.15,
        risk: unresolvedFearRisk,
        evidence: `Anxiety cues: ${anxietyCount}, hidden-cost signal: ${pageData.hiddenCostMentions ? 'yes' : 'no'}`
      },
      {
        key: 'risk_reversal_strength',
        label: 'Risk reversal strength',
        beta: 1.0,
        risk: guaranteeSpecificityRisk,
        evidence: `Risk reversal mentions: ${riskReversalCount}, policy links: ${pageData.policyLinks?.length || 0}`
      },
      {
        key: 'price_uncertainty',
        label: 'Price/risk uncertainty',
        beta: 0.75,
        risk: priceAnxietyRisk,
        evidence: `Declared price risk: ${priceRisk}`
      }
    ]
  });

  const models = [modelDecision, modelIntent, modelProof, modelChoice, modelAnxiety];
  const weightedScore = models.reduce((sum, model) => sum + (model.adjustedScore * model.weight), 0) / 100;
  const overallConfidence = models.reduce((sum, model) => sum + (model.confidence * model.weight), 0) / 100;
  const overall = round(weightedScore, 1);
  const status = scoreStatus(overall);
  const experiments = buildExperiments(models);

  const findings = models
    .flatMap((model) =>
      model.dominantRisks.map((risk) => ({
        modelId: model.id,
        modelLabel: model.label,
        severity: risk.risk >= 0.7 ? 'high' : risk.risk >= 0.5 ? 'medium' : 'low',
        label: risk.label,
        evidence: risk.evidence,
        risk: risk.risk,
        scoreImpact: round((risk.risk - 0.5) * model.weight, 2)
      }))
    )
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 10);

  return {
    version: 'cro-forensics-bayesian-v1',
    auditedAt: new Date().toISOString(),
    input: {
      url,
      conversionGoal,
      trafficSource,
      audienceSophistication,
      priceRisk,
      offerType
    },
    summary: {
      overallScore: overall,
      overallConfidence: round(overallConfidence, 2),
      status: status.label,
      tone: status.tone
    },
    models,
    experiments,
    findings,
    evidence: {
      extractionMode: pageData.extractionMode || 'unknown',
      page: {
        title: pageData.title,
        h1: pageData.h1,
        metaDescription: pageData.metaDescription,
        wordCount: pageData.wordCount,
        headingCount: pageData.headings?.length || 0
      },
      structure: {
        actionCount: pageData.actionCount,
        ctaCount: pageData.ctaCount,
        ctasAboveFold: pageData.ctasAboveFold,
        uniqueCtasAboveFold: pageData.uniqueCtasAboveFold,
        linksAboveFold: pageData.linksAboveFold,
        formFieldCount: pageData.formFieldCount,
        navLinks: pageData.navLinks,
        firstScreenWordCount: pageData.firstScreenWordCount
      },
      language: {
        readability: round(readingEase, 1),
        claimCount,
        evidenceKeywordCount,
        numericEvidenceCount,
        mechanismCount,
        objectionCoverage: round(objectionCoverage, 2),
        riskReversalCount,
        anxietyCount
      },
      performance: pageData.performance || null
    }
  };
}

router.post('/audit', async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url);
    const pageData = await extractWebsiteSignals(url);
    const audit = buildAudit(req.body, pageData, url);

    res.json({
      success: true,
      audit
    });
  } catch (error) {
    console.error('[CRO Forensics] Audit failed:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Audit failed.'
    });
  }
});

export default router;
