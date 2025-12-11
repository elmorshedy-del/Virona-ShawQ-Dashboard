import express from 'express';
import cors from 'cors';
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
import { runWhatIfMigration } from './db/whatifMigration.js';
import { smartSync as whatifSmartSync } from './services/whatifMetaService.js';
import { syncMetaData } from './services/metaService.js';
import { syncShopifyOrders } from './services/shopifyService.js';
import { syncSallaOrders } from './services/sallaService.js';
import { cleanupOldNotifications } from './services/notificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize database
initDb();

// Run What-If migration (creates whatif_timeseries table if not exists)
runWhatIfMigration();

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

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api/analytics', analyticsRouter);
app.use('/api/manual', manualRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/budget-intelligence', budgetIntelligenceRouter);
app.use('/api/whatif', whatifRouter);
app.use('/api/aibudget', aibudgetRouter);

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

// Initial sync on startup
setTimeout(backgroundSync, 5000);

// Initial What-If sync (delayed 2 min to let main sync finish)
setTimeout(whatifSync, 2 * 60 * 1000);

// Sync every 15 minutes
setInterval(backgroundSync, 15 * 60 * 1000);

// What-If sync every 24 hours
setInterval(whatifSync, 24 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
