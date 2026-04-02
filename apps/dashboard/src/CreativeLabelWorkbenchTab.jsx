import React, { useEffect, useMemo, useState } from "react";
import {
  fetchCreativeLabels,
  fetchCreativeUsaRollupDetail,
  fetchCreativeWorkbenchQueue,
  materializeCreativeLabels,
  runCreativeBatchLabel,
} from "./api";
import { WINDOW_TO_DAYS, fmtMoney, fmtNumber, fmtPercent } from "./creativeOpsShared";

function JsonBlock({ value }) {
  if (!value) return <p className="muted">No data yet.</p>;
  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

export default function CreativeLabelWorkbenchTab({ tenantKey, storeKey }) {
  const [lookbackWindow, setLookbackWindow] = useState("90d");
  const [queueStatus, setQueueStatus] = useState("all");
  const [queueLimit, setQueueLimit] = useState(50);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [runningSingle, setRunningSingle] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [labels, setLabels] = useState(null);
  const [batchResult, setBatchResult] = useState(null);

  const lookbackDays = useMemo(() => WINDOW_TO_DAYS[lookbackWindow] || 90, [lookbackWindow]);

  async function loadQueue({ selectFirst = false } = {}) {
    if (!storeKey) return;
    setLoadingQueue(true);
    setError("");
    try {
      const payload = await fetchCreativeWorkbenchQueue({
        tenantKey,
        storeKey,
        lookbackDays,
        lookbackWindow,
        status: queueStatus,
        limit: queueLimit,
      });
      const nextItems = payload.items || [];
      setQueue(nextItems);
      if (selectFirst && nextItems[0]?.rollup_id) {
        setSelectedId(nextItems[0].rollup_id);
      } else if (!nextItems.some((item) => item.rollup_id === selectedId)) {
        setSelectedId(nextItems[0]?.rollup_id || "");
      }
    } catch (err) {
      setError(err.message || "Failed to load workbench queue");
    } finally {
      setLoadingQueue(false);
    }
  }

  useEffect(() => {
    void loadQueue({ selectFirst: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantKey, storeKey, lookbackWindow, queueStatus, queueLimit]);

  useEffect(() => {
    async function loadDetail() {
      if (!storeKey || !selectedId) {
        setDetail(null);
        setLabels(null);
        return;
      }
      setLoadingDetail(true);
      setError("");
      try {
        const payload = await fetchCreativeUsaRollupDetail({
          tenantKey,
          storeKey,
          rollupId: selectedId,
          lookbackDays,
          lookbackWindow,
          metricKeys: ["spend", "roas", "orders", "ctr", "hook_rate"],
        });
        setDetail(payload);
        if (payload?.creative_labels) {
          setLabels(payload.creative_labels);
          return;
        }
        try {
          const record = await fetchCreativeLabels({
            tenantKey,
            storeKey,
            canonicalCreativeId: selectedId,
            variantId: payload?.variant_id || null,
          });
          setLabels(record);
        } catch {
          setLabels(null);
        }
      } catch (err) {
        setError(err.message || "Failed to load workbench detail");
      } finally {
        setLoadingDetail(false);
      }
    }
    void loadDetail();
  }, [selectedId, tenantKey, storeKey, lookbackDays, lookbackWindow]);

  async function onRunSingle(forceRefresh = false) {
    if (!detail?.rollup_id) return;
    setRunningSingle(true);
    setError("");
    try {
      const payload = await materializeCreativeLabels({
        tenantKey,
        storeKey,
        rollupId: detail.rollup_id,
        variantId: detail.variant_id,
        forceRefresh,
      });
      setLabels(payload.labels);
      await loadQueue();
    } catch (err) {
      setError(err.message || "Single creative labeling failed");
    } finally {
      setRunningSingle(false);
    }
  }

  async function onRunBatch(forceRefresh = false) {
    setRunningBatch(true);
    setError("");
    setBatchResult(null);
    try {
      const payload = await runCreativeBatchLabel({
        tenantKey,
        storeKey,
        lookbackDays,
        lookbackWindow,
        status: queueStatus === "labeled" ? "all" : queueStatus,
        limit: Math.min(queueLimit, 10),
        forceRefresh,
      });
      setBatchResult(payload);
      await loadQueue({ selectFirst: false });
    } catch (err) {
      setError(err.message || "Batch labeling failed");
    } finally {
      setRunningBatch(false);
    }
  }

  return (
    <>
      <section className="panel ops-toolbar">
        <div className="ops-toolbar-row">
          <select value={lookbackWindow} onChange={(event) => setLookbackWindow(event.target.value)}>
            <option value="30d">Last 30 days</option>
            <option value="60d">Last 60 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all_time">All time</option>
          </select>
          <select value={queueStatus} onChange={(event) => setQueueStatus(event.target.value)}>
            <option value="all">All</option>
            <option value="unlabeled">Unlabeled</option>
            <option value="labeled">Labeled</option>
          </select>
          <select value={queueLimit} onChange={(event) => setQueueLimit(Number(event.target.value))}>
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
          <button type="button" className="button-secondary" onClick={() => loadQueue({ selectFirst: false })} disabled={loadingQueue}>
            Refresh Queue
          </button>
          <button type="button" onClick={() => onRunBatch(false)} disabled={runningBatch || !queue.length}>
            {runningBatch ? "Running..." : "Batch Label"}
          </button>
          <button type="button" className="button-secondary" onClick={() => onRunBatch(true)} disabled={runningBatch || !queue.length}>
            Force Refresh Batch
          </button>
        </div>
        <div className="ops-toolbar-meta">
          <span className="chip">{queue.length} creatives</span>
          <span className="chip">{lookbackWindow}</span>
          {batchResult ? <span className="chip good">{fmtNumber(batchResult.success_count, 0)} labeled</span> : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="ops-layout">
        <article className="panel ops-sidebar">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h3>{loadingQueue ? "Refreshing queue" : "Creative labeling queue"}</h3>
            </div>
            <span className="chip">{queue.length} rows</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Creative</th>
                  <th>Status</th>
                  <th>Spend</th>
                  <th>ROAS</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr
                    key={item.rollup_id}
                    className={selectedId === item.rollup_id ? "clickable active" : "clickable"}
                    onClick={() => setSelectedId(item.rollup_id)}
                  >
                    <td>
                      <strong>{item.creative_name || item.rollup_id}</strong>
                      <div className="muted small-line">
                        {item.usage_count} usages · {item.variant_count} variants · {item.snapshot_count} snapshots
                      </div>
                    </td>
                    <td>
                      <span className={item.label_status === "labeled" ? "chip good" : "chip"}>
                        {item.label_status}
                      </span>
                    </td>
                    <td>{fmtMoney(item.total_spend)}</td>
                    <td>{fmtNumber(item.blended_roas, 2)}</td>
                  </tr>
                ))}
                {!queue.length ? (
                  <tr>
                    <td colSpan={4} className="muted">No queue rows found for this window.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel ops-detail">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Inspector</p>
              <h3>{detail?.creative_name || "Select a creative"}</h3>
            </div>
            {loadingDetail ? <span className="chip">Loading</span> : null}
          </div>

          {detail ? (
            <div className="stack">
              {detail.preview_url || detail.thumbnail_url ? (
                <img
                  src={detail.preview_url || detail.thumbnail_url}
                  alt={detail.creative_name || "Creative preview"}
                  className="usa-rollup-preview"
                />
              ) : null}

              <div className="metrics compact-metrics">
                {[
                  { label: "Spend", value: fmtMoney(detail.total_spend, detail.currency) },
                  { label: "ROAS", value: fmtNumber(detail.blended_roas, 2) },
                  { label: "Orders", value: fmtNumber(detail.total_orders, 0) },
                  { label: "CTR", value: fmtPercent(detail.ctr) },
                  { label: "Hook", value: fmtPercent(detail.hook_rate) },
                ].map((item) => (
                  <article key={item.label}>
                    <h2>{item.value}</h2>
                    <p>{item.label}</p>
                  </article>
                ))}
              </div>

              <div className="item">
                <div>
                  <strong>Run Labels</strong>
                  <p>Materialize the full layer-4 label record for this canonical creative and inspect the stored JSON below.</p>
                </div>
                <div className="form compact-form">
                  <button type="button" onClick={() => onRunSingle(false)} disabled={runningSingle}>
                    {runningSingle ? "Running..." : "Run Once"}
                  </button>
                  <button type="button" className="button-secondary" onClick={() => onRunSingle(true)} disabled={runningSingle}>
                    Force Refresh
                  </button>
                </div>
              </div>

              <div className="section-heading">
                <div>
                  <p className="eyebrow">Usage Memory</p>
                  <h3>Where you can still find this creative</h3>
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

              <div className="section-heading">
                <div>
                  <p className="eyebrow">Stored Labels</p>
                  <h3>Final label record</h3>
                </div>
              </div>
              <JsonBlock value={labels} />
            </div>
          ) : (
            <p className="body-copy muted">Select a queue row to inspect and run labels.</p>
          )}
        </article>
      </section>
    </>
  );
}
