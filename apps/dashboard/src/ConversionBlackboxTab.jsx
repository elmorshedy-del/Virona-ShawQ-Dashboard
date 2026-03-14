import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  blackboxCasesCsvUrl,
  fetchBlackboxCaseEvents,
  fetchBlackboxCases,
  fetchBlackboxOverview,
} from "./api";

const STATUS_OPTIONS = [
  "all",
  "full_success",
  "ghost_order",
  "webhook_only",
  "pixel_only",
  "ghost_candidate",
  "duplicate_begin_checkout",
  "checkout_in_progress",
  "in_progress",
  "order_no_tracking",
  "observed",
];

function statusTone(status = "") {
  const lower = String(status || "").toLowerCase();
  if (lower.includes("full_success")) return "good";
  if (lower.includes("in_progress") || lower.includes("observed")) return "warn";
  if (lower.includes("ghost") || lower.includes("duplicate") || lower.includes("order_no_tracking") || lower.includes("webhook_only")) return "bad";
  return "warn";
}

function fmtCount(value) {
  return Number(value || 0).toLocaleString();
}

function fmtUtc(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }) + " UTC";
}

export default function ConversionBlackboxTab() {
  const [tenantKey, setTenantKey] = useState(() => localStorage.getItem("blackboxTenantKey") || "default");
  const [storeKey, setStoreKey] = useState(() => localStorage.getItem("blackboxStoreKey") || "");
  const [status, setStatus] = useState("all");
  const [confidence, setConfidence] = useState("all");
  const [lookbackDays, setLookbackDays] = useState(7);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState(null);
  const [cases, setCases] = useState([]);
  const [totalCases, setTotalCases] = useState(0);

  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const inFlightRef = useRef(false);
  const selectedCaseIdRef = useRef("");

  const canLoad = Boolean(storeKey.trim());

  useEffect(() => {
    selectedCaseIdRef.current = selectedCase?.case_id || "";
  }, [selectedCase]);

  const loadData = useCallback(async () => {
    if (!storeKey.trim()) {
      setError("Store key is required");
      return;
    }
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setLoading(true);
    setError("");
    try {
      const resolvedTenantKey = tenantKey.trim() || "default";
      const resolvedStoreKey = storeKey.trim();
      localStorage.setItem("blackboxTenantKey", resolvedTenantKey);
      localStorage.setItem("blackboxStoreKey", resolvedStoreKey);

      const [overviewData, casesData] = await Promise.all([
        fetchBlackboxOverview({
          tenantKey: resolvedTenantKey,
          storeKey: resolvedStoreKey,
          lookbackDays,
        }),
        fetchBlackboxCases({
          tenantKey: resolvedTenantKey,
          storeKey: resolvedStoreKey,
          status: status === "all" ? "" : status,
          confidence: confidence === "all" ? "" : confidence,
          limit: 200,
          offset: 0,
        }),
      ]);
      const nextItems = casesData.items || [];
      setOverview(overviewData);
      setCases(nextItems);
      setTotalCases(casesData.total || 0);
      const selectedCaseId = selectedCaseIdRef.current;
      if (selectedCaseId && !nextItems.some((item) => item.case_id === selectedCaseId)) {
        setSelectedCase(null);
        setSelectedEvents([]);
      }
    } catch (err) {
      setError(err.message || "Failed to load blackbox data");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [tenantKey, storeKey, status, confidence, lookbackDays]);

  useEffect(() => {
    if (!canLoad) return;
    loadData();
  }, [canLoad, loadData]);

  async function openTimeline(item) {
    setSelectedCase(item);
    setTimelineLoading(true);
    try {
      const response = await fetchBlackboxCaseEvents({
        tenantKey: tenantKey.trim() || "default",
        storeKey: storeKey.trim(),
        caseId: item.case_id,
        limit: 1000,
      });
      setSelectedEvents(response.items || []);
    } catch (err) {
      setError(err.message || "Failed to load case timeline");
      setSelectedEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  }

  const csvUrl = useMemo(() => {
    if (!storeKey.trim()) return "";
    return blackboxCasesCsvUrl({
      tenantKey: tenantKey.trim() || "default",
      storeKey: storeKey.trim(),
      status: status === "all" ? "" : status,
      confidence: confidence === "all" ? "" : confidence,
      limit: 20000,
    });
  }, [tenantKey, storeKey, status, confidence]);

  return (
    <>
      <section className="panel hero">
        <div>
          <p className="eyebrow">Conversion Blackbox</p>
          <h1>Ghost and Duplication Forensics</h1>
          <p>
            Unified case log from your own diagnostics signals and Shopify order webhooks.
            No Session Intelligence dependency.
          </p>
        </div>

        <div className="form blackbox-form">
          <input
            value={tenantKey}
            onChange={(event) => setTenantKey(event.target.value)}
            placeholder="Tenant key (example: default)"
          />
          <input
            value={storeKey}
            onChange={(event) => setStoreKey(event.target.value)}
            placeholder="Store key (example: shawq.co)"
            required
          />
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select value={confidence} onChange={(event) => setConfidence(event.target.value)}>
            <option value="all">all confidence</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <input
            type="number"
            min={1}
            max={90}
            value={lookbackDays}
            onChange={(event) => setLookbackDays(Math.max(1, Math.min(90, Number(event.target.value || 7))))}
            title="Lookback days"
          />
          <button type="button" onClick={loadData} disabled={loading || !canLoad}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <a className={`button-link ${csvUrl ? "" : "disabled"}`} href={csvUrl || "#"} target="_blank" rel="noreferrer">
            Export CSV
          </a>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </section>

      <section className="panel metrics">
        <article>
          <h2>{fmtCount(totalCases)}</h2>
          <p>Filtered Cases</p>
        </article>
        <article>
          <h2>{fmtCount(overview?.total_cases)}</h2>
          <p>Total Cases ({overview?.lookback_days || lookbackDays}d)</p>
        </article>
        <article>
          <h2>{fmtCount((overview?.status_counts?.ghost_order || 0) + (overview?.status_counts?.webhook_only || 0) + (overview?.status_counts?.order_no_tracking || 0))}</h2>
          <p>Ghost Orders</p>
        </article>
        <article>
          <h2>{fmtCount(overview?.status_counts?.duplicate_begin_checkout)}</h2>
          <p>Duplicate Hotspots</p>
        </article>
        <article>
          <h2>{fmtCount(overview?.status_counts?.ghost_candidate)}</h2>
          <p>Ghost Session Candidates</p>
        </article>
        <article>
          <h2>{fmtCount(overview?.status_counts?.full_success)}</h2>
          <p>Full Success</p>
        </article>
      </section>

      <section className="panel">
        <h3>Cases</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Case ID</th>
                <th>First Seen</th>
                <th>Last Seen</th>
                <th>Checkout Path</th>
                <th>Order ID</th>
                <th>Value</th>
                <th>Signals</th>
                <th>Duplicates</th>
                <th>Country</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((row) => (
                <tr
                  key={row.case_id}
                  onClick={() => openTimeline(row)}
                  className={`clickable ${selectedCase?.case_id === row.case_id ? "active" : ""}`}
                >
                  <td>
                    <span className={`chip ${statusTone(row.status)}`}>{row.status}</span>
                  </td>
                  <td>{row.case_id}</td>
                  <td>{fmtUtc(row.first_seen_at)}</td>
                  <td>{fmtUtc(row.last_seen_at)}</td>
                  <td>{[row.checkout_source, row.checkout_button].filter(Boolean).join(" / ") || "-"}</td>
                  <td>{row.order_id || "-"}</td>
                  <td>{row.order_value != null ? `${row.currency || ""} ${row.order_value}`.trim() : "-"}</td>
                  <td>{fmtCount(row.signal_count)}</td>
                  <td>{fmtCount(row.duplicate_count)}</td>
                  <td>{[row.country, row.region].filter(Boolean).join("/") || "-"}</td>
                  <td>{row.confidence}</td>
                </tr>
              ))}
              {!cases.length ? (
                <tr>
                  <td colSpan={11}>No cases found for this filter.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h3>Case Timeline {selectedCase ? `- ${selectedCase.case_id}` : ""}</h3>
        {timelineLoading ? <p>Loading timeline...</p> : null}
        {!timelineLoading && selectedCase && !selectedEvents.length ? <p>No events for this case.</p> : null}
        {!timelineLoading && !selectedCase ? <p>Select a case row to inspect full journey events.</p> : null}
        {selectedEvents.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Observed</th>
                  <th>Source</th>
                  <th>Event</th>
                  <th>Checkout Path</th>
                  <th>Order ID</th>
                  <th>Value</th>
                  <th>Country</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {selectedEvents.map((row) => (
                  <tr key={row.id}>
                    <td>{fmtUtc(row.observed_at)}</td>
                    <td>{row.source_system}</td>
                    <td>{row.event_name}</td>
                    <td>{[row.checkout_source, row.checkout_button].filter(Boolean).join(" / ") || "-"}</td>
                    <td>{row.order_id || "-"}</td>
                    <td>{row.event_value != null ? `${row.currency || ""} ${row.event_value}`.trim() : "-"}</td>
                    <td>{[row.country, row.region].filter(Boolean).join("/") || "-"}</td>
                    <td>
                      {[
                        row.is_begin_checkout ? "begin" : "",
                        row.is_purchase_pixel ? "pixel_purchase" : "",
                        row.is_purchase_webhook ? "webhook_purchase" : "",
                        row.is_meta_200 ? "meta_200" : "",
                        row.is_duplicate_candidate ? "dup_candidate" : "",
                      ]
                        .filter(Boolean)
                        .join(", ") || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}
