import express from 'express';
import fetch from 'node-fetch';
import {
  createMetaOAuthState,
  consumeMetaOAuthState,
  saveMetaToken,
  getMetaTokenRecord,
  clearMetaToken,
  maskToken
} from '../services/metaAuthService.js';

const router = express.Router();

const META_GRAPH_VERSION = 'v21.0';
const META_DIALOG_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const DEFAULT_SCOPES = 'ads_read';

function getRedirectUri() {
  return process.env.META_OAUTH_REDIRECT_URI
    || (process.env.NODE_ENV === 'production'
      ? 'https://dashboard.inttrade.co/api/auth/meta/callback'
      : 'http://localhost:3000/api/auth/meta/callback');
}

function renderHtmlResponse({ title, message, success }) {
  const statusColor = success ? '#16a34a' : '#dc2626';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; padding: 32px; }
    .card { max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.1); }
    .status { font-weight: 700; color: ${statusColor}; }
    .message { margin-top: 8px; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <div class="status">${title}</div>
    <div class="message">${message}</div>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'meta-oauth', status: '${success ? 'success' : 'error'}' }, '*');
      window.close();
    }
  </script>
</body>
</html>`;
}

router.get('/start', (req, res) => {
  const clientId = process.env.META_APP_ID;
  const scopes = process.env.META_OAUTH_SCOPES || DEFAULT_SCOPES;

  if (!clientId) {
    return res.status(500).json({ error: 'META_APP_ID not configured' });
  }

  const state = createMetaOAuthState();
  const redirectUri = getRedirectUri();
  const authUrl = new URL(META_DIALOG_URL);

  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', scopes);

  return res.redirect(authUrl.toString());
});

router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;

  if (error) {
    const html = renderHtmlResponse({
      title: 'Meta authorization failed',
      message: errorDescription || String(error),
      success: false
    });
    return res.status(400).type('html').send(html);
  }

  if (!code || !state) {
    const html = renderHtmlResponse({
      title: 'Meta authorization failed',
      message: 'Missing authorization code or state.',
      success: false
    });
    return res.status(400).type('html').send(html);
  }

  if (!consumeMetaOAuthState(state)) {
    const html = renderHtmlResponse({
      title: 'Meta authorization failed',
      message: 'State mismatch. Please retry the connection flow.',
      success: false
    });
    return res.status(403).type('html').send(html);
  }

  if (!clientId || !clientSecret) {
    const html = renderHtmlResponse({
      title: 'Meta authorization failed',
      message: 'Meta app credentials are not configured.',
      success: false
    });
    return res.status(500).type('html').send(html);
  }

  const redirectUri = getRedirectUri();
  const tokenUrl = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', clientId);
  tokenUrl.searchParams.set('client_secret', clientSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  try {
    const tokenResponse = await fetch(tokenUrl.toString());
    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || tokenData.error) {
      const html = renderHtmlResponse({
        title: 'Meta token exchange failed',
        message: tokenData.error?.message || 'Unable to exchange authorization code for token.',
        success: false
      });
      return res.status(400).type('html').send(html);
    }

    let scope = tokenData.scope || null;

    try {
      const permissionsUrl = new URL(`${META_GRAPH_BASE}/me/permissions`);
      permissionsUrl.searchParams.set('access_token', tokenData.access_token);
      const permissionsResponse = await fetch(permissionsUrl.toString());
      const permissionsData = await permissionsResponse.json();

      if (permissionsResponse.ok && Array.isArray(permissionsData.data)) {
        const granted = permissionsData.data
          .filter(permission => permission.status === 'granted')
          .map(permission => permission.permission);
        if (granted.length) {
          scope = granted.join(',');
        }
      }
    } catch (permissionError) {
      console.warn('[Meta OAuth] Failed to fetch permissions:', permissionError.message);
    }

    if (!scope) {
      scope = process.env.META_OAUTH_SCOPES || DEFAULT_SCOPES;
    }

    saveMetaToken({
      accessToken: tokenData.access_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
      scope
    });

    const html = renderHtmlResponse({
      title: 'Meta connected successfully',
      message: 'You can close this window and return to the dashboard.',
      success: true
    });
    return res.type('html').send(html);
  } catch (exchangeError) {
    const html = renderHtmlResponse({
      title: 'Meta token exchange failed',
      message: exchangeError.message || 'Unexpected error during token exchange.',
      success: false
    });
    return res.status(500).type('html').send(html);
  }
});

router.get('/status', (req, res) => {
  const record = getMetaTokenRecord();
  if (!record) {
    return res.json({
      connected: false,
      expires_at: null,
      scopes: [],
      last_api_status: null,
      last_api_at: null,
      last_fbtrace_id: null,
      token: null,
      token_masked: null,
      expired: false
    });
  }

  const expiresAt = record.expires_at;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : null;
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();

  return res.json({
    connected: Boolean(record.access_token) && !expired,
    expires_at: expiresAt,
    scopes: record.scope ? record.scope.split(',').map(scope => scope.trim()).filter(Boolean) : [],
    last_api_status: record.last_api_status ?? null,
    last_api_at: record.last_api_at ?? null,
    last_fbtrace_id: record.last_fbtrace_id ?? null,
    token: record.access_token,
    token_masked: maskToken(record.access_token),
    expired
  });
});

router.delete('/disconnect', (req, res) => {
  clearMetaToken();
  res.json({ success: true });
});

export default router;
