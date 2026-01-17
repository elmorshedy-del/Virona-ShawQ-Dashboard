import React from 'react';
import { Search, ArrowRight, SlidersHorizontal } from 'lucide-react';

export default function ExploreQueryBar({
  query,
  onChange,
  onSubmit,
  isLoading,
  onOpenFilters
}) {
  return (
    <div className="h-16 border-t border-gray-100 bg-white px-6 py-3 flex items-center gap-3">
      <div className="flex-1 relative">
        <Search className="w-4.5 h-4.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
          placeholder="What do you want to see?"
          className="w-full h-10 bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <button
        onClick={onOpenFilters}
        className="lg:hidden flex items-center gap-2 bg-gray-100 text-gray-600 px-3 h-10 rounded-lg text-sm"
      >
        <SlidersHorizontal className="w-4 h-4" />
        Filters
      </button>
      <button
        onClick={onSubmit}
        disabled={isLoading || !query.trim()}
        className="w-10 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center justify-center disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <ArrowRight className="w-4.5 h-4.5" />
        )}
      </button>
    </div>
  );
}
