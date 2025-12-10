/**
 * META REACTIVATION SERVICE
 * =========================
 * Service for identifying and scoring inactive Meta objects
 * that are candidates for reactivation based on historical performance.
 *
 * This module is CRITICAL for the AI reactivation feature.
 * It provides data that allows the AI to recommend turning back on
 * paused/archived campaigns, ad sets, and ads that performed well.
 *
 * @module meta-awareness/reactivationService
 */

import { getDb } from '../../db/database.js';
import { formatDateAsGmt3 } from '../../utils/dateUtils.js';
import { REACTIVATION_THRESHOLDS, META_STATUS, OBJECT_TYPES } from './constants.js';

// =============================================================================
// SCORING FUNCTIONS
// =============================================================================

/**
 * Calculate reactivation score for a candidate
 * Higher scores = better candidates for reactivation
 *
 * @param {Object} candidate - The candidate object with performance data
 * @returns {number} - Reactivation score (0-10 scale)
 */
function calculateReactivationScore(candidate) {
  const {
    avg_roas = 0,
    total_conversions = 0,
    last_date
  } = candidate;

  // ROAS Score: 0-5 points (capped)
  // 2x ROAS = 5 points, 1x ROAS = 2.5 points
  const roasScore = Math.min(
    (avg_roas || 0) * REACTIVATION_THRESHOLDS.SCORE_ROAS_WEIGHT,
    5
  );

  // Volume Score: 0-3 points (capped)
  // Based on total conversions
  const volumeScore = Math.min(
    (total_conversions || 0) * REACTIVATION_THRESHOLDS.SCORE_VOLUME_WEIGHT,
    3
  );

  // Recency Score: 0-2 points
  // Full points if last active within SCORE_RECENCY_DECAY days
  let recencyScore = 0;
  if (last_date) {
    const daysSinceActive = Math.max(0,
      (Date.now() - new Date(last_date).getTime()) / (24 * 60 * 60 * 1000)
    );
    recencyScore = Math.max(0,
      REACTIVATION_THRESHOLDS.SCORE_RECENCY_WEIGHT -
      (daysSinceActive / REACTIVATION_THRESHOLDS.SCORE_RECENCY_DECAY) *
      REACTIVATION_THRESHOLDS.SCORE_RECENCY_WEIGHT
    );
  }

  return roasScore + volumeScore + recencyScore;
}

/**
 * Generate a human-readable reason for the reactivation recommendation
 * @param {Object} candidate - The candidate object
 * @returns {string} - Human readable reason
 */
function generateReactivationReason(candidate) {
  const parts = [];

  const roas = candidate.avg_roas || 0;
  const conversions = candidate.total_conversions || 0;
  const spend = candidate.total_spend || 0;
  const revenue = candidate.total_revenue || 0;

  if (roas >= 2) {
    parts.push(`Excellent ${roas.toFixed(2)}x ROAS`);
  } else if (roas >= 1.5) {
    parts.push(`Strong ${roas.toFixed(2)}x ROAS`);
  } else if (roas >= 1) {
    parts.push(`Profitable ${roas.toFixed(2)}x ROAS`);
  }

  if (conversions >= 10) {
    parts.push(`${conversions} conversions`);
  } else if (conversions >= 5) {
    parts.push(`${conversions} conversions`);
  } else if (conversions > 0) {
    parts.push(`${conversions} conversion${conversions > 1 ? 's' : ''}`);
  }

  if (revenue > 0 && spend > 0) {
    const profit = revenue - spend;
    if (profit > 0) {
      parts.push(`profitable`);
    }
  }

  if (parts.length === 0) {
    return 'Historical data suggests potential';
  }

  return parts.join(', ');
}

// =============================================================================
// DATA FETCHING
// =============================================================================

/**
 * Get inactive campaigns with good historical performance
 * @param {Object} db - Database instance
 * @param {string} store - Store name
 * @param {string} startDate - Start date for lookback
 * @param {string} endDate - End date
 * @returns {Array} - Array of candidate campaigns
 */
