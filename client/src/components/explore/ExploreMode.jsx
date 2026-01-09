import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ChartRenderer from '../visualization/ChartRenderer';
import ChartSkeleton from '../visualization/ChartSkeleton';
import ExploreQueryBar from './ExploreQueryBar';
import ExploreSidebar from './ExploreSidebar';
import {
  exportToCsv,
  formatDateLabel,
  getChartColors,
  getMetricFormat,
  sanitizeChartData
} from '../shared/chartUtils';

const QUICK_ACTIONS = [
  { icon: '📈', label: 'Revenue trend', query: 'Revenue trend last 30 days' },
  { icon: '🌍', label: 'By country', query: 'Revenue by country last 30 days' },
  { icon: '📊', label: 'Top campaigns', query: 'Top campaigns by revenue' },
  { icon: '🛒', label: 'Orders trend', query: 'Daily orders last 30 days' }
];

const DEFAULT_FILTERS = {
  metric: 'revenue',
  dimension: 'country',
  chartType: 'auto',
  dateRange: '14d',
  customDateStart: '',
  customDateEnd: ''
};

const buildTitle = (metric, dimension) => {
  const metricLabel = metric.replace(/_/g, ' ');
  const dimLabel = dimension.replace(/_/g, ' ');
  return `${metricLabel.charAt(0).toUpperCase() + metricLabel.slice(1)} by ${dimLabel}`;
};

