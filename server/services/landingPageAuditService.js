import Anthropic from '@anthropic-ai/sdk';

import { getDb } from '../db/database.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_MAX_TOKENS = 16384;
const GEMINI_MAX_TOKENS = 16384;
const MAX_PROMPT_HTML_CHARS = 60_000;
const MAX_PROMPT_TEXT_CHARS = 30_000;
const MAX_FINDINGS_PER_DIMENSION = 20;
const VALID_GRADES = new Set(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']);
const REQUIRED_DIMENSION_NAMES = ['First Impression', 'Copy & Messaging', 'Call-to-Action', 'Trust & Proof', 'Mobile & Access', 'Performance'];

/* ── Model registry with estimated cost per audit ── */
const MODEL_REGISTRY = {
  'claude-sonnet-4-6': { provider: 'anthropic', model: 'claude-sonnet-4-6', estimatedCost: '$0.05' },
  'gemini-2.5-flash': { provider: 'google', model: 'gemini-2.5-flash', estimatedCost: '$0.01' },
  'gemini-2.5-pro': { provider: 'google', model: 'gemini-2.5-pro', estimatedCost: '$0.02' },
  'gemini-2.0-flash': { provider: 'google', model: 'gemini-2.0-flash', estimatedCost: '$0.005' }
};
const VALID_MODEL_IDS = new Set(Object.keys(MODEL_REGISTRY));

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

/**
 * Strip common LLM JSON artifacts that make otherwise-valid JSON unparseable.
 * Handles: trailing commas, single-line // comments, single-quoted strings,
 * and unescaped control characters inside string values.
 * Operates with string-boundary awareness to avoid corrupting real content.
 */
function sanitizeLlmJson(jsonText) {
  /*
   * Phase 1 – Replace single-quoted strings with double-quoted strings and
   *           remove single-line // comments.  Both require tracking whether
   *           we are inside a string literal.
   */
  let phase1 = '';
  let inDouble = false;   // inside a "-delimited string
  let inSingle = false;   // inside a '-delimited string
  let escaped = false;

  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i];

    if (escaped) { escaped = false; phase1 += ch; continue; }

    /* Backslash inside any string → next char is escaped. */
    if ((inDouble || inSingle) && ch === '\\') { escaped = true; phase1 += ch; continue; }

    /* Toggle double-quote strings (only when NOT in single-quote string). */
    if (ch === '"' && !inSingle) { inDouble = !inDouble; phase1 += ch; continue; }

    /* Convert single-quoted strings → double-quoted (only outside double strings). */
    if (ch === "'" && !inDouble) {
      if (!inSingle) {
        /* opening single quote → emit double quote instead */
        inSingle = true;
        phase1 += '"';
        continue;
      }
      /* closing single quote → emit double quote instead */
      inSingle = false;
      phase1 += '"';
      continue;
    }

    /* If inside a single-quoted string and we see an unescaped double quote,
       escape it so the converted string stays valid. */
    if (inSingle && ch === '"') { phase1 += '\\"'; continue; }

    /* Strip // comments outside strings. */
    if (!inDouble && !inSingle && ch === '/' && i + 1 < jsonText.length && jsonText[i + 1] === '/') {
      while (i < jsonText.length && jsonText[i] !== '\n') i++;
      continue;
    }

    phase1 += ch;
  }

  /* Phase 2 – strip trailing commas before ] or } (with optional whitespace). */
  let sanitized = phase1.replace(/,\s*([}\]])/g, '$1');

  /*
   * Phase 3 – escape unescaped control characters inside JSON string values.
   * Literal newlines / tabs inside strings are invalid JSON; replace them with
   * their escape sequences.  We avoid negative lookbehind for broader runtime
   * compatibility and instead use a replacement function that checks context.
   */
  sanitized = sanitized.replace(/"(?:[^"\\]|\\.)*"/g, (match) =>
    match.replace(/[\t\n\r]/g, (ctrl) => {
      if (ctrl === '\t') return '\\t';
      if (ctrl === '\n') return '\\n';
      return '\\r';
    })
  );

  return sanitized;
}

/**
 * Attempt to repair JSON that was truncated mid-stream (e.g. the LLM hit its
 * max-output-token limit).  Walks the text tracking open delimiters and then
 * appends the closing counterparts so `JSON.parse` can succeed.
 *
 * This is intentionally best-effort: it will produce a parseable (but
 * potentially incomplete) object, which `validateAuditResultShape` will then
 * normalise with safe defaults for any missing fields.
 */
