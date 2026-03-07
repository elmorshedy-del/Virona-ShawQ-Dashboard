import crypto from 'crypto';

import { resolveStoreUrl } from '../services/storeProfileService.js';

const SESSION_INTELLIGENCE_ADMIN_COOKIE_NAME = 'virona_si_admin';
const SESSION_INTELLIGENCE_ADMIN_COOKIE_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_INTELLIGENCE_PUBLIC_TOKEN_TTL_MS = 30 * 60 * 1000;
const SESSION_INTELLIGENCE_COOKIE_PATH = '/api/session-intelligence/survey';
const SESSION_INTELLIGENCE_PUBLIC_TOKEN_SCOPE = 'survey_public';
const SESSION_INTELLIGENCE_ADMIN_TOKEN_SCOPE = 'survey_admin';
const SESSION_INTELLIGENCE_SECRET_ENV_KEYS = [
  'SESSION_INTELLIGENCE_SIGNING_SECRET',
  'SESSION_INTELLIGENCE_ACCESS_SECRET',
  'SESSION_SECRET',
  'COOKIE_SECRET',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_API_SECRET_KEY'
];
const SESSION_INTELLIGENCE_DEV_FALLBACK_SECRET = 'virona-session-intelligence-dev-secret';

function safeString(value, maxLength = 255) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
}

function resolveSigningSecret() {
  for (const key of SESSION_INTELLIGENCE_SECRET_ENV_KEYS) {
    const value = safeString(process.env[key], 400);
    if (value) return value;
  }
  if ((process.env.NODE_ENV || '').toLowerCase() !== 'production') {
    return SESSION_INTELLIGENCE_DEV_FALLBACK_SECRET;
  }
  return '';
}

function createSignature(rawPayload) {
  const secret = resolveSigningSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(rawPayload).digest('base64url');
}

function encodeSignedPayload(payload) {
  const rawPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createSignature(rawPayload);
  if (!signature) return '';
  return `${rawPayload}.${signature}`;
}

function decodeSignedPayload(token) {
  const raw = safeString(token, 4000);
  if (!raw || !raw.includes('.')) return null;
  const separatorIndex = raw.lastIndexOf('.');
  const encodedPayload = raw.slice(0, separatorIndex);
  const providedSignature = raw.slice(separatorIndex + 1);
  const expectedSignature = createSignature(encodedPayload);
  if (!expectedSignature) return null;

  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function extractOriginFromValue(value) {
  const raw = safeString(value, 2000);
  if (!raw) return null;
  try {
    return new URL(raw).origin.toLowerCase();
  } catch (_error) {
    return null;
  }
}

function getRequestProtocol(req) {
  const forwarded = safeString(req?.headers?.['x-forwarded-proto'], 40).toLowerCase();
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'https';
  }
  if (req?.protocol) return String(req.protocol).toLowerCase();
  return 'https';
}

export function getRequestSelfOrigin(req) {
  const host = safeString(req?.get?.('host') || req?.headers?.host, 240).toLowerCase();
  if (!host) return null;
  const protocol = getRequestProtocol(req);
  return `${protocol}://${host}`;
}

function getRequestOriginCandidates(req, extraValues = []) {
  const candidates = [
    extractOriginFromValue(req?.headers?.origin),
    extractOriginFromValue(req?.headers?.referer),
    ...extraValues.map((value) => extractOriginFromValue(value))
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function parseCookieHeader(cookieHeader) {
  const raw = safeString(cookieHeader, 8000);
  if (!raw) return {};
  return raw.split(';').reduce((accumulator, segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return accumulator;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) return accumulator;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key) accumulator[key] = value;
    return accumulator;
  }, {});
}

function hashUserAgent(userAgent) {
  const normalized = safeString(userAgent, 600);
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function issueSessionIntelligenceAdminCookie(req, res) {
  const host = safeString(req?.get?.('host') || req?.headers?.host, 240).toLowerCase();
  const origin = getRequestSelfOrigin(req);
  const uaHash = hashUserAgent(req?.headers?.['user-agent']);
  const nowMs = Date.now();
  const token = encodeSignedPayload({
    scope: SESSION_INTELLIGENCE_ADMIN_TOKEN_SCOPE,
    host,
    origin,
    uaHash,
    exp: nowMs + SESSION_INTELLIGENCE_ADMIN_COOKIE_TTL_MS
  });
  if (!token) return false;
  res.cookie(SESSION_INTELLIGENCE_ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin?.startsWith('https://') ?? true,
    maxAge: SESSION_INTELLIGENCE_ADMIN_COOKIE_TTL_MS,
    path: SESSION_INTELLIGENCE_COOKIE_PATH
  });
  return true;
}

