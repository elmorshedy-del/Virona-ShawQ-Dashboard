import React from 'react';
import { Pin, X } from 'lucide-react';
import ChartRenderer from './ChartRenderer';
import ChartSkeleton from './ChartSkeleton';
import { formatDateLabel, getChartColors, getMetricFormat, sanitizeChartData } from '../shared/chartUtils';

export default function VisualizationDock({
  status,
  chartPayload,
  pinned,
  onPinToggle,
  onClose,
  store
}) {
  if (status === 'hidden') return null;

  const spec = chartPayload?.spec;
  const data = sanitizeChartData(chartPayload?.data || []);
  const meta = chartPayload?.meta;
  const chartType = spec?.chartType;
  const formatType = getMetricFormat(spec?.metric);

  const autoLabel = spec?.autoReason
    ? `Auto: ${spec.chartType} (${spec.autoReason})`
    : spec?.chartType
      ? `Auto: ${spec.chartType} chart`
      : '';

  return (
    <div className="dock-appear border border-gray-100 bg-white rounded-2xl p-4 shadow-sm mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {spec?.title || 'Visualization'}
          </h3>
          {spec?.note && (
            <p className="text-sm text-gray-500 mt-1 mb-3">{spec.note}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPinToggle}
            className={`p-1 rounded-md transition-colors ${pinned ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500'}`}
            title={pinned ? 'Unpin' : 'Pin'}
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="h-[180px] flex items-center">
          <ChartSkeleton title="Preparing chart" />
        </div>
      )}

      {status === 'error' && (
        <div className="h-[180px] flex items-center justify-center text-sm text-red-500">
          {chartPayload?.error || 'Unable to render chart right now.'}
        </div>
      )}

      {status === 'active' && (
        <>
          <div className="h-[180px]">
            <ChartRenderer
              chartType={chartType}
              data={data}
              xKey={spec?.dimension === 'date' ? 'date' : 'category'}
              yKey="value"
              height={180}
              currency={meta?.currency}
              formatType={formatType}
              colors={getChartColors(store)}
              xFormatter={spec?.dimension === 'date' ? formatDateLabel : undefined}
            />
          </div>
          {autoLabel && (
            <div className="mt-2 text-xs text-gray-400">{autoLabel}</div>
          )}
        </>
      )}
    </div>
  );
}
