import { useMemo, useState } from 'react';
import { niceMax } from './chartUtils';
import GlassPanel from './GlassPanel';

const AXIS_BOTTOM_PX = 138;
const CHART_TOP_PX = 60;
const CHART_HEIGHT_PX = AXIS_BOTTOM_PX - CHART_TOP_PX;
const BAR_LEFT_PX = 40;
const BAR_STRIDE_PX = 12;
const GRID_LEFT_PX = 30;
const GRID_WIDTH_PX = 236;
const MIN_BAR_HEIGHT_PX = 2;

function formatValue(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${Math.round(value)}`;
}

export default function AgePanel({ bars, measure = 'Impressions' }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const maxValue = useMemo(
    () => Math.max(...bars.map((bar) => bar.value), 1),
    [bars]
  );
  const scale = useMemo(() => niceMax(maxValue), [maxValue]);
  const yTicks = [
    { value: 0, topPx: AXIS_BOTTOM_PX },
    { value: scale / 2, topPx: AXIS_BOTTOM_PX - (CHART_HEIGHT_PX * 0.5) },
    { value: scale, topPx: CHART_TOP_PX }
  ];
  const gridTops = [
    CHART_TOP_PX,
    CHART_TOP_PX + (CHART_HEIGHT_PX * 0.25),
    CHART_TOP_PX + (CHART_HEIGHT_PX * 0.5),
    CHART_TOP_PX + (CHART_HEIGHT_PX * 0.75)
  ];

  return (
    <GlassPanel left={462} top={292} width={306} height={186} gradientAngle={215.919542}>
      <p className="absolute left-[18px] top-[15px] whitespace-nowrap font-['Inter',sans-serif] text-[13px] font-semibold not-italic leading-[normal] text-[rgba(242,248,255,0.96)]">
        {measure} by Age
      </p>

      {gridTops.map((topValue) => (
        <div
          key={topValue}
          className="absolute h-px"
          style={{
            top: Math.round(topValue),
            left: GRID_LEFT_PX,
            width: GRID_WIDTH_PX,
            background: 'rgba(184,219,255,0.1)'
          }}
        />
      ))}

      <div
        className="absolute w-px"
        style={{
          left: GRID_LEFT_PX,
          top: CHART_TOP_PX,
          height: CHART_HEIGHT_PX,
          background: 'rgba(184,219,255,0.18)'
        }}
      />
      <div
        className="absolute h-px"
        style={{
          left: GRID_LEFT_PX,
          top: AXIS_BOTTOM_PX,
          width: GRID_WIDTH_PX,
          background: 'rgba(184,219,255,0.18)'
        }}
      />

      {yTicks.map((tick) => (
        <p
          key={tick.value}
          className="absolute whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.66)]"
          style={{ left: 4, top: Math.round(tick.topPx) - 6 }}
        >
          {formatValue(tick.value)}
        </p>
      ))}

      {bars.map((bar, index) => {
        const barHeight = Math.max(MIN_BAR_HEIGHT_PX, (bar.value / scale) * CHART_HEIGHT_PX);
        const barLeft = BAR_LEFT_PX + (index * BAR_STRIDE_PX);
        const barTop = AXIS_BOTTOM_PX - barHeight;
        const hovered = hoveredIndex === index;
        return (
          <div
            key={`age-bar-${index}`}
            className="absolute rounded-[3px] cursor-pointer"
            style={{
              left: barLeft,
              top: Math.round(barTop),
              width: 8,
              height: Math.round(barHeight),
              background: hovered
                ? 'linear-gradient(to left, rgba(255,255,255,1), rgba(180,210,255,0.95))'
                : 'linear-gradient(to left, rgba(255,255,255,0.98), rgba(163,197,255,0.78))',
              opacity: hovered ? 1 : 0.93,
              transform: hovered ? 'scaleY(1.04)' : 'scaleY(1)',
              transformOrigin: 'bottom',
              transition: 'opacity 0.15s, background 0.15s, transform 0.15s'
            }}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        );
      })}

      {bars.map((bar, index) => (
        bar.label ? (
          <p
            key={`age-label-${index}`}
            className="absolute top-[144px] whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.7)]"
            style={{ left: BAR_LEFT_PX + (index * BAR_STRIDE_PX) - 2 }}
          >
            {bar.label}
          </p>
        ) : null
      ))}

      {hoveredIndex !== null && (() => {
        const hoveredBar = bars[hoveredIndex];
        const barHeight = Math.max(MIN_BAR_HEIGHT_PX, (hoveredBar.value / scale) * CHART_HEIGHT_PX);
        return (
          <div
            className="absolute rounded-[6px] px-[6px] py-[3px] pointer-events-none"
            style={{
              left: Math.max(0, BAR_LEFT_PX + (hoveredIndex * BAR_STRIDE_PX) - 8),
              top: Math.round(AXIS_BOTTOM_PX - barHeight - 24),
              background: 'rgba(18,42,100,0.92)',
              border: '1px solid rgba(137,194,255,0.2)',
              zIndex: 10
            }}
          >
            <span className="whitespace-nowrap font-['Inter',sans-serif] text-[9px] font-medium text-[rgba(215,232,255,0.9)]">
              {formatValue(hoveredBar.value)}
            </span>
          </div>
        );
      })()}
    </GlassPanel>
  );
}
