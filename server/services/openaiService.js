import OpenAI from 'openai';
import { getDb } from '../db/database.js';

// Import Meta Awareness feature module for reactivation data
import {
  getAIDataBundle,
  buildAIPromptSection,
  isReactivationQuestion,
  getReactivationCandidates as getFeatureReactivationCandidates,
  getAccountStructure as getFeatureAccountStructure
} from '../features/meta-awareness/index.js';

// OpenAI Service - GPT-5 + GPT-4 fallback
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODELS = {
  ASK: 'gpt-4o',           // Fast, direct answers - no fallback needed
  NANO: 'gpt-5-nano',
  MINI: 'gpt-5-mini',
  STRATEGIST: 'gpt-5.1'
};

const FALLBACK_MODELS = {
  NANO: 'gpt-4o-mini',
  MINI: 'gpt-4o',
  STRATEGIST: 'gpt-4o'
};

const TOKEN_LIMITS = {
  nano: 8000,
  mini: 16000,
  instant: 16000,
  fast: 32000,
  balanced: 64000,
  deep: 120000
};

const DEPTH_TO_EFFORT = {
  instant: 'none',
  fast: 'low',
  balanced: 'medium',
  deep: 'high'
};

// ============================================================================
// OPTIMIZED DATA FETCHING - Full hierarchy with funnel metrics (120k token support)
// ============================================================================

// Helper to calculate derived metrics
function calculateDerivedMetrics(row) {
  const spend = row.spend || 0;
  const impressions = row.impressions || 0;
  const reach = row.reach || 0;
  const inline_link_clicks = row.inline_link_clicks || 0;
  const lpv = row.lpv || 0;
  const atc = row.atc || 0;
  const checkout = row.checkout || 0;
  const conversions = row.conversions || 0;
  const conversion_value = row.conversion_value || 0;

  return {
    cpm: impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : null,
    ctr: impressions > 0 ? Math.round((inline_link_clicks / impressions) * 100 * 100) / 100 : null,
    cpc: inline_link_clicks > 0 ? Math.round((spend / inline_link_clicks) * 100) / 100 : null,
    roas: spend > 0 ? Math.round((conversion_value / spend) * 100) / 100 : null,
    cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : null,
    aov: conversions > 0 ? Math.round((conversion_value / conversions) * 100) / 100 : null,
    // Funnel conversion rates
    lpv_rate: inline_link_clicks > 0 ? Math.round((lpv / inline_link_clicks) * 100 * 100) / 100 : null,
    atc_rate: lpv > 0 ? Math.round((atc / lpv) * 100 * 100) / 100 : null,
    checkout_rate: atc > 0 ? Math.round((checkout / atc) * 100 * 100) / 100 : null,
    purchase_rate: checkout > 0 ? Math.round((conversions / checkout) * 100 * 100) / 100 : null,
    overall_cvr: lpv > 0 ? Math.round((conversions / lpv) * 100 * 100) / 100 : null
  };
}

function getStoreData(db, storeName, today, yesterday, periodStart, periodEnd) {
  const storeData = {};
  const activeFilter = `AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)`;

  try {
    // Get inception date (earliest data) for full historical context
    const inceptionResult = db.prepare(`
      SELECT MIN(date) as inception_date FROM meta_daily_metrics WHERE LOWER(store) = ?
    `).get(storeName);
    const inceptionDate = inceptionResult?.inception_date || periodStart;
    storeData.inceptionDate = inceptionDate;

    // Overview for selected period (ACTIVE only)
    storeData.periodOverview = db.prepare(`
      SELECT
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value
      FROM meta_daily_metrics
      WHERE LOWER(store) = ? AND date >= ? AND date <= ?
      ${activeFilter}
    `).get(storeName, periodStart, periodEnd || today);

    if (storeData.periodOverview) {
      Object.assign(storeData.periodOverview, calculateDerivedMetrics(storeData.periodOverview));
    }

    // Lifetime overview (since inception, ACTIVE only)
    storeData.lifetimeOverview = db.prepare(`
      SELECT
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value
      FROM meta_daily_metrics
      WHERE LOWER(store) = ?
      ${activeFilter}
    `).get(storeName);

    if (storeData.lifetimeOverview) {
      Object.assign(storeData.lifetimeOverview, calculateDerivedMetrics(storeData.lifetimeOverview));
    }

    // Today's metrics
    storeData.today = db.prepare(`
      SELECT
        SUM(spend) as spend, SUM(impressions) as impressions,
        SUM(inline_link_clicks) as inline_link_clicks, SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc, SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
      FROM meta_daily_metrics WHERE LOWER(store) = ? AND date = ?
      ${activeFilter}
    `).get(storeName, today);

    // Yesterday's metrics
    storeData.yesterday = db.prepare(`
      SELECT
        SUM(spend) as spend, SUM(impressions) as impressions,
        SUM(inline_link_clicks) as inline_link_clicks, SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc, SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions, SUM(conversion_value) as conversion_value
      FROM meta_daily_metrics WHERE LOWER(store) = ? AND date = ?
      ${activeFilter}
    `).get(storeName, yesterday);

    // ========================================================================
    // FULL HIERARCHY: Campaigns → Adsets → Ads (ACTIVE only, with full funnel)
    // ========================================================================

    // Get all ACTIVE campaigns with full funnel metrics (lifetime data)
    const campaigns = db.prepare(`
      SELECT
        campaign_id, campaign_name,
        MAX(effective_status) as status,
        MIN(date) as first_date,
        MAX(date) as last_date,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value
      FROM meta_daily_metrics
      WHERE LOWER(store) = ? AND campaign_name IS NOT NULL
      ${activeFilter}
      GROUP BY campaign_id
      ORDER BY spend DESC
    `).all(storeName);

    // Get all ACTIVE adsets with full funnel metrics (lifetime data)
    const adsets = db.prepare(`
      SELECT
        campaign_id, adset_id, adset_name,
        MAX(adset_effective_status) as adset_status,
        MIN(date) as first_date,
        MAX(date) as last_date,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value
      FROM meta_adset_metrics
      WHERE LOWER(store) = ? AND adset_name IS NOT NULL
      AND (adset_effective_status = 'ACTIVE' OR adset_effective_status = 'UNKNOWN' OR adset_effective_status IS NULL)
      GROUP BY adset_id
      ORDER BY spend DESC
    `).all(storeName);

    // Get all ACTIVE ads with full funnel metrics (lifetime data)
    const ads = db.prepare(`
      SELECT
        campaign_id, adset_id, ad_id, ad_name,
        MAX(ad_effective_status) as ad_status,
        MIN(date) as first_date,
        MAX(date) as last_date,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(reach) as reach,
        SUM(clicks) as clicks,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value
      FROM meta_ad_metrics
      WHERE LOWER(store) = ? AND ad_name IS NOT NULL
      AND (ad_effective_status = 'ACTIVE' OR ad_effective_status = 'UNKNOWN' OR ad_effective_status IS NULL)
      GROUP BY ad_id
      ORDER BY spend DESC
    `).all(storeName);

    // Build hierarchy: Group ads under adsets, adsets under campaigns
    const adsByAdset = new Map();
    ads.forEach(ad => {
      if (!adsByAdset.has(ad.adset_id)) adsByAdset.set(ad.adset_id, []);
      adsByAdset.get(ad.adset_id).push({
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        status: ad.ad_status,
        first_date: ad.first_date,
        last_date: ad.last_date,
        spend: ad.spend,
        impressions: ad.impressions,
        reach: ad.reach,
        clicks: ad.clicks,
        inline_link_clicks: ad.inline_link_clicks,
        lpv: ad.lpv,
        atc: ad.atc,
        checkout: ad.checkout,
        conversions: ad.conversions,
        conversion_value: ad.conversion_value,
        ...calculateDerivedMetrics(ad)
      });
    });

    const adsetsByCampaign = new Map();
    adsets.forEach(adset => {
      if (!adsetsByCampaign.has(adset.campaign_id)) adsetsByCampaign.set(adset.campaign_id, []);
      adsetsByCampaign.get(adset.campaign_id).push({
        adset_id: adset.adset_id,
        adset_name: adset.adset_name,
        status: adset.adset_status,
        first_date: adset.first_date,
        last_date: adset.last_date,
        spend: adset.spend,
        impressions: adset.impressions,
        reach: adset.reach,
        clicks: adset.clicks,
        inline_link_clicks: adset.inline_link_clicks,
        lpv: adset.lpv,
        atc: adset.atc,
        checkout: adset.checkout,
        conversions: adset.conversions,
        conversion_value: adset.conversion_value,
        ...calculateDerivedMetrics(adset),
        ads: adsByAdset.get(adset.adset_id) || []
      });
    });

    // Build full campaign hierarchy
    storeData.campaigns = campaigns.map(campaign => ({
      campaign_id: campaign.campaign_id,
      campaign_name: campaign.campaign_name,
      status: campaign.status,
      first_date: campaign.first_date,
      last_date: campaign.last_date,
      spend: campaign.spend,
      impressions: campaign.impressions,
      reach: campaign.reach,
      clicks: campaign.clicks,
      inline_link_clicks: campaign.inline_link_clicks,
      lpv: campaign.lpv,
      atc: campaign.atc,
      checkout: campaign.checkout,
      conversions: campaign.conversions,
      conversion_value: campaign.conversion_value,
      ...calculateDerivedMetrics(campaign),
      adsets: adsetsByCampaign.get(campaign.campaign_id) || []
    }));

    // Campaign performance by period (selected date range)
    storeData.campaignsByPeriod = db.prepare(`
      SELECT
        campaign_id, campaign_name,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value
      FROM meta_daily_metrics
      WHERE LOWER(store) = ? AND date >= ? AND date <= ? AND campaign_name IS NOT NULL
      ${activeFilter}
      GROUP BY campaign_id
      ORDER BY spend DESC
    `).all(storeName, periodStart, periodEnd || today).map(row => ({
      ...row,
      ...calculateDerivedMetrics(row)
    }));

    // Country breakdown for selected period
    storeData.countryBreakdown = db.prepare(`
      SELECT
        country,
        SUM(spend) as spend,
        SUM(impressions) as impressions,
        SUM(inline_link_clicks) as inline_link_clicks,
        SUM(landing_page_views) as lpv,
        SUM(add_to_cart) as atc,
        SUM(checkouts_initiated) as checkout,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value
      FROM meta_daily_metrics
      WHERE LOWER(store) = ? AND date >= ? AND date <= ?
      AND country IS NOT NULL AND country != '' AND country != 'ALL'
      ${activeFilter}
      GROUP BY country
      ORDER BY spend DESC
      LIMIT 20
    `).all(storeName, periodStart, periodEnd || today).map(row => ({
      ...row,
      ...calculateDerivedMetrics(row)
    }));

    // E-commerce orders
    const orderTable = storeName === 'vironax' ? 'salla_orders' : 'shopify_orders';
    try {
      storeData.ordersOverview = db.prepare(`
        SELECT COUNT(*) as totalOrders, SUM(order_total) as totalRevenue
        FROM ${orderTable} WHERE LOWER(store) = ? AND date >= ?
      `).get(storeName, periodStart);

      storeData.ordersToday = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue
        FROM ${orderTable} WHERE LOWER(store) = ? AND date = ?
      `).get(storeName, today);

      storeData.ordersYesterday = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue
        FROM ${orderTable} WHERE LOWER(store) = ? AND date = ?
      `).get(storeName, yesterday);

      storeData.ordersByCountry = db.prepare(`
        SELECT country_code, COUNT(*) as orders, SUM(order_total) as revenue
        FROM ${orderTable} WHERE LOWER(store) = ? AND date >= ?
        GROUP BY country_code ORDER BY orders DESC LIMIT 15
      `).all(storeName, periodStart);
    } catch (e) {}

    // Add account structure summary
    try {
      storeData.accountStructure = getAccountStructure(db, storeName);
    } catch (e) {
      console.error('[getStoreData] Account structure error:', e.message);
    }

  } catch (error) {
    console.error(`[getStoreData] Error for ${storeName}:`, error.message);
  }

  return storeData;
}

