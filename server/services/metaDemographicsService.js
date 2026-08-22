import fetch from 'node-fetch';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import { getCountryInfo } from '../utils/countryData.js';
import { getExchangeRateForDate } from './metaService.js';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

const MIN_CLICKS = 30;
const Z_THRESHOLD = 2.0;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 3650;
const LEAK_MIN_ATC = 20;

const KEY_INSIGHT_THRESHOLDS = {
  genderConversionRatio: 1.2,
  genderConversionGap: 0.002,
  genderAtcGap: 0.01,
  wasteSevereRateFactor: 0.4,
  wasteMinSpendShare: 0.07,
  wasteSevereMinSpendShare: 0.03,
  sweetSpotRateFactor: 1.15,
  leakMinAtc: 50,
  leakMinDrop: 0.5,
  leakMinSpendShare: 0.03,
  countryRateFactor: 1.25,
  placementWasteMinSpendShare: 0.05,
  placementWasteRateFactor: 0.5,
  placementOpportunityMaxSpendShare: 0.12,
  placementOpportunityRateFactor: 1.4,
  deviceRateRatio: 1.4,
  maxKeyInsights: 8
};

const PURCHASE_ACTION_TYPES = [
  'omni_purchase',
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'offsite_conversion.purchase',
  'onsite_conversion.purchase'
];

const GENDER_LABELS = {
  female: 'Female',
  male: 'Male',
  all: 'All',
  unknown: 'Unknown'
};

const AGE_ORDER = [
  '13-17',
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55-64',
  '65+',
  'unknown'
];

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function getActionValue(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const action = actions.find((entry) => entry?.action_type === type);
  return action ? toNumber(action.value) : 0;
}

function getFirstActionValue(actions, types) {
  for (const type of types) {
    const value = getActionValue(actions, type);
    if (value) return value;
  }
  return 0;
}

function normalizeGender(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'female' || raw === 'f') return 'female';
  if (raw === 'male' || raw === 'm') return 'male';
  return raw || 'unknown';
}

function normalizeAge(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  return raw;
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function diffDaysInclusive(startDate, endDate) {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const diffMs = end.getTime() - start.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1);
}

function resolveRange({ days, startDate, endDate, yesterday } = {}) {
  const today = formatDateAsGmt3(new Date());

  if (yesterday === true || yesterday === '1' || yesterday === 1) {
    const y = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));
    return { startDate: y, endDate: y, days: 1, mode: 'yesterday' };
  }

  const hasCustom = isIsoDate(startDate) && isIsoDate(endDate);
  if (hasCustom) {
    if (startDate > endDate) {
      throw new Error('startDate must be <= endDate');
    }
    return {
      startDate,
      endDate,
      days: diffDaysInclusive(startDate, endDate) || null,
      mode: 'custom'
    };
  }

  const safeDays = Number.isFinite(Number(days))
    ? Math.max(1, Math.min(MAX_DAYS, Number(days)))
    : DEFAULT_DAYS;

  const computedStart = formatDateAsGmt3(new Date(Date.now() - (safeDays - 1) * 24 * 60 * 60 * 1000));
  return { startDate: computedStart, endDate: today, days: safeDays, mode: 'days' };
}

function getStoreConfig(store) {
  const normalized = store === 'shawq' ? 'shawq' : 'vironax';
  if (normalized === 'shawq') {
    return {
      store: 'shawq',
      adAccountId: process.env.SHAWQ_META_AD_ACCOUNT_ID,
      accessToken: process.env.SHAWQ_META_ACCESS_TOKEN
    };
  }

  return {
    store: 'vironax',
    adAccountId: process.env.META_AD_ACCOUNT_ID || process.env.VIRONAX_META_AD_ACCOUNT_ID,
    accessToken: process.env.META_ACCESS_TOKEN || process.env.VIRONAX_META_ACCESS_TOKEN
  };
}

function normalizeAccountId(accountId) {
  if (!accountId) return '';
  return accountId.replace(/^act_/, '');
}

function buildInsightsUrl({ accountId, accessToken, breakdowns, startDate, endDate, fields }) {
  const params = new URLSearchParams({
    access_token: accessToken,
    level: 'account',
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    breakdowns: breakdowns.join(','),
    fields,
    limit: '500'
  });

  return `${META_BASE_URL}/act_${accountId}/insights?${params.toString()}`;
}

function redactAccessToken(url) {
  return url.replace(/access_token=[^&]+/g, 'access_token=[REDACTED]');
}

async function fetchAllInsights({ accountId, accessToken, breakdowns, startDate, endDate, fields, filtering = null }) {
  const urlParams = new URLSearchParams({
    access_token: accessToken,
    level: 'account',
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    breakdowns: breakdowns.join(','),
    fields,
    limit: '500'
  });

  if (Array.isArray(filtering) && filtering.length > 0) {
    urlParams.set('filtering', JSON.stringify(filtering));
  }

  let url = `${META_BASE_URL}/act_${accountId}/insights?${urlParams.toString()}`;
  const allRows = [];
  let page = 0;

  while (url) {
    page += 1;
    const response = await fetch(url);
    const json = await response.json();

    if (json?.error) {
      const message = json.error.message || 'Meta API error';
      const error = new Error(message);
      error.meta = json.error;
      error.metaDebug = {
        breakdowns,
        fields,
        filtering,
        page,
        url: redactAccessToken(url),
        status: response.status
      };
      throw error;
    }

    const data = Array.isArray(json?.data) ? json.data : [];
    allRows.push(...data);
    url = json?.paging?.next || null;
  }

  return allRows;
}

