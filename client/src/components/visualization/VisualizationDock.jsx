/**
 * Visualization Dock Component
 * Pinned chart dock that appears above chat messages
 */

import React, { useState, useEffect } from 'react';
import { X, Pin, PinOff, Download } from 'lucide-react';
import ChartRenderer from './ChartRenderer';
import ChartSkeleton from './ChartSkeleton';
import { exportToCsv, getBrandColors, METRIC_INFO } from '../shared/chartUtils';

export default function VisualizationDock({
  chartData,
  isLoading = false,
  onClose,
  onPin,
  isPinned = false,
  store = 'vironax'
}) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  const brandColors = getBrandColors(store);
  const currency = store === 'shawq' ? 'USD' : 'SAR';

  // Derive visibility from having chartData or loading state
  const visible = Boolean(chartData) || isLoading;

  // Handle visibility animations
  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        setIsAnimating(true);
      });
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!shouldRender) return null;

  const { spec, data, meta } = chartData || {};

  const getFormatType = (metric) => {
    const info = METRIC_INFO[metric];
    return info?.format || 'number';
  };

  const getXKey = (dimension) => {
    return dimension === 'date' ? 'date' : 'category';
  };

  const handleExport = () => {
    if (data && data.length > 0) {
      const filename = `${spec?.title?.replace(/\s+/g, '-').toLowerCase() || 'chart-data'}-${new Date().toISOString().split('T')[0]}.csv`;
      exportToCsv(data, filename);
    }
  };

  return (
    <div
      className={`dock-container mb-4 overflow-hidden transition-all duration-300 ease-out ${
        isAnimating ? 'opacity-100 max-h-[300px]' : 'opacity-0 max-h-0'
      }`}
    >
      <div
        className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4"
        style={{ borderLeft: `3px solid ${brandColors.primary}` }}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-48 mb-1"></div>
                <div className="h-3 bg-gray-100 rounded w-64"></div>
              </div>
            ) : (
              <>
                <h3 className="text-base font-semibold text-gray-900 truncate">
                  {spec?.title || 'Chart'}
                </h3>
                {spec?.note && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{spec.note}</p>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-1 ml-3">
            {!isLoading && data?.length > 0 && (
              <button
                onClick={handleExport}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Export CSV"
              >
                <Download size={16} />
              </button>
            )}
            <button
              onClick={onPin}
              className={`p-1.5 rounded-lg transition-colors ${
                isPinned
                  ? 'text-blue-500 hover:text-blue-600 hover:bg-blue-50'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              }`}
              title={isPinned ? 'Unpin chart' : 'Pin chart'}
            >
              {isPinned ? <Pin size={16} /> : <PinOff size={16} />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="mt-3">
          {isLoading ? (
            <ChartSkeleton height={180} />
          ) : data && data.length > 0 ? (
            <div className="chart-appear">
              <ChartRenderer
                chartType={spec?.chartType || 'bar'}
                data={data}
                xKey={getXKey(spec?.dimension)}
                yKey="value"
                metrics={spec?.isComparison ? (meta?.metrics || spec?.metrics) : null}
                height={180}
                currency={currency}
                formatType={getFormatType(spec?.metric)}
                animate={true}
                store={store}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-gray-400">
              <div className="text-center">
                <span className="text-3xl block mb-2">📊</span>
                <span className="text-sm">No data available</span>
              </div>
            </div>
          )}
        </div>

        {!isLoading && spec?.autoReason && (
          <div className="mt-2 text-xs text-gray-400">
            Auto: {spec.chartType} chart ({spec.autoReason})
          </div>
        )}

        {!isLoading && meta && (
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
            {meta.total !== undefined && (
              <span>Total: {meta.currency === 'SAR' ? 'SAR ' : '$'}{meta.total.toLocaleString()}</span>
            )}
            {meta.periodStart && meta.periodEnd && (
              <span>
                {new Date(meta.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' - '}
                {new Date(meta.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes chartAppear {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .chart-appear { animation: chartAppear 300ms ease-out forwards; }
      `}</style>
    </div>
  );
}
