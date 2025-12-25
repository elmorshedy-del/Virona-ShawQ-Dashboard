import { useEffect, useMemo, useState } from 'react';

const DEFAULT_SPEND_LEVELS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
const DEFAULT_AI_PROMPT = `Use the campaign data below to propose two test points for the budget curve.
Return JSON only with:
spend1, conv1, spend2, conv2, aov, margin, overhead, notes.
Rules: spend2 > spend1. Use realistic daily averages. margin is percent.`;

function formatCurrency(value) {
  if (!Number.isFinite(value)) {
    return '∞';
  }

  return `$${Math.round(value)}`;
}

function formatProfit(value) {
  if (!Number.isFinite(value)) {
    return '∞';
  }

  return value >= 0 ? `$${Math.round(value)}` : `-$${Math.round(Math.abs(value))}`;
}

function extractJsonBlock(text) {
  if (!text) return null;
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return text.slice(first, last + 1);
  }
  return null;
}

function buildInterpretation({ B, optimal, profitAtOptimal, ceiling, realCeiling, hasOverhead, monthlyOverhead }) {
  const overheadText = hasOverhead
    ? `<br>🏢 <strong>Real Ceiling: $${Math.round(realCeiling)}/day</strong> (covers $${Math.round(monthlyOverhead)}/mo overhead)`
    : '';

  if (B >= 1) {
    return `<strong>B = ${B.toFixed(2)} → INCREASING RETURNS!</strong><br><br>
      This is unusual and great. Your market was starved at the lower budget. 
      More spend = better efficiency. Scale aggressively until ROAS starts dropping.`;
  }

  if (B >= 0.7) {
    return `<strong>B = ${B.toFixed(2)} → Good scalability</strong><br><br>
      You can scale significantly before hitting diminishing returns.<br><br>
      💰 <strong>Optimal: $${Math.round(optimal)}/day</strong> (max profit: $${Math.round(profitAtOptimal)}/day)<br>
      ⚠️ <strong>Ad Breakeven: $${Math.round(ceiling)}/day</strong>${overheadText}`;
  }

  if (B >= 0.5) {
    return `<strong>B = ${B.toFixed(2)} → Moderate scalability</strong><br><br>
      You'll see diminishing returns as you scale, but there's still room.<br><br>
      💰 <strong>Optimal: $${Math.round(optimal)}/day</strong> (max profit: $${Math.round(profitAtOptimal)}/day)<br>
      ⚠️ <strong>Ad Breakeven: $${Math.round(ceiling)}/day</strong>${overheadText}`;
  }

  if (B >= 0.3) {
    return `<strong>B = ${B.toFixed(2)} → Limited scalability</strong><br><br>
      Efficiency drops fast when you scale.<br><br>
      💰 <strong>Optimal: $${Math.round(optimal)}/day</strong> (max profit: $${Math.round(profitAtOptimal)}/day)<br>
      ⚠️ <strong>Ad Breakeven: $${Math.round(ceiling)}/day</strong>${overheadText}`;
  }

  return `<strong>B = ${B.toFixed(2)} → Very limited scalability</strong><br><br>
    This market saturates quickly. Scaling kills efficiency fast.<br><br>
    💰 <strong>Optimal: $${Math.round(optimal)}/day</strong> (max profit: $${Math.round(profitAtOptimal)}/day)<br>
    ⚠️ <strong>Ad Breakeven: $${Math.round(ceiling)}/day</strong>${overheadText}`;
}

