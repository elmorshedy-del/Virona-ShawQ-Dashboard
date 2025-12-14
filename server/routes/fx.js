import express from 'express';
import { getUsdTryQuote } from '../services/fxService.js';

const router = express.Router();

router.get('/usd-try', (req, res) => {
  try {
    const quote = getUsdTryQuote();
    res.json(quote);
  } catch (error) {
    console.error('[FX] Failed to serve USD_TRY quote:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
