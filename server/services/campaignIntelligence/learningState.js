import { getDb } from '../../db/database.js';

function safeParseState(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

export function loadLearningState({ store, scopeKey }) {
  if (!store || !scopeKey) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT state_json
    FROM campaign_intelligence_learning_state
    WHERE store = ? AND scope_key = ?
    LIMIT 1
  `).get(store, scopeKey);

  return safeParseState(row?.state_json);
}

export function saveLearningState({ store, scopeKey, state }) {
  if (!store || !scopeKey || !state || typeof state !== 'object') return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO campaign_intelligence_learning_state (store, scope_key, state_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(store, scope_key)
    DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(store, scopeKey, JSON.stringify(state), now);
}
