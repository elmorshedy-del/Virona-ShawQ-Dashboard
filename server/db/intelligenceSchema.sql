-- CAMPAIGN INTELLIGENCE TABLES
-- ============================================

-- 1. Geo Benchmarks (learned from your data)
CREATE TABLE IF NOT EXISTS geo_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  geo TEXT NOT NULL,
  store TEXT NOT NULL,
  
  ctr_avg REAL,
  ctr_min REAL,
  ctr_max REAL,
  
  atc_rate_avg REAL,
  atc_rate_min REAL,
  atc_rate_max REAL,
  
  ic_rate_avg REAL,
  ic_rate_min REAL,
  ic_rate_max REAL,
  
  cvr_avg REAL,
  cvr_min REAL,
  cvr_max REAL,
  
  cac_avg REAL,
  cac_min REAL,
  cac_max REAL,
  
  cpm_avg REAL,
  roas_avg REAL,
  
  campaigns_count INTEGER DEFAULT 0,
  purchases_total INTEGER DEFAULT 0,
  
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(geo, store)
);

-- 2. Industry Defaults (fallback)
CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  geo TEXT NOT NULL,
  
  ctr_avg REAL DEFAULT 0.012,
  atc_rate_avg REAL DEFAULT 0.04,
  ic_rate_avg REAL DEFAULT 0.55,
  cvr_avg REAL DEFAULT 0.025,
  cpm_avg REAL,
  
  UNIQUE(geo)
);

INSERT OR IGNORE INTO industry_benchmarks (geo, ctr_avg, atc_rate_avg, ic_rate_avg, cvr_avg, cpm_avg) VALUES
  ('GLOBAL', 0.012, 0.04, 0.55, 0.025, 20),
  ('SA', 0.012, 0.04, 0.55, 0.025, 20),
  ('KW', 0.011, 0.038, 0.52, 0.022, 28),
  ('UAE', 0.011, 0.04, 0.54, 0.023, 32),
  ('QA', 0.011, 0.038, 0.52, 0.022, 28),
  ('BH', 0.012, 0.04, 0.55, 0.025, 20),
  ('OM', 0.013, 0.042, 0.56, 0.026, 15);

-- 3. Campaign Analysis Cache
CREATE TABLE IF NOT EXISTS campaign_intelligence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  store TEXT NOT NULL,
  
  status TEXT,
  days_running INTEGER,
  total_purchases INTEGER,
  total_spend REAL,
  
  ctr REAL,
  atc_rate REAL,
  ic_rate REAL,
  cvr REAL,
  cac REAL,
  roas REAL,
  
  funnel_health TEXT,
  recommendation TEXT,
  recommendation_reason TEXT,
  
  current_daily_spend REAL,
  optimal_daily_spend REAL,
  saturation_daily_spend REAL,
  headroom_percent REAL,
  
  confidence TEXT,
  
  calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(campaign_id, store)
);

-- 4. Creative Tags (Gemini analysis)
CREATE TABLE IF NOT EXISTS creative_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id TEXT NOT NULL,
  store TEXT NOT NULL,
  
  hook_type TEXT,
  visual_style TEXT,
  has_face_first_3s INTEGER,
  shows_product_at_sec REAL,
  pacing TEXT,
  has_text_overlay INTEGER,
  has_discount_mention INTEGER,
  duration_sec REAL,
  
  outcome TEXT,
  roas REAL,
  purchases INTEGER,
  
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(ad_id, store)
);

-- 5. Alerts Log
CREATE TABLE IF NOT EXISTS intelligence_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT,
  campaign_id TEXT,
  ad_id TEXT,
  geo TEXT,
  
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT,
  
  seen INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_geo_benchmarks_geo ON geo_benchmarks(geo, store);
CREATE INDEX IF NOT EXISTS idx_campaign_intelligence_campaign ON campaign_intelligence(campaign_id, store);
CREATE INDEX IF NOT EXISTS idx_creative_tags_ad ON creative_tags(ad_id, store);
CREATE INDEX IF NOT EXISTS idx_creative_tags_outcome ON creative_tags(outcome);
CREATE INDEX IF NOT EXISTS idx_alerts_store_seen ON intelligence_alerts(store, seen, created_at);
