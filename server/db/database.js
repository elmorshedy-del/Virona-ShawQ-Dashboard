import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db = null;

export function initDb() {
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/dashboard.db');

  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

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
      outbound_clicks INTEGER DEFAULT 0,
      unique_outbound_clicks INTEGER DEFAULT 0,
      outbound_clicks_ctr REAL DEFAULT 0,
      unique_outbound_clicks_ctr REAL DEFAULT 0,
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
    db.exec(`ALTER TABLE salla_orders ADD COLUMN is_excluded INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE salla_orders ADD COLUMN exclusion_reason TEXT`);
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
    db.exec(`ALTER TABLE shopify_orders ADD COLUMN attribution_json TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_orders ADD COLUMN customer_id TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_orders ADD COLUMN customer_email TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_orders ADD COLUMN is_excluded INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_orders ADD COLUMN exclusion_reason TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_order_items ADD COLUMN net_price REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_order_items ADD COLUMN is_excluded INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE shopify_order_items ADD COLUMN exclusion_reason TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`
      UPDATE shopify_order_items
      SET net_price = (COALESCE(quantity, 1) * COALESCE(price, 0) - COALESCE(discount, 0))
      WHERE net_price IS NULL
    `);
  } catch (e) {
    console.warn('[DB] Non-blocking migration: failed to backfill shopify_order_items.net_price', e?.message || e);
  }
  try {
    db.exec(`
      UPDATE shopify_order_items
      SET is_excluded = 1,
          exclusion_reason = COALESCE(exclusion_reason, 'legacy_non_revenue_zero_net')
      WHERE COALESCE(is_excluded, 0) = 0
        AND (COALESCE(quantity, 1) * COALESCE(price, 0) - COALESCE(discount, 0)) <= 0
    `);
  } catch (e) {
    console.warn('[DB] Non-blocking migration: failed to backfill shopify_order_items.is_excluded', e?.message || e);
  }
  try {
    db.exec(`
      UPDATE shopify_orders
      SET is_excluded = 1,
          exclusion_reason = COALESCE(exclusion_reason, 'legacy_non_revenue_non_positive_total')
      WHERE COALESCE(is_excluded, 0) = 0
        AND COALESCE(order_total, 0) <= 0
        AND COALESCE(subtotal, 0) <= 0
    `);
  } catch (e) {
    console.warn('[DB] Non-blocking migration: failed to backfill shopify_orders.is_excluded', e?.message || e);
  }
  // Notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      country TEXT,
      value REAL,
      order_count INTEGER DEFAULT 1,
      is_read INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT (datetime('now')),
      metadata TEXT,
      event_key TEXT
    )
  `);

  // Backfill missing notification columns for existing databases
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN country TEXT`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN value REAL`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN order_count INTEGER DEFAULT 1`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN is_read INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN timestamp TEXT DEFAULT (datetime('now'))`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE notifications ADD COLUMN event_key TEXT`);
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
      is_excluded INTEGER DEFAULT 0,
      exclusion_reason TEXT,
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
      attribution_json TEXT,
      customer_id TEXT,
      customer_email TEXT,
      is_excluded INTEGER DEFAULT 0,
      exclusion_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, order_id)
    )
  `);

  
  // Shopify order items (line items)
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopify_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'shawq',
      order_id TEXT NOT NULL,
      line_item_id TEXT,
      product_id TEXT,
      variant_id TEXT,
      sku TEXT,
      title TEXT,
      image_url TEXT,
      quantity INTEGER DEFAULT 1,
      price REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      net_price REAL DEFAULT 0,
      is_excluded INTEGER DEFAULT 0,
      exclusion_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, order_id, line_item_id)
    )
  `);

  // Ensure the schema uses a stable unique key (Shopify line_item_id).
  try {
    const columns = db
      .prepare("PRAGMA table_info('shopify_order_items')")
      .all()
      .map((col) => col.name);

    const hasLineItemId = columns.includes('line_item_id');

    const desiredUniqueColumns = ['store', 'order_id', 'line_item_id'];
    const indexList = db.prepare("PRAGMA index_list('shopify_order_items')").all();
    const uniqueIndexes = indexList.filter((idx) => idx.unique);

    const hasDesiredUnique = uniqueIndexes.some((idx) => {
      const cols = db
        .prepare(`PRAGMA index_info('${idx.name}')`)
        .all()
        .map((col) => col.name);
      return (
        cols.length === desiredUniqueColumns.length &&
        cols.every((col, i) => col === desiredUniqueColumns[i])
      );
    });

    if (!hasLineItemId || !hasDesiredUnique) {
      const backupTable = `shopify_order_items_backup_${Date.now()}`;

      db.exec('BEGIN');

      db.exec(`ALTER TABLE shopify_order_items RENAME TO "${backupTable}"`);

      db.exec(`
        CREATE TABLE shopify_order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          store TEXT NOT NULL DEFAULT 'shawq',
          order_id TEXT NOT NULL,
          line_item_id TEXT,
          product_id TEXT,
          variant_id TEXT,
          sku TEXT,
          title TEXT,
          image_url TEXT,
          quantity INTEGER DEFAULT 1,
          price REAL DEFAULT 0,
          discount REAL DEFAULT 0,
          net_price REAL DEFAULT 0,
          is_excluded INTEGER DEFAULT 0,
          exclusion_reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(store, order_id, line_item_id)
        )
      `);

      const lineItemSelect = hasLineItemId ? 'line_item_id' : 'NULL AS line_item_id';
      const imageUrlSelect = columns.includes('image_url') ? 'image_url' : 'NULL AS image_url';
      const netPriceSelect = columns.includes('net_price')
        ? 'net_price'
        : '(COALESCE(quantity, 1) * COALESCE(price, 0) - COALESCE(discount, 0)) AS net_price';
      const itemExcludedSelect = columns.includes('is_excluded') ? 'is_excluded' : '0 AS is_excluded';
      const itemExclusionReasonSelect = columns.includes('exclusion_reason')
        ? 'exclusion_reason'
        : 'NULL AS exclusion_reason';

      db.exec(`
        INSERT INTO shopify_order_items
          (store, order_id, line_item_id, product_id, variant_id, sku, title, image_url, quantity, price, discount, net_price, is_excluded, exclusion_reason, created_at)
        SELECT
          store,
          order_id,
          ${lineItemSelect},
          product_id,
          variant_id,
          sku,
          title,
          ${imageUrlSelect},
          quantity,
          price,
          discount,
          ${netPriceSelect},
          ${itemExcludedSelect},
          ${itemExclusionReasonSelect},
          created_at
        FROM "${backupTable}"
      `);

      db.exec(`DROP TABLE "${backupTable}"`);

      db.exec('COMMIT');
    }
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {
      /* noop */
    }
  }

  try {
    db.exec(`ALTER TABLE shopify_order_items ADD COLUMN image_url TEXT`);
  } catch (e) { /* column exists */ }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shopify_order_items_order
    ON shopify_order_items(store, order_id)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shopify_order_items_product
    ON shopify_order_items(store, product_id)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS shopify_products_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'shawq',
      product_id TEXT NOT NULL,
      title TEXT,
      image_url TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, product_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shopify_products_cache_store_product
    ON shopify_products_cache(store, product_id)
  `);

