import React, { useEffect, useMemo, useState } from 'react';
import {
  Pin,
  PinOff,
  Repeat,
  GitCompare,
  Download,
  Filter,
  ChevronDown
} from 'lucide-react';
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

const COLOR_PALETTE = ['#2563eb', '#7c3aed', '#0ea5e9', '#14b8a6', '#f97316', '#ef4444'];

const formatNumber = (value) => {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return numeric.toLocaleString();
};

const formatCurrency = (value) => {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatPercent = (value) => {
  if (value === null || value === undefined) return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return `${numeric.toFixed(1)}%`;
};

const formatByType = (value, yFormat) => {
  if (yFormat === 'currency') return formatCurrency(value);
  if (yFormat === 'percent') return formatPercent(value);
  return formatNumber(value);
};

const safeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const computeMovingAverage = (data, sourceKey, window) => {
  if (!Array.isArray(data) || !sourceKey || !window) return [];
  return data.map((row, index) => {
    const slice = data.slice(Math.max(0, index - window + 1), index + 1);
    const values = slice
      .map(entry => safeNumber(entry?.[sourceKey]))
      .filter(value => value !== null);
    if (values.length < window) return null;
    const sum = values.reduce((acc, val) => acc + val, 0);
    return sum / values.length;
  });
};

const buildCsv = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach(key => set.add(key));
      return set;
    }, new Set())
  );
  const header = columns.join(',');
  const body = rows.map(row => columns.map(col => {
    const value = row?.[col];
    if (value === null || value === undefined) return '';
    const escaped = String(value).replace(/"/g, '""');
    return `"${escaped}"`;
  }).join(','));
  return [header, ...body].join('\n');
};