// ============================================================================
// ACCOUNT STRUCTURE - Summary of active/inactive objects
// Uses Meta Awareness feature module for consistent data
// ============================================================================
function getAccountStructure(db, storeName) {
  try {
    // Use the feature module for consistent account structure data
    return getFeatureAccountStructure(storeName);
  } catch (error) {
    console.error('[getAccountStructure] Error:', error.message);
    return null;
  }
}

// ============================================================================
// REACTIVATION CANDIDATES - Inactive objects with good historical performance
// Uses Meta Awareness feature module for consistent data and scoring
// ============================================================================
function getReactivationCandidates(db, storeName) {
  try {
    // Use the feature module for consistent reactivation candidates
    const candidates = getFeatureReactivationCandidates(storeName);

    // Return simplified version for AI consumption (top 5 each)
    return {
      campaigns: (candidates.campaigns || []).slice(0, 5).map(c => ({
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        status: c.effective_status,
        total_spend: c.total_spend,
        total_conversions: c.total_conversions,
        total_revenue: c.total_revenue,
        avg_roas: c.avg_roas,
        reactivation_score: c.reactivation_score,
        reason: c.reason,
        last_active_date: c.last_date
      })),
      adsets: (candidates.adsets || []).slice(0, 5).map(a => ({
        campaign_name: a.campaign_name,
        adset_id: a.adset_id,
        adset_name: a.adset_name,
        status: a.adset_effective_status,
        total_spend: a.total_spend,
        total_conversions: a.total_conversions,
        total_revenue: a.total_revenue,
        avg_roas: a.avg_roas,
        reactivation_score: a.reactivation_score,
        reason: a.reason,
        last_active_date: a.last_date
      })),
      ads: (candidates.ads || []).slice(0, 5).map(ad => ({
        campaign_name: ad.campaign_name,
        adset_name: ad.adset_name,
        ad_id: ad.ad_id,
        ad_name: ad.ad_name,
        status: ad.ad_effective_status,
        total_spend: ad.total_spend,
        total_conversions: ad.total_conversions,
        avg_roas: ad.avg_roas,
        reactivation_score: ad.reactivation_score,
        reason: ad.reason,
        last_active_date: ad.last_date
      })),
      summary: candidates.summary,
      note: candidates.note
    };
  } catch (error) {
    console.error('[getReactivationCandidates] Error:', error.message);
    return { campaigns: [], adsets: [], ads: [], summary: { total: 0 }, note: 'Error fetching reactivation candidates' };
  }
}

function getRelevantData(store, question, startDate = null, endDate = null) {
  const db = getDb();
  const q = question.toLowerCase();

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Use provided dates or default to 90 days if not provided (gives AI full context)
  const periodStart = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const periodEnd = endDate || today;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDate = new Date();

  const data = {
    dateContext: {
      today,
      todayDayName: dayNames[todayDate.getDay()],
      yesterday,
      yesterdayDayName: dayNames[new Date(Date.now() - 24 * 60 * 60 * 1000).getDay()],
      periodStart,
      periodEnd
    },
    currentStore: store.toLowerCase()
  };

  // Detect if question mentions the OTHER store
  const currentStore = store.toLowerCase();
  const mentionsVironax = q.includes('vironax') || q.includes('virona');
  const mentionsShawq = q.includes('shawq');
  const mentionsBoth = q.includes('both') || q.includes('compare') || q.includes('stores');

  // Detect if question is about reactivation or inactive items
  // Uses the feature module for consistent detection
  const mentionsReactivation = isReactivationQuestion(question);

  // Always fetch current store with full hierarchy and funnel data
  data[currentStore] = getStoreData(db, currentStore, today, yesterday, periodStart, periodEnd);

  // Include reactivation candidates if mentioned
  if (mentionsReactivation) {
    data.reactivationCandidates = getReactivationCandidates(db, currentStore);
  }

  // Only fetch other store if mentioned
  if (mentionsBoth || (currentStore === 'vironax' && mentionsShawq) || (currentStore === 'shawq' && mentionsVironax)) {
    const otherStore = currentStore === 'vironax' ? 'shawq' : 'vironax';
    data[otherStore] = getStoreData(db, otherStore, today, yesterday, periodStart, periodEnd);
  }

  // Clean up empty data
  return removeEmpty(data);
}

