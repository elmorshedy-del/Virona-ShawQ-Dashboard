// ============================================================================
// AIBudget.jsx - FRONTEND COMPONENT
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
  CheckCircle,
  TrendingUp,
  DollarSign,
  Target,
  Zap,
  Info,
  Lock,
  Unlock
} from 'lucide-react';

// ============================================================================
// CONSTANTS & CONFIG
// ============================================================================

const CURRENCY = {
  vironax: { symbol: 'SAR', name: 'Saudi Riyal' },
  shawq: { symbol: 'USD', name: 'US Dollar' }
};

const MODES = {
  existing: { id: 'existing', label: '📌 Existing Campaign', desc: 'Analyze active campaign' },
  planned: { id: 'planned', label: '✨ Planned Campaign', desc: 'Model a new campaign' }
};

const STRUCTURES = {
  ABO: { id: 'ABO', label: '🧩 ABO', desc: 'Ad Set Budget Optimization' },
  CBO: { id: 'CBO', label: '🧠 CBO', desc: 'Campaign Budget Optimization' },
  ASC: { id: 'ASC', label: '✨ ASC', desc: 'Advantage+ Shopping' }
};

const DATA_SOURCES = {
  platform: { id: 'platform', label: '✅ Platform Data', desc: 'Use synced Meta data' },
  override: { id: 'override', label: '⬆️ CSV Override', desc: 'Replace with CSV' },
  complement: { id: 'complement', label: '➕ CSV Complement', desc: 'Merge with CSV' }
};

const LOOKBACKS = {
  '7d': { id: '7d', label: '7 Days', days: 7 },
  '14d': { id: '14d', label: '14 Days', days: 14 },
  '30d': { id: '30d', label: '30 Days', days: 30 },
  'all': { id: 'all', label: 'All Data', days: 9999 }
};

const HORIZONS = [
  { id: 7, label: '7 Days' },
  { id: 14, label: '14 Days' },
  { id: 30, label: '30 Days' }
];

// ============================================================================
// MATH ENGINE (from blueprint - Hill saturation + adstock)
// ============================================================================

/**
 * Hill saturation function
 * Models diminishing returns as spend increases
 * @param {number} spend - Daily spend
 * @param {number} halfSat - Spend level at 50% max response (K)
 * @param {number} slope - Steepness of curve (n)
 * @returns {number} Saturation factor (0 to 1)
 */
function hillSaturation(spend, halfSat, slope = 2) {
  if (spend <= 0 || halfSat <= 0) return 0;
  const spendN = Math.pow(spend, slope);
  const halfSatN = Math.pow(halfSat, slope);
  return spendN / (spendN + halfSatN);
}

/**
 * Adstock carryover effect
 * Models how ad effects decay over time
 * @param {Array} spendArray - Array of daily spends
 * @param {number} decay - Decay rate (0 to 1, e.g., 0.7)
 * @returns {Array} Array of adstocked values
 */
function adstockTransform(spendArray, decay = 0.7) {
  if (!spendArray || spendArray.length === 0) return [];
  
  const adstocked = [spendArray[0]];
  for (let i = 1; i < spendArray.length; i++) {
    adstocked[i] = spendArray[i] + decay * adstocked[i - 1];
  }
  return adstocked;
}

/**
 * Estimate Hill parameters from historical data
 * Uses heuristic approach (not full Bayesian)
 * @param {Array} data - Array of {spend, revenue} objects
 * @returns {Object} {halfSat, slope, maxResponse}
 */
