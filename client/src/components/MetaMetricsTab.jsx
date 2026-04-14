import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AuroraBackground from './meta-metrics/AuroraBackground';
import DashboardShell from './meta-metrics/DashboardShell';
import {
  DASHBOARD_DESIGN_HEIGHT,
  DASHBOARD_DESIGN_WIDTH,
  DEFAULT_AGE_BARS,
  DEFAULT_CAMPAIGN_OPTIONS,
  DEFAULT_GENDER,
  DEFAULT_HIGHLIGHTED_DAYS,
  DEFAULT_HOURLY_DATA,
  DEFAULT_MEASURE_OPTIONS,
  DEFAULT_METRICS,
  DEFAULT_WEEK_GROUPS
} from './meta-metrics/mockData';

const DEFAULT_FILTERS = Object.freeze({
  channel: 'facebook',
  measure: DEFAULT_MEASURE_OPTIONS[0] || 'Impressions',
  campaignId: DEFAULT_CAMPAIGN_OPTIONS[0]?.campaignId || '',
  year: null,
  month: null
});

const DEFAULT_LIVE_WINDOW_MINUTES = 30;
const LIVE_REFRESH_INTERVAL_MS = 30 * 1000;
const OUTER_FRAME_PADDING_PX = 24;
const MIN_SURFACE_HEIGHT_PX = 760;
const REFRESHING_LABEL = 'Syncing';
const SURFACE_BORDER_COLOR = 'rgba(148, 197, 255, 0.18)';

function buildFallbackOverview() {
  return {
    period: null,
    filters: {
      defaultChannel: DEFAULT_FILTERS.channel,
      measureOptions: DEFAULT_MEASURE_OPTIONS,
      campaignOptions: DEFAULT_CAMPAIGN_OPTIONS
    },
    shell: {
      metrics: DEFAULT_METRICS,
      genderData: DEFAULT_GENDER,
      ageBars: DEFAULT_AGE_BARS,
      weekGroups: DEFAULT_WEEK_GROUPS,
      hourlyData: DEFAULT_HOURLY_DATA,
      highlightedDays: DEFAULT_HIGHLIGHTED_DAYS,
      countryLiveView: null
    }
  };
}

function resolveStoreId(store) {
  if (store && typeof store === 'object' && typeof store.id === 'string' && store.id.trim()) {
    return store.id.trim();
  }
  if (typeof store === 'string' && store.trim()) return store.trim();
  return 'vironax';
}

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

function buildMonthDateRange(year, month) {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    startDate: `${start.getUTCFullYear()}-${padDatePart(start.getUTCMonth() + 1)}-${padDatePart(start.getUTCDate())}`,
    endDate: `${end.getUTCFullYear()}-${padDatePart(end.getUTCMonth() + 1)}-${padDatePart(end.getUTCDate())}`
  };
}

function appendDateRangeQuery(params, globalDateRange, filters) {
  const monthRange = buildMonthDateRange(filters.year, filters.month);
  if (monthRange) {
    params.set('startDate', monthRange.startDate);
    params.set('endDate', monthRange.endDate);
    return;
  }

  if (globalDateRange?.startDate && globalDateRange?.endDate) {
    params.set('startDate', String(globalDateRange.startDate));
    params.set('endDate', String(globalDateRange.endDate));
    return;
  }

  if (globalDateRange?.type === 'custom' && globalDateRange.start && globalDateRange.end) {
    params.set('startDate', String(globalDateRange.start));
    params.set('endDate', String(globalDateRange.end));
    return;
  }

  if (globalDateRange?.type === 'days' && Number.isFinite(Number(globalDateRange.value))) {
    params.set('days', String(globalDateRange.value));
    return;
  }

  if (globalDateRange?.type === 'yesterday') {
    params.set('yesterday', '1');
  }
}

function buildBaseQuery(storeId, globalDateRange, filters) {
  const params = new URLSearchParams();
  params.set('store', storeId);
  params.set('channel', filters.channel);
  if (filters.measure) {
    params.set('measure', filters.measure);
  }
  if (filters.campaignId) {
    params.set('campaignId', filters.campaignId);
  }
  appendDateRangeQuery(params, globalDateRange, filters);
  return params;
}

function buildOverviewQuery(storeId, globalDateRange, filters) {
  const params = buildBaseQuery(storeId, globalDateRange, filters);
  params.set('liveWindowMinutes', String(DEFAULT_LIVE_WINDOW_MINUTES));
  return params.toString();
}

function buildDemographicsQuery(storeId, globalDateRange, filters) {
  return buildBaseQuery(storeId, globalDateRange, filters).toString();
}

function buildDateRangeSignature(globalDateRange) {
  if (!globalDateRange || typeof globalDateRange !== 'object') return 'none';
  return JSON.stringify({
    startDate: globalDateRange.startDate || null,
    endDate: globalDateRange.endDate || null,
    type: globalDateRange.type || null,
    start: globalDateRange.start || null,
    end: globalDateRange.end || null,
    value: globalDateRange.value || null
  });
}

