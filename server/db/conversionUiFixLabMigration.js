import { getDb } from './database.js';

export function runConversionUiFixLabMigration() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversion_ui_fix_lab_sessions (
      session_id TEXT PRIMARY KEY,
      store TEXT NOT NULL,
      root_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      request_json TEXT,
      report_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cufl_sessions_store_created
      ON conversion_ui_fix_lab_sessions(store, created_at DESC);

    CREATE TABLE IF NOT EXISTS conversion_ui_fix_lab_fix_states (
      session_id TEXT NOT NULL,
      fix_id TEXT NOT NULL,
      state TEXT NOT NULL,
      note TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (session_id, fix_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cufl_fix_states_session
      ON conversion_ui_fix_lab_fix_states(session_id, updated_at DESC);
  `);

  return { success: true };
}

export default {
  runConversionUiFixLabMigration
};
