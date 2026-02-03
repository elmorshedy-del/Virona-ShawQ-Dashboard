import { useMemo, useState } from 'react';
import CreativePreview from './CreativePreview.jsx';
import MetaDebug from './MetaDebug.jsx';

export default function CreativeAnalysis({ store }) {
  const storeId = typeof store === 'string' ? store : store?.id;

  const storageKey = useMemo(() => (
    storeId ? `creative-analysis:previewOpen:${storeId}` : null
  ), [storeId]);

  const [previewOpen, setPreviewOpen] = useState(() => {
    if (!storageKey) return true;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === '0') return false;
      if (saved === '1') return true;
    } catch (err) {
      console.error("Failed to read 'previewOpen' state from localStorage.", err);
    }
    return true;
  });

  const togglePreview = () => {
    setPreviewOpen((prev) => {
      const next = !prev;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, next ? '1' : '0');
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  return (
    <div className="px-6 pb-10 space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          onClick={togglePreview}
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <span>Creative Preview</span>
          <span className="text-xs text-gray-500">{previewOpen ? 'Collapse' : 'Expand'}</span>
        </button>
        {previewOpen && (
          <div className="border-t border-gray-200 p-5">
            <CreativePreview store={store} />
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <div className="text-sm font-semibold text-gray-800">Meta Debug</div>
          <div className="text-xs text-gray-500 mt-1">Recent Meta Graph API failures (in-memory buffer).</div>
        </div>
        <div className="p-5">
          <MetaDebug store={typeof store === 'string' ? { id: store } : store} />
        </div>
      </div>
    </div>
  );
}

