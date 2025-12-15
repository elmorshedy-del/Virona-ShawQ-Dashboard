import { getDb } from '../db/database.js';
import { getAiBudgetMetaDataset } from '../features/aibudget/metaDataset.js';

/**
 * AIBudget Data Adapter
 * Fetches data from metaDataset (meta_daily_metrics)
 * Standardizes field names and normalizes into AIBudget schema
 */

class AIBudgetDataAdapter {
  
  /**
   * Get all AIBudget data - fetches from metaDataset and standardizes
   * @param {string} store - 'vironax' or 'shawq'
   * @param {object} options - { startDate, endDate, days }
   * @returns {Array} Normalized data array
   */
  async getAIBudgetData(store, options = {}) {
    try {
      // Fetch from metaDataset (meta_daily_metrics)
      const rawData = await getAiBudgetMetaDataset(store, options);
      
      if (!rawData || !rawData.metrics) {
        console.warn('⚠️  No data returned from metaDataset for store:', store);
        return [];
      }

      // Standardize field names from Meta to AIBudget schema
      const standardizedData = this.standardizeMetaData(rawData);
      
      console.log(`📊 Total AIBudget records: ${standardizedData.length}`);
      
      return this.normalizeRows(standardizedData);

    } catch (error) {
      console.error('❌ Error fetching AIBudget data:', error);
      throw error;
    }
  }

  /**
   * Standardize Meta field names to AIBudget schema
   * Converts: conversions → purchases, conversion_value → purchase_value, etc.
   */
  standardizeMetaData(rawData) {
    const standardized = [];
    const { hierarchy = {}, metrics = {} } = rawData;
    
    // Process campaign-level metrics
    if (metrics.campaignDaily && Array.isArray(metrics.campaignDaily)) {
      for (const row of metrics.campaignDaily) {
        standardized.push({
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name || 'Unknown',
          adset_id: null,
          adset_name: null,
          date: row.date || row.date_start,
          geo: row.country || 'Unknown',
          spend: parseFloat(row.spend) || 0,
          purchases: parseInt(row.conversions) || 0,
          purchase_value: parseFloat(row.conversion_value) || 0,
          atc: parseInt(row.add_to_cart) || 0,
          ic: parseInt(row.checkouts_initiated) || 0,
          impressions: parseInt(row.impressions) || 0,
          clicks: parseInt(row.clicks) || 0,
          frequency: parseFloat(row.frequency) || 0,
          reach: parseInt(row.reach) || 0,
          ctr: parseFloat(row.ctr) || 0,
          cpc: parseFloat(row.cpc) || 0,
          cpm: parseFloat(row.cpm) || 0,
          level: 'campaign'
        });
      }
    }
    
    // Process adset-level metrics
    if (metrics.adsetDaily && Array.isArray(metrics.adsetDaily)) {
      for (const row of metrics.adsetDaily) {
        standardized.push({
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name || 'Unknown',
          adset_id: row.adset_id,
          adset_name: row.adset_name || 'Unknown',
          date: row.date || row.date_start,
          geo: row.country || 'Unknown',
          spend: parseFloat(row.spend) || 0,
          purchases: parseInt(row.conversions) || 0,
          purchase_value: parseFloat(row.conversion_value) || 0,
          atc: parseInt(row.add_to_cart) || 0,
          ic: parseInt(row.checkouts_initiated) || 0,
          impressions: parseInt(row.impressions) || 0,
          clicks: parseInt(row.clicks) || 0,
          frequency: parseFloat(row.frequency) || 0,
          reach: parseInt(row.reach) || 0,
          ctr: parseFloat(row.ctr) || 0,
          cpc: parseFloat(row.cpc) || 0,
          cpm: parseFloat(row.cpm) || 0,
          level: 'adset'
        });
      }
    }
    
    // Process ad-level metrics
    if (metrics.adDaily && Array.isArray(metrics.adDaily)) {
      for (const row of metrics.adDaily) {
        standardized.push({
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name || 'Unknown',
          adset_id: row.adset_id,
          adset_name: row.adset_name || 'Unknown',
          ad_id: row.ad_id,
          ad_name: row.ad_name || 'Unknown',
          date: row.date || row.date_start,
          geo: row.country || 'Unknown',
          spend: parseFloat(row.spend) || 0,
          purchases: parseInt(row.conversions) || 0,
          purchase_value: parseFloat(row.conversion_value) || 0,
          atc: parseInt(row.add_to_cart) || 0,
          ic: parseInt(row.checkouts_initiated) || 0,
          impressions: parseInt(row.impressions) || 0,
          clicks: parseInt(row.clicks) || 0,
          frequency: parseFloat(row.frequency) || 0,
          reach: parseInt(row.reach) || 0,
          ctr: parseFloat(row.ctr) || 0,
          cpc: parseFloat(row.cpc) || 0,
          cpm: parseFloat(row.cpm) || 0,
          level: 'ad'
        });
      }
    }
    
    return standardized;
  }

