import { useEffect, useState } from 'react';
import CreativePreview from './CreativePreview.jsx';
import MetaDebug from './MetaDebug.jsx';

const ANALYSIS_TABS = [
  { id: 'creative-preview', label: 'Creative Preview' },
  { id: 'meta-debug', label: 'Meta Debug' }
];

export default function CreativeAnalysis({ store }) {
  const storageKey = `creative-analysis-tab:${store?.id || 'default'}`;
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (ANALYSIS_TABS.some((tab) => tab.id === saved)) {
        return saved;
      }
    } catch (error) {
      console.error('Error reading localStorage:', error);
    }
    return 'creative-preview';
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (ANALYSIS_TABS.some((tab) => tab.id === saved)) {
        setActiveTab(saved);
        return;
      }
    } catch (error) {
      console.error('Error reading localStorage:', error);
    }
    setActiveTab('creative-preview');
  }, [storageKey]);

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    try {
      localStorage.setItem(storageKey, tabId);
    } catch (error) {
      console.error('Error writing localStorage:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-white p-1.5 rounded-xl shadow-sm w-fit">
        {ANALYSIS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
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
