import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb, getDb } from './db/database.js';
import analyticsRouter from './routes/analytics.js';
import manualRouter from './routes/manual.js';
import notificationsRouter from './routes/notifications.js';
import aiRouter from './routes/ai.js';
import budgetIntelligenceRouter from './routes/budgetIntelligence.js';
import whatifRouter from './routes/whatif.js';
import aibudgetRouter from './routes/aibudget.js';
import insightsRouter from './routes/insights.js';
import metaRouter from './routes/meta.js';
import exchangeRateRoutes from './routes/exchangeRate.js';
import attributionRouter from './routes/attribution.js';
import creativeIntelligenceRouter from './routes/creativeIntelligence.js';
import creativeStudioRouter from './routes/creativeStudio.js';
import pixelsRouter from './routes/pixels.js';
import fatigueRouter from './routes/fatigue.js';
import metaAuthRouter from './routes/metaAuth.js';
import shopifyAuthRouter from './routes/shopifyAuth.js';
import testimonialExtractorRouter from './routes/testimonialExtractor.js';
import sessionIntelligenceRouter from './routes/sessionIntelligence.js';
import productRadarRouter from './routes/productRadar.js';
import productFinderRouter from './routes/productFinder.js';
import customerInsightsRouter from './routes/customerInsights.js';
import metaDemographicsRoutes from './routes/metaDemographics.js';
import watchtowerRouter from './routes/watchtower.js';
import croForensicsRouter from './routes/croForensics.js';
import conversionUiFixLabRouter from './routes/conversionUiFixLab.js';
import { ensureFaceModelsLoaded } from './services/testimonialExtractorService.js';
import { runWhatIfMigration } from './db/whatifMigration.js';
import { runCreativeIntelligenceMigration } from './db/creativeIntelligenceMigration.js';
import { runMigration as runCreativeStudioMigration } from './db/creativeStudioMigration.js';
import { runMigration as runAIBudgetMigration } from './db/aiBudgetMigration.js';
import { runMigration as runCompetitorSpyMigration } from './db/competitorSpyMigration.js';
import { runSessionIntelligenceMigration } from './db/sessionIntelligenceMigration.js';
import { runWatchtowerMigration } from './db/watchtowerMigration.js';
import { runConversionUiFixLabMigration } from './db/conversionUiFixLabMigration.js';
import { smartSync as whatifSmartSync } from './services/whatifMetaService.js';
import { syncMetaData, getExchangeRateForDate } from './services/metaService.js';
import { syncShopifyOrders } from './services/shopifyService.js';
import { syncSallaOrders } from './services/sallaService.js';
import { cleanupOldNotifications } from './services/notificationService.js';
import { cleanupSessionIntelligenceRaw } from './services/sessionIntelligenceService.js';
import { scheduleCreativeFunnelSummaryJobs } from './services/creativeFunnelSummaryService.js';
import { formatDateAsGmt3 } from './utils/dateUtils.js';
import { resolveExchangeRateProviders } from './services/exchangeRateConfig.js';
import {
  fetchApilayerHistoricalTryToUsdRate,
  fetchCurrencyFreaksHistoricalTryToUsdRate,
  fetchCurrencyFreaksTimeseriesTryToUsdRates,
  fetchFrankfurterTryToUsdRate,
  fetchOXRHistoricalTryToUsdRate
} from './services/exchangeRateProviders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientPublic = path.join(__dirname, '../client/public');

const app = express();
const PORT = process.env.PORT || 3001;
const SHOPIFY_SYNC_INTERVAL = parseInt(process.env.SHOPIFY_SYNC_INTERVAL_MS || '60000', 10);
const GMT3_OFFSET_MS = 3 * 60 * 60 * 1000;
const META_DAYTURN_PULSE_MINUTES = (process.env.META_DAYTURN_PULSE_MINUTES || '5,15')
  .split(',')
  .map((value) => parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);

function getMsUntilNextGmt3Midnight() {
  const now = new Date();
  const gmt3Now = new Date(now.getTime() + GMT3_OFFSET_MS);
  const gmt3NextMidnight = new Date(Date.UTC(
    gmt3Now.getUTCFullYear(),
    gmt3Now.getUTCMonth(),
    gmt3Now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  ));
  const nextMidnightUtcMs = gmt3NextMidnight.getTime() - GMT3_OFFSET_MS;
  return Math.max(0, nextMidnightUtcMs - now.getTime());
}

