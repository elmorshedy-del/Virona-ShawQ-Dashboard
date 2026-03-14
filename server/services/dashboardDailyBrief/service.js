import { getDb } from '../../db/database.js';
import { askOpenAIChat } from '../openaiService.js';
import { askFireworksChat, isFireworksConfigured } from '../fireworksService.js';
import { getCampaignIntelligenceSnapshot } from '../campaignIntelligence/service.js';
import { round, safeDivide } from '../campaignIntelligence/utils.js';
import {
  DASHBOARD_DAILY_BRIEF_DEFAULTS,
  DASHBOARD_DAILY_BRIEF_SCOPE_KEY,
  DASHBOARD_DAILY_BRIEF_SOURCE,
  DASHBOARD_DAILY_BRIEF_THRESHOLDS,
  SUPPORTED_STORES
} from './constants.js';
import {
  buildDashboardDailyBriefPacket,
  buildDashboardDailyBriefPacketContext
} from './packet.js';
import {
  buildDashboardDailyBriefSystemPrompt,
  buildDashboardDailyBriefUserPrompt
} from './prompt.js';

const IN_FLIGHT_BRIEF_RUNS = new Map();
const AMOUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const COUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});
const GLM_REWRITE_MARKERS = Object.freeze([
  'let me analyze',
  'i need to write',
  'wait,',
  'key facts from the packet',
  'important observations',
  'comparisons:',
  'closed day (',
  'return strict json',
  'the packet:'
]);
const FUNNEL_STEP_PRIORITY = Object.freeze([
  { key: 'purchaseIc', label: 'checkout-to-purchase' },
  { key: 'atcLpv', label: 'landing-page-to-cart' },
  { key: 'lpvClick', label: 'click-to-landing-page' },
  { key: 'icAtc', label: 'cart-to-checkout' },
  { key: 'ctr', label: 'click-through rate' }
]);

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

function parseJsonObject(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;

  const parseCandidate = (value) => {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  };

  const direct = parseCandidate(normalized);
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct;
  }

  const firstBrace = normalized.indexOf('{');
  const lastBrace = normalized.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = normalized.slice(firstBrace, lastBrace + 1);
    const parsed = parseCandidate(sliced);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  return null;
}

