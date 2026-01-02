/**
 * Chart Utilities
 * Shared utilities for chart data handling, CSV export, and formatting
 */

// Brand colors - Virona uses violet, Shawq uses magma/orange
export const BRAND_COLORS = {
  virona: {
    primary: '#8B5CF6',    // violet-500
    secondary: '#7C3AED',  // violet-600
    accent: '#A78BFA',     // violet-400
    series: ['#8B5CF6', '#7C3AED', '#10B981', '#F59E0B', '#EF4444', '#6366F1']
  },
  shawq: {
    primary: '#F97316',    // orange-500
    secondary: '#EA580C',  // orange-600
    accent: '#FB923C',     // orange-400
    series: ['#F97316', '#EA580C', '#10B981', '#8B5CF6', '#EF4444', '#6366F1']
  }
};

// Default chart colors (fallback)
export const CHART_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#6366F1'];

/**
 * Get brand-specific chart colors
 */
export function getBrandColors(store) {
  const storeId = (store?.id || store || 'vironax').toLowerCase();
  if (storeId === 'shawq') {
    return BRAND_COLORS.shawq;
  }
  return BRAND_COLORS.virona;
}

/**
 * Sanitize chart data - remove nulls, NaN, undefined
 */
export function sanitizeChartData(data, valueKey = 'value') {
  if (!Array.isArray(data)) return [];

  return data
    .filter(row => row != null)
    .map(row => ({
      ...row,
      [valueKey]: typeof row[valueKey] === 'number' && !isNaN(row[valueKey])
        ? row[valueKey]
        : 0
    }));
}

/**
 * Export data to CSV
 */
export function exportToCsv(data, filename = 'chart-data.csv') {
  if (!Array.isArray(data) || data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => {
        const val = row[h];
        // Escape commas and quotes
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(',')
    )
  ];

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Format date for display
 */
export function formatDateLabel(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Calculate date range
 */
export function getDateRange(preset) {
  const end = new Date();
  const start = new Date();

  switch (preset) {
    case '7d':
      start.setDate(end.getDate() - 7);
      break;
    case '14d':
      start.setDate(end.getDate() - 14);
      break;
    case '30d':
      start.setDate(end.getDate() - 30);
      break;
    default:
      start.setDate(end.getDate() - 30);
  }

  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0]
  };
}

/**
 * Format value based on type
 */
export function formatValue(value, formatType = 'number', currency = 'SAR') {
  if (value === null || value === undefined) return '-';

  if (formatType === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  if (formatType === 'percent') {
    return `${(value * 100).toFixed(1)}%`;
  }

  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Truncate text with ellipsis
 */
export function truncateLabel(text, maxLength = 15) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Validate chart payload
 */
export function isValidChartPayload(payload) {
  if (!payload?.spec || !payload?.data) return false;
  if (!['line', 'bar', 'area', 'pie'].includes(payload.spec.chartType)) return false;
  if (!Array.isArray(payload.data)) return false;
  return true;
}

/**
 * Get metric display info
 */
export const METRIC_INFO = {
  revenue: { label: 'Revenue', format: 'currency', icon: '💰' },
  orders: { label: 'Orders', format: 'number', icon: '🛒' },
  spend: { label: 'Spend', format: 'currency', icon: '💸' },
  impressions: { label: 'Impressions', format: 'number', icon: '👁️' },
  clicks: { label: 'Clicks', format: 'number', icon: '🖱️' },
  roas: { label: 'ROAS', format: 'number', icon: '🎯' },
  aov: { label: 'AOV', format: 'currency', icon: '🧾' },
  conversion_rate: { label: 'Conv. Rate', format: 'percent', icon: '📈' },
  add_to_cart: { label: 'Add to Cart', format: 'number', icon: '🧺' }
};

/**
 * Get dimension display info
 */
export const DIMENSION_INFO = {
  date: { label: 'Date', icon: '📅' },
  country: { label: 'Country', icon: '🌍' },
  campaign_name: { label: 'Campaign', icon: '📣' },
  adset_name: { label: 'Ad Set', icon: '🎯' },
  platform: { label: 'Platform', icon: '📱' },
  age: { label: 'Age', icon: '👤' },
  gender: { label: 'Gender', icon: '⚧️' }
};
