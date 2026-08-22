import { act } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CampaignIntelligenceUnifiedSection from '../CampaignIntelligenceUnifiedSection';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function buildTimelineDailyRows() {
  return [
    {
      date: '2026-03-03',
      spend: 82.4,
      impressions: 4100,
      reach: 3280,
      clicks: 118,
      landingPageViews: 89,
      addToCart: 12,
      checkoutsInitiated: 7,
      conversions: 4,
      conversionValue: 344.1,
      ctr: 0.0288,
      cvr: 0.0339,
      cpm: 20.1,
      lpvRate: 0.7542,
      frequency: 1.25,
      orders: 4,
      revenue: 344.1,
      ordersPerSpend: 0.0485
    },
    {
      date: '2026-03-04',
      spend: 79.2,
      impressions: 3980,
      reach: 3185,
      clicks: 112,
      landingPageViews: 86,
      addToCart: 11,
      checkoutsInitiated: 6,
      conversions: 3,
      conversionValue: 289.4,
      ctr: 0.0281,
      cvr: 0.0268,
      cpm: 19.9,
      lpvRate: 0.7679,
      frequency: 1.25,
      orders: 3,
      revenue: 289.4,
      ordersPerSpend: 0.0379
    }
  ];
}

function buildMetrics(overrides = {}) {
  return {
    spend: 82.4,
    purchases: 4,
    ctr: 0.0288,
    hookRate: null,
    lpvClick: 0.7542,
    atcLpv: 0.1348,
    costAtc: 6.8667,
    icAtc: 0.5833,
    purchaseIc: 0.5714,
    roas: 4.176,
    frequency: 1.25,
    cpm: 20.1,
    concentration: 0.64,
    ...overrides
  };
}

function buildSupport(overrides = {}) {
  return {
    spend: 82.4,
    impressions: 4100,
    reach: 3280,
    clicks: 118,
    videoViews: 0,
    landingPageViews: 89,
    addToCart: 12,
    checkoutsInitiated: 7,
    conversions: 4,
    childCount: 3,
    childSpendTotal: 82.4,
    hookRateEligible: false,
    ...overrides
  };
}

function buildRow({
  id,
  level,
  entityId,
  name,
  parentId = null,
  campaignId = null,
  campaignName = null,
  adsetId = null,
  adsetName = null,
  nowMetrics = {},
  baselineMetrics = {},
  nowSupport = {},
  baselineSupport = {}
}) {
  return {
    id,
    level,
    levelLabel: level === 'campaign' ? 'Campaign' : level === 'adset' ? 'Ad Set' : 'Ad',
    entityId,
    name,
    parentId,
    campaignId,
    campaignName,
    adsetId,
    adsetName,
    effectiveStatus: 'ACTIVE',
    metrics: {
      now: buildMetrics(nowMetrics),
      baseline: buildMetrics({
        spend: 70.2,
        purchases: 3,
        ctr: 0.0315,
        lpvClick: 0.782,
        atcLpv: 0.147,
        costAtc: 5.85,
        icAtc: 0.61,
        purchaseIc: 0.5,
        roas: 3.62,
        frequency: 1.18,
        cpm: 17.3,
        concentration: 0.58,
        ...baselineMetrics
      })
    },
    support: {
      now: buildSupport(nowSupport),
      baseline: buildSupport({
        spend: 70.2,
        impressions: 3900,
        reach: 3300,
        clicks: 123,
        landingPageViews: 96,
        addToCart: 14,
        checkoutsInitiated: 8,
        conversions: 3,
        childCount: 3,
        childSpendTotal: 70.2,
        hookRateEligible: false,
        ...baselineSupport
      })
    }
  };
}

function buildSnapshot(rows) {
  return {
    success: true,
    generatedAt: '2026-03-06T16:00:00.000Z',
    scope: {
      store: 'shawq',
      country: 'ALL',
      analysisStartDate: '2026-03-01',
      analysisEndDate: '2026-03-04'
    },
    selectors: {
      countries: [
        { code: 'ALL', spend: 240.3, conversions: 11, baseline: null }
      ]
    },
    timeline: {
      daily: buildTimelineDailyRows()
    },
    hierarchy: {
      rows
    },
    brief: {
      settings: {
        scheduleMode: 'manual',
        provider: 'openai',
        model: 'gpt-5.2',
        reasoningEffort: 'medium',
        verbosity: 'low'
      },
      latest: null,
      modelOptions: []
    }
  };
}

function buildFetchMock() {
  return vi.fn(async (input) => {
    const url = String(input || '');
    if (url.includes('/api/campaign-intelligence/unified-timeline')) {
      return jsonResponse({
        success: true,
        timeline: {
          daily: buildTimelineDailyRows()
        }
      });
    }
    return jsonResponse({ success: true });
  });
}

