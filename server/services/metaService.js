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
  const cleanAccountId = accountId.replace(/^act_/, '');
  
  console.log(`[Meta] Syncing ${store} (Rate: ${rate}) from ${startDate} to ${endDate}...`);

  try {
    // 3. Fetch Data
    // "actions" contains: landing_page_view, add_to_cart, initiate_checkout, purchase
    const fields = 'campaign_name,campaign_id,spend,impressions,clicks,reach,actions,action_values';
    const url = `${META_BASE_URL}/act_${cleanAccountId}/insights?` +
      `level=campaign&` +
      `fields=${fields}&` +
      `breakdowns=country&` + 
      `time_range={'since':'${startDate}','until':'${endDate}'}&` +
      `time_increment=1&` +
      `limit=500&` +
      `access_token=${accessToken}`;

    const response = await fetch(url);
    const json = await response.json();

    if (json.error) throw new Error(json.error.message);
    const rows = json.data || [];

    // 4. Safety: Ensure DB columns exist
    const cols = ['reach', 'landing_page_views', 'add_to_cart', 'checkouts_initiated', 'conversions', 'conversion_value'];
    cols.forEach(col => {
      try { db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN ${col} REAL DEFAULT 0`); } catch(e) {}
    });

    // 5. Save to Database
    const insertStmt = db.prepare(`
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

    const tx = db.transaction(() => {
      for (const row of rows) {
        // Parse specific funnel steps
        const purchases = getActionValue(row.actions, 'purchase') || getActionValue(row.actions, 'offsite_conversion.fb_pixel_purchase');
        const revenue = getActionValue(row.action_values, 'purchase') || getActionValue(row.action_values, 'offsite_conversion.fb_pixel_purchase');
        const lpv = getActionValue(row.actions, 'landing_page_view');
        const atc = getActionValue(row.actions, 'add_to_cart');
        const checkout = getActionValue(row.actions, 'initiate_checkout');

        insertStmt.run({
          store: store,
          date: row.date_start,
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name,
          country: row.country || 'ALL',
          
          // Metrics
          spend: parseFloat(row.spend || 0) * rate,
          impressions: parseInt(row.impressions || 0),
          clicks: parseInt(row.clicks || 0),
          reach: parseInt(row.reach || 0),
          lpv: parseInt(lpv),
          atc: parseInt(atc),
          checkout: parseInt(checkout),
          conversions: parseInt(purchases),
          conversion_value: parseFloat(revenue || 0) * rate
        });
      }
    });

    tx();
    console.log(`[Meta] Successfully synced ${rows.length} rows.`);
    return { success: true, records: rows.length };

  } catch (error) {
    console.error(`[Meta] Sync error:`, error.message);
    return { success: false, error: error.message };
  }
}
