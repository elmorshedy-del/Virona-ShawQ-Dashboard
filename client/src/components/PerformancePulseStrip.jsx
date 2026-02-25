import { useEffect, useMemo, useState } from 'react';

const PERFORMANCE_PULSE_VISIBLE_ROWS = 3;
const PERFORMANCE_PULSE_FALLBACK_DATA = {
  topCountries: [],
  underperformingCountries: [],
  topAds: [],
  underperformingAds: [],
  bestSellerProducts: [],
  watchlist: []
};

const SIGNAL_META = {
  up: { arrow: '↑', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  down: { arrow: '↓', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  flat: { arrow: '→', className: 'bg-slate-100 text-slate-600 border-slate-200' }
};

const asFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clipRows = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, PERFORMANCE_PULSE_VISIBLE_ROWS);
};

const buildPerformancePulseUrl = ({
  apiBase,
  storeId,
  startDate,
  endDate,
  selectedCampaignId,
  includeInactive
}) => {
  const params = new URLSearchParams({
    store: storeId,
    startDate,
    endDate
  });

  if (selectedCampaignId) {
    params.set('campaignId', selectedCampaignId);
  }

  if (includeInactive) {
    params.set('includeInactive', 'true');
  }

  return `${apiBase}/analytics/performance-pulse?${params.toString()}`;
};

const formatRoas = (value) => {
  const roas = asFiniteNumber(value, NaN);
  return Number.isFinite(roas) ? `${roas.toFixed(2)}x` : '—';
};

const getSignalTone = (signal) => {
  if (signal === 'up') return SIGNAL_META.up;
  if (signal === 'down') return SIGNAL_META.down;
  return SIGNAL_META.flat;
};

function SignalPair({ signals = {} }) {
  const dayTone = getSignalTone(signals?.day);
  const weekTone = getSignalTone(signals?.week);

  return (
    <div className="flex items-center gap-1">
      <span className={`inline-flex h-5 min-w-[30px] items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold ${dayTone.className}`}>
        D {dayTone.arrow}
      </span>
      <span className={`inline-flex h-5 min-w-[30px] items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold ${weekTone.className}`}>
        W {weekTone.arrow}
      </span>
    </div>
  );
}

