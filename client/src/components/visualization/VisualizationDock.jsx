import React from 'react';
import { Pin, X } from 'lucide-react';
import ChartRenderer from './ChartRenderer';
import ChartSkeleton from './ChartSkeleton';

export default function VisualizationDock({
  status,
  payload,
  pinned,
  onClose,
  onTogglePin,
  chartColors
}) {
  if (status === 'hidden') return null;

  const isLoading = status === 'loading';
  const isError = status === 'error';

  return (
    <div className="dock-appear border border-gray-100 rounded-2xl shadow-sm bg-white p-4 mb-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {payload?.spec?.title || 'Visualization'}
          </h3>
          {!isLoading && !isError && payload?.spec?.note && (
            <p className="text-sm text-gray-500 mt-1 mb-3">{payload.spec.note}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePin}
            className={`p-1 rounded-lg transition-colors ${
              pinned ? 'text-blue-500' : 'text-gray-400 hover:text-blue-500'
            }`}
            aria-label={pinned ? 'Unpin chart' : 'Pin chart'}
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close chart"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading && <ChartSkeleton height={180} />}

      {isError && (
        <div className="flex items-center justify-center h-[180px] bg-gray-50 rounded-xl text-sm text-gray-500">
          {payload?.error || 'We could not render this chart.'}
        </div>
      )}

      {!isLoading && !isError && payload?.spec && (
        <div>
          <div className="h-[180px]">
            <ChartRenderer
              chartType={payload.spec.chartType}
              data={payload.data}
              xKey={payload.spec.dimension === 'date' ? 'date' : 'category'}
              yKey="value"
              height={180}
              currency={payload.meta?.currency}
              formatType={payload.meta?.formatType}
              animate
              colors={chartColors}
            />
          </div>
          {payload.spec.autoReason && (
            <p className="text-xs text-gray-400 mt-2">
              Auto: {payload.spec.chartType} chart ({payload.spec.autoReason})
            </p>
          )}
        </div>
      )}
    </div>
  );
}
