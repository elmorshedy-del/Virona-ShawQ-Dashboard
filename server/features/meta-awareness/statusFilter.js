/**
 * META STATUS FILTER MODULE
 * =========================
 * Centralized logic for filtering Meta objects by status.
 * This module provides a consistent API for building status filters.
 *
 * IMPORTANT: This is a core module for the Meta awareness feature.
 * Changes here affect all status-filtered queries across the application.
 *
 * @module meta-awareness/statusFilter
 */

import {
  SQL_ACTIVE_ONLY_CLAUSE,
  DEFAULTS,
  META_STATUS,
  ACTIVE_STATUSES,
  INACTIVE_STATUSES
} from './constants.js';

// =============================================================================
// PARAM PARSING
// =============================================================================

/**
 * Safely parse includeInactive from various input formats
 * @param {Object|string|boolean} params - Request params or direct value
 * @returns {boolean} - Whether to include inactive objects
 */
export function parseIncludeInactive(params) {
  // Handle direct boolean/string value
  if (typeof params === 'boolean') return params;
  if (typeof params === 'string') return params === 'true';

  // Handle object with includeInactive property
  if (params && typeof params === 'object') {
    const val = params.includeInactive;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val === 'true';
  }

  return DEFAULTS.INCLUDE_INACTIVE;
}

/**
 * Check if we should include inactive objects based on params
 * @param {Object} params - Request parameters
 * @returns {boolean}
 */
export function shouldIncludeInactive(params) {
  return parseIncludeInactive(params);
}

// =============================================================================
// SQL FILTER BUILDERS
// =============================================================================

/**
 * Build SQL status filter clause for queries
 *
 * @param {Object} params - Request parameters (may contain includeInactive)
 * @param {string} [columnPrefix=''] - Optional table alias prefix (e.g., 'm' for 'm.effective_status')
 * @returns {string} - SQL clause starting with ' AND ...' or empty string
 *
 * @example
 * // Without prefix:
 * buildStatusFilter({}) // Returns ' AND (effective_status = 'ACTIVE' OR ...)'
 *
 * @example
 * // With prefix:
 * buildStatusFilter({}, 'm') // Returns ' AND (m.effective_status = 'ACTIVE' OR ...)'
 *
 * @example
 * // Include inactive:
 * buildStatusFilter({ includeInactive: true }) // Returns ''
 */
export function buildStatusFilter(params, columnPrefix = '') {
  if (shouldIncludeInactive(params)) {
    return ''; // No filter - include all statuses
  }

  // Build column reference
  const col = columnPrefix
    ? `${columnPrefix}.${DEFAULTS.STATUS_COLUMN}`
    : DEFAULTS.STATUS_COLUMN;

  // Default: only ACTIVE (or UNKNOWN for backwards compatibility)
  return ` AND (${col} = '${META_STATUS.ACTIVE}' OR ${col} = '${META_STATUS.UNKNOWN}' OR ${col} IS NULL)`;
}

/**
 * Build SQL clause for inactive-only (reactivation candidates)
 *
 * @param {string} [columnPrefix=''] - Optional table alias prefix
 * @returns {string} - SQL clause for inactive objects only
 */
export function buildInactiveOnlyFilter(columnPrefix = '') {
  const col = columnPrefix
    ? `${columnPrefix}.${DEFAULTS.STATUS_COLUMN}`
    : DEFAULTS.STATUS_COLUMN;

  return ` AND (${col} = '${META_STATUS.PAUSED}' OR ${col} = '${META_STATUS.ARCHIVED}')`;
}

/**
 * Build SQL clause for a specific status
 *
 * @param {string} status - The status value to filter for
 * @param {string} [columnPrefix=''] - Optional table alias prefix
 * @returns {string} - SQL clause for the specific status
 */
