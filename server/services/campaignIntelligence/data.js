import fetch from 'node-fetch';
import { getDb } from '../../db/database.js';
import {
  fetchShopifyOrders,
  getShopifyCredentialsForStore
} from '../shopifyService.js';
import {
  BUDGET_MONITOR_CONFIG,
  DEFAULT_SETTINGS,
  LEVEL_CONFIG,
  ORDERS_TABLE_BY_STORE,
  QUERY_LIMITS,
  SUPPORTED_LEVELS,
  SUPPORTED_STORES
} from './constants.js';
import {
  addDaysIso,
  clampInt,
  listDateRange,
  parseIsoDate,
  round,
  safeDivide,
  toNumber
} from './utils.js';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9_.:-]{2,120}$/;
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
const NORMALIZED_COUNTRY_SQL = "UPPER(TRIM(COALESCE(country, '')))";
const SHOPIFY_REVENUE_SQL = '(COALESCE(subtotal, 0) + COALESCE(shipping, 0))';
const SHOPIFY_DIRECT_FALLBACK_ENV = 'CI_SHOPIFY_DIRECT_ORDER_FALLBACK';
const SHOPIFY_DIRECT_FALLBACK_ENABLED = String(process.env[SHOPIFY_DIRECT_FALLBACK_ENV] || 'true')
  .trim()
  .toLowerCase() !== 'false';
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v20.0';
const META_GRAPH_HOSTNAME = 'graph.facebook.com';
const META_GRAPH_BASE_URL = `https://${META_GRAPH_HOSTNAME}/${META_GRAPH_VERSION}`;
const META_AD_ACCOUNT_ID_PATTERN = /^(?:act_)?([0-9]{5,32})$/;
const META_BUDGET_EVENT_FIELDS = 'event_time,event_type,event_type_display_name,translated_event_type,object_id,object_type,object_name,extra_data';
const META_BUDGET_FIELD_HINT_KEYS = new Set(['field', 'field_name', 'changed_field', 'attribute', 'target']);
const META_BUDGET_FROM_KEYS = new Set([
  'old_value',
  'old_value_in_minor_units',
  'old_budget',
  'old_budget_in_minor_units',
  'old_daily_budget',
  'old_daily_budget_in_minor_units',
  'old_lifetime_budget',
  'old_lifetime_budget_in_minor_units',
  'before_value',
  'before_value_in_minor_units',
  'before_budget',
  'before_budget_in_minor_units',
  'previous_value',
  'previous_value_in_minor_units',
  'from_value',
  'from_value_in_minor_units'
]);
const META_BUDGET_TO_KEYS = new Set([
  'new_value',
  'new_value_in_minor_units',
  'new_budget',
  'new_budget_in_minor_units',
  'new_daily_budget',
  'new_daily_budget_in_minor_units',
  'new_lifetime_budget',
  'new_lifetime_budget_in_minor_units',
  'after_value',
  'after_value_in_minor_units',
  'after_budget',
  'after_budget_in_minor_units',
  'updated_value',
  'updated_value_in_minor_units',
  'to_value',
  'to_value_in_minor_units'
]);
const META_BUDGET_MINOR_UNIT_DIVISOR = 100;
const META_BUDGET_MINOR_UNIT_KEY_HINTS = Object.freeze(['minor', 'cent', 'subunit']);
const META_BUDGET_HISTORY_LOOKBACK_DAYS = BUDGET_MONITOR_CONFIG.monitorLookbackDays;
const META_BUDGET_HISTORY_CACHE_TTL_MS = BUDGET_MONITOR_CONFIG.historyCacheTtlMinutes * MILLISECONDS_PER_MINUTE;
const META_BUDGET_HISTORY_CACHE_MAX_ENTRIES = BUDGET_MONITOR_CONFIG.historyCacheMaxEntries;
const META_BUDGET_HISTORY_CACHE = new Map();
const SHOPIFY_RANGE_CACHE_TTL_MINUTES = 10;
const SHOPIFY_RANGE_CACHE_TTL_MS = SHOPIFY_RANGE_CACHE_TTL_MINUTES * MILLISECONDS_PER_MINUTE;
const SHOPIFY_RANGE_CACHE_MAX_ENTRIES = 20;
const SHOPIFY_ORDER_RANGE_CACHE = new Map();
const COUNTRY_NAME_CACHE_LOCALE = 'en';
const COUNTRY_NAME_TYPE = 'region';
const ASCII_A_CODE = 65;
const ASCII_Z_CODE = 90;
const COUNTRY_OPTIONS_RAW_LIMIT_MULTIPLIER = 4;
const COUNTRY_OPTIONS_MAX_RAW_ROWS = 400;
const ACTIVE_EFFECTIVE_STATUS = 'ACTIVE';
const UNKNOWN_EFFECTIVE_STATUS = 'UNKNOWN';
const TABLE_COLUMNS_CACHE = new Map();
const HIERARCHY_LEVEL_LIMITS = Object.freeze({
  campaign: 24,
  adset: 72,
  ad: 144
});
const HIERARCHY_METRIC_DECIMALS = Object.freeze({
  ratio: 6,
  amount: 4
});
const COUNTRY_ALIAS_OVERRIDES = Object.freeze({
  UK: 'GB',
  UAE: 'AE',
  KSA: 'SA',
  TURKEY: 'TR',
  TURKIYE: 'TR',
  'VATICAN CITY': 'VA',
  'SOUTH KOREA': 'KR',
  'NORTH KOREA': 'KP'
});

function getShopifyRangeCacheKey({ store, startDate, endDate }) {
  return `${store}:${startDate}:${endDate}`;
}

function pruneShopifyRangeCache() {
  while (SHOPIFY_ORDER_RANGE_CACHE.size > SHOPIFY_RANGE_CACHE_MAX_ENTRIES) {
    const oldestKey = SHOPIFY_ORDER_RANGE_CACHE.keys().next().value;
    if (!oldestKey) break;
    SHOPIFY_ORDER_RANGE_CACHE.delete(oldestKey);
  }
}

function getCachedShopifyOrders(cacheKey) {
  const cached = SHOPIFY_ORDER_RANGE_CACHE.get(cacheKey);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    SHOPIFY_ORDER_RANGE_CACHE.delete(cacheKey);
    return null;
  }

  return Array.isArray(cached.orders) ? cached.orders : null;
}

function setCachedShopifyOrders(cacheKey, orders) {
  SHOPIFY_ORDER_RANGE_CACHE.set(cacheKey, {
    expiresAt: Date.now() + SHOPIFY_RANGE_CACHE_TTL_MS,
    orders: Array.isArray(orders) ? orders : []
  });
  pruneShopifyRangeCache();
}

function getBudgetHistoryCacheKey({ store, startDate, endDate, campaignIds = [] }) {
  const scopedCampaignIds = Array.from(new Set(campaignIds.map((id) => String(id || '').trim()).filter(Boolean)))
    .sort()
    .join(',');
  return `${store}:${startDate}:${endDate}:${scopedCampaignIds || 'all'}`;
}

function pruneBudgetHistoryCache() {
  while (META_BUDGET_HISTORY_CACHE.size > META_BUDGET_HISTORY_CACHE_MAX_ENTRIES) {
    const oldestKey = META_BUDGET_HISTORY_CACHE.keys().next().value;
    if (!oldestKey) break;
    META_BUDGET_HISTORY_CACHE.delete(oldestKey);
  }
}

function getCachedBudgetHistoryEvents(cacheKey) {
  const cached = META_BUDGET_HISTORY_CACHE.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    META_BUDGET_HISTORY_CACHE.delete(cacheKey);
    return null;
  }
  return Array.isArray(cached.events) ? cached.events : null;
}

function setCachedBudgetHistoryEvents(cacheKey, events) {
  META_BUDGET_HISTORY_CACHE.set(cacheKey, {
    expiresAt: Date.now() + META_BUDGET_HISTORY_CACHE_TTL_MS,
    events: Array.isArray(events) ? events : []
  });
  pruneBudgetHistoryCache();
}

function normalizeMetaAdAccountId(rawAdAccountId) {
  const match = String(rawAdAccountId || '').trim().match(META_AD_ACCOUNT_ID_PATTERN);
  return match?.[1] || null;
}

