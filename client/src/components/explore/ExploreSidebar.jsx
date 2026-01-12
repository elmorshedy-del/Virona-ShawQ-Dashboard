import React, { useState } from 'react';
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

const CHART_TYPES = [
  { value: 'auto', label: 'Auto' },
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' }
];

const DATE_RANGES = [
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom' }
];

export default function ExploreSidebar({ filters, onChange, onExport, className = '' }) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  const handleSelect = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className={`w-[280px] bg-gray-50 border-l border-gray-100 p-5 flex flex-col gap-4 ${className}`}>
      <div>
        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          <span>Metric</span>
          <Plus className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <select
          className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          value={filters.metric}
          onChange={(e) => handleSelect('metric', e.target.value)}
        >
          {METRIC_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          <span>Dimension</span>
          <Plus className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
        </div>
        <select
          className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          value={filters.dimension}
          onChange={(e) => handleSelect('dimension', e.target.value)}
        >
          {DIMENSION_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Chart Type
        </div>
        <select
          className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          value={filters.chartType}
          onChange={(e) => handleSelect('chartType', e.target.value)}
        >
          {CHART_TYPES.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Date Range
        </div>
        <div className="space-y-2">
          {DATE_RANGES.map(option => (
            <label key={option.value} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="date-range"
                value={option.value}
                checked={filters.dateRange === option.value}
                onChange={() => handleSelect('dateRange', option.value)}
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
              onChange={(e) => handleSelect('customDateStart', e.target.value)}
              className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900"
            />
            <input
              type="date"
              value={filters.customDateEnd || ''}
              onChange={(e) => handleSelect('customDateEnd', e.target.value)}
              className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900"
            />
          </div>
        )}
      </div>

      <div className="border-t border-gray-100" />

      <div>
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="flex items-center justify-between w-full text-xs font-semibold text-gray-500 uppercase tracking-wide"
        >
          <span>Filters</span>
          <Plus className={`w-4 h-4 transition-transform ${filtersOpen ? 'rotate-45 text-gray-600' : 'text-gray-400'}`} />
        </button>
        {filtersOpen && (
          <div className="mt-3 text-sm text-gray-500 bg-white border border-gray-100 rounded-lg p-3">
            Add filters in a future iteration.
          </div>
        )}
      </div>

      <div className="border-t border-gray-100" />

      <button
        onClick={onExport}
        className="w-full h-10 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
      >
        Export CSV
      </button>
    </div>
  );
}