function removeEmpty(obj) {
  if (Array.isArray(obj)) {
    return obj.length > 0 ? obj : undefined;
  }
  if (obj && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      const cleanedValue = removeEmpty(value);
      if (cleanedValue !== undefined && cleanedValue !== null) {
        // Skip empty objects
        if (typeof cleanedValue === 'object' && !Array.isArray(cleanedValue) && Object.keys(cleanedValue).length === 0) {
          continue;
        }
        cleaned[key] = cleanedValue;
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }
  return obj;
}

// ============================================================================
// PILLAR FORMAT DETECTION
// ============================================================================

function getAnalyzeFormat(question) {
  const q = question.toLowerCase();
  
  if (q.includes('snapshot') || q.includes('overview') || q.includes('all key metrics')) {
    return `Respond using this EXACT format:

📊 **Key Metrics**
• Revenue: [amount with currency]
• ROAS: [X.Xx]
• Spend: [amount]
• Orders: [number]
• AOV: [amount]

📈 **Trend**
• vs Yesterday/Last Period: [↑↓ % for key metrics]

🏆 **Top Performer**
• [Best campaign or country with numbers]

💡 **Quick Take**
• [One-line actionable insight]`;
  }
  
  if (q.includes('compare') || q.includes('period') || q.includes('previous')) {
    return `Respond using this EXACT format:

📅 **This Period vs Last Period**
• Revenue: [this] vs [last] ([↑↓ %])
• ROAS: [this] vs [last] ([↑↓ %])
• Spend: [this] vs [last] ([↑↓ %])
• Orders: [this] vs [last] ([↑↓ %])

↑↓ **Key Changes**
• Improved: [what went up with %]
• Dropped: [what went down with %]

🔍 **Why**
• [Main drivers of change]

💡 **Implication**
• [What this means for the business]`;
  }
  
  if (q.includes('country') || q.includes('countries') || q.includes('geo') || q.includes('leaderboard')) {
    return `Respond using this EXACT format:

🥇🥈🥉 **Top Countries**
1. [Country]: [Revenue] | ROAS: [X.Xx]
2. [Country]: [Revenue] | ROAS: [X.Xx]
3. [Country]: [Revenue] | ROAS: [X.Xx]

📉 **Underperformers**
• [Countries with poor ROAS or high spend, low returns]

💰 **Opportunity**
• Scale: [where to increase]
• Cut: [where to decrease]

💡 **Action**
• [Specific geo recommendation]`;
  }
  
  if (q.includes('funnel') || q.includes('conversion')) {
    return `Respond using this EXACT format:

🎯 **Funnel Breakdown**
👀 Impressions → Clicks: [CTR %]
🖱️ Clicks → LPV: [Landing rate %]
🛒 LPV → ATC: [Add to cart rate %]
💳 ATC → Checkout: [Checkout rate %]
✅ Checkout → Purchase: [Purchase rate %]

🚨 **Biggest Leak**
• [Stage with biggest drop-off] - losing [X%] here

🔍 **Why**
• [Possible reasons for the leak]

💡 **Fix**
• [Specific recommendation to improve]`;
  }
  
  if (q.includes('spend') || q.includes('results') || q.includes('efficiency')) {
    return `Respond using this EXACT format:

💸 **Spend Overview**
• Total Spend: [amount]
• Revenue Generated: [amount]
• ROAS: [X.Xx]
• CPA: [amount per conversion]

⚖️ **Efficiency Verdict**
• [Efficient/Needs Work/Critical] - [brief explanation]

📊 **By Campaign**
• Best: [campaign] - [ROAS]
• Worst: [campaign] - [ROAS]

💡 **Optimize**
• [Specific recommendation to improve efficiency]`;
  }
  
  if (q.includes('anomal') || q.includes('unusual') || q.includes('weird') || q.includes('spike')) {
    return `Respond using this EXACT format:

🔍 **Anomaly Scan**

[If anomalies found:]
⚠️ **Anomalies Detected**
• [Metric]: [unusual value] (normally [expected range])
• [Metric]: [unusual value] (normally [expected range])

🔍 **Investigation**
• [Possible causes for each anomaly]

💡 **Action**
• [What to do about it]

[If no anomalies:]
✅ **All Clear**
• All metrics within normal ranges
• [Brief summary of current state]`;
  }
  
  if (q.includes('driver') || q.includes('working') || q.includes('top performer')) {
    return `Respond using this EXACT format:

🏆 **Top 3 Drivers**
1. [Campaign/Adset]: Spend [X] → Revenue [Y] | ROAS [Z]
2. [Campaign/Adset]: Spend [X] → Revenue [Y] | ROAS [Z]
3. [Campaign/Adset]: Spend [X] → Revenue [Y] | ROAS [Z]

📉 **Bottom 3 (Dragging Down)**
1. [Campaign/Adset]: Spend [X] → Revenue [Y] | ROAS [Z]
2. [Campaign/Adset]: Spend [X] → Revenue [Y] | ROAS [Z]
3. [Campaign/Adset]: Spend [X] → Revenue [Y] | ROAS [Z]

💡 **Focus**
• Double down on: [top performer]
• Fix or cut: [worst performer]`;
  }
  
  if (q.includes('creative') || q.includes('ad ') || q.includes('ads')) {
    return `Respond using this EXACT format:

🏆 **Top Performing Ads**
1. [Ad name]: CTR [X%] | ROAS [Y] | [conversions] conv
2. [Ad name]: CTR [X%] | ROAS [Y] | [conversions] conv
3. [Ad name]: CTR [X%] | ROAS [Y] | [conversions] conv

😴 **Fatigued/Declining**
• [Ads losing performance with trend]

🎨 **What's Working**
• [Creative patterns/themes performing well]

💡 **Creative Direction**
• [Recommendation for new creatives]`;
  }
  
  if (q.includes('reactivat') || q.includes('paused') || q.includes('archived') || q.includes('inactive')) {
    return `Respond using this EXACT format:

🔍 **Inactive Items Found**
• Campaigns: [X paused/archived]
• Ad Sets: [Y paused/archived]
• Ads: [Z paused/archived]

🏆 **Best Reactivation Candidates**
1. [Name] - Historical ROAS: [X.Xx] | Revenue: [Y] | Score: [Z/10]
2. [Name] - Historical ROAS: [X.Xx] | Revenue: [Y] | Score: [Z/10]
3. [Name] - Historical ROAS: [X.Xx] | Revenue: [Y] | Score: [Z/10]

💡 **Recommendation**
• Turn back on: [top candidates]
• Test budget: [suggested amount]
• Watch for: [success criteria]`;
  }
  
  // Default format
  return `Respond with a structured analysis using bullet points. Include specific numbers from the data. End with a clear recommendation.`;
}

function getDeepDiveFormat(question) {
  const q = question.toLowerCase();
  
  if (q.includes('scale') || q.includes('grow') || q.includes('increase') || q.includes('expand')) {
    return `Respond using this EXACT format:

📈 **Executive Summary**
[2-3 sentences on scaling opportunity]

🏆 **Scale Candidates**
1. [Campaign/Adset]: Current spend [X], ROAS [Y], Headroom [Z%]
2. [Campaign/Adset]: Current spend [X], ROAS [Y], Headroom [Z%]

💰 **Budget Recommendation**
• Add [amount] total, distributed as:
  - [Campaign 1]: +[amount]
  - [Campaign 2]: +[amount]
• Phase: Start with [X%] increase, then [Y%] after [Z] days

⚠️ **Watch Metrics**
• [Metrics to monitor while scaling]
• Red flag if: [warning signs]

⚡ **Next Steps**
1. [First action]
2. [Second action]
3. [Third action]`;
  }
  
  if (q.includes('cut') || q.includes('pause') || q.includes('stop') || q.includes('kill')) {
    return `Respond using this EXACT format:

📉 **Executive Summary**
[2-3 sentences on what's dragging performance]

🚫 **Cut List**
1. [Campaign/Adset/Ad]: Spend [X], ROAS [Y], Why: [reason]
2. [Campaign/Adset/Ad]: Spend [X], ROAS [Y], Why: [reason]
3. [Campaign/Adset/Ad]: Spend [X], ROAS [Y], Why: [reason]

💰 **Savings**
• Total budget freed: [amount]
• Expected ROAS improvement: [X%]

🔄 **Reallocate To**
• [Where to move the freed budget]

⚡ **Next Steps**
1. [First action]
2. [Second action]
3. [Third action]`;
  }
  
  if (q.includes('budget') || q.includes('allocat') || q.includes('realloc')) {
    return `Respond using this EXACT format:

📊 **Current Allocation**
• [Campaign/Country 1]: [amount] ([%]) - ROAS [X]
• [Campaign/Country 2]: [amount] ([%]) - ROAS [X]
• [Campaign/Country 3]: [amount] ([%]) - ROAS [X]

⚖️ **Efficiency Analysis**
• Most efficient: [where ROAS is highest]
• Least efficient: [where ROAS is lowest]

🔄 **Recommended Shifts**
• Move [amount] from [A] to [B]
• Move [amount] from [C] to [D]

💰 **New Allocation**
• [Campaign/Country 1]: [new amount] ([%])
• [Campaign/Country 2]: [new amount] ([%])

📈 **Expected Impact**
• Projected ROAS improvement: [X%]
• Projected revenue increase: [amount]

⚡ **Next Steps**
1. [First action]
2. [Second action]`;
  }
  
  if (q.includes('structure') || q.includes('reorganize') || q.includes('campaign structure')) {
    return `Respond using this EXACT format:

🏗️ **Current Structure**
• [How campaigns are currently organized]
• Total: [X] campaigns, [Y] ad sets, [Z] ads

⚠️ **Issues Found**
• [Issue 1: overlap, fragmentation, etc.]
• [Issue 2]

🎯 **Recommended Structure**
• [Proposed organization]
• [Naming convention suggestion]

📋 **Migration Plan**
1. [Step 1]
2. [Step 2]
3. [Step 3]

⚡ **Next Steps**
1. [Priority action]
2. [Second action]`;
  }
  
  if (q.includes('creative') || q.includes('roadmap') || q.includes('ad strategy')) {
    return `Respond using this EXACT format:

🏆 **Top Performers**
• [Ad/Creative 1]: Why it works - [insight]
• [Ad/Creative 2]: Why it works - [insight]

😴 **Fatigued Creatives**
• [Ads that need refreshing]

🎨 **Creative Gaps**
• Missing: [types of creatives not being tested]

📋 **Production List**
1. [HIGH PRIORITY] [Creative concept 1]
2. [MEDIUM] [Creative concept 2]
3. [MEDIUM] [Creative concept 3]

🧪 **Test Ideas**
• [Variation ideas to try]

⚡ **Next Steps**
1. [First creative to produce]
2. [Tests to launch]`;
  }
  
  if (q.includes('audience') || q.includes('targeting') || q.includes('lookalike')) {
    return `Respond using this EXACT format:

👥 **Current Audiences**
• [List of audiences being targeted]

🏆 **Best Performers**
1. [Audience]: ROAS [X], Conv rate [Y%]
2. [Audience]: ROAS [X], Conv rate [Y%]

📉 **Underperformers**
• [Audiences to cut or refine]

🆕 **Expansion Ideas**
• [New audiences to test]

🎯 **Lookalike Strategy**
• [LAL recommendations based on best converters]

⚡ **Next Steps**
1. [First audience action]
2. [Second action]`;
  }
  
  if (q.includes('test') || q.includes('experiment') || q.includes('try')) {
    return `Respond using this EXACT format:

📊 **Current State**
• [What we know from the data]

❓ **Knowledge Gaps**
• [What we need to learn]

🧪 **Test Queue**
1. [HIGH PRIORITY] [Test A]
   - Hypothesis: [what we expect]
   - Success metric: [how to measure]
   - Budget: [amount]

2. [MEDIUM] [Test B]
   - Hypothesis: [what we expect]
   - Success metric: [how to measure]
   - Budget: [amount]

⚡ **Next Steps**
1. Launch [first test]
2. Run for [duration]
3. Evaluate and iterate`;
  }
  
  if (q.includes('risk') || q.includes('efficiency') || q.includes('health')) {
    return `Respond using this EXACT format:

✅ **What's Healthy**
• [Strong areas in the account]

⚠️ **Risk Areas**
• [Concentration risk, fatigue, dependency issues]

📉 **Inefficiencies**
• [Wasted spend, overlap, etc.]

🛡️ **Mitigation Plan**
• [How to reduce each risk]

📊 **Quick Efficiency Wins**
1. [Win 1 with expected savings]
2. [Win 2 with expected savings]

⚡ **Next Steps**
1. [Priority fix]
2. [Second fix]`;
  }
  
  if (q.includes('reactivat') || q.includes('turn back on') || q.includes('paused') || q.includes('reviv')) {
    return `Respond using this EXACT format:

🔍 **Candidates Found**
• [X] campaigns, [Y] ad sets, [Z] ads eligible

🏆 **Priority Reactivations** (by score)
1. [Name] - Score: [X/10]
   - Historical: ROAS [X], Revenue [Y]
   - Why paused: [reason if known]
   - Test budget: [amount]

2. [Name] - Score: [X/10]
   - Historical: ROAS [X], Revenue [Y]
   - Test budget: [amount]

📋 **Reactivation Schedule**
• Week 1: Reactivate [top 1-2]
• Week 2: Evaluate and add [next batch]

👀 **Success Criteria**
• Day 1-3: [what to watch]
• Day 4-7: [decision point]

⚡ **Next Steps**
1. [First reactivation action]
2. [Monitoring setup]
3. [Evaluation checkpoint]`;
  }
  
  // Default strategic format
  return `Respond with:
📈 **Executive Summary** (2-3 sentences)
📊 **Analysis** (key findings with numbers)
🎯 **Recommendations** (numbered, prioritized)
⚡ **Next Steps** (1-2-3 actions)`;
}

// ============================================================================
// PROMPT BUILDING
// ============================================================================

function buildSystemPrompt(store, mode, data, question = '') {
  const hasOtherStore = data.vironax && data.shawq;
  const hasReactivationData = data.reactivationCandidates &&
    ((data.reactivationCandidates.campaigns?.length > 0) ||
     (data.reactivationCandidates.adsets?.length > 0) ||
     (data.reactivationCandidates.ads?.length > 0) ||
     (data.reactivationCandidates.summary?.total > 0));

  let storeInfo = '';
  if (hasOtherStore) {
    storeInfo = `You have data for BOTH stores:
- VironaX (Saudi Arabia, SAR, mens jewelry, Salla)
- Shawq (Turkey/US, USD, apparel, Shopify)`;
  } else {
    const s = store.toLowerCase();
    storeInfo = s === 'vironax'
      ? 'Store: VironaX (Saudi Arabia, SAR currency, mens jewelry, Salla)'
      : 'Store: Shawq (Turkey/US, USD currency, apparel, Shopify)';
  }

  // Account structure context - use feature module for consistent formatting
  let structureInfo = '';
  const storeData = data[store.toLowerCase()];
  if (storeData?.accountStructure) {
    const s = storeData.accountStructure;
    const totalPaused = (s.campaigns?.paused || 0) + (s.adsets?.paused || 0) + (s.ads?.paused || 0);
    const totalArchived = (s.campaigns?.archived || 0) + (s.adsets?.archived || 0) + (s.ads?.archived || 0);
    structureInfo = `
ACCOUNT STRUCTURE:
- Campaigns: ${s.campaigns?.active || 0} active, ${s.campaigns?.paused || 0} paused, ${s.campaigns?.archived || 0} archived
- Ad Sets: ${s.adsets?.active || 0} active, ${s.adsets?.paused || 0} paused, ${s.adsets?.archived || 0} archived
- Ads: ${s.ads?.active || 0} active, ${s.ads?.paused || 0} paused, ${s.ads?.archived || 0} archived
- Total inactive objects: ${totalPaused + totalArchived} (${totalPaused} paused, ${totalArchived} archived)`;
  }

  // Reactivation context - enhanced with scoring information
  let reactivationInfo = '';
  if (hasReactivationData) {
    const rc = data.reactivationCandidates;
    const topScore = rc.summary?.topScore || Math.max(
      ...(rc.campaigns || []).map(c => c.reactivation_score || 0),
      ...(rc.adsets || []).map(a => a.reactivation_score || 0),
      ...(rc.ads || []).map(ad => ad.reactivation_score || 0),
      0
    );
    reactivationInfo = `
REACTIVATION CANDIDATES (${rc.summary?.total || ((rc.campaigns?.length || 0) + (rc.adsets?.length || 0) + (rc.ads?.length || 0))} found):
The data includes inactive (paused/archived) objects that performed well historically.
Each candidate has a reactivation_score (0-10) where higher = better candidate.
- Scores 7+ = Strong candidates (excellent historical ROAS, good volume, recent activity)
- Scores 4-7 = Moderate candidates (good performance, may need testing)
- Scores <4 = Weak candidates (consider carefully before reactivating)
Top reactivation score: ${(topScore || 0).toFixed(1)}

When asked about reactivation opportunities:
1. Recommend candidates with highest scores first
2. Explain the 'reason' field which summarizes why each is a candidate
3. Suggest starting with 1-2 highest scorers for testing
4. Note that reactivation requires manual action in Meta Ads Manager
5. Recommend setting conservative budgets initially`;
  }

  // Data structure context for the AI
  const dataStructureInfo = `
DATA STRUCTURE:
- periodOverview: Metrics for selected date range (${data.dateContext?.periodStart} to ${data.dateContext?.periodEnd})
- lifetimeOverview: All-time metrics since inception (${storeData?.inceptionDate || 'unknown'})
- campaigns: Full hierarchy with ACTIVE campaigns → adsets → ads (lifetime data)
  Each level includes: spend, impressions, reach, clicks, inline_link_clicks, lpv, atc, checkout, conversions, conversion_value
  Plus derived metrics: cpm, ctr, cpc, roas, cpa, aov, lpv_rate, atc_rate, checkout_rate, purchase_rate, overall_cvr
- campaignsByPeriod: Campaign metrics for selected date range only
- countryBreakdown: Performance by country for selected period

FUNNEL METRICS EXPLAINED:
- lpv_rate: Landing Page View rate (lpv / clicks)
- atc_rate: Add to Cart rate (atc / lpv)
- checkout_rate: Checkout initiated rate (checkout / atc)
- purchase_rate: Purchase rate (conversions / checkout)
- overall_cvr: Overall conversion rate (conversions / lpv)`;

  // Currency symbol for formatting
  const currencySymbol = store.toLowerCase() === 'vironax' ? 'SAR' : '$';

  const basePrompt = `You are an expert e-commerce growth analyst and trusted advisor with access to FULL campaign hierarchy and funnel data.
${storeInfo}
${structureInfo}
${dataStructureInfo}

TODAY: ${data.dateContext?.today} (${data.dateContext?.todayDayName})
YESTERDAY: ${data.dateContext?.yesterday} (${data.dateContext?.yesterdayDayName})
ANALYSIS PERIOD: ${data.dateContext?.periodStart} to ${data.dateContext?.periodEnd}
${reactivationInfo}

DATA:
${JSON.stringify(data, null, 2)}

FORMATTING RULES:
- Use ONLY this data, never invent numbers
- VironaX = SAR, Shawq = USD (always include currency: "${currencySymbol}1,234" format)
- Format large numbers with commas (1,234,567)
- Round percentages to 1 decimal (12.5%)
- Round currency to whole numbers unless under 10
- ROAS = revenue/spend (show as "2.5x" format)
- Be specific with real figures from the data
- The data shows ACTIVE campaigns with full hierarchy (campaigns → adsets → ads)
- You have LIFETIME data (since inception) AND period-specific data
- Analyze funnel metrics (lpv_rate, atc_rate, checkout_rate, purchase_rate) to identify drop-offs
- If asked about inactive/paused items, refer to reactivationCandidates data if available

MARKDOWN FORMATTING:
- Use **bold** for key metrics, important numbers, and emphasis
- Use *italic* for context, explanations, or secondary info
- Use --- for horizontal dividers between major sections
- Use | table | format for comparisons when helpful
- Use emoji headers (📊 🎯 💡 ⚡) for visual structure

RESPONSE STYLE:
- Be direct and confident - you're a trusted growth advisor
- Lead with the key insight or answer first
- Use clear structure with line breaks between sections
- Use bullet points (•) for lists, not dashes
- If comparing, show the delta/change (↑ or ↓ with %)
- End with a clear takeaway or recommended action when relevant`;

  // Mode-specific instructions
  if (mode === 'analyze') {
    return basePrompt + `

MODE: ASK (Quick Facts)
Answer in 2-3 sentences maximum. Be punchy and direct.
• Lead with the exact number or fact requested
• Add brief context if helpful (comparison to yesterday, benchmark, etc.)
• No fluff, no caveats - just the answer

Example format:
"Total revenue is ${currencySymbol}45,230 for this period. That's ↑23% vs last period, driven mainly by Saudi Arabia."`;
  }
  
  if (mode === 'summarize') {
    return basePrompt + `

MODE: ANALYZE (Insights & Trends)
${getAnalyzeFormat(question)}`;
  }
  
  // Deep Dive / Strategic mode
  return basePrompt + `

MODE: DEEP DIVE (Strategic Analysis)
${getDeepDiveFormat(question)}`;
}

// ============================================================================
// API CALLS - GPT-5 Responses API + GPT-4 fallback
// ============================================================================

async function callResponsesAPI(model, systemPrompt, userMessage, maxTokens, reasoningEffort = null) {
  const requestBody = {
    model,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_output_tokens: maxTokens
  };

  if (reasoningEffort && model.includes('5.1')) {
    requestBody.reasoning = { effort: reasoningEffort };
  }

  console.log(`[OpenAI] Calling ${model} (max_tokens: ${maxTokens})`);
  const response = await client.responses.create(requestBody);
  return response.output_text;
}

async function callChatCompletionsAPI(model, systemPrompt, userMessage, maxTokens, temperature = 0.7) {
  console.log(`[OpenAI] Fallback to ${model} (max_tokens: ${maxTokens}, temp: ${temperature})`);
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: maxTokens,
    temperature
  });
  return response.choices[0].message.content;
}