function getMetaCredentialsForStore(store) {
  const normalizedStore = String(store || '').trim().toLowerCase();
  if (normalizedStore === 'shawq') {
    return {
      accessToken: String(process.env.SHAWQ_META_ACCESS_TOKEN || '').trim(),
      adAccountId: normalizeMetaAdAccountId(process.env.SHAWQ_META_AD_ACCOUNT_ID)
    };
  }

  return {
    accessToken: String(process.env.META_ACCESS_TOKEN || process.env.VIRONAX_META_ACCESS_TOKEN || '').trim(),
    adAccountId: normalizeMetaAdAccountId(process.env.META_AD_ACCOUNT_ID || process.env.VIRONAX_META_AD_ACCOUNT_ID)
  };
}

function getIsoDateForDashboardOffset(value, utcOffsetMinutes = BUDGET_MONITOR_CONFIG.dashboardDayUtcOffsetMinutes) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const dashboardMs = parsed.getTime() + (utcOffsetMinutes * MILLISECONDS_PER_MINUTE);
  return new Date(dashboardMs).toISOString().slice(0, 10);
}

function getCurrentDashboardDate(utcOffsetMinutes = BUDGET_MONITOR_CONFIG.dashboardDayUtcOffsetMinutes) {
  return getIsoDateForDashboardOffset(new Date(), utcOffsetMinutes);
}

function getLatestCompletedDashboardDate(utcOffsetMinutes = BUDGET_MONITOR_CONFIG.dashboardDayUtcOffsetMinutes) {
  const dashboardToday = getCurrentDashboardDate(utcOffsetMinutes);
  if (!dashboardToday) return null;
  return addDaysIso(dashboardToday, -1);
}

function isMinorUnitBudgetKey(rawKey) {
  const key = String(rawKey || '').trim().toLowerCase();
  if (!key) return false;
  return META_BUDGET_MINOR_UNIT_KEY_HINTS.some((hint) => key.includes(hint));
}

function parseBudgetAmount(value, { isMinorUnits = false } = {}) {
  if (value == null || value === '') return null;

  let parsedValue = value;
  if (typeof value === 'string') {
    const sanitized = value.replace(/[^0-9.+-]/g, '');
    if (!sanitized) return null;
    parsedValue = Number(sanitized);
  }

  const numeric = Number(parsedValue);
  if (!Number.isFinite(numeric)) return null;
  if (isMinorUnits) {
    return numeric / META_BUDGET_MINOR_UNIT_DIVISOR;
  }
  return numeric;
}

