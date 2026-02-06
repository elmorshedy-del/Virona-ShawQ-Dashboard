import express from 'express';
import { getDb } from '../db/database.js';
import { recordSessionIntelligenceEvent } from '../services/sessionIntelligenceService.js';

const router = express.Router();

const DEFAULT_WINDOW_SECONDS = 180;
const MAX_WINDOW_SECONDS = 1800;
const LIVE_STATE_GC_MULTIPLIER = 6; // keep some buffer beyond the visible window

const PIXEL_SCRIPT_CACHE_SECONDS = 300; // keep short so we can ship fixes quickly
const PIXEL_SCRIPT_VERSION = 'virona-pixel-v1';

function renderUniversalPixelScript() {
  // IMPORTANT:
  // - This script is designed to run on ANY site (Shopify / custom / etc.)
  // - It posts to THIS server origin (derived from the script src), not the host site origin.
  // - It does NOT capture PII (no input values, no message text bodies, etc.)
  return `
/* ${PIXEL_SCRIPT_VERSION} */
(function () {
  'use strict';

  var VERSION = ${JSON.stringify(PIXEL_SCRIPT_VERSION)};
  var SESSION_IDLE_MS = 30 * 60 * 1000;
  var DEAD_CLICK_TIMEOUT_MS = 1200;
  var RAGE_CLICK_WINDOW_MS = 800;
  var RAGE_CLICK_MIN_CLICKS = 3;
  var RAGE_CLICK_RADIUS_PX = 30;
  var SCROLL_BUCKETS = [25, 50, 75, 90];
  var MAX_STRING = 240;

  function safeString(value, max) {
    try {
      var str = value == null ? '' : String(value);
      if (!str) return '';
      var limit = typeof max === 'number' && max > 0 ? max : MAX_STRING;
      return str.length > limit ? str.slice(0, limit) : str;
    } catch (_e) {
      return '';
    }
  }

  function safeNumber(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function uuid() {
    try {
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (_e) {}

    // Fallback UUID-ish generator
    var s = '';
    for (var i = 0; i < 32; i += 1) {
      s += Math.floor(Math.random() * 16).toString(16);
    }
    return (
      s.slice(0, 8) + '-' +
      s.slice(8, 12) + '-' +
      '4' + s.slice(13, 16) + '-' +
      'a' + s.slice(17, 20) + '-' +
      s.slice(20)
    );
  }

  function getCurrentScriptUrl() {
    try {
      var current = document.currentScript;
      if (current && current.src) return current.src;
    } catch (_e) {}
    try {
      var scripts = document.getElementsByTagName('script');
      if (scripts && scripts.length) {
        var last = scripts[scripts.length - 1];
        if (last && last.src) return last.src;
      }
    } catch (_e2) {}
    return '';
  }

  function parseUrl(raw) {
    try {
      return new URL(raw);
    } catch (_e) {
      try {
        return new URL(raw, window.location.href);
      } catch (_e2) {
        return null;
      }
    }
  }

  var scriptUrl = getCurrentScriptUrl();
  var parsedScriptUrl = parseUrl(scriptUrl);
  var scriptOrigin = parsedScriptUrl && parsedScriptUrl.origin ? parsedScriptUrl.origin : '';
  var store = (parsedScriptUrl && parsedScriptUrl.searchParams && parsedScriptUrl.searchParams.get('store')) || 'shawq';
  var endpointOverride = parsedScriptUrl && parsedScriptUrl.searchParams ? parsedScriptUrl.searchParams.get('endpoint') : null;
  var endpoint = endpointOverride || (scriptOrigin ? (scriptOrigin + '/api/pixels/shopify') : '/api/pixels/shopify');

  function storageKey(base) {
    return base + ':' + store;
  }

  function readStorage(storage, key) {
    try {
      return storage.getItem(key);
    } catch (_e) {
      return null;
    }
  }

  function writeStorage(storage, key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function getOrCreateClientId() {
    var key = storageKey('virona_si_client_id');
    var existing = readStorage(window.localStorage, key);
    if (existing) return existing;
    var id = uuid();
    writeStorage(window.localStorage, key, id);
    return id;
  }

  function getOrCreateSessionId() {
    var idKey = storageKey('virona_si_session_id');
    var tsKey = storageKey('virona_si_session_last_ts');
    var existing = readStorage(window.sessionStorage, idKey);
    var lastTs = safeNumber(readStorage(window.sessionStorage, tsKey));
    var now = Date.now();

    if (existing && lastTs != null && (now - lastTs) < SESSION_IDLE_MS) {
      writeStorage(window.sessionStorage, tsKey, String(now));
      return existing;
    }

    var id = uuid();
    writeStorage(window.sessionStorage, idKey, id);
    writeStorage(window.sessionStorage, tsKey, String(now));
    return id;
  }

  var clientId = getOrCreateClientId();
  var sessionId = getOrCreateSessionId();

  function sessionContext() {
    // Refresh session id if we went idle.
    sessionId = getOrCreateSessionId();

    return {
      clientId: clientId,
      sessionId: sessionId,
      navigator: { userAgent: safeString(navigator.userAgent, 280) },
      document: {
        title: safeString(document.title, 140),
        referrer: safeString(document.referrer, 280),
        location: { href: safeString(window.location.href, 800) }
      }
    };
  }

  function sendEvent(name, data, options) {
    try {
      var opts = options || {};
      var payload = {
        store: store,
        source: VERSION,
        timestamp: new Date().toISOString(),
        context: sessionContext(),
        event: {
          name: name,
          data: data || {}
        }
      };

      var body = JSON.stringify(payload);
      var useBeacon = !!opts.beacon;

      if (useBeacon && navigator && typeof navigator.sendBeacon === 'function') {
        try {
          var blob = new Blob([body], { type: 'application/json' });
          navigator.sendBeacon(endpoint, blob);
          return;
        } catch (_be) {}
      }

      fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (_e) {}
  }

  function elementSummary(el) {
    if (!el) return { key: 'unknown' };
    var tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
    var id = safeString(el.id, 60);
    var cls = '';
    try {
      if (el.classList && el.classList.length) {
        cls = Array.prototype.slice.call(el.classList, 0, 4).join('.');
      }
    } catch (_e) {}

    var role = safeString(el.getAttribute ? el.getAttribute('role') : '', 32);
    var type = safeString(el.getAttribute ? el.getAttribute('type') : '', 32);
    var href = '';
    try {
      if (tag === 'a' && el.getAttribute) {
        href = safeString(el.getAttribute('href') || '', 260);
      }
    } catch (_e2) {}

    var key = tag +
      (id ? ('#' + id) : '') +
      (cls ? ('.' + cls) : '') +
      (role ? ('[role=' + role + ']') : '') +
      (type ? ('[type=' + type + ']') : '');

    return {
      key: safeString(key, 220),
      tag: tag,
      id: id || null,
      class_hint: cls || null,
      role: role || null,
      type: type || null,
      href: href || null
    };
  }

  function isProbablyClickable(el) {
    if (!el || !el.closest) return false;
    var clickable = el.closest('a,button,[role=\"button\"],input[type=\"button\"],input[type=\"submit\"],summary,label');
    return !!clickable;
  }

  // ---------------------------------------------------------------------------
  // Rage clicks
  // ---------------------------------------------------------------------------
  var recentClicks = [];
  var lastRageSentAt = 0;

  function onClickCapture(e) {
    if (!e) return;
    var target = e.target && e.target.closest ? e.target.closest('a,button,[role=\"button\"],input,select,textarea,label,summary') : e.target;
    if (!target) return;

    var point = {
      t: Date.now(),
      x: safeNumber(e.clientX),
      y: safeNumber(e.clientY),
      target: elementSummary(target),
      hrefAtClick: safeString(window.location.href, 800)
    };

    // Keep only clicks in the rage window.
    var cutoff = point.t - RAGE_CLICK_WINDOW_MS;
    recentClicks = recentClicks.filter(function (c) { return c.t >= cutoff; });
    recentClicks.push(point);

    // Dead click timer (computed separately).
    scheduleDeadClick(point, target);

    if (point.t - lastRageSentAt < RAGE_CLICK_WINDOW_MS) return;
    if (recentClicks.length < RAGE_CLICK_MIN_CLICKS) return;

    var base = recentClicks[recentClicks.length - 1];
    var hits = recentClicks.filter(function (c) {
      if (c.target && base.target && c.target.key !== base.target.key) return false;
      if (c.x == null || c.y == null || base.x == null || base.y == null) return false;
      var dx = c.x - base.x;
      var dy = c.y - base.y;
      return Math.sqrt(dx * dx + dy * dy) <= RAGE_CLICK_RADIUS_PX;
    });

    if (hits.length >= RAGE_CLICK_MIN_CLICKS) {
      lastRageSentAt = point.t;
      recentClicks = [];
      sendEvent('rage_click', {
        target_key: base.target ? base.target.key : 'unknown',
        target: base.target || null,
        x: base.x,
        y: base.y
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Dead clicks
  // ---------------------------------------------------------------------------
  var pendingDead = null;
  var pendingDeadTimer = 0;

  function scheduleDeadClick(point, rawTarget) {
    try {
      if (!isProbablyClickable(rawTarget)) return;
      // Ignore obvious successful navigations (new tab / downloads, etc.) – too noisy.
      if (rawTarget && rawTarget.tagName && rawTarget.tagName.toLowerCase() === 'a') {
        var href = rawTarget.getAttribute ? (rawTarget.getAttribute('href') || '') : '';
        if (href && href.startsWith('mailto:')) return;
        if (href && href.startsWith('tel:')) return;
      }

      pendingDead = {
        t: point.t,
        href: point.hrefAtClick,
        target: point.target,
        x: point.x,
        y: point.y
      };

      if (pendingDeadTimer) clearTimeout(pendingDeadTimer);

      pendingDeadTimer = setTimeout(function () {
        pendingDeadTimer = 0;
        if (!pendingDead) return;

        // If location changed, it wasn't dead.
        if (pendingDead.href && safeString(window.location.href, 800) !== pendingDead.href) {
          pendingDead = null;
          return;
        }

        // If a submit just happened, assume it did something.
        if (Date.now() - lastFormSubmitAt < DEAD_CLICK_TIMEOUT_MS) {
          pendingDead = null;
          return;
        }

        sendEvent('dead_click', {
          target_key: pendingDead.target ? pendingDead.target.key : 'unknown',
          target: pendingDead.target || null,
          x: pendingDead.x,
          y: pendingDead.y
        });
        pendingDead = null;
      }, DEAD_CLICK_TIMEOUT_MS);
    } catch (_e) {}
  }

  // ---------------------------------------------------------------------------
  // Scroll depth
  // ---------------------------------------------------------------------------
  var scrollMaxPercent = 0;
  var lastScrollBucketSent = 0;
  var scrollRaf = 0;

  function computeScrollPercent() {
    var doc = document.documentElement;
    if (!doc) return 0;
    var scrollTop = window.pageYOffset || doc.scrollTop || 0;
    var viewport = window.innerHeight || 0;
    var height = Math.max(doc.scrollHeight || 0, document.body ? (document.body.scrollHeight || 0) : 0);
    var denom = Math.max(1, height - viewport);
    var pct = Math.round(Math.min(1, Math.max(0, scrollTop / denom)) * 100);
    return pct;
  }

  function handleScroll() {
    scrollRaf = 0;
    var pct = computeScrollPercent();
    if (pct > scrollMaxPercent) scrollMaxPercent = pct;

    for (var i = 0; i < SCROLL_BUCKETS.length; i += 1) {
      var bucket = SCROLL_BUCKETS[i];
      if (bucket <= lastScrollBucketSent) continue;
      if (pct >= bucket) {
        lastScrollBucketSent = bucket;
        sendEvent('scroll_depth', { percent: bucket, max_percent: scrollMaxPercent });
      }
    }
  }

  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(handleScroll);
  }

  // ---------------------------------------------------------------------------
  // Form friction (validation failures)
  // ---------------------------------------------------------------------------
  var lastFormSubmitAt = 0;

  function onFormSubmitCapture(e) {
    try {
      lastFormSubmitAt = Date.now();
      var form = e && e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'form'
        ? e.target
        : null;
      if (!form || typeof form.checkValidity !== 'function') return;

      if (form.checkValidity()) return;

      var invalid = null;
      try {
        invalid = form.querySelector(':invalid');
      } catch (_q) {}

      var summary = invalid ? elementSummary(invalid) : null;
      var fieldType = invalid && invalid.getAttribute ? safeString(invalid.getAttribute('type') || '', 40) : '';
      var fieldName = invalid && invalid.getAttribute ? safeString(invalid.getAttribute('name') || '', 80) : '';

      var validity = null;
      try {
        if (invalid && invalid.validity) {
          validity = {
            valueMissing: !!invalid.validity.valueMissing,
            typeMismatch: !!invalid.validity.typeMismatch,
            patternMismatch: !!invalid.validity.patternMismatch,
            tooShort: !!invalid.validity.tooShort,
            tooLong: !!invalid.validity.tooLong,
            rangeUnderflow: !!invalid.validity.rangeUnderflow,
            rangeOverflow: !!invalid.validity.rangeOverflow,
            stepMismatch: !!invalid.validity.stepMismatch,
            badInput: !!invalid.validity.badInput,
            customError: !!invalid.validity.customError
          };
        }
      } catch (_v) {}

      sendEvent('form_invalid', {
        form_id: safeString(form.id, 80) || null,
        field: summary,
        field_type: fieldType || null,
        field_name: fieldName || null,
        validity: validity
      });
    } catch (_e) {}
  }

  // ---------------------------------------------------------------------------
  // JS errors / unhandled rejections
  // ---------------------------------------------------------------------------
  function onWindowError(event) {
    try {
      if (!event) return;
      var message = safeString(event.message || '', 260);
      if (!message) return;
      var filename = safeString(event.filename || '', 260);
      var stack = '';
      try {
        if (event.error && event.error.stack) stack = safeString(event.error.stack, 900);
      } catch (_s) {}
      sendEvent('js_error', {
        message: message,
        filename: filename || null,
        line: safeNumber(event.lineno),
        column: safeNumber(event.colno),
        stack: stack || null
      });
    } catch (_e) {}
  }

  function onUnhandledRejection(event) {
    try {
      var reason = event && event.reason;
      var message = safeString((reason && reason.message) || reason || '', 260);
      if (!message) return;
      var stack = '';
      try {
        if (reason && reason.stack) stack = safeString(reason.stack, 900);
      } catch (_s) {}
      sendEvent('unhandled_rejection', {
        message: message,
        stack: stack || null
      });
    } catch (_e) {}
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  function flushOnHide() {
    // Send scroll max at end of page lifecycle (low volume, high signal).
    if (scrollMaxPercent > 0) {
      sendEvent('scroll_max', { max_percent: scrollMaxPercent }, { beacon: true });
    }
  }

  try {
    document.addEventListener('click', onClickCapture, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    document.addEventListener('submit', onFormSubmitCapture, true);
    window.addEventListener('pagehide', flushOnHide);
  } catch (_e) {}
})();
`.trim();
}

