import { useEffect, useState } from 'react';

const DEFAULT_WINDOW_SECONDS = 180;
const DEFAULT_POLL_MS = 10000;

const buildEndpoint = (store, windowSeconds) => {
  const params = new URLSearchParams({
    store,
    windowSeconds: String(windowSeconds)
  });
  return `/api/pixels/shopify/live?${params.toString()}`;
};

const formatLabel = (count) => (count === 1 ? 'checkout now' : 'checkouts now');

export default function LiveCheckoutIndicator({
  store,
  windowSeconds = DEFAULT_WINDOW_SECONDS,
  pollMs = DEFAULT_POLL_MS
}) {
  const [count, setCount] = useState(null);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!store) return undefined;
    let active = true;

    const fetchLive = async (initial = false) => {
      if (initial) setStatus('loading');
      try {
        const res = await fetch(buildEndpoint(store, windowSeconds));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.success) throw new Error('Invalid response');
        if (!active) return;
        setCount(Number.isFinite(data.count) ? data.count : 0);
        setStatus('ok');
      } catch (error) {
        if (!active) return;
        console.error('Failed to fetch live checkout count:', error);
        setStatus('error');
      }
    };

    fetchLive(true);
    const timer = setInterval(() => fetchLive(false), pollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [store, windowSeconds, pollMs]);

  const hasCount = Number.isFinite(count);
  const displayCount = hasCount ? count : '--';
  const dotClass = hasCount && count > 0
    ? 'live-dot'
    : status === 'error'
      ? 'h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse'
      : 'h-2.5 w-2.5 rounded-full bg-gray-300';

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium text-gray-700"
      title={`Live checkouts (last ${Math.round(windowSeconds / 60)} min)`}
    >
      <span className={dotClass} />
      <span className="tabular-nums text-gray-900">{displayCount}</span>
      <span className="text-gray-500">{formatLabel(hasCount ? count : 0)}</span>
    </div>
  );
}
