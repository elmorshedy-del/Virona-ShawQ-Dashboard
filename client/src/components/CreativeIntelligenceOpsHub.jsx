import { useEffect, useMemo, useState } from 'react';

const WINDOW_TO_DAYS = {
  '30d': 30,
  '60d': 60,
  '90d': 90,
  all_time: 365,
};

const TARGET_OPTIONS = [
  { value: 'log_blended_roas', label: 'log blended ROAS' },
  { value: 'blended_roas', label: 'blended ROAS' },
  { value: 'total_orders', label: 'orders' },
  { value: 'ctr', label: 'CTR' },
  { value: 'hook_rate', label: 'hook rate' },
];

const DATASET_GROUP_LABELS = {
  identity_metadata: 'Identity Metadata',
  performance_context: 'Performance Context',
  visual_structural: 'Visual Structural',
  text_layer: 'Text Layer',
  audio_layer: 'Audio Layer',
  strategic_labels: 'Strategic Labels',
};

const DEFAULT_FEATURE_GROUPS = [
  'identity_metadata',
  'performance_context',
  'visual_structural',
  'text_layer',
  'audio_layer',
  'strategic_labels',
];

const STORE_KEY_MAP = {
  shawq: 'shawq.co',
  vironax: 'vironax.com',
};

const SECTION_TABS = [
  { id: 'workbench', label: 'Workbench' },
  { id: 'library', label: 'Library' },
  { id: 'dataset', label: 'Dataset Hub' },
];
const CREATIVE_INTELLIGENCE_API_ROOT = '/creative-intelligence-data';

