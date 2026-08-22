import express from 'express';
import {
  createWatchtowerAnnotation,
  deleteWatchtowerAnnotation,
  deleteWatchtowerRule,
  getWatchtowerDrivers,
  getWatchtowerOverview,
  getWatchtowerSeries,
  listWatchtowerAnnotations,
  listWatchtowerRules,
  upsertWatchtowerRule
} from '../services/watchtowerService.js';

const router = express.Router();

router.get('/overview', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const data = getWatchtowerOverview(store, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Watchtower overview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load watchtower', message: error.message });
  }
});

router.get('/series', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const metric = req.query.metric;
    if (!metric) return res.status(400).json({ success: false, error: 'metric is required' });
    const data = getWatchtowerSeries(store, metric, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Watchtower series error:', error);
    res.status(500).json({ success: false, error: 'Failed to load series', message: error.message });
  }
});

router.get('/drivers', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const metric = req.query.metric;
    const date = req.query.date;
    if (!metric || !date) return res.status(400).json({ success: false, error: 'metric and date are required' });
    const data = getWatchtowerDrivers(store, metric, date, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Watchtower drivers error:', error);
    res.status(500).json({ success: false, error: 'Failed to load drivers', message: error.message });
  }
});

router.get('/annotations', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const data = listWatchtowerAnnotations(store, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Watchtower annotations error:', error);
    res.status(500).json({ success: false, error: 'Failed to load annotations', message: error.message });
  }
});

router.post('/annotations', (req, res) => {
  try {
    const data = createWatchtowerAnnotation(req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('Watchtower annotation create error:', error);
    res.status(400).json({ success: false, error: 'Failed to create annotation', message: error.message });
  }
});

router.delete('/annotations/:id', (req, res) => {
  try {
    const store = req.query.store || req.body?.store || 'shawq';
    const result = deleteWatchtowerAnnotation(store, req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Watchtower annotation delete error:', error);
    res.status(400).json({ success: false, error: 'Failed to delete annotation', message: error.message });
  }
});

router.get('/rules', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const data = listWatchtowerRules(store);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Watchtower rules error:', error);
    res.status(500).json({ success: false, error: 'Failed to load rules', message: error.message });
  }
});

router.post('/rules', (req, res) => {
  try {
    const data = upsertWatchtowerRule(req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    console.error('Watchtower rule upsert error:', error);
    res.status(400).json({ success: false, error: 'Failed to save rule', message: error.message });
  }
});

router.delete('/rules/:id', (req, res) => {
  try {
    const store = req.query.store || req.body?.store || 'shawq';
    const data = deleteWatchtowerRule(store, req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Watchtower rule delete error:', error);
    res.status(400).json({ success: false, error: 'Failed to delete rule', message: error.message });
  }
});

export default router;

