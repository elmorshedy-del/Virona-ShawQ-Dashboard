import { getDb } from '../../db/database.js';
import { formatDateAsGmt3 } from '../../utils/dateUtils.js';
import { getDashboard } from '../analyticsService.js';
import {
  DASHBOARD_DAILY_BRIEF_DEFAULTS,
  DASHBOARD_DAILY_BRIEF_PACKET_LIMITS,
  DASHBOARD_DAILY_BRIEF_SNAPSHOT_EVENT_THRESHOLDS,
  DASHBOARD_DAILY_BRIEF_SCOPE_KEY
} from './constants.js';

const REPORTING_TIMEZONE_OFFSET_HOURS = 3;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const REPORTING_TIMEZONE_OFFSET_MS = REPORTING_TIMEZONE_OFFSET_HOURS * MILLISECONDS_PER_HOUR;
const ENTITY_TYPES = Object.freeze({
  campaign: 'campaign',
  adset: 'adset',
  ad: 'ad',
  geo: 'geo'
});
const META_HIERARCHY_CONFIG = Object.freeze({
  adset: Object.freeze({
    entityType: ENTITY_TYPES.adset,
    table: 'meta_adset_metrics',
    idColumn: 'adset_id',
    nameColumn: 'adset_name',
    parentIdColumn: 'campaign_id',
    parentNameColumn: 'campaign_name',
    grandparentIdSql: 'NULL',
    grandparentNameSql: 'NULL',
    statusExpression: 'COALESCE(adset_effective_status, effective_status, \'UNKNOWN\')',
    statusColumn: 'adset_status',
    effectiveStatusColumn: 'adset_effective_status'
  }),
  ad: Object.freeze({
    entityType: ENTITY_TYPES.ad,
    table: 'meta_ad_metrics',
    idColumn: 'ad_id',
    nameColumn: 'ad_name',
    parentIdColumn: 'adset_id',
    parentNameColumn: 'adset_name',
    grandparentIdSql: 'campaign_id',
    grandparentNameSql: 'campaign_name',
    statusExpression: 'COALESCE(ad_effective_status, effective_status, \'UNKNOWN\')',
    statusColumn: 'ad_status',
    effectiveStatusColumn: 'ad_effective_status'
  })
});
const SNAPSHOT_ENTITY_TYPES = Object.freeze([
  ENTITY_TYPES.campaign,
  ENTITY_TYPES.adset,
  ENTITY_TYPES.ad,
  ENTITY_TYPES.geo
]);
const ENTITY_FIELDS = Object.freeze([
  'entity_type',
  'entity_id',
  'entity_name',
  'parent_entity_id',
  'parent_entity_name',
  'grandparent_entity_id',
  'grandparent_entity_name',
  'status',
  'effective_status',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'landing_page_views',
  'add_to_cart',
  'checkouts_initiated',
  'meta_purchases',
  'shopify_orders',
  'revenue',
  'ctr',
  'lpv_click',
  'atc_lpv',
  'ic_atc',
  'purchase_ic',
  'roas',
  'aov',
  'cac',
  'cpm',
  'cpc',
  'frequency',
  'metadata_json'
]);
const METRIC_SUM_FIELDS = Object.freeze([
  'spend',
  'impressions',
  'reach',
  'clicks',
  'landing_page_views',
  'add_to_cart',
  'checkouts_initiated',
  'meta_purchases',
  'shopify_orders',
  'revenue'
]);

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundValue(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeDivide(numerator, denominator, fallback = 0) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) {
    return fallback;
  }
  return top / bottom;
}

export function shiftIsoDate(dateValue, dayOffset) {
  const base = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return base.toISOString().slice(0, 10);
}

export function listDateRange(startDate, endDate) {
  const dates = [];
  let cursor = startDate;
  while (cursor && cursor <= endDate) {
    dates.push(cursor);
    cursor = shiftIsoDate(cursor, 1);
  }
  return dates;
}

export function resolveDashboardDailyBriefDate(requestedBriefDate = null) {
  if (requestedBriefDate) {
    return requestedBriefDate;
  }
  const reportingNow = new Date(Date.now() + REPORTING_TIMEZONE_OFFSET_MS);
  reportingNow.setUTCDate(reportingNow.getUTCDate() - 1);
  return formatDateAsGmt3(reportingNow);
}

