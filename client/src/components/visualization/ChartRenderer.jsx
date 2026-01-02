/**
 * Chart Renderer Component
 * Shared chart component using Recharts
 * Supports line, bar, area, pie charts AND multi-metric overlays
 */

import React from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid, Legend
} from 'recharts';
import { getBrandColors, formatValue, truncateLabel, METRIC_INFO } from '../shared/chartUtils';

export default function ChartRenderer({
  chartType,
  data,
  xKey = 'category',
  yKey = 'value',
  // NEW: Support multiple metrics for overlay charts
  metrics = null, // Array of metric keys for comparison charts
  height = 240,
  currency = 'SAR',
  formatType = 'number',
  animate = true,
  store = 'vironax'
}) {
  const brandColors = getBrandColors(store);
  const colors = brandColors.series;

  // Determine if this is a multi-metric comparison chart
  const isComparison = metrics && Array.isArray(metrics) && metrics.length > 1;

  // Format function for values
  const formatChartValue = (value) => {
    return formatValue(value, formatType, currency);
  };

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-gray-900 text-white px-3 py-2 rounded-lg text-sm shadow-lg">
        <div className="font-medium">{truncateLabel(label, 25)}</div>
        <div className="text-gray-300">{formatChartValue(payload[0].value)}</div>
      </div>
    );
  };

  // Handle empty data
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-400" style={{ height }}>
        <div className="text-center">
          <span className="text-3xl block mb-2">📊</span>
          <span className="text-sm">No data available</span>
        </div>
      </div>
    );
  }

  // Get metric label for legend/tooltip
  const getMetricLabel = (metricKey) => {
    return METRIC_INFO[metricKey]?.label || metricKey;
  };

  // Custom tooltip for comparison charts
  const ComparisonTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-gray-900 text-white px-3 py-2 rounded-lg text-sm shadow-lg">
        <div className="font-medium mb-1">{truncateLabel(label, 25)}</div>
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-2 text-gray-300">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span>{getMetricLabel(entry.dataKey)}:</span>
            <span className="font-medium text-white">{formatChartValue(entry.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  // Line Chart - supports single or multi-metric overlay
  if (chartType === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: isComparison ? 25 : 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={{ stroke: '#E5E7EB' }}
            tickLine={false}
            tickFormatter={(val) => truncateLabel(val, 10)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatChartValue}
            width={60}
          />
          <Tooltip content={isComparison ? <ComparisonTooltip /> : <CustomTooltip />} />
          {isComparison && (
            <Legend
              verticalAlign="bottom"
              height={20}
              formatter={(value) => getMetricLabel(value)}
              wrapperStyle={{ fontSize: '11px' }}
            />
          )}
          {isComparison ? (
            // Multi-metric overlay lines
            metrics.map((metricKey, idx) => (
              <Line
                key={metricKey}
                type="monotone"
                dataKey={metricKey}
                name={metricKey}
                stroke={colors[idx % colors.length]}
                strokeWidth={2}
                dot={{ fill: colors[idx % colors.length], strokeWidth: 0, r: 2 }}
                activeDot={{ r: 4, fill: colors[idx % colors.length] }}
                isAnimationActive={animate}
                animationDuration={400}
                animationEasing="ease-out"
              />
            ))
          ) : (
            // Single metric line
            <Line
              type="monotone"
              dataKey={yKey}
              stroke={brandColors.primary}
              strokeWidth={2}
              dot={{ fill: brandColors.primary, strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: brandColors.secondary }}
              isAnimationActive={animate}
              animationDuration={400}
              animationEasing="ease-out"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Bar Chart (horizontal for categorical data)
  if (chartType === 'bar') {
    // For categorical data, use horizontal bars
    const isHorizontal = data.length <= 10;

    if (isHorizontal) {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={true} vertical={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: '#6B7280' }}
              axisLine={{ stroke: '#E5E7EB' }}
              tickLine={false}
              tickFormatter={formatChartValue}
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={{ fontSize: 11, fill: '#6B7280' }}
              axisLine={false}
              tickLine={false}
              width={100}
              tickFormatter={(val) => truncateLabel(val, 15)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar
              dataKey={yKey}
              fill={brandColors.primary}
              radius={[0, 4, 4, 0]}
              isAnimationActive={animate}
              animationDuration={400}
              animationEasing="ease-out"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // Vertical bars for time series
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={{ stroke: '#E5E7EB' }}
            tickLine={false}
            tickFormatter={(val) => truncateLabel(val, 8)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatChartValue}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey={yKey}
            fill={brandColors.primary}
            radius={[4, 4, 0, 0]}
            isAnimationActive={animate}
            animationDuration={400}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Area Chart
  if (chartType === 'area') {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={{ stroke: '#E5E7EB' }}
            tickLine={false}
            tickFormatter={(val) => truncateLabel(val, 10)}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6B7280' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatChartValue}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <defs>
            <linearGradient id={`areaGradient-${store}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={brandColors.primary} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={brandColors.primary} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={yKey}
            stroke={brandColors.primary}
            fill={`url(#areaGradient-${store})`}
            strokeWidth={2}
            isAnimationActive={animate}
            animationDuration={400}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  // Pie Chart
  if (chartType === 'pie') {
    const RADIAN = Math.PI / 180;
    const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }) => {
      if (percent < 0.05) return null; // Don't show label for small slices
      const radius = innerRadius + (outerRadius - innerRadius) * 1.2;
      const x = cx + radius * Math.cos(-midAngle * RADIAN);
      const y = cy + radius * Math.sin(-midAngle * RADIAN);

      return (
        <text
          x={x}
          y={y}
          fill="#374151"
          textAnchor={x > cx ? 'start' : 'end'}
          dominantBaseline="central"
          fontSize={11}
        >
          {truncateLabel(name, 12)} ({(percent * 100).toFixed(0)}%)
        </text>
      );
    };

    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey={yKey}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={height * 0.32}
            innerRadius={height * 0.15}
            isAnimationActive={animate}
            animationDuration={400}
            label={renderCustomizedLabel}
            labelLine={{ stroke: '#9CA3AF', strokeWidth: 1 }}
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return null;
}
