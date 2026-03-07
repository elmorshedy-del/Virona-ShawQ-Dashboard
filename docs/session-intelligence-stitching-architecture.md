# Session Intelligence stitching architecture

## Goal

Build one durable shopper journey ledger that can answer:

- who this shopper is
- which session the event belongs to
- where the shopper came from
- what the shopper did next
- which cart / checkout / order the journey reached
- what the last meaningful action was before exit

## Identity spine

Every event should attempt to carry these identifiers:

| Key | Required | Purpose |
| --- | --- | --- |
| `client_id` | Yes | Browser-level anonymous identity across visits and event sources |
| `session_id` | Yes | Visit-level timeline identity |
| `shopper_number` | Derived | Internal stitched shopper identity shown in the dashboard |
| `user_id` | Recommended | Known Shopify customer identity when available |
| `cart_token` | Recommended | Storefront cart continuity |
| `checkout_token` | Required for checkout | Checkout continuity across checkout and purchase events |
| `order_id` | Required for purchase reconciliation | Final commerce truth |
| `tab_id` | Recommended | Multi-tab separation and duplicate reduction |

## Capture layers

1. `shopify_custom_pixel`
   - Official Shopify customer events
   - Best source for product/cart/checkout/payment/purchase continuity
2. `theme_pixel`
   - Theme-level behavioral and diagnostic detail
   - Variant selections, size selections, checkout CTA clicks, last-action checkpoints, dead clicks, rage clicks, JS errors, form invalids
3. `reconciliation`
   - Server-side stitching and backfill when browser coverage is incomplete
4. `survey`
   - Linked shopper explanations tied back to sessions and issue clusters

## Canonical event catalog

### Journey / commerce

- `page_viewed`
- `collection_viewed`
- `product_viewed`
- `search_submitted`
- `product_added_to_cart`
- `product_removed_from_cart`
- `cart_viewed`
- `checkout_started`
- `checkout_contact_info_submitted`
- `checkout_address_info_submitted`
- `checkout_shipping_info_submitted`
- `payment_info_submitted`
- `checkout_completed`

### Theme behavior

- `variant_selected`
- `size_selected`
- `add_to_cart_clicked`
- `cart_quantity_changed`
- `cart_drawer_opened`
- `checkout_cta_clicked`
- `last_action_checkpoint`

### Diagnostics

- `dead_click`
- `rage_click`
- `js_error`
- `unhandled_rejection`
- `form_invalid`
- `scroll_depth`
- `scroll_max`

## Stitching rules

1. Resolve a journey in this order:
   - `checkout_token`
   - `cart_token`
   - explicit `session_id`
   - rolling `client_id` session
   - deterministic fallback session
2. Resolve a shopper in this order:
   - existing `client_id` -> `shopper_number`
   - `user_id` -> linked `shopper_number`
   - create / keep anonymous shopper number
3. Persist crosswalk tables:
   - `si_checkout_session_links`
   - `si_cart_session_links`
   - `si_user_identity_links`
4. Keep `si_sessions` as the derived latest session state:
   - entry page
   - entry referrer
   - last user/cart/checkout/order IDs
   - last product and variant
   - last checkout step
   - latest campaign context
5. Keep `si_events` as the canonical append-only event ledger.

## Reconciliation and backfill

The browser will always miss some truth. Reconciliation should:

- reconnect missing purchases from Shopify order truth
- reconnect checkout to purchase through `checkout_token`
- reconnect known users to earlier anonymous sessions via `user_id` + `client_id`
- preserve the last meaningful action before exit through `last_action_checkpoint`

## Shopify install surfaces

### API responses

- `GET /api/session-intelligence/architecture?store=<store>`
- `GET /api/session-intelligence/install/shopify?store=<store>`

### Shopify Admin install

1. Install the generated custom pixel script in Shopify Admin -> Settings -> Customer events.
2. Install the generated theme snippet in `layout/theme.liquid`.
3. Keep both installed.
   - Custom pixel = official commerce coverage
   - Theme pixel = behavioral and diagnostic coverage

## Detective-grade output this enables

When stitching is healthy, Session Intelligence can derive:

- landing page and traffic source
- first product and last product before cart
- cart reached / checkout reached / payment reached
- last meaningful action before exit
- whether the shopper returned later
- whether the shopper eventually purchased

That is the backbone for Clarity-style case files without video.
