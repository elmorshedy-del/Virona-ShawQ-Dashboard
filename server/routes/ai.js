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

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    console.log(`\n========================================`);
    console.log(`[API] POST /ai/analyze`);
    console.log(`[API] Question: "${question}"`);
    console.log(`[API] Store: ${store}`);
    console.log(`========================================`);

    const result = await analyzeQuestion(question, store);
    
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
    const { question, store } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    console.log(`\n========================================`);
    console.log(`[API] POST /ai/summarize`);
    console.log(`[API] Question: "${question}"`);
    console.log(`[API] Store: ${store}`);
    console.log(`========================================`);

    const result = await summarizeData(question, store);
    
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
    const { question, store, depth } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question required' });
    }

    if (!store) {
      return res.status(400).json({ success: false, error: 'Store required' });
    }

    console.log(`\n========================================`);
    console.log(`[API] POST /ai/decide`);
    console.log(`[API] Question: "${question}"`);
    console.log(`[API] Store: ${store}`);
    console.log(`[API] Depth: ${depth || 'balanced'}`);
    console.log(`========================================`);

    const result = await decideQuestion(question, store, depth || 'balanced');
    
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
// STREAM - GPT-5.1 with SSE streaming (Best UX)
// ============================================================================
router.post('/stream', async (req, res) => {
  try {
    const { question, store, depth } = req.body;

    if (!question) {
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

    console.log(`\n========================================`);
    console.log(`[API] POST /ai/stream`);
    console.log(`[API] Question: "${question}"`);
    console.log(`[API] Store: ${store}`);
    console.log(`[API] Depth: ${depth || 'balanced'}`);
    console.log(`========================================`);

    const result = await decideQuestionStream(question, store, depth || 'balanced', (delta) => {
      res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
    });

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
// QUERY - Direct database query (for testing)
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
