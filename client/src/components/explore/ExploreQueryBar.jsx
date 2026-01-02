import React from 'react';
import { Search, ArrowRight, SlidersHorizontal } from 'lucide-react';

export default function ExploreQueryBar({
  query,
  onQueryChange,
  onSubmit,
  onToggleFilters,
  showFiltersButton,
  isLoading
}) {
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="h-16 bg-white border-t border-gray-100 px-6 flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to see?"
          className="w-full h-10 bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      {showFiltersButton && (
        <button
          onClick={onToggleFilters}
          className="lg:hidden flex items-center gap-2 h-10 px-3 rounded-lg bg-gray-100 text-gray-600 text-sm"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
        </button>
      )}
      <button
        onClick={onSubmit}
        disabled={!query.trim() || isLoading}
        className="h-10 w-10 rounded-lg bg-blue-500 hover:bg-blue-600 text-white flex items-center justify-center disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
