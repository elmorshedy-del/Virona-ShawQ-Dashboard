/**
 * META AWARENESS CONSTANTS
 * ========================
 * Central source of truth for all Meta status-related constants.
 * This file is CRITICAL for the Meta awareness feature.
 * DO NOT MODIFY unless you understand the full impact.
 *
 * @module meta-awareness/constants
 */

// =============================================================================
// STATUS VALUES - These match Meta API values exactly
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
 * Status values considered "active" for filtering
 */
export const ACTIVE_STATUSES = Object.freeze([
  META_STATUS.ACTIVE,
  META_STATUS.UNKNOWN // For backwards compatibility with pre-status data
]);

/**
 * Status values considered "inactive" - candidates for reactivation
 */
export const INACTIVE_STATUSES = Object.freeze([
  META_STATUS.PAUSED,
  META_STATUS.ARCHIVED
]);

/**
 * All possible status values
 */
export const ALL_STATUSES = Object.freeze([
  META_STATUS.ACTIVE,
  META_STATUS.PAUSED,
  META_STATUS.ARCHIVED,
  META_STATUS.DELETED,
  META_STATUS.UNKNOWN
]);

// =============================================================================
// OBJECT TYPES
// =============================================================================

/**
 * Meta object hierarchy types
 */
export const OBJECT_TYPES = Object.freeze({
  CAMPAIGN: 'campaign',
  ADSET: 'adset',
  AD: 'ad'
});

// =============================================================================
// REACTIVATION THRESHOLDS
// =============================================================================

/**
 * Thresholds for identifying reactivation candidates
 */
export const REACTIVATION_THRESHOLDS = Object.freeze({
  MIN_ROAS: 1.0,              // Minimum ROAS to be considered a candidate
  MIN_CONVERSIONS: 1,         // Minimum conversions to be considered
  LOOKBACK_DAYS: 90,          // Days to look back for historical performance
  MAX_CANDIDATES: 20,         // Maximum candidates to return per object type

  // Scoring weights
  SCORE_ROAS_WEIGHT: 2.5,     // Max points for ROAS (capped at 5)
  SCORE_VOLUME_WEIGHT: 0.3,   // Points per conversion (capped at 3)
  SCORE_RECENCY_WEIGHT: 2,    // Max points for recency (days)
  SCORE_RECENCY_DECAY: 30     // Days after which recency score decays
});

// =============================================================================
// SQL HELPERS
// =============================================================================

/**
 * SQL clause for filtering to active-only effective_status
 * @type {string}
 */
export const SQL_ACTIVE_ONLY_CLAUSE = `(effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)`;

/**
 * SQL clause for filtering to inactive (reactivation candidates)
 * @type {string}
 */
export const SQL_INACTIVE_CLAUSE = `(effective_status = 'PAUSED' OR effective_status = 'ARCHIVED')`;

// =============================================================================
// DEFAULT VALUES
// =============================================================================

/**
 * Default filter settings
 */
export const DEFAULTS = Object.freeze({
  INCLUDE_INACTIVE: false,    // Default: show only active
  STATUS_COLUMN: 'effective_status',
  FALLBACK_STATUS: META_STATUS.UNKNOWN
});

// =============================================================================
// FEATURE FLAGS
// =============================================================================

/**
 * Feature flags for Meta awareness functionality
 * These can be toggled for gradual rollout or debugging
 */
export const FEATURE_FLAGS = Object.freeze({
  ENABLE_REACTIVATION_AI: true,       // Include reactivation data in AI prompts
  ENABLE_STATUS_TRACKING: true,        // Track status on metrics tables
  ENABLE_HISTORICAL_BACKFILL: true,    // Fetch historical data
  ENABLE_3_LEVEL_HIERARCHY: true       // Fetch campaign/adset/ad levels
});

export default {
  META_STATUS,
  ACTIVE_STATUSES,
  INACTIVE_STATUSES,
  ALL_STATUSES,
  OBJECT_TYPES,
  REACTIVATION_THRESHOLDS,
  SQL_ACTIVE_ONLY_CLAUSE,
  SQL_INACTIVE_CLAUSE,
  DEFAULTS,
  FEATURE_FLAGS
};
