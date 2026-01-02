import React, { useEffect, useMemo, useState } from 'react';
import { Pin, Repeat2, GitCompare, Download, Filter } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';

const MA_OPTIONS = [
  { id: 'off', label: 'OFF', window: null },
  { id: 'ma7', label: 'MA7', window: 7 },
  { id: 'ma14', label: 'MA14', window: 14 },
  { id: 'ma30', label: 'MA30', window: 30 }
];

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6'];

const formatValue = (value, format, currency) => {
  if (value === null || value === undefined) return '--';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';

  if (format === 'currency') {
    if (currency === 'USD') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(numeric);
    }
    return `${numeric.toLocaleString()} ${currency || ''}`.trim();
  }

  if (format === 'percent') {
    return `${numeric.toFixed(1)}%`;
  }

  return numeric.toLocaleString();
};

const buildMovingAverage = (data, sourceKey, targetKey, window) => {
  if (!window || !Array.isArray(data) || data.length === 0) return data;
  const updated = data.map(row => ({ ...row }));
  for (let i = 0; i < updated.length; i += 1) {
    if (i + 1 < window) {
      updated[i][targetKey] = null;
      continue;
    }
    let sum = 0;
    let count = 0;
    for (let j = i - window + 1; j <= i; j += 1) {
      const value = Number(updated[j][sourceKey]);
      if (Number.isFinite(value)) {
        sum += value;
        count += 1;
      }
    }
    updated[i][targetKey] = count > 0 ? sum / count : null;
  }
  return updated;
};

const inferSeriesFromData = (data, xKey) => {
  if (!Array.isArray(data) || data.length === 0) return [];
  const sample = data[0] || {};
  const keys = Object.keys(sample).filter(key => key !== xKey);
  const numericKey = keys.find(key => Number.isFinite(Number(sample[key])));
  if (!numericKey) return [];
  return [
    {
      key: numericKey,
      label: numericKey,
      kind: 'raw'
    }
  ];
};

