import OpenAI from 'openai';
import { getDb } from '../db/database.js';

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
  nano: 2000,
  mini: 4000,
  instant: 4000,
  fast: 8000,
  balanced: 16000,
  deep: 32000
};

const DEPTH_TO_EFFORT = {
  instant: 'none',
  fast: 'low',
  balanced: 'medium',
  deep: 'high'
};

// ============================================================================
// COUNTRY CODE DISPLAY MAPPING
// ============================================================================

const COUNTRY_DISPLAY_NAMES = {
  'AE': 'UAE',
  'SA': 'Saudi Arabia',
  'KW': 'Kuwait',
  'QA': 'Qatar',
  'OM': 'Oman',
  'BH': 'Bahrain',
  'US': 'USA',
  'GB': 'UK',
  'DE': 'Germany',
  'FR': 'France',
  'NL': 'Netherlands',
  'CA': 'Canada',
  'AU': 'Australia',
  'TR': 'Turkey'
};

function formatCountryName(code) {
  return COUNTRY_DISPLAY_NAMES[code] || code;
}

// ============================================================================
// OPTIMIZED DATA FETCHING - Parallel queries, smart store detection
// ============================================================================

function getStoreData(db, storeName, today, yesterday, periodStart) {
  // Keep original for backwards compatibility
  return getStoreDataFull(db, storeName, today, yesterday, periodStart);
}

