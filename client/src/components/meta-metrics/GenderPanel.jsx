import GlassPanel from './GlassPanel';

const SEGMENTS = Object.freeze([
  { key: 'female', color: '#48E0C2', opacity: 0.95 },
  { key: 'all', color: '#356BFF', opacity: 0.95 },
  { key: 'male', color: '#77A7FF', opacity: 0.92 }
]);

const LEGEND = Object.freeze([
  { color: '#48E0C2', label: 'Female', top: 68 },
  { color: '#356BFF', label: 'All', top: 98 },
  { color: '#77A7FF', label: 'Male', top: 128 }
]);

function parsePct(value) {
  const match = String(value || '').match(/[\d.]+/);
  return match ? Number.parseFloat(match[0]) : 0;
}

function polarToXY(centerX, centerY, radius, angleDeg) {
  const radians = (angleDeg * Math.PI) / 180;
  return [centerX + (radius * Math.cos(radians)), centerY + (radius * Math.sin(radians))];
}

function donutSegment(centerX, centerY, outerRadius, innerRadius, startDeg, endDeg) {
  const delta = Math.min(endDeg - startDeg, 359.99);
  const end = startDeg + delta;
  const [outerStartX, outerStartY] = polarToXY(centerX, centerY, outerRadius, startDeg);
  const [outerEndX, outerEndY] = polarToXY(centerX, centerY, outerRadius, end);
  const [innerEndX, innerEndY] = polarToXY(centerX, centerY, innerRadius, end);
  const [innerStartX, innerStartY] = polarToXY(centerX, centerY, innerRadius, startDeg);
  const largeArcFlag = delta > 180 ? 1 : 0;

  return [
    `M ${outerStartX.toFixed(3)} ${outerStartY.toFixed(3)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEndX.toFixed(3)} ${outerEndY.toFixed(3)}`,
    `L ${innerEndX.toFixed(3)} ${innerEndY.toFixed(3)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerStartX.toFixed(3)} ${innerStartY.toFixed(3)}`,
    'Z'
  ].join(' ');
}

function DonutChart({ data }) {
  const centerX = 53;
  const centerY = 53;
  const outerRadius = 46;
  const innerRadius = 29;
  const gapDegrees = 2;
  const percentages = SEGMENTS.map((segment) => parsePct(data?.[segment.key]?.pct));
  const total = percentages.reduce((sum, value) => sum + value, 0) || 1;
  const degrees = percentages.map(
    (value) => (value / total) * (360 - (SEGMENTS.length * gapDegrees))
  );

  let angle = -90;
  const arcs = degrees.map((deg, index) => {
    const start = angle;
    angle += deg + gapDegrees;
    return { ...SEGMENTS[index], start, end: start + deg };
  });

  return (
    <svg
      viewBox="0 0 106 106"
      fill="none"
      className="absolute block size-full"
      style={{ filter: 'drop-shadow(0 0 8px rgba(60,160,255,0.18))' }}
    >
      <circle
        cx={centerX}
        cy={centerY}
        r={(outerRadius + innerRadius) / 2}
        fill="none"
        stroke="rgba(16,37,86,0.9)"
        strokeWidth={outerRadius - innerRadius}
      />
      {arcs.map((segment) => (
        <path
          key={segment.key}
          d={donutSegment(centerX, centerY, outerRadius, innerRadius, segment.start, segment.end)}
          fill={segment.color}
          fillOpacity={segment.opacity}
          style={{ filter: `drop-shadow(0 0 3px ${segment.color})` }}
        />
      ))}
      <circle cx={centerX} cy={centerY} r={innerRadius - 2} fill="rgba(12,28,68,0.55)" />
    </svg>
  );
}

export default function GenderPanel({ data, measure = 'Impressions' }) {
  return (
    <GlassPanel left={206} top={292} width={240} height={186} gradientAngle={222.725846}>
      <p className="absolute left-[18px] top-[15px] whitespace-nowrap font-['Inter',sans-serif] text-[13px] font-semibold not-italic leading-[normal] text-[rgba(242,248,255,0.96)]">
        {measure} by Gender
      </p>

      <div className="absolute left-[24px] top-[50px] size-[106px]">
        <DonutChart data={data} />
      </div>

      {LEGEND.map((item) => (
        <span key={item.label}>
          <p
            className="absolute whitespace-nowrap font-['Inter',sans-serif] text-[18px] font-bold not-italic leading-[normal]"
            style={{ color: item.color, left: 138, top: item.top }}
          >
            •
          </p>
          <p
            className="absolute whitespace-nowrap font-['Inter',sans-serif] text-[12px] font-medium not-italic leading-[normal] text-[rgba(213,231,255,0.9)]"
            style={{ left: 152, top: item.top + 2 }}
          >
            {item.label}
          </p>
        </span>
      ))}

      <p className="absolute left-[18px] top-[42px] whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-medium not-italic leading-[normal] text-[rgba(213,231,255,0.8)]">
        {data?.female?.count || '0'}
      </p>
      <p className="absolute left-[22px] top-[56px] whitespace-nowrap font-['Inter',sans-serif] text-[9px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.7)]">
        {data?.female?.pct || '(0.0%)'}
      </p>

      <p className="absolute left-[122px] top-[52px] whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-medium not-italic leading-[normal] text-[rgba(213,231,255,0.8)]">
        {data?.all?.count || '0'}
      </p>
      <p className="absolute left-[124px] top-[66px] whitespace-nowrap font-['Inter',sans-serif] text-[9px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.7)]">
        {data?.all?.pct || '(0.0%)'}
      </p>

      <p className="absolute left-[18px] top-[140px] whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-medium not-italic leading-[normal] text-[rgba(213,231,255,0.8)]">
        {data?.male?.count || '0'}
      </p>
      <p className="absolute left-[18px] top-[154px] whitespace-nowrap font-['Inter',sans-serif] text-[9px] font-normal not-italic leading-[normal] text-[rgba(201,222,255,0.7)]">
        {data?.male?.pct || '(0.0%)'}
      </p>
    </GlassPanel>
  );
}