function scheduleGmt3DailyJob(label, job) {
  const scheduleNext = () => {
    const delayMs = getMsUntilNextGmt3Midnight();
    console.log(`[Scheduler] Next ${label} in ${Math.round(delayMs / 1000)}s`);
    setTimeout(async () => {
      try {
        await job();
      } catch (error) {
        console.error(`[Scheduler] ${label} error:`, error);
      }
      scheduleNext();
    }, delayMs);
  };
  scheduleNext();
}


let metaDayTurnPulseTimers = [];

function clearMetaDayTurnPulses() {
  metaDayTurnPulseTimers.forEach((timer) => clearTimeout(timer));
  metaDayTurnPulseTimers = [];
}

function hasMetaDailyData(store, dateStr) {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT 1 FROM meta_daily_metrics
      WHERE store = ? AND date = ?
      LIMIT 1
    `).get(store, dateStr);
    return !!row;
  } catch (error) {
    console.warn(`[Meta] Failed to check daily data for ${store} ${dateStr}: ${error.message}`);
    return false;
  }
}

async function runMetaDayTurnPulse(stores, dateStr, minutes) {
  const remaining = stores.filter((store) => !hasMetaDailyData(store, dateStr));
  if (!remaining.length) {
    console.log(`[Meta] Day-turn pulse +${minutes}m skipped (data already available)`);
    return;
  }

  console.log(`[Meta] Day-turn pulse +${minutes}m starting for ${remaining.join(', ')}`);
  try {
    await Promise.all(
      remaining.map((store) => syncMetaData(store, { rangeDays: 2, skipBackfill: true }))
    );
    console.log(`[Meta] Day-turn pulse +${minutes}m complete`);
  } catch (error) {
    console.error(`[Meta] Day-turn pulse +${minutes}m error:`, error);
  }
}

function scheduleMetaDayTurnPulses(stores, dateStr) {
  clearMetaDayTurnPulses();
  if (!META_DAYTURN_PULSE_MINUTES.length || !stores.length) {
    return;
  }
  META_DAYTURN_PULSE_MINUTES.forEach((minutes) => {
    const delayMs = minutes * 60 * 1000;
    const timer = setTimeout(() => runMetaDayTurnPulse(stores, dateStr, minutes), delayMs);
    metaDayTurnPulseTimers.push(timer);
  });
}


// Initialize database
initDb();

ensureFaceModelsLoaded().catch(error => {
  console.error('❌ Failed to load face detection models:', error);
  process.exit(1);
});

// Run AIBudget schema migration on startup
runAIBudgetMigration()
  .then(() => {
    console.log('✅ AIBudget schema ready');
  })
  .catch(err => {
    console.error('⚠️  AIBudget migration warning:', err);
  });

// Run What-If migration (creates whatif_timeseries table if not exists)
runWhatIfMigration();

// Run Creative Intelligence migration
runCreativeIntelligenceMigration();
runCreativeStudioMigration();
runCompetitorSpyMigration();
runSessionIntelligenceMigration();
runWatchtowerMigration();
runConversionUiFixLabMigration();

// Schedule creative funnel summaries (daily/weekly + spend reset checks)
scheduleCreativeFunnelSummaryJobs();

// One-time Salla cleanup (safe - won't crash if tables don't exist)
try {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS cleanup_flags (flag_name TEXT PRIMARY KEY, completed_at TEXT)`);
  const done = db.prepare(`SELECT 1 FROM cleanup_flags WHERE flag_name = 'salla_demo_cleanup'`).get();
  if (!done) {
    db.prepare(`DELETE FROM salla_orders`).run();
    db.prepare(`DELETE FROM notifications WHERE source = 'salla'`).run();
    db.prepare(`INSERT INTO cleanup_flags VALUES ('salla_demo_cleanup', ?)`).run(new Date().toISOString());
    console.log('[Cleanup] Salla demo data deleted');
  }
} catch (e) { console.log('[Cleanup] Skipped:', e.message); }

