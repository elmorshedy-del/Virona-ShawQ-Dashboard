import React from 'react';
import { Pin, X } from 'lucide-react';
import ChartRenderer from './ChartRenderer';
import ChartSkeleton from './ChartSkeleton';
import { sanitizeChartData, formatDateLabel } from '../shared/chartUtils';

const formatTypesByMetric = {
  revenue: 'currency',
  spend: 'currency',
  aov: 'currency',
  roas: 'number',
  conversion_rate: 'percent',
  orders: 'number',
  impressions: 'number',
  clicks: 'number',
  add_to_cart: 'number'
};

export default function VisualizationDock({
  status,
  spec,
  data,
  meta,
  pinned,
  onTogglePin,
  onClose,
  chartColors
}) {
  if (status === 'hidden') return null;

  const safeData = sanitizeChartData(data || [], 'value');
  const xKey = spec?.dimension === 'date' ? 'dateLabel' : 'category';
  const formattedData = spec?.dimension === 'date'
    ? safeData.map(row => ({ ...row, dateLabel: formatDateLabel(row.date) }))
    : safeData.map(row => ({ ...row, category: row.category || row.label || row.name }));

  return (
    <div className={`border border-gray-100 rounded-2xl p-4 bg-white shadow-sm mb-4 ${status === 'dismiss' ? 'dock-dismiss' : 'dock-appear'}`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{spec?.title || 'Visualization'}</h3>
          {spec?.note && (
            <p className="text-sm text-gray-500 mt-1 mb-3">{spec.note}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePin}
            className={`p-1 rounded-full ${pinned ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500'}`}
            title={pinned ? 'Unpin' : 'Pin'}
          >
            <Pin className="w-4.5 h-4.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600"
            title="Close"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      <div className="h-44">
        {status === 'loading' && <ChartSkeleton />}
        {status === 'error' && (
          <div className="flex items-center justify-center h-full text-sm text-red-500">
            Unable to load chart.
          </div>
        )}
        {status === 'active' && (
          <ChartRenderer
            chartType={spec?.chartType}
            data={formattedData}
            xKey={xKey}
            yKey="value"
            height={180}
            currency={meta?.currency}
            formatType={formatTypesByMetric[spec?.metric] || 'number'}
            animate
            colors={chartColors}
          />
        )}
      </div>

      {spec?.autoReason && (
        <p className="text-xs text-gray-400 mt-2">
          Auto: {spec.chartType} chart ({spec.autoReason})
        </p>
      )}
    </div>
  );
}
