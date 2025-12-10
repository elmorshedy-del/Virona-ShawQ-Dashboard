/**
 * META AWARENESS FRONTEND FEATURE MODULE
 * =======================================
 *
 * BARREL EXPORT - Main entry point for the Meta Awareness frontend feature.
 * All components and hooks should be imported from this file.
 *
 * This feature provides:
 * 1. Status toggle component for filtering active/inactive objects
 * 2. Reactivation panel showing candidates for reactivation
 * 3. Hooks for managing status filter state
 * 4. Constants and utilities for status display
 *
 * USAGE:
 * ```javascript
 * import {
 *   StatusToggle,
 *   ReactivationPanel,
 *   useMetaStatus,
 *   META_STATUS
 * } from '../features/meta-awareness';
 * ```
 *
 * @module meta-awareness (frontend)
 */

// =============================================================================
// CONSTANTS
// =============================================================================

export {
  META_STATUS,
  STATUS_DISPLAY,
  TOGGLE_CONFIG,
  SCORE_THRESHOLDS,
  SCORE_DISPLAY,
  REACTIVATION_PROMPTS,
  DEFAULTS,
  getScoreLevel
} from './constants.js';

// =============================================================================
// COMPONENTS
// =============================================================================

export {
  default as StatusToggle,
  StatusToggleCompact,
  StatusTogglePill
} from './components/StatusToggle.jsx';

export {
  default as ReactivationPanel,
  ReactivationBadge,
  ReactivationQuickPrompts
} from './components/ReactivationPanel.jsx';

// =============================================================================
// HOOKS
// =============================================================================

export {
  useMetaStatus,
  useReactivationCandidates,
  useMetaObjects
} from './hooks/useMetaStatus.js';

// =============================================================================
// DEFAULT EXPORT - Convenient namespace object
// =============================================================================

import * as constants from './constants.js';
import StatusToggle, { StatusToggleCompact, StatusTogglePill } from './components/StatusToggle.jsx';
import ReactivationPanel, { ReactivationBadge, ReactivationQuickPrompts } from './components/ReactivationPanel.jsx';
import { useMetaStatus, useReactivationCandidates, useMetaObjects } from './hooks/useMetaStatus.js';

/**
 * MetaAwareness namespace object
 */
const MetaAwareness = {
  // Constants
  ...constants,

  // Components
  StatusToggle,
  StatusToggleCompact,
  StatusTogglePill,
  ReactivationPanel,
  ReactivationBadge,
  ReactivationQuickPrompts,

  // Hooks
  useMetaStatus,
  useReactivationCandidates,
  useMetaObjects
};

export default MetaAwareness;

// =============================================================================
// VERSION & INFO
// =============================================================================

/**
 * Feature version
 */
export const META_AWARENESS_VERSION = '2.0.0';

/**
 * Feature metadata
 */
export const META_AWARENESS_INFO = Object.freeze({
  name: 'Meta Awareness Frontend',
  version: META_AWARENESS_VERSION,
  description: 'UI components for Meta status filtering and reactivation recommendations',
  created: '2025-12-09',
  files: [
    'constants.js',
    'components/StatusToggle.jsx',
    'components/ReactivationPanel.jsx',
    'hooks/useMetaStatus.js',
    'index.js'
  ]
});
