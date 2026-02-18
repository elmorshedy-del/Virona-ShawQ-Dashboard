import fs from 'fs';
import http from 'http';
import { exec } from 'child_process';
import { URL } from 'url';

const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

function usage() {
  console.log(`
Usage:
  node server/scripts/generateGoogleAdsRefreshToken.js \\
    --oauth /absolute/path/to/client_secret.json \\
    [--redirect http://localhost:8085/oauth2callback] \\
    [--customer 3358481913] \\
    [--write-env] [--env-file .env] [--no-open]

What this does:
  1) Starts a localhost callback listener
  2) Opens Google consent URL
  3) Exchanges auth code for tokens
  4) Prints refresh_token
  5) Optionally writes values into .env
`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--write-env') out.writeEnv = true;
    else if (arg === '--no-open') out.noOpen = true;
    else if (arg === '--oauth') out.oauthPath = argv[++i];
    else if (arg === '--redirect') out.redirectUri = argv[++i];
    else if (arg === '--customer') out.customerId = String(argv[++i] || '').replace(/[^0-9]/g, '');
    else if (arg === '--env-file') out.envFile = argv[++i];
    else if (arg === '--code') out.code = argv[++i];
    else {
      console.error(`Unknown argument: ${arg}`);
      out.help = true;
      return out;
    }
  }
  return out;
}

function readOauthJson(path) {
  if (!path) {
    throw new Error('Missing --oauth path');
  }
  if (!fs.existsSync(path)) {
    throw new Error(`OAuth JSON not found: ${path}`);
  }
  const raw = fs.readFileSync(path, 'utf8');
  const json = JSON.parse(raw);
  const root = json.installed || json.web || json;
  if (!root.client_id || !root.client_secret) {
    throw new Error('OAuth JSON missing client_id/client_secret');
  }
  return root;
}

function makeState() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function tryOpenBrowser(url) {
  try {
    const escaped = url.replace(/"/g, '\\"');
    let command = `xdg-open "${escaped}"`;
    if (process.platform === 'darwin') {
      command = `open "${escaped}"`;
    } else if (process.platform === 'win32') {
      command = `start "" "${escaped}"`;
    }

    exec(command, (error) => {
      if (error) {
        console.warn(`Could not open browser automatically (${process.platform}): ${error.message}`);
      }
    });
  } catch (_) {}
}

function waitForAuthCode(redirectUri, expectedState, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const callbackUrl = new URL(redirectUri);
    const callbackPath = callbackUrl.pathname || '/';
    const server = http.createServer((req, res) => {
      try {
        const incoming = new URL(req.url, `http://localhost:${callbackUrl.port || 80}`);
        if (incoming.pathname !== callbackPath) {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Waiting for OAuth callback...');
          return;
        }

        const err = incoming.searchParams.get('error');
        if (err) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h3>OAuth failed: ${err}</h3><p>You can close this tab.</p>`);
          reject(new Error(`OAuth error: ${err}`));
          return;
        }

        const state = incoming.searchParams.get('state');
        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h3>State mismatch.</h3><p>You can close this tab.</p>');
          reject(new Error('State mismatch in OAuth callback'));
          return;
        }

        const code = incoming.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h3>No code received.</h3><p>You can close this tab.</p>');
          reject(new Error('No code received in OAuth callback'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>Google authorization complete.</h3><p>You can close this tab and return to terminal.</p>');
        resolve(code);
      } catch (error) {
        reject(error);
      }
    });

    server.on('error', reject);
    const port = Number(callbackUrl.port || 80);
    server.listen(port, '127.0.0.1');

    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for OAuth callback'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      server.close(() => {});
    };

    const wrap = (fn) => (value) => {
      cleanup();
      fn(value);
    };

    resolve = wrap(resolve);
    reject = wrap(reject);
  });
}

async function exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = payload.error_description || payload.error || `HTTP ${res.status}`;
    throw new Error(`Token exchange failed: ${msg}`);
  }
  return payload;
}

function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^\\s*${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, line);
  return `${text.trimEnd()}\n${line}\n`;
}

function writeEnv({ envFile, oauthPath, oauth, refreshToken, customerId }) {
  const target = envFile || '.env';
  let text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';

  text = setEnvValue(text, 'GOOGLE_OAUTH_CLIENT_SECRET_PATH', oauthPath);
  text = setEnvValue(text, 'GOOGLE_ADS_CLIENT_ID', oauth.client_id);
  text = setEnvValue(text, 'GOOGLE_ADS_CLIENT_SECRET', oauth.client_secret);
  text = setEnvValue(text, 'GOOGLE_ADS_REFRESH_TOKEN', refreshToken);
  if (customerId) {
    text = setEnvValue(text, 'GOOGLE_ADS_CUSTOMER_ID', customerId);
  }

  fs.writeFileSync(target, text);
  return target;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }

  const oauth = readOauthJson(args.oauthPath);
  const fallbackRedirect = 'http://localhost:8085/oauth2callback';
  const jsonRedirect = Array.isArray(oauth.redirect_uris) ? oauth.redirect_uris[0] : '';
  const redirectUri = args.redirectUri || jsonRedirect || fallbackRedirect;

  if (!redirectUri.startsWith('http://localhost')) {
    throw new Error(
      `This script expects localhost redirect URI. Current redirect is "${redirectUri}". ` +
      'Use --redirect http://localhost:8085/oauth2callback and add it to Authorized redirect URIs in Google Cloud.'
    );
  }

  const state = makeState();
  const authUrl = new URL(GOOGLE_OAUTH_AUTH_URL);
  authUrl.searchParams.set('client_id', oauth.client_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GOOGLE_ADS_SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  console.log('\nGoogle Ads OAuth consent URL:\n');
  console.log(authUrl.toString());
  console.log('\nIf browser does not open, copy-paste this URL manually.\n');

  if (!args.noOpen) {
    tryOpenBrowser(authUrl.toString());
  }

  let code = args.code;
  if (!code) {
    code = await waitForAuthCode(redirectUri, state);
  }

  const tokens = await exchangeCodeForTokens({
    code,
    clientId: oauth.client_id,
    clientSecret: oauth.client_secret,
    redirectUri
  });

  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned. Re-run and ensure prompt=consent and this is the first/new consent for this client+scope.'
    );
  }

  console.log('\nRefresh token generated successfully:\n');
  console.log(tokens.refresh_token);
  console.log('\nNext: set GOOGLE_ADS_DEVELOPER_TOKEN and GOOGLE_ADS_CUSTOMER_ID in .env');

  if (args.writeEnv) {
    const written = writeEnv({
      envFile: args.envFile,
      oauthPath: args.oauthPath,
      oauth,
      refreshToken: tokens.refresh_token,
      customerId: args.customerId
    });
    console.log(`\nWrote values to ${written}`);
  }
}

main().catch((error) => {
  console.error(`\n[generateGoogleAdsRefreshToken] ${error.message}`);
  process.exit(1);
});
