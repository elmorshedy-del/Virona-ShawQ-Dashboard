import { getDb } from './database.js';

export function runLandingPageAuditMigration() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS landing_page_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      url TEXT NOT NULL,
      business_type TEXT,
      conversion_goal TEXT,
      target_customer TEXT,
      score INTEGER,
      grade TEXT,
      result_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      desktop_screenshot TEXT,
      mobile_screenshot TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_landing_page_audits_store_created
      ON landing_page_audits(store, created_at DESC);
  `);

  return { success: true };
}

export default {
  runLandingPageAuditMigration
};
