/**
 * META AWARENESS FEATURE MODULE
 * =============================
 *
 * BARREL EXPORT - This is the main entry point for the Meta Awareness feature.
 * All other modules should import from this index file.
 *
 * This feature provides:
 * 1. Status tracking for Meta campaigns, ad sets, and ads
 * 2. Filtering by active/inactive status
 * 3. Reactivation candidate identification
 * 4. AI integration for reactivation recommendations
 *
 * USAGE:
 * ```javascript
 * import {
 *   buildStatusFilter,
 *   getReactivationCandidates,
 *   getAIDataBundle,
 *   META_STATUS
 * } from '../features/meta-awareness/index.js';
 * ```
 *
 * DO NOT import directly from sub-modules - always use this barrel export.
 * This ensures consistent behavior and makes the feature resilient to refactoring.
 *
 * @module meta-awareness
 */

// =============================================================================
// CONSTANTS
// =============================================================================

export {
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
} from './constants.js';

// =============================================================================
// STATUS FILTERING
// =============================================================================

export {
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
} from './statusFilter.js';

// =============================================================================
// REACTIVATION SERVICE
// =============================================================================

export {
  getReactivationCandidates,
  getReactivationSummary,
  checkReactivationCandidate
} from './reactivationService.js';

// =============================================================================
// AI DATA PROVIDER
// =============================================================================

export {
  getAccountStructure,
  formatAccountStructureForAI,
  formatReactivationForAI,
  getAIDataBundle,
  buildAIPromptSection,
  isReactivationQuestion
} from './aiDataProvider.js';

// =============================================================================
// DEFAULT EXPORT - Convenient namespace object
// =============================================================================

import * as constants from './constants.js';
import * as statusFilter from './statusFilter.js';
import * as reactivationService from './reactivationService.js';
import * as aiDataProvider from './aiDataProvider.js';

/**
 * Meta Awareness namespace object
 * Provides all functions and constants in a single object
 */
const MetaAwareness = {
  // Constants
  ...constants,

  // Status Filtering
  parseIncludeInactive: statusFilter.parseIncludeInactive,
  shouldIncludeInactive: statusFilter.shouldIncludeInactive,
  buildStatusFilter: statusFilter.buildStatusFilter,
  buildInactiveOnlyFilter: statusFilter.buildInactiveOnlyFilter,
  buildSpecificStatusFilter: statusFilter.buildSpecificStatusFilter,
  isActiveStatus: statusFilter.isActiveStatus,
  isInactiveStatus: statusFilter.isInactiveStatus,
  normalizeStatus: statusFilter.normalizeStatus,
  filterByStatus: statusFilter.filterByStatus,
  getInactiveOnly: statusFilter.getInactiveOnly,
  getStatusSummary: statusFilter.getStatusSummary,

  // Reactivation Service
  getReactivationCandidates: reactivationService.getReactivationCandidates,
  getReactivationSummary: reactivationService.getReactivationSummary,
  checkReactivationCandidate: reactivationService.checkReactivationCandidate,

  // AI Data Provider
  getAccountStructure: aiDataProvider.getAccountStructure,
  formatAccountStructureForAI: aiDataProvider.formatAccountStructureForAI,
  formatReactivationForAI: aiDataProvider.formatReactivationForAI,
  getAIDataBundle: aiDataProvider.getAIDataBundle,
  buildAIPromptSection: aiDataProvider.buildAIPromptSection,
  isReactivationQuestion: aiDataProvider.isReactivationQuestion
};

export default MetaAwareness;

// =============================================================================
// VERSION & FEATURE INFO
// =============================================================================

/**
 * Feature version - increment when making breaking changes
 */
export const META_AWARENESS_VERSION = '2.0.0';

/**
 * Feature metadata
 */
export const META_AWARENESS_INFO = Object.freeze({
  name: 'Meta Awareness',
  version: META_AWARENESS_VERSION,
  description: 'Status tracking and reactivation recommendations for Meta campaigns, ad sets, and ads',
  created: '2025-12-09',
  files: [
    'constants.js',
    'statusFilter.js',
    'reactivationService.js',
    'aiDataProvider.js',
    'index.js'
  ]
});
