import { resolveStoreUrl } from './storeProfileService.js';

const DEFAULT_STORE = 'shawq';
const DEFAULT_APP_BASE_URL = 'https://virona-shawq-dashboard-production-7573.up.railway.app';
const MAX_TEXT_LENGTH = 240;
const SHOPIFY_THEME_PIXEL_PLATFORM = 'shopify';
const LOCALHOST_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i;

export const SESSION_INTELLIGENCE_IDENTITY_SPINE = [
  {
    key: 'client_id',
    label: 'Browser client ID',
    purpose: 'Primary anonymous shopper identity across visits and event sources.',
    capturePriority: 'required'
  },
  {
    key: 'session_id',
    label: 'Session ID',
    purpose: 'Visit-level identity for ordered session timelines and daily case files.',
    capturePriority: 'required'
  },
  {
    key: 'shopper_number',
    label: 'Shopper number',
    purpose: 'Internal stitched shopper identity used in dashboard narratives.',
    capturePriority: 'derived'
  },
  {
    key: 'user_id',
    label: 'Known user ID',
    purpose: 'Optional authenticated identity when Shopify or theme context exposes a customer ID.',
    capturePriority: 'recommended'
  },
  {
    key: 'cart_token',
    label: 'Cart token',
    purpose: 'Bridges storefront cart actions to cart and checkout behavior.',
    capturePriority: 'recommended'
  },
  {
    key: 'checkout_token',
    label: 'Checkout token',
    purpose: 'Bridges checkout steps, payment submission, and purchase reconciliation.',
    capturePriority: 'required_for_checkout'
  },
  {
    key: 'order_id',
    label: 'Order ID',
    purpose: 'Final source-of-truth identity for reconciled purchases.',
    capturePriority: 'required_for_purchase'
  },
  {
    key: 'tab_id',
    label: 'Browser tab ID',
    purpose: 'Separates multi-tab behavior and reduces duplicate journey noise.',
    capturePriority: 'recommended'
  }
];

export const SESSION_INTELLIGENCE_CAPTURE_LAYERS = [
  {
    key: 'shopify_custom_pixel',
    label: 'Shopify customer events',
    role: 'Official commerce funnel coverage: product, cart, checkout, payment, purchase.'
  },
  {
    key: 'theme_pixel',
    label: 'Theme pixel',
    role: 'Behavioral detail: clicks, variant changes, checkout CTA clicks, JS errors, last action before exit.'
  },
  {
    key: 'reconciliation',
    label: 'Server reconciliation',
    role: 'Backfills missing purchase or checkout continuity from Shopify truth and internal links.'
  },
  {
    key: 'survey',
    label: 'Linked survey responses',
    role: 'Captures stated shopper reasons and links them back to journeys and issue clusters.'
  }
];

export const SHOPIFY_STANDARD_CUSTOM_PIXEL_EVENTS = [
  'page_viewed',
  'collection_viewed',
  'product_viewed',
  'search_submitted',
  'product_added_to_cart',
  'product_removed_from_cart',
  'cart_viewed',
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed'
];

