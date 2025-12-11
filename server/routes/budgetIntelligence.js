import express from 'express';
import { getBudgetIntelligence } from '../services/budgetIntelligenceService.js';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getBudgetIntelligence(store, req.query);
    res.json(data);
  } catch (error) {
    console.error('Budget intelligence error:', error);
    res.status(500).json({ error: error.message });
  }
  // Debug endpoint to check database
router.get('/debug', async (req, res) => {
  try {
    const { getDb } = await import('../db/database.js');
    const db = getDb();
    
    const summary = db.prepare(`
      SELECT MAX(date) as latest_date, MIN(date) as earliest_date, COUNT(*) as total_rows
      FROM meta_daily_metrics 
      WHERE store = 'vironax'
    `).get();
    
    const whiteFriday = db.prepare(`
      SELECT date, spend, impressions, clicks, conversions, conversion_value
      FROM meta_daily_metrics
      WHERE store = 'vironax' 
        AND campaign_name = 'Virona White Friday'
        AND date BETWEEN '2025-12-04' AND '2025-12-10'
      ORDER BY date DESC
    `).all();
    
    res.json({ summary, whiteFriday });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
});

export default router;
