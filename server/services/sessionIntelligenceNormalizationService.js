import {
  SESSION_INTELLIGENCE_FUNNEL_STAGES,
  SESSION_INTELLIGENCE_NORMALIZATION_CONFIG,
  buildNormalizedFunnelMetrics,
  getFunnelStageLabel
} from './sessionIntelligenceNormalizationMath.js';
import { getSessionIntelligenceJourneyRowsForAnalysis } from './sessionIntelligenceJourneyService.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NORMALIZED_ANALYSIS_DEFAULT_LIMIT = 5000;
const NORMALIZED_ANALYSIS_MAX_LIMIT = 20000;

function safeString(value) {
  if (value == null) return '';
  return String(value);
}

function safeFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeDateInput(value) {
  const normalized = safeString(value).trim();
  return ISO_DATE_RE.test(normalized) ? normalized : null;
}

function shiftIsoDate(dateStr, dayOffset) {
  const normalized = normalizeDateInput(dateStr);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Math.trunc(safeFiniteNumber(dayOffset, 0)));
  return date.toISOString().slice(0, 10);
}

function resolveCurrentRange({ date = null, startDate = null, endDate = null } = {}) {
  const normalizedDate = normalizeDateInput(date);
  if (normalizedDate) {
    return {
      label: normalizedDate,
      startDate: normalizedDate,
      endDate: normalizedDate
    };
  }

  const normalizedStart = normalizeDateInput(startDate);
  const normalizedEnd = normalizeDateInput(endDate);
  if (!normalizedStart || !normalizedEnd) return null;
  if (normalizedEnd < normalizedStart) return null;

  return {
    label: `${normalizedStart}:${normalizedEnd}`,
    startDate: normalizedStart,
    endDate: normalizedEnd
  };
}

function buildBaselineRange(currentRange, baselineDays) {
  const normalizedBaselineDays = Math.max(1, Math.trunc(safeFiniteNumber(baselineDays, SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.baselineDays)));
  const baselineEndDate = shiftIsoDate(currentRange.startDate, -1);
  const baselineStartDate = shiftIsoDate(currentRange.startDate, -normalizedBaselineDays);
  return {
    label: `${baselineStartDate}:${baselineEndDate}`,
    startDate: baselineStartDate,
    endDate: baselineEndDate,
    baselineDays: normalizedBaselineDays
  };
}

function normalizeJourneyLimit(limit) {
  const numericValue = Number.parseInt(limit, 10);
  if (!Number.isFinite(numericValue)) return NORMALIZED_ANALYSIS_DEFAULT_LIMIT;
  return Math.min(NORMALIZED_ANALYSIS_MAX_LIMIT, Math.max(1, numericValue));
}

function formatComparisonSummary(status) {
  if (status === 'weaker_than_usual') return 'Weaker than usual';
  if (status === 'stronger_than_usual') return 'Stronger than usual';
  if (status === 'limited_data') return 'Limited data';
  return 'Within usual range';
}

export function getSessionIntelligenceNormalizedFunnel(store, {
  date = null,
  startDate = null,
  endDate = null,
  baselineDays = SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.baselineDays,
  rebuild = false,
  journeyLimit = NORMALIZED_ANALYSIS_DEFAULT_LIMIT
} = {}) {
  const currentRange = resolveCurrentRange({ date, startDate, endDate });
  if (!currentRange) {
    return { success: false, error: 'Missing valid date or startDate/endDate (YYYY-MM-DD).' };
  }

  const effectiveBaselineRange = buildBaselineRange(currentRange, baselineDays);
  const effectiveJourneyLimit = normalizeJourneyLimit(journeyLimit);

  const currentJourneys = getSessionIntelligenceJourneyRowsForAnalysis(store, {
    startDate: currentRange.startDate,
    endDate: currentRange.endDate,
    limit: effectiveJourneyLimit,
    rebuild
  });
  const baselineJourneys = getSessionIntelligenceJourneyRowsForAnalysis(store, {
    startDate: effectiveBaselineRange.startDate,
    endDate: effectiveBaselineRange.endDate,
    limit: effectiveJourneyLimit,
    rebuild: false
  });

  const metrics = buildNormalizedFunnelMetrics({
    currentJourneys: currentJourneys.rows,
    baselineJourneys: baselineJourneys.rows,
    config: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
  });

  return {
    success: true,
    data: {
      store: safeString(store).trim() || 'shawq',
      currentPeriod: {
        label: currentRange.label,
        startDate: currentRange.startDate,
        endDate: currentRange.endDate,
        totalJourneys: currentJourneys.totalSessions,
        rebuiltJourneys: currentJourneys.rebuilt
      },
      baselinePeriod: {
        label: effectiveBaselineRange.label,
        startDate: effectiveBaselineRange.startDate,
        endDate: effectiveBaselineRange.endDate,
        baselineDays: effectiveBaselineRange.baselineDays,
        totalJourneys: baselineJourneys.totalSessions,
        rebuiltJourneys: baselineJourneys.rebuilt
      },
      config: {
        baselineDays: effectiveBaselineRange.baselineDays,
        minimumReachedJourneys: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.minimumReachedJourneys,
        shrinkagePriorStrengthJourneys: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.shrinkagePriorStrengthJourneys,
        steadyGapThreshold: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.steadyGapThreshold,
        journeyLimit: effectiveJourneyLimit
      },
      stages: metrics.stages,
      transitions: metrics.transitions.map((transition) => ({
        ...transition,
        comparison: {
          ...transition.comparison,
          summary: formatComparisonSummary(transition.comparison.status)
        }
      })),
      stageLabels: SESSION_INTELLIGENCE_FUNNEL_STAGES.map((stageKey) => ({
        stageKey,
        label: getFunnelStageLabel(stageKey)
      }))
    }
  };
}
