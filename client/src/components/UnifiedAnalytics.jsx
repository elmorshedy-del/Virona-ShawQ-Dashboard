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

    return sortData(filtered, sortConfig);
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

  // Calculate CVR (Purchases / LPV * 100)
  const calculateCVR = (purchases, lpv) => {
    if (!lpv || lpv === 0) return null;
    return (purchases / lpv) * 100;
  };

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

    // Calculate CVR
    const cvr = calculateCVR(row.conversions || 0, row.lpv || 0);

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
    // Show green highlight for ANY row with orders (conversions > 0)
    const hasOrders = row.conversions > 0;
    // Show flag only for country breakdown rows
    const showFlag = isCountryBreakdown && hasOrders;

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
        {/* Orders - green when there are orders, with flag for country rows */}
        <td className={`px-3 py-3 text-right font-medium ${hasOrders ? 'text-green-600' : 'text-gray-700'}`}>
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
        {/* Clicks */}
        <td className="px-3 py-3 text-right text-gray-600 border-l border-gray-100">
          {renderMetric(row.clicks, 'number')}
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
        {/* Orders (Purchased) - Explicit purchase-confirmed */}
        <td className={`px-3 py-3 text-right font-medium ${hasOrders ? 'text-green-600' : 'text-gray-700'}`}>
          {row.conversions || 0}
        </td>
        {/* CVR (Purchases/LPV) */}
        <td className="px-3 py-3 text-right text-gray-600">
          {renderMetric(cvr, 'percent', 2)}
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
              <ColumnGroupHeader label="Lower Funnel" colSpan={4} bgColor="bg-orange-50" />
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
              <SortableHeader label="Clicks" field="clicks" sortConfig={sortConfig} onSort={handleSort} className="border-l border-gray-200" />
              <SortableHeader label="CTR" field="ctr" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="CPC" field="cpc" sortConfig={sortConfig} onSort={handleSort} />
              <SortableHeader label="LPV" field="lpv" sortConfig={sortConfig} onSort={handleSort} />

              {/* Lower Funnel */}
              <SortableHeader label="ATC" field="atc" sortConfig={sortConfig} onSort={handleSort} className="border-l border-gray-200" />
              <SortableHeader label="Checkout" field="checkout" sortConfig={sortConfig} onSort={handleSort} />
              <th className="px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider text-center">
                Orders
              </th>
              <th className="px-3 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wider text-center">
                CVR
              </th>
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
                <td colSpan="20" className="px-4 py-12 text-center text-gray-500">
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
