import OpenAI from 'openai';
import { getDb } from '../db/database.js';

// ============================================================================
// OpenAI Client Setup
// ============================================================================
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ============================================================================
// Model Configuration
// ============================================================================
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

// Token limits (bumped +40% for full AI panel)
const TOKEN_LIMITS = {
  nano: 170,
  mini: 340,
  instant: 320,
  fast: 320,
  balanced: 450,
  deep: 560
};

// UI depth labels → API reasoning effort
const DEPTH_TO_EFFORT = {
  instant: 'none',
  fast: 'low',
  balanced: 'medium',
  deep: 'high'
};

// ============================================================================
// Database Query Helper - Execute SQL and return results
// ============================================================================
function queryDatabase(sql, params = []) {
  const db = getDb();
  try {
    // Only allow SELECT queries for safety
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      return { success: false, error: 'Only SELECT queries allowed', data: [] };
    }
    const results = db.prepare(sql).all(...params);
    return { success: true, data: results, rowCount: results.length };
  } catch (error) {
    console.error('[DB Query Error]', error.message);
    return { success: false, error: error.message, data: [] };
  }
}

// ============================================================================
// Pre-fetch relevant data based on question type
// ============================================================================
function getRelevantData(store, question) {
  const db = getDb();
  const data = {};
  const q = question.toLowerCase();
  
  // Get date range (last 7 days default, last 30 for trends)
  const today = new Date().toISOString().split('T')[0];
  const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  
  try {
    // Always get overview metrics
    data.overview = db.prepare(`
      SELECT 
        SUM(spend) as totalSpend,
        SUM(conversion_value) as totalRevenue,
        SUM(conversions) as totalOrders,
        SUM(impressions) as totalImpressions,
        SUM(clicks) as totalClicks,
        ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
        ROUND(SUM(spend) / NULLIF(SUM(conversions), 0), 2) as cpa
      FROM meta_daily_metrics 
      WHERE store = ? AND date >= ?
    `).get(store, last7Days);

    // Get today's data
    data.today = db.prepare(`
      SELECT 
        SUM(spend) as spend,
        SUM(conversion_value) as revenue,
        SUM(conversions) as orders
      FROM meta_daily_metrics 
      WHERE store = ? AND date = ?
    `).get(store, today);

    // Get yesterday's data for comparison
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    data.yesterday = db.prepare(`
      SELECT 
        SUM(spend) as spend,
        SUM(conversion_value) as revenue,
        SUM(conversions) as orders
      FROM meta_daily_metrics 
      WHERE store = ? AND date = ?
    `).get(store, yesterday);

    // If asking about campaigns
    if (q.includes('campaign') || q.includes('scale') || q.includes('pause') || q.includes('budget')) {
      data.campaigns = db.prepare(`
        SELECT 
          campaign_name,
          campaign_id,
          SUM(spend) as spend,
          SUM(conversion_value) as revenue,
          SUM(conversions) as orders,
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
          ROUND(SUM(spend) / NULLIF(SUM(conversions), 0), 2) as cpa,
          ROUND(SUM(clicks) * 100.0 / NULLIF(SUM(impressions), 0), 2) as ctr
        FROM meta_daily_metrics 
        WHERE store = ? AND date >= ? AND campaign_name IS NOT NULL
        GROUP BY campaign_id, campaign_name
        ORDER BY spend DESC
        LIMIT 20
      `).all(store, last7Days);
    }

    // If asking about ad sets
    if (q.includes('adset') || q.includes('ad set')) {
      data.adsets = db.prepare(`
        SELECT 
          campaign_name,
          adset_name,
          adset_id,
          SUM(spend) as spend,
          SUM(conversion_value) as revenue,
          SUM(conversions) as orders,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
          ROUND(SUM(spend) / NULLIF(SUM(conversions), 0), 2) as cpa
        FROM meta_adset_metrics 
        WHERE store = ? AND date >= ?
        GROUP BY adset_id, adset_name, campaign_name
        ORDER BY spend DESC
        LIMIT 20
      `).all(store, last7Days);
    }

    // If asking about ads/creatives
    if (q.includes('ad') || q.includes('creative') || q.includes('which ad')) {
      data.ads = db.prepare(`
        SELECT 
          campaign_name,
          adset_name,
          ad_name,
          ad_id,
          SUM(spend) as spend,
          SUM(conversion_value) as revenue,
          SUM(conversions) as orders,
          SUM(clicks) as clicks,
          SUM(impressions) as impressions,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
          ROUND(SUM(clicks) * 100.0 / NULLIF(SUM(impressions), 0), 2) as ctr
        FROM meta_ad_metrics 
        WHERE store = ? AND date >= ?
        GROUP BY ad_id, ad_name, adset_name, campaign_name
        ORDER BY spend DESC
        LIMIT 30
      `).all(store, last7Days);
    }

    // If asking about countries
    if (q.includes('country') || q.includes('countr') || q.includes('saudi') || q.includes('uae') || q.includes('geo')) {
      data.countries = db.prepare(`
        SELECT 
          country,
          SUM(spend) as spend,
          SUM(conversion_value) as revenue,
          SUM(conversions) as orders,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas,
          ROUND(SUM(spend) / NULLIF(SUM(conversions), 0), 2) as cpa
        FROM meta_daily_metrics 
        WHERE store = ? AND date >= ? AND country != 'ALL' AND country IS NOT NULL
        GROUP BY country
        ORDER BY spend DESC
      `).all(store, last7Days);
    }

    // If asking about trends
    if (q.includes('trend') || q.includes('daily') || q.includes('week') || q.includes('over time')) {
      data.dailyTrends = db.prepare(`
        SELECT 
          date,
          SUM(spend) as spend,
          SUM(conversion_value) as revenue,
          SUM(conversions) as orders,
          ROUND(SUM(conversion_value) / NULLIF(SUM(spend), 0), 2) as roas
        FROM meta_daily_metrics 
        WHERE store = ? AND date >= ?
        GROUP BY date
        ORDER BY date DESC
        LIMIT 14
      `).all(store, last30Days);
    }

    // If asking about orders (from e-commerce platform)
    if (q.includes('order') || q.includes('sale') || q.includes('revenue')) {
      const orderTable = store === 'vironax' ? 'salla_orders' : 'shopify_orders';
      data.recentOrders = db.prepare(`
        SELECT 
          date,
          COUNT(*) as order_count,
          SUM(order_total) as revenue,
          country_code
        FROM ${orderTable}
        WHERE store = ? AND date >= ?
        GROUP BY date
        ORDER BY date DESC
        LIMIT 7
      `).all(store, last7Days);
    }

    // If asking about funnel
    if (q.includes('funnel') || q.includes('conversion') || q.includes('drop')) {
      data.funnel = db.prepare(`
        SELECT 
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(landing_page_views) as landing_page_views,
          SUM(add_to_cart) as add_to_cart,
          SUM(checkouts_initiated) as checkouts,
          SUM(conversions) as purchases
        FROM meta_daily_metrics 
        WHERE store = ? AND date >= ?
      `).get(store, last7Days);
    }

  } catch (error) {
    console.error('[Data Fetch Error]', error.message);
  }

  return data;
}

