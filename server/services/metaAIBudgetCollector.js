import fetch from 'node-fetch';

/**
 * @deprecated This collector is kept as a BACKUP ONLY.
 *
 * USE metaAIBudgetBridge.js INSTEAD for all AIBudget data needs.
 *
 * This collector fetches directly from Meta API which is redundant
 * since metaService.js already syncs Meta data to the database.
 *
 * The unified data flow is:
 *   metaService.js (sync) → DB → metaDataset.js → metaAIBudgetBridge.js → consumers
 *
 * Only use this collector if:
 * - Database is unavailable
 * - Real-time Meta API data is absolutely required
 * - Testing/debugging Meta API responses
 *
 * Meta AI Budget Data Collector (BACKUP)
 * Parallel service that fetches Meta data directly from API
 */

class MetaAIBudgetCollector {
  
  constructor() {
    this.accessToken = process.env.META_ACCESS_TOKEN;
    this.adAccountId = process.env.META_AD_ACCOUNT_ID;
    this.apiVersion = 'v18.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Fetch Meta data for AIBudget with all required fields
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Array} Normalized AIBudget data
   */
  async fetchAIBudgetData(startDate, endDate) {
    if (!this.accessToken || !this.adAccountId) {
      console.warn('⚠️  Meta credentials not configured for AIBudget collector');
      return [];
    }

    try {
      console.log(`🔍 Fetching Meta data for AIBudget: ${startDate} to ${endDate}`);

      // Fetch campaign-level data with ALL breakdowns
      const campaignData = await this.fetchCampaignInsights(startDate, endDate);
      
      // Fetch adset-level data
      const adsetData = await this.fetchAdsetInsights(startDate, endDate);

      // Merge and normalize
      const normalizedData = this.normalizeMetaData([...campaignData, ...adsetData]);

      console.log(`✅ Collected ${normalizedData.length} records for AIBudget`);
      
      return normalizedData;

    } catch (error) {
      console.error('❌ Error fetching Meta data for AIBudget:', error);
      throw error;
    }
  }

  /**
   * Fetch campaign-level insights with geo breakdown
   */
  async fetchCampaignInsights(startDate, endDate) {
    const fields = [
      'campaign_id',
      'campaign_name',
      'spend',
      'impressions',
      'clicks',
      'reach',
      'frequency',
      'actions',
      'action_values',
      'cost_per_action_type'
    ].join(',');

    const breakdowns = 'country';

    const url = `${this.baseUrl}/act_${this.adAccountId}/insights?` +
      `level=campaign&` +
      `fields=${fields}&` +
      `breakdowns=${breakdowns}&` +
      `time_range={"since":"${startDate}","until":"${endDate}"}&` +
      `time_increment=1&` +
      `access_token=${this.accessToken}`;

    return this.paginateFetch(url);
  }

  /**
   * Fetch adset-level insights with geo breakdown
   */
  async fetchAdsetInsights(startDate, endDate) {
    const fields = [
      'campaign_id',
      'campaign_name',
      'adset_id',
      'adset_name',
      'spend',
      'impressions',
      'clicks',
      'reach',
      'frequency',
      'actions',
      'action_values',
      'cost_per_action_type',
      'budget_remaining',
      'daily_budget',
      'lifetime_budget'
    ].join(',');

    const breakdowns = 'country';

    const url = `${this.baseUrl}/act_${this.adAccountId}/insights?` +
      `level=adset&` +
      `fields=${fields}&` +
      `breakdowns=${breakdowns}&` +
      `time_range={"since":"${startDate}","until":"${endDate}"}&` +
      `time_increment=1&` +
      `access_token=${this.accessToken}`;

    return this.paginateFetch(url);
  }

