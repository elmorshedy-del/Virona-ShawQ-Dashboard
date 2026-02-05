import fetch from 'node-fetch';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import { getExchangeRateForDate } from './metaService.js';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

const MIN_CLICKS = 30;
const Z_THRESHOLD = 2.0;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 3650;
const LEAK_MIN_ATC = 20;

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

function formatSegmentLabel(row) {
  if (row.segmentType === 'age_gender') {
    const age = row.age || 'Unknown';
    return `${age} · ${row.genderLabel}`;
  }
  const country = row.country || 'ALL';
  return `${country} · ${row.genderLabel}`;
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

function buildKeyInsights({ ageGenderSegments, countryGenderSegments, actionsAvailable, countryActionsAvailable }) {
  if (!actionsAvailable) {
    return [
      {
        type: 'waste',
        text: 'Meta did not return conversion actions for this breakdown, so demographic conversion insights are limited. Try widening the date window.'
      }
    ];
  }

  const eligibleAge = (ageGenderSegments || []).filter((row) => row?.eligible);
  const insights = [];

  const formatPct = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;
  const genderShort = (gender) => (gender === 'female' ? 'F' : gender === 'male' ? 'M' : 'U');

  // 1) Gender gap
  const genderAgg = new Map();
  eligibleAge.forEach((row) => {
    const gender = row.gender;
    if (gender !== 'female' && gender !== 'male') return;
    if (!genderAgg.has(gender)) {
      genderAgg.set(gender, { clicks: 0, atc: 0, purchases: 0 });
    }
    const acc = genderAgg.get(gender);
    acc.clicks += row.clicks || 0;
    acc.atc += row.atc || 0;
    acc.purchases += row.purchases || 0;
  });

  const female = genderAgg.get('female');
  const male = genderAgg.get('male');
  if (female?.clicks >= MIN_CLICKS && male?.clicks >= MIN_CLICKS) {
    const femaleConv = female.purchases / Math.max(1, female.clicks);
    const maleConv = male.purchases / Math.max(1, male.clicks);
    const femaleAtc = female.atc / Math.max(1, female.clicks);
    const maleAtc = male.atc / Math.max(1, male.clicks);

    const womenLead = femaleConv >= maleConv;
    const leadLabel = womenLead ? 'Women' : 'Men';
    const lagLabel = womenLead ? 'Men' : 'Women';
    const leadConv = womenLead ? femaleConv : maleConv;
    const lagConv = womenLead ? maleConv : femaleConv;
    const leadAtc = womenLead ? femaleAtc : maleAtc;
    const lagAtc = womenLead ? maleAtc : femaleAtc;

    const atcRatio = lagAtc > 0 ? (leadAtc / lagAtc) : null;

    insights.push({
      type: 'gender',
      text: `${leadLabel} convert at ${formatPct(leadConv)} vs ${lagLabel} ${formatPct(lagConv)} — ${atcRatio ? `${atcRatio.toFixed(1)}x` : '—'} better ATC rate`
    });
  }

  // 2) Worst overspend (high spend share + low purchase rate)
  const spendCandidates = eligibleAge
    .filter((row) => Number.isFinite(row.spendShare) && Number.isFinite(row.purchaseRate))
    .sort((a, b) => (b.spendShare || 0) - (a.spendShare || 0))
    .slice(0, 10);

  if (spendCandidates.length) {
    const worst = [...spendCandidates].sort((a, b) => {
      const aRate = Number.isFinite(a.purchaseRate) ? a.purchaseRate : 1;
      const bRate = Number.isFinite(b.purchaseRate) ? b.purchaseRate : 1;
      if (aRate !== bRate) return aRate - bRate;
      return (b.spendShare || 0) - (a.spendShare || 0);
    })[0];

    if (worst) {
      insights.push({
        type: 'waste',
        text: `${genderShort(worst.gender)} ${worst.age || 'Unknown'} gets ${Math.round((worst.spendShare || 0) * 100)}% of budget but converts at only ${formatPct(worst.purchaseRate)} — worst overspend`
      });
    }
  }

  // 3) Best age sweet spot (click→purchase)
  const ageAgg = new Map();
  eligibleAge.forEach((row) => {
    const age = row.age || 'unknown';
    if (!ageAgg.has(age)) ageAgg.set(age, { clicks: 0, purchases: 0 });
    const acc = ageAgg.get(age);
    acc.clicks += row.clicks || 0;
    acc.purchases += row.purchases || 0;
  });

  const bestAge = [...ageAgg.entries()]
    .map(([age, agg]) => ({ age, clicks: agg.clicks, purchases: agg.purchases, rate: agg.clicks > 0 ? agg.purchases / agg.clicks : null }))
    .filter((row) => row.clicks >= MIN_CLICKS && Number.isFinite(row.rate))
    .sort((a, b) => (b.rate || 0) - (a.rate || 0))[0];

  if (bestAge) {
    insights.push({
      type: 'sweetspot',
      text: `Age ${bestAge.age} has best click→purchase at ${formatPct(bestAge.rate)}`
    });
  }

  // 4) Funnel leak (ATC → checkout)
  const leakCandidate = eligibleAge
    .filter((row) => Number.isFinite(row.atc) && Number.isFinite(row.checkout) && row.atc >= LEAK_MIN_ATC)
    .map((row) => ({
      ...row,
      leak: row.atc > 0 ? 1 - (row.checkout / row.atc) : null
    }))
    .filter((row) => Number.isFinite(row.leak))
    .sort((a, b) => (b.leak || 0) - (a.leak || 0))[0];

  if (leakCandidate) {
    insights.push({
      type: 'leak',
      text: `${genderShort(leakCandidate.gender)} ${leakCandidate.age || 'Unknown'} loses ${Math.round(leakCandidate.leak * 100)}% between ATC and checkout — potential trust issue`
    });
  }

  // 5) Country standout (optional)
  if (countryActionsAvailable) {
    const countryAgg = new Map();
    (countryGenderSegments || []).forEach((row) => {
      if (!row?.eligible) return;
      const key = row.country || 'ALL';
      if (!key || key === 'ALL' || key.toLowerCase() === 'unknown') return;
      if (!countryAgg.has(key)) countryAgg.set(key, { clicks: 0, purchases: 0 });
      const acc = countryAgg.get(key);
      acc.clicks += row.clicks || 0;
      acc.purchases += row.purchases || 0;
    });

    const bestCountry = [...countryAgg.entries()]
      .map(([country, agg]) => ({ country, clicks: agg.clicks, purchases: agg.purchases, rate: agg.clicks > 0 ? agg.purchases / agg.clicks : null }))
      .filter((row) => row.clicks >= MIN_CLICKS && Number.isFinite(row.rate))
      .sort((a, b) => (b.rate || 0) - (a.rate || 0))[0];

    if (bestCountry) {
      insights.push({
        type: 'country',
        text: `${bestCountry.country} converts at ${formatPct(bestCountry.rate)} click→purchase — strongest country cohort`
      });
    }
  }

  return insights.slice(0, 8);
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

  const [ageGenderResult, countryOnlyResult] = await Promise.all([
    fetchWithFallback(['age', 'gender']),
    fetchWithFallback(['country'])
  ]);

  const ageGenderSegments = ageGenderResult.rows.map((row) => (
    normalizeSegmentRow(row, 'age_gender', currencyRate, ageGenderResult.actionsAvailable)
  ));
  const countryOnlySegments = countryOnlyResult.rows.map((row) => (
    normalizeSegmentRow(row, 'country_gender', currencyRate, countryOnlyResult.actionsAvailable, { gender: 'all' })
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

  const insights = buildInsights([...ageGenderSegments, ...countryGenderSegments]);
  const countryActionsAvailable = countryGenderSegments.some((row) =>
    row.atcRate !== null || row.checkoutRate !== null || row.purchaseRate !== null
  );
  const keyInsights = buildKeyInsights({
    ageGenderSegments,
    countryGenderSegments,
    actionsAvailable: ageGenderResult.actionsAvailable,
    countryActionsAvailable
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
        ageActionValuesAvailable: ageGenderResult.actionValuesAvailable,
        countryActionValuesAvailable: false,
        countryGenderSplitAvailable,
        countryGenderSplitMode
      },
      totals,
      totalsRates,
      segmentCounts: {
        ageGender: ageGenderSegments.length,
        countryGender: countryGenderSegments.length,
        eligibleAgeGender: ageGenderSegments.filter((row) => row.eligible).length,
        eligibleCountryGender: countryGenderSegments.filter((row) => row.eligible).length
      },
      segments: {
        ageGender: sortAgeGender(ageGenderSegments),
        countryGender: [...countryGenderSegments].sort((a, b) => b.spend - a.spend)
      },
      spendTotals: {
        ageGender: totalSpendAge,
        countryGender: totalSpendCountry
      },
      stats: {
        ageGender: ageStats,
        countryGender: countryStats
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
