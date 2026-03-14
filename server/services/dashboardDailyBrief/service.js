import { getDb } from '../../db/database.js';
import { askOpenAIChat } from '../openaiService.js';
import { askFireworksChat, isFireworksConfigured } from '../fireworksService.js';
import { getCampaignIntelligenceSnapshot } from '../campaignIntelligence/service.js';
import { round } from '../campaignIntelligence/utils.js';
import {
  DASHBOARD_DAILY_BRIEF_DEFAULTS,
  DASHBOARD_DAILY_BRIEF_SCOPE_KEY,
  DASHBOARD_DAILY_BRIEF_SOURCE,
  SUPPORTED_STORES
} from './constants.js';
import { resolveDashboardDailyBriefParagraph } from './deterministic.js';
import {
  buildDashboardDailyBriefPacket,
  buildDashboardDailyBriefPacketContext
} from './packet.js';
import {
  buildDashboardDailyBriefSystemPrompt,
  buildDashboardDailyBriefUserPrompt
} from './prompt.js';
import {
  parseJsonObject,
  toSafeErrorMessage
} from './utils.js';

const IN_FLIGHT_BRIEF_RUNS = new Map();

function ensureSupportedStore(store) {
  const normalizedStore = String(store || '').trim().toLowerCase();
  if (!SUPPORTED_STORES.has(normalizedStore)) {
    const error = new Error('Unsupported store for dashboard daily brief');
    error.status = 400;
    throw error;
  }
  return normalizedStore;
}

function normalizeSource(source) {
  const normalized = String(source || DASHBOARD_DAILY_BRIEF_SOURCE.daily).trim().toLowerCase();
  if (normalized === DASHBOARD_DAILY_BRIEF_SOURCE.manual) {
    return DASHBOARD_DAILY_BRIEF_SOURCE.manual;
  }
  return DASHBOARD_DAILY_BRIEF_SOURCE.daily;
}

function estimateTokenCount(text) {
  const normalized = String(text || '');
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / DASHBOARD_DAILY_BRIEF_DEFAULTS.estimatedCharsPerToken));
}

function estimateRunCostUsd({ inputTokens, outputTokens }) {
  const inputCost = (inputTokens / 1_000_000) * DASHBOARD_DAILY_BRIEF_DEFAULTS.inputUsdPerMillionTokens;
  const outputCost = (outputTokens / 1_000_000) * DASHBOARD_DAILY_BRIEF_DEFAULTS.outputUsdPerMillionTokens;
  return round(inputCost + outputCost, 6);
}

function estimateProviderRunCostUsd({ provider, inputTokens, outputTokens }) {
  if (provider !== DASHBOARD_DAILY_BRIEF_DEFAULTS.provider) {
    return null;
  }
  return estimateRunCostUsd({ inputTokens, outputTokens });
}

function buildSnapshotQuery(store) {
  return {
    store,
    level: 'campaign',
    country: 'ALL',
    analysisWindowDays: DASHBOARD_DAILY_BRIEF_DEFAULTS.analysisWindowDays,
    anchorWindowDays: DASHBOARD_DAILY_BRIEF_DEFAULTS.anchorWindowDays,
    selectorLimit: DASHBOARD_DAILY_BRIEF_DEFAULTS.selectorLimit
  };
}

function mapBriefRow(row) {
  if (!row) return null;
  let metadata = null;
  if (row.metadataJson) {
    try {
      metadata = JSON.parse(row.metadataJson);
    } catch (_error) {
      metadata = null;
    }
  }
  return {
    id: row.id,
    store: row.store,
    scopeKey: row.scopeKey,
    briefDate: row.briefDate,
    source: row.source,
    provider: row.provider,
    model: row.model,
    reasoningEffort: row.reasoningEffort,
    estimatedInputTokens: Number(row.estimatedInputTokens || 0),
    estimatedOutputTokens: Number(row.estimatedOutputTokens || 0),
    estimatedCostUsd: Number(row.estimatedCostUsd || 0),
    paragraph: row.briefMarkdown,
    createdAt: row.createdAt,
    metadata
  };
}

function buildInFlightKey({ store, briefDate }) {
  return `${store}:${DASHBOARD_DAILY_BRIEF_SCOPE_KEY}:${briefDate}`;
}

function runWithInFlightBrief(key, factory) {
  const existing = IN_FLIGHT_BRIEF_RUNS.get(key);
  if (existing) return existing;

  const task = Promise.resolve()
    .then(factory)
    .finally(() => {
      IN_FLIGHT_BRIEF_RUNS.delete(key);
    });

  IN_FLIGHT_BRIEF_RUNS.set(key, task);
  return task;
}

