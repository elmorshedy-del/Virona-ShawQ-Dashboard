import express from 'express';
import { getMetaDemographics } from '../services/metaDemographicsService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const days = req.query.days ? Number(req.query.days) : undefined;
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const yesterday = req.query.yesterday === '1' || req.query.yesterday === 'true';

    const result = await getMetaDemographics({
      store,
      days,
      startDate,
      endDate,
      yesterday
    });
    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error('[MetaDemographics] Error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load meta demographics.' });
  }
});

export default router;
