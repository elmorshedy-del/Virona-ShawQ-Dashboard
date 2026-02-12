// client/src/components/FatigueDetector.jsx
// Creative Fatigue & Audience Saturation Detector
// Premium SaaS UI with educational tooltips and visual-first analysis

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Scatter, ReferenceLine, ComposedChart, Bar, Area
} from 'recharts';
import {
  AlertTriangle, CheckCircle, TrendingDown, TrendingUp, Minus,
  Info, ChevronDown, ChevronUp, ChevronRight, HelpCircle, Zap, Users, Eye,
  RefreshCw, ExternalLink, BookOpen
} from 'lucide-react';

const API_BASE = '/api';

// ============================================================================
// STATUS CONFIGURATIONS
// ============================================================================

const STATUS_CONFIG = {
  healthy: {
    color: 'emerald',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    textColor: 'text-emerald-700',
    iconColor: 'text-emerald-500',
    icon: CheckCircle,
    label: 'Healthy',
    dotColor: 'bg-emerald-500'
  },
  warning: {
    color: 'amber',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    textColor: 'text-amber-700',
    iconColor: 'text-amber-500',
    icon: AlertTriangle,
    label: 'Warning',
    dotColor: 'bg-amber-500'
  },
  fatigued: {
    color: 'rose',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
    textColor: 'text-rose-700',
    iconColor: 'text-rose-500',
    icon: TrendingDown,
    label: 'Creative Fatigue',
    dotColor: 'bg-rose-500'
  },
  saturated: {
    color: 'purple',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    textColor: 'text-purple-700',
    iconColor: 'text-purple-500',
    icon: Users,
    label: 'Audience Saturation',
    dotColor: 'bg-purple-500'
  }
};

const CAMPAIGN_STATUS_CONFIG = {
  ACTIVE: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Active' },
  PAUSED: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Paused' },
  ARCHIVED: { bg: 'bg-gray-200', text: 'text-gray-700', label: 'Archived' },
  UNKNOWN: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Unknown' }
};

const ADSET_STATUS_PRIORITY = {
  saturated: 0,
  fatigued: 1,
  warning: 2,
  healthy: 3
};
const AD_OVERLAY_CHART_METRICS = [
  { key: 'cvr', label: 'CVR', color: '#7c3aed', axis: 'rate', renderAs: 'line', suffix: '%' },
  { key: 'conversions', label: 'Orders', color: '#f97316', axis: 'volume', renderAs: 'line' },
  { key: 'impressions', label: 'Impressions', color: '#10b981', axis: 'volume', renderAs: 'area' }
];
const DEFAULT_AD_OVERLAY_CHART_KEYS = AD_OVERLAY_CHART_METRICS.map((metric) => metric.key);
const AD_WIDE_CHART_HEIGHT_CLASS = 'h-[30rem]';

function normalizeCampaignStatus(status) {
  if (!status || typeof status !== 'string') return 'UNKNOWN';
  const value = status.toUpperCase();
  return CAMPAIGN_STATUS_CONFIG[value] ? value : 'UNKNOWN';
}

// ============================================================================
// EDUCATIONAL CONTENT
// ============================================================================

