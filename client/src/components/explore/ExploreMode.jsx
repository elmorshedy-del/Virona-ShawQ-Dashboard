import { LineChart } from 'lucide-react';
import ExploreQueryBar from './ExploreQueryBar';
import ExploreSidebar from './ExploreSidebar';

export default function ExploreMode() {
  return (
    <div className="flex h-full min-h-[480px] w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <ExploreSidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-slate-200 px-6 py-4">
          <span className="rounded-full bg-indigo-50 p-2 text-indigo-500">
            <LineChart className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Explore</p>
            <h2 className="text-lg font-semibold text-slate-900">Visualization Dock</h2>
          </div>
        </header>
        <ExploreQueryBar />
        <div className="flex-1 px-6 pb-6">
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
            Start exploring to populate the dock with server-side charts.
          </div>
        </div>
      </div>
    </div>
  );
}
