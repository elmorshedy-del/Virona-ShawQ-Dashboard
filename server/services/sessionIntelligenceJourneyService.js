import { createHash } from 'crypto';
import { getDb } from '../db/database.js';

const JOURNEY_BUILDER_VERSION = 1;
const JOURNEY_DEFAULT_LIMIT = 50;
const JOURNEY_MAX_LIMIT = 500;
const JOURNEY_STEPS_MAX = 128;
const JOURNEY_RETURN_LOOKAHEAD_DAYS = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const SESSION_NUMBER_WIDTH = 6;
const SESSION_CODE_HASH_LENGTH = 10;
const SESSION_CODE_PREFIX_LENGTH = 4;
const SESSION_CODE_SUFFIX_LENGTH = 4;
const CHECKOUT_STEP_MAX_CHARS = 48;
const PATH_MAX_CHARS = 500;
const LABEL_MAX_CHARS = 180;
const SIGNAL_MAX_CHARS = 120;
const PAGE_TITLE_MAX_WORDS = 12;
const PRODUCT_ID_PREVIEW_CHARS = 14;
const EVENT_NAME_UNKNOWN = 'unknown';
const JOURNEY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUPPORTED_LOCALE_CODES = new Set([
  'ar', 'bg', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it',
  'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'th', 'tr', 'uk', 'vi', 'zh'
]);
const LOCALE_WITH_REGION_RE = /^([a-z]{2})[-_][a-z]{2}$/i;
const CONTENT_PATH_SEGMENTS = new Set(['pages', 'blogs', 'policies']);
const MEANINGFUL_EVENT_NAMES = new Set([
  'page_viewed',
  'collection_viewed',
  'product_viewed',
  'search_submitted',
  'variant_selected',
  'size_selected',
  'add_to_cart_clicked',
  'product_added_to_cart',
  'product_removed_from_cart',
  'cart_viewed',
  'cart_quantity_changed',
  'cart_drawer_opened',
  'checkout_cta_clicked',
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed',
  'purchase_reconciled'
]);
const TECHNICAL_SIGNAL_EVENT_NAMES = new Set(['js_error', 'unhandled_rejection', 'form_invalid']);
const FRICTION_SIGNAL_EVENT_NAMES = new Set(['dead_click', 'rage_click']);
const PURCHASE_EVENT_NAMES = new Set(['checkout_completed', 'purchase_reconciled']);
const CART_ENTRY_EVENT_NAMES = new Set(['product_added_to_cart', 'cart_viewed', 'cart_quantity_changed']);
const PRODUCT_CONTEXT_EVENT_NAMES = new Set(['product_viewed', 'variant_selected', 'size_selected', 'add_to_cart_clicked']);
const CART_STAGE_EVENT_NAMES = new Set([
  'product_added_to_cart',
  'product_removed_from_cart',
  'cart_viewed',
  'cart_quantity_changed',
  'cart_drawer_opened',
  'checkout_cta_clicked'
]);
const CHECKOUT_STAGE_EVENT_NAMES = new Set([
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted'
]);
const STEP_LABELS = {
  home: 'Home',
  collection: 'Collection',
  product: 'Product',
  search: 'Search',
  cart: 'Cart',
  checkout_contact: 'Checkout contact',
  checkout_shipping: 'Checkout shipping',
  checkout_payment: 'Checkout payment',
  checkout_review: 'Checkout review',
  purchase: 'Purchase',
  content: 'Content page',
  other: 'Other'
};
const EXIT_STEP_LABELS = {
  home: 'Home',
  collection: 'Collection',
  product: 'Product',
  search: 'Search',
  cart: 'Cart',
  checkout_contact: 'Checkout contact',
  checkout_shipping: 'Checkout shipping',
  checkout_payment: 'Checkout payment',
  checkout_review: 'Checkout review',
  purchase: 'Purchase',
  content: 'Content page',
  other: 'Other'
};
const CONFIDENCE_SCORE_WEIGHTS = {
  event_presence: 1,
  meaningful_event: 1,
  multiple_meaningful_events: 1,
  entry_path: 2,
  step_presence: 1,
  multiple_steps: 1,
  client_id: 1,
  shopper_identity: 1,
  cart_token: 1,
  checkout_token: 2,
  purchase_or_checkout: 1
};
const CONFIDENCE_SCORE_THRESHOLDS = {
  high_confidence: 8,
  usable: 5,
  partial: 3
};

function safeString(value, maxLength = null) {
  if (value == null) return '';
  const stringValue = String(value);
  if (!Number.isFinite(maxLength) || maxLength <= 0) return stringValue;
  return stringValue.slice(0, maxLength);
}

