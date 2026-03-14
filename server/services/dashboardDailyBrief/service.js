import { getDb } from '../../db/database.js';
import { askOpenAIChat } from '../openaiService.js';
import { askFireworksChat, isFireworksConfigured } from '../fireworksService.js';
import { getShopifyCredentialsForStore } from '../shopifyService.js';
import {
  DASHBOARD_DAILY_BRIEF_DEFAULTS,
  DASHBOARD_DAILY_BRIEF_SCOPE_KEY,
  DASHBOARD_DAILY_BRIEF_SOURCE,
  SUPPORTED_STORES
} from './constants.js';
import { resolveDashboardDailyBriefParagraph } from './deterministic.js';
import {
  buildDashboardDailyBriefPacket
} from './packet.js';
import { loadDashboardDailyBriefSource } from './source.js';
import {
  buildDashboardDailyBriefSystemPrompt,
  buildDashboardDailyBriefUserPrompt
} from './prompt.js';
import {
  parseJsonObject,
  round,
  parseIsoDate,
  toSafeErrorMessage
} from './utils.js';
import { normalizeDashboardDailyBriefIncludeConfig } from './options.js';

const IN_FLIGHT_BRIEF_RUNS = new Map();
const SHOPIFY_ORDERS_TABLE = 'shopify_orders';
const SHOPIFY_SYNC_SOURCE = 'shopify';
const MISSING_CREDENTIALS_PATTERN = /missing shopify credentials/i;

function usesShopifyOrderSource(store) {
  return store === 'shawq';
}

function getLatestLocalShopifyOrderDate({ db, store }) {
  const row = db.prepare(`
    SELECT MAX(date) as latestOrderDate
    FROM shopify_orders
    WHERE store = ?
      AND COALESCE(is_excluded, 0) = 0
  `).get(store);
  return parseIsoDate(String(row?.latestOrderDate || '').trim());
}

