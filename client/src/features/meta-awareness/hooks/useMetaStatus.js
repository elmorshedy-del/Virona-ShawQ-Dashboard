/**
 * USE META STATUS HOOK
 * ====================
 * React hook for managing Meta status filter state.
 * Provides persistence and synchronization across components.
 *
 * @module meta-awareness/hooks/useMetaStatus
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { TOGGLE_CONFIG, DEFAULTS } from '../constants.js';

/**
 * useMetaStatus - Hook for managing the includeInactive filter state
 *
 * @param {Object} [options={}] - Configuration options
 * @param {boolean} [options.persist=false] - Whether to persist state to localStorage
 * @param {boolean} [options.defaultValue] - Override default value
 * @returns {Object} - State and handlers
 *
 * @example
 * const { includeInactive, setIncludeInactive, toggle, reset } = useMetaStatus();
 *
 * @example
 * // With persistence
 * const { includeInactive, setIncludeInactive } = useMetaStatus({ persist: true });
 */
export function useMetaStatus(options = {}) {
  const {
    persist = false,
    defaultValue = DEFAULTS.INCLUDE_INACTIVE
  } = options;

  // Initialize state
  const [includeInactive, setIncludeInactiveState] = useState(() => {
    // Try to load from localStorage if persist is enabled
    if (persist && typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(TOGGLE_CONFIG.storageKey);
        if (stored !== null) {
          return stored === 'true';
        }
      } catch (e) {
        console.warn('[useMetaStatus] Failed to read from localStorage:', e);
      }
    }
    return defaultValue;
  });

  // Persist to localStorage when state changes
  useEffect(() => {
    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.setItem(TOGGLE_CONFIG.storageKey, String(includeInactive));
      } catch (e) {
        console.warn('[useMetaStatus] Failed to write to localStorage:', e);
      }
    }
  }, [includeInactive, persist]);

  // Setter with validation
  const setIncludeInactive = useCallback((value) => {
    const boolValue = typeof value === 'function'
      ? value(includeInactive)
      : Boolean(value);
    setIncludeInactiveState(boolValue);
  }, [includeInactive]);

  // Toggle helper
  const toggle = useCallback(() => {
    setIncludeInactiveState(prev => !prev);
  }, []);

  // Reset to default
  const reset = useCallback(() => {
    setIncludeInactiveState(defaultValue);
    if (persist && typeof window !== 'undefined') {
      try {
        localStorage.removeItem(TOGGLE_CONFIG.storageKey);
      } catch (e) {
        console.warn('[useMetaStatus] Failed to clear localStorage:', e);
      }
    }
  }, [defaultValue, persist]);

  // Build query params helper
  const buildQueryParams = useCallback((existingParams = {}) => {
    const params = { ...existingParams };
    if (includeInactive) {
      params.includeInactive = 'true';
    }
    return params;
  }, [includeInactive]);

  // Get URL search params string
  const getQueryString = useCallback(() => {
    if (!includeInactive) return '';
    return 'includeInactive=true';
  }, [includeInactive]);

  return {
    includeInactive,
    setIncludeInactive,
    toggle,
    reset,
    buildQueryParams,
    getQueryString,
    // Computed values
    isActive: !includeInactive,
    statusLabel: includeInactive ? TOGGLE_CONFIG.labels.on : TOGGLE_CONFIG.labels.off,
    statusTooltip: includeInactive ? TOGGLE_CONFIG.tooltips.on : TOGGLE_CONFIG.tooltips.off
  };
}

/**
 * useReactivationCandidates - Hook for fetching reactivation candidates
 *
 * @param {string} store - Store ID
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.autoFetch=true] - Whether to fetch automatically
 * @returns {Object} - Candidates data and state
 */
export function useReactivationCandidates(store, options = {}) {
  const { autoFetch = true } = options;

  const [candidates, setCandidates] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchCandidates = useCallback(async () => {
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
      return data;
    } catch (err) {
      console.error('[useReactivationCandidates] Error:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [store]);

  // Auto-fetch on mount or when store changes
  useEffect(() => {
    if (autoFetch && store) {
      fetchCandidates();
    }
  }, [autoFetch, store, fetchCandidates]);

  // Computed values
  const summary = useMemo(() => {
    if (!candidates) {
      return { total: 0, campaigns: 0, adsets: 0, ads: 0, topScore: 0 };
    }
    return candidates.summary || { total: 0, campaigns: 0, adsets: 0, ads: 0, topScore: 0 };
  }, [candidates]);

  const hasCandidates = summary.total > 0;

  const topCandidate = useMemo(() => {
    if (!candidates) return null;

    const allCandidates = [
      ...(candidates.campaigns || []).map(c => ({ ...c, type: 'campaign' })),
      ...(candidates.adsets || []).map(a => ({ ...a, type: 'adset' })),
      ...(candidates.ads || []).map(ad => ({ ...ad, type: 'ad' }))
    ];

    if (allCandidates.length === 0) return null;

    return allCandidates.reduce((best, current) =>
      (current.reactivation_score || 0) > (best.reactivation_score || 0) ? current : best
    , allCandidates[0]);
  }, [candidates]);

  return {
    candidates,
    loading,
    error,
    fetchCandidates,
    refetch: fetchCandidates,
    summary,
    hasCandidates,
    topCandidate
  };
}

/**
 * useMetaObjects - Hook for fetching all Meta objects with status
 *
 * @param {string} store - Store ID
 * @param {Object} [options={}] - Options
 * @returns {Object} - Objects data and state
 */
export function useMetaObjects(store, options = {}) {
  const { autoFetch = true } = options;

  const [objects, setObjects] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchObjects = useCallback(async () => {
    if (!store) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/analytics/meta-objects?store=${store}`);

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const data = await response.json();
      setObjects(data);
      return data;
    } catch (err) {
      console.error('[useMetaObjects] Error:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    if (autoFetch && store) {
      fetchObjects();
    }
  }, [autoFetch, store, fetchObjects]);

  const summary = useMemo(() => {
    if (!objects) {
      return { total: 0, active: 0, paused: 0, archived: 0, other: 0 };
    }
    return objects.summary || { total: 0, active: 0, paused: 0, archived: 0, other: 0 };
  }, [objects]);

  return {
    objects,
    loading,
    error,
    fetchObjects,
    refetch: fetchObjects,
    summary
  };
}

export default {
  useMetaStatus,
  useReactivationCandidates,
  useMetaObjects
};
