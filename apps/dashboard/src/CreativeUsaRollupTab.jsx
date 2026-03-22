import React, { useEffect, useMemo, useState } from "react";
import {
  analyzeSignalStackAudio,
  embedSiglip,
  fetchCreativeUsaRollup,
  fetchCreativeUsaRollupDetail,
  materializeCreativeUsaRollup,
} from "./api";

function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${fmtNumber(value, 2)}%`;
}

function metricCards(items) {
  if (!items.length) {
    return [
      { label: "Creatives", value: 0 },
      { label: "Median Spend", value: "-" },
      { label: "Median ROAS", value: "-" },
      { label: "Median Orders", value: "-" },
      { label: "Median CTR", value: "-" },
      { label: "Median Hook Rate", value: "-" },
    ];
  }
  const median = (values) => {
    const clean = values.filter((value) => value !== null && value !== undefined).sort((a, b) => a - b);
    if (!clean.length) return null;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 === 0 ? (clean[mid - 1] + clean[mid]) / 2 : clean[mid];
  };
  return [
    { label: "Creatives", value: items.length },
    { label: "Median Spend", value: fmtNumber(median(items.map((item) => item.median_spend)), 2) },
    { label: "Median ROAS", value: fmtNumber(median(items.map((item) => item.median_roas)), 2) },
    { label: "Median Orders", value: fmtNumber(median(items.map((item) => item.median_orders)), 1) },
    { label: "Median CTR", value: fmtPercent(median(items.map((item) => item.median_ctr))) },
    { label: "Median Hook Rate", value: fmtPercent(median(items.map((item) => item.median_hook_rate))) },
  ];
}

export default function CreativeUsaRollupTab({ tenantKey, storeKey }) {
  const metricKeys = useMemo(() => ["spend", "roas", "orders", "ctr", "hook_rate"], []);
  const [lookbackDays, setLookbackDays] = useState(60);
  const [rowLimit, setRowLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [siglipLoading, setSiglipLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [audioStack, setAudioStack] = useState(null);
  const [siglip, setSiglip] = useState(null);

  async function loadRollup({ selectFirst = false } = {}) {
    if (!storeKey) return;
    setLoading(true);
    setError("");
    try {
      const payload = await fetchCreativeUsaRollup({
        tenantKey,
        storeKey,
        lookbackDays,
        limit: rowLimit,
        metricKeys,
      });
      const nextItems = payload.items || [];
      setItems(nextItems);
      if (selectFirst && nextItems[0]?.rollup_id) {
        setSelectedId(nextItems[0].rollup_id);
      } else if (!nextItems.some((item) => item.rollup_id === selectedId)) {
        setSelectedId(nextItems[0]?.rollup_id || "");
      }
    } catch (err) {
      setError(err.message || "Failed to load USA rollup");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRollup({ selectFirst: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey, storeKey, lookbackDays, rowLimit, metricKeys]);

  useEffect(() => {
    async function loadDetail() {
      if (!storeKey || !selectedId) {
        setDetail(null);
        return;
      }
      setLoadingDetail(true);
      setAudioStack(null);
      setSiglip(null);
      try {
        const payload = await fetchCreativeUsaRollupDetail({
          tenantKey,
          storeKey,
          rollupId: selectedId,
          metricKeys,
        });
        setDetail(payload);
      } catch (err) {
        setError(err.message || "Failed to load creative detail");
      } finally {
        setLoadingDetail(false);
      }
    }
    void loadDetail();
  }, [selectedId, tenantKey, storeKey, metricKeys]);

  const cards = useMemo(() => metricCards(items), [items]);
  const activeVisualUrl = detail?.preview_url || detail?.thumbnail_url || "";
  const audioMediaUrl = useMemo(() => {
    const candidate = String(detail?.preview_url || "").trim();
    if (!candidate) return "";
    return /\.(mp4|mov|m4v|webm|mp3|wav|m4a)(\?.*)?$/i.test(candidate) ? candidate : "";
  }, [detail?.preview_url]);

  async function onMaterialize() {
    if (!storeKey) return;
    setMaterializing(true);
    setError("");
    try {
      await materializeCreativeUsaRollup({ tenantKey, storeKey, lookbackDays, metricKeys });
      await loadRollup({ selectFirst: true });
    } catch (err) {
      setError(err.message || "USA rollup materialization failed");
    } finally {
      setMaterializing(false);
    }
  }

  async function onRunAudioStack() {
    if (!audioMediaUrl) return;
    setAudioLoading(true);
    setError("");
    try {
      const payload = await analyzeSignalStackAudio({ videoUrl: audioMediaUrl });
      setAudioStack(payload);
    } catch (err) {
      setError(err.message || "Audio stack analysis failed");
    } finally {
      setAudioLoading(false);
    }
  }

  async function onRunSiglip() {
    if (!activeVisualUrl) return;
    setSiglipLoading(true);
    setError("");
    try {
      const payload = await embedSiglip({ imageUrl: activeVisualUrl });
      setSiglip(payload);
    } catch (err) {
      setError(err.message || "SigLIP embedding failed");
    } finally {
      setSiglipLoading(false);
    }
  }

  return (
    <>
      <section className="panel hero">
        <div>
          <p className="eyebrow">USA Rollup</p>
          <h1>Canonical Creative Comparison</h1>
          <p>
            Merge duplicate USA usages into one creative view and compare by spend, ROAS, orders,
            CTR, and 3-second hook rate before the full scoring stack is finalized.
          </p>
        </div>
        <div className="form">
          <select value={lookbackDays} onChange={(event) => setLookbackDays(Number(event.target.value))}>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <select value={rowLimit} onChange={(event) => setRowLimit(Number(event.target.value))}>
            <option value={50}>50 creatives</option>
            <option value={100}>100 creatives</option>
            <option value={200}>200 creatives</option>
          </select>
          <button type="button" onClick={onMaterialize} disabled={materializing || !storeKey}>
            {materializing ? "Materializing..." : "Build USA Rollup"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="panel metrics">
        {cards.map((item) => (
          <article key={item.label}>
            <h2>{item.value}</h2>
            <p>{item.label}</p>
          </article>
        ))}
      </section>

      <section className="split usa-rollup-layout">
        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Merged USA Creatives</p>
              <h3>Median Rollup</h3>
            </div>
            <span className="chip">{loading ? "Refreshing" : `${items.length} creatives`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Creative</th>
                  <th>Spend</th>
                  <th>ROAS</th>
                  <th>Orders</th>
                  <th>CTR</th>
                  <th>Hook</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.rollup_id}
                    className={selectedId === item.rollup_id ? "clickable active" : "clickable"}
                    onClick={() => setSelectedId(item.rollup_id)}
                  >
                    <td>
                      <strong>{item.creative_name || item.headline || "Untitled Creative"}</strong>
                      <div className="muted small-line">
                        {item.usage_count} usages · {item.snapshot_count} snapshots
                        {item.outlier_count ? ` · ${item.outlier_count} outliers` : ""}
                      </div>
                    </td>
                    <td>{fmtNumber(item.median_spend, 2)}</td>
                    <td>{fmtNumber(item.median_roas, 2)}</td>
                    <td>{fmtNumber(item.median_orders, 1)}</td>
                    <td>{fmtPercent(item.median_ctr)}</td>
                    <td>{fmtPercent(item.median_hook_rate)}</td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No USA rollup rows yet. Materialize the last {lookbackDays} days first.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Creative Detail</p>
              <h3>{detail?.creative_name || "Select a merged creative"}</h3>
            </div>
            {loadingDetail ? <span className="chip">Loading</span> : null}
          </div>
          {detail ? (
            <div className="stack">
              {activeVisualUrl ? (
                <img src={activeVisualUrl} alt={detail.creative_name || "Creative preview"} className="usa-rollup-preview" />
              ) : null}

              <div className="metrics compact-metrics">
                {[
                  { label: "Median Spend", value: fmtNumber(detail.median_spend, 2) },
                  { label: "Median ROAS", value: fmtNumber(detail.median_roas, 2) },
                  { label: "Median Orders", value: fmtNumber(detail.median_orders, 1) },
                  { label: "Median CTR", value: fmtPercent(detail.median_ctr) },
                  { label: "Median Hook Rate", value: fmtPercent(detail.median_hook_rate) },
                ].map((item) => (
                  <article key={item.label}>
                    <h2>{item.value}</h2>
                    <p>{item.label}</p>
                  </article>
                ))}
              </div>

              <div className="item">
                <div>
                  <strong>Copy</strong>
                  <p>{detail.body_text || "No body text saved"}</p>
                  <p className="muted">{detail.headline || "No headline saved"}</p>
                </div>
              </div>

              <div className="section-heading">
                <div>
                  <p className="eyebrow">Scoring Slots</p>
                  <h3>Plugged APIs</h3>
                </div>
              </div>
              <div className="stack">
                <div className="item">
                  <div>
                    <strong>Audio Stack</strong>
                    <p>
                      BEATs mood and energy plus FireRedVAD source typing.
                      {!audioMediaUrl ? " Direct playable media is not preserved on this record yet." : ""}
                    </p>
                  </div>
                  <button type="button" onClick={onRunAudioStack} disabled={audioLoading || !audioMediaUrl}>
                    {audioLoading ? "Running..." : "Run"}
                  </button>
                </div>
                {audioStack ? (
                  <div className="item">
                    <div>
                      <strong>{audioStack.audio_mood} · {audioStack.energy_level}</strong>
                      <p>Source: {audioStack.voice_music_ratio}</p>
                      <p className="muted">{audioStack.beats_model_id} / {audioStack.firered_model_id}</p>
                    </div>
                  </div>
                ) : null}

                <div className="item">
                  <div>
                    <strong>SigLIP Visual Embedding</strong>
                    <p>Returns a reusable similarity vector for the creative preview.</p>
                  </div>
                  <button type="button" onClick={onRunSiglip} disabled={siglipLoading || !activeVisualUrl}>
                    {siglipLoading ? "Embedding..." : "Run"}
                  </button>
                </div>
                {siglip ? (
                  <div className="item">
                    <div>
                      <strong>{siglip.dimensions}-dim vector</strong>
                      <p className="muted">{siglip.model_id}</p>
                    </div>
                  </div>
                ) : null}

                {(detail.outliers || []).length ? (
                  <div className="item">
                    <div>
                      <strong>Outliers</strong>
                      <p>{detail.outliers.length} snapshot-level outliers flagged in the current lookback window.</p>
                    </div>
                    <span className="chip warn">Flagged</span>
                  </div>
                ) : null}

                <div className="item">
                  <div>
                    <strong>Still Pending</strong>
                    <p>Music mood finalization, Claude subjective pass, and prompt tightening stay outside the current locked path.</p>
                  </div>
                  <span className="chip">{detail.scoring_status?.claude_subjective || "pending"}</span>
                </div>
              </div>

              <div className="section-heading">
                <div>
                  <p className="eyebrow">Merged Members</p>
                  <h3>USA Usage Rows</h3>
                </div>
              </div>
              <div className="stack">
                {(detail.usage_members || []).map((usage) => (
                  <div key={usage.usage_id} className="item">
                    <div>
                      <strong>{usage.campaign_name || "Campaign missing"}</strong>
                      <p>{usage.adset_name || "Ad set missing"}</p>
                      <p className="muted">{usage.ad_name || usage.usage_id}</p>
                    </div>
                    <span>{usage.publisher_platform || usage.status || "-"}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="body-copy muted">Select a merged USA creative to inspect the rollup and scoring slots.</p>
          )}
        </article>
      </section>
    </>
  );
}
