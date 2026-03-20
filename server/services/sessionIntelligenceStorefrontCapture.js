const MAX_CAPTURE_STRING_LENGTH = 240;
const MAX_CAPTURE_URL_LENGTH = 1000;
const MAX_CAPTURE_OPTION_ENTRIES = 8;
const MAX_CAPTURE_OPTION_KEY_LENGTH = 80;
const MAX_CAPTURE_OPTION_VALUE_LENGTH = 120;
const MAX_CAPTURE_REASON_LENGTH = 120;
const MAX_CAPTURE_TITLE_LENGTH = 160;
const MAX_CAPTURE_TARGET_KEY_LENGTH = 220;
const MAX_CAPTURE_TIME_ON_PAGE_MS = 24 * 60 * 60 * 1000;
const MAX_CAPTURE_CART_COUNT = 999;

export const THEME_PIXEL_CAPTURE_EVENT_NAMES = new Set([
  'product_state_exposed',
  'size_selected',
  'variant_selected',
  'unavailable_size_clicked',
  'variant_unavailable_clicked',
  'variant_unavailable_viewed',
  'add_to_cart_blocked_unavailable',
  'add_to_cart_failed_other',
  'last_action_checkpoint'
]);

const AVAILABILITY_NORMALIZATION_MAP = new Map([
  ['in_stock', 'in_stock'],
  ['in stock', 'in_stock'],
  ['instock', 'in_stock'],
  ['available', 'in_stock'],
  ['true', 'in_stock'],
  ['out_of_stock', 'out_of_stock'],
  ['out of stock', 'out_of_stock'],
  ['sold_out', 'out_of_stock'],
  ['sold out', 'out_of_stock'],
  ['unavailable', 'out_of_stock'],
  ['false', 'out_of_stock'],
  ['backorder', 'backorder'],
  ['backordered', 'backorder'],
  ['preorder', 'preorder'],
  ['pre-order', 'preorder'],
  ['unknown', 'unknown']
]);

const INVENTORY_HINT_NORMALIZATION_MAP = new Map([
  ['sold_out', 'sold_out'],
  ['sold out', 'sold_out'],
  ['out_of_stock', 'sold_out'],
  ['out of stock', 'sold_out'],
  ['unavailable', 'sold_out'],
  ['backorder', 'backorder'],
  ['backordered', 'backorder'],
  ['preorder', 'preorder'],
  ['pre-order', 'preorder'],
  ['low_stock', 'low_stock'],
  ['low stock', 'low_stock'],
  ['in_stock', 'in_stock'],
  ['available', 'in_stock']
]);

function safeCaptureString(value, maxLength = MAX_CAPTURE_STRING_LENGTH) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizeCaptureNumber(value, { min = null, max = null } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Number.isFinite(min) && numeric < min) return null;
  if (Number.isFinite(max) && numeric > max) return null;
  return numeric;
}

function normalizeAvailabilityState(value) {
  if (typeof value === 'boolean') return value ? 'in_stock' : 'out_of_stock';
  const normalized = safeCaptureString(value, MAX_CAPTURE_REASON_LENGTH);
  if (!normalized) return null;
  return AVAILABILITY_NORMALIZATION_MAP.get(normalized.toLowerCase()) || null;
}

function normalizeInventoryHint(value) {
  const normalized = safeCaptureString(value, MAX_CAPTURE_REASON_LENGTH);
  if (!normalized) return null;
  return INVENTORY_HINT_NORMALIZATION_MAP.get(normalized.toLowerCase()) || null;
}

function normalizeOptionMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length) return null;

  const normalized = {};
  for (const [rawKey, rawValue] of entries.slice(0, MAX_CAPTURE_OPTION_ENTRIES)) {
    const key = safeCaptureString(rawKey, MAX_CAPTURE_OPTION_KEY_LENGTH);
    const optionValue = safeCaptureString(rawValue, MAX_CAPTURE_OPTION_VALUE_LENGTH);
    if (!key || !optionValue) continue;
    normalized[key] = optionValue;
  }

  return Object.keys(normalized).length ? normalized : null;
}

function normalizeTargetSummary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {
    key: safeCaptureString(value.key, MAX_CAPTURE_TARGET_KEY_LENGTH),
    tag: safeCaptureString(value.tag, 32),
    id: safeCaptureString(value.id, 60),
    class_hint: safeCaptureString(value.class_hint, 120),
    role: safeCaptureString(value.role, 40),
    type: safeCaptureString(value.type, 40),
    href: safeCaptureString(value.href, MAX_CAPTURE_URL_LENGTH)
  };

  const pruned = Object.fromEntries(Object.entries(normalized).filter(([, fieldValue]) => fieldValue != null));
  return Object.keys(pruned).length ? pruned : null;
}

