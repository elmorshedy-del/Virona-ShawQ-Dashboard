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

function getHierarchy(db, store, includeInactive = false) {
  // Build status filter - only show ACTIVE by default
  const statusFilter = includeInactive
    ? ''
    : `AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)`;

  const objects = db
    .prepare(
      `SELECT object_type, object_id, object_name, parent_id, parent_name,
              grandparent_id, grandparent_name, status, effective_status,
              daily_budget, lifetime_budget, objective, optimization_goal,
              bid_strategy, created_time, start_time, stop_time, last_synced_at
       FROM meta_objects
       WHERE store = ? ${statusFilter}
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

function getMetrics(db, store, startDate, endDate, includeInactive = false) {
  if (!startDate || !endDate) {
    return { campaignDaily: [], adsetDaily: [], adDaily: [] };
  }

  // Build status filters - only show ACTIVE by default
  const campaignStatusFilter = includeInactive
    ? ''
    : `AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)`;

  const adsetStatusFilter = includeInactive
    ? ''
    : `AND (adset_effective_status = 'ACTIVE' OR adset_effective_status = 'UNKNOWN' OR adset_effective_status IS NULL)`;

  const adStatusFilter = includeInactive
    ? ''
    : `AND (ad_effective_status = 'ACTIVE' OR ad_effective_status = 'UNKNOWN' OR ad_effective_status IS NULL)`;

  const campaignDaily = db
    .prepare(
      `SELECT date, campaign_id, campaign_name, country, age, gender,
              publisher_platform, platform_position, spend, impressions,
              reach, clicks, landing_page_views, add_to_cart,
              checkouts_initiated, conversions, conversion_value,
              status, effective_status
       FROM meta_daily_metrics
       WHERE store = ? AND date BETWEEN ? AND ? ${campaignStatusFilter}
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
       WHERE store = ? AND date BETWEEN ? AND ? ${adsetStatusFilter}
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
       WHERE store = ? AND date BETWEEN ? AND ? ${adStatusFilter}
       ORDER BY date DESC`
    )
    .all(store, startDate, endDate);

  return { campaignDaily, adsetDaily, adDaily };
}

export function getAiBudgetMetaDataset(store, { startDate, endDate, includeInactive = false } = {}) {
  console.log('=== METADATASET DEBUG START ===');
  console.log('Querying for store:', store, '| includeInactive:', includeInactive);

  const db = getDb();
  const coverage = getDateCoverage(db, store);
  console.log('Date coverage:', JSON.stringify(coverage));

  const effectiveStart = startDate || coverage.availableStart;
  const effectiveEnd = endDate || coverage.availableEnd;
  console.log('Effective date range:', effectiveStart, 'to', effectiveEnd);

  const hierarchy = getHierarchy(db, store, includeInactive);
  console.log('Hierarchy - Campaigns:', hierarchy.campaigns?.length || 0);
  console.log('Hierarchy - Adsets:', hierarchy.adsets?.length || 0);
  console.log('Hierarchy - Ads:', hierarchy.ads?.length || 0);

  const metrics = getMetrics(db, store, effectiveStart, effectiveEnd, includeInactive);
  console.log('Metrics - CampaignDaily:', metrics.campaignDaily?.length || 0);
  console.log('Metrics - AdsetDaily:', metrics.adsetDaily?.length || 0);
  console.log('Metrics - AdDaily:', metrics.adDaily?.length || 0);

  if (metrics.campaignDaily?.length > 0) {
    console.log('Sample metric row:', JSON.stringify(metrics.campaignDaily[0]));
  }
  console.log('=== METADATASET DEBUG END ===');

  return {
    success: true,
    store,
    includeInactive,
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
