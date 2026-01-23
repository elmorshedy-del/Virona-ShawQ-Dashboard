import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { createOrderNotifications, backfillShopifyCampaignNames } from './notificationService.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';
import { resolveExchangeRateProviders } from './exchangeRateConfig.js';
import {
  fetchApilayerHistoricalTryToUsdRate,
  fetchCurrencyFreaksHistoricalTryToUsdRate,
  fetchCurrencyFreaksLatestTryToUsdRate,
  fetchFrankfurterTryToUsdRate,
  fetchOXRHistoricalTryToUsdRate
} from './exchangeRateProviders.js';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Historical backfill configuration
const BACKFILL_CHUNK_DAYS = 30; // Fetch in 30-day chunks
const MAX_HISTORICAL_DAYS = 730; // Attempt up to 2 years of history (Meta typically allows 37 months)

// Cache for exchange rate (refresh every hour)
import metaToAIBridge from './metaToAIBridge.js';
let cachedTryToUsd = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const DATE_RATE_CACHE_MS = 10 * 60 * 1000; // 10 minutes
const dateRateCache = new Map();

function getCachedDateRate(dateStr) {
  const cached = dateRateCache.get(dateStr);
  if (!cached) {
    return undefined;
  }
  if (Date.now() - cached.timestamp > DATE_RATE_CACHE_MS) {
    dateRateCache.delete(dateStr);
    return undefined;
  }
  return cached.rate;
}

function setCachedDateRate(dateStr, rate) {
  dateRateCache.set(dateStr, { rate, timestamp: Date.now() });
}



// Helper: Fetch actual TRY->USD exchange rate (daily provider)
async function fetchTryToUsdRate() {
  // Return cached rate if still valid
  if (cachedTryToUsd && (Date.now() - cacheTimestamp) < CACHE_DURATION_MS) {
    return cachedTryToUsd;
  }

  const { dailyProvider } = resolveExchangeRateProviders();
  if (dailyProvider !== 'currencyfreaks') {
    console.warn(`[Exchange] Unsupported daily exchange provider "${dailyProvider}". Falling back to no conversion.`);
    return null;
  }

  const result = await fetchCurrencyFreaksLatestTryToUsdRate();
  if (!result.ok) {
    const statusLabel = result.status ? `HTTP ${result.status}` : 'no response';
    console.warn(`[Exchange] CurrencyFreaks latest failed (${result.code}, ${statusLabel}): ${result.message}`);
    return null;
  }

  cachedTryToUsd = result.tryToUsd;
  cacheTimestamp = Date.now();
  console.log(`[Exchange] Fetched TRY→USD rate from CurrencyFreaks: ${cachedTryToUsd.toFixed(6)}`);
  return cachedTryToUsd;
}

// Helper: Get currency conversion rate
async function getCurrencyRate(store) {
  if (store === 'shawq') {
    // Shawq Meta reports in TRY, convert to USD
    return await fetchTryToUsdRate();
  }
  if (store === 'vironax') return 1.0; // Keep SAR as SAR
  return 1.0;
}

function resolveHistoricalProviders() {
  const { primaryBackfillProvider, secondaryBackfillProvider } = resolveExchangeRateProviders();
  const providers = [];

  if (primaryBackfillProvider) {
    providers.push(primaryBackfillProvider);
  }
  if (secondaryBackfillProvider && secondaryBackfillProvider !== primaryBackfillProvider) {
    providers.push(secondaryBackfillProvider);
  }

  return providers;
}

async function fetchHistoricalTryToUsdRate(dateStr) {
  const providers = resolveHistoricalProviders();

  if (!providers.length) {
    console.warn(`[Exchange] No historical rate provider configured for ${dateStr}`);
    return null;
  }

  for (const provider of providers) {
    let result = null;

    if (provider === 'currencyfreaks') {
      result = await fetchCurrencyFreaksHistoricalTryToUsdRate(dateStr);
    } else if (provider === 'oxr') {
      result = await fetchOXRHistoricalTryToUsdRate(dateStr);
    } else if (provider === 'apilayer') {
      result = await fetchApilayerHistoricalTryToUsdRate(dateStr);
    } else if (provider === 'frankfurter') {
      result = await fetchFrankfurterTryToUsdRate(dateStr);
    } else {
      console.warn(`[Exchange] Unknown historical rate provider "${provider}" for ${dateStr}`);
      continue;
    }

    if (result?.ok) {
      return { rate: result.tryToUsd, source: result.source || provider };
    }

    const statusLabel = result?.status ? `HTTP ${result.status}` : 'no response';
    console.warn(`[Exchange] ${provider} historical failed for ${dateStr} (${result?.code || 'error'}, ${statusLabel}): ${result?.message || 'Unknown error'}`);
  }

  return null;
}

/**
 * Get TRY→USD exchange rate for a specific date.
 * - For today (GMT+3): uses yesterday's finalized rate
 * - For yesterday: uses CurrencyFreaks latest
 * - For earlier dates: uses the configured historical provider(s) (Primary Backfill, then Secondary Backfill)
 * - No hardcoded fallback; missing rates remain null
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Promise<number|null>} - TRY to USD rate
 */
