import { useEffect, useMemo, useState } from 'react';

const PERFORMANCE_PULSE_VISIBLE_ROWS = 2;
const PERFORMANCE_PULSE_SIGNAL_DELTA_CAP = 999;

const PERFORMANCE_PULSE_FALLBACK_DATA = {
  topCountries: [],
  underperformingCountries: [],
  topAds: [],
  underperformingAds: [],
  bestSellerProducts: [],
  watchlist: []
};

const PERFORMANCE_PULSE_LAYOUT = {
  shell: 'rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white px-2 py-2 shadow-[0_12px_28px_rgba(15,23,42,0.08)]',
  shellTitle: 'text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500',
  shellSubtitle: 'text-[9px] text-slate-500',
  card: 'rounded-xl border border-slate-200 bg-white shadow-[0_6px_20px_rgba(15,23,42,0.08)]',
  cardHeader: 'flex items-start justify-between border-b border-slate-100 px-2 py-1.5',
  cardTitle: 'text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500',
  cardSubtitle: 'mt-0.5 text-[9px] text-slate-500',
  cardBody: 'space-y-1 p-1.5',
  empty: 'rounded-md border border-dashed border-slate-200 bg-slate-50 px-2 py-2 text-center text-[9px] text-slate-500',
  row: 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg border px-1.5 py-1.5',
  rowDefault: 'border-slate-100 bg-white',
  rowDanger: 'border-rose-100 bg-rose-50/40',
  entity: 'min-w-0 flex items-center gap-1.5',
  flag: 'text-sm leading-none',
  entityName: 'truncate text-[10px] font-semibold text-slate-900',
  entityMeta: 'text-[9px] text-slate-500',
  metricCol: 'flex shrink-0 flex-col items-end gap-0.5',
  metricPrimary: 'whitespace-nowrap text-[10px] font-semibold text-slate-900',
  metricPrimaryDanger: 'whitespace-nowrap text-[10px] font-semibold text-rose-700',
  metricSecondary: 'whitespace-nowrap text-[9px] text-slate-500'
};

const SIGNAL_META = {
  up: { arrow: '▲', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  down: { arrow: '▼', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  flat: { arrow: '•', className: 'bg-slate-100 text-slate-600 border-slate-200' }
};

const SIGNAL_LABELS = {
  day: '1D',
  week: '7D'
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
  const abs = Math.min(Math.abs(numeric), PERFORMANCE_PULSE_SIGNAL_DELTA_CAP);
  const precision = abs >= 10 ? 0 : 1;
  const fixed = abs.toFixed(precision);
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${sign}${fixed}%`;
};

function SignalChip({ label, signal, deltaPct }) {
  const tone = getSignalTone(signal);
  const deltaLabel = formatSignalDeltaLabel(deltaPct);

  return (
    <span className={`inline-flex h-4 items-center justify-center rounded border px-1 text-[8px] font-semibold leading-none ${tone.className}`}>
      {label}{tone.arrow}{deltaLabel}
    </span>
  );
}

function SignalPair({ signals = {}, className = '' }) {
  const daySignal = signals?.day || 'flat';
  const weekSignal = signals?.week || 'flat';
  const dayDeltaPct = signals?.dayDeltaPct;
  const weekDeltaPct = signals?.weekDeltaPct;

  return (
    <div className={`flex items-center gap-0.5 whitespace-nowrap ${className}`.trim()}>
      <SignalChip label={SIGNAL_LABELS.day} signal={daySignal} deltaPct={dayDeltaPct} />
      <SignalChip label={SIGNAL_LABELS.week} signal={weekSignal} deltaPct={weekDeltaPct} />
    </div>
  );
}

function CompactName({ value, className = '' }) {
  const text = String(value || '').trim() || 'Untitled';

  return (
    <span className={`group relative block max-w-[96px] ${className}`.trim()}>
      <span className="block truncate">{text}</span>
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
        className={`h-7 w-7 rounded-md object-cover shadow-sm ring-1 ring-slate-200 ${className}`.trim()}
        loading="lazy"
      />
    );
  }

  return (
    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 ${className}`.trim()}>
      {fallback}
    </span>
  );
}

