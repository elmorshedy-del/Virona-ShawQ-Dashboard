import express from 'express';
import {
  generateDashboardDailyBrief,
  getOrCreateDashboardDailyBrief
} from '../services/dashboardDailyBrief/service.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const brief = await getOrCreateDashboardDailyBrief({
      store: req.query.store
    });

    res.json({
      success: true,
      brief
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : 500;
    if (statusCode >= 500) {
      console.error('[Dashboard Daily Brief] Load error:', error);
    }
    res.status(statusCode).json({
      success: false,
      error: error?.message || 'Failed to load dashboard daily brief'
    });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const brief = await generateDashboardDailyBrief({
      store: req.body?.store,
      force: Boolean(req.body?.force)
    });

    res.json({
      success: true,
      brief
    });
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) ? error.status : 500;
    if (statusCode >= 500) {
      console.error('[Dashboard Daily Brief] Generate error:', error);
    }
    res.status(statusCode).json({
      success: false,
      error: error?.message || 'Failed to generate dashboard daily brief'
    });
  }
});

export default router;
