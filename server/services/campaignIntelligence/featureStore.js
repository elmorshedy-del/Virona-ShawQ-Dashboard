import { getDb } from '../../db/database.js';

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLevel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'campaign';
}

function normalizeEntityId(value) {
  const normalized = String(value || '').trim();
  return normalized || 'all';
}

function normalizeCountry(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || 'ALL';
}

export function upsertFeatureStoreRows({
  store,
  level,
  entityId,
  country,
  rows = [],
  generatedAt = new Date().toISOString()
}) {
  if (!store) return;
  if (!Array.isArray(rows) || rows.length === 0) return;

  const db = getDb();
  const normalizedLevel = normalizeLevel(level);
  const normalizedEntityId = normalizeEntityId(entityId);
  const normalizedCountry = normalizeCountry(country);

  const statement = db.prepare(`
    INSERT INTO campaign_intelligence_feature_store (
      store,
      level,
      entity_id,
      country,
      date,
      spend,
      impressions,
      reach,
      clicks,
      landing_page_views,
      add_to_cart,
      checkouts_initiated,
      conversions,
      orders,
      revenue,
      ctr,
      cvr,
      cpm,
      lpv_rate,
      orders_per_spend,
      roas,
      shock_max_z,
      generated_at,
      updated_at
    ) VALUES (
      @store,
      @level,
      @entity_id,
      @country,
      @date,
      @spend,
      @impressions,
      @reach,
      @clicks,
      @landing_page_views,
      @add_to_cart,
      @checkouts_initiated,
      @conversions,
      @orders,
      @revenue,
      @ctr,
      @cvr,
      @cpm,
      @lpv_rate,
      @orders_per_spend,
      @roas,
      @shock_max_z,
      @generated_at,
      @updated_at
    )
    ON CONFLICT(store, level, entity_id, country, date)
    DO UPDATE SET
      spend = excluded.spend,
      impressions = excluded.impressions,
      reach = excluded.reach,
      clicks = excluded.clicks,
      landing_page_views = excluded.landing_page_views,
      add_to_cart = excluded.add_to_cart,
      checkouts_initiated = excluded.checkouts_initiated,
      conversions = excluded.conversions,
      orders = excluded.orders,
      revenue = excluded.revenue,
      ctr = excluded.ctr,
      cvr = excluded.cvr,
      cpm = excluded.cpm,
      lpv_rate = excluded.lpv_rate,
      orders_per_spend = excluded.orders_per_spend,
      roas = excluded.roas,
      shock_max_z = excluded.shock_max_z,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at
  `);

  const transaction = db.transaction((inputRows) => {
    for (const row of inputRows) {
      statement.run({
        store,
        level: normalizedLevel,
        entity_id: normalizedEntityId,
        country: normalizedCountry,
        date: String(row?.date || '').trim(),
        spend: toFiniteNumber(row?.spend, 0),
        impressions: Math.round(toFiniteNumber(row?.impressions, 0)),
        reach: Math.round(toFiniteNumber(row?.reach, 0)),
        clicks: Math.round(toFiniteNumber(row?.clicks, 0)),
        landing_page_views: Math.round(toFiniteNumber(row?.landingPageViews, 0)),
        add_to_cart: Math.round(toFiniteNumber(row?.addToCart, 0)),
        checkouts_initiated: Math.round(toFiniteNumber(row?.checkoutsInitiated, 0)),
        conversions: Math.round(toFiniteNumber(row?.conversions, 0)),
        orders: Math.round(toFiniteNumber(row?.orders, 0)),
        revenue: toFiniteNumber(row?.revenue, 0),
        ctr: toFiniteNumber(row?.ctr, 0),
        cvr: toFiniteNumber(row?.cvr, 0),
        cpm: toFiniteNumber(row?.cpm, 0),
        lpv_rate: toFiniteNumber(row?.lpvRate, 0),
        orders_per_spend: toFiniteNumber(row?.ordersPerSpend, 0),
        roas: toFiniteNumber(row?.roas, 0),
        shock_max_z: toFiniteNumber(row?.shocks?.maxZ, 0),
        generated_at: generatedAt,
        updated_at: generatedAt
      });
    }
  });

  transaction(rows.filter((row) => String(row?.date || '').trim()));
}
