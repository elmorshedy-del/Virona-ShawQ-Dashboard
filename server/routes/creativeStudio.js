import express from 'express';
import axios from 'axios';
import multer from 'multer';
import path from 'path';
import * as geminiVision from '../services/geminiVisionService.js';
import * as cloudinary from '../services/cloudinaryService.js';
import * as fbAdLibrary from '../services/fbAdLibraryService.js';
import * as fatigueService from '../services/fatigueService.js';
import * as auditorService from '../services/auditorService.js';
import { extractAndDownloadVideoFromUrl } from '../utils/videoExtractor.js';
import { getDb } from '../db/database.js';

const router = express.Router();
const db = getDb();

const upload = multer({ storage: multer.memoryStorage() });

// ============================================================================
// META CONNECTION STATUS
// ============================================================================

router.get('/meta-status', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const db = getDb();

    const hasData = db.prepare(`
      SELECT COUNT(*) as count FROM meta_daily_metrics WHERE store = ?
    `).get(store);

    res.json({
      connected: hasData.count > 0,
      store
    });
  } catch (error) {
    console.error('Meta status error:', error);
    res.status(500).json({ connected: false, error: error.message });
  }
});

// ============================================================================
// GEMINI PROXY (Ad Studio)
// ============================================================================

router.post('/gemini', async (req, res) => {
  try {
    const { model, payload } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    if (!payload) {
      return res.status(400).json({ error: 'Payload is required.' });
    }

    const resolvedModel = model || 'gemini-2.5-flash-preview-09-2025';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    return res.json(response.data);
  } catch (error) {
    console.error('Gemini proxy error:', error?.response?.data || error.message);
    return res.status(500).json({ error: error?.response?.data?.error?.message || error.message });
  }
});


// ============================================================================
// CREATIVES CRUD
// ============================================================================