router.get('/pixel.js', (req, res) => {
  res.setHeader('content-type', 'application/javascript; charset=utf-8');
  res.setHeader('cache-control', `public, max-age=${PIXEL_SCRIPT_CACHE_SECONDS}`);
  res.send(renderUniversalPixelScript());
});

// In-memory live state (fast + works even if DB is read-only / unavailable).
// Structure: store -> sessionKey -> { type, tsMs }
const liveSessionsByStore = new Map();

// Best-effort GeoIP cache (keeps us from calling a GeoIP provider for every event).
// Keyed by raw IP string, but we only ever persist country codes in DB/memory state.
const geoIpCache = new Map(); // ip -> { countryCode, expiresAtMs }
const GEOIP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GEOIP_TIMEOUT_MS = parseInt(process.env.PIXELS_GEOIP_TIMEOUT_MS || '1000', 10);

function getStoreLiveMap(store) {
  const key = store || 'shawq';
  let map = liveSessionsByStore.get(key);
  if (!map) {
    map = new Map();
    liveSessionsByStore.set(key, map);
  }
  return map;
}

function resolveStore(payload) {
  const host = payload?.context?.document?.location?.host || payload?.context?.document?.location?.hostname;
  if (host && host.includes('shawqq')) return 'shawq';
  if (host && host.includes('virona')) return 'vironax';
  return payload?.store || 'shawq';
}