export default function BudgetCalculator({ store, API_BASE }) {
  const [inputs, setInputs] = useState({
    spend1: '',
    conv1: '',
    spend2: '',
    conv2: '',
    aov: '',
    margin: '',
    overhead: '',
  });
  const [results, setResults] = useState(null);
  const [resultsSource, setResultsSource] = useState(null);
  const [aiDataset, setAiDataset] = useState({ hierarchy: { campaigns: [] }, metrics: { campaignDaily: [] } });
  const [campaignMode, setCampaignMode] = useState('two');
  const [campaignA, setCampaignA] = useState('');
  const [campaignB, setCampaignB] = useState('');
  const [prompt, setPrompt] = useState(DEFAULT_AI_PROMPT);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiMeta, setAiMeta] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'spend', direction: 'asc' });

  const updateInput = (key) => (event) => {
    setInputs((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const campaignOptions = useMemo(() => {
    if (!aiDataset?.hierarchy?.campaigns) return [];
    return aiDataset.hierarchy.campaigns.map((c) => ({
      id: c.object_id,
      name: c.object_name || c.campaign_name || 'Unknown Campaign',
    }));
  }, [aiDataset]);

  const allCampaignMetrics = useMemo(() => {
    if (!aiDataset?.metrics?.campaignDaily) return [];
    return aiDataset.metrics.campaignDaily.map((row) => ({
      date: row.date,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      spend: Number(row.spend) || 0,
      purchases: Number(row.conversions ?? row.purchases ?? 0) || 0,
      revenue: Number(row.conversion_value ?? row.purchase_value ?? 0) || 0,
    }));
  }, [aiDataset]);

  useEffect(() => {
    let mounted = true;

    async function loadDataset() {
      if (!store || !API_BASE) return;
      try {
        const params = new URLSearchParams({ store, includeInactive: 'true' });
        const res = await fetch(`${API_BASE}/aibudget?${params.toString()}`);
        const data = await res.json();
        if (!mounted) return;
        setAiDataset(data || { hierarchy: { campaigns: [] }, metrics: { campaignDaily: [] } });
      } catch (e) {
        if (!mounted) return;
        setAiDataset({ hierarchy: { campaigns: [] }, metrics: { campaignDaily: [] } });
      }
    }

    loadDataset();
    return () => { mounted = false; };
  }, [store, API_BASE]);

  useEffect(() => {
    if (!campaignOptions.length) return;
    if (!campaignA) setCampaignA(campaignOptions[0].id);
    if (!campaignB) setCampaignB(campaignOptions[1]?.id || campaignOptions[0].id);
  }, [campaignOptions, campaignA, campaignB]);

  const calculateFromInputs = (inputValues, { onError } = {}) => {
    const spend1 = parseFloat(inputValues.spend1);
    const conv1 = parseFloat(inputValues.conv1);
    const spend2 = parseFloat(inputValues.spend2);
    const conv2 = parseFloat(inputValues.conv2);
    const aov = parseFloat(inputValues.aov);
    const margin = parseFloat(inputValues.margin) / 100;
    const monthlyOverhead = parseFloat(inputValues.overhead) || 0;
    const dailyOverhead = monthlyOverhead / 30;
    const hasOverhead = monthlyOverhead > 0;

    if (!spend1 || !conv1 || !spend2 || !conv2 || !aov || !margin) {
      onError?.('Please fill in all fields (overhead is optional).');
      return null;
    }

    if (spend1 >= spend2) {
      onError?.('Test 2 spend must be higher than Test 1.');
      return null;
    }

    const B = Math.log(conv2 / conv1) / Math.log(spend2 / spend1);
    const a = conv1 / Math.pow(spend1, B);

    if (!Number.isFinite(B) || !Number.isFinite(a)) {
      onError?.('Unable to compute curve. Check inputs for zero or invalid values.');
      return null;
    }

    const breakevenRoas = 1 / margin;

    let ceiling;
    if (B < 1) {
      ceiling = Math.pow(breakevenRoas / (a * aov), 1 / (B - 1));
    } else {
      ceiling = Infinity;
    }

    let realCeiling = ceiling;
    if (hasOverhead && B < 1) {
      let low = 1;
      let high = ceiling;
      for (let i = 0; i < 50; i += 1) {
        const mid = (low + high) / 2;
        const conv = a * Math.pow(mid, B);
        const profit = conv * aov * margin - mid;
        if (profit > dailyOverhead) {
          low = mid;
        } else {
          high = mid;
        }
      }
      realCeiling = (low + high) / 2;
    }

    let optimal;
    if (B < 1 && B > 0) {
      optimal = Math.pow(1 / (a * B * aov * margin), 1 / (B - 1));
    } else {
      optimal = Infinity;
    }

    const convAtOptimal = a * Math.pow(optimal, B);
    const revenueAtOptimal = convAtOptimal * aov;
    const profitAtOptimal = revenueAtOptimal * margin - optimal - dailyOverhead;

    const spendLevels = [...DEFAULT_SPEND_LEVELS];
    if (optimal !== Infinity && optimal > 5 && optimal < 200) {
      spendLevels.push(Math.round(optimal));
    }
    if (hasOverhead && realCeiling > 5 && realCeiling < 200) {
      spendLevels.push(Math.round(realCeiling));
    }
    if (ceiling !== Infinity && ceiling > 5 && ceiling < 200) {
      spendLevels.push(Math.round(ceiling));
    }

    spendLevels.sort((left, right) => left - right);
    const uniqueSpendLevels = [...new Set(spendLevels)];

    const predictions = uniqueSpendLevels.map((spend) => {
      const conv = a * Math.pow(spend, B);
      const revenue = conv * aov;
      const roas = revenue / spend;
      const adProfit = revenue * margin - spend;
      const netProfit = adProfit - dailyOverhead;
      const displayProfit = hasOverhead ? netProfit : adProfit;

      const isOptimal = Math.abs(spend - optimal) < 2;
      const isRealCeiling = hasOverhead && Math.abs(spend - realCeiling) < 2;
      const isCeiling = Math.abs(spend - ceiling) < 2;

      let rowClass = '';
      if (isOptimal) {
        rowClass = 'bg-emerald-100 text-emerald-700 font-semibold';
      } else if (isRealCeiling) {
        rowClass = 'bg-sky-100 text-sky-700 font-semibold';
      } else if (isCeiling) {
        rowClass = 'bg-amber-100 text-amber-700 font-semibold';
      } else if (displayProfit >= 0) {
        rowClass = 'text-emerald-600';
      } else {
        rowClass = 'text-rose-500';
      }

      let label = '';
      if (isOptimal) {
        label = ' 💰 OPTIMAL';
      } else if (isRealCeiling) {
        label = ' 🎯 REAL CEILING';
      } else if (isCeiling) {
        label = ' ⚠️ AD BREAKEVEN';
      }

      return {
        spend,
        conv,
        revenue,
        roas,
        displayProfit,
        rowClass,
        label,
      };
    });

    return {
      B,
      a,
      ceiling,
      realCeiling,
      optimal,
      profitAtOptimal,
      monthlyOverhead,
      dailyOverhead,
      hasOverhead,
      predictions,
    };
  };

  const handleCalculate = () => {
    const computed = calculateFromInputs(inputs, {
      onError: (message) => window.alert(message),
    });
    if (!computed) return;
    setResults(computed);
    setResultsSource('Manual');
  };

  const buildCampaignSummary = (campaignId) => {
    const rows = allCampaignMetrics.filter((row) => row.campaign_id === campaignId);
    if (!rows.length) return null;
    const spend = rows.reduce((sum, row) => sum + row.spend, 0);
    const purchases = rows.reduce((sum, row) => sum + row.purchases, 0);
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const days = new Set(rows.map((row) => row.date)).size || 1;
    return {
      campaignId,
      campaignName: rows[0].campaign_name || campaignOptions.find((c) => c.id === campaignId)?.name,
      spend,
      purchases,
      revenue,
      days,
      avgDailySpend: spend / days,
      avgDailyPurchases: purchases / days,
      avgDailyRevenue: revenue / days,
    };
  };

  const handleAiCalculate = async () => {
    setAiError(null);
    setAiMeta(null);

    if (!store || !API_BASE) {
      setAiError('Missing store or API base.');
      return;
    }

    if (campaignMode === 'two' && (!campaignA || !campaignB)) {
      setAiError('Select two campaigns for the two-point calculator.');
      return;
    }

    const summaries = campaignMode === 'two'
      ? [buildCampaignSummary(campaignA), buildCampaignSummary(campaignB)]
      : campaignOptions.map((c) => buildCampaignSummary(c.id)).filter(Boolean);

    if (!summaries.length || summaries.some((s) => !s)) {
      setAiError('Campaign metrics are missing or incomplete.');
      return;
    }

    const promptText = `${prompt || DEFAULT_AI_PROMPT}\n\nCampaign data (unified):\n${JSON.stringify(summaries, null, 2)}`;

    setAiLoading(true);
    try {
      const response = await fetch(`${API_BASE}/ai/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: promptText, store, depth: 'instant' })
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to run GPT-5.1 low effort');
      }

      const jsonText = extractJsonBlock(data.answer);
      if (!jsonText) {
        throw new Error('GPT response did not include JSON.');
      }

      const parsed = JSON.parse(jsonText);
      const nextInputs = {
        spend1: parsed.spend1 ?? '',
        conv1: parsed.conv1 ?? '',
        spend2: parsed.spend2 ?? '',
        conv2: parsed.conv2 ?? '',
        aov: parsed.aov ?? '',
        margin: parsed.margin ?? '',
        overhead: parsed.overhead ?? '',
      };

      setInputs((prev) => ({ ...prev, ...nextInputs }));
      setAiMeta({ model: data.model, reasoning: data.reasoning, notes: parsed.notes });

      const computed = calculateFromInputs(nextInputs, {
        onError: (message) => { throw new Error(message); }
      });

      setResults(computed);
      setResultsSource('ChatGPT 5.1 (Low Effort)');
    } catch (err) {
      setAiError(err.message || 'Failed to run GPT-5.1 low effort.');
    } finally {
      setAiLoading(false);
    }
  };

  const formulaHtml = useMemo(() => {
    if (!results) {
      return 'Your Formula: Conversions = — × Spend^—';
    }

    return `<strong>Your Formula:</strong><br>
      Conversions = ${results.a.toFixed(4)} × Spend<sup>${results.B.toFixed(2)}</sup><br>
      ROAS = ${(results.a * parseFloat(inputs.aov)).toFixed(2)} × Spend<sup>${(results.B - 1).toFixed(2)}</sup>`;
  }, [inputs.aov, results]);

  const interpretationHtml = useMemo(() => {
    if (!results) {
      return 'Enter your data above to see insights.';
    }

    return buildInterpretation({
      B: results.B,
      optimal: results.optimal,
      profitAtOptimal: results.profitAtOptimal,
      ceiling: results.ceiling,
      realCeiling: results.realCeiling,
      hasOverhead: results.hasOverhead,
      monthlyOverhead: results.monthlyOverhead,
    });
  }, [results]);

  const bMarkerPosition = useMemo(() => {
    if (!results) {
      return '0%';
    }

    const position = Math.min(Math.max((results.B - 0.1) / 1.0, 0), 1) * 100;
    return `${position}%`;
  }, [results]);

  const sortedPredictions = useMemo(() => {
    if (!results?.predictions) return [];
    const sorted = [...results.predictions];
    sorted.sort((a, b) => {
      const key = sortConfig.key;
      const direction = sortConfig.direction === 'asc' ? 1 : -1;
      const valueA = a[key];
      const valueB = b[key];
      if (valueA === valueB) return 0;
      return valueA > valueB ? direction : -direction;
    });
    return sorted;
  }, [results, sortConfig]);

  const renderSortArrow = (key) => {
    if (sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">🧠 ChatGPT 5.1 (Low Effort)</h2>
          <p className="text-xs text-gray-500 mt-1">Modernized AI fill from unified campaign data (two-point budget curve).</p>
        </div>
        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="px-2 py-1 rounded-full bg-gray-100">Unified campaigns: {campaignOptions.length || 0}</span>
            <span className="px-2 py-1 rounded-full bg-gray-100">Store: {store || '—'}</span>
            {resultsSource && <span className="px-2 py-1 rounded-full bg-gray-100">Source: {resultsSource}</span>}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Campaign Selection (Unified)</h3>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setCampaignMode('two')}
                    className={`px-3 py-1 rounded-full border ${campaignMode === 'two' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}
                  >
                    Two campaigns
                  </button>
                  <button
                    type="button"
                    onClick={() => setCampaignMode('all')}
                    className={`px-3 py-1 rounded-full border ${campaignMode === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}
                  >
                    All campaigns
                  </button>
                </div>
              </div>

              {campaignMode === 'two' ? (
                <div className="grid gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-500">Campaign A</label>
                    <select
                      value={campaignA}
                      onChange={(e) => setCampaignA(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      {campaignOptions.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Campaign B</label>
                    <select
                      value={campaignB}
                      onChange={(e) => setCampaignB(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    >
                      {campaignOptions.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-gray-500">
                  All campaigns selected. Use the prompt to explain what you want GPT-5.1 (low effort) to do.
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500">Instruction to GPT-5.1 (Low Effort)</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={6}
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="button"
                onClick={handleAiCalculate}
                disabled={aiLoading || !campaignOptions.length}
                className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {aiLoading ? 'Running GPT-5.1 (Low Effort)...' : 'Run GPT-5.1 (Low Effort)'}
              </button>
              {aiError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {aiError}
                </div>
              )}
              {aiMeta && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 space-y-1">
                  <div>Model: {aiMeta.model}</div>
                  <div>Reasoning: {aiMeta.reasoning || 'low'}</div>
                  {aiMeta.notes && <div>Notes: {aiMeta.notes}</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">📊 Input Your Data</h2>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Test 1: Daily Spend ($)</label>
              <input
                type="number"
                value={inputs.spend1}
                onChange={updateInput('spend1')}
                placeholder="8"
                step="0.01"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400">Lower budget test</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Test 1: Daily Conversions</label>
              <input
                type="number"
                value={inputs.conv1}
                onChange={updateInput('conv1')}
                placeholder="0.33"
                step="0.01"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400">Purchases per day</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Test 2: Daily Spend ($)</label>
              <input
                type="number"
                value={inputs.spend2}
                onChange={updateInput('spend2')}
                placeholder="49"
                step="0.01"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400">Higher budget test</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Test 2: Daily Conversions</label>
              <input
                type="number"
                value={inputs.conv2}
                onChange={updateInput('conv2')}
                placeholder="1.0"
                step="0.01"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400">Purchases per day</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Average Order Value ($)</label>
              <input
                type="number"
                value={inputs.aov}
                onChange={updateInput('aov')}
                placeholder="113"
                step="0.01"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400">Revenue per purchase</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Profit Margin (%)</label>
              <input
                type="number"
                value={inputs.margin}
                onChange={updateInput('margin')}
                placeholder="35"
                step="1"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400">Your profit margin</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">
                Monthly Overhead <span className="text-xs text-gray-400">(optional)</span>
              </label>
              <input
                type="number"
                value={inputs.overhead}
                onChange={updateInput('overhead')}
                placeholder="0"
                step="1"
                className="w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400">Rent, salaries, software, etc.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCalculate}
            className="w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800"
          >
            Calculate Ceiling
          </button>
        </div>
      </div>

      {results && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">🎯 Your Results</h2>
              {resultsSource && (
                <span className="text-xs text-gray-500">Source: {resultsSource}</span>
              )}
            </div>
            <div className="p-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
                  <div
                    className={`text-2xl font-semibold ${
                      results.B >= 1
                        ? 'text-emerald-600'
                        : results.B < 0.4
                          ? 'text-rose-500'
                          : 'text-indigo-600'
                    }`}
                  >
                    {results.B.toFixed(2)}
                  </div>
                  <p className="text-xs text-gray-500">B (Decay Rate)</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
                  <div className="text-2xl font-semibold text-indigo-600">{results.a.toFixed(4)}</div>
                  <p className="text-xs text-gray-500">a (Base Efficiency)</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
                  <div className="text-2xl font-semibold text-emerald-600">{formatCurrency(results.optimal)}</div>
                  <p className="text-xs text-gray-500">💰 Optimal Spend</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
                  <div className="text-2xl font-semibold text-emerald-600">{formatCurrency(results.profitAtOptimal)}</div>
                  <p className="text-xs text-gray-500">💵 Max Daily Profit</p>
                </div>
                {results.hasOverhead && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
                    <div className="text-2xl font-semibold text-sky-600">{formatCurrency(results.realCeiling)}</div>
                    <p className="text-xs text-gray-500">🎯 Real Ceiling</p>
                  </div>
                )}
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
                  <div className="text-2xl font-semibold text-rose-500">{formatCurrency(results.ceiling)}</div>
                  <p className="text-xs text-gray-500">⚠️ Ad Breakeven</p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-sm font-semibold text-gray-700">B Scale Interpretation:</p>
                <div className="relative mt-3 h-2 w-full rounded-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-400">
                  <div
                    className="absolute -top-2 h-6 w-6 -translate-x-1/2 rounded-full border border-white bg-white shadow"
                    style={{ left: bMarkerPosition }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-xs text-gray-400">
                  <span>0.2 (Poor)</span>
                  <span>0.5 (Limited)</span>
                  <span>0.8 (Good)</span>
                  <span>1.0+ (Scale!)</span>
                </div>
              </div>

              {results.hasOverhead && (
                <div className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-700">
                  📌 With ${Math.round(results.monthlyOverhead)}/month overhead, you need
                  {' '} ${Math.round(results.dailyOverhead)}/day profit just to break even on business costs.
                </div>
              )}

              <div
                className="rounded-xl border border-gray-100 bg-gray-900/90 p-4 text-sm text-gray-100"
                dangerouslySetInnerHTML={{ __html: formulaHtml }}
              />

              <div className="rounded-xl border border-sky-100 bg-sky-50 p-4">
                <h3 className="text-sm font-semibold text-sky-700">💡 What This Means</h3>
                <p
                  className="mt-2 text-sm text-slate-600 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: interpretationHtml }}
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">📈 ROAS Predictions</h2>
            </div>
            <div className="p-6 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-2 text-left cursor-pointer" onClick={() => handleSort('spend')}>
                      Daily Spend {renderSortArrow('spend')}
                    </th>
                    <th className="py-2 text-right cursor-pointer" onClick={() => handleSort('conv')}>
                      Conversions {renderSortArrow('conv')}
                    </th>
                    <th className="py-2 text-right cursor-pointer" onClick={() => handleSort('revenue')}>
                      Revenue {renderSortArrow('revenue')}
                    </th>
                    <th className="py-2 text-right cursor-pointer" onClick={() => handleSort('roas')}>
                      ROAS {renderSortArrow('roas')}
                    </th>
                    <th className="py-2 text-right cursor-pointer" onClick={() => handleSort('displayProfit')}>
                      {results.hasOverhead ? 'Net Profit' : 'Daily Profit'} {renderSortArrow('displayProfit')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPredictions.map((row) => (
                    <tr key={row.spend} className={`border-t border-gray-100 ${row.rowClass}`}>
                      <td className="py-2 text-left font-medium">
                        ${row.spend}
                        {row.label && <span className="ml-2 text-xs font-semibold">{row.label}</span>}
                      </td>
                      <td className="py-2 text-right">{row.conv.toFixed(2)}</td>
                      <td className="py-2 text-right">{formatCurrency(row.revenue)}</td>
                      <td className="py-2 text-right">{row.roas.toFixed(2)}</td>
                      <td className="py-2 text-right">{formatProfit(row.displayProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
