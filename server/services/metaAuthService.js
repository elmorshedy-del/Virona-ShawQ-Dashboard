import { getDb } from '../db/database.js';

const TOKEN_ROW_ID = 1;

export function getMetaOAuthToken() {
  const db = getDb();
  return db.prepare('SELECT * FROM meta_oauth_tokens WHERE id = ?').get(TOKEN_ROW_ID) || null;
}

export function storeMetaOAuthToken({ accessToken, tokenType, scopes, expiresAt }) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO meta_oauth_tokens (
      id,
      access_token,
      token_type,
      scopes,
      expires_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      token_type = excluded.token_type,
      scopes = excluded.scopes,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).run(
    TOKEN_ROW_ID,
    accessToken,
    tokenType || null,
    scopes || null,
    expiresAt || null,
    now,
    now
  );
}

export function clearMetaOAuthToken() {
  const db = getDb();
  db.prepare('DELETE FROM meta_oauth_tokens WHERE id = ?').run(TOKEN_ROW_ID);
}

export function saveMetaOAuthState(state) {
  const db = getDb();
  db.prepare('INSERT INTO meta_oauth_states (state, created_at) VALUES (?, ?)')
    .run(state, new Date().toISOString());
}

export function consumeMetaOAuthState(state, maxAgeMinutes = 15) {
  const db = getDb();
  const row = db.prepare('SELECT created_at FROM meta_oauth_states WHERE state = ?').get(state);

  db.prepare('DELETE FROM meta_oauth_states WHERE state = ?').run(state);

  if (!row) {
    return false;
  }

  const createdAt = new Date(row.created_at);
  const ageMs = Date.now() - createdAt.getTime();
  return ageMs <= maxAgeMinutes * 60 * 1000;
}

export function updateMetaApiStatus({ status, httpStatus, errorMessage, fbtraceId, params }) {
  const db = getDb();
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    status,
    httpStatus,
    errorMessage
  });
  const paramPayload = params ? JSON.stringify(params) : null;

  db.prepare(`
    INSERT INTO meta_oauth_tokens (
      id,
      last_api_status,
      last_api_status_at,
      last_fbtrace_id,
      last_request_params,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      last_api_status = excluded.last_api_status,
      last_api_status_at = excluded.last_api_status_at,
      last_fbtrace_id = excluded.last_fbtrace_id,
      last_request_params = excluded.last_request_params,
      updated_at = excluded.updated_at
  `).run(
    TOKEN_ROW_ID,
    payload,
    now,
    fbtraceId || null,
    paramPayload,
    now
  );
}

export function getMetaOAuthStatus() {
  const record = getMetaOAuthToken();
  if (!record) {
    return {
      connected: false,
      access_token: null,
      token_type: null,
      scopes: null,
      expires_at: null,
      is_expired: false,
      last_api_status: null,
      last_api_status_at: null,
      last_fbtrace_id: null
    };
  }

  const expiresAt = record.expires_at ? new Date(record.expires_at) : null;
  const isExpired = Boolean(expiresAt && expiresAt.getTime() <= Date.now());
  let parsedStatus = null;

  if (record.last_api_status) {
    try {
      parsedStatus = JSON.parse(record.last_api_status);
    } catch (error) {
      parsedStatus = { status: 'unknown', errorMessage: record.last_api_status };
    }
  }

  return {
    connected: Boolean(record.access_token) && !isExpired,
    access_token: record.access_token || null,
    token_type: record.token_type || null,
    scopes: record.scopes || null,
    expires_at: record.expires_at || null,
    is_expired: isExpired,
    last_api_status: parsedStatus,
    last_api_status_at: record.last_api_status_at || null,
    last_fbtrace_id: record.last_fbtrace_id || null
  };
}

export function getMetaUserAccessToken() {
  const record = getMetaOAuthToken();
  if (!record?.access_token) {
    throw new Error('Meta user access token not connected');
  }
  if (record.expires_at) {
    const expiresAt = new Date(record.expires_at);
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error('Meta user access token expired');
    }
  }
  return record.access_token;
}