function PulseCard({ title, subtitle, rows, emptyText, renderRow }) {
  return (
    <div className={PERFORMANCE_PULSE_LAYOUT.card}>
      <div className={PERFORMANCE_PULSE_LAYOUT.cardHeader}>
        <div className="min-w-0">
          <div className={PERFORMANCE_PULSE_LAYOUT.cardTitle}>{title}</div>
          <div className={PERFORMANCE_PULSE_LAYOUT.cardSubtitle}>{subtitle}</div>
        </div>
      </div>
      <div className={PERFORMANCE_PULSE_LAYOUT.cardBody}>
        {rows.length === 0 ? (
          <div className={PERFORMANCE_PULSE_LAYOUT.empty}>
            {emptyText}
          </div>
        ) : (
          rows.map((row, index) => renderRow(row, index))
        )}
      </div>
    </div>
  );
}

function PulseMetricColumn({ primary, secondary, tertiary, signals, danger = false }) {
  return (
    <div className={PERFORMANCE_PULSE_LAYOUT.metricCol}>
      <div className="text-right">
        <div className={danger ? PERFORMANCE_PULSE_LAYOUT.metricPrimaryDanger : PERFORMANCE_PULSE_LAYOUT.metricPrimary}>{primary}</div>
        {secondary ? <div className={PERFORMANCE_PULSE_LAYOUT.metricSecondary}>{secondary}</div> : null}
        {tertiary ? <div className={PERFORMANCE_PULSE_LAYOUT.metricSecondary}>{tertiary}</div> : null}
      </div>
      <SignalPair signals={signals} />
    </div>
  );
}

