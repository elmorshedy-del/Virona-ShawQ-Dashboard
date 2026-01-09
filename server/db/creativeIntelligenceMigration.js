import { getDb } from './database.js';

export function runCreativeIntelligenceMigration() {
  const db = getDb();

  // Creative scripts - stores Gemini's frame-by-frame analysis
  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      ad_id TEXT NOT NULL,
      ad_name TEXT,
      campaign_id TEXT,
      campaign_name TEXT,
      video_url TEXT,
      thumbnail_url TEXT,
      duration TEXT,
      script JSON,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      analyzed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store, ad_id)
    )
  `);

  // AI settings - user preferences for Claude
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_creative_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL UNIQUE,
      model TEXT DEFAULT 'sonnet-4.5',
      streaming INTEGER DEFAULT 1,
      tone TEXT DEFAULT 'balanced',
      custom_prompt TEXT,
      capabilities JSON DEFAULT '{"analyze":true,"clone":true,"ideate":true,"audit":true}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Creative chat conversations (separate from main AI chat)
  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store TEXT NOT NULL,
      ad_id TEXT,
      title TEXT DEFAULT 'New Analysis',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES creative_conversations(id) ON DELETE CASCADE
    )
  `);

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_creative_scripts_store_ad ON creative_scripts(store, ad_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_creative_scripts_status ON creative_scripts(store, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_creative_conversations_store ON creative_conversations(store)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_creative_messages_conversation ON creative_messages(conversation_id)`);

  console.log('✅ Creative Intelligence tables ready');
}
