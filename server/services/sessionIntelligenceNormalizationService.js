import {
  SESSION_INTELLIGENCE_FUNNEL_STAGES,
  SESSION_INTELLIGENCE_NORMALIZATION_CONFIG,
  SESSION_INTELLIGENCE_SEGMENT_DIMENSIONS,
  buildMoneyLeakEstimate,
  buildNormalizedFunnelMetrics,
  buildNormalizedProductMetrics,
  buildNormalizedSegmentMetrics,
  getDownstreamPurchaseRateFromStages,
  getFunnelStageLabel,
  rankMoneyLeakCandidates
} from './sessionIntelligenceNormalizationMath.js';
import { getSessionIntelligenceJourneyRowsForAnalysis } from './sessionIntelligenceJourneyService.js';
import { getDb } from '../db/database.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NORMALIZED_ANALYSIS_DEFAULT_LIMIT = 5000;
const NORMALIZED_ANALYSIS_MAX_LIMIT = 20000;
const NORMALIZED_MONEY_LEAK_CONFIG = Object.freeze({
  defaultTopLimit: 12,
  maxTopLimit: 40,
  defaultSegmentTopLimit: 5,
  minimumProductOrdersForDedicatedAov: 3
});
const SHOPIFY_ORDERS_TABLE = 'shopify_orders';
const SALLA_ORDERS_TABLE = 'salla_orders';
const SHOPIFY_ORDER_ITEMS_TABLE = 'shopify_order_items';

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

function getAnalysisJourneys(store, { currentRange, baselineRange, rebuild, journeyLimit }) {
  const effectiveJourneyLimit = normalizeJourneyLimit(journeyLimit);
  const currentJourneys = getSessionIntelligenceJourneyRowsForAnalysis(store, {
    startDate: currentRange.startDate,
    endDate: currentRange.endDate,
    limit: effectiveJourneyLimit,
    rebuild
  });
  const baselineJourneys = getSessionIntelligenceJourneyRowsForAnalysis(store, {
    startDate: baselineRange.startDate,
    endDate: baselineRange.endDate,
    limit: effectiveJourneyLimit,
    rebuild: false
  });

  return {
    effectiveJourneyLimit,
    currentJourneys,
    baselineJourneys
  };
}

function buildSharedReportEnvelope({ store, currentRange, baselineRange, effectiveJourneyLimit, currentJourneys, baselineJourneys }) {
  return {
    store: safeString(store).trim() || 'shawq',
    currentPeriod: {
      label: currentRange.label,
      startDate: currentRange.startDate,
      endDate: currentRange.endDate,
      totalJourneys: currentJourneys.totalSessions,
      rebuiltJourneys: currentJourneys.rebuilt
    },
    baselinePeriod: {
      label: baselineRange.label,
      startDate: baselineRange.startDate,
      endDate: baselineRange.endDate,
      baselineDays: baselineRange.baselineDays,
      totalJourneys: baselineJourneys.totalSessions,
      rebuiltJourneys: baselineJourneys.rebuilt
    },
    config: {
      baselineDays: baselineRange.baselineDays,
      minimumReachedJourneys: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.minimumReachedJourneys,
      shrinkagePriorStrengthJourneys: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.shrinkagePriorStrengthJourneys,
      steadyGapThreshold: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.steadyGapThreshold,
      journeyLimit: effectiveJourneyLimit
    }
  };
}

function normalizeTopLeakLimit(limit, fallback = NORMALIZED_MONEY_LEAK_CONFIG.defaultTopLimit) {
  const numericValue = Number.parseInt(limit, 10);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(NORMALIZED_MONEY_LEAK_CONFIG.maxTopLimit, Math.max(1, numericValue));
}

function tableExists(db, tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName)?.name
  );
}

function getOrderCountForTable(db, tableName, store, startDate, endDate) {
  if (!tableExists(db, tableName)) return 0;
  const row = db.prepare(`
    SELECT COUNT(*) AS orders
    FROM ${tableName}
    WHERE store = ?
      AND date BETWEEN ? AND ?
      AND COALESCE(is_excluded, 0) = 0
  `).get(store, startDate, endDate);
  return safeFiniteNumber(row?.orders, 0);
}

