import React from 'react';
import { Plus, ChevronDown } from 'lucide-react';

const metrics = [
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

const dimensions = [
  { value: 'date', label: 'Date' },
  { value: 'country', label: 'Country' },
  { value: 'campaign_name', label: 'Campaign' },
  { value: 'adset_name', label: 'Ad Set' },
  { value: 'platform', label: 'Platform' },
  { value: 'age', label: 'Age' },
  { value: 'gender', label: 'Gender' }
];

const chartTypes = [
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
  onChange,
  onExport,
  showFilters = true,
  onClose,
  isMobile = false
}) {
  if (!showFilters) return null;

  return (
    <div className={`h-full ${isMobile ? 'w-full bg-white' : 'w-[280px] bg-gray-50 border-l border-gray-100'} p-5 flex flex-col gap-5`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chart</span>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 text-xs">Close</button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Metric</span>
          <Plus className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <div className="relative">
          <select
            value={filters.metric}
            onChange={(event) => onChange({ metric: event.target.value })}
            className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          >
            {metrics.map(metric => (
              <option key={metric.value} value={metric.value}>{metric.label}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dimension</span>
          <Plus className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <div className="relative">
          <select
            value={filters.dimension}
            onChange={(event) => onChange({ dimension: event.target.value })}
            className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          >
            {dimensions.map(dimension => (
              <option key={dimension.value} value={dimension.value}>{dimension.label}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chart Type</span>
        </div>
        <div className="relative">
          <select
            value={filters.chartType}
            onChange={(event) => onChange({ chartType: event.target.value })}
            className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          >
            {chartTypes.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Date Range</span>
        </div>
        <div className="space-y-2">
          {dateRanges.map(range => (
            <label key={range.value} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="dateRange"
                checked={filters.dateRange === range.value}
                onChange={() => onChange({ dateRange: range.value })}
                className="text-blue-500 focus:ring-blue-500"
              />
              {range.label}
            </label>
          ))}
        </div>
        {filters.dateRange === 'custom' && (
          <div className="mt-3 space-y-2">
            <input
              type="date"
              value={filters.customDateStart || ''}
              onChange={(event) => onChange({ customDateStart: event.target.value })}
              className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            />
            <input
              type="date"
              value={filters.customDateEnd || ''}
              onChange={(event) => onChange({ customDateEnd: event.target.value })}
              className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            />
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filters</span>
          <Plus className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <p className="text-xs text-gray-400">No filters applied</p>
      </div>

      <div className="mt-auto">
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
