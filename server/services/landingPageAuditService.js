import Anthropic from '@anthropic-ai/sdk';

import { getDb } from '../db/database.js';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const CLAUDE_MAX_TOKENS = 4096;
const MAX_PROMPT_HTML_CHARS = 60_000;
const MAX_PROMPT_TEXT_CHARS = 30_000;
const MAX_FINDINGS_PER_DIMENSION = 20;
const VALID_GRADES = new Set(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']);
const REQUIRED_DIMENSION_NAMES = ['First Impression', 'Copy & Messaging', 'Call-to-Action', 'Trust & Proof', 'Mobile & Access', 'Performance'];

const REFERENCE_FILES = Object.freeze([
  {
    key: 'scoring-rubric',
    label: 'references/scoring-rubric.md',
    url: 'https://raw.githubusercontent.com/FuzulsFriend/roast-my-landing-page/master/references/scoring-rubric.md'
  },
  {
    key: 'anti-patterns',
    label: 'references/anti-patterns.md',
    url: 'https://raw.githubusercontent.com/FuzulsFriend/roast-my-landing-page/master/references/anti-patterns.md'
  },
  {
    key: 'cro-checklist',
    label: 'references/cro-checklist.md',
    url: 'https://raw.githubusercontent.com/FuzulsFriend/roast-my-landing-page/master/references/cro-checklist.md'
  },
  {
    key: 'industry-benchmarks',
    label: 'references/industry-benchmarks.md',
    url: 'https://raw.githubusercontent.com/FuzulsFriend/roast-my-landing-page/master/references/industry-benchmarks.md'
  },
  {
    key: 'copy-analysis-rules',
    label: 'references/copy-analysis-rules.md',
    url: 'https://raw.githubusercontent.com/FuzulsFriend/roast-my-landing-page/master/references/copy-analysis-rules.md'
  },
  {
    key: 'nielsen-heuristics',
    label: 'references/nielsen-heuristics.md',
    url: 'https://raw.githubusercontent.com/FuzulsFriend/roast-my-landing-page/master/references/nielsen-heuristics.md'
  },
  {
    key: 'storybrand-framework',
    label: 'references/storybrand-framework.md',
    url: 'https://raw.githubusercontent.com/FuzulsFriend/roast-my-landing-page/master/references/storybrand-framework.md'
  }
]);

let referenceBundleCache = null;

function requireAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured.');
  }

  return new Anthropic({ apiKey });
}

async function loadReferenceBundle() {
  if (referenceBundleCache) {
    return referenceBundleCache;
  }

  const fetched = await Promise.all(
    REFERENCE_FILES.map(async (reference) => {
      const response = await fetch(reference.url, { method: 'GET', redirect: 'follow' });
      if (!response.ok) {
        throw new Error(`Failed to load ${reference.label} (HTTP ${response.status})`);
      }
      const text = await response.text();
      return {
        ...reference,
        text
      };
    })
  );

  referenceBundleCache = fetched;
  return referenceBundleCache;
}

function sanitizeForPrompt(pageData) {
  const html = String(pageData?.html || '');
  const visibleText = String(pageData?.visibleText || '');

  return {
    ...pageData,
    html: html.length > MAX_PROMPT_HTML_CHARS ? `${html.slice(0, MAX_PROMPT_HTML_CHARS)}…` : html,
    visibleText: visibleText.length > MAX_PROMPT_TEXT_CHARS ? `${visibleText.slice(0, MAX_PROMPT_TEXT_CHARS)}…` : visibleText,
    screenshots: {
      desktopBase64: pageData?.screenshots?.desktopBase64 ? '[included-in-db-not-in-prompt]' : null,
      mobileBase64: pageData?.screenshots?.mobileBase64 ? '[included-in-db-not-in-prompt]' : null
    }
  };
}

function extractJsonFromClaudeText(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('Claude returned an empty response.');
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const secondCandidate = candidate.slice(firstBrace, lastBrace + 1);
      return JSON.parse(secondCandidate);
    }
    throw firstError;
  }
}

