/**
 * Explore Query Bar Component
 * Bottom query input for Explore mode
 */

import React, { useState } from 'react';
import { Search, ArrowRight, SlidersHorizontal } from 'lucide-react';

export default function ExploreQueryBar({
  onSubmit,
  isLoading = false,
  onOpenFilters,
  showFiltersButton = false
}) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim() && !isLoading) {
      onSubmit(query.trim());
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="h-16 bg-white border-t border-gray-100 px-6 flex items-center gap-3">
      <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What do you want to see?"
            disabled={isLoading}
            className="w-full h-10 pl-11 pr-4 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition-all"
          />
        </div>

        {/* Mobile Filters Button */}
        {showFiltersButton && (
          <button
            type="button"
            onClick={onOpenFilters}
            className="lg:hidden px-3 h-10 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-gray-200 transition-colors"
          >
            <SlidersHorizontal size={16} />
            Filters
          </button>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!query.trim() || isLoading}
          className="w-10 h-10 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:cursor-not-allowed rounded-[10px] flex items-center justify-center transition-colors"
        >
          {isLoading ? (
            <div className="w-[18px] h-[18px] border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <ArrowRight className="w-[18px] h-[18px] text-white" />
          )}
        </button>
      </form>
    </div>
  );
}