export const SESSION_INTELLIGENCE_EVENT_CATALOG = [
  {
    key: 'page_viewed',
    category: 'journey',
    stage: 'landing',
    sources: ['shopify_custom_pixel'],
    description: 'Entry and navigation coverage for all storefront pages.'
  },
  {
    key: 'collection_viewed',
    category: 'journey',
    stage: 'browse',
    sources: ['shopify_custom_pixel'],
    description: 'Collection / category navigation step.'
  },
  {
    key: 'product_viewed',
    category: 'journey',
    stage: 'product',
    sources: ['shopify_custom_pixel'],
    description: 'Product detail page exposure.'
  },
  {
    key: 'search_submitted',
    category: 'journey',
    stage: 'browse',
    sources: ['shopify_custom_pixel'],
    description: 'Intentful search queries inside the storefront.'
  },
  {
    key: 'variant_selected',
    category: 'behavior',
    stage: 'product',
    sources: ['theme_pixel'],
    description: 'Theme-level variant or option selection for product decision analysis.'
  },
  {
    key: 'size_selected',
    category: 'behavior',
    stage: 'product',
    sources: ['theme_pixel'],
    description: 'Size-specific selection signal for apparel storefronts.'
  },
  {
    key: 'add_to_cart_clicked',
    category: 'behavior',
    stage: 'product',
    sources: ['theme_pixel'],
    description: 'Add-to-cart intent even if Shopify add_to_cart never succeeds.'
  },
  {
    key: 'product_added_to_cart',
    category: 'commerce',
    stage: 'cart',
    sources: ['shopify_custom_pixel'],
    description: 'Confirmed add-to-cart from Shopify customer events.'
  },
  {
    key: 'product_removed_from_cart',
    category: 'commerce',
    stage: 'cart',
    sources: ['shopify_custom_pixel'],
    description: 'Cart reversal / removal behavior from Shopify.'
  },
  {
    key: 'cart_quantity_changed',
    category: 'behavior',
    stage: 'cart',
    sources: ['theme_pixel'],
    description: 'Theme-level quantity change on cart or cart drawer.'
  },
  {
    key: 'cart_drawer_opened',
    category: 'behavior',
    stage: 'cart',
    sources: ['theme_pixel'],
    description: 'Cart drawer open intent for themes that do not navigate to /cart.'
  },
  {
    key: 'cart_viewed',
    category: 'commerce',
    stage: 'cart',
    sources: ['shopify_custom_pixel'],
    description: 'Confirmed cart view event.'
  },
  {
    key: 'checkout_cta_clicked',
    category: 'behavior',
    stage: 'checkout',
    sources: ['theme_pixel'],
    description: 'Checkout initiation intent before Shopify checkout instrumentation continues the trail.'
  },
  {
    key: 'checkout_started',
    category: 'commerce',
    stage: 'checkout',
    sources: ['shopify_custom_pixel'],
    description: 'Checkout entry from Shopify customer events.'
  },
  {
    key: 'checkout_contact_info_submitted',
    category: 'commerce',
    stage: 'checkout_contact',
    sources: ['shopify_custom_pixel'],
    description: 'Contact step completion.'
  },
  {
    key: 'checkout_address_info_submitted',
    category: 'commerce',
    stage: 'checkout_contact',
    sources: ['shopify_custom_pixel'],
    description: 'Address step submission on checkout.'
  },
  {
    key: 'checkout_shipping_info_submitted',
    category: 'commerce',
    stage: 'checkout_shipping',
    sources: ['shopify_custom_pixel'],
    description: 'Shipping step completion.'
  },
  {
    key: 'payment_info_submitted',
    category: 'commerce',
    stage: 'checkout_payment',
    sources: ['shopify_custom_pixel'],
    description: 'Payment information submitted, highest-value late-funnel signal before purchase.'
  },
  {
    key: 'checkout_completed',
    category: 'commerce',
    stage: 'purchase',
    sources: ['shopify_custom_pixel', 'reconciliation'],
    description: 'Checkout completion / purchase truth signal.'
  },
  {
    key: 'last_action_checkpoint',
    category: 'journey',
    stage: 'exit',
    sources: ['theme_pixel'],
    description: 'Last meaningful action snapshot emitted on page hide for detective summaries.'
  },
  {
    key: 'dead_click',
    category: 'diagnostic',
    stage: 'friction',
    sources: ['theme_pixel'],
    description: 'Repeated click with no visible progress.'
  },
  {
    key: 'rage_click',
    category: 'diagnostic',
    stage: 'friction',
    sources: ['theme_pixel'],
    description: 'Burst of repeated clicks on the same target.'
  },
  {
    key: 'js_error',
    category: 'diagnostic',
    stage: 'technical',
    sources: ['theme_pixel'],
    description: 'Frontend runtime error with filename and stack summary.'
  },
  {
    key: 'unhandled_rejection',
    category: 'diagnostic',
    stage: 'technical',
    sources: ['theme_pixel'],
    description: 'Unhandled promise rejection on storefront pages.'
  },
  {
    key: 'form_invalid',
    category: 'diagnostic',
    stage: 'friction',
    sources: ['theme_pixel'],
    description: 'Validation failure on theme forms.'
  },
  {
    key: 'scroll_depth',
    category: 'diagnostic',
    stage: 'engagement',
    sources: ['theme_pixel'],
    description: 'Scroll-depth buckets for page engagement and drop-off context.'
  }
];

