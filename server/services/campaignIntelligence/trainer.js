import { getDb } from '../../db/database.js';

const TRAINER_WINDOW_DAYS = Object.freeze({
  recent: 14,
  prior: 14
});

const CALIBRATION_DEGRADE_TOLERANCE = 0.03;
const MIN_UNCERTAINTY_POINTS_FOR_PROMOTION = 5;
const TRAINER_MODEL_IDS = Object.freeze([
  'mature_sentinel',
  'headroom_model',
  'launch_judge',
  'calibration_layer'
]);

function toFinite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mean(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + toFinite(value, 0), 0) / values.length;
}

function chunkRecentAndPrior(rows) {
  const sorted = [...rows].sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
  const recent = sorted.slice(0, TRAINER_WINDOW_DAYS.recent);
  const prior = sorted.slice(TRAINER_WINDOW_DAYS.recent, TRAINER_WINDOW_DAYS.recent + TRAINER_WINDOW_DAYS.prior);
  return { recent, prior };
}

function summarizeUncertaintyRows(rows = []) {
  return {
    points: rows.length,
    reliabilityMean: mean(rows.map((row) => row.reliability)),
    calibrationErrorMean: mean(rows.map((row) => row.calibration_error)),
    confidenceMean: mean(rows.map((row) => row.confidence))
  };
}

function buildTrainerMetrics({ recentSummary, priorSummary }) {
  const calibrationDelta = recentSummary.calibrationErrorMean - priorSummary.calibrationErrorMean;
  const reliabilityDelta = recentSummary.reliabilityMean - priorSummary.reliabilityMean;

  return {
    recentPoints: recentSummary.points,
    priorPoints: priorSummary.points,
    recentCalibrationError: recentSummary.calibrationErrorMean,
    priorCalibrationError: priorSummary.calibrationErrorMean,
    recentReliability: recentSummary.reliabilityMean,
    priorReliability: priorSummary.reliabilityMean,
    recentConfidence: recentSummary.confidenceMean,
    priorConfidence: priorSummary.confidenceMean,
    calibrationDelta,
    reliabilityDelta
  };
}

function shouldPromoteVersion(metrics) {
  if (!metrics) return false;
  if (metrics.recentPoints < MIN_UNCERTAINTY_POINTS_FOR_PROMOTION) return false;
  if (metrics.priorPoints > 0 && metrics.calibrationDelta > CALIBRATION_DEGRADE_TOLERANCE) return false;
  return true;
}

function getMaxModelVersion(db, { store, scopeKey, modelId }) {
  const row = db.prepare(`
    SELECT MAX(model_version) AS max_version
    FROM campaign_intelligence_model_versions
    WHERE store = ? AND scope_key = ? AND model_id = ?
  `).get(store, scopeKey, modelId);
  return Math.max(0, Math.round(toFinite(row?.max_version, 0)));
}

function getActiveVersion(db, { store, scopeKey, modelId }) {
  return db.prepare(`
    SELECT id, model_version
    FROM campaign_intelligence_model_versions
    WHERE store = ? AND scope_key = ? AND model_id = ? AND is_active = 1
    ORDER BY model_version DESC
    LIMIT 1
  `).get(store, scopeKey, modelId);
}

function loadModelArtifact(db, { store, scopeKey, modelId }) {
  const priorRow = db.prepare(`
    SELECT prior_json
    FROM campaign_intelligence_model_priors
    WHERE store = ? AND scope_key = ? AND model_id = ?
    LIMIT 1
  `).get(store, scopeKey, modelId);

  const regimeRow = db.prepare(`
    SELECT regime_json
    FROM campaign_intelligence_model_regime_state
    WHERE store = ? AND scope_key = ? AND model_id = ?
    LIMIT 1
  `).get(store, scopeKey, modelId);

  const calibrationRows = db.prepare(`
    SELECT bin_index, expected_confidence, observed_success_proxy, sample_count
    FROM campaign_intelligence_model_calibration_bins
    WHERE store = ? AND scope_key = ? AND model_id = ?
    ORDER BY bin_index ASC
  `).all(store, scopeKey, modelId);

  return {
    prior: priorRow?.prior_json ? JSON.parse(priorRow.prior_json) : null,
    regime: regimeRow?.regime_json ? JSON.parse(regimeRow.regime_json) : null,
    calibrationBins: calibrationRows.map((row) => ({
      binIndex: Math.round(toFinite(row?.bin_index, 0)),
      expectedConfidence: toFinite(row?.expected_confidence, 0),
      observedSuccessProxy: toFinite(row?.observed_success_proxy, 0),
      sampleCount: Math.max(0, Math.round(toFinite(row?.sample_count, 0)))
    }))
  };
}

function loadUncertaintyHistory(db, { store, scopeKey, modelId }) {
  return db.prepare(`
    SELECT date, reliability, calibration_error, confidence
    FROM campaign_intelligence_model_uncertainty_history
    WHERE store = ? AND scope_key = ? AND model_id = ?
    ORDER BY date DESC
    LIMIT ?
  `).all(store, scopeKey, modelId, TRAINER_WINDOW_DAYS.recent + TRAINER_WINDOW_DAYS.prior);
}

