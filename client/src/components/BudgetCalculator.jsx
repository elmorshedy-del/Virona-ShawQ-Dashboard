import { useMemo, useState } from 'react';

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

const DEFAULT_SORT = { key: 'spend', direction: 'asc' };

function getCampaignRunDays(campaign, fallbackDays) {
  const start = campaign?.startDate ? new Date(campaign.startDate) : null;
  const end = campaign?.endDate ? new Date(campaign.endDate) : null;
  if (start && end && !Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf())) {
    const diff = Math.ceil((end - start) / (24 * 60 * 60 * 1000)) + 1;
    if (diff > 0) return diff;
  }
  return Math.max(fallbackDays || 1, 1);
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return Number(value).toFixed(digits);
}

function sumCampaignMetrics(campaigns = []) {
  return campaigns.reduce((acc, campaign) => {
    acc.spend += Number(campaign?.spend || 0);
    acc.purchases += Number(campaign?.purchases || 0);
    acc.revenue += Number(campaign?.revenue || 0);
    return acc;
  }, { spend: 0, purchases: 0, revenue: 0 });
}

function getCampaignDailyMetrics(campaign, periodDays) {
  const days = getCampaignRunDays(campaign, periodDays);
  const spend = Number(campaign?.spend || 0);
  const purchases = Number(campaign?.purchases || 0);
  const revenue = Number(campaign?.revenue || 0);
  return {
    spendDaily: spend / days,
    purchasesDaily: purchases / days,
    aov: purchases > 0 ? revenue / purchases : 0,
    daysRunning: days,
    spend,
    purchases,
    revenue
  };
}

function buildCampaignPrompt({ mode, campaignA, campaignB, allCampaigns, periodDays, inputs, request, previousAnswer }) {
  const header = `You are a budget calculator assistant. Use the data below to compute the two-point model exactly like the calculator. This is always a country vs country comparison.`;
  const formatGuide = `Return the results in the same order and style as the calculator, including:
- B, a, Optimal Spend, Max Daily Profit, Ad Breakeven
- B Scale Interpretation
- Formula lines
- "What This Means" paragraph
- ROAS Predictions table with columns: Daily Spend, Conversions, Revenue, ROAS, Daily Profit`;

  const inputContext = `Calculator inputs:
spend1=${inputs.spend1 || '—'}
conv1=${inputs.conv1 || '—'}
spend2=${inputs.spend2 || '—'}
conv2=${inputs.conv2 || '—'}
aov=${inputs.aov || '—'}
margin=${inputs.margin || '—'}
overhead=${inputs.overhead || '0'}`;

  const followupContext = previousAnswer
    ? `Previous GPT output (use this for continuity):\n${previousAnswer}`
    : '';

  const campaignContext = mode === 'all'
    ? `All Campaigns (Unified data across campaigns with per-campaign run days):
${allCampaigns}`
    : `Campaign A:
${campaignA}

Campaign B:
${campaignB}`;

  return `${header}

${formatGuide}

${inputContext}

${campaignContext}

${followupContext}

User request: ${request}`;
}

