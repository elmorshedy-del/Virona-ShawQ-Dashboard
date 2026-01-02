import React from 'react';

export default function ChartSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-48 rounded-full skeleton" />
      <div className="h-4 w-64 rounded-full skeleton" />
      <div className="h-64 rounded-2xl skeleton" />
    </div>
  );
}
