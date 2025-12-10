// ============================================================================
// whatifMetaService.js - BACKEND SERVICE
// Place in: server/services/whatifMetaService.js
// Purpose: Fetch Meta Ads data for What-If Simulator with ALL required fields
// ============================================================================

import { getDb } from '../db/database.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const META_API_VERSION = 'v18.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Fields to request from Meta API
const INSIGHTS_FIELDS = [
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'spend',
  'impressions',
  'clicks',
  'reach',
  'frequency',
  'actions',
  'action_values'
].join(',');

// Action types mapping
const ACTION_TYPES = {
  purchase: ['purchase', 'omni_purchase'],
  atc: ['add_to_cart', 'omni_add_to_cart'],
  ic: ['initiate_checkout', 'omni_initiate_checkout']
};

// Store configurations
const STORE_CONFIG = {
  vironax: {
    accessTokenEnv: 'META_ACCESS_TOKEN',
    adAccountEnv: 'META_AD_ACCOUNT_ID',
    lookbackDays: 730,  // 24 months for KSA priors
    currency: 'SAR'
  },
  shawq: {
    accessTokenEnv: 'SHAWQ_META_ACCESS_TOKEN',
    adAccountEnv: 'SHAWQ_META_AD_ACCOUNT_ID',
    lookbackDays: 90,   // 90 days for other geos
    currency: 'USD'
  }
};

// Slice size for API calls (14 days as per blueprint)
const SLICE_DAYS = 14;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Get date range slices (14-day chunks)
 * @param {number} lookbackDays - Total days to look back
 * @returns {Array<{start: string, end: string}>} Array of date ranges
 */
function getDateSlices(lookbackDays) {
  const slices = [];
  const today = new Date();
  let endDate = new Date(today);
  
  let remainingDays = lookbackDays;
  
  while (remainingDays > 0) {
    const sliceDays = Math.min(SLICE_DAYS, remainingDays);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - sliceDays + 1);
    
    slices.push({
      start: formatDate(startDate),
      end: formatDate(endDate)
    });
    
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() - 1);
    remainingDays -= sliceDays;
  }
  
  return slices;
}

/**
 * Extract action value from Meta actions array
 * @param {Array} actions - Meta actions array
 * @param {Array} actionTypes - Action types to look for
 * @returns {number} Action count
 */
function extractActionCount(actions, actionTypes) {
  if (!actions || !Array.isArray(actions)) return 0;
  
  for (const action of actions) {
    if (actionTypes.includes(action.action_type)) {
      return parseInt(action.value, 10) || 0;
    }
  }
  return 0;
}

/**
 * Extract action value (revenue) from Meta action_values array
 * @param {Array} actionValues - Meta action_values array
 * @param {Array} actionTypes - Action types to look for
 * @returns {number} Action value
 */
function extractActionValue(actionValues, actionTypes) {
  if (!actionValues || !Array.isArray(actionValues)) return 0;
  
  for (const action of actionValues) {
    if (actionTypes.includes(action.action_type)) {
      return parseFloat(action.value) || 0;
    }
  }
  return 0;
}

/**
 * Sleep for specified milliseconds (rate limiting)
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// META API FUNCTIONS
// ============================================================================

/**
 * Fetch insights from Meta API for a date range
 * @param {string} store - Store name ('vironax' or 'shawq')
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Array>} Array of insight records
 */