function normalizeStorefrontProductState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const optionMap = normalizeOptionMap(value.option_map || value.optionMap);
  const normalized = {
    product_id: safeCaptureString(value.product_id || value.productId, 80),
    product_handle: safeCaptureString(value.product_handle || value.productHandle, 160),
    product_title: safeCaptureString(value.product_title || value.productTitle, MAX_CAPTURE_TITLE_LENGTH),
    variant_id: safeCaptureString(value.variant_id || value.variantId, 80),
    variant_title: safeCaptureString(value.variant_title || value.variantTitle, MAX_CAPTURE_TITLE_LENGTH),
    selected_size: safeCaptureString(value.selected_size || value.selectedSize, 80),
    selected_color: safeCaptureString(value.selected_color || value.selectedColor, 80),
    selected_value: safeCaptureString(value.selected_value || value.selectedValue || value.value, 120),
    option_type: safeCaptureString(value.option_type || value.optionType, 40),
    availability_state: normalizeAvailabilityState(value.availability_state ?? value.availabilityState ?? value.available),
    inventory_hint: normalizeInventoryHint(value.inventory_hint || value.inventoryHint),
    state_source: safeCaptureString(value.state_source || value.stateSource, 80),
    option_map: optionMap
  };

  const pruned = Object.fromEntries(Object.entries(normalized).filter(([, fieldValue]) => fieldValue != null));
  return Object.keys(pruned).length ? pruned : null;
}

function normalizeStorefrontAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const normalized = {
    target_key: safeCaptureString(value.target_key || value.targetKey, MAX_CAPTURE_TARGET_KEY_LENGTH),
    label: safeCaptureString(value.label, 160),
    value: safeCaptureString(value.value, 160),
    quantity: normalizeCaptureNumber(value.quantity, { min: 0, max: MAX_CAPTURE_CART_COUNT }),
    target: normalizeTargetSummary(value.target)
  };
  const pruned = Object.fromEntries(Object.entries(normalized).filter(([, fieldValue]) => fieldValue != null));
  return Object.keys(pruned).length ? pruned : null;
}

export function normalizeStorefrontCaptureEventData(eventName, eventDataRaw) {
  if (!THEME_PIXEL_CAPTURE_EVENT_NAMES.has(String(eventName || '').trim())) {
    return eventDataRaw;
  }

  if (!eventDataRaw || typeof eventDataRaw !== 'object' || Array.isArray(eventDataRaw)) {
    return null;
  }

  const productState = normalizeStorefrontProductState(eventDataRaw);
  const currentProductState = normalizeStorefrontProductState(eventDataRaw.product_state || eventDataRaw.productState);
  const previousProductState = normalizeStorefrontProductState(eventDataRaw.previous_product_state || eventDataRaw.previousProductState);
  const target = normalizeTargetSummary(eventDataRaw.target);
  const action = normalizeStorefrontAction(eventDataRaw.action);

  const normalized = {
    target_key: safeCaptureString(eventDataRaw.target_key || eventDataRaw.targetKey, MAX_CAPTURE_TARGET_KEY_LENGTH),
    target,
    reason: safeCaptureString(eventDataRaw.reason, MAX_CAPTURE_REASON_LENGTH),
    label: safeCaptureString(eventDataRaw.label, 160),
    value: safeCaptureString(eventDataRaw.value, 160),
    blocked_reason: safeCaptureString(eventDataRaw.blocked_reason || eventDataRaw.blockedReason, MAX_CAPTURE_REASON_LENGTH),
    action_name: safeCaptureString(eventDataRaw.action_name || eventDataRaw.actionName, 120),
    action_ts: safeCaptureString(eventDataRaw.action_ts || eventDataRaw.actionTs, 80),
    page_url: safeCaptureString(eventDataRaw.page_url || eventDataRaw.pageUrl, MAX_CAPTURE_URL_LENGTH),
    page_path: safeCaptureString(eventDataRaw.page_path || eventDataRaw.pagePath, 500),
    time_on_page_ms: normalizeCaptureNumber(eventDataRaw.time_on_page_ms || eventDataRaw.timeOnPageMs, {
      min: 0,
      max: MAX_CAPTURE_TIME_ON_PAGE_MS
    }),
    cart_count: normalizeCaptureNumber(eventDataRaw.cart_count || eventDataRaw.cartCount, {
      min: 0,
      max: MAX_CAPTURE_CART_COUNT
    }),
    product_state: currentProductState,
    previous_product_state: previousProductState,
    action
  };

  const mergedState = productState || currentProductState;
  if (mergedState) {
    Object.assign(normalized, mergedState);
  }

  const pruned = Object.fromEntries(Object.entries(normalized).filter(([, value]) => value != null));
  return Object.keys(pruned).length ? pruned : null;
}
