/**
 * META TO AI BUDGET BRIDGE
 * Direct pipeline from Meta data ingestion to AI Budget processing
 * Eliminates redundant queries and improves data flow
 */

import { getDb } from '../db/database.js';

class MetaToAIBridge {
  /**
   * Real-time notification: New Meta data available
   * Called by metaService after successful data sync
   */
  notifyNewData(store, dateRange) {
    console.log(`[Bridge] New Meta data available for ${store}:`, dateRange);
    
    // Clear AI Budget cache for this store
    const aiBudgetService = require('./aiBudgetService.js').default;
    aiBudgetService.clearCache();
    
    // Future: Trigger background AI analysis
    this.triggerBackgroundAnalysis(store, dateRange);
  }

  /**
   * Pre-aggregate metrics for faster AI queries
   * Run this after Meta data sync to prepare optimized views
   */
  async preAggregateForAI(store) {
    const db = getDb();
    
    console.log(`[Bridge] Pre-aggregating AI metrics for ${store}...`);
    
    // Create aggregated view if not exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_budget_cache (
        store TEXT,
        level TEXT,
        object_id TEXT,
        date_start TEXT,
        date_end TEXT,
        spend REAL,
        conversions INTEGER,
        conversion_value REAL,
        impressions INTEGER,
        clicks INTEGER,
        metadata TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (store, level, object_id, date_start, date_end)
      )
    `);

    // Aggregate last 30 days by campaign
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    db.prepare(`
      INSERT OR REPLACE INTO ai_budget_cache 
      (store, level, object_id, date_start, date_end, spend, conversions, 
       conversion_value, impressions, clicks, metadata, updated_at)
      SELECT 
        store,
        'campaign' as level,
        campaign_id as object_id,
        ? as date_start,
        ? as date_end,
        SUM(spend) as spend,
        SUM(conversions) as conversions,
        SUM(conversion_value) as conversion_value,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        json_object(
          'campaign_name', campaign_name,
          'status', MAX(effective_status),
          'days_active', COUNT(DISTINCT date)
        ) as metadata,
        datetime('now') as updated_at
      FROM meta_daily_metrics
      WHERE store = ? AND date BETWEEN ? AND ?
      GROUP BY store, campaign_id, campaign_name
    `).run(startDate, endDate, store, startDate, endDate);

    console.log(`[Bridge] Pre-aggregation complete for ${store}`);
  }

  /**
   * Get cached aggregated data (much faster than live queries)
   */
  getCachedAggregates(store, level = 'campaign', daysBack = 30) {
    const db = getDb();
    
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const start = startDate.toISOString().split('T')[0];

    return db.prepare(`
      SELECT * FROM ai_budget_cache
      WHERE store = ? AND level = ? AND date_end >= ?
      ORDER BY spend DESC
    `).all(store, level, start);
  }

  /**
   * Background: Trigger AI analysis
   */
  async triggerBackgroundAnalysis(store, dateRange) {
    // Future: Queue job for AI recommendation refresh
    console.log(`[Bridge] Background analysis queued for ${store}`);
  }
}

export default new MetaToAIBridge();