async function fetchInsights(store, startDate, endDate) {
  const config = STORE_CONFIG[store];
  if (!config) {
    throw new Error(`Unknown store: ${store}`);
  }
  
  const accessToken = process.env[config.accessTokenEnv];
  const adAccountId = process.env[config.adAccountEnv];
  
  if (!accessToken || !adAccountId) {
    console.log(`[WhatIf] Missing credentials for ${store}, skipping...`);
    return [];
  }
  
  const url = new URL(`${META_BASE_URL}/act_${adAccountId}/insights`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('fields', INSIGHTS_FIELDS);
  url.searchParams.set('level', 'adset');  // Get adset-level data
  url.searchParams.set('time_range', JSON.stringify({
    since: startDate,
    until: endDate
  }));
  url.searchParams.set('time_increment', '1');  // Daily breakdown
  url.searchParams.set('limit', '500');
  
  const allData = [];
  let nextUrl = url.toString();
  
  while (nextUrl) {
    try {
      const response = await fetch(nextUrl);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[WhatIf] Meta API error for ${store}:`, errorText);
        break;
      }
      
      const json = await response.json();
      
      if (json.data && Array.isArray(json.data)) {
        allData.push(...json.data);
      }
      
      // Handle pagination
      nextUrl = json.paging?.next || null;
      
      // Rate limiting - wait 500ms between paginated requests
      if (nextUrl) {
        await sleep(500);
      }
      
    } catch (error) {
      console.error(`[WhatIf] Fetch error for ${store}:`, error.message);
      break;
    }
  }
  
  return allData;
}

/**
 * Transform Meta API response to database row
 * @param {Object} insight - Meta insight object
 * @param {string} store - Store name
 * @returns {Object} Database row object
 */
function transformInsight(insight, store) {
  return {
    store,
    campaign_id: insight.campaign_id || '',
    campaign_name: insight.campaign_name || '',
    adset_id: insight.adset_id || '',
    adset_name: insight.adset_name || '',
    date: insight.date_start || '',
    spend: parseFloat(insight.spend) || 0,
    impressions: parseInt(insight.impressions, 10) || 0,
    clicks: parseInt(insight.clicks, 10) || 0,
    reach: parseInt(insight.reach, 10) || 0,
    frequency: parseFloat(insight.frequency) || 0,
    purchases: extractActionCount(insight.actions, ACTION_TYPES.purchase),
    revenue: extractActionValue(insight.action_values, ACTION_TYPES.purchase),
    atc: extractActionCount(insight.actions, ACTION_TYPES.atc),
    ic: extractActionCount(insight.actions, ACTION_TYPES.ic)
  };
}

// ============================================================================
// DATABASE FUNCTIONS
// ============================================================================

/**
 * Upsert a row into whatif_timeseries table
 * @param {Object} row - Data row to insert/update
 */
function upsertRow(db, row) {
  const stmt = db.prepare(`
    INSERT INTO whatif_timeseries (
      store, campaign_id, campaign_name, adset_id, adset_name, date,
      spend, purchases, revenue, impressions, clicks, atc, ic, reach, frequency,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store, campaign_id, adset_id, date) DO UPDATE SET
      campaign_name = excluded.campaign_name,
      adset_name = excluded.adset_name,
      spend = excluded.spend,
      purchases = excluded.purchases,
      revenue = excluded.revenue,
      impressions = excluded.impressions,
      clicks = excluded.clicks,
      atc = excluded.atc,
      ic = excluded.ic,
      reach = excluded.reach,
      frequency = excluded.frequency,
      updated_at = datetime('now')
  `);
  
  stmt.run(
    row.store,
    row.campaign_id,
    row.campaign_name,
    row.adset_id,
    row.adset_name,
    row.date,
    row.spend,
    row.purchases,
    row.revenue,
    row.impressions,
    row.clicks,
    row.atc,
    row.ic,
    row.reach,
    row.frequency
  );
}

/**
 * Get sync status for a store
 * @param {string} store - Store name
 * @returns {Object} Sync status info
 */
export function getSyncStatus(store) {
  const db = getDb();
  
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_rows,
        COUNT(DISTINCT campaign_id) as campaigns,
        COUNT(DISTINCT adset_id) as adsets,
        MIN(date) as earliest_date,
        MAX(date) as latest_date,
        MAX(updated_at) as last_sync
      FROM whatif_timeseries
      WHERE store = ?
    `).get(store);
    
    return {
      store,
      ...stats,
      hasData: (stats?.total_rows || 0) > 0
    };
  } catch (error) {
    return {
      store,
      total_rows: 0,
      campaigns: 0,
      adsets: 0,
      earliest_date: null,
      latest_date: null,
      last_sync: null,
      hasData: false,
      error: error.message
    };
  }
}

// ============================================================================
// MAIN SYNC FUNCTION
// ============================================================================

/**
 * Sync What-If data for a store
 * @param {string} store - Store name ('vironax' or 'shawq')
 * @param {Object} options - Sync options
 * @param {number} options.lookbackDays - Override lookback days
 * @param {boolean} options.fullSync - Force full sync (ignore existing data)
 * @returns {Promise<Object>} Sync result
 */
export async function syncWhatIfData(store, options = {}) {
  const config = STORE_CONFIG[store];
  if (!config) {
    return { success: false, error: `Unknown store: ${store}` };
  }
  
  const lookbackDays = options.lookbackDays || config.lookbackDays;
  const db = getDb();
  
  console.log(`[WhatIf] Starting sync for ${store} (${lookbackDays} days lookback)`);
  
  try {
    // Get date slices (14-day chunks)
    const slices = getDateSlices(lookbackDays);
    console.log(`[WhatIf] Will fetch ${slices.length} slices of ${SLICE_DAYS} days each`);
    
    let totalRows = 0;
    let errors = 0;
    
    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      console.log(`[WhatIf] Fetching slice ${i + 1}/${slices.length}: ${slice.start} to ${slice.end}`);
      
      try {
        const insights = await fetchInsights(store, slice.start, slice.end);
        
        if (insights.length > 0) {
          // Transform and upsert each row
          for (const insight of insights) {
            const row = transformInsight(insight, store);
            if (row.date && row.campaign_id) {
              upsertRow(db, row);
              totalRows++;
            }
          }
        }
        
        console.log(`[WhatIf] Slice ${i + 1}: ${insights.length} records`);
        
        // Rate limiting between slices (1 second)
        if (i < slices.length - 1) {
          await sleep(1000);
        }
        
      } catch (sliceError) {
        console.error(`[WhatIf] Error in slice ${i + 1}:`, sliceError.message);
        errors++;
      }
    }
    
    console.log(`[WhatIf] Sync complete for ${store}: ${totalRows} rows, ${errors} errors`);
    
    return {
      success: true,
      store,
      rowsProcessed: totalRows,
      slicesProcessed: slices.length,
      errors,
      lookbackDays
    };
    
  } catch (error) {
    console.error(`[WhatIf] Sync failed for ${store}:`, error.message);
    return {
      success: false,
      store,
      error: error.message
    };
  }
}