  /**
   * Paginate through Meta API results
   */
  async paginateFetch(url) {
    let allData = [];
    let nextUrl = url;
    let pageCount = 0;

    while (nextUrl) {
      try {
        const response = await fetch(nextUrl);
        const json = await response.json();

        if (json.error) {
          console.error('❌ Meta API Error:', json.error);
          break;
        }

        if (json.data && json.data.length > 0) {
          allData = allData.concat(json.data);
          pageCount++;
          console.log(`  📄 Fetched page ${pageCount}: ${json.data.length} records`);
        }

        // Check for next page
        nextUrl = json.paging?.next || null;

        // Rate limiting - wait 200ms between requests
        if (nextUrl) {
          await this.sleep(200);
        }

      } catch (error) {
        console.error('❌ Error fetching Meta page:', error);
        break;
      }
    }

    return allData;
  }

  /**
   * Normalize Meta API response to AIBudget standard schema
   */
  normalizeMetaData(rawData) {
    return rawData.map(insight => {
      // Extract action values
      const purchases = this.extractActionValue(insight.actions, ['purchase', 'omni_purchase']);
      const atc = this.extractActionValue(insight.actions, ['add_to_cart', 'omni_add_to_cart']);
      const ic = this.extractActionValue(insight.actions, ['initiate_checkout', 'omni_initiate_checkout']);
      
      // Extract revenue (action_values)
      const purchase_value = this.extractActionValue(insight.action_values, ['purchase', 'omni_purchase']);

      // Budget calculation
      const budget = insight.budget_remaining || 
                    insight.daily_budget || 
                    insight.lifetime_budget || 
                    0;

      // Status - Meta provides this at campaign/adset level
      const status = insight.status || 'UNKNOWN';
      const effective_status = insight.effective_status || status;

      return {
        // Standard AIBudget Schema
        date: insight.date_start,
        geo: insight.country || 'unknown',
        spend: parseFloat(insight.spend) || 0,
        purchase_value: parseFloat(purchase_value) || 0,
        purchases: parseInt(purchases) || 0,
        impressions: parseInt(insight.impressions) || 0,
        clicks: parseInt(insight.clicks) || 0,
        atc: parseInt(atc) || 0,
        ic: parseInt(ic) || 0,
        
        // Campaign hierarchy
        campaign_id: insight.campaign_id,
        campaign_name: insight.campaign_name || 'Unknown Campaign',
        adset_id: insight.adset_id || null,
        adset_name: insight.adset_name || null,
        
        // Status
        status: status,
        effective_status: effective_status,
        
        // Additional metrics
        frequency: parseFloat(insight.frequency) || 0,
        budget: parseFloat(budget) || 0,
        reach: parseInt(insight.reach) || 0,
        
        // Platform
        brand: 'meta',
        store: null
      };
    });
  }

  /**
   * Extract action value from Meta actions array
   * @param {Array} actions - Meta actions or action_values array
   * @param {Array} actionTypes - Action types to look for
   * @returns {number} Sum of matching action values
   */
  extractActionValue(actions, actionTypes) {
    if (!actions || !Array.isArray(actions)) return 0;
    
    let total = 0;
    for (const action of actions) {
      if (actionTypes.includes(action.action_type)) {
        total += parseFloat(action.value) || 0;
      }
    }
    
    return total;
  }

  /**
   * Sleep utility for rate limiting
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Fetch and cache data for quick lookback queries
   * @param {string} lookback - '1week', '2weeks', '4weeks', 'alltime'
   * @returns {Array} Cached data
   */
  async fetchByLookback(lookback = '4weeks') {
    const endDate = new Date().toISOString().split('T')[0];
    let startDate;

    switch (lookback) {
      case '1week':
        startDate = this.getDateDaysAgo(7);
        break;
      case '2weeks':
        startDate = this.getDateDaysAgo(14);
        break;
      case '4weeks':
        startDate = this.getDateDaysAgo(28);
        break;
      case 'alltime':
        startDate = this.getDateDaysAgo(365 * 2);
        break;
      default:
        startDate = this.getDateDaysAgo(28);
    }

    return this.fetchAIBudgetData(startDate, endDate);
  }

  /**
   * Get date N days ago
   */
  getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }
}

export default new MetaAIBudgetCollector();

