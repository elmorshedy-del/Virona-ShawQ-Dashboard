# Session Intelligence → Shopify install

This dashboard ingests Shopify behavioral events via:

- **Shopify Custom Pixel** (recommended; covers product/cart/checkout events)
- Optional **Theme snippet** (for extra UI click tracking like size chart)

Raw events auto-delete after **72 hours** on the server (configurable).

## 1) Set your endpoint (Railway)

Your public base URL is your Railway domain, e.g.

- `https://YOUR-APP.up.railway.app`
- or your custom domain (recommended)

The ingest endpoint is:

`https://YOUR-RAILWAY-DOMAIN/api/pixels/shopify`

## 2) Shopify Custom Pixel (Admin → Settings → Customer events)

Create a **Custom pixel** and paste:

```js
// Session Intelligence (Shopify Custom Pixel)
// Sends safe behavioral events to your dashboard.

const ENDPOINT = "https://YOUR-RAILWAY-DOMAIN/api/pixels/shopify";
const STORE = "shawq";

const EVENTS = [
  "page_viewed",
  "product_viewed",
  "collection_viewed",
  "search_submitted",
  "product_added_to_cart",
  "cart_viewed",
  "checkout_started",
  "payment_info_submitted",
  "checkout_completed"
];

function send(event) {
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Attach store + source for easier debugging on the server.
      body: JSON.stringify({ ...event, store: STORE, source: "shopify_custom_pixel_v1" }),
      keepalive: true
    });
  } catch (e) {
    // no-op
  }
}

EVENTS.forEach((name) => {
  analytics.subscribe(name, (event) => send(event));
});
```

Notes:

- Shopify pixels **do not** capture typed checkout fields (PII). The server derives **checkout step drop-off** from the checkout URL (e.g. `?step=shipping_method`).
- You should see incoming events in the dashboard tab **Session Intelligence → Sanity panel**.

## 3) Optional: Theme snippet for extra click tracking

If you want extra UI clicks (e.g. “Size chart” open **and out‑of‑stock size clicks**), add this just before `</body>` in `layout/theme.liquid`:

```html
<script>
  (function () {
    var ENDPOINT = "https://YOUR-RAILWAY-DOMAIN/api/pixels/shopify";
    var STORE = "shawq";

    function send(name, data) {
      try {
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            store: STORE,
            source: "theme_snippet_v1",
            event: { name: name, data: data || {} },
            timestamp: new Date().toISOString(),
            context: { document: { location: { href: location.href } } }
          }),
          keepalive: true
        });
      } catch (e) {}
    }

    document.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-size-chart], .size-chart, a[href*='size-chart']") : null;
      if (el) {
        send("size_chart_opened", { text: (el.textContent || "").trim().slice(0, 80) });
        return;
      }

      // Out‑of‑stock size clicks (customize selectors per theme if needed)
      var sizeEl = e.target && e.target.closest
        ? e.target.closest("[data-option-value], [data-value], [data-size], .size, .swatch, .swatch-element, .product-form__input label")
        : null;
      if (!sizeEl) return;

      var isOos =
        sizeEl.hasAttribute("disabled") ||
        sizeEl.getAttribute("aria-disabled") === "true" ||
        sizeEl.classList.contains("disabled") ||
        sizeEl.classList.contains("is-disabled") ||
        sizeEl.classList.contains("sold-out") ||
        sizeEl.classList.contains("is-unavailable") ||
        sizeEl.getAttribute("data-available") === "false";

      if (!isOos) return;

      var sizeText =
        (sizeEl.getAttribute("data-option-value") ||
         sizeEl.getAttribute("data-value") ||
         sizeEl.getAttribute("data-size") ||
         sizeEl.textContent || "").trim().slice(0, 80);

      send("out_of_stock_size_clicked", {
        size: sizeText || null,
        product_path: location.pathname
      });
    }, true);
  })();
</script>
```

This is optional; the Custom Pixel already covers the key funnel events.

Tip: If your theme uses different markup for size swatches, adjust the selectors in `sizeEl` to match your DOM.
