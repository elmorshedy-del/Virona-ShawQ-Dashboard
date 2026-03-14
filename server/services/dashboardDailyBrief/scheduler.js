import {
  generateDashboardDailyBrief,
  listDashboardDailyBriefStores
} from './service.js';
import { DASHBOARD_DAILY_BRIEF_SOURCE } from './constants.js';

export async function runDashboardDailyBriefs() {
  const stores = listDashboardDailyBriefStores();
  const results = [];

  for (const store of stores) {
    try {
      const brief = await generateDashboardDailyBrief({
        store,
        force: false,
        source: DASHBOARD_DAILY_BRIEF_SOURCE.daily
      });
      results.push({ store, success: true, briefDate: brief?.briefDate || null });
    } catch (error) {
      console.warn(`[Dashboard Daily Brief] Failed for ${store}:`, error?.message || error);
      results.push({ store, success: false, error: error?.message || 'Unknown error' });
    }
  }

  return {
    ranAt: new Date().toISOString(),
    storesScanned: stores.length,
    generated: results.filter((row) => row.success).length,
    failed: results.filter((row) => !row.success).length,
    results
  };
}
