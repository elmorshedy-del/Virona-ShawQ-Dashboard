import { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

const METRIC_CONFIGS = [
  { key: 'spend', label: 'Spend', format: 'currency', decimals: 0, sort: 'desc', color: '#4f46e5' },
  { key: 'revenue', label: 'Revenue', format: 'currency', decimals: 0, sort: 'desc', color: '#16a34a' },
  { key: 'orders', label: 'Orders', format: 'number', decimals: 0, sort: 'desc', color: '#22c55e' },
  { key: 'roas', label: 'ROAS', format: 'roas', decimals: 2, sort: 'desc', color: '#10b981' },
  { key: 'cac', label: 'CAC', format: 'currency', decimals: 0, sort: 'asc', color: '#f97316', note: 'Lower is better' },
  { key: 'ctr', label: 'CTR', format: 'percent', decimals: 2, sort: 'desc', color: '#38bdf8' },
  { key: 'cpc', label: 'CPC', format: 'currency', decimals: 2, sort: 'asc', color: '#f43f5e', note: 'Lower is better' },
  { key: 'cvr', label: 'CVR', format: 'percent', decimals: 2, sort: 'desc', color: '#22c55e' },
  { key: 'aov', label: 'AOV', format: 'currency', decimals: 0, sort: 'desc', color: '#8b5cf6' },
  { key: 'lpv', label: 'LPV', format: 'number', decimals: 0, sort: 'desc', color: '#64748b' },
  { key: 'atcRate', label: 'ATC Rate', format: 'percent', decimals: 2, sort: 'desc', color: '#f59e0b' }
];

const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + toNumber(item), 0);
  if (value && typeof value === 'object' && 'value' in value) return Number(value.value);
  return 0;
};

const safeDivide = (numerator, denominator) =>
  denominator > 0 ? numerator / denominator : null;

