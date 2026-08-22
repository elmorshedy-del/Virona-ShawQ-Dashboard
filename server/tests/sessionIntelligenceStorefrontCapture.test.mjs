import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStorefrontCaptureEventData } from '../services/sessionIntelligenceStorefrontCapture.js';

test('normalizes product state exposure payloads into the storefront capture contract', () => {
  const normalized = normalizeStorefrontCaptureEventData('product_state_exposed', {
    reason: 'page_load',
    product_id: '12345',
    product_handle: 'kuffiyah-engraved-denim-skirt',
    product_title: 'Kuffiyah Engraved Denim Skirt',
    variant_id: '98765',
    variant_title: 'Large / Black',
    selected_size: 'Large',
    selected_color: 'Black',
    availability_state: false,
    inventory_hint: 'Sold Out',
    option_map: {
      size: 'Large',
      color: 'Black',
      ignored: ''
    }
  });

  assert.deepEqual(normalized, {
    reason: 'page_load',
    product_id: '12345',
    product_handle: 'kuffiyah-engraved-denim-skirt',
    product_title: 'Kuffiyah Engraved Denim Skirt',
    variant_id: '98765',
    variant_title: 'Large / Black',
    selected_size: 'Large',
    selected_color: 'Black',
    availability_state: 'out_of_stock',
    inventory_hint: 'sold_out',
    option_map: {
      size: 'Large',
      color: 'Black'
    }
  });
});

test('normalizes last action checkpoints and nested product state', () => {
  const normalized = normalizeStorefrontCaptureEventData('last_action_checkpoint', {
    action_name: 'size_selected',
    action_ts: '2026-03-20T12:00:00.000Z',
    page_url: '/products/example',
    page_path: '/products/example',
    time_on_page_ms: 2300,
    product_state: {
      product_id: '100',
      variant_id: '200',
      selected_size: 'M',
      availability_state: 'in stock',
      option_map: { size: 'M' }
    },
    action: {
      target_key: 'button.size-m',
      label: 'Size',
      value: 'M',
      quantity: 2,
      target: {
        key: 'button.size-m',
        tag: 'button'
      }
    }
  });

  assert.equal(normalized.action_name, 'size_selected');
  assert.equal(normalized.time_on_page_ms, 2300);
  assert.deepEqual(normalized.product_state, {
    product_id: '100',
    variant_id: '200',
    selected_size: 'M',
    availability_state: 'in_stock',
    option_map: { size: 'M' }
  });
  assert.deepEqual(normalized.action, {
    target_key: 'button.size-m',
    label: 'Size',
    value: 'M',
    quantity: 2,
    target: {
      key: 'button.size-m',
      tag: 'button'
    }
  });
});

test('leaves non-contract events untouched', () => {
  const payload = { message: 'boom', extra: { keep: true } };
  assert.equal(normalizeStorefrontCaptureEventData('js_error', payload), payload);
});
