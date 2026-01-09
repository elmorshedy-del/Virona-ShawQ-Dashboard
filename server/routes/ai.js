import express from 'express';
import OpenAI from 'openai';
import { z } from 'zod';
import { 
  analyzeQuestion, 
  summarizeData, 
  decideQuestion,
  decideQuestionStream,
  analyzeQuestionStream,
  summarizeDataStream,
  dailySummary,
  dailySummaryStream,
  deleteDemoSallaData,
  runQuery,
  getRelevantData,
  buildSystemPrompt
} from '../services/openaiService.js';
import { getDb } from '../db/database.js';

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
    const { question, store, depth, mode, conversationId, reportType, startDate, endDate } = req.body;

    // Daily summary mode doesn't need a question
    if (mode !== 'daily-summary' && !question) {
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
    const activeMode = mode || 'decide';

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
    const onDelta = (delta) => {
      res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
    };

    if (activeMode === 'daily-summary') {
      // Daily summary uses GPT-5.1 deep - always for both stores
      result = await dailySummaryStream(reportType || 'am', onDelta);
    } else if (activeMode === 'analyze') {
      result = await analyzeQuestionStream(question, store, onDelta, history, startDate, endDate);
    } else if (activeMode === 'summarize') {
      result = await summarizeDataStream(question, store, onDelta, history, startDate, endDate);
    } else {
      result = await decideQuestionStream(question, store, depth || 'balanced', onDelta, history, startDate, endDate);
    }

    console.log(`[API] Stream complete. Model: ${result.model}`);

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
// AI ANALYTICS STREAM WITH TOOL CALLING
// ============================================================================

const visualizationSeriesSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['raw', 'ma']),
  derivedFrom: z.string().optional(),
  window: z.union([z.literal(7), z.literal(14), z.literal(30)]).optional()
}).superRefine((value, ctx) => {
  if (value.kind === 'ma') {
    if (!value.derivedFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MA series requires derivedFrom' });
    }
    if (!value.window) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MA series requires window' });
    }
  }
});

const visualizationDockSchema = z.object({
  id: z.literal('primary'),
  title: z.string(),
  mode: z.enum(['auto', 'manual']),
  autoReason: z.string().optional(),
  chartType: z.enum(['line', 'bar', 'totals', 'blocked']),
  xKey: z.string().optional(),
  yFormat: z.enum(['number', 'currency', 'percent']).optional(),
  series: z.array(visualizationSeriesSchema).optional(),
  data: z.array(z.record(z.any())).optional(),
  totals: z.record(z.union([z.number(), z.string()])).optional(),
  controls: z.object({
    allowMetric: z.boolean(),
    allowRange: z.boolean(),
    allowGroupBy: z.boolean(),
    allowMA: z.boolean()
  }).optional(),
  ui: z.object({
    rangePreset: z.enum(['7d', '14d', '30d', 'custom']).optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional(),
    metric: z.string().optional()
  }).optional()
});

const visualizationDockUpdateSchema = visualizationDockSchema.partial().extend({
  id: z.literal('primary')
});