/**
 * Smart sync - only fetch recent data if we have historical data
 * @param {string} store - Store name
 * @returns {Promise<Object>} Sync result
 */
export async function smartSync(store) {
  const status = getSyncStatus(store);
  
  if (!status.hasData) {
    // No data - do full sync
    console.log(`[WhatIf] No existing data for ${store}, doing full sync`);
    return await syncWhatIfData(store);
  }
  
  // Have data - just sync last 14 days
  console.log(`[WhatIf] Existing data found for ${store}, doing incremental sync (14 days)`);
  return await syncWhatIfData(store, { lookbackDays: 14 });
}

// ============================================================================
// DATA RETRIEVAL FUNCTIONS
// ============================================================================

/**
 * Get list of campaigns for a store
 * @param {string} store - Store name
 * @returns {Array} List of campaigns with stats
 */
export function getCampaigns(store) {
  const db = getDb();
  
  try {
    return db.prepare(`
      SELECT 
        campaign_id,
        campaign_name,
        COUNT(DISTINCT adset_id) as adset_count,
        COUNT(DISTINCT date) as days_with_data,
        SUM(spend) as total_spend,
        SUM(revenue) as total_revenue,
        SUM(purchases) as total_purchases,
        MIN(date) as first_date,
        MAX(date) as last_date,
        ROUND(SUM(revenue) / NULLIF(SUM(spend), 0), 2) as roas
      FROM whatif_timeseries
      WHERE store = ? AND campaign_id IS NOT NULL AND campaign_id != ''
      GROUP BY campaign_id, campaign_name
      ORDER BY total_spend DESC
    `).all(store);
  } catch (error) {
    console.error(`[WhatIf] getCampaigns error:`, error.message);
    return [];
  }
}

/**
 * Get ad sets for a campaign
 * @param {string} store - Store name
 * @param {string} campaignId - Campaign ID
 * @returns {Array} List of ad sets with stats
 */
export function getAdsets(store, campaignId) {
  const db = getDb();
  
  try {
    return db.prepare(`
      SELECT 
        adset_id,
        adset_name,
        campaign_id,
        campaign_name,
        COUNT(DISTINCT date) as days_with_data,
        SUM(spend) as total_spend,
        SUM(revenue) as total_revenue,
        SUM(purchases) as total_purchases,
        SUM(impressions) as total_impressions,
        SUM(clicks) as total_clicks,
        MIN(date) as first_date,
        MAX(date) as last_date,
        ROUND(SUM(revenue) / NULLIF(SUM(spend), 0), 2) as roas
      FROM whatif_timeseries
      WHERE store = ? AND campaign_id = ? AND adset_id IS NOT NULL AND adset_id != ''
      GROUP BY adset_id, adset_name
      ORDER BY total_spend DESC
    `).all(store, campaignId);
  } catch (error) {
    console.error(`[WhatIf] getAdsets error:`, error.message);
    return [];
  }
}