const EDUCATIONAL_CONTENT = {
  correlation: {
    title: 'Understanding Correlation (r)',
    content: `The correlation coefficient (r) measures how two variables move together.

• r = -1.0: Perfect negative correlation (as one goes up, the other goes down)
• r = 0: No relationship
• r = +1.0: Perfect positive correlation (they move together)

For fatigue detection, we track frequency against Link CTR (link clicks / impressions).

Why this matters:
• If frequency rises while Link CTR falls, the same audience is seeing the ad too often.
• Strong negative r with p < 0.05 means this is likely real fatigue, not random noise.
• Weak or non-significant correlation means look at other drivers (targeting, offer, seasonality).`
  },
  pValue: {
    title: 'What is a p-value?',
    content: `The p-value tells you the probability that the pattern you're seeing happened by random chance.

• p < 0.01: Very strong evidence (less than 1% chance it's random)
• p < 0.05: Strong evidence (less than 5% chance)
• p > 0.05: Not statistically significant

We use p < 0.05 as our threshold. Below this, we're confident the pattern is real.`
  },
  fatigue: {
    title: 'Creative Fatigue vs Audience Saturation',
    content: `These are two different problems with different solutions:

CREATIVE FATIGUE
• Cause: People are tired of seeing THIS specific ad
• Signal: One ad declines while others in the same ad set stay healthy
• Solution: Refresh that specific creative

AUDIENCE SATURATION
• Cause: You've reached everyone likely to buy in this audience
• Signal: ALL ads decline together, new reach % drops
• Solution: Expand audience or reduce budget

This tool distinguishes between them by comparing ads within the same ad set.`
  },
  newReach: {
    title: 'New Reach Percentage',
    content: `New Reach % = (Unique Reach / Total Impressions) × 100

This tells you what percentage of your impressions are going to people seeing your ad for the first time.

• 40%+ : Healthy - lots of new people
• 20-40%: Moderate - audience getting familiar
• <20%: Low - mostly repeat views, saturation risk

When new reach drops while performance drops, it's a strong saturation signal.`
  }
};

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function InfoTooltip({ contentKey }) {
  const [isOpen, setIsOpen] = useState(false);
  const content = EDUCATIONAL_CONTENT[contentKey];

  if (!content) return null;

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="ml-1 p-0.5 rounded-full hover:bg-gray-100 transition-colors"
      >
        <HelpCircle className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-50 w-80 p-4 bg-white rounded-lg shadow-xl border border-gray-200 left-0 top-6 animate-fadeIn">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold text-gray-900 text-sm">{content.title}</h4>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-gray-600 whitespace-pre-line leading-relaxed">
              {content.content}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status, size = 'md' }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.healthy;
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5'
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bgColor} ${config.textColor} ${sizeClasses[size]}`}>
      <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
      {config.label}
    </span>
  );
}

function CampaignStatusBadge({ status }) {
  const normalizedStatus = normalizeCampaignStatus(status);
  const config = CAMPAIGN_STATUS_CONFIG[normalizedStatus];
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

function TrendIndicator({ direction, value, suffix = '%' }) {
  const configs = {
    rising: { icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    falling: { icon: TrendingDown, color: 'text-rose-600', bg: 'bg-rose-50' },
    stable: { icon: Minus, color: 'text-gray-500', bg: 'bg-gray-50' }
  };

  const config = configs[direction] || configs.stable;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${config.bg} ${config.color} text-xs font-medium`}>
      <Icon className="w-3 h-3" />
      {value !== undefined && `${value > 0 ? '+' : ''}${value}${suffix}`}
    </span>
  );
}

function MetricCard({ label, value, subValue, trend, info }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center">
          {label}
          {info && <InfoTooltip contentKey={info} />}
        </span>
        {trend && <TrendIndicator direction={trend.direction} value={trend.change} />}
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {subValue && <div className="text-xs text-gray-500 mt-1">{subValue}</div>}
    </div>
  );
}

