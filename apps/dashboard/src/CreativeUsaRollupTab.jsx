import React, { useEffect, useMemo, useState } from "react";
import {
  analyzeSignalStackAudio,
  embedSiglip,
  fetchCreativeUsaRollup,
  fetchCreativeUsaRollupDetail,
  materializeCreativeUsaRollup,
  scoreClaudeSubjective,
} from "./api";
import { WINDOW_TO_DAYS, fmtMoney, fmtNumber, fmtPercent } from "./creativeOpsShared";

function metricCards(items, currency) {
  if (!items.length) {
    return [
      { label: "Creatives", value: 0 },
      { label: "Total Spend", value: "-" },
      { label: "Portfolio ROAS", value: "-" },
      { label: "Total Orders", value: "-" },
      { label: "Weighted CTR", value: "-" },
      { label: "Weighted Hook Rate", value: "-" },
      { label: "Outliers", value: "-" },
    ];
  }
  const totalSpend = items.reduce((sum, item) => sum + (Number(item.total_spend) || 0), 0);
  const totalRevenue = items.reduce((sum, item) => sum + (Number(item.total_revenue) || 0), 0);
  const totalOrders = items.reduce((sum, item) => sum + (Number(item.total_orders) || 0), 0);
  const totalImpressions = items.reduce((sum, item) => sum + (Number(item.total_impressions) || 0), 0);
  const weightedClicks = items.reduce(
    (sum, item) => sum + ((Number(item.total_impressions) || 0) * (Number(item.ctr) || 0)) / 100,
    0,
  );
  const weightedVideo3s = items.reduce(
    (sum, item) => sum + ((Number(item.total_impressions) || 0) * (Number(item.hook_rate) || 0)) / 100,
    0,
  );
  const portfolioRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;
  const weightedCtr = totalImpressions > 0 ? (weightedClicks / totalImpressions) * 100 : null;
  const weightedHook = totalImpressions > 0 ? (weightedVideo3s / totalImpressions) * 100 : null;
  const outlierCount = items.filter((item) => item.is_outlier).length;
  return [
    { label: "Creatives", value: items.length },
    { label: "Total Spend", value: fmtMoney(totalSpend, currency) },
    { label: "Portfolio ROAS", value: fmtNumber(portfolioRoas, 2) },
    { label: "Total Orders", value: fmtNumber(totalOrders, 0) },
    { label: "Weighted CTR", value: fmtPercent(weightedCtr) },
    { label: "Weighted Hook Rate", value: fmtPercent(weightedHook) },
    { label: "Outliers", value: fmtNumber(outlierCount, 0) },
  ];
}

