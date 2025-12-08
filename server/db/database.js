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

  // Create indexes for performance
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_store_date ON meta_daily_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_adset_store_date ON meta_adset_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_ad_store_date ON meta_ad_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_salla_store_date ON salla_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shopify_store_date ON shopify_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_store_date ON manual_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_spend_store_date ON manual_spend_overrides(store, date)`);

  console.log('✅ Database initialized');
  return db;
}

export function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}