function getStoreDataFull(db, storeName, today, yesterday, periodStart) {
  const storeData = {};
  const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  try {
    // =========================================================================
    // META ADS DATA - Auto-detect if data exists (works for BOTH stores)
    // =========================================================================
    const hasMetaData = db.prepare(`
      SELECT COUNT(*) as cnt FROM meta_daily_metrics WHERE LOWER(store) = ? LIMIT 1
    `).get(storeName)?.cnt > 0;

    if (hasMetaData) {
      storeData.metaAds = {};
      
      storeData.metaAds.lifetime = db.prepare(`
        SELECT 
          SUM(spend) as totalSpend,
          SUM(conversion_value) as totalRevenue,
          SUM(conversions) as totalConversions,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
          ROUND(SUM(spend) / NULLIF(SUM(conversions), 0), 2) as cpa,
          MIN(date) as firstDate,
          MAX(date) as lastDate,
          COUNT(DISTINCT date) as daysWithData
        FROM meta_daily_metrics WHERE LOWER(store) = ?
      `).get(storeName);

      storeData.metaAds.last30Days = db.prepare(`
        SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as conversions,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
        FROM meta_daily_metrics WHERE LOWER(store) = ? AND date >= ?
      `).get(storeName, last30);

      storeData.metaAds.last7Days = db.prepare(`
        SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as conversions,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
        FROM meta_daily_metrics WHERE LOWER(store) = ? AND date >= ?
      `).get(storeName, last7);

      storeData.metaAds.today = db.prepare(`
        SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as conversions
        FROM meta_daily_metrics WHERE LOWER(store) = ? AND date = ?
      `).get(storeName, today);

      storeData.metaAds.yesterday = db.prepare(`
        SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as conversions
        FROM meta_daily_metrics WHERE LOWER(store) = ? AND date = ?
      `).get(storeName, yesterday);

      storeData.metaAds.monthlyTrends = db.prepare(`
        SELECT strftime('%Y-%m', date) as month, SUM(spend) as spend, SUM(conversion_value) as revenue,
          SUM(conversions) as conversions, ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
        FROM meta_daily_metrics WHERE LOWER(store) = ?
        GROUP BY strftime('%Y-%m', date) ORDER BY month DESC
      `).all(storeName);

      // Only show campaigns that are ACTIVE (have data in last 14 days)
      const last14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      storeData.metaAds.topCampaigns = db.prepare(`
        SELECT campaign_name, SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as conversions,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas, MIN(date) as firstSeen, MAX(date) as lastSeen
        FROM meta_daily_metrics 
        WHERE LOWER(store) = ? AND campaign_name IS NOT NULL
          AND campaign_name IN (
            SELECT DISTINCT campaign_name FROM meta_daily_metrics 
            WHERE LOWER(store) = ? AND date >= ? AND campaign_name IS NOT NULL
          )
        GROUP BY campaign_name ORDER BY revenue DESC LIMIT 10
      `).all(storeName, storeName, last14);

      storeData.metaAds.recentCampaigns = db.prepare(`
        SELECT campaign_name, SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as conversions,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
        FROM meta_daily_metrics WHERE LOWER(store) = ? AND date >= ? AND campaign_name IS NOT NULL
        GROUP BY campaign_name ORDER BY spend DESC LIMIT 10
      `).all(storeName, last7);

      // Ad Sets - only active ones (with data in last 14 days)
      try {
        storeData.metaAds.topAdSets = db.prepare(`
          SELECT adset_name, campaign_name, SUM(spend) as spend, SUM(conversion_value) as revenue, 
            SUM(conversions) as conversions, ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
            MAX(date) as lastSeen
          FROM meta_adset_metrics 
          WHERE LOWER(store) = ? AND adset_name IS NOT NULL AND date >= ?
          GROUP BY adset_name, campaign_name ORDER BY spend DESC LIMIT 15
        `).all(storeName, last14);
      } catch (e) {
        storeData.metaAds.topAdSets = [];
      }

      // Ads - only active ones (with data in last 14 days)
      try {
        storeData.metaAds.topAds = db.prepare(`
          SELECT ad_name, adset_name, campaign_name, SUM(spend) as spend, SUM(conversion_value) as revenue,
            SUM(conversions) as conversions, ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
            MAX(date) as lastSeen
          FROM meta_ad_metrics 
          WHERE LOWER(store) = ? AND ad_name IS NOT NULL AND date >= ?
          GROUP BY ad_name, adset_name, campaign_name ORDER BY spend DESC LIMIT 20
        `).all(storeName, last14);
      } catch (e) {
        storeData.metaAds.topAds = [];
      }

      storeData.metaAds.bestDays = db.prepare(`
        SELECT date, SUM(conversion_value) as revenue, SUM(conversions) as conversions, SUM(spend) as spend
        FROM meta_daily_metrics WHERE LOWER(store) = ?
        GROUP BY date ORDER BY revenue DESC LIMIT 5
      `).all(storeName);
    }

    // =========================================================================
    // SHOPIFY DATA - Auto-detect if data exists (for Shawq now, VironaX if added later)
    // =========================================================================
    const hasShopifyData = db.prepare(`
      SELECT COUNT(*) as cnt FROM shopify_orders WHERE LOWER(store) = ? LIMIT 1
    `).get(storeName)?.cnt > 0;

    if (hasShopifyData) {
      storeData.shopifyOrders = {};

      storeData.shopifyOrders.lifetime = db.prepare(`
        SELECT COUNT(*) as totalOrders, SUM(order_total) as totalRevenue, ROUND(AVG(order_total), 2) as avgOrderValue,
          MIN(date) as firstDate, MAX(date) as lastDate, COUNT(DISTINCT date) as daysWithData
        FROM shopify_orders WHERE LOWER(store) = ?
      `).get(storeName);

      storeData.shopifyOrders.last30Days = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue, ROUND(AVG(order_total), 2) as avgOrderValue
        FROM shopify_orders WHERE LOWER(store) = ? AND date >= ?
      `).get(storeName, last30);

      storeData.shopifyOrders.last7Days = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue, ROUND(AVG(order_total), 2) as avgOrderValue
        FROM shopify_orders WHERE LOWER(store) = ? AND date >= ?
      `).get(storeName, last7);

      storeData.shopifyOrders.today = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue
        FROM shopify_orders WHERE LOWER(store) = ? AND date = ?
      `).get(storeName, today);

      storeData.shopifyOrders.yesterday = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue
        FROM shopify_orders WHERE LOWER(store) = ? AND date = ?
      `).get(storeName, yesterday);

      storeData.shopifyOrders.monthlyTrends = db.prepare(`
        SELECT strftime('%Y-%m', date) as month, COUNT(*) as orders, SUM(order_total) as revenue,
          ROUND(AVG(order_total), 2) as avgOrderValue
        FROM shopify_orders WHERE LOWER(store) = ?
        GROUP BY strftime('%Y-%m', date) ORDER BY month DESC
      `).all(storeName);

      storeData.shopifyOrders.dailyOrders = db.prepare(`
        SELECT date, COUNT(*) as orders, SUM(order_total) as revenue
        FROM shopify_orders WHERE LOWER(store) = ? AND date >= ?
        GROUP BY date ORDER BY date DESC
      `).all(storeName, last30);

      storeData.shopifyOrders.ordersByCountry = db.prepare(`
        SELECT country_code, country, COUNT(*) as orders, SUM(order_total) as revenue,
          ROUND(AVG(order_total), 2) as avgOrderValue
        FROM shopify_orders WHERE LOWER(store) = ?
        GROUP BY country_code ORDER BY orders DESC LIMIT 15
      `).all(storeName);

      storeData.shopifyOrders.recentOrdersByCountry = db.prepare(`
        SELECT country_code, COUNT(*) as orders, SUM(order_total) as revenue
        FROM shopify_orders WHERE LOWER(store) = ? AND date >= ?
        GROUP BY country_code ORDER BY orders DESC LIMIT 10
      `).all(storeName, last7);

      storeData.shopifyOrders.bestDays = db.prepare(`
        SELECT date, COUNT(*) as orders, SUM(order_total) as revenue
        FROM shopify_orders WHERE LOWER(store) = ?
        GROUP BY date ORDER BY revenue DESC LIMIT 5
      `).all(storeName);

      storeData.shopifyOrders.topCities = db.prepare(`
        SELECT city, country_code, COUNT(*) as orders, SUM(order_total) as revenue
        FROM shopify_orders WHERE LOWER(store) = ? AND city IS NOT NULL AND city != ''
        GROUP BY city, country_code ORDER BY orders DESC LIMIT 10
      `).all(storeName);

      storeData.shopifyOrders.paymentMethods = db.prepare(`
        SELECT payment_method, COUNT(*) as orders, SUM(order_total) as revenue
        FROM shopify_orders WHERE LOWER(store) = ?
        GROUP BY payment_method ORDER BY orders DESC
      `).all(storeName);
    }

    // =========================================================================
    // SALLA DATA - Auto-detect if data exists (for VironaX when connected)
    // =========================================================================
    const hasSallaData = db.prepare(`
      SELECT COUNT(*) as cnt FROM salla_orders WHERE LOWER(store) = ? LIMIT 1
    `).get(storeName)?.cnt > 0;

    if (hasSallaData) {
      storeData.sallaOrders = {};

      storeData.sallaOrders.lifetime = db.prepare(`
        SELECT COUNT(*) as totalOrders, SUM(order_total) as totalRevenue, ROUND(AVG(order_total), 2) as avgOrderValue,
          MIN(date) as firstDate, MAX(date) as lastDate, COUNT(DISTINCT date) as daysWithData
        FROM salla_orders WHERE LOWER(store) = ?
      `).get(storeName);

      storeData.sallaOrders.last30Days = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue, ROUND(AVG(order_total), 2) as avgOrderValue
        FROM salla_orders WHERE LOWER(store) = ? AND date >= ?
      `).get(storeName, last30);

      storeData.sallaOrders.last7Days = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue, ROUND(AVG(order_total), 2) as avgOrderValue
        FROM salla_orders WHERE LOWER(store) = ? AND date >= ?
      `).get(storeName, last7);

      storeData.sallaOrders.today = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue
        FROM salla_orders WHERE LOWER(store) = ? AND date = ?
      `).get(storeName, today);

      storeData.sallaOrders.yesterday = db.prepare(`
        SELECT COUNT(*) as orders, SUM(order_total) as revenue
        FROM salla_orders WHERE LOWER(store) = ? AND date = ?
      `).get(storeName, yesterday);

      storeData.sallaOrders.monthlyTrends = db.prepare(`
        SELECT strftime('%Y-%m', date) as month, COUNT(*) as orders, SUM(order_total) as revenue,
          ROUND(AVG(order_total), 2) as avgOrderValue
        FROM salla_orders WHERE LOWER(store) = ?
        GROUP BY strftime('%Y-%m', date) ORDER BY month DESC
      `).all(storeName);

      storeData.sallaOrders.dailyOrders = db.prepare(`
        SELECT date, COUNT(*) as orders, SUM(order_total) as revenue
        FROM salla_orders WHERE LOWER(store) = ? AND date >= ?
        GROUP BY date ORDER BY date DESC
      `).all(storeName, last30);

      storeData.sallaOrders.ordersByCountry = db.prepare(`
        SELECT country_code, country, COUNT(*) as orders, SUM(order_total) as revenue,
          ROUND(AVG(order_total), 2) as avgOrderValue
        FROM salla_orders WHERE LOWER(store) = ?
        GROUP BY country_code ORDER BY orders DESC LIMIT 15
      `).all(storeName);

      storeData.sallaOrders.bestDays = db.prepare(`
        SELECT date, COUNT(*) as orders, SUM(order_total) as revenue
        FROM salla_orders WHERE LOWER(store) = ?
        GROUP BY date ORDER BY revenue DESC LIMIT 5
      `).all(storeName);

      storeData.sallaOrders.topCities = db.prepare(`
        SELECT city, country_code, COUNT(*) as orders, SUM(order_total) as revenue
        FROM salla_orders WHERE LOWER(store) = ? AND city IS NOT NULL AND city != ''
        GROUP BY city, country_code ORDER BY orders DESC LIMIT 10
      `).all(storeName);
    }

    // =========================================================================
    // DATA SOURCE SUMMARY - Shows what's connected
    // =========================================================================
    storeData.connectedSources = [];
    if (hasMetaData) storeData.connectedSources.push('Meta Ads');
    if (hasShopifyData) storeData.connectedSources.push('Shopify');
    if (hasSallaData) storeData.connectedSources.push('Salla');

  } catch (error) {
    console.error(`[getStoreDataFull] Error for ${storeName}:`, error.message);
  }

  return storeData;
}

function getRelevantData(store, question) {
  const db = getDb();
  const q = question.toLowerCase();

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Default to ALL available data for full business context
  // Only narrow down if user specifically asks for shorter period
  let daysBack = 365; // Full year by default
  
  if (q.includes('today only') || q.includes('just today')) {
    daysBack = 1;
  } else if (q.includes('yesterday only') || q.includes('just yesterday')) {
    daysBack = 2;
  } else if (q.includes('this week') || q.includes('past week') || q.includes('last 7')) {
    daysBack = 7;
  } else if (q.includes('2 week') || q.includes('two week') || q.includes('last 14')) {
    daysBack = 14;
  } else if (q.includes('this month') || q.includes('past month') || q.includes('last 30')) {
    daysBack = 30;
  }
  // Otherwise keep 365 days for full context
  
  const periodStart = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Also get the earliest date in the database for context (check all sources)
  let earliestDate = periodStart;
  const storeLower = store.toLowerCase();
  try {
    const dates = [];
    
    // Check Meta
    try {
      const meta = db.prepare(`SELECT MIN(date) as earliest FROM meta_daily_metrics WHERE LOWER(store) = ?`).get(storeLower);
      if (meta?.earliest) dates.push(meta.earliest);
    } catch (e) {}
    
    // Check Shopify
    try {
      const shopify = db.prepare(`SELECT MIN(date) as earliest FROM shopify_orders WHERE LOWER(store) = ?`).get(storeLower);
      if (shopify?.earliest) dates.push(shopify.earliest);
    } catch (e) {}
    
    // Check Salla
    try {
      const salla = db.prepare(`SELECT MIN(date) as earliest FROM salla_orders WHERE LOWER(store) = ?`).get(storeLower);
      if (salla?.earliest) dates.push(salla.earliest);
    } catch (e) {}
    
    // Use earliest of all sources
    if (dates.length > 0) {
      earliestDate = dates.sort()[0];
    }
  } catch (e) {}

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDate = new Date();

  const data = {
    dateContext: {
      today,
      todayDayName: dayNames[todayDate.getDay()],
      yesterday,
      yesterdayDayName: dayNames[new Date(Date.now() - 24 * 60 * 60 * 1000).getDay()],
      periodStart,
      periodEnd: today,
      periodDays: daysBack,
      dataAvailableFrom: earliestDate
    },
    currentStore: store.toLowerCase()
  };

  // Detect if question mentions the OTHER store
  const currentStore = store.toLowerCase();
  const mentionsVironax = q.includes('vironax') || q.includes('virona');
  const mentionsShawq = q.includes('shawq');
  const mentionsBoth = q.includes('both') || q.includes('compare') || q.includes('stores');

  // Always fetch current store with FULL data
  data[currentStore] = getStoreDataFull(db, currentStore, today, yesterday, periodStart);

  // Only fetch other store if mentioned
  if (mentionsBoth || (currentStore === 'vironax' && mentionsShawq) || (currentStore === 'shawq' && mentionsVironax)) {
    const otherStore = currentStore === 'vironax' ? 'shawq' : 'vironax';
    data[otherStore] = getStoreDataFull(db, otherStore, today, yesterday, periodStart);
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

// Transform country codes to display names in data
function transformCountryCodes(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => transformCountryCodes(item));
  }
  if (obj && typeof obj === 'object') {
    const transformed = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'country_code' && typeof value === 'string') {
        transformed[key] = value;
        transformed['country_display'] = COUNTRY_DISPLAY_NAMES[value] || value;
      } else if (key === 'country' && typeof value === 'string') {
        // Check if it's a 2-letter code
        transformed[key] = COUNTRY_DISPLAY_NAMES[value] || value;
      } else {
        transformed[key] = transformCountryCodes(value);
      }
    }
    return transformed;
  }
  return obj;
}

// ============================================================================
// DAILY SUMMARY (AM/PM) - Rigorous Growth Scientist Prompt
// ============================================================================

const DAILY_SUMMARY_SYSTEM_PROMPT = `You are the Principal Growth Scientist for two brands:

1) Virona — KSA/GCC men's jewelry (VironaX store)
2) Shawq — US/UK/EU apparel (Shawq store)

You produce twice-daily decision-grade reports (AM and PM).
Your job is to identify the most likely true constraints in the funnel, rank creatives with risk-adjusted logic, and recommend controlled budget and campaign actions.

IMPORTANT: Country code "AE" = UAE (United Arab Emirates)

Hard rules:
1) Use ONLY the data provided. Do not invent numbers, events, creatives, or platform changes.
2) If data is missing, say: "Data missing" and state how that limits confidence.
3) Avoid generic advice. Every recommendation must cite a specific data cue from input.
4) Prefer reversible changes unless confidence is High.
5) Separate Virona and Shawq analysis completely.

Pass 0 — Data Integrity Gate (must do before any actions):
Check for:
- Low volume
- Missing fields
- Sudden schema/metric gaps
- Partial-day distortions
If any risk is detected:
- State "Data integrity risk"
- Downgrade confidence by one level
- Limit actions to small, reversible moves

Funnel mechanics you must analyze as a chain:
Spend → Impressions → Clicks → Add to Cart (ATC) → Initiate Checkout (IC) → Purchases → Revenue

Use these key rates when provided:
- Click-Through Rate (CTR)
- Add-to-Cart rate (ATC rate)
- Initiate Checkout rate (IC rate)
- Purchase Conversion Rate (Purchase CVR)
- Average Order Value (AOV)
- Cost Per Acquisition (CPA)
- Return on Ad Spend (ROAS)
- Cost Per Click (CPC)
- Cost Per Mille (CPM)
- Frequency