export default function CreativeUsaRollupTab({ tenantKey, storeKey }) {
  const metricKeys = useMemo(() => ["spend", "roas", "orders", "ctr", "hook_rate"], []);
  const [lookbackWindow, setLookbackWindow] = useState("90d");
  const [rowLimit, setRowLimit] = useState(100);
  const [minSpendThreshold] = useState(30);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [siglipLoading, setSiglipLoading] = useState(false);
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [audioStack, setAudioStack] = useState(null);
  const [siglip, setSiglip] = useState(null);
  const [claudeSubjective, setClaudeSubjective] = useState(null);

  async function loadRollup({ selectFirst = false } = {}) {
    if (!storeKey) return;
    setLoading(true);
    setError("");
    try {
      const lookbackDays = WINDOW_TO_DAYS[lookbackWindow] || 90;
      const payload = await fetchCreativeUsaRollup({
        tenantKey,
        storeKey,
        lookbackDays,
        lookbackWindow,
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
  }, [tenantKey, storeKey, lookbackWindow, rowLimit, metricKeys]);

  useEffect(() => {
    async function loadDetail() {
      if (!storeKey || !selectedId) {
        setDetail(null);
        return;
      }
      setLoadingDetail(true);
      setAudioStack(null);
      setSiglip(null);
      setClaudeSubjective(null);
      try {
        const lookbackDays = WINDOW_TO_DAYS[lookbackWindow] || 90;
        const payload = await fetchCreativeUsaRollupDetail({
          tenantKey,
          storeKey,
          rollupId: selectedId,
          lookbackDays,
          lookbackWindow,
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
  }, [selectedId, tenantKey, storeKey, lookbackWindow, metricKeys]);

  const displayCurrency = detail?.currency || items.find((item) => item.currency)?.currency || "TRY";
  const cards = useMemo(() => metricCards(items, displayCurrency), [displayCurrency, items]);
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
      const lookbackDays = WINDOW_TO_DAYS[lookbackWindow] || 90;
      await materializeCreativeUsaRollup({
        tenantKey,
        storeKey,
        lookbackDays,
        lookbackWindow,
        minSpendThreshold,
        metricKeys,
      });
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

  async function onRunClaudeSubjective(forceRefresh = false) {
    if (!detail?.rollup_id) return;
    setClaudeLoading(true);
    setError("");
    try {
      const payload = await scoreClaudeSubjective({
        tenantKey,
        storeKey,
        rollupId: detail.rollup_id,
        forceRefresh,
      });
      setClaudeSubjective(payload);
    } catch (err) {
      setError(err.message || "Claude subjective score failed");
    } finally {
      setClaudeLoading(false);
    }
  }

  return (
    <>
      <section className="panel hero">
        <div>
          <p className="eyebrow">USA Rollup</p>
          <h1>Canonical Creative Comparison</h1>
          <p>
            One row per canonical creative in USA. Metrics are blended over the full window, with a
            spend floor and row-level outlier flags.
          </p>
        </div>
        <div className="form">
          <select value={lookbackWindow} onChange={(event) => setLookbackWindow(event.target.value)}>
            <option value="30d">Last 30 days</option>
            <option value="60d">Last 60 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all_time">All time</option>
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
                  <h3>Canonical Performance</h3>
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
                        {item.usage_count} usages · {item.variant_count || 0} variants · {item.snapshot_count} snapshots
                        {item.is_outlier ? " · flagged outlier" : ""}
                      </div>
                    </td>
                    <td>{fmtMoney(item.total_spend, item.currency || displayCurrency)}</td>
                    <td>{fmtNumber(item.blended_roas, 2)}</td>
                    <td>{fmtNumber(item.total_orders, 0)}</td>
                    <td>{fmtPercent(item.ctr)}</td>
                    <td>{fmtPercent(item.hook_rate)}</td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No USA rollup rows yet. Materialize the selected window first.
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
                  { label: "Total Spend", value: fmtMoney(detail.total_spend, detail.currency || displayCurrency) },
                  { label: "Total Revenue", value: fmtMoney(detail.total_revenue, detail.currency || displayCurrency) },
                  { label: "Blended ROAS", value: fmtNumber(detail.blended_roas, 2) },
                  { label: "Total Orders", value: fmtNumber(detail.total_orders, 0) },
                  { label: "CTR", value: fmtPercent(detail.ctr) },
                  { label: "Hook Rate", value: fmtPercent(detail.hook_rate) },
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
                <span className="chip">
                  {detail.lookback_window || "window"} · floor {fmtMoney(minSpendThreshold, detail.currency || displayCurrency)}
                </span>
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

                <div className="item">
                  <div>
                    <strong>Claude Subjective Layer</strong>
                    <p>Cached strategic read of heritage vibe, tone, hook style, premium feel, and UGC polish.</p>
                  </div>
                  <button type="button" onClick={() => onRunClaudeSubjective(false)} disabled={claudeLoading || !detail?.rollup_id}>
                    {claudeLoading ? "Running..." : "Run"}
                  </button>
                </div>
                {claudeSubjective ? (
                  <div className="item">
                    <div>
                      <strong>
                        {claudeSubjective.score.heritage_vibe} heritage · {claudeSubjective.score.premium_vs_casual} · {claudeSubjective.score.ugc_vs_polished}
                      </strong>
                      <p>
                        {claudeSubjective.score.emotional_angle} · {claudeSubjective.score.hook_type} · {claudeSubjective.score.opening_style}
                      </p>
                      <p className="muted">
                        {claudeSubjective.model_id} · {claudeSubjective.prompt_version}
                        {claudeSubjective.cache_hit ? " · cached" : " · fresh"}
                      </p>
                    </div>
                  </div>
                ) : null}

                {detail.is_outlier ? (
                  <div className="item">
                    <div>
                      <strong>Outliers</strong>
                      <p>This canonical creative is flagged as a blended-ROAS outlier inside the selected USA window.</p>
                    </div>
                    <span className="chip warn">Flagged</span>
                  </div>
                ) : null}

                <div className="item">
                  <div>
                    <strong>Still Pending</strong>
                    <p>Music mood finalization and broader prompt tightening stay outside the current locked path.</p>
                  </div>
                  <span className="chip">{claudeSubjective ? "ready" : detail.scoring_status?.claude_subjective || "pending"}</span>
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
