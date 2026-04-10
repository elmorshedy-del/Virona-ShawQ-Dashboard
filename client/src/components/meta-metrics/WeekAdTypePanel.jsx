import { useMemo, useState } from 'react';
import { niceMax } from './chartUtils';
import GlassPanel from './GlassPanel';

const AD_TYPES = Object.freeze([
  { key: 'casual', label: 'Casual', color: 'rgba(74,223,204,0.72)', dotColor: '#4adfcc' },
  { key: 'image', label: 'Image', color: 'rgba(94,160,255,0.72)', dotColor: '#5ea0ff' },
  { key: 'stories', label: 'Stories', color: 'rgba(51,131,255,0.72)', dotColor: '#3383ff' },
  { key: 'video', label: 'Video', color: 'rgba(108,88,255,0.78)', dotColor: '#6c58ff' }
]);

const AXIS_BOTTOM_PX = 162;
const CHART_TOP_PX = 70;
const CHART_HEIGHT_PX = AXIS_BOTTOM_PX - CHART_TOP_PX;
const GROUP_START_PX = 36;
const GROUP_STRIDE_PX = 24;
const GRID_LEFT_PX = 22;
const GRID_WIDTH_PX = 320;
const STACK_BAR_WIDTH_PX = 14;

function formatValue(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${Math.round(value)}`;
}

export default function WeekAdTypePanel({ groups, measure = 'Impressions' }) {
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const maxStack = useMemo(
    () => Math.max(...groups.map((group) => group.stories + group.casual + group.image + group.video), 1),
    [groups]
  );
  const scale = useMemo(() => niceMax(maxStack), [maxStack]);
  const yTicks = [
    { value: 0, topPx: AXIS_BOTTOM_PX },
    { value: scale / 3, topPx: AXIS_BOTTOM_PX - (CHART_HEIGHT_PX / 3) },
    { value: (scale * 2) / 3, topPx: AXIS_BOTTOM_PX - ((CHART_HEIGHT_PX * 2) / 3) },
    { value: scale, topPx: CHART_TOP_PX }
  ];

  return (
    <GlassPanel left={784} top={292} width={374} height={186} gradientAngle={210.654809}>
      <p className="absolute left-[18px] top-[15px] whitespace-nowrap font-['Inter',sans-serif] text-[13px] font-semibold not-italic leading-[normal] text-[rgba(242,248,255,0.96)]">
        {measure} by Week and Ad Type
      </p>

      {AD_TYPES.map((type, index) => (
        <span key={type.key}>
          <p
            className="absolute top-[34px] whitespace-nowrap font-['Inter',sans-serif] text-[16px] font-bold not-italic leading-[normal]"
            style={{ left: 18 + (index * 66), color: type.dotColor }}
          >
            •
          </p>
          <p
            className="absolute top-[36px] whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-medium not-italic leading-[normal] text-[rgba(205,229,255,0.84)]"
            style={{ left: 30 + (index * 66) }}
          >
            {type.label}
          </p>
        </span>
      ))}

      {yTicks.slice(1).map((tick) => (
        <div
          key={`week-grid-${tick.value}`}
          className="absolute h-px"
          style={{
            top: Math.round(tick.topPx),
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
          key={`week-tick-${tick.value}`}
          className="absolute whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.66)]"
          style={{ left: 2, top: Math.round(tick.topPx) - 6 }}
        >
          {formatValue(Math.round(tick.value))}
        </p>
      ))}

      {groups.map((group, groupIndex) => {
        const left = GROUP_START_PX + (groupIndex * GROUP_STRIDE_PX);
        const hovered = hoveredGroup === groupIndex;
        const segments = AD_TYPES.map((type) => ({
          color: type.color,
          value: group[type.key]
        })).reverse();
        let cumulativeHeight = 0;

        return (
          <div
            key={`week-group-${groupIndex}`}
            className="absolute"
            style={{ left, width: STACK_BAR_WIDTH_PX, top: 0, bottom: 0 }}
            onMouseEnter={() => setHoveredGroup(groupIndex)}
            onMouseLeave={() => setHoveredGroup(null)}
          >
            {segments.map((segment, segmentIndex) => {
              const segmentHeight = Math.max(1, (segment.value / scale) * CHART_HEIGHT_PX);
              const segmentTop = AXIS_BOTTOM_PX - cumulativeHeight - segmentHeight;
              cumulativeHeight += segmentHeight;
              return (
                <div
                  key={`week-segment-${groupIndex}-${segmentIndex}`}
                  className="absolute rounded-[3px]"
                  style={{
                    left: 0,
                    top: Math.round(segmentTop),
                    width: STACK_BAR_WIDTH_PX,
                    height: Math.round(segmentHeight),
                    background: segment.color,
                    filter: 'blur(0.175px)',
                    opacity: hovered ? 1 : 0.92,
                    transition: 'opacity 0.15s'
                  }}
                />
              );
            })}
          </div>
        );
      })}

      {groups.map((group, groupIndex) => (
        group.label ? (
          <p
            key={`week-label-${groupIndex}`}
            className="absolute whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.7)]"
            style={{ left: GROUP_START_PX + (groupIndex * GROUP_STRIDE_PX) - 2, top: AXIS_BOTTOM_PX + 4 }}
          >
            {group.label}
          </p>
        ) : null
      ))}

      {hoveredGroup !== null && (() => {
        const hovered = groups[hoveredGroup];
        const total = hovered.stories + hovered.casual + hovered.image + hovered.video;
        const totalHeight = Math.max(1, (total / scale) * CHART_HEIGHT_PX);
        return (
          <div
            className="absolute rounded-[8px] px-[8px] py-[5px] pointer-events-none"
            style={{
              left: Math.max(0, GROUP_START_PX + (hoveredGroup * GROUP_STRIDE_PX) - 14),
              top: Math.round(AXIS_BOTTOM_PX - totalHeight - 36),
              background: 'rgba(10,25,76,0.95)',
              border: '1px solid rgba(137,194,255,0.2)',
              zIndex: 10
            }}
          >
            {AD_TYPES.map((type) => (
              <p
                key={`week-tooltip-${type.key}`}
                className="whitespace-nowrap font-['Inter',sans-serif] text-[9px] font-medium"
                style={{ color: type.dotColor }}
              >
                {type.label}: {formatValue(hovered[type.key])}
              </p>
            ))}
            <p className="mt-[3px] border-t border-[rgba(137,194,255,0.2)] pt-[3px] whitespace-nowrap font-['Inter',sans-serif] text-[9px] font-semibold text-[rgba(215,232,255,0.9)]">
              Total: {formatValue(total)}
            </p>
          </div>
        );
      })()}
    </GlassPanel>
  );
}
