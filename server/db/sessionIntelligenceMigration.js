import { getDb } from './database.js';

export function runSessionIntelligenceMigration() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_client_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      client_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, client_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_client_sessions_store_last_seen
    ON si_client_sessions(store, last_seen_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      session_id TEXT NOT NULL,
      client_id TEXT,
      source TEXT,
      event_name TEXT NOT NULL,
      event_ts TEXT NOT NULL,
      page_url TEXT,
      page_path TEXT,
      checkout_token TEXT,
      checkout_step TEXT,
      device_type TEXT,
      country_code TEXT,
      product_id TEXT,
      variant_id TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_content TEXT,
      utm_term TEXT,
      fbclid TEXT,
      gclid TEXT,
      ttclid TEXT,
      msclkid TEXT,
      wbraid TEXT,
      gbraid TEXT,
      irclickid TEXT,
      data_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Backfill missing columns for existing databases
  try {
    db.exec(`ALTER TABLE si_events ADD COLUMN checkout_token TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE si_events ADD COLUMN checkout_step TEXT`);
  } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN device_type TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN country_code TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN product_id TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN variant_id TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN utm_source TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN utm_medium TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN utm_campaign TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN utm_content TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN utm_term TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN fbclid TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN gclid TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN ttclid TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN msclkid TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN wbraid TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN gbraid TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN irclickid TEXT`); } catch (e) { /* column exists */ }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_events_store_created_at
    ON si_events(store, created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_events_store_session_ts
    ON si_events(store, session_id, event_ts)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_events_store_event_created_at
    ON si_events(store, event_name, created_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_events_store_campaign
    ON si_events(store, utm_campaign, created_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      session_id TEXT NOT NULL,
      client_id TEXT,
      started_at TEXT,
      last_event_at TEXT,
      atc_at TEXT,
      checkout_started_at TEXT,
      purchase_at TEXT,
      last_checkout_token TEXT,
      last_checkout_step TEXT,
      last_cart_json TEXT,
      last_device_type TEXT,
      last_country_code TEXT,
      last_product_id TEXT,
      last_variant_id TEXT,
      last_campaign_json TEXT,
      status TEXT DEFAULT 'active',
      analysis_state TEXT,
      analyzed_at TEXT,
      primary_reason TEXT,
      confidence REAL,
      summary TEXT,
      reasons_json TEXT,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, session_id)
    )
  `);

  try {
    db.exec(`ALTER TABLE si_sessions ADD COLUMN last_checkout_token TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE si_sessions ADD COLUMN last_checkout_step TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE si_sessions ADD COLUMN last_cart_json TEXT`);
  } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN last_device_type TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN last_country_code TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN last_product_id TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN last_variant_id TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN last_campaign_json TEXT`); } catch (e) { /* column exists */ }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_sessions_store_status
    ON si_sessions(store, status)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_sessions_store_atc_at
    ON si_sessions(store, atc_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_sessions_store_purchase_at
    ON si_sessions(store, purchase_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_daily_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      top_reasons_json TEXT,
      model TEXT,
      generated_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, date)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_daily_briefs_store_date
    ON si_daily_briefs(store, date)
  `);

  console.log('✅ Session Intelligence tables ready');
}
