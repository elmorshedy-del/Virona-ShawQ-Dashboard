import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

const DEFAULT_RANGE_DAYS = 60;
const DEFAULT_SCAN_DAYS = 14;
const DEFAULT_WINDOW_DAYS = 14;

function clampInt(value, { min, max, fallback }) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function addDaysIso(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildDateArray(startDate, endDate) {
  const out = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function mad(values, med) {
  if (!values.length || med == null) return null;
  const deviations = values.map((v) => Math.abs(v - med));
  return median(deviations);
}

function safePctChange(observed, expected) {
  if (expected == null) return null;
  if (expected === 0) {
    if (observed === 0) return 0;
    return null;
  }
  return (observed - expected) / expected;
}

function computeRobustZ(observed, baselineValues) {
  const med = median(baselineValues);
  if (med == null) return { expected: null, z: null, mad: null };
  const madValue = mad(baselineValues, med);
  if (!madValue || madValue === 0) {
    return { expected: med, z: null, mad: madValue ?? 0 };
  }
  const scaledMad = 1.4826 * madValue;
  return { expected: med, z: (observed - med) / scaledMad, mad: madValue };
}

function getOrdersTable(store) {
  return store === 'shawq' ? 'shopify_orders' : 'salla_orders';
}

function getOrdersDailyAgg(store, startDate, endDate) {
  const db = getDb();
  const table = getOrdersTable(store);

  if (table === 'shopify_orders') {
    const rows = db.prepare(`
      SELECT
        date,
        COUNT(*) as orders,
        SUM(COALESCE(NULLIF(subtotal, 0), order_total)) as revenue,
        SUM(COALESCE(discount, 0)) as discount
      FROM shopify_orders
      WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY date
    `).all(store, startDate, endDate);

    return new Map(rows.map((r) => [r.date, r]));
  }

  const rows = db.prepare(`
    SELECT
      date,
      COUNT(*) as orders,
      SUM(COALESCE(NULLIF(subtotal, 0), order_total)) as revenue,
      SUM(COALESCE(discount, 0)) as discount
    FROM salla_orders
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY date
  `).all(store, startDate, endDate);

  return new Map(rows.map((r) => [r.date, r]));
}

function getMetaDailyAgg(store, startDate, endDate) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      date,
      SUM(spend) as spend,
      SUM(impressions) as impressions,
      SUM(clicks) as clicks,
      SUM(conversions) as conversions,
      SUM(conversion_value) as conversion_value
    FROM meta_daily_metrics
    WHERE store = ? AND date BETWEEN ? AND ?
    GROUP BY date
  `).all(store, startDate, endDate);

  return new Map(rows.map((r) => [r.date, r]));
}

function getMaxDate(table, store) {
  const db = getDb();
  try {
    const row = db.prepare(`SELECT MAX(date) as maxDate FROM ${table} WHERE store = ?`).get(store);
    return row?.maxDate || null;
  } catch (_error) {
    return null;
  }
}

function buildDailySeries(store, startDate, endDate) {
  const dates = buildDateArray(startDate, endDate);
  const ordersMap = getOrdersDailyAgg(store, startDate, endDate);
  const metaMap = getMetaDailyAgg(store, startDate, endDate);

  return dates.map((date) => {
    const orders = ordersMap.get(date) || { orders: 0, revenue: 0, discount: 0 };
    const meta = metaMap.get(date) || {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversion_value: 0
    };

    const ordersCount = Number(orders.orders) || 0;
    const revenue = Number(orders.revenue) || 0;
    const discount = Number(orders.discount) || 0;

    const spend = Number(meta.spend) || 0;
    const impressions = Number(meta.impressions) || 0;
    const clicks = Number(meta.clicks) || 0;
    const conversions = Number(meta.conversions) || 0;

    const aov = ordersCount > 0 ? revenue / ordersCount : null;
    const roas = spend > 0 ? revenue / spend : null;
    const ctr = impressions > 0 ? clicks / impressions : null;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
    const cvr = clicks > 0 ? conversions / clicks : null;
    const discountRate = revenue > 0 ? discount / revenue : null;
    const attributionGap = ordersCount > 0 ? (conversions - ordersCount) / ordersCount : null;

    return {
      date,
      orders: ordersCount,
      revenue,
      discount,
      spend,
      impressions,
      clicks,
      conversions,
      aov,
      roas,
      ctr,
      cpm,
      cvr,
      discountRate,
      attributionGap
    };
  });
}

function defaultRulesForStore(store) {
  const revenueMin = store === 'shawq' ? 250 : 500;

  return [
    {
      metric_key: 'revenue',
      title: 'Revenue drop',
      direction: 'down',
      threshold_type: 'pct_change',
      threshold_value: 0.18,
      window_days: 14,
      min_baseline: revenueMin
    },
    {
      metric_key: 'orders',
      title: 'Orders drop',
      direction: 'down',
      threshold_type: 'pct_change',
      threshold_value: 0.2,
      window_days: 14,
      min_baseline: 5
    },
    {
      metric_key: 'spend',
      title: 'Spend spike',
      direction: 'up',
      threshold_type: 'pct_change',
      threshold_value: 0.25,
      window_days: 14,
      min_baseline: store === 'shawq' ? 50 : 100
    },
    {
      metric_key: 'roas',
      title: 'ROAS drop',
      direction: 'down',
      threshold_type: 'pct_change',
      threshold_value: 0.25,
      window_days: 14,
      min_baseline: 0.8
    },
    {
      metric_key: 'ctr',
      title: 'CTR drop',
      direction: 'down',
      threshold_type: 'pct_change',
      threshold_value: 0.2,
      window_days: 14,
      min_baseline: 0.005
    },
    {
      metric_key: 'cpm',
      title: 'CPM spike',
      direction: 'up',
      threshold_type: 'pct_change',
      threshold_value: 0.25,
      window_days: 14,
      min_baseline: 3
    },
    {
      metric_key: 'cvr',
      title: 'Conversion rate drop',
      direction: 'down',
      threshold_type: 'pct_change',
      threshold_value: 0.25,
      window_days: 14,
      min_baseline: 0.01
    },
    {
      metric_key: 'discountRate',
      title: 'Discount dependence rising',
      direction: 'up',
      threshold_type: 'pct_change',
      threshold_value: 0.2,
      window_days: 14,
      min_baseline: 0.02
    }
  ];
}

function loadRules(store) {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT
        id,
        store,
        is_enabled as isEnabled,
        metric_key as metricKey,
        direction,
        threshold_type as thresholdType,
        threshold_value as thresholdValue,
        window_days as windowDays,
        min_baseline as minBaseline,
        title,
        created_at as createdAt,
        updated_at as updatedAt
      FROM watchtower_rules
      WHERE store = ?
      ORDER BY metric_key ASC, id ASC
    `).all(store);

    if (rows && rows.length) return rows;
  } catch (_error) {
    // ignore
  }

  // Seed defaults if none exist yet (keeps the UI editable/persistent).
  const defaults = defaultRulesForStore(store);
  try {
    db.exec('BEGIN');
    const stmt = db.prepare(`
      INSERT INTO watchtower_rules (
        store,
        is_enabled,
        metric_key,
        direction,
        threshold_type,
        threshold_value,
        window_days,
        min_baseline,
        title,
        updated_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    defaults.forEach((rule) => {
      stmt.run(
        store,
        rule.metric_key,
        rule.direction,
        rule.threshold_type,
        rule.threshold_value,
        rule.window_days,
        rule.min_baseline,
        rule.title,
        now
      );
    });
    db.exec('COMMIT');
  } catch (_error) {
    try { db.exec('ROLLBACK'); } catch (_rollbackError) { /* ignore */ }
  }

  try {
    return db.prepare(`
      SELECT
        id,
        store,
        is_enabled as isEnabled,
        metric_key as metricKey,
        direction,
        threshold_type as thresholdType,
        threshold_value as thresholdValue,
        window_days as windowDays,
        min_baseline as minBaseline,
        title,
        created_at as createdAt,
        updated_at as updatedAt
      FROM watchtower_rules
      WHERE store = ?
      ORDER BY metric_key ASC, id ASC
    `).all(store);
  } catch (_error) {
    return [];
  }
}

function metricLabel(metricKey) {
  switch (metricKey) {
    case 'revenue': return 'Revenue';
    case 'orders': return 'Orders';
    case 'spend': return 'Spend';
    case 'roas': return 'ROAS';
    case 'aov': return 'AOV';
    case 'ctr': return 'CTR';
    case 'cpm': return 'CPM';
    case 'cvr': return 'Conversion rate';
    case 'discountRate': return 'Discount rate';
    case 'attributionGap': return 'Attribution gap';
    default: return metricKey;
  }
}

function metricDomain(metricKey) {
  if (metricKey === 'spend' || metricKey === 'cpm') return 'waste';
  if (metricKey === 'revenue' || metricKey === 'orders') return 'growth';
  if (metricKey === 'discountRate' || metricKey === 'attributionGap') return 'tracking';
  return 'risk';
}

function computeSeverity({ z, deltaPct }) {
  const absZ = z == null ? 0 : Math.abs(z);
  const absPct = deltaPct == null ? 0 : Math.abs(deltaPct);
  if (absZ >= 4 || absPct >= 0.5) return 'high';
  if (absZ >= 3 || absPct >= 0.3) return 'medium';
  return 'low';
}

function computeConfidence({ baselineCount, z, madValue }) {
  if (baselineCount < 7) return 0.35;
  const base = baselineCount >= 14 ? 0.75 : 0.6;
  const zBoost = z == null ? 0 : Math.min(0.15, Math.abs(z) / 30);
  const madPenalty = madValue === 0 ? 0.15 : 0;
  return Math.max(0.3, Math.min(0.92, base + zBoost - madPenalty));
}

function shouldTriggerRule({ rule, observed, expected, z, deltaPct }) {
  if (!rule.isEnabled) return false;
  if (observed == null || expected == null) return false;
  if (rule.minBaseline != null && expected < rule.minBaseline) return false;

  const direction = rule.direction || 'any';
  const delta = observed - expected;
  if (direction === 'up' && delta <= 0) return false;
  if (direction === 'down' && delta >= 0) return false;

  if (rule.thresholdType === 'zscore') {
    if (z == null) return false;
    return Math.abs(z) >= Number(rule.thresholdValue || 0);
  }

  if (rule.thresholdType === 'absolute') {
    return Math.abs(delta) >= Number(rule.thresholdValue || 0);
  }

  // pct_change
  if (deltaPct == null) return false;
  return Math.abs(deltaPct) >= Number(rule.thresholdValue || 0);
}

function computeAlerts({ store, daily, scanDays, rules }) {
  const alerts = [];
  const scan = Math.min(scanDays, daily.length);
  const startIndex = Math.max(0, daily.length - scan);

  for (let i = startIndex; i < daily.length; i += 1) {
    const point = daily[i];
    for (const rule of rules) {
      const windowDays = clampInt(rule.windowDays, { min: 7, max: 56, fallback: DEFAULT_WINDOW_DAYS });
      const baselineStart = Math.max(0, i - windowDays);
      const baselineEnd = i;
      if (baselineEnd - baselineStart < 7) continue;

      const baselineValues = daily
        .slice(baselineStart, baselineEnd)
        .map((d) => d[rule.metricKey])
        .filter((v) => typeof v === 'number' && Number.isFinite(v));

      if (baselineValues.length < 7) continue;

      const observed = point[rule.metricKey];
      if (typeof observed !== 'number' || !Number.isFinite(observed)) continue;

      const { expected, z, mad: madValue } = computeRobustZ(observed, baselineValues);
      const deltaPct = safePctChange(observed, expected);

      if (!shouldTriggerRule({ rule, observed, expected, z, deltaPct })) continue;

      const severity = computeSeverity({ z, deltaPct });
      const confidence = computeConfidence({ baselineCount: baselineValues.length, z, madValue });

      const direction = observed >= expected ? 'up' : 'down';
      const pctLabel = deltaPct == null ? '—' : `${Math.abs(deltaPct * 100).toFixed(0)}%`;
      const title = `${metricLabel(rule.metricKey)} ${direction === 'down' ? 'down' : 'up'} ${pctLabel} vs baseline`;

      alerts.push({
        id: `${rule.metricKey}:${point.date}:${rule.title || 'rule'}`,
        date: point.date,
        severity,
        domain: metricDomain(rule.metricKey),
        metricKey: rule.metricKey,
        metricLabel: metricLabel(rule.metricKey),
        ruleTitle: rule.title || null,
        observed,
        expected,
        delta: expected == null ? null : observed - expected,
        deltaPct,
        z,
        confidence,
        title,
        windowDays,
        baselineStartDate: daily[baselineStart]?.date || null,
        baselineEndDate: daily[baselineEnd - 1]?.date || null
      });
    }
  }

  const severityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity];
    if (sev !== 0) return sev;
    return b.date.localeCompare(a.date);
  });

  return alerts.slice(0, 60);
}

function computeHealth({ alerts, freshness }) {
  let score = 100;

  const weights = { high: 14, medium: 8, low: 3 };
  for (const alert of alerts) {
    score -= weights[alert.severity] || 3;
  }

  if (freshness?.meta?.status === 'stale') score -= 10;
  if (freshness?.orders?.status === 'stale') score -= 10;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let status = 'healthy';
  if (score < 55) status = 'critical';
  else if (score < 70) status = 'warning';
  else if (score < 85) status = 'needs_attention';

  return { score, status };
}

function getFreshness(store) {
  const today = formatDateAsGmt3(new Date());
  const yesterday = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const ordersTable = getOrdersTable(store);
  const lastOrdersDate = getMaxDate(ordersTable, store);
  const lastMetaDate = getMaxDate('meta_daily_metrics', store);

  const freshnessFor = (lastDate, label) => {
    if (!lastDate) {
      return { lastDate: null, status: 'missing', message: `${label} has no data yet.` };
    }
    if (lastDate >= today) return { lastDate, status: 'fresh', message: `${label} is up to date.` };
    if (lastDate >= yesterday) return { lastDate, status: 'ok', message: `${label} is recent (yesterday).` };
    return { lastDate, status: 'stale', message: `${label} seems stale (last: ${lastDate}).` };
  };

  return {
    orders: freshnessFor(lastOrdersDate, 'Orders'),
    meta: freshnessFor(lastMetaDate, 'Meta'),
    expectedToday: today
  };
}

function listAnnotations(store, { startDate, endDate } = {}) {
  const db = getDb();
  const args = [store];
  let where = 'WHERE store = ?';
  if (startDate && endDate) {
    where += ' AND event_date BETWEEN ? AND ?';
    args.push(startDate, endDate);
  }

  try {
    const rows = db.prepare(`
      SELECT
        id,
        store,
        event_date as eventDate,
        category,
        title,
        detail,
        created_at as createdAt
      FROM watchtower_annotations
      ${where}
      ORDER BY event_date DESC, id DESC
      LIMIT 200
    `).all(...args);
    return rows || [];
  } catch (_error) {
    return [];
  }
}

export function getWatchtowerOverview(store, params = {}) {
  const rangeDays = clampInt(params.rangeDays, { min: 14, max: 365, fallback: DEFAULT_RANGE_DAYS });
  const scanDays = clampInt(params.scanDays, { min: 3, max: 60, fallback: DEFAULT_SCAN_DAYS });

  const endDate = parseIsoDate(params.endDate) || formatDateAsGmt3(new Date());
  const startDate = parseIsoDate(params.startDate) || addDaysIso(endDate, -(rangeDays - 1));

  const daily = buildDailySeries(store, startDate, endDate);
  const rules = loadRules(store);

  const alerts = computeAlerts({
    store,
    daily,
    scanDays,
    rules
  });

  const freshness = getFreshness(store);
  const health = computeHealth({ alerts, freshness });
  const annotations = listAnnotations(store, { startDate, endDate });

  return {
    store,
    generatedAt: new Date().toISOString(),
    range: { startDate, endDate, rangeDays, scanDays },
    freshness,
    health,
    alerts,
    annotations,
    snapshot: {
      date: daily[daily.length - 1]?.date || null,
      revenue: daily[daily.length - 1]?.revenue ?? null,
      orders: daily[daily.length - 1]?.orders ?? null,
      spend: daily[daily.length - 1]?.spend ?? null,
      roas: daily[daily.length - 1]?.roas ?? null
    }
  };
}

export function getWatchtowerSeries(store, metricKey, params = {}) {
  const rangeDays = clampInt(params.rangeDays, { min: 14, max: 365, fallback: DEFAULT_RANGE_DAYS });
  const endDate = parseIsoDate(params.endDate) || formatDateAsGmt3(new Date());
  const startDate = parseIsoDate(params.startDate) || addDaysIso(endDate, -(rangeDays - 1));

  const daily = buildDailySeries(store, startDate, endDate);
  const series = daily.map((d) => ({
    date: d.date,
    value: d[metricKey] == null ? null : d[metricKey]
  }));

  const annotations = listAnnotations(store, { startDate, endDate });

  return {
    store,
    metricKey,
    metricLabel: metricLabel(metricKey),
    range: { startDate, endDate, rangeDays },
    series,
    annotations
  };
}

export function getWatchtowerDrivers(store, metricKey, dateStr, params = {}) {
  const date = parseIsoDate(dateStr);
  if (!date) {
    return {
      store,
      metricKey,
      metricLabel: metricLabel(metricKey),
      date: null,
      baseline: null,
      drivers: []
    };
  }

  const windowDays = clampInt(params.windowDays, { min: 7, max: 56, fallback: DEFAULT_WINDOW_DAYS });
  const baselineEnd = addDaysIso(date, -1);
  const baselineStart = addDaysIso(date, -windowDays);

  const db = getDb();

  const baseline = { startDate: baselineStart, endDate: baselineEnd, windowDays };
  const drivers = [];

  if (metricKey === 'spend' || metricKey === 'clicks' || metricKey === 'conversions') {
    const todayRows = db.prepare(`
      SELECT campaign_id as campaignId, campaign_name as campaignName, SUM(spend) as value
      FROM meta_daily_metrics
      WHERE store = ? AND date = ?
      GROUP BY campaign_id
      ORDER BY value DESC
      LIMIT 12
    `).all(store, date);

    const baselineRows = db.prepare(`
      SELECT campaign_id as campaignId, MAX(campaign_name) as campaignName, AVG(daily_spend) as baselineValue
      FROM (
        SELECT campaign_id, campaign_name, date, SUM(spend) as daily_spend
        FROM meta_daily_metrics
        WHERE store = ? AND date BETWEEN ? AND ?
        GROUP BY date, campaign_id
      )
      GROUP BY campaign_id
    `).all(store, baselineStart, baselineEnd);

    const baselineMap = new Map(baselineRows.map((r) => [r.campaignId, r]));

    todayRows.forEach((row) => {
      const base = baselineMap.get(row.campaignId);
      const expected = base?.baselineValue ?? null;
      const delta = expected == null ? null : Number(row.value) - Number(expected);
      const deltaPct = safePctChange(Number(row.value), expected == null ? null : Number(expected));

      drivers.push({
        dimension: 'campaign',
        key: row.campaignName || row.campaignId,
        observed: Number(row.value) || 0,
        expected: expected == null ? null : Number(expected),
        delta,
        deltaPct
      });
    });

    drivers.sort((a, b) => Math.abs((b.delta ?? 0)) - Math.abs((a.delta ?? 0)));
    return { store, metricKey, metricLabel: metricLabel(metricKey), date, baseline, drivers: drivers.slice(0, 10) };
  }

  // Default: revenue/orders drivers by country
  const ordersTable = getOrdersTable(store);
  const revenueExpr = ordersTable === 'shopify_orders'
    ? 'SUM(COALESCE(NULLIF(subtotal, 0), order_total))'
    : 'SUM(COALESCE(NULLIF(subtotal, 0), order_total))';

  const todayRows = db.prepare(`
    SELECT
      COALESCE(NULLIF(country_code, ''), NULLIF(country, ''), 'Unknown') as key,
      COUNT(*) as orders,
      ${revenueExpr} as revenue
    FROM ${ordersTable}
    WHERE store = ? AND date = ?
    GROUP BY 1
    ORDER BY revenue DESC
    LIMIT 12
  `).all(store, date);

  const baselineRows = db.prepare(`
    SELECT
      key,
      AVG(daily_revenue) as baselineRevenue,
      AVG(daily_orders) as baselineOrders
    FROM (
      SELECT
        date,
        COALESCE(NULLIF(country_code, ''), NULLIF(country, ''), 'Unknown') as key,
        COUNT(*) as daily_orders,
        ${revenueExpr} as daily_revenue
      FROM ${ordersTable}
      WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY date, 2
    )
    GROUP BY key
  `).all(store, baselineStart, baselineEnd);

  const baselineMap = new Map(baselineRows.map((r) => [r.key, r]));

  todayRows.forEach((row) => {
    const base = baselineMap.get(row.key);
    const observed = metricKey === 'orders' ? Number(row.orders) || 0 : Number(row.revenue) || 0;
    const expected = metricKey === 'orders'
      ? (base?.baselineOrders == null ? null : Number(base.baselineOrders))
      : (base?.baselineRevenue == null ? null : Number(base.baselineRevenue));

    const delta = expected == null ? null : observed - expected;
    const deltaPct = safePctChange(observed, expected);

    drivers.push({
      dimension: 'country',
      key: row.key,
      observed,
      expected,
      delta,
      deltaPct
    });
  });

  drivers.sort((a, b) => Math.abs((b.delta ?? 0)) - Math.abs((a.delta ?? 0)));
  return { store, metricKey, metricLabel: metricLabel(metricKey), date, baseline, drivers: drivers.slice(0, 10) };
}

export function listWatchtowerAnnotations(store, params = {}) {
  const endDate = parseIsoDate(params.endDate) || formatDateAsGmt3(new Date());
  const startDate = parseIsoDate(params.startDate) || addDaysIso(endDate, -(DEFAULT_RANGE_DAYS - 1));
  return listAnnotations(store, { startDate, endDate });
}

export function createWatchtowerAnnotation(payload = {}) {
  const db = getDb();
  const store = payload.store;
  const eventDate = parseIsoDate(payload.eventDate) || parseIsoDate(payload.event_date) || null;
  const title = (payload.title || '').trim();

  if (!store || !eventDate || !title) {
    throw new Error('store, eventDate, and title are required');
  }

  const category = (payload.category || 'note').trim().slice(0, 24);
  const detail = payload.detail ? String(payload.detail).trim() : null;

  const result = db.prepare(`
    INSERT INTO watchtower_annotations (store, event_date, category, title, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(store, eventDate, category, title, detail);

  return db.prepare(`
    SELECT
      id,
      store,
      event_date as eventDate,
      category,
      title,
      detail,
      created_at as createdAt
    FROM watchtower_annotations
    WHERE id = ?
  `).get(result.lastInsertRowid);
}

export function deleteWatchtowerAnnotation(store, id) {
  const db = getDb();
  const parsed = Number.parseInt(String(id), 10);
  if (!Number.isFinite(parsed)) return { success: false };

  const result = db.prepare(`
    DELETE FROM watchtower_annotations
    WHERE id = ? AND store = ?
  `).run(parsed, store);

  return { success: result.changes > 0 };
}

export function listWatchtowerRules(store) {
  return loadRules(store);
}

export function upsertWatchtowerRule(payload = {}) {
  const db = getDb();
  const store = payload.store;
  const metricKey = String(payload.metricKey || payload.metric_key || '').trim();
  const title = payload.title ? String(payload.title).trim() : null;
  const direction = String(payload.direction || 'any').trim();
  const thresholdType = String(payload.thresholdType || payload.threshold_type || 'pct_change').trim();
  const thresholdValue = Number(payload.thresholdValue ?? payload.threshold_value);
  const windowDays = clampInt(payload.windowDays ?? payload.window_days, { min: 7, max: 56, fallback: DEFAULT_WINDOW_DAYS });
  const minBaseline = Number(payload.minBaseline ?? payload.min_baseline ?? 0);
  const isEnabled = payload.isEnabled == null ? 1 : (payload.isEnabled ? 1 : 0);

  if (!store || !metricKey || !Number.isFinite(thresholdValue)) {
    throw new Error('store, metricKey, and thresholdValue are required');
  }

  const id = payload.id && Number.isFinite(Number(payload.id)) ? Number(payload.id) : null;

  if (!id) {
    const result = db.prepare(`
      INSERT INTO watchtower_rules (
        store,
        is_enabled,
        metric_key,
        direction,
        threshold_type,
        threshold_value,
        window_days,
        min_baseline,
        title,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      store,
      isEnabled,
      metricKey,
      direction,
      thresholdType,
      thresholdValue,
      windowDays,
      minBaseline,
      title,
      new Date().toISOString()
    );

    return db.prepare(`
      SELECT
        id,
        store,
        is_enabled as isEnabled,
        metric_key as metricKey,
        direction,
        threshold_type as thresholdType,
        threshold_value as thresholdValue,
        window_days as windowDays,
        min_baseline as minBaseline,
        title,
        created_at as createdAt,
        updated_at as updatedAt
      FROM watchtower_rules
      WHERE id = ?
    `).get(result.lastInsertRowid);
  }

  db.prepare(`
    UPDATE watchtower_rules
    SET
      is_enabled = ?,
      metric_key = ?,
      direction = ?,
      threshold_type = ?,
      threshold_value = ?,
      window_days = ?,
      min_baseline = ?,
      title = ?,
      updated_at = ?
    WHERE id = ? AND store = ?
  `).run(
    isEnabled,
    metricKey,
    direction,
    thresholdType,
    thresholdValue,
    windowDays,
    minBaseline,
    title,
    new Date().toISOString(),
    id,
    store
  );

  return db.prepare(`
    SELECT
      id,
      store,
      is_enabled as isEnabled,
      metric_key as metricKey,
      direction,
      threshold_type as thresholdType,
      threshold_value as thresholdValue,
      window_days as windowDays,
      min_baseline as minBaseline,
      title,
      created_at as createdAt,
      updated_at as updatedAt
    FROM watchtower_rules
    WHERE id = ? AND store = ?
  `).get(id, store);
}

export function deleteWatchtowerRule(store, id) {
  const db = getDb();
  const parsed = Number.parseInt(String(id), 10);
  if (!Number.isFinite(parsed)) return { success: false };

  const result = db.prepare(`
    DELETE FROM watchtower_rules
    WHERE id = ? AND store = ?
  `).run(parsed, store);

  return { success: result.changes > 0 };
}
