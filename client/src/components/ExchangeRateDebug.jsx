import { useEffect, useState } from 'react';

const API_BASE = '/api';

export default function ExchangeRateDebug() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backfillDate, setBackfillDate] = useState('');
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
        setError(json.error || 'Failed to load debug data');
      }
    } catch (err) {
      setError(err.message || 'Failed to load');
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
        body: JSON.stringify({ date: backfillDate })
      });
      const json = await res.json();
      setBackfillResult(json);
      if (json.success) {
        loadDebugData(); // Refresh
      }
    } catch (err) {
      setBackfillResult({ success: false, error: err.message });
    }
  };

  useEffect(() => {
    loadDebugData();
  }, []);

  if (loading && !data) {
    return <div className="p-4 text-gray-500">Loading exchange rate debug data...</div>;
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

  const { summary, rates, conversionStats, missingDates } = data || {};

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Exchange Rate Debug Panel</h2>
          <p className="text-sm text-gray-500">TRY→USD conversion tracking for Shawq</p>
        </div>
        <button
          onClick={loadDebugData}
          className="px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg"
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="text-2xl font-bold text-blue-600">{summary?.totalRatesStored || 0}</div>
          <div className="text-sm text-gray-500">Rates Stored</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="text-2xl font-bold text-green-600">{summary?.apiCallsRemaining || 0}</div>
          <div className="text-sm text-gray-500">API Calls Left (Month)</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="text-2xl font-bold text-orange-600">{summary?.apiCallsThisMonth || 0}</div>
          <div className="text-sm text-gray-500">API Calls Used</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="text-2xl font-bold text-red-600">{summary?.missingDatesCount || 0}</div>
          <div className="text-sm text-gray-500">Missing Dates</div>
        </div>
      </div>

      {/* Manual Backfill */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <h3 className="font-medium mb-2">Manual Backfill Single Date</h3>
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={backfillDate}
            onChange={(e) => setBackfillDate(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
          <button
            onClick={handleBackfillSingle}
            disabled={!backfillDate}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            Fetch Rate
          </button>
        </div>
        {backfillResult && (
          <div className={`mt-2 p-2 rounded text-sm ${backfillResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {backfillResult.success
              ? `✓ ${backfillResult.date}: TRY→USD = ${backfillResult.rate?.toFixed(6)} (1 USD = ${backfillResult.usdToTry?.toFixed(2)} TRY)`
              : `✗ Error: ${backfillResult.error}`}
          </div>
        )}
      </div>

      {/* Missing Dates */}
      {missingDates?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="font-medium mb-2 text-red-600">Missing Dates ({missingDates.length})</h3>
          <div className="flex flex-wrap gap-1">
            {missingDates.map(d => (
              <span key={d} className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">{d}</span>
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
                <th className="px-4 py-2 text-left font-medium text-gray-600">TRY→USD</th>
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
                    <span className={`px-2 py-0.5 rounded text-xs ${r.source === 'oxr' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {r.source}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{r.fetchedAt}</td>
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
                const rateForDate = rates?.find(r => r.date === s.date);
                return (
                  <tr key={s.date} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2">{s.date}</td>
                    <td className="px-4 py-2 font-mono">${s.totalSpendUsd}</td>
                    <td className="px-4 py-2">{s.rowCount}</td>
                    <td className="px-4 py-2">
                      {rateForDate ? (
                        <span className="text-green-600 font-mono">{rateForDate.rate?.toFixed(6)}</span>
                      ) : (
                        <span className="text-red-500">Missing!</span>
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
