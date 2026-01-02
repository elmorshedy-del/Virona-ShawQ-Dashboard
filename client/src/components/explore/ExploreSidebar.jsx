import React from 'react';
import { Plus } from 'lucide-react';

const METRIC_OPTIONS = [
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

const DIMENSION_OPTIONS = [
  { value: 'date', label: 'Date' },
  { value: 'country', label: 'Country' },
  { value: 'campaign_name', label: 'Campaign' },
  { value: 'adset_name', label: 'Ad Set' },
  { value: 'platform', label: 'Platform' },
  { value: 'age', label: 'Age' },
  { value: 'gender', label: 'Gender' }
];

const CHART_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' }
];

const DATE_OPTIONS = [
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' }
];

export default function ExploreSidebar({ filters, onChange, onExport }) {
  const updateFilter = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="h-full bg-gray-50 border-l border-gray-100 p-5 flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Metric
          <Plus className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <select
          value={filters.metric}
          onChange={(e) => updateFilter('metric', e.target.value)}
          className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none hover:border-gray-300"
        >
          {METRIC_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Dimension
          <Plus className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <select
          value={filters.dimension}
          onChange={(e) => updateFilter('dimension', e.target.value)}
          className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none hover:border-gray-300"
        >
          {DIMENSION_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Chart Type</div>
        <select
          value={filters.chartType}
          onChange={(e) => updateFilter('chartType', e.target.value)}
          className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none hover:border-gray-300"
        >
          {CHART_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Date Range</div>
        <div className="space-y-2">
          {DATE_OPTIONS.map(option => (
            <label key={option.value} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="dateRange"
                value={option.value}
                checked={filters.dateRange === option.value}
                onChange={(e) => updateFilter('dateRange', e.target.value)}
                className="text-blue-500 focus:ring-blue-500"
              />
              {option.label}
            </label>
          ))}
        </div>
        {filters.dateRange === 'custom' && (
          <div className="mt-3 space-y-2">
            <input
              type="date"
              value={filters.customDateStart || ''}
              onChange={(e) => updateFilter('customDateStart', e.target.value)}
              className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none"
            />
            <input
              type="date"
              value={filters.customDateEnd || ''}
              onChange={(e) => updateFilter('customDateEnd', e.target.value)}
              className="w-full h-10 bg-white border border-gray-200 rounded-lg px-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Filters
          <Plus className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <p className="text-xs text-gray-400">No additional filters applied.</p>
      </div>

      <div className="mt-auto">
        <button
          type="button"
          onClick={onExport}
          className="w-full h-10 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
}
