/**
 * Explore Mode Component
 * Visual data explorer with query input and chart canvas
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import ChartRenderer from '../visualization/ChartRenderer';
import ChartSkeleton from '../visualization/ChartSkeleton';
import ExploreSidebar from './ExploreSidebar';
import ExploreQueryBar from './ExploreQueryBar';
import { getBrandColors, METRIC_INFO } from '../shared/chartUtils';

const QUICK_ACTIONS = [
  { icon: '📈', label: 'Revenue trend', query: 'revenue trend last 30 days' },
  { icon: '🌍', label: 'By country', query: 'revenue by country' },
  { icon: '📊', label: 'Top campaigns', query: 'top campaigns by revenue' },
  { icon: '🛒', label: 'Orders trend', query: 'orders trend last 30 days' }
];

export default function ExploreMode({ store, startDate, endDate }) {
  const activeStore = store?.id || store || 'vironax';
  const brandColors = getBrandColors(activeStore);
  const currency = activeStore === 'shawq' ? 'USD' : 'SAR';

  const [isLoading, setIsLoading] = useState(false);
  const [chartData, setChartData] = useState(null);
  const [error, setError] = useState(null);
  const [currentQuery, setCurrentQuery] = useState('');
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const [filters, setFilters] = useState({
    metric: 'revenue',
    dimension: 'country',
    chartType: 'auto',
    dateRange: '30d'
  });

  const abortControllerRef = useRef(null);

  // Fetch chart data when filters change (if we have an active query)
  useEffect(() => {
    if (chartData && currentQuery) {
      // Re-fetch with new filters
      fetchExploreData(currentQuery, filters);
    }
  }, [filters.metric, filters.dimension, filters.chartType, filters.dateRange]);

  const fetchExploreData = async (query, currentFilters = filters) => {
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          store: activeStore,
          currentFilters,
          startDate,
          endDate
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch chart data');
      }

      setChartData(result);
      setCurrentQuery(query);

      // Update filters from AI response if provided
      if (result.spec) {
        setFilters(prev => ({
          ...prev,
          metric: result.spec.metric || prev.metric,
          dimension: result.spec.dimension || prev.dimension,
          chartType: result.spec.chartType || prev.chartType,
          dateRange: result.spec.dateRange || prev.dateRange
        }));
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Explore fetch error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuerySubmit = (query) => {
    fetchExploreData(query);
  };

  const handleQuickAction = (query) => {
    fetchExploreData(query);
  };

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  const getFormatType = (metric) => {
    const info = METRIC_INFO[metric];
    return info?.format || 'number';
  };

  const getXKey = (dimension) => {
    return dimension === 'date' ? 'date' : 'category';
  };

  return (
    <div className="flex h-full">
      {/* Main Chart Canvas */}
      <div className="flex-1 flex flex-col bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Chart Area */}
        <div className="flex-1 p-6 overflow-y-auto">
          {/* Empty State */}
          {!chartData && !isLoading && !error && (
            <div className="h-full flex flex-col items-center justify-center text-gray-500">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                style={{ backgroundColor: `${brandColors.primary}15` }}
              >
                <Search className="w-8 h-8" style={{ color: brandColors.primary }} />
              </div>
              <p className="text-lg font-medium text-gray-900 mb-2">What do you want to see?</p>
              <p className="text-sm text-gray-400 mb-6 text-center max-w-md">
                Type a question like "revenue by country" or "daily orders last 30 days"
              </p>

              {/* Quick Action Buttons */}
              <div className="flex flex-wrap justify-center gap-3">
                {QUICK_ACTIONS.map((action, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleQuickAction(action.query)}
                    className="px-4 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-2"
                  >
                    <span>{action.icon}</span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading State */}
          {isLoading && (
            <div>
              {currentQuery && (
                <div className="mb-4">
                  <h2 className="text-xl font-semibold text-gray-900">{currentQuery}</h2>
                  <div className="h-4 bg-gray-100 rounded w-40 mt-2 animate-pulse"></div>
                </div>
              )}
              <ChartSkeleton height={400} />
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-red-500">
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
                <span className="text-3xl">⚠️</span>
              </div>
              <p className="text-lg font-medium text-gray-900 mb-2">Something went wrong</p>
              <p className="text-sm text-gray-500 mb-4">{error}</p>
              <button
                onClick={() => currentQuery && fetchExploreData(currentQuery)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {/* Active Chart State */}
          {chartData && !isLoading && !error && (
            <div className="chart-appear">
              {/* Title Row */}
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900">
                  {chartData.spec?.title || currentQuery}
                </h2>
                <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                  {chartData.meta?.total !== undefined && (
                    <span>
                      {currency === 'SAR' ? 'SAR ' : '$'}
                      {chartData.meta.total.toLocaleString()} total
                    </span>
                  )}
                  {chartData.meta?.periodStart && chartData.meta?.periodEnd && (
                    <>
                      <span>·</span>
                      <span>
                        {new Date(chartData.meta.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' - '}
                        {new Date(chartData.meta.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Chart */}
              {chartData.data && chartData.data.length > 0 ? (
                <div className="bg-white">
                  <ChartRenderer
                    chartType={chartData.spec?.chartType || filters.chartType || 'bar'}
                    data={chartData.data}
                    xKey={getXKey(chartData.spec?.dimension || filters.dimension)}
                    yKey="value"
                    metrics={chartData.spec?.isComparison ? chartData.spec.metrics : null}
                    height={Math.max(300, Math.min(500, window.innerHeight * 0.4))}
                    currency={currency}
                    formatType={getFormatType(chartData.spec?.metric || filters.metric)}
                    animate={true}
                    store={activeStore}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[300px] bg-gray-50 rounded-xl text-gray-400">
                  <span className="text-4xl mb-3">📊</span>
                  <p className="font-medium text-gray-600">No data for this period</p>
                  <p className="text-sm mt-1">Try selecting a different date range or check if data has been imported</p>
                </div>
              )}

              {/* Auto Label */}
              {chartData.spec?.autoReason && (
                <div className="mt-4 text-xs text-gray-400">
                  Auto: {chartData.spec.chartType} chart ({chartData.spec.autoReason})
                </div>
              )}
            </div>
          )}
        </div>

        {/* Query Bar */}
        <ExploreQueryBar
          onSubmit={handleQuerySubmit}
          isLoading={isLoading}
          showFiltersButton={true}
          onOpenFilters={() => setShowMobileFilters(true)}
        />
      </div>

      {/* Right Sidebar - Hidden on mobile */}
      <div className="hidden lg:block">
        <ExploreSidebar
          filters={filters}
          onFilterChange={handleFilterChange}
          chartData={chartData}
          store={activeStore}
        />
      </div>

      {/* Mobile Filters Sheet */}
      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowMobileFilters(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-5 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Chart Settings</h3>
              <button
                onClick={() => setShowMobileFilters(false)}
                className="p-2 text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <ExploreSidebar
              filters={filters}
              onFilterChange={(f) => {
                handleFilterChange(f);
                setShowMobileFilters(false);
              }}
              chartData={chartData}
              store={activeStore}
            />
          </div>
        </div>
      )}

      <style>{`
        @keyframes chartAppear {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .chart-appear { animation: chartAppear 300ms ease-out forwards; }
      `}</style>
    </div>
  );
}