function estimateHillParams(data) {
  if (!data || data.length < 3) {
    return { halfSat: 100, slope: 2, maxResponse: 500, confidence: 'Low' };
  }
  
  // Sort by spend
  const sorted = [...data].sort((a, b) => a.spend - b.spend);
  
  // Get spend range
  const minSpend = sorted[0].spend;
  const maxSpend = sorted[sorted.length - 1].spend;
  const avgSpend = data.reduce((s, d) => s + d.spend, 0) / data.length;
  
  // Estimate half-saturation as ~1.5x average spend
  const halfSat = avgSpend * 1.5;
  
  // Estimate max response from top performers
  const topQuartile = sorted.slice(Math.floor(sorted.length * 0.75));
  const maxResponse = topQuartile.reduce((s, d) => s + d.revenue, 0) / topQuartile.length * 1.2;
  
  // Slope estimation based on data variance
  const slope = 2; // Default, could be refined with more data
  
  // Confidence based on data quality
  let confidence = 'Low';
  if (data.length >= 14 && maxSpend > minSpend * 2) {
    confidence = 'High';
  } else if (data.length >= 7) {
    confidence = 'Medium';
  }
  
  return { halfSat, slope, maxResponse, confidence };
}

/**
 * Predict revenue for a given budget using Hill model
 * @param {number} budget - Daily budget
 * @param {Object} params - Hill parameters
 * @returns {Object} {predicted, p10, p90}
 */
function predictRevenue(budget, params) {
  const { halfSat, slope, maxResponse } = params;
  
  const saturation = hillSaturation(budget, halfSat, slope);
  const predicted = maxResponse * saturation;
  
  // Confidence intervals (rough approximation)
  const variance = params.confidence === 'High' ? 0.15 :
                   params.confidence === 'Medium' ? 0.25 : 0.4;
  
  const p10 = predicted * (1 - variance);
  const p90 = predicted * (1 + variance);
  
  return {
    predicted: Math.round(predicted * 100) / 100,
    p10: Math.round(p10 * 100) / 100,
    p90: Math.round(p90 * 100) / 100
  };
}

/**
 * Calculate confidence score
 * @param {Object} dataHealth - Data health metrics
 * @param {number} dataPoints - Number of data points
 * @param {string} dataSource - 'platform', 'override', 'complement'
 * @returns {string} 'High', 'Medium', or 'Low'
 */
