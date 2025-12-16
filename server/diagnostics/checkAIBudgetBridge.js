/**
 * Diagnostic script to verify the MetaAIBudgetBridge functionality
 *
 * Run with: node server/diagnostics/checkAIBudgetBridge.js
 */

import metaAIBudgetBridge from '../services/metaAIBudgetBridge.js';

async function runDiagnostics() {
  console.log('='.repeat(60));
  console.log('  META → AIBUDGET BRIDGE DIAGNOSTIC');
  console.log('='.repeat(60));

  const stores = ['shawq', 'vironax'];

  for (const store of stores) {
    console.log(`\n--- Testing store: ${store} ---\n`);

    try {
      // Get standardized data with hierarchy
      const result = await metaAIBudgetBridge.getStandardizedData(store, {});

      console.log('Date Range:');
      console.log(`  Available: ${result.dateRange?.availableStart} to ${result.dateRange?.availableEnd}`);
      console.log(`  Effective: ${result.dateRange?.effectiveStart} to ${result.dateRange?.effectiveEnd}`);

      console.log('\nHierarchy Tree:');
      if (result.hierarchy?.campaigns) {
        const campaignIds = Object.keys(result.hierarchy.campaigns);
        console.log(`  Campaigns: ${campaignIds.length}`);

        let totalAdsets = 0;
        let totalAds = 0;
        for (const cid of campaignIds) {
          const campaign = result.hierarchy.campaigns[cid];
          const adsetIds = Object.keys(campaign.adsets || {});
          totalAdsets += adsetIds.length;
          for (const asid of adsetIds) {
            totalAds += Object.keys(campaign.adsets[asid].ads || {}).length;
          }
        }
        console.log(`  AdSets: ${totalAdsets}`);
        console.log(`  Ads: ${totalAds}`);
      } else {
        console.log('  No hierarchy data');
      }

      console.log('\nStandardized Rows:');
      console.log(`  Total: ${result.rows.length}`);
      console.log(`  Campaign level: ${result.rows.filter(r => r.level === 'campaign').length}`);
      console.log(`  AdSet level: ${result.rows.filter(r => r.level === 'adset').length}`);
      console.log(`  Ad level: ${result.rows.filter(r => r.level === 'ad').length}`);

      if (result.rows.length > 0) {
        console.log('\nSample Row (first):');
        const sample = result.rows[0];
        console.log(`  Date: ${sample.date}`);
        console.log(`  Geo: ${sample.geo}`);
        console.log(`  Level: ${sample.level}`);
        console.log(`  Campaign: ${sample.campaign_name} (${sample.campaign_id})`);
        console.log(`  Spend: ${sample.spend}`);
        console.log(`  Purchases: ${sample.purchases}`);
        console.log(`  Purchase Value: ${sample.purchase_value}`);
        console.log(`  Impressions: ${sample.impressions}`);
        console.log(`  Clicks: ${sample.clicks}`);
        console.log(`  ATC: ${sample.atc}`);
        console.log(`  IC: ${sample.ic}`);
        console.log(`  Status: ${sample.status}`);
        console.log(`  Effective Status: ${sample.effective_status}`);

        // Verify all expected fields are present
        const expectedFields = [
          'date', 'geo', 'spend', 'purchases', 'purchase_value',
          'impressions', 'clicks', 'reach', 'atc', 'ic',
          'frequency', 'ctr', 'cpc', 'cpm',
          'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
          'ad_id', 'ad_name', 'status', 'effective_status',
          'budget', 'brand', 'store', 'level'
        ];

        const missingFields = expectedFields.filter(f => !(f in sample));
        if (missingFields.length > 0) {
          console.log(`\n  MISSING FIELDS: ${missingFields.join(', ')}`);
        } else {
          console.log('\n  All expected fields present');
        }

        // Calculate totals
        const totals = result.rows.reduce((acc, row) => {
          acc.spend += row.spend || 0;
          acc.purchases += row.purchases || 0;
          acc.purchase_value += row.purchase_value || 0;
          return acc;
        }, { spend: 0, purchases: 0, purchase_value: 0 });

        console.log('\nAggregated Totals:');
        console.log(`  Total Spend: $${totals.spend.toFixed(2)}`);
        console.log(`  Total Purchases: ${totals.purchases}`);
        console.log(`  Total Revenue: $${totals.purchase_value.toFixed(2)}`);
      }

    } catch (error) {
      console.error(`Error testing ${store}:`, error.message);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  DIAGNOSTIC COMPLETE');
  console.log('='.repeat(60));

  process.exit(0);
}

runDiagnostics();