function normalizeSegmentRow(row, segmentType, currencyRate = 1, actionsAvailable = true, defaults = {}) {
  const clicks = Math.round(toNumber(row.inline_link_clicks) || toNumber(row.clicks));
  const spend = toNumber(row.spend) * currencyRate;
  const impressions = Math.round(toNumber(row.impressions));

  const atc = actionsAvailable ? Math.round(getActionValue(row.actions, 'add_to_cart')) : 0;
  const checkout = actionsAvailable ? Math.round(getActionValue(row.actions, 'initiate_checkout')) : 0;
  const purchases = actionsAvailable ? Math.round(getFirstActionValue(row.actions, PURCHASE_ACTION_TYPES)) : 0;

  const gender = normalizeGender(row.gender ?? defaults.gender);
  const age = segmentType === 'age_gender' ? normalizeAge(row.age) : null;
  const country = segmentType === 'country_gender'
    ? String(row.country ?? defaults.country ?? 'ALL').toUpperCase()
    : null;

  const atcRate = actionsAvailable ? safeDivide(atc, clicks) : null;
  const checkoutRate = actionsAvailable ? safeDivide(checkout, clicks) : null;
  const purchaseRate = actionsAvailable ? safeDivide(purchases, clicks) : null;

  const eligible = clicks >= MIN_CLICKS;

  return {
    key: segmentType === 'age_gender'
      ? `${age || 'unknown'}-${gender}`
      : `${country || 'ALL'}-${gender}`,
    segmentType,
    age,
    country,
    gender,
    genderLabel: GENDER_LABELS[gender] || 'Unknown',
    clicks,
    impressions,
    spend,
    atc,
    checkout,
    purchases,
    atcRate,
    checkoutRate,
    purchaseRate,
    eligible,
    spendShare: 0,
    zScores: {
      atcRate: null,
      checkoutRate: null,
      purchaseRate: null
    }
  };
}

function normalizePlacementRow(row, currencyRate = 1, actionsAvailable = true) {
  const clicks = Math.round(toNumber(row.inline_link_clicks) || toNumber(row.clicks));
  const spend = toNumber(row.spend) * currencyRate;
  const impressions = Math.round(toNumber(row.impressions));

  const atc = actionsAvailable ? Math.round(getActionValue(row.actions, 'add_to_cart')) : 0;
  const checkout = actionsAvailable ? Math.round(getActionValue(row.actions, 'initiate_checkout')) : 0;
  const purchases = actionsAvailable ? Math.round(getFirstActionValue(row.actions, PURCHASE_ACTION_TYPES)) : 0;

  const publisherPlatform = String(row.publisher_platform || '').trim().toLowerCase() || 'unknown';
  const platformPosition = String(row.platform_position || '').trim().toLowerCase() || 'unknown';

  const atcRate = actionsAvailable ? safeDivide(atc, clicks) : null;
  const checkoutRate = actionsAvailable ? safeDivide(checkout, clicks) : null;
  const purchaseRate = actionsAvailable ? safeDivide(purchases, clicks) : null;

  const eligible = clicks >= MIN_CLICKS;

  return {
    key: `${publisherPlatform}-${platformPosition}`,
    segmentType: 'placement',
    publisherPlatform,
    platformPosition,
    clicks,
    impressions,
    spend,
    atc,
    checkout,
    purchases,
    atcRate,
    checkoutRate,
    purchaseRate,
    eligible,
    spendShare: 0,
    zScores: {
      atcRate: null,
      checkoutRate: null,
      purchaseRate: null
    }
  };
}

function normalizeDeviceRow(row, currencyRate = 1, actionsAvailable = true) {
  const clicks = Math.round(toNumber(row.inline_link_clicks) || toNumber(row.clicks));
  const spend = toNumber(row.spend) * currencyRate;
  const impressions = Math.round(toNumber(row.impressions));

  const atc = actionsAvailable ? Math.round(getActionValue(row.actions, 'add_to_cart')) : 0;
  const checkout = actionsAvailable ? Math.round(getActionValue(row.actions, 'initiate_checkout')) : 0;
  const purchases = actionsAvailable ? Math.round(getFirstActionValue(row.actions, PURCHASE_ACTION_TYPES)) : 0;

  const devicePlatform = String(row.device_platform || '').trim().toLowerCase() || 'unknown';

  const atcRate = actionsAvailable ? safeDivide(atc, clicks) : null;
  const checkoutRate = actionsAvailable ? safeDivide(checkout, clicks) : null;
  const purchaseRate = actionsAvailable ? safeDivide(purchases, clicks) : null;

  const eligible = clicks >= MIN_CLICKS;

  return {
    key: devicePlatform,
    segmentType: 'device',
    devicePlatform,
    clicks,
    impressions,
    spend,
    atc,
    checkout,
    purchases,
    atcRate,
    checkoutRate,
    purchaseRate,
    eligible,
    spendShare: 0,
    zScores: {
      atcRate: null,
      checkoutRate: null,
      purchaseRate: null
    }
  };
}

