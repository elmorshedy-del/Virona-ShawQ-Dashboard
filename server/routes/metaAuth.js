import express from 'express';
import fetch from 'node-fetch';
import {
  clearMetaToken,
  consumeMetaOAuthState,
  createMetaOAuthState,
  getMetaAuthStatus,
  maskToken,
  storeMetaToken
} from '../services/metaAuthService.js';

const router = express.Router();

const FB_API_VERSION = 'v21.0';
const FB_OAUTH_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

function getRedirectUri(req) {
  const host = req.get('host') || '';
  if (host.includes('dashboard.inttrade.co')) {
    return 'https://dashboard.inttrade.co/api/auth/meta/callback';
  }
  return 'http://localhost:3000/api/auth/meta/callback';
}

router.get('/start', (req, res) => {
  const clientId = process.env.META_APP_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'META_APP_ID not configured' });
  }

  const redirectUri = getRedirectUri(req);
  const state = createMetaOAuthState();
  const scopes = ['ads_read'];

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(','),
    state
  });

  const url = `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?${params.toString()}`;
  return res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Meta OAuth failed: ${error_description || error}`);
  }

  if (!code || !state) {
    return res.status(400).send('Missing code or state.');
  }

  const stateResult = consumeMetaOAuthState(state);
  if (!stateResult.valid) {
    return res.status(400).send('Invalid OAuth state.');
  }

  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send('META_APP_ID or META_APP_SECRET not configured.');
  }

  const redirectUri = getRedirectUri(req);
  const tokenUrl = `${FB_OAUTH_BASE}/oauth/access_token?` + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    client_secret: clientSecret,
    code: String(code)
  }).toString();

  try {
    const tokenResponse = await fetch(tokenUrl);
    const tokenJson = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return res.status(500).send(`Meta token exchange failed: ${tokenJson?.error?.message || 'Unknown error'}`);
    }

    const accessToken = tokenJson.access_token;
    const expiresIn = tokenJson.expires_in;
    const tokenType = tokenJson.token_type;

    let scopes = [];
    try {
      const permissionsUrl = `${FB_OAUTH_BASE}/me/permissions?` + new URLSearchParams({
        access_token: accessToken
      }).toString();
      const permissionsResponse = await fetch(permissionsUrl);
      const permissionsJson = await permissionsResponse.json();
      if (permissionsResponse.ok && Array.isArray(permissionsJson?.data)) {
        scopes = permissionsJson.data
          .filter(p => p.status === 'granted')
          .map(p => p.permission);
      }
    } catch (permissionError) {
      console.warn('[MetaAuth] Failed to fetch permissions:', permissionError.message);
    }

    storeMetaToken({ accessToken, tokenType, scopes, expiresIn });

    return res.redirect(stateResult.returnTo || '/?meta=connected');
  } catch (err) {
    console.error('[MetaAuth] OAuth callback error:', err.message);
    return res.status(500).send('Meta OAuth callback failed.');
  }
});

router.get('/status', (req, res) => {
  const status = getMetaAuthStatus({ includeToken: true });
  if (!status.connected) {
    return res.json({ connected: false });
  }

  const masked = maskToken(status.token);
  return res.json({
    connected: true,
    expires_at: status.expires_at,
    token_type: status.token_type,
    scopes: status.scopes,
    last_api_status: status.last_api_status,
    last_api_error: status.last_api_error,
    last_api_at: status.last_api_at,
    last_fbtrace_id: status.last_fbtrace_id,
    token: status.token,
    token_masked: masked
  });
});

router.post('/disconnect', (req, res) => {
  clearMetaToken();
  res.json({ success: true });
});

export default router;