function buildDashboardParams(startDate, endDate) {
  return {
    startDate,
    endDate,
    includeInactive: 'false'
  };
}

function buildRateMetrics({
  spend,
  impressions,
  reach,
  clicks,
  landingPageViews,
  addToCart,
  checkoutsInitiated,
  metaPurchases,
  shopifyOrders,
  revenue
}) {
  const resolvedSpend = toNumber(spend);
  const resolvedImpressions = toNumber(impressions);
  const resolvedReach = toNumber(reach);
  const resolvedClicks = toNumber(clicks);
  const resolvedLandingPageViews = toNumber(landingPageViews);
  const resolvedAddToCart = toNumber(addToCart);
  const resolvedCheckoutsInitiated = toNumber(checkoutsInitiated);
  const resolvedMetaPurchases = toNumber(metaPurchases);
  const resolvedShopifyOrders = toNumber(shopifyOrders);
  const resolvedRevenue = toNumber(revenue);
  const resolvedAttributedOrders = resolvedShopifyOrders > 0 ? resolvedShopifyOrders : resolvedMetaPurchases;

  return {
    spend: roundValue(resolvedSpend, 2),
    impressions: Math.round(resolvedImpressions),
    reach: Math.round(resolvedReach),
    clicks: Math.round(resolvedClicks),
    landing_page_views: Math.round(resolvedLandingPageViews),
    add_to_cart: Math.round(resolvedAddToCart),
    checkouts_initiated: Math.round(resolvedCheckoutsInitiated),
    meta_purchases: Math.round(resolvedMetaPurchases),
    shopify_orders: Math.round(resolvedShopifyOrders),
    revenue: roundValue(resolvedRevenue, 2),
    ctr: roundValue(safeDivide(resolvedClicks, resolvedImpressions, 0), 4),
    lpv_click: roundValue(safeDivide(resolvedLandingPageViews, resolvedClicks, 0), 4),
    atc_lpv: roundValue(safeDivide(resolvedAddToCart, resolvedLandingPageViews, 0), 4),
    ic_atc: roundValue(safeDivide(resolvedCheckoutsInitiated, resolvedAddToCart, 0), 4),
    purchase_ic: roundValue(safeDivide(resolvedAttributedOrders, resolvedCheckoutsInitiated, 0), 4),
    roas: roundValue(safeDivide(resolvedRevenue, resolvedSpend, 0), 4),
    aov: roundValue(safeDivide(resolvedRevenue, resolvedAttributedOrders, 0), 2),
    cac: roundValue(safeDivide(resolvedSpend, resolvedAttributedOrders, 0), 2),
    cpm: roundValue(safeDivide(resolvedSpend * 1000, resolvedImpressions, 0), 4),
    cpc: roundValue(safeDivide(resolvedSpend, resolvedClicks, 0), 4),
    frequency: roundValue(safeDivide(resolvedImpressions, resolvedReach, 0), 4)
  };
}

function buildStoredMetricColumns(row = {}) {
  return buildRateMetrics({
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    landingPageViews: row.landing_page_views,
    addToCart: row.add_to_cart,
    checkoutsInitiated: row.checkouts_initiated,
    metaPurchases: row.meta_purchases,
    shopifyOrders: row.shopify_orders,
    revenue: row.revenue
  });
}

function buildAccountSnapshotRow(snapshotDate, dashboard = {}) {
  const overview = dashboard?.overview || {};
  const metrics = buildRateMetrics({
    spend: overview.spend,
    impressions: dashboard?.metaImpressionsTotal,
    reach: dashboard?.metaReachTotal,
    clicks: dashboard?.metaClicksTotal,
    landingPageViews: dashboard?.metaLpvTotal,
    addToCart: dashboard?.metaAtcTotal,
    checkoutsInitiated: dashboard?.metaCheckoutTotal,
    metaPurchases: dashboard?.metaConversionsTotal,
    shopifyOrders: overview.orders,
    revenue: overview.revenue
  });

  return {
    snapshot_date: snapshotDate,
    ...metrics,
    metadata_json: JSON.stringify({
      source: 'dashboard-cards',
      countriesDataSource: dashboard?.countriesDataSource || null
    })
  };
}

