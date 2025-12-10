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

  // Use provided dates or default to 7 days if not provided
  const periodStart = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
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
// PROMPT BUILDING
// ============================================================================

function buildSystemPrompt(store, mode, data) {
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

  const basePrompt = `You are an expert e-commerce analyst with access to FULL campaign hierarchy and funnel data.
${storeInfo}
${structureInfo}
${dataStructureInfo}

TODAY: ${data.dateContext?.today} (${data.dateContext?.todayDayName})
YESTERDAY: ${data.dateContext?.yesterday} (${data.dateContext?.yesterdayDayName})
ANALYSIS PERIOD: ${data.dateContext?.periodStart} to ${data.dateContext?.periodEnd}
${reactivationInfo}

DATA:
${JSON.stringify(data, null, 2)}

RULES:
- Use ONLY this data, never invent numbers
- VironaX = SAR, Shawq = USD
- ROAS = revenue/spend
- Be specific with real figures
- The data shows ACTIVE campaigns with full hierarchy (campaigns → adsets → ads)
- You have LIFETIME data (since inception) AND period-specific data
- Analyze funnel metrics (lpv_rate, atc_rate, checkout_rate, purchase_rate) to identify drop-offs
- If asked about inactive/paused items, refer to reactivationCandidates data if available`;

  if (mode === 'analyze') {
    return basePrompt + '\n\nMODE: Quick answer in 2-3 sentences max.';
  }
  if (mode === 'summarize') {
    return basePrompt + '\n\nMODE: Summarize trends, compare periods, flag anomalies.';
  }
  return basePrompt + `\n\nMODE: Strategic Decisions
- Give detailed, actionable recommendations
- Analyze each campaign with specific numbers
- Include budget recommendations
- Prioritize by impact
- If reactivation candidates exist, evaluate them and recommend which to turn back on`;
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

async function callChatCompletionsAPI(model, systemPrompt, userMessage, maxTokens) {
  console.log(`[OpenAI] Fallback to ${model} (max_tokens: ${maxTokens})`);
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: maxTokens,
    temperature: 0.7
  });
  return response.choices[0].message.content;
}

async function callWithFallback(primary, fallback, systemPrompt, userMessage, maxTokens, reasoningEffort = null) {
  try {
    const text = await callResponsesAPI(primary, systemPrompt, userMessage, maxTokens, reasoningEffort);
    return { text, model: primary };
  } catch (error) {
    console.log(`[OpenAI] ${primary} failed: ${error.message}, trying ${fallback}`);
    const text = await callChatCompletionsAPI(fallback, systemPrompt, userMessage, maxTokens);
    return { text, model: fallback };
  }
}

// ============================================================================
// STREAMING - For real-time responses
// ============================================================================

async function streamWithFallback(primary, fallback, systemPrompt, userMessage, maxTokens, reasoningEffort, onDelta) {
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
      temperature: 0.7,
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

export async function analyzeQuestion(question, store, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'analyze', data);
  return await callWithFallback(MODELS.NANO, FALLBACK_MODELS.NANO, systemPrompt, question, TOKEN_LIMITS.nano);
}

export async function summarizeData(question, store, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'summarize', data);
  return await callWithFallback(MODELS.MINI, FALLBACK_MODELS.MINI, systemPrompt, question, TOKEN_LIMITS.mini);
}

export async function decideQuestion(question, store, depth = 'balanced', history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'decide', data);
  const effort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;

  const result = await callWithFallback(MODELS.STRATEGIST, FALLBACK_MODELS.STRATEGIST, systemPrompt, question, maxTokens, effort);
  return { ...result, reasoning: effort };
}

export async function decideQuestionStream(question, store, depth = 'balanced', onDelta, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'decide', data);
  const effort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;

  return await streamWithFallback(MODELS.STRATEGIST, FALLBACK_MODELS.STRATEGIST, systemPrompt, question, maxTokens, effort, onDelta);
}

// Streaming versions for Analyze and Summarize
export async function analyzeQuestionStream(question, store, onDelta, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'analyze', data);
  return await streamWithFallback(MODELS.NANO, FALLBACK_MODELS.NANO, systemPrompt, question, TOKEN_LIMITS.nano, null, onDelta);
}

export async function summarizeDataStream(question, store, onDelta, history = [], startDate = null, endDate = null) {
  const data = getRelevantData(store, question, startDate, endDate);
  const systemPrompt = buildSystemPrompt(store, 'summarize', data);
  return await streamWithFallback(MODELS.MINI, FALLBACK_MODELS.MINI, systemPrompt, question, TOKEN_LIMITS.mini, null, onDelta);
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
