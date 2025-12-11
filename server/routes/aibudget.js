import express from 'express';
import { getAiBudgetMetaDataset } from '../features/aibudget/metaDataset.js';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const { startDate, endDate } = req.query;
    const payload = getAiBudgetMetaDataset(store, { startDate, endDate });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