function getInactiveCampaigns(db, store, startDate, endDate) {
  try {
    const rows = db.prepare(`
      SELECT
        campaign_id,
        campaign_name,
        MAX(effective_status) as effective_status,
        ROUND(SUM(spend), 2) as total_spend,
        SUM(conversions) as total_conversions,
        ROUND(SUM(conversion_value), 2) as total_revenue,
        ROUND(AVG(CASE WHEN spend > 0 THEN conversion_value / spend ELSE 0 END), 2) as avg_roas,
        ROUND(AVG(CASE WHEN conversions > 0 THEN spend / conversions ELSE 0 END), 2) as avg_cac,
        MIN(date) as first_date,
        MAX(date) as last_date,
        COUNT(DISTINCT date) as active_days
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ?
      AND (effective_status = 'PAUSED' OR effective_status = 'ARCHIVED' OR effective_status = 'DELETED')
      GROUP BY campaign_id
      HAVING total_conversions >= ? AND avg_roas >= ?
      ORDER BY avg_roas DESC
      LIMIT ?
    `).all(
      store,
      startDate,
      endDate,
      REACTIVATION_THRESHOLDS.MIN_CONVERSIONS,
      REACTIVATION_THRESHOLDS.MIN_ROAS,
      REACTIVATION_THRESHOLDS.MAX_CANDIDATES
    );

    return rows || [];
  } catch (error) {
    console.error('[ReactivationService] Error fetching inactive campaigns:', error.message);
    return [];
  }
}

/**
 * Get inactive ad sets with good historical performance
 * @param {Object} db - Database instance
 * @param {string} store - Store name
 * @param {string} startDate - Start date for lookback
 * @param {string} endDate - End date
 * @returns {Array} - Array of candidate ad sets
 */
function getInactiveAdsets(db, store, startDate, endDate) {
  try {
    const rows = db.prepare(`
      SELECT
        campaign_id,
        campaign_name,
        adset_id,
        adset_name,
        MAX(adset_effective_status) as adset_effective_status,
        ROUND(SUM(spend), 2) as total_spend,
        SUM(conversions) as total_conversions,
        ROUND(SUM(conversion_value), 2) as total_revenue,
        ROUND(AVG(CASE WHEN spend > 0 THEN conversion_value / spend ELSE 0 END), 2) as avg_roas,
        ROUND(AVG(CASE WHEN conversions > 0 THEN spend / conversions ELSE 0 END), 2) as avg_cac,
        MIN(date) as first_date,
        MAX(date) as last_date,
        COUNT(DISTINCT date) as active_days
      FROM meta_adset_metrics
      WHERE store = ? AND date BETWEEN ? AND ?
      AND (adset_effective_status = 'PAUSED' OR adset_effective_status = 'ARCHIVED')
      GROUP BY adset_id
      HAVING total_conversions >= ? AND avg_roas >= ?
      ORDER BY avg_roas DESC
      LIMIT ?
    `).all(
      store,
      startDate,
      endDate,
      REACTIVATION_THRESHOLDS.MIN_CONVERSIONS,
      REACTIVATION_THRESHOLDS.MIN_ROAS,
      REACTIVATION_THRESHOLDS.MAX_CANDIDATES
    );

    return rows || [];
  } catch (error) {
    console.error('[ReactivationService] Error fetching inactive ad sets:', error.message);
    return [];
  }
}

/**
 * Get inactive ads with good historical performance
 * @param {Object} db - Database instance
 * @param {string} store - Store name
 * @param {string} startDate - Start date for lookback
 * @param {string} endDate - End date
 * @returns {Array} - Array of candidate ads
 */
