import OpenAI from 'openai';
import { askDeepSeekChat, normalizeTemperature } from './deepseekService.js';

const NARRATIVE_TUNABLES = {
  defaultProviderOrder: ['deepseek', 'openai'],
  defaultModels: {
    deepseek: 'deepseek-reasoner',
    openai: 'gpt-4o-mini'
  },
  temperature: 0.25,
  maxOutputTokens: 2400,
  maxFindings: 5,
  maxVisualsInPrompt: 2
};

const MODEL_PRIMER = {
  decision_friction: 'Uses Bayesian log-odds to combine attention, comprehension, belief, action, and risk frictions into conversion drag probability.',
  message_intent_alignment: 'Compares traffic intent and on-page narrative continuity, then scores funnel-stage fit using calibrated Bayesian feature weights.',
  proof_architecture: 'Measures claim-to-evidence balance, mechanism clarity, specificity, and objection coverage to estimate credibility drag.',
  choice_architecture: 'Quantifies choice overload and path ambiguity through CTA competition, branching complexity, sequencing, and form friction.',
  anxiety_risk_reversal: 'Models unresolved fear, guarantee specificity, and price-risk uncertainty to estimate hesitation probability near action points.'
};

const PROVIDER_OPTIONS = new Set(['auto', 'deepseek', 'openai', 'none']);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseJsonLoose(text) {
  if (!text) return null;
  const raw = String(text).trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function toCleanString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const next = value.replace(/\s+/g, ' ').trim();
  return next || fallback;
}

function resolveProvider(llmInput = {}) {
  const requestedProviderRaw = String(llmInput?.provider || 'auto').trim().toLowerCase();
  const requestedProvider = PROVIDER_OPTIONS.has(requestedProviderRaw) ? requestedProviderRaw : 'auto';
  const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

  if (requestedProvider === 'none') {
    return { enabled: false, provider: 'none', model: null, reason: 'Narrative disabled by request.' };
  }

  if (requestedProvider === 'deepseek') {
    if (hasDeepSeek) {
      return {
        enabled: true,
        provider: 'deepseek',
        model: toCleanString(llmInput?.model, NARRATIVE_TUNABLES.defaultModels.deepseek)
      };
    }
    if (hasOpenAI) {
      return {
        enabled: true,
        provider: 'openai',
        model: NARRATIVE_TUNABLES.defaultModels.openai,
        reason: 'DeepSeek unavailable; OpenAI fallback selected.'
      };
    }
    return { enabled: false, provider: 'none', model: null, reason: 'No LLM API keys configured.' };
  }

  if (requestedProvider === 'openai') {
    if (hasOpenAI) {
      return {
        enabled: true,
        provider: 'openai',
        model: toCleanString(llmInput?.model, NARRATIVE_TUNABLES.defaultModels.openai)
      };
    }
    if (hasDeepSeek) {
      return {
        enabled: true,
        provider: 'deepseek',
        model: NARRATIVE_TUNABLES.defaultModels.deepseek,
        reason: 'OpenAI unavailable; DeepSeek fallback selected.'
      };
    }
    return { enabled: false, provider: 'none', model: null, reason: 'No LLM API keys configured.' };
  }

  for (const provider of NARRATIVE_TUNABLES.defaultProviderOrder) {
    if (provider === 'deepseek' && hasDeepSeek) {
      return { enabled: true, provider: 'deepseek', model: NARRATIVE_TUNABLES.defaultModels.deepseek };
    }
    if (provider === 'openai' && hasOpenAI) {
      return { enabled: true, provider: 'openai', model: NARRATIVE_TUNABLES.defaultModels.openai };
    }
  }

  return { enabled: false, provider: 'none', model: null, reason: 'No LLM API keys configured.' };
}

function buildVisualManifest(screenshots) {
  const items = [];
  const push = (id, item) => {
    if (!item?.base64) return;
    items.push({
      id,
      mimeType: item.mimeType || 'image/jpeg',
      widthPx: item.widthPx || null,
      heightPx: item.heightPx || null,
      label: item.label || id
    });
  };
  push('desktop_hero', screenshots?.desktopHero);
  push('mobile_hero', screenshots?.mobileHero);
  push('desktop_full', screenshots?.desktopFull);
  return items;
}