Time windows (use all when available):
- Today-so-far
- Last 24 hours
- Last 7 days baseline

Constraint selection rule:
For each brand, select ONE primary constraint:
- Creative constraint
- Audience constraint
- Website/checkout constraint
- Budget allocation constraint
- Measurement constraint
You must justify the chosen constraint using at least two supporting data cues.

Creative ranking model (risk-adjusted):
1) Compute a Weighted Funnel Score per creative:
   - Top of Funnel (TOF) score: normalized CTR + any provided attention/hold metrics
   - Middle of Funnel (MOF) score: normalized ATC rate + normalized IC rate
   - Bottom of Funnel (BOF) score: normalized Purchase CVR + normalized CPA efficiency
   Overall Score = 0.35*TOF + 0.35*MOF + 0.30*BOF
2) Apply a Confidence Multiplier based on volume/stability.
3) Risk-Adjusted Creative Score = Overall Score × Confidence Multiplier
If some metrics are missing, reweight proportionally and state the reweighting.

Budget model — step-ladder with guardrails:
- SCALE only if efficiency is stable/improving AND upstream funnel is not deteriorating.
- SCALE step size: +10–15% for stable segments, +5–10% for noisy segments
- CUT only with multi-stage confirmation.
- CUT step size: -10–20% (up to -25% if high-confidence deterioration)
- HOLD when signals are mixed.
- If confidence is Low: no aggressive budget moves.