function buildCampaignSnapshotRows(dashboard = {}) {
  const campaigns = Array.isArray(dashboard?.campaigns) ? dashboard.campaigns : [];
  return campaigns
    .filter((campaign) => campaign?.campaignId)
    .map((campaign) => {
      const metrics = buildRateMetrics({
        spend: campaign.spend,
        impressions: campaign.impressions,
        reach: campaign.reach,
        clicks: campaign.clicks,
        landingPageViews: campaign.lpv,
        addToCart: campaign.atc,
        checkoutsInitiated: campaign.checkout,
        metaPurchases: campaign.conversions,
        shopifyOrders: 0,
        revenue: campaign.conversionValue
      });
      return {
        entity_type: ENTITY_TYPES.campaign,
        entity_id: campaign.campaignId,
        entity_name: campaign.campaignName || 'Campaign',
        parent_entity_id: null,
        parent_entity_name: null,
        grandparent_entity_id: null,
        grandparent_entity_name: null,
        status: campaign.status || 'UNKNOWN',
        effective_status: campaign.effective_status || 'UNKNOWN',
        ...metrics,
        metadata_json: JSON.stringify({
          source: 'dashboard-campaigns',
          isActive: Boolean(campaign.isActive)
        })
      };
    });
}

function buildGeoSnapshotRows(dashboard = {}) {
  const countries = Array.isArray(dashboard?.countries) ? dashboard.countries : [];
  return countries
    .filter((country) => country?.code)
    .map((country) => {
      const metrics = buildRateMetrics({
        spend: country.spend,
        impressions: country.impressions,
        reach: country.reach,
        clicks: country.clicks,
        landingPageViews: country.lpv,
        addToCart: country.atc,
        checkoutsInitiated: country.checkout,
        metaPurchases: country.totalOrders,
        shopifyOrders: country.totalOrders,
        revenue: country.revenue
      });
      return {
        entity_type: ENTITY_TYPES.geo,
        entity_id: country.code,
        entity_name: country.name || country.code,
        parent_entity_id: null,
        parent_entity_name: null,
        grandparent_entity_id: null,
        grandparent_entity_name: null,
        status: 'UNKNOWN',
        effective_status: 'UNKNOWN',
        ...metrics,
        metadata_json: JSON.stringify({
          source: 'dashboard-countries',
          code: country.code,
          flag: country.flag || null
        })
      };
    });
}

function buildMetaHierarchyDayQuery(config) {
  return `
    SELECT
      ${config.idColumn} AS entityId,
      MAX(${config.nameColumn}) AS entityName,
      MAX(${config.parentIdColumn}) AS parentEntityId,
      MAX(${config.parentNameColumn}) AS parentEntityName,
      MAX(${config.grandparentIdSql}) AS grandparentEntityId,
      MAX(${config.grandparentNameSql}) AS grandparentEntityName,
      MAX(COALESCE(${config.statusColumn}, status, 'UNKNOWN')) AS status,
      MAX(${config.statusExpression}) AS effectiveStatus,
      SUM(spend) AS spend,
      SUM(impressions) AS impressions,
      SUM(reach) AS reach,
      SUM(clicks) AS clicks,
      SUM(landing_page_views) AS landingPageViews,
      SUM(add_to_cart) AS addToCart,
      SUM(checkouts_initiated) AS checkoutsInitiated,
      SUM(conversions) AS metaPurchases,
      SUM(conversion_value) AS revenue
    FROM ${config.table}
    WHERE store = ?
      AND date = ?
      AND (${config.statusExpression} = 'ACTIVE' OR ${config.statusExpression} = 'UNKNOWN' OR ${config.statusExpression} IS NULL)
    GROUP BY ${config.idColumn}
    HAVING SUM(spend) > 0 OR SUM(conversions) > 0
    ORDER BY SUM(spend) DESC
  `;
}

