/**
 * STATUS TOGGLE COMPONENT
 * =======================
 * A small, non-invasive toggle for including inactive Meta objects in views.
 *
 * This component is part of the Meta Awareness feature module.
 * It should be placed in dashboard headers or filter bars.
 *
 * @module meta-awareness/components/StatusToggle
 */

import React from 'react';
import { TOGGLE_CONFIG } from '../constants.js';

/**
 * StatusToggle - Toggle for including inactive campaigns/adsets/ads
 *
 * @param {Object} props
 * @param {boolean} props.includeInactive - Current toggle state
 * @param {Function} props.onToggle - Callback when toggle changes
 * @param {string} [props.size='sm'] - Size variant: 'sm' | 'md' | 'lg'
 * @param {boolean} [props.showLabel=true] - Whether to show text label
 * @param {string} [props.className=''] - Additional CSS classes
 */
export default function StatusToggle({
  includeInactive = false,
  onToggle,
  size = 'sm',
  showLabel = true,
  className = ''
}) {
  // Size-based styling
  const sizeClasses = {
    sm: {
      checkbox: 'w-3.5 h-3.5',
      text: 'text-xs',
      gap: 'gap-1.5'
    },
    md: {
      checkbox: 'w-4 h-4',
      text: 'text-sm',
      gap: 'gap-2'
    },
    lg: {
      checkbox: 'w-5 h-5',
      text: 'text-base',
      gap: 'gap-2.5'
    }
  };

  const sizes = sizeClasses[size] || sizeClasses.sm;

  const handleChange = (e) => {
    if (onToggle) {
      onToggle(e.target.checked);
    }
  };

  return (
    <label
      className={`flex items-center ${sizes.gap} ${sizes.text} text-gray-500 cursor-pointer select-none ${className}`}
      title={includeInactive ? TOGGLE_CONFIG.tooltips.on : TOGGLE_CONFIG.tooltips.off}
    >
      <input
        type="checkbox"
        checked={includeInactive}
        onChange={handleChange}
        className={`${sizes.checkbox} rounded border-gray-300 text-orange-500 focus:ring-orange-400 focus:ring-offset-0 transition-colors`}
      />
      {showLabel && (
        <span className={includeInactive ? 'text-orange-600 font-medium' : ''}>
          {includeInactive ? TOGGLE_CONFIG.labels.on : TOGGLE_CONFIG.labels.off}
        </span>
      )}
    </label>
  );
}

/**
 * StatusToggleCompact - A more compact toggle variant
 * Good for toolbars and tight spaces
 */
export function StatusToggleCompact({
  includeInactive = false,
  onToggle,
  className = ''
}) {
  const handleChange = (e) => {
    if (onToggle) {
      onToggle(e.target.checked);
    }
  };

  return (
    <button
      onClick={() => onToggle && onToggle(!includeInactive)}
      className={`
        inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all
        ${includeInactive
          ? 'bg-orange-100 text-orange-700 border border-orange-300'
          : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
        }
        ${className}
      `}
      title={includeInactive ? TOGGLE_CONFIG.tooltips.on : TOGGLE_CONFIG.tooltips.off}
    >
      <span className={`w-2 h-2 rounded-full ${includeInactive ? 'bg-orange-500' : 'bg-gray-400'}`} />
      {includeInactive ? 'All' : 'Active'}
    </button>
  );
}

/**
 * StatusTogglePill - Pill-style toggle for headers
 */
export function StatusTogglePill({
  includeInactive = false,
  onToggle,
  className = ''
}) {
  return (
    <div className={`inline-flex rounded-full p-0.5 bg-gray-100 ${className}`}>
      <button
        onClick={() => onToggle && onToggle(false)}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
          !includeInactive
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Active Only
      </button>
      <button
        onClick={() => onToggle && onToggle(true)}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
          includeInactive
            ? 'bg-orange-500 text-white shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Include Inactive
      </button>
    </div>
  );
}
