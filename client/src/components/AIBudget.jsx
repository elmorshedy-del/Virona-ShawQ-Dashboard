// ============================================================================
// AIBudget.jsx - FRONTEND COMPONENT (FIXED)
// Place in: client/src/components/AIBudget.jsx
// Purpose: What-If Budget Simulator with Hill curves, adstock, confidence scoring
// ============================================================================
// IMPORTS: Only React + lucide-react (NO backend imports)
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  RefreshCw,
  Upload,
  Download,
  ChevronDown,
  AlertCircle,
  TrendingUp,
  Info,
  Lock
} from 'lucide-react';

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const CURRENCY = {
  vironax: { symbol: 'SAR', name: 'Saudi Riyal' },
  shawq: { symbol: 'USD', name: 'US Dollar' }
};

const STRUCTURES = [
  { id: 'ABO', label: 'ABO', desc: 'Ad Set Budget Optimization' },
  { id: 'CBO', label: 'CBO', desc: 'Campaign Budget Optimization' },
  { id: 'ASC', label: 'ASC', desc: 'Advantage+ Shopping' }
];

const DATA_SOURCES = [
  { id: 'platform', label: '✅ Platform Data' },
  { id: 'override', label: '📤 CSV Override' },
  { id: 'complement', label: '➕ CSV Complement' }
];

const LOOKBACKS = [
  { id: '7d', label: '7 Days', days: 7 },
  { id: '14d', label: '14 Days', days: 14 },
  { id: '30d', label: '30 Days', days: 30 },
  { id: 'all', label: 'All Data', days: 9999 }
];

const HORIZONS = [
  { id: 7, label: '7 Days' },
  { id: 14, label: '14 Days' },
  { id: 30, label: '30 Days' }
];

// ============================================================================
// MATH ENGINE (Hill saturation + adstock)
// ============================================================================

function hillSaturation(spend, halfSat, slope = 2) {
  if (spend <= 0 || halfSat <= 0) return 0;
  const spendN = Math.pow(spend, slope);
  const halfSatN = Math.pow(halfSat, slope);
  return spendN / (spendN + halfSatN);
}

function applyAdstock(spendArray, decay = 0.7) {
  if (!spendArray || spendArray.length === 0) return [];
  const adstocked = [spendArray[0]];
  for (let i = 1; i < spendArray.length; i++) {
    adstocked[i] = spendArray[i] + decay * adstocked[i - 1];
  }
  return adstocked;
}

function estimateHillParams(data) {
  if (!data || data.length === 0) {
    return { halfSat: 500, maxResponse: 1000, slope: 2 };
  }
  
  const spends = data.map(d => d.spend).filter(s => s > 0);
  const revenues = data.map(d => d.revenue).filter(r => r > 0);
  
  if (spends.length === 0 || revenues.length === 0) {
    return { halfSat: 500, maxResponse: 1000, slope: 2 };
  }
  
  const avgSpend = spends.reduce((a, b) => a + b, 0) / spends.length;
  const sortedRevenues = [...revenues].sort((a, b) => b - a);
  const topQuartile = sortedRevenues.slice(0, Math.ceil(sortedRevenues.length / 4));
  const topAvg = topQuartile.reduce((a, b) => a + b, 0) / topQuartile.length;
  
  return {
    halfSat: avgSpend * 1.5,
    maxResponse: topAvg * 1.2,
    slope: 2
  };
}

function predictRevenue(budget, params) {
  const saturation = hillSaturation(budget, params.halfSat, params.slope);
  const predicted = params.maxResponse * saturation;
  const variance = 0.2;
  
  return {
    predicted: Math.round(predicted * 100) / 100,
    p10: Math.round(predicted * (1 - variance) * 100) / 100,
    p90: Math.round(predicted * (1 + variance) * 100) / 100
  };
}

