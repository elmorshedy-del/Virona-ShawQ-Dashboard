import crypto from 'crypto';
import { getDb } from '../db/database.js';

const META_PROVIDER = 'meta';
const STATE_TTL_MS = 10 * 60 * 1000;

function getEncryptionKey() {
  const raw = process.env.META_OAUTH_ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptToken(token) {
  const key = getEncryptionKey();
  if (!key) {
    return `raw::${token}`;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc::${iv.toString('base64')}::${tag.toString('base64')}::${encrypted.toString('base64')}`;
}

function decryptToken(stored) {
  if (!stored) return null;
  if (stored.startsWith('raw::')) {
    return stored.slice(5);
  }
  if (!stored.startsWith('enc::')) {
    return null;
  }

  const key = getEncryptionKey();
  if (!key) return null;

  const parts = stored.split('::');
  if (parts.length !== 4) return null;

  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function getMetaAuthRecord() {
  const db = getDb();
  return db.prepare('SELECT * FROM meta_auth_tokens WHERE provider = ?').get(META_PROVIDER) || null;
}

function saveMetaAuthToken({ accessToken, tokenType, expiresIn, scopes }) {
  const db = getDb();
  const encryptedToken = encryptToken(accessToken);
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM meta_auth_tokens WHERE provider = ?').get(META_PROVIDER);
  if (existing) {
    db.prepare(`
      UPDATE meta_auth_tokens
      SET access_token = ?, token_type = ?, expires_at = ?, scopes = ?, updated_at = ?
      WHERE provider = ?
    `).run(encryptedToken, tokenType || null, expiresAt, scopes || null, now, META_PROVIDER);
    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO meta_auth_tokens (provider, access_token, token_type, expires_at, scopes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(META_PROVIDER, encryptedToken, tokenType || null, expiresAt, scopes || null, now, now);

  return result.lastInsertRowid;
}

function clearMetaAuthToken() {
  const db = getDb();
  db.prepare('DELETE FROM meta_auth_tokens WHERE provider = ?').run(META_PROVIDER);
}

function recordMetaAuthCall({ status, errorMessage, fbtraceId }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE meta_auth_tokens
    SET last_api_status = ?, last_api_at = ?, last_api_error = ?, last_fbtrace_id = ?, updated_at = ?
    WHERE provider = ?
  `).run(status, now, errorMessage || null, fbtraceId || null, now, META_PROVIDER);
}

function getMetaAccessToken() {
  const record = getMetaAuthRecord();
  if (!record) return null;
  const token = decryptToken(record.access_token);
  if (!token) return null;
  if (record.expires_at && new Date(record.expires_at) <= new Date()) {
    return null;
  }
  return token;
}

function getMetaAuthStatus() {
  const record = getMetaAuthRecord();
  if (!record) {
    return { connected: false };
  }

  const token = decryptToken(record.access_token);
  const expiresAt = record.expires_at || null;
  const expired = expiresAt ? new Date(expiresAt) <= new Date() : false;
  const connected = Boolean(token) && !expired;

  return {
    connected,
    expired,
    access_token: token,
    token_type: record.token_type || null,
    expires_at: expiresAt,
    scopes: record.scopes || null,
    last_api_status: record.last_api_status || null,
    last_api_error: record.last_api_error || null,
    last_api_at: record.last_api_at || null,
    last_fbtrace_id: record.last_fbtrace_id || null
  };
}

function saveOAuthState(state) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO meta_oauth_states (state, created_at, used_at)
    VALUES (?, ?, NULL)
  `).run(state, new Date().toISOString());
}

function consumeOAuthState(state) {
  const db = getDb();
  const record = db.prepare(`
    SELECT state, created_at, used_at FROM meta_oauth_states WHERE state = ?
  `).get(state);

  if (!record || record.used_at) return false;
  const createdAt = new Date(record.created_at);
  if (Date.now() - createdAt.getTime() > STATE_TTL_MS) {
    return false;
  }

  db.prepare(`UPDATE meta_oauth_states SET used_at = ? WHERE state = ?`)
    .run(new Date().toISOString(), state);
  return true;
}

export {
  getMetaAccessToken,
  getMetaAuthStatus,
  saveMetaAuthToken,
  clearMetaAuthToken,
  recordMetaAuthCall,
  saveOAuthState,
  consumeOAuthState
};
