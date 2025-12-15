/**
 * Meta → AIBudget Unified Bridge
 *
 * SINGLE SOURCE OF TRUTH for standardizing Meta data to AIBudget schema.
 * This bridge connects metaDataset.js hierarchy and row data to AIBudget.
 *
 * Data Flow:
 *   metaDataset.js → metaAIBudgetBridge.js → AIBudget consumers
 *
 * Hierarchy Support (full):
 *   Campaign → AdSet → Ad (all levels with metrics)
 *
 * Field Mappings:
 *   Meta Field           → AIBudget Field
 *   ─────────────────────────────────────
 *   conversions          → purchases
 *   conversion_value     → purchase_value
 *   add_to_cart          → atc
 *   checkouts_initiated  → ic
 *   country              → geo
 */

import { getAiBudgetMetaDataset } from '../features/aibudget/metaDataset.js';

/**
 * Standardized AIBudget Row Schema
 * @typedef {Object} AIBudgetRow
 * @property {string} date - YYYY-MM-DD
 * @property {string} geo - Country code
 * @property {number} spend - Ad spend
 * @property {number} purchases - Conversion count
 * @property {number} purchase_value - Revenue from conversions
 * @property {number} impressions - Total impressions
 * @property {number} clicks - Total clicks
 * @property {number} atc - Add to cart count
 * @property {number} ic - Initiate checkout count
 * @property {number} reach - Unique users reached
 * @property {number} frequency - Average frequency
 * @property {string} campaign_id - Campaign identifier
 * @property {string} campaign_name - Campaign name
 * @property {string|null} adset_id - AdSet identifier (null for campaign level)
 * @property {string|null} adset_name - AdSet name
 * @property {string|null} ad_id - Ad identifier (null for campaign/adset level)
 * @property {string|null} ad_name - Ad name
 * @property {string} status - Object status
 * @property {string} effective_status - Effective status
 * @property {number} budget - Budget (daily or lifetime)
 * @property {string} objective - Campaign objective
 * @property {string} optimization_goal - AdSet optimization goal
 * @property {string} bid_strategy - Bid strategy
 * @property {string} brand - Always 'meta'
 * @property {string} store - Store identifier
 * @property {string} level - 'campaign' | 'adset' | 'ad'
 */

class MetaAIBudgetBridge {
  constructor() {
    // Hierarchy cache for lookups
    this._hierarchyCache = null;
  }

  /**
   * Get standardized AIBudget data from Meta
   * Main entry point - returns fully normalized data
   *
   * @param {string} store - 'vironax' or 'shawq'
   * @param {Object} options - { startDate, endDate }
   * @returns {Promise<{rows: AIBudgetRow[], hierarchy: Object, dateRange: Object}>}
   */
  async getStandardizedData(store, options = {}) {
    try {
      console.log(`[MetaAIBudgetBridge] Fetching data for store: ${store}`);

      // Get raw data from metaDataset
      const rawData = getAiBudgetMetaDataset(store, options);

      if (!rawData || !rawData.metrics) {
        console.warn('[MetaAIBudgetBridge] No data returned from metaDataset');
        return { rows: [], hierarchy: null, dateRange: null };
      }

      // Cache hierarchy for lookups
      this._hierarchyCache = rawData.hierarchy;

      // Standardize all metric rows
      const rows = this.standardizeAllMetrics(rawData, store);

      console.log(`[MetaAIBudgetBridge] Standardized ${rows.length} total rows`);
      console.log(`  - Campaign level: ${rows.filter(r => r.level === 'campaign').length}`);
      console.log(`  - AdSet level: ${rows.filter(r => r.level === 'adset').length}`);
      console.log(`  - Ad level: ${rows.filter(r => r.level === 'ad').length}`);

      return {
        rows,
        hierarchy: this.buildHierarchyTree(rawData.hierarchy),
        dateRange: rawData.dateRange
      };

    } catch (error) {
      console.error('[MetaAIBudgetBridge] Error:', error);
      throw error;
    }
  }

  /**
   * Get ONLY standardized rows (for backward compatibility)
   * @param {string} store
   * @param {Object} options
   * @returns {Promise<AIBudgetRow[]>}
   */
  async getRows(store, options = {}) {
    const { rows } = await this.getStandardizedData(store, options);
    return rows;
  }

