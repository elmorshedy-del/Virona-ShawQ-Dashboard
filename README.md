# Multi-Store Dashboard

Analytics dashboard for VironaX (Salla) and Shawq (Shopify) stores.

## Engineering Rule

- Critical: avoid magic numbers in production code. Use named constants or config for limits, thresholds, TTLs, retry counts, windows, weights, and heuristics.

## Features

- **Store Switcher**: Toggle between VironaX and Shawq from the header
- **Dynamic Countries**: Countries pulled from actual data (no hardcoded lists)
- **Currency Conversion**: Shawq Meta spend auto-converts from TRY to USD
- **Real Campaign Names**: Pulled directly from Meta API
- **Full Funnel Metrics**: Impressions → Clicks → LPV → ATC → Checkout → Conversions

## Store Configurations

| Store | E-commerce | Meta Currency | Display Currency |
|-------|------------|---------------|------------------|
| VironaX | Salla | SAR | SAR |
| Shawq | Shopify | TRY | USD (auto-converted) |

## Setup

### Railway (Recommended)

1. Push code to GitHub
2. Connect repo to Railway
3. Add environment variables:

```
# VironaX
VIRONAX_META_AD_ACCOUNT_ID=...
VIRONAX_META_ACCESS_TOKEN=...
VIRONAX_SALLA_ACCESS_TOKEN=...

# Shawq
SHAWQ_META_AD_ACCOUNT_ID=1026963365133388
SHAWQ_META_ACCESS_TOKEN=...
SHAWQ_SHOPIFY_STORE=shawqq.myshopify.com
SHAWQ_SHOPIFY_ACCESS_TOKEN=shpat_...

# Campaign launcher protection (required for POST /api/meta/campaign-launcher)
META_CAMPAIGN_LAUNCHER_API_KEY=replace-with-strong-secret
# Optional ad-account allowlists (comma-separated)
META_ALLOWED_AD_ACCOUNT_IDS=
VIRONAX_META_ALLOWED_AD_ACCOUNT_IDS=
SHAWQ_META_ALLOWED_AD_ACCOUNT_IDS=

# Creative Funnel AI Summary provider options
# OpenAI (default)
OPENAI_API_KEY=...

# DeepSeek (optional)
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MAX_OUTPUT_TOKENS=4096

# Fireworks (optional, enables GLM-5 in UI)
FIREWORKS_API_KEY=...
FIREWORKS_BASE_URL=https://api.fireworks.ai/inference/v1
FIREWORKS_DEFAULT_MODEL=accounts/fireworks/models/glm-5
FIREWORKS_MAX_OUTPUT_TOKENS=4096
```

4. Deploy

### Persistent Database (Required for Session Intelligence)

Session Intelligence (pixels, events, investigations) relies on the SQLite database. If your platform filesystem is ephemeral, data will reset on each deploy unless you mount a persistent disk.

Recommended (Railway):

1. Add a Railway **Volume** and mount it at `/data`
2. Set one of:

```
# Option A (recommended)
PERSISTENT_DATA_DIR=/data

# Option B
DATABASE_PATH=/data/dashboard.db
```

### Local Development

```bash
npm run install:all
npm run dev
```

For the Neo campaign launcher UI, set a client env var in `client/.env.local`:

```bash
VITE_META_CAMPAIGN_LAUNCHER_API_KEY=replace-with-the-same-secret
```

Creative Funnel AI summary model choice is controlled in-app (OpenAI, DeepSeek, GLM-5 via Fireworks). No extra client env var is required for model selection.

## Demo Mode

Without API credentials, dashboard shows realistic demo data for both stores.

## Currency Conversion

Shawq's Meta account reports in Turkish Lira (TRY). The dashboard automatically:
1. Fetches daily TRY→USD exchange rate
2. Converts all spend/revenue values to USD
3. Caches rates to avoid repeated API calls

VironaX stays in SAR (no conversion needed).
