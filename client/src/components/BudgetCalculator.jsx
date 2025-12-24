import { useMemo, useRef, useState } from 'react';

const DEFAULT_SPEND_LEVELS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];

export default function BudgetCalculator() {
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
  const resultsRef = useRef(null);

  const hasResults = Boolean(results);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setInputs((prev) => ({ ...prev, [name]: value }));
  };

  const calculate = () => {
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
      for (let i = 0; i < 50; i++) {
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
    const profitAtOptimal = (revenueAtOptimal * margin) - optimal - dailyOverhead;

    const bPosition = Math.min(Math.max((B - 0.1) / 1.0, 0), 1) * 100;

    const formula = `
      <strong>Your Formula:</strong><br>
      Conversions = ${a.toFixed(4)} × Spend<sup>${B.toFixed(2)}</sup><br>
      ROAS = ${(a * aov).toFixed(2)} × Spend<sup>${(B - 1).toFixed(2)}</sup>
    `;

    let interpretation = '';
    const overheadText = hasOverhead
      ? `<br>🏢 <strong>Real Ceiling: $${Math.round(realCeiling)}/day</strong> (covers $${Math.round(
          monthlyOverhead,
        )}/mo overhead)`
      : '';

    if (B >= 1) {
      interpretation = `<strong>B = ${B.toFixed(2)} → INCREASING RETURNS!</strong><br><br>
          This is unusual and great. Your market was starved at the lower budget. 
          More spend = better efficiency. Scale aggressively until ROAS starts dropping.`;
    } else if (B >= 0.7) {
      interpretation = `<strong>B = ${B.toFixed(2)} → Good scalability</strong><br><br>
          You can scale significantly before hitting diminishing returns.<br><br>
          💰 <strong>Optimal: $${Math.round(optimal)}/day</strong> (max profit: $${Math.round(
            profitAtOptimal,
          )}/day)<br>
          ⚠️ <strong>Ad Breakeven: $${Math.round(ceiling)}/day</strong>${overheadText}`;
    } else if (B >= 0.5) {
      interpretation = `<strong>B = ${B.toFixed(2)} → Moderate scalability</strong><br><br>
          You'll see diminishing returns as you scale, but there's still room.<br><br>
          💰 <strong>Optimal: $${Math.round(optimal)}/day</strong> (max profit: $${Math.round(
            profitAtOptimal,
          )}/day)<br>
          ⚠️ <strong>Ad Breakeven: $${Math.round(ceiling)}/day</strong>${overheadText}`;
    } else if (B >= 0.3) {
      interpretation = `<strong>B = ${B.toFixed(2)} → Limited scalability</strong><br><br>
          Efficiency drops fast when you scale.<br><br>
          💰 <strong>Optimal: $${Math.round(optimal)}/day</strong> (max profit: $${Math.round(
            profitAtOptimal,
          )}/day)<br>
          ⚠️ <strong>Ad Breakeven: $${Math.round(ceiling)}/day</strong>${overheadText}`;
    } else {
      interpretation = `<strong>B = ${B.toFixed(2)} → Very limited scalability</strong><br><br>
          This market saturates quickly. Scaling kills efficiency fast.<br><br>
          💰 <strong>Optimal: $${Math.round(optimal)}/day</strong> (max profit: $${Math.round(
            profitAtOptimal,
          )}/day)<br>
          ⚠️ <strong>Ad Breakeven: $${Math.round(ceiling)}/day</strong>${overheadText}`;
    }

    setResults({
      B,
      a,
      ceiling,
      optimal,
      profitAtOptimal,
      realCeiling,
      hasOverhead,
      dailyOverhead,
      monthlyOverhead,
      bPosition,
      formula,
      interpretation,
    });

    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const spendLevels = useMemo(() => {
    if (!results) {
      return DEFAULT_SPEND_LEVELS;
    }

    let levels = [...DEFAULT_SPEND_LEVELS];

    if (results.optimal !== Infinity && results.optimal > 5 && results.optimal < 200) {
      levels.push(Math.round(results.optimal));
    }
    if (results.hasOverhead && results.realCeiling > 5 && results.realCeiling < 200) {
      levels.push(Math.round(results.realCeiling));
    }
    if (results.ceiling !== Infinity && results.ceiling > 5 && results.ceiling < 200) {
      levels.push(Math.round(results.ceiling));
    }

    levels.sort((a, b) => a - b);

    return [...new Set(levels)];
  }, [results]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Meta Ads Budget Ceiling Calculator</h2>
            <p className="text-sm text-gray-500">Find your optimal budget using the Power Law formula</p>
          </div>
          <button
            type="button"
            onClick={calculate}
            className="px-6 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold shadow-sm hover:bg-gray-800 transition"
          >
            Calculate Ceiling
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-2 text-sm text-gray-600">
            Test 1: Daily Spend ($)
            <input
              name="spend1"
              type="number"
              step="0.01"
              placeholder="8"
              value={inputs.spend1}
              onChange={handleInputChange}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span className="text-xs text-gray-400">Lower budget test</span>
          </label>
          <label className="flex flex-col gap-2 text-sm text-gray-600">
            Test 1: Daily Conversions
            <input
              name="conv1"
              type="number"
              step="0.01"
              placeholder="0.33"
              value={inputs.conv1}
              onChange={handleInputChange}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span className="text-xs text-gray-400">Purchases per day</span>
          </label>
          <label className="flex flex-col gap-2 text-sm text-gray-600">
            Test 2: Daily Spend ($)
            <input
              name="spend2"
              type="number"
              step="0.01"
              placeholder="49"
              value={inputs.spend2}
              onChange={handleInputChange}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span className="text-xs text-gray-400">Higher budget test</span>
          </label>
          <label className="flex flex-col gap-2 text-sm text-gray-600">
            Test 2: Daily Conversions
            <input
              name="conv2"
              type="number"
              step="0.01"
              placeholder="1.0"
              value={inputs.conv2}
              onChange={handleInputChange}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span className="text-xs text-gray-400">Purchases per day</span>
          </label>
          <label className="flex flex-col gap-2 text-sm text-gray-600">
            Average Order Value ($)
            <input
              name="aov"
              type="number"
              step="0.01"
              placeholder="113"
              value={inputs.aov}
              onChange={handleInputChange}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span className="text-xs text-gray-400">Revenue per purchase</span>
          </label>
          <label className="flex flex-col gap-2 text-sm text-gray-600">
            Profit Margin (%)
            <input
              name="margin"
              type="number"
              step="1"
              placeholder="35"
              value={inputs.margin}
              onChange={handleInputChange}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span className="text-xs text-gray-400">Your profit margin</span>
          </label>
          <label className="flex flex-col gap-2 text-sm text-gray-600">
            Monthly Overhead ($) <span className="text-xs text-gray-400">(optional)</span>
            <input
              name="overhead"
              type="number"
              step="1"
              placeholder="0"
              value={inputs.overhead}
              onChange={handleInputChange}
              className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <span className="text-xs text-gray-400">Rent, salaries, software, etc.</span>
          </label>
        </div>
      </div>

      {hasResults && (
        <div ref={resultsRef} className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Results</h3>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
                <div
                  className={`text-2xl font-semibold ${
                    results.B >= 1 ? 'text-emerald-600' : results.B < 0.4 ? 'text-rose-500' : 'text-gray-900'
                  }`}
                >
                  {results.B.toFixed(2)}
                </div>
                <div className="text-xs text-gray-500">B (Decay Rate)</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center">
                <div className="text-2xl font-semibold text-gray-900">{results.a.toFixed(4)}</div>
                <div className="text-xs text-gray-500">a (Base Efficiency)</div>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                <div className="text-2xl font-semibold text-emerald-600">
                  {results.optimal === Infinity ? '∞' : `$${Math.round(results.optimal)}`}
                </div>
                <div className="text-xs text-gray-500">💰 Optimal Spend</div>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-center">
                <div className="text-2xl font-semibold text-emerald-600">
                  {results.optimal === Infinity ? '∞' : `$${Math.round(results.profitAtOptimal)}`}
                </div>
                <div className="text-xs text-gray-500">💵 Max Daily Profit</div>
              </div>
              {results.hasOverhead && (
                <div className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-center">
                  <div className="text-2xl font-semibold text-sky-600">$ {Math.round(results.realCeiling)}</div>
                  <div className="text-xs text-gray-500">🎯 Real Ceiling</div>
                </div>
              )}
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-center">
                <div className="text-2xl font-semibold text-amber-600">
                  {results.ceiling === Infinity ? '∞' : `$${Math.round(results.ceiling)}`}
                </div>
                <div className="text-xs text-gray-500">⚠️ Ad Breakeven</div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="text-sm font-semibold text-gray-700">B Scale Interpretation:</div>
              <div className="mt-3 h-2 rounded-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-400 relative">
                <span
                  className="absolute -top-2 h-5 w-5 rounded-full bg-white shadow"
                  style={{ left: `${results.bPosition}%`, transform: 'translateX(-50%)' }}
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
              <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-700">
                📌 With ${Math.round(results.monthlyOverhead)}/month overhead, you need ${
                  Math.round(results.dailyOverhead)
                }/day profit just to break even on business costs.
              </div>
            )}

            <div
              className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700"
              dangerouslySetInnerHTML={{ __html: results.formula }}
            />

            <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50 p-4">
              <h4 className="text-sm font-semibold text-sky-700 mb-2">💡 What This Means</h4>
              <p
                className="text-sm text-gray-600 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: results.interpretation }}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">ROAS Predictions</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-gray-600">
                <thead className="text-xs uppercase text-gray-400 border-b border-gray-100">
                  <tr>
                    <th className="py-3 text-left">Daily Spend</th>
                    <th className="py-3 text-right">Conversions</th>
                    <th className="py-3 text-right">Revenue</th>
                    <th className="py-3 text-right">ROAS</th>
                    <th className="py-3 text-right">{results.hasOverhead ? 'Net Profit' : 'Daily Profit'}</th>
                  </tr>
                </thead>
                <tbody>
                  {spendLevels.map((spend) => {
                    const conv = results.a * Math.pow(spend, results.B);
                    const revenue = conv * parseFloat(inputs.aov);
                    const roas = revenue / spend;
                    const adProfit = (revenue * (parseFloat(inputs.margin) / 100)) - spend;
                    const netProfit = adProfit - results.dailyOverhead;
                    const displayProfit = results.hasOverhead ? netProfit : adProfit;

                    const isOptimal = Math.abs(spend - results.optimal) < 2;
                    const isRealCeiling = results.hasOverhead && Math.abs(spend - results.realCeiling) < 2;
                    const isCeiling = Math.abs(spend - results.ceiling) < 2;

                    let rowClass = 'border-b border-gray-100';
                    if (isOptimal) {
                      rowClass = 'bg-emerald-50 text-emerald-700 font-semibold';
                    } else if (isRealCeiling) {
                      rowClass = 'bg-sky-50 text-sky-700 font-semibold';
                    } else if (isCeiling) {
                      rowClass = 'bg-amber-50 text-amber-700 font-semibold';
                    } else if (displayProfit >= 0) {
                      rowClass = 'text-emerald-600';
                    } else {
                      rowClass = 'text-rose-500';
                    }

                    const profitStr = displayProfit >= 0
                      ? `$${Math.round(displayProfit)}`
                      : `-$${Math.round(Math.abs(displayProfit))}`;

                    let label = '';
                    if (isOptimal) label = ' 💰 OPTIMAL';
                    else if (isRealCeiling) label = ' 🎯 REAL CEILING';
                    else if (isCeiling) label = ' ⚠️ AD BREAKEVEN';

                    return (
                      <tr key={spend} className={rowClass}>
                        <td className="py-3 text-left">${spend}{label}</td>
                        <td className="py-3 text-right">{conv.toFixed(2)}</td>
                        <td className="py-3 text-right">${Math.round(revenue)}</td>
                        <td className="py-3 text-right">{roas.toFixed(2)}</td>
                        <td className="py-3 text-right">{profitStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