// ============================================================================
// Build System Prompt with actual data
// ============================================================================
function buildSystemPrompt(store, mode, data) {
  const storeContext = store === 'vironax' 
    ? 'VironaX (Saudi Arabia, SAR currency, Salla e-commerce, mens jewelry)'
    : 'Shawq (Turkey/US, USD currency, Shopify, Palestinian & Syrian apparel)';

  const currency = store === 'vironax' ? 'SAR' : 'USD';

  let dataContext = `\n\nACTUAL DATA FROM DATABASE:\n`;
  dataContext += JSON.stringify(data, null, 2);

  const basePrompt = `You are an AI analytics assistant for ${storeContext}.

Currency: ${currency}

IMPORTANT RULES:
1. Use ONLY the actual data provided below - never make up numbers
2. Format currency with 2 decimals and commas (e.g., 1,234.56 ${currency})
3. Calculate metrics: ROAS = revenue/spend, CPA = spend/orders, CTR = clicks/impressions * 100
4. If data is missing for something asked, say "I don't have data for that"
5. Be specific with numbers from the data
${dataContext}`;

  if (mode === 'analyze') {
    return basePrompt + `

MODE: Quick Analysis (GPT-5 nano)
- Give very concise, direct answers
- Just the facts and numbers
- Maximum 2-3 sentences
- Format: "Your [metric] is [value]" style`;
  }

  if (mode === 'summarize') {
    return basePrompt + `

MODE: Trends & Patterns (GPT-5 mini)
- Summarize the data clearly
- Compare metrics (today vs yesterday, this week vs last)
- Flag anything unusual (big changes, anomalies)
- Use bullet points for clarity
- Be thorough but organized`;
  }

  // Decide mode
  return basePrompt + `

MODE: Strategic Decisions (GPT-5.1)
- Provide actionable recommendations based on the data
- Diagnose problems with specific root causes
- Propose specific actions with expected outcomes
- Prioritize by impact
- Be decisive - give clear recommendations, not just options
- Include specific numbers and targets`;
}

