/**
 * Explore Sidebar Component
 * Right sidebar with controls for metric, dimension, chart type, and date range
 */

import React from 'react';
import { ChevronDown, Download } from 'lucide-react';
import { exportToCsv, getBrandColors, METRIC_INFO, DIMENSION_INFO } from '../shared/chartUtils';

const METRICS = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'orders', label: 'Orders' },
  { value: 'spend', label: 'Spend' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'roas', label: 'ROAS' },
  { value: 'aov', label: 'AOV' },
  { value: 'conversion_rate', label: 'Conversion Rate' },
  { value: 'add_to_cart', label: 'Add to Cart' }
];

const DIMENSIONS = [
  { value: 'date', label: 'Date (Time Series)' },
  { value: 'country', label: 'Country' },
  { value: 'campaign_name', label: 'Campaign' },
  { value: 'adset_name', label: 'Ad Set' },
  { value: 'platform', label: 'Platform' },
  { value: 'age', label: 'Age' },
  { value: 'gender', label: 'Gender' }
];

const CHART_TYPES = [
  { value: 'auto', label: 'Auto (AI decides)' },
  { value: 'line', label: 'Line Chart' },
  { value: 'bar', label: 'Bar Chart' },
  { value: 'area', label: 'Area Chart' },
  { value: 'pie', label: 'Pie Chart' }
];

const DATE_RANGES = [
  { value: '7d', label: '7 days' },
  { value: '14d', label: '14 days' },
  { value: '30d', label: '30 days' }
];

export default function ExploreSidebar({
  filters,
  onFilterChange,
  chartData,
  store = 'vironax'
}) {
  const brandColors = getBrandColors(store);

  const handleExport = () => {
    if (chartData?.data && chartData.data.length > 0) {
      const filename = `${chartData.spec?.title?.replace(/\s+/g, '-').toLowerCase() || 'explore-data'}-${new Date().toISOString().split('T')[0]}.csv`;
      exportToCsv(chartData.data, filename);
    }
  };

  const SelectField = ({ label, value, options, onChange }) => (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-10 px-3 pr-8 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 appearance-none cursor-pointer hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );

  return (
    <div className="w-[280px] bg-gray-50 border-l border-gray-100 p-5 overflow-y-auto flex-shrink-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Chart Settings</h3>

      <SelectField
        label="Metric"
        value={filters.metric}
        options={METRICS}
        onChange={(val) => onFilterChange({ ...filters, metric: val })}
      />

      <SelectField
        label="Dimension"
        value={filters.dimension}
        options={DIMENSIONS}
        onChange={(val) => onFilterChange({ ...filters, dimension: val })}
      />

      <SelectField
        label="Chart Type"
        value={filters.chartType}
        options={CHART_TYPES}
        onChange={(val) => onFilterChange({ ...filters, chartType: val })}
      />

      {/* Date Range Radio Buttons */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Date Range
        </label>
        <div className="space-y-2">
          {DATE_RANGES.map((range) => (
            <label
              key={range.value}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <input
                type="radio"
                name="dateRange"
                value={range.value}
                checked={filters.dateRange === range.value}
                onChange={(e) => onFilterChange({ ...filters, dateRange: e.target.value })}
                className="w-4 h-4 text-blue-500 border-gray-300 focus:ring-blue-500 focus:ring-offset-0"
                style={{ accentColor: brandColors.primary }}
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">
                {range.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Divider */}
      <hr className="my-5 border-gray-200" />

      {/* Export Button */}
      <button
        onClick={handleExport}
        disabled={!chartData?.data || chartData.data.length === 0}
        className="w-full h-10 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        <Download size={16} />
        Export CSV
      </button>

      {/* Chart Info */}
      {chartData?.meta && (
        <div className="mt-5 p-3 bg-white border border-gray-100 rounded-lg">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Summary
          </h4>
          <div className="space-y-1 text-sm">
            {chartData.meta.total !== undefined && (
              <div className="flex justify-between">
                <span className="text-gray-500">Total</span>
                <span className="font-medium text-gray-900">
                  {chartData.meta.currency === 'SAR' ? 'SAR ' : '$'}
                  {chartData.meta.total.toLocaleString()}
                </span>
              </div>
            )}
            {chartData.data && (
              <div className="flex justify-between">
                <span className="text-gray-500">Data points</span>
                <span className="font-medium text-gray-900">{chartData.data.length}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
