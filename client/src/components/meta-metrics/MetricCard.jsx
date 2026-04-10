import { useMemo, useState } from 'react';
import { catmullRomPath, clamp } from './chartUtils';

const ACCENT_COLOR = Object.freeze({
  cyan: 'rgba(86,226,255,0.95)',
  indigo: 'rgba(123,140,255,0.95)',
  teal: 'rgba(60,246,201,0.95)'
});

const ACCENT_SPARK = Object.freeze({
  cyan: '#56E2FF',
  indigo: '#7B8CFF',
  teal: '#3CF6C9'
});

const DOWN_COLOR = 'rgba(255,85,100,0.95)';
const DOWN_SPARK = '#FF5564';
const SPARK_POINT_COUNT = 8;
const SPARK_WIDTH = 58;
const SPARK_HEIGHT = 22;
const SPARK_PADDING = 2.5;
const HOVER_SCALE = 1.025;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resample(values, length) {
  if (values.length === length) return [...values];
  if (values.length <= 1) {
    const fill = values[0] ?? 0;
    return Array.from({ length }, () => fill);
  }

  return Array.from({ length }, (_, index) => {
    const position = (index / (length - 1)) * (values.length - 1);
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(values.length - 1, Math.ceil(position));
    const t = position - leftIndex;
    const leftValue = values[leftIndex];
    const rightValue = values[rightIndex];
    return leftValue + ((rightValue - leftValue) * t);
  });
}

function normalizeSparklineSeries(series, isDown) {
  const raw = Array.isArray(series)
    ? series.map(toNumber).filter((value) => Number.isFinite(value))
    : [];
  let values = raw.length >= 2 ? raw : (isDown ? [1, 0.7] : [0.7, 1]);

  const first = values[0];
  const last = values[values.length - 1];
  const directionalDelta = Math.max(Math.abs(first) * 0.06, 1);

  if (isDown && last >= first) {
    values = [...values];
    values[values.length - 1] = first - directionalDelta;
  } else if (!isDown && last <= first) {
    values = [...values];
    values[values.length - 1] = first + directionalDelta;
  }

  return resample(values, SPARK_POINT_COUNT);
}

function generateSparkPath(series, isDown) {
  const values = normalizeSparklineSeries(series, isDown);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = Math.max(maxValue - minValue, 1);
  const points = [];

  for (let index = 0; index < values.length; index += 1) {
    const t = index / (SPARK_POINT_COUNT - 1);
    const x = t * SPARK_WIDTH;
    const normalized = (values[index] - minValue) / span;
    const y = clamp(
      SPARK_HEIGHT - SPARK_PADDING - (normalized * (SPARK_HEIGHT - (SPARK_PADDING * 2))),
      SPARK_PADDING,
      SPARK_HEIGHT - SPARK_PADDING
    );
    points.push([x, y]);
  }

  return catmullRomPath(points);
}

function SparkLine({ series, color, isDown }) {
  const path = useMemo(
    () => generateSparkPath(series, isDown),
    [isDown, series]
  );

  return (
    <div className="absolute left-[72px] top-[44px] h-[22px] w-[58px]">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 58 22">
        <path
          d={path}
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity="0.22"
          strokeWidth="5"
        />
        <path
          d={path}
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

export default function MetricCard({
  id,
  label,
  value,
  change,
  sparkline = [],
  accentColor,
  left,
  top,
  onClick
}) {
  const [hovered, setHovered] = useState(false);
  const isDown = String(change || '').trim().startsWith('-');
  const changeColor = isDown ? DOWN_COLOR : ACCENT_COLOR[accentColor];
  const sparkColor = isDown ? DOWN_SPARK : ACCENT_SPARK[accentColor];

  return (
    <div
      className="absolute h-[86px] w-[146px] rounded-[18px] cursor-pointer select-none"
      style={{
        left,
        top,
        transform: hovered ? `scale(${HOVER_SCALE})` : 'scale(1)',
        transition: 'transform 0.18s ease',
        zIndex: hovered ? 5 : 1
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onClick?.(id)}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[18px] backdrop-blur-[12px] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(215.068541deg, rgba(49,93,242,0.26) 70.981%, rgba(9,20,55,0.27) 70.981%)'
        }}
      />

      <div className="relative overflow-clip size-full rounded-[inherit]">
        <p className="absolute left-[18px] top-[14px] whitespace-nowrap font-['Inter',sans-serif] text-[11px] font-medium not-italic leading-[normal] text-[rgba(215,232,255,0.8)]">
          {label}
        </p>
        <p className="absolute left-[18px] top-[34px] whitespace-nowrap font-['Inter',sans-serif] text-[18px] font-semibold not-italic leading-[normal] tracking-[-0.36px] text-[rgba(255,255,255,0.98)]">
          {value}
        </p>
        <p
          className="absolute left-[18px] top-[60px] whitespace-nowrap font-['Inter',sans-serif] text-[11px] font-medium not-italic leading-[normal]"
          style={{ color: changeColor }}
        >
          {change}
        </p>

        <SparkLine series={sparkline} color={sparkColor} isDown={isDown} />
      </div>

      <div className="absolute inset-0 rounded-[inherit] pointer-events-none shadow-[inset_0px_1px_8px_0px_rgba(230,250,255,0.08)]" />
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[18px] pointer-events-none"
        style={{
          border: hovered
            ? '1px solid rgba(176,216,255,0.38)'
            : '1px solid rgba(176,216,255,0.16)',
          boxShadow: hovered
            ? '0 18px 34px rgba(3,8,22,0.36)'
            : '0 12px 28px rgba(3,8,22,0.26)'
        }}
      />
    </div>
  );
}
