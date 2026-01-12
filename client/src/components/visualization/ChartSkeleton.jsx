import React from 'react';

export default function ChartSkeleton({ title = 'Loading chart' }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm font-medium text-gray-900">{title}</div>
        <div className="h-4 w-40 rounded-full skeleton" />
      </div>
      <div className="h-48 rounded-2xl skeleton" />
    </div>
  );
}
