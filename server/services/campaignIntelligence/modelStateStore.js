import { getDb } from '../../db/database.js';
import { LEARNING_STATE_CONFIG } from './constants.js';

function safeParseJson(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function clampBinIndex(rawBinIndex) {
  const parsed = Number(rawBinIndex);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(LEARNING_STATE_CONFIG.calibrationBinCount - 1, Math.round(parsed)));
}

function toFinite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadModelStateBundle({ store, scopeKey }) {
  if (!store || !scopeKey) return null;
  const db = getDb();

  const priorsRows = db.prepare(`
    SELECT model_id, prior_json
    FROM campaign_intelligence_model_priors
    WHERE store = ? AND scope_key = ?
  `).all(store, scopeKey);

  const regimeRows = db.prepare(`
    SELECT model_id, regime_json
    FROM campaign_intelligence_model_regime_state
    WHERE store = ? AND scope_key = ?
  `).all(store, scopeKey);

  const calibrationRows = db.prepare(`
    SELECT model_id, bin_index, expected_confidence, observed_success_proxy, sample_count
    FROM campaign_intelligence_model_calibration_bins
    WHERE store = ? AND scope_key = ?
  `).all(store, scopeKey);

  const result = {
    priors: {},
    regime: {},
    calibrationBins: {}
  };

  for (const row of priorsRows) {
    const modelId = String(row?.model_id || '').trim();
    if (!modelId) continue;
    result.priors[modelId] = safeParseJson(row?.prior_json);
  }

  for (const row of regimeRows) {
    const modelId = String(row?.model_id || '').trim();
    if (!modelId) continue;
    result.regime[modelId] = safeParseJson(row?.regime_json);
  }

  for (const row of calibrationRows) {
    const modelId = String(row?.model_id || '').trim();
    if (!modelId) continue;
    if (!result.calibrationBins[modelId]) {
      result.calibrationBins[modelId] = [];
    }
    result.calibrationBins[modelId].push({
      binIndex: clampBinIndex(row?.bin_index),
      expectedConfidence: toFinite(row?.expected_confidence, 0),
      observedSuccessProxy: toFinite(row?.observed_success_proxy, 0),
      sampleCount: Math.max(0, Math.round(toFinite(row?.sample_count, 0)))
    });
  }

  return result;
}

export function saveModelStateBundle({
  store,
  scopeKey,
  generatedAt,
  modelBundle
}) {
  if (!store || !scopeKey || !modelBundle) return;
  const db = getDb();
  const now = generatedAt || new Date().toISOString();
  const date = String(now).slice(0, 10);

  const models = [
    modelBundle?.sentinel,
    modelBundle?.headroom,
    modelBundle?.launchJudge,
    modelBundle?.calibration
  ].filter(Boolean);
  const calibrationPerModel = Array.isArray(modelBundle?.calibration?.perModel)
    ? modelBundle.calibration.perModel
    : [];

  const upsertPrior = db.prepare(`
    INSERT INTO campaign_intelligence_model_priors (store, scope_key, model_id, prior_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(store, scope_key, model_id)
    DO UPDATE SET prior_json = excluded.prior_json, updated_at = excluded.updated_at
  `);

  const upsertRegime = db.prepare(`
    INSERT INTO campaign_intelligence_model_regime_state (store, scope_key, model_id, regime_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(store, scope_key, model_id)
    DO UPDATE SET regime_json = excluded.regime_json, updated_at = excluded.updated_at
  `);

  const upsertCalibrationBin = db.prepare(`
    INSERT INTO campaign_intelligence_model_calibration_bins (
      store, scope_key, model_id, bin_index, expected_confidence, observed_success_proxy, sample_count, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(store, scope_key, model_id, bin_index)
    DO UPDATE SET
      expected_confidence = ((campaign_intelligence_model_calibration_bins.expected_confidence * campaign_intelligence_model_calibration_bins.sample_count) + excluded.expected_confidence)
        / (campaign_intelligence_model_calibration_bins.sample_count + 1),
      observed_success_proxy = ((campaign_intelligence_model_calibration_bins.observed_success_proxy * campaign_intelligence_model_calibration_bins.sample_count) + excluded.observed_success_proxy)
        / (campaign_intelligence_model_calibration_bins.sample_count + 1),
      sample_count = campaign_intelligence_model_calibration_bins.sample_count + 1,
      updated_at = excluded.updated_at
  `);

  const insertUncertainty = db.prepare(`
    INSERT INTO campaign_intelligence_model_uncertainty_history (
      store, scope_key, model_id, date, reliability, calibration_error, uncertainty, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(store, scope_key, model_id, date)
    DO UPDATE SET
      reliability = excluded.reliability,
      calibration_error = excluded.calibration_error,
      uncertainty = excluded.uncertainty,
      confidence = excluded.confidence,
      created_at = excluded.created_at
  `);

  const transaction = db.transaction(() => {
    for (const model of models) {
      const modelId = String(model?.id || '').trim();
      if (!modelId) continue;

      const priorPayload = {
        confidence: toFinite(model?.confidence, 0),
        riskScore: toFinite(model?.riskScore, 0),
        headroomScore: toFinite(model?.headroomScore, 0),
        suggestedChangePct: toFinite(model?.suggestedChangePct, 0),
        reliability: toFinite(model?.reliability, 0),
        calibrationError: toFinite(model?.calibrationError, 0)
      };

      const regimePayload = {
        statusCode: model?.status?.code || null,
        statusLabel: model?.status?.label || null,
        decisionWindowDays: toFinite(model?.decisionWindowDays, 0),
        decisionWindowSource: model?.decisionWindowSource || null,
        recheckInDays: toFinite(model?.recheckInDays, 0),
        updatedAt: now
      };

      upsertPrior.run(store, scopeKey, modelId, JSON.stringify(priorPayload), now);
      upsertRegime.run(store, scopeKey, modelId, JSON.stringify(regimePayload), now);

      const confidence = toFinite(model?.confidence, 0);
      const reliability = toFinite(model?.reliability, confidence);
      const calibrationError = toFinite(
        model?.calibrationError,
        Math.max(0, 1 - reliability)
      );
      const observedSuccessProxy = Math.max(0, Math.min(1, 1 - calibrationError));
      const binIndex = clampBinIndex(Math.floor(confidence * LEARNING_STATE_CONFIG.calibrationBinCount));

      upsertCalibrationBin.run(
        store,
        scopeKey,
        modelId,
        binIndex,
        confidence,
        observedSuccessProxy,
        now
      );

      insertUncertainty.run(
        store,
        scopeKey,
        modelId,
        date,
        reliability,
        calibrationError,
        Math.max(0, Math.min(1, 1 - reliability)),
        confidence,
        now
      );
    }

    for (const entry of calibrationPerModel) {
      const modelId = String(entry?.modelId || '').trim();
      if (!modelId) continue;
      const confidence = toFinite(entry?.reliability, 0);
      const calibrationError = toFinite(entry?.calibrationError, Math.max(0, 1 - confidence));
      const observedSuccessProxy = Math.max(0, Math.min(1, 1 - calibrationError));
      const binIndex = clampBinIndex(Math.floor(confidence * LEARNING_STATE_CONFIG.calibrationBinCount));
      upsertCalibrationBin.run(
        store,
        scopeKey,
        modelId,
        binIndex,
        confidence,
        observedSuccessProxy,
        now
      );
      insertUncertainty.run(
        store,
        scopeKey,
        modelId,
        date,
        confidence,
        calibrationError,
        Math.max(0, Math.min(1, 1 - confidence)),
        confidence,
        now
      );
    }
  });

  transaction();
}