function buildMetaHierarchySnapshotRows(db, { store, snapshotDate }) {
  return Object.values(META_HIERARCHY_CONFIG).flatMap((config) => {
    const rows = db.prepare(buildMetaHierarchyDayQuery(config)).all(store, snapshotDate);
    return rows
      .filter((row) => row?.entityId)
      .map((row) => {
        const metrics = buildRateMetrics({
          spend: row.spend,
          impressions: row.impressions,
          reach: row.reach,
          clicks: row.clicks,
          landingPageViews: row.landingPageViews,
          addToCart: row.addToCart,
          checkoutsInitiated: row.checkoutsInitiated,
          metaPurchases: row.metaPurchases,
          shopifyOrders: 0,
          revenue: row.revenue
        });
        return {
          entity_type: config.entityType,
          entity_id: row.entityId,
          entity_name: row.entityName || config.entityType,
          parent_entity_id: row.parentEntityId || null,
          parent_entity_name: row.parentEntityName || null,
          grandparent_entity_id: row.grandparentEntityId || null,
          grandparent_entity_name: row.grandparentEntityName || null,
          status: row.status || 'UNKNOWN',
          effective_status: row.effectiveStatus || 'UNKNOWN',
          ...metrics,
          metadata_json: JSON.stringify({
            source: config.table
          })
        };
      });
  });
}

function parseMetadataJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function calcRatioDelta(currentValue, previousValue) {
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return (current - previous) / Math.abs(previous);
}

function buildEventRow({
  snapshotDate,
  entityType,
  entityId,
  entityName,
  eventType,
  title,
  detail,
  metadata = null
}) {
  return {
    event_date: snapshotDate,
    entity_type: entityType,
    entity_id: entityId,
    entity_name: entityName,
    event_type: eventType,
    title,
    detail,
    metadata_json: metadata ? JSON.stringify(metadata) : null
  };
}

function getPreviousEntitySnapshotRows(db, { store, snapshotDate }) {
  const previousDate = shiftIsoDate(snapshotDate, -1);
  if (!previousDate) return [];
  return db.prepare(`
    SELECT *
    FROM dashboard_daily_entity_snapshots
    WHERE store = ?
      AND scope_key = ?
      AND snapshot_date = ?
  `).all(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, previousDate);
}

function buildPreviousRowMap(rows = []) {
  return new Map(rows.map((row) => [`${row.entity_type}:${row.entity_id}`, row]));
}

function inferSnapshotEventRows({ snapshotDate, entityRows, previousRows }) {
  const previousMap = buildPreviousRowMap(previousRows);
  const inferredEvents = [];

  for (const row of entityRows) {
    const entityKey = `${row.entity_type}:${row.entity_id}`;
    const previousRow = previousMap.get(entityKey) || null;
    const currentSpend = toNumber(row.spend);
    const previousSpend = toNumber(previousRow?.spend);
    const spendShiftRatio = calcRatioDelta(currentSpend, previousSpend);

    if (
      !previousRow
      && currentSpend >= DASHBOARD_DAILY_BRIEF_SNAPSHOT_EVENT_THRESHOLDS.minimumSpendForLaunchEvent
    ) {
      inferredEvents.push(buildEventRow({
        snapshotDate,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityName: row.entity_name,
        eventType: 'launch_signal',
        title: `${row.entity_name} surfaced in the mix`,
        detail: `${row.entity_type} recorded ${roundValue(currentSpend, 2)} in spend on its first tracked snapshot day.`,
        metadata: {
          spend: roundValue(currentSpend, 2)
        }
      }));
      continue;
    }

    if (!previousRow) {
      continue;
    }

    if ((previousRow.effective_status || previousRow.status) !== (row.effective_status || row.status)) {
      inferredEvents.push(buildEventRow({
        snapshotDate,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityName: row.entity_name,
        eventType: 'status_change',
        title: `${row.entity_name} changed status`,
        detail: `${previousRow.effective_status || previousRow.status || 'UNKNOWN'} to ${row.effective_status || row.status || 'UNKNOWN'}.`,
        metadata: {
          fromStatus: previousRow.effective_status || previousRow.status || 'UNKNOWN',
          toStatus: row.effective_status || row.status || 'UNKNOWN'
        }
      }));
    }

    if (
      Number.isFinite(spendShiftRatio)
      && Math.abs(spendShiftRatio) >= DASHBOARD_DAILY_BRIEF_SNAPSHOT_EVENT_THRESHOLDS.meaningfulSpendChangeRatio
      && Math.max(currentSpend, previousSpend) >= DASHBOARD_DAILY_BRIEF_SNAPSHOT_EVENT_THRESHOLDS.minimumSpendForShiftEvent
    ) {
      inferredEvents.push(buildEventRow({
        snapshotDate,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityName: row.entity_name,
        eventType: 'spend_shift',
        title: `${row.entity_name} spend shifted`,
        detail: `${spendShiftRatio < 0 ? 'Down' : 'Up'} ${roundValue(Math.abs(spendShiftRatio) * 100, 1)}% versus the prior day.`,
        metadata: {
          spendShiftPercent: roundValue(spendShiftRatio * 100, 1),
          previousSpend: roundValue(previousSpend, 2),
          currentSpend: roundValue(currentSpend, 2)
        }
      }));
    }
  }

  return inferredEvents.slice(0, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentChangeRows);
}

