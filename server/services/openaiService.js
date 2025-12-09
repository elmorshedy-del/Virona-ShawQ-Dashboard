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
// OPTIMIZED DATA FETCHING - Parallel queries, smart store detection
// ============================================================================

function getStoreData(db, storeName, today, yesterday, periodStart) {
  // Keep original for backwards compatibility
  return getStoreDataFull(db, storeName, today, yesterday, periodStart);
}

function getStoreDataFull(db, storeName, today, yesterday, periodStart) {
  const storeData = {};
  
  try {
    // LIFETIME totals (all data ever)
    storeData.lifetime = db.prepare(`
      SELECT 
        SUM(spend) as totalSpend,
        SUM(conversion_value) as totalRevenue,
        SUM(conversions) as totalOrders,
        ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
        ROUND(SUM(spend) / NULLIF(SUM(conversions), 0), 2) as cpa,
        MIN(date) as firstDate,
        MAX(date) as lastDate,
        COUNT(DISTINCT date) as daysWithData
      FROM meta_daily_metrics 
      WHERE LOWER(store) = ?
    `).get(storeName);

    // Last 30 days summary
    const last30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    storeData.last30Days = db.prepare(`
      SELECT 
        SUM(spend) as spend,
        SUM(conversion_value) as revenue,
        SUM(conversions) as orders,
        ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
      FROM meta_daily_metrics 
      WHERE LOWER(store) = ? AND date >= ?
    `).get(storeName, last30);

    // Last 7 days summary
    const last7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    storeData.last7Days = db.prepare(`
      SELECT 
        SUM(spend) as spend,
        SUM(conversion_value) as revenue,
        SUM(conversions) as orders,
        ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
      FROM meta_daily_metrics 
      WHERE LOWER(store) = ? AND date >= ?
    `).get(storeName, last7);

    // Today
    storeData.today = db.prepare(`
      SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as orders
      FROM meta_daily_metrics WHERE LOWER(store) = ? AND date = ?
    `).get(storeName, today);

    // Yesterday
    storeData.yesterday = db.prepare(`
      SELECT SUM(spend) as spend, SUM(conversion_value) as revenue, SUM(conversions) as orders
      FROM meta_daily_metrics WHERE LOWER(store) = ? AND date = ?
    `).get(storeName, yesterday);

    // Monthly trends (last 6 months)
    storeData.monthlyTrends = db.prepare(`
      SELECT 
        strftime('%Y-%m', date) as month,
        SUM(spend) as spend,
        SUM(conversion_value) as revenue,
        SUM(conversions) as orders,
        ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
      FROM meta_daily_metrics 
      WHERE LOWER(store) = ? AND date >= date('now', '-6 months')
      GROUP BY strftime('%Y-%m', date)
      ORDER BY month DESC
    `).all(storeName);

    // Top campaigns (lifetime performance)
    storeData.topCampaigns = db.prepare(`
      SELECT 
        campaign_name,
        SUM(spend) as spend, 
        SUM(conversion_value) as revenue, 
        SUM(conversions) as orders,
        ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
        MIN(date) as firstSeen,
        MAX(date) as lastSeen
      FROM meta_daily_metrics 
      WHERE LOWER(store) = ? AND campaign_name IS NOT NULL
      GROUP BY campaign_name
      ORDER BY revenue DESC LIMIT 10
    `).all(storeName);

    // Recent campaign performance (last 7 days)
    storeData.recentCampaigns = db.prepare(`
      SELECT 
        campaign_name,
        SUM(spend) as spend, 
        SUM(conversion_value) as revenue, 
        SUM(conversions) as orders,
        ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
      FROM meta_daily_metrics 
      WHERE LOWER(store) = ? AND date >= ? AND campaign_name IS NOT NULL
      GROUP BY campaign_name
      ORDER BY spend DESC LIMIT 10
    `).all(storeName, last7);

    // Best performing days
    storeData.bestDays = db.prepare(`
      SELECT date, SUM(conversion_value) as revenue, SUM(conversions) as orders, SUM(spend) as spend
      FROM meta_daily_metrics 
      WHERE LOWER(store) = ?
      GROUP BY date
      ORDER BY revenue DESC LIMIT 5
    `).all(storeName);

    // Worst performing days (with spend > 0)
    storeData.worstDays = db.prepare(`
      SELECT date, SUM(conversion_value) as revenue, SUM(conversions) as orders, SUM(spend) as spend,
        ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
      FROM meta_daily_metrics 
      WHERE LOWER(store) = ? AND spend > 0
      GROUP BY date
      ORDER BY roas ASC LIMIT 5
    `).all(storeName);

    // E-commerce orders - SKIP Salla for VironaX (has demo data, not connected yet)
    if (storeName === 'shawq') {
      try {
        storeData.ordersOverview = db.prepare(`
          SELECT COUNT(*) as totalOrders, SUM(order_total) as totalRevenue
          FROM shopify_orders WHERE LOWER(store) = ? AND date >= ?
        `).get(storeName, periodStart);

        storeData.ordersToday = db.prepare(`
          SELECT COUNT(*) as orders, SUM(order_total) as revenue
          FROM shopify_orders WHERE LOWER(store) = ? AND date = ?
        `).get(storeName, today);

        storeData.ordersByCountry = db.prepare(`
          SELECT country_code, COUNT(*) as orders, SUM(order_total) as revenue
          FROM shopify_orders WHERE LOWER(store) = ? AND date >= ?
          GROUP BY country_code ORDER BY orders DESC LIMIT 10
        `).all(storeName, periodStart);
      } catch (e) {}
    }

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
  
  // Also get the earliest date in the database for context
  let earliestDate = periodStart;
  try {
    const earliest = db.prepare(`
      SELECT MIN(date) as earliest FROM meta_daily_metrics WHERE LOWER(store) = ?
    `).get(store.toLowerCase());
    if (earliest?.earliest) {
      earliestDate = earliest.earliest;
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

// ============================================================================
// PROMPT BUILDING
// ============================================================================

function buildSystemPrompt(store, mode, data, history = []) {
  const hasOtherStore = data.vironax && data.shawq;
  
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
                      periodDays === 365 ? 'full history (up to 1 year)' :
                      `last ${periodDays} days`;

  const basePrompt = `You are an expert e-commerce analyst with FULL access to this business's historical data.
${storeInfo}

TODAY: ${data.dateContext?.today} (${data.dateContext?.todayDayName})
YESTERDAY: ${data.dateContext?.yesterday} (${data.dateContext?.yesterdayDayName})
DATA AVAILABLE FROM: ${data.dateContext?.dataAvailableFrom || 'unknown'}
${conversationContext}

BUSINESS DATA (${periodLabel}):
${JSON.stringify(data, null, 2)}

YOU HAVE ACCESS TO:
- Lifetime totals and averages
- Monthly trends (last 6 months)
- Last 30 days vs last 7 days comparison
- Top performing campaigns (all-time)
- Recent campaign performance
- Best and worst performing days
- Today vs yesterday

RULES:
- Use this data to understand the FULL business context
- Compare recent performance to historical trends
- Identify patterns, seasonality, and anomalies
- VironaX = SAR currency, Shawq = USD currency
- ROAS = revenue/spend
- Be specific with real figures from the data
- When asked general questions like "how's my store", give a holistic view using all available data`;

  if (mode === 'analyze') {
    return basePrompt + '\n\nMODE: Quick answer in 2-3 sentences, but informed by full context.';
  }
  if (mode === 'summarize') {
    return basePrompt + '\n\nMODE: Summarize trends across the full data range, compare periods, flag anomalies.';
  }
  return basePrompt + `\n\nMODE: Strategic Decisions
- Use historical context to inform recommendations
- Compare current performance to past trends
- Identify what's working vs what worked before
- Give detailed, actionable recommendations with specific numbers
- Prioritize by impact based on historical performance`;
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
