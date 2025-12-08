import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Helper: Get currency conversion rate
function getCurrencyRate(store) {
  if (store === 'shawq') return 0.029; // Convert TRY to USD
  if (store === 'vironax') return 1.0; // Keep SAR as SAR
  return 1.0;
}

// Helper: Extract metric from Meta's "actions" list
function getActionValue(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === type);
  return action ? parseFloat(action.value) : 0;
}

// Helper: Sync a specific level (campaign, adset, or ad)
async function syncMetaLevel(store, level, accountId, accessToken, startDate, endDate, rate) {
  const db = getDb();
  const cleanAccountId = accountId.replace(/^act_/, '');

  // Define fields based on level
  let fields = 'spend,impressions,clicks,reach,actions,action_values';
  if (level === 'campaign') {
    fields = 'campaign_name,campaign_id,' + fields;
  } else if (level === 'adset') {
    fields = 'campaign_name,campaign_id,adset_name,adset_id,' + fields;
  } else if (level === 'ad') {
    fields = 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,' + fields;
  }

  const url = `${META_BASE_URL}/act_${cleanAccountId}/insights?` +
    `level=${level}&` +
    `fields=${fields}&` +
    `breakdowns=country&` +
    `time_range={'since':'${startDate}','until':'${endDate}'}&` +
    `time_increment=1&` +
    `limit=500&` +
    `access_token=${accessToken}`;

  // CRITICAL: Implement pagination to fetch ALL data (not just first 500 rows)
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

  const rows = allRows;

  // Prepare insert statement based on level
  let insertStmt;
  if (level === 'campaign') {
    insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_daily_metrics (
        store, date, campaign_id, campaign_name, country,
        spend, impressions, clicks, reach,
        landing_page_views, add_to_cart, checkouts_initiated,
        conversions, conversion_value
      ) VALUES (
        @store, @date, @campaign_id, @campaign_name, @country,
        @spend, @impressions, @clicks, @reach,
        @lpv, @atc, @checkout,
        @conversions, @conversion_value
      )
    `);
  } else if (level === 'adset') {
    insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_adset_metrics (
        store, date, campaign_id, campaign_name, adset_id, adset_name, country,
        spend, impressions, clicks, reach,
        landing_page_views, add_to_cart, checkouts_initiated,
        conversions, conversion_value
      ) VALUES (
        @store, @date, @campaign_id, @campaign_name, @adset_id, @adset_name, @country,
        @spend, @impressions, @clicks, @reach,
        @lpv, @atc, @checkout,
        @conversions, @conversion_value
      )
    `);
  } else if (level === 'ad') {
    insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_ad_metrics (
        store, date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, country,
        spend, impressions, clicks, reach,
        landing_page_views, add_to_cart, checkouts_initiated,
        conversions, conversion_value
      ) VALUES (
        @store, @date, @campaign_id, @campaign_name, @adset_id, @adset_name, @ad_id, @ad_name, @country,
        @spend, @impressions, @clicks, @reach,
        @lpv, @atc, @checkout,
        @conversions, @conversion_value
      )
    `);
  }

  const tx = db.transaction(() => {
    for (const row of rows) {
      // Parse specific funnel steps
      const purchases = getActionValue(row.actions, 'purchase') || getActionValue(row.actions, 'offsite_conversion.fb_pixel_purchase');
      const revenue = getActionValue(row.action_values, 'purchase') || getActionValue(row.action_values, 'offsite_conversion.fb_pixel_purchase');
      const lpv = getActionValue(row.actions, 'landing_page_view');
      const atc = getActionValue(row.actions, 'add_to_cart');
      const checkout = getActionValue(row.actions, 'initiate_checkout');

      const data = {
        store: store,
        date: row.date_start,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        country: row.country || 'ALL',
        spend: parseFloat(row.spend || 0) * rate,
        impressions: parseInt(row.impressions || 0),
        clicks: parseInt(row.clicks || 0),
        reach: parseInt(row.reach || 0),
        lpv: parseInt(lpv),
        atc: parseInt(atc),
        checkout: parseInt(checkout),
        conversions: parseInt(purchases),
        conversion_value: parseFloat(revenue || 0) * rate
      };

      // Add level-specific fields
      if (level === 'adset' || level === 'ad') {
        data.adset_id = row.adset_id;
        data.adset_name = row.adset_name;
      }
      if (level === 'ad') {
        data.ad_id = row.ad_id;
        data.ad_name = row.ad_name;
      }

      insertStmt.run(data);
    }
  });

  tx();
  return rows.length;
}

export async function syncMetaData(store) {
  const db = getDb();

  // 1. Credentials
  const accountIdEnv = store === 'shawq' ? 'SHAWQ_META_AD_ACCOUNT_ID' : 'META_AD_ACCOUNT_ID';
  const tokenEnv = store === 'shawq' ? 'SHAWQ_META_ACCESS_TOKEN' : 'META_ACCESS_TOKEN';
  const accountId = process.env[accountIdEnv];
  const accessToken = process.env[tokenEnv];
  const rate = getCurrencyRate(store);

  if (!accountId || !accessToken) {
    console.log(`[Meta] Skipping sync for ${store}: Missing credentials`);
    return { success: false, error: 'Missing credentials' };
  }

  // 2. Date Range (Last 30 Days)
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  console.log(`[Meta] Syncing ${store} (Rate: ${rate}) from ${startDate} to ${endDate}...`);

  try {
    // 3. Safety: Ensure DB columns exist
    const cols = ['reach', 'landing_page_views', 'add_to_cart', 'checkouts_initiated', 'conversions', 'conversion_value'];
    cols.forEach(col => {
      try { db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN ${col} REAL DEFAULT 0`); } catch(e) {}
    });

    // 4. Sync all three levels
    const campaignRows = await syncMetaLevel(store, 'campaign', accountId, accessToken, startDate, endDate, rate);
    const adsetRows = await syncMetaLevel(store, 'adset', accountId, accessToken, startDate, endDate, rate);
    const adRows = await syncMetaLevel(store, 'ad', accountId, accessToken, startDate, endDate, rate);

    const totalRows = campaignRows + adsetRows + adRows;
    console.log(`[Meta] Successfully synced ${campaignRows} campaigns, ${adsetRows} ad sets, ${adRows} ads (${totalRows} total).`);
    return {
      success: true,
      records: totalRows,
      breakdown: {
        campaigns: campaignRows,
        adsets: adsetRows,
        ads: adRows
      }
    };

  } catch (error) {
    console.error(`[Meta] Sync error:`, error.message);
    return { success: false, error: error.message };
  }
}
