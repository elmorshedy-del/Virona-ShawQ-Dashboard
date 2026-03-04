import { getDb } from '../../db/database.js';
import { askOpenAIChat } from '../openaiService.js';
import { askDeepSeekChat } from '../deepseekService.js';
import {
  BRIEF_DEFAULT_SETTINGS,
  BRIEF_MODEL_CATALOG,
  BRIEF_PROMPT_CONFIG,
  BRIEF_SCHEDULE_MODES,
  DEFAULT_SETTINGS,
  SUPPORTED_LEVELS,
  SUPPORTED_STORES
} from './constants.js';
import { round } from './utils.js';

const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';
const DEEPSEEK_API_KEY_ENV = 'DEEPSEEK_API_KEY';
const BRIEF_SOURCE_MANUAL = 'manual';
const BRIEF_SOURCE_DAILY = 'daily';
const EMPTY_ENTITY_SCOPE_VALUE = 'all';
const ALL_COUNTRIES_SCOPE_VALUE = 'ALL';
const JSON_CODE_BLOCK_PATTERN = /```json\s*([\s\S]*?)```/i;
const RAW_OUTPUT_SNIPPET_MAX_CHARS = 600;

function hasConfiguredEnvKey(envName) {
  const value = process.env[envName];
  return typeof value === 'string' && value.trim().length > 0;
}