/**
 * Get timeseries data for modeling
 * @param {string} store - Store name
 * @param {string} campaignId - Campaign ID
 * @param {Object} options - Query options
 * @param {string} options.adsetId - Filter by ad set ID
 * @param {number} options.lookbackDays - Limit days
 * @returns {Array} Timeseries data
 */
export function getTimeseries(store, campaignId, options = {}) {
  const db = getDb();
  
  try {
    let query = `
      SELECT 
        date,
        campaign_id,
        campaign_name,
        adset_id,
        adset_name,
        spend,
        purchases,
        revenue,
        impressions,
        clicks,
        atc,
        ic,
        reach,
        frequency
      FROM whatif_timeseries
      WHERE store = ? AND campaign_id = ?
    `;
    
    const params = [store, campaignId];
    
    if (options.adsetId) {
      query += ` AND adset_id = ?`;
      params.push(options.adsetId);
    }
    
    if (options.lookbackDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.lookbackDays);
      query += ` AND date >= ?`;
      params.push(formatDate(cutoffDate));
    }
    
    query += ` ORDER BY date DESC`;
    
    return db.prepare(query).all(...params);
  } catch (error) {
    console.error(`[WhatIf] getTimeseries error:`, error.message);
    return [];
  }
}

/**
 * Get aggregated data for smart lookback
 * Follows blueprint: Default 14D, shrink to 7D for heavy, expand to 30D if sparse
 * @param {string} store - Store name
 * @param {string} campaignId - Campaign ID
 * @param {string} lookback - 'auto', '7d', '14d', '30d', 'all'
 * @returns {Object} Aggregated data with resolved lookback
 */
export function getSmartLookbackData(store, campaignId, lookback = 'auto') {
  const db = getDb();
  
  try {
    // First, check data availability
    const availability = db.prepare(`
      SELECT 
        COUNT(DISTINCT date) as total_days,
        COUNT(DISTINCT CASE WHEN date >= date('now', '-7 days') THEN date END) as days_7d,
        COUNT(DISTINCT CASE WHEN date >= date('now', '-14 days') THEN date END) as days_14d,
        COUNT(DISTINCT CASE WHEN date >= date('now', '-30 days') THEN date END) as days_30d,
        SUM(spend) as total_spend
      FROM whatif_timeseries
      WHERE store = ? AND campaign_id = ?
    `).get(store, campaignId);
    
    // Resolve lookback window
    let resolvedLookback = lookback;
    let lookbackDays = 14;  // Default
    
    if (lookback === 'auto') {
      // Smart resolution
      if (availability.days_14d >= 10) {
        resolvedLookback = '14d';
        lookbackDays = 14;
      } else if (availability.days_7d >= 5) {
        resolvedLookback = '7d';
        lookbackDays = 7;
      } else if (availability.days_30d >= 14) {
        resolvedLookback = '30d';
        lookbackDays = 30;
      } else {
        resolvedLookback = 'all';
        lookbackDays = 9999;
      }
    } else {
      lookbackDays = lookback === '7d' ? 7 : 
                     lookback === '14d' ? 14 : 
                     lookback === '30d' ? 30 : 9999;
    }
    
    // Get data with resolved lookback
    const data = getTimeseries(store, campaignId, { 
      lookbackDays: lookbackDays < 9999 ? lookbackDays : null 
    });
    
    return {
      resolvedLookback,
      lookbackDays: lookbackDays < 9999 ? lookbackDays : availability.total_days,
      availability,
      data,
      dataPoints: data.length
    };
    
  } catch (error) {
    console.error(`[WhatIf] getSmartLookbackData error:`, error.message);
    return {
      resolvedLookback: 'error',
      lookbackDays: 0,
      availability: null,
      data: [],
      dataPoints: 0,
      error: error.message
    };
  }
}

/**
 * Get data health metrics for UI display
 * @param {string} store - Store name
 * @param {string} campaignId - Campaign ID (optional)
 * @returns {Object} Data health metrics
 */
