import { resolveStoreUrl } from './storeProfileService.js';

const DEFAULT_STORE = 'shawq';
const DEFAULT_APP_BASE_URL = 'https://virona-shawq-dashboard-production-7573.up.railway.app';
const MAX_TEXT_LENGTH = 240;
const SHOPIFY_THEME_PIXEL_PLATFORM = 'shopify';

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
  if (req && typeof req.get === 'function') {
    const host = safeString(req.get('host'), 255);
    if (host) {
      const protocol = safeString(req.get('x-forwarded-proto'), 20) || req.protocol || 'https';
      return normalizeAppBaseUrl(`${protocol}://${host}`);
    }
  }
  return normalizeAppBaseUrl(process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL);
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

  return `// Virona Session Intelligence — Shopify Custom Pixel\n// Paste into Shopify Admin -> Settings -> Customer events -> Add custom pixel\n\nconst ENDPOINT = ${JSON.stringify(endpoint)};\nconst STORE = ${JSON.stringify(normalizedStore)};\nconst SOURCE = 'shopify_custom_pixel_v2';\nconst STANDARD_EVENTS = ${eventNamesLiteral};\n\nfunction safeString(value, max = 240) {\n  try {\n    const str = value == null ? '' : String(value).trim();\n    if (!str) return '';\n    return str.length > max ? str.slice(0, max) : str;\n  } catch (_error) {\n    return '';\n  }\n}\n\nfunction send(name, event) {\n  try {\n    fetch(ENDPOINT, {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      keepalive: true,\n      body: JSON.stringify({\n        store: STORE,\n        source: SOURCE,\n        id: event && event.id ? event.id : null,\n        seq: event && Number.isFinite(event.seq) ? event.seq : null,\n        clientId: event && event.clientId ? event.clientId : null,\n        timestamp: event && event.timestamp ? event.timestamp : new Date().toISOString(),\n        context: event && event.context ? event.context : null,\n        event: {\n          name: safeString(name, 120),\n          data: event && event.data ? event.data : null\n        }\n      })\n    }).catch(() => {});\n  } catch (_error) {}\n}\n\nSTANDARD_EVENTS.forEach((name) => {\n  analytics.subscribe(name, (event) => send(name, event));\n});\n\n// Notes:\n// - Standard custom pixels cover official Shopify commerce events only.\n// - Advanced DOM signals like dead clicks and JS errors come from the theme pixel below.\n// - Keep both installed for full Session Intelligence stitching.\n`;}

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