export function validateSessionIntelligenceAdminRequest(req) {
  const selfOrigin = getRequestSelfOrigin(req);
  const originCandidates = getRequestOriginCandidates(req);
  if (!selfOrigin || originCandidates.length === 0 || !originCandidates.includes(selfOrigin)) {
    return { ok: false, reason: 'Dashboard origin validation failed' };
  }

  const cookies = parseCookieHeader(req?.headers?.cookie);
  const token = cookies[SESSION_INTELLIGENCE_ADMIN_COOKIE_NAME];
  const decoded = decodeSignedPayload(token);
  if (!decoded || decoded.scope !== SESSION_INTELLIGENCE_ADMIN_TOKEN_SCOPE) {
    return { ok: false, reason: 'Missing dashboard admin session' };
  }

  const nowMs = Date.now();
  const expectedHost = safeString(req?.get?.('host') || req?.headers?.host, 240).toLowerCase();
  const expectedUaHash = hashUserAgent(req?.headers?.['user-agent']);
  if (!Number.isFinite(decoded.exp) || decoded.exp < nowMs) {
    return { ok: false, reason: 'Dashboard admin session expired' };
  }
  if (safeString(decoded.host, 240).toLowerCase() !== expectedHost) {
    return { ok: false, reason: 'Dashboard admin session host mismatch' };
  }
  if (safeString(decoded.origin, 280).toLowerCase() !== selfOrigin) {
    return { ok: false, reason: 'Dashboard admin session origin mismatch' };
  }
  if (safeString(decoded.uaHash, 64) !== expectedUaHash) {
    return { ok: false, reason: 'Dashboard admin session user-agent mismatch' };
  }

  return { ok: true, origin: selfOrigin };
}

export function resolveStorefrontOrigin(store) {
  const storeUrl = resolveStoreUrl(store);
  return extractOriginFromValue(storeUrl);
}

export function issueSessionIntelligencePublicSurveyToken(req, store) {
  const normalizedStore = safeString(store, 80);
  if (!normalizedStore) return null;
  const storefrontOrigin = resolveStorefrontOrigin(normalizedStore);
  if (!storefrontOrigin) return null;
  const originCandidates = getRequestOriginCandidates(req);
  if (!originCandidates.includes(storefrontOrigin)) return null;
  return encodeSignedPayload({
    scope: SESSION_INTELLIGENCE_PUBLIC_TOKEN_SCOPE,
    store: normalizedStore,
    origin: storefrontOrigin,
    exp: Date.now() + SESSION_INTELLIGENCE_PUBLIC_TOKEN_TTL_MS
  });
}

export function validateSessionIntelligencePublicSurveyRequest(req, { store, pageUrl } = {}) {
  const normalizedStore = safeString(store, 80);
  if (!normalizedStore) {
    return { ok: false, reason: 'Missing store' };
  }

  const storefrontOrigin = resolveStorefrontOrigin(normalizedStore);
  if (!storefrontOrigin) {
    return { ok: false, reason: 'Storefront origin is not configured for this store' };
  }

  const originCandidates = getRequestOriginCandidates(req, [pageUrl]);
  if (!originCandidates.includes(storefrontOrigin)) {
    return { ok: false, reason: 'Storefront origin validation failed' };
  }

  const token = safeString(req?.get?.('x-virona-survey-token') || req?.headers?.['x-virona-survey-token'], 4000);
  const decoded = decodeSignedPayload(token);
  if (!decoded || decoded.scope !== SESSION_INTELLIGENCE_PUBLIC_TOKEN_SCOPE) {
    return { ok: false, reason: 'Missing survey storefront token' };
  }

  if (!Number.isFinite(decoded.exp) || decoded.exp < Date.now()) {
    return { ok: false, reason: 'Survey storefront token expired' };
  }
  if (safeString(decoded.store, 80) !== normalizedStore) {
    return { ok: false, reason: 'Survey storefront token store mismatch' };
  }
  if (safeString(decoded.origin, 280).toLowerCase() !== storefrontOrigin) {
    return { ok: false, reason: 'Survey storefront token origin mismatch' };
  }

  return {
    ok: true,
    origin: storefrontOrigin,
    store: normalizedStore
  };
}
