const NORMALIZED_BRIEF_CONFIG = Object.freeze({
  purchaseDecimalPlaces: 1,
  nearIntegerDelta: 0.15
});
const SEGMENT_DIMENSION_PRIORITY = Object.freeze(['device', 'source', 'country', 'campaign']);

function safeString(value) {
  if (value == null) return '';
  return String(value);
}

function safeFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function formatStoreLabel(store) {
  const normalized = safeString(store).trim();
  if (!normalized) return 'the store';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatApproximatePurchases(value) {
  const normalized = Math.max(0, safeFiniteNumber(value, 0));
  if (Math.abs(normalized - Math.round(normalized)) <= NORMALIZED_BRIEF_CONFIG.nearIntegerDelta) {
    return String(Math.round(normalized));
  }
  return normalized.toFixed(NORMALIZED_BRIEF_CONFIG.purchaseDecimalPlaces).replace(/\.0$/, '');
}

function getPurchaseStageCount(funnelReport) {
  return safeFiniteNumber(
    funnelReport?.data?.stages?.find((stage) => stage?.stageKey === 'purchase')?.reachedJourneys,
    0
  );
}

function pickTopCandidate(candidates) {
  return Array.isArray(candidates) && candidates.length ? candidates[0] : null;
}

function pickTopSegment(segmentGroups) {
  const groups = segmentGroups && typeof segmentGroups === 'object' ? segmentGroups : {};
  for (const dimension of SEGMENT_DIMENSION_PRIORITY) {
    const candidate = pickTopCandidate(groups[dimension]);
    if (candidate) return candidate;
  }
  return null;
}

function buildTopLeakSentence(topLeak) {
  if (!topLeak) return null;
  const transitionLabel = safeString(topLeak?.transition?.label).trim() || 'the weakest step';
  const lostPurchases = formatApproximatePurchases(topLeak?.moneyLeak?.estimatedLostPurchases);

  if (topLeak.scope === 'product') {
    return `The biggest product drag was ${topLeak.label}, where ${transitionLabel.toLowerCase()} ran weaker than usual and put about ${lostPurchases} purchases at risk.`;
  }

  if (topLeak.scope === 'segment') {
    const dimensionLabel = safeString(topLeak.dimension).trim();
    return `The weakest shopper segment was ${topLeak.label}${dimensionLabel ? ` on ${dimensionLabel}` : ''}, where ${transitionLabel.toLowerCase()} ran weaker than usual.`;
  }

  return `The clearest money leak was ${transitionLabel}, which ran weaker than usual and put about ${lostPurchases} purchases at risk.`;
}

function buildProductSentence(productLeak, topLeak) {
  if (!productLeak || topLeak?.scope === 'product' || topLeak?.productKey === productLeak?.productKey) return null;
  const transitionLabel = safeString(productLeak?.transition?.label).trim() || 'the product funnel';
  return `${productLeak.label} also stood out, with ${transitionLabel.toLowerCase()} running weaker than usual.`;
}

function buildSegmentSentence(segmentLeak, topLeak) {
  if (!segmentLeak || topLeak?.scope === 'segment') return null;
  const transitionLabel = safeString(segmentLeak?.transition?.label).trim() || 'the funnel';
  return `${segmentLeak.label} shoppers were also weaker than usual, especially around ${transitionLabel.toLowerCase()}.`;
}

export function buildSessionIntelligenceNormalizedBrief({
  store,
  date,
  funnelReport,
  moneyLeakReport
}) {
  const currentJourneys = safeFiniteNumber(moneyLeakReport?.data?.currentPeriod?.totalJourneys, 0);
  const purchases = getPurchaseStageCount(funnelReport);
  const topLeak = pickTopCandidate(moneyLeakReport?.data?.topLeaks);
  const topProductLeak = pickTopCandidate(moneyLeakReport?.data?.productLeaks);
  const topSegmentLeak = pickTopSegment(moneyLeakReport?.data?.segmentLeaks);

  const sentences = [
    `On ${safeString(date).trim() || safeString(moneyLeakReport?.data?.currentPeriod?.label).trim() || 'the selected day'}, ${formatStoreLabel(store)} had ${currentJourneys} stitched shopper journeys and ${purchases} purchases.`
  ];

  const topLeakSentence = buildTopLeakSentence(topLeak);
  if (topLeakSentence) {
    sentences.push(topLeakSentence);
  } else {
    sentences.push('The main funnel steps stayed within their usual range, so no clear money leak stood out in the current sample.');
  }

  const productSentence = buildProductSentence(topProductLeak, topLeak);
  if (productSentence) sentences.push(productSentence);

  const segmentSentence = buildSegmentSentence(topSegmentLeak, topLeak);
  if (segmentSentence) sentences.push(segmentSentence);

  if (!topLeakSentence && !productSentence && !segmentSentence) {
    sentences.push('Keep watching for more traffic before forcing a fix, because the normalized signals are still quiet.');
  }

  return sentences.join(' ');
}
