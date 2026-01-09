import React from 'react';

export default function ChartSkeleton({ title = 'Loading', height = 180 }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="h-5 w-40 rounded-lg skeleton" />
        <div className="mt-2 h-3 w-28 rounded-lg skeleton" />
      </div>
      <div className="rounded-2xl bg-gray-50 p-6">
        <div className="w-full rounded-xl skeleton" style={{ height }} />
      </div>
    </div>
  );
}
