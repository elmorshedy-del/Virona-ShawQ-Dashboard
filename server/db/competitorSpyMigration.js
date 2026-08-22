// server/db/competitorSpyMigration.js
// Competitor Spy Database Migration - Apify-powered

import { getDb } from './database.js';

export function runMigration() {
  const db = getDb();

  // competitor_ads - Main storage for scraped ads
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitor_ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id TEXT UNIQUE NOT NULL,
      page_id TEXT,
      page_name TEXT,
      page_profile_picture_url TEXT,
      ad_copy TEXT,
      headline TEXT,
      description TEXT,
      cta_text TEXT,
      cta_link TEXT,
      original_image_url TEXT,
      original_video_url TEXT,
      cloudinary_image_url TEXT,
      cloudinary_video_url TEXT,
      cloudinary_thumbnail_url TEXT,
      media_type TEXT DEFAULT 'image',
      platforms TEXT DEFAULT '[]',
      countries TEXT DEFAULT '[]',
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER DEFAULT 1,
      impressions_lower INTEGER,
      impressions_upper INTEGER,
      spend_lower REAL,
      spend_upper REAL,
      currency TEXT DEFAULT 'USD',
      demographic_distribution TEXT,
      region_distribution TEXT,
      analysis TEXT,
      analyzed_at TEXT,
      raw_data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // competitor_brand_cache - 24-hour caching per brand/country
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitor_brand_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      country TEXT DEFAULT 'ALL',
      ad_ids TEXT DEFAULT '[]',
      total_results INTEGER DEFAULT 0,
      last_fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, brand_name, country)
    )
  `);

  // competitor_swipe_files - User-created boards
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitor_swipe_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT '📁',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // competitor_saved_ads - Junction table for swipe files
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitor_saved_ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      swipe_file_id INTEGER NOT NULL,
      ad_id TEXT NOT NULL,
      notes TEXT,
      tags TEXT DEFAULT '[]',
      saved_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (swipe_file_id) REFERENCES competitor_swipe_files(id) ON DELETE CASCADE,
      FOREIGN KEY (ad_id) REFERENCES competitor_ads(ad_id) ON DELETE CASCADE,
      UNIQUE(swipe_file_id, ad_id)
    )
  `);

  // competitor_tracked_brands - Auto-tracking competitors
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitor_tracked_brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      page_id TEXT,
      country TEXT DEFAULT 'ALL',
      check_frequency TEXT DEFAULT 'daily',
      last_checked_at TEXT,
      total_ads_found INTEGER DEFAULT 0,
      new_ads_since_last_check INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      tracking_started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, brand_name, country)
    )
  `);

  // user_onboarding - Track dismissed tips/modals
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_onboarding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      feature TEXT NOT NULL,
      element TEXT NOT NULL,
      dismissed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(store, feature, element)
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_competitor_ads_page_name ON competitor_ads(page_name);
    CREATE INDEX IF NOT EXISTS idx_competitor_ads_is_active ON competitor_ads(is_active);
    CREATE INDEX IF NOT EXISTS idx_competitor_ads_start_date ON competitor_ads(start_date);
    CREATE INDEX IF NOT EXISTS idx_competitor_brand_cache_lookup ON competitor_brand_cache(store, brand_name, country);
    CREATE INDEX IF NOT EXISTS idx_competitor_brand_cache_expires ON competitor_brand_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_competitor_swipe_files_store ON competitor_swipe_files(store);
    CREATE INDEX IF NOT EXISTS idx_competitor_saved_ads_swipe_file ON competitor_saved_ads(swipe_file_id);
    CREATE INDEX IF NOT EXISTS idx_competitor_saved_ads_ad ON competitor_saved_ads(ad_id);
    CREATE INDEX IF NOT EXISTS idx_competitor_tracked_brands_store ON competitor_tracked_brands(store);
    CREATE INDEX IF NOT EXISTS idx_user_onboarding_lookup ON user_onboarding(store, feature, element);
  `);

  console.log('✅ Competitor Spy tables ready');
}

// Helper functions for cache management
export function isBrandCacheValid(store, brandName, country = 'ALL') {
  const db = getDb();
  const cache = db.prepare(`
    SELECT * FROM competitor_brand_cache 
    WHERE store = ? AND brand_name = ? AND country = ?
    AND datetime(expires_at) > datetime('now')
  `).get(store, brandName, country);
  return cache || null;
}

export function getBrandCacheExpiry(store, brandName, country = 'ALL') {
  const db = getDb();
  const cache = db.prepare(`
    SELECT expires_at, last_fetched_at FROM competitor_brand_cache 
    WHERE store = ? AND brand_name = ? AND country = ?
  `).get(store, brandName, country);
  
  if (!cache) return null;
  
  const expiresAt = new Date(cache.expires_at);
  const now = new Date();
  const hoursRemaining = (expiresAt - now) / (1000 * 60 * 60);
  
  return {
    expires_at: cache.expires_at,
    last_fetched_at: cache.last_fetched_at,
    hours_remaining: Math.max(0, hoursRemaining),
    is_valid: hoursRemaining > 0
  };
}

export function updateBrandCache(store, brandName, country, adIds) {
  const db = getDb();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  
  db.prepare(`
    INSERT INTO competitor_brand_cache (store, brand_name, country, ad_ids, total_results, last_fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, brand_name, country) DO UPDATE SET
      ad_ids = excluded.ad_ids,
      total_results = excluded.total_results,
      last_fetched_at = excluded.last_fetched_at,
      expires_at = excluded.expires_at
  `).run(store, brandName, country, JSON.stringify(adIds), adIds.length, now, expiresAt);
}

export function getCachedAdIds(store, brandName, country = 'ALL') {
  const cache = isBrandCacheValid(store, brandName, country);
  if (!cache) return null;
  return JSON.parse(cache.ad_ids || '[]');
}
