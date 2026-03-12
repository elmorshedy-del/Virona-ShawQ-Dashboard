const FUNNEL_STAGE_LABELS = Object.freeze({
  landing: 'Landing',
  product: 'Product',
  atc: 'Add to cart',
  cart: 'Cart',
  checkout: 'Checkout',
  payment: 'Payment',
  purchase: 'Purchase'
});

export const SESSION_INTELLIGENCE_NORMALIZATION_CONFIG = Object.freeze({
  baselineDays: 28,
  minimumReachedJourneys: 20,
  shrinkagePriorStrengthJourneys: 24,
  steadyGapThreshold: 0.03
});

export const SESSION_INTELLIGENCE_FUNNEL_STAGES = Object.freeze([
  'landing',
  'product',
  'atc',
  'cart',
  'checkout',
  'payment',
  'purchase'
]);

const PRODUCT_STAGE_STEP_KEYS = new Set(['product']);
const CHECKOUT_STAGE_STEP_KEYS = new Set(['checkout_contact', 'checkout_shipping', 'checkout_payment', 'checkout_review']);
const PAYMENT_STAGE_STEP_KEYS = new Set(['checkout_payment', 'checkout_review']);
const ATC_EVENT_NAMES = new Set([
  'product_added_to_cart',
  'add_to_cart_clicked',
  'add_to_cart',
  'added_to_cart',
  'cart_add',
  'atc',
  'si_atc_success',
  'si_atc_failed',
  'si_atc_click_disabled'
]);
const PURCHASE_EVENT_NAMES = new Set(['checkout_completed', 'purchase_reconciled']);

function safeFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function safeString(value) {
  if (value == null) return '';
  return String(value);
}

function normalizeJourneySequence(sequence) {
  return Array.isArray(sequence)
    ? sequence.map((value) => safeString(value).trim()).filter(Boolean)
    : [];
}

function normalizeEventBreakdown(eventBreakdown) {
  if (!eventBreakdown || typeof eventBreakdown !== 'object' || Array.isArray(eventBreakdown)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(eventBreakdown)) {
    const normalizedKey = safeString(key).trim().toLowerCase();
    if (!normalizedKey) continue;
    normalized[normalizedKey] = safeFiniteNumber(value, 0);
  }
  return normalized;
}

function hasNamedEvent(eventBreakdown, names) {
  return Array.from(names).some((name) => safeFiniteNumber(eventBreakdown?.[name], 0) > 0);
}

export function getFunnelStageLabel(stageKey) {
  return FUNNEL_STAGE_LABELS[stageKey] || 'Unknown';
}

export function hasJourneyReachedStage(journeyRow, stageKey) {
  if (!journeyRow || typeof journeyRow !== 'object') return false;
  const sequence = normalizeJourneySequence(journeyRow.sequence);
  const eventBreakdown = normalizeEventBreakdown(journeyRow.event_breakdown);

  switch (stageKey) {
    case 'landing':
      return true;
    case 'product':
      return (
        safeFiniteNumber(journeyRow.product_view_count, 0) > 0
        || sequence.some((stepKey) => PRODUCT_STAGE_STEP_KEYS.has(stepKey))
        || Boolean(safeString(journeyRow.first_product_id).trim())
        || Boolean(safeString(journeyRow.first_product_label).trim())
        || Boolean(safeString(journeyRow.last_product_id).trim())
        || Boolean(safeString(journeyRow.last_product_label).trim())
      );
    case 'atc':
      return hasNamedEvent(eventBreakdown, ATC_EVENT_NAMES) || Boolean(safeString(journeyRow.cart_entered_at).trim());
    case 'cart':
      return Boolean(safeString(journeyRow.cart_entered_at).trim()) || sequence.includes('cart');
    case 'checkout':
      return (
        Boolean(safeString(journeyRow.checkout_started_at).trim())
        || sequence.some((stepKey) => CHECKOUT_STAGE_STEP_KEYS.has(stepKey))
        || Boolean(safeString(journeyRow.last_checkout_step).trim())
      );
    case 'payment':
      return (
        Boolean(safeString(journeyRow.payment_info_submitted_at).trim())
        || sequence.some((stepKey) => PAYMENT_STAGE_STEP_KEYS.has(stepKey))
        || PURCHASE_EVENT_NAMES.has(safeString(journeyRow.last_meaningful_event_name).trim().toLowerCase())
      );
    case 'purchase':
      return Boolean(safeString(journeyRow.purchase_at).trim()) || Boolean(journeyRow.purchased_in_session);
    default:
      return false;
  }
}

export function buildFunnelStageCounts(journeyRows) {
  const rows = Array.isArray(journeyRows) ? journeyRows : [];
  return SESSION_INTELLIGENCE_FUNNEL_STAGES.map((stageKey) => ({
    stageKey,
    label: getFunnelStageLabel(stageKey),
    reachedJourneys: rows.reduce((count, row) => count + (hasJourneyReachedStage(row, stageKey) ? 1 : 0), 0)
  }));
}

