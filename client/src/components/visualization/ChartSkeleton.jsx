import React from 'react';

export default function ChartSkeleton({ title = 'Loading chart...' }) {
  return (
    <div className="w-full h-full p-6 bg-white rounded-2xl">
      <div className="mb-4">
        <div className="h-5 w-40 rounded-md skeleton" />
        <div className="h-4 w-56 rounded-md skeleton mt-2" />
      </div>
      <div className="h-[300px] rounded-xl skeleton" />
      <div className="mt-4 h-3 w-52 rounded-md skeleton" aria-label={title} />
    </div>
  );
}
