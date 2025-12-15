/**
 * AI Budget Bridge
 * 
 * Connects metaDataset.js → aiBudgetDataAdapter.js
 * 
 * Purpose:
 * - Fetches raw Meta data from metaDataset.js
 * - Standardizes field names (conversions → purchases, etc.)
 * - Aggregates daily metrics into the format AI Budget expects
 * - Returns clean, standardized data ready for AI Budget math
 */

import { getAiBudgetMetaDataset } from '../features/aibudget/metaDataset.js';

class AIBudgetBridge {
  
  /**
   * Fetch AI Budget data from metaDataset and standardize it
   * @param {string} store - 'vironax' or 'shawq'
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Array} Standardized data rows
   */
  async fetchAIBudgetData(store, startDate, endDate) {
    try {
      console.log(`[Bridge] Fetching data for ${store} from ${startDate} to ${endDate}`);
      
      // Fetch from metaDataset
      const rawData = await getAiBudgetMetaDataset(store, {
        start_date: startDate,
        end_date: endDate,
        include_structure: true
      });

      // Extract and standardize metrics
      const standardized = this.standardizeMetaData(rawData, store);
      
      console.log(`[Bridge] ✅ Standardized ${standardized.length} rows`);
      
      return standardized;
      
    } catch (error) {
      console.error('[Bridge] ❌ Error fetching data:', error);
      throw error;
    }
  }

  /**
   * Fetch by lookback period (e.g., 'alltime', '4weeks')
   */
  async fetchByLookback(store, lookback = 'alltime') {
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
        // Get data from 1 year ago
        startDate = this.getDateWeeksAgo(52);
        break;
      default:
        startDate = this.getDateWeeksAgo(4);
    }

    return this.fetchAIBudgetData(store, startDate, endDate);
  }

  /**
   * Standardize Meta field names to AI Budget schema
   * 
   * Converts:
   * - conversions → purchases
   * - conversion_value → purchase_value
   * - add_to_cart → atc
   * - checkouts_initiated → ic
   * - country → geo
   */
  standardizeMetaData(rawData, store) {
    const rows = [];

    // Process campaign-level metrics
    if (rawData.metrics?.campaignDaily) {
      rawData.metrics.campaignDaily.forEach(metric => {
        rows.push(this.standardizeRow(metric, 'campaign', store, rawData.hierarchy));
      });
    }

    // Process adset-level metrics
    if (rawData.metrics?.adsetDaily) {
      rawData.metrics.adsetDaily.forEach(metric => {
        rows.push(this.standardizeRow(metric, 'adset', store, rawData.hierarchy));
      });
    }

    // Process ad-level metrics (if needed)
    if (rawData.metrics?.adDaily) {
      rawData.metrics.adDaily.forEach(metric => {
        rows.push(this.standardizeRow(metric, 'ad', store, rawData.hierarchy));
      });
    }

    return rows;
  }

  /**
   * Standardize a single metric row
   */
  standardizeRow(row, level, store, hierarchy) {
    // Find hierarchy info
    const campaignInfo = this.findCampaign(row.campaign_id, hierarchy);
    const adsetInfo = this.findAdset(row.adset_id, hierarchy);

    return {
      // Date & Geo
      date: row.date,
      geo: row.country || row.geo || 'unknown',
      
      // Core Metrics (STANDARDIZED FIELD NAMES)
      spend: this.toNumber(row.spend),
      purchases: this.toNumber(row.conversions), // ← KEY MAPPING
      purchase_value: this.toNumber(row.conversion_value), // ← KEY MAPPING
      
      // Funnel Metrics (STANDARDIZED FIELD NAMES)
      impressions: this.toNumber(row.impressions),
      clicks: this.toNumber(row.clicks),
      atc: this.toNumber(row.add_to_cart), // ← KEY MAPPING
      ic: this.toNumber(row.checkouts_initiated), // ← KEY MAPPING
      
      // Campaign Hierarchy
      campaign_id: row.campaign_id,
      campaign_name: campaignInfo?.campaign_name || 'Unknown Campaign',
      adset_id: row.adset_id || null,
      adset_name: adsetInfo?.adset_name || null,
      ad_id: row.ad_id || null,
      
      // Status
      status: row.status || campaignInfo?.status || 'UNKNOWN',
      effective_status: row.effective_status || row.status,
      
      // Additional Metrics
      frequency: this.toNumber(row.frequency),
      reach: this.toNumber(row.reach),
      budget: this.toNumber(row.budget_remaining || campaignInfo?.budget),
      
      // Platform
      brand: 'meta',
      store: store,
      
      // Level identifier
      level: level
    };
  }

  /**
   * Find campaign info from hierarchy
   */
  findCampaign(campaignId, hierarchy) {
    if (!hierarchy?.campaigns) return null;
    return hierarchy.campaigns.find(c => c.campaign_id === campaignId);
  }

  /**
   * Find adset info from hierarchy
   */
  findAdset(adsetId, hierarchy) {
    if (!adsetId || !hierarchy?.adsets) return null;
    return hierarchy.adsets.find(a => a.adset_id === adsetId);
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
   * Get date N weeks ago
   */
  getDateWeeksAgo(weeks) {
    const date = new Date();
    date.setDate(date.getDate() - (weeks * 7));
    return date.toISOString().split('T')[0];
  }

  /**
   * Get today's date
   */
  getTodayDate() {
    return new Date().toISOString().split('T')[0];
  }
}

export default new AIBudgetBridge();
