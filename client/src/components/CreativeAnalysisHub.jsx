import { useMemo, useState } from 'react';
import CreativeAnalysis from './CreativeAnalysis.jsx';
import CreativeIntelligence from './CreativeIntelligence.jsx';
import CreativeIntelligenceOpsHub from './CreativeIntelligenceOpsHub.jsx';

const HUB_TABS = [
  { id: 'intelligence', label: 'Creative Intelligence' },
  { id: 'ops', label: 'Creative Intelligence Ops' },
];

function deriveStoreId(store) {
  if (typeof store === 'string') return store;
  return store?.id || 'shawq';
}

export default function CreativeAnalysisHub({ store, currentStore }) {
  const storeId = deriveStoreId(currentStore || store);
  const storageKey = useMemo(() => `creative-analysis:hub-tab:${storeId}`, [storeId]);
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return HUB_TABS.some((tab) => tab.id === saved) ? saved : 'intelligence';
    } catch {
      return 'intelligence';
    }
  });

  const handleSetTab = (tabId) => {
    setActiveTab(tabId);
    try {
      localStorage.setItem(storageKey, tabId);
    } catch {
      // no-op
    }
  };

  return (
    <div className="px-6 pb-10 space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="text-sm font-semibold text-gray-800">Creative Surfaces</div>
          <div className="text-xs text-gray-500 mt-1">Use the same tab to switch between analysis and operations.</div>
        </div>
        <div className="p-5">
          <div className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1">
            {HUB_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSetTab(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {activeTab === 'intelligence' ? (
        <>
          <CreativeIntelligence store={storeId} />
          <CreativeAnalysis store={store} />
        </>
      ) : null}

      {activeTab === 'ops' ? (
        <CreativeIntelligenceOpsHub store={store} currentStore={storeId} />
      ) : null}
    </div>
  );
}