Campaign/audience action set (choose the least invasive option):
- Maintain
- Consolidate
- Isolate country
- Expand audience
- Narrow audience
- Rotate creatives
- Pause/delete
- Launch a new test campaign

PM accountability rule:
In every PM report, explicitly validate or reject the AM hypotheses.`;

function buildDailySummaryPrompt(reportType, data) {
  const today = new Date().toISOString().split('T')[0];
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  
  const transformedData = transformCountryCodes(data);
  
  if (reportType === 'am') {
    return `AM Review for ${today} (${dayName})

Objective:
Create a disciplined plan for today using:
- Today-so-far
- Last 24 hours
- Last 7 days baseline

Required:
- Identify the first-break point in the funnel chain.
- Select ONE primary constraint per brand.
- Rank creatives using the Risk-Adjusted Creative Score rules.
- Issue a precise budget decision: SCALE / HOLD / CUT with step size and guardrail.
- Recommend campaign/audience adjustments using the least invasive option.

Action constraints:
- No major restructures if confidence is Low.
- Prefer reversible moves.

Output format MUST be EXACT:

DATE: ${today}
REVIEW TYPE: AM

BRAND: Virona
1) Data Integrity Gate
2) Executive Snapshot
3) Funnel Chain + First-Break Point
4) Primary Constraint (choose 1)
5) Creative Leaderboard (Top 5 + Bottom 3, with Risk-Adjusted Scores)
6) Budget Decision (Scale/Hold/Cut + step size + guardrail)
7) Campaign/Audience Adjustments (max 4)
8) Clean Tests (max 2)

