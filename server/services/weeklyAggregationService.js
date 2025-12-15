/**
 * Weekly Aggregation Service
 *
 * Provides weekly data aggregation for AIBudget.
 * Uses aiBudgetDataAdapter for standardized data.
 */

import aiBudgetDataAdapter from './aiBudgetDataAdapter.js';

class WeeklyAggregationService {

  /**
   * Get weekly summary for AIBudget
   * @param {string} store - 'vironax' or 'shawq'
   * @param {string} lookback - '1week', '2weeks', '4weeks', 'alltime'
   * @returns {Promise<Object>} Weekly summary with trends
   */
  async getWeeklySummary(store = 'shawq', lookback = '4weeks') {
    try {
      const data = await aiBudgetDataAdapter.getDataByLookback(lookback, store);

      if (!data || data.length === 0) {
        return this.getEmptyResponse(lookback);
      }

      // Group by week
      const weeklyData = this.groupByWeek(data);

      // Calculate week-over-week trends
      const trends = this.calculateTrends(weeklyData);

      // Aggregate by campaign
      const campaignSummary = this.aggregateByCampaign(data);

      // Aggregate by level
      const levelSummary = this.aggregateByLevel(data);

      return {
        summary: {
          totalSpend: this.sumField(data, 'spend'),
          totalRevenue: this.sumField(data, 'purchase_value'),
          totalPurchases: this.sumField(data, 'purchases'),
          totalImpressions: this.sumField(data, 'impressions'),
          totalClicks: this.sumField(data, 'clicks'),
          totalATC: this.sumField(data, 'atc'),
          totalIC: this.sumField(data, 'ic'),
          totalReach: this.sumField(data, 'reach'),
          avgFrequency: this.avgField(data, 'frequency'),
          lookbackPeriod: lookback,
          store
        },
        weeklyBreakdown: weeklyData,
        trends: trends,
        campaigns: campaignSummary,
        levels: levelSummary,
        rawData: data
      };
    } catch (error) {
      console.error('[WeeklyAggregation] Error:', error);
      throw error;
    }
  }

  /**
   * Group data by week
   */
  groupByWeek(data) {
    const weeks = {};

    data.forEach(row => {
      const weekKey = row.date;

      if (!weeks[weekKey]) {
        weeks[weekKey] = {
          week: weekKey,
          spend: 0,
          purchase_value: 0,
          purchases: 0,
          impressions: 0,
          clicks: 0,
          atc: 0,
          ic: 0,
          reach: 0,
          campaigns: new Set(),
          adsets: new Set(),
          ads: new Set()
        };
      }

      weeks[weekKey].spend += row.spend || 0;
      weeks[weekKey].purchase_value += row.purchase_value || 0;
      weeks[weekKey].purchases += row.purchases || 0;
      weeks[weekKey].impressions += row.impressions || 0;
      weeks[weekKey].clicks += row.clicks || 0;
      weeks[weekKey].atc += row.atc || 0;
      weeks[weekKey].ic += row.ic || 0;
      weeks[weekKey].reach += row.reach || 0;
      weeks[weekKey].campaigns.add(row.campaign_id);
      if (row.adset_id) weeks[weekKey].adsets.add(row.adset_id);
      if (row.ad_id) weeks[weekKey].ads.add(row.ad_id);
    });

    // Convert to array and calculate metrics
    return Object.values(weeks)
      .map(week => ({
        ...week,
        campaigns: week.campaigns.size,
        adsets: week.adsets.size,
        ads: week.ads.size,
        roi: week.spend > 0 ? ((week.purchase_value - week.spend) / week.spend * 100) : 0,
        ctr: week.impressions > 0 ? (week.clicks / week.impressions * 100) : 0,
        conversionRate: week.clicks > 0 ? (week.purchases / week.clicks * 100) : 0,
        cpc: week.clicks > 0 ? (week.spend / week.clicks) : 0,
        cpa: week.purchases > 0 ? (week.spend / week.purchases) : 0,
        atcRate: week.clicks > 0 ? (week.atc / week.clicks * 100) : 0,
        icRate: week.atc > 0 ? (week.ic / week.atc * 100) : 0
      }))
      .sort((a, b) => new Date(b.week) - new Date(a.week));
  }

