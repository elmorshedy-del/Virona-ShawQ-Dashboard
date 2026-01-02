import React, { useMemo, useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { Pin, Repeat2, GitCompare, Download, SlidersHorizontal } from 'lucide-react';

const CHART_COLORS = ['#2563eb', '#9333ea', '#0ea5e9', '#f97316', '#22c55e', '#64748b'];

function formatValue(value, format, currencyCode) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return String(value);

  if (format === 'currency') {
    const currency = currencyCode || 'USD';
    return numberValue.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 0 });
  }
  if (format === 'percent') {
    return `${numberValue.toFixed(1)}%`;
  }
  return numberValue.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function buildCsv(data) {
  if (!Array.isArray(data) || data.length === 0) return '';
  const headers = Array.from(
    data.reduce((acc, row) => {
      Object.keys(row || {}).forEach((key) => acc.add(key));
      return acc;
    }, new Set())
  );
  const lines = [headers.join(',')];
  data.forEach((row) => {
    const line = headers.map((key) => {
      const raw = row?.[key];
      if (raw === null || raw === undefined) return '';
      const value = typeof raw === 'string' ? raw.replace(/"/g, '""') : String(raw);
      return value.includes(',') ? `"${value}"` : value;
    });
    lines.push(line.join(','));
  });
  return lines.join('\n');
}

function computeMovingAverage(data, sourceKey, window) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const values = data.map((row) => Number(row?.[sourceKey]));
  return values.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = values.slice(start, index + 1).filter((value) => Number.isFinite(value));
    if (slice.length === 0) return null;
    const sum = slice.reduce((acc, val) => acc + val, 0);
    return sum / slice.length;
  });
}

function buildSeriesWithMovingAverage(series = [], data = [], selectedWindow) {
  const derivedData = data.map((row) => ({ ...row }));

  series
    .filter((item) => item.kind === 'ma' && item.derivedFrom && item.window)
    .forEach((item) => {
      const values = computeMovingAverage(data, item.derivedFrom, Number(item.window));
      values.forEach((value, idx) => {
        if (!derivedData[idx]) derivedData[idx] = {};
        derivedData[idx][item.key] = value;
      });
    });

  if (!selectedWindow || selectedWindow === 'off') {
    return { series, data: derivedData };
  }

  const derivedSeries = [];
  const existingKeys = new Set(series.map((item) => item.key));

  series
    .filter((item) => item.kind === 'raw')
    .forEach((item) => {
      const derivedKey = `ma_${selectedWindow}_${item.key}`;
      if (existingKeys.has(derivedKey)) return;
      const values = computeMovingAverage(data, item.key, Number(selectedWindow));
      values.forEach((value, idx) => {
        if (!derivedData[idx]) derivedData[idx] = {};
        derivedData[idx][derivedKey] = value;
      });
      derivedSeries.push({
        key: derivedKey,
        label: `${item.label || item.key} MA${selectedWindow}`,
        kind: 'ma',
        derivedFrom: item.key,
        window: Number(selectedWindow)
      });
    });

  return {
    series: [...series, ...derivedSeries],
    data: derivedData
  };
}