function loadScopeRows(db, storeFilter = null) {
  const baseSql = `
    SELECT DISTINCT store, scope_key
    FROM campaign_intelligence_model_priors
    ${storeFilter ? 'WHERE store = ?' : ''}
    ORDER BY store ASC, scope_key ASC
  `;
  return storeFilter
    ? db.prepare(baseSql).all(storeFilter)
    : db.prepare(baseSql).all();
}

export async function runCampaignIntelligenceDailyTrainer({ store = null, runDate = null } = {}) {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const effectiveRunDate = runDate || startedAt.slice(0, 10);

  const runInsert = db.prepare(`
    INSERT INTO campaign_intelligence_training_runs (
      run_date, started_at, status
    ) VALUES (?, ?, 'running')
  `);
  const runResult = runInsert.run(effectiveRunDate, startedAt);
  const runId = runResult.lastInsertRowid;

  let storesScanned = 0;
  let scopesScanned = 0;
  let modelsScanned = 0;
  let versionsPromoted = 0;
  let versionsRejected = 0;
  const summary = [];

  try {
    const scopeRows = loadScopeRows(db, store);
    const uniqueStores = new Set(scopeRows.map((row) => row.store));
    storesScanned = uniqueStores.size;
    scopesScanned = scopeRows.length;

    const transaction = db.transaction((rows) => {
      for (const scopeRow of rows) {
        const storeName = String(scopeRow?.store || '').trim();
        const scopeKey = String(scopeRow?.scope_key || '').trim();
        if (!storeName || !scopeKey) continue;

        for (const modelId of TRAINER_MODEL_IDS) {
          modelsScanned += 1;
          const uncertaintyRows = loadUncertaintyHistory(db, { store: storeName, scopeKey, modelId });
          const { recent, prior } = chunkRecentAndPrior(uncertaintyRows);
          const recentSummary = summarizeUncertaintyRows(recent);
          const priorSummary = summarizeUncertaintyRows(prior);
          const metrics = buildTrainerMetrics({ recentSummary, priorSummary });
          const promoted = shouldPromoteVersion(metrics);

          const artifact = loadModelArtifact(db, { store: storeName, scopeKey, modelId });
          const activeVersion = getActiveVersion(db, { store: storeName, scopeKey, modelId });
          const nextVersion = getMaxModelVersion(db, { store: storeName, scopeKey, modelId }) + 1;
          const trainedAt = new Date().toISOString();

          db.prepare(`
            INSERT INTO campaign_intelligence_model_versions (
              store, scope_key, model_id, model_version, status, is_active, trained_at, artifact_json, metrics_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            storeName,
            scopeKey,
            modelId,
            nextVersion,
            promoted ? 'promoted' : 'rejected',
            promoted ? 1 : 0,
            trainedAt,
            JSON.stringify(artifact),
            JSON.stringify(metrics)
          );

          if (promoted) {
            versionsPromoted += 1;
            db.prepare(`
              UPDATE campaign_intelligence_model_versions
              SET is_active = 0
              WHERE store = ? AND scope_key = ? AND model_id = ? AND model_version <> ?
            `).run(storeName, scopeKey, modelId, nextVersion);
          } else {
            versionsRejected += 1;
            if (activeVersion) {
              db.prepare(`
                UPDATE campaign_intelligence_model_versions
                SET is_active = 0
                WHERE store = ? AND scope_key = ? AND model_id = ? AND model_version = ?
              `).run(storeName, scopeKey, modelId, nextVersion);
            }
          }

          summary.push({
            store: storeName,
            scopeKey,
            modelId,
            version: nextVersion,
            decision: promoted ? 'promoted' : 'rejected',
            metrics
          });
        }
      }
    });

    transaction(scopeRows);

    const finishedAt = new Date().toISOString();
    db.prepare(`
      UPDATE campaign_intelligence_training_runs
      SET
        finished_at = ?,
        status = 'success',
        stores_scanned = ?,
        scopes_scanned = ?,
        models_scanned = ?,
        versions_promoted = ?,
        versions_rejected = ?,
        summary_json = ?
      WHERE id = ?
    `).run(
      finishedAt,
      storesScanned,
      scopesScanned,
      modelsScanned,
      versionsPromoted,
      versionsRejected,
      JSON.stringify(summary),
      runId
    );

    return {
      runId,
      runDate: effectiveRunDate,
      storesScanned,
      scopesScanned,
      modelsScanned,
      versionsPromoted,
      versionsRejected
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    db.prepare(`
      UPDATE campaign_intelligence_training_runs
      SET
        finished_at = ?,
        status = 'failed',
        stores_scanned = ?,
        scopes_scanned = ?,
        models_scanned = ?,
        versions_promoted = ?,
        versions_rejected = ?,
        summary_json = ?,
        error_message = ?
      WHERE id = ?
    `).run(
      finishedAt,
      storesScanned,
      scopesScanned,
      modelsScanned,
      versionsPromoted,
      versionsRejected,
      JSON.stringify(summary),
      String(error?.message || error),
      runId
    );
    throw error;
  }
}
