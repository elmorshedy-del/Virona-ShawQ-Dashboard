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
    return `Respond using this EXACT format (no markdown, use emojis):

📊 KEY METRICS
• Revenue → [amount]
• Spend → [amount]  
• ROAS → [X.Xx]
• Orders → [number]
• AOV → [amount]

📈 TREND vs Last Period
• [Most important change with ↑↓ %]

🏆 TOP PERFORMER
• [Best campaign or country] → [key metric]

💡 QUICK TAKE
[One actionable sentence]`;
  }
  
  if (q.includes('compare') || q.includes('period') || q.includes('previous')) {
    return `Respond using this EXACT format (no markdown, use emojis):

📅 PERIOD COMPARISON

This Period          vs          Last Period
─────────────────────────────────────────────
Revenue    [amount]              [amount]    [↑↓%]
ROAS       [X.Xx]                [X.Xx]      [↑↓%]
Spend      [amount]              [amount]    [↑↓%]
Orders     [number]              [number]    [↑↓%]

📈 IMPROVED
• [What went up and why]

📉 DROPPED  
• [What went down and why]

💡 WHAT THIS MEANS
[One sentence implication]`;
  }
  
  if (q.includes('country') || q.includes('countries') || q.includes('geo') || q.includes('leaderboard')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🌍 COUNTRY LEADERBOARD

🥇 [Country]
   Revenue [amount] | ROAS [X.Xx] | [orders] orders

🥈 [Country]
   Revenue [amount] | ROAS [X.Xx] | [orders] orders

🥉 [Country]
   Revenue [amount] | ROAS [X.Xx] | [orders] orders

📉 UNDERPERFORMERS
• [Country] → ROAS [X.Xx] (below target)

💡 GEO ACTION
• Scale → [country]
• Cut/Reduce → [country]`;
  }
  
  if (q.includes('funnel') || q.includes('conversion')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🎯 FUNNEL HEALTH

👀 Impressions    [number]
        ↓ [CTR %]
🖱️ Clicks         [number]
        ↓ [landing rate %]
📄 Landing Views  [number]
        ↓ [ATC rate %]
🛒 Add to Cart    [number]
        ↓ [checkout rate %]
💳 Checkouts      [number]
        ↓ [purchase rate %]
✅ Purchases      [number]

🚨 BIGGEST LEAK
[Stage name] → Losing [X%] of visitors here

💡 FIX
[Specific recommendation]`;
  }
  
  if (q.includes('spend') || q.includes('results') || q.includes('efficiency')) {
    return `Respond using this EXACT format (no markdown, use emojis):

💸 SPEND VS RESULTS

Spent        [amount]
Revenue      [amount]
─────────────────────
ROAS         [X.Xx]
CPA          [amount]

⚖️ VERDICT: [EFFICIENT ✅ / NEEDS WORK ⚠️ / CRITICAL 🚨]
[One sentence explanation]

📊 BY CAMPAIGN
• Best → [name] at [ROAS]
• Worst → [name] at [ROAS]

💡 OPTIMIZE
[Specific action to improve]`;
  }
  
  if (q.includes('anomal') || q.includes('unusual') || q.includes('weird') || q.includes('spike')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🔍 ANOMALY SCAN

[If anomalies found:]
⚠️ ANOMALIES DETECTED

1. [Metric] → [unusual value]
   Normal range: [expected]
   Possible cause: [reason]

2. [Metric] → [unusual value]
   Normal range: [expected]
   Possible cause: [reason]

💡 ACTION NEEDED
[What to investigate or fix]

[If no anomalies:]
✅ ALL CLEAR
All metrics within normal ranges.
[Brief current state summary]`;
  }
  
  if (q.includes('driver') || q.includes('working') || q.includes('top performer')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🏆 TOP DRIVERS (Carrying Performance)

1. [Campaign/Adset name]
   Spend [X] → Revenue [Y] → ROAS [Z]

2. [Campaign/Adset name]
   Spend [X] → Revenue [Y] → ROAS [Z]

3. [Campaign/Adset name]
   Spend [X] → Revenue [Y] → ROAS [Z]

📉 BOTTOM PERFORMERS (Dragging Down)

1. [Name] → ROAS [X] ← needs attention
2. [Name] → ROAS [X]
3. [Name] → ROAS [X]

💡 FOCUS
• Double down → [top performer]
• Fix or cut → [worst performer]`;
  }
  
  if (q.includes('creative') || q.includes('ad ') || q.includes('ads')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🎨 CREATIVE PERFORMANCE

🏆 TOP ADS

1. [Ad name]
   CTR [X%] | ROAS [Y] | [Z] conversions

2. [Ad name]
   CTR [X%] | ROAS [Y] | [Z] conversions

3. [Ad name]
   CTR [X%] | ROAS [Y] | [Z] conversions

😴 FATIGUED (Declining)
• [Ad name] → [trend description]

🎨 WHAT'S WORKING
[Creative pattern or theme insight]

💡 NEXT CREATIVE
[Recommendation for new ads]`;
  }
  
  if (q.includes('reactivat') || q.includes('paused') || q.includes('archived') || q.includes('inactive')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🔄 REACTIVATION CHECK

📊 INACTIVE ITEMS FOUND
• Campaigns: [X]
• Ad Sets: [Y]  
• Ads: [Z]

🏆 BEST CANDIDATES TO REACTIVATE

1. [Name]
   Historical ROAS [X.Xx] | Revenue [Y] | Score [Z]/10

2. [Name]
   Historical ROAS [X.Xx] | Revenue [Y] | Score [Z]/10

3. [Name]
   Historical ROAS [X.Xx] | Revenue [Y] | Score [Z]/10

💡 RECOMMENDATION
• Reactivate → [top 1-2 names]
• Test budget → [amount]
• Watch for → [success metric]`;
  }
  
  // Default format
  return `Respond with clear sections using emojis as headers. Use bullet points. Include specific numbers. End with a 💡 recommendation.`;
}

