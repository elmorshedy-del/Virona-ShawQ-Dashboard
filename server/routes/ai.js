import express from 'express';
import { 
  analyzeQuestion, 
  summarizeData, 
  decideQuestion,
  decideQuestionStream,
  analyzeQuestionStream,
  summarizeDataStream,
  generateCreativeFunnelSummary,
  dailySummary,
  dailySummaryStream,
  deleteDemoSallaData,
  runQuery,
  exploreQuery
} from '../services/openaiService.js';
import {
  dismissCreativeFunnelSummary,
  getCreativeFunnelSummarySettings,
  getLatestCreativeFunnelSummary,
  saveCreativeFunnelSummary,
  updateCreativeFunnelSummarySettings
} from '../services/creativeFunnelSummaryService.js';
import { getDb } from '../db/database.js';

const router = express.Router();

// ============================================================================
// CONVERSATION MANAGEMENT
// ============================================================================

// Get all conversations for a store
router.get('/conversations', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const db = getDb();
    
    const conversations = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) as message_count
      FROM ai_conversations c
      WHERE c.store = ?
      ORDER BY c.updated_at DESC
      LIMIT 50
    `).all(store);
    
    res.json({ success: true, conversations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single conversation with messages
router.get('/conversations/:id', (req, res) => {
  try {
    const db = getDb();
    
    const conversation = db.prepare(`
      SELECT * FROM ai_conversations WHERE id = ?
    `).get(req.params.id);
    
    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' });
    }
    
    const messages = db.prepare(`
      SELECT * FROM ai_messages 
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(req.params.id);
    
    res.json({ success: true, conversation, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new conversation
router.post('/conversations', (req, res) => {
  try {
    const { store, title } = req.body;
    const db = getDb();
    
    const result = db.prepare(`
      INSERT INTO ai_conversations (store, title) VALUES (?, ?)
    `).run(store || 'vironax', title || 'New Chat');
    
    res.json({ 
      success: true, 
      conversationId: result.lastInsertRowid 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update conversation title
router.patch('/conversations/:id', (req, res) => {
  try {
    const { title } = req.body;
    const db = getDb();
    
    db.prepare(`
      UPDATE ai_conversations SET title = ?, updated_at = datetime('now') WHERE id = ?
    `).run(title, req.params.id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete conversation
router.delete('/conversations/:id', (req, res) => {
  try {
    const db = getDb();
    
    db.prepare(`DELETE FROM ai_messages WHERE conversation_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM ai_conversations WHERE id = ?`).run(req.params.id);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add message to conversation
router.post('/conversations/:id/messages', (req, res) => {
  try {
    const { role, content, mode, depth, model } = req.body;
    const db = getDb();
    
    const result = db.prepare(`
      INSERT INTO ai_messages (conversation_id, role, content, mode, depth, model)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.id, role, content, mode || null, depth || null, model || null);
    
    // Update conversation timestamp
    db.prepare(`
      UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?
    `).run(req.params.id);
    
    // Auto-update title from first user message
    const msgCount = db.prepare(`
      SELECT COUNT(*) as count FROM ai_messages WHERE conversation_id = ?
    `).get(req.params.id);
    
    if (msgCount.count === 1 && role === 'user') {
      const shortTitle = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      db.prepare(`
        UPDATE ai_conversations SET title = ? WHERE id = ?
      `).run(shortTitle, req.params.id);
    }
    
    res.json({ success: true, messageId: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get conversation history for AI context
function getConversationHistory(conversationId, limit = 10) {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT role, content FROM ai_messages 
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(conversationId, limit).reverse();
  } catch (e) {
    return [];
  }
}

const VALID_METRICS = ['revenue', 'orders', 'spend', 'impressions', 'clicks', 'roas', 'aov', 'conversion_rate', 'add_to_cart'];
const VALID_DIMENSIONS = ['date', 'country', 'campaign_name', 'adset_name', 'platform', 'age', 'gender'];
const VALID_CHART_TYPES = ['line', 'bar', 'area', 'pie'];

function getMetricExpression(metric) {
  switch (metric) {
    case 'revenue':
      return 'SUM(conversion_value)';
    case 'orders':
      return 'SUM(conversions)';
    case 'spend':
      return 'SUM(spend)';
    case 'impressions':
      return 'SUM(impressions)';
    case 'clicks':
      return 'SUM(clicks)';
    case 'roas':
      return "CASE WHEN SUM(spend) = 0 THEN 0 ELSE SUM(conversion_value) / SUM(spend) END";
    case 'aov':
      return "CASE WHEN SUM(conversions) = 0 THEN 0 ELSE SUM(conversion_value) / SUM(conversions) END";
    case 'conversion_rate':
      return "CASE WHEN SUM(clicks) = 0 THEN 0 ELSE SUM(conversions) / SUM(clicks) END";
    case 'add_to_cart':
      return 'SUM(add_to_cart)';
    default:
      return 'SUM(conversion_value)';
  }
}

function resolveDateRange(spec) {
  const end = new Date();
  const start = new Date();
  if (spec.dateRange === 'custom' && spec.customDateStart && spec.customDateEnd) {
    return { start: spec.customDateStart, end: spec.customDateEnd };
  }
  switch (spec.dateRange) {
    case '7d':
      start.setDate(end.getDate() - 7);
      break;
    case '14d':
      start.setDate(end.getDate() - 14);
      break;
    case '30d':
    default:
      start.setDate(end.getDate() - 30);
      break;
  }
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0]
  };
}

function getAutoReasonForSpec(spec) {
  if (spec.dimension === 'date') {
    return 'Trend over time';
  }
  if (spec.chartType === 'pie') {
    return 'Share of total';
  }
  return 'Categorical breakdown';
}

function buildTitle(spec) {
  const metricLabel = {
    revenue: 'Revenue',
    orders: 'Orders',
    spend: 'Spend',
    impressions: 'Impressions',
    clicks: 'Clicks',
    roas: 'ROAS',
    aov: 'AOV',
    conversion_rate: 'Conversion Rate',
    add_to_cart: 'Add to Cart'
  }[spec.metric] || 'Metric';

  const dimensionLabel = {
    date: 'Date',
    country: 'Country',
    campaign_name: 'Campaign',
    adset_name: 'Ad Set',
    platform: 'Platform',
    age: 'Age',
    gender: 'Gender'
  }[spec.dimension] || 'Dimension';

  if (spec.dimension === 'date') {
    return `${metricLabel} trend`;
  }
  return `${metricLabel} by ${dimensionLabel}`;
}

function validateToolCall(toolCall) {
  return VALID_METRICS.includes(toolCall.metric)
    && VALID_DIMENSIONS.includes(toolCall.dimension)
    && VALID_CHART_TYPES.includes(toolCall.chartType);
}

function calculateMetaTotal(metric, data) {
  if (!Array.isArray(data) || data.length === 0) return 0;
  if (['roas', 'aov', 'conversion_rate'].includes(metric)) {
    const sum = data.reduce((acc, row) => acc + (row.value || 0), 0);
    return sum / data.length;
  }
  return data.reduce((acc, row) => acc + (row.value || 0), 0);
}

function fetchChartData(db, spec, store, startDate, endDate) {
  const metricExpression = getMetricExpression(spec.metric);
  const storeName = (store || '').toLowerCase();
  const MAX_ROWS = 100;

  if (spec.dimension === 'date') {
    const rows = db.prepare(`
      SELECT date, ${metricExpression} as value
      FROM meta_daily_metrics
      WHERE LOWER(store) = ? AND date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date ASC
      LIMIT ${MAX_ROWS}
    `).all(storeName, startDate, endDate);

    return rows.map(row => ({ date: row.date, value: row.value || 0 }));
  }

  const rows = db.prepare(`
    SELECT ${spec.dimension} as category, ${metricExpression} as value
    FROM meta_daily_metrics
    WHERE LOWER(store) = ? AND date BETWEEN ? AND ?
    GROUP BY ${spec.dimension}
    ORDER BY value DESC
    LIMIT 10
  `).all(storeName, startDate, endDate);

  let data = rows.map(row => ({ category: row.category || 'Unknown', value: row.value || 0 }));

  if (spec.chartType === 'pie') {
    const totalRow = db.prepare(`
      SELECT ${metricExpression} as value, COUNT(DISTINCT ${spec.dimension}) as totalCategories
      FROM meta_daily_metrics
      WHERE LOWER(store) = ? AND date BETWEEN ? AND ?
    `).get(storeName, startDate, endDate);

    if (totalRow?.totalCategories > 6) {
      const topFive = data.slice(0, 5);
      const topFiveTotal = topFive.reduce((acc, row) => acc + (row.value || 0), 0);
      const otherValue = Math.max((totalRow.value || 0) - topFiveTotal, 0);
      data = [...topFive, { category: 'Other', value: otherValue }];
    } else {
      data = data.slice(0, 6);
    }
  }

  return data;
}

// ============================================================================
// ANALYZE - GPT-5 nano (Quick metrics)
// ============================================================================
router.post('/analyze', async (req, res) => {
  try {
    const { question, store, conversationId, startDate, endDate } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    const history = conversationId ? getConversationHistory(conversationId) : [];

    console.log(`\n========================================`);
    console.log(`[API] POST /ai/analyze`);
    console.log(`[API] Question: "${question}"`);
    console.log(`[API] Store: ${store}`);
    console.log(`[API] Date Range: ${startDate || 'default'} to ${endDate || 'default'}`);
    console.log(`[API] Conversation: ${conversationId || 'none'}`);
    console.log(`[API] History: ${history.length} messages`);
    console.log(`========================================`);

    const result = await analyzeQuestion(question, store, history, startDate, endDate);

    console.log(`[API] Response model: ${result.model}`);
    console.log(`[API] Response length: ${result.text?.length || 0} chars`);

    res.json({
      success: true,
      answer: result.text,
      model: result.model
    });
  } catch (error) {
    console.error(`[API] Analyze error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Check server logs for more info'
    });
  }
});

// ============================================================================
// SUMMARIZE - GPT-5 mini (Trends & patterns)
// ============================================================================
router.post('/summarize', async (req, res) => {
  try {
    const { question, store, conversationId, startDate, endDate } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    const history = conversationId ? getConversationHistory(conversationId) : [];

    console.log(`\n========================================`);
    console.log(`[API] POST /ai/summarize`);
    console.log(`[API] Question: "${question}"`);
    console.log(`[API] Store: ${store}`);
    console.log(`[API] Date Range: ${startDate || 'default'} to ${endDate || 'default'}`);
    console.log(`[API] Conversation: ${conversationId || 'none'}`);
    console.log(`[API] History: ${history.length} messages`);
    console.log(`========================================`);

    const result = await summarizeData(question, store, history, startDate, endDate);

    console.log(`[API] Response model: ${result.model}`);
    console.log(`[API] Response length: ${result.text?.length || 0} chars`);

    res.json({
      success: true,
      answer: result.text,
      model: result.model
    });
  } catch (error) {
    console.error(`[API] Summarize error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Check server logs for more info'
    });
  }
});

// ============================================================================
// EXPLORE - AI-driven chart specification + data
// ============================================================================
router.post('/explore', async (req, res) => {
  try {
    const { query, store, currentFilters, skipAI } = req.body;

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    if (!skipAI && !query) {
      return res.status(400).json({ success: false, error: 'Query required' });
    }

    let spec;
    if (skipAI) {
      const baseSpec = {
        metric: currentFilters?.metric || 'revenue',
        dimension: currentFilters?.dimension || 'country',
        chartType: currentFilters?.chartType || 'auto',
        dateRange: currentFilters?.dateRange || '14d',
        customDateStart: currentFilters?.customDateStart,
        customDateEnd: currentFilters?.customDateEnd
      };

      const resolvedChartType = baseSpec.chartType === 'auto'
        ? (baseSpec.dimension === 'date' ? 'line' : 'bar')
        : baseSpec.chartType;

      spec = {
        ...baseSpec,
        chartType: resolvedChartType,
        title: buildTitle(baseSpec),
        autoReason: baseSpec.chartType === 'auto' ? getAutoReasonForSpec(baseSpec) : ''
      };
    } else {
      const result = await exploreQuery(query, currentFilters);
      if (!result.success) {
        return res.json(result);
      }
      spec = result.spec;
    }

    if (!VALID_METRICS.includes(spec.metric) || !VALID_DIMENSIONS.includes(spec.dimension)) {
      return res.json({ success: false, error: 'Unsupported metric or dimension.' });
    }

    const { start, end } = resolveDateRange(spec);
    const db = getDb();
    const data = fetchChartData(db, spec, store, start, end);
    const total = calculateMetaTotal(spec.metric, data);
    const currency = store.toLowerCase() === 'shawq' ? 'USD' : 'SAR';

    res.json({
      success: true,
      spec: {
        ...spec,
        autoReason: spec.autoReason || getAutoReasonForSpec(spec)
      },
      data,
      meta: {
        total,
        currency,
        periodStart: start,
        periodEnd: end
      },
      availableMetrics: VALID_METRICS
    });
  } catch (error) {
    console.error('[API] Explore error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// DECIDE - GPT-5.1 (Strategic decisions - non-streaming)
// ============================================================================
router.post('/decide', async (req, res) => {
  try {
    const { question, store, depth, conversationId, startDate, endDate } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    const history = conversationId ? getConversationHistory(conversationId) : [];

    console.log(`\n========================================`);
    console.log(`[API] POST /ai/decide`);
    console.log(`[API] Question: "${question}"`);
    console.log(`[API] Store: ${store}`);
    console.log(`[API] Depth: ${depth || 'balanced'}`);
    console.log(`[API] Date Range: ${startDate || 'default'} to ${endDate || 'default'}`);
    console.log(`[API] Conversation: ${conversationId || 'none'}`);
    console.log(`[API] History: ${history.length} messages`);
    console.log(`========================================`);

    const result = await decideQuestion(question, store, depth || 'balanced', history, startDate, endDate);

    console.log(`[API] Response model: ${result.model}`);
    console.log(`[API] Reasoning effort: ${result.reasoning}`);
    console.log(`[API] Response length: ${result.text?.length || 0} chars`);

    res.json({
      success: true,
      answer: result.text,
      model: result.model,
      reasoning: result.reasoning
    });
  } catch (error) {
    console.error(`[API] Decide error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Check server logs for more info'
    });
  }
});

// ============================================================================
// STREAM - All modes with SSE streaming (Best UX)
// ============================================================================
router.post('/stream', async (req, res) => {
  try {
    const {
      question,
      store,
      depth,
      mode,
      conversationId,
      reportType,
      startDate,
      endDate,
      verbosity,
      summaryType,
      summarySettings,
      action,
      summaryMode
    } = req.body;

    const activeMode = mode || 'decide';
    const allowEmptyQuestion = ['daily-summary', 'creative-funnel-summary'].includes(activeMode);

    // Daily summary mode doesn't need a question
    if (!allowEmptyQuestion && !question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const history = conversationId ? getConversationHistory(conversationId) : [];
    const effectiveSummaryMode = summaryMode || activeMode;

    if (activeMode === 'creative-funnel-summary') {
      if (action === 'dismiss') {
        dismissCreativeFunnelSummary(store, summaryMode || 'analyze');
        res.write(`data: ${JSON.stringify({ type: 'done', summary: null })}\n\n`);
        res.end();
        return;
      }

      if (action === 'update-settings') {
        const settings = updateCreativeFunnelSummarySettings(store, summarySettings || {});
        res.write(`data: ${JSON.stringify({ type: 'done', settings })}\n\n`);
        res.end();
        return;
      }

      const settings = getCreativeFunnelSummarySettings(store);
      const summary = getLatestCreativeFunnelSummary(store, effectiveSummaryMode);
      res.write(`data: ${JSON.stringify({ type: 'done', summary, settings })}\n\n`);
      res.end();
      return;
    }

    console.log(`\n========================================`);
    console.log(`[API] POST /ai/stream`);
    console.log(`[API] Mode: ${activeMode}`);
    console.log(`[API] Question: "${(question || '').substring(0, 100)}..."`);
    console.log(`[API] Store: ${store}`);
    console.log(`[API] Depth: ${depth || 'balanced'}`);
    console.log(`[API] Date Range: ${startDate || 'default'} to ${endDate || 'default'}`);
    console.log(`[API] Conversation: ${conversationId || 'none'}`);
    console.log(`[API] History: ${history.length} messages`);
    if (activeMode === 'daily-summary') {
      console.log(`[API] Report Type: ${reportType || 'am'}`);
      console.log(`[API] Using GPT-5.1 Deep for daily summary`);
    }
    console.log(`========================================`);

    let result;
    let fullText = '';
    const onDelta = (delta) => {
      fullText += delta;
      res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
    };
    const onTool = async (toolArgs) => {
      try {
        if (!validateToolCall(toolArgs)) {
          return 'Invalid chart request.';
        }

        const spec = {
          title: toolArgs.title,
          note: toolArgs.note,
          metric: toolArgs.metric,
          dimension: toolArgs.dimension,
          chartType: toolArgs.chartType,
          dateRange: toolArgs.dateRange,
          autoReason: getAutoReasonForSpec(toolArgs)
        };

        const { start, end } = resolveDateRange(spec);
        const db = getDb();
        const data = fetchChartData(db, spec, store, start, end);
        const total = calculateMetaTotal(spec.metric, data);
        const currency = store.toLowerCase() === 'shawq' ? 'USD' : 'SAR';

        res.write(`data: ${JSON.stringify({
          type: 'tool',
          name: 'show_chart',
          payload: {
            spec,
            data,
            meta: {
              total,
              currency,
              periodStart: start,
              periodEnd: end
            }
          }
        })}\n\n`);

        return `Chart ready: ${spec.title}`;
      } catch (toolError) {
        console.error('Chart data fetch failed:', toolError.message);
        return 'Chart data fetch failed.';
      }
    };

    if (activeMode === 'daily-summary') {
      // Daily summary uses GPT-5.1 deep - always for both stores
      result = await dailySummaryStream(reportType || 'am', onDelta);
    } else if (summaryType === 'creative-funnel' && (activeMode === 'analyze' || activeMode === 'summarize')) {
      if (summarySettings) {
        updateCreativeFunnelSummarySettings(store, summarySettings);
      }
      result = await generateCreativeFunnelSummary({
        store,
        mode: activeMode,
        prompt: question,
        verbosity: verbosity || 'low',
        startDate,
        endDate,
        onDelta
      });
    } else if (activeMode === 'analyze') {
      result = await analyzeQuestionStream(question, store, onDelta, onTool, history, startDate, endDate);
    } else if (activeMode === 'summarize') {
      result = await summarizeDataStream(question, store, onDelta, onTool, history, startDate, endDate);
    } else {
      result = await decideQuestionStream(question, store, depth || 'balanced', onDelta, onTool, history, startDate, endDate);
    }

    console.log(`[API] Stream complete. Model: ${result.model}`);

    if (summaryType === 'creative-funnel' && (activeMode === 'analyze' || activeMode === 'summarize')) {
      const summaryId = saveCreativeFunnelSummary({
        store,
        mode: activeMode,
        prompt: question,
        verbosity: verbosity || 'low',
        content: fullText,
        model: result.model,
        startDate,
        endDate,
        source: 'manual',
        period: startDate && endDate && startDate === endDate ? 'daily' : 'custom'
      });

      res.write(`data: ${JSON.stringify({
        type: 'done',
        model: result.model,
        reasoning: result.reasoning,
        summaryId
      })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({
      type: 'done',
      model: result.model,
      reasoning: result.reasoning
    })}\n\n`);

    res.end();
  } catch (error) {
    console.error(`[API] Stream error:`, error.message);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// ============================================================================
// DELETE DEMO DATA - Clear fake Salla orders only (Shopify has real data)
// ============================================================================
router.delete('/demo-data', (req, res) => {
  try {
    const db = getDb();
    const results = {
      salla: { deleted: 0 }
    };

    // Clear Salla demo data ONLY (VironaX Salla is not connected, so all data is demo)
    try {
      const sallaResult = db.prepare(`DELETE FROM salla_orders WHERE store = 'vironax'`).run();
      results.salla.deleted = sallaResult.changes;
      console.log(`[Cleanup] Deleted ${sallaResult.changes} Salla demo orders`);
    } catch (e) {
      results.salla.error = e.message;
    }

    // NOTE: NOT deleting Shopify orders - Shawq Shopify is connected with real data

    res.json({ 
      success: true, 
      message: 'Salla demo data cleared (Shopify untouched - has real data)',
      results 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// DEBUG - Run raw SQL query
// ============================================================================
router.post('/query', async (req, res) => {
  try {
    const { sql, params } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ success: false, error: 'SQL query required' });
    }

    // Security: Only allow SELECT queries
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      return res.status(400).json({ success: false, error: 'Only SELECT queries allowed' });
    }

    console.log(`[API] POST /ai/query`);
    console.log(`[API] SQL: ${sql.substring(0, 100)}...`);

    const result = runQuery(sql, params || []);
    res.json(result);
  } catch (error) {
    console.error(`[API] Query error:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// HISTORICAL DATA IMPORT - Import CSV data for campaigns
// ============================================================================
router.post('/import-historical', async (req, res) => {
  try {
    const { store, data } = req.body;
    const db = getDb();

    if (!store || !data || !Array.isArray(data)) {
      return res.status(400).json({ success: false, error: 'Store and data array required' });
    }

    console.log(`[API] Importing ${data.length} historical records for ${store}`);

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO meta_daily_metrics (
        store, date, campaign_id, campaign_name, country,
        spend, impressions, clicks, conversions, conversion_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let imported = 0;
    let skipped = 0;

    const tx = db.transaction(() => {
      for (const row of data) {
        try {
          if (!row.date || !row.campaign_name) {
            skipped++;
            continue;
          }

          insertStmt.run(
            store,
            row.date,
            row.campaign_id || `hist_${row.campaign_name}_${row.date}`,
            row.campaign_name,
            row.country || 'ALL',
            row.spend || 0,
            row.impressions || 0,
            row.clicks || 0,
            row.conversions || row.purchases || row.orders || 0,
            row.conversion_value || row.revenue || row.purchase_value || 0
          );
          imported++;
        } catch (e) {
          skipped++;
        }
      }
    });

    tx();

    console.log(`[API] Import complete: ${imported} imported, ${skipped} skipped`);
    res.json({ success: true, imported, skipped });
  } catch (error) {
    console.error(`[API] Import error:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// STATUS - Check configuration
// ============================================================================
router.get('/status', (req, res) => {
  const configured = !!process.env.OPENAI_API_KEY;
  const keyPrefix = process.env.OPENAI_API_KEY?.substring(0, 10) || 'not set';
  
  res.json({ 
    success: true, 
    configured,
    keyPrefix: configured ? `${keyPrefix}...` : 'not set',
    models: {
      analyze: 'gpt-5-nano (fallback: gpt-4o-mini)',
      summarize: 'gpt-5-mini (fallback: gpt-4o)',
      decide: 'gpt-5.1 (fallback: gpt-4o)'
    },
    features: {
      streaming: true,
      databaseAccess: true,
      depthLevels: ['instant', 'fast', 'balanced', 'deep']
    }
  });
});

export default router;
