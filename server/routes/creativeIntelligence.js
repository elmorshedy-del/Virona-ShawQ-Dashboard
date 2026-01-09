import express from 'express';
import { getDb } from '../db/database.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

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
// DOWNLOAD VIDEO FILE
// ============================================================================
async function downloadVideo(url, outputPath) {
  const fetch = (await import('node-fetch')).default;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }
  
  const buffer = await response.buffer();
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ============================================================================
// EXTRACT VIDEO URL WITH YT-DLP
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
// DOWNLOAD VIDEO WITH YT-DLP (BETTER FOR FB VIDEOS)
// ============================================================================
async function downloadWithYtdlp(url, outputPath) {
  try {
    await execPromise(`yt-dlp -o "${outputPath}" --no-playlist "${url}"`, { timeout: 120000 });
    return outputPath;
  } catch (err) {
    console.error('[yt-dlp] Download failed:', err.message);
    return null;
  }
}

// ============================================================================
// GEMINI VIDEO ANALYSIS WITH FILE UPLOAD
// ============================================================================
router.post('/analyze-video', async (req, res) => {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const { GoogleAIFileManager } = await import('@google/generative-ai/server');
  
  const debug = {
    requestId: crypto.randomUUID(),
    route: '/api/creative-intelligence/analyze-video',
    receivedAt: new Date().toISOString(),
    steps: []
  };
  const recordStep = (step, details = {}) => {
    debug.steps.push({ step, at: new Date().toISOString(), ...details });
  };

  let tempFilePath = null;
  let geminiUsage = null;
  
  try {
    const { store, adId, adName, campaignId, campaignName, sourceUrl, embedHtml, thumbnailUrl } = req.body;

    recordStep('request_received', {
      store,
      adId,
      adName,
      campaignId,
      campaignName,
      hasSourceUrl: !!sourceUrl,
      hasEmbedHtml: !!embedHtml,
      hasThumbnailUrl: !!thumbnailUrl
    });

    if (!process.env.GEMINI_API_KEY) {
      recordStep('missing_env', { key: 'GEMINI_API_KEY' });
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured', debug });
    }

    const db = getDb();

    // Check if already analyzed
    const existing = db.prepare(`
      SELECT * FROM creative_scripts WHERE store = ? AND ad_id = ?
    `).get(store, adId);

    if (existing && existing.status === 'complete') {
      recordStep('cache_hit', { status: existing.status });
      return res.json({ 
        success: true, 
        script: JSON.parse(existing.script),
        cached: true,
        tokenUsage: { gemini: null },
        debug 
      });
    }

    // Mark as processing
    recordStep('db_status_update', { status: 'processing' });
    db.prepare(`
      INSERT INTO creative_scripts (store, ad_id, ad_name, campaign_id, campaign_name, status)
      VALUES (?, ?, ?, ?, ?, 'processing')
      ON CONFLICT(store, ad_id) DO UPDATE SET status = 'processing', updated_at = datetime('now')
    `).run(store, adId, adName, campaignId, campaignName);

    // Get video URL
    let videoUrl = sourceUrl;
    if (!videoUrl && embedHtml) {
      videoUrl = await extractVideoUrl(embedHtml);
      recordStep('video_url_extracted', { success: !!videoUrl });
    }

    // Determine what we're analyzing
    const hasVideo = !!videoUrl;
    const mediaUrl = videoUrl || thumbnailUrl;

    if (!mediaUrl) {
      recordStep('media_unavailable', { hasVideo, hasThumbnailUrl: !!thumbnailUrl });
      db.prepare(`
        UPDATE creative_scripts SET status = 'failed', error_message = 'No media URL available', updated_at = datetime('now')
        WHERE store = ? AND ad_id = ?
      `).run(store, adId);
      return res.status(400).json({ error: 'No video or thumbnail URL available', debug });
    }

    // Initialize Gemini
    recordStep('gemini_init', { model: 'gemini-2.0-flash-exp', hasVideo });
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    let script;
    let analysisType = 'thumbnail';

    if (hasVideo) {
      // TRY TO DOWNLOAD AND UPLOAD VIDEO
      try {
        const tempDir = os.tmpdir();
        tempFilePath = path.join(tempDir, `ad_${adId}_${Date.now()}.mp4`);
        
        console.log(`[Gemini] Downloading video for ad ${adId}...`);
        recordStep('video_download_start', { tempFilePath });
        
        // Try direct download first, then yt-dlp
        let downloaded = false;
        try {
          await downloadVideo(videoUrl, tempFilePath);
          downloaded = fs.existsSync(tempFilePath) && fs.statSync(tempFilePath).size > 0;
          recordStep('video_download_direct', { success: downloaded });
        } catch (e) {
          console.log('[Gemini] Direct download failed, trying yt-dlp...');
          recordStep('video_download_direct_failed', { error: e.message });
        }
        
        if (!downloaded) {
          // Try yt-dlp
          const ytdlpPath = path.join(tempDir, `ad_${adId}_${Date.now()}_ytdlp.mp4`);
          const result = await downloadWithYtdlp(videoUrl, ytdlpPath);
          if (result && fs.existsSync(ytdlpPath)) {
            tempFilePath = ytdlpPath;
            downloaded = true;
            recordStep('video_download_ytdlp', { success: true, path: ytdlpPath });
          } else {
            recordStep('video_download_ytdlp', { success: false });
          }
        }

        if (downloaded && fs.existsSync(tempFilePath)) {
          const fileSize = fs.statSync(tempFilePath).size;
          console.log(`[Gemini] Video downloaded: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
          recordStep('video_downloaded', { fileSize });

          // Upload to Gemini File API
          console.log('[Gemini] Uploading to Gemini File API...');
          recordStep('gemini_upload_start');
          const uploadResult = await fileManager.uploadFile(tempFilePath, {
            mimeType: 'video/mp4',
            displayName: `Ad ${adId} Video`
          });

          console.log(`[Gemini] Upload complete: ${uploadResult.file.name}`);
          recordStep('gemini_upload_complete', { fileName: uploadResult.file.name });

          // Wait for processing
          let file = uploadResult.file;
          while (file.state === 'PROCESSING') {
            await new Promise(r => setTimeout(r, 2000));
            file = await fileManager.getFile(file.name);
          }

          if (file.state === 'FAILED') {
            recordStep('gemini_file_processing_failed');
            throw new Error('Video processing failed');
          }

          console.log('[Gemini] Analyzing video frame-by-frame...');
          recordStep('gemini_video_analysis_start', { fileUri: file.uri });

          // Analyze with frame-by-frame prompt
          const result = await model.generateContent([
            {
              fileData: {
                fileUri: file.uri,
                mimeType: 'video/mp4'
              }
            },
            `Analyze this video ad FRAME BY FRAME with FULL AUDIO ANALYSIS.

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
[
  {"time": "0:00-0:02", "visual": "...", "text": "...", "action": "...", "voiceover": "...", "music": "...", "sound_effects": "...", "hook_element": "..."},
  ...
]`
          ]);
          geminiUsage = result.response.usageMetadata || null;

          const responseText = result.response.text();
          
          // Parse JSON
          try {
            const cleanJson = responseText.replace(/```json\n?|\n?```/g, '').trim();
            script = JSON.parse(cleanJson);
            analysisType = 'video_frames';
            console.log(`[Gemini] Extracted ${Array.isArray(script) ? script.length : 0} frames`);
            recordStep('gemini_video_parse_success', { frameCount: Array.isArray(script) ? script.length : 0 });
          } catch (parseErr) {
            console.error('[Gemini] JSON parse error:', parseErr.message);
            script = { raw: responseText, parseError: true, type: 'video' };
            analysisType = 'video_raw';
            recordStep('gemini_video_parse_failed', { error: parseErr.message });
          }

          // Clean up uploaded file
          try {
            await fileManager.deleteFile(file.name);
          } catch (e) {
            console.log('[Gemini] Could not delete uploaded file');
            recordStep('gemini_file_delete_failed', { error: e.message });
          }
        } else {
          recordStep('video_download_failed');
          throw new Error('Could not download video');
        }
      } catch (videoErr) {
        console.error('[Gemini] Video analysis failed, falling back to thumbnail:', videoErr.message);
        recordStep('gemini_video_analysis_failed', { error: videoErr.message });
        // Fall through to thumbnail analysis
      }
    }

    // FALLBACK: Thumbnail analysis if video failed or not available
    if (!script) {
      console.log('[Gemini] Analyzing thumbnail image...');
      recordStep('gemini_thumbnail_analysis_start', { mediaUrl: thumbnailUrl || mediaUrl });
      
      const result = await model.generateContent([
        {
          fileData: {
            fileUri: thumbnailUrl || mediaUrl,
            mimeType: 'image/jpeg'
          }
        },
        `Analyze this ad image in detail:

1. Visual Elements:
   - Main subject/product
   - Background and setting
   - Colors and contrast
   - Composition

2. Text/Copy:
   - All visible text (exact wording)
   - Text placement and hierarchy
   - Language used

3. Marketing Elements:
   - Hook/attention grabber
   - Value proposition
   - Call to action
   - Social proof elements

4. Target Audience Signals:
   - Who is this ad targeting?
   - Cultural/regional indicators
   - Price/value positioning

Return as JSON object with these sections. No markdown.`
      ]);
      geminiUsage = result.response.usageMetadata || null;

      const responseText = result.response.text();
      
      try {
        const cleanJson = responseText.replace(/```json\n?|\n?```/g, '').trim();
        script = JSON.parse(cleanJson);
        analysisType = 'thumbnail';
        recordStep('gemini_thumbnail_parse_success');
      } catch (parseErr) {
        script = { raw: responseText, parseError: true, type: 'thumbnail' };
        analysisType = 'thumbnail_raw';
        recordStep('gemini_thumbnail_parse_failed', { error: parseErr.message });
      }
    }

    // Clean up temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }

    // Store result
    const scriptData = {
      analysisType,
      frames: analysisType === 'video_frames' ? script : null,
      thumbnail: analysisType !== 'video_frames' ? script : null,
      analyzedAt: new Date().toISOString()
    };

    recordStep('db_status_update', { status: 'complete', analysisType });
    db.prepare(`
      UPDATE creative_scripts 
      SET script = ?, video_url = ?, thumbnail_url = ?, status = 'complete', analyzed_at = datetime('now'), updated_at = datetime('now')
      WHERE store = ? AND ad_id = ?
    `).run(JSON.stringify(scriptData), videoUrl, thumbnailUrl, store, adId);

    res.json({
      success: true,
      script: scriptData,
      cached: false,
      analysisType,
      tokenUsage: { gemini: geminiUsage },
      debug
    });

  } catch (error) {
    console.error('[Gemini] Analysis error:', error);
    recordStep('analysis_error', { error: error.message });
    
    // Clean up temp file on error
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }
    
    const db = getDb();
    const { store, adId } = req.body;
    if (store && adId) {
      db.prepare(`
        UPDATE creative_scripts SET status = 'failed', error_message = ?, updated_at = datetime('now')
        WHERE store = ? AND ad_id = ?
      `).run(error.message, store, adId);
    }

    res.status(500).json({ error: error.message, debug });
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
  const debug = {
    requestId: crypto.randomUUID(),
    route: '/api/creative-intelligence/chat',
    receivedAt: new Date().toISOString(),
    steps: []
  };
  const recordStep = (step, details = {}) => {
    debug.steps.push({ step, at: new Date().toISOString(), ...details });
  };

  try {
    const { store, message, adId, conversationId } = req.body;

    if (!process.env.ANTHROPIC_API_KEY) {
      recordStep('missing_env', { key: 'ANTHROPIC_API_KEY' });
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured', debug });
    }

    const db = getDb();
    recordStep('request_received', { store, adId, hasConversationId: !!conversationId, messageLength: message?.length || 0 });

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
        streaming: 1,
        tone: 'balanced',
        capabilities: { analyze: true, clone: true, ideate: true, audit: true }
      };
    }
    recordStep('settings_loaded', { model: settings.model, streaming: !!settings.streaming, tone: settings.tone });

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const result = db.prepare(`
        INSERT INTO creative_conversations (store, ad_id, title) VALUES (?, ?, ?)
      `).run(store, adId, message.slice(0, 50) + (message.length > 50 ? '...' : ''));
      convId = result.lastInsertRowid;
      recordStep('conversation_created', { conversationId: convId });
    }
    recordStep('conversation_ready', { conversationId: convId });

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
    recordStep('prompt_built', { historyCount: history.length, contextLength: adContext.length });

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
    recordStep('anthropic_init', { modelId });

    if (settings.streaming) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      let fullResponse = '';
      let finalUsage = null;

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

      stream.on('finalMessage', (message) => {
        finalUsage = message?.usage || null;
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

        res.write(`data: ${JSON.stringify({ type: 'done', conversationId: convId, usage: finalUsage, debug })}\n\n`);
        res.end();
      });

      stream.on('error', (err) => {
        recordStep('stream_error', { error: err.message });
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message, debug })}\n\n`);
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
        conversationId: convId,
        usage: response.usage || null,
        debug
      });
    }

  } catch (error) {
    console.error('[Claude] Chat error:', error);
    recordStep('chat_error', { error: error.message });
    res.status(500).json({ error: error.message, debug });
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