function getProviderAvailability() {
  return {
    openai: hasConfiguredEnvKey(OPENAI_API_KEY_ENV),
    deepseek: hasConfiguredEnvKey(DEEPSEEK_API_KEY_ENV)
  };
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function estimateTokenCount(text) {
  const normalized = String(text || '');
  if (!normalized) return 0;
  const charsPerToken = Math.max(1, Number(BRIEF_PROMPT_CONFIG.estimatedCharsPerToken) || 4);
  return Math.max(1, Math.ceil(normalized.length / charsPerToken));
}

function buildProviderModelIndex() {
  const index = new Map();
  for (const [provider, rows] of Object.entries(BRIEF_MODEL_CATALOG)) {
    for (const row of rows) {
      index.set(`${provider}:${row.model}`, row);
    }
  }
  return index;
}

const PROVIDER_MODEL_INDEX = buildProviderModelIndex();

function getDefaultScope() {
  return {
    level: DEFAULT_SETTINGS.defaultLevel,
    entityId: null,
    country: DEFAULT_SETTINGS.defaultCountry,
    startDate: null,
    endDate: null,
    anchorDays: DEFAULT_SETTINGS.anchorWindowDays,
    anchorStartDate: null,
    anchorEndDate: null
  };
}

function normalizeLevel(rawLevel) {
  const normalized = String(rawLevel || DEFAULT_SETTINGS.defaultLevel).trim().toLowerCase();
  if (!SUPPORTED_LEVELS.has(normalized)) {
    return DEFAULT_SETTINGS.defaultLevel;
  }
  return normalized;
}

function normalizeEntityId(rawEntityId) {
  if (rawEntityId == null || rawEntityId === '' || String(rawEntityId).toUpperCase() === 'ALL') {
    return null;
  }
  return String(rawEntityId).trim();
}

function normalizeCountry(rawCountry) {
  const normalized = String(rawCountry || DEFAULT_SETTINGS.defaultCountry).trim().toUpperCase();
  if (!normalized || normalized === 'ALL') return 'ALL';
  if (/^[A-Z]{2}$/.test(normalized)) return normalized;
  return DEFAULT_SETTINGS.defaultCountry;
}

function normalizeDateValue(rawValue) {
  if (rawValue == null || rawValue === '') return null;
  const value = String(rawValue).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function normalizeAnchorDays(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.anchorWindowDays;
  const lowerBound = QUERY_LIMITS.minAnchorWindowDays;
  const upperBound = QUERY_LIMITS.maxAnchorWindowDays;
  return Math.min(upperBound, Math.max(lowerBound, parsed));
}

function normalizeScheduleMode(rawMode) {
  const normalized = String(rawMode || BRIEF_DEFAULT_SETTINGS.scheduleMode).trim().toLowerCase();
  if (normalized === BRIEF_SCHEDULE_MODES.daily) return BRIEF_SCHEDULE_MODES.daily;
  return BRIEF_SCHEDULE_MODES.manual;
}

function normalizeScope(inputScope = {}) {
  const defaults = getDefaultScope();
  return {
    level: normalizeLevel(inputScope.level),
    entityId: normalizeEntityId(inputScope.entityId),
    country: normalizeCountry(inputScope.country),
    startDate: normalizeDateValue(inputScope.startDate),
    endDate: normalizeDateValue(inputScope.endDate),
    anchorDays: normalizeAnchorDays(inputScope.anchorDays),
    anchorStartDate: normalizeDateValue(inputScope.anchorStartDate),
    anchorEndDate: normalizeDateValue(inputScope.anchorEndDate),
    fallback: defaults
  };
}

function resolveModelDefinition({ provider, model, availability }) {
  const preferredProvider = String(provider || BRIEF_DEFAULT_SETTINGS.provider).trim().toLowerCase();
  const preferredModel = String(model || BRIEF_DEFAULT_SETTINGS.model).trim();

  const explicit = PROVIDER_MODEL_INDEX.get(`${preferredProvider}:${preferredModel}`);
  if (explicit && availability[preferredProvider]) {
    return explicit;
  }

  if (availability.openai) {
    return BRIEF_MODEL_CATALOG.openai[0];
  }

  if (availability.deepseek) {
    return BRIEF_MODEL_CATALOG.deepseek[0];
  }

  return null;
}

function buildDefaultSettings(store) {
  const normalizedStore = String(store || '').trim().toLowerCase();
  return {
    store: normalizedStore,
    scheduleMode: BRIEF_DEFAULT_SETTINGS.scheduleMode,
    provider: BRIEF_DEFAULT_SETTINGS.provider,
    model: BRIEF_DEFAULT_SETTINGS.model,
    reasoningEffort: BRIEF_DEFAULT_SETTINGS.reasoningEffort,
    verbosity: BRIEF_DEFAULT_SETTINGS.verbosity,
    scope: getDefaultScope()
  };
}

function ensureSupportedStore(store) {
  const normalized = String(store || '').trim().toLowerCase();
  if (!SUPPORTED_STORES.has(normalized)) {
    const error = new Error('Unsupported store for campaign intelligence brief');
    error.status = 400;
    throw error;
  }
  return normalized;
}

export function buildCampaignIntelligenceBriefScopeKey({ level, entityId, country }) {
  const normalizedLevel = normalizeLevel(level);
  const normalizedEntityId = normalizeEntityId(entityId);
  const normalizedCountry = normalizeCountry(country);

  return [
    `level:${normalizedLevel}`,
    `entity:${normalizedEntityId || EMPTY_ENTITY_SCOPE_VALUE}`,
    `country:${normalizedCountry || ALL_COUNTRIES_SCOPE_VALUE}`
  ].join('|');
}

export function getCampaignIntelligenceBriefModelOptions() {
  const availability = getProviderAvailability();

  return Object.entries(BRIEF_MODEL_CATALOG)
    .flatMap(([provider, models]) => models.map((modelDef) => ({
      ...modelDef,
      enabled: Boolean(availability[provider])
    })));
}

export function getCampaignIntelligenceBriefSettings(store) {
  const normalizedStore = ensureSupportedStore(store);
  const db = getDb();

  const row = db.prepare(`
    SELECT
      schedule_mode as scheduleMode,
      provider,
      model,
      reasoning_effort as reasoningEffort,
      verbosity,
      scope_level as scopeLevel,
      scope_entity_id as scopeEntityId,
      scope_country as scopeCountry,
      scope_start_date as scopeStartDate,
      scope_end_date as scopeEndDate,
      scope_anchor_days as scopeAnchorDays,
      scope_anchor_start_date as scopeAnchorStartDate,
      scope_anchor_end_date as scopeAnchorEndDate,
      updated_at as updatedAt
    FROM campaign_intelligence_brief_settings
    WHERE store = ?
    LIMIT 1
  `).get(normalizedStore);

  const defaults = buildDefaultSettings(normalizedStore);
  if (!row) {
    return {
      ...defaults,
      updatedAt: null
    };
  }

  return {
    ...defaults,
    scheduleMode: normalizeScheduleMode(row.scheduleMode),
    provider: String(row.provider || defaults.provider).trim().toLowerCase(),
    model: String(row.model || defaults.model).trim(),
    reasoningEffort: String(row.reasoningEffort || defaults.reasoningEffort).trim().toLowerCase(),
    verbosity: String(row.verbosity || defaults.verbosity).trim().toLowerCase(),
    scope: {
      level: normalizeLevel(row.scopeLevel),
      entityId: normalizeEntityId(row.scopeEntityId),
      country: normalizeCountry(row.scopeCountry),
      startDate: normalizeDateValue(row.scopeStartDate),
      endDate: normalizeDateValue(row.scopeEndDate),
      anchorDays: normalizeAnchorDays(row.scopeAnchorDays),
      anchorStartDate: normalizeDateValue(row.scopeAnchorStartDate),
      anchorEndDate: normalizeDateValue(row.scopeAnchorEndDate)
    },
    updatedAt: row.updatedAt || null
  };
}

export function updateCampaignIntelligenceBriefSettings(store, updates = {}) {
  const normalizedStore = ensureSupportedStore(store);
  const db = getDb();

  const existing = getCampaignIntelligenceBriefSettings(normalizedStore);
  const normalizedScope = normalizeScope({
    ...existing.scope,
    ...(updates.scope || {})
  });

  const nextSettings = {
    ...existing,
    scheduleMode: normalizeScheduleMode(updates.scheduleMode ?? existing.scheduleMode),
    provider: String(updates.provider ?? existing.provider).trim().toLowerCase(),
    model: String(updates.model ?? existing.model).trim(),
    reasoningEffort: String(updates.reasoningEffort ?? existing.reasoningEffort).trim().toLowerCase(),
    verbosity: String(updates.verbosity ?? existing.verbosity).trim().toLowerCase(),
    scope: {
      level: normalizedScope.level,
      entityId: normalizedScope.entityId,
      country: normalizedScope.country,
      startDate: normalizedScope.startDate,
      endDate: normalizedScope.endDate,
      anchorDays: normalizedScope.anchorDays,
      anchorStartDate: normalizedScope.anchorStartDate,
      anchorEndDate: normalizedScope.anchorEndDate
    }
  };

  const availability = getProviderAvailability();
  const modelDef = resolveModelDefinition({
    provider: nextSettings.provider,
    model: nextSettings.model,
    availability
  });

  if (!modelDef) {
    const error = new Error('No configured LLM provider available for campaign intelligence brief');
    error.status = 503;
    throw error;
  }

  nextSettings.provider = modelDef.provider;
  nextSettings.model = modelDef.model;
  nextSettings.reasoningEffort = nextSettings.reasoningEffort || modelDef.defaultReasoningEffort;
  nextSettings.verbosity = nextSettings.verbosity || modelDef.defaultVerbosity;

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO campaign_intelligence_brief_settings (
      store,
      schedule_mode,
      provider,
      model,
      reasoning_effort,
      verbosity,
      scope_level,
      scope_entity_id,
      scope_country,
      scope_start_date,
      scope_end_date,
      scope_anchor_days,
      scope_anchor_start_date,
      scope_anchor_end_date,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store)
    DO UPDATE SET
      schedule_mode = excluded.schedule_mode,
      provider = excluded.provider,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      verbosity = excluded.verbosity,
      scope_level = excluded.scope_level,
      scope_entity_id = excluded.scope_entity_id,
      scope_country = excluded.scope_country,
      scope_start_date = excluded.scope_start_date,
      scope_end_date = excluded.scope_end_date,
      scope_anchor_days = excluded.scope_anchor_days,
      scope_anchor_start_date = excluded.scope_anchor_start_date,
      scope_anchor_end_date = excluded.scope_anchor_end_date,
      updated_at = excluded.updated_at
  `).run(
    normalizedStore,
    nextSettings.scheduleMode,
    nextSettings.provider,
    nextSettings.model,
    nextSettings.reasoningEffort,
    nextSettings.verbosity,
    nextSettings.scope.level,
    nextSettings.scope.entityId,
    nextSettings.scope.country,
    nextSettings.scope.startDate,
    nextSettings.scope.endDate,
    nextSettings.scope.anchorDays,
    nextSettings.scope.anchorStartDate,
    nextSettings.scope.anchorEndDate,
    now
  );

  return {
    ...nextSettings,
    updatedAt: now
  };
}

function normalizeBriefSource(rawSource) {
  const normalized = String(rawSource || BRIEF_SOURCE_MANUAL).trim().toLowerCase();
  return normalized === BRIEF_SOURCE_DAILY ? BRIEF_SOURCE_DAILY : BRIEF_SOURCE_MANUAL;
}

export function getLatestCampaignIntelligenceBrief({ store, scopeKey }) {
  const normalizedStore = ensureSupportedStore(store);
  if (!scopeKey) return null;

  const db = getDb();
  const row = db.prepare(`
    SELECT
      id,
      brief_date as briefDate,
      source,
      provider,
      model,
      estimated_input_tokens as estimatedInputTokens,
      estimated_output_tokens as estimatedOutputTokens,
      estimated_cost_usd as estimatedCostUsd,
      brief_json as briefJson,
      created_at as createdAt
    FROM campaign_intelligence_llm_briefs
    WHERE store = ?
      AND scope_key = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).get(normalizedStore, scopeKey);

  if (!row) return null;

  return {
    id: row.id,
    briefDate: row.briefDate,
    source: row.source,
    provider: row.provider,
    model: row.model,
    estimatedInputTokens: Math.max(0, Math.round(toFiniteNumber(row.estimatedInputTokens))),
    estimatedOutputTokens: Math.max(0, Math.round(toFiniteNumber(row.estimatedOutputTokens))),
    estimatedCostUsd: round(toFiniteNumber(row.estimatedCostUsd), 6),
    report: parseJsonSafe(row.briefJson),
    createdAt: row.createdAt
  };
}

function parseJsonSafe(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function buildCompactHierarchyRows(rows = []) {
  return rows
    .slice(0, BRIEF_PROMPT_CONFIG.maxHierarchyRows)
    .map((row) => ({
      level: row.levelLabel,
      name: row.name,
      entityId: row.entityId,
      campaignName: row.campaignName,
      adsetName: row.adsetName,
      spend: toFiniteNumber(row?.metrics?.now?.spend),
      roas: toFiniteNumber(row?.metrics?.now?.roas),
      cpm: toFiniteNumber(row?.metrics?.now?.cpm),
      ctr: toFiniteNumber(row?.metrics?.now?.ctr),
      purchaseIc: toFiniteNumber(row?.metrics?.now?.purchaseIc),
      costAtc: toFiniteNumber(row?.metrics?.now?.costAtc),
      baseline: {
        roas: toFiniteNumber(row?.metrics?.baseline?.roas),
        cpm: toFiniteNumber(row?.metrics?.baseline?.cpm),
        ctr: toFiniteNumber(row?.metrics?.baseline?.ctr),
        purchaseIc: toFiniteNumber(row?.metrics?.baseline?.purchaseIc),
        costAtc: toFiniteNumber(row?.metrics?.baseline?.costAtc)
      }
    }));
}

function buildModelSignals(model = null) {
  if (!model || !Array.isArray(model.signals)) return [];
  return model.signals
    .slice(0, BRIEF_PROMPT_CONFIG.maxSignalRowsPerModel)
    .map((signal) => ({
      label: signal.label,
      baselineValue: toFiniteNumber(signal.baselineValue),
      currentValue: toFiniteNumber(signal.currentValue),
      deltaPercent: toFiniteNumber(signal.deltaPercent),
      thresholdPercent: toFiniteNumber(signal.thresholdPercent),
      source: signal.source || 'unknown',
      weightedImpact: toFiniteNumber(signal.weightedImpact)
    }));
}

function buildBriefPromptPayload(snapshot) {
  const summary = snapshot?.summary || {};
  const analysis = summary.analysis || {};
  const anchor = summary.anchor || {};
  const hasModels = Boolean(snapshot?.models);
  const hasBudgetMonitor = Boolean(snapshot?.budgetMonitor);

  const payload = {
    scope: snapshot?.scope || null,
    analysisSummary: {
      totals: analysis.totals || {},
      rates: analysis.rates || {}
    },
    anchorSummary: {
      totals: anchor.totals || {},
      rates: anchor.rates || {}
    },
    lifecycle: snapshot?.selectors?.lifecycle || null,
    hierarchyRows: buildCompactHierarchyRows(snapshot?.hierarchy?.rows || [])
  };

  if (hasModels) {
    payload.topDrivers = Array.isArray(snapshot?.models?.topDrivers)
      ? snapshot.models.topDrivers.slice(0, BRIEF_PROMPT_CONFIG.maxTopDrivers)
      : [];
    payload.modelReadouts = {
      sentinel: {
        status: snapshot?.models?.sentinel?.status || null,
        summary: snapshot?.models?.sentinel?.summary || '',
        riskScore: toFiniteNumber(snapshot?.models?.sentinel?.riskScore),
        confidence: toFiniteNumber(snapshot?.models?.sentinel?.confidence),
        signals: buildModelSignals(snapshot?.models?.sentinel)
      },
      headroom: {
        status: snapshot?.models?.headroom?.status || null,
        summary: snapshot?.models?.headroom?.summary || '',
        headroomScore: toFiniteNumber(snapshot?.models?.headroom?.headroomScore),
        suggestedPercent: toFiniteNumber(snapshot?.models?.headroom?.recommendation?.suggestedPercent),
        confidence: toFiniteNumber(snapshot?.models?.headroom?.confidence)
      },
      launchJudge: {
        status: snapshot?.models?.launchJudge?.status || null,
        summary: snapshot?.models?.launchJudge?.summary || '',
        confidence: toFiniteNumber(snapshot?.models?.launchJudge?.confidence),
        hitTargetRoas: toFiniteNumber(snapshot?.models?.launchJudge?.probabilities?.hitTargetRoas),
        hitTargetCpa: toFiniteNumber(snapshot?.models?.launchJudge?.probabilities?.hitTargetCpa)
      }
    };
  }

  if (hasBudgetMonitor) {
    payload.budgetMonitor = {
      hasEvent: Boolean(snapshot?.budgetMonitor?.hasEvent),
      latest: snapshot?.budgetMonitor?.latest || null,
      metrics: Array.isArray(snapshot?.budgetMonitor?.metrics)
        ? snapshot.budgetMonitor.metrics.slice(0, 8)
        : []
    };
  }

  return payload;
}

function buildSystemPrompt() {
  return [
    'You are a rigorous Meta campaign operations analyst.',
    'Use ONLY the provided data; do not invent metrics or causal claims.',
    'When evidence is weak, explicitly say "insufficient evidence".',
    'Return strict JSON only, no markdown, no code fences.',
    'Schema:',
    '{',
    '  "executiveSummary": "string",',
    '  "toWatch": [{"scope":"string","signal":"string","why":"string","recheck":"string"}],',
    '  "toDo": [{"priority":"P1|P2|P3","action":"string","guardrail":"string"}],',
    '  "draggers": [{"scope":"string","issue":"string","evidence":"string","impact":"high|medium|low"}],',
    '  "creativePriorities": [{"creative":"string","recommendation":"scale|hold|replace|test","reason":"string"}],',
    '  "notes": ["string"]',
    '}'
  ].join('\n');
}

function buildUserPrompt(snapshot) {
  const payload = buildBriefPromptPayload(snapshot);
  return [
    'Generate a daily operating brief from the payload below.',
    'Keep it concise and action-oriented.',
    'Avoid generic advice and tie each claim to available evidence.',
    '',
    JSON.stringify(payload)
  ].join('\n');
}

function stripCodeFence(text) {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  const codeMatch = raw.match(JSON_CODE_BLOCK_PATTERN);
  if (codeMatch?.[1]) {
    return codeMatch[1].trim();
  }
  return raw;
}

function parseBriefJson(text) {
  const normalized = stripCodeFence(text);
  try {
    return JSON.parse(normalized);
  } catch (_error) {
    const firstBrace = normalized.indexOf('{');
    const lastBrace = normalized.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const slice = normalized.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(slice);
      } catch (_innerError) {
        return null;
      }
    }
    return null;
  }
}

