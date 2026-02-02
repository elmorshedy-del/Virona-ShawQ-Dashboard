import crypto from 'crypto';
import { getDb } from '../db/database.js';

const STATE_TTL_MS = 15 * 60 * 1000;

function getEncryptionKey() {
  const secret = process.env.SHOPIFY_TOKEN_SECRET || process.env.SHOPIFY_APP_SECRET;
  if (!secret) {
    return null;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptToken(token) {
  const key = getEncryptionKey();
  if (!key) {
    console.warn('[ShopifyAuth] SHOPIFY_TOKEN_SECRET not set. Storing token without encryption.');
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
    console.warn('[ShopifyAuth] Missing SHOPIFY_TOKEN_SECRET. Cannot decrypt stored token.');
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
  db.prepare('DELETE FROM shopify_oauth_states WHERE created_at < ?').run(cutoff);
}

export function createShopifyOAuthState({ shop, returnTo = null }) {
  const db = getDb();
  cleanupExpiredStates(db);
  const state = crypto.randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO shopify_oauth_states (state, shop, created_at, return_to)
    VALUES (?, ?, ?, ?)
  `).run(state, shop, new Date().toISOString(), returnTo);
  return state;
}

export function consumeShopifyOAuthState(state) {
  const db = getDb();
  cleanupExpiredStates(db);
  const row = db.prepare('SELECT state, shop, created_at, return_to FROM shopify_oauth_states WHERE state = ?').get(state);
  if (!row) return { valid: false };
  db.prepare('DELETE FROM shopify_oauth_states WHERE state = ?').run(state);
  const createdAt = new Date(row.created_at).getTime();
  if (Number.isNaN(createdAt) || Date.now() - createdAt > STATE_TTL_MS) {
    return { valid: false };
  }
  return { valid: true, shop: row.shop, returnTo: row.return_to };
}

export function storeShopifyToken({ shop, accessToken, scopes }) {
  const db = getDb();
  const encrypted = encryptToken(accessToken);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO shopify_auth_tokens (
      shop,
      access_token_encrypted,
      access_token_iv,
      access_token_tag,
      is_encrypted,
      scopes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop) DO UPDATE SET
      access_token_encrypted = excluded.access_token_encrypted,
      access_token_iv = excluded.access_token_iv,
      access_token_tag = excluded.access_token_tag,
      is_encrypted = excluded.is_encrypted,
      scopes = excluded.scopes,
      updated_at = excluded.updated_at
  `).run(
    shop,
    encrypted.access_token_encrypted,
    encrypted.access_token_iv,
    encrypted.access_token_tag,
    encrypted.is_encrypted,
    scopes ? JSON.stringify(scopes) : null,
    now,
    now
  );

  return { shop, updatedAt: now };
}

export function getShopifyTokenRecord(shop) {
  const db = getDb();
  if (!shop) return null;
  return db.prepare('SELECT * FROM shopify_auth_tokens WHERE shop = ?').get(shop);
}

export function getLatestShopifyTokenRecord() {
  const db = getDb();
  return db.prepare('SELECT * FROM shopify_auth_tokens ORDER BY updated_at DESC LIMIT 1').get();
}

export function getShopifyAccessToken(shop) {
  const row = getShopifyTokenRecord(shop);
  return decryptToken(row);
}

export function getLatestShopifyAccessToken() {
  const row = getLatestShopifyTokenRecord();
  if (!row) return null;
  return { shop: row.shop, token: decryptToken(row) };
}

export function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return `${token.slice(0, 2)}...`;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function getShopifyAuthStatus({ shop, includeToken = false } = {}) {
  const row = shop ? getShopifyTokenRecord(shop) : getLatestShopifyTokenRecord();
  if (!row) {
    return { connected: false };
  }

  const token = decryptToken(row);
  return {
    connected: Boolean(token),
    shop: row.shop,
    scopes: row.scopes ? JSON.parse(row.scopes) : [],
    updated_at: row.updated_at,
    token: includeToken ? token : maskToken(token)
  };
}