function PulseRow({ danger = false, children }) {
  return (
    <div className={`${PERFORMANCE_PULSE_LAYOUT.row} ${danger ? PERFORMANCE_PULSE_LAYOUT.rowDanger : PERFORMANCE_PULSE_LAYOUT.rowDefault}`}>
      {children}
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
    underperformingAds: clipRows(pulseData?.underperformingAds),
    bestSellerProducts: clipRows(pulseData?.bestSellerProducts)
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
      <div className={PERFORMANCE_PULSE_LAYOUT.shell}>
        <div className="mb-1.5 flex items-center justify-between">
          <div className={PERFORMANCE_PULSE_LAYOUT.shellTitle}>Daily Performance Pulse</div>
          <div className={PERFORMANCE_PULSE_LAYOUT.shellSubtitle}>Signals vs day-before and 7-days-before</div>
        </div>

        {loading && (
          <div className="mb-1 rounded-lg bg-slate-100 px-2 py-1 text-[9px] text-slate-500">
            Loading pulse cards...
          </div>
        )}

        {error && (
          <div className="mb-1 rounded-lg bg-rose-50 px-2 py-1 text-[9px] text-rose-700">
            Pulse unavailable: {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 xl:grid-cols-5">
          <PulseCard
            title="Top Countries"
            subtitle={countrySubtitle}
            rows={rows.topCountries}
            emptyText="No country activity yet."
            renderRow={(country, index) => {
              const name = country?.name || country?.code || 'Unknown';
              return (
                <PulseRow key={country?.id || country?.code || `country-${index}`}>
                  <div className={PERFORMANCE_PULSE_LAYOUT.entity}>
                    <span className={PERFORMANCE_PULSE_LAYOUT.flag}>{country?.flag || '🏳️'}</span>
                    <div className="min-w-0">
                      <div className={PERFORMANCE_PULSE_LAYOUT.entityName} title={name}>{name}</div>
                      <div className={PERFORMANCE_PULSE_LAYOUT.entityMeta}>{formatNumber(asFiniteNumber(country?.orders))} orders</div>
                    </div>
                  </div>
                  <PulseMetricColumn
                    primary={`ROAS ${formatRoas(country?.roas)}`}
                    secondary={formatCurrency(asFiniteNumber(country?.spend))}
                    signals={country?.signals}
                  />
                </PulseRow>
              );
            }}
          />

          <PulseCard
            title="Dragging Countries"
            subtitle="Lowest orders or zero-order spend draggers"
            rows={rows.underperformingCountries}
            emptyText="No underperforming countries found."
            renderRow={(country, index) => {
              const name = country?.name || country?.code || 'Unknown';
              return (
                <PulseRow key={country?.id || country?.code || `drag-country-${index}`} danger>
                  <div className={PERFORMANCE_PULSE_LAYOUT.entity}>
                    <span className={PERFORMANCE_PULSE_LAYOUT.flag}>{country?.flag || '🏳️'}</span>
                    <div className="min-w-0">
                      <div className={PERFORMANCE_PULSE_LAYOUT.entityName} title={name}>{name}</div>
                      <div className={PERFORMANCE_PULSE_LAYOUT.entityMeta}>{formatNumber(asFiniteNumber(country?.orders))} orders</div>
                    </div>
                  </div>
                  <PulseMetricColumn
                    danger
                    primary={`Risk ${asFiniteNumber(country?.riskScore).toFixed(1)}`}
                    secondary={`ROAS ${formatRoas(country?.roas)}`}
                    tertiary={formatCurrency(asFiniteNumber(country?.spend))}
                    signals={country?.signals}
                  />
                </PulseRow>
              );
            }}
          />

          <PulseCard
            title="Top Ads"
            subtitle="Best current ad momentum"
            rows={rows.topAds}
            emptyText="No ad activity yet."
            renderRow={(ad, index) => (
              <PulseRow key={ad?.id || `top-ad-${index}`}>
                <div className={PERFORMANCE_PULSE_LAYOUT.entity}>
                  <EntityThumb thumbnailUrl={ad?.thumbnailUrl} fallback="A" />
                  <div className="min-w-0">
                    <CompactName value={ad?.name} className={PERFORMANCE_PULSE_LAYOUT.entityName} />
                    <div className={PERFORMANCE_PULSE_LAYOUT.entityMeta}>{formatNumber(asFiniteNumber(ad?.orders))} orders</div>
                  </div>
                </div>
                <PulseMetricColumn
                  primary={`ROAS ${formatRoas(ad?.roas)}`}
                  secondary={formatCurrency(asFiniteNumber(ad?.spend))}
                  signals={ad?.signals}
                />
              </PulseRow>
            )}
          />

          <PulseCard
            title="Dragging Ads"
            subtitle="Lowest orders or zero-order spend draggers"
            rows={rows.underperformingAds}
            emptyText="No underperforming ads found."
            renderRow={(ad, index) => (
              <PulseRow key={ad?.id || `drag-ad-${index}`} danger>
                <div className={PERFORMANCE_PULSE_LAYOUT.entity}>
                  <EntityThumb thumbnailUrl={ad?.thumbnailUrl} fallback="A" />
                  <div className="min-w-0">
                    <CompactName value={ad?.name} className={PERFORMANCE_PULSE_LAYOUT.entityName} />
                    <div className={PERFORMANCE_PULSE_LAYOUT.entityMeta}>{formatNumber(asFiniteNumber(ad?.orders))} orders</div>
                  </div>
                </div>
                <PulseMetricColumn
                  danger
                  primary={`Risk ${asFiniteNumber(ad?.riskScore).toFixed(1)}`}
                  secondary={`ROAS ${formatRoas(ad?.roas)}`}
                  tertiary={formatCurrency(asFiniteNumber(ad?.spend))}
                  signals={ad?.signals}
                />
              </PulseRow>
            )}
          />

          <PulseCard
            title="Top Products"
            subtitle="Best sellers in range"
            rows={rows.bestSellerProducts}
            emptyText="No product orders in range."
            renderRow={(product, index) => (
              <PulseRow key={product?.id || `product-${index}`}>
                <div className={PERFORMANCE_PULSE_LAYOUT.entity}>
                  <EntityThumb thumbnailUrl={product?.thumbnailUrl} fallback="P" />
                  <div className="min-w-0">
                    <CompactName value={product?.name} className={PERFORMANCE_PULSE_LAYOUT.entityName} />
                    <div className={PERFORMANCE_PULSE_LAYOUT.entityMeta}>{formatNumber(asFiniteNumber(product?.orders))} orders</div>
                  </div>
                </div>
                <PulseMetricColumn
                  primary={`Rev ${formatCurrency(asFiniteNumber(product?.revenue))}`}
                  signals={product?.signals}
                />
              </PulseRow>
            )}
          />
        </div>
      </div>
    </div>
  );
}
