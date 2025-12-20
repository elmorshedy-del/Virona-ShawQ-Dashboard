import React, { useState, useEffect } from 'react';

const API_BASE = '/api/intelligence';

export default function CampaignIntelligence({ store = 'vironax' }) {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [geoComparison, setGeoComparison] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('campaign');

  useEffect(() => {
    fetchCampaigns();
    fetchGeoComparison();
    fetchAlerts();
  }, [store]);

  useEffect(() => {
    if (selectedCampaign) {
      analyzeCampaign(selectedCampaign);
    }
  }, [selectedCampaign]);

  const fetchCampaigns = async () => {
    try {
      const res = await fetch(`${API_BASE}/campaigns?store=${store}`);
      const data = await res.json();
      if (data.success) setCampaigns(data.campaigns);
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
    }
  };

  const fetchGeoComparison = async () => {
    try {
      const res = await fetch(`${API_BASE}/geo-comparison?store=${store}`);
      const data = await res.json();
      if (data.success) setGeoComparison(data.geos);
    } catch (err) {
      console.error('Failed to fetch geo comparison:', err);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/alerts?store=${store}&limit=10`);
      const data = await res.json();
      if (data.success) setAlerts(data.alerts);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
  };

  const analyzeCampaign = async (campaignId) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/campaign/${campaignId}?store=${store}`);
      const data = await res.json();
      if (data.success) setAnalysis(data.analysis);
    } catch (err) {
      console.error('Failed to analyze campaign:', err);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Campaign Intelligence</h1>
        <p className="text-gray-500">Data-driven campaign analysis and recommendations</p>
      </div>

      <div className="flex gap-2 mb-6">
        <TabButton active={activeTab === 'campaign'} onClick={() => setActiveTab('campaign')}>
          📊 Campaign Analysis
        </TabButton>
        <TabButton active={activeTab === 'geo'} onClick={() => setActiveTab('geo')}>
          🌍 Geo Comparison
        </TabButton>
        <TabButton active={activeTab === 'alerts'} onClick={() => setActiveTab('alerts')}>
          🔔 Alerts {alerts.length > 0 && <span className="ml-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">{alerts.length}</span>}
        </TabButton>
      </div>

      {activeTab === 'campaign' && (
        <CampaignTab
          campaigns={campaigns}
          selectedCampaign={selectedCampaign}
          setSelectedCampaign={setSelectedCampaign}
          analysis={analysis}
          loading={loading}
          store={store}
        />
      )}

      {activeTab === 'geo' && <GeoTab geos={geoComparison} />}

      {activeTab === 'alerts' && <AlertsTab alerts={alerts} />}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
        active ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function CampaignTab({ campaigns, selectedCampaign, setSelectedCampaign, analysis, loading, store }) {
  const freshCampaigns = campaigns.filter((c) => c.status === 'fresh');
  const establishedCampaigns = campaigns.filter((c) => c.status === 'established');

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 mb-4">Campaigns</h2>

          {freshCampaigns.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-orange-600 uppercase tracking-wide mb-2">
                🌱 Fresh ({freshCampaigns.length})
              </h3>
              {freshCampaigns.map((c) => (
                <CampaignRow
                  key={c.campaign_id}
                  campaign={c}
                  selected={selectedCampaign === c.campaign_id}
                  onClick={() => setSelectedCampaign(c.campaign_id)}
                />
              ))}
            </div>
          )}

          {establishedCampaigns.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-green-600 uppercase tracking-wide mb-2">
                📈 Established ({establishedCampaigns.length})
              </h3>
              {establishedCampaigns.map((c) => (
                <CampaignRow
                  key={c.campaign_id}
                  campaign={c}
                  selected={selectedCampaign === c.campaign_id}
                  onClick={() => setSelectedCampaign(c.campaign_id)}
                />
              ))}
            </div>
          )}

          {campaigns.length === 0 && <p className="text-gray-400 text-sm">No campaigns found</p>}
        </div>
      </div>

      <div className="col-span-8">
        {loading && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500">Analyzing campaign...</p>
          </div>
        )}

        {!loading && !analysis && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <p className="text-gray-400">Select a campaign to analyze</p>
          </div>
        )}

        {!loading && analysis && (analysis.status === 'fresh' ? <FreshModePanel analysis={analysis} store={store} /> : <EstablishedModePanel analysis={analysis} store={store} />)}
      </div>
    </div>
  );
}