export function buildSpecificStatusFilter(status, columnPrefix = '') {
  const col = columnPrefix
    ? `${columnPrefix}.${DEFAULTS.STATUS_COLUMN}`
    : DEFAULTS.STATUS_COLUMN;

  return ` AND ${col} = '${status}'`;
}

// =============================================================================
// STATUS CLASSIFICATION
// =============================================================================

/**
 * Check if a status value is considered "active"
 * @param {string|null|undefined} status - Status value to check
 * @returns {boolean}
 */
export function isActiveStatus(status) {
  if (!status) return true; // Null/undefined treated as active for backwards compat
  const normalized = String(status).toUpperCase();
  return ACTIVE_STATUSES.includes(normalized) || normalized === '';
}

/**
 * Check if a status value is considered "inactive" (reactivation candidate)
 * @param {string|null|undefined} status - Status value to check
 * @returns {boolean}
 */
export function isInactiveStatus(status) {
  if (!status) return false;
  const normalized = String(status).toUpperCase();
  return INACTIVE_STATUSES.includes(normalized);
}

/**
 * Normalize a status value to a known constant
 * @param {string|null|undefined} status - Status value to normalize
 * @returns {string} - Normalized status from META_STATUS
 */
export function normalizeStatus(status) {
  if (!status) return META_STATUS.UNKNOWN;

  const normalized = String(status).toUpperCase().trim();

  // Check if it's a known status
  if (Object.values(META_STATUS).includes(normalized)) {
    return normalized;
  }

  return META_STATUS.UNKNOWN;
}

// =============================================================================
// OBJECT FILTERING
// =============================================================================

/**
 * Filter an array of objects by status
 * @param {Array} objects - Array of objects with effective_status property
 * @param {Object} params - Filter parameters
 * @param {string} [statusKey='effective_status'] - Key to use for status
 * @returns {Array} - Filtered array
 */
export function filterByStatus(objects, params, statusKey = 'effective_status') {
  if (!Array.isArray(objects)) return [];

  if (shouldIncludeInactive(params)) {
    return objects; // Return all
  }

  return objects.filter(obj => {
    const status = obj?.[statusKey];
    return isActiveStatus(status);
  });
}

/**
 * Get only inactive objects (for reactivation analysis)
 * @param {Array} objects - Array of objects with effective_status property
 * @param {string} [statusKey='effective_status'] - Key to use for status
 * @returns {Array} - Array of inactive objects only
 */
export function getInactiveOnly(objects, statusKey = 'effective_status') {
  if (!Array.isArray(objects)) return [];

  return objects.filter(obj => {
    const status = obj?.[statusKey];
    return isInactiveStatus(status);
  });
}

// =============================================================================
// STATUS SUMMARY
// =============================================================================

/**
 * Generate a status summary for an array of objects
 * @param {Array} objects - Array of objects with effective_status property
 * @param {string} [statusKey='effective_status'] - Key to use for status
 * @returns {Object} - Summary with counts per status
 */
export function getStatusSummary(objects, statusKey = 'effective_status') {
  const summary = {
    total: 0,
    active: 0,
    paused: 0,
    archived: 0,
    deleted: 0,
    unknown: 0
  };

  if (!Array.isArray(objects)) return summary;

  summary.total = objects.length;

  for (const obj of objects) {
    const status = normalizeStatus(obj?.[statusKey]);

    switch (status) {
      case META_STATUS.ACTIVE:
        summary.active++;
        break;
      case META_STATUS.PAUSED:
        summary.paused++;
        break;
      case META_STATUS.ARCHIVED:
        summary.archived++;
        break;
      case META_STATUS.DELETED:
        summary.deleted++;
        break;
      default:
        summary.unknown++;
    }
  }

  return summary;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  parseIncludeInactive,
  shouldIncludeInactive,
  buildStatusFilter,
  buildInactiveOnlyFilter,
  buildSpecificStatusFilter,
  isActiveStatus,
  isInactiveStatus,
  normalizeStatus,
  filterByStatus,
  getInactiveOnly,
  getStatusSummary
};
