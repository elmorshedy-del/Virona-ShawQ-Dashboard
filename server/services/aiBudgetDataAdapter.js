/**
 * AIBudget Data Adapter
 *
 * Primary adapter for AIBudget consumers.
 * Uses metaAIBudgetBridge for standardized Meta data.
 *
 * This adapter provides:
 * - Standard getAIBudgetData() for normalized rows
 * - Weekly aggregation
 * - Campaign time series
 * - Lookback period queries
 */

import metaAIBudgetBridge from './metaAIBudgetBridge.js';

class AIBudgetDataAdapter {

  /**
   * Get all AIBudget data - uses unified bridge for standardization
   * @param {string} store - 'vironax' or 'shawq'
   * @param {Object} options - { startDate, endDate, days }
   * @returns {Promise<Array>} Normalized data array
   */
  async getAIBudgetData(store, options = {}) {
    try {
      console.log('[AIBudgetAdapter] Getting data for store:', store);

      // Use unified bridge for all data
      const rows = await metaAIBudgetBridge.getRows(store, options);

      console.log(`[AIBudgetAdapter] Received ${rows.length} standardized rows`);

      return rows;

    } catch (error) {
      console.error('[AIBudgetAdapter] Error:', error);
      throw error;
    }
  }

  /**
   * Get full data with hierarchy tree
   * @param {string} store
   * @param {Object} options
   * @returns {Promise<{rows: Array, hierarchy: Object, dateRange: Object}>}
   */
  async getAIBudgetDataWithHierarchy(store, options = {}) {
    return metaAIBudgetBridge.getStandardizedData(store, options);
  }

  /**
   * Get weekly aggregated data
   * @param {string} store
   * @param {Object} options - { startDate, endDate }
   * @returns {Promise<Array>}
   */
  async getWeeklyAggregatedData(store, options = {}) {
    const rawData = await this.getAIBudgetData(store, options);

    // Group by week
    const weeklyMap = new Map();

    rawData.forEach(row => {
      const weekStart = this.getWeekStart(row.date);
      const key = `${weekStart}_${row.campaign_id}_${row.geo}_${row.adset_id || 'null'}_${row.level}`;

      if (!weeklyMap.has(key)) {
        weeklyMap.set(key, {
          week_start: weekStart,
          date: weekStart,
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name,
          adset_id: row.adset_id,
          adset_name: row.adset_name,
          ad_id: row.ad_id,
          ad_name: row.ad_name,
          geo: row.geo,
          status: row.status,
          effective_status: row.effective_status,
          brand: row.brand,
          store: row.store,
          level: row.level,
          // Aggregated metrics
          spend: 0,
          purchase_value: 0,
          purchases: 0,
          impressions: 0,
          clicks: 0,
          atc: 0,
          ic: 0,
          reach: 0,
          landing_page_views: 0,
          frequency_sum: 0,
          frequency_count: 0,
          budget: row.budget
        });
      }

      const week = weeklyMap.get(key);
      week.spend += this.toNumber(row.spend);
      week.purchase_value += this.toNumber(row.purchase_value);
      week.purchases += this.toNumber(row.purchases);
      week.impressions += this.toNumber(row.impressions);
      week.clicks += this.toNumber(row.clicks);
      week.atc += this.toNumber(row.atc);
      week.ic += this.toNumber(row.ic);
      week.reach += this.toNumber(row.reach);
      week.landing_page_views += this.toNumber(row.landing_page_views);

      if (row.frequency > 0) {
        week.frequency_sum += this.toNumber(row.frequency);
        week.frequency_count += 1;
      }
    });

    // Calculate derived metrics
    return Array.from(weeklyMap.values()).map(week => ({
      ...week,
      frequency: week.frequency_count > 0 ? week.frequency_sum / week.frequency_count : 0,
      ctr: week.impressions > 0 ? (week.clicks / week.impressions) * 100 : 0,
      cpc: week.clicks > 0 ? week.spend / week.clicks : 0,
      cpm: week.impressions > 0 ? (week.spend / week.impressions) * 1000 : 0,
      roi: week.spend > 0 ? ((week.purchase_value - week.spend) / week.spend) * 100 : 0,
      cpa: week.purchases > 0 ? week.spend / week.purchases : 0
    }));
  }