function calculateConfidence(dataHealth, dataPoints, dataSource) {
  let score = 0;
  
  // Data points scoring
  if (dataPoints >= 30) score += 3;
  else if (dataPoints >= 14) score += 2;
  else if (dataPoints >= 7) score += 1;
  
  // Core fields scoring
  if (dataHealth?.coreFieldsComplete) score += 2;
  
  // Extended fields scoring
  const extScore = parseInt(dataHealth?.extendedFieldsScore?.split('/')[0] || '0');
  if (extScore >= 3) score += 1;
  
  // CSV override penalty
  if (dataSource === 'override') score -= 1;
  
  // Return confidence level
  if (score >= 5) return 'High';
  if (score >= 3) return 'Medium';
  return 'Low';
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AIBudget({ store }) {
  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------
  
  const [mode, setMode] = useState('existing');
  const [structure, setStructure] = useState(null);
  const [dataSource, setDataSource] = useState('platform');
  const [lookback, setLookback] = useState('14d');
  const [horizon, setHorizon] = useState(7);
  const [budget, setBudget] = useState(500);
  
  // Campaign & Ad Set selection
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [adsets, setAdsets] = useState([]);
  const [selectedAdset, setSelectedAdset] = useState(null);
  const [aboScope, setAboScope] = useState('all'); // 'all' or 'single'
  
  // Data state
  const [timeseries, setTimeseries] = useState([]);
  const [dataHealth, setDataHealth] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [resolvedLookback, setResolvedLookback] = useState(null);
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  
  // Prediction results
  const [prediction, setPrediction] = useState(null);
  
  const currency = CURRENCY[store] || CURRENCY.vironax;
  
  // ---------------------------------------------------------------------------
  // DATA FETCHING
  // ---------------------------------------------------------------------------
  
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatif/status/${store}`);
      const data = await res.json();
      setSyncStatus(data);
      setDataHealth(data.health);
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    }
  }, [store]);
  
  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatif/campaigns/${store}`);
      const data = await res.json();
      setCampaigns(data.campaigns || []);
      if (data.campaigns?.length > 0) {
        setSelectedCampaign(data.campaigns[0]);
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
      const data = await res.json();
      setAdsets(data.adsets || []);
      if (data.adsets?.length > 0) {
        setSelectedAdset(data.adsets[0]);
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
      const data = await res.json();
      
      setTimeseries(data.data || []);
      setResolvedLookback(data.resolvedLookback);
      
      // Update data health for this campaign
      const healthRes = await fetch(
        `/api/whatif/health/${store}?campaignId=${selectedCampaign.campaign_id}`
      );
      const healthData = await healthRes.json();
      setDataHealth(healthData);
      
    } catch (err) {
      console.error('Failed to fetch timeseries:', err);
    }
  }, [store, selectedCampaign, selectedAdset, structure, aboScope, lookback]);
  
  // ---------------------------------------------------------------------------
  // SYNC HANDLER
  // ---------------------------------------------------------------------------
  
  const handleSync = async (fullSync = false) => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch(`/api/whatif/sync/${store}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullSync })
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
  
  // ---------------------------------------------------------------------------
  // CSV UPLOAD HANDLER
  // ---------------------------------------------------------------------------
  
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
  // PREDICTION CALCULATION
  // ---------------------------------------------------------------------------
  
  useEffect(() => {
    if (!structure || timeseries.length === 0) {
      setPrediction(null);
      return;
    }
    
    // Prepare data for modeling
    const modelData = timeseries.map(d => ({
      spend: d.spend || 0,
      revenue: d.revenue || 0,
      purchases: d.purchases || 0
    })).filter(d => d.spend > 0);
    
    if (modelData.length < 3) {
      setPrediction({
        locked: true,
        reason: 'Insufficient data (need at least 3 days with spend)'
      });
      return;
    }
    
    // Estimate parameters
    const params = estimateHillParams(modelData);
    
    // Calculate prediction
    const rev = predictRevenue(budget, params);
    const roas = budget > 0 ? rev.predicted / budget : 0;
    
    // Calculate confidence
    const confidence = calculateConfidence(
      dataHealth,
      timeseries.length,
      dataSource
    );
    
    setPrediction({
      locked: false,
      avgDailyRevenue: rev.predicted,
      p10: rev.p10,
      p90: rev.p90,
      roas: Math.round(roas * 100) / 100,
      confidence,
      params,
      horizon,
      totalRevenue: rev.predicted * horizon,
      totalSpend: budget * horizon
    });
    
  }, [structure, timeseries, budget, horizon, dataHealth, dataSource]);
  
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
  }, [lookback, fetchTimeseries]);
  
  // ---------------------------------------------------------------------------
  // RENDER HELPERS
  // ---------------------------------------------------------------------------
  
  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '—';
    return `${currency.symbol} ${value.toLocaleString('en-US', { 
      minimumFractionDigits: 0,
      maximumFractionDigits: 0 
    })}`;
  };
  
  const ConfidenceBadge = ({ level }) => {
    const colors = {
      High: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      Medium: 'bg-amber-50 text-amber-700 border-amber-200',
      Low: 'bg-rose-50 text-rose-700 border-rose-200',
      Locked: 'bg-slate-100 text-slate-500 border-slate-200'
    };
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${colors[level] || colors.Locked}`}>
        {level}
      </span>
    );
  };
  
  const Pill = ({ active, onClick, children, disabled }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold
        transition-all duration-150 border
        ${active 
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200' 
          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {children}
    </button>
  );
  
  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  
  return (
    <div className="space-y-6">
      
      {/* ================================================================
          HEADER
      ================================================================= */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white grid place-items-center text-2xl">
              <Brain size={24} />
            </div>
            <div>
              <div className="text-xs font-semibold tracking-widest text-indigo-600">
                WHAT-IF SIMULATOR
              </div>
              <h1 className="text-2xl font-extrabold text-slate-900">
                Budget Impact Analysis
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                {store === 'vironax' ? 'VironaX' : 'Shawq'} • {currency.name} ({currency.symbol})
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleSync(false)}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Refresh Data'}
            </button>
            <ConfidenceBadge level={prediction?.confidence || 'Locked'} />
          </div>
        </div>
        
        {/* Sync Status */}
        {syncStatus && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-4 text-sm text-slate-500">
            <span>Last sync: {syncStatus.last_sync ? new Date(syncStatus.last_sync).toLocaleString() : 'Never'}</span>
            <span>•</span>
            <span>{syncStatus.campaigns || 0} campaigns</span>
            <span>•</span>
            <span>{syncStatus.total_rows || 0} data points</span>
          </div>
        )}
        
        {/* Error Display */}
        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-rose-700 text-sm">
            <AlertCircle size={16} />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-rose-500 hover:text-rose-700">×</button>
          </div>
        )}
        
        {/* Mode Toggle */}
        <div className="mt-6">
          <div className="text-sm font-semibold text-slate-700 mb-2">Mode</div>
          <div className="flex flex-wrap gap-2">
            {Object.values(MODES).map(m => (
              <Pill key={m.id} active={mode === m.id} onClick={() => setMode(m.id)}>
                {m.label}
              </Pill>
            ))}
          </div>
        </div>
        
        {/* Structure Toggle (Required) */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-sm font-semibold text-slate-700">Budget Logic</div>
            <span className="px-2 py-0.5 text-xs font-semibold bg-rose-100 text-rose-700 rounded-full border border-rose-200">
              Required
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Select how budget is distributed in this campaign
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.values(STRUCTURES).map(s => (
              <Pill key={s.id} active={structure === s.id} onClick={() => setStructure(s.id)}>
                {s.label}
              </Pill>
            ))}
          </div>
        </div>
      </div>
      
      {/* ================================================================
          MAIN GRID
      ================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* ============================================================
            LEFT COLUMN - Inputs
        ============================================================= */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Data Source */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-lg font-bold text-slate-900">📦 Data Source</div>
                <div className="text-sm text-slate-500">Platform-first with CSV options</div>
              </div>
              <span className="px-2 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
                {dataHealth?.overallHealth || 'Loading...'}
              </span>
            </div>
            
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.values(DATA_SOURCES).map(ds => (
                <Pill key={ds.id} active={dataSource === ds.id} onClick={() => setDataSource(ds.id)}>
                  {ds.label}
                </Pill>
              ))}
            </div>
            
            {/* CSV Upload (when override or complement selected) */}
            {dataSource !== 'platform' && (
              <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 grid place-items-center">
                    <Upload size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-700">
                      {csvFile ? csvFile.name : 'Upload CSV File'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {dataSource === 'override' ? 'Will replace platform data' : 'Will merge with platform data'}
                    </div>
                  </div>
                  <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
                </label>
                <a
                  href="/api/whatif/csv-template"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                >
                  <Download size={12} /> Download template
                </a>
              </div>
            )}
            
            {/* Data Health Readout */}
            <div className="mt-4 bg-slate-50 rounded-xl border border-slate-200 p-4">
              <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
                Data Health
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs text-slate-500">Coverage Days</div>
                  <div className="font-semibold text-slate-900">{dataHealth?.coverage_days || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Spend Days</div>
                  <div className="font-semibold text-slate-900">{dataHealth?.spend_days || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Core Fields</div>
                  <div className="font-semibold text-slate-900">{dataHealth?.coreFieldsScore || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Extended Fields</div>
                  <div className="font-semibold text-slate-900">{dataHealth?.extendedFieldsScore || '—'}</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Campaign Selection (Existing Mode) */}
          {mode === 'existing' && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="text-lg font-bold text-slate-900 mb-4">📌 Select Campaign</div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Campaign</label>
                  <div className="relative">
                    <select
                      value={selectedCampaign?.campaign_id || ''}
                      onChange={(e) => {
                        const camp = campaigns.find(c => c.campaign_id === e.target.value);
                        setSelectedCampaign(camp);
                      }}
                      className="w-full px-4 py-2 pr-10 border border-slate-200 rounded-lg text-sm appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {campaigns.map(c => (
                        <option key={c.campaign_id} value={c.campaign_id}>
                          {c.campaign_name} ({c.days_with_data}d, ROAS: {c.roas || '—'})
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                
                {/* ABO Single Ad Set Selection */}
                {structure === 'ABO' && (
                  <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                    <div className="text-sm font-semibold text-indigo-900 mb-2">ABO Scope</div>
                    <div className="flex gap-2 mb-3">
                      <Pill active={aboScope === 'all'} onClick={() => setAboScope('all')}>
                        All Ad Sets
                      </Pill>
                      <Pill active={aboScope === 'single'} onClick={() => setAboScope('single')}>
                        Single Ad Set
                      </Pill>
                    </div>
                    
                    {aboScope === 'single' && adsets.length > 0 && (
                      <div className="relative">
                        <select
                          value={selectedAdset?.adset_id || ''}
                          onChange={(e) => {
                            const adset = adsets.find(a => a.adset_id === e.target.value);
                            setSelectedAdset(adset);
                          }}
                          className="w-full px-4 py-2 pr-10 border border-indigo-200 rounded-lg text-sm appearance-none bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {adsets.map(a => (
                            <option key={a.adset_id} value={a.adset_id}>
                              {a.adset_name} (ROAS: {a.roas || '—'})
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" />
                      </div>
                    )}
                  </div>
                )}
                
                {/* Campaign Stats */}
                {selectedCampaign && (
                  <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100">
                    <div className="text-center p-3 bg-slate-50 rounded-lg">
                      <div className="text-xs text-slate-500">Total Spend</div>
                      <div className="font-bold text-slate-900">{formatCurrency(selectedCampaign.total_spend)}</div>
                    </div>
                    <div className="text-center p-3 bg-slate-50 rounded-lg">
                      <div className="text-xs text-slate-500">Total Revenue</div>
                      <div className="font-bold text-slate-900">{formatCurrency(selectedCampaign.total_revenue)}</div>
                    </div>
                    <div className="text-center p-3 bg-slate-50 rounded-lg">
                      <div className="text-xs text-slate-500">ROAS</div>
                      <div className="font-bold text-slate-900">{selectedCampaign.roas || '—'}x</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Lookback & Horizon */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Lookback */}
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2">Training Window (Lookback)</div>
                <div className="flex flex-wrap gap-2">
                  {Object.values(LOOKBACKS).map(lb => (
                    <Pill key={lb.id} active={lookback === lb.id} onClick={() => setLookback(lb.id)}>
                      {lb.label}
                    </Pill>
                  ))}
                </div>
                {resolvedLookback && resolvedLookback !== lookback && (
                  <div className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                    <Info size={12} />
                    Auto-resolved to {resolvedLookback} based on data availability
                  </div>
                )}
              </div>
              
              {/* Horizon */}
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2">Prediction Horizon</div>
                <div className="flex flex-wrap gap-2">
                  {HORIZONS.map(h => (
                    <Pill key={h.id} active={horizon === h.id} onClick={() => setHorizon(h.id)}>
                      {h.label}
                    </Pill>
                  ))}
                </div>
              </div>
            </div>
          </div>
          
          {/* Budget Slider */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 relative">
            {!structure && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
                <div className="text-center p-4">
                  <Lock size={24} className="mx-auto mb-2 text-slate-400" />
                  <div className="font-semibold text-slate-600">Select Budget Logic to unlock</div>
                  <div className="text-sm text-slate-500">Choose ABO, CBO, or ASC above</div>
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-lg font-bold text-slate-900">💰 Daily Budget</div>
                <div className="text-sm text-slate-500">
                  {structure === 'ABO' 
                    ? (aboScope === 'single' ? 'Ad Set Daily Budget' : 'Per Ad Set Budget')
                    : 'Campaign Daily Budget'
                  }
                </div>
              </div>
              <div className="text-2xl font-bold text-indigo-600">
                {formatCurrency(budget)}
              </div>
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
        
        {/* ============================================================
            RIGHT COLUMN - Results
        ============================================================= */}
        <div className="space-y-6">
          
          {/* Prediction Results */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 relative">
            {(!structure || prediction?.locked) && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
                <div className="text-center p-4">
                  <Lock size={24} className="mx-auto mb-2 text-slate-400" />
                  <div className="font-semibold text-slate-600">
                    {prediction?.reason || 'Select Budget Logic to unlock'}
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-bold text-slate-900">📊 Prediction</div>
              <ConfidenceBadge level={prediction?.confidence || 'Locked'} />
            </div>
            
            <div className="space-y-4">
              {/* Daily Revenue */}
              <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                <div className="text-sm text-indigo-600 font-medium">Expected Daily Revenue</div>
                <div className="text-3xl font-bold text-indigo-900 mt-1">
                  {prediction ? formatCurrency(prediction.avgDailyRevenue) : '—'}
                </div>
                <div className="text-sm text-indigo-600 mt-1">
                  Range: {prediction ? `${formatCurrency(prediction.p10)} — ${formatCurrency(prediction.p90)}` : '—'}
                </div>
              </div>
              
              {/* ROAS */}
              <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <div className="text-sm text-emerald-600 font-medium">Expected ROAS</div>
                <div className="text-3xl font-bold text-emerald-900 mt-1">
                  {prediction ? `${prediction.roas}x` : '—'}
                </div>
              </div>
              
              {/* Horizon Total */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-sm text-slate-600 font-medium">{horizon}-Day Projection</div>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <div className="text-xs text-slate-500">Total Spend</div>
                    <div className="font-bold text-slate-900">
                      {prediction ? formatCurrency(prediction.totalSpend) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Total Revenue</div>
                    <div className="font-bold text-slate-900">
                      {prediction ? formatCurrency(prediction.totalRevenue) : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Model Assumptions */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <div className="text-lg font-bold text-slate-900 mb-4">🔬 Model Assumptions</div>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Structure</span>
                <span className="font-medium text-slate-900">{structure || 'Not selected'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Budget Control</span>
                <span className="font-medium text-slate-900">
                  {structure === 'ABO' 
                    ? (aboScope === 'single' ? 'Single Ad Set' : 'All Ad Sets')
                    : structure === 'CBO' ? 'Campaign Level' 
                    : structure === 'ASC' ? 'Algo-Managed'
                    : '—'
                  }
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lookback Window</span>
                <span className="font-medium text-slate-900">{resolvedLookback || lookback}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Data Points</span>
                <span className="font-medium text-slate-900">{timeseries.length}</span>
              </div>
              {prediction?.params && (
                <>
                  <div className="pt-3 border-t border-slate-100">
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Hill Parameters</div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Half-Saturation (K)</span>
                    <span className="font-medium text-slate-900">
                      {formatCurrency(Math.round(prediction.params.halfSat))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Max Response</span>
                    <span className="font-medium text-slate-900">
                      {formatCurrency(Math.round(prediction.params.maxResponse))}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
          
          {/* Quick Actions */}
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white">
            <div className="font-bold mb-2">💡 Insights</div>
            <div className="text-sm text-indigo-100 space-y-2">
              {prediction && !prediction.locked ? (
                <>
                  {prediction.roas >= 2 && (
                    <p>✅ Strong ROAS indicates healthy unit economics</p>
                  )}
                  {prediction.roas < 1.5 && prediction.roas > 0 && (
                    <p>⚠️ ROAS below 1.5x - consider optimizing before scaling</p>
                  )}
                  {prediction.confidence === 'Low' && (
                    <p>📊 More data needed for reliable predictions</p>
                  )}
                  {budget > (prediction.params?.halfSat || 500) * 2 && (
                    <p>📈 Budget is past saturation point - diminishing returns likely</p>
                  )}
                </>
              ) : (
                <p>Select a campaign and budget logic to see insights</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