  /**
   * Get data from database only
   */
  async getDataFromDatabase(startDate, endDate) {
    const query = `
      SELECT 
        c.id as campaign_id,
        c.name as campaign_name,
        c.status,
        c.platform as brand,
        a.date,
        a.country as geo,
        a.spend,
        a.revenue as purchase_value,
        a.conversions as purchases,
        a.impressions,
        a.clicks,
        COALESCE(a.atc, 0) as atc,
        COALESCE(a.ic, 0) as ic,
        a.adset_id,
        a.adset_name,
        a.effective_status,
        COALESCE(a.frequency, 0) as frequency,
        COALESCE(a.budget_remaining, 0) as budget,
        mc.meta_campaign_id
      FROM campaigns c
      LEFT JOIN analytics a ON c.id = a.campaign_id
      LEFT JOIN meta_campaigns mc ON c.id = mc.campaign_id
      WHERE a.date BETWEEN ? AND ?
        AND c.platform = 'meta'
      ORDER BY a.date DESC, c.name ASC
    `;

    try {
      const db = getDb();
      const rows = db.prepare(query).all(startDate, endDate);
      console.log(`📚 Fetched ${rows.length} records from database`);
      return rows || [];
    } catch (error) {
      console.error('❌ Database query error:', error);
      return [];
    }
  }

  /**
   * Merge database data with fresh Meta data
   * Meta data takes priority for matching date+campaign+geo
   */
  mergeData(dbData, metaData) {
    if (metaData.length === 0) return dbData;
    if (dbData.length === 0) return metaData;

    // Create lookup map for Meta data (newer/authoritative)
    const metaMap = new Map();
    metaData.forEach(row => {
      const key = `${row.date}_${row.campaign_id}_${row.geo}_${row.adset_id || 'null'}`;
      metaMap.set(key, row);
    });

    // Filter out DB records that are overridden by Meta
    const filteredDbData = dbData.filter(row => {
      const key = `${row.date}_${row.campaign_id}_${row.geo}_${row.adset_id || 'null'}`;
      return !metaMap.has(key);
    });

    // Combine: Meta data + non-overlapping DB data
    return [...metaData, ...filteredDbData];
  }

  /**
   * Get weekly aggregated data - includes live Meta data
   */
  async getWeeklyAggregatedData(startDate, endDate, includeLiveMeta = true) {
    const rawData = await this.getAIBudgetData(startDate, endDate, includeLiveMeta);
    
    // Group by week
    const weeklyMap = new Map();
    
    rawData.forEach(row => {
      const weekStart = this.getWeekStart(row.date);
      const key = `${weekStart}_${row.campaign_id}_${row.geo}_${row.adset_id || 'null'}`;
      
      if (!weeklyMap.has(key)) {
        weeklyMap.set(key, {
          week_start: weekStart,
          date: weekStart,
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name,
          adset_id: row.adset_id,
          adset_name: row.adset_name,
          geo: row.geo,
          status: row.status,
          effective_status: row.effective_status,
          brand: row.brand,
          spend: 0,
          purchase_value: 0,
          purchases: 0,
          impressions: 0,
          clicks: 0,
          atc: 0,
          ic: 0,
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
      
      if (row.frequency > 0) {
        week.frequency_sum += this.toNumber(row.frequency);
        week.frequency_count += 1;
      }
    });
    
    // Calculate average frequency
    const weeklyData = Array.from(weeklyMap.values()).map(week => ({
      ...week,
      frequency: week.frequency_count > 0 ? week.frequency_sum / week.frequency_count : 0
    }));
    
    return this.normalizeRows(weeklyData);
  }

  /**
   * Get campaign time series with live Meta data
   */
  async getCampaignTimeSeries(campaignId, weeksBack = 4, includeLiveMeta = true) {
    const startDate = this.getDateWeeksAgo(weeksBack);
    const endDate = this.getTodayDate();
    
    const allData = await this.getAIBudgetData(startDate, endDate, includeLiveMeta);
    
    // Filter for specific campaign
    return allData.filter(row => row.campaign_id === campaignId);
  }

  /**
   * Get data by lookback period with live Meta data
   */
  async getDataByLookback(lookback = '4weeks', includeLiveMeta = true) {
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
        // Fetch from Meta for all time
        return metaAIBudgetCollector.fetchByLookback('alltime');
      default:
        startDate = this.getDateWeeksAgo(4);
    }

    return this.getWeeklyAggregatedData(startDate, endDate, includeLiveMeta);
  }

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
   * Normalize rows to standard AIBudget schema
   */
  normalizeRows(rows, dateField = 'date') {
    return rows.map(row => ({
      // Standard AIBudget Schema
      date: row[dateField] || row.date || row.week_start,
      geo: row.geo || 'unknown',
      spend: this.toNumber(row.spend),
      purchase_value: this.toNumber(row.purchase_value),
      purchases: this.toNumber(row.purchases),
      impressions: this.toNumber(row.impressions),
      clicks: this.toNumber(row.clicks),
      atc: this.toNumber(row.atc),
      ic: this.toNumber(row.ic),
      
      // Campaign hierarchy
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name || 'Unknown Campaign',
      adset_id: row.adset_id,
      adset_name: row.adset_name,
      
      // Status fields
      status: row.status,
      effective_status: row.effective_status,
      
      // Additional metrics
      frequency: this.toNumber(row.frequency),
      budget: this.toNumber(row.budget),
      
      // Platform/Brand
      brand: row.brand || 'meta',
      store: row.store || null,
      
      // Meta-specific
      meta_campaign_id: row.meta_campaign_id,
      reach: this.toNumber(row.reach)
    }));
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