function normalizeDimension(rawDimension) {
  const findings = Array.isArray(rawDimension?.findings) ? rawDimension.findings.slice(0, MAX_FINDINGS_PER_DIMENSION) : [];
  return {
    name: String(rawDimension?.name || ''),
    score: Number(rawDimension?.score ?? 0),
    weight: Number(rawDimension?.weight ?? 0),
    icon: String(rawDimension?.icon || '📊'),
    isCritical: Boolean(rawDimension?.isCritical),
    findings: findings.map((finding) => ({
      severity: String(finding?.severity || 'SUGGESTION'),
      text: String(finding?.text || ''),
      fix: String(finding?.fix || '')
    }))
  };
}

function validateAuditResultShape(result) {
  const dimensions = Array.isArray(result?.dimensions) ? result.dimensions.map(normalizeDimension) : [];
  if (dimensions.length !== REQUIRED_DIMENSION_NAMES.length) {
    throw new Error(`Claude response must include exactly ${REQUIRED_DIMENSION_NAMES.length} dimensions.`);
  }

  const missingDimension = REQUIRED_DIMENSION_NAMES.find((name) => !dimensions.some((dimension) => dimension.name === name));
  if (missingDimension) {
    throw new Error(`Claude response missing required dimension: ${missingDimension}`);
  }

  const overallScore = Number(result?.overall?.score ?? NaN);
  const overallGrade = String(result?.overall?.grade || '');
  if (!Number.isFinite(overallScore) || overallScore < 0 || overallScore > 100) {
    throw new Error('Overall score must be a number from 0 to 100.');
  }
  if (!VALID_GRADES.has(overallGrade)) {
    throw new Error(`Overall grade must be one of: ${Array.from(VALID_GRADES).join(', ')}`);
  }

  return {
    meta: {
      url: String(result?.meta?.url || ''),
      businessType: String(result?.meta?.businessType || ''),
      conversionGoal: String(result?.meta?.conversionGoal || ''),
      targetCustomer: String(result?.meta?.targetCustomer || ''),
      launchStage: String(result?.meta?.launchStage || 'launched'),
      auditDate: String(result?.meta?.auditDate || new Date().toISOString()),
      toolsUsed: Array.isArray(result?.meta?.toolsUsed) ? result.meta.toolsUsed.map((tool) => String(tool)) : []
    },
    overall: {
      score: Math.max(0, Math.min(100, Math.round(overallScore))),
      grade: overallGrade,
      verdict: String(result?.overall?.verdict || '')
    },
    dimensions,
    roasts: Array.isArray(result?.roasts) ? result.roasts.map((roast) => ({
      issue: String(roast?.issue || ''),
      why: String(roast?.why || ''),
      fix: String(roast?.fix || ''),
      effort: String(roast?.effort || 'Medium')
    })) : [],
    wins: Array.isArray(result?.wins) ? result.wins.map((win) => String(win)) : [],
    antiPatterns: Array.isArray(result?.antiPatterns) ? result.antiPatterns.map((pattern) => ({
      pattern: String(pattern?.pattern || ''),
      found: Boolean(pattern?.found),
      penalty: String(pattern?.penalty || ''),
      dimension: String(pattern?.dimension || '')
    })) : [],
    improvementPath: {
      steps: Array.isArray(result?.improvementPath?.steps)
        ? result.improvementPath.steps.map((step) => ({
          action: String(step?.action || ''),
          dimension: String(step?.dimension || ''),
          currentScore: Number(step?.currentScore ?? 0),
          projectedScore: Number(step?.projectedScore ?? 0),
          effort: String(step?.effort || 'Medium'),
          estimatedTime: String(step?.estimatedTime || '')
        }))
        : [],
      currentGrade: String(result?.improvementPath?.currentGrade || ''),
      projectedGrade: String(result?.improvementPath?.projectedGrade || ''),
      totalEstimatedTime: String(result?.improvementPath?.totalEstimatedTime || '')
    }
  };
}

