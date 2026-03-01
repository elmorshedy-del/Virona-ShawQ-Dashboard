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
    CREATE TABLE IF NOT EXISTS si_shoppers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      client_id TEXT NOT NULL,
      shopper_number INTEGER NOT NULL,
      first_seen_at TEXT,
      last_seen_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, client_id),
      UNIQUE(store, shopper_number)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_shoppers_store_last_seen
    ON si_shoppers(store, last_seen_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      session_id TEXT NOT NULL,
      client_id TEXT,
      shopper_number INTEGER,
      source TEXT,
      event_name TEXT NOT NULL,
      event_ts TEXT NOT NULL,
      page_url TEXT,
      page_path TEXT,
      checkout_token TEXT,
      checkout_step TEXT,
      device_type TEXT,
      device_os TEXT,
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
  try { db.exec(`ALTER TABLE si_events ADD COLUMN shopper_number INTEGER`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN device_type TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_events ADD COLUMN device_os TEXT`); } catch (e) { /* column exists */ }
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
    CREATE INDEX IF NOT EXISTS idx_si_events_store_event_ts
    ON si_events(store, event_ts)
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
      session_number INTEGER,
      client_id TEXT,
      started_at TEXT,
      last_event_at TEXT,
      entry_event_ts TEXT,
      entry_event_name TEXT,
      entry_page_url TEXT,
      entry_page_path TEXT,
      entry_utm_source TEXT,
      entry_utm_medium TEXT,
      entry_utm_campaign TEXT,
      atc_at TEXT,
      checkout_started_at TEXT,
      purchase_at TEXT,
      last_checkout_token TEXT,
      last_checkout_step TEXT,
      last_cart_json TEXT,
      shopper_number INTEGER,
      last_device_type TEXT,
      last_device_os TEXT,
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

  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN session_number INTEGER`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN entry_event_ts TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN entry_event_name TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN entry_page_url TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN entry_page_path TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN entry_utm_source TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN entry_utm_medium TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN entry_utm_campaign TEXT`); } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE si_sessions ADD COLUMN last_checkout_token TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE si_sessions ADD COLUMN last_checkout_step TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE si_sessions ADD COLUMN last_cart_json TEXT`);
  } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN shopper_number INTEGER`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN last_device_type TEXT`); } catch (e) { /* column exists */ }
  try { db.exec(`ALTER TABLE si_sessions ADD COLUMN last_device_os TEXT`); } catch (e) { /* column exists */ }
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
    CREATE INDEX IF NOT EXISTS idx_si_sessions_store_started_at
    ON si_sessions(store, started_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_sessions_store_shopper_number
    ON si_sessions(store, shopper_number)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_sessions_store_entry_path
    ON si_sessions(store, entry_page_path)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_sessions_store_checkout_token
    ON si_sessions(store, last_checkout_token)
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_si_sessions_store_session_number
    ON si_sessions(store, session_number)
    WHERE session_number IS NOT NULL
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_store_counters (
      store TEXT PRIMARY KEY,
      next_session_number INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_issue_clusters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      normalized_page TEXT NOT NULL,
      normalized_signature TEXT NOT NULL,
      first_seen_date TEXT NOT NULL,
      last_seen_date TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'observed',
      lifecycle_updated_at TEXT,
      last_mode TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, issue_key)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_issue_clusters_store_state
    ON si_issue_clusters(store, lifecycle_state, last_seen_date)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_issue_clusters_store_last_seen
    ON si_issue_clusters(store, last_seen_date, last_seen_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_issue_daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      date TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'high_intent_no_purchase',
      issue_key TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      normalized_page TEXT NOT NULL,
      normalized_signature TEXT NOT NULL,
      sessions_affected INTEGER NOT NULL DEFAULT 0,
      events_count INTEGER NOT NULL DEFAULT 0,
      high_intent_rate REAL,
      impact_score REAL,
      status_at_snapshot TEXT NOT NULL DEFAULT 'observed',
      sample_sessions_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, date, mode, issue_key)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_issue_daily_stats_store_date_mode
    ON si_issue_daily_stats(store, date, mode)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_issue_daily_stats_store_issue_date
    ON si_issue_daily_stats(store, issue_key, date)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_issue_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      status TEXT NOT NULL,
      method TEXT,
      reason TEXT,
      evidence_json TEXT,
      verified_by TEXT,
      verified_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_issue_verifications_store_issue_time
    ON si_issue_verifications(store, issue_key, verified_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_investigation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      issue_key TEXT,
      job_type TEXT NOT NULL DEFAULT 'verify_issue',
      status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER NOT NULL DEFAULT 100,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT,
      payload_json TEXT,
      result_json TEXT,
      error_text TEXT,
      requested_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_investigation_jobs_store_status
    ON si_investigation_jobs(store, status, requested_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_checkout_session_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      checkout_token TEXT NOT NULL,
      session_id TEXT NOT NULL,
      client_id TEXT,
      first_seen_at TEXT,
      last_seen_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, checkout_token)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_checkout_links_store_session
    ON si_checkout_session_links(store, session_id, last_seen_at)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS si_clarity_issue_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      date TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      page TEXT,
      target_key TEXT,
      error_signature TEXT,
      status TEXT NOT NULL DEFAULT 'unverified',
      confidence REAL DEFAULT 0,
      reason TEXT,
      evidence_json TEXT,
      last_verified_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, date, issue_key)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_si_clarity_issue_verifications_scope
    ON si_clarity_issue_verifications(store, date, status, expires_at)
  `);

  // Backfill session_number for existing sessions (per-store sequential IDs).
  // Also initialize/update store counters so new sessions keep incrementing correctly.
  try {
    const stores = db.prepare(`
      SELECT DISTINCT store
      FROM si_sessions
      WHERE store IS NOT NULL AND store != ''
    `).all().map((row) => row.store).filter(Boolean);

    const selectMax = db.prepare(`
      SELECT COALESCE(MAX(session_number), 0) AS max
      FROM si_sessions
      WHERE store = ?
    `);

    const selectMissing = db.prepare(`
      SELECT session_id
      FROM si_sessions
      WHERE store = ? AND session_number IS NULL
      ORDER BY COALESCE(started_at, created_at), id
    `);

    const updateSession = db.prepare(`
      UPDATE si_sessions
      SET session_number = ?
      WHERE store = ? AND session_id = ? AND session_number IS NULL
    `);

    const upsertCounter = db.prepare(`
      INSERT INTO si_store_counters (store, next_session_number, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(store) DO UPDATE SET
        next_session_number = excluded.next_session_number,
        updated_at = excluded.updated_at
    `);

    for (const store of stores) {
      let next = (Number(selectMax.get(store)?.max) || 0) + 1;
      const missing = selectMissing.all(store);
      for (const row of missing) {
        if (!row?.session_id) continue;
        updateSession.run(next, store, row.session_id);
        next += 1;
      }
      upsertCounter.run(store, next);
    }
  } catch (e) {
    // Don't block server boot if backfill fails (e.g. read-only DB).
    console.warn('[SessionIntelligenceMigration] session_number backfill skipped:', e?.message || e);
  }

  console.log('✅ Session Intelligence tables ready');
}
