import { useEffect, useMemo, useState } from 'react';

const DEFAULT_SPEND_LEVELS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
const AI_LOOKBACK = '90d';

function getLocalDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

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

function buildBudgetResults({ spend1, conv1, spend2, conv2, aov, marginPercent, overhead }) {
  if (!spend1 || !conv1 || !spend2 || !conv2 || !aov || !marginPercent) {
    return { error: 'Please fill in all fields (overhead is optional)' };
  }

  if (spend1 >= spend2) {
    return { error: 'Test 2 spend must be higher than Test 1' };
  }

  if (conv1 <= 0 || conv2 <= 0) {
    return { error: 'Conversions must be greater than zero' };
  }

  if (marginPercent <= 0 || marginPercent > 100) {
    return { error: 'Profit margin must be between 0 and 100' };
  }

  const margin = marginPercent / 100;
  const monthlyOverhead = overhead || 0;
  const dailyOverhead = monthlyOverhead / 30;
  const hasOverhead = monthlyOverhead > 0;

  const B = Math.log(conv2 / conv1) / Math.log(spend2 / spend1);
  if (!Number.isFinite(B)) {
    return { error: 'Unable to compute B value. Check your inputs.' };
  }

  const a = conv1 / Math.pow(spend1, B);
  if (!Number.isFinite(a)) {
    return { error: 'Unable to compute efficiency curve. Check your inputs.' };
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
    }
  };
}

