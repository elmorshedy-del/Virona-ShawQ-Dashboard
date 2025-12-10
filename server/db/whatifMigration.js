// ============================================================================
// whatifMigration.js - BACKEND MIGRATION
// Place in: server/db/whatifMigration.js
// Purpose: Create whatif_timeseries table for What-If Budget Simulator
// Run once on server startup - safe to run multiple times (IF NOT EXISTS)
// ============================================================================

import { getDb } from './database.js';

/**
 * Run migration to create What-If tables
 * Safe to call multiple times - uses IF NOT EXISTS
 */
export function runWhatIfMigration() {
  const db = getDb();
  
  console.log('[WhatIf Migration] Starting...');
  
  try {
    // =========================================================================
    // MAIN TIMESERIES TABLE
    // Stores daily data at campaign + adset level
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS whatif_timeseries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        campaign_name TEXT,
        adset_id TEXT NOT NULL,
        adset_name TEXT,
        date TEXT NOT NULL,
        spend REAL DEFAULT 0,
        purchases INTEGER DEFAULT 0,
        revenue REAL DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        atc INTEGER DEFAULT 0,
        ic INTEGER DEFAULT 0,
        reach INTEGER DEFAULT 0,
        frequency REAL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(store, campaign_id, adset_id, date)
      )
    `);
    
    console.log('[WhatIf Migration] Created whatif_timeseries table');
    
    // =========================================================================
    // INDEXES FOR PERFORMANCE
    // =========================================================================
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_whatif_store ON whatif_timeseries(store);
      CREATE INDEX IF NOT EXISTS idx_whatif_campaign ON whatif_timeseries(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_whatif_date ON whatif_timeseries(date);
      CREATE INDEX IF NOT EXISTS idx_whatif_store_campaign ON whatif_timeseries(store, campaign_id);
      CREATE INDEX IF NOT EXISTS idx_whatif_store_date ON whatif_timeseries(store, date);
    `);
    
    console.log('[WhatIf Migration] Created indexes');
    
    // =========================================================================
    // SYNC STATUS TABLE (optional - tracks last sync times)
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS whatif_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store TEXT NOT NULL,
        sync_type TEXT DEFAULT 'auto',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        rows_processed INTEGER DEFAULT 0,
        slices_processed INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        error_message TEXT
      )
    `);
    
    console.log('[WhatIf Migration] Created whatif_sync_log table');
    
    // =========================================================================
    // CSV IMPORTS LOG (tracks uploaded CSV files)
    // =========================================================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS whatif_csv_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store TEXT NOT NULL,
        filename TEXT,
        mode TEXT DEFAULT 'complement',
        campaign_id TEXT,
        rows_imported INTEGER DEFAULT 0,
        rows_skipped INTEGER DEFAULT 0,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('[WhatIf Migration] Created whatif_csv_imports table');
    
    console.log('[WhatIf Migration] Complete!');
    
    return { success: true };
    
  } catch (error) {
    console.error('[WhatIf Migration] Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check if migration has been run
 */
export function isWhatIfMigrated() {
  const db = getDb();
  
  try {
    const table = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='whatif_timeseries'
    `).get();
    
    return !!table;
  } catch (error) {
    return false;
  }
}

/**
 * Get table stats
 */
export function getWhatIfTableStats() {
  const db = getDb();
  
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_rows,
        COUNT(DISTINCT store) as stores,
        COUNT(DISTINCT campaign_id) as campaigns,
        COUNT(DISTINCT adset_id) as adsets,
        MIN(date) as earliest_date,
        MAX(date) as latest_date
      FROM whatif_timeseries
    `).get();
    
    return stats;
  } catch (error) {
    return { error: error.message };
  }
}

export default {
  runWhatIfMigration,
  isWhatIfMigrated,
  getWhatIfTableStats
};
