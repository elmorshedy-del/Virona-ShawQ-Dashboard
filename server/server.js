import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

import { initDb, getDb } from './db/database.js';
import analyticsRouter from './routes/analytics.js';
import manualRouter from './routes/manual.js';
import notificationsRouter from './routes/notifications.js';
import aiRouter from './routes/ai.js';
import budgetIntelligenceRouter from './routes/budgetIntelligence.js';
import whatifRouter from './routes/whatif.js';
import aibudgetRouter from './routes/aibudget.js';
import metaRouter from './routes/meta.js';
import exchangeRateRoutes from './routes/exchangeRate.js';
import creativeIntelligenceRouter from './routes/creativeIntelligence.js';
import creativeStudioRouter from './routes/creativeStudio.js';
import metaAuthRouter from './routes/metaAuth.js';
import testimonialExtractorRouter from './routes/testimonialExtractor.js';
import { ensureFaceModelsLoaded } from './services/testimonialExtractorService.js';
import { runWhatIfMigration } from './db/whatifMigration.js';
import { runCreativeIntelligenceMigration } from './db/creativeIntelligenceMigration.js';
import { runMigration as runCreativeStudioMigration } from './db/creativeStudioMigration.js';
import { runMigration as runAIBudgetMigration } from './db/aiBudgetMigration.js';
import { runMigration as runCompetitorSpyMigration } from './db/competitorSpyMigration.js';
import { smartSync as whatifSmartSync } from './services/whatifMetaService.js';
import { syncMetaData } from './services/metaService.js';
import { syncShopifyOrders } from './services/shopifyService.js';
import { syncSallaOrders } from './services/sallaService.js';
import { cleanupOldNotifications } from './services/notificationService.js';
import { scheduleCreativeFunnelSummaryJobs } from './services/creativeFunnelSummaryService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientPublic = path.join(__dirname, '../client/public');

const app = express();
const PORT = process.env.PORT || 3001;
const SHOPIFY_SYNC_INTERVAL = parseInt(process.env.SHOPIFY_SYNC_INTERVAL_MS || '60000', 10);

// Initialize database
initDb();

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
app.use(express.json({ limit: '10mb' }));

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
app.use('/api/meta', metaRouter);
app.use('/api/auth/meta', metaAuthRouter);
app.use('/api/exchange-rates', exchangeRateRoutes);
app.use('/api/creative-intelligence', creativeIntelligenceRouter);
app.use('/api/creative-studio', creativeStudioRouter);
app.use('/api/testimonials', testimonialExtractorRouter);

// Serve static files in production
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
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

// Daily exchange rate sync - fetch yesterday's final rate
async function syncDailyExchangeRate() {
  const OXR_APP_ID = process.env.OXR_APP_ID;
  if (!OXR_APP_ID) {
    console.log('[Exchange] No OXR_APP_ID configured, skipping daily rate sync');
    return;
  }

  const db = getDb();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  // Check if already have yesterday's rate
  const existing = db.prepare(`
    SELECT rate FROM exchange_rates
    WHERE from_currency = 'TRY' AND to_currency = 'USD' AND date = ?
  `).get(dateStr);

  if (existing) {
    console.log(`[Exchange] Already have rate for ${dateStr}: ${existing.rate.toFixed(6)}`);
    return;
  }

  // Fetch from OXR
  try {
    const url = `https://openexchangerates.org/api/historical/${dateStr}.json?app_id=${OXR_APP_ID}&symbols=TRY`;
    console.log(`[Exchange] Fetching daily rate for ${dateStr}...`);
    const res = await fetch(url);
    const data = await res.json();

    if (data.rates?.TRY) {
      const tryToUsd = 1 / data.rates.TRY;

      db.prepare(`
        INSERT OR REPLACE INTO exchange_rates (from_currency, to_currency, rate, date, source)
        VALUES ('TRY', 'USD', ?, ?, 'oxr')
      `).run(tryToUsd, dateStr);

      console.log(`[Exchange] Stored ${dateStr}: TRY→USD = ${tryToUsd.toFixed(6)}`);
    }
  } catch (err) {
    console.error(`[Exchange] Daily sync error: ${err.message}`);
  }
}

// Initial sync on startup
setTimeout(backgroundSync, 5000);

// Initial What-If sync (delayed 2 min to let main sync finish)
setTimeout(whatifSync, 2 * 60 * 1000);

// Sync every 15 minutes
setInterval(backgroundSync, 15 * 60 * 1000);

// Rapid Shopify sync every minute (configurable via SHOPIFY_SYNC_INTERVAL_MS)
setInterval(shopifyRealtimeSync, SHOPIFY_SYNC_INTERVAL);

// What-If sync every 24 hours
setInterval(whatifSync, 24 * 60 * 60 * 1000);

// Daily exchange rate sync - runs once per day at startup check + every 24 hours
// Fetches yesterday's final TRY→USD rate
setTimeout(syncDailyExchangeRate, 10000); // Run 10 seconds after startup
setInterval(syncDailyExchangeRate, 24 * 60 * 60 * 1000); // Then every 24 hours

try {
  await ensureFaceModelsLoaded();
} catch (error) {
  console.error('❌ Face detection startup failed:', error.message);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
