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
});

export default router;
