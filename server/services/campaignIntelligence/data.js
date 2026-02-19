import { getDb } from '../../db/database.js';
import {
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
  const normalized = String(rawCountry).trim().toUpperCase();
  if (!COUNTRY_CODE_PATTERN.test(normalized)) {
    const error = new Error('country must be ALL or a 2-letter ISO code');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function getLatestMetricDate(db, store, levelConfig) {
  const row = db
    .prepare(`SELECT MAX(date) as maxDate FROM ${levelConfig.table} WHERE store = ?`)
    .get(store);
  return parseIsoDate(row?.maxDate);
}

function resolveRangeWindow({
  db,
  store,
  levelConfig,
  startDate,
  endDate,
  analysisWindowDays
}) {
  const latestDate = getLatestMetricDate(db, store, levelConfig);
  const resolvedEndDate = parseIsoDate(endDate) || latestDate || new Date().toISOString().slice(0, 10);

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

  const defaultAnchorEnd = addDaysIso(analysisStartDate, -1);
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
    whereParts.push('country = ?');
    args.push(country);
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
    startDate: query.startDate,
    endDate: query.endDate,
    analysisWindowDays: query.analysisWindowDays
  });

  const anchorRange = resolveAnchorWindow({
    analysisStartDate: analysisRange.startDate,
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
  const { db, store, levelConfig, analysisRange, country, selectorLimit } = scope;
  const whereParts = ['store = ?', 'date BETWEEN ? AND ?'];
  const args = [store, analysisRange.startDate, analysisRange.endDate];

  if (country !== 'ALL') {
    whereParts.push('country = ?');
    args.push(country);
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
  const { db, store, levelConfig, analysisRange, entityId, selectorLimit } = scope;
  const { whereSql, args } = buildScopeWhere(levelConfig, {
    store,
    startDate: analysisRange.startDate,
    endDate: analysisRange.endDate,
    entityId,
    country: 'ALL'
  });

  const rows = db
    .prepare(`
      SELECT country as code, SUM(spend) as spend, SUM(conversions) as conversions
      FROM ${levelConfig.table}
      WHERE ${whereSql}
      AND country IS NOT NULL
      AND country != ''
      GROUP BY country
      HAVING SUM(spend) > 0
      ORDER BY spend DESC
      LIMIT ?
    `)
    .all(...args, selectorLimit);

  return rows
    .map((row) => ({
      code: String(row.code || '').toUpperCase(),
      spend: round(toNumber(row.spend), 2),
      conversions: Math.round(toNumber(row.conversions))
    }))
    .filter((row) => COUNTRY_CODE_PATTERN.test(row.code));
}

function getOrdersTable(store) {
  return ORDERS_TABLE_BY_STORE[store] || ORDERS_TABLE_BY_STORE.vironax;
}

export function fetchDailyOrdersRows({ db, store, startDate, endDate, country }) {
  const tableName = getOrdersTable(store);
  const revenueExpression = 'COALESCE(NULLIF(subtotal, 0), order_total)';
  const whereParts = ['store = ?', 'date BETWEEN ? AND ?', 'COALESCE(is_excluded, 0) = 0'];
  const args = [store, startDate, endDate];

  if (country && country !== 'ALL') {
    whereParts.push("UPPER(COALESCE(country_code, country, '')) = ?");
    args.push(country);
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

    const combinedOrdersPerSpend = safeDivide(orders.orders, meta.spend);

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
      ordersPerSpend: combinedOrdersPerSpend
    };
  });
}

export function fetchScopeLifecycleSummary(scope) {
  const { db, store, levelConfig, analysisRange, country } = scope;
  const lookbackStart = addDaysIso(analysisRange.startDate, -30);

  const whereParts = ['store = ?', 'date BETWEEN ? AND ?'];
  const args = [store, lookbackStart, analysisRange.endDate];

  if (country !== 'ALL') {
    whereParts.push('country = ?');
    args.push(country);
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
    whereParts.push('country = ?');
    args.push(country);
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
