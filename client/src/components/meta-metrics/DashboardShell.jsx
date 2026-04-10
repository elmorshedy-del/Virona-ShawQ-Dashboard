import { useEffect, useMemo, useState } from 'react';
import MetricCard from './MetricCard';
import Sidebar from './Sidebar';
import GenderPanel from './GenderPanel';
import AgePanel from './AgePanel';
import WeekAdTypePanel from './WeekAdTypePanel';
import MonthPanel from './MonthPanel';
import CountryPanel from './CountryPanel';
import EventHourPanel from './EventHourPanel';
import {
  DEFAULT_AGE_BARS,
  DEFAULT_CAMPAIGN_OPTIONS,
  DEFAULT_GENDER,
  DEFAULT_HIGHLIGHTED_DAYS,
  DEFAULT_MEASURE_OPTIONS,
  DEFAULT_METRICS,
  DEFAULT_WEEK_GROUPS,
  DEFAULT_HOURLY_DATA,
  METRIC_LEFTS,
  METRIC_TOPS
} from './mockData';

const DEFAULT_CHANNEL = 'facebook';
const DEFAULT_MEASURE = DEFAULT_MEASURE_OPTIONS[0];
const DEFAULT_CAMPAIGN_ID = DEFAULT_CAMPAIGN_OPTIONS[0]?.campaignId || '';

function resolveValidCampaignId(value, options, fallbackValue) {
  if (options.some((option) => option.campaignId === value)) return value;
  return options[0]?.campaignId ?? fallbackValue;
}

function resolveValidMeasure(value, options, fallbackValue) {
  return options.includes(value) ? value : (options[0] || fallbackValue);
}

function parseUtcMonthYear(dateKey) {
  if (!dateKey) return {};
  const parsedDate = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) return {};
  return {
    initialYear: parsedDate.getUTCFullYear(),
    initialMonth: parsedDate.getUTCMonth() + 1
  };
}

export default function DashboardShell({
  metrics = DEFAULT_METRICS,
  genderData = DEFAULT_GENDER,
  ageBars = DEFAULT_AGE_BARS,
  weekGroups = DEFAULT_WEEK_GROUPS,
  hourlyData = DEFAULT_HOURLY_DATA,
  highlightedDays = DEFAULT_HIGHLIGHTED_DAYS,
  countryLiveView = null,
  measureOptions = DEFAULT_MEASURE_OPTIONS,
  campaignOptions = DEFAULT_CAMPAIGN_OPTIONS,
  periodEndDate = null,
  onFiltersChange,
  onMetricClick
}) {
  const [activeChannel, setActiveChannel] = useState(DEFAULT_CHANNEL);
  const [selectedMeasure, setSelectedMeasure] = useState(DEFAULT_MEASURE);
  const [selectedCampaignId, setSelectedCampaignId] = useState(DEFAULT_CAMPAIGN_ID);

  useEffect(() => {
    setSelectedMeasure((current) => resolveValidMeasure(current, measureOptions, DEFAULT_MEASURE));
  }, [measureOptions]);

  useEffect(() => {
    setSelectedCampaignId((current) => resolveValidCampaignId(current, campaignOptions, DEFAULT_CAMPAIGN_ID));
  }, [campaignOptions]);

  const calendarDefaults = useMemo(
    () => parseUtcMonthYear(periodEndDate),
    [periodEndDate]
  );

  const notifyFilters = (patch) => {
    const nextFilters = {
      channel: patch.channel ?? activeChannel,
      measure: patch.measure ?? selectedMeasure,
      campaignId: patch.campaignId ?? selectedCampaignId
    };

    if (Object.prototype.hasOwnProperty.call(patch, 'year')) {
      nextFilters.year = patch.year;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'month')) {
      nextFilters.month = patch.month;
    }

    onFiltersChange?.(nextFilters);
  };

  const handleChannelChange = (channel) => {
    setActiveChannel(channel);
    notifyFilters({ channel });
  };

  const handleCampaignChange = (value) => {
    setSelectedCampaignId(value);
    notifyFilters({ campaignId: value });
  };

  const handleMeasureChange = (value) => {
    setSelectedMeasure(value);
    notifyFilters({ measure: value });
  };

  return (
    <div className="relative size-full rounded-[30px]" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[30px] backdrop-blur-[14px] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(216.513721deg, rgba(49,93,242,0.173) 70.981%, rgba(9,20,55,0.18) 70.981%)'
        }}
      />

      <div className="relative size-full overflow-clip rounded-[inherit]">
        <p
          className="absolute left-[34px] top-[26px] whitespace-nowrap font-bold not-italic leading-[normal] text-[30px]"
          style={{ color: 'rgba(230,244,255,0.96)' }}
        >
          ∞
        </p>
        <p
          className="absolute left-[72px] top-[34px] whitespace-nowrap font-semibold not-italic leading-[normal] text-[22px]"
          style={{ color: 'rgba(248,251,255,0.97)' }}
        >
          Meta Ad Performance Dashboard
        </p>
        <p
          className="absolute left-[74px] top-[64px] whitespace-nowrap font-medium not-italic leading-[normal] text-[12px]"
          style={{ color: 'rgba(201,227,255,0.74)' }}
        >
          Overview · {selectedMeasure}
        </p>

        <Sidebar
          activeChannel={activeChannel}
          onChannelChange={handleChannelChange}
          selectedMeasure={selectedMeasure}
          onMeasureChange={handleMeasureChange}
          measureOptions={measureOptions}
          selectedCampaignId={selectedCampaignId}
          onCampaignChange={handleCampaignChange}
          campaignOptions={campaignOptions}
        />

        {metrics.map((metric, index) => {
          const row = Math.floor(index / 6);
          const column = index % 6;
          return (
            <MetricCard
              key={metric.id}
              {...metric}
              left={METRIC_LEFTS[column]}
              top={METRIC_TOPS[row]}
              onClick={onMetricClick}
            />
          );
        })}

        <GenderPanel data={genderData} measure={selectedMeasure} />
        <AgePanel bars={ageBars} measure={selectedMeasure} />
        <WeekAdTypePanel groups={weekGroups} measure={selectedMeasure} />
        <MonthPanel
          highlightedDays={highlightedDays}
          measure={selectedMeasure}
          initialYear={calendarDefaults.initialYear}
          initialMonth={calendarDefaults.initialMonth}
          onMonthChange={(year, month) => {
            notifyFilters({
              channel: activeChannel,
              measure: selectedMeasure,
              campaignId: selectedCampaignId,
              year,
              month
            });
          }}
        />
        <CountryPanel liveView={countryLiveView} />
        <EventHourPanel data={hourlyData} measure={selectedMeasure} />
      </div>

      <div className="absolute inset-0 rounded-[inherit] pointer-events-none shadow-[inset_0px_1px_10px_0px_rgba(215,247,255,0.08)]" />
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[30px] border border-solid pointer-events-none shadow-[0px_28px_60px_0px_rgba(3,7,19,0.5)]"
        style={{ borderColor: 'rgba(176,216,255,0.16)' }}
      />
    </div>
  );
}