const UPSERT_ACCOUNT_SNAPSHOT_SQL = `
  INSERT INTO dashboard_daily_account_snapshots (
    store, scope_key, snapshot_date,
    spend, impressions, clicks, landing_page_views, add_to_cart, checkouts_initiated,
    meta_purchases, shopify_orders, revenue,
    ctr, lpv_click, atc_lpv, ic_atc, purchase_ic, roas,
    aov, cac, metadata_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(store, scope_key, snapshot_date)
  DO UPDATE SET
    spend = excluded.spend,
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    landing_page_views = excluded.landing_page_views,
    add_to_cart = excluded.add_to_cart,
    checkouts_initiated = excluded.checkouts_initiated,
    meta_purchases = excluded.meta_purchases,
    shopify_orders = excluded.shopify_orders,
    revenue = excluded.revenue,
    ctr = excluded.ctr,
    lpv_click = excluded.lpv_click,
    atc_lpv = excluded.atc_lpv,
    ic_atc = excluded.ic_atc,
    purchase_ic = excluded.purchase_ic,
    roas = excluded.roas,
    aov = excluded.aov,
    cac = excluded.cac,
    metadata_json = excluded.metadata_json,
    updated_at = CURRENT_TIMESTAMP
`;

const UPSERT_ENTITY_SNAPSHOT_SQL = `
  INSERT INTO dashboard_daily_entity_snapshots (
    store, scope_key, snapshot_date,
    ${ENTITY_FIELDS.join(', ')},
    updated_at
  ) VALUES (
    ?, ?, ?,
    ${ENTITY_FIELDS.map(() => '?').join(', ')},
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(store, scope_key, snapshot_date, entity_type, entity_id)
  DO UPDATE SET
    entity_name = excluded.entity_name,
    parent_entity_id = excluded.parent_entity_id,
    parent_entity_name = excluded.parent_entity_name,
    grandparent_entity_id = excluded.grandparent_entity_id,
    grandparent_entity_name = excluded.grandparent_entity_name,
    status = excluded.status,
    effective_status = excluded.effective_status,
    spend = excluded.spend,
    impressions = excluded.impressions,
    reach = excluded.reach,
    clicks = excluded.clicks,
    landing_page_views = excluded.landing_page_views,
    add_to_cart = excluded.add_to_cart,
    checkouts_initiated = excluded.checkouts_initiated,
    meta_purchases = excluded.meta_purchases,
    shopify_orders = excluded.shopify_orders,
    revenue = excluded.revenue,
    ctr = excluded.ctr,
    lpv_click = excluded.lpv_click,
    atc_lpv = excluded.atc_lpv,
    ic_atc = excluded.ic_atc,
    purchase_ic = excluded.purchase_ic,
    roas = excluded.roas,
    aov = excluded.aov,
    cac = excluded.cac,
    cpm = excluded.cpm,
    cpc = excluded.cpc,
    frequency = excluded.frequency,
    metadata_json = excluded.metadata_json,
    updated_at = CURRENT_TIMESTAMP
`;