function safeTruncate(value, maxLength) {
  const normalized = safeString(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, Math.max(1, Math.trunc(maxLength) || 1));
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function safeNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeSqliteDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function startOfUtcDay(dateStr) {
  if (!JOURNEY_DATE_RE.test(safeString(dateStr).trim())) return null;
  return `${dateStr} 00:00:00`;
}

function endOfUtcDayExclusive(dateStr) {
  if (!JOURNEY_DATE_RE.test(safeString(dateStr).trim())) return null;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return normalizeSqliteDateTime(date.getTime() + MILLISECONDS_PER_DAY);
}

function isoDateFromSqliteDateTime(value) {
  const normalized = safeString(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, 10);
}

function normalizePathFromAny(pathname) {
  const raw = safeString(pathname).trim();
  if (!raw) return null;
  if (raw.startsWith('/')) {
    return raw.split('?')[0].split('#')[0] || '/';
  }
  try {
    const parsed = new URL(raw);
    const pathOnly = safeString(parsed.pathname).split('?')[0].split('#')[0];
    return pathOnly || '/';
  } catch (_error) {
    return null;
  }
}

function isLocalePathSegment(segment) {
  const raw = safeString(segment).trim().toLowerCase();
  if (!raw) return false;
  if (SUPPORTED_LOCALE_CODES.has(raw)) return true;
  const regionMatch = raw.match(LOCALE_WITH_REGION_RE);
  if (!regionMatch) return false;
  return SUPPORTED_LOCALE_CODES.has(regionMatch[1]);
}

function stripLocalePrefixFromPath(pathname) {
  const rawPath = normalizePathFromAny(pathname);
  if (!rawPath || !rawPath.startsWith('/')) return rawPath;

  const parts = rawPath.split('/').filter(Boolean);
  if (!parts.length) return '/';

  if (isLocalePathSegment(parts[0])) {
    const rest = parts.slice(1).join('/');
    return rest ? `/${rest}` : '/';
  }

  return `/${parts.join('/')}`;
}

function normalizeJourneyPath(pathname) {
  const normalized = stripLocalePrefixFromPath(pathname);
  if (!normalized) return null;
  if (normalized === '/') return '/';
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function normalizeEventName(value) {
  const normalized = safeString(value, SIGNAL_MAX_CHARS).trim().toLowerCase();
  return normalized || EVENT_NAME_UNKNOWN;
}

function normalizeCheckoutStep(raw) {
  const step = safeString(raw, CHECKOUT_STEP_MAX_CHARS).toLowerCase().trim();
  if (!step) return null;
  if (step.includes('contact')) return 'contact';
  if (step.includes('shipping')) return 'shipping';
  if (step.includes('payment')) return 'payment';
  if (step.includes('review')) return 'review';
  if (step.includes('thank')) return 'thank_you';
  if (step === 'contact_information') return 'contact';
  if (step === 'shipping_method') return 'shipping';
  if (step === 'payment_method') return 'payment';
  return step.slice(0, CHECKOUT_STEP_MAX_CHARS);
}

function isCheckoutPath(pathname) {
  const normalized = normalizeJourneyPath(pathname);
  return Boolean(normalized && normalized.startsWith('/checkouts/'));
}

function titleCaseFromHandle(handle) {
  const decoded = safeString(handle).replace(/[-_]+/g, ' ').trim();
  if (!decoded) return null;
  return decoded
    .split(/\s+/)
    .slice(0, PAGE_TITLE_MAX_WORDS)
    .map((word) => (/^[a-z]/.test(word) ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
    .join(' ');
}

function extractProductLabelFromPath(pathname) {
  const normalized = normalizeJourneyPath(pathname);
  if (!normalized) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments[0] !== 'products' || !segments[1]) return null;
  return titleCaseFromHandle(segments[1]);
}

function classifyPageLabel(pathname) {
  const normalized = normalizeJourneyPath(pathname);
  if (!normalized) return null;
  if (normalized === '/') return 'Home';
  if (normalized === '/cart') return 'Cart';
  if (normalized.startsWith('/search')) return 'Search';

  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return 'Home';

  if (segments[0] === 'products' && segments[1]) {
    const title = titleCaseFromHandle(segments[1]);
    return title ? `Product: ${title}` : 'Product';
  }
  if (segments[0] === 'collections' && segments[1]) {
    const title = titleCaseFromHandle(segments[1]);
    return title ? `Collection: ${title}` : 'Collection';
  }
  if (CONTENT_PATH_SEGMENTS.has(segments[0]) && segments[1]) {
    const title = titleCaseFromHandle(segments[1]);
    return title ? `Page: ${title}` : 'Page';
  }

  const title = titleCaseFromHandle(segments[0]);
  return title || normalized;
}

function formatJourneyProductLabel({ title, productId }) {
  const titleLabel = safeString(title, LABEL_MAX_CHARS).trim();
  if (titleLabel) return titleLabel;
  const rawId = safeString(productId).trim();
  if (!rawId) return null;
  const preview = rawId.length > PRODUCT_ID_PREVIEW_CHARS
    ? rawId.slice(-PRODUCT_ID_PREVIEW_CHARS)
    : rawId;
  return `Product ${preview}`;
}

function makeSessionCodename(sessionId) {
  const raw = safeString(sessionId).trim();
  if (!raw) return 'SUNKNOWN';
  const hex = createHash('sha256').update(raw).digest('hex').slice(0, SESSION_CODE_HASH_LENGTH);
  const code = BigInt(`0x${hex}`).toString(36).toUpperCase().padStart(SESSION_NUMBER_WIDTH + 2, '0');
  return `S${code.slice(0, SESSION_CODE_PREFIX_LENGTH)}-${code.slice(SESSION_CODE_PREFIX_LENGTH, SESSION_CODE_PREFIX_LENGTH + SESSION_CODE_SUFFIX_LENGTH)}`;
}

function formatSessionNumberCode(sessionNumber, width = SESSION_NUMBER_WIDTH) {
  const numericValue = Number(sessionNumber);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  const safeWidth = Math.min(Math.max(Math.trunc(width) || SESSION_NUMBER_WIDTH, 4), 12);
  return `S-${String(Math.trunc(numericValue)).padStart(safeWidth, '0')}`;
}

function makeSessionDisplayCode({ sessionNumber, sessionId }) {
  return formatSessionNumberCode(sessionNumber) || makeSessionCodename(sessionId);
}

function inferProductContext(eventRow) {
  const explicitProductId = safeTruncate(eventRow?.product_id, SIGNAL_MAX_CHARS);
  const explicitVariantId = safeTruncate(eventRow?.variant_id, SIGNAL_MAX_CHARS);
  const pathLabel = extractProductLabelFromPath(eventRow?.page_path) || extractProductLabelFromPath(eventRow?.page_url);
  if (!explicitProductId && !explicitVariantId && !pathLabel) return null;
  return {
    productId: explicitProductId,
    variantId: explicitVariantId,
    productLabel: formatJourneyProductLabel({ title: pathLabel, productId: explicitProductId })
  };
}

function isPurchaseEvent(eventName) {
  return PURCHASE_EVENT_NAMES.has(eventName);
}

function isMeaningfulJourneyEvent(eventName) {
  return MEANINGFUL_EVENT_NAMES.has(eventName);
}

function isTechnicalSignalEvent(eventName) {
  return TECHNICAL_SIGNAL_EVENT_NAMES.has(eventName);
}

function isFrictionSignalEvent(eventName) {
  return FRICTION_SIGNAL_EVENT_NAMES.has(eventName);
}

function resolveStepKeyFromEvent(eventRow) {
  const eventName = normalizeEventName(eventRow?.event_name);
  const pagePath = normalizeJourneyPath(eventRow?.page_path || eventRow?.page_url);
  const checkoutStep = normalizeCheckoutStep(eventRow?.checkout_step);

  if (isPurchaseEvent(eventName)) return 'purchase';
  if (checkoutStep === 'payment') return 'checkout_payment';
  if (checkoutStep === 'shipping') return 'checkout_shipping';
  if (checkoutStep === 'review' || checkoutStep === 'thank_you') return 'checkout_review';
  if (checkoutStep === 'contact') return 'checkout_contact';

  if (eventName === 'payment_info_submitted') return 'checkout_payment';
  if (CHECKOUT_STAGE_EVENT_NAMES.has(eventName)) return 'checkout_contact';
  if (CART_STAGE_EVENT_NAMES.has(eventName)) return 'cart';
  if (PRODUCT_CONTEXT_EVENT_NAMES.has(eventName)) return 'product';

  if (pagePath === '/cart') return 'cart';
  if (isCheckoutPath(pagePath)) return 'checkout_contact';
  if (pagePath === '/') return 'home';
  if (pagePath?.startsWith('/search')) return 'search';
  if (pagePath?.startsWith('/collections/')) return 'collection';
  if (extractProductLabelFromPath(pagePath)) return 'product';

  const segments = pagePath?.split('/').filter(Boolean) || [];
  if (segments.length && CONTENT_PATH_SEGMENTS.has(segments[0])) return 'content';
  if (pagePath) return 'other';
  return null;
}

function resolveStepLabel(stepKey) {
  return STEP_LABELS[stepKey] || 'Other';
}

function resolveExitStepLabel(stepKey) {
  return EXIT_STEP_LABELS[stepKey] || 'Other';
}

function pickJourneyDate(sessionRow) {
  return (
    isoDateFromSqliteDateTime(sessionRow?.started_at) ||
    isoDateFromSqliteDateTime(sessionRow?.last_event_at) ||
    isoDateFromSqliteDateTime(sessionRow?.created_at) ||
    null
  );
}

function normalizeDateInput(date) {
  const raw = safeString(date).trim();
  if (!raw) return null;
  if (JOURNEY_DATE_RE.test(raw)) return raw;
  return null;
}

function resolveJourneyRange({ date = null, startDate = null, endDate = null } = {}) {
  const resolvedDate = normalizeDateInput(date);
  if (resolvedDate) {
    return {
      label: resolvedDate,
      start: startOfUtcDay(resolvedDate),
      end: endOfUtcDayExclusive(resolvedDate)
    };
  }

  const resolvedStart = normalizeDateInput(startDate);
  const resolvedEnd = normalizeDateInput(endDate);
  if (resolvedStart && resolvedEnd) {
    return {
      label: `${resolvedStart}:${resolvedEnd}`,
      start: startOfUtcDay(resolvedStart),
      end: endOfUtcDayExclusive(resolvedEnd)
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  return {
    label: today,
    start: startOfUtcDay(today),
    end: endOfUtcDayExclusive(today)
  };
}

function normalizeLimit(limit, fallback = JOURNEY_DEFAULT_LIMIT) {
  const numericValue = Number.parseInt(limit, 10);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(JOURNEY_MAX_LIMIT, Math.max(1, numericValue));
}

function buildEventTimestamp(row) {
  return normalizeSqliteDateTime(row?.event_ts || row?.created_at || new Date());
}

function buildStepSnapshot(eventRow, productContext) {
  const pagePath = normalizeJourneyPath(eventRow?.page_path || eventRow?.page_url);
  const pageLabel = safeTruncate(classifyPageLabel(pagePath), LABEL_MAX_CHARS);
  return {
    pagePath: safeTruncate(pagePath, PATH_MAX_CHARS),
    pageLabel,
    productId: productContext?.productId || null,
    productLabel: productContext?.productLabel || null,
    variantId: productContext?.variantId || null,
    checkoutStep: normalizeCheckoutStep(eventRow?.checkout_step)
  };
}

function updateStepFromEvent(step, eventRow, eventTs, snapshot) {
  step.ended_at = eventTs;
  step.event_count += 1;
  step.last_event_name = normalizeEventName(eventRow?.event_name);
  if (snapshot.pagePath) step.page_path = snapshot.pagePath;
  if (snapshot.pageLabel) step.page_label = snapshot.pageLabel;
  if (snapshot.productId) step.product_id = snapshot.productId;
  if (snapshot.productLabel) step.product_label = snapshot.productLabel;
  if (snapshot.variantId) step.variant_id = snapshot.variantId;
  if (snapshot.checkoutStep) step.checkout_step = snapshot.checkoutStep;
}

function buildJourneyConfidence({
  sessionRow,
  eventCount,
  meaningfulEventCount,
  stepCount,
  entryPagePath,
  cartEnteredAt,
  checkoutStartedAt,
  purchaseAt
}) {
  let score = 0;
  if (eventCount > 0) score += CONFIDENCE_SCORE_WEIGHTS.event_presence;
  if (meaningfulEventCount > 0) score += CONFIDENCE_SCORE_WEIGHTS.meaningful_event;
  if (meaningfulEventCount >= 2) score += CONFIDENCE_SCORE_WEIGHTS.multiple_meaningful_events;
  if (safeString(entryPagePath).trim()) score += CONFIDENCE_SCORE_WEIGHTS.entry_path;
  if (stepCount > 0) score += CONFIDENCE_SCORE_WEIGHTS.step_presence;
  if (stepCount >= 2) score += CONFIDENCE_SCORE_WEIGHTS.multiple_steps;
  if (safeString(sessionRow?.client_id).trim()) score += CONFIDENCE_SCORE_WEIGHTS.client_id;
  if (sessionRow?.shopper_number || safeString(sessionRow?.last_user_id).trim()) {
    score += CONFIDENCE_SCORE_WEIGHTS.shopper_identity;
  }
  if (safeString(sessionRow?.last_cart_token).trim() || safeString(cartEnteredAt).trim()) {
    score += CONFIDENCE_SCORE_WEIGHTS.cart_token;
  }
  if (safeString(sessionRow?.last_checkout_token).trim()) {
    score += CONFIDENCE_SCORE_WEIGHTS.checkout_token;
  }
  if (safeString(purchaseAt).trim() || safeString(checkoutStartedAt).trim()) {
    score += CONFIDENCE_SCORE_WEIGHTS.purchase_or_checkout;
  }

  if (score >= CONFIDENCE_SCORE_THRESHOLDS.high_confidence) return 'high_confidence';
  if (score >= CONFIDENCE_SCORE_THRESHOLDS.usable) return 'usable';
  if (score >= CONFIDENCE_SCORE_THRESHOLDS.partial) return 'partial';
  return 'low_signal';
}

function buildIdentityPredicate(sessionRow) {
  const shopperNumber = Number(sessionRow?.shopper_number);
  if (Number.isFinite(shopperNumber) && shopperNumber > 0) {
    return { clause: 'shopper_number = ?', value: shopperNumber };
  }

  const clientId = safeString(sessionRow?.client_id).trim();
  if (clientId) {
    return { clause: 'client_id = ?', value: clientId };
  }

  const userId = safeString(sessionRow?.last_user_id).trim();
  if (userId) {
    return { clause: 'last_user_id = ?', value: userId };
  }

  return null;
}

function resolveLaterSessionOutcome(db, store, sessionRow) {
  const predicate = buildIdentityPredicate(sessionRow);
  if (!predicate) {
    return {
      returnedLater: 0,
      purchasedLater: 0,
      nextSessionId: null,
      nextSessionStartedAt: null,
      laterPurchaseSessionId: null,
      laterPurchaseAt: null
    };
  }

  const baseMoment = normalizeSqliteDateTime(sessionRow?.last_event_at || sessionRow?.started_at || sessionRow?.updated_at || new Date());
  const lookaheadEnd = normalizeSqliteDateTime(new Date(`${baseMoment.replace(' ', 'T')}Z`).getTime() + (JOURNEY_RETURN_LOOKAHEAD_DAYS * MILLISECONDS_PER_DAY));

  const nextSession = db.prepare(`
    SELECT session_id, started_at
    FROM si_sessions
    WHERE store = ?
      AND ${predicate.clause}
      AND session_id != ?
      AND COALESCE(started_at, last_event_at, updated_at) > ?
      AND COALESCE(started_at, last_event_at, updated_at) <= ?
    ORDER BY COALESCE(started_at, last_event_at, updated_at) ASC
    LIMIT 1
  `).get(store, predicate.value, sessionRow.session_id, baseMoment, lookaheadEnd);

  const laterPurchase = db.prepare(`
    SELECT session_id, purchase_at
    FROM si_sessions
    WHERE store = ?
      AND ${predicate.clause}
      AND session_id != ?
      AND purchase_at IS NOT NULL
      AND purchase_at > ?
      AND purchase_at <= ?
    ORDER BY purchase_at ASC
    LIMIT 1
  `).get(store, predicate.value, sessionRow.session_id, baseMoment, lookaheadEnd);

  return {
    returnedLater: nextSession ? 1 : 0,
    purchasedLater: laterPurchase ? 1 : 0,
    nextSessionId: nextSession?.session_id || null,
    nextSessionStartedAt: nextSession?.started_at || null,
    laterPurchaseSessionId: laterPurchase?.session_id || null,
    laterPurchaseAt: laterPurchase?.purchase_at || null
  };
}

function buildJourneyPayload(sessionRow, eventRows, laterOutcome) {
  const steps = [];
  const sequence = [];
  const productLabelsSeen = [];
  const productLabelSeenSet = new Set();
  const eventBreakdown = new Map();
  const diagnosticBreakdown = new Map();

  let eventCount = 0;
  let meaningfulEventCount = 0;
  let productViewCount = 0;
  let technicalIssueCount = 0;
  let frictionSignalCount = 0;
  const sessionCartEnteredAt = safeString(sessionRow?.atc_at).trim() || null;
  const sessionCheckoutStartedAt = safeString(sessionRow?.checkout_started_at).trim() || null;
  const sessionPurchaseAt = safeString(sessionRow?.purchase_at).trim() || null;
  let cartEnteredAt = null;
  let checkoutStartedAt = null;
  let paymentInfoSubmittedAt = null;
  let purchaseAt = null;
  let lastCheckoutStep = normalizeCheckoutStep(sessionRow?.last_checkout_step) || null;
  let firstProduct = null;
  let lastProductBeforeCart = null;
  let lastProduct = null;
  let lastEventPagePath = null;
  let lastMeaningfulAction = null;
  let lastSignal = null;

  for (const rawEvent of eventRows) {
    const eventName = normalizeEventName(rawEvent?.event_name);
    const eventTs = buildEventTimestamp(rawEvent);
    const productContext = inferProductContext(rawEvent);
    const snapshot = buildStepSnapshot(rawEvent, productContext);
    const stepKey = resolveStepKeyFromEvent(rawEvent);
    const pagePath = snapshot.pagePath;

    eventCount += 1;
    eventBreakdown.set(eventName, (eventBreakdown.get(eventName) || 0) + 1);
    if (pagePath) lastEventPagePath = pagePath;

    if (productContext?.productLabel && !productLabelSeenSet.has(productContext.productLabel)) {
      productLabelSeenSet.add(productContext.productLabel);
      productLabelsSeen.push(productContext.productLabel);
    }

    if (productContext) {
      if (!firstProduct) firstProduct = productContext;
      lastProduct = productContext;
      if (!cartEnteredAt) lastProductBeforeCart = productContext;
    }

    if (eventName === 'product_viewed') {
      productViewCount += 1;
    }

    if (isMeaningfulJourneyEvent(eventName)) {
      meaningfulEventCount += 1;
      lastMeaningfulAction = {
        eventName,
        eventTs,
        pagePath: pagePath || null,
        productId: productContext?.productId || null,
        productLabel: productContext?.productLabel || null
      };
    }

    if (isTechnicalSignalEvent(eventName)) {
      technicalIssueCount += 1;
      diagnosticBreakdown.set(eventName, (diagnosticBreakdown.get(eventName) || 0) + 1);
      lastSignal = { eventName, eventTs, pagePath: pagePath || null };
    } else if (isFrictionSignalEvent(eventName)) {
      frictionSignalCount += 1;
      diagnosticBreakdown.set(eventName, (diagnosticBreakdown.get(eventName) || 0) + 1);
      lastSignal = { eventName, eventTs, pagePath: pagePath || null };
    }

    if (!cartEnteredAt && CART_ENTRY_EVENT_NAMES.has(eventName)) {
      cartEnteredAt = eventTs;
      if (productContext) lastProductBeforeCart = productContext;
    }

    if (!checkoutStartedAt && CHECKOUT_STAGE_EVENT_NAMES.has(eventName)) {
      checkoutStartedAt = eventTs;
    }

    if (eventName === 'payment_info_submitted' && !paymentInfoSubmittedAt) {
      paymentInfoSubmittedAt = eventTs;
    }

    if (isPurchaseEvent(eventName) && !purchaseAt) {
      purchaseAt = eventTs;
    }

    if (snapshot.checkoutStep) {
      lastCheckoutStep = snapshot.checkoutStep;
    }

    if (!stepKey) continue;
    const stepLabel = resolveStepLabel(stepKey);
    const currentStep = steps[steps.length - 1];
    if (currentStep && currentStep.step_key === stepKey) {
      updateStepFromEvent(currentStep, rawEvent, eventTs, snapshot);
      continue;
    }

    if (steps.length >= JOURNEY_STEPS_MAX) continue;

    const step = {
      step_index: steps.length + 1,
      step_key: stepKey,
      step_label: stepLabel,
      started_at: eventTs,
      ended_at: eventTs,
      first_event_name: eventName,
      last_event_name: eventName,
      page_path: snapshot.pagePath,
      page_label: snapshot.pageLabel,
      product_id: snapshot.productId,
      product_label: snapshot.productLabel,
      variant_id: snapshot.variantId,
      checkout_step: snapshot.checkoutStep,
      event_count: 1,
      data_json: null
    };
    steps.push(step);
    sequence.push(stepKey);
  }

  if (!cartEnteredAt) cartEnteredAt = sessionCartEnteredAt;
  if (!checkoutStartedAt) checkoutStartedAt = sessionCheckoutStartedAt;
  if (!purchaseAt) purchaseAt = sessionPurchaseAt;

  const entryPagePath = safeTruncate(normalizeJourneyPath(sessionRow?.entry_page_path || sessionRow?.entry_page_url), PATH_MAX_CHARS);
  const entryPageLabel = safeTruncate(classifyPageLabel(entryPagePath), LABEL_MAX_CHARS);
  const exitStep = purchaseAt
    ? 'purchase'
    : (steps[steps.length - 1]?.step_key || resolveStepKeyFromEvent({ page_path: lastEventPagePath, event_name: EVENT_NAME_UNKNOWN, checkout_step: lastCheckoutStep }) || 'other');
  const exitPagePath = safeTruncate(lastEventPagePath || lastMeaningfulAction?.pagePath || entryPagePath, PATH_MAX_CHARS);
  const exitPageLabel = safeTruncate(classifyPageLabel(exitPagePath), LABEL_MAX_CHARS);
  const effectiveLastProductBeforeCart = lastProductBeforeCart || lastProduct || null;
  const purchasedInSession = purchaseAt ? 1 : 0;
  const journeyConfidence = buildJourneyConfidence({
    sessionRow,
    eventCount,
    meaningfulEventCount,
    stepCount: steps.length,
    entryPagePath,
    cartEnteredAt,
    checkoutStartedAt,
    purchaseAt
  });

  const dataJson = JSON.stringify({
    sequence,
    event_breakdown: Object.fromEntries(eventBreakdown.entries()),
    diagnostic_breakdown: Object.fromEntries(diagnosticBreakdown.entries()),
    products_seen: productLabelsSeen.slice(0, 12)
  });

  return {
    journey: {
      store: sessionRow.store,
      session_id: sessionRow.session_id,
      session_number: sessionRow.session_number || null,
      client_id: safeTruncate(sessionRow.client_id, SIGNAL_MAX_CHARS),
      shopper_number: sessionRow.shopper_number || null,
      user_id: safeTruncate(sessionRow.last_user_id, SIGNAL_MAX_CHARS),
      builder_version: JOURNEY_BUILDER_VERSION,
      source_updated_at: normalizeSqliteDateTime(sessionRow.updated_at || sessionRow.last_event_at || sessionRow.started_at || new Date()),
      built_at: normalizeSqliteDateTime(),
      journey_date: pickJourneyDate(sessionRow) || new Date().toISOString().slice(0, 10),
      status: safeTruncate(sessionRow.status || (purchaseAt ? 'purchased' : 'active'), SIGNAL_MAX_CHARS) || 'active',
      journey_confidence: journeyConfidence,
      entry_page_path: entryPagePath,
      entry_page_label: entryPageLabel,
      entry_referrer_url: safeTruncate(sessionRow.entry_referrer_url, 1000),
      entry_source: safeTruncate(sessionRow.entry_utm_source, SIGNAL_MAX_CHARS),
      entry_medium: safeTruncate(sessionRow.entry_utm_medium, SIGNAL_MAX_CHARS),
      entry_campaign: safeTruncate(sessionRow.entry_utm_campaign, SIGNAL_MAX_CHARS),
      entry_device_type: safeTruncate(sessionRow.last_device_type, SIGNAL_MAX_CHARS),
      entry_device_os: safeTruncate(sessionRow.last_device_os, SIGNAL_MAX_CHARS),
      entry_country_code: safeTruncate(sessionRow.last_country_code, SIGNAL_MAX_CHARS),
      first_product_id: firstProduct?.productId || null,
      first_product_label: firstProduct?.productLabel || null,
      last_product_before_cart_id: effectiveLastProductBeforeCart?.productId || null,
      last_product_before_cart_label: effectiveLastProductBeforeCart?.productLabel || null,
      last_product_id: lastProduct?.productId || safeTruncate(sessionRow.last_product_id, SIGNAL_MAX_CHARS),
      last_product_label: lastProduct?.productLabel || formatJourneyProductLabel({
        title: extractProductLabelFromPath(sessionRow.entry_page_path) || null,
        productId: sessionRow.last_product_id
      }),
      cart_entered_at: cartEnteredAt,
      checkout_started_at: checkoutStartedAt,
      last_checkout_step: lastCheckoutStep,
      payment_info_submitted_at: paymentInfoSubmittedAt,
      purchase_at: purchaseAt,
      purchased_in_session: purchasedInSession,
      exit_step,
      exit_page_path: exitPagePath,
      exit_page_label: exitPageLabel,
      last_meaningful_event_name: lastMeaningfulAction?.eventName || null,
      last_meaningful_event_ts: lastMeaningfulAction?.eventTs || null,
      last_meaningful_page_path: safeTruncate(lastMeaningfulAction?.pagePath, PATH_MAX_CHARS),
      last_signal_event_name: lastSignal?.eventName || null,
      last_signal_event_ts: lastSignal?.eventTs || null,
      last_signal_page_path: safeTruncate(lastSignal?.pagePath, PATH_MAX_CHARS),
      event_count: eventCount,
      meaningful_event_count: meaningfulEventCount,
      step_count: steps.length,
      product_view_count: productViewCount,
      technical_issue_count: technicalIssueCount,
      friction_signal_count: frictionSignalCount,
      returned_later: laterOutcome.returnedLater,
      purchased_later: laterOutcome.purchasedLater,
      next_session_id: laterOutcome.nextSessionId,
      next_session_started_at: laterOutcome.nextSessionStartedAt,
      later_purchase_session_id: laterOutcome.laterPurchaseSessionId,
      later_purchase_at: laterOutcome.laterPurchaseAt,
      data_json: dataJson,
      updated_at: normalizeSqliteDateTime()
    },
    steps
  };
}

function loadSessionRow(db, store, sessionId) {
  return db.prepare(`
    SELECT *
    FROM si_sessions
    WHERE store = ? AND session_id = ?
    LIMIT 1
  `).get(store, sessionId);
}

function loadEventRowsForSessionIds(db, store, sessionIds) {
  if (!Array.isArray(sessionIds) || !sessionIds.length) return new Map();
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT
      id,
      store,
      session_id,
      event_name,
      event_ts,
      page_url,
      page_path,
      referrer_url,
      page_title,
      checkout_step,
      product_id,
      variant_id,
      data_json,
      created_at
    FROM si_events
    WHERE store = ?
      AND session_id IN (${placeholders})
    ORDER BY COALESCE(event_ts, created_at) ASC, id ASC
  `).all(store, ...sessionIds);

  const map = new Map();
  for (const row of rows) {
    const sessionId = safeString(row.session_id).trim();
    if (!sessionId) continue;
    if (!map.has(sessionId)) map.set(sessionId, []);
    map.get(sessionId).push(row);
  }
  return map;
}

function persistJourney(db, journeyPayload) {
  const { journey, steps } = journeyPayload;
  if (!journey || !safeString(journey.store).trim() || !safeString(journey.session_id).trim()) return null;

  const persistTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO si_journeys (
        store,
        session_id,
        session_number,
        client_id,
        shopper_number,
        user_id,
        builder_version,
        source_updated_at,
        built_at,
        journey_date,
        status,
        journey_confidence,
        entry_page_path,
        entry_page_label,
        entry_referrer_url,
        entry_source,
        entry_medium,
        entry_campaign,
        entry_device_type,
        entry_device_os,
        entry_country_code,
        first_product_id,
        first_product_label,
        last_product_before_cart_id,
        last_product_before_cart_label,
        last_product_id,
        last_product_label,
        cart_entered_at,
        checkout_started_at,
        last_checkout_step,
        payment_info_submitted_at,
        purchase_at,
        purchased_in_session,
        exit_step,
        exit_page_path,
        exit_page_label,
        last_meaningful_event_name,
        last_meaningful_event_ts,
        last_meaningful_page_path,
        last_signal_event_name,
        last_signal_event_ts,
        last_signal_page_path,
        event_count,
        meaningful_event_count,
        step_count,
        product_view_count,
        technical_issue_count,
        friction_signal_count,
        returned_later,
        purchased_later,
        next_session_id,
        next_session_started_at,
        later_purchase_session_id,
        later_purchase_at,
        data_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(store, session_id) DO UPDATE SET
        session_number = excluded.session_number,
        client_id = excluded.client_id,
        shopper_number = excluded.shopper_number,
        user_id = excluded.user_id,
        builder_version = excluded.builder_version,
        source_updated_at = excluded.source_updated_at,
        built_at = excluded.built_at,
        journey_date = excluded.journey_date,
        status = excluded.status,
        journey_confidence = excluded.journey_confidence,
        entry_page_path = excluded.entry_page_path,
        entry_page_label = excluded.entry_page_label,
        entry_referrer_url = excluded.entry_referrer_url,
        entry_source = excluded.entry_source,
        entry_medium = excluded.entry_medium,
        entry_campaign = excluded.entry_campaign,
        entry_device_type = excluded.entry_device_type,
        entry_device_os = excluded.entry_device_os,
        entry_country_code = excluded.entry_country_code,
        first_product_id = excluded.first_product_id,
        first_product_label = excluded.first_product_label,
        last_product_before_cart_id = excluded.last_product_before_cart_id,
        last_product_before_cart_label = excluded.last_product_before_cart_label,
        last_product_id = excluded.last_product_id,
        last_product_label = excluded.last_product_label,
        cart_entered_at = excluded.cart_entered_at,
        checkout_started_at = excluded.checkout_started_at,
        last_checkout_step = excluded.last_checkout_step,
        payment_info_submitted_at = excluded.payment_info_submitted_at,
        purchase_at = excluded.purchase_at,
        purchased_in_session = excluded.purchased_in_session,
        exit_step = excluded.exit_step,
        exit_page_path = excluded.exit_page_path,
        exit_page_label = excluded.exit_page_label,
        last_meaningful_event_name = excluded.last_meaningful_event_name,
        last_meaningful_event_ts = excluded.last_meaningful_event_ts,
        last_meaningful_page_path = excluded.last_meaningful_page_path,
        last_signal_event_name = excluded.last_signal_event_name,
        last_signal_event_ts = excluded.last_signal_event_ts,
        last_signal_page_path = excluded.last_signal_page_path,
        event_count = excluded.event_count,
        meaningful_event_count = excluded.meaningful_event_count,
        step_count = excluded.step_count,
        product_view_count = excluded.product_view_count,
        technical_issue_count = excluded.technical_issue_count,
        friction_signal_count = excluded.friction_signal_count,
        returned_later = excluded.returned_later,
        purchased_later = excluded.purchased_later,
        next_session_id = excluded.next_session_id,
        next_session_started_at = excluded.next_session_started_at,
        later_purchase_session_id = excluded.later_purchase_session_id,
        later_purchase_at = excluded.later_purchase_at,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `).run(
      journey.store,
      journey.session_id,
      journey.session_number,
      journey.client_id,
      journey.shopper_number,
      journey.user_id,
      journey.builder_version,
      journey.source_updated_at,
      journey.built_at,
      journey.journey_date,
      journey.status,
      journey.journey_confidence,
      journey.entry_page_path,
      journey.entry_page_label,
      journey.entry_referrer_url,
      journey.entry_source,
      journey.entry_medium,
      journey.entry_campaign,
      journey.entry_device_type,
      journey.entry_device_os,
      journey.entry_country_code,
      journey.first_product_id,
      journey.first_product_label,
      journey.last_product_before_cart_id,
      journey.last_product_before_cart_label,
      journey.last_product_id,
      journey.last_product_label,
      journey.cart_entered_at,
      journey.checkout_started_at,
      journey.last_checkout_step,
      journey.payment_info_submitted_at,
      journey.purchase_at,
      journey.purchased_in_session,
      journey.exit_step,
      journey.exit_page_path,
      journey.exit_page_label,
      journey.last_meaningful_event_name,
      journey.last_meaningful_event_ts,
      journey.last_meaningful_page_path,
      journey.last_signal_event_name,
      journey.last_signal_event_ts,
      journey.last_signal_page_path,
      journey.event_count,
      journey.meaningful_event_count,
      journey.step_count,
      journey.product_view_count,
      journey.technical_issue_count,
      journey.friction_signal_count,
      journey.returned_later,
      journey.purchased_later,
      journey.next_session_id,
      journey.next_session_started_at,
      journey.later_purchase_session_id,
      journey.later_purchase_at,
      journey.data_json,
      journey.updated_at
    );

    db.prepare(`
      DELETE FROM si_journey_steps
      WHERE store = ? AND session_id = ?
    `).run(journey.store, journey.session_id);

    if (steps.length) {
      const insertStep = db.prepare(`
        INSERT INTO si_journey_steps (
          store,
          session_id,
          step_index,
          step_key,
          step_label,
          started_at,
          ended_at,
          first_event_name,
          last_event_name,
          page_path,
          page_label,
          product_id,
          product_label,
          variant_id,
          checkout_step,
          event_count,
          data_json,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const step of steps) {
        insertStep.run(
          journey.store,
          journey.session_id,
          step.step_index,
          step.step_key,
          step.step_label,
          step.started_at,
          step.ended_at,
          step.first_event_name,
          step.last_event_name,
          step.page_path,
          step.page_label,
          step.product_id,
          step.product_label,
          step.variant_id,
          step.checkout_step,
          step.event_count,
          step.data_json,
          journey.updated_at
        );
      }
    }
  });

  persistTx();
  return journey;
}

function selectJourneyRow(db, store, sessionId) {
  return db.prepare(`
    SELECT *
    FROM si_journeys
    WHERE store = ? AND session_id = ?
    LIMIT 1
  `).get(store, sessionId);
}

function selectJourneySteps(db, store, sessionId) {
  return db.prepare(`
    SELECT *
    FROM si_journey_steps
    WHERE store = ? AND session_id = ?
    ORDER BY step_index ASC
  `).all(store, sessionId);
}

function buildOrRefreshJourney(db, store, sessionRow, { rebuild = false } = {}) {
  const existing = selectJourneyRow(db, store, sessionRow.session_id);
  const sourceUpdatedAt = normalizeSqliteDateTime(sessionRow.updated_at || sessionRow.last_event_at || sessionRow.started_at || new Date());
  const isFresh = existing
    && Number(existing.builder_version) === JOURNEY_BUILDER_VERSION
    && safeString(existing.source_updated_at).trim() === sourceUpdatedAt;

  if (!rebuild && isFresh) {
    return {
      journey: existing,
      steps: selectJourneySteps(db, store, sessionRow.session_id),
      rebuilt: false
    };
  }

  const eventRows = loadEventRowsForSessionIds(db, store, [sessionRow.session_id]).get(sessionRow.session_id) || [];
  const laterOutcome = resolveLaterSessionOutcome(db, store, sessionRow);
  const payload = buildJourneyPayload(sessionRow, eventRows, laterOutcome);
  const journey = persistJourney(db, payload);
  return {
    journey,
    steps: selectJourneySteps(db, store, sessionRow.session_id),
    rebuilt: true
  };
}

function selectSessionsForRange(db, store, range, limit) {
  return db.prepare(`
    SELECT *
    FROM si_sessions
    WHERE store = ?
      AND COALESCE(started_at, last_event_at, created_at) >= ?
      AND COALESCE(started_at, last_event_at, created_at) < ?
    ORDER BY COALESCE(started_at, last_event_at, created_at) DESC
    LIMIT ?
  `).all(store, range.start, range.end, limit);
}

function formatJourneyListRow(journeyRow) {
  const data = safeJsonParse(journeyRow?.data_json) || {};
  return {
    session_id: journeyRow.session_id,
    session_number: journeyRow.session_number || null,
    codename: makeSessionDisplayCode({ sessionNumber: journeyRow.session_number, sessionId: journeyRow.session_id }),
    shopper_number: journeyRow.shopper_number || null,
    client_id: journeyRow.client_id || null,
    user_id: journeyRow.user_id || null,
    journey_date: journeyRow.journey_date || null,
    status: journeyRow.status || null,
    journey_confidence: journeyRow.journey_confidence || null,
    entry_page_path: journeyRow.entry_page_path || null,
    entry_page_label: journeyRow.entry_page_label || null,
    entry_source: journeyRow.entry_source || null,
    entry_medium: journeyRow.entry_medium || null,
    entry_campaign: journeyRow.entry_campaign || null,
    entry_device_type: journeyRow.entry_device_type || null,
    entry_device_os: journeyRow.entry_device_os || null,
    entry_country_code: journeyRow.entry_country_code || null,
    first_product_label: journeyRow.first_product_label || null,
    last_product_before_cart_label: journeyRow.last_product_before_cart_label || null,
    last_product_label: journeyRow.last_product_label || null,
    cart_entered_at: journeyRow.cart_entered_at || null,
    checkout_started_at: journeyRow.checkout_started_at || null,
    last_checkout_step: journeyRow.last_checkout_step || null,
    payment_info_submitted_at: journeyRow.payment_info_submitted_at || null,
    purchase_at: journeyRow.purchase_at || null,
    purchased_in_session: Boolean(journeyRow.purchased_in_session),
    exit_step: journeyRow.exit_step || null,
    exit_step_label: resolveExitStepLabel(journeyRow.exit_step),
    exit_page_path: journeyRow.exit_page_path || null,
    exit_page_label: journeyRow.exit_page_label || null,
    last_meaningful_event_name: journeyRow.last_meaningful_event_name || null,
    last_meaningful_event_ts: journeyRow.last_meaningful_event_ts || null,
    last_meaningful_page_path: journeyRow.last_meaningful_page_path || null,
    last_signal_event_name: journeyRow.last_signal_event_name || null,
    last_signal_event_ts: journeyRow.last_signal_event_ts || null,
    last_signal_page_path: journeyRow.last_signal_page_path || null,
    event_count: journeyRow.event_count || 0,
    meaningful_event_count: journeyRow.meaningful_event_count || 0,
    step_count: journeyRow.step_count || 0,
    product_view_count: journeyRow.product_view_count || 0,
    technical_issue_count: journeyRow.technical_issue_count || 0,
    friction_signal_count: journeyRow.friction_signal_count || 0,
    returned_later: Boolean(journeyRow.returned_later),
    purchased_later: Boolean(journeyRow.purchased_later),
    next_session_id: journeyRow.next_session_id || null,
    next_session_started_at: journeyRow.next_session_started_at || null,
    later_purchase_session_id: journeyRow.later_purchase_session_id || null,
    later_purchase_at: journeyRow.later_purchase_at || null,
    sequence: Array.isArray(data.sequence) ? data.sequence : []
  };
}

export function getSessionIntelligenceJourneys(store, {
  date = null,
  startDate = null,
  endDate = null,
  limit = JOURNEY_DEFAULT_LIMIT,
  rebuild = false
} = {}) {
  const db = getDb();
  const normalizedStore = safeString(store).trim() || 'shawq';
  const range = resolveJourneyRange({ date, startDate, endDate });
  const max = normalizeLimit(limit);
  const sessionRows = selectSessionsForRange(db, normalizedStore, range, max);
  const rows = [];
  let rebuilt = 0;

  for (const sessionRow of sessionRows) {
    const result = buildOrRefreshJourney(db, normalizedStore, sessionRow, { rebuild });
    if (result.rebuilt) rebuilt += 1;
    rows.push(formatJourneyListRow(result.journey));
  }

  return {
    store: normalizedStore,
    period: {
      label: range.label,
      start: range.start,
      end: range.end
    },
    totalSessions: sessionRows.length,
    rebuilt,
    rows
  };
}

export function getSessionIntelligenceJourneyDetail(store, sessionId, {
  rebuild = false
} = {}) {
  const db = getDb();
  const normalizedStore = safeString(store).trim() || 'shawq';
  const normalizedSessionId = safeString(sessionId).trim();
  if (!normalizedSessionId) return null;

  const sessionRow = loadSessionRow(db, normalizedStore, normalizedSessionId);
  if (!sessionRow) return null;

  const result = buildOrRefreshJourney(db, normalizedStore, sessionRow, { rebuild });
  return {
    store: normalizedStore,
    journey: formatJourneyListRow(result.journey),
    steps: result.steps.map((step) => ({
      step_index: step.step_index,
      step_key: step.step_key,
      step_label: step.step_label,
      started_at: step.started_at,
      ended_at: step.ended_at,
      first_event_name: step.first_event_name,
      last_event_name: step.last_event_name,
      page_path: step.page_path,
      page_label: step.page_label,
      product_id: step.product_id,
      product_label: step.product_label,
      variant_id: step.variant_id,
      checkout_step: step.checkout_step,
      event_count: step.event_count
    })),
    rebuilt: result.rebuilt
  };
}
