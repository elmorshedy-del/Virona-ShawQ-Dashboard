import { useEffect, useMemo, useState } from 'react';

const API_BASE = '/api';

function providerLabel(provider) {
  if (!provider) return 'Not configured';
  if (provider === 'currencyfreaks') return 'CurrencyFreaks';
  if (provider === 'oxr') return 'Open Exchange Rates (OXR)';
  if (provider === 'apilayer') return 'APILayer';
  if (provider === 'frankfurter') return 'Frankfurter (ECB)';
  return provider;
}

export default function ExchangeRateDebug() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backfillDate, setBackfillDate] = useState('');
  const [backfillTier, setBackfillTier] = useState('primary_backfill');
  const [backfillResult, setBackfillResult] = useState(null);

  const loadDebugData = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/exchange-rates/debug`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || 'Failed to load exchange rate data.');
      }
    } catch (err) {
      setError(err.message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackfillSingle = async () => {
    if (!backfillDate) return;
    setBackfillResult(null);
    try {
      const res = await fetch(`${API_BASE}/exchange-rates/backfill-single`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: backfillDate, tier: backfillTier })
      });
      const json = await res.json();
      setBackfillResult(json);
      if (json.success) {
        loadDebugData();
      }
    } catch (err) {
      setBackfillResult({ success: false, error: err.message });
    }
  };

  useEffect(() => {
    loadDebugData();
  }, []);

  const tierOptions = useMemo(() => {
    const strategy = data?.providerStrategy;
    return [
      {
        id: 'primary_backfill',
        label: `Primary (Backfill) - ${providerLabel(strategy?.primaryBackfillProvider)}`,
        description: 'Best for missing historical dates.'
      },
      {
        id: 'primary_daily',
        label: `Primary (Daily) - ${providerLabel(strategy?.dailyProvider)}`,
        description: 'Uses CurrencyFreaks (latest for yesterday; historical for other dates).'
      },
      {
        id: 'secondary_backfill',
        label: `Secondary (Backfill) - ${providerLabel(strategy?.secondaryBackfillProvider)}`,
        description: 'Fallback when Primary (Backfill) cannot return a rate.',
        disabled: !strategy?.secondaryBackfillProvider
      }
    ];
  }, [data?.providerStrategy]);

  if (loading && !data) {
    return <div className="p-4 text-gray-500">Loading exchange rate data...</div>;
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
        <button onClick={loadDebugData} className="mt-2 px-3 py-1 bg-gray-100 rounded text-sm">
          Retry
        </button>
      </div>
    );
  }

  const { summary, rates, conversionStats, missingDates, providerStrategy, usageByProvider } = data || {};

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Exchange Rates</h2>
          <p className="text-sm text-gray-500">TRY to USD conversion tracking for Shawq</p>
        </div>
        <button
          onClick={loadDebugData}
          className="px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          Refresh
        </button>
      </div>

      {/* Provider strategy */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-medium">Provider Strategy</h3>
        <p className="text-sm text-gray-500 mt-1">These are your configured sources (no secrets shown).</p>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="p-3 rounded-lg border bg-gray-50">
            <div className="text-gray-500">Primary (Daily)</div>
            <div className="font-medium">{providerLabel(providerStrategy?.dailyProvider)}</div>
          </div>
          <div className="p-3 rounded-lg border bg-gray-50">
            <div className="text-gray-500">Primary (Backfill)</div>
            <div className="font-medium">{providerLabel(providerStrategy?.primaryBackfillProvider)}</div>
          </div>
          <div className="p-3 rounded-lg border bg-gray-50">
            <div className="text-gray-500">Secondary (Backfill)</div>
            <div className="font-medium">{providerLabel(providerStrategy?.secondaryBackfillProvider)}</div>
          </div>
        </div>
        {usageByProvider && (
          <div className="mt-3 text-xs text-gray-500">
            External calls this month (by provider): {Object.entries(usageByProvider).map(([k, v]) => `${k}:${v}`).join(', ') || 'None'}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="text-2xl font-bold text-blue-600">{summary?.totalRatesStored || 0}</div>
          <div className="text-sm text-gray-500">Rates Stored (Last 60)</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="text-2xl font-bold text-green-600">{summary?.currencyfreaksCallsRemainingEstimate ?? 0}</div>
          <div className="text-sm text-gray-500">CurrencyFreaks Calls Left (Est.)</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="text-2xl font-bold text-orange-600">{summary?.totalExternalCallsThisMonth || 0}</div>
          <div className="text-sm text-gray-500">External Calls (Month)</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="text-2xl font-bold text-red-600">{summary?.missingDatesCount || 0}</div>
          <div className="text-sm text-gray-500">Missing Dates</div>
        </div>
      </div>

      {/* Manual Backfill */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-medium">Manual Rate Fetch</h3>
        <p className="text-sm text-gray-500 mt-1">Choose a date and a source. We never hardcode or infer rates.</p>

        <div className="mt-3 flex flex-col md:flex-row gap-2 md:items-end">
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">Date</label>
            <input
              type="date"
              value={backfillDate}
              onChange={(e) => setBackfillDate(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col flex-1">
            <label className="text-xs text-gray-500 mb-1">Source</label>
            <select
              value={backfillTier}
              onChange={(e) => setBackfillTier(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              {tierOptions.map((opt) => (
                <option key={opt.id} value={opt.id} disabled={opt.disabled}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="text-xs text-gray-500 mt-1">
              {tierOptions.find((o) => o.id === backfillTier)?.description}
            </div>
          </div>

          <button
            onClick={handleBackfillSingle}
            disabled={!backfillDate}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Fetch Rate
          </button>
        </div>

        {backfillResult && (
          <div
            className={`mt-3 p-3 rounded text-sm ${backfillResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
          >
            {backfillResult.success ? (
              <div>
                <div className="font-medium">Rate saved</div>
                <div className="mt-1 font-mono">
                  {backfillResult.date}: TRY->USD = {backfillResult.rate?.toFixed(6)} (1 USD = {backfillResult.usdToTry?.toFixed(2)} TRY)
                </div>
                {backfillResult.source && (
                  <div className="mt-1 text-xs text-green-700">Source: {providerLabel(backfillResult.source)}</div>
                )}
              </div>
            ) : (
              <div>
                <div className="font-medium">Could not fetch rate</div>
                <div className="mt-1">{backfillResult.error || 'Please try again.'}</div>
                {backfillResult.code && (
                  <div className="mt-1 text-xs">Code: {backfillResult.code}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Missing Dates */}
      {missingDates?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="font-medium mb-2 text-red-600">Missing Dates ({missingDates.length})</h3>
          <div className="flex flex-wrap gap-1">
            {missingDates.map((d) => (
              <span key={d} className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rates Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h3 className="font-medium">Exchange Rates (Last 60 Days)</h3>
        </div>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Date</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">TRY->USD</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">1 USD =</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Source</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Fetched At</th>
              </tr>
            </thead>
            <tbody>
              {rates?.map((r, i) => (
                <tr key={r.date} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2">{r.date}</td>
                  <td className="px-4 py-2 font-mono">{r.rate?.toFixed(6)}</td>
                  <td className="px-4 py-2 font-mono">{r.usdToTry} TRY</td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                      {providerLabel(r.source)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{r.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Conversion Stats */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h3 className="font-medium">Shawq Daily Spend (Converted USD)</h3>
        </div>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Date</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Total Spend (USD)</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Rows</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">Rate Used</th>
              </tr>
            </thead>
            <tbody>
              {conversionStats?.map((s, i) => {
                const rateForDate = rates?.find((r) => r.date === s.date);
                return (
                  <tr key={s.date} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2">{s.date}</td>
                    <td className="px-4 py-2 font-mono">${s.totalSpendUsd}</td>
                    <td className="px-4 py-2">{s.rowCount}</td>
                    <td className="px-4 py-2">
                      {rateForDate ? (
                        <span className="text-green-600 font-mono">{rateForDate.rate?.toFixed(6)}</span>
                      ) : (
                        <span className="text-red-500">Missing</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