// Save new creative
router.post('/creatives', async (req, res) => {
  try {
    const { name, type, layout, content, style, thumbnail_url, image_url, product_id, source } = req.body;

    const stmt = db.prepare(`
      INSERT INTO studio_creatives (name, type, layout, content, style, thumbnail_url, image_url, product_id, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name || 'Untitled',
      type || 'post',
      layout || 'centered',
      JSON.stringify(content || {}),
      JSON.stringify(style || {}),
      thumbnail_url,
      image_url,
      product_id,
      source || 'manual'
    );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Creative saved successfully'
    });
  } catch (error) {
    console.error('Save creative error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all creatives
router.get('/creatives', async (req, res) => {
  try {
    const { type, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM studio_creatives';
    const params = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const creatives = db.prepare(query).all(...params);

    // Parse JSON fields
    const parsed = creatives.map(c => ({
      ...c,
      content: JSON.parse(c.content || '{}'),
      style: JSON.parse(c.style || '{}')
    }));

    res.json({ success: true, creatives: parsed });
  } catch (error) {
    console.error('Get creatives error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete creative
router.delete('/creatives/:id', async (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM studio_creatives WHERE id = ?').run(id);
    res.json({ success: true, message: 'Creative deleted' });
  } catch (error) {
    console.error('Delete creative error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// STYLE EXTRACTOR
// ============================================================================

router.post('/extract-style', upload.single('image'), async (req, res) => {
  try {
    let imageBase64;

    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    } else if (req.body.image_url) {
      imageBase64 = await cloudinary.fetchAsBase64(req.body.image_url);
    } else {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    const style = await geminiVision.extractStyle(imageBase64);

    res.json({ success: true, style });
  } catch (error) {
    console.error('Style extraction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// COMPETITOR SPY
// ============================================================================

// Search Facebook Ad Library
router.get('/competitor/search', async (req, res) => {
  try {
    const { brand_name, country = 'SA', limit = 25 } = req.query;

    if (!brand_name) {
      return res.status(400).json({ success: false, error: 'Brand name required' });
    }

    const ads = await fbAdLibrary.searchByBrand(brand_name, { country, limit: parseInt(limit) });

    res.json({ success: true, ads, count: ads.length });
  } catch (error) {
    console.error('Competitor search error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get supported countries
router.get('/competitor/countries', (req, res) => {
  res.json({ success: true, countries: fbAdLibrary.getSupportedCountries() });
});

// Analyze competitor ad
router.post('/competitor/analyze', upload.single('image'), async (req, res) => {
  try {
    let analysis;
    let analysisMediaType = 'image';

    if (req.body.snapshot_url) {
      const videoResult = await extractAndDownloadVideoFromUrl(req.body.snapshot_url);
      if (!videoResult.success) {
        return res.status(400).json({ success: false, error: videoResult.error });
      }
      analysisMediaType = 'video';
      analysis = await geminiVision.analyzeCompetitorVideo(videoResult.data);
    } else {
      let imageBase64;

      if (req.file) {
        imageBase64 = req.file.buffer.toString('base64');
      } else if (req.body.image_url) {
        imageBase64 = await cloudinary.fetchAsBase64(req.body.image_url);
      } else {
        return res.status(400).json({ success: false, error: 'No image provided' });
      }

      analysis = await geminiVision.analyzeCompetitorAd(imageBase64);
    }

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO competitor_analyses (brand_name, source_url, source_type, creative_url, analysis)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      req.body.brand_name || 'Unknown',
      req.body.source_url || req.body.snapshot_url || null,
      req.body.source_type || 'screenshot',
      req.body.image_url || null,
      JSON.stringify(analysis)
    );

    res.json({
      success: true,
      analysis,
      analysis_id: result.lastInsertRowid,
      media_type: analysisMediaType
    });
  } catch (error) {
    console.error('Competitor analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get past analyses
router.get('/competitor/analyses', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const analyses = db.prepare(`
      SELECT * FROM competitor_analyses 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(parseInt(limit));

    const parsed = analyses.map(a => ({
      ...a,
      analysis: JSON.parse(a.analysis || '{}')
    }));

    res.json({ success: true, analyses: parsed });
  } catch (error) {
    console.error('Get analyses error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// HOOK GENERATOR
// ============================================================================

router.post('/generate/hooks', async (req, res) => {
  try {
    const { product_name, product_description, target_audience, tone = 'professional', count = 20 } = req.body;

    if (!product_name || !product_description) {
      return res.status(400).json({ success: false, error: 'Product name and description required' });
    }

    const hooks = await geminiVision.generateHooks({
      product_name,
      product_description,
      target_audience: target_audience || 'general audience',
      tone,
      count: Math.min(count, 30)
    });

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO generated_content (type, input, output, model_used)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      'hook',
      JSON.stringify({ product_name, product_description, target_audience, tone }),
      JSON.stringify(hooks),
      'gemini-2.0-flash'
    );

    res.json({ success: true, hooks });
  } catch (error) {
    console.error('Hook generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// UGC SCRIPT WRITER
// ============================================================================

router.post('/generate/script', async (req, res) => {
  try {
    const {
      product_name,
      product_benefits,
      target_audience,
      duration = '30s',
      style = 'testimonial'
    } = req.body;

    if (!product_name || !product_benefits) {
      return res.status(400).json({ success: false, error: 'Product name and benefits required' });
    }

    const script = await geminiVision.generateUGCScript({
      product_name,
      product_benefits,
      target_audience: target_audience || 'general audience',
      duration,
      style
    });

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO generated_content (type, input, output, model_used)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      'script',
      JSON.stringify({ product_name, product_benefits, target_audience, duration, style }),
      JSON.stringify(script),
      'gemini-2.0-flash'
    );

    res.json({ success: true, script });
  } catch (error) {
    console.error('Script generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// AD COPY LOCALIZER
// ============================================================================

router.post('/localize', async (req, res) => {
  try {
    const {
      text,
      source_lang = 'en',
      target_lang = 'ar',
      context = 'ecommerce',
      target_region = 'GCC'
    } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: 'Text required' });
    }

    const localized = await geminiVision.localizeAdCopy({
      text,
      source_lang,
      target_lang,
      context,
      target_region
    });

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO generated_content (type, input, output, model_used)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      'localization',
      JSON.stringify({ text, source_lang, target_lang, context }),
      JSON.stringify(localized),
      'gemini-2.0-flash'
    );

    res.json({ success: true, localized });
  } catch (error) {
    console.error('Localization error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CREATIVE BRIEF GENERATOR
// ============================================================================

router.post('/generate/brief', async (req, res) => {
  try {
    const {
      product_name,
      product_description,
      target_audience,
      objective,
      budget_level = 'medium'
    } = req.body;

    if (!product_name || !objective) {
      return res.status(400).json({ success: false, error: 'Product name and objective required' });
    }

    const brief = await geminiVision.generateCreativeBrief({
      product_name,
      product_description: product_description || '',
      target_audience: target_audience || 'general audience',
      objective,
      budget_level
    });

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO generated_content (type, input, output, model_used)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      'brief',
      JSON.stringify({ product_name, product_description, target_audience, objective }),
      JSON.stringify(brief),
      'gemini-2.0-flash'
    );

    res.json({ success: true, brief });
  } catch (error) {
    console.error('Brief generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// THUMBNAIL A/B PREDICTOR
// ============================================================================

router.post('/predict/thumbnails', upload.array('images', 4), async (req, res) => {
  try {
    const images = [];

    // Handle uploaded files
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        images.push(file.buffer.toString('base64'));
      }
    }

    // Handle URLs
    if (req.body.image_urls) {
      const urls = Array.isArray(req.body.image_urls) ? req.body.image_urls : [req.body.image_urls];
      for (const url of urls) {
        const base64 = await cloudinary.fetchAsBase64(url);
        images.push(base64);
      }
    }

    if (images.length < 2) {
      return res.status(400).json({ success: false, error: 'At least 2 images required for comparison' });
    }

    const predictions = await geminiVision.predictThumbnails(images);

    res.json({ success: true, predictions });
  } catch (error) {
    console.error('Thumbnail prediction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// AD IMPROVER
// ============================================================================

router.post('/improve', upload.single('image'), async (req, res) => {
  try {
    let imageBase64;

    if (req.file) {
      imageBase64 = req.file.buffer.toString('base64');
    } else if (req.body.image_url) {
      imageBase64 = await cloudinary.fetchAsBase64(req.body.image_url);
    } else {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    const improvements = await geminiVision.analyzeAndImprove(imageBase64);

    res.json({ success: true, improvements });
  } catch (error) {
    console.error('Ad improvement error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// VIDEO RESIZER
// ============================================================================

// Upload video
router.post('/video/upload', upload.single('video'), async (req, res) => {
  try {
    if (!cloudinary.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME with either CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET or CLOUDINARY_UNSIGNED_UPLOAD_PRESET.'
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No video provided' });
    }

    const result = await cloudinary.uploadVideo(req.file.buffer);

    res.json({
      success: true,
      video_id: result.public_id,
      url: result.secure_url,
      duration: result.duration,
      width: result.width,
      height: result.height,
      format: result.format,
      size: result.bytes
    });
  } catch (error) {
    console.error('Video upload error:', error);
    const message = error?.message || 'Video upload failed';
    if (message.includes('Invalid Signature')) {
      return res.status(401).json({
        success: false,
        error: 'Cloudinary signature rejected. Verify CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, or use CLOUDINARY_UNSIGNED_UPLOAD_PRESET.'
      });
    }
    res.status(error?.http_code || 500).json({ success: false, error: message });
  }
});

// Resize video to multiple dimensions
router.post('/video/resize', async (req, res) => {
  try {
    if (!cloudinary.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME with either CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET or CLOUDINARY_UNSIGNED_UPLOAD_PRESET.'
      });
    }

    const { video_id, smart_crop = true } = req.body;

    if (!video_id) {
      return res.status(400).json({ success: false, error: 'Video ID required' });
    }

    const versions = await cloudinary.resizeVideo(video_id, { smart_crop });

    res.json({ success: true, versions });
  } catch (error) {
    console.error('Video resize error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy download for Safari compatibility
router.get('/video/download', async (req, res) => {
  try {
    const { url, filename } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'video.mp4'}"`);

    response.data.pipe(res);
  } catch (error) {
    console.error('Download proxy error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// ============================================================================
// IMAGE RESIZER
// ============================================================================

router.post('/image/resize', upload.single('image'), async (req, res) => {
  try {
    let result;

    if (req.file) {
      result = await cloudinary.uploadImage(req.file.buffer);
    } else if (req.body.image_url) {
      // Upload from URL
      const base64 = await cloudinary.fetchAsBase64(req.body.image_url);
      result = await cloudinary.uploadImage(Buffer.from(base64, 'base64'));
    } else {
      return res.status(400).json({ success: false, error: 'No image provided' });
    }

    const versions = await cloudinary.resizeImage(result.public_id);

    res.json({
      success: true,
      original: {
        url: result.secure_url,
        width: result.width,
        height: result.height
      },
      versions
    });
  } catch (error) {
    console.error('Image resize error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// CREATIVE FATIGUE DETECTOR
// ============================================================================

router.post('/fatigue/analyze', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    let { ads } = req.body;

    if (!ads || !Array.isArray(ads) || ads.length === 0) {
      const rows = db.prepare(`
        SELECT campaign_id, campaign_name, date, ctr, frequency, impressions, spend
        FROM meta_daily_metrics
        WHERE store = ?
        ORDER BY date ASC
      `).all(store);

      if (rows.length === 0) {
        return res.status(400).json({ success: false, error: 'Ads data required' });
      }

      const averages = (values) => {
        if (!values || values.length === 0) return 0;
        return values.reduce((sum, value) => sum + (value || 0), 0) / values.length;
      };

      const adsByCampaign = new Map();

      rows.forEach(row => {
        if (!adsByCampaign.has(row.campaign_id)) {
          adsByCampaign.set(row.campaign_id, {
            ad_id: row.campaign_id,
            ad_name: row.campaign_name,
            creative_url: null,
            dates: [],
            ctrs: [],
            frequencies: [],
            impressions: 0,
            spend: 0
          });
        }

        const entry = adsByCampaign.get(row.campaign_id);
        entry.dates.push(row.date);
        entry.ctrs.push(row.ctr || 0);
        entry.frequencies.push(row.frequency || 0);
        entry.impressions += row.impressions || 0;
        entry.spend += row.spend || 0;
      });

      ads = Array.from(adsByCampaign.values()).map(entry => {
        const baseline_ctr = averages(entry.ctrs.slice(0, 3));
        const current_ctr = averages(entry.ctrs.slice(-3));
        const frequency = averages(entry.frequencies.slice(-3));

        return {
          ad_id: entry.ad_id,
          ad_name: entry.ad_name,
          creative_url: entry.creative_url,
          current_ctr,
          baseline_ctr,
          frequency,
          start_date: entry.dates[0],
          impressions: entry.impressions,
          spend: entry.spend
        };
      });
    }

    const results = fatigueService.calculateFatigueForAds(ads);

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO creative_fatigue (ad_id, ad_name, creative_url, fatigue_score, ctr_baseline, ctr_current, ctr_decline_pct, frequency, days_running, status, recommendation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ad of results.ads) {
      stmt.run(
        ad.ad_id,
        ad.ad_name,
        ad.creative_url,
        ad.fatigue_score,
        ad.metrics.ctr_baseline,
        ad.metrics.ctr_current,
        ad.metrics.ctr_decline_pct,
        ad.metrics.frequency,
        ad.metrics.days_running,
        ad.status,
        ad.recommendation
      );
    }

    res.json({ success: true, ...results });
  } catch (error) {
    console.error('Fatigue analysis error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get fatigue history
router.get('/fatigue/history', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const history = db.prepare(`
      SELECT * FROM creative_fatigue 
      WHERE calculated_at >= datetime('now', '-${parseInt(days)} days')
      ORDER BY calculated_at DESC
    `).all();

    res.json({ success: true, history });
  } catch (error) {
    console.error('Get fatigue history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// AD ACCOUNT AUDITOR
// ============================================================================

router.post('/audit', async (req, res) => {
  try {
    const accountData = req.body;

    const audit = await auditorService.runFullAudit(accountData);

    // Save to database
    const stmt = db.prepare(`
      INSERT INTO account_audits (audit_date, health_score, status, issues, recommendations, metrics)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      new Date().toISOString().split('T')[0],
      audit.health_score,
      audit.status,
      JSON.stringify(audit.issues),
      JSON.stringify(audit.recommendations),
      JSON.stringify(audit.summary)
    );

    res.json({ success: true, audit });
  } catch (error) {
    console.error('Account audit error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get audit history
router.get('/audit/history', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const audits = db.prepare(`
      SELECT * FROM account_audits 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(parseInt(limit));

    const parsed = audits.map(a => ({
      ...a,
      issues: JSON.parse(a.issues || '[]'),
      recommendations: JSON.parse(a.recommendations || '[]'),
      metrics: JSON.parse(a.metrics || '{}')
    }));

    res.json({ success: true, audits: parsed });
  } catch (error) {
    console.error('Get audit history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate audit report
router.get('/audit/:id/report', async (req, res) => {
  try {
    const { id } = req.params;

    const audit = db.prepare('SELECT * FROM account_audits WHERE id = ?').get(id);

    if (!audit) {
      return res.status(404).json({ success: false, error: 'Audit not found' });
    }

    const parsed = {
      ...audit,
      issues: JSON.parse(audit.issues || '[]'),
      recommendations: JSON.parse(audit.recommendations || '[]')
    };

    const report = auditorService.generateAuditReport(parsed);

    res.json({ success: true, report });
  } catch (error) {
    console.error('Generate report error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// TEMPLATES CRUD
// ============================================================================

router.get('/templates', async (req, res) => {
  try {
    const templates = db.prepare('SELECT * FROM studio_templates ORDER BY is_default DESC, created_at DESC').all();

    const parsed = templates.map(t => ({
      ...t,
      style: JSON.parse(t.style || '{}')
    }));

    res.json({ success: true, templates: parsed });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const { name, style, layout, is_default = false } = req.body;

    if (!name || !style) {
      return res.status(400).json({ success: false, error: 'Name and style required' });
    }

    const stmt = db.prepare(`
      INSERT INTO studio_templates (name, style, layout, is_default)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      JSON.stringify(style),
      layout,
      is_default ? 1 : 0
    );

    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Template saved'
    });
  } catch (error) {
    console.error('Save template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM studio_templates WHERE id = ?').run(id);
    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// GENERATED CONTENT HISTORY
// ============================================================================

router.get('/history', async (req, res) => {
  try {
    const { type, limit = 50 } = req.query;

    let query = 'SELECT * FROM generated_content';
    const params = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const content = db.prepare(query).all(...params);

    const parsed = content.map(c => ({
      ...c,
      input: JSON.parse(c.input || '{}'),
      output: JSON.parse(c.output || '{}')
    }));

    res.json({ success: true, content: parsed });
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
