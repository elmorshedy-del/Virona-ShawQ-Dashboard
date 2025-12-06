// analyticsService-UPDATED.js
// Only the modified/new functions - replace these in your existing file

import { getCountryInfo, getAllCountries } from '../utils/countryData.js';
import { getDb } from '../db/database.js';
import { formatDateAsGmt3 } from '../utils/dateUtils.js';

// ============================================================================
// HELPER: Check if Salla is active (to mute Meta orders in country trends)
// ============================================================================

function isSallaActive() {
  const sallaToken = process.env.SALLA_ACCESS_TOKEN;
  const sallaMerchantId = process.env.SALLA_MERCHANT_ID;
  
  if (!sallaToken || !sallaMerchantId) {
    return false;
  }
  
  // Check if we have recent Salla sync data (within last 24 hours)
  const db = getDb();
  try {
    const recentSync = db.prepare(`
      SELECT COUNT(*) as count FROM salla_orders 
      WHERE store = 'vironax' 
      AND created_at > datetime('now', '-24 hours')
    `).get();
    
    return recentSync.count > 0;
  } catch (error) {
    console.warn('[Analytics] Error checking Salla active status:', error);
    return false;
  }
}

// ============================================================================
// FUNCTION 1: Get cities by country (NEW)
// ============================================================================

export function getCitiesByCountry(store, countryCode, params) {
  // Only for Shopify stores
  if (store !== 'shawq') {
    return [];
  }

  const db = getDb();
  const { startDate, endDate } = getDateRange(params);

  try {
    // Get all cities in a country from Shopify
    const citiesData = db.prepare(`
      SELECT 
        city,
        state,
        COUNT(*) as orders,
        SUM(subtotal) as revenue,
        COUNT(DISTINCT DATE(created_at)) as days_active
      FROM shopify_orders
      WHERE store = ? AND country_code = ? AND date BETWEEN ? AND ?
      AND city IS NOT NULL
      GROUP BY city, state
      ORDER BY orders DESC
    `).all(store, countryCode, startDate, endDate);

    // Rank cities and add medals (only for US)
    return citiesData.map((city, index) => ({
      ...city,
      city: city.city || 'Unknown',
      state: city.state || null,
      orders: city.orders || 0,
      revenue: city.revenue || 0,
      days_active: city.days_active || 0,
      rank: index + 1,
      medal: (countryCode === 'US' && index === 0) ? '🥇' 
           : (countryCode === 'US' && index === 1) ? '🥈'
           : (countryCode === 'US' && index === 2) ? '🥉'
           : null  // No medals for non-US or after 3rd
    }));
  } catch (error) {
    console.error(`[Analytics] Error getting cities for ${countryCode}:`, error);
    return [];
  }
}

// ============================================================================
// FUNCTION 2: Get country trends (UPDATED - NOW PROPERLY GROUPED)
// ============================================================================