function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${fmtNumber(value, digits)}%`;
}

function fmtMoney(value, currency = 'TRY') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const resolved = String(currency || 'TRY').trim().toUpperCase() || 'TRY';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: resolved,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return `${resolved} ${fmtNumber(value, 2)}`;
  }
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    const raw = Array.isArray(value) ? value.join(',') : String(value);
    const text = raw.trim();
    if (!text) return;
    search.set(key, text);
  });
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

async function readError(response) {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text();
  if (!text) return fallback || 'Request failed';
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.detail === 'string' && parsed.detail.trim()) return parsed.detail.trim();
      if (typeof parsed?.error === 'string' && parsed.error.trim()) return parsed.error.trim();
      if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message.trim();
    } catch {
      // keep fallback
    }
  }
  if (text.startsWith('<!doctype html') || text.startsWith('<html')) {
    return 'Creative intelligence data API route is not wired on this deployment yet.';
  }
  return text || fallback || 'Request failed';
}

async function requestCreativeApi(path, options = {}) {
  const bases = ['/api', ''];
  let lastError = null;

  for (const base of bases) {
    const url = `${base}${path}`;
    try {
      const response = await fetch(url, options);
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (response.ok && contentType.includes('application/json')) {
        return response.json();
      }

      if (response.ok && !contentType.includes('application/json')) {
        const message = 'Creative intelligence data API returned non-JSON response.';
        if (base === '/api') {
          lastError = new Error(message);
          continue;
        }
        throw new Error(message);
      }

      const message = await readError(response);
      if (base === '/api' && (response.status === 404 || response.status === 405)) {
        lastError = new Error(message);
        continue;
      }
      throw new Error(message);
    } catch (error) {
      if (base === '/api') {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Creative intelligence data API unavailable');
}

function deriveStoreKey(store, currentStore) {
  const storeId = (typeof currentStore === 'string' ? currentStore : store?.id || '').trim().toLowerCase();
  const explicit = String(store?.store_key || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (STORE_KEY_MAP[storeId]) return STORE_KEY_MAP[storeId];
  if (storeId) return storeId;
  return 'shawq.co';
}

function buildMetricCards(items, currency) {
  if (!Array.isArray(items) || items.length === 0) {
    return [
      { label: 'Creatives', value: '0' },
      { label: 'Spend', value: '-' },
      { label: 'ROAS', value: '-' },
      { label: 'Orders', value: '-' },
      { label: 'CTR', value: '-' },
      { label: 'Hook Rate', value: '-' },
      { label: 'Outliers', value: '-' },
    ];
  }
  const totalSpend = items.reduce((sum, row) => sum + (Number(row.total_spend) || 0), 0);
  const totalRevenue = items.reduce((sum, row) => sum + (Number(row.total_revenue) || 0), 0);
  const totalOrders = items.reduce((sum, row) => sum + (Number(row.total_orders) || 0), 0);
  const totalImpressions = items.reduce((sum, row) => sum + (Number(row.total_impressions) || 0), 0);
  const weightedCtrClicks = items.reduce(
    (sum, row) => sum + (((Number(row.total_impressions) || 0) * (Number(row.ctr) || 0)) / 100),
    0,
  );
  const weightedHookViews = items.reduce(
    (sum, row) => sum + (((Number(row.total_impressions) || 0) * (Number(row.hook_rate) || 0)) / 100),
    0,
  );

  const portfolioRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;
  const weightedCtr = totalImpressions > 0 ? (weightedCtrClicks / totalImpressions) * 100 : null;
  const weightedHook = totalImpressions > 0 ? (weightedHookViews / totalImpressions) * 100 : null;
  const outlierCount = items.filter((row) => !!row.is_outlier).length;

  return [
    { label: 'Creatives', value: fmtNumber(items.length, 0) },
    { label: 'Spend', value: fmtMoney(totalSpend, currency) },
    { label: 'ROAS', value: fmtNumber(portfolioRoas, 2) },
    { label: 'Orders', value: fmtNumber(totalOrders, 0) },
    { label: 'CTR', value: fmtPercent(weightedCtr, 2) },
    { label: 'Hook Rate', value: fmtPercent(weightedHook, 2) },
    { label: 'Outliers', value: fmtNumber(outlierCount, 0) },
  ];
}

function SectionTabs({ active, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
      {SECTION_TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              isActive ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default function CreativeIntelligenceOpsHub({ store, currentStore }) {
  const initialStoreKey = useMemo(() => deriveStoreKey(store, currentStore), [store, currentStore]);
  const [section, setSection] = useState('workbench');
  const [tenantKey, setTenantKey] = useState('default');
  const [storeKey, setStoreKey] = useState(initialStoreKey);
  const [globalError, setGlobalError] = useState('');

  // Library state
  const [libraryWindow, setLibraryWindow] = useState('90d');
  const [libraryLimit, setLibraryLimit] = useState(100);
  const [libraryRows, setLibraryRows] = useState([]);
  const [librarySelectedId, setLibrarySelectedId] = useState('');
  const [libraryDetail, setLibraryDetail] = useState(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryMaterializing, setLibraryMaterializing] = useState(false);
  const [libraryDetailLoading, setLibraryDetailLoading] = useState(false);

  // Workbench state
  const [workbenchWindow, setWorkbenchWindow] = useState('90d');
  const [workbenchStatus, setWorkbenchStatus] = useState('all');
  const [workbenchLimit, setWorkbenchLimit] = useState(50);
  const [workbenchRows, setWorkbenchRows] = useState([]);
  const [workbenchSelectedId, setWorkbenchSelectedId] = useState('');
  const [workbenchDetail, setWorkbenchDetail] = useState(null);
  const [workbenchLabels, setWorkbenchLabels] = useState(null);
  const [workbenchLoading, setWorkbenchLoading] = useState(false);
  const [workbenchDetailLoading, setWorkbenchDetailLoading] = useState(false);
  const [workbenchSingleLoading, setWorkbenchSingleLoading] = useState(false);
  const [workbenchBatchLoading, setWorkbenchBatchLoading] = useState(false);
  const [workbenchBatchResult, setWorkbenchBatchResult] = useState(null);

  // Dataset state
  const [datasetName, setDatasetName] = useState('usa-creative-ml-v1');
  const [datasetWindow, setDatasetWindow] = useState('90d');
  const [datasetGeo, setDatasetGeo] = useState('US');
  const [datasetMinSpend, setDatasetMinSpend] = useState(30);
  const [datasetLabeledOnly, setDatasetLabeledOnly] = useState(true);
  const [datasetTarget, setDatasetTarget] = useState('log_blended_roas');
  const [datasetOutput, setDatasetOutput] = useState('csv');
  const [datasetGroups, setDatasetGroups] = useState(DEFAULT_FEATURE_GROUPS);
  const [datasetSelectedFields, setDatasetSelectedFields] = useState([]);
  const [datasetPreview, setDatasetPreview] = useState(null);
  const [datasetBuildResult, setDatasetBuildResult] = useState(null);
  const [datasetPreviewLoading, setDatasetPreviewLoading] = useState(false);
  const [datasetBuildLoading, setDatasetBuildLoading] = useState(false);

  const libraryDays = WINDOW_TO_DAYS[libraryWindow] || 90;
  const workbenchDays = WINDOW_TO_DAYS[workbenchWindow] || 90;
  const datasetDays = WINDOW_TO_DAYS[datasetWindow] || 90;
  const displayCurrency = libraryDetail?.currency || libraryRows.find((row) => row.currency)?.currency || 'TRY';
  const libraryMetricCards = useMemo(() => buildMetricCards(libraryRows, displayCurrency), [libraryRows, displayCurrency]);
  const availableDatasetGroups = datasetPreview?.available_groups || {};
  const availableDatasetFields = useMemo(() => (
    datasetGroups.flatMap((group) => availableDatasetGroups[group] || [])
  ), [availableDatasetGroups, datasetGroups]);

  useEffect(() => {
    setStoreKey(initialStoreKey);
  }, [initialStoreKey]);

  const clearError = () => setGlobalError('');

  const loadLibraryRows = async ({ selectFirst = false } = {}) => {
    if (!storeKey) return;
    clearError();
    setLibraryLoading(true);
    try {
      const payload = await requestCreativeApi(
        `${CREATIVE_INTELLIGENCE_API_ROOT}/usa-rollup${buildQuery({
          tenant_key: tenantKey,
          store_key: storeKey,
          lookback_days: libraryDays,
          lookback_window: libraryWindow,
          limit: libraryLimit,
          metric_keys: 'spend,roas,orders,ctr,hook_rate,lpv_rate',
        })}`,
      );
      const rows = Array.isArray(payload?.items) ? payload.items : [];
      setLibraryRows(rows);
      if (selectFirst) {
        setLibrarySelectedId(rows[0]?.rollup_id || '');
      } else if (!rows.some((row) => row.rollup_id === librarySelectedId)) {
        setLibrarySelectedId(rows[0]?.rollup_id || '');
      }
    } catch (error) {
      setGlobalError(error?.message || 'Failed to load USA rollup');
    } finally {
      setLibraryLoading(false);
    }
  };

  const loadLibraryDetail = async (rollupId) => {
    if (!storeKey || !rollupId) {
      setLibraryDetail(null);
      return;
    }
    clearError();
    setLibraryDetailLoading(true);
    try {
      const payload = await requestCreativeApi(
        `${CREATIVE_INTELLIGENCE_API_ROOT}/usa-rollup/${encodeURIComponent(rollupId)}${buildQuery({
          tenant_key: tenantKey,
          store_key: storeKey,
          lookback_days: libraryDays,
          lookback_window: libraryWindow,
          metric_keys: 'spend,roas,orders,ctr,hook_rate,lpv_rate',
        })}`,
      );
      setLibraryDetail(payload || null);
    } catch (error) {
      setGlobalError(error?.message || 'Failed to load creative detail');
      setLibraryDetail(null);
    } finally {
      setLibraryDetailLoading(false);
    }
  };

  const materializeLibrary = async () => {
    if (!storeKey) return;
    clearError();
    setLibraryMaterializing(true);
    try {
      await requestCreativeApi(`${CREATIVE_INTELLIGENCE_API_ROOT}/usa-rollup/materialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_key: tenantKey,
          store_key: storeKey,
          lookback_days: libraryDays,
          lookback_window: libraryWindow,
          min_spend_threshold: 30,
          metric_keys: ['spend', 'roas', 'orders', 'ctr', 'hook_rate', 'lpv_rate'],
        }),
      });
      await loadLibraryRows({ selectFirst: true });
    } catch (error) {
      setGlobalError(error?.message || 'Failed to materialize USA rollup');
    } finally {
      setLibraryMaterializing(false);
    }
  };

  const loadWorkbenchRows = async ({ selectFirst = false } = {}) => {
    if (!storeKey) return;
    clearError();
    setWorkbenchLoading(true);
    try {
      const payload = await requestCreativeApi(
        `${CREATIVE_INTELLIGENCE_API_ROOT}/workbench/queue${buildQuery({
          tenant_key: tenantKey,
          store_key: storeKey,
          lookback_days: workbenchDays,
          lookback_window: workbenchWindow,
          status: workbenchStatus,
          limit: workbenchLimit,
        })}`,
      );
      const rows = Array.isArray(payload?.items) ? payload.items : [];
      setWorkbenchRows(rows);
      if (selectFirst) {
        setWorkbenchSelectedId(rows[0]?.rollup_id || '');
      } else if (!rows.some((row) => row.rollup_id === workbenchSelectedId)) {
        setWorkbenchSelectedId(rows[0]?.rollup_id || '');
      }
    } catch (error) {
      setGlobalError(error?.message || 'Failed to load workbench queue');
    } finally {
      setWorkbenchLoading(false);
    }
  };

  const loadWorkbenchDetail = async (rollupId) => {
    if (!storeKey || !rollupId) {
      setWorkbenchDetail(null);
      setWorkbenchLabels(null);
      return;
    }
    clearError();
    setWorkbenchDetailLoading(true);
    try {
      const payload = await requestCreativeApi(
        `${CREATIVE_INTELLIGENCE_API_ROOT}/usa-rollup/${encodeURIComponent(rollupId)}${buildQuery({
          tenant_key: tenantKey,
          store_key: storeKey,
          lookback_days: workbenchDays,
          lookback_window: workbenchWindow,
          metric_keys: 'spend,roas,orders,ctr,hook_rate,lpv_rate',
        })}`,
      );
      setWorkbenchDetail(payload || null);
      if (payload?.creative_labels) {
        setWorkbenchLabels(payload.creative_labels);
      } else {
        try {
          const labels = await requestCreativeApi(
            `${CREATIVE_INTELLIGENCE_API_ROOT}/labels/${encodeURIComponent(rollupId)}${buildQuery({
              tenant_key: tenantKey,
              store_key: storeKey,
              variant_id: payload?.variant_id || '',
            })}`,
          );
          setWorkbenchLabels(labels || null);
        } catch {
          setWorkbenchLabels(null);
        }
      }
    } catch (error) {
      setGlobalError(error?.message || 'Failed to load workbench detail');
      setWorkbenchDetail(null);
      setWorkbenchLabels(null);
    } finally {
      setWorkbenchDetailLoading(false);
    }
  };

  const runSingleLabel = async (forceRefresh = false) => {
    if (!workbenchDetail?.rollup_id) return;
    clearError();
    setWorkbenchSingleLoading(true);
    try {
      const payload = await requestCreativeApi(`${CREATIVE_INTELLIGENCE_API_ROOT}/labels/materialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_key: tenantKey,
          store_key: storeKey,
          rollup_id: workbenchDetail.rollup_id,
          variant_id: workbenchDetail.variant_id || null,
          force_refresh: forceRefresh,
        }),
      });
      setWorkbenchLabels(payload?.labels || null);
      await loadWorkbenchRows({ selectFirst: false });
    } catch (error) {
      setGlobalError(error?.message || 'Single creative labeling failed');
    } finally {
      setWorkbenchSingleLoading(false);
    }
  };

  const runBatchLabel = async (forceRefresh = false) => {
    if (!workbenchRows.length) return;
    clearError();
    setWorkbenchBatchLoading(true);
    setWorkbenchBatchResult(null);
    try {
      const payload = await requestCreativeApi(`${CREATIVE_INTELLIGENCE_API_ROOT}/workbench/batch-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_key: tenantKey,
          store_key: storeKey,
          lookback_days: workbenchDays,
          lookback_window: workbenchWindow,
          status: workbenchStatus === 'labeled' ? 'all' : workbenchStatus,
          limit: Math.min(workbenchLimit, 10),
          force_refresh: forceRefresh,
        }),
      });
      setWorkbenchBatchResult(payload || null);
      await loadWorkbenchRows({ selectFirst: false });
    } catch (error) {
      setGlobalError(error?.message || 'Batch labeling failed');
    } finally {
      setWorkbenchBatchLoading(false);
    }
  };

  const toggleDatasetGroup = (groupId) => {
    setDatasetGroups((prev) => {
      if (prev.includes(groupId)) return prev.filter((item) => item !== groupId);
      return [...prev, groupId];
    });
  };

  const toggleDatasetField = (field) => {
    setDatasetSelectedFields((prev) => {
      if (prev.includes(field)) return prev.filter((item) => item !== field);
      return [...prev, field];
    });
  };

  const previewDataset = async () => {
    if (!storeKey) return;
    clearError();
    setDatasetPreviewLoading(true);
    setDatasetBuildResult(null);
    try {
      const payload = await requestCreativeApi(`${CREATIVE_INTELLIGENCE_API_ROOT}/dataset-hub/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_key: tenantKey,
          store_key: storeKey,
          lookback_days: datasetDays,
          lookback_window: datasetWindow,
          geo: datasetGeo,
          min_spend_threshold: Number(datasetMinSpend) || 0,
          labeled_only: datasetLabeledOnly,
          feature_groups: datasetGroups,
          selected_fields: datasetSelectedFields,
          target_metric: datasetTarget,
          sample_limit: 5,
        }),
      });
      setDatasetPreview(payload || null);
      if (Array.isArray(payload?.selected_fields) && datasetSelectedFields.length === 0) {
        setDatasetSelectedFields(payload.selected_fields);
      }
    } catch (error) {
      setGlobalError(error?.message || 'Dataset preview failed');
    } finally {
      setDatasetPreviewLoading(false);
    }
  };

  const buildDataset = async () => {
    if (!storeKey) return;
    clearError();
    setDatasetBuildLoading(true);
    try {
      const payload = await requestCreativeApi(`${CREATIVE_INTELLIGENCE_API_ROOT}/dataset-hub/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_key: tenantKey,
          store_key: storeKey,
          dataset_name: datasetName,
          lookback_days: datasetDays,
          lookback_window: datasetWindow,
          geo: datasetGeo,
          min_spend_threshold: Number(datasetMinSpend) || 0,
          labeled_only: datasetLabeledOnly,
          feature_groups: datasetGroups,
          selected_fields: datasetSelectedFields,
          target_metric: datasetTarget,
          output_format: datasetOutput,
        }),
      });
      setDatasetBuildResult(payload || null);
    } catch (error) {
      setGlobalError(error?.message || 'Dataset build failed');
    } finally {
      setDatasetBuildLoading(false);
    }
  };

  useEffect(() => {
    if (section !== 'library') return;
    void loadLibraryRows({ selectFirst: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, tenantKey, storeKey, libraryWindow, libraryLimit]);

  useEffect(() => {
    if (section !== 'library') return;
    void loadLibraryDetail(librarySelectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, librarySelectedId, tenantKey, storeKey, libraryWindow]);

  useEffect(() => {
    if (section !== 'workbench') return;
    void loadWorkbenchRows({ selectFirst: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, tenantKey, storeKey, workbenchWindow, workbenchStatus, workbenchLimit]);

  useEffect(() => {
    if (section !== 'workbench') return;
    void loadWorkbenchDetail(workbenchSelectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, workbenchSelectedId, tenantKey, storeKey, workbenchWindow]);

  return (
    <div className="px-6 pb-10 space-y-6">
      <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Creative Intelligence Ops</h2>
            <p className="text-sm text-gray-500">
              Workbench + merged USA library + dataset hub in one operator surface.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full lg:w-auto">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Tenant
              <input
                value={tenantKey}
                onChange={(event) => setTenantKey(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </label>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Store Key
              <input
                value={storeKey}
                onChange={(event) => setStoreKey(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </label>
          </div>
        </div>
        <div className="mt-4">
          <SectionTabs active={section} onChange={setSection} />
        </div>
        {globalError ? (
          <p className="mt-3 text-sm text-red-600">{globalError}</p>
        ) : null}
      </section>

      {section === 'library' ? (
        <>
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={libraryWindow}
                onChange={(event) => setLibraryWindow(event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="30d">Last 30 days</option>
                <option value="60d">Last 60 days</option>
                <option value="90d">Last 90 days</option>
                <option value="all_time">All time</option>
              </select>
              <select
                value={libraryLimit}
                onChange={(event) => setLibraryLimit(Number(event.target.value))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value={50}>50 creatives</option>
                <option value={100}>100 creatives</option>
                <option value={200}>200 creatives</option>
              </select>
              <button
                type="button"
                onClick={() => loadLibraryRows({ selectFirst: false })}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={libraryLoading}
              >
                {libraryLoading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={materializeLibrary}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                disabled={libraryMaterializing}
              >
                {libraryMaterializing ? 'Building...' : 'Build USA Rollup'}
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              {libraryMetricCards.map((card) => (
                <div key={card.label} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-500">{card.label}</p>
                  <p className="text-sm font-semibold text-gray-900 mt-1">{card.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <article className="xl:col-span-3 bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Merged USA Creatives</h3>
                <span className="text-xs text-gray-500">{fmtNumber(libraryRows.length, 0)} rows</span>
              </div>
              <div className="overflow-auto max-h-[560px]">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-3">Creative</th>
                      <th className="py-2 pr-3">Spend</th>
                      <th className="py-2 pr-3">ROAS</th>
                      <th className="py-2 pr-3">Orders</th>
                      <th className="py-2 pr-3">CTR</th>
                      <th className="py-2 pr-3">Hook</th>
                    </tr>
                  </thead>
                  <tbody>
                    {libraryRows.map((row) => (
                      <tr
                        key={row.rollup_id}
                        onClick={() => setLibrarySelectedId(row.rollup_id)}
                        className={`cursor-pointer border-b border-gray-100 ${
                          librarySelectedId === row.rollup_id ? 'bg-gray-100' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="py-2 pr-3">
                          <div className="font-medium text-gray-900">{row.creative_name || row.rollup_id}</div>
                          <div className="text-xs text-gray-500">
                            {fmtNumber(row.usage_count, 0)} usages · {fmtNumber(row.variant_count, 0)} variants
                            {row.is_outlier ? ' · outlier' : ''}
                          </div>
                        </td>
                        <td className="py-2 pr-3">{fmtMoney(row.total_spend, row.currency || displayCurrency)}</td>
                        <td className="py-2 pr-3">{fmtNumber(row.blended_roas, 2)}</td>
                        <td className="py-2 pr-3">{fmtNumber(row.total_orders, 0)}</td>
                        <td className="py-2 pr-3">{fmtPercent(row.ctr, 2)}</td>
                        <td className="py-2 pr-3">{fmtPercent(row.hook_rate, 2)}</td>
                      </tr>
                    ))}
                    {!libraryRows.length ? (
                      <tr>
                        <td colSpan={6} className="py-4 text-sm text-gray-500">No rows found. Build the rollup first.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Creative Detail</h3>
                {libraryDetailLoading ? <span className="text-xs text-gray-500">Loading...</span> : null}
              </div>
              {libraryDetail ? (
                <div className="space-y-3">
                  {(libraryDetail.preview_url || libraryDetail.thumbnail_url) ? (
                    <img
                      src={libraryDetail.preview_url || libraryDetail.thumbnail_url}
                      alt={libraryDetail.creative_name || 'Creative preview'}
                      className="w-full rounded-xl border border-gray-200 object-cover max-h-64"
                    />
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['Spend', fmtMoney(libraryDetail.total_spend, libraryDetail.currency || displayCurrency)],
                      ['Revenue', fmtMoney(libraryDetail.total_revenue, libraryDetail.currency || displayCurrency)],
                      ['ROAS', fmtNumber(libraryDetail.blended_roas, 2)],
                      ['Orders', fmtNumber(libraryDetail.total_orders, 0)],
                      ['CTR', fmtPercent(libraryDetail.ctr, 2)],
                      ['Hook', fmtPercent(libraryDetail.hook_rate, 2)],
                      ['LPV Rate', fmtPercent(libraryDetail.lpv_rate, 2)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
                        <p className="text-sm font-semibold text-gray-900">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Usage Memory</p>
                    <div className="mt-2 space-y-2 max-h-48 overflow-auto pr-1">
                      {(libraryDetail.usage_members || []).map((usage) => (
                        <div key={usage.usage_id} className="text-xs text-gray-700 border-b border-gray-100 pb-2">
                          <div className="font-medium">{usage.campaign_name || 'Campaign missing'}</div>
                          <div>{usage.adset_name || 'Ad set missing'}</div>
                          <div className="text-gray-500">{usage.ad_name || usage.usage_id}</div>
                        </div>
                      ))}
                      {!Array.isArray(libraryDetail.usage_members) || !libraryDetail.usage_members.length ? (
                        <p className="text-xs text-gray-500">No usage rows.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Select a creative row to inspect.</p>
              )}
            </article>
          </section>
        </>
      ) : null}

      {section === 'workbench' ? (
        <>
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={workbenchWindow}
                onChange={(event) => setWorkbenchWindow(event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="30d">Last 30 days</option>
                <option value="60d">Last 60 days</option>
                <option value="90d">Last 90 days</option>
                <option value="all_time">All time</option>
              </select>
              <select
                value={workbenchStatus}
                onChange={(event) => setWorkbenchStatus(event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="all">All</option>
                <option value="unlabeled">Unlabeled</option>
                <option value="labeled">Labeled</option>
              </select>
              <select
                value={workbenchLimit}
                onChange={(event) => setWorkbenchLimit(Number(event.target.value))}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value={25}>25 rows</option>
                <option value={50}>50 rows</option>
                <option value={100}>100 rows</option>
              </select>
              <button
                type="button"
                onClick={() => loadWorkbenchRows({ selectFirst: false })}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={workbenchLoading}
              >
                {workbenchLoading ? 'Refreshing...' : 'Refresh Queue'}
              </button>
              <button
                type="button"
                onClick={() => runBatchLabel(false)}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                disabled={workbenchBatchLoading || !workbenchRows.length}
              >
                {workbenchBatchLoading ? 'Running...' : 'Batch Label'}
              </button>
              <button
                type="button"
                onClick={() => runBatchLabel(true)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                disabled={workbenchBatchLoading || !workbenchRows.length}
              >
                Force Refresh
              </button>
            </div>
            {workbenchBatchResult ? (
              <p className="mt-3 text-xs text-gray-600">
                Batch result: {fmtNumber(workbenchBatchResult.success_count, 0)} success,{' '}
                {fmtNumber(workbenchBatchResult.failure_count, 0)} failed.
              </p>
            ) : null}
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <article className="xl:col-span-3 bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Label Queue</h3>
                <span className="text-xs text-gray-500">{fmtNumber(workbenchRows.length, 0)} rows</span>
              </div>
              <div className="overflow-auto max-h-[560px]">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-3">Creative</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Spend</th>
                      <th className="py-2 pr-3">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workbenchRows.map((row) => (
                      <tr
                        key={row.rollup_id}
                        onClick={() => setWorkbenchSelectedId(row.rollup_id)}
                        className={`cursor-pointer border-b border-gray-100 ${
                          workbenchSelectedId === row.rollup_id ? 'bg-gray-100' : 'hover:bg-gray-50'
                        }`}
                      >
                        <td className="py-2 pr-3">
                          <div className="font-medium text-gray-900">{row.creative_name || row.rollup_id}</div>
                          <div className="text-xs text-gray-500">
                            {fmtNumber(row.usage_count, 0)} usages · {fmtNumber(row.variant_count, 0)} variants
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                              row.label_status === 'labeled'
                                ? 'bg-gray-100 text-gray-700'
                                : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {row.label_status || 'unlabeled'}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{fmtMoney(row.total_spend, row.currency || 'TRY')}</td>
                        <td className="py-2 pr-3">{fmtNumber(row.blended_roas, 2)}</td>
                      </tr>
                    ))}
                    {!workbenchRows.length ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-sm text-gray-500">No queue rows for this filter.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="xl:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Inspector</h3>
                {workbenchDetailLoading ? <span className="text-xs text-gray-500">Loading...</span> : null}
              </div>
              {workbenchDetail ? (
                <div className="space-y-3">
                  {(workbenchDetail.preview_url || workbenchDetail.thumbnail_url) ? (
                    <img
                      src={workbenchDetail.preview_url || workbenchDetail.thumbnail_url}
                      alt={workbenchDetail.creative_name || 'Creative preview'}
                      className="w-full rounded-xl border border-gray-200 object-cover max-h-64"
                    />
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['Spend', fmtMoney(workbenchDetail.total_spend, workbenchDetail.currency || 'TRY')],
                      ['ROAS', fmtNumber(workbenchDetail.blended_roas, 2)],
                      ['Orders', fmtNumber(workbenchDetail.total_orders, 0)],
                      ['CTR', fmtPercent(workbenchDetail.ctr, 2)],
                      ['Hook', fmtPercent(workbenchDetail.hook_rate, 2)],
                      ['LPV', fmtPercent(workbenchDetail.lpv_rate, 2)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
                        <p className="text-sm font-semibold text-gray-900">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runSingleLabel(false)}
                      className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                      disabled={workbenchSingleLoading}
                    >
                      {workbenchSingleLoading ? 'Running...' : 'Run Once'}
                    </button>
                    <button
                      type="button"
                      onClick={() => runSingleLabel(true)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                      disabled={workbenchSingleLoading}
                    >
                      Force Refresh
                    </button>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Stored Labels</p>
                    {workbenchLabels ? (
                      <pre className="mt-2 text-[11px] leading-5 text-gray-700 whitespace-pre-wrap break-all">
                        {JSON.stringify(workbenchLabels, null, 2)}
                      </pre>
                    ) : (
                      <p className="mt-2 text-xs text-gray-500">No labels stored yet.</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Select a queue row to inspect and run labels.</p>
              )}
            </article>
          </section>
        </>
      ) : null}

      {section === 'dataset' ? (
        <>
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Dataset Name
                <input
                  value={datasetName}
                  onChange={(event) => setDatasetName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                />
              </label>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Window
                <select
                  value={datasetWindow}
                  onChange={(event) => setDatasetWindow(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                >
                  <option value="30d">Last 30 days</option>
                  <option value="60d">Last 60 days</option>
                  <option value="90d">Last 90 days</option>
                  <option value="all_time">All time</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Target
                <select
                  value={datasetTarget}
                  onChange={(event) => setDatasetTarget(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                >
                  {TARGET_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Output
                <select
                  value={datasetOutput}
                  onChange={(event) => setDatasetOutput(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </label>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Geo
                <input
                  value={datasetGeo}
                  onChange={(event) => setDatasetGeo(event.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                />
              </label>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Min Spend
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={datasetMinSpend}
                  onChange={(event) => setDatasetMinSpend(Number(event.target.value || 0))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
                />
              </label>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2 mt-6">
                <input
                  type="checkbox"
                  checked={datasetLabeledOnly}
                  onChange={(event) => setDatasetLabeledOnly(event.target.checked)}
                />
                Labeled only
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {Object.entries(DATASET_GROUP_LABELS).map(([groupId, label]) => (
                <button
                  key={groupId}
                  type="button"
                  onClick={() => toggleDatasetGroup(groupId)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                    datasetGroups.includes(groupId)
                      ? 'bg-gray-100 text-gray-700 border-gray-300'
                      : 'bg-gray-50 text-gray-600 border-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {availableDatasetFields.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {availableDatasetFields.map((field) => (
                  <button
                    key={field}
                    type="button"
                    onClick={() => toggleDatasetField(field)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                      datasetSelectedFields.includes(field)
                        ? 'bg-gray-100 text-gray-700 border-gray-300'
                        : 'bg-gray-50 text-gray-600 border-gray-200'
                    }`}
                  >
                    {field}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={previewDataset}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                disabled={datasetPreviewLoading}
              >
                {datasetPreviewLoading ? 'Previewing...' : 'Preview Dataset'}
              </button>
              <button
                type="button"
                  onClick={buildDataset}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                  disabled={datasetBuildLoading}
                >
                  {datasetBuildLoading ? 'Building...' : 'Build Dataset'}
              </button>
            </div>
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Dataset Preview</h3>
              {datasetPreview ? (
                <span className="text-xs text-gray-500">{fmtNumber(datasetPreview.row_count, 0)} rows</span>
              ) : null}
            </div>
            {datasetPreview ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Rows</p>
                    <p className="text-sm font-semibold text-gray-900">{fmtNumber(datasetPreview.row_count, 0)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Target Non-Null</p>
                    <p className="text-sm font-semibold text-gray-900">{fmtNumber(datasetPreview.target_non_null_count, 0)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Fields</p>
                    <p className="text-sm font-semibold text-gray-900">{fmtNumber((datasetPreview.selected_fields || []).length, 0)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Target</p>
                    <p className="text-sm font-semibold text-gray-900">{datasetPreview.target_metric || datasetTarget}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Missingness</p>
                  <div className="mt-2 overflow-auto max-h-40">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                          <th className="py-1 pr-3">Field</th>
                          <th className="py-1 pr-3">Missing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(datasetPreview.missing_counts || {}).map(([field, count]) => (
                          <tr key={field} className="border-b border-gray-50">
                            <td className="py-1 pr-3">{field}</td>
                            <td className="py-1 pr-3">{fmtNumber(count, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sample Rows</p>
                  <pre className="mt-2 text-[11px] leading-5 text-gray-700 whitespace-pre-wrap break-all">
                    {JSON.stringify(datasetPreview.sample_rows || [], null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Run preview to inspect row shape and feature health.</p>
            )}

            {datasetBuildResult ? (
              <div className="mt-4 rounded-lg border border-gray-300 bg-gray-100 p-3">
                <p className="text-sm font-semibold text-gray-800">{datasetBuildResult.dataset_name || datasetName}</p>
                <p className="text-xs text-gray-700 mt-1">Data: {datasetBuildResult.data_path || '-'}</p>
                <p className="text-xs text-gray-700">Recipe: {datasetBuildResult.recipe_path || '-'}</p>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