// Shopify pixel events (session-level / live behavior)
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopify_pixel_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL DEFAULT 'shawq',
      event_type TEXT NOT NULL,
      event_ts TEXT NOT NULL,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_shopify_pixel_events_store_created_at
    ON shopify_pixel_events(store, created_at)
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
      outbound_clicks INTEGER DEFAULT 0,
      unique_outbound_clicks INTEGER DEFAULT 0,
      outbound_clicks_ctr REAL DEFAULT 0,
      unique_outbound_clicks_ctr REAL DEFAULT 0,
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
      outbound_clicks INTEGER DEFAULT 0,
      unique_outbound_clicks INTEGER DEFAULT 0,
      outbound_clicks_ctr REAL DEFAULT 0,
      unique_outbound_clicks_ctr REAL DEFAULT 0,
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
      source TEXT NOT NULL DEFAULT 'unknown',
      fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(from_currency, to_currency, date)
    )
  `);

  try {
    db.exec("ALTER TABLE exchange_rates ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'");
  } catch (e) { /* column exists */ }

  try {
    db.exec('ALTER TABLE exchange_rates ADD COLUMN fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  } catch (e) { /* column exists */ }

  // Exchange rate API usage log (tracks actual external calls; not number of rows inserted)
  db.exec(`
    CREATE TABLE IF NOT EXISTS exchange_rate_api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      date TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL,
      http_status INTEGER,
      error_code TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Meta OAuth tokens - stores encrypted user access token for Ad Library
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_auth_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token_encrypted TEXT,
      access_token_iv TEXT,
      access_token_tag TEXT,
      is_encrypted INTEGER DEFAULT 0,
      token_type TEXT,
      scopes TEXT,
      expires_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_api_status TEXT,
      last_api_error TEXT,
      last_api_at TEXT,
      last_fbtrace_id TEXT
    )
  `);

  // OAuth state storage for CSRF protection
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta_oauth_states (
      state TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      return_to TEXT
    )
  `);

  // Shopify OAuth tokens
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopify_auth_tokens (
      shop TEXT PRIMARY KEY,
      access_token_encrypted TEXT,
      access_token_iv TEXT,
      access_token_tag TEXT,
      is_encrypted INTEGER DEFAULT 0,
      scopes TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  // Shopify OAuth state storage
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopify_oauth_states (
      state TEXT PRIMARY KEY,
      shop TEXT NOT NULL,
      created_at TEXT NOT NULL,
      return_to TEXT
    )
  `);

  // Add status columns to meta_daily_metrics if they don't exist
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN effective_status TEXT DEFAULT 'UNKNOWN'`);
  } catch (e) { /* column exists */ }

  // Add inline_link_clicks and cost_per_inline_link_click columns for Meta Link Clicks metric
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN inline_link_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN cost_per_inline_link_click REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN outbound_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN unique_outbound_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN outbound_clicks_ctr REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_daily_metrics ADD COLUMN unique_outbound_clicks_ctr REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }

  // Add original currency columns to meta_daily_metrics
  try {
    db.exec('ALTER TABLE meta_daily_metrics ADD COLUMN spend_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_daily_metrics ADD COLUMN conversion_value_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_daily_metrics ADD COLUMN cost_per_inline_link_click_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_daily_metrics ADD COLUMN original_currency TEXT DEFAULT "USD"');
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

  // Add inline_link_clicks and cost_per_inline_link_click columns for adset metrics
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN inline_link_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN cost_per_inline_link_click REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN outbound_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN unique_outbound_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN outbound_clicks_ctr REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_adset_metrics ADD COLUMN unique_outbound_clicks_ctr REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }

  // Add original currency columns to meta_adset_metrics
  try {
    db.exec('ALTER TABLE meta_adset_metrics ADD COLUMN spend_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_adset_metrics ADD COLUMN conversion_value_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_adset_metrics ADD COLUMN cost_per_inline_link_click_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_adset_metrics ADD COLUMN original_currency TEXT DEFAULT "USD"');
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

  // Add inline_link_clicks and cost_per_inline_link_click columns for ad metrics
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN inline_link_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN cost_per_inline_link_click REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN outbound_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN unique_outbound_clicks INTEGER DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN outbound_clicks_ctr REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }
  try {
    db.exec(`ALTER TABLE meta_ad_metrics ADD COLUMN unique_outbound_clicks_ctr REAL DEFAULT 0`);
  } catch (e) { /* column exists */ }

  // Add original currency columns to meta_ad_metrics
  try {
    db.exec('ALTER TABLE meta_ad_metrics ADD COLUMN spend_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_ad_metrics ADD COLUMN conversion_value_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_ad_metrics ADD COLUMN cost_per_inline_link_click_original REAL');
  } catch (e) { /* column exists */ }
  try {
    db.exec('ALTER TABLE meta_ad_metrics ADD COLUMN original_currency TEXT DEFAULT "USD"');
  } catch (e) { /* column exists */ }

  // Create indexes for performance
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_store_date ON meta_daily_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_adset_store_date ON meta_adset_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_meta_ad_store_date ON meta_ad_metrics(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_salla_store_date ON salla_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shopify_store_date ON shopify_orders(store, date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shopify_store_date_excluded ON shopify_orders(store, date, is_excluded)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_shopify_items_store_order_excluded ON shopify_order_items(store, order_id, is_excluded)`);
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_funnel_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      mode TEXT NOT NULL,
      prompt TEXT NOT NULL,
      verbosity TEXT NOT NULL DEFAULT 'low',
      content TEXT NOT NULL,
      model TEXT,
      start_date TEXT,
      end_date TEXT,
      source TEXT DEFAULT 'manual',
      period TEXT DEFAULT 'custom',
      generated_at TEXT DEFAULT (datetime('now')),
      dismissed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_funnel_summary_settings (
      store TEXT PRIMARY KEY,
      auto_enabled INTEGER DEFAULT 1,
      analyze_prompt TEXT,
      summarize_prompt TEXT,
      analyze_verbosity TEXT DEFAULT 'low',
      summarize_verbosity TEXT DEFAULT 'low',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  console.log('✅ Database initialized');
  return db;
}

export function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}
