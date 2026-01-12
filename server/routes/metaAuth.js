import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import {
  consumeOAuthState,
  getMetaAuthStatus,
  saveMetaAuthToken,
  saveOAuthState,
  clearMetaAuthToken
} from '../services/metaAuthService.js';

const router = express.Router();

const META_API_VERSION = 'v19.0';
const META_AUTH_BASE = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`;
const META_TOKEN_BASE = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`;

const PROD_REDIRECT_URI = 'https://dashboard.inttrade.co/api/auth/meta/callback';
const LOCAL_REDIRECT_URI = 'http://localhost:3000/api/auth/meta/callback';

function getRedirectUri(req) {
  if (process.env.META_OAUTH_REDIRECT_URI) {
    return process.env.META_OAUTH_REDIRECT_URI;
  }

  const host = req.headers.host || '';
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return LOCAL_REDIRECT_URI;
  }

  return PROD_REDIRECT_URI;
}

function getRequestedScopes() {
  return process.env.META_OAUTH_SCOPES || 'ads_read';
}

router.get('/start', (req, res) => {
  const clientId = process.env.META_APP_ID;

  if (!clientId) {
    return res.status(500).json({ error: 'META_APP_ID not configured' });
  }

  const state = crypto.randomBytes(16).toString('hex');
  saveOAuthState(state);

  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    scope: getRequestedScopes()
  });

  return res.redirect(`${META_AUTH_BASE}?${params.toString()}`);
});

router.get('/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.status(400).send(`Meta OAuth error: ${errorDescription || error}`);
  }

  if (!code || !state) {
    return res.status(400).send('Missing OAuth code or state.');
  }

  const stateValid = consumeOAuthState(state);
  if (!stateValid) {
    return res.status(400).send('Invalid or expired OAuth state.');
  }

  const clientId = process.env.META_APP_ID;
  const clientSecret = process.env.META_APP_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).send('META_APP_ID or META_APP_SECRET not configured.');
  }

  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code
  });

  try {
    const response = await fetch(`${META_TOKEN_BASE}?${params.toString()}`);
    const data = await response.json();

    if (!response.ok || data.error) {
      return res.status(400).send(data?.error?.message || 'Failed to exchange code for token.');
    }

    saveMetaAuthToken({
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scopes: getRequestedScopes()
    });

    const successRedirect = process.env.META_OAUTH_SUCCESS_REDIRECT || '/?meta=connected';
    return res.redirect(successRedirect);
  } catch (err) {
    return res.status(500).send(`Meta OAuth error: ${err.message}`);
  }
});

router.get('/status', (req, res) => {
  return res.json(getMetaAuthStatus());
});

router.post('/disconnect', (req, res) => {
  clearMetaAuthToken();
  return res.json({ success: true });
});

export default router;
