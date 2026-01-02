/**
 * Chart Skeleton Component
 * Loading skeleton with shimmer animation for charts
 */

import React from 'react';

export default function ChartSkeleton({ height = 240, title = '' }) {
  return (
    <div className="animate-pulse" style={{ height }}>
      {/* Title skeleton */}
      {title && (
        <div className="mb-4">
          <div className="h-5 bg-gray-200 rounded w-48 mb-2 skeleton-shimmer"></div>
          <div className="h-3 bg-gray-100 rounded w-32 skeleton-shimmer"></div>
        </div>
      )}

      {/* Chart skeleton */}
      <div className="flex items-end justify-between gap-2 h-[180px] px-4">
        {/* Y-axis labels */}
        <div className="flex flex-col justify-between h-full w-12 mr-2">
          <div className="h-3 bg-gray-100 rounded w-8 skeleton-shimmer"></div>
          <div className="h-3 bg-gray-100 rounded w-10 skeleton-shimmer"></div>
          <div className="h-3 bg-gray-100 rounded w-6 skeleton-shimmer"></div>
        </div>

        {/* Chart bars/lines */}
        <div className="flex-1 flex items-end justify-around gap-3">
          <div className="w-full bg-gray-200 rounded-t skeleton-shimmer" style={{ height: '60%' }}></div>
          <div className="w-full bg-gray-200 rounded-t skeleton-shimmer" style={{ height: '85%' }}></div>
          <div className="w-full bg-gray-200 rounded-t skeleton-shimmer" style={{ height: '45%' }}></div>
          <div className="w-full bg-gray-200 rounded-t skeleton-shimmer" style={{ height: '70%' }}></div>
          <div className="w-full bg-gray-200 rounded-t skeleton-shimmer" style={{ height: '55%' }}></div>
          <div className="w-full bg-gray-200 rounded-t skeleton-shimmer" style={{ height: '75%' }}></div>
          <div className="w-full bg-gray-200 rounded-t skeleton-shimmer" style={{ height: '40%' }}></div>
        </div>
      </div>

      {/* X-axis labels */}
      <div className="flex justify-around mt-3 px-16">
        <div className="h-3 bg-gray-100 rounded w-8 skeleton-shimmer"></div>
        <div className="h-3 bg-gray-100 rounded w-8 skeleton-shimmer"></div>
        <div className="h-3 bg-gray-100 rounded w-8 skeleton-shimmer"></div>
        <div className="h-3 bg-gray-100 rounded w-8 skeleton-shimmer"></div>
      </div>

      {/* Add shimmer animation styles */}
      <style>{`
        @keyframes shimmer {
          0% {
            background-position: -200% 0;
          }
          100% {
            background-position: 200% 0;
          }
        }

        .skeleton-shimmer {
          background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }
      `}</style>
    </div>
  );
}
