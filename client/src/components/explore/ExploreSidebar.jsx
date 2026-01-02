const navItems = [
  { label: 'Overview', description: 'Quick health check' },
  { label: 'Funnels', description: 'Conversion flow' },
  { label: 'Cohorts', description: 'Retention insights' },
  { label: 'Experiments', description: 'A/B findings' }
];

export default function ExploreSidebar() {
  return (
    <aside className="hidden w-64 flex-col gap-6 border-r border-slate-200 bg-slate-50 p-6 md:flex">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Explore Mode</p>
        <h3 className="mt-2 text-lg font-semibold text-slate-900">Focus Areas</h3>
      </div>
      <nav className="flex flex-col gap-4">
        {navItems.map(item => (
          <button
            key={item.label}
            type="button"
            className="rounded-xl border border-transparent bg-white px-4 py-3 text-left shadow-sm transition hover:border-indigo-200 hover:shadow"
          >
            <p className="text-sm font-semibold text-slate-900">{item.label}</p>
            <p className="text-xs text-slate-500">{item.description}</p>
          </button>
        ))}
      </nav>
    </aside>
  );
}
