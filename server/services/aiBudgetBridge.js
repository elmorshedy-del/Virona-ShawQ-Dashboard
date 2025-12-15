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
   * Fetch by lookback period (e.g., 'alltime', '4weeks', '14d', '30d', '90d')
   */
  async fetchByLookback(store, lookback = 'alltime', options = {}) {
    const endDate = this.getTodayDate();
    let startDate;
    let days;

    switch (lookback) {
      case '1week':
      case '7d':
        days = 7;
        startDate = this.getDateDaysAgo(7);
        break;
      case '2weeks':
      case '14d':
        days = 14;
        startDate = this.getDateDaysAgo(14);
        break;
      case '4weeks':
      case '30d':
        days = 30;
        startDate = this.getDateDaysAgo(30);
        break;
      case '90d':
        days = 90;
        startDate = this.getDateDaysAgo(90);
        break;
      case 'alltime':
      case 'full':
        // Get data from 1 year ago (or inception if less)
        days = 365;
        startDate = this.getDateDaysAgo(365);
        break;
      default:
        days = 30;
        startDate = this.getDateDaysAgo(30);
    }

    return this.fetchAIBudgetData(store, startDate, endDate, { ...options, days });
  }

  /**
   * Standardize metrics for AI Budget consumption
   * Converts Meta Ads field names to AI Budget schema:
   * - conversions → purchases
   * - conversion_value → purchase_value
   * - add_to_cart → atc
   * - checkouts_initiated → ic
   */
  standardizeMetrics(obj, type) {
    const spend = this.toNumber(obj.spend);
    const conversions = this.toNumber(obj.conversions);
    const revenue = this.toNumber(obj.revenue);
    const impressions = this.toNumber(obj.impressions);
    const reach = this.toNumber(obj.reach);
    const clicks = this.toNumber(obj.clicks);
    const inline_link_clicks = this.toNumber(obj.inline_link_clicks);
    const lpv = this.toNumber(obj.lpv);
    const atc = this.toNumber(obj.atc);
    const checkout = this.toNumber(obj.checkout);

    // Calculate derived metrics (use 0 if denominator is 0, for AI Budget calculations)
    const cac = conversions > 0 ? spend / conversions : 0;
    const roas = spend > 0 ? revenue / spend : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    const cvr = inline_link_clicks > 0 ? (conversions / inline_link_clicks) * 100 : 0;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
    const lpv_rate = inline_link_clicks > 0 ? (lpv / inline_link_clicks) * 100 : 0;
    const atc_rate = lpv > 0 ? (atc / lpv) * 100 : 0;
    const checkout_rate = atc > 0 ? (checkout / atc) * 100 : 0;
    const purchase_rate = checkout > 0 ? (conversions / checkout) * 100 : 0;
    const aov = conversions > 0 ? revenue / conversions : 0;

    const standard = {
      // IDs and Names
      id: obj[`${type}_id`],
      name: obj[`${type}_name`],
      status: obj.status,
      first_date: obj.first_date,
      last_date: obj.last_date,
      
      // RAW METRICS (Meta field names)
      spend,
      conversions,
      revenue,
      impressions,
      reach,
      clicks,
      inline_link_clicks,
      lpv,
      atc,
      checkout,
      
      // STANDARDIZED METRICS (AI Budget field names)
      purchases: conversions,           // ← KEY MAPPING
      purchase_value: revenue,          // ← KEY MAPPING
      ic: checkout,                     // ← KEY MAPPING (initiate_checkout)
      
      // DERIVED METRICS
      cac,
      roas,
      ctr,
      cpc,
      cvr,
      cpm,
      aov,
      lpv_rate,
      atc_rate,
      checkout_rate,
      purchase_rate
    };

    // Add type-specific fields
    if (type === 'campaign') {
      standard.campaign_id = obj.campaign_id;
      standard.campaign_name = obj.campaign_name;
    } else if (type === 'adset') {
      standard.campaign_id = obj.campaign_id;
      standard.adset_id = obj.adset_id;
      standard.adset_name = obj.adset_name;
    } else if (type === 'ad') {
      standard.campaign_id = obj.campaign_id;
      standard.adset_id = obj.adset_id;
      standard.ad_id = obj.ad_id;
      standard.ad_name = obj.ad_name;
    }

    return standard;
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
   * Get date N days ago
   */
  getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
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
