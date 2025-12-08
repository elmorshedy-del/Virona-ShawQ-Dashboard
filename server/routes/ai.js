import express from 'express';
import { askAnalyticsQuestion } from '../services/openaiService.js';

const router = express.Router();

router.post('/ask', async (req, res) => {
  try {
    const { question, dashboardData, store, model } = req.body;

    if (!question) {
      return res.status(400).json({ success: false, error: 'Question is required' });
    }

    const answer = await askAnalyticsQuestion(question, dashboardData, store, model);
    res.json({ success: true, answer });
  } catch (error) {
    console.error('[AI] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/status', (req, res) => {
  const configured = !!process.env.OPENAI_API_KEY;
  res.json({ success: true, configured });
});

export default router;