function computeSpendShare(rows) {
  const totalSpend = rows.reduce((sum, row) => sum + (Number.isFinite(row.spend) ? row.spend : 0), 0);
  rows.forEach((row) => {
    row.spendShare = totalSpend > 0 ? row.spend / totalSpend : 0;
  });
  return totalSpend;
}

async function mapWithConcurrencyLimit(items, concurrency, mapper) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const limit = Number.isFinite(Number(concurrency)) ? Math.max(1, Number(concurrency)) : 4;
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => (async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  })());

  await Promise.all(workers);
  return results;
}

function computeMetricStats(rows, metricKey) {
  const values = rows
    .filter((row) => row.eligible && Number.isFinite(row[metricKey]))
    .map((row) => row[metricKey]);

  if (values.length < 2) {
    return { mean: null, stdev: null, count: values.length };
  }

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdev = Math.sqrt(variance);

  return { mean, stdev, count: values.length };
}

function applyZScores(rows, metricKey) {
  const stats = computeMetricStats(rows, metricKey);
  rows.forEach((row) => {
    if (!row.eligible || !Number.isFinite(row[metricKey]) || !stats.stdev || stats.stdev === 0) {
      row.zScores[metricKey] = null;
      return;
    }
    row.zScores[metricKey] = (row[metricKey] - stats.mean) / stats.stdev;
  });
  return stats;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function titleCaseWords(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatCountryLabel(code) {
  const upper = String(code || '').toUpperCase();
  if (!upper || upper === 'UNKNOWN') return 'Unknown';
  if (upper === 'ALL') return 'All countries';
  const info = getCountryInfo(upper);
  return info?.name || upper;
}

function formatPlacementLabel(row) {
  const platform = titleCaseWords(row.publisherPlatform || 'Unknown');
  const position = titleCaseWords(row.platformPosition || 'Unknown');
  return `${platform} · ${position}`;
}

function formatDeviceLabel(row) {
  return titleCaseWords(row.devicePlatform || 'Unknown');
}

function formatSegmentLabel(row) {
  if (row.segmentType === 'age_gender') {
    const age = row.age || 'Unknown';
    return `${age} · ${row.genderLabel}`;
  }
  if (row.segmentType === 'country_gender') {
    const country = formatCountryLabel(row.country || 'ALL');
    return `${country} · ${row.genderLabel}`;
  }
  if (row.segmentType === 'placement') {
    return formatPlacementLabel(row);
  }
  if (row.segmentType === 'device') {
    return formatDeviceLabel(row);
  }
  return 'Unknown segment';
}

function buildInsights(rows) {
  const metrics = [
    { key: 'atcRate', label: 'ATC rate' },
    { key: 'checkoutRate', label: 'Checkout rate' },
    { key: 'purchaseRate', label: 'Purchase rate' }
  ];

  const insights = [];

  rows.forEach((row) => {
    if (!row.eligible) return;
    metrics.forEach((metric) => {
      const z = row.zScores[metric.key];
      if (!Number.isFinite(z) || Math.abs(z) < Z_THRESHOLD) return;

      const direction = z > 0 ? 'above' : 'below';
      const impact = z > 0 ? 'High' : 'Low';
      const type = z > 0 ? 'opportunity' : 'leak';
      const label = formatSegmentLabel(row);
      const metricValue = formatPercent(row[metric.key]);

      insights.push({
        id: `${row.segmentType}-${row.key}-${metric.key}`,
        title: `${label} is ${direction} average on ${metric.label}`,
        detail: `${label} has a ${metric.label} of ${formatPercent(row[metric.key])} (${Math.abs(z).toFixed(1)}σ ${direction} mean) with ${row.clicks} clicks and ${Math.round(row.spend)} spend.`,
        impact,
        type,
        text: `${label} is ${direction} average on ${metric.label} (${metricValue}; ${Math.abs(z).toFixed(1)}σ).`,
        metric: metric.key,
        zScore: z,
        segmentType: row.segmentType,
        clicks: row.clicks,
        spend: row.spend
      });
    });
  });

  return insights
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
    .slice(0, 12);
}

function buildKeyInsights({
  ageGenderSegments,
  countryGenderSegments,
  placementSegments,
  deviceSegments,
  ageActionsAvailable,
  countryActionsAvailable,
  placementActionsAvailable,
  deviceActionsAvailable
}) {
  const insights = [];
  const thresholds = KEY_INSIGHT_THRESHOLDS;

  const formatPct = (value) => {
    if (!Number.isFinite(value)) return '—';
    const pct = value * 100;
    const digits = pct < 0.1 ? 2 : 1;
    return `${pct.toFixed(digits)}%`;
  };

  const formatPp = (diff) => {
    if (!Number.isFinite(diff)) return '—';
    return `${(diff * 100).toFixed(1)}pp`;
  };

  const formatShare = (share) => {
    if (!Number.isFinite(share)) return '—';
    return `${Math.round(share * 100)}%`;
  };

  const genderShort = (gender) => (gender === 'female' ? 'F' : gender === 'male' ? 'M' : 'U');

  const eligibleAge = (ageGenderSegments || []).filter((row) =>
    row?.eligible && (row.gender === 'female' || row.gender === 'male')
  );

  const thresholdBase = eligibleAge.length
    ? eligibleAge
    : (Array.isArray(placementSegments) ? placementSegments.filter((row) => row?.eligible) : []);

  const totalClicks = thresholdBase.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const totalPurchases = thresholdBase.reduce((sum, row) => sum + (row.purchases || 0), 0);

  const keyMinClicks = totalClicks >= 30000 ? 600 : totalClicks >= 10000 ? 300 : totalClicks >= 3000 ? 200 : 100;
  const keyMinPurchases = totalPurchases >= 200 ? 20 : totalPurchases >= 60 ? 10 : 5;

  const anyActions = Boolean(ageActionsAvailable || countryActionsAvailable || placementActionsAvailable || deviceActionsAvailable);
  if (!anyActions) {
    return [
      {
        type: 'info',
        text: 'Meta did not return conversion actions for these breakdowns, so conversion-based insights are limited. Try widening the date window or verifying pixel events.'
      }
    ];
  }

  const overallPurchaseRateAge = ageActionsAvailable
    ? safeDivide(
      eligibleAge.reduce((sum, row) => sum + (row.purchases || 0), 0),
      Math.max(1, eligibleAge.reduce((sum, row) => sum + (row.clicks || 0), 0))
    )
    : null;

  // 1) Gender gap (only if meaningful)
  if (ageActionsAvailable) {
    const genderAgg = new Map();
    eligibleAge.forEach((row) => {
      if (!genderAgg.has(row.gender)) genderAgg.set(row.gender, { clicks: 0, atc: 0, purchases: 0 });
      const acc = genderAgg.get(row.gender);
      acc.clicks += row.clicks || 0;
      acc.atc += row.atc || 0;
      acc.purchases += row.purchases || 0;
    });

    const female = genderAgg.get('female');
    const male = genderAgg.get('male');
    if (female?.clicks >= keyMinClicks && male?.clicks >= keyMinClicks && (female.purchases + male.purchases) >= keyMinPurchases) {
      const femaleConv = female.purchases / Math.max(1, female.clicks);
      const maleConv = male.purchases / Math.max(1, male.clicks);
      const femaleAtc = female.atc / Math.max(1, female.clicks);
      const maleAtc = male.atc / Math.max(1, male.clicks);

      const womenLead = femaleConv > maleConv;
      const leadLabel = womenLead ? 'Women' : 'Men';
      const lagLabel = womenLead ? 'Men' : 'Women';
      const leadConv = womenLead ? femaleConv : maleConv;
      const lagConv = womenLead ? maleConv : femaleConv;
      const leadAtc = womenLead ? femaleAtc : maleAtc;
      const lagAtc = womenLead ? maleAtc : femaleAtc;

      const convGap = leadConv - lagConv;
      const convRatio = lagConv > 0 ? leadConv / lagConv : null;
      const meaningful = Number.isFinite(convRatio)
        ? (convRatio >= thresholds.genderConversionRatio && convGap >= thresholds.genderConversionGap)
        : (convGap >= thresholds.genderConversionGap);

      if (meaningful) {
        const atcPart = (Number.isFinite(leadAtc)
          && Number.isFinite(lagAtc)
          && Math.abs(leadAtc - lagAtc) >= thresholds.genderAtcGap)
          ? `; ATC ${formatPct(leadAtc)} vs ${formatPct(lagAtc)}`
          : '';

        insights.push({
          type: 'gender',
          text: `${leadLabel} convert ${formatPct(leadConv)} vs ${lagLabel} ${formatPct(lagConv)} (+${formatPp(convGap)})${atcPart}`
        });
      }
    }
  }

  // 2) Demographic waste (overspend) — requires meaningful spend + sample size.
  if (ageActionsAvailable && Number.isFinite(overallPurchaseRateAge) && overallPurchaseRateAge > 0) {
    const candidates = eligibleAge
      .filter((row) => Number.isFinite(row.spendShare) && Number.isFinite(row.purchaseRate))
      .filter((row) => row.clicks >= keyMinClicks);

    let worst = null;
    let worstScore = 0;

    candidates.forEach((row) => {
      const underPerf = Math.max(0, (overallPurchaseRateAge - row.purchaseRate) / overallPurchaseRateAge);
      const score = (row.spendShare || 0) * underPerf;
      if (score > worstScore) {
        worstScore = score;
        worst = row;
      }
    });

    if (worst) {
      const severe = worst.purchaseRate <= overallPurchaseRateAge * thresholds.wasteSevereRateFactor;
      const meaningfulSpend = (worst.spendShare >= thresholds.wasteMinSpendShare)
        || (worst.spendShare >= thresholds.wasteSevereMinSpendShare && severe);
      if (meaningfulSpend) {
        insights.push({
          type: 'waste',
          text: `Demographic waste: ${genderShort(worst.gender)} ${worst.age || 'Unknown'} is ${formatShare(worst.spendShare)} of spend but converts at ${formatPct(worst.purchaseRate)} (account ${formatPct(overallPurchaseRateAge)})`
        });
      }
    }
  }

  // 3) Best age sweet spot (click→purchase)
  if (ageActionsAvailable && Number.isFinite(overallPurchaseRateAge) && overallPurchaseRateAge > 0) {
    const ageAgg = new Map();
    eligibleAge.forEach((row) => {
      const age = row.age || 'unknown';
      if (age === 'unknown') return;
      if (!ageAgg.has(age)) ageAgg.set(age, { clicks: 0, purchases: 0 });
      const acc = ageAgg.get(age);
      acc.clicks += row.clicks || 0;
      acc.purchases += row.purchases || 0;
    });

    const bestAge = [...ageAgg.entries()]
      .map(([age, agg]) => ({ age, clicks: agg.clicks, purchases: agg.purchases, rate: agg.clicks > 0 ? agg.purchases / agg.clicks : null }))
      .filter((row) => row.clicks >= keyMinClicks && row.purchases >= keyMinPurchases && Number.isFinite(row.rate))
      .sort((a, b) => (b.rate || 0) - (a.rate || 0))[0];

    if (bestAge && bestAge.rate >= overallPurchaseRateAge * thresholds.sweetSpotRateFactor) {
      insights.push({
        type: 'sweetspot',
        text: `Sweet spot: Age ${bestAge.age} converts best at ${formatPct(bestAge.rate)} (account ${formatPct(overallPurchaseRateAge)})`
      });
    }
  }

  // 4) Funnel leak (ATC → checkout), only with enough ATCs.
  if (ageActionsAvailable) {
    const minAtc = Math.max(LEAK_MIN_ATC, thresholds.leakMinAtc);
    const leakCandidates = eligibleAge
      .filter((row) => Number.isFinite(row.atc) && Number.isFinite(row.checkout))
      .filter((row) => row.atc >= minAtc && row.clicks >= keyMinClicks)
      .map((row) => ({
        ...row,
        leak: row.atc > 0 ? 1 - (row.checkout / row.atc) : null
      }))
      .filter((row) => Number.isFinite(row.leak) && row.leak >= thresholds.leakMinDrop);

    const worstLeak = leakCandidates
      .sort((a, b) => ((b.leak || 0) * (b.spendShare || 0)) - ((a.leak || 0) * (a.spendShare || 0)))[0];

    if (worstLeak && worstLeak.spendShare >= thresholds.leakMinSpendShare) {
      insights.push({
        type: 'leak',
        text: `Funnel leak: ${genderShort(worstLeak.gender)} ${worstLeak.age || 'Unknown'} drops ${Math.round(worstLeak.leak * 100)}% from ATC→checkout (≥ ${minAtc} ATCs)`
      });
    }
  }

  // 5) Country standout (optional; full country name)
  if (countryActionsAvailable) {
    const countryAgg = new Map();
    (countryGenderSegments || []).forEach((row) => {
      if (!row?.eligible) return;
      const code = String(row.country || 'ALL').toUpperCase();
      if (!code || code === 'ALL' || code === 'UNKNOWN') return;
      if (!countryAgg.has(code)) countryAgg.set(code, { clicks: 0, purchases: 0 });
      const acc = countryAgg.get(code);
      acc.clicks += row.clicks || 0;
      acc.purchases += row.purchases || 0;
    });

    const rows = [...countryAgg.entries()]
      .map(([country, agg]) => ({ country, clicks: agg.clicks, purchases: agg.purchases, rate: agg.clicks > 0 ? agg.purchases / agg.clicks : null }))
      .filter((row) => row.clicks >= keyMinClicks && row.purchases >= keyMinPurchases && Number.isFinite(row.rate));

    const avg = safeDivide(
      rows.reduce((sum, row) => sum + row.purchases, 0),
      Math.max(1, rows.reduce((sum, row) => sum + row.clicks, 0))
    );

    const best = rows.sort((a, b) => (b.rate || 0) - (a.rate || 0))[0];
    if (best && Number.isFinite(avg) && avg > 0 && best.rate >= avg * thresholds.countryRateFactor) {
      insights.push({
        type: 'country',
        text: `Country: ${formatCountryLabel(best.country)} converts at ${formatPct(best.rate)} click→purchase (avg ${formatPct(avg)})`
      });
    }
  }

  // 6) Placement insights
  if (placementActionsAvailable && Array.isArray(placementSegments) && placementSegments.length) {
    const eligiblePlacements = placementSegments
      .filter((row) => row?.eligible && row.clicks >= keyMinClicks)
      .filter((row) => Number.isFinite(row.spendShare) && Number.isFinite(row.purchaseRate));

    const avg = safeDivide(
      eligiblePlacements.reduce((sum, row) => sum + (row.purchases || 0), 0),
      Math.max(1, eligiblePlacements.reduce((sum, row) => sum + (row.clicks || 0), 0))
    );

    if (Number.isFinite(avg) && avg > 0) {
      const worst = eligiblePlacements
        .filter((row) => row.spendShare >= thresholds.placementWasteMinSpendShare
          && row.purchaseRate <= avg * thresholds.placementWasteRateFactor)
        .sort((a, b) => ((b.spendShare || 0) * ((avg - b.purchaseRate) / avg)) - ((a.spendShare || 0) * ((avg - a.purchaseRate) / avg)))[0];

      if (worst) {
        insights.push({
          type: 'placement',
          text: `Placement waste: ${formatPlacementLabel(worst)} is ${formatShare(worst.spendShare)} of spend but converts at ${formatPct(worst.purchaseRate)} (avg ${formatPct(avg)})`
        });
      }

      const opportunity = eligiblePlacements
        .filter((row) => row.spendShare <= thresholds.placementOpportunityMaxSpendShare
          && row.purchaseRate >= avg * thresholds.placementOpportunityRateFactor
          && row.purchases >= keyMinPurchases)
        .sort((a, b) => (b.purchaseRate || 0) - (a.purchaseRate || 0))[0];

      if (opportunity) {
        insights.push({
          type: 'opportunity',
          text: `Placement opportunity: ${formatPlacementLabel(opportunity)} converts at ${formatPct(opportunity.purchaseRate)} on only ${formatShare(opportunity.spendShare)} of spend`
        });
      }
    }
  }

  // 7) Device insights
  if (deviceActionsAvailable && Array.isArray(deviceSegments) && deviceSegments.length) {
    const eligibleDevices = deviceSegments
      .filter((row) => row?.eligible && row.clicks >= keyMinClicks)
      .filter((row) => Number.isFinite(row.purchaseRate) && Number.isFinite(row.spendShare));

    const best = [...eligibleDevices].sort((a, b) => (b.purchaseRate || 0) - (a.purchaseRate || 0))[0];
    const worst = [...eligibleDevices].sort((a, b) => (a.purchaseRate || 0) - (b.purchaseRate || 0))[0];

    if (best && worst && best.key !== worst.key && worst.purchaseRate > 0) {
      const ratio = best.purchaseRate / worst.purchaseRate;
      if (Number.isFinite(ratio) && ratio >= thresholds.deviceRateRatio && best.purchases >= keyMinPurchases) {
        insights.push({
          type: 'device',
          text: `Device: ${formatDeviceLabel(best)} converts ${ratio.toFixed(1)}x better than ${formatDeviceLabel(worst)} (${formatPct(best.purchaseRate)} vs ${formatPct(worst.purchaseRate)})`
        });
      }
    }
  }

  if (insights.length === 0) {
    return [
      {
        type: 'info',
        text: 'No strong signals detected for this period. Try widening the date window, or use placements/devices tables to explore.'
      }
    ];
  }

  return insights.slice(0, thresholds.maxKeyInsights);
}

function sortAgeGender(rows) {
  return [...rows].sort((a, b) => {
    const ageIndexA = AGE_ORDER.indexOf(a.age || 'unknown');
    const ageIndexB = AGE_ORDER.indexOf(b.age || 'unknown');
    if (ageIndexA !== ageIndexB) {
      return (ageIndexA === -1 ? 999 : ageIndexA) - (ageIndexB === -1 ? 999 : ageIndexB);
    }
    return (a.gender || '').localeCompare(b.gender || '');
  });
}

export async function getMetaDemographics({ store = 'vironax', days, startDate, endDate, yesterday } = {}) {
  const { accessToken, adAccountId } = getStoreConfig(store);

  if (!accessToken || !adAccountId) {
    return {
      success: false,
      error: 'Missing Meta credentials for this store.'
    };
  }

  const normalizedAccountId = normalizeAccountId(adAccountId);
  let resolved;
  try {
    resolved = resolveRange({ days, startDate, endDate, yesterday });
  } catch (error) {
    return {
      success: false,
      error: error?.message || 'Invalid date range.'
    };
  }
  const safeDays = resolved.days;
  const resolvedEndDate = resolved.endDate;
  const resolvedStartDate = resolved.startDate;

  let currencyRate = 1;
  if (store === 'shawq') {
    const rate = await getExchangeRateForDate(resolvedEndDate);
    if (Number.isFinite(rate) && rate > 0) {
      currencyRate = rate;
    }
  }

  const warnings = [];

  const fetchWithFallback = async (breakdowns, { filtering = null, context = null } = {}) => {
    const fieldsWithValues = 'spend,impressions,clicks,inline_link_clicks,actions,action_values';
    const fieldsNoValues = 'spend,impressions,clicks,inline_link_clicks,actions';
    const fieldsNoActions = 'spend,impressions,clicks,inline_link_clicks';
    try {
      const rows = await fetchAllInsights({
        accountId: normalizedAccountId,
        accessToken,
        breakdowns,
        startDate: resolvedStartDate,
        endDate: resolvedEndDate,
        fields: fieldsWithValues,
        filtering
      });
      return { rows, actionsAvailable: true, actionValuesAvailable: true };
    } catch (error) {
      const message = error?.message || '';
      const debug = error?.metaDebug || {};
      console.warn('[MetaDemographics] Primary fetch failed', {
        context,
        breakdowns,
        fields: fieldsWithValues,
        code: error?.meta?.code,
        type: error?.meta?.type,
        fbtrace_id: error?.meta?.fbtrace_id,
        message,
        debug
      });

      if (message.includes('action_type') || message.includes('breakdown columns')) {
        warnings.push(`Meta does not allow action_values with breakdowns: ${breakdowns.join(', ')}`);
        try {
          const rows = await fetchAllInsights({
            accountId: normalizedAccountId,
            accessToken,
            breakdowns,
            startDate: resolvedStartDate,
            endDate: resolvedEndDate,
            fields: fieldsNoValues,
            filtering
          });
          return { rows, actionsAvailable: true, actionValuesAvailable: false };
        } catch (innerError) {
          const innerMessage = innerError?.message || '';
          const innerDebug = innerError?.metaDebug || {};
          console.warn('[MetaDemographics] Fallback without action_values failed', {
            context,
            breakdowns,
            fields: fieldsNoValues,
            code: innerError?.meta?.code,
            type: innerError?.meta?.type,
            fbtrace_id: innerError?.meta?.fbtrace_id,
            message: innerMessage,
            debug: innerDebug
          });

          if (innerMessage.includes('action_type') || innerMessage.includes('breakdown columns')) {
            warnings.push(`Meta does not allow actions with breakdowns: ${breakdowns.join(', ')}`);
            const rows = await fetchAllInsights({
              accountId: normalizedAccountId,
              accessToken,
              breakdowns,
              startDate: resolvedStartDate,
              endDate: resolvedEndDate,
              fields: fieldsNoActions,
              filtering
            });
            return { rows, actionsAvailable: false, actionValuesAvailable: false };
          }
          throw innerError;
        }
      }
      throw error;
    }
  };

  const [ageGenderResult, countryOnlyResult, placementResult, deviceResult] = await Promise.all([
    fetchWithFallback(['age', 'gender']),
    fetchWithFallback(['country']),
    fetchWithFallback(['publisher_platform', 'platform_position']),
    fetchWithFallback(['device_platform'])
  ]);

  const ageGenderSegments = ageGenderResult.rows.map((row) => (
    normalizeSegmentRow(row, 'age_gender', currencyRate, ageGenderResult.actionsAvailable)
  ));
  const countryOnlySegments = countryOnlyResult.rows.map((row) => (
    normalizeSegmentRow(row, 'country_gender', currencyRate, countryOnlyResult.actionsAvailable, { gender: 'all' })
  ));
  const placementSegments = placementResult.rows.map((row) => (
    normalizePlacementRow(row, currencyRate, placementResult.actionsAvailable)
  ));
  const deviceSegments = deviceResult.rows.map((row) => (
    normalizeDeviceRow(row, currencyRate, deviceResult.actionsAvailable)
  ));

  // Meta insights blocks breakdowns=country,gender (OAuthException #100), so we emulate the split by:
  // 1) Fetching country totals (above).
  // 2) For the top countries, fetching breakdowns=gender with a country filter.
  let countryGenderSegments = [];
  let countryGenderSplitAvailable = false;
  let countryGenderSplitMode = 'unavailable';

  const topCountries = Array.from(new Set(
    [...countryOnlySegments]
      .sort((a, b) => (b.spend || 0) - (a.spend || 0))
      .map((row) => (row.country || '').toUpperCase())
      .filter((code) => code && code !== 'ALL' && code !== 'UNKNOWN')
      .slice(0, 18)
  ));

  if (topCountries.length > 0) {
    try {
      const perCountryResults = await mapWithConcurrencyLimit(topCountries, 4, async (country) => {
        const filtering = [{ field: 'country', operator: 'IN', value: [country] }];
        const result = await fetchWithFallback(['gender'], { filtering, context: { country } });
        const segments = (result.rows || []).map((row) => (
          normalizeSegmentRow(row, 'country_gender', currencyRate, result.actionsAvailable, { country })
        ));
        return { country, segments };
      });

      const combined = perCountryResults
        .flatMap((entry) => entry?.segments || [])
        .filter((row) => row?.country && row?.gender);

      if (combined.length > 0) {
        countryGenderSegments = combined;
        countryGenderSplitAvailable = true;
        countryGenderSplitMode = 'per_country_filter';
      } else {
        warnings.push('Meta did not return any country gender segments; showing country totals only.');
        countryGenderSegments = countryOnlySegments;
        countryGenderSplitAvailable = false;
        countryGenderSplitMode = 'unavailable';
      }
    } catch (error) {
      console.warn('[MetaDemographics] Country gender split fallback failed', {
        message: error?.message || String(error),
        meta: error?.meta || null,
        debug: error?.metaDebug || null
      });
      warnings.push('Meta does not support country + gender breakdown; showing country totals only.');
      countryGenderSegments = countryOnlySegments;
      countryGenderSplitAvailable = false;
      countryGenderSplitMode = 'unavailable';
    }
  } else {
    warnings.push('Meta did not return country data; country breakdown unavailable.');
    countryGenderSegments = [];
    countryGenderSplitAvailable = false;
    countryGenderSplitMode = 'unavailable';
  }

  const totalSpendAge = computeSpendShare(ageGenderSegments);
  const totalSpendCountry = computeSpendShare(countryGenderSegments);
  const totalSpendPlacement = computeSpendShare(placementSegments);
  const totalSpendDevice = computeSpendShare(deviceSegments);

  const ageStats = {
    atcRate: applyZScores(ageGenderSegments, 'atcRate'),
    checkoutRate: applyZScores(ageGenderSegments, 'checkoutRate'),
    purchaseRate: applyZScores(ageGenderSegments, 'purchaseRate')
  };

  const countryStats = {
    atcRate: applyZScores(countryGenderSegments, 'atcRate'),
    checkoutRate: applyZScores(countryGenderSegments, 'checkoutRate'),
    purchaseRate: applyZScores(countryGenderSegments, 'purchaseRate')
  };

  const placementStats = {
    atcRate: applyZScores(placementSegments, 'atcRate'),
    checkoutRate: applyZScores(placementSegments, 'checkoutRate'),
    purchaseRate: applyZScores(placementSegments, 'purchaseRate')
  };

  const deviceStats = {
    atcRate: applyZScores(deviceSegments, 'atcRate'),
    checkoutRate: applyZScores(deviceSegments, 'checkoutRate'),
    purchaseRate: applyZScores(deviceSegments, 'purchaseRate')
  };

  const insights = buildInsights([...ageGenderSegments, ...countryGenderSegments, ...placementSegments, ...deviceSegments]);
  const countryActionsAvailable = countryGenderSegments.some((row) =>
    row.atcRate !== null || row.checkoutRate !== null || row.purchaseRate !== null
  );

  const placementActionsAvailable = placementResult.actionsAvailable;
  const deviceActionsAvailable = deviceResult.actionsAvailable;

  const keyInsights = buildKeyInsights({
    ageGenderSegments,
    countryGenderSegments,
    placementSegments,
    deviceSegments,
    ageActionsAvailable: ageGenderResult.actionsAvailable,
    countryActionsAvailable,
    placementActionsAvailable,
    deviceActionsAvailable
  });

  const totals = ageGenderSegments.reduce((acc, row) => {
    acc.spend += row.spend;
    acc.impressions += row.impressions;
    acc.clicks += row.clicks;
    acc.atc += row.atc;
    acc.checkout += row.checkout;
    acc.purchases += row.purchases;
    return acc;
  }, { spend: 0, impressions: 0, clicks: 0, atc: 0, checkout: 0, purchases: 0 });

  const totalsRates = {
    atcRate: ageGenderResult.actionsAvailable ? safeDivide(totals.atc, totals.clicks) : null,
    checkoutRate: ageGenderResult.actionsAvailable ? safeDivide(totals.checkout, totals.clicks) : null,
    purchaseRate: ageGenderResult.actionsAvailable ? safeDivide(totals.purchases, totals.clicks) : null
  };

  return {
    success: true,
    data: {
      updatedAt: new Date().toISOString(),
      range: { startDate: resolvedStartDate, endDate: resolvedEndDate, days: safeDays },
      warnings,
      flags: {
        ageActionsAvailable: ageGenderResult.actionsAvailable,
        countryActionsAvailable,
        placementActionsAvailable,
        deviceActionsAvailable,
        ageActionValuesAvailable: ageGenderResult.actionValuesAvailable,
        countryActionValuesAvailable: false,
        placementActionValuesAvailable: placementResult.actionValuesAvailable,
        deviceActionValuesAvailable: deviceResult.actionValuesAvailable,
        countryGenderSplitAvailable,
        countryGenderSplitMode
      },
      totals,
      totalsRates,
      segmentCounts: {
        ageGender: ageGenderSegments.length,
        countryGender: countryGenderSegments.length,
        placement: placementSegments.length,
        device: deviceSegments.length,
        eligibleAgeGender: ageGenderSegments.filter((row) => row.eligible).length,
        eligibleCountryGender: countryGenderSegments.filter((row) => row.eligible).length,
        eligiblePlacement: placementSegments.filter((row) => row.eligible).length,
        eligibleDevice: deviceSegments.filter((row) => row.eligible).length
      },
      segments: {
        ageGender: sortAgeGender(ageGenderSegments),
        countryGender: [...countryGenderSegments].sort((a, b) => b.spend - a.spend),
        placement: [...placementSegments].sort((a, b) => b.spend - a.spend),
        device: [...deviceSegments].sort((a, b) => b.spend - a.spend)
      },
      spendTotals: {
        ageGender: totalSpendAge,
        countryGender: totalSpendCountry,
        placement: totalSpendPlacement,
        device: totalSpendDevice
      },
      stats: {
        ageGender: ageStats,
        countryGender: countryStats,
        placement: placementStats,
        device: deviceStats
      },
      keyInsights,
      insights,
      rules: {
        minClicks: MIN_CLICKS,
        zThreshold: Z_THRESHOLD
      }
    }
  };
}