function persistSnapshotDay(db, { store, snapshotDate, accountRow, entityRows, eventRows = [] }) {
  const upsertAccount = db.prepare(UPSERT_ACCOUNT_SNAPSHOT_SQL);
  const upsertEntity = db.prepare(UPSERT_ENTITY_SNAPSHOT_SQL);
  const deleteEntityRows = db.prepare(`
    DELETE FROM dashboard_daily_entity_snapshots
    WHERE store = ?
      AND scope_key = ?
      AND snapshot_date = ?
  `);
  const deleteEvents = db.prepare(`DELETE FROM dashboard_daily_events WHERE store = ? AND scope_key = ? AND event_date = ?`);
  const insertEvent = db.prepare(`
    INSERT INTO dashboard_daily_events (
      store, scope_key, event_date, entity_type, entity_id, entity_name, event_type, title, detail, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    upsertAccount.run(
      store,
      DASHBOARD_DAILY_BRIEF_SCOPE_KEY,
      snapshotDate,
      accountRow.spend,
      accountRow.impressions,
      accountRow.clicks,
      accountRow.landing_page_views,
      accountRow.add_to_cart,
      accountRow.checkouts_initiated,
      accountRow.meta_purchases,
      accountRow.shopify_orders,
      accountRow.revenue,
      accountRow.ctr,
      accountRow.lpv_click,
      accountRow.atc_lpv,
      accountRow.ic_atc,
      accountRow.purchase_ic,
      accountRow.roas,
      accountRow.aov,
      accountRow.cac,
      accountRow.metadata_json
    );

    deleteEntityRows.run(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, snapshotDate);
    for (const row of entityRows) {
      upsertEntity.run(
        store,
        DASHBOARD_DAILY_BRIEF_SCOPE_KEY,
        snapshotDate,
        ...ENTITY_FIELDS.map((field) => row[field] ?? null)
      );
    }

    deleteEvents.run(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, snapshotDate);
    for (const eventRow of eventRows) {
      insertEvent.run(
        store,
        DASHBOARD_DAILY_BRIEF_SCOPE_KEY,
        snapshotDate,
        eventRow.entity_type,
        eventRow.entity_id || null,
        eventRow.entity_name || null,
        eventRow.event_type,
        eventRow.title,
        eventRow.detail || null,
        eventRow.metadata_json || null
      );
    }
  });

  transaction();
}

function getExistingSnapshotDates(db, { store, startDate, endDate }) {
  const rows = db.prepare(`
    SELECT snapshot_date
    FROM dashboard_daily_account_snapshots
    WHERE store = ?
      AND scope_key = ?
      AND snapshot_date BETWEEN ? AND ?
  `).all(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, startDate, endDate);
  return new Set(rows.map((row) => row.snapshot_date));
}

export async function materializeDashboardDailyBriefSnapshotDay({ store, snapshotDate }) {
  const db = getDb();
  const dashboard = await getDashboard(store, buildDashboardParams(snapshotDate, snapshotDate));
  const accountRow = buildAccountSnapshotRow(snapshotDate, dashboard);
  const entityRows = [
    ...buildCampaignSnapshotRows(dashboard),
    ...buildGeoSnapshotRows(dashboard),
    ...buildMetaHierarchySnapshotRows(db, { store, snapshotDate })
  ];
  const previousRows = getPreviousEntitySnapshotRows(db, { store, snapshotDate });
  const eventRows = inferSnapshotEventRows({
    snapshotDate,
    entityRows,
    previousRows
  });

  persistSnapshotDay(db, {
    store,
    snapshotDate,
    accountRow,
    entityRows,
    eventRows
  });
}

export async function ensureDashboardDailyBriefSnapshotRange({ store, startDate, endDate }) {
  const db = getDb();
  const existingDates = getExistingSnapshotDates(db, { store, startDate, endDate });
  const missingDates = listDateRange(startDate, endDate).filter((date) => !existingDates.has(date));

  for (const snapshotDate of missingDates) {
    await materializeDashboardDailyBriefSnapshotDay({ store, snapshotDate });
  }
}

function mapAccountSnapshotRow(row = {}) {
  return {
    date: row.snapshot_date || null,
    spend: roundValue(toNumber(row.spend), 2),
    impressions: Math.round(toNumber(row.impressions)),
    clicks: Math.round(toNumber(row.clicks)),
    landingPageViews: Math.round(toNumber(row.landing_page_views)),
    addToCart: Math.round(toNumber(row.add_to_cart)),
    checkoutsInitiated: Math.round(toNumber(row.checkouts_initiated)),
    conversions: Math.round(toNumber(row.meta_purchases)),
    orders: Math.round(toNumber(row.shopify_orders)),
    revenue: roundValue(toNumber(row.revenue), 2),
    ctr: roundValue(toNumber(row.ctr), 4)
  };
}

export function readDashboardDailyBriefAccountRows({ store, startDate, endDate }) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT *
    FROM dashboard_daily_account_snapshots
    WHERE store = ?
      AND scope_key = ?
      AND snapshot_date BETWEEN ? AND ?
    ORDER BY snapshot_date ASC
  `).all(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, startDate, endDate);

  return rows.map(mapAccountSnapshotRow);
}