export async function getExchangeRateForDate(dateStr) {
  const db = getDb();
  const today = formatDateAsGmt3(new Date());
  const yesterday = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));

  // For today, use yesterday's rate (today's rate not available until tomorrow)
  let lookupDate = dateStr;
  if (dateStr === today) {
    lookupDate = yesterday;
  }

  const cachedRate = getCachedDateRate(lookupDate);
  if (cachedRate !== undefined) {
    return cachedRate;
  }

  // Check DB cache
  const cached = db.prepare(`
    SELECT rate FROM exchange_rates
    WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
  `).get(lookupDate);

  if (cached) {
    setCachedDateRate(lookupDate, cached.rate);
    return cached.rate;
  }

  // Use CurrencyFreaks for the latest finalized day (yesterday in GMT+3)
  if (lookupDate === yesterday) {
    const latestRate = await fetchTryToUsdRate();
    if (latestRate) {
      db.prepare(`
        INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
        VALUES ('TRY', 'USD', ?, ?, 'currencyfreaks')
      `).run(latestRate, lookupDate);

      setCachedDateRate(lookupDate, latestRate);
      console.log(`[Exchange] Stored ${lookupDate}: TRY→USD = ${latestRate.toFixed(6)} (CurrencyFreaks)`);
      return latestRate;
    }

    console.warn(`[Exchange] CurrencyFreaks rate unavailable for ${lookupDate}`);
    setCachedDateRate(lookupDate, null);
    return null;
  }

  // Fetch from the configured historical provider(s)
  const historical = await fetchHistoricalTryToUsdRate(lookupDate);
  if (historical?.rate) {
    db.prepare(`
      INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
      VALUES ('TRY', 'USD', ?, ?, ?)
    `).run(historical.rate, lookupDate, historical.source);

    setCachedDateRate(lookupDate, historical.rate);
    console.log(`[Exchange] Stored ${lookupDate}: TRY→USD = ${historical.rate.toFixed(6)} (${historical.source})`);
    return historical.rate;
  }

  console.warn(`[Exchange] No exchange rate available for ${lookupDate} (backfill unavailable)`);
  setCachedDateRate(lookupDate, null);
  return null;
}

// Helper: Extract metric from Meta's "actions" list
function getActionValue(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === type);
  return action ? parseFloat(action.value) : 0;
}

