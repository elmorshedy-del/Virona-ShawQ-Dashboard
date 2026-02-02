import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import {
  consumeShopifyOAuthState,
  createShopifyOAuthState,
  getShopifyAuthStatus,
  maskToken,
  storeShopifyToken
} from '../services/shopifyAuthService.js';

const router = express.Router();

function normalizeShopDomain(shop) {
  if (!shop || typeof shop !== 'string') return null;
  const trimmed = shop.trim();
  if (!trimmed) return null;
  if (trimmed.includes('.myshopify.com')) return trimmed;
  if (/^[a-zA-Z0-9][a-zA-Z0-9-]+$/.test(trimmed)) {
    return `${trimmed}.myshopify.com`;
  }
  return trimmed;
}

function getRedirectUri(req) {
  const host = req.get('host') || '';
  if (host.includes('localhost')) {
    return 'http://localhost:3000/api/auth/shopify/callback';
  }
  return `https://${host}/api/auth/shopify/callback`;
}

function verifyShopifyHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  if (!hmac || !secret) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => {
      const value = Array.isArray(rest[key]) ? rest[key].join(',') : rest[key];
      // Escape '&' and '%' in values to prevent parameter injection, as per Shopify docs.
      const escapedValue = String(value).replace(/%/g, '%25').replace(/&/g, '%26');
      return `${key}=${escapedValue}`;
    })
    .join('&');

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const hmacBuffer = Buffer.from(hmac, 'utf8');
  const digestBuffer = Buffer.from(digest, 'utf8');
  if (hmacBuffer.length !== digestBuffer.length) return false;
  return crypto.timingSafeEqual(hmacBuffer, digestBuffer);
}

router.get('/start', (req, res) => {
  const clientId = process.env.SHOPIFY_APP_KEY;
  if (!clientId) {
    return res.status(500).json({ error: 'SHOPIFY_APP_KEY not configured' });
  }

  const shop = normalizeShopDomain(req.query.shop || process.env.SHAWQ_SHOPIFY_STORE);
  if (!shop) {
    return res.status(400).json({ error: 'Shop domain is required (shop parameter or SHAWQ_SHOPIFY_STORE)' });
  }

  const redirectUri = getRedirectUri(req);
  const scopes = (process.env.SHOPIFY_APP_SCOPES || 'read_orders,read_customers,read_products').split(',').map(s => s.trim()).filter(Boolean);
  const state = createShopifyOAuthState({ shop, returnTo: req.query.returnTo || '/' });

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes.join(','),
    redirect_uri: redirectUri,
    state
  });

  const url = `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  return res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { shop, code, state, hmac, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Shopify OAuth failed: ${error_description || error}`);
  }

  if (!shop || !code || !state || !hmac) {
    return res.status(400).send('Missing shop, code, state, or hmac.');
  }

  const stateResult = consumeShopifyOAuthState(state);
  if (!stateResult.valid) {
    return res.status(400).send('Invalid OAuth state.');
  }

  const normalizedShop = normalizeShopDomain(shop);
  if (stateResult.shop && normalizedShop !== stateResult.shop) {
    return res.status(400).send('Shop mismatch for OAuth state.');
  }

  const clientSecret = process.env.SHOPIFY_APP_SECRET;
  if (!clientSecret || !process.env.SHOPIFY_APP_KEY) {
    return res.status(500).send('SHOPIFY_APP_KEY or SHOPIFY_APP_SECRET not configured.');
  }

  if (!verifyShopifyHmac(req.query, clientSecret)) {
    return res.status(400).send('Invalid Shopify HMAC.');
  }

  const tokenUrl = `https://${normalizedShop}/admin/oauth/access_token`;

  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_APP_KEY,
        client_secret: clientSecret,
        code: String(code)
      })
    });

    const tokenJson = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return res.status(500).send(`Shopify token exchange failed: ${tokenJson?.error_description || tokenJson?.error || 'Unknown error'}`);
    }

    const accessToken = tokenJson.access_token;
    const scopes = tokenJson.scope ? tokenJson.scope.split(',') : [];

    storeShopifyToken({ shop: normalizedShop, accessToken, scopes });

    return res.redirect(stateResult.returnTo || '/?shopify=connected');
  } catch (err) {
    console.error('[ShopifyAuth] OAuth callback error:', err.message);
    return res.status(500).send('Shopify OAuth callback failed.');
  }
});

router.get('/status', (req, res) => {
  const shop = normalizeShopDomain(req.query.shop || process.env.SHAWQ_SHOPIFY_STORE);
  const includeToken = String(req.query.includeToken || '').toLowerCase() === 'true';

  const envToken = process.env.SHAWQ_SHOPIFY_ACCESS_TOKEN;
  const envShop = normalizeShopDomain(process.env.SHAWQ_SHOPIFY_STORE);

  if (envToken && (!shop || shop === envShop)) {
    return res.json({
      connected: true,
      shop: envShop,
      source: 'env',
      token: includeToken ? envToken : maskToken(envToken)
    });
  }

  const status = getShopifyAuthStatus({ shop, includeToken });
  if (!status.connected) {
    return res.json({ connected: false });
  }

  return res.json({
    connected: true,
    source: 'oauth',
    ...status
  });
});

export default router;
