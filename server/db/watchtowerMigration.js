// ============================================================================
// watchtowerMigration.js - BACKEND MIGRATION
// Purpose: Persist Watchtower annotations + guardrail rules
// Safe to run multiple times (IF NOT EXISTS)
// ============================================================================

import { getDb } from './database.js';

export function runWatchtowerMigration() {
  const db = getDb();

  console.log('[Watchtower Migration] Starting...');

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS watchtower_annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store TEXT NOT NULL,
        event_date TEXT NOT NULL,
        category TEXT DEFAULT 'note',
        title TEXT NOT NULL,
        detail TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_watchtower_annotations_store_date
        ON watchtower_annotations(store, event_date);

      CREATE TABLE IF NOT EXISTS watchtower_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        metric_key TEXT NOT NULL,
        direction TEXT NOT NULL DEFAULT 'any',
        threshold_type TEXT NOT NULL DEFAULT 'pct_change',
        threshold_value REAL NOT NULL,
        window_days INTEGER NOT NULL DEFAULT 14,
        min_baseline REAL NOT NULL DEFAULT 0,
        title TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_watchtower_rules_store
        ON watchtower_rules(store);

      CREATE INDEX IF NOT EXISTS idx_watchtower_rules_metric
        ON watchtower_rules(store, metric_key);
    `);

    console.log('[Watchtower Migration] Complete!');
    return { success: true };
  } catch (error) {
    console.error('[Watchtower Migration] Error:', error.message);
    return { success: false, error: error.message };
  }
}

export default {
  runWatchtowerMigration
};

