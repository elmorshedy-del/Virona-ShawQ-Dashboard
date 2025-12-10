/**
 * META AWARENESS AI DATA PROVIDER
 * ================================
 * Provides formatted data about Meta status and reactivation candidates
 * specifically for AI consumption. This module ensures the AI always
 * receives properly structured data about active/inactive objects.
 *
 * @module meta-awareness/aiDataProvider
 */

import { getDb } from '../../db/database.js';
import { getReactivationCandidates, getReactivationSummary } from './reactivationService.js';
import { META_STATUS, OBJECT_TYPES, FEATURE_FLAGS } from './constants.js';

// =============================================================================
// ACCOUNT STRUCTURE
// =============================================================================

/**
 * Get the account structure summary for AI context
 * Shows how many objects are active, paused, archived at each level
 *
 * @param {string} store - Store name
 * @returns {Object} - Account structure summary
 */
export function getAccountStructure(store) {
  const db = getDb();

  try {
    // Get summary of meta objects by status
    const summary = db.prepare(`
      SELECT
        effective_status,
        object_type,
        COUNT(*) as count
      FROM meta_objects
      WHERE LOWER(store) = ?
      GROUP BY effective_status, object_type
    `).all(store.toLowerCase());

    // Initialize structure
    const structure = {
      campaigns: { active: 0, paused: 0, archived: 0, other: 0, total: 0 },
      adsets: { active: 0, paused: 0, archived: 0, other: 0, total: 0 },
      ads: { active: 0, paused: 0, archived: 0, other: 0, total: 0 }
    };

    // Parse results
    for (const row of summary) {
      const type = row.object_type === 'campaign' ? 'campaigns'
        : row.object_type === 'adset' ? 'adsets'
        : row.object_type === 'ad' ? 'ads' : null;

      if (!type) continue;

      const status = (row.effective_status || '').toUpperCase();
      const count = row.count || 0;

      if (status === META_STATUS.ACTIVE) {
        structure[type].active = count;
      } else if (status === META_STATUS.PAUSED) {
        structure[type].paused = count;
      } else if (status === META_STATUS.ARCHIVED) {
        structure[type].archived = count;
      } else {
        structure[type].other += count;
      }

      structure[type].total += count;
    }

    return structure;
  } catch (error) {
    console.error('[AIDataProvider] Error getting account structure:', error.message);
    return null;
  }
}

/**
 * Format account structure for AI prompt
 * @param {Object} structure - Account structure from getAccountStructure
 * @returns {string} - Formatted string for AI prompt
 */
export function formatAccountStructureForAI(structure) {
  if (!structure) return 'Account structure unavailable';

  const lines = [
    'ACCOUNT STRUCTURE:',
    `- Campaigns: ${structure.campaigns.active} active, ${structure.campaigns.paused} paused, ${structure.campaigns.archived} archived`,
    `- Ad Sets: ${structure.adsets.active} active, ${structure.adsets.paused} paused, ${structure.adsets.archived} archived`,
    `- Ads: ${structure.ads.active} active, ${structure.ads.paused} paused, ${structure.ads.archived} archived`
  ];

  const totalInactive =
    structure.campaigns.paused + structure.campaigns.archived +
    structure.adsets.paused + structure.adsets.archived +
    structure.ads.paused + structure.ads.archived;

  if (totalInactive > 0) {
    lines.push(`- Total inactive objects: ${totalInactive} (potential reactivation candidates)`);
  }

  return lines.join('\n');
}

// =============================================================================
// REACTIVATION DATA FOR AI
// =============================================================================

/**
 * Format reactivation candidates for AI prompt
 * @param {Object} candidates - Candidates from getReactivationCandidates
 * @returns {string} - Formatted string for AI prompt
 */
