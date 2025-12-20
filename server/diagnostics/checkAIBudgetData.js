/**
 * AI Budget Data Diagnostic
 * Run this to check why AI Budget shows no metrics
 * 
 * Usage: node server/diagnostics/checkAIBudgetData.js
 */

import { getDb } from '../db/database.js';

function diagnose() {
  console.log('🔍 AI BUDGET DATA DIAGNOSTIC\n');

  const db = getDb();

  // Check 1: meta_daily_metrics
  console.log('1️⃣ Checking meta_daily_metrics table...');
  const dailyCount = db.prepare(`SELECT COUNT(*) as count FROM meta_daily_metrics`).get();
  console.log(`   📊 Rows: ${dailyCount?.count || 0}`);
  
  if (dailyCount?.count > 0) {
    const sample = db.prepare(`SELECT * FROM meta_daily_metrics LIMIT 1`).get();
    console.log('   📄 Sample row:', JSON.stringify(sample, null, 2));
    
    const stores = db.prepare(`SELECT DISTINCT store FROM meta_daily_metrics`).all();
    console.log('   🏪 Stores:', stores.map(s => s.store).join(', '));

    // Check date range
    const dateRange = db.prepare(`
      SELECT MIN(date) as earliest, MAX(date) as latest 
      FROM meta_daily_metrics
    `).get();
    console.log(`   📅 Date range: ${dateRange.earliest} to ${dateRange.latest}`);

    // Check data with spend
    const withSpend = db.prepare(`
      SELECT COUNT(DISTINCT date) as days, SUM(spend) as total_spend 
      FROM meta_daily_metrics 
      WHERE spend > 0
    `).get();
    console.log(`   💰 Days with spend: ${withSpend.days}, Total spend: ${withSpend.total_spend?.toFixed(2) || 0}`);

    // Check data with revenue
    const withRevenue = db.prepare(`
      SELECT COUNT(DISTINCT date) as days, SUM(conversion_value) as total_revenue 
      FROM meta_daily_metrics 
      WHERE conversion_value > 0
    `).get();
    console.log(`   💵 Days with revenue: ${withRevenue.days}, Total revenue: ${withRevenue.total_revenue?.toFixed(2) || 0}`);
  }

  // Check 2: meta_adset_metrics
  console.log('\n2️⃣ Checking meta_adset_metrics table...');
  const adsetCount = db.prepare(`SELECT COUNT(*) as count FROM meta_adset_metrics`).get();
  console.log(`   📊 Rows: ${adsetCount?.count || 0}`);

  if (adsetCount?.count > 0) {
    const adsetStores = db.prepare(`SELECT DISTINCT store FROM meta_adset_metrics`).all();
    console.log('   🏪 Stores:', adsetStores.map(s => s.store).join(', '));
  }

  // Check 3: meta_ad_metrics
  console.log('\n3️⃣ Checking meta_ad_metrics table...');
  const adCount = db.prepare(`SELECT COUNT(*) as count FROM meta_ad_metrics`).get();
  console.log(`   📊 Rows: ${adCount?.count || 0}`);

  // Check 4: meta_objects (hierarchy)
  console.log('\n4️⃣ Checking meta_objects table...');
  const objCount = db.prepare(`SELECT COUNT(*) as count FROM meta_objects`).get();
  console.log(`   📊 Rows: ${objCount?.count || 0}`);
  
  if (objCount?.count > 0) {
    const types = db.prepare(`SELECT object_type, COUNT(*) as count FROM meta_objects GROUP BY object_type`).all();
    console.log('   📦 Object types:');
    types.forEach(t => console.log(`      ${t.object_type}: ${t.count}`));

    const statuses = db.prepare(`
      SELECT effective_status, COUNT(*) as count 
      FROM meta_objects 
      GROUP BY effective_status
    `).all();
    console.log('   📊 Status distribution:');
    statuses.forEach(s => console.log(`      ${s.effective_status || 'NULL'}: ${s.count}`));
  }

  // Check 5: Campaigns by store
  console.log('\n5️⃣ Checking campaigns by store...');
  const campaignsByStore = db.prepare(`
    SELECT store, COUNT(DISTINCT campaign_id) as campaigns, COUNT(DISTINCT date) as days
    FROM meta_daily_metrics
    GROUP BY store
  `).all();
  
  campaignsByStore.forEach(row => {
    console.log(`   🏪 ${row.store}: ${row.campaigns} campaigns, ${row.days} unique dates`);
  });

  // Check 6: Sample campaign names
  console.log('\n6️⃣ Sample campaign names:');
  const sampleCampaigns = db.prepare(`
    SELECT DISTINCT campaign_name, campaign_id 
    FROM meta_daily_metrics 
    LIMIT 5
  `).all();
  
  sampleCampaigns.forEach((c, i) => {
    console.log(`   ${i + 1}. "${c.campaign_name}" (ID: ${c.campaign_id})`);
  });

  // Check 7: Test aiBudgetService
  console.log('\n7️⃣ Testing aiBudgetService...');
  import('../services/aiBudgetService.js').then(async (module) => {
    const service = module.default;
    
    try {
      const result = await service.getData('vironax', { lookback: '30d' });
      console.log('   ✅ Service executed successfully');
      console.log(`      hierarchy.campaigns: ${result.hierarchy?.campaigns?.length || 0}`);
      console.log(`      hierarchy.adsets: ${result.hierarchy?.adsets?.length || 0}`);
      console.log(`      metrics.campaignDaily: ${result.metrics?.campaignDaily?.length || 0}`);
      console.log(`      totals.spend: ${result.totals?.spend?.toFixed(2) || 0}`);
    } catch (error) {
      console.log('   ❌ Error:', error.message);
    }

    console.log('\n✅ Diagnostic complete!');
    process.exit(0);
  }).catch(err => {
    console.log('   ❌ Service import error:', err.message);
    console.log('\n✅ Diagnostic complete!');
    process.exit(0);
  });
}

diagnose();
