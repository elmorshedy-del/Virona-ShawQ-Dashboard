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
  up: { arrow: '▲', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  down: { arrow: '▼', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  flat: { arrow: '•', className: 'bg-slate-100 text-slate-600 border-slate-200' }
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

const formatSignalDeltaLabel = (value) => {
  const numeric = asFiniteNumber(value, 0);
  const abs = Math.abs(numeric);
  const precision = abs >= 10 ? 0 : 1;
  const signed = numeric > 0
    ? `+${abs.toFixed(precision)}`
    : numeric < 0
      ? `-${abs.toFixed(precision)}`
      : `${abs.toFixed(precision)}`;
  return `${signed}%`;
};

function SignalChip({ label, signal, deltaPct }) {
  const tone = getSignalTone(signal);
  const deltaLabel = formatSignalDeltaLabel(deltaPct);

  return (
    <span className={`inline-flex h-5 min-w-[54px] items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold ${tone.className}`}>
      {label} {tone.arrow} {deltaLabel}
    </span>
  );
}

function SignalPair({ signals = {} }) {
  const daySignal = signals?.day || 'flat';
  const weekSignal = signals?.week || 'flat';
  const dayDeltaPct = signals?.dayDeltaPct;
  const weekDeltaPct = signals?.weekDeltaPct;

  return (
    <div className="flex items-center gap-1">
      <SignalChip label="D-1" signal={daySignal} deltaPct={dayDeltaPct} />
      <SignalChip label="D-7" signal={weekSignal} deltaPct={weekDeltaPct} />
    </div>
  );
}

function CompactName({ value, className = '' }) {
  const text = String(value || '').trim() || 'Untitled';

  return (
    <span className={`group relative block max-w-[150px] ${className}`.trim()}>
      <span className="block truncate" title={text}>{text}</span>
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden max-w-[240px] rounded-md bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow-lg group-hover:block">
        {text}
      </span>
    </span>
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
  const hasQueryContext = Boolean(storeId && startDate && endDate);

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
    underperformingCountries: clipRows(pulseData?.underperformingCountries),
    topAds: clipRows(pulseData?.topAds),
    underperformingAds: clipRows(pulseData?.underperformingAds)
  }), [pulseData]);

  const countryOrdersSource = String(pulseData?.countryOrdersSource || '').trim();
  const countrySubtitle = useMemo(() => {
    if (storeId === 'shawq') {
      return 'Orders from Shopify + Meta spend';
    }
    if (!countryOrdersSource || countryOrdersSource === 'Unavailable') {
      return 'Orders + Meta spend';
    }
    if (countryOrdersSource === 'Meta') {
      return 'Orders from Meta conversions + Meta spend';
    }
    return `Orders from ${countryOrdersSource} + Meta spend`;
  }, [countryOrdersSource, storeId]);

  if (!hasQueryContext) {
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="rounded-[20px] border border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Daily Performance Pulse</div>
          <div className="text-[10px] text-slate-500">Signals vs day-before and 7-days-before</div>
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
            subtitle={countrySubtitle}
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
            title="Dragging Countries"
            subtitle="Lowest orders or zero-order spend draggers"
            rows={rows.underperformingCountries}
            emptyText="No underperforming countries found."
            renderRow={(country, index) => (
              <div key={country?.id || country?.code || `drag-country-${index}`} className="flex items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/40 px-2 py-2">
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
                    <div className="text-[11px] font-semibold text-rose-700">Risk {asFiniteNumber(country?.riskScore).toFixed(1)}</div>
                    <div className="text-[10px] text-slate-500">
                      ROAS {formatRoas(country?.roas)} · {formatCurrency(asFiniteNumber(country?.spend))}
                    </div>
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
              <div key={ad?.id || `top-ad-${index}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-2 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <EntityThumb thumbnailUrl={ad?.thumbnailUrl} fallback="A" />
                  <div className="min-w-0">
                    <CompactName value={ad?.name} className="text-[12px] font-semibold text-slate-900" />
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
            title="Dragging Ads"
            subtitle="Lowest orders or zero-order spend draggers"
            rows={rows.underperformingAds}
            emptyText="No underperforming ads found."
            renderRow={(ad, index) => (
              <div key={ad?.id || `drag-ad-${index}`} className="flex items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/40 px-2 py-2">
                <div className="min-w-0 flex items-center gap-2">
                  <EntityThumb thumbnailUrl={ad?.thumbnailUrl} fallback="A" />
                  <div className="min-w-0">
                    <CompactName value={ad?.name} className="text-[12px] font-semibold text-slate-900" />
                    <div className="text-[10px] text-slate-500">
                      {formatNumber(asFiniteNumber(ad?.orders))} orders
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="text-[11px] font-semibold text-rose-700">Risk {asFiniteNumber(ad?.riskScore).toFixed(1)}</div>
                    <div className="text-[10px] text-slate-500">
                      ROAS {formatRoas(ad?.roas)} · {formatCurrency(asFiniteNumber(ad?.spend))}
                    </div>
                  </div>
                  <SignalPair signals={ad?.signals} />
                </div>
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );
}