  /**
   * Standardize all metrics (campaign, adset, ad levels)
   * @private
   */
  standardizeAllMetrics(rawData, store) {
    const { hierarchy = {}, metrics = {} } = rawData;
    const rows = [];

    // Process CAMPAIGN-level metrics
    if (metrics.campaignDaily?.length > 0) {
      for (const row of metrics.campaignDaily) {
        rows.push(this.standardizeRow(row, 'campaign', store, hierarchy));
      }
    }

    // Process ADSET-level metrics
    if (metrics.adsetDaily?.length > 0) {
      for (const row of metrics.adsetDaily) {
        rows.push(this.standardizeRow(row, 'adset', store, hierarchy));
      }
    }

    // Process AD-level metrics
    if (metrics.adDaily?.length > 0) {
      for (const row of metrics.adDaily) {
        rows.push(this.standardizeRow(row, 'ad', store, hierarchy));
      }
    }

    return rows;
  }

  /**
   * Standardize a single metric row to AIBudget schema
   * @private
   */
  standardizeRow(row, level, store, hierarchy) {
    // Lookup hierarchy objects for additional metadata
    const campaignObj = this.findHierarchyObject(row.campaign_id, 'campaign', hierarchy);
    const adsetObj = row.adset_id ? this.findHierarchyObject(row.adset_id, 'adset', hierarchy) : null;
    const adObj = row.ad_id ? this.findHierarchyObject(row.ad_id, 'ad', hierarchy) : null;

    return {
      // === Date & Geo ===
      date: row.date,
      geo: row.country || 'unknown',

      // === Core Metrics (STANDARDIZED NAMES) ===
      spend: this.toNumber(row.spend),
      purchases: this.toNumber(row.conversions),           // conversions → purchases
      purchase_value: this.toNumber(row.conversion_value), // conversion_value → purchase_value
      impressions: this.toNumber(row.impressions),
      clicks: this.toNumber(row.clicks),
      reach: this.toNumber(row.reach),

      // === Funnel Metrics (STANDARDIZED NAMES) ===
      atc: this.toNumber(row.add_to_cart),                 // add_to_cart → atc
      ic: this.toNumber(row.checkouts_initiated),          // checkouts_initiated → ic
      landing_page_views: this.toNumber(row.landing_page_views),

      // === Calculated Metrics ===
      frequency: this.toNumber(row.frequency) || this.calculateFrequency(row),
      ctr: this.toNumber(row.ctr) || this.calculateCTR(row),
      cpc: this.toNumber(row.cpc) || this.calculateCPC(row),
      cpm: this.toNumber(row.cpm) || this.calculateCPM(row),

      // === Campaign Hierarchy ===
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name || campaignObj?.object_name || 'Unknown Campaign',

      // === AdSet Hierarchy ===
      adset_id: row.adset_id || null,
      adset_name: row.adset_name || adsetObj?.object_name || null,

      // === Ad Hierarchy ===
      ad_id: row.ad_id || null,
      ad_name: row.ad_name || adObj?.object_name || null,

      // === Status Fields ===
      status: this.determineStatus(row, level, campaignObj, adsetObj, adObj),
      effective_status: this.determineEffectiveStatus(row, level, campaignObj, adsetObj, adObj),

      // === Budget & Strategy (from hierarchy objects) ===
      budget: this.determineBudget(campaignObj, adsetObj),
      daily_budget: this.toNumber(campaignObj?.daily_budget || adsetObj?.daily_budget),
      lifetime_budget: this.toNumber(campaignObj?.lifetime_budget || adsetObj?.lifetime_budget),
      objective: campaignObj?.objective || null,
      optimization_goal: adsetObj?.optimization_goal || null,
      bid_strategy: campaignObj?.bid_strategy || adsetObj?.bid_strategy || null,

      // === Targeting (from row) ===
      age: row.age || null,
      gender: row.gender || null,
      publisher_platform: row.publisher_platform || null,
      platform_position: row.platform_position || null,

      // === Meta Fields ===
      brand: 'meta',
      store: store,
      level: level
    };
  }

  /**
   * Find a hierarchy object by ID
   * @private
   */
  findHierarchyObject(objectId, objectType, hierarchy) {
    if (!objectId || !hierarchy) return null;

    const collection = hierarchy[objectType + 's']; // campaigns, adsets, ads
    if (!collection) return null;

    return collection.find(obj => obj.object_id === objectId);
  }

