import { useEffect, useRef, useState } from 'react';

const CHANNEL_CARD_WIDTH_PX = 122;
const CHANNEL_CARD_HEIGHT_PX = 50;
const SIDEBAR_WIDTH_PX = 150;
const SIDEBAR_HEIGHT_PX = 590;
const SIDEBAR_LEFT_PX = 26;
const SIDEBAR_TOP_PX = 94;
const DROPDOWN_LEFT_PX = 14;
const DROPDOWN_WIDTH_PX = 122;
const DROPDOWN_CLOSED_HEIGHT_PX = 88;
const DROPDOWN_OPTION_HEIGHT_PX = 28;

function getOptionValue(option) {
  if (typeof option === 'string') return option;
  if (option && typeof option === 'object') return option.campaignId ?? option.value ?? '';
  return '';
}

function getOptionLabel(option) {
  if (typeof option === 'string') return option;
  if (option && typeof option === 'object') return option.campaignName ?? option.label ?? '';
  return '';
}

function FilterDropdown({ label, value, options, onSelect, top }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const selectedOption = options.find((option) => getOptionValue(option) === value) || options[0];
  const selectedLabel = getOptionLabel(selectedOption);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="absolute rounded-[16px]"
      style={{
        background: 'rgba(14,45,102,0.36)',
        border: '1px solid rgba(157,212,255,0.14)',
        height: open
          ? `${DROPDOWN_CLOSED_HEIGHT_PX + (options.length * DROPDOWN_OPTION_HEIGHT_PX)}px`
          : `${DROPDOWN_CLOSED_HEIGHT_PX}px`,
        left: DROPDOWN_LEFT_PX,
        top,
        width: DROPDOWN_WIDTH_PX,
        overflow: 'visible',
        transition: 'height 0.2s ease',
        zIndex: open ? 30 : 1
      }}
    >
      <p
        className="absolute left-[11px] top-[11px] whitespace-nowrap font-['Inter',sans-serif] text-[11px] font-medium not-italic leading-[normal]"
        style={{ color: 'rgba(201,227,255,0.84)' }}
      >
        {label}
      </p>

      <div
        className="absolute left-[11px] top-[35px] flex h-[34px] w-[98px] cursor-pointer select-none items-center rounded-[10px]"
        style={{
          background: 'rgba(37,94,186,0.22)',
          border: `1px solid ${open ? 'rgba(168,217,255,0.4)' : 'rgba(168,217,255,0.16)'}`,
          transition: 'border-color 0.15s'
        }}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="ml-[9px] flex-1 truncate whitespace-nowrap font-['Inter',sans-serif] text-[12px] font-medium not-italic"
          style={{ color: 'rgba(247,251,255,0.92)' }}
        >
          {selectedLabel}
        </span>
        <span
          className="mr-[6px] inline-block font-['Inter',sans-serif] text-[14px] font-bold not-italic leading-none"
          style={{
            color: 'rgba(223,244,255,0.9)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        >
          ⌄
        </span>
      </div>

      {open && (
        <div
          className="absolute left-0 top-[88px] w-full overflow-hidden rounded-b-[12px]"
          style={{
            background: 'rgba(10,28,76,0.97)',
            border: '1px solid rgba(157,212,255,0.18)',
            borderTop: 'none',
            zIndex: 40
          }}
        >
          {options.map((option) => (
            <div
              key={getOptionValue(option) || getOptionLabel(option)}
              className="flex cursor-pointer items-center px-[11px]"
              style={{
                height: DROPDOWN_OPTION_HEIGHT_PX,
                background: getOptionValue(option) === value ? 'rgba(49,93,242,0.3)' : 'transparent',
                transition: 'background 0.12s'
              }}
              onMouseEnter={(event) => {
                if (getOptionValue(option) !== value) {
                  event.currentTarget.style.background = 'rgba(37,94,186,0.3)';
                }
              }}
              onMouseLeave={(event) => {
                if (getOptionValue(option) !== value) {
                  event.currentTarget.style.background = 'transparent';
                }
              }}
              onClick={() => {
                onSelect(getOptionValue(option));
                setOpen(false);
              }}
            >
              <span
                className="whitespace-nowrap font-['Inter',sans-serif] text-[11px] font-medium not-italic"
                style={{ color: getOptionValue(option) === value ? 'rgba(137,194,255,1)' : 'rgba(201,222,255,0.82)' }}
              >
                {getOptionLabel(option)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  activeChannel,
  onChannelChange,
  selectedMeasure,
  onMeasureChange,
  measureOptions,
  selectedCampaignId,
  onCampaignChange,
  campaignOptions
}) {
  return (
    <div
      className="absolute rounded-[24px]"
      style={{ height: SIDEBAR_HEIGHT_PX, left: SIDEBAR_LEFT_PX, top: SIDEBAR_TOP_PX, width: SIDEBAR_WIDTH_PX, zIndex: 10 }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[24px] backdrop-blur-[9px] pointer-events-none"
        style={{ background: 'linear-gradient(to left, rgba(17,45,106,0.48), rgba(11,22,60,0.34))' }}
      />

      <div className="relative size-full rounded-[inherit]" style={{ overflow: 'visible' }}>
        <div
          className="absolute left-[14px] top-[22px] overflow-clip rounded-[16px] cursor-pointer select-none"
          style={{
            background: activeChannel === 'facebook' ? 'rgba(19,62,131,0.96)' : 'rgba(19,62,131,0.6)',
            border: activeChannel === 'facebook'
              ? '1px solid rgba(137,194,255,0.3)'
              : '1px solid rgba(137,194,255,0.14)',
            height: CHANNEL_CARD_HEIGHT_PX,
            width: CHANNEL_CARD_WIDTH_PX,
            transition: 'background 0.2s, border-color 0.2s'
          }}
          onClick={() => onChannelChange('facebook')}
        >
          <p className="absolute left-[17px] top-[10px] font-['Inter',sans-serif] text-[26px] font-bold" style={{ color: '#60a2ff' }}>
            f
          </p>
          <p
            className="absolute left-[47px] top-[16px] font-['Inter',sans-serif] text-[15px] font-semibold"
            style={{ color: 'rgba(255,255,255,0.96)' }}
          >
            Facebook
          </p>
          {activeChannel === 'facebook' && (
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(96,162,255,0.06)' }} />
          )}
        </div>

        <div
          className="absolute left-[14px] top-[84px] overflow-clip rounded-[16px] cursor-pointer select-none"
          style={{
            background: activeChannel === 'instagram' ? 'rgba(19,62,131,0.96)' : 'rgba(19,62,131,0.6)',
            border: activeChannel === 'instagram'
              ? '1px solid rgba(137,194,255,0.3)'
              : '1px solid rgba(137,194,255,0.12)',
            height: CHANNEL_CARD_HEIGHT_PX,
            width: CHANNEL_CARD_WIDTH_PX,
            transition: 'background 0.2s, border-color 0.2s'
          }}
          onClick={() => onChannelChange('instagram')}
        >
          <p className="absolute left-[17px] top-[10px] font-['Inter',sans-serif] text-[24px] font-bold" style={{ color: '#ff64cb' }}>
            ◎
          </p>
          <p
            className="absolute left-[47px] top-[16px] font-['Inter',sans-serif] text-[15px] font-semibold"
            style={{ color: 'rgba(255,255,255,0.95)' }}
          >
            Instagram
          </p>
          {activeChannel === 'instagram' && (
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(255,100,203,0.06)' }} />
          )}
        </div>

        <FilterDropdown
          label="Select Measure"
          value={selectedMeasure}
          options={measureOptions}
          onSelect={onMeasureChange}
          top={220}
        />
        <FilterDropdown
          label="Active Campaigns"
          value={selectedCampaignId}
          options={campaignOptions}
          onSelect={onCampaignChange}
          top={420}
        />
      </div>

      <div className="absolute inset-0 rounded-[inherit] pointer-events-none shadow-[inset_0px_1px_6px_0px_rgba(227,245,255,0.05)]" />
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[24px] border border-solid pointer-events-none"
        style={{ borderColor: 'rgba(179,217,255,0.14)' }}
      />
    </div>
  );
}