const ChartTooltip = ({ active, payload, label, yFormat }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold text-gray-700 mb-1">{label}</div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3">
            <span className="text-gray-500">{entry.name}</span>
            <span className="font-medium text-gray-900">{formatByType(entry.value, yFormat)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const TotalsView = ({ totals, yFormat }) => {
  if (!totals || Object.keys(totals).length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        No totals available.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      {Object.entries(totals).map(([key, value]) => (
        <div key={key} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="text-xs uppercase text-gray-400">{key}</div>
          <div className="text-lg font-semibold text-gray-900 mt-2">
            {formatByType(value, yFormat)}
          </div>
        </div>
      ))}
    </div>
  );
};

export default function VisualizationDock({
  dock,
  previousDock,
  pinned,
  compareEnabled,
  onTogglePin,
  onReplace,
  onToggleCompare,
  onShowTotals,
  onExplainMissingData,
  onUpdateUi
}) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState('');
  const [selectedMAWindow, setSelectedMAWindow] = useState('OFF');

  useEffect(() => {
    if (!dock) return;
    setIsUpdating(true);
    const timer = setTimeout(() => setIsUpdating(false), 250);
    return () => clearTimeout(timer);
  }, [dock]);

  useEffect(() => {
    const nextMetric = dock?.ui?.metric || '';
    setSelectedMetric(nextMetric);
    setSelectedMAWindow('OFF');
  }, [dock?.ui?.metric, dock?.chartType, dock?.title]);

  const chartData = useMemo(() => {
    if (!dock?.data || !Array.isArray(dock.data)) return [];
    if (!dock.series || dock.series.length === 0) return dock.data;

    let nextData = [...dock.data];
    dock.series
      .filter(series => series.kind === 'ma' && series.derivedFrom && series.window)
      .forEach(series => {
        const maValues = computeMovingAverage(nextData, series.derivedFrom, series.window);
        nextData = nextData.map((row, idx) => ({
          ...row,
          [series.key]: maValues[idx]
        }));
      });
    return nextData;
  }, [dock?.data, dock?.series]);

  const rawSeries = useMemo(() => {
    if (!dock?.data || dock.data.length === 0) return [];
    if (dock.series && dock.series.length > 0) {
      return dock.series.filter(series => series.kind === 'raw');
    }
    const keys = Object.keys(dock.data[0] || {});
    return keys
      .filter(key => key !== dock.xKey)
      .map((key) => ({ key, label: key, kind: 'raw' }));
  }, [dock?.data, dock?.series, dock?.xKey]);

  const maSeries = useMemo(() => {
    if (!dock?.series) return [];
    return dock.series.filter(series => series.kind === 'ma');
  }, [dock?.series]);

  const visibleSeries = useMemo(() => {
    if (!rawSeries.length) return [];
    let visibleRaw = rawSeries;
    if (selectedMetric) {
      visibleRaw = rawSeries.filter(series => series.key === selectedMetric);
    }

    const maWindow = selectedMAWindow === 'OFF' ? null : Number(selectedMAWindow.replace('MA', ''));
    const visibleMa = maWindow
      ? maSeries.filter(series => series.window === maWindow && (!selectedMetric || series.derivedFrom === selectedMetric))
      : [];

    return [...visibleRaw, ...visibleMa];
  }, [rawSeries, maSeries, selectedMetric, selectedMAWindow]);

  if (!dock) return null;

  const chartTypeLabel = dock.chartType === 'line'
    ? 'Line'
    : dock.chartType === 'bar'
      ? 'Bar'
      : dock.chartType === 'totals'
        ? 'Totals'
        : 'Blocked';

  const subtitle = dock.mode === 'auto'
    ? (dock.autoReason || `Auto: ${chartTypeLabel}${dock.xKey ? ` (${dock.xKey})` : ''}`)
    : null;

  const hasData = Array.isArray(dock.data) && dock.data.length > 0;
  const hasInspector = dock.controls?.allowMetric || dock.controls?.allowRange || dock.controls?.allowGroupBy;
  const showRangeNote = !dock?.xKey || !hasData || dock.data.length < 2;
  const showGroupNote = !dock?.xKey || !hasData || dock.data.length < 2;

  const handleExport = () => {
    const csv = buildCsv(dock.data || []);
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${dock.title || 'visualization'}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-200 ${
        isUpdating ? 'opacity-70' : 'opacity-100'
      } animate-fade-in`}
      style={{ transform: isUpdating ? 'translateY(6px)' : 'translateY(0)' }}
    >
      <div className="flex h-[280px] flex-col lg:h-[340px]">
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{dock.title || 'Visualization'}</h3>
            {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onTogglePin}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                pinned
                  ? 'border-blue-200 bg-blue-50 text-blue-600'
                  : 'border-gray-200 text-gray-500 hover:border-blue-200 hover:text-blue-600'
              }`}
            >
              {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onReplace}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:border-blue-200 hover:text-blue-600"
            >
              <Repeat className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onToggleCompare}
              disabled={!previousDock}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                compareEnabled
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                  : 'border-gray-200 text-gray-500 hover:border-indigo-200 hover:text-indigo-600'
              } ${!previousDock ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <GitCompare className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={handleExport}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:border-blue-200 hover:text-blue-600"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 px-5 py-4">
          {dock.chartType === 'blocked' ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-lg font-semibold text-gray-900">Trend unavailable</div>
              <p className="mt-2 text-sm text-gray-500 max-w-md">
                Daily trend requires daily time-series data. Showing totals instead.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={onShowTotals}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700"
                >
                  Show totals
                </button>
                <button
                  onClick={onExplainMissingData}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:border-gray-300"
                >
                  Explain missing data
                </button>
              </div>
            </div>
          ) : dock.chartType === 'totals' ? (
            <TotalsView totals={dock.totals} yFormat={dock.yFormat} />
          ) : (
            <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
              <div className="flex h-full flex-col gap-4">
                <div className={`flex-1 rounded-xl border border-gray-100 bg-gray-50 p-3 ${!hasData ? 'flex items-center justify-center' : ''}`}>
                  {!hasData ? (
                    <div className="text-sm text-gray-400">No chart data available.</div>
                  ) : dock.chartType === 'bar' ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey={dock.xKey} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                        <Tooltip content={<ChartTooltip yFormat={dock.yFormat} />} />
                        {visibleSeries.map((series, index) => (
                          <Bar
                            key={series.key}
                            dataKey={series.key}
                            name={series.label}
                            fill={COLOR_PALETTE[index % COLOR_PALETTE.length]}
                            radius={[6, 6, 0, 0]}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey={dock.xKey} tick={{ fontSize: 11 }} stroke="#9ca3af" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                        <Tooltip content={<ChartTooltip yFormat={dock.yFormat} />} />
                        {visibleSeries.map((series, index) => (
                          <Line
                            key={series.key}
                            dataKey={series.key}
                            name={series.label}
                            stroke={COLOR_PALETTE[index % COLOR_PALETTE.length]}
                            strokeWidth={series.kind === 'ma' ? 2 : 3}
                            dot={false}
                            type="monotone"
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {compareEnabled && previousDock && previousDock.data && previousDock.data.length > 0 && (
                  <div className="h-40 rounded-xl border border-gray-100 bg-white p-3">
                    <div className="mb-2 text-xs font-semibold text-gray-500">Compare view</div>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={previousDock.data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey={previousDock.xKey} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                        <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
                        <Tooltip content={<ChartTooltip yFormat={previousDock.yFormat} />} />
                        {(previousDock.series || []).filter(series => series.kind === 'raw').map((series, index) => (
                          <Line
                            key={series.key}
                            dataKey={series.key}
                            name={series.label}
                            stroke={COLOR_PALETTE[index % COLOR_PALETTE.length]}
                            strokeWidth={2}
                            dot={false}
                            type="monotone"
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="hidden h-full rounded-xl border border-gray-100 bg-gray-50 p-4 lg:block">
                {hasInspector ? (
                  <div className="space-y-4">
                    {dock.controls?.allowMetric && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">Metric</div>
                        <select
                          value={selectedMetric}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setSelectedMetric(nextValue);
                            onUpdateUi?.({ metric: nextValue });
                          }}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="">All metrics</option>
                          {rawSeries.map(series => (
                            <option key={series.key} value={series.key}>{series.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {dock.controls?.allowRange && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">Range</div>
                        <select
                          disabled={showRangeNote}
                          value={dock.ui?.rangePreset || '30d'}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="7d">Last 7 days</option>
                          <option value="14d">Last 14 days</option>
                          <option value="30d">Last 30 days</option>
                          <option value="custom">Custom</option>
                        </select>
                        {showRangeNote && (
                          <p className="mt-1 text-[11px] text-gray-400">Needs time-series data</p>
                        )}
                      </div>
                    )}

                    {dock.controls?.allowGroupBy && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">Group by</div>
                        <select
                          disabled={showGroupNote}
                          value={dock.ui?.groupBy || 'day'}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="day">Day</option>
                          <option value="week">Week</option>
                          <option value="month">Month</option>
                        </select>
                        {showGroupNote && (
                          <p className="mt-1 text-[11px] text-gray-400">Needs time-series data</p>
                        )}
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-400">
                    No controls available.
                  </div>
                )}
              </div>

              <div className="lg:hidden">
                {hasInspector && (
                  <button
                    onClick={() => setShowFilters(prev => !prev)}
                    className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500"
                  >
                    <span className="flex items-center gap-2"><Filter className="h-3.5 w-3.5" /> Filters</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                  </button>
                )}

                {hasInspector && showFilters && (
                  <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                    {dock.controls?.allowMetric && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-1">Metric</div>
                        <select
                          value={selectedMetric}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setSelectedMetric(nextValue);
                            onUpdateUi?.({ metric: nextValue });
                          }}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="">All metrics</option>
                          {rawSeries.map(series => (
                            <option key={series.key} value={series.key}>{series.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {dock.controls?.allowRange && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-1">Range</div>
                        <select
                          disabled={showRangeNote}
                          value={dock.ui?.rangePreset || '30d'}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="7d">Last 7 days</option>
                          <option value="14d">Last 14 days</option>
                          <option value="30d">Last 30 days</option>
                          <option value="custom">Custom</option>
                        </select>
                        {showRangeNote && (
                          <p className="mt-1 text-[11px] text-gray-400">Needs time-series data</p>
                        )}
                      </div>
                    )}

                    {dock.controls?.allowGroupBy && (
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-1">Group by</div>
                        <select
                          disabled={showGroupNote}
                          value={dock.ui?.groupBy || 'day'}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs"
                        >
                          <option value="day">Day</option>
                          <option value="week">Week</option>
                          <option value="month">Month</option>
                        </select>
                        {showGroupNote && (
                          <p className="mt-1 text-[11px] text-gray-400">Needs time-series data</p>
                        )}
                      </div>
                    )}

                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            {dock.controls?.allowMA && (
              <div className="flex items-center gap-2">
                {['OFF', 'MA7', 'MA14', 'MA30'].map(option => (
                  <button
                    key={option}
                    onClick={() => setSelectedMAWindow(option)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      selectedMAWindow === option
                        ? 'border-blue-200 bg-blue-50 text-blue-600'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