  /**
   * Build a hierarchical tree structure
   * @private
   */
  buildHierarchyTree(hierarchy) {
    if (!hierarchy) return null;

    const tree = {
      campaigns: {}
    };

    // Build campaign nodes
    for (const campaign of hierarchy.campaigns || []) {
      tree.campaigns[campaign.object_id] = {
        id: campaign.object_id,
        name: campaign.object_name,
        status: campaign.status,
        effective_status: campaign.effective_status,
        daily_budget: campaign.daily_budget,
        lifetime_budget: campaign.lifetime_budget,
        objective: campaign.objective,
        bid_strategy: campaign.bid_strategy,
        adsets: {}
      };
    }

    // Attach adsets to campaigns
    for (const adset of hierarchy.adsets || []) {
      const campaignId = adset.parent_id;
      if (tree.campaigns[campaignId]) {
        tree.campaigns[campaignId].adsets[adset.object_id] = {
          id: adset.object_id,
          name: adset.object_name,
          status: adset.status,
          effective_status: adset.effective_status,
          daily_budget: adset.daily_budget,
          lifetime_budget: adset.lifetime_budget,
          optimization_goal: adset.optimization_goal,
          bid_strategy: adset.bid_strategy,
          ads: {}
        };
      }
    }

    // Attach ads to adsets
    for (const ad of hierarchy.ads || []) {
      const adsetId = ad.parent_id;
      const campaignId = ad.grandparent_id;
      if (tree.campaigns[campaignId]?.adsets[adsetId]) {
        tree.campaigns[campaignId].adsets[adsetId].ads[ad.object_id] = {
          id: ad.object_id,
          name: ad.object_name,
          status: ad.status,
          effective_status: ad.effective_status
        };
      }
    }

    return tree;
  }

  /**
   * Determine status based on level and available data
   * @private
   */
  determineStatus(row, level, campaignObj, adsetObj, adObj) {
    // Level-specific status fields first
    if (level === 'ad' && row.ad_status) return row.ad_status;
    if (level === 'adset' && row.adset_status) return row.adset_status;

    // Row status
    if (row.status) return row.status;

    // Fallback to hierarchy object status
    if (level === 'ad' && adObj?.status) return adObj.status;
    if (level === 'adset' && adsetObj?.status) return adsetObj.status;
    if (campaignObj?.status) return campaignObj.status;

    return 'UNKNOWN';
  }

  /**
   * Determine effective status based on level and available data
   * @private
   */
  determineEffectiveStatus(row, level, campaignObj, adsetObj, adObj) {
    // Level-specific effective status fields first
    if (level === 'ad' && row.ad_effective_status) return row.ad_effective_status;
    if (level === 'adset' && row.adset_effective_status) return row.adset_effective_status;

    // Row effective status
    if (row.effective_status) return row.effective_status;

    // Fallback to hierarchy object effective status
    if (level === 'ad' && adObj?.effective_status) return adObj.effective_status;
    if (level === 'adset' && adsetObj?.effective_status) return adsetObj.effective_status;
    if (campaignObj?.effective_status) return campaignObj.effective_status;

    // Final fallback to regular status
    return this.determineStatus(row, level, campaignObj, adsetObj, adObj);
  }

  /**
   * Determine budget from hierarchy
   * @private
   */
  determineBudget(campaignObj, adsetObj) {
    // AdSet budget takes priority (more granular)
    if (adsetObj?.daily_budget) return this.toNumber(adsetObj.daily_budget);
    if (adsetObj?.lifetime_budget) return this.toNumber(adsetObj.lifetime_budget);

    // Fallback to campaign budget
    if (campaignObj?.daily_budget) return this.toNumber(campaignObj.daily_budget);
    if (campaignObj?.lifetime_budget) return this.toNumber(campaignObj.lifetime_budget);

    return 0;
  }

  // === Calculated Metrics ===

  calculateFrequency(row) {
    const impressions = this.toNumber(row.impressions);
    const reach = this.toNumber(row.reach);
    return reach > 0 ? impressions / reach : 0;
  }

  calculateCTR(row) {
    const clicks = this.toNumber(row.clicks);
    const impressions = this.toNumber(row.impressions);
    return impressions > 0 ? (clicks / impressions) * 100 : 0;
  }

  calculateCPC(row) {
    const spend = this.toNumber(row.spend);
    const clicks = this.toNumber(row.clicks);
    return clicks > 0 ? spend / clicks : 0;
  }

  calculateCPM(row) {
    const spend = this.toNumber(row.spend);
    const impressions = this.toNumber(row.impressions);
    return impressions > 0 ? (spend / impressions) * 1000 : 0;
  }

  // === Utility Methods ===

  /**
   * Safely convert to number
   */
  toNumber(value) {
    if (value === null || value === undefined) return 0;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Get data by lookback period
   */
  async getByLookback(store, lookback = '4weeks') {
    const endDate = this.getTodayDate();
    let startDate;

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

    return this.getRows(store, { startDate, endDate });
  }

  getDateWeeksAgo(weeks) {
    const date = new Date();
    date.setDate(date.getDate() - (weeks * 7));
    return date.toISOString().split('T')[0];
  }

  getTodayDate() {
    return new Date().toISOString().split('T')[0];
  }
}

// Export singleton instance
const metaAIBudgetBridge = new MetaAIBudgetBridge();
export default metaAIBudgetBridge;

// Named export for direct class access
export { MetaAIBudgetBridge };
