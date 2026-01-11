import { useState } from 'react';
import CreativePreview from './CreativePreview.jsx';
import MetaDebug from './MetaDebug.jsx';

export default function CreativeAnalysis({ store }) {
  const [previewOpen, setPreviewOpen] = useState(true);

  return (
    <div className="space-y-6">
      <MetaDebug store={store} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setPreviewOpen((prev) => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span>Creative Preview</span>
          <span className="text-xs text-gray-500">{previewOpen ? '▼' : '▶'}</span>
        </button>
        {previewOpen && (
          <div className="p-4 border-t border-gray-200">
            <CreativePreview store={store} />
          </div>
        )}
      </div>
    </div>
  );
}