function EntityThumb({ thumbnailUrl, fallback, className = '' }) {
  if (thumbnailUrl) {
    return (
      <img
        src={thumbnailUrl}
        alt=""
        className={`h-8 w-8 rounded-lg object-cover shadow-sm ring-1 ring-slate-200 ${className}`.trim()}
        loading="lazy"
      />
    );
  }

  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 ${className}`.trim()}>
      {fallback}
    </span>
  );
}

function PulseCard({ title, subtitle, rows, emptyText, renderRow }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between border-b border-slate-100 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{title}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>
        </div>
      </div>
      <div className="space-y-1 p-2">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-3 text-center text-[11px] text-slate-500">
            {emptyText}
          </div>
        ) : (
          rows.map((row, index) => renderRow(row, index))
        )}
      </div>
    </div>
  );
}

export default function PerformancePulseStrip({
  apiBase = '/api',
  storeId = '',
  dateRange = {},
  selectedCampaignId = '',
  includeInactive = false,
  formatCurrency = (value) => `$${asFiniteNumber(value).toFixed(2)}`,
  formatNumber = (value) => `${Math.round(asFiniteNumber(value))}`
}) {
  const [pulseData, setPulseData] = useState(PERFORMANCE_PULSE_FALLBACK_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const startDate = dateRange?.startDate || '';
  const endDate = dateRange?.endDate || '';

  useEffect(() => {
    if (!storeId || !startDate || !endDate) {
      setPulseData(PERFORMANCE_PULSE_FALLBACK_DATA);
      return;
    }

    let cancelled = false;
    const url = buildPerformancePulseUrl({
      apiBase,
      storeId,
      startDate,
      endDate,
      selectedCampaignId,
      includeInactive
    });

    const loadPulse = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) return;
        if (payload?.success && payload?.data) {
          setPulseData({
            ...PERFORMANCE_PULSE_FALLBACK_DATA,
            ...payload.data
          });
        } else {
          setPulseData(PERFORMANCE_PULSE_FALLBACK_DATA);
        }
      } catch (fetchError) {
        if (cancelled) return;
        setPulseData(PERFORMANCE_PULSE_FALLBACK_DATA);
        setError(fetchError?.message || 'Failed to load pulse data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPulse();

    return () => {
      cancelled = true;
    };
  }, [apiBase, storeId, startDate, endDate, selectedCampaignId, includeInactive]);

  const rows = useMemo(() => ({
    topCountries: clipRows(pulseData?.topCountries),
    topAds: clipRows(pulseData?.topAds),
    bestSellerProducts: clipRows(pulseData?.bestSellerProducts),
    watchlist: clipRows(pulseData?.watchlist)
  }), [pulseData]);

  const showEmptyState = !loading
    && rows.topCountries.length === 0
    && rows.topAds.length === 0
    && rows.bestSellerProducts.length === 0
    && rows.watchlist.length === 0;

  if (showEmptyState) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="rounded-[20px] border border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Daily Performance Pulse</div>
          <div className="text-[10px] text-slate-500">Signals vs day-before and week-before</div>
        </div>

        {loading && (
          <div className="mb-2 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
            Loading pulse cards...
          </div>
        )}

        {error && (
          <div className="mb-2 rounded-lg bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            Pulse unavailable: {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
          <PulseCard
            title="Top Countries"
            subtitle="Orders from Shopify/Salla + Meta spend"
            rows={rows.topCountries}
            emptyText="No country activity yet."
            renderRow={(country, index) => (
              <div key={country?.id || country?.code || `country-${index}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-2 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-lg leading-none">{country?.flag || '🏳️'}</span>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-slate-900" title={country?.name || country?.code}>
                      {country?.name || country?.code || 'Unknown'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {formatNumber(asFiniteNumber(country?.orders))} orders
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="text-[11px] font-semibold text-slate-900">ROAS {formatRoas(country?.roas)}</div>
                    <div className="text-[10px] text-slate-500">{formatCurrency(asFiniteNumber(country?.spend))}</div>
                  </div>
                  <SignalPair signals={country?.signals} />
                </div>
              </div>
            )}
          />

          <PulseCard
            title="Top Ads"
            subtitle="Best current ad momentum"
            rows={rows.topAds}
            emptyText="No ad activity yet."
            renderRow={(ad, index) => (
              <div key={ad?.id || `ad-${index}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-2 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <EntityThumb thumbnailUrl={ad?.thumbnailUrl} fallback="A" />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-slate-900" title={ad?.name}>
                      {ad?.name || 'Untitled ad'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {formatNumber(asFiniteNumber(ad?.orders))} orders
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="text-[11px] font-semibold text-slate-900">ROAS {formatRoas(ad?.roas)}</div>
                    <div className="text-[10px] text-slate-500">{formatCurrency(asFiniteNumber(ad?.spend))}</div>
                  </div>
                  <SignalPair signals={ad?.signals} />
                </div>
              </div>
            )}
          />

          <PulseCard
            title="Best Seller"
            subtitle="Top product in selected range"
            rows={rows.bestSellerProducts}
            emptyText="No product order items found."
            renderRow={(product, index) => (
              <div key={product?.id || `product-${index}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-2 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <EntityThumb thumbnailUrl={product?.thumbnailUrl} fallback="P" />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-slate-900" title={product?.name}>
                      {product?.name || 'Untitled product'}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {formatNumber(asFiniteNumber(product?.orders))} orders
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="text-[11px] font-semibold text-slate-900">{formatCurrency(asFiniteNumber(product?.revenue))}</div>
                    <div className="text-[10px] text-slate-500">Revenue</div>
                  </div>
                  <SignalPair signals={product?.signals} />
                </div>
              </div>
            )}
          />

          <PulseCard
            title="Watchlist"
            subtitle="Lowest orders or zero-order spend draggers"
            rows={rows.watchlist}
            emptyText="No underperforming entities found."
            renderRow={(entry, index) => {
              const fallback = entry?.entityType === 'country' ? '🌍' : 'A';
              const prefix = entry?.entityType === 'country'
                ? (entry?.flag || '🌍')
                : <EntityThumb thumbnailUrl={entry?.thumbnailUrl} fallback={fallback} />;

              return (
                <div key={`${entry?.entityType || 'entity'}-${entry?.id || index}`} className="flex items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/40 px-2 py-2">
                  <div className="min-w-0 flex items-center gap-2">
                    {typeof prefix === 'string' ? (
                      <span className="text-lg leading-none">{prefix}</span>
                    ) : (
                      prefix
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-slate-900" title={entry?.name}>
                        {entry?.name || 'Unknown'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {formatNumber(asFiniteNumber(entry?.orders))} orders · {formatCurrency(asFiniteNumber(entry?.spend))}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <div className="text-[11px] font-semibold text-rose-700">Risk {asFiniteNumber(entry?.riskScore).toFixed(1)}</div>
                      <div className="text-[10px] text-slate-500">ROAS {formatRoas(entry?.roas)}</div>
                    </div>
                    <SignalPair signals={entry?.signals} />
                  </div>
                </div>
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}
