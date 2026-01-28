import { useEffect, useMemo, useState } from 'react';

const API_BASE = '/api';

function providerLabel(provider) {
  if (!provider) return 'Not configured';
  if (provider === 'currencyfreaks') return 'CurrencyFreaks';
  if (provider === 'oxr') return 'Open Exchange Rates (OXR)';
  if (provider === 'apilayer') return 'APILayer';
  if (provider === 'frankfurter') return 'Frankfurter (ECB)';
  if (provider === 'manual') return 'Manual';
  return provider;
}

function providerStatus(provider, configured) {
  if (!provider) return { label: 'Not configured', tone: 'text-gray-500' };
  if (provider === 'frankfurter') return { label: 'Connected (public)', tone: 'text-green-600' };
  const isReady = Boolean(configured?.[provider]);
  return isReady
    ? { label: 'Connected', tone: 'text-green-600' }
    : { label: 'Missing API key', tone: 'text-red-600' };
}

export default function ExchangeRateDebug() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backfillDate, setBackfillDate] = useState('');
  const [backfillTier, setBackfillTier] = useState('primary_backfill');
  const [backfillResult, setBackfillResult] = useState(null);

  const [rateToolMode, setRateToolMode] = useState('fetch');
  const [manualDateMode, setManualDateMode] = useState('single');
  const [manualDate, setManualDate] = useState('');
  const [manualStartDate, setManualStartDate] = useState('');
  const [manualEndDate, setManualEndDate] = useState('');
  const [manualRateType, setManualRateType] = useState('usdToTry');
  const [manualRateValue, setManualRateValue] = useState('');
  const [manualOverwrite, setManualOverwrite] = useState(false);
  const [manualResult, setManualResult] = useState(null);

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

  const handleSaveManualRate = async () => {
    const rateNumber = Number(manualRateValue);
    const hasRate = Number.isFinite(rateNumber) && rateNumber > 0;

    if (!hasRate) return;

    const payload = { overwrite: manualOverwrite };

    if (manualDateMode === 'single') {
      if (!manualDate) return;
      payload.date = manualDate;
    } else {
      if (!manualStartDate || !manualEndDate) return;
      payload.startDate = manualStartDate;
      payload.endDate = manualEndDate;
    }

    if (manualRateType === 'usdToTry') {
      payload.usdToTry = rateNumber;
    } else {
      payload.tryToUsd = rateNumber;
    }

    setManualResult(null);
    try {
      const res = await fetch(`${API_BASE}/exchange-rates/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      setManualResult(json);
      if (json.success) {
        loadDebugData();
      }
    } catch (err) {
      setManualResult({ success: false, error: err.message || 'Failed to save.' });
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

  const manualRateNumber = Number(manualRateValue);
  const manualRateValid = Number.isFinite(manualRateNumber) && manualRateNumber > 0;
  const manualRateStep = manualRateType === 'usdToTry' ? '0.01' : '0.000001';

  const previewTryToUsd = manualRateValid
    ? (manualRateType === 'tryToUsd' ? manualRateNumber : 1 / manualRateNumber)
    : null;

  const previewUsdToTry = manualRateValid
    ? (manualRateType === 'usdToTry' ? manualRateNumber : 1 / manualRateNumber)
    : null;

  const missingRange = (() => {
    if (!Array.isArray(missingDates) || missingDates.length === 0) return null;
    let min = missingDates[0];
    let max = missingDates[0];
    for (const d of missingDates) {
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return { start: min, end: max };
  })();

  const manualFormValid = manualRateValid && (
    (manualDateMode === 'single' && Boolean(manualDate)) ||
    (manualDateMode === 'range' && Boolean(manualStartDate) && Boolean(manualEndDate))
  );


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
            <div className={`text-xs mt-1 ${providerStatus(providerStrategy?.dailyProvider, providerStrategy?.configured).tone}`}>
              {providerStatus(providerStrategy?.dailyProvider, providerStrategy?.configured).label}
              {providerStrategy?.sources?.daily ? ` • ${providerStrategy.sources.daily}` : ''}
            </div>
          </div>
          <div className="p-3 rounded-lg border bg-gray-50">
            <div className="text-gray-500">Primary (Backfill)</div>
            <div className="font-medium">{providerLabel(providerStrategy?.primaryBackfillProvider)}</div>
            <div className={`text-xs mt-1 ${providerStatus(providerStrategy?.primaryBackfillProvider, providerStrategy?.configured).tone}`}>
              {providerStatus(providerStrategy?.primaryBackfillProvider, providerStrategy?.configured).label}
              {providerStrategy?.sources?.primaryBackfill ? ` • ${providerStrategy.sources.primaryBackfill}` : ''}
            </div>
          </div>
          <div className="p-3 rounded-lg border bg-gray-50">
            <div className="text-gray-500">Secondary (Backfill)</div>
            <div className="font-medium">{providerLabel(providerStrategy?.secondaryBackfillProvider)}</div>
            <div className={`text-xs mt-1 ${providerStatus(providerStrategy?.secondaryBackfillProvider, providerStrategy?.configured).tone}`}>
              {providerStatus(providerStrategy?.secondaryBackfillProvider, providerStrategy?.configured).label}
              {providerStrategy?.sources?.secondaryBackfill ? ` • ${providerStrategy.sources.secondaryBackfill}` : ''}
            </div>
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

      {/* Manual Rates */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <h3 className="font-medium">Manual Rates</h3>
            <p className="text-sm text-gray-500 mt-1">
              Fetch from a provider, or manually enter a rate to fill missing dates.
            </p>
          </div>

          <div className="inline-flex bg-gray-100 rounded-lg p-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setRateToolMode('fetch');
              }}
              className={`px-3 py-1 rounded-md ${rateToolMode === 'fetch' ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Fetch
            </button>
            <button
              type="button"
              onClick={() => {
                setRateToolMode('manual');
              }}
              className={`px-3 py-1 rounded-md ${rateToolMode === 'manual' ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Manual
            </button>
          </div>
        </div>

        {rateToolMode === 'fetch' ? (
          <>
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
                type="button"
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
                      {backfillResult.date}: TRY-&gt;USD = {backfillResult.rate?.toFixed(6)} (1 USD = {backfillResult.usdToTry?.toFixed(2)} TRY)
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
          </>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-col md:flex-row gap-2 md:items-end">
                <div className="flex flex-col">
                  <label className="text-xs text-gray-500 mb-1">Dates</label>
                  <div className="inline-flex bg-gray-100 rounded-lg p-1 text-sm">
                    <button
                      type="button"
                      onClick={() => setManualDateMode('single')}
                      className={`px-3 py-1 rounded-md ${manualDateMode === 'single' ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                      Single
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualDateMode('range')}
                      className={`px-3 py-1 rounded-md ${manualDateMode === 'range' ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                      Range
                    </button>
                  </div>
                  {missingRange && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualDateMode('range');
                        setManualStartDate(missingRange.start);
                        setManualEndDate(missingRange.end);
                      }}
                      className="mt-1 text-xs text-blue-600 hover:text-blue-800"
                    >
                      Use missing range ({missingRange.start} → {missingRange.end})
                    </button>
                  )}
                </div>

                {manualDateMode === 'single' ? (
                  <div className="flex flex-col">
                    <label className="text-xs text-gray-500 mb-1">Date</label>
                    <input
                      type="date"
                      value={manualDate}
                      onChange={(e) => setManualDate(e.target.value)}
                      className="border rounded px-3 py-2 text-sm"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col">
                      <label className="text-xs text-gray-500 mb-1">Start</label>
                      <input
                        type="date"
                        value={manualStartDate}
                        onChange={(e) => setManualStartDate(e.target.value)}
                        className="border rounded px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-xs text-gray-500 mb-1">End</label>
                      <input
                        type="date"
                        value={manualEndDate}
                        onChange={(e) => setManualEndDate(e.target.value)}
                        className="border rounded px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                )}

                <div className="flex flex-col flex-1">
                  <label className="text-xs text-gray-500 mb-1">Rate format</label>
                  <select
                    value={manualRateType}
                    onChange={(e) => setManualRateType(e.target.value)}
                    className="border rounded px-3 py-2 text-sm"
                  >
                    <option value="usdToTry">1 USD = X TRY</option>
                    <option value="tryToUsd">TRY → USD</option>
                  </select>
                </div>

                <div className="flex flex-col flex-1">
                  <label className="text-xs text-gray-500 mb-1">Rate</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={manualRateStep}
                    value={manualRateValue}
                    onChange={(e) => setManualRateValue(e.target.value)}
                    className="border rounded px-3 py-2 text-sm"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    {manualRateValid ? (
                      <span className="font-mono">
                        TRY-&gt;USD {previewTryToUsd?.toFixed(6)} • 1 USD = {previewUsdToTry?.toFixed(2)} TRY
                      </span>
                    ) : (
                      'Enter a positive number.'
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 md:pb-2">
                  <label className="flex items-center gap-2 text-xs text-gray-600 select-none">
                    <input
                      type="checkbox"
                      checked={manualOverwrite}
                      onChange={(e) => setManualOverwrite(e.target.checked)}
                    />
                    Overwrite
                  </label>
                </div>

                <button
                  type="button"
                  onClick={handleSaveManualRate}
                  disabled={!manualFormValid}
                  className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  Save Rate
                </button>
              </div>
            </div>

            {manualResult && (
              <div
                className={`mt-3 p-3 rounded text-sm ${manualResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}
              >
                {manualResult.success ? (
                  <div>
                    <div className="font-medium">Rate saved</div>
                    <div className="mt-1 font-mono">
                      {manualResult.mode === 'range'
                        ? `${manualResult.startDate} → ${manualResult.endDate}: TRY->USD = ${manualResult.rate?.toFixed(6)} (1 USD = ${manualResult.usdToTry?.toFixed(2)} TRY)`
                        : `${manualResult.date}: TRY->USD = ${manualResult.rate?.toFixed(6)} (1 USD = ${manualResult.usdToTry?.toFixed(2)} TRY)`}
                    </div>
                    {manualResult.mode === 'range' ? (
                      <div className="mt-1 text-xs text-green-700">
                        Saved {manualResult.inserted} day(s)
                        {manualResult.skippedExisting ? ` • skipped ${manualResult.skippedExisting}` : ''}
                        {manualResult.overwritten ? ` • overwritten ${manualResult.overwritten}` : ''}
                      </div>
                    ) : manualResult.overwritten ? (
                      <div className="mt-1 text-xs text-green-700">Overwrote existing rate.</div>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <div className="font-medium">Could not save rate</div>
                    <div className="mt-1">{manualResult.error || 'Please try again.'}</div>
                    {manualResult.existing && (
                      <div className="mt-1 text-xs font-mono">
                        Existing: TRY-&gt;USD {manualResult.existing.rate?.toFixed(6)} (1 USD = {manualResult.existing.usdToTry?.toFixed(2)} TRY) • {providerLabel(manualResult.existing.source)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
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