function getMetricValue(metric) {
  if (Array.isArray(metric)) {
    return metric.reduce((sum, item) => sum + getMetricValue(item), 0);
  }
  if (metric && typeof metric === 'object' && 'value' in metric) {
    return parseFloat(metric.value) || 0;
  }
  const parsed = parseFloat(metric);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Helper: Format date as YYYY-MM-DD
function formatDate(date) {
  return formatDateAsGmt3(date);
}

// ============================================================================
// FETCH OBJECT METADATA (campaigns, adsets, ads with status info)
// ============================================================================
async function fetchMetaObjects(store, accountId, accessToken) {
  const db = getDb();
  const cleanAccountId = accountId.replace(/^act_/, '');

  console.log(`[Meta] Fetching object metadata for ${store}...`);

  // Fetch campaigns with status
  const campaignFields = 'id,name,status,effective_status,created_time,start_time,stop_time,daily_budget,lifetime_budget,objective';
  const campaignUrl = `${META_BASE_URL}/act_${cleanAccountId}/campaigns?fields=${campaignFields}&limit=500&access_token=${accessToken}`;

  let allCampaigns = [];
  let currentUrl = campaignUrl;

  while (currentUrl) {
    try {
      const response = await fetch(currentUrl);
      const json = await response.json();
      if (json.error) {
        console.warn(`[Meta] Campaign fetch warning: ${json.error.message}`);
        break;
      }
      allCampaigns = [...allCampaigns, ...(json.data || [])];
      currentUrl = json.paging?.next || null;
    } catch (err) {
      console.warn(`[Meta] Campaign fetch error: ${err.message}`);
      break;
    }
  }

  console.log(`[Meta] Found ${allCampaigns.length} campaigns for ${store}`);

  // Prepare upsert for campaigns
  const upsertCampaign = db.prepare(`
    INSERT INTO meta_objects (
      store, object_type, object_id, object_name,
      status, effective_status, created_time, start_time, stop_time,
      daily_budget, lifetime_budget, objective, last_synced_at
    ) VALUES (
      @store, 'campaign', @object_id, @object_name,
      @status, @effective_status, @created_time, @start_time, @stop_time,
      @daily_budget, @lifetime_budget, @objective, datetime('now')
    ) ON CONFLICT(store, object_type, object_id) DO UPDATE SET
      object_name = excluded.object_name,
      status = excluded.status,
      effective_status = excluded.effective_status,
      start_time = excluded.start_time,
      stop_time = excluded.stop_time,
      daily_budget = excluded.daily_budget,
      lifetime_budget = excluded.lifetime_budget,
      objective = excluded.objective,
      last_synced_at = datetime('now')
  `);

  // Build campaign status map for child objects
  const campaignStatusMap = new Map();

  const txCampaigns = db.transaction(() => {
    for (const c of allCampaigns) {
      campaignStatusMap.set(c.id, {
        status: c.status || 'UNKNOWN',
        effective_status: c.effective_status || 'UNKNOWN',
        name: c.name || ''
      });

      upsertCampaign.run({
        store,
        object_id: c.id,
        object_name: c.name || '',
        status: c.status || 'UNKNOWN',
        effective_status: c.effective_status || 'UNKNOWN',
        created_time: c.created_time || null,
        start_time: c.start_time || null,
        stop_time: c.stop_time || null,
        daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null, // Meta returns cents
        lifetime_budget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
        objective: c.objective || null
      });
    }
  });
  txCampaigns();

  // Fetch adsets with status
  const adsetFields = 'id,name,campaign_id,status,effective_status,created_time,start_time,end_time,daily_budget,lifetime_budget,optimization_goal,bid_strategy';
  const adsetUrl = `${META_BASE_URL}/act_${cleanAccountId}/adsets?fields=${adsetFields}&limit=500&access_token=${accessToken}`;

  let allAdsets = [];
  currentUrl = adsetUrl;

  while (currentUrl) {
    try {
      const response = await fetch(currentUrl);
      const json = await response.json();
      if (json.error) {
        console.warn(`[Meta] Adset fetch warning: ${json.error.message}`);
        break;
      }
      allAdsets = [...allAdsets, ...(json.data || [])];
      currentUrl = json.paging?.next || null;
    } catch (err) {
      console.warn(`[Meta] Adset fetch error: ${err.message}`);
      break;
    }
  }

  console.log(`[Meta] Found ${allAdsets.length} ad sets for ${store}`);

  // Prepare upsert for adsets
  const upsertAdset = db.prepare(`
    INSERT INTO meta_objects (
      store, object_type, object_id, object_name, parent_id, parent_name,
      status, effective_status, created_time, start_time, stop_time,
      daily_budget, lifetime_budget, optimization_goal, bid_strategy, last_synced_at
    ) VALUES (
      @store, 'adset', @object_id, @object_name, @parent_id, @parent_name,
      @status, @effective_status, @created_time, @start_time, @stop_time,
      @daily_budget, @lifetime_budget, @optimization_goal, @bid_strategy, datetime('now')
    ) ON CONFLICT(store, object_type, object_id) DO UPDATE SET
      object_name = excluded.object_name,
      parent_id = excluded.parent_id,
      parent_name = excluded.parent_name,
      status = excluded.status,
      effective_status = excluded.effective_status,
      start_time = excluded.start_time,
      stop_time = excluded.stop_time,
      daily_budget = excluded.daily_budget,
      lifetime_budget = excluded.lifetime_budget,
      optimization_goal = excluded.optimization_goal,
      bid_strategy = excluded.bid_strategy,
      last_synced_at = datetime('now')
  `);

  // Build adset status map for ads
  const adsetStatusMap = new Map();

  const txAdsets = db.transaction(() => {
    for (const a of allAdsets) {
      const campaignInfo = campaignStatusMap.get(a.campaign_id) || { status: 'UNKNOWN', effective_status: 'UNKNOWN', name: '' };
      adsetStatusMap.set(a.id, {
        status: a.status || 'UNKNOWN',
        effective_status: a.effective_status || 'UNKNOWN',
        name: a.name || '',
        campaign_id: a.campaign_id,
        campaign_status: campaignInfo.status,
        campaign_effective_status: campaignInfo.effective_status
      });

      upsertAdset.run({
        store,
        object_id: a.id,
        object_name: a.name || '',
        parent_id: a.campaign_id || null,
        parent_name: campaignInfo.name || '',
        status: a.status || 'UNKNOWN',
        effective_status: a.effective_status || 'UNKNOWN',
        created_time: a.created_time || null,
        start_time: a.start_time || null,
        stop_time: a.end_time || null,
        daily_budget: a.daily_budget ? parseFloat(a.daily_budget) / 100 : null,
        lifetime_budget: a.lifetime_budget ? parseFloat(a.lifetime_budget) / 100 : null,
        optimization_goal: a.optimization_goal || null,
        bid_strategy: a.bid_strategy || null
      });
    }
  });
  txAdsets();

  // Fetch ads with status
  const adFields = 'id,name,adset_id,campaign_id,status,effective_status,created_time';
  const adUrl = `${META_BASE_URL}/act_${cleanAccountId}/ads?fields=${adFields}&limit=500&access_token=${accessToken}`;

  let allAds = [];
  currentUrl = adUrl;

  while (currentUrl) {
    try {
      const response = await fetch(currentUrl);
      const json = await response.json();
      if (json.error) {
        console.warn(`[Meta] Ad fetch warning: ${json.error.message}`);
        break;
      }
      allAds = [...allAds, ...(json.data || [])];
      currentUrl = json.paging?.next || null;
    } catch (err) {
      console.warn(`[Meta] Ad fetch error: ${err.message}`);
      break;
    }
  }

  console.log(`[Meta] Found ${allAds.length} ads for ${store}`);

  // Prepare upsert for ads
  const upsertAd = db.prepare(`
    INSERT INTO meta_objects (
      store, object_type, object_id, object_name, parent_id, parent_name, grandparent_id, grandparent_name,
      status, effective_status, created_time, last_synced_at
    ) VALUES (
      @store, 'ad', @object_id, @object_name, @parent_id, @parent_name, @grandparent_id, @grandparent_name,
      @status, @effective_status, @created_time, datetime('now')
    ) ON CONFLICT(store, object_type, object_id) DO UPDATE SET
      object_name = excluded.object_name,
      parent_id = excluded.parent_id,
      parent_name = excluded.parent_name,
      grandparent_id = excluded.grandparent_id,
      grandparent_name = excluded.grandparent_name,
      status = excluded.status,
      effective_status = excluded.effective_status,
      last_synced_at = datetime('now')
  `);

  const txAds = db.transaction(() => {
    for (const ad of allAds) {
      const adsetInfo = adsetStatusMap.get(ad.adset_id) || {
        status: 'UNKNOWN', effective_status: 'UNKNOWN', name: '', campaign_id: ad.campaign_id
      };
      const campaignInfo = campaignStatusMap.get(ad.campaign_id) || {
        status: 'UNKNOWN', effective_status: 'UNKNOWN', name: ''
      };

      upsertAd.run({
        store,
        object_id: ad.id,
        object_name: ad.name || '',
        parent_id: ad.adset_id || null,
        parent_name: adsetInfo.name || '',
        grandparent_id: ad.campaign_id || null,
        grandparent_name: campaignInfo.name || '',
        status: ad.status || 'UNKNOWN',
        effective_status: ad.effective_status || 'UNKNOWN',
        created_time: ad.created_time || null
      });
    }
  });
  txAds();

  return {
    campaigns: allCampaigns.length,
    adsets: allAdsets.length,
    ads: allAds.length,
    campaignStatusMap,
    adsetStatusMap
  };
}

// ============================================================================
// SYNC INSIGHTS WITH STATUS (campaign, adset, or ad level)
// ============================================================================
async function syncMetaLevel(store, level, accountId, accessToken, startDate, endDate, statusMaps = {}) {
  const db = getDb();
  const cleanAccountId = accountId.replace(/^act_/, '');
  const { campaignStatusMap = new Map(), adsetStatusMap = new Map() } = statusMaps;

  // Define fields based on level
  // Include inline_link_clicks and cost_per_inline_link_click for proper Link Clicks and CPC metrics
  const baseFields = 'spend,impressions,clicks,reach,actions,action_values,inline_link_clicks,cost_per_inline_link_click,outbound_clicks,unique_outbound_clicks,outbound_clicks_ctr,unique_outbound_clicks_ctr';
  let fields = baseFields;
  if (level === 'campaign') {
    fields = `campaign_name,campaign_id,${baseFields}`;
  } else if (level === 'adset') {
    fields = `campaign_name,campaign_id,adset_name,adset_id,${baseFields}`;
  } else if (level === 'ad') {
    fields = `campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,${baseFields}`;
  }

  const baseParams = `level=${level}&` +
    `breakdowns=country&` +
    `time_range={'since':'${startDate}','until':'${endDate}'}&` +
    `time_increment=1&` +
    `limit=500&` +
    `access_token=${accessToken}`;

  const buildUrl = (fieldsList) =>
    `${META_BASE_URL}/act_${cleanAccountId}/insights?fields=${fieldsList}&${baseParams}`;

  const fetchAllRows = async (fieldsList) => {
    const url = buildUrl(fieldsList);
    let allRows = [];
    let currentUrl = url;
    let pageCount = 0;

    console.log(`[Meta] Fetching ${level} data with pagination...`);

    while (currentUrl) {
      const response = await fetch(currentUrl);
      const json = await response.json();

      if (json.error) throw new Error(json.error.message);

      const pageData = json.data || [];
      allRows = [...allRows, ...pageData];
      pageCount++;

      console.log(`[Meta] ${level} - Page ${pageCount}: ${pageData.length} rows (total: ${allRows.length})`);

      // Check for next page
      currentUrl = json.paging?.next || null;
    }

    console.log(`[Meta] ${level} - Completed: ${allRows.length} total rows from ${pageCount} pages`);
    return allRows;
  };

  let rows;
  try {
    rows = await fetchAllRows(fields);
  } catch (error) {
    const message = error?.message || '';
    console.warn(`[Meta] ${level} fetch failed with primary fields: ${message}`);
    console.warn(`[Meta] Retrying ${level} fetch (fallback fields).`);

    try {
      rows = await fetchAllRows('spend,impressions,clicks,reach,actions,action_values,inline_link_clicks,cost_per_inline_link_click,outbound_clicks,unique_outbound_clicks,outbound_clicks_ctr,unique_outbound_clicks_ctr');
    } catch (retryError) {
      console.error(`[Meta] ${level} fetch failed after retry: ${retryError?.message || retryError}`);
      return 0;
    }
  }

  // Prepare insert statement based on level
  let insertStmt;
  if (level === 'campaign') {
    insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_daily_metrics (
        store, date, campaign_id, campaign_name, country,
        spend, spend_original, impressions, clicks, reach,
        landing_page_views, add_to_cart, checkouts_initiated,
        conversions, conversion_value, conversion_value_original,
        inline_link_clicks, cost_per_inline_link_click, cost_per_inline_link_click_original,
        outbound_clicks, unique_outbound_clicks, outbound_clicks_ctr, unique_outbound_clicks_ctr,
        original_currency, status, effective_status
      ) VALUES (
        @store, @date, @campaign_id, @campaign_name, @country,
        @spend, @spend_original, @impressions, @clicks, @reach,
        @lpv, @atc, @checkout,
        @conversions, @conversion_value, @conversion_value_original,
        @inline_link_clicks, @cost_per_inline_link_click, @cost_per_inline_link_click_original,
        @outbound_clicks, @unique_outbound_clicks, @outbound_clicks_ctr, @unique_outbound_clicks_ctr,
        @original_currency, @status, @effective_status
      )
    `);
  } else if (level === 'adset') {
    insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_adset_metrics (
        store, date, campaign_id, campaign_name, adset_id, adset_name, country,
        spend, spend_original, impressions, clicks, reach,
        landing_page_views, add_to_cart, checkouts_initiated,
        conversions, conversion_value, conversion_value_original,
        inline_link_clicks, cost_per_inline_link_click, cost_per_inline_link_click_original,
        outbound_clicks, unique_outbound_clicks, outbound_clicks_ctr, unique_outbound_clicks_ctr,
        original_currency, status, effective_status, adset_status, adset_effective_status
      ) VALUES (
        @store, @date, @campaign_id, @campaign_name, @adset_id, @adset_name, @country,
        @spend, @spend_original, @impressions, @clicks, @reach,
        @lpv, @atc, @checkout,
        @conversions, @conversion_value, @conversion_value_original,
        @inline_link_clicks, @cost_per_inline_link_click, @cost_per_inline_link_click_original,
        @outbound_clicks, @unique_outbound_clicks, @outbound_clicks_ctr, @unique_outbound_clicks_ctr,
        @original_currency, @status, @effective_status, @adset_status, @adset_effective_status
      )
    `);
  } else if (level === 'ad') {
    insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_ad_metrics (
        store, date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, country,
        spend, spend_original, impressions, clicks, reach,
        landing_page_views, add_to_cart, checkouts_initiated,
        conversions, conversion_value, conversion_value_original,
        inline_link_clicks, cost_per_inline_link_click, cost_per_inline_link_click_original,
        outbound_clicks, unique_outbound_clicks, outbound_clicks_ctr, unique_outbound_clicks_ctr,
        original_currency, status, effective_status, ad_status, ad_effective_status
      ) VALUES (
        @store, @date, @campaign_id, @campaign_name, @adset_id, @adset_name, @ad_id, @ad_name, @country,
        @spend, @spend_original, @impressions, @clicks, @reach,
        @lpv, @atc, @checkout,
        @conversions, @conversion_value, @conversion_value_original,
        @inline_link_clicks, @cost_per_inline_link_click, @cost_per_inline_link_click_original,
        @outbound_clicks, @unique_outbound_clicks, @outbound_clicks_ctr, @unique_outbound_clicks_ctr,
        @original_currency, @status, @effective_status, @ad_status, @ad_effective_status
      )
    `);
  }

  // Pre-fetch exchange rates for all unique dates (for Shawq only)
  const ratesByDate = new Map();
  if (store === 'shawq') {
    const uniqueDates = [...new Set(rows.map(row => row.date_start))];
    for (const date of uniqueDates) {
      const rate = await getExchangeRateForDate(date);
      if (!Number.isFinite(rate)) {
        console.warn(`[Exchange] Missing rate for ${date}; leaving converted fields null.`);
      }
      ratesByDate.set(date, rate);
    }
  }

  const tx = db.transaction(() => {
    for (const row of rows) {
      // Get date-specific exchange rate for Shawq
      let rate = 1.0;
      let hasRate = true;
      if (store === 'shawq') {
        rate = ratesByDate.get(row.date_start);
        hasRate = Number.isFinite(rate);
      }

      // Parse specific funnel steps
      const purchases = getActionValue(row.actions, 'purchase') || getActionValue(row.actions, 'offsite_conversion.fb_pixel_purchase');
      const revenue = getActionValue(row.action_values, 'purchase') || getActionValue(row.action_values, 'offsite_conversion.fb_pixel_purchase');
      const lpv = getActionValue(row.actions, 'landing_page_view');
      const atc = getActionValue(row.actions, 'add_to_cart');
      const checkout = getActionValue(row.actions, 'initiate_checkout');

      // Get status from status maps
      let campaignStatus = 'UNKNOWN';
      let campaignEffectiveStatus = 'UNKNOWN';
      let adsetStatus = 'UNKNOWN';
      let adsetEffectiveStatus = 'UNKNOWN';

      if (row.campaign_id && campaignStatusMap.has(row.campaign_id)) {
        const cInfo = campaignStatusMap.get(row.campaign_id);
        campaignStatus = cInfo.status || 'UNKNOWN';
        campaignEffectiveStatus = cInfo.effective_status || 'UNKNOWN';
      }

      if (row.adset_id && adsetStatusMap.has(row.adset_id)) {
        const aInfo = adsetStatusMap.get(row.adset_id);
        adsetStatus = aInfo.status || 'UNKNOWN';
        adsetEffectiveStatus = aInfo.effective_status || 'UNKNOWN';
      }

      // Extract inline_link_clicks - Meta returns this as a single value
      const inlineLinkClicks = parseInt(row.inline_link_clicks || 0);
      const costPerInlineLinkClickOriginal = parseFloat(row.cost_per_inline_link_click || 0);
      // cost_per_inline_link_click comes directly from Meta API (already calculated)
      // Apply currency rate to the cost when available
      const costPerInlineLinkClick = hasRate ? costPerInlineLinkClickOriginal * rate : null;
      const outboundClicksField = getMetricValue(row.outbound_clicks);
      const outboundClicksAction =
        getActionValue(row.actions, 'outbound_click') ||
        getActionValue(row.actions, 'outbound_clicks');
      const outboundClicks = Math.round(outboundClicksField > 0 ? outboundClicksField : outboundClicksAction);
      const uniqueOutboundClicksField = getMetricValue(row.unique_outbound_clicks);
      const uniqueOutboundClicksAction =
        getActionValue(row.actions, 'unique_outbound_click') ||
        getActionValue(row.actions, 'unique_outbound_clicks');
      const uniqueOutboundClicks = Math.round(uniqueOutboundClicksField > 0 ? uniqueOutboundClicksField : uniqueOutboundClicksAction);
      const outboundClicksCtr = getMetricValue(row.outbound_clicks_ctr);
      const uniqueOutboundClicksCtr = getMetricValue(row.unique_outbound_clicks_ctr);

      const spendOriginal = parseFloat(row.spend || 0);
      const conversionValueOriginal = parseFloat(revenue || 0);

      const data = {
        store: store,
        date: row.date_start,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        country: row.country || 'ALL',
        spend: hasRate ? spendOriginal * rate : null,
        spend_original: spendOriginal,
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0),
        reach: parseInt(row.reach || 0),
        lpv: parseInt(lpv),
        atc: parseInt(atc),
        checkout: parseInt(checkout),
        conversions: parseInt(purchases),
        conversion_value: hasRate ? conversionValueOriginal * rate : null,
        conversion_value_original: conversionValueOriginal,
        inline_link_clicks: inlineLinkClicks,
        cost_per_inline_link_click: costPerInlineLinkClick,
        cost_per_inline_link_click_original: costPerInlineLinkClickOriginal,
        outbound_clicks: outboundClicks,
        unique_outbound_clicks: uniqueOutboundClicks,
        outbound_clicks_ctr: outboundClicksCtr,
        unique_outbound_clicks_ctr: uniqueOutboundClicksCtr,
        original_currency: store === 'shawq' ? 'TRY' : 'USD',
        status: campaignStatus,
        effective_status: campaignEffectiveStatus
      };

      // Add level-specific fields
      if (level === 'adset' || level === 'ad') {
        data.adset_id = row.adset_id;
        data.adset_name = row.adset_name;
        data.adset_status = adsetStatus;
        data.adset_effective_status = adsetEffectiveStatus;
      }
      if (level === 'ad') {
        data.ad_id = row.ad_id;
        data.ad_name = row.ad_name;
        // For ad level, status/effective_status are the ad's own status
        // We need to look up from meta_objects
        const adObj = db.prepare(`
          SELECT status, effective_status FROM meta_objects
          WHERE store = ? AND object_type = 'ad' AND object_id = ?
        `).get(store, row.ad_id);
        data.ad_status = adObj?.status || 'UNKNOWN';
        data.ad_effective_status = adObj?.effective_status || 'UNKNOWN';
      }

      insertStmt.run(data);
    }
  });

  tx();
  return rows.length;
}

// ============================================================================
// HISTORICAL BACKFILL - Fetch as much history as Meta allows
// ============================================================================
async function performHistoricalBackfill(store, accountId, accessToken, statusMaps) {
  const db = getDb();

  // Get current backfill metadata
  let backfillMeta = db.prepare(`
    SELECT * FROM meta_backfill_metadata WHERE store = ?
  `).get(store);

  if (!backfillMeta) {
    // Initialize backfill metadata
    db.prepare(`
      INSERT INTO meta_backfill_metadata (store, backfill_status) VALUES (?, 'pending')
    `).run(store);
    backfillMeta = { earliest_successful_date: null, latest_successful_date: null };
  }

  // If already completed or in progress, skip
  if (backfillMeta.backfill_status === 'completed') {
    console.log(`[Meta] Historical backfill already completed for ${store}`);
    return { skipped: true, reason: 'Already completed' };
  }

  console.log(`[Meta] Starting historical backfill for ${store}...`);

  // Update status to in_progress
  db.prepare(`
    UPDATE meta_backfill_metadata
    SET backfill_status = 'in_progress', last_backfill_attempt = datetime('now'), updated_at = datetime('now')
    WHERE store = ?
  `).run(store);

  const today = new Date();
  let totalRecords = 0;
  let earliestDate = backfillMeta.earliest_successful_date
    ? new Date(backfillMeta.earliest_successful_date)
    : new Date(today);
  let consecutiveEmptyChunks = 0;

  // Start from 31 days ago (skip the last 30 days since regular sync handles that)
  const startFromDate = new Date(today);
  startFromDate.setDate(startFromDate.getDate() - 31);

  // If we have a previous earliest date, start from just before that
  if (backfillMeta.earliest_successful_date) {
    const prevEarliest = new Date(backfillMeta.earliest_successful_date);
    prevEarliest.setDate(prevEarliest.getDate() - 1);
    startFromDate.setTime(Math.min(startFromDate.getTime(), prevEarliest.getTime()));
  }

  // Go back in BACKFILL_CHUNK_DAYS chunks
  for (let daysBack = 31; daysBack < MAX_HISTORICAL_DAYS; daysBack += BACKFILL_CHUNK_DAYS) {
    const chunkEnd = new Date(today);
    chunkEnd.setDate(chunkEnd.getDate() - daysBack);

    const chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() - BACKFILL_CHUNK_DAYS + 1);

    const startStr = formatDate(chunkStart);
    const endStr = formatDate(chunkEnd);

    console.log(`[Meta] Backfill chunk: ${startStr} to ${endStr}`);

    try {
      // Fetch all three levels for this chunk
      const campaignRows = await syncMetaLevel(store, 'campaign', accountId, accessToken, startStr, endStr, statusMaps);
      const adsetRows = await syncMetaLevel(store, 'adset', accountId, accessToken, startStr, endStr, statusMaps);
      const adRows = await syncMetaLevel(store, 'ad', accountId, accessToken, startStr, endStr, statusMaps);

      const chunkTotal = campaignRows + adsetRows + adRows;
      totalRecords += chunkTotal;

      console.log(`[Meta] Backfill chunk result: ${chunkTotal} records (${campaignRows}C/${adsetRows}AS/${adRows}A)`);

      if (chunkTotal === 0) {
        consecutiveEmptyChunks++;
        // If we get 3 consecutive empty chunks, assume we've reached the end of history
        if (consecutiveEmptyChunks >= 3) {
          console.log(`[Meta] No more historical data found after ${consecutiveEmptyChunks} empty chunks`);
          break;
        }
      } else {
        consecutiveEmptyChunks = 0;
        if (chunkStart < earliestDate) {
          earliestDate = new Date(chunkStart);
        }
      }

      // Update progress
      db.prepare(`
        UPDATE meta_backfill_metadata
        SET earliest_successful_date = ?, updated_at = datetime('now')
        WHERE store = ?
      `).run(formatDate(earliestDate), store);

    } catch (error) {
      console.warn(`[Meta] Backfill chunk error: ${error.message}`);
      // If we get an error (likely API limit reached), mark it and stop
      if (error.message.includes('rate limit') || error.message.includes('too many')) {
        console.log(`[Meta] Rate limit reached, stopping backfill`);
        break;
      }
      // For other errors, continue to next chunk
      consecutiveEmptyChunks++;
      if (consecutiveEmptyChunks >= 3) {
        break;
      }
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Mark backfill as completed
  db.prepare(`
    UPDATE meta_backfill_metadata
    SET backfill_status = 'completed',
        earliest_successful_date = ?,
        latest_successful_date = ?,
        updated_at = datetime('now')
    WHERE store = ?
  `).run(formatDate(earliestDate), formatDate(today), store);

  console.log(`[Meta] Historical backfill completed for ${store}: ${totalRecords} total records, earliest date: ${formatDate(earliestDate)}`);

  return {
    success: true,
    totalRecords,
    earliestDate: formatDate(earliestDate)
  };
}

// ============================================================================
// MAIN SYNC FUNCTION
// ============================================================================
export async function syncMetaData(store, options = {}) {
  const db = getDb();

  // 1. Credentials
  const accountIdEnv = store === 'shawq' ? 'SHAWQ_META_AD_ACCOUNT_ID' : 'META_AD_ACCOUNT_ID';
  const tokenEnv = store === 'shawq' ? 'SHAWQ_META_ACCESS_TOKEN' : 'META_ACCESS_TOKEN';
  const accountId = process.env[accountIdEnv];
  const accessToken = process.env[tokenEnv];

  if (!accountId || !accessToken) {
    console.log(`[Meta] Skipping sync for ${store}: Missing credentials`);
    return { success: false, error: 'Missing credentials' };
  }

  const rangeDays = Number.isFinite(options.rangeDays) ? Math.max(1, options.rangeDays) : 60;
  const endDate = options.endDate || formatDate(new Date());
  const startDate = options.startDate || formatDate(new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000));
  const skipBackfill = options.skipBackfill === true;

  console.log(`[Meta] Syncing ${store} from ${startDate} to ${endDate}...`);

  try {
    // 3. Safety: Ensure DB columns exist
    const cols = ['reach', 'landing_page_views', 'add_to_cart', 'checkouts_initiated', 'conversions', 'conversion_value'];
    cols.forEach(col => {
      try { db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN ${col} REAL DEFAULT 0`); } catch(e) {}
    });

    // 4. Fetch object metadata (campaigns, adsets, ads with status)
    const objectResult = await fetchMetaObjects(store, accountId, accessToken);
    const statusMaps = {
      campaignStatusMap: objectResult.campaignStatusMap,
      adsetStatusMap: objectResult.adsetStatusMap
    };

    // 5. Sync all three levels with status info
    const campaignRows = await syncMetaLevel(store, 'campaign', accountId, accessToken, startDate, endDate, statusMaps);
    const adsetRows = await syncMetaLevel(store, 'adset', accountId, accessToken, startDate, endDate, statusMaps);
    const adRows = await syncMetaLevel(store, 'ad', accountId, accessToken, startDate, endDate, statusMaps);

    const totalRows = campaignRows + adsetRows + adRows;
    console.log(`[Meta] Successfully synced ${campaignRows} campaigns, ${adsetRows} ad sets, ${adRows} ads (${totalRows} total).`);

    if (store === 'vironax') {
      // Include campaign_name to show which campaign drove the conversion
      const metaOrderRows = db.prepare(`
        SELECT date,
               country,
               campaign_id,
               campaign_name,
               MAX(created_at) as latest_created_at,
               SUM(conversions) as conversions,
               SUM(conversion_value) as conversion_value
        FROM meta_daily_metrics
        WHERE store = ? AND date BETWEEN ? AND ?
        GROUP BY date, country, campaign_id, campaign_name
        ORDER BY date DESC
      `).all(store, startDate, endDate);

      const syncTimestamp = new Date().toISOString();
      const metaOrders = metaOrderRows
        .filter(row => row.date === endDate)
        .filter(row => (row.conversions || 0) > 0 && (row.conversion_value || 0) > 0)
        .map(row => ({
          date: row.date,
          country: row.country || 'ALL',
          country_code: row.country || null,
          campaign_id: row.campaign_id || null,
          order_count: row.conversions,
          order_total: row.conversion_value,
          currency: 'SAR',
          // Prefer latest record creation time to reflect when data arrived in our system
          // Fallback to start of day when missing
          timestamp: row.latest_created_at
            ? new Date(row.latest_created_at).toISOString()
            : new Date(`${row.date}T00:00:00Z`).toISOString(),
          source: 'meta',
          campaign_name: row.campaign_name || null
        }));

      const notificationCount = createOrderNotifications(store, 'meta', metaOrders, {
        ingestionTimestamp: syncTimestamp
      });
      if (notificationCount > 0) {
        console.log(`[Meta] Created ${notificationCount} notifications for ${store}`);
      }
    }

    if (store === 'shawq') {
      const updated = backfillShopifyCampaignNames(store);
      if (updated > 0) {
        console.log(`[Meta] Backfilled ${updated} Shopify campaign names for ${store}`);
      }
    }

    // 6. Trigger historical backfill if not yet done (runs in background)
    if (!skipBackfill) {
      const backfillMeta = db.prepare(`SELECT backfill_status FROM meta_backfill_metadata WHERE store = ?`).get(store);
      if (!backfillMeta || backfillMeta.backfill_status !== 'completed') {
        // Run backfill asynchronously (don't await)
        performHistoricalBackfill(store, accountId, accessToken, statusMaps)
          .then(result => console.log(`[Meta] Backfill result for ${store}:`, result))
          .catch(err => console.error(`[Meta] Backfill error for ${store}:`, err.message));
      }
    } else {
      console.log(`[Meta] Skipping historical backfill for ${store} (fast sync)`);
    }

    return {
      success: true,
      records: totalRows,
      breakdown: {
        campaigns: campaignRows,
        adsets: adsetRows,
        ads: adRows
      },
      objects: {
        campaigns: objectResult.campaigns,
        adsets: objectResult.adsets,
        ads: objectResult.ads
      }
    };

  } catch (error) {
    console.error(`[Meta] Sync error:`, error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// GET BACKFILL STATUS
// ============================================================================
export function getBackfillStatus(store) {
  const db = getDb();
  return db.prepare(`SELECT * FROM meta_backfill_metadata WHERE store = ?`).get(store) || {
    store,
    backfill_status: 'not_started',
    earliest_successful_date: null,
    latest_successful_date: null
  };
}

// ============================================================================
// TRIGGER MANUAL BACKFILL
// ============================================================================
export async function triggerBackfill(store) {
  const db = getDb();

  // Reset backfill status to allow re-run
  db.prepare(`
    INSERT INTO meta_backfill_metadata (store, backfill_status)
    VALUES (?, 'pending')
    ON CONFLICT(store) DO UPDATE SET backfill_status = 'pending', updated_at = datetime('now')
  `).run(store);

  // Trigger a sync which will start the backfill
  return await syncMetaData(store);
}
