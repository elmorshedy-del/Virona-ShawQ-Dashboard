import express from 'express';
import { getDashboard, getEfficiency, getEfficiencyTrends, getRecommendations, getAvailableCountries, getCampaignsByCountry } from '../services/analyticsService.js';

const router = express.Router();

// Dashboard endpoint
router.get('/dashboard', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getDashboard(store, req.query);
    res.json(data);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Campaigns by country breakdown
router.get('/campaigns/by-country', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getCampaignsByCountry(store, req.query);
    res.json(data);
  } catch (error) {
    console.error('Campaigns by country error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Efficiency endpoint
router.get('/efficiency', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getEfficiency(store, req.query);
    res.json(data);
  } catch (error) {
    console.error('Efficiency error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Efficiency trends endpoint
router.get('/efficiency/trends', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getEfficiencyTrends(store, req.query);
    res.json(data);
  } catch (error) {
    console.error('Efficiency trends error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Recommendations endpoint
router.get('/recommendations', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const data = getRecommendations(store, req.query);
    res.json(data);
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available countries for a store (dynamic from data)
router.get('/countries', (req, res) => {
  try {
    const store = req.query.store || 'vironax';
    const countries = getAvailableCountries(store);
    res.json(countries);
  } catch (error) {
    console.error('Countries error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