async function runDashboardDailyBriefRequest({ systemPrompt, userPrompt }) {
  try {
    const text = await askOpenAIChat({
      model: DASHBOARD_DAILY_BRIEF_DEFAULTS.model,
      reasoningEffort: DASHBOARD_DAILY_BRIEF_DEFAULTS.reasoningEffort,
      verbosity: DASHBOARD_DAILY_BRIEF_DEFAULTS.verbosity,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxOutputTokens: DASHBOARD_DAILY_BRIEF_DEFAULTS.maxOutputTokens
    });

    return {
      text,
      provider: DASHBOARD_DAILY_BRIEF_DEFAULTS.provider,
      model: DASHBOARD_DAILY_BRIEF_DEFAULTS.model,
      reasoningEffort: DASHBOARD_DAILY_BRIEF_DEFAULTS.reasoningEffort,
      fallbackUsed: false,
      fallbackReason: null
    };
  } catch (primaryError) {
    if (!isFireworksConfigured()) {
      throw primaryError;
    }

    const fallbackReason = toSafeErrorMessage(primaryError, 'Primary provider failed');
    console.warn('[Dashboard Daily Brief] Falling back to Fireworks GLM-5:', fallbackReason);

    const fallback = await askFireworksChat({
      model: DASHBOARD_DAILY_BRIEF_DEFAULTS.fallbackModel,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxOutputTokens: DASHBOARD_DAILY_BRIEF_DEFAULTS.maxOutputTokens,
      verbosity: DASHBOARD_DAILY_BRIEF_DEFAULTS.verbosity,
      temperature: DASHBOARD_DAILY_BRIEF_DEFAULTS.fallbackTemperature,
      reasoningEffort: DASHBOARD_DAILY_BRIEF_DEFAULTS.fallbackReasoningEffort
    });

    return {
      text: String(fallback?.text || '').trim(),
      provider: DASHBOARD_DAILY_BRIEF_DEFAULTS.fallbackProvider,
      model: String(fallback?.model || DASHBOARD_DAILY_BRIEF_DEFAULTS.fallbackModel),
      reasoningEffort: DASHBOARD_DAILY_BRIEF_DEFAULTS.fallbackReasoningEffort,
      fallbackUsed: true,
      fallbackReason
    };
  }
}

export function getStoredDashboardDailyBrief({ store, briefDate, scopeKey = DASHBOARD_DAILY_BRIEF_SCOPE_KEY }) {
  const normalizedStore = ensureSupportedStore(store);
  if (!briefDate) return null;

  const db = getDb();
  const row = db.prepare(`
    SELECT
      id,
      store,
      scope_key as scopeKey,
      brief_date as briefDate,
      source,
      provider,
      model,
      reasoning_effort as reasoningEffort,
      estimated_input_tokens as estimatedInputTokens,
      estimated_output_tokens as estimatedOutputTokens,
      estimated_cost_usd as estimatedCostUsd,
      brief_markdown as briefMarkdown,
      metadata_json as metadataJson,
      created_at as createdAt
    FROM dashboard_daily_briefs
    WHERE store = ?
      AND scope_key = ?
      AND brief_date = ?
    LIMIT 1
  `).get(normalizedStore, scopeKey, briefDate);

  return mapBriefRow(row);
}

