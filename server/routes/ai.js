import express from 'express';
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
  runQuery
} from '../services/openaiService.js';
import { getDb } from '../db/database.js';
import {
  getCreativeSummarySettings,
  updateCreativeSummarySettings,
  getLatestCreativeSummary,
  saveCreativeSummary,
  dismissCreativeSummary,
  getCreativeSummaryQuestion
} from '../services/creativeSummaryService.js';

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
      reasoningEffort,
      action,
      saveCreativeSummary: saveSummary,
      summaryType,
      summaryPrompt,
      summaryVerbosity,
      summaryStartDate,
      summaryEndDate,
      summaryAutoGenerated
    } = req.body;

    // Daily summary mode doesn't need a question
    if (mode !== 'daily-summary' && mode !== 'creative-summary' && !question) {
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

    if (activeMode === 'creative-summary') {
      if (!store) {
        return res.status(400).json({ success: false, error: 'Store required' });
      }

      let payload = {};
      if (action === 'update-settings') {
        const settings = updateCreativeSummarySettings(store, req.body.settings || {});
        payload = { settings };
      } else if (action === 'dismiss') {
        const summaryId = req.body.summaryId;
        if (!summaryId) {
          return res.status(400).json({ success: false, error: 'Summary ID required' });
        }
        dismissCreativeSummary(store, summaryId);
        payload = { dismissed: true };
      } else {
        const settings = getCreativeSummarySettings(store);
        const summary = getLatestCreativeSummary(store);
        payload = { settings, summary };
      }

      res.write(`data: ${JSON.stringify({ type: 'payload', payload })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
      return;
    }

    let result;
    let fullText = '';
    const onDelta = (delta) => {
      if (saveSummary) {
        fullText += delta;
      }
      res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
    };

    if (activeMode === 'daily-summary') {
      // Daily summary uses GPT-5.1 deep - always for both stores
      result = await dailySummaryStream(reportType || 'am', onDelta);
    } else if (activeMode === 'analyze') {
      result = await analyzeQuestionStream(question, store, onDelta, history, startDate, endDate, {
        model: 'gpt-5.1',
        reasoningEffort,
        verbosity
      });
    } else if (activeMode === 'summarize') {
      result = await summarizeDataStream(question, store, onDelta, history, startDate, endDate, {
        model: 'gpt-5.1',
        reasoningEffort,
        verbosity
      });
    } else {
      result = await decideQuestionStream(question, store, depth || 'balanced', onDelta, history, startDate, endDate);
    }

    console.log(`[API] Stream complete. Model: ${result.model}`);

    if (saveSummary && fullText.trim()) {
      const settings = getCreativeSummarySettings(store);
      const resolvedPrompt = summaryPrompt || settings.prompt;
      const resolvedVerbosity = summaryVerbosity || verbosity || settings.verbosity;
      const resolvedType = summaryType || activeMode;
      const resolvedStart = summaryStartDate || startDate || null;
      const resolvedEnd = summaryEndDate || endDate || null;
      const finalPrompt = getCreativeSummaryQuestion(resolvedPrompt, resolvedType, resolvedVerbosity);

      saveCreativeSummary({
        store,
        summaryType: resolvedType,
        prompt: resolvedPrompt,
        verbosity: resolvedVerbosity,
        content: fullText.trim(),
        startDate: resolvedStart,
        endDate: resolvedEnd,
        autoGenerated: Boolean(summaryAutoGenerated)
      });

      console.log(`[AI] Saved creative summary (${resolvedType}) for ${store}: ${finalPrompt.slice(0, 80)}...`);
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