  /**
   * Get campaign time series
   * @param {string} campaignId
   * @param {number} weeksBack
   * @returns {Promise<Array>}
   */
  async getCampaignTimeSeries(campaignId, weeksBack = 4) {
    const startDate = this.getDateWeeksAgo(weeksBack);
    const endDate = this.getTodayDate();

    // Get data for both stores and filter by campaign
    const vironaxData = await this.getAIBudgetData('vironax', { startDate, endDate });
    const shawqData = await this.getAIBudgetData('shawq', { startDate, endDate });

    const allData = [...vironaxData, ...shawqData];

    // Filter for specific campaign
    return allData.filter(row => row.campaign_id === campaignId);
  }

  /**
   * Get data by lookback period
   * @param {string} lookback - '1week', '2weeks', '4weeks', 'alltime'
   * @param {string} store - Optional store filter
   * @returns {Promise<Array>}
   */
  async getDataByLookback(lookback = '4weeks', store = null) {
    let startDate;
    const endDate = this.getTodayDate();

    switch (lookback) {
      case '1week':
        startDate = this.getDateWeeksAgo(1);
        break;
      case '2weeks':
        startDate = this.getDateWeeksAgo(2);
        break;
      case '4weeks':
        startDate = this.getDateWeeksAgo(4);
        break;
      case 'alltime':
        startDate = this.getDateWeeksAgo(52);
        break;
      default:
        startDate = this.getDateWeeksAgo(4);
    }

    if (store) {
      return this.getWeeklyAggregatedData(store, { startDate, endDate });
    }

    // Get data from both stores
    const vironaxData = await this.getWeeklyAggregatedData('vironax', { startDate, endDate });
    const shawqData = await this.getWeeklyAggregatedData('shawq', { startDate, endDate });

    return [...vironaxData, ...shawqData];
  }

  /**
   * Get data filtered by level
   * @param {string} store
   * @param {string} level - 'campaign', 'adset', 'ad'
   * @param {Object} options
   * @returns {Promise<Array>}
   */
  async getDataByLevel(store, level, options = {}) {
    const data = await this.getAIBudgetData(store, options);
    return data.filter(row => row.level === level);
  }

  /**
   * Get aggregated totals
   * @param {string} store
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async getAggregatedTotals(store, options = {}) {
    const data = await this.getAIBudgetData(store, options);

    return {
      totalSpend: this.sumField(data, 'spend'),
      totalRevenue: this.sumField(data, 'purchase_value'),
      totalPurchases: this.sumField(data, 'purchases'),
      totalImpressions: this.sumField(data, 'impressions'),
      totalClicks: this.sumField(data, 'clicks'),
      totalATC: this.sumField(data, 'atc'),
      totalIC: this.sumField(data, 'ic'),
      totalReach: this.sumField(data, 'reach'),
      avgFrequency: this.avgField(data, 'frequency'),
      recordCount: data.length,
      campaignCount: new Set(data.map(r => r.campaign_id)).size,
      adsetCount: new Set(data.filter(r => r.adset_id).map(r => r.adset_id)).size,
      adCount: new Set(data.filter(r => r.ad_id).map(r => r.ad_id)).size
    };
  }

  // === Utility Methods ===

  /**
   * Get week start date (Monday)
   */
  getWeekStart(dateString) {
    const date = new Date(dateString);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    return monday.toISOString().split('T')[0];
  }

  /**
   * Sum a field across all rows
   */
  sumField(data, field) {
    return data.reduce((sum, row) => sum + this.toNumber(row[field]), 0);
  }

  /**
   * Average a field across all rows (excluding zeros)
   */
  avgField(data, field) {
    const values = data.filter(row => row[field] > 0);
    if (values.length === 0) return 0;
    return values.reduce((sum, row) => sum + row[field], 0) / values.length;
  }

  /**
   * Safely convert to number
   */
  toNumber(value) {
    if (value === null || value === undefined) return 0;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Get date N weeks ago in YYYY-MM-DD format
   */
  getDateWeeksAgo(weeks) {
    const date = new Date();
    date.setDate(date.getDate() - (weeks * 7));
    return date.toISOString().split('T')[0];
  }

  /**
   * Get today's date in YYYY-MM-DD format
   */
  getTodayDate() {
    return new Date().toISOString().split('T')[0];
  }
}

export default new AIBudgetDataAdapter();