const truncateLabel = (value, max = 18) => {
  if (!value) return '';
  const str = String(value);
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}...`;
};

const formatMetricValue = (value, metric, formatCurrency, formatNumber) => {
  if (value == null || !Number.isFinite(Number(value))) return '-';
  if (metric.format === 'currency') return formatCurrency(value, metric.decimals ?? 0);
  if (metric.format === 'percent') return `${Number(value).toFixed(metric.decimals ?? 2)}%`;
  if (metric.format === 'roas') return `${Number(value).toFixed(metric.decimals ?? 2)}x`;
  if (metric.format === 'number') return formatNumber(value);
  return String(value);
};

export default function MetricsChartsTab({
  metaAdManagerData = [],
  dashboard = {},
  formatCurrency = () => '$0',
  formatNumber = () => '0',
  campaignScopeLabel = 'All Campaigns'
}) {
  const [dimension, setDimension] = useState('campaign');
  const [topN, setTopN] = useState(8);

  const campaignRows = useMemo(() => {
    if (!Array.isArray(metaAdManagerData)) return [];
    return metaAdManagerData.map((campaign) => {
      const spend = toNumber(campaign.spend);
      const revenue = toNumber(campaign.conversion_value ?? campaign.conversionValue ?? campaign.revenue);
      const orders = toNumber(campaign.conversions ?? campaign.purchases);
      const impressions = toNumber(campaign.impressions);
      const reach = toNumber(campaign.reach);
      const clicks = toNumber(campaign.inline_link_clicks ?? campaign.clicks);
      const lpv = toNumber(campaign.lpv ?? campaign.landing_page_views);
      const atc = toNumber(campaign.atc ?? campaign.add_to_cart);
      const checkout = toNumber(campaign.checkout ?? campaign.checkouts_initiated);
      const ctr = safeDivide(clicks, impressions) != null ? (clicks / impressions) * 100 : null;
      const cpc = safeDivide(spend, clicks);
      const cac = safeDivide(spend, orders);
      const roas = safeDivide(revenue, spend);
      const aov = safeDivide(revenue, orders);
      const cvr = safeDivide(orders, lpv) != null ? (orders / lpv) * 100 : null;
      const atcRate = safeDivide(atc, lpv) != null ? (atc / lpv) * 100 : null;
      const name = campaign.campaign_name || campaign.campaignName || campaign.name || 'Campaign';

      return {
        id: campaign.campaign_id || campaign.campaignId || name,
        label: name,
        fullLabel: name,
        spend,
        revenue,
        orders,
        roas,
        cac,
        ctr,
        cpc,
        cvr,
        aov,
        lpv,
        atcRate,
        impressions,
        reach,
        clicks,
        atc,
        checkout
      };
    });
  }, [metaAdManagerData]);

  const adRows = useMemo(() => {
    if (!Array.isArray(metaAdManagerData)) return [];
    const rows = [];
    metaAdManagerData.forEach((campaign) => {
      const campaignName = campaign.campaign_name || campaign.campaignName || campaign.name || 'Campaign';
      (campaign.adsets || []).forEach((adset) => {
        (adset.ads || []).forEach((ad) => {
          const spend = toNumber(ad.spend);
          const revenue = toNumber(ad.conversion_value ?? ad.purchase_value ?? ad.revenue);
          const orders = toNumber(ad.conversions ?? ad.purchases);
          const impressions = toNumber(ad.impressions);
          const reach = toNumber(ad.reach);
          const clicks = toNumber(ad.inline_link_clicks ?? ad.link_clicks ?? ad.clicks);
          const lpv = toNumber(ad.lpv ?? ad.landing_page_views);
          const atc = toNumber(ad.atc ?? ad.add_to_cart);
          const checkout = toNumber(ad.checkout ?? ad.checkouts_initiated);
          const ctr = safeDivide(clicks, impressions) != null ? (clicks / impressions) * 100 : null;
          const cpc = safeDivide(spend, clicks);
          const cac = safeDivide(spend, orders);
          const roas = safeDivide(revenue, spend);
          const aov = safeDivide(revenue, orders);
          const cvr = safeDivide(orders, lpv) != null ? (orders / lpv) * 100 : null;
          const atcRate = safeDivide(atc, lpv) != null ? (atc / lpv) * 100 : null;
          const name = ad.ad_name || ad.name || 'Ad';
          const fullLabel = campaignName ? `${name} - ${campaignName}` : name;

          rows.push({
            id: ad.ad_id || ad.id || `${campaignName}-${name}`,
            label: name,
            fullLabel,
            spend,
            revenue,
            orders,
            roas,
            cac,
            ctr,
            cpc,
            cvr,
            aov,
            lpv,
            atcRate,
            impressions,
            reach,
            clicks,
            atc,
            checkout
          });
        });
      });
    });
    return rows;
  }, [metaAdManagerData]);

  const countryRows = useMemo(() => {
    const metaHasCountries = metaAdManagerData.some(
      (campaign) => Array.isArray(campaign.country_breakdowns) && campaign.country_breakdowns.length > 0
    );

    if (metaHasCountries) {
      const countryMap = new Map();
      metaAdManagerData.forEach((campaign) => {
        (campaign.country_breakdowns || []).forEach((entry) => {
          const code = entry.country || entry.countryCode || entry.country_name || 'Other';
          const name = entry.countryName || entry.country_name || code;
          if (!countryMap.has(code)) {
            countryMap.set(code, {
              id: code,
              label: name,
              fullLabel: `${name} (${code})`,
              spend: 0,
              revenue: 0,
              orders: 0,
              impressions: 0,
              reach: 0,
              clicks: 0,
              lpv: 0,
              atc: 0,
              checkout: 0
            });
          }
          const row = countryMap.get(code);
          row.spend += toNumber(entry.spend);
          row.revenue += toNumber(entry.conversion_value ?? entry.conversionValue ?? entry.revenue);
          row.orders += toNumber(entry.conversions ?? entry.purchases);
          row.impressions += toNumber(entry.impressions);
          row.reach += toNumber(entry.reach);
          row.clicks += toNumber(entry.inline_link_clicks ?? entry.clicks);
          row.lpv += toNumber(entry.lpv ?? entry.landing_page_views);
          row.atc += toNumber(entry.atc ?? entry.add_to_cart);
          row.checkout += toNumber(entry.checkout ?? entry.checkouts_initiated);
        });
      });

      return Array.from(countryMap.values()).map((row) => {
        const ctr = safeDivide(row.clicks, row.impressions) != null ? (row.clicks / row.impressions) * 100 : null;
        const cpc = safeDivide(row.spend, row.clicks);
        const cac = safeDivide(row.spend, row.orders);
        const roas = safeDivide(row.revenue, row.spend);
        const aov = safeDivide(row.revenue, row.orders);
        const cvr = safeDivide(row.orders, row.lpv) != null ? (row.orders / row.lpv) * 100 : null;
        const atcRate = safeDivide(row.atc, row.lpv) != null ? (row.atc / row.lpv) * 100 : null;
        return {
          ...row,
          ctr,
          cpc,
          cac,
          roas,
          aov,
          cvr,
          atcRate
        };
      });
    }

    const fallbackCountries = Array.isArray(dashboard?.countries) ? dashboard.countries : [];
    return fallbackCountries.map((country) => ({
      id: country.code || country.country || country.name || 'Country',
      label: country.name || country.country || country.code || 'Country',
      fullLabel: `${country.name || country.country || country.code || 'Country'} (${country.code || 'N/A'})`,
      spend: toNumber(country.spend),
      revenue: toNumber(country.revenue),
      orders: toNumber(country.totalOrders ?? country.orders),
      roas: toNumber(country.roas),
      cac: toNumber(country.cac),
      aov: toNumber(country.aov),
      ctr: null,
      cpc: null,
      cvr: null,
      lpv: null,
      atcRate: null
    }));
  }, [dashboard?.countries, metaAdManagerData]);

  const dimensionRows = useMemo(() => {
    if (dimension === 'ad') return adRows;
    if (dimension === 'country') return countryRows;
    return campaignRows;
  }, [adRows, campaignRows, countryRows, dimension]);

  const dimensionLabel = dimension === 'ad'
    ? 'ads'
    : dimension === 'country'
      ? 'countries'
      : 'campaigns';

  const totals = useMemo(() => {
    const rows = campaignRows;
    const spend = rows.reduce((sum, row) => sum + (row.spend || 0), 0);
    const revenue = rows.reduce((sum, row) => sum + (row.revenue || 0), 0);
    const orders = rows.reduce((sum, row) => sum + (row.orders || 0), 0);
    const impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
    const clicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
    return {
      spend,
      revenue,
      orders,
      roas: safeDivide(revenue, spend),
      cac: safeDivide(spend, orders),
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null
    };
  }, [campaignRows]);

  const metricCharts = useMemo(() => {
    return METRIC_CONFIGS.map((metric) => {
      const validRows = dimensionRows.filter((row) => Number.isFinite(row[metric.key]));
      if (validRows.length === 0) {
        return { metric, data: [] };
      }

      const sorted = [...validRows].sort((a, b) => {
        const aVal = Number(a[metric.key]) || 0;
        const bVal = Number(b[metric.key]) || 0;
        return metric.sort === 'asc' ? aVal - bVal : bVal - aVal;
      });

      const data = sorted.slice(0, topN).map((row) => ({
        name: truncateLabel(row.label),
        fullLabel: row.fullLabel || row.label,
        value: row[metric.key]
      }));

      return { metric, data };
    });
  }, [dimensionRows, topN]);

  const renderTooltip = (metric) => ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const item = payload[0]?.payload;
    if (!item) return null;
    return (
      <div className="rounded-lg border border-gray-100 bg-white p-2 shadow-md">
        <div className="text-xs text-gray-500">{item.fullLabel}</div>
        <div className="text-sm font-semibold text-gray-900">
          {metric.label}: {formatMetricValue(item.value, metric, formatCurrency, formatNumber)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Metrics Charts</h2>
          <p className="text-sm text-gray-500">
            Compare campaigns, countries, and ads side-by-side with clean benchmarks.
          </p>
        </div>
        <div className="text-xs text-gray-600 bg-white border border-gray-100 px-3 py-1 rounded-full">
          Scope: <span className="font-semibold text-gray-900">{campaignScopeLabel}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Spend', value: totals.spend, format: 'currency', decimals: 0 },
          { label: 'Total Revenue', value: totals.revenue, format: 'currency', decimals: 0 },
          { label: 'Total Orders', value: totals.orders, format: 'number', decimals: 0 },
          { label: 'ROAS', value: totals.roas, format: 'roas', decimals: 2 },
          { label: 'CTR', value: totals.ctr, format: 'percent', decimals: 2 }
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="text-xs uppercase tracking-wide text-gray-500">{card.label}</div>
            <div className="text-lg font-semibold text-gray-900 mt-1">
              {formatMetricValue(card.value, card, formatCurrency, formatNumber)}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {[
              { key: 'campaign', label: 'Campaigns' },
              { key: 'country', label: 'Countries' },
              { key: 'ad', label: 'Ads' }
            ].map((option) => (
              <button
                key={option.key}
                onClick={() => setDimension(option.key)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  dimension === option.key
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Top rows:</span>
            <select
              value={topN}
              onChange={(event) => setTopN(Number(event.target.value) || 8)}
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 bg-white"
            >
              {[5, 8, 12, 15].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>
        {dimension === 'country' && countryRows.length > 0 && !metaAdManagerData.some(
          (campaign) => Array.isArray(campaign.country_breakdowns) && campaign.country_breakdowns.length > 0
        ) && (
          <div className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Country charts are using ecommerce data because Meta country breakdowns are unavailable.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {metricCharts.map(({ metric, data }) => (
          <div key={metric.key} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{metric.label}</div>
                <div className="text-xs text-gray-500">
                  {metric.sort === 'asc' ? 'Lowest' : 'Top'} {Math.min(topN, dimensionRows.length)} {dimensionLabel}
                </div>
              </div>
              {metric.note && (
                <span className="text-[11px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                  {metric.note}
                </span>
              )}
            </div>
            {data.length === 0 ? (
              <div className="text-sm text-gray-500 mt-4">No data for this metric.</div>
            ) : (
              <div className="h-56 mt-4">
                <ResponsiveContainer>
                  <BarChart data={data} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10 }}
                      tickFormatter={(value) => formatMetricValue(value, metric, formatCurrency, formatNumber)}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={90}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip content={renderTooltip(metric)} />
                    <Bar dataKey="value" fill={metric.color} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