export function formatReactivationForAI(candidates) {
  if (!candidates || candidates.summary?.total === 0) {
    return 'No reactivation candidates identified.';
  }

  const lines = ['REACTIVATION CANDIDATES (Paused/Archived with good historical performance):'];

  // Top campaigns
  if (candidates.campaigns?.length > 0) {
    lines.push('\nTop Campaign Candidates:');
    candidates.campaigns.slice(0, 5).forEach((c, i) => {
      lines.push(`  ${i + 1}. "${c.campaign_name}" - ${c.reason} (Score: ${(c.reactivation_score || 0).toFixed(1)})`);
    });
  }

  // Top ad sets
  if (candidates.adsets?.length > 0) {
    lines.push('\nTop Ad Set Candidates:');
    candidates.adsets.slice(0, 5).forEach((a, i) => {
      lines.push(`  ${i + 1}. "${a.adset_name}" (in ${a.campaign_name}) - ${a.reason} (Score: ${(a.reactivation_score || 0).toFixed(1)})`);
    });
  }

  // Top ads
  if (candidates.ads?.length > 0) {
    lines.push('\nTop Ad Candidates:');
    candidates.ads.slice(0, 5).forEach((ad, i) => {
      lines.push(`  ${i + 1}. "${ad.ad_name}" - ${ad.reason} (Score: ${(ad.reactivation_score || 0).toFixed(1)})`);
    });
  }

  lines.push(`\nTotal candidates: ${candidates.summary.total} (${candidates.summary.campaigns} campaigns, ${candidates.summary.adsets} ad sets, ${candidates.summary.ads} ads)`);
  lines.push('Note: Higher scores indicate better candidates for reactivation.');

  return lines.join('\n');
}

// =============================================================================
// MAIN AI DATA BUNDLE
// =============================================================================

/**
 * Get complete Meta awareness data bundle for AI
 * This is the main function that should be called to get all status-related
 * data for AI prompts.
 *
 * @param {string} store - Store name
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.includeReactivation=true] - Include reactivation candidates
 * @param {boolean} [options.detailed=false] - Include detailed breakdowns
 * @returns {Object} - Complete AI data bundle
 */
export function getAIDataBundle(store, options = {}) {
  const {
    includeReactivation = FEATURE_FLAGS.ENABLE_REACTIVATION_AI,
    detailed = false
  } = options;

  const bundle = {
    accountStructure: null,
    accountStructureText: '',
    reactivationCandidates: null,
    reactivationText: '',
    hasReactivationOpportunities: false
  };

  // Get account structure
  bundle.accountStructure = getAccountStructure(store);
  bundle.accountStructureText = formatAccountStructureForAI(bundle.accountStructure);

  // Get reactivation candidates if enabled
  if (includeReactivation) {
    if (detailed) {
      bundle.reactivationCandidates = getReactivationCandidates(store);
    } else {
      bundle.reactivationCandidates = getReactivationSummary(store);
    }

    bundle.reactivationText = formatReactivationForAI(
      detailed ? bundle.reactivationCandidates : getReactivationCandidates(store)
    );

    bundle.hasReactivationOpportunities =
      bundle.reactivationCandidates?.summary?.total > 0 ||
      bundle.reactivationCandidates?.hasCandidates === true;
  }

  return bundle;
}

/**
 * Build AI system prompt section for Meta awareness
 * Returns a formatted string to include in AI system prompts
 *
 * @param {string} store - Store name
 * @param {Object} [options={}] - Options
 * @returns {string} - Formatted prompt section
 */
export function buildAIPromptSection(store, options = {}) {
  const bundle = getAIDataBundle(store, options);

  const sections = [];

  // Account structure
  if (bundle.accountStructureText) {
    sections.push(bundle.accountStructureText);
  }

  // Reactivation opportunities
  if (bundle.hasReactivationOpportunities) {
    sections.push('');
    sections.push(bundle.reactivationText);
  }

  // Instructions
  sections.push('');
  sections.push('IMPORTANT STATUS AWARENESS INSTRUCTIONS:');
  sections.push('- The performance data shown is filtered to ACTIVE campaigns by default');
  sections.push('- You have access to inactive (paused/archived) campaign data above');
  sections.push('- When users ask about "reactivation", "turning back on", "old winners", or "inactive", use the reactivation candidates data');
  sections.push('- Recommend reactivating objects with high scores (>5) and recent activity');
  sections.push('- Always mention that reactivation requires manual action in Meta Ads Manager');

  return sections.join('\n');
}

/**
 * Detect if user question is about reactivation/inactive objects
 * @param {string} question - User's question
 * @returns {boolean} - Whether the question relates to reactivation
 */
export function isReactivationQuestion(question) {
  if (!question || typeof question !== 'string') return false;

  const q = question.toLowerCase();

  const keywords = [
    'reactivat',       // reactivate, reactivation, reactivating
    'inactive',
    'paused',
    'archived',
    'turn back on',
    'turn on',
    'restart',
    'winners',
    'old campaigns',
    'old ads',
    'bring back',
    'revive',
    'dormant',
    'sleeping',
    'disabled'
  ];

  return keywords.some(keyword => q.includes(keyword));
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  getAccountStructure,
  formatAccountStructureForAI,
  formatReactivationForAI,
  getAIDataBundle,
  buildAIPromptSection,
  isReactivationQuestion
};