function calculateConfidence(dataHealth, dataPoints, dataSource) {
  let score = 0;
  
  if (dataPoints >= 30) score += 2;
  else if (dataPoints >= 14) score += 1;
  
  if (dataHealth?.coreFieldsComplete) score += 2;
  if (dataHealth?.extendedFields >= 3) score += 1;
  
  if (dataSource !== 'platform') score -= 1;
  
  if (score >= 4) return 'High';
  if (score >= 2) return 'Medium';
  return 'Low';
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AIBudget({ store }) {
  // State
  const [structure, setStructure] = useState(null);
  const [dataSource, setDataSource] = useState('platform');
  const [lookback, setLookback] = useState('14d');
  const [horizon, setHorizon] = useState(7);
  const [budget, setBudget] = useState(500);
  
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [adsets, setAdsets] = useState([]);
  const [selectedAdset, setSelectedAdset] = useState(null);
  const [aboScope, setAboScope] = useState('all');
  
  const [timeseries, setTimeseries] = useState([]);
  const [dataHealth, setDataHealth] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  
  const [prediction, setPrediction] = useState(null);
  
  const currency = CURRENCY[store] || CURRENCY.vironax;

  // Format currency helper
  const formatCurrency = (val) => {
    return `${currency.symbol} ${Number(val).toLocaleString()}`;
  };

  // ---------------------------------------------------------------------------
  // DATA FETCHING
  // ---------------------------------------------------------------------------
  
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatif/status/${store}`);
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data);
        setDataHealth(data.health);
      }
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    }
  }, [store]);
  
  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatif/campaigns/${store}`);
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.campaigns || []);
        if (data.campaigns?.length > 0) {
          setSelectedCampaign(data.campaigns[0]);
        }
      } else {
        setError('Failed to load campaigns');
      }
    } catch (err) {
      setError('Failed to load campaigns');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [store]);
  
  const fetchAdsets = useCallback(async (campaignId) => {
    if (!campaignId) return;
    try {
      const res = await fetch(`/api/whatif/adsets/${store}/${campaignId}`);
      if (res.ok) {
        const data = await res.json();
        setAdsets(data.adsets || []);
        if (data.adsets?.length > 0) {
          setSelectedAdset(data.adsets[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch adsets:', err);
    }
  }, [store]);
  
  const fetchTimeseries = useCallback(async () => {
    if (!selectedCampaign?.campaign_id) return;
    
    try {
      const params = new URLSearchParams({ lookback });
      if (structure === 'ABO' && aboScope === 'single' && selectedAdset?.adset_id) {
        params.append('adsetId', selectedAdset.adset_id);
      }
      
      const res = await fetch(
        `/api/whatif/smart-data/${store}/${selectedCampaign.campaign_id}?${params}`
      );
      if (res.ok) {
        const data = await res.json();
        setTimeseries(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch timeseries:', err);
    }
  }, [store, selectedCampaign, selectedAdset, structure, aboScope, lookback]);

  // ---------------------------------------------------------------------------
  // EFFECTS
  // ---------------------------------------------------------------------------
  
  useEffect(() => {
    fetchSyncStatus();
    fetchCampaigns();
  }, [fetchSyncStatus, fetchCampaigns]);
  
  useEffect(() => {
    if (selectedCampaign?.campaign_id) {
      fetchAdsets(selectedCampaign.campaign_id);
      fetchTimeseries();
    }
  }, [selectedCampaign, fetchAdsets, fetchTimeseries]);
  
  useEffect(() => {
    fetchTimeseries();
  }, [lookback, structure, aboScope, selectedAdset, fetchTimeseries]);

  // ---------------------------------------------------------------------------
  // PREDICTION CALCULATION
  // ---------------------------------------------------------------------------
  
  useEffect(() => {
    if (!structure || timeseries.length === 0) {
      setPrediction(null);
      return;
    }
    
    const modelData = timeseries.map(d => ({
      spend: d.spend || 0,
      revenue: d.revenue || 0,
      purchases: d.purchases || 0
    })).filter(d => d.spend > 0);
    
    if (modelData.length < 3) {
      setPrediction({ locked: true, reason: 'Need at least 3 days with spend data' });
      return;
    }
    
    const params = estimateHillParams(modelData);
    const rev = predictRevenue(budget, params);
    const roas = budget > 0 ? rev.predicted / budget : 0;
    const confidence = calculateConfidence(dataHealth, timeseries.length, dataSource);
    
    setPrediction({
      locked: false,
      avgDailyRevenue: rev.predicted,
      p10: rev.p10,
      p90: rev.p90,
      roas: Math.round(roas * 100) / 100,
      horizonRevenue: Math.round(rev.predicted * horizon),
      horizonSpend: budget * horizon,
      confidence
    });
  }, [structure, timeseries, budget, horizon, dataHealth, dataSource]);

  // ---------------------------------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------------------------------
  
  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatif/sync/${store}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullSync: false })
      });
      const data = await res.json();
      
      if (data.success) {
        await fetchSyncStatus();
        await fetchCampaigns();
      } else {
        setError(data.error || 'Sync failed');
      }
    } catch (err) {
      setError('Sync failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };
  
  const handleCampaignChange = (e) => {
    const campaign = campaigns.find(c => c.campaign_id === e.target.value);
    setSelectedCampaign(campaign);
  };
  
  const handleAdsetChange = (e) => {
    const adset = adsets.find(a => a.adset_id === e.target.value);
    setSelectedAdset(adset);
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setCsvFile(file);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', dataSource === 'override' ? 'override' : 'complement');
    if (selectedCampaign?.campaign_id) {
      formData.append('campaignId', selectedCampaign.campaign_id);
    }
    
    try {
      const res = await fetch(`/api/whatif/upload-csv/${store}`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      
      if (data.success) {
        await fetchTimeseries();
      } else {
        setError(data.error || 'CSV upload failed');
      }
    } catch (err) {
      setError('CSV upload failed: ' + err.message);
    }
  };

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  
  return (
    <div className="space-y-6">
      
      {/* HEADER */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
              <Brain size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">What-If Budget Simulator</h1>
              <p className="text-sm text-slate-500">
                {store === 'vironax' ? 'VironaX' : 'Shawq'} • {currency.symbol}
              </p>
            </div>
          </div>
          
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 transition-colors"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Refresh Data'}
          </button>
        </div>
        
        {syncStatus && (
          <div className="mt-4 pt-4 border-t border-slate-100 text-sm text-slate-500">
            Last sync: {syncStatus.last_sync ? new Date(syncStatus.last_sync).toLocaleString() : 'Never'} • {syncStatus.campaigns || 0} campaigns • {syncStatus.total_rows || 0} data points
          </div>
        )}
        
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
            <AlertCircle size={16} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto font-bold">×</button>
          </div>
        )}
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Data Source */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">📦 Data Source</h2>
              <span className="px-2 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-full">
                {dataHealth?.overallHealth || 'Good'}
              </span>
            </div>
            
            <div className="flex flex-wrap gap-2 mb-4">
              {DATA_SOURCES.map(ds => (
                <button
                  key={ds.id}
                  onClick={() => setDataSource(ds.id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                    dataSource === ds.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {ds.label}
                </button>
              ))}
            </div>
            
            {dataSource !== 'platform' && (
              <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <label className="flex items-center gap-3 cursor-pointer">
                  <Upload size={20} className="text-indigo-600" />
                  <span className="text-sm font-medium text-slate-700">
                    {csvFile ? csvFile.name : 'Upload CSV File'}
                  </span>
                  <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                </label>
              </div>
            )}
            
            {/* Data Health */}
            <div className="mt-4 bg-slate-50 rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold text-slate-600 uppercase mb-3">Data Health</div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className="text-xs text-slate-500">Coverage Days</div>
                  <div className="font-semibold">{dataHealth?.coverage_days || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Spend Days</div>
                  <div className="font-semibold">{dataHealth?.spend_days || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Core Fields</div>
                  <div className="font-semibold">{dataHealth?.coreFieldsScore || '3/3'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Extended Fields</div>
                  <div className="font-semibold">{dataHealth?.extendedFieldsScore || '4/4'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Campaign Selection */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-4">📌 Select Campaign</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Campaign</label>
                <select
                  value={selectedCampaign?.campaign_id || ''}
                  onChange={handleCampaignChange}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {campaigns.map(c => (
                    <option key={c.campaign_id} value={c.campaign_id}>
                      {c.campaign_name} ({c.data_days}d, ROAS: {c.roas?.toFixed(2) || '—'})
                    </option>
                  ))}
                </select>
              </div>
              
              {selectedCampaign && (
                <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl">
                  <div className="text-center">
                    <div className="text-xs text-slate-500">Total Spend</div>
                    <div className="font-bold text-slate-900">{formatCurrency(selectedCampaign.total_spend || 0)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-slate-500">Total Revenue</div>
                    <div className="font-bold text-slate-900">{formatCurrency(selectedCampaign.total_revenue || 0)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-slate-500">ROAS</div>
                    <div className="font-bold text-indigo-600">{selectedCampaign.roas?.toFixed(2) || '—'}x</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Budget Logic - MOVED HERE */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-bold text-slate-900">⚙️ Budget Logic</h2>
              <span className="px-2 py-0.5 text-xs font-semibold bg-rose-100 text-rose-700 rounded-full">
                Required
              </span>
            </div>
            <p className="text-sm text-slate-500 mb-4">Select how budget is distributed in this campaign</p>
            
            <div className="flex flex-wrap gap-2">
              {STRUCTURES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setStructure(s.id)}
                  className={`px-5 py-3 rounded-xl text-sm font-semibold border-2 transition-all ${
                    structure === s.id
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-400'
                  }`}
                >
                  {s.label}
                  <span className="block text-xs font-normal opacity-75">{s.desc}</span>
                </button>
              ))}
            </div>
            
            {/* ABO Scope (only when ABO selected) */}
            {structure === 'ABO' && adsets.length > 0 && (
              <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-sm font-medium text-slate-700 mb-2">ABO Scope</div>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setAboScope('all')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                      aboScope === 'all'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    All Ad Sets
                  </button>
                  <button
                    onClick={() => setAboScope('single')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                      aboScope === 'single'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    Single Ad Set
                  </button>
                </div>
                
                {aboScope === 'single' && (
                  <select
                    value={selectedAdset?.adset_id || ''}
                    onChange={handleAdsetChange}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  >
                    {adsets.map(a => (
                      <option key={a.adset_id} value={a.adset_id}>
                        {a.adset_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Lookback & Horizon */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-3">Training Window (Lookback)</div>
                <div className="flex flex-wrap gap-2">
                  {LOOKBACKS.map(lb => (
                    <button
                      key={lb.id}
                      onClick={() => setLookback(lb.id)}
                      className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                        lookback === lb.id
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {lb.label}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-3">Prediction Horizon</div>
                <div className="flex flex-wrap gap-2">
                  {HORIZONS.map(h => (
                    <button
                      key={h.id}
                      onClick={() => setHorizon(h.id)}
                      className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                        horizon === h.id
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Budget Slider */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 relative">
            {!structure && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
                <div className="text-center p-4">
                  <Lock size={24} className="mx-auto mb-2 text-slate-400" />
                  <div className="font-semibold text-slate-600">Select Budget Logic above</div>
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">💰 Daily Budget</h2>
              <div className="text-2xl font-bold text-indigo-600">{formatCurrency(budget)}</div>
            </div>
            
            <input
              type="range"
              min="50"
              max="5000"
              step="50"
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              disabled={!structure}
            />
            
            <div className="flex justify-between text-xs text-slate-500 mt-2">
              <span>{formatCurrency(50)}</span>
              <span>{formatCurrency(5000)}</span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - Predictions */}
        <div className="space-y-6">
          
          {/* Prediction Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={20} className="text-indigo-600" />
              <h2 className="text-lg font-bold text-slate-900">Predictions</h2>
            </div>
            
            {!structure ? (
              <div className="text-center py-8">
                <Lock size={32} className="mx-auto mb-3 text-slate-300" />
                <p className="text-slate-500 font-medium">Select Budget Logic to unlock</p>
                <p className="text-sm text-slate-400 mt-1">Choose ABO, CBO, or ASC</p>
              </div>
            ) : prediction?.locked ? (
              <div className="text-center py-8">
                <AlertCircle size={32} className="mx-auto mb-3 text-amber-400" />
                <p className="text-slate-600 font-medium">{prediction.reason}</p>
              </div>
            ) : prediction ? (
              <div className="space-y-4">
                <div className="p-4 bg-indigo-50 rounded-xl">
                  <div className="text-xs text-indigo-600 font-semibold uppercase">Expected Daily Revenue</div>
                  <div className="text-3xl font-bold text-indigo-700">{formatCurrency(prediction.avgDailyRevenue)}</div>
                  <div className="text-sm text-indigo-500 mt-1">
                    Range: {formatCurrency(prediction.p10)} - {formatCurrency(prediction.p90)}
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-slate-50 rounded-xl text-center">
                    <div className="text-xs text-slate-500">ROAS</div>
                    <div className="text-xl font-bold text-slate-900">{prediction.roas}x</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl text-center">
                    <div className="text-xs text-slate-500">Confidence</div>
                    <div className={`text-xl font-bold ${
                      prediction.confidence === 'High' ? 'text-emerald-600' :
                      prediction.confidence === 'Medium' ? 'text-amber-600' : 'text-red-500'
                    }`}>
                      {prediction.confidence}
                    </div>
                  </div>
                </div>
                
                <div className="p-4 bg-slate-50 rounded-xl">
                  <div className="text-xs text-slate-500 font-semibold uppercase mb-2">{horizon}-Day Projection</div>
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-sm text-slate-600">Total Spend</div>
                      <div className="font-bold">{formatCurrency(prediction.horizonSpend)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-600">Expected Revenue</div>
                      <div className="font-bold text-emerald-600">{formatCurrency(prediction.horizonRevenue)}</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                Loading predictions...
              </div>
            )}
          </div>

          {/* Model Assumptions */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="font-semibold text-slate-900 mb-4">🧪 Model Assumptions</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Structure</span>
                <span className="font-medium">{structure || 'Not selected'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lookback Window</span>
                <span className="font-medium">{LOOKBACKS.find(l => l.id === lookback)?.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Data Points</span>
                <span className="font-medium">{timeseries.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Data Source</span>
                <span className="font-medium">{DATA_SOURCES.find(d => d.id === dataSource)?.label}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