function safeString(value, maxLength = MAX_TEXT_LENGTH) {
  if (value == null) return '';
  const normalized = String(value).trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizeStore(value) {
  return safeString(value, 80) || DEFAULT_STORE;
}

function normalizeAppBaseUrl(value) {
  const candidate = safeString(value, 512) || DEFAULT_APP_BASE_URL;
  return candidate.replace(/\/+$/, '');
}

function resolveDefaultAppBaseUrl(req) {
  const configured = normalizeAppBaseUrl(process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL);
  if (process.env.APP_BASE_URL) return configured;

  if (req && typeof req.get === 'function') {
    const host = safeString(req.get('host'), 255);
    if (host && LOCALHOST_HOST_RE.test(host)) {
      const protocol = safeString(req.get('x-forwarded-proto'), 20) || req.protocol || 'http';
      return normalizeAppBaseUrl(`${protocol}://${host}`);
    }
  }
  return configured;
}

function uniqueList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function buildEventGroupSummary(category) {
  return uniqueList(
    SESSION_INTELLIGENCE_EVENT_CATALOG
      .filter((item) => item.category === category)
      .map((item) => item.key)
  );
}

export function getSessionIntelligenceArchitecture({ store, appBaseUrl, storeUrl = null } = {}) {
  const normalizedStore = normalizeStore(store);
  const normalizedAppBaseUrl = normalizeAppBaseUrl(appBaseUrl);
  const resolvedStoreUrl = safeString(storeUrl, 512) || resolveStoreUrl(normalizedStore) || null;

  return {
    store: normalizedStore,
    appBaseUrl: normalizedAppBaseUrl,
    storeUrl: resolvedStoreUrl,
    identitySpine: SESSION_INTELLIGENCE_IDENTITY_SPINE,
    captureLayers: SESSION_INTELLIGENCE_CAPTURE_LAYERS,
    eventCatalog: SESSION_INTELLIGENCE_EVENT_CATALOG,
    eventGroups: {
      journey: buildEventGroupSummary('journey'),
      commerce: buildEventGroupSummary('commerce'),
      behavior: buildEventGroupSummary('behavior'),
      diagnostic: buildEventGroupSummary('diagnostic')
    }
  };
}

export function buildShopifyCustomPixelSnippet({ store, appBaseUrl } = {}) {
  const normalizedStore = normalizeStore(store);
  const endpoint = `${normalizeAppBaseUrl(appBaseUrl)}/api/pixels/shopify`;
  const eventNamesLiteral = JSON.stringify(SHOPIFY_STANDARD_CUSTOM_PIXEL_EVENTS, null, 2);

  return `// Virona Session Intelligence — Shopify Custom Pixel\n// Paste into Shopify Admin -> Settings -> Customer events -> Add custom pixel\n\nconst ENDPOINT = ${JSON.stringify(endpoint)};\nconst STORE = ${JSON.stringify(normalizedStore)};\nconst SOURCE = 'shopify_custom_pixel_v3';\nconst STANDARD_EVENTS = ${eventNamesLiteral};\nconst SESSION_IDLE_MS = 30 * 60 * 1000;\nconst CLIENT_ID_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;\nconst SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;\nconst MAX_STRING = 240;\nconst BROWSER_API = typeof browser !== 'undefined' ? browser : null;\nconst INIT_API = typeof init !== 'undefined' ? init : null;\nconst ANALYTICS_API = typeof analytics !== 'undefined' ? analytics : null;\nconst memoryStore = Object.create(null);\nlet localEventSequence = 0;\n\nfunction safeString(value, max = MAX_STRING) {\n  try {\n    const str = value == null ? '' : String(value).trim();\n    if (!str) return '';\n    return str.length > max ? str.slice(0, max) : str;\n  } catch (_error) {\n    return '';\n  }\n}\n\nfunction safeNumber(value) {\n  const n = Number(value);\n  return Number.isFinite(n) ? n : null;\n}\n\nfunction uuid() {\n  try {\n    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {\n      return crypto.randomUUID();\n    }\n  } catch (_error) {}\n\n  let raw = '';\n  for (let index = 0; index < 32; index += 1) {\n    raw += Math.floor(Math.random() * 16).toString(16);\n  }\n  return raw.slice(0, 8) + '-' + raw.slice(8, 12) + '-' + '4' + raw.slice(13, 16) + '-' + 'a' + raw.slice(17, 20) + '-' + raw.slice(20);\n}\n\nfunction storageKey(base) {\n  return base + ':' + STORE;\n}\n\nfunction cookieKey(base) {\n  return (base + '__' + STORE).replace(/[^a-zA-Z0-9_-]/g, '_');\n}\n\nasync function readBrowserStorage(area, key) {\n  try {\n    if (!area) return null;\n    if (typeof area.getItem === 'function') {\n      const value = await area.getItem(key);\n      return safeString(value, 320) || null;\n    }\n    if (typeof area.get === 'function') {\n      const value = await area.get(key);\n      return safeString(value, 320) || null;\n    }\n  } catch (_error) {}\n\n  return Object.prototype.hasOwnProperty.call(memoryStore, key)\n    ? safeString(memoryStore[key], 320) || null\n    : null;\n}\n\nasync function writeBrowserStorage(area, key, value) {\n  try {\n    if (area && typeof area.setItem === 'function') {\n      await area.setItem(key, value);\n      memoryStore[key] = value;\n      return true;\n    }\n    if (area && typeof area.set === 'function') {\n      await area.set(key, value);\n      memoryStore[key] = value;\n      return true;\n    }\n  } catch (_error) {}\n\n  memoryStore[key] = value;\n  return false;\n}\n\nasync function readBrowserCookie(name) {\n  try {\n    if (BROWSER_API && BROWSER_API.cookie) {\n      if (typeof BROWSER_API.cookie.get === 'function') {\n        const value = await BROWSER_API.cookie.get(name);\n        if (typeof value === 'string') return safeString(value, 320) || null;\n        if (value && typeof value.value === 'string') return safeString(value.value, 320) || null;\n      }\n      if (typeof BROWSER_API.cookie.getItem === 'function') {\n        const value = await BROWSER_API.cookie.getItem(name);\n        return safeString(value, 320) || null;\n      }\n    }\n  } catch (_error) {}\n\n  return Object.prototype.hasOwnProperty.call(memoryStore, 'cookie:' + name)\n    ? safeString(memoryStore['cookie:' + name], 320) || null\n    : null;\n}\n\nasync function writeBrowserCookie(name, value, _maxAgeSeconds) {\n  try {\n    if (BROWSER_API && BROWSER_API.cookie) {\n      if (typeof BROWSER_API.cookie.set === 'function') {\n        await BROWSER_API.cookie.set(name, value);\n        memoryStore['cookie:' + name] = value;\n        return true;\n      }\n      if (typeof BROWSER_API.cookie.setItem === 'function') {\n        await BROWSER_API.cookie.setItem(name, value);\n        memoryStore['cookie:' + name] = value;\n        return true;\n      }\n    }\n  } catch (_error) {}\n\n  memoryStore['cookie:' + name] = value;\n  return false;\n}\n\nfunction resolveKnownUserId(event) {\n  const candidates = [\n    event && event.data && event.data.customer && event.data.customer.id,\n    event && event.data && event.data.checkout && event.data.checkout.customer && event.data.checkout.customer.id,\n    INIT_API && INIT_API.data && INIT_API.data.customer && INIT_API.data.customer.id,\n    INIT_API && INIT_API.data && INIT_API.data.checkout && INIT_API.data.checkout.customer && INIT_API.data.checkout.customer.id\n  ];\n\n  for (let index = 0; index < candidates.length; index += 1) {\n    const candidate = safeString(candidates[index], 160);\n    if (candidate) return candidate;\n  }\n\n  return '';\n}\n\nfunction buildContext(event, identity) {\n  const base = event && event.context && typeof event.context === 'object' ? event.context : null;\n  let context = {};\n  if (base) {\n    try {\n      context = JSON.parse(JSON.stringify(base));\n    } catch (_error) {\n      context = {};\n    }\n  }\n  context.clientId = identity.clientId;\n  context.client_id = identity.clientId;\n  context.sessionId = identity.sessionId;\n  context.session_id = identity.sessionId;\n  context.tabId = identity.tabId;\n  context.tab_id = identity.tabId;\n  if (identity.userId) {\n    context.userId = identity.userId;\n    context.user_id = identity.userId;\n  }\n  const shopifyClientId = safeString(event && (event.clientId || event.client_id), 160);\n  if (shopifyClientId) context.shopifyClientId = shopifyClientId;\n  return context;\n}\n\nasync function getOrCreateClientId(event) {\n  const storageName = storageKey('virona_si_client_id');\n  const cookieName = cookieKey('virona_si_client_id');\n  const fromStorage = await readBrowserStorage(BROWSER_API && BROWSER_API.localStorage, storageName);\n  if (fromStorage) {\n    await writeBrowserCookie(cookieName, fromStorage, CLIENT_ID_COOKIE_MAX_AGE_SECONDS);\n    return fromStorage;\n  }\n\n  const fromCookie = await readBrowserCookie(cookieName);\n  if (fromCookie) {\n    await writeBrowserStorage(BROWSER_API && BROWSER_API.localStorage, storageName, fromCookie);\n    return fromCookie;\n  }\n\n  const shopifyClientId = safeString(event && (event.clientId || event.client_id), 160);\n  const id = shopifyClientId || uuid();\n  await writeBrowserStorage(BROWSER_API && BROWSER_API.localStorage, storageName, id);\n  await writeBrowserCookie(cookieName, id, CLIENT_ID_COOKIE_MAX_AGE_SECONDS);\n  return id;\n}\n\nasync function getOrCreateSessionId() {\n  const idStorageName = storageKey('virona_si_session_id');\n  const tsStorageName = storageKey('virona_si_session_last_ts');\n  const idCookieName = cookieKey('virona_si_session_id');\n  const tsCookieName = cookieKey('virona_si_session_last_ts');\n  const now = Date.now();\n  const fromStorage = await readBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, idStorageName);\n  const fromStorageTs = safeNumber(await readBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, tsStorageName));\n\n  if (fromStorage && fromStorageTs != null && (now - fromStorageTs) < SESSION_IDLE_MS) {\n    await writeBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, tsStorageName, String(now));\n    await writeBrowserCookie(idCookieName, fromStorage, SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS);\n    await writeBrowserCookie(tsCookieName, String(now), SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS);\n    return fromStorage;\n  }\n\n  const fromCookie = await readBrowserCookie(idCookieName);\n  const fromCookieTs = safeNumber(await readBrowserCookie(tsCookieName));\n  if (fromCookie && fromCookieTs != null && (now - fromCookieTs) < SESSION_IDLE_MS) {\n    await writeBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, idStorageName, fromCookie);\n    await writeBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, tsStorageName, String(now));\n    await writeBrowserCookie(idCookieName, fromCookie, SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS);\n    await writeBrowserCookie(tsCookieName, String(now), SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS);\n    return fromCookie;\n  }\n\n  const id = uuid();\n  await writeBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, idStorageName, id);\n  await writeBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, tsStorageName, String(now));\n  await writeBrowserCookie(idCookieName, id, SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS);\n  await writeBrowserCookie(tsCookieName, String(now), SESSION_BRIDGE_COOKIE_MAX_AGE_SECONDS);\n  return id;\n}\n\nasync function getOrCreateTabId() {\n  const storageName = storageKey('virona_si_tab_id');\n  const existing = await readBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, storageName);\n  if (existing) return existing;\n  const id = uuid();\n  await writeBrowserStorage(BROWSER_API && BROWSER_API.sessionStorage, storageName, id);\n  return id;\n}\n\nasync function resolveIdentity(event) {\n  const clientId = await getOrCreateClientId(event);\n  const sessionId = await getOrCreateSessionId();\n  const tabId = await getOrCreateTabId();\n  const userId = resolveKnownUserId(event) || null;\n  localEventSequence += 1;\n  return {\n    clientId,\n    sessionId,\n    tabId,\n    userId,\n    eventSequence: localEventSequence\n  };\n}\n\nasync function send(name, event) {\n  try {\n    const identity = await resolveIdentity(event);\n    const context = buildContext(event, identity);\n    fetch(ENDPOINT, {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      keepalive: true,\n      body: JSON.stringify({\n        store: STORE,\n        source: SOURCE,\n        id: safeString(event && event.id, 180) || null,\n        seq: identity.eventSequence,\n        clientId: identity.clientId,\n        sessionId: identity.sessionId,\n        userId: identity.userId,\n        tabId: identity.tabId,\n        timestamp: event && event.timestamp ? event.timestamp : new Date().toISOString(),\n        context,\n        event: {\n          name: safeString(name, 120),\n          data: event && event.data ? event.data : null,\n          context,\n          clientId: identity.clientId,\n          client_id: identity.clientId,\n          sessionId: identity.sessionId,\n          session_id: identity.sessionId,\n          userId: identity.userId,\n          user_id: identity.userId,\n          tabId: identity.tabId,\n          tab_id: identity.tabId,\n          sequence: identity.eventSequence\n        }\n      })\n    }).catch(() => {});\n  } catch (_error) {}\n}\n\nif (ANALYTICS_API && typeof ANALYTICS_API.subscribe === 'function') {\n  STANDARD_EVENTS.forEach((name) => {\n    ANALYTICS_API.subscribe(name, async (event) => {\n      await send(name, event);\n    });\n  });\n}\n\n// Notes:\n// - Standard custom pixels cover official Shopify commerce events only.\n// - Advanced DOM signals like dead clicks and JS errors come from the theme pixel below.\n// - Keep both installed for full Session Intelligence stitching.\n`;}

export function buildShopifyThemePixelSnippet({ store, appBaseUrl } = {}) {
  const normalizedStore = normalizeStore(store);
  const pixelUrl = `${normalizeAppBaseUrl(appBaseUrl)}/pixel.js?store=${encodeURIComponent(normalizedStore)}&platform=${SHOPIFY_THEME_PIXEL_PLATFORM}`;
  return `<script async src="${pixelUrl}"></script>`;
}

export function buildSessionIntelligenceShopifyInstallPack({ store, appBaseUrl, storeUrl = null } = {}) {
  const architecture = getSessionIntelligenceArchitecture({ store, appBaseUrl, storeUrl });
  return {
    ...architecture,
    install: {
      customPixelScript: buildShopifyCustomPixelSnippet({ store: architecture.store, appBaseUrl: architecture.appBaseUrl }),
      themePixelSnippet: buildShopifyThemePixelSnippet({ store: architecture.store, appBaseUrl: architecture.appBaseUrl }),
      notes: [
        'Install both the Shopify custom pixel and the theme pixel for full stitching coverage.',
        'Custom pixel captures official commerce steps; theme pixel captures behavioral and technical evidence.',
        'Future Shopify app-pixel upgrades can add advanced checkout extension or DOM capture, but this install pack works today without a Shopify app.'
      ]
    }
  };
}

export function buildSessionIntelligenceArchitectureResponse(req, { store } = {}) {
  const normalizedStore = normalizeStore(store);
  const appBaseUrl = resolveDefaultAppBaseUrl(req);
  const storeUrl = resolveStoreUrl(normalizedStore);
  return getSessionIntelligenceArchitecture({ store: normalizedStore, appBaseUrl, storeUrl });
}

export function buildSessionIntelligenceShopifyInstallResponse(req, { store } = {}) {
  const normalizedStore = normalizeStore(store);
  const appBaseUrl = resolveDefaultAppBaseUrl(req);
  const storeUrl = resolveStoreUrl(normalizedStore);
  return buildSessionIntelligenceShopifyInstallPack({ store: normalizedStore, appBaseUrl, storeUrl });
}