export default function MetaMetricsTab({ store, globalDateRange }) {
  const containerRef = useRef(null);
  const loadInFlightRef = useRef(false);
  const [overview, setOverview] = useState(() => buildFallbackOverview());
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [containerWidth, setContainerWidth] = useState(DASHBOARD_DESIGN_WIDTH);

  const storeId = useMemo(() => resolveStoreId(store), [store]);
  const dateRangeSignature = useMemo(
    () => buildDateRangeSignature(globalDateRange),
    [globalDateRange]
  );
  const queryString = useMemo(
    () => buildOverviewQuery(storeId, globalDateRange, filters),
    [filters, globalDateRange, storeId]
  );
  const demographicsQuery = useMemo(
    () => buildDemographicsQuery(storeId, globalDateRange, filters),
    [filters, globalDateRange, storeId]
  );

  useEffect(() => {
    setFilters((current) => ({ ...current, year: null, month: null }));
  }, [dateRangeSignature, storeId]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const updateWidth = () => {
      setContainerWidth(node.clientWidth || DASHBOARD_DESIGN_WIDTH);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let refreshTimer = null;

    async function fetchEndpoint(url, fallbackError) {
      const response = await fetch(url, { signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || fallbackError);
      }
      return payload.data;
    }

    async function loadOverview({ showLoading = true } = {}) {
      if (loadInFlightRef.current) return;
      loadInFlightRef.current = true;

      if (showLoading) setLoading(true);
      setError('');

      try {
        const [overviewData, genderData, ageData] = await Promise.all([
          fetchEndpoint(`/api/meta-metrics/overview?${queryString}`, 'Failed to load Meta Metrics overview.'),
          fetchEndpoint(`/api/meta-metrics/gender?${demographicsQuery}`, 'Failed to load Meta Metrics gender data.'),
          fetchEndpoint(`/api/meta-metrics/age?${demographicsQuery}`, 'Failed to load Meta Metrics age data.')
        ]);

        if (cancelled) return;
        startTransition(() => {
          const fallback = buildFallbackOverview();
          const nextOverview = overviewData || fallback;
          const nextShell = nextOverview?.shell || fallback.shell;

          setOverview({
            ...nextOverview,
            shell: {
              ...nextShell,
              genderData: genderData?.genderData || nextShell.genderData || fallback.shell.genderData,
              ageBars: ageData?.ageBars || nextShell.ageBars || fallback.shell.ageBars
            }
          });
        });
      } catch (loadError) {
        if (controller.signal.aborted || cancelled) return;
        setError(loadError?.message || 'Failed to load Meta Metrics data.');
      } finally {
        loadInFlightRef.current = false;
        if (!cancelled && showLoading) setLoading(false);
      }
    }

    async function runRefreshCycle(showLoading) {
      await loadOverview({ showLoading });
      if (cancelled) return;
      refreshTimer = window.setTimeout(() => {
        void runRefreshCycle(false);
      }, LIVE_REFRESH_INTERVAL_MS);
    }

    void runRefreshCycle(true);

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      controller.abort();
    };
  }, [demographicsQuery, queryString]);

  const scale = useMemo(() => {
    const usableWidth = Math.max(containerWidth - (OUTER_FRAME_PADDING_PX * 2), 320);
    return Math.min(usableWidth / DASHBOARD_DESIGN_WIDTH, 1);
  }, [containerWidth]);

  const scaledWidth = DASHBOARD_DESIGN_WIDTH * scale;
  const scaledHeight = DASHBOARD_DESIGN_HEIGHT * scale;
  const surfaceHeight = Math.max(scaledHeight + (OUTER_FRAME_PADDING_PX * 2), MIN_SURFACE_HEIGHT_PX);
  const filterConfig = overview?.filters || buildFallbackOverview().filters;
  const shell = overview?.shell || buildFallbackOverview().shell;
  const handleFiltersChange = useCallback((nextFilters) => {
    setFilters((current) => ({ ...current, ...nextFilters }));
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden rounded-[32px] border shadow-[0_36px_90px_rgba(2,8,24,0.42)]"
      style={{
        minHeight: surfaceHeight,
        borderColor: SURFACE_BORDER_COLOR,
        background: '#030816'
      }}
    >
      <AuroraBackground />

      <div className="relative z-[1] p-6">
        <div style={{ position: 'relative', height: scaledHeight, minHeight: scaledHeight }}>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              width: DASHBOARD_DESIGN_WIDTH,
              height: DASHBOARD_DESIGN_HEIGHT,
              transform: `translateX(-50%) scale(${scale})`,
              transformOrigin: 'top center'
            }}
          >
            <DashboardShell
              metrics={shell.metrics}
              genderData={shell.genderData}
              ageBars={shell.ageBars}
              weekGroups={shell.weekGroups}
              hourlyData={shell.hourlyData}
              highlightedDays={shell.highlightedDays}
              countryLiveView={shell.countryLiveView}
              activeChannel={filters.channel}
              selectedMeasure={filters.measure}
              selectedCampaignId={filters.campaignId}
              measureOptions={filterConfig.measureOptions}
              campaignOptions={filterConfig.campaignOptions}
              defaultChannel={filterConfig.defaultChannel}
              periodEndDate={overview?.period?.endDate || null}
              onFiltersChange={handleFiltersChange}
            />
          </div>
        </div>
      </div>

      {loading && (
        <div
          className="absolute right-4 top-4 z-[2] rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-100"
          style={{
            borderColor: 'rgba(148, 197, 255, 0.24)',
            background: 'rgba(3, 12, 30, 0.42)',
            backdropFilter: 'blur(12px)'
          }}
        >
          {REFRESHING_LABEL}
        </div>
      )}

      {error && (
        <div
          className="absolute bottom-4 left-4 z-[2] max-w-[360px] rounded-[18px] border px-4 py-3 text-sm text-sky-50"
          style={{
            borderColor: 'rgba(248, 113, 113, 0.28)',
            background: 'rgba(21, 10, 24, 0.72)',
            backdropFilter: 'blur(16px)'
          }}
        >
          {error}
        </div>
      )}

      <div
        className="pointer-events-none absolute inset-0 rounded-[32px]"
        style={{
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -80px 120px rgba(6,14,34,0.12)'
        }}
      />
    </div>
  );
}