function coerceSingleParagraphText(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]+\\s+/, '').replace(/^\\d+[.)]\\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeParagraph(paragraph, fallback = 'No daily brief was produced.') {
  const normalized = coerceSingleParagraphText(paragraph);
  if (!normalized) return fallback;
  if (normalized.length <= DASHBOARD_DAILY_BRIEF_DEFAULTS.maxParagraphChars) {
    return normalized;
  }
  return `${normalized.slice(0, DASHBOARD_DAILY_BRIEF_DEFAULTS.maxParagraphChars - 3).trim()}...`;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatAmount(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return AMOUNT_FORMATTER.format(numeric);
}

function formatCount(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return COUNT_FORMATTER.format(numeric);
}

function formatMetric(value) {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return String(round(numeric, 2));
}

function formatPercentFromRatio(ratio) {
  const numeric = toFiniteNumber(ratio);
  if (!Number.isFinite(numeric)) return null;
  return `${Math.abs(round(numeric * 100, 1))}%`;
}

function isGlmModel(model) {
  const normalized = String(model || '').trim().toLowerCase();
  return normalized === 'glm-5'
    || normalized === 'glm'
    || normalized.includes('/glm-5');
}

function hasUsableMetaSignal(packet = {}) {
  const account = packet?.account || {};
  const closedDay = account?.closedDay || {};
  const recentTimeline = Array.isArray(packet?.recentTimeline) ? packet.recentTimeline : [];
  const rowCollections = [
    packet?.topCampaigns,
    packet?.flaggedAdSets,
    packet?.flaggedAds,
    packet?.topGeos
  ];

  const hasRows = rowCollections.some((rows) => Array.isArray(rows) && rows.length > 0);
  if (hasRows) return true;

  const metricKeys = ['spend', 'metaPurchases', 'ctr', 'lpvClick', 'atcLpv', 'icAtc', 'purchaseIc', 'roas'];
  if (metricKeys.some((key) => (toFiniteNumber(closedDay?.[key]) || 0) > 0)) {
    return true;
  }

  return recentTimeline.some((row) => {
    const keys = ['spend', 'metaPurchases', 'ctrPct', 'lpvClickPct', 'atcLpvPct', 'icAtcPct', 'purchaseIcPct', 'roas'];
    return keys.some((key) => (toFiniteNumber(row?.[key]) || 0) > 0);
  });
}

function pickPrimaryFunnelShift(packet = {}) {
  const account = packet?.account || {};
  const vsPriorDay = account?.vsPriorDay || {};
  const vsSevenDayBaseline = account?.vsSevenDayBaseline || {};

  let bestShift = null;
  for (const step of FUNNEL_STEP_PRIORITY) {
    for (const [source, deltas] of [['prior day', vsPriorDay], ['seven-day baseline', vsSevenDayBaseline]]) {
      const ratio = toFiniteNumber(deltas?.[step.key]);
      if (!Number.isFinite(ratio) || Math.abs(ratio) < DASHBOARD_DAILY_BRIEF_THRESHOLDS.meaningfulFunnelDeltaRatio) {
        continue;
      }
      if (!bestShift || Math.abs(ratio) > Math.abs(bestShift.ratio)) {
        bestShift = {
          label: step.label,
          ratio,
          source
        };
      }
    }
  }

  return bestShift;
}

function pickPrimaryEntity(packet = {}) {
  const groups = [
    { label: 'campaign', rows: packet?.topCampaigns },
    { label: 'ad set', rows: packet?.flaggedAdSets },
    { label: 'ad', rows: packet?.flaggedAds }
  ];

  for (const group of groups) {
    if (!Array.isArray(group.rows) || group.rows.length === 0) continue;
    const row = group.rows.find((candidate) => Array.isArray(candidate?.flags) && candidate.flags.length > 0)
      || group.rows.find((candidate) => (toFiniteNumber(candidate?.spend) || 0) > 0)
      || null;
    if (row) {
      return { ...row, entityLabel: group.label };
    }
  }

  return null;
}

function buildBaselinePaceSentence(account = {}) {
  const baseline = account?.sevenDayBaseline || {};
  const avgOrders = safeDivide(
    toFiniteNumber(baseline?.shopifyOrders),
    DASHBOARD_DAILY_BRIEF_DEFAULTS.baselineComparisonDays,
    null
  );
  const avgRevenue = safeDivide(
    toFiniteNumber(baseline?.revenue),
    DASHBOARD_DAILY_BRIEF_DEFAULTS.baselineComparisonDays,
    null
  );

  if (!Number.isFinite(avgOrders) && !Number.isFinite(avgRevenue)) {
    return '';
  }

  const parts = [];
  if (Number.isFinite(avgOrders)) {
    parts.push(`${formatCount(avgOrders)} orders`);
  }
  if (Number.isFinite(avgRevenue)) {
    parts.push(`revenue of ${formatAmount(avgRevenue)}`);
  }

  return `That sits against a recent seven-day daily pace of roughly ${parts.join(' and ')}.`;
}

function buildCommercialLead(packet = {}) {
  const account = packet?.account || {};
  const closedDay = account?.closedDay || {};
  const priorDay = account?.priorDay || {};
  const closedDate = account?.closedDayDate || packet?.meta?.briefDate || 'the closed day';
  const priorDayDate = account?.priorDayDate || 'the prior day';
  const orderDelta = toFiniteNumber(account?.vsPriorDay?.shopifyOrders);
  const revenueDelta = toFiniteNumber(account?.vsPriorDay?.revenue);
  const effectiveDelta = Number.isFinite(revenueDelta) ? revenueDelta : orderDelta;

  let direction = 'closed mixed';
  if (Number.isFinite(effectiveDelta)) {
    if (effectiveDelta <= -DASHBOARD_DAILY_BRIEF_THRESHOLDS.inLineDeltaRatio) direction = 'closed weaker commercially';
    else if (effectiveDelta >= DASHBOARD_DAILY_BRIEF_THRESHOLDS.inLineDeltaRatio) direction = 'closed stronger commercially';
    else direction = 'closed roughly in line commercially';
  }

  const closedOrders = formatCount(closedDay?.shopifyOrders);
  const closedRevenue = formatAmount(closedDay?.revenue);
  const priorOrders = formatCount(priorDay?.shopifyOrders);
  const priorRevenue = formatAmount(priorDay?.revenue);

  const currentParts = [];
  if (closedOrders) currentParts.push(`${closedOrders} Shopify orders`);
  if (closedRevenue) currentParts.push(`revenue of ${closedRevenue}`);

  const priorParts = [];
  if (priorOrders) priorParts.push(`${priorOrders} orders`);
  if (priorRevenue) priorParts.push(`${priorRevenue} in revenue`);

  const comparisonBits = [];
  if (Number.isFinite(orderDelta)) comparisonBits.push(`orders ${orderDelta < 0 ? 'down' : 'up'} ${formatPercentFromRatio(orderDelta)}`);
  if (Number.isFinite(revenueDelta)) comparisonBits.push(`revenue ${revenueDelta < 0 ? 'down' : 'up'} ${formatPercentFromRatio(revenueDelta)}`);

  let sentence = `**${closedDate}** ${direction}, with ${currentParts.join(' and ') || 'limited commercial data'}`;
  if (priorParts.length > 0) {
    sentence += ` versus ${priorParts.join(' and ')} on ${priorDayDate}`;
  }
  if (comparisonBits.length > 0) {
    sentence += `, with ${comparisonBits.join(' and ')}`;
  }
  sentence += '.';
  return sentence;
}

function buildNoMetaSignalSentence(packet = {}) {
  const hasRecentChanges = Array.isArray(packet?.recentChanges) && packet.recentChanges.length > 0;
  return `This packet contains no usable Meta delivery rows, campaign rows, or funnel movement for the day, so there is insufficient paid-media evidence to attribute the result to campaign behavior${hasRecentChanges ? '; recent budget edits are present but not interpretable without delivery data.' : '.'}`;
}

function buildFunnelSentence(packet = {}) {
  const shift = pickPrimaryFunnelShift(packet);
  if (!shift) return '';
  return `The clearest paid-media move was in **${shift.label}**, ${shift.ratio < 0 ? 'down' : 'up'} ${formatPercentFromRatio(shift.ratio)} versus the ${shift.source}.`;
}

function buildEntitySentence(packet = {}) {
  const entity = pickPrimaryEntity(packet);
  if (!entity) return '';

  const spendShare = toFiniteNumber(entity?.spendShare);
  const spendShareText = Number.isFinite(spendShare) ? `${formatPercentFromRatio(spendShare)} of tracked spend` : null;
  const roas = formatMetric(entity?.roas);
  const flags = Array.isArray(entity?.flags) ? entity.flags : [];

  if (flags.includes('winner')) {
    return `The clearest visible driver was the ${entity.entityLabel} *${entity.name}*${spendShareText ? ` at ${spendShareText}` : ''}.`;
  }

  if (flags.includes('weak_roas') || flags.includes('zero_purchase_spend')) {
    return `The main visible dragger was the ${entity.entityLabel} *${entity.name}*${spendShareText ? ` at ${spendShareText}` : ''}${roas ? ` with ROAS ${roas}` : ''}.`;
  }

  return '';
}

function buildRecentChangeSentence(packet = {}) {
  const latestChange = Array.isArray(packet?.recentChanges) ? packet.recentChanges[0] : null;
  if (!latestChange?.date) return '';

  const budgetShiftPercent = toFiniteNumber(latestChange?.budgetShiftPercent);
  if (!Number.isFinite(budgetShiftPercent)) {
    return `A budget change on ${latestChange.date} is recent enough to watch, but this packet does not prove it caused the move.`;
  }

  return `A budget shift on ${latestChange.date} (${budgetShiftPercent < 0 ? '' : '+'}${round(budgetShiftPercent, 1)}%) is recent enough to watch, but this packet does not prove it caused the move.`;
}

function buildDeterministicExecutiveParagraph(packet = {}) {
  const parts = [buildCommercialLead(packet), buildBaselinePaceSentence(packet?.account)];

  if (!hasUsableMetaSignal(packet)) {
    parts.push(buildNoMetaSignalSentence(packet));
  } else {
    parts.push(buildFunnelSentence(packet));
    parts.push(buildEntitySentence(packet));
    parts.push(buildRecentChangeSentence(packet));
  }

  return normalizeParagraph(parts.filter(Boolean).join(' '));
}

function needsGlmExecutiveRewrite(paragraph) {
  const normalized = coerceSingleParagraphText(paragraph).toLowerCase();
  if (!normalized) return true;
  return GLM_REWRITE_MARKERS.some((marker) => normalized.includes(marker));
}

function resolveDashboardDailyBriefParagraph({ packet, llmResponse, parsedParagraph, rawResponseText }) {
  const rawParagraph = normalizeParagraph(parsedParagraph, normalizeParagraph(rawResponseText, 'No daily brief was produced.'));
  if (!isGlmModel(llmResponse?.model)) {
    return rawParagraph;
  }
  if (!needsGlmExecutiveRewrite(rawParagraph)) {
    return rawParagraph;
  }
  return buildDeterministicExecutiveParagraph(packet);
}

function toSafeErrorMessage(error, fallback = 'Unknown error') {
  const message = String(error?.message || fallback).trim();
  return message || fallback;
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
