import express from 'express';
import {
  generateDashboardDailyBrief,
  getOrCreateDashboardDailyBrief
} from '../services/dashboardDailyBrief/service.js';

const router = express.Router();

function sendDashboardDailyBriefError(res, error, contextLabel) {
  const statusCode = Number.isInteger(error?.status) ? error.status : 500;
  if (statusCode >= 500) {
    console.error(`[Dashboard Daily Brief] ${contextLabel} error:`, error);
  }
  res.status(statusCode).json({
    success: false,
    error: error?.message || `Failed to ${contextLabel.toLowerCase()} dashboard daily brief`
  });
}

router.get('/', async (req, res) => {
  try {
    const brief = await getOrCreateDashboardDailyBrief({
      store: req.query.store,
      briefDate: req.query.briefDate
    });

    res.json({
      success: true,
      brief
    });
  } catch (error) {
    sendDashboardDailyBriefError(res, error, 'Load');
  }
});

router.post('/generate', async (req, res) => {
  try {
    const brief = await generateDashboardDailyBrief({
      store: req.body?.store,
      briefDate: req.body?.briefDate,
      force: Boolean(req.body?.force)
    });

    res.json({
      success: true,
      brief
    });
  } catch (error) {
    sendDashboardDailyBriefError(res, error, 'Generate');
  }
});

export default router;
