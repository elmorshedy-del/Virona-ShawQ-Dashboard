/**
 * META AWARENESS FRONTEND CONSTANTS
 * ==================================
 * Frontend-specific constants for the Meta Awareness feature.
 * Mirrors backend constants where applicable.
 *
 * @module meta-awareness/constants (frontend)
 */

// =============================================================================
// STATUS VALUES
// =============================================================================

/**
 * Valid status values from Meta API
 * @readonly
 */
export const META_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
  DELETED: 'DELETED',
  UNKNOWN: 'UNKNOWN'
});

/**
 * Status display configuration
 */
export const STATUS_DISPLAY = Object.freeze({
  [META_STATUS.ACTIVE]: {
    label: 'Active',
    color: 'green',
    bgClass: 'bg-green-100',
    textClass: 'text-green-800',
    borderClass: 'border-green-300',
    dotClass: 'bg-green-500'
  },
  [META_STATUS.PAUSED]: {
    label: 'Paused',
    color: 'yellow',
    bgClass: 'bg-yellow-100',
    textClass: 'text-yellow-800',
    borderClass: 'border-yellow-300',
    dotClass: 'bg-yellow-500'
  },
  [META_STATUS.ARCHIVED]: {
    label: 'Archived',
    color: 'gray',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-600',
    borderClass: 'border-gray-300',
    dotClass: 'bg-gray-400'
  },
  [META_STATUS.DELETED]: {
    label: 'Deleted',
    color: 'red',
    bgClass: 'bg-red-100',
    textClass: 'text-red-800',
    borderClass: 'border-red-300',
    dotClass: 'bg-red-500'
  },
  [META_STATUS.UNKNOWN]: {
    label: 'Unknown',
    color: 'slate',
    bgClass: 'bg-slate-100',
    textClass: 'text-slate-600',
    borderClass: 'border-slate-300',
    dotClass: 'bg-slate-400'
  }
});

// =============================================================================
// TOGGLE CONFIGURATION
// =============================================================================

/**
 * Configuration for the Include Inactive toggle
 */
export const TOGGLE_CONFIG = Object.freeze({
  defaultValue: false,
  storageKey: 'metaAwareness_includeInactive',
  labels: {
    on: 'Include Inactive',
    off: 'Active Only'
  },
  tooltips: {
    on: 'Showing all campaigns, ad sets, and ads including paused and archived',
    off: 'Showing only active campaigns, ad sets, and ads'
  }
});

// =============================================================================
// REACTIVATION UI
// =============================================================================

/**
 * Score thresholds for visual indicators
 */
export const SCORE_THRESHOLDS = Object.freeze({
  HIGH: 7,      // Green - strong candidate
  MEDIUM: 4,    // Yellow - moderate candidate
  LOW: 0        // Gray - weak candidate
});

/**
 * Get score level based on value
 * @param {number} score - Reactivation score
 * @returns {string} - 'high', 'medium', or 'low'
 */
export function getScoreLevel(score) {
  if (score >= SCORE_THRESHOLDS.HIGH) return 'high';
  if (score >= SCORE_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Score level display configuration
 */
export const SCORE_DISPLAY = Object.freeze({
  high: {
    label: 'Strong Candidate',
    bgClass: 'bg-green-100',
    textClass: 'text-green-700',
    borderClass: 'border-green-300',
    icon: '🚀'
  },
  medium: {
    label: 'Moderate Candidate',
    bgClass: 'bg-yellow-100',
    textClass: 'text-yellow-700',
    borderClass: 'border-yellow-300',
    icon: '⚡'
  },
  low: {
    label: 'Potential Candidate',
    bgClass: 'bg-gray-100',
    textClass: 'text-gray-600',
    borderClass: 'border-gray-300',
    icon: '💡'
  }
});

// =============================================================================
// QUICK PROMPTS
// =============================================================================

/**
 * Quick prompts for reactivation queries in AI chat
 */
export const REACTIVATION_PROMPTS = Object.freeze([
  {
    id: 'overview',
    label: 'Reactivation Overview',
    prompt: 'What are the best campaigns, ad sets, or ads I should consider reactivating based on historical performance?'
  },
  {
    id: 'top_campaigns',
    label: 'Top Campaigns',
    prompt: 'Show me the paused or archived campaigns with the best historical ROAS that I could turn back on.'
  },
  {
    id: 'quick_wins',
    label: 'Quick Wins',
    prompt: 'What are the quickest wins if I want to reactivate some old ads? Focus on high ROAS, recent activity.'
  },
  {
    id: 'why_paused',
    label: 'Why Were They Paused?',
    prompt: 'Based on the data, can you guess why these good-performing campaigns might have been paused?'
  },
  {
    id: 'reactivation_plan',
    label: 'Reactivation Plan',
    prompt: 'Create a reactivation plan for my best historical performers. Include budget suggestions and testing approach.'
  }
]);

// =============================================================================
// DEFAULTS
// =============================================================================

export const DEFAULTS = Object.freeze({
  INCLUDE_INACTIVE: false,
  SHOW_REACTIVATION_PANEL: true,
  MAX_VISIBLE_CANDIDATES: 5
});

export default {
  META_STATUS,
  STATUS_DISPLAY,
  TOGGLE_CONFIG,
  SCORE_THRESHOLDS,
  SCORE_DISPLAY,
  REACTIVATION_PROMPTS,
  DEFAULTS,
  getScoreLevel
};