function buildPromptPayload({ audit, googlePerformance, screenshots }) {
  const modelPrimer = (audit?.models || []).map((model) => ({
    model_id: model.id,
    model_label: model.label,
    how_model_works: MODEL_PRIMER[model.id] || 'Bayesian conversion-drag model with evidence-weighted feature contributions.'
  }));

  const findings = (audit?.findings || []).slice(0, NARRATIVE_TUNABLES.maxFindings).map((finding, index) => ({
    evidence_id: `F${index + 1}`,
    model_id: finding.modelId,
    model_label: finding.modelLabel,
    severity: finding.severity,
    label: finding.label,
    risk: finding.risk,
    evidence: finding.evidence,
    score_impact: finding.scoreImpact
  }));

  const modelSignals = (audit?.models || []).map((model) => ({
    model_id: model.id,
    label: model.label,
    adjusted_score: model.adjustedScore,
    drag_probability: model.dragProbability,
    confidence: model.confidence,
    dominant_risks: (model?.dominantRisks || []).map((risk) => ({
      key: risk.key,
      label: risk.label,
      risk: risk.risk,
      evidence: risk.evidence
    }))
  }));

  return {
    audit_summary: {
      overall_score: audit?.summary?.overallScore ?? null,
      overall_confidence: audit?.summary?.overallConfidence ?? null,
      status: audit?.summary?.status ?? null,
      tone: audit?.summary?.tone ?? null
    },
    model_primer: modelPrimer,
    model_signals: modelSignals,
    top_findings: findings,
    google_performance: googlePerformance || null,
    visual_manifest: buildVisualManifest(screenshots)
  };
}

function buildPromptText(payload) {
  return [
    'You are a senior CRO forensic analyst writing for a growth and product team.',
    'Requirements:',
    '- Be concrete and causal, not generic.',
    '- Every finding must cite specific observed evidence from the provided payload.',
    '- Explain behavioral mechanism with clear cause -> effect language.',
    '- Make model logic transparent by referencing the model_primer for each model.',
    '- Keep language decisive and operational.',
    'Return strict JSON only with this schema:',
    '{',
    '  "executive_summary": "string",',
    '  "forensic_findings": [',
    '    {',
    '      "title": "string",',
    '      "model_id": "string",',
    '      "observed_evidence": "string",',
    '      "behavioral_mechanism": "string",',
    '      "business_impact": "string",',
    '      "recommended_test": "string",',
    '      "evidence_refs": ["F1"]',
    '    }',
    '  ],',
    '  "model_walkthrough": [',
    '    {',
    '      "model_id": "string",',
    '      "how_model_works": "string",',
    '      "what_detected_here": "string"',
    '    }',
    '  ],',
    '  "priority_actions": [',
    '    {',
    '      "title": "string",',
    '      "why_now": "string",',
    '      "expected_behavioral_effect": "string"',
    '    }',
    '  ],',
    '  "caveats": ["string"]',
    '}',
    'Payload:',
    JSON.stringify(payload)
  ].join('\n');
}

function buildDeterministicFallback({ audit, provider, model, reason, payload, screenshotContextUsed }) {
  const topFinding = (audit?.findings || [])[0];
  const modelWalkthrough = (audit?.models || []).map((item) => ({
    model_id: item.id,
    how_model_works: MODEL_PRIMER[item.id] || 'Bayesian weighted drag model.',
    what_detected_here: `${item.label} score ${item.adjustedScore}/100 with drag probability ${item.dragProbability}.`
  }));

  const findings = (audit?.findings || []).slice(0, NARRATIVE_TUNABLES.maxFindings).map((finding, index) => ({
    title: finding.label,
    model_id: finding.modelId,
    observed_evidence: finding.evidence,
    behavioral_mechanism: `${finding.label} creates measurable conversion drag because decision effort increases before commitment.`,
    business_impact: `Estimated score impact ${finding.scoreImpact}.`,
    recommended_test: `Run an A/B test targeting ${finding.label} with one focused UI and copy intervention.`,
    evidence_refs: [`F${index + 1}`]
  }));

  return {
    enabled: true,
    provider,
    model,
    generatedAt: new Date().toISOString(),
    parseMode: 'deterministic-fallback',
    screenshotContextUsed,
    reason: reason || 'LLM response was unavailable or invalid JSON.',
    sections: {
      executiveSummary: topFinding
        ? `Primary friction is ${topFinding.label}. Evidence indicates the current page structure is increasing decision drag before action.`
        : 'No dominant friction was detected from the available evidence.',
      forensicFindings: findings,
      modelWalkthrough,
      priorityActions: (audit?.experiments || []).slice(0, 3).map((experiment) => ({
        title: experiment.title,
        whyNow: experiment.hypothesis,
        expectedBehavioralEffect: `Expected lift ${experiment.expectedLiftPct} on ${experiment.targetMetric}.`
      })),
      caveats: [
        'Narrative fallback was generated without valid structured LLM output.',
        ...(payload?.google_performance?.errors || []).map((error) => `${error.strategy} performance data unavailable: ${error.message}`)
      ]
    }
  };
}

