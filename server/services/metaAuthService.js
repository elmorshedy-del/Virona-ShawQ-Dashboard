import crypto from 'crypto';
import { getDb } from '../db/database.js';

const STATE_TTL_MS = 15 * 60 * 1000;

function getEncryptionKey() {
  const secret = process.env.META_TOKEN_SECRET || process.env.META_APP_SECRET;
  if (!secret) {
    return null;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptToken(token) {
  const key = getEncryptionKey();
  if (!key) {
    console.warn('[MetaAuth] META_TOKEN_SECRET not set. Storing token without encryption.');
    return {
      access_token_encrypted: token,
      access_token_iv: null,
      access_token_tag: null,
      is_encrypted: 0
    };
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    access_token_encrypted: encrypted.toString('base64'),
    access_token_iv: iv.toString('base64'),
    access_token_tag: tag.toString('base64'),
    is_encrypted: 1
  };
}

function decryptToken(row) {
  if (!row) return null;
  if (!row.is_encrypted) {
    return row.access_token_encrypted;
  }

  const key = getEncryptionKey();
  if (!key) {
    console.warn('[MetaAuth] Missing META_TOKEN_SECRET. Cannot decrypt stored token.');
    return null;
  }

  const iv = Buffer.from(row.access_token_iv, 'base64');
  const tag = Buffer.from(row.access_token_tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(row.access_token_encrypted, 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

function cleanupExpiredStates(db) {
  const cutoff = new Date(Date.now() - STATE_TTL_MS).toISOString();
  db.prepare('DELETE FROM meta_oauth_states WHERE created_at < ?').run(cutoff);
}

export function createMetaOAuthState(returnTo = null) {
  const db = getDb();
  cleanupExpiredStates(db);
  const state = crypto.randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO meta_oauth_states (state, created_at, return_to)
    VALUES (?, ?, ?)
  `).run(state, new Date().toISOString(), returnTo);
  return state;
}

export function consumeMetaOAuthState(state) {
  const db = getDb();
  cleanupExpiredStates(db);
  const row = db.prepare('SELECT state, created_at, return_to FROM meta_oauth_states WHERE state = ?').get(state);
  if (!row) return { valid: false };
  db.prepare('DELETE FROM meta_oauth_states WHERE state = ?').run(state);
  const createdAt = new Date(row.created_at).getTime();
  if (Number.isNaN(createdAt) || Date.now() - createdAt > STATE_TTL_MS) {
    return { valid: false };
  }
  return { valid: true, returnTo: row.return_to };
}

export function storeMetaToken({ accessToken, tokenType, scopes, expiresIn }) {
  const db = getDb();
  const encrypted = encryptToken(accessToken);
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO meta_auth_tokens (
      id,
      access_token_encrypted,
      access_token_iv,
      access_token_tag,
      is_encrypted,
      token_type,
      scopes,
      expires_at,
      created_at,
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token_encrypted = excluded.access_token_encrypted,
      access_token_iv = excluded.access_token_iv,
      access_token_tag = excluded.access_token_tag,
      is_encrypted = excluded.is_encrypted,
      token_type = excluded.token_type,
      scopes = excluded.scopes,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(
    encrypted.access_token_encrypted,
    encrypted.access_token_iv,
    encrypted.access_token_tag,
    encrypted.is_encrypted,
    tokenType || null,
    scopes ? JSON.stringify(scopes) : null,
    expiresAt,
    now,
    now
  );

  return { expiresAt };
}

export function clearMetaToken() {
  const db = getDb();
  db.prepare('DELETE FROM meta_auth_tokens WHERE id = 1').run();
}

export function getMetaTokenRecord() {
  const db = getDb();
  return db.prepare('SELECT * FROM meta_auth_tokens WHERE id = 1').get();
}

export function getMetaAccessToken() {
  const row = getMetaTokenRecord();
  if (!row) return null;
  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at).getTime();
    if (!Number.isNaN(expiresAt) && Date.now() > expiresAt) {
      return null;
    }
  }
  return decryptToken(row);
}

export function recordMetaApiStatus({ status, error, fbtraceId }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE meta_auth_tokens
    SET last_api_status = ?,
        last_api_error = ?,
        last_api_at = ?,
        last_fbtrace_id = ?,
        updated_at = ?
    WHERE id = 1
  `).run(status, error || null, now, fbtraceId || null, now);
}

export function getMetaAuthStatus({ includeToken = false } = {}) {
  const row = getMetaTokenRecord();
  if (!row) {
    return {
      connected: false
    };
  }

  let expired = false;
  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at).getTime();
    expired = !Number.isNaN(expiresAt) && Date.now() > expiresAt;
  }

  const token = includeToken ? decryptToken(row) : null;
  const scopes = row.scopes ? JSON.parse(row.scopes) : [];
  return {
    connected: !expired,
    expires_at: row.expires_at,
    token_type: row.token_type,
    scopes,
    last_api_status: row.last_api_status,
    last_api_error: row.last_api_error,
    last_api_at: row.last_api_at,
    last_fbtrace_id: row.last_fbtrace_id,
    token
  };
}

export function maskToken(token) {
  if (!token) return '';
  if (token.length <= 10) return token.replace(/.(?=.{2})/g, '•');
  return `${token.slice(0, 6)}••••••${token.slice(-4)}`;
}
