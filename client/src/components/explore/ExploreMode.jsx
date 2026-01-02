import React, { useMemo, useRef, useState } from 'react';
import ChartRenderer from '../visualization/ChartRenderer';
import ChartSkeleton from '../visualization/ChartSkeleton';
import ExploreSidebar from './ExploreSidebar';
import ExploreQueryBar from './ExploreQueryBar';
import { exportToCsv, formatDateLabel, formatValue, getBrandChartColors, sanitizeChartData } from '../shared/chartUtils';

const QUICK_ACTIONS = [
  { label: '📈 Revenue trend', query: 'revenue trend last 30 days' },
  { label: '🌍 By country', query: 'revenue by country last 30 days' },
  { label: '📊 Top campaigns', query: 'top campaigns by revenue' },
  { label: '🛒 Orders trend', query: 'daily orders last 30 days' }
];

const DEFAULT_FILTERS = {
  metric: 'revenue',
  dimension: 'country',
  chartType: 'auto',
  dateRange: '14d',
  customDateStart: '',
  customDateEnd: ''
};

export default function ExploreMode({ store }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [status, setStatus] = useState('idle');
  const [spec, setSpec] = useState(null);
  const [data, setData] = useState([]);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastQueryRef = useRef('');

  const chartColors = useMemo(() => getBrandChartColors(store), [store]);

  const formattedData = useMemo(() => {
    const safeData = sanitizeChartData(data, 'value');
    if (spec?.dimension === 'date') {
      return safeData.map(row => ({
        ...row,
        dateLabel: formatDateLabel(row.date)
      }));
    }
    return safeData;
  }, [data, spec]);

  const formattedTotal = useMemo(() => {
    if (!meta) return null;
    return formatValue(meta.total, { currency: meta.currency, formatType: meta.formatType });
  }, [meta]);

  const periodLabel = useMemo(() => {
    if (!meta?.periodStart || !meta?.periodEnd) return '';
    return `${meta.periodStart} – ${meta.periodEnd}`;
  }, [meta]);

  const handleSubmit = async () => {
    if (!query.trim()) return;
    setStatus('loading');
    setError(null);

    try {
      const response = await fetch('/api/ai/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          store,
          currentFilters: filters
        })
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Unable to generate chart');
      }

      lastQueryRef.current = query.trim();
      setSpec(result.spec);
      setData(result.data || []);
      setMeta(result.meta || null);
      setFilters(prev => ({
        ...prev,
        metric: result.spec.metric,
        dimension: result.spec.dimension,
        chartType: result.spec.chartType === 'auto' ? 'auto' : result.spec.chartType,
        dateRange: result.spec.dateRange,
        customDateStart: result.spec.customDateStart || '',
        customDateEnd: result.spec.customDateEnd || ''
      }));
      setStatus('active');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  const refreshData = async (nextFilters) => {
    if (!spec) return;
    setIsRefreshing(true);

    try {
      const response = await fetch('/api/ai/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store,
          query: lastQueryRef.current || query,
          currentFilters: nextFilters,
          skipAI: true,
          specOverride: {
            title: spec.title,
            autoReason: spec.autoReason
          }
        })
      });

      const result = await response.json();
      if (response.ok && result.success) {
        setSpec(result.spec);
        setData(result.data || []);
        setMeta(result.meta || null);
      }
    } catch (err) {
      console.error('Explore refresh failed', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFiltersChange = (nextFilters) => {
    setFilters(nextFilters);
    if (spec) {
      refreshData(nextFilters);
    }
  };

  const handleQuickAction = (actionQuery) => {
    setQuery(actionQuery);
    setTimeout(() => handleSubmit(), 0);
  };

  const handleExport = () => {
    if (!data || data.length === 0) return;
    exportToCsv(data, `${spec?.title || 'explore-chart'}.csv`);
  };

  const showNoData = status === 'active' && (!data || data.length === 0);

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-hidden">
          {status === 'idle' && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-lg">
                <div className="text-5xl mb-6">🔍</div>
                <h2 className="text-xl font-semibold text-gray-900 mb-2">What do you want to see?</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Type a question like "revenue by country" or "daily orders last 30 days".
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {QUICK_ACTIONS.map(action => (
                    <button
                      key={action.label}
                      onClick={() => handleQuickAction(action.query)}
                      className="px-4 py-3 text-sm bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {status === 'loading' && (
            <div className="h-full p-6">
              <ChartSkeleton height={320} />
            </div>
          )}

          {status === 'error' && (
            <div className="h-full flex items-center justify-center">
              <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm text-center">
                <p className="text-gray-900 font-medium mb-2">We could not generate that chart.</p>
                <p className="text-sm text-gray-500">{error}</p>
              </div>
            </div>
          )}

          {status === 'active' && (
            <div className="h-full p-6 flex flex-col gap-4 chart-appear">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{spec?.title}</h2>
                {meta && (
                  <p className="text-sm text-gray-500 mt-1">
                    {formattedTotal} total · {periodLabel}
                  </p>
                )}
              </div>

              <div className="flex-1 bg-white rounded-2xl p-6 min-h-[300px]">
                {showNoData ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400">
                    <div className="text-4xl mb-3">📊</div>
                    <p className="text-sm font-medium text-gray-500">No data for this period</p>
                    <p className="text-xs text-gray-400 mt-2">
                      Try selecting a different date range or check if data has been imported.
                    </p>
                  </div>
                ) : (
                  <ChartRenderer
                    chartType={spec?.chartType}
                    data={formattedData}
                    xKey={spec?.dimension === 'date' ? 'dateLabel' : 'category'}
                    yKey="value"
                    height={320}
                    currency={meta?.currency}
                    formatType={meta?.formatType}
                    animate
                    colors={chartColors}
                  />
                )}
              </div>

              <div className="text-xs text-gray-400">
                Auto: {spec?.chartType} chart ({spec?.autoReason || 'selected for readability'})
                {isRefreshing && <span className="ml-2">Updating…</span>}
              </div>
            </div>
          )}
        </div>

        <ExploreQueryBar
          query={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          disabled={status === 'loading'}
          onOpenFilters={() => setShowMobileFilters(true)}
          showFiltersButton
        />
      </div>

      <div className="hidden lg:flex">
        <ExploreSidebar filters={filters} onChange={handleFiltersChange} onExport={handleExport} />
      </div>

      {showMobileFilters && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowMobileFilters(false)} />
          <div className="relative mt-auto w-full bg-white rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">Filters</h3>
              <button
                onClick={() => setShowMobileFilters(false)}
                className="text-sm text-gray-500"
              >
                Close
              </button>
            </div>
            <ExploreSidebar
              filters={filters}
              onChange={handleFiltersChange}
              onExport={handleExport}
              className="w-full border-l-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