function coerceSummaryEmbeddedBrief(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const embedded = String(parsed.executiveSummary || '').trim();
  if (!embedded.startsWith('{') || !embedded.includes('"executiveSummary"')) {
    return parsed;
  }

  const parsedEmbedded = parseBriefJson(embedded);
  if (!parsedEmbedded || typeof parsedEmbedded !== 'object') {
    return parsed;
  }

  return {
    ...parsedEmbedded,
    ...parsed,
    executiveSummary: String(parsedEmbedded.executiveSummary || '').trim() || String(parsed.executiveSummary || '').trim(),
    toWatch: Array.isArray(parsed.toWatch) && parsed.toWatch.length ? parsed.toWatch : parsedEmbedded.toWatch,
    toDo: Array.isArray(parsed.toDo) && parsed.toDo.length ? parsed.toDo : parsedEmbedded.toDo,
    draggers: Array.isArray(parsed.draggers) && parsed.draggers.length ? parsed.draggers : parsedEmbedded.draggers,
    creativePriorities: Array.isArray(parsed.creativePriorities) && parsed.creativePriorities.length
      ? parsed.creativePriorities
      : parsedEmbedded.creativePriorities,
    notes: Array.isArray(parsed.notes) && parsed.notes.length ? parsed.notes : parsedEmbedded.notes
  };
}

