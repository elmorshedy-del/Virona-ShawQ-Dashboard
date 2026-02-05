import { useEffect, useMemo, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
  Tooltip,
  ResponsiveContainer
} from 'recharts';
import { COUNTRIES } from '../data/countries';

const GENDER_COLORS = {
  female: '#ec4899',
  male: '#3b82f6',
  unknown: '#94a3b8'
};

const AGE_ORDER = [
  '13-17',
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55-64',
  '65+',
  'unknown'
];

const HEAT_OPTIONS = [
  { key: 'atcRate', label: 'ATC rate' },
  { key: 'checkoutRate', label: 'Checkout rate' },
  { key: 'purchaseRate', label: 'Purchase rate' }
];

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
}

function formatCountryName(code, map) {
  if (!code) return 'Unknown';
  return map.get(code) || code;
}

function formatSegmentLabel(row) {
  if (!row) return '—';
  if (row.segmentType === 'age_gender') {
    return `${row.age || 'Unknown'} · ${row.genderLabel || 'Unknown'}`;
  }
  return `${row.country || 'ALL'} · ${row.genderLabel || 'Unknown'}`;
}

function titleCaseWords(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatPlacementLabel(row) {
  if (!row) return '—';
  const platform = titleCaseWords(row.publisherPlatform || row.publisher_platform || 'Unknown');
  const position = titleCaseWords(row.platformPosition || row.platform_position || 'Unknown');
  return `${platform} · ${position}`;
}

function formatDeviceLabel(row) {
  if (!row) return '—';
  return titleCaseWords(row.devicePlatform || row.device_platform || 'Unknown');
}

const getIstanbulDateString = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(date);

function SummaryCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-2 text-lg font-semibold text-gray-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-500">{hint}</div> : null}
    </div>
  );
}

