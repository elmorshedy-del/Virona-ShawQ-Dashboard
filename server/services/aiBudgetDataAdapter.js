import { getDb } from '../db/database.js';

/**
 * Lightweight data adapter for budget intelligence endpoints.
 * Provides normalized campaign-level rows for weekly aggregation and analysis.
 */
class AIBudgetDataAdapter {
  /**
   * Get aggregated data for a specific date range.
   * @param {string} startDate - inclusive YYYY-MM-DD
   * @param {string} endDate - inclusive YYYY-MM-DD
   */
  async getWeeklyAggregatedData(startDate, endDate) {
    const db = getDb();
    const rows = db.prepare(`
      SELECT
        date,
        campaign_id,
        campaign_name,
        spend,
        conversion_value as purchase_value,
        conversions as purchases,
        impressions,
        clicks,
        add_to_cart as atc,
        checkouts_initiated as ic,
        frequency
      FROM meta_daily_metrics
      WHERE date BETWEEN ? AND ?
      ORDER BY date DESC
    `).all(startDate, endDate);

    return rows.map(row => ({
      ...row,
      spend: parseFloat(row.spend) || 0,
      purchase_value: parseFloat(row.purchase_value) || 0,
      purchases: parseInt(row.purchases) || 0,
      impressions: parseInt(row.impressions) || 0,
      clicks: parseInt(row.clicks) || 0,
      atc: parseInt(row.atc) || 0,
      ic: parseInt(row.ic) || 0,
      frequency: parseFloat(row.frequency) || 0,
      status: row.status || null,
      effective_status: row.effective_status || null
    }));
  }

  /**
   * Convenience helper to fetch data by lookback keyword.
   * @param {string} lookback - e.g. '1week', '2weeks', '4weeks', 'alltime'
   */
  async getDataByLookback(lookback = '4weeks') {
    const { start, end } = this.#calculateDateRange(lookback);
    return this.getWeeklyAggregatedData(start, end);
  }

  #calculateDateRange(lookback) {
    const today = new Date();
    const end = today.toISOString().split('T')[0];

    if (lookback === 'alltime') {
      const db = getDb();
      const earliest = db.prepare('SELECT MIN(date) as start FROM meta_daily_metrics').get();
      return { start: earliest?.start || end, end };
    }

    const daysMap = {
      '1week': 7,
      '2weeks': 14,
      '4weeks': 28,
      '12weeks': 84,
      '1month': 30,
      '3months': 90
    };

    const days = daysMap[lookback] || 28;
    const startDate = new Date(today.getTime());
    startDate.setDate(startDate.getDate() - days + 1);

    return {
      start: startDate.toISOString().split('T')[0],
      end
    };
  }
}

export default new AIBudgetDataAdapter();