function parseAiJson(text) {
  if (!text) return null;
  const fencedMatch = text.match(/```json\\s*([\\s\\S]*?)```/i);
  const raw = fencedMatch ? fencedMatch[1] : text;
  const jsonMatch = raw.match(/\\{[\\s\\S]*\\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    return null;
  }
}

function normalizeAiNumber(value) {
  if (value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function SortableHeader({ label, sortKey, sortConfig, onSort, align = 'left' }) {
  const isActive = sortConfig.key === sortKey;
  const arrow = isActive ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↕';
  const alignClass = align === 'right' ? 'text-right' : 'text-left';

  return (
    <th className={`py-2 ${alignClass}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-gray-400 hover:text-gray-600"
      >
        <span>{label}</span>
        <span className={isActive ? 'text-gray-600' : 'text-gray-300'}>{arrow}</span>
      </button>
    </th>
  );
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

export default function BudgetCalculator({ storeId, storeName }) {
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
  const [errorMessage, setErrorMessage] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'spend', direction: 'asc' });
  const [aiDataset, setAiDataset] = useState(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetError, setDatasetError] = useState('');
  const [campaignMode, setCampaignMode] = useState('two');
  const [campaignAId, setCampaignAId] = useState('');
  const [campaignBId, setCampaignBId] = useState('');
  const [campaignPrompt, setCampaignPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState(null);

  const updateInput = (key) => (event) => {
    setInputs((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const handleCalculate = () => {
    const spend1 = parseFloat(inputs.spend1);
    const conv1 = parseFloat(inputs.conv1);
    const spend2 = parseFloat(inputs.spend2);
    const conv2 = parseFloat(inputs.conv2);
    const aov = parseFloat(inputs.aov);
    const marginPercent = parseFloat(inputs.margin);
    const overhead = parseFloat(inputs.overhead) || 0;

    const { results: nextResults, error } = buildBudgetResults({
      spend1,
      conv1,
      spend2,
      conv2,
      aov,
      marginPercent,
      overhead,
    });

    if (error) {
      setErrorMessage(error);
      window.alert(error);
      return;
    }

    setErrorMessage('');
    setResults(nextResults);
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  useEffect(() => {
    if (!storeId) return;
    let isMounted = true;

    async function loadDataset() {
      try {
        setDatasetLoading(true);
        setDatasetError('');
        const res = await fetch(`/api/aibudget?store=${storeId}&lookback=${AI_LOOKBACK}&includeInactive=true`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (isMounted) {
          setAiDataset(data);
        }
      } catch (error) {
        if (isMounted) {
          setAiDataset(null);
          setDatasetError('Failed to load unified campaign data.');
        }
      } finally {
        if (isMounted) {
          setDatasetLoading(false);
        }
      }
    }

    loadDataset();

    return () => {
      isMounted = false;
    };
  }, [storeId]);

  const availableCampaigns = useMemo(() => {
    const campaigns = aiDataset?.hierarchy?.campaigns || [];
    return campaigns.map((campaign) => ({
      id: campaign.object_id,
      name: campaign.object_name || campaign.campaign_name || 'Unknown Campaign',
    }));
  }, [aiDataset]);

  const campaignStats = useMemo(() => {
    const dailyRows = aiDataset?.metrics?.campaignDaily || [];
    if (!dailyRows.length || availableCampaigns.length === 0) return [];

    const nameById = new Map(availableCampaigns.map((campaign) => [campaign.id, campaign.name]));
    const statMap = new Map();

    dailyRows.forEach((row) => {
      const id = row.campaign_id;
      if (!id) return;
      const existing = statMap.get(id) || {
        id,
        name: nameById.get(id) || row.campaign_name || 'Unknown Campaign',
        spend: 0,
        conversions: 0,
        revenue: 0,
        dates: new Set(),
      };

      existing.spend += Number(row.spend || 0);
      existing.conversions += Number(row.conversions || 0);
      existing.revenue += Number(row.conversion_value || 0);
      if (row.date) {
        existing.dates.add(row.date);
      }
      statMap.set(id, existing);
    });

    return Array.from(statMap.values()).map((stat) => {
      const days = stat.dates.size || 1;
      return {
        id: stat.id,
        name: stat.name,
        spend: stat.spend,
        conversions: stat.conversions,
        revenue: stat.revenue,
        days,
        dailySpend: stat.spend / days,
        dailyConversions: stat.conversions / days,
        aov: stat.conversions > 0 ? stat.revenue / stat.conversions : 0,
      };
    });
  }, [aiDataset, availableCampaigns]);

  useEffect(() => {
    if (!availableCampaigns.length) return;
    if (!campaignAId) {
      setCampaignAId(availableCampaigns[0]?.id || '');
    }
    if (!campaignBId) {
      setCampaignBId(availableCampaigns[1]?.id || availableCampaigns[0]?.id || '');
    }
  }, [availableCampaigns, campaignAId, campaignBId]);

  const sortedPredictions = useMemo(() => {
    if (!results?.predictions) return [];
    const rows = [...results.predictions];
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const left = a[sortConfig.key];
      const right = b[sortConfig.key];
      return left > right ? direction : left < right ? -direction : 0;
    });
    return rows;
  }, [results, sortConfig]);

  const handleAiGenerate = async () => {
    if (!storeId || aiLoading) return;
    setAiError('');
    setAiSuggestion(null);

    if (!campaignStats.length) {
      setAiError('No unified campaign data available yet.');
      return;
    }

    if (campaignMode === 'two' && (!campaignAId || !campaignBId || campaignAId === campaignBId)) {
      setAiError('Select two different campaigns.');
      return;
    }

    const selectedCampaigns = campaignMode === 'two'
      ? campaignStats.filter((stat) => stat.id === campaignAId || stat.id === campaignBId)
      : campaignStats;

    if (campaignMode === 'two' && selectedCampaigns.length < 2) {
      setAiError('Not enough campaign data for the selected campaigns.');
      return;
    }

    const marginFallback = parseFloat(inputs.margin);
    const aovFallback = parseFloat(inputs.aov);
    const overheadFallback = parseFloat(inputs.overhead);

    const summary = selectedCampaigns
      .slice(0, campaignMode === 'two' ? 2 : 8)
      .map((campaign) => ({
        campaign: campaign.name,
        dailySpend: Math.round(campaign.dailySpend * 100) / 100,
        dailyConversions: Math.round(campaign.dailyConversions * 100) / 100,
        aov: Math.round(campaign.aov * 100) / 100,
        days: campaign.days,
        totalSpend: Math.round(campaign.spend * 100) / 100,
      }));

    const unifiedRange = aiDataset?.dateRange?.effectiveStart
      ? `${aiDataset.dateRange.effectiveStart} → ${aiDataset.dateRange.effectiveEnd}`
      : `${getLocalDateString()}`;

    const prompt = `
You are GPT-5.1 (low effort). Generate two daily spend/conversion test points for the budget calculator.
Return ONLY valid JSON with keys: spend1, conv1, spend2, conv2, aov, margin, overhead, rationale.
Rules: spend2 > spend1, conv1 > 0, conv2 > 0. Keep values realistic and close to campaign daily averages.
If margin or AOV are provided, prefer them; otherwise infer from the campaign stats.
Campaign selection: ${campaignMode === 'two' ? 'Two campaigns' : 'All campaigns'}
Store: ${storeName || storeId}
Unified range: ${unifiedRange}
User request: ${campaignPrompt || 'Use historical campaign behavior to build two test points.'}
User AOV (if provided): ${Number.isFinite(aovFallback) ? aovFallback : 'not provided'}
User margin % (if provided): ${Number.isFinite(marginFallback) ? marginFallback : 'not provided'}
User overhead (if provided): ${Number.isFinite(overheadFallback) ? overheadFallback : 'not provided'}
Campaign stats: ${JSON.stringify(summary)}
`;

    try {
      setAiLoading(true);
      const response = await fetch('/api/ai/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: prompt.trim(),
          store: storeId,
          depth: 'fast'
        })
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to generate AI response');
      }

      const parsed = parseAiJson(data.answer || '');
      if (!parsed) {
        throw new Error('AI response was not valid JSON.');
      }

      const spend1 = normalizeAiNumber(parsed.spend1);
      const conv1 = normalizeAiNumber(parsed.conv1);
      const spend2 = normalizeAiNumber(parsed.spend2);
      const conv2 = normalizeAiNumber(parsed.conv2);
      const aov = normalizeAiNumber(parsed.aov) ?? aovFallback;
      const marginPercent = normalizeAiNumber(parsed.margin) ?? marginFallback;
      const overhead = normalizeAiNumber(parsed.overhead) ?? overheadFallback ?? 0;

      const { results: nextResults, error } = buildBudgetResults({
        spend1,
        conv1,
        spend2,
        conv2,
        aov,
        marginPercent,
        overhead,
      });

      if (error) {
        throw new Error(error);
      }

      setInputs({
        spend1: spend1?.toString() || '',
        conv1: conv1?.toString() || '',
        spend2: spend2?.toString() || '',
        conv2: conv2?.toString() || '',
        aov: aov?.toString() || '',
        margin: marginPercent?.toString() || '',
        overhead: overhead?.toString() || '',
      });
      setAiSuggestion({
        spend1,
        conv1,
        spend2,
        conv2,
        aov,
        marginPercent,
        overhead,
        rationale: parsed.rationale || ''
      });
      setResults(nextResults);
      setErrorMessage('');
    } catch (error) {
      setAiError(error.message || 'Failed to generate AI results.');
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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">🤖 GPT-5.1 (Low Effort) Campaign Inputs</h2>
            <p className="text-sm text-gray-500">Use unified campaign data to generate two test points for the calculator.</p>
          </div>
          <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-3 py-1 rounded-full">
            {storeName || storeId || 'Store'}
          </span>
        </div>
        <div className="p-6 space-y-6">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-gray-700">Unified Campaigns</p>
                <p className="text-xs text-gray-500">Data fed from the AI Budget unified pipeline.</p>
              </div>
              <div className="text-xs text-gray-500 bg-white border border-gray-200 px-3 py-1 rounded-full">
                Lookback: {AI_LOOKBACK}
              </div>
            </div>
            <div className="mt-3 text-sm text-gray-600">
              {datasetLoading && 'Loading unified campaign data...'}
              {!datasetLoading && datasetError && (
                <span className="text-rose-500">{datasetError}</span>
              )}
              {!datasetLoading && !datasetError && (
                <span>
                  {availableCampaigns.length} campaigns available
                  {aiDataset?.dateRange?.effectiveStart && (
                    <span className="text-xs text-gray-400 ml-2">
                      ({aiDataset.dateRange.effectiveStart} → {aiDataset.dateRange.effectiveEnd})
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="campaignMode"
                  value="two"
                  checked={campaignMode === 'two'}
                  onChange={() => setCampaignMode('two')}
                />
                Two campaigns (two points)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="campaignMode"
                  value="all"
                  checked={campaignMode === 'all'}
                  onChange={() => setCampaignMode('all')}
                />
                All campaigns (ask GPT with your instructions)
              </label>
            </div>

            {campaignMode === 'two' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-600">Campaign A</label>
                  <select
                    value={campaignAId}
                    onChange={(event) => setCampaignAId(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={availableCampaigns.length === 0}
                  >
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
                    value={campaignBId}
                    onChange={(event) => setCampaignBId(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    disabled={availableCampaigns.length < 2}
                  >
                    {availableCampaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">What should GPT focus on?</label>
              <textarea
                value={campaignPrompt}
                onChange={(event) => setCampaignPrompt(event.target.value)}
                placeholder="Example: Use my best performing campaigns to create conservative test points. Keep ROAS stable."
                rows={3}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="text-xs text-gray-400">GPT-5.1 low effort will return two test points and apply them below.</p>
            </div>

            <button
              type="button"
              onClick={handleAiGenerate}
              disabled={aiLoading || datasetLoading}
              className="w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-500 disabled:bg-gray-300"
            >
              {aiLoading ? 'Generating with GPT-5.1 (low effort)...' : 'Generate calculator inputs'}
            </button>

            {aiError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {aiError}
              </div>
            )}

            {aiSuggestion && (
              <div className="rounded-xl border border-purple-100 bg-purple-50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-purple-700">GPT-5.1 Low Effort Output</p>
                  <span className="text-xs text-purple-600 bg-white px-2 py-0.5 rounded-full">Applied to calculator</span>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="bg-white rounded-lg border border-purple-100 p-3">
                    <p className="text-xs text-gray-400">Test 1</p>
                    <p className="text-sm font-semibold text-gray-800">${aiSuggestion.spend1} spend • {aiSuggestion.conv1} conv</p>
                  </div>
                  <div className="bg-white rounded-lg border border-purple-100 p-3">
                    <p className="text-xs text-gray-400">Test 2</p>
                    <p className="text-sm font-semibold text-gray-800">${aiSuggestion.spend2} spend • {aiSuggestion.conv2} conv</p>
                  </div>
                  <div className="bg-white rounded-lg border border-purple-100 p-3">
                    <p className="text-xs text-gray-400">AOV / Margin</p>
                    <p className="text-sm font-semibold text-gray-800">${aiSuggestion.aov} • {aiSuggestion.marginPercent}%</p>
                  </div>
                </div>
                {aiSuggestion.rationale && (
                  <p className="text-xs text-purple-700">{aiSuggestion.rationale}</p>
                )}
                <p className="text-xs text-gray-500">Full calculator results are shown below.</p>
              </div>
            )}
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
          {errorMessage && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {errorMessage}
            </div>
          )}
        </div>
      </div>

      {results && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
            <div className="border-b border-gray-100 px-6 py-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900">🎯 Your Results</h2>
                {aiSuggestion && (
                  <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-3 py-1 rounded-full">
                    GPT-5.1 low effort
                  </span>
                )}
              </div>
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
                  <tr>
                    <SortableHeader label="Daily Spend" sortKey="spend" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableHeader label="Conversions" sortKey="conv" sortConfig={sortConfig} onSort={handleSort} align="right" />
                    <SortableHeader label="Revenue" sortKey="revenue" sortConfig={sortConfig} onSort={handleSort} align="right" />
                    <SortableHeader label="ROAS" sortKey="roas" sortConfig={sortConfig} onSort={handleSort} align="right" />
                    <SortableHeader
                      label={results.hasOverhead ? 'Net Profit' : 'Daily Profit'}
                      sortKey="displayProfit"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                      align="right"
                    />
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