function normalizeList(input, mapper) {
  if (!Array.isArray(input)) return [];
  return input.map(mapper).filter(Boolean);
}

function normalizeReportShape(parsed, fallbackText = '') {
  const report = parsed && typeof parsed === 'object' ? parsed : null;
  if (!report) {
    const raw = String(fallbackText || '').trim();
    const snippet = raw
      ? raw.slice(0, RAW_OUTPUT_SNIPPET_MAX_CHARS) + (raw.length > RAW_OUTPUT_SNIPPET_MAX_CHARS ? '…' : '')
      : '';

    return {
      executiveSummary: 'LLM returned invalid JSON. Retry generation to get a structured brief.',
      toWatch: [],
      toDo: [],
      draggers: [],
      creativePriorities: [],
      notes: snippet ? [`Raw output (truncated): ${snippet}`] : []
    };
  }

  const executiveSummary = String(report.executiveSummary || '').trim() || 'No summary was produced.';

  return {
    executiveSummary,
    toWatch: normalizeList(report.toWatch, (item) => {
      if (!item || typeof item !== 'object') return null;
      return {
        scope: String(item.scope || 'Scope').trim(),
        signal: String(item.signal || 'Signal').trim(),
        why: String(item.why || 'No explanation provided.').trim(),
        recheck: String(item.recheck || '24h').trim()
      };
    }),
    toDo: normalizeList(report.toDo, (item) => {
      if (!item || typeof item !== 'object') return null;
      const priority = String(item.priority || 'P2').trim().toUpperCase();
      return {
        priority: ['P1', 'P2', 'P3'].includes(priority) ? priority : 'P2',
        action: String(item.action || 'No action provided.').trim(),
        guardrail: String(item.guardrail || 'Use standard risk controls.').trim()
      };
    }),
    draggers: normalizeList(report.draggers, (item) => {
      if (!item || typeof item !== 'object') return null;
      const impact = String(item.impact || 'medium').trim().toLowerCase();
      return {
        scope: String(item.scope || 'Scope').trim(),
        issue: String(item.issue || 'Issue').trim(),
        evidence: String(item.evidence || 'Evidence unavailable').trim(),
        impact: ['high', 'medium', 'low'].includes(impact) ? impact : 'medium'
      };
    }),
    creativePriorities: normalizeList(report.creativePriorities, (item) => {
      if (!item || typeof item !== 'object') return null;
      const recommendation = String(item.recommendation || 'hold').trim().toLowerCase();
      return {
        creative: String(item.creative || 'Creative').trim(),
        recommendation: ['scale', 'hold', 'replace', 'test'].includes(recommendation) ? recommendation : 'hold',
        reason: String(item.reason || 'No reason provided.').trim()
      };
    }),
    notes: normalizeList(report.notes, (line) => {
      const value = String(line || '').trim();
      return value || null;
    })
  };
}

