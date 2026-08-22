import express from 'express';
import { getDb } from '../db/database.js';
import { extractAndDownloadMedia, getYtdlpStatus, updateYtdlp } from '../utils/videoExtractor.js';
import { askOpenAIChat, streamOpenAIChat } from '../services/openaiService.js';
import { streamDeepSeekChat } from '../services/deepseekService.js';

const router = express.Router();

const GEMINI_ANALYSIS_MODELS = new Set(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
const DEFAULT_GEMINI_ANALYSIS_MODEL = 'gemini-2.5-flash-lite';
const MAX_CREATIVE_CHAT_CONTEXT_ADS = 5;

// ============================================================================
// TONE PRESETS
// ============================================================================
const TONE_PROMPTS = {
  balanced: '',
  'data-heavy': 'Be direct and metrics-focused. Lead with numbers. Skip fluff.',
  'creative-led': 'Focus on visual storytelling, emotional hooks, and brand impact.'
};

// ============================================================================
// BUILD SYSTEM PROMPT FROM SETTINGS
// ============================================================================
function buildSystemPrompt(settings) {
  let prompt = `You are an expert Meta ads creative strategist. You have access to frame-by-frame video analysis and performance data.

When analyzing ads, focus on:
- Hook effectiveness (first 3 seconds)
- Visual storytelling structure
- Text/copy timing and placement
- Emotional triggers and scroll-stopping moments
- What makes this ad work (or not work)

`;

  const capabilities = typeof settings.capabilities === 'string' 
    ? JSON.parse(settings.capabilities) 
    : settings.capabilities || {};

  if (capabilities.analyze) {
    prompt += `• You can ANALYZE why ads perform - compare creatives, find patterns, explain what works.\n`;
  }
  if (capabilities.clone) {
    prompt += `• You can CLONE winners - generate script variations based on winning structures.\n`;
  }
  if (capabilities.ideate) {
    prompt += `• You can IDEATE new concepts - suggest new hooks, angles, creative briefs.\n`;
  }
  if (capabilities.audit) {
    prompt += `• You can AUDIT - identify fatigue, recommend kills, suggest what to test next.\n`;
  }

  if (settings.tone === 'custom' && settings.custom_prompt) {
    prompt += `\n${settings.custom_prompt}`;
  } else if (TONE_PROMPTS[settings.tone]) {
    prompt += `\n${TONE_PROMPTS[settings.tone]}`;
  }

  return prompt;
}

// ============================================================================
// GEMINI VIDEO ANALYSIS
// ============================================================================
router.post('/analyze-video', async (req, res) => {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  
  try {
    const { store, adId, adName, campaignId, campaignName, sourceUrl, embedHtml, thumbnailUrl, gemini_analysis_model } = req.body;

    // Validate
    if (!store || !adId) {
      return res.status(400).json({ error: 'Missing store or adId' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const db = getDb();

    // Resolve Gemini analysis model (settings → request override → default)
    let settings = db.prepare(`SELECT gemini_analysis_model FROM ai_creative_settings WHERE store = ?`).get(store);
    if (!settings) {
      db.prepare(`INSERT INTO ai_creative_settings (store) VALUES (?)`).run(store);
      settings = { gemini_analysis_model: DEFAULT_GEMINI_ANALYSIS_MODEL };
    }

    const requestedModel = typeof gemini_analysis_model === 'string' ? gemini_analysis_model.trim() : '';
    const settingsModel = typeof settings?.gemini_analysis_model === 'string' ? settings.gemini_analysis_model.trim() : '';
    const resolvedGeminiModel = GEMINI_ANALYSIS_MODELS.has(requestedModel)
      ? requestedModel
      : (GEMINI_ANALYSIS_MODELS.has(settingsModel) ? settingsModel : DEFAULT_GEMINI_ANALYSIS_MODEL);

    // Check if already analyzed
    const existing = db.prepare(`
      SELECT * FROM creative_scripts WHERE store = ? AND ad_id = ?
    `).get(store, adId);

    if (existing && existing.status === 'complete' && existing.script) {
      let existingScript;
      try {
        existingScript = JSON.parse(existing.script);
      } catch {
        existingScript = null;
      }

      const existingModel = typeof existing.gemini_model === 'string' ? existing.gemini_model : null;
      const cacheHit = !!existingScript && existingModel === resolvedGeminiModel;

      if (cacheHit) {
        return res.json({ 
          success: true, 
          script: existingScript,
          cached: true,
          method: existingScript?.method || 'unknown',
          model: existingModel
        });
      }
    }

    // Mark as processing
    db.prepare(`
      INSERT INTO creative_scripts (store, ad_id, ad_name, campaign_id, campaign_name, gemini_model, status)
      VALUES (?, ?, ?, ?, ?, ?, 'processing')
      ON CONFLICT(store, ad_id) DO UPDATE SET
        status = 'processing',
        gemini_model = excluded.gemini_model,
        error_message = NULL,
        updated_at = datetime('now')
    `).run(store, adId, adName || '', campaignId || '', campaignName || '', resolvedGeminiModel);

    // Extract and download media using the robust extractor
    const media = await extractAndDownloadMedia({ sourceUrl, embedHtml, thumbnailUrl });

    if (!media.success) {
      db.prepare(`
        UPDATE creative_scripts 
        SET status = 'failed', error_message = ?, updated_at = datetime('now')
        WHERE store = ? AND ad_id = ?
      `).run(media.error, store, adId);
      
      return res.status(400).json({ error: media.error });
    }

    console.log(`[Gemini] Media extracted via ${media.method}, type: ${media.type}`);

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: resolvedGeminiModel });

    // Build prompt based on media type
    const prompt = media.type === 'video'
      ? `Analyze this video ad FRAME BY FRAME with FULL AUDIO ANALYSIS.

For each scene, provide:
- time: exact timestamp range (e.g., "0:00-0:02", "0:02-0:05")
- visual: detailed description of what's shown
- text: any text/copy on screen (exact wording if visible, null if none)
- action: movement, transitions, animations
- voiceover: exact transcription of any spoken words (include language, e.g., Arabic/English)
- music: describe the music - genre, mood, tempo, energy level
- sound_effects: any sound effects (whoosh, click, ding, etc.)
- hook_element: what makes this moment attention-grabbing (null if not a hook)

IMPORTANT: 
- The first 3 seconds are CRITICAL - break those down in detail
- TRANSCRIBE all spoken audio exactly as said (Arabic, English, etc.)
- Note the music mood changes throughout
- Note every text appearance and when it appears
- Identify the hook, the value prop reveal, and the CTA
- Be specific about timing

Return ONLY valid JSON array, no markdown:
[{"time": "0:00-0:02", "visual": "...", "text": "...", "action": "...", "voiceover": "...", "music": "...", "sound_effects": "...", "hook_element": "..."}]`
      : `Analyze this ad thumbnail. Return ONLY valid JSON, no markdown, no explanation:
{
  "visual": "what's shown",
  "text": "any text visible or null",
  "mood": "overall feeling",
  "product_visible": true or false,
  "hook_elements": ["what grabs attention"],
  "colors": ["dominant colors"],
  "cta": "call to action if visible or null"
}`;

    // Call Gemini with inlineData (base64)
    const result = await model.generateContent([
      {
        inlineData: {
          data: media.data,
          mimeType: media.mimeType
        }
      },
      prompt
    ]);

    const responseText = result.response.text();
    const usage = result?.response?.usageMetadata || null;
    
    // Parse JSON from response
    let script;
    let analysisType = media.type === 'video' ? 'video_frames' : 'thumbnail';
    
    try {
      const cleanJson = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      script = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('[Gemini] JSON parse error:', parseErr.message);
      console.error('[Gemini] Raw response:', responseText.substring(0, 500));
      script = { raw: responseText, parseError: true };
      analysisType = media.type === 'video' ? 'video_raw' : 'thumbnail_raw';
    }

    // Build script data structure
    const scriptData = {
      model: resolvedGeminiModel,
      analysisType,
      frames: analysisType === 'video_frames' ? script : null,
      thumbnail: analysisType.startsWith('thumbnail') ? script : null,
      method: media.method,
      analyzedAt: new Date().toISOString()
    };

    // Store result
    db.prepare(`
      UPDATE creative_scripts 
      SET script = ?, 
          video_url = ?, 
          thumbnail_url = ?, 
          gemini_model = ?,
          status = 'complete', 
          analyzed_at = datetime('now'), 
          updated_at = datetime('now')
      WHERE store = ? AND ad_id = ?
    `).run(
      JSON.stringify(scriptData), 
      sourceUrl || null, 
      thumbnailUrl || null, 
      resolvedGeminiModel,
      store, 
      adId
    );

    res.json({ 
      success: true, 
      script: scriptData, 
      cached: false,
      method: media.method,
      mediaType: media.type,
      model: resolvedGeminiModel,
      usage: usage ? { gemini: usage } : undefined
    });

  } catch (error) {
    console.error('[Gemini] Analysis error:', error);
    
    const db = getDb();
    const { store, adId } = req.body;
    
    if (store && adId) {
      db.prepare(`
        UPDATE creative_scripts 
        SET status = 'failed', error_message = ?, updated_at = datetime('now')
        WHERE store = ? AND ad_id = ?
      `).run(error.message, store, adId);
    }

    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET SCRIPT STATUS
// ============================================================================
router.get('/script/:adId', (req, res) => {
  try {
    const { adId } = req.params;
    const store = req.query.store || 'vironax';
    const db = getDb();

    const script = db.prepare(`
      SELECT * FROM creative_scripts WHERE store = ? AND ad_id = ?
    `).get(store, adId);

    if (!script) {
      return res.json({ exists: false });
    }

    res.json({
      exists: true,
      status: script.status,
      script: script.script ? JSON.parse(script.script) : null,
      model: script.gemini_model || null,
      analyzedAt: script.analyzed_at,
      error: script.error_message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET SCRIPTS FOR CAMPAIGN
// ============================================================================
router.get('/scripts', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { campaignId } = req.query;
    const db = getDb();

    const rows = campaignId
      ? db.prepare(`
          SELECT ad_id, status, analyzed_at
          FROM creative_scripts
          WHERE store = ? AND campaign_id = ?
        `).all(store, campaignId)
      : db.prepare(`
          SELECT ad_id, status, analyzed_at
          FROM creative_scripts
          WHERE store = ?
        `).all(store);

    res.json({
      success: true,
      scripts: rows.map((row) => ({
        ad_id: row.ad_id,
        status: row.status,
        analyzed_at: row.analyzed_at
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// DELETE/RESET SCRIPT (for re-analysis)
// ============================================================================
router.delete('/script/:adId', (req, res) => {
  try {
    const { adId } = req.params;
    const store = req.query.store || 'vironax';
    const db = getDb();

    db.prepare(`DELETE FROM creative_scripts WHERE store = ? AND ad_id = ?`).run(store, adId);
    
    res.json({ success: true, message: 'Script deleted, ready for re-analysis' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CLAUDE CHAT (STREAMING)
// ============================================================================
router.post('/chat', async (req, res) => {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  try {
    const { store, message, adId, adIds, conversationId, reasoning_effort } = req.body;

    const db = getDb();

    // Get user settings
    let settings = db.prepare(`
      SELECT * FROM ai_creative_settings WHERE store = ?
    `).get(store);

    if (!settings) {
      db.prepare(`
        INSERT INTO ai_creative_settings (store) VALUES (?)
      `).run(store);
      settings = {
        model: 'sonnet-4.5',
        reasoning_effort: 'medium',
        temperature: 1.0,
        streaming: 1,
        verbosity: 'medium',
        tone: 'balanced',
        capabilities: { analyze: true, clone: true, ideate: true, audit: true }
      };
    }

    // Resolve ad context set (primary + comparisons)
    const primaryAdId = typeof adId === 'string' ? adId.trim() : '';
    const adIdList = [];
    const seenAdIds = new Set();

    const pushAdId = (candidate) => {
      const next = typeof candidate === 'string' ? candidate.trim() : '';
      if (!next) return;
      if (seenAdIds.has(next)) return;
      if (adIdList.length >= MAX_CREATIVE_CHAT_CONTEXT_ADS) return;
      seenAdIds.add(next);
      adIdList.push(next);
    };

    pushAdId(primaryAdId);
    if (Array.isArray(adIds)) {
      adIds.forEach(pushAdId);
    }

    const conversationAdId = adIdList[0] || null;

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const result = db.prepare(`
        INSERT INTO creative_conversations (store, ad_id, title) VALUES (?, ?, ?)
      `).run(store, conversationAdId, message.slice(0, 50) + (message.length > 50 ? '...' : ''));
      convId = result.lastInsertRowid;
    }

    // Get conversation history
    const history = db.prepare(`
      SELECT role, content FROM creative_messages 
      WHERE conversation_id = ?
      ORDER BY created_at ASC
      LIMIT 20
    `).all(convId);

    // Get ad script if adId provided
    let adContext = '';
    if (adIdList.length > 0) {
      const clip = (value, maxChars = 900) => {
        const text = typeof value === 'string' ? value : '';
        if (!text) return text;
        if (text.length <= maxChars) return text;
        return `${text.slice(0, maxChars - 1)}…`;
      };

      adContext = `\n\n--- SELECTED AD CONTEXT (${adIdList.length} ad${adIdList.length === 1 ? '' : 's'}) ---\n`;
      adContext += `You may compare ads. The first one is the PRIMARY ad.\n`;

      const scriptLookup = db.prepare(`SELECT * FROM creative_scripts WHERE store = ? AND ad_id = ?`);

      adIdList.forEach((contextAdId, index) => {
        const label = index === 0 ? 'PRIMARY AD' : `COMPARE AD ${index + 1}`;
        const frameLimit = index === 0 ? 40 : 16;

        const scriptRow = scriptLookup.get(store, contextAdId);
        if (!scriptRow || !scriptRow.script || scriptRow.status !== 'complete') {
          adContext += `\n--- ${label} ---\nAd ID: ${contextAdId}\nStatus: ${scriptRow?.status || 'not_found'}\n(No completed analysis available.)\n`;
          return;
        }

        let scriptData;
        try {
          scriptData = JSON.parse(scriptRow.script);
        } catch {
          adContext += `\n--- ${label} ---\nAd ID: ${contextAdId}\nStatus: complete\n(Analysis payload is not valid JSON.)\n`;
          return;
        }

        adContext += `\n--- ${label} ---\n`;
        adContext += `Ad ID: ${contextAdId}\n`;
        adContext += `Ad Name: ${scriptRow.ad_name || contextAdId}\n`;
        adContext += `Campaign: ${scriptRow.campaign_name || 'Unknown'}\n`;
        adContext += `Analysis Type: ${scriptData?.analysisType || 'unknown'}\n`;
        adContext += `Extraction Method: ${scriptData?.method || 'unknown'}\n`;

        if (scriptData?.analysisType === 'video_frames' && Array.isArray(scriptData.frames)) {
          const frames = scriptData.frames.slice(0, frameLimit);
          adContext += `\nFRAME-BY-FRAME BREAKDOWN (first ${frames.length} scene${frames.length === 1 ? '' : 's'}):\n`;
          frames.forEach((frame, i) => {
            adContext += `\n[${frame?.time || `Frame ${i + 1}`}]\n`;
            adContext += `  Visual: ${clip(frame?.visual || 'N/A', 360)}\n`;
            adContext += `  Text on screen: ${clip(frame?.text || 'None', 240)}\n`;
            adContext += `  Action/Movement: ${clip(frame?.action || 'N/A', 240)}\n`;
            adContext += `  Voiceover: ${clip(frame?.voiceover || 'None', 360)}\n`;
            adContext += `  Music: ${clip(frame?.music || 'N/A', 220)}\n`;
            adContext += `  Sound Effects: ${clip(frame?.sound_effects || 'None', 160)}\n`;
            adContext += `  Hook Element: ${clip(frame?.hook_element || 'N/A', 220)}\n`;
          });
        } else if (scriptData?.thumbnail) {
          adContext += `\nTHUMBNAIL ANALYSIS:\n${clip(JSON.stringify(scriptData.thumbnail, null, 2), 2400)}\n`;
        } else if (scriptData?.raw) {
          adContext += `\nANALYSIS:\n${clip(String(scriptData.raw), 2400)}\n`;
        } else {
          adContext += `\n(Analysis did not include frames/thumbnail/raw payload.)\n`;
        }
      });

      adContext += `\n--- END SELECTED AD CONTEXT ---\n`;
    }

    // Build messages
    const systemPrompt = buildSystemPrompt(settings) + adContext;
    
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    // Save user message
    db.prepare(`
      INSERT INTO creative_messages (conversation_id, role, content) VALUES (?, 'user', ?)
    `).run(convId, message);

    const modelSelection = settings.model || 'sonnet-4.5';
    const effort = reasoning_effort || settings.reasoning_effort || 'medium';
    const verbosity = settings.verbosity || 'medium';
    const openAIModelMap = {
      'gpt-5.2': 'gpt-5.2',
      'gpt-5.2-pro': 'gpt-5.2-pro',
      'gpt-5.1': 'gpt-5.1-chat-latest'
    };
    const openAIModel = openAIModelMap[modelSelection];
    const deepSeekModels = new Set(['deepseek-chat', 'deepseek-reasoner']);
    const deepSeekModel = deepSeekModels.has(modelSelection) ? modelSelection : null;
    const temperature = Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 1.0;

    if (deepSeekModel) {
      if (!process.env.DEEPSEEK_API_KEY) {
        return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });
      }

      // Always stream DeepSeek (client-side UX expects streaming when using DeepSeek).
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      let fullResponse = '';

      try {
        await streamDeepSeekChat({
          model: deepSeekModel,
          systemPrompt,
          messages,
          maxOutputTokens: 3600,
          temperature,
          onDelta: (text) => {
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
          }
        });
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, model: modelSelection })}\n\n`);
        return res.end();
      }

      db.prepare(`
        INSERT INTO creative_messages (conversation_id, role, content, model) VALUES (?, 'assistant', ?, ?)
      `).run(convId, fullResponse, modelSelection);

      db.prepare(`
        UPDATE creative_conversations SET updated_at = datetime('now') WHERE id = ?
      `).run(convId);

      res.write(`data: ${JSON.stringify({ type: 'done', conversationId: convId, model: modelSelection })}\n\n`);
      return res.end();
    }

    if (openAIModel) {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
      }

      const shouldStreamOpenAI = ['gpt-5.2', 'gpt-5.2-pro'].includes(modelSelection);

      if (shouldStreamOpenAI) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let fullResponse = '';

        try {
          await streamOpenAIChat({
            model: openAIModel,
            reasoningEffort: effort,
            systemPrompt,
            messages,
            maxOutputTokens: 3600,
            verbosity,
            onDelta: (text) => {
              fullResponse += text;
              res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
            }
          });
        } catch (err) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, model: modelSelection })}\n\n`);
          return res.end();
        }

        db.prepare(`
          INSERT INTO creative_messages (conversation_id, role, content, model) VALUES (?, 'assistant', ?, ?)
        `).run(convId, fullResponse, modelSelection);

        db.prepare(`
          UPDATE creative_conversations SET updated_at = datetime('now') WHERE id = ?
        `).run(convId);

        res.write(`data: ${JSON.stringify({ type: 'done', conversationId: convId, model: modelSelection })}\n\n`);
        return res.end();
      }

      const assistantMessage = await askOpenAIChat({
        model: openAIModel,
        reasoningEffort: effort,
        systemPrompt,
        messages,
        maxOutputTokens: 3600,
        verbosity
      });

      db.prepare(`
        INSERT INTO creative_messages (conversation_id, role, content, model) VALUES (?, 'assistant', ?, ?)
      `).run(convId, assistantMessage, modelSelection);

      db.prepare(`
        UPDATE creative_conversations SET updated_at = datetime('now') WHERE id = ?
      `).run(convId);

      return res.json({
        success: true,
        message: assistantMessage,
        conversationId: convId,
        model: modelSelection
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    // Model mapping
    const modelMap = {
      'sonnet-4.5': 'claude-sonnet-4-20250514',
      'opus-4.5': 'claude-opus-4-20250514'
    };
    const modelId = modelMap[modelSelection] || 'claude-sonnet-4-20250514';

    // Initialize Claude
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    if (settings.streaming) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      let fullResponse = '';

      const stream = anthropic.messages.stream({
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages
      });

      stream.on('text', (text) => {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
      });

      stream.on('end', () => {
        // Save assistant message
        db.prepare(`
          INSERT INTO creative_messages (conversation_id, role, content, model) VALUES (?, 'assistant', ?, ?)
        `).run(convId, fullResponse, settings.model);

        // Update conversation timestamp
        db.prepare(`
          UPDATE creative_conversations SET updated_at = datetime('now') WHERE id = ?
        `).run(convId);

        res.write(`data: ${JSON.stringify({ type: 'done', conversationId: convId })}\n\n`);
        res.end();
      });

      stream.on('error', (err) => {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        res.end();
      });

    } else {
      // Non-streaming response
      const response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages
      });

      const assistantMessage = response.content[0].text;

      // Save assistant message
      db.prepare(`
        INSERT INTO creative_messages (conversation_id, role, content, model) VALUES (?, 'assistant', ?, ?)
      `).run(convId, assistantMessage, settings.model);

      // Update conversation timestamp
      db.prepare(`
        UPDATE creative_conversations SET updated_at = datetime('now') WHERE id = ?
      `).run(convId);

      res.json({
        success: true,
        message: assistantMessage,
        conversationId: convId
      });
    }

  } catch (error) {
    console.error('[Claude] Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET CONVERSATIONS
// ============================================================================
router.get('/conversations', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const db = getDb();

    const conversations = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM creative_messages WHERE conversation_id = c.id) as message_count
      FROM creative_conversations c
      WHERE c.store = ?
      ORDER BY c.updated_at DESC
      LIMIT 50
    `).all(store);

    res.json({ success: true, conversations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET CONVERSATION MESSAGES
// ============================================================================
router.get('/conversations/:id', (req, res) => {
  try {
    const db = getDb();

    const conversation = db.prepare(`
      SELECT * FROM creative_conversations WHERE id = ?
    `).get(req.params.id);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = db.prepare(`
      SELECT * FROM creative_messages WHERE conversation_id = ? ORDER BY created_at ASC
    `).all(req.params.id);

    res.json({ success: true, conversation, messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// DELETE CONVERSATION
// ============================================================================
router.delete('/conversations/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare(`DELETE FROM creative_messages WHERE conversation_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM creative_conversations WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GET/UPDATE SETTINGS
// ============================================================================
router.get('/settings', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const db = getDb();

    let settings = db.prepare(`
      SELECT * FROM ai_creative_settings WHERE store = ?
    `).get(store);

    if (!settings) {
      db.prepare(`INSERT INTO ai_creative_settings (store) VALUES (?)`).run(store);
      settings = {
        store,
        model: 'sonnet-4.5',
        gemini_analysis_model: DEFAULT_GEMINI_ANALYSIS_MODEL,
        reasoning_effort: 'medium',
        temperature: 1.0,
        streaming: 1,
        verbosity: 'medium',
        tone: 'balanced',
        custom_prompt: null,
        capabilities: { analyze: true, clone: true, ideate: true, audit: true }
      };
    } else {
      settings.capabilities = typeof settings.capabilities === 'string'
        ? JSON.parse(settings.capabilities)
        : settings.capabilities;
      settings.gemini_analysis_model = GEMINI_ANALYSIS_MODELS.has(settings.gemini_analysis_model)
        ? settings.gemini_analysis_model
        : DEFAULT_GEMINI_ANALYSIS_MODEL;
      settings.reasoning_effort = settings.reasoning_effort || 'medium';
      settings.temperature = Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 1.0;
      settings.verbosity = settings.verbosity || 'medium';
    }

    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const { store, model, gemini_analysis_model, reasoning_effort, temperature, streaming, tone, custom_prompt, capabilities, verbosity } = req.body;
    const db = getDb();

    const nextGeminiAnalysisModel = GEMINI_ANALYSIS_MODELS.has(gemini_analysis_model)
      ? gemini_analysis_model
      : DEFAULT_GEMINI_ANALYSIS_MODEL;

    db.prepare(`
      INSERT INTO ai_creative_settings (store, model, gemini_analysis_model, reasoning_effort, temperature, streaming, tone, custom_prompt, capabilities, verbosity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(store) DO UPDATE SET
        model = excluded.model,
        gemini_analysis_model = excluded.gemini_analysis_model,
        reasoning_effort = excluded.reasoning_effort,
        temperature = excluded.temperature,
        streaming = excluded.streaming,
        tone = excluded.tone,
        custom_prompt = excluded.custom_prompt,
        capabilities = excluded.capabilities,
        verbosity = excluded.verbosity,
        updated_at = datetime('now')
    `).run(
      store,
      model || 'sonnet-4.5',
      nextGeminiAnalysisModel,
      reasoning_effort || 'medium',
      Number.isFinite(Number(temperature)) ? Number(temperature) : 1.0,
      streaming ? 1 : 0,
      tone || 'balanced',
      custom_prompt || null,
      JSON.stringify(capabilities || { analyze: true, clone: true, ideate: true, audit: true }),
      verbosity || 'medium'
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// STATUS CHECK
// ============================================================================
router.get('/status', async (req, res) => {
  const ytdlp = await getYtdlpStatus();

  res.json({
    gemini: !!process.env.GEMINI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    ytdlp
  });
});

// ============================================================================
// YT-DLP STATUS
// ============================================================================
router.get('/yt-dlp-status', async (req, res) => {
  const status = await getYtdlpStatus();
  res.json(status);
});

// ============================================================================
// YT-DLP UPDATE
// ============================================================================
router.post('/yt-dlp-update', async (req, res) => {
  const success = await updateYtdlp();
  const status = await getYtdlpStatus();
  res.json({ updated: success, ...status });
});

export default router;