export default function VisualizationDock({
  visualization,
  pinned,
  compareEnabled,
  compareSnapshot,
  replaceNext,
  lastRefreshed,
  dataShape,
  selectedMA,
  onPinToggle,
  onReplace,
  onCompareToggle,
  onClear,
  onShowTotals,
  onExplainMissingData,
  onSelectMA
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setIsVisible(!!visualization);
  }, [!!visualization]);

  useEffect(() => {
    if (!visualization) return undefined;
    setIsUpdating(true);
    const timer = setTimeout(() => setIsUpdating(false), 200);
    return () => clearTimeout(timer);
  }, [visualization]);

  const controls = visualization?.controls || {
    allowMetric: false,
    allowRange: false,
    allowGroupBy: false,
    allowMA: false
  };

  const hasInspector = controls.allowMetric || controls.allowRange || controls.allowGroupBy;

  const chartData = useMemo(() => {
    const rawData = Array.isArray(visualization?.data) ? visualization.data : [];
    return rawData.map(row => ({ ...(row || {}) }));
  }, [visualization]);

  const xKey = useMemo(() => {
    if (visualization?.xKey) return visualization.xKey;
    const sample = chartData[0] || {};
    return Object.keys(sample).find(key => key.toLowerCase().includes('date')) || 'date';
  }, [visualization, chartData]);

  const series = useMemo(() => {
    const baseSeries = visualization?.series?.length
      ? visualization.series
      : inferSeriesFromData(chartData, xKey);

    if (!controls.allowMA || selectedMA === 'off') {
      return baseSeries;
    }

    const windowValue = MA_OPTIONS.find(option => option.id === selectedMA)?.window;
    if (!windowValue) return baseSeries;
    const targetSeries = baseSeries.find(item => item.kind === 'raw');
    if (!targetSeries) return baseSeries;

    return [
      ...baseSeries,
      {
        key: `${targetSeries.key}_ma${windowValue}`,
        label: `MA${windowValue}`,
        kind: 'ma',
        derivedFrom: targetSeries.key,
        window: windowValue
      }
    ];
  }, [visualization, chartData, xKey, controls.allowMA, selectedMA]);

  const composedData = useMemo(() => {
    let dataRows = chartData;
    series.forEach((item) => {
      if (item.kind === 'ma' && item.derivedFrom && item.window) {
        dataRows = buildMovingAverage(dataRows, item.derivedFrom, item.key, item.window);
      }
    });
    return dataRows;
  }, [chartData, series]);

  const compareData = useMemo(() => {
    if (!compareSnapshot || !Array.isArray(compareSnapshot.data)) return [];
    return compareSnapshot.data.map(row => ({ ...(row || {}) }));
  }, [compareSnapshot]);

  const compareXKey = useMemo(() => {
    if (!compareSnapshot) return xKey;
    if (compareSnapshot.xKey) return compareSnapshot.xKey;
    const sample = compareData[0] || {};
    return Object.keys(sample).find(key => key.toLowerCase().includes('date')) || xKey;
  }, [compareSnapshot, compareData, xKey]);

  const compareSeries = useMemo(() => {
    if (!compareSnapshot) return [];
    if (compareSnapshot.series?.length) return compareSnapshot.series;
    return inferSeriesFromData(compareData, compareXKey);
  }, [compareSnapshot, compareData, compareXKey]);

  const compareComposedData = useMemo(() => {
    let dataRows = compareData;
    compareSeries.forEach((item) => {
      if (item.kind === 'ma' && item.derivedFrom && item.window) {
        dataRows = buildMovingAverage(dataRows, item.derivedFrom, item.key, item.window);
      }
    });
    return dataRows;
  }, [compareData, compareSeries]);

  if (!visualization) return null;

  const chartTypeLabel = visualization.chartType === 'line'
    ? 'Line'
    : visualization.chartType === 'bar'
    ? 'Bar'
    : visualization.chartType === 'totals'
    ? 'Totals'
    : 'Blocked';

  const primarySeriesLabel = series[0]?.label || series[0]?.key || 'metric';
  const autoLabel = visualization.mode === 'auto'
    ? `Auto: ${chartTypeLabel} (${xKey} + ${primarySeriesLabel})`
    : null;

  const handleExport = () => {
    const rows = Array.isArray(visualization.data) ? visualization.data : [];
    let csv = '';

    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);
      csv += `${headers.join(',')}\n`;
      rows.forEach(row => {
        const values = headers.map(header => JSON.stringify(row[header] ?? ''));
        csv += `${values.join(',')}\n`;
      });
    } else if (visualization.totals) {
      csv += 'metric,value\n';
      Object.entries(visualization.totals).forEach(([key, value]) => {
        csv += `${JSON.stringify(key)},${JSON.stringify(value)}\n`;
      });
    }

    if (!csv.trim()) return;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${visualization.title || 'visualization'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderChart = (data, height = '100%', chartSpec = visualization, chartSeries = series, chartXKey = xKey) => {
    if (chartSpec.chartType === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey={chartXKey} tick={{ fontSize: 12, fill: '#9ca3af' }} />
            <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} />
            <Tooltip
              formatter={(value) => formatValue(value, chartSpec.yFormat, dataShape?.currency)}
              labelStyle={{ color: '#111827' }}
            />
            {chartSeries.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                fill={COLORS[index % COLORS.length]}
                radius={[6, 6, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey={chartXKey} tick={{ fontSize: 12, fill: '#9ca3af' }} />
          <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} />
          <Tooltip
            formatter={(value) => formatValue(value, chartSpec.yFormat, dataShape?.currency)}
            labelStyle={{ color: '#111827' }}
          />
          {chartSeries.map((item, index) => (
            <Line
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={COLORS[index % COLORS.length]}
              strokeWidth={2}
              dot={false}
              strokeDasharray={item.kind === 'ma' ? '4 4' : '0'}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  };

  const totalsEntries = visualization.totals ? Object.entries(visualization.totals) : [];

  return (
    <div
      className={`bg-white rounded-2xl border border-gray-200 shadow-sm h-[280px] lg:h-[340px] flex flex-col transition-all duration-200 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5'
      }`}
    >
      <div className="flex items-start justify-between p-4 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{visualization.title}</h3>
          {autoLabel && (
            <p className="text-xs text-gray-400 mt-1">{autoLabel}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onPinToggle}
            className={`p-2 rounded-lg border text-xs transition-colors ${
              pinned ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500 hover:text-gray-700'
            }`}
            title={pinned ? 'Unpin' : 'Pin'}
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            onClick={onReplace}
            className={`p-2 rounded-lg border text-xs transition-colors ${
              replaceNext ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500 hover:text-gray-700'
            }`}
            title="Replace"
          >
            <Repeat2 className="w-4 h-4" />
          </button>
          <button
            onClick={onCompareToggle}
            className={`p-2 rounded-lg border text-xs transition-colors ${
              compareEnabled ? 'border-blue-200 text-blue-600 bg-blue-50' : 'border-gray-200 text-gray-500 hover:text-gray-700'
            }`}
            title="Compare"
          >
            <GitCompare className="w-4 h-4" />
          </button>
          <button
            onClick={handleExport}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
            title="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-4 p-4">
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className={`flex-1 min-h-0 transition-opacity ${isUpdating ? 'opacity-80' : 'opacity-100'}`}>
            {visualization.chartType === 'totals' && (
              <div className="h-full flex items-center justify-center">
                {totalsEntries.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4 w-full">
                    {totalsEntries.map(([key, value]) => (
                      <div key={key} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                        <p className="text-xs text-gray-400 mb-2">{key}</p>
                        <p className="text-lg font-semibold text-gray-900">
                          {formatValue(value, visualization.yFormat, dataShape?.currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">No totals available.</div>
                )}
              </div>
            )}

            {visualization.chartType === 'blocked' && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                <h4 className="text-lg font-semibold text-gray-900">Trend unavailable</h4>
                <p className="text-sm text-gray-500 max-w-md">
                  Daily trend requires daily time-series data. Showing totals instead.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={onShowTotals}
                    className="px-4 py-2 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Show totals
                  </button>
                  <button
                    onClick={onExplainMissingData}
                    className="px-4 py-2 text-xs rounded-lg border border-gray-200 text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Explain missing data
                  </button>
                </div>
              </div>
            )}

            {(visualization.chartType === 'line' || visualization.chartType === 'bar') && (
              <div className="h-full">
                {composedData.length > 0 ? (
                  renderChart(composedData)
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400">
                    No chart data available.
                  </div>
                )}
              </div>
            )}
          </div>

          {compareEnabled && compareSnapshot && (compareSnapshot.data || compareSnapshot.totals) && (
            <div className="h-40 border border-gray-100 rounded-xl p-2 bg-gray-50/60">
              <p className="text-xs text-gray-400 mb-1">Compare</p>
              {(compareSnapshot.chartType === 'line' || compareSnapshot.chartType === 'bar') ? (
                renderChart(compareComposedData, '100%', compareSnapshot, compareSeries, compareXKey)
              ) : (
                <div className="text-xs text-gray-400">Comparison view unavailable for this chart type.</div>
              )}
            </div>
          )}
        </div>

        {hasInspector && (
          <div className="hidden lg:flex w-[280px] flex-col gap-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mini Inspector</div>
            {controls.allowMetric && (
              <div>
                <label className="text-xs text-gray-400">Metric</label>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                  defaultValue={visualization.ui?.metric || series[0]?.key}
                >
                  {series.map(item => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {controls.allowRange && (
              <div>
                <label className="text-xs text-gray-400">Range</label>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                  defaultValue={visualization.ui?.rangePreset || '30d'}
                  disabled={!dataShape?.timeSeriesAvailable}
                >
                  <option value="7d">Last 7 days</option>
                  <option value="14d">Last 14 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="custom">Custom</option>
                </select>
                {!dataShape?.timeSeriesAvailable && (
                  <p className="text-[11px] text-gray-400 mt-1">Needs time-series data</p>
                )}
              </div>
            )}
            {controls.allowGroupBy && (
              <div>
                <label className="text-xs text-gray-400">Group by</label>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                  defaultValue={visualization.ui?.groupBy || 'day'}
                  disabled={!dataShape?.timeSeriesAvailable}
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
                {!dataShape?.timeSeriesAvailable && (
                  <p className="text-[11px] text-gray-400 mt-1">Needs time-series data</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {hasInspector && (
        <div className="lg:hidden px-4 pb-3">
          <button
            onClick={() => setFiltersOpen(value => !value)}
            className="flex items-center gap-2 text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2"
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>
          {filtersOpen && (
            <div className="mt-3 space-y-3">
              {controls.allowMetric && (
                <div>
                  <label className="text-xs text-gray-400">Metric</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    defaultValue={visualization.ui?.metric || series[0]?.key}
                  >
                    {series.map(item => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {controls.allowRange && (
                <div>
                  <label className="text-xs text-gray-400">Range</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    defaultValue={visualization.ui?.rangePreset || '30d'}
                    disabled={!dataShape?.timeSeriesAvailable}
                  >
                    <option value="7d">Last 7 days</option>
                    <option value="14d">Last 14 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="custom">Custom</option>
                  </select>
                  {!dataShape?.timeSeriesAvailable && (
                    <p className="text-[11px] text-gray-400 mt-1">Needs time-series data</p>
                  )}
                </div>
              )}
              {controls.allowGroupBy && (
                <div>
                  <label className="text-xs text-gray-400">Group by</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    defaultValue={visualization.ui?.groupBy || 'day'}
                    disabled={!dataShape?.timeSeriesAvailable}
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                  {!dataShape?.timeSeriesAvailable && (
                    <p className="text-[11px] text-gray-400 mt-1">Needs time-series data</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="px-4 pb-3 flex items-center justify-between text-xs text-gray-400">
        {controls.allowMA && (
          <div className="flex items-center gap-2">
            {MA_OPTIONS.map(option => (
              <button
                key={option.id}
                onClick={() => onSelectMA(option.id)}
                className={`px-2 py-1 rounded-full border text-[11px] ${
                  selectedMA === option.id
                    ? 'border-blue-200 text-blue-600 bg-blue-50'
                    : 'border-gray-200 text-gray-400'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {lastRefreshed && (
          <div>Last refreshed {new Date(lastRefreshed).toLocaleTimeString()}</div>
        )}
      </div>
    </div>
  );
}
