import React from 'react';
import { Pin, X } from 'lucide-react';
import ChartRenderer from './ChartRenderer';

const storeColors = {
  virona: ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#7C3AED', '#6D28D9'],
  shawq: ['#F97316', '#EA580C', '#DC2626', '#B91C1C', '#9A3412', '#7C2D12']
};

export default function VisualizationDock({
  status,
  payload,
  onClose,
  onPin,
  isPinned,
  store
}) {
  if (status === 'hidden') return null;

  const colors = store === 'shawq' ? storeColors.shawq : storeColors.virona;
  const spec = payload?.spec;
  const meta = payload?.meta;
  const data = payload?.data || [];
  const chartType = spec?.chartType || 'line';
  const formatType = spec?.metric === 'conversion_rate'
    ? 'percent'
    : ['revenue', 'spend', 'aov'].includes(spec?.metric)
      ? 'currency'
      : 'number';

  return (
    <div className={`dock-appear bg-white border border-gray-100 rounded-2xl shadow-sm p-4 mb-4 h-[280px] ${status === 'closing' ? 'dock-dismiss' : ''}`}>
      {status === 'loading' && (
        <div className="h-full flex flex-col">
          <div className="h-4 w-40 rounded-md skeleton" />
          <div className="h-3 w-56 rounded-md skeleton mt-2" />
          <div className="flex-1 mt-3 rounded-xl skeleton" />
          <div className="h-3 w-40 rounded-md skeleton mt-3" />
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Visualization error</h3>
            <p className="text-sm text-gray-500 mt-1">We could not render this chart.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {status === 'active' && spec && (
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-gray-900">{spec.title}</h3>
              {spec.note && <p className="text-sm text-gray-500 mt-1">{spec.note}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onPin} className={`text-gray-400 hover:text-blue-500 ${isPinned ? 'text-blue-500' : ''}`}>
                <Pin className="w-4 h-4" />
              </button>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="mt-3 h-[180px]">
            <ChartRenderer
              chartType={chartType}
              data={data}
              xKey={spec.dimension === 'date' ? 'date' : 'category'}
              yKey="value"
              height={180}
              currency={meta?.currency}
              formatType={formatType}
              colors={colors}
            />
          </div>
          {spec.autoReason && (
            <div className="text-xs text-gray-400 mt-2">
              Auto: {spec.chartType} ({spec.autoReason})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
