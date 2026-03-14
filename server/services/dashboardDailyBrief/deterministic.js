import {
  DASHBOARD_DAILY_BRIEF_DEFAULTS,
  DASHBOARD_DAILY_BRIEF_THRESHOLDS
} from './constants.js';
import {
  coerceSingleParagraphText,
  formatAmount,
  formatCount,
  formatMetric,
  formatPercentFromRatio,
  normalizeParagraph,
  round,
  safeDivide,
  toFiniteNumber
} from './utils.js';

const GLM_REWRITE_MARKERS = Object.freeze([
  'let me analyze',
  'i need to write',
  'wait,',
  'key facts from the available data',
  'key facts from the packet',
  'important observations',
  'comparisons:',
  'closed day (',
  'return strict json',
  'the packet:',
  'payload',
  'json'
]);

const FUNNEL_STEP_PRIORITY = Object.freeze([
  { key: 'purchaseIc', label: 'checkout-to-purchase' },
  { key: 'atcLpv', label: 'landing-page-to-cart' },
  { key: 'lpvClick', label: 'click-to-landing-page' },
  { key: 'icAtc', label: 'cart-to-checkout' },
  { key: 'ctr', label: 'click-through rate' }
]);

function scoreEntity(row = {}) {
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  let score = 0;

  if (flags.includes('winner')) score += 100;
  if (flags.includes('zero_purchase_spend')) score += 90;
  if (flags.includes('weak_roas')) score += 80;
  if (flags.includes('new_conversion_signal')) score += 70;
  if (flags.includes('purchase_ic_down')) score += 60;
  if (flags.includes('atc_lpv_down')) score += 50;

  score += toFiniteNumber(row?.spendShare) || 0;
  score += (toFiniteNumber(row?.metaPurchases) || 0) / 1000;
  score += (toFiniteNumber(row?.spend) || 0) / 100000;

  return score;
}

function scoreGeo(row = {}) {
  const flags = Array.isArray(row?.flags) ? row.flags : [];
  let score = 0;

  if (flags.includes('weak_roas')) score += 90;
  if (flags.includes('roas_down_vs_baseline')) score += 80;
  if (flags.includes('purchase_ic_down')) score += 70;

  score += (toFiniteNumber(row?.metaPurchases) || 0) / 1000;
  score += (toFiniteNumber(row?.spend) || 0) / 100000;

  return score;
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
    const rankedRows = [...group.rows]
      .filter((candidate) => candidate && ((toFiniteNumber(candidate?.spend) || 0) > 0 || (Array.isArray(candidate?.flags) && candidate.flags.length > 0)))
      .sort((left, right) => scoreEntity(right) - scoreEntity(left));
    const row = rankedRows[0] || null;
    if (row) {
      return { ...row, entityLabel: group.label };
    }
  }

  return null;
}

function pickPrimaryGeo(packet = {}) {
  const geoRows = Array.isArray(packet?.topGeos) ? packet.topGeos : [];
  if (!geoRows.length) return null;

  const rankedRows = [...geoRows]
    .filter((row) => row && ((toFiniteNumber(row?.spend) || 0) > 0 || (Array.isArray(row?.flags) && row.flags.length > 0)))
    .sort((left, right) => scoreGeo(right) - scoreGeo(left));

  return rankedRows[0] || null;
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
  return `The available campaign data does not contain usable Meta delivery rows, campaign rows, or funnel movement for the day, so there is insufficient paid-media evidence to attribute the result to campaign behavior${hasRecentChanges ? '; recent budget edits are present but are not interpretable without delivery data.' : '.'}`;
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

  if (spendShareText || roas || (toFiniteNumber(entity?.metaPurchases) || 0) > 0) {
    return `The largest named ${entity.entityLabel} in the day’s mix was *${entity.name}*${spendShareText ? ` at ${spendShareText}` : ''}${roas ? ` with ROAS ${roas}` : ''}, but it did not separate enough from the rest to explain the whole day on its own.`;
  }

  return 'No single campaign, ad set, or ad separated clearly enough to explain the day on its own.';
}

