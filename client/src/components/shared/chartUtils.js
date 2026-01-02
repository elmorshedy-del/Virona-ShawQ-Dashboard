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
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
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

export function getBrandChartColors(store) {
  const normalized = (store || '').toLowerCase();

  if (normalized === 'shawq' || normalized === 'shawqq') {
    return ['#ff6b35', '#f97316', '#f59e0b', '#fbbf24', '#fb7185', '#c026d3'];
  }

  return ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#6366F1'];
}

export function formatValue(value, { currency, formatType = 'number' } = {}) {
  if (formatType === 'currency') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value || 0);
  }
  if (formatType === 'percent') {
    return `${((value || 0) * 100).toFixed(1)}%`;
  }
  return new Intl.NumberFormat('en-US').format(value || 0);
}
