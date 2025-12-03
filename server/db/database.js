import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db = null;

export function initDb() {
  // Avoid re-initializing if already done
  if (db) return db;

  const dbPath =
    process.env.DATABASE_PATH ||
    path.join(__dirname, '../../data/dashboard.db');

  // ✅ Ensure data directory exists *synchronously* before opening DB
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Open SQLite database
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Meta daily metrics - with store column
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      date TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      campaign_name TEXT NOT NULL,
      country TEXT DEFAULT 'ALL',
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
      UNIQUE(store, date, campaign_id, country)
    )
  `);

  // Salla orders (VironaX only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS salla_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'vironax',
      order_id TEXT UNIQUE,
      date TEXT NOT NULL,
      country TEXT,
      country_code TEXT,
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
      orders_count INTEGER DEFAULT 1,
      revenue REAL DEFAULT 0,
      source TEXT DEFAULT 'whatsapp',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_store_date ON meta_daily_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_salla_store_date ON salla_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shopify_store_date ON shopify_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_manual_store_date ON manual_orders(store, date)`);

  console.log(`✅ Database initialized at ${dbPath}`);
  return db;
}

export function getDb() {
  if (!db) {
    return initDb();
  }
  return db;
}
