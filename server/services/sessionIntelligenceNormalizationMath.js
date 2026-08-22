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

export const SESSION_INTELLIGENCE_PRODUCT_NORMALIZATION_STAGES = Object.freeze([
  'product',
  'atc',
  'cart',
  'checkout',
  'payment',
  'purchase'
]);

export const SESSION_INTELLIGENCE_SEGMENT_DIMENSIONS = Object.freeze(['device', 'source', 'country', 'campaign']);

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
const PRODUCT_KEY_ID_PREFIX = 'id:';
const PRODUCT_KEY_LABEL_PREFIX = 'label:';
const COHORT_COMPARISON_SORT_PRECISION = 1000;
const MONEY_LEAK_SORT_PRECISION = 1000;
const SOURCE_SEGMENT_LABELS = Object.freeze({
  direct: 'Direct',
  instagram: 'Instagram',
  facebook: 'Facebook',
  google: 'Google',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  email: 'Email',
  pinterest: 'Pinterest'
});
const UNKNOWN_COUNTRY_LABEL = 'Unknown country';
const NO_CAMPAIGN_TAG_LABEL = 'No campaign tag';
const SOURCE_SEGMENT_ALIASES = Object.freeze({
  direct: new Set(['', '(direct)', '(none)', 'direct', 'none']),
  instagram: new Set(['ig', 'instagram', 'instagram_ads']),
  facebook: new Set(['fb', 'facebook', 'meta']),
  google: new Set(['google', 'google_ads', 'adwords']),
  tiktok: new Set(['tt', 'tiktok', 'tik_tok']),
  snapchat: new Set(['snap', 'snapchat']),
  email: new Set(['email', 'klaviyo', 'mailchimp']),
  pinterest: new Set(['pinterest', 'pin'])
});
const DESKTOP_DEVICE_OS_KEYS = new Set(['windows', 'macos', 'linux', 'chromeos']);
const REGION_DISPLAY_NAMES = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

function safeFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function safeString(value) {
  if (value == null) return '';
  return String(value);
}

