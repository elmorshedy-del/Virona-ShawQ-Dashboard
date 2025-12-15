/**
 * AI BUDGET BRIDGE - UNIFIED DATA PIPELINE
 * 
 * metaService.js (raw Meta Ads data) → aiBudgetBridge.js → AI Budget component
 * 
 * Purpose:
 * - Fetches campaigns/adsets/ads with full metrics from database
 * - Standardizes field names (conversions → purchases, conversion_value → purchase_value)
 * - Calculates derived metrics (ROAS, CAC, CVR, etc.)
 * - Returns clean, aggregated data ready for AI Budget calculations
 */

import { getDb } from '../db/database.js';

class AIBudgetBridge {
  
  /**
   * Fetch AI Budget data with full campaign/adset/ad hierarchy and metrics
   * @param {string} store - 'vironax' or 'shawq'
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @param {Object} options - Additional options (includeInactive, days)
   * @returns {Object} Standardized hierarchy with metrics
   */
  async fetchAIBudgetData(store, startDate, endDate, options = {}) {
    try {
      const { includeInactive = false, days } = options;
      
      // Calculate date range if days provided
      let finalStartDate = startDate;
      let finalEndDate = endDate;
      
      if (!startDate && days) {
        finalEndDate = this.getTodayDate();
        finalStartDate = this.getDateDaysAgo(days);
      }
      
      console.log(`[aiBudgetBridge] Fetching data for ${store} from ${finalStartDate} to ${finalEndDate}`);
      
      const db = getDb();
      
      // Status filters
      const statusFilter = includeInactive 
        ? '' 
        : `AND (effective_status = 'ACTIVE' OR effective_status = 'UNKNOWN' OR effective_status IS NULL)`;
      
      const adsetStatusFilter = includeInactive
        ? ''
        : `AND (adset_effective_status = 'ACTIVE' OR adset_effective_status = 'UNKNOWN' OR adset_effective_status IS NULL)`;
      
      const adStatusFilter = includeInactive
        ? ''
        : `AND (ad_effective_status = 'ACTIVE' OR ad_effective_status = 'UNKNOWN' OR ad_effective_status IS NULL)`;

      // Fetch campaigns with aggregated metrics
      const campaigns = db.prepare(`
        SELECT
          campaign_id,
          campaign_name,
          MAX(effective_status) as status,
          MIN(date) as first_date,
          MAX(date) as last_date,
          SUM(spend) as spend,
          SUM(impressions) as impressions,
          SUM(reach) as reach,
          SUM(clicks) as clicks,
          SUM(inline_link_clicks) as inline_link_clicks,
          SUM(landing_page_views) as lpv,
          SUM(add_to_cart) as atc,
          SUM(checkouts_initiated) as checkout,
          SUM(conversions) as conversions,
          SUM(conversion_value) as revenue
        FROM meta_daily_metrics
        WHERE LOWER(store) = ?
          ${finalStartDate ? 'AND date >= ?' : ''}
          ${finalEndDate ? 'AND date <= ?' : ''}
          ${statusFilter}
          AND campaign_name IS NOT NULL
        GROUP BY campaign_id
        ORDER BY spend DESC
      `).all(store.toLowerCase(), ...[finalStartDate, finalEndDate].filter(Boolean));

      // Fetch adsets with aggregated metrics
      const adsets = db.prepare(`
        SELECT
          campaign_id,
          adset_id,
          adset_name,
          MAX(adset_effective_status) as status,
          MIN(date) as first_date,
          MAX(date) as last_date,
          SUM(spend) as spend,
          SUM(impressions) as impressions,
          SUM(reach) as reach,
          SUM(clicks) as clicks,
          SUM(inline_link_clicks) as inline_link_clicks,
          SUM(landing_page_views) as lpv,
          SUM(add_to_cart) as atc,
          SUM(checkouts_initiated) as checkout,
          SUM(conversions) as conversions,
          SUM(conversion_value) as revenue
        FROM meta_adset_metrics
        WHERE LOWER(store) = ?
          ${finalStartDate ? 'AND date >= ?' : ''}
          ${finalEndDate ? 'AND date <= ?' : ''}
          ${adsetStatusFilter}
          AND adset_name IS NOT NULL
        GROUP BY adset_id
        ORDER BY spend DESC
      `).all(store.toLowerCase(), ...[finalStartDate, finalEndDate].filter(Boolean));

      // Fetch ads with aggregated metrics
      const ads = db.prepare(`
        SELECT
          campaign_id,
          adset_id,
          ad_id,
          ad_name,
          MAX(ad_effective_status) as status,
          MIN(date) as first_date,
          MAX(date) as last_date,
          SUM(spend) as spend,
          SUM(impressions) as impressions,
          SUM(reach) as reach,
          SUM(clicks) as clicks,
          SUM(inline_link_clicks) as inline_link_clicks,
          SUM(landing_page_views) as lpv,
          SUM(add_to_cart) as atc,
          SUM(checkouts_initiated) as checkout,
          SUM(conversions) as conversions,
          SUM(conversion_value) as revenue
        FROM meta_ad_metrics
        WHERE LOWER(store) = ?
          ${finalStartDate ? 'AND date >= ?' : ''}
          ${finalEndDate ? 'AND date <= ?' : ''}
          ${adStatusFilter}
          AND ad_name IS NOT NULL
        GROUP BY ad_id
        ORDER BY spend DESC
      `).all(store.toLowerCase(), ...[finalStartDate, finalEndDate].filter(Boolean));

      console.log(`[aiBudgetBridge] ✅ Fetched ${campaigns.length} campaigns, ${adsets.length} adsets, ${ads.length} ads`);

      // Build hierarchy
      const adsByAdset = new Map();
      ads.forEach(ad => {
        if (!adsByAdset.has(ad.adset_id)) adsByAdset.set(ad.adset_id, []);
        adsByAdset.get(ad.adset_id).push(this.standardizeMetrics(ad, 'ad'));
      });

      const adsetsByCampaign = new Map();
      adsets.forEach(adset => {
        if (!adsetsByCampaign.has(adset.campaign_id)) adsetsByCampaign.set(adset.campaign_id, []);
        adsetsByCampaign.get(adset.campaign_id).push({
          ...this.standardizeMetrics(adset, 'adset'),
          ads: adsByAdset.get(adset.adset_id) || []
        });
      });

      const hierarchy = campaigns.map(campaign => ({
        ...this.standardizeMetrics(campaign, 'campaign'),
        adsets: adsetsByCampaign.get(campaign.campaign_id) || []
      }));

      // Calculate totals
      const totals = campaigns.reduce((acc, c) => ({
        spend: acc.spend + (c.spend || 0),
        conversions: acc.conversions + (c.conversions || 0),
        revenue: acc.revenue + (c.revenue || 0),
        impressions: acc.impressions + (c.impressions || 0),
        clicks: acc.clicks + (c.clicks || 0)
      }), { spend: 0, conversions: 0, revenue: 0, impressions: 0, clicks: 0 });

      return {
        success: true,
        data: hierarchy,
        totals: {
          ...totals,
          cac: totals.conversions > 0 ? totals.spend / totals.conversions : 0,
          roas: totals.spend > 0 ? totals.revenue / totals.spend : 0,
          ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0
        },
        meta: {
          store,
          startDate: finalStartDate,
          endDate: finalEndDate,
          includeInactive,
          totalCampaigns: campaigns.length,
          totalAdsets: adsets.length,
          totalAds: ads.length
        }
      };
      
    } catch (error) {
      console.error('[aiBudgetBridge] ❌ Error fetching data:', error);
      return {
        success: false,
        error: error.message,
        data: [],
        totals: null,
        meta: { store }
      };
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
