// server/services/metaService.js
import fetch from 'node-fetch';
import { getDb } from '../db/database.js';

const META_API_VERSION = 'v19.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// Store configurations - using the actual env variable names from Railway
const STORE_CONFIGS = {
  vironax: {
    accountIdEnv: 'META_AD_ACCOUNT_ID',
    tokenEnv: 'META_ACCESS_TOKEN',
    currency: 'SAR',
    displayCurrency: 'SAR',
    needsConversion: false
  },
  shawq: {
    accountIdEnv: 'SHAWQ_META_AD_ACCOUNT_ID',
    tokenEnv: 'SHAWQ_META_ACCESS_TOKEN',
    currency: 'TRY',
    displayCurrency: 'USD',
    needsConversion: true
  }
};

// small helper to fetch all pages from Meta Insights
async function fetchAllPages(initialUrl, label) {
  const allRows = [];
  let url = initialUrl;

  while (url) {
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error(`[Meta API] ${label} error:`, data.error);
      throw new Error(data.error.message);
    }

    if (Array.isArray(data.data)) {
      allRows.push(...data.data);
    }

    url = data.paging && data.paging.next ? data.paging.next : null;
  }

  console.log(`[Meta API] ${label}: collected ${allRows.length} rows (all pages)`);
  return allRows;
}

