/**
 * AI Budget Data Diagnostic
 * Run this to check why AI Budget shows no metrics
 */

import db from '../db/database.js';

async function diagnose() {
  console.log('🔍 AI BUDGET DATA DIAGNOSTIC\n');

  // Check 1: meta_daily_metrics
  console.log('1️⃣ Checking meta_daily_metrics table...');
  const dailyCount = await db.get(`SELECT COUNT(*) as count FROM meta_daily_metrics`);
  console.log(`   📊 Rows: ${dailyCount?.count || 0}`);
  
  if (dailyCount?.count > 0) {
    const sample = await db.get(`SELECT * FROM meta_daily_metrics LIMIT 1`);
    console.log('   📄 Sample row:', JSON.stringify(sample, null, 2));
    
    const stores = await db.all(`SELECT DISTINCT store FROM meta_daily_metrics`);
    console.log('   🏪 Stores:', stores.map(s => s.store).join(', '));
  }

  // Check 2: meta_adset_metrics
  console.log('\n2️⃣ Checking meta_adset_metrics table...');
  const adsetCount = await db.get(`SELECT COUNT(*) as count FROM meta_adset_metrics`);
  console.log(`   📊 Rows: ${adsetCount?.count || 0}`);

  // Check 3: meta_ad_metrics
  console.log('\n3️⃣ Checking meta_ad_metrics table...');
  const adCount = await db.get(`SELECT COUNT(*) as count FROM meta_ad_metrics`);
  console.log(`   📊 Rows: ${adCount?.count || 0}`);

  // Check 4: meta_objects (hierarchy)
  console.log('\n4️⃣ Checking meta_objects table...');
  const objCount = await db.get(`SELECT COUNT(*) as count FROM meta_objects`);
  console.log(`   📊 Rows: ${objCount?.count || 0}`);
  
  if (objCount?.count > 0) {
    const types = await db.all(`SELECT type, COUNT(*) as count FROM meta_objects GROUP BY type`);
    console.log('   📦 Object types:');
    types.forEach(t => console.log(`      ${t.type}: ${t.count}`));
  }

  // Check 5: Test metaDataset function
  console.log('\n5️⃣ Testing metaDataset.getAiBudgetMetaDataset()...');
  try {
    const { getAiBudgetMetaDataset } = await import('../features/aibudget/metaDataset.js');
    const result = await getAiBudgetMetaDataset('shawq', { days: 30 });
    
    console.log('   ✅ Function executed');
    console.log('   📊 Result structure:');
    console.log(`      hierarchy.campaigns: ${result.hierarchy?.campaigns?.length || 0}`);
    console.log(`      hierarchy.adsets: ${result.hierarchy?.adsets?.length || 0}`);
    console.log(`      hierarchy.ads: ${result.hierarchy?.ads?.length || 0}`);
    console.log(`      metrics.campaignDaily: ${result.metrics?.campaignDaily?.length || 0}`);
    console.log(`      metrics.adsetDaily: ${result.metrics?.adsetDaily?.length || 0}`);
    console.log(`      metrics.adDaily: ${result.metrics?.adDaily?.length || 0}`);
  } catch (error) {
    console.log('   ❌ Error:', error.message);
  }

  console.log('\n✅ Diagnostic complete!');
  process.exit(0);
}

diagnose().catch(err => {
  console.error('❌ Diagnostic failed:', err);
  process.exit(1);
});
