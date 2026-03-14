import {
  getSessionIntelligenceNormalizedFunnel,
  getSessionIntelligenceNormalizedMoneyLeaks
} from './sessionIntelligenceNormalizationService.js';
import { buildSessionIntelligenceNormalizedBrief } from './sessionIntelligenceNormalizationBriefText.js';

const NORMALIZED_BRIEF_CONFIG = Object.freeze({
  defaultTopLimit: 3
});

function safeString(value) {
  if (value == null) return '';
  return String(value);
}

export function getSessionIntelligenceNormalizedBrief(store, {
  date = null,
  startDate = null,
  endDate = null,
  baselineDays = null,
  rebuild = false,
  journeyLimit = null,
  topLimit = NORMALIZED_BRIEF_CONFIG.defaultTopLimit
} = {}) {
  const funnelReport = getSessionIntelligenceNormalizedFunnel(store, {
    date,
    startDate,
    endDate,
    baselineDays,
    rebuild,
    journeyLimit
  });
  if (!funnelReport.success) return funnelReport;

  const moneyLeakReport = getSessionIntelligenceNormalizedMoneyLeaks(store, {
    date,
    startDate,
    endDate,
    baselineDays,
    rebuild: false,
    journeyLimit,
    topLimit
  });
  if (!moneyLeakReport.success) return moneyLeakReport;

  const resolvedDate = safeString(date).trim() || safeString(funnelReport?.data?.currentPeriod?.label).trim() || null;

  return {
    success: true,
    data: {
      store: moneyLeakReport.data.store,
      date: resolvedDate,
      brief: buildSessionIntelligenceNormalizedBrief({
        store: moneyLeakReport.data.store,
        date: resolvedDate,
        funnelReport,
        moneyLeakReport
      }),
      funnel: funnelReport.data,
      moneyLeaks: moneyLeakReport.data
    }
  };
}
