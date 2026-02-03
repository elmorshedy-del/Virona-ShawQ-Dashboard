import fetch from 'node-fetch';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import { getExchangeRateForDate } from './metaService.js';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

const MIN_CLICKS = 30;
const Z_THRESHOLD = 2.0;

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
      const label = formatSegmentLabel(row);

      insights.push({
        id: `${row.segmentType}-${row.key}-${metric.key}`,
        title: `${label} is ${direction} average on ${metric.label}`,
        detail: `${label} has a ${metric.label} of ${formatPercent(row[metric.key])} (${Math.abs(z).toFixed(1)}σ ${direction} mean) with ${row.clicks} clicks and ${Math.round(row.spend)} spend.`,
        impact,
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

export async function getMetaDemographics({ store = 'vironax', days = 30 }) {
  const { accessToken, adAccountId } = getStoreConfig(store);

  if (!accessToken || !adAccountId) {
    return {
      success: false,
      error: 'Missing Meta credentials for this store.'
    };
  }

  const normalizedAccountId = normalizeAccountId(adAccountId);
  const safeDays = Number.isFinite(Number(days)) ? Math.max(1, Number(days)) : 30;
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - (safeDays - 1) * 24 * 60 * 60 * 1000));

  let currencyRate = 1;
  if (store === 'shawq') {
    const rate = await getExchangeRateForDate(endDate);
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
        startDate,
        endDate,
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
            startDate,
            endDate,
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
              startDate,
              endDate,
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
      range: { startDate, endDate, days: safeDays },
      warnings,
      flags: {
        ageActionsAvailable: ageGenderResult.actionsAvailable,
        countryActionsAvailable: countryGenderSegments.some((row) =>
          row.atcRate !== null || row.checkoutRate !== null || row.purchaseRate !== null
        ),
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
      insights,
      rules: {
        minClicks: MIN_CLICKS,
        zThreshold: Z_THRESHOLD
      }
    }
  };
}