// One-time VironaX Meta notification reset (deployment-only)
try {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS cleanup_flags (flag_name TEXT PRIMARY KEY, completed_at TEXT)`);
  const done = db.prepare(`SELECT 1 FROM cleanup_flags WHERE flag_name = 'vironax_meta_notification_reset_v2'`).get();
  if (!done) {
    const result = db.prepare(`DELETE FROM notifications WHERE store = 'vironax' AND source = 'meta'`).run();
    db.prepare(`INSERT INTO cleanup_flags VALUES ('vironax_meta_notification_reset_v2', ?)`).run(new Date().toISOString());
    console.log(`[Cleanup] VironaX Meta notifications reset (${result.changes})`);
  }
} catch (e) { console.log('[Cleanup] Virona reset skipped:', e.message); }

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Favicon fallback
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(clientPublic, 'virona-logo.svg'));
});

// API Routes
app.use('/api/analytics', analyticsRouter);
app.use('/api/manual', manualRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/budget-intelligence', budgetIntelligenceRouter);
app.use('/api/whatif', whatifRouter);
app.use('/api/aibudget', aibudgetRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/meta', metaRouter);
app.use('/api/auth/meta', metaAuthRouter);
app.use('/api/auth/shopify', shopifyAuthRouter);
app.use('/api/attribution', attributionRouter);
app.use('/api/exchange-rates', exchangeRateRoutes);
app.use('/api/creative-intelligence', creativeIntelligenceRouter);
app.use('/api/creative-studio', creativeStudioRouter);
app.use('/api/pixels', pixelsRouter);
app.use('/api/session-intelligence', sessionIntelligenceRouter);
app.use('/api/product-radar', productRadarRouter);
app.use('/api/product-finder', productFinderRouter);
app.use('/api/customer-insights', customerInsightsRouter);
app.use('/api/meta-demographics', metaDemographicsRoutes);
app.use('/api/watchtower', watchtowerRouter);
app.use('/api/fatigue', fatigueRouter);
app.use('/api/testimonials', testimonialExtractorRouter);
app.use('/api/cro-forensics', croForensicsRouter);
app.use('/api/conversion-ui-fix-lab', conversionUiFixLabRouter);

// Serve static files in production
const clientDist = path.join(__dirname, '../client/dist');
const clientIndexPath = path.join(clientDist, 'index.html');
const hasClientBuild = fs.existsSync(clientIndexPath);

if (hasClientBuild) {
  app.use(express.static(clientDist));
} else {
  console.warn(`[Static] Client build not found at ${clientIndexPath}. Running in API-only mode.`);
}

// Convenience URL for installs on non-Shopify storefronts:
// <script src="https://YOUR-DOMAIN/pixel.js?store=shawq"></script>
// Redirects to the actual pixel route mounted under /api to avoid SPA fallthrough.
app.get('/pixel.js', (req, res) => {
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, `/api/pixels/pixel.js${query}`);
});

app.get('*', (req, res, next) => {
  // Don't serve the SPA shell for API routes (prevents "Unexpected token <" JSON errors).
  if (req.path.startsWith('/api')) return next();
  if (hasClientBuild) {
    return res.sendFile(clientIndexPath);
  }
  return res.status(200).send('Virona backend is running. Frontend build is not available on this instance.');
});

// Background sync every 15 minutes
async function backgroundSync() {
  console.log('[Sync] Starting background sync...');
  try {
    await Promise.all([
      syncMetaData('vironax'),
      syncMetaData('shawq'),
      syncShopifyOrders(),
      syncSallaOrders()
    ]);
    cleanupOldNotifications();
    console.log('[Sync] Background sync complete');
  } catch (error) {
    console.error('[Sync] Background sync error:', error);
  }
}

// What-If data sync (separate from main sync)
async function whatifSync() {
  console.log('[WhatIf] Starting What-If data sync...');
  try {
    await whatifSmartSync('vironax');
    await whatifSmartSync('shawq');
    console.log('[WhatIf] What-If sync complete');
  } catch (error) {
    console.error('[WhatIf] What-If sync error:', error);
  }
}

// Rapid Shopify sync to minimize notification lag
async function shopifyRealtimeSync() {
  console.log('[Shopify] Starting rapid Shopify sync...');
  try {
    await syncShopifyOrders();
    console.log('[Shopify] Rapid Shopify sync complete');
  } catch (error) {
    console.error('[Shopify] Rapid Shopify sync error:', error);
  }
}

// Meta day-turn sync (fast range, no backfill)
async function dayTurnMetaSync() {
  console.log('[Meta] Starting day-turn sync...');
  const today = formatDateAsGmt3(new Date());
  const stores = ['vironax', 'shawq'];
  try {
    await Promise.all(
      stores.map((store) => syncMetaData(store, { rangeDays: 2, skipBackfill: true }))
    );
    console.log('[Meta] Day-turn sync complete');
  } catch (error) {
    console.error('[Meta] Day-turn sync error:', error);
  }

  const missingStores = stores.filter((store) => !hasMetaDailyData(store, today));
  if (missingStores.length) {
    console.log(`[Meta] Day-turn data missing for ${today}; scheduling pulses for ${missingStores.join(', ')}`);
    scheduleMetaDayTurnPulses(missingStores, today);
  } else {
    clearMetaDayTurnPulses();
    console.log(`[Meta] Day-turn data ready for ${today}; no pulses scheduled`);
  }
}

// Backfill missing exchange rates on startup (historical only)
async function backfillMissingExchangeRates(daysBack = 60) {
  const db = getDb();
  const maxCalls = parseInt(process.env.EXCHANGE_RATE_BACKFILL_MAX_CALLS || '100', 10);
  const { primaryBackfillProvider, secondaryBackfillProvider } = resolveExchangeRateProviders();

  if (!primaryBackfillProvider) {
    console.log('[Exchange] No backfill provider configured, skipping missing-rate backfill');
    return;
  }

  const missingDates = [];
  const yesterday = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));

  for (let i = 1; i <= daysBack; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = formatDateAsGmt3(date);

    // Daily sync owns yesterday; do not backfill it with a historical source.
    if (dateStr === yesterday) {
      continue;
    }

    const existing = db.prepare(`
      SELECT 1 FROM exchange_rates
      WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
    `).get(dateStr);

    if (!existing) {
      missingDates.push(dateStr);
    }
  }

  if (!missingDates.length) {
    console.log('[Exchange] No missing exchange rates found for backfill');
    return;
  }

  const primary = String(primaryBackfillProvider).toLowerCase();
  const secondary =
    secondaryBackfillProvider && String(secondaryBackfillProvider).toLowerCase() !== primary
      ? String(secondaryBackfillProvider).toLowerCase()
      : null;

  console.log(
    `[Exchange] Backfilling ${missingDates.length} missing dates (primary: ${primary}` +
      `${secondary ? `, secondary: ${secondary}` : ''}, max ${maxCalls} calls)`
  );

  if (maxCalls < 1) {
    console.log('[Exchange] Backfill disabled by EXCHANGE_RATE_BACKFILL_MAX_CALLS');
    return;
  }

  let callBudget = maxCalls;
  let fetched = 0;
  let failed = 0;

  const insertRate = (rate, dateStr, source) => {
    db.prepare(`
      INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
      VALUES ('TRY', 'USD', ?, ?, ?)
    `).run(rate, dateStr, source);

    fetched += 1;
    console.log(`[Exchange] Backfilled ${dateStr}: TRY→USD = ${rate.toFixed(6)} (${source})`);
  };

  const remainingDates = [];

  // Primary backfill
  if (primary === 'currencyfreaks') {
    const sortedDates = [...missingDates].sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];

    if (callBudget < 1) {
      console.log('[Exchange] No call budget remaining for CurrencyFreaks timeseries.');
      return;
    }

    const series = await fetchCurrencyFreaksTimeseriesTryToUsdRates(startDate, endDate);

    // Count this as a single call attempt for throttling purposes.
    callBudget -= 1;

    if (!series.ok) {
      console.warn(`[Exchange] CurrencyFreaks timeseries failed (${series.code}${series.status ? `, HTTP ${series.status}` : ''}): ${series.message}`);
      remainingDates.push(...missingDates);
    } else {
      for (const dateStr of missingDates) {
        const rate = series.ratesByDate.get(dateStr);
        if (!Number.isFinite(rate) || rate <= 0) {
          remainingDates.push(dateStr);
          continue;
        }
        insertRate(rate, dateStr, series.source || 'currencyfreaks');
      }
    }
  } else {
    for (const dateStr of missingDates) {
      if (callBudget < 1) {
        console.log(`[Exchange] Reached max backfill calls (${maxCalls}). Stopping.`);
        remainingDates.push(dateStr);
        continue;
      }

      let result = null;

      if (primary === 'oxr') {
        result = await fetchOXRHistoricalTryToUsdRate(dateStr);
      } else if (primary === 'apilayer') {
        result = await fetchApilayerHistoricalTryToUsdRate(dateStr);
      } else if (primary === 'frankfurter') {
        result = await fetchFrankfurterTryToUsdRate(dateStr);
      } else {
        console.warn(`[Exchange] Unknown primary backfill provider "${primary}"; skipping.`);
        remainingDates.push(dateStr);
        continue;
      }

      callBudget -= 1;

      if (result.ok && Number.isFinite(result.tryToUsd) && result.tryToUsd > 0) {
        insertRate(result.tryToUsd, dateStr, result.source || primary);
      } else {
        remainingDates.push(dateStr);
        failed += 1;
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  // Secondary fallback (only for the dates primary couldn't fill)
  if (secondary && remainingDates.length && callBudget > 0) {
    console.log(`[Exchange] Trying secondary backfill for ${remainingDates.length} remaining dates (${secondary})...`);

    for (const dateStr of remainingDates) {
      if (callBudget < 1) {
        console.log(`[Exchange] Reached max backfill calls (${maxCalls}). Stopping secondary.`);
        break;
      }

      let result = null;
      if (secondary === 'oxr') {
        result = await fetchOXRHistoricalTryToUsdRate(dateStr);
      } else if (secondary === 'apilayer') {
        result = await fetchApilayerHistoricalTryToUsdRate(dateStr);
      } else if (secondary === 'frankfurter') {
        result = await fetchFrankfurterTryToUsdRate(dateStr);
      } else if (secondary === 'currencyfreaks') {
        // Secondary CurrencyFreaks uses per-date historical endpoint for a single day.
        result = await fetchCurrencyFreaksHistoricalTryToUsdRate(dateStr);
      } else {
        console.warn(`[Exchange] Unknown secondary backfill provider "${secondary}"; skipping.`);
        break;
      }

      callBudget -= 1;

      if (result.ok && Number.isFinite(result.tryToUsd) && result.tryToUsd > 0) {
        insertRate(result.tryToUsd, dateStr, result.source || secondary);
      } else {
        failed += 1;
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  console.log(`[Exchange] Backfill complete: fetched=${fetched}, failed=${failed}`);
}

// Daily exchange rate sync - fetch yesterday's final rate
async function syncDailyExchangeRate() {
  const db = getDb();
  const yesterday = formatDateAsGmt3(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const existing = db.prepare(`
    SELECT rate FROM exchange_rates
    WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
  `).get(yesterday);

  if (existing) {
    console.log(`[Exchange] Already have rate for ${yesterday}: ${existing.rate.toFixed(6)}`);
    return;
  }

  const rate = await getExchangeRateForDate(yesterday);
  if (!rate) {
    console.warn(`[Exchange] Daily sync missing rate for ${yesterday}`);
    return;
  }

  console.log(`[Exchange] Daily sync stored ${yesterday}: TRY→USD = ${rate.toFixed(6)}`);
}

// Initial sync on startup
setTimeout(backgroundSync, 5000);

// Initial What-If sync (delayed 2 min to let main sync finish)
setTimeout(whatifSync, 2 * 60 * 1000);

// Session Intelligence cleanup (raw events retention)
setTimeout(() => {
  try {
    const result = cleanupSessionIntelligenceRaw();
    if (result.deletedEvents) {
      console.log(`[SessionIntelligence] Cleanup removed ${result.deletedEvents} events`);
    }
  } catch (error) {
    console.warn('[SessionIntelligence] Cleanup failed:', error?.message || error);
  }
}, 15000);

// Sync every 15 minutes
setInterval(backgroundSync, 15 * 60 * 1000);

// Rapid Shopify sync every minute (configurable via SHOPIFY_SYNC_INTERVAL_MS)
setInterval(shopifyRealtimeSync, SHOPIFY_SYNC_INTERVAL);

// What-If sync every 24 hours
setInterval(whatifSync, 24 * 60 * 60 * 1000);

setInterval(() => {
  try {
    cleanupSessionIntelligenceRaw();
  } catch (error) {
    console.warn('[SessionIntelligence] Scheduled cleanup failed:', error?.message || error);
  }
}, 60 * 60 * 1000);

// Day-turn Meta sync (fast range) and daily exchange rate sync
scheduleGmt3DailyJob('Meta day-turn sync', dayTurnMetaSync);

setTimeout(syncDailyExchangeRate, 10000); // Run shortly after startup
scheduleGmt3DailyJob('daily exchange rate sync', syncDailyExchangeRate);

setTimeout(() => backfillMissingExchangeRates(60), 20000);

try {
  await ensureFaceModelsLoaded();
} catch (error) {
  console.error('❌ Face detection startup failed:', error.message);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