function KeyInsightsPanel({ insights, title = 'Key Insights', showTitle = true, emptyMessage = 'Not enough data to generate demographic insights.' }) {
  if (!insights || insights.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  const getBulletColor = (type) => {
    switch (type) {
      case 'opportunity': return 'bg-emerald-500';
      case 'waste': return 'bg-red-500';
      case 'gender': return 'bg-indigo-500';
      case 'sweetspot': return 'bg-amber-500';
      case 'leak': return 'bg-orange-500';
      case 'country': return 'bg-blue-500';
      case 'placement': return 'bg-cyan-500';
      case 'device': return 'bg-violet-500';
      case 'info': return 'bg-slate-400';
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-slate-50 to-white p-4">
      {showTitle ? (
        <div className="mb-3 text-sm font-semibold text-gray-800">
          🔍 {title}
        </div>
      ) : null}
      <ul className="space-y-2">
        {insights.map((insight, idx) => (
          <li key={`${insight.id || insight.key || insight.type || 'insight'}-${idx}`} className="flex items-start gap-2 text-sm text-gray-700">
            <span className={`mt-1.5 h-2 w-2 rounded-full ${getBulletColor(insight.type)} flex-shrink-0`} />
            <span>{insight.text || insight.title || ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BubbleTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-md">
      <div className="font-semibold text-gray-900">{data.label}</div>
      <div className="mt-1 text-gray-600">Spend share: {formatPercent(data.spendShare)}</div>
      <div className="text-gray-600">ATC rate: {formatPercent(data.atcRate)}</div>
      <div className="text-gray-600">Clicks: {formatNumber(data.clicks)}</div>
    </div>
  );
}

function heatColor(value, min, max) {
  if (!Number.isFinite(value) || min === null || max === null || min === max) {
    return { background: '#f1f5f9', color: '#475569' };
  }
  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const alpha = 0.15 + ratio * 0.75;
  return {
    background: `rgba(79, 70, 229, ${alpha})`,
    color: ratio > 0.55 ? '#f8fafc' : '#0f172a'
  };
}

export default function MetaDemographics({ store, globalDateRange, formatCurrency }) {
  const storeId = store?.id || 'vironax';
  const [rangePreset, setRangePreset] = useState('last90');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [heatMetric, setHeatMetric] = useState('atcRate');
  const [splitByGender, setSplitByGender] = useState(false);

  const rangeOptions = useMemo(() => {
    const options = [
      { value: 'last30', label: 'Last 30 days' },
      { value: 'last90', label: 'Last 90 days' },
      { value: 'last180', label: 'Last 180 days' },
      { value: 'last365', label: 'Last 365 days' },
      { value: 'lifetime', label: 'Lifetime (all available)' }
    ];

    if (globalDateRange) {
      options.unshift({ value: 'global', label: 'Use global period' });
    }

    return options;
  }, [globalDateRange]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ store: storeId });

    const applyGlobal = () => {
      if (!globalDateRange || typeof globalDateRange !== 'object') {
        params.set('days', '90');
        return;
      }

      if (globalDateRange.type === 'custom' && globalDateRange.start && globalDateRange.end) {
        params.set('startDate', globalDateRange.start);
        params.set('endDate', globalDateRange.end);
        return;
      }

      if (globalDateRange.type === 'yesterday') {
        params.set('yesterday', '1');
        return;
      }

      if (globalDateRange.type === 'days' && globalDateRange.value) {
        params.set('days', String(globalDateRange.value));
        return;
      }

      params.set('days', '90');
    };

    if (rangePreset === 'global') {
      applyGlobal();
    } else if (rangePreset === 'lifetime') {
      params.set('startDate', '2000-01-01');
      params.set('endDate', globalDateRange?.type === 'custom' && globalDateRange.end
        ? globalDateRange.end
        : getIstanbulDateString());
    } else {
      const mapping = {
        last30: 30,
        last90: 90,
        last180: 180,
        last365: 365
      };
      params.set('days', String(mapping[rangePreset] || 90));
    }

    return params.toString();
  }, [storeId, rangePreset, globalDateRange]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/meta-demographics?${queryString}`);
        const json = await response.json();
        if (!response.ok || json?.success === false) {
          throw new Error(json?.error || 'Failed to load Meta demographics.');
        }
        if (mounted) {
          setData(json.data || null);
        }
      } catch (err) {
        if (mounted) {
          setError(err?.message || 'Failed to load Meta demographics.');
          setData(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [queryString]);

  const countryMap = useMemo(() => {
    const map = new Map();
    COUNTRIES.forEach((country) => map.set(country.code, country.name));
    return map;
  }, []);

  const ageGender = data?.segments?.ageGender || [];
  const countryGender = data?.segments?.countryGender || [];
  const placementSegments = data?.segments?.placement || [];
  const deviceSegments = data?.segments?.device || [];
  const minClicks = data?.rules?.minClicks || 30;
  const countryActionsAvailable = data?.flags?.countryActionsAvailable !== false;
  const placementActionsAvailable = data?.flags?.placementActionsAvailable !== false;
  const deviceActionsAvailable = data?.flags?.deviceActionsAvailable !== false;
  const countryGenderSplitAvailable = data?.flags?.countryGenderSplitAvailable !== false;

  useEffect(() => {
    if (!countryGenderSplitAvailable && splitByGender) {
      setSplitByGender(false);
    }
  }, [countryGenderSplitAvailable, splitByGender]);

  const eligibleAgeSegments = useMemo(
    () => ageGender.filter((row) => row.eligible && Number.isFinite(row.atcRate)),
    [ageGender]
  );

  const topAtc = useMemo(() => {
    return [...eligibleAgeSegments].sort((a, b) => (b.atcRate || 0) - (a.atcRate || 0))[0] || null;
  }, [eligibleAgeSegments]);

  const topPurchase = useMemo(() => {
    return [...eligibleAgeSegments].sort((a, b) => (b.purchaseRate || 0) - (a.purchaseRate || 0))[0] || null;
  }, [eligibleAgeSegments]);

  const summaryCards = useMemo(() => {
    const totals = data?.totals || {};
    const formatCurrencySafe = (value) =>
      formatCurrency ? formatCurrency(value || 0, 0) : `$${Math.round(value || 0)}`;

    return [
      {
        label: 'Total spend',
        value: formatCurrencySafe(totals.spend || 0),
        hint: `${formatNumber(totals.impressions || 0)} impressions`
      },
      {
        label: 'Total clicks',
        value: formatNumber(totals.clicks || 0),
        hint: `ATC rate ${formatPercent(data?.totalsRates?.atcRate)}`
      },
      {
        label: 'Top ATC segment',
        value: topAtc ? formatSegmentLabel(topAtc) : '—',
        hint: topAtc ? formatPercent(topAtc.atcRate) : 'Not enough data'
      },
      {
        label: 'Top purchase segment',
        value: topPurchase ? formatSegmentLabel(topPurchase) : '—',
        hint: topPurchase ? formatPercent(topPurchase.purchaseRate) : 'Not enough data'
      }
    ];
  }, [data, formatCurrency, topAtc, topPurchase]);

  const bubbleData = useMemo(() => {
    return ageGender
      .filter((row) => row.eligible && Number.isFinite(row.spendShare) && Number.isFinite(row.atcRate))
      .map((row) => ({
        ...row,
        label: formatSegmentLabel(row),
        x: row.spendShare * 100,
        y: row.atcRate * 100,
        z: row.clicks
      }));
  }, [ageGender]);

  const bubbleMaxX = bubbleData.length ? Math.max(...bubbleData.map((row) => row.x)) : 0;
  const bubbleMaxY = bubbleData.length ? Math.max(...bubbleData.map((row) => row.y)) : 0;

  const ages = useMemo(() => {
    const set = new Set(ageGender.map((row) => row.age || 'unknown'));
    const ordered = AGE_ORDER.filter((age) => set.has(age));
    const extras = [...set].filter((age) => !AGE_ORDER.includes(age));
    return [...ordered, ...extras];
  }, [ageGender]);

  const genders = useMemo(() => {
    const set = new Set(ageGender.map((row) => row.gender || 'unknown'));
    const preferred = ['female', 'male', 'unknown'];
    return preferred.filter((gender) => set.has(gender));
  }, [ageGender]);

  const heatMatrix = useMemo(() => {
    const map = new Map();
    ageGender.forEach((row) => {
      map.set(`${row.age || 'unknown'}-${row.gender || 'unknown'}`, row);
    });
    return map;
  }, [ageGender]);

  const heatValues = useMemo(() => {
    const values = [];
    ageGender.forEach((row) => {
      if (row.eligible && Number.isFinite(row[heatMetric])) {
        values.push(row[heatMetric]);
      }
    });
    if (!values.length) return { min: null, max: null };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [ageGender, heatMetric]);

  const countryRows = useMemo(() => {
    if (!splitByGender) {
      const map = new Map();
      countryGender.forEach((row) => {
        const key = row.country || 'ALL';
        if (!map.has(key)) {
          map.set(key, {
            country: key,
            clicks: 0,
            spend: 0,
            atc: 0,
            checkout: 0,
            purchases: 0
          });
        }
        const entry = map.get(key);
        entry.clicks += row.clicks;
        entry.spend += row.spend;
        entry.atc += row.atc;
        entry.checkout += row.checkout;
        entry.purchases += row.purchases;
      });
      return [...map.values()]
        .map((row) => ({
          ...row,
          atcRate: row.clicks >= minClicks ? row.atc / row.clicks : null,
          purchaseRate: row.clicks >= minClicks ? row.purchases / row.clicks : null,
          eligible: row.clicks >= minClicks,
          gender: 'all'
        }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 16);
    }

    return [...countryGender]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 20)
      .map((row) => ({
        ...row,
        label: `${formatCountryName(row.country, countryMap)} · ${row.genderLabel}`
      }));
  }, [countryGender, minClicks, splitByGender, countryMap]);

  if (loading) {
    return <div className="text-sm text-gray-500">Loading Meta demographics…</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Range</div>
        <div className="flex items-center gap-3">
          <select
            value={rangePreset}
            onChange={(e) => setRangePreset(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 shadow-sm"
          >
            {rangeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="text-xs text-gray-400">
            Range: {data?.range?.startDate} → {data?.range?.endDate}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <SummaryCard key={card.label} {...card} />
        ))}
      </div>

      <KeyInsightsPanel insights={data?.keyInsights || []} />

      <details className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-gray-900">
          Statistical signals (z-score)
        </summary>
        <div className="mt-3">
          <div className="text-xs text-gray-500">
            Only segments with ≥ {minClicks} clicks and |z| ≥ {data?.rules?.zThreshold || 2} are shown.
          </div>
          <div className="mt-3">
            <KeyInsightsPanel
              insights={data?.insights || []}
              showTitle={false}
              emptyMessage="No statistically significant insights yet. Add more data or widen the date window."
            />
          </div>
        </div>
      </details>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-gray-900">Spend share vs ATC rate</div>
          <div className="text-xs text-gray-500">Bubble size scaled by clicks (age + gender segments).</div>
          <div className="mt-4 h-64">
            {bubbleData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <XAxis type="number" dataKey="x" name="Spend share" unit="%" domain={[0, Math.max(5, bubbleMaxX * 1.1)]} />
                  <YAxis type="number" dataKey="y" name="ATC rate" unit="%" domain={[0, Math.max(5, bubbleMaxY * 1.1)]} />
                  <ZAxis type="number" dataKey="z" range={[60, 300]} />
                  <Tooltip content={<BubbleTooltip />} />
                  <Scatter data={bubbleData}>
                    {bubbleData.map((entry) => (
                      <Cell key={entry.key} fill={GENDER_COLORS[entry.gender] || '#6366f1'} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                Not enough eligible segments to plot.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-gray-900">Funnel heatmap</div>
              <div className="text-xs text-gray-500">Rates by age and gender (min clicks {minClicks}).</div>
            </div>
            <div className="flex gap-2 text-xs">
              {HEAT_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setHeatMetric(option.key)}
                  className={`rounded-full px-3 py-1 border ${heatMetric === option.key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[420px] grid" style={{ gridTemplateColumns: `140px repeat(${genders.length}, minmax(90px, 1fr))` }}>
              <div className="text-xs font-semibold text-gray-400 uppercase">Age</div>
              {genders.map((gender) => (
                <div key={gender} className="text-xs font-semibold text-gray-400 uppercase text-center">
                  {gender}
                </div>
              ))}
              {ages.map((age) => (
                <div key={age} className="contents">
                  <div className="py-2 pr-2 text-xs text-gray-600 font-medium">
                    {age}
                  </div>
                  {genders.map((gender) => {
                    const row = heatMatrix.get(`${age}-${gender}`);
                    const value = row?.eligible ? row[heatMetric] : null;
                    const styles = heatColor(value, heatValues.min, heatValues.max);
                    return (
                      <div
                        key={`${age}-${gender}`}
                        className="m-1 rounded-lg px-2 py-2 text-center text-xs font-semibold"
                        style={styles}
                        title={row ? `${formatSegmentLabel(row)} • ${formatPercent(value)}` : 'No data'}
                      >
                        {row?.eligible ? formatPercent(value) : '—'}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-gray-900">Country breakdown</div>
            <div className="text-xs text-gray-500">Performance by country with optional gender split.</div>
          </div>
          <button
            type="button"
            onClick={() => setSplitByGender((prev) => !prev)}
            disabled={!countryGenderSplitAvailable}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              !countryGenderSplitAvailable
                ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                : (splitByGender ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600')
            }`}
            title={!countryGenderSplitAvailable ? 'Meta does not support country + gender breakdown for this account.' : undefined}
          >
            {!countryGenderSplitAvailable
              ? 'Gender split unavailable'
              : (splitByGender ? 'Gender split on' : 'Gender split off')}
          </button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-400">
                <th className="py-2">Segment</th>
                <th className="py-2 text-right">Spend</th>
                <th className="py-2 text-right">Clicks</th>
                <th className="py-2 text-right">ATC rate</th>
                <th className="py-2 text-right">Purchase rate</th>
              </tr>
            </thead>
            <tbody>
              {countryRows.map((row) => (
                <tr key={`${row.country}-${row.gender || 'all'}`} className="border-t border-gray-100">
                  <td className="py-2 text-gray-700">
                    {splitByGender
                      ? row.label
                      : formatCountryName(row.country, countryMap)}
                  </td>
                  <td className="py-2 text-right text-gray-700">
                    {formatCurrency ? formatCurrency(row.spend || 0, 0) : `$${Math.round(row.spend || 0)}`}
                  </td>
                  <td className="py-2 text-right text-gray-700">{formatNumber(row.clicks)}</td>
                  <td className="py-2 text-right text-gray-700">
                    {row.eligible && countryActionsAvailable ? formatPercent(row.atcRate) : '—'}
                  </td>
                  <td className="py-2 text-right text-gray-700">
                    {row.eligible && countryActionsAvailable ? formatPercent(row.purchaseRate) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 text-xs text-gray-400">
          Rates only computed for segments with ≥ {minClicks} clicks.
          {!countryActionsAvailable ? ' Meta API does not allow actions for this breakdown; rates are hidden.' : ''}
          {!countryGenderSplitAvailable ? ' Meta API does not support country + gender breakdown, so gender split is disabled.' : ''}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <div className="text-sm font-semibold text-gray-900">Placements</div>
            <div className="text-xs text-gray-500">Performance by publisher platform + placement position.</div>
          </div>
          {placementSegments.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-400">
                    <th className="py-2">Placement</th>
                    <th className="py-2 text-right">Spend share</th>
                    <th className="py-2 text-right">Spend</th>
                    <th className="py-2 text-right">Clicks</th>
                    <th className="py-2 text-right">Purchase rate</th>
                  </tr>
                </thead>
                <tbody>
                  {placementSegments.slice(0, 12).map((row) => (
                    <tr key={row.key} className="border-t border-gray-100">
                      <td className="py-2 text-gray-700">{formatPlacementLabel(row)}</td>
                      <td className="py-2 text-right text-gray-700">{formatPercent(row.spendShare)}</td>
                      <td className="py-2 text-right text-gray-700">
                        {formatCurrency ? formatCurrency(row.spend || 0, 0) : `$${Math.round(row.spend || 0)}`}
                      </td>
                      <td className="py-2 text-right text-gray-700">{formatNumber(row.clicks)}</td>
                      <td className="py-2 text-right text-gray-700">
                        {row.eligible && placementActionsAvailable ? formatPercent(row.purchaseRate) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
              No placement segments returned for this range.
            </div>
          )}
          <div className="mt-3 text-xs text-gray-400">
            Rates only computed for segments with ≥ {minClicks} clicks.
            {!placementActionsAvailable ? ' Meta API does not allow actions for this breakdown; rates are hidden.' : ''}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <div className="text-sm font-semibold text-gray-900">Devices</div>
            <div className="text-xs text-gray-500">Performance by device platform (mobile vs desktop).</div>
          </div>
          {deviceSegments.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-400">
                    <th className="py-2">Device</th>
                    <th className="py-2 text-right">Spend share</th>
                    <th className="py-2 text-right">Spend</th>
                    <th className="py-2 text-right">Clicks</th>
                    <th className="py-2 text-right">Purchase rate</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceSegments.map((row) => (
                    <tr key={row.key} className="border-t border-gray-100">
                      <td className="py-2 text-gray-700">{formatDeviceLabel(row)}</td>
                      <td className="py-2 text-right text-gray-700">{formatPercent(row.spendShare)}</td>
                      <td className="py-2 text-right text-gray-700">
                        {formatCurrency ? formatCurrency(row.spend || 0, 0) : `$${Math.round(row.spend || 0)}`}
                      </td>
                      <td className="py-2 text-right text-gray-700">{formatNumber(row.clicks)}</td>
                      <td className="py-2 text-right text-gray-700">
                        {row.eligible && deviceActionsAvailable ? formatPercent(row.purchaseRate) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
              No device segments returned for this range.
            </div>
          )}
          <div className="mt-3 text-xs text-gray-400">
            Rates only computed for segments with ≥ {minClicks} clicks.
            {!deviceActionsAvailable ? ' Meta API does not allow actions for this breakdown; rates are hidden.' : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