function persistDashboardDailyBrief({
  store,
  briefDate,
  source,
  paragraph,
  packet,
  provider,
  model,
  reasoningEffort,
  estimatedInputTokens,
  estimatedOutputTokens,
  estimatedCostUsd,
  metadata
}) {
  const normalizedStore = ensureSupportedStore(store);
  const db = getDb();
  const createdAt = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO dashboard_daily_briefs (
      store,
      scope_key,
      brief_date,
      source,
      provider,
      model,
      reasoning_effort,
      estimated_input_tokens,
      estimated_output_tokens,
      estimated_cost_usd,
      packet_json,
      brief_markdown,
      metadata_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, scope_key, brief_date)
    DO UPDATE SET
      source = excluded.source,
      provider = excluded.provider,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      estimated_input_tokens = excluded.estimated_input_tokens,
      estimated_output_tokens = excluded.estimated_output_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      packet_json = excluded.packet_json,
      brief_markdown = excluded.brief_markdown,
      metadata_json = excluded.metadata_json,
      created_at = excluded.created_at
    RETURNING id
  `).get(
    normalizedStore,
    DASHBOARD_DAILY_BRIEF_SCOPE_KEY,
    briefDate,
    normalizeSource(source),
    provider,
    model,
    reasoningEffort,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    JSON.stringify(packet),
    paragraph,
    JSON.stringify(metadata || {}),
    createdAt
  );

  return {
    id: result?.id || null,
    store: normalizedStore,
    scopeKey: DASHBOARD_DAILY_BRIEF_SCOPE_KEY,
    briefDate,
    source: normalizeSource(source),
    provider,
    model,
    reasoningEffort,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    paragraph,
    createdAt,
    metadata: metadata || null
  };
}

async function generateFreshDashboardDailyBrief({
  store,
  source = DASHBOARD_DAILY_BRIEF_SOURCE.daily,
  snapshot = null
}) {
  const normalizedStore = ensureSupportedStore(store);
  const resolvedSnapshot = snapshot || await getCampaignIntelligenceSnapshot(buildSnapshotQuery(normalizedStore));
  const briefDate = String(resolvedSnapshot?.scope?.analysisEndDate || '').trim();
  if (!briefDate) {
    const error = new Error('Unable to resolve dashboard daily brief date');
    error.status = 500;
    throw error;
  }

  const packetContext = buildDashboardDailyBriefPacketContext({ snapshot: resolvedSnapshot });
  const packet = buildDashboardDailyBriefPacket({
    snapshot: resolvedSnapshot,
    entityOptionGroups: packetContext.entityOptionGroups,
    geoRows: packetContext.geoRows
  });

  const systemPrompt = buildDashboardDailyBriefSystemPrompt();
  const userPrompt = buildDashboardDailyBriefUserPrompt(packet);
  const estimatedInputTokens = estimateTokenCount(`${systemPrompt}\n${userPrompt}`);
  const llmResponse = await runDashboardDailyBriefRequest({ systemPrompt, userPrompt });
  const responseText = String(llmResponse?.text || '').trim();

  const parsed = parseJsonObject(responseText);
  const paragraph = resolveDashboardDailyBriefParagraph({
    packet,
    llmResponse,
    parsedParagraph: parsed?.paragraph,
    rawResponseText: responseText
  });
  const estimatedOutputTokens = estimateTokenCount(responseText);
  const estimatedCostUsd = estimateProviderRunCostUsd({
    provider: llmResponse.provider,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens
  });

  return persistDashboardDailyBrief({
    store: normalizedStore,
    briefDate,
    source,
    paragraph,
    packet,
    provider: llmResponse.provider,
    model: llmResponse.model,
    reasoningEffort: llmResponse.reasoningEffort,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    metadata: {
      analysisStartDate: resolvedSnapshot?.scope?.analysisStartDate || null,
      analysisEndDate: resolvedSnapshot?.scope?.analysisEndDate || null,
      anchorStartDate: resolvedSnapshot?.scope?.anchorStartDate || null,
      anchorEndDate: resolvedSnapshot?.scope?.anchorEndDate || null,
      fallbackUsed: Boolean(llmResponse.fallbackUsed),
      fallbackReason: llmResponse.fallbackReason || null
    }
  });
}

export async function getOrCreateDashboardDailyBrief({ store }) {
  const normalizedStore = ensureSupportedStore(store);
  const snapshot = await getCampaignIntelligenceSnapshot(buildSnapshotQuery(normalizedStore));
  const briefDate = String(snapshot?.scope?.analysisEndDate || '').trim();
  if (!briefDate) {
    const error = new Error('Unable to resolve dashboard daily brief date');
    error.status = 500;
    throw error;
  }

  const existing = getStoredDashboardDailyBrief({ store: normalizedStore, briefDate });
  if (existing) {
    return existing;
  }

  return runWithInFlightBrief(
    buildInFlightKey({ store: normalizedStore, briefDate }),
    async () => {
      const latestExisting = getStoredDashboardDailyBrief({ store: normalizedStore, briefDate });
      if (latestExisting) return latestExisting;

      return generateFreshDashboardDailyBrief({
        store: normalizedStore,
        source: DASHBOARD_DAILY_BRIEF_SOURCE.daily,
        snapshot
      });
    }
  );
}

export async function generateDashboardDailyBrief({ store, force = false, source = DASHBOARD_DAILY_BRIEF_SOURCE.manual }) {
  const normalizedStore = ensureSupportedStore(store);
  const snapshot = await getCampaignIntelligenceSnapshot(buildSnapshotQuery(normalizedStore));
  const briefDate = String(snapshot?.scope?.analysisEndDate || '').trim();
  if (!briefDate) {
    const error = new Error('Unable to resolve dashboard daily brief date');
    error.status = 500;
    throw error;
  }

  if (!force) {
    const existing = getStoredDashboardDailyBrief({ store: normalizedStore, briefDate });
    if (existing) {
      return existing;
    }
  }

  return runWithInFlightBrief(
    buildInFlightKey({ store: normalizedStore, briefDate }),
    async () => {
      if (!force) {
        const latestExisting = getStoredDashboardDailyBrief({ store: normalizedStore, briefDate });
        if (latestExisting) return latestExisting;
      }

      return generateFreshDashboardDailyBrief({
        store: normalizedStore,
        source,
        snapshot
      });
    }
  );
}

export function listDashboardDailyBriefStores() {
  return Array.from(SUPPORTED_STORES).sort();
}