function ChartPanel({ dock, compareSnapshot, compareEnabled, selectedMA }) {
  const baseSeries = dock?.series || [];
  const baseData = dock?.data || [];

  const { series, data } = useMemo(
    () => buildSeriesWithMovingAverage(baseSeries, baseData, selectedMA),
    [baseSeries, baseData, selectedMA]
  );

  const chartContent = (chartDock, heightClass = 'h-full') => {
    if (!chartDock || !Array.isArray(chartDock.data) || chartDock.data.length === 0) {
      return (
        <div className={`flex items-center justify-center text-gray-400 text-sm ${heightClass}`}>
          No chart data available.
        </div>
      );
    }

    const activeSeries = chartDock.series || [];
    if (chartDock.chartType === 'bar') {
      return (
        <div className={heightClass}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartDock.data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey={chartDock.xKey || 'date'} tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) => formatValue(value, dock?.yFormat, dock?.currency)}
                contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {activeSeries.map((item, idx) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label || item.key}
                  fill={CHART_COLORS[idx % CHART_COLORS.length]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return (
      <div className={heightClass}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartDock.data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey={chartDock.xKey || 'date'} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value) => formatValue(value, dock?.yFormat, dock?.currency)}
              contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {activeSeries.map((item, idx) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.label || item.key}
                stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                strokeWidth={item.kind === 'ma' ? 2 : 2.5}
                strokeDasharray={item.kind === 'ma' ? '4 3' : undefined}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const chartDock = dock?.chartType === 'line' || dock?.chartType === 'bar'
    ? { ...dock, series, data }
    : dock;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex-1 min-h-0">
        {chartContent(chartDock, 'h-full')}
      </div>
      {compareEnabled && compareSnapshot && (compareSnapshot.chartType === 'line' || compareSnapshot.chartType === 'bar') && (
        <div className="h-40 rounded-xl border border-slate-100 bg-slate-50 p-2">
          <div className="text-xs text-slate-500 mb-1">Compare</div>
          {chartContent(compareSnapshot, 'h-[120px]')}
        </div>
      )}
    </div>
  );
}

export default function VisualizationDock({
  dock,
  pinned,
  onPinToggle,
  onReplace,
  onCompareToggle,
  compareEnabled,
  compareSnapshot,
  onExport,
  onUpdateDock,
  onExplainMissingData,
  lastRefreshed
}) {
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [selectedMA, setSelectedMA] = useState('off');
  const [isVisible, setIsVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (dock) {
      setIsVisible(true);
      setIsUpdating(true);
      const timer = setTimeout(() => setIsUpdating(false), 250);
      return () => clearTimeout(timer);
    }
    setIsVisible(false);
    return undefined;
  }, [dock]);

  if (!dock) return null;

  const hasChart = dock.chartType === 'line' || dock.chartType === 'bar';
  const hasTotals = dock.chartType === 'totals' || (dock.chartType === 'blocked' && dock.totals);
  const showMovingAverage = dock.controls?.allowMA;

  const formattedTimestamp = lastRefreshed
    ? new Date(lastRefreshed).toLocaleString()
    : null;

  const showTotals = () => {
    if (!dock.totals) return;
    onUpdateDock?.({ id: dock.id, chartType: 'totals' });
  };

  return (
    <div
      className={`px-4 pt-3 transition-all duration-250 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5'}`}
    >
      <div
        className={`bg-white border border-gray-200 shadow-sm rounded-2xl p-4 h-[280px] lg:h-[340px] flex flex-col transition-opacity ${
          isUpdating ? 'opacity-90' : 'opacity-100'
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{dock.title || 'Visualization'}</h3>
            {dock.mode === 'auto' && (
              <p className="text-xs text-gray-400">
                Auto: {dock.autoReason || `${dock.chartType || 'chart'} (date + numeric)`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPinToggle}
              className={`p-1.5 rounded-lg border ${pinned ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              title={pinned ? 'Unpin' : 'Pin'}
            >
              <Pin className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onReplace}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
              title="Replace"
            >
              <Repeat2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onCompareToggle}
              className={`p-1.5 rounded-lg border ${compareEnabled ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              title="Compare"
            >
              <GitCompare className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onExport}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
              title="Export"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 mt-3 flex flex-col lg:flex-row gap-4 min-h-0">
          <div className="flex-1 min-h-0">
            {dock.chartType === 'blocked' && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-6">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">Trend unavailable</h4>
                  <p className="text-xs text-gray-500 mt-1">
                    Daily trend requires daily time-series data. Showing totals instead.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={showTotals}
                    disabled={!dock.totals}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                      dock.totals
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    Show totals
                  </button>
                  <button
                    type="button"
                    onClick={onExplainMissingData}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-white"
                  >
                    Explain missing data
                  </button>
                </div>
              </div>
            )}

            {hasChart && dock.chartType !== 'blocked' && (
              <ChartPanel
                dock={dock}
                compareSnapshot={compareSnapshot}
                compareEnabled={compareEnabled}
                selectedMA={selectedMA}
              />
            )}

            {hasTotals && dock.chartType !== 'blocked' && (
              <div className="h-full grid grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(dock.totals || {}).map(([key, value]) => (
                  <div key={key} className="bg-slate-50 border border-slate-100 rounded-xl p-3">
                    <p className="text-xs text-slate-500 mb-1">{key}</p>
                    <p className="text-lg font-semibold text-slate-900">{value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:w-[280px]">
            <div className="lg:hidden mb-2">
              <button
                type="button"
                onClick={() => setShowMobileFilters((prev) => !prev)}
                className="inline-flex items-center gap-2 text-xs text-slate-600 border border-slate-200 rounded-lg px-2 py-1"
              >
                <SlidersHorizontal className="w-3 h-3" />
                Filters
              </button>
            </div>

            <div className={`${showMobileFilters ? 'block' : 'hidden'} lg:block border border-slate-100 rounded-xl p-3 bg-slate-50 h-full overflow-auto`}>
              <h4 className="text-xs font-semibold text-slate-600 mb-3">Mini Inspector</h4>

              {dock.controls?.allowMetric && (
                <div className="mb-3">
                  <label className="text-xs text-slate-500">Metric</label>
                  <select
                    className="mt-1 w-full text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white"
                    value={dock.ui?.metric || ''}
                    onChange={(event) => onUpdateDock?.({ id: dock.id, ui: { ...dock.ui, metric: event.target.value } })}
                  >
                    {(dock.series || [])
                      .filter((item) => item.kind === 'raw')
                      .map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label || item.key}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {dock.controls?.allowRange && (
                <div className="mb-3">
                  <label className="text-xs text-slate-500">Range</label>
                  <select
                    className="mt-1 w-full text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white"
                    value={dock.ui?.rangePreset || '30d'}
                    onChange={(event) =>
                      onUpdateDock?.({ id: dock.id, ui: { ...dock.ui, rangePreset: event.target.value } })
                    }
                  >
                    <option value="7d">Last 7 days</option>
                    <option value="14d">Last 14 days</option>
                    <option value="30d">Last 30 days</option>
                    <option value="custom">Custom</option>
                  </select>
                  {(!dock.data || dock.data.length === 0 || !dock.xKey) && (
                    <p className="text-[11px] text-amber-500 mt-1">Needs time-series data</p>
                  )}
                </div>
              )}

              {dock.controls?.allowGroupBy && (
                <div className="mb-3">
                  <label className="text-xs text-slate-500">Group by</label>
                  <select
                    className="mt-1 w-full text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white"
                    value={dock.ui?.groupBy || 'day'}
                    onChange={(event) =>
                      onUpdateDock?.({ id: dock.id, ui: { ...dock.ui, groupBy: event.target.value } })
                    }
                  >
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                  {(!dock.data || dock.data.length === 0 || !dock.xKey) && (
                    <p className="text-[11px] text-amber-500 mt-1">Needs time-series data</p>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            {showMovingAverage && (
              <div className="flex items-center gap-1.5">
                {['off', '7', '14', '30'].map((window) => (
                  <button
                    key={window}
                    type="button"
                    onClick={() => setSelectedMA(window)}
                    className={`px-2 py-1 text-[11px] rounded-full border transition-colors ${
                      selectedMA === window ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    {window === 'off' ? 'OFF' : `MA${window}`}
                  </button>
                ))}
              </div>
            )}
          </div>
          {formattedTimestamp && <span>Last refreshed {formattedTimestamp}</span>}
        </div>
      </div>
    </div>
  );
}

export { buildCsv };