// ============================================================================
// Call GPT-5 via Responses API
// ============================================================================
async function callResponsesAPI(model, systemPrompt, userMessage, maxTokens, reasoningEffort = null) {
  const input = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  const requestBody = {
    model: model,
    input: input,
    max_output_tokens: maxTokens
  };

  // Add reasoning effort for GPT-5.1
  if (reasoningEffort && model.includes('5.1')) {
    requestBody.reasoning = { effort: reasoningEffort };
  }

  console.log(`[AI] Calling ${model} via Responses API...`);

  const response = await client.responses.create(requestBody);
  return response.output_text;
}

// ============================================================================
// Call GPT-4 via Chat Completions API (fallback)
// ============================================================================
async function callChatCompletionsAPI(model, systemPrompt, userMessage, maxTokens) {
  console.log(`[AI] Calling ${model} via Chat Completions API (fallback)...`);

  const response = await client.chat.completions.create({
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    max_tokens: maxTokens,
    temperature: 0.7
  });

  return response.choices[0].message.content;
}

// ============================================================================
// ANALYZE - GPT-5 nano (Quick metrics)
// ============================================================================
export async function analyzeQuestion(question, store) {
  console.log(`\n[AI Analyze] Question: "${question}" | Store: ${store}`);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  // Get relevant data from database
  const data = getRelevantData(store, question);
  console.log(`[AI Analyze] Fetched data keys:`, Object.keys(data));

  // Build prompt with actual data
  const systemPrompt = buildSystemPrompt(store, 'analyze', data);

  // Try GPT-5 nano first
  try {
    const text = await callResponsesAPI(MODELS.NANO, systemPrompt, question, TOKEN_LIMITS.nano);
    console.log(`[AI Analyze] Success with ${MODELS.NANO}`);
    return { text, model: MODELS.NANO };
  } catch (error) {
    console.error(`[AI Analyze] ${MODELS.NANO} failed:`, error.message);
  }

  // Fallback to GPT-4o-mini
  try {
    const text = await callChatCompletionsAPI(FALLBACK_MODELS.NANO, systemPrompt, question, TOKEN_LIMITS.nano);
    console.log(`[AI Analyze] Success with ${FALLBACK_MODELS.NANO} (fallback)`);
    return { text, model: `${FALLBACK_MODELS.NANO} (fallback)` };
  } catch (error) {
    console.error(`[AI Analyze] Fallback failed:`, error.message);
    throw new Error(`AI request failed: ${error.message}`);
  }
}

// ============================================================================
// SUMMARIZE - GPT-5 mini (Trends & patterns)
// ============================================================================
export async function summarizeData(question, store) {
  console.log(`\n[AI Summarize] Question: "${question}" | Store: ${store}`);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  // Get relevant data from database
  const data = getRelevantData(store, question);
  console.log(`[AI Summarize] Fetched data keys:`, Object.keys(data));

  // Build prompt with actual data
  const systemPrompt = buildSystemPrompt(store, 'summarize', data);

  // Try GPT-5 mini first
  try {
    const text = await callResponsesAPI(MODELS.MINI, systemPrompt, question, TOKEN_LIMITS.mini);
    console.log(`[AI Summarize] Success with ${MODELS.MINI}`);
    return { text, model: MODELS.MINI };
  } catch (error) {
    console.error(`[AI Summarize] ${MODELS.MINI} failed:`, error.message);
  }

  // Fallback to GPT-4o
  try {
    const text = await callChatCompletionsAPI(FALLBACK_MODELS.MINI, systemPrompt, question, TOKEN_LIMITS.mini);
    console.log(`[AI Summarize] Success with ${FALLBACK_MODELS.MINI} (fallback)`);
    return { text, model: `${FALLBACK_MODELS.MINI} (fallback)` };
  } catch (error) {
    console.error(`[AI Summarize] Fallback failed:`, error.message);
    throw new Error(`AI request failed: ${error.message}`);
  }
}