async function callWithFallback(primary, fallback, systemPrompt, userMessage, maxTokens, reasoningEffort = null, temperature = 0.7) {
  try {
    const text = await callResponsesAPI(primary, systemPrompt, userMessage, maxTokens, reasoningEffort);
    return { text, model: primary };
  } catch (error) {
    console.log(`[OpenAI] ${primary} failed: ${error.message}, trying ${fallback}`);
    const text = await callChatCompletionsAPI(fallback, systemPrompt, userMessage, maxTokens, temperature);
    return { text, model: fallback };
  }
}

// ============================================================================
// STREAMING - For real-time responses
// ============================================================================

async function streamWithFallback(primary, fallback, systemPrompt, userMessage, maxTokens, reasoningEffort, onDelta, temperature = 0.7) {
  try {
    const requestBody = {
      model: primary,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_output_tokens: maxTokens,
      stream: true
    };

    if (reasoningEffort && primary.includes('5.1')) {
      requestBody.reasoning = { effort: reasoningEffort };
    }

    console.log(`[OpenAI] Streaming ${primary}`);
    const stream = await client.responses.create(requestBody);

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        onDelta(event.delta);
      }
    }

    return { model: primary, reasoning: reasoningEffort };
  } catch (error) {
    console.log(`[OpenAI] Stream ${primary} failed: ${error.message}, trying ${fallback}`);

    const response = await client.chat.completions.create({
      model: fallback,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: maxTokens,
      temperature,
      stream: true
    });

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) onDelta(delta);
    }

    return { model: fallback, reasoning: null };
  }
}

