import express from 'express';
import { getDb } from '../db/database.js';
import { extractAndDownloadMedia, getYtdlpStatus, updateYtdlp } from '../utils/videoExtractor.js';
import { askGPT51, askOpenAIChat } from '../services/openaiService.js';

const router = express.Router();

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
    const { store, adId, adName, campaignId, campaignName, sourceUrl, embedHtml, thumbnailUrl } = req.body;

    // Validate
    if (!store || !adId) {
      return res.status(400).json({ error: 'Missing store or adId' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    const db = getDb();

    // Check if already analyzed
    const existing = db.prepare(`
      SELECT * FROM creative_scripts WHERE store = ? AND ad_id = ?
    `).get(store, adId);

    if (existing && existing.status === 'complete') {
      return res.json({ 
        success: true, 
        script: JSON.parse(existing.script),
        cached: true,
        method: existing.extraction_method || 'unknown'
      });
    }

    // Mark as processing
    db.prepare(`
      INSERT INTO creative_scripts (store, ad_id, ad_name, campaign_id, campaign_name, status)
      VALUES (?, ?, ?, ?, ?, 'processing')
      ON CONFLICT(store, ad_id) DO UPDATE SET status = 'processing', updated_at = datetime('now')
    `).run(store, adId, adName || '', campaignId || '', campaignName || '');

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
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

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
          status = 'complete', 
          analyzed_at = datetime('now'), 
          updated_at = datetime('now')
      WHERE store = ? AND ad_id = ?
    `).run(
      JSON.stringify(scriptData), 
      sourceUrl || null, 
      thumbnailUrl || null, 
      store, 
      adId
    );

    res.json({ 
      success: true, 
      script: scriptData, 
      cached: false,
      method: media.method,
      mediaType: media.type
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
    const { store, message, adId, conversationId, reasoning_effort } = req.body;

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
        reasoning_effort: 'high',
        streaming: 1,
        tone: 'balanced',
        capabilities: { analyze: true, clone: true, ideate: true, audit: true }
      };
    }

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const result = db.prepare(`
        INSERT INTO creative_conversations (store, ad_id, title) VALUES (?, ?, ?)
      `).run(store, adId, message.slice(0, 50) + (message.length > 50 ? '...' : ''));
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
    if (adId) {
      const scriptRow = db.prepare(`
        SELECT * FROM creative_scripts WHERE store = ? AND ad_id = ?
      `).get(store, adId);

      if (scriptRow && scriptRow.script) {
        const scriptData = JSON.parse(scriptRow.script);
        
        adContext = `\n\n--- CURRENT AD CONTEXT ---
Ad Name: ${scriptRow.ad_name || adId}
Campaign: ${scriptRow.campaign_name || 'Unknown'}
Analysis Type: ${scriptData.analysisType || 'unknown'}
Extraction Method: ${scriptData.method || 'unknown'}
`;

        if (scriptData.analysisType === 'video_frames' && scriptData.frames) {
          adContext += `\nFRAME-BY-FRAME BREAKDOWN:\n`;
          if (Array.isArray(scriptData.frames)) {
            scriptData.frames.forEach((frame, i) => {
              adContext += `\n[${frame.time || `Frame ${i+1}`}]
  Visual: ${frame.visual || 'N/A'}
  Text on screen: ${frame.text || 'None'}
  Action/Movement: ${frame.action || 'N/A'}
  Voiceover: ${frame.voiceover || 'None'}
  Music: ${frame.music || 'N/A'}
  Sound Effects: ${frame.sound_effects || 'None'}
  Hook Element: ${frame.hook_element || 'N/A'}
`;
            });
          }
        } else if (scriptData.thumbnail) {
          adContext += `\nTHUMBNAIL ANALYSIS:\n${JSON.stringify(scriptData.thumbnail, null, 2)}\n`;
        } else if (scriptData.raw) {
          adContext += `\nANALYSIS:\n${scriptData.raw}\n`;
        }
        
        adContext += `\n--- END AD CONTEXT ---\n`;
      }
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
    const effort = reasoning_effort || settings.reasoning_effort || 'high';
    const verbosity = req.body?.verbosity || settings.verbosity || 'medium';

    if (modelSelection === 'gpt-5.1') {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
      }

      const gptMessages = [{ role: 'system', content: systemPrompt }, ...messages];
      const assistantMessage = await askGPT51(gptMessages, effort);

      db.prepare(`
        INSERT INTO creative_messages (conversation_id, role, content, model) VALUES (?, 'assistant', ?, ?)
      `).run(convId, assistantMessage, 'gpt-5.1');

      db.prepare(`
        UPDATE creative_conversations SET updated_at = datetime('now') WHERE id = ?
      `).run(convId);

      return res.json({
        success: true,
        message: assistantMessage,
        conversationId: convId,
        model: 'gpt-5.1'
      });
    }

    if (modelSelection === 'gpt-5.2' || modelSelection === 'gpt-5.2-pro') {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
      }

      const assistantMessage = await askOpenAIChat({
        model: modelSelection,
        reasoningEffort: effort,
        systemPrompt,
        messages,
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
        reasoning_effort: 'high',
        verbosity: 'medium',
        streaming: 1,
        tone: 'balanced',
        custom_prompt: null,
        capabilities: { analyze: true, clone: true, ideate: true, audit: true }
      };
    } else {
      settings.capabilities = typeof settings.capabilities === 'string'
        ? JSON.parse(settings.capabilities)
        : settings.capabilities;
      settings.reasoning_effort = settings.reasoning_effort || 'high';
      settings.verbosity = settings.verbosity || 'medium';
    }

    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const { store, model, reasoning_effort, verbosity, streaming, tone, custom_prompt, capabilities } = req.body;
    const db = getDb();

    db.prepare(`
      INSERT INTO ai_creative_settings (store, model, reasoning_effort, verbosity, streaming, tone, custom_prompt, capabilities)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(store) DO UPDATE SET
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        verbosity = excluded.verbosity,
        streaming = excluded.streaming,
        tone = excluded.tone,
        custom_prompt = excluded.custom_prompt,
        capabilities = excluded.capabilities,
        updated_at = datetime('now')
    `).run(
      store,
      model || 'sonnet-4.5',
      reasoning_effort || 'high',
      verbosity || 'medium',
      streaming ? 1 : 0,
      tone || 'balanced',
      custom_prompt || null,
      JSON.stringify(capabilities || { analyze: true, clone: true, ideate: true, audit: true })
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
