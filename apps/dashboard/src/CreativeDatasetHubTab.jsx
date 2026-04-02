import React, { useMemo, useState } from "react";
import { buildCreativeDataset, previewCreativeDataset } from "./api";
import { DATASET_GROUP_LABELS, WINDOW_TO_DAYS, fmtNumber } from "./creativeOpsShared";

const DEFAULT_GROUPS = [
  "identity_metadata",
  "performance_context",
  "visual_structural",
  "text_layer",
  "audio_layer",
  "strategic_labels",
];

const TARGET_OPTIONS = [
  { value: "log_blended_roas", label: "log blended ROAS" },
  { value: "blended_roas", label: "blended ROAS" },
  { value: "total_orders", label: "orders" },
  { value: "ctr", label: "CTR" },
  { value: "hook_rate", label: "hook rate" },
];

function groupFields(availableGroups, selectedGroups) {
  return selectedGroups.flatMap((group) => availableGroups[group] || []);
}

export default function CreativeDatasetHubTab({ tenantKey, storeKey }) {
  const [datasetName, setDatasetName] = useState("usa-creative-ml-v1");
  const [lookbackWindow, setLookbackWindow] = useState("90d");
  const [geo, setGeo] = useState("US");
  const [minSpendThreshold, setMinSpendThreshold] = useState(30);
  const [labeledOnly, setLabeledOnly] = useState(true);
  const [targetMetric, setTargetMetric] = useState("log_blended_roas");
  const [outputFormat, setOutputFormat] = useState("csv");
  const [featureGroups, setFeatureGroups] = useState(DEFAULT_GROUPS);
  const [selectedFields, setSelectedFields] = useState([]);
  const [preview, setPreview] = useState(null);
  const [buildResult, setBuildResult] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingBuild, setLoadingBuild] = useState(false);
  const [error, setError] = useState("");

  const lookbackDays = useMemo(() => WINDOW_TO_DAYS[lookbackWindow] || 90, [lookbackWindow]);
  const availableGroups = preview?.available_groups || {};
  const availableFields = useMemo(() => groupFields(availableGroups, featureGroups), [availableGroups, featureGroups]);

  function toggleGroup(groupId) {
    setFeatureGroups((current) => {
      if (current.includes(groupId)) {
        return current.filter((item) => item !== groupId);
      }
      return [...current, groupId];
    });
  }

  function toggleField(field) {
    setSelectedFields((current) => {
      if (current.includes(field)) {
        return current.filter((item) => item !== field);
      }
      return [...current, field];
    });
  }

  async function onPreview() {
    setLoadingPreview(true);
    setError("");
    setBuildResult(null);
    try {
      const payload = await previewCreativeDataset({
        tenantKey,
        storeKey,
        lookbackDays,
        lookbackWindow,
        geo,
        minSpendThreshold,
        labeledOnly,
        featureGroups,
        selectedFields,
        targetMetric,
      });
      setPreview(payload);
      if (!selectedFields.length) {
        setSelectedFields(payload.selected_fields || []);
      }
    } catch (err) {
      setError(err.message || "Dataset preview failed");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function onBuild() {
    setLoadingBuild(true);
    setError("");
    try {
      const payload = await buildCreativeDataset({
        tenantKey,
        storeKey,
        datasetName,
        lookbackDays,
        lookbackWindow,
        geo,
        minSpendThreshold,
        labeledOnly,
        featureGroups,
        selectedFields,
        targetMetric,
        outputFormat,
      });
      setBuildResult(payload);
    } catch (err) {
      setError(err.message || "Dataset build failed");
    } finally {
      setLoadingBuild(false);
    }
  }

  return (
    <>
      <section className="panel ops-toolbar">
        <div className="ops-toolbar-row">
          <input value={datasetName} onChange={(event) => setDatasetName(event.target.value)} placeholder="Dataset name" />
          <select value={lookbackWindow} onChange={(event) => setLookbackWindow(event.target.value)}>
            <option value="30d">Last 30 days</option>
            <option value="60d">Last 60 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all_time">All time</option>
          </select>
          <select value={targetMetric} onChange={(event) => setTargetMetric(event.target.value)}>
            {TARGET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button type="button" className="button-secondary" onClick={onPreview} disabled={loadingPreview}>
            {loadingPreview ? "Previewing..." : "Preview Dataset"}
          </button>
          <button type="button" onClick={onBuild} disabled={loadingBuild}>
            {loadingBuild ? "Building..." : "Build Dataset"}
          </button>
        </div>
        <div className="ops-toolbar-meta">
          <span className="chip">{lookbackWindow}</span>
          <span className="chip">{geo}</span>
          <span className="chip">{targetMetric}</span>
          {preview ? <span className="chip good">{fmtNumber(preview.row_count, 0)} rows</span> : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="ops-layout">
        <article className="panel ops-sidebar">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recipe</p>
              <h3>Dataset controls</h3>
            </div>
          </div>
          <div className="stack">
            <div className="item">
              <div>
                <strong>Geo</strong>
                <p>Choose the market slice for this dataset.</p>
              </div>
              <input value={geo} onChange={(event) => setGeo(event.target.value.toUpperCase())} style={{ maxWidth: 96 }} />
            </div>
            <div className="item">
              <div>
                <strong>Spend floor</strong>
                <p>De-rank thin rows before export.</p>
              </div>
              <input
                type="number"
                min="0"
                step="10"
                value={minSpendThreshold}
                onChange={(event) => setMinSpendThreshold(Number(event.target.value || 0))}
                style={{ maxWidth: 120 }}
              />
            </div>
            <div className="item">
              <div>
                <strong>Labeled only</strong>
                <p>Exclude rows that do not have a stored creative label record.</p>
              </div>
              <input type="checkbox" checked={labeledOnly} onChange={(event) => setLabeledOnly(event.target.checked)} />
            </div>
            <div className="item">
              <div>
                <strong>Output format</strong>
                <p>Build as CSV for CatBoost/XGBoost or JSON for audits.</p>
              </div>
              <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)}>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>

            <div className="section-heading">
              <div>
                <p className="eyebrow">Feature Groups</p>
                <h3>What to include</h3>
              </div>
            </div>
              <div className="chips">
                {Object.entries(DATASET_GROUP_LABELS).map(([groupId, label]) => (
                  <button
                    key={groupId}
                    type="button"
                    onClick={() => toggleGroup(groupId)}
                    className={featureGroups.includes(groupId) ? "chip good chip-button" : "chip chip-button"}
                  >
                    {label}
                  </button>
                ))}
              </div>

            {preview ? (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Fields</p>
                    <h3>Exact dataset columns</h3>
                  </div>
                </div>
                <div className="chips">
                  {availableFields.map((field) => (
                    <button
                      key={field}
                      type="button"
                      onClick={() => toggleField(field)}
                      className={selectedFields.includes(field) ? "chip good chip-button" : "chip chip-button"}
                    >
                      {field}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </article>

        <article className="panel ops-detail">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Preview</p>
              <h3>{preview ? "Dataset summary" : "Preview required"}</h3>
            </div>
          </div>

          {preview ? (
            <div className="stack">
              <div className="metrics compact-metrics">
                {[
                  { label: "Rows", value: fmtNumber(preview.row_count, 0) },
                  { label: "Target Ready", value: fmtNumber(preview.target_non_null_count, 0) },
                  { label: "Fields", value: fmtNumber(preview.selected_fields?.length || 0, 0) },
                ].map((item) => (
                  <article key={item.label}>
                    <h2>{item.value}</h2>
                    <p>{item.label}</p>
                  </article>
                ))}
              </div>

              <div className="item">
                <div>
                  <strong>Dataset shape</strong>
                  <p>
                    {preview.geo} · {preview.lookback_window} · target {preview.target_metric}
                  </p>
                  <p className="muted">
                    {preview.labeled_only ? "Labeled only" : "Includes unlabeled"} · spend floor {preview.min_spend_threshold}
                  </p>
                </div>
              </div>

              <div className="section-heading">
                <div>
                  <p className="eyebrow">Missingness</p>
                  <h3>Field health</h3>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(preview.missing_counts || {}).map(([field, count]) => (
                      <tr key={field}>
                        <td>{field}</td>
                        <td>{fmtNumber(count, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="section-heading">
                <div>
                  <p className="eyebrow">Sample Rows</p>
                  <h3>Training-table preview</h3>
                </div>
              </div>
              <pre className="json-block">{JSON.stringify(preview.sample_rows || [], null, 2)}</pre>
            </div>
          ) : (
            <p className="body-copy muted">Preview the dataset recipe to inspect row count, missingness, and sample rows.</p>
          )}

          {buildResult ? (
            <div className="stack" style={{ marginTop: 16 }}>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Build Output</p>
                  <h3>{buildResult.dataset_name}</h3>
                </div>
              </div>
              <div className="item">
                <div>
                  <strong>Data file</strong>
                  <p className="muted">{buildResult.data_path}</p>
                </div>
              </div>
              <div className="item">
                <div>
                  <strong>Recipe file</strong>
                  <p className="muted">{buildResult.recipe_path}</p>
                </div>
              </div>
            </div>
          ) : null}
        </article>
      </section>
    </>
  );
}
