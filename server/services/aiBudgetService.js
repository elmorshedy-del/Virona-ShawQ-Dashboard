/**
 * AI BUDGET SERVICE - UNIFIED DATA PIPELINE
 * Single source of truth for AI Budget data flow
 * 
 * Data Flow:
 * Database → aiBudgetService → Standardized Format → API Response
 * Integrates meta-awareness for reactivation insights
 */

import { getDb } from '../db/database.js';
import { getMetaAwarenessDataForAI } from '../features/meta-awareness/aiDataProvider.js';

class AIBudgetService {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get AI Budget dataset with hierarchy and metrics
   * Now includes meta-awareness data for reactivation insights
   */
  async getData(store, options = {}) {
    const cacheKey = `${store}:${JSON.stringify(options)}`;
    
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log(`[AIBudgetService] Cache hit for ${store}`);
        return cached.data;
      }
    }

    console.log(`[AIBudgetService] Fetching data for ${store}`, options);

    const db = getDb();
    const { startDate, endDate, includeInactive = false, lookback } = options;

    const dateRange = this.calculateDateRange(startDate, endDate, lookback);
    const coverage = this.getDateCoverage(db, store);

    const effectiveStart = dateRange.start || coverage.availableStart;
    const effectiveEnd = dateRange.end || coverage.availableEnd;

    if (!effectiveStart || !effectiveEnd) {
      return this.emptyResponse(store, 'No data available');
    }

    // Fetch all data in parallel
    const [hierarchy, metrics, metaAwareness] = await Promise.all([
      this.getHierarchy(db, store, includeInactive),
      this.getMetrics(db, store, effectiveStart, effectiveEnd, includeInactive),
      this.getMetaAwarenessData(store, { includeReactivation: true })
    ]);

    const result = {
      success: true,
      store,
      includeInactive,
      dateRange: {
        requestedStart: startDate || null,
        requestedEnd: endDate || null,
        effectiveStart,
        effectiveEnd,
        availableStart: coverage.availableStart,
        availableEnd: coverage.availableEnd
      },
      hierarchy,
      metrics,
      totals: this.calculateTotals(metrics),
      metaAwareness, // NEW: Reactivation insights
      meta: {
        campaignCount: hierarchy.campaigns.length,
        adsetCount: hierarchy.adsets.length,
        adCount: hierarchy.ads.length,
        recordCount: metrics.campaignDaily.length + metrics.adsetDaily.length + metrics.adDaily.length,
        hasReactivationCandidates: metaAwareness?.reactivationCandidates?.summary?.total > 0
      }
    };

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  /**
   * Get aggregated data for AI recommendations
   */
  async getAggregatedData(store, options = {}) {
    const data = await this.getData(store, options);
    
    if (!data.success) {
      return { success: false, data: [], totals: {} };
    }

    const rows = this.flattenMetrics(data.metrics, data.hierarchy);
    
    return {
      success: true,
      data: rows,
      totals: data.totals,
      metaAwareness: data.metaAwareness,
      meta: data.meta
    };
  }

  /**
   * Get meta-awareness data safely
   */
  async getMetaAwarenessData(store, options) {
    try {
      return await getMetaAwarenessDataForAI(store, options);
    } catch (error) {
      console.error('[AIBudgetService] Meta-awareness error:', error.message);
      return null;
    }
  }

  calculateDateRange(startDate, endDate, lookback) {
    if (startDate && endDate) {
      return { start: startDate, end: endDate };
    }

    const today = new Date().toISOString().split('T')[0];
    
    if (lookback) {
      const daysMap = {
        '7d': 7, '1week': 7,
        '14d': 14, '2weeks': 14,
        '30d': 30, '4weeks': 28, '1month': 30,
        '90d': 90, '3months': 90, '12weeks': 84,
        'alltime': 365, 'full': 365
      };
      
      const days = daysMap[lookback] || 30;
      const start = new Date();
      start.setDate(start.getDate() - days);
      
      return { start: start.toISOString().split('T')[0], end: today };
    }

    const start = new Date();
    start.setDate(start.getDate() - 30);
    return { start: start.toISOString().split('T')[0], end: today };
  }

  getDateCoverage(db, store) {
    const sources = [
      db.prepare('SELECT MIN(date) as earliest, MAX(date) as latest FROM meta_daily_metrics WHERE store = ?').get(store),
      db.prepare('SELECT MIN(date) as earliest, MAX(date) as latest FROM meta_adset_metrics WHERE store = ?').get(store),
      db.prepare('SELECT MIN(date) as earliest, MAX(date) as latest FROM meta_ad_metrics WHERE store = ?').get(store)
    ];

    const allEarliest = sources.map(s => s?.earliest).filter(Boolean);
    const allLatest = sources.map(s => s?.latest).filter(Boolean);

    return {
      availableStart: allEarliest.length ? allEarliest.sort()[0] : null,
      availableEnd: allLatest.length ? allLatest.sort().slice(-1)[0] : null
    };
  }

  getHierarchy(db, store, includeInactive) {
    const statusFilter = includeInactive ? '' : 
      `AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)`;

    const objects = db.prepare(`
      SELECT object_type, object_id, object_name, parent_id, parent_name,
             grandparent_id, grandparent_name, status, effective_status,
             daily_budget, lifetime_budget, objective, optimization_goal,
             bid_strategy, created_time, start_time, stop_time
      FROM meta_objects
      WHERE store = ? ${statusFilter}
      ORDER BY object_type, object_name
    `).all(store);

    return {
      objects,
      campaigns: objects.filter(o => o.object_type === 'campaign'),
      adsets: objects.filter(o => o.object_type === 'adset'),
      ads: objects.filter(o => o.object_type === 'ad')
    };
  }

  getMetrics(db, store, startDate, endDate, includeInactive) {
    const campaignStatusFilter = includeInactive ? '' :
      `AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)`;

    const adsetStatusFilter = includeInactive ? '' :
      `AND (adset_effective_status = 'ACTIVE' OR adset_effective_status = 'UNKNOWN' OR adset_effective_status IS NULL)`;

    const adStatusFilter = includeInactive ? '' :
      `AND (ad_effective_status = 'ACTIVE' OR ad_effective_status = 'UNKNOWN' OR ad_effective_status IS NULL)`;

    const campaignDaily = db.prepare(`
      SELECT date, campaign_id, campaign_name, country, age, gender,
             publisher_platform, platform_position, spend, impressions,
             reach, clicks, landing_page_views, add_to_cart,
             checkouts_initiated, conversions, conversion_value,
             status, effective_status
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ? ${campaignStatusFilter}
      ORDER BY date DESC
    `).all(store, startDate, endDate);

    const adsetDaily = db.prepare(`
      SELECT date, campaign_id, campaign_name, adset_id, adset_name,
             country, age, gender, publisher_platform, platform_position,
             spend, impressions, reach, clicks, landing_page_views,
             add_to_cart, checkouts_initiated, conversions,
             conversion_value, status, effective_status,
             adset_status, adset_effective_status
      FROM meta_adset_metrics
      WHERE store = ? AND date BETWEEN ? AND ? ${adsetStatusFilter}
      ORDER BY date DESC
    `).all(store, startDate, endDate);

    const adDaily = db.prepare(`
      SELECT date, campaign_id, campaign_name, adset_id, adset_name,
             ad_id, ad_name, country, age, gender, publisher_platform,
             platform_position, spend, impressions, reach, clicks,
             landing_page_views, add_to_cart, checkouts_initiated,
             conversions, conversion_value, status, effective_status,
             ad_status, ad_effective_status
      FROM meta_ad_metrics
      WHERE store = ? AND date BETWEEN ? AND ? ${adStatusFilter}
      ORDER BY date DESC
    `).all(store, startDate, endDate);

    return { campaignDaily, adsetDaily, adDaily };
  }

  calculateTotals(metrics) {
    const sum = (arr, field) => arr.reduce((acc, row) => acc + (parseFloat(row[field]) || 0), 0);

    return {
      spend: sum(metrics.campaignDaily, 'spend'),
      impressions: sum(metrics.campaignDaily, 'impressions'),
      clicks: sum(metrics.campaignDaily, 'clicks'),
      conversions: sum(metrics.campaignDaily, 'conversions'),
      conversionValue: sum(metrics.campaignDaily, 'conversion_value'),
      landingPageViews: sum(metrics.campaignDaily, 'landing_page_views'),
      addToCart: sum(metrics.campaignDaily, 'add_to_cart'),
      checkoutsInitiated: sum(metrics.campaignDaily, 'checkouts_initiated')
    };
  }

  flattenMetrics(metrics, hierarchy) {
    const rows = [];

    for (const metric of metrics.campaignDaily) {
      const campaign = hierarchy.campaigns.find(c => c.object_id === metric.campaign_id);
      
      rows.push({
        date: metric.date,
        level: 'campaign',
        campaign_id: metric.campaign_id,
        campaign_name: metric.campaign_name,
        spend: parseFloat(metric.spend) || 0,
        impressions: parseInt(metric.impressions) || 0,
        clicks: parseInt(metric.clicks) || 0,
        conversions: parseInt(metric.conversions) || 0,
        conversion_value: parseFloat(metric.conversion_value) || 0,
        ctr: metric.impressions > 0 ? (metric.clicks / metric.impressions) * 100 : 0,
        cpc: metric.clicks > 0 ? metric.spend / metric.clicks : 0,
        cpa: metric.conversions > 0 ? metric.spend / metric.conversions : 0,
        roas: metric.spend > 0 ? metric.conversion_value / metric.spend : 0,
        objective: campaign?.objective || null,
        status: metric.effective_status
      });
    }

    return rows;
  }

  emptyResponse(store, error) {
    return {
      success: false,
      error,
      store,
      hierarchy: { campaigns: [], adsets: [], ads: [] },
      metrics: { campaignDaily: [], adsetDaily: [], adDaily: [] },
      totals: {},
      meta: { campaignCount: 0, adsetCount: 0, adCount: 0, recordCount: 0 }
    };
  }

  clearCache() {
    this.cache.clear();
    console.log('[AIBudgetService] Cache cleared');
  }
}

export default new AIBudgetService();
