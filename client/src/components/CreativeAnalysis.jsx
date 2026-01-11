import { useEffect, useState } from 'react';
import CreativePreview from './CreativePreview.jsx';
import MetaDebug from './MetaDebug.jsx';

const ANALYSIS_TABS = [
  { id: 'creative-preview', label: 'Creative Preview' },
  { id: 'meta-debug', label: 'Meta Debug' }
];
const CREATIVE_ANALYSIS_TAB_KEY = 'creative-analysis.activeTab';

export default function CreativeAnalysis({ store }) {
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === 'undefined') return 'creative-preview';
    const storedTab = window.localStorage.getItem(CREATIVE_ANALYSIS_TAB_KEY);
    return ANALYSIS_TABS.some((tab) => tab.id === storedTab) ? storedTab : 'creative-preview';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(CREATIVE_ANALYSIS_TAB_KEY, activeTab);
  }, [activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-white p-1.5 rounded-xl shadow-sm w-fit">
        {ANALYSIS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'creative-preview' && <CreativePreview store={store} />}
      {activeTab === 'meta-debug' && <MetaDebug store={store} />}
    </div>
  );
}
