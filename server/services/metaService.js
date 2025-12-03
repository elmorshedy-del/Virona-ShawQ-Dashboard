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

  try {
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

    // Remove 'act_' prefix if user included it
    const cleanAccountId = accountId.replace(/^act_/, '');
    const url = `${META_BASE_URL}/act_${cleanAccountId}/insights?fields=${fields}&time_range={"since":"${dateStart}","until":"${dateEnd}"}&level=campaign&time_increment=1&access_token=${accessToken}`;

    console.log(`[Meta API] Fetching from: act_${cleanAccountId}/insights for dates ${dateStart} to ${dateEnd}`);

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error(`[Meta API] Error response:`, data.error);
      throw new Error(data.error.message);
    }

    console.log(`[Meta API] Success! Got ${(data.data || []).length} records for ${store}`);

    // Convert currency if needed (Shawq: TRY → USD)
    let results = data.data || [];
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
    return getDemoMetaDataByCountry(store, dateStart, dateEnd);
  }

  try {
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
    const url = `${META_BASE_URL}/act_${cleanAccountId}/insights?fields=${fields}&time_range={"since":"${dateStart}","until":"${dateEnd}"}&level=campaign&time_increment=1&breakdowns=country&access_token=${accessToken}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      console.error(`[Meta API] Country breakdown error:`, data.error);
      return getDemoMetaDataByCountry(store, dateStart, dateEnd);
    }

    // Convert currency if needed
    let results = data.data || [];
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
    const fields = ['campaign_id', 'campaign_name', 'spend', 'impressions', 'reach', 'clicks', 'actions', 'action_values', 'cpm', 'cpc', 'ctr', 'frequency'].join(',');
    const cleanAccountId = accountId.replace(/^act_/, '');
    const url = `${META_BASE_URL}/act_${cleanAccountId}/insights?fields=${fields}&time_range={"since":"${dateStart}","until":"${dateEnd}"}&level=campaign&time_increment=1&breakdowns=age&access_token=${accessToken}`;

    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
      console.error(`[Meta API] Age breakdown error:`, data.error);
      return getDemoMetaDataByAge(store, dateStart, dateEnd);
    }

    let results = data.data || [];
    if (config.needsConversion) {
      const rate = await getExchangeRate(config.currency, config.displayCurrency);
      results = results.map(row => ({
        ...row,
        spend: (parseFloat(row.spend) * rate).toFixed(2),
        cpm: (parseFloat(row.cpm || 0) * rate).toFixed(2),
        cpc: (parseFloat(row.cpc || 0) * rate).toFixed(2)
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
    const fields = ['campaign_id', 'campaign_name', 'spend', 'impressions', 'reach', 'clicks', 'actions', 'action_values', 'cpm', 'cpc', 'ctr', 'frequency'].join(',');
    const cleanAccountId = accountId.replace(/^act_/, '');
    const url = `${META_BASE_URL}/act_${cleanAccountId}/insights?fields=${fields}&time_range={"since":"${dateStart}","until":"${dateEnd}"}&level=campaign&time_increment=1&breakdowns=gender&access_token=${accessToken}`;

    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
      console.error(`[Meta API] Gender breakdown error:`, data.error);
      return getDemoMetaDataByGender(store, dateStart, dateEnd);
    }

    let results = data.data || [];
    if (config.needsConversion) {
      const rate = await getExchangeRate(config.currency, config.displayCurrency);
      results = results.map(row => ({
        ...row,
        spend: (parseFloat(row.spend) * rate).toFixed(2),
        cpm: (parseFloat(row.cpm || 0) * rate).toFixed(2),
        cpc: (parseFloat(row.cpc || 0) * rate).toFixed(2)
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
    const fields = ['campaign_id', 'campaign_name', 'spend', 'impressions', 'reach', 'clicks', 'actions', 'action_values', 'cpm', 'cpc', 'ctr', 'frequency'].join(',');
    const cleanAccountId = accountId.replace(/^act_/, '');
    const url = `${META_BASE_URL}/act_${cleanAccountId}/insights?fields=${fields}&time_range={"since":"${dateStart}","until":"${dateEnd}"}&level=campaign&time_increment=1&breakdowns=publisher_platform,platform_position&access_token=${accessToken}`;

    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
      console.error(`[Meta API] Placement breakdown error:`, data.error);
      return getDemoMetaDataByPlacement(store, dateStart, dateEnd);
    }

    let results = data.data || [];
    if (config.needsConversion) {
      const rate = await getExchangeRate(config.currency, config.displayCurrency);
      results = results.map(row => ({
        ...row,
        spend: (parseFloat(row.spend) * rate).toFixed(2),
        cpm: (parseFloat(row.cpm || 0) * rate).toFixed(2),
        cpc: (parseFloat(row.cpc || 0) * rate).toFixed(2)
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

// Demo data - different for each store
function getDemoMetaData(store, dateStart, dateEnd) {
  const storeConfigs = {
    vironax: {
      campaigns: [
        { id: 'camp_v1', name: 'Modern Gentleman - Rings' },
        { id: 'camp_v2', name: 'Heritage Collection' },
        { id: 'camp_v3', name: 'Gift Giver - Misbaha' }
      ],
      baseSpend: [320, 220, 160], // SAR
      convMultiplier: 5.2
    },
    shawq: {
      campaigns: [
        { id: 'camp_s1', name: 'Palestinian Heritage Apparel' },
        { id: 'camp_s2', name: 'Syrian Traditional Wear' },
        { id: 'camp_s3', name: 'Keffiyeh Collection' },
        { id: 'camp_s4', name: 'Cultural Pride - USA' }
      ],
      baseSpend: [180, 140, 95, 120], // USD (converted from TRY)
      convMultiplier: 3.8
    }
  };

  const config = storeConfigs[store] || storeConfigs.vironax;
  const data = [];
  const start = new Date(dateStart);
  const end = new Date(dateEnd);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];

    config.campaigns.forEach((camp, idx) => {
      const baseSpend = config.baseSpend[idx];
      const variance = 0.8 + Math.random() * 0.4;

      data.push({
        date_start: dateStr,
        campaign_id: camp.id,
        campaign_name: camp.name,
        spend: (baseSpend * variance).toFixed(2),
        impressions: Math.floor((store === 'shawq' ? 180000 : 280000) * variance),
        reach: Math.floor((store === 'shawq' ? 120000 : 180000) * variance),
        clicks: Math.floor((store === 'shawq' ? 2200 : 3500) * variance),
        cpm: ((store === 'shawq' ? 8 : 3) + Math.random() * 2).toFixed(2),
        cpc: ((store === 'shawq' ? 0.65 : 0.22) + Math.random() * 0.15).toFixed(2),
        ctr: (1.1 + Math.random() * 0.4).toFixed(2),
        frequency: (1.4 + Math.random() * 0.3).toFixed(2),
        actions: [
          { action_type: 'landing_page_view', value: Math.floor(1800 * variance) },
          { action_type: 'add_to_cart', value: Math.floor(140 * variance) },
          { action_type: 'initiate_checkout', value: Math.floor(56 * variance) },
          { action_type: 'purchase', value: Math.floor((store === 'shawq' ? 18 : 10) * variance) }
        ],
        action_values: [
          { action_type: 'purchase', value: (baseSpend * variance * config.convMultiplier).toFixed(2) }
        ]
      });
    });
  }

  return data;
}

function getDemoMetaDataByCountry(store, dateStart, dateEnd) {
  const storeConfigs = {
    vironax: {
      campaigns: [
        { id: 'camp_v1', name: 'Modern Gentleman - Rings' },
        { id: 'camp_v2', name: 'Heritage Collection' },
        { id: 'camp_v3', name: 'Gift Giver - Misbaha' }
      ],
      countries: [
        { code: 'SA', share: 0.50 },
        { code: 'AE', share: 0.25 },
        { code: 'KW', share: 0.12 },
        { code: 'QA', share: 0.08 },
        { code: 'OM', share: 0.05 }
      ],
      baseSpend: [320, 220, 160],
      convMultiplier: 5.2
    },
    shawq: {
      campaigns: [
        { id: 'camp_s1', name: 'Palestinian Heritage Apparel' },
        { id: 'camp_s2', name: 'Syrian Traditional Wear' },
        { id: 'camp_s3', name: 'Keffiyeh Collection' },
        { id: 'camp_s4', name: 'Cultural Pride - USA' }
      ],
      countries: [
        { code: 'US', share: 0.40 },
        { code: 'GB', share: 0.20 },
        { code: 'CA', share: 0.15 },
        { code: 'DE', share: 0.10 },
        { code: 'NL', share: 0.05 },
        { code: 'FR', share: 0.05 },
        { code: 'AU', share: 0.05 }
      ],
      baseSpend: [180, 140, 95, 120],
      convMultiplier: 3.8
    }
  };

  const config = storeConfigs[store] || storeConfigs.vironax;
  const data = [];
  const start = new Date(dateStart);
  const end = new Date(dateEnd);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];

    config.campaigns.forEach((camp, campIdx) => {
      for (const country of config.countries) {
        const baseSpend = config.baseSpend[campIdx];
        const variance = 0.8 + Math.random() * 0.4;
        const countrySpend = baseSpend * country.share * variance;

        data.push({
          date_start: dateStr,
          campaign_id: camp.id,
          campaign_name: camp.name,
          country: country.code,
          spend: countrySpend.toFixed(2),
          impressions: Math.floor(180000 * country.share * variance),
          reach: Math.floor(120000 * country.share * variance),
          clicks: Math.floor(2200 * country.share * variance),
          cpm: ((store === 'shawq' ? 8 : 3) + Math.random() * 2).toFixed(2),
          cpc: ((store === 'shawq' ? 0.65 : 0.22) + Math.random() * 0.15).toFixed(2),
          ctr: (1.1 + Math.random() * 0.4).toFixed(2),
          frequency: (1.4 + Math.random() * 0.3).toFixed(2),
          actions: [
            { action_type: 'landing_page_view', value: Math.floor(1800 * country.share * variance) },
            { action_type: 'add_to_cart', value: Math.floor(140 * country.share * variance) },
            { action_type: 'initiate_checkout', value: Math.floor(56 * country.share * variance) },
            { action_type: 'purchase', value: Math.floor(12 * country.share * variance) }
          ],
          action_values: [
            { action_type: 'purchase', value: (countrySpend * config.convMultiplier).toFixed(2) }
          ]
        });
      }
    });
  }

  return data;
}

// Demo data by age
function getDemoMetaDataByAge(store, dateStart, dateEnd) {
  const ages = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
  const ageShares = [0.12, 0.35, 0.28, 0.15, 0.07, 0.03];
  
  const campaigns = store === 'shawq' 
    ? [{ id: 'camp_s1', name: 'Palestinian Heritage Apparel' }, { id: 'camp_s2', name: 'Syrian Traditional Wear' }]
    : [{ id: 'camp_v1', name: 'Modern Gentleman - Rings' }, { id: 'camp_v2', name: 'Heritage Collection' }];
  
  const baseSpend = store === 'shawq' ? [180, 140] : [320, 220];
  const data = [];
  const start = new Date(dateStart);
  const end = new Date(dateEnd);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    campaigns.forEach((camp, campIdx) => {
      ages.forEach((age, ageIdx) => {
        const variance = 0.8 + Math.random() * 0.4;
        const ageSpend = baseSpend[campIdx] * ageShares[ageIdx] * variance;
        data.push({
          date_start: dateStr,
          campaign_id: camp.id,
          campaign_name: camp.name,
          age: age,
          spend: ageSpend.toFixed(2),
          impressions: Math.floor(50000 * ageShares[ageIdx] * variance),
          reach: Math.floor(35000 * ageShares[ageIdx] * variance),
          clicks: Math.floor(800 * ageShares[ageIdx] * variance),
          cpm: (8 + Math.random() * 2).toFixed(2),
          frequency: (1.4 + Math.random() * 0.3).toFixed(2),
          actions: [{ action_type: 'purchase', value: Math.floor(4 * ageShares[ageIdx] * variance) }],
          action_values: [{ action_type: 'purchase', value: (ageSpend * 4).toFixed(2) }]
        });
      });
    });
  }
  return data;
}

// Demo data by gender
function getDemoMetaDataByGender(store, dateStart, dateEnd) {
  const genders = store === 'vironax' 
    ? [{ code: 'male', share: 0.93 }, { code: 'female', share: 0.07 }]
    : [{ code: 'male', share: 0.45 }, { code: 'female', share: 0.55 }];
  
  const campaigns = store === 'shawq' 
    ? [{ id: 'camp_s1', name: 'Palestinian Heritage Apparel' }, { id: 'camp_s2', name: 'Syrian Traditional Wear' }]
    : [{ id: 'camp_v1', name: 'Modern Gentleman - Rings' }, { id: 'camp_v2', name: 'Heritage Collection' }];
  
  const baseSpend = store === 'shawq' ? [180, 140] : [320, 220];
  const data = [];
  const start = new Date(dateStart);
  const end = new Date(dateEnd);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    campaigns.forEach((camp, campIdx) => {
      genders.forEach((g) => {
        const variance = 0.8 + Math.random() * 0.4;
        const genderSpend = baseSpend[campIdx] * g.share * variance;
        data.push({
          date_start: dateStr,
          campaign_id: camp.id,
          campaign_name: camp.name,
          gender: g.code,
          spend: genderSpend.toFixed(2),
          impressions: Math.floor(100000 * g.share * variance),
          reach: Math.floor(70000 * g.share * variance),
          clicks: Math.floor(1500 * g.share * variance),
          cpm: (8 + Math.random() * 2).toFixed(2),
          frequency: (1.4 + Math.random() * 0.3).toFixed(2),
          actions: [{ action_type: 'purchase', value: Math.floor(8 * g.share * variance) }],
          action_values: [{ action_type: 'purchase', value: (genderSpend * 4).toFixed(2) }]
        });
      });
    });
  }
  return data;
}

// Demo data by placement
function getDemoMetaDataByPlacement(store, dateStart, dateEnd) {
  const placements = [
    { platform: 'facebook', position: 'feed', share: 0.35 },
    { platform: 'facebook', position: 'story', share: 0.10 },
    { platform: 'instagram', position: 'feed', share: 0.25 },
    { platform: 'instagram', position: 'story', share: 0.15 },
    { platform: 'instagram', position: 'reels', share: 0.10 },
    { platform: 'audience_network', position: 'all', share: 0.05 }
  ];
  
  const campaigns = store === 'shawq' 
    ? [{ id: 'camp_s1', name: 'Palestinian Heritage Apparel' }, { id: 'camp_s2', name: 'Syrian Traditional Wear' }]
    : [{ id: 'camp_v1', name: 'Modern Gentleman - Rings' }, { id: 'camp_v2', name: 'Heritage Collection' }];
  
  const baseSpend = store === 'shawq' ? [180, 140] : [320, 220];
  const data = [];
  const start = new Date(dateStart);
  const end = new Date(dateEnd);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    campaigns.forEach((camp, campIdx) => {
      placements.forEach((p) => {
        const variance = 0.8 + Math.random() * 0.4;
        const placementSpend = baseSpend[campIdx] * p.share * variance;
        data.push({
          date_start: dateStr,
          campaign_id: camp.id,
          campaign_name: camp.name,
          publisher_platform: p.platform,
          platform_position: p.position,
          spend: placementSpend.toFixed(2),
          impressions: Math.floor(80000 * p.share * variance),
          reach: Math.floor(55000 * p.share * variance),
          clicks: Math.floor(1200 * p.share * variance),
          cpm: (8 + Math.random() * 2).toFixed(2),
          frequency: (1.4 + Math.random() * 0.3).toFixed(2),
          actions: [{ action_type: 'purchase', value: Math.floor(6 * p.share * variance) }],
          action_values: [{ action_type: 'purchase', value: (placementSpend * 4).toFixed(2) }]
        });
      });
    });
  }
  return data;
}