async function runProviderRequest({ provider, model, reasoningEffort, verbosity, systemPrompt, userPrompt }) {
  if (provider === 'deepseek') {
    const result = await askDeepSeekChat({
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxOutputTokens: BRIEF_PROMPT_CONFIG.maxOutputTokens,
      temperature: 0.2
    });

    return {
      text: String(result?.text || '').trim(),
      model
    };
  }

  const text = await askOpenAIChat({
    model,
    reasoningEffort,
    verbosity,
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: BRIEF_PROMPT_CONFIG.maxOutputTokens
  });

  return {
    text: String(text || '').trim(),
    model
  };
}

function estimateRunCostUsd({ modelDefinition, inputTokens, outputTokens }) {
  const inputRate = toFiniteNumber(modelDefinition?.inputUsdPerMillionTokens, 0);
  const outputRate = toFiniteNumber(modelDefinition?.outputUsdPerMillionTokens, 0);
  const inputCost = (inputTokens / 1_000_000) * inputRate;
  const outputCost = (outputTokens / 1_000_000) * outputRate;
  return round(inputCost + outputCost, 6);
}

function buildBriefDate(snapshot) {
  const scopeEndDate = String(snapshot?.scope?.analysisEndDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(scopeEndDate)) {
    return scopeEndDate;
  }
  return new Date().toISOString().slice(0, 10);
}

