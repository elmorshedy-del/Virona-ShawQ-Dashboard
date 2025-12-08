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
  NANO: 'gpt-5-nano',       // Fast clerk - metrics, tags, structured outputs
  MINI: 'gpt-5-mini',       // Daily analyst - summaries, trends, anomalies
  STRATEGIST: 'gpt-5.1'     // Strategy lead - diagnosis, decisions, test design
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
// Database Query Helper - AI can query your data directly
// ============================================================================
function queryDatabase(sql, params = []) {
  const db = getDb();
  try {
    const results = db.prepare(sql).all(...params);
    return { success: true, data: results, rowCount: results.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Get Database Schema - So AI knows what tables/columns exist
// ============================================================================
function getDatabaseSchema() {
  return `
DATABASE SCHEMA:

1. meta_daily_metrics (Campaign-level Meta Ads data with breakdowns)
   - store, date, campaign_id, campaign_name
   - country, age, gender, publisher_platform, platform_position
   - spend, impressions, clicks, reach
   - landing_page_views, add_to_cart, checkouts_initiated
   - conversions, conversion_value

2. meta_adset_metrics (Ad Set-level data)
   - store, date, campaign_id, campaign_name, adset_id, adset_name
   - country, spend, impressions, clicks, reach
   - landing_page_views, add_to_cart, checkouts_initiated
   - conversions, conversion_value

3. meta_ad_metrics (Ad-level data)
   - store, date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name
   - country, spend, impressions, clicks, reach
   - landing_page_views, add_to_cart, checkouts_initiated
   - conversions, conversion_value

4. salla_orders (VironaX orders - Saudi Arabia)
   - store, order_id, date, country, country_code, city
   - order_total, subtotal, shipping, tax, discount, items_count
   - status, payment_method, currency (SAR), created_at

5. shopify_orders (Shawq orders - Turkey/US)
   - store, order_id, date, country, country_code, city, state
   - order_total, subtotal, shipping, tax, discount, items_count
   - status, financial_status, fulfillment_status, payment_method
   - currency (USD), order_created_at

6. manual_orders (Manually entered orders)
   - store, date, country, campaign, spend, orders_count, revenue, source, notes

7. manual_spend_overrides (Spend overrides)
   - store, date, country, amount, notes

USEFUL QUERIES:
- ROAS = conversion_value / spend
- CPA = spend / conversions
- CTR = clicks / impressions
- AOV = conversion_value / conversions
- Country code examples: SA (Saudi), AE (UAE), KW (Kuwait), US, TR (Turkey)
- For time-of-day: strftime('%H', created_at) from order tables
- For day-of-week: strftime('%w', date) where 0=Sunday
`;
}

// ============================================================================
// Build System Prompt with Database Context
// ============================================================================
function buildSystemPrompt(store, mode) {
  const storeContext = store === 'vironax'
    ? 'VironaX (Saudi Arabia, SAR currency, Salla e-commerce, mens jewelry)'
    : 'Shawq (Turkey/US, USD currency, Shopify, Palestinian & Syrian apparel)';

  const schema = getDatabaseSchema();

  const basePrompt = `You are an AI analytics assistant for ${storeContext}.

${schema}

IMPORTANT RULES:
1. Always use store = '${store}' in WHERE clauses
2. For date ranges, use date >= date('now', '-N days') format
3. Calculate metrics: ROAS = conversion_value/spend, CPA = spend/conversions, CTR = clicks/impressions
4. Format currency nicely (2 decimals, commas for thousands)
5. Be specific with numbers - never invent data
6. If data is missing or query fails, say so honestly

You can execute SQL queries using the queryDatabase function. Always query the database to get real data - do not make up numbers.`;

  if (mode === 'analyze') {
    return basePrompt + `

MODE: Quick Analysis (GPT-5 nano)
- Give very concise, direct answers
- Just the facts and numbers
- No lengthy explanations
- Format: "X is Y" style responses`;
  }

  if (mode === 'summarize') {
    return basePrompt + `

MODE: Trends & Patterns (GPT-5 mini)
- Summarize trends and patterns
- Compare periods, countries, campaigns
- Flag anomalies and notable changes
- Use bullet points for clarity
- Include specific numbers`;
  }

  // Decide mode
  return basePrompt + `

MODE: Strategic Decisions (GPT-5.1)
- Provide actionable recommendations
- Diagnose problems with root causes
- Propose specific tests with hypotheses
- Prioritize by expected impact
- Include specific numbers and targets
- Be decisive - give clear recommendations`;
}

// ============================================================================
// Execute AI Query with Database Access
// ============================================================================
async function executeWithDatabaseAccess(prompt, store, mode, depth = 'balanced') {
  const systemPrompt = buildSystemPrompt(store, mode);

  // First, let AI analyze what queries it needs
  const analysisMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ];

  // Determine model and settings based on mode
  let model, maxTokens, reasoningEffort;

  if (mode === 'analyze') {
    model = MODELS.NANO;
    maxTokens = TOKEN_LIMITS.nano;
    reasoningEffort = null;
  } else if (mode === 'summarize') {
    model = MODELS.MINI;
    maxTokens = TOKEN_LIMITS.mini;
    reasoningEffort = null;
  } else {
    model = MODELS.STRATEGIST;
    maxTokens = TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced;
    reasoningEffort = DEPTH_TO_EFFORT[depth] || 'medium';
  }

  // Build the request
  const request = {
    model,
    input: analysisMessages,
    max_output_tokens: maxTokens
  };

  // Add reasoning effort for GPT-5.1
  if (reasoningEffort) {
    request.reasoning = { effort: reasoningEffort };
  }

  return { request, model, maxTokens, reasoningEffort };
}

// ============================================================================
// ANALYZE - GPT-5 nano (Quick metrics)
// ============================================================================
export async function analyzeQuestion(question, store) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const { request, model } = await executeWithDatabaseAccess(question, store, 'analyze');

  console.log(`[AI Analyze] Model: ${model} | Store: ${store}`);

  try {
    const response = await client.responses.create(request);
    return {
      text: response.output_text,
      model: model
    };
  } catch (error) {
    console.error(`[AI Analyze] Error with ${model}:`, error.message);

    // Fallback to GPT-4o-mini
    console.log('[AI Analyze] Falling back to gpt-4o-mini');
    const fallbackResponse = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: request.input,
      max_tokens: TOKEN_LIMITS.nano,
      temperature: 0.3
    });

    return {
      text: fallbackResponse.choices[0].message.content,
      model: 'gpt-4o-mini (fallback)'
    };
  }
}

