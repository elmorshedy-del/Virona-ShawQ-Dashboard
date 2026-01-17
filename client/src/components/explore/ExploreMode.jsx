import React, { useMemo, useState } from 'react';
import ExploreSidebar from './ExploreSidebar';
import ExploreQueryBar from './ExploreQueryBar';
import ChartRenderer from '../visualization/ChartRenderer';
import ChartSkeleton from '../visualization/ChartSkeleton';
import { exportToCsv, formatDateLabel, sanitizeChartData } from '../shared/chartUtils';

const quickActions = [
  { label: '📈 Revenue trend', query: 'Revenue trend last 30 days' },
  { label: '🌍 By country', query: 'Revenue by country last 30 days' },
  { label: '📊 Top campaigns', query: 'Top campaigns by revenue' },
  { label: '🛒 Orders trend', query: 'Daily orders last 30 days' }
];

const formatTypesByMetric = {
  revenue: 'currency',
  spend: 'currency',
  aov: 'currency',
  roas: 'number',
  conversion_rate: 'percent',
  orders: 'number',
  impressions: 'number',
  clicks: 'number',
  add_to_cart: 'number'
};

export default function ExploreMode({ store, chartColors }) {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [chartSpec, setChartSpec] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [meta, setMeta] = useState(null);
  const [availableMetrics, setAvailableMetrics] = useState(null);
  const [filters, setFilters] = useState({
    metric: 'revenue',
    dimension: 'country',
    chartType: 'auto',
    dateRange: '14d',
    customDateStart: '',
    customDateEnd: ''
  });
  const [showFilters, setShowFilters] = useState(false);

  const resolvedChartType = filters.chartType === 'auto' ? chartSpec?.chartType : filters.chartType;
  const formatType = formatTypesByMetric[filters.metric] || 'number';

  const formattedData = useMemo(() => {
    const sanitized = sanitizeChartData(chartData, 'value');
    if (filters.dimension === 'date') {
      return sanitized.map(row => ({
        ...row,
        dateLabel: formatDateLabel(row.date)
      }));
    }
    return sanitized.map(row => ({
      ...row,
      category: row.category || row.label || row.name
    }));
  }, [chartData, filters.dimension]);

  const chartXKey = filters.dimension === 'date' ? 'dateLabel' : 'category';

  const fetchExplore = async ({ queryText, useAI, nextFilters }) => {
    const filtersToUse = nextFilters || filters;
    const payload = {
      query: queryText,
      store: store || 'vironax',
      currentFilters: {
        metric: filtersToUse.metric,
        dimension: filtersToUse.dimension,
        chartType: filtersToUse.chartType,
        dateRange: filtersToUse.dateRange,
        customDateStart: filtersToUse.customDateStart,
        customDateEnd: filtersToUse.customDateEnd
      },
      skipAI: !useAI
    };

    const response = await fetch('/api/ai/explore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
  };

  const handleSubmit = async (overrideQuery) => {
    const queryText = (overrideQuery ?? query).trim();
    if (!queryText) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchExplore({ queryText, useAI: true });
      if (!data.success) {
        setError(data.error || 'Unable to create a chart for that request.');
        setChartSpec(null);
        setChartData([]);
        setMeta(null);
        return;
      }

      setChartSpec(data.spec);
      setChartData(data.data || []);
      setMeta(data.meta || null);
      setAvailableMetrics(data.availableMetrics || null);
      setFilters(prev => ({
        ...prev,
        metric: data.spec.metric || prev.metric,
        dimension: data.spec.dimension || prev.dimension,
        dateRange: data.spec.dateRange || prev.dateRange,
        customDateStart: data.spec.customDateStart || '',
        customDateEnd: data.spec.customDateEnd || ''
      }));
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFiltersUpdate = async (nextFilters) => {
    const mergedFilters = { ...filters, ...nextFilters };
    setFilters(mergedFilters);

    if (!chartSpec) return;
    if (mergedFilters.dateRange === 'custom') {
      if (!mergedFilters.customDateStart || !mergedFilters.customDateEnd) return;
    }

    setIsUpdating(true);
    setError(null);

    try {
      const data = await fetchExplore({ queryText: query, useAI: false, nextFilters: mergedFilters });
      if (!data.success) {
        setError(data.error || 'Unable to update chart data.');
        return;
      }

      setChartSpec(data.spec);
      setChartData(data.data || []);
      setMeta(data.meta || null);
    } catch (fetchError) {
      setError(fetchError.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleExport = () => {
    exportToCsv(chartData, `${chartSpec?.title || 'chart-data'}.csv`);
  };

  const renderEmptyState = () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">🔍</div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">What do you want to see?</h2>
        <p className="text-sm text-gray-500 mb-6">
          Type a question like "revenue by country" or "daily orders last 30 days"
        </p>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map(action => (
            <button
              key={action.label}
              onClick={() => {
                setQuery(action.query);
                handleSubmit(action.query);
              }}
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl hover:border-gray-300 shadow-sm"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderNoData = () => (
    <div className="flex items-center justify-center h-80 border border-gray-100 rounded-2xl bg-white">
      <div className="text-center text-gray-400">
        <div className="text-3xl mb-2">📊</div>
        <p className="text-sm font-medium text-gray-500">No data for this period</p>
        <p className="text-xs text-gray-400 mt-1">Try selecting a different date range</p>
      </div>
    </div>
  );

  const showChart = chartSpec && !error;
  const totalLabel = meta?.total ? new Intl.NumberFormat('en-US', {
    style: meta.currency ? 'currency' : 'decimal',
    currency: meta.currency || 'USD',
    maximumFractionDigits: 0
  }).format(meta.total) : null;

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-[400px]">
        <div className="flex-1 p-6">
          {!chartSpec && !isLoading && !error && renderEmptyState()}

          {isLoading && (
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <ChartSkeleton />
            </div>
          )}

          {error && (
            <div className="bg-white rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h3>
              <p className="text-sm text-gray-500">{error}</p>
            </div>
          )}

          {showChart && !isLoading && (
            <div className={`bg-white rounded-2xl p-6 shadow-sm chart-appear ${isUpdating ? 'opacity-70' : 'opacity-100'} transition-opacity duration-200`}>
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-gray-900">{chartSpec.title}</h2>
                {(totalLabel || meta?.periodStart) && (
                  <p className="text-sm text-gray-500 mt-1">
                    {totalLabel ? `${totalLabel} total` : ''}
                    {meta?.periodStart && meta?.periodEnd && (
                      <span>{totalLabel ? ' · ' : ''}{meta.periodStart} → {meta.periodEnd}</span>
                    )}
                  </p>
                )}
              </div>

              {formattedData.length === 0 ? (
                renderNoData()
              ) : (
                <div className="h-[360px]">
                  <ChartRenderer
                    chartType={resolvedChartType}
                    data={formattedData}
                    xKey={chartXKey}
                    yKey="value"
                    height={340}
                    currency={meta?.currency}
                    formatType={formatType}
                    animate
                    colors={chartColors}
                  />
                </div>
              )}

              {filters.chartType === 'auto' && chartSpec.autoReason && (
                <p className="text-xs text-gray-400 mt-3">
                  Auto: {chartSpec.chartType} chart ({chartSpec.autoReason})
                </p>
              )}
            </div>
          )}
        </div>

        <ExploreQueryBar
          query={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          onOpenFilters={() => setShowFilters(true)}
        />
      </div>

      <div className="hidden lg:block w-72">
        <ExploreSidebar
          filters={filters}
          onUpdate={handleFiltersUpdate}
          onExport={handleExport}
          availableMetrics={availableMetrics}
        />
      </div>

      {showFilters && (
        <div className="lg:hidden fixed inset-0 bg-black/30 z-50 flex items-end">
          <div className="bg-white rounded-t-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-medium text-gray-900">Filters</h3>
              <button
                onClick={() => setShowFilters(false)}
                className="text-sm text-gray-500"
              >
                Close
              </button>
            </div>
            <ExploreSidebar
              filters={filters}
              onUpdate={handleFiltersUpdate}
              onExport={handleExport}
              availableMetrics={availableMetrics}
            />
          </div>
        </div>
      )}
    </div>
  );
}