function getLatestShopifySyncLog({ db, store }) {
  return db.prepare(`
    SELECT status, error_message as errorMessage, created_at as createdAt
    FROM sync_log
    WHERE store = ?
      AND source = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(store, SHOPIFY_SYNC_SOURCE) || null;
}

function hasShopifyDirectCoverageCredentials(store) {
  const credentials = getShopifyCredentialsForStore(store);
  return Boolean(credentials?.shopifyStore && credentials?.accessToken);
}

function assertTrustedClosedDayCommercialCoverage({ db, store, briefDate }) {
  if (!usesShopifyOrderSource(store)) {
    return;
  }

  const normalizedBriefDate = parseIsoDate(briefDate);
  if (!normalizedBriefDate) {
    return;
  }

  const latestLocalOrderDate = getLatestLocalShopifyOrderDate({ db, store });
  if (latestLocalOrderDate && latestLocalOrderDate >= normalizedBriefDate) {
    return;
  }

  if (hasShopifyDirectCoverageCredentials(store)) {
    return;
  }

  const latestSync = getLatestShopifySyncLog({ db, store });
  const latestSyncError = String(latestSync?.errorMessage || '').trim();
  const latestSyncStatus = String(latestSync?.status || '').trim().toLowerCase();
  const latestSyncFailed = latestSyncStatus === 'error';
  const missingCredentials = MISSING_CREDENTIALS_PATTERN.test(latestSyncError);
  const latestSyncContext = latestSync?.createdAt
    ? ` Latest Shopify sync status was ${latestSyncStatus || 'unknown'} at ${latestSync.createdAt}.`
    : ' No Shopify sync metadata is available in the local dashboard database.';

  const error = new Error(
    `Shopify order coverage is unavailable for ${briefDate}. Latest local Shopify order date is ${latestLocalOrderDate || 'unknown'}.${latestSyncContext}${latestSyncFailed || missingCredentials ? ` Latest Shopify sync error: ${latestSyncError || 'unknown error'}.` : ''}`
  );
  error.status = 409;
  throw error;
}

function assertRequestedClosedDayCommercialCoverage({ store, briefDate }) {
  if (!briefDate) {
    return;
  }

  assertTrustedClosedDayCommercialCoverage({
    db: getDb(),
    store,
    briefDate
  });
}

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

function normalizeRequestedBriefDate(briefDate) {
  if (briefDate == null || briefDate === '') {
    return null;
  }

  const normalized = parseIsoDate(String(briefDate).trim());
  if (!normalized) {
    const error = new Error('briefDate must be a valid ISO date (YYYY-MM-DD)');
    error.status = 400;
    throw error;
  }

  return normalized;
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
  targetBriefDate = null,
  source = DASHBOARD_DAILY_BRIEF_SOURCE.daily,
  dashboardSource = null,
  include: includeOverrides = null
}) {
  const normalizedStore = ensureSupportedStore(store);
  const normalizedBriefDate = normalizeRequestedBriefDate(targetBriefDate);
  const include = normalizeDashboardDailyBriefIncludeConfig(includeOverrides);
  const resolvedSource = dashboardSource || await loadDashboardDailyBriefSource({
    store: normalizedStore,
    briefDate: normalizedBriefDate,
    include
  });
  const briefDate = String(resolvedSource?.briefDate || '').trim();
  if (!briefDate) {
    const error = new Error('Unable to resolve dashboard daily brief date');
    error.status = 500;
    throw error;
  }

  assertTrustedClosedDayCommercialCoverage({
    db: getDb(),
    store: normalizedStore,
    briefDate
  });

  const packet = buildDashboardDailyBriefPacket({ source: resolvedSource });

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
      analysisStartDate: resolvedSource?.analysisStartDate || null,
      analysisEndDate: resolvedSource?.analysisEndDate || null,
      anchorStartDate: resolvedSource?.anchorStartDate || null,
      anchorEndDate: resolvedSource?.anchorEndDate || null,
      include,
      fallbackUsed: Boolean(llmResponse.fallbackUsed),
      fallbackReason: llmResponse.fallbackReason || null
    }
  });
}

export async function getOrCreateDashboardDailyBrief({ store, briefDate: requestedBriefDate = null, include: includeOverrides = null }) {
  const normalizedStore = ensureSupportedStore(store);
  const normalizedBriefDate = normalizeRequestedBriefDate(requestedBriefDate);
  const include = normalizeDashboardDailyBriefIncludeConfig(includeOverrides);
  assertRequestedClosedDayCommercialCoverage({
    store: normalizedStore,
    briefDate: normalizedBriefDate
  });
  const sourceData = await loadDashboardDailyBriefSource({
    store: normalizedStore,
    briefDate: normalizedBriefDate,
    include
  });
  const resolvedBriefDate = String(sourceData?.briefDate || '').trim();
  if (!resolvedBriefDate) {
    const error = new Error('Unable to resolve dashboard daily brief date');
    error.status = 500;
    throw error;
  }

  const existing = getStoredDashboardDailyBrief({ store: normalizedStore, briefDate: resolvedBriefDate });
  if (existing) {
    return existing;
  }

  return runWithInFlightBrief(
    buildInFlightKey({ store: normalizedStore, briefDate: resolvedBriefDate }),
    async () => {
      const latestExisting = getStoredDashboardDailyBrief({ store: normalizedStore, briefDate: resolvedBriefDate });
      if (latestExisting) return latestExisting;

      return generateFreshDashboardDailyBrief({
        store: normalizedStore,
        targetBriefDate: resolvedBriefDate,
        source: DASHBOARD_DAILY_BRIEF_SOURCE.daily,
        dashboardSource: sourceData,
        include
      });
    }
  );
}

export async function generateDashboardDailyBrief({ store, briefDate: requestedBriefDate = null, force = false, source = DASHBOARD_DAILY_BRIEF_SOURCE.manual, include: includeOverrides = null }) {
  const normalizedStore = ensureSupportedStore(store);
  const normalizedBriefDate = normalizeRequestedBriefDate(requestedBriefDate);
  const include = normalizeDashboardDailyBriefIncludeConfig(includeOverrides);
  assertRequestedClosedDayCommercialCoverage({
    store: normalizedStore,
    briefDate: normalizedBriefDate
  });
  const sourceData = await loadDashboardDailyBriefSource({
    store: normalizedStore,
    briefDate: normalizedBriefDate,
    include
  });
  const resolvedBriefDate = String(sourceData?.briefDate || '').trim();
  if (!resolvedBriefDate) {
    const error = new Error('Unable to resolve dashboard daily brief date');
    error.status = 500;
    throw error;
  }

  if (!force) {
    const existing = getStoredDashboardDailyBrief({ store: normalizedStore, briefDate: resolvedBriefDate });
    if (existing) {
      return existing;
    }
  }

  return runWithInFlightBrief(
    buildInFlightKey({ store: normalizedStore, briefDate: resolvedBriefDate }),
    async () => {
      if (!force) {
        const latestExisting = getStoredDashboardDailyBrief({ store: normalizedStore, briefDate: resolvedBriefDate });
        if (latestExisting) return latestExisting;
      }

      return generateFreshDashboardDailyBrief({
        store: normalizedStore,
        targetBriefDate: resolvedBriefDate,
        source,
        dashboardSource: sourceData,
        include
      });
    }
  );
}

export function listDashboardDailyBriefStores() {
  return Array.from(SUPPORTED_STORES).sort();
}
