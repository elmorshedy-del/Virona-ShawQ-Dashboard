import React from 'react';
import { ArrowRight, Search, SlidersHorizontal } from 'lucide-react';

export default function ExploreQueryBar({
  query,
  onChange,
  onSubmit,
  disabled,
  onOpenFilters,
  showFiltersButton
}) {
  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="h-16 border-t border-gray-100 bg-white px-6 py-3 flex items-center gap-3">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to see?"
          className="w-full h-10 pl-9 pr-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={disabled}
        />
      </div>
      {showFiltersButton && (
        <button
          onClick={onOpenFilters}
          className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm lg:hidden"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
        </button>
      )}
      <button
        onClick={onSubmit}
        disabled={disabled || !query.trim()}
        className="w-10 h-10 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
