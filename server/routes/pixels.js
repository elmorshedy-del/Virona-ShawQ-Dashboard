import express from 'express';
import { getDb } from '../db/database.js';
import { recordSessionIntelligenceEvent } from '../services/sessionIntelligenceService.js';
import { recordBlackboxEvent, sanitizeShopifyPixelPayloadForBlackbox } from '../services/blackboxService.js';
import {
  listSessionIntelligencePublicSurveyTemplates,
  recordSessionIntelligenceSurveyResponse
} from '../services/sessionIntelligenceSurveyService.js';
import {
  issueSessionIntelligencePublicSurveyToken,
  validateSessionIntelligencePublicSurveyRequest
} from '../utils/sessionIntelligenceSurveyAccess.js';

const router = express.Router();

const DEFAULT_WINDOW_SECONDS = 180;
const MAX_WINDOW_SECONDS = 1800;
const LIVE_STATE_GC_MULTIPLIER = 6; // keep some buffer beyond the visible window

const PIXEL_SCRIPT_CACHE_SECONDS = 300; // keep short so we can ship fixes quickly
const PIXEL_SCRIPT_VERSION = 'virona-pixel-v2';

const LIVE_DB_BOOTSTRAP_TTL_MS = 60 * 1000;
const liveDbBootstrapByKey = new Map();
const SURVEY_PUBLIC_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const SURVEY_PUBLIC_RATE_LIMIT_MAX_REQUESTS = 12;
const SURVEY_PUBLIC_RATE_LIMIT_MAX_ENTRIES = 5000;
const surveyPublicRateLimit = new Map();

function safeString(value, maxLength = 255) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
}

function shouldBootstrapLiveFromDb(store, windowSeconds) {
  const storeKey = typeof store === 'string' && store.trim() ? store.trim() : 'default';
  const key = `${storeKey}:${Number(windowSeconds) || 0}`;
  const now = Date.now();
  const last = liveDbBootstrapByKey.get(key);
  if (Number.isFinite(last) && (now - last) < LIVE_DB_BOOTSTRAP_TTL_MS) return false;
  liveDbBootstrapByKey.set(key, now);
  return true;
}