BRAND: Shawq
1) Data Integrity Gate
2) Executive Snapshot
3) Funnel Chain + First-Break Point
4) Primary Constraint (choose 1)
5) Creative Leaderboard (Top 5 + Bottom 3, with Risk-Adjusted Scores)
6) Budget Decision (Scale/Hold/Cut + step size + guardrail)
7) Campaign/Audience Adjustments (max 4)
8) Clean Tests (max 2)

PLATFORM DATA:
${JSON.stringify(transformedData, null, 2)}`;
  } else {
    return `PM Review for ${today} (${dayName})

Objective:
Audit today vs:
- Yesterday
- Last 7 days baseline

Required:
- Confirm whether the primary constraint was correct.
- Validate or reject your AM hypotheses explicitly.
- Update the creative leaderboard using the Risk-Adjusted model.
- Decide whether today's budget moves should be kept, reversed, or cautiously expanded.
- End each brand's Budget Decision section with a one-line "Tomorrow Plan".

Output format MUST be EXACT:

DATE: ${today}
REVIEW TYPE: PM

BRAND: Virona
1) Data Integrity Gate
2) Executive Snapshot
3) Funnel Chain + First-Break Point
4) Primary Constraint (choose 1)
5) Creative Leaderboard (Top 5 + Bottom 3, with Risk-Adjusted Scores)
6) Budget Decision (Scale/Hold/Cut + step size + guardrail)
7) Campaign/Audience Adjustments (max 4)
8) AM→PM Hypothesis Check
9) Clean Tests (max 2)

BRAND: Shawq
1) Data Integrity Gate
2) Executive Snapshot
3) Funnel Chain + First-Break Point
4) Primary Constraint (choose 1)
5) Creative Leaderboard (Top 5 + Bottom 3, with Risk-Adjusted Scores)
6) Budget Decision (Scale/Hold/Cut + step size + guardrail)
7) Campaign/Audience Adjustments (max 4)
8) AM→PM Hypothesis Check
9) Clean Tests (max 2)

PLATFORM DATA:
${JSON.stringify(transformedData, null, 2)}`;
  }
}

// ============================================================================
// PROMPT BUILDING
// ============================================================================

function buildSystemPrompt(store, mode, data, history = []) {
  const hasOtherStore = data.vironax && data.shawq;
  const s = store.toLowerCase();
  
  // Dynamically detect connected sources from data
  const storeData = data[s] || data;
  const connectedSources = storeData.connectedSources || [];
  
  let storeInfo = '';
  let dataSourceInfo = '';
  
  if (hasOtherStore) {
    storeInfo = `You have data for BOTH stores:
- VironaX (Saudi Arabia, SAR, mens jewelry)
- Shawq (Turkey/US, USD, apparel)`;
    dataSourceInfo = 'Multiple stores - check connectedSources for each';
  } else if (s === 'vironax') {
    storeInfo = 'Store: VironaX (Saudi Arabia, SAR currency, mens jewelry)';
    dataSourceInfo = `Connected: ${connectedSources.join(', ') || 'checking...'}`;
  } else {
    storeInfo = 'Store: Shawq (Turkey/US markets, USD currency, Palestinian & Syrian apparel)';
    dataSourceInfo = `Connected: ${connectedSources.join(', ') || 'checking...'}`;
  }

  // Build conversation context
  let conversationContext = '';
  if (history && history.length > 0) {
    conversationContext = `\n\nRECENT CONVERSATION:
