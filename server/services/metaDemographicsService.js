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

function buildInsightsUrl({ accountId, accessToken, breakdowns, startDate, endDate, includeActions = true }) {
  const fields = includeActions
    ? 'spend,impressions,clicks,inline_link_clicks,actions'
    : 'spend,impressions,clicks,inline_link_clicks';

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

async function fetchAllInsights({ accountId, accessToken, breakdowns, startDate, endDate, includeActions = true }) {
  let url = buildInsightsUrl({ accountId, accessToken, breakdowns, startDate, endDate, includeActions });
  const allRows = [];

  while (url) {
    const response = await fetch(url);
    const json = await response.json();

    if (json?.error) {
      const message = json.error.message || 'Meta API error';
      const error = new Error(message);
      error.meta = json.error;
      throw error;
    }

    const data = Array.isArray(json?.data) ? json.data : [];
    allRows.push(...data);
    url = json?.paging?.next || null;
  }

  return allRows;
}

function normalizeSegmentRow(row, segmentType, currencyRate = 1, actionsAvailable = true) {
  const clicks = Math.round(toNumber(row.inline_link_clicks) || toNumber(row.clicks));
  const spend = toNumber(row.spend) * currencyRate;
  const impressions = Math.round(toNumber(row.impressions));

  const atc = actionsAvailable ? Math.round(getActionValue(row.actions, 'add_to_cart')) : 0;
  const checkout = actionsAvailable ? Math.round(getActionValue(row.actions, 'initiate_checkout')) : 0;
  const purchases = actionsAvailable ? Math.round(getFirstActionValue(row.actions, PURCHASE_ACTION_TYPES)) : 0;

  const gender = normalizeGender(row.gender);
  const age = segmentType === 'age_gender' ? normalizeAge(row.age) : null;
  const country = segmentType === 'country_gender' ? String(row.country || 'ALL').toUpperCase() : null;

  const atcRate = safeDivide(atc, clicks);
  const checkoutRate = safeDivide(checkout, clicks);
  const purchaseRate = safeDivide(purchases, clicks);

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

  const fetchWithFallback = async (breakdowns) => {
    try {
      const rows = await fetchAllInsights({
        accountId: normalizedAccountId,
        accessToken,
        breakdowns,
        startDate,
        endDate,
        includeActions: true
      });
      return { rows, actionsAvailable: true };
    } catch (error) {
      const message = error?.message || '';
      if (message.includes('action_type') || message.includes('breakdown columns')) {
        warnings.push(`Meta does not allow actions with breakdowns: ${breakdowns.join(', ')}`);
        const rows = await fetchAllInsights({
          accountId: normalizedAccountId,
          accessToken,
          breakdowns,
          startDate,
          endDate,
          includeActions: false
        });
        return { rows, actionsAvailable: false };
      }
      throw error;
    }
  };

  const [ageGenderResult, countryGenderResult] = await Promise.all([
    fetchWithFallback(['age', 'gender']),
    fetchWithFallback(['country', 'gender'])
  ]);

  const ageGenderSegments = ageGenderResult.rows.map((row) => (
    normalizeSegmentRow(row, 'age_gender', currencyRate, ageGenderResult.actionsAvailable)
  ));
  const countryGenderSegments = countryGenderResult.rows.map((row) => (
    normalizeSegmentRow(row, 'country_gender', currencyRate, countryGenderResult.actionsAvailable)
  ));

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
    atcRate: safeDivide(totals.atc, totals.clicks),
    checkoutRate: safeDivide(totals.checkout, totals.clicks),
    purchaseRate: safeDivide(totals.purchases, totals.clicks)
  };

  return {
    success: true,
    data: {
      updatedAt: new Date().toISOString(),
      range: { startDate, endDate, days: safeDays },
      warnings,
      flags: {
        ageActionsAvailable: ageGenderResult.actionsAvailable,
        countryActionsAvailable: countryGenderResult.actionsAvailable
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