function normalizeEventType(payload) {
  const raw =
    payload?.event?.name ||
    payload?.name ||
    payload?.event ||
    payload?.type ||
    payload?.eventType ||
    payload?.event_name;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'unknown';
}

const CLARITY_SIGNAL_EVENT_TYPES = new Set([
  'rage_click',
  'dead_click',
  'js_error',
  'unhandled_rejection',
  'form_invalid',
  'scroll_depth',
  'scroll_max'
]);

function resolveSessionIntelligenceSource(payload, eventType) {
  const explicit = (typeof payload?.source === 'string' ? payload.source.trim() : '').toLowerCase();
  if (explicit) {
    if (explicit.includes('virona-pixel')) return 'theme_pixel';
    if (explicit.includes('shopify_custom_pixel')) return 'shopify_custom_pixel';
    return explicit.slice(0, 80);
  }

  const normalizedEventType = (typeof eventType === 'string' ? eventType.trim().toLowerCase() : '');
  if (CLARITY_SIGNAL_EVENT_TYPES.has(normalizedEventType)) return 'theme_pixel';
  return 'shopify_custom_pixel';
}

function normalizeEventTimestamp(payload) {
  const raw =
    payload?.timestamp ||
    payload?.event?.timestamp ||
    payload?.ts ||
    payload?.time;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : new Date().toISOString();
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function parseSqliteTimestamp(value) {
  if (!value || typeof value !== 'string') return NaN;
  if (value.includes('T')) {
    return Date.parse(value);
  }
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}

function extractCheckoutKey(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return (
    payload.checkoutToken ||
    payload.checkoutId ||
    payload.checkout_id ||
    payload?.data?.checkout?.token ||
    payload?.data?.checkout?.id ||
    payload?.checkout?.token ||
    payload?.checkout?.id ||
    payload.clientId ||
    payload.client_id ||
    payload?.context?.clientId ||
    payload?.context?.sessionId ||
    payload?.sessionId ||
    null
  );
}

function isCheckoutRelated(eventType = '') {
  const normalized = String(eventType).toLowerCase();
  if (!normalized || normalized === 'unknown') return false;
  return normalized.includes('checkout') || normalized === 'payment_info_submitted';
}

function isCheckoutCompleted(eventType = '') {
  return String(eventType).toLowerCase() === 'checkout_completed';
}

function updateLiveState(store, eventType, payload, timestampIso, countryCode) {
  if (!isCheckoutRelated(eventType)) return false;
  const key = extractCheckoutKey(payload);
  if (!key) return false;
  const tsMs = Date.parse(timestampIso) || Date.now();
  const sessions = getStoreLiveMap(store);
  const sessionKey = String(key);

  if (isCheckoutCompleted(eventType)) {
    sessions.delete(sessionKey);
    return true;
  }

  const existing = sessions.get(sessionKey);
  if (!existing || tsMs >= existing.tsMs) {
    sessions.set(sessionKey, {
      type: eventType,
      tsMs,
      countryCode: (typeof countryCode === 'string' && countryCode.trim()) ? countryCode.trim().toUpperCase() : null
    });
  }
  return true;
}

function computeLiveFromMemory(store, windowSeconds) {
  const sessions = getStoreLiveMap(store);
  const cutoffMs = Date.now() - windowSeconds * 1000;
  const gcCutoffMs = Date.now() - windowSeconds * 1000 * LIVE_STATE_GC_MULTIPLIER;

  let active = 0;
  let lastEventAt = null;
  const byCountry = {};

  for (const [key, entry] of sessions.entries()) {
    if (!entry || !Number.isFinite(entry.tsMs)) {
      sessions.delete(key);
      continue;
    }

    if (entry.tsMs < gcCutoffMs) {
      sessions.delete(key);
      continue;
    }

    if (!lastEventAt || entry.tsMs > lastEventAt) lastEventAt = entry.tsMs;

    if (entry.tsMs < cutoffMs) continue;
    if (isCheckoutCompleted(entry.type)) continue;
    active += 1;
    if (entry.countryCode) {
      byCountry[entry.countryCode] = (byCountry[entry.countryCode] || 0) + 1;
    }
  }

  return {
    count: active,
    lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
    byCountry
  };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  const ip = req.socket?.remoteAddress || null;
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function getCountryFromHeaders(req) {
  const headerKeys = [
    'cf-ipcountry',
    'x-vercel-ip-country',
    'x-geo-country',
    'x-country-code'
  ];
  for (const key of headerKeys) {
    const value = req.headers[key];
    if (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim())) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

function extractCountryCodeFromPayload(payload) {
  const candidates = [
    payload?.countryCode,
    payload?.country_code,
    payload?.data?.checkout?.shippingAddress?.countryCode,
    payload?.data?.checkout?.billingAddress?.countryCode,
    payload?.checkout?.shippingAddress?.countryCode,
    payload?.checkout?.billingAddress?.countryCode,
    payload?.geoipCountryCode
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim())) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}

async function lookupCountryCode(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const now = Date.now();
  const cached = geoIpCache.get(ip);
  if (cached && cached.expiresAtMs > now) return cached.countryCode;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEOIP_TIMEOUT_MS);

  try {
    // ipapi.co returns plain text country code at /country/
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/country/`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'virona-dashboard/geoip' }
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(text)) return null;
    geoIpCache.set(ip, { countryCode: text, expiresAtMs: now + GEOIP_CACHE_TTL_MS });
    return text;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

router.post('/shopify', async (req, res) => {
  try {
    const payload = req.body || {};
    const store = resolveStore(payload);
    const type = normalizeEventType(payload);
    const ts = normalizeEventTimestamp(payload);

    // Best-effort GeoIP enrichment: prefer explicit checkout address country (when available),
    // then edge-provided headers, then IP-based lookup.
    const explicitCountry = extractCountryCodeFromPayload(payload);
    const headerCountry = explicitCountry ? null : getCountryFromHeaders(req);
    const ip = (explicitCountry || headerCountry) ? null : getClientIp(req);

    // NOTE: We don't persist raw IP. Only the derived country code (if found).
    // We keep the live state update synchronous; GeoIP happens in a microtask below.
    const countryCode = explicitCountry || headerCountry || (ip ? await lookupCountryCode(ip) : null);

    // Always update the live in-memory counter (even if DB writes fail).
    updateLiveState(store, type, payload, ts, countryCode);

    // Best-effort DB write (optional; useful for later analysis).
    try {
      const db = getDb();
      if (countryCode && !payload.geoipCountryCode) {
        payload.geoipCountryCode = countryCode;
      }
      db.prepare(`
        INSERT INTO shopify_pixel_events (store, event_type, event_ts, payload_json)
        VALUES (?, ?, ?, ?)
      `).run(store, type, ts, JSON.stringify(payload));
    } catch (dbError) {
      // Don't break live tracking if DB is unavailable/read-only.
      console.warn('[Pixels] Shopify DB insert failed:', dbError?.message || dbError);
    }

    // Session Intelligence normalized ingest (best-effort).
    try {
      const sessionIntelligenceSource = resolveSessionIntelligenceSource(payload, type);
      recordSessionIntelligenceEvent({ store, payload, source: sessionIntelligenceSource });
    } catch (siError) {
      console.warn('[Pixels] Session Intelligence ingest failed:', siError?.message || siError);
    }

    res.json({ success: true });
  } catch (error) {
    const wantsDebug = req.query.debug === '1' || process.env.PIXELS_DEBUG === '1';
    console.error('[Pixels] Shopify error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record event',
      ...(wantsDebug ? { details: error?.message || String(error) } : {})
    });
  }
});

router.get('/shopify/live', (req, res) => {
  try {
    const store = req.query.store || 'shawq';
    const requestedWindow = parseInt(req.query.windowSeconds, 10);
    const baseWindow = Number.isFinite(requestedWindow) ? requestedWindow : DEFAULT_WINDOW_SECONDS;
    const windowSeconds = Math.min(Math.max(baseWindow, 30), MAX_WINDOW_SECONDS);
    const mem = computeLiveFromMemory(store, windowSeconds);
    const wantsDebug = req.query.debug === '1' || process.env.PIXELS_DEBUG === '1';
    let dbDegraded = false;

    // Optional DB-backed reconciliation: if memory has nothing yet (fresh deploy),
    // try to bootstrap the counter from the last window of DB events.
    if (mem.count === 0 && wantsDebug) {
      try {
        const db = getDb();
        const rows = db.prepare(`
          SELECT event_type, event_ts, created_at, payload_json
          FROM shopify_pixel_events
          WHERE store = ? AND created_at >= datetime('now', ?)
        `).all(store, `-${windowSeconds} seconds`);

        for (const row of rows) {
          const eventType = row.event_type || 'unknown';
          const payload = safeJsonParse(row.payload_json) || {};
          const tsIso = row.event_ts || row.created_at || payload?.timestamp || new Date().toISOString();
          updateLiveState(store, eventType, payload, tsIso);
        }
      } catch (dbError) {
        dbDegraded = true;
        console.warn('[Pixels] Shopify DB read failed:', dbError?.message || dbError);
      }
    }

    const finalMem = computeLiveFromMemory(store, windowSeconds);

    res.json({
      success: true,
      store,
      count: finalMem.count,
      byCountry: finalMem.byCountry,
      windowSeconds,
      updatedAt: new Date().toISOString(),
      lastEventAt: finalMem.lastEventAt,
      ...(wantsDebug ? { degraded: dbDegraded, memorySize: getStoreLiveMap(store).size } : {})
    });
  } catch (error) {
    const wantsDebug = req.query.debug === '1' || process.env.PIXELS_DEBUG === '1';
    console.error('[Pixels] Shopify live error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to compute live checkouts',
      ...(wantsDebug ? { details: error?.message || String(error) } : {})
    });
  }
});

export default router;
