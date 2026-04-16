import express from 'express';

import { runLandingPageAudit } from '../services/landingPageAuditService.js';
import { fetchLandingPageData } from '../services/landingPageFetcher.js';
import { getDb } from '../db/database.js';

const router = express.Router();
const VALID_BUSINESS_TYPES = new Set(['SaaS', 'E-commerce', 'Agency', 'Course/Info Product', 'Newsletter/Lead Magnet', 'Startup', 'Other']);
const VALID_CONVERSION_GOALS = new Set(['Sign Up', 'Purchase', 'Lead Form', 'Demo Call', 'Download', 'Other']);

function normalizeString(value) {
  return String(value || '').trim();
}

router.post('/run', async (req, res) => {
  try {
    const store = normalizeString(req.body?.store);
    const url = normalizeString(req.body?.url);
    const businessType = normalizeString(req.body?.businessType);
    const conversionGoal = normalizeString(req.body?.conversionGoal);
    const targetCustomer = normalizeString(req.body?.targetCustomer);

    if (!store) {
      return res.status(400).json({ success: false, error: 'store is required.' });
    }
    if (!url) {
      return res.status(400).json({ success: false, error: 'url is required.' });
    }
    if (!VALID_BUSINESS_TYPES.has(businessType)) {
      return res.status(400).json({ success: false, error: 'businessType is invalid.' });
    }
    if (!VALID_CONVERSION_GOALS.has(conversionGoal)) {
      return res.status(400).json({ success: false, error: 'conversionGoal is invalid.' });
    }
    if (!targetCustomer) {
      return res.status(400).json({ success: false, error: 'targetCustomer is required.' });
    }

    const pageData = await fetchLandingPageData(url);
    const audit = await runLandingPageAudit({
      store,
      url,
      businessType,
      conversionGoal,
      targetCustomer,
      pageData
    });

    return res.json({ success: true, audit });
  } catch (error) {
    console.error('[LandingPageAudit] run error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to run landing page audit.'
    });
  }
});

router.get('/history/:store', (req, res) => {
  try {
    const store = normalizeString(req.params?.store);
    if (!store) {
      return res.status(400).json({ success: false, error: 'store is required.' });
    }

    const db = getDb();
    const rows = db.prepare(`
      SELECT id, store, url, business_type, conversion_goal, target_customer, score, grade, created_at
      FROM landing_page_audits
      WHERE store = ?
      ORDER BY created_at DESC, id DESC
    `).all(store);

    return res.json({ success: true, history: rows });
  } catch (error) {
    console.error('[LandingPageAudit] history error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load audit history.' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid audit id.' });
    }

    const db = getDb();
    const row = db.prepare(`
      SELECT id, store, url, business_type, conversion_goal, target_customer, score, grade, result_json, created_at,
             desktop_screenshot, mobile_screenshot
      FROM landing_page_audits
      WHERE id = ?
    `).get(id);

    if (!row) {
      return res.status(404).json({ success: false, error: 'Audit not found.' });
    }

    const parsed = row.result_json ? JSON.parse(row.result_json) : null;
    return res.json({
      success: true,
      audit: {
        id: row.id,
        store: row.store,
        url: row.url,
        businessType: row.business_type,
        conversionGoal: row.conversion_goal,
        targetCustomer: row.target_customer,
        score: row.score,
        grade: row.grade,
        createdAt: row.created_at,
        desktopScreenshot: row.desktop_screenshot,
        mobileScreenshot: row.mobile_screenshot,
        result: parsed
      }
    });
  } catch (error) {
    console.error('[LandingPageAudit] get by id error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load audit.' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params?.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid audit id.' });
    }

    const db = getDb();
    const result = db.prepare('DELETE FROM landing_page_audits WHERE id = ?').run(id);
    if (!result.changes) {
      return res.status(404).json({ success: false, error: 'Audit not found.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('[LandingPageAudit] delete error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete audit.' });
  }
});

export default router;