function getInactiveAds(db, store, startDate, endDate) {
  try {
    const rows = db.prepare(`
      SELECT
        campaign_id,
        campaign_name,
        adset_id,
        adset_name,
        ad_id,
        ad_name,
        MAX(ad_effective_status) as ad_effective_status,
        ROUND(SUM(spend), 2) as total_spend,
        SUM(conversions) as total_conversions,
        ROUND(SUM(conversion_value), 2) as total_revenue,
        ROUND(AVG(CASE WHEN spend > 0 THEN conversion_value / spend ELSE 0 END), 2) as avg_roas,
        ROUND(AVG(CASE WHEN conversions > 0 THEN spend / conversions ELSE 0 END), 2) as avg_cac,
        MIN(date) as first_date,
        MAX(date) as last_date,
        COUNT(DISTINCT date) as active_days
      FROM meta_ad_metrics
      WHERE store = ? AND date BETWEEN ? AND ?
      AND (ad_effective_status = 'PAUSED' OR ad_effective_status = 'ARCHIVED')
      GROUP BY ad_id
      HAVING total_conversions >= ? AND avg_roas >= ?
      ORDER BY avg_roas DESC
      LIMIT ?
    `).all(
      store,
      startDate,
      endDate,
      REACTIVATION_THRESHOLDS.MIN_CONVERSIONS,
      REACTIVATION_THRESHOLDS.MIN_ROAS,
      REACTIVATION_THRESHOLDS.MAX_CANDIDATES
    );

    return rows || [];
  } catch (error) {
    console.error('[ReactivationService] Error fetching inactive ads:', error.message);
    return [];
  }
}

// =============================================================================
// MAIN EXPORTS
// =============================================================================

/**
 * Get all reactivation candidates for a store
 * This is the main function used by the AI and UI to get reactivation recommendations.
 *
 * @param {string} store - Store name ('vironax' or 'shawq')
 * @param {Object} [options={}] - Options
 * @param {number} [options.lookbackDays] - Days to look back for historical performance
 * @returns {Object} - Reactivation candidates organized by type
 *
 * @example
 * const candidates = getReactivationCandidates('vironax');
 * // Returns:
 * // {
 * //   campaigns: [...],
 * //   adsets: [...],
 * //   ads: [...],
 * //   summary: { total: 15, campaigns: 5, adsets: 5, ads: 5 },
 * //   dateRange: { startDate: '2024-09-01', endDate: '2024-12-01' },
 * //   note: 'These are paused/archived objects...'
 * // }
 */
export function getReactivationCandidates(store, options = {}) {
  const db = getDb();

  // Calculate date range
  const lookbackDays = options.lookbackDays || REACTIVATION_THRESHOLDS.LOOKBACK_DAYS;
  const endDate = formatDateAsGmt3(new Date());
  const startDate = formatDateAsGmt3(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000));

  try {
    // Fetch candidates at each level
    const rawCampaigns = getInactiveCampaigns(db, store, startDate, endDate);
    const rawAdsets = getInactiveAdsets(db, store, startDate, endDate);
    const rawAds = getInactiveAds(db, store, startDate, endDate);

    // Process and score campaigns
    const campaigns = rawCampaigns.map(c => ({
      ...c,
      object_type: OBJECT_TYPES.CAMPAIGN,
      // Defensive null checks
      avg_roas: c.avg_roas || 0,
      avg_cac: c.avg_cac || 0,
      total_spend: c.total_spend || 0,
      total_conversions: c.total_conversions || 0,
      total_revenue: c.total_revenue || 0,
      active_days: c.active_days || 0,
      reactivation_score: calculateReactivationScore(c),
      reason: generateReactivationReason(c)
    })).sort((a, b) => b.reactivation_score - a.reactivation_score);

    // Process and score ad sets
    const adsets = rawAdsets.map(a => ({
      ...a,
      object_type: OBJECT_TYPES.ADSET,
      avg_roas: a.avg_roas || 0,
      avg_cac: a.avg_cac || 0,
      total_spend: a.total_spend || 0,
      total_conversions: a.total_conversions || 0,
      total_revenue: a.total_revenue || 0,
      active_days: a.active_days || 0,
      reactivation_score: calculateReactivationScore(a),
      reason: generateReactivationReason(a)
    })).sort((a, b) => b.reactivation_score - a.reactivation_score);

    // Process and score ads
    const ads = rawAds.map(ad => ({
      ...ad,
      object_type: OBJECT_TYPES.AD,
      avg_roas: ad.avg_roas || 0,
      avg_cac: ad.avg_cac || 0,
      total_spend: ad.total_spend || 0,
      total_conversions: ad.total_conversions || 0,
      total_revenue: ad.total_revenue || 0,
      active_days: ad.active_days || 0,
      reactivation_score: calculateReactivationScore(ad),
      reason: generateReactivationReason(ad)
    })).sort((a, b) => b.reactivation_score - a.reactivation_score);

    return {
      campaigns,
      adsets,
      ads,
      summary: {
        total: campaigns.length + adsets.length + ads.length,
        campaigns: campaigns.length,
        adsets: adsets.length,
        ads: ads.length,
        topScore: Math.max(
          campaigns[0]?.reactivation_score || 0,
          adsets[0]?.reactivation_score || 0,
          ads[0]?.reactivation_score || 0
        )
      },
      dateRange: { startDate, endDate },
      lookbackDays,
      note: 'These are paused/archived objects that performed well historically and may be candidates for reactivation. Higher scores indicate better candidates.'
    };

  } catch (error) {
    console.error('[ReactivationService] Error getting reactivation candidates:', error.message);
    return {
      campaigns: [],
      adsets: [],
      ads: [],
      summary: { total: 0, campaigns: 0, adsets: 0, ads: 0, topScore: 0 },
      dateRange: { startDate, endDate },
      error: error.message,
      note: 'Error fetching reactivation candidates'
    };
  }
}

