import React from 'react';
import { Plus } from 'lucide-react';

const metricOptions = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'orders', label: 'Orders' },
  { value: 'spend', label: 'Spend' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'roas', label: 'ROAS' },
  { value: 'aov', label: 'AOV' },
  { value: 'conversion_rate', label: 'Conversion Rate' },
  { value: 'add_to_cart', label: 'Add To Cart' }
];

const dimensionOptions = [
  { value: 'date', label: 'Date' },
  { value: 'country', label: 'Country' },
  { value: 'campaign_name', label: 'Campaign' },
  { value: 'adset_name', label: 'Ad Set' },
  { value: 'platform', label: 'Platform' },
  { value: 'age', label: 'Age' },
  { value: 'gender', label: 'Gender' }
];

const chartTypeOptions = [
  { value: 'auto', label: 'Auto' },
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' }
];

const dateRanges = [
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' }
];

export default function ExploreSidebar({
  filters,
  onUpdate,
  onExport,
  availableMetrics
}) {
  const metrics = availableMetrics?.length
    ? metricOptions.filter(option => availableMetrics.includes(option.value))
    : metricOptions;

  return (
    <div className="h-full bg-gray-50 border-l border-gray-100 p-5 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Metric</span>
          <Plus className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <select
          value={filters.metric}
          onChange={(e) => onUpdate({ metric: e.target.value })}
          className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 hover:border-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          {metrics.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dimension</span>
          <Plus className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <select
          value={filters.dimension}
          onChange={(e) => onUpdate({ dimension: e.target.value })}
          className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 hover:border-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          {dimensionOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chart Type</span>
        </div>
        <select
          value={filters.chartType}
          onChange={(e) => onUpdate({ chartType: e.target.value })}
          className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 hover:border-gray-300 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          {chartTypeOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date Range</span>
        </div>
        <div className="space-y-2">
          {dateRanges.map(range => (
            <label key={range.value} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="dateRange"
                value={range.value}
                checked={filters.dateRange === range.value}
                onChange={(e) => onUpdate({ dateRange: e.target.value })}
                className="text-blue-500 focus:ring-blue-500"
              />
              {range.label}
            </label>
          ))}
          {filters.dateRange === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={filters.customDateStart || ''}
                onChange={(e) => onUpdate({ customDateStart: e.target.value })}
                className="h-9 bg-white border border-gray-200 rounded-lg px-2 text-xs text-gray-700"
              />
              <input
                type="date"
                value={filters.customDateEnd || ''}
                onChange={(e) => onUpdate({ customDateEnd: e.target.value })}
                className="h-9 bg-white border border-gray-200 rounded-lg px-2 text-xs text-gray-700"
              />
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filters</span>
          <Plus className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <p className="text-xs text-gray-400">No filters applied</p>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <button
          onClick={onExport}
          className="w-full h-10 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}
