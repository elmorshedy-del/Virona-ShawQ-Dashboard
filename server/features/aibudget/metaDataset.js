import { getDb } from '../../db/database.js';

function getDateCoverage(db, store) {
  const sources = [
    db.prepare(
      `SELECT MIN(date) as earliest_date, MAX(date) as latest_date
       FROM meta_daily_metrics
       WHERE store = ?`
    ).get(store),
    db.prepare(
      `SELECT MIN(date) as earliest_date, MAX(date) as latest_date
       FROM meta_adset_metrics
       WHERE store = ?`
    ).get(store),
    db.prepare(
      `SELECT MIN(date) as earliest_date, MAX(date) as latest_date
       FROM meta_ad_metrics
       WHERE store = ?`
    ).get(store)
  ];

  const allEarliest = sources.map(s => s?.earliest_date).filter(Boolean);
  const allLatest = sources.map(s => s?.latest_date).filter(Boolean);

  return {
    availableStart: allEarliest.length ? allEarliest.sort()[0] : null,
    availableEnd: allLatest.length ? allLatest.sort().slice(-1)[0] : null
  };
}

function getHierarchy(db, store) {
  const objects = db
    .prepare(
      `SELECT object_type, object_id, object_name, parent_id, parent_name,
              grandparent_id, grandparent_name, status, effective_status,
              daily_budget, lifetime_budget, objective, optimization_goal,
              bid_strategy, created_time, start_time, stop_time, last_synced_at
       FROM meta_objects
       WHERE store = ?
       ORDER BY object_type, object_name`
    )
    .all(store);

  return {
    objects,
    campaigns: objects.filter(o => o.object_type === 'campaign'),
    adsets: objects.filter(o => o.object_type === 'adset'),
    ads: objects.filter(o => o.object_type === 'ad')
  };
}

function getMetrics(db, store, startDate, endDate) {
  if (!startDate || !endDate) {
    return { campaignDaily: [], adsetDaily: [], adDaily: [] };
  }

  const campaignDaily = db
    .prepare(
      `SELECT date, campaign_id, campaign_name, country, age, gender,
              publisher_platform, platform_position, spend, impressions,
              reach, clicks, landing_page_views, add_to_cart,
              checkouts_initiated, conversions, conversion_value,
              status, effective_status
       FROM meta_daily_metrics
       WHERE store = ? AND date BETWEEN ? AND ?
       ORDER BY date DESC`
    )
    .all(store, startDate, endDate);

  const adsetDaily = db
    .prepare(
      `SELECT date, campaign_id, campaign_name, adset_id, adset_name,
              country, age, gender, publisher_platform, platform_position,
              spend, impressions, reach, clicks, landing_page_views,
              add_to_cart, checkouts_initiated, conversions,
              conversion_value, status, effective_status,
              adset_status, adset_effective_status
       FROM meta_adset_metrics
       WHERE store = ? AND date BETWEEN ? AND ?
       ORDER BY date DESC`
    )
    .all(store, startDate, endDate);

  const adDaily = db
    .prepare(
      `SELECT date, campaign_id, campaign_name, adset_id, adset_name,
              ad_id, ad_name, country, age, gender, publisher_platform,
              platform_position, spend, impressions, reach, clicks,
              landing_page_views, add_to_cart, checkouts_initiated,
              conversions, conversion_value, status, effective_status,
              ad_status, ad_effective_status
       FROM meta_ad_metrics
       WHERE store = ? AND date BETWEEN ? AND ?
       ORDER BY date DESC`
    )
    .all(store, startDate, endDate);

  return { campaignDaily, adsetDaily, adDaily };
}

export function getAiBudgetMetaDataset(store, { startDate, endDate } = {}) {
  const db = getDb();
  const coverage = getDateCoverage(db, store);

  const effectiveStart = startDate || coverage.availableStart;
  const effectiveEnd = endDate || coverage.availableEnd;

  const hierarchy = getHierarchy(db, store);
  const metrics = getMetrics(db, store, effectiveStart, effectiveEnd);

  return {
    success: true,
    store,
    dateRange: {
      requestedStart: startDate || null,
      requestedEnd: endDate || null,
      effectiveStart,
      effectiveEnd,
      availableStart: coverage.availableStart,
      availableEnd: coverage.availableEnd
    },
    hierarchy,
    metrics
  };
}
