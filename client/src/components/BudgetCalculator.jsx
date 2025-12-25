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

export default function BudgetCalculator({ budgetIntelligence = null, store = null }) {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiNotes, setAiNotes] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatModel, setChatModel] = useState('');
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

  const unifiedCampaign = useMemo(() => {
    const rows = Array.isArray(budgetIntelligence?.liveGuidance) ? budgetIntelligence.liveGuidance : [];
    if (rows.length === 0) return null;

    return rows.reduce((acc, row) => ({
      campaignId: 'unified',
      campaignName: 'All Campaigns (Unified)',
      spend: acc.spend + (row.spend || 0),
      purchases: acc.purchases + (row.purchases || 0),
      revenue: acc.revenue + (row.revenue || 0)
    }), {
      campaignId: 'unified',
      campaignName: 'All Campaigns (Unified)',
      spend: 0,
      purchases: 0,
      revenue: 0
    });
  }, [budgetIntelligence]);

  const calculatorMath = `B = ln(conv2/conv1) / ln(spend2/spend1)
a = conv1 / (spend1^B)
breakeven ROAS = 1 / margin`;

  const unifiedPayload = useMemo(() => {
    if (!unifiedCampaign) return null;
    const periodDays = budgetIntelligence?.period?.days || null;
    const avgAov = unifiedCampaign.purchases > 0
      ? unifiedCampaign.revenue / unifiedCampaign.purchases
      : null;

    return {
      campaignId: unifiedCampaign.campaignId,
      campaignName: unifiedCampaign.campaignName,
      spend: unifiedCampaign.spend || 0,
      purchases: unifiedCampaign.purchases || 0,
      revenue: unifiedCampaign.revenue || 0,
      aov: avgAov,
      periodDays
    };
  }, [budgetIntelligence, unifiedCampaign]);

  const buildUnifiedPrompt = (extraInstructions = '') => `
You are a budget calculator assistant. You must use the exact calculator math below.

Calculator math:
${calculatorMath}

Unified campaign data (aggregated):
${JSON.stringify(unifiedPayload)}

Constraints:
- spend1 > 0, spend2 > spend1
- conv1 > 0, conv2 > conv1
- aov > 0
- margin is a percent (0-100)
- overhead is monthly (can be 0)

${extraInstructions}
`.trim();

  const updateInput = (key) => (event) => {
    setInputs((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const handleGenerateFromCampaign = async () => {
    setAiError('');
    setAiNotes('');
    setAiModel('');

    if (!store) {
      setAiError('Select a store before using GPT-5.1 High autofill.');
      return;
    }

    if (!unifiedCampaign || !unifiedPayload) {
      setAiError('Unified campaign data is not available yet.');
      return;
    }

    const prompt = `${buildUnifiedPrompt(
      'Use the unified campaign data to generate two daily test points that align with the calculator math.'
    )}

Return ONLY valid JSON with numeric fields:
{"spend1":number,"conv1":number,"spend2":number,"conv2":number,"aov":number,"margin":number,"overhead":number,"notes":"string"}
If data is insufficient, set notes to explain assumptions and still provide reasonable values.`;

    setAiLoading(true);
    try {
      const response = await fetch('/api/ai/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: prompt,
          store,
          depth: 'deep'
        })
      });

      const data = await response.json();
      if (!data?.success) {
        throw new Error(data?.error || 'Failed to generate campaign inputs.');
      }

      let parsed;
      try {
        parsed = JSON.parse(data.answer);
      } catch (parseError) {
        throw new Error('GPT response was not valid JSON. Please try again.');
      }

      const toNumber = (value) => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') return parseFloat(value);
        return Number.NaN;
      };

      const spend1 = toNumber(parsed.spend1);
      const conv1 = toNumber(parsed.conv1);
      const spend2 = toNumber(parsed.spend2);
      const conv2 = toNumber(parsed.conv2);
      const aov = toNumber(parsed.aov);
      const margin = toNumber(parsed.margin);
      const overhead = Number.isFinite(toNumber(parsed.overhead)) ? toNumber(parsed.overhead) : 0;

      if (![spend1, conv1, spend2, conv2, aov, margin].every((val) => Number.isFinite(val) && val > 0)) {
        throw new Error('GPT response contained invalid numeric values.');
      }

      if (spend2 <= spend1 || conv2 <= conv1) {
        throw new Error('GPT response did not meet spend/conversion constraints.');
      }

      setInputs({
        spend1: spend1.toFixed(2),
        conv1: conv1.toFixed(2),
        spend2: spend2.toFixed(2),
        conv2: conv2.toFixed(2),
        aov: aov.toFixed(2),
        margin: margin.toFixed(2),
        overhead: overhead ? overhead.toFixed(2) : ''
      });
      setAiNotes(parsed.notes || '');
      setAiModel(data.model || '');
    } catch (error) {
      setAiError(error.message || 'Failed to generate inputs.');
    } finally {
      setAiLoading(false);
    }
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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">🧠 GPT-5.1 High Autofill</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-500">
            Generate calculator inputs using unified campaign performance data and GPT-5.1 (high reasoning).
          </p>
          <div className="rounded-lg border border-purple-100 bg-purple-50 px-4 py-3 text-sm text-purple-700">
            {unifiedCampaign ? (
              <div className="space-y-1">
                <p className="font-semibold">{unifiedCampaign.campaignName}</p>
                <p>Spend: ${Math.round(unifiedCampaign.spend || 0).toLocaleString()}</p>
                <p>Purchases: {Math.round(unifiedCampaign.purchases || 0).toLocaleString()}</p>
                <p>Revenue: ${Math.round(unifiedCampaign.revenue || 0).toLocaleString()}</p>
              </div>
            ) : (
              <p>Unified campaign data is not available yet.</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleGenerateFromCampaign}
            disabled={aiLoading || !unifiedCampaign}
            className="w-full rounded-lg bg-purple-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-300"
          >
            {aiLoading ? 'Generating…' : 'Generate Inputs'}
          </button>
          {aiError && (
            <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-600">
              {aiError}
            </div>
          )}
          {(aiNotes || aiModel) && (
            <div className="rounded-lg border border-purple-100 bg-purple-50 p-3 text-sm text-purple-700 space-y-1">
              {aiNotes && <p>{aiNotes}</p>}
              {aiModel && <p className="text-xs text-purple-500">Model: {aiModel}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">💬 Budget Calculator Chat (GPT-5.1 High)</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-500">
            Chat with GPT-5.1 using the calculator math and unified campaign data. Ask for projections,
            sanity checks, or how inputs affect the model.
          </p>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3 max-h-80 overflow-y-auto">
            {chatMessages.length === 0 && (
              <p className="text-sm text-gray-400">Ask a question to start the calculator chat.</p>
            )}
            {chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'text-right' : 'text-left'}>
                <div
                  className={`inline-block rounded-2xl px-4 py-2 text-sm ${
                    message.role === 'user'
                      ? 'bg-purple-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-700'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>
          {chatError && (
            <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-600">
              {chatError}
            </div>
          )}
          {chatModel && !chatLoading && (
            <p className="text-xs text-gray-400">Answered by {chatModel}</p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (chatLoading || !chatInput.trim()) return;
              if (!unifiedCampaign || !unifiedPayload) {
                setChatError('Unified campaign data is not available yet.');
                return;
              }
              setChatError('');
              const userMessage = chatInput.trim();
              setChatInput('');
              setChatLoading(true);
              setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);

              const transcript = [...chatMessages, { role: 'user', content: userMessage }]
                .slice(-6)
                .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
                .join('\n');

              const chatPrompt = `${buildUnifiedPrompt(
                'Answer the user question using the calculator math and unified data. Provide calculations when helpful.'
              )}

Conversation:
${transcript}

User question: ${userMessage}`;

              fetch('/api/ai/decide', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  question: chatPrompt,
                  store,
                  depth: 'deep'
                })
              })
                .then((response) => response.json())
                .then((data) => {
                  if (!data?.success) {
                    throw new Error(data?.error || 'Failed to get a chat response.');
                  }
                  setChatMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]);
                  setChatModel(data.model || '');
                })
                .catch((error) => {
                  setChatError(error.message || 'Failed to get a chat response.');
                })
                .finally(() => {
                  setChatLoading(false);
                });
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Ask about budgets, ROAS, or test points..."
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              disabled={chatLoading}
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:bg-purple-300"
            >
              {chatLoading ? 'Sending…' : 'Send'}
            </button>
          </form>
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
                    <th className="py-2 text-left">Daily Spend</th>
                    <th className="py-2 text-right">Conversions</th>
                    <th className="py-2 text-right">Revenue</th>
                    <th className="py-2 text-right">ROAS</th>
                    <th className="py-2 text-right">{results.hasOverhead ? 'Net Profit' : 'Daily Profit'}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.predictions.map((row) => (
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
