/**
 * UNIFIED CAMPAIGN COMPONENT
 * ==========================
 *
 * Redesigned with Meta Ads Manager-inspired styling.
 * Features:
 * - Clean, minimal Meta-like design
 * - Campaign hierarchy with country breakdown as nested rows
 * - Financials first, then funnel stages
 * - Robust expand/collapse behavior
 * - Brand-specific data source rules (Shawq: Shopify, Virona: Salla/Meta)
 */

import { Fragment, useState, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown, Search, X } from 'lucide-react';

/**
 * Get today's date in YYYY-MM-DD format for comparison
 */
function getTodayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split('T')[0];
}

/**
 * Sortable Table Header Component - Meta style
 */
function SortableHeader({ label, field, sortConfig, onSort, className = '', align = 'center' }) {
  const isActive = sortConfig.field === field;
  const isAsc = isActive && sortConfig.direction === 'asc';

  return (
    <th
      className={`px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none transition-colors ${className}`}
      onClick={() => onSort(field)}
      style={{ textAlign: align }}
    >
      <div className={`flex items-center gap-1 ${align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center'}`}>
        <span>{label}</span>
        {isActive ? (
          isAsc ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </div>
    </th>
  );
}

/**
 * Column group header - Meta style
 */
function ColumnGroupHeader({ label, colSpan, bgColor = 'bg-gray-50' }) {
  return (
    <th
      colSpan={colSpan}
      className={`px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wider text-center border-l border-gray-200 ${bgColor}`}
    >
      {label}
    </th>
  );
}

/**
 * UnifiedAnalytics Component - Meta-styled campaign table
 */
export default function UnifiedAnalytics({
  analyticsMode = 'meta-ad-manager',
  setAnalyticsMode = () => {},
  dashboard = {},
  countriesDataSource = '',
  metaAdManagerData = [],
  adManagerBreakdown = 'none',
  setAdManagerBreakdown = () => {},
  hiddenCampaigns = new Set(),
  setHiddenCampaigns = () => {},
  selectedDiagnosticsCampaign = null,
  setSelectedDiagnosticsCampaign = () => {},
  showHiddenDropdown = false,
  setShowHiddenDropdown = () => {},
  includeInactive = false,
  setIncludeInactive = () => {},
  expandedCampaigns = new Set(),
  setExpandedCampaigns = () => {},
  expandedAdsets = new Set(),
  setExpandedAdsets = () => {},
  loading = false,
  store = {},
  formatCurrency = () => '0',
  formatNumber = () => '0',
  setDiagnosticsExpanded = () => {},
  dateRange = {},
}) {
  // Extract countries from dashboard
  const { countries = [] } = dashboard || {};
  const todayDate = getTodayDate();

  // Local state for sorting
  const [sortConfig, setSortConfig] = useState({ field: 'spend', direction: 'desc' });
  const [searchQuery, setSearchQuery] = useState('');

  // Sorting handler
  const handleSort = useCallback((field) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  }, []);

  // Sort data
  const sortData = useCallback((data, config) => {
    if (!config.field) return data;

    return [...data].sort((a, b) => {
      let aVal = a[config.field];
      let bVal = b[config.field];

      // Handle null/undefined
      if (aVal == null) aVal = 0;
      if (bVal == null) bVal = 0;

      // Handle strings
      if (typeof aVal === 'string') {
        return config.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return config.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, []);

  // Filter and sort campaigns
  const processedCampaigns = useMemo(() => {
    let filtered = metaAdManagerData.filter(c => !hiddenCampaigns.has(c.campaign_id));

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.campaign_name?.toLowerCase().includes(query)
      );
    }

    // Add CVR calculation to each campaign for sorting purposes
    // CVR = (Conversions / Clicks) * 100
    const withCVR = filtered.map(c => ({
      ...c,
      cvr: c.inline_link_clicks > 0 ? (c.conversions / c.inline_link_clicks) * 100 : null
    }));

    return sortData(withCVR, sortConfig);
  }, [metaAdManagerData, hiddenCampaigns, searchQuery, sortData, sortConfig]);

  // Total visible campaigns
  const visibleCount = processedCampaigns.length;
  const totalCount = metaAdManagerData.length;

  // Hide/show campaign functions
  const toggleHideCampaign = useCallback((campaignId, e) => {
    e?.stopPropagation();
    setHiddenCampaigns(prev => {
      const next = new Set(prev);
      if (next.has(campaignId)) {
        next.delete(campaignId);
      } else {
        next.add(campaignId);
      }
      return next;
    });
  }, [setHiddenCampaigns]);

  const showAllCampaigns = useCallback(() => {
    setHiddenCampaigns(new Set());
  }, [setHiddenCampaigns]);

  // Campaign selection for diagnostics filtering
  const handleCampaignSelect = useCallback((campaignId) => {
    if (selectedDiagnosticsCampaign === campaignId) {
      setSelectedDiagnosticsCampaign(null);
    } else {
      setSelectedDiagnosticsCampaign(campaignId);
      setDiagnosticsExpanded(true);
    }
  }, [selectedDiagnosticsCampaign, setSelectedDiagnosticsCampaign, setDiagnosticsExpanded]);

  // Toggle campaign expansion
  const toggleCampaignExpand = useCallback((campaignId, e) => {
    e?.stopPropagation();
    setExpandedCampaigns(prev => {
      const next = new Set(prev);
      if (next.has(campaignId)) {
        next.delete(campaignId);
        // Also collapse all adsets under this campaign
        setExpandedAdsets(adsetPrev => {
          const newAdsets = new Set(adsetPrev);
          const campaign = metaAdManagerData.find(c => c.campaign_id === campaignId);
          if (campaign?.adsets) {
            campaign.adsets.forEach(a => newAdsets.delete(a.adset_id));
          }
          return newAdsets;
        });
      } else {
        next.add(campaignId);
      }
      return next;
    });
  }, [setExpandedCampaigns, setExpandedAdsets, metaAdManagerData]);

  // Toggle adset expansion
  const toggleAdsetExpand = useCallback((adsetId, e) => {
    e?.stopPropagation();
    setExpandedAdsets(prev => {
      const next = new Set(prev);
      if (next.has(adsetId)) {
        next.delete(adsetId);
      } else {
        next.add(adsetId);
      }
      return next;
    });
  }, [setExpandedAdsets]);

  // Helper: Format CPC with real decimal (2 decimal places)
  const formatCPC = (value) => {
    if (value == null || !Number.isFinite(value)) return '—';
    return formatCurrency(value, 2);
  };

  // Seeded RNG helpers for stable Monte Carlo sampling
  const createSeededRng = (seedString) => {
    const xmur3 = (str) => {
      let h = 1779033703 ^ str.length;
      for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
      }
      return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
      };
    };

    const mulberry32 = (seed) => {
      let t = seed;
      return () => {
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), t | 1);
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    };

    const seedFn = xmur3(seedString || 'seed');
    return mulberry32(seedFn());
  };

  const sampleGamma = (shape, rng) => {
    const safeShape = Number.isFinite(shape) ? shape : 0;
    if (safeShape <= 0) return 0;

    if (safeShape < 1) {
      const u = Math.max(rng(), 1e-12);
      return sampleGamma(safeShape + 1, rng) * Math.pow(u, 1 / safeShape);
    }

    const d = safeShape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
      let x = 0;
      let v = 0;
      do {
        const u1 = Math.max(rng(), 1e-12);
        const u2 = Math.max(rng(), 1e-12);
        x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.max(rng(), 1e-12);
      if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };

  const sampleBeta = (alpha, beta, rng) => {
    const a = Math.max(alpha, 1e-6);
    const b = Math.max(beta, 1e-6);
    const x = sampleGamma(a, rng);
    const y = sampleGamma(b, rng);
    const total = x + y;
    if (!Number.isFinite(total) || total <= 0) return 0;
    return x / total;
  };

  // Helper: Render percent with specified decimals
  const renderPercent = (value, decimals = 2) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return `${num.toFixed(decimals)}%`;
  };

  // Helper: Render ROAS
  const renderRoas = (value, decimals = 2) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    return `${num.toFixed(decimals)}x`;
  };

  // Helper: Render metric with null handling
  const renderMetric = (value, formatter = 'number', decimals = 0) => {
    if (value == null || !Number.isFinite(Number(value))) return '—';

    if (formatter === 'currency') return formatCurrency(value, decimals);
    if (formatter === 'currency_decimal') return formatCurrency(value, 2);
    if (formatter === 'percent') return renderPercent(value, decimals);
    if (formatter === 'number') return formatNumber(value);
    if (formatter === 'roas') return renderRoas(value, decimals);
    if (formatter === 'decimal') return Number(value).toFixed(decimals);

    return value;
  };

  // Calculate CVR (Conversion Rate from Landing Page Views to Purchases)
  // Formula: (Purchases / LPV) * 100
  const calculateCVR = (purchases, lpv) => {
    if (!lpv || lpv === 0) return null;
    return (purchases / lpv) * 100;
  };

  // Creative score inputs
  const getVisits = (row) => {
    const lpv = Number(row.lpv);
    if (Number.isFinite(lpv) && lpv > 0) return lpv;
    const outbound = Number(row.outbound_clicks);
    if (Number.isFinite(outbound) && outbound > 0) return outbound;
    const inlineClicks = Number(row.inline_link_clicks);
    if (Number.isFinite(inlineClicks) && inlineClicks > 0) return inlineClicks;
    return 0;
  };

  const adRows = useMemo(() => {
    if (!Array.isArray(metaAdManagerData)) return [];
    const rows = [];
    metaAdManagerData.forEach((campaign) => {
      (campaign.adsets || []).forEach((adset) => {
        (adset.ads || []).forEach((ad) => {
          rows.push(ad);
        });
      });
    });
    return rows;
  }, [metaAdManagerData]);

  const creativeBaseline = useMemo(() => {
    let sumV = 0;
    let sumP = 0;

    adRows.forEach((ad) => {
      const visits = getVisits(ad);
      const purchases = Number(ad.conversions) || 0;
      if (Number.isFinite(visits)) sumV += visits;
      if (Number.isFinite(purchases)) sumP += purchases;
    });

    const theta0 = sumV > 0 ? sumP / sumV : 0;
    return {
      sumV,
      sumP,
      theta0
    };
  }, [adRows]);

  const creativeScoresByAdId = useMemo(() => {
    const map = new Map();
    const K0 = 500;
    const theta0 = Number.isFinite(creativeBaseline.theta0) ? creativeBaseline.theta0 : 0;
    const theta0Safe = Math.min(Math.max(theta0, 0), 1);
    const a0 = Math.max(theta0Safe * K0, 1e-6);
    const b0 = Math.max((1 - theta0Safe) * K0, 1e-6);

    adRows.forEach((ad) => {
      const visits = getVisits(ad);
      const purchases = Number(ad.conversions) || 0;
      const safeV = Math.max(visits, purchases, 0);
      const safeP = Math.min(Math.max(purchases, 0), safeV);
      const confidence = visits > 0 ? visits / (visits + K0) : 0;

      let score = null;
      if (safeV > 0 && Number.isFinite(theta0Safe)) {
        const alpha = a0 + safeP;
        const beta = b0 + Math.max(safeV - safeP, 0);
        const seed = `${ad.ad_id || 'ad'}|${safeV}|${safeP}|${theta0Safe}|${dateRange?.startDate || ''}|${dateRange?.endDate || ''}`;
        const rng = createSeededRng(seed);
        const samples = 2000;
        let wins = 0;
        for (let i = 0; i < samples; i += 1) {
          const theta = sampleBeta(alpha, beta, rng);
          if (theta > theta0Safe) wins += 1;
        }
        const probability = samples > 0 ? wins / samples : 0;
        score = 100 * probability * confidence;
      }

      const spend = Number(ad.spend) || 0;
      const label = visits < 200 || spend < 20 ? 'PROVISIONAL' : 'CONFIDENT';

      map.set(ad.ad_id, {
        visits,
        purchases,
        baselineCvr: theta0Safe * 100,
        confidence: confidence * 100,
        score: Number.isFinite(score) ? Math.max(Math.min(score, 100), 0) : null,
        label
      });
    });

    return map;
  }, [adRows, creativeBaseline, dateRange?.startDate, dateRange?.endDate]);

  // Check if orders occurred today
  const isOrderToday = (orderDate) => {
    return orderDate === todayDate;
  };

  // Get country flag emoji
  const getCountryFlag = (countryCode) => {
    if (!countryCode || countryCode.length !== 2) return '🌍';
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  };

  // Render a single data row (works for campaign, adset, ad, or country breakdown)
  const renderDataRow = (row, level = 'campaign', parentExpanded = true, rowKey) => {
    const isExpanded = level === 'campaign'
      ? expandedCampaigns.has(row.campaign_id)
      : level === 'adset'
        ? expandedAdsets.has(row.adset_id)
        : false;

    const isSelected = level === 'campaign' && selectedDiagnosticsCampaign === row.campaign_id;
    const hasChildren = level === 'campaign'
      ? (row.adsets?.length > 0 || (adManagerBreakdown === 'country' && row.country_breakdowns?.length > 0))
      : level === 'adset'
        ? row.ads?.length > 0
        : false;

    // Calculate CVR (Conversions / LPV)
    const cvr = calculateCVR(row.conversions || 0, row.lpv || 0);
    const creativeStats = level === 'ad' ? creativeScoresByAdId.get(row.ad_id) : null;

    // Indentation based on level
    const indentClass = level === 'campaign' ? 'pl-4' : level === 'adset' ? 'pl-10' : 'pl-16';

    // Row styling based on level and selection
    const rowBgClass = level === 'campaign'
      ? isSelected
        ? 'bg-blue-50 border-l-4 border-l-blue-500'
        : 'bg-white hover:bg-gray-50'
      : level === 'adset'
        ? 'bg-gray-50 hover:bg-gray-100'
        : 'bg-white hover:bg-gray-50';

    // Level icon
    const levelIcon = level === 'campaign' ? '📊' : level === 'adset' ? '📁' : '📄';

    // Name field based on level
    const displayName = level === 'campaign'
      ? row.campaign_name
      : level === 'adset'
        ? row.adset_name
        : row.ad_name;

    // Check if this is a country breakdown row
    const isCountryBreakdown = row.isCountryBreakdown;
    const orderDate = row.lastOrderDate;
    // Only show green highlight when orders occurred TODAY (not just any orders > 0)
    const hasOrdersToday = row.conversions > 0 && orderDate === todayDate;
    // Show flag only for country breakdown rows with orders today
    const showFlag = isCountryBreakdown && hasOrdersToday;

    return (
      <tr
        key={rowKey}
        className={`border-b border-gray-100 text-sm transition-colors cursor-pointer ${rowBgClass}`}
        onClick={() => level === 'campaign' && handleCampaignSelect(row.campaign_id)}
      >
        {/* Expand/Collapse & Hide */}
        <td className="px-2 py-3 w-12">
          <div className="flex items-center gap-1">
            {level === 'campaign' && (
              <button
                onClick={(e) => toggleHideCampaign(row.campaign_id, e)}
                className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                title="Hide campaign"
              >
                <EyeOff className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </td>

        {/* Name with expand toggle */}
        <td className={`py-3 ${indentClass}`}>
          <div className="flex items-center gap-2">
            {hasChildren ? (
              <button
                onClick={(e) => level === 'campaign' ? toggleCampaignExpand(row.campaign_id, e) : toggleAdsetExpand(row.adset_id, e)}
                className="p-0.5 rounded hover:bg-gray-200"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                )}
              </button>
            ) : (
              <span className="w-5" />
            )}
            {isCountryBreakdown ? (
              <span className="text-lg">{getCountryFlag(row.country)}</span>
            ) : (
              <span>{levelIcon}</span>
            )}
            <span className={`${level === 'campaign' ? 'font-semibold text-gray-900' : level === 'adset' ? 'font-medium text-gray-800' : 'text-gray-700'}`}>
              {isCountryBreakdown ? row.countryName || row.country : displayName}
            </span>
          </div>
        </td>

        {/* FINANCIALS GROUP */}
        {/* Revenue */}
        <td className="px-3 py-3 text-right font-medium text-green-600 border-l border-gray-100">
          {renderMetric(row.conversion_value, 'currency')}
        </td>
        {/* Amount Spent */}
        <td className="px-3 py-3 text-right text-blue-600 font-medium">
          {renderMetric(row.spend, 'currency')}
        </td>
        {/* AOV */}
        <td className="px-3 py-3 text-right text-gray-700">
          {renderMetric(row.aov, 'currency')}
        </td>
        {/* CAC */}
        <td className="px-3 py-3 text-right text-gray-700">
          {renderMetric(row.cac, 'currency')}
        </td>
        {/* ROAS */}
        <td className="px-3 py-3 text-right font-semibold text-green-600">
          {renderMetric(row.roas, 'roas', 2)}
        </td>
        {/* Orders - green only when orders occurred TODAY, with flag for country rows */}
        <td className={`px-3 py-3 text-right font-medium ${hasOrdersToday ? 'text-green-600' : 'text-gray-700'}`}>
          <div className="flex items-center justify-end gap-1">
            {showFlag && <span>{getCountryFlag(row.country)}</span>}
            <span>{row.conversions || 0}</span>
          </div>
        </td>

        {/* UPPER FUNNEL GROUP */}
        {/* Impressions */}
        <td className="px-3 py-3 text-right text-gray-600 border-l border-gray-100">
          {renderMetric(row.impressions, 'number')}
        </td>
        {/* Reach */}
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(row.reach, 'number')}
        </td>
        {/* CPM */}
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(row.cpm, 'currency_decimal')}
        </td>
        {/* Frequency */}
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(row.frequency, 'decimal', 2)}
        </td>

        {/* MID FUNNEL GROUP */}
        {/* Link Clicks */}
        <td className="px-3 py-3 text-right text-gray-600 border-l border-gray-100">
          {renderMetric(row.inline_link_clicks, 'number')}
        </td>
        {/* CTR */}
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(row.ctr, 'percent', 2)}
        </td>
        {/* CPC - Real decimal value */}
        <td className="px-3 py-3 text-right text-gray-600">
          {formatCPC(row.cpc)}
        </td>
        {/* LPV */}
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(row.lpv, 'number')}
        </td>

        {/* LOWER FUNNEL GROUP */}
        {/* ATC */}
        <td className="px-3 py-3 text-right text-gray-600 border-l border-gray-100">
          {renderMetric(row.atc, 'number')}
        </td>
        {/* Checkout */}
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(row.checkout, 'number')}
        </td>
        {/* Orders (Purchased) - green only when orders occurred TODAY */}
        <td className={`px-3 py-3 text-right font-medium ${hasOrdersToday ? 'text-green-600' : 'text-gray-700'}`}>
          {row.conversions || 0}
        </td>
        {/* CVR (Purchases/LPV) */}
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(cvr, 'percent', 2)}
        </td>

        {/* Creative Score Columns (Ad level only) */}
        <td className="px-3 py-3 text-right text-gray-600 border-l border-gray-100">
          {renderMetric(creativeStats?.visits, 'number')}
        </td>
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(creativeStats?.purchases, 'number')}
        </td>
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(creativeStats?.baselineCvr, 'percent', 2)}
        </td>
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(creativeStats?.confidence, 'percent', 2)}
        </td>
        <td className="px-3 py-3 text-right text-gray-600">
          {creativeStats?.score == null ? (
            '—'
          ) : (
            <div className="flex items-center justify-end gap-1">
              <span>{renderMetric(creativeStats.score, 'decimal', 1)}</span>
              <span className="text-[10px] uppercase text-gray-400">{creativeStats.label}</span>
            </div>
          )}
        </td>
      </tr>
    );
  };

  // Render country breakdown rows for a campaign
  const renderCountryBreakdowns = (campaign) => {
    if (adManagerBreakdown !== 'country' || !campaign.country_breakdowns) return null;

    return campaign.country_breakdowns.map((breakdown, idx) => (
      renderDataRow(
        { ...breakdown, isCountryBreakdown: true },
        'breakdown',
        true,
        `${campaign.campaign_id}-country-${breakdown.country || idx}`
      )
    ));
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header - Meta style */}
      <div className="px-5 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              Unified Campaign
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Meta Ad Manager hierarchy with breakdowns. All data from Meta pixel.
            </p>
          </div>

          {/* Date info - keeping date visible */}
          {dateRange?.startDate && dateRange?.endDate && (
            <div className="text-sm text-gray-500">
              {dateRange.startDate} to {dateRange.endDate}
            </div>
          )}
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left side: Hierarchy label and breakdown selector */}
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Campaign → Ad Set → Ad Hierarchy
            </span>

            {/* Breakdown dropdown */}
            <select
              value={adManagerBreakdown}
              onChange={(e) => setAdManagerBreakdown(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="none">No Breakdown</option>
              <option value="country">By Country</option>
              <option value="age">By Age</option>
              <option value="gender">By Gender</option>
              <option value="age_gender">By Age + Gender</option>
              <option value="placement">By Placement</option>
            </select>
          </div>

          {/* Right side: Search, count, toggle */}
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search campaigns..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 py-1.5 text-sm border border-gray-300 rounded-md w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Campaign count */}
            <span className="text-sm text-gray-600">
              Showing {visibleCount} of {totalCount} campaigns
              {selectedDiagnosticsCampaign && (
                <span className="ml-1 text-blue-600 font-medium">
                  (1 selected)
                </span>
              )}
            </span>

            {/* Hidden campaigns dropdown */}
            {hiddenCampaigns.size > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowHiddenDropdown(!showHiddenDropdown)}
                  className="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-md flex items-center gap-1"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Hidden: {hiddenCampaigns.size}
                </button>
                {showHiddenDropdown && (
                  <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[220px] py-1">
                    {Array.from(hiddenCampaigns).map(id => {
                      const campaign = metaAdManagerData.find(c => c.campaign_id === id);
                      return (
                        <button
                          key={id}
                          onClick={() => {
                            toggleHideCampaign(id);
                            setShowHiddenDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                        >
                          <Eye className="w-3.5 h-3.5 text-gray-400" />
                          <span className="truncate">{campaign?.campaign_name || id}</span>
                        </button>
                      );
                    })}
                    <div className="border-t border-gray-100 mt-1 pt-1">
                      <button
                        onClick={() => {
                          showAllCampaigns();
                          setShowHiddenDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 font-medium"
                      >
                        Show All Campaigns
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Include Inactive toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={includeInactive ? 'text-blue-600 font-medium' : ''}>
                Include Inactive
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px]">
          <thead>
            {/* Column Group Headers */}
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-12"></th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Name</th>
              <ColumnGroupHeader label="Financials" colSpan={6} bgColor="bg-emerald-50" />
              <ColumnGroupHeader label="Upper Funnel" colSpan={4} bgColor="bg-blue-50" />
              <ColumnGroupHeader label="Mid Funnel" colSpan={4} bgColor="bg-purple-50" />
              <ColumnGroupHeader label="Lower Funnel" colSpan={9} bgColor="bg-orange-50" />
            </tr>

            {/* Column Headers */}
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-12"></th>
              <SortableHeader
                label="Name"
                field="campaign_name"
                sortConfig={sortConfig}
                onSort={handleSort}
                align="left"
                className="text-left"
              />

              {/* Financials */}
              <SortableHeader label="Revenue" field="conversion_value" sortConfig={sortConfig} onSort={handleSort} className="border-l border-gray-200" />
              <SortableHeader label="Spent" field="spend" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="AOV" field="aov" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="CAC" field="cac" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="ROAS" field="roas" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="Orders" field="conversions" sortConfig={sortConfig} onSort={handleSort} />

              {/* Upper Funnel */}
              <SortableHeader label="Impr" field="impressions" sortConfig={sortConfig} onSort={handleSort} className="border-l border-gray-200" />
              <SortableHeader label="Reach" field="reach" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="CPM" field="cpm" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="Freq" field="frequency" sortConfig={sortConfig} onSort={handleSort} />

              {/* Mid Funnel */}
              <SortableHeader label="Link Clicks" field="inline_link_clicks" sortConfig={sortConfig} onSort={handleSort} className="border-l border-gray-200" />
              <SortableHeader label="CTR" field="ctr" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="CPC" field="cpc" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="LPV" field="lpv" sortConfig={sortConfig} onSort={handleSort} />

              {/* Lower Funnel */}
              <SortableHeader label="ATC" field="atc" sortConfig={sortConfig} onSort={handleSort} className="border-l border-gray-200" />
              <SortableHeader label="Checkout" field="checkout" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="Orders" field="conversions" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="CVR" field="cvr" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="Visits" field="creative_visits" sortConfig={sortConfig} onSort={handleSort} className="border-l border-gray-200" />
              <SortableHeader label="Purchases" field="creative_purchases" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="Baseline CVR" field="creative_baseline_cvr" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="Confidence" field="creative_confidence" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="Creative Score" field="creative_score" sortConfig={sortConfig} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {processedCampaigns.map((campaign) => {
              const campaignExpanded = expandedCampaigns.has(campaign.campaign_id);

              return (
                <Fragment key={campaign.campaign_id}>
                  {/* Campaign Row */}
                  {renderDataRow(campaign, 'campaign', true, `campaign-${campaign.campaign_id}`)}

                  {/* Country Breakdowns (if expanded and breakdown is country) */}
                  {campaignExpanded && adManagerBreakdown === 'country' && campaign.country_breakdowns?.map((breakdown, idx) => (
                    renderDataRow(
                      { ...breakdown, isCountryBreakdown: true },
                      'breakdown',
                      true,
                      `${campaign.campaign_id}-country-${breakdown.country || idx}`
                    )
                  ))}

                  {/* Ad Sets (if expanded) - ALWAYS show adsets hierarchy regardless of breakdown */}
                  {campaignExpanded && campaign.adsets?.map((adset) => {
                    const adsetExpanded = expandedAdsets.has(adset.adset_id);

                    return (
                      <Fragment key={adset.adset_id}>
                        {renderDataRow(adset, 'adset', true, `adset-${adset.adset_id}`)}

                        {/* Ads (if adset expanded) */}
                        {adsetExpanded && adset.ads?.map((ad) => (
                          renderDataRow(ad, 'ad', true, `ad-${ad.ad_id}`)
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}

            {/* Empty state */}
            {processedCampaigns.length === 0 && (
              <tr>
                <td colSpan="25" className="px-4 py-12 text-center text-gray-500">
                  {loading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      <span>Loading campaign data...</span>
                    </div>
                  ) : searchQuery ? (
                    <div>
                      <p className="font-medium">No campaigns match "{searchQuery}"</p>
                      <button
                        onClick={() => setSearchQuery('')}
                        className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                      >
                        Clear search
                      </button>
                    </div>
                  ) : metaAdManagerData.length > 0 ? (
                    <div>
                      <p className="font-medium">All campaigns are hidden</p>
                      <button
                        onClick={showAllCampaigns}
                        className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
                      >
                        Show all campaigns
                      </button>
                    </div>
                  ) : (
                    <p>No campaign data available. Try syncing Meta data first.</p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Click outside to close dropdown */}
      {showHiddenDropdown && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowHiddenDropdown(false)}
        />
      )}
    </div>
  );
}
