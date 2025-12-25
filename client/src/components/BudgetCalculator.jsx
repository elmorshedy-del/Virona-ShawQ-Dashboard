import { useEffect, useMemo, useState } from 'react';

const DEFAULT_SPEND_LEVELS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];

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

export default function BudgetCalculator({ store, apiBase = '/api' }) {
  useEffect(() => {
    if (!store) return;

    let isMounted = true;
    async function loadCampaigns() {
      setLoadingCampaigns(true);
      setCampaignError(null);
      try {
        const res = await fetch(`${apiBase}/aibudget?store=${store}`);
        const data = await res.json();
        if (!isMounted) return;
        setAiDataset(data || { hierarchy: { campaigns: [] }, metrics: { campaignDaily: [] } });
      } catch (error) {
        if (!isMounted) return;
        setCampaignError('Unable to load unified campaign data.');
        setAiDataset({ hierarchy: { campaigns: [] }, metrics: { campaignDaily: [] } });
      } finally {
        if (isMounted) {
          setLoadingCampaigns(false);
        }
      }
    }

    loadCampaigns();
    return () => {
      isMounted = false;
    };
  }, [apiBase, store]);

  const [aiDataset, setAiDataset] = useState({ hierarchy: { campaigns: [] }, metrics: { campaignDaily: [] } });
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignError, setCampaignError] = useState(null);
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
  const [selectionMode, setSelectionMode] = useState('two'); // two | all
  const [campaignA, setCampaignA] = useState('');
  const [campaignB, setCampaignB] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiModel, setAiModel] = useState(null);
  const [aiApplied, setAiApplied] = useState(false);
  const [predictionSort, setPredictionSort] = useState({ field: 'spend', direction: 'asc' });

  const availableCampaigns = useMemo(() => {
    if (!aiDataset?.hierarchy?.campaigns) return [];
    return aiDataset.hierarchy.campaigns.map((campaign) => ({
      id: campaign.object_id,
      name: campaign.object_name || campaign.campaign_name || 'Unknown Campaign',
      status: campaign.effective_status || campaign.status || 'UNKNOWN',
    }));
  }, [aiDataset]);

  const campaignSummaries = useMemo(() => {
    const summaries = new Map();
    const rows = aiDataset?.metrics?.campaignDaily || [];
    rows.forEach((row) => {
      const id = row.campaign_id;
      if (!id) return;
      const summary = summaries.get(id) || {
        id,
        name: row.campaign_name || availableCampaigns.find((c) => c.id === id)?.name || 'Unknown Campaign',
        spend: 0,
        conversions: 0,
        revenue: 0,
        days: 0,
      };
      summary.spend += Number(row.spend) || 0;
      summary.conversions += Number(row.conversions) || 0;
      summary.revenue += Number(row.conversion_value) || 0;
      summary.days += 1;
      summaries.set(id, summary);
    });
    return Array.from(summaries.values()).sort((left, right) => right.spend - left.spend);
  }, [aiDataset, availableCampaigns]);

  const selectedCampaigns = useMemo(() => {
    if (selectionMode === 'all') return campaignSummaries;
    return campaignSummaries.filter((campaign) => campaign.id === campaignA || campaign.id === campaignB);
  }, [campaignSummaries, campaignA, campaignB, selectionMode]);

  const updateInput = (key) => (event) => {
    setInputs((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const computeResults = (values) => {
    const spend1 = parseFloat(values.spend1);
    const conv1 = parseFloat(values.conv1);
    const spend2 = parseFloat(values.spend2);
    const conv2 = parseFloat(values.conv2);
    const aov = parseFloat(values.aov);
    const margin = parseFloat(values.margin) / 100;
    const monthlyOverhead = parseFloat(values.overhead) || 0;
    const dailyOverhead = monthlyOverhead / 30;
    const hasOverhead = monthlyOverhead > 0;

    if (!spend1 || !conv1 || !spend2 || !conv2 || !aov || !margin) {
      return { error: 'Please fill in all fields (overhead is optional)' };
    }

    if (spend1 >= spend2) {
      return { error: 'Test 2 spend must be higher than Test 1' };
    }

    const B = Math.log(conv2 / conv1) / Math.log(spend2 / spend1);
    const a = conv1 / Math.pow(spend1, B);

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
      results: {
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
      },
    };
  };

  const handleCalculate = () => {
    const { results: computed, error } = computeResults(inputs);
    if (error) {
      window.alert(error);
      return;
    }

    setResults(computed);
  };

  const extractJsonPayload = (text) => {
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return null;
    }
  };

  const formatCampaignSummary = (campaign, index) => {
    const avgSpend = campaign.days > 0 ? campaign.spend / campaign.days : 0;
    const avgConv = campaign.days > 0 ? campaign.conversions / campaign.days : 0;
    const avgAov = campaign.conversions > 0 ? campaign.revenue / campaign.conversions : 0;
    return `${index + 1}. ${campaign.name} (ID: ${campaign.id}) | Total Spend: ${campaign.spend.toFixed(2)} | Total Conversions: ${campaign.conversions.toFixed(2)} | Total Revenue: ${campaign.revenue.toFixed(2)} | Avg Daily Spend: ${avgSpend.toFixed(2)} | Avg Daily Conversions: ${avgConv.toFixed(2)} | Avg AOV: ${avgAov.toFixed(2)} | Days: ${campaign.days}`;
  };

  const handleAiGenerate = async () => {
    setAiError(null);
    setAiModel(null);
    setAiApplied(false);

    if (!store) {
      setAiError('Store is required to use ChatGPT inputs.');
      return;
    }

    if (loadingCampaigns) {
      setAiError('Unified campaign data is still loading.');
      return;
    }

    if (campaignSummaries.length === 0) {
      setAiError('No unified campaign data available.');
      return;
    }

    if (selectionMode === 'two' && (!campaignA || !campaignB || campaignA === campaignB)) {
      setAiError('Select two different campaigns.');
      return;
    }

    if (!aiPrompt.trim()) {
      setAiError('Add your instructions for ChatGPT.');
      return;
    }

    const selected = selectionMode === 'all' ? campaignSummaries : selectedCampaigns;

    const promptText = [
      'You are a budget calculator assistant.',
      'Use the campaign history below to propose TWO spend/conversion test points for the calculator.',
      'Return ONLY valid JSON with keys: spend1, conv1, spend2, conv2, aov, margin, overhead.',
      'Use numbers only. margin should be a percent (e.g., 35). overhead is monthly.',
      'If unsure about aov/margin/overhead, infer from history or leave as null.',
      '',
      `Selection: ${selectionMode === 'all' ? 'All unified campaigns' : 'Two unified campaigns'}`,
      '',
      'Campaign history:',
      ...selected.map(formatCampaignSummary),
      '',
      `User instructions: ${aiPrompt.trim()}`
    ].join('\n');

    setAiLoading(true);
    try {
      const response = await fetch(`${apiBase}/ai/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: promptText,
          store,
          depth: 'fast'
        })
      });

      const data = await response.json();
      if (!data?.success) {
        throw new Error(data?.error || 'ChatGPT request failed.');
      }

      setAiModel(data.model || 'gpt-5.1');
      const parsed = extractJsonPayload(data.answer);
      if (!parsed) {
        throw new Error('ChatGPT response did not include valid JSON.');
      }

      const nextValues = {
        spend1: parsed.spend1 ?? inputs.spend1,
        conv1: parsed.conv1 ?? inputs.conv1,
        spend2: parsed.spend2 ?? inputs.spend2,
        conv2: parsed.conv2 ?? inputs.conv2,
        aov: parsed.aov ?? inputs.aov,
        margin: parsed.margin ?? inputs.margin,
        overhead: parsed.overhead ?? inputs.overhead,
      };

      setInputs({
        spend1: nextValues.spend1?.toString() || '',
        conv1: nextValues.conv1?.toString() || '',
        spend2: nextValues.spend2?.toString() || '',
        conv2: nextValues.conv2?.toString() || '',
        aov: nextValues.aov?.toString() || '',
        margin: nextValues.margin?.toString() || '',
        overhead: nextValues.overhead?.toString() || '',
      });

      const { results: computed, error } = computeResults(nextValues);
      if (error) {
        setAiError(error);
        return;
      }

      setResults(computed);
      setAiApplied(true);
    } catch (error) {
      setAiError(error.message || 'Unable to apply ChatGPT inputs.');
    } finally {
      setAiLoading(false);
    }
  };
    const spend1 = parseFloat(inputs.spend1);
    const conv1 = parseFloat(inputs.conv1);
    const spend2 = parseFloat(inputs.spend2);
    const conv2 = parseFloat(inputs.conv2);
    const aov = parseFloat(inputs.aov);
    const margin = parseFloat(inputs.margin) / 100;
    const monthlyOverhead = parseFloat(inputs.overhead) || 0;
    const dailyOverhead = monthlyOverhead / 30;
    const hasOverhead = monthlyOverhead > 0;

    if (!spend1 || !conv1 || !spend2 || !conv2 || !aov || !margin) {
      window.alert('Please fill in all fields (overhead is optional)');
      return;
    }

    if (spend1 >= spend2) {
      window.alert('Test 2 spend must be higher than Test 1');
      return;
    }

    const B = Math.log(conv2 / conv1) / Math.log(spend2 / spend1);
    const a = conv1 / Math.pow(spend1, B);

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

    setResults({
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
    });
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
    const { field, direction } = predictionSort;
    const sorted = [...results.predictions].sort((left, right) => {
      const leftValue = left[field];
      const rightValue = right[field];
      if (leftValue === rightValue) return 0;
      return leftValue > rightValue ? 1 : -1;
    });
    return direction === 'asc' ? sorted : sorted.reverse();
  }, [predictionSort, results]);

  const handlePredictionSort = (field) => {
    setPredictionSort((prev) => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: 'asc' };
    });
  };

  const SortArrow = ({ field }) => {
    if (predictionSort.field !== field) {
      return <span className="text-gray-300 ml-1">↕</span>;
    }
    return predictionSort.direction === 'asc'
      ? <span className="text-gray-500 ml-1">↑</span>
      : <span className="text-gray-500 ml-1">↓</span>;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">🧠 ChatGPT 5.1 (Low Effort)</h2>
              <p className="text-sm text-gray-500">
                Unified campaign-driven inputs for the budget calculator.
              </p>
            </div>
            <div className="text-xs text-gray-400">
              {loadingCampaigns ? 'Loading unified campaigns…' : `Unified Campaigns: ${availableCampaigns.length}`}
            </div>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {campaignError && (
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-600">
              {campaignError}
            </div>
          )}

          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-700">
            Campaigns are sourced from the unified AI Budget dataset and fed directly into this calculator.
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Campaign selection mode</label>
              <div className="flex gap-2">
                {[
                  { id: 'two', label: 'Two campaigns' },
                  { id: 'all', label: 'All campaigns' },
                ].map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSelectionMode(option.id)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      selectionMode === option.id
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-600 hover:border-indigo-200 hover:bg-indigo-50/50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Your instructions for ChatGPT</label>
              <textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="Explain what you want from your campaigns (e.g., aggressive scaling, conservative test, target ROAS)."
                rows={3}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {selectionMode === 'two' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">Campaign A</label>
                <select
                  value={campaignA}
                  onChange={(event) => setCampaignA(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select campaign</option>
                  {availableCampaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">Campaign B</label>
                <select
                  value={campaignB}
                  onChange={(event) => setCampaignB(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select campaign</option>
                  {availableCampaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleAiGenerate}
              disabled={aiLoading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {aiLoading ? 'Generating inputs…' : 'Generate inputs with ChatGPT 5.1 (Low)'}
            </button>
            {aiModel && (
              <span className="text-xs text-gray-500">
                Model: {aiModel} • Effort: low
              </span>
            )}
            {aiApplied && !aiError && (
              <span className="text-xs font-medium text-emerald-600">Inputs applied and calculator updated.</span>
            )}
          </div>

          {aiError && (
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-600">
              {aiError}
            </div>
          )}
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
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">🎯 Your Results</h2>
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
                    <th className="py-2 text-left">
                      <button type="button" onClick={() => handlePredictionSort('spend')} className="flex items-center gap-1">
                        Daily Spend <SortArrow field="spend" />
                      </button>
                    </th>
                    <th className="py-2 text-right">
                      <button type="button" onClick={() => handlePredictionSort('conv')} className="flex items-center gap-1 ml-auto">
                        Conversions <SortArrow field="conv" />
                      </button>
                    </th>
                    <th className="py-2 text-right">
                      <button type="button" onClick={() => handlePredictionSort('revenue')} className="flex items-center gap-1 ml-auto">
                        Revenue <SortArrow field="revenue" />
                      </button>
                    </th>
                    <th className="py-2 text-right">
                      <button type="button" onClick={() => handlePredictionSort('roas')} className="flex items-center gap-1 ml-auto">
                        ROAS <SortArrow field="roas" />
                      </button>
                    </th>
                    <th className="py-2 text-right">
                      <button type="button" onClick={() => handlePredictionSort('displayProfit')} className="flex items-center gap-1 ml-auto">
                        {results.hasOverhead ? 'Net Profit' : 'Daily Profit'} <SortArrow field="displayProfit" />
                      </button>
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