  /**
   * Calculate week-over-week trends
   */
  calculateTrends(weeklyData) {
    if (weeklyData.length < 2) {
      return null;
    }

    const latest = weeklyData[0];
    const previous = weeklyData[1];

    return {
      spend: this.calculateChange(previous.spend, latest.spend),
      revenue: this.calculateChange(previous.purchase_value, latest.purchase_value),
      purchases: this.calculateChange(previous.purchases, latest.purchases),
      roi: this.calculateChange(previous.roi, latest.roi),
      ctr: this.calculateChange(previous.ctr, latest.ctr),
      conversionRate: this.calculateChange(previous.conversionRate, latest.conversionRate),
      cpc: this.calculateChange(previous.cpc, latest.cpc),
      cpa: this.calculateChange(previous.cpa, latest.cpa)
    };
  }

  /**
   * Calculate percentage change
   */
  calculateChange(oldValue, newValue) {
    if (oldValue === 0) return newValue > 0 ? 100 : 0;
    return ((newValue - oldValue) / oldValue * 100);
  }

  /**
   * Aggregate data by campaign
   */
  aggregateByCampaign(data) {
    const campaigns = {};

    data.forEach(row => {
      const key = row.campaign_id;

      if (!campaigns[key]) {
        campaigns[key] = {
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name,
          status: row.status,
          effective_status: row.effective_status,
          store: row.store,
          spend: 0,
          purchase_value: 0,
          purchases: 0,
          impressions: 0,
          clicks: 0,
          atc: 0,
          ic: 0,
          reach: 0,
          frequency: [],
          adsets: new Set(),
          ads: new Set()
        };
      }

      campaigns[key].spend += row.spend || 0;
      campaigns[key].purchase_value += row.purchase_value || 0;
      campaigns[key].purchases += row.purchases || 0;
      campaigns[key].impressions += row.impressions || 0;
      campaigns[key].clicks += row.clicks || 0;
      campaigns[key].atc += row.atc || 0;
      campaigns[key].ic += row.ic || 0;
      campaigns[key].reach += row.reach || 0;
      if (row.frequency > 0) campaigns[key].frequency.push(row.frequency);
      if (row.adset_id) campaigns[key].adsets.add(row.adset_id);
      if (row.ad_id) campaigns[key].ads.add(row.ad_id);
    });

    // Calculate campaign-level metrics
    return Object.values(campaigns).map(camp => ({
      ...camp,
      adsetCount: camp.adsets.size,
      adCount: camp.ads.size,
      adsets: undefined,
      ads: undefined,
      avgFrequency: camp.frequency.length > 0
        ? camp.frequency.reduce((a, b) => a + b, 0) / camp.frequency.length
        : 0,
      roi: camp.spend > 0 ? ((camp.purchase_value - camp.spend) / camp.spend * 100) : 0,
      ctr: camp.impressions > 0 ? (camp.clicks / camp.impressions * 100) : 0,
      conversionRate: camp.clicks > 0 ? (camp.purchases / camp.clicks * 100) : 0,
      cpc: camp.clicks > 0 ? (camp.spend / camp.clicks) : 0,
      cpa: camp.purchases > 0 ? (camp.spend / camp.purchases) : 0
    }));
  }

  /**
   * Aggregate data by level (campaign, adset, ad)
   */
  aggregateByLevel(data) {
    const levels = {
      campaign: { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, count: 0 },
      adset: { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, count: 0 },
      ad: { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, count: 0 }
    };

    data.forEach(row => {
      const level = row.level;
      if (levels[level]) {
        levels[level].spend += row.spend || 0;
        levels[level].purchases += row.purchases || 0;
        levels[level].purchase_value += row.purchase_value || 0;
        levels[level].impressions += row.impressions || 0;
        levels[level].clicks += row.clicks || 0;
        levels[level].count += 1;
      }
    });

    return levels;
  }

  /**
   * Sum a field across all rows
   */
  sumField(data, field) {
    return data.reduce((sum, row) => sum + (row[field] || 0), 0);
  }

  /**
   * Average a field across all rows
   */
  avgField(data, field) {
    const values = data.filter(row => row[field] > 0);
    if (values.length === 0) return 0;
    return values.reduce((sum, row) => sum + row[field], 0) / values.length;
  }

  /**
   * Empty response structure
   */
  getEmptyResponse(lookback = '4weeks') {
    return {
      summary: {
        totalSpend: 0,
        totalRevenue: 0,
        totalPurchases: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalATC: 0,
        totalIC: 0,
        totalReach: 0,
        avgFrequency: 0,
        lookbackPeriod: lookback
      },
      weeklyBreakdown: [],
      trends: null,
      campaigns: [],
      levels: {
        campaign: { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, count: 0 },
        adset: { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, count: 0 },
        ad: { spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, count: 0 }
      },
      rawData: []
    };
  }
}

export default new WeeklyAggregationService();