// ============================================================================
// EXPORTS - Analyze, Summarize, Decide
// ============================================================================

// Temperature settings per mode:
// - analyze (quick facts): 0.3 for consistent, factual answers
// - summarize (trends): 0.5 for balanced analysis  
// - decide (strategic): 0.7 for creative recommendations
const MODE_TEMPERATURES = {
  analyze: 0.3,
  summarize: 0.5,
  decide: 0.7
};

export async function analyzeQuestion(question, store, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'analyze', data, question);
  
  // Use GPT-4o directly for Ask mode - faster and more reliable
  const text = await callChatCompletionsAPI(MODELS.ASK, systemPrompt, question, TOKEN_LIMITS.nano, MODE_TEMPERATURES.analyze);
  return { text, model: MODELS.ASK };
}

export async function summarizeData(question, store, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'summarize', data, question);
  return await callWithFallback(MODELS.MINI, FALLBACK_MODELS.MINI, systemPrompt, question, TOKEN_LIMITS.mini, null, MODE_TEMPERATURES.summarize);
}

export async function decideQuestion(question, store, depth = 'balanced', history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'decide', data, question);
  const effort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;

  const result = await callWithFallback(MODELS.STRATEGIST, FALLBACK_MODELS.STRATEGIST, systemPrompt, question, maxTokens, effort, MODE_TEMPERATURES.decide);
  return { ...result, reasoning: effort };
}

export async function decideQuestionStream(question, store, depth = 'balanced', onDelta, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'decide', data, question);
  const effort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;

  return await streamWithFallback(MODELS.STRATEGIST, FALLBACK_MODELS.STRATEGIST, systemPrompt, question, maxTokens, effort, onDelta, MODE_TEMPERATURES.decide);
}

// Streaming versions for Analyze and Summarize
export async function analyzeQuestionStream(question, store, onDelta, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'analyze', data, question);
  
  // Use GPT-4o directly for Ask mode - faster streaming
  console.log(`[OpenAI] Streaming ${MODELS.ASK} for Ask mode`);
  const response = await client.chat.completions.create({
    model: MODELS.ASK,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question }
    ],
    max_tokens: TOKEN_LIMITS.nano,
    temperature: MODE_TEMPERATURES.analyze,
    stream: true
  });

  for await (const chunk of response) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) onDelta(delta);
  }

  return { model: MODELS.ASK, reasoning: null };
}

export async function summarizeDataStream(question, store, onDelta, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'summarize', data, question);
  return await streamWithFallback(MODELS.MINI, FALLBACK_MODELS.MINI, systemPrompt, question, TOKEN_LIMITS.mini, null, onDelta, MODE_TEMPERATURES.summarize);
}

// ============================================================================
// DAILY SUMMARY - AM/PM Reports
// ============================================================================

export async function dailySummary(reportType = 'am') {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const data = {
    reportType,
    generatedAt: new Date().toISOString(),
    vironax: getStoreData(db, 'vironax', today, yesterday, last7Days, today),
    shawq: getStoreData(db, 'shawq', today, yesterday, last7Days, today)
  };

  // Include reactivation candidates in daily reports
  data.vironaxReactivation = getReactivationCandidates(db, 'vironax');
  data.shawqReactivation = getReactivationCandidates(db, 'shawq');

  const systemPrompt = `You are a Growth Scientist analyzing both Virona and Shawq stores.
Generate a ${reportType.toUpperCase()} report with actionable insights.

The data includes:
1. Full campaign hierarchy (campaigns → adsets → ads) with funnel metrics
2. Lifetime and period performance data with inception dates
3. Account structure (active/paused/archived counts)
4. Reactivation candidates - paused/archived items with good historical performance

If there are promising reactivation candidates, include a "Reactivation Opportunities" section.`;

  const userPrompt = `${reportType.toUpperCase()} Report for ${today}\n\nDATA:\n${JSON.stringify(data, null, 2)}`;

  return await callWithFallback(MODELS.STRATEGIST, FALLBACK_MODELS.STRATEGIST, systemPrompt, userPrompt, TOKEN_LIMITS.deep, 'high');
}

export async function dailySummaryStream(reportType = 'am', onDelta) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const data = {
    reportType,
    generatedAt: new Date().toISOString(),
    vironax: getStoreData(db, 'vironax', today, yesterday, last7Days, today),
    shawq: getStoreData(db, 'shawq', today, yesterday, last7Days, today)
  };

  // Include reactivation candidates in daily reports
  data.vironaxReactivation = getReactivationCandidates(db, 'vironax');
  data.shawqReactivation = getReactivationCandidates(db, 'shawq');

  const systemPrompt = `You are a Growth Scientist analyzing both Virona and Shawq stores.
Generate a ${reportType.toUpperCase()} report with actionable insights.

The data includes:
1. Full campaign hierarchy (campaigns → adsets → ads) with funnel metrics
2. Lifetime and period performance data with inception dates
3. Account structure (active/paused/archived counts)
4. Reactivation candidates - paused/archived items with good historical performance

If there are promising reactivation candidates, include a "Reactivation Opportunities" section.`;

  const userPrompt = `${reportType.toUpperCase()} Report for ${today}\n\nDATA:\n${JSON.stringify(data, null, 2)}`;

  return await streamWithFallback(MODELS.STRATEGIST, FALLBACK_MODELS.STRATEGIST, systemPrompt, userPrompt, TOKEN_LIMITS.deep, 'high', onDelta);
}

// ============================================================================
// EXPLORE MODE - Visual data explorer with GPT-4o-mini for query interpretation
// Uses the SAME data pathways as other AI modes for consistent data access
// ============================================================================

/**
 * Build dynamic explore prompt with store context
 * This gives GPT-4o-mini intelligence about the actual data
 */
