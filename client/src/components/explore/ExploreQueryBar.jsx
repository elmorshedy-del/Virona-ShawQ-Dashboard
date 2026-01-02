export default function ExploreQueryBar() {
  return (
    <div className="border-b border-slate-200 px-6 py-4">
      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Ask the dashboard</label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          placeholder="Show me the latest server-side conversions for Virona..."
          type="text"
        />
        <button
          className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
          type="button"
        >
          Explore
        </button>
      </div>
    </div>
  );
}