function CampaignRow({ campaign, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg mb-2 transition-colors ${
        selected ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 hover:bg-gray-100 border border-transparent'
      }`}
    >
      <div className="font-medium text-gray-900 truncate">{campaign.campaign_name}</div>
      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
        <span>{campaign.geo}</span>
        <span>{campaign.total_purchases} purchases</span>
        <span>{campaign.roas}x ROAS</span>
      </div>
    </button>
  );
}

function FreshModePanel({ analysis, store }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded">🌱 Fresh Campaign</span>
              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">{analysis.geo}</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mt-2">{analysis.campaign_name}</h2>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">{analysis.metrics.total_purchases}</div>
            <div className="text-xs text-gray-500">purchases in {analysis.metrics.days_running} days</div>
          </div>
        </div>
      </div>

      <RecommendationCard recommendation={analysis.recommendation} />
      <FunnelDiagnostic analysis={analysis} />
      {analysis.testBudget && <TestBudgetGuide testBudget={analysis.testBudget} />}
      <AdSetComparison campaignId={analysis.campaign_id} store={store} />
      <ConfidenceBar confidence={analysis.confidence} benchmark={analysis.benchmark} />
    </div>
  );
}

function EstablishedModePanel({ analysis, store }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">📈 Established Campaign</span>
              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">{analysis.geo}</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mt-2">{analysis.campaign_name}</h2>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">{analysis.funnel.roas.formatted}</div>
            <div className="text-xs text-gray-500">ROAS • {analysis.metrics.total_purchases} purchases</div>
          </div>
        </div>
      </div>

      <RecommendationCard recommendation={analysis.recommendation} />
      {analysis.budgetOptimization && <BudgetOptimization optimization={analysis.budgetOptimization} />}
      <FunnelDiagnostic analysis={analysis} />
      <ConfidenceBar confidence={analysis.confidence} benchmark={analysis.benchmark} />
    </div>
  );
}

function RecommendationCard({ recommendation }) {
  const bgColor = {
    push: 'bg-green-50 border-green-200',
    fix: 'bg-yellow-50 border-yellow-200',
    kill: 'bg-red-50 border-red-200',
    optimize: 'bg-blue-50 border-blue-200',
    watch: 'bg-gray-50 border-gray-200',
  }[recommendation.action] || 'bg-gray-50 border-gray-200';

  return (
    <div className={`rounded-xl border p-4 ${bgColor}`}>
      <div className="text-lg font-semibold">{recommendation.label}</div>
      <div className="text-sm text-gray-600 mt-1">{recommendation.reason}</div>
    </div>
  );
}

function FunnelDiagnostic({ analysis }) {
  const { funnel, comparison, diagnosis, benchmark } = analysis;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">Funnel Diagnostic</h3>
        <span className={`text-sm ${diagnosis.health === 'healthy' ? 'text-green-600' : 'text-yellow-600'}`}>
          {diagnosis.label}
        </span>
      </div>

      <div className="space-y-3">
        <FunnelRow
          label="CTR"
          value={funnel.ctr.formatted}
          benchmark={benchmark.values.ctr ? `${(benchmark.values.ctr * 100).toFixed(2)}%` : '—'}
          comparison={comparison.ctr}
        />
        <FunnelRow
          label="ATC Rate"
          value={funnel.atc_rate.formatted}
          benchmark={benchmark.values.atc_rate ? `${(benchmark.values.atc_rate * 100).toFixed(2)}%` : '—'}
          comparison={comparison.atc_rate}
        />
        <FunnelRow
          label="IC Rate"
          value={funnel.ic_rate.formatted}
          benchmark={benchmark.values.ic_rate ? `${(benchmark.values.ic_rate * 100).toFixed(2)}%` : '—'}
          comparison={comparison.ic_rate}
        />
        <FunnelRow
          label="CVR"
          value={funnel.cvr.formatted}
          benchmark={benchmark.values.cvr ? `${(benchmark.values.cvr * 100).toFixed(2)}%` : '—'}
          comparison={comparison.cvr}
        />
        <FunnelRow
          label="CAC"
          value={funnel.cac.formatted}
          benchmark={benchmark.values.cac ? `${Math.round(benchmark.values.cac)} SAR` : '—'}
          comparison={comparison.cac}
        />
      </div>

      {diagnosis.detail && <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600">{diagnosis.detail}</div>}
    </div>
  );
}

function FunnelRow({ label, value, benchmark, comparison }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="flex items-center gap-4">
        <div className="text-sm font-medium text-gray-900">{value}</div>
        <div className="text-xs text-gray-400">vs {benchmark}</div>
        <div
          className={`text-xs font-medium ${
            comparison.status === 'good'
              ? 'text-green-600'
              : comparison.status === 'ok'
                ? 'text-gray-600'
                : comparison.status === 'below'
                  ? 'text-yellow-600'
                  : comparison.status === 'poor'
                    ? 'text-red-600'
                    : 'text-gray-400'
          }`}
        >
          {comparison.label}
        </div>
      </div>
    </div>
  );
}

function TestBudgetGuide({ testBudget }) {
  if (testBudget.phase === 'complete') {
    return (
      <div className="bg-green-50 rounded-xl border border-green-200 p-4">
        <div className="font-semibold text-green-800">✅ {testBudget.label}</div>
        <div className="text-sm text-green-600 mt-1">{testBudget.detail}</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">Test Budget Guide</h3>

      <div className="space-y-3">
        {testBudget.phases.map((phase, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg border ${
              phase.status === 'active'
                ? 'bg-blue-50 border-blue-200'
                : phase.status === 'complete'
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-gray-900">
                {phase.status === 'complete' && '✅ '}
                {phase.status === 'active' && '▶️ '}
                {phase.name}
              </div>
              {phase.daily_budget && <div className="text-sm font-medium text-gray-600">{phase.daily_budget} SAR/day</div>}
            </div>
            <div className="text-xs text-gray-500 mt-1">{phase.goal}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500">
        {testBudget.purchases_needed} more purchases needed • Est. {testBudget.estimated_spend_needed} SAR
      </div>
    </div>
  );
}

function BudgetOptimization({ optimization }) {
  if (optimization.error) {
    return (
      <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-4">
        <div className="text-yellow-800">{optimization.error}</div>
      </div>
    );
  }

  const currentPercent = (optimization.current_daily / optimization.saturation_daily) * 100;
  const optimalPercent = (optimization.optimal_daily / optimization.saturation_daily) * 100;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">Budget Optimization</h3>

      <div className="relative h-8 bg-gray-100 rounded-full mb-4">
        <div className="absolute right-0 top-0 bottom-0 bg-red-100 rounded-r-full" style={{ width: '20%' }} />

        <div className="absolute top-0 bottom-0 w-1 bg-green-500" style={{ left: `${optimalPercent}%` }} />

        <div
          className="absolute top-1 bottom-1 w-4 h-4 -ml-2 bg-blue-600 rounded-full border-2 border-white shadow"
          style={{ left: `${Math.min(currentPercent, 100)}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-gray-500 mb-4">
        <span>0</span>
        <span className="text-green-600">Optimal ({optimization.optimal_daily} SAR)</span>
        <span className="text-red-600">Saturation ({optimization.saturation_daily} SAR)</span>
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-lg font-bold text-gray-900">{optimization.current_daily} SAR</div>
          <div className="text-xs text-gray-500">Current daily</div>
        </div>
        <div>
          <div className="text-lg font-bold text-green-600">{optimization.optimal_daily} SAR</div>
          <div className="text-xs text-gray-500">Optimal (knee)</div>
        </div>
        <div>
          <div className="text-lg font-bold text-blue-600">{optimization.headroom_percent}%</div>
          <div className="text-xs text-gray-500">Room to grow</div>
        </div>
      </div>
    </div>
  );
}