export function shrinkBinomialRate({ successes, trials, priorRate, priorStrength }) {
  const normalizedTrials = Math.max(0, Math.trunc(safeFiniteNumber(trials, 0)));
  if (normalizedTrials === 0) return null;

  const normalizedSuccesses = Math.min(normalizedTrials, Math.max(0, Math.trunc(safeFiniteNumber(successes, 0))));
  const normalizedPriorRate = Math.min(1, Math.max(0, safeFiniteNumber(priorRate, 0)));
  const normalizedPriorStrength = Math.max(0, safeFiniteNumber(priorStrength, 0));

  const alpha = normalizedPriorRate * normalizedPriorStrength;
  const beta = (1 - normalizedPriorRate) * normalizedPriorStrength;
  return (normalizedSuccesses + alpha) / (normalizedTrials + alpha + beta);
}

function buildTransitionCounts(stageCounts) {
  const byStage = new Map(stageCounts.map((stage) => [stage.stageKey, stage.reachedJourneys]));
  const transitions = [];

  for (let index = 0; index < SESSION_INTELLIGENCE_FUNNEL_STAGES.length - 1; index += 1) {
    const fromStage = SESSION_INTELLIGENCE_FUNNEL_STAGES[index];
    const toStage = SESSION_INTELLIGENCE_FUNNEL_STAGES[index + 1];
    const reachedJourneys = safeFiniteNumber(byStage.get(fromStage), 0);
    const advancedJourneys = safeFiniteNumber(byStage.get(toStage), 0);
    const rawRate = reachedJourneys > 0 ? advancedJourneys / reachedJourneys : null;

    transitions.push({
      fromStage,
      toStage,
      label: `${getFunnelStageLabel(fromStage)} to ${getFunnelStageLabel(toStage)}`,
      reachedJourneys,
      advancedJourneys,
      rawRate
    });
  }

  return transitions;
}

function describeTransitionStatus({ currentReachedJourneys, baselineReachedJourneys, gap, steadyGapThreshold, minimumReachedJourneys }) {
  if (currentReachedJourneys < minimumReachedJourneys || baselineReachedJourneys < minimumReachedJourneys) {
    return 'limited_data';
  }
  if (gap > steadyGapThreshold) return 'weaker_than_usual';
  if (gap < -steadyGapThreshold) return 'stronger_than_usual';
  return 'steady';
}

export function buildNormalizedFunnelMetrics({
  currentJourneys,
  baselineJourneys,
  config = SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
}) {
  const normalizedCurrentJourneys = Array.isArray(currentJourneys) ? currentJourneys : [];
  const normalizedBaselineJourneys = Array.isArray(baselineJourneys) ? baselineJourneys : [];
  const minimumReachedJourneys = safeFiniteNumber(config.minimumReachedJourneys, SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.minimumReachedJourneys);
  const shrinkagePriorStrengthJourneys = safeFiniteNumber(
    config.shrinkagePriorStrengthJourneys,
    SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.shrinkagePriorStrengthJourneys
  );
  const steadyGapThreshold = safeFiniteNumber(config.steadyGapThreshold, SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.steadyGapThreshold);

  const currentStages = buildFunnelStageCounts(normalizedCurrentJourneys);
  const baselineStages = buildFunnelStageCounts(normalizedBaselineJourneys);
  const currentTransitions = buildTransitionCounts(currentStages);
  const baselineTransitions = buildTransitionCounts(baselineStages);
  const baselineByPair = new Map(baselineTransitions.map((transition) => [`${transition.fromStage}:${transition.toStage}`, transition]));

  const transitions = currentTransitions.map((transition) => {
    const baselineTransition = baselineByPair.get(`${transition.fromStage}:${transition.toStage}`) || null;
    const baselineRate = baselineTransition?.rawRate ?? null;
    const currentRate = baselineRate == null
      ? transition.rawRate
      : shrinkBinomialRate({
          successes: transition.advancedJourneys,
          trials: transition.reachedJourneys,
          priorRate: baselineRate,
          priorStrength: shrinkagePriorStrengthJourneys
        });
    const gap = baselineRate != null && currentRate != null ? baselineRate - currentRate : null;
    const expectedAdvancedJourneys = baselineRate != null ? transition.reachedJourneys * baselineRate : null;
    const missedAdvancedJourneys = expectedAdvancedJourneys != null
      ? Math.max(0, expectedAdvancedJourneys - transition.advancedJourneys)
      : null;
    const status = describeTransitionStatus({
      currentReachedJourneys: transition.reachedJourneys,
      baselineReachedJourneys: baselineTransition?.reachedJourneys ?? 0,
      gap: safeFiniteNumber(gap, 0),
      steadyGapThreshold,
      minimumReachedJourneys
    });

    return {
      fromStage: transition.fromStage,
      toStage: transition.toStage,
      label: transition.label,
      current: {
        reachedJourneys: transition.reachedJourneys,
        advancedJourneys: transition.advancedJourneys,
        rate: currentRate,
        rawRate: transition.rawRate
      },
      baseline: {
        reachedJourneys: baselineTransition?.reachedJourneys ?? 0,
        advancedJourneys: baselineTransition?.advancedJourneys ?? 0,
        rate: baselineRate,
        rawRate: baselineTransition?.rawRate ?? null
      },
      comparison: {
        status,
        gap,
        expectedAdvancedJourneys,
        missedAdvancedJourneys
      }
    };
  });

  return {
    totals: {
      currentJourneys: normalizedCurrentJourneys.length,
      baselineJourneys: normalizedBaselineJourneys.length
    },
    stages: currentStages.map((stage) => ({
      ...stage,
      baselineReachedJourneys: baselineStages.find((candidate) => candidate.stageKey === stage.stageKey)?.reachedJourneys ?? 0
    })),
    transitions
  };
}