function buildExploreSystemPrompt(storeContext = {}) {
  const { storeName, currency, topCountries, topCampaigns, dateRange } = storeContext;

  return `You are an intelligent e-commerce data visualization assistant for ${storeName || 'an online store'}.
Your job is to deeply understand what the user wants to see and translate it into a precise chart specification.

ABOUT THIS STORE:
- Currency: ${currency || 'USD'}
- Top performing countries: ${topCountries?.join(', ') || 'Various'}
- Active campaigns: ${topCampaigns?.length || 'Multiple'} campaigns running
- Data available from: ${dateRange?.start || 'last 90 days'}

AVAILABLE METRICS (what to measure):
- revenue: Total sales value (conversion_value) - use for money questions
- orders: Number of purchases (conversions) - use for volume questions
- spend: Ad spend amount - use for cost/investment questions
- impressions: How many times ads were shown - use for reach/visibility
- clicks: Link clicks to website - use for engagement
- roas: Return on ad spend (revenue/spend) - use for efficiency/ROI questions
- aov: Average order value (revenue/orders) - use for basket size questions
- conversion_rate: Purchases per click (%) - use for funnel efficiency
- add_to_cart: Cart additions - use for shopping behavior

AVAILABLE DIMENSIONS (how to break it down):
- date: Time series (days) - use for trends, patterns over time
- country: Geographic breakdown - use for regional analysis
- campaign_name: By marketing campaign - use for campaign performance
- adset_name: By ad set - use for audience/targeting analysis
- platform: Facebook vs Instagram etc - use for channel analysis
- age: Age demographics - use for audience insights
- gender: Gender demographics - use for audience insights

CHART TYPES:
- line: Best for trends over time, showing change/patterns
- bar: Best for comparing categories, rankings, breakdowns
- area: Best for cumulative/stacked trends, showing volume over time
- pie: Best for share of total, proportion analysis (limit 6 segments)

COMPARISON CHARTS (overlay multiple metrics):
You can compare up to 3 metrics on the same chart when it makes sense:
- "revenue vs spend over time" → overlay revenue and spend lines
- "compare orders and impressions" → dual axis comparison
- "show spend, revenue, and ROAS trend" → multi-metric overlay

UNDERSTANDING USER INTENT:
Parse natural language intelligently:
- "how are we doing" → revenue trend (default health check)
- "what's working" → revenue by campaign (find winners)
- "where's the money coming from" → revenue by country
- "am I profitable" → ROAS trend or by campaign
- "show me everything" → revenue trend with spend overlay
- "compare X and Y" → overlay chart with both metrics
- "X vs Y" → comparison chart
- "break down by" / "split by" → categorical breakdown
- "over time" / "trend" / "daily" → time series (date dimension)
- "top" / "best" / "worst" → categorical ranking
- "efficiency" / "ROI" / "return" → ROAS metric
- "growth" / "change" → implies time series comparison

SMART DEFAULTS:
- No time mentioned? Default to 30 days for trends, 14 days for comparisons
- Vague question? Start with revenue (the metric that matters most)
- "Performance"? Usually means ROAS or revenue
- "Results"? Usually means orders or revenue
- "Cost"? Usually means spend or CPA

OUTPUT FORMAT:
{
  "success": true,
  "spec": {
    "title": "Human readable, specific title",
    "metrics": ["primary_metric", "optional_second", "optional_third"],
    "dimension": "dimension_key",
    "chartType": "line|bar|area|pie",
    "dateRange": "7d|14d|30d",
    "autoReason": "Why this visualization answers the user's question",
    "insight": "One sentence about what to look for in this chart"
  }
}

For simple single-metric charts, metrics array has one element.
For comparison/overlay charts, include 2-3 metrics.

ERROR RESPONSE (only if truly impossible):
{
  "success": false,
  "error": "Friendly explanation + suggestion for what they could ask instead"
}

IMPORTANT: Be smart. Interpret intent, don't just match keywords. The user is a busy marketer who wants answers, not technical precision.

Always respond with valid JSON matching the OUTPUT FORMAT above.`;
}

// Keep backward compatible single prompt for simple cases
const EXPLORE_SYSTEM_PROMPT = buildExploreSystemPrompt({});

// Metric to database column mapping
const METRIC_TO_COLUMN = {
  revenue: 'conversion_value',
  orders: 'conversions',
  spend: 'spend',
  impressions: 'impressions',
  clicks: 'inline_link_clicks',
  add_to_cart: 'add_to_cart',
  roas: null, // calculated
  aov: null,  // calculated
  conversion_rate: null // calculated
};

// Dimension to database column mapping
const DIMENSION_TO_COLUMN = {
  date: 'date',
  country: 'country',
  campaign_name: 'campaign_name',
  adset_name: 'adset_name',
  platform: 'publisher_platform',
  age: 'age',
  gender: 'gender'
};

/**
 * Get store context for smarter AI interpretation
 * Provides GPT with knowledge about the store's actual data
 */
function getStoreContextForExplore(db, storeName) {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    // Get top countries
    const topCountries = db.prepare(`
      SELECT country, SUM(conversion_value) as revenue
      FROM meta_daily_metrics
      WHERE LOWER(store) = ? AND date >= ? AND country IS NOT NULL AND country != '' AND country != 'ALL'
      GROUP BY country ORDER BY revenue DESC LIMIT 5
    `).all(storeName, thirtyDaysAgo).map(r => r.country);

    // Get active campaigns
    const topCampaigns = db.prepare(`
      SELECT campaign_name, SUM(conversion_value) as revenue
      FROM meta_daily_metrics
      WHERE LOWER(store) = ? AND date >= ? AND campaign_name IS NOT NULL
      AND (effective_status = 'ACTIVE' OR effective_status IS NULL)
      GROUP BY campaign_name ORDER BY revenue DESC LIMIT 10
    `).all(storeName, thirtyDaysAgo).map(r => r.campaign_name);

    // Get date range
    const dateRangeResult = db.prepare(`
      SELECT MIN(date) as start, MAX(date) as end
      FROM meta_daily_metrics WHERE LOWER(store) = ?
    `).get(storeName);

    return {
      storeName: storeName === 'vironax' ? 'VironaX (Saudi jewelry)' : 'Shawq (Palestinian apparel)',
      currency: storeName === 'vironax' ? 'SAR' : 'USD',
      topCountries,
      topCampaigns,
      dateRange: dateRangeResult
    };
  } catch (e) {
    return {
      storeName: storeName === 'vironax' ? 'VironaX' : 'Shawq',
      currency: storeName === 'vironax' ? 'SAR' : 'USD'
    };
  }
}

/**
 * Fetch chart data from database using the SAME tables as getStoreData
 * Supports multiple metrics for overlay/comparison charts
 */
function fetchExploreChartData(db, storeName, spec, startDate, endDate) {
  // Support both single metric and array of metrics
  const metrics = Array.isArray(spec.metrics) ? spec.metrics : [spec.metric || spec.metrics];
  const { dimension, dateRange } = spec;

  // Calculate date range
  const today = new Date();
  let periodStart = startDate;
  let periodEnd = endDate || today.toISOString().split('T')[0];

  if (!periodStart) {
    const daysBack = dateRange === '7d' ? 7 : dateRange === '14d' ? 14 : 30;
    periodStart = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  }

  const dimensionColumn = DIMENSION_TO_COLUMN[dimension] || dimension;
  const activeFilter = `AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)`;

  let data = [];
  let totals = {};

  // Helper to get SQL expression for a metric
  const getMetricSQL = (metric) => {
    switch (metric) {
      case 'roas':
        return 'ROUND(CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END, 2)';
      case 'aov':
        return 'ROUND(CASE WHEN SUM(conversions) > 0 THEN SUM(conversion_value) / SUM(conversions) ELSE 0 END, 2)';
      case 'conversion_rate':
        return 'ROUND(CASE WHEN SUM(inline_link_clicks) > 0 THEN SUM(conversions) * 100.0 / SUM(inline_link_clicks) ELSE 0 END, 2)';
      default:
        const col = METRIC_TO_COLUMN[metric];
        return col ? `SUM(${col})` : 'SUM(conversion_value)';
    }
  };

  try {
    if (dimension === 'date') {
      // Time series query - supports multiple metrics for overlay
      if (metrics.length === 1) {
        // Single metric - simple query
        const metricSQL = getMetricSQL(metrics[0]);
        const rows = db.prepare(`
          SELECT date, ${metricSQL} as value
          FROM meta_daily_metrics
          WHERE LOWER(store) = ? AND date >= ? AND date <= ?
          ${activeFilter}
          GROUP BY date
          ORDER BY date ASC
        `).all(storeName, periodStart, periodEnd);
        data = rows;
        totals[metrics[0]] = rows.reduce((sum, r) => sum + (r.value || 0), 0);
      } else {
        // Multiple metrics - overlay chart
        const metricSelects = metrics.map((m, i) => `${getMetricSQL(m)} as value${i}`).join(', ');
        const rows = db.prepare(`
          SELECT date, ${metricSelects}
          FROM meta_daily_metrics
          WHERE LOWER(store) = ? AND date >= ? AND date <= ?
          ${activeFilter}
          GROUP BY date
          ORDER BY date ASC
        `).all(storeName, periodStart, periodEnd);

        // Transform to multi-series format
        data = rows.map(row => {
          const point = { date: row.date };
          metrics.forEach((m, i) => {
            point[m] = row[`value${i}`] || 0;
          });
          return point;
        });

        // Calculate totals for each metric
        metrics.forEach((m, i) => {
          totals[m] = rows.reduce((sum, r) => sum + (r[`value${i}`] || 0), 0);
        });
      }
    } else {
      // Categorical query - supports multiple metrics for grouped comparison
      if (metrics.length === 1) {
        // Single metric - simple query
        const primaryMetric = metrics[0];
        const metricSQL = getMetricSQL(primaryMetric);

        const rows = db.prepare(`
          SELECT ${dimensionColumn} as category, ${metricSQL} as value
          FROM meta_daily_metrics
          WHERE LOWER(store) = ? AND date >= ? AND date <= ?
          AND ${dimensionColumn} IS NOT NULL AND ${dimensionColumn} != '' AND ${dimensionColumn} != 'ALL'
          ${activeFilter}
          GROUP BY ${dimensionColumn}
          ORDER BY value DESC
          LIMIT 10
        `).all(storeName, periodStart, periodEnd);

        data = rows;
        totals[primaryMetric] = rows.reduce((sum, r) => sum + (r.value || 0), 0);
      } else {
        // Multiple metrics - grouped bar chart for comparison
        const metricSelects = metrics.map((m, i) => `${getMetricSQL(m)} as value${i}`).join(', ');

        const rows = db.prepare(`
          SELECT ${dimensionColumn} as category, ${metricSelects}
          FROM meta_daily_metrics
          WHERE LOWER(store) = ? AND date >= ? AND date <= ?
          AND ${dimensionColumn} IS NOT NULL AND ${dimensionColumn} != '' AND ${dimensionColumn} != 'ALL'
          ${activeFilter}
          GROUP BY ${dimensionColumn}
          ORDER BY value0 DESC
          LIMIT 10
        `).all(storeName, periodStart, periodEnd);

        // Transform to multi-series format for grouped bar chart
        data = rows.map(row => {
          const point = { category: row.category };
          metrics.forEach((m, i) => {
            point[m] = row[`value${i}`] || 0;
          });
          return point;
        });

        // Calculate totals for each metric
        metrics.forEach((m, i) => {
          totals[m] = rows.reduce((sum, r) => sum + (r[`value${i}`] || 0), 0);
        });
      }
    }
  } catch (error) {
    console.error('[fetchExploreChartData] Query error:', error.message);
    return { data: [], totals: {}, metrics, periodStart, periodEnd };
  }

  return {
    data,
    totals,
    metrics,
    total: totals[metrics[0]] || 0, // Backward compatible
    periodStart,
    periodEnd
  };
}