function normalizeProductLabelKey(label) {
  return safeString(label).trim().toLowerCase().replace(/\s+/g, ' ');
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

function buildProductKey({ productId, productLabel }) {
  const normalizedProductId = safeString(productId).trim();
  if (normalizedProductId) return `${PRODUCT_KEY_ID_PREFIX}${normalizedProductId}`;

  const normalizedProductLabel = normalizeProductLabelKey(productLabel);
  if (normalizedProductLabel) return `${PRODUCT_KEY_LABEL_PREFIX}${normalizedProductLabel}`;
  return null;
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

export function buildFunnelStageCounts(journeyRows, stageSequence = SESSION_INTELLIGENCE_FUNNEL_STAGES) {
  const rows = Array.isArray(journeyRows) ? journeyRows : [];
  const normalizedStageSequence = Array.isArray(stageSequence) ? stageSequence : SESSION_INTELLIGENCE_FUNNEL_STAGES;
  return normalizedStageSequence.map((stageKey) => ({
    stageKey,
    label: getFunnelStageLabel(stageKey),
    reachedJourneys: rows.reduce((count, row) => count + (hasJourneyReachedStage(row, stageKey) ? 1 : 0), 0)
  }));
}

function buildStageCountMap(stageCounts) {
  return new Map((Array.isArray(stageCounts) ? stageCounts : []).map((stage) => [stage.stageKey, safeFiniteNumber(stage.reachedJourneys, 0)]));
}

function getStageReachedJourneys(stages, stageKey, countKey = 'reachedJourneys') {
  return safeFiniteNumber(
    (Array.isArray(stages) ? stages : []).find((stage) => stage?.stageKey === stageKey)?.[countKey],
    0
  );
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

function buildTransitionCounts(stageCounts, stageSequence = SESSION_INTELLIGENCE_FUNNEL_STAGES) {
  const normalizedStageSequence = Array.isArray(stageSequence) ? stageSequence : SESSION_INTELLIGENCE_FUNNEL_STAGES;
  const byStage = buildStageCountMap(stageCounts);
  const transitions = [];

  for (let index = 0; index < normalizedStageSequence.length - 1; index += 1) {
    const fromStage = normalizedStageSequence[index];
    const toStage = normalizedStageSequence[index + 1];
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

function buildNormalizedTransitionMetrics({
  currentStageCounts,
  baselineStageCounts,
  stageSequence,
  config = SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
}) {
  const minimumReachedJourneys = safeFiniteNumber(config.minimumReachedJourneys, SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.minimumReachedJourneys);
  const shrinkagePriorStrengthJourneys = safeFiniteNumber(
    config.shrinkagePriorStrengthJourneys,
    SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.shrinkagePriorStrengthJourneys
  );
  const steadyGapThreshold = safeFiniteNumber(config.steadyGapThreshold, SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.steadyGapThreshold);

  const currentTransitions = buildTransitionCounts(currentStageCounts, stageSequence);
  const baselineTransitions = buildTransitionCounts(baselineStageCounts, stageSequence);
  const baselineByPair = new Map(baselineTransitions.map((transition) => [`${transition.fromStage}:${transition.toStage}`, transition]));

  return currentTransitions.map((transition) => {
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
}

export function buildNormalizedFunnelMetrics({
  currentJourneys,
  baselineJourneys,
  config = SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
}) {
  const normalizedCurrentJourneys = Array.isArray(currentJourneys) ? currentJourneys : [];
  const normalizedBaselineJourneys = Array.isArray(baselineJourneys) ? baselineJourneys : [];

  const currentStages = buildFunnelStageCounts(normalizedCurrentJourneys);
  const baselineStages = buildFunnelStageCounts(normalizedBaselineJourneys);
  const transitions = buildNormalizedTransitionMetrics({
    currentStageCounts: currentStages,
    baselineStageCounts: baselineStages,
    stageSequence: SESSION_INTELLIGENCE_FUNNEL_STAGES,
    config
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

export function getDownstreamPurchaseRateFromStages(stages, fromStageKey, countKey = 'reachedJourneys') {
  const normalizedFromStageKey = safeString(fromStageKey).trim().toLowerCase();
  if (!normalizedFromStageKey) return null;

  const fromStageReachedJourneys = getStageReachedJourneys(stages, normalizedFromStageKey, countKey);
  if (fromStageReachedJourneys <= 0) return null;

  const purchaseReachedJourneys = getStageReachedJourneys(stages, 'purchase', countKey);
  return Math.min(1, Math.max(0, purchaseReachedJourneys / fromStageReachedJourneys));
}

export function buildMoneyLeakEstimate({
  transition,
  stages,
  referenceAov,
  fallbackDownstreamPurchaseRate = null
}) {
  const normalizedTransition = transition && typeof transition === 'object' ? transition : null;
  if (!normalizedTransition) return null;

  const missedAdvancedJourneys = Math.max(0, safeFiniteNumber(normalizedTransition?.comparison?.missedAdvancedJourneys, 0));
  if (missedAdvancedJourneys <= 0) return null;

  const baselineDownstreamPurchaseRate = getDownstreamPurchaseRateFromStages(stages, normalizedTransition.toStage, 'baselineReachedJourneys');
  const currentDownstreamPurchaseRate = getDownstreamPurchaseRateFromStages(stages, normalizedTransition.toStage, 'reachedJourneys');
  const resolvedFallbackDownstreamPurchaseRate = Math.max(0, safeFiniteNumber(fallbackDownstreamPurchaseRate, 0));
  const downstreamPurchaseRate = baselineDownstreamPurchaseRate
    ?? currentDownstreamPurchaseRate
    ?? (resolvedFallbackDownstreamPurchaseRate > 0 ? resolvedFallbackDownstreamPurchaseRate : null);

  if (downstreamPurchaseRate == null) return null;

  const normalizedReferenceAov = Math.max(0, safeFiniteNumber(referenceAov, 0));
  const estimatedLostPurchases = missedAdvancedJourneys * downstreamPurchaseRate;
  const estimatedLostRevenue = estimatedLostPurchases * normalizedReferenceAov;

  return {
    missedAdvancedJourneys,
    baselineDownstreamPurchaseRate,
    currentDownstreamPurchaseRate,
    downstreamPurchaseRate,
    referenceAov: normalizedReferenceAov,
    estimatedLostPurchases,
    estimatedLostRevenue,
    rankingScore: Math.round(estimatedLostRevenue * MONEY_LEAK_SORT_PRECISION) / MONEY_LEAK_SORT_PRECISION
  };
}

export function rankMoneyLeakCandidates(candidates, limit = null) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate && typeof candidate === 'object')
    .slice()
    .sort((left, right) => {
      const rankingGap = safeFiniteNumber(right?.moneyLeak?.rankingScore, 0) - safeFiniteNumber(left?.moneyLeak?.rankingScore, 0);
      if (rankingGap !== 0) return rankingGap;

      const lostPurchaseGap = safeFiniteNumber(right?.moneyLeak?.estimatedLostPurchases, 0) - safeFiniteNumber(left?.moneyLeak?.estimatedLostPurchases, 0);
      if (lostPurchaseGap !== 0) return lostPurchaseGap;

      const missedJourneyGap = safeFiniteNumber(right?.moneyLeak?.missedAdvancedJourneys, 0) - safeFiniteNumber(left?.moneyLeak?.missedAdvancedJourneys, 0);
      if (missedJourneyGap !== 0) return missedJourneyGap;

      return safeString(left?.label).localeCompare(safeString(right?.label));
    });

  const normalizedLimit = limit == null
    ? null
    : (Number.isFinite(Number(limit)) ? Math.max(1, Math.trunc(Number(limit))) : null);
  return normalizedLimit ? ranked.slice(0, normalizedLimit) : ranked;
}

export function getAnchoredJourneyProduct(journeyRow) {
  const candidates = [
    {
      productId: journeyRow?.last_product_before_cart_id,
      productLabel: journeyRow?.last_product_before_cart_label,
      attributionSource: 'last_product_before_cart'
    },
    {
      productId: journeyRow?.last_product_id,
      productLabel: journeyRow?.last_product_label,
      attributionSource: 'last_product'
    },
    {
      productId: journeyRow?.first_product_id,
      productLabel: journeyRow?.first_product_label,
      attributionSource: 'first_product'
    }
  ];

  for (const candidate of candidates) {
    const productKey = buildProductKey(candidate);
    if (!productKey) continue;
    return {
      productKey,
      productId: safeString(candidate.productId).trim() || null,
      productLabel: safeString(candidate.productLabel).trim() || null,
      attributionSource: candidate.attributionSource
    };
  }

  return null;
}

function titleCaseSegmentLabel(value) {
  const normalized = safeString(value).trim();
  if (!normalized) return 'Unknown';
  return normalized
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeSourceSegmentLabel(entrySource) {
  const normalizedSource = safeString(entrySource).trim().toLowerCase();
  for (const [sourceKey, aliases] of Object.entries(SOURCE_SEGMENT_ALIASES)) {
    if (aliases.has(normalizedSource)) return SOURCE_SEGMENT_LABELS[sourceKey] || titleCaseSegmentLabel(sourceKey);
  }
  for (const [sourceKey, sourceLabel] of Object.entries(SOURCE_SEGMENT_LABELS)) {
    if (normalizedSource.includes(sourceKey)) return sourceLabel;
  }
  return titleCaseSegmentLabel(normalizedSource);
}

function normalizeDeviceSegmentLabel(journeyRow) {
  const normalizedDeviceOs = safeString(journeyRow?.entry_device_os).trim().toLowerCase();
  if (normalizedDeviceOs === 'ios') return 'iOS';
  if (normalizedDeviceOs === 'android') return 'Android';
  if (DESKTOP_DEVICE_OS_KEYS.has(normalizedDeviceOs)) return 'Desktop';

  const normalizedDeviceType = safeString(journeyRow?.entry_device_type).trim().toLowerCase();
  if (normalizedDeviceType === 'desktop') return 'Desktop';
  if (normalizedDeviceType === 'tablet') return 'Tablet';
  if (normalizedDeviceType === 'mobile') return 'Mobile';
  return 'Unknown';
}

function normalizeCountrySegmentLabel(entryCountryCode) {
  const normalizedCountry = safeString(entryCountryCode).trim();
  if (!normalizedCountry) return UNKNOWN_COUNTRY_LABEL;
  const upperCountry = normalizedCountry.toUpperCase();
  if (/^[A-Z]{2}$/.test(upperCountry)) {
    const displayName = REGION_DISPLAY_NAMES?.of(upperCountry);
    if (displayName) return displayName;
  }
  return titleCaseSegmentLabel(normalizedCountry);
}

function normalizeCampaignSegmentLabel(entryCampaign) {
  const normalizedCampaign = safeString(entryCampaign).trim().replace(/\s+/g, ' ');
  return normalizedCampaign || NO_CAMPAIGN_TAG_LABEL;
}

function buildJourneyCohorts(journeyRows, resolveCohort) {
  const cohorts = new Map();
  for (const journeyRow of Array.isArray(journeyRows) ? journeyRows : []) {
    const cohort = typeof resolveCohort === 'function' ? resolveCohort(journeyRow) : null;
    if (!cohort?.cohortKey) continue;
    const existing = cohorts.get(cohort.cohortKey) || {
      ...cohort,
      journeys: []
    };
    for (const [key, value] of Object.entries(cohort)) {
      if (key === 'journeys') continue;
      if ((existing[key] == null || existing[key] === '') && value != null && value !== '') {
        existing[key] = value;
      }
    }
    existing.journeys.push(journeyRow);
    cohorts.set(cohort.cohortKey, existing);
  }
  return cohorts;
}

function buildStagesWithBaseline(currentStages, baselineStages) {
  return currentStages.map((stage) => ({
    ...stage,
    baselineReachedJourneys: baselineStages.find((candidate) => candidate.stageKey === stage.stageKey)?.reachedJourneys ?? 0
  }));
}

function buildCohortPurchaseComparison(currentStages, baselineStages, currentJourneysCount, baselineJourneysCount) {
  const currentPurchaseCount = safeFiniteNumber(currentStages.find((stage) => stage.stageKey === 'purchase')?.reachedJourneys, 0);
  const baselinePurchaseCount = safeFiniteNumber(baselineStages.find((stage) => stage.stageKey === 'purchase')?.reachedJourneys, 0);
  const currentPurchaseRate = currentJourneysCount > 0 ? currentPurchaseCount / currentJourneysCount : null;
  const baselinePurchaseRate = baselineJourneysCount > 0 ? baselinePurchaseCount / baselineJourneysCount : null;
  const purchaseRateGap = baselinePurchaseRate != null && currentPurchaseRate != null
    ? baselinePurchaseRate - currentPurchaseRate
    : null;
  const expectedPurchases = baselinePurchaseRate != null ? currentJourneysCount * baselinePurchaseRate : null;
  const missedPurchases = expectedPurchases != null ? Math.max(0, expectedPurchases - currentPurchaseCount) : null;

  return {
    currentPurchaseCount,
    baselinePurchaseCount,
    currentPurchaseRate,
    baselinePurchaseRate,
    purchaseRateGap,
    expectedPurchases,
    missedPurchases
  };
}

function getPrimaryCohortComparison(transitions) {
  const normalizedTransitions = Array.isArray(transitions) ? transitions : [];
  const weakTransitions = normalizedTransitions.filter((transition) => transition?.comparison?.status === 'weaker_than_usual');
  if (weakTransitions.length) {
    return weakTransitions.sort((left, right) => {
      const missedGap = safeFiniteNumber(right?.comparison?.missedAdvancedJourneys, 0) - safeFiniteNumber(left?.comparison?.missedAdvancedJourneys, 0);
      if (missedGap !== 0) return missedGap;
      return safeFiniteNumber(right?.comparison?.gap, 0) - safeFiniteNumber(left?.comparison?.gap, 0);
    })[0];
  }

  return normalizedTransitions.find((transition) => transition?.comparison?.status === 'steady')
    || normalizedTransitions.find((transition) => transition?.comparison?.status === 'stronger_than_usual')
    || normalizedTransitions[0]
    || null;
}

function buildCohortRankingScore(primaryTransition, missedPurchases) {
  return Math.round((
    safeFiniteNumber(primaryTransition?.comparison?.missedAdvancedJourneys, 0)
    + safeFiniteNumber(missedPurchases, 0)
  ) * COHORT_COMPARISON_SORT_PRECISION) / COHORT_COMPARISON_SORT_PRECISION;
}

function sortComparableCohorts(items, labelKey) {
  items.sort((left, right) => {
    const scoreGap = safeFiniteNumber(right?.comparison?.rankingScore, 0) - safeFiniteNumber(left?.comparison?.rankingScore, 0);
    if (scoreGap !== 0) return scoreGap;
    const currentJourneyGap = safeFiniteNumber(right?.current?.journeys, 0) - safeFiniteNumber(left?.current?.journeys, 0);
    if (currentJourneyGap !== 0) return currentJourneyGap;
    return safeString(left?.[labelKey]).localeCompare(safeString(right?.[labelKey]));
  });
}

function buildComparableCohortMetrics({
  currentCohorts,
  baselineCohorts,
  stageSequence,
  config,
  buildOutput
}) {
  const items = [];

  for (const cohort of currentCohorts.values()) {
    const baselineCohort = baselineCohorts.get(cohort.cohortKey) || null;
    const currentStages = buildFunnelStageCounts(cohort.journeys, stageSequence);
    const baselineStages = buildFunnelStageCounts(baselineCohort?.journeys || [], stageSequence);
    const transitions = buildNormalizedTransitionMetrics({
      currentStageCounts: currentStages,
      baselineStageCounts: baselineStages,
      stageSequence,
      config
    });
    const currentJourneysCount = cohort.journeys.length;
    const baselineJourneysCount = baselineCohort?.journeys?.length || 0;
    const purchaseComparison = buildCohortPurchaseComparison(
      currentStages,
      baselineStages,
      currentJourneysCount,
      baselineJourneysCount
    );
    const primaryTransition = getPrimaryCohortComparison(transitions);
    const rankingScore = buildCohortRankingScore(primaryTransition, purchaseComparison.missedPurchases);

    items.push(buildOutput({
      cohort,
      baselineCohort,
      currentJourneysCount,
      baselineJourneysCount,
      currentStages,
      baselineStages,
      transitions,
      purchaseComparison,
      primaryTransition,
      rankingScore
    }));
  }

  return items;
}

function buildAnchoredProductCohorts(journeyRows) {
  return buildJourneyCohorts(journeyRows, (journeyRow) => {
    const anchoredProduct = getAnchoredJourneyProduct(journeyRow);
    if (!anchoredProduct) return null;
    return {
      cohortKey: anchoredProduct.productKey,
      productKey: anchoredProduct.productKey,
      productId: anchoredProduct.productId,
      productLabel: anchoredProduct.productLabel || 'Unknown product',
      attributionSource: anchoredProduct.attributionSource
    };
  });
}

export function getJourneySegment(journeyRow, dimension) {
  const normalizedDimension = safeString(dimension).trim().toLowerCase();
  if (normalizedDimension === 'device') {
    const segmentLabel = normalizeDeviceSegmentLabel(journeyRow);
    return {
      segmentKey: `device:${segmentLabel.toLowerCase()}`,
      segmentLabel,
      dimension: 'device'
    };
  }

  if (normalizedDimension === 'source') {
    const segmentLabel = normalizeSourceSegmentLabel(journeyRow?.entry_source);
    return {
      segmentKey: `source:${segmentLabel.toLowerCase()}`,
      segmentLabel,
      dimension: 'source'
    };
  }

  if (normalizedDimension === 'country') {
    const segmentLabel = normalizeCountrySegmentLabel(journeyRow?.entry_country_code);
    return {
      segmentKey: `country:${segmentLabel.toLowerCase().replace(/\s+/g, '_')}`,
      segmentLabel,
      dimension: 'country'
    };
  }

  if (normalizedDimension === 'campaign') {
    const segmentLabel = normalizeCampaignSegmentLabel(journeyRow?.entry_campaign);
    return {
      segmentKey: `campaign:${segmentLabel.toLowerCase().replace(/\s+/g, '_')}`,
      segmentLabel,
      dimension: 'campaign'
    };
  }

  return null;
}

function buildJourneySegmentCohorts(journeyRows, dimension) {
  return buildJourneyCohorts(journeyRows, (journeyRow) => {
    const segment = getJourneySegment(journeyRow, dimension);
    if (!segment) return null;
    return {
      cohortKey: segment.segmentKey,
      segmentKey: segment.segmentKey,
      segmentLabel: segment.segmentLabel,
      dimension: segment.dimension
    };
  });
}

export function buildNormalizedProductMetrics({
  currentJourneys,
  baselineJourneys,
  config = SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
}) {
  const normalizedCurrentJourneys = Array.isArray(currentJourneys) ? currentJourneys : [];
  const normalizedBaselineJourneys = Array.isArray(baselineJourneys) ? baselineJourneys : [];
  const currentCohorts = buildAnchoredProductCohorts(normalizedCurrentJourneys);
  const baselineCohorts = buildAnchoredProductCohorts(normalizedBaselineJourneys);
  const products = buildComparableCohortMetrics({
    currentCohorts,
    baselineCohorts,
    stageSequence: SESSION_INTELLIGENCE_PRODUCT_NORMALIZATION_STAGES,
    config,
    buildOutput: ({
      cohort,
      currentJourneysCount,
      baselineJourneysCount,
      currentStages,
      baselineStages,
      transitions,
      purchaseComparison,
      primaryTransition,
      rankingScore
    }) => ({
      productKey: cohort.productKey,
      productId: cohort.productId,
      productLabel: cohort.productLabel || 'Unknown product',
      attributionSource: cohort.attributionSource,
      current: {
        journeys: currentJourneysCount,
        purchases: purchaseComparison.currentPurchaseCount,
        purchaseRate: purchaseComparison.currentPurchaseRate
      },
      baseline: {
        journeys: baselineJourneysCount,
        purchases: purchaseComparison.baselinePurchaseCount,
        purchaseRate: purchaseComparison.baselinePurchaseRate
      },
      comparison: {
        primaryTransition,
        purchaseRateGap: purchaseComparison.purchaseRateGap,
        expectedPurchases: purchaseComparison.expectedPurchases,
        missedPurchases: purchaseComparison.missedPurchases,
        rankingScore
      },
      stages: buildStagesWithBaseline(currentStages, baselineStages),
      transitions
    })
  });

  sortComparableCohorts(products, 'productLabel');

  return {
    totals: {
      currentJourneys: normalizedCurrentJourneys.length,
      baselineJourneys: normalizedBaselineJourneys.length,
      currentProducts: products.length,
      baselineProducts: baselineCohorts.size
    },
    products
  };
}

export function buildNormalizedSegmentMetrics({
  currentJourneys,
  baselineJourneys,
  dimension,
  config = SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
}) {
  const normalizedDimension = safeString(dimension).trim().toLowerCase();
  if (!SESSION_INTELLIGENCE_SEGMENT_DIMENSIONS.includes(normalizedDimension)) {
    return {
      totals: {
        currentJourneys: Array.isArray(currentJourneys) ? currentJourneys.length : 0,
        baselineJourneys: Array.isArray(baselineJourneys) ? baselineJourneys.length : 0,
        currentSegments: 0,
        baselineSegments: 0
      },
      segments: []
    };
  }

  const normalizedCurrentJourneys = Array.isArray(currentJourneys) ? currentJourneys : [];
  const normalizedBaselineJourneys = Array.isArray(baselineJourneys) ? baselineJourneys : [];
  const currentCohorts = buildJourneySegmentCohorts(normalizedCurrentJourneys, normalizedDimension);
  const baselineCohorts = buildJourneySegmentCohorts(normalizedBaselineJourneys, normalizedDimension);
  const segments = buildComparableCohortMetrics({
    currentCohorts,
    baselineCohorts,
    stageSequence: SESSION_INTELLIGENCE_FUNNEL_STAGES,
    config,
    buildOutput: ({
      cohort,
      currentJourneysCount,
      baselineJourneysCount,
      currentStages,
      baselineStages,
      transitions,
      purchaseComparison,
      primaryTransition,
      rankingScore
    }) => ({
      segmentKey: cohort.segmentKey,
      segmentLabel: cohort.segmentLabel,
      dimension: cohort.dimension,
      current: {
        journeys: currentJourneysCount,
        purchases: purchaseComparison.currentPurchaseCount,
        purchaseRate: purchaseComparison.currentPurchaseRate,
        journeyShare: normalizedCurrentJourneys.length > 0 ? currentJourneysCount / normalizedCurrentJourneys.length : null
      },
      baseline: {
        journeys: baselineJourneysCount,
        purchases: purchaseComparison.baselinePurchaseCount,
        purchaseRate: purchaseComparison.baselinePurchaseRate,
        journeyShare: normalizedBaselineJourneys.length > 0 ? baselineJourneysCount / normalizedBaselineJourneys.length : null
      },
      comparison: {
        primaryTransition,
        purchaseRateGap: purchaseComparison.purchaseRateGap,
        expectedPurchases: purchaseComparison.expectedPurchases,
        missedPurchases: purchaseComparison.missedPurchases,
        rankingScore
      },
      stages: buildStagesWithBaseline(currentStages, baselineStages),
      transitions
    })
  });

  sortComparableCohorts(segments, 'segmentLabel');

  return {
    totals: {
      currentJourneys: normalizedCurrentJourneys.length,
      baselineJourneys: normalizedBaselineJourneys.length,
      currentSegments: segments.length,
      baselineSegments: baselineCohorts.size
    },
    segments
  };
}