// Get exchange rate TRY → USD
async function getExchangeRate(fromCurrency, toCurrency) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  
  // Check cache first
  const cached = db.prepare(`
    SELECT rate FROM exchange_rates 
    WHERE from_currency = ? AND to_currency = ? AND date = ?
  `).get(fromCurrency, toCurrency, today);
  
  if (cached) {
    return cached.rate;
  }
  
  // Fetch from free API
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCurrency}`);
    const data = await res.json();
    const rate = data.rates[toCurrency] || 0.03; // fallback ~30 TRY = 1 USD
    
    // Cache the rate
    db.prepare(`
      INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date)
      VALUES (?, ?, ?, ?)
    `).run(fromCurrency, toCurrency, rate, today);
    
    console.log(`Exchange rate ${fromCurrency}→${toCurrency}: ${rate}`);
    return rate;
  } catch (error) {
    console.error('Exchange rate fetch error:', error);
    return fromCurrency === 'TRY' && toCurrency === 'USD' ? 0.029 : 1; // fallback
  }
}

export async function fetchMetaCampaigns(store, dateStart, dateEnd) {
  const config = STORE_CONFIGS[store];
  if (!config) throw new Error(`Unknown store: ${store}`);
  
  const accountId = process.env[config.accountIdEnv];
  const accessToken = process.env[config.tokenEnv];

  console.log(`[Meta API] Store: ${store}`);
  console.log(`[Meta API] Looking for env: ${config.accountIdEnv} = ${accountId ? 'SET' : 'NOT SET'}`);
  console.log(`[Meta API] Looking for env: ${config.tokenEnv} = ${accessToken ? 'SET' : 'NOT SET'}`);

  if (!accountId || !accessToken) {
    console.log(`[Meta API] Credentials not configured for ${store} - using demo data`);
    return getDemoMetaData(store, dateStart, dateEnd);
  }

  const fields = [
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'reach',
    'clicks',
    'actions',
    'action_values',
    'cpm',
    'cpc',
    'ctr',
    'frequency'
  ].join(',');

  const cleanAccountId = accountId.replace(/^act_/, '');
  const baseUrl =
    `${META_BASE_URL}/act_${cleanAccountId}/insights` +
    `?fields=${fields}` +
    `&time_range={"since":"${dateStart}","until":"${dateEnd}"}` +
    `&level=campaign&time_increment=1&access_token=${accessToken}`;

  console.log(`[Meta API] Fetching campaigns for ${store} ${dateStart} → ${dateEnd}`);

  try {
    let results = await fetchAllPages(baseUrl, 'campaigns');

    // Convert currency if needed (Shawq: TRY → USD)
    if (config.needsConversion) {
      const rate = await getExchangeRate(config.currency, config.displayCurrency);
      results = results.map(row => ({
        ...row,
        spend: (parseFloat(row.spend) * rate).toFixed(2),
        cpm: (parseFloat(row.cpm || 0) * rate).toFixed(2),
        cpc: (parseFloat(row.cpc || 0) * rate).toFixed(2),
        action_values: (row.action_values || []).map(av => ({
          ...av,
          value: (parseFloat(av.value) * rate).toFixed(2)
        }))
      }));
    }

    return results;
  } catch (error) {
    console.error(`[Meta API] Error for ${store}:`, error.message);
    console.log(`[Meta API] Falling back to demo data for ${store}`);
    return getDemoMetaData(store, dateStart, dateEnd);
  }
}

export async function fetchMetaCampaignsByCountry(store, dateStart, dateEnd) {
  const config = STORE_CONFIGS[store];
  if (!config) throw new Error(`Unknown store: ${store}`);
  
  const accountId = process.env[config.accountIdEnv];
  const accessToken = process.env[config.tokenEnv];

  if (!accountId || !accessToken) {
    console.log('[Meta API] No creds for country breakdown, using demo');
    return getDemoMetaDataByCountry(store, dateStart, dateEnd);
  }

  const fields = [
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'reach',
    'clicks',
    'actions',
    'action_values',
    'cpm',
    'cpc',
    'ctr',
    'frequency',
    'country'
  ].join(',');

  const cleanAccountId = accountId.replace(/^act_/, '');
  const baseUrl =
    `${META_BASE_URL}/act_${cleanAccountId}/insights` +
    `?fields=${fields}` +
    `&time_range={"since":"${dateStart}","until":"${dateEnd}"}` +
    `&level=campaign&time_increment=1&breakdowns=country&access_token=${accessToken}`;

  try {
    let results = await fetchAllPages(baseUrl, 'country breakdown');

    if (config.needsConversion) {
      const rate = await getExchangeRate(config.currency, config.displayCurrency);
      results = results.map(row => ({
        ...row,
        spend: (parseFloat(row.spend) * rate).toFixed(2),
        cpm: (parseFloat(row.cpm || 0) * rate).toFixed(2),
        cpc: (parseFloat(row.cpc || 0) * rate).toFixed(2),
        action_values: (row.action_values || []).map(av => ({
          ...av,
          value: (parseFloat(av.value) * rate).toFixed(2)
        }))
      }));
    }

    return results;
  } catch (error) {
    console.error(`[Meta API] Country breakdown error for ${store}:`, error.message);
    return getDemoMetaDataByCountry(store, dateStart, dateEnd);
  }
}

// Fetch by age breakdown
export async function fetchMetaCampaignsByAge(store, dateStart, dateEnd) {
  const config = STORE_CONFIGS[store];
  if (!config) throw new Error(`Unknown store: ${store}`);
  
  const accountId = process.env[config.accountIdEnv];
  const accessToken = process.env[config.tokenEnv];

  if (!accountId || !accessToken) {
    return getDemoMetaDataByAge(store, dateStart, dateEnd);
  }

  try {
    const fields = [
      'campaign_id', 'campaign_name', 'spend', 'impressions', 'reach',
      'clicks', 'actions', 'action_values', 'cpm', 'cpc', 'ctr', 'frequency', 'age'
    ].join(',');

    const cleanAccountId = accountId.replace(/^act_/, '');
    const baseUrl =
      `${META_BASE_URL}/act_${cleanAccountId}/insights` +
      `?fields=${fields}` +
      `&time_range={"since":"${dateStart}","until":"${dateEnd}"}` +
      `&level=campaign&time_increment=1&breakdowns=age&access_token=${accessToken}`;

    let results = await fetchAllPages(baseUrl, 'age breakdown');

    if (config.needsConversion) {
      const rate = await getExchangeRate(config.currency, config.displayCurrency);
      results = results.map(row => ({
        ...row,
        spend: (parseFloat(row.spend) * rate).toFixed(2),
        cpm: (parseFloat(row.cpm || 0) * rate).toFixed(2),
        cpc: (parseFloat(row.cpc || 0) * rate).toFixed(2),
        action_values: (row.action_values || []).map(av => ({
          ...av,
          value: (parseFloat(av.value) * rate).toFixed(2)
        }))
      }));
    }
    return results;
  } catch (error) {
    console.error(`[Meta API] Age breakdown error for ${store}:`, error.message);
    return getDemoMetaDataByAge(store, dateStart, dateEnd);
  }
}

// Fetch by gender breakdown
export async function fetchMetaCampaignsByGender(store, dateStart, dateEnd) {
  const config = STORE_CONFIGS[store];
  if (!config) throw new Error(`Unknown store: ${store}`);
  
  const accountId = process.env[config.accountIdEnv];
  const accessToken = process.env[config.tokenEnv];

  if (!accountId || !accessToken) {
    return getDemoMetaDataByGender(store, dateStart, dateEnd);
  }

  try {
    const fields = [
      'campaign_id', 'campaign_name', 'spend', 'impressions', 'reach',
      'clicks', 'actions', 'action_values', 'cpm', 'cpc', 'ctr', 'frequency', 'gender'
    ].join(',');
    const cleanAccountId = accountId.replace(/^act_/, '');
    const baseUrl =
      `${META_BASE_URL}/act_${cleanAccountId}/insights` +
      `?fields=${fields}` +
      `&time_range={"since":"${dateStart}","until":"${dateEnd}"}` +
      `&level=campaign&time_increment=1&breakdowns=gender&access_token=${accessToken}`;

    let results = await fetchAllPages(baseUrl, 'gender breakdown');

    if (config.needsConversion) {
      const rate = await getExchangeRate(config.currency, config.displayCurrency);
      results = results.map(row => ({
        ...row,
        spend: (parseFloat(row.spend) * rate).toFixed(2),
        cpm: (parseFloat(row.cpm || 0) * rate).toFixed(2),
        cpc: (parseFloat(row.cpc || 0) * rate).toFixed(2),
        action_values: (row.action_values || []).map(av => ({
          ...av,
          value: (parseFloat(av.value) * rate).toFixed(2)
        }))
      }));
    }
    return results;
  } catch (error) {
    console.error(`[Meta API] Gender breakdown error for ${store}:`, error.message);
    return getDemoMetaDataByGender(store, dateStart, dateEnd);
  }
}

// Fetch by placement breakdown
export async function fetchMetaCampaignsByPlacement(store, dateStart, dateEnd) {
  const config = STORE_CONFIGS[store];
  if (!config) throw new Error(`Unknown store: ${store}`);
  
  const accountId = process.env[config.accountIdEnv];
  const accessToken = process.env[config.tokenEnv];

  if (!accountId || !accessToken) {
    return getDemoMetaDataByPlacement(store, dateStart, dateEnd);
  }

  try {
    const fields = [
      'campaign_id', 'campaign_name', 'spend', 'impressions', 'reach',
      'clicks', 'actions', 'action_values', 'cpm', 'cpc', 'ctr', 'frequency',
      'publisher_platform', 'platform_position'
    ].join(',');
    const cleanAccountId = accountId.replace(/^act_/, '');
    const baseUrl =
      `${META_BASE_URL}/act_${cleanAccountId}/insights` +
      `?fields=${fields}` +
      `&time_range={"since":"${dateStart}","until":"${dateEnd}"}` +
      `&level=campaign&time_increment=1&breakdowns=publisher_platform,platform_position&access_token=${accessToken}`;

    let results = await fetchAllPages(baseUrl, 'placement breakdown');

    if (config.needsConversion) {
      const rate = await getExchangeRate(config.currency, config.displayCurrency);
      results = results.map(row => ({
        ...row,
        spend: (parseFloat(row.spend) * rate).toFixed(2),
        cpm: (parseFloat(row.cpm || 0) * rate).toFixed(2),
        cpc: (parseFloat(row.cpc || 0) * rate).toFixed(2),
        action_values: (row.action_values || []).map(av => ({
          ...av,
          value: (parseFloat(av.value) * rate).toFixed(2)
        }))
      }));
    }
    return results;
  } catch (error) {
    console.error(`[Meta API] Placement breakdown error for ${store}:`, error.message);
    return getDemoMetaDataByPlacement(store, dateStart, dateEnd);
  }
}

export async function syncMetaData(store) {
  const db = getDb();
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    const campaigns = await fetchMetaCampaigns(store, startDate, endDate);
    const countryData = await fetchMetaCampaignsByCountry(store, startDate, endDate);
    const ageData = await fetchMetaCampaignsByAge(store, startDate, endDate);
    const genderData = await fetchMetaCampaignsByGender(store, startDate, endDate);
    const placementData = await fetchMetaCampaignsByPlacement(store, startDate, endDate);

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_daily_metrics 
      (store, date, campaign_id, campaign_name, country, age, gender, publisher_platform, platform_position,
       spend, impressions, reach, clicks, landing_page_views, add_to_cart, checkouts_initiated, 
       conversions, conversion_value, cpm, cpc, ctr, frequency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let recordsInserted = 0;

    // Insert campaign totals (ALL breakdown)
    for (const row of campaigns) {
      const actions = parseActions(row.actions || []);
      const actionValues = parseActionValues(row.action_values || []);

      insertStmt.run(
        store, row.date_start, row.campaign_id, row.campaign_name,
        'ALL', '', '', '', '',
        parseFloat(row.spend) || 0, parseInt(row.impressions) || 0, parseInt(row.reach) || 0,
        parseInt(row.clicks) || 0, actions.landing_page_view || 0, actions.add_to_cart || 0,
        actions.initiate_checkout || 0, actions.purchase || 0, actionValues.purchase || 0,
        parseFloat(row.cpm) || 0, parseFloat(row.cpc) || 0, parseFloat(row.ctr) || 0,
        parseFloat(row.frequency) || 0
      );
      recordsInserted++;
    }

    // Insert country breakdown
    for (const row of countryData) {
      const actions = parseActions(row.actions || []);
      const actionValues = parseActionValues(row.action_values || []);

      insertStmt.run(
        store, row.date_start, row.campaign_id, row.campaign_name,
        row.country || 'UNKNOWN', '', '', '', '',
        parseFloat(row.spend) || 0, parseInt(row.impressions) || 0, parseInt(row.reach) || 0,
        parseInt(row.clicks) || 0, actions.landing_page_view || 0, actions.add_to_cart || 0,
        actions.initiate_checkout || 0, actions.purchase || 0, actionValues.purchase || 0,
        parseFloat(row.cpm) || 0, parseFloat(row.cpc) || 0, parseFloat(row.ctr) || 0,
        parseFloat(row.frequency) || 0
      );
      recordsInserted++;
    }

    // Insert age breakdown
    for (const row of ageData) {
      const actions = parseActions(row.actions || []);
      const actionValues = parseActionValues(row.action_values || []);

      insertStmt.run(
        store, row.date_start, row.campaign_id, row.campaign_name,
        'ALL', row.age || '', '', '', '',
        parseFloat(row.spend) || 0, parseInt(row.impressions) || 0, parseInt(row.reach) || 0,
        parseInt(row.clicks) || 0, actions.landing_page_view || 0, actions.add_to_cart || 0,
        actions.initiate_checkout || 0, actions.purchase || 0, actionValues.purchase || 0,
        parseFloat(row.cpm) || 0, parseFloat(row.cpc) || 0, parseFloat(row.ctr) || 0,
        parseFloat(row.frequency) || 0
      );
      recordsInserted++;
    }

    // Insert gender breakdown
    for (const row of genderData) {
      const actions = parseActions(row.actions || []);
      const actionValues = parseActionValues(row.action_values || []);

      insertStmt.run(
        store, row.date_start, row.campaign_id, row.campaign_name,
        'ALL', '', row.gender || '', '', '',
        parseFloat(row.spend) || 0, parseInt(row.impressions) || 0, parseInt(row.reach) || 0,
        parseInt(row.clicks) || 0, actions.landing_page_view || 0, actions.add_to_cart || 0,
        actions.initiate_checkout || 0, actions.purchase || 0, actionValues.purchase || 0,
        parseFloat(row.cpm) || 0, parseFloat(row.cpc) || 0, parseFloat(row.ctr) || 0,
        parseFloat(row.frequency) || 0
      );
      recordsInserted++;
    }

    // Insert placement breakdown
    for (const row of placementData) {
      const actions = parseActions(row.actions || []);
      const actionValues = parseActionValues(row.action_values || []);

      insertStmt.run(
        store, row.date_start, row.campaign_id, row.campaign_name,
        'ALL', '', '', row.publisher_platform || '', row.platform_position || '',
        parseFloat(row.spend) || 0, parseInt(row.impressions) || 0, parseInt(row.reach) || 0,
        parseInt(row.clicks) || 0, actions.landing_page_view || 0, actions.add_to_cart || 0,
        actions.initiate_checkout || 0, actions.purchase || 0, actionValues.purchase || 0,
        parseFloat(row.cpm) || 0, parseFloat(row.cpc) || 0, parseFloat(row.ctr) || 0,
        parseFloat(row.frequency) || 0
      );
      recordsInserted++;
    }

    // Log sync
    db.prepare(`
      INSERT INTO sync_log (store, source, status, records_synced)
      VALUES (?, 'meta', 'success', ?)
    `).run(store, recordsInserted);

    return { success: true, records: recordsInserted };
  } catch (error) {
    db.prepare(`
      INSERT INTO sync_log (store, source, status, error_message)
      VALUES (?, 'meta', 'error', ?)
    `).run(store, error.message);

    throw error;
  }
}

function parseActions(actions) {
  const result = {
    landing_page_view: 0,
    add_to_cart: 0,
    initiate_checkout: 0,
    purchase: 0
  };

  for (const action of actions) {
    if (action.action_type === 'landing_page_view') {
      result.landing_page_view = parseInt(action.value) || 0;
    } else if (action.action_type === 'add_to_cart') {
      result.add_to_cart = parseInt(action.value) || 0;
    } else if (action.action_type === 'initiate_checkout') {
      result.initiate_checkout = parseInt(action.value) || 0;
    } else if (action.action_type === 'purchase' || action.action_type === 'omni_purchase') {
      result.purchase = parseInt(action.value) || 0;
    }
  }

  return result;
}

function parseActionValues(actionValues) {
  const result = { purchase: 0 };

  for (const av of actionValues) {
    if (av.action_type === 'purchase' || av.action_type === 'omni_purchase') {
      result.purchase = parseFloat(av.value) || 0;
    }
  }

  return result;
}

/* --- DEMO DATA HELPERS BELOW (unchanged logic) --- */

// Demo data - different for each store
function getDemoMetaData(store, dateStart, dateEnd) {
  // Returns empty array as demo data when Meta API is not configured
  return [];
}

// Demo data for country breakdown
function getDemoMetaDataByCountry(store, dateStart, dateEnd) {
  // Returns empty array as demo data when Meta API is not configured
  return [];
}

// Demo data for age breakdown
function getDemoMetaDataByAge(store, dateStart, dateEnd) {
  // Returns empty array as demo data when Meta API is not configured
  return [];
}

// Demo data for gender breakdown
function getDemoMetaDataByGender(store, dateStart, dateEnd) {
  // Returns empty array as demo data when Meta API is not configured
  return [];
}

// Demo data for placement breakdown
function getDemoMetaDataByPlacement(store, dateStart, dateEnd) {
  // Returns empty array as demo data when Meta API is not configured
  return [];
}