function buildEntityTypePlaceholders(entityTypes) {
  return entityTypes.map(() => '?').join(', ');
}

function aggregateBaselineRows(rows = []) {
  const aggregateMap = new Map();

  for (const row of rows) {
    const key = `${row.entity_type}:${row.entity_id}`;
    const existing = aggregateMap.get(key) || {
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      entity_name: row.entity_name,
      parent_entity_id: row.parent_entity_id,
      parent_entity_name: row.parent_entity_name,
      grandparent_entity_id: row.grandparent_entity_id,
      grandparent_entity_name: row.grandparent_entity_name,
      status: row.status,
      effective_status: row.effective_status,
      metadata_json: row.metadata_json,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      landing_page_views: 0,
      add_to_cart: 0,
      checkouts_initiated: 0,
      meta_purchases: 0,
      shopify_orders: 0,
      revenue: 0
    };

    for (const field of METRIC_SUM_FIELDS) {
      existing[field] += toNumber(row[field]);
    }

    aggregateMap.set(key, existing);
  }

  for (const [key, row] of aggregateMap.entries()) {
    aggregateMap.set(key, {
      ...row,
      ...buildStoredMetricColumns(row)
    });
  }

  return aggregateMap;
}

function toSnapshotMetricSummary(row = {}) {
  return {
    spend: roundValue(toNumber(row.spend), 2),
    impressions: Math.round(toNumber(row.impressions)),
    clicks: Math.round(toNumber(row.clicks)),
    landingPageViews: Math.round(toNumber(row.landing_page_views)),
    addToCart: Math.round(toNumber(row.add_to_cart)),
    checkoutsInitiated: Math.round(toNumber(row.checkouts_initiated)),
    purchases: Math.round(toNumber(row.meta_purchases || row.shopify_orders)),
    revenue: roundValue(toNumber(row.revenue), 2),
    ctr: roundValue(toNumber(row.ctr), 4),
    lpvClick: roundValue(toNumber(row.lpv_click), 4),
    atcLpv: roundValue(toNumber(row.atc_lpv), 4),
    icAtc: roundValue(toNumber(row.ic_atc), 4),
    purchaseIc: roundValue(toNumber(row.purchase_ic), 4),
    roas: roundValue(toNumber(row.roas), 4)
  };
}

function mapCurrentEntityRow(row, baselineMap) {
  const key = `${row.entity_type}:${row.entity_id}`;
  const baseline = baselineMap.get(key);
  const level = row.entity_type;
  return {
    id: row.entity_id,
    level,
    name: row.entity_name,
    campaignName: level === ENTITY_TYPES.ad ? row.grandparent_entity_name : row.parent_entity_name,
    adsetName: level === ENTITY_TYPES.ad ? row.parent_entity_name : null,
    firstSeen: null,
    lastSeen: null,
    metrics: {
      now: toSnapshotMetricSummary(row),
      baseline: toSnapshotMetricSummary(baseline || {})
    }
  };
}

