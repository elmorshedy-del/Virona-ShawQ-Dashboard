import React, { useEffect, useMemo, useState } from 'react';
import { LineChart } from 'lucide-react';
import ExploreSidebar from './ExploreSidebar';
import ExploreQueryBar from './ExploreQueryBar';
import ChartRenderer from '../visualization/ChartRenderer';
import ChartSkeleton from '../visualization/ChartSkeleton';
import { exportToCsv, sanitizeChartData } from '../shared/chartUtils';

const quickActions = [
  { label: '📈 Revenue trend', query: 'revenue trend last 30 days' },
  { label: '🌍 By country', query: 'revenue by country last 30 days' },
  { label: '📊 Top campaigns', query: 'top campaigns by revenue' },
  { label: '🛒 Orders trend', query: 'daily orders last 30 days' }
];

const metricFormatMap = {
  revenue: 'currency',
  spend: 'currency',
  aov: 'currency',
  roas: 'number',
  orders: 'number',
  impressions: 'number',
  clicks: 'number',
  conversion_rate: 'percent',
  add_to_cart: 'number'
};

const storeColors = {
  virona: ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#7C3AED', '#6D28D9'],
  shawq: ['#F97316', '#EA580C', '#DC2626', '#B91C1C', '#9A3412', '#7C2D12']
};

export default function ExploreMode({ store }) {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chartSpec, setChartSpec] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [chartMeta, setChartMeta] = useState(null);
  const [error, setError] = useState(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [filters, setFilters] = useState({
    metric: 'revenue',
    dimension: 'country',
    chartType: 'auto',
    dateRange: '14d',
    customDateStart: '',
    customDateEnd: ''
  });

  const activeStore = store?.id || store || 'vironax';
  const colorSet = activeStore === 'shawq' ? storeColors.shawq : storeColors.virona;

  const sanitizeData = (data) => sanitizeChartData(data, 'value');

  const resolvedChartType = chartSpec?.chartType === 'auto'
    ? chartSpec?.autoChartType || 'bar'
    : chartSpec?.chartType;

  const chartFormat = metricFormatMap[chartSpec?.metric] || 'number';
  const chartCurrency = chartMeta?.currency || (activeStore === 'shawq' ? 'USD' : 'SAR');

  const chartTitle = chartSpec?.title || 'Explore';
  const chartSubtitle = chartMeta
    ? `${new Intl.NumberFormat('en-US').format(chartMeta.total || 0)} total · ${chartMeta.periodStart} to ${chartMeta.periodEnd}`
    : '';

  const handleSubmit = async (overrideQuery) => {
    const nextQuery = overrideQuery ?? query;
    if (!nextQuery.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: nextQuery,
          store: activeStore,
          currentFilters: filters
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || 'Explore failed');
      }

      setChartSpec(payload.spec);
      setChartData(sanitizeData(payload.data));
      setChartMeta(payload.meta);
      setFilters(prev => ({
        ...prev,
        metric: payload.spec.metric || prev.metric,
        dimension: payload.spec.dimension || prev.dimension,
        chartType: payload.spec.chartType || prev.chartType,
        dateRange: payload.spec.dateRange || prev.dateRange,
        customDateStart: payload.spec.customDateStart || prev.customDateStart,
        customDateEnd: payload.spec.customDateEnd || prev.customDateEnd
      }));
    } catch (err) {
      console.error('Explore request failed', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilterChange = async (updates) => {
    const nextFilters = { ...filters, ...updates };
    setFilters(nextFilters);

    if (!chartSpec) return;

    try {
      const response = await fetch('/api/ai/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: null,
          store: activeStore,
          currentFilters: nextFilters,
          specOverride: {
            ...chartSpec,
            metric: nextFilters.metric,
            dimension: nextFilters.dimension,
            chartType: nextFilters.chartType,
            dateRange: nextFilters.dateRange,
            customDateStart: nextFilters.customDateStart,
            customDateEnd: nextFilters.customDateEnd
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || 'Explore failed');
      }

      setChartSpec(payload.spec);
      setChartData(sanitizeData(payload.data));
      setChartMeta(payload.meta);
    } catch (err) {
      console.error('Explore filter update failed', err);
    }
  };

  const handleExport = () => {
    if (!chartData?.length) return;
    exportToCsv(chartData, `${chartTitle.replace(/\s+/g, '-').toLowerCase()}.csv`);
  };

  useEffect(() => {
    setShowMobileFilters(false);
  }, [chartSpec]);

  const autoLabel = chartSpec?.chartType === 'auto'
    ? chartSpec?.autoReason
      ? `Auto: ${resolvedChartType} (${chartSpec.autoReason})`
      : `Auto: ${resolvedChartType}`
    : '';

  const chartContent = useMemo(() => {
    if (isLoading) {
      return <ChartSkeleton />;
    }

    if (!chartSpec) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center px-6">
          <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center text-3xl mb-4">
            🔍
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">What do you want to see?</h3>
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
                className="px-4 py-2 text-sm bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center px-6">
          <LineChart className="w-10 h-10 text-red-400 mb-3" />
          <p className="text-sm text-red-500">{error}</p>
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col chart-appear">
        <div className="mb-4">
          <h3 className="text-xl font-semibold text-gray-900">{chartTitle}</h3>
          {chartSubtitle && <p className="text-sm text-gray-500 mt-1">{chartSubtitle}</p>}
        </div>
        <div className="flex-1 min-h-[300px]">
          {chartData.length === 0 ? (
            <div className="h-full border border-gray-100 rounded-2xl flex flex-col items-center justify-center text-center text-gray-400">
              <div className="text-3xl mb-2">📊</div>
              <p className="text-sm text-gray-500">No data for this period</p>
              <p className="text-xs text-gray-400 mt-1">Try selecting a different date range</p>
            </div>
          ) : (
            <ChartRenderer
              chartType={resolvedChartType}
              data={chartData}
              xKey={chartSpec.dimension === 'date' ? 'date' : 'category'}
              yKey="value"
              height={360}
              currency={chartCurrency}
              formatType={chartFormat}
              colors={colorSet}
            />
          )}
        </div>
        {autoLabel && <div className="text-xs text-gray-400 mt-2">{autoLabel}</div>}
      </div>
    );
  }, [autoLabel, chartCurrency, chartData, chartFormat, chartSpec, chartSubtitle, chartTitle, colorSet, error, isLoading, resolvedChartType]);

  return (
    <div className="flex flex-1 h-full">
      <div className="flex-1 flex flex-col min-w-[400px]">
        <div className="flex-1 p-6 bg-white">
          {chartContent}
        </div>
        <ExploreQueryBar
          query={query}
          onQueryChange={setQuery}
          onSubmit={handleSubmit}
          onToggleFilters={() => setShowMobileFilters(prev => !prev)}
          showFiltersButton={true}
          isLoading={isLoading}
        />
      </div>

      <div className="hidden lg:flex">
        <ExploreSidebar
          filters={filters}
          onChange={handleFilterChange}
          onExport={handleExport}
        />
      </div>

      {showMobileFilters && (
        <div className="lg:hidden fixed inset-0 z-20 flex items-end bg-black/30">
          <div className="bg-white w-full rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto">
            <ExploreSidebar
              filters={filters}
              onChange={handleFilterChange}
              onExport={handleExport}
              onClose={() => setShowMobileFilters(false)}
              isMobile
            />
          </div>
        </div>
      )}
    </div>
  );
}
