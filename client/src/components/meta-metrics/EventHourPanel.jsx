import { useMemo, useState } from 'react';
import { catmullRomPath, niceMax } from './chartUtils';
import GlassPanel from './GlassPanel';

const CHART_LEFT_PX = 30;
const CHART_TOP_PX = 54;
const CHART_WIDTH_PX = 306;
const CHART_HEIGHT_PX = 94;
const AXIS_BOTTOM_PX = CHART_TOP_PX + CHART_HEIGHT_PX;
const X_LABEL_HOURS = Object.freeze([0, 5, 10, 15, 20]);
const GRID_LINE_FRACTIONS = Object.freeze([1, 0.75, 0.5, 0.25]);

function formatValue(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `${Math.round(value)}`;
}

export default function EventHourPanel({ data, measure = 'Impressions' }) {
  const [tooltip, setTooltip] = useState(null);
  const sorted = useMemo(
    () => [...data].sort((left, right) => left.hour - right.hour),
    [data]
  );
  const maxValue = useMemo(
    () => Math.max(...sorted.map((row) => row.value), 1),
    [sorted]
  );
  const scale = useMemo(() => niceMax(maxValue), [maxValue]);
  const maxHour = sorted.length > 1 ? sorted[sorted.length - 1].hour : 23;

  const toX = (hour) => (hour / maxHour) * CHART_WIDTH_PX;
  const toY = (value) => CHART_HEIGHT_PX - ((value / scale) * CHART_HEIGHT_PX);

  const points = useMemo(
    () => sorted.map((row) => [toX(row.hour), toY(row.value)]),
    [scale, sorted]
  );
  const linePath = useMemo(() => catmullRomPath(points), [points]);
  const areaPath = useMemo(() => {
    if (!points.length) return '';
    return `${linePath} L ${points[points.length - 1][0].toFixed(2)} ${CHART_HEIGHT_PX} L ${points[0][0].toFixed(2)} ${CHART_HEIGHT_PX} Z`;
  }, [linePath, points]);
  const yTicks = GRID_LINE_FRACTIONS.map((fraction) => ({
    value: scale * fraction,
    localY: CHART_HEIGHT_PX - (CHART_HEIGHT_PX * fraction),
    topPx: CHART_TOP_PX + CHART_HEIGHT_PX - (CHART_HEIGHT_PX * fraction)
  }));

  function nearestPoint(localX) {
    const hour = (localX / CHART_WIDTH_PX) * maxHour;
    let bestPoint = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    sorted.forEach((row) => {
      const distance = Math.abs(row.hour - hour);
      if (distance < bestDistance) {
        bestPoint = row;
        bestDistance = distance;
      }
    });
    return bestPoint;
  }

  return (
    <GlassPanel left={784} top={494} width={374} height={192} gradientAngle={211.458683}>
      <p className="absolute left-[18px] top-[15px] whitespace-nowrap font-['Inter',sans-serif] text-[13px] font-semibold not-italic leading-[normal] text-[rgba(242,248,255,0.96)]">
        {measure} by Event Hour
      </p>

      {yTicks.map((tick) => (
        <div
          key={`event-grid-${tick.value}`}
          className="absolute h-px"
          style={{
            top: Math.round(CHART_TOP_PX + tick.localY),
            left: CHART_LEFT_PX,
            width: CHART_WIDTH_PX,
            background: 'rgba(184,219,255,0.1)'
          }}
        />
      ))}
      <div
        className="absolute w-px"
        style={{
          left: CHART_LEFT_PX,
          top: CHART_TOP_PX,
          height: CHART_HEIGHT_PX,
          background: 'rgba(184,219,255,0.18)'
        }}
      />
      <div
        className="absolute h-px"
        style={{
          left: CHART_LEFT_PX,
          top: AXIS_BOTTOM_PX,
          width: CHART_WIDTH_PX,
          background: 'rgba(184,219,255,0.18)'
        }}
      />

      {yTicks.map((tick) => (
        <p
          key={`event-tick-${tick.value}`}
          className="absolute whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.64)]"
          style={{ left: 4, top: Math.round(CHART_TOP_PX + tick.localY) - 6 }}
        >
          {formatValue(tick.value)}
        </p>
      ))}

      <div
        className="absolute"
        style={{ left: CHART_LEFT_PX, top: CHART_TOP_PX, width: CHART_WIDTH_PX, height: CHART_HEIGHT_PX }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const localX = event.clientX - rect.left;
          const nearest = nearestPoint(localX);
          if (!nearest) return;
          setTooltip({
            x: toX(nearest.hour),
            y: toY(nearest.value) - 32,
            hour: nearest.hour,
            value: nearest.value
          });
        }}
        onMouseLeave={() => setTooltip(null)}
      >
        <svg
          className="absolute block size-full"
          fill="none"
          preserveAspectRatio="none"
          viewBox={`0 0 ${CHART_WIDTH_PX} ${CHART_HEIGHT_PX}`}
        >
          <defs>
            <clipPath id="meta-metrics-event-hour-clip">
              <rect width={CHART_WIDTH_PX} height={CHART_HEIGHT_PX} />
            </clipPath>
            <linearGradient id="meta-metrics-event-hour-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(168,217,255,0.35)" />
              <stop offset="100%" stopColor="rgba(168,217,255,0.04)" />
            </linearGradient>
            {yTicks.map((tick) => (
              <line
                key={`event-svg-grid-${tick.value}`}
                x1="0"
                y1={tick.localY.toFixed(2)}
                x2={CHART_WIDTH_PX}
                y2={tick.localY.toFixed(2)}
                stroke="rgba(184,219,255,0.06)"
                strokeWidth="1"
              />
            ))}
          </defs>

          <g clipPath="url(#meta-metrics-event-hour-clip)">
            {areaPath && <path d={areaPath} fill="url(#meta-metrics-event-hour-area)" />}
            {linePath && (
              <path
                d={linePath}
                stroke="rgba(168,217,255,0.35)"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {linePath && (
              <path
                d={linePath}
                stroke="rgba(247,250,255,1)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {tooltip && (
              <circle
                cx={toX(tooltip.hour).toFixed(2)}
                cy={toY(tooltip.value).toFixed(2)}
                r="4"
                fill="white"
                stroke="rgba(168,217,255,0.8)"
                strokeWidth="2"
              />
            )}
          </g>
        </svg>

        {tooltip && (
          <div
            className="absolute rounded-[8px] px-[8px] py-[4px] pointer-events-none"
            style={{
              left: Math.min(Math.max(tooltip.x - 30, 0), CHART_WIDTH_PX - 80),
              top: Math.max(tooltip.y, 0),
              background: 'rgba(10,25,76,0.95)',
              border: '1px solid rgba(137,194,255,0.2)',
              zIndex: 20
            }}
          >
            <p className="whitespace-nowrap font-['Inter',sans-serif] text-[9px] font-medium text-[rgba(201,222,255,0.75)]">
              Hour {tooltip.hour}:00
            </p>
            <p className="whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-semibold text-[rgba(215,232,255,0.95)]">
              {formatValue(tooltip.value)}
            </p>
          </div>
        )}
      </div>

      {X_LABEL_HOURS.map((hour) => (
        <p
          key={`event-hour-${hour}`}
          className="absolute whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.68)]"
          style={{ left: CHART_LEFT_PX + Math.round(toX(hour)) - 2, top: AXIS_BOTTOM_PX + 4 }}
        >
          {hour}
        </p>
      ))}
    </GlassPanel>
  );
}