// ============================================================================
// DECIDE - GPT-5.1 with reasoning (Non-streaming)
// ============================================================================
export async function decideQuestion(question, store, depth = 'balanced') {
  console.log(`\n[AI Decide] Question: "${question}" | Store: ${store} | Depth: ${depth}`);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const reasoningEffort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;

  // Get relevant data from database
  const data = getRelevantData(store, question);
  console.log(`[AI Decide] Fetched data keys:`, Object.keys(data));

  // Build prompt with actual data
  const systemPrompt = buildSystemPrompt(store, 'decide', data);

  // Try GPT-5.1 first
  try {
    const text = await callResponsesAPI(MODELS.STRATEGIST, systemPrompt, question, maxTokens, reasoningEffort);
    console.log(`[AI Decide] Success with ${MODELS.STRATEGIST} (effort: ${reasoningEffort})`);
    return { text, model: MODELS.STRATEGIST, reasoning: reasoningEffort };
  } catch (error) {
    console.error(`[AI Decide] ${MODELS.STRATEGIST} failed:`, error.message);
  }

  // Fallback to GPT-4o
  try {
    const text = await callChatCompletionsAPI(FALLBACK_MODELS.STRATEGIST, systemPrompt, question, maxTokens);
    console.log(`[AI Decide] Success with ${FALLBACK_MODELS.STRATEGIST} (fallback)`);
    return { text, model: `${FALLBACK_MODELS.STRATEGIST} (fallback)`, reasoning: null };
  } catch (error) {
    console.error(`[AI Decide] Fallback failed:`, error.message);
    throw new Error(`AI request failed: ${error.message}`);
  }
}

// ============================================================================
// DECIDE STREAMING - GPT-5.1 with streaming
// ============================================================================
export async function decideQuestionStream(question, store, depth = 'balanced', onText) {
  console.log(`\n[AI Decide Stream] Question: "${question}" | Store: ${store} | Depth: ${depth}`);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const reasoningEffort = DEPTH_TO_EFFORT[depth] || 'medium';
  const maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;

  // Get relevant data from database
  const data = getRelevantData(store, question);
  console.log(`[AI Decide Stream] Fetched data keys:`, Object.keys(data));

  // Build prompt with actual data
  const systemPrompt = buildSystemPrompt(store, 'decide', data);

  const input = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question }
  ];

  const requestBody = {
    model: MODELS.STRATEGIST,
    input: input,
    max_output_tokens: maxTokens,
    reasoning: { effort: reasoningEffort }
  };

  // Try GPT-5.1 streaming first
  try {
    console.log(`[AI Decide Stream] Calling ${MODELS.STRATEGIST} with streaming...`);
    const stream = await client.responses.stream(requestBody);

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        onText?.(event.delta);
      }
    }

    const final = await stream.finalResponse();
    console.log(`[AI Decide Stream] Success with ${MODELS.STRATEGIST}`);
    return { text: final.output_text, model: MODELS.STRATEGIST, reasoning: reasoningEffort };
  } catch (error) {
    console.error(`[AI Decide Stream] ${MODELS.STRATEGIST} streaming failed:`, error.message);
  }

  // Fallback to non-streaming GPT-4o
  try {
    console.log(`[AI Decide Stream] Falling back to ${FALLBACK_MODELS.STRATEGIST} (non-streaming)...`);
    const text = await callChatCompletionsAPI(FALLBACK_MODELS.STRATEGIST, systemPrompt, question, maxTokens);
    onText?.(text); // Send all at once
    console.log(`[AI Decide Stream] Success with ${FALLBACK_MODELS.STRATEGIST} (fallback)`);
    return { text, model: `${FALLBACK_MODELS.STRATEGIST} (fallback)`, reasoning: null };
  } catch (error) {
    console.error(`[AI Decide Stream] Fallback failed:`, error.message);
    throw new Error(`AI request failed: ${error.message}`);
  }
}

// ============================================================================
// Direct Query (for testing)
// ============================================================================
export function runQuery(sql, params = []) {
  return queryDatabase(sql, params);
}

// ============================================================================
// Legacy compatibility
// ============================================================================
export async function askAnalyticsQuestion(question, dashboardData, store, reasoningEffort) {
  const result = await decideQuestion(question, store, reasoningEffort || 'balanced');
  return result.text;
}
