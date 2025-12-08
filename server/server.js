import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

import { initDb } from './db/database.js';
import { syncMetaData } from './services/metaService.js';
import { syncSallaOrders } from './services/sallaService.js';
import { syncShopifyOrders } from './services/shopifyService.js';
import analyticsRoutes from './routes/analytics.js';
import manualRoutes from './routes/manual.js';
import notificationsRoutes from './routes/notifications.js';
import budgetIntelligenceRoutes from './routes/budgetIntelligence.js';
import aiRoutes from './routes/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

// Initialize database
initDb();

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/analytics', analyticsRoutes);
app.use('/api/manual', manualRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/budget-intelligence', budgetIntelligenceRoutes);
app.use('/api/ai', aiRoutes);

// List available stores
app.get('/api/stores', (req, res) => {
  res.json([
    { id: 'vironax', name: 'VironaX', tagline: "Men's Jewelry", ecommerce: 'Salla', currency: 'SAR' },
    { id: 'shawq', name: 'Shawq', tagline: 'Palestinian & Syrian Apparel', ecommerce: 'Shopify', currency: 'USD' }
  ]);
});

// Sync endpoint
app.post('/api/sync', async (req, res) => {
  const store = req.query.store;
  
  try {
    if (store) {
      // Sync specific store
      await syncStore(store);
      res.json({ success: true, message: `Synced ${store}` });
    } else {
      // Sync all stores
      await syncAllStores();
      res.json({ success: true, message: 'All stores synced' });
    }
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync functions
async function syncStore(store) {
  console.log(`Syncing ${store}...`);
  
  try {
    // Sync Meta data
    const metaResult = await syncMetaData(store);
    console.log(`✅ Synced ${metaResult.records} Meta records for ${store}`);
  } catch (error) {
    console.error(`Meta sync error for ${store}:`, error.message);
  }
  
  // Sync e-commerce based on store
  try {
    if (store === 'vironax') {
      const sallaResult = await syncSallaOrders();
      console.log(`✅ Synced ${sallaResult.records} Salla orders for VironaX`);
    } else if (store === 'shawq') {
      const shopifyResult = await syncShopifyOrders();
      console.log(`✅ Synced ${shopifyResult.records} Shopify orders for Shawq`);
    }
  } catch (error) {
    console.error(`E-commerce sync error for ${store}:`, error.message);
  }
}

async function syncAllStores() {
  console.log('Starting sync for all stores...');
  await syncStore('vironax');
  await syncStore('shawq');
  console.log('All stores synced');
}

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Stores: VironaX (Salla) | Shawq (Shopify)');
  
  // Initial sync after 5 seconds
  setTimeout(async () => {
    console.log('Running initial sync...');
    await syncAllStores();
  }, 5000);
});

// Sync every 15 minutes for fresh Meta data
cron.schedule('*/15 * * * *', async () => {
  console.log('Running 15-minute sync...');
  await syncAllStores();
});