function renderUniversalPixelScript({ surveyPublicToken = '' } = {}) {
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
  var CLIENT_ID_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;
  var SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
  var DEAD_CLICK_TIMEOUT_MS = 1200;
  var RAGE_CLICK_WINDOW_MS = 800;
  var RAGE_CLICK_MIN_CLICKS = 3;
  var RAGE_CLICK_RADIUS_PX = 30;
  var MEANINGFUL_ACTION_MAX_AGE_MS = 10 * 60 * 1000;
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
  var platform = (parsedScriptUrl && parsedScriptUrl.searchParams && parsedScriptUrl.searchParams.get('platform')) || '';
  var endpointOverride = parsedScriptUrl && parsedScriptUrl.searchParams ? parsedScriptUrl.searchParams.get('endpoint') : null;
  var endpoint = endpointOverride || (scriptOrigin ? (scriptOrigin + '/api/pixels/shopify') : '/api/pixels/shopify');
  var surveyTemplatesEndpoint = scriptOrigin
    ? (scriptOrigin + '/api/pixels/survey/templates')
    : '/api/pixels/survey/templates';
  var surveyRespondEndpoint = scriptOrigin
    ? (scriptOrigin + '/api/pixels/survey/respond')
    : '/api/pixels/survey/respond';
  var surveyPublicToken = ${JSON.stringify(surveyPublicToken)};

  function storageKey(base) {
    return base + ':' + store;
  }

  function cookieKey(base) {
    return (base + '__' + store).replace(/[^a-zA-Z0-9_-]/g, '_');
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

  function readCookie(name) {
    try {
      if (!document || typeof document.cookie !== 'string' || !document.cookie) return null;
      var encodedName = encodeURIComponent(name) + '=';
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i += 1) {
        var cookie = cookies[i].trim();
        if (cookie.indexOf(encodedName) !== 0) continue;
        return decodeURIComponent(cookie.slice(encodedName.length));
      }
    } catch (_e) {}
    return null;
  }

  function writeCookie(name, value, maxAgeSeconds) {
    try {
      if (!document) return false;
      var parts = [
        encodeURIComponent(name) + '=' + encodeURIComponent(value),
        'Path=/',
        'SameSite=Lax'
      ];
      if (window && window.location && window.location.protocol === 'https:') {
        parts.push('Secure');
      }
      if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
        parts.push('Max-Age=' + String(Math.round(maxAgeSeconds)));
      }
      document.cookie = parts.join('; ');
      return true;
    } catch (_e) {
      return false;
    }
  }

  function getOrCreateClientId() {
    var key = storageKey('virona_si_client_id');
    var bridgeKey = cookieKey('virona_si_client_id');
    var existing = readStorage(window.localStorage, key);
    if (existing) {
      writeCookie(bridgeKey, existing, CLIENT_ID_COOKIE_MAX_AGE_SECONDS);
      return existing;
    }
    var bridged = readCookie(bridgeKey);
    if (bridged) {
      writeStorage(window.localStorage, key, bridged);
      return bridged;
    }
    var id = uuid();
    writeStorage(window.localStorage, key, id);
    writeCookie(bridgeKey, id, CLIENT_ID_COOKIE_MAX_AGE_SECONDS);
    return id;
  }

  function persistSessionBridge(idKey, tsKey, bridgeIdKey, bridgeTsKey, sessionId, now, writeIdToStorage) {
    var nowString = String(now);
    if (writeIdToStorage) {
      writeStorage(window.sessionStorage, idKey, sessionId);
    }
    writeStorage(window.sessionStorage, tsKey, nowString);
    writeCookie(bridgeIdKey, sessionId, SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS);
    writeCookie(bridgeTsKey, nowString, SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS);
    return sessionId;
  }

  function getOrCreateSessionId() {
    var idKey = storageKey('virona_si_session_id');
    var tsKey = storageKey('virona_si_session_last_ts');
    var bridgeIdKey = cookieKey('virona_si_session_id');
    var bridgeTsKey = cookieKey('virona_si_session_last_ts');
    var now = Date.now();
    var existing = readStorage(window.sessionStorage, idKey);
    var lastTs = safeNumber(readStorage(window.sessionStorage, tsKey));
    var sessionId = null;
    var writeIdToStorage = false;

    if (existing && lastTs != null && (now - lastTs) < SESSION_IDLE_MS) {
      sessionId = existing;
    } else {
      var bridged = readCookie(bridgeIdKey);
      var bridgedTs = safeNumber(readCookie(bridgeTsKey));
      if (bridged && bridgedTs != null && (now - bridgedTs) < SESSION_IDLE_MS) {
        sessionId = bridged;
        writeIdToStorage = true;
      } else {
        sessionId = uuid();
        writeIdToStorage = true;
      }
    }

    return persistSessionBridge(idKey, tsKey, bridgeIdKey, bridgeTsKey, sessionId, now, writeIdToStorage);
  }

  function getOrCreateTabId() {
    var key = storageKey('virona_si_tab_id');
    var existing = readStorage(window.sessionStorage, key);
    if (existing) return existing;
    var id = uuid();
    writeStorage(window.sessionStorage, key, id);
    return id;
  }

  function detectKnownUserId() {
    try {
      var candidates = [
        window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.page && (window.ShopifyAnalytics.meta.page.customerId || window.ShopifyAnalytics.meta.page.customer_id),
        window.meta && window.meta.page && (window.meta.page.customerId || window.meta.page.customer_id),
        window.Shopify && (window.Shopify.customerId || window.Shopify.customer_id),
        document && document.documentElement && document.documentElement.getAttribute && document.documentElement.getAttribute('data-customer-id')
      ];
      for (var i = 0; i < candidates.length; i += 1) {
        var candidate = safeString(candidates[i], 160);
        if (candidate) return candidate;
      }
    } catch (_e) {}
    return '';
  }

  var clientId = getOrCreateClientId();
  var sessionId = getOrCreateSessionId();
  var tabId = getOrCreateTabId();
  var eventSequence = 0;
  var lastMeaningfulAction = null;

  function sessionContext() {
    // Refresh session id if we went idle.
    sessionId = getOrCreateSessionId();
    tabId = getOrCreateTabId();

    return {
      clientId: clientId,
      sessionId: sessionId,
      userId: detectKnownUserId() || null,
      tabId: tabId,
      platform: safeString(platform, 40) || null,
      navigator: { userAgent: safeString(navigator.userAgent, 280) },
      document: {
        title: safeString(document.title, 140),
        referrer: safeString(document.referrer, 280),
        location: {
          href: safeString(window.location.href, 800),
          pathname: safeString(window.location.pathname, 500),
          host: safeString(window.location.host, 160)
        }
      }
    };
  }

  function sendEvent(name, data, options) {
    try {
      var opts = options || {};
      var payload = {
        store: store,
        source: VERSION,
        id: uuid(),
        seq: (eventSequence += 1),
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

  function currentPageUrl() {
    try {
      return safeString(window.location.href, 1200);
    } catch (_e) {
      return '';
    }
  }

  function currentPagePath() {
    try {
      return safeString(window.location.pathname || '', 500);
    } catch (_e) {
      return '';
    }
  }

  function rememberMeaningfulAction(name, data) {
    lastMeaningfulAction = {
      name: safeString(name, 120) || 'unknown',
      data: data || null,
      pageUrl: currentPageUrl(),
      pagePath: currentPagePath(),
      timestamp: new Date().toISOString()
    };
  }

  function readSurveyContext() {
    return {
      version: VERSION,
      store: store,
      clientId: clientId,
      sessionId: getOrCreateSessionId(),
      pageUrl: currentPageUrl(),
      pagePath: currentPagePath()
    };
  }

  function fetchSurveyTemplates(options) {
    var opts = options || {};
    var params = new URLSearchParams();
    params.set('store', store);
    if (opts.activeOnly !== false) params.set('activeOnly', 'true');
    if (opts.startDate) params.set('startDate', safeString(opts.startDate, 20));
    if (opts.endDate) params.set('endDate', safeString(opts.endDate, 20));
    params.set('pageUrl', currentPageUrl());
    if (!surveyPublicToken) {
      return Promise.reject(new Error('Survey SDK is not authorized for this storefront'));
    }
    return fetch(surveyTemplatesEndpoint + '?' + params.toString(), {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'X-Virona-Survey-Token': surveyPublicToken }
    }).then(function (response) {
      return response.text().then(function (raw) {
        var data = raw ? JSON.parse(raw) : null;
        if (!response.ok || !data || data.success === false) {
          throw new Error((data && (data.error || data.message)) || ('Template request failed (' + response.status + ')'));
        }
        return data;
      });
    });
  }

  function submitSurveyResponse(input) {
    var payload = input && typeof input === 'object' ? input : {};
    var context = readSurveyContext();
    if (!surveyPublicToken) {
      return Promise.reject(new Error('Survey SDK is not authorized for this storefront'));
    }
    return fetch(surveyRespondEndpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'X-Virona-Survey-Token': surveyPublicToken
      },
      body: JSON.stringify({
        store: store,
        source: 'virona_pixel_sdk',
        templateKey: safeString(payload.templateKey || payload.template_key, 80),
        responseChoiceKey: safeString(payload.responseChoiceKey || payload.response_choice_key, 80),
        responseChoiceLabel: safeString(payload.responseChoiceLabel || payload.response_choice_label, 160),
        responseText: safeString(payload.responseText || payload.response_text, 1000),
        linkConsent: typeof payload.linkConsent === 'boolean' ? payload.linkConsent : true,
        issueKey: safeString(payload.issueKey || payload.issue_key, 160),
        userId: safeString(payload.userId || payload.user_id, 120),
        metadata: payload.metadata || null,
        pageUrl: safeString(payload.pageUrl || payload.page_url, 1200) || context.pageUrl,
        pagePath: safeString(payload.pagePath || payload.page_path, 500) || context.pagePath,
        clientId: safeString(payload.clientId || payload.client_id, 160) || context.clientId,
        sessionId: safeString(payload.sessionId || payload.session_id, 160) || context.sessionId,
        submittedAt: new Date().toISOString()
      })
    }).then(function (response) {
      return response.text().then(function (raw) {
        var data = raw ? JSON.parse(raw) : null;
        if (!response.ok || !data || data.success === false) {
          throw new Error((data && (data.error || data.message)) || ('Survey submit failed (' + response.status + ')'));
        }
        return data;
      });
    });
  }

  var surveyApi = {
    version: VERSION,
    getContext: readSurveyContext,
    listTemplates: fetchSurveyTemplates,
    submitResponse: submitSurveyResponse
  };

  try {
    window.VironaSurvey = surveyApi;
    window.__VIRONA_SURVEY__ = surveyApi;
  } catch (_e) {}

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

  function elementText(el) {
    try {
      return safeString((el && el.textContent) || '', 160).replace(/\s+/g, ' ').trim();
    } catch (_e) {
      return '';
    }
  }

  function getFieldLabel(el) {
    if (!el) return '';
    try {
      if (el.labels && el.labels.length) {
        return elementText(el.labels[0]);
      }
    } catch (_e) {}
    try {
      if (el.id) {
        var explicit = document.querySelector('label[for=\"' + CSS.escape(el.id) + '\"]');
        if (explicit) return elementText(explicit);
      }
    } catch (_e2) {}
    try {
      var wrapped = el.closest && el.closest('label');
      if (wrapped) return elementText(wrapped);
    } catch (_e3) {}
    return '';
  }

  function closestMatching(el, selector) {
    try {
      return el && el.closest ? el.closest(selector) : null;
    } catch (_e) {
      return null;
    }
  }

  function isQuantityField(el, labelText) {
    var haystack = [
      safeString(el && el.name, 120),
      safeString(el && el.id, 120),
      safeString(el && el.getAttribute && el.getAttribute('aria-label'), 120),
      labelText
    ].join(' ').toLowerCase();
    return haystack.indexOf('quantity') >= 0 || /\bqty\b/.test(haystack);
  }

  function classifyOptionSelection(el, labelText) {
    var hint = [
      safeString(el && el.name, 120),
      safeString(el && el.id, 120),
      safeString(el && el.getAttribute && el.getAttribute('data-option-name'), 120),
      safeString(el && el.getAttribute && el.getAttribute('data-name'), 120),
      labelText
    ].join(' ').toLowerCase();
    if (!hint) return '';
    if (hint.indexOf('size') >= 0) return 'size_selected';
    if (
      hint.indexOf('variant') >= 0 ||
      hint.indexOf('option') >= 0 ||
      hint.indexOf('color') >= 0 ||
      hint.indexOf('colour') >= 0 ||
      hint.indexOf('style') >= 0
    ) {
      return 'variant_selected';
    }
    return '';
  }

  function buildSelectionPayload(el, labelText) {
    var value = '';
    try {
      if (el && typeof el.value !== 'undefined') value = safeString(el.value, 120);
    } catch (_e) {}
    if (!value) value = elementText(el);
    return {
      target_key: elementSummary(el).key,
      target: elementSummary(el),
      label: labelText || null,
      value: value || null
    };
  }

  function findAddToCartTarget(target) {
    return closestMatching(
      target,
      'button[name=\"add\"], [name=\"add\"], [data-add-to-cart], [data-product-atc], form[action*=\"/cart/add\"] button, form[action*=\"/cart/add\"] [type=\"submit\"], button[id*=\"AddToCart\"]'
    );
  }

  function findCheckoutTarget(target) {
    return closestMatching(
      target,
      'a[href*=\"/checkout\"], button[name=\"checkout\"], input[name=\"checkout\"], [data-checkout-button], [data-cart-checkout], form[action*=\"/checkout\"] button, form[action*=\"/checkout\"] [type=\"submit\"]'
    );
  }

  function findCartTarget(target) {
    return closestMatching(
      target,
      'a[href=\"/cart\"], a[href$=\"/cart\"], [data-cart-toggle], [data-cart-drawer-toggle], [aria-controls*=\"cart\"], button[name=\"cart\"]'
    );
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

    var checkoutTarget = findCheckoutTarget(target);
    if (checkoutTarget) {
      var checkoutPayload = {
        target_key: elementSummary(checkoutTarget).key,
        target: elementSummary(checkoutTarget),
        label: elementText(checkoutTarget) || null
      };
      rememberMeaningfulAction('checkout_cta_clicked', checkoutPayload);
      sendEvent('checkout_cta_clicked', checkoutPayload);
    }

    var addToCartTarget = findAddToCartTarget(target);
    if (addToCartTarget) {
      var addToCartPayload = {
        target_key: elementSummary(addToCartTarget).key,
        target: elementSummary(addToCartTarget),
        label: elementText(addToCartTarget) || null
      };
      rememberMeaningfulAction('add_to_cart_clicked', addToCartPayload);
      sendEvent('add_to_cart_clicked', addToCartPayload);
    }

    var cartTarget = findCartTarget(target);
    if (cartTarget) {
      var cartPayload = {
        target_key: elementSummary(cartTarget).key,
        target: elementSummary(cartTarget),
        label: elementText(cartTarget) || null
      };
      rememberMeaningfulAction('cart_drawer_opened', cartPayload);
      sendEvent('cart_drawer_opened', cartPayload);
    }

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

  function onChangeCapture(e) {
    try {
      var target = e && e.target ? e.target : null;
      if (!target) return;
      var labelText = getFieldLabel(target);

      if (isQuantityField(target, labelText)) {
        var quantityPayload = buildSelectionPayload(target, labelText);
        quantityPayload.quantity = safeNumber(target.value);
        rememberMeaningfulAction('cart_quantity_changed', quantityPayload);
        sendEvent('cart_quantity_changed', quantityPayload);
        return;
      }

      var selectionType = classifyOptionSelection(target, labelText);
      if (!selectionType) return;
      var selectionPayload = buildSelectionPayload(target, labelText);
      rememberMeaningfulAction(selectionType, selectionPayload);
      sendEvent(selectionType, selectionPayload);
    } catch (_error) {}
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
    if (lastMeaningfulAction) {
      var actionAgeMs = Date.now() - (Date.parse(lastMeaningfulAction.timestamp) || 0);
      if (actionAgeMs >= 0 && actionAgeMs <= MEANINGFUL_ACTION_MAX_AGE_MS) {
        sendEvent('last_action_checkpoint', {
          action_name: lastMeaningfulAction.name,
          action_ts: lastMeaningfulAction.timestamp,
          action: lastMeaningfulAction.data,
          page_url: lastMeaningfulAction.pageUrl,
          page_path: lastMeaningfulAction.pagePath
        }, { beacon: true });
      }
    }
  }

  try {
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('change', onChangeCapture, true);
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
  const store = safeString(req.query.store, 80) || 'shawq';
  const surveyPublicToken = issueSessionIntelligencePublicSurveyToken(req, store);
  res.setHeader('content-type', 'application/javascript; charset=utf-8');
  res.setHeader('vary', 'Origin, Referer');
  res.setHeader(
    'cache-control',
    surveyPublicToken
      ? 'private, no-store, max-age=0'
      : `public, max-age=${PIXEL_SCRIPT_CACHE_SECONDS}`
  );
  res.send(renderUniversalPixelScript({ surveyPublicToken }));
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

function cleanupSurveyPublicRateLimit(nowMs) {
  if (surveyPublicRateLimit.size <= SURVEY_PUBLIC_RATE_LIMIT_MAX_ENTRIES) return;
  for (const [key, entry] of surveyPublicRateLimit.entries()) {
    if (!entry || !Number.isFinite(entry.resetAt) || entry.resetAt <= nowMs) {
      surveyPublicRateLimit.delete(key);
    }
  }
}

function checkSurveyPublicRateLimit(store, sessionId, ip) {
  const nowMs = Date.now();
  cleanupSurveyPublicRateLimit(nowMs);
  const key = [
    safeString(store, 80) || 'default',
    safeString(sessionId, 160) || 'no-session',
    safeString(ip, 80) || 'no-ip'
  ].join(':');
  const existing = surveyPublicRateLimit.get(key);
  if (!existing || !Number.isFinite(existing.resetAt) || existing.resetAt <= nowMs) {
    surveyPublicRateLimit.set(key, {
      count: 1,
      resetAt: nowMs + SURVEY_PUBLIC_RATE_LIMIT_WINDOW_MS
    });
    return { ok: true };
  }
  if (existing.count >= SURVEY_PUBLIC_RATE_LIMIT_MAX_REQUESTS) {
    return { ok: false, retryAfterMs: Math.max(0, existing.resetAt - nowMs) };
  }
  existing.count += 1;
  return { ok: true };
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

function ensureRequestContext(payload, req) {
  if (!payload || typeof payload !== 'object') return;
  if (!payload.context || typeof payload.context !== 'object') payload.context = {};
  if (!payload.context.navigator || typeof payload.context.navigator !== 'object') payload.context.navigator = {};
  if (!payload.context.document || typeof payload.context.document !== 'object') payload.context.document = {};

  const headerUserAgent = typeof req?.headers?.['user-agent'] === 'string'
    ? req.headers['user-agent'].trim()
    : '';
  if (headerUserAgent && !payload.context.navigator.userAgent) {
    payload.context.navigator.userAgent = headerUserAgent.slice(0, 512);
  }

  const headerReferrer = typeof req?.headers?.referer === 'string'
    ? req.headers.referer.trim()
    : '';
  if (headerReferrer && !payload.context.document.referrer) {
    payload.context.document.referrer = headerReferrer.slice(0, 600);
  }
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

router.get('/survey/templates', (req, res) => {
  try {
    const store = safeString(req.query.store, 80);
    if (!store) return res.status(400).json({ success: false, error: 'Missing store' });

    const validation = validateSessionIntelligencePublicSurveyRequest(req, {
      store,
      pageUrl: req.query.pageUrl
    });
    if (!validation.ok) {
      return res.status(403).json({ success: false, error: validation.reason || 'Forbidden' });
    }

    const result = listSessionIntelligencePublicSurveyTemplates({
      store,
      activeOnly: true
    });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[Pixels] Survey templates error:', error);
    res.status(500).json({ success: false, error: 'Failed to load survey templates' });
  }
});

router.post('/survey/respond', (req, res) => {
  try {
    const store = safeString(req.body?.store, 80);
    if (!store) return res.status(400).json({ success: false, error: 'Missing store' });

    const validation = validateSessionIntelligencePublicSurveyRequest(req, {
      store,
      pageUrl: req.body?.pageUrl || req.body?.page_url
    });
    if (!validation.ok) {
      return res.status(403).json({ success: false, error: validation.reason || 'Forbidden' });
    }

    const sessionId = safeString(req.body?.sessionId || req.body?.session_id, 160);
    const clientId = safeString(req.body?.clientId || req.body?.client_id, 160);
    if (!sessionId && !clientId) {
      return res.status(400).json({ success: false, error: 'Missing survey session context' });
    }

    const ip = getClientIp(req);
    const rateLimit = checkSurveyPublicRateLimit(store, sessionId || clientId, ip);
    if (!rateLimit.ok) {
      return res.status(429).json({
        success: false,
        error: 'Too many survey submissions from this shopper context. Try again later.'
      });
    }

    const result = recordSessionIntelligenceSurveyResponse({
      store,
      payload: req.body || {},
      source: req.body?.source || 'storefront',
      requireActiveTemplate: true,
      requireExistingSessionContext: true
    });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (error) {
    console.error('[Pixels] Survey response error:', error);
    res.status(500).json({ success: false, error: 'Failed to record survey response' });
  }
});

router.post('/shopify', async (req, res) => {
  const wantsDebug = req.query.debug === '1' || process.env.PIXELS_DEBUG === '1';
  try {
    const payload = req.body || {};
    ensureRequestContext(payload, req);
    const store = resolveStore(payload);
    const type = normalizeEventType(payload);
    const ts = normalizeEventTimestamp(payload);
    let dbWriteError = null;
    let siIngest = null;
    let blackboxIngest = null;

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
      dbWriteError = dbError;
      console.warn('[Pixels] Shopify DB insert failed:', dbError?.message || dbError);
    }

    // Session Intelligence normalized ingest (best-effort).
    try {
      const sessionIntelligenceSource = resolveSessionIntelligenceSource(payload, type);
      siIngest = recordSessionIntelligenceEvent({ store, payload, source: sessionIntelligenceSource });
    } catch (siError) {
      siIngest = { ok: false, error: siError?.message || String(siError) };
      console.warn('[Pixels] Session Intelligence ingest failed:', siError?.message || siError);
    }

    // Checkout Blackbox mirror (best-effort): records only a minimal, non-PII payload.
    try {
      if (isCheckoutRelated(type)) {
        const sanitized = sanitizeShopifyPixelPayloadForBlackbox(payload, {
          store,
          eventType: type,
          timestamp: ts,
          source: 'shopify_custom_pixel',
          channel: 'shopify_pixel_bridge'
        });
        blackboxIngest = recordBlackboxEvent({ store, payload: sanitized, req });
      }
    } catch (bbError) {
      blackboxIngest = { ok: false, error: bbError?.message || String(bbError) };
      console.warn('[Pixels] Blackbox mirror failed:', bbError?.message || bbError);
    }

    res.json({
      success: true,
      ...(wantsDebug ? {
        debug: {
          store,
          type,
          timestamp: ts,
          dbWriteOk: !dbWriteError,
          dbWriteError: dbWriteError ? (dbWriteError?.message || String(dbWriteError)) : null,
          siIngest: siIngest || { ok: false, reason: 'ingest_not_executed' },
          blackboxIngest
        }
      } : {})
    });
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

    // DB-backed reconciliation: if memory has nothing yet (fresh deploy),
    // bootstrap the counter from the last window of DB events so deploys don't reset the UI.
    if (mem.count === 0 && shouldBootstrapLiveFromDb(store, windowSeconds)) {
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
