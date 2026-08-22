import { useEffect, useState } from 'react';
import GlassPanel from './GlassPanel';

const MONTHS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]);

const DAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const MAX_VISIBLE_DAYS = 28;
const MAX_VISIBLE_ROWS = 4;
const GRID_LEFT_PX = 16;
const GRID_TOP_PX = 120;
const CELL_WIDTH_PX = 24;
const CELL_HEIGHT_PX = 20;
const COLUMN_STRIDE_PX = 28;
const ROW_STRIDE_PX = 26;

function getMonthInfo(year, month) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const firstWeekday = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  return { firstWeekday, daysInMonth };
}

function resolveInitialDate(initialYear, initialMonth) {
  if (Number.isFinite(initialYear) && Number.isFinite(initialMonth)) {
    return { year: initialYear, month: initialMonth };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export default function MonthPanel({
  highlightedDays = [],
  onMonthChange,
  measure = 'Impressions',
  initialYear,
  initialMonth
}) {
  const resolvedInitialDate = resolveInitialDate(initialYear, initialMonth);
  const [year, setYear] = useState(resolvedInitialDate.year);
  const [month, setMonth] = useState(resolvedInitialDate.month);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoveredDay, setHoveredDay] = useState(null);

  useEffect(() => {
    const nextDate = resolveInitialDate(initialYear, initialMonth);
    setYear(nextDate.year);
    setMonth(nextDate.month);
  }, [initialMonth, initialYear]);

  const highlightSet = new Set(highlightedDays);
  const { firstWeekday, daysInMonth } = getMonthInfo(year, month);

  const goPrev = () => {
    const nextMonth = month === 1 ? 12 : month - 1;
    const nextYear = month === 1 ? year - 1 : year;
    setMonth(nextMonth);
    setYear(nextYear);
    onMonthChange?.(nextYear, nextMonth);
  };

  const goNext = () => {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    setMonth(nextMonth);
    setYear(nextYear);
    onMonthChange?.(nextYear, nextMonth);
  };

  const cells = [];
  for (let day = 1; day <= Math.min(daysInMonth, MAX_VISIBLE_DAYS); day += 1) {
    const index = firstWeekday + day - 1;
    const column = index % DAYS.length;
    const row = Math.floor(index / DAYS.length);
    if (row < MAX_VISIBLE_ROWS) {
      cells.push({ day, column, row });
    }
  }

  return (
    <GlassPanel left={206} top={494} width={240} height={192} gradientAngle={223.633505}>
      <p className="absolute left-[18px] top-[15px] whitespace-nowrap font-['Inter',sans-serif] text-[13px] font-semibold not-italic leading-[normal] text-[rgba(242,248,255,0.96)]">
        {measure} by Month
      </p>
      <p className="absolute left-[38px] top-[30px] whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-medium not-italic leading-[normal] text-[rgba(201,222,255,0.74)]">
        Select Month
      </p>

      <div className="absolute left-[26px] top-[48px] w-[104px]">
        <div
          className="absolute left-0 top-0 flex h-[34px] w-[104px] cursor-pointer items-center rounded-[10px]"
          style={{
            background: 'rgba(42,95,184,0.22)',
            border: `1px solid ${dropdownOpen ? 'rgba(172,217,255,0.36)' : 'rgba(172,217,255,0.16)'}`
          }}
          onClick={() => setDropdownOpen((current) => !current)}
        >
          <button
            className="ml-[4px] flex h-[26px] w-[18px] shrink-0 items-center justify-center rounded-[6px] cursor-pointer"
            style={{ background: 'transparent', border: 'none' }}
            onClick={(event) => {
              event.stopPropagation();
              goPrev();
            }}
          >
            <span className="font-['Inter',sans-serif] text-[10px] font-bold" style={{ color: 'rgba(223,244,255,0.85)' }}>
              ‹
            </span>
          </button>
          <span
            className="flex-1 text-center whitespace-nowrap font-['Inter',sans-serif] text-[12px] font-medium not-italic"
            style={{ color: 'rgba(246,251,255,0.94)' }}
          >
            {MONTHS[month - 1]}
          </span>
          <button
            className="mr-[4px] flex h-[26px] w-[18px] shrink-0 items-center justify-center rounded-[6px] cursor-pointer"
            style={{ background: 'transparent', border: 'none' }}
            onClick={(event) => {
              event.stopPropagation();
              goNext();
            }}
          >
            <span className="font-['Inter',sans-serif] text-[10px] font-bold" style={{ color: 'rgba(223,244,255,0.85)' }}>
              ›
            </span>
          </button>
        </div>

        {dropdownOpen && (
          <div
            className="absolute left-0 top-[38px] w-[104px] overflow-hidden rounded-[10px]"
            style={{
              background: 'rgba(10,28,76,0.97)',
              border: '1px solid rgba(157,212,255,0.18)',
              zIndex: 50
            }}
          >
            {MONTHS.map((monthLabel, monthIndex) => {
              const selected = monthIndex + 1 === month;
              return (
                <div
                  key={monthLabel}
                  className="flex h-[24px] cursor-pointer items-center px-[10px]"
                  style={{ background: selected ? 'rgba(49,93,242,0.3)' : 'transparent' }}
                  onMouseEnter={(event) => {
                    if (!selected) event.currentTarget.style.background = 'rgba(37,94,186,0.3)';
                  }}
                  onMouseLeave={(event) => {
                    if (!selected) event.currentTarget.style.background = 'transparent';
                  }}
                  onClick={() => {
                    const nextMonth = monthIndex + 1;
                    setMonth(nextMonth);
                    setDropdownOpen(false);
                    onMonthChange?.(year, nextMonth);
                  }}
                >
                  <span
                    className="font-['Inter',sans-serif] text-[11px] font-medium"
                    style={{ color: selected ? 'rgba(137,194,255,1)' : 'rgba(201,222,255,0.82)' }}
                  >
                    {monthLabel}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {DAYS.map((label, index) => (
        <p
          key={label}
          className="absolute top-[98px] whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-medium not-italic leading-[normal] text-[rgba(201,222,255,0.68)]"
          style={{ left: GRID_LEFT_PX + (index * COLUMN_STRIDE_PX) + 2 }}
        >
          {label}
        </p>
      ))}

      {cells.map(({ day, column, row }) => {
        const highlighted = highlightSet.has(day);
        const hovered = hoveredDay === day;
        return (
          <div
            key={`month-cell-${day}`}
            className="absolute rounded-[6px] cursor-pointer"
            title={highlighted ? 'Campaign peak day' : undefined}
            style={{
              left: GRID_LEFT_PX + (column * COLUMN_STRIDE_PX),
              top: GRID_TOP_PX + (row * ROW_STRIDE_PX),
              width: CELL_WIDTH_PX,
              height: CELL_HEIGHT_PX,
              background: hovered
                ? 'rgba(74,223,204,0.28)'
                : highlighted
                  ? 'rgba(74,223,204,0.36)'
                  : 'rgba(30,77,156,0.16)',
              filter: highlighted ? 'blur(0.75px)' : undefined,
              boxShadow: highlighted ? '0 0 6px rgba(74,223,204,0.4)' : undefined,
              transition: 'background 0.15s'
            }}
            onMouseEnter={() => setHoveredDay(day)}
            onMouseLeave={() => setHoveredDay(null)}
          >
            <p
              className="absolute left-[6px] top-[4px] whitespace-nowrap font-['Inter',sans-serif] text-[10px] font-medium not-italic leading-[normal]"
              style={{ color: highlighted ? 'rgba(74,223,204,0.95)' : 'rgba(242,248,255,0.88)' }}
            >
              {day}
            </p>
          </div>
        );
      })}

      {highlightedDays.length > 0 && (
        <div className="absolute left-[150px] top-[100px] z-[5] flex items-center gap-[4px]">
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'rgba(74,223,204,0.85)',
              boxShadow: '0 0 4px rgba(74,223,204,0.5)'
            }}
          />
          <span className="font-['Inter',sans-serif] text-[9px] font-medium text-[rgba(201,222,255,0.68)]">
            Campaign
          </span>
        </div>
      )}
    </GlassPanel>
  );
}
