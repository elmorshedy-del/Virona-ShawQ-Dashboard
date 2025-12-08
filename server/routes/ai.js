import express from 'express';
import {
  analyzeQuestion,
  summarizeData,
  decideQuestion,
  decideQuestionStream,
  runQuery
} from '../services/openaiService.js';

const router = express.Router();

// ============================================================================
// ANALYZE - GPT-5 nano (Quick metrics)
// ============================================================================
router.post('/analyze', async (req, res) => {
  try {
    const { question, store } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    console.log(`[AI] Analyze: "${question.substring(0, 50)}..." | Store: ${store}`);

    const result = await analyzeQuestion(question, store);
    res.json({
      success: true,
      answer: result.text,
      model: result.model
    });
  } catch (error) {
    console.error('[AI] Analyze error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SUMMARIZE - GPT-5 mini (Trends & patterns)
// ============================================================================
router.post('/summarize', async (req, res) => {
  try {
    const { question, store } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    console.log(`[AI] Summarize: "${question.substring(0, 50)}..." | Store: ${store}`);

    const result = await summarizeData(question, store);
    res.json({
      success: true,
      answer: result.text,
      model: result.model
    });
  } catch (error) {
    console.error('[AI] Summarize error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// DECIDE - GPT-5.1 (Strategic decisions - non-streaming)
// ============================================================================
router.post('/decide', async (req, res) => {
  try {
    const { question, store, depth } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    console.log(`[AI] Decide: "${question.substring(0, 50)}..." | Store: ${store} | Depth: ${depth}`);

    const result = await decideQuestion(question, store, depth);
    res.json({
      success: true,
      answer: result.text,
      model: result.model,
      reasoning: result.reasoning
    });
  } catch (error) {
    console.error('[AI] Decide error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// STREAM - GPT-5.1 with SSE streaming (Best UX)
// ============================================================================
router.post('/stream', async (req, res) => {
  try {
    const { question, store, depth } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    console.log(`[AI] Stream: "${question.substring(0, 50)}..." | Store: ${store} | Depth: ${depth}`);

    const result = await decideQuestionStream(question, store, depth, (delta) => {
      res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({
      type: 'done',
      model: result.model,
      reasoning: result.reasoning
    })}\n\n`);

    res.end();
  } catch (error) {
    console.error('[AI] Stream error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

// ============================================================================
// QUERY - Direct database query (for testing/debugging)
// ============================================================================
router.post('/query', async (req, res) => {
  try {
    const { sql, params } = req.body;

    if (!sql) {
      return res.status(400).json({ success: false, error: 'SQL query required' });
    }

    // Security: Only allow SELECT queries
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      return res.status(400).json({ success: false, error: 'Only SELECT queries allowed' });
    }

    const result = runQuery(sql, params || []);
    res.json(result);
  } catch (error) {
    console.error('[AI] Query error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// STATUS - Check configuration
// ============================================================================
router.get('/status', (req, res) => {
  const configured = !!process.env.OPENAI_API_KEY;
  res.json({
    success: true,
    configured,
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