function repairTruncatedJson(jsonText) {
  const stack = [];          // tracks open delimiters: '"', '{', '['
  let inString = false;
  let escaped = false;
  let lastSignificantChar = '';  // last non-whitespace char outside strings

  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i];

    if (escaped) { escaped = false; continue; }

    if (inString) {
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = false; stack.pop(); continue; }
      continue;
    }

    /* Outside strings */
    if (ch === '"') { inString = true; stack.push('"'); continue; }
    if (ch === '{') { stack.push('{'); }
    if (ch === '[') { stack.push('['); }
    if (ch === '}') { if (stack.length && stack[stack.length - 1] === '{') stack.pop(); }
    if (ch === ']') { if (stack.length && stack[stack.length - 1] === '[') stack.pop(); }

    if (!/\s/.test(ch)) lastSignificantChar = ch;
  }

  /* Nothing to repair – JSON is already balanced. */
  if (stack.length === 0) return jsonText;

  let repaired = jsonText;

  /* Close structures in reverse order. */
  for (let i = stack.length - 1; i >= 0; i--) {
    const open = stack[i];
    if (open === '"') {
      /* Truncated inside a string value – close the string. */
      repaired += '"';
    } else if (open === '{') {
      /* If the last significant char was ':' we need a placeholder value. */
      const trimmed = repaired.trimEnd();
      const lastChar = trimmed[trimmed.length - 1];
      if (lastChar === ':') repaired += '""';
      /* Remove a dangling comma before closing. */
      repaired = repaired.replace(/,\s*$/, '');
      repaired += '}';
    } else if (open === '[') {
      repaired = repaired.replace(/,\s*$/, '');
      repaired += ']';
    }
  }

  return repaired;
}

function extractJsonFromClaudeText(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw new Error('Claude returned an empty response.');
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  /* First try strict parse, then sanitized, then brace-extraction. */
  try {
    return JSON.parse(candidate);
  } catch {
    /* noop – try sanitized */
  }

  const cleaned = sanitizeLlmJson(candidate);
  try {
    return JSON.parse(cleaned);
  } catch {
    /* noop – try brace extraction */
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
      /* noop – try truncation repair */
    }
  }

  /*
   * Last resort: the JSON is likely truncated (LLM hit max-output-tokens).
   * Try to close all open delimiters so JSON.parse can succeed.  The result
   * will be incomplete but validateAuditResultShape will fill in safe defaults.
   */
  const basis = firstBrace >= 0 ? cleaned.slice(firstBrace) : cleaned;
  const repaired = repairTruncatedJson(basis);
  try {
    console.warn('[extractJsonFromClaudeText] used truncation repair – result may be incomplete');
    const parsed = JSON.parse(repaired);
    parsed._truncated = true;
    return parsed;
  } catch (repairError) {
    const posMatch = repairError.message.match(/position (\d+)/);
    const errorPos = posMatch ? Number(posMatch[1]) : 0;
    const snippet = repaired.slice(Math.max(0, errorPos - 80), errorPos + 80);
    console.error('[extractJsonFromClaudeText] truncation repair failed near:', snippet);
    throw new Error(`Failed to parse model JSON after sanitization and repair: ${repairError.message}`);
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
    },
    truncated: Boolean(result?._truncated)
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

/* ── Provider-specific call helpers ── */
async function callAnthropic(systemPrompt, userMessage, modelId) {
  const anthropic = requireAnthropicClient();
  const response = await anthropic.messages.create({
    model: modelId || CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  return response?.content?.[0]?.text || '';
}

async function callGemini(systemPrompt, userMessage, modelId) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Set it in your environment to use Gemini models.');
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: {
        maxOutputTokens: GEMINI_MAX_TOKENS,
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error (HTTP ${response.status}): ${errorBody.slice(0, 300)}`);
  }

  const result = await response.json();
  return result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

export async function runLandingPageAudit({
  store,
  url,
  businessType,
  conversionGoal,
  targetCustomer,
  pageData,
  model: requestedModel
}) {
  const modelId = VALID_MODEL_IDS.has(requestedModel) ? requestedModel : CLAUDE_MODEL;
  const modelEntry = MODEL_REGISTRY[modelId];
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

  const userMessage = `Audit this landing page using the exact scoring engine and return only valid JSON.\n\n${JSON.stringify(userPayload, null, 2)}`;

  let responseText;
  if (modelEntry.provider === 'google') {
    responseText = await callGemini(systemPrompt, userMessage, modelEntry.model);
  } else {
    responseText = await callAnthropic(systemPrompt, userMessage, modelEntry.model);
  }

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
    modelUsed: modelId,
    estimatedCost: modelEntry.estimatedCost,
    ...normalizedResult
  };
}

export { VALID_MODEL_IDS };

export default {
  runLandingPageAudit,
  VALID_MODEL_IDS
};
