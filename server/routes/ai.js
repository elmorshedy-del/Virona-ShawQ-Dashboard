import express from 'express';
import { askAnalyticsQuestion, exploreData } from '../services/openaiService.js';

const router = express.Router();

router.post('/ask', async (req, res) => {
  try {
    const { question, dashboardData, store, reasoningEffort } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question is required' });
    }

    const answer = await askAnalyticsQuestion(question, dashboardData, store, reasoningEffort);
    res.json({ success: true, answer });
  } catch (error) {
    console.error('[AI] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/explore', async (req, res) => {
  try {
    const {
      query,
      dashboardData,
      store,
      reasoningEffort,
      selectedMetrics,
      selectedDimensions,
      visualization,
      dateFilter
    } = req.body;

    const result = await exploreData(
      query,
      dashboardData,
      store,
      reasoningEffort,
      { selectedMetrics, selectedDimensions, visualization, dateFilter }
    );

    res.json({ success: true, result });
  } catch (error) {
    console.error('[AI Explore] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/status', (req, res) => {
  const configured = !!process.env.OPENAI_API_KEY;
  res.json({ success: true, configured });
});

export default router;