${history.map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`).join('\n')}
---`;
  }

  const periodDays = data.dateContext?.periodDays || 365;
  const periodLabel = periodDays === 1 ? 'today' : 
                      periodDays === 7 ? 'last 7 days' : 
                      periodDays === 14 ? 'last 2 weeks' :
                      periodDays === 30 ? 'last 30 days' :
                      periodDays === 90 ? 'last 90 days' :
                      periodDays === 365 ? 'full history' :
                      `last ${periodDays} days`;

  // Build dynamic data description based on what's connected
  let dataDescription = 'DATA SOURCES AVAILABLE:\n';
  
  if (storeData.metaAds) {
    dataDescription += `
META ADS (advertising) - ONLY ACTIVE CAMPAIGNS/ADSETS/ADS (with activity in last 14 days):
- Lifetime totals (spend, revenue, ROAS, CPA)
- Monthly trends
- Campaign performance (top active campaigns only)
- Ad Set performance (top active ad sets with parent campaign)
- Ad performance (top active ads with parent ad set and campaign)
- Today vs yesterday ad performance
- Best performing days by ad revenue
NOTE: Inactive/paused campaigns are excluded from the data.`;
  }
  
  if (storeData.shopifyOrders) {
    dataDescription += `
SHOPIFY ORDERS:
- Lifetime order totals and revenue
- Monthly order trends (full history)
- Daily orders (last 30 days)
- Orders by country (all-time and recent)
- Top cities
- Best performing days by order revenue
- Payment methods breakdown`;
  }
  
  if (storeData.sallaOrders) {
    dataDescription += `
SALLA ORDERS:
- Lifetime order totals and revenue (SAR)
- Monthly order trends
- Daily orders (last 30 days)
- Orders by country (GCC focus)
- Top cities
- Best performing days`;
  }

  const basePrompt = `You are an expert e-commerce analyst with FULL access to this business's historical data.
${storeInfo}
${dataSourceInfo}

TODAY: ${data.dateContext?.today} (${data.dateContext?.todayDayName})
YESTERDAY: ${data.dateContext?.yesterday} (${data.dateContext?.yesterdayDayName})
DATA AVAILABLE FROM: ${data.dateContext?.dataAvailableFrom || 'first recorded date'}
${conversationContext}

${dataDescription}

BUSINESS DATA (${periodLabel}):
${JSON.stringify(data, null, 2)}

CHART GENERATION:
You can generate visual charts by including a chart block in your response. Use this format:

\`\`\`chart
{
  "type": "line|bar|pie|area",
  "title": "Chart Title",
  "data": [{"name": "Label", "value": 123}, ...],
  "xKey": "name",
  "yKey": "value"
}
\`\`\`

Chart types:
- "line" - for trends over time (daily, monthly)
- "bar" - for comparing categories (countries, campaigns)
- "pie" - for showing proportions/breakdowns
- "area" - for cumulative trends

For multiple series, use yKeys array: "yKeys": ["revenue", "orders"]

Example - Monthly Revenue:
\`\`\`chart
{"type": "line", "title": "Monthly Revenue", "data": [{"month": "Jan", "revenue": 5000}, {"month": "Feb", "revenue": 6200}], "xKey": "month", "yKey": "revenue"}
\`\`\`

ALWAYS generate a chart when the user asks for visualization, trends, comparisons, or breakdowns.
Use REAL data from the business data above - never make up numbers.

RULES:
- Use this data to understand the FULL business context
- Compare recent performance to historical trends  
- Identify patterns, seasonality, and anomalies
- VironaX = SAR currency, Shawq = USD currency
- metaAds = advertising data (spend, ROAS), shopifyOrders/sallaOrders = actual orders
- Be specific with real figures from the data
- When asked general questions like "how's my store", give a holistic view using all available data
- Generate charts when visualizing data would help the user understand better`;

  if (mode === 'analyze') {
    return basePrompt + '\n\nMODE: Quick answer in 2-3 sentences. Include a chart if asked for trends or comparisons.';
  }
  if (mode === 'summarize') {
    return basePrompt + '\n\nMODE: Summarize trends across the full data range, compare periods, flag anomalies. Include charts to visualize key trends and breakdowns.';
  }
  return basePrompt + `\n\nMODE: Strategic Decisions
- Use historical context to inform recommendations
- Compare current performance to past trends
- Identify what's working vs what worked before
- Give detailed, actionable recommendations with specific numbers
- Include charts to support your analysis when helpful
- Prioritize by impact based on historical performance`;
}

// ============================================================================
// API CALLS - GPT-5 Responses API + GPT-4 fallback
// ============================================================================