function resolveOrdersTableForStore(db, store, startDate, endDate) {
  const candidateTables = [SHOPIFY_ORDERS_TABLE, SALLA_ORDERS_TABLE]
    .filter((tableName) => tableExists(db, tableName))
    .map((tableName) => ({
      tableName,
      orders: getOrderCountForTable(db, tableName, store, startDate, endDate)
    }))
    .filter((candidate) => candidate.orders > 0)
    .sort((left, right) => right.orders - left.orders);

  return candidateTables[0]?.tableName || null;
}

function getStoreAverageOrderValue(db, ordersTable, store, startDate, endDate) {
  if (!ordersTable) {
    return {
      averageOrderValue: 0,
      orderCount: 0
    };
  }

  const row = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      AVG(order_total) AS average_order_value
    FROM ${ordersTable}
    WHERE store = ?
      AND date BETWEEN ? AND ?
      AND COALESCE(is_excluded, 0) = 0
      AND COALESCE(order_total, 0) > 0
  `).get(store, startDate, endDate);

  return {
    averageOrderValue: Math.max(0, safeFiniteNumber(row?.average_order_value, 0)),
    orderCount: safeFiniteNumber(row?.orders, 0)
  };
}

function getProductAverageOrderValues(db, store, startDate, endDate, productIds) {
  const normalizedProductIds = Array.from(new Set(
    (Array.isArray(productIds) ? productIds : [])
      .map((productId) => safeString(productId).trim())
      .filter(Boolean)
  ));

  if (
    !normalizedProductIds.length
    || !tableExists(db, SHOPIFY_ORDERS_TABLE)
    || !tableExists(db, SHOPIFY_ORDER_ITEMS_TABLE)
  ) {
    return {
      byProductId: new Map(),
      resolvedProducts: 0
    };
  }

  const placeholders = normalizedProductIds.map(() => '?').join(', ');
  const netRevenueExpression = `
    CASE
      WHEN COALESCE(oi.net_price, 0) > 0 THEN oi.net_price
      ELSE (COALESCE(oi.quantity, 1) * COALESCE(oi.price, 0) - COALESCE(oi.discount, 0))
    END
  `;
  const rows = db.prepare(`
    SELECT
      oi.product_id AS product_id,
      COUNT(DISTINCT oi.order_id) AS orders,
      AVG(${netRevenueExpression}) AS average_order_value
    FROM ${SHOPIFY_ORDER_ITEMS_TABLE} oi
    INNER JOIN ${SHOPIFY_ORDERS_TABLE} so
      ON so.store = oi.store
      AND so.order_id = oi.order_id
    WHERE oi.store = ?
      AND so.date BETWEEN ? AND ?
      AND COALESCE(so.is_excluded, 0) = 0
      AND COALESCE(oi.is_excluded, 0) = 0
      AND oi.product_id IN (${placeholders})
      AND ${netRevenueExpression} > 0
    GROUP BY oi.product_id
  `).all(store, startDate, endDate, ...normalizedProductIds);

  const byProductId = new Map();
  for (const row of rows) {
    const productId = safeString(row?.product_id).trim();
    if (!productId) continue;
    byProductId.set(productId, {
      averageOrderValue: Math.max(0, safeFiniteNumber(row?.average_order_value, 0)),
      orderCount: safeFiniteNumber(row?.orders, 0)
    });
  }

  return {
    byProductId,
    resolvedProducts: byProductId.size
  };
}

function buildRevenueReferenceContext(db, store, {
  baselineRange,
  currentRange,
  productIds
}) {
  const referenceStartDate = baselineRange.startDate;
  const referenceEndDate = currentRange.endDate;
  const ordersTable = resolveOrdersTableForStore(db, store, referenceStartDate, referenceEndDate);
  const storeAov = getStoreAverageOrderValue(db, ordersTable, store, referenceStartDate, referenceEndDate);
  const productAovs = getProductAverageOrderValues(db, store, referenceStartDate, referenceEndDate, productIds);

  return {
    ordersTable,
    referenceStartDate,
    referenceEndDate,
    storeAverageOrderValue: storeAov.averageOrderValue,
    storeOrderCount: storeAov.orderCount,
    productAverageOrderValues: productAovs.byProductId,
    productAverageOrderCoverage: {
      requestedProducts: Array.isArray(productIds) ? productIds.filter(Boolean).length : 0,
      resolvedProducts: productAovs.resolvedProducts,
      minimumProductOrdersForDedicatedAov: NORMALIZED_MONEY_LEAK_CONFIG.minimumProductOrdersForDedicatedAov
    }
  };
}

function buildNormalizedTransitionSummary(transition) {
  return {
    fromStage: transition.fromStage,
    toStage: transition.toStage,
    label: transition.label,
    current: transition.current,
    baseline: transition.baseline,
    comparison: {
      ...transition.comparison,
      summary: formatComparisonSummary(transition.comparison.status)
    }
  };
}

function buildMoneyLeakCandidate({
  scope,
  label,
  transition,
  stages,
  referenceAov,
  fallbackDownstreamPurchaseRate = null,
  metadata = {}
}) {
  if (transition?.comparison?.status !== 'weaker_than_usual') return null;

  const moneyLeak = buildMoneyLeakEstimate({
    transition,
    stages,
    referenceAov,
    fallbackDownstreamPurchaseRate
  });
  if (!moneyLeak || moneyLeak.estimatedLostRevenue <= 0) return null;

  return {
    scope,
    label,
    ...metadata,
    transition: buildNormalizedTransitionSummary(transition),
    moneyLeak
  };
}

function buildSegmentMoneyLeakGroups({
  segmentMetricsByDimension,
  storeAverageOrderValue,
  funnelStages,
  segmentTopLimit
}) {
  const groups = {};
  const candidates = [];

  for (const [dimension, metrics] of Object.entries(segmentMetricsByDimension)) {
    const groupCandidates = (metrics?.segments || [])
      .map((segment) => buildMoneyLeakCandidate({
        scope: 'segment',
        label: segment.segmentLabel,
        transition: segment.comparison.primaryTransition,
        stages: segment.stages,
        referenceAov: storeAverageOrderValue,
        fallbackDownstreamPurchaseRate: getDownstreamPurchaseRateFromStages(funnelStages, segment.comparison.primaryTransition?.toStage, 'baselineReachedJourneys'),
        metadata: {
          dimension,
          segmentKey: segment.segmentKey,
          current: segment.current,
          baseline: segment.baseline,
          comparison: {
            ...segment.comparison,
            summary: formatComparisonSummary(segment.comparison.primaryTransition?.comparison?.status || 'limited_data')
          }
        }
      }))
      .filter(Boolean);

    groups[dimension] = rankMoneyLeakCandidates(groupCandidates, segmentTopLimit);
    candidates.push(...groups[dimension]);
  }

  return { groups, candidates };
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

  const baselineRange = buildBaselineRange(currentRange, baselineDays);
  const {
    effectiveJourneyLimit,
    currentJourneys,
    baselineJourneys
  } = getAnalysisJourneys(store, { currentRange, baselineRange, rebuild, journeyLimit });

  const metrics = buildNormalizedFunnelMetrics({
    currentJourneys: currentJourneys.rows,
    baselineJourneys: baselineJourneys.rows,
    config: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
  });

  return {
    success: true,
    data: {
      ...buildSharedReportEnvelope({ store, currentRange, baselineRange, effectiveJourneyLimit, currentJourneys, baselineJourneys }),
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

export function getSessionIntelligenceNormalizedProducts(store, {
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

  const baselineRange = buildBaselineRange(currentRange, baselineDays);
  const {
    effectiveJourneyLimit,
    currentJourneys,
    baselineJourneys
  } = getAnalysisJourneys(store, { currentRange, baselineRange, rebuild, journeyLimit });

  const metrics = buildNormalizedProductMetrics({
    currentJourneys: currentJourneys.rows,
    baselineJourneys: baselineJourneys.rows,
    config: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
  });

  return {
    success: true,
    data: {
      ...buildSharedReportEnvelope({ store, currentRange, baselineRange, effectiveJourneyLimit, currentJourneys, baselineJourneys }),
      attributionMode: 'anchored_journey_product',
      totals: metrics.totals,
      products: metrics.products.map((product) => ({
        ...product,
        comparison: {
          ...product.comparison,
          summary: formatComparisonSummary(product.comparison.primaryTransition?.comparison?.status || 'limited_data')
        },
        transitions: product.transitions.map((transition) => ({
          ...transition,
          comparison: {
            ...transition.comparison,
            summary: formatComparisonSummary(transition.comparison.status)
          }
        }))
      }))
    }
  };
}


export function getSessionIntelligenceNormalizedSegments(store, {
  dimension = 'device',
  date = null,
  startDate = null,
  endDate = null,
  baselineDays = SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.baselineDays,
  rebuild = false,
  journeyLimit = NORMALIZED_ANALYSIS_DEFAULT_LIMIT
} = {}) {
  const normalizedDimension = safeString(dimension).trim().toLowerCase();
  if (!SESSION_INTELLIGENCE_SEGMENT_DIMENSIONS.includes(normalizedDimension)) {
    return {
      success: false,
      error: `Unsupported dimension "${normalizedDimension || dimension}". Use one of: ${SESSION_INTELLIGENCE_SEGMENT_DIMENSIONS.join(', ')}`
    };
  }

  const currentRange = resolveCurrentRange({ date, startDate, endDate });
  if (!currentRange) {
    return { success: false, error: 'Missing valid date or startDate/endDate (YYYY-MM-DD).' };
  }

  const baselineRange = buildBaselineRange(currentRange, baselineDays);
  const {
    effectiveJourneyLimit,
    currentJourneys,
    baselineJourneys
  } = getAnalysisJourneys(store, { currentRange, baselineRange, rebuild, journeyLimit });

  const metrics = buildNormalizedSegmentMetrics({
    currentJourneys: currentJourneys.rows,
    baselineJourneys: baselineJourneys.rows,
    dimension: normalizedDimension,
    config: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
  });

  return {
    success: true,
    data: {
      ...buildSharedReportEnvelope({ store, currentRange, baselineRange, effectiveJourneyLimit, currentJourneys, baselineJourneys }),
      dimension: normalizedDimension,
      supportedDimensions: [...SESSION_INTELLIGENCE_SEGMENT_DIMENSIONS],
      totals: metrics.totals,
      segments: metrics.segments.map((segment) => ({
        ...segment,
        comparison: {
          ...segment.comparison,
          summary: formatComparisonSummary(segment.comparison.primaryTransition?.comparison?.status || 'limited_data')
        },
        transitions: segment.transitions.map((transition) => ({
          ...transition,
          comparison: {
            ...transition.comparison,
            summary: formatComparisonSummary(transition.comparison.status)
          }
        }))
      }))
    }
  };
}

export function getSessionIntelligenceNormalizedMoneyLeaks(store, {
  date = null,
  startDate = null,
  endDate = null,
  baselineDays = SESSION_INTELLIGENCE_NORMALIZATION_CONFIG.baselineDays,
  rebuild = false,
  journeyLimit = NORMALIZED_ANALYSIS_DEFAULT_LIMIT,
  topLimit = NORMALIZED_MONEY_LEAK_CONFIG.defaultTopLimit
} = {}) {
  const currentRange = resolveCurrentRange({ date, startDate, endDate });
  if (!currentRange) {
    return { success: false, error: 'Missing valid date or startDate/endDate (YYYY-MM-DD).' };
  }

  const baselineRange = buildBaselineRange(currentRange, baselineDays);
  const {
    effectiveJourneyLimit,
    currentJourneys,
    baselineJourneys
  } = getAnalysisJourneys(store, { currentRange, baselineRange, rebuild, journeyLimit });

  const funnelMetrics = buildNormalizedFunnelMetrics({
    currentJourneys: currentJourneys.rows,
    baselineJourneys: baselineJourneys.rows,
    config: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
  });
  const productMetrics = buildNormalizedProductMetrics({
    currentJourneys: currentJourneys.rows,
    baselineJourneys: baselineJourneys.rows,
    config: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
  });
  const segmentMetricsByDimension = Object.fromEntries(
    SESSION_INTELLIGENCE_SEGMENT_DIMENSIONS.map((dimension) => [
      dimension,
      buildNormalizedSegmentMetrics({
        currentJourneys: currentJourneys.rows,
        baselineJourneys: baselineJourneys.rows,
        dimension,
        config: SESSION_INTELLIGENCE_NORMALIZATION_CONFIG
      })
    ])
  );

  const db = getDb();
  const productIds = productMetrics.products
    .map((product) => safeString(product.productId).trim())
    .filter(Boolean);
  const revenueReferenceContext = buildRevenueReferenceContext(db, safeString(store).trim() || 'shawq', {
    baselineRange,
    currentRange,
    productIds
  });
  const effectiveTopLimit = normalizeTopLeakLimit(topLimit);
  const segmentTopLimit = Math.min(
    normalizeTopLeakLimit(Math.ceil(effectiveTopLimit / 2), NORMALIZED_MONEY_LEAK_CONFIG.defaultSegmentTopLimit),
    effectiveTopLimit
  );
  const fallbackDownstreamByStage = Object.fromEntries(
    SESSION_INTELLIGENCE_FUNNEL_STAGES.map((stageKey) => [
      stageKey,
      getDownstreamPurchaseRateFromStages(funnelMetrics.stages, stageKey, 'baselineReachedJourneys')
    ])
  );

  const funnelLeaks = rankMoneyLeakCandidates(
    funnelMetrics.transitions.map((transition) => buildMoneyLeakCandidate({
      scope: 'funnel',
      label: transition.label,
      transition,
      stages: funnelMetrics.stages,
      referenceAov: revenueReferenceContext.storeAverageOrderValue,
      metadata: {
        currentJourneys: funnelMetrics.totals.currentJourneys,
        baselineJourneys: funnelMetrics.totals.baselineJourneys
      }
    })).filter(Boolean),
    effectiveTopLimit
  );

  const productLeaks = rankMoneyLeakCandidates(
    productMetrics.products.map((product) => {
      const productReference = revenueReferenceContext.productAverageOrderValues.get(product.productId);
      const hasDedicatedProductAov = safeFiniteNumber(productReference?.orderCount, 0)
        >= NORMALIZED_MONEY_LEAK_CONFIG.minimumProductOrdersForDedicatedAov;

      return buildMoneyLeakCandidate({
        scope: 'product',
        label: product.productLabel,
        transition: product.comparison.primaryTransition,
        stages: product.stages,
        referenceAov: hasDedicatedProductAov
          ? productReference?.averageOrderValue
          : revenueReferenceContext.storeAverageOrderValue,
        fallbackDownstreamPurchaseRate: fallbackDownstreamByStage[product.comparison.primaryTransition?.toStage],
        metadata: {
          productKey: product.productKey,
          productId: product.productId,
          attributionSource: product.attributionSource,
          current: product.current,
          baseline: product.baseline,
          comparison: {
            ...product.comparison,
            summary: formatComparisonSummary(product.comparison.primaryTransition?.comparison?.status || 'limited_data')
          },
          revenueReference: hasDedicatedProductAov
            ? {
                scope: 'product',
                orderCount: safeFiniteNumber(productReference?.orderCount, 0)
              }
            : {
                scope: 'store',
                orderCount: revenueReferenceContext.storeOrderCount
              }
        }
      });
    }).filter(Boolean),
    effectiveTopLimit
  );

  const segmentLeaks = buildSegmentMoneyLeakGroups({
    segmentMetricsByDimension,
    storeAverageOrderValue: revenueReferenceContext.storeAverageOrderValue,
    funnelStages: funnelMetrics.stages,
    segmentTopLimit
  });

  return {
    success: true,
    data: {
      ...buildSharedReportEnvelope({ store, currentRange, baselineRange, effectiveJourneyLimit, currentJourneys, baselineJourneys }),
      rankingMode: 'overlapping_views_do_not_sum',
      referenceRevenue: {
        ordersTable: revenueReferenceContext.ordersTable,
        referenceStartDate: revenueReferenceContext.referenceStartDate,
        referenceEndDate: revenueReferenceContext.referenceEndDate,
        storeAverageOrderValue: revenueReferenceContext.storeAverageOrderValue,
        storeOrderCount: revenueReferenceContext.storeOrderCount,
        productAverageOrderCoverage: revenueReferenceContext.productAverageOrderCoverage
      },
      funnelLeaks,
      productLeaks,
      segmentLeaks: segmentLeaks.groups,
      topLeaks: rankMoneyLeakCandidates(
        [...funnelLeaks, ...productLeaks, ...segmentLeaks.candidates],
        effectiveTopLimit
      )
    }
  };
}