describe('CampaignIntelligenceUnifiedSection', () => {
  beforeEach(() => {
    global.fetch = buildFetchMock();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders unified manager rows and mixed metric states without crashing', async () => {
    const rows = [
      buildRow({
        id: 'campaign:1201',
        level: 'campaign',
        entityId: '1201',
        name: 'Scaling_US_ASC',
        campaignId: '1201',
        campaignName: 'Scaling_US_ASC'
      }),
      buildRow({
        id: 'adset:2201',
        level: 'adset',
        entityId: '2201',
        name: 'US Hoodie Ad Set',
        parentId: 'campaign:1201',
        campaignId: '1201',
        campaignName: 'Scaling_US_ASC',
        adsetId: '2201',
        adsetName: 'US Hoodie Ad Set',
        nowMetrics: { hookRate: null, concentration: 0.72 },
        baselineMetrics: { hookRate: null, concentration: 0.6 },
        nowSupport: { hookRateEligible: false },
        baselineSupport: { hookRateEligible: false }
      }),
      buildRow({
        id: 'ad:3201',
        level: 'ad',
        entityId: '3201',
        name: 'Calm Kuffiyah',
        parentId: 'adset:2201',
        campaignId: '1201',
        campaignName: 'Scaling_US_ASC',
        adsetId: '2201',
        adsetName: 'US Hoodie Ad Set',
        nowMetrics: { hookRate: 0.29, concentration: null },
        baselineMetrics: { hookRate: 0.24, concentration: null },
        nowSupport: { videoViews: 910, hookRateEligible: true, childCount: null, childSpendTotal: null },
        baselineSupport: { videoViews: 760, hookRateEligible: true, childCount: null, childSpendTotal: null }
      })
    ];

    render(
      <CampaignIntelligenceUnifiedSection
        snapshot={buildSnapshot(rows)}
        analysisParams={{ country: 'ALL', startDate: '2026-03-01', endDate: '2026-03-04' }}
        store={{ id: 'shawq' }}
        targetRoas={4}
        onSnapshotUpdate={vi.fn()}
        onAnalysisParamsChange={vi.fn()}
      />
    );

    await screen.findByText('Unified Funnel Health Manager');
    await act(async () => {
      fireEvent.change(screen.getByDisplayValue('Only Needs Attention'), { target: { value: 'all' } });
    });

    expect(screen.getAllByText('At target floor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Strong close rate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Low repetition').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Severe auction pressure').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Near anchor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Soft vs anchor').length).toBeGreaterThan(0);

    expect(screen.getAllByText('At target floor')[0].parentElement).toHaveClass('bg-[#f0fdf4]');
    expect(screen.getAllByText('Low repetition')[0].parentElement).toHaveClass('bg-[#ecfdf3]');
    expect(screen.getAllByText('Severe auction pressure')[0].parentElement).toHaveClass('bg-[#fef2f2]');
    expect(screen.getAllByText('Near anchor')[0].parentElement).toHaveClass('bg-[#fffbeb]');
    expect(screen.getAllByText('Soft vs anchor')[0].parentElement).toHaveClass('bg-[#fff7ed]');

    expect(screen.getByText('Top Drivers')).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes('Baseline $17.30') && content.includes('Current $20.10'))
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/campaign-intelligence/unified-timeline?'),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    expect(console.error).not.toHaveBeenCalled();
  });

  it('stabilizes selected row when the hierarchy shrinks after rerender', async () => {
    const initialRows = [
      buildRow({
        id: 'campaign:1201',
        level: 'campaign',
        entityId: '1201',
        name: 'Scaling_US_ASC',
        campaignId: '1201',
        campaignName: 'Scaling_US_ASC'
      }),
      buildRow({
        id: 'adset:2201',
        level: 'adset',
        entityId: '2201',
        name: 'US Hoodie Ad Set',
        parentId: 'campaign:1201',
        campaignId: '1201',
        campaignName: 'Scaling_US_ASC',
        adsetId: '2201',
        adsetName: 'US Hoodie Ad Set'
      })
    ];

    const { rerender } = render(
      <CampaignIntelligenceUnifiedSection
        snapshot={buildSnapshot(initialRows)}
        analysisParams={{ country: 'ALL', startDate: '2026-03-01', endDate: '2026-03-04' }}
        store={{ id: 'shawq' }}
        targetRoas={4}
        onSnapshotUpdate={vi.fn()}
        onAnalysisParamsChange={vi.fn()}
      />
    );

    expect((await screen.findAllByText('Scaling_US_ASC')).length).toBeGreaterThan(0);

    rerender(
      <CampaignIntelligenceUnifiedSection
        snapshot={buildSnapshot([
          buildRow({
            id: 'campaign:9901',
            level: 'campaign',
            entityId: '9901',
            name: 'Replacement Campaign',
            campaignId: '9901',
            campaignName: 'Replacement Campaign',
            nowMetrics: { roas: 4.8, ctr: 0.0312, cpm: 6.1, frequency: 1.18 },
            baselineMetrics: { roas: 3.9, ctr: 0.0274, cpm: 6.4, frequency: 1.11 }
          })
        ])}
        analysisParams={{ country: 'ALL', startDate: '2026-03-01', endDate: '2026-03-04' }}
        store={{ id: 'shawq' }}
        targetRoas={4}
        onSnapshotUpdate={vi.fn()}
        onAnalysisParamsChange={vi.fn()}
      />
    );

    expect((await screen.findAllByText('Replacement Campaign')).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('US Hoodie Ad Set')).toHaveLength(0);
    expect(console.error).not.toHaveBeenCalled();
  });
});
