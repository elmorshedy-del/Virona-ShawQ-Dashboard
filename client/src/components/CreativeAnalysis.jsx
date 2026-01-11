import { useState } from 'react';
import CreativePreview from './CreativePreview.jsx';
import MetaDebug from './MetaDebug.jsx';

export default function CreativeAnalysis({ store }) {
  const [previewOpen, setPreviewOpen] = useState(true);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Meta Debug</h3>
            <p className="text-xs text-gray-500">Diagnostics for Meta data and responses.</p>
          </div>
        </div>
        <div className="p-4">
          <MetaDebug store={store} />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <button
          type="button"
          onClick={() => setPreviewOpen((prev) => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700"
        >
          <span>Creative Preview</span>
          <span className="text-xs text-gray-500">{previewOpen ? '▼' : '▶'}</span>
        </button>
        {previewOpen && (
          <div className="p-4 pt-0">
            <CreativePreview store={store} />
          </div>
        )}
      </div>
    </div>
  );
}
