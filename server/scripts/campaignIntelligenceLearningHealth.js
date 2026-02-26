import { initDb, getDb } from '../db/database.js';

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function runQuery(label, sql, args = []) {
  const db = getDb();
  const rows = db.prepare(sql).all(...args);
  console.log(`\n${label}`);
  console.table(rows);
}

function main() {
  initDb();
  const store = process.env.CI_HEALTH_STORE || null;

  printSection('Training Runs');
  runQuery(
    'Recent runs',
    `
      SELECT run_date, status, stores_scanned, scopes_scanned, models_scanned, versions_promoted, versions_rejected, started_at, finished_at
      FROM campaign_intelligence_training_runs
      ORDER BY id DESC
      LIMIT 10
    `
  );

  printSection('Version Activity');
  runQuery(
    'Active versions by model',
    `
      SELECT store, model_id, COUNT(*) AS active_count
      FROM campaign_intelligence_model_versions
      WHERE is_active = 1
      ${store ? 'AND store = ?' : ''}
      GROUP BY store, model_id
      ORDER BY store, model_id
    `,
    store ? [store] : []
  );

  printSection('Calibration Bins');
  runQuery(
    'Total calibration samples',
    `
      SELECT store, model_id, SUM(sample_count) AS total_samples
      FROM campaign_intelligence_model_calibration_bins
      ${store ? 'WHERE store = ?' : ''}
      GROUP BY store, model_id
      ORDER BY total_samples DESC
    `,
    store ? [store] : []
  );

  printSection('Uncertainty Trend (Last 14 days)');
  runQuery(
    'Average reliability/error by model',
    `
      SELECT store, model_id,
             ROUND(AVG(reliability), 4) AS avg_reliability,
             ROUND(AVG(calibration_error), 4) AS avg_calibration_error,
             COUNT(*) AS points
      FROM campaign_intelligence_model_uncertainty_history
      WHERE date >= date('now', '-14 day')
      ${store ? 'AND store = ?' : ''}
      GROUP BY store, model_id
      ORDER BY store, model_id
    `,
    store ? [store] : []
  );
}

main();
