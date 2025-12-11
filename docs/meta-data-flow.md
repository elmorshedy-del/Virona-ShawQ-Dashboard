# Meta data pathways

This guide summarizes how Meta ad data travels through the system so you can compare what AI Budget ("aibudget") and the unified analytics service are seeing.

## Sync and storage
- **Background cadence:** The server runs `backgroundSync` every 15 minutes, invoking `syncMetaData` for both stores before serving API requests. 【F:server/server.js†L43-L69】
- **Object metadata:** `syncMetaData` calls `fetchMetaObjects`, which paginates campaigns, ad sets, and ads, then upserts their names, statuses, budgets, and hierarchy into the `meta_objects` table. Status maps built here are reused later. 【F:server/services/metaService.js†L40-L200】
- **Insights:** `syncMetaData` then calls `syncMetaLevel` for campaigns, ad sets, and ads. It paginates Meta insights with a daily grain, converts currency, attaches status/effective_status from the previously built maps (plus ad-level lookups), and writes rows into `meta_daily_metrics`, `meta_adset_metrics`, and `meta_ad_metrics`. 【F:server/services/metaService.js†L265-L388】【F:server/services/metaService.js†L388-L489】
- **Backfill:** If a store has not completed a historical backfill, `performHistoricalBackfill` runs after the regular sync to fill older ranges into the same tables. 【F:server/services/metaService.js†L603-L706】

## How AI Budget reads data
- `getBudgetIntelligence` reads directly from `meta_daily_metrics` (campaign-level) and `meta_adset_metrics` (ad set-level) for the requested date window, expecting country-level breakdowns and status fields that were populated during sync. 【F:server/services/budgetIntelligenceService.js†L67-L140】
- The service also reuses historical `meta_daily_metrics` to build priors (60-day window) for CAC and ROAS when generating recommendations. 【F:server/services/budgetIntelligenceService.js†L35-L105】

## How unified analytics reads data
- `getDashboard` aggregates spend, revenue, and orders from `meta_daily_metrics` (with optional filters for inactive objects) to build the overview, trends, and campaign cards. 【F:server/services/analyticsService.js†L201-L258】
- Structure-aware routes like `getAllMetaObjects` pull names, statuses, budgets, and hierarchy directly from `meta_objects`, so any object-level mismatch originates from the fetch step. 【F:server/services/analyticsService.js†L1367-L1425】

## Troubleshooting mismatches
1. **Confirm sync freshness:** Check the latest `syncMetaData` logs and ensure background syncs are running; if backfill is pending, older dates may differ between features. 【F:server/server.js†L43-L69】【F:server/services/metaService.js†L603-L706】
2. **Table parity:** Both services read from the same tables (`meta_daily_metrics` and `meta_adset_metrics` for metrics; `meta_objects` for structure). If numbers diverge, compare those tables for the specific date range and country filters each feature applies. 【F:server/services/budgetIntelligenceService.js†L67-L140】【F:server/services/analyticsService.js†L201-L258】
3. **Status filters:** Analytics can include/exclude inactive items based on request params, while AI Budget uses the raw rows. Align the status/effective_status filters when comparing outputs. 【F:server/services/analyticsService.js†L201-L258】
4. **Hierarchy checks:** If names or statuses look off, inspect the `meta_objects` entries to trace campaign → ad set → ad linkage and confirm the fetch step captured the correct values. 【F:server/services/metaService.js†L40-L200】【F:server/services/analyticsService.js†L1367-L1425】