/**
 * Explore query handler - uses GPT-4o-mini to interpret queries intelligently
 * Gives GPT context about the store's actual data for smarter interpretation
 * Then fetches data using same database as getStoreData
 */
export async function exploreQuery(query, store, currentFilters = {}, startDate = null, endDate = null) {
  const db = getDb();
  const storeName = (store || 'vironax').toLowerCase();
  const currency = storeName === 'vironax' ? 'SAR' : 'USD';

  console.log(`[Explore] Query: "${query}" for ${storeName}`);

  try {
    // Step 1: Get store context for smarter AI interpretation
    const storeContext = getStoreContextForExplore(db, storeName);
    const dynamicPrompt = buildExploreSystemPrompt(storeContext);

    // Step 2: Use GPT-4o-mini to interpret the query intelligently
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: dynamicPrompt },
        {
          role: 'user',
          content: `User query: "${query}"

Current UI filters (use as hints if query is ambiguous):
${JSON.stringify(currentFilters, null, 2)}

Interpret what the user wants to see and return a JSON chart specification.
If they want to compare metrics, include multiple metrics in the array.
Be smart about understanding intent, not just matching keywords.`
        }
      ],
      max_tokens: 600,
      temperature: 0.4, // Slightly higher for more creative interpretation
      response_format: { type: 'json_object' }
    });

    const aiResponse = JSON.parse(response.choices[0].message.content);

    if (!aiResponse.success) {
      return {
        success: false,
        error: aiResponse.error || 'Could not interpret query'
      };
    }

    const spec = aiResponse.spec;
    console.log(`[Explore] AI spec:`, spec);

    // Normalize metrics to array format
    const metrics = Array.isArray(spec.metrics) ? spec.metrics : [spec.metrics || spec.metric || 'revenue'];

    // Step 3: Fetch chart data using same database tables as getStoreData
    const chartResult = fetchExploreChartData(db, storeName, { ...spec, metrics }, startDate, endDate);

    return {
      success: true,
      spec: {
        ...spec,
        metrics,
        metric: metrics[0], // Backward compatible
        chartType: spec.chartType === 'auto' ? (spec.dimension === 'date' ? 'line' : 'bar') : spec.chartType,
        isComparison: metrics.length > 1
      },
      data: chartResult.data,
      meta: {
        total: chartResult.total,
        totals: chartResult.totals,
        metrics,
        currency,
        periodStart: chartResult.periodStart,
        periodEnd: chartResult.periodEnd
      }
    };

  } catch (error) {
    console.error('[Explore] Error:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// ============================================================================
// CHART DECISION PROMPT - Quick analysis for whether to show a chart
// Used in parallel with main response stream for best UX
// ============================================================================

const CHART_DECISION_PROMPT = `You are a visualization decision assistant. Given a user's question about their e-commerce/advertising data, decide if showing a chart would genuinely help them understand the answer.

SHOW A CHART WHEN:
- Trends over time: "how's revenue this month?" → line chart shows the shape
- Comparisons: "which country performs best?" → bar chart makes ranking clear
- Proportions: "what's the split between platforms?" → pie chart shows share
- User explicitly asks: "show me", "chart", "visualize", "graph"
- Explaining a change that's easier to see than describe

DO NOT SHOW A CHART WHEN:
- Simple factual answers: "what's my ROAS?" → just a number
- Yes/no questions: "is revenue up?" → just say yes/no
- Strategic advice: "should I pause this campaign?" → needs explanation, not chart
- The answer is a single value or simple comparison
- When words alone are clearer

If a chart would help, respond with JSON:
{
  "showChart": true,
  "title": "Human readable title",
  "note": "One sentence explaining why this chart helps",
  "chartType": "line|bar|area|pie",
  "metric": "revenue|orders|spend|impressions|clicks|roas|aov|conversion_rate|add_to_cart",
  "dimension": "date|country|campaign_name|adset_name|platform|age|gender",
  "dateRange": "7d|14d|30d"
}

If no chart needed, respond with:
{
  "showChart": false
}

Be conservative. Only show charts when they genuinely add value.`;

/**
 * Analyze if a question warrants a chart visualization
 * Uses GPT-4o-mini for fast decision (~300-500ms)
 */
async function analyzeChartNeed(question, mode) {
  // Only consider charts for Analyze and Deep Dive modes, not Ask
  if (mode === 'analyze' || mode === 'ask') {
    // Ask mode is for quick facts - rarely needs charts
    // Only show chart if explicitly requested
    if (!question.toLowerCase().match(/show|chart|graph|visualize|trend|compare/)) {
      return { showChart: false };
    }
  }

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CHART_DECISION_PROMPT },
        { role: 'user', content: `User question: "${question}"\nMode: ${mode}\n\nRespond with JSON.` }
      ],
      max_tokens: 300,
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.log('[ChartDecision] Error:', error.message);
    return { showChart: false };
  }
}

/**
 * Stream with parallel chart analysis
 * Runs chart decision in parallel with main stream for best UX
 */
export async function streamWithChartSupport(
  question,
  store,
  mode,
  depth,
  onDelta,
  onChart,
  history = [],
  startDate = null,
  endDate = null
) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, mode === 'decide' ? 'decide' : mode, data, question);

  // Determine model and settings based on mode
  let primaryModel, fallbackModel, maxTokens, reasoningEffort, temperature;

  if (mode === 'decide' || mode === 'deepdive') {
    primaryModel = MODELS.STRATEGIST;
    fallbackModel = FALLBACK_MODELS.STRATEGIST;
    reasoningEffort = DEPTH_TO_EFFORT[depth] || 'medium';
    maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;
    temperature = MODE_TEMPERATURES.decide;
  } else if (mode === 'summarize' || mode === 'analyze') {
    primaryModel = MODELS.MINI;
    fallbackModel = FALLBACK_MODELS.MINI;
    reasoningEffort = null;
    maxTokens = TOKEN_LIMITS.mini;
    temperature = MODE_TEMPERATURES.summarize;
  } else {
    // Ask mode
    primaryModel = MODELS.ASK;
    fallbackModel = MODELS.ASK;
    reasoningEffort = null;
    maxTokens = TOKEN_LIMITS.nano;
    temperature = MODE_TEMPERATURES.analyze;
  }

  // Run chart analysis and main stream in PARALLEL
  const chartPromise = analyzeChartNeed(question, mode);

  // Start main stream
  const streamPromise = streamWithFallback(
    primaryModel,
    fallbackModel,
    systemPrompt,
    question,
    maxTokens,
    reasoningEffort,
    onDelta,
    temperature
  );

  // Handle chart decision when it completes (usually before stream ends)
  chartPromise.then(chartDecision => {
    if (chartDecision.showChart && onChart) {
      try {
        // Fetch chart data and emit event
        const chartPayload = handleShowChartTool(chartDecision, store, startDate, endDate);
        onChart(chartPayload);
      } catch (error) {
        console.log('[ChartDecision] Failed to generate chart:', error.message);
      }
    }
  }).catch(err => {
    console.log('[ChartDecision] Promise error:', err.message);
  });

  // Wait for stream to complete
  const result = await streamPromise;

  return result;
}

