import { Fragment, useEffect, useState } from 'react';

const API_BASE = '/api';
const POLL_INTERVAL_MS = 15000;

export default function MetaDebug({ store }) {
  const [events, setEvents] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadEvents = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/meta/debug/events`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setEvents(Array.isArray(json?.events) ? json.events : []);
    } catch (err) {
      setError(err?.message || 'Failed to load debug events');
    } finally {
      setLoading(false);
    }
  };

  const clearEvents = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/meta/debug/events`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setEvents([]);
      setExpandedId(null);
    } catch (err) {
      setError(err?.message || 'Failed to clear events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    const timer = setInterval(loadEvents, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const filteredEvents = events.filter((event) => !store?.id || event.store === store.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Meta Debug</h2>
          <p className="text-sm text-gray-500">
            Recent Meta Graph API failures (in-memory buffer).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadEvents}
            className="px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Refresh
          </button>
          <button
            onClick={clearEvents}
            className="px-3 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg"
          >
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium">Endpoint</th>
                <th className="px-4 py-3 text-left font-medium">Graph Path</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Store</th>
                <th className="px-4 py-3 text-left font-medium">Ad Account</th>
              </tr>
            </thead>
            <tbody>
              {loading && filteredEvents.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-6 text-center text-gray-500">
                    Loading debug events...
                  </td>
                </tr>
              )}

              {!loading && filteredEvents.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-6 text-center text-gray-500">
                    No Meta debug events captured.
                  </td>
                </tr>
              )}

              {filteredEvents.map((event, index) => {
                const rowId = `${event.ts}-${index}`;
                const isExpanded = expandedId === rowId;

                return (
                  <Fragment key={rowId}>
                    <tr
                      className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : rowId)}
                    >
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {event.ts}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {event.localEndpoint}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-md truncate" title={event.graphPath}>
                        {event.graphPath}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {event.metaStatus ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {event.store || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {event.adAccountId || '—'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-gray-100 bg-gray-50">
                        <td colSpan="6" className="px-4 py-3">
                          <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                            {JSON.stringify(event.metaBody, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
