# Multi-Store Dashboard

Analytics dashboard for VironaX (Salla) and Shawq (Shopify) stores.

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
```

4. Deploy

### Local Development

```bash
npm run install:all
npm run dev
```

For the Neo campaign launcher UI, set a client env var in `client/.env.local`:

```bash
VITE_META_CAMPAIGN_LAUNCHER_API_KEY=replace-with-the-same-secret
```

## Demo Mode

Without API credentials, dashboard shows realistic demo data for both stores.

## Currency Conversion

Shawq's Meta account reports in Turkish Lira (TRY). The dashboard automatically:
1. Fetches daily TRY→USD exchange rate
2. Converts all spend/revenue values to USD
3. Caches rates to avoid repeated API calls

VironaX stays in SAR (no conversion needed).
