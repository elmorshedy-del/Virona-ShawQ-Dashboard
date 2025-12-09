import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db = null;

export function initDb() {
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/dashboard.db');

  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  import('fs').then(fs => {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Meta daily metrics - with store column and breakdown fields
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      date TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      country TEXT DEFAULT 'ALL',
      age TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      publisher_platform TEXT DEFAULT '',
      platform_position TEXT DEFAULT '',
      spend REAL DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      landing_page_views INTEGER DEFAULT 0,
      add_to_cart INTEGER DEFAULT 0,
      checkouts_initiated INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      conversion_value REAL DEFAULT 0,
      cpm REAL DEFAULT 0,
      cpc REAL DEFAULT 0,
      ctr REAL DEFAULT 0,
      frequency REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, date, campaign_id, country, age, gender, publisher_platform, platform_position)
    )
  `);

  // Add columns if they don't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN age TEXT DEFAULT ''`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN gender TEXT DEFAULT ''`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN publisher_platform TEXT DEFAULT ''`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN platform_position TEXT DEFAULT ''`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE salla_orders ADD COLUMN city TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE salla_orders ADD COLUMN state TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_orders ADD COLUMN city TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_orders ADD COLUMN state TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_orders ADD COLUMN order_created_at TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN is_read INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }

  // Salla orders (VironaX only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS salla_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      order_id TEXT UNIQUE,
      date TEXT NOT NULL,
      country TEXT,
      country_code TEXT,
      city TEXT,
      state TEXT,
      order_total REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      shipping REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      items_count INTEGER DEFAULT 1,
      status TEXT,
      payment_method TEXT,
      currency TEXT DEFAULT 'SAR',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Shopify orders (Shawq only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopify_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'shawq',
      order_id TEXT,
      date TEXT NOT NULL,
      country TEXT,
      country_code TEXT,
      city TEXT,
      state TEXT,
      order_total REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      shipping REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      items_count INTEGER DEFAULT 1,
      status TEXT,
      financial_status TEXT,
      fulfillment_status TEXT,
      payment_method TEXT,
      currency TEXT DEFAULT 'USD',
      order_created_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, order_id)
    )
  `);

  // Manual orders - with store column
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      date TEXT NOT NULL,
      country TEXT NOT NULL,
      campaign TEXT,
      spend REAL DEFAULT 0,
      orders_count INTEGER DEFAULT 1,
      revenue REAL DEFAULT 0,
      source TEXT DEFAULT 'whatsapp',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.exec(`ALTER TABLE manual_orders ADD COLUMN spend REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }

  // Manual spend overrides (per store/date/country)
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_spend_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      date TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'ALL',
      amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, date, country)
    )
  `);

  // Sync log
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      records_synced INTEGER DEFAULT 0,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Meta ad set metrics - hierarchical level under campaigns
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_adset_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      date TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      adset_id TEXT NOT NULL,
      adset_name TEXT NOT NULL,
      country TEXT DEFAULT 'ALL',
      age TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      publisher_platform TEXT DEFAULT '',
      platform_position TEXT DEFAULT '',
      spend REAL DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      landing_page_views INTEGER DEFAULT 0,
      add_to_cart INTEGER DEFAULT 0,
      checkouts_initiated INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      conversion_value REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, date, adset_id, country, age, gender, publisher_platform, platform_position)
    )
  `);

  // Meta ad metrics - hierarchical level under ad sets
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_ad_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      date TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      adset_id TEXT NOT NULL,
      adset_name TEXT NOT NULL,
      ad_id TEXT NOT NULL,
      ad_name TEXT NOT NULL,
      country TEXT DEFAULT 'ALL',
      age TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      publisher_platform TEXT DEFAULT '',
      platform_position TEXT DEFAULT '',
      spend REAL DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      landing_page_views INTEGER DEFAULT 0,
      add_to_cart INTEGER DEFAULT 0,
      checkouts_initiated INTEGER DEFAULT 0,
      conversions INTEGER DEFAULT 0,
      conversion_value REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, date, ad_id, country, age, gender, publisher_platform, platform_position)
    )
  `);

  // Exchange rates cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(from_currency, to_currency, date)
    )
  `);

  // Notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT,
      type TEXT,
      message TEXT,
      metadata TEXT,
      source TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      read INTEGER DEFAULT 0
    )
  `);

  // ============================================================================
  // META OBJECTS TABLE - Stores campaign/adset/ad metadata with status info
  // This table tracks ALL objects (active AND inactive) for AI reactivation analysis
  // ============================================================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      object_name TEXT NOT NULL,
      parent_id TEXT,
      parent_name TEXT,
      grandparent_id TEXT,
      grandparent_name TEXT,
      status TEXT DEFAULT 'UNKNOWN',
      effective_status TEXT DEFAULT 'UNKNOWN',
      created_time TEXT,
      start_time TEXT,
      stop_time TEXT,
      daily_budget REAL,
      lifetime_budget REAL,
      objective TEXT,
      optimization_goal TEXT,
      bid_strategy TEXT,
      last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, object_type, object_id)
    )
  `);

  // Meta backfill metadata - tracks historical sync progress per store
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_backfill_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      earliest_successful_date TEXT,
      latest_successful_date TEXT,
      last_backfill_attempt TEXT,
      backfill_status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store)
    )
  `);

  // Add status columns to meta_daily_metrics if they don't exist
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN effective_status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }

  // Add status columns to meta_adset_metrics if they don't exist
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN effective_status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN adset_status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN adset_effective_status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }

  // Add status columns to meta_ad_metrics if they don't exist
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN effective_status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN ad_status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN ad_effective_status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }

  // Create indexes for performance
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_store_date ON meta_daily_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_adset_store_date ON meta_adset_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_ad_store_date ON meta_ad_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_salla_store_date ON salla_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shopify_store_date ON shopify_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_store_date ON manual_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_spend_store_date ON manual_spend_overrides(store, date)`);

  // New indexes for status filtering
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_objects_store_type ON meta_objects(store, object_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_objects_effective_status ON meta_objects(store, effective_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_daily_effective_status ON meta_daily_metrics(store, effective_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_adset_effective_status ON meta_adset_metrics(store, effective_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_ad_effective_status ON meta_ad_metrics(store, effective_status)`);

  // AI Conversations tables for chat history
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      title TEXT DEFAULT 'New Chat',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      mode TEXT,
      depth TEXT,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_conversations_store ON ai_conversations(store)`);

  console.log('✅ Database initialized');
  return db;
}

export function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}
