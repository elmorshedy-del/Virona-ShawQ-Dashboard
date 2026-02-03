import express from 'express';
import { getMetaDemographics } from '../services/metaDemographicsService.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const days = req.query.days ? Number(req.query.days) : 30;

    const result = await getMetaDemographics({ store, days });
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