// ============================================================================
// STREAMING WITH TOOL SUPPORT - GPT-5.1 decides when to show charts
// Uses chat.completions API with tools for streaming + function calling
// ============================================================================

/**
 * Stream with tool support - allows GPT-5.1 to call show_chart during response
 * This is the core function that enables visualization dock in chat modes
 */
async function streamWithToolSupport(
  primaryModel,
  fallbackModel,
  systemPrompt,
  userMessage,
  maxTokens,
  reasoningEffort,
  onDelta,
  onChart,
  store,
  startDate,
  endDate,
  temperature = 0.7
) {
  // Build messages array
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  // Try primary model first (GPT-5.1 via chat completions for tool support)
  const modelToUse = primaryModel.includes('5.1') ? 'gpt-5.1' : primaryModel;

  try {
    console.log(`[OpenAI] Streaming ${modelToUse} with tool support`);

    const response = await client.chat.completions.create({
      model: modelToUse,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      tools: [SHOW_CHART_TOOL],
      tool_choice: 'auto' // Let the model decide when to use the tool
    });

    let toolCallBuffer = null;
    let fullContent = '';
    let chartEmitted = false;

    for await (const chunk of response) {
      const choice = chunk.choices[0];

      // Handle text content
      if (choice?.delta?.content) {
        fullContent += choice.delta.content;
        onDelta(choice.delta.content);
      }

      // Handle tool calls
      if (choice?.delta?.tool_calls) {
        for (const toolCall of choice.delta.tool_calls) {
          if (toolCall.index === 0) {
            // Initialize or append to tool call buffer
            if (!toolCallBuffer) {
              toolCallBuffer = {
                id: toolCall.id || '',
                name: toolCall.function?.name || '',
                arguments: ''
              };
            }
            if (toolCall.id) toolCallBuffer.id = toolCall.id;
            if (toolCall.function?.name) toolCallBuffer.name = toolCall.function.name;
            if (toolCall.function?.arguments) toolCallBuffer.arguments += toolCall.function.arguments;
          }
        }
      }

      // Check if stream finished with a tool call
      if (choice?.finish_reason === 'tool_calls' && toolCallBuffer && !chartEmitted) {
        if (toolCallBuffer.name === 'show_chart' && onChart) {
          try {
            // Validate JSON completeness before parsing
            const argsStr = toolCallBuffer.arguments.trim();
            if (!argsStr.endsWith('}')) {
              console.warn('[OpenAI] Incomplete tool call arguments, skipping chart');
            } else {
              const toolArgs = JSON.parse(argsStr);
              console.log(`[OpenAI] GPT-5.1 called show_chart:`, toolArgs);

              // Fetch chart data and emit to frontend
              const chartPayload = handleShowChartTool(toolArgs, store, startDate, endDate);
              onChart(chartPayload);
              chartEmitted = true;
            }
          } catch (err) {
            console.error('[OpenAI] Failed to parse tool call:', err.message, 'Args:', toolCallBuffer.arguments);
          }
        }
      }
    }

    return { model: modelToUse, reasoning: reasoningEffort };

  } catch (error) {
    console.log(`[OpenAI] ${modelToUse} with tools failed: ${error.message}, trying ${fallbackModel}`);

    // Fallback to model without tools
    const response = await client.chat.completions.create({
      model: fallbackModel,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: true
    });

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) onDelta(delta);
    }

    return { model: fallbackModel, reasoning: null };
  }
}

/**
 * Streaming export for Analyze mode with chart support
 * Uses GPT-5-mini with show_chart tool
 */
export async function summarizeDataStreamWithChart(
  question,
  store,
  onDelta,
  onChart,
  history = [],
  startDate = null,
  endDate = null
) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPromptWithChartGuidance(store, 'summarize', data, question);

  return await streamWithToolSupport(
    MODELS.MINI,
    FALLBACK_MODELS.MINI,
    systemPrompt,
    question,
    TOKEN_LIMITS.mini,
    null,
    onDelta,
    onChart,
    store,
    startDate,
    endDate,
    MODE_TEMPERATURES.summarize
  );
}

/**
 * Streaming export for Deep Dive mode with chart support
 * Uses GPT-5.1 with show_chart tool
 */
export async function decideQuestionStreamWithChart(
  question,
  store,
  depth = 'balanced',
  onDelta,
  onChart,
  history = [],
  startDate = null,
  endDate = null
) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPromptWithChartGuidance(store, 'decide', data, question);
  const effort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;

  return await streamWithToolSupport(
    MODELS.STRATEGIST,
    FALLBACK_MODELS.STRATEGIST,
    systemPrompt,
    question,
    maxTokens,
    effort,
    onDelta,
    onChart,
    store,
    startDate,
    endDate,
    MODE_TEMPERATURES.decide
  );
}

/**
 * Build system prompt with chart tool guidance
 * Extends the base prompt with instructions on when to use show_chart
 */
function buildSystemPromptWithChartGuidance(store, mode, data, question = '') {
  const basePrompt = buildSystemPrompt(store, mode, data, question);

  const chartGuidance = `

VISUALIZATION TOOL:
You have access to a show_chart tool that displays charts in a dock above your response.

USE SHOW_CHART WHEN:
- Showing trends over time (revenue trend, spend pattern, etc.) → use line chart
- Comparing categories (countries, campaigns, etc.) → use bar chart
- Showing proportions/shares (market split, platform distribution) → use pie chart
- The user explicitly asks for a visual ("show me", "chart", "visualize")
- A pattern is easier to see than describe

DO NOT USE SHOW_CHART WHEN:
- Answering a simple factual question ("what's my ROAS?")
- Giving strategic recommendations (words are better)
- The answer is a single number or yes/no
- You're explaining concepts or strategies

If you use show_chart, continue your response explaining what the chart shows.
Only call show_chart once per response - pick the most helpful visualization.`;

  return basePrompt + chartGuidance;
}

// ============================================================================
// SHOW_CHART TOOL - For chat modes to display visualizations
// Uses same data pathways as Explore mode
// ============================================================================

export const SHOW_CHART_TOOL = {
  type: "function",
  function: {
    name: "show_chart",
    description: "Display a chart in the visualization dock to help explain data to the user. Only use when a visual would genuinely help understanding - for trends, comparisons, or proportions.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Chart title, human readable"
        },
        note: {
          type: "string",
          description: "One sentence explaining why you're showing this chart"
        },
        chartType: {
          type: "string",
          enum: ["line", "bar", "area", "pie"],
          description: "Type of chart"
        },
        metric: {
          type: "string",
          enum: ["revenue", "orders", "spend", "impressions", "clicks", "roas", "aov", "conversion_rate", "add_to_cart"],
          description: "Which metric to chart"
        },
        dimension: {
          type: "string",
          enum: ["date", "country", "campaign_name", "adset_name", "platform", "age", "gender"],
          description: "How to break down the data"
        },
        dateRange: {
          type: "string",
          enum: ["7d", "14d", "30d"],
          description: "Time period for data"
        }
      },
      required: ["title", "note", "chartType", "metric", "dimension", "dateRange"]
    }
  }
};

/**
 * Handle show_chart tool call - fetches data and returns chart payload
 */
export function handleShowChartTool(toolArgs, store, startDate = null, endDate = null) {
  const db = getDb();
  const storeName = (store || 'vironax').toLowerCase();
  const currency = storeName === 'vironax' ? 'SAR' : 'USD';

  const spec = {
    title: toolArgs.title,
    note: toolArgs.note,
    chartType: toolArgs.chartType,
    metric: toolArgs.metric,
    dimension: toolArgs.dimension,
    dateRange: toolArgs.dateRange,
    autoReason: `${toolArgs.dimension === 'date' ? 'Time series' : 'Categorical'} data`
  };

  const chartResult = fetchExploreChartData(db, storeName, spec, startDate, endDate);

  return {
    spec,
    data: chartResult.data,
    meta: {
      total: chartResult.total,
      currency,
      periodStart: chartResult.periodStart,
      periodEnd: chartResult.periodEnd
    }
  };
}

// ============================================================================
// CLEANUP - Delete demo Salla data
// ============================================================================

export function deleteDemoSallaData() {
  const db = getDb();
  try {
    const result = db.prepare(`DELETE FROM salla_orders WHERE store = 'vironax'`).run();
    console.log(`[Cleanup] Deleted ${result.changes} demo Salla orders`);
    return { success: true, deleted: result.changes };
  } catch (error) {
    console.error('[Cleanup] Failed to delete demo data:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// DEBUG - Run raw SQL query
// ============================================================================

export function runQuery(sql, params = []) {
  const db = getDb();
  try {
    if (!sql || typeof sql !== 'string') {
      return { success: false, error: 'SQL query required' };
    }
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return { success: true, data: db.prepare(sql).all(...params) };
    }
    return { success: false, error: 'Only SELECT queries allowed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