function parseExtraDataObject(extraData) {
  if (!extraData) return null;
  if (typeof extraData === 'object') return extraData;

  if (typeof extraData === 'string') {
    try {
      const parsed = JSON.parse(extraData);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function collectNestedEntries(payload) {
  const out = [];
  const stack = [payload];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    if (Array.isArray(current)) {
      current.forEach((item) => stack.push(item));
      continue;
    }

    if (typeof current !== 'object') continue;

    Object.entries(current).forEach(([rawKey, value]) => {
      const key = String(rawKey || '').trim().toLowerCase();
      if (!key) return;
      out.push({ key, value });
      if (value && typeof value === 'object') {
        stack.push(value);
      }
    });
  }

  return out;
}

function findNumericValueByKeys(entries, keySet) {
  for (const entry of entries) {
    if (!keySet.has(entry.key)) continue;
    const parsed = parseBudgetAmount(entry.value, {
      isMinorUnits: isMinorUnitBudgetKey(entry.key)
    });
    if (parsed != null) return parsed;
  }
  return null;
}

function inferBudgetValuesFromEntries(entries) {
  const fromBudget = findNumericValueByKeys(entries, META_BUDGET_FROM_KEYS);
  const toBudget = findNumericValueByKeys(entries, META_BUDGET_TO_KEYS);

  return { fromBudget, toBudget };
}

function normalizeGraphObjectId(value) {
  const normalized = String(value || '').trim();
  if (!/^[0-9]{5,32}$/.test(normalized)) return null;
  return normalized;
}

function extractCampaignIdFromEntries(entries) {
  for (const entry of entries) {
    if (!entry.key.includes('campaign') || !entry.key.includes('id')) continue;
    const normalized = normalizeGraphObjectId(entry.value);
    if (normalized) return normalized;
  }
  return null;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (_error) {
      json = null;
    }
    return { response, json };
  } finally {
    clearTimeout(timerId);
  }
}

function normalizeCountryToken(rawCountry) {
  if (rawCountry == null) return null;

  const normalized = String(rawCountry)
    .trim()
    .toUpperCase()
    .replace(/[_.,-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || null;
}

function buildCountryNormalizationLookup() {
  const aliasToCode = new Map();
  const codeToAliases = new Map();
  const displayNames = new Intl.DisplayNames([COUNTRY_NAME_CACHE_LOCALE], { type: COUNTRY_NAME_TYPE });

  const registerAlias = (rawAlias, rawCode) => {
    const alias = normalizeCountryToken(rawAlias);
    const code = normalizeCountryToken(rawCode);
    if (!alias || !code || !COUNTRY_CODE_PATTERN.test(code)) return;

    aliasToCode.set(alias, code);
    if (!codeToAliases.has(code)) {
      codeToAliases.set(code, new Set([code]));
    }
    codeToAliases.get(code).add(alias);
  };

  for (let first = ASCII_A_CODE; first <= ASCII_Z_CODE; first += 1) {
    for (let second = ASCII_A_CODE; second <= ASCII_Z_CODE; second += 1) {
      const code = `${String.fromCharCode(first)}${String.fromCharCode(second)}`;
      const displayName = displayNames.of(code);
      const normalizedDisplayName = normalizeCountryToken(displayName);

      if (!normalizedDisplayName || normalizedDisplayName === code) continue;

      registerAlias(code, code);
      registerAlias(displayName, code);
    }
  }

  for (const [alias, code] of Object.entries(COUNTRY_ALIAS_OVERRIDES)) {
    registerAlias(alias, code);
  }

  return {
    aliasToCode,
    codeToAliases
  };
}

const COUNTRY_LOOKUP = buildCountryNormalizationLookup();

function normalizeCountryCode(rawCountry) {
  const token = normalizeCountryToken(rawCountry);
  if (!token) return null;

  const mapped = COUNTRY_LOOKUP.aliasToCode.get(token);
  if (mapped) return mapped;

  if (COUNTRY_CODE_PATTERN.test(token)) return token;
  return null;
}

function getCountryAliases(countryCode) {
  const normalizedCode = normalizeCountryCode(countryCode);
  if (!normalizedCode) return [];

  const aliasesSet = COUNTRY_LOOKUP.codeToAliases.get(normalizedCode);
  if (!aliasesSet || aliasesSet.size === 0) {
    return [normalizedCode];
  }

  return Array.from(aliasesSet);
}

function buildCountryWhereClause(countryCode, columnSql = NORMALIZED_COUNTRY_SQL) {
  const aliases = getCountryAliases(countryCode);
  if (!aliases.length) {
    return {
      clause: `${columnSql} = ?`,
      args: [String(countryCode || '').toUpperCase()]
    };
  }

  const placeholders = aliases.map(() => '?').join(', ');
  return {
    clause: `${columnSql} IN (${placeholders})`,
    args: aliases
  };
}

function ensureStore(rawStore) {
  const normalized = String(rawStore || DEFAULT_SETTINGS.defaultStore).trim().toLowerCase();
  if (!SUPPORTED_STORES.has(normalized)) {
    const error = new Error('Unsupported store value');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function ensureLevel(rawLevel) {
  const normalized = String(rawLevel || DEFAULT_SETTINGS.defaultLevel).trim().toLowerCase();
  if (!SUPPORTED_LEVELS.has(normalized)) {
    const error = new Error('Unsupported hierarchy level');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function normalizeEntityId(rawEntityId) {
  if (rawEntityId == null || rawEntityId === '' || String(rawEntityId).toUpperCase() === 'ALL') {
    return null;
  }
  const normalized = String(rawEntityId).trim();
  if (!ENTITY_ID_PATTERN.test(normalized)) {
    const error = new Error('entityId is invalid');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function normalizeCountry(rawCountry) {
  if (rawCountry == null || rawCountry === '' || String(rawCountry).toUpperCase() === 'ALL') {
    return 'ALL';
  }
  const normalized = normalizeCountryCode(rawCountry);
  if (!normalized) {
    const error = new Error('country must be ALL or a supported 2-letter country code');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function getLatestMetricDate({
  db,
  store,
  levelConfig,
  entityId,
  country
}) {
  const whereParts = ['store = ?', 'COALESCE(spend, 0) > 0'];
  const args = [store];

  if (entityId) {
    whereParts.push(`${levelConfig.idColumn} = ?`);
    args.push(entityId);
  }

  if (country && country !== 'ALL') {
    const countryFilter = buildCountryWhereClause(country);
    whereParts.push(countryFilter.clause);
    args.push(...countryFilter.args);
  }

  const row = db
    .prepare(`SELECT MAX(date) as maxDate FROM ${levelConfig.table} WHERE ${whereParts.join(' AND ')}`)
    .get(...args);
  return parseIsoDate(row?.maxDate);
}

function getScopeFirstSeenDate({
  db,
  store,
  levelConfig,
  entityId,
  country
}) {
  if (!entityId) return null;

  const whereParts = ['store = ?', `${levelConfig.idColumn} = ?`];
  const args = [store, entityId];

  if (country && country !== 'ALL') {
    const countryFilter = buildCountryWhereClause(country);
    whereParts.push(countryFilter.clause);
    args.push(...countryFilter.args);
  }

  const row = db
    .prepare(`
      SELECT MIN(date) as minDate
      FROM ${levelConfig.table}
      WHERE ${whereParts.join(' AND ')}
    `)
    .get(...args);

  return parseIsoDate(row?.minDate);
}

function resolveRangeWindow({
  db,
  store,
  levelConfig,
  entityId,
  country,
  startDate,
  endDate,
  analysisWindowDays
}) {
  const lifecycleStartDate = getScopeFirstSeenDate({
    db,
    store,
    levelConfig,
    entityId,
    country
  });

  const latestScopeDate = getLatestMetricDate({
    db,
    store,
    levelConfig,
    entityId,
    country
  });

  const requestedEndDate = parseIsoDate(endDate);
  let resolvedEndDate = requestedEndDate || latestScopeDate || getCurrentDashboardDate() || new Date().toISOString().slice(0, 10);

  if (!requestedEndDate && latestScopeDate) {
    const latestCompletedDashboardDate = getLatestCompletedDashboardDate();
    if (latestCompletedDashboardDate && latestScopeDate > latestCompletedDashboardDate) {
      const isFirstLifecycleDay = lifecycleStartDate != null && lifecycleStartDate === latestScopeDate;
      resolvedEndDate = isFirstLifecycleDay ? latestScopeDate : latestCompletedDashboardDate;
    }
  }

  const requestedStartDate = parseIsoDate(startDate);
  if (requestedStartDate) {
    if (requestedStartDate > resolvedEndDate) {
      const error = new Error('startDate must be <= endDate');
      error.status = 400;
      throw error;
    }
    return {
      startDate: requestedStartDate,
      endDate: resolvedEndDate
    };
  }

  if (lifecycleStartDate && lifecycleStartDate <= resolvedEndDate) {
    return {
      startDate: lifecycleStartDate,
      endDate: resolvedEndDate
    };
  }

  const boundedDays = clampInt(
    analysisWindowDays,
    QUERY_LIMITS.minAnalysisWindowDays,
    QUERY_LIMITS.maxAnalysisWindowDays,
    DEFAULT_SETTINGS.analysisWindowDays
  );

  return {
    startDate: addDaysIso(resolvedEndDate, -(boundedDays - 1)),
    endDate: resolvedEndDate
  };
}

function resolveAnchorWindow({
  analysisStartDate,
  analysisEndDate,
  anchorWindowDays,
  anchorStartDate,
  anchorEndDate
}) {
  const explicitStart = parseIsoDate(anchorStartDate);
  const explicitEnd = parseIsoDate(anchorEndDate);

  if (explicitStart && explicitEnd) {
    if (explicitStart > explicitEnd) {
      const error = new Error('anchorStartDate must be <= anchorEndDate');
      error.status = 400;
      throw error;
    }
    return { startDate: explicitStart, endDate: explicitEnd, source: 'custom' };
  }

  const boundedAnchorDays = clampInt(
    anchorWindowDays,
    QUERY_LIMITS.minAnchorWindowDays,
    QUERY_LIMITS.maxAnchorWindowDays,
    DEFAULT_SETTINGS.anchorWindowDays
  );

  const anchorReferenceEnd = parseIsoDate(analysisEndDate) || parseIsoDate(analysisStartDate) || analysisStartDate;
  const defaultAnchorEnd = addDaysIso(anchorReferenceEnd, -1);
  return {
    startDate: addDaysIso(defaultAnchorEnd, -(boundedAnchorDays - 1)),
    endDate: defaultAnchorEnd,
    source: 'rolling'
  };
}

function buildScopeWhere(levelConfig, { store, startDate, endDate, entityId, country }) {
  const whereParts = ['store = ?', 'date BETWEEN ? AND ?'];
  const args = [store, startDate, endDate];

  if (entityId) {
    whereParts.push(`${levelConfig.idColumn} = ?`);
    args.push(entityId);
  }

  if (country && country !== 'ALL') {
    const countryFilter = buildCountryWhereClause(country);
    whereParts.push(countryFilter.clause);
    args.push(...countryFilter.args);
  }

  return {
    whereSql: whereParts.join(' AND '),
    args
  };
}

function formatEntityNameFallback(row, levelLabel) {
  const value = String(row?.name || '').trim();
  if (value) return value;
  return `${levelLabel} ${String(row?.id || '').slice(0, 8)}`;
}

export function normalizeCampaignIntelligenceRequest(query = {}) {
  const store = ensureStore(query.store);
  const level = ensureLevel(query.level);
  const levelConfig = LEVEL_CONFIG[level];
  const entityId = normalizeEntityId(query.entityId);
  const country = normalizeCountry(query.country);

  const db = getDb();
  const analysisRange = resolveRangeWindow({
    db,
    store,
    levelConfig,
    entityId,
    country,
    startDate: query.startDate,
    endDate: query.endDate,
    analysisWindowDays: query.analysisWindowDays
  });

  const anchorRange = resolveAnchorWindow({
    analysisStartDate: analysisRange.startDate,
    analysisEndDate: analysisRange.endDate,
    anchorWindowDays: query.anchorWindowDays,
    anchorStartDate: query.anchorStartDate,
    anchorEndDate: query.anchorEndDate
  });

  const beforeAfterWindowDays = clampInt(
    query.beforeAfterWindowDays,
    QUERY_LIMITS.minBeforeAfterWindowDays,
    QUERY_LIMITS.maxBeforeAfterWindowDays,
    DEFAULT_SETTINGS.beforeAfterWindowDays
  );

  const selectorLimit = clampInt(
    query.selectorLimit,
    10,
    QUERY_LIMITS.maxSelectorOptions,
    DEFAULT_SETTINGS.selectorLimit
  );

  return {
    db,
    store,
    level,
    levelConfig,
    entityId,
    country,
    analysisRange,
    anchorRange,
    beforeAfterWindowDays,
    selectorLimit
  };
}

export function fetchEntityOptions(scope) {
  const { db, store, level, levelConfig, analysisRange, country, selectorLimit } = scope;
  const whereParts = ['store = ?', 'date BETWEEN ? AND ?'];
  const args = [store, analysisRange.startDate, analysisRange.endDate];

  if (country !== 'ALL') {
    const countryFilter = buildCountryWhereClause(country);
    whereParts.push(countryFilter.clause);
    args.push(...countryFilter.args);
  }

  const queryConfig = buildLevelWindowQueryConfig(level);
  const activeFilter = buildActiveEntitySubqueryFilter({
    db,
    tableName: levelConfig.table,
    idColumn: levelConfig.idColumn,
    statusColumns: queryConfig.statusColumns,
    store,
    endDate: analysisRange.endDate,
    country
  });

  if (activeFilter) {
    whereParts.push(activeFilter.clause);
    args.push(...activeFilter.args);
  }

  const rows = db
    .prepare(`
      SELECT
        ${levelConfig.idColumn} as id,
        ${levelConfig.nameColumn} as name,
        SUM(spend) as spend,
        SUM(conversions) as conversions,
        MIN(date) as firstSeen,
        MAX(date) as lastSeen
      FROM ${levelConfig.table}
      WHERE ${whereParts.join(' AND ')}
      GROUP BY ${levelConfig.idColumn}, ${levelConfig.nameColumn}
      HAVING SUM(spend) > 0
      ORDER BY lastSeen DESC, spend DESC
      LIMIT ?
    `)
    .all(...args, selectorLimit);

  return rows.map((row) => ({
    id: String(row.id),
    name: formatEntityNameFallback(row, levelConfig.label),
    spend: round(toNumber(row.spend), 2),
    conversions: Math.round(toNumber(row.conversions)),
    firstSeen: parseIsoDate(row.firstSeen),
    lastSeen: parseIsoDate(row.lastSeen)
  }));
}

export function fetchCountryOptions(scope) {
  const { db, store, level, levelConfig, analysisRange, anchorRange, entityId, selectorLimit } = scope;
  const queryConfig = buildLevelWindowQueryConfig(level);
  const rawCountryRowLimit = Math.min(
    COUNTRY_OPTIONS_MAX_RAW_ROWS,
    Math.max(selectorLimit, selectorLimit * COUNTRY_OPTIONS_RAW_LIMIT_MULTIPLIER)
  );

  const queryCountryAggregates = ({ startDate, endDate }) => {
    const scopeFilter = buildScopeWhere(levelConfig, {
      store,
      startDate,
      endDate,
      entityId,
      country: 'ALL'
    });
    const whereParts = [scopeFilter.whereSql];
    const args = [...scopeFilter.args];
    const activeFilter = buildActiveEntitySubqueryFilter({
      db,
      tableName: levelConfig.table,
      idColumn: levelConfig.idColumn,
      statusColumns: queryConfig.statusColumns,
      store,
      endDate: analysisRange.endDate,
      country: 'ALL',
      entityId
    });
    if (activeFilter) {
      whereParts.push(activeFilter.clause);
      args.push(...activeFilter.args);
    }

    const rows = db
      .prepare(`
        SELECT
          ${NORMALIZED_COUNTRY_SQL} as rawCountry,
          SUM(spend) as spend,
          SUM(conversions) as conversions,
          SUM(conversion_value) as conversionValue,
          SUM(add_to_cart) as addToCart,
          SUM(checkouts_initiated) as checkoutsInitiated,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions
        FROM ${levelConfig.table}
        WHERE ${whereParts.join(' AND ')}
        AND ${NORMALIZED_COUNTRY_SQL} != ''
        GROUP BY ${NORMALIZED_COUNTRY_SQL}
        HAVING SUM(spend) > 0
        ORDER BY spend DESC
        LIMIT ?
      `)
      .all(...args, rawCountryRowLimit);

    const byCode = new Map();
    for (const row of rows) {
      const code = normalizeCountryCode(row?.rawCountry);
      if (!code) continue;

      const current = byCode.get(code) || {
        code,
        spend: 0,
        conversions: 0,
        conversionValue: 0,
        addToCart: 0,
        checkoutsInitiated: 0,
        clicks: 0,
        impressions: 0
      };
      current.spend += toNumber(row?.spend);
      current.conversions += toNumber(row?.conversions);
      current.conversionValue += toNumber(row?.conversionValue);
      current.addToCart += toNumber(row?.addToCart);
      current.checkoutsInitiated += toNumber(row?.checkoutsInitiated);
      current.clicks += toNumber(row?.clicks);
      current.impressions += toNumber(row?.impressions);
      byCode.set(code, current);
    }

    return byCode;
  };

  const resolvedAnchorRange = anchorRange || analysisRange;
  const analysisByCountry = queryCountryAggregates({
    startDate: analysisRange.startDate,
    endDate: analysisRange.endDate
  });
  const anchorByCountry = queryCountryAggregates({
    startDate: resolvedAnchorRange.startDate,
    endDate: resolvedAnchorRange.endDate
  });

  const mapToMetrics = (raw = null) => {
    if (!raw) return null;
    const spend = toNumber(raw.spend);
    const conversions = toNumber(raw.conversions);
    const conversionValue = toNumber(raw.conversionValue);
    const addToCart = toNumber(raw.addToCart);
    const checkoutsInitiated = toNumber(raw.checkoutsInitiated);
    const clicks = toNumber(raw.clicks);
    const impressions = toNumber(raw.impressions);

    return {
      spend: round(spend, 2),
      conversions: Math.round(conversions),
      conversionValue: round(conversionValue, 2),
      addToCart: Math.round(addToCart),
      checkoutsInitiated: Math.round(checkoutsInitiated),
      clicks: Math.round(clicks),
      impressions: Math.round(impressions),
      roas: spend > 0 ? round(safeDivide(conversionValue, spend), 4) : null,
      costAtc: addToCart > 0 ? round(safeDivide(spend, addToCart), 4) : null,
      purchaseIc: checkoutsInitiated > 0 ? round(safeDivide(conversions, checkoutsInitiated), 4) : null,
      cpm: impressions > 0 ? round(safeDivide(spend * 1000, impressions), 4) : null,
      ctr: impressions > 0 ? round(safeDivide(clicks, impressions), 4) : null
    };
  };

  return Array.from(analysisByCountry.values())
    .map((analysisRow) => {
      const current = mapToMetrics(analysisRow);
      const baseline = mapToMetrics(anchorByCountry.get(analysisRow.code));

      return {
        code: analysisRow.code,
        ...current,
        baseline
      };
    })
    .sort((left, right) => right.spend - left.spend)
    .slice(0, selectorLimit);
}

export function fetchScopedCampaignIds({
  db,
  store,
  levelConfig,
  startDate,
  endDate,
  entityId,
  country
}) {
  if (levelConfig?.idColumn === 'campaign_id' && entityId) {
    return [String(entityId)];
  }

  const { whereSql, args } = buildScopeWhere(levelConfig, {
    store,
    startDate,
    endDate,
    entityId,
    country
  });

  const rows = db
    .prepare(`
      SELECT
        campaign_id as campaignId,
        MAX(date) as lastSeen,
        SUM(spend) as spend
      FROM ${levelConfig.table}
      WHERE ${whereSql}
      AND campaign_id IS NOT NULL
      AND TRIM(campaign_id) != ''
      GROUP BY campaign_id
      HAVING SUM(spend) > 0
      ORDER BY lastSeen DESC, spend DESC
      LIMIT ?
    `)
    .all(...args, QUERY_LIMITS.maxSelectorOptions);

  if (!rows.length && entityId) {
    return [String(entityId)];
  }

  return rows
    .map((row) => String(row?.campaignId || '').trim())
    .filter(Boolean);
}

function getBudgetFieldHint(entries = []) {
  const parts = entries
    .filter((entry) => META_BUDGET_FIELD_HINT_KEYS.has(entry.key))
    .map((entry) => String(entry.value || '').toLowerCase())
    .filter(Boolean);
  return parts.join(' ');
}

function hasBudgetSignal(activity = {}, entries = []) {
  const eventText = [
    activity?.event_type,
    activity?.event_type_display_name,
    activity?.translated_event_type
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');

  const fieldHint = getBudgetFieldHint(entries);
  if (eventText.includes('budget') || fieldHint.includes('budget')) {
    return true;
  }

  return entries.some((entry) => entry.key.includes('budget'));
}

function resolveActivityCampaignId(activity = {}, entries = []) {
  const objectType = String(activity?.object_type || '').toLowerCase();
  const objectId = normalizeGraphObjectId(activity?.object_id);
  if (objectType.includes('campaign') && objectId) {
    return objectId;
  }

  return extractCampaignIdFromEntries(entries);
}

function buildBudgetHistoryEvent(activity = {}, allowedCampaignIds = null) {
  const entries = collectNestedEntries(parseExtraDataObject(activity?.extra_data));
  if (!hasBudgetSignal(activity, entries)) return null;

  const campaignId = resolveActivityCampaignId(activity, entries);
  if (allowedCampaignIds && allowedCampaignIds.size > 0) {
    if (!campaignId || !allowedCampaignIds.has(campaignId)) return null;
  }

  const eventTimeValue = activity?.event_time || activity?.created_time || activity?.date_start;
  const pivotDate = getIsoDateForDashboardOffset(eventTimeValue);
  if (!pivotDate) return null;

  const { fromBudget, toBudget } = inferBudgetValuesFromEntries(entries);
  const rawShiftRatio = toBudget != null && fromBudget != null
    ? safeDivide(toBudget - fromBudget, Math.abs(fromBudget), 0)
    : null;

  return {
    pivotDate,
    eventTime: typeof eventTimeValue === 'string' ? eventTimeValue : null,
    campaignId: campaignId || null,
    objectId: normalizeGraphObjectId(activity?.object_id),
    objectType: String(activity?.object_type || '').toLowerCase() || null,
    eventType: String(activity?.event_type || activity?.translated_event_type || '').toLowerCase() || null,
    fromBudget: fromBudget != null ? round(fromBudget, 2) : null,
    toBudget: toBudget != null ? round(toBudget, 2) : null,
    shiftRatio: rawShiftRatio != null ? round(rawShiftRatio, 4) : null,
    source: 'meta_history'
  };
}

function ensureAllowedMetaNextUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname !== META_GRAPH_HOSTNAME) return null;
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function sortBudgetHistoryEvents(events = []) {
  return events
    .slice()
    .sort((left, right) => {
      const leftKey = left?.eventTime || left?.pivotDate || '';
      const rightKey = right?.eventTime || right?.pivotDate || '';
      return rightKey.localeCompare(leftKey);
    })
    .slice(0, BUDGET_MONITOR_CONFIG.historyMaxEvents);
}

export async function fetchMetaBudgetHistoryEvents({
  store,
  startDate,
  endDate,
  campaignIds = []
}) {
  const credentials = getMetaCredentialsForStore(store);
  if (!credentials?.accessToken || !credentials?.adAccountId) {
    return [];
  }

  const allowedCampaignIds = new Set(
    (campaignIds || [])
      .map((id) => normalizeGraphObjectId(id))
      .filter(Boolean)
  );

  const cacheKey = getBudgetHistoryCacheKey({
    store,
    startDate,
    endDate,
    campaignIds: Array.from(allowedCampaignIds)
  });

  const cachedEvents = getCachedBudgetHistoryEvents(cacheKey);
  if (cachedEvents) {
    return cachedEvents;
  }

  const baseUrl = new URL(`${META_GRAPH_BASE_URL}/act_${credentials.adAccountId}/activities`);
  baseUrl.searchParams.set('fields', META_BUDGET_EVENT_FIELDS);
  baseUrl.searchParams.set('since', startDate);
  baseUrl.searchParams.set('until', endDate);
  baseUrl.searchParams.set('limit', String(BUDGET_MONITOR_CONFIG.historyFetchPageLimit));
  baseUrl.searchParams.set('access_token', credentials.accessToken);

  const events = [];
  let nextUrl = baseUrl.toString();
  let pageCount = 0;

  while (nextUrl && pageCount < BUDGET_MONITOR_CONFIG.historyFetchMaxPages) {
    pageCount += 1;

    try {
      const { response, json } = await fetchJsonWithTimeout(
        nextUrl,
        BUDGET_MONITOR_CONFIG.historyRequestTimeoutMs
      );

      if (!response.ok || json?.error) {
        console.warn(`[CampaignIntelligence] Meta budget history request failed for ${store}: ${json?.error?.message || response.statusText}`);
        break;
      }

      const pageRows = Array.isArray(json?.data) ? json.data : [];
      pageRows.forEach((row) => {
        const event = buildBudgetHistoryEvent(row, allowedCampaignIds);
        if (event) events.push(event);
      });

      nextUrl = ensureAllowedMetaNextUrl(json?.paging?.next);
    } catch (error) {
      console.warn(`[CampaignIntelligence] Meta budget history fetch error for ${store}: ${error.message}`);
      break;
    }
  }

  const sortedEvents = sortBudgetHistoryEvents(events);
  setCachedBudgetHistoryEvents(cacheKey, sortedEvents);
  return sortedEvents;
}

function getOrdersTable(store) {
  return ORDERS_TABLE_BY_STORE[store] || ORDERS_TABLE_BY_STORE.vironax;
}

function fetchDailyOrdersRowsFromDb({ db, store, startDate, endDate, country }) {
  const tableName = getOrdersTable(store);
  const revenueExpression = tableName === 'shopify_orders'
    ? `COALESCE(NULLIF(${SHOPIFY_REVENUE_SQL}, 0), order_total)`
    : 'COALESCE(NULLIF(subtotal, 0), order_total)';
  const whereParts = ['store = ?', 'date BETWEEN ? AND ?', 'COALESCE(is_excluded, 0) = 0'];
  const args = [store, startDate, endDate];

  if (country && country !== 'ALL') {
    const countryAliases = getCountryAliases(country);
    const countryPlaceholders = countryAliases.map(() => '?').join(', ');
    whereParts.push(`(
      UPPER(TRIM(COALESCE(country, ''))) IN (${countryPlaceholders})
      OR UPPER(TRIM(COALESCE(country_code, ''))) IN (${countryPlaceholders})
    )`);
    args.push(...countryAliases, ...countryAliases);
  }

  return db
    .prepare(`
      SELECT
        date,
        COUNT(*) as orders,
        SUM(${revenueExpression}) as revenue
      FROM ${tableName}
      WHERE ${whereParts.join(' AND ')}
      GROUP BY date
      ORDER BY date ASC
    `)
    .all(...args)
    .map((row) => ({
      date: parseIsoDate(row.date),
      orders: Math.round(toNumber(row.orders)),
      revenue: round(toNumber(row.revenue), 2)
    }))
    .filter((row) => row.date);
}

function hasOrderVolume(rows = []) {
  return rows.some((row) => toNumber(row?.orders) > 0);
}

function shouldAttemptShopifyDirectFallback({ store, dbRows }) {
  if (!SHOPIFY_DIRECT_FALLBACK_ENABLED) return false;
  if (getOrdersTable(store) !== 'shopify_orders') return false;
  return !hasOrderVolume(dbRows);
}

function normalizeOrderCountryCode(order) {
  return normalizeCountryCode(order?.country) || normalizeCountryCode(order?.country_code) || null;
}

function resolveOrderRevenue(order) {
  const subtotal = toNumber(order?.subtotal);
  const shipping = toNumber(order?.shipping);
  if (subtotal !== 0 || shipping !== 0) return subtotal + shipping;
  return toNumber(order?.order_total);
}

function isOrderExcluded(order) {
  return Number(order?.is_excluded) === 1;
}

function aggregateShopifyOrdersByDate(orders = [], country = 'ALL') {
  const dailyMap = new Map();
  const normalizedCountry = country && country !== 'ALL' ? country : 'ALL';

  for (const order of orders) {
    if (isOrderExcluded(order)) continue;
    const parsedDate = parseIsoDate(String(order?.date || ''));
    if (!parsedDate) continue;

    if (normalizedCountry !== 'ALL') {
      const orderCountryCode = normalizeOrderCountryCode(order);
      if (orderCountryCode !== normalizedCountry) continue;
    }

    const current = dailyMap.get(parsedDate) || { orders: 0, revenue: 0 };
    current.orders += 1;
    current.revenue += resolveOrderRevenue(order);
    dailyMap.set(parsedDate, current);
  }

  return Array.from(dailyMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, totals]) => ({
      date,
      orders: Math.round(toNumber(totals.orders)),
      revenue: round(toNumber(totals.revenue), 2)
    }));
}

async function fetchShopifyDirectDailyOrders({ store, startDate, endDate, country }) {
  const credentials = getShopifyCredentialsForStore(store);
  if (!credentials?.shopifyStore || !credentials?.accessToken) {
    return [];
  }

  const cacheKey = getShopifyRangeCacheKey({ store, startDate, endDate });
  const cachedOrders = getCachedShopifyOrders(cacheKey);
  if (cachedOrders) {
    return aggregateShopifyOrdersByDate(cachedOrders, country);
  }

  const orders = await fetchShopifyOrders(startDate, endDate, { credentials });
  setCachedShopifyOrders(cacheKey, orders);
  return aggregateShopifyOrdersByDate(orders, country);
}

export async function fetchDailyOrdersRows({ db, store, startDate, endDate, country }) {
  const dbRows = fetchDailyOrdersRowsFromDb({ db, store, startDate, endDate, country });
  if (!shouldAttemptShopifyDirectFallback({ store, dbRows })) {
    return dbRows;
  }

  try {
    const directRows = await fetchShopifyDirectDailyOrders({ store, startDate, endDate, country });
    if (hasOrderVolume(directRows)) {
      return directRows;
    }
  } catch (error) {
    console.warn(`[CampaignIntelligence] Shopify direct fallback failed for ${store}: ${error.message}`);
  }

  return dbRows;
}

export function fetchDailyMetaRows({
  db,
  store,
  levelConfig,
  startDate,
  endDate,
  entityId,
  country
}) {
  const { whereSql, args } = buildScopeWhere(levelConfig, {
    store,
    startDate,
    endDate,
    entityId,
    country
  });

  const rows = db
    .prepare(`
      SELECT
        date,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(landing_page_views) as landingPageViews,
        SUM(add_to_cart) as addToCart,
        SUM(checkouts_initiated) as checkoutsInitiated,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversionValue
      FROM ${levelConfig.table}
      WHERE ${whereSql}
      GROUP BY date
      ORDER BY date ASC
    `)
    .all(...args)
    .map((row) => {
      const impressions = toNumber(row.impressions);
      const clicks = toNumber(row.clicks);
      const landingPageViews = toNumber(row.landingPageViews);
      const spend = toNumber(row.spend);
      const conversions = toNumber(row.conversions);
      const reach = toNumber(row.reach);

      return {
        date: parseIsoDate(row.date),
        spend,
        impressions,
        reach,
        clicks,
        landingPageViews,
        addToCart: toNumber(row.addToCart),
        checkoutsInitiated: toNumber(row.checkoutsInitiated),
        conversions,
        conversionValue: toNumber(row.conversionValue),
        ctr: safeDivide(clicks, impressions),
        cvr: safeDivide(conversions, clicks),
        cpm: safeDivide(spend * 1000, impressions),
        lpvRate: safeDivide(landingPageViews, clicks),
        frequency: safeDivide(impressions, reach),
        ordersPerSpend: safeDivide(conversions, spend)
      };
    })
    .filter((row) => row.date);

  return rows;
}

export function mergeDailySeries({ dateRange, metaRows, orderRows }) {
  const metaByDate = new Map(metaRows.map((row) => [row.date, row]));
  const ordersByDate = new Map(orderRows.map((row) => [row.date, row]));

  return dateRange.map((date) => {
    const meta = metaByDate.get(date) || {
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      landingPageViews: 0,
      addToCart: 0,
      checkoutsInitiated: 0,
      conversions: 0,
      conversionValue: 0,
      ctr: 0,
      cvr: 0,
      cpm: 0,
      lpvRate: 0,
      frequency: 0,
      ordersPerSpend: 0
    };
    const orders = ordersByDate.get(date) || { orders: 0, revenue: 0 };

    const metaOrdersPerSpend = safeDivide(meta.conversions, meta.spend);
    const shopifyOrdersPerSpend = safeDivide(orders.orders, meta.spend);

    return {
      date,
      spend: round(meta.spend, 4),
      impressions: Math.round(meta.impressions),
      reach: Math.round(meta.reach),
      clicks: Math.round(meta.clicks),
      landingPageViews: Math.round(meta.landingPageViews),
      addToCart: Math.round(meta.addToCart),
      checkoutsInitiated: Math.round(meta.checkoutsInitiated),
      conversions: round(meta.conversions, 4),
      conversionValue: round(meta.conversionValue, 4),
      ctr: meta.ctr,
      cvr: meta.cvr,
      cpm: meta.cpm,
      lpvRate: meta.lpvRate,
      frequency: meta.frequency,
      orders: Math.round(orders.orders),
      revenue: round(orders.revenue, 2),
      ordersPerSpend: shopifyOrdersPerSpend,
      metaOrdersPerSpend,
      shopifyOrdersPerSpend
    };
  });
}

export function fetchScopeLifecycleSummary(scope) {
  const { db, store, levelConfig, analysisRange, country } = scope;
  const lookbackStart = addDaysIso(analysisRange.startDate, -30);

  const whereParts = ['store = ?', 'date BETWEEN ? AND ?'];
  const args = [store, lookbackStart, analysisRange.endDate];

  if (country !== 'ALL') {
    const countryFilter = buildCountryWhereClause(country);
    whereParts.push(countryFilter.clause);
    args.push(...countryFilter.args);
  }

  const rows = db
    .prepare(`
      SELECT
        ${levelConfig.idColumn} as id,
        MIN(date) as firstSeen,
        MAX(date) as lastSeen,
        SUM(spend) as spend
      FROM ${levelConfig.table}
      WHERE ${whereParts.join(' AND ')}
      GROUP BY ${levelConfig.idColumn}
    `)
    .all(...args)
    .map((row) => ({
      id: String(row.id),
      firstSeen: parseIsoDate(row.firstSeen),
      lastSeen: parseIsoDate(row.lastSeen),
      spend: toNumber(row.spend)
    }))
    .filter((row) => row.firstSeen && row.lastSeen);

  const newlyStartedCutoff = addDaysIso(analysisRange.endDate, -6);
  const wentQuietCutoff = addDaysIso(analysisRange.endDate, -2);
  const activeCutoff = addDaysIso(analysisRange.endDate, -1);

  const newlyStarted = rows.filter((row) => row.firstSeen >= newlyStartedCutoff && row.spend > 0).length;
  const wentQuiet = rows.filter((row) => row.lastSeen <= wentQuietCutoff && row.spend > 0).length;
  const active = rows.filter((row) => row.lastSeen >= activeCutoff && row.spend > 0).length;

  return {
    totalTracked: rows.length,
    active,
    newlyStarted,
    wentQuiet
  };
}

export function fetchEntitySnapshot(scope) {
  const { db, store, levelConfig, entityId, country, analysisRange } = scope;

  if (!entityId) {
    return {
      firstSeen: analysisRange.startDate,
      lastSeen: analysisRange.endDate,
      activeDays: listDateRange(analysisRange.startDate, analysisRange.endDate).length,
      totalSpend: 0,
      totalConversions: 0
    };
  }

  const whereParts = ['store = ?', `${levelConfig.idColumn} = ?`];
  const args = [store, entityId];

  if (country !== 'ALL') {
    const countryFilter = buildCountryWhereClause(country);
    whereParts.push(countryFilter.clause);
    args.push(...countryFilter.args);
  }

  const row = db
    .prepare(`
      SELECT
        MIN(date) as firstSeen,
        MAX(date) as lastSeen,
        COUNT(DISTINCT date) as activeDays,
        SUM(spend) as totalSpend,
        SUM(conversions) as totalConversions
      FROM ${levelConfig.table}
      WHERE ${whereParts.join(' AND ')}
    `)
    .get(...args);

  return {
    firstSeen: parseIsoDate(row?.firstSeen),
    lastSeen: parseIsoDate(row?.lastSeen),
    activeDays: Math.round(toNumber(row?.activeDays)),
    totalSpend: round(toNumber(row?.totalSpend), 2),
    totalConversions: round(toNumber(row?.totalConversions), 2)
  };
}

function buildLevelWindowQueryConfig(level) {
  if (level === 'campaign') {
    return {
      levelConfig: LEVEL_CONFIG.campaign,
      extraSelect: '',
      groupBy: 'campaign_id, campaign_name',
      statusColumns: ['effective_status']
    };
  }

  if (level === 'adset') {
    return {
      levelConfig: LEVEL_CONFIG.adset,
      extraSelect: ', campaign_id as campaignId, campaign_name as campaignName',
      groupBy: 'adset_id, adset_name, campaign_id, campaign_name',
      statusColumns: ['adset_effective_status', 'effective_status']
    };
  }

  return {
    levelConfig: LEVEL_CONFIG.ad,
    extraSelect: ', campaign_id as campaignId, campaign_name as campaignName, adset_id as adsetId, adset_name as adsetName',
    groupBy: 'ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name',
    statusColumns: ['ad_effective_status', 'effective_status']
  };
}

function getTableColumns(db, tableName) {
  if (!db || !tableName) return new Set();
  const cacheKey = String(tableName);
  const cached = TABLE_COLUMNS_CACHE.get(cacheKey);
  if (cached) return cached;

  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const columns = new Set(rows.map((row) => String(row?.name || '').trim()).filter(Boolean));
  TABLE_COLUMNS_CACHE.set(cacheKey, columns);
  return columns;
}

function resolveStatusColumn(db, tableName, candidates = []) {
  const columns = getTableColumns(db, tableName);
  return candidates.find((columnName) => columns.has(columnName)) || null;
}

function buildActiveEntitySubqueryFilter({
  db,
  tableName,
  idColumn,
  statusColumns,
  store,
  endDate,
  country,
  entityId
}) {
  if (!db || !tableName || !idColumn || !store || !endDate) return null;

  const statusColumn = resolveStatusColumn(db, tableName, statusColumns);
  if (!statusColumn) return null;

  const { whereSql, args } = buildScopeWhere(
    { table: tableName, idColumn },
    {
      store,
      startDate: endDate,
      endDate,
      entityId,
      country
    }
  );

  return {
    clause: `${idColumn} IN (
      SELECT DISTINCT ${idColumn}
      FROM ${tableName}
      WHERE ${whereSql}
      AND UPPER(COALESCE(${statusColumn}, '${UNKNOWN_EFFECTIVE_STATUS}')) = ?
    )`,
    args: [...args, ACTIVE_EFFECTIVE_STATUS]
  };
}

function fetchHierarchyLevelWindowRows({
  db,
  store,
  level,
  startDate,
  endDate,
  country,
  limit
}) {
  const queryConfig = buildLevelWindowQueryConfig(level);
  const statusColumn = resolveStatusColumn(db, queryConfig.levelConfig.table, queryConfig.statusColumns);
  const activeStatusFilterSql = statusColumn
    ? `UPPER(COALESCE(${statusColumn}, '${UNKNOWN_EFFECTIVE_STATUS}')) = ?`
    : null;
  const { whereSql, args } = buildScopeWhere(queryConfig.levelConfig, {
    store,
    startDate,
    endDate,
    entityId: null,
    country
  });

  const rows = db.prepare(`
    SELECT
      ${queryConfig.levelConfig.idColumn} as id,
      ${queryConfig.levelConfig.nameColumn} as name
      ${queryConfig.extraSelect},
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(landing_page_views) as landingPageViews,
      SUM(add_to_cart) as addToCart,
      SUM(checkouts_initiated) as checkoutsInitiated,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversionValue
    FROM ${queryConfig.levelConfig.table}
    WHERE ${whereSql}
    ${activeStatusFilterSql ? `AND ${activeStatusFilterSql}` : ''}
    GROUP BY ${queryConfig.groupBy}
    HAVING SUM(spend) > 0
    ORDER BY spend DESC
    LIMIT ?
  `).all(...args, ...(activeStatusFilterSql ? [ACTIVE_EFFECTIVE_STATUS] : []), limit);

  return rows.map((row) => ({
    id: String(row.id || ''),
    name: formatEntityNameFallback(row, queryConfig.levelConfig.label),
    campaignId: row?.campaignId ? String(row.campaignId) : null,
    campaignName: row?.campaignName ? String(row.campaignName) : null,
    adsetId: row?.adsetId ? String(row.adsetId) : null,
    adsetName: row?.adsetName ? String(row.adsetName) : null,
    totals: {
      spend: toNumber(row.spend),
      impressions: toNumber(row.impressions),
      reach: toNumber(row.reach),
      clicks: toNumber(row.clicks),
      landingPageViews: toNumber(row.landingPageViews),
      addToCart: toNumber(row.addToCart),
      checkoutsInitiated: toNumber(row.checkoutsInitiated),
      conversions: toNumber(row.conversions),
      conversionValue: toNumber(row.conversionValue)
    }
  }));
}

function fetchHierarchyLevelWindowRowsForIds({
  db,
  store,
  level,
  startDate,
  endDate,
  country,
  ids,
  activeEndDate
}) {
  const idList = Array.isArray(ids)
    ? ids.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (!idList.length) return [];

  const queryConfig = buildLevelWindowQueryConfig(level);
  const { whereSql, args } = buildScopeWhere(queryConfig.levelConfig, {
    store,
    startDate,
    endDate,
    entityId: null,
    country
  });
  const whereParts = [whereSql];
  const queryArgs = [...args];

  const activeFilter = buildActiveEntitySubqueryFilter({
    db,
    tableName: queryConfig.levelConfig.table,
    idColumn: queryConfig.levelConfig.idColumn,
    statusColumns: queryConfig.statusColumns,
    store,
    endDate: activeEndDate || endDate,
    country,
    entityId: null
  });
  if (activeFilter) {
    whereParts.push(activeFilter.clause);
    queryArgs.push(...activeFilter.args);
  }

  const placeholders = idList.map(() => '?').join(', ');
  whereParts.push(`${queryConfig.levelConfig.idColumn} IN (${placeholders})`);
  queryArgs.push(...idList);

  const rows = db.prepare(`
    SELECT
      ${queryConfig.levelConfig.idColumn} as id,
      ${queryConfig.levelConfig.nameColumn} as name
      ${queryConfig.extraSelect},
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(reach) as reach,
      SUM(clicks) as clicks,
      SUM(landing_page_views) as landingPageViews,
      SUM(add_to_cart) as addToCart,
      SUM(checkouts_initiated) as checkoutsInitiated,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversionValue
    FROM ${queryConfig.levelConfig.table}
    WHERE ${whereParts.join(' AND ')}
    GROUP BY ${queryConfig.groupBy}
    HAVING SUM(spend) > 0
  `).all(...queryArgs);

  return rows.map((row) => ({
    id: String(row.id || ''),
    name: formatEntityNameFallback(row, queryConfig.levelConfig.label),
    campaignId: row?.campaignId ? String(row.campaignId) : null,
    campaignName: row?.campaignName ? String(row.campaignName) : null,
    adsetId: row?.adsetId ? String(row.adsetId) : null,
    adsetName: row?.adsetName ? String(row.adsetName) : null,
    totals: {
      spend: toNumber(row.spend),
      impressions: toNumber(row.impressions),
      reach: toNumber(row.reach),
      clicks: toNumber(row.clicks),
      landingPageViews: toNumber(row.landingPageViews),
      addToCart: toNumber(row.addToCart),
      checkoutsInitiated: toNumber(row.checkoutsInitiated),
      conversions: toNumber(row.conversions),
      conversionValue: toNumber(row.conversionValue)
    }
  }));
}

function buildHierarchyMetricSet(totals = {}) {
  if (!totals) {
    return {
      spend: null,
      purchases: null,
      ctr: null,
      hookRate: null,
      lpvClick: null,
      atcLpv: null,
      costAtc: null,
      icAtc: null,
      purchaseIc: null,
      roas: null,
      frequency: null,
      cpm: null,
      concentration: null
    };
  }

  const spend = toNumber(totals.spend);
  const impressions = toNumber(totals.impressions);
  const reach = toNumber(totals.reach);
  const clicks = toNumber(totals.clicks);
  const landingPageViews = toNumber(totals.landingPageViews);
  const addToCart = toNumber(totals.addToCart);
  const checkoutsInitiated = toNumber(totals.checkoutsInitiated);
  const conversions = toNumber(totals.conversions);
  const conversionValue = toNumber(totals.conversionValue);

  const ctr = safeDivide(clicks, impressions, null);
  const lpvClick = safeDivide(landingPageViews, clicks, null);
  const atcLpv = safeDivide(addToCart, landingPageViews, null);
  const costAtc = safeDivide(spend, addToCart, null);
  const icAtc = safeDivide(checkoutsInitiated, addToCart, null);
  const purchaseIc = safeDivide(conversions, checkoutsInitiated, null);
  const roas = safeDivide(conversionValue, spend, null);
  const frequency = safeDivide(impressions, reach, null);
  const cpm = safeDivide(spend * 1000, impressions, null);

  return {
    spend: round(spend, HIERARCHY_METRIC_DECIMALS.amount),
    purchases: Math.round(conversions),
    ctr: ctr == null ? null : round(ctr, HIERARCHY_METRIC_DECIMALS.ratio),
    hookRate: null,
    lpvClick: lpvClick == null ? null : round(lpvClick, HIERARCHY_METRIC_DECIMALS.ratio),
    atcLpv: atcLpv == null ? null : round(atcLpv, HIERARCHY_METRIC_DECIMALS.ratio),
    costAtc: costAtc == null ? null : round(costAtc, HIERARCHY_METRIC_DECIMALS.amount),
    icAtc: icAtc == null ? null : round(icAtc, HIERARCHY_METRIC_DECIMALS.ratio),
    purchaseIc: purchaseIc == null ? null : round(purchaseIc, HIERARCHY_METRIC_DECIMALS.ratio),
    roas: roas == null ? null : round(roas, HIERARCHY_METRIC_DECIMALS.ratio),
    frequency: frequency == null ? null : round(frequency, HIERARCHY_METRIC_DECIMALS.ratio),
    cpm: cpm == null ? null : round(cpm, HIERARCHY_METRIC_DECIMALS.amount),
    concentration: null
  };
}

function buildHierarchyLevelRows({ level, analysisRows = [], anchorRows = [] }) {
  const anchorById = new Map(anchorRows.map((row) => [row.id, row]));

  return analysisRows.map((analysisRow) => {
    const anchorRow = anchorById.get(analysisRow.id);
    const levelLabel = level === 'adset' ? 'Ad Set' : level === 'ad' ? 'Ad' : 'Campaign';
    const prefixedId = `${level}:${analysisRow.id}`;

    return {
      id: prefixedId,
      level,
      levelLabel,
      entityId: analysisRow.id,
      name: analysisRow.name,
      parentId: level === 'campaign'
        ? null
        : level === 'adset'
          ? (analysisRow.campaignId ? `campaign:${analysisRow.campaignId}` : null)
          : (analysisRow.adsetId ? `adset:${analysisRow.adsetId}` : null),
      campaignId: analysisRow.campaignId || (level === 'campaign' ? analysisRow.id : null),
      campaignName: analysisRow.campaignName || (level === 'campaign' ? analysisRow.name : null),
      adsetId: analysisRow.adsetId || (level === 'adset' ? analysisRow.id : null),
      adsetName: analysisRow.adsetName || (level === 'adset' ? analysisRow.name : null),
      metrics: {
        now: buildHierarchyMetricSet(analysisRow.totals),
        baseline: buildHierarchyMetricSet(anchorRow?.totals ?? null)
      }
    };
  });
}

function buildRowsByFocus(rows = [], { focusLevel, focusEntityId }) {
  if (!focusLevel || !focusEntityId) return rows;

  const focusRow = rows.find((row) => row.level === focusLevel && row.entityId === focusEntityId);
  if (!focusRow) return rows;

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const childrenByParent = new Map();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = childrenByParent.get(row.parentId) || [];
    list.push(row);
    childrenByParent.set(row.parentId, list);
  }

  const selectedIds = new Set();
  const includeAncestors = (rowId) => {
    let current = rowById.get(rowId);
    while (current) {
      selectedIds.add(current.id);
      current = current.parentId ? rowById.get(current.parentId) : null;
    }
  };
  const includeDescendants = (rowId) => {
    const children = childrenByParent.get(rowId) || [];
    for (const child of children) {
      selectedIds.add(child.id);
      includeDescendants(child.id);
    }
  };

  includeAncestors(focusRow.id);
  if (focusLevel !== 'ad') {
    includeDescendants(focusRow.id);
  }

  return rows.filter((row) => selectedIds.has(row.id));
}

export function fetchUnifiedHierarchyRows({
  db,
  store,
  analysisRange,
  anchorRange,
  country,
  selectorLimit,
  focusLevel,
  focusEntityId
}) {
  const campaignLimit = Math.min(HIERARCHY_LEVEL_LIMITS.campaign, Math.max(8, selectorLimit));
  const adsetLimit = Math.min(HIERARCHY_LEVEL_LIMITS.adset, campaignLimit * 3);
  const adLimit = Math.min(HIERARCHY_LEVEL_LIMITS.ad, adsetLimit * 2);

  const analysisCampaignRows = fetchHierarchyLevelWindowRows({
    db,
    store,
    level: 'campaign',
    startDate: analysisRange.startDate,
    endDate: analysisRange.endDate,
    country,
    limit: campaignLimit
  });
  const analysisAdsetRows = fetchHierarchyLevelWindowRows({
    db,
    store,
    level: 'adset',
    startDate: analysisRange.startDate,
    endDate: analysisRange.endDate,
    country,
    limit: adsetLimit
  });
  const analysisAdRows = fetchHierarchyLevelWindowRows({
    db,
    store,
    level: 'ad',
    startDate: analysisRange.startDate,
    endDate: analysisRange.endDate,
    country,
    limit: adLimit
  });

  const analysisCampaignIds = analysisCampaignRows.map((row) => row.id);
  const anchorCampaignRows = fetchHierarchyLevelWindowRowsForIds({
    db,
    store,
    level: 'campaign',
    startDate: anchorRange.startDate,
    endDate: anchorRange.endDate,
    country,
    ids: analysisCampaignIds,
    activeEndDate: analysisRange.endDate
  });

  const campaignRows = buildHierarchyLevelRows({
    level: 'campaign',
    analysisRows: analysisCampaignRows,
    anchorRows: anchorCampaignRows
  });
  const campaignIdSet = new Set(campaignRows.map((row) => row.entityId));

  const analysisAdsetRowsFiltered = analysisAdsetRows.filter((row) => row.campaignId && campaignIdSet.has(row.campaignId));
  const anchorAdsetRows = fetchHierarchyLevelWindowRowsForIds({
    db,
    store,
    level: 'adset',
    startDate: anchorRange.startDate,
    endDate: anchorRange.endDate,
    country,
    ids: analysisAdsetRowsFiltered.map((row) => row.id),
    activeEndDate: analysisRange.endDate
  });

  const adsetRows = buildHierarchyLevelRows({
    level: 'adset',
    analysisRows: analysisAdsetRowsFiltered,
    anchorRows: anchorAdsetRows
  });
  const adsetIdSet = new Set(adsetRows.map((row) => row.entityId));

  const analysisAdRowsFiltered = analysisAdRows.filter((row) => row.adsetId && adsetIdSet.has(row.adsetId));
  const anchorAdRows = fetchHierarchyLevelWindowRowsForIds({
    db,
    store,
    level: 'ad',
    startDate: anchorRange.startDate,
    endDate: anchorRange.endDate,
    country,
    ids: analysisAdRowsFiltered.map((row) => row.id),
    activeEndDate: analysisRange.endDate
  });

  const adRows = buildHierarchyLevelRows({
    level: 'ad',
    analysisRows: analysisAdRowsFiltered,
    anchorRows: anchorAdRows
  });

  const adsetsByCampaign = new Map();
  for (const row of adsetRows) {
    const list = adsetsByCampaign.get(row.campaignId) || [];
    list.push(row);
    adsetsByCampaign.set(row.campaignId, list);
  }
  for (const list of adsetsByCampaign.values()) {
    list.sort((left, right) => (right.metrics.now.spend || 0) - (left.metrics.now.spend || 0));
  }

  const adsByAdset = new Map();
  for (const row of adRows) {
    const list = adsByAdset.get(row.adsetId) || [];
    list.push(row);
    adsByAdset.set(row.adsetId, list);
  }
  for (const list of adsByAdset.values()) {
    list.sort((left, right) => (right.metrics.now.spend || 0) - (left.metrics.now.spend || 0));
  }

  const flattenedRows = [];
  const sortedCampaignRows = campaignRows
    .slice()
    .sort((left, right) => (right.metrics.now.spend || 0) - (left.metrics.now.spend || 0));

  for (const campaignRow of sortedCampaignRows) {
    flattenedRows.push(campaignRow);
    const campaignAdsets = adsetsByCampaign.get(campaignRow.entityId) || [];
    for (const adsetRow of campaignAdsets) {
      flattenedRows.push(adsetRow);
      const adsetAds = adsByAdset.get(adsetRow.entityId) || [];
      flattenedRows.push(...adsetAds);
    }
  }

  return buildRowsByFocus(flattenedRows, {
    focusLevel,
    focusEntityId
  });
}

export function buildDailyAggregationSummary(series) {
  const totals = series.reduce((accumulator, row) => {
    accumulator.spend += toNumber(row.spend);
    accumulator.impressions += toNumber(row.impressions);
    accumulator.reach += toNumber(row.reach);
    accumulator.clicks += toNumber(row.clicks);
    accumulator.landingPageViews += toNumber(row.landingPageViews);
    accumulator.conversions += toNumber(row.conversions);
    accumulator.orders += toNumber(row.orders);
    accumulator.revenue += toNumber(row.revenue);
    return accumulator;
  }, {
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    landingPageViews: 0,
    conversions: 0,
    orders: 0,
    revenue: 0
  });

  return {
    totals: {
      spend: round(totals.spend, 2),
      impressions: Math.round(totals.impressions),
      reach: Math.round(totals.reach),
      clicks: Math.round(totals.clicks),
      landingPageViews: Math.round(totals.landingPageViews),
      conversions: round(totals.conversions, 2),
      orders: Math.round(totals.orders),
      revenue: round(totals.revenue, 2)
    },
    rates: {
      ctr: safeDivide(totals.clicks, totals.impressions),
      cvr: safeDivide(totals.conversions, totals.clicks),
      cpm: safeDivide(totals.spend * 1000, totals.impressions),
      lpvRate: safeDivide(totals.landingPageViews, totals.clicks),
      ordersPerSpend: safeDivide(totals.orders, totals.spend),
      roas: safeDivide(totals.revenue, totals.spend)
    }
  };
}