const visualizationDockClearSchema = z.object({
  id: z.literal('primary')
});

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'getAvailableDataShape',
      description: 'Return available analytics data shape for charting.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'setVisualizationDock',
      description: 'Set the primary visualization dock configuration.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'mode', 'chartType'],
        properties: {
          id: { type: 'string', enum: ['primary'] },
          title: { type: 'string' },
          mode: { type: 'string', enum: ['auto', 'manual'] },
          autoReason: { type: 'string' },
          chartType: { type: 'string', enum: ['line', 'bar', 'totals', 'blocked'] },
          xKey: { type: 'string' },
          yFormat: { type: 'string', enum: ['number', 'currency', 'percent'] },
          series: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'label', 'kind'],
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                kind: { type: 'string', enum: ['raw', 'ma'] },
                derivedFrom: { type: 'string' },
                window: { type: 'number', enum: [7, 14, 30] }
              }
            }
          },
          data: {
            type: 'array',
            items: { type: 'object' }
          },
          totals: {
            type: 'object',
            additionalProperties: { type: ['number', 'string'] }
          },
          controls: {
            type: 'object',
            additionalProperties: false,
            properties: {
              allowMetric: { type: 'boolean' },
              allowRange: { type: 'boolean' },
              allowGroupBy: { type: 'boolean' },
              allowMA: { type: 'boolean' }
            }
          },
          ui: {
            type: 'object',
            additionalProperties: false,
            properties: {
              rangePreset: { type: 'string', enum: ['7d', '14d', '30d', 'custom'] },
              groupBy: { type: 'string', enum: ['day', 'week', 'month'] },
              metric: { type: 'string' }
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'updateVisualizationDock',
      description: 'Update the primary visualization dock configuration.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', enum: ['primary'] },
          title: { type: 'string' },
          mode: { type: 'string', enum: ['auto', 'manual'] },
          autoReason: { type: 'string' },
          chartType: { type: 'string', enum: ['line', 'bar', 'totals', 'blocked'] },
          xKey: { type: 'string' },
          yFormat: { type: 'string', enum: ['number', 'currency', 'percent'] },
          series: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'label', 'kind'],
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                kind: { type: 'string', enum: ['raw', 'ma'] },
                derivedFrom: { type: 'string' },
                window: { type: 'number', enum: [7, 14, 30] }
              }
            }
          },
          data: {
            type: 'array',
            items: { type: 'object' }
          },
          totals: {
            type: 'object',
            additionalProperties: { type: ['number', 'string'] }
          },
          controls: {
            type: 'object',
            additionalProperties: false,
            properties: {
              allowMetric: { type: 'boolean' },
              allowRange: { type: 'boolean' },
              allowGroupBy: { type: 'boolean' },
              allowMA: { type: 'boolean' }
            }
          },
          ui: {
            type: 'object',
            additionalProperties: false,
            properties: {
              rangePreset: { type: 'string', enum: ['7d', '14d', '30d', 'custom'] },
              groupBy: { type: 'string', enum: ['day', 'week', 'month'] },
              metric: { type: 'string' }
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'clearVisualizationDock',
      description: 'Clear the primary visualization dock.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', enum: ['primary'] }
        }
      }
    }
  }
];

function getAvailableDataShape(store) {
  const db = getDb();
  let columns = [];
  try {
    columns = db.prepare(`PRAGMA table_info(meta_daily_metrics)`).all();
  } catch (error) {
    columns = [];
  }

  const metricKeys = [];
  const dimensionKeys = [];

  for (const column of columns) {
    const type = (column.type || '').toLowerCase();
    if (type.includes('int') || type.includes('real') || type.includes('numeric')) {
      metricKeys.push(column.name);
    } else {
      dimensionKeys.push(column.name);
    }
  }

  const timeSeriesAvailable = db.prepare(`
    SELECT COUNT(*) as count FROM meta_daily_metrics WHERE LOWER(store) = ?
  `).get(store?.toLowerCase() || 'vironax')?.count > 0;

  let currency = null;
  if ((store || '').toLowerCase() === 'shawq') {
    currency = db.prepare(`SELECT currency FROM shopify_orders WHERE store = ? AND currency IS NOT NULL LIMIT 1`)
      .get(store)?.currency || null;
  } else if ((store || '').toLowerCase() === 'vironax') {
    currency = db.prepare(`SELECT currency FROM salla_orders WHERE store = ? AND currency IS NOT NULL LIMIT 1`)
      .get(store)?.currency || null;
  }

  return {
    timeSeriesAvailable,
    timeKey: columns.some(col => col.name === 'date') ? 'date' : null,
    metricKeys,
    dimensionKeys,
    currency
  };
}

function isValidSeriesKeys(payload) {
  if (!payload?.series || !payload?.data || payload.data.length === 0) return true;
  const dataKeys = new Set(Object.keys(payload.data[0] || {}));
  return payload.series.every(series => series.kind === 'ma' || dataKeys.has(series.key));
}