async function callResponsesAPI(model, systemPrompt, userMessage, maxTokens, reasoningEffort = null) {
  console.log(`[OpenAI] Calling ${model} (max_tokens: ${maxTokens})`);

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
    console.log(`[OpenAI] Streaming ${primary}`);
    const stream = await client.chat.completions.create({
      model: primary,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
      stream: true
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) onDelta(delta);
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

export async function analyzeQuestion(question, store, history = []) {
  const data = getRelevantData(store, question);
  const systemPrompt = buildSystemPrompt(store, 'analyze', data, history);
  return await callWithFallback(MODELS.NANO, FALLBACK_MODELS.NANO, systemPrompt, question, TOKEN_LIMITS.nano);
}

export async function summarizeData(question, store, history = []) {
  const data = getRelevantData(store, question);
  const systemPrompt = buildSystemPrompt(store, 'summarize', data, history);
  return await callWithFallback(MODELS.MINI, FALLBACK_MODELS.MINI, systemPrompt, question, TOKEN_LIMITS.mini);
}

export async function decideQuestion(question, store, depth = 'balanced', history = []) {
  const data = getRelevantData(store, question);
  const systemPrompt = buildSystemPrompt(store, 'decide', data, history);
  const effort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;
  
  const result = await callWithFallback(MODELS.STRATEGIST, FALLBACK_MODELS.STRATEGIST, systemPrompt, question, maxTokens, effort);
  return { ...result, reasoning: effort };
}

export async function decideQuestionStream(question, store, depth = 'balanced', onDelta, history = []) {
  const data = getRelevantData(store, question);
  const systemPrompt = buildSystemPrompt(store, 'decide', data, history);
  const effort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;

  return await streamWithFallback(MODELS.STRATEGIST, FALLBACK_MODELS.STRATEGIST, systemPrompt, question, maxTokens, effort, onDelta);
}

// Streaming versions for Analyze and Summarize
export async function analyzeQuestionStream(question, store, onDelta, history = []) {
  const data = getRelevantData(store, question);
  const systemPrompt = buildSystemPrompt(store, 'analyze', data, history);
  return await streamWithFallback(MODELS.NANO, FALLBACK_MODELS.NANO, systemPrompt, question, TOKEN_LIMITS.nano, null, onDelta);
}

export async function summarizeDataStream(question, store, onDelta, history = []) {
  const data = getRelevantData(store, question);
  const systemPrompt = buildSystemPrompt(store, 'summarize', data, history);
  return await streamWithFallback(MODELS.MINI, FALLBACK_MODELS.MINI, systemPrompt, question, TOKEN_LIMITS.mini, null, onDelta);
}

// ============================================================================
// DAILY SUMMARY - AM/PM Reports (GPT-5.1 Deep only)
// ============================================================================

export async function dailySummary(reportType = 'am') {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Get BOTH stores data
  const data = {
    reportType,
    generatedAt: new Date().toISOString(),
    vironax: getStoreDataFull(db, 'vironax', today, yesterday, last30),
    shawq: getStoreDataFull(db, 'shawq', today, yesterday, last30)
  };

  const userPrompt = buildDailySummaryPrompt(reportType, data);
  
  // Always use GPT-5.1 (STRATEGIST) with deep reasoning for daily summary
  return await callWithFallback(
    MODELS.STRATEGIST,
    FALLBACK_MODELS.STRATEGIST,
    DAILY_SUMMARY_SYSTEM_PROMPT,
    userPrompt,
    TOKEN_LIMITS.deep,
    DEPTH_TO_EFFORT['deep']
  );
}

export async function dailySummaryStream(reportType = 'am', onDelta) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  // Get BOTH stores data for comprehensive report
  const data = {
    reportType,
    generatedAt: new Date().toISOString(),
    today,
    yesterday,
    vironax: getStoreDataFull(db, 'vironax', today, yesterday, last30),
    shawq: getStoreDataFull(db, 'shawq', today, yesterday, last30)
  };

  const userPrompt = buildDailySummaryPrompt(reportType, data);

  console.log(`[DailySummary] Streaming ${reportType.toUpperCase()} report with GPT-5.1 Deep`);
  console.log(`[DailySummary] VironaX sources: ${data.vironax?.connectedSources?.join(', ') || 'none'}`);
  console.log(`[DailySummary] Shawq sources: ${data.shawq?.connectedSources?.join(', ') || 'none'}`);
  
  // Always use GPT-5.1 (STRATEGIST) with deep reasoning for daily summary
  return await streamWithFallback(
    MODELS.STRATEGIST,
    FALLBACK_MODELS.STRATEGIST,
    DAILY_SUMMARY_SYSTEM_PROMPT,
    userPrompt,
    TOKEN_LIMITS.deep,
    DEPTH_TO_EFFORT['deep'],
    onDelta
  );
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
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return { success: true, data: db.prepare(sql).all(...params) };
    }
    return { success: false, error: 'Only SELECT queries allowed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