function getDeepDiveFormat(question) {
  const q = question.toLowerCase();
  
  if (q.includes('scale') || q.includes('grow') || q.includes('increase') || q.includes('expand')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🚀 SCALE PLAN

📈 THE OPPORTUNITY
[2-3 sentences on why and how much to scale]

────────────────────────────────────────

🏆 SCALE THESE

1. [Campaign/Adset name]
   Current: [spend] → ROAS [X.Xx]
   Add: +[amount] (+[%])
   
2. [Campaign/Adset name]
   Current: [spend] → ROAS [X.Xx]
   Add: +[amount] (+[%])

────────────────────────────────────────

💰 TOTAL BUDGET INCREASE
Add [amount] over [timeframe]

📅 PHASING
• Week 1 → +[X%] increase
• Week 2 → +[Y%] if metrics hold
• Week 3 → Evaluate and adjust

────────────────────────────────────────

⚠️ WATCH FOR
• [Metric 1] staying above [threshold]
• [Metric 2] not exceeding [limit]
• Red flag → [warning sign]

────────────────────────────────────────

⚡ NEXT STEPS
1. [First action]
2. [Second action]
3. [Third action]`;
  }
  
  if (q.includes('cut') || q.includes('pause') || q.includes('stop') || q.includes('kill')) {
    return `Respond using this EXACT format (no markdown, use emojis):

✂️ CUT PLAN

📉 THE PROBLEM
[2-3 sentences on what's dragging performance]

────────────────────────────────────────

🚫 CUT LIST

1. [Campaign/Adset/Ad name]
   Spend [X] → ROAS [Y] → PAUSE
   Reason: [why it's underperforming]

2. [Campaign/Adset/Ad name]
   Spend [X] → ROAS [Y] → PAUSE
   Reason: [why]

3. [Campaign/Adset/Ad name]
   Spend [X] → ROAS [Y] → PAUSE
   Reason: [why]

────────────────────────────────────────

💰 SAVINGS
Total freed up → [amount]/day

📈 EXPECTED IMPACT  
ROAS should improve by ~[X%]

────────────────────────────────────────

🔄 REALLOCATE TO
• [amount] → [better performing campaign]
• [amount] → [testing budget]

────────────────────────────────────────

⚡ NEXT STEPS
1. [Pause action]
2. [Reallocation action]
3. [Monitor action]`;
  }
  
  if (q.includes('budget') || q.includes('allocat') || q.includes('realloc')) {
    return `Respond using this EXACT format (no markdown, use emojis):

💸 BUDGET REALLOCATION

📊 CURRENT SPLIT
┌─────────────────────────────────────┐
│ [Campaign 1]    [amt] ([%])  ROAS [X] │
│ [Campaign 2]    [amt] ([%])  ROAS [X] │
│ [Campaign 3]    [amt] ([%])  ROAS [X] │
└─────────────────────────────────────┘

────────────────────────────────────────

⚖️ EFFICIENCY RANKING
• Most efficient → [name] at ROAS [X]
• Least efficient → [name] at ROAS [X]

────────────────────────────────────────

🔄 RECOMMENDED SHIFTS

FROM                    TO                      AMOUNT
[Low performer]    →    [High performer]    →   [amount]
[Low performer]    →    [High performer]    →   [amount]

────────────────────────────────────────

💰 NEW ALLOCATION
• [Campaign 1] → [new amount] ([%])
• [Campaign 2] → [new amount] ([%])

📈 EXPECTED RESULT
• ROAS improvement → +[X%]
• Additional revenue → [amount]

────────────────────────────────────────

⚡ NEXT STEPS
1. [First budget change]
2. [Second change]`;
  }
  
  if (q.includes('structure') || q.includes('reorganize') || q.includes('campaign structure')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🧱 CAMPAIGN STRUCTURE REVIEW

🏗️ CURRENT STATE
• [X] campaigns | [Y] ad sets | [Z] ads
• Structure: [how it's organized]

────────────────────────────────────────

⚠️ ISSUES FOUND

1. [Issue - e.g., overlap, fragmentation]
   Impact: [what it's causing]

2. [Issue]
   Impact: [what it's causing]

────────────────────────────────────────

🎯 RECOMMENDED STRUCTURE

[Proposed organization - e.g.:]
• 1 Campaign per objective
• Ad sets by audience type
• Naming: [Store]_[Objective]_[Audience]_[Date]

────────────────────────────────────────

📋 MIGRATION PLAN

Week 1:
• [Step 1]
• [Step 2]

Week 2:
• [Step 3]
• [Step 4]

────────────────────────────────────────

⚡ NEXT STEPS
1. [First restructure action]
2. [Second action]`;
  }
  
  if (q.includes('creative') || q.includes('roadmap') || q.includes('ad strategy')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🎬 CREATIVE ROADMAP

🏆 WHAT'S WORKING

[Ad name 1]
→ Why: [insight on why it performs]

[Ad name 2]  
→ Why: [insight]

────────────────────────────────────────

😴 FATIGUED (Replace Soon)
• [Ad name] → [declining metric]
• [Ad name] → [declining metric]

────────────────────────────────────────

🎨 GAPS IN CREATIVE MIX
• Missing: [format/angle not tested]
• Missing: [format/angle not tested]

────────────────────────────────────────

📋 PRODUCTION LIST

🔴 HIGH PRIORITY
1. [Creative concept] → [expected impact]

🟡 MEDIUM  
2. [Creative concept]
3. [Creative concept]

────────────────────────────────────────

🧪 TEST IDEAS
• [Variation to try]
• [Variation to try]

────────────────────────────────────────

⚡ NEXT STEPS
1. [First creative to make]
2. [Launch timeline]`;
  }
  
  if (q.includes('audience') || q.includes('targeting') || q.includes('lookalike')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🧭 AUDIENCE STRATEGY

👥 CURRENT TARGETING
• [List main audiences being used]

────────────────────────────────────────

🏆 TOP PERFORMERS

1. [Audience name]
   ROAS [X.Xx] | Conv rate [Y%] | [Z] conversions

2. [Audience name]
   ROAS [X.Xx] | Conv rate [Y%] | [Z] conversions

────────────────────────────────────────

📉 CUT OR REFINE
• [Audience] → ROAS [X] ← too low
• [Audience] → [issue]

────────────────────────────────────────

🆕 EXPANSION OPPORTUNITIES
• Test: [new audience idea]
• Test: [new audience idea]

🎯 LOOKALIKE STRATEGY
• Create LAL from: [best converter]
• Suggested %: [1-3%]

────────────────────────────────────────

⚡ NEXT STEPS
1. [First audience action]
2. [Second action]`;
  }
  
  if (q.includes('test') || q.includes('experiment') || q.includes('try')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🧪 TEST PLAN

📊 WHAT WE KNOW
• [Key insight from data]
• [Key insight from data]

❓ WHAT WE NEED TO LEARN
• [Knowledge gap 1]
• [Knowledge gap 2]

────────────────────────────────────────

🧪 TEST QUEUE

🔴 TEST 1 (High Priority)
[Test name/description]
• Hypothesis → [what we expect to happen]
• Success metric → [how we measure]
• Budget → [amount]
• Duration → [timeframe]

🟡 TEST 2 (Medium)
[Test name/description]
• Hypothesis → [what we expect]
• Success metric → [measure]
• Budget → [amount]

🟡 TEST 3 (Medium)
[Test name/description]
• Hypothesis → [what we expect]
• Budget → [amount]

────────────────────────────────────────

⚡ NEXT STEPS
1. Launch Test 1 on [date]
2. Run for [duration]
3. Review results and iterate`;
  }
  
  if (q.includes('risk') || q.includes('efficiency') || q.includes('health')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🛡️ RISK & EFFICIENCY AUDIT

✅ HEALTHY AREAS
• [Strong point 1]
• [Strong point 2]

────────────────────────────────────────

⚠️ RISK AREAS

1. [Risk type - e.g., Concentration]
   Issue: [description]
   Severity: [High/Medium/Low]

2. [Risk type - e.g., Creative fatigue]
   Issue: [description]
   Severity: [High/Medium/Low]

────────────────────────────────────────

📉 INEFFICIENCIES

• [Wasted spend area] → [amount] at risk
• [Overlap/duplication] → [impact]

────────────────────────────────────────

🛡️ MITIGATION PLAN

For [Risk 1]:
→ [Action to reduce risk]

For [Risk 2]:
→ [Action to reduce risk]

────────────────────────────────────────

💰 QUICK EFFICIENCY WINS

1. [Action] → Save [amount]
2. [Action] → Save [amount]

────────────────────────────────────────

⚡ NEXT STEPS
1. [Priority fix]
2. [Second fix]`;
  }
  
  if (q.includes('reactivat') || q.includes('turn back on') || q.includes('paused') || q.includes('reviv')) {
    return `Respond using this EXACT format (no markdown, use emojis):

🔄 REACTIVATION PLAN

📊 CANDIDATES FOUND
Campaigns: [X] | Ad Sets: [Y] | Ads: [Z]

────────────────────────────────────────

🏆 PRIORITY REACTIVATIONS

1. [Name] ⭐ Score [X]/10
   ├─ Historical ROAS → [X.Xx]
   ├─ Revenue generated → [amount]
   ├─ Last active → [date]
   └─ Test budget → [amount]

2. [Name] ⭐ Score [X]/10
   ├─ Historical ROAS → [X.Xx]  
   ├─ Revenue generated → [amount]
   └─ Test budget → [amount]

3. [Name] ⭐ Score [X]/10
   ├─ Historical ROAS → [X.Xx]
   └─ Test budget → [amount]

────────────────────────────────────────

📅 REACTIVATION SCHEDULE

Week 1 → Turn on [top 1-2 candidates]
Week 2 → Evaluate performance
Week 3 → Add next batch if positive

────────────────────────────────────────

👀 SUCCESS CRITERIA

Day 1-3:
• [What to monitor]
• Green light if: [threshold]

Day 4-7:
• Decision point
• Scale if: [condition]
• Pause again if: [condition]

────────────────────────────────────────

⚡ NEXT STEPS
1. [First reactivation]
2. [Set up monitoring]
3. [Review checkpoint]`;
  }
  
  // Default strategic format
  return `Respond using this format (no markdown, use emojis):

📈 EXECUTIVE SUMMARY
[2-3 sentences on the situation and main recommendation]

────────────────────────────────────────

📊 KEY FINDINGS
• [Finding 1 with numbers]
• [Finding 2 with numbers]
• [Finding 3 with numbers]

────────────────────────────────────────

🎯 RECOMMENDATIONS

1. [HIGH IMPACT] [Action]
   Expected result: [outcome]

2. [MEDIUM] [Action]
   Expected result: [outcome]

────────────────────────────────────────

⚡ NEXT STEPS
1. [First action]
2. [Second action]
3. [Third action]`;
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

RESPONSE STYLE:
- Be direct and confident - you're a trusted growth advisor
- Lead with the key insight or answer first
- Use clear structure with line breaks between sections
- Use bullet points (•) for lists, not dashes
- If comparing, show the delta/change (↑ or ↓ with %)
- End with a clear takeaway or recommended action when relevant

FORMATTING (IMPORTANT):
- Do NOT use markdown like **bold** or *italic* - it won't render
- Use EMOJIS for visual hierarchy (📊 🎯 💡 ⚡ etc.)
- Use → for showing flow or relationships
- Use | to separate data points on same line
- Keep bullet points SHORT (one line each when possible)
- Add blank lines between sections for breathing room
- Numbers should stand out: "ROAS 2.5x" not "ROAS of 2.5x"
- Use ALL CAPS sparingly for emphasis on key words`;

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