function ConfidenceBadge({ level }) {
  const configs = {
    high: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'High Confidence' },
    medium: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Medium Confidence' },
    low: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Low Confidence' }
  };

  const config = configs[level] || configs.medium;

  return (
    <span className={`text-xs px-2 py-0.5 rounded ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

// ============================================================================
// CHART COMPONENTS
// ============================================================================

function MultiLineChart({ ads, metric = 'ctr', title }) {
  // Prepare data for all ads on same chart
  const allDates = new Set();
  ads.forEach(ad => ad.daily.forEach(d => allDates.add(d.date)));
  const sortedDates = Array.from(allDates).sort();

  const chartData = sortedDates.map(date => {
    const point = { date };
    ads.forEach((ad, i) => {
      const dayData = ad.daily.find(d => d.date === date);
      point[`ad${i}`] = dayData ? dayData[metric] : null;
    });
    return point;
  });

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h4 className="text-sm font-medium text-gray-700 mb-3">{title}</h4>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} syncId="fatigue-sync">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(val) => val.slice(5)}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(val) => `${val.toFixed(1)}%`}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(value, name) => {
                const adIndex = parseInt(name.replace('ad', ''));
                const adName = ads[adIndex]?.ad_name || `Ad ${adIndex + 1}`;
                return [value ? `${value.toFixed(2)}%` : 'N/A', adName];
              }}
              labelFormatter={(label) => label}
            />
            {ads.map((ad, i) => (
              <Line
                key={ad.ad_id}
                type="monotone"
                dataKey={`ad${i}`}
                stroke={colors[i % colors.length]}
                strokeWidth={ad.status === 'fatigued' || ad.status === 'saturated' ? 3 : 2}
                strokeOpacity={ad.status === 'healthy' ? 0.6 : 1}
                dot={{ r: 2 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap justify-center gap-4 mt-3">
        {ads.map((ad, i) => (
          <div key={ad.ad_id} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: colors[i % colors.length] }}
            />
            <span className={ad.status === 'fatigued' ? 'font-semibold text-rose-700' : 'text-gray-600'}>
              {ad.ad_name?.slice(0, 20) || `Ad ${i + 1}`}
              {ad.ad_name?.length > 20 && '...'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdCtrFrequencyOverlayChart({ ad }) {
  const [enabledOverlayKeys, setEnabledOverlayKeys] = useState(() => new Set(DEFAULT_AD_OVERLAY_CHART_KEYS));

  useEffect(() => {
    setEnabledOverlayKeys(new Set(DEFAULT_AD_OVERLAY_CHART_KEYS));
  }, [ad?.ad_id]);

  const overlayMetricsByKey = useMemo(
    () => new Map(AD_OVERLAY_CHART_METRICS.map((metric) => [metric.key, metric])),
    []
  );

  const toggleOverlay = (metricKey) => {
    setEnabledOverlayKeys((previous) => {
      const next = new Set(previous);
      if (next.has(metricKey)) {
        next.delete(metricKey);
      } else {
        next.add(metricKey);
      }
      return next;
    });
  };

  const formatVolume = (value) => {
    if (!Number.isFinite(value)) return '0';
    if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return `${Math.round(value)}`;
  };
  const formatPercent = (value) => `${(Number(value) || 0).toFixed(2)}%`;
  const formatFrequency = (value) => (Number.isFinite(value) ? Number(value).toFixed(2) : '0.00');
  const hasVolumeOverlay = AD_OVERLAY_CHART_METRICS.some(
    (metric) => metric.axis === 'volume' && enabledOverlayKeys.has(metric.key)
  );

  const hasData = Array.isArray(ad?.daily) && ad.daily.length > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">Link CTR vs Frequency (Wide View)</h4>
          <p className="text-xs text-gray-500">Core fatigue trend with optional overlays for CVR, orders, and impressions.</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {AD_OVERLAY_CHART_METRICS.map((metric) => {
            const isEnabled = enabledOverlayKeys.has(metric.key);
            return (
              <button
                key={metric.key}
                onClick={() => toggleOverlay(metric.key)}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  isEnabled
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {metric.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={AD_WIDE_CHART_HEIGHT_CLASS}>
        {!hasData ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
            No performance rows for this ad in the selected date range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={ad.daily} syncId="fatigue-sync" margin={{ top: 8, right: 20, left: 4, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(value) => value?.slice(5)} />
              <YAxis
                yAxisId="rate"
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `${(Number(value) || 0).toFixed(1)}%`}
                width={56}
              />
              <YAxis
                yAxisId="frequency"
                orientation="right"
                tick={{ fontSize: 10 }}
                tickFormatter={formatFrequency}
                width={58}
              />
              {hasVolumeOverlay && (
                <YAxis
                  yAxisId="volume"
                  hide
                  domain={['auto', 'auto']}
                />
              )}
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value, key) => {
                  if (key === 'ctr') return [formatPercent(value), 'Link CTR'];
                  if (key === 'frequency') return [formatFrequency(Number(value)), 'Frequency'];
                  const metric = overlayMetricsByKey.get(key);
                  if (!metric) return [value, key];
                  if (metric.suffix === '%') return [formatPercent(value), metric.label];
                  return [formatVolume(Number(value)), metric.label];
                }}
                labelFormatter={(value) => `Date: ${value}`}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="ctr"
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={false}
                name="Link CTR"
                connectNulls
              />
              <Line
                yAxisId="frequency"
                type="monotone"
                dataKey="frequency"
                stroke="#f59e0b"
                strokeWidth={2.2}
                strokeDasharray="5 4"
                dot={false}
                name="Frequency"
                connectNulls
              />
              {AD_OVERLAY_CHART_METRICS.map((metric) => {
                if (!enabledOverlayKeys.has(metric.key)) return null;
                if (metric.renderAs === 'area') {
                  return (
                    <Area
                      key={metric.key}
                      yAxisId={metric.axis}
                      type="monotone"
                      dataKey={metric.key}
                      stroke={metric.color}
                      fill={metric.color}
                      fillOpacity={0.16}
                      strokeWidth={1.6}
                      connectNulls
                    />
                  );
                }
                return (
                  <Line
                    key={metric.key}
                    yAxisId={metric.axis}
                    type="monotone"
                    dataKey={metric.key}
                    stroke={metric.color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function CorrelationScatter({ daily, correlation }) {
  const data = daily.map(d => ({
    frequency: d.frequency,
    ctr: d.ctr,
    date: d.date
  }));

  // Calculate trend line
  const frequencies = data.map(d => d.frequency);
  const ctrs = data.map(d => d.ctr);
  const minFreq = Math.min(...frequencies);
  const maxFreq = Math.max(...frequencies);

  // Simple linear regression for trend line
  const n = frequencies.length;
  const sumX = frequencies.reduce((a, b) => a + b, 0);
  const sumY = ctrs.reduce((a, b) => a + b, 0);
  const sumXY = frequencies.reduce((acc, x, i) => acc + x * ctrs[i], 0);
  const sumX2 = frequencies.reduce((acc, x) => acc + x * x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const trendData = [
    { frequency: minFreq, trend: slope * minFreq + intercept },
    { frequency: maxFreq, trend: slope * maxFreq + intercept }
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-700">Frequency vs Link CTR Correlation</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">r = {correlation.frequencyCtr.r}</span>
          <InfoTooltip contentKey="correlation" />
        </div>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="frequency"
              type="number"
              tick={{ fontSize: 10 }}
              tickFormatter={(val) => val.toFixed(1)}
              label={{ value: 'Frequency', position: 'bottom', fontSize: 10, offset: -5 }}
              domain={['auto', 'auto']}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(val) => `${val.toFixed(1)}%`}
              label={{ value: 'Link CTR', angle: -90, position: 'insideLeft', fontSize: 10 }}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(value, name) => [
                name === 'ctr' ? `${value.toFixed(2)}%` : value.toFixed(2),
                name === 'ctr' ? 'Link CTR' : 'Frequency'
              ]}
            />
            <Scatter
              dataKey="ctr"
              fill="#3b82f6"
              fillOpacity={0.7}
            />
            <Line
              data={trendData}
              type="linear"
              dataKey="trend"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
        <strong>Pattern:</strong> {correlation.frequencyCtr.r < -0.5
          ? 'Strong negative correlation — as frequency rises, Link CTR falls. This is a high-confidence fatigue signal.'
          : correlation.frequencyCtr.r < -0.3
          ? 'Moderate negative correlation — Link CTR may be softening from repeat exposure.'
          : 'No significant correlation — fatigue is not strongly explained by frequency yet.'}
      </div>
    </div>
  );
}

function NewReachChart({ ads }) {
  // Get weekly averages of new reach
  const weeklyData = [];
  const allDates = new Set();
  ads.forEach(ad => ad.daily.forEach(d => allDates.add(d.date)));
  const sortedDates = Array.from(allDates).sort();

  // Group by week
  let weekNum = 1;
  for (let i = 0; i < sortedDates.length; i += 7) {
    const weekDates = sortedDates.slice(i, i + 7);
    let totalReach = 0;
    let count = 0;

    ads.forEach(ad => {
      weekDates.forEach(date => {
        const dayData = ad.daily.find(d => d.date === date);
        if (dayData) {
          totalReach += dayData.newReachPct;
          count++;
        }
      });
    });

    if (count > 0) {
      weeklyData.push({
        week: `W${weekNum}`,
        newReachPct: totalReach / count
      });
      weekNum++;
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-700">New Reach % Over Time</h4>
        <InfoTooltip contentKey="newReach" />
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={weeklyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="week" tick={{ fontSize: 10 }} />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(val) => `${val.toFixed(0)}%`}
              domain={[0, 'auto']}
            />
            <Tooltip
              formatter={(value) => [`${value.toFixed(1)}%`, 'New Reach']}
            />
            <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="3 3" />
            <Bar dataKey="newReachPct" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs text-gray-500 mt-2 text-center">
        Below 20% (red line) indicates audience exhaustion
      </div>
    </div>
  );
}

// ============================================================================
// MAIN SECTIONS
// ============================================================================

function HowToUseGuide({ isOpen, onToggle }) {
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 mb-6 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <BookOpen className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">How to Use This Tool</h3>
            <p className="text-sm text-gray-600">Learn to distinguish creative fatigue from audience saturation</p>
          </div>
        </div>
        {isOpen ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
      </button>

      {isOpen && (
        <div className="px-6 pb-6 space-y-6 animate-fadeIn">
          <div className="grid md:grid-cols-2 gap-6">
            {/* What This Tool Does */}
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                What This Tool Does
              </h4>
              <p className="text-sm text-gray-600 mb-3">
                When ad performance drops, you need to know <strong>why</strong> before you can fix it.
                This tool uses statistical analysis to distinguish between two different problems:
              </p>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <div className="w-2 h-2 rounded-full bg-rose-500 mt-1.5 flex-shrink-0"></div>
                  <div>
                    <strong className="text-rose-700">Creative Fatigue:</strong>
                    <span className="text-gray-600 text-sm"> People are tired of THIS specific ad</span>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500 mt-1.5 flex-shrink-0"></div>
                  <div>
                    <strong className="text-purple-700">Audience Saturation:</strong>
                    <span className="text-gray-600 text-sm"> You've reached everyone likely to buy</span>
                  </div>
                </div>
              </div>
            </div>

            {/* How To Read The Results */}
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-500" />
                How To Read The Results
              </h4>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">1</span>
                  <span className="text-gray-600">Select a campaign, then pick an ad set from the left hierarchy</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">2</span>
                  <span className="text-gray-600">Look at the chart: Do all lines fall together, or just one?</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">3</span>
                  <span className="text-gray-600">Check the diagnosis box for actionable recommendation</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">4</span>
                  <span className="text-gray-600">Click any ad for detailed statistical breakdown</span>
                </div>
              </div>
            </div>
          </div>

          {/* Visual Guide */}
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <h4 className="font-semibold text-gray-900 mb-4">Visual Pattern Guide</h4>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border border-rose-200 rounded-lg p-3 bg-rose-50/50">
                <div className="text-sm font-medium text-rose-800 mb-2">Creative Fatigue Pattern</div>
                <div className="h-20 flex items-end gap-1 mb-2">
                  {/* Simulated chart showing one line down, others flat */}
                  <div className="flex-1 flex flex-col justify-end">
                    <div className="h-12 border-t-2 border-emerald-400"></div>
                  </div>
                  <div className="flex-1 flex flex-col justify-end">
                    <div className="h-10 border-t-2 border-emerald-400"></div>
                  </div>
                  <div className="flex-1 flex flex-col justify-end">
                    <div className="h-4 border-t-2 border-rose-500 border-dashed"></div>
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  <strong>One ad drops</strong> while others stay stable → Refresh that creative
                </div>
              </div>

              <div className="border border-purple-200 rounded-lg p-3 bg-purple-50/50">
                <div className="text-sm font-medium text-purple-800 mb-2">Audience Saturation Pattern</div>
                <div className="h-20 flex items-end gap-1 mb-2">
                  {/* Simulated chart showing all lines down together */}
                  <div className="flex-1 flex flex-col justify-end">
                    <div className="h-4 border-t-2 border-purple-500"></div>
                  </div>
                  <div className="flex-1 flex flex-col justify-end">
                    <div className="h-5 border-t-2 border-purple-500"></div>
                  </div>
                  <div className="flex-1 flex flex-col justify-end">
                    <div className="h-3 border-t-2 border-purple-500"></div>
                  </div>
                </div>
                <div className="text-xs text-gray-600">
                  <strong>All ads drop together</strong> → Expand audience or reduce spend
                </div>
              </div>
            </div>
          </div>

          {/* Statistical Rigor Note */}
          <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
            <strong className="text-gray-900">Statistical Rigor:</strong> This tool uses Pearson correlation (r) with
            p-value significance testing at the 0.05 level. Results marked "High Confidence" have p &lt; 0.01.
            Click the <HelpCircle className="w-3 h-3 inline text-gray-400" /> icons throughout for detailed explanations.
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCards({ summary }) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
        <div className="text-3xl font-bold text-gray-900">{summary.total}</div>
        <div className="text-sm text-gray-500">Ad Sets Analyzed</div>
      </div>
      <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 text-center">
        <div className="text-3xl font-bold text-emerald-600">{summary.healthy}</div>
        <div className="text-sm text-emerald-700">Healthy</div>
      </div>
      <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 text-center">
        <div className="text-3xl font-bold text-amber-600">{summary.warning}</div>
        <div className="text-sm text-amber-700">Warning</div>
      </div>
      <div className="bg-rose-50 rounded-xl border border-rose-200 p-4 text-center">
        <div className="text-3xl font-bold text-rose-600">{summary.fatigued + summary.saturated}</div>
        <div className="text-sm text-rose-700">Needs Action</div>
      </div>
    </div>
  );
}

function AdSetListItem({ adSet, isSelected, onClick }) {
  const config = STATUS_CONFIG[adSet.status];

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-all ${
        isSelected
          ? `${config.bgColor} ${config.borderColor} ring-2 ring-${config.color}-300`
          : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-gray-900 truncate pr-2">
          {adSet.adset_name || 'Unnamed Ad Set'}
        </span>
        <div className={`w-2.5 h-2.5 rounded-full ${config.dotColor}`}></div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{adSet.ads.length} ads</span>
        <StatusBadge status={adSet.status} size="sm" />
      </div>
    </button>
  );
}

function CampaignGroup({
  campaign,
  isExpanded,
  onToggle,
  selectedAdSetId,
  onSelectAdSet
}) {
  const campaignKey = campaign.campaign_id || campaign.campaign_name || 'unknown-campaign';

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 rounded-t-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          )}
          <span className="text-sm font-semibold text-gray-900 truncate" title={campaign.campaign_name || 'Unnamed Campaign'}>
            {campaign.campaign_name || 'Unnamed Campaign'}
          </span>
        </div>
        <CampaignStatusBadge status={campaign.effective_status} />
      </button>

      <div className="px-3 pb-2 text-xs text-gray-500">
        {campaign.adSets.length} ad set{campaign.adSets.length === 1 ? '' : 's'}
      </div>

      {isExpanded && (
        <div className="px-2 pb-2 space-y-2">
          {campaign.adSets.map((adSet) => (
            <AdSetListItem
              key={`${campaignKey}:${adSet.adset_id}`}
              adSet={adSet}
              isSelected={selectedAdSetId === adSet.adset_id}
              onClick={() => onSelectAdSet(adSet.adset_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AdDetailPanel({ adSet, selectedAd, onSelectAd }) {
  if (!adSet) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
        <div className="text-center p-8">
          <Eye className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Select a campaign and ad set to see analysis</p>
        </div>
      </div>
    );
  }

  const config = STATUS_CONFIG[adSet.status];
  const ad = selectedAd || adSet.ads.find((item) => Array.isArray(item.daily) && item.daily.length > 0) || adSet.ads[0];

  return (
    <div className="flex-1 space-y-4 overflow-y-auto">
      {/* Diagnosis Header */}
      <div className={`rounded-xl border-2 ${config.borderColor} ${config.bgColor} p-5`}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <StatusBadge status={adSet.status} size="lg" />
            <h3 className="text-lg font-semibold text-gray-900 mt-2">{adSet.adset_name}</h3>
          </div>
          <ConfidenceBadge level={adSet.confidence} />
        </div>
        <p className={`text-sm ${config.textColor}`}>{adSet.recommendation}</p>

        {/* Saturation Metrics */}
        {adSet.status === 'saturated' && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="bg-white/60 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-purple-700">{adSet.saturation.declineRatio}%</div>
              <div className="text-xs text-gray-600">Ads Declining</div>
            </div>
            <div className="bg-white/60 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-purple-700">{adSet.saturation.crossCorrelation}</div>
              <div className="text-xs text-gray-600">Sync Score</div>
            </div>
            <div className="bg-white/60 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-purple-700">{adSet.saturation.avgNewReachPct}%</div>
              <div className="text-xs text-gray-600">Avg New Reach</div>
            </div>
          </div>
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* All Ads Link CTR Chart */}
        <MultiLineChart
          ads={adSet.ads}
          metric="ctr"
          title="Link CTR Over Time — All Ads in This Ad Set"
        />

        {/* Frequency Chart */}
        <MultiLineChart
          ads={adSet.ads}
          metric="frequency"
          title="Frequency Over Time"
        />
      </div>

      {/* Individual Ad Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h4 className="font-semibold text-gray-900 mb-3">Individual Ad Analysis</h4>

        {/* Ad Selector */}
        <div className="flex flex-wrap gap-2 mb-4">
          {adSet.ads.map((adItem, i) => {
            const adConfig = STATUS_CONFIG[adItem.status];
            const isActive = ad?.ad_id === adItem.ad_id;
            return (
              <button
                key={adItem.ad_id}
                onClick={() => onSelectAd(adItem)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? `${adConfig.bgColor} ${adConfig.textColor} ring-2 ring-${adConfig.color}-300`
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <span className={`inline-block w-2 h-2 rounded-full mr-2 ${adConfig.dotColor}`}></span>
                {adItem.ad_name?.slice(0, 25) || `Ad ${i + 1}`}
                {adItem.ad_name?.length > 25 && '...'}
                {(!Array.isArray(adItem.daily) || adItem.daily.length === 0) && ' (no range data)'}
              </button>
            );
          })}
        </div>

        {/* Selected Ad Details */}
        {ad && (
          <div className="space-y-4">
            {/* Metrics Row */}
            <div className="grid grid-cols-4 gap-3">
              <MetricCard
                label="Current Link CTR"
                value={`${ad.metrics.currentCtr}%`}
                trend={ad.trends.ctr}
              />
              <MetricCard
                label="Frequency"
                value={ad.metrics.currentFrequency}
                trend={ad.trends.frequency}
              />
              <MetricCard
                label="New Reach"
                value={`${ad.metrics.currentNewReachPct}%`}
                trend={ad.trends.newReach}
                info="newReach"
              />
              <MetricCard
                label="Correlation (r)"
                value={ad.correlation.frequencyCtr.r || 'N/A'}
                subValue={ad.correlation.frequencyCtr.significant ? `p = ${ad.correlation.frequencyCtr.pValue}` : 'Not significant'}
                info="correlation"
              />
            </div>

            {/* Charts Row */}
            <div className="text-xs text-gray-500 -mb-2">
              Chart metric audit: Link CTR = link clicks / impressions (link clicks prefer inline link clicks, then outbound clicks when inline is unavailable).
            </div>
            <AdCtrFrequencyOverlayChart ad={ad} />

            <CorrelationScatter
              daily={ad.daily}
              correlation={ad.correlation}
            />

            {/* Statistical Summary */}
            <div className={`rounded-lg p-4 ${STATUS_CONFIG[ad.status].bgColor} border ${STATUS_CONFIG[ad.status].borderColor}`}>
              <div className="flex items-center gap-2 mb-2">
                <Info className={`w-4 h-4 ${STATUS_CONFIG[ad.status].iconColor}`} />
                <span className={`font-medium ${STATUS_CONFIG[ad.status].textColor}`}>Statistical Summary</span>
                <InfoTooltip contentKey="pValue" />
              </div>
              {ad.insufficientDataReason && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
                  {ad.insufficientDataReason}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Frequency ↔ Link CTR Correlation:</span>
                  <span className={`ml-2 font-mono font-medium ${ad.correlation.frequencyCtr.r < -0.5 ? 'text-rose-700' : 'text-gray-700'}`}>
                    r = {ad.correlation.frequencyCtr.r || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">P-value:</span>
                  <span className={`ml-2 font-mono font-medium ${ad.correlation.frequencyCtr.pValue < 0.05 ? 'text-emerald-700' : 'text-gray-500'}`}>
                    {ad.correlation.frequencyCtr.pValue < 0.001 ? '< 0.001' : ad.correlation.frequencyCtr.pValue}
                  </span>
                  <span className="text-xs text-gray-500 ml-1">
                    ({ad.correlation.frequencyCtr.significant ? 'significant' : 'not significant'})
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Link CTR Change:</span>
                  <span className={`ml-2 font-medium ${ad.trends.ctr.change < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {ad.trends.ctr.change > 0 ? '+' : ''}{ad.trends.ctr.change}%
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Frequency Change:</span>
                  <span className={`ml-2 font-medium ${ad.trends.frequency.change > 0 ? 'text-amber-700' : 'text-gray-700'}`}>
                    {ad.trends.frequency.change > 0 ? '+' : ''}{ad.trends.frequency.change}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Reach Chart (for saturation) */}
      {adSet.status === 'saturated' && (
        <NewReachChart ads={adSet.ads} />
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function FatigueDetector({ store, formatCurrency }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [selectedAdSetId, setSelectedAdSetId] = useState(null);
  const [selectedAd, setSelectedAd] = useState(null);
  const [showGuide, setShowGuide] = useState(true);
  const [days, setDays] = useState(30);
  const [includeInactiveCampaigns, setIncludeInactiveCampaigns] = useState(false);
  const [expandedCampaignIds, setExpandedCampaignIds] = useState(new Set());

  // Load fatigue data
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        store: store.id,
        days: days.toString(),
        includeInactive: includeInactiveCampaigns ? 'true' : 'false'
      });
      const response = await fetch(`${API_BASE}/fatigue?${params}`);
      const result = await response.json();

      if (result.success) {
        setData(result);
        // Auto-select first problematic ad set, or first ad set
        const problemAdSet = result.adSets.find(a => a.status === 'fatigued' || a.status === 'saturated');
        setSelectedAdSetId(problemAdSet?.adset_id || result.adSets[0]?.adset_id);
        const campaignIds = (result.campaigns || [])
          .map((campaign) => campaign.campaign_id || campaign.campaign_name)
          .filter(Boolean);
        setExpandedCampaignIds(new Set(campaignIds));
        setSelectedAd(null);
      } else {
        setError(result.error || 'Failed to load data');
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [store.id, days, includeInactiveCampaigns]);

  const selectedAdSet = useMemo(() => {
    return data?.adSets?.find(a => a.adset_id === selectedAdSetId);
  }, [data, selectedAdSetId]);

  const campaignHierarchy = useMemo(() => {
    if (Array.isArray(data?.campaigns) && data.campaigns.length > 0) {
      return data.campaigns;
    }
    if (!Array.isArray(data?.adSets) || data.adSets.length === 0) {
      return [];
    }

    const campaignMap = new Map();
    data.adSets.forEach((adSet) => {
      const key = adSet.campaign_id || adSet.campaign_name || 'unknown-campaign';
      if (!campaignMap.has(key)) {
        campaignMap.set(key, {
          campaign_id: adSet.campaign_id || null,
          campaign_name: adSet.campaign_name || 'Unnamed Campaign',
          effective_status: adSet.campaign_effective_status || 'UNKNOWN',
          adSets: []
        });
      }
      campaignMap.get(key).adSets.push(adSet);
    });

    return Array.from(campaignMap.values()).map((campaign) => ({
      ...campaign,
      adSets: [...campaign.adSets].sort(
        (a, b) =>
          (ADSET_STATUS_PRIORITY[a.status] ?? ADSET_STATUS_PRIORITY.healthy) -
          (ADSET_STATUS_PRIORITY[b.status] ?? ADSET_STATUS_PRIORITY.healthy)
      )
    }));
  }, [data]);

  const toggleCampaignExpanded = (campaignId) => {
    setExpandedCampaignIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) {
        next.delete(campaignId);
      } else {
        next.add(campaignId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
          <p className="text-gray-500">Analyzing creative performance...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
          <p className="text-gray-900 font-medium">Error loading data</p>
          <p className="text-gray-500 text-sm mt-1">{error}</p>
          <button
            onClick={loadData}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data?.adSets?.length) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Eye className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-900 font-medium">No ad data found</p>
          <p className="text-gray-500 text-sm mt-1">
            Make sure you have ad-level data synced for the last {days} days
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Fatigue Detector</h2>
          <p className="text-gray-500 mt-1">
            Distinguish creative fatigue from audience saturation using statistical analysis
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={includeInactiveCampaigns}
              onChange={(e) => setIncludeInactiveCampaigns(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>{includeInactiveCampaigns ? 'Active + inactive campaigns' : 'Active campaigns only'}</span>
          </label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
          </select>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Educational Guide */}
      <HowToUseGuide isOpen={showGuide} onToggle={() => setShowGuide(!showGuide)} />

      {/* Summary Cards */}
      <SummaryCards summary={data.summary} />

      {/* Main Content */}
      <div className="flex gap-6 min-h-[600px]">
        {/* Left Panel - Campaign -> Ad Set Hierarchy */}
        <div className="w-80 flex-shrink-0 space-y-2">
          <div className="px-1 mb-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Campaigns ({campaignHierarchy.length})
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Ad Sets ({data.adSets.length})
            </div>
          </div>
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
            {campaignHierarchy.map((campaign) => {
              const campaignKey = campaign.campaign_id || campaign.campaign_name || 'unknown-campaign';
              return (
                <CampaignGroup
                  key={campaignKey}
                  campaign={campaign}
                  isExpanded={expandedCampaignIds.has(campaignKey)}
                  onToggle={() => toggleCampaignExpanded(campaignKey)}
                  selectedAdSetId={selectedAdSetId}
                  onSelectAdSet={(adsetId) => {
                    setSelectedAdSetId(adsetId);
                    setSelectedAd(null);
                  }}
                />
              );
            })}
            {campaignHierarchy.length === 0 && (
              <div className="text-xs text-gray-500 px-2 py-3 border border-dashed border-gray-200 rounded-lg bg-gray-50">
                No campaigns found for the selected filters.
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Analysis */}
        <AdDetailPanel
          adSet={selectedAdSet}
          selectedAd={selectedAd}
          onSelectAd={setSelectedAd}
        />
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-gray-400 pt-4 border-t border-gray-100">
        Analysis based on {data.dateRange.start} to {data.dateRange.end} •
        Using Pearson correlation on Link CTR (link clicks ÷ impressions) with p &lt; 0.05 significance threshold
      </div>
    </div>
  );
}