export default function ExploreMode({ store }) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [chartSpec, setChartSpec] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [chartMeta, setChartMeta] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const sanitizedData = useMemo(() => sanitizeChartData(chartData), [chartData]);
  const displayChartType = filters.chartType === 'auto' ? chartSpec?.chartType : filters.chartType;
  const chartTitle = chartSpec?.title || buildTitle(filters.metric, filters.dimension);
  const formatType = getMetricFormat(filters.metric);

  const autoLabel = useMemo(() => {
    if (!displayChartType) return '';
    if (filters.chartType === 'auto') {
      const reason = chartSpec?.autoReason ? ` (${chartSpec.autoReason})` : '';
      return `Auto: ${displayChartType} chart${reason}`;
    }
    return `Manual: ${displayChartType} chart`;
  }, [displayChartType, filters.chartType, chartSpec]);

  const handleExport = () => {
    exportToCsv(sanitizedData);
  };

  const fetchExploreData = useCallback(async ({
    newQuery,
    nextFilters,
    skipAi = false
  }) => {
    if (!newQuery && !skipAi && !activeQuery) return;

    if (!skipAi) {
      setStatus('loading');
    } else {
      setIsRefreshing(true);
    }

    try {
      const requestFilters = {
        ...nextFilters,
        chartType: nextFilters.chartType === 'auto' ? chartSpec?.chartType || 'bar' : nextFilters.chartType,
        autoReason: chartSpec?.autoReason || undefined,
        title: chartSpec?.title || undefined
      };

      const response = await fetch('/api/ai/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: newQuery,
          store,
          currentFilters: requestFilters,
          skipAi
        })
      });

      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || 'Explore request failed');
      }

      setChartSpec(payload.spec);
      setChartData(payload.data || []);
      setChartMeta(payload.meta || null);
      setFilters(prev => ({
        ...prev,
        metric: payload.spec.metric || prev.metric,
        dimension: payload.spec.dimension || prev.dimension,
        dateRange: payload.spec.dateRange || prev.dateRange,
        customDateStart: payload.spec.customDateStart || '',
        customDateEnd: payload.spec.customDateEnd || ''
      }));

      if (!payload.data || payload.data.length === 0) {
        setStatus('empty');
      } else {
        setStatus('ready');
      }
      setError(null);
    } catch (err) {
      setError(err.message);
      setStatus('error');
    } finally {
      setIsRefreshing(false);
    }
  }, [activeQuery, chartSpec, store]);

  const submitQuery = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setActiveQuery(trimmed);
    fetchExploreData({ newQuery: trimmed, nextFilters: filters, skipAi: false });
  };

  const handleFilterChange = (nextFilters) => {
    setFilters(nextFilters);
    if (!chartSpec) return;
    fetchExploreData({ newQuery: activeQuery, nextFilters, skipAi: true });
  };

  useEffect(() => {
    if (!chartSpec) return;
    if (filters.chartType !== 'auto' && filters.chartType !== chartSpec.chartType) {
      setStatus(prev => (prev === 'idle' ? 'idle' : 'ready'));
    }
  }, [filters.chartType, chartSpec]);

  const subtitle = useMemo(() => {
    if (!chartMeta) return null;
    const totalValue = chartMeta.total ?? 0;
    const formattedTotal = formatType === 'currency'
      ? new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: chartMeta.currency || 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        }).format(totalValue)
      : formatType === 'percent'
        ? `${(totalValue * 100).toFixed(1)}%`
        : new Intl.NumberFormat('en-US').format(totalValue);

    return `${formattedTotal} total · ${chartMeta.periodLabel || 'Last period'}`;
  }, [chartMeta, formatType]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-[400px] p-6 flex flex-col">
          {status === 'idle' && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-4xl mb-4">🔍</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">What do you want to see?</h3>
                <p className="text-sm text-gray-500">Type a question like "revenue by country" or "daily orders last 30 days"</p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {QUICK_ACTIONS.map(action => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        setQuery(action.query);
                        setActiveQuery(action.query);
                        fetchExploreData({ newQuery: action.query, nextFilters: filters, skipAi: false });
                      }}
                      className="px-3 py-2 rounded-xl bg-white border border-gray-100 shadow-sm hover:shadow-md transition-all text-xs text-gray-700"
                    >
                      {action.icon} {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {status === 'loading' && (
            <div className="flex-1">
              <ChartSkeleton title={activeQuery || 'Loading chart'} />
            </div>
          )}

          {(status === 'ready' || status === 'empty') && (
            <div className="flex-1 flex flex-col gap-4 chart-appear">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{chartTitle}</h2>
                {subtitle && (
                  <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
                )}
              </div>

              <div className="flex-1 min-h-[300px]">
                {status === 'empty' ? (
                  <div className="h-full border border-gray-100 rounded-2xl flex items-center justify-center">
                    <div className="text-center text-gray-400">
                      <div className="text-3xl mb-2">📊</div>
                      <p className="text-sm font-medium">No data for this period</p>
                      <p className="text-xs text-gray-400">Try selecting a different date range or check if data has been imported</p>
                    </div>
                  </div>
                ) : (
                  <ChartRenderer
                    chartType={displayChartType}
                    data={sanitizedData}
                    xKey={filters.dimension === 'date' ? 'date' : 'category'}
                    yKey="value"
                    height={360}
                    currency={chartMeta?.currency}
                    formatType={formatType}
                    colors={getChartColors(store)}
                    xFormatter={filters.dimension === 'date' ? formatDateLabel : undefined}
                  />
                )}
              </div>
              {autoLabel && (
                <div className="text-xs text-gray-400">{autoLabel}</div>
              )}
              {isRefreshing && (
                <div className="text-xs text-gray-400 flex items-center gap-2">
                  <span className="animate-pulse">Updating chart</span>
                  <span className="w-1 h-1 rounded-full bg-gray-300" />
                  <span className="text-gray-300">Controls updated</span>
                </div>
              )}
            </div>
          )}

          {status === 'error' && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-sm text-red-500">{error || 'Something went wrong.'}</div>
            </div>
          )}
        </div>

        <div className="hidden lg:block w-[280px]">
          <ExploreSidebar
            filters={filters}
            onChange={handleFilterChange}
            onExport={handleExport}
          />
        </div>
      </div>

      <ExploreQueryBar
        value={query}
        onChange={setQuery}
        onSubmit={submitQuery}
        isSubmitting={status === 'loading'}
        onOpenFilters={() => setShowFilters(true)}
      />

      {showFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowFilters(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">Filters</span>
              <button
                type="button"
                onClick={() => setShowFilters(false)}
                className="text-sm text-gray-500"
              >
                Close
              </button>
            </div>
            <ExploreSidebar
              filters={filters}
              onChange={(next) => {
                handleFilterChange(next);
                setShowFilters(false);
              }}
              onExport={handleExport}
            />
          </div>
        </div>
      )}
    </div>
  );
}