async function streamAnalyticsWithTools({
  systemPrompt,
  userMessage,
  model,
  maxTokens,
  reasoningEffort,
  store,
  onDelta,
  onTool
}) {
  let responseId = null;
  let toolOutputs = [];
  let safetyCounter = 0;

  const createStream = async (input, previousResponseId) => {
    const requestBody = {
      model,
      input,
      max_output_tokens: maxTokens,
      stream: true,
      tools: TOOL_DEFINITIONS
    };

    if (previousResponseId) {
      requestBody.previous_response_id = previousResponseId;
    }

    if (reasoningEffort && model.includes('5.1')) {
      requestBody.reasoning = { effort: reasoningEffort };
    }

    return openai.responses.create(requestBody);
  };

  let nextInput = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  while (safetyCounter < 4) {
    safetyCounter += 1;
    toolOutputs = [];
    const pendingToolCalls = new Map();
    const stream = await createStream(nextInput, responseId);

    for await (const event of stream) {
      if (event.response?.id) {
        responseId = event.response.id;
      }

      if (event.type === 'response.output_text.delta') {
        onDelta(event.delta);
      }

      if (event.type === 'response.function_call_arguments.delta') {
        const callId = event.call_id || event.item?.id || event.item?.call_id;
        const name = event.name || event.item?.name;
        if (!callId) continue;
        if (!pendingToolCalls.has(callId)) {
          pendingToolCalls.set(callId, { name, arguments: '' });
        }
        const entry = pendingToolCalls.get(callId);
        entry.arguments += event.delta || '';
      }

      if (event.type === 'response.function_call_arguments.done') {
        const callId = event.call_id || event.item?.id || event.item?.call_id;
        const name = event.name || event.item?.name;
        const rawArgs = event.arguments || pendingToolCalls.get(callId)?.arguments || '{}';
        let parsedArgs = {};

        try {
          parsedArgs = rawArgs ? JSON.parse(rawArgs) : {};
        } catch (error) {
          parsedArgs = {};
        }

        let toolResult = { success: true };

        if (name === 'getAvailableDataShape') {
          toolResult = getAvailableDataShape(store);
        } else if (name === 'setVisualizationDock') {
          const parsed = visualizationDockSchema.safeParse(parsedArgs);
          if (!parsed.success || !isValidSeriesKeys(parsed.data)) {
            toolResult = { success: false, error: 'Invalid visualization payload' };
          } else {
            onTool(name, parsed.data);
          }
        } else if (name === 'updateVisualizationDock') {
          const parsed = visualizationDockUpdateSchema.safeParse(parsedArgs);
          if (!parsed.success || !isValidSeriesKeys(parsed.data)) {
            toolResult = { success: false, error: 'Invalid visualization update payload' };
          } else {
            onTool(name, parsed.data);
          }
        } else if (name === 'clearVisualizationDock') {
          const parsed = visualizationDockClearSchema.safeParse(parsedArgs);
          if (!parsed.success) {
            toolResult = { success: false, error: 'Invalid visualization clear payload' };
          } else {
            onTool(name, parsed.data);
          }
        } else {
          toolResult = { success: false, error: 'Unknown tool' };
        }

        if (callId) {
          toolOutputs.push({
            tool_call_id: callId,
            output: JSON.stringify(toolResult)
          });
        }
      }
    }

    if (toolOutputs.length === 0) {
      break;
    }

    nextInput = toolOutputs.map(output => ({
      role: 'tool',
      tool_call_id: output.tool_call_id,
      content: output.output
    }));
  }

  return responseId;
}

router.post('/analytics/stream', async (req, res) => {
  try {
    const { question, store, depth, mode, startDate, endDate } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const activeMode = mode || 'decide';
    const data = getRelevantData(store, question, startDate, endDate);
    const basePrompt = buildSystemPrompt(store, activeMode, data, question);
    const toolInstructions = `\n\nTOOLING RULES:\n- Always call getAvailableDataShape FIRST before selecting or recommending charts.\n- If a visualization is useful, call setVisualizationDock EARLY, then continue your text response.\n- Use updateVisualizationDock for refinements.\n- If user asks for a trend but timeSeriesAvailable is false, call setVisualizationDock with chartType \"blocked\" (optionally include totals) and explain.\n- Do not invent data fields or time-series not in data shape.\n- series.key must exist in the data rows (except MA series).`;

    const systemPrompt = `${basePrompt}${toolInstructions}`;

    const modelMap = {
      analyze: 'gpt-5-nano',
      summarize: 'gpt-5-mini',
      decide: 'gpt-5.1'
    };
    const maxTokenMap = {
      analyze: 8000,
      summarize: 16000,
      decide: 64000
    };
    const depthMap = {
      instant: 'none',
      fast: 'low',
      balanced: 'medium',
      deep: 'high'
    };

    const model = modelMap[activeMode] || 'gpt-5.1';
    const maxTokens = maxTokenMap[activeMode] || 64000;
    const reasoningEffort = model.includes('5.1') ? (depthMap[depth] || 'medium') : null;

    const onDelta = (delta) => {
      res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
    };

    const onTool = (name, payload) => {
      res.write(`data: ${JSON.stringify({ type: 'tool', name, payload })}\n\n`);
    };

    await streamAnalyticsWithTools({
      systemPrompt,
      userMessage: question,
      model,
      maxTokens,
      reasoningEffort,
      store,
      onDelta,
      onTool
    });

    res.write(`data: ${JSON.stringify({
      type: 'done',
      model,
      reasoning: reasoningEffort
    })}\n\n`);

    res.end();
  } catch (error) {
    console.error(`[API] Analytics stream error:`, error.message);
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
