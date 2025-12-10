/**
 * REACTIVATION PANEL COMPONENT
 * ============================
 * Displays reactivation candidates for the current store.
 * Can be embedded in AI Analytics or shown as a standalone panel.
 *
 * @module meta-awareness/components/ReactivationPanel
 */

import React, { useState, useEffect } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import {
  SCORE_DISPLAY,
  REACTIVATION_PROMPTS,
  getScoreLevel,
  META_STATUS,
  STATUS_DISPLAY
} from '../constants.js';

/**
 * ReactivationPanel - Shows reactivation candidates with scores
 *
 * @param {Object} props
 * @param {string} props.store - Store ID ('vironax' or 'shawq')
 * @param {Function} [props.onPromptClick] - Callback when a quick prompt is clicked
 * @param {boolean} [props.collapsed] - Initial collapsed state
 * @param {string} [props.className] - Additional CSS classes
 */
export default function ReactivationPanel({
  store,
  onPromptClick,
  collapsed: initialCollapsed = false,
  className = ''
}) {
  const [candidates, setCandidates] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [expandedSections, setExpandedSections] = useState({
    campaigns: true,
    adsets: false,
    ads: false
  });

  // Fetch reactivation candidates
  useEffect(() => {
    const fetchCandidates = async () => {
      if (!store) return;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/analytics/reactivation-candidates?store=${store}`);
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }
        const data = await response.json();
        setCandidates(data);
      } catch (err) {
        console.error('[ReactivationPanel] Error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchCandidates();
  }, [store]);

  // Toggle section expansion
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Handle quick prompt click
  const handlePromptClick = (prompt) => {
    if (onPromptClick) {
      onPromptClick(prompt.prompt);
    }
  };

  // Render loading state
  if (loading) {
    return (
      <div className={`p-4 bg-white rounded-lg border border-gray-200 ${className}`}>
        <div className="flex items-center gap-2 text-gray-500">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading reactivation candidates...</span>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className={`p-4 bg-red-50 rounded-lg border border-red-200 ${className}`}>
        <p className="text-sm text-red-600">Error loading candidates: {error}</p>
      </div>
    );
  }

  // Render empty state
  if (!candidates || candidates.summary?.total === 0) {
    return (
      <div className={`p-4 bg-gray-50 rounded-lg border border-gray-200 ${className}`}>
        <div className="text-center py-2">
          <p className="text-sm text-gray-500">No reactivation candidates found</p>
          <p className="text-xs text-gray-400 mt-1">
            All paused/archived objects either have low ROAS or no conversions
          </p>
        </div>
      </div>
    );
  }

  // Render candidate item
  const renderCandidate = (item, type) => {
    const score = item.reactivation_score || 0;
    const level = getScoreLevel(score);
    const display = SCORE_DISPLAY[level];

    return (
      <div
        key={item[`${type}_id`] || item.campaign_id}
        className={`p-2 rounded border ${display.borderClass} ${display.bgClass} mb-2 last:mb-0`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{display.icon}</span>
              <span className={`text-sm font-medium ${display.textClass} truncate`}>
                {item[`${type}_name`] || item.campaign_name}
              </span>
            </div>
            {type !== 'campaign' && item.campaign_name && (
              <p className="text-xs text-gray-500 truncate mt-0.5">
                in {item.campaign_name}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-2">
            <span className={`text-xs font-medium ${display.textClass}`}>
              {score.toFixed(1)}
            </span>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-1">{item.reason}</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span>{(item.avg_roas || 0).toFixed(2)}x ROAS</span>
          <span>{item.total_conversions || 0} conv</span>
          <span>{item.active_days || 0}d active</span>
        </div>
      </div>
    );
  };

  // Render section
  const renderSection = (title, items, type, count) => {
    const isExpanded = expandedSections[type];

    return (
      <div className="mb-3 last:mb-0">
        <button
          onClick={() => toggleSection(type)}
          className="flex items-center justify-between w-full text-left py-1"
        >
          <span className="text-sm font-medium text-gray-700">
            {title} ({count})
          </span>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </button>
        {isExpanded && items.length > 0 && (
          <div className="mt-2">
            {items.slice(0, 5).map(item => renderCandidate(item, type))}
            {items.length > 5 && (
              <p className="text-xs text-gray-400 text-center mt-2">
                +{items.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full p-3 border-b border-gray-100"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-semibold text-gray-800">
            Reactivation Candidates
          </span>
          <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
            {candidates.summary?.total || 0}
          </span>
        </div>
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="p-3">
          {/* Summary */}
          <div className="text-xs text-gray-500 mb-3">
            Found <span className="font-medium text-gray-700">{candidates.summary?.campaigns || 0}</span> campaigns,{' '}
            <span className="font-medium text-gray-700">{candidates.summary?.adsets || 0}</span> ad sets, and{' '}
            <span className="font-medium text-gray-700">{candidates.summary?.ads || 0}</span> ads that performed well historically.
          </div>

          {/* Sections */}
          {candidates.campaigns?.length > 0 && renderSection(
            'Campaigns',
            candidates.campaigns,
            'campaign',
            candidates.campaigns.length
          )}
          {candidates.adsets?.length > 0 && renderSection(
            'Ad Sets',
            candidates.adsets,
            'adset',
            candidates.adsets.length
          )}
          {candidates.ads?.length > 0 && renderSection(
            'Ads',
            candidates.ads,
            'ad',
            candidates.ads.length
          )}

          {/* Quick Prompts */}
          {onPromptClick && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-2">Ask AI about reactivation:</p>
              <div className="flex flex-wrap gap-1">
                {REACTIVATION_PROMPTS.slice(0, 3).map(prompt => (
                  <button
                    key={prompt.id}
                    onClick={() => handlePromptClick(prompt)}
                    className="text-xs px-2 py-1 bg-gray-100 hover:bg-orange-50 hover:text-orange-700 text-gray-600 rounded transition-colors"
                  >
                    {prompt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ReactivationBadge - Small badge showing candidate count
 */
export function ReactivationBadge({ count = 0, className = '' }) {
  if (!count) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded ${className}`}
      title={`${count} reactivation candidate${count > 1 ? 's' : ''}`}
    >
      <Sparkles className="w-3 h-3" />
      {count}
    </span>
  );
}

/**
 * ReactivationQuickPrompts - Standalone quick prompts component
 */
export function ReactivationQuickPrompts({ onPromptClick, className = '' }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {REACTIVATION_PROMPTS.map(prompt => (
        <button
          key={prompt.id}
          onClick={() => onPromptClick && onPromptClick(prompt.prompt)}
          className="text-xs px-2 py-1 bg-gray-100 hover:bg-orange-50 hover:text-orange-700 text-gray-600 rounded transition-colors"
        >
          🔄 {prompt.label}
        </button>
      ))}
    </div>
  );
}