function buildGeoSentence(packet = {}) {
  const geo = pickPrimaryGeo(packet);
  if (!geo) return '';

  const flags = Array.isArray(geo?.flags) ? geo.flags : [];
  const roas = formatMetric(geo?.roas);
  if (flags.length > 0) {
    return `The clearest country-level signal came from *${geo.code}*${roas ? ` with ROAS ${roas}` : ''}.`;
  }

  if ((toFiniteNumber(geo?.spend) || 0) > 0 || (toFiniteNumber(geo?.metaPurchases) || 0) > 0) {
    return `No single country clearly broke from the rest, although *${geo.code}* carried the largest visible geo signal.`;
  }

  return '';
}

function buildRecentChangeSentence(packet = {}) {
  const latestChange = Array.isArray(packet?.recentChanges) ? packet.recentChanges[0] : null;
  if (!latestChange?.date) return '';

  const budgetShiftPercent = toFiniteNumber(latestChange?.budgetShiftPercent);
  const spendShiftPercent = toFiniteNumber(latestChange?.metadata?.spendShiftPercent);
  if (Number.isFinite(budgetShiftPercent)) {
    return `A budget shift on ${latestChange.date} (${budgetShiftPercent < 0 ? '' : '+'}${round(budgetShiftPercent, 1)}%) is recent enough to watch, but the available campaign data does not prove it caused the move.`;
  }

  if (Number.isFinite(spendShiftPercent)) {
    return `A spend shift on ${latestChange.date} (${spendShiftPercent < 0 ? '' : '+'}${round(spendShiftPercent, 1)}%) is recent enough to watch, but the available campaign data does not prove it caused the day on its own.`;
  }

  if (latestChange?.title) {
    return `${latestChange.title} on ${latestChange.date} is recent enough to watch, but the available campaign data does not prove it caused the move.`;
  }

  return `A recent structural change on ${latestChange.date} is worth watching, but the available campaign data does not prove it caused the move.`;
}

function buildExecutiveImplicationSentence(packet = {}) {
  const account = packet?.account || {};
  const revenueDelta = toFiniteNumber(account?.vsPriorDay?.revenue);
  const orderDelta = toFiniteNumber(account?.vsPriorDay?.shopifyOrders);
  const strongestDelta = Number.isFinite(revenueDelta) ? revenueDelta : orderDelta;
  const funnelShift = pickPrimaryFunnelShift(packet);

  if (!hasUsableMetaSignal(packet)) {
    return 'The next step is to restore campaign data visibility before taking optimization action from this brief.';
  }

  if (
    Number.isFinite(strongestDelta)
    && strongestDelta <= -DASHBOARD_DAILY_BRIEF_THRESHOLDS.inLineDeltaRatio
    && funnelShift
    && funnelShift.ratio > DASHBOARD_DAILY_BRIEF_THRESHOLDS.meaningfulFunnelDeltaRatio
  ) {
    return 'The practical read is a softer commercial day with only partial funnel strength, so this should be treated as signal to confirm rather than a recovery to trust yet.';
  }

  return 'The practical implication is to treat this as directional evidence and wait for the next closed day before making a broader structural change.';
}

function buildDeterministicExecutiveParagraph(packet = {}) {
  const parts = [buildCommercialLead(packet), buildBaselinePaceSentence(packet?.account)];

  if (!hasUsableMetaSignal(packet)) {
    parts.push(buildNoMetaSignalSentence(packet));
  } else {
    parts.push(buildFunnelSentence(packet));
    parts.push(buildEntitySentence(packet));
    parts.push(buildGeoSentence(packet));
    parts.push(buildRecentChangeSentence(packet));
  }
  parts.push(buildExecutiveImplicationSentence(packet));

  return normalizeParagraph(parts.filter(Boolean).join(' '));
}

function needsGlmExecutiveRewrite(paragraph) {
  const normalized = coerceSingleParagraphText(paragraph).toLowerCase();
  if (!normalized) return true;
  return GLM_REWRITE_MARKERS.some((marker) => normalized.includes(marker));
}

export function resolveDashboardDailyBriefParagraph({ packet, llmResponse, parsedParagraph, rawResponseText }) {
  const rawParagraph = normalizeParagraph(parsedParagraph, normalizeParagraph(rawResponseText, 'No daily brief was produced.'));
  if (!isGlmModel(llmResponse?.model)) {
    return rawParagraph;
  }
  if (!needsGlmExecutiveRewrite(rawParagraph)) {
    return rawParagraph;
  }
  return buildDeterministicExecutiveParagraph(packet);
}