export function getDataHealth(store, campaignId = null) {
  const db = getDb();
  
  try {
    let query = `
      SELECT 
        COUNT(DISTINCT date) as coverage_days,
        COUNT(DISTINCT CASE WHEN spend > 0 THEN date END) as spend_days,
        SUM(CASE WHEN spend IS NOT NULL THEN 1 ELSE 0 END) > 0 as has_spend,
        SUM(CASE WHEN purchases IS NOT NULL THEN 1 ELSE 0 END) > 0 as has_purchases,
        SUM(CASE WHEN revenue IS NOT NULL THEN 1 ELSE 0 END) > 0 as has_revenue,
        SUM(CASE WHEN impressions IS NOT NULL THEN 1 ELSE 0 END) > 0 as has_impressions,
        SUM(CASE WHEN clicks IS NOT NULL THEN 1 ELSE 0 END) > 0 as has_clicks,
        SUM(CASE WHEN atc IS NOT NULL THEN 1 ELSE 0 END) > 0 as has_atc,
        SUM(CASE WHEN ic IS NOT NULL THEN 1 ELSE 0 END) > 0 as has_ic,
        MIN(date) as earliest_date,
        MAX(date) as latest_date
      FROM whatif_timeseries
      WHERE store = ?
    `;
    
    const params = [store];
    
    if (campaignId) {
      query += ` AND campaign_id = ?`;
      params.push(campaignId);
    }
    
    const health = db.prepare(query).get(...params);
    
    // Calculate core fields score
    const coreFields = ['has_spend', 'has_purchases', 'has_revenue'];
    const coreScore = coreFields.filter(f => health[f]).length;
    
    // Calculate extended fields score
    const extendedFields = ['has_impressions', 'has_clicks', 'has_atc', 'has_ic'];
    const extendedScore = extendedFields.filter(f => health[f]).length;
    
    return {
      ...health,
      coreFieldsComplete: coreScore === coreFields.length,
      coreFieldsScore: `${coreScore}/${coreFields.length}`,
      extendedFieldsScore: `${extendedScore}/${extendedFields.length}`,
      overallHealth: coreScore === 3 && extendedScore >= 2 ? 'Good' :
                     coreScore === 3 ? 'Partial' : 'Poor'
    };
    
  } catch (error) {
    console.error(`[WhatIf] getDataHealth error:`, error.message);
    return {
      coverage_days: 0,
      spend_days: 0,
      coreFieldsComplete: false,
      coreFieldsScore: '0/3',
      extendedFieldsScore: '0/4',
      overallHealth: 'Error',
      error: error.message
    };
  }
}

// ============================================================================
// CSV IMPORT FUNCTIONS
// ============================================================================

/**
 * Import CSV data (override or complement mode)
 * @param {string} store - Store name
 * @param {Array} rows - Parsed CSV rows
 * @param {string} mode - 'override' or 'complement'
 * @param {string} campaignId - Campaign ID for scoped import
 * @returns {Object} Import result
 */
export function importCSV(store, rows, mode = 'complement', campaignId = null) {
  const db = getDb();
  
  try {
    let imported = 0;
    let skipped = 0;
    
    if (mode === 'override' && campaignId) {
      // Delete existing data for this campaign
      db.prepare(`
        DELETE FROM whatif_timeseries 
        WHERE store = ? AND campaign_id = ?
      `).run(store, campaignId);
    }
    
    for (const row of rows) {
      // Validate required fields
      if (!row.date || (!row.campaign_id && !campaignId)) {
        skipped++;
        continue;
      }
      
      const dbRow = {
        store,
        campaign_id: row.campaign_id || campaignId,
        campaign_name: row.campaign_name || '',
        adset_id: row.adset_id || 'csv_imported',
        adset_name: row.adset_name || 'CSV Import',
        date: row.date,
        spend: parseFloat(row.spend) || 0,
        purchases: parseInt(row.purchases, 10) || 0,
        revenue: parseFloat(row.revenue || row.purchase_value) || 0,
        impressions: parseInt(row.impressions, 10) || 0,
        clicks: parseInt(row.clicks, 10) || 0,
        atc: parseInt(row.atc || row.add_to_cart, 10) || 0,
        ic: parseInt(row.ic || row.initiate_checkout, 10) || 0,
        reach: parseInt(row.reach, 10) || 0,
        frequency: parseFloat(row.frequency) || 0
      };
      
      upsertRow(db, dbRow);
      imported++;
    }
    
    return {
      success: true,
      mode,
      imported,
      skipped,
      total: rows.length
    };
    
  } catch (error) {
    console.error(`[WhatIf] CSV import error:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  syncWhatIfData,
  smartSync,
  getSyncStatus,
  getCampaigns,
  getAdsets,
  getTimeseries,
  getSmartLookbackData,
  getDataHealth,
  importCSV,
  STORE_CONFIG
};
