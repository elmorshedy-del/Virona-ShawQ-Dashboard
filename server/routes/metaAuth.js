import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import {
  clearMetaOAuthToken,
  consumeMetaOAuthState,
  getMetaOAuthStatus,
  saveMetaOAuthState,
  storeMetaOAuthToken
} from '../services/metaAuthService.js';

const router = express.Router();
const META_OAUTH_BASE = 'https://www.facebook.com/v21.0/dialog/oauth';
const META_TOKEN_ENDPOINT = 'https://graph.facebook.com/v21.0/oauth/access_token';
const DEFAULT_SCOPES = 'ads_read';

function getRedirectUri() {
  if (process.env.META_OAUTH_REDIRECT_URI) {
    return process.env.META_OAUTH_REDIRECT_URI;
  }
  return process.env.NODE_ENV === 'production'
    ? 'https://dashboard.inttrade.co/api/auth/meta/callback'
    : 'http://localhost:3000/api/auth/meta/callback';
}

function buildMetaAuthUrl({ state, scopes }) {
  const clientId = process.env.META_APP_ID;
  if (!clientId) {
    throw new Error('META_APP_ID not configured');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    state,
    scope: scopes || DEFAULT_SCOPES
  });

  return `${META_OAUTH_BASE}?${params.toString()}`;
}

router.get('/start', (req, res) => {
  try {
    const state = crypto.randomBytes(24).toString('hex');
    saveMetaOAuthState(state);

    const authUrl = buildMetaAuthUrl({ state });
    res.redirect(authUrl);
  } catch (error) {
    console.error('[Meta OAuth] Start error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error('[Meta OAuth] Callback error:', error, error_description);
      return res.status(400).send(`Meta OAuth error: ${error_description || error}`);
    }

    if (!code || !state) {
      return res.status(400).send('Missing code or state.');
    }

    const validState = consumeMetaOAuthState(state);
    if (!validState) {
      return res.status(400).send('Invalid or expired state.');
    }

    const clientId = process.env.META_APP_ID;
    const clientSecret = process.env.META_APP_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).send('Meta OAuth credentials not configured.');
    }

    const tokenResponse = await axios.get(META_TOKEN_ENDPOINT, {
      params: {
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(),
        code
      }
    });

    const { access_token: accessToken, token_type: tokenType, expires_in: expiresIn } = tokenResponse.data || {};
    if (!accessToken) {
      return res.status(500).send('Meta OAuth token exchange failed.');
    }

    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    storeMetaOAuthToken({
      accessToken,
      tokenType,
      scopes: DEFAULT_SCOPES,
      expiresAt
    });

    res.send(`
      <html>
        <head><title>Meta Connected</title></head>
        <body style="font-family: sans-serif; padding: 24px;">
          <h2>Meta connected ✅</h2>
          <p>You can close this window and return to the dashboard.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('[Meta OAuth] Callback error:', error.response?.data || error.message);
    res.status(500).send('Meta OAuth callback failed.');
  }
});

router.get('/status', (req, res) => {
  try {
    const status = getMetaOAuthStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    console.error('[Meta OAuth] Status error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/disconnect', (req, res) => {
  try {
    clearMetaOAuthToken();
    res.json({ success: true });
  } catch (error) {
    console.error('[Meta OAuth] Disconnect error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