/**
 * Get a quick summary of reactivation candidates for the AI
 * This is a lighter-weight version for inclusion in AI prompts
 *
 * @param {string} store - Store name
 * @returns {Object} - Simplified summary
 */
export function getReactivationSummary(store) {
  const candidates = getReactivationCandidates(store);

  // Get top 3 from each category
  const topCampaigns = candidates.campaigns.slice(0, 3).map(c => ({
    name: c.campaign_name,
    roas: c.avg_roas,
    conversions: c.total_conversions,
    score: c.reactivation_score,
    reason: c.reason
  }));

  const topAdsets = candidates.adsets.slice(0, 3).map(a => ({
    name: a.adset_name,
    campaign: a.campaign_name,
    roas: a.avg_roas,
    conversions: a.total_conversions,
    score: a.reactivation_score,
    reason: a.reason
  }));

  const topAds = candidates.ads.slice(0, 3).map(ad => ({
    name: ad.ad_name,
    adset: ad.adset_name,
    roas: ad.avg_roas,
    conversions: ad.total_conversions,
    score: ad.reactivation_score,
    reason: ad.reason
  }));

  return {
    hasCandidates: candidates.summary.total > 0,
    summary: candidates.summary,
    topCampaigns,
    topAdsets,
    topAds,
    note: candidates.note
  };
}

/**
 * Check if a specific object is a reactivation candidate
 * @param {string} store - Store name
 * @param {string} objectId - The object ID to check
 * @param {string} objectType - 'campaign', 'adset', or 'ad'
 * @returns {Object|null} - The candidate info if found, null otherwise
 */
export function checkReactivationCandidate(store, objectId, objectType) {
  const candidates = getReactivationCandidates(store);

  let collection;
  let idKey;

  switch (objectType) {
    case OBJECT_TYPES.CAMPAIGN:
      collection = candidates.campaigns;
      idKey = 'campaign_id';
      break;
    case OBJECT_TYPES.ADSET:
      collection = candidates.adsets;
      idKey = 'adset_id';
      break;
    case OBJECT_TYPES.AD:
      collection = candidates.ads;
      idKey = 'ad_id';
      break;
    default:
      return null;
  }

  return collection.find(c => c[idKey] === objectId) || null;
}

export default {
  getReactivationCandidates,
  getReactivationSummary,
  checkReactivationCandidate,
  calculateReactivationScore,
  generateReactivationReason
};
