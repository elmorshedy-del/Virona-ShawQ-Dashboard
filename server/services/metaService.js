import fetch from 'node-fetch';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Helper to extract values from Meta's "actions" list
function getActionValue(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === type);
  return action ? parseFloat(action.value) : 0;
}

export async function syncMetaData(store) {
  const db = getDb();
  
  // 1. Get Credentials
  const accountIdEnv = store === 'shawq' ? 'SHAWQ_META_AD_ACCOUNT_ID' : 'META_AD_ACCOUNT_ID';
  const tokenEnv = store === 'shawq' ? 'SHAWQ_META_ACCESS_TOKEN' : 'META_ACCESS_TOKEN';
  
  const accountId = process.env[accountIdEnv];
  const accessToken = process.env[tokenEnv];

  if (!accountId || !accessToken) {
    console.log(`[Meta] Skipping sync for ${store}: Missing credentials`);
    return { success: false, error: 'Missing credentials' };
  }

  // 2. Set Date Range (Last 30 Days)
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  
  const cleanAccountId = accountId.replace(/^act_/, '');
  
  console.log(`[Meta] Syncing ${store} from ${startDate} to ${endDate}...`);

  try {
    // 3. Fetch Data (Breakdown by Country to match your CSV structure)
    const fields = 'campaign_name,campaign_id,spend,impressions,clicks,reach,cpm,cpc,ctr,frequency,actions,action_values';
    // We break down by country so we can map it to Shopify countries later
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

    if (json.error) {
      throw new Error(json.error.message);
    }

    const rows = json.data || [];

    // 4. Save to Database (Using the SAME columns as your CSV Import)
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_daily_metrics (
        store, date, campaign_id, campaign_name, country,
        spend, impressions, clicks, reach, 
        conversions, conversion_value,
        landing_page_views, add_to_cart, checkouts_initiated
      ) VALUES (
        @store, @date, @campaign_id, @campaign_name, @country,
        @spend, @impressions, @clicks, @reach,
        @conversions, @conversion_value,
        @lpv, @atc, @checkout
      )
    `);

    const tx = db.transaction(() => {
      for (const row of rows) {
        // Parse "Actions" to get specific metric values
        // Note: 'purchase' usually covers both pixel and offline in aggregated views
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
          spend: parseFloat(row.spend || 0),
          impressions: parseInt(row.impressions || 0),
          clicks: parseInt(row.clicks || 0),
          reach: parseInt(row.reach || 0),
          conversions: parseInt(purchases),
          conversion_value: parseFloat(revenue),
          lpv: parseInt(lpv),
          atc: parseInt(atc),
          checkout: parseInt(checkout)
        });
      }
    });

    tx();
    console.log(`[Meta] Successfully synced ${rows.length} rows for ${store}`);
    
    // Log success
    db.prepare("INSERT INTO sync_log (store, source, status, records_synced) VALUES (?, 'meta', 'success', ?)").run(store, rows.length);

    return { success: true, records: rows.length };

  } catch (error) {
    console.error(`[Meta] Sync error for ${store}:`, error.message);
    db.prepare("INSERT INTO sync_log (store, source, status, error_message) VALUES (?, 'meta', 'error', ?)").run(store, error.message);
    return { success: false, error: error.message };
  }
}