function normalizeNarrativeOutput(parsed, audit) {
  const sections = {
    executiveSummary: toCleanString(parsed?.executive_summary, 'No executive summary generated.'),
    forensicFindings: Array.isArray(parsed?.forensic_findings)
      ? parsed.forensic_findings
        .map((item) => ({
          title: toCleanString(item?.title, 'Untitled finding'),
          modelId: toCleanString(item?.model_id, 'unknown'),
          observedEvidence: toCleanString(item?.observed_evidence, 'No evidence provided.'),
          behavioralMechanism: toCleanString(item?.behavioral_mechanism, 'No mechanism explanation provided.'),
          businessImpact: toCleanString(item?.business_impact, 'No business impact provided.'),
          recommendedTest: toCleanString(item?.recommended_test, 'No test recommendation provided.'),
          evidenceRefs: Array.isArray(item?.evidence_refs)
            ? item.evidence_refs.map((ref) => toCleanString(ref)).filter(Boolean)
            : []
        }))
        .filter((item) => item.title)
      : [],
    modelWalkthrough: Array.isArray(parsed?.model_walkthrough)
      ? parsed.model_walkthrough
        .map((item) => ({
          modelId: toCleanString(item?.model_id, 'unknown'),
          howModelWorks: toCleanString(item?.how_model_works, ''),
          whatDetectedHere: toCleanString(item?.what_detected_here, '')
        }))
        .filter((item) => item.modelId)
      : [],
    priorityActions: Array.isArray(parsed?.priority_actions)
      ? parsed.priority_actions
        .map((item) => ({
          title: toCleanString(item?.title, 'Untitled action'),
          whyNow: toCleanString(item?.why_now, ''),
          expectedBehavioralEffect: toCleanString(item?.expected_behavioral_effect, '')
        }))
      : [],
    caveats: Array.isArray(parsed?.caveats)
      ? parsed.caveats.map((value) => toCleanString(value)).filter(Boolean)
      : []
  };

  if (!sections.modelWalkthrough.length) {
    sections.modelWalkthrough = (audit?.models || []).map((item) => ({
      modelId: item.id,
      howModelWorks: MODEL_PRIMER[item.id] || 'Bayesian weighted drag model.',
      whatDetectedHere: `${item.label} adjusted score ${item.adjustedScore}/100.`
    }));
  }

  return sections;
}

function pickPromptScreenshots(screenshots) {
  const pool = [screenshots?.desktopHero, screenshots?.mobileHero, screenshots?.desktopFull]
    .filter((item) => item?.base64);
  return pool.slice(0, NARRATIVE_TUNABLES.maxVisualsInPrompt);
}

async function requestOpenAiNarrative({ model, prompt, promptScreenshots }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const userContent = [{ type: 'input_text', text: prompt }];
  promptScreenshots.forEach((shot) => {
    userContent.push({
      type: 'input_image',
      image_url: `data:${shot.mimeType || 'image/jpeg'};base64,${shot.base64}`
    });
  });

  const response = await client.responses.create({
    model,
    temperature: NARRATIVE_TUNABLES.temperature,
    max_output_tokens: NARRATIVE_TUNABLES.maxOutputTokens,
    input: [
      {
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: 'You are a CRO analyst. Follow user schema exactly and return strict JSON only.'
          }
        ]
      },
      {
        role: 'user',
        content: userContent
      }
    ]
  });

  return response?.output_text || '';
}

async function requestDeepSeekNarrative({ model, prompt, temperature }) {
  const result = await askDeepSeekChat({
    model,
    systemPrompt: 'You are a CRO analyst. Return strict JSON only that matches the requested schema.',
    messages: [{ role: 'user', content: prompt }],
    maxOutputTokens: NARRATIVE_TUNABLES.maxOutputTokens,
    temperature
  });
  return result?.text || '';
}

export async function generateCroNarrative({
  audit,
  googlePerformance,
  screenshots,
  llmInput = {}
}) {
  const resolved = resolveProvider(llmInput);
  const payload = buildPromptPayload({
    audit,
    googlePerformance,
    screenshots
  });
  const promptScreenshots = pickPromptScreenshots(screenshots);
  const screenshotContextUsed = resolved.provider === 'openai' && promptScreenshots.length > 0;

  if (!resolved.enabled) {
    return {
      enabled: false,
      provider: resolved.provider,
      model: resolved.model,
      reason: resolved.reason || 'Narrative disabled.',
      screenshotContextUsed,
      sections: null
    };
  }

  const requestedTemperature = normalizeTemperature(llmInput?.temperature, NARRATIVE_TUNABLES.temperature);
  const temperature = clamp(requestedTemperature, 0, 1);
  const prompt = buildPromptText(payload);

  try {
    const llmText = resolved.provider === 'openai'
      ? await requestOpenAiNarrative({
        model: resolved.model,
        prompt,
        promptScreenshots
      })
      : await requestDeepSeekNarrative({
        model: resolved.model,
        prompt,
        temperature
      });

    const parsed = parseJsonLoose(llmText);
    if (!parsed) {
      return buildDeterministicFallback({
        audit,
        provider: resolved.provider,
        model: resolved.model,
        reason: 'LLM returned non-JSON content.',
        payload,
        screenshotContextUsed
      });
    }

    return {
      enabled: true,
      provider: resolved.provider,
      model: resolved.model,
      generatedAt: new Date().toISOString(),
      parseMode: 'llm-json',
      screenshotContextUsed,
      reason: resolved.reason || null,
      sections: normalizeNarrativeOutput(parsed, audit)
    };
  } catch (error) {
    return buildDeterministicFallback({
      audit,
      provider: resolved.provider,
      model: resolved.model,
      reason: error?.message || 'LLM request failed.',
      payload,
      screenshotContextUsed
    });
  }
}