function buildSystemPrompt(referenceBundle) {
  const referenceText = referenceBundle.map((reference) => `### ${reference.label}\n\n${reference.text}`).join('\n\n');

  return [
    'You are the Landing Page Audit scoring engine from FuzulsFriend/roast-my-landing-page.',
    'You MUST follow the rubric, anti-pattern penalties, benchmarks, and checklists exactly as written below.',
    'Do not invent alternate scoring systems, dimensions, or weights.',
    'Use exact weighted formula: (FI×0.20) + (Copy×0.20) + (CTA×0.15) + (Trust×0.15) + (Mobile×0.15) + (Perf×0.15).',
    'Return JSON ONLY. No markdown, no preface, no code fences.',
    'Use exactly 6 dimensions named: First Impression, Copy & Messaging, Call-to-Action, Trust & Proof, Mobile & Access, Performance.',
    'Use severity values only: CRITICAL, WARNING, SUGGESTION, PASS.',
    'Use effort values only: Quick Fix, Medium, Major.',
    'Use grade values only: A+, A, B+, B, C+, C, D, F.',
    'Required output schema:',
    JSON.stringify({
      meta: {
        url: 'string',
        businessType: 'string',
        conversionGoal: 'string',
        targetCustomer: 'string',
        launchStage: 'launched|early-access|pre-launch',
        auditDate: 'ISO string',
        toolsUsed: ['string']
      },
      overall: {
        score: '0-100',
        grade: 'A+|A|B+|B|C+|C|D|F',
        verdict: 'string'
      },
      dimensions: [
        {
          name: 'First Impression',
          score: '0-100',
          weight: 0.2,
          icon: 'emoji',
          isCritical: false,
          findings: [
            {
              severity: 'CRITICAL|WARNING|SUGGESTION|PASS',
              text: 'string',
              fix: 'string'
            }
          ]
        }
      ],
      roasts: [
        {
          issue: 'string',
          why: 'string',
          fix: 'string',
          effort: 'Quick Fix|Medium|Major'
        }
      ],
      wins: ['string'],
      antiPatterns: [
        {
          pattern: 'string',
          found: true,
          penalty: 'string',
          dimension: 'string'
        }
      ],
      improvementPath: {
        steps: [
          {
            action: 'string',
            dimension: 'string',
            currentScore: 0,
            projectedScore: 0,
            effort: 'string',
            estimatedTime: 'string'
          }
        ],
        currentGrade: 'string',
        projectedGrade: 'string',
        totalEstimatedTime: 'string'
      }
    }, null, 2),
    'Reference content (VERBATIM):',
    referenceText
  ].join('\n\n');
}

export async function runLandingPageAudit({
  store,
  url,
  businessType,
  conversionGoal,
  targetCustomer,
  pageData
}) {
  const anthropic = requireAnthropicClient();
  const referenceBundle = await loadReferenceBundle();
  const systemPrompt = buildSystemPrompt(referenceBundle);

  const userPayload = {
    inputs: {
      url,
      businessType,
      conversionGoal,
      targetCustomer
    },
    pageData: sanitizeForPrompt(pageData)
  };

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Audit this landing page using the exact scoring engine and return only valid JSON.\n\n${JSON.stringify(userPayload, null, 2)}`
      }
    ]
  });

  const responseText = response?.content?.[0]?.text || '';
  const parsedResult = extractJsonFromClaudeText(responseText);
  const normalizedResult = validateAuditResultShape(parsedResult);

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO landing_page_audits (
      store,
      url,
      business_type,
      conversion_goal,
      target_customer,
      score,
      grade,
      result_json,
      desktop_screenshot,
      mobile_screenshot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertResult = insert.run(
    store,
    url,
    businessType,
    conversionGoal,
    targetCustomer,
    normalizedResult.overall.score,
    normalizedResult.overall.grade,
    JSON.stringify(normalizedResult),
    pageData?.screenshots?.desktopBase64 || null,
    pageData?.screenshots?.mobileBase64 || null
  );

  return {
    id: insertResult.lastInsertRowid,
    ...normalizedResult
  };
}

export default {
  runLandingPageAudit
};
