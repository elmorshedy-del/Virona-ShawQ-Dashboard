/**
 * UNIFIED ANALYTICS COMPONENT
 * ===========================
 *
 * Extracted from DashboardTab for better maintainability.
 * Contains the Unified Analytics Section with Countries and Meta Ad Manager modes.
 *
 * Data Flow:
 * - Receives countries data from dashboard (from parent)
 * - Receives metaAdManagerData from parent (fetched in App.jsx)
 * - Manages local state for sorting and UI interactions
 * - Callbacks for diagnostics selection go back to parent
 */

import { Fragment, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';

/**
 * Sortable Table Header Component
 */
function SortableHeader({ label, field, sortConfig, onSort, className = '' }) {
  const isActive = sortConfig.field === field;
  const isAsc = isActive && sortConfig.direction === 'asc';

  return (
    <th
      className={`cursor-pointer hover:bg-gray-100 select-none ${className}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1 justify-center">
        {label}
        {isActive ? (
          isAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </div>
    </th>
  );
}

/**
 * UnifiedAnalytics Component
 *
 * @param {Object} props
 * @param {string} props.analyticsMode - Current mode: 'countries' | 'meta-ad-manager'
 * @param {Function} props.setAnalyticsMode - Mode setter
 * @param {Object} props.dashboard - Dashboard data containing countries and countriesDataSource
 * @param {string} props.countriesDataSource - Fallback data source label
 * @param {Array} props.metaAdManagerData - Meta Ad Manager hierarchy data
 * @param {string} props.adManagerBreakdown - Breakdown type for Meta Ad Manager
 * @param {Function} props.setAdManagerBreakdown - Breakdown setter
 * @param {Set} props.hiddenCampaigns - Set of hidden campaign IDs
 * @param {Function} props.setHiddenCampaigns - Hidden campaigns setter
 * @param {string|null} props.selectedDiagnosticsCampaign - Selected campaign ID for diagnostics
 * @param {Function} props.setSelectedDiagnosticsCampaign - Selection setter
 * @param {boolean} props.showHiddenDropdown - Whether hidden dropdown is shown
 * @param {Function} props.setShowHiddenDropdown - Dropdown visibility setter
 * @param {boolean} props.includeInactive - Whether to include inactive campaigns
 * @param {Function} props.setIncludeInactive - Include inactive setter
 * @param {Set} props.expandedCampaigns - Set of expanded campaign IDs
 * @param {Function} props.setExpandedCampaigns - Expanded campaigns setter
 * @param {Set} props.expandedAdsets - Set of expanded adset IDs
 * @param {Function} props.setExpandedAdsets - Expanded adsets setter
 * @param {boolean} props.loading - Loading state
 * @param {Object} props.store - Store configuration
 * @param {Function} props.formatCurrency - Currency formatting function
 * @param {Function} props.formatNumber - Number formatting function
 * @param {Function} props.setDiagnosticsExpanded - Diagnostics expanded setter
 */
export default function UnifiedAnalytics({
  analyticsMode = 'countries',
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
}) {
  // Extract countries from dashboard
  const { countries = [] } = dashboard || {};

  // Local state for sorting
  const [countrySortConfig, setCountrySortConfig] = useState({ field: 'totalOrders', direction: 'desc' });

  // Sorting handler
  const handleCountrySort = useCallback((field) => {
    setCountrySortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  }, []);

  // Sorted countries
  const sortedCountries = [...countries].sort((a, b) => {
    const aVal = a[countrySortConfig.field] || 0;
    const bVal = b[countrySortConfig.field] || 0;
    return countrySortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
  });

  // Total country spend
  const totalCountrySpend = countries.reduce((s, x) => s + (x.spend || 0), 0);

  // Hide/show campaign functions
  const toggleHideCampaign = useCallback((campaignId) => {
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

  // Helper: Render percent
  const renderPercent = (value, decimals = 2) => {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(decimals)}%` : '—';
  };

  // Helper: Render ROAS
  const renderRoas = (value, decimals = 2) => {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(decimals)}×` : '—';
  };

  // Helper: Render metric with null handling
  const renderMetric = (value, formatter = 'number', decimals = 0) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';

    if (formatter === 'currency') return formatCurrency(value, decimals);
    if (formatter === 'percent') return renderPercent(value, decimals);
    if (formatter === 'number') return formatNumber(value);
    if (formatter === 'roas') return renderRoas(value);

    return value;
  };

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {/* Header with Mode Toggle */}
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            Unified Analytics Section
          </h2>
          {analyticsMode === 'countries' && (
            <p className="text-sm text-gray-500 mt-1">
              Aggregated by country with full funnel metrics.{' '}
              <span className="font-semibold">
                Lower funnel ({dashboard?.countriesDataSource || countriesDataSource || 'Loading...'})
              </span>
            </p>
          )}
          {analyticsMode === 'meta-ad-manager' && (
            <p className="text-sm text-gray-500 mt-1">
              Meta Ad Manager hierarchy with breakdowns. All data from Meta pixel.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-2">Mode:</span>
          <button
            onClick={() => setAnalyticsMode('countries')}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium ${
              analyticsMode === 'countries'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Countries (True)
          </button>
          <button
            onClick={() => setAnalyticsMode('meta-ad-manager')}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium ${
              analyticsMode === 'meta-ad-manager'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Meta Ad Manager
          </button>
        </div>
      </div>

      {/* MODE 1: Countries (True) */}
      {analyticsMode === 'countries' && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              {/* Funnel Stage Headers */}
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2">Country</th>
                <th className="text-center border-l border-gray-100">Spend</th>
                <th colSpan={4} className="text-center border-l border-gray-100 bg-blue-50">
                  UPPER FUNNEL
                </th>
                <th colSpan={4} className="text-center border-l border-gray-100 bg-purple-50">
                  MID FUNNEL
                </th>
                <th colSpan={7} className="text-center border-l border-gray-100 bg-green-50">
                  LOWER FUNNEL
                </th>
              </tr>
              {/* Column Headers */}
              <tr className="bg-gray-50 text-xs text-gray-500">
                <SortableHeader
                  label="Name"
                  field="name"
                  sortConfig={countrySortConfig}
                  onSort={handleCountrySort}
                  className="text-left px-4 py-2"
                />
                <th>Spend</th>
                {/* Upper Funnel */}
                <SortableHeader label="Impr" field="impressions" sortConfig={countrySortConfig} onSort={handleCountrySort} />
                <SortableHeader label="Reach" field="reach" sortConfig={countrySortConfig} onSort={handleCountrySort} />
                <th>CPM</th>
                <th>Freq</th>
                {/* Mid Funnel */}
                <SortableHeader label="Clicks" field="clicks" sortConfig={countrySortConfig} onSort={handleCountrySort} />
                <th>CTR</th>
                <th>CPC</th>
                <th>LPV</th>
                {/* Lower Funnel */}
                <th>ATC</th>
                <th>Checkout</th>
                <SortableHeader label="Orders" field="totalOrders" sortConfig={countrySortConfig} onSort={handleCountrySort} />
                <th>Revenue</th>
                <th>AOV</th>
                <th>CAC</th>
                <SortableHeader label="ROAS" field="roas" sortConfig={countrySortConfig} onSort={handleCountrySort} className="bg-indigo-50 text-indigo-700" />
              </tr>
            </thead>
            <tbody>
              {sortedCountries.map((row) => (
                <tr key={row.code}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{row.flag}</span>
                      <span className="font-medium">{row.name}</span>
                    </div>
                  </td>
                  <td className="text-indigo-600 font-semibold">{formatCurrency(row.spend || 0)}</td>
                  {/* Upper Funnel */}
                  <td>{renderMetric(row.impressions, 'number')}</td>
                  <td>{renderMetric(row.reach, 'number')}</td>
                  <td>{renderMetric(row.cpm, 'currency', 2)}</td>
                  <td>{renderMetric(row.frequency, 'percent', 2).replace('%', '')}</td>
                  {/* Mid Funnel */}
                  <td>{renderMetric(row.clicks, 'number')}</td>
                  <td>{renderMetric(row.ctr, 'percent', 2)}</td>
                  <td>{renderMetric(row.cpc, 'currency', 2)}</td>
                  <td>{renderMetric(row.lpv, 'number')}</td>
                  {/* Lower Funnel */}
                  <td>{renderMetric(row.atc, 'number')}</td>
                  <td>{renderMetric(row.checkout, 'number')}</td>
                  <td>{row.totalOrders || 0}</td>
                  <td className="text-green-600 font-semibold">{formatCurrency(row.revenue || 0)}</td>
                  <td>{renderMetric(row.aov, 'currency')}</td>
                  <td>{renderMetric(row.cac, 'currency')}</td>
                  <td className="text-green-600 font-semibold">{renderMetric(row.roas, 'roas')}</td>
                </tr>
              ))}
              {/* Total Row */}
              <tr className="bg-gray-50 font-semibold">
                <td className="px-4 py-2">TOTAL</td>
                <td className="text-indigo-600">{formatCurrency(totalCountrySpend)}</td>
                <td>{renderMetric(countries.reduce((s, r) => s + (r.impressions || 0), 0), 'number')}</td>
                <td>{renderMetric(countries.reduce((s, r) => s + (r.reach || 0), 0), 'number')}</td>
                <td colSpan="2" className="text-gray-400 text-xs">—</td>
                <td>{renderMetric(countries.reduce((s, r) => s + (r.clicks || 0), 0), 'number')}</td>
                <td colSpan="1" className="text-gray-400 text-xs">—</td>
                <td colSpan="1" className="text-gray-400 text-xs">—</td>
                <td>{renderMetric(countries.reduce((s, r) => s + (r.lpv || 0), 0), 'number')}</td>
                <td>{renderMetric(countries.reduce((s, r) => s + (r.atc || 0), 0), 'number')}</td>
                <td>{renderMetric(countries.reduce((s, r) => s + (r.checkout || 0), 0), 'number')}</td>
                <td>{countries.reduce((s, r) => s + (r.totalOrders || 0), 0)}</td>
                <td className="text-green-600">{formatCurrency(countries.reduce((s, r) => s + (r.revenue || 0), 0))}</td>
                <td colSpan="3" className="text-gray-400 text-xs">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* MODE 2: Meta Ad Manager */}
      {analyticsMode === 'meta-ad-manager' && (
        <>
          {/* Breakdown Dropdown */}
          <div className="px-6 pt-4 pb-2 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Campaign → Ad Set → Ad Hierarchy
            </div>
            <select
              value={adManagerBreakdown}
              onChange={(e) => setAdManagerBreakdown(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              <option value="none">No Breakdown</option>
              <option value="country">By Country</option>
              <option value="age">By Age</option>
              <option value="gender">By Gender</option>
              <option value="age_gender">By Age + Gender</option>
              <option value="placement">By Placement</option>
            </select>
          </div>

          {/* Hidden Campaigns Header */}
          <div className="px-6 py-3 flex items-center justify-between border-b border-gray-100">
            <span className="text-sm text-gray-600">
              Showing {metaAdManagerData.filter(c => !hiddenCampaigns.has(c.campaign_id)).length} of {metaAdManagerData.length} campaigns
              {selectedDiagnosticsCampaign && (
                <span className="ml-2 text-purple-600 font-medium">
                  (1 selected for diagnostics)
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {hiddenCampaigns.size > 0 && (
                <>
                  <div className="relative">
                    <button
                      onClick={() => setShowHiddenDropdown(!showHiddenDropdown)}
                      className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1"
                    >
                      Hidden: {hiddenCampaigns.size} ▼
                    </button>
                    {showHiddenDropdown && (
                      <div className="absolute right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 min-w-[200px]">
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
                              <span>👁️</span> {campaign?.campaign_name || id}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={showAllCampaigns}
                    className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg"
                  >
                    Show All
                  </button>
                </>
              )}
              {/* Include Inactive Toggle */}
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer ml-2">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(e) => setIncludeInactive(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-orange-500 focus:ring-orange-400"
                />
                <span className={includeInactive ? 'text-orange-600 font-medium' : ''}>
                  Include Inactive
                </span>
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table>
              <thead>
                {/* Funnel Stage Headers */}
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="w-8"></th>
                  <th className="text-left px-4 py-2">Name</th>
                  {adManagerBreakdown !== 'none' && <th>Breakdown</th>}
                  <th className="text-center border-l border-gray-100">Spend</th>
                  <th colSpan={4} className="text-center border-l border-gray-100 bg-blue-50">
                    UPPER FUNNEL
                  </th>
                  <th colSpan={4} className="text-center border-l border-gray-100 bg-purple-50">
                    MID FUNNEL
                  </th>
                  <th colSpan={7} className="text-center border-l border-gray-100 bg-green-50">
                    LOWER FUNNEL
                  </th>
                </tr>
                {/* Column Headers */}
                <tr className="bg-gray-50 text-xs text-gray-500">
                  <th className="w-8"></th>
                  <th className="text-left px-4 py-2">Name</th>
                  {adManagerBreakdown !== 'none' && <th>Dimension</th>}
                  <th>Spend</th>
                  {/* Upper */}
                  <th>Impr</th>
                  <th>Reach</th>
                  <th>CPM</th>
                  <th>Freq</th>
                  {/* Mid */}
                  <th>Clicks</th>
                  <th>CTR</th>
                  <th>CPC</th>
                  <th>LPV</th>
                  {/* Lower */}
                  <th>ATC</th>
                  <th>Checkout</th>
                  <th>Orders</th>
                  <th>Revenue</th>
                  <th>AOV</th>
                  <th>CAC</th>
                  <th className="bg-indigo-50 text-indigo-700">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {metaAdManagerData.filter(c => !hiddenCampaigns.has(c.campaign_id)).map((campaign) => {
                  const campaignExpanded = expandedCampaigns.has(campaign.campaign_id);
                  const isSelected = selectedDiagnosticsCampaign === campaign.campaign_id;
                  return (
                    <Fragment key={campaign.campaign_id}>
                      {/* Campaign Row */}
                      <tr
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-purple-50 border-l-4 border-purple-500'
                            : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                        onClick={() => handleCampaignSelect(campaign.campaign_id)}
                      >
                        <td className="px-2 py-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleHideCampaign(campaign.campaign_id);
                            }}
                            className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600"
                            title="Hide campaign"
                          >
                            👁️
                          </button>
                        </td>
                        <td className="px-4 py-2 font-semibold">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newSet = new Set(expandedCampaigns);
                                if (campaignExpanded) newSet.delete(campaign.campaign_id);
                                else newSet.add(campaign.campaign_id);
                                setExpandedCampaigns(newSet);
                              }}
                              className="p-0.5 hover:bg-gray-200 rounded"
                            >
                              <ChevronDown className={`w-4 h-4 transform transition-transform ${campaignExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            <span>📊 {campaign.campaign_name}</span>
                          </div>
                        </td>
                        {adManagerBreakdown !== 'none' && <td>{campaign.country || campaign.age || campaign.gender || campaign.publisher_platform || '—'}</td>}
                        <td className="text-indigo-600 font-semibold">{formatCurrency(campaign.spend || 0)}</td>
                        <td>{renderMetric(campaign.impressions, 'number')}</td>
                        <td>{renderMetric(campaign.reach, 'number')}</td>
                        <td>{renderMetric(campaign.cpm, 'currency', 2)}</td>
                        <td>{renderMetric(campaign.frequency, 'percent', 2).replace('%', '')}</td>
                        <td>{renderMetric(campaign.clicks, 'number')}</td>
                        <td>{renderMetric(campaign.ctr, 'percent', 2)}</td>
                        <td>{renderMetric(campaign.cpc, 'currency', 2)}</td>
                        <td>{renderMetric(campaign.lpv, 'number')}</td>
                        <td>{renderMetric(campaign.atc, 'number')}</td>
                        <td>{renderMetric(campaign.checkout, 'number')}</td>
                        <td>{campaign.conversions || 0}</td>
                        <td className="text-green-600 font-semibold">{formatCurrency(campaign.conversion_value || 0)}</td>
                        <td>{renderMetric(campaign.aov, 'currency')}</td>
                        <td>{renderMetric(campaign.cac, 'currency')}</td>
                        <td className="text-green-600 font-semibold">{renderMetric(campaign.roas, 'roas')}</td>
                      </tr>

                      {/* Ad Sets (if campaign expanded) */}
                      {campaignExpanded && campaign.adsets && campaign.adsets.map((adset) => {
                        const adsetExpanded = expandedAdsets.has(adset.adset_id);
                        return (
                          <Fragment key={adset.adset_id}>
                            {/* Ad Set Row */}
                            <tr className="bg-gray-50 hover:bg-gray-100 cursor-pointer" onClick={() => {
                              const newSet = new Set(expandedAdsets);
                              if (adsetExpanded) newSet.delete(adset.adset_id);
                              else newSet.add(adset.adset_id);
                              setExpandedAdsets(newSet);
                            }}>
                              <td></td>
                              <td className="px-4 py-2 pl-8 font-medium">
                                <div className="flex items-center gap-2">
                                  <ChevronDown className={`w-3 h-3 transform transition-transform ${adsetExpanded ? 'rotate-180' : ''}`} />
                                  <span>📁 {adset.adset_name}</span>
                                </div>
                              </td>
                              {adManagerBreakdown !== 'none' && <td>{adset.country || adset.age || adset.gender || adset.publisher_platform || '—'}</td>}
                              <td className="text-indigo-600">{formatCurrency(adset.spend || 0)}</td>
                              <td>{renderMetric(adset.impressions, 'number')}</td>
                              <td>{renderMetric(adset.reach, 'number')}</td>
                              <td>{renderMetric(adset.cpm, 'currency', 2)}</td>
                              <td>{renderMetric(adset.frequency, 'percent', 2).replace('%', '')}</td>
                              <td>{renderMetric(adset.clicks, 'number')}</td>
                              <td>{renderMetric(adset.ctr, 'percent', 2)}</td>
                              <td>{renderMetric(adset.cpc, 'currency', 2)}</td>
                              <td>{renderMetric(adset.lpv, 'number')}</td>
                              <td>{renderMetric(adset.atc, 'number')}</td>
                              <td>{renderMetric(adset.checkout, 'number')}</td>
                              <td>{adset.conversions || 0}</td>
                              <td className="text-green-600">{formatCurrency(adset.conversion_value || 0)}</td>
                              <td>{renderMetric(adset.aov, 'currency')}</td>
                              <td>{renderMetric(adset.cac, 'currency')}</td>
                              <td className="text-green-600">{renderMetric(adset.roas, 'roas')}</td>
                            </tr>

                            {/* Ads (if ad set expanded) */}
                            {adsetExpanded && adset.ads && adset.ads.map((ad) => (
                              <tr key={ad.ad_id} className="hover:bg-gray-50">
                                <td></td>
                                <td className="px-4 py-2 pl-16 text-sm text-gray-700">
                                  📄 {ad.ad_name}
                                </td>
                                {adManagerBreakdown !== 'none' && <td>{ad.country || ad.age || ad.gender || ad.publisher_platform || '—'}</td>}
                                <td className="text-indigo-600 text-sm">{formatCurrency(ad.spend || 0)}</td>
                                <td className="text-sm">{renderMetric(ad.impressions, 'number')}</td>
                                <td className="text-sm">{renderMetric(ad.reach, 'number')}</td>
                                <td className="text-sm">{renderMetric(ad.cpm, 'currency', 2)}</td>
                                <td className="text-sm">{renderMetric(ad.frequency, 'percent', 2).replace('%', '')}</td>
                                <td className="text-sm">{renderMetric(ad.clicks, 'number')}</td>
                                <td className="text-sm">{renderMetric(ad.ctr, 'percent', 2)}</td>
                                <td className="text-sm">{renderMetric(ad.cpc, 'currency', 2)}</td>
                                <td className="text-sm">{renderMetric(ad.lpv, 'number')}</td>
                                <td className="text-sm">{renderMetric(ad.atc, 'number')}</td>
                                <td className="text-sm">{renderMetric(ad.checkout, 'number')}</td>
                                <td className="text-sm">{ad.conversions || 0}</td>
                                <td className="text-green-600 text-sm">{formatCurrency(ad.conversion_value || 0)}</td>
                                <td className="text-sm">{renderMetric(ad.aov, 'currency')}</td>
                                <td className="text-sm">{renderMetric(ad.cac, 'currency')}</td>
                                <td className="text-green-600 text-sm">{renderMetric(ad.roas, 'roas')}</td>
                              </tr>
                            ))}
                          </Fragment>
                        );
                      })}
                    </Fragment>
                  );
                })}
                {metaAdManagerData.filter(c => !hiddenCampaigns.has(c.campaign_id)).length === 0 && (
                  <tr>
                    <td colSpan="21" className="px-4 py-8 text-center text-gray-500">
                      {loading ? 'Loading Meta Ad Manager data...' : metaAdManagerData.length > 0 ? 'All campaigns are hidden. Click "Show All" to see them.' : 'No data available. Try syncing Meta data first.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