export function getCountryTrends(store, params) {
  const db = getDb();
  const { startDate, endDate } = getDateRange(params);

  try {
    let rawData = [];

    if (store === 'shawq') {
      // SHAWQ: Get Shopify data only
      rawData = db.prepare(`
        SELECT 
          date, 
          country_code as countryCode,
          COUNT(*) as orders, 
          SUM(subtotal) as revenue
        FROM shopify_orders 
        WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL
        GROUP BY date, country_code
        ORDER BY date ASC, country_code ASC
      `).all(store, startDate, endDate);

      console.log(`[Analytics] Country trends for Shawq (Shopify): ${rawData.length} rows`);

    } else if (store === 'vironax') {
      // VIRONAX: Get Meta data, but check if Salla is active to mute Meta
      const sallaActive = isSallaActive();
      
      if (sallaActive) {
        // Salla is active: use Salla orders instead of Meta
        rawData = db.prepare(`
          SELECT 
            date, 
            country_code as countryCode,
            COUNT(*) as orders, 
            SUM(total_price) as revenue
          FROM salla_orders 
          WHERE store = ? AND date BETWEEN ? AND ? AND country_code IS NOT NULL
          GROUP BY date, country_code
          ORDER BY date ASC, country_code ASC
        `).all(store, startDate, endDate);

        console.log(`[Analytics] Country trends for Vironax (Salla active): ${rawData.length} rows`);
      } else {
        // Salla not active: use Meta data
        rawData = db.prepare(`
          SELECT 
            date, 
            country as countryCode,
            SUM(conversions) as orders, 
            SUM(conversion_value) as revenue
          FROM meta_daily_metrics 
          WHERE store = ? AND date BETWEEN ? AND ? AND country != 'ALL'
          GROUP BY date, country
          ORDER BY date ASC, country ASC
        `).all(store, startDate, endDate);

        console.log(`[Analytics] Country trends for Vironax (Meta): ${rawData.length} rows`);
      }
    } else {
      console.log(`[Analytics] Store ${store} not supported for country trends`);
      return [];
    }

    // Group by country and build structure
    const countriesMap = new Map();

    for (const row of rawData) {
      if (!countriesMap.has(row.countryCode)) {
        const countryInfo = getCountryInfo(row.countryCode);
        countriesMap.set(row.countryCode, {
          countryCode: row.countryCode,
          country: countryInfo?.name || row.countryCode,
          flag: countryInfo?.flag || '🏳️',
          totalOrders: 0,
          totalRevenue: 0,
          trends: []  // Daily breakdown for chart
        });
      }

      const countryData = countriesMap.get(row.countryCode);
      countryData.trends.push({
        date: row.date,
        orders: row.orders || 0,
        revenue: row.revenue || 0
      });
      countryData.totalOrders += row.orders || 0;
      countryData.totalRevenue += row.revenue || 0;
    }

    // Add cities data for each country (only for Shawq)
    if (store === 'shawq') {
      for (const countryData of countriesMap.values()) {
        countryData.cities = getCitiesByCountry(store, countryData.countryCode, params);
      }
    }

    // Sort by total orders descending
    const result = Array.from(countriesMap.values()).sort((a, b) => b.totalOrders - a.totalOrders);

    console.log(`[Analytics] Processed ${countriesMap.size} countries for trends`);

    return result;
  } catch (error) {
    console.error(`[Analytics] Error getting country trends for ${store}:`, error);
    return [];
  }
}

// ============================================================================
// EXISTING FUNCTIONS (Keep these as-is, but shown for reference)
// ============================================================================

// These are your existing functions - DO NOT MODIFY
// Just keep them as they are in your current analyticsService.js:
//
// - getDateRange(params)
// - getPreviousDateRange(startDate, endDate)
// - getTotalsForRange(db, store, startDate, endDate)
// - getDashboard(store, params)
// - getDynamicCountries(db, store, startDate, endDate)
// - getTrends(store, startDate, endDate)
// - generateDiagnostics(campaigns, overview)
// - getAvailableCountries(store)
// - getEfficiency(store, params)
// - getEfficiencyTrends(store, params)
// - getRecommendations(store, params)
// - getCampaignsByCountry(store, params)
// - getCampaignsByAge(store, params)
// - getCampaignsByGender(store, params)
// - getCampaignsByPlacement(store, params)
// - getCampaignsByAgeGender(store, params)
// - getShopifyTimeOfDay(store, params)
// - getMetaBreakdowns(store, params)

// ============================================================================
// NOTES FOR IMPLEMENTATION
// ============================================================================

/*
WHAT TO CHANGE IN YOUR EXISTING FILE:

1. Add this import at the top (if not already there):
   import { getCountryInfo } from '../utils/countryData.js';

2. Add the isSallaActive() function (new helper)

3. Replace the getCountryTrends() function completely with the new version

4. Add the new getCitiesByCountry() function

5. Keep everything else as-is

KEY BEHAVIOR:
- Shawq: Always uses Shopify data, includes cities with medals for USA
- Vironax: 
  - If Salla is active (tokens exist + recent orders): uses Salla data
  - If Salla not active: uses Meta data
  - No cities data (only Shopify stores get cities)

DATABASE REQUIREMENTS:
- shopify_orders must have: city, state, country_code, subtotal columns
- salla_orders must have: country_code, total_price columns
- meta_daily_metrics must have: country, conversions, conversion_value columns

MIGRATION IF NEEDED:
If your shopify_orders table doesn't have city/state:
  ALTER TABLE shopify_orders ADD COLUMN city TEXT;
  ALTER TABLE shopify_orders ADD COLUMN state TEXT;

Then re-import your Shopify data to populate these fields.
*/
