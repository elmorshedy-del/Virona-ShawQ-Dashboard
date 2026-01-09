import express from 'express';
import { getDb } from '../db/database.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
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
  let prompt = `You have access to ad creative scripts (frame-by-frame analysis from video) and Meta performance data (CTR, ROAS, spend, orders).

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
// YT-DLP VIDEO URL EXTRACTION
// ============================================================================
async function extractVideoUrl(embedHtml) {
  if (!embedHtml) return null;

  const match = embedHtml.match(/href=([^&"]+)/);
  if (!match) return null;

  const fbUrl = decodeURIComponent(match[1]);

  try {
    const { stdout } = await execPromise(`yt-dlp -g "${fbUrl}" 2>/dev/null`, { timeout: 30000 });
    return stdout.trim();
  } catch (err) {
    console.error('[yt-dlp] Extraction failed:', err.message);
    return null;
  }
}

// ============================================================================
// GEMINI VIDEO ANALYSIS
// ============================================================================
router.post('/analyze-video', async (req, res) => {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  
  try {
    const { store, adId, adName, campaignId, campaignName, sourceUrl, embedHtml, thumbnailUrl } = req.body;

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
        cached: true 
      });
    }

    // Mark as processing
    db.prepare(`
      INSERT INTO creative_scripts (store, ad_id, ad_name, campaign_id, campaign_name, status)
      VALUES (?, ?, ?, ?, ?, 'processing')
      ON CONFLICT(store, ad_id) DO UPDATE SET status = 'processing', updated_at = datetime('now')
    `).run(store, adId, adName, campaignId, campaignName);

    // Get video URL
    let videoUrl = sourceUrl;
    if (!videoUrl && embedHtml) {
      videoUrl = await extractVideoUrl(embedHtml);
    }

    const mediaUrl = videoUrl || thumbnailUrl;
    const isVideo = !!videoUrl;

    if (!mediaUrl) {
      db.prepare(`
        UPDATE creative_scripts SET status = 'failed', error_message = 'No media URL available', updated_at = datetime('now')
        WHERE store = ? AND ad_id = ?
      `).run(store, adId);
      return res.status(400).json({ error: 'No video or thumbnail URL available' });
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const prompt = isVideo
      ? `Analyze this video ad frame by frame. For each distinct scene, provide:
- time: timestamp range (e.g., "0:00-0:03")
- visual: what's shown visually
- text: any text on screen (null if none)
- action: camera movement or transition type
- audio: description of audio/music if noticeable

Return ONLY valid JSON array, no markdown:
[
  {"time": "0:00-0:03", "visual": "...", "text": "...", "action": "...", "audio": "..."},
  ...
]`
      : `Analyze this ad thumbnail image. Describe:
- visual: what's shown
- text: any text visible
- mood: overall feeling
- product_visible: true/false
- hook_elements: what grabs attention

Return ONLY valid JSON object, no markdown.`;

    // Call Gemini
    const result = await model.generateContent([
      {
        fileData: {
          fileUri: mediaUrl,
          mimeType: isVideo ? 'video/mp4' : 'image/jpeg'
        }
      },
      prompt
    ]);

    const responseText = result.response.text();
    
    // Parse JSON from response
    let script;
    try {
      // Remove markdown code blocks if present
      const cleanJson = responseText.replace(/```json\n?|\n?```/g, '').trim();
      script = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('[Gemini] JSON parse error:', parseErr.message);
      script = { raw: responseText, parseError: true };
    }

    // Store result
    db.prepare(`
      UPDATE creative_scripts 
      SET script = ?, video_url = ?, thumbnail_url = ?, status = 'complete', analyzed_at = datetime('now'), updated_at = datetime('now')
      WHERE store = ? AND ad_id = ?
    `).run(JSON.stringify(script), videoUrl, thumbnailUrl, store, adId);

    res.json({ success: true, script, cached: false });

  } catch (error) {
    console.error('[Gemini] Analysis error:', error);
    
    const db = getDb();
    const { store, adId } = req.body;
    if (store && adId) {
      db.prepare(`
        UPDATE creative_scripts SET status = 'failed', error_message = ?, updated_at = datetime('now')
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
// CLAUDE CHAT (STREAMING)
// ============================================================================
router.post('/chat', async (req, res) => {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  try {
    const { store, message, adId, conversationId } = req.body;

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const db = getDb();

    // Get user settings
    let settings = db.prepare(`
      SELECT * FROM ai_creative_settings WHERE store = ?
    `).get(store);

    if (!settings) {
      // Create default settings
      db.prepare(`
        INSERT INTO ai_creative_settings (store) VALUES (?)
      `).run(store);
      settings = {
        model: 'sonnet-4.5',
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
      const script = db.prepare(`
        SELECT * FROM creative_scripts WHERE store = ? AND ad_id = ?
      `).get(store, adId);

      if (script && script.script) {
        adContext = `\n\nCurrent Ad: ${script.ad_name || adId}
Campaign: ${script.campaign_name || 'Unknown'}
Script Analysis:
${script.script}
`;
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

    // Model mapping
    const modelMap = {
      'sonnet-4.5': 'claude-sonnet-4-20250514',
      'opus-4.5': 'claude-opus-4-20250514'
    };
    const modelId = modelMap[settings.model] || 'claude-sonnet-4-20250514';

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
        streaming: 1,
        tone: 'balanced',
        custom_prompt: null,
        capabilities: { analyze: true, clone: true, ideate: true, audit: true }
      };
    } else {
      settings.capabilities = typeof settings.capabilities === 'string'
        ? JSON.parse(settings.capabilities)
        : settings.capabilities;
    }

    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const { store, model, streaming, tone, custom_prompt, capabilities } = req.body;
    const db = getDb();

    db.prepare(`
      INSERT INTO ai_creative_settings (store, model, streaming, tone, custom_prompt, capabilities)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(store) DO UPDATE SET
        model = excluded.model,
        streaming = excluded.streaming,
        tone = excluded.tone,
        custom_prompt = excluded.custom_prompt,
        capabilities = excluded.capabilities,
        updated_at = datetime('now')
    `).run(
      store,
      model || 'sonnet-4.5',
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
  let ytdlpVersion = null;
  try {
    const { stdout } = await execPromise('yt-dlp --version');
    ytdlpVersion = stdout.trim();
  } catch (e) {
    ytdlpVersion = null;
  }

  res.json({
    gemini: !!process.env.GEMINI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    ytdlp: ytdlpVersion ? { installed: true, version: ytdlpVersion } : { installed: false }
  });
});

export default router;