export default function BudgetCalculator({ campaigns = [], periodDays = 30, storeName = '' }) {
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
  const [campaignMode, setCampaignMode] = useState('two');
  const [campaignAId, setCampaignAId] = useState('');
  const [campaignBId, setCampaignBId] = useState('');
  const [campaignError, setCampaignError] = useState('');
  const [countryPairLabel, setCountryPairLabel] = useState('');
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [gptQuery, setGptQuery] = useState('');
  const [gptLoading, setGptLoading] = useState(false);
  const [gptStreamingText, setGptStreamingText] = useState('');
  const [gptResult, setGptResult] = useState(null);
  const [gptModel, setGptModel] = useState(null);
  const [gptFollowup, setGptFollowup] = useState('');

  const updateInput = (key) => (event) => {
    setInputs((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const campaignOptions = useMemo(() => {
    return campaigns
      .filter((campaign) => campaign?.campaignId || campaign?.campaignName)
      .map((campaign) => ({
        id: `${campaign.campaignId || campaign.campaignName}::${campaign.country || '—'}`,
        campaignId: campaign.campaignId || campaign.campaignName,
        name: campaign.campaignName || 'Unnamed Campaign',
        country: campaign.country || '—',
        spend: campaign.spend || 0,
        purchases: campaign.purchases || 0,
        revenue: campaign.revenue || 0,
        countries: campaign.countries || '—',
        startDate: campaign.startDate || null,
        endDate: campaign.endDate || null
      }))
      .sort((a, b) => {
        const nameSort = a.name.localeCompare(b.name);
        if (nameSort !== 0) return nameSort;
        return a.country.localeCompare(b.country);
      });
  }, [campaigns]);

  const selectedCampaignA = useMemo(
    () => campaignOptions.find((campaign) => campaign.id === campaignAId),
    [campaignAId, campaignOptions]
  );
  const selectedCampaignB = useMemo(
    () => campaignOptions.find((campaign) => campaign.id === campaignBId),
    [campaignBId, campaignOptions]
  );

  const handleCampaignModeChange = (mode) => {
    setCampaignMode(mode);
    setCampaignError('');
    setCountryPairLabel('');
  };

  const applyCampaignInputs = () => {
    setCampaignError('');
    setCountryPairLabel('');
    if (campaignMode === 'two') {
      if (!selectedCampaignA || !selectedCampaignB) {
        setCampaignError('Select two campaigns to build the calculator points.');
        return;
      }

      if (selectedCampaignA.id === selectedCampaignB.id) {
        setCampaignError('Campaign A and Campaign B must be different.');
        return;
      }

      if ((selectedCampaignA.country || '—') === (selectedCampaignB.country || '—')) {
        setCampaignError('Choose two different countries for a country vs country comparison.');
        return;
      }

      const campaignA = getCampaignDailyMetrics(selectedCampaignA, periodDays);
      const campaignB = getCampaignDailyMetrics(selectedCampaignB, periodDays);

      if (!campaignA.spendDaily || !campaignA.purchasesDaily || !campaignB.spendDaily || !campaignB.purchasesDaily) {
        setCampaignError('Selected campaigns need spend and conversions to build the model.');
        return;
      }

      const combinedAov = [campaignA, campaignB]
        .filter((item) => item.purchases > 0)
        .reduce((acc, item) => acc + item.revenue, 0);
      const combinedPurchases = [campaignA, campaignB]
        .reduce((acc, item) => acc + item.purchases, 0);
      const aov = combinedPurchases > 0 ? combinedAov / combinedPurchases : 0;

      setInputs((prev) => ({
        ...prev,
        spend1: campaignA.spendDaily.toFixed(2),
        conv1: campaignA.purchasesDaily.toFixed(2),
        spend2: campaignB.spendDaily.toFixed(2),
        conv2: campaignB.purchasesDaily.toFixed(2),
        aov: aov > 0 ? aov.toFixed(2) : prev.aov
      }));
      setCountryPairLabel(`${selectedCampaignA.country || '—'} vs ${selectedCampaignB.country || '—'}`);
      return;
    }

    if (!campaignOptions.length) {
      setCampaignError('No unified campaigns available for this store.');
      return;
    }

    const countriesMap = new Map();
    campaignOptions.forEach((campaign) => {
      const key = campaign.country || '—';
      const existing = countriesMap.get(key) || [];
      existing.push(campaign);
      countriesMap.set(key, existing);
    });

    const countryEntries = Array.from(countriesMap.entries());
    if (countryEntries.length < 2) {
      setCampaignError('Need at least two countries for a country vs country comparison.');
      return;
    }

    const countrySummaries = countryEntries.map(([country, items]) => {
      const totals = sumCampaignMetrics(items);
      const dailySpend = items.reduce(
        (acc, campaign) => acc + getCampaignDailyMetrics(campaign, periodDays).spendDaily,
        0
      );
      const dailyPurchases = items.reduce(
        (acc, campaign) => acc + getCampaignDailyMetrics(campaign, periodDays).purchasesDaily,
        0
      );
      return {
        country,
        items,
        totals,
        dailySpend,
        dailyPurchases
      };
    }).sort((a, b) => b.totals.spend - a.totals.spend);

    const [primaryCountry, secondaryCountry] = countrySummaries;
    if (!primaryCountry || !secondaryCountry) {
      setCampaignError('Unable to resolve two countries for the comparison.');
      return;
    }

    const highTotals = primaryCountry.totals;
    const lowTotals = secondaryCountry.totals;

    const highDailySpend = primaryCountry.dailySpend;
    const highDailyPurchases = primaryCountry.dailyPurchases;
    const lowDailySpend = secondaryCountry.dailySpend;
    const lowDailyPurchases = secondaryCountry.dailyPurchases;

    if (!highDailySpend || !highDailyPurchases || !lowDailySpend || !lowDailyPurchases) {
      setCampaignError('Unified campaigns need spend and conversions to build the model.');
      return;
    }

    const totalPurchases = highTotals.purchases + lowTotals.purchases;
    const totalRevenue = highTotals.revenue + lowTotals.revenue;
    const aov = totalPurchases > 0 ? totalRevenue / totalPurchases : 0;

    setInputs((prev) => ({
      ...prev,
      spend1: lowDailySpend.toFixed(2),
      conv1: lowDailyPurchases.toFixed(2),
      spend2: highDailySpend.toFixed(2),
      conv2: highDailyPurchases.toFixed(2),
      aov: aov > 0 ? aov.toFixed(2) : prev.aov
    }));
    setCountryPairLabel(`${secondaryCountry.country} vs ${primaryCountry.country}`);
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const buildSortIndicator = (key) => {
    if (sortConfig.key !== key) return <span className="ml-1 text-xs text-gray-300">↕</span>;
    return (
      <span className="ml-1 text-xs text-gray-500">
        {sortConfig.direction === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  const handleCalculate = () => {
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
    if (!results) return [];
    const sorted = [...results.predictions];
    sorted.sort((left, right) => {
      const leftValue = left[sortConfig.key];
      const rightValue = right[sortConfig.key];
      if (leftValue === rightValue) return 0;
      if (sortConfig.direction === 'asc') return leftValue > rightValue ? 1 : -1;
      return leftValue < rightValue ? 1 : -1;
    });
    return sorted;
  }, [results, sortConfig]);

  const allCampaignContext = useMemo(() => {
    if (!campaignOptions.length) return 'No unified campaign data available.';
    return campaignOptions.map((campaign) => {
      const daily = getCampaignDailyMetrics(campaign, periodDays);
      return `• ${campaign.name} (${campaign.country || campaign.countries || '—'}): spend ${formatCurrency(daily.spendDaily)}/day over ${daily.daysRunning} days, purchases ${formatNumber(daily.purchasesDaily)}, revenue ${formatCurrency(daily.revenue)}`;
    }).join('\n');
  }, [campaignOptions, periodDays]);

  const campaignAContext = useMemo(() => {
    if (!selectedCampaignA) return 'Campaign A not selected.';
    const daily = getCampaignDailyMetrics(selectedCampaignA, periodDays);
    return `${selectedCampaignA.name} (${selectedCampaignA.country || selectedCampaignA.countries || '—'}): spend ${formatCurrency(daily.spendDaily)}/day over ${daily.daysRunning} days, purchases ${formatNumber(daily.purchasesDaily)}, revenue ${formatCurrency(daily.revenue)}`;
  }, [selectedCampaignA, periodDays]);

  const campaignBContext = useMemo(() => {
    if (!selectedCampaignB) return 'Campaign B not selected.';
    const daily = getCampaignDailyMetrics(selectedCampaignB, periodDays);
    return `${selectedCampaignB.name} (${selectedCampaignB.country || selectedCampaignB.countries || '—'}): spend ${formatCurrency(daily.spendDaily)}/day over ${daily.daysRunning} days, purchases ${formatNumber(daily.purchasesDaily)}, revenue ${formatCurrency(daily.revenue)}`;
  }, [selectedCampaignB, periodDays]);

  const runGptRequest = async (requestText, previousAnswer = '') => {
    const prompt = buildCampaignPrompt({
      mode: campaignMode,
      campaignA: campaignAContext,
      campaignB: campaignBContext,
      allCampaigns: allCampaignContext,
      periodDays,
      inputs,
      request: requestText,
      previousAnswer
    });

    const response = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: prompt,
        store: storeName || 'vironax',
        depth: 'fast'
      })
    });

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No streaming response available.');
    }

    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        try {
          const data = JSON.parse(payload);
          if (data.type === 'delta') {
            fullText += data.text;
            setGptStreamingText(fullText);
          } else if (data.type === 'done') {
            setGptModel(data.model);
            setGptResult(fullText);
            setGptStreamingText('');
          } else if (data.type === 'error') {
            throw new Error(data.error || 'GPT request failed.');
          }
        } catch (parseError) {
          console.error('[BudgetCalculator] GPT stream parse error', parseError);
        }
      }
    }
  };

  const handleGptSubmit = async (event) => {
    event?.preventDefault();
    if (!gptQuery.trim() || gptLoading) return;

    setGptLoading(true);
    setGptStreamingText('');
    setGptResult(null);
    setGptModel(null);

    try {
      await runGptRequest(gptQuery.trim());
    } catch (error) {
      setGptResult(`Error: ${error.message}`);
    } finally {
      setGptLoading(false);
    }
  };

  const handleGptFollowup = async (event) => {
    event?.preventDefault();
    if (!gptFollowup.trim() || gptLoading) return;

    setGptLoading(true);
    setGptStreamingText('');
    setGptResult(null);
    setGptModel(null);

    try {
      await runGptRequest(gptFollowup.trim(), gptResult || '');
      setGptFollowup('');
    } catch (error) {
      setGptResult(`Error: ${error.message}`);
    } finally {
      setGptLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">🧩 Unified Campaigns Input</h2>
          <p className="text-xs text-gray-400 mt-1">Campaigns are fed from the unified campaign data source.</p>
        </div>
        <div className="p-6 space-y-5">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => handleCampaignModeChange('two')}
              className={`px-4 py-2 rounded-full border text-sm font-medium transition ${
                campaignMode === 'two'
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-indigo-200 hover:text-indigo-600'
              }`}
            >
              Two Campaigns (Country vs Country)
            </button>
            <button
              type="button"
              onClick={() => handleCampaignModeChange('all')}
              className={`px-4 py-2 rounded-full border text-sm font-medium transition ${
                campaignMode === 'all'
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-indigo-200 hover:text-indigo-600'
              }`}
            >
              All Campaigns (Top Countries)
            </button>
          </div>

          {campaignMode === 'two' && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">Campaign A</label>
                <select
                  value={campaignAId}
                  onChange={(event) => setCampaignAId(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select campaign</option>
                  {campaignOptions.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name} • {campaign.country || '—'}
                    </option>
                  ))}
                </select>
                {selectedCampaignA && (
                  <p className="text-xs text-gray-400">
                    {formatCurrency(getCampaignDailyMetrics(selectedCampaignA, periodDays).spendDaily)}/day •
                    {` ${formatNumber(getCampaignDailyMetrics(selectedCampaignA, periodDays).purchasesDaily)} purchases/day`}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-600">Campaign B</label>
                <select
                  value={campaignBId}
                  onChange={(event) => setCampaignBId(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select campaign</option>
                  {campaignOptions.map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name} • {campaign.country || '—'}
                    </option>
                  ))}
                </select>
                {selectedCampaignB && (
                  <p className="text-xs text-gray-400">
                    {formatCurrency(getCampaignDailyMetrics(selectedCampaignB, periodDays).spendDaily)}/day •
                    {` ${formatNumber(getCampaignDailyMetrics(selectedCampaignB, periodDays).purchasesDaily)} purchases/day`}
                  </p>
                )}
              </div>
            </div>
          )}

          {campaignMode === 'all' && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-indigo-700">
              Unified campaigns are split into high-spend and low-spend groups to create two calculator points.
            </div>
          )}

          {campaignError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
              {campaignError}
            </div>
          )}

          {countryPairLabel && !campaignError && (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              Country comparison: <span className="font-semibold">{countryPairLabel}</span>
            </div>
          )}

          <button
            type="button"
            onClick={applyCampaignInputs}
            className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100"
          >
            Use Unified Campaign Data
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">🤖 ChatGPT 5.1 (Low Effort)</h2>
          <p className="text-xs text-gray-400 mt-1">Explain what you want, and GPT will compute results using your unified campaign data.</p>
        </div>
        <div className="p-6 space-y-4">
          <form onSubmit={handleGptSubmit} className="space-y-3">
            <textarea
              value={gptQuery}
              onChange={(event) => setGptQuery(event.target.value)}
              placeholder="Describe how you want the calculator to interpret these campaigns..."
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <button
              type="submit"
              disabled={gptLoading || !gptQuery.trim()}
              className="w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-700 disabled:bg-gray-300"
            >
              {gptLoading ? 'Thinking...' : 'Run GPT-5.1 (Low Effort)'}
            </button>
          </form>

          {(gptStreamingText || gptResult) && (
            <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-4">
              <h3 className="text-sm font-semibold text-purple-700 mb-2">GPT Result</h3>
              <div className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed">
                {gptStreamingText || gptResult}
                {gptLoading && <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1" />}
              </div>
              {gptModel && !gptLoading && (
                <p className="text-xs text-purple-400 mt-3">Answered by {gptModel}</p>
              )}
            </div>
          )}

          {!!gptResult && !gptLoading && (
            <form onSubmit={handleGptFollowup} className="space-y-2">
              <label className="text-xs font-medium text-purple-600">Follow-up prompt</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={gptFollowup}
                  onChange={(event) => setGptFollowup(event.target.value)}
                  placeholder="Ask a follow-up based on the results..."
                  className="flex-1 rounded-xl border border-purple-100 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
                <button
                  type="submit"
                  disabled={!gptFollowup.trim()}
                  className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-700 disabled:bg-gray-300"
                >
                  Send
                </button>
              </div>
            </form>
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
                    <th className="py-2 text-left cursor-pointer" onClick={() => handleSort('spend')}>
                      Daily Spend {buildSortIndicator('spend')}
                    </th>
                    <th className="py-2 text-right cursor-pointer" onClick={() => handleSort('conv')}>
                      Conversions {buildSortIndicator('conv')}
                    </th>
                    <th className="py-2 text-right cursor-pointer" onClick={() => handleSort('revenue')}>
                      Revenue {buildSortIndicator('revenue')}
                    </th>
                    <th className="py-2 text-right cursor-pointer" onClick={() => handleSort('roas')}>
                      ROAS {buildSortIndicator('roas')}
                    </th>
                    <th className="py-2 text-right cursor-pointer" onClick={() => handleSort('displayProfit')}>
                      {results.hasOverhead ? 'Net Profit' : 'Daily Profit'} {buildSortIndicator('displayProfit')}
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
