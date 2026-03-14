import React, { useMemo, useState } from "react";
import { analyzeStore } from "./api";

function toNum(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function statusTone(status = "") {
  const lower = status.toLowerCase();
  if (lower.includes("ok")) return "good";
  if (lower.includes("partial")) return "warn";
  return "bad";
}

export default function KeywordIntelTab() {
  const [storeUrl, setStoreUrl] = useState("https://shawq.co");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload = await analyzeStore(storeUrl.trim());
      setResult(payload);
    } catch (err) {
      setError(err.message || "Failed to run analysis");
    } finally {
      setLoading(false);
    }
  }

  const topKeywords = useMemo(() => {
    if (!result?.keywords) return [];
    return result.keywords.slice(0, 15);
  }, [result]);

  const competitors = result?.competitor_intelligence?.discovered_competitors || [];
  const keywordGaps = result?.competitor_intelligence?.keyword_gaps || [];
  const adCopyGaps = result?.competitor_intelligence?.ad_copy_gaps || [];
  const competitorProviderStatus = result?.competitor_intelligence?.provider_status || {};
  const alerts = result?.monitoring?.alerts || [];

  return (
    <>
      <section className="panel hero">
        <div>
          <p className="eyebrow">Google Ads Keyword Intelligence</p>
          <h1>PPC Intelligence Control Center</h1>
          <p>
            Discover products, score real keyword opportunities, map competitors, and generate
            deployable ad groups.
          </p>
        </div>
        <form onSubmit={onSubmit} className="form">
          <input
            value={storeUrl}
            onChange={(event) => setStoreUrl(event.target.value)}
            placeholder="https://store.com"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Analyzing..." : "Run Full Analysis"}
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>

      {result ? (
        <>
          <section className="panel metrics">
            <article>
              <h2>{result.profile.platform}</h2>
              <p>Platform</p>
            </article>
            <article>
              <h2>{result.profile.language.toUpperCase()}</h2>
              <p>Language</p>
            </article>
            <article>
              <h2>{result.keywords.length}</h2>
              <p>Ranked Keywords</p>
            </article>
            <article>
              <h2>{result.ad_groups.length}</h2>
              <p>Ad Groups</p>
            </article>
            <article>
              <h2>{competitors.length}</h2>
              <p>Competitors</p>
            </article>
            <article>
              <h2>{alerts.length}</h2>
              <p>Live Alerts</p>
            </article>
          </section>

          <section className="panel">
            <h3>Provider Health</h3>
            <div className="chips">
              {Object.entries(result.source_status || {}).map(([name, status]) => (
                <span key={name} className={`chip ${statusTone(status)}`}>
                  {name}: {status}
                </span>
              ))}
              {Object.entries(competitorProviderStatus).map(([name, status]) => (
                <span key={`cmp-${name}`} className={`chip ${statusTone(status)}`}>
                  {name}: {status}
                </span>
              ))}
            </div>
          </section>

          <section className="panel">
            <h3>Top Keywords</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Score</th>
                    <th>Confidence</th>
                    <th>Intent</th>
                    <th>Volume</th>
                    <th>CPC</th>
                    <th>Gem</th>
                  </tr>
                </thead>
                <tbody>
                  {topKeywords.map((row) => (
                    <tr key={row.keyword}>
                      <td>{row.keyword}</td>
                      <td>{toNum(row.score)}</td>
                      <td>{toNum(row.confidence)}</td>
                      <td>{row.buying_intent}</td>
                      <td>{row.volume}</td>
                      <td>${toNum(row.cpc)}</td>
                      <td>{row.hidden_gem ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="split">
            <article className="panel">
              <h3>Top Competitors</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Paid Keywords</th>
                      <th>Organic Keywords</th>
                      <th>Est. Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {competitors.slice(0, 10).map((item) => (
                      <tr key={item.domain}>
                        <td>{item.domain}</td>
                        <td>{item.paid_keywords.length}</td>
                        <td>{item.organic_keywords.length}</td>
                        <td>${toNum(item.estimated_monthly_spend_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel">
              <h3>Keyword Gaps</h3>
              <div className="stack">
                {keywordGaps.slice(0, 10).map((gap) => (
                  <div key={gap.keyword} className="item">
                    <div>
                      <strong>{gap.keyword}</strong>
                      <p>{gap.competitor_domains.slice(0, 3).join(", ")}</p>
                    </div>
                    <span>Opp {toNum(gap.opportunity_score)}</span>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="split">
            <article className="panel">
              <h3>Ad Copy Angles You Miss</h3>
              <div className="stack">
                {adCopyGaps.slice(0, 8).map((gap) => (
                  <div key={gap.angle} className="item">
                    <div>
                      <strong>{gap.angle}</strong>
                      <p>{gap.examples[0] || "-"}</p>
                    </div>
                    <span>{gap.competitor_domains.length} comps</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <h3>Monitoring Alerts</h3>
              <div className="stack">
                {alerts.length ? alerts.map((alert) => <p key={alert} className="alert">{alert}</p>) : <p>No alerts yet.</p>}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </>
  );
}
