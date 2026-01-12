// server/db/creativeStudioMigration.js
import { getDb } from './database.js';

export function runMigration() {
  const db = getDb();
  console.log('Running Creative Studio migration...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_creatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT CHECK(type IN ('post', 'story', 'landscape', 'banner')),
      layout TEXT CHECK(layout IN ('centered', 'split', 'framed')),
      content JSON,
      style JSON,
      thumbnail_url TEXT,
      image_url TEXT,
      product_id TEXT,
      source TEXT CHECK(source IN ('manual', 'ai', 'competitor')) DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      style JSON NOT NULL,
      layout TEXT,
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS competitor_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name TEXT,
      source_url TEXT,
      source_type TEXT CHECK(source_type IN ('ad_library', 'screenshot', 'url')),
      creative_url TEXT,
      analysis JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS generated_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT CHECK(type IN ('hook', 'script', 'brief', 'localization')),
      input JSON,
      output TEXT,
      product_id TEXT,
      model_used TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_fatigue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ad_id TEXT NOT NULL,
      ad_name TEXT,
      creative_url TEXT,
      fatigue_score REAL,
      ctr_baseline REAL,
      ctr_current REAL,
      ctr_decline_pct REAL,
      frequency REAL,
      days_running INTEGER,
      status TEXT CHECK(status IN ('healthy', 'warning', 'fatigued', 'dead')),
      recommendation TEXT,
      calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS account_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_date DATE,
      health_score REAL,
      status TEXT,
      issues JSON,
      recommendations JSON,
      metrics JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_studio_creatives_type ON studio_creatives(type);
    CREATE INDEX IF NOT EXISTS idx_competitor_analyses_brand ON competitor_analyses(brand_name);
    CREATE INDEX IF NOT EXISTS idx_generated_content_type ON generated_content(type);
    CREATE INDEX IF NOT EXISTS idx_creative_fatigue_status ON creative_fatigue(status);
    CREATE INDEX IF NOT EXISTS idx_creative_fatigue_ad_id ON creative_fatigue(ad_id);
  `);

  console.log('✅ Creative Studio tables ready');
}
