import crypto from 'crypto';
import { getDb } from '../db/database.js';

const STATE_TTL_MS = parseInt(process.env.META_OAUTH_STATE_TTL_MS || '600000', 10);

function cleanupExpiredStates(db) {
  const cutoff = new Date(Date.now() - STATE_TTL_MS).toISOString();
  db.prepare('DELETE FROM meta_oauth_states WHERE created_at < ?').run(cutoff);
}

export function createMetaOAuthState() {
  const db = getDb();
  const state = crypto.randomBytes(16).toString('hex');
  const createdAt = new Date().toISOString();

  db.prepare('INSERT INTO meta_oauth_states (state, created_at) VALUES (?, ?)').run(state, createdAt);
  cleanupExpiredStates(db);

  return state;
}

export function consumeMetaOAuthState(state) {
  if (!state) return false;
  const db = getDb();
  cleanupExpiredStates(db);

  const record = db.prepare('SELECT state, created_at FROM meta_oauth_states WHERE state = ?').get(state);
  if (!record) return false;

  const createdAt = Date.parse(record.created_at);
  const isValid = Number.isFinite(createdAt) && Date.now() - createdAt <= STATE_TTL_MS;

  db.prepare('DELETE FROM meta_oauth_states WHERE state = ?').run(state);
  return isValid;
}

export function saveMetaToken({ accessToken, tokenType, expiresIn, scope }) {
  const db = getDb();
  const expiresAt = expiresIn
    ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
    : null;

  db.prepare(`
    INSERT INTO meta_oauth_tokens (
      id, access_token, token_type, expires_at, scope,
      last_api_status, last_api_at, last_fbtrace_id,
      created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      token_type = excluded.token_type,
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = CURRENT_TIMESTAMP
  `).run(accessToken, tokenType || null, expiresAt, scope || null);

  return { expiresAt };
}

export function getMetaTokenRecord() {
  const db = getDb();
  return db.prepare('SELECT * FROM meta_oauth_tokens WHERE id = 1').get() || null;
}

export function clearMetaToken() {
  const db = getDb();
  db.prepare('DELETE FROM meta_oauth_tokens WHERE id = 1').run();
}

export function updateMetaApiStatus({ status, fbtraceId }) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM meta_oauth_tokens WHERE id = 1').get();
  if (!existing) return;

  db.prepare(`
    UPDATE meta_oauth_tokens
    SET last_api_status = ?,
        last_api_at = CURRENT_TIMESTAMP,
        last_fbtrace_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(status ?? null, fbtraceId ?? null);
}

export function getMetaAccessToken() {
  const record = getMetaTokenRecord();
  if (!record?.access_token) return { token: null, expired: false };
  if (record.expires_at) {
    const expiresAtMs = Date.parse(record.expires_at);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      return { token: null, expired: true };
    }
  }
  return { token: record.access_token, expired: false };
}

export function maskToken(token) {
  if (!token) return null;
  if (token.length <= 10) {
    return `${token.slice(0, 2)}…${token.slice(-2)}`;
  }
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
