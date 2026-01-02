import React, { useMemo, useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import {
  Pin,
  PinOff,
  RotateCcw,
  GitCompare,
  Download,
  Filter
} from 'lucide-react';

const formatNumber = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat().format(value);
};

const formatCurrency = (value, currency) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (!currency) return formatNumber(value);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
};

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(1)}%`;
};

const getFormatter = (format, currency) => {
  if (format === 'currency') return (value) => formatCurrency(value, currency);
  if (format === 'percent') return formatPercent;
  return formatNumber;
};

const computeMovingAverage = (data, key, window) => {
  if (!Array.isArray(data) || !key || !window) return [];
  const results = [];
  const buffer = [];
  let sum = 0;

  data.forEach((row) => {
    const value = Number(row?.[key]);
    if (Number.isFinite(value)) {
      buffer.push(value);
      sum += value;
    } else {
      buffer.push(null);
    }

    if (buffer.length > window) {
      const removed = buffer.shift();
      if (Number.isFinite(removed)) {
        sum -= removed;
      }
    }

    const validValues = buffer.filter((item) => Number.isFinite(item));
    if (validValues.length < window) {
      results.push(null);
    } else {
      results.push(sum / window);
    }
  });

  return results;
};

const buildChartData = (dock, selectedMAWindow) => {
  const rawData = Array.isArray(dock?.data) ? dock.data : [];
  const series = Array.isArray(dock?.series) ? dock.series : [];

  const derivedSeries = [];

  series.forEach((s) => {
    if (s.kind === 'ma' && s.derivedFrom && s.window) {
      derivedSeries.push({
        key: s.key,
        derivedFrom: s.derivedFrom,
        window: s.window,
        label: s.label || `${s.derivedFrom} MA${s.window}`
      });
    }
  });

  if (selectedMAWindow && selectedMAWindow !== 'off') {
    const window = Number(selectedMAWindow);
    const rawSeries = series.filter((s) => s.kind === 'raw');
    rawSeries.forEach((s) => {
      derivedSeries.push({
        key: `${s.key}_ma${window}`,
        derivedFrom: s.key,
        window,
        label: `${s.label || s.key} MA${window}`
      });
    });
  }

  if (derivedSeries.length === 0) {
    return { chartData: rawData, series };
  }

  const computedSeries = derivedSeries.map((derived) => ({
    ...derived,
    values: computeMovingAverage(rawData, derived.derivedFrom, derived.window)
  }));

  const chartData = rawData.map((row, index) => {
    const nextRow = { ...row };
    computedSeries.forEach((derived) => {
      nextRow[derived.key] = derived.values[index];
    });
    return nextRow;
  });

  const mergedSeries = [
    ...series.filter((s) => s.kind !== 'ma'),
    ...derivedSeries.map((s) => ({
      key: s.key,
      label: s.label,
      kind: 'ma',
      derivedFrom: s.derivedFrom,
      window: s.window
    }))
  ];

  return { chartData, series: mergedSeries };
};

const emptyArray = [];

export default function VisualizationDock({
  dock,
  compareDock,
  compareMode,
  pinned,
  onTogglePin,
  onReplace,
  onToggleCompare,
  onExport,
  onShowTotals,
  onExplainMissing,
  onUpdateUi,
  isVisible = true
}) {
  const [showFilters, setShowFilters] = useState(false);
  const [selectedMAWindow, setSelectedMAWindow] = useState('off');

  useEffect(() => {
    setSelectedMAWindow('off');
  }, [dock?.id, dock?.title]);

  const hasDock = !!dock;
  if (!hasDock) return null;

  const formatValue = getFormatter(dock?.yFormat, dock?.currency);

  const series = Array.isArray(dock?.series) ? dock.series : emptyArray;
  const rawSeries = series.filter((s) => s.kind === 'raw');

  const { chartData, series: renderedSeries } = useMemo(() => buildChartData(dock, selectedMAWindow), [dock, selectedMAWindow]);
  const { chartData: compareChartData, series: compareSeries } = useMemo(
    () => buildChartData(compareDock, 'off'),
    [compareDock]
  );

  const renderChart = (activeDock, activeChartData, activeSeries, height = 260) => {
    if (!activeDock || !Array.isArray(activeDock.data)) return null;

    const chartSeries = Array.isArray(activeSeries) ? activeSeries : [];
    const dataSeries = chartSeries.filter((s) => s.kind === 'raw');
    const effectiveSeries = dataSeries.length > 0 ? dataSeries : chartSeries;
    const key = activeDock.xKey || 'date';

    if (activeDock.chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={activeChartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis dataKey={key} tick={{ fontSize: 12 }} stroke="#9CA3AF" />
            <YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" tickFormatter={formatValue} />
            <Tooltip formatter={(value) => formatValue(value)} />
            {effectiveSeries.map((s, idx) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={idx % 2 === 0 ? '#2563EB' : '#7C3AED'} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={activeChartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
          <XAxis dataKey={key} tick={{ fontSize: 12 }} stroke="#9CA3AF" />
          <YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" tickFormatter={formatValue} />
          <Tooltip formatter={(value) => formatValue(value)} />
          {chartSeries.map((s, idx) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.kind === 'ma' ? '#9CA3AF' : idx % 2 === 0 ? '#2563EB' : '#7C3AED'}
              strokeWidth={s.kind === 'ma' ? 2 : 2.5}
              dot={false}
              strokeDasharray={s.kind === 'ma' ? '6 4' : undefined}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  };

  const renderTotals = () => {
    const totals = dock?.totals || {};
    const entries = Object.entries(totals);
    if (entries.length === 0) {
      return <p className="text-sm text-gray-400">No totals available.</p>;
    }

    return (
      <div className="grid grid-cols-2 gap-4">
        {entries.map(([key, value]) => (
          <div key={key} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <p className="text-xs uppercase tracking-wide text-gray-400">{key}</p>
            <p className="text-lg font-semibold text-gray-900">{formatNumber(value)}</p>
          </div>
        ))}
      </div>
    );
  };

  const showMAControls = dock?.controls?.allowMA;
  const showMetricControls = dock?.controls?.allowMetric;
  const showRangeControls = dock?.controls?.allowRange;
  const showGroupControls = dock?.controls?.allowGroupBy;
  const hasTimeSeries = Array.isArray(dock?.data) && dock?.data?.length > 1 && !!dock?.xKey;

  return (
    <div className="px-4 pt-4">
      <div
        className={`bg-white border border-gray-200 shadow-sm rounded-2xl transition-all duration-[250ms] ease-out flex flex-col h-[280px] lg:h-[340px] ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5'
        }`}
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{dock?.title || 'Visualization'}</h3>
            {dock?.mode === 'auto' && (
              <p className="text-xs text-gray-400 mt-1">Auto: {dock?.autoReason || 'Line (date + numeric)'}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onTogglePin}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50"
              title={pinned ? 'Unpin' : 'Pin'}
              type="button"
            >
              {pinned ? <PinOff className="w-4 h-4 text-gray-500" /> : <Pin className="w-4 h-4 text-gray-500" />}
            </button>
            <button
              onClick={onReplace}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50"
              title="Replace"
              type="button"
            >
              <RotateCcw className="w-4 h-4 text-gray-500" />
            </button>
            <button
              onClick={onToggleCompare}
              className={`w-8 h-8 rounded-lg border flex items-center justify-center ${compareMode ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
              title="Compare"
              type="button"
            >
              <GitCompare className="w-4 h-4 text-gray-500" />
            </button>
            <button
              onClick={onExport}
              className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center hover:bg-gray-50"
              title="Export"
              type="button"
            >
              <Download className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-4 pt-3 flex-1 overflow-hidden">
          <div className="flex flex-col lg:flex-row gap-4 h-full">
            <div className="flex-1 flex flex-col min-h-0">
              {dock?.chartType === 'blocked' && (
                <div className="h-full flex flex-col justify-center items-start bg-gray-50 rounded-xl border border-gray-100 p-6">
                  <p className="text-sm font-semibold text-gray-900">Trend unavailable</p>
                  <p className="text-sm text-gray-500 mt-2">Daily trend requires daily time-series data. Showing totals instead.</p>
                  <div className="flex flex-wrap gap-3 mt-4">
                    <button
                      type="button"
                      onClick={onShowTotals}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg"
                    >
                      Show totals
                    </button>
                    <button
                      type="button"
                      onClick={onExplainMissing}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg"
                    >
                      Explain missing data
                    </button>
                  </div>
                </div>
              )}

              {dock?.chartType === 'totals' && (
                <div className="h-full">{renderTotals()}</div>
              )}

              {(dock?.chartType === 'line' || dock?.chartType === 'bar') && (
                <div className="flex-1 transition-opacity duration-200">
                  {renderChart(dock, chartData, renderedSeries, compareMode ? 180 : 220)}
                </div>
              )}

              {compareMode && compareDock && (dock?.chartType === 'line' || dock?.chartType === 'bar') && (
                <div className="mt-4 h-[160px] bg-gray-50 rounded-xl border border-gray-100 p-3">
                  <div className="text-xs text-gray-500 mb-2">Compare</div>
                  {renderChart(compareDock, compareChartData, compareSeries, 130)}
                </div>
              )}
            </div>

            <div className="w-full lg:w-[280px]">
              <div className="lg:hidden mb-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600"
                  onClick={() => setShowFilters((prev) => !prev)}
                >
                  <Filter className="w-3.5 h-3.5" /> Filters
                </button>
              </div>

              <div className={`${showFilters ? 'block' : 'hidden'} lg:block`}>
                <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">Mini Inspector</p>
                    <p className="text-xs text-gray-400">Adjusts apply to current dock.</p>
                  </div>

                  {showMetricControls && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Metric</p>
                      <select
                        value={dock?.ui?.metric || rawSeries[0]?.key || ''}
                        onChange={(e) => onUpdateUi?.({ metric: e.target.value })}
                        className="w-full text-xs rounded-lg border border-gray-200 px-2 py-1 bg-white"
                      >
                        {rawSeries.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {showRangeControls && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Range</p>
                      <select
                        value={dock?.ui?.rangePreset || '30d'}
                        onChange={(e) => onUpdateUi?.({ rangePreset: e.target.value })}
                        className="w-full text-xs rounded-lg border border-gray-200 px-2 py-1 bg-white"
                      >
                        <option value="7d">Last 7 days</option>
                        <option value="14d">Last 14 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="custom">Custom</option>
                      </select>
                      {!hasTimeSeries && <p className="text-[11px] text-gray-400 mt-1">Needs time-series data</p>}
                    </div>
                  )}

                  {showGroupControls && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Group by</p>
                      <select
                        value={dock?.ui?.groupBy || 'day'}
                        onChange={(e) => onUpdateUi?.({ groupBy: e.target.value })}
                        className="w-full text-xs rounded-lg border border-gray-200 px-2 py-1 bg-white"
                      >
                        <option value="day">Day</option>
                        <option value="week">Week</option>
                        <option value="month">Month</option>
                      </select>
                      {!hasTimeSeries && <p className="text-[11px] text-gray-400 mt-1">Needs time-series data</p>}
                    </div>
                  )}

                </div>
              </div>
            </div>
          </div>

          {(showMAControls || dock?.lastRefreshed) && (
            <div className="flex items-center justify-between mt-3 text-xs text-gray-400">
              <div className="flex items-center gap-2">
                {showMAControls && (
                  <div className="flex flex-wrap gap-2">
                    {['off', '7', '14', '30'].map((window) => (
                      <button
                        key={window}
                        type="button"
                        onClick={() => setSelectedMAWindow(window)}
                        className={`px-2 py-1 text-[11px] rounded-full border ${
                          selectedMAWindow === window ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500'
                        }`}
                      >
                        {window === 'off' ? 'OFF' : `MA${window}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {dock?.lastRefreshed && <span>Last refreshed {dock.lastRefreshed}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