export function hasCampaignIntelligenceBriefForDate({ store, scopeKey, briefDate, source = BRIEF_SOURCE_DAILY }) {
  const normalizedStore = ensureSupportedStore(store);
  if (!scopeKey || !briefDate) return false;

  const normalizedSource = normalizeBriefSource(source);
  const db = getDb();
  const row = db.prepare(`
    SELECT 1
    FROM campaign_intelligence_llm_briefs
    WHERE store = ?
      AND scope_key = ?
      AND brief_date = ?
      AND source = ?
    LIMIT 1
  `).get(normalizedStore, scopeKey, briefDate, normalizedSource);

  return Boolean(row);
}

export function listCampaignIntelligenceDailyBriefStores() {
  const db = getDb();
  return db.prepare(`
    SELECT store
    FROM campaign_intelligence_brief_settings
    WHERE schedule_mode = ?
    ORDER BY store ASC
  `).all(BRIEF_SCHEDULE_MODES.daily)
    .map((row) => String(row.store || '').trim().toLowerCase())
    .filter((store) => SUPPORTED_STORES.has(store));
}

export async function generateCampaignIntelligenceBrief({
  store,
  source = BRIEF_SOURCE_MANUAL,
  scopeKey,
  snapshot,
  provider,
  model,
  reasoningEffort,
  verbosity
}) {
  const normalizedStore = ensureSupportedStore(store);
  if (!scopeKey) {
    const error = new Error('scopeKey is required to generate campaign intelligence brief');
    error.status = 400;
    throw error;
  }

  const availability = getProviderAvailability();
  const modelDefinition = resolveModelDefinition({
    provider,
    model,
    availability
  });

  if (!modelDefinition) {
    const error = new Error('No configured LLM provider is available for campaign intelligence brief generation');
    error.status = 503;
    throw error;
  }

  const resolvedReasoningEffort = String(reasoningEffort || modelDefinition.defaultReasoningEffort || BRIEF_DEFAULT_SETTINGS.reasoningEffort)
    .trim()
    .toLowerCase();
  const resolvedVerbosity = String(verbosity || modelDefinition.defaultVerbosity || BRIEF_DEFAULT_SETTINGS.verbosity)
    .trim()
    .toLowerCase();

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(snapshot);
  const inputTokens = estimateTokenCount(`${systemPrompt}\n${userPrompt}`);

  const response = await runProviderRequest({
    provider: modelDefinition.provider,
    model: modelDefinition.model,
    reasoningEffort: resolvedReasoningEffort,
    verbosity: resolvedVerbosity,
    systemPrompt,
    userPrompt
  });

  const parsedReport = coerceSummaryEmbeddedBrief(parseBriefJson(response.text));
  const normalizedReport = normalizeReportShape(parsedReport, response.text);
  const outputTokens = estimateTokenCount(response.text);
  const estimatedCostUsd = estimateRunCostUsd({
    modelDefinition,
    inputTokens,
    outputTokens
  });

  const briefDate = buildBriefDate(snapshot);
  const normalizedSource = normalizeBriefSource(source);
  const createdAt = new Date().toISOString();
  const db = getDb();

  const insert = db.prepare(`
    INSERT INTO campaign_intelligence_llm_briefs (
      store,
      scope_key,
      brief_date,
      source,
      provider,
      model,
      estimated_input_tokens,
      estimated_output_tokens,
      estimated_cost_usd,
      prompt_json,
      brief_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insert.run(
    normalizedStore,
    scopeKey,
    briefDate,
    normalizedSource,
    modelDefinition.provider,
    response.model || modelDefinition.model,
    inputTokens,
    outputTokens,
    estimatedCostUsd,
    JSON.stringify({
      systemPrompt,
      userPrompt,
      provider: modelDefinition.provider,
      model: response.model || modelDefinition.model,
      reasoningEffort: resolvedReasoningEffort,
      verbosity: resolvedVerbosity
    }),
    JSON.stringify(normalizedReport),
    createdAt
  );

  return {
    id: result.lastInsertRowid,
    briefDate,
    source: normalizedSource,
    provider: modelDefinition.provider,
    model: response.model || modelDefinition.model,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCostUsd,
    report: normalizedReport,
    createdAt
  };
}

export const campaignIntelligenceBriefSource = Object.freeze({
  manual: BRIEF_SOURCE_MANUAL,
  daily: BRIEF_SOURCE_DAILY
});