// ============================================================================
// SUMMARIZE - GPT-5 mini (Trends & patterns)
// ============================================================================
export async function summarizeData(question, store) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const { request, model } = await executeWithDatabaseAccess(question, store, 'summarize');

  console.log(`[AI Summarize] Model: ${model} | Store: ${store}`);

  try {
    const response = await client.responses.create(request);
    return {
      text: response.output_text,
      model: model
    };
  } catch (error) {
    console.error(`[AI Summarize] Error with ${model}:`, error.message);

    // Fallback to GPT-4o
    console.log('[AI Summarize] Falling back to gpt-4o');
    const fallbackResponse = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: request.input,
      max_tokens: TOKEN_LIMITS.mini,
      temperature: 0.5
    });

    return {
      text: fallbackResponse.choices[0].message.content,
      model: 'gpt-4o (fallback)'
    };
  }
}

// ============================================================================
// DECIDE - GPT-5.1 with reasoning (Non-streaming)
// ============================================================================
export async function decideQuestion(question, store, depth = 'balanced') {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const { request, model, reasoningEffort } = await executeWithDatabaseAccess(question, store, 'decide', depth);

  console.log(`[AI Decide] Model: ${model} | Store: ${store} | Effort: ${reasoningEffort}`);

  try {
    const response = await client.responses.create(request);
    return {
      text: response.output_text,
      model: model,
      reasoning: reasoningEffort
    };
  } catch (error) {
    console.error(`[AI Decide] Error with ${model}:`, error.message);

    // Fallback to GPT-4o
    console.log('[AI Decide] Falling back to gpt-4o');
    const fallbackResponse = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: request.input,
      max_tokens: TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced,
      temperature: 0.7
    });

    return {
      text: fallbackResponse.choices[0].message.content,
      model: 'gpt-4o (fallback)',
      reasoning: null
    };
  }
}

// ============================================================================
// DECIDE STREAMING - GPT-5.1 with streaming (Best UX)
// ============================================================================
export async function decideQuestionStream(question, store, depth = 'balanced', onText) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  const { request, model, reasoningEffort } = await executeWithDatabaseAccess(question, store, 'decide', depth);

  console.log(`[AI Decide Stream] Model: ${model} | Store: ${store} | Effort: ${reasoningEffort}`);

  try {
    const stream = await client.responses.stream(request);

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        onText?.(event.delta);
      }
    }

    const final = await stream.finalResponse();
    return {
      text: final.output_text,
      model: model,
      reasoning: reasoningEffort
    };
  } catch (error) {
    console.error(`[AI Decide Stream] Error with ${model}:`, error.message);

    // Fallback to non-streaming GPT-4o
    console.log('[AI Decide Stream] Falling back to gpt-4o (non-streaming)');
    const fallbackResponse = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: request.input,
      max_tokens: TOKEN_LIMITS[depth] || TOKEN_LIMITS.balanced,
      temperature: 0.7
    });

    const text = fallbackResponse.choices[0].message.content;
    onText?.(text); // Send all at once

    return {
      text: text,
      model: 'gpt-4o (fallback)',
      reasoning: null
    };
  }
}

// ============================================================================
// Direct Database Query (for AI to use)
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