function AdSetComparison({ campaignId, store }) {
  const [adSets, setAdSets] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [selectedA, setSelectedA] = useState(null);
  const [selectedB, setSelectedB] = useState(null);

  useEffect(() => {
    fetchAdSets();
  }, [campaignId]);

  const fetchAdSets = async () => {
    try {
      const res = await fetch(`${API_BASE}/ad-sets/${campaignId}?store=${store}`);
      const data = await res.json();
      if (data.success) setAdSets(data.adSets);
    } catch (err) {
      console.error('Failed to fetch ad sets:', err);
    }
  };

  const runComparison = async () => {
    if (!selectedA || !selectedB) return;

    const a = adSets.find((x) => x.adset_id === selectedA);
    const b = adSets.find((x) => x.adset_id === selectedB);

    try {
      const res = await fetch(`${API_BASE}/compare-adsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adSetA: { clicks: a.clicks, purchases: a.purchases },
          adSetB: { clicks: b.clicks, purchases: b.purchases },
        }),
      });
      const data = await res.json();
      if (data.success) setComparison(data.comparison);
    } catch (err) {
      console.error('Failed to compare:', err);
    }
  };

  if (adSets.length < 2) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">Ad Set Comparison (Bayesian)</h3>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Ad Set A</label>
          <select
            value={selectedA || ''}
            onChange={(e) => setSelectedA(e.target.value)}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="">Select...</option>
            {adSets.map((a) => (
              <option key={a.adset_id} value={a.adset_id}>
                {a.adset_name || a.adset_id} ({a.purchases} purchases)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Ad Set B</label>
          <select
            value={selectedB || ''}
            onChange={(e) => setSelectedB(e.target.value)}
            className="w-full p-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="">Select...</option>
            {adSets
              .filter((a) => a.adset_id !== selectedA)
              .map((a) => (
                <option key={a.adset_id} value={a.adset_id}>
                  {a.adset_name || a.adset_id} ({a.purchases} purchases)
                </option>
              ))}
          </select>
        </div>
      </div>

      <button
        onClick={runComparison}
        disabled={!selectedA || !selectedB}
        className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Compare
      </button>

      {comparison && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex h-8 rounded-full overflow-hidden mb-2">
            <div
              className="bg-blue-500 flex items-center justify-center text-white text-xs font-medium"
              style={{ width: `${comparison.probability_a_better}%` }}
            >
              A: {comparison.probability_a_better}%
            </div>
            <div
              className="bg-orange-500 flex items-center justify-center text-white text-xs font-medium"
              style={{ width: `${comparison.probability_b_better}%` }}
            >
              B: {comparison.probability_b_better}%
            </div>
          </div>

          <div className="text-center">
            <div className="font-medium text-gray-900">{comparison.verdict}</div>
            <div className="text-sm text-gray-500 mt-1">{comparison.recommendation}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({ confidence, benchmark }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-600">Analysis Confidence</span>
        <span
          className={`text-sm font-medium ${
            confidence.level === 'high'
              ? 'text-green-600'
              : confidence.level === 'medium'
                ? 'text-yellow-600'
                : 'text-red-600'
          }`}
        >
          {confidence.label}
        </span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full">
        <div
          className={`h-full rounded-full ${
            confidence.level === 'high'
              ? 'bg-green-500'
              : confidence.level === 'medium'
                ? 'bg-yellow-500'
                : 'bg-red-500'
          }`}
          style={{ width: `${confidence.percent}%` }}
        />
      </div>
      <div className="text-xs text-gray-400 mt-2">
        Benchmark source: {benchmark.source} ({benchmark.weight}% learned from {benchmark.campaigns_learned} campaigns)
      </div>
    </div>
  );
}

function GeoTab({ geos }) {
  const total = geos.reduce((sum, g) => sum + g.total_spend, 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h2 className="font-semibold text-gray-900 mb-4">Geo Comparison</h2>

      <table className="w-full">
        <thead>
          <tr className="text-xs text-gray-500 border-b border-gray-100">
            <th className="text-left py-2">Geo</th>
            <th className="text-right py-2">Spend</th>
            <th className="text-right py-2">%</th>
            <th className="text-right py-2">Purchases</th>
            <th className="text-right py-2">CAC</th>
            <th className="text-right py-2">ROAS</th>
            <th className="text-right py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {geos.map((g) => (
            <tr key={g.geo} className="border-b border-gray-50">
              <td className="py-3 font-medium">{g.geo}</td>
              <td className="py-3 text-right">{g.total_spend.toLocaleString()} SAR</td>
              <td className="py-3 text-right text-gray-500">{Math.round((g.total_spend / total) * 100)}%</td>
              <td className="py-3 text-right">{g.total_purchases}</td>
              <td className="py-3 text-right">{g.cac ? `${g.cac} SAR` : '—'}</td>
              <td className="py-3 text-right">{g.roas}x</td>
              <td className="py-3 text-right">
                <span className={`px-2 py-1 text-xs rounded ${
                  g.status === 'established' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                }`}>
                  {g.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {geos.length === 0 && <p className="text-gray-400 text-sm text-center py-8">No geo data available</p>}
    </div>
  );
}

function AlertsTab({ alerts }) {
  const severityColor = {
    critical: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  return (
    <div className="space-y-4">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`rounded-xl border p-4 ${severityColor[alert.severity] || severityColor.info}`}
        >
          <div className="flex items-center justify-between">
            <div className="font-medium">{alert.title}</div>
            <div className="text-xs opacity-60">{new Date(alert.created_at).toLocaleDateString()}</div>
          </div>
          <div className="text-sm mt-1 opacity-80">{alert.message}</div>
        </div>
      ))}

      {alerts.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <p className="text-gray-400">No alerts yet</p>
        </div>
      )}
    </div>
  );
}