export function readDashboardDailyBriefHierarchyRows({ store, briefDate, baselineStartDate, baselineEndDate }) {
  const db = getDb();
  const hierarchyTypes = [ENTITY_TYPES.campaign, ENTITY_TYPES.adset, ENTITY_TYPES.ad];
  const placeholders = buildEntityTypePlaceholders(hierarchyTypes);
  const currentRows = db.prepare(`
    SELECT *
    FROM dashboard_daily_entity_snapshots
    WHERE store = ?
      AND scope_key = ?
      AND snapshot_date = ?
      AND entity_type IN (${placeholders})
    ORDER BY spend DESC
  `).all(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, briefDate, ...hierarchyTypes);
  const baselineRows = db.prepare(`
    SELECT *
    FROM dashboard_daily_entity_snapshots
    WHERE store = ?
      AND scope_key = ?
      AND snapshot_date BETWEEN ? AND ?
      AND entity_type IN (${placeholders})
  `).all(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, baselineStartDate, baselineEndDate, ...hierarchyTypes);
  const baselineMap = aggregateBaselineRows(baselineRows);
  return currentRows.map((row) => mapCurrentEntityRow(row, baselineMap));
}

export function readDashboardDailyBriefGeoRows({ store, briefDate, baselineStartDate, baselineEndDate }) {
  const db = getDb();
  const currentRows = db.prepare(`
    SELECT *
    FROM dashboard_daily_entity_snapshots
    WHERE store = ?
      AND scope_key = ?
      AND snapshot_date = ?
      AND entity_type = ?
    ORDER BY shopify_orders DESC, spend DESC
  `).all(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, briefDate, ENTITY_TYPES.geo);
  const baselineRows = db.prepare(`
    SELECT *
    FROM dashboard_daily_entity_snapshots
    WHERE store = ?
      AND scope_key = ?
      AND snapshot_date BETWEEN ? AND ?
      AND entity_type = ?
  `).all(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, baselineStartDate, baselineEndDate, ENTITY_TYPES.geo);
  const baselineMap = aggregateBaselineRows(baselineRows);

  return currentRows.map((row) => {
    const baseline = baselineMap.get(`${ENTITY_TYPES.geo}:${row.entity_id}`);
    return {
      code: row.entity_id,
      spend: roundValue(toNumber(row.spend), 2),
      conversions: Math.round(toNumber(row.meta_purchases)),
      ctr: roundValue(toNumber(row.ctr), 4),
      lpvClick: roundValue(toNumber(row.lpv_click), 4),
      atcLpv: roundValue(toNumber(row.atc_lpv), 4),
      icAtc: roundValue(toNumber(row.ic_atc), 4),
      purchaseIc: roundValue(toNumber(row.purchase_ic), 4),
      roas: roundValue(toNumber(row.roas), 4),
      baseline: {
        ctr: roundValue(toNumber(baseline?.ctr), 4),
        lpvClick: roundValue(toNumber(baseline?.lpv_click), 4),
        atcLpv: roundValue(toNumber(baseline?.atc_lpv), 4),
        icAtc: roundValue(toNumber(baseline?.ic_atc), 4),
        purchaseIc: roundValue(toNumber(baseline?.purchase_ic), 4),
        roas: roundValue(toNumber(baseline?.roas), 4)
      },
      metaPurchases: Math.round(toNumber(row.meta_purchases)),
      shopifyOrders: Math.round(toNumber(row.shopify_orders))
    };
  });
}

export function readDashboardDailyBriefRecentEvents({ store, endDate }) {
  const db = getDb();
  const startDate = shiftIsoDate(endDate, -(DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentChangeRows - 1));
  return db.prepare(`
    SELECT event_date AS date, entity_type AS entityType, entity_id AS entityId, entity_name AS entityName, event_type AS eventType, title, detail, metadata_json AS metadataJson
    FROM dashboard_daily_events
    WHERE store = ?
      AND scope_key = ?
      AND event_date BETWEEN ? AND ?
    ORDER BY event_date DESC, id DESC
    LIMIT ?
  `).all(store, DASHBOARD_DAILY_BRIEF_SCOPE_KEY, startDate, endDate, DASHBOARD_DAILY_BRIEF_PACKET_LIMITS.recentChangeRows)
    .map((row) => ({
      ...row,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null
    }));
}
